# Guía para la reunión con el jefe de TI — CMS propio Tambo del Inka Outlets

Documento de preparación: qué es la propuesta, cómo funciona por dentro, qué responder a las preguntas técnicas
y cómo hacer la demostración. Pensado para que cualquier persona del equipo pueda presentarlo.

- **Demo publicada:** https://cms-tambo-del-inka.vercel.app/
- **Panel:** https://cms-tambo-del-inka.vercel.app/cms_login
- **Código:** GitHub `ForstDev/CMS_TamboDelInka` (privado)

---

## 1. La propuesta en 30 segundos

> Hoy la página de cartas está en WordPress. Proponemos reemplazarla por el diseño nuevo, con un panel de
> administración propio donde el equipo del hotel cambia botones, cartas en PDF, textos, colores, logo y redes
> sin programadores, y con estadísticas que muestran qué cartas consulta más la gente.
> No usa WordPress ni plugins: es código propio, sin datos personales de los visitantes, y se replica para otros
> clientes cambiando solo la configuración.

**Qué problema resuelve**
1. Cambiar una carta hoy depende de WordPress (subir el PDF a la biblioteca, editar la tabla de botones, etc.).
2. No se sabe qué botones usa la gente.
3. WordPress exige mantener WordPress, el tema y los plugins actualizados.

**Qué se entrega**
1. Página pública idéntica al diseño aprobado, con los 9 botones y sus PDF actuales.
2. Panel de administración con login, pensado primero para celular.
3. Estadísticas en vivo, sin guardar datos personales (Ley 29733).

---

## 2. Cómo funciona un CMS (explicación para quien no lo ha visto por dentro)

Un CMS separa **lo que se dice** de **cómo se ve**.

- El diseño es un molde con huecos, hecho una sola vez.
- El contenido (textos, enlaces, imágenes) no está escrito en el molde: vive aparte, en una base de datos.
- Al editar en el panel no se cambia la página: se cambia un **dato guardado**.
- Al visitar la página, esta no existe ya armada: se construye en ese momento. El sistema toma el molde, lee los
  datos actuales de la base y los coloca en los huecos.

Por eso un cambio se ve al instante: la próxima visita recibe una página armada con el dato nuevo.

Todo CMS tiene tres partes: **panel**, **base de datos** (más archivos) y **motor que arma la página**.
WordPress hace lo mismo con PHP y MySQL; el nuestro, con Node.js y Postgres.

---

## 3. Arquitectura del nuestro

```
                  ┌────────────────────────────┐
Visitante ───────►│  Vercel (servidor Node.js) │───────► Supabase Postgres
(página pública)  │  - arma la página          │         botones, textos, redes,
                  │  - /go/<id> registra clics │         clics, usuarios
                  │  - login y panel + API     │
                  └──────────────▲─────────────┘
                                 │ URL firmada de subida (un solo uso)
Panel (cliente) ─────────────────┘
        │
        └─── sube el PDF directo ───► Supabase Storage (PDF, logo, fondo)
```

| Pieza | Qué hace |
|---|---|
| **GitHub** | Guarda el código. **No** guarda contenido ni claves. |
| **Vercel** | Ejecuta el servidor. Cada `git push` publica la versión nueva. |
| **Supabase Postgres** | Guarda botones, textos, colores, redes, usuarios y clics. |
| **Supabase Storage** | Guarda PDF, logo y fondo. Lectura pública; escritura solo con permiso firmado. |

**El servidor es el único que habla con la base de datos.** El navegador nunca recibe la clave de Supabase.

---

## 4. Los flujos, paso a paso

### 4.1. Un visitante abre la página
1. Pide `/` a Vercel.
2. El servidor lee de Postgres los textos, colores, botones y redes.
3. Los coloca en la plantilla `pagina.html` (el diseño aprobado, sin cambios visuales) y entrega el HTML.
4. El logo, el fondo y los PDF se sirven directamente desde Supabase Storage.
5. La página se arma **en cada visita, sin caché**: por eso un cambio del panel se ve al recargar.

