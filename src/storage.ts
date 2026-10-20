// Archivos (PDF, logo, fondo).
// - Producción: Supabase Storage, bucket público "media". El navegador sube directo con una URL
//   firmada, así los PDF grandes no pasan por Vercel (límite de 4.5 MB por petición).
// - Local: disco en .data/uploads, servido en /uploads.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env, localDataDir } from './env.js';

export const BUCKET = 'media';

export type UploadPurpose = 'pdf' | 'logo' | 'fondo';

export const UPLOAD_RULES: Record<UploadPurpose, { types: string[]; maxBytes: number; label: string }> = {
  pdf: { types: ['application/pdf'], maxBytes: 25 * 1024 * 1024, label: 'PDF de hasta 25 MB' },
  logo: { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 5 * 1024 * 1024, label: 'PNG, JPG o WEBP de hasta 5 MB' },
  fondo: { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: 8 * 1024 * 1024, label: 'PNG, JPG o WEBP de hasta 8 MB' },
};

export const ALL_UPLOAD_TYPES = [...new Set(Object.values(UPLOAD_RULES).flatMap((r) => r.types))];

export interface UploadTarget {
  uploadUrl: string;
  path: string;
  publicUrl: string;
}

export interface Storage {
  mode: 'supabase' | 'local';
  /** Crea (o ajusta) el bucket público con los tipos y tamaños permitidos. */
  ensureBucket?(): Promise<void>;
  createUploadTarget(objectPath: string): Promise<UploadTarget>;
  put(objectPath: string, data: Buffer, contentType: string): Promise<string>;
  remove(objectPath: string): Promise<void>;
  publicUrl(objectPath: string): string;
}

let current: Storage | null = null;

export function getStorage(): Storage {
  current ??= env.supabaseUrl ? supabaseStorage() : localStorage();
  return current;
}

export function setStorage(s: Storage | null) {
  current = s;
}

function supabaseStorage(): Storage {
  if (!env.supabaseKey) throw new Error('Falta SUPABASE_SECRET_KEY.');
  const client: SupabaseClient = createClient(env.supabaseUrl, env.supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => client.storage.from(BUCKET);
  return {
    mode: 'supabase',
    async ensureBucket() {
      const options = { public: true, fileSizeLimit: UPLOAD_RULES.pdf.maxBytes, allowedMimeTypes: ALL_UPLOAD_TYPES };
      const { data } = await client.storage.getBucket(BUCKET);
      const { error } = data ? await client.storage.updateBucket(BUCKET, options) : await client.storage.createBucket(BUCKET, options);
      if (error) throw new Error(`No se pudo preparar el bucket "${BUCKET}": ${error.message}`);
    },
    async createUploadTarget(objectPath) {
      const { data, error } = await bucket().createSignedUploadUrl(objectPath);
      if (error || !data) throw new Error(`No se pudo preparar la subida: ${error?.message}`);
      return { uploadUrl: data.signedUrl, path: objectPath, publicUrl: this.publicUrl(objectPath) };
    },
    async put(objectPath, data, contentType) {
      const { error } = await bucket().upload(objectPath, data, { contentType, upsert: true });
      if (error) throw new Error(`No se pudo subir ${objectPath}: ${error.message}`);
      return this.publicUrl(objectPath);
    },
    async remove(objectPath) {
      await bucket().remove([objectPath]);
    },
    publicUrl(objectPath) {
      return bucket().getPublicUrl(objectPath).data.publicUrl;
    },
  };
}

export const localUploadsDir = path.join(localDataDir, 'uploads');

function localStorage(): Storage {
  const abs = (p: string) => {
    const full = path.resolve(localUploadsDir, p);
    if (!full.startsWith(path.resolve(localUploadsDir) + path.sep)) throw new Error('Ruta inválida');
    return full;
  };
  return {
    mode: 'local',
    async createUploadTarget(objectPath) {
      return {
        uploadUrl: `/api/cms/uploads/local?path=${encodeURIComponent(objectPath)}`,
        path: objectPath,
        publicUrl: this.publicUrl(objectPath),
      };
    },
    async put(objectPath, data) {
      const file = abs(objectPath);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
      return this.publicUrl(objectPath);
    },
    async remove(objectPath) {
      await fs.rm(abs(objectPath), { force: true });
    },
    publicUrl(objectPath) {
      return `/uploads/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
    },
  };
}

/** Nombre de archivo seguro y legible para la URL pública. */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'archivo';
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return ext ? `${base}.${ext}` : base;
}

export function objectPathFor(clientId: string, purpose: UploadPurpose, fileName: string): string {
  const stamp = Date.now().toString(36);
  return `${clientId}/${purpose}/${stamp}-${safeFileName(fileName)}`;
}
