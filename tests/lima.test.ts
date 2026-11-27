// Landings de los hoteles de Lima (AC, Aloft y Westin: outlets y minibar) y fuente de marca de los botones de
// "cartas" (cartas_fuente).

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configLandings, type ClientConfig } from '../src/seed.js';
import { FUENTES_BOTONES, fuenteBotonesCss, fuenteCartas, renderPage } from '../src/render.js';
import { CARTAS_FUENTES, DEFAULT_SETTINGS, defaultSettingsFor, settingsPatch, settingsSchema, type Settings } from '../src/validation.js';
import { CARTAS_BUTTONS, CARTAS_SETTINGS, CARTAS_SOCIALS } from './fixtures/cartas-data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const norm = (s: string) => s.replace(/\r\n/g, '\n');
const config = JSON.parse(fs.readFileSync(path.join(root, 'clients', 'intursa', 'client.json'), 'utf8')) as ClientConfig;
const bySlug = (slug: string) => config.landings!.find((l) => l.slug === slug)!;

const cartas = (patch: Record<string, unknown> = {}, opts: { preview?: boolean } = {}) =>
  norm(
    renderPage(
      {
        settings: { ...defaultSettingsFor('cartas'), ...CARTAS_SETTINGS, ...patch } as Settings,
        buttons: CARTAS_BUTTONS as any,
        socials: CARTAS_SOCIALS as any,
        landing: { template: 'cartas' },
      },
      opts,
    ),
  );

describe('cartas_fuente: validación y valores por defecto', () => {
  it('acepta solo las fuentes de la lista; por defecto Poppins (la de siempre)', () => {
    expect([...CARTAS_FUENTES]).toEqual(['poppins', 'montserrat', 'code-next', 'graphik']);
    for (const v of CARTAS_FUENTES) expect(settingsPatch.safeParse({ cartas_fuente: v }).success, v).toBe(true);
    for (const v of ['', 'Poppins', 'arial', 'graphik ', 'montserrat;}', 'url(x)', null, 1, true]) {
      const r = settingsPatch.safeParse({ cartas_fuente: v });
      expect(r.success, JSON.stringify(v)).toBe(false);
      expect(r.error?.issues[0]?.message).toBe('La fuente de los botones debe ser poppins, montserrat, code-next o graphik');
    }
    expect(DEFAULT_SETTINGS.cartas_fuente).toBe('poppins');
    expect(defaultSettingsFor('cartas').cartas_fuente).toBe('poppins');
    expect(defaultSettingsFor('experiencias').cartas_fuente).toBe('poppins');
  });

  it('fuenteCartas: valor seguro (basura o ausente → poppins)', () => {
    for (const v of CARTAS_FUENTES) expect(fuenteCartas(v)).toBe(v);
    for (const v of [undefined, null, '', 'x', 'Graphik', '"><script>', 3, {}]) expect(fuenteCartas(v), JSON.stringify(v)).toBe('poppins');
  });
});

describe('cartas_fuente: CSS de la página', () => {
  it('poppins (o basura): sin CSS nuevo, la página es la de siempre', () => {
    const base = cartas();
    expect(cartas({ cartas_fuente: 'poppins' })).toBe(base);
    expect(cartas({ cartas_fuente: 'otra' })).toBe(base);
    expect(base).not.toContain('@font-face');
    expect(base).not.toContain('Fuente de los botones');
    expect(fuenteBotonesCss('poppins')).toBe('');
  });

  it('cada fuente de marca: @font-face con su WOFF2 (que existe) y la regla de .boton después de la de siempre', () => {
    for (const key of ['montserrat', 'code-next', 'graphik'] as const) {
      const f = FUENTES_BOTONES[key];
      const html = cartas({ cartas_fuente: key });
      expect(html, key).toContain(`  /* ---------- Fuente de los botones (fuente de marca del hotel) ---------- */\n  @font-face {\n    font-family: "${f.familia}";\n    src: url("${f.archivo}") format("woff2");\n    font-weight: ${f.peso};\n    font-style: normal;\n    font-display: swap;\n  }\n`);
      const rule = `  .boton { font-family: "${f.familia}", "Poppins", Arial, sans-serif; font-weight: ${f.peso}; }\n`;
      expect(html, key).toContain(rule);
      // Va al final del <style>, después de la regla .boton original y de la de escritorio (para ganarle).
      expect(html.indexOf(rule)).toBeGreaterThan(html.indexOf('  .boton {\n'));
      expect(html.indexOf(rule)).toBeGreaterThan(html.indexOf('@media (min-width: 768px)'));
      expect(html.indexOf(rule)).toBeLessThan(html.indexOf('</style>'));
      expect(html).not.toContain('{{');
      // El archivo existe y es un WOFF2 de verdad.
      const file = path.join(root, 'public', f.archivo);
      expect(fs.existsSync(file), f.archivo).toBe(true);
      expect(fs.readFileSync(file).subarray(0, 4).toString('latin1'), f.archivo).toBe('wOF2');
      // Quitando el bloque, el HTML es exactamente el de siempre.
      expect(html.replace(/\n {2}\/\* -{10} Fuente de los botones[\s\S]*?font-weight: \d+; \}\n/, '')).toBe(cartas());
    }
  });

  it('convive con la distribución centrada y el ajuste fino del logo; no afecta a "experiencias"', () => {
    const html = cartas({ cartas_fuente: 'graphik', cartas_distribucion: 'centrada', logo_x: '10' });
    expect(html).toContain('font-family: "Graphik Starwood"');
    expect(html).toContain(':root { --logo-x: 10; }');
    expect(html).toContain('<body class="dist-centrada">');
    const exp = renderPage({ settings: { ...defaultSettingsFor('experiencias'), cartas_fuente: 'graphik' } as Settings, buttons: [], socials: [], landing: { template: 'experiencias' } });
    expect(exp).not.toContain('Graphik');
  });
});

