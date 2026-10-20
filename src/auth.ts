// Login del CMS: usuario y contraseña (bcrypt) + sesión en cookie httpOnly firmada (JWT HS256).

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import type { NextFunction, Request, Response } from 'express';
import { env } from './env.js';
import * as repo from './repo.js';

export const COOKIE = 'cms_session';
const SESSION_HOURS = 12;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
// Hash de relleno: si el usuario no existe se compara igual, para no revelar qué usuarios existen.
const DUMMY_HASH = bcrypt.hashSync('no-existe-este-usuario', 10);

const key = () => new TextEncoder().encode(env.sessionSecret);

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);

export type LoginResult =
  | { ok: true; adminId: string; username: string }
  | { ok: false; reason: 'invalid' | 'locked'; minutes?: number };

export async function login(username: string, password: string): Promise<LoginResult> {
  const admin = await repo.findAdmin(username);
  if (!admin) {
    await bcrypt.compare(password, DUMMY_HASH);
    return { ok: false, reason: 'invalid' };
  }
  const lockedUntil = admin.locked_until ? new Date(admin.locked_until) : null;
  if (lockedUntil && lockedUntil > new Date()) {
    return { ok: false, reason: 'locked', minutes: Math.ceil((lockedUntil.getTime() - Date.now()) / 60000) };
  }
  if (lockedUntil) await repo.clearFailedLogins(admin.id); // el bloqueo anterior ya venció

  if (!(await bcrypt.compare(password, admin.password_hash))) {
    await repo.registerFailedLogin(admin.id, MAX_ATTEMPTS, LOCK_MINUTES);
    return { ok: false, reason: 'invalid' };
  }
  if (admin.failed_attempts > 0) await repo.clearFailedLogins(admin.id);
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
