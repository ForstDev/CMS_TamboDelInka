// Seguridad: clave de sesión, IP del visitante (TRUST_PROXY), cookie Secure, sesiones que se revocan al cambiar la
// contraseña, cabeceras (CSP, HSTS), CSV sin fórmulas y rutas de archivo válidas.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openPglite, setDb } from '../src/db.js';
import { setStorage, type Storage } from '../src/storage.js';
import { applySchema, seed, type ClientConfig } from '../src/seed.js';
import { createApp } from '../src/app.js';
import * as repo from '../src/repo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'client-default-only.json'), 'utf8')) as ClientConfig;
const ADMIN = config.admin;

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

beforeAll(async () => {
  setDb(await openPglite());
  setStorage(memoryStorage);
  await applySchema();
  await seed({ log: () => {}, source: { config, dir: path.join(here, '..', 'clients', 'intursa') } });
  app = createApp();
}, 60_000);

/** Inicia sesión y devuelve el agente (con su cookie) y el valor crudo del Set-Cookie. */
async function loginAgent(headers: Record<string, string> = {}) {
  const agent = request.agent(app);
  const res = await agent.post('/api/login').set(headers).send({ username: ADMIN.username, password: ADMIN.password });
  expect(res.status).toBe(200);
  return { agent, setCookie: String(res.headers['set-cookie']?.[0] ?? '') };
}

describe('clave de sesión (SESSION_SECRET)', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });

  it('sin clave en desarrollo: usa una clave aleatoria por proceso, nunca una fija y conocida', async () => {
    delete process.env.SESSION_SECRET;
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'test';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env } = await import('../src/env.js');
    const a = env.sessionSecret;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(env.sessionSecret).toBe(a); // estable durante el proceso
    expect(a).not.toContain('solo-para-desarrollo');
    vi.resetModules();
    const again = (await import('../src/env.js')).env.sessionSecret;
    expect(again).not.toBe(a); // otro proceso, otra clave
  });

  it('una clave corta se trata como si faltara', async () => {
    process.env.SESSION_SECRET = 'corta';
    process.env.NODE_ENV = 'test';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { env } = await import('../src/env.js');
    expect(env.sessionSecret).not.toBe('corta');
    expect(env.sessionSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('en producción (NODE_ENV=production o Vercel) sin clave de 32+ caracteres: se niega a arrancar', async () => {
    delete process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    const prod = (await import('../src/env.js')).env;
    expect(() => prod.sessionSecret).toThrow('SESSION_SECRET debe tener al menos 32 caracteres');
    vi.resetModules();
    process.env.NODE_ENV = 'test';
    process.env.VERCEL = '1';
    const vercel = (await import('../src/env.js')).env;
    expect(() => vercel.sessionSecret).toThrow('SESSION_SECRET debe tener al menos 32 caracteres');
  });

  it('con una clave válida la usa tal cual', async () => {
    process.env.SESSION_SECRET = 'x'.repeat(40);
    const { env } = await import('../src/env.js');
    expect(env.sessionSecret).toBe('x'.repeat(40));
  });
});

describe('TRUST_PROXY: de dónde sale la IP del visitante', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
    vi.resetModules();
  });
  const read = async (v: string | undefined) => {
    if (v === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = v;
    vi.resetModules();
    return (await import('../src/env.js')).env.trustProxy;
  };

  it('por defecto 1 proxy; acepta 0…10; cualquier otra cosa vuelve a 1', async () => {
    expect(await read(undefined)).toBe(1);
    expect(await read('')).toBe(1);
    expect(await read('0')).toBe(0);
    expect(await read('2')).toBe(2);
    for (const bad of ['-1', '11', 'x', '1.5', 'true']) expect(await read(bad), bad).toBe(1);
  });

  it('un atacante no se salta el bloqueo del login escribiendo otra IP al principio de X-Forwarded-For', async () => {
    // El proxy de confianza (1) añade la IP real al final; lo que el atacante escriba antes se ignora.
    const intentos = [];
    for (let i = 0; i < 6; i++) {
      intentos.push(
        await request(app)
          .post('/api/login')
          .set('X-Forwarded-For', `10.0.0.${i + 1}, 203.0.113.77`)
          .send({ username: ADMIN.username, password: 'incorrecta-' + i }),
      );
    }
    expect(intentos.slice(0, 5).map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(intentos[5]!.status).toBe(429); // misma IP real: bloqueado aunque cada intento "viniera de otra"
    // Otro equipo (otra IP real) no se ve afectado.
    const otro = await request(app).post('/api/login').set('X-Forwarded-For', '10.0.0.1, 198.51.100.9').send({ username: ADMIN.username, password: 'mal' });
    expect(otro.status).toBe(401);
  });
});

