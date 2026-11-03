# CMS propio — Tambo del Inka Outlets (Intursa)

Varias páginas públicas ("landings") + panel de administración propio + tracking de clics sin datos personales.
Un mismo código sirve a varios clientes: cada uno tiene su carpeta en `clients/` y su propio despliegue.
Cada cliente puede tener varias landings, cada una con su plantilla (`cartas` o `experiencias`), sus botones,
redes, ajustes y estadísticas; un solo usuario del panel las edita todas.

| Dirección | Qué es |
|---|---|
| `/` | Landing por defecto: **Tambo del Inka – Outlets** (plantilla `cartas`, réplica exacta del diseño, sin cambios visuales) |
| `/tambo-outlets` | La misma landing por defecto (su slug también responde) |
| `/experiencias-palacio-del-inka` | Palacio del Inka – Experiencias (plantilla `experiencias`) |
| `/experiencias-hotel-paracas` | Hotel Paracas – Experiencias (plantilla `experiencias`) |
| `/experiencias-tambo-del-inka` | Tambo del Inka – Experiencias (plantilla `experiencias`) |
| `/go/<id>` | Cada botón (de cualquier landing) pasa por aquí: se registra el clic en su landing y se abre el PDF o enlace |
| `/go/social/<id>` | Cada ícono de red social pasa por aquí: se registra el clic en su landing y se abre la red |
| `/cms_login` | Ingreso al panel |
| `/cms` | Panel: selector "Estás editando" + Botones · Diseño · Textos · Redes · Estadísticas |

Un slug inexistente, reservado (`cms`, `api`, `go`, `assets`, `uploads`…) o de una landing inactiva da 404.

**Credenciales de prueba:** el usuario y la contraseña de demo están en `clients/intursa/client.json` (campo `admin`)
(se cambian desde el panel: menú de cuenta › Cambiar contraseña).

---

## 1. Probar en tu computador

Requisitos: Node 20 o superior.

```bash
npm install
npm run dev
```

Abre http://localhost:3000 (página) y http://localhost:3000/cms_login (panel).

La primera vez se crea sola una base local en `.data/` con las 4 landings de `clients/intursa/client.json`
(Tambo Outlets con sus 9 botones y las 3 de Experiencias con 3 botones cada una, con sus PDF, logos y fotos).
No hace falta Supabase para probar. Las otras landings se abren en http://localhost:3000/<slug>.

> **Ojo: si tu `.env` tiene `DATABASE_URL`, `npm run dev` y `npm start` se conectan a la base de PRODUCCIÓN (Supabase).**
> Todo lo que edites o cliquees en el servidor local cambia la página publicada y sus estadísticas. Al arrancar,
> el servidor muestra una advertencia cuando está usando Supabase. Para probar solo en local, usa `FORCE_LOCAL=1`
> (ignora las claves del `.env` y usa solo la base y los archivos de `.data/`):
>
> ```powershell
> # PowerShell (Windows)
> $env:FORCE_LOCAL=1; npm start
> ```
>
> ```bash
> # Git Bash / macOS / Linux
> FORCE_LOCAL=1 npm start
> ```
>
> En Windows una variable de entorno vacía se elimina (y el `.env` la vuelve a llenar), así que `DATABASE_URL=` **no**
> sirve para desactivarla: usa `FORCE_LOCAL=1`. Antes de probar, revisa que no quede otro servidor ocupando el puerto 3000.

```bash
npm test          # 99 pruebas en 7 archivos (API, landings, plantilla experiencias, login por equipo, tracking, migraciones, conector de Supabase)
npm run typecheck # revisión de tipos
```

Para volver los datos locales al estado original (detén antes `npm run dev`):

```bash
npm run setup -- --force --borrar-clics
```

> La base local solo admite **un** proceso a la vez. Si alguna vez la página local sale sin botones,
> cierra todas las terminales con `npm run dev`, borra la carpeta `.data/` y vuelve a ejecutar `npm run dev`
> (se recrea sola con los datos originales). Esto no aplica a Supabase.

---

## 2. Crear el proyecto en Supabase

1. Entra a https://supabase.com/dashboard → **New project**.
   - Nombre: `cms-tdi-intursa` (o el que quieras).
   - **Database password**: genera una y guárdala; la necesitas en el paso 3.
   - Región: **East US (North Virginia)**, la misma región por defecto de Vercel, para que las consultas sean rápidas.
