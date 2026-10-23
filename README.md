# CMS propio — Tambo del Inka Outlets (Intursa)

Página pública de cartas + panel de administración propio + tracking de clics sin datos personales.
Un mismo código sirve a varios clientes: cada uno tiene su carpeta en `clients/` y su propio despliegue.

| Dirección | Qué es |
|---|---|
| `/` | Página pública (réplica exacta del diseño nuevo, con datos desde la base) |
| `/go/<id>` | Cada botón pasa por aquí: se registra el clic y se abre el PDF o enlace |
| `/go/social/<id>` | Cada ícono de red social ("Síguenos") pasa por aquí: se registra el clic y se abre la red |
| `/cms_login` | Ingreso al panel |
| `/cms` | Panel: Botones · Diseño · Textos · Redes · Estadísticas |

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

La primera vez se crea sola una base local en `.data/` con los 9 botones y sus PDF.
No hace falta Supabase para probar.

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
npm test          # 59 pruebas automáticas (API, tracking de botones y redes, seguridad, migración, conector de Supabase)
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

4. Crea tablas, bucket de archivos y carga los datos (sube los 9 PDF, el logo y el fondo):

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

> **IMPORTANTE — primero la base, después el código.** Si una versión cambia `db/schema.sql` (por ejemplo, el conteo
> de clics en redes sociales, que agrega las columnas `source` y `social_id` a `clicks`), hay que migrar Supabase
> **antes** de subir el código a GitHub/Vercel:
>
> 1. `npm run setup` desde un PC con el `.env` de producción. Aplica la migración: es aditiva e idempotente,
>    **sin `--force`**, y no toca botones, redes, ajustes ni clics existentes (los clics antiguos quedan como `button`).
> 2. `npm run verificar`.
> 3. Recién entonces `git push`.
>
> Si se despliega el código antes de migrar: la pestaña Estadísticas del panel falla (sus consultas usan la columna
> `source`) y los clics en redes no se guardan (queda un error `[tracking]` en el registro; el visitante igual llega a la red).
> Los clics de las cartas siguen funcionando.

### Dominio propio (opcional)
En Vercel › Settings › Domains agrega, por ejemplo, `cartas.intursa.com.pe` y pide al cliente crear el registro
CNAME que Vercel indique.

---

## 5. Antes de salir en vivo con el cliente

- [ ] Cambiar la contraseña de demo (menú de cuenta › Cambiar contraseña).
- [ ] Confirmar con el cliente que los enlaces de Facebook e Instagram (pestaña Redes) son los oficiales y agregar las demás redes que usen. Una red sin enlace no se muestra.
- [ ] Borrar las estadísticas de prueba (Estadísticas › Borrar estadísticas).
- [ ] Poner `NOINDEX=0` en Vercel y volver a desplegar.
- [ ] Plan de pago: el plan gratis de Supabase pausa el proyecto tras 7 días sin uso, y Vercel Hobby es solo para uso no comercial.
      Para clientes que pagan, usa una organización de FORST en Supabase Pro y Vercel Pro.

---

## 6. Agregar otro cliente (suscripción)

1. Copia `clients/intursa/` como `clients/<nuevo-id>/`.
2. Edita `client.json`: `id`, `name`, usuario y contraseña inicial, textos, colores, botones y redes.
   Pon su logo, fondo y PDF en `seed/` y `seed/pdf/`.
3. Crea **otro** proyecto de Supabase (datos totalmente separados) y **otro** proyecto en Vercel desde el mismo repositorio,
   con `CLIENT_ID=<nuevo-id>` y las claves de su Supabase.
4. Con esas variables en tu `.env`: `npm run setup` y `npm run verificar`.

El código es el mismo para todos; una mejora llega a todos los clientes con un `git push`.
Si el nuevo cliente tiene otro diseño de página, reemplaza `templates/pagina.html` por su plantilla
(con los mismos marcadores `{{…}}`) o agrega una carpeta de plantillas por cliente.

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

Límites a explicar al cliente:
- Cuenta **clics, no personas**: sin cookies ni IP no se distinguen visitantes únicos.
- En redes se cuenta el **toque en el ícono**, no si la persona terminó entrando o siguiendo la cuenta.
- La red de tipo **correo** (`mailto:`) enlaza directo y **no se cuenta** (redirigir a `mailto:` no es fiable en todos los navegadores).
- Los iPad recientes se identifican como computadora (así se presentan al servidor).
- Vercel y Supabase guardan sus propios registros técnicos de infraestructura (pueden incluir IP), fuera de esta base.

---

## Estructura

```
api/index.ts          Entrada para Vercel
src/app.ts            Rutas: página, /go, login, CMS y API
src/repo.ts           Consultas SQL (todas filtradas por client_id)
src/db.ts             Postgres: Supabase (postgres.js) o local (PGlite)
src/storage.ts        Archivos: Supabase Storage o disco local
src/auth.ts           Login, sesión (cookie firmada), bloqueo tras 5 intentos
src/tracking.ts       Tipo de dispositivo y filtro de bots
src/render.ts         Plantilla de la página pública
src/validation.ts     Validación de todo lo que entra desde el panel
templates/pagina.html Diseño de la página (no se modificó visualmente)
templates/login.html, cms.html, public/assets/cms/  Panel
db/schema.sql         Tablas
clients/intursa/      Configuración y archivos iniciales del cliente
scripts/              setup y verificar
tests/                Pruebas automáticas
```
