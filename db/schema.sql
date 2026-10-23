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

alter table settings enable row level security;
alter table buttons  enable row level security;
alter table socials  enable row level security;
alter table clicks   enable row level security;
alter table admins   enable row level security;
