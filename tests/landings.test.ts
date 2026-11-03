// Varias landings: migración desde el esquema anterior, compatibilidad con el código anterior,
// aislamiento entre landings, rutas /:slug, plantillas, validación y seed por landing.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { getDb, openPglite, setDb, type Db } from '../src/db.js';
import { setStorage, type Storage } from '../src/storage.js';
import { applySchema, seed, type ClientConfig } from '../src/seed.js';
import { createApp } from '../src/app.js';
import * as repo from '../src/repo.js';
import { runWithLanding, type Landing } from '../src/context.js';
import { renderPage } from '../src/render.js';
import { DEFAULT_SETTINGS, defaultSettingsFor, settingsPatch, settingsSchema } from '../src/validation.js';
import { columnDefault, createOldDatabase, oldCode, snapshot } from './fixtures/old-schema.js';
import { CARTAS_BUTTONS, CARTAS_SETTINGS, CARTAS_SOCIALS, CARTAS_VARIANTS } from './fixtures/cartas-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const stored = new Map<string, Buffer>();
const memoryStorage: Storage = {
  mode: 'local',
  async createUploadTarget(p) {
    return { uploadUrl: `/api/cms/uploads/local?path=${encodeURIComponent(p)}`, path: p, publicUrl: `/uploads/${p}` };
  },
  async put(p, data) {
    stored.set(p, data);
    return `/uploads/${p}`;
  },
  async remove(p) {
    stored.delete(p);
  },
  publicUrl: (p) => `/uploads/${p}`,
};

beforeAll(() => setStorage(memoryStorage));

// Configuración fija de prueba (solo la landing por defecto), con los archivos de clients/intursa/seed/.
const FIXED_SOURCE = {
  config: JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'client-default-only.json'), 'utf8')) as ClientConfig,
  dir: path.join(here, '..', 'clients', 'intursa'),
};
const quiet = { log: () => {}, source: FIXED_SOURCE };

// ---------------------------------------------------------------------------------------------

