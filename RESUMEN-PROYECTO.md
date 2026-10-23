# CMS propio — Tambo del Inka Outlets (Intursa)

Resumen de lo desarrollado, para compartir con el equipo y con el responsable del WordPress del cliente.

- **Página publicada (demo):** https://cms-tambo-del-inka.vercel.app/
- **Panel de administración:** https://cms-tambo-del-inka.vercel.app/cms_login
- **Código:** GitHub `ForstDev/CMS_TamboDelInka` (privado)

---

## 1. Objetivo

Reemplazar la página de cartas de Tambo del Inka Outlets, hoy hecha en WordPress, por el diseño nuevo ya aprobado.
Se agregó un **panel de administración propio** para que el cliente edite el contenido sin tocar código, y un
**sistema de estadísticas** para saber qué cartas consulta más la gente.

Es un desarrollo propio, hecho desde cero: no usa WordPress, plugins ni CMS de terceros.

---

## 2. Qué se hizo

### Página pública (réplica del diseño nuevo)
- Mismo diseño, sin cambios visuales: logo, fondo, 9 botones, bloque de novedades y "Síguenos".
- Los 9 botones llevan a sus PDF actuales, descargados del sitio viejo:
  Desayuno Breakfast · Hawa · Kiri Bar · Room Service · La Cervecería · Vinos | Wines · Menú de niños | Kids Menu · Kallpa Spa · De nuestro huerto.
- Facebook e Instagram oficiales cargados.
- Funciona en celular y en escritorio.

### Panel de administración (`/cms_login`)
Acceso con usuario y contraseña. La página pública no tiene ningún enlace al panel.

| Sección | Qué permite |
|---|---|
| **Botones** | Cambiar nombre, subir una carta nueva en PDF o poner un enlace web, mostrar u ocultar, ordenar arrastrando, agregar y eliminar (con "Deshacer") |
| **Diseño** | Logo, fondo (imagen o color sólido) y colores de los botones |
| **Textos** | Mensaje de novedades y su enlace, título de "Síguenos", título y descripción para Google |
| **Redes** | Agregar, cambiar, ordenar o quitar redes (12 disponibles) |
| **Estadísticas** | Ver el uso de la página (detalle abajo) |

- No hay botón "Guardar": cada cambio se publica solo y se ve en la página al instante.
- Incluye vista previa y una guía rápida al primer ingreso.
- Funciona en celular, con navegación inferior.

### Estadísticas (tracking de clics)
- Cada clic en un botón registra **qué botón fue, cuándo y desde qué tipo de dispositivo** (celular, tablet o computadora).
- El visitante no nota nada: la carta se abre igual de rápido.
- **No se guarda IP, ni cookies, ni datos personales** (Ley 29733). Los bots (Google, WhatsApp, etc.) no se cuentan.
- El panel muestra: ranking de botones, clics por día (7, 30 o 90 días), clics por hora, total, botón más popular,
  porcentaje desde celular y una frase que resume lo más buscado.
- Se actualiza solo cada pocos segundos y se puede exportar a CSV.
- Límite a considerar: cuenta **clics, no personas** (sin cookies ni IP no se distinguen visitantes únicos).

---

## 3. Cómo funciona

```
Visitante ──► Vercel (servidor) ──► Supabase Postgres  (textos, botones, clics)
   │              ▲
   │              │ URL firmada de subida
   ▼              │
Supabase Storage ◄── Panel CMS (sube el PDF directo)
(logo, fondo, PDF)
```

- **Vercel** ejecuta el servidor. Es el único que habla con la base de datos.
- **Supabase Postgres** guarda botones, textos, colores, redes, usuarios y clics.
- **Supabase Storage** guarda los PDF, el logo y el fondo.
- La página se arma con datos frescos en cada visita: un cambio hecho en el panel se ve al recargar, **sin volver a desplegar**.
- Los botones apuntan a `/go/<id>`: el servidor registra el clic y redirige al PDF.
- Los PDF se suben directo del navegador a Supabase (con permiso firmado por el servidor), sin pasar por Vercel.
- En GitHub solo está el **código**. El contenido vive en Supabase.

### Seguridad
- La clave de Supabase solo existe en el servidor; nunca llega al navegador.
- Las tablas están protegidas: la API pública de Supabase no puede leer ni escribir nada.
- Todo el panel exige sesión (cookie firmada, 12 h). Se bloquea 15 minutos tras 5 intentos fallidos.
- Los datos que entran desde el panel se validan (enlaces solo http/https, colores, tipos y tamaños de archivo).

---

## 4. Tecnología

| Capa | Herramienta |
|---|---|
| Servidor | Node.js 24 + TypeScript + Express |
| Base de datos | Supabase (Postgres) |
| Archivos | Supabase Storage |
| Publicación | Vercel (despliegue automático con cada `git push`) |
| Código | GitHub (cuenta FORST) |
| Pruebas | 49 pruebas automáticas (API, seguridad, tracking y conector de base de datos) |

---

## 5. Cómo conectarlo con el WordPress de Intursa

El CMS **no es un plugin de WordPress**: corre aparte y WordPress no lo modifica. Opciones para usarlos juntos:

1. **Subdominio (recomendada).** La página queda en `cartas.intursa.com.pe` (o el nombre que elijan).
   Quien administre el dominio solo crea un registro DNS (CNAME) hacia Vercel. WordPress queda intacto.
2. **Redirección.** La dirección actual `intursa.com.pe/outlets-tambodelinka/` redirige a la página nueva.
   Es lo más rápido, pero el visitante termina viendo la dirección de Vercel.
3. **Incrustar en una página de WordPress (iframe).** Funciona, pero no se recomienda: puede verse el marco de
   WordPress alrededor y se pierde parte de la experiencia en celular.

Reconstruir el panel y las estadísticas **dentro** de WordPress (como plugin) sería otro proyecto distinto,
y contradice el pedido inicial de un CMS propio y sin WordPress.

---

## 6. Antes de salir en vivo

- [ ] Plan de pago en Vercel (el gratuito es solo para uso no comercial) y en Supabase (el gratuito se pausa tras 7 días sin uso).
- [ ] Dominio o subdominio definitivo.
- [ ] Cambiar la contraseña de demo (menú de cuenta › Cambiar contraseña).
- [ ] Borrar las estadísticas de prueba (Estadísticas › Borrar estadísticas).
- [ ] Activar la indexación en Google: cambiar `NOINDEX` a `0` en Vercel y redesplegar.
- [ ] Cambiar la contraseña de la base y la clave secreta de Supabase (se compartieron en un chat durante el desarrollo) y actualizarlas en Vercel.

---

## 7. Se puede replicar para otros clientes

El mismo código sirve a varios clientes: cada uno tiene su propia carpeta de configuración, su propia base de datos
y su propio despliegue. Una mejora del sistema llega a todos con un `git push`. Esto permite ofrecerlo como
suscripción mensual.
