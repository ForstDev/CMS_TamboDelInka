// Bloqueo de login por equipo (IP): 5 fallos -> 1 minuto, sin bloquear la cuenta.

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { getDb, openPglite, setDb } from '../src/db.js';
import { setStorage, type Storage } from '../src/storage.js';
import { applySchema, seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { ipHash, LOCK_SECONDS, MAX_FAILS } from '../src/loginThrottle.js';

const USER = 'TambodelInka';
const PASS = 'TambodelInka2026';
const IP_A = '203.0.113.10';
const IP_B = '198.51.100.20';

const memoryStorage: Storage = {
  mode: 'local',
  async createUploadTarget(p) {
    return { uploadUrl: `/api/cms/uploads/local?path=${encodeURIComponent(p)}`, path: p, publicUrl: `/uploads/${p}` };
  },
  async put(p) {
    return `/uploads/${p}`;
  },
  async remove() {},
  publicUrl: (p) => `/uploads/${p}`,
};

let app: Express;

const loginFrom = (ip: string, username: string, password: string) =>
  request(app).post('/api/login').set('X-Forwarded-For', ip).send({ username, password });

async function rows() {
  return (await getDb()).query('select * from login_attempts');
}

beforeAll(async () => {
  setDb(await openPglite());
  setStorage(memoryStorage);
  await applySchema();
  await applySchema(); // el esquema se puede aplicar dos veces
  await seed({ log: () => {} });
  app = createApp();
}, 60_000);

beforeEach(async () => {
  await (await getDb()).query('delete from login_attempts');
});

describe('bloqueo de login por equipo', () => {
  it('el esquema es idempotente y crea login_attempts', async () => {
    await applySchema();
    expect(await rows()).toEqual([]);
  });

  it('tras 5 fallos la 6.ª petición (aun con la clave correcta) da 429; otra IP sí entra', async () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      expect((await loginFrom(IP_A, USER, 'mala')).status).toBe(401);
    }
    const res = await loginFrom(IP_A, USER, PASS);
    expect(res.status).toBe(429);
    const m = /^Demasiados intentos desde este equipo\. Espera (\d+) s y vuelve a intentarlo\.$/.exec(res.body.error);
    expect(m).not.toBeNull();
    const secs = Number(m![1]);
    expect(secs).toBeGreaterThanOrEqual(1);
    expect(secs).toBeLessThanOrEqual(LOCK_SECONDS);

    // Bloqueado: no se suman intentos.
    const [row] = (await rows()).filter((r) => r.ip_hash === ipHash(IP_A));
    expect(row.failed).toBe(0);
    expect(row.first_failed_at).toBeNull();

    // La cuenta no está bloqueada: otro equipo entra.
    expect((await loginFrom(IP_B, USER, PASS)).status).toBe(200);
  });

  it('al vencer el bloqueo se puede entrar y el acierto borra la fila', async () => {
    for (let i = 0; i < MAX_FAILS; i++) await loginFrom(IP_A, USER, 'mala');
    expect((await loginFrom(IP_A, USER, PASS)).status).toBe(429);
    await (await getDb()).query("update login_attempts set locked_until = now() - interval '1 second'");
    expect((await loginFrom(IP_A, USER, PASS)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it('un acierto borra los fallos previos de ese equipo', async () => {
    await loginFrom(IP_A, USER, 'mala');
    await loginFrom(IP_A, USER, 'mala');
    expect((await rows()).length).toBe(1);
    expect((await loginFrom(IP_A, USER, PASS)).status).toBe(200);
    expect(await rows()).toEqual([]);
  });

  it('los fallos más viejos que la ventana no cuentan', async () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) await loginFrom(IP_A, USER, 'mala');
    await (await getDb()).query("update login_attempts set first_failed_at = now() - interval '16 minutes'");
    expect((await loginFrom(IP_A, USER, 'mala')).status).toBe(401); // el contador vuelve a 1
    const [row] = await rows();
    expect(row.failed).toBe(1);
    expect(row.locked_until).toBeNull();
    expect((await loginFrom(IP_A, USER, PASS)).status).toBe(200);
  });

  it('no guarda la IP en claro', async () => {
    await loginFrom(IP_A, USER, 'mala');
    await loginFrom(IP_B, 'nadie', 'x');
    const all = await rows();
    expect(all.length).toBe(2);
    const dump = JSON.stringify(all);
    expect(dump).not.toContain(IP_A);
    expect(dump).not.toContain(IP_B);
    expect(all.map((r) => r.ip_hash).sort()).toEqual([ipHash(IP_A), ipHash(IP_B)].sort());
    expect(all.every((r) => /^[0-9a-f]{32}$/.test(r.ip_hash))).toBe(true);
  });

  it('el 401 es el mismo para usuario inexistente y contraseña mala, y ambos cuentan', async () => {
    const a = await loginFrom(IP_A, 'nadie', 'x');
    const b = await loginFrom(IP_A, USER, 'mala');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe('Usuario o contraseña incorrectos.');
    expect(b.body.error).toBe(a.body.error);
    const [row] = await rows();
    expect(row.failed).toBe(2);
  });

  it('limpia filas viejas de otros equipos en cada fallo', async () => {
    await loginFrom(IP_B, USER, 'mala');
    await (await getDb()).query("update login_attempts set first_failed_at = now() - interval '2 hours'");
    await loginFrom(IP_A, USER, 'mala');
    const all = await rows();
    expect(all.map((r) => r.ip_hash)).toEqual([ipHash(IP_A)]);
  });
});
