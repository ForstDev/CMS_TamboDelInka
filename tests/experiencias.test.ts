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
  it('con foto: la foto a pantalla completa en .hero (celular y PC), sin franja ni máscara', () => {
    const html = render({ ...IMG, fondo_foco_x: '30', fondo_foco_y: '70' });
    // Una sola regla para el hero, fuera de toda media query (vale para celular y PC).
    const fotoRule = '  .hero {\n    background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;\n  }';
    expect(html).toContain(fotoRule);
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

  it('con foto: sin oscurecido añadido (ni capa móvil ni reloj de arena); la foto, el halo y los text-shadow siguen', () => {
    const html = render({ ...IMG, fondo_foco_x: '30', fondo_foco_y: '70' });
    expect(html).toContain('background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html).toMatch(/\.hero \{[^}]*background: var\(--fondo\) url\("\/uploads\/f\.jpg"\) 30% 70% \/ cover no-repeat;/);
    expect(html).not.toContain('.hero::before');
    expect(html).not.toContain('.hero::after');
    expect(html).not.toContain('::before');
    expect(html).not.toContain('::after');
    expect(html).not.toContain('mask-image');
    expect(html).not.toContain('mask-composite');
    expect(html).not.toContain('max-width: 767.98px');
    expect(html).not.toContain('rgba(9, 30, 62');
    expect(html).not.toContain('rgba(6, 16, 34');
    expect(html).not.toContain('rgba(72, 68, 64');
    // Legibilidad propia de los elementos: halo del logo y sombras de texto.
    expect(html).toContain('filter: drop-shadow(0 1px 8px rgba(0, 0, 0, .5));');
    expect(html).toMatch(/\.titulo \{[^}]*text-shadow: 0 2px 14px rgba\(0, 0, 0, \.42\), 0 1px 3px rgba\(0, 0, 0, \.28\);/);
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
