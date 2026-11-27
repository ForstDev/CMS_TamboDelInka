// Direcciones antiguas de las landings (sin dependencias: lo usan el servidor, src/seed.ts y los scripts).

/**
 * Direcciones antiguas → finales (301), por si alguien guardó el enlace o lo imprimió en un QR.
 * Las 9 landings usan la misma dirección que en la web de Intursa (scripts/ajustar-landings.ts); aquí van
 * las que tuvieron en producción y las intermedias de los spas (aqu-spa, andes-spirit-spa, kallpa-spa).
 * Solo estas rutas exactas. Si en la base aún hay una landing activa con la dirección antigua (p. ej. entre el
 * despliegue y la ejecución del script), se sirve esa landing en vez de redirigir.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  '/tambo-outlets': '/outlets-tambodelinka',
  '/experiencias-palacio-del-inka': '/experiencias_palaciodelinka',
  '/experiencias-hotel-paracas': '/experiencias_hotelparacas',
  '/experiencias-tambo-del-inka': '/experiencias_tambodelinka',
  '/outlets-hotel-paracas': '/outlets-hotelparacas',
  '/outlets-palacio-del-inka': '/palacio-outlets',
  '/spa-hotel-paracas': '/aquspa',
  '/spa-palacio-del-inka': '/spa-palaciodelinka',
  '/spa-tambo-del-inka': '/spa-tambodelinka',
  '/aqu-spa': '/aquspa',
  '/andes-spirit-spa': '/spa-palaciodelinka',
  '/kallpa-spa': '/spa-tambodelinka',
});
