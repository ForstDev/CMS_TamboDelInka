// Reemplaza el PDF de botones concretos (como «Editar → Reemplazar» en el panel) y vuelve al PDF anterior con un comando.
//   npx tsx scripts/actualizar-pdfs.ts estado                    → muestra, por botón, el PDF actual, el archivo nuevo y si hay respaldo
//   npx tsx scripts/actualizar-pdfs.ts aplicar                   → ENSAYO: muestra qué haría, sin cambiar nada
//   npx tsx scripts/actualizar-pdfs.ts aplicar --confirmar       → guarda el respaldo, sube los PDF nuevos y los pone en sus botones
//   npx tsx scripts/actualizar-pdfs.ts revertir                  → ENSAYO: muestra qué restauraría
//   npx tsx scripts/actualizar-pdfs.ts revertir --confirmar      → vuelve a los PDF anteriores (según el respaldo)
//   --forzar (solo con aplicar): sigue aunque ya exista un respaldo; el respaldo viejo se conserva con otro nombre
//     (pero el nuevo respaldo guardará los PDF actuales, no los originales).
// La lista de trabajo (qué botón de qué landing recibe qué archivo) está en PDFS, al inicio del script: edítala para futuras actualizaciones.
// Los archivos se leen de clients/<cliente>/seed/<archivo>. El respaldo queda en clients/<cliente>/seed/pdfs-respaldo.json (Git lo ignora).
// Cambia solo kind, url, file_name y file_path del botón (igual que el panel); la etiqueta, new_tab, active y la posición no se tocan.
// Solo SUBE archivos nuevos; no borra nada del almacenamiento ni de la base (los PDF anteriores siguen allí, por eso se puede revertir).
// Cada botón se busca por su etiqueta (sin distinguir mayúsculas ni espacios de los extremos) dentro de su landing; si hay 0 o más de 1, ese elemento se omite.
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
const { buttonPatch } = await import('../src/validation.js');
const repo = await import('../src/repo.js');

/** Lista de trabajo: landing (slug), etiqueta del botón y PDF nuevo (ruta relativa a clients/<cliente>/seed/). */
const PDFS: { slug: string; boton: string; archivo: string }[] = [
  {
    slug: 'experiencias-palacio-del-inka',
    boton: 'Andes Spirit Spa',
    archivo: 'experiencias-palacio-del-inka/pdf/Brochure-Andes-Spirit-Spa-2027.pdf',
  },
  {
    slug: 'experiencias-hotel-paracas',
    boton: 'Be Epicurean',
    archivo: 'experiencias-hotel-paracas/pdf/Be-Epicurean_PARACAS_2026_BI-digital-1.pdf',
  },
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'clients', env.clientId, 'seed');
const backupFile = path.join(seedDir, 'pdfs-respaldo.json');

type Button = Awaited<ReturnType<typeof repo.listButtons>>[number];
type LandingRow = NonNullable<Awaited<ReturnType<typeof repo.getLandingBySlug>>>;

/** Los 4 campos que cambia el reemplazo de PDF (los mismos que envía el panel). */
interface Destino {
  kind: 'pdf' | 'link';
  url: string;
  file_name: string;
  file_path: string;
}
const CAMPOS = ['kind', 'url', 'file_name', 'file_path'] as const;

interface BackupEntry extends Destino {
  slug: string;
  id: string;
  label: string;
}
interface Backup {
  fecha: string;
  cliente: string;
  botones: BackupEntry[];
}

const COMMANDS = ['aplicar', 'revertir', 'estado'];
const FLAGS = ['--confirmar', '--forzar'];
const command = process.argv[2] ?? '';
const flags = process.argv.slice(3);
const confirm = flags.includes('--confirmar');
const force = flags.includes('--forzar');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const show = (v: string) => (v ? v : '(vacío)');
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const norm = (s: string) => s.trim().toLowerCase();
const destinoOf = (b: Button): Destino => ({ kind: b.kind, url: b.url, file_name: b.file_name, file_path: b.file_path });
const sameDestino = (a: Destino, b: Destino) => CAMPOS.every((k) => a[k] === b[k]);

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

