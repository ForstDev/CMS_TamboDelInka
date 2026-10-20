# CMS propio — Tambo del Inka Outlets (Intursa)

Página pública de cartas + panel de administración propio + tracking de clics sin datos personales.
Un mismo código sirve a varios clientes: cada uno tiene su carpeta en `clients/` y su propio despliegue.

| Dirección | Qué es |
|---|---|
| `/` | Página pública (réplica exacta del diseño nuevo, con datos desde la base) |
| `/go/<id>` | Cada botón pasa por aquí: se registra el clic y se abre el PDF o enlace |
| `/cms_login` | Ingreso al panel |
| `/cms` | Panel: Botones · Diseño · Textos · Redes · Estadísticas |

**Credenciales de prueba:** usuario `TambodelInka` · contraseña `TambodelInka2026`
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

```bash
npm test          # 49 pruebas automáticas (API, tracking, seguridad, conector de Supabase)
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

6. Prueba local contra Supabase: `npm run dev` (ahora dice `base: Supabase`).

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

### Dominio propio (opcional)
En Vercel › Settings › Domains agrega, por ejemplo, `cartas.intursa.com.pe` y pide al cliente crear el registro
CNAME que Vercel indique.

---

## 5. Antes de salir en vivo con el cliente

- [ ] Cambiar la contraseña de demo (menú de cuenta › Cambiar contraseña).
- [ ] Completar los enlaces de Facebook e Instagram (pestaña Redes). Mientras estén vacíos, la sección "Síguenos" no se muestra.
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

1. El botón apunta a `/go/<id>`. El servidor responde de inmediato con una redirección al PDF.
2. El clic se guarda **después** de responder (en Vercel con `waitUntil`), así el visitante no espera.
3. Se guarda solo: botón, fecha y hora, y tipo de dispositivo (celular / tablet / computadora).
   **No** se guarda IP, cookies, User-Agent ni ningún identificador (Ley 29733).
4. No se cuentan bots (Google, WhatsApp, Facebook, etc.), precargas del navegador ni la vista previa del panel.

Límites a explicar al cliente:
- Cuenta **clics, no personas**: sin cookies ni IP no se distinguen visitantes únicos.
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
