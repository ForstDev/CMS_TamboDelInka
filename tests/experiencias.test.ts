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
    // Celular y PC: la foto va en el fondo del hero (una sola regla), con el mismo encuadre.
    expect(html).toContain('background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html.match(/url\("\/uploads\/f\.jpg"\)/g)).toHaveLength(1);
    expect(html).toContain('--logo-n: 180;');
    expect(html).toContain('<img class="logo" src="/uploads/l.png" alt="Hotel">');

    const centro = render({ fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' });
    expect(centro).toContain('background: var(--fondo) url("/uploads/f.jpg") center / cover no-repeat;');
    expect(centro).toContain('--logo-n: 150;');
    expect(centro).not.toContain('class="logo"');
  });

  const IMG = { fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' } as const;
  const MOBILE_MQ = '@media (max-width: 767.98px) {';
  const PC_MQ = '@media (min-width: 768px) {\n    .hero::before,\n    .hero::after {';
  // Solo el bloque @media móvil (hasta su llave de cierre, sin los comentarios de PC que siguen).
  const mobileCss = (html: string) => {
    const start = html.indexOf(MOBILE_MQ);
    return html.slice(start, html.indexOf('\n  }\n', start) + 4);
  };
  const MOBILE_GRADIENT =
    'background: linear-gradient(\n' +
    '        to bottom,\n' +
    '        rgba(9, 30, 62, 0.60) 0%,\n' +
    '        rgba(9, 30, 62, 0.372) 14%,\n' +
    '        rgba(9, 30, 62, 0.156) 28%,\n' +
    '        rgba(9, 30, 62, 0) 42%,\n' +
    '        rgba(72, 68, 64, 0) 46%,\n' +
    '        rgba(72, 68, 64, 0.425) 58%,\n' +
    '        rgba(72, 68, 64, 0.748) 74%,\n' +
    '        rgba(72, 68, 64, 0.85) 100%\n' +
    '      );';

  it('con foto: la foto a pantalla completa en .hero (celular y PC), sin franja ni máscara', () => {
    const html = render({ ...IMG, fondo_foco_x: '30', fondo_foco_y: '70' });
    // Una sola regla para el hero, fuera de toda media query (vale para celular y PC).
    const fotoRule = '  .hero {\n    background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;\n  }';
    expect(html).toContain(fotoRule);
    expect(html.indexOf(fotoRule)).toBeLessThan(html.indexOf(MOBILE_MQ));
    expect(html.indexOf(fotoRule)).toBeGreaterThan(html.indexOf('.redes-texto { max-width: none; }'));
    // Separador flexible de siempre, entre el título y los botones.
    expect(html).toContain('</header>\n\n  <div class="espacio" aria-hidden="true"></div>\n\n  <nav class="botones"');
    expect(html).toMatch(/\.espacio \{\s*flex: 1 1 auto;\s*min-height: calc\(var\(--u\) \* 20\);\s*\}/);
    // Nada de la franja ni del degradado azul/gris de fondo.
    expect(html).not.toContain('class="foto"');
    expect(html).not.toContain('.foto');
    expect(html).not.toContain('mask-image: linear-gradient(to bottom');
    expect(html).not.toContain('rgb(30, 73, 115)');
    expect(html).not.toContain('rgb(64, 111, 156)');
    expect(html).not.toContain('rgb(84, 78, 73)');
    expect(html).not.toContain('62vw');
  });

  it('celular con foto: capa de oscurecido fija (60 arriba, 85 abajo) solo en pantallas < 768 px', () => {
    const html = render(IMG);
    expect(html.split(MOBILE_MQ).length - 1).toBe(1);
    const css = mobileCss(html);
    expect(css).toMatch(/^@media \(max-width: 767\.98px\) \{\s*\.hero::before \{\s*content: "";\s*position: absolute;\s*inset: 0;\s*z-index: -1;\s*pointer-events: none;/);
    expect(css).toContain(MOBILE_GRADIENT);
    expect(css.endsWith(MOBILE_GRADIENT + '\n    }\n  }')).toBe(true);
    expect(css).toContain('rgba(9, 30, 62, 0.60) 0%');
    expect(css).toContain('rgba(72, 68, 64, 0.85) 100%');
    // Solo ::before, sin máscaras ni la foto: la capa no toca nada más.
    expect(css).not.toContain('::after');
    expect(css).not.toContain('mask');
    expect(css).not.toContain('url(');
    // La capa móvil (azul 9,30,62 y gris 72,68,64) existe solo dentro del bloque móvil (no llega a PC).
    expect(html.split('rgba(9, 30, 62').length - 1).toBe(4);
    expect(html.split('rgba(72, 68, 64').length - 1).toBe(4);
    expect(html.indexOf('rgba(9, 30, 62')).toBeGreaterThan(html.indexOf(MOBILE_MQ));
    expect(html.lastIndexOf('rgba(72, 68, 64')).toBeLessThan(html.indexOf(PC_MQ));
  });

  it('PC con foto: reloj de arena parado (triángulo arriba y abajo, enmascarados), sin la capa móvil', () => {
    const html = render(IMG);
    const pc = html.slice(html.indexOf(PC_MQ));
    expect(html.indexOf(PC_MQ)).toBeGreaterThan(html.indexOf(MOBILE_MQ));
    // Regla común de los dos triángulos, intacta.
    expect(pc).toContain(
      PC_MQ + '\n      content: "";\n      position: absolute;\n      inset: 0;\n      z-index: -1;\n      pointer-events: none;\n' +
      '      -webkit-mask-repeat: no-repeat;\n      mask-repeat: no-repeat;\n      -webkit-mask-composite: source-in;\n      mask-composite: intersect;\n    }',
    );
    // La media query de PC no repite la foto (ya está en .hero) ni trae la capa móvil.
    expect(pc).not.toContain('url(');
    expect(pc).not.toContain('rgba(9, 30, 62');
    expect(pc).not.toContain('rgba(72, 68, 64');
    // Un triángulo por borde: degradado VERTICAL (.55 en el borde de la pantalla → 0 al 50 % del alto, la punta del centro)…
    const shade = (dir: string) =>
      `linear-gradient(\n        ${dir},\n        rgba(6, 16, 34, .55) 0%,\n        rgba(6, 16, 34, .42) 12%,\n        rgba(6, 16, 34, .24) 28%,\n        rgba(6, 16, 34, .09) 40%,\n        rgba(6, 16, 34, 0) 50%\n      );`;
    const arriba = pc.slice(pc.indexOf('.hero::before {'), pc.lastIndexOf('.hero::after {'));
    const abajo = pc.slice(pc.lastIndexOf('.hero::after {'));
    expect(arriba).toContain('.hero::before {\n      background: ' + shade('to bottom'));
    expect(abajo).toContain('.hero::after {\n      background: ' + shade('to top'));
    expect(pc.split('rgba(6, 16, 34, ').length - 1).toBe(10);
    // Sin degradado horizontal de sombreado.
    expect(pc).not.toContain('to right,');
    expect(pc).not.toContain('to left,');
    // …recortado por la intersección de dos degradados de esquina (siguen las diagonales a cualquier proporción).
    expect(pc).toContain('mask-composite: intersect;');
    expect(pc).toContain('-webkit-mask-composite: source-in;');
    const layer = (dir: string) => `linear-gradient(${dir}, #000 50%, rgba(0, 0, 0, .55) 55%, rgba(0, 0, 0, .18) 59%, transparent 62%)`;
    // Arriba, vértices (0,0), (100 %,0), (50 %,50 %): por encima de las dos diagonales.
    // Abajo, vértices (0,100 %), (100 %,100 %), (50 %,50 %): por debajo de las dos diagonales.
    for (const [nombre, css, dirs] of [
      ['arriba', arriba, ['to bottom left', 'to bottom right']],
      ['abajo', abajo, ['to top left', 'to top right']],
    ] as const) {
      for (const dir of dirs) expect(css.split(layer(dir)).length - 1, `${nombre} ${dir}`).toBe(2); // con y sin prefijo -webkit-
      expect(css.match(/-webkit-mask-image:/g), nombre).toHaveLength(1);
      expect(css.match(/(?<!-webkit-)mask-image:/g), nombre).toHaveLength(1);
    }
    // Difuminado de la máscara: de la diagonal (50 %) a transparente (62 %), sin salto duro.
    expect(pc.split('transparent 62%').length - 1).toBe(8);
    expect(pc).not.toMatch(/#000 50%, transparent/);
    // PC: regla común (".hero::before, .hero::after") + una propia de cada lado; nada más.
    expect(pc.match(/\.hero::(?:before|after)/g)).toHaveLength(4);
    // En toda la página: esas 4 + la capa móvil (::before).
    expect(html.match(/\.hero::(?:before|after)/g)).toHaveLength(5);
    // Legibilidad de las redes.
    expect(html).toMatch(/\.redes-texto \{[^}]*text-shadow: 0 1px 8px rgba\(0, 0, 0, \.45\);/);
    expect(html).toMatch(/\.iconos a \{[^}]*text-shadow: 0 1px 8px rgba\(0, 0, 0, \.45\);/);
  });

  it('color sólido (sin imagen): color plano, sin foto, sin degradados ni capas', () => {
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
      expect(html, label).not.toContain('rgba(9, 30, 62');
      expect(html, label).not.toContain('rgba(72, 68, 64');
      expect(html, label).not.toContain('max-width: 767.98px');
      expect(html, label).not.toContain('linear-gradient');
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
    expect(html).toContain(`background: var(--fondo) ${enc} center / cover no-repeat;`);
    expect(html).not.toContain('<script>');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    // Comillas simples y paréntesis: dentro de url("…") no cierran nada.
    const simple = render({ fondo_tipo: 'imagen', fondo_imagen_url: "https://cdn.ejemplo.com/f o't(o).jpg" });
    expect(simple).toContain(`background: var(--fondo) url("https://cdn.ejemplo.com/f o't(o).jpg") center / cover no-repeat;`);
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
