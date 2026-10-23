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
});

export type Settings = z.infer<typeof settingsSchema>;
export type SettingKey = keyof Settings;

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
};

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
