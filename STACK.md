# Stack técnico — CMS propio (primer cliente: Intursa / Tambo del Inka)

GitHub (FORST) → Vercel (FORST, despliegue automático) → Supabase (Postgres + Storage).
Un solo servidor Express sirve las páginas públicas (varias landings por cliente), el tracking, el login, el panel y su API.

| Capa | Elección |
|---|---|
| Runtime | Node 20+ (desarrollado en Node 24), TypeScript, ESM |
| Servidor | Express 5 (`api/index.ts` en Vercel, `src/server.ts` en local) |
| Base de datos | Supabase Postgres vía `postgres.js` (Transaction pooler, `prepare: false`) |
| Tablas | `landings`, `landing_settings`, `buttons`, `socials`, `clicks` (las tres con `landing_id`), `admins`, `login_attempts`; `settings` antigua se conserva (respaldo y compatibilidad con el código anterior). RLS activo sin políticas |
| Base local | PGlite (Postgres embebido en `.data/`): mismo SQL que producción, sin instalar nada |
| Archivos | Supabase Storage, bucket público `media`; subida directa del navegador con URL firmada (evita el límite de 4.5 MB de Vercel). Rutas `<cliente>/<tipo>/…` (landing por defecto) y `<cliente>/<slug>/<tipo>/…` (las demás). En local: `.data/uploads` |
| Páginas públicas | Motor de plantilla mínimo propio con dos plantillas: `cartas` (`templates/pagina.html`, diseño original) y `experiencias` (`templates/experiencias.html`, mockup del cliente; fuentes provisionales Sofia Sans + Cormorant Garamond de Google Fonts; tamaños en una unidad fluida `--u` que escala con la pantalla y el zoom; la foto va a pantalla completa; en celular con un oscurecido fijo arriba (azul marino) y abajo (gris), y en PC con un oscurecido fijo en forma de reloj de arena: ambos son diseño fijo, no editable). `/` = landing por defecto, `/:slug` = cada landing |
| Landing por petición | `AsyncLocalStorage` (`src/context.ts`); la API del panel la recibe por cabecera `X-Landing-Id` o `?landing=` |
| Panel | HTML + JS sin framework; SortableJS (arrastrar) y Chart.js (gráficos) por CDN; selector de landing tipo lista con miniaturas en resolución PC, vista previa Celular / PC (1366×768 escalado) con vista ampliada, panel de redes con gráfico de líneas por día |
| Login | Tabla `admins` + bcryptjs; sesión en cookie httpOnly firmada con `jose` (12 h); límite **por equipo (IP)**: 5 fallos en 15 min → 1 minuto de espera, sin bloquear la cuenta. Tabla `login_attempts` con HMAC-SHA256 de la IP (no se guarda la IP en claro) |
| Validación | `zod` (URLs solo http/https, colores hex, redes de lista cerrada, tipos y tamaños de archivo, enteros acotados para logo y encuadre, slugs) |
| Tracking | `/go/:id` (cartas) y `/go/social/:id` (íconos de redes, salvo correo) → 302; registro después de responder (`waitUntil` de Vercel); `isbot`; sin IP ni cookies. Tabla `clicks` con `source` (`button`/`social`) y `landing_id`; estadísticas por landing |
| Pruebas | Vitest + Supertest: 109 pruebas en 7 archivos (API, varias landings y su migración, plantilla experiencias, login por equipo, migración de `clicks`, conector postgres.js contra un Postgres por red, unitarias). Las de landings y del conector usan la configuración fija `tests/fixtures/client-default-only.json` |

Multi-cliente: un proyecto de Vercel y uno de Supabase por cliente, mismo repositorio. Varias landings por cliente en `clients/<id>/client.json` (`landings[]`).
Variables: `CLIENT_ID`, `SESSION_SECRET`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NOINDEX`, `STATS_TZ`.
Solo local: `FORCE_LOCAL=1` hace que `npm run dev`/`npm start` ignoren las claves del `.env` y usen la base local `.data/` (sin tocar producción).

Guía paso a paso (incluye el orden de despliegue con `npm run setup -- --solo-esquema`): `README.md`.
