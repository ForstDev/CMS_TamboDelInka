// Todo lo que entra desde el panel pasa por aquí antes de tocar la base de datos.

import { z } from 'zod';
import { NETWORK_KEYS } from './networks.js';

const hex = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (usa formato #RRGGBB)');

/** URL pública: http(s) absoluta o un archivo subido en modo local (/uploads/...). */
export const linkUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/[^\s"'<>]+$/i.test(v) || /^\/uploads\/[^\s"'<>]+$/.test(v), {
    message: 'El enlace debe empezar con https://',
  });

export const socialUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => v === '' || /^https?:\/\/[^\s"'<>]+$/i.test(v) || /^mailto:[^\s"'<>]+$/i.test(v), {
    message: 'El enlace debe empezar con https:// (o mailto: para correo)',
  });

const text = (max: number) => z.string().trim().max(max);
const flag = z.enum(['0', '1']);

/** Entero sin signo en texto dentro de [min, max] (sin espacios, unidades ni ceros a la izquierda). */
function intText(min: number, max: number, message: string) {
  return z
    .string()
    .trim()
    .regex(/^(0|[1-9][0-9]{0,2})$/, message)
    .refine((v) => Number(v) >= min && Number(v) <= max, { message });
}

export const TEMPLATES = ['cartas', 'experiencias'] as const;
export type Template = (typeof TEMPLATES)[number];

// Slugs que no pueden usarse como dirección de una landing (rutas del sistema y carpetas de subidas).
export const RESERVED_SLUGS = new Set([
  'cms', 'cms_login', 'api', 'go', 'assets', 'uploads', 'favicon.ico', 'robots.txt', 'sitemap.xml',
  'login', 'logout', 'admin', 'static', 'public', 'preview', 'pdf', 'logo', 'fondo',
]);

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isValidSlug = (slug: string) => slug.length <= 80 && SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);

export const landingSlug = z
  .string()
  .max(80)
  .regex(SLUG_RE, 'Dirección inválida (solo minúsculas, números y guiones)')
  .refine((v) => !RESERVED_SLUGS.has(v), { message: 'Esa dirección está reservada' });

// Cada ajuste editable de la página, con su validación y su valor por defecto.
export const settingsSchema = z.object({
  cms_nombre: text(80),
  titulo_pagina: text(120),
  meta_descripcion: text(300),
  logo_url: linkUrl,
  logo_alt: text(160),
  fondo_tipo: z.enum(['imagen', 'color']),
  fondo_imagen_url: linkUrl,
  color_fondo: hex,
  color_texto: hex,
  color_boton: hex,
  color_boton_texto: hex,
  color_boton_hover: hex,
  color_texto_boton_hover: hex,
  novedades_activo: flag,
  novedades_texto: text(200),
  novedades_link_texto: text(60),
  novedades_url: linkUrl,
  redes_titulo: text(60),
  // Logo y fondo (valores que terminan en el CSS: solo enteros acotados o una lista cerrada).
  logo_ancho: intText(60, 400, 'El ancho del logo debe ser un número entre 60 y 400'),
  logo_posicion: z.enum(['left', 'center', 'right']),
  fondo_foco_x: intText(0, 100, 'El encuadre debe ser un número entre 0 y 100'),
  fondo_foco_y: intText(0, 100, 'El encuadre debe ser un número entre 0 y 100'),
  fondo_oscurecer: intText(0, 100, 'El oscurecido debe ser un número entre 0 y 100'),
  fondo_oscurecer_arriba: intText(0, 100, 'El oscurecido debe ser un número entre 0 y 100'),
  // Títulos de la plantilla "experiencias".
  titulo_linea1: text(60),
  titulo_linea2: text(60),
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

/** Valores por defecto comunes; cada plantilla los ajusta con TEMPLATE_DEFAULTS. */
export const DEFAULT_SETTINGS: Settings = {
  cms_nombre: 'Mi página',
  titulo_pagina: 'Mi página',
  meta_descripcion: '',
  logo_url: '',
  logo_alt: '',
  fondo_tipo: 'color',
  fondo_imagen_url: '',
  color_fondo: '#ffffff',
  color_texto: '#ffffff',
  color_boton: '#ffffff',
  color_boton_texto: '#333333',
  color_boton_hover: '#333333',
  color_texto_boton_hover: '#ffffff',
  novedades_activo: '1',
  novedades_texto: '',
  novedades_link_texto: 'Click aquí',
  novedades_url: '',
  redes_titulo: 'Síguenos',
  logo_ancho: '260',
  logo_posicion: 'center',
  fondo_foco_x: '50',
  fondo_foco_y: '50',
  fondo_oscurecer: '85',
  fondo_oscurecer_arriba: '60',
  titulo_linea1: 'Experiences',
  titulo_linea2: 'Experiencias',
};

// "cartas" = la página original (logo de 260 px = el max-width de siempre).
export const TEMPLATE_DEFAULTS: Record<Template, Partial<Settings>> = {
  cartas: { logo_ancho: '260' },
  experiencias: {
    logo_ancho: '150',
    color_fondo: '#2b2b2b',
    color_texto: '#ffffff',
    color_boton: '#262626',
    color_boton_texto: '#ffffff',
    color_boton_hover: '#3a3a3a',
    color_texto_boton_hover: '#ffffff',
    redes_titulo: 'Síguenos en / Follow us on',
    novedades_activo: '0',
  },
};

export function defaultSettingsFor(template: Template): Settings {
  return { ...DEFAULT_SETTINGS, ...(TEMPLATE_DEFAULTS[template] ?? {}) };
}

export const settingsPatch = settingsSchema.partial().strict();

export const buttonCreate = z
  .object({
    label: text(80).min(1).default('Nuevo botón'),
  })
  .strict();

export const buttonPatch = z
  .object({
    label: text(80).min(1, 'El botón necesita un nombre'),
    kind: z.enum(['pdf', 'link']),
    url: linkUrl,
    file_name: text(200),
    file_path: text(400),
    new_tab: z.boolean(),
    active: z.boolean(),
  })
  .partial()
  .strict();

export const socialCreate = z
  .object({
    network: z.enum(NETWORK_KEYS),
    url: socialUrl.default(''),
  })
  .strict();

export const socialPatch = z
  .object({
    network: z.enum(NETWORK_KEYS),
    url: socialUrl,
    active: z.boolean(),
  })
  .partial()
  .strict();

export const orderBody = z.object({ ids: z.array(z.uuid()).max(200) }).strict();

export const uploadRequest = z
  .object({
    purpose: z.enum(['pdf', 'logo', 'fondo']),
    fileName: text(200).min(1),
    contentType: text(100),
    size: z.number().int().positive(),
  })
  .strict();

export const loginBody = z.object({ username: text(80).min(1), password: z.string().min(1).max(200) });

export const passwordBody = z
  .object({
    current: z.string().min(1).max(200),
    next: z.string().min(8, 'La nueva contraseña debe tener al menos 8 caracteres').max(200),
  })
  .strict();

export function firstError(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Datos inválidos';
}
