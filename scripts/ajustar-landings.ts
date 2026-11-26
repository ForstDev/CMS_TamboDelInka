// Pone a las 9 landings ya creadas la misma dirección (slug) que tienen en la web de Intursa
// (https://www.intursa.com.pe/<slug>/) y, solo en los 3 spas, oculta las redes y deja la distribución «centrada».
// Se vuelve a como estaban con un comando.
//   npx tsx scripts/ajustar-landings.ts estado                 → muestra, por landing, su dirección, botones, clics (y en los spas,
//                                                                 redes y distribución) y si hay respaldo
//   npx tsx scripts/ajustar-landings.ts aplicar                → ENSAYO: muestra qué haría, sin cambiar nada
//   npx tsx scripts/ajustar-landings.ts aplicar --confirmar    → guarda el respaldo y aplica los cambios
//   npx tsx scripts/ajustar-landings.ts revertir               → ENSAYO: muestra qué restauraría
//   npx tsx scripts/ajustar-landings.ts revertir --confirmar   → deja las landings como estaban (según el respaldo)
//   --forzar (solo con aplicar): sigue aunque ya exista un respaldo; el respaldo viejo se conserva con otro nombre
//     (pero el nuevo respaldo guardará el estado actual, no el original).
// Sustituye a scripts/ajustar-spas.ts (que solo renombraba los spas a aqu-spa, andes-spirit-spa y kallpa-spa).
// Cada landing se busca por cualquiera de sus direcciones conocidas (la de producción, la intermedia de los spas o la
// final). Si ya tiene la final, se informa y se da por aplicada (no se toca). Si no:
//   1. solo spas: desactiva sus redes (active = false; no se borran) → desaparece «Síguenos»;
//   2. solo spas: guarda la distribución «centrada» (cartas_distribucion);
//   3. por último cambia la dirección (slug) a la final. Va al final a propósito: una landing con la dirección final
//      ya tiene todo lo demás aplicado. Los botones, sus ids y los clics no cambian (cuelgan del id de la landing).
// Ningún logo cambia. Antes de cambiar nada comprueba que ninguna dirección final la use OTRA landing: si pasa,
// o si una landing no se encuentra o no es la esperada, no se cambia nada.
// Las direcciones anteriores redirigen (301) a las finales desde el servidor (LEGACY_REDIRECTS en src/app.ts), salvo
// mientras una landing activa todavía tenga esa dirección. Por eso se ejecuta DESPUÉS de que el despliegue quede Ready.
// El respaldo queda en clients/<cliente>/seed/landings-respaldo.json (Git lo ignora): ids, dirección anterior y, en
// los spas, el estado de cada red y el valor anterior de la distribución (o que no existía). «revertir» restaura todo
// eso; un ajuste que no existía se vuelve a quitar (solo esa fila de landing_settings, que agregó este script).
// No sube ni borra nada del almacenamiento, ni borra botones, redes, landings o clics de la base.
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
const { getStorage } = await import('../src/storage.js');
const { runWithLanding } = await import('../src/context.js');
const { landingSlug, settingsPatch, socialPatch } = await import('../src/validation.js');
const { LEGACY_REDIRECTS } = await import('../src/app.js');
const repo = await import('../src/repo.js');

type Template = 'cartas' | 'experiencias';

/**
 * Lista de trabajo: dirección final (igual a intursa.com.pe) y las anteriores con las que puede estar en la base
 * (la de producción y, en los spas, la intermedia aqu-spa / andes-spirit-spa / kallpa-spa).
 */
