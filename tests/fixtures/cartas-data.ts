// Datos fijos de la landing Tambo Outlets (plantilla "cartas") para comparar el HTML renderizado
// antes y después del cambio a varias landings. Los snapshots cartas-*.html se generaron con el
// render.ts ANTERIOR a ese cambio, a partir de estos mismos datos.

export const CARTAS_SETTINGS = {
  cms_nombre: 'Tambo del Inka – Outlets',
  titulo_pagina: 'Tambo del Inka – Outlets',
  meta_descripcion: 'Cartas de Tambo del Inka Resort & Spa – Valle Sagrado: desayuno, restaurante Hawa, Kiri Bar, room service, vinos, spa y más.',
  logo_url: '/uploads/intursa/logo/mabc123-logo-tdi-blanco.png',
  logo_alt: 'Tambo del Inka Resort & Spa – Valle Sagrado',
  fondo_tipo: 'imagen' as 'imagen' | 'color',
  fondo_imagen_url: '/uploads/intursa/fondo/mabc123-fondo_intursa.jpg',
  color_fondo: '#ffffff',
  color_texto: '#ffffff',
  color_boton: '#ffffff',
  color_boton_texto: '#333333',
  color_boton_hover: '#333333',
  color_texto_boton_hover: '#ffffff',
  novedades_activo: '1' as '0' | '1',
  novedades_texto: '¿Deseas recibir novedades y promociones?',
  novedades_link_texto: 'Click aquí',
  novedades_url: 'https://www.intursa.com.pe/promociones/suscripcion/',
  redes_titulo: 'Síguenos',
};

const pdf = (id: string, label: string, file: string, extra: Record<string, unknown> = {}) => ({
  id,
  label,
  kind: 'pdf' as const,
  url: `/uploads/intursa/pdf/mabc123-${file}`,
  file_name: file,
  file_path: `intursa/pdf/mabc123-${file}`,
  new_tab: false,
  position: 0,
  active: true,
  ...extra,
});

export const CARTAS_BUTTONS = [
  pdf('11111111-1111-4111-8111-111111111101', 'Desayuno Breakfast', 'TAMBO_Desayuno-2026-1.pdf'),
  pdf('11111111-1111-4111-8111-111111111102', 'Hawa', 'TAMBO_Restaurante-Hawa-2026-Julio.pdf'),
  pdf('11111111-1111-4111-8111-111111111103', 'Kiri Bar & "Lounge" <b>', 'TAMBO_Bar-Kiri-2026-1.pdf', { new_tab: true }),
  pdf('11111111-1111-4111-8111-111111111104', 'Oculto', 'x.pdf', { active: false }),
  pdf('11111111-1111-4111-8111-111111111105', 'Sin destino', 'y.pdf', { url: '' }),
];

export const CARTAS_SOCIALS = [
  { id: '22222222-2222-4222-8222-222222222201', network: 'facebook' as const, url: 'https://www.facebook.com/TamboDelInka/', position: 0, active: true },
  { id: '22222222-2222-4222-8222-222222222202', network: 'instagram' as const, url: 'https://www.instagram.com/hoteltambodelinka/', position: 1, active: true },
  { id: '22222222-2222-4222-8222-222222222203', network: 'email' as const, url: 'mailto:reservas@ejemplo.com', position: 2, active: true },
  { id: '22222222-2222-4222-8222-222222222204', network: 'tiktok' as const, url: '', position: 3, active: true },
];

/** Variantes que se comparan: nombre del snapshot → ajustes extra y opciones de render. */
export const CARTAS_VARIANTS = {
  publica: { patch: {}, opts: {} },
  noindex: { patch: {}, opts: { noindex: true } },
  preview: { patch: {}, opts: { preview: true } },
  color: { patch: { fondo_tipo: 'color', color_fondo: '#123456', novedades_activo: '0' }, opts: {} },
  'sin-redes-ni-logo': { patch: { logo_url: '' }, opts: {}, noSocials: true },
} as const;
