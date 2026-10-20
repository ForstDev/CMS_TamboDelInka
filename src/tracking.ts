// Clasificación del visitante para el tracking. No se guarda nada de esto salvo el tipo de dispositivo.

import { isbot } from 'isbot';

export type Device = 'mobile' | 'tablet' | 'desktop';

export function deviceType(userAgent: string, chMobile?: string): Device {
  const ua = userAgent || '';
  if (/ipad|tablet|playbook|silk|kindle|nexus (7|9|10)/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'tablet';
  if (chMobile === '?1') return 'mobile';
  if (/mobi|iphone|ipod|android|blackberry|opera mini|iemobile|windows phone/i.test(ua)) return 'mobile';
  return 'desktop';
}

interface RequestLike {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

/** true si el clic debe contarse: no es bot, no es precarga del navegador, no es HEAD. */
export function shouldCount(req: RequestLike): boolean {
  if (req.method !== 'GET') return false;
  const ua = String(req.headers['user-agent'] ?? '');
  if (!ua || isbot(ua)) return false;
  const purpose = String(req.headers['sec-purpose'] ?? req.headers['purpose'] ?? req.headers['x-purpose'] ?? '').toLowerCase();
  if (purpose.includes('prefetch') || purpose.includes('preview')) return false;
  return true;
}
