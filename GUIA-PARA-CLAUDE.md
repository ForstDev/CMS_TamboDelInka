# Guía de traspaso para Claude — CMS propio Tambo del Inka Outlets (Intursa)

| | |
|---|---|
| **Fecha** | 2026-10-22 |
| **Versión** | 1.0 |
| **Propósito** | Manual de traspaso ("handover") completo para que **otra instancia de Claude**, sin acceso a la conversación donde se construyó el proyecto, pueda responder cualquier pregunta técnica, de negocio o de despliegue que le haga un compañero del autor antes (o durante la preparación) de la reunión con el jefe de TI de Intursa. |
| **Proyecto** | `C:\Users\User\Documents\CMS-TDI` (repositorio privado `ForstDev/CMS_TamboDelInka`) |
| **Demo pública** | https://cms-tambo-del-inka.vercel.app/ — panel en https://cms-tambo-del-inka.vercel.app/cms_login |

> **Cómo leer este documento.** Cada afirmación importante está marcada con una de estas etiquetas:
> - **[Código]** hecho verificado leyendo el código del repositorio (se indica archivo y función).
> - **[Decisión]** decisión de diseño, con su motivo.
> - **[Pendiente]** limitación o tarea conocida que no está resuelta.
> - **[Reportado]** algo que el autor contó (no se puede comprobar desde el código; por ejemplo, el estado de producción).
> - **[Suposición]** inferencia razonable no verificada. Todo lo de esta categoría se repite en la sección 23.
>
> **Regla de seguridad del documento:** aquí no hay ningún secreto. No se copian valores del archivo `.env`, ni contraseñas, ni claves. El usuario y la contraseña de demo del panel están en `clients/intursa/client.json` (campo `admin`) y también en `README.md`; deben cambiarse antes de producción.

---

## Índice

