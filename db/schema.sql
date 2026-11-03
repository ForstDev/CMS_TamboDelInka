-- Esquema del CMS. Idempotente: se puede ejecutar varias veces (npm run setup lo aplica).
-- Todas las tablas llevan client_id; lo normal es un proyecto de Supabase por cliente.
-- El servidor se conecta como dueño de las tablas. RLS activo y sin políticas = la API
-- pública de Supabase (anon / authenticated) no puede leer ni escribir nada.

create table if not exists settings (
  client_id text not null,
  key       text not null,
  value     text not null default '',
  primary key (client_id, key)
);

create table if not exists buttons (
  id         uuid primary key default gen_random_uuid(),
  client_id  text not null,
  label      text not null,
  kind       text not null default 'pdf' check (kind in ('pdf', 'link')),
  url        text not null default '',
  file_name  text not null default '',
  file_path  text not null default '',
  new_tab    boolean not null default false,
  position   int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists buttons_client_pos on buttons (client_id, position);

create table if not exists socials (
  id        uuid primary key default gen_random_uuid(),
  client_id text not null,
  network   text not null,
  url       text not null default '',
  position  int  not null default 0,
  active    boolean not null default true
);
create index if not exists socials_client_pos on socials (client_id, position);

-- Sin IP, sin cookies, sin identificadores: solo botón, momento y tipo de dispositivo (Ley 29733).
-- button_label guarda el nombre al momento del clic para no perder el historial si el botón se borra.
create table if not exists clicks (
  id           bigint generated always as identity primary key,
  client_id    text not null,
  button_id    uuid references buttons(id) on delete set null,
  button_label text not null,
  device       text not null check (device in ('mobile', 'tablet', 'desktop')),
  clicked_at   timestamptz not null default now()
);
create index if not exists clicks_client_time on clicks (client_id, clicked_at desc);
create index if not exists clicks_button on clicks (button_id);

-- Clics en íconos de redes (misma tabla, mismos datos mínimos). Migración idempotente:
-- en bases nuevas y antiguas las columnas se añaden aquí; las filas existentes quedan como 'button'.
-- En los clics de redes, button_label guarda el nombre de la red (p. ej. "Facebook").
alter table clicks add column if not exists source text not null default 'button' check (source in ('button', 'social'));
alter table clicks add column if not exists social_id uuid references socials(id) on delete set null;
create index if not exists clicks_social on clicks (social_id);

create table if not exists admins (
  id              uuid primary key default gen_random_uuid(),
  client_id       text not null,
  username        text not null,
  password_hash   text not null,
  failed_attempts int  not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  unique (client_id, username)
);

-- ---------- Varias páginas ("landings") ----------
-- Migración ADITIVA: no borra ni renombra nada. Entre `npm run setup` y el despliegue del código
-- nuevo, el código anterior sigue funcionando con este esquema: usa `settings` (que no se toca) y
-- sus inserciones sin landing_id caen en la landing por defecto (DEFAULT de la columna, más abajo).
-- Esta base es de UN solo client_id (un proyecto de Supabase por cliente); los DEFAULT de columna
-- solo se fijan si hay exactamente una landing por defecto en toda la base.

create table if not exists landings (
  id         uuid primary key default gen_random_uuid(),
  client_id  text not null,
  slug       text not null,
  name       text not null,
  hotel      text not null default '',
  template   text not null check (template in ('cartas', 'experiencias')),
  is_default boolean not null default false,
  position   int  not null default 0,
  active     boolean not null default true,
  created_at timestamptz default now(),
  unique (client_id, slug)
);
create unique index if not exists landings_one_default on landings (client_id) where is_default;

-- Ajustes por landing. El código nuevo solo usa esta tabla; `settings` queda para el código
-- anterior y como respaldo.
create table if not exists landing_settings (
  landing_id uuid not null references landings(id) on delete cascade,
  key        text not null,
  value      text not null default '',
  primary key (landing_id, key)
);

-- Landing por defecto provisional para los clientes que ya tienen datos y aún no tienen una:
-- slug 'principal' y nombre = cms_nombre. El seed (clients/<id>/client.json) completa después su
-- slug, nombre, hotel y plantilla reales sin tocar sus botones, ajustes ni clics.
insert into landings (client_id, slug, name, template, is_default)
select c.client_id,
       'principal',
       coalesce((select nullif(s.value, '') from settings s where s.client_id = c.client_id and s.key = 'cms_nombre'), 'Principal'),
       'cartas',
       true
from (
  select client_id from settings union select client_id from buttons
  union select client_id from socials union select client_id from clicks
) c
where not exists (select 1 from landings l where l.client_id = c.client_id and l.is_default)
on conflict do nothing;

-- Botones y redes: todas las filas existentes pasan a la landing por defecto de su cliente.
alter table buttons add column if not exists landing_id uuid references landings(id) on delete cascade;
alter table socials add column if not exists landing_id uuid references landings(id) on delete cascade;
update buttons b set landing_id = l.id from landings l where b.landing_id is null and l.client_id = b.client_id and l.is_default;
update socials s set landing_id = l.id from landings l where s.landing_id is null and l.client_id = s.client_id and l.is_default;

-- Clics: la columna puede quedar NULL (landing borrada). Por eso los clics existentes se asignan
-- solo la primera vez (al crear la columna); reaplicar el esquema no mueve clics huérfanos.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'clicks' and column_name = 'landing_id'
  ) then
    alter table clicks add column landing_id uuid references landings(id) on delete set null;
    update clicks c set landing_id = l.id from landings l where l.client_id = c.client_id and l.is_default;
  end if;
end $$;

-- Copia los ajustes antiguos a la landing por defecto sin pisar lo que ya exista.
insert into landing_settings (landing_id, key, value)
select l.id, s.key, s.value from settings s join landings l on l.client_id = s.client_id and l.is_default
on conflict do nothing;

-- DEFAULT de landing_id = landing por defecto (para el código anterior) y NOT NULL en botones y redes.
do $$
declare
  d uuid;
  t text;
begin
  if (select count(*) from landings where is_default) = 1 then
    select id into d from landings where is_default;
    foreach t in array array['buttons', 'socials', 'clicks'] loop
      execute format('alter table %I alter column landing_id set default %L::uuid', t, d);
    end loop;
  end if;
  if not exists (select 1 from buttons where landing_id is null) then
    alter table buttons alter column landing_id set not null;
  end if;
  if not exists (select 1 from socials where landing_id is null) then
    alter table socials alter column landing_id set not null;
  end if;
end $$;

create index if not exists buttons_landing_pos on buttons (landing_id, position);
create index if not exists socials_landing_pos on socials (landing_id, position);
create index if not exists clicks_landing_time on clicks (landing_id, clicked_at desc);

alter table settings enable row level security;
alter table buttons  enable row level security;
alter table socials  enable row level security;
alter table clicks   enable row level security;
alter table admins   enable row level security;
alter table landings enable row level security;
alter table landing_settings enable row level security;

-- Intentos fallidos de login por equipo (IP), no por cuenta: la cuenta se comparte entre varias personas.
-- No se guarda la IP: ip_hash es un HMAC-SHA256 de la IP con el secreto de sesión (Ley 29733).
create table if not exists login_attempts (
  client_id       text not null,
  ip_hash         text not null,
  failed          int not null default 0,
  first_failed_at timestamptz,
  locked_until    timestamptz,
  primary key (client_id, ip_hash)
);
alter table login_attempts enable row level security;
