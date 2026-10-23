// Servidor local de desarrollo. En Vercel se usa api/index.ts.

try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan los valores por defecto (modo local)
}

// FORCE_LOCAL=1 ignora las claves del .env y usa solo la base y los archivos locales (.data/),
// para probar sin tocar Supabase/producción. (En Windows una variable vacía se borra y el .env
// la volvería a llenar, por eso existe este interruptor.)
if (process.env.FORCE_LOCAL === '1') {
  for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

const { env } = await import('./env.js');
const { getStorage } = await import('./storage.js');
const { applySchema, seed } = await import('./seed.js');
const { createApp } = await import('./app.js');

// En modo local la base embebida se crea y se llena sola la primera vez.
if (!env.databaseUrl) {
  await applySchema();
  await seed();
}

createApp().listen(env.port, () => {
  const mode = env.databaseUrl ? 'Supabase' : 'local (.data/)';
  console.log(`\nCMS listo en http://localhost:${env.port}  ·  base: ${mode}  ·  archivos: ${getStorage().mode}`);
  if (env.databaseUrl) {
    console.log('  ⚠ ATENCIÓN: este servidor usa la base de PRODUCCIÓN (Supabase). Los clics y cambios son reales.');
    console.log('    Para probar sin tocarla: FORCE_LOCAL=1 npm start');
  }
  console.log(`  Página pública: http://localhost:${env.port}/`);
  console.log(`  Login del CMS:  http://localhost:${env.port}/cms_login\n`);
});