describe('panel: la fuente de los botones es parte de la estructura de cada landing', () => {
  it('el panel no ofrece cambiarla (la define client.json: Montserrat, Code Next o Graphik)', () => {
    const cms = fs.readFileSync(path.join(root, 'templates', 'cms.html'), 'utf8');
    for (const marca of ['btn-fuente', 'fuente-field', 'cartas_fuente', 'Fuente de los botones']) expect(cms, marca).not.toContain(marca);
  });
});

describe('client.json: landings de los hoteles de Lima', () => {
  const LIMA = {
    'outlets-ac': { hotel: 'AC Hotel Lima Miraflores', fuente: 'montserrat', logo: 'logo-ac-hotels.png', botones: 9, red: 'aclimamiraflores' },
    acminibar: { hotel: 'AC Hotel Lima Miraflores', fuente: 'montserrat', logo: 'logo-ac-hotels.png', botones: 2, red: 'aclimamiraflores' },
    outletsaloft: { hotel: 'Aloft Lima Miraflores', fuente: 'code-next', logo: 'logo-aloft-lima-miraflores.png', botones: 7, red: 'aloftlimamiraflores' },
    aloftminibar: { hotel: 'Aloft Lima Miraflores', fuente: 'code-next', logo: 'logo-aloft-lima-miraflores.png', botones: 1, red: 'aloftlimamiraflores' },
    outletswestin: { hotel: 'The Westin Lima', fuente: 'graphik', logo: 'logo-westin-lima.png', botones: 9, red: 'westinlima' },
    minibarwestin: { hotel: 'The Westin Lima', fuente: 'graphik', logo: 'logo-westin-lima.png', botones: 1, red: 'westinlima' },
  } as const;

  it('cargan sin errores y con los ajustes válidos', () => {
    expect(() => configLandings(config)).not.toThrow();
    for (const slug of Object.keys(LIMA)) {
      const l = bySlug(slug);
      expect(() => settingsSchema.parse({ ...defaultSettingsFor('cartas'), ...l.settings }), slug).not.toThrow();
    }
  });

  it('mismo diseño que los outlets: plantilla cartas, distribución compacta, fondo de Lima, logo, botones y redes', () => {
    for (const [slug, e] of Object.entries(LIMA)) {
      const l = bySlug(slug);
      expect(l.template, slug).toBe('cartas');
      expect(l.is_default, slug).toBeUndefined();
      expect(l.hotel, slug).toBe(e.hotel);
      expect(l.name.startsWith(`${e.hotel} – `), slug).toBe(true);
      expect(l.position, slug).toBe(slug.includes('minibar') ? 3 : 0);
      // Pocos botones: logo cerca de los botones (compacta, como los outlets), no centrada.
      expect(l.settings?.cartas_distribucion ?? 'compacta', slug).toBe('compacta');
      expect(l.settings?.cartas_fuente, slug).toBe(e.fuente);
      expect(l.assets, slug).toEqual({ logo: e.logo, fondo: 'fondo-lima.webp' });
      expect(l.buttons, slug).toHaveLength(e.botones);
      for (const b of l.buttons!) expect(b.pdf, `${slug}: ${b.label}`).toMatch(/\.pdf$/);
      // Redes oficiales del hotel (las que enlaza su página en marriott.com).
      expect(l.socials, slug).toEqual([
        { network: 'facebook', url: `https://www.facebook.com/${e.red}/` },
        { network: 'instagram', url: `https://www.instagram.com/${e.red}/` },
      ]);
    }
  });
});
