// Prepara la base y los archivos de un cliente.
//   npm run setup                 → crea/migra tablas y bucket; crea las landings de clients/<id>/client.json
//                                   que aún no existan (las que ya tienen datos no se tocan)
//   npm run setup -- --force      → vuelve a cargar botones, textos y redes de las landings de client.json
//                                   (no borra landings ni clics)
//   npm run setup -- --borrar-clics → además borra las estadísticas de todas las landings
//   npm run setup -- --solo-esquema → solo crea/migra tablas y bucket, sin cargar landings. Se usa ANTES del
//                                   `git push` cuando la versión nueva trae landings nuevas: así el código anterior
//                                   (que no distingue landings) no muestra sus botones mientras Vercel despliega.
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
const schemaOnly = process.argv.includes('--solo-esquema');

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
  if (schemaOnly) {
    console.log('\nEsquema listo (no se cargaron landings). Ahora: git push, espera el despliegue y vuelve a correr npm run setup.');
  } else {
    await seed({ force });
  }
  if (resetClicks && !schemaOnly) console.log(`✓ Estadísticas borradas (${await repo.resetAllClicks()} clics)`);
  console.log('\nTodo listo.');
} catch (err) {
  console.error('\n✗', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await (await getDb()).close();
}
