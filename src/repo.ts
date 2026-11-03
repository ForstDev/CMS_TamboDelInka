// Consultas a la base. Todas filtran por client_id y, salvo los administradores, por la landing
// actual (src/context.ts). Sin contexto se usa la landing por defecto del cliente.

import { getDb } from './db.js';
import { env } from './env.js';
import { defaultSettingsFor, type Settings, type Template } from './validation.js';
import { NETWORKS, type Network } from './networks.js';
import { currentLanding, type Landing } from './context.js';

export type { Landing } from './context.js';

export interface Button {
  id: string;
  label: string;
  kind: 'pdf' | 'link';
  url: string;
  file_name: string;
  file_path: string;
  new_tab: boolean;
  position: number;
  active: boolean;
}

export interface Social {
  id: string;
  network: Network;
  url: string;
  position: number;
  active: boolean;
}

const cid = () => env.clientId;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUTTON_COLS = 'id, label, kind, url, file_name, file_path, new_tab, position, active';
const SOCIAL_COLS = 'id, network, url, position, active';
const LANDING_COLS = 'id, slug, name, hotel, template, is_default, position, active';

// ---------- Landings ----------

export async function listLandings(): Promise<Landing[]> {
  const db = await getDb();
  return db.query<Landing>(`select ${LANDING_COLS} from landings where client_id = $1 order by hotel, position, name`, [cid()]);
}

export async function getLandingBySlug(slug: string): Promise<Landing | null> {
  const db = await getDb();
  const rows = await db.query<Landing>(`select ${LANDING_COLS} from landings where client_id = $1 and slug = $2`, [cid(), slug]);
  return rows[0] ?? null;
}

export async function getLandingById(id: string): Promise<Landing | null> {
  if (!UUID.test(id)) return null;
  const db = await getDb();
  const rows = await db.query<Landing>(`select ${LANDING_COLS} from landings where client_id = $1 and id = $2`, [cid(), id]);
  return rows[0] ?? null;
}

export async function getDefaultLanding(): Promise<Landing | null> {
  const db = await getDb();
  const rows = await db.query<Landing>(`select ${LANDING_COLS} from landings where client_id = $1 and is_default`, [cid()]);
  return rows[0] ?? null;
}

export interface LandingInput {
  slug: string;
  name: string;
  hotel?: string;
  template: Template;
  is_default?: boolean;
  position?: number;
  active?: boolean;
}

export async function createLanding(input: LandingInput): Promise<Landing> {
  const db = await getDb();
  const rows = await db.query<Landing>(
    `insert into landings (client_id, slug, name, hotel, template, is_default, position, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning ${LANDING_COLS}`,
    [cid(), input.slug, input.name, input.hotel ?? '', input.template, input.is_default ?? false, input.position ?? 0, input.active ?? true],
  );
  return rows[0]!;
}

export async function updateLanding(id: string, patch: Partial<LandingInput>): Promise<Landing | null> {
  const sets: string[] = [];
  const params: unknown[] = [cid(), id];
  for (const k of ['slug', 'name', 'hotel', 'template', 'is_default', 'position', 'active'] as const) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return getLandingById(id);
  const db = await getDb();
  const rows = await db.query<Landing>(`update landings set ${sets.join(', ')} where client_id = $1 and id = $2 returning ${LANDING_COLS}`, params);
  return rows[0] ?? null;
}

/**
 * Valor por defecto de landing_id en buttons/socials/clicks = landing por defecto. Así el código
 * anterior (que inserta sin landing_id) deja sus filas en ella. Base de un solo client_id.
 */
export async function syncLandingColumnDefaults(): Promise<void> {
  const d = await getDefaultLanding();
  if (!d || !UUID.test(d.id)) return;
  const db = await getDb();
  for (const t of ['buttons', 'socials', 'clicks']) await db.query(`alter table ${t} alter column landing_id set default '${d.id}'::uuid`);
}

/** Landing del contexto o, sin contexto, la por defecto (null si aún no hay ninguna). */
async function landing(): Promise<Landing | null> {
  return currentLanding() ?? (await getDefaultLanding());
}

const lid = async () => (await landing())?.id ?? null;