const LANDINGS: { nombre: string; final: string; anteriores: string[]; template: Template; is_default: boolean; spa: boolean }[] = [
  { nombre: 'Tambo del Inka – Outlets', final: 'outlets-tambodelinka', anteriores: ['tambo-outlets'], template: 'cartas', is_default: true, spa: false },
  { nombre: 'Palacio del Inka – Experiencias', final: 'experiencias_palaciodelinka', anteriores: ['experiencias-palacio-del-inka'], template: 'experiencias', is_default: false, spa: false },
  { nombre: 'Hotel Paracas – Experiencias', final: 'experiencias_hotelparacas', anteriores: ['experiencias-hotel-paracas'], template: 'experiencias', is_default: false, spa: false },
  { nombre: 'Tambo del Inka – Experiencias', final: 'experiencias_tambodelinka', anteriores: ['experiencias-tambo-del-inka'], template: 'experiencias', is_default: false, spa: false },
  { nombre: 'Hotel Paracas – Outlets', final: 'outlets-hotelparacas', anteriores: ['outlets-hotel-paracas'], template: 'cartas', is_default: false, spa: false },
  { nombre: 'Palacio del Inka – Outlets', final: 'palacio-outlets', anteriores: ['outlets-palacio-del-inka'], template: 'cartas', is_default: false, spa: false },
  { nombre: 'Hotel Paracas – Aqu Spa', final: 'aquspa', anteriores: ['spa-hotel-paracas', 'aqu-spa'], template: 'cartas', is_default: false, spa: true },
  { nombre: 'Palacio del Inka – Andes Spirit Spa', final: 'spa-palaciodelinka', anteriores: ['spa-palacio-del-inka', 'andes-spirit-spa'], template: 'cartas', is_default: false, spa: true },
  { nombre: 'Tambo del Inka – Kallpa Spa', final: 'spa-tambodelinka', anteriores: ['spa-tambo-del-inka', 'kallpa-spa'], template: 'cartas', is_default: false, spa: true },
];
const DISTRIBUCION = 'centrada';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientFile = path.join(root, 'clients', env.clientId, 'client.json');
const seedDir = path.join(root, 'clients', env.clientId, 'seed');
const BACKUP_NAME = 'landings-respaldo.json';
const backupFile = path.join(seedDir, BACKUP_NAME);

type LandingRow = NonNullable<Awaited<ReturnType<typeof repo.getLandingBySlug>>>;
type Item = (typeof LANDINGS)[number];
type Social = Awaited<ReturnType<typeof repo.listSocials>>[number];
type Button = Awaited<ReturnType<typeof repo.listButtons>>[number];

/** Ajustes que toca el script (solo en los spas). null = la landing no tenía esa fila en landing_settings. */
const AJUSTES = ['cartas_distribucion'] as const;
type AjusteKey = (typeof AJUSTES)[number];
type Ajustes = Partial<Record<AjusteKey, string | null>>;

interface BackupRed {
  id: string;
  network: string;
  url: string;
  active: boolean;
}
interface BackupLanding {
  id: string;
  nombre: string;
  slug_anterior: string;
  slug_final: string;
  /** Solo spas (en las demás, vacío). */
  redes: BackupRed[];
  /** Solo spas: valor anterior de la distribución (en las demás, vacío). */
  ajustes: Ajustes;
}
interface Backup {
  fecha: string;
  cliente: string;
  landings: BackupLanding[];
}

const COMMANDS = ['aplicar', 'revertir', 'estado'];
const FLAGS = ['--confirmar', '--forzar'];
const command = process.argv[2] ?? '';
const flags = process.argv.slice(3);
const confirm = flags.includes('--confirmar');
const force = flags.includes('--forzar');

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const show = (v: string | null | undefined) => (v === null || v === undefined ? '(no existe)' : v === '' ? '(vacío)' : v);
const exists = (file: string) => fs.access(file).then(() => true, () => false);
const known = (item: Item) => [...item.anteriores, item.final];

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

/** Aborta si la base y los archivos no apuntan al mismo lugar (configuración a medias: .env incompleto). */
function checkModes(): string | null {
  if (env.databaseUrl && !env.supabaseUrl) return 'Falta SUPABASE_URL y SUPABASE_SECRET_KEY: la configuración de producción está incompleta.';
  const mode = storageMode();
  if (mode === 'error') return 'Falta SUPABASE_SECRET_KEY: la configuración de producción está incompleta.';
  if (env.databaseUrl && mode === 'local') return 'Los archivos están en modo local pero la base es de producción. No se continúa.';
  if (!env.databaseUrl && mode === 'supabase') return 'La base es local pero los archivos son de Supabase. No se continúa.';
  return null;
}