/** Aborta si la base y los archivos no apuntan al mismo lugar (evita PDF en este computador con la base en producción). */
function checkModes(): string | null {
  if (env.databaseUrl && !env.supabaseUrl) return 'Falta SUPABASE_URL y SUPABASE_SECRET_KEY: los PDF se guardarían en este computador y no se verían en producción.';
  const mode = storageMode();
  if (mode === 'error') return 'Falta SUPABASE_SECRET_KEY: no se pueden subir los PDF.';
  if (env.databaseUrl && mode === 'local') return 'Los archivos están en modo local pero la base es de producción. No se continúa.';
  if (!env.databaseUrl && mode === 'supabase') return 'La base es local pero los archivos irían a Supabase. No se continúa.';
  return null;
}

/** Botones de la landing con esa etiqueta (sin distinguir mayúsculas ni espacios de los extremos). */
async function findButtons(landing: LandingRow, label: string): Promise<Button[]> {
  const all = await runWithLanding(landing, () => repo.listButtons());
  return all.filter((b) => norm(b.label) === norm(label));
}

/** Un único botón por elemento de la lista, o el motivo por el que no se puede. */
async function resolveItem(item: (typeof PDFS)[number]): Promise<{ landing: LandingRow; button: Button } | { error: string }> {
  const landing = await repo.getLandingBySlug(item.slug);
  if (!landing) return { error: `la landing ${item.slug} no existe en la base` };
  const found = await findButtons(landing, item.boton);
  if (found.length === 0) return { error: `no hay ningún botón «${item.boton}» en ${item.slug}` };
  if (found.length > 1) return { error: `hay ${found.length} botones «${item.boton}» en ${item.slug}; no se sabe cuál reemplazar` };
  return { landing, button: found[0]! };
}

async function readBackup(): Promise<Backup> {
  const data = JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup;
  const text = (v: unknown) => typeof v === 'string';
  if (
    !Array.isArray(data?.botones) ||
    data.botones.some(
      (e) => !e?.slug || !e?.id || !text(e.label) || (e.kind !== 'pdf' && e.kind !== 'link') || !text(e.url) || !text(e.file_name) || !text(e.file_path),
    )
  ) {
    throw new Error('El respaldo existe pero no tiene el formato esperado. No se cambió nada.');
  }
  return data;
}

/** Guarda los 4 campos del botón con la misma validación del panel y comprueba que el resultado coincide. */
async function saveDestino(landing: LandingRow, id: string, destino: Destino, before: Button) {
  const patch = buttonPatch.parse({ kind: destino.kind, url: destino.url, file_name: destino.file_name, file_path: destino.file_path });
  const saved = await runWithLanding(landing, () => repo.updateButton(id, patch));
  if (!saved) throw new Error('el botón ya no existe');
  const now = await runWithLanding(landing, () => repo.getButton(id));
  if (!now || !sameDestino(destinoOf(now), destino)) throw new Error('el valor guardado no coincide con el esperado');
  // Lo que NO debe cambiar.
  if (now.label !== before.label || now.new_tab !== before.new_tab || now.active !== before.active || now.position !== before.position) {
    throw new Error('cambió la etiqueta, new_tab, active o la posición del botón (no debía)');
  }
}

