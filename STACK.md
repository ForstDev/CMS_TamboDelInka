# Stack técnico — CMS propio (primer cliente: Intursa / Tambo del Inka Outlets)

GitHub (FORST) → Vercel (FORST, despliegue automático) → Supabase (Postgres + Storage).
Un solo servidor Express sirve la página pública, el tracking, el login, el panel y su API.

| Capa | Elección |
|---|---|
| Runtime | Node 20+ (desarrollado en Node 24), TypeScript, ESM |
| Servidor | Express 5 (`api/index.ts` en Vercel, `src/server.ts` en local) |
| Base de datos | Supabase Postgres vía `postgres.js` (Transaction pooler, `prepare: false`) |
| Base local | PGlite (Postgres embebido en `.data/`): mismo SQL que producción, sin instalar nada |
| Archivos | Supabase Storage, bucket público `media`; subida directa del navegador con URL firmada (evita el límite de 4.5 MB de Vercel). En local: `.data/uploads` |
| Página pública | `templates/pagina.html` (diseño original) + motor de plantilla mínimo propio |
| Panel | HTML + JS sin framework; SortableJS (arrastrar) y Chart.js (gráficos) por CDN |
| Login | Tabla `admins` + bcryptjs; sesión en cookie httpOnly firmada con `jose` (12 h); bloqueo 15 min tras 5 intentos |
| Validación | `zod` (URLs solo http/https, colores hex, redes de lista cerrada, tipos y tamaños de archivo) |
| Tracking | `/go/:id` → 302; registro después de responder (`waitUntil` de Vercel); `isbot`; sin IP ni cookies |
| Pruebas | Vitest + Supertest: 49 pruebas (API completa, seguridad, conector postgres.js contra un Postgres por red) |

Multi-cliente: un proyecto de Vercel y uno de Supabase por cliente, mismo repositorio.
Variables: `CLIENT_ID`, `SESSION_SECRET`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NOINDEX`, `STATS_TZ`.

Guía paso a paso: `README.md`.
