// Aplica el esquema y carga los datos iniciales del cliente (clients/<id>/client.json + seed/).
// Lo usan `npm run setup` (Supabase) y el arranque local (base embebida vacía).
//
// Formato de client.json:
//   {
//     "id": "intursa",                      // = CLIENT_ID
//     "name": "Tambo del Inka – Outlets",   // nombre del cliente (cms_nombre de la landing por defecto)
//     "admin": { "username": "...", "password": "..." },   // un usuario para todas las landings
//     "landings": [
//       {
//         "slug": "tambo-outlets",          // dirección: /<slug> (la por defecto además responde en /)
//         "name": "Tambo del Inka – Outlets",
//         "hotel": "Tambo del Inka",        // agrupa las landings en el panel
//         "template": "cartas",             // "cartas" | "experiencias"
//         "is_default": true,               // exactamente una; opcional en las demás
//         "position": 0,                    // opcional: orden dentro del hotel
//         "settings": { ... },              // claves de settingsSchema (src/validation.ts)
//         "assets": { "logo": "logo.png", "fondo": "fondo.jpg" },
//         "buttons": [ { "label": "...", "pdf": "archivo.pdf" } | { "label": "...", "url": "https://...", "new_tab": true } ],
//         "socials": [ { "network": "facebook", "url": "https://..." } ]
//       }
//     ]
//   }
// Archivos: la landing por defecto usa clients/<id>/seed/ (logo, fondo y pdf/); cada landing nueva
// usa clients/<id>/seed/<slug>/ (logo, fondo y pdf/).
// Compatibilidad: sin "landings", los campos settings/assets/buttons/socials de nivel superior
// describen la landing por defecto (slug/hotel/template opcionales arriba; por defecto 'principal').

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { env } from './env.js';
import { getStorage, objectPathFor, type UploadPurpose } from './storage.js';
import { hashPassword } from './auth.js';
import * as repo from './repo.js';
import { runWithLanding, type Landing } from './context.js';
import { defaultSettingsFor, landingSlug, settingsSchema, TEMPLATES, type Settings, type Template } from './validation.js';
import type { Network } from './networks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Slug que la migración SQL da a la landing por defecto que crea (db/schema.sql). */
export const PROVISIONAL_SLUG = 'principal';

interface LandingContent {
  settings?: Partial<Settings>;
  assets?: { logo?: string; fondo?: string };
  buttons?: { label: string; pdf?: string; url?: string; new_tab?: boolean }[];
  socials?: { network: Network; url: string }[];
}

export interface LandingConfig extends LandingContent {
  slug: string;
  name: string;
  hotel?: string;
  template: Template;
  is_default?: boolean;
  position?: number;
}

export interface ClientConfig extends LandingContent {
  id: string;
  name: string;
  admin: { username: string; password: string };
  landings?: LandingConfig[];
  // Solo en el formato antiguo (sin "landings"):
  slug?: string;
  hotel?: string;
  template?: Template;
}

export async function loadClientConfig(clientId = env.clientId): Promise<{ config: ClientConfig; dir: string }> {
  const dir = path.join(root, 'clients', clientId);
  const raw = await fs.readFile(path.join(dir, 'client.json'), 'utf8');
  return { config: JSON.parse(raw) as ClientConfig, dir };
}

/** Landings de la configuración, validadas; la por defecto primero. */
export function configLandings(config: ClientConfig): LandingConfig[] {
  const list: LandingConfig[] = config.landings?.length
    ? config.landings
    : [
        {
          slug: config.slug ?? PROVISIONAL_SLUG,
          name: config.name,
          hotel: config.hotel ?? '',
          template: config.template ?? 'cartas',
          is_default: true,
          settings: config.settings,
          assets: config.assets,
          buttons: config.buttons,
          socials: config.socials,
        },
      ];
  const defaults = list.filter((l) => l.is_default);
  if (defaults.length !== 1) throw new Error(`client.json debe tener exactamente una landing con "is_default": true (tiene ${defaults.length}).`);
  const slugs = new Set<string>();
  for (const l of list) {
    if (!landingSlug.safeParse(l.slug).success) throw new Error(`Slug de landing inválido o reservado: "${l.slug}"`);
    if (slugs.has(l.slug)) throw new Error(`Slug de landing repetido: "${l.slug}"`);
    slugs.add(l.slug);
    if (!TEMPLATES.includes(l.template)) throw new Error(`Plantilla inválida en "${l.slug}": "${l.template}"`);
    if (!l.name) throw new Error(`La landing "${l.slug}" necesita "name".`);
  }
  return [...defaults, ...list.filter((l) => !l.is_default)];
}

export async function applySchema(): Promise<void> {
  const db = await getDb();
  const sqlText = await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
  await db.exec(sqlText);
}

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/** Archivos de la landing: seed/ (por defecto) o seed/<slug>/; se suben a su carpeta (ver objectPathFor). */
async function uploadSeedFile(dir: string, landing: Landing, relPath: string, purpose: UploadPurpose, log: (m: string) => void) {
  const base = landing.is_default ? path.join(dir, 'seed') : path.join(dir, 'seed', landing.slug);
  const file = path.join(base, relPath);
  const data = await fs.readFile(file);
  const name = path.basename(file);
  const objectPath = objectPathFor(env.clientId, purpose, name, landing.is_default ? undefined : landing.slug);
  const contentType = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  const url = await getStorage().put(objectPath, data, contentType);
  log(`  subido ${name} (${Math.round(data.length / 1024)} KB)`);
  return { url, objectPath, name };
}

