// Motor de plantilla mínimo y render de la página pública.
// Sintaxis: {{x}} texto escapado · {{{x}}} HTML sin escapar · {{#if x}}...{{/if}} bloque condicional.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Button, Social } from './repo.js';
import { BOTON_PESOS, defaultSettingsFor, type BotonPeso, type Settings, type Template } from './validation.js';
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

/** url("...") seguro dentro de <style>: comillas, barras, saltos de línea y < > se codifican. */
function cssUrl(url: string): string {
  return `url("${url.replace(/["\\\n\r<>]/g, (c) => encodeURIComponent(c))}")`;
}

export interface PageData {
  settings: Settings;
  buttons: Button[];
  socials: Social[];
  /** Plantilla de la landing; sin ella, "cartas" (la página original). */
  landing?: { template: Template };
}

const TEMPLATE_FILES: Record<Template, string> = {
  cartas: 'pagina.html',
  experiencias: 'experiencias.html',
};

/** Script de la vista previa (arrastrar el logo). Mismo origen; el panel lo permite con sandbox="allow-scripts". */
const PREVIEW_DRAG_SCRIPT = '<script src="/assets/cms/preview-drag.js" defer></script>';

/** Entero acotado a partir del ajuste (ya validado al guardar; se vuelve a acotar por seguridad). */
function intSetting(value: unknown, min: number, max: number, fallback: number): number {
  // El signo "-" solo se admite cuando el rango incluye negativos (p. ej. logo_x: −50…50).
  const n = (min < 0 ? /^-?\d{1,3}$/ : /^\d{1,3}$/).test(String(value ?? '')) ? Number(value) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) + 0 : fallback; // "+ 0" evita "-0"
}

/** Porcentaje entero acotado → número CSS con 2 decimales (85 → "0.85"). */
function pctToCss(value: unknown, min: number, max: number, fallback: number): string {
  return (intSetting(value, min, max, fallback) / 100).toFixed(2);
}

/**
 * Ancho medio de avance de Sofia Pro por peso, en em (advance / unitsPerEm). Sale de los OTF originales
 * (clients/intursa/seed/fuentes/SofiaPro{Light,Regular,Medium,SemiBold,Bold,Black}.otf) leídos con fontTools:
 * promedio simple de A–Z, Á É Í Ó Ú Ñ Ü, 0–9, espacio y & / - (los botones van en mayúsculas).
 * Sirve para compensar con letter-spacing el ancho extra de la negrita (ver boton_ls_reposo_css).
 */
export const SOFIA_ANCHO_EM: Record<BotonPeso, number> = {
  '300': 0.59068,
  '400': 0.59562,
  '500': 0.59706,
  '600': 0.60272,
  '700': 0.60651,
  '900': 0.61266,
};

/** Peso permitido (lista cerrada) a partir del ajuste; cualquier otro valor → el de por defecto. */
function pesoBoton(value: unknown, fallback: BotonPeso): BotonPeso {
  const v = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return (BOTON_PESOS as readonly string[]).includes(v) ? (v as BotonPeso) : fallback;
}

/**
 * Letter-spacing extra (en em) de la capa de reposo para que ocupe lo mismo que la capa de hover:
 * ancho[hover] − ancho[reposo], a 4 decimales. Positivo si hover es más grueso, negativo si es más fino, "0em" si son iguales.
 */
export function botonLsReposo(reposo: BotonPeso, hover: BotonPeso): string {
  const diff = Math.round((SOFIA_ANCHO_EM[hover] - SOFIA_ANCHO_EM[reposo]) * 1e4) / 1e4;
  return diff === 0 ? '0em' : `${diff.toFixed(4)}em`;
}

const LOGO_POSITIONS = {
  left: { align: 'flex-start', text: 'left', margin: '0 auto 0 0' },
  center: { align: 'center', text: 'center', margin: '0 auto' },
  right: { align: 'flex-end', text: 'right', margin: '0 0 0 auto' },
} as const;

