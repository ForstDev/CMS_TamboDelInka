// Distribución de "cartas" (cartas_distribucion: compacta / centrada), direcciones de las landings iguales a
// intursa.com.pe (slug con guion bajo) y redirecciones 301 de sus direcciones anteriores.

import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { Express } from 'express';
import { openPglite, setDb } from '../src/db.js';
import { isValidObjectPath, objectPathFor, setStorage, type Storage } from '../src/storage.js';
import { applySchema, configLandings, type ClientConfig } from '../src/seed.js';
import { createApp, LEGACY_REDIRECTS } from '../src/app.js';
import * as repo from '../src/repo.js';
import { runWithLanding } from '../src/context.js';
import { layoutValues, renderPage } from '../src/render.js';
import { DEFAULT_SETTINGS, defaultSettingsFor, isValidSlug, landingSlug, RESERVED_SLUGS, settingsPatch, type Settings } from '../src/validation.js';
import { CARTAS_BUTTONS, CARTAS_SETTINGS, CARTAS_SOCIALS } from './fixtures/cartas-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const norm = (s: string) => s.replace(/\r\n/g, '\n');

const cartas = (patch: Partial<Settings> | Record<string, unknown> = {}, { socials = CARTAS_SOCIALS as any, base = true } = {}) =>
  norm(
    renderPage({
      settings: { ...(base ? defaultSettingsFor('cartas') : {}), ...CARTAS_SETTINGS, ...patch } as Settings,
      buttons: CARTAS_BUTTONS as any,
      socials,
      landing: { template: 'cartas' },
    }),
  );

const CSS_CENTRADA = [
  '.dist-centrada .pagina { align-self: stretch; padding-bottom: 48px; }',
  '.dist-centrada .logo { margin-bottom: 48px; }',
  '.dist-centrada .menu { margin-top: auto; }',
  '.dist-centrada .pagina > :last-child { margin-bottom: auto; }',
];

describe('cartas_distribucion: validación y valores por defecto', () => {
  it('acepta solo "compacta" y "centrada" (texto exacto), con mensaje en español', () => {
    for (const v of ['compacta', 'centrada']) expect(settingsPatch.safeParse({ cartas_distribucion: v }).success, v).toBe(true);
    for (const v of ['', 'Centrada', 'CENTRADA', 'centrado', 'centrada ', 'compacta;}', 'top', '1', 'centrada; } body { color: red', null, 1, true]) {
      const r = settingsPatch.safeParse({ cartas_distribucion: v });
      expect(r.success, JSON.stringify(v)).toBe(false);
      expect(r.error?.issues[0]?.message, JSON.stringify(v)).toBe('La distribución debe ser «compacta» o «centrada»');
    }
  });

  it('por defecto "compacta" en las dos plantillas', () => {
    expect(DEFAULT_SETTINGS.cartas_distribucion).toBe('compacta');
    expect(defaultSettingsFor('cartas').cartas_distribucion).toBe('compacta');
    expect(defaultSettingsFor('experiencias').cartas_distribucion).toBe('compacta');
  });

  it('layoutValues: valor seguro (basura o ausente → compacta) y dist_centrada solo en cartas con "centrada"', () => {
    const v = (value: unknown, t: 'cartas' | 'experiencias' = 'cartas') => layoutValues({ ...defaultSettingsFor(t), cartas_distribucion: value } as Settings, t);
    expect(v('centrada')).toMatchObject({ cartas_distribucion_css: 'centrada', dist_centrada: '1' });
    expect(v('compacta')).toMatchObject({ cartas_distribucion_css: 'compacta', dist_centrada: '' });
    for (const bad of [undefined, null, '', 'x', 'Centrada', 'centrada"><script>', 1, {}]) {
      expect(v(bad), JSON.stringify(bad)).toMatchObject({ cartas_distribucion_css: 'compacta', dist_centrada: '' });
    }
    expect(v('centrada', 'experiencias')).toMatchObject({ dist_centrada: '' });
  });
});