### 4.2. Un visitante toca un botón (tracking)
1. El botón apunta a `/go/<id>` en lugar de al PDF.
2. El servidor responde de inmediato con una redirección (302) al PDF.
3. **Después** de responder, guarda una fila en `clicks`: botón, fecha y hora, tipo de dispositivo.
4. **No guarda** IP, cookies, User-Agent ni ningún identificador.
5. Se descartan bots (Google, WhatsApp, Facebook, etc.), precargas del navegador y la vista previa del panel.

Como el guardado ocurre después de responder, el visitante no espera.

### 4.3. El cliente edita algo
1. El panel envía el cambio al servidor (por ejemplo, cambiar el nombre de un botón).
2. El servidor verifica la sesión y **valida** el dato (enlaces solo `http(s)`, colores `#RRGGBB`, redes de una lista cerrada).
3. Lo guarda en Postgres. No hay botón "Guardar": se guarda al escribir.
4. La siguiente visita ya lo muestra.

### 4.4. El cliente sube una carta nueva
Vercel limita cada petición a 4.5 MB y algunas cartas pesan más, así que el PDF **no pasa por Vercel**:
1. El panel le pide permiso de subida al servidor.
2. El servidor valida tipo (solo PDF) y tamaño (máx. 25 MB) y devuelve una **URL firmada de un solo uso**.
3. El navegador sube el archivo directo a Supabase Storage.
4. El panel actualiza el botón y el servidor borra el PDF anterior.

### 4.5. El cliente mira las estadísticas
El panel consulta cada 8 segundos. El servidor cuenta las filas de `clicks` en Postgres y devuelve los totales
ya calculados: ranking de botones, clics por día (7/30/90 días), por hora, por dispositivo y porcentaje desde celular.

---

## 5. Qué puede hacer el cliente desde el panel

| Sección | Funciones |
|---|---|
| **Botones** | Cambiar nombre; subir o reemplazar PDF, o poner enlace web; mostrar/ocultar; ordenar arrastrando; agregar; eliminar (con "Deshacer") |
| **Diseño** | Logo; fondo (imagen o color); 6 colores con muestra y "Restablecer" |
| **Textos** | Bloque de novedades (se puede ocultar), título de "Síguenos", título y descripción para Google |
| **Redes** | 12 redes disponibles; agregar, cambiar, ordenar, ocultar, quitar |
| **Estadísticas** | KPIs, ranking, gráficos, dispositivos, horas; exportar CSV; borrar estadísticas |

Extras de experiencia: vista previa en vivo, guía rápida al primer ingreso, avisos claros ("Publicado", "Falta el enlace").

---

## 6. Seguridad y privacidad (lo que más va a preguntar TI)

**Acceso**
- Login con usuario y contraseña. Contraseñas guardadas con **bcrypt**.
- Sesión en cookie **httpOnly** y firmada (JWT HS256), 12 horas, `secure` en producción y `sameSite=lax`.
- Bloqueo de 15 minutos tras 5 intentos fallidos de contraseña.
- Mensaje de error idéntico para usuario inexistente y contraseña incorrecta (no revela qué usuarios existen).
- Toda la API del panel exige sesión y, en escrituras, **mismo origen** (defensa contra CSRF).
- `/cms` y `/api` llevan `noindex` y no se pueden incrustar en otros sitios.

**Datos**
- La **clave secreta de Supabase solo existe en el servidor** (variables de entorno de Vercel). No va a GitHub ni al navegador.
- Todas las tablas tienen **RLS activo y sin políticas**: la API pública de Supabase no puede leer ni escribir nada.
- Entrada validada con `zod`; todo texto se escapa al dibujar la página (probado contra XSS).
- Las consultas SQL usan parámetros (sin concatenar texto del usuario).
- Subidas: tipo, tamaño y extensión validados; nombres de archivo saneados.

**Privacidad (Ley 29733)**
- El tracking guarda solo: botón, fecha/hora y tipo de dispositivo (celular/tablet/computadora).
- No guarda IP, cookies, User-Agent, ubicación ni identificadores.
- Vercel y Supabase pueden guardar sus **propios registros técnicos** (que pueden incluir IP). Eso queda fuera de
  nuestra base y conviene mencionarlo en la política de privacidad del cliente.

---