/** Valores calculados y seguros para el CSS de las plantillas. */
export function layoutValues(s: Settings, template: Template) {
  const d = defaultSettingsFor(template);
  const pos = LOGO_POSITIONS[s.logo_posicion as keyof typeof LOGO_POSITIONS] ?? LOGO_POSITIONS.center;
  const x = intSetting(s.fondo_foco_x, 0, 100, 50);
  const y = intSetting(s.fondo_foco_y, 0, 100, 50);
  // Solo "experiencias": peso del texto de los botones en reposo / al pasar el mouse y compensación de ancho.
  const pesoReposo = pesoBoton(s.boton_peso_reposo, '400');
  const pesoHover = pesoBoton(s.boton_peso_hover, '700');
  return {
    logo_ancho: String(intSetting(s.logo_ancho, 60, 400, Number(d.logo_ancho))),
    // Desplazamiento horizontal fino del logo (% de .marca), solo lo usa "experiencias". Basura → 0.
    logo_x_css: String(intSetting(s.logo_x, -50, 50, 0)),
    // Solo "experiencias": escalas de texto (70…140 % → 0.70…1.40) y degradado de celular (0…100 % → 0.00…1.00).
    // Basura → valor por defecto (1.00 y 0.70); fuera de rango → acotado.
    texto_titulo_escala_css: pctToCss(s.texto_titulo_escala, 70, 140, 100),
    texto_botones_escala_css: pctToCss(s.texto_botones_escala, 70, 140, 100),
    texto_redes_escala_css: pctToCss(s.texto_redes_escala, 70, 140, 100),
    degradado_celular_css: pctToCss(s.degradado_celular, 0, 100, 70),
    boton_peso_reposo_css: pesoReposo,
    boton_peso_hover_css: pesoHover,
    boton_ls_reposo_css: botonLsReposo(pesoReposo, pesoHover),
    logo_align: pos.align,
    logo_text_align: pos.text,
    logo_margin: pos.margin,
    // 50% 50% se escribe "center", igual que la plantilla original.
    fondo_foco_css: x === 50 && y === 50 ? 'center' : `${x}% ${y}%`,
  };
}

/**
 * Texto de redes en HTML ya escapado. Con una "/" se parte en la primera en dos líneas
 * ("Síguenos en /" y "Follow us on"); sin barra, o con un lado vacío, va en un solo <span>.
 */
export function redesTituloHtml(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const i = text.indexOf('/');
  if (i >= 0) {
    const before = text.slice(0, i).trim();
    const after = text.slice(i + 1).trim();
    if (before && after) return `<span class="l">${escapeHtml(`${before} /`)}</span> <span class="l">${escapeHtml(after)}</span>`;
  }
  return `<span>${escapeHtml(text)}</span>`;
}

/**
 * preview = true: vista previa dentro del CMS. Los botones apuntan directo a su destino
 * (no pasan por /go, así no cuentan clics) y todo se abre en otra pestaña.
 */
export function renderPage({ settings, buttons, socials, landing }: PageData, opts: { preview?: boolean; noindex?: boolean } = {}): string {
  const template: Template = landing?.template && landing.template in TEMPLATE_FILES ? landing.template : 'cartas';
  const s: Settings = { ...defaultSettingsFor(template), ...settings };
  const visibleButtons = buttons.filter((b) => b.active && b.url);
  const botones_html = visibleButtons
    .map((b) => {
      const href = opts.preview ? b.url : `/go/${b.id}`;
      const target = b.new_tab || opts.preview ? ' target="_blank" rel="noopener"' : '';
      const label = escapeHtml(b.label);
      // "experiencias": dos capas con la misma etiqueta (reposo y hover) para fundir el grosor; la de hover es solo visual.
      // "cartas": el botón de siempre.
      const inner = template === 'experiencias' ? `<span class="b-r">${label}</span><span class="b-h" aria-hidden="true">${label}</span>` : label;
      return `<a class="boton" href="${escapeHtml(href)}"${target}>${inner}</a>`;
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

  let html = renderTemplate(loadTemplate(TEMPLATE_FILES[template]), {
    ...s,
    ...layoutValues(s, template),
    fondo_imagen_css: useImage ? cssUrl(s.fondo_imagen_url) : '',
    novedades_url: s.novedades_activo === '1' ? s.novedades_url : '',
    botones_html,
    redes_html,
    redes_titulo_html: redesTituloHtml(s.redes_titulo),
    // Arrastre del logo: solo en la vista previa del panel y solo en "experiencias" (nunca en la página pública).
    preview_script_html: opts.preview && template === 'experiencias' ? PREVIEW_DRAG_SCRIPT : '',
  });

  const head: string[] = [];
  if (opts.noindex) head.push('<meta name="robots" content="noindex, nofollow">');
  if (opts.preview) head.push('<base target="_blank">');
  if (head.length) html = html.replace('</head>', `${head.join('\n')}\n</head>`);
  return html;
}