describe('plantilla "cartas": distribución', () => {
  it('"compacta" (y sin la clave, o con basura) produce exactamente el HTML de antes', () => {
    const { cartas_distribucion: _omit, ...sinClave } = defaultSettingsFor('cartas');
    const before = norm(renderPage({ settings: { ...sinClave, ...CARTAS_SETTINGS } as Settings, buttons: CARTAS_BUTTONS as any, socials: CARTAS_SOCIALS as any, landing: { template: 'cartas' } }));
    expect(cartas({ cartas_distribucion: 'compacta' })).toBe(before);
    expect(cartas({ cartas_distribucion: 'cualquier-cosa' })).toBe(before);
    expect(cartas({}, { base: false })).toBe(before); // ajustes antiguos, sin ninguna clave nueva
    // Nada del centrado: ni la clase ni el CSS, y body sin atributos.
    expect(before).toContain('\n<body>\n');
    expect(before).not.toContain('dist-');
    expect(before).toContain('    .linea { max-width: 680px; }\n  }\n</style>');
    // Y coincide con la foto fija del HTML de siempre (mismas reglas que el test de landings).
    const fixture = norm(fs.readFileSync(path.join(here, 'fixtures', 'cartas-publica.html'), 'utf8'));
    expect(fixture.slice(fixture.indexOf('<body>'))).toBe(before.slice(before.indexOf('<body>')));
  });

  it('"centrada": clase en <body> y CSS del centrado (logo arriba, bloque al medio con márgenes automáticos)', () => {
    const html = cartas({ cartas_distribucion: 'centrada' });
    expect(html).toContain('\n<body class="dist-centrada">\n');
    for (const rule of CSS_CENTRADA) expect(html, rule).toContain(rule);
    // El CSS del centrado va al final, después de la regla de escritorio, y no deja marcadores.
    expect(html.indexOf('.dist-centrada .pagina')).toBeGreaterThan(html.indexOf('@media (min-width: 768px)'));
    expect(html).not.toContain('{{');
    // body sigue con su min-height de pantalla completa (svh) y su relleno; no hay anchos nuevos (sin scroll horizontal).
    expect(html).toMatch(/body \{\n    min-height: 100vh;\n    min-height: 100svh;/);
    expect(html).toContain('padding: 48px 16px 40px;');
    expect(html.slice(html.indexOf('/* ---------- Distribución'))).not.toMatch(/width|vw/);
    // Lo demás es idéntico a "compacta" (mismo contenido y mismo orden).
    const compacta = cartas({ cartas_distribucion: 'compacta' });
    const sinCentrado = html.replace(/\n  \/\* ---------- Distribución «centrada»[\s\S]*?margin-bottom: auto; \}\n/, '').replace('<body class="dist-centrada">', '<body>');
    expect(sinCentrado).toBe(compacta);
  });

  it('"centrada" sin redes ni novedades: el último bloque es la línea y no hay «Síguenos»', () => {
    const html = cartas({ cartas_distribucion: 'centrada', novedades_activo: '0' }, { socials: [] });
    expect(html).toContain('<hr class="linea">');
    expect(html).not.toContain('<footer class="redes">');
    expect(html).not.toContain('<h2>Síguenos</h2>');
    expect(html).not.toContain('class="novedades"');
  });

  it('sin redes (o con todas ocultas) no aparece el bloque «Síguenos», en las dos distribuciones', () => {
    const ocultas = CARTAS_SOCIALS.map((s) => ({ ...s, active: false }));
    for (const d of ['compacta', 'centrada'] as const) {
      for (const socials of [[], ocultas]) {
        const html = cartas({ cartas_distribucion: d }, { socials: socials as any });
        expect(html, d).not.toContain('<footer class="redes">');
        expect(html, d).not.toContain('Síguenos');
      }
      expect(cartas({ cartas_distribucion: d })).toContain('<h2>Síguenos</h2>'); // con redes visibles, sí
    }
  });

  it('"experiencias" ignora el ajuste', () => {
    const exp = (over: Partial<Settings>) =>
      norm(renderPage({ settings: { ...defaultSettingsFor('experiencias'), ...over }, buttons: CARTAS_BUTTONS as any, socials: CARTAS_SOCIALS as any, landing: { template: 'experiencias' } }));
    const base = exp({});
    expect(exp({ cartas_distribucion: 'centrada' })).toBe(base);
    expect(base).not.toContain('dist-');
  });
});