async function readFiles(): Promise<{ data: Map<string, Buffer>; error?: string }> {
  const rule = UPLOAD_RULES.pdf;
  const data = new Map<string, Buffer>();
  for (const item of PDFS) {
    const file = path.join(seedDir, item.archivo);
    const rel = `clients/${env.clientId}/seed/${item.archivo}`;
    if (!(await exists(file))) return { data, error: `Falta el archivo ${rel}` };
    const buf = await fs.readFile(file);
    if (buf.length < 5 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') return { data, error: `${item.archivo} no es un PDF válido (no empieza con %PDF-).` };
    if (!rule.types.includes('application/pdf') || buf.length > rule.maxBytes) return { data, error: `${item.archivo} pesa ${kb(buf.length)} y el límite es ${rule.label}.` };
    data.set(item.archivo, buf);
  }
  return { data };
}

async function estado() {
  const backup = (await exists(backupFile)) ? await readBackup().catch(() => null) : null;
  console.log(backup ? `Respaldo: sí (${backup.fecha})\n` : 'Respaldo: no hay\n');
  for (const item of PDFS) {
    console.log(`- ${item.slug} · «${item.boton}»`);
    const landing = await repo.getLandingBySlug(item.slug);
    if (!landing) {
      console.log('    landing: NO existe en la base');
    } else {
      const found = await findButtons(landing, item.boton);
      if (found.length === 0) console.log('    botón: NO se encontró');
      else if (found.length > 1) console.log(`    botón: ${found.length} coincidencias (ambiguo)`);
      else {
        const b = found[0]!;
        console.log(`    botón: encontrado (${b.kind}, ${b.active ? 'visible' : 'oculto'})`);
        console.log(`    PDF actual: ${show(b.file_name)}`);
        console.log(`    URL actual: ${show(b.url)}`);
      }
    }
    const file = path.join(seedDir, item.archivo);
    if (await exists(file)) console.log(`    archivo nuevo: ${path.basename(file)} (${kb((await fs.stat(file)).size)})`);
    else console.log(`    archivo nuevo: NO existe (${item.archivo})`);
    const entry = backup?.botones.find((e) => e.slug === item.slug && norm(e.label) === norm(item.boton));
    console.log(`    respaldo: ${entry ? `sí (PDF anterior: ${show(entry.file_name)})` : 'no'}`);
  }
}

async function aplicar() {
  const problem = checkModes();
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }

  // 1. Archivos: existen, son PDF y caben en el límite.
  const { data: files, error } = await readFiles();
  if (error) {
    console.error(`✗ ${error}`);
    process.exitCode = 1;
    return;
  }

  // 2. Respaldo previo.
  const hasBackup = await exists(backupFile);
  if (hasBackup && !force) {
    console.error('✗ Ya existe un respaldo (pdfs-respaldo.json). Si lo pisara se perderían los PDF originales.');
    console.error('  Para volver a los PDF anteriores: npx tsx scripts/actualizar-pdfs.ts revertir --confirmar');
    console.error('  Solo si estás seguro de que el respaldo ya no sirve: agrega --forzar (el respaldo viejo se conserva con otro nombre).');
    process.exitCode = 1;
    return;
  }

  // 3. Cada elemento debe resolver a UN solo botón; los demás se omiten (y se informa).
  const plan: { item: (typeof PDFS)[number]; landing: LandingRow; button: Button }[] = [];
  const skipped: string[] = [];
  for (const item of PDFS) {
    const r = await resolveItem(item);
    if ('error' in r) {
      console.error(`✗ Se omite «${item.boton}» (${item.slug}): ${r.error}.`);
      skipped.push(`${item.slug} · «${item.boton}»`);
    } else plan.push({ item, ...r });
  }
  if (!plan.length) {
    console.error('✗ Ningún elemento de la lista se puede aplicar. No se cambió nada.');
    process.exitCode = 1;
    return;
  }

  if (hasBackup) console.log('\nPlan (con --forzar: el respaldo existente se conservará con otro nombre y se creará uno nuevo con los PDF actuales):');
  else console.log('\nPlan (se creará el respaldo pdfs-respaldo.json con los PDF actuales):');
  for (const p of plan) {
    console.log(`- ${p.item.slug} · «${p.button.label}»`);
    console.log(`    PDF actual: ${show(p.button.file_name)}`);
    console.log(`    URL actual: ${show(p.button.url)}`);
    console.log(`    PDF nuevo: ${path.basename(p.item.archivo)} (${kb(files.get(p.item.archivo)!.length)})`);
    console.log('    quedará: kind=pdf · URL nueva al subir el archivo · etiqueta, new_tab, active y posición sin cambios');
  }
  if (skipped.length) console.log(`\nOmitidos (no se aplicarán): ${skipped.join('; ')}`);
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    if (skipped.length) process.exitCode = 1;
    return;
  }

  // 4. Respaldo: escribir, releer y verificar ANTES de tocar la base.
  if (hasBackup) {
    const old = path.join(seedDir, `pdfs-respaldo-previo-${stamp()}.json`);
    await fs.rename(backupFile, old);
    console.log(`\nRespaldo anterior conservado como ${path.basename(old)}`);
  }
  const backup: Backup = {
    fecha: new Date().toISOString(),
    cliente: env.clientId,
    botones: plan.map((p) => ({ slug: p.item.slug, id: p.button.id, label: p.button.label, ...destinoOf(p.button) })),
  };
  await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  const check = await readBackup();
  if (JSON.stringify(check) !== JSON.stringify(backup)) throw new Error('El respaldo no quedó bien escrito. No se cambió nada en la base.');
  console.log('✓ Respaldo guardado y verificado\n');

  // 5. Subir y guardar, botón por botón.
  const done: string[] = [];
  const failed: string[] = [];
  for (const p of plan) {
    const name = `${p.item.slug} · «${p.button.label}»`;
    try {
      const fileName = path.basename(p.item.archivo);
      const objectPath = objectPathFor(env.clientId, 'pdf', fileName, p.landing.is_default ? undefined : p.landing.slug);
      if (objectPath === p.button.file_path) throw new Error('la ruta nueva coincide con la anterior; no se sobrescribe');
      const url = await getStorage().put(objectPath, files.get(p.item.archivo)!, 'application/pdf');
      await saveDestino(p.landing, p.button.id, { kind: 'pdf', url, file_name: fileName, file_path: objectPath }, p.button);
      done.push(name);
      console.log(`✓ ${name}\n    ${fileName}\n    ${url}`);
    } catch (err) {
      failed.push(name);
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 6. Resumen.
  console.log(`\nAplicados: ${done.length ? done.join('; ') : 'ninguno'}`);
  if (failed.length) console.error(`Con error: ${failed.join('; ')}`);
  if (skipped.length) console.error(`Omitidos: ${skipped.join('; ')}`);
  if (failed.length || skipped.length) process.exitCode = 1;
  console.log('\nPara volver a los PDF anteriores:');
  console.log('  npx tsx scripts/actualizar-pdfs.ts revertir --confirmar');
}

async function revertir() {
  if (!(await exists(backupFile))) {
    console.log('No hay respaldo (pdfs-respaldo.json): no hay nada que revertir y no se cambió nada.');
    console.log('Si necesitas volver a un PDF anterior, vuelve a subirlo desde el panel del CMS (Editar → Reemplazar).');
    return;
  }
  const backup = await readBackup();
  console.log(`Respaldo del ${backup.fecha}:`);
  const plan: { entry: BackupEntry; landing: LandingRow; button: Button }[] = [];
  for (const entry of backup.botones) {
    const landing = await repo.getLandingBySlug(entry.slug);
    const button = landing ? await runWithLanding(landing, () => repo.getButton(entry.id)) : null;
    if (!landing || !button) {
      console.warn(`! ${entry.slug} · «${entry.label}»: ya no existe ${landing ? 'el botón' : 'la landing'}; se omite.`);
      continue;
    }
    plan.push({ entry, landing, button });
    console.log(`- ${entry.slug} · «${entry.label}»`);
    console.log(`    ahora:     ${show(button.file_name)} · ${show(button.url)}`);
    console.log(`    volverá a: ${show(entry.file_name)} · ${show(entry.url)}`);
  }
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    return;
  }

  const restored: string[] = [];
  const failed: string[] = [];
  for (const p of plan) {
    const name = `${p.entry.slug} · «${p.entry.label}»`;
    try {
      await saveDestino(p.landing, p.entry.id, { kind: p.entry.kind, url: p.entry.url, file_name: p.entry.file_name, file_path: p.entry.file_path }, p.button);
      restored.push(name);
      console.log(`✓ ${name} restaurado`);
    } catch (err) {
      failed.push(name);
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed.length) {
    console.error(`\nNo se pudo restaurar: ${failed.join('; ')}. El respaldo se conserva; vuelve a intentarlo.`);
    process.exitCode = 1;
    return;
  }
  const renamed = `pdfs-respaldo-revertido-${stamp()}.json`;
  await fs.rename(backupFile, path.join(seedDir, renamed));
  console.log(`\nListo: ${restored.length} botón(es) restaurado(s). Respaldo renombrado a ${renamed}`);
  console.log('Los PDF nuevos siguen en el almacenamiento (no se borran). Para probar de nuevo: aplicar --confirmar');
}

async function main() {
  if (!COMMANDS.includes(command)) {
    console.error('Uso: npx tsx scripts/actualizar-pdfs.ts <estado|aplicar|revertir> [--confirmar] [--forzar]');
    process.exitCode = 1;
    return;
  }
  const unknown = flags.filter((f) => !FLAGS.includes(f));
  if (unknown.length) {
    console.error(`✗ Opción no reconocida: ${unknown.join(' ')}. Usa solo --confirmar o --forzar. No se cambió nada.`);
    process.exitCode = 1;
    return;
  }
  if (force && command !== 'aplicar') {
    console.error('✗ --forzar solo se usa con aplicar. No se cambió nada.');
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
