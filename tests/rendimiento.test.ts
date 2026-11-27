// Velocidad de carga de la foto de fondo: se precarga desde el <head>, se optimiza al subirla y se guarda en caché.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderPage } from '../src/render.js';
import { defaultSettingsFor, type Settings } from '../src/validation.js';
import type { ClientConfig } from '../src/seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

const page = (template: 'cartas' | 'experiencias', over: Record<string, unknown> = {}, opts: { preview?: boolean } = {}) =>
  renderPage({ settings: { ...defaultSettingsFor(template), ...over } as Settings, buttons: [], socials: [], landing: { template } }, opts);

describe('la foto de fondo se precarga', () => {
  const URL_FOTO = 'https://abc.supabase.co/storage/v1/object/public/media/intursa/aquspa/fondo/mwz1-fondo.webp';
  const LINK = `<link rel="preload" as="image" href="${URL_FOTO}" fetchpriority="high">`;

  for (const template of ['cartas', 'experiencias'] as const) {
    it(`${template}: justo después del <title> y antes de cualquier hoja de estilo externa`, () => {
      const html = page(template, { fondo_tipo: 'imagen', fondo_imagen_url: URL_FOTO });
      expect(html).toContain(`</title>\n${LINK}\n`);
      expect(html.indexOf(LINK)).toBeLessThan(html.indexOf('fonts.googleapis.com'));
      expect(html.indexOf(LINK)).toBeLessThan(html.indexOf('cdnjs.cloudflare.com'));
      expect(html.indexOf(LINK)).toBeLessThan(html.indexOf('<style>'));
      expect(html.match(/rel="preload" as="image"/g)).toHaveLength(1);
      expect(html).not.toContain('{{');
      // También en la vista previa del panel.
      expect(page(template, { fondo_tipo: 'imagen', fondo_imagen_url: URL_FOTO }, { preview: true })).toContain(LINK);
    });

    it(`${template}: con color sólido o sin foto no hay nada que precargar (y la página no cambia)`, () => {
      for (const over of [{ fondo_tipo: 'color', fondo_imagen_url: URL_FOTO }, { fondo_tipo: 'imagen', fondo_imagen_url: '' }]) {
        const html = page(template, over);
        expect(html).not.toContain('rel="preload" as="image"');
        expect(html).toContain('</title>\n');
      }
    });
  }

  it('la dirección va escapada (no se puede salir del atributo)', () => {
    const html = page('cartas', { fondo_tipo: 'imagen', fondo_imagen_url: 'https://x.test/a"onload="alert(1)' });
    expect(html).toContain('href="https://x.test/a&quot;onload=&quot;alert(1)"');
    expect(html).not.toContain('href="https://x.test/a"onload');
  });

  it('subida local (/uploads/...) también se precarga', () => {
    expect(page('cartas', { fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/intursa/fondo/a1-f.webp' })).toContain('<link rel="preload" as="image" href="/uploads/intursa/fondo/a1-f.webp" fetchpriority="high">');
  });
});

describe('fotos de fondo livianas desde el inicio (client.json)', () => {
  const config = JSON.parse(read('clients', 'intursa', 'client.json')) as ClientConfig;
  const seedDir = path.join(root, 'clients', 'intursa', 'seed');

  it('todas las landings usan fondos WebP', () => {
    for (const l of config.landings!) expect(l.assets?.fondo, l.slug).toMatch(/\.webp$/);
  });

  it('con la carpeta seed a la mano: cada fondo existe, es WebP real y pesa menos de 450 KB', () => {
    if (!fs.existsSync(seedDir)) return; // seed no va a git: solo se comprueba en el PC donde está
    for (const l of config.landings!) {
      const file = path.join(seedDir, l.is_default ? '' : l.slug, l.assets!.fondo!);
      const buf = fs.readFileSync(file);
      expect(buf.subarray(0, 4).toString('latin1'), l.slug).toBe('RIFF');
      expect(buf.subarray(8, 12).toString('latin1'), l.slug).toBe('WEBP');
      expect(buf.length, `${l.slug}: ${buf.length} bytes`).toBeLessThan(450 * 1024);
    }
  });

  it('las landings de "cartas" usan como color de carga el promedio de su foto (oscuro), no blanco', () => {
    for (const l of config.landings!.filter((x) => x.template === 'cartas')) {
      const hex = String(l.settings?.color_fondo);
      expect(hex, l.slug).toMatch(/^#[0-9a-f]{6}$/);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect((r! + g! + b!) / 3, `${l.slug} ${hex}`).toBeLessThan(110);
    }
  });
});

describe('panel: las fotos se optimizan solas al subirlas (sin controles)', () => {
  const js = read('public', 'assets', 'cms', 'cms.js');
  const cms = read('templates', 'cms.html');
  const css = read('public', 'assets', 'cms', 'cms.css');

  it('cms.js: fondo ≤ 2000 px en WebP (JPEG de respaldo) y logo ≤ 800 px conservando la transparencia', () => {
    expect(js).toContain('const IMG_MAX_SIDE = { fondo: 2000, logo: 800 };');
    expect(js).toContain("toBlob('image/webp', 0.8)");
    expect(js).toContain("toBlob('image/jpeg', 0.82)");
    expect(js).toContain("toBlob('image/png')"); // logo: PNG sin pérdida (la transparencia se conserva)
    expect(js).toContain("imageOrientation: 'from-image'");
    expect(js).toContain('const worthIt = blob && (blob.size < file.size || (scale < 1 && blob.size <= file.size * 1.25));');
    expect(js).toContain('if (!worthIt) return same;'); // si no mejora, se sube el original
  });

  it('toda subida de foto pasa por el optimizador, sin excepciones (fondo, arrastrar y soltar, logo)', () => {
    expect(js).toContain('const opt = await optimizeImage(file, purpose);');
    expect(js).toContain('const target = await uploadFile(opt.file, purpose,');
    // Las tres entradas (botón del fondo, arrastrar al encuadre, logo) usan handleImage / wireImageUpload.
    expect(js).toContain("wireImageUpload($('#bg-file'), 'fondo'");
    expect(js).toContain("acceptDrops($('#focus-stage'), (file) => handleImage(file, 'fondo'");
    expect(js).toContain("wireImageUpload($('#logo-file'), 'logo'");
    expect(js).toContain("acceptDrops($('#logo-stage'), (file) => handleImage(file, 'logo'");
    // Nadie sube un archivo de imagen sin pasar por handleImage.
    expect(js.match(/uploadFile\(/g)!.length).toBe(3); // definición + handleImage (imágenes) + PDF de botones
  });

  it('no hay botón «Optimizar foto», ni aviso de peso, ni nada que decidir', () => {
    for (const marca of ['bg-optimize', 'bg-weight', 'Optimizar foto']) {
      expect(cms, marca).not.toContain(marca);
      expect(js, marca).not.toContain(marca);
      expect(css, marca).not.toContain(marca);
    }
    for (const fn of ['optimizeCurrentBackground', 'renderBgWeight', 'imageWeight']) expect(js, fn).not.toContain(fn);
  });
});

describe('scripts/optimizar-fondos.ts', () => {
  const script = read('scripts', 'optimizar-fondos.ts');
  it('por defecto solo ensaya; cambia algo únicamente con --confirmar y guarda respaldo antes', () => {
    expect(script).toContain("const confirm = process.argv.includes('--confirmar');");
    expect(script.indexOf('if (!confirm)')).toBeLessThan(script.indexOf('Respaldo guardado'));
    expect(script.indexOf('Respaldo guardado')).toBeLessThan(script.indexOf('getStorage().put('));
  });
  it('solo toca una foto que es, byte por byte, un original de seed/ con versión .webp (nunca una foto propia)', () => {
    expect(script).toContain('map.get(sha(bytes))');
    expect(script).toContain('foto propia): no se toca');
    expect(script).toContain('ya es WebP (optimizada): no se toca');
  });
  it('tiene reversa con respaldo y no borra nada', () => {
    expect(script).toContain('async function revertir()');
    expect(script).not.toMatch(/\.remove\(|delete from/i);
  });
});

describe('caché de archivos', () => {
  it('vercel.json: las fuentes se guardan 30 días', () => {
    const v = JSON.parse(read('vercel.json'));
    expect(v.headers).toEqual([{ source: '/assets/fonts/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=2592000' }] }]);
    expect(v.rewrites).toEqual([{ source: '/(.*)', destination: '/api' }]);
  });

  it('storage.ts: los archivos subidos desde el servidor llevan Cache-Control de un año', () => {
    expect(read('src', 'storage.ts')).toContain("{ contentType, upsert: true, cacheControl: '31536000' }");
  });
});