/** Las 9 landings con la misma dirección que en intursa.com.pe/<slug>/. */
const FINALES: Record<string, string> = {
  'outlets-tambodelinka': 'Tambo del Inka – Outlets',
  experiencias_palaciodelinka: 'Palacio del Inka – Experiencias',
  experiencias_hotelparacas: 'Hotel Paracas – Experiencias',
  experiencias_tambodelinka: 'Tambo del Inka – Experiencias',
  'outlets-hotelparacas': 'Hotel Paracas – Outlets',
  'palacio-outlets': 'Palacio del Inka – Outlets',
  aquspa: 'Hotel Paracas – Aqu Spa',
  'spa-palaciodelinka': 'Palacio del Inka – Andes Spirit Spa',
  'spa-tambodelinka': 'Tambo del Inka – Kallpa Spa',
};
const SPAS = ['aquspa', 'spa-palaciodelinka', 'spa-tambodelinka'];

/** Direcciones que existieron (producción y las intermedias de los spas) → dirección final. */
const ANTERIORES: Record<string, string> = {
  '/tambo-outlets': '/outlets-tambodelinka',
  '/experiencias-palacio-del-inka': '/experiencias_palaciodelinka',
  '/experiencias-hotel-paracas': '/experiencias_hotelparacas',
  '/experiencias-tambo-del-inka': '/experiencias_tambodelinka',
  '/outlets-hotel-paracas': '/outlets-hotelparacas',
  '/outlets-palacio-del-inka': '/palacio-outlets',
  '/spa-hotel-paracas': '/aquspa',
  '/spa-palacio-del-inka': '/spa-palaciodelinka',
  '/spa-tambo-del-inka': '/spa-tambodelinka',
  '/aqu-spa': '/aquspa',
  '/andes-spirit-spa': '/spa-palaciodelinka',
  '/kallpa-spa': '/spa-tambodelinka',
};

describe('direcciones (slug): guion bajo admitido', () => {
  it('acepta las 9 direcciones finales y otras con guion o guion bajo', () => {
    for (const slug of [...Object.keys(FINALES), 'experiencias_palaciodelinka', 'a_b-c', 'a1_2', 'x']) {
      expect(isValidSlug(slug), slug).toBe(true);
      expect(landingSlug.safeParse(slug).success, slug).toBe(true);
    }
  });

  it('sigue rechazando reservadas, mayúsculas, espacios, rutas y separadores mal puestos', () => {
    for (const slug of ['cms_login', 'cms', 'api', 'go', 'assets', 'uploads', 'admin', 'pdf', 'logo', 'fondo', 'login', 'preview']) {
      expect(isValidSlug(slug), slug).toBe(false);
      const r = landingSlug.safeParse(slug);
      expect(r.success, slug).toBe(false);
      expect(r.error?.issues[0]?.message, slug).toBe('Esa dirección está reservada');
    }
    const bad = ['', 'Aquspa', 'AQUSPA', 'aqu spa', ' aquspa', 'aquspa ', '../aquspa', 'a/b', 'a.b', 'a\\b', 'ñandú', 'a%20b', '_a', 'a_', '-a', 'a-', 'a__b', 'a--b', 'a-_b', 'a_-b', 'a+b', 'a'.repeat(81)];
    for (const slug of bad) {
      expect(isValidSlug(slug), slug).toBe(false);
      const r = landingSlug.safeParse(slug);
      expect(r.success, slug).toBe(false);
    }
    expect(landingSlug.safeParse('Exp_Demo').error?.issues[0]?.message).toBe('Dirección inválida (solo minúsculas, números, guiones y guion bajo)');
  });

  it('las rutas de archivos admiten la carpeta de una landing con guion bajo (sin salir de la carpeta del cliente)', () => {
    const p = objectPathFor('intursa', 'pdf', 'Carta Bar.pdf', 'experiencias_palaciodelinka');
    expect(p).toMatch(/^intursa\/experiencias_palaciodelinka\/pdf\/[a-z0-9]+-Carta-Bar\.pdf$/);
    expect(isValidObjectPath('intursa', p)).toBe(true);
    expect(isValidObjectPath('intursa', 'intursa/outlets-tambodelinka/logo/abc-logo.png')).toBe(true);
    expect(isValidObjectPath('intursa', 'intursa/pdf/abc-carta.pdf')).toBe(true);
    for (const bad of ['intursa/_x/pdf/abc-a.pdf', 'intursa/x_/pdf/abc-a.pdf', 'intursa/a__b/pdf/abc-a.pdf', 'intursa/../pdf/abc-a.pdf', 'otro/x_y/pdf/abc-a.pdf', 'intursa/X_y/pdf/abc-a.pdf']) {
      expect(isValidObjectPath('intursa', bad), bad).toBe(false);
    }
  });
});

