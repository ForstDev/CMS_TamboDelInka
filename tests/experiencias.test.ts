// Plantilla pública "experiencias" (templates/experiencias.html).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { botonLsReposo, layoutValues, redesTituloHtml, renderPage, SOFIA_ANCHO_EM } from '../src/render.js';
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
    for (const b of BUTTONS) expect(html).toContain(`<a class="boton" href="/go/${b.id}"><span class="b-r">${b.label}</span><span class="b-h" aria-hidden="true">${b.label}</span></a>`);
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
    expect(html).toContain('<footer class="redes"><span class="redes-texto"><span class="l">Síguenos en /</span> <span class="l">Follow us on</span></span><span class="iconos">');
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
    expect(html).toContain('<img class="logo" src="/uploads/l.png" alt="Hotel" draggable="false">');

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
    expect(html.indexOf(fotoRule)).toBeGreaterThan(html.indexOf('.iconos { gap: calc(var(--u) * 12); }'));
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

  it('con foto: degradado negro fijo solo abajo en celular (una capa .hero::before), nada en PC; la foto, el halo y los text-shadow siguen', () => {
    const html = render({ ...IMG, fondo_foco_x: '30', fondo_foco_y: '70' });
    expect(html).toContain('background: var(--fondo) url("/uploads/f.jpg") 30% 70% / cover no-repeat;');
    expect(html).toMatch(/\.hero \{[^}]*background: var\(--fondo\) url\("\/uploads\/f\.jpg"\) 30% 70% \/ cover no-repeat;/);
    // Exactamente una capa ::before, dentro de la media query móvil, con las paradas indicadas.
    expect(html.match(/::before/g)).toHaveLength(1);
    expect(html.match(/\.hero::before/g)).toHaveLength(1);
    expect(html.match(/linear-gradient\(/g)).toHaveLength(1);
    expect(html.match(/rgba\(0, 0, 0, (?:0|calc\(var\(--grad\) \* 0\.5\)|calc\(var\(--grad\) \* 0\.857\)|var\(--grad\))\) /g)).toHaveLength(4);
    expect(html).not.toContain('rgba(72, 68, 64');
    const movil = html.match(/@media \(max-width: 767\.98px\) \{\s*\.hero::before \{([^}]*)\}\s*\}/);
    expect(movil).not.toBeNull();
    const capa = movil![1];
    expect(capa).toContain('content: "";');
    expect(capa).toContain('position: absolute;');
    expect(capa).toContain('inset: 0;');
    expect(capa).toContain('z-index: -1;');
    expect(capa).toContain('pointer-events: none;');
    expect(capa).toContain('linear-gradient(to bottom');
    expect(capa).toContain('rgba(0, 0, 0, 0) calc(100% - var(--u) * 420)');
    // Mismas posiciones; opacidades proporcionales a --grad (0.70 por defecto = 0.35 / 0.6 / 0.7 de siempre).
    expect(capa).toContain('rgba(0, 0, 0, calc(var(--grad) * 0.5)) calc(100% - var(--u) * 290)');
    expect(capa).toContain('rgba(0, 0, 0, calc(var(--grad) * 0.857)) calc(100% - var(--u) * 150)');
    expect(capa).toContain('rgba(0, 0, 0, var(--grad)) 100%');
    expect(html).toContain('--grad: 0.70;');
    // El .hero aísla el apilamiento: la capa queda sobre la foto y bajo el contenido.
    expect(html).toMatch(/\.hero \{[^}]*position: relative;\s*isolation: isolate;/);
    // PC: ninguna capa ni degradado en el bloque min-width: 768px.
    const pc = html.match(/@media \(min-width: 768px\) \{\s*\.t1[\s\S]*?\n  \}\n/);
    expect(pc).not.toBeNull();
    expect(pc![0]).not.toContain('::before');
    expect(pc![0]).not.toContain('gradient');
    expect(html).not.toContain('.hero::after');
    expect(html).not.toContain('::after');
    expect(html).not.toContain('mask-image');
    expect(html).not.toContain('mask-composite');
    expect(html).not.toContain('rgba(9, 30, 62');
    expect(html).not.toContain('rgba(6, 16, 34');
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
      expect(html.replace(/url\("\/assets\/fonts\/[^)]*\)/g, ''), label).not.toContain('url(');
      expect(html, label).not.toContain('.hero::before');
      expect(html, label).not.toContain('.hero::after');
      expect(html, label).not.toContain('mask-image');
      expect(html, label).not.toContain('rgb(30, 73, 115)');
      expect(html, label).not.toContain('rgba(6, 16, 34');
      expect(html, label).not.toContain('rgba(9, 30, 62');
      expect(html, label).not.toContain('rgba(72, 68, 64');
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
      expect(Object.keys(v).sort(), t).toEqual([
        'boton_ls_reposo_css', 'boton_peso_hover_css', 'boton_peso_reposo_css', 'degradado_celular_css', 'fondo_foco_css', 'logo_align', 'logo_ancho', 'logo_margin', 'logo_text_align', 'logo_x_css',
        'texto_botones_escala_css', 'texto_redes_escala_css', 'texto_titulo_escala_css',
      ]);
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
    // (con escala 1.00 valen lo de siempre: 15, 13 y 26 u)
    expect(html).toContain('font-size: max(12px, calc(var(--u) * 15 * var(--s-botones)));');
    expect(html).toContain('font-size: max(11.5px, calc(var(--u) * 13 * var(--s-redes)));');
    expect(html).toContain('font-size: max(22px, calc(var(--u) * 26 * var(--s-redes)));');
  });

  it('escapa el título', () => {
    const html = render({ titulo_linea1: '<script>alert(1)</script>' });
    expect(html).toContain('<span class="t1">&lt;script&gt;alert(1)&lt;/script&gt;</span>');
    expect(html).not.toContain('<script>');
  });
  it('celular: relleno superior del hero 60u; PC sigue en 30u', () => {
    const html = render();
    expect(html).toMatch(/\.hero \{[^}]*padding:\s*calc\(var\(--u\) \* 30 \+ env\(safe-area-inset-top, 0px\)\)/);
    expect(html).toMatch(/@media \(max-width: 767\.98px\) \{\s*\.hero \{\s*padding-top: calc\(var\(--u\) \* 60 \+ env\(safe-area-inset-top, 0px\)\);\s*\}\s*\}/);
    // Lados e inferior no cambian.
    expect(html).toContain('calc(var(--u) * 24 + env(safe-area-inset-bottom, 0px))');
  });

  it('redes_titulo_html: reparte en la primera barra y escapa todo', () => {
    const L = (a: string, b: string) => `<span class="l">${a}</span> <span class="l">${b}</span>`;
    expect(redesTituloHtml('Síguenos en / Follow us on')).toBe(L('Síguenos en /', 'Follow us on'));
    expect(redesTituloHtml('Síguenos / Follow us')).toBe(L('Síguenos /', 'Follow us'));
    expect(redesTituloHtml('  Síguenos/Follow  ')).toBe(L('Síguenos /', 'Follow'));
    expect(redesTituloHtml('Síguenos en')).toBe('<span>Síguenos en</span>');
    expect(redesTituloHtml('')).toBe('');
    expect(redesTituloHtml('   ')).toBe('');
    expect(redesTituloHtml(undefined)).toBe('');
    expect(redesTituloHtml('/ Follow us')).toBe('<span>/ Follow us</span>');
    expect(redesTituloHtml('Síguenos /')).toBe('<span>Síguenos /</span>');
    expect(redesTituloHtml('a / b / c')).toBe(L('a /', 'b / c'));
    expect(redesTituloHtml('<img onerror=x> / "q" & \'z\'')).toBe(L('&lt;img onerror=x&gt; /', '&quot;q&quot; &amp; &#39;z&#39;'));
    expect(redesTituloHtml('<script>alert(1)')).toBe('<span>&lt;script&gt;alert(1)</span>');
    expect(redesTituloHtml('<img onerror=x>')).not.toContain('<img');
  });

  it('la plantilla usa redes_titulo_html, escapado, y el CSS reparte el texto', () => {
    const html = render({ redes_titulo: '<b>x / "y" & z' });
    expect(html).toContain('<span class="redes-texto"><span class="l">&lt;b&gt;x /</span> <span class="l">&quot;y&quot; &amp; z</span></span>');
    expect(html).not.toContain('<b>');
    expect(html).toMatch(/@media \(max-width: 767\.98px\) \{[^@]*\.redes \{ gap: calc\(var\(--u\) \* 18\); \}[^@]*\.redes-texto \{ text-align: left; \}[^@]*\.redes-texto \.l \{ display: block; white-space: nowrap; \}[^@]*text-wrap: balance[^@]*\.iconos \{ gap: calc\(var\(--u\) \* 12\); \}/);
    expect(html).toContain('.redes-texto .l { display: inline; white-space: normal; }');
    expect(html).not.toContain('7.6em');
    expect(render({ redes_titulo: '' })).toContain('<span class="redes-texto"></span>');
  });

  it('cartas (pagina.html) sigue con redes_titulo sin partir', () => {
    const html = renderPage({ settings: { ...defaultSettingsFor('cartas'), redes_titulo: 'Síguenos / Follow' }, buttons: [], socials: SOCIALS, landing: { template: 'cartas' } });
    expect(html).toContain('Síguenos / Follow');
    expect(html).not.toContain('class="l"');
  });

  it('fuente oficial Sofia Pro autoalojada: 6 WOFF2 en disco, 6 @font-face, 3 preload (300, 400 y 700) y sin Sofia Sans en Google Fonts', () => {
    for (const w of [300, 400, 500, 600, 700, 900]) {
      const buf = readFileSync(join(process.cwd(), 'public', 'assets', 'fonts', 'sofia-pro', `sofia-pro-${w}.woff2`));
      expect(buf.subarray(0, 4).toString('latin1'), `peso ${w}`).toBe('wOF2');
    }
    const html = render();
    for (const w of [300, 400, 500, 600, 700, 900]) {
      expect(html).toMatch(new RegExp(String.raw`@font-face \{\s*font-family: "Sofia Pro";\s*font-weight: ${w};\s*font-style: normal;\s*font-display: swap;\s*src: url\("/assets/fonts/sofia-pro/sofia-pro-${w}\.woff2"\) format\("woff2"\);`));
    }
    expect(html.match(/@font-face/g)).toHaveLength(6);
    // Solo se precargan los pesos de uso común (título 300, reposo 400, negrita 700); 500, 600 y 900 se bajan si se usan.
    const pre = [...html.matchAll(/<link rel="preload" as="font" type="font\/woff2" crossorigin href="\/assets\/fonts\/sofia-pro\/sofia-pro-(\d+)\.woff2">/g)].map((m) => m[1]);
    expect(pre).toEqual(['300', '400', '700']);
    expect(html.match(/rel="preload"/g)).toHaveLength(3);
    expect(html).toContain('--sans: "Sofia Pro", "Sofia Sans", "Helvetica Neue", Arial, sans-serif;');
    const google = html.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/)![0];
    expect(google).not.toContain('Sofia');
    expect(google).toContain('Cormorant+Garamond');
  });

  it('el panel declara el @font-face de Sofia Pro 300 y ya no pide Sofia Sans a Google', () => {
    const css = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.css'), 'utf8');
    expect(css).toContain('@font-face { font-family: "Sofia Pro"; font-weight: 300;');
    expect(css).toContain('url("/assets/fonts/sofia-pro/sofia-pro-300.woff2")');
    expect(css).toMatch(/\.tp-1 \{ font-family: "Sofia Pro", "Sofia Sans"/);
    const cms = readFileSync(join(process.cwd(), 'templates', 'cms.html'), 'utf8');
    expect(cms).not.toContain('Sofia+Sans');
    expect(cms).toContain('Plus+Jakarta+Sans');
    expect(cms).toContain('Cormorant+Garamond');
  });
});

// ---------------------------------------------------------------------------------------------
// Ajuste fino horizontal del logo (logo_x) y arrastre en la vista previa

describe('experiencias: logo_x (desplazamiento horizontal del logo)', () => {
  it('--logo-x en el CSS: por defecto 0, valores válidos tal cual y basura → 0', () => {
    expect(render()).toContain('--logo-x: 0;');
    expect(render({ logo_x: '-12' })).toContain('--logo-x: -12;');
    expect(render({ logo_x: '12' })).toContain('--logo-x: 12;');
    expect(render({ logo_x: '-50' })).toContain('--logo-x: -50;');
    expect(render({ logo_x: '50' })).toContain('--logo-x: 50;');
    // Fuera de rango (no debería llegar a la base): se acota. Basura o inyección: 0.
    expect(render({ logo_x: '99' })).toContain('--logo-x: 50;');
    expect(render({ logo_x: '-99' })).toContain('--logo-x: -50;');
    for (const bad of ['x', '', '1.5', '5%', '50; }', '1000', '-0', '--5', '1e1', 'calc(1)', '<script>'] as const) {
      const html = render({ logo_x: bad } as Partial<Settings>);
      expect(html, JSON.stringify(bad)).toContain('--logo-x: 0;');
      expect(html, JSON.stringify(bad)).not.toContain('<script>');
    }
    // Landing existente sin la clave: igual que 0.
    const { logo_x: _omit, ...sinClave } = settings();
    expect(renderPage({ settings: sinClave as Settings, buttons: BUTTONS, socials: SOCIALS, landing }, {}).replace(/\r\n/g, '\n')).toContain('--logo-x: 0;');
    expect(render({ logo_x: undefined } as any)).toContain('--logo-x: 0;');
  });

  it('layoutValues.logo_x_css: entero acotado −50…50', () => {
    const v = (logo_x: unknown) => layoutValues({ ...defaultSettingsFor('experiencias'), logo_x } as Settings, 'experiencias').logo_x_css;
    expect([v('0'), v('7'), v('-7'), v('50'), v('-50'), v('51'), v('-51')]).toEqual(['0', '7', '-7', '50', '-50', '50', '-50']);
    expect([v(''), v('x'), v(undefined), v(null), v('1.5'), v('-0'), v(12)]).toEqual(['0', '0', '0', '0', '0', '0', '12']);
  });

  it('el logo se desplaza con left en % de .marca; .hero recorta el desborde horizontal; el <img> no es arrastrable', () => {
    const html = render({ logo_url: '/uploads/l.png', logo_alt: 'Hotel' });
    expect(html).toMatch(/\.logo \{[^}]*position: relative;\s*left: calc\(var\(--logo-x\) \* 1%\);/);
    expect(html).toMatch(/\.hero \{[^}]*overflow-x: clip;/);
    expect(html).toContain('<img class="logo" src="/uploads/l.png" alt="Hotel" draggable="false">');
    // El ancho del logo y su preajuste siguen igual.
    expect(html).toContain('width: min(calc(var(--u) * var(--logo-n)), 80vw);');
    expect(html).toContain('align-items: center;');
    expect(render({ logo_posicion: 'right', logo_x: '-8' })).toContain('align-items: flex-end;');
  });

  it('el script de arrastre solo está en la vista previa de "experiencias"', () => {
    const tag = '<script src="/assets/cms/preview-drag.js" defer></script>';
    const preview = render({}, { preview: true });
    expect(preview).toContain(tag);
    expect(preview.match(/<script/g)).toHaveLength(1);
    expect(preview.indexOf(tag)).toBeGreaterThan(preview.indexOf('</main>'));
    expect(preview.indexOf(tag)).toBeLessThan(preview.indexOf('</body>'));
    // Página pública (con y sin noindex) y vista previa sin plantilla experiencias: nada.
    for (const html of [render(), render({ logo_x: '20' }), renderPage({ settings: settings(), buttons: BUTTONS, socials: SOCIALS, landing }, { noindex: true })]) {
      expect(html).not.toContain('preview-drag');
      expect(html).not.toContain('<script');
    }
    const cartas = (opts: { preview?: boolean }) =>
      renderPage({ settings: defaultSettingsFor('cartas'), buttons: [], socials: [], landing: { template: 'cartas' } }, opts);
    expect(cartas({ preview: true })).not.toContain('preview-drag');
    expect(cartas({})).not.toContain('preview-drag');
    expect(renderPage({ settings: defaultSettingsFor('cartas'), buttons: [], socials: [] }, { preview: true })).not.toContain('preview-drag');
    expect(preview).not.toContain('{{');
  });
});

describe('preview-drag.js: computeLogoX (función pura)', () => {
  const code = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'preview-drag.js'), 'utf8');
  const sandbox: { module: { exports: { computeLogoX?: (...a: unknown[]) => number } } } = { module: { exports: {} } };
  vm.runInNewContext(code, sandbox); // sin window ni document: solo define y exporta la función
  const f = sandbox.module.exports.computeLogoX!;
  // Contenedor .marca de 350 px y logo de 150 px: centro (borde izq. a 100 px), izquierda (0) y derecha (200).
  const W = 350;
  const LOGO = 150;
  const CENTRO = 100;
  const DER = W - LOGO;

  it('se exporta y no toca el DOM al cargarse fuera del navegador', () => {
    expect(typeof f).toBe('function');
  });

  it('centro: mueve en % de .marca, redondea a entero y respeta los bordes de .marca', () => {
    expect(f(0, 0, W, CENTRO, LOGO)).toBe(0);
    expect(f(0, 35, W, CENTRO, LOGO)).toBe(10);
    expect(f(0, -35, W, CENTRO, LOGO)).toBe(-10);
    // Límites: a la izquierda ceil(−100/350·100) = −28; a la derecha floor(100/350·100) = 28.
    expect(f(0, -1000, W, CENTRO, LOGO)).toBe(-28);
    expect(f(0, 1000, W, CENTRO, LOGO)).toBe(28);
    expect(f(0, 98, W, CENTRO, LOGO)).toBe(28); // justo en el borde (28 %)
    expect(f(0, 105, W, CENTRO, LOGO)).toBe(28); // pasado de borde: se queda
  });

  it('preajuste izquierda: solo hacia la derecha (tope 50 %); derecha: solo hacia la izquierda (tope −50 %)', () => {
    expect(f(0, -200, W, 0, LOGO)).toBe(0);
    expect(f(0, 70, W, 0, LOGO)).toBe(20);
    expect(f(0, 1000, W, 0, LOGO)).toBe(50);
    expect(f(0, 200, W, DER, LOGO)).toBe(0);
    expect(f(0, -70, W, DER, LOGO)).toBe(-20);
    expect(f(0, -1000, W, DER, LOGO)).toBe(-50);
    // Con el logo más ancho que la mitad el tope lo pone .marca, no ±50.
    expect(f(0, 1000, 400, 0, 300)).toBe(25);
    expect(f(0, -1000, 400, 100, 300)).toBe(-25);
  });

  it('parte del desplazamiento actual (startPct) y lo acota si ya estaba fuera', () => {
    expect(f(10, 0, W, CENTRO, LOGO)).toBe(10);
    expect(f(10, -35, W, CENTRO, LOGO)).toBe(0);
    expect(f(10, 35, W, CENTRO, LOGO)).toBe(20);
    expect(f(40, 0, W, CENTRO, LOGO)).toBe(28);
    expect(f(-40, 0, W, CENTRO, LOGO)).toBe(-28);
    expect(f(-30, 0, W, 0, LOGO)).toBe(0);
  });

  it('redondeo al entero más cercano', () => {
    expect(f(0, 1.7, W, CENTRO, LOGO)).toBe(0); // 0.49 %
    expect(f(0, 1.8, W, CENTRO, LOGO)).toBe(1); // 0.51 %
    expect(f(0, -1.8, W, CENTRO, LOGO)).toBe(-1);
    expect(f(0, 17.4, W, CENTRO, LOGO)).toBe(5); // 4.97 %
    expect(f(2.4, 0, W, CENTRO, LOGO)).toBe(2);
    expect(f(2.6, 0, W, CENTRO, LOGO)).toBe(3);
  });

  it('casos degenerados: sin medidas no se mueve; logo a todo el ancho → 0; nunca NaN ni -0', () => {
    expect(f(5, 100, 0, 0, 100)).toBe(5);
    expect(f(5, 100, NaN, 0, 100)).toBe(5);
    expect(f(0, 100, W, 0, W)).toBe(0);
    expect(f(0, -100, W, 0, W)).toBe(0);
    expect(f(NaN, NaN, W, CENTRO, LOGO)).toBe(0);
    expect(f(0, -1, W, 0, LOGO)).toBe(0);
    expect(Object.is(f(0, -1, W, 0, LOGO), 0)).toBe(true);
    expect(f(99, 0, 0, 0, 0)).toBe(50);
  });

  it('siempre entero, dentro de −50…50 y con el logo dentro de .marca (barrido)', () => {
    for (const [left0, w, mw] of [[0, 150, 350], [100, 150, 350], [200, 150, 350], [0, 60, 1100], [520, 60, 1100], [1040, 60, 1100]] as const) {
      for (let start = -50; start <= 50; start += 7) {
        for (let dx = -1500; dx <= 1500; dx += 37) {
          const v = f(start, dx, mw, left0, w);
          expect(Number.isInteger(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(-50);
          expect(v).toBeLessThanOrEqual(50);
          const l = left0 + (v / 100) * mw;
          expect(l).toBeGreaterThanOrEqual(-mw * 0.01 - 1e-6); // tolerancia de redondeo a entero (≤ 1 %)
          expect(l + w).toBeLessThanOrEqual(mw + mw * 0.01 + 1e-6);
        }
      }
    }
  });
});

describe('panel: ajuste fino del logo y mensajes de la vista previa', () => {
  const cms = readFileSync(join(process.cwd(), 'templates', 'cms.html'), 'utf8');
  const js = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.js'), 'utf8');

  it('tarjeta Logo: control solo para experiencias, accesible', () => {
    const block = cms.match(/<div class="logo-x" data-only="experiencias">[\s\S]*?<\/div>\s*<\/div>/)![0];
    expect(block).toContain('<input type="range" id="logo-x" min="-50" max="50" step="1" data-setting="logo_x" aria-describedby="logo-x-value logo-x-hint">');
    expect(block).toContain('<output class="range-value" id="logo-x-value" for="logo-x">');
    expect(block).toContain('Ajuste fino horizontal');
    expect(block).toContain('id="logo-x-center"');
    expect(block).toContain('id="logo-x-hint">También puedes arrastrar el logo en la vista previa.');
    expect(cms.indexOf('id="logo-pos"')).toBeLessThan(cms.indexOf('id="logo-x"'));
    expect(cms.indexOf('id="logo-x"')).toBeLessThan(cms.indexOf('id="logo-reset"'));
  });

  it('los tres iframes de vista previa permiten scripts del mismo origen; las miniaturas no', () => {
    for (const id of ['preview-frame', 'preview-frame-mobile', 'preview-frame-full']) {
      expect(cms, id).toMatch(new RegExp(`<iframe id="${id}"[^>]*sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"`));
    }
    expect(js).toContain("sandbox: 'allow-same-origin',"); // miniaturas del selector: sin scripts
  });

  it('cms.js: el mensaje solo se acepta del mismo origen, de un iframe de vista previa y con un entero −50…50', () => {
    const handler = js.match(/window\.addEventListener\('message', \(event\) => \{[\s\S]*?\n\}\);/)![0];
    expect(handler).toContain('event.origin !== location.origin');
    expect(handler).toContain("data.type !== 'cms-logo-x'");
    expect(handler).toContain('f.contentWindow === event.source');
    expect(handler).toContain('Number.isInteger(v)');
    expect(handler).toContain('v < LOGO_X_MIN || v > LOGO_X_MAX');
    expect(js).toContain("['#preview-frame', '#preview-frame-mobile', '#preview-frame-full']");
    // Un preajuste y «Restablecer» también devuelven logo_x a 0.
    expect(js).toContain("applyLogoLayout({ logo_posicion: v, logo_x: '0' })");
    expect(js).toContain("defaults.logo_x = '0'");
  });
});

// ---------------------------------------------------------------------------------------------
// Tamaño de los textos (texto_*_escala) e intensidad del degradado de celular (degradado_celular)

describe('experiencias: escalas de texto y degradado de celular', () => {
  const css = (over: Partial<Settings>) => render(over);
  const IMG = { fondo_tipo: 'imagen', fondo_imagen_url: '/uploads/f.jpg' } as const;

  it('por defecto: escalas 1.00 y degradado 0.70 (el aspecto de siempre)', () => {
    const html = render();
    expect(html).toContain('--s-titulo: 1.00;');
    expect(html).toContain('--s-botones: 1.00;');
    expect(html).toContain('--s-redes: 1.00;');
    expect(html).toContain('--grad: 0.70;');
    expect(html).not.toContain('{{');
    // Los tamaños multiplican las medidas originales (36/30 móvil, 60/48 PC, 15, 13, 26) por la escala.
    expect(html).toMatch(/\.t1 \{[^}]*font-size: calc\(var\(--u\) \* 36 \* var\(--s-titulo\)\);/);
    expect(html).toMatch(/\.t2 \{[^}]*font-size: calc\(var\(--u\) \* 30 \* var\(--s-titulo\)\);/);
    expect(html).toMatch(/@media \(min-width: 768px\) \{\s*\.t1 \{ font-size: calc\(var\(--u\) \* 60 \* var\(--s-titulo\)\); \}\s*\.t2 \{ font-size: calc\(var\(--u\) \* 48 \* var\(--s-titulo\)\); \}/);
    expect(html).toMatch(/\.boton \{[^}]*min-height: calc\(var\(--u\) \* 52\);/); // los botones conservan su alto mínimo
    expect(html).toMatch(/\.boton \{[^}]*font-size: max\(12px, calc\(var\(--u\) \* 15 \* var\(--s-botones\)\)\);/);
    expect(html).toMatch(/\.redes-texto \{[^}]*font-size: max\(11\.5px, calc\(var\(--u\) \* 13 \* var\(--s-redes\)\)\);/);
    expect(html).toMatch(/\.iconos a \{[^}]*font-size: max\(22px, calc\(var\(--u\) \* 26 \* var\(--s-redes\)\)\);/);
    // Con 0.70 el degradado equivale al original: 0.35, 0.6 (0.7 × 0.857 = 0.5999) y 0.7.
    expect(0.7 * 0.5).toBeCloseTo(0.35, 10);
    expect(0.7 * 0.857).toBeCloseTo(0.6, 3);
  });

  it('valores del CSS: porcentaje / 100 con 2 decimales y acotado', () => {
    expect(css({ texto_titulo_escala: '85' })).toContain('--s-titulo: 0.85;');
    expect(css({ texto_botones_escala: '140' })).toContain('--s-botones: 1.40;');
    expect(css({ texto_redes_escala: '70' })).toContain('--s-redes: 0.70;');
    expect(css({ degradado_celular: '0' })).toContain('--grad: 0.00;');
    expect(css({ degradado_celular: '100' })).toContain('--grad: 1.00;');
    expect(css({ degradado_celular: '35' })).toContain('--grad: 0.35;');
    // Fuera de rango: se acota.
    expect(css({ texto_titulo_escala: '10' })).toContain('--s-titulo: 0.70;');
    expect(css({ texto_titulo_escala: '999' })).toContain('--s-titulo: 1.40;');
    expect(css({ degradado_celular: '500' })).toContain('--grad: 1.00;');
    // Basura o inyección: valor por defecto.
    for (const bad of ['x', '', '1.5', '5%', '90; }', '-5', '1e2', 'calc(1)', '<script>', null, undefined] as const) {
      const html = css({ texto_titulo_escala: bad, texto_botones_escala: bad, texto_redes_escala: bad, degradado_celular: bad } as unknown as Partial<Settings>);
      const label = JSON.stringify(bad);
      expect(html, label).toContain('--s-titulo: 1.00;');
      expect(html, label).toContain('--s-botones: 1.00;');
      expect(html, label).toContain('--s-redes: 1.00;');
      expect(html, label).toContain('--grad: 0.70;');
      expect(html, label).not.toContain('<script>');
    }
    // Landing existente sin las claves: valen los valores por defecto.
    const { texto_titulo_escala: _a, texto_botones_escala: _b, texto_redes_escala: _c, degradado_celular: _d, ...sinClaves } = settings();
    const viejo = renderPage({ settings: sinClaves as Settings, buttons: BUTTONS, socials: SOCIALS, landing }, {}).replace(/\r\n/g, '\n');
    expect(viejo).toContain('--s-titulo: 1.00;');
    expect(viejo).toContain('--grad: 0.70;');
    expect(viejo).toBe(render());
  });

  it('layoutValues: *_css con 2 decimales; cartas recibe los mismos valores pero su plantilla no los usa', () => {
    const v = (over: Record<string, unknown>, t: 'experiencias' | 'cartas' = 'experiencias') => layoutValues({ ...defaultSettingsFor(t), ...over } as Settings, t);
    expect(v({})).toMatchObject({ texto_titulo_escala_css: '1.00', texto_botones_escala_css: '1.00', texto_redes_escala_css: '1.00', degradado_celular_css: '0.70' });
    expect(v({ texto_titulo_escala: '85', degradado_celular: '5' })).toMatchObject({ texto_titulo_escala_css: '0.85', degradado_celular_css: '0.05' });
    expect(v({ texto_redes_escala: 'x' }).texto_redes_escala_css).toBe('1.00');
    expect(v({ degradado_celular: '' }).degradado_celular_css).toBe('0.70');
    expect(v({ degradado_celular: 40 }).degradado_celular_css).toBe('0.40');

    const cartas = (over: Partial<Settings>) =>
      renderPage({ settings: { ...defaultSettingsFor('cartas'), ...over }, buttons: BUTTONS, socials: SOCIALS, landing: { template: 'cartas' } }, {});
    const base = cartas({});
    expect(cartas({ texto_titulo_escala: '120', texto_botones_escala: '80', texto_redes_escala: '140', degradado_celular: '0' })).toBe(base);
    for (const marca of ['--s-titulo', '--s-botones', '--s-redes', '--grad', 'escala_css', 'degradado']) expect(base).not.toContain(marca);
  });

  it('el degradado sigue solo en celular: en PC no hay capa ni --grad en las reglas de escritorio', () => {
    const html = render({ ...IMG, degradado_celular: '100' });
    expect(html).toContain('--grad: 1.00;');
    expect(html.match(/var\(--grad\)/g)).toHaveLength(3);
    const pc = html.match(/@media \(min-width: 768px\) \{\s*\.t1[\s\S]*?\n  \}\n/)![0];
    expect(pc).not.toContain('--grad');
    expect(pc).not.toContain('::before');
    // Con 0 % el CSS sigue siendo válido (opacidad 0.00 = sin degradado visible).
    expect(render({ ...IMG, degradado_celular: '0' })).toContain('--grad: 0.00;');
  });
});

describe('panel: tamaño de los textos y degradado de celular', () => {
  const cms = readFileSync(join(process.cwd(), 'templates', 'cms.html'), 'utf8');
  const js = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.js'), 'utf8');

  it('pestaña Textos: tarjeta solo para experiencias con tres rangos 70–140 paso 5, etiquetas y pista', () => {
    const card = cms.match(/<article class="card txt-sizes" data-only="experiencias">[\s\S]*?<\/article>/)![0];
    const rangos: [string, string, string][] = [
      ['txt-titulo', 'texto_titulo_escala', 'Título'],
      ['txt-botones', 'texto_botones_escala', 'Texto de los botones'],
      ['txt-redes', 'texto_redes_escala', 'Texto de redes (con íconos)'],
    ];
    for (const [id, key, label] of rangos) {
      expect(card, id).toContain(`<input type="range" id="${id}" min="70" max="140" step="5" data-setting="${key}" aria-describedby="${id}-value txt-hint">`);
      expect(card, id).toContain(`<output class="range-value" id="${id}-value" for="${id}">`);
      expect(card, id).toContain(`${label} <output`);
    }
    expect(card).toContain('id="txt-hint">100 % es el tamaño original. Se ve en celular y en PC.');
    expect(card).toContain('Tamaño de los textos');
    expect(card).toContain('id="txt-reset"');
    expect(card).toContain('Restablecer');
    // Va dentro de la pestaña Textos.
    const textos = cms.indexOf('data-panel="textos"');
    expect(cms.indexOf('class="card txt-sizes"')).toBeGreaterThan(textos);
    expect(cms.indexOf('class="card txt-sizes"')).toBeLessThan(cms.indexOf('data-panel="redes"'));
  });

  it('pestaña Diseño, tarjeta Fondo: rango del degradado 0–100 paso 5 solo para experiencias', () => {
    const block = cms.match(/<div class="grad-field" data-only="experiencias">[\s\S]*?<\/div>/)![0];
    expect(block).toContain('<input type="range" id="grad-celular" min="0" max="100" step="5" data-setting="degradado_celular" aria-describedby="grad-celular-value grad-celular-hint">');
    expect(block).toContain('<output class="range-value" id="grad-celular-value" for="grad-celular">');
    expect(block).toContain('Degradado de abajo (solo celular)');
    expect(block).toContain('id="grad-celular-hint">Sombra negra detrás de los botones, solo en celular. 0 % = sin degradado.');
    const fondo = cms.indexOf('fa-fill-drip');
    expect(cms.indexOf('id="grad-celular"')).toBeGreaterThan(fondo);
    expect(cms.indexOf('id="grad-celular"')).toBeLessThan(cms.indexOf('fa-swatchbook')); // dentro de la tarjeta Fondo
    expect(cms.indexOf('id="grad-celular"')).toBeGreaterThan(cms.indexOf('data-color="color_fondo"'));
  });

  it('cms.js: se rellenan desde state.settings (con default), formato "N %" y Restablecer en una sola petición con Deshacer', () => {
    for (const id of ['txt-titulo', 'txt-botones', 'txt-redes', 'grad-celular']) expect(js).toContain(`'${id}'`);
    expect(js).toContain("texto_titulo_escala: ['txt-titulo', 70, 140, 100]");
    expect(js).toContain("degradado_celular: ['grad-celular', 0, 100, 70]");
    expect(js).toContain('out.textContent = `${v} %`;');
    expect(js).toContain('state.settings[key] ?? state.defaults?.[key]');
    expect(js).toContain("api('PATCH', '/api/cms/settings', values)");
    expect(js).toContain("toast('Tamaños de texto restablecidos', 'ok', { action: 'Deshacer'");
    expect(js).toContain("TEXT_SCALE_KEYS.map((k) => [k, '100'])");
  });
});

// ---------------------------------------------------------------------------------------------
// Peso del texto de los botones: fino en reposo, negrita al pasar el mouse (fundido entre dos capas)

describe('experiencias: peso del texto de los botones (reposo / hover)', () => {
  const PESOS = ['300', '400', '500', '600', '700', '900'] as const;
  const w = (k: keyof typeof SOFIA_ANCHO_EM) => SOFIA_ANCHO_EM[k];

  it('por defecto 400 en reposo y 700 al pasar el mouse, con su compensación de ancho', () => {
    const html = render();
    expect(html).toContain('--bt-reposo: 400;');
    expect(html).toContain('--bt-hover: 700;');
    expect(html).toContain('--bt-ls: 0.0109em;');
    expect(html).not.toContain('{{');
    expect(defaultSettingsFor('experiencias')).toMatchObject({ boton_peso_reposo: '400', boton_peso_hover: '700' });
  });

  it('los 6 pesos llegan al CSS; basura o inyección → los de por defecto; sin las claves = por defecto', () => {
    for (const r of PESOS) {
      for (const h of PESOS) {
        const html = render({ boton_peso_reposo: r, boton_peso_hover: h });
        expect(html, `${r}/${h}`).toContain(`--bt-reposo: ${r};`);
        expect(html, `${r}/${h}`).toContain(`--bt-hover: ${h};`);
        expect(html, `${r}/${h}`).toContain(`--bt-ls: ${botonLsReposo(r, h)};`);
      }
    }
    for (const bad of ['350', '800', '100', '', 'bold', '400px', ' 400 ', '400; }', '<script>', null, undefined] as const) {
      const html = render({ boton_peso_reposo: bad, boton_peso_hover: bad } as unknown as Partial<Settings>);
      const label = JSON.stringify(bad);
      expect(html, label).toContain('--bt-reposo: 400;');
      expect(html, label).toContain('--bt-hover: 700;');
      expect(html, label).toContain('--bt-ls: 0.0109em;');
      expect(html, label).not.toContain('<script>');
    }
    const { boton_peso_reposo: _a, boton_peso_hover: _b, ...sinClaves } = settings();
    const viejo = renderPage({ settings: sinClaves as Settings, buttons: BUTTONS, socials: SOCIALS, landing }, {}).replace(/\r\n/g, '\n');
    expect(viejo).toBe(render());
    expect(layoutValues({ ...settings(), boton_peso_reposo: 400 } as unknown as Settings, 'experiencias').boton_peso_reposo_css).toBe('400');
  });

  it('cada botón lleva dos capas con la etiqueta escapada; la de hover es aria-hidden', () => {
    const label = '<b>"Spa" & Más</b>';
    const esc = '&lt;b&gt;&quot;Spa&quot; &amp; Más&lt;/b&gt;';
    const html = renderPage({ settings: settings(), buttons: [button(1, label, 'https://ejemplo.com/x')], socials: [], landing }, {}).replace(/\r\n/g, '\n');
    expect(html).toContain(`<span class="b-r">${esc}</span><span class="b-h" aria-hidden="true">${esc}</span></a>`);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain(label);
    const normal = render();
    expect(normal.match(/<span class="b-r">/g)).toHaveLength(3);
    expect(normal.match(/<span class="b-h" aria-hidden="true">/g)).toHaveLength(3);
    expect(render({}, { preview: true }).match(/<span class="b-h" aria-hidden="true">/g)).toHaveLength(3);
  });

  it('cartas (pagina.html) sigue con el botón de siempre: sin capas ni variables de peso', () => {
    const html = renderPage({ settings: defaultSettingsFor('cartas'), buttons: BUTTONS, socials: [], landing: { template: 'cartas' } }, {}).replace(/\r\n/g, '\n');
    for (const b of BUTTONS) expect(html).toContain(`<a class="boton" href="/go/${b.id}">${b.label}</a>`);
    for (const marca of ['class="b-r"', 'class="b-h"', '--bt-reposo', '--bt-hover', '--bt-ls']) expect(html).not.toContain(marca);
    // Sin plantilla indicada también es "cartas".
    expect(renderPage({ settings: defaultSettingsFor('cartas'), buttons: BUTTONS, socials: [] }, {})).not.toContain('class="b-r"');
  });

  it('CSS: capas en la misma celda, fundido con opacity y estados :hover (solo con hover real), foco y :active', () => {
    const html = render();
    const boton = html.match(/\.boton \{[^}]*\}/)![0];
    expect(boton).toContain('display: grid;');
    expect(boton).toContain('place-items: center;');
    expect(boton).not.toContain('font-weight'); // el peso lo ponen las capas
    // Lo que ya tenía el botón sigue igual.
    expect(boton).toContain('min-height: calc(var(--u) * 52);');
    expect(boton).toContain('padding: calc(var(--u) * 10) calc(var(--u) * 18);');
    expect(boton).toContain('border-radius: calc(var(--u) * 8);');
    expect(boton).toContain('box-shadow: 0 8px 22px -12px rgba(0, 0, 0, .7);');
    expect(boton).toContain('font-size: max(12px, calc(var(--u) * 15 * var(--s-botones)));');
    expect(boton).toContain('overflow-wrap: anywhere;');
    expect(boton).toContain('letter-spacing: .05em;');
    expect(boton).toContain('transition: background .2s, color .2s, transform .15s;');
    expect(html).toMatch(/\.boton:hover,\s*\.boton:focus-visible \{\s*background: var\(--boton-hover\);\s*color: var\(--texto-boton\);\s*transform: translateY\(-1px\);\s*\}/);

    expect(html).toMatch(/\.b-r,\s*\.b-h \{[^}]*grid-area: 1 \/ 1;[^}]*width: 100%;[^}]*text-align: center;[^}]*transition: opacity \.24s ease;[^}]*\}/);
    expect(html).toMatch(/\.b-r \{[^}]*font-weight: var\(--bt-reposo\);[^}]*letter-spacing: calc\(\.05em \+ var\(--bt-ls\)\);[^}]*\}/);
    expect(html).toMatch(/\.b-h \{[^}]*font-weight: var\(--bt-hover\);[^}]*letter-spacing: \.05em;[^}]*opacity: 0;[^}]*\}/);
    // Foco con teclado y al presionar (también en táctil).
    expect(html).toMatch(/\.boton:focus-visible \.b-r,\s*\.boton:active \.b-r \{ opacity: 0; \}/);
    expect(html).toMatch(/\.boton:focus-visible \.b-h,\s*\.boton:active \.b-h \{ opacity: 1; \}/);
    // :hover solo donde hay hover real (mouse); nunca fuera de esa media query.
    const media = '@media (hover: hover) and (pointer: fine) {\n    .boton:hover .b-r { opacity: 0; }\n    .boton:hover .b-h { opacity: 1; }\n  }';
    expect(html).toContain(media);
    expect(html.match(/\.boton:hover \.b-/g)).toHaveLength(2);
    expect(html.indexOf('.boton:hover .b-r')).toBeGreaterThan(html.indexOf('@media (hover: hover) and (pointer: fine)'));
    // Sin transición cuando el usuario pide menos movimiento.
    const reducido = html.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n  \}/)![0];
    expect(reducido).toMatch(/\.boton,\s*\.b-r,\s*\.b-h,\s*\.iconos a \{ transition: none; \}/);
    expect(reducido).toContain('.boton:focus-visible { transform: none; }');
    expect(html).not.toMatch(/\.boton \{[^}]*font-weight: 700/);
  });

  it('SOFIA_ANCHO_EM: 6 pesos, valores finitos y crecientes con el peso', () => {
    expect(Object.keys(SOFIA_ANCHO_EM).sort()).toEqual([...PESOS]);
    let prev = 0;
    for (const p of PESOS) {
      const v = SOFIA_ANCHO_EM[p];
      expect(Number.isFinite(v), p).toBe(true);
      expect(v, p).toBeGreaterThan(0.4);
      expect(v, p).toBeLessThan(0.8);
      expect(v, p).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('boton_ls_reposo_css: ancho[hover] − ancho[reposo] en em; 400→700 positivo y deja < 1 % de diferencia; iguales → 0em', () => {
    const ls = botonLsReposo('400', '700');
    expect(ls).toBe('0.0109em');
    expect(Number.parseFloat(ls)).toBeCloseTo(w('700') - w('400'), 4);
    // Ancho medio por carácter (avance + .05em de letter-spacing): reposo con compensación vs hover.
    const hover = w('700') + 0.05;
    const sinComp = Math.abs(w('400') + 0.05 - hover) / hover;
    const conComp = Math.abs(w('400') + 0.05 + Number.parseFloat(ls) - hover) / hover;
    expect(sinComp).toBeGreaterThan(0.01); // sin compensar el salto de ancho es > 1 %
    expect(conComp).toBeLessThan(0.01); // compensado, < 1 %
    // Iguales → 0em (nunca "-0.0000em"); hover más fino que reposo → negativo.
    for (const p of PESOS) expect(botonLsReposo(p, p), p).toBe('0em');
    expect(botonLsReposo('700', '400')).toBe('-0.0109em');
    expect(botonLsReposo('300', '900')).toBe('0.0220em');
    for (const r of PESOS) {
      for (const h of PESOS) {
        expect(botonLsReposo(r, h), `${r}→${h}`).toMatch(/^(0em|-?0\.\d{4}em)$/);
        expect(Math.sign(Number.parseFloat(botonLsReposo(r, h))), `${r}→${h}`).toBe(Math.sign(Number(h) - Number(r)));
      }
    }
    expect(layoutValues(settings({ boton_peso_reposo: '400', boton_peso_hover: '700' }), 'experiencias')).toMatchObject({
      boton_peso_reposo_css: '400', boton_peso_hover_css: '700', boton_ls_reposo_css: '0.0109em',
    });
    expect(layoutValues(settings({ boton_peso_reposo: '700', boton_peso_hover: '700' }), 'experiencias').boton_ls_reposo_css).toBe('0em');
    expect(render({ boton_peso_reposo: '700', boton_peso_hover: '700' })).toContain('--bt-ls: 0em;');
  });
});

describe('panel: peso del texto de los botones', () => {
  const cms = readFileSync(join(process.cwd(), 'templates', 'cms.html'), 'utf8');
  const js = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.js'), 'utf8');
  const opciones = ['300', 'Fino (300)', '400', 'Normal (400)', '500', 'Medio (500)', '600', 'Seminegrita (600)', '700', 'Negrita (700)', '900', 'Extranegrita (900)'];

  it('Diseño → Colores: dos selectores solo para experiencias, con etiqueta, opciones y pista, tras «Texto del botón»', () => {
    const block = cms.match(/<div class="peso-field" data-only="experiencias">[\s\S]*?<p class="hint" id="btn-peso-hint">[\s\S]*?<\/p>\s*<\/div>/)![0];
    for (const [id, key, label] of [
      ['btn-peso-reposo', 'boton_peso_reposo', 'Texto del botón en reposo'],
      ['btn-peso-hover', 'boton_peso_hover', 'Texto al pasar el mouse'],
    ]) {
      expect(block, id).toContain(`<label class="field-label" for="${id}">${label}</label>`);
      expect(block, id).toContain(`<select id="${id}" data-setting="${key}" aria-describedby="btn-peso-hint">`);
      const sel = block.match(new RegExp(`<select id="${id}"[\\s\\S]*?</select>`))![0];
      const opts = [...sel.matchAll(/<option value="(\d+)">([^<]+)<\/option>/g)].flatMap((m) => [m[1], m[2]]);
      expect(opts, id).toEqual(opciones);
    }
    expect(block).toContain('La letra cambia suavemente de un grosor al otro al pasar el mouse. Si eliges el mismo, no cambia.');
    // Va justo después de «Texto del botón» (color_boton_texto), dentro de la tarjeta Colores, y antes del botón al pasar el mouse.
    const i = cms.indexOf('id="btn-peso-reposo"');
    expect(i).toBeGreaterThan(cms.indexOf('data-color="color_boton_texto"'));
    expect(i).toBeLessThan(cms.indexOf('data-color="color_boton_hover"'));
    expect(i).toBeGreaterThan(cms.indexOf('fa-swatchbook'));
    expect(cms.indexOf('id="btn-peso-hover"')).toBeLessThan(cms.indexOf('data-color="color_boton_hover"'));
    // Ids únicos.
    for (const id of ['btn-peso-reposo', 'btn-peso-hover', 'btn-peso-hint']) expect(cms.match(new RegExp(`id="${id}"`, 'g')), id).toHaveLength(1);
  });

  it('cms.js: los selectores usan el cableado de data-setting (con default de state) y «Restablecer» de la tarjeta solo toca colores', () => {
    expect(js).toContain("$$('[data-setting]').forEach((input) => {");
    expect(js).toContain("input.value = state.settings[key] ?? state.defaults?.[key] ?? '';");
    expect(js).toContain("const COLOR_KEYS = ['color_fondo', 'color_texto', 'color_boton', 'color_boton_texto', 'color_boton_hover', 'color_texto_boton_hover'];");
    expect(js).not.toContain('boton_peso');
    const css = readFileSync(join(process.cwd(), 'public', 'assets', 'cms', 'cms.css'), 'utf8');
    expect(css).toMatch(/\.peso-field \.field select \{[^}]*min-width: 0;[^}]*max-width: 100%;/);
  });
});