/** La lista de trabajo, las redirecciones del servidor y client.json deben coincidir, y las direcciones finales ser válidas. */
async function checkList(): Promise<string | null> {
  const total = LANDINGS.reduce((n, l) => n + l.anteriores.length, 0);
  if (Object.keys(LEGACY_REDIRECTS).length !== total) return 'La lista de landings no coincide con LEGACY_REDIRECTS (src/app.ts).';
  const finals = new Set(LANDINGS.map((l) => l.final));
  if (finals.size !== LANDINGS.length) return 'Hay direcciones finales repetidas en la lista.';
  let config: { landings?: { slug?: string; is_default?: boolean }[] };
  try {
    config = JSON.parse(await fs.readFile(clientFile, 'utf8'));
  } catch {
    return `No se pudo leer clients/${env.clientId}/client.json.`;
  }
  for (const l of LANDINGS) {
    for (const old of l.anteriores) {
      if (LEGACY_REDIRECTS[`/${old}`] !== `/${l.final}`) return `/${old} no redirige a /${l.final} en LEGACY_REDIRECTS (src/app.ts).`;
      if (finals.has(old)) return `/${old} es a la vez dirección anterior y final.`;
    }
    const r = landingSlug.safeParse(l.final);
    if (!r.success) return `La dirección final "${l.final}" no es válida: ${r.error.issues[0]?.message}`;
    const cfg = config.landings?.find((c) => c.slug === l.final);
    if (!cfg || Boolean(cfg.is_default) !== l.is_default) return `client.json no tiene la landing /${l.final} como se espera.`;
  }
  return null;
}

/** Filas actuales de los ajustes del script (null = no existe la fila). */
async function readAjustes(landingId: string, keys: readonly AjusteKey[]): Promise<Ajustes> {
  if (!keys.length) return {};
  const db = await getDb();
  const rows = await db.query<{ key: string; value: string }>('select key, value from landing_settings where landing_id = $1 and key = any($2::text[])', [
    landingId,
    [...keys],
  ]);
  return Object.fromEntries(keys.map((k) => [k, rows.find((r) => r.key === k)?.value ?? null])) as Ajustes;
}

const keysFor = (item: Item): AjusteKey[] => (item.spa ? ['cartas_distribucion'] : []);

async function clicksOf(landingId: string): Promise<number> {
  const db = await getDb();
  const rows = await db.query<{ n: number }>('select count(*)::int as n from clicks where client_id = $1 and landing_id = $2', [env.clientId, landingId]);
  return Number(rows[0]?.n ?? 0);
}

type Located = { estado: 'pendiente' | 'aplicado'; landing: LandingRow } | { error: string; conflicto?: boolean };

/** Dónde está cada landing: por una dirección anterior (pendiente), por la final (ya aplicada) o problema. */
async function locate(item: Item): Promise<Located> {
  const found = new Map<string, LandingRow>();
  for (const slug of known(item)) {
    const l = await repo.getLandingBySlug(slug);
    if (l) found.set(l.id, l);
  }
  if (found.size > 1) {
    const byFinal = [...found.values()].find((l) => l.slug === item.final);
    const desc = [...found.values()].map((l) => `/${l.slug} («${l.name}», id ${l.id})`).join(' y ');
    return {
      conflicto: true,
      error: byFinal
        ? `la dirección final /${item.final} ya la usa otra landing («${byFinal.name}», id ${byFinal.id}); existen ${desc}`
        : `existen varias landings para «${item.nombre}»: ${desc}; no se sabe cuál ajustar`,
    };
  }
  const landing = [...found.values()][0];
  if (!landing) return { error: `no hay ninguna landing ${known(item).map((s) => `/${s}`).join(', ')} en la base` };
  if (landing.is_default !== item.is_default) {
    return { error: `/${landing.slug} ${landing.is_default ? 'es' : 'no es'} la landing por defecto (se esperaba lo contrario); no se toca` };
  }
  if (landing.template !== item.template) return { error: `/${landing.slug} no usa la plantilla "${item.template}"; no se toca` };
  return { estado: landing.slug === item.final ? 'aplicado' : 'pendiente', landing };
}