/** Para escrituras: si la base aún no tiene landing, crea la por defecto provisional (como la migración). */
async function writeLandingId(): Promise<string> {
  const l = await landing();
  if (l) return l.id;
  const db = await getDb();
  await db.query(
    `insert into landings (client_id, slug, name, template, is_default) values ($1, 'principal', 'Principal', 'cartas', true) on conflict do nothing`,
    [cid()],
  );
  await syncLandingColumnDefaults();
  const d = await getDefaultLanding();
  if (!d) throw new Error('No se pudo preparar la landing por defecto.');
  return d.id;
}

// ---------- Ajustes ----------

/** Ajustes de la landing actual sobre los valores por defecto de su plantilla. */
export async function getSettings(): Promise<Settings> {
  const l = await landing();
  const out: Record<string, string> = { ...defaultSettingsFor(l?.template ?? 'cartas') };
  if (!l) return out as Settings;
  const db = await getDb();
  const rows = await db.query<{ key: string; value: string }>('select key, value from landing_settings where landing_id = $1', [l.id]);
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const landingId = await writeLandingId();
  const db = await getDb();
  await db.query(
    `insert into landing_settings (landing_id, key, value)
     select $1, x->>'key', x->>'value' from jsonb_array_elements($2::text::jsonb) x
     on conflict (landing_id, key) do update set value = excluded.value`,
    [landingId, JSON.stringify(entries.map(([key, value]) => ({ key, value: String(value) })))],
  );
}

export async function hasSettings(): Promise<boolean> {
  const id = await lid();
  if (!id) return false;
  const db = await getDb();
  const rows = await db.query('select 1 from landing_settings where landing_id = $1 limit 1', [id]);
  return rows.length > 0;
}

// ---------- Botones ----------

export async function listButtons(onlyPublic = false): Promise<Button[]> {
  const db = await getDb();
  const where = onlyPublic ? "and active and url <> ''" : '';
  return db.query<Button>(`select ${BUTTON_COLS} from buttons where client_id = $1 and landing_id = $2 ${where} order by position, created_at`, [cid(), await lid()]);
}

/** Botón de la landing actual (el CMS no puede tocar botones de otra landing). */
export async function getButton(id: string): Promise<Button | null> {
  const db = await getDb();
  const rows = await db.query<Button>(`select ${BUTTON_COLS} from buttons where client_id = $1 and landing_id = $2 and id = $3`, [cid(), await lid(), id]);
  return rows[0] ?? null;
}

/** Para /go/:id: el botón de cualquier landing del cliente, con su landing. */
export async function findButtonForTracking(id: string): Promise<(Button & { landing_id: string | null }) | null> {
  const db = await getDb();
  const rows = await db.query<Button & { landing_id: string | null }>(`select ${BUTTON_COLS}, landing_id from buttons where client_id = $1 and id = $2`, [cid(), id]);
  return rows[0] ?? null;
}

export async function createButton(input: Partial<Button> & { label: string }): Promise<Button> {
  const landingId = await writeLandingId();
  const db = await getDb();
  const rows = await db.query<Button>(
    `insert into buttons (client_id, landing_id, label, kind, url, file_name, file_path, new_tab, active, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9,
             coalesce((select max(position) + 1 from buttons where client_id = $1 and landing_id = $2), 0))
     returning ${BUTTON_COLS}`,
    [cid(), landingId, input.label, input.kind ?? 'pdf', input.url ?? '', input.file_name ?? '', input.file_path ?? '', input.new_tab ?? false, input.active ?? false],
  );
  return rows[0]!;
}

