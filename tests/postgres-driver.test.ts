// Verifica el conector de producción (postgres.js, el mismo que usa Supabase) contra un Postgres
// real por red: PGlite expuesto con el protocolo de Postgres en un puerto local.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { openPostgres, setDb, type Db } from '../src/db.js';
import { setStorage } from '../src/storage.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applySchema, seed, type ClientConfig } from '../src/seed.js';
import { createApp } from '../src/app.js';
import * as repo from '../src/repo.js';
import { runWithLanding } from '../src/context.js';
import { columnDefault, createOldDatabase, oldCode, snapshot } from './fixtures/old-schema.js';

const PORT = 54329;
// Configuración fija de prueba (solo la landing por defecto): las pruebas no dependen del client.json real.
const here = path.dirname(fileURLToPath(import.meta.url));
const quiet = {
  log: () => {},
  source: {
    config: JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'client-default-only.json'), 'utf8')) as ClientConfig,
    dir: path.join(here, '..', 'clients', 'intursa'),
  },
};
let server: PGLiteSocketServer;
let pg: PGlite;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' });
  await server.start();
  db = await openPostgres(`postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  setDb(db);
  setStorage({
    mode: 'local',
    createUploadTarget: async (p) => ({ uploadUrl: '', path: p, publicUrl: `/uploads/${p}` }),
    put: async (p) => `/uploads/${p}`,
    remove: async () => {},
    publicUrl: (p) => `/uploads/${p}`,
  });
  await applySchema();
  await seed(quiet);
}, 60_000);

afterAll(async () => {
  await db?.close();
  await server?.stop();
  await pg?.close();
});

describe('conector postgres.js', () => {
  it('lee ajustes, botones y tipos correctamente', async () => {
    const s = await repo.getSettings();
    expect(s.cms_nombre).toBe('Tambo del Inka – Outlets');
    const buttons = await repo.listButtons();
    expect(buttons).toHaveLength(9);
    expect(typeof buttons[0]!.active).toBe('boolean');
    expect(typeof buttons[0]!.position).toBe('number');
  });

  it('registra clics y calcula estadísticas con números (no texto)', async () => {
    const app = createApp();
    const [first] = await repo.listButtons();
    await request(app).get(`/go/${first!.id}`).set('User-Agent', 'Mozilla/5.0 (iPhone) Mobile');
    await request(app).get(`/go/${first!.id}`).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126');
    const stats = await repo.getStats(30);
    expect(stats.total).toBe(2);
    expect(stats.today).toBe(2);
    expect(stats.ranking[0]).toMatchObject({ id: first!.id, clicks: 2 });
    expect(stats.daily).toHaveLength(30);
    expect(stats.daily.at(-1)!.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stats.hours.reduce((a, h) => a + h.clicks, 0)).toBe(2);
  });

  it('registra clics de redes aparte de las cartas (consultas nuevas)', async () => {
    const app = createApp();
    const [fb, ig] = await repo.listSocials();
    const r = await request(app).get(`/go/social/${fb!.id}`).set('User-Agent', 'Mozilla/5.0 (iPhone) Mobile');
    expect(r.headers.location).toBe(fb!.url);
    await request(app).get(`/go/social/${fb!.id}`).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126');
    await request(app).get(`/go/social/${ig!.id}`).set('User-Agent', 'Googlebot/2.1');
    const tmp = await repo.createSocial('youtube', 'https://youtube.com/@x');
    await repo.recordSocialClick(tmp, 'tablet');
    await repo.deleteSocial(tmp.id);

    const stats = await repo.getStats(30);
    expect([stats.total, stats.today, stats.allTime]).toEqual([2, 2, 2]); // solo las 2 cartas del test anterior
    expect(stats.devices.reduce((a, d) => a + d.clicks, 0)).toBe(2);
    expect(stats.hours.reduce((a, h) => a + h.clicks, 0)).toBe(2);
    expect(stats.ranking.some((r) => r.deleted)).toBe(false);
    const { series, ...socialsRest } = stats.socials;
    expect(series.map((x) => [x.id, x.network, x.deleted, x.data.length, x.data.at(-1)])).toEqual([
      [fb!.id, 'facebook', false, 30, 2],
      [null, 'youtube', true, 30, 1],
    ]);
    expect(socialsRest).toEqual({
      total: 3,
      ranking: [
        { id: fb!.id, network: 'facebook', label: 'Facebook', clicks: 2, active: true, deleted: false },
        { id: null, network: 'youtube', label: 'YouTube', clicks: 1, active: false, deleted: true },
        { id: ig!.id, network: 'instagram', label: 'Instagram', clicks: 0, active: true, deleted: false },
      ],
    });
    const csv = await repo.clicksForCsv(30);
    expect(csv.filter((c) => c.source === 'social').reduce((a, c) => a + c.clicks, 0)).toBe(3);
    expect(csv.filter((c) => c.source === 'button').reduce((a, c) => a + c.clicks, 0)).toBe(2);
    expect(typeof csv[0]!.clicks).toBe('number');
  });

  it('reordena y guarda ajustes en lote', async () => {
    const ids = (await repo.listButtons()).map((b) => b.id).reverse();
    await repo.reorderButtons(ids);
    expect((await repo.listButtons()).map((b) => b.id)).toEqual(ids);
    await repo.saveSettings({ redes_titulo: 'Síguenos', color_fondo: '#000000' });
    expect((await repo.getSettings()).color_fondo).toBe('#000000');
  });

  it('varias landings: reaplicar el esquema (bloques do $$) y consultas por landing', async () => {
    const snap = await snapshot(db);
    await applySchema();
    await applySchema();
    expect(await snapshot(db)).toEqual(snap);

    const def = (await repo.getDefaultLanding())!;
    expect(def).toMatchObject({ slug: 'tambo-outlets', template: 'cartas', is_default: true, position: 0, active: true });
    expect(typeof def.is_default).toBe('boolean');
    for (const t of ['buttons', 'socials', 'clicks']) expect(await columnDefault(db, t), t).toContain(def.id);
    // Inserción sin landing_id (como el código anterior): queda en la landing por defecto.
    const [old] = await db.query(`insert into buttons (client_id, label, url) values ('intursa', 'Vieja', 'https://x.com') returning landing_id`);
    expect(old!.landing_id).toBe(def.id);
    await db.query(`delete from buttons where label = 'Vieja'`);

    const exp = await repo.createLanding({ slug: 'exp', name: 'Exp', hotel: 'H', template: 'experiencias' });
    const app = createApp();
    const b = await runWithLanding(exp, () => repo.createButton({ label: 'Tour', kind: 'link', url: 'https://example.com/tour', active: true }));
    await request(app).get(`/go/${b.id}`).set('User-Agent', 'Mozilla/5.0 (iPhone) Mobile');
    const statsExp = await runWithLanding(exp, () => repo.getStats(30));
    expect([statsExp.total, statsExp.allTime, statsExp.socials.total]).toEqual([1, 1, 0]);
    expect(statsExp.ranking).toEqual([{ id: b.id, label: 'Tour', active: true, deleted: false, clicks: 1 }]);
    expect(await runWithLanding(exp, () => repo.clicksForCsv(30))).toEqual([expect.objectContaining({ label: 'Tour', clicks: 1, source: 'button' })]);
    expect((await repo.getStats(30)).total).toBe(2); // la por defecto no cambia
    expect((await runWithLanding(exp, () => repo.getSettings())).color_fondo).toBe('#2b2b2b');
    const page = await request(app).get('/exp');
    expect(page.status).toBe(200);
    expect(page.text).toContain(`href="/go/${b.id}"`);
    expect((await repo.listLandings()).map((l) => l.slug)).toEqual(['exp', 'tambo-outlets']);
    expect(await runWithLanding(exp, () => repo.resetClicks())).toBe(1);
    expect((await repo.getStats(30)).total).toBe(2);
  });
});

describe('conector postgres.js: migración desde el esquema anterior', () => {
  const OLD_PORT = 54330;
  let oldServer: PGLiteSocketServer;
  let oldPg: PGlite;
  let oldDb: Db;

  beforeAll(async () => {
    oldPg = new PGlite();
    await oldPg.waitReady;
    oldServer = new PGLiteSocketServer({ db: oldPg, port: OLD_PORT, host: '127.0.0.1' });
    await oldServer.start();
    oldDb = await openPostgres(`postgres://postgres:postgres@127.0.0.1:${OLD_PORT}/postgres`);
    setDb(oldDb);
  }, 60_000);

  afterAll(async () => {
    await oldDb?.close();
    await oldServer?.stop();
    await oldPg?.close();
    setDb(db);
  });

  it('migra una base con datos, es idempotente y el código anterior sigue funcionando', async () => {
    const { hawa } = await createOldDatabase(oldDb);
    await applySchema();
    const once = await snapshot(oldDb);
    await applySchema();
    expect(await snapshot(oldDb)).toEqual(once);

    const def = (await repo.getDefaultLanding())!;
    expect(def).toMatchObject({ slug: 'principal', name: 'Tambo del Inka – Outlets', is_default: true });
    expect((await oldDb.query('select landing_id from buttons where id = $1', [hawa]))[0]!.landing_id).toBe(def.id);
    expect(await oldDb.query('select count(*)::int as n from clicks where landing_id = $1', [def.id])).toEqual([{ n: 5 }]);
    expect((await repo.getSettings()).color_boton_hover).toBe('#26615f');
    await oldCode.recordClick(oldDb, hawa, 'Hawa');
    expect((await repo.getStats(30)).ranking.find((r) => r.label === 'Hawa')!.clicks).toBe(3);

    await seed(quiet);
    expect((await repo.getDefaultLanding())!).toMatchObject({ id: def.id, slug: 'tambo-outlets', hotel: 'Tambo del Inka' });
    expect(await repo.listButtons()).toHaveLength(2); // no se recargó el contenido
  });
});
