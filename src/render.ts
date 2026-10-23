// Motor de plantilla mínimo y render de la página pública.
// Sintaxis: {{x}} texto escapado · {{{x}}} HTML sin escapar · {{#if x}}...{{/if}} bloque condicional.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Button, Social } from './repo.js';
import type { Settings } from './validation.js';
import { NETWORKS } from './networks.js';
import { env } from './env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = new Map<string, string>();

export function loadTemplate(name: string): string {
  let tpl = cache.get(name);
  if (!tpl) {
    tpl = fs.readFileSync(path.join(root, 'templates', name), 'utf8');
    if (env.production) cache.set(name, tpl); // en local se relee para ver los cambios al instante
  }
  return tpl;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTemplate(tpl: string, data: Record<string, unknown>): string {
  return tpl
    .replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, key, body) => (data[key] ? body : ''))
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => String(data[key] ?? ''))
    .replace(/\{\{(\w+)\}\}/g, (_, key) => escapeHtml(data[key]));
}

function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r]/g, (c) => encodeURIComponent(c))}")`;
}

export interface PageData {
  settings: Settings;
  buttons: Button[];
  socials: Social[];
}

/**
 * preview = true: vista previa dentro del CMS. Los botones apuntan directo a su destino
 * (no pasan por /go, así no cuentan clics) y todo se abre en otra pestaña.
 */
export function renderPage({ settings: s, buttons, socials }: PageData, opts: { preview?: boolean; noindex?: boolean } = {}): string {
  const visibleButtons = buttons.filter((b) => b.active && b.url);
  const botones_html = visibleButtons
    .map((b) => {
      const href = opts.preview ? b.url : `/go/${b.id}`;
      const target = b.new_tab || opts.preview ? ' target="_blank" rel="noopener"' : '';
      return `<a class="boton" href="${escapeHtml(href)}"${target}>${escapeHtml(b.label)}</a>`;
    })
    .join('\n    ');

  // Las redes pasan por /go/social para contar el clic. Enlace directo (sin contar) en la vista
  // previa y en mailto:, porque redirigir con 302 a mailto: no funciona igual en todos los navegadores.
  const redes_html = socials
    .filter((r) => r.active && r.url && r.network in NETWORKS)
    .map((r) => {
      const n = NETWORKS[r.network];
      const href = opts.preview || /^mailto:/i.test(r.url) ? r.url : `/go/social/${r.id}`;
      return `<a href="${escapeHtml(href)}" aria-label="${escapeHtml(n.label)}" target="_blank" rel="noopener"><i class="${n.icon}"></i></a>`;
    })
    .join('\n      ');

  const useImage = s.fondo_tipo === 'imagen' && s.fondo_imagen_url;

  let html = renderTemplate(loadTemplate('pagina.html'), {
    ...s,
    fondo_imagen_css: useImage ? cssUrl(s.fondo_imagen_url) : '',
    novedades_url: s.novedades_activo === '1' ? s.novedades_url : '',
    botones_html,
    redes_html,
  });

  const head: string[] = [];
  if (opts.noindex) head.push('<meta name="robots" content="noindex, nofollow">');
  if (opts.preview) head.push('<base target="_blank">');
  if (head.length) html = html.replace('</head>', `${head.join('\n')}\n</head>`);
  return html;
}
