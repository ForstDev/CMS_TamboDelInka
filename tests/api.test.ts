// Pruebas de punta a punta de la API con una base Postgres embebida en memoria (PGlite).

import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openPglite, setDb } from '../src/db.js';
import { setStorage, type Storage } from '../src/storage.js';
import { applySchema, seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const WHATSAPP = 'WhatsApp/2.23.20.0';

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

let app: Express;
let agent: ReturnType<typeof request.agent>;
let buttonIds: string[] = [];

async function stats(days = 30) {
  return (await agent.get(`/api/cms/stats?days=${days}`)).body;
}

beforeAll(async () => {
  setDb(await openPglite());
  setStorage(memoryStorage);
  await applySchema();
  await applySchema(); // idempotente
  await seed({ log: () => {} });
  app = createApp();
  agent = request.agent(app);
}, 60_000);

describe('página pública', () => {
  it('muestra los 9 botones con tracking, logo y novedades', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const links = [...res.text.matchAll(/<a class="boton" href="\/go\/([0-9a-f-]{36})">([^<]+)<\/a>/g)];
    expect(links.map((m) => m[2])).toEqual([
      'Desayuno Breakfast',
      'Hawa',
      'Kiri Bar',
      'Room Service',
      'La Cervecería',
      'Vinos | Wines',
      'Menú de niños | Kids Menu',
      'Kallpa Spa',
      'De nuestro huerto',
    ]);
    buttonIds = links.map((m) => m[1]!);
    expect(res.text).toContain('logo-tdi-blanco.png');
    expect(res.text).toContain('url("/uploads/intursa/fondo/');
    expect(res.text).toContain('https://www.intursa.com.pe/promociones/suscripcion/');
    expect(res.text).not.toContain('{{'); // no quedan marcadores sin reemplazar
    expect(res.text).not.toContain('class="redes"'); // redes sin enlace: sección oculta
  });

  it('cada botón lleva al PDF subido', async () => {
    const res = await request(app).get(`/go/${buttonIds[0]}`).set('User-Agent', DESKTOP);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/uploads\/intursa\/pdf\/[a-z0-9]+-TAMBO_Desayuno-2026-1\.pdf$/);
    expect(stored.has(res.headers.location.replace('/uploads/', ''))).toBe(true);
  });
});

