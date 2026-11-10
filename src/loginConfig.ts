// Fotos de fondo de la página de login del panel (/cms_login).

import { env } from './env.js';
import { escapeHtml } from './render.js';

/** Enlaces https de las fotos de fondo del login (se rotan en orden). Vacío = solo degradado. */
export const LOGIN_FONDOS: string[] = [];

const MAX_FONDOS = 6;
// Espacios, controles, comillas, paréntesis, < >, barra invertida y acento grave: romperían CSS/HTML.
const CARACTERES_PROHIBIDOS = /[\s\u0000-\u001f\u007f"'`()<>\\]/;

/** Devuelve la URL normalizada si es segura para usarse como fondo; si no, null. */
function urlSegura(raw: string): string | null {
  const s = raw.trim();
  if (!s || s.length > 2048 || CARACTERES_PROHIBIDOS.test(s)) return null;
  if (!/^https?:\/\//i.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !env.production)) return null;
  if (u.username || u.password) return null;
  const href = u.href;
  return CARACTERES_PROHIBIDOS.test(href) ? null : href;
}

/**
 * Lista efectiva de fotos: la variable de entorno LOGIN_FONDOS (enlaces separados por coma) si trae algo;
 * si no, la constante LOGIN_FONDOS. Se descartan las URLs inválidas y se conservan como máximo 6.
 */
export function loginFondos(): string[] {
  const deEntorno = (process.env.LOGIN_FONDOS ?? '').trim();
  const crudas = deEntorno ? deEntorno.split(',') : LOGIN_FONDOS;
  const out: string[] = [];
  for (const item of crudas) {
    const url = urlSegura(String(item));
    if (url) out.push(url);
    if (out.length >= MAX_FONDOS) break;
  }
  return out;
}

/** HTML de las capas de fondo (el enlace va escapado en data-src; el script del login las carga). */
export function fondosHtml(urls: string[]): string {
  return urls.map((u) => `<div class="fondo-slide" data-src="${escapeHtml(u)}"></div>`).join('');
}
