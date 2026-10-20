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