describe('cookie de sesión', () => {
  it('lleva HttpOnly y SameSite=Lax; Secure solo si la petición llegó por HTTPS (aunque no sea Vercel)', async () => {
    const http = await loginAgent();
    expect(http.setCookie).toMatch(/HttpOnly/i);
    expect(http.setCookie).toMatch(/SameSite=Lax/i);
    expect(http.setCookie).not.toMatch(/;\s*Secure/i);
    const https = await loginAgent({ 'X-Forwarded-Proto': 'https' });
    expect(https.setCookie).toMatch(/;\s*Secure/i);
    expect(https.setCookie).toMatch(/HttpOnly/i);
  });
});

describe('sesión: se revoca al cambiar la contraseña', () => {
  it('la cookie anterior deja de valer; con la contraseña nueva se entra normal', async () => {
    const a = await loginAgent();
    const b = await loginAgent(); // otra "persona" con la misma cuenta
    expect((await a.agent.get('/api/cms/state')).status).toBe(200);
    expect((await b.agent.get('/api/cms/state')).status).toBe(200);

    const nueva = 'NuevaClaveSegura2026';
    const cambio = await a.agent.post('/api/cms/password').send({ current: ADMIN.password, next: nueva });
    expect(cambio.status).toBe(200);
    // Las dos sesiones abiertas caen (incluida una cookie robada): hay que volver a ingresar.
    expect((await a.agent.get('/api/cms/state')).status).toBe(401);
    expect((await b.agent.get('/api/cms/state')).status).toBe(401);
    expect((await request.agent(app).get('/cms')).headers.location).toBe('/cms_login');

    const fresh = request.agent(app);
    expect((await fresh.post('/api/login').send({ username: ADMIN.username, password: nueva })).status).toBe(200);
    expect((await fresh.get('/api/cms/state')).status).toBe(200);
    // Se restablece la de siempre para las demás pruebas.
    expect((await fresh.post('/api/cms/password').send({ current: nueva, next: ADMIN.password })).status).toBe(200);
  });

  it('una cookie firmada con otra clave, o de una cuenta que ya no existe, no entra', async () => {
    const { agent } = await loginAgent();
    const cookie = String(agent.jar.getCookie('cms_session', { path: '/', domain: '127.0.0.1', script: false, secure: false } as any)?.value ?? '');
    expect(cookie.split('.')).toHaveLength(3);
    const tampered = cookie.slice(0, -3) + (cookie.endsWith('aaa') ? 'bbb' : 'aaa');
    expect((await request(app).get('/api/cms/state').set('Cookie', `cms_session=${tampered}`)).status).toBe(401);
    expect((await request(app).get('/api/cms/state').set('Cookie', 'cms_session=basura')).status).toBe(401);
    expect((await request(app).get('/api/cms/state')).status).toBe(401);
  });
});