describe('landings en client.json: direcciones iguales a intursa.com.pe', () => {
  const config = JSON.parse(fs.readFileSync(path.join(here, '..', 'clients', 'intursa', 'client.json'), 'utf8')) as ClientConfig;
  const bySlug = (slug: string) => config.landings!.find((l) => l.slug === slug);

  it('las 9 landings tienen su dirección final; la por defecto es outlets-tambodelinka', () => {
    expect(() => configLandings(config)).not.toThrow();
    expect(config.landings!.map((l) => l.slug).sort()).toEqual(Object.keys(FINALES).sort());
    for (const [slug, name] of Object.entries(FINALES)) {
      expect(bySlug(slug)?.name, slug).toBe(name);
      expect(isValidSlug(slug), slug).toBe(true);
      expect(RESERVED_SLUGS.has(slug), slug).toBe(false);
    }
    expect(config.landings!.filter((l) => l.is_default).map((l) => l.slug)).toEqual(['outlets-tambodelinka']);
  });

  it('los 3 spas: sin redes y con distribución centrada; logos sin cambios', () => {
    for (const slug of SPAS) {
      const l = bySlug(slug)!;
      expect(l.template, slug).toBe('cartas');
      expect(l.socials, slug).toEqual([]);
      expect(l.settings?.cartas_distribucion, slug).toBe('centrada');
      expect(l.buttons, slug).toHaveLength(2);
    }
    // Aqu Spa usa el logo de Hotel Paracas (decisión del cliente).
    expect(bySlug('aquspa')!.assets?.logo).toBe('logo-hotel-paracas.png');
    expect(bySlug('aquspa')!.settings?.logo_alt).toBe('Hotel Paracas, a Luxury Collection Resort – Paracas');
    expect(bySlug('spa-palaciodelinka')!.assets?.logo).toBe('logo-andes-spirit-spa.png');
    expect(bySlug('spa-tambodelinka')!.assets?.logo).toBe('logo-kallpa-spa.png');
  });

  it('los outlets y las experiencias siguen con sus redes y sin distribución guardada', () => {
    for (const slug of Object.keys(FINALES).filter((s) => !SPAS.includes(s))) {
      const l = bySlug(slug)!;
      expect(l.socials, slug).toHaveLength(2);
      expect(l.settings, slug).not.toHaveProperty('cartas_distribucion');
    }
  });

  it('LEGACY_REDIRECTS: las 12 direcciones anteriores apuntan a la final; ninguna anterior queda en client.json', () => {
    expect(LEGACY_REDIRECTS).toEqual(ANTERIORES);
    for (const target of Object.values(LEGACY_REDIRECTS)) expect(bySlug(target.slice(1)), target).toBeTruthy();
    for (const from of Object.keys(LEGACY_REDIRECTS)) expect(bySlug(from.slice(1)), from).toBeUndefined();
  });
});

