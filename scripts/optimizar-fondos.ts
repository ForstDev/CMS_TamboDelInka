// Cambia las fotos de fondo que ya están en producción por su versión optimizada (WebP, ≤ 2000 px), con reversa.
//   npx tsx scripts/optimizar-fondos.ts estado                → muestra, por landing, su foto de fondo y si hay una versión optimizada
//   npx tsx scripts/optimizar-fondos.ts aplicar               → ENSAYO: muestra qué haría, sin cambiar nada
//   npx tsx scripts/optimizar-fondos.ts aplicar --confirmar   → guarda un respaldo, sube las versiones optimizadas y las pone de fondo
//   npx tsx scripts/optimizar-fondos.ts revertir              → ENSAYO: muestra qué restauraría
//   npx tsx scripts/optimizar-fondos.ts revertir --confirmar  → vuelve a los fondos anteriores (según el respaldo)
//   --forzar (solo con aplicar): sigue aunque ya exista un respaldo (el viejo se conserva con otro nombre).
//
// Seguridad: una landing SOLO se toca si su foto actual es, byte por byte, uno de los originales de
// clients/<cliente>/seed/**/*.jpg que tiene al lado su versión .webp (mismo nombre). Una foto que se haya subido desde el
// panel (que ya se optimiza sola) o cualquier otra no coincide y no se toca. El encuadre y los demás ajustes no cambian.
// Solo SUBE archivos nuevos y CAMBIA el ajuste fondo_imagen_url; no borra nada del almacenamiento ni de la base.
// Respaldo: clients/<cliente>/seed/fondos-optimizados-respaldo.json (no va a git).
// En modo local (sin DATABASE_URL) detén antes `npm start`: la base embebida no admite dos procesos.
// FORCE_LOCAL=1 ignora las claves del .env y usa solo .data/ (para probar sin tocar producción).

import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile();
} catch {}

if (process.env.FORCE_LOCAL === '1') {
  for (const k of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) delete process.env[k];
}

const { env } = await import('../src/env.js');
const { getStorage, objectPathFor, localUploadsDir, UPLOAD_RULES } = await import('../src/storage.js');
const { runWithLanding } = await import('../src/context.js');
const { settingsPatch } = await import('../src/validation.js');
const repo = await import('../src/repo.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seedDir = path.join(root, 'clients', env.clientId, 'seed');
const backupFile = path.join(seedDir, 'fondos-optimizados-respaldo.json');

interface BackupEntry {
  slug: string;
  id: string;
  fondo_imagen_url: string;
}
interface Backup {
  fecha: string;
  cliente: string;
  landings: BackupEntry[];
}

const command = process.argv[2] ?? '';
const confirm = process.argv.includes('--confirmar');
const force = process.argv.includes('--forzar');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const exists = (file: string) => fs.access(file).then(() => true, () => false);

type LandingRow = NonNullable<Awaited<ReturnType<typeof repo.getLandingBySlug>>>;

/** Todos los .jpg de seed/ (menos login/ y anteriores/) que tienen al lado su .webp: huella del original → su versión optimizada. */
async function optimizedByOriginal(): Promise<Map<string, { jpg: string; webp: string }>> {
  const out = new Map<string, { jpg: string; webp: string }>();
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'login' || e.name === '_originales') continue;
        await walk(full);
      } else if (/\.jpe?g$/i.test(e.name)) {
        const webp = full.replace(/\.jpe?g$/i, '.webp');
        if (await exists(webp)) out.set(sha(await fs.readFile(full)), { jpg: full, webp });
      }
    }
  }
  await walk(seedDir);
  return out;
}