describe('acceso al CMS', () => {
  it('sin sesión /cms redirige a /cms_login y la API responde 401', async () => {
    const r1 = await request(app).get('/cms');
    expect(r1.status).toBe(302);
    expect(r1.headers.location).toBe('/cms_login');
    expect((await request(app).get('/api/cms/state')).status).toBe(401);
    expect((await request(app).patch('/api/cms/settings').send({ redes_titulo: 'x' })).status).toBe(401);
  });

  it('la página de login carga y no se indexa', async () => {
    const res = await request(app).get('/cms_login');
    expect(res.status).toBe(200);
    expect(res.text).toContain('login-form');
    expect(res.headers['x-robots-tag']).toContain('noindex');
  });

  it('rechaza contraseña incorrecta', async () => {
    const res = await request(app).post('/api/login').send({ username: 'TambodelInka', password: 'mala' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrectos/);
  });

  it('rechaza usuario inexistente con el mismo mensaje', async () => {
    const res = await request(app).post('/api/login').send({ username: 'nadie', password: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrectos/);
  });

  it('acepta las credenciales (usuario sin distinguir mayúsculas) y abre el CMS', async () => {
    const res = await agent.post('/api/login').send({ username: 'tambodelinka', password: 'TambodelInka2026' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']?.[0]).toMatch(/cms_session=.*HttpOnly/i);
    const cms = await agent.get('/cms');
    expect(cms.status).toBe(200);
    expect(cms.text).toContain('cms.js?v=');
    expect((await agent.get('/cms_login')).headers.location).toBe('/cms');
  });

  it('bloquea escrituras desde otro origen', async () => {
    const res = await agent.patch('/api/cms/settings').set('Origin', 'https://otro-sitio.com').send({ redes_titulo: 'x' });
    expect(res.status).toBe(403);
  });

  it('una cookie manipulada no sirve', async () => {
    const res = await request(app).get('/api/cms/state').set('Cookie', 'cms_session=eyJhbGciOiJIUzI1NiJ9.e30.firma-falsa');
    expect(res.status).toBe(401);
  });
});

describe('tracking de clics', () => {
  it('cuenta clics de celular, tablet y computadora; ignora bots, vistas previas y precargas', async () => {
    const id = buttonIds[1]!; // Hawa
    await request(app).get(`/go/${id}`).set('User-Agent', IPHONE);
    await request(app).get(`/go/${id}`).set('User-Agent', ANDROID);
    await request(app).get(`/go/${id}`).set('User-Agent', IPAD);
    await request(app).get(`/go/${id}`).set('User-Agent', DESKTOP);
    await request(app).get(`/go/${buttonIds[2]}`).set('User-Agent', IPHONE); // Kiri Bar
    // No deben contarse:
    await request(app).get(`/go/${id}`).set('User-Agent', GOOGLEBOT);
    await request(app).get(`/go/${id}`).set('User-Agent', WHATSAPP);
    await request(app).get(`/go/${id}`).set('User-Agent', '');
    await request(app).get(`/go/${id}`).set('User-Agent', DESKTOP).set('Sec-Purpose', 'prefetch');
    await request(app).head(`/go/${id}`).set('User-Agent', DESKTOP);

    const s = await stats();
    expect(s.total).toBe(6); // 1 del test anterior + 5
    expect(s.ranking[0]).toMatchObject({ label: 'Hawa', clicks: 4 });
    const devices = Object.fromEntries(s.devices.map((d: any) => [d.device, d.clicks]));
    expect(devices).toEqual({ mobile: 3, tablet: 1, desktop: 2 });
    expect(s.today).toBe(6);
    expect(s.daily).toHaveLength(30);
    expect(s.daily.at(-1).clicks).toBe(6);
    expect(s.hours).toHaveLength(24);
  });

  it('id inválido o inexistente vuelve al inicio sin contar', async () => {
    const r1 = await request(app).get('/go/123').set('User-Agent', DESKTOP);
    const r2 = await request(app).get('/go/00000000-0000-0000-0000-000000000000').set('User-Agent', DESKTOP);
    expect(r1.headers.location).toBe('/');
    expect(r2.headers.location).toBe('/');
    expect((await stats()).total).toBe(6);
  });

  it('un botón oculto no redirige ni cuenta', async () => {
    const id = buttonIds[8]!;
    await agent.patch(`/api/cms/buttons/${id}`).send({ active: false });
    const r = await request(app).get(`/go/${id}`).set('User-Agent', DESKTOP);
    expect(r.headers.location).toBe('/');
    expect((await stats()).total).toBe(6);
    const page = await request(app).get('/');
    expect(page.text).not.toContain('De nuestro huerto');
    await agent.patch(`/api/cms/buttons/${id}`).send({ active: true });
  });

  it('periodos de 7 y 90 días y exportación CSV', async () => {
    expect((await stats(7)).daily).toHaveLength(7);
    expect((await stats(90)).daily).toHaveLength(90);
    const csv = await agent.get('/api/cms/stats.csv?days=30');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Fecha,Botón,Dispositivo,Clics');
    expect(csv.text).toContain('"Hawa",Celular,2');
  });

  it('no guarda IP ni datos personales', async () => {
    const { getDb } = await import('../src/db.js');
    const db = await getDb();
    const cols = await db.query(`select column_name from information_schema.columns where table_name = 'clicks' order by ordinal_position`);
    expect(cols.map((c) => c.column_name)).toEqual(['id', 'client_id', 'button_id', 'button_label', 'device', 'clicked_at']);
  });
});

describe('edición de botones', () => {
  let newId = '';

  it('crea un botón oculto hasta que tenga destino', async () => {
    const res = await agent.post('/api/cms/buttons').send({ label: 'Carta de postres' });
    expect(res.status).toBe(201);
    newId = res.body.button.id;
    expect(res.body.button).toMatchObject({ active: false, url: '', position: 9 });
    const act = await agent.patch(`/api/cms/buttons/${newId}`).send({ active: true });
    expect(act.status).toBe(400);
    expect(act.body.error).toMatch(/Agrega un PDF/);
  });

  it('rechaza enlaces peligrosos o inválidos', async () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hola', 'ftp://x.com', 'https://x.com/"onmouseover="x']) {
      const res = await agent.patch(`/api/cms/buttons/${newId}`).send({ kind: 'link', url });
      expect(res.status, url).toBe(400);
    }
    expect((await agent.patch(`/api/cms/buttons/${newId}`).send({ label: '   ' })).status).toBe(400);
    expect((await agent.patch(`/api/cms/buttons/${newId}`).send({ hackeo: true })).status).toBe(400);
  });

  it('con enlace se puede publicar y aparece al final de la página', async () => {
    const res = await agent.patch(`/api/cms/buttons/${newId}`).send({ kind: 'link', url: 'https://example.com/postres', active: true });
    expect(res.status).toBe(200);
    const page = await request(app).get('/');
    expect(page.text).toMatch(/De nuestro huerto<\/a>\s*<a class="boton" href="\/go\/[^"]+">Carta de postres<\/a>/);
  });

  it('escapa HTML en los nombres (sin XSS)', async () => {
    await agent.patch(`/api/cms/buttons/${newId}`).send({ label: '<img src=x onerror=alert(1)>' });
    const page = await request(app).get('/');
    expect(page.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(page.text).not.toContain('<img src=x');
  });

  it('abre en pestaña nueva si se indica', async () => {
    await agent.patch(`/api/cms/buttons/${newId}`).send({ label: 'Postres', new_tab: true });
    const page = await request(app).get('/');
    expect(page.text).toMatch(/href="\/go\/[^"]+" target="_blank" rel="noopener">Postres</);
  });

  it('reordena', async () => {
    const ids = [newId, ...buttonIds];
    const res = await agent.put('/api/cms/buttons/order').send({ ids });
    expect(res.body.buttons.map((b: any) => b.id)).toEqual(ids);
    const page = await request(app).get('/');
    expect(page.text.indexOf('Postres')).toBeLessThan(page.text.indexOf('Desayuno Breakfast'));
  });

  it('reemplazar el PDF borra el archivo anterior', async () => {
    const before = (await agent.get('/api/cms/state')).body.buttons.find((b: any) => b.id === buttonIds[0]);
    expect(stored.has(before.file_path)).toBe(true);
    const target = (await agent.post('/api/cms/uploads').send({ purpose: 'pdf', fileName: 'Desayuno nuevo.pdf', contentType: 'application/pdf', size: 1000 })).body;
    await agent.put(target.uploadUrl).set('Content-Type', 'application/pdf').send(Buffer.from('%PDF-1.4 prueba'));
    expect(stored.has(target.path)).toBe(true);
    const res = await agent.patch(`/api/cms/buttons/${buttonIds[0]}`).send({ kind: 'pdf', url: target.publicUrl, file_name: 'Desayuno nuevo.pdf', file_path: target.path });
    expect(res.status).toBe(200);
    expect(stored.has(before.file_path)).toBe(false);
    const go = await request(app).get(`/go/${buttonIds[0]}`).set('User-Agent', GOOGLEBOT);
    expect(go.headers.location).toBe(target.publicUrl);
  });

  it('borra un botón y conserva su historial de clics como "eliminado"', async () => {
    await request(app).get(`/go/${newId}`).set('User-Agent', IPHONE);
    expect((await agent.delete(`/api/cms/buttons/${newId}`)).status).toBe(200);
    expect((await agent.delete(`/api/cms/buttons/${newId}`)).status).toBe(404);
    const s = await stats();
    expect(s.ranking.find((r: any) => r.deleted)).toMatchObject({ label: 'Postres', clicks: 1 });
  });
});

describe('subidas', () => {
  it('valida tipo, tamaño y extensión', async () => {
    const bad = [
      { purpose: 'pdf', fileName: 'x.pdf', contentType: 'image/png', size: 10 },
      { purpose: 'pdf', fileName: 'x.pdf', contentType: 'application/pdf', size: 30 * 1024 * 1024 },
      { purpose: 'pdf', fileName: 'x.exe', contentType: 'application/pdf', size: 10 },
      { purpose: 'logo', fileName: 'x.svg', contentType: 'image/svg+xml', size: 10 },
      { purpose: 'otro', fileName: 'x.png', contentType: 'image/png', size: 10 },
    ];
    for (const body of bad) expect((await agent.post('/api/cms/uploads').send(body)).status, JSON.stringify(body)).toBe(400);
    const ok = await agent.post('/api/cms/uploads').send({ purpose: 'logo', fileName: 'Logo Ñandú.png', contentType: 'image/png', size: 2000 });
    expect(ok.status).toBe(200);
    expect(ok.body.path).toMatch(/^intursa\/logo\/[a-z0-9]+-Logo-Nandu\.png$/);
  });

  it('no permite escribir fuera de la carpeta del cliente', async () => {
    const res = await agent.put('/api/cms/uploads/local?path=../../src/app.ts').set('Content-Type', 'application/pdf').send(Buffer.from('x'));
    expect(res.status).toBe(400);
  });
});

describe('apariencia, textos y redes', () => {
  it('guarda colores y textos y se ven en la página', async () => {
    const res = await agent.patch('/api/cms/settings').send({ color_boton_hover: '#26615f', novedades_texto: 'Suscríbete & gana', redes_titulo: 'Síguenos ya' });
    expect(res.status).toBe(200);
    const page = await request(app).get('/');
    expect(page.text).toContain('--boton-hover: #26615f;');
    expect(page.text).toContain('Suscríbete &amp; gana');
  });

  it('rechaza valores inválidos', async () => {
    for (const body of [{ color_texto: 'red; } body { display:none' }, { novedades_url: 'javascript:alert(1)' }, { inventado: '1' }, { fondo_tipo: 'video' }]) {
      expect((await agent.patch('/api/cms/settings').send(body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('oculta novedades si se desactiva y cambia a fondo de color', async () => {
    await agent.patch('/api/cms/settings').send({ novedades_activo: '0', fondo_tipo: 'color', color_fondo: '#123456' });
    const page = await request(app).get('/');
    expect(page.text).not.toContain('class="novedades"');
    expect(page.text).toMatch(/background: var\(--fondo\)\s+center/);
    await agent.patch('/api/cms/settings').send({ novedades_activo: '1', fondo_tipo: 'imagen' });
  });

  it('redes: agregar, editar, ordenar, ocultar y quitar', async () => {
    const fb = (await agent.get('/api/cms/state')).body.socials.find((s: any) => s.network === 'facebook');
    await agent.patch(`/api/cms/socials/${fb.id}`).send({ url: 'https://facebook.com/tambodelinka' });
    const mail = (await agent.post('/api/cms/socials').send({ network: 'email', url: 'mailto:reservas@ejemplo.com' })).body.social;
    expect((await agent.post('/api/cms/socials').send({ network: 'myspace' })).status).toBe(400);
    expect((await agent.patch(`/api/cms/socials/${mail.id}`).send({ url: 'javascript:alert(1)' })).status).toBe(400);

    let page = await request(app).get('/');
    expect(page.text).toContain('<h2>Síguenos ya</h2>');
    expect(page.text).toContain('href="https://facebook.com/tambodelinka" aria-label="Facebook"');
    expect(page.text).toContain('fa-solid fa-envelope');
    expect(page.text).not.toContain('aria-label="Instagram"'); // sin enlace no se muestra

    const ids = (await agent.get('/api/cms/state')).body.socials.map((s: any) => s.id).reverse();
    await agent.put('/api/cms/socials/order').send({ ids });
    page = await request(app).get('/');
    expect(page.text.indexOf('fa-envelope')).toBeLessThan(page.text.indexOf('fa-facebook'));

    await agent.patch(`/api/cms/socials/${mail.id}`).send({ active: false });
    expect((await request(app).get('/')).text).not.toContain('fa-envelope');
    expect((await agent.delete(`/api/cms/socials/${mail.id}`)).status).toBe(200);
  });

  it('la vista previa no usa tracking', async () => {
    const res = await agent.get('/api/cms/preview');
    expect(res.text).not.toContain('/go/');
    expect(res.text).toContain('<base target="_blank">');
  });
});

describe('estadísticas y cuenta', () => {
  it('borrar estadísticas exige confirmación', async () => {
    expect((await agent.delete('/api/cms/clicks').send({})).status).toBe(400);
    const res = await agent.delete('/api/cms/clicks').send({ confirm: 'BORRAR' });
    expect(res.body.deleted).toBeGreaterThan(0);
    expect((await stats()).total).toBe(0);
  });

  it('cambia la contraseña', async () => {
    expect((await agent.post('/api/cms/password').send({ current: 'mala', next: 'NuevaClave2026' })).status).toBe(400);
    expect((await agent.post('/api/cms/password').send({ current: 'TambodelInka2026', next: 'corta' })).status).toBe(400);
    expect((await agent.post('/api/cms/password').send({ current: 'TambodelInka2026', next: 'NuevaClave2026' })).status).toBe(200);
    expect((await request(app).post('/api/login').send({ username: 'TambodelInka', password: 'TambodelInka2026' })).status).toBe(401);
    expect((await request(app).post('/api/login').send({ username: 'TambodelInka', password: 'NuevaClave2026' })).status).toBe(200);
  });

  it('bloquea 15 minutos tras 5 intentos fallidos', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/login').send({ username: 'TambodelInka', password: 'mala' });
    const res = await request(app).post('/api/login').send({ username: 'TambodelInka', password: 'NuevaClave2026' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Demasiados intentos/);
  });

  it('cerrar sesión borra la cookie', async () => {
    const res = await agent.post('/api/logout');
    expect(res.headers['set-cookie']?.[0]).toMatch(/cms_session=;/);
    expect((await agent.get('/api/cms/state')).status).toBe(401);
  });
});
