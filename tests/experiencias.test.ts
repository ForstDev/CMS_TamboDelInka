// Plantilla pública "experiencias" (templates/experiencias.html).
import { describe, expect, it } from 'vitest';
import { layoutValues, renderPage } from '../src/render.js';
import { defaultSettingsFor, type Settings } from '../src/validation.js';
import type { Button, Social } from '../src/repo.js';

const landing = { template: 'experiencias' as const };

function button(n: number, label: string, url: string): Button {
  return {
    id: `33333333-3333-4333-8333-33333333330${n}`,
    label,
    kind: 'link',
    url,
    file_name: '',
    file_path: '',
    new_tab: false,
    position: n,
    active: true,
  };
}

const BUTTONS: Button[] = [
  button(1, 'Destination Discovery', 'https://ejemplo.com/destino'),
  button(2, 'Andes Spirit Spa', 'https://ejemplo.com/spa'),
  button(3, 'Gastronomía', 'https://ejemplo.com/gastro'),
];

const SOCIALS: Social[] = [
  { id: '44444444-4444-4444-8444-444444444401', network: 'facebook', url: 'https://facebook.com/hotel', position: 1, active: true },
  { id: '44444444-4444-4444-8444-444444444402', network: 'instagram', url: 'https://instagram.com/hotel', position: 2, active: true },
];

function settings(over: Partial<Settings> = {}): Settings {
  return { ...defaultSettingsFor('experiencias'), ...over };
}

function render(over: Partial<Settings> = {}, opts: { preview?: boolean } = {}, socials: Social[] = SOCIALS) {
  // Saltos de línea normalizados (con core.autocrlf la plantilla puede tener CRLF).
  return renderPage({ settings: settings(over), buttons: BUTTONS, socials, landing }, opts).replace(/\r\n/g, '\n');
}

