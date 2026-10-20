// Consultas a la base. Todas filtran por client_id.

import { getDb } from './db.js';
import { env } from './env.js';
import { DEFAULT_SETTINGS, type Settings } from './validation.js';
import type { Network } from './networks.js';

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

const BUTTON_COLS = 'id, label, kind, url, file_name, file_path, new_tab, position, active';
const SOCIAL_COLS = 'id, network, url, position, active';

// ---------- Ajustes ----------

export async function getSettings(): Promise<Settings> {
  const db = await getDb();
  const rows = await db.query<{ key: string; value: string }>('select key, value from settings where client_id = $1', [cid()]);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) out[r.key] = r.value;
  return out as Settings;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const db = await getDb();
  await db.query(
    `insert into settings (client_id, key, value)
     select $1, x->>'key', x->>'value' from jsonb_array_elements($2::text::jsonb) x
     on conflict (client_id, key) do update set value = excluded.value`,
    [cid(), JSON.stringify(entries.map(([key, value]) => ({ key, value: String(value) })))],
  );
}

export async function hasSettings(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('select 1 from settings where client_id = $1 limit 1', [cid()]);
  return rows.length > 0;
}

// ---------- Botones ----------

export async function listButtons(onlyPublic = false): Promise<Button[]> {
  const db = await getDb();
  const where = onlyPublic ? "and active and url <> ''" : '';
  return db.query<Button>(`select ${BUTTON_COLS} from buttons where client_id = $1 ${where} order by position, created_at`, [cid()]);
}

export async function getButton(id: string): Promise<Button | null> {
  const db = await getDb();
  const rows = await db.query<Button>(`select ${BUTTON_COLS} from buttons where client_id = $1 and id = $2`, [cid(), id]);
  return rows[0] ?? null;
}

export async function createButton(input: Partial<Button> & { label: string }): Promise<Button> {
  const db = await getDb();
  const rows = await db.query<Button>(
    `insert into buttons (client_id, label, kind, url, file_name, file_path, new_tab, active, position)
     values ($1, $2, $3, $4, $5, $6, $7, $8,
             coalesce((select max(position) + 1 from buttons where client_id = $1), 0))
     returning ${BUTTON_COLS}`,
    [cid(), input.label, input.kind ?? 'pdf', input.url ?? '', input.file_name ?? '', input.file_path ?? '', input.new_tab ?? false, input.active ?? false],
  );
  return rows[0]!;
}

export async function updateButton(id: string, patch: Partial<Button>): Promise<Button | null> {
  const allowed = ['label', 'kind', 'url', 'file_name', 'file_path', 'new_tab', 'active'] as const;
  const sets: string[] = [];
  const params: unknown[] = [cid(), id];
  for (const k of allowed) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) return getButton(id);
  const db = await getDb();
  const rows = await db.query<Button>(
    `update buttons set ${sets.join(', ')}, updated_at = now() where client_id = $1 and id = $2 returning ${BUTTON_COLS}`,
    params,
  );
  return rows[0] ?? null;
}

export async function deleteButton(id: string): Promise<Button | null> {
  const db = await getDb();
  const rows = await db.query<Button>(`delete from buttons where client_id = $1 and id = $2 returning ${BUTTON_COLS}`, [cid(), id]);
  return rows[0] ?? null;
}

async function reorder(table: 'buttons' | 'socials', ids: string[]) {
  const db = await getDb();
  await db.query(
    `update ${table} t set position = (x.ord - 1)::int
     from jsonb_array_elements_text($2::text::jsonb) with ordinality as x(id, ord)
     where t.client_id = $1 and t.id = x.id::uuid`,
    [cid(), JSON.stringify(ids)],
  );
}

export const reorderButtons = (ids: string[]) => reorder('buttons', ids);
export const reorderSocials = (ids: string[]) => reorder('socials', ids);

// ---------- Redes ----------

export async function listSocials(onlyPublic = false): Promise<Social[]> {
  const db = await getDb();
  const where = onlyPublic ? "and active and url <> ''" : '';
  return db.query<Social>(`select ${SOCIAL_COLS} from socials where client_id = $1 ${where} order by position`, [cid()]);
}

export async function createSocial(network: Network, url: string): Promise<Social> {
  const db = await getDb();
  const rows = await db.query<Social>(
    `insert into socials (client_id, network, url, position)
     values ($1, $2, $3, coalesce((select max(position) + 1 from socials where client_id = $1), 0))
     returning ${SOCIAL_COLS}`,
    [cid(), network, url],
  );
  return rows[0]!;
}