2. Cuando termine de crearse, junta estos tres datos:
   - **DATABASE_URL** → botón **Connect** (arriba) › pestaña **Connection string** › **Transaction pooler** (puerto **6543**).
     Copia la URI y reemplaza `[YOUR-PASSWORD]` por la contraseña del paso 1.
   - **SUPABASE_URL** → **Project Settings › Data API** › Project URL (`https://xxxx.supabase.co`).
   - **SUPABASE_SECRET_KEY** → **Project Settings › API Keys** › **Secret key** (`sb_secret_…`).
     Si tu proyecto solo muestra claves antiguas, usa la **service_role**. Nunca la publiques ni la subas a GitHub.
3. En esta carpeta copia `.env.example` como `.env` y completa los valores. Genera `SESSION_SECRET` con:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

4. Crea tablas, bucket de archivos y carga los datos (crea las 4 landings y sube sus PDF, logos y fondos):

   ```bash
   npm run setup
   ```

5. Revisa que todo quedó bien (conexión, tablas, datos, PDF públicos y una subida de prueba):

   ```bash
   npm run verificar
   ```

6. Prueba local contra Supabase: `npm run dev` (ahora dice `base: Supabase` y muestra una advertencia: es la base real).

> No hace falta pegar SQL a mano: `npm run setup` aplica `db/schema.sql`. Si prefieres, también puedes pegarlo en el SQL Editor.

---

## 3. Subir a GitHub (cuenta FORST)

1. Crea un repositorio **privado** vacío en GitHub (por ejemplo `cms-tdi`).
2. En esta carpeta:

   ```bash
   git init
   git add .
   git commit -m "CMS Tambo del Inka: página, panel, tracking y estadísticas"
   git branch -M main
   git remote add origin https://github.com/<tu-usuario-o-org>/cms-tdi.git
   git push -u origin main
   ```

`.env` y `.data/` están en `.gitignore`: las claves y la base local **no** se suben.

---

## 4. Publicar en Vercel (cuenta FORST)

1. https://vercel.com/new → **Import** el repositorio `cms-tdi`.
2. **Framework Preset: Other** (el `vercel.json` ya lo indica). No cambies Build ni Output.
3. **Environment Variables** (las mismas del `.env`):

   | Variable | Valor |
   |---|---|
   | `CLIENT_ID` | `intursa` |
   | `SESSION_SECRET` | la cadena larga que generaste |
   | `DATABASE_URL` | URI del Transaction pooler (puerto 6543) |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` |
   | `SUPABASE_SECRET_KEY` | la secret key |
   | `NOINDEX` | `1` mientras sea demo (Google no la indexa) |
   | `STATS_TZ` | `America/Lima` |

4. **Deploy**. Al terminar prueba:
   - `https://<tu-proyecto>.vercel.app/` → página pública
   - `https://<tu-proyecto>.vercel.app/cms_login` → panel

Cada `git push` a `main` vuelve a publicar solo. Los cambios hechos en el panel **no** necesitan despliegue:
se guardan en Supabase y se ven al instante.

### Actualizar producción cuando cambia la base (ORDEN OBLIGATORIO)

> **IMPORTANTE — primero la base, después el código.** Si una versión cambia `db/schema.sql`, hay que migrar Supabase
> **antes** de subir el código a GitHub/Vercel. Las migraciones son aditivas e idempotentes y nunca se usa `--force`.

#### ORDEN DE DESPLIEGUE (versión con varias landings)

> 1. **`npm run setup -- --solo-esquema`** desde un PC con el `.env` de producción. Solo migra Supabase (tablas
>    `landings`, `landing_settings`, `login_attempts` y la columna `landing_id`) y **no carga las landings nuevas**.
>    Si se cargaran mientras sigue en línea el código viejo, sus botones aparecerían en la página de Tambo Outlets,
>    porque el código viejo no distingue landings.
> 2. **`git add .`, `git commit` y `git push`**, y esperar a que el despliegue de Vercel quede **Ready**.
> 3. **`npm run setup`** (sin opciones): crea las 3 landings de Experiencias, sube sus logos, fotos y PDF, y completa
>    el nombre y el slug (`tambo-outlets`) de la landing por defecto.
> 4. **`npm run verificar`**.
> 5. **Probar las 4 direcciones** (`/`, `/experiencias-palacio-del-inka`, `/experiencias-hotel-paracas`,
>    `/experiencias-tambo-del-inka`; `/tambo-outlets` también debe abrir la por defecto) **y el panel** (selector de landing).
>
> **Entre el paso 1 y el 2 no editar ajustes en el panel**: lo que se edite con el código viejo va a la tabla
> `settings` antigua y no se copia después a la landing (la copia se hace en la migración y no pisa valores ya copiados).
> Botones, redes y clics que se creen en ese intervalo sí quedan en la landing por defecto.
>
> Tras el paso 1 la landing por defecto existe con un slug provisional (`principal`): `/` funciona igual que antes;
> `/tambo-outlets` recién responde después del paso 3.

