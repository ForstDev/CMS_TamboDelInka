// Login del CMS: usuario y contraseña (bcrypt) + sesión en cookie httpOnly firmada (JWT HS256).

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';
import * as repo from './repo.js';
import * as throttle from './loginThrottle.js';

export const COOKIE = 'cms_session';
const SESSION_HOURS = 12;
// Hash de relleno: si el usuario no existe se compara igual, para no revelar qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync('no-existe-este-usuario', 10);

const key = () => new TextEncoder().encode(env.sessionSecret);

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

export type LoginResult =
  | { ok: true; adminId: string; username: string }
  | { ok: false; reason: 'invalid' }
  | { ok: false; reason: 'locked'; seconds: number };

/**
 * El bloqueo por intentos fallidos es por equipo (IP), no por cuenta: la cuenta se comparte entre
 * varias personas y un equipo que falla no debe dejar fuera a los demás. Ver loginThrottle.ts.
 */
export async function login(username: string, password: string, ip: string): Promise<LoginResult> {
  const hash = throttle.ipHash(ip);
  // Equipo bloqueado: no se comprueba la contraseña ni se suman intentos.
  const seconds = await throttle.lockedSeconds(hash);
  if (seconds !== null) return { ok: false, reason: 'locked', seconds };

  const admin = await repo.findAdmin(username);
  // Si el usuario no existe se compara igual contra el hash de relleno (mismo tiempo de respuesta).
  const matches = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !matches) {
    await throttle.registerFailure(hash);
    return { ok: false, reason: 'invalid' };
  }
  await throttle.clearFailures(hash);
  return { ok: true, adminId: admin.id, username: admin.username };
}

export async function createSessionCookie(res: Response, adminId: string, username: string) {
  const token = await new SignJWT({ username, cid: env.clientId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(adminId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.production,
    path: '/',
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/' });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export interface Session {
  adminId: string;
  username: string;
}

export async function getSession(req: Request): Promise<Session | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    if (payload.cid !== env.clientId || !payload.sub) return null;
    return { adminId: payload.sub, username: String(payload.username ?? '') };
  } catch {
    return null;
  }
}

declare global {
  namespace Express {
    interface Request {
      session?: Session;
    }
  }
}

/** Protege la API del CMS. Además exige mismo origen en escrituras (defensa CSRF). */
export async function requireApiSession(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Tu sesión expiró. Vuelve a ingresar.' });
  if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) {
    return res.status(403).json({ error: 'Origen no permitido.' });
  }
  req.session = session;
  next();
}

export function sameOrigin(req: Request): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // navegadores siempre lo envían en fetch con método no-GET; herramientas locales no
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}
