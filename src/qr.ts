// Código QR por botón: el QR codifica el enlace permanente <sitio>/go/<id> (ver app.ts), que cuenta el clic
// y redirige a la carta ACTUAL del botón; por eso el QR impreso no cambia cuando se reemplaza el PDF.
// SVG y PNG se dibujan aquí a partir de la matriz de la librería `qrcode`: corrección de errores M,
// zona silenciosa de 4 módulos, negro sobre blanco, sin scripts ni referencias externas.

import { deflateSync, crc32 } from 'node:zlib';
import QRCode from 'qrcode';
import { env } from './env.js';

export const QR_SIZE_MIN = 256;
export const QR_SIZE_MAX = 2048;
export const QR_SIZE_DEFAULT = 1024;
/** Zona silenciosa (en módulos) a cada lado, el mínimo que exige la norma. */
export const QR_QUIET = 4;

/** Texto que codifica el QR de un botón. Nunca lleva la landing ni parámetros. */
export const qrTarget = (base: string, buttonId: string) => `${base}/go/${buttonId}`;

const HOST = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const firstValue = (v: string | undefined) => (v ?? '').split(',')[0]!.trim();

/** Lo mínimo que se usa de la petición (así se prueba sin Express). */
export interface BaseSource {
  protocol: string;
  get(name: string): string | undefined;
}

/**
 * Origen público del sitio (sin barra final). Si hay PUBLIC_URL manda esa; si no se deduce de la petición:
 * x-forwarded-host (o host) y el protocolo (Express ya lee x-forwarded-proto porque hay `trust proxy`).
 * Devuelve null si el host trae algo raro.
 */
export function publicBase(req: BaseSource): string | null {
  const fixed = env.publicUrl;
  if (fixed) return fixed;
  const host = firstValue(req.get('x-forwarded-host')) || firstValue(req.get('host'));
  const proto = String(req.protocol).toLowerCase();
  if (!HOST.test(host) || (proto !== 'http' && proto !== 'https')) return null;
  try {
    const url = new URL(`${proto}://${host}`);
    return url.username || url.password || url.pathname !== '/' ? null : url.origin;
  } catch {
    return null;
  }
}

/** ?size=: entero entre 256 y 2048 (por defecto 1024). null = inválido. */
export function parseQrSize(raw: unknown): number | null {
  if (raw === undefined) return QR_SIZE_DEFAULT;
  if (typeof raw !== 'string' || !/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= QR_SIZE_MIN && n <= QR_SIZE_MAX ? n : null;
}

/** Nombre de archivo seguro: qr-<landing>-<botón>.<ext> (minúsculas, letras, números y guiones). */
export function qrFileName(landingSlug: string, label: string, ext: 'svg' | 'png'): string {
  const clean = (s: string, max: number) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/, '');
  return `qr-${clean(landingSlug, 40) || 'landing'}-${clean(label, 40) || 'boton'}.${ext}`;
}

export interface QrMatrix {
  size: number;
  /** true = módulo negro. */
  dark: (row: number, col: number) => boolean;
}

export function qrMatrix(text: string): QrMatrix {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  return { size: modules.size, dark: (r, c) => modules.get(r, c) === 1 };
}

/** SVG vectorial para imprimir: una sola ruta negra sobre fondo blanco, en unidades de módulo. */
export function qrSvg(text: string): string {
  const m = qrMatrix(text);
  const total = m.size + QR_QUIET * 2;
  let d = '';
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark(r, c)) {
        c++;
        continue;
      }
      let end = c;
      while (end < m.size && m.dark(r, end)) end++;
      d += `M${c + QR_QUIET} ${r + QR_QUIET}h${end - c}v1h-${end - c}z`;
      c = end;
    }
  }
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="1024" height="1024" shape-rendering="crispEdges">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/><path fill="#000000" d="${d}"/></svg>\n`
  );
}

/** Ancho de módulo en píxeles para que el QR y su zona silenciosa quepan en `size`. */
export const qrPixelsPerModule = (modules: number, size: number) => Math.floor(size / (modules + QR_QUIET * 2));

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const body = Buffer.concat([head.subarray(4), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head.subarray(0, 4), body, tail]);
}

/**
 * PNG cuadrado de exactamente size×size px, en blanco y negro de 1 bit. Cada módulo mide un número
 * ENTERO de píxeles (bordes nítidos); lo que sobra se reparte como margen blanco, así la zona
 * silenciosa nunca es menor a 4 módulos.
 */
export function qrPng(text: string, size: number): Buffer {
  const m = qrMatrix(text);
  const scale = qrPixelsPerModule(m.size, size);
  const inner = scale * m.size;
  const offset = Math.floor((size - inner) / 2);
  const rowBytes = Math.ceil(size / 8);

  // Una fila de píxeles por cada fila de módulos (bit 1 = blanco, 0 = negro).
  const moduleRows: Buffer[] = [];
  for (let r = 0; r < m.size; r++) {
    const row = Buffer.alloc(rowBytes, 0xff);
    for (let c = 0; c < m.size; c++) {
      if (!m.dark(r, c)) continue;
      for (let x = offset + c * scale; x < offset + (c + 1) * scale; x++) row[x >> 3]! &= ~(0x80 >> (x & 7));
    }
    moduleRows.push(row);
  }
  const blank = Buffer.alloc(rowBytes, 0xff);

  const raw = Buffer.alloc(size * (rowBytes + 1)); // cada fila empieza con el byte de filtro 0
  for (let y = 0; y < size; y++) {
    const inside = y >= offset && y < offset + inner;
    (inside ? moduleRows[Math.floor((y - offset) / scale)]! : blank).copy(raw, y * (rowBytes + 1) + 1);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 1; // 1 bit por píxel
  ihdr[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
