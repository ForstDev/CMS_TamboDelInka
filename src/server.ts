// Servidor local de desarrollo. En Vercel se usa api/index.ts.

try {
  process.loadEnvFile();
} catch {
  // sin .env: se usan los valores por defecto (modo local)
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
  console.log(`  Página pública: http://localhost:${env.port}/`);
  console.log(`  Login del CMS:  http://localhost:${env.port}/cms_login\n`);
});
