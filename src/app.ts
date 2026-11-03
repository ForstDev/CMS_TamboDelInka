// Aplicación Express: página pública, tracking (/go/:id y /go/social/:id), login (/cms_login), CMS (/cms) y su API.

import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import * as repo from './repo.js';
import { escapeHtml, loadTemplate, renderPage, renderTemplate } from './render.js';
import { deviceType, shouldCount } from './tracking.js';
import { clearSessionCookie, createSessionCookie, getSession, hashPassword, login, requireApiSession, sameOrigin } from './auth.js';
import { getStorage, isValidObjectPath, localUploadsDir, objectPathFor, UPLOAD_RULES } from './storage.js';
import { NETWORKS } from './networks.js';
import { landingUrl, runWithLanding, type Landing } from './context.js';
import bcrypt from 'bcryptjs';
import {
  defaultSettingsFor,
  isValidSlug,
  buttonCreate,
  buttonPatch,
  firstError,
  loginBody,
  orderBody,
  passwordBody,
  settingsPatch,
  socialCreate,
  socialPatch,
  socialUrl,
  uploadRequest,
} from './validation.js';
import type { z } from 'zod';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Versión de los archivos del CMS (evita que el navegador use una copia vieja tras un despliegue).
const ASSET_V = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, firstError(r.error));
  return r.data;
}

/**
 * Ejecuta trabajo después de responder (Vercel) o lo espera (local / pruebas).
 * Es lo mismo que waitUntil de @vercel/functions: el runtime de Vercel expone el contexto en este símbolo.
 */
async function afterResponse(work: Promise<unknown>) {
  const holder = (globalThis as any)[Symbol.for('@vercel/request-context')];
  const ctx: { waitUntil?: (p: Promise<unknown>) => void } | undefined = holder?.get?.();
  if (ctx?.waitUntil) ctx.waitUntil(work.catch((e) => console.error('[tracking]', e)));
  else await work.catch((e) => console.error('[tracking]', e));
}

