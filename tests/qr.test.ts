// Código QR por botón: funciones puras, dibujo (SVG/PNG contra la matriz de la librería), API del panel y marcado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openPglite, setDb } from '../src/db.js';
import { setStorage, type Storage } from '../src/storage.js';
import { applySchema, seed, type ClientConfig } from '../src/seed.js';
import { createApp } from '../src/app.js';
import * as repo from '../src/repo.js';
import type { Landing } from '../src/context.js';
import { parsePublicUrl } from '../src/env.js';
import { parseQrSize, publicBase, qrFileName, qrMatrix, qrPixelsPerModule, qrPng, qrSvg, qrTarget, QR_QUIET } from '../src/qr.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = '0b7e7c1e-5f0a-4c9e-8f2a-3d1b2c4d5e6f';

const memoryStorage: Storage = {
  mode: 'local',
  async createUploadTarget(p) {
    return { uploadUrl: `/api/cms/uploads/local?path=${encodeURIComponent(p)}`, path: p, publicUrl: `/uploads/${p}` };
  },
  async put(p) {
    return `/uploads/${p}`;
  },
  async remove() {},
  publicUrl: (p) => `/uploads/${p}`,
};

/** Matriz de módulos negros leída de la ruta del SVG. */
function matrixFromSvg(svg: string): boolean[][] {
  const total = Number(/viewBox="0 0 (\d+) \1"/.exec(svg)![1]);
  const n = total - QR_QUIET * 2;
  const m = Array.from({ length: n }, () => Array<boolean>(n).fill(false));
  for (const r of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const [x, y, len] = [Number(r[1]) - QR_QUIET, Number(r[2]) - QR_QUIET, Number(r[3])];
    for (let i = 0; i < len; i++) m[y]![x + i] = true;
  }
  return m;
}