1. [Resumen ejecutivo y objetivo](#s1)
2. [Contexto del negocio y requisitos originales](#s2)
3. [Cómo funciona un CMS en general (y WordPress comparado con este)](#s3)
4. [Arquitectura](#s4)
5. [Mapa completo de archivos del repositorio](#s5)
6. [Modelo de datos](#s6)
7. [Referencia completa de rutas HTTP](#s7)
8. [Flujos detallados paso a paso](#s8)
9. [El panel (pestaña por pestaña)](#s9)
10. [Seguridad y privacidad en profundidad](#s10)
11. [Variables de entorno](#s11)
12. [Despliegue (Vercel + Supabase + GitHub)](#s12)
13. [Cómo agregar un cliente nuevo (multi-cliente)](#s13)
14. [Pruebas](#s14)
15. [Integración con el WordPress de Intursa (incluye "headless")](#s15)
16. [Límites, deuda técnica y mejoras posibles](#s16)
17. [Pendientes antes de producción](#s17)
18. [Problemas encontrados y resueltos durante el desarrollo](#s18)
19. [Preguntas frecuentes (FAQ)](#s19)
20. [Guion de demostración y checklist previo a la reunión](#s20)
21. [Guía para el Claude que lea esto](#s21)
22. [Glosario](#s22)
23. [No verificado / suposiciones](#s23)

---

<a id="s1"></a>
## 1. Resumen ejecutivo y objetivo

**Qué es.** Un CMS (sistema de gestión de contenidos) **propio, escrito desde cero**, para la página de cartas de **Tambo del Inka Resort & Spa (Valle Sagrado) — Outlets**, del cliente **Intursa**. Tiene tres partes:

1. **Página pública** (`/`): réplica del diseño nuevo aprobado por el cliente, con 9 botones que abren las cartas en PDF, un bloque de "novedades y promociones" y una sección "Síguenos" con redes sociales. El contenido sale de una base de datos en cada visita.
2. **Panel de administración** (`/cms_login` → `/cms`): con usuario y contraseña. Permite editar botones (nombre, orden, visible/oculto, PDF o enlace), agregar/eliminar botones, cambiar logo, fondo (imagen o color), colores, textos y redes sociales. Pensado primero para celular.
3. **Tracking de clics y estadísticas**: cada botón pasa por `/go/<id>`, que registra el clic (qué botón, cuándo, tipo de dispositivo) **sin IP ni datos personales** (Ley 29733 de Perú), ignora bots, y redirige al PDF. El panel muestra ranking, clics por día, por hora, por dispositivo, total, "lo más buscado", exportación CSV.

**Para quién.** Para Intursa (primer cliente). El producto está pensado para **replicarse a otros clientes** como **suscripción mensual** cambiando solo configuración (un despliegue por cliente).

**Quién lo hizo y quién lo presenta.** Lo desarrolló un desarrollador de la agencia **FORST** (cuenta de GitHub/Vercel `ForstDev`). Su gerente y un compañero presentarán la propuesta al **jefe de TI de Intursa**. Es una **propuesta / demostración** que hoy corre en **planes gratuitos**.

**Estado actual** [Reportado salvo donde se indica]:

| Elemento | Estado |
|---|---|
| Demo pública | https://cms-tambo-del-inka.vercel.app/ |
| Panel | https://cms-tambo-del-inka.vercel.app/cms_login |
| Código | GitHub privado `ForstDev/CMS_TamboDelInka`, rama `main`, un solo commit (`be953d1 "CMS tambo del inkga"`) [Código: historial local] |
| Hosting | Vercel (cuenta `ForstDev`), plan gratuito (Hobby) |
| Base de datos y archivos | Supabase (Postgres + Storage) en una **cuenta personal del autor**, proyecto gratuito. Se planea moverlo a una organización de FORST con plan de pago antes de producción. |
| Instalación | El autor ejecutó `npm run setup` y `npm run verificar` contra Supabase: todo correcto. |
| Prueba externa | El sitio publicado se probó desde afuera: 9 de 9 PDF abren, el tracking registra, los bots no cuentan. |
| Redes sociales | Facebook e Instagram cargados **directamente en la base de producción con un script** (no desde el panel). Ver [sección 8.13](#s8-13). |
| Cambio local sin subir | `clients/intursa/client.json` modificado (enlaces de Facebook/Instagram) y **sin commit** [Código: estado de git]; por lo tanto tampoco está en GitHub. Las 2 pruebas que ese cambio rompió ya se corrigieron en `tests/api.test.ts` (también sin commit); hoy pasan las 49 (ver [sección 14](#s14)). |
| Archivos sin commit | `GUIA-REUNION-TI.md`, `RESUMEN-PROYECTO.md` (y este archivo) no están en git todavía. |

---

<a id="s2"></a>
## 2. Contexto del negocio y requisitos originales

### 2.1 Situación de partida

- Intursa tenía la página de cartas de Tambo del Inka Outlets en **WordPress**: https://www.intursa.com.pe/outlets-tambodelinka/ — 9 botones que abren PDF de cartas: **Desayuno, Hawa, Kiri Bar, Room Service, La Cervecería, Vinos, Menú de niños, Kallpa Spa, De nuestro huerto**, y un enlace de "novedades y promociones" a https://www.intursa.com.pe/promociones/suscripcion/.
- El cliente tenía un **diseño nuevo estático** ya terminado: https://intursa.com.pe/repositorios/outlets_tambodelinka.html (HTML y CSS en un solo archivo, **sin JavaScript**), y pidió **hacerlo dinámico**.
- Según `CONTEXTO.md` (nota interna, no está en GitHub), el WordPress usaba un "repeater" de ACF con imagen, color y color hover por botón; el diseño nuevo no usa íconos ni colores por botón, así que esos campos no se trasladaron. [Código: `CONTEXTO.md`]

### 2.2 Pedido original

- **CMS propio construido desde cero**: sin WordPress, sin plugins, sin CMS de terceros (Sanity, Strapi, etc.).
- **Panel con login** para:
  - Editar botones: nombre, orden, activar/desactivar, cambiar PDF o enlace (subir carta nueva).
  - Agregar y quitar botones.
  - Cambiar logo, fondo (imagen o color) y textos.
  - Editar redes sociales.
- **Tracking de clics por botón**: qué botón, cuándo, qué tipo de dispositivo; **sin datos personales ni IP (Ley 29733 de Perú)**; ignorar bots.
- **Pantalla de estadísticas**: ranking de botones, clics por día (30 días), total y botón más popular.

### 2.3 Reglas del pedido

1. **No modificar el diseño visual**; solo hacerlo dinámico.
2. Los **9 botones con sus PDF** cargados desde el inicio (tomados de la página actual).
3. Todo debe verse bien **en celular, también el panel**.
4. Debe poder **replicarse para otros clientes** cambiando solo la configuración, con **datos separados** (se ofrecerá como **suscripción mensual**).
5. Debe poder **publicarse en internet** (hosting acordado: Vercel).
6. **Presupuesto de tiempo original: 1.5 horas.** Por eso el panel es HTML/CSS/JS simple, sin framework ni paso de compilación.

### 2.4 Qué se entregó respecto del pedido

| Pedido | Entregado | Comentario |
|---|---|---|
| Editar botones (nombre, orden, activo, PDF/enlace) | Sí | Orden por arrastre y con botones Subir/Bajar. |
| Agregar/quitar botones | Sí | Eliminar con "Deshacer" (6 s). |
| Logo, fondo, textos | Sí | Además: 6 colores, título y descripción para Google, nombre del panel. |
| Redes sociales | Sí | 12 redes posibles. |
| Tracking sin datos personales, sin bots | Sí | Solo botón, momento y tipo de dispositivo. |
| Estadísticas: ranking, por día (30), total, más popular | Sí, y más | Periodos 7/30/90 días, clics por hora, dispositivos, hoy, % celular, CSV, refresco automático cada 8 s. |
| No cambiar el diseño | Sí | La plantilla es el HTML original; ver [sección 4.4](#s4-4). |
| 9 botones con PDF desde el inicio | Sí | Los PDF se descargaron y se suben a Supabase Storage en la carga inicial. |
| Celular | Sí | Panel "mobile-first" con barra inferior. |
| Multi-cliente | Sí | Un despliegue por cliente; tablas con `client_id`. |
| Publicado | Sí | Vercel + Supabase (planes gratuitos hoy). |

---

<a id="s3"></a>
## 3. Cómo funciona un CMS en general (y WordPress comparado con este)

### 3.1 Explicación pedagógica

Un CMS separa **lo que se dice** (contenido) de **cómo se ve** (diseño):

1. **El molde (plantilla).** El diseño se hace una sola vez, como un molde con "huecos": aquí va el título, aquí la lista de botones, aquí el logo.
2. **El contenido, aparte.** Textos, enlaces, colores e imágenes no están escritos dentro del molde; viven en una **base de datos** (y los archivos, en un **almacenamiento de archivos**).
3. **El panel.** Cuando alguien edita en el panel, **no modifica la página**: modifica un **dato guardado**.
4. **El armado en cada visita (render).** Cuando un visitante abre la página, el servidor toma el molde, lee los datos actuales y los coloca en los huecos. La página no existe "ya hecha": se arma en ese momento.

Consecuencia: un cambio en el panel se ve en la siguiente visita, **sin volver a publicar el sitio**.

Todo CMS tiene entonces cuatro piezas: **panel**, **base de datos**, **almacenamiento de archivos** y **motor que arma la página**.

### 3.2 Cómo lo hace WordPress

- Lenguaje **PHP**, base de datos **MySQL/MariaDB**, archivos en la carpeta `wp-content/uploads` del servidor.
- El **tema** es el molde; los **plugins** agregan funciones (por ejemplo ACF para campos personalizados, que es lo que Intursa usaba para los botones).
- El panel es `wp-admin`, con usuarios, roles, historial de revisiones, biblioteca de medios, etc.

### 3.3 Cómo lo hace este CMS

- Lenguaje **TypeScript sobre Node.js** con **Express** (`src/app.ts`), base de datos **Postgres** (Supabase), archivos en **Supabase Storage**.
- El molde es `templates/pagina.html` (el HTML del diseño nuevo) con marcadores `{{...}}`; el motor de plantilla es una función de 4 líneas (`renderTemplate` en `src/render.ts`).
- El panel es `templates/cms.html` + `public/assets/cms/cms.js` + `cms.css`.

### 3.4 Tabla comparativa honesta

| Aspecto | WordPress | Este CMS |
|---|---|---|
| Alcance | CMS general: blogs, páginas, tiendas, miles de plugins | Hecho a medida para **una página de enlaces/cartas** |
| Lenguaje / base | PHP + MySQL | Node.js/TypeScript + Postgres |
| Panel | `wp-admin`, muy completo | Panel propio de 5 pestañas, mobile-first |
| Usuarios y roles | Varios usuarios, roles (admin, editor, autor…) | **Un administrador por cliente**, sin roles |
| Historial de cambios / revisiones | Sí (revisiones de entradas) | **No** (sin historial ni auditoría) |
| Borradores / programación de publicación | Sí | **No**: todo cambio se publica al instante |
| Biblioteca de medios | Sí | **No**: cada archivo pertenece a un botón/logo/fondo |
| Múltiples páginas | Sí | **No**: una página por cliente |
| Idiomas | Con plugins | **No** (los textos bilingües se escriben a mano, ej. "Vinos \| Wines") |
| SEO | Plugins (Yoast, etc.) | Título y meta descripción editables; `noindex` configurable |
| Estadísticas de clics sin datos personales | Requiere plugin o Google Analytics (que usa cookies) | **Incluidas**, sin cookies ni IP |
| Mantenimiento | Actualizar núcleo, tema y plugins; superficie de ataque grande | Pocas dependencias (7 en producción) |
| Hosting | Servidor PHP con disco | Serverless (Vercel) + Postgres administrado (Supabase) |
| Portabilidad | Alta (estándar de la industria) | Alta en lo técnico (Node + Postgres estándar), pero es código propio: depende de FORST para evolucionarlo |
| Comunidad / soporte externo | Enorme | Ninguna: el soporte es FORST |

**Lo que este CMS NO hace (decirlo con claridad):** varios usuarios o roles, verificación en dos pasos, historial/auditoría de cambios, borradores, programar publicaciones, varias páginas por cliente, multilenguaje, biblioteca de medios, editor de texto enriquecido, contar visitantes únicos, contar clics en redes sociales, modo sin conexión.

---

<a id="s4"></a>
## 4. Arquitectura

### 4.1 Diagrama

```
                         ┌─────────────────────────────────────────────┐
  Visitante (navegador)  │  VERCEL — función serverless Node 24        │
  ─────────────────────► │  api/index.ts → createApp() (Express 5)     │
   GET /                 │   • arma la página (templates/pagina.html)  │
   GET /go/<id>  (302)   │   • /go/<id>: registra clic y redirige      │
                         │   • /cms_login, /cms y /api/cms/*           │
                         │                                             │
                         │  CDN de Vercel: /assets/cms/* (desde public)│
                         └──────────┬──────────────────────┬───────────┘
                                    │ SQL (postgres.js)    │ API de Storage
                                    │ DATABASE_URL         │ SUPABASE_URL +
                                    │ (Transaction pooler, │ SUPABASE_SECRET_KEY
                                    │  puerto 6543)        │ (crear URL firmada,
                                    ▼                      ▼  borrar archivos)
                     ┌──────────────────────┐   ┌──────────────────────────────┐
                     │ SUPABASE POSTGRES    │   │ SUPABASE STORAGE             │
                     │ settings, buttons,   │   │ bucket público "media"       │
                     │ socials, clicks,     │   │ <client_id>/pdf|logo|fondo/… │
                     │ admins (RLS activo,  │   └──────────────▲───────────────┘
                     │ sin políticas)       │                  │
                     └──────────────────────┘                  │ (a) el navegador del
                                                               │     visitante descarga
  Administrador (navegador)                                    │     PDF, logo y fondo
  ───────────────────────────► Vercel /cms, /api/cms/*         │     directo de aquí
     cookie cms_session (JWT)                                  │ (b) el panel SUBE el
     1) pide permiso de subida  ──► Vercel devuelve URL firmada│     archivo directo con
     2) PUT del archivo ───────────────────────────────────────┘     la URL firmada
```

### 4.2 Quién habla con quién

| Origen → Destino | Qué viaja | Cómo se conecta |
|---|---|---|
| Visitante → Vercel | Pedidos de `/` y `/go/<id>` | HTTPS |
| Vercel → Supabase Postgres | Consultas SQL parametrizadas | `DATABASE_URL` (postgres.js, `prepare: false`, `max: 1` conexión por instancia) [Código: `src/db.ts` `openPostgres`] |
| Vercel → Supabase Storage | Crear URL firmada de subida, subir (solo en `setup`), borrar archivos, construir URL pública | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` (cliente `@supabase/supabase-js`) [Código: `src/storage.ts` `supabaseStorage`] |
| Visitante → Supabase Storage | Descarga de PDF, logo y fondo (URLs públicas) | Directo, sin pasar por Vercel |
| Panel (navegador del admin) → Vercel | API JSON `/api/cms/*` con cookie de sesión | HTTPS, mismo origen |
| Panel → Supabase Storage | Solo el `PUT` del archivo con la URL firmada | Directo, sin clave (la firma va en la URL) |
| Panel → CDNs públicos | Google Fonts, Font Awesome 6.5.2, SortableJS 1.15.2, Chart.js 4.4.1 (cdnjs) | Sin integridad SRI (ver [sección 16](#s16)) |

**El navegador nunca recibe la clave de Supabase ni la cadena de conexión a la base.** Solo el servidor las tiene (variables de entorno de Vercel). [Código: ningún archivo de `public/` ni `templates/` contiene esas variables; `GET /api/cms/state` no las devuelve]

### 4.3 Modos de ejecución

| Modo | Base de datos | Archivos | Cuándo |
|---|---|---|---|
| **Producción (Vercel)** | Supabase Postgres (`DATABASE_URL`) | Supabase Storage | Siempre en Vercel. Sin `DATABASE_URL` en Vercel el servidor lanza el error "Falta DATABASE_URL: en Vercel el CMS necesita Supabase." [Código: `src/db.ts` `open`] |
| **Local contra Supabase** | Supabase | Supabase | `npm run dev` con `.env` completo |
| **Local puro** | PGlite (Postgres embebido) en `.data/pgdata` | Disco en `.data/uploads`, servido en `/uploads` | `npm run dev` sin `DATABASE_URL` ni `SUPABASE_URL`. La primera vez se crea y se llena sola. [Código: `src/server.ts`] |
| **Pruebas** | PGlite en memoria | Almacenamiento simulado en memoria | `npm test` [Código: `tests/api.test.ts`] |

<a id="s4-4"></a>
### 4.4 La página pública como plantilla

- `templates/pagina.html` es el HTML del diseño nuevo convertido en plantilla. [Código]
- Motor propio (`renderTemplate` en `src/render.ts`): `{{x}}` inserta texto **escapado**, `{{{x}}}` inserta HTML **crudo** (solo para `botones_html`, `redes_html` y `fondo_imagen_css`, que arma el propio servidor escapando cada valor), `{{#if x}}…{{/if}}` muestra un bloque si el valor no está vacío (no se permiten `if` anidados).
- Variables CSS del `:root` en la plantilla [Código: `templates/pagina.html`]:
  - `--fondo: {{color_fondo}}`, `--texto: {{color_texto}}`, `--texto-boton: {{color_texto_boton_hover}}`.
  - Nuevas: `--boton-bg: {{color_boton}}`, `--boton-texto: {{color_boton_texto}}`, `--boton-hover: {{color_boton_hover}}`.
  - Quedan fijas: `--boton: #26615F` y `--acento: #b3262b` (declaradas pero ya no usadas por ninguna regla).
- Reglas que ahora usan variables: `.boton { background: var(--boton-bg); color: var(--boton-texto); }` y `.boton:hover, .boton:focus-visible { background: var(--boton-hover); border-color: var(--boton-hover); color: var(--texto-boton); }`.
- Según el autor, **solo se cambiaron tres reglas CSS** (fondo del botón, texto del botón, fondo al hover) para usar variables **con los mismos valores de antes**; los valores por defecto (`#ffffff`, `#333333`, `#333333`, `#ffffff`) están en `client.json` y en `DEFAULT_SETTINGS`. [Reportado; el HTML original no está en el repositorio, así que no se pudo comparar línea por línea]
- **La página se arma en cada visita** con `Cache-Control: no-store` [Código: `src/app.ts` ruta `GET /`]. Por eso los cambios del panel se ven al instante sin redesplegar.

---

<a id="s5"></a>
## 5. Mapa completo de archivos del repositorio

### 5.1 Qué está en GitHub y qué no

**En git (33 archivos, según el índice local)** [Código]: `.env.example`, `.gitignore`, `README.md`, `STACK.md`, `api/index.ts`, `clients/intursa/client.json`, `db/schema.sql`, `package-lock.json`, `package.json`, `public/assets/cms/cms.css`, `public/assets/cms/cms.js`, `scripts/setup.ts`, `scripts/verify.ts`, `src/*.ts` (12 archivos), `templates/cms.html`, `templates/login.html`, `templates/pagina.html`, `tests/*.ts` (3 archivos), `tsconfig.json`, `vercel.json`.

**Ignorado por `.gitignore`** (nunca sube) [Código: `.gitignore`]:

| Patrón | Qué es |
|---|---|
| `node_modules/` | Dependencias instaladas |
| `.data/` | Base local PGlite y archivos locales |
| `.env`, `.env.*` (excepto `.env.example`) | Claves y configuración real |
| `.vercel/` | Configuración y salidas locales de la CLI de Vercel |
| `.claude/` | Configuración local de Claude Code (`launch.json` para `npm run dev`) |
| `*.log` | Registros |
| `clients/*/seed/` | PDF, logo y fondo iniciales del cliente (solo se usan con `npm run setup` desde el PC del autor) |
| `CONTEXTO.md` | Notas internas del proyecto |

**Sin commit pero NO ignorados** (subirían con un `git add .`): `GUIA-REUNION-TI.md`, `RESUMEN-PROYECTO.md`, `GUIA-PARA-CLAUDE.md` (este archivo). Y el cambio pendiente de `clients/intursa/client.json`.

> Importante: como `clients/intursa/seed/` **no está en GitHub**, quien clone el repositorio **no** puede ejecutar `npm run setup` para Intursa, ni `npm run dev` en modo local, ni `npm test` (las pruebas cargan esos archivos) hasta copiar la carpeta `seed/` desde el PC del autor (o descargarla de Supabase Storage). [Código: `src/seed.ts` `uploadSeedFile` lee `clients/<id>/seed/...`]

### 5.2 Archivo por archivo

#### Raíz

| Archivo | Qué hace | Cuándo se toca |
|---|---|---|
| `package.json` | Nombre `cms-tdi`, `"type": "module"`, `engines.node: "24.x"`, scripts (`dev`, `start`, `setup`, `verificar`, `typecheck`, `test`), dependencias. | Al agregar librerías o cambiar la versión de Node. |
| `package-lock.json` | Versiones exactas instaladas. | Lo actualiza `npm install`. |
| `tsconfig.json` | TypeScript estricto, `module/moduleResolution: NodeNext`, `noEmit` (no se compila a JS: se ejecuta con `tsx` en local y Vercel compila la función). Incluye `src`, `api`, `scripts`, `tests`. | Rara vez. |
| `vercel.json` | Configuración de Vercel (ver [sección 12.1](#s12)). | Al cambiar el despliegue. |
| `.env.example` | Plantilla de variables (sin valores secretos). | Al agregar variables. |
| `.gitignore` | Ver tabla anterior. | Rara vez. |
| `README.md` | Guía paso a paso: local, Supabase, GitHub, Vercel, salida en vivo, nuevo cliente, tracking. **Contiene las credenciales de demo** (en el repositorio privado). | Al cambiar procedimientos. |
| `STACK.md` | Resumen del stack técnico. | Al cambiar el stack. |
| `CONTEXTO.md` | Notas internas del inicio del proyecto (brief, hallazgos de los dos enlaces, tabla de PDF originales). **Ignorado por git.** Parte de su sección "Stack acordado" quedó superada. | Ya no se usa. |
| `RESUMEN-PROYECTO.md` | Resumen para el equipo y el responsable del WordPress del cliente. Sin commit. | Documento de apoyo. |
| `GUIA-REUNION-TI.md` | Guía de preparación de la reunión con TI. Sin commit. | Documento de apoyo. |
| `GUIA-PARA-CLAUDE.md` | Este documento. | — |

#### `api/`

| Archivo | Qué hace |
|---|---|
| `api/index.ts` | Entrada de Vercel: `export default createApp()`. Todas las rutas que no son archivos estáticos llegan aquí por el `rewrite` de `vercel.json`. |

#### `src/` (el servidor)

| Archivo | Qué hace | Funciones clave |
|---|---|---|
| `src/app.ts` | Aplicación Express: cabeceras de seguridad, estáticos, página pública, `/go/:id`, login, `/cms`, toda la API `/api/cms/*`, `/api/health`, manejo de errores 404/500. | `createApp`, `afterResponse` (guardado del clic después de responder), `parse` (validación zod → error 400), `HttpError`, `simplePage` |
| `src/auth.ts` | Login con bcrypt, hash de relleno, bloqueo 5 intentos / 15 min, cookie `cms_session` (JWT HS256 con `jose`, 12 h), lectura de sesión, middleware de la API y control de mismo origen. | `login`, `createSessionCookie`, `clearSessionCookie`, `getSession`, `requireApiSession`, `sameOrigin`, `hashPassword` |
| `src/db.ts` | Una sola interfaz `Db` (`query`, `exec`, `close`) con dos implementaciones: postgres.js (Supabase) o PGlite (local/pruebas). | `getDb`, `setDb` (pruebas), `openPostgres`, `openPglite` |
| `src/env.ts` | Lee variables de entorno; valores por defecto; exige `SESSION_SECRET` ≥ 32 caracteres en Vercel. | `env`, `localDataDir` |
| `src/networks.ts` | Lista cerrada de 12 redes y su ícono de Font Awesome 6.5. | `NETWORKS`, `NETWORK_KEYS` |
| `src/render.ts` | Motor de plantilla mínimo, escape HTML, armado de la página pública y de la vista previa. | `loadTemplate` (con caché solo en producción), `escapeHtml`, `renderTemplate`, `renderPage`, `cssUrl` |
| `src/repo.ts` | Todas las consultas SQL (siempre filtradas por `client_id`): ajustes, botones, redes, clics, estadísticas, CSV, administradores. | `getSettings`, `saveSettings`, `listButtons`, `getButton`, `createButton`, `updateButton`, `deleteButton`, `reorderButtons`, `listSocials`, `createSocial`, `updateSocial`, `deleteSocial`, `reorderSocials`, `recordClick`, `getStats`, `clicksForCsv`, `resetClicks`, `findAdmin`, `getAdminById`, `upsertAdmin`, `setAdminPassword`, `registerFailedLogin`, `clearFailedLogins`, `hasSettings` |
| `src/seed.ts` | Aplica `db/schema.sql` y carga los datos iniciales del cliente desde `clients/<id>/client.json` + `seed/` (sube los archivos). | `loadClientConfig`, `applySchema`, `seed` |
| `src/server.ts` | Servidor local (`npm run dev` / `npm start`): carga `.env`, en modo local crea y llena la base, escucha en `PORT`. | — |
| `src/storage.ts` | Archivos: Supabase Storage (bucket público `media`) o disco local. Reglas de subida (tipos y tamaños), saneo de nombres, ruta de objeto. | `getStorage`, `setStorage`, `UPLOAD_RULES`, `safeFileName`, `objectPathFor`, `ensureBucket`, `createUploadTarget`, `put`, `remove`, `publicUrl` |
| `src/tracking.ts` | Clasifica el dispositivo (celular/tablet/computadora) y decide si un clic se cuenta (no bots, no precargas, no HEAD). | `deviceType`, `shouldCount` |
| `src/validation.ts` | Esquemas zod de todo lo que entra desde el panel y los valores por defecto de los ajustes. | `settingsSchema`, `DEFAULT_SETTINGS`, `settingsPatch`, `buttonCreate`, `buttonPatch`, `socialCreate`, `socialPatch`, `orderBody`, `uploadRequest`, `loginBody`, `passwordBody`, `linkUrl`, `firstError` |

#### `templates/`

| Archivo | Qué es |
|---|---|
| `templates/pagina.html` | Plantilla de la página pública (el diseño nuevo). Fuentes Antonio y Poppins (Google Fonts) y Font Awesome 6.5.2. En escritorio (≥ 768 px) los botones van en dos columnas. **Se toca solo si cambia el diseño** (o para otro cliente con otro diseño). |
| `templates/login.html` | Pantalla de ingreso (`/cms_login`), con su pequeño script de envío a `/api/login`. `noindex`. |
| `templates/cms.html` | Estructura del panel: barra lateral, barra superior, 5 secciones, vista previa, barra inferior móvil, diálogos de contraseña y de borrar estadísticas. Carga SortableJS y Chart.js desde cdnjs y `cms.js` como módulo. |

#### `public/assets/cms/` (estáticos del panel)

| Archivo | Qué es |
|---|---|
| `cms.css` | Estilos del panel y del login. Puntos de quiebre: < 900 px barra inferior; ≥ 900 px barra lateral; ≥ 1280 px vista previa fija a la derecha. Respeta `prefers-reduced-motion`. |
| `cms.js` | Toda la lógica del panel (≈ 1 300 líneas, sin framework): estado en memoria, llamadas a la API, autoguardado con debounce, subidas con barra de progreso, vista previa, arrastrar para ordenar, estadísticas en vivo, cuenta. |

Ambos se piden con `?v=<versión>` para evitar cachés viejas (ver [sección 18](#s18)).

#### `db/`

| Archivo | Qué es |
|---|---|
| `db/schema.sql` | Esquema completo e **idempotente** (`create table if not exists`, `create index if not exists`): 5 tablas, 4 índices, RLS activado. Lo aplica `npm run setup` (y el arranque local). Ver [sección 6](#s6). |

#### `scripts/`

| Archivo | Comando | Qué hace |
|---|---|---|
| `scripts/setup.ts` | `npm run setup` | Muestra cliente, base y almacenamiento en uso; si hay `DATABASE_URL` sin `SUPABASE_URL` se detiene; aplica el esquema; crea/ajusta el bucket `media` (público, solo PDF/PNG/JPG/WEBP, límite 25 MB); carga datos iniciales **solo si el cliente está vacío**. Opciones: `-- --force` (borra y recarga botones, redes y ajustes, y **restablece la contraseña del admin**) y `-- --borrar-clics` (borra todas las estadísticas). |
| `scripts/verify.ts` | `npm run verificar` | Revisa una instalación con Supabase: variables presentes, `DATABASE_URL` en puerto 6543, conexión, 5 de 5 tablas, datos del cliente, usuario admin, que cada PDF responda a `HEAD` y una **subida de prueba real con URL firmada** (sube, comprueba que es pública y la borra). Sin `DATABASE_URL` no hace nada. |

#### `tests/`

| Archivo | Qué cubre |
|---|---|
| `tests/unit.test.ts` | 13 pruebas: `deviceType`, `shouldCount`, motor de plantilla, `escapeHtml`, `safeFileName`. |
| `tests/api.test.ts` | 33 pruebas de punta a punta de la API con PGlite en memoria. |
| `tests/postgres-driver.test.ts` | 3 pruebas del conector de producción (postgres.js) contra un Postgres real por red (PGlite expuesto por socket en el puerto 54329). |

Detalle en [sección 14](#s14).

#### `clients/intursa/`

| Archivo | Qué es |
|---|---|
| `client.json` | Configuración del cliente: `id` (`intursa`), `name` ("Tambo del Inka – Outlets"), `admin` (usuario y contraseña **iniciales de demo**), `settings` (textos y colores), `assets` (nombres de logo y fondo), `buttons` (9, cada uno con su PDF), `socials` (Facebook e Instagram). **Solo se lee al cargar datos iniciales** (`npm run setup` o primer arranque local). Cambiarlo no afecta a producción. |
| `seed/` (ignorado) | `logo-tdi-blanco.png` (12.6 KB), `fondo_intursa.jpg` (753 KB) y `pdf/` con los 9 PDF. El más pesado es "De nuestro huerto" (≈ 2.1 MB); ninguno supera 4.5 MB. |

---

<a id="s6"></a>
## 6. Modelo de datos

Fuente: `db/schema.sql` [Código]. Todas las tablas llevan `client_id text not null`. Todas tienen **RLS activado y ninguna política**.

### 6.1 `settings` (ajustes clave/valor)

| Columna | Tipo | Restricciones |
|---|---|---|
| `client_id` | text | not null; parte de la PK |
| `key` | text | not null; parte de la PK |
| `value` | text | not null, default `''` |

- PK `(client_id, key)`.
- Guardado: `saveSettings` hace un `insert … on conflict (client_id, key) do update` en lote, pasando la lista como JSON (`$2::text::jsonb`). [Código: `src/repo.ts`]
- Lectura: `getSettings` parte de `DEFAULT_SETTINGS` y sobreescribe con lo que haya en la base; **ignora claves desconocidas**.

**Todas las claves** (de `src/validation.ts`, `settingsSchema` y `DEFAULT_SETTINGS`):

| Clave | Validación | Por defecto | Valor de Intursa (`client.json`) | Dónde se usa |
|---|---|---|---|---|
| `cms_nombre` | texto ≤ 80 | "Mi página" | "Tambo del Inka – Outlets" (toma `name`) | Título del panel y del login. No sale en la página pública. |
| `titulo_pagina` | texto ≤ 120 | "Mi página" | "Tambo del Inka – Outlets" | `<title>` de la página pública. |
| `meta_descripcion` | texto ≤ 300 | "" | descripción de las cartas | `<meta name="description">` (solo si no está vacía). |
| `logo_url` | URL (ver nota) | "" | URL pública del logo subido | `<img>` del encabezado; vacío = sin logo. |
| `logo_alt` | texto ≤ 160 | "" | "Tambo del Inka Resort & Spa – Valle Sagrado" | `alt` del logo. |
| `fondo_tipo` | `imagen` \| `color` | `color` | `imagen` (lo fija el seed al subir el fondo) | Decide si se usa la imagen. |
| `fondo_imagen_url` | URL | "" | URL pública del fondo | `background` del `body`. |
| `color_fondo` | `#RRGGBB` | `#ffffff` | `#ffffff` | `--fondo` (color detrás/en lugar de la imagen). |
| `color_texto` | `#RRGGBB` | `#ffffff` | `#ffffff` | `--texto` (novedades, "Síguenos", íconos, línea). |
| `color_boton` | `#RRGGBB` | `#ffffff` | `#ffffff` | `--boton-bg` (fondo del botón). |
| `color_boton_texto` | `#RRGGBB` | `#333333` | `#333333` | `--boton-texto`. |
| `color_boton_hover` | `#RRGGBB` | `#333333` | `#333333` | `--boton-hover` (fondo y borde al pasar el mouse). |
| `color_texto_boton_hover` | `#RRGGBB` | `#ffffff` | `#ffffff` | `--texto-boton` (texto al pasar el mouse). |
| `novedades_activo` | `'0'` \| `'1'` | `'1'` | `'1'` | Muestra/oculta el bloque de novedades. |
| `novedades_texto` | texto ≤ 200 | "" | "¿Deseas recibir novedades y promociones?" | Texto del bloque. |
| `novedades_link_texto` | texto ≤ 60 | "Click aquí" | "Click aquí" | Texto del enlace. |
| `novedades_url` | URL | "" | https://www.intursa.com.pe/promociones/suscripcion/ | Destino del enlace. **El bloque solo aparece si `novedades_activo = '1'` y hay URL.** |
| `redes_titulo` | texto ≤ 60 | "Síguenos" | "Síguenos" | Título sobre los íconos. |

Nota sobre URLs (`linkUrl`): se acepta vacío, `http://` o `https://` absoluta sin espacios ni comillas ni `< >`, o una ruta local `/uploads/...` (modo local). El mensaje de error dice "debe empezar con https://", pero `http://` también se acepta. Los colores solo aceptan `#RRGGBB` (eso impide inyectar CSS). [Código]

### 6.2 `buttons`

| Columna | Tipo | Restricciones / default |
|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` |
| `client_id` | text | not null |
| `label` | text | not null (zod: 1–80 caracteres) |
| `kind` | text | not null, default `'pdf'`, check `in ('pdf','link')` |
| `url` | text | not null, default `''` (destino real: URL pública del PDF o enlace) |
| `file_name` | text | not null, default `''` (nombre original del PDF, para mostrar) |
| `file_path` | text | not null, default `''` (ruta del objeto en Storage, para poder borrarlo) |
| `new_tab` | boolean | not null, default false |
| `position` | int | not null, default 0 (orden) |
| `active` | boolean | not null, default **true** en SQL; pero `createButton` crea con `active = false` salvo que se indique |
| `created_at`, `updated_at` | timestamptz | default `now()`; `updated_at` se actualiza en cada `updateButton` |

Índice: `buttons_client_pos (client_id, position)`.

Reglas de negocio [Código: `src/app.ts` `PATCH /buttons/:id`, `src/render.ts`]:
- **Un botón es visible en la página solo si `active` y `url <> ''`.**
- Activar un botón sin destino → **400** "Agrega un PDF o un enlace antes de activar el botón."
- Si se vacía la URL sin indicar `active`, el servidor fuerza `active = false`.
- Si cambia `file_path`, el servidor **borra el archivo anterior** de Storage (esto ocurre al reemplazar el PDF y también al cambiar un botón de PDF a enlace, porque el panel envía `file_path: ''`).
- Al eliminar un botón se borra también su PDF de Storage.
- Un botón nuevo se crea al final (`max(position) + 1`).

### 6.3 `socials`

| Columna | Tipo | Restricciones / default |
|---|---|---|
| `id` | uuid | PK |
| `client_id` | text | not null |
| `network` | text | not null (zod: una de las 12 de `NETWORKS`) |
| `url` | text | not null, default `''` (zod: `https://`/`http://` o `mailto:`) |
| `position` | int | not null, default 0 |
| `active` | boolean | not null, default true |

Índice: `socials_client_pos (client_id, position)`.

Redes posibles [Código: `src/networks.ts`]: facebook, instagram, tiktok, youtube, whatsapp, x (Twitter), linkedin, tripadvisor (ícono genérico `fa-star-half-stroke`), pinterest, spotify, web (`fa-globe`), email (`fa-envelope`).

Regla: una red se muestra solo si `active`, tiene URL y su `network` está en la lista. **Si ninguna se muestra, se oculta toda la sección "Síguenos"** (`{{#if redes_html}}`). [Código]

### 6.4 `clicks`

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | bigint | identity, PK |
| `client_id` | text | not null |
| `button_id` | uuid | FK → `buttons(id)` **on delete set null** |
| `button_label` | text | not null — nombre del botón **en el momento del clic** |
| `device` | text | not null, check `in ('mobile','tablet','desktop')` |
| `clicked_at` | timestamptz | not null, default `now()` |

Índices: `clicks_client_time (client_id, clicked_at desc)` y `clicks_button (button_id)`.

**No hay columnas de IP, User-Agent, cookie, ubicación ni identificador de visitante.** Una prueba automática comprueba que las columnas sean exactamente estas seis. [Código: `tests/api.test.ts` "no guarda IP ni datos personales"]

**Relación clicks ↔ buttons:** al eliminar un botón, sus clics quedan con `button_id = null` y conservan `button_label`. Las estadísticas los muestran agrupados por nombre con la marca **"(eliminado)"**. Consecuencia: dos botones eliminados con el mismo nombre se suman en una sola fila. Además, si un botón se renombra, sus clics antiguos siguen sumándose al botón (porque el ranking une por `button_id`), pero el CSV muestra el nombre que tenía en cada clic.

### 6.5 `admins`

| Columna | Tipo | Restricciones |
|---|---|---|
| `id` | uuid | PK |
| `client_id` | text | not null |
| `username` | text | not null; `unique (client_id, username)` |
| `password_hash` | text | not null (bcrypt, costo 10) |
| `failed_attempts` | int | not null, default 0 |
| `locked_until` | timestamptz | null = no bloqueado |
| `created_at` | timestamptz | default `now()` |

- El login compara el usuario **sin distinguir mayúsculas** (`lower(username) = lower($2)`); la restricción `unique` sí distingue. [Código: `src/repo.ts` `findAdmin`]
- **No hay pantalla ni API para crear más administradores**: solo `npm run setup` (que crea/actualiza el usuario de `client.json` o de `ADMIN_USERNAME`/`ADMIN_PASSWORD`) o SQL directo.

### 6.6 RLS (Row Level Security)

`alter table … enable row level security` en las 5 tablas, **sin ninguna política**. Efecto: los roles públicos de la API REST de Supabase (`anon`, `authenticated`) **no pueden leer ni escribir nada**. El servidor se conecta con el usuario dueño de las tablas (el de `DATABASE_URL`), al que RLS no le aplica. [Código: `db/schema.sql`, comentario del encabezado] El panel y la página **no usan** la API REST de Supabase para datos: todo pasa por el servidor.

---

<a id="s7"></a>
## 7. Referencia completa de rutas HTTP

Fuente: `src/app.ts` `createApp` [Código]. Express 5 envía automáticamente los errores lanzados en funciones `async` al manejador de errores, por eso las rutas hacen `throw new HttpError(...)`.

### 7.1 Cabeceras aplicadas a todas las respuestas

| Cabecera | Cuándo |
|---|---|
| `X-Content-Type-Options: nosniff` | Siempre |
| `Referrer-Policy: strict-origin-when-cross-origin` | Siempre |
| `X-Robots-Tag: noindex, nofollow` | Rutas que empiezan con `/cms` (incluye `/cms_login`) o `/api`; **en todas** si `NOINDEX=1` |
| `X-Frame-Options: SAMEORIGIN` | Solo rutas `/cms*` y `/api*` (la página pública `/` **sí** se puede incrustar en un iframe) |
| `X-Powered-By` | Desactivada |

### 7.2 Rutas públicas

| Método y ruta | Qué hace | Respuestas |
|---|---|---|
| `GET /` | Lee ajustes, botones visibles y redes visibles (3 consultas en paralelo) y arma `pagina.html`. `Cache-Control: no-store`. Con `NOINDEX=1` agrega `<meta name="robots" content="noindex, nofollow">`. | 200 HTML |
| `GET /go/:id` | Tracking. Valida que `id` sea UUID; busca el botón; si no existe, está oculto o sin URL → **302 a `/`** sin contar. Si `shouldCount` → clasifica dispositivo y registra el clic con `afterResponse`. Luego **302 al destino real**. `Cache-Control: no-store`. | 302 |
| `HEAD /go/:id` | Igual que GET (Express atiende HEAD con la ruta GET) pero **no cuenta**. | 302 |
| `GET /cms_login` | Si ya hay sesión válida → 302 a `/cms`. Si no, entrega `login.html` con nombre del panel y logo. `no-store`. | 200 HTML / 302 |
| `POST /api/login` | Cuerpo JSON ≤ 10 KB `{username, password}` (zod: usuario 1–80, contraseña 1–200). Exige mismo origen. | 200 `{ok:true}` + cookie · 400 datos inválidos · 401 "Usuario o contraseña incorrectos." · 403 "Origen no permitido." · 429 "Demasiados intentos. Vuelve a intentarlo en N min." |
| `POST /api/logout` | Borra la cookie. No exige sesión. | 200 `{ok:true}` |
| `GET /api/health` | Hace una consulta mínima a la base (`hasSettings`) y responde el modo de almacenamiento. Sirve para monitoreo. | 200 `{ok:true, storage:"supabase"\|"local"}` · 500 si la base falla |
| `GET /assets/...` | Estáticos del panel. En Vercel los sirve la CDN directamente desde `public/`; en local los sirve Express (`maxAge` 1 h en producción, 0 en local). | 200 |
| `GET /uploads/...` | **Solo en modo local**: archivos subidos en `.data/uploads`. | 200 / 404 |
| Cualquier otra | `/api/*` → 404 JSON `{error:"No encontrado."}`; resto → 404 HTML "Página no encontrada". | 404 |

### 7.3 Panel

| Método y ruta | Qué hace |
|---|---|
| `GET /cms` y `GET /cms/` | Sin sesión → 302 a `/cms_login`. Con sesión → `cms.html` (con `asset_v` para la caché). `no-store`. |

### 7.4 API del panel `/api/cms/*`

Todas pasan por `requireApiSession` [Código: `src/auth.ts`]: sin sesión válida → **401** `{error:"Tu sesión expiró. Vuelve a ingresar."}`; en métodos distintos de GET/HEAD, si la cabecera `Origin` existe y no coincide con `Host` → **403** "Origen no permitido.".

Errores comunes: **400** con el primer mensaje de zod (los esquemas son `.strict()`: un campo desconocido también da 400); **413** "El archivo es demasiado grande." si el cuerpo excede el límite de Express; **400** si el JSON está mal formado; **500** "Ocurrió un error en el servidor. Intenta de nuevo." (el detalle va al registro del servidor).

| Método | Ruta | Cuerpo / parámetros | Qué hace | Respuestas específicas |
|---|---|---|---|---|
| GET | `/api/cms/state` | — | Estado inicial del panel: usuario, modo de almacenamiento, ajustes, valores por defecto, todos los botones y redes (incluidos ocultos), lista de redes, reglas de subida. | 200 |
| PATCH | `/api/cms/settings` | JSON ≤ 50 KB, cualquier subconjunto de claves de `settingsSchema` | Guarda ajustes en lote; devuelve todos los ajustes. | 400 clave desconocida, color o URL inválida |
| POST | `/api/cms/buttons` | `{label?}` (1–80; por defecto "Nuevo botón") | Crea botón oculto, sin destino, al final. | 201 `{button}` |
| PATCH | `/api/cms/buttons/:id` | JSON ≤ 20 KB: `label`, `kind`, `url`, `file_name` (≤200), `file_path` (≤400), `new_tab`, `active` | Actualiza; aplica reglas de visibilidad; borra el PDF anterior si cambió `file_path`. | 404 id no UUID o inexistente · 400 "Agrega un PDF o un enlace antes de activar el botón." · 400 "El botón necesita un nombre" · 400 URL inválida |
| DELETE | `/api/cms/buttons/:id` | — | Borra el botón (y su PDF de Storage). Sus clics quedan como "(eliminado)". | 200 · 404 |
| PUT | `/api/cms/buttons/order` | `{ids: uuid[]}` (≤ 200) | Reordena: `position` = índice en la lista. Devuelve los botones. | 400 |
| POST | `/api/cms/socials` | `{network, url?}` | Crea red (activa, al final). | 201 · 400 red fuera de la lista o URL inválida |
| PATCH | `/api/cms/socials/:id` | `network`, `url`, `active` | Actualiza red. | 404 · 400 |
| DELETE | `/api/cms/socials/:id` | — | Borra red. | 200 · 404 |
| PUT | `/api/cms/socials/order` | `{ids}` | Reordena redes. | 400 |
| POST | `/api/cms/uploads` | `{purpose: pdf\|logo\|fondo, fileName (1–200), contentType, size}` | Valida tipo declarado, tamaño declarado y (para PDF) extensión `.pdf`; genera ruta `<client_id>/<purpose>/<sello>-<nombre-saneado>` y devuelve `{uploadUrl, path, publicUrl, contentType}`. En Supabase `uploadUrl` es una **URL firmada de subida**; en local apunta a `/api/cms/uploads/local`. | 400 "Formato no permitido. Usa …" · 400 "El archivo es muy pesado. Máximo: …" · 400 "El archivo debe ser .pdf" |
| PUT | `/api/cms/uploads/local?path=…` | Cuerpo binario ≤ 26 MB | **Solo modo local.** Valida la ruta con la expresión `^<client_id>/(pdf\|logo\|fondo)/[a-z0-9]+-[A-Za-z0-9._-]+$` y guarda el archivo. | 404 si no es modo local · 400 "Ruta de archivo inválida." · 400 "Archivo vacío." |
| GET | `/api/cms/stats?days=7\|30\|90` | otro valor → 30 | Estadísticas del periodo (ver [8.9](#s8-9)). `no-store`. | 200 |
| GET | `/api/cms/stats.csv?days=…` | — | CSV agregado por día, botón y dispositivo: columnas `Fecha,Botón,Dispositivo,Clics`, con BOM UTF-8 y fin de línea CRLF (abre bien en Excel). Nombre: `clics-<client_id>-<días>dias.csv`. | 200 `text/csv` |
| DELETE | `/api/cms/clicks` | `{confirm:"BORRAR"}` | Borra **todos** los clics del cliente. | 200 `{deleted:n}` · 400 "Escribe BORRAR para confirmar." |
| POST | `/api/cms/password` | `{current, next}` (next ≥ 8, ≤ 200) | Verifica la contraseña actual con bcrypt y guarda el hash nuevo. | 200 · 400 "La contraseña actual no es correcta." · 400 "La nueva contraseña debe tener al menos 8 caracteres" |
| GET | `/api/cms/preview` | — | Mismo armado que la página pública, pero los botones apuntan **directo** al destino (sin `/go/`, así no se cuentan) y se agrega `<base target="_blank">`. | 200 HTML |

---

<a id="s8"></a>
## 8. Flujos detallados paso a paso

### 8.1 Visita pública (`GET /`)

1. El navegador pide `/` a Vercel; como no es un archivo de `public/`, el `rewrite` lo envía a la función `api/index.ts`.
2. `createApp` ejecuta en paralelo `repo.getSettings()`, `repo.listButtons(true)` (solo `active` y con URL, ordenados por `position, created_at`) y `repo.listSocials(true)`.
3. `renderPage` arma `botones_html` (cada botón es `<a class="boton" href="/go/<id>">NOMBRE</a>`, con `target="_blank" rel="noopener"` si `new_tab`), `redes_html` (enlaces con `aria-label`, siempre en pestaña nueva), `fondo_imagen_css` (`url("…")` solo si `fondo_tipo = imagen` y hay URL) y oculta novedades si están desactivadas.
4. Responde con `Cache-Control: no-store`.
5. El navegador descarga fuentes (Google Fonts), Font Awesome (cdnjs) y el logo y el fondo **directo de Supabase Storage**.

Nota de detalle: el texto de los botones se ve en mayúsculas por CSS (`text-transform: uppercase`); en la base está tal como se escribió.

### 8.2 Clic con tracking (`GET /go/:id`)

1. El visitante toca un botón; el navegador pide `/go/<uuid>`.
2. Si el id no es un UUID, no existe, está oculto o no tiene URL → **302 a `/`** y no se cuenta nada.
3. `shouldCount(req)` [Código: `src/tracking.ts`] devuelve **falso** (no se cuenta) si:
   - el método no es `GET` (por ejemplo `HEAD`, que usan algunos verificadores de enlaces);
   - no hay `User-Agent`, o la librería **`isbot`** lo reconoce como bot (Googlebot, bingbot, `facebookexternalhit`, WhatsApp, `curl`, etc.). Esto cubre las **vistas previas de enlaces** de WhatsApp/Facebook;
   - la cabecera `Sec-Purpose`, `Purpose` o `X-Purpose` contiene `prefetch` o `preview` (**precargas** del navegador o prerender).
4. Si se cuenta, `deviceType(userAgent, sec-ch-ua-mobile)` clasifica:
   - **tablet** si el User-Agent contiene `ipad`, `tablet`, `playbook`, `silk`, `kindle`, `nexus 7/9/10`, o es Android **sin** la palabra `mobile`;
   - **mobile** si la pista `Sec-CH-UA-Mobile` vale `?1`, o el UA contiene `mobi`, `iphone`, `ipod`, `android`, `blackberry`, `opera mini`, `iemobile`, `windows phone`;
   - **desktop** en cualquier otro caso.
   - **Por qué los iPad recientes salen como "computadora":** desde iPadOS 13, Safari en iPad se presenta por defecto con un User-Agent de Mac de escritorio ("Macintosh"), así que el servidor no puede distinguirlo de una Mac sin usar JavaScript o huellas del dispositivo (que no se usan por privacidad). Los iPad que sí envían "iPad" se cuentan como tablet.
5. Se llama `afterResponse(repo.recordClick(button, device))` [Código: `src/app.ts`]:
   - En Vercel, el runtime expone un contexto en `globalThis[Symbol.for('@vercel/request-context')]` con `waitUntil`. El código registra la escritura con `waitUntil` **sin esperarla**, y la función sigue viva hasta que la escritura termina aunque la respuesta ya se haya enviado. Es el mismo mecanismo que `waitUntil` de `@vercel/functions`, pero leído directamente (ver [sección 18](#s18)).
   - En local o en pruebas (no hay contexto) se **espera** la escritura antes de responder.
   - Si la escritura falla, se registra `[tracking]` en el log y el visitante igual es redirigido.
6. Responde **302** a `button.url` (la URL pública del PDF en Supabase o el enlace externo). El visitante no nota nada.
7. Se guarda solo: `client_id`, `button_id`, `button_label`, `device`, `clicked_at`.

**Por qué redirección y no JavaScript `sendBeacon`** [Decisión]: es más fiable. Los bloqueadores de anuncios suelen bloquear scripts y llamadas de analítica, y si el visitante cierra la pestaña muy rápido el `beacon` puede perderse. Con la redirección, el clic se registra en el mismo pedido que lleva al PDF. Además la página sigue sin JavaScript, como el diseño original.

### 8.3 Login

1. `GET /cms_login` muestra el formulario (si ya hay sesión, salta a `/cms`).
2. El script de la página envía `POST /api/login` con JSON.
3. El servidor comprueba **mismo origen** (`sameOrigin`: si viene la cabecera `Origin`, su host debe ser igual a `Host`).
4. `login(username, password)` [Código: `src/auth.ts`]:
   - Busca el admin por usuario sin distinguir mayúsculas.
   - **Si no existe**, compara igual la contraseña contra un **hash de relleno** (`DUMMY_HASH`) para tardar lo mismo y no revelar qué usuarios existen; responde 401 con el mismo mensaje.
   - Si está **bloqueado** (`locked_until` en el futuro) → 429 con los minutos restantes.
   - Si el bloqueo ya venció, reinicia el contador.
   - Si la contraseña no coincide: `failed_attempts + 1`; al llegar a **5** se fija `locked_until = now() + 15 min` → 401.
   - Si coincide: limpia el contador.
5. `createSessionCookie`: firma un **JWT HS256** con `jose` usando `SESSION_SECRET`; contenido: `sub` = id del admin, `username`, `cid` = `CLIENT_ID`, `iat`, `exp` = **12 h**. Cookie `cms_session`: `httpOnly`, `sameSite=lax`, `secure` en producción, `path=/`, duración 12 h.
6. El navegador va a `/cms`.
7. En cada pedido al panel, `getSession` verifica la firma, el algoritmo, la expiración y que `cid` sea el `CLIENT_ID` de este despliegue. **No consulta la base**: la sesión es "sin estado".

### 8.4 Edición con autoguardado

[Código: `public/assets/cms/cms.js`]
1. No hay botón "Guardar". Cada campo guarda solo:
   - Textos de ajustes y nombres de botones: **debounce de 550 ms** (agrupa lo que se escribe rápido en una sola escritura).
   - Enlaces de botones y de redes: **700 ms**.
   - Interruptores, segmentados (imagen/color), subidas, orden, colores restablecidos: inmediato.
2. Las URL se normalizan en el navegador (agrega `https://` si falta; en la red "Correo" convierte un correo en `mailto:`). Si no es válida, se muestra un error en el campo y no se envía. El servidor vuelve a validar todo con zod.
3. Indicador superior ("píldora"): **Guardando…** → **Publicado** (o **Error al guardar**, con un aviso en pantalla); al cargar dice **Todo guardado**.
4. Al terminar todas las escrituras pendientes se refresca la **vista previa**.
5. Si se intenta cerrar la pestaña con cambios pendientes, el navegador pide confirmación (`beforeunload`).
6. Si la sesión expiró (401), el panel redirige al login.

### 8.5 Subida de PDF, logo o fondo

1. El usuario elige o arrastra un archivo.
2. El panel valida tipo y tamaño en el navegador (reglas que vienen de `/api/cms/state`).
3. `POST /api/cms/uploads` con `{purpose, fileName, contentType, size}`. El servidor valida [Código: `src/app.ts`, `src/storage.ts` `UPLOAD_RULES`]:

   | Propósito | Tipos permitidos | Tamaño máximo |
   |---|---|---|
   | `pdf` | `application/pdf` y nombre terminado en `.pdf` | 25 MB |
   | `logo` | PNG, JPG, WEBP | 5 MB |
   | `fondo` | PNG, JPG, WEBP | 8 MB |

4. El servidor arma la ruta `<client_id>/<propósito>/<sello de tiempo base36>-<nombre saneado>` (`safeFileName` quita acentos, espacios y caracteres raros; ej. "Logo Ñandú.png" → "Logo-Nandu.png") y pide a Supabase una **URL firmada de subida** (`createSignedUploadUrl`).
5. El navegador hace `PUT` del archivo **directo a Supabase** con esa URL, mostrando una barra de progreso (XMLHttpRequest).
6. Al terminar:
   - **PDF**: `PATCH /api/cms/buttons/:id` con `kind:'pdf'`, `url` pública, `file_name`, `file_path`. Si el botón no tenía destino y estaba oculto, el panel lo **activa automáticamente**. El servidor **borra el PDF anterior** de Storage.
   - **Logo**: guarda `logo_url`.
   - **Fondo**: guarda `fondo_imagen_url` y `fondo_tipo = imagen`.
7. **Logo y fondo anteriores NO se borran** de Storage (quedan como archivos huérfanos). "Quitar logo" solo vacía `logo_url` (por eso su "Deshacer" funciona). [Código]

**Por qué subida directa** [Decisión]: Vercel limita el cuerpo de cada petición a unos 4.5 MB; los PDF no pasan por Vercel, así que el límite real es el de la regla (25 MB). Las 9 cartas actuales pesan como máximo ≈ 2.1 MB, de modo que la decisión es **preventiva** para cartas futuras más pesadas.

### 8.6 Reordenar

- **Botones**: arrastrando el ícono ⋮⋮ (SortableJS) o con "Subir"/"Bajar" dentro de la edición del botón. Se envía `PUT /api/cms/buttons/order` con la lista completa de ids.
- **Redes**: solo arrastrando. `PUT /api/cms/socials/order`.
- En SQL, `position` = índice en la lista (una sola consulta con `jsonb_array_elements_text … with ordinality`).

### 8.7 Eliminar con "Deshacer"

1. Al eliminar un botón o una red, el panel lo quita de la lista y muestra un aviso con **"Deshacer" durante 6 segundos**.
2. El `DELETE` real se envía **recién a los 6 s** (borrado diferido en el navegador). "Deshacer" cancela el temporizador.
3. Si el usuario cierra o abandona la página antes, los borrados pendientes se envían de inmediato con `keepalive` (`pagehide`/`beforeunload`/cerrar sesión).
4. Una vez enviado, **no hay vuelta atrás**: el botón y su PDF se borran (sus clics quedan como "(eliminado)").

### 8.8 Cambio de contraseña

Menú de cuenta (círculo con la inicial) → "Cambiar contraseña" → contraseña actual + nueva (mín. 8) + repetir. El servidor verifica la actual con bcrypt y guarda el nuevo hash. **Las sesiones ya abiertas (en otros dispositivos) siguen válidas hasta que venzan (máx. 12 h)**, porque la sesión no se revoca en la base. [Código]

<a id="s8-9"></a>
### 8.9 Estadísticas

[Código: `src/repo.ts` `getStats`, `clicksForCsv`; `cms.js` `loadStats`, `renderStats`]
- **Inicio del periodo**: medianoche (en la zona horaria `STATS_TZ`, por defecto `America/Lima`) de hace `días − 1` días. Ej.: "7 días" = hoy y los 6 días anteriores completos.
- Seis consultas en paralelo:
  1. **Ranking**: todos los botones actuales con sus clics del periodo (incluye los de 0 clics y los ocultos, marcados "(oculto)").
  2. **Eliminados**: clics con `button_id` nulo, agrupados por `button_label` ("(eliminado)").
  3. **Por día**: una fila por cada día del periodo (también los días sin clics).
  4. **Por dispositivo**.
  5. **Por hora** (0–23, en la zona horaria del cliente).
  6. **Totales**: total del periodo, **hoy**, y total histórico.
- Pantalla: KPIs (Clics totales con el histórico debajo, **Lo más buscado** con su %, **Hoy**, **% desde celular**), una frase de resumen ("En los últimos N días lo más buscado es… le sigue… la mayoría entra desde… la hora con más movimiento es…"), gráfico de línea por día y de barras por hora (Chart.js), barra de dispositivos, ranking con barras.
- **Periodos**: 7, 30 (por defecto) o 90 días.
- **Refresco automático cada 8 s**, solo mientras la pestaña Estadísticas está abierta y la ventana visible; el indicador "En vivo" se pausa si la ventana se oculta. Al subir el total, el número hace una pequeña animación.
- **Exportar CSV**: agregado (no clic por clic) por día, botón y dispositivo del periodo.
- **Borrar estadísticas**: diálogo que exige escribir **BORRAR**; el servidor también exige `{confirm:"BORRAR"}`. Borra **todos** los clics del cliente (no solo los del periodo). No se puede deshacer.
- En la pestaña Botones, cada botón muestra su contador de clics del periodo elegido.

### 8.10 Vista previa

- Se obtiene de `GET /api/cms/preview` y se inyecta en un `<iframe srcdoc>` con `sandbox` **sin scripts** (`allow-same-origin allow-popups allow-popups-to-escape-sandbox`).
- Los botones apuntan **directo** al PDF (no a `/go/`): **los clics en la vista previa no se cuentan**. Todo se abre en pestaña nueva.
- Muestra solo los botones que serían visibles en la página real (misma regla `active && url`).
- Se refresca sola tras cada guardado y conserva la posición de desplazamiento.

### 8.11 Primer ingreso

Una tarjeta "Así funciona tu panel" (3 pasos: edita, se guarda solo, revisa la vista previa) aparece la primera vez. Al cerrarla se recuerda en el navegador (`localStorage`, clave `cms-guia-vista`). Se puede volver a ver desde el menú de cuenta → "Ver guía rápida".

### 8.12 Cerrar sesión

Menú de cuenta → "Cerrar sesión": envía los borrados pendientes, `POST /api/logout` (borra la cookie) y vuelve al login.

<a id="s8-13"></a>
### 8.13 El caso de Facebook e Instagram (explica una duda que surgió)

- En el commit que está en GitHub, `client.json` tenía Facebook e Instagram **con URL vacía** [Código: diferencia entre el archivo local y el commit]. Por eso, al ejecutar `npm run setup` en producción, se crearon las dos filas en `socials` **sin enlace** y la sección "Síguenos" quedó oculta.
- Después, el autor cargó los enlaces oficiales (https://www.facebook.com/TamboDelInka/ y https://www.instagram.com/hoteltambodelinka/) **directamente en la base de producción con un script**, no desde el panel. [Reportado]
- La página publicada los muestra **porque lee la base en cada visita**: no hizo falta redesplegar ni subir código.
- También se actualizó `clients/intursa/client.json` con esos enlaces, pero ese cambio **está solo en el PC del autor (sin commit, sin push)**. Ese archivo solo se usa al cargar datos iniciales, así que **no afecta a producción**; sirve para que una instalación nueva (o un `setup --force`) ya traiga los enlaces.
- La duda típica es "¿cómo es que la página muestra las redes si el cambio no está en GitHub?". Respuesta: el **contenido** vive en Supabase; GitHub solo tiene el **código** y la configuración inicial.
- Efecto colateral (ya corregido): con el `client.json` modificado, 2 pruebas fallaron porque esperaban redes vacías; se ajustaron y las 49 pasan. Ver [sección 14](#s14).

---

<a id="s9"></a>
## 9. El panel (pestaña por pestaña)

### 9.1 Estructura y comportamiento según pantalla

[Código: `templates/cms.html`, `public/assets/cms/cms.css`]

| Ancho | Navegación | Vista previa |
|---|---|---|
| < 900 px (celular) | Barra superior + **barra inferior fija** con 5 pestañas (Botones, Diseño, Textos, Redes, **Datos**) | Botón flotante "Vista previa" que abre una **hoja a pantalla completa** |
| 900–1279 px (tablet/escritorio chico) | **Barra lateral** izquierda; sin barra inferior | Botón flotante → hoja a pantalla completa |
| ≥ 1280 px (escritorio) | Barra lateral | **Panel lateral derecho fijo** con un "teléfono" que muestra la página en vivo |

- En la pestaña Estadísticas la vista previa se oculta y los gráficos usan todo el ancho.
- La barra superior muestra el título de la sección, la píldora de guardado, un acceso a "Ver página publicada" (en celular) y el menú de cuenta (guía rápida, cambiar contraseña, cerrar sesión).
- La pestaña activa se guarda en la URL (`#botones`, `#diseno`, `#textos`, `#redes`, `#estadisticas`).

### 9.2 Botones

- Resumen arriba: "N visibles", "N ocultos", "N sin destino".
- Cada botón: asa para arrastrar, nombre, subtítulo (nombre del PDF o dominio del enlace; o aviso "Sin destino"), contador de clics, interruptor **Visible/Oculto**, botón Editar.
- Al editar: **1. Nombre** (se ve en mayúsculas en la página), **2. ¿Qué se abre al tocarlo?** (Archivo PDF / Enlace web; zona para subir o "Reemplazar" con arrastrar y soltar, enlace "Ver PDF"), **3. Opciones** (abrir en pestaña nueva), Subir/Bajar, **Eliminar botón**.
- No deja activar un botón sin destino (aviso y abre la edición).
- "+ Nuevo botón" crea uno oculto, lo abre y pone el foco en el nombre.
- Cambiar de PDF a "Enlace web" y escribir un enlace **borra el PDF anterior** del almacenamiento (ver 6.2).

### 9.3 Diseño

- **Logo**: subir (o arrastrar), quitar (con Deshacer), descripción alternativa (`logo_alt`). Recomendación en pantalla: PNG con fondo transparente, máx. 5 MB.
- **Fondo**: Imagen / Color sólido; subir imagen (ideal 1920 px JPG, máx. 8 MB); color de fondo.
- **Colores**: textos de la página, fondo del botón, texto del botón, botón al pasar el mouse, texto al pasar el mouse; selector de color + código hexadecimal; muestra "Así se ven tus botones" (normal y al tocar); **Restablecer** (vuelve a `DEFAULT_SETTINGS`, que coinciden con los colores del diseño de Intursa) con Deshacer.

### 9.4 Textos

- **Novedades y promociones**: interruptor mostrar/ocultar, texto, texto del enlace, destino, mini vista previa.
- **Sección de redes**: título ("Síguenos").
- **Pestaña del navegador y Google**: título de la página y descripción (contador /300) con una simulación de cómo se vería en Google.
- **Nombre en este panel** (`cms_nombre`): solo se ve dentro del panel.

### 9.5 Redes

- "+ Agregar red" abre un selector con las 12 redes.
- Cada red: ícono, selector de red, enlace (con ejemplo según la red; en "Correo" se puede escribir solo el correo), estado ("Visible en la página", "Oculta en la página", "Falta el enlace: no aparece en la página"), interruptor, eliminar (con Deshacer), arrastrar para ordenar.

### 9.6 Estadísticas ("Datos" en la barra inferior)

Ver [8.9](#s8-9). Pie con la nota de privacidad: "Sin datos personales: solo se guarda qué botón, cuándo y el tipo de dispositivo (Ley 29733). No se guarda la IP. Los clics de bots no se cuentan."

### 9.7 Accesibilidad básica (lo que existe)

[Código] Roles ARIA (`radiogroup`/`radio` en segmentados, `switch` en interruptores, `menu`/`menuitem`, `dialog` nativo), `aria-label` en botones de ícono, `aria-live` en la píldora de guardado y en los avisos, `aria-current` en la pestaña activa, foco visible (`:focus-visible`), `prefers-reduced-motion` respetado, Escape cierra el menú y la vista previa, textos generados de forma segura. **No se hizo una auditoría formal de accesibilidad (WCAG).** [Pendiente]

---

<a id="s10"></a>
## 10. Seguridad y privacidad en profundidad

### 10.1 Autenticación

- Contraseñas con **bcrypt** (bcryptjs, costo 10). Nunca se guardan en texto plano. [Código: `src/auth.ts`]
- Mensaje idéntico para usuario inexistente y contraseña incorrecta + **hash de relleno** para igualar tiempos.
- **Bloqueo por cuenta**: 5 intentos fallidos → 15 minutos (429).
- Usuario sin distinguir mayúsculas.
- La contraseña nueva exige mínimo 8 caracteres (sin reglas de complejidad).

### 10.2 Sesiones

- JWT HS256 firmado con `SESSION_SECRET` (en Vercel debe tener ≥ 32 caracteres, si no el servidor lanza error al usar la sesión).
- Cookie `cms_session`: `httpOnly` (JavaScript no puede leerla), `secure` en producción (solo HTTPS), `sameSite=lax`, 12 h.
- La sesión incluye `cid` (cliente): una cookie de otro despliegue no sirve aquí.
- Una cookie manipulada da 401 (probado).

### 10.3 CSRF (falsificación de peticiones entre sitios)

Doble defensa: `sameSite=lax` (el navegador no envía la cookie en POST/PATCH/DELETE iniciados desde otro sitio) y verificación de **mismo origen** en todas las escrituras de la API y en el login (si llega `Origin`, su host debe ser igual a `Host`). Si no llega `Origin` (herramientas como curl) se acepta, porque los navegadores siempre lo envían en `fetch` no-GET. [Código: `sameOrigin`]

### 10.4 Datos y base

- **Clave secreta de Supabase solo en el servidor** (variables de Vercel). No está en el código, ni en GitHub, ni llega al navegador.
- **RLS activo sin políticas**: la API pública de Supabase no expone nada.
- **SQL parametrizado** en todas las consultas (`$1, $2…`). Los únicos fragmentos que se arman como texto son nombres de columnas/tablas de **listas fijas en el código**, nunca texto del usuario. [Código: `src/repo.ts`]
- Todas las consultas filtran por `client_id`.

### 10.5 Validación de entrada (zod)

Esquemas estrictos (campos desconocidos → 400), longitudes máximas, URLs solo `http(s)` (o `mailto:` en redes, o `/uploads/` en local), colores `#RRGGBB`, redes de lista cerrada, `fondo_tipo` de lista cerrada, ids UUID. Probado contra `javascript:alert(1)`, `data:`, `ftp:`, comillas para romper atributos y CSS inyectado en colores.

### 10.6 Escape HTML / XSS

- `{{x}}` escapa `& < > " '`. Los nombres de botones y textos se escapan (probado con `<img src=x onerror=alert(1)>`).
- En el panel, todo el contenido dinámico se crea con `textContent`/`createElement` (función `h`), nunca con `innerHTML` de datos.
- La vista previa va en un iframe sin permiso de ejecutar scripts.
- URLs dentro de CSS (`fondo_imagen_css`) se encierran en `url("…")` codificando comillas, barras invertidas y saltos de línea.

### 10.7 Subidas

- Validación de tipo declarado, tamaño declarado y extensión `.pdf` antes de dar permiso de subida.
- Nombres saneados (sin rutas, sin `..`, sin acentos). Sello de tiempo para no pisar archivos.
- Bucket `media` configurado por `setup` con tipos permitidos (PDF/PNG/JPG/WEBP) y límite de 25 MB.
- En modo local, la ruta se valida con una expresión estricta y además `abs()` impide escribir fuera de `.data/uploads` (**protección contra path traversal**, probada con `../../src/app.ts`).
- Los archivos públicos se sirven desde el dominio de Supabase, **no** desde el dominio del CMS: un archivo malicioso no podría ejecutar código en el contexto del panel.

### 10.8 Cabeceras e indexación

Ver [7.1](#s7). Además `login.html` y `cms.html` llevan `<meta name="robots" content="noindex, nofollow">`. Con `NOINDEX=1` toda la página pública pide no ser indexada.

### 10.9 Ley 29733 (Protección de Datos Personales, Perú)

- **Qué se guarda por clic:** botón (id y nombre), fecha y hora, tipo de dispositivo (celular/tablet/computadora), id de cliente.
- **Qué NO se guarda:** IP, User-Agent completo, cookies, ubicación, identificadores de dispositivo o de visitante. La página pública **no pone cookies**. El User-Agent se usa solo en memoria para clasificar y filtrar bots, y se descarta.
- **Fuera de nuestra base:** Vercel y Supabase guardan sus propios **registros técnicos de infraestructura** (que pueden incluir IP). Conviene mencionarlo en la política de privacidad del cliente. [Suposición sobre el contenido exacto de esos registros]
- Recursos de terceros que el navegador del visitante descarga: Google Fonts y Font Awesome (cdnjs), lo que implica que esos proveedores ven la IP del visitante al servir los archivos. [Suposición razonable; no está en el alcance del código]
- El administrador sí es una persona con datos (usuario y hash de contraseña).
- No es una opinión legal: para certeza, que lo revise el área legal del cliente.

### 10.10 Limitaciones reales de seguridad (verificadas en el código)

| Limitación | Detalle |
|---|---|
| Un admin por cliente | No hay pantalla para crear usuarios ni roles. |
| Sin 2FA | Solo usuario y contraseña. |
| Sin auditoría | No se registra quién cambió qué ni cuándo. |
| Bloqueo por usuario, no por IP | Un atacante podría **bloquear a propósito** al admin legítimo durante 15 min (denegación de servicio). Tras el bloqueo, el 429 revela que el usuario existe. |
| Sin limitación de peticiones por IP | Ni en login ni en `/go/:id` (alguien podría inflar clics con un navegador real; los bots declarados sí se filtran). |
| Sesión sin revocación | Cerrar sesión borra la cookie del navegador, pero un token copiado seguiría válido hasta 12 h; cambiar la contraseña no cierra otras sesiones. |
| Bucket público de lectura | Cualquiera con el enlace abre un PDF/imagen (las cartas son públicas por naturaleza). Los nombres de archivo son predecibles en parte (sello de tiempo + nombre). |
| Validación de archivos por tipo declarado | El servidor no inspecciona el contenido ni pasa antivirus. El tamaño real lo limita el bucket a 25 MB para cualquier tipo (los límites de 5/8 MB de logo/fondo se validan sobre el tamaño **declarado**). |
| `file_path` confiado | El servidor no verifica que el `file_path` enviado por el panel pertenezca a la carpeta del cliente; un admin autenticado podría provocar el borrado de otro objeto del mismo bucket (impacto limitado: un proyecto de Supabase por cliente). |
| Sin CSP ni SRI | No hay `Content-Security-Policy`; los scripts y estilos de CDN se cargan sin `integrity`. |
| `SESSION_SECRET` fuera de Vercel | En Vercel es obligatorio (≥ 32). **Fuera de Vercel** (por ejemplo, si se migra a otro hosting) y sin `SESSION_SECRET`, el código usa un secreto fijo de desarrollo aunque `NODE_ENV=production` → hay que definirlo siempre. [Código: `src/env.ts`] |
| `/api/logout` sin verificación | Cualquiera podría forzar el cierre de sesión de un admin desde otro sitio (molestia menor). |
| Credenciales de demo en el repositorio | `README.md` y `client.json` contienen usuario y contraseña de demo (repositorio privado). Deben cambiarse en producción. |
| Claves compartidas en un chat | La clave secreta de Supabase y la contraseña de la base se compartieron en un chat durante el desarrollo → **rotarlas** ([sección 17](#s17)). [Reportado] |

---

<a id="s11"></a>
## 11. Variables de entorno

Solo nombres y función; **nunca** valores. Fuente: `src/env.ts`, `src/db.ts`, `src/app.ts`, `src/seed.ts`, `.env.example` [Código].

| Variable | Para qué sirve | Si falta |
|---|---|---|
| `CLIENT_ID` | Qué cliente sirve este despliegue (carpeta `clients/<id>` y valor de `client_id` en todas las tablas). | Usa `intursa`. |
| `SESSION_SECRET` | Firma de la cookie de sesión. Cadena larga y aleatoria (≥ 32). README sugiere generarla con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. | En Vercel (o si tiene < 32): error al usar la sesión (login y panel fallan con 500). Fuera de Vercel: usa un secreto fijo de desarrollo (inseguro). |
| `DATABASE_URL` | Cadena de conexión a Supabase Postgres, **Transaction pooler, puerto 6543**. Se usa con `prepare: false` (obligatorio con ese pooler). | Local: usa PGlite en `.data/pgdata`. Vercel: error "Falta DATABASE_URL". `npm run verificar` avisa si no usa el puerto 6543. |
| `SUPABASE_URL` | URL del proyecto (Project Settings › Data API). Activa el almacenamiento en Supabase. | Archivos en disco local (`.data/uploads`). `npm run setup` se niega a seguir si hay `DATABASE_URL` sin `SUPABASE_URL`. |
| `SUPABASE_SECRET_KEY` | Clave secreta (`sb_secret_…`) para Storage. | Si hay `SUPABASE_URL` sin clave: error "Falta SUPABASE_SECRET_KEY.". |
| `SUPABASE_SERVICE_ROLE_KEY` | Alternativa a la anterior (clave antigua `service_role`). | Solo se usa si falta `SUPABASE_SECRET_KEY`. |
| `NOINDEX` | `1` = pedir a buscadores no indexar todo el sitio (demo). | Distinto de `1`: solo `/cms*` y `/api*` llevan `noindex`. |
| `STATS_TZ` | Zona horaria para agrupar estadísticas por día y hora. | `America/Lima`. |
| `PORT` | Puerto local. | 3000. |
| `LOCAL_DATA_DIR` | Carpeta de la base y archivos locales. Existe para que el empaquetador de Vercel no incluya esa carpeta (la ruta se lee de una variable). | `.data`. No hace falta definirla. |
| `PGLITE_MODULE` | Nombre del módulo PGlite, leído en tiempo de ejecución para que Vercel no empaquete PGlite. | `@electric-sql/pglite`. No hace falta definirla. |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Si existen al ejecutar `npm run setup` (cuando carga datos), reemplazan el usuario/contraseña de `client.json`. Útil para no usar la contraseña de demo. | Se usa `client.json` → `admin`. |
| `VERCEL` | La define Vercel. Activa el modo producción (cookie `secure`, caché de plantillas, exigencias de `SESSION_SECRET` y `DATABASE_URL`). | Modo local. |
| `VERCEL_GIT_COMMIT_SHA` | La define Vercel. Sus 10 primeros caracteres versionan `cms.css`/`cms.js` (`?v=`). | Se usa la hora de arranque. |
| `NODE_ENV` | `production` activa el modo producción fuera de Vercel. | Modo desarrollo. |

En Vercel, las variables se cargan en Project › Settings › Environment Variables. **Cambiar una variable no afecta al despliegue en curso: hay que redesplegar** (comportamiento de Vercel).

---

<a id="s12"></a>
## 12. Despliegue (Vercel + Supabase + GitHub)

### 12.1 Cómo funciona `vercel.json`

Contenido (sin la línea `$schema`):

```json
{
  "framework": null,
  "outputDirectory": "public",
  "functions": { "api/index.ts": { "includeFiles": "{templates,db}/**", "maxDuration": 15 } },
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }]
}
```

- `framework: null` → sin framework (en el panel de Vercel: **Framework Preset: Other**). No hay script `build` en `package.json`.
- `outputDirectory: "public"` → lo que está en `public/` se publica como **estático en la CDN**. Por eso `/assets/cms/cms.js` y `cms.css` no pasan por la función.
- `functions["api/index.ts"]` → Vercel compila `api/index.ts` (TypeScript) como **una función serverless** que contiene toda la app Express.
  - `includeFiles: "{templates,db}/**"` → copia las plantillas HTML (que se leen del disco con `fs`) y `db/schema.sql` dentro del paquete.
  - `maxDuration: 15` → cada petición puede durar hasta 15 s.
- `rewrites` → **toda ruta** que no corresponda a un archivo estático va a `/api` (la app Express decide qué hacer). Vercel revisa primero el sistema de archivos (estáticos) y luego aplica el rewrite. [Código: salida local de `vercel build` en `.vercel/output/config.json`, `"handle": "filesystem"` antes del rewrite]

### 12.2 `engines.node = "24.x"`

Vercel elige la versión de Node de la función según `engines` (la salida local de `vercel build` muestra `runtime: nodejs24.x`). [Código: `.vercel/output/functions/api/index.func/.vc-config.json`] El proyecto se desarrolló con Node 24 (en el PC del autor hay v24.19.0). El motivo exacto de fijarla en 24 no está escrito; lo razonable es usar en producción la misma versión que en desarrollo. [Suposición] El README dice que en local basta Node 20 o superior (`process.loadEnvFile`, usado para leer `.env`, existe desde Node 20.12/21.7).

### 12.3 Tamaño del paquete

- Según el autor, el paquete de la función bajó de **32 MB a 11 MB** al evitar que Vercel empaquetara PGlite (que es solo de desarrollo) y la carpeta `.data`. [Reportado]
- Mecanismo [Código]: la ruta de `.data` sale de `LOCAL_DATA_DIR` y el nombre del módulo PGlite de `PGLITE_MODULE`, ambos leídos en tiempo de ejecución, así el analizador de dependencias de Vercel no los sigue. Un intento con `excludeFiles` en `vercel.json` no tuvo efecto ([sección 18](#s18)).
- Observación: la salida local de `vercel build` (20-oct) pesa 11 MB, **no** contiene PGlite y sí contiene `.data/uploads` (≈ 5.2 MB: PDF/imágenes de prueba locales, sin la base). Esa carpeta solo existe en el PC del autor; en un despliegue hecho por Vercel desde GitHub no existe (está en `.gitignore`). [Código + Suposición sobre el método de despliegue usado]

### 12.4 Ciclo de publicación

`git push` a `main` → Vercel (integración con GitHub) construye y publica automáticamente. **Los cambios hechos en el panel no necesitan despliegue**: viven en Supabase. Vercel **no ejecuta las pruebas** al desplegar (no hay script `build`/`test` en el despliegue).

### 12.5 Paso a paso desde cero (resumen del README, verificado contra el código)

**A. Supabase**
1. https://supabase.com/dashboard → New project. Guardar la **Database password**. Región sugerida en el README: East US (North Virginia), cercana a la región por defecto de Vercel.
2. Reunir:
   - `DATABASE_URL`: botón **Connect** › Connection string › **Transaction pooler** (puerto **6543**); reemplazar `[YOUR-PASSWORD]`.
   - `SUPABASE_URL`: Project Settings › **Data API** › Project URL.
   - `SUPABASE_SECRET_KEY`: Project Settings › **API Keys** › Secret key (o `service_role` en proyectos antiguos).
3. Copiar `.env.example` a `.env` y completar (incluido `SESSION_SECRET`).
4. Asegurarse de tener `clients/<id>/seed/` con los archivos.
5. `npm install` y `npm run setup` (tablas, bucket `media`, datos iniciales, sube PDF/logo/fondo).
6. `npm run verificar` (debe terminar en "Todo correcto.").
7. Opcional: `npm run dev` para probar contra Supabase (dice `base: Supabase`).

No hace falta pegar SQL a mano; `db/schema.sql` también puede pegarse en el SQL Editor si se prefiere.

**B. GitHub**: repositorio **privado**, `git push` del código (`.env`, `.data`, `seed/` no suben).

**C. Vercel**
1. https://vercel.com/new → Import del repositorio.
2. **Framework Preset: Other**; no cambiar Build ni Output (lo define `vercel.json`).
3. Variables: `CLIENT_ID`, `SESSION_SECRET`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `NOINDEX` (1 mientras sea demo), `STATS_TZ`.
4. Deploy. Probar `/` y `/cms_login`.
5. **Cada vez que se cambie una variable: Redeploy.**

**D. Dominio propio (opcional)**: Vercel › Settings › Domains, agregar por ejemplo `cartas.intursa.com.pe` y pedir al administrador del DNS el registro CNAME que Vercel indique.

---

<a id="s13"></a>
## 13. Cómo agregar un cliente nuevo (multi-cliente)

[Decisión] **Un proyecto de Supabase y uno de Vercel por cliente**, mismo repositorio; solo cambian las variables. Así los datos quedan realmente separados (base, archivos, claves, usuarios). Todas las tablas llevan `client_id` por si alguna vez se prefiere compartir un proyecto de Supabase entre clientes.

Pasos:
1. Copiar `clients/intursa/` como `clients/<nuevo-id>/` (el id en minúsculas, sin espacios; se usa en rutas de archivos y en expresiones regulares).
2. Editar `client.json`: `id` (= carpeta), `name`, `admin` (usuario y contraseña iniciales; mejor usar `ADMIN_USERNAME`/`ADMIN_PASSWORD` al hacer setup), `settings`, `assets`, `buttons` (`label` + `pdf` o `url`, opcional `new_tab`), `socials`.
3. Poner logo, fondo y PDF en `seed/` y `seed/pdf/`.
4. Crear **otro** proyecto de Supabase.
5. Con un `.env` apuntando a ese proyecto y `CLIENT_ID=<nuevo-id>`: `npm run setup` y `npm run verificar`.
6. Crear **otro** proyecto en Vercel desde el mismo repositorio, con sus variables.
7. Hacer commit de `clients/<nuevo-id>/client.json` (la carpeta `seed/` no sube).

**Si el cliente tiene otro diseño**: hoy hay **una sola plantilla** (`templates/pagina.html`) para todos. Opciones: (a) reemplazar el archivo (afectaría a todos los clientes del mismo repositorio), o (b) — mejor — cambiar `loadTemplate`/`renderPage` para buscar `clients/<id>/pagina.html` si existe (cambio pequeño de código, **no implementado**) e incluir esa carpeta en `includeFiles` de `vercel.json`. La nueva plantilla debe usar los mismos marcadores (`{{titulo_pagina}}`, `{{{botones_html}}}`, `{{{redes_html}}}`, `{{{fondo_imagen_css}}}`, colores, etc.).

**Límites del enfoque:**
- El panel y el modelo de datos son los mismos para todos: sirve para páginas "tipo enlaces/cartas" (botones + novedades + redes). Un cliente que necesite otras secciones requiere desarrollo.
- Cada cliente suma un proyecto de Supabase y uno de Vercel (costo y administración por cliente; ver [sección 17](#s17)).
- Una mejora llega a todos con un `git push`, pero también un error: conviene probar antes (`npm test`) y considerar entornos de prueba (Preview de Vercel).
- Cambios de esquema de base requieren ejecutar `npm run setup` contra **cada** proyecto de Supabase.

---

<a id="s14"></a>
## 14. Pruebas

### 14.1 Cómo correrlas

```bash
npm test          # Vitest: usa PGlite en memoria y almacenamiento simulado. No toca Supabase ni .data.
npm run typecheck # tsc --noEmit
```

### 14.2 Resultado real (ejecutado el 2026-10-22 al preparar este documento)

- **49 pruebas en 3 archivos**: `unit.test.ts` 13, `api.test.ts` 33, `postgres-driver.test.ts` 3.
- **Primera ejecución: 47 pasaban y 2 fallaban**, ambas en `tests/api.test.ts` ("muestra los 9 botones…" y "redes: agregar, editar…"). Causa: el cambio local de `clients/intursa/client.json` (enlaces de Facebook e Instagram) hacía que las redes ya tuvieran enlace, y esas pruebas suponían redes vacías.
- **Corregido el mismo día**: el `beforeAll` de `tests/api.test.ts` ahora deja las redes sin enlace después de cargar los datos iniciales, así las pruebas no dependen de lo que traiga `client.json`. **Resultado actual verificado: 49 de 49 pasan** (3 archivos).
- `npm run typecheck`: **sin errores**.
- Ese arreglo de `tests/api.test.ts` también es un cambio local aún sin commit: se sube junto con el de `client.json`.

### 14.3 Qué cubre cada archivo

**`tests/unit.test.ts`**: clasificación de dispositivo (iPhone, Android, tablet Android, iPad con "iPad" en el UA, Windows, Mac), pista `Sec-CH-UA-Mobile`; `shouldCount` (navegador real, bots conocidos, sin UA, HEAD, precarga); motor de plantilla (escape, crudo, condicionales); `escapeHtml`; `safeFileName`.

**`tests/api.test.ts`** (aplica el esquema dos veces para probar que es idempotente y carga los datos de Intursa):
- Página pública: 9 botones en orden con `/go/`, logo, fondo, novedades, sin marcadores sin reemplazar; `/go/` lleva al PDF subido.
- Acceso: `/cms` sin sesión → login; API 401; login `noindex`; contraseña incorrecta y usuario inexistente con el mismo mensaje; login sin distinguir mayúsculas; cookie `HttpOnly`; escritura desde otro origen → 403; cookie manipulada → 401.
- Tracking: celular, tablet, computadora; ignora Googlebot, WhatsApp, sin UA, prefetch, HEAD; ids inválidos; botón oculto no redirige ni cuenta; periodos 7/90; CSV; columnas de `clicks` sin datos personales.
- Botones: crear oculto; no activar sin destino; rechaza `javascript:`, `data:`, `ftp:`, comillas; nombre vacío; campo desconocido; publicar con enlace; XSS escapado; pestaña nueva; reordenar; reemplazar PDF borra el anterior; eliminar conserva historial "(eliminado)".
- Subidas: tipo, tamaño, extensión, SVG rechazado, propósito inválido; nombre saneado; path traversal bloqueado.
- Apariencia: colores y textos; valores inválidos (CSS inyectado, `javascript:`, clave desconocida, `fondo_tipo` inválido); ocultar novedades; fondo de color; redes completas (agregar, editar, ordenar, ocultar, quitar, red inválida); vista previa sin tracking.
- Cuenta: borrar estadísticas exige confirmación; cambiar contraseña; bloqueo tras 5 intentos; cerrar sesión.

**`tests/postgres-driver.test.ts`**: el conector de producción (postgres.js, con `prepare: false`) contra un Postgres real por red (PGlite expuesto por socket): tipos correctos (booleanos y números, no texto), registro de clics y estadísticas, reordenar y guardar ajustes en lote (la corrección `::text::jsonb`).

### 14.4 Qué NO se probó automáticamente

- La **subida directa a Supabase Storage** con URL firmada solo se valida con `npm run verificar` contra un proyecto real (las pruebas usan almacenamiento simulado).
- El comportamiento de `waitUntil` en Vercel (las pruebas siempre esperan la escritura).
- **No hay pruebas end-to-end en navegador** (Playwright/Cypress): la interfaz del panel (`cms.js`), el arrastre, la vista previa y la versión móvil se probaron manualmente.
- No hay pruebas de carga ni de rendimiento.
- No hay auditoría de accesibilidad automatizada.
- Las pruebas requieren los archivos de `clients/intursa/seed/` (no están en GitHub).

---

<a id="s15"></a>
## 15. Integración con el WordPress de Intursa

El CMS **no es un plugin de WordPress**: corre aparte (Vercel + Supabase) y no modifica WordPress. Opciones, de más a menos recomendada:

### 15.1 Subdominio con CNAME (recomendada)

- Ej.: `cartas.intursa.com.pe` → registro CNAME hacia Vercel (Vercel indica el valor exacto) y se agrega el dominio en Vercel › Settings › Domains. Vercel emite el certificado HTTPS.
- WordPress queda intacto. Opcionalmente, la URL vieja `/outlets-tambodelinka/` puede redirigir al subdominio.
- Funciona sin cambios de código (las rutas son absolutas desde la raíz y el control de origen compara contra el mismo host).
- Los códigos QR que apunten a la URL vieja siguen funcionando si se configura la redirección.

### 15.2 Redirección

- `intursa.com.pe/outlets-tambodelinka/` → 301 a la página nueva (con un plugin de redirecciones o una regla del servidor).
- Lo más rápido. El visitante termina viendo la dirección nueva (de Vercel o del subdominio).

### 15.3 Proxy inverso a la misma ruta

- El servidor o CDN de Intursa reenvía `intursa.com.pe/outlets-tambodelinka/` hacia Vercel, y el visitante ve siempre la dirección de Intursa.
- Requiere acceso a la infraestructura de Intursa (Nginx/Apache/Cloudflare, etc.).
- **Cuidados verificados en el código:**
  - La página usa rutas absolutas desde la raíz (`/go/<id>`, `/assets/…`, `/cms…`). Bajo una subruta, el proxy tendría que reenviar también `/go/*` o habría que adaptar el código para un prefijo de ruta (no implementado).
  - El panel compara el host de `Origin` con el `Host` recibido: si el proxy cambia el `Host`, **las escrituras del panel darían 403**. Lo sensato es publicar por proxy **solo la página pública y `/go/*`** y usar el panel en su dominio de Vercel o en el subdominio.

### 15.4 Iframe dentro de una página de WordPress

- Técnicamente posible: la página pública **no** envía `X-Frame-Options` (solo `/cms*` y `/api*` lo hacen).
- No recomendado: se ve el marco del tema, problemas de altura y desplazamiento en celular, y los botones sin "pestaña nueva" abrirían el PDF **dentro** del iframe. El tracking sí funcionaría.

### 15.5 Integración "headless"

**Qué es "headless" (sin cabeza):** un CMS donde el **panel y la base de datos (backend)** están separados de **la parte que el visitante ve (frontend)**. El backend no arma páginas: entrega los datos por una **API** (normalmente JSON) y otro sistema decide cómo mostrarlos.

Dos direcciones posibles:

| Dirección | Qué significa aquí | ¿Aplica? |
|---|---|---|
| **WordPress como backend headless** | Intursa editaría en `wp-admin` y nuestro servidor leería los datos de la API REST de WordPress para armar la página. | Contradice el pedido (CMS propio, sin WordPress) y se perderían el panel propio y su experiencia móvil. No recomendada. |
| **Nuestro CMS como backend headless, WordPress como frontend** | Se editaría en nuestro panel y WordPress pediría los datos a nuestra API para dibujar los botones dentro de su propio tema, en su propia URL. | **Es la que aplicaría** si Intursa quiere la página dentro de su WordPress. |

**Qué existe hoy y qué habría que construir** para la segunda dirección:
- **Hoy NO existe** una API pública de lectura. La única API (`/api/cms/*`) exige sesión de administrador.
- Habría que construir:
  1. Un endpoint público de **solo lectura**, por ejemplo `GET /api/public/page` que devuelva JSON con ajustes visibles, botones visibles (con su enlace de tracking **absoluto** `https://<dominio>/go/<id>` para no perder estadísticas) y redes. Con CORS si se consume desde el navegador, o sin CORS si lo consume el servidor de WordPress.
  2. En WordPress, un **shortcode** (pequeño plugin PHP) que pida ese JSON (`wp_remote_get`), lo guarde en caché unos minutos (transient) y dibuje el HTML con los estilos del tema.
- Consideraciones: la caché de WordPress puede retrasar que se vean los cambios; el diseño quedaría a cargo del tema de WordPress; sería trabajo nuevo no incluido en la propuesta actual.
- El autor mencionó en otra conversación un concepto "headless" relacionado con otro proyecto llamado "DFG". **No hay información sobre DFG en este repositorio; no inventar nada sobre él.** Si preguntan, decir que no se tiene ese contexto.

### 15.6 Qué no es posible

- **Inicio de sesión único (SSO) entre WordPress y el CMS**: son sistemas con usuarios separados (sería otro desarrollo; hoy no existe).
- **Que el panel viva dentro de `wp-admin`**: el panel es otra aplicación. Reconstruirlo como plugin de WordPress sería otro proyecto y contradice el pedido original.

---

<a id="s16"></a>
## 16. Límites, deuda técnica y mejoras posibles

### 16.1 Funcionales

| Límite | Propuesta |
|---|---|
| **Los clics en redes sociales NO se cuentan** (los íconos enlazan directo). | Pasarlos por un tracking similar (por ejemplo `/go/red/<id>`) y agregar en `clicks` un campo que distinga el tipo (`button`/`social`) o una tabla aparte. Requiere: cambio de `db/schema.sql`, cambios en `repo`/`app`/`render`/panel, `npm run setup` contra cada Supabase (el esquema es idempotente, pero un `alter table` nuevo habría que escribirlo), y `git push`. |
| Clics del enlace de "novedades" tampoco se cuentan. | Igual que el anterior. |
| No hay visitantes únicos. | Decisión de privacidad (ver FAQ). |
| Un solo administrador; sin roles, 2FA ni auditoría. | Tabla de usuarios con roles, TOTP, tabla `audit_log`. |
| Estadísticas sin comparación de periodos (ej. "esta semana vs la anterior"). | Agregar consulta del periodo anterior y variación %. |
| Sin varias páginas por cliente ni multilenguaje. | Desarrollo nuevo. |
| Una sola plantilla de diseño para todos los clientes. | Plantilla por cliente (ver [sección 13](#s13)). |
| Dos administradores editando a la vez: gana el último que guarda; el panel no se refresca con cambios de otro. | Recarga periódica del estado o control de versiones por fila. |

### 16.2 Técnicos / deuda

| Tema | Detalle |
|---|---|
| Archivos huérfanos en Storage | Logo y fondo reemplazados o quitados no se borran; tampoco un PDF subido si falla el guardado posterior; `setup --force` vuelve a subir todo. Crece despacio; se puede limpiar con un script. |
| Pruebas dependen de `client.json` y de `seed/` | Sin `seed/` (no está en GitHub) no corren en un clon limpio. Conviene datos de prueba propios. |
| Sin pruebas de interfaz en navegador | Agregar Playwright para los flujos críticos. |
| Sin CSP ni SRI | Agregar `Content-Security-Policy` y `integrity` en los scripts de CDN (o servirlos desde `public/`). |
| Sin rate limit por IP | Agregar límite en `/api/login` y quizá en `/go/` (por ejemplo con un almacén externo; en serverless no sirve la memoria). |
| Peculiaridad del motor de plantilla | El reemplazo de `{{x}}` se hace después de insertar el HTML crudo, así que un nombre de botón que contenga literalmente `{{titulo_pagina}}` mostraría el valor de ese ajuste (escapado; **no** es un riesgo de XSS). Verificado con un script. |
| Mayúsculas en usuarios | El login no distingue mayúsculas pero la restricción `unique` sí; dos usuarios que solo difieran en mayúsculas serían ambiguos (no ocurre hoy). |
| Reglas de tamaño | 5 MB/8 MB de logo/fondo se validan sobre el tamaño declarado; el bucket permite 25 MB para todo. |

### 16.3 Escalado de la tabla `clicks` (análisis)

- Índices existentes: `(client_id, clicked_at desc)` y `(button_id)`. Adecuados para insertar y para la mayoría de las consultas por periodo.
- **Consultas que recorren todo el historial** del cliente en cada refresco del panel (cada 8 s mientras Estadísticas está abierta):
  - el total histórico (`count(*)` sin filtro de fecha);
  - la serie "por día", que une por `(clicked_at at time zone …)::date = d` **sin** filtrar por el inicio del periodo, así que no aprovecha bien el índice.
- Estimación ilustrativa (no medida): con 1 000 clics/día serían ~365 000 filas/año (filas pequeñas: decenas de MB). Postgres lo maneja sin problema durante años, pero esas dos consultas se irán volviendo más lentas linealmente. [Suposición]
- Mejoras sencillas: agregar `and c.clicked_at >= <inicio del periodo>` en la consulta diaria; calcular el total histórico con menos frecuencia o mantener una tabla de totales diarios; definir retención o archivo de clics antiguos.
- Conexiones: postgres.js usa **1 conexión por instancia** de la función y el Transaction pooler de Supabase reparte; las 6 consultas de estadísticas se ejecutan en serie sobre esa conexión.

### 16.4 Operación

- **Copias de seguridad**: no hay política definida. El plan gratuito de Supabase no ofrece las mismas garantías que el de pago. Falta definir copias diarias (plan de pago) **más** una exportación propia periódica (`pg_dump` + copia del bucket). [Pendiente]
- **Monitoreo**: existe `/api/health`, pero no hay alertas configuradas. [Pendiente]
- **Entornos**: no hay un entorno de staging separado con su propia base. [Pendiente]

---

<a id="s17"></a>
## 17. Pendientes antes de producción

- [ ] **Planes de pago**: **Vercel Pro** (el plan Hobby es para uso no comercial) y **Supabase Pro** (el gratuito se pausa tras ~7 días sin actividad y no ofrece las mismas copias de seguridad). **Verificar precios y condiciones vigentes**; no dar cifras sin verificarlas.
- [ ] **Mover Supabase** de la cuenta personal del autor a una **organización de FORST** (o crear un proyecto nuevo allí y migrar datos y archivos).
- [ ] **Dominio o subdominio** definitivo (ver [sección 15](#s15)).
- [ ] **Cambiar la contraseña de demo** del panel (menú de cuenta › Cambiar contraseña). Recordar que también figura en `README.md` y `client.json`.
- [ ] **Rotar la clave secreta de Supabase y la contraseña de la base** (se compartieron en un chat durante el desarrollo) y actualizar `SUPABASE_SECRET_KEY` y `DATABASE_URL` en Vercel → **Redeploy**. Considerar también rotar `SESSION_SECRET` (cerraría todas las sesiones).
- [ ] **Borrar las estadísticas de prueba** (Estadísticas › Borrar estadísticas, o `npm run setup -- --borrar-clics` con mucho cuidado).
- [ ] **`NOINDEX=0`** en Vercel y redesplegar, para que Google indexe la página.
- [ ] **Política de copias de seguridad** (y prueba de restauración).
- [ ] **Completar redes** (si el cliente quiere más que Facebook e Instagram, desde el panel).
- [ ] **Hacer commit y `git push` de los dos cambios locales**: `clients/intursa/client.json` (redes oficiales) y `tests/api.test.ts` (pruebas ajustadas para no depender de él). Se pueden subir juntos.
- [ ] Decidir si `GUIA-REUNION-TI.md`, `RESUMEN-PROYECTO.md` y este archivo se suben al repositorio (no tienen secretos, pero sí información interna).
- [ ] Definir quién da soporte, tiempos de respuesta y quién administra dominio y cuentas.
- [ ] Revisión legal de la política de privacidad del cliente (mencionar registros técnicos de Vercel/Supabase).

---

<a id="s18"></a>
## 18. Problemas encontrados y resueltos durante el desarrollo

Historial útil para anticipar fallos. La causa la contó el autor [Reportado]; donde se indica, hay evidencia en el código.

| # | Problema | Causa | Solución (evidencia) |
|---|---|---|---|
| 1 | Listas JSON con doble codificación al usar postgres.js (falla en `jsonb_array_elements`) | Al pasar un texto JSON como parámetro tipado `jsonb`, el conector lo volvía a serializar como cadena JSON. | Recibir el parámetro como texto y convertirlo en SQL: `$2::text::jsonb` [Código: `saveSettings` y `reorder` en `src/repo.ts`; prueba en `postgres-driver.test.ts`]. |
| 2 | El botón flotante de vista previa se veía mal | Se llamaba `.fab`, que también es una clase de **Font Awesome** (íconos de marcas) y heredaba su tipografía. | Renombrado a `.preview-fab` [Código: `cms.css`, `cms.html`]. |
| 3 | Aparecía el texto "null" en listas del panel | `replaceChildren` convierte `null` en el texto "null" cuando un hijo condicional no existe. | Función `fill()` que descarta `null`/`false` [Código: `cms.js`]. |
| 4 | Interruptor Visible/Oculto desincronizado | El estado visual no siempre coincidía con `b.active` (por ejemplo, al rechazar el servidor). | `refreshHead` sincroniza el interruptor y se revierte si la escritura falla [Código: `buttonItem` en `cms.js`]. |
| 5 | El navegador usaba una versión vieja de `cms.js`/`cms.css` tras un despliegue | Caché del navegador/CDN. | Versión `?v=` con los 10 primeros caracteres del commit (`VERCEL_GIT_COMMIT_SHA`) [Código: `ASSET_V` en `src/app.ts`]. |
| 6 | Base local corrupta (página local sin botones) | **Dos procesos** usando PGlite a la vez (por ejemplo, dos `npm run dev`, o `setup` con el servidor encendido). PGlite admite un solo proceso. | Regla: un proceso a la vez. Recuperación: cerrar todo, borrar `.data/` y volver a `npm run dev` (se recrea) [Código: README y comentario en `scripts/setup.ts`]. No aplica a Supabase. |
| 7 | `getContext` no estaba exportado en `@vercel/functions` | Versión de la librería. | Se lee directamente el símbolo `Symbol.for('@vercel/request-context')` que expone el runtime; `@vercel/functions` no es dependencia [Código: `afterResponse` en `src/app.ts`, `package.json`]. |
| 8 | `excludeFiles` en `vercel.json` no tenía efecto (PGlite y `.data` se empaquetaban; ~32 MB) | El analizador de Vercel seguía las rutas literales. | Leer la ruta y el nombre del módulo desde variables (`LOCAL_DATA_DIR`, `PGLITE_MODULE`); paquete ~11 MB [Código: `src/env.ts`, `src/db.ts`]. |
| 9 | Tripadvisor sin logo | Font Awesome gratuito ya no incluye el logo de Tripadvisor. | Ícono genérico `fa-solid fa-star-half-stroke` [Código: `src/networks.ts`]. |

---

<a id="s19"></a>
## 19. Preguntas frecuentes (FAQ)

> Respuestas basadas en el código. Las incertidumbres están marcadas.

**1. ¿Dónde viven los datos?**
Contenido (textos, botones, redes, colores), usuarios y clics: en **Supabase Postgres**. PDF, logo y fondo: en **Supabase Storage** (bucket `media`). El código: en GitHub (privado). Vercel solo ejecuta el código; no guarda datos. Hoy el proyecto de Supabase está en una cuenta personal del autor; se moverá a una organización de FORST. La región exacta del proyecto no está en el código (el README recomienda East US). [Suposición sobre la región]

**2. ¿Qué pasa si Vercel o Supabase se caen?**
Si cae Vercel, la página y el panel no responden. Si cae Supabase, la página no puede armarse (error 500) y los PDF no abren. No hay modo de respaldo automático ni caché de la página (es `no-store` a propósito). La disponibilidad depende de los acuerdos de servicio de cada proveedor (verificar en sus planes de pago).

**3. ¿Y si suben de precio o queremos irnos?**
Es portable: **Node.js + Postgres estándar**, sin funciones propietarias en la lógica. Se puede llevar a cualquier hosting con Node (o un servidor propio) y a cualquier Postgres. La base se exporta con `pg_dump`; los archivos se descargan del bucket. Habría que reemplazar el módulo de almacenamiento si no se usa Supabase Storage (está aislado en `src/storage.ts`) y **definir siempre `SESSION_SECRET`** fuera de Vercel.

**4. ¿Hay copias de seguridad?**
Hoy no hay una política definida. Depende del plan de Supabase (el gratuito no da las mismas garantías). Para producción: plan de pago con copias diarias + exportación propia periódica. [Pendiente]

**5. ¿Cuánto tráfico soporta?**
Vercel escala automáticamente (serverless) y la base usa el pooler de Supabase. Una página de cartas de hotel está muy por debajo de los límites. Cada clic es una inserción pequeña. No se hicieron pruebas de carga. [Suposición razonable]

**6. ¿Es seguro el login?**
Contraseñas con bcrypt, cookie `httpOnly`/`secure`/`sameSite`, sesión firmada de 12 h, bloqueo 15 min tras 5 intentos, mensajes que no revelan usuarios, verificación de origen. Limitaciones: bloqueo por usuario (no por IP), sin 2FA, sin revocación de sesiones.

**7. ¿Por qué no WordPress?**
El pedido fue explícito: CMS propio, sin WordPress ni plugins. Además, la página necesita pocas funciones y estadísticas sin datos personales; WordPress trae mucho más de lo necesario y más mantenimiento (núcleo, tema, plugins) y superficie de ataque.

**8. ¿Cuántas personas únicas entran?**
No se puede saber: se cuentan **clics, no personas**. Para distinguir personas habría que usar cookies o IP, y se decidió no hacerlo por privacidad (Ley 29733). Una misma persona que abre 3 cartas suma 3 clics.

**9. ¿Es un problema que los PDF sean públicos?**
Las cartas son públicas por naturaleza (cualquiera las ve en la página). Cualquiera con el enlace puede abrirlas, pero **solo el servidor** puede autorizar subidas o borrar archivos.

**10. ¿Puede el cliente romper el diseño?**
No la estructura: solo edita textos, enlaces, colores, logo y fondo. Sí podría elegir colores poco legibles (por ejemplo texto blanco sobre botón blanco); para eso está "Restablecer".

**11. ¿Cómo se cambia la contraseña?**
En el panel: menú de cuenta (círculo con la inicial) › Cambiar contraseña. Si se olvidó: no hay "recuperar contraseña"; FORST puede restablecerla con `npm run setup` usando `ADMIN_USERNAME`/`ADMIN_PASSWORD`… **pero solo si el cliente está vacío o con `--force`** (que además recarga contenido). Lo más seguro es un `UPDATE` puntual del hash en la base hecho por FORST. [Pendiente: no existe una herramienta específica]

**12. ¿Cómo se agrega un cliente?**
Ver [sección 13](#s13): carpeta en `clients/`, proyecto de Supabase y de Vercel propios, `npm run setup`, `npm run verificar`.

**13. ¿Cuánto cuesta mantenerlo?**
Infraestructura: planes de Vercel y Supabase por cliente (verificar precios vigentes; no dar cifras). Trabajo: actualizar dependencias (7 de producción), revisar vulnerabilidades, atender cambios. El precio de la suscripción es una decisión comercial de FORST que no está en este proyecto.

**14. ¿Quién da soporte?**
Se asume FORST, que desarrolló el sistema; los términos (horarios, tiempos de respuesta) **no están definidos** aún. [Pendiente]

**15. ¿Cumple la Ley 29733?**
El tracking está diseñado para no tratar datos personales de visitantes: no guarda IP, cookies, User-Agent ni identificadores. Los proveedores (Vercel, Supabase, y los CDN de fuentes/íconos) pueden registrar IP en sus propios registros técnicos. Recomendable mencionarlo en la política de privacidad y que lo valide legal. No es una opinión legal.

**16. ¿Qué datos ven Vercel y Supabase?**
Vercel procesa las peticiones (y sus registros técnicos pueden incluir IP y User-Agent). Supabase almacena la base (contenido, hashes de contraseñas, clics agregados por botón/dispositivo) y los archivos, y sirve los PDF a los visitantes. [Suposición sobre el detalle de sus registros]

**17. ¿Se puede usar nuestro dominio?**
Sí: subdominio con CNAME (recomendado), redirección o proxy inverso (ver [sección 15](#s15)).

**18. ¿Qué pasa si dos administradores editan a la vez?**
Hoy hay un solo usuario por cliente, pero la misma cuenta puede abrirse en dos dispositivos. Cada cambio se guarda por campo; **gana el último que guarda**. El panel no se actualiza solo con cambios hechos en otro dispositivo (hay que recargar). No hay bloqueos ni historial.

**19. ¿Qué pasa si se sube un PDF malicioso?**
Solo un administrador autenticado puede subir. Se valida tipo declarado, tamaño y extensión, pero **no se analiza el contenido ni hay antivirus**. El archivo se sirve desde el dominio de Supabase (no desde el del CMS), así que no puede afectar la sesión del panel. El riesgo sería para quien lo descargue, igual que con cualquier PDF publicado en WordPress.

**20. ¿Hay modo offline?**
No. Sin conexión no se puede editar ni ver la página (no hay Service Worker ni caché local).

**21. ¿Y el SEO?**
Título y meta descripción editables, HTML liviano y sin JavaScript en la página pública, `alt` del logo. Mientras sea demo, `NOINDEX=1` pide no indexar; en producción `NOINDEX=0`. No hay sitemap, datos estructurados ni etiquetas Open Graph para compartir en redes. [Pendiente opcional] Los enlaces `/go/<id>` son redirecciones 302 (los buscadores no las cuentan como clics; los bots se excluyen).

**22. ¿La página es rápida?**
Es un HTML pequeño armado en cada visita (3 consultas a la base) más fuentes, íconos, logo y fondo (753 KB). No hay caché de página para que los cambios se vean al instante; si hiciera falta más velocidad se podría cachear unos segundos. No se midió con herramientas de rendimiento. [Suposición]

**23. ¿El tracking hace más lenta la apertura del PDF?**
Mínimamente: en Vercel la escritura del clic no se espera (se completa después de responder). Hay una consulta para buscar el botón antes de redirigir.

**24. ¿Cuentan los clics de la vista previa del panel o de bots?**
No. La vista previa enlaza directo al PDF; los bots, precargas y peticiones HEAD se descartan.

**25. ¿Por qué un iPad aparece como computadora?**
Desde iPadOS 13, Safari en iPad se identifica como Mac de escritorio. Sin JavaScript ni huellas del dispositivo (que no usamos por privacidad) el servidor no puede distinguirlos.

**26. ¿Se pueden ver los datos en Excel?**
Sí: "Exportar CSV" (agregado por día, botón y dispositivo, para el periodo elegido).

**27. ¿Se pueden borrar las estadísticas?**
Sí, todas a la vez, escribiendo BORRAR. No se puede deshacer ni borrar solo un periodo.

**28. ¿El código es de Intursa?**
La propiedad intelectual y el modelo (suscripción) son una decisión comercial no definida en el proyecto. El código está en el GitHub de FORST. [Pendiente de acuerdo]

**29. ¿Qué tecnologías usa?**
Node.js 24, TypeScript, Express 5, postgres.js, Supabase (Postgres + Storage), bcryptjs, jose, zod, isbot; panel en HTML/CSS/JS sin framework con SortableJS y Chart.js; pruebas con Vitest y Supertest; PGlite para desarrollo local.

**30. ¿Por qué Node y no Python?**
El autor propuso Python/FastAPI (habría sido viable). Se eligió Node porque Vercel lo ejecuta de forma nativa y arranca más rápido en frío, algo que importa en la redirección del tracking.

**31. ¿Por qué Supabase y no una base en el mismo servidor (SQLite)?**
Vercel no tiene disco persistente: un archivo SQLite se perdería. Supabase se usa solo como infraestructura (base y archivos); el panel, el login y la lógica son código propio, así que sigue siendo un "CMS propio".

**32. ¿Por qué login propio y no Supabase Auth?**
Para no depender de un servicio de terceros en la lógica del CMS (requisito de "CMS propio"), mantener todo en el mismo servidor y simplificar: un solo administrador por cliente con bcrypt y cookie firmada.

**33. ¿Se puede auditar quién hizo un cambio?**
No en esta versión.

**34. ¿Qué pasa si el proyecto gratuito de Supabase se pausa?**
La página y el panel dejan de funcionar hasta reactivarlo desde el panel de Supabase. Por eso producción requiere plan de pago. Verificar antes de cada demo.

---

<a id="s20"></a>
## 20. Guion de demostración y checklist previo

### 20.1 Checklist antes de la reunión

- [ ] Abrir https://cms-tambo-del-inka.vercel.app/ : que cargue con los 9 botones, logo, fondo y redes.
- [ ] Verificar que el **proyecto gratuito de Supabase no esté pausado** (si se pausó, reactivarlo desde el dashboard; tarda unos minutos). Una forma rápida: abrir `/api/health` y ver `{"ok":true,...}`.
- [ ] Entrar al panel (`/cms_login`) con el usuario de demo (ver `client.json` → `admin`) **antes** de la reunión; si alguien falló 5 veces, el bloqueo dura 15 min.
- [ ] Abrir un PDF de prueba listo en el dispositivo para la demostración de "Reemplazar" (y tener el PDF original para restaurarlo).
- [ ] Dejar el celular con la URL pública abierta y buena conexión.
- [ ] Decidir si se mostrarán estadísticas de prueba o se borran antes (no se pueden recuperar).
- [ ] No mostrar el archivo `.env`, el dashboard de Supabase con claves ni las variables de Vercel en pantalla.

### 20.2 Guion (5–7 minutos)

1. **Página pública** en celular y escritorio (en escritorio los botones van en dos columnas): mostrar el diseño y tocar un botón → abre la carta.
2. **Panel**: ir a `/cms_login` (mencionar que la página pública no tiene enlace al panel) e ingresar.
3. **Botones**: abrir uno, cambiar el nombre, recargar la página pública en otra pestaña → cambio al instante. Devolver el nombre original.
4. **Ocultar** un botón con el interruptor y volver a mostrarlo.
5. **Subir carta**: "Reemplazar" en un botón con un PDF de prueba; mostrar la barra de progreso. **Restaurar** el original al final (el PDF anterior se borra al reemplazar, así que hay que tener el original a mano).
6. **Diseño**: cambiar un color y ver la vista previa en vivo; "Restablecer".
7. **Estadísticas**: desde un celular tocar 2–3 botones y ver cómo aparecen en vivo (refresco cada 8 s) en la pestaña Datos/Estadísticas.
8. Mencionar: sin datos personales, bots excluidos, exportación a CSV.
9. Cerrar con el **modelo multi-cliente** y las **opciones de integración con WordPress** (subdominio recomendado).

### 20.3 Cierre sugerido para la reunión

1. Confirmar la dirección final (subdominio, redirección o proxy).
2. Definir quién administra el dominio y el hosting.
3. Acordar planes de pago, copias de seguridad y soporte.
4. Decidir si se suma el conteo de clics en redes y/o la integración headless con WordPress.

---

<a id="s21"></a>
## 21. Guía para el Claude que lea esto

### 21.1 Cómo responder

- **En español**, claro y directo.
- Si quien pregunta **no es técnico** (gerente, comercial), responde sin jerga: usa la analogía del molde y los datos ([sección 3](#s3)), y ofrece el detalle técnico si lo pide ("¿quieres que te explique cómo funciona por dentro?").
- Si es técnico, cita archivos y funciones (por ejemplo "`src/auth.ts`, función `login`").
- Distingue siempre: hecho verificado en el código / decisión con su motivo / limitación / suposición. Si algo no está en este documento ni en el código, **dilo** ("no lo sé; habría que verificarlo con el autor").
- Sé honesto con las limitaciones ([sección 16](#s16)); es mejor que el equipo las diga antes de que TI las descubra.
- Para precios de Vercel/Supabase: **no des cifras**; indica que hay que verificar los precios vigentes en sus sitios.

### 21.2 Qué NO hacer

- **No inventar** rutas, tablas, números ni funciones. No inventar nada sobre "DFG".
- **No pedir, leer, mostrar ni repetir** claves, contraseñas ni el contenido del archivo `.env`. Si alguien pega una clave en el chat, recomendar rotarla.
- **No repetir la contraseña de demo**; indicar que está en `clients/intursa/client.json` (campo `admin`) y que debe cambiarse.
- **No ejecutar contra producción** (cuando el `.env` apunta a Supabase) sin autorización explícita y clara del usuario:
  - `npm run setup -- --force` → **borra y recarga** botones, redes y ajustes desde `client.json` (se pierden todas las ediciones del panel; los botones cambian de id, así que los clics anteriores quedan como "(eliminado)"; se vuelven a subir los archivos) y **restablece la contraseña del administrador** a la de `client.json` (o `ADMIN_PASSWORD`).
  - `npm run setup -- --borrar-clics` → **borra todas las estadísticas**.
- **No modificar la base de producción** directamente (SQL, scripts) ni el bucket sin autorización.
- No hacer `git push` ni cambiar variables de Vercel sin que el usuario lo pida.
- No ejecutar dos procesos sobre la base local a la vez (PGlite admite uno solo).

### 21.3 Comandos útiles (con advertencias)

| Comando | Qué hace | Advertencia |
|---|---|---|
| `npm install` | Instala dependencias. | — |
| `npm run dev` | Servidor local con recarga (`tsx watch src/server.ts`) en http://localhost:3000. Sin `DATABASE_URL` usa base local `.data/` (se crea sola con los datos de `client.json`). | **Si el `.env` tiene `DATABASE_URL`, trabaja contra la base de producción**: lo que edites en el panel local cambia la página publicada. Necesita `clients/intursa/seed/`. Un solo proceso a la vez en modo local. |
| `npm start` | Igual que `dev` sin recarga automática. | Igual. |
| `npm test` | 49 pruebas con base en memoria. Seguro (no toca Supabase ni `.data`). | Hoy pasan las 49 (ver [14.2](#s14)). Necesita `seed/`. |
| `npm run typecheck` | Revisión de tipos (`tsc --noEmit`). | Seguro. |
| `npm run setup` | Crea tablas y bucket; carga datos **solo si el cliente está vacío**. | Contra producción es "seguro" si ya hay datos (no recarga), pero aplica el esquema y ajusta el bucket. Con `--force` o `--borrar-clics`: ver 21.2. En modo local, detener antes `npm run dev`. |
| `npm run verificar` | Revisa la instalación con Supabase (variables, conexión, tablas, datos, admin, PDF públicos, subida de prueba que luego borra). | Hace una subida y un borrado de un archivo de prueba en el bucket real. Sin `DATABASE_URL` no hace nada. |

### 21.4 Si preguntan por el estado de producción

No se puede ver desde el código. Lo que se sabe es lo [Reportado] por el autor (sección 1). Para confirmarlo: abrir la URL pública, `/api/health`, o pedir al autor que ejecute `npm run verificar`.

---

<a id="s22"></a>
## 22. Glosario

| Término | Significado |
|---|---|
| **CMS** | Sistema de gestión de contenidos: permite editar el contenido de un sitio sin tocar código. |
| **Headless** | CMS cuyo panel y datos (backend) están separados de lo que ve el visitante (frontend); entrega los datos por una API. |
| **Backend / Frontend** | Parte del servidor (datos, lógica) / parte que ve el usuario en su navegador. |
| **API** | Conjunto de direcciones (rutas) por las que un programa pide o envía datos a otro, aquí en formato JSON. |
| **Serverless** | Modelo en que el proveedor (Vercel) ejecuta el código solo cuando llega una petición, sin administrar servidores; escala solo. |
| **Arranque en frío (cold start)** | Demora de la primera petición cuando la función serverless no estaba activa. |
| **Vercel** | Plataforma de hosting que publica el código desde GitHub y lo ejecuta como funciones serverless + CDN. |
| **Supabase** | Proveedor de Postgres administrado y almacenamiento de archivos (entre otros servicios que aquí no se usan). |
| **Postgres** | Base de datos relacional estándar y de código abierto. |
| **PGlite** | Postgres embebido (corre dentro de Node) usado solo en local y en pruebas. |
| **Transaction pooler** | Intermediario de Supabase (puerto 6543) que comparte pocas conexiones a la base entre muchas funciones; no admite sentencias preparadas, por eso `prepare: false`. |
| **RLS (Row Level Security)** | Seguridad por filas de Postgres. Activada sin políticas = nadie con los roles públicos puede leer o escribir. |
| **Bucket** | "Carpeta" raíz de almacenamiento de archivos en Supabase Storage (aquí `media`, público para lectura). |
| **URL firmada** | Dirección temporal con una firma que autoriza una acción concreta (aquí: subir un archivo a una ruta) sin entregar la clave. |
| **CDN** | Red de servidores que entrega archivos estáticos rápido desde cerca del usuario. |
| **CSRF** | Ataque que hace que el navegador de un usuario con sesión envíe una acción no deseada desde otro sitio. Se mitiga con `sameSite` y verificación de origen. |
| **XSS** | Ataque que inyecta código (JavaScript) en una página a través de datos. Se mitiga escapando el HTML. |
| **Escapar HTML** | Convertir `<`, `>`, `&`, comillas en entidades para que se muestren como texto y no se interpreten. |
| **JWT** | Token firmado (JSON Web Token) que contiene datos de la sesión; aquí firmado con HS256 y guardado en una cookie. |
| **Cookie httpOnly / secure / sameSite** | httpOnly: JavaScript no puede leerla. secure: solo viaja por HTTPS. sameSite=lax: no se envía en peticiones de escritura iniciadas desde otros sitios. |
| **bcrypt** | Algoritmo lento a propósito para guardar contraseñas (hash con sal); dificulta adivinarlas. |
| **Hash** | Huella irreversible de un dato; se compara la huella, no la contraseña. |
| **Redirect 302** | Respuesta HTTP que dice "ve a esta otra dirección" (temporal). Base del tracking. |
| **Tracking** | Registro de interacciones (aquí, clics en botones). |
| **waitUntil** | Mecanismo de Vercel para terminar trabajo después de enviar la respuesta. |
| **Bot / isbot** | Programa automático (buscadores, vistas previas de WhatsApp/Facebook). `isbot` es la librería que los reconoce por su User-Agent. |
| **User-Agent** | Texto que el navegador envía describiendo su programa y sistema. Se usa en memoria para clasificar y no se guarda. |
| **Prefetch / precarga** | Petición que el navegador hace por adelantado sin que el usuario haya tocado nada; se descarta. |
| **Debounce** | Esperar a que el usuario deje de escribir un momento antes de guardar, para agrupar cambios. |
| **zod** | Librería que valida la forma y el contenido de los datos que entran. |
| **CNAME** | Registro DNS que hace que un subdominio apunte a otro nombre (aquí, a Vercel). |
| **Proxy inverso** | Servidor que recibe la petición en un dominio y la reenvía a otro servidor, devolviendo su respuesta. |
| **Iframe** | Ventana que incrusta una página dentro de otra. |
| **Shortcode** | Etiqueta de WordPress (`[ejemplo]`) que un plugin reemplaza por contenido. |
| **SSO** | Inicio de sesión único compartido entre sistemas. |
| **Multi-tenant / multi-cliente** | Un mismo software sirve a varios clientes con datos separados. |
| **Idempotente** | Que se puede ejecutar varias veces con el mismo resultado (el esquema SQL). |
| **pg_dump** | Herramienta estándar para exportar una base Postgres. |
| **CSP / SRI** | Content-Security-Policy (lista de orígenes permitidos para scripts, etc.) / Subresource Integrity (verificar con una huella que un archivo de CDN no fue alterado). |
| **Ley 29733** | Ley de Protección de Datos Personales del Perú. |
| **noindex** | Indicación a los buscadores para no indexar una página. |

---

<a id="s23"></a>
## 23. No verificado / suposiciones

Lo siguiente **no se pudo comprobar** leyendo el código (o depende de servicios externos):

1. **Estado de producción** (todo [Reportado] por el autor): que `npm run setup` y `npm run verificar` salieran correctos contra Supabase; la prueba externa de 9/9 PDF, tracking y bots; que Facebook e Instagram se cargaran en producción con un script; qué estadísticas de prueba hay hoy; que el proyecto esté en una cuenta personal del autor.
2. **Región del proyecto de Supabase** (el README recomienda East US; GUIA-REUNION-TI dice us-east-1). No está en el código.
3. **Método de despliegue usado**: se asume la integración Git de Vercel (README). Hay una salida local de `vercel build` en `.vercel/` que podría indicar un despliegue desde la CLI en algún momento.
4. **Cifra de 32 MB → 11 MB**: reportada; la salida local de `vercel build` pesa 11 MB (incluye ~5.2 MB de `.data/uploads` locales).
5. **"Solo se cambiaron tres reglas CSS con los mismos valores"**: el HTML original no está en el repositorio. La plantilla actual muestra variables nuevas en `.boton` y `.boton:hover` (este último también usa `--boton-hover` para el borde).
6. **Motivo de `engines.node = 24.x`**: se supone que es igualar la versión de desarrollo; no está documentado.
7. **Validez y uso único de la URL firmada de Supabase**: GUIA-REUNION-TI dice "de un solo uso"; la duración y si es de un solo uso dependen de Supabase y no se fijan en el código.
8. **Límite de ~4.5 MB por petición en Vercel**, condiciones del plan Hobby (no comercial) y pausa del plan gratuito de Supabase (~7 días): datos de los proveedores, citados en comentarios y README; **verificar vigentes**, igual que los precios.
9. **Contenido de los registros técnicos** de Vercel, Supabase y CDNs (si incluyen IP): suposición razonable.
10. **Comportamiento exacto del iPad**: basado en el comportamiento conocido de iPadOS (UA de escritorio) y en la regla del código; las pruebas solo usan un UA que dice "iPad".
11. **Rendimiento y capacidad**: no se hicieron pruebas de carga; las estimaciones de crecimiento de `clicks` son ilustrativas.
12. **Causa raíz exacta** de los problemas de la [sección 18](#s18): reportada por el autor; en el código solo queda la solución.
13. **Si mantener `/api/health` consultado evita la pausa del plan gratuito de Supabase**: no verificado.
14. **Propiedad del código, precio de la suscripción y términos de soporte**: decisiones comerciales no documentadas.
15. **Proyecto "DFG"** y su relación con "headless": sin información; no se debe inventar nada.
