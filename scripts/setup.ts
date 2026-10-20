// Prepara la base y los archivos de un cliente.
//   npm run setup                 → crea tablas y bucket; carga datos iniciales si el cliente está vacío
//   npm run setup -- --force      → vuelve a cargar botones, textos y redes desde clients/<id>/client.json
//   npm run setup -- --borrar-clics → además borra las estadísticas (por ejemplo, antes de salir en vivo)
// En modo local (sin DATABASE_URL) detén antes `npm run dev`: la base embebida no admite dos procesos.

try {
  process.loadEnvFile();
} catch {}

const { env } = await import('../src/env.js');
const { getDb } = await import('../src/db.js');
const { getStorage } = await import('../src/storage.js');
const { applySchema, seed } = await import('../src/seed.js');
const repo = await import('../src/repo.js');

const force = process.argv.includes('--force');
const resetClicks = process.argv.includes('--borrar-clics');

console.log(`\nCliente: ${env.clientId}`);
console.log(`Base de datos: ${env.databaseUrl ? 'Supabase (DATABASE_URL)' : 'local (.data/pgdata)'}`);
console.log(`Archivos: ${getStorage().mode === 'supabase' ? 'Supabase Storage' : 'local (.data/uploads)'}\n`);

if (env.databaseUrl && !env.supabaseUrl) {
  console.error('✗ Falta SUPABASE_URL y SUPABASE_SECRET_KEY: sin ellos los PDF se guardarían en este computador.');
  process.exit(1);
}

try {
  await applySchema();
  console.log('✓ Tablas listas');
  if (getStorage().ensureBucket) {
    await getStorage().ensureBucket!();
    console.log('✓ Bucket "media" listo (público, solo PDF/PNG/JPG/WEBP)');
  }
  await seed({ force });
  if (resetClicks) console.log(`✓ Estadísticas borradas (${await repo.resetClicks()} clics)`);
  console.log('\nTodo listo.');
} catch (err) {
  console.error('\n✗', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await (await getDb()).close();
}
