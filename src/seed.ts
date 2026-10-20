// Aplica el esquema y carga los datos iniciales del cliente (clients/<id>/client.json + seed/).
// Lo usan `npm run setup` (Supabase) y el arranque local (base embebida vacía).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';
import { env } from './env.js';
import { getStorage, objectPathFor } from './storage.js';
import { hashPassword } from './auth.js';
import * as repo from './repo.js';
import { DEFAULT_SETTINGS, settingsSchema, type Settings } from './validation.js';
import type { Network } from './networks.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

interface ClientConfig {
  id: string;
  name: string;
  admin: { username: string; password: string };
  settings: Partial<Settings>;
  assets: { logo?: string; fondo?: string };
  buttons: { label: string; pdf?: string; url?: string; new_tab?: boolean }[];
  socials: { network: Network; url: string }[];
}

export async function loadClientConfig(clientId = env.clientId): Promise<{ config: ClientConfig; dir: string }> {
  const dir = path.join(root, 'clients', clientId);
  const raw = await fs.readFile(path.join(dir, 'client.json'), 'utf8');
  return { config: JSON.parse(raw) as ClientConfig, dir };
}

export async function applySchema(): Promise<void> {
  const db = await getDb();
  const sqlText = await fs.readFile(path.join(root, 'db', 'schema.sql'), 'utf8');
  await db.exec(sqlText);
}

const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

async function uploadSeedFile(dir: string, relPath: string, purpose: 'pdf' | 'logo' | 'fondo', log: (m: string) => void) {
  const file = path.join(dir, 'seed', relPath);
  const data = await fs.readFile(file);
  const name = path.basename(file);
  const objectPath = objectPathFor(env.clientId, purpose, name);
  const contentType = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream';
  const url = await getStorage().put(objectPath, data, contentType);
  log(`  subido ${name} (${Math.round(data.length / 1024)} KB)`);
  return { url, objectPath, name };
}

/** Carga datos iniciales solo si el cliente aún no tiene ajustes (o si force = true). */
export async function seed({ force = false, log = console.log }: { force?: boolean; log?: (m: string) => void } = {}) {
  const { config, dir } = await loadClientConfig();
  if (config.id !== env.clientId) throw new Error(`client.json tiene id "${config.id}" pero CLIENT_ID es "${env.clientId}"`);

  if (!force && (await repo.hasSettings())) {
    log(`El cliente "${env.clientId}" ya tiene datos; no se vuelve a cargar (usa --force para reemplazarlos).`);
    return false;
  }

  const db = await getDb();
  if (force) {
    for (const t of ['buttons', 'socials', 'settings']) await db.query(`delete from ${t} where client_id = $1`, [env.clientId]);
  }

  log(`Cargando datos iniciales de "${config.name}"…`);
  const settings: Settings = settingsSchema.parse({ ...DEFAULT_SETTINGS, cms_nombre: config.name, ...config.settings });

  if (config.assets.logo) settings.logo_url = (await uploadSeedFile(dir, config.assets.logo, 'logo', log)).url;
  if (config.assets.fondo) {
    settings.fondo_imagen_url = (await uploadSeedFile(dir, config.assets.fondo, 'fondo', log)).url;
    settings.fondo_tipo = 'imagen';
  }
  await repo.saveSettings(settings);

  for (const b of config.buttons) {
    if (b.pdf) {
      const f = await uploadSeedFile(dir, path.join('pdf', b.pdf), 'pdf', log);
      await repo.createButton({ label: b.label, kind: 'pdf', url: f.url, file_name: f.name, file_path: f.objectPath, new_tab: b.new_tab ?? false, active: true });
    } else {
      await repo.createButton({ label: b.label, kind: 'link', url: b.url ?? '', new_tab: b.new_tab ?? false, active: Boolean(b.url) });
    }
  }
  for (const s of config.socials) await repo.createSocial(s.network, s.url);

  const username = process.env.ADMIN_USERNAME || config.admin.username;
  const password = process.env.ADMIN_PASSWORD || config.admin.password;
  await repo.upsertAdmin(username, await hashPassword(password));
  log(`Listo: ${config.buttons.length} botones, ${config.socials.length} redes, usuario "${username}".`);
  return true;
}