## 7. Calidad y pruebas
- **49 pruebas automáticas** (Vitest + Supertest): API completa, login, bloqueo, sesión manipulada, XSS, validación
  de enlaces peligrosos, tracking (celular/tablet/computadora, bots, precargas), subidas, orden, borrado, estadísticas.
- El conector de base de datos de producción (`postgres.js`) se probó contra un Postgres real por red.
- Verificación de tipos con TypeScript.
- Comando `npm run verificar` que comprueba una instalación real: variables, conexión, tablas, datos, PDF públicos
  y una subida de prueba.
- Se probó el sitio publicado: 9 de 9 PDF abren, el tracking registra, los bots no cuentan.

---

## 8. Stack tecnológico

| Capa | Herramienta |
|---|---|
| Servidor | Node.js 24 + TypeScript + Express 5 |
| Base de datos | Supabase (Postgres) vía `postgres.js` |
| Archivos | Supabase Storage |
| Hosting | Vercel (despliegue automático desde GitHub) |
| Seguridad | bcryptjs, jose (sesión), zod (validación), isbot |
| Panel | HTML/CSS/JS sin framework; SortableJS; Chart.js |
| Pruebas | Vitest, Supertest |

Sin framework de frontend a propósito: menos dependencias, menos superficie de ataque y menos mantenimiento.

---

## 9. Multi-cliente (el modelo de negocio)

El mismo código sirve a varios clientes. Para sumar otro:
1. Copiar `clients/<cliente>/` con su `client.json` (textos, botones, colores, usuario inicial) y sus archivos.
2. Crear **su propio proyecto de Supabase** (datos totalmente separados) y **su propio proyecto de Vercel** del mismo repositorio.
3. Cambiar solo las variables de entorno (`CLIENT_ID` y las claves).

Una mejora al sistema llega a todos los clientes con un `git push`. Todas las tablas llevan `client_id` por si en
algún caso se prefiere compartir proyecto.

---

## 10. Cómo se conecta con el WordPress de Intursa

El CMS **no es un plugin**: corre aparte. Opciones:

1. **Subdominio (recomendada):** `cartas.intursa.com.pe` con un registro DNS (CNAME) hacia Vercel. WordPress no se toca.
2. **Redirección** desde `intursa.com.pe/outlets-tambodelinka/` (plugin o regla 301). Rápida; se ve la dirección nueva.
3. **Misma dirección sin redirigir:** proxy inverso en el servidor o CDN de Intursa. Requiere acceso a su infraestructura.
4. **Iframe en una página de WordPress:** funciona, pero no se recomienda (marco del tema, scroll en celular).
5. **Integración "headless"** (WordPress lee los datos de nuestro CMS por una API): es trabajo nuevo, no incluido hoy.

No es posible un inicio de sesión único entre WordPress y el CMS: son sistemas separados.

---

## 11. Preguntas que probablemente haga TI (y qué responder)

**¿Dónde viven los datos? ¿Quién los controla?**
En Supabase (Postgres), en la región us-east-1, dentro de la cuenta de FORST una vez pasado a producción. El código está en
el GitHub de FORST. Es Postgres estándar: se puede exportar y llevar a otro proveedor o a servidores propios.

**¿Qué pasa si Vercel o Supabase caen o suben de precio?**
El código es Node.js y Postgres estándar, sin funciones propietarias. Se puede mover a cualquier hosting con Node
(o a un servidor propio) cambiando solo el despliegue. La base se exporta con `pg_dump`.

**¿Hay copias de seguridad?**
Depende del plan de Supabase. El plan gratuito **no** ofrece las mismas garantías que el de pago. Para producción
hay que usar un plan de pago con copias diarias, y programar además una exportación propia.

**¿Cuánto tráfico soporta?**
Vercel escala solo (serverless). La base usa el *pooler* de Supabase para manejar muchas conexiones. Una página de
cartas de un hotel está muy por debajo de los límites. Cada clic es una escritura pequeña.

**¿Y si alguien intenta atacar el login?**
Bloqueo por cuenta tras 5 intentos, cookies seguras, validación de origen. Limitación conocida: el bloqueo es **por
usuario**, no por IP. Una mejora posible es limitar también por IP o añadir verificación en dos pasos.