### Dominio propio (opcional)
En Vercel › Settings › Domains agrega, por ejemplo, `cartas.intursa.com.pe` y pide al cliente crear el registro
CNAME que Vercel indique.

---

## 5. Antes de salir en vivo con el cliente

- [ ] Cambiar la contraseña de demo (menú de cuenta › Cambiar contraseña).
- [ ] Confirmar con el cliente que los enlaces de Facebook e Instagram de cada landing (pestaña Redes) son los oficiales y agregar las demás redes que usen. Una red sin enlace no se muestra. (Los de `client.json` se tomaron de las páginas oficiales de Marriott de cada hotel.)
- [ ] Borrar las estadísticas de prueba: en el panel se borran **por landing** (elegirla en "Estás editando" › Estadísticas › Borrar estadísticas); `npm run setup -- --borrar-clics` borra las de **todas**.
- [ ] Poner `NOINDEX=0` en Vercel y volver a desplegar.
- [ ] Plan de pago: el plan gratis de Supabase pausa el proyecto tras 7 días sin uso, y Vercel Hobby es solo para uso no comercial.
      Para clientes que pagan, usa una organización de FORST en Supabase Pro y Vercel Pro.
- [ ] **Fuentes definitivas** de la plantilla `experiencias`: hoy usa Sofia Sans + Cormorant Garamond (Google Fonts) de forma
      **provisional**, hasta que el diseñador confirme las fuentes de marca (posiblemente Sofia Pro, que es de pago).
- [ ] **Foto de Palacio del Inka más alta** (vertical) para que se vea bien en celular.
- [ ] Las otras **6 landings de Outlets/Minibar** quedan **en pausa** hasta recibir sus mockups.
- [ ] Revisión de seguridad del login por equipo: confirmar que Vercel sobrescribe `X-Forwarded-For` (si no, alguien
      podría falsear su IP para saltarse el límite) y decidir si se agrega además un tope por cuenta.

---

## 6. Agregar otro cliente (suscripción)

1. Copia `clients/intursa/` como `clients/<nuevo-id>/`.
2. Edita `client.json`: `id`, `name`, usuario y contraseña inicial y la lista `landings[]` (exactamente una con
   `"is_default": true`; cada una con `slug`, `name`, `hotel`, `template`, `settings`, `assets`, `buttons` y `socials`).
   Pon los archivos de la landing por defecto en `seed/` y `seed/pdf/`, y los de cada landing extra en `seed/<slug>/` y `seed/<slug>/pdf/`.
3. Crea **otro** proyecto de Supabase (datos totalmente separados) y **otro** proyecto en Vercel desde el mismo repositorio,
   con `CLIENT_ID=<nuevo-id>` y las claves de su Supabase.
4. Con esas variables en tu `.env`: `npm run setup` y `npm run verificar`.

El código es el mismo para todos; una mejora llega a todos los clientes con un `git push`.
Hay dos plantillas: `templates/pagina.html` (`cartas`) y `templates/experiencias.html` (`experiencias`). Si el cliente
tiene otro diseño, hay que agregar una plantilla nueva (con los mismos marcadores `{{…}}`) y registrarla en el código
(`TEMPLATES` en `src/validation.ts`, `TEMPLATE_FILES` en `src/render.ts` y el `check` de `landings.template` en `db/schema.sql`).

---

## 7. Agregar una landing

1. Agrega una entrada en `landings[]` de `clients/<id>/client.json`: `slug` (minúsculas, números y guiones; no puede ser
   una dirección reservada), `name`, `hotel` (agrupa las landings en el selector del panel), `template`
   (`cartas` o `experiencias`), `position` (opcional), `settings`, `assets` (`logo`, `fondo`), `buttons` y `socials`.
2. Crea la carpeta `clients/<id>/seed/<slug>/` con el logo y el fondo, y `seed/<slug>/pdf/` con los PDF de sus botones.
3. Ejecuta `npm run setup` (sin `--force`): crea solo las landings que faltan y no toca las que ya tienen datos.
4. Ábrela en `/<slug>` y edítala en el panel eligiéndola en "Estás editando".