describe('redirecciones 301 de las direcciones anteriores (base con las direcciones finales)', () => {
  let app: Express;
  const buttonOf: Record<string, string> = {};

  beforeAll(async () => {
    setStorage({
      mode: 'local',
      createUploadTarget: async (p) => ({ uploadUrl: '', path: p, publicUrl: `/uploads/${p}` }),
      put: async (p) => `/uploads/${p}`,
      remove: async () => {},
      publicUrl: (p) => `/uploads/${p}`,
    } satisfies Storage);
    setDb(await openPglite());
    await applySchema();
    let position = 0;
    for (const [slug, name] of Object.entries(FINALES)) {
      const isDefault = slug === 'outlets-tambodelinka';
      const template = slug.startsWith('experiencias_') ? 'experiencias' : 'cartas';
      const l = await repo.createLanding({ slug, name, hotel: name.split(' – ')[0]!, template, is_default: isDefault, position: position++ });
      await runWithLanding(l, async () => {
        await repo.saveSettings({ titulo_pagina: name, ...(SPAS.includes(slug) ? { cartas_distribucion: 'centrada' as const } : {}) });
        buttonOf[slug] = (await repo.createButton({ label: `Carta ${slug}`, kind: 'pdf', url: `/uploads/${slug}.pdf`, active: true })).id;
      });
    }
    app = createApp();
  }, 60_000);

  it('las 9 direcciones finales responden 200 con su título y su botón', async () => {
    for (const [slug, name] of Object.entries(FINALES)) {
      const r = await request(app).get(`/${slug}`);
      expect(r.status, slug).toBe(200);
      expect(r.text, slug).toContain(`<title>${name}</title>`);
      expect(r.text, slug).toContain(`/go/${buttonOf[slug]}`);
    }
    expect((await request(app).get('/aquspa')).text).toContain('<body class="dist-centrada">');
  });

  it('/ y /outlets-tambodelinka sirven la misma landing por defecto', async () => {
    const a = await request(app).get('/');
    const b = await request(app).get('/outlets-tambodelinka');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.text).toContain('<title>Tambo del Inka – Outlets</title>');
    expect(b.text).toBe(a.text);
  });

  it('las 12 direcciones anteriores → 301 a la final (con o sin barra final; se conserva la consulta)', async () => {
    for (const [from, to] of Object.entries(ANTERIORES)) {
      for (const url of [from, `${from}/`]) {
        const r = await request(app).get(url);
        expect(r.status, url).toBe(301);
        expect(r.headers.location, url).toBe(to);
      }
      const q = await request(app).get(`${from}?utm_source=qr&x=1`);
      expect(q.status, from).toBe(301);
      expect(q.headers.location, from).toBe(`${to}?utm_source=qr&x=1`);
    }
  });

  it('nada más cambia: otras rutas parecidas o inexistentes siguen en 404', async () => {
    for (const url of ['/no-existe', '/spa-hotel-paracas-2', '/spa-hotel', '/SPA-HOTEL-PARACAS', '/Tambo-Outlets', '/spa-hotel-paracas/x', '/kallpa', '/aqu_spa', '/Aquspa', '/experiencias-palaciodelinka', '/outlets_tambodelinka']) {
      const r = await request(app).get(url);
      expect(r.status, url).toBe(404);
      expect(r.text, url).toContain('Página no encontrada');
    }
    expect((await request(app).post('/spa-hotel-paracas')).status).toBe(404);
    expect((await request(app).post('/tambo-outlets')).status).toBe(404);
  });
});