describe('cabeceras de seguridad', () => {
  it('página pública: CSP sin scripts, sin conexiones y sin inline; nosniff, Referrer-Policy y Permissions-Policy', async () => {
    const res = await request(app).get('/');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://cdnjs.cloudflare.com');
    expect(csp).not.toContain('frame-ancestors'); // Intursa puede mostrarla dentro de su web
    expect(csp).not.toContain("'unsafe-eval'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(String(res.headers['permissions-policy'])).toContain('camera=()');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined(); // sin HTTPS no se envía
    // La página no necesita ningún script: nada se bloquea.
    expect(res.text).not.toMatch(/<script/i);
  });

  it('HSTS solo cuando la petición llegó por HTTPS (y sin includeSubDomains)', async () => {
    const res = await request(app).get('/').set('X-Forwarded-Proto', 'https');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000');
  });

  it('login: el nonce de la CSP es el mismo de sus <script> y cambia en cada petición', async () => {
    const a = await request(app).get('/cms_login');
    const b = await request(app).get('/cms_login');
    const nonceA = /'nonce-([A-Za-z0-9+/=]+)'/.exec(String(a.headers['content-security-policy']))![1]!;
    const nonceB = /'nonce-([A-Za-z0-9+/=]+)'/.exec(String(b.headers['content-security-policy']))![1]!;
    expect(nonceA).not.toBe(nonceB);
    const scripts = [...a.text.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag, tag).toContain(`nonce="${nonceA}"`);
    expect(a.text).not.toContain('{{');
    const csp = String(a.headers['content-security-policy']);
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).toContain("frame-src 'self'");
    expect(a.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('panel y API: scripts solo propios y de cdnjs; sin scripts en línea', async () => {
    const { agent } = await loginAgent();
    const page = await agent.get('/cms');
    const csp = String(page.headers['content-security-policy']);
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' https:\/\/cdnjs\.cloudflare\.com(;|$)/);
    expect(csp.match(/script-src[^;]*/)![0]).not.toContain('unsafe-inline');
    // Todos los <script> del panel son externos (sin código en línea que la CSP bloquearía).
    for (const tag of page.text.matchAll(/<script\b([^>]*)>/g)) expect(tag[1], tag[0]).toMatch(/\ssrc="/);
    // Las librerías externas llevan SRI.
    for (const tag of page.text.matchAll(/<(?:script|link)\b[^>]*cdnjs\.cloudflare\.com[^>]*>/g)) {
      expect(tag[0], tag[0]).toMatch(/integrity="sha512-[A-Za-z0-9+/=]+"/);
      expect(tag[0], tag[0]).toContain('crossorigin="anonymous"');
    }
    const preview = await agent.get('/api/cms/preview');
    expect(String(preview.headers['content-security-policy'])).toContain("frame-ancestors 'self'");
  });

  it('todas las plantillas cargan Font Awesome con SRI', () => {
    for (const f of ['pagina.html', 'experiencias.html', 'login.html', 'cms.html']) {
      const html = fs.readFileSync(path.join(here, '..', 'templates', f), 'utf8');
      const tags = [...html.matchAll(/<link\b[^>]*font-awesome[^>]*>/g)].map((m) => m[0]);
      expect(tags.length, f).toBe(1);
      expect(tags[0], f).toContain('integrity="sha512-SnH5WK+bZxgPHs44uWIX+LLJAJ9/2PkPKZ5QiAj6Ta86w+fsb2TkcmfRyVX3pBnMFcV7oQPJkl9QevSCWr3W6A=="');
    }
  });
});

describe('CSV de estadísticas y archivos de botones', () => {
  it('un nombre que empieza con = + - @ no se ejecuta como fórmula en Excel', async () => {
    const { agent } = await loginAgent();
    const created = await agent.post('/api/cms/buttons').send({ label: 'Carta' });
    const id = created.body.button.id as string;
    for (const [label, esperado] of [
      ['=HYPERLINK("http://x","clic")', `"'=HYPERLINK(""http://x"",""clic"")"`],
      ['+1+1', `"'+1+1"`],
      ['-2', `"'-2"`],
      ['@SUMA(A1)', `"'@SUMA(A1)"`],
      ['Normal = 1', '"Normal = 1"'],
    ] as const) {
      expect((await agent.patch(`/api/cms/buttons/${id}`).send({ label, kind: 'link', url: 'https://example.com', active: true })).status).toBe(200);
      await request(app).get(`/go/${id}`).set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126');
      const csv = (await agent.get('/api/cms/stats.csv?days=30')).text;
      expect(csv, label).toContain(`,${esperado},`);
    }
    await agent.delete(`/api/cms/buttons/${id}`);
  });

  it('el archivo de un botón solo puede ser una ruta que el CMS generó (no se borra un archivo ajeno)', async () => {
    const { agent } = await loginAgent();
    const id = (await agent.post('/api/cms/buttons').send({ label: 'Con PDF' })).body.button.id as string;
    for (const bad of ['../otro-cliente/pdf/1-a.pdf', 'intursa/../x', 'otro/pdf/1-a.pdf', '/etc/passwd', 'intursa/pdf/sinsello.pdf', 'intursa/otra/cosa/1-a.pdf']) {
      const r = await agent.patch(`/api/cms/buttons/${id}`).send({ file_path: bad });
      expect(r.status, bad).toBe(400);
      expect(r.body.error).toBe('Ruta de archivo inválida.');
    }
    const ok = await agent.patch(`/api/cms/buttons/${id}`).send({ kind: 'pdf', file_path: 'intursa/pdf/abc123-carta.pdf', file_name: 'carta.pdf', url: '/uploads/intursa/pdf/abc123-carta.pdf' });
    expect(ok.status).toBe(200);
    // Vaciarlo (quitar el archivo) sigue permitido.
    expect((await agent.patch(`/api/cms/buttons/${id}`).send({ file_path: '', url: '', file_name: '' })).status).toBe(200);
    await agent.delete(`/api/cms/buttons/${id}`);
  });
});

describe('instalador: contraseña del administrador', () => {
  it('si el administrador ya existe, un nuevo setup no le pisa la contraseña (que se cambió desde el panel)', async () => {
    const before = await repo.findAdmin(ADMIN.username);
    const withEnv = process.env.ADMIN_PASSWORD;
    delete process.env.ADMIN_PASSWORD;
    // Fuerza que el seed vuelva a cargar la landing por defecto (como un `setup --force`).
    await seed({ log: () => {}, force: true, source: { config, dir: path.join(here, '..', 'clients', 'intursa') } });
    const after = await repo.findAdmin(ADMIN.username);
    expect(after?.password_hash).toBe(before?.password_hash);
    if (withEnv !== undefined) process.env.ADMIN_PASSWORD = withEnv;
  }, 60_000);

  it('con ADMIN_PASSWORD sí la restablece', async () => {
    process.env.ADMIN_PASSWORD = 'RestablecidaPorEntorno2026';
    try {
      const before = await repo.findAdmin(ADMIN.username);
      await seed({ log: () => {}, force: true, source: { config, dir: path.join(here, '..', 'clients', 'intursa') } });
      const after = await repo.findAdmin(ADMIN.username);
      expect(after?.password_hash).not.toBe(before?.password_hash);
      const res = await request(app).post('/api/login').send({ username: ADMIN.username, password: 'RestablecidaPorEntorno2026' });
      expect(res.status).toBe(200);
    } finally {
      delete process.env.ADMIN_PASSWORD;
      await seed({ log: () => {}, force: true, source: { config: { ...config, admin: { ...ADMIN } }, dir: path.join(here, '..', 'clients', 'intursa') } });
      process.env.ADMIN_PASSWORD = ADMIN.password;
      await seed({ log: () => {}, force: true, source: { config, dir: path.join(here, '..', 'clients', 'intursa') } });
      delete process.env.ADMIN_PASSWORD;
    }
  }, 60_000);
});
