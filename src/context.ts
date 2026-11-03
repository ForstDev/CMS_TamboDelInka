// Landing de la petición actual (AsyncLocalStorage). repo.ts la usa para filtrar botones, redes,
// ajustes y clics. Sin contexto (scripts, pruebas, /cms_login) se usa la landing por defecto.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Template } from './validation.js';

export interface Landing {
  id: string;
  slug: string;
  name: string;
  hotel: string;
  template: Template;
  is_default: boolean;
  position: number;
  active: boolean;
}

const storage = new AsyncLocalStorage<Landing>();

/** Ejecuta fn (y todo lo asíncrono que lance) en el contexto de esa landing. */
export function runWithLanding<T>(landing: Landing, fn: () => T): T {
  return storage.run(landing, fn);
}

export function currentLanding(): Landing | null {
  return storage.getStore() ?? null;
}

/** Dirección pública de la landing: la por defecto vive en "/". */
export const landingUrl = (l: Pick<Landing, 'slug' | 'is_default'>) => (l.is_default ? '/' : `/${l.slug}`);
