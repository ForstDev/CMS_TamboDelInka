// Esquema y consultas de la versión ANTERIOR a las varias landings (copiados de db/schema.sql y
// src/repo.ts de esa versión). Sirven para probar la migración y que el código anterior sigue
// funcionando con el esquema nuevo durante la ventana entre `npm run setup` y el despliegue.

import type { Db } from '../../src/db.js';

export const OLD_SCHEMA_SQL = `
create table if not exists settings (
  client_id text not null, key text not null, value text not null default '', primary key (client_id, key)
);
create table if not exists buttons (
  id uuid primary key default gen_random_uuid(), client_id text not null, label text not null,
  kind text not null default 'pdf' check (kind in ('pdf', 'link')), url text not null default '',
  file_name text not null default '', file_path text not null default '', new_tab boolean not null default false,
  position int not null default 0, active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists buttons_client_pos on buttons (client_id, position);
create table if not exists socials (
  id uuid primary key default gen_random_uuid(), client_id text not null, network text not null,
  url text not null default '', position int not null default 0, active boolean not null default true
);
create index if not exists socials_client_pos on socials (client_id, position);
create table if not exists clicks (
  id bigint generated always as identity primary key, client_id text not null,
  button_id uuid references buttons(id) on delete set null, button_label text not null,
  device text not null check (device in ('mobile', 'tablet', 'desktop')),
  clicked_at timestamptz not null default now()
);
create index if not exists clicks_client_time on clicks (client_id, clicked_at desc);
create index if not exists clicks_button on clicks (button_id);
alter table clicks add column if not exists source text not null default 'button' check (source in ('button', 'social'));
alter table clicks add column if not exists social_id uuid references socials(id) on delete set null;
create index if not exists clicks_social on clicks (social_id);
create table if not exists admins (
  id uuid primary key default gen_random_uuid(), client_id text not null, username text not null,
  password_hash text not null, failed_attempts int not null default 0, locked_until timestamptz,
  created_at timestamptz not null default now(), unique (client_id, username)
);
alter table settings enable row level security;
alter table buttons  enable row level security;
alter table socials  enable row level security;
alter table clicks   enable row level security;
alter table admins   enable row level security;
`;

/** Las escrituras que hacía el código anterior (mismo SQL). */
export const oldCode = {
  saveSetting: (db: Db, key: string, value: string) =>
    db.query(
      `insert into settings (client_id, key, value)
       select $1, x->>'key', x->>'value' from jsonb_array_elements($2::text::jsonb) x
       on conflict (client_id, key) do update set value = excluded.value`,
      ['intursa', JSON.stringify([{ key, value }])],
    ),
  createButton: async (db: Db, label: string, url: string) =>
    (
      await db.query(
        `insert into buttons (client_id, label, kind, url, file_name, file_path, new_tab, active, position)
         values ($1, $2, $3, $4, $5, $6, $7, $8, coalesce((select max(position) + 1 from buttons where client_id = $1), 0))
         returning id`,
        ['intursa', label, 'link', url, '', '', false, true],
      )
    )[0]!.id as string,
  createSocial: async (db: Db, network: string, url: string) =>
    (
      await db.query(
        `insert into socials (client_id, network, url, position)
         values ($1, $2, $3, coalesce((select max(position) + 1 from socials where client_id = $1), 0)) returning id`,
        ['intursa', network, url],
      )
    )[0]!.id as string,
  recordClick: (db: Db, buttonId: string, label: string) =>
    db.query('insert into clicks (client_id, button_id, button_label, device) values ($1, $2, $3, $4)', ['intursa', buttonId, label, 'mobile']),
  recordSocialClick: (db: Db, socialId: string, label: string) =>
    db.query(`insert into clicks (client_id, source, social_id, button_id, button_label, device) values ($1, 'social', $2, null, $3, $4)`, [
      'intursa',
      socialId,
      label,
      'desktop',
    ]),
  listButtons: (db: Db) => db.query(`select id, label from buttons where client_id = $1 and active and url <> '' order by position, created_at`, ['intursa']),
  getSettings: (db: Db) => db.query<{ key: string; value: string }>('select key, value from settings where client_id = $1 order by key', ['intursa']),
};

/** Una base "de producción" con el esquema anterior y datos reales de ejemplo. */
export async function createOldDatabase(db: Db) {
  await db.exec(OLD_SCHEMA_SQL);
  for (const [k, v] of [
    ['cms_nombre', 'Tambo del Inka – Outlets'],
    ['titulo_pagina', 'Tambo del Inka – Outlets'],
    ['redes_titulo', 'Síguenos'],
    ['color_boton_hover', '#26615f'],
  ]) {
    await oldCode.saveSetting(db, k!, v!);
  }
  const hawa = await oldCode.createButton(db, 'Hawa', 'https://example.com/hawa.pdf');
  const kiri = await oldCode.createButton(db, 'Kiri Bar', 'https://example.com/kiri.pdf');
  const fb = await oldCode.createSocial(db, 'facebook', 'https://facebook.com/tambo');
  await oldCode.recordClick(db, hawa, 'Hawa');
  await oldCode.recordClick(db, hawa, 'Hawa');
  await oldCode.recordClick(db, kiri, 'Kiri Bar');
  await db.query(`insert into clicks (client_id, button_id, button_label, device) values ('intursa', null, 'Carta borrada', 'desktop')`);
  await oldCode.recordSocialClick(db, fb, 'Facebook');
  await db.query(`insert into admins (client_id, username, password_hash) values ('intursa', 'TambodelInka', 'x')`);
  return { hawa, kiri, fb };
}

/** Foto de todo el contenido y de la estructura, para comprobar que reaplicar el esquema no cambia nada. */
export async function snapshot(db: Db) {
  const q = (sql: string) => db.query(sql);
  return {
    settings: await q('select * from settings order by client_id, key'),
    landings: await q('select * from landings order by id'),
    landing_settings: await q('select * from landing_settings order by landing_id, key'),
    buttons: await q('select * from buttons order by id'),
    socials: await q('select * from socials order by id'),
    clicks: await q('select * from clicks order by id'),
    admins: await q('select id, client_id, username from admins order by id'),
    columns: await q(
      `select table_name, column_name, column_default, is_nullable from information_schema.columns
       where table_schema = current_schema() order by table_name, column_name`,
    ),
    constraints: await q(
      `select conrelid::regclass::text as t, contype, count(*)::int as n from pg_constraint c
       join pg_namespace ns on ns.oid = c.connamespace where ns.nspname = current_schema()
       group by 1, 2 order by 1, 2`,
    ),
    indexes: await q(`select tablename, indexname from pg_indexes where schemaname = current_schema() order by 1, 2`),
  };
}

export async function columnDefault(db: Db, table: string) {
  const [row] = await db.query<{ d: string | null }>(
    `select column_default as d from information_schema.columns where table_schema = current_schema() and table_name = $1 and column_name = 'landing_id'`,
    [table],
  );
  return row?.d ?? null;
}