describe('direcciones anteriores mientras la base aún las tiene (antes de ejecutar el script)', () => {
  let app: Express;

  beforeAll(async () => {
    setDb(await openPglite());
    await applySchema();
    const add = async (slug: string, name: string, extra: { is_default?: boolean; active?: boolean; template?: 'cartas' | 'experiencias' } = {}) => {
      const l = await repo.createLanding({ slug, name, hotel: 'H', template: extra.template ?? 'cartas', is_default: extra.is_default, active: extra.active });
      await runWithLanding(l, () => repo.saveSettings({ titulo_pagina: name }));
    };
    await add('tambo-outlets', 'Tambo del Inka – Outlets', { is_default: true });
    await add('experiencias-palacio-del-inka', 'Palacio del Inka – Experiencias', { template: 'experiencias' });
    await add('spa-hotel-paracas', 'Hotel Paracas – Aqu Spa');
    await add('andes-spirit-spa', 'Palacio del Inka – Andes Spirit Spa');
    await add('spa-tambo-del-inka', 'Tambo del Inka – Kallpa Spa (inactiva)', { active: false });
    app = createApp();
  }, 60_000);

  it('una landing activa con la dirección anterior se sirve normalmente (200, sin redirigir)', async () => {
    const cases: Record<string, string> = {
      '/tambo-outlets': 'Tambo del Inka – Outlets',
      '/experiencias-palacio-del-inka': 'Palacio del Inka – Experiencias',
      '/spa-hotel-paracas': 'Hotel Paracas – Aqu Spa',
      '/andes-spirit-spa': 'Palacio del Inka – Andes Spirit Spa',
    };
    for (const [url, name] of Object.entries(cases)) {
      for (const u of [url, `${url}/`, `${url}?utm_source=qr`]) {
        const r = await request(app).get(u);
        expect(r.status, u).toBe(200);
        expect(r.text, u).toContain(`<title>${name}</title>`);
      }
    }
    expect((await request(app).get('/')).text).toContain('<title>Tambo del Inka – Outlets</title>');
  });

  it('sin landing (o con la landing inactiva) en la dirección anterior → 301 a la final', async () => {
    for (const [from, to] of [
      ['/spa-tambo-del-inka', '/spa-tambodelinka'], // existe pero inactiva
      ['/outlets-hotel-paracas', '/outlets-hotelparacas'],
      ['/aqu-spa', '/aquspa'],
      ['/kallpa-spa', '/spa-tambodelinka'],
    ]) {
      const r = await request(app).get(from!);
      expect(r.status, from).toBe(301);
      expect(r.headers.location, from).toBe(to);
    }
    // Las finales aún no existen en esta base: 404 (no hay bucle de redirecciones).
    expect((await request(app).get('/outlets-hotelparacas')).status).toBe(404);
  });
});

describe('panel: control de distribución', () => {
  const cms = norm(fs.readFileSync(path.join(here, '..', 'templates', 'cms.html'), 'utf8'));
  const js = fs.readFileSync(path.join(here, '..', 'public', 'assets', 'cms', 'cms.js'), 'utf8');
  const css = fs.readFileSync(path.join(here, '..', 'public', 'assets', 'cms', 'cms.css'), 'utf8');

  it('tarjeta solo para cartas en Diseño, con dos opciones y la pista', () => {
    const card = cms.match(/<article class="card dist-card" data-only="cartas">[\s\S]*?<\/article>/)![0];
    expect(card).toContain('<span id="cartas-dist-label">Distribución</span>');
    expect(card).toContain('role="radiogroup" aria-labelledby="cartas-dist-label" aria-describedby="cartas-dist-hint" id="cartas-dist"');
    expect([...card.matchAll(/<button type="button" role="radio" data-value="(\w+)">(\w+)<\/button>/g)].map((m) => [m[1], m[2]])).toEqual([
      ['compacta', 'Compacta'],
      ['centrada', 'Centrada'],
    ]);
    expect(card).toContain('id="cartas-dist-hint">Centrada: deja el logo arriba y los botones al medio de la pantalla. Útil cuando hay pocos botones.</p>');
    for (const id of ['cartas-dist', 'cartas-dist-label', 'cartas-dist-hint']) expect(cms.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1);
    const i = cms.indexOf('class="card dist-card"');
    expect(i).toBeGreaterThan(cms.indexOf('data-panel="diseno"'));
    expect(i).toBeLessThan(cms.indexOf('data-panel="textos"'));
  });

  it('cms.js lo cablea como los demás ajustes (guardado inmediato → vista previa) y cms.css lo estira', () => {
    expect(js).toContain("wireSegmented($('#cartas-dist'), distValue(state.settings.cartas_distribucion ?? state.defaults?.cartas_distribucion)");
    expect(js).toContain("saveSetting('cartas_distribucion', distValue(v), { immediate: true });");
    expect(js).toContain("const distValue = (v) => (v === 'centrada' ? 'centrada' : 'compacta');");
    expect(css).toContain('.dist-card .segmented { display: flex; width: 100%; }');
  });
});
