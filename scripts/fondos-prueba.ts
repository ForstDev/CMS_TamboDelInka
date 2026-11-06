// Prueba fotos de fondo nuevas en las landings de "experiencias" y vuelve a las anteriores con un comando.
//   npx tsx scripts/fondos-prueba.ts estado                       → muestra el fondo actual de cada landing y si hay respaldo
//   npx tsx scripts/fondos-prueba.ts aplicar                      → ENSAYO: muestra qué haría, sin cambiar nada
//   npx tsx scripts/fondos-prueba.ts aplicar --confirmar          → guarda el respaldo, sube las fotos y las pone de fondo
//   npx tsx scripts/fondos-prueba.ts revertir                     → ENSAYO: muestra qué restauraría
//   npx tsx scripts/fondos-prueba.ts revertir --confirmar         → vuelve a los fondos anteriores (según el respaldo)
//   --forzar (solo con aplicar): sigue aunque ya exista un respaldo; el respaldo viejo se conserva con otro nombre.
// Fotos de prueba y respaldo: clients/intursa/seed/pruebas/ (paracas.jpg, palacio.jpg, tambo.jpg, respaldo-fondos.json).
// Solo SUBE archivos nuevos y CAMBIA ajustes (fondo_tipo, fondo_imagen_url); no borra nada del almacenamiento ni de la base.
// En modo local (sin DATABASE_URL) detén antes `npm start`: la base embebida no admite dos procesos.
// FORCE_LOCAL=1 ignora las claves del .env y usa solo .data/ (para probar sin tocar producción).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {}

