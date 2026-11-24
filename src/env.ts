// Configuración leída de variables de entorno. Un despliegue = un cliente.

const onVercel = Boolean(process.env.VERCEL);

function sessionSecret(): string {
  const value = process.env.SESSION_SECRET ?? '';
  if (value.length >= 32) return value;
  if (onVercel) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres en producción.');
  return 'solo-para-desarrollo-local-no-usar-en-produccion-0000';
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
  get sessionSecret() {
    return sessionSecret();
  },
};

// Carpeta de la base y archivos locales. Se lee de una variable para que Vercel no la empaquete.
export const localDataDir = process.env.LOCAL_DATA_DIR || '.data';