/** Bytes de la foto actual: archivo local (/uploads/…) o descarga de su dirección pública. */
async function readCurrent(url: string): Promise<Buffer | null> {
  try {
    if (url.startsWith('/uploads/')) return await fs.readFile(path.join(localUploadsDir, decodeURIComponent(url.slice('/uploads/'.length))));
    const res = await fetch(url);
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function storageMode(): 'supabase' | 'local' | 'error' {
  try {
    return getStorage().mode;
  } catch {
    return 'error';
  }
}

function checkModes(): string | null {
  if (env.databaseUrl && !env.supabaseUrl) return 'Falta SUPABASE_URL y SUPABASE_SECRET_KEY: las fotos se guardarían en este computador y no se verían en producción.';
  const mode = storageMode();
  if (mode === 'error') return 'Falta SUPABASE_SECRET_KEY: no se pueden subir las fotos.';
  if (env.databaseUrl && mode === 'local') return 'Los archivos están en modo local pero la base es de producción. No se continúa.';
  if (!env.databaseUrl && mode === 'supabase') return 'La base es local pero los archivos irían a Supabase. No se continúa.';
  return null;
}

function printModes() {
  const mode = storageMode();
  console.log(`\nCliente: ${env.clientId}`);
  console.log(`Base de datos: ${env.databaseUrl ? 'Supabase (DATABASE_URL)' : 'local (.data/pgdata)'}`);
  console.log(`Archivos: ${mode === 'supabase' ? 'Supabase Storage' : mode === 'local' ? 'local (.data/uploads)' : 'no disponible'}`);
  if (command !== 'estado') console.log(`Modo: ${confirm ? 'EJECUCIÓN (--confirmar)' : 'ENSAYO (no cambia nada)'}`);
  console.log('');
}

async function currentUrl(landing: LandingRow): Promise<{ tipo: string; url: string }> {
  const s = await runWithLanding(landing, () => repo.getSettings());
  return { tipo: String(s.fondo_tipo), url: String(s.fondo_imagen_url) };
}

async function saveUrl(landing: LandingRow, url: string) {
  const patch = settingsPatch.parse({ fondo_imagen_url: url });
  await runWithLanding(landing, () => repo.saveSettings(patch));
  if ((await currentUrl(landing)).url !== url) throw new Error('el valor guardado no coincide con el esperado');
}

interface Plan {
  landing: LandingRow;
  url: string;
  size: number;
  match: { jpg: string; webp: string } | null;
  note: string;
}

/** Qué se haría con cada landing. */
async function plan(): Promise<Plan[]> {
  const map = await optimizedByOriginal();
  const out: Plan[] = [];
  for (const landing of await repo.listLandings()) {
    const { tipo, url } = await currentUrl(landing);
    if (tipo !== 'imagen' || !url) {
      out.push({ landing, url, size: 0, match: null, note: 'sin foto de fondo (color sólido)' });
      continue;
    }
    if (/\.webp(\?|$)/i.test(url)) {
      out.push({ landing, url, size: 0, match: null, note: 'ya es WebP (optimizada): no se toca' });
      continue;
    }
    const bytes = await readCurrent(url);
    if (!bytes) {
      out.push({ landing, url, size: 0, match: null, note: 'no se pudo leer la foto actual: no se toca' });
      continue;
    }
    const match = map.get(sha(bytes)) ?? null;
    out.push({
      landing,
      url,
      size: bytes.length,
      match,
      note: match ? 'es un original de seed/ con versión optimizada' : 'no coincide con ningún original de seed/ (foto propia): no se toca',
    });
  }
  return out;
}

async function estado() {
  const backup = (await exists(backupFile)) ? (JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup) : null;
  console.log(backup ? `Respaldo: sí (${backup.fecha})\n` : 'Respaldo: no hay\n');
  for (const p of await plan()) {
    console.log(`- ${p.landing.slug}${p.landing.is_default ? ' (por defecto)' : ''}`);
    console.log(`    foto: ${p.url || '(ninguna)'}${p.size ? ` — ${kb(p.size)}` : ''}`);
    console.log(`    ${p.note}${p.match ? ` → ${path.relative(seedDir, p.match.webp)} (${kb((await fs.stat(p.match.webp)).size)})` : ''}`);
  }
}

async function aplicar() {
  const problem = checkModes();
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (!(await exists(seedDir))) {
    console.error(`✗ No existe clients/${env.clientId}/seed/. Este comando se ejecuta desde el computador que tiene esa carpeta.`);
    process.exitCode = 1;
    return;
  }
  const items = await plan();
  const todo = items.filter((p) => p.match);
  const rule = UPLOAD_RULES.fondo;
  const webps = new Map<string, Buffer>();
  for (const p of todo) {
    const buf = await fs.readFile(p.match!.webp);
    if (buf.length > rule.maxBytes) {
      console.error(`✗ ${path.basename(p.match!.webp)} pesa ${kb(buf.length)} y el máximo es ${rule.label}.`);
      process.exitCode = 1;
      return;
    }
    if (buf.subarray(0, 4).toString('latin1') !== 'RIFF' || buf.subarray(8, 12).toString('latin1') !== 'WEBP') {
      console.error(`✗ ${path.basename(p.match!.webp)} no es un WebP válido.`);
      process.exitCode = 1;
      return;
    }
    webps.set(p.match!.webp, buf);
  }

  console.log('Plan:');
  for (const p of items) {
    if (!p.match) console.log(`  · ${p.landing.slug}: ${p.note}`);
    else console.log(`  ✓ ${p.landing.slug}: ${kb(p.size)} → ${kb(webps.get(p.match.webp)!.length)} (${path.basename(p.match.webp)})`);
  }
  console.log('');
  if (!todo.length) {
    console.log('Nada que optimizar.');
    return;
  }
  if (!confirm) {
    console.log('ENSAYO: no se cambió nada. Para aplicarlo, agrega --confirmar.');
    return;
  }

  // Respaldo antes de tocar nada: se escribe, se vuelve a leer y se compara.
  if (await exists(backupFile)) {
    if (!force) {
      console.error(`✗ Ya existe un respaldo (${path.relative(root, backupFile)}). Si ya aplicaste esto, no hace falta repetirlo; con "revertir" vuelves atrás. Para continuar de todas formas, usa --forzar.`);
      process.exitCode = 1;
      return;
    }
    await fs.rename(backupFile, backupFile.replace(/\.json$/, `-${stamp()}.json`));
  }
  {
    const backup: Backup = {
      fecha: new Date().toISOString(),
      cliente: env.clientId,
      landings: todo.map((p) => ({ slug: p.landing.slug, id: p.landing.id, fondo_imagen_url: p.url })),
    };
    await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), 'utf8');
    const reread = JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup;
    if (JSON.stringify(reread) !== JSON.stringify(backup)) throw new Error('El respaldo no se guardó bien. No se cambió nada.');
    console.log(`Respaldo guardado: ${path.relative(root, backupFile)}`);
  }

  let ok = 0;
  for (const p of todo) {
    try {
      const file = p.match!.webp;
      const objectPath = objectPathFor(env.clientId, 'fondo', path.basename(file), p.landing.is_default ? undefined : p.landing.slug);
      const url = await getStorage().put(objectPath, webps.get(file)!, 'image/webp');
      await saveUrl(p.landing, url);
      console.log(`  ✓ ${p.landing.slug}: ${kb(p.size)} → ${kb(webps.get(file)!.length)}`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${p.landing.slug}: ${(err as Error).message} (queda con su foto anterior)`);
      process.exitCode = 1;
    }
  }
  console.log(`\nListo: ${ok} de ${todo.length} landing(s). Para volver atrás: npx tsx scripts/optimizar-fondos.ts revertir --confirmar`);
}

async function revertir() {
  const problem = checkModes();
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }
  if (!(await exists(backupFile))) {
    console.error('✗ No hay respaldo: no hay nada que revertir.');
    process.exitCode = 1;
    return;
  }
  const backup = JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup;
  if (!Array.isArray(backup?.landings) || backup.landings.some((e) => !e?.id || !e?.slug || typeof e.fondo_imagen_url !== 'string')) {
    console.error('✗ El respaldo no tiene el formato esperado. No se cambió nada.');
    process.exitCode = 1;
    return;
  }
  console.log('Se restaurarían:');
  for (const e of backup.landings) console.log(`  · ${e.slug}: ${e.fondo_imagen_url}`);
  console.log('');
  if (!confirm) {
    console.log('ENSAYO: no se cambió nada. Para restaurar, agrega --confirmar.');
    return;
  }
  for (const e of backup.landings) {
    const landing = await repo.getLandingById(e.id);
    if (!landing) {
      console.error(`  ✗ ${e.slug}: la landing ya no existe`);
      process.exitCode = 1;
      continue;
    }
    try {
      await saveUrl(landing, e.fondo_imagen_url);
      console.log(`  ✓ ${e.slug}: restaurada`);
    } catch (err) {
      console.error(`  ✗ ${e.slug}: ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}

if (!['estado', 'aplicar', 'revertir'].includes(command)) {
  console.error('Uso: npx tsx scripts/optimizar-fondos.ts <estado|aplicar|revertir> [--confirmar] [--forzar]');
  process.exit(1);
}
printModes();
try {
  if (command === 'estado') await estado();
  else if (command === 'aplicar') await aplicar();
  else await revertir();
} finally {
  const { getDb } = await import('../src/db.js');
  await (await getDb()).close?.();
}
process.exit(process.exitCode ?? 0);
