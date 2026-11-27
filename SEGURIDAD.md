# Seguridad y despliegue en el servidor de Intursa

Guía para quien publique o administre esta app (por ejemplo en `intursa.com`). No contiene claves ni contraseñas.

## 1. Qué protege la app

| Tema | Cómo está resuelto |
|---|---|
| Contraseñas | Se guardan con bcrypt. Nunca se muestran ni se registran. |
| Sesión | Cookie `HttpOnly` + `SameSite=Lax` + `Secure` (por HTTPS), firmada (JWT HS256), dura 12 h. **Se invalida sola al cambiar la contraseña** (también las cookies robadas). |
| Intentos de login | 5 fallos por equipo (IP) en 15 min → bloqueo de 1 minuto. La IP no se guarda en claro (HMAC). |
| CSRF | Cookie `SameSite=Lax` + exigencia de mismo origen en toda escritura de la API. |
| Inyección SQL | Todas las consultas son parametrizadas; los datos entran solo tras validar con zod. |
| XSS | Todo texto se escapa al dibujar la página; el panel no usa `innerHTML`. Además hay una **política de contenido (CSP)**: las páginas públicas no pueden ejecutar scripts y el panel solo ejecuta los suyos. |
| Librerías externas | Font Awesome, Sortable y Chart.js (cdnjs) se cargan con **SRI**: si el CDN cambiara el archivo, el navegador lo rechaza. |
| Archivos subidos | El servidor decide la ruta; solo PDF/PNG/JPG/WEBP y con límite de tamaño (PDF 25 MB, logo 5 MB, fondo 8 MB). El archivo de un botón solo puede ser una ruta que el CMS generó. |
| Datos personales | Los clics no guardan IP, cookies ni User-Agent (Ley 29733). |
| Base de datos | Las tablas tienen Row Level Security (RLS) activado en Supabase; la app usa la clave de servicio solo en el servidor. |
| CSV | Los nombres que empiezan con `= + - @` se neutralizan (no se ejecutan como fórmula en Excel). |

Cabeceras que envía la app: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
`Permissions-Policy`, `X-Frame-Options: SAMEORIGIN` (panel y API) y `Strict-Transport-Security` (solo si la petición llegó por HTTPS).

## 2. Variables de entorno obligatorias en el servidor

| Variable | Para qué |
|---|---|
| `SESSION_SECRET` | Mínimo 32 caracteres aleatorios. **Si falta o es corta en producción, la app no arranca.** Genera una con `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `NODE_ENV=production` | Fuera de Vercel, para que se exija `SESSION_SECRET` y la cookie sea siempre `Secure`. |
| `ADMIN_PASSWORD` | Contraseña inicial del administrador al ejecutar `npm run setup` con Supabase. La de `client.json` es solo de demostración y **no se usa** en un despliegue real. |
| `TRUST_PROXY` | Cuántos proxies de confianza hay delante de la app (ver abajo). |
| `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Base de datos y archivos. La clave secreta **nunca** va a git ni al navegador. |

### TRUST_PROXY (importante)

La app lee la IP del visitante de `X-Forwarded-For` para limitar los intentos de login. Un valor mal puesto permite que un
atacante escriba una IP falsa y pruebe contraseñas sin que lo bloqueen.

- App directamente en Vercel o detrás de **un** nginx / balanceador: `TRUST_PROXY=1` (valor por defecto).
- Detrás de **dos** (por ejemplo CDN + nginx): `TRUST_PROXY=2`.
- Expuesta a internet sin ningún proxy: `TRUST_PROXY=0`.
- Tu proxy debe **añadir** la IP real del cliente al final de `X-Forwarded-For` (nginx: `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`)
  y enviar `X-Forwarded-Proto: https` (nginx: `proxy_set_header X-Forwarded-Proto $scheme;`).

## 3. Lista de comprobación antes de publicar en `intursa.com`

- [ ] HTTPS con certificado válido en todo el dominio; redirigir `http://` → `https://`.
- [ ] `NODE_ENV=production`, `SESSION_SECRET` nuevo (no reutilizar el de pruebas) y `TRUST_PROXY` correcto.
- [ ] `ADMIN_PASSWORD` definido **antes** de `npm run setup`; después, cambiar la contraseña desde el panel (menú de cuenta) a una de 14+ caracteres propia de Intursa.
- [ ] Rotar claves: si la clave secreta de Supabase o el `.env` pasaron por correo, chats o equipos ajenos, generar nuevas en Supabase › Project Settings › API.
- [ ] Repositorio privado y sin `.env`. Revisar con `git log -p -- .env` que nunca se subió.
- [ ] Limitar por IP en el proxy / WAF las rutas `POST /api/login` (p. ej. 20 por minuto) y `GET /go/*` (p. ej. 120 por minuto por IP): la app solo frena a un equipo, no ataques repartidos entre muchas IP.
- [ ] Solo el personal necesario con acceso a Supabase y al servidor; activar verificación en dos pasos en esas cuentas.
- [ ] Copia de seguridad periódica de la base (Supabase hace copias diarias en planes de pago; si no, `pg_dump` programado).
- [ ] Mantener dependencias al día: `npm audit` y `npm audit fix` cada mes (hoy: 0 vulnerabilidades).
- [ ] Si la app se muestra dentro de otra web de Intursa (iframe), las **páginas públicas** lo permiten; el panel (`/cms`) no.
- [ ] Probar: `/cms_login` con contraseña mala 6 veces seguidas → debe bloquear 1 minuto; `/cms` sin sesión → redirige al login.

## 4. Riesgos que quedan (conocidos y aceptados)

1. **Una sola cuenta compartida**: no se sabe quién hizo un cambio. Recomendación futura: una cuenta por persona y registro de cambios.
2. **Sin segundo factor (2FA)** en el panel. Mitigado con contraseña larga y bloqueo por IP; recomendable a futuro.
3. **Ataques de fuerza bruta distribuidos** (muchas IP): se frenan en el proxy/WAF (ver lista).
4. **Archivos públicos**: los PDF, logos y fondos del bucket `media` son públicos por diseño (lo ven los visitantes). No subir nada confidencial.
5. **Fuentes de terceros**: Google Fonts y cdnjs reciben la IP del visitante al cargar la página. Alternativa: alojar esas fuentes e íconos en el propio servidor.
6. **Vista previa del panel**: las vistas previas usan `iframe` con `allow-scripts allow-same-origin` (el navegador avisa en consola). Su contenido solo lo genera la propia app y la CSP impide cualquier otro script.
7. **Fuentes con licencia**: Sofia Pro, Code Next y Graphik requieren licencia web del proveedor (ver README).
