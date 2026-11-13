// Configuración leída de variables de entorno. Un despliegue = un cliente.

const onVercel = Boolean(process.env.VERCEL);

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET ?? '';
  if (value.length >= 32) return value;
  if (onVercel) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción.');
  return 'solo-para-desarrollo-local-no-usar-en-produccion-0000';
}

/**
 * Valida PUBLIC_URL: solo el origen del sitio (https; http solo fuera de producción), sin usuario,
 * contraseña, ruta, parámetros ni #. Devuelve el origen sin barra final, o null si no sirve.
 */
export function parsePublicUrl(raw: string, production: boolean): string | null {
  const value = raw.trim().replace(/\/+$/, '');
  if (!value || /[\s\u0000-\u001f\\?#@]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !production)) return null;
  if (!url.hostname || url.username || url.password || url.pathname !== '/') return null;
  return url.origin;
}

let publicUrlWarned = false;

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
  get sessionSecret() {
    return sessionSecret();
  },
  /** Dominio fijo del sitio para los QR (PUBLIC_URL). Vacío = se deduce de la petición. Una URL inválida se ignora. */
  get publicUrl(): string {
    const raw = process.env.PUBLIC_URL ?? '';
    if (!raw.trim()) return '';
    const parsed = parsePublicUrl(raw, onVercel || process.env.NODE_ENV === 'production');
    if (!parsed && !publicUrlWarned) {
      publicUrlWarned = true;
      console.warn('[config] PUBLIC_URL no es válida (use https://dominio sin ruta); se usará el dominio de la petición.');
    }
    return parsed ?? '';
  },
};

// Carpeta de la base y archivos locales. Se lee de una variable para que Vercel no la empaquete.
export const localDataDir = process.env.LOCAL_DATA_DIR || '.data';