/** Carga ajustes, archivos, botones y redes de una landing (en su contexto). */
async function loadLandingContent(dir: string, landing: Landing, cfg: LandingConfig, cmsNombre: string, log: (m: string) => void) {
  await runWithLanding(landing, async () => {
    const settings: Settings = settingsSchema.parse({ ...defaultSettingsFor(landing.template), cms_nombre: cmsNombre, ...cfg.settings });
    if (cfg.assets?.logo) settings.logo_url = (await uploadSeedFile(dir, landing, cfg.assets.logo, 'logo', log)).url;
    if (cfg.assets?.fondo) {
      settings.fondo_imagen_url = (await uploadSeedFile(dir, landing, cfg.assets.fondo, 'fondo', log)).url;
      settings.fondo_tipo = 'imagen';
    }
    await repo.saveSettings(settings);

    for (const b of cfg.buttons ?? []) {
      if (b.pdf) {
        const f = await uploadSeedFile(dir, landing, path.join('pdf', b.pdf), 'pdf', log);
        await repo.createButton({ label: b.label, kind: 'pdf', url: f.url, file_name: f.name, file_path: f.objectPath, new_tab: b.new_tab ?? false, active: true });
      } else {
        await repo.createButton({ label: b.label, kind: 'link', url: b.url ?? '', new_tab: b.new_tab ?? false, active: Boolean(b.url) });
      }
    }
    for (const s of cfg.socials ?? []) await repo.createSocial(s.network, s.url);
  });
  log(`  "${landing.name}" (/${landing.slug}): ${cfg.buttons?.length ?? 0} botones, ${cfg.socials?.length ?? 0} redes.`);
}

async function landingHasData(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query(
    `select 1 from landing_settings where landing_id = $1
     union all select 1 from buttons where landing_id = $1
     union all select 1 from socials where landing_id = $1 limit 1`,
    [id],
  );
  return rows.length > 0;
}

/** Quita botones, redes y ajustes de la landing (no la landing ni sus clics). */
async function clearLandingContent(id: string) {
  const db = await getDb();
  for (const t of ['buttons', 'socials']) await db.query(`delete from ${t} where client_id = $1 and landing_id = $2`, [env.clientId, id]);
  await db.query('delete from landing_settings where landing_id = $1', [id]);
}

/**
 * Carga las landings de client.json. Idempotente por landing:
 * - La que no existe (por slug; la por defecto, por is_default) se crea con todo su contenido.
 * - La que ya existe con datos no se vuelve a cargar. Si es la por defecto que creó la migración
 *   (slug provisional), se completan su slug, nombre, hotel y plantilla sin tocar su contenido.
 * - force = true: vuelve a cargar botones, redes y ajustes de las landings de la configuración
 *   (conserva las landings, sus ids y los clics).
 * El usuario administrador se crea (o se restablece) cuando se carga la landing por defecto.
 */
export async function seed({
  force = false,
  log = console.log,
  source,
}: { force?: boolean; log?: (m: string) => void; /** Para pruebas: otra configuración y carpeta. */ source?: { config: ClientConfig; dir: string } } = {}) {
  const { config, dir } = source ?? (await loadClientConfig());
  if (config.id !== env.clientId) throw new Error(`client.json tiene id "${config.id}" pero CLIENT_ID es "${env.clientId}"`);
  const landings = configLandings(config);

  let loaded = 0;
  let adminNeeded = false;
  for (const [i, cfg] of landings.entries()) {
    const meta = {
      slug: cfg.slug,
      name: cfg.name,
      hotel: cfg.hotel ?? '',
      template: cfg.template,
      position: cfg.position ?? i,
    };
    const cmsNombre = cfg.is_default ? config.name : cfg.name;
    let landing = cfg.is_default ? await repo.getDefaultLanding() : await repo.getLandingBySlug(cfg.slug);

    if (landing && !cfg.is_default && landing.is_default) {
      throw new Error(`El slug "${cfg.slug}" ya es de la landing por defecto.`);
    }

    if (!landing) {
      landing = await repo.createLanding({ ...meta, is_default: Boolean(cfg.is_default) });
      log(`Creando landing "${cfg.name}"…`);
    } else if (force || (cfg.is_default && landing.slug === PROVISIONAL_SLUG && cfg.slug !== PROVISIONAL_SLUG)) {
      const changed = (Object.keys(meta) as (keyof typeof meta)[]).some((k) => landing![k] !== meta[k]);
      if (changed) {
        landing = (await repo.updateLanding(landing.id, meta))!;
        log(`Datos de la landing "${cfg.name}" actualizados desde client.json.`);
      }
    }

    if (!force && (await landingHasData(landing.id))) {
      log(`La landing "${landing.name}" ya tiene datos; no se vuelve a cargar (usa --force para reemplazarlos).`);
      continue;
    }
    if (force) await clearLandingContent(landing.id);
    log(`Cargando datos iniciales de "${landing.name}"…`);
    await loadLandingContent(dir, landing, cfg, cmsNombre, log);
    loaded++;
    if (cfg.is_default) adminNeeded = true;
  }

  // DEFAULT de landing_id = landing por defecto (por si la base era nueva al aplicar el esquema).
  await repo.syncLandingColumnDefaults();

  if (adminNeeded) {
    const username = process.env.ADMIN_USERNAME || config.admin.username;
    const password = process.env.ADMIN_PASSWORD || config.admin.password;
    await repo.upsertAdmin(username, await hashPassword(password));
    log(`Usuario "${username}" listo.`);
  }
  if (loaded) log(`Listo: ${loaded} landing(s) cargada(s).`);
  return loaded > 0;
}
