// Acceso a Postgres con una sola interfaz:
// - Producción: Supabase Postgres vía postgres.js (DATABASE_URL, transaction pooler).
// - Local: PGlite (Postgres embebido) en .data/pgdata. Mismo SQL en ambos casos.

import path from 'node:path';
import { env, localDataDir } from './env.js';

export type Row = Record<string, any>;

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  exec(sqlText: string): Promise<void>;
  close(): Promise<void>;
}

let current: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  current ??= open();
  return current;
}

/** Para pruebas: usa una base dada en lugar de la configurada. */
export function setDb(db: Db | null) {
  current = db ? Promise.resolve(db) : null;
}

async function open(): Promise<Db> {
  if (env.databaseUrl) return openPostgres(env.databaseUrl);
  if (env.onVercel) throw new Error('Falta DATABASE_URL: en Vercel el CMS necesita Supabase.');
  return openPglite(path.join(localDataDir, 'pgdata'));
}

export async function openPostgres(url: string): Promise<Db> {
  const { default: postgres } = await import('postgres');
  // prepare: false es obligatorio con el transaction pooler de Supabase.
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 15 });
  return {
    async query(text, params = []) {
      return [...(await sql.unsafe(text, params as any[]))] as any[];
    },
    async exec(sqlText) {
      await sql.unsafe(sqlText);
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** dataDir vacío = base en memoria (pruebas). */
export async function openPglite(dataDir?: string): Promise<Db> {
  // Nombre leído en tiempo de ejecución: así Vercel no empaqueta PGlite (solo se usa en local).
  const modName = process.env.PGLITE_MODULE || '@electric-sql/pglite';
  const { PGlite } = await import(modName);
  if (dataDir) (await import('node:fs')).mkdirSync(path.dirname(dataDir), { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  return {
    async query(text, params = []) {
      return (await pg.query(text, params)).rows as any[];
    },
    async exec(sqlText) {
      await pg.exec(sqlText);
    },
    async close() {
      await pg.close();
    },
  };
}