async function readBackup(): Promise<Backup> {
  const data = JSON.parse(await fs.readFile(backupFile, 'utf8')) as Backup;
  const text = (v: unknown) => typeof v === 'string';
  const okAjuste = (v: unknown) => v === null || typeof v === 'string';
  if (
    !Array.isArray(data?.landings) ||
    data.landings.some(
      (e) =>
        !e?.id ||
        !text(e.nombre) ||
        !e?.slug_anterior ||
        !e?.slug_final ||
        !landingSlug.safeParse(e.slug_anterior).success ||
        !Array.isArray(e.redes) ||
        e.redes.some((r) => !r?.id || !text(r.network) || !text(r.url) || typeof r.active !== 'boolean') ||
        !e.ajustes ||
        typeof e.ajustes !== 'object' ||
        Object.entries(e.ajustes).some(([k, v]) => !(AJUSTES as readonly string[]).includes(k) || !okAjuste(v)),
    )
  ) {
    throw new Error(`El respaldo (${BACKUP_NAME}) existe pero no tiene el formato esperado. No se cambió nada.`);
  }
  return data;
}

/** Guarda ajustes con la misma validación del panel y comprueba que quedaron. Un valor null quita la fila (solo al revertir). */
async function saveAjustes(landing: LandingRow, values: Ajustes) {
  if (!Object.keys(values).length) return;
  const toSave = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null)) as Record<string, string>;
  const toRemove = Object.entries(values)
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (Object.keys(toSave).length) {
    const patch = settingsPatch.parse(toSave);
    await runWithLanding(landing, () => repo.saveSettings(patch));
  }
  if (toRemove.length) {
    const db = await getDb();
    await db.query('delete from landing_settings where landing_id = $1 and key = any($2::text[])', [landing.id, toRemove]);
  }
  const now = await readAjustes(landing.id, Object.keys(values) as AjusteKey[]);
  for (const [k, v] of Object.entries(values)) {
    if (now[k as AjusteKey] !== v) throw new Error(`el ajuste ${k} no quedó con el valor esperado`);
  }
}

/** Activa o desactiva una red (sin tocar su red, enlace ni posición) y comprueba el resultado. */
async function setRedActive(landing: LandingRow, red: Social, active: boolean) {
  const patch = socialPatch.parse({ active });
  const saved = await runWithLanding(landing, () => repo.updateSocial(red.id, patch));
  if (!saved) throw new Error(`la red ${red.network} ya no existe`);
  if (saved.active !== active || saved.network !== red.network || saved.url !== red.url || saved.position !== red.position) {
    throw new Error(`la red ${red.network} no quedó como se esperaba`);
  }
}

/** Cambia la dirección validándola como la API/el seed y comprobando que nadie más la usa. Conserva el id. */
async function setSlug(landing: LandingRow, slug: string): Promise<LandingRow> {
  const r = landingSlug.safeParse(slug);
  if (!r.success) throw new Error(`dirección inválida "${slug}": ${r.error.issues[0]?.message}`);
  const other = await repo.getLandingBySlug(slug);
  if (other && other.id !== landing.id) throw new Error(`la dirección /${slug} ya es de otra landing`);
  const saved = await repo.updateLanding(landing.id, { slug });
  if (!saved || saved.id !== landing.id || saved.slug !== slug) throw new Error('la dirección no quedó guardada');
  return saved;
}