export async function updateButton(id: string, patch: Partial<Button>): Promise<Button | null> {
  const allowed = ['label', 'kind', 'url', 'file_name', 'file_path', 'new_tab', 'active'] as const;
  const sets: string[] = [];
  const params: unknown[] = [cid(), await lid(), id];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return getButton(id);
  const db = await getDb();
  const rows = await db.query<Button>(
    `update buttons set ${sets.join(', ')}, updated_at = now() where client_id = $1 and landing_id = $2 and id = $3 returning ${BUTTON_COLS}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteButton(id: string): Promise<Button | null> {
  const db = await getDb();
  const rows = await db.query<Button>(`delete from buttons where client_id = $1 and landing_id = $2 and id = $3 returning ${BUTTON_COLS}`, [cid(), await lid(), id]);
  return rows[0] ?? null;
}

async function reorder(table: 'buttons' | 'socials', ids: string[]) {
  const db = await getDb();
  await db.query(
    `update ${table} t set position = (x.ord - 1)::int
     from jsonb_array_elements_text($3::text::jsonb) with ordinality as x(id, ord)
     where t.client_id = $1 and t.landing_id = $2 and t.id = x.id::uuid`,
    [cid(), await lid(), JSON.stringify(ids)],
  );
}

export const reorderButtons = (ids: string[]) => reorder('buttons', ids);
export const reorderSocials = (ids: string[]) => reorder('socials', ids);

// ---------- Redes ----------

export async function listSocials(onlyPublic = false): Promise<Social[]> {
  const db = await getDb();
  const where = onlyPublic ? "and active and url <> ''" : '';
  return db.query<Social>(`select ${SOCIAL_COLS} from socials where client_id = $1 and landing_id = $2 ${where} order by position`, [cid(), await lid()]);
}

/** Red de la landing actual. */
export async function getSocial(id: string): Promise<Social | null> {
  const db = await getDb();
  const rows = await db.query<Social>(`select ${SOCIAL_COLS} from socials where client_id = $1 and landing_id = $2 and id = $3`, [cid(), await lid(), id]);
  return rows[0] ?? null;
}

/** Para /go/social/:id: la red de cualquier landing del cliente. */
export async function findSocialForTracking(id: string): Promise<(Social & { landing_id: string | null }) | null> {
  const db = await getDb();
  const rows = await db.query<Social & { landing_id: string | null }>(`select ${SOCIAL_COLS}, landing_id from socials where client_id = $1 and id = $2`, [cid(), id]);
  return rows[0] ?? null;
}

export async function createSocial(network: Network, url: string): Promise<Social> {
  const landingId = await writeLandingId();
  const db = await getDb();
  const rows = await db.query<Social>(
    `insert into socials (client_id, landing_id, network, url, position)
     values ($1, $2, $3, $4, coalesce((select max(position) + 1 from socials where client_id = $1 and landing_id = $2), 0))
     returning ${SOCIAL_COLS}`,
    [cid(), landingId, network, url],
  );
  return rows[0]!;
}

export async function updateSocial(id: string, patch: Partial<Social>): Promise<Social | null> {
  const sets: string[] = [];
  const params: unknown[] = [cid(), await lid(), id];
  for (const k of ['network', 'url', 'active'] as const) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  const db = await getDb();
  if (!sets.length) {
    const rows = await db.query<Social>(`select ${SOCIAL_COLS} from socials where client_id = $1 and landing_id = $2 and id = $3`, params);
    return rows[0] ?? null;
  }
  const rows = await db.query<Social>(
    `update socials set ${sets.join(', ')} where client_id = $1 and landing_id = $2 and id = $3 returning ${SOCIAL_COLS}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteSocial(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('delete from socials where client_id = $1 and landing_id = $2 and id = $3 returning id', [cid(), await lid(), id]);
  return rows.length > 0;
}

// ---------- Clics y estadísticas ----------
// El clic se guarda en la landing del botón (o de la red), no en la del contexto: /go/:id no tiene landing.

export async function recordClick(button: Pick<Button, 'id' | 'label'>, device: 'mobile' | 'tablet' | 'desktop'): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into clicks (client_id, button_id, button_label, device, landing_id)
     values ($1, $2, $3, $4, coalesce((select landing_id from buttons where client_id = $1 and id = $2), $5::uuid))`,
    [cid(), button.id, button.label, device, await lid()],
  );
}

const networkLabel = (network: string) => NETWORKS[network as Network]?.label ?? network;

/** Clic en el ícono de una red. button_label guarda el nombre de la red por si luego se borra. */
export async function recordSocialClick(social: Pick<Social, 'id' | 'network'>, device: 'mobile' | 'tablet' | 'desktop'): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into clicks (client_id, source, social_id, button_id, button_label, device, landing_id)
     values ($1, 'social', $2, null, $3, $4, coalesce((select landing_id from socials where client_id = $1 and id = $2), $5::uuid))`,
    [cid(), social.id, networkLabel(social.network), device, await lid()],
  );
}

/** Inicio del periodo: medianoche (hora local del cliente) de hace days-1 días. */
const PERIOD_START = `(((now() at time zone $2)::date - ($3::int - 1))::timestamp at time zone $2)`;