export async function updateSocial(id: string, patch: Partial<Social>): Promise<Social | null> {
  const sets: string[] = [];
  const params: unknown[] = [cid(), id];
  for (const k of ['network', 'url', 'active'] as const) {
    if (patch[k] === undefined) continue;
    params.push(patch[k]);
    sets.push(`${k} = $${params.length}`);
  }
  const db = await getDb();
  if (!sets.length) {
    const rows = await db.query<Social>(`select ${SOCIAL_COLS} from socials where client_id = $1 and id = $2`, params);
    return rows[0] ?? null;
  }
  const rows = await db.query<Social>(`update socials set ${sets.join(', ')} where client_id = $1 and id = $2 returning ${SOCIAL_COLS}`, params);
  return rows[0] ?? null;
}

export async function deleteSocial(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query('delete from socials where client_id = $1 and id = $2 returning id', [cid(), id]);
  return rows.length > 0;
}

// ---------- Clics y estadísticas ----------

export async function recordClick(button: Pick<Button, 'id' | 'label'>, device: 'mobile' | 'tablet' | 'desktop'): Promise<void> {
  const db = await getDb();
  await db.query('insert into clicks (client_id, button_id, button_label, device) values ($1, $2, $3, $4)', [cid(), button.id, button.label, device]);
}

/** Inicio del periodo: medianoche (hora local del cliente) de hace days-1 días. */
const PERIOD_START = `(((now() at time zone $2)::date - ($3::int - 1))::timestamp at time zone $2)`;

export interface Stats {
  days: number;
  total: number;
  today: number;
  allTime: number;
  ranking: { id: string | null; label: string; active: boolean; deleted: boolean; clicks: number }[];
  daily: { day: string; clicks: number }[];
  devices: { device: string; clicks: number }[];
  hours: { hour: number; clicks: number }[];
}

export async function getStats(days: number): Promise<Stats> {
  const db = await getDb();
  const p = [cid(), env.statsTz, days];

  const [ranking, deleted, daily, devices, hours, totals] = await Promise.all([
    db.query(
      `select b.id, b.label, b.active, count(c.id)::int as clicks
       from buttons b
       left join clicks c on c.button_id = b.id and c.clicked_at >= ${PERIOD_START}
       where b.client_id = $1
       group by b.id, b.label, b.active, b.position
       order by clicks desc, b.position`,
      p,
    ),
    db.query(
      `select button_label as label, count(*)::int as clicks
       from clicks
       where client_id = $1 and button_id is null and clicked_at >= ${PERIOD_START}
       group by button_label order by clicks desc`,
      p,
    ),
    db.query(
      `select to_char(d, 'YYYY-MM-DD') as day, count(c.id)::int as clicks
       from generate_series((now() at time zone $2)::date - ($3::int - 1), (now() at time zone $2)::date, interval '1 day') d
       left join clicks c on c.client_id = $1 and (c.clicked_at at time zone $2)::date = d::date
       group by d order by d`,
      p,
    ),
    db.query(
      `select device, count(*)::int as clicks from clicks
       where client_id = $1 and clicked_at >= ${PERIOD_START}
       group by device order by clicks desc`,
      p,
    ),
    db.query(
      `select h as hour, count(c.id)::int as clicks
       from generate_series(0, 23) h
       left join clicks c on c.client_id = $1 and c.clicked_at >= ${PERIOD_START}
                          and extract(hour from c.clicked_at at time zone $2)::int = h
       group by h order by h`,
      p,
    ),
    db.query(
      `select
         count(*) filter (where clicked_at >= ${PERIOD_START})::int as total,
         count(*) filter (where (clicked_at at time zone $2)::date = (now() at time zone $2)::date)::int as today,
         count(*)::int as all_time
       from clicks where client_id = $1`,
      p,
    ),
  ]);

  const t = totals[0] ?? { total: 0, today: 0, all_time: 0 };
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
  };
}

export async function clicksForCsv(days: number) {
  const db = await getDb();
  return db.query<{ day: string; label: string; device: string; clicks: number }>(
    `select to_char((clicked_at at time zone $2)::date, 'YYYY-MM-DD') as day, button_label as label, device, count(*)::int as clicks
     from clicks where client_id = $1 and clicked_at >= ${PERIOD_START}
     group by 1, 2, 3 order by 1 desc, 4 desc`,
    [cid(), env.statsTz, days],
  );
}

export async function resetClicks(): Promise<number> {
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
