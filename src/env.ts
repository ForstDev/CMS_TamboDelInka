// Configuración leída de variables de entorno. Un despliegue = un cliente.

import { randomBytes } from 'node:crypto';

const onVercel = Boolean(process.env.VERCEL);

let devSecret: string | undefined;

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET ?? '';
  if (value.length >= 32) return value;
  if (onVercel || process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción.');
  // Sin clave configurada (desarrollo o un servidor propio sin NODE_ENV): una clave aleatoria por proceso. Nunca una
  // clave fija y conocida: con ella cualquiera podría fabricar una sesión de administrador. Al reiniciar se pierden las sesiones.
  if (!devSecret) {
    devSecret = randomBytes(32).toString('hex');
    console.warn('[seguridad] SESSION_SECRET no está definido (o tiene menos de 32 caracteres): se usa una clave temporal. Defínelo en el servidor.');
  }
  return devSecret;
}

/** Cuántos proxies de confianza hay delante de la app (para leer la IP real del visitante). 1 por defecto (Vercel, o un nginx). */
function trustProxy(): number {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : 1;
}

export const env = {
  clientId: process.env.CLIENT_ID || 'intursa',
  databaseUrl: process.env.DATABASE_URL || '',
  supabaseUrl: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  supabaseKey: process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  noindex: process.env.NOINDEX === '1',
  statsTz: process.env.STATS_TZ || 'America/Lima',
  port: Number(process.env.PORT) || 3000,
  onVercel,
  production: onVercel || process.env.NODE_ENV === 'production',
  trustProxy: trustProxy(),
  get sessionSecret() {
    return sessionSecret();
  },
};

// Carpeta de la base y archivos locales. Se lee de una variable para que Vercel no la empaquete.
export const localDataDir = process.env.LOCAL_DATA_DIR || '.data';