if (process.env.FORCE_LOCAL === '1') {
  for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

const { env } = await import('../src/env.js');
const { getDb } = await import('../src/db.js');
const { getStorage, objectPathFor, UPLOAD_RULES } = await import('../src/storage.js');
const { runWithLanding } = await import('../src/context.js');
const { settingsPatch } = await import('../src/validation.js');
const repo = await import('../src/repo.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'clients', env.clientId, 'seed', 'pruebas');
const backupFile = path.join(dir, 'respaldo-fondos.json');

const TARGETS = [
  { slug: 'experiencias-hotel-paracas', file: 'paracas.jpg' },
  { slug: 'experiencias-palacio-del-inka', file: 'palacio.jpg' },
  { slug: 'experiencias-tambo-del-inka', file: 'tambo.jpg' },
];

interface BackupEntry {
  slug: string;
  id: string;
  fondo_tipo: string;
  fondo_imagen_url: string;
}
interface Backup {
  fecha: string;
  cliente: string;
  landings: BackupEntry[];
}

const COMMANDS = ['aplicar', 'revertir', 'estado'];
const command = process.argv[2] ?? '';
const confirm = process.argv.includes('--confirmar');
const force = process.argv.includes('--forzar');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const show = (v: string) => (v ? v : '(vacío)');
const exists = (file: string) => fs.access(file).then(() => true, () => false);

type LandingRow = NonNullable<Awaited<ReturnType<typeof repo.getLandingBySlug>>>;

async function currentFondo(landing: LandingRow) {
  const s = await runWithLanding(landing, () => repo.getSettings());
  return { fondo_tipo: s.fondo_tipo as string, fondo_imagen_url: s.fondo_imagen_url };
}

/** Guarda fondo_tipo y fondo_imagen_url de la landing con la misma validación del panel y comprueba el resultado. */
async function saveFondo(landing: LandingRow, fondo_tipo: string, fondo_imagen_url: string) {
  const patch = settingsPatch.parse({ fondo_tipo, fondo_imagen_url });
  await runWithLanding(landing, () => repo.saveSettings(patch));
  const now = await currentFondo(landing);
  if (now.fondo_tipo !== patch.fondo_tipo || now.fondo_imagen_url !== patch.fondo_imagen_url) {
    throw new Error('el valor guardado no coincide con el esperado');
  }
}

function storageMode(): 'supabase' | 'local' | 'error' {
  try {
    return getStorage().mode;
  } catch {
    return 'error';
  }
}

function printModes() {
  const mode = storageMode();
  console.log(`\nCliente: ${env.clientId}`);
  console.log(`Base de datos: ${env.databaseUrl ? 'Supabase (DATABASE_URL)' : 'local (.data/pgdata)'}`);
  console.log(`Archivos: ${mode === 'supabase' ? 'Supabase Storage' : mode === 'local' ? 'local (.data/uploads)' : 'no disponible'}`);
  if (command !== 'estado') console.log(`Modo: ${confirm ? 'EJECUCIÓN (--confirmar)' : 'ENSAYO (no cambia nada)'}`);
  console.log('');
}

/** Aborta si la base y los archivos no apuntan al mismo lugar (evita fotos en este computador con la base en producción). */
function checkModes(): string | null {
  if (env.databaseUrl && !env.supabaseUrl) return 'Falta SUPABASE_URL y SUPABASE_SECRET_KEY: las fotos se guardarían en este computador y no se verían en producción.';
  const mode = storageMode();
  if (mode === 'error') return 'Falta SUPABASE_SECRET_KEY: no se pueden subir las fotos.';
  if (env.databaseUrl && mode === 'local') return 'Los archivos están en modo local pero la base es de producción. No se continúa.';
  if (!env.databaseUrl && mode === 'supabase') return 'La base es local pero los archivos irían a Supabase. No se continúa.';
  return null;
}

async function readBackup(): Promise<Backup> {
  const data = JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup;
  if (!Array.isArray(data?.landings) || data.landings.some((e) => !e?.slug || !e?.id || typeof e.fondo_tipo !== 'string' || typeof e.fondo_imagen_url !== 'string')) {
    throw new Error('El respaldo existe pero no tiene el formato esperado. No se cambió nada.');
  }
  return data;
}

async function estado() {
  const backup = (await exists(backupFile)) ? await readBackup().catch(() => null) : null;
  console.log(backup ? `Respaldo: sí (${backup.fecha})\n` : 'Respaldo: no hay\n');
  for (const t of TARGETS) {
    const landing = await repo.getLandingBySlug(t.slug);
    if (!landing) {
      console.log(`- ${t.slug}: NO existe en la base`);
      continue;
    }
    const now = await currentFondo(landing);
    console.log(`- ${t.slug}`);
    console.log(`    fondo_tipo: ${now.fondo_tipo}`);
    console.log(`    fondo_imagen_url: ${show(now.fondo_imagen_url)}`);
  }
}

async function aplicar() {
  const problem = checkModes();
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }

  // 1. Fotos: existen, son JPG y caben en el límite de fondo.
  const rule = UPLOAD_RULES.fondo;
  const images = new Map<string, Buffer>();
  for (const t of TARGETS) {
    const file = path.join(dir, t.file);
    if (!(await exists(file))) {
      console.error(`✗ Falta la foto ${t.file} en clients/${env.clientId}/seed/pruebas/`);
      process.exitCode = 1;
      return;
    }
    const data = await fs.readFile(file);
    if (data.length < 3 || data[0] !== 0xff || data[1] !== 0xd8) {
      console.error(`✗ ${t.file} no es un JPG válido.`);
      process.exitCode = 1;
      return;
    }
    if (!rule.types.includes('image/jpeg') || data.length > rule.maxBytes) {
      console.error(`✗ ${t.file} pesa ${kb(data.length)} y el límite es ${rule.label}.`);
      process.exitCode = 1;
      return;
    }
    images.set(t.file, data);
  }

  // 2. Respaldo previo.
  const hasBackup = await exists(backupFile);
  if (hasBackup && !force) {
    console.error('✗ Ya existe un respaldo (respaldo-fondos.json). Si lo pisara se perderían los fondos originales.');
    console.error('  Para volver a los fondos anteriores: npx tsx scripts/fondos-prueba.ts revertir --confirmar');
    console.error('  Solo si estás seguro de que el respaldo ya no sirve: agrega --forzar (el respaldo viejo se conserva con otro nombre).');
    process.exitCode = 1;
    return;
  }

  // Landings que existen.
  const plan: { slug: string; file: string; landing: LandingRow; before: { fondo_tipo: string; fondo_imagen_url: string } }[] = [];
  for (const t of TARGETS) {
    const landing = await repo.getLandingBySlug(t.slug);
    if (!landing) {
      console.warn(`! La landing ${t.slug} no existe en la base; se omite.`);
      continue;
    }
    plan.push({ ...t, landing, before: await currentFondo(landing) });
  }
  if (!plan.length) {
    console.error('✗ Ninguna de las landings de destino existe en la base. No se cambió nada.');
    process.exitCode = 1;
    return;
  }

  console.log(hasBackup ? 'Plan (con --forzar: el respaldo existente se conservará con otro nombre):' : 'Plan:');
  for (const p of plan) {
    console.log(`- ${p.slug}`);
    console.log(`    imagen: ${p.file} (${kb(images.get(p.file)!.length)})`);
    console.log(`    fondo actual: ${p.before.fondo_tipo} · ${show(p.before.fondo_imagen_url)}`);
    console.log('    quedará: imagen · (URL nueva al subir la foto)');
  }
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    return;
  }

  // 3. Respaldo: escribir, releer y verificar ANTES de tocar la base.
  if (hasBackup) {
    const old = path.join(dir, `respaldo-fondos-previo-${stamp()}.json`);
    await fs.rename(backupFile, old);
    console.log(`Respaldo anterior conservado como ${path.basename(old)}`);
  }
  const backup: Backup = {
    fecha: new Date().toISOString(),
    cliente: env.clientId,
    landings: plan.map((p) => ({ slug: p.slug, id: p.landing.id, ...p.before })),
  };
  await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  const check = await readBackup();
  if (JSON.stringify(check) !== JSON.stringify(backup)) throw new Error('El respaldo no quedó bien escrito. No se cambió nada en la base.');
  console.log('✓ Respaldo guardado y verificado\n');

  // 4. Subir y guardar, landing por landing.
  const done: string[] = [];
  const pending = plan.map((p) => p.slug);
  try {
    for (const p of plan) {
      const name = `fondo-prueba-${stamp()}.jpg`;
      const objectPath = objectPathFor(env.clientId, 'fondo', name, p.landing.is_default ? undefined : p.landing.slug);
      const url = await getStorage().put(objectPath, images.get(p.file)!, 'image/jpeg');
      await saveFondo(p.landing, 'imagen', url);
      done.push(p.slug);
      pending.splice(pending.indexOf(p.slug), 1);
      console.log(`✓ ${p.slug}\n    ${url}`);
    }
  } catch (err) {
    console.error(`\n✗ Falló: ${err instanceof Error ? err.message : err}`);
    console.error(`  Aplicadas: ${done.length ? done.join(', ') : 'ninguna'}`);
    console.error(`  Sin aplicar: ${pending.join(', ')}`);
    console.error('  El respaldo está guardado: puedes volver atrás con "revertir --confirmar".');
    process.exitCode = 1;
    return;
  }

  // 5. Resumen.
  console.log(`\nListo: ${done.length} landing(s) con foto de prueba.`);
  console.log('Para volver a los fondos anteriores:');
  console.log('  npx tsx scripts/fondos-prueba.ts revertir --confirmar');
}