const buttonsKey = (bs: Button[]) => JSON.stringify(bs.map((b) => [b.id, b.label, b.kind, b.url, b.file_path, b.new_tab, b.position, b.active]));
const redesText = (rs: Social[]) => (rs.length ? rs.map((s) => `${s.network} (${s.active ? 'visible' : 'oculta'})`).join(', ') : 'ninguna');

async function estado() {
  const backup = (await exists(backupFile)) ? await readBackup().catch(() => null) : null;
  console.log(backup ? `Respaldo: sí (${backup.fecha})\n` : (await exists(backupFile)) ? 'Respaldo: existe pero no se puede leer\n' : 'Respaldo: no hay\n');
  for (const item of LANDINGS) {
    console.log(`- ${item.nombre} → /${item.final}`);
    const r = await locate(item);
    if ('error' in r) {
      console.log(`    ✗ ${r.error}`);
    } else {
      const l = r.landing;
      const [buttons, socials] = await runWithLanding(l, () => Promise.all([repo.listButtons(), repo.listSocials()]));
      console.log(`    estado: ${r.estado === 'aplicado' ? 'YA APLICADO (tiene la dirección final)' : `pendiente (tiene /${l.slug})`}`);
      console.log(`    landing: "${l.name}" · id ${l.id} · /${l.slug}${l.is_default ? ' (por defecto, también en /)' : ''} · ${l.active ? 'activa' : 'inactiva'}`);
      console.log(`    botones: ${buttons.length} (${buttons.filter((b) => b.active && b.url).length} visibles) · clics: ${await clicksOf(l.id)}`);
      if (item.spa) {
        const ajustes = await readAjustes(l.id, keysFor(item));
        console.log(`    redes: ${redesText(socials)}`);
        console.log(`    distribución: ${ajustes.cartas_distribucion ?? '(sin guardar → compacta)'}`);
      }
    }
    const entry = backup?.landings.find((e) => e.slug_final === item.final);
    console.log(`    respaldo: ${entry ? `sí (id ${entry.id}, antes /${entry.slug_anterior})` : 'no'}`);
  }
}