declare global {
  namespace Express {
    interface Request {
      landing?: Landing;
    }
  }
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

/**
 * Ejecuta el handler en el contexto de req.landing. Se envuelve cada handler (y no se usa un
 * middleware) porque los lectores de cuerpo (express.json) pueden perder el AsyncLocalStorage.
 */
const inLanding =
  (h: Handler): Handler =>
  (req, res, next) =>
    runWithLanding(req.landing!, () => h(req, res, next));

/** Datos públicos de una landing para el panel. */
const landingInfo = (l: Landing) => ({
  id: l.id,
  slug: l.slug,
  name: l.name,
  hotel: l.hotel,
  template: l.template,
  is_default: l.is_default,
  active: l.active,
  url: landingUrl(l),
});

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const isPrivate = req.path.startsWith('/cms') || req.path.startsWith('/api');
    if (env.noindex || isPrivate) res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (isPrivate) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // Archivos estáticos del CMS (en Vercel los sirve la CDN desde /public; esto es para local).
  app.use('/assets', express.static(path.join(root, 'public', 'assets'), { maxAge: env.production ? '1h' : 0 }));
  if (getStorage().mode === 'local') app.use('/uploads', express.static(path.resolve(localUploadsDir), { maxAge: 0 }));

  // ---------- Página pública ----------

  async function sendLanding(res: Response, landing: Landing | null) {
    const load = () => Promise.all([repo.getSettings(), repo.listButtons(true), repo.listSocials(true)]);
    // Sin landing (base aún vacía) se muestra la página con los valores por defecto, como antes.
    const [settings, buttons, socials] = landing ? await runWithLanding(landing, load) : await load();
    res.setHeader('Cache-Control', 'no-store'); // los cambios del CMS se ven al instante
    res.type('html').send(renderPage({ settings, buttons, socials, landing: landing ?? undefined }, { noindex: env.noindex }));
  }

  app.get('/', async (_req, res) => {
    await sendLanding(res, await repo.getDefaultLanding());
  });

  // ---------- Tracking ----------
  // El botón (o el ícono de la red) apunta aquí; se registra el clic y se redirige al destino real.
  // Sirve para los botones de todas las landings; el clic se guarda en la landing del botón.

  app.get('/go/social/:id', async (req, res) => {
    const id = req.params.id;
    const social = UUID.test(id) ? await repo.findSocialForTracking(id) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!social || !social.active || !social.url || !socialUrl.safeParse(social.url).success) return res.redirect(302, '/');

    // El correo no se cuenta (la página lo enlaza directo, ver render.ts).
    if (!/^mailto:/i.test(social.url) && shouldCount(req)) {
      const device = deviceType(String(req.headers['user-agent'] ?? ''), String(req.headers['sec-ch-ua-mobile'] ?? ''));
      await afterResponse(repo.recordSocialClick(social, device));
    }
    res.redirect(302, social.url);
  });

  app.get('/go/:id', async (req, res) => {
    const id = req.params.id;
    const button = UUID.test(id) ? await repo.findButtonForTracking(id) : null;
    res.setHeader('Cache-Control', 'no-store');
    if (!button || !button.active || !button.url) return res.redirect(302, '/');

    if (shouldCount(req)) {
      const device = deviceType(String(req.headers['user-agent'] ?? ''), String(req.headers['sec-ch-ua-mobile'] ?? ''));
      await afterResponse(repo.recordClick(button, device));
    }
    res.redirect(302, button.url);
  });

  // ---------- Login ----------

  app.get('/cms_login', async (req, res) => {
    if (await getSession(req)) return res.redirect(302, '/cms');
    const s = await repo.getSettings();
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderTemplate(loadTemplate('login.html'), { cms_nombre: s.cms_nombre, logo_url: s.logo_url, asset_v: ASSET_V }));
  });

  app.post('/api/login', express.json({ limit: '10kb' }), async (req, res) => {
    if (!sameOrigin(req)) throw new HttpError(403, 'Origen no permitido.');
    const { username, password } = parse(loginBody, req.body);
    // req.ip sale de X-Forwarded-For (trust proxy activo; Vercel la entrega ahí).
    const result = await login(username, password, req.ip || 'desconocida');
    if (!result.ok) {
      if (result.reason === 'locked') {
        throw new HttpError(429, `Demasiados intentos desde este equipo. Espera ${result.seconds} s y vuelve a intentarlo.`);
      }
      throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    }
    await createSessionCookie(res, result.adminId, result.username);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // ---------- CMS ----------

  app.get(['/cms', '/cms/'], async (req, res) => {
    const session = await getSession(req);
    if (!session) return res.redirect(302, '/cms_login');
    const s = await repo.getSettings();
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderTemplate(loadTemplate('cms.html'), { cms_nombre: s.cms_nombre, asset_v: ASSET_V }));
  });

  const api = express.Router();
  api.use(requireApiSession);

  // Lista de landings del cliente (no depende de la landing elegida).
  api.get('/landings', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ landings: (await repo.listLandings()).map(landingInfo) });
  });

  // Landing de trabajo: cabecera X-Landing-Id o ?landing=<uuid> (enlace del CSV, vista previa).
  // Sin ninguna: la por defecto. Inválida o de otro cliente: 404.
  api.use(async (req, res, next) => {
    const header = req.get('x-landing-id');
    const query = req.query.landing;
    const raw = header !== undefined ? header : query;
    let landing: Landing | null;
    if (raw === undefined || raw === '') landing = await repo.getDefaultLanding();
    else landing = typeof raw === 'string' && UUID.test(raw) ? await repo.getLandingById(raw) : null;
    if (!landing) return res.status(404).json({ error: 'Landing no encontrada.' });
    req.landing = landing;
    next();
  });

  api.get('/state', inLanding(async (req, res) => {
    const [settings, buttons, socials] = await Promise.all([repo.getSettings(), repo.listButtons(), repo.listSocials()]);
    const l = req.landing!;
    res.json({
      user: { username: req.session!.username },
      storage: getStorage().mode,
      landing: { id: l.id, slug: l.slug, name: l.name, hotel: l.hotel, template: l.template, is_default: l.is_default, url: landingUrl(l) },
      settings,
      defaults: defaultSettingsFor(l.template),
      buttons,
      socials,
      networks: Object.entries(NETWORKS).map(([key, n]) => ({ key, ...n })),
      uploadRules: Object.fromEntries(Object.entries(UPLOAD_RULES).map(([k, r]) => [k, { types: r.types, maxBytes: r.maxBytes, label: r.label }])),
    });
  }));

  api.patch('/settings', express.json({ limit: '50kb' }), inLanding(async (req, res) => {
    const patch = parse(settingsPatch, req.body);
    await repo.saveSettings(patch);
    res.json({ settings: await repo.getSettings() });
  }));

  // Botones
  api.post('/buttons', express.json({ limit: '10kb' }), inLanding(async (req, res) => {
    const { label } = parse(buttonCreate, req.body ?? {});
    res.status(201).json({ button: await repo.createButton({ label }) });
  }));

  api.patch('/buttons/:id', express.json({ limit: '20kb' }), inLanding(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new HttpError(404, 'Botón no encontrado.');
    const patch = parse(buttonPatch, req.body);
    const before = await repo.getButton(id);
    if (!before) throw new HttpError(404, 'Botón no encontrado.');

    const nextUrl = patch.url ?? before.url;
    if (patch.active === true && !nextUrl) throw new HttpError(400, 'Agrega un PDF o un enlace antes de activar el botón.');
    if (patch.url === '' && patch.active === undefined) patch.active = false; // sin destino no puede estar visible

    const button = await repo.updateButton(id, patch);
    // Si se reemplazó el PDF, se borra el archivo anterior.
    if (before.file_path && patch.file_path !== undefined && patch.file_path !== before.file_path) {
      await getStorage().remove(before.file_path).catch(() => {});
    }
    res.json({ button });
  }));

  api.delete('/buttons/:id', inLanding(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new HttpError(404, 'Botón no encontrado.');
    const removed = await repo.deleteButton(id);
    if (!removed) throw new HttpError(404, 'Botón no encontrado.');
    if (removed.file_path) await getStorage().remove(removed.file_path).catch(() => {});
    res.json({ ok: true });
  }));

  api.put('/buttons/order', express.json({ limit: '20kb' }), inLanding(async (req, res) => {
    const { ids } = parse(orderBody, req.body);
    await repo.reorderButtons(ids);
    res.json({ buttons: await repo.listButtons() });
  }));

  // Redes sociales
  api.post('/socials', express.json({ limit: '10kb' }), inLanding(async (req, res) => {
    const { network, url } = parse(socialCreate, req.body);
    res.status(201).json({ social: await repo.createSocial(network, url) });
  }));

  api.patch('/socials/:id', express.json({ limit: '10kb' }), inLanding(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id)) throw new HttpError(404, 'Red no encontrada.');
    const social = await repo.updateSocial(id, parse(socialPatch, req.body));
    if (!social) throw new HttpError(404, 'Red no encontrada.');
    res.json({ social });
  }));

  api.delete('/socials/:id', inLanding(async (req, res) => {
    const id = String(req.params.id);
    if (!UUID.test(id) || !(await repo.deleteSocial(id))) throw new HttpError(404, 'Red no encontrada.');
    res.json({ ok: true });
  }));

  api.put('/socials/order', express.json({ limit: '20kb' }), inLanding(async (req, res) => {
    const { ids } = parse(orderBody, req.body);
    await repo.reorderSocials(ids);
    res.json({ socials: await repo.listSocials() });
  }));

  // Subidas: el servidor valida y entrega una URL de subida; el navegador sube el archivo directo.
  // Landing por defecto: <cliente>/<tipo>/...; las demás: <cliente>/<slug>/<tipo>/... (ver storage.ts).
  api.post('/uploads', express.json({ limit: '10kb' }), inLanding(async (req, res) => {
    const body = parse(uploadRequest, req.body);
    const rule = UPLOAD_RULES[body.purpose];
    if (!rule.types.includes(body.contentType)) throw new HttpError(400, `Formato no permitido. Usa ${rule.label}.`);
    if (body.size > rule.maxBytes) throw new HttpError(400, `El archivo es muy pesado. Máximo: ${rule.label}.`);
    if (body.purpose === 'pdf' && !/\.pdf$/i.test(body.fileName)) throw new HttpError(400, 'El archivo debe ser .pdf');
    const l = req.landing!;
    const objectPath = objectPathFor(env.clientId, body.purpose, body.fileName, l.is_default ? undefined : l.slug);
    res.json({ ...(await getStorage().createUploadTarget(objectPath)), contentType: body.contentType });
  }));

  api.put('/uploads/local', express.raw({ type: () => true, limit: '26mb' }), async (req, res) => {
    if (getStorage().mode !== 'local') throw new HttpError(404, 'No disponible.');
    const objectPath = String(req.query.path ?? '');
    if (!isValidObjectPath(env.clientId, objectPath)) throw new HttpError(400, 'Ruta de archivo inválida.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'Archivo vacío.');
    await getStorage().put(objectPath, req.body, String(req.headers['content-type'] ?? ''));
    res.json({ ok: true });
  });

  // Estadísticas
  const daysParam = (req: Request) => {
    const d = Number(req.query.days);
    return [7, 30, 90].includes(d) ? d : 30;
  };

  api.get('/stats', inLanding(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json(await repo.getStats(daysParam(req)));
  }));

  api.get('/stats.csv', inLanding(async (req, res) => {
    const days = daysParam(req);
    const rows = await repo.clicksForCsv(days);
    const deviceLabel: Record<string, string> = { mobile: 'Celular', tablet: 'Tablet', desktop: 'Computadora' };
    const q = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [
      'Fecha,Botón,Dispositivo,Clics,Tipo',
      ...rows.map((r) => [r.day, q(r.label), deviceLabel[r.device] ?? r.device, r.clicks, r.source === 'social' ? 'Red' : 'Carta'].join(',')),
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    const l = req.landing!;
    const name = l.is_default ? env.clientId : `${env.clientId}-${l.slug}`;
    res.setHeader('Content-Disposition', `attachment; filename="clics-${name}-${days}dias.csv"`);
    res.send('﻿' + csv);
  }));

  api.delete('/clicks', express.json({ limit: '1kb' }), inLanding(async (req, res) => {
    if (req.body?.confirm !== 'BORRAR') throw new HttpError(400, 'Escribe BORRAR para confirmar.');
    res.json({ deleted: await repo.resetClicks() });
  }));

  // Cuenta
  api.post('/password', express.json({ limit: '5kb' }), async (req, res) => {
    const { current, next } = parse(passwordBody, req.body);
    const admin = await repo.getAdminById(req.session!.adminId);
    if (!admin || !(await bcrypt.compare(current, admin.password_hash))) throw new HttpError(400, 'La contraseña actual no es correcta.');
    await repo.setAdminPassword(admin.id, await hashPassword(next));
    res.json({ ok: true });
  });

  // Vista previa: mismo render que la página pública, sin tracking.
  api.get('/preview', inLanding(async (req, res) => {
    const [settings, buttons, socials] = await Promise.all([repo.getSettings(), repo.listButtons(), repo.listSocials()]);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(renderPage({ settings, buttons, socials, landing: req.landing }, { preview: true }));
  }));

  app.use('/api/cms', api);

  app.get('/api/health', async (_req, res) => {
    await repo.hasSettings();
    res.json({ ok: true, storage: getStorage().mode });
  });

  // ---------- Otras landings: /<slug> ----------
  // Va al final, después de todas las rutas específicas. Slug inválido, reservado, inexistente o
  // landing inactiva → 404 normal.
  app.get('/:slug', async (req, res, next) => {
    const slug = String(req.params.slug);
    if (!isValidSlug(slug)) return next();
    const landing = await repo.getLandingBySlug(slug);
    if (!landing || !landing.active) return next();
    await sendLanding(res, landing);
  });

  // ---------- Errores ----------

  app.use((req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'No encontrado.' });
    res.status(404).type('html').send(simplePage('Página no encontrada', '<a href="/">Volver al inicio</a>'));
  });

  app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500;
    if (status === 500) console.error(err);
    const message = status === 500 ? 'Ocurrió un error en el servidor. Intenta de nuevo.' : status === 413 ? 'El archivo es demasiado grande.' : err.message;
    if (req.path.startsWith('/api')) return res.status(status).json({ error: message });
    res.status(status).type('html').send(simplePage('Algo salió mal', escapeHtml(message)));
  });

  return app;
}

function simplePage(title: string, body: string) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f5f4;color:#1d2b2a;text-align:center;padding:16px}a{color:#26615F}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${body}</p></main></body></html>`;
}