/** Decodifica el PNG de 1 bit generado por qrPng: devuelve ancho, alto y un lector de píxeles (true = negro). */
function readPng(buf: Buffer) {
  expect([...buf.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat: Buffer[] = [];
  let width = 0;
  let height = 0;
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect([data[8], data[9], data[10], data[11], data[12]]).toEqual([1, 0, 0, 0, 0]);
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = Math.ceil(width / 8);
  expect(raw.length).toBe(height * (rowBytes + 1));
  const dark = (x: number, y: number) => ((raw[y * (rowBytes + 1) + 1 + (x >> 3)]! >> (7 - (x & 7))) & 1) === 0;
  return { width, height, dark };
}

describe('QR: funciones puras', () => {
  it('qrTarget: <sitio>/go/<id>, sin landing ni parámetros', () => {
    expect(qrTarget('https://carta.example.com', ID)).toBe(`https://carta.example.com/go/${ID}`);
  });

  it('parsePublicUrl: solo origen https (http fuera de producción), sin usuario, ruta ni parámetros', () => {
    expect(parsePublicUrl('https://carta.example.com', true)).toBe('https://carta.example.com');
    expect(parsePublicUrl('  https://Carta.Example.com/// ', true)).toBe('https://carta.example.com');
    expect(parsePublicUrl('https://carta.example.com:8443', true)).toBe('https://carta.example.com:8443');
    expect(parsePublicUrl('http://localhost:3000', false)).toBe('http://localhost:3000');
    for (const bad of [
      '',
      'carta.example.com',
      'javascript:alert(1)',
      'data:text/html,hola',
      'ftp://example.com',
      'https://user:clave@example.com',
      'https://user@example.com',
      'https://example.com/ruta',
      'https://example.com/?a=1',
      'https://example.com?a=1',
      'https://example.com/#x',
      'https://exa mple.com',
      'https://example.com\\@evil.com',
    ]) {
      expect(parsePublicUrl(bad, false), bad).toBeNull();
    }
    expect(parsePublicUrl('http://example.com', true)).toBeNull(); // en producción, solo https
  });

  it('parseQrSize: 256–2048, por defecto 1024; lo demás es inválido', () => {
    expect(parseQrSize(undefined)).toBe(1024);
    expect(parseQrSize('256')).toBe(256);
    expect(parseQrSize('2048')).toBe(2048);
    expect(parseQrSize('600')).toBe(600);
    for (const bad of ['255', '2049', '0', '-300', '1e3', '500.5', 'abc', '', ' 512', '0512x', ['512', '600'], 512]) {
      expect(parseQrSize(bad), String(bad)).toBeNull();
    }
  });

  it('qrFileName: minúsculas, letras, números y guiones', () => {
    expect(qrFileName('tambo-outlets', 'Cronograma Semanal — Ñandú / 2026!', 'svg')).toBe('qr-tambo-outlets-cronograma-semanal-nandu-2026.svg');
    expect(qrFileName('exp-demo', 'Menú de niños | Kids Menu', 'png')).toBe('qr-exp-demo-menu-de-ninos-kids-menu.png');
    expect(qrFileName('x', '"; rm -rf /\r\n<script>', 'svg')).toBe('qr-x-rm-rf-script.svg');
    expect(qrFileName('x', '¿¡?!', 'png')).toBe('qr-x-boton.png');
    expect(qrFileName('x', 'a'.repeat(200), 'svg')).toMatch(/^qr-x-a{40}\.svg$/);
  });

  it('publicBase: PUBLIC_URL manda; si no, host y protocolo de la petición con validación', () => {
    const req = (headers: Record<string, string>, protocol = 'https') => ({ protocol, get: (n: string) => headers[n.toLowerCase()] });
    const saved = process.env.PUBLIC_URL;
    try {
      delete process.env.PUBLIC_URL;
      expect(publicBase(req({ host: 'sitio.example.com' }))).toBe('https://sitio.example.com');
      expect(publicBase(req({ host: 'localhost:3000' }, 'http'))).toBe('http://localhost:3000');
      expect(publicBase(req({ 'x-forwarded-host': 'a.example.com, b.example.com', host: 'interno' }))).toBe('https://a.example.com');
      for (const bad of ['evil.com/ruta', 'user@evil.com', 'evil.com?x=1', 'a b.com', 'evil.com#x', '']) {
        expect(publicBase(req({ host: bad })), bad).toBeNull();
      }
      expect(publicBase(req({ host: 'sitio.example.com' }, 'javascript'))).toBeNull();
      process.env.PUBLIC_URL = 'https://carta.example.com/';
      expect(publicBase(req({ host: 'otro.example.com' }))).toBe('https://carta.example.com');
      process.env.PUBLIC_URL = 'javascript:alert(1)'; // inválida: se ignora
      expect(publicBase(req({ host: 'otro.example.com' }))).toBe('https://otro.example.com');
    } finally {
      if (saved === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = saved;
    }
  });
});

describe('QR: dibujo', () => {
  const text = qrTarget('https://carta.example.com', ID);
  const matrix = qrMatrix(text);
  const expected = Array.from({ length: matrix.size }, (_, r) => Array.from({ length: matrix.size }, (_, c) => matrix.dark(r, c)));

  it('la matriz es una versión estándar, estable para el mismo texto y distinta para otro botón', () => {
    expect(matrix.size).toBeGreaterThanOrEqual(21);
    expect((matrix.size - 17) % 4).toBe(0); // 17 + 4·versión
    const same = qrMatrix(text);
    const other = qrMatrix(qrTarget('https://carta.example.com', ID.replace('0b7e', '0b7f')));
    let diff = 0;
    for (let r = 0; r < matrix.size; r++) for (let c = 0; c < matrix.size; c++) {
      expect(same.dark(r, c)).toBe(matrix.dark(r, c));
      if (other.size === matrix.size && other.dark(r, c) !== matrix.dark(r, c)) diff++;
    }
    expect(diff).toBeGreaterThan(0);
  });

  it('SVG: limpio, con zona silenciosa de 4 módulos y los mismos módulos que la matriz', () => {
    const svg = qrSvg(text);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg ');
    expect(svg).not.toMatch(/<script|href=|xlink|http:\/\/(?!www\.w3\.org)|https?:\/\/carta|onload|<image|<style|<foreignObject/i);
    expect(svg).toContain(`viewBox="0 0 ${matrix.size + 8} ${matrix.size + 8}"`);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(matrixFromSvg(svg)).toEqual(expected);
  });

  it.each([256, 600, 1024, 2048])('PNG %i px: tamaño exacto, módulos enteros, zona silenciosa y mismos módulos', (size) => {
    const png = readPng(qrPng(text, size));
    expect([png.width, png.height]).toEqual([size, size]);
    const scale = qrPixelsPerModule(matrix.size, size);
    expect(scale).toBeGreaterThanOrEqual(4);
    const offset = Math.floor((size - scale * matrix.size) / 2);
    expect(offset).toBeGreaterThanOrEqual(QR_QUIET * scale);
    for (let r = 0; r < matrix.size; r++) {
      for (let c = 0; c < matrix.size; c++) {
        // esquinas y centro de cada módulo
        for (const [dx, dy] of [[0, 0], [scale - 1, 0], [0, scale - 1], [scale - 1, scale - 1], [scale >> 1, scale >> 1]] as const) {
          expect(png.dark(offset + c * scale + dx, offset + r * scale + dy)).toBe(expected[r]![c]);
        }
      }
    }
    // Todo lo que queda fuera del QR (franja de al menos 4 módulos) es blanco.
    for (let i = 0; i < size; i++) {
      for (const k of [0, offset - 1, size - 1, offset + scale * matrix.size]) {
        if (k >= 0 && k < size) {
          expect(png.dark(i, k)).toBe(false);
          expect(png.dark(k, i)).toBe(false);
        }
      }
    }
  });
});

describe('QR: API del panel', () => {
  let app: Express;
  let agent: ReturnType<typeof request.agent>;
  let A: Landing;
  let B: Landing;
  let aButton = '';
  let bButton = '';
  const saved = process.env.PUBLIC_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = saved;
  });
  const asB = (r: request.Test) => r.set('X-Landing-Id', B.id);
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  /** Respuesta con `text` (supertest no lo llena para image/svg+xml); los errores siguen llegando como JSON en `body`. */
  const svg = async (r: request.Test) => {
    const res = await binary(r);
    const text = (res.body as Buffer).toString('utf8');
    (res as any).text = text;
    if (/json/.test(String(res.headers['content-type']))) (res as any).body = JSON.parse(text);
    return res;
  };

  beforeAll(async () => {
    delete process.env.PUBLIC_URL;
    setStorage(memoryStorage);
    setDb(await openPglite());
    await applySchema();
    const config = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'client-default-only.json'), 'utf8')) as ClientConfig;
    await seed({ log: () => {}, source: { config, dir: path.join(here, '..', 'clients', 'intursa') } });
    A = (await repo.getDefaultLanding())!;
    B = await repo.createLanding({ slug: 'exp-demo', name: 'Experiencias demo', hotel: 'Otro hotel', template: 'experiencias' });
    aButton = (await repo.listButtons())[0]!.id;
    app = createApp();
    agent = request.agent(app);
    expect((await agent.post('/api/login').send({ username: 'TambodelInka', password: 'TambodelInka2026' })).status).toBe(200);
    bButton = (await asB(agent.post('/api/cms/buttons')).send({ label: 'Cronograma Semanal — Ñandú / 2026!' })).body.button.id;
  }, 60_000);

  it('sin sesión: 401 como el resto de la API', async () => {
    expect((await request(app).get(`/api/cms/buttons/${aButton}/qr.svg`)).status).toBe(401);
    expect((await request(app).get(`/api/cms/buttons/${aButton}/qr.png`)).status).toBe(401);
  });

  it('SVG: tipo de contenido, sin caché, y codifica <sitio>/go/<id> del botón', async () => {
    const res = await svg(agent.get(`/api/cms/buttons/${aButton}/qr.svg`).set('Host', 'panel.example.com').set('X-Forwarded-Proto', 'https'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(res.text.startsWith('<?xml')).toBe(true);
    const target = `https://panel.example.com/go/${aButton}`;
    expect(res.text).toBe(qrSvg(target));
    expect(matrixFromSvg(res.text)).toEqual(Array.from({ length: qrMatrix(target).size }, (_, r) => Array.from({ length: qrMatrix(target).size }, (_, c) => qrMatrix(target).dark(r, c))));
    // El QR no depende de la landing ni cambia con ?landing=
    const withParam = await svg(agent.get(`/api/cms/buttons/${aButton}/qr.svg?landing=${A.id}`).set('Host', 'panel.example.com').set('X-Forwarded-Proto', 'https'));
    expect(withParam.text).toBe(res.text);
  });

  it('PNG: firma, tipo de contenido y tamaño por defecto 1024', async () => {
    const res = await binary(agent.get(`/api/cms/buttons/${aButton}/qr.png`));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.body as Buffer;
    expect([...body.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const png = readPng(body);
    expect([png.width, png.height]).toEqual([1024, 1024]);
  });

  it('size: válido da ese tamaño; fuera de rango o basura da 400', async () => {
    for (const size of [256, 777, 2048]) {
      const png = readPng((await binary(agent.get(`/api/cms/buttons/${aButton}/qr.png?size=${size}`))).body as Buffer);
      expect(png.width).toBe(size);
    }
    for (const bad of ['255', '2049', 'abc', '', '10.5', '-1', '1e3']) {
      const res = await agent.get(`/api/cms/buttons/${aButton}/qr.png?size=${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.error).toMatch(/256 y 2048/);
    }
    expect((await agent.get(`/api/cms/buttons/${aButton}/qr.png?size=1&size=2`)).status).toBe(400);
  });

  it('id que no es UUID o que no existe: 404', async () => {
    for (const ext of ['svg', 'png']) {
      for (const id of ['abc', '123', 'no-es-uuid', '00000000-0000-0000-0000-000000000000']) {
        const res = await agent.get(`/api/cms/buttons/${id}/qr.${ext}`);
        expect(res.status, `${id}.${ext}`).toBe(404);
        expect(res.body).toEqual({ error: 'Botón no encontrado.' });
      }
    }
  });

  it('aislamiento: un botón de otra landing da 404 (y con la suya, 200)', async () => {
    expect((await asB(agent.get(`/api/cms/buttons/${aButton}/qr.svg`))).status).toBe(404);
    expect((await asB(agent.get(`/api/cms/buttons/${aButton}/qr.png`))).status).toBe(404);
    expect((await agent.get(`/api/cms/buttons/${bButton}/qr.svg`)).status).toBe(404);
    expect((await agent.get(`/api/cms/buttons/${bButton}/qr.png`)).status).toBe(404);
    expect((await agent.get(`/api/cms/buttons/${bButton}/qr.svg?landing=${B.id}`)).status).toBe(200);
    expect((await asB(agent.get(`/api/cms/buttons/${bButton}/qr.png`))).status).toBe(200);
  });

  it('un botón borrado ya no tiene QR (404)', async () => {
    const id = (await asB(agent.post('/api/cms/buttons')).send({ label: 'Temporal' })).body.button.id;
    expect((await asB(agent.get(`/api/cms/buttons/${id}/qr.svg`))).status).toBe(200);
    expect((await asB(agent.delete(`/api/cms/buttons/${id}`))).status).toBe(200);
    expect((await asB(agent.get(`/api/cms/buttons/${id}/qr.svg`))).status).toBe(404);
  });

  it('download=1: Content-Disposition con nombre saneado (landing + etiqueta)', async () => {
    const svg = await asB(agent.get(`/api/cms/buttons/${bButton}/qr.svg?download=1`));
    expect(svg.headers['content-disposition']).toBe('attachment; filename="qr-exp-demo-cronograma-semanal-nandu-2026.svg"');
    const png = await asB(agent.get(`/api/cms/buttons/${bButton}/qr.png?download=1&size=512`));
    expect(png.headers['content-disposition']).toBe('attachment; filename="qr-exp-demo-cronograma-semanal-nandu-2026.png"');
    expect(png.headers['content-type']).toBe('image/png');
    const a = await agent.get(`/api/cms/buttons/${aButton}/qr.svg?download=1`);
    expect(a.headers['content-disposition']).toMatch(/^attachment; filename="qr-tambo-outlets-[a-z0-9-]+\.svg"$/);
    expect((await agent.get(`/api/cms/buttons/${aButton}/qr.svg?download=0`)).headers['content-disposition']).toBeUndefined();
  });

  it('PUBLIC_URL fija el dominio del QR y del enlace; una inválida se ignora', async () => {
    process.env.PUBLIC_URL = 'https://carta.example.com/';
    const res = await svg(agent.get(`/api/cms/buttons/${aButton}/qr.svg`).set('Host', 'otro.example.net'));
    expect(res.text).toBe(qrSvg(`https://carta.example.com/go/${aButton}`));
    const state = (await agent.get('/api/cms/state').set('Host', 'otro.example.net')).body;
    expect(state.buttons.find((b: any) => b.id === aButton).link).toBe(`https://carta.example.com/go/${aButton}`);

    for (const bad of ['javascript:alert(1)', 'https://user:clave@carta.example.com', 'https://carta.example.com/ruta', 'carta.example.com']) {
      process.env.PUBLIC_URL = bad;
      const r = await svg(agent.get(`/api/cms/buttons/${aButton}/qr.svg`).set('Host', 'otro.example.net').set('X-Forwarded-Proto', 'https'));
      expect(r.status, bad).toBe(200);
      expect(r.text, bad).toBe(qrSvg(`https://otro.example.net/go/${aButton}`));
    }
  });

  it('sin PUBLIC_URL el dominio sale de x-forwarded-host / x-forwarded-proto; un host raro da 400', async () => {
    delete process.env.PUBLIC_URL;
    const ok = await svg(agent.get(`/api/cms/buttons/${aButton}/qr.svg`).set('X-Forwarded-Host', 'sitio.example.org, interno').set('X-Forwarded-Proto', 'https'));
    expect(ok.text).toBe(qrSvg(`https://sitio.example.org/go/${aButton}`));
    const bad = await agent.get(`/api/cms/buttons/${aButton}/qr.svg`).set('X-Forwarded-Host', 'evil.com/ruta');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/dominio/);
    const state = (await agent.get('/api/cms/state').set('X-Forwarded-Host', 'evil.com/ruta')).body;
    expect(state.buttons.every((b: any) => b.link === null)).toBe(true);
  });

  it('state, alta, edición y orden devuelven el enlace permanente /go/<id> de cada botón', async () => {
    delete process.env.PUBLIC_URL;
    const h = { Host: 'panel.example.com', 'X-Forwarded-Proto': 'https' };
    const state = (await agent.get('/api/cms/state').set(h)).body;
    expect(state.buttons.length).toBe(9);
    for (const b of state.buttons) expect(b.link).toBe(`https://panel.example.com/go/${b.id}`);
    const created = (await asB(agent.post('/api/cms/buttons').set(h)).send({ label: 'Otro' })).body.button;
    expect(created.link).toBe(`https://panel.example.com/go/${created.id}`);
    const patched = (await asB(agent.patch(`/api/cms/buttons/${created.id}`).set(h)).send({ label: 'Otro 2' })).body.button;
    expect(patched.link).toBe(created.link);
    const ordered = (await asB(agent.put('/api/cms/buttons/order').set(h)).send({ ids: [created.id, bButton] })).body.buttons;
    expect(ordered.every((b: any) => b.link === `https://panel.example.com/go/${b.id}`)).toBe(true);
  });

  it('el enlace del QR sigue a la carta actual: /go/<id> redirige al PDF vigente y cambia al reemplazarlo', async () => {
    const id = (await asB(agent.post('/api/cms/buttons')).send({ label: 'Semanal' })).body.button.id;
    await asB(agent.patch(`/api/cms/buttons/${id}`)).send({ kind: 'link', url: 'https://example.com/semana-1.pdf', active: true });
    expect((await request(app).get(`/go/${id}`).set('User-Agent', 'Mozilla/5.0 Chrome/126')).headers.location).toBe('https://example.com/semana-1.pdf');
    const before = (await svg(asB(agent.get(`/api/cms/buttons/${id}/qr.svg`)).set('Host', 'x.example.com'))).text;
    await asB(agent.patch(`/api/cms/buttons/${id}`)).send({ url: 'https://example.com/semana-2.pdf' });
    expect((await request(app).get(`/go/${id}`).set('User-Agent', 'Mozilla/5.0 Chrome/126')).headers.location).toBe('https://example.com/semana-2.pdf');
    expect((await svg(asB(agent.get(`/api/cms/buttons/${id}/qr.svg`)).set('Host', 'x.example.com'))).text).toBe(before); // el QR no cambia
  });
});

describe('QR: panel', () => {
  const js = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', 'cms', 'cms.js'), 'utf8');
  const css = fs.readFileSync(path.join(process.cwd(), 'public', 'assets', 'cms', 'cms.css'), 'utf8');
  const fn = js.slice(js.indexOf('function qrSection(b)'), js.indexOf('function saveButtonOrder'));

  it('bloque plegable «Código QR (opcional)», cerrado por defecto, que pide la imagen al abrirse', () => {
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toContain("'details'");
    expect(fn).toContain("'summary'");
    expect(fn).toContain('Código QR (opcional)');
    expect(fn).not.toMatch(/open:|\.open = true|setAttribute\('open'/); // cerrado por defecto
    expect(fn).toMatch(/addEventListener\('toggle'/);
    // El src del QR se fija solo dentro del evento toggle, nunca al crear el editor.
    expect(fn.match(/\.src = /g)).toHaveLength(1);
    expect(fn).toMatch(/addEventListener\('toggle', \(\) => \{\s*if \(box\.open && !img\.getAttribute\('src'\)\) img\.src = url\('svg'\)/);
    expect(fn).toContain('qr.${ext}');
    expect(fn).toContain('landing=${encodeURIComponent(landingId)}');
  });

  it('contenido: QR 176 px con alt, enlace de solo lectura con Copiar (aria-live), descargas y avisos', () => {
    expect(fn).toContain('width: 176');
    expect(fn).toContain('Código QR del botón');
    expect(fn).toContain('readonly: true');
    expect(fn).toContain("'aria-live': 'polite'");
    expect(fn).toContain('Copiar');
    expect(fn).toContain('Copiado');
    expect(fn).toContain('Descargar SVG');
    expect(fn).toContain('Descargar PNG');
    expect(fn).toContain("download: ''");
    expect(fn).toContain("url('svg', 'download=1')");
    expect(fn).toContain("url('png', 'download=1')");
    expect(fn).toContain('Este botón está oculto o no tiene carta: el QR llevaría a la página principal.');
    expect(fn).toContain('Este QR siempre abre la carta actual de este botón: cuando cambies el PDF, el QR no cambia. Si ocultas o borras el botón, llevará a la página principal.');
    expect(fn).toContain('Útil para botones cuyo PDF cambia seguido (por ejemplo, un cronograma semanal).');
  });

  it('solo botones guardados (con id y enlace), sin innerHTML, y el aviso se actualiza con el botón', () => {
    expect(fn).toContain('if (!b.id || !b.link) return null;');
    expect(fn).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
    expect(js).toContain("qrSection(b), foot]");
    expect(js).toContain("$('.qr-box', body)?._sync?.()");
    expect(fn).toContain('warn.hidden = Boolean(b.active && b.url)');
  });

  it('estilos del bloque: plegable, sin desbordes a 320 px', () => {
    for (const sel of ['.qr-box', '.qr-box > summary', '.qr-inner', '.qr-img', '.qr-link-row', '.qr-warn', '.qr-actions', '.qr-copied']) expect(css, sel).toContain(sel);
    expect(css).toMatch(/\.qr-img \{[^}]*width: 176px[^}]*max-width: 100%/);
    expect(css).toMatch(/\.qr-link-row input \{[^}]*min-width: 0/);
    expect(css).toMatch(/\.qr-actions \{[^}]*flex-wrap: wrap/);
  });

  it('el HTML del panel no cambia (la sección se arma por JS) y cada $("#id") del JS existe en cms.html', () => {
    const html = fs.readFileSync(path.join(process.cwd(), 'templates', 'cms.html'), 'utf8');
    const used = new Set([...js.matchAll(/\$\('#([\w-]+)'\)/g)].map((m) => m[1]!));
    expect(used.size).toBeGreaterThan(20);
    for (const id of used) expect(html, id).toContain(`id="${id}"`);
  });
});