describe('plantilla "experiencias"', () => {
  it('muestra las dos líneas del título', () => {
    const html = render({ titulo_linea1: 'Experiences', titulo_linea2: 'Experiencias' });
    expect(html).toContain('<h1 class="titulo"><span class="t1">Experiences</span><span class="t2">Experiencias</span></h1>');
  });

  it('arma los 3 botones con /go/<id>', () => {
    const html = render();
    for (const b of BUTTONS) expect(html).toContain(`<a class="boton" href="/go/${b.id}">${b.label}</a>`);
    expect(html.match(/<a class="boton"/g)).toHaveLength(3);
    expect(html).toContain('<nav class="botones" aria-label="Experiencias">');
    expect(html).not.toContain('<base target="_blank">');
  });

  it('en vista previa los enlaces van directo y todo abre en otra pestaña', () => {
    const html = render({}, { preview: true });
    for (const b of BUTTONS) expect(html).toContain(`<a class="boton" href="${b.url}" target="_blank" rel="noopener">`);
    expect(html).not.toContain('/go/');
    expect(html).toContain('<base target="_blank">');
  });

  it('muestra las redes con su texto y las oculta si no hay', () => {
    const html = render({ redes_titulo: 'Síguenos en / Follow us on' });
    expect(html).toContain('<footer class="redes"><span class="redes-texto">Síguenos en / Follow us on</span><span class="iconos">');
    expect(html).toContain(`href="/go/social/${SOCIALS[0].id}" aria-label="Facebook"`);
    expect(html).toContain('<i class="fa-brands fa-instagram"></i>');

    const sinRedes = render({}, {}, []);
    expect(sinRedes).not.toContain('class="redes"');
    expect(sinRedes).not.toContain('Síguenos en');
  });

  it('no incluye el bloque de novedades aunque esté activo', () => {
    const html = render({ novedades_activo: '1', novedades_url: 'https://ejemplo.com/n', novedades_texto: 'Hola' });
    expect(html.toLowerCase()).not.toContain('novedades');
  });

  it('no deja marcadores sin reemplazar', () => {
    for (const html of [render(), render({ logo_url: '/uploads/l.png', fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' }), render({}, { preview: true }, [])]) {
      expect(html).not.toContain('{{');
      expect(html).not.toContain('}}');
    }
  });

  it('lleva el foco del fondo, la imagen y el ancho del logo al CSS', () => {
    const html = render({ fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg', fondo_foco_x: '30', fondo_foco_y: '70', logo_ancho: '180', logo_url: '/uploads/l.png', logo_alt: 'Hotel' });
    // Celular: la foto va en .foto; PC: en el fondo del hero. Ambas con el mismo encuadre.
    expect(html).toContain('background: url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html).toContain('background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html).toContain('--logo-n: 180;');
    expect(html).toContain('<img class="logo" src="/uploads/l.png" alt="Hotel">');

    const centro = render({ fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' });
    expect(centro).toContain('background: url("/uploads/f.jpg") center / cover no-repeat;');
    expect(centro).toContain('background: var(--fondo) url("/uploads/f.jpg") center / cover no-repeat;');
    expect(centro).toContain('--logo-n: 150;');
    expect(centro).not.toContain('class="logo"');
  });

  const IMG = { fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' } as const;
  const mobileCss = (html: string) => html.slice(html.indexOf('Con foto (diseño fijo'), html.indexOf('PC (≥ 768 px): foto a pantalla completa'));

  it('celular con foto: franja .foto entre el título y los botones, con degradado azul/gris fijo', () => {
    const html = render(IMG);
    // .foto sustituye a .espacio, entre el bloque del título y los botones.
    expect(html).toContain('</header>\n\n  <div class="foto" aria-hidden="true"></div>\n\n  <nav class="botones"');
    expect(html).not.toContain('class="espacio"');
    const css = mobileCss(html);
    // El hero móvil no lleva la foto: lleva el degradado (mismos colores para todos los hoteles).
    expect(css).toMatch(/\.hero \{\s*background: linear-gradient\(\s*to bottom,\s*rgb\(30, 73, 115\) 0%,/);
    expect(css).toContain('rgb(64, 111, 156) 36%');
    expect(css).toContain('rgb(89, 83, 79) 58%');
    expect(css).toContain('rgb(84, 78, 73) 100%');
    const heroRule = css.slice(css.indexOf('  .hero {'), css.indexOf('\n  }', css.indexOf('  .hero {')));
    expect(heroRule).toContain('linear-gradient(');
    expect(heroRule).not.toContain('url(');
    // La franja: ancho completo, alto min(espacio libre, 62vw) con mínimo 120u, centrada y difuminada.
    const foto = css.slice(css.indexOf('  .foto {'));
    expect(foto).toContain('flex: 1 1 0;');
    expect(foto).toContain('align-self: stretch;');
    expect(foto).toContain('min-height: calc(var(--u) * 120);');
    expect(foto).toContain('max-height: 62vw;');
    expect(foto).toContain('margin-top: auto;');
    expect(foto).toContain('margin-bottom: auto;');
    expect(foto).toContain('margin-left: calc(-1 * max(calc(var(--u) * 20), env(safe-area-inset-left, 0px)));');
    expect(foto).toContain('margin-right: calc(-1 * max(calc(var(--u) * 20), env(safe-area-inset-right, 0px)));');
    expect(foto).toContain('background: url("/uploads/f.jpg") center / cover no-repeat;');
    expect(foto).toContain('-webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 22%, #000 78%, transparent 100%);');
    expect(foto).toContain('  mask-image: linear-gradient(to bottom, transparent 0, #000 22%, #000 78%, transparent 100%);');
    // Sin capa de oscurecido en celular: las capas ::before/::after solo existen dentro del bloque de PC.
    const pcStart = html.indexOf('@media (min-width: 768px) {\n    .hero {\n      background: var(--fondo) url(');
    expect(pcStart).toBeGreaterThan(-1);
    expect(html.indexOf('.hero::before')).toBeGreaterThan(pcStart);
  });

  it('PC con foto: foto a pantalla completa y reloj de arena horizontal (dos triángulos enmascarados)', () => {
    const html = render(IMG);
    const pc = html.slice(html.indexOf('@media (min-width: 768px) {\n    .hero {\n      background: var(--fondo) url('));
    expect(pc).toContain('background: var(--fondo) url("/uploads/f.jpg") center / cover no-repeat;');
    // .foto vuelve a ser solo el separador.
    expect(pc).toMatch(/\.foto \{[^}]*background: none;[^}]*mask-image: none;/);
    // Un triángulo por lado: degradado horizontal (máx. en el borde, 0 en la punta del centro)…
    expect(pc).toMatch(/\.hero::before \{\s*background: linear-gradient\(\s*to right,\s*rgba\(6, 16, 34, \.52\) 0%,/);
    expect(pc).toMatch(/\.hero::after \{\s*background: linear-gradient\(\s*to left,\s*rgba\(6, 16, 34, \.52\) 0%,/);
    expect(pc.split('rgba(6, 16, 34, 0) 50%').length - 1).toBe(2);
    // …recortado por la intersección de dos degradados de esquina (siguen las diagonales a cualquier proporción).
    expect(pc).toContain('mask-composite: intersect;');
    expect(pc).toContain('-webkit-mask-composite: source-in;');
    for (const dir of ['to top right', 'to bottom right', 'to top left', 'to bottom left']) {
      const layer = `linear-gradient(${dir}, #000 50%, rgba(0, 0, 0, .55) 55%, rgba(0, 0, 0, .18) 59%, transparent 62%)`;
      expect(pc.split(layer).length - 1, dir).toBe(2); // con y sin prefijo -webkit-
    }
    // Regla común (".hero::before, .hero::after") + una propia de cada lado; nada más.
    expect(html.match(/\.hero::(?:before|after)/g)).toHaveLength(4);
    // Sin degradado vertical en PC.
    expect(pc.slice(0, pc.indexOf('@media (prefers-reduced-motion'))).not.toContain('to bottom,');
    // Legibilidad de las redes.
    expect(html).toMatch(/\.redes-texto \{[^}]*text-shadow: 0 1px 8px rgba\(0, 0, 0, \.45\);/);
    expect(html).toMatch(/\.iconos a \{[^}]*text-shadow: 0 1px 8px rgba\(0, 0, 0, \.45\);/);
  });

  it('color sólido (sin imagen): color plano, sin franja, sin degradados ni oscurecido', () => {
    for (const over of [{}, { fondo_tipo: 'color', fondo_imagen_url: '/uploads/f.jpg' }, { fondo_tipo: 'imagen', fondo_imagen_url: '' }] as Partial<Settings>[]) {
      const html = render(over);
      const label = JSON.stringify(over);
      expect(html, label).toMatch(/\.hero \{[^}]*background: var\(--fondo\);\s*\}/);
      expect(html, label).toContain('<div class="espacio" aria-hidden="true"></div>');
      expect(html, label).not.toContain('class="foto"');
      expect(html, label).not.toContain('.foto');
      expect(html, label).not.toContain('url(');
      expect(html, label).not.toContain('.hero::before');
      expect(html, label).not.toContain('.hero::after');
      expect(html, label).not.toContain('mask-image');
      expect(html, label).not.toContain('rgb(30, 73, 115)');
      expect(html, label).not.toContain('rgba(6, 16, 34');
    }
  });

  it('el oscurecido ya no es editable: sin --oscurecer ni --oscurecer-arriba', () => {
    for (const html of [render(), render(IMG), render({ ...IMG, fondo_oscurecer: '10', fondo_oscurecer_arriba: '0' } as any, { preview: true })]) {
      expect(html).not.toContain('--oscurecer');
      expect(html).not.toContain('oscurecer');
    }
    for (const t of ['experiencias', 'cartas'] as const) {
      const v = layoutValues({ ...defaultSettingsFor(t), fondo_oscurecer: '85' } as Settings, t);
      expect(Object.keys(v).sort(), t).toEqual(['fondo_foco_css', 'logo_align', 'logo_ancho', 'logo_margin', 'logo_text_align']);
    }
    // Un ajuste antiguo con la clave (fila de producción) no cambia nada.
    expect(render({ ...IMG, fondo_oscurecer: '85' } as any)).toBe(render(IMG));
  });

  it('escapa la URL de la imagen dentro del CSS (comillas, barras, saltos de línea, < >)', () => {
    const url = '/uploads/a"b\\c\nd\re<x>);}</style><script>alert(1)</script>.jpg';
    const html = render({ fondo_tipo: 'imagen', fondo_imagen_url: url });
    const enc = 'url("/uploads/a%22b%5Cc%0Ad%0De%3Cx%3E);}%3C/style%3E%3Cscript%3Ealert(1)%3C/script%3E.jpg")';
    expect(html).toContain(`background: ${enc} center / cover no-repeat;`);
    expect(html).toContain(`background: var(--fondo) ${enc} center / cover no-repeat;`);
    expect(html).not.toContain('<script>');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    // Comillas simples y paréntesis: dentro de url("…") no cierran nada.
    const simple = render({ fondo_tipo: 'imagen', fondo_imagen_url: "https://cdn.ejemplo.com/f o't(o).jpg" });
    expect(simple).toContain(`background: url("https://cdn.ejemplo.com/f o't(o).jpg") center / cover no-repeat;`);
  });

  it('escala fluida: todo en --u, sin alturas fijas en vh', () => {
    const html = render();
    expect(html).toContain('--u: clamp(.8px, min(.25641vw, .13889svh), 1.5px);');
    expect(html).toContain('--u: clamp(.85px, min(.07321vw, .13021svh), 2.4px);');
    // Respaldo sin svh, declarado antes de la versión con svh.
    expect(html.indexOf('.13889vh')).toBeGreaterThan(-1);
    expect(html.indexOf('.13889vh')).toBeLessThan(html.indexOf('.13889svh'));
    expect(html).toContain('@supports (height: 1svh)');
    expect(html).toContain('width: min(calc(var(--u) * var(--logo-n)), 80vw);');
    expect(html).toContain('text-size-adjust: 100%;');
    expect(html).not.toMatch(/min-height:\s*(30|16|6)vh/);
    expect(html).not.toContain('max-height: 640px');
    expect(html).not.toContain('--logo-w');
    // Suelo de legibilidad para textos e iconos pequeños.
    expect(html).toContain('font-size: max(12px, calc(var(--u) * 15));');
    expect(html).toContain('font-size: max(11.5px, calc(var(--u) * 13));');
    expect(html).toContain('font-size: max(22px, calc(var(--u) * 26));');
  });

  it('escapa el título', () => {
    const html = render({ titulo_linea1: '<script>alert(1)</script>' });
    expect(html).toContain('<span class="t1">&lt;script&gt;alert(1)&lt;/script&gt;</span>');
    expect(html).not.toContain('<script>');
  });
});
