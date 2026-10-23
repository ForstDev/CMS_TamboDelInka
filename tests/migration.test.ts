// Migración de clicks (source / social_id): idempotente y sin tocar los datos existentes.

import { afterEach, describe, expect, it } from 'vitest';
import { openPglite, setDb, type Db } from '../src/db.js';
import { applySchema } from '../src/seed.js';
import * as repo from '../src/repo.js';

let db: Db | null = null;

afterEach(async () => {
  await db?.close();
  db = null;
  setDb(null);
});

async function freshDb() {
  db = await openPglite();
  setDb(db);
  return db;
}

const clickRows = (d: Db) =>
  d.query(`select id, client_id, button_id, button_label, device, clicked_at, source, social_id from clicks order by id`);

async function clicksMeta(d: Db) {
  const cols = await d.query(`select column_name from information_schema.columns where table_name = 'clicks' order by ordinal_position`);
  const cons = await d.query(`select contype, count(*)::int as n from pg_constraint where conrelid = 'clicks'::regclass group by contype order by contype`);
  const idx = await d.query(`select indexname from pg_indexes where tablename = 'clicks' order by indexname`);
  return {
    columns: cols.map((c) => c.column_name),
    constraints: Object.fromEntries(cons.map((c) => [c.contype, Number(c.n)])),
    indexes: idx.map((i) => i.indexname),
  };
}

const EXPECTED_COLUMNS = ['id', 'client_id', 'button_id', 'button_label', 'device', 'clicked_at', 'source', 'social_id'];

describe('migración de clicks', () => {
  it('una base con el formato antiguo conserva sus clics como "button" y se puede reaplicar', async () => {
    const d = await freshDb();
    // Esquema anterior a la migración (solo lo necesario para clicks).
    await d.exec(`
      create table buttons (
        id uuid primary key default gen_random_uuid(), client_id text not null, label text not null,
        kind text not null default 'pdf' check (kind in ('pdf', 'link')), url text not null default '',
        file_name text not null default '', file_path text not null default '', new_tab boolean not null default false,
        position int not null default 0, active boolean not null default true,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table clicks (
        id bigint generated always as identity primary key, client_id text not null,
        button_id uuid references buttons(id) on delete set null, button_label text not null,
        device text not null check (device in ('mobile', 'tablet', 'desktop')),
        clicked_at timestamptz not null default now()
      );
    `);
    const [b] = await d.query(`insert into buttons (client_id, label, url) values ('intursa', 'Hawa', 'https://x.com') returning id`);
    await d.query(`insert into clicks (client_id, button_id, button_label, device) values ('intursa', $1, 'Hawa', 'mobile')`, [b!.id]);
    await d.query(`insert into clicks (client_id, button_id, button_label, device) values ('intursa', null, 'Carta borrada', 'desktop')`);
    const before = await d.query(`select id, client_id, button_id, button_label, device, clicked_at from clicks order by id`);

    await applySchema();
    const once = await clickRows(d);
    const metaOnce = await clicksMeta(d);
    await applySchema();
    await applySchema();

    const after = await clickRows(d);
    expect(after).toEqual(once);
    expect(after.map(({ source: _s, social_id: _i, ...rest }) => rest)).toEqual(before);
    expect(after.every((r) => r.source === 'button' && r.social_id === null)).toBe(true);
    // Reaplicar no duplica columnas, restricciones ni índices.
    expect(await clicksMeta(d)).toEqual(metaOnce);
    expect(metaOnce.columns).toEqual(EXPECTED_COLUMNS);
    expect(metaOnce.constraints).toMatchObject({ c: 2, f: 2, p: 1 }); // device/source · button_id/social_id · id
    expect(metaOnce.indexes).toContain('clicks_social');

    // Los clics antiguos siguen siendo de cartas (incluido el del botón eliminado).
    const s = await repo.getStats(30);
    expect([s.total, s.allTime, s.socials.total]).toEqual([2, 2, 0]);
    expect(s.ranking.find((r) => r.deleted)).toMatchObject({ label: 'Carta borrada', clicks: 1 });
  });

  it('instalación nueva: mismas columnas, valores por defecto y restricciones', async () => {
    const d = await freshDb();
    await applySchema();
    await applySchema();
    const meta = await clicksMeta(d);
    expect(meta.columns).toEqual(EXPECTED_COLUMNS);
    expect(meta.constraints).toMatchObject({ c: 2, f: 2, p: 1 }); // Postgres 18 además lista los NOT NULL (n)

    const social = await repo.createSocial('instagram', 'https://instagram.com/x');
    await repo.recordSocialClick(social, 'tablet');
    await d.query(`insert into clicks (client_id, button_label, device) values ('intursa', 'Sin tipo', 'mobile')`);
    expect((await clickRows(d)).map((r) => [r.source, r.social_id, r.button_id, r.button_label])).toEqual([
      ['social', social.id, null, 'Instagram'],
      ['button', null, null, 'Sin tipo'],
    ]);
    await expect(d.query(`insert into clicks (client_id, source, button_label, device) values ('intursa', 'otro', 'x', 'mobile')`)).rejects.toThrow();

    // Borrar la red deja el clic con social_id null (se conserva el historial).
    await repo.deleteSocial(social.id);
    const rows = await clickRows(d);
    expect(rows[0]).toMatchObject({ source: 'social', social_id: null, button_label: 'Instagram' });
  });
});