describe('migración a varias landings', () => {
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

  it('base antigua con datos: conserva ids, asocia todo a la landing por defecto y es idempotente', async () => {
    const d = await freshDb();
    await createOldDatabase(d);
    const settingsBefore = await d.query('select * from settings order by key');
    const buttonsBefore = await d.query('select * from buttons order by id');
    const socialsBefore = await d.query('select * from socials order by id');
    const clicksBefore = await d.query('select * from clicks order by id');

    await applySchema();
    const once = await snapshot(d);
    await applySchema();
    await applySchema();
    expect(await snapshot(d)).toEqual(once); // ni datos ni estructura cambian al reaplicar

    const landings = await d.query('select * from landings');
    expect(landings).toHaveLength(1);
    expect(landings[0]).toMatchObject({ client_id: 'intursa', slug: 'principal', name: 'Tambo del Inka – Outlets', hotel: '', template: 'cartas', is_default: true, active: true });
    const def = landings[0]!.id as string;

    const strip = (rows: any[]) => rows.map(({ landing_id: _l, ...r }) => r);
    const buttons = await d.query('select * from buttons order by id');
    expect(strip(buttons)).toEqual(buttonsBefore); // mismos ids (los /go/<id> publicados siguen valiendo)
    expect(buttons.every((b) => b.landing_id === def)).toBe(true);
    const socials = await d.query('select * from socials order by id');
    expect(strip(socials)).toEqual(socialsBefore);
    expect(socials.every((s) => s.landing_id === def)).toBe(true);
    const clicks = await d.query('select * from clicks order by id');
    expect(strip(clicks)).toEqual(clicksBefore);
    expect(clicks.every((c) => c.landing_id === def)).toBe(true);

    // settings intacta; landing_settings = copia para la landing por defecto.
    expect(await d.query('select * from settings order by key')).toEqual(settingsBefore);
    expect(await d.query('select key, value from landing_settings where landing_id = $1 order by key', [def])).toEqual(
      settingsBefore.map((s) => ({ key: s.key, value: s.value })),
    );

    // DEFAULT de columna = landing por defecto; botones y redes NOT NULL, clics no.
    for (const t of ['buttons', 'socials', 'clicks']) expect(await columnDefault(d, t), t).toContain(def);
    const nullable = await d.query(
      `select table_name, is_nullable from information_schema.columns where column_name = 'landing_id' and table_name in ('buttons','socials','clicks') order by table_name`,
    );
    expect(nullable.map((r) => [r.table_name, r.is_nullable])).toEqual([['buttons', 'NO'], ['clicks', 'YES'], ['socials', 'NO']]);

    // El código nuevo (sin contexto = landing por defecto) ve los datos de siempre.
    const s = await repo.getStats(30);
    expect([s.total, s.allTime, s.socials.total]).toEqual([4, 4, 1]);
    expect(s.ranking.map((r) => [r.label, r.clicks])).toEqual([['Hawa', 2], ['Kiri Bar', 1], ['Carta borrada', 1]]);
    const settings = await repo.getSettings();
    expect(settings).toMatchObject({ cms_nombre: 'Tambo del Inka – Outlets', color_boton_hover: '#26615f', logo_ancho: '260', logo_posicion: 'center' });
  });

  it('el código anterior sigue funcionando con el esquema nuevo (ventana entre setup y push)', async () => {
    const d = await freshDb();
    await createOldDatabase(d);
    await applySchema();
    const def = (await repo.getDefaultLanding())!.id;

    const b = await oldCode.createButton(d, 'Nueva', 'https://example.com/nueva');
    const s = await oldCode.createSocial(d, 'instagram', 'https://instagram.com/x');
    await oldCode.recordClick(d, b, 'Nueva');
    await oldCode.recordSocialClick(d, s, 'Instagram');
    await oldCode.saveSetting(d, 'redes_titulo', 'Síguenos ya'); // on conflict (client_id, key) sigue valiendo

    expect((await d.query('select landing_id from buttons where id = $1', [b]))[0]!.landing_id).toBe(def);
    expect((await d.query('select landing_id from socials where id = $1', [s]))[0]!.landing_id).toBe(def);
    const last = await d.query('select landing_id from clicks order by id desc limit 2');
    expect(last.every((c) => c.landing_id === def)).toBe(true);
    expect((await oldCode.listButtons(d)).map((r) => r.label)).toEqual(['Hawa', 'Kiri Bar', 'Nueva']);
    expect((await oldCode.getSettings(d)).find((r) => r.key === 'redes_titulo')!.value).toBe('Síguenos ya');

    // Y el código nuevo los ve en la landing por defecto.
    expect((await repo.listButtons()).map((x) => x.label)).toEqual(['Hawa', 'Kiri Bar', 'Nueva']);
    const stats = await repo.getStats(30);
    expect(stats.total).toBe(5);
    expect(stats.socials.total).toBe(2);
  });

  it('base ya migrada: el seed completa la landing provisional y reaplicar no mueve nada', async () => {
    const d = await freshDb();
    await createOldDatabase(d);
    await applySchema();
    const provisional = (await repo.getDefaultLanding())!;
    const before = { buttons: await d.query('select * from buttons order by id'), ls: await d.query('select * from landing_settings order by key') };

    expect(await seed(quiet)).toBe(false); // no carga nada: ya hay datos
    const def = (await repo.getDefaultLanding())!;
    expect(def).toEqual({ ...provisional, slug: 'tambo-outlets', name: 'Tambo del Inka – Outlets', hotel: 'Tambo del Inka', template: 'cartas', position: 0 });
    expect(await d.query('select * from buttons order by id')).toEqual(before.buttons);
    expect(await d.query('select * from landing_settings order by key')).toEqual(before.ls);
    expect((await d.query('select password_hash from admins'))[0]!.password_hash).toBe('x'); // el usuario no se toca

    // Una landing que se borra deja sus clics sin landing; reaplicar el esquema no los mueve.
    const other = await repo.createLanding({ slug: 'otra', name: 'Otra', template: 'experiencias' });
    const ob = await runWithLanding(other, () => repo.createButton({ label: 'X', kind: 'link', url: 'https://x.com', active: true }));
    await repo.recordClick(ob, 'mobile');
    await d.query('delete from landings where id = $1', [other.id]);
    expect(await d.query('select button_id, landing_id from clicks where button_label = $1', ['X'])).toEqual([{ button_id: null, landing_id: null }]);

    const snap = await snapshot(d);
    await applySchema();
    await applySchema();
    expect(await snapshot(d)).toEqual(snap);
  });

  it('instalación nueva: esquema dos veces, seed y esquema otra vez sin cambios', async () => {
    const d = await freshDb();
    await applySchema();
    await applySchema();
    expect(await d.query('select * from landings')).toEqual([]);
    expect(await columnDefault(d, 'buttons')).toBeNull();

    expect(await seed(quiet)).toBe(true);
    const def = (await repo.getDefaultLanding())!;
    expect(def).toMatchObject({ slug: 'tambo-outlets', name: 'Tambo del Inka – Outlets', hotel: 'Tambo del Inka', template: 'cartas', is_default: true });
    expect(await repo.listButtons()).toHaveLength(9);
    for (const t of ['buttons', 'socials', 'clicks']) expect(await columnDefault(d, t), t).toContain(def.id);

    const snap = await snapshot(d);
    await applySchema();
    await applySchema();
    expect(await snapshot(d)).toEqual(snap);
    expect(await seed(quiet)).toBe(false);
    expect(await snapshot(d)).toEqual(snap);
  });

  it('una sola landing por defecto por cliente y slug único', async () => {
    const d = await freshDb();
    await applySchema();
    await repo.createLanding({ slug: 'a', name: 'A', template: 'cartas', is_default: true });
    await expect(repo.createLanding({ slug: 'b', name: 'B', template: 'cartas', is_default: true })).rejects.toThrow();
    await expect(repo.createLanding({ slug: 'a', name: 'A2', template: 'cartas' })).rejects.toThrow();
    await expect(d.query(`insert into landings (client_id, slug, name, template) values ('intursa', 'c', 'C', 'otra')`)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

describe('varias landings: API, rutas y aislamiento', () => {
  let app: Express;
  let agent: ReturnType<typeof request.agent>;
  let A: Landing; // por defecto (Tambo Outlets)
  let B: Landing; // experiencias
  let foreignId = '';
  let bButton = '';
  let bSocial = '';

  const asB = (r: request.Test) => r.set('X-Landing-Id', B.id);

  beforeAll(async () => {
    setDb(await openPglite());
    await applySchema();
    await seed(quiet);
    A = (await repo.getDefaultLanding())!;
    B = await repo.createLanding({ slug: 'exp-demo', name: 'Experiencias demo', hotel: 'Otro hotel', template: 'experiencias' });
    await repo.createLanding({ slug: 'inactiva', name: 'Inactiva', hotel: 'Otro hotel', template: 'cartas', position: 1, active: false });
    const db = await getDb();
    // Slug reservado metido a mano (saltándose la validación) y una landing de otro cliente.
    await db.query(`insert into landings (client_id, slug, name, hotel, template) values ('intursa', 'admin', 'Admin', 'Zeta', 'cartas')`);
    foreignId = (await db.query(`insert into landings (client_id, slug, name, template) values ('otro', 'x', 'X', 'cartas') returning id`))[0]!.id;
    app = createApp();
    agent = request.agent(app);
    expect((await agent.post('/api/login').send({ username: 'TambodelInka', password: 'TambodelInka2026' })).status).toBe(200);
  }, 60_000);

  it('/api/cms/landings lista las landings del cliente con su dirección', async () => {
    expect((await request(app).get('/api/cms/landings')).status).toBe(401);
    const res = await agent.get('/api/cms/landings');
    expect(res.status).toBe(200);
    expect(res.body.landings.map((l: any) => [l.hotel, l.slug, l.url, l.is_default, l.active])).toEqual([
      ['Otro hotel', 'exp-demo', '/exp-demo', false, true],
      ['Otro hotel', 'inactiva', '/inactiva', false, false],
      ['Tambo del Inka', 'tambo-outlets', '/', true, true],
      ['Zeta', 'admin', '/admin', false, true],
    ]);
    expect(Object.keys(res.body.landings[0]).sort()).toEqual(['active', 'hotel', 'id', 'is_default', 'name', 'slug', 'template', 'url']);
  });

  it('state.landing y defaults según la plantilla; X-Landing-Id o ?landing=', async () => {
    const a = (await agent.get('/api/cms/state')).body;
    expect(a.landing).toEqual({ id: A.id, slug: 'tambo-outlets', name: 'Tambo del Inka – Outlets', hotel: 'Tambo del Inka', template: 'cartas', is_default: true, url: '/' });
    expect(a.defaults).toEqual(defaultSettingsFor('cartas'));
    expect(a.buttons).toHaveLength(9);

    const b = (await asB(agent.get('/api/cms/state'))).body;
    expect(b.landing).toEqual({ id: B.id, slug: 'exp-demo', name: 'Experiencias demo', hotel: 'Otro hotel', template: 'experiencias', is_default: false, url: '/exp-demo' });
    expect(b.defaults).toEqual(defaultSettingsFor('experiencias'));
    expect(b.settings).toEqual(defaultSettingsFor('experiencias'));
    expect([b.buttons, b.socials]).toEqual([[], []]);
    expect((await agent.get(`/api/cms/state?landing=${B.id}`)).body.landing.id).toBe(B.id);

    for (const bad of ['abc', '00000000-0000-0000-0000-000000000000', foreignId]) {
      const r1 = await agent.get('/api/cms/state').set('X-Landing-Id', bad);
      expect(r1.status, bad).toBe(404);
      expect(r1.body).toEqual({ error: 'Landing no encontrada.' });
      expect((await agent.get(`/api/cms/state?landing=${bad}`)).status, bad).toBe(404);
      expect((await agent.patch('/api/cms/settings').set('X-Landing-Id', bad).send({ redes_titulo: 'x' })).status, bad).toBe(404);
    }
  });

  it('ajustes, botones y redes no se cruzan entre landings', async () => {
    const r = await asB(agent.patch('/api/cms/settings')).send({ titulo_linea1: 'Hola mundo', color_fondo: '#000000', logo_posicion: 'left' });
    expect(r.status).toBe(200);
    expect(r.body.settings).toMatchObject({ titulo_linea1: 'Hola mundo', color_fondo: '#000000', color_boton: '#262626' });
    const a = (await agent.get('/api/cms/state')).body;
    expect(a.settings).toMatchObject({ color_fondo: '#ffffff', titulo_linea1: 'Experiences', logo_posicion: 'center' });

    bButton = (await asB(agent.post('/api/cms/buttons')).send({ label: 'Tour al valle' })).body.button.id;
    expect((await asB(agent.patch(`/api/cms/buttons/${bButton}`)).send({ kind: 'link', url: 'https://example.com/tour', active: true })).status).toBe(200);
    bSocial = (await asB(agent.post('/api/cms/socials')).send({ network: 'instagram', url: 'https://instagram.com/exp' })).body.social.id;
    const b = (await asB(agent.get('/api/cms/state'))).body;
    expect(b.buttons.map((x: any) => [x.label, x.position])).toEqual([['Tour al valle', 0]]);
    expect(b.socials.map((x: any) => x.network)).toEqual(['instagram']);
    expect(a.buttons).toHaveLength(9);
    expect(a.socials.map((x: any) => x.network)).toEqual(['facebook', 'instagram']);

    // Con el id de un botón o red de otra landing: 404 y nada cambia.
    const aButton = a.buttons[0];
    const aSocial = a.socials[0];
    expect((await asB(agent.patch(`/api/cms/buttons/${aButton.id}`)).send({ label: 'Hackeado' })).status).toBe(404);
    expect((await asB(agent.delete(`/api/cms/buttons/${aButton.id}`))).status).toBe(404);
    expect((await asB(agent.patch(`/api/cms/socials/${aSocial.id}`)).send({ url: 'https://evil.com' })).status).toBe(404);
    expect((await asB(agent.delete(`/api/cms/socials/${aSocial.id}`))).status).toBe(404);
    expect((await agent.patch(`/api/cms/buttons/${bButton}`).send({ label: 'Hackeado' })).status).toBe(404);
    expect((await agent.delete(`/api/cms/socials/${bSocial}`)).status).toBe(404);
    const ids = a.buttons.map((x: any) => x.id).reverse();
    await asB(agent.put('/api/cms/buttons/order')).send({ ids });
    const a2 = (await agent.get('/api/cms/state')).body;
    expect(a2.buttons).toEqual(a.buttons);
    expect(a2.socials).toEqual(a.socials);

    // Validación estricta de las claves nuevas también en la API.
    for (const body of [{ logo_ancho: '999' }, { logo_posicion: 'x' }, { fondo_foco_x: '50%; }' }, { fondo_oscurecer: '1.5' }]) {
      expect((await asB(agent.patch('/api/cms/settings')).send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('GET /:slug: existe, inexistente, inactiva, reservada y slug inválido', async () => {
    const res = await request(app).get('/exp-demo');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('<span class="t1">Hola mundo</span><span class="t2">Experiencias</span>');
    expect(res.text).toContain(`<a class="boton" href="/go/${bButton}">Tour al valle</a>`);
    expect(res.text).toContain('<span class="redes-texto">Síguenos en / Follow us on</span>');
    expect(res.text).toContain(`href="/go/social/${bSocial}" aria-label="Instagram" target="_blank" rel="noopener"`);
    expect(res.text).toContain('align-items: flex-start;');
    expect(res.text).not.toContain('Hawa');
    expect(res.text).not.toContain('{{');

    expect((await request(app).get('/tambo-outlets')).text).toContain('>Hawa</a>'); // la por defecto también por su slug
    expect((await request(app).get('/exp-demo/')).status).toBe(200);

    for (const url of ['/no-existe', '/inactiva', '/admin', '/go', '/pdf', '/Exp-Demo', '/exp--demo', '/exp_demo', `/${'a'.repeat(81)}`, '/favicon.ico']) {
      const r = await request(app).get(url);
      expect(r.status, url).toBe(404);
      expect(r.text, url).toContain('Página no encontrada');
    }
    expect((await request(app).get('/api')).body).toEqual({ error: 'No encontrado.' });
  });

  it('GET / sigue siendo la landing por defecto, sin datos de las demás', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const links = [...res.text.matchAll(/<a class="boton" href="\/go\/([0-9a-f-]{36})">([^<]+)<\/a>/g)].map((m) => m[2]);
    expect(links).toHaveLength(9);
    expect(links[0]).toBe('Desayuno Breakfast');
    expect(res.text).not.toContain('Tour al valle');
    expect(res.text).not.toContain('class="titulo"');
    expect(res.text).toContain('max-width: 260px;');
    expect(res.text).toMatch(/background: var\(--fondo\) url\("[^"]+"\) center \/ cover no-repeat fixed;/);
  });

  it('tracking, estadísticas, CSV y borrar clics por landing', async () => {
    const a = (await agent.get('/api/cms/state')).body;
    const hawa = a.buttons.find((x: any) => x.label === 'Hawa');
    const fbA = a.socials.find((x: any) => x.network === 'facebook');

    const r = await request(app).get(`/go/${bButton}`).set('User-Agent', IPHONE);
    expect([r.status, r.headers.location]).toEqual([302, 'https://example.com/tour']);
    await request(app).get(`/go/social/${bSocial}`).set('User-Agent', DESKTOP);
    await request(app).get(`/go/${hawa.id}`).set('User-Agent', DESKTOP);
    expect((await request(app).get(`/go/social/${fbA.id}`).set('User-Agent', DESKTOP)).headers.location).toBe('https://www.facebook.com/TamboDelInka/');

    const db = await getDb();
    const rows = await db.query('select button_label, landing_id from clicks order by id');
    expect(rows.map((x) => [x.button_label, x.landing_id])).toEqual([
      ['Tour al valle', B.id],
      ['Instagram', B.id],
      ['Hawa', A.id],
      ['Facebook', A.id],
    ]);

    const sB = (await asB(agent.get('/api/cms/stats?days=30'))).body;
    expect([sB.total, sB.socials.total]).toEqual([1, 1]);
    expect(sB.ranking).toEqual([{ id: bButton, label: 'Tour al valle', active: true, deleted: false, clicks: 1 }]);
    const sA = (await agent.get('/api/cms/stats?days=30')).body;
    expect([sA.total, sA.socials.total]).toEqual([1, 1]);
    expect(sA.ranking.some((x: any) => x.label === 'Tour al valle')).toBe(false);
    expect(sA.ranking.find((x: any) => x.label === 'Hawa').clicks).toBe(1);

    const csvB = await agent.get(`/api/cms/stats.csv?days=30&landing=${B.id}`);
    expect(csvB.headers['content-disposition']).toContain('clics-intursa-exp-demo-30dias.csv');
    expect(csvB.text).toContain('"Tour al valle",Celular,1,Carta');
    expect(csvB.text).toContain('"Instagram",Computadora,1,Red');
    expect(csvB.text).not.toContain('Hawa');
    const csvA = await agent.get('/api/cms/stats.csv?days=30');
    expect(csvA.headers['content-disposition']).toContain('clics-intursa-30dias.csv');
    expect(csvA.text).toContain('"Hawa",Computadora,1,Carta');
    expect(csvA.text).not.toContain('Tour al valle');

    expect((await asB(agent.delete('/api/cms/clicks')).send({ confirm: 'BORRAR' })).body.deleted).toBe(2);
    expect((await asB(agent.get('/api/cms/stats'))).body.total).toBe(0);
    const sA2 = (await agent.get('/api/cms/stats')).body;
    expect([sA2.total, sA2.socials.total]).toEqual([1, 1]);
  });

  it('subidas en la carpeta de la landing; la ruta local no sale de la carpeta del cliente', async () => {
    const body = { purpose: 'logo', fileName: 'Logo Exp.png', contentType: 'image/png', size: 100 };
    const tB = (await asB(agent.post('/api/cms/uploads')).send(body)).body;
    expect(tB.path).toMatch(/^intursa\/exp-demo\/logo\/[a-z0-9]+-Logo-Exp\.png$/);
    expect((await agent.put(tB.uploadUrl).set('Content-Type', 'image/png').send(Buffer.from('png'))).status).toBe(200);
    expect(stored.has(tB.path)).toBe(true);
    const tA = (await agent.post('/api/cms/uploads').send(body)).body;
    expect(tA.path).toMatch(/^intursa\/logo\/[a-z0-9]+-Logo-Exp\.png$/);

    for (const p of [
      '../../src/app.ts',
      'intursa/../src/logo/a-b.png',
      'intursa/exp-demo/../../x/logo/a-b.png',
      'intursa/a/b/logo/a-b.png',
      'otro/logo/a-b.png',
      'intursa/Exp/logo/a-b.png',
      'intursa/exp-demo/otro/a-b.png',
    ]) {
      const res = await agent.put(`/api/cms/uploads/local?path=${encodeURIComponent(p)}`).set('Content-Type', 'image/png').send(Buffer.from('x'));
      expect(res.status, p).toBe(400);
    }
  });

  it('la vista previa usa la plantilla de la landing y no cuenta clics', async () => {
    const res = await agent.get(`/api/cms/preview?landing=${B.id}`);
    expect(res.text).toContain('class="titulo"');
    expect(res.text).toContain('href="https://example.com/tour"');
    expect(res.text).toContain('<base target="_blank">');
    expect(res.text).not.toContain('/go/');
  });
});

// ---------------------------------------------------------------------------------------------

describe('plantillas', () => {
  const norm = (s: string) => s.replace(/\r\n/g, '\n');
  const fixture = (name: string) => norm(fs.readFileSync(path.join(here, 'fixtures', `cartas-${name}.html`), 'utf8'));
  // Única diferencia con el HTML anterior: la propiedad equivalente align-self: center en .logo
  // (.pagina ya centra a sus hijos con align-items: center).
  const OLD_LOGO = '  .logo {\n    text-align: center;';
  const NEW_LOGO = '  .logo {\n    align-self: center;\n    text-align: center;';

  it('"cartas" con los ajustes por defecto produce el mismo HTML que antes (salvo align-self: center)', () => {
    for (const [name, v] of Object.entries(CARTAS_VARIANTS)) {
      const before = fixture(name);
      expect(before, name).toContain(OLD_LOGO);
      const expected = before.replace(OLD_LOGO, NEW_LOGO);
      const socials = 'noSocials' in v ? [] : CARTAS_SOCIALS;
      const page = (settings: any, landing?: any) =>
        norm(renderPage({ settings, buttons: CARTAS_BUTTONS as any, socials: socials as any, landing }, v.opts as any));
      // Con todos los valores por defecto nuevos explícitos…
      expect(page({ ...defaultSettingsFor('cartas'), ...CARTAS_SETTINGS, ...v.patch }, { template: 'cartas' }), name).toBe(expected);
      // …y con los ajustes de antes (sin claves nuevas) y sin landing.
      expect(page({ ...CARTAS_SETTINGS, ...v.patch }), name).toBe(expected);
    }
  });

  it('"cartas": ancho, posición del logo y encuadre del fondo configurables', () => {
    const html = (patch: object) =>
      renderPage({ settings: { ...defaultSettingsFor('cartas'), ...CARTAS_SETTINGS, ...patch } as any, buttons: [], socials: [], landing: { template: 'cartas' } });
    const left = html({ logo_ancho: '180', logo_posicion: 'left', fondo_foco_x: '30', fondo_foco_y: '70' });
    expect(left).toContain('max-width: 180px;');
    expect(left).toContain('align-self: flex-start;');
    expect(left).toContain('text-align: left;');
    expect(left).toContain('margin: 0 auto 0 0;');
    expect(left).toContain('url("/uploads/intursa/fondo/mabc123-fondo_intursa.jpg") 30% 70% / cover no-repeat fixed;');
    const right = html({ logo_posicion: 'right', fondo_foco_x: '50', fondo_foco_y: '0' });
    expect(right).toContain('align-self: flex-end;');
    expect(right).toContain('margin: 0 0 0 auto;');
    expect(right).toContain(' 50% 0% / cover');
    // Valores fuera de rango que llegaran a la base se acotan al renderizar (defensa extra).
    expect(html({ logo_ancho: '9999', fondo_foco_x: 'x; }' })).toContain('max-width: 260px;');
  });

  it('"experiencias" mínima: títulos, botones /go/<id>, redes y oscurecido', () => {
    const settings = { ...defaultSettingsFor('experiencias'), logo_url: '/uploads/l.png', fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg', titulo_linea1: 'Viví <Cusco>' };
    const html = renderPage({ settings: settings as any, buttons: CARTAS_BUTTONS as any, socials: CARTAS_SOCIALS as any, landing: { template: 'experiencias' } }, { noindex: true });
    expect(html).toContain('<span class="t1">Viví &lt;Cusco&gt;</span><span class="t2">Experiencias</span>');
    expect(html).toContain('<a class="boton" href="/go/11111111-1111-4111-8111-111111111101">Desayuno Breakfast</a>');
    expect(html).toContain('<a class="boton" href="/go/11111111-1111-4111-8111-111111111103" target="_blank" rel="noopener">');
    expect(html).not.toContain('Oculto');
    expect(html).not.toContain('Sin destino');
    expect(html).toContain('<span class="redes-texto">Síguenos en / Follow us on</span>');
    expect(html).toContain('href="/go/social/22222222-2222-4222-8222-222222222201" aria-label="Facebook"');
    expect(html).toContain('href="mailto:reservas@ejemplo.com" aria-label="Correo"');
    expect(html).toContain('--oscurecer: 0.85;');
    expect(html).toContain('.hero::before');
    expect(html).toContain('--logo-w: 150px;');
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).not.toContain('class="novedades"'); // novedades_activo '0' por defecto
    expect(html).not.toContain('{{');

    const sinImagen = renderPage({ settings: defaultSettingsFor('experiencias'), buttons: [], socials: [], landing: { template: 'experiencias' } }, { preview: true });
    expect(sinImagen).toContain('<base target="_blank">');
  });
});

// ---------------------------------------------------------------------------------------------

describe('validación de los ajustes nuevos', () => {
  it('rechaza valores fuera de rango o que podrían inyectar CSS', () => {
    const bad = [
      { logo_ancho: '999' }, { logo_ancho: '59' }, { logo_ancho: '401' }, { logo_ancho: '060' }, { logo_ancho: '200px' }, { logo_ancho: '' }, { logo_ancho: 200 },
      { logo_posicion: 'x' }, { logo_posicion: 'LEFT' }, { logo_posicion: 'center;}' },
      { fondo_foco_x: '50%; }' }, { fondo_foco_x: '101' }, { fondo_foco_x: '-1' }, { fondo_foco_y: '1e2' }, { fondo_foco_y: '50.5' },
      { fondo_oscurecer: '1.5' }, { fondo_oscurecer: '100%' }, { fondo_oscurecer: '0x10' },
      { titulo_linea1: 'x'.repeat(61) }, { titulo_linea2: 'x'.repeat(61) },
    ];
    for (const body of bad) expect(settingsPatch.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });

  it('acepta los valores válidos de los extremos', () => {
    const good = [
      { logo_ancho: '60' }, { logo_ancho: '400' }, { logo_ancho: ' 150 ' },
      { logo_posicion: 'left' }, { logo_posicion: 'center' }, { logo_posicion: 'right' },
      { fondo_foco_x: '0', fondo_foco_y: '100' }, { fondo_oscurecer: '0' }, { fondo_oscurecer: '100' },
      { titulo_linea1: 'x'.repeat(60), titulo_linea2: '' },
    ];
    for (const body of good) expect(settingsPatch.safeParse(body).success, JSON.stringify(body)).toBe(true);
  });

  it('valores por defecto por plantilla', () => {
    expect(defaultSettingsFor('cartas')).toEqual({ ...DEFAULT_SETTINGS, logo_ancho: '260' });
    expect(defaultSettingsFor('cartas')).toMatchObject({ logo_posicion: 'center', fondo_foco_x: '50', fondo_foco_y: '50', fondo_oscurecer: '85' });
    expect(defaultSettingsFor('experiencias')).toMatchObject({
      logo_ancho: '150', logo_posicion: 'center', fondo_foco_x: '50', fondo_foco_y: '50', fondo_oscurecer: '85',
      titulo_linea1: 'Experiences', titulo_linea2: 'Experiencias',
      color_fondo: '#2b2b2b', color_texto: '#ffffff', color_boton: '#262626', color_boton_texto: '#ffffff',
      color_boton_hover: '#3a3a3a', color_texto_boton_hover: '#ffffff', redes_titulo: 'Síguenos en / Follow us on', novedades_activo: '0',
    });
    for (const t of ['cartas', 'experiencias'] as const) expect(settingsSchema.safeParse(defaultSettingsFor(t)).success, t).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

describe('seed por landing', () => {
  let dir = '';
  let config: ClientConfig;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cms-seed-'));
    const put = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, 'seed', rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, 'seed', rel), text);
    };
    put('logo.png', 'logo');
    put('pdf/carta.pdf', '%PDF carta');
    put('exp-uno/logo.png', 'logo exp');
    put('exp-uno/fondo.jpg', 'fondo exp');
    put('exp-uno/pdf/tour.pdf', '%PDF tour');
    put('exp-dos/pdf/otro.pdf', '%PDF otro');
    config = {
      id: 'intursa',
      name: 'Cliente de prueba',
      admin: { username: 'admin-prueba', password: 'ClaveDePrueba2026' },
      landings: [
        {
          slug: 'principal-prueba', name: 'Principal', hotel: 'H1', template: 'cartas', is_default: true,
          settings: { redes_titulo: 'R1' }, assets: { logo: 'logo.png' },
          buttons: [{ label: 'Carta', pdf: 'carta.pdf' }, { label: 'Web', url: 'https://example.com' }],
          socials: [{ network: 'facebook', url: 'https://facebook.com/a' }],
        },
        {
          slug: 'exp-uno', name: 'Experiencias Uno', hotel: 'H1', template: 'experiencias', position: 1,
          settings: { titulo_linea1: 'Uno' }, assets: { logo: 'logo.png', fondo: 'fondo.jpg' },
          buttons: [{ label: 'Tour', pdf: 'tour.pdf' }], socials: [],
        },
      ],
    };
    setDb(await openPglite());
    await applySchema();
  }, 60_000);

  const contentOf = async (l: Landing) =>
    runWithLanding(l, async () => ({ settings: await repo.getSettings(), buttons: await repo.listButtons(), socials: await repo.listSocials() }));

  it('crea cada landing con sus ajustes, archivos en su carpeta, botones y redes', async () => {
    expect(await seed({ ...quiet, source: { config, dir } })).toBe(true);
    const def = (await repo.getDefaultLanding())!;
    const exp = (await repo.getLandingBySlug('exp-uno'))!;
    expect(def).toMatchObject({ slug: 'principal-prueba', template: 'cartas', is_default: true, position: 0 });
    expect(exp).toMatchObject({ name: 'Experiencias Uno', hotel: 'H1', template: 'experiencias', is_default: false, position: 1 });

    const d = await contentOf(def);
    expect(d.settings).toMatchObject({ cms_nombre: 'Cliente de prueba', redes_titulo: 'R1', logo_ancho: '260' });
    expect(d.settings.logo_url).toMatch(/^\/uploads\/intursa\/logo\/[a-z0-9]+-logo\.png$/);
    expect(d.buttons.map((b) => [b.label, b.kind, b.active])).toEqual([['Carta', 'pdf', true], ['Web', 'link', true]]);
    expect(d.buttons[0]!.file_path).toMatch(/^intursa\/pdf\/[a-z0-9]+-carta\.pdf$/);

    const e = await contentOf(exp);
    expect(e.settings).toMatchObject({ cms_nombre: 'Experiencias Uno', titulo_linea1: 'Uno', color_fondo: '#2b2b2b', logo_ancho: '150', fondo_tipo: 'imagen' });
    expect(e.settings.logo_url).toMatch(/^\/uploads\/intursa\/exp-uno\/logo\/[a-z0-9]+-logo\.png$/);
    expect(e.settings.fondo_imagen_url).toMatch(/^\/uploads\/intursa\/exp-uno\/fondo\/[a-z0-9]+-fondo\.jpg$/);
    expect(e.buttons[0]!.file_path).toMatch(/^intursa\/exp-uno\/pdf\/[a-z0-9]+-tour\.pdf$/);
    expect(stored.get(e.buttons[0]!.file_path)!.toString()).toBe('%PDF tour');
    expect(e.socials).toEqual([]);
    expect(await repo.findAdmin('admin-prueba')).not.toBeNull();
  });

  it('es idempotente: volver a ejecutarlo no cambia nada; una landing nueva se agrega sola', async () => {
    const db = await getDb();
    const snap = await snapshot(db);
    expect(await seed({ ...quiet, source: { config, dir } })).toBe(false);
    expect(await snapshot(db)).toEqual(snap);

    config.landings!.push({ slug: 'exp-dos', name: 'Experiencias Dos', hotel: 'H2', template: 'experiencias', buttons: [{ label: 'Otro', pdf: 'otro.pdf' }] });
    expect(await seed({ ...quiet, source: { config, dir } })).toBe(true);
    const after = await snapshot(db);
    expect(after.buttons.filter((b) => snap.buttons.some((x) => x.id === b.id))).toEqual(snap.buttons); // los anteriores intactos
    expect(after.buttons).toHaveLength(snap.buttons.length + 1);
    expect((await repo.listLandings()).map((l) => l.slug)).toEqual(['principal-prueba', 'exp-uno', 'exp-dos']);
  });

  it('--force recarga botones, redes y ajustes de las landings; conserva landings, ids y clics', async () => {
    const exp = (await repo.getLandingBySlug('exp-uno'))!;
    const landingsBefore = await repo.listLandings();
    const tour = (await contentOf(exp)).buttons[0]!;
    await runWithLanding(exp, () => repo.saveSettings({ titulo_linea1: 'Cambiado en el panel' }));
    await repo.recordClick(tour, 'mobile');

    expect(await seed({ ...quiet, force: true, source: { config, dir } })).toBe(true);
    expect(await repo.listLandings()).toEqual(landingsBefore);
    const e = await contentOf(exp);
    expect(e.settings.titulo_linea1).toBe('Uno');
    expect(e.buttons.map((b) => b.label)).toEqual(['Tour']);
    expect(e.buttons[0]!.id).not.toBe(tour.id);
    const db = await getDb();
    expect(await db.query('select button_id, landing_id, button_label from clicks')).toEqual([{ button_id: null, landing_id: exp.id, button_label: 'Tour' }]);
    const stats = await runWithLanding(exp, () => repo.getStats(30));
    expect(stats.ranking.find((r) => r.deleted)).toMatchObject({ label: 'Tour', clicks: 1 });
  });

  it('rechaza configuraciones inválidas', async () => {
    const base = { ...config, landings: [] as any[] };
    const l = (extra: object): any => ({ slug: 'a', name: 'A', template: 'cartas', ...extra });
    for (const landings of [
      [l({ is_default: true }), l({ slug: 'b', is_default: true })],
      [l({})],
      [l({ is_default: true, slug: 'cms' })],
      [l({ is_default: true }), l({})],
      [l({ is_default: true, template: 'otra' })],
    ]) {
      await expect(seed({ ...quiet, source: { config: { ...base, landings }, dir } }), JSON.stringify(landings)).rejects.toThrow();
    }
  });
});
