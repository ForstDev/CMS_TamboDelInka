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
  return renderPage({ settings: settings(over), buttons: BUTTONS, socials, landing }, opts);
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
    expect(html).toContain('background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html).toContain('--logo-n: 180;');
    expect(html).toContain('--oscurecer: 0.85;');
    expect(html).toContain('--oscurecer-arriba: 0.60;');
    expect(html).toContain('<img class="logo" src="/uploads/l.png" alt="Hotel">');

    const centro = render();
    expect(centro).toContain('background: var(--fondo)  center / cover no-repeat;');
    expect(centro).toContain('--logo-n: 150;');
    expect(centro).not.toContain('class="logo"');
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

  it('oscurece arriba y abajo con dos tintes en una sola capa', () => {
    const html = render({ fondo_oscurecer: '40', fondo_oscurecer_arriba: '25' });
    expect(html).toContain('--oscurecer: 0.40;');
    expect(html).toContain('--oscurecer-arriba: 0.25;');
    expect(html).toContain('rgba(9, 30, 62, calc(var(--oscurecer-arriba) * 1.00)) 0%');
    expect(html).toContain('rgba(72, 68, 64, var(--oscurecer)) 100%');
    expect(html.match(/\.hero::before/g)).toHaveLength(1);
  });

  it('fondo_oscurecer_arriba siempre produce un número válido o el valor por defecto', () => {
    const value = (html: string) => html.match(/--oscurecer-arriba: ([^;]*);/)![1];
    expect(value(render({ fondo_oscurecer_arriba: '0' }))).toBe('0.00');
    expect(value(render({ fondo_oscurecer_arriba: '100' }))).toBe('1.00');
    expect(value(render({ fondo_oscurecer_arriba: '60' }))).toBe('0.60');
    expect(value(render({ fondo_oscurecer_arriba: '999' }))).toBe('1.00'); // fuera de rango: se acota
    for (const bad of ['1.5', '100%', 'x', '-1', '0x10', '', '1); } body { color: red', '<script>']) {
      const html = render({ fondo_oscurecer_arriba: bad });
      expect(value(html), bad).toBe('0.60');
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('color: red');
    }
    // Ajustes guardados antes de existir la clave (sin ella): valor por defecto.
    const { fondo_oscurecer_arriba: _omit, ...sinClave } = defaultSettingsFor('experiencias');
    const html = renderPage({ settings: sinClave as Settings, buttons: BUTTONS, socials: SOCIALS, landing });
    expect(value(html)).toBe('0.60');
    expect(html).toContain('--oscurecer: 0.85;');
    // layoutValues por sí solo también recurre al valor por defecto.
    for (const t of ['experiencias', 'cartas'] as const) {
      expect(layoutValues(sinClave as Settings, t).fondo_oscurecer_arriba_css, t).toBe('0.60');
      expect(layoutValues({ ...sinClave, fondo_oscurecer_arriba: 'basura' } as Settings, t).fondo_oscurecer_arriba_css, t).toBe('0.60');
    }
  });

  it('escapa el título', () => {
    const html = render({ titulo_linea1: '<script>alert(1)</script>' });
    expect(html).toContain('<span class="t1">&lt;script&gt;alert(1)&lt;/script&gt;</span>');
    expect(html).not.toContain('<script>');
  });
});