export interface SocialStat {
  id: string | null;
  network: string;
  label: string;
  clicks: number;
  active: boolean;
  deleted: boolean;
}

export interface Stats {
  days: number;
  total: number;
  today: number;
  allTime: number;
  ranking: { id: string | null; label: string; active: boolean; deleted: boolean; clicks: number }[];
  daily: { day: string; clicks: number }[];
  devices: { device: string; clicks: number }[];
  hours: { hour: number; clicks: number }[];
  socials: { total: number; ranking: SocialStat[] };
}

// Las estadísticas de cartas solo cuentan source = 'button'. Ojo: button_id null significa
// "botón eliminado" solo junto con ese filtro (los clics de redes también tienen button_id null).
export async function getStats(days: number): Promise<Stats> {
  const db = await getDb();
  // $4 = landing actual. Los clics de un botón o red siempre son de su misma landing.
  const p = [cid(), env.statsTz, days, await lid()];

  const [ranking, deleted, daily, devices, hours, totals, socials, deletedSocials] = await Promise.all([
    db.query(
      `select b.id, b.label, b.active, count(c.id)::int as clicks
       from buttons b
       left join clicks c on c.button_id = b.id and c.source = 'button' and c.clicked_at >= ${PERIOD_START}
       where b.client_id = $1 and b.landing_id = $4
       group by b.id, b.label, b.active, b.position
       order by clicks desc, b.position`,
      p,
    ),
    db.query(
      `select button_label as label, count(*)::int as clicks
       from clicks
       where client_id = $1 and landing_id = $4 and source = 'button' and button_id is null and clicked_at >= ${PERIOD_START}
       group by button_label order by clicks desc`,
      p,
    ),
    db.query(
      `select to_char(d, 'YYYY-MM-DD') as day, count(c.id)::int as clicks
       from generate_series((now() at time zone $2)::date - ($3::int - 1), (now() at time zone $2)::date, interval '1 day') d
       left join clicks c on c.client_id = $1 and c.landing_id = $4 and c.source = 'button' and (c.clicked_at at time zone $2)::date = d::date
       group by d order by d`,
      p,
    ),
    db.query(
      `select device, count(*)::int as clicks from clicks
       where client_id = $1 and landing_id = $4 and source = 'button' and clicked_at >= ${PERIOD_START}
       group by device order by clicks desc`,
      p,
    ),
    db.query(
      `select h as hour, count(c.id)::int as clicks
       from generate_series(0, 23) h
       left join clicks c on c.client_id = $1 and c.landing_id = $4 and c.source = 'button' and c.clicked_at >= ${PERIOD_START}
                          and extract(hour from c.clicked_at at time zone $2)::int = h
       group by h order by h`,
      p,
    ),
    db.query(
      `select
         count(*) filter (where source = 'button' and clicked_at >= ${PERIOD_START})::int as total,
         count(*) filter (where source = 'button' and (clicked_at at time zone $2)::date = (now() at time zone $2)::date)::int as today,
         count(*) filter (where source = 'button')::int as all_time,
         count(*) filter (where source = 'social' and clicked_at >= ${PERIOD_START})::int as social_total
       from clicks where client_id = $1 and landing_id = $4`,
      p,
    ),
    db.query(
      `select s.id, s.network, s.active, s.position, count(c.id)::int as clicks
       from socials s
       left join clicks c on c.social_id = s.id and c.source = 'social' and c.clicked_at >= ${PERIOD_START}
       where s.client_id = $1 and s.landing_id = $4
       group by s.id, s.network, s.active, s.position
       order by clicks desc, s.position`,
      p,
    ),
    db.query(
      `select button_label as label, count(*)::int as clicks
       from clicks
       where client_id = $1 and landing_id = $4 and source = 'social' and social_id is null and clicked_at >= ${PERIOD_START}
       group by button_label order by clicks desc`,
      p,
    ),
  ]);

  // Red eliminada: se recupera su clave a partir del nombre guardado.
  const networkFromLabel = (label: string) => Object.entries(NETWORKS).find(([, n]) => n.label === label)?.[0] ?? 'web';

  const t = totals[0] ?? { total: 0, today: 0, all_time: 0, social_total: 0 };
  return {
    days,
    total: Number(t.total),
    today: Number(t.today),
    allTime: Number(t.all_time),
    ranking: [
      ...ranking.map((r) => ({ id: r.id, label: r.label, active: r.active, deleted: false, clicks: Number(r.clicks) })),
      ...deleted.map((r) => ({ id: null, label: r.label, active: false, deleted: true, clicks: Number(r.clicks) })),
    ].sort((a, b) => b.clicks - a.clicks),
    daily: daily.map((r) => ({ day: r.day, clicks: Number(r.clicks) })),
    devices: devices.map((r) => ({ device: r.device, clicks: Number(r.clicks) })),
    hours: hours.map((r) => ({ hour: Number(r.hour), clicks: Number(r.clicks) })),
    socials: {
      total: Number(t.social_total),
      ranking: [
        ...socials.map((r) => ({
          stat: { id: r.id, network: r.network, label: networkLabel(r.network), clicks: Number(r.clicks), active: r.active, deleted: false },
          position: Number(r.position),
        })),
        ...deletedSocials.map((r) => ({
          stat: { id: null, network: networkFromLabel(r.label), label: r.label, clicks: Number(r.clicks), active: false, deleted: true },
          position: Number.MAX_SAFE_INTEGER, // sin posición: tras las redes actuales con los mismos clics
        })),
      ]
        .sort((a, b) => b.stat.clicks - a.stat.clicks || a.position - b.position)
        .map((x) => x.stat),
    },
  };
}