Sus archivos se suben a `<cliente>/<slug>/<tipo>/…` en Supabase Storage (los de la landing por defecto siguen en `<cliente>/<tipo>/…`).
Si la versión del código que la soporta todavía no está desplegada, sigue el [orden de despliegue](#orden-de-despliegue-versión-con-varias-landings).

---

## Cómo funciona el tracking

Hay dos caminos, con la misma lógica:

- **Cartas:** el botón apunta a `/go/<id>` y redirige al PDF o enlace.
- **Redes sociales:** cada ícono de "Síguenos" apunta a `/go/social/<id>` y redirige a la red (Facebook, Instagram, etc.).

1. El servidor responde de inmediato con una redirección (302) al destino real.
2. El clic se guarda **después** de responder (en Vercel con `waitUntil`), así el visitante no espera.
3. Se guarda solo: qué botón o red, fecha y hora, y tipo de dispositivo (celular / tablet / computadora).
   **No** se guarda IP, cookies, User-Agent ni ningún identificador (Ley 29733).
4. No se cuentan bots (Google, WhatsApp, Facebook, etc.), precargas del navegador ni la vista previa del panel.
5. Los clics en redes se guardan aparte (columna `source = 'social'`) y **no alteran** las estadísticas de las cartas;
   el panel los muestra en la tarjeta "Clics en redes sociales" y en la pestaña Redes. El CSV incluye ambos con la columna `Tipo` (`Carta`/`Red`).
6. **Por landing:** cada clic se guarda con la landing de su botón o red (columna `landing_id`). Las estadísticas, el CSV
   (`clics-<cliente>-<slug>-<días>dias.csv`; la por defecto, `clics-<cliente>-<días>dias.csv`) y "Borrar estadísticas"
   del panel son de la landing elegida en "Estás editando": las landings **no se mezclan**.
   `npm run setup -- --borrar-clics` borra las de todas.

Límites a explicar al cliente:
- Cuenta **clics, no personas**: sin cookies ni IP no se distinguen visitantes únicos.
- En redes se cuenta el **toque en el ícono**, no si la persona terminó entrando o siguiendo la cuenta.
- La red de tipo **correo** (`mailto:`) enlaza directo y **no se cuenta** (redirigir a `mailto:` no es fiable en todos los navegadores).
- Los iPad recientes se identifican como computadora (así se presentan al servidor).
- Vercel y Supabase guardan sus propios registros técnicos de infraestructura (pueden incluir IP), fuera de esta base.
- No hay estadísticas que sumen todas las landings en una sola vista: se revisan de a una.
- Login: tras 5 intentos fallidos **desde un mismo equipo (IP)** ese equipo espera 1 minuto; la cuenta no se bloquea.
  La IP no se guarda en claro (solo un HMAC). Pendiente de revisión: que Vercel sobrescriba `X-Forwarded-For`.
- Las landings se crean desde `client.json` + `npm run setup`; el panel no crea ni borra landings.

---

## Estructura

```
api/index.ts          Entrada para Vercel
src/app.ts            Rutas: página, /go, login, CMS y API
src/repo.ts           Consultas SQL (todas filtradas por client_id y por la landing actual)
src/context.ts        Landing de la petición actual (AsyncLocalStorage)
src/db.ts             Postgres: Supabase (postgres.js) o local (PGlite)
src/storage.ts        Archivos: Supabase Storage o disco local
src/auth.ts           Login y sesión (cookie firmada)
src/loginThrottle.ts  Límite de intentos de login por equipo (IP con HMAC)
src/seed.ts           Esquema y carga de landings desde client.json
src/tracking.ts       Tipo de dispositivo y filtro de bots
src/render.ts         Plantillas de las páginas públicas
src/validation.ts     Validación de lo que entra desde el panel y valores por defecto por plantilla
templates/pagina.html Plantilla "cartas" (Tambo Outlets; no se modificó visualmente)
templates/experiencias.html  Plantilla "experiencias" (según el mockup del cliente)
templates/login.html, cms.html, public/assets/cms/  Panel
db/schema.sql         Tablas y migraciones aditivas
clients/intursa/      Configuración (client.json con landings[]) y archivos iniciales (seed/, seed/<slug>/)
scripts/              setup y verificar
tests/                Pruebas automáticas (tests/fixtures/: configuración fija para las pruebas)
```
