// Límite de intentos fallidos de login POR EQUIPO (IP), no por cuenta.
// La cuenta del CMS la comparten varias personas: bloquear la cuenta castigaba a todos por los
// errores de uno. Ahora solo se frena al equipo que falla.
// No se guarda la IP en claro (Ley 29733): se guarda un HMAC-SHA256 con el secreto de sesión.
// El bloqueo dura solo 1 minuto: basta para frenar a quien prueba contraseñas en automático
// (5 intentos por minuto) sin dejar fuera mucho rato a quien se equivocó al escribir.

import { createHmac } from 'node:crypto';
import { getDb } from './db.js';
import { env } from './env.js';

export const MAX_FAILS = 5;
export const LOCK_SECONDS = 60;
export const WINDOW_MINUTES = 15;

/** Huella no reversible de la IP (sin la clave no se puede recuperar ni comparar). */
export function ipHash(ip: string | undefined | null): string {
  return createHmac('sha256', env.sessionSecret)
    .update(ip || 'desconocida')
    .digest('hex')
    .slice(0, 32);
}

/** Segundos de bloqueo que le quedan a ese equipo, o null si no está bloqueado. */
export async function lockedSeconds(hash: string): Promise<number | null> {
  const db = await getDb();
  const rows = await db.query<{ seconds: number }>(
    `select greatest(1, ceil(extract(epoch from (locked_until - now()))))::int as seconds
       from login_attempts
      where client_id = $1 and ip_hash = $2 and locked_until > now()`,
    [env.clientId, hash],
  );
  return rows[0] ? Number(rows[0].seconds) : null;
}

/**
 * Suma un intento fallido de ese equipo en una sola sentencia atómica. Si los fallos previos son
 * más viejos que la ventana, el contador empieza de nuevo. Al llegar a MAX_FAILS bloquea
 * LOCK_SECONDS y deja el contador en cero. Si otra petición ya lo bloqueó, no toca la fila.
 */
export async function registerFailure(hash: string): Promise<void> {
  const db = await getDb();
  // Limpieza oportunista de filas viejas (de cualquier equipo) para que la tabla no crezca.
  await db.query(
    `delete from login_attempts
      where client_id = $1 and coalesce(locked_until, first_failed_at) < now() - interval '1 hour'`,
    [env.clientId],
  );
  const reset = `(login_attempts.first_failed_at is null
                  or login_attempts.first_failed_at < now() - $4::int * interval '1 minute')`;
  const next = `(case when ${reset} then 1 else login_attempts.failed + 1 end)`;
  await db.query(
    `insert into login_attempts (client_id, ip_hash, failed, first_failed_at)
     values ($1, $2, 1, now())
     on conflict (client_id, ip_hash) do update set
       failed          = case when ${next} >= $3 then 0 else ${next} end,
       first_failed_at = case when ${next} >= $3 then null when ${reset} then now() else login_attempts.first_failed_at end,
       locked_until    = case when ${next} >= $3 then now() + $5::int * interval '1 second' else null end
     where login_attempts.locked_until is null or login_attempts.locked_until <= now()`,
    [env.clientId, hash, MAX_FAILS, WINDOW_MINUTES, LOCK_SECONDS],
  );
}

/** Login correcto: se olvidan los fallos de ese equipo (salvo que otra petición acabe de bloquearlo). */
export async function clearFailures(hash: string): Promise<void> {
  const db = await getDb();
  await db.query(
    `delete from login_attempts
      where client_id = $1 and ip_hash = $2 and (locked_until is null or locked_until <= now())`,
    [env.clientId, hash],
  );
}