export async function clicksForCsv(days: number) {
  const db = await getDb();
  return db.query<{ day: string; label: string; device: string; clicks: number; source: 'button' | 'social' }>(
    `select to_char((clicked_at at time zone $2)::date, 'YYYY-MM-DD') as day, button_label as label, device, count(*)::int as clicks, source
     from clicks where client_id = $1 and landing_id = $4 and clicked_at >= ${PERIOD_START}
     group by 1, 2, 3, 5 order by 1 desc, 4 desc`,
    [cid(), env.statsTz, days, await lid()],
  );
}

/** Borra los clics de la landing actual. */
export async function resetClicks(): Promise<number> {
  const db = await getDb();
  const rows = await db.query('delete from clicks where client_id = $1 and landing_id = $2 returning id', [cid(), await lid()]);
  return rows.length;
}

/** Borra los clics de todas las landings del cliente (npm run setup -- --borrar-clics). */
export async function resetAllClicks(): Promise<number> {
  const db = await getDb();
  const rows = await db.query('delete from clicks where client_id = $1 returning id', [cid()]);
  return rows.length;
}

// ---------- Administradores ----------

export interface Admin {
  id: string;
  username: string;
  password_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
}

export async function findAdmin(username: string): Promise<Admin | null> {
  const db = await getDb();
  const rows = await db.query<Admin>(
    'select id, username, password_hash, failed_attempts, locked_until from admins where client_id = $1 and lower(username) = lower($2)',
    [cid(), username],
  );
  return rows[0] ?? null;
}

export async function getAdminById(id: string): Promise<Admin | null> {
  const db = await getDb();
  const rows = await db.query<Admin>(
    'select id, username, password_hash, failed_attempts, locked_until from admins where client_id = $1 and id = $2',
    [cid(), id],
  );
  return rows[0] ?? null;
}

export async function upsertAdmin(username: string, passwordHash: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into admins (client_id, username, password_hash) values ($1, $2, $3)
     on conflict (client_id, username) do update set password_hash = excluded.password_hash, failed_attempts = 0, locked_until = null`,
    [cid(), username, passwordHash],
  );
}

export async function setAdminPassword(id: string, passwordHash: string): Promise<void> {
  const db = await getDb();
  await db.query('update admins set password_hash = $3 where client_id = $1 and id = $2', [cid(), id, passwordHash]);
}

export async function registerFailedLogin(id: string, maxAttempts: number, lockMinutes: number): Promise<void> {
  const db = await getDb();
  await db.query(
    `update admins set
       failed_attempts = failed_attempts + 1,
       locked_until = case when failed_attempts + 1 >= $3 then now() + make_interval(mins => $4::int) else locked_until end
     where client_id = $1 and id = $2`,
    [cid(), id, maxAttempts, lockMinutes],
  );
}

export async function clearFailedLogins(id: string): Promise<void> {
  const db = await getDb();
  await db.query('update admins set failed_attempts = 0, locked_until = null where client_id = $1 and id = $2', [cid(), id]);
}
