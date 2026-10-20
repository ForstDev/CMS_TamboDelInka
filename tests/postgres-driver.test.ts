// Verifica el conector de producción (postgres.js, el mismo que usa Supabase) contra un Postgres
// real por red: PGlite expuesto con el protocolo de Postgres en un puerto local.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { openPostgres, setDb, type Db } from '../src/db.js';
import { setStorage } from '../src/storage.js';
import { applySchema, seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import * as repo from '../src/repo.js';

const PORT = 54329;
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
  await seed({ log: () => {} });
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

  it('reordena y guarda ajustes en lote', async () => {
    const ids = (await repo.listButtons()).map((b) => b.id).reverse();
    await repo.reorderButtons(ids);
    expect((await repo.listButtons()).map((b) => b.id)).toEqual(ids);
    await repo.saveSettings({ redes_titulo: 'Síguenos', color_fondo: '#000000' });
    expect((await repo.getSettings()).color_fondo).toBe('#000000');
  });
});