async function revertir() {
  if (!(await exists(backupFile))) {
    console.log('No hay respaldo (respaldo-fondos.json): no hay nada que revertir y no se cambió nada.');
    console.log('Si necesitas volver a una foto anterior, vuelve a subirla desde el panel del CMS (Fondo de cada landing).');
    return;
  }
  const backup = await readBackup();
  console.log(`Respaldo del ${backup.fecha}:`);
  const plan: { entry: BackupEntry; landing: LandingRow; now: { fondo_tipo: string; fondo_imagen_url: string } }[] = [];
  for (const entry of backup.landings) {
    const landing = await repo.getLandingBySlug(entry.slug);
    if (!landing) {
      console.warn(`! La landing ${entry.slug} ya no existe; se omite.`);
      continue;
    }
    plan.push({ entry, landing, now: await currentFondo(landing) });
    console.log(`- ${entry.slug}`);
    console.log(`    ahora:     ${plan.at(-1)!.now.fondo_tipo} · ${show(plan.at(-1)!.now.fondo_imagen_url)}`);
    console.log(`    volverá a: ${entry.fondo_tipo} · ${show(entry.fondo_imagen_url)}`);
  }
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    return;
  }

  const restored: string[] = [];
  const failed: string[] = [];
  for (const p of plan) {
    try {
      await saveFondo(p.landing, p.entry.fondo_tipo, p.entry.fondo_imagen_url);
      restored.push(p.entry.slug);
      console.log(`✓ ${p.entry.slug} restaurada`);
    } catch (err) {
      failed.push(p.entry.slug);
      console.error(`✗ ${p.entry.slug}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed.length) {
    console.error(`\nNo se pudo restaurar: ${failed.join(', ')}. El respaldo se conserva; vuelve a intentarlo.`);
    process.exitCode = 1;
    return;
  }
  const renamed = `respaldo-fondos-revertido-${stamp()}.json`;
  await fs.rename(backupFile, path.join(dir, renamed));
  console.log(`\nListo: ${restored.length} landing(s) restauradas. Respaldo renombrado a ${renamed}`);
  console.log('Las fotos de prueba siguen en el almacenamiento (no se borran). Para probar de nuevo: aplicar --confirmar');
}

async function main() {
  if (!COMMANDS.includes(command)) {
    console.error('Uso: npx tsx scripts/fondos-prueba.ts <aplicar|revertir|estado> [--confirmar] [--forzar]');
    process.exitCode = 1;
    return;
  }
  printModes();
  let dbOpened = false;
  try {
    // Abre la base una vez; se cierra en finally.
    await getDb();
    dbOpened = true;
    if (command === 'estado') await estado();
    else if (command === 'aplicar') await aplicar();
    else await revertir();
  } catch (err) {
    console.error('\n✗', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  } finally {
    if (dbOpened) await (await getDb()).close();
  }
}

await main();
