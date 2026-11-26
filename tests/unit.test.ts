import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { deviceType, shouldCount } from '../src/tracking.js';
import { escapeHtml, renderTemplate } from '../src/render.js';
import { safeFileName } from '../src/storage.js';

describe('deviceType', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126.0 Mobile Safari/537.36', 'mobile'],
    ['Mozilla/5.0 (Linux; Android 13; SM-X200) Chrome/126.0 Safari/537.36', 'tablet'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'tablet'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0', 'desktop'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15', 'desktop'],
  ])('%s → %s', (ua, expected) => expect(deviceType(ua)).toBe(expected));

  it('usa la pista Sec-CH-UA-Mobile', () => {
    expect(deviceType('Mozilla/5.0 (Linux) Chrome/126.0', '?1')).toBe('mobile');
  });
});

describe('shouldCount', () => {
  const req = (ua: string, extra: Record<string, string> = {}, method = 'GET') => ({ method, headers: { 'user-agent': ua, ...extra } });
  it('cuenta navegadores reales', () => expect(shouldCount(req('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0'))).toBe(true));
  it('ignora bots conocidos', () => {
    for (const ua of ['Googlebot/2.1', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'curl/8.0', 'Mozilla/5.0 (compatible; bingbot/2.0)']) {
      expect(shouldCount(req(ua)), ua).toBe(false);
    }
  });
  it('ignora sin User-Agent, HEAD y precargas', () => {
    expect(shouldCount(req(''))).toBe(false);
    expect(shouldCount(req('Mozilla/5.0 Chrome/126', {}, 'HEAD'))).toBe(false);
    expect(shouldCount(req('Mozilla/5.0 Chrome/126', { 'sec-purpose': 'prefetch;prerender' }))).toBe(false);
  });
});

describe('plantilla', () => {
  it('escapa, inserta HTML crudo y resuelve condicionales', () => {
    const out = renderTemplate('{{a}}|{{{b}}}|{{#if c}}sí{{/if}}{{#if d}}no{{/if}}', { a: '<b>"x"</b>', b: '<i>ok</i>', c: 1, d: '' });
    expect(out).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;|<i>ok</i>|sí');
  });
  it('escapeHtml', () => expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;'));
});

describe('safeFileName', () => {
  it('limpia acentos, espacios y rutas', () => {
    expect(safeFileName('Carta Año Nuevo (final).PDF')).toBe('Carta-Ano-Nuevo-final.pdf');
    expect(safeFileName('../../etc/passwd')).not.toMatch(/\/|\.\./);
    expect(safeFileName('.pdf')).toBe('pdf');
  });
});

describe('cms.js: tipo de landing en el selector (funciones puras)', () => {
  const js = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.js'), 'utf8');
  const plural = js.match(/^const plural = .*$/m)![0];
  const block = js.match(/^const TEMPLATE_LABELS = [\s\S]*?^function landingTriggerMeta\(l\) \{[\s\S]*?^\}$/m)![0];
  const sandbox: { module: { exports: Record<string, (l: unknown) => string> } } = { module: { exports: {} } };
  vm.runInNewContext(`${plural}\n${block}\nmodule.exports = { landingKind, landingOptionMeta, landingTriggerMeta };`, sandbox);
  const { landingKind, landingOptionMeta, landingTriggerMeta } = sandbox.module.exports;

  it('usa lo que va tras « – » en el nombre (no la plantilla)', () => {
    expect(landingKind({ name: 'Hotel Paracas – Aqu Spa', template: 'cartas' })).toBe('Aqu Spa');
    expect(landingKind({ name: 'Palacio del Inka – Andes Spirit Spa', template: 'cartas' })).toBe('Andes Spirit Spa');
    expect(landingKind({ name: 'Tambo del Inka – Outlets', template: 'cartas' })).toBe('Outlets');
    expect(landingKind({ name: 'Hotel Paracas – Experiencias', template: 'experiencias' })).toBe('Experiencias');
    // Solo el primer separador divide: el resto del nombre se conserva.
    expect(landingKind({ name: 'Hotel – Spa – Promos', template: 'cartas' })).toBe('Spa – Promos');
  });

  it('sin separador (o sin nada tras él) usa el nombre de la plantilla, como antes', () => {
    expect(landingKind({ name: 'Cartas del bar', template: 'cartas' })).toBe('Outlets');
    expect(landingKind({ name: 'Viajes', template: 'experiencias' })).toBe('Experiencias');
    expect(landingKind({ name: 'Hotel Paracas-Aqu Spa', template: 'experiencias' })).toBe('Experiencias'); // guion sin espacios: no es el separador
    expect(landingKind({ name: 'Hotel Paracas – ', template: 'cartas' })).toBe('Outlets');
    expect(landingKind({ name: '', template: 'desconocida' })).toBe('Outlets');
    expect(landingKind({})).toBe('Outlets');
  });

  it('línea del disparador «Hotel · Tipo» y de cada opción «Tipo · botones · clics»', () => {
    const spa = { name: 'Hotel Paracas – Aqu Spa', hotel: 'Hotel Paracas', template: 'cartas', buttons_count: 2, clicks_30d: 1 };
    expect(landingTriggerMeta(spa)).toBe('Hotel Paracas · Aqu Spa');
    expect(landingOptionMeta(spa)).toBe('Aqu Spa · 2 botones · 1 clic (30 d)');
    expect(landingTriggerMeta({ name: 'Tambo del Inka – Outlets', hotel: 'Tambo del Inka', template: 'cartas' })).toBe('Tambo del Inka · Outlets');
    expect(landingTriggerMeta({ name: 'Sin hotel', hotel: '', template: 'experiencias' })).toBe('Experiencias');
  });
});