**¿Hay roles, auditoría o autenticación en dos pasos?**
No en esta versión. Hay un administrador por cliente. Es un siguiente paso razonable si el cliente lo pide.

**¿Quién mantiene el sistema?**
FORST: actualizar dependencias, revisar vulnerabilidades y atender cambios. Es un conjunto pequeño de librerías, lo que
reduce el trabajo frente a WordPress con tema y plugins.

**¿Por qué no seguir en WordPress?**
Se pidió un CMS propio y sin WordPress. Además, esta página necesita pocas funciones y estadísticas sin datos
personales; WordPress trae mucho más de lo necesario (y más superficie de mantenimiento y de ataque).

**¿Se pueden ver cuántas personas únicas entran?**
No: por la Ley 29733 no se usan cookies ni IP, así que se cuentan **clics, no personas**. Es una decisión de privacidad.

**¿Es seguro que los PDF sean públicos?**
Las cartas son públicas por naturaleza. Cualquiera con el enlace puede abrirlas, pero **solo el servidor** puede
crear o modificar archivos.

**¿Puede el cliente romper el diseño?**
No: solo edita contenido, colores, logo y fondo. La estructura de la página no es editable.

---

## 12. Límites actuales (decirlos antes de que los pregunten)

- Un solo administrador por cliente; sin roles, sin auditoría de cambios, sin verificación en dos pasos.
- El bloqueo de login es por usuario, no por IP.
- No se distinguen visitantes únicos (decisión de privacidad).
- Los iPad recientes se identifican como computadora (así se presentan al servidor).
- No está construida la API pública para que WordPress lea los datos (integración headless).
- Los clics en redes sociales aún **no** se cuentan (propuesta de mejora: pasarlos también por el tracking).
- La demo corre en planes gratuitos; producción requiere planes de pago.

---

## 13. Pendientes antes de salir en vivo

- [ ] Planes de pago: Vercel Pro (el gratuito es solo para uso no comercial) y Supabase Pro (el gratuito se pausa tras 7 días sin uso y no ofrece las mismas copias). **Verificar precios vigentes.**
- [ ] Mover el proyecto de Supabase a una organización de FORST.
- [ ] Dominio o subdominio definitivo.
- [ ] Cambiar la contraseña de demo y la contraseña de la base; **rotar la clave secreta de Supabase** (se compartieron en un chat durante el desarrollo).
- [ ] Borrar las estadísticas de prueba.
- [ ] Activar la indexación en Google (`NOINDEX=0`) y redesplegar.
- [ ] Definir política de copias de seguridad.

---

## 14. Guion de demostración (5–7 minutos)

1. **Página pública** (en celular y escritorio): mostrar el diseño, tocar un botón y ver que abre la carta.
2. **Entrar al panel** en `/cms_login`. Mostrar que la página pública no tiene ningún enlace al panel.
3. **Botones:** abrir uno, cambiar el nombre y recargar la página pública en otra pestaña: el cambio aparece al instante.
   Devolver el nombre original.
4. **Ocultar un botón** con el interruptor y mostrarlo de nuevo.
5. **Subir una carta:** "Reemplazar" en un botón y ver la barra de progreso (usar un PDF de prueba y restaurar después).
6. **Diseño:** cambiar un color y ver la vista previa en vivo. Usar "Restablecer".
7. **Estadísticas:** desde un celular tocar 2–3 botones y ver cómo aparecen en vivo en la pestaña Datos.
8. Mencionar: no hay datos personales, no se cuentan bots, se exporta a CSV.
9. **Cerrar con** el modelo multi-cliente y las opciones para conectarlo con WordPress.

**Antes de la reunión:** probar el panel con tu usuario, revisar que Vercel y Supabase estén activos
(un proyecto gratuito de Supabase pausado haría fallar la demo) y dejar el celular con la URL pública abierta.

---

## 15. Cierre sugerido

1. Confirmar la dirección final (subdominio, redirección o proxy).
2. Definir quién administra el dominio y el hosting.
3. Acordar planes de pago, copias de seguridad y quién da soporte.
4. Decidir si se quiere sumar el conteo de clics en redes y la integración con WordPress.