async function aplicar() {
  const problem = checkModes() ?? (await checkList());
  if (problem) {
    console.error(`✗ ${problem}`);
    process.exitCode = 1;
    return;
  }

  // 1. Respaldo previo.
  const hasBackup = await exists(backupFile);
  if (hasBackup && !force) {
    console.error(`✗ Ya existe un respaldo (${BACKUP_NAME}). Si lo pisara se perdería el estado original.`);
    console.error('  Para volver a como estaban: npx tsx scripts/ajustar-landings.ts revertir --confirmar');
    console.error('  Solo si estás seguro de que el respaldo ya no sirve: agrega --forzar (el respaldo viejo se conserva con otro nombre).');
    process.exitCode = 1;
    return;
  }

  // 2. Dónde está cada landing y qué falta. Cualquier problema (no está, no es la esperada o la dirección final ya es
  //    de otra landing) detiene todo antes de cambiar nada.
  const plan: { item: Item; landing: LandingRow; redes: Social[]; buttons: Button[]; clicks: number; ajustes: Ajustes }[] = [];
  const already: string[] = [];
  const problems: string[] = [];
  for (const item of LANDINGS) {
    const r = await locate(item);
    if ('error' in r) {
      problems.push(`${item.nombre}: ${r.error}`);
      continue;
    }
    if (r.estado === 'aplicado') {
      console.log(`· ${item.nombre}: ya tiene la dirección final /${item.final}; se da por aplicada y no se toca.`);
      already.push(`/${item.final}`);
      continue;
    }
    const [redes, buttons] = await runWithLanding(r.landing, () => Promise.all([repo.listSocials(), repo.listButtons()]));
    plan.push({ item, landing: r.landing, redes, buttons, clicks: await clicksOf(r.landing.id), ajustes: await readAjustes(r.landing.id, keysFor(item)) });
  }
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}.`);
    console.error('\n✗ No se cambió nada. Revisa la base (npx tsx scripts/ajustar-landings.ts estado) antes de volver a intentarlo.');
    process.exitCode = 1;
    return;
  }
  if (!plan.length) {
    console.log(`\nNada que aplicar: las ${LANDINGS.length} landings ya tienen su dirección final. No se cambió nada.`);
    return;
  }

  if (hasBackup) console.log('\nPlan (con --forzar: el respaldo existente se conservará con otro nombre y se creará uno nuevo con el estado actual):');
  else console.log(`\nPlan (se creará el respaldo ${BACKUP_NAME} con el estado actual):`);
  for (const p of plan) {
    console.log(`- "${p.landing.name}" · id ${p.landing.id}`);
    if (p.item.spa) {
      console.log(`    redes: ${redesText(p.redes)}${p.redes.length ? ' → todas ocultas (no se borran)' : ''}`);
      console.log(`    distribución: ${p.ajustes.cartas_distribucion ?? '(sin guardar → compacta)'} → ${DISTRIBUCION}`);
    }
    console.log(`    dirección: /${p.landing.slug} → /${p.item.final} (la anterior redirige a la final)${p.landing.is_default ? ' · sigue también en /' : ''}`);
    console.log(`    botones: ${p.buttons.length} sin cambios (mismos ids) · clics: ${p.clicks} sin cambios`);
  }
  if (already.length) console.log(`\nYa aplicadas (no se tocan): ${already.join('; ')}`);
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    return;
  }

  // 3. Respaldo: escribir, releer y verificar ANTES de tocar la base.
  if (hasBackup) {
    const old = path.join(seedDir, `landings-respaldo-previo-${stamp()}.json`);
    await fs.rename(backupFile, old);
    console.log(`\nRespaldo anterior conservado como ${path.basename(old)}`);
  }
  const backup: Backup = {
    fecha: new Date().toISOString(),
    cliente: env.clientId,
    landings: plan.map((p) => ({
      id: p.landing.id,
      nombre: p.landing.name,
      slug_anterior: p.landing.slug,
      slug_final: p.item.final,
      redes: p.item.spa ? p.redes.map((s) => ({ id: s.id, network: s.network, url: s.url, active: s.active })) : [],
      ajustes: p.ajustes,
    })),
  };
  await fs.writeFile(backupFile, JSON.stringify(backup, null, 2), 'utf8');
  const check = await readBackup();
  if (JSON.stringify(check) !== JSON.stringify(backup)) throw new Error('El respaldo no quedó bien escrito. No se cambió nada en la base.');
  console.log('✓ Respaldo guardado y verificado\n');

  // 4. Aplicar, landing por landing; la dirección al final.
  const done: string[] = [];
  const failed: string[] = [];
  for (const p of plan) {
    const name = `/${p.landing.slug} → /${p.item.final}`;
    const steps: string[] = [];
    try {
      if (p.item.spa) {
        for (const red of p.redes) {
          if (red.active) await setRedActive(p.landing, red, false);
        }
        steps.push(p.redes.length ? `${p.redes.length} red(es) ocultas` : 'sin redes');

        await saveAjustes(p.landing, { cartas_distribucion: DISTRIBUCION });
        steps.push(`distribución ${DISTRIBUCION}`);
      }

      const after = await setSlug(p.landing, p.item.final);
      steps.push(`dirección /${after.slug}`);

      // Lo que NO debe cambiar: botones (ids, destino, orden, visibilidad) y clics.
      const buttons = await runWithLanding(after, () => repo.listButtons());
      if (buttonsKey(buttons) !== buttonsKey(p.buttons)) throw new Error('cambiaron los botones (no debían)');
      if ((await clicksOf(after.id)) < p.clicks) throw new Error('faltan clics (no debían cambiar)');

      done.push(name);
      console.log(`✓ ${name}: ${steps.join(' · ')}`);
    } catch (err) {
      failed.push(name);
      console.error(`✗ ${name}: ${err instanceof Error ? err.message : err}`);
      console.error(`    hecho antes del error: ${steps.length ? steps.join(' · ') : 'nada'}`);
    }
  }

  // 5. Resumen.
  console.log(`\nAplicadas: ${done.length ? done.join('; ') : 'ninguna'}`);
  if (failed.length) {
    console.error(`Con error: ${failed.join('; ')} (el respaldo permite revertir lo que alcanzó a cambiar)`);
    process.exitCode = 1;
  }
  console.log('\nPara volver a como estaban:');
  console.log('  npx tsx scripts/ajustar-landings.ts revertir --confirmar');
}

async function revertir() {
  if (!(await exists(backupFile))) {
    console.log(`No hay respaldo (${BACKUP_NAME}): no hay nada que revertir y no se cambió nada.`);
    return;
  }
  const backup = await readBackup();
  console.log(`Respaldo del ${backup.fecha}:`);
  const plan: { entry: BackupLanding; landing: LandingRow; redes: { red: Social; active: boolean }[]; missing: string[] }[] = [];
  for (const entry of backup.landings) {
    const landing = await repo.getLandingById(entry.id);
    if (!landing) {
      console.warn(`! /${entry.slug_anterior}: la landing (id ${entry.id}) ya no existe; se omite.`);
      continue;
    }
    const socials = await runWithLanding(landing, () => repo.listSocials());
    const redes: { red: Social; active: boolean }[] = [];
    const missing: string[] = [];
    for (const r of entry.redes) {
      const red = socials.find((s) => s.id === r.id);
      if (red) redes.push({ red, active: r.active });
      else missing.push(r.network);
    }
    const now = await readAjustes(landing.id, Object.keys(entry.ajustes) as AjusteKey[]);
    plan.push({ entry, landing, redes, missing });
    console.log(`- "${landing.name}" · id ${landing.id}`);
    console.log(`    dirección: /${landing.slug} → /${entry.slug_anterior}`);
    if (entry.redes.length) {
      console.log(`    redes: ${redes.length ? redes.map((x) => `${x.red.network} ${x.red.active ? 'visible' : 'oculta'} → ${x.active ? 'visible' : 'oculta'}`).join(', ') : 'ninguna'}`);
    }
    if (missing.length) console.warn(`    ! ya no existen: ${missing.join(', ')} (se omiten)`);
    for (const [k, v] of Object.entries(entry.ajustes)) {
      console.log(`    ${k}: ${show(now[k as AjusteKey])} → ${v === null ? '(se quita: no existía)' : show(v)}`);
    }
  }
  if (!confirm) {
    console.log('\nEnsayo: no se cambió nada. Para ejecutar agrega --confirmar.');
    return;
  }

  const restored: string[] = [];
  const failed: string[] = [];
  for (const p of plan) {
    const name = `/${p.entry.slug_final} → /${p.entry.slug_anterior}`;
    try {
      for (const { red, active } of p.redes) {
        if (red.active !== active) await setRedActive(p.landing, red, active);
      }
      await saveAjustes(p.landing, p.entry.ajustes);
      if (p.landing.slug !== p.entry.slug_anterior) await setSlug(p.landing, p.entry.slug_anterior);
      if (p.missing.length) throw new Error(`no se pudieron restaurar las redes que ya no existen: ${p.missing.join(', ')}`);
      restored.push(name);
      console.log(`✓ ${name} restaurada`);
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
  const renamed = `landings-respaldo-revertido-${stamp()}.json`;
  await fs.rename(backupFile, path.join(seedDir, renamed));
  console.log(`\nListo: ${restored.length} landing(s) restaurada(s). Respaldo renombrado a ${renamed}`);
  console.log('Para probar de nuevo: aplicar --confirmar');
  console.log('Ojo: las direcciones anteriores vuelven a servir su landing; las finales quedan en 404 hasta volver a aplicar.');
}

async function main() {
  if (!COMMANDS.includes(command)) {
    console.error('Uso: npx tsx scripts/ajustar-landings.ts <estado|aplicar|revertir> [--confirmar] [--forzar]');
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
