// Revisa que una instalación esté completa y funcionando: variables, base, datos, archivos y subidas.
//   npm run verificar

try {
  process.loadEnvFile();
} catch {}

const { env } = await import('../src/env.js');
const { getDb } = await import('../src/db.js');
const { getStorage, objectPathFor } = await import('../src/storage.js');
const repo = await import('../src/repo.js');

let failures = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const fail = (msg: string) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
async function check(name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    ok(detail ? `${name}: ${detail}` : name);
  } catch (err) {
    fail(`${name}: ${err instanceof Error ? err.message : err}`);
  }
}

if (!env.databaseUrl) {
  console.log('\nEste comando revisa una instalación con Supabase y no hay DATABASE_URL en el .env.');
  console.log('En modo local usa `npm test` (pruebas automáticas) y abre http://localhost:3000.\n');
  process.exit(0);
}

console.log(`\nVerificando cliente "${env.clientId}"\n`);

console.log('Variables de entorno');
for (const [name, value] of Object.entries({
  DATABASE_URL: env.databaseUrl,
  SUPABASE_URL: env.supabaseUrl,
  SUPABASE_SECRET_KEY: env.supabaseKey,
  SESSION_SECRET: (process.env.SESSION_SECRET ?? '').length >= 32 ? 'ok' : '',
})) {
  if (value) ok(name);
  else fail(`${name} vacía${name === 'SESSION_SECRET' ? ' o con menos de 32 caracteres' : ''}`);
}
if (env.databaseUrl && !/:6543\//.test(env.databaseUrl)) {
  fail('DATABASE_URL no usa el puerto 6543 (Transaction pooler). Vercel lo necesita.');
}

console.log('\nBase de datos');
await check('Conexión', async () => {
  const db = await getDb();
  const [row] = await db.query<{ v: string }>('select version() as v');
  return row!.v.split(' ').slice(0, 2).join(' ');
});
await check('Tablas', async () => {
  const db = await getDb();
  const rows = await db.query<{ t: string }>(
    `select table_name as t from information_schema.tables where table_schema = 'public' and table_name in ('settings','buttons','socials','clicks','admins')`,
  );
  if (rows.length !== 5) throw new Error(`faltan tablas (hay ${rows.length} de 5). Ejecuta npm run setup`);
  return '5 de 5';
});
await check('Datos del cliente', async () => {
  if (!(await repo.hasSettings())) throw new Error('vacío. Ejecuta npm run setup');
  const buttons = await repo.listButtons();
  return `${buttons.length} botones (${buttons.filter((b) => b.active && b.url).length} visibles)`;
});
await check('Usuario administrador', async () => {
  const db = await getDb();
  const rows = await db.query<{ username: string }>('select username from admins where client_id = $1', [env.clientId]);
  if (!rows.length) throw new Error('no hay usuarios. Ejecuta npm run setup');
  return rows.map((r) => r.username).join(', ');
});

console.log('\nArchivos');
const storage = getStorage();
await check('Almacenamiento', async () => storage.mode);
await check('PDF accesibles públicamente', async () => {
  const buttons = (await repo.listButtons()).filter((b) => b.kind === 'pdf' && b.url);
  let okCount = 0;
  for (const b of buttons) {
    const url = b.url.startsWith('/') ? `http://localhost:${env.port}${b.url}` : b.url;
    const res = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (res?.ok) okCount++;
    else throw new Error(`"${b.label}" no abre (${res?.status ?? 'sin respuesta'}): ${url}`);
  }
  return `${okCount} de ${buttons.length}`;
});
if (storage.mode === 'supabase') {
  await check('Subida directa desde el navegador (URL firmada)', async () => {
    const objectPath = objectPathFor(env.clientId, 'pdf', 'verificacion.pdf');
    const target = await storage.createUploadTarget(objectPath);
    const res = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4\n% verificación\n' });
    if (!res.ok) throw new Error(`la subida respondió ${res.status}: ${await res.text()}`);
    const pub = await fetch(target.publicUrl, { method: 'HEAD' });
    await storage.remove(objectPath);
    if (!pub.ok) throw new Error(`el archivo subido no es público (${pub.status})`);
    return 'sube y queda público';
  });
}

await (await getDb()).close();
console.log(failures ? `\n${failures} problema(s) encontrados.\n` : '\nTodo correcto.\n');
process.exitCode = failures ? 1 : 0;
