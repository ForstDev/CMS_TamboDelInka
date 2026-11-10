// Fotos de fondo del login: lista efectiva, validación de enlaces y HTML de las capas.

import { afterEach, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { fondosHtml, LOGIN_FONDOS, loginFondos } from '../src/loginConfig.js';

const producciónOriginal = env.production;

afterEach(() => {
  delete process.env.LOGIN_FONDOS;
  env.production = producciónOriginal;
});

const conEntorno = (...urls: string[]) => {
  process.env.LOGIN_FONDOS = urls.join(',');
  return loginFondos();
};

describe('loginFondos()', () => {
  it('por defecto la lista está vacía (solo degradado)', () => {
    expect(LOGIN_FONDOS).toEqual([]);
    expect(loginFondos()).toEqual([]);
  });

  it('la variable de entorno LOGIN_FONDOS manda y admite varios enlaces separados por coma', () => {
    process.env.LOGIN_FONDOS = ' https://cdn.example.com/a.jpg , https://cdn.example.com/b.webp ,, ';
    expect(loginFondos()).toEqual(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.webp']);
  });

  it('una variable vacía o solo con espacios usa la constante', () => {
    process.env.LOGIN_FONDOS = '   ';
    expect(loginFondos()).toEqual([]);
  });

  it('conserva como máximo 6 enlaces, en orden', () => {
    const urls = Array.from({ length: 9 }, (_, i) => `https://cdn.example.com/${i}.jpg`);
    expect(conEntorno(...urls)).toEqual(urls.slice(0, 6));
  });

  it('descarta javascript:, data:, rutas relativas y otros protocolos', () => {
    expect(
      conEntorno(
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        '/uploads/fondo.jpg',
        'fondo.jpg',
        '//cdn.example.com/a.jpg',
        'ftp://cdn.example.com/a.jpg',
        'file:///etc/passwd',
        'https://cdn.example.com/ok.jpg',
      ),
    ).toEqual(['https://cdn.example.com/ok.jpg']);
  });

  it('http: solo se admite fuera de producción', () => {
    env.production = false;
    expect(conEntorno('http://localhost:3000/a.jpg')).toEqual(['http://localhost:3000/a.jpg']);
    env.production = true;
    expect(conEntorno('http://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg')).toEqual(['https://cdn.example.com/b.jpg']);
  });

  it('rechaza comillas, paréntesis, espacios, signos de HTML e inyección de CSS', () => {
    expect(
      conEntorno(
        'https://cdn.example.com/a".jpg',
        "https://cdn.example.com/a'.jpg",
        'https://cdn.example.com/a(1).jpg',
        'https://cdn.example.com/a b.jpg',
        'https://cdn.example.com/a.jpg);background:red',
        'https://cdn.example.com/a.jpg"><script>alert(1)</script>',
        'https://cdn.example.com/a\\.jpg',
        'https://cdn.example.com/a`.jpg',
        'https://usuario:clave@cdn.example.com/a.jpg',
        'https://cdn.example.com/b%20c.jpg',
      ),
    ).toEqual(['https://cdn.example.com/b%20c.jpg']);
  });
});

describe('fondosHtml()', () => {
  it('sin fotos no genera capas', () => {
    expect(fondosHtml([])).toBe('');
  });

  it('genera una capa por foto con el enlace escapado', () => {
    const html = fondosHtml(['https://cdn.example.com/a.jpg?x=1&y=2', 'https://cdn.example.com/b.jpg']);
    expect(html).toBe(
      '<div class="fondo-slide" data-src="https://cdn.example.com/a.jpg?x=1&amp;y=2"></div>' +
        '<div class="fondo-slide" data-src="https://cdn.example.com/b.jpg"></div>',
    );
  });

  it('aunque llegara un enlace con comillas, no puede salirse del atributo', () => {
    expect(fondosHtml(['https://x.com/a"onload="alert(1)'])).not.toContain('"onload');
  });
});
