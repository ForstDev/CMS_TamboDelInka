// Vista previa del panel (solo plantilla "experiencias"): arrastrar el logo en horizontal.
// Script clásico, sin dependencias. NUNCA se incluye en la página pública (lo decide renderPage con opts.preview).
//
// El desplazamiento (--logo-x) va en % del ancho de .marca y es relativo al preajuste (izquierda/centro/derecha).
// Al soltar, si cambió, avisa UNA vez al panel con postMessage({ type: 'cms-logo-x', value }) y el panel lo guarda.
(function () {
  'use strict';

  var MIN = -50;
  var MAX = 50;
  var EPS = 1e-6; // tolerancia de coma flotante en los límites

  /**
   * Función pura: nuevo desplazamiento (entero, en % de .marca) tras arrastrar `deltaPx`, acotado para que el logo no
   * se salga de .marca y a [-50, 50].
   *   startPct  desplazamiento al empezar el arrastre (% de .marca)
   *   deltaPx   movimiento horizontal del puntero desde que empezó (px de la página)
   *   marcaW    ancho de .marca (px)
   *   logoLeft0 borde izquierdo del logo con desplazamiento 0, medido desde el borde izquierdo de .marca (px)
   *   logoW     ancho del logo (px)
   */
  function computeLogoX(startPct, deltaPx, marcaW, logoLeft0, logoW) {
    var start = Number(startPct);
    if (!isFinite(start)) start = 0;
    var dx = Number(deltaPx);
    if (!isFinite(dx)) dx = 0;
    var W = Number(marcaW);
    if (!(W > 0)) return Math.min(MAX, Math.max(MIN, Math.round(start))) + 0; // sin medidas: no se mueve
    var left0 = Number(logoLeft0);
    if (!isFinite(left0)) left0 = 0;
    var w = Number(logoW);
    if (!isFinite(w) || w < 0) w = 0;

    // Enteros permitidos: borde izquierdo del logo >= borde izquierdo de .marca y borde derecho <= borde derecho.
    var lo = Math.max(MIN, Math.ceil((-left0 / W) * 100 - EPS));
    var hi = Math.min(MAX, Math.floor(((W - left0 - w) / W) * 100 + EPS));
    if (lo > hi) return 0; // el logo ocupa todo el ancho: no hay por dónde moverlo

    var value = Math.round(start + (dx / W) * 100);
    return Math.min(hi, Math.max(lo, value)) + 0; // "+ 0" evita -0
  }

  // Para pruebas (Node): se puede cargar el archivo sin navegador.
  if (typeof module !== 'undefined' && module && module.exports) module.exports = { computeLogoX: computeLogoX };

  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  var logo = document.querySelector('.logo');
  var marca = document.querySelector('.marca');
  if (!logo || !marca) return; // sin logo no hay nada que arrastrar

  // Solo en la vista previa: cursor, contorno sutil al pasar y sin gestos del navegador sobre el logo.
  var style = document.createElement('style');
  style.textContent =
    '.logo{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-user-drag:none;}' +
    '.logo:hover,.logo.is-dragging{outline:1px dashed rgba(255,255,255,.75);outline-offset:4px;}' +
    '.logo.is-dragging{cursor:grabbing;}';
  (document.head || document.documentElement).appendChild(style);

  function readX() {
    var raw = parseFloat(window.getComputedStyle(logo).getPropertyValue('--logo-x'));
    return isFinite(raw) ? raw : 0;
  }

  function setX(value) {
    logo.style.setProperty('--logo-x', String(value));
  }

  var drag = null;

  logo.addEventListener('dragstart', function (e) {
    e.preventDefault();
  });

  logo.addEventListener('pointerdown', function (e) {
    if (drag || e.isPrimary === false) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var m = marca.getBoundingClientRect();
    var l = logo.getBoundingClientRect();
    if (!(m.width > 0)) return;
    var start = readX();
    drag = {
      id: e.pointerId,
      x0: e.clientX,
      start: start,
      value: start,
      marcaW: m.width,
      // La posición base (con desplazamiento 0) depende del preajuste: se saca de las posiciones reales.
      left0: l.left - m.left - (start / 100) * m.width,
      logoW: l.width
    };
    try {
      logo.setPointerCapture(e.pointerId);
    } catch (err) {}
    logo.classList.add('is-dragging');
    e.preventDefault();
  });

  logo.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var next = computeLogoX(drag.start, e.clientX - drag.x0, drag.marcaW, drag.left0, drag.logoW);
    if (next !== drag.value) {
      drag.value = next;
      setX(next);
    }
  });

  function finish(e, commit) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    logo.classList.remove('is-dragging');
    try {
      logo.releasePointerCapture(e.pointerId);
    } catch (err) {}
    if (!commit) {
      setX(d.start); // cancelado: vuelve a donde estaba
      return;
    }
    var origin = window.origin;
    if (d.value !== d.start && window.parent && window.parent !== window && origin && origin !== 'null') {
      // En un iframe srcdoc location.origin es "null"; window.origin es el origen real (mismo que el del panel).
      window.parent.postMessage({ type: 'cms-logo-x', value: d.value }, origin);
    }
  }

  logo.addEventListener('pointerup', function (e) {
    finish(e, true);
  });
  logo.addEventListener('pointercancel', function (e) {
    finish(e, false);
  });
  logo.addEventListener('lostpointercapture', function (e) {
    finish(e, false); // se perdió la captura sin soltar: se cancela (tras pointerup, drag ya es null)
  });
})();
