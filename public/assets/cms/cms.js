// CMS — lógica del panel. Sin framework: estado en memoria + API REST + autoguardado.

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

/** Crea elementos de forma segura (el texto nunca se interpreta como HTML). */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const icon = (cls) => h('i', { class: cls, 'aria-hidden': 'true' });
/** replaceChildren que ignora null/false (para hijos condicionales). */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const state = {
  settings: {},
  defaults: {},
  buttons: [],
  socials: [],
  networks: [],
  uploadRules: {},
  stats: null,
  days: 30,
  landing: null, // { id, slug, name, hotel, template, is_default, url } de la landing en edición
  landings: [],
};
const netByKey = () => Object.fromEntries(state.networks.map((n) => [n.key, n]));

/** localStorage envuelto: puede no existir o fallar (modo privado, datos bloqueados). */
const pref = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};
const LANDING_KEY = 'cms-landing';
const DEVICE_KEY = 'cms-preview-device';

/** Id de la landing en edición; viaja en cada llamada a la API (cabecera X-Landing-Id). */
let landingId = '';
/** "?landing=<id>" / "&landing=<id>" para enlaces y peticiones sin cabecera. */
const landingParam = (sep = '?') => (landingId ? `${sep}landing=${encodeURIComponent(landingId)}` : '');

// ---------------------------------------------------------------------------
// API y autoguardado
// ---------------------------------------------------------------------------

async function api(method, url, body, opts = {}) {
  const headers = body !== undefined ? { 'Content-Type': 'application/json' } : {};
  if (landingId) headers['X-Landing-Id'] = landingId;
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive: opts.keepalive,
  });
  if (res.status === 401) {
    location.href = '/cms_login';
    throw new Error('Tu sesión expiró.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'No se pudo conectar con el servidor.');
    err.status = res.status;
    throw err;
  }
  return data;
}

const pill = $('#save-pill');
let inFlight = 0;
const timers = new Map();

function setSave(stateName, message) {
  pill.dataset.state = stateName;
  const icons = { saving: 'fa-solid fa-rotate', saved: 'fa-solid fa-circle-check', idle: 'fa-solid fa-circle-check', error: 'fa-solid fa-circle-exclamation' };
  const texts = { saving: 'Guardando…', saved: 'Publicado', idle: 'Todo guardado', error: 'Error al guardar' };
  pill.replaceChildren(icon(icons[stateName]), h('span', { text: message || texts[stateName] }));
  pill.title = message || '';
}

/** Ejecuta una escritura mostrando el estado de guardado y refresca la vista previa. */
async function save(work) {
  inFlight++;
  setSave('saving');
  try {
    const result = await work();
    inFlight--;
    if (!inFlight && !timers.size) {
      setSave('saved');
      invalidateThumb(landingId); // la miniatura de la landing actual quedó vieja
      schedulePreview();
    }
    return result;
  } catch (err) {
    inFlight--;
    setSave('error');
    toast(err.message, 'error');
    throw err;
  }
}

/** Agrupa cambios rápidos (al escribir) en una sola escritura. */
function debounced(key, fn, ms = 550) {
  clearTimeout(timers.get(key));
  setSave('saving');
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      fn();
    }, ms),
  );
}

window.addEventListener('beforeunload', (e) => {
  flushDeletes();
  if (timers.size || inFlight) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function toast(message, type = 'ok', { action, onAction, duration = 3200 } = {}) {
  const icons = { ok: 'fa-solid fa-circle-check', error: 'fa-solid fa-circle-exclamation', info: 'fa-solid fa-circle-info' };
  const el = h('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, icon(icons[type]), h('span', { class: 'toast-msg', text: message }));
  let timer;
  const close = () => {
    clearTimeout(timer);
    el.remove();
  };
  if (action) {
    el.append(h('button', { type: 'button', text: action, onclick: () => { onAction?.(); close(); } }));
  }
  $('#toasts').append(el);
  timer = setTimeout(close, type === 'error' ? Math.max(duration, 5000) : duration);
  return close;
}

function fmtSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Completa https:// si falta y valida. Devuelve { value, error }. */
function normalizeUrl(raw, { allowMailto = false } = {}) {
  let v = raw.trim();
  if (!v) return { value: '' };
  if (allowMailto && /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v)) v = `mailto:${v}`;
  if (!/^[a-z]+:/i.test(v) && /^[\w-]+(\.[\w-]+)+/.test(v)) v = `https://${v}`;
  if (/^https?:\/\/[^\s"'<>.]+\.[^\s"'<>]+$/i.test(v)) return { value: v };
  if (allowMailto && /^mailto:[^\s"'<>]+@[^\s"'<>]+$/i.test(v)) return { value: v };
  return { value: v, error: allowMailto ? 'Escribe un enlace (https://…) o un correo.' : 'Escribe un enlace válido, por ejemplo https://…' };
}

function hostOf(url) {
  try {
    return new URL(url, location.origin).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function setFieldError(field, message) {
  field.classList.toggle('has-error', Boolean(message));
  let err = $('.field-error', field);
  if (message) {
    if (!err) field.append((err = h('span', { class: 'field-error' })));
    err.textContent = message;
  } else err?.remove();
}

function segmented(options, value, onChange, extraClass = '') {
  const wrap = h('div', { class: `segmented ${extraClass}`, role: 'radiogroup' });
  const sync = (v) => $$('button', wrap).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v)));
  for (const o of options) {
    wrap.append(
      h('button', { type: 'button', role: 'radio', dataset: { value: o.value }, onclick: () => { sync(o.value); onChange(o.value); } }, o.icon ? icon(o.icon) : null, o.label),
    );
  }
  sync(value);
  return wrap;
}

function wireSegmented(wrap, value, onChange) {
  const sync = (v) => $$('button', wrap).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === String(v))));
  $$('button', wrap).forEach((b) => b.addEventListener('click', () => { sync(b.dataset.value); onChange(b.dataset.value); }));
  sync(value);
  return sync;
}

function switchEl(checked, label, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, 'aria-label': label });
  input.addEventListener('change', () => onChange(input.checked, input));
  return h('label', { class: 'switch', title: label }, input, h('span'));
}

// ---------------------------------------------------------------------------
// Subida de archivos (directa al almacenamiento, con barra de progreso)
// ---------------------------------------------------------------------------

function isSameOrigin(url) {
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
    // Solo a nuestro servidor: una URL firmada de otro dominio rechazaría la cabecera extra (CORS).
    if (landingId && isSameOrigin(url)) xhr.setRequestHeader('X-Landing-Id', landingId);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      let msg = 'No se pudo subir el archivo.';
      try {
        msg = JSON.parse(xhr.responseText).error || JSON.parse(xhr.responseText).message || msg;
      } catch {}
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión al subir el archivo.'));
    xhr.send(file);
  });
}

async function uploadFile(file, purpose, onProgress) {
  const rule = state.uploadRules[purpose];
  let type = file.type;
  if (!type && purpose === 'pdf' && /\.pdf$/i.test(file.name)) type = 'application/pdf';
  if (!rule.types.includes(type)) throw new Error(`Formato no permitido. Usa ${rule.label}.`);
  if (file.size > rule.maxBytes) throw new Error(`El archivo pesa ${fmtSize(file.size)}. Máximo: ${rule.label}.`);
  const target = await api('POST', '/api/cms/uploads', { purpose, fileName: file.name, contentType: type, size: file.size });
  await putFile(target.uploadUrl, file, type, onProgress);
  return target;
}

/** Hace que un elemento acepte archivos arrastrados. */
function acceptDrops(el, onFile) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.classList.add('is-over');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-over'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('is-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

function progressBar() {
  const bar = h('span');
  const wrap = h('div', { class: 'progress', hidden: true }, bar);
  return {
    el: wrap,
    set(p) {
      wrap.hidden = false;
      bar.style.width = `${Math.round(p * 100)}%`;
    },
    done() {
      wrap.hidden = true;
      bar.style.width = '0';
    },
  };
}

// ---------------------------------------------------------------------------
// Vista previa en vivo
// ---------------------------------------------------------------------------

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 120);
}

async function refreshPreview() {
  const full = $('#preview-frame-full');
  const frames = [$('#preview-frame'), $('#preview-frame-mobile')].filter((f) => f && f.offsetParent !== null);
  if ($('#dlg-preview').open) frames.push(full);
  // La miniatura del selector (si ya se abrió la lista) también aprovecha este pedido.
  const wantThumb = thumbs.activated && landingId && !thumbs.cache.has(landingId);
  if (!frames.length && !wantThumb) return;
  const gen = thumbGen(landingId);
  try {
    const res = await fetch(`/api/cms/preview${landingParam('?')}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.text();
    if (thumbs.activated && gen === thumbGen(landingId)) putThumb(landingId, html);
    for (const f of frames) {
      let y = 0;
      try {
        y = f.contentWindow?.scrollY || 0;
      } catch {}
      f.onload = () => {
        try {
          f.contentWindow?.scrollTo(0, y);
        } catch {}
      };
      f.srcdoc = html;
    }
  } catch {}
}

$('#open-preview').addEventListener('click', () => {
  $('#preview-sheet').hidden = false;
  document.body.style.overflow = 'hidden';
  layoutDevices();
  refreshPreview();
});
$('#close-preview').addEventListener('click', () => {
  $('#preview-sheet').hidden = true;
  document.body.style.overflow = '';
});

// ---------- Vista previa ampliada (diálogo, escritorio) ----------

const fullDlg = $('#dlg-preview');
$('#open-full-preview').addEventListener('click', () => {
  fullDlg.showModal();
  document.body.style.overflow = 'hidden';
  layoutFullPreview();
  refreshPreview();
});
$('#dlg-preview-close').addEventListener('click', () => fullDlg.close());
fullDlg.addEventListener('close', () => {
  document.body.style.overflow = '';
  $('#open-full-preview').focus(); // Esc o la X: el foco vuelve a "Ampliar"
});
window.matchMedia('(min-width: 1280px)').addEventListener('change', () => {
  layoutDevices();
  schedulePreview();
});

// ---------- Celular / PC ----------

const PC_W = 1366;
const PC_H = 768;
const MONITOR_BORDER = 8;
/** Celular: pantalla lógica fija (iframe) y marco de teléfono alrededor. */
const PHONE_W = 390;
const PHONE_H = 844;
const PHONE_PAD = 12;
/** Aire alrededor del teléfono, en px lógicos (se escala junto con el marco). */
const PHONE_MARGIN = 24;

/**
 * Escala de la vista previa del panel derecho y de la hoja (celular/tablet).
 * Celular: el marco de (390+24)×(844+24) se escala entero con
 *   k = min(1, ancho/(414+margen), alto/(868+margen)) → caja de boxW×boxH px.
 * PC: la página de 1366×768 se escala dentro de un monitor de borde fijo (8 px):
 *   k = min(1, (ancho−16)/1366, (alto−16)/768) → pantalla de width×height px.
 */
function deviceScale(mode, availW, availH) {
  const W = Math.max(0, Number(availW) || 0);
  const H = Math.max(0, Number(availH) || 0);
  if (mode === 'pc') {
    const b = MONITOR_BORDER * 2;
    const k = Math.max(0, Math.min(1, (W - b) / PC_W, (H - b) / PC_H));
    const width = Math.floor(PC_W * k);
    const height = Math.floor(PC_H * k);
    return { k, frameW: PC_W, frameH: PC_H, width, height, boxW: width + b, boxH: height + b };
  }
  const outerW = PHONE_W + PHONE_PAD * 2;
  const outerH = PHONE_H + PHONE_PAD * 2;
  const k = Math.max(0, Math.min(1, W / (outerW + PHONE_MARGIN), H / (outerH + PHONE_MARGIN)));
  return { k, frameW: PHONE_W, frameH: PHONE_H, width: PHONE_W * k, height: PHONE_H * k, boxW: Math.floor(outerW * k), boxH: Math.floor(outerH * k) };
}

/**
 * Miniatura de una landing: la página se dibuja a 1366 px de ancho y se escala a `width`.
 * El alto del iframe se estira lo justo para cubrir cajas más altas que 16:9 (p. ej. 16:10).
 */
function thumbScale(width, height, baseW = PC_W, baseH = PC_H) {
  const w = Math.max(1, Number(width) || 0);
  const k = w / baseW;
  return { k, frameW: baseW, frameH: Math.max(baseH, Math.round((Number(height) || 0) / k)) };
}

/**
 * Escala de la vista previa ampliada.
 * El marco no se escala (PC: borde 10 px; celular: padding 12 px), así que se descuenta entero:
 * PC: iframe 1440×900, k = min(1, (ancho−20)/1440, (alto−20)/900).
 * Celular: iframe 390×844, k = min(1, (ancho−24)/390, (alto−24)/844).
 */
function fullPreviewScale(mode, availW, availH) {
  const W = Math.max(0, Number(availW) || 0);
  const H = Math.max(0, Number(availH) || 0);
  const pc = mode === 'pc';
  const frameW = pc ? 1440 : PHONE_W;
  const frameH = pc ? 900 : PHONE_H;
  const b = pc ? 20 : PHONE_PAD * 2;
  const k = Math.max(0, Math.min(1, (W - b) / frameW, (H - b) / frameH));
  return { k, frameW, frameH, width: Math.floor(frameW * k), height: Math.floor(frameH * k) };
}

/** Ajusta la escala del diálogo de vista previa ampliada (si está abierto). */
function layoutFullPreview() {
  const dlg = $('#dlg-preview');
  if (!dlg?.open) return;
  const body = $('#dlg-preview-body');
  const cs = getComputedStyle(body);
  const availW = body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = body.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const { k, width, height } = fullPreviewScale(previewDevice, availW, availH);
  const stage = $('#dlg-preview-stage');
  stage.style.setProperty('--k', String(k));
  stage.style.setProperty('--sw', `${width}px`);
  stage.style.setProperty('--sh', `${height}px`);
}

let previewDevice = pref.get(DEVICE_KEY) === 'pc' ? 'pc' : 'mobile';
const deviceSyncs = $$('.device-seg').map((seg) => wireSegmented(seg, previewDevice, (v) => setPreviewDevice(v)));

function setPreviewDevice(value) {
  previewDevice = value === 'pc' ? 'pc' : 'mobile';
  pref.set(DEVICE_KEY, previewDevice);
  deviceSyncs.forEach((sync) => sync(previewDevice));
  applyPreviewDevice();
}

function applyPreviewDevice() {
  document.body.dataset.device = previewDevice;
  layoutDevices();
}

/** Tamaño útil (sin padding) de un contenedor visible; 0×0 si está oculto. */
function contentBox(el) {
  if (!el || !el.clientWidth || !el.clientHeight) return { w: 0, h: 0 };
  const cs = getComputedStyle(el);
  return {
    w: el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
    h: el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom),
  };
}

/** [contenedor que se mide, caja que se escala]: panel derecho (≥1280 px) y hoja de celular/tablet. */
const DEVICE_TARGETS = [
  ['#preview-fit', '#preview-box'],
  ['#sheet-body', '#sheet-box'],
];

/** Escala el celular (390×844) o el "monitor" (1366×768) al espacio real de cada vista previa visible. */
function layoutDevices() {
  for (const [fitSel, boxSel] of DEVICE_TARGETS) {
    const box = $(boxSel);
    const { w, h } = contentBox($(fitSel));
    if (!box || w <= 0 || h <= 0) continue; // oculto: se recalcula cuando vuelva a verse (ResizeObserver)
    const s = deviceScale(previewDevice, w, h);
    box.style.setProperty('--k', String(s.k));
    if (previewDevice === 'pc') {
      box.style.setProperty('--mon-w', `${s.width}px`);
      box.style.setProperty('--mon-h', `${s.height}px`);
    } else {
      box.style.setProperty('--box-w', `${s.boxW}px`);
      box.style.setProperty('--box-h', `${s.boxH}px`);
    }
  }
  layoutFullPreview();
}

let layoutFrame = 0;
function scheduleLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(layoutDevices);
}
// El zoom del navegador dispara `resize`; el observador cubre además los cambios de tamaño de cada
// contenedor (paneles que se muestran u ocultan, la hoja al abrirse, el diálogo "Ampliar").
window.addEventListener('resize', scheduleLayout);
if (typeof ResizeObserver === 'function') {
  const ro = new ResizeObserver(scheduleLayout);
  ['#preview-fit', '#sheet-body', '#dlg-preview-body'].forEach((sel) => {
    const el = $(sel);
    if (el) ro.observe(el);
  });
}
applyPreviewDevice();

// ---------------------------------------------------------------------------
// Navegación
// ---------------------------------------------------------------------------

const TITLES = { botones: 'Botones', diseno: 'Diseño', textos: 'Textos', redes: 'Redes', estadisticas: 'Estadísticas' };
let currentTab = '';

function showTab(name) {
  if (!TITLES[name]) name = 'botones';
  currentTab = name;
  document.body.dataset.tab = name;
  $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
  $$('[data-tab]').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === name);
    if (a.dataset.tab === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('#panel-title').textContent = TITLES[name];
  document.title = `${TITLES[name]} · ${state.landing?.name || state.settings.cms_nombre || 'Panel'}`;
  window.scrollTo({ top: 0 });
  if (name === 'estadisticas') {
    loadStats().catch(() => {});
    startLive();
  } else {
    stopLive();
    layoutDevices(); // el panel de vista previa pudo volver a mostrarse
    if (!$('#preview-frame').srcdoc) schedulePreview(); // la vista previa estaba oculta en Estadísticas
  }
}

window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

// ---------------------------------------------------------------------------
// Ajustes (textos, colores, logo, fondo)
// ---------------------------------------------------------------------------

function saveSetting(key, value, { immediate = false } = {}) {
  state.settings[key] = value;
  applyBindings();
  const run = () => save(() => api('PATCH', '/api/cms/settings', { [key]: value })).catch(() => {});
  if (immediate) run();
  else debounced(`setting:${key}`, run);
}

function applyBindings() {
  const s = state.settings;
  $$('[data-bind]').forEach((el) => (el.textContent = s[el.dataset.bind] ?? ''));
  $$('[data-counter-for]').forEach((el) => (el.textContent = `${(s[el.dataset.counterFor] || '').length}/300`));
  $('.serp-url').textContent = `${location.host} › `;
  $('.serp-title').textContent = s.titulo_pagina || 'Sin título';
  $('.serp-desc').textContent = s.meta_descripcion || 'Sin descripción: Google mostrará un fragmento de la página.';
  const nov = $('#novedades-preview');
  if (s.novedades_activo === '1') {
    fill(nov, h('span', { class: 'mini-label', text: 'Así se ve:' }), h('p', { style: `color:${s.color_texto}` }, `${s.novedades_texto} `, h('u', { style: 'font-weight:700', text: s.novedades_link_texto })));
  } else fill(nov, h('span', { class: 'mini-label', text: 'Este bloque está oculto en la página.' }));
  nov.classList.toggle('is-off', s.novedades_activo !== '1');
  nov.style.backgroundColor = s.color_fondo;
  nov.style.backgroundImage = s.fondo_tipo === 'imagen' && s.fondo_imagen_url ? `url("${s.fondo_imagen_url}")` : 'none';
  renderDesignPreview();
}

function bindSettings() {
  $$('[data-setting]').forEach((input) => {
    const key = input.dataset.setting;
    input.value = state.settings[key] ?? state.defaults?.[key] ?? '';
    const field = input.closest('.field');
    const isUrl = input.type === 'url';
    input.addEventListener('input', () => {
      if (isUrl) {
        const { value, error } = normalizeUrl(input.value);
        setFieldError(field, error && input.value.trim() ? error : '');
        if (error) return;
        saveSetting(key, value);
      } else saveSetting(key, input.value);
    });
    if (isUrl) {
      input.addEventListener('blur', () => {
        const { value, error } = normalizeUrl(input.value);
        if (!error && value !== input.value) {
          input.value = value;
          saveSetting(key, value);
        }
      });
    }
  });
  $$('[data-setting-flag]').forEach((input) => {
    const key = input.dataset.settingFlag;
    input.checked = state.settings[key] === '1';
    input.addEventListener('change', () => saveSetting(key, input.checked ? '1' : '0', { immediate: true }));
  });
}

// ---------- Diseño ----------

const COLOR_KEYS = ['color_fondo', 'color_texto', 'color_boton', 'color_boton_texto', 'color_boton_hover', 'color_texto_boton_hover'];
const colorInputs = {};

function renderDesign() {
  // Colores
  $$('.color-row[data-color]').forEach((row) => {
    const key = row.dataset.color;
    const picker = h('input', { type: 'color', value: state.settings[key], 'aria-label': row.querySelector('strong').textContent });
    const hex = h('input', { class: 'input', type: 'text', value: state.settings[key].toUpperCase(), maxlength: 7, spellcheck: 'false', 'aria-label': 'Código de color' });
    picker.addEventListener('input', () => {
      hex.value = picker.value.toUpperCase();
      saveSetting(key, picker.value.toLowerCase());
    });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (!v.startsWith('#')) v = `#${v}`;
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        picker.value = v.toLowerCase();
        saveSetting(key, v.toLowerCase());
      }
    });
    hex.addEventListener('blur', () => (hex.value = state.settings[key].toUpperCase()));
    colorInputs[key] = { picker, hex };
    row.append(h('div', { class: 'color-input' }, picker, hex));
  });

  $('#reset-colors').addEventListener('click', () => {
    const before = Object.fromEntries(COLOR_KEYS.map((k) => [k, state.settings[k]]));
    const defaults = Object.fromEntries(COLOR_KEYS.map((k) => [k, state.defaults[k]]));
    applyColors(defaults);
    toast('Colores restablecidos', 'ok', { action: 'Deshacer', onAction: () => applyColors(before), duration: 6000 });
  });

  // Fondo
  const syncBg = wireSegmented($('#bg-type'), state.settings.fondo_tipo, (v) => {
    saveSetting('fondo_tipo', v, { immediate: true });
    renderDesignPreview();
  });
  state._syncBg = syncBg;

  wireImageUpload($('#bg-file'), 'fondo', $('#bg-progress'), (url) => {
    state.settings.fondo_tipo = 'imagen';
    syncBg('imagen');
    save(() => api('PATCH', '/api/cms/settings', { fondo_imagen_url: url, fondo_tipo: 'imagen' })).then(() => {
      state.settings.fondo_imagen_url = url;
      renderDesignPreview();
      toast('Fondo actualizado');
    });
  });
  acceptDrops($('#focus-stage'), (file) => handleImage(file, 'fondo', $('#bg-progress'), (url) => saveSetting('fondo_imagen_url', url, { immediate: true })));

  // Punto focal (encuadre de la foto, en celular y en PC)
  const frame = $('#focus-frame');
  frame.addEventListener('click', (e) => {
    const { x, y } = focusFromPoint(e.clientX, e.clientY, $('#focus-img').getBoundingClientRect());
    saveFocus(x, y);
  });
  $('#focus-dot').addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
    if (!step) return;
    e.preventDefault();
    saveFocus(clampPct(clampPct(state.settings.fondo_foco_x) + step[0]), clampPct(clampPct(state.settings.fondo_foco_y) + step[1]));
  });
  $('#focus-center').addEventListener('click', () => saveFocus(50, 50));

  // Logo
  wireImageUpload($('#logo-file'), 'logo', $('#logo-progress'), (url) => {
    saveSetting('logo_url', url, { immediate: true });
    toast('Logo actualizado');
  });
  acceptDrops($('#logo-stage'), (file) => handleImage(file, 'logo', $('#logo-progress'), (url) => saveSetting('logo_url', url, { immediate: true })));
  $('#logo-remove').addEventListener('click', () => {
    const before = state.settings.logo_url;
    if (!before) return;
    saveSetting('logo_url', '', { immediate: true });
    toast('Logo quitado', 'ok', { action: 'Deshacer', onAction: () => saveSetting('logo_url', before, { immediate: true }), duration: 6000 });
  });

  // Tamaño (deslizador con data-setting="logo_ancho", se guarda solo) y posición del logo
  // En "experiencias", al elegir un preajuste el ajuste fino vuelve a 0 (misma petición); en las demás plantillas no existe.
  state._syncLogoPos = wireSegmented($('#logo-pos'), state.settings.logo_posicion || 'center', (v) => {
    if (hasLogoX()) applyLogoLayout({ logo_posicion: v, logo_x: '0' });
    else saveSetting('logo_posicion', v, { immediate: true });
  });
  $('#logo-reset').addEventListener('click', () => {
    const before = { logo_ancho: state.settings.logo_ancho, logo_posicion: state.settings.logo_posicion };
    const defaults = { logo_ancho: state.defaults.logo_ancho || '260', logo_posicion: state.defaults.logo_posicion || 'center' };
    if (hasLogoX()) {
      before.logo_x = state.settings.logo_x ?? '0';
      defaults.logo_x = '0';
    }
    applyLogoLayout(defaults);
    toast('Tamaño y posición restablecidos', 'ok', { action: 'Deshacer', onAction: () => applyLogoLayout(before), duration: 6000 });
  });

  // Ajuste fino horizontal (solo "experiencias"): el deslizador (data-setting="logo_x") se guarda solo.
  $('#logo-x-center').addEventListener('click', () => setLogoX(0));

  // Tamaño de los textos (solo "experiencias"): los tres deslizadores (data-setting) se guardan solos.
  $('#txt-reset').addEventListener('click', () => {
    const before = Object.fromEntries(TEXT_SCALE_KEYS.map((k) => [k, state.settings[k] ?? '100']));
    applyTextScales(Object.fromEntries(TEXT_SCALE_KEYS.map((k) => [k, '100'])));
    toast('Tamaños de texto restablecidos', 'ok', { action: 'Deshacer', onAction: () => applyTextScales(before), duration: 6000 });
  });

  renderDesignPreview();
}

/** Anula un autoguardado pendiente (si no, mandaría un valor viejo después). */
function cancelDebounced(key) {
  clearTimeout(timers.get(key));
  timers.delete(key);
}

/** Aplica y guarda (en una sola petición) las claves de diseño del logo que vengan en `values`. */
function applyLogoLayout(values) {
  for (const key of Object.keys(values)) cancelDebounced(`setting:${key}`);
  Object.assign(state.settings, values);
  if (values.logo_ancho !== undefined) $('#logo-size').value = values.logo_ancho;
  if (values.logo_posicion !== undefined) state._syncLogoPos?.(values.logo_posicion);
  applyBindings(); // también refresca el control del ajuste fino (renderDesignPreview)
  save(() => api('PATCH', '/api/cms/settings', values)).catch(() => {});
}

// ---------- Tamaño de los textos y degradado de celular (plantilla "experiencias") ----------

const TEXT_SCALE_KEYS = ['texto_titulo_escala', 'texto_botones_escala', 'texto_redes_escala'];
/** Deslizadores con salida en %: clave del ajuste → [id del deslizador, mínimo, máximo, valor por defecto]. */
const PCT_SLIDERS = {
  texto_titulo_escala: ['txt-titulo', 70, 140, 100],
  texto_botones_escala: ['txt-botones', 70, 140, 100],
  texto_redes_escala: ['txt-redes', 70, 140, 100],
  degradado_celular: ['grad-celular', 0, 100, 70],
};

/** Entero acotado (basura → por defecto). */
function clampInt(n, min, max, fallback) {
  if (n === '' || n == null) return fallback;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

/** Aplica y guarda (en una sola petición) los tamaños de texto que vengan en `values`. */
function applyTextScales(values) {
  for (const key of Object.keys(values)) cancelDebounced(`setting:${key}`);
  Object.assign(state.settings, values);
  for (const key of Object.keys(values)) {
    const spec = PCT_SLIDERS[key];
    if (spec) $(`#${spec[0]}`).value = values[key];
  }
  applyBindings(); // también refresca las salidas (renderDesignPreview)
  save(() => api('PATCH', '/api/cms/settings', values)).catch(() => {});
}

/** Salida «100 %» y texto accesible de cada deslizador en %. */
function renderPctSliders() {
  for (const [key, [id, min, max, def]] of Object.entries(PCT_SLIDERS)) {
    const input = $(`#${id}`);
    const out = $(`#${id}-value`);
    if (!input || !out) continue;
    const v = clampInt(state.settings[key] ?? state.defaults?.[key], min, max, def);
    if (input.value !== String(v)) input.value = String(v);
    out.textContent = `${v} %`;
    input.setAttribute('aria-valuetext', `${v} %`);
  }
}

// ---------- Ajuste fino horizontal del logo (plantilla "experiencias") ----------

const LOGO_X_MIN = -50;
const LOGO_X_MAX = 50;
/** Solo la plantilla "experiencias" tiene ajuste fino horizontal. */
const hasLogoX = () => state.landing?.template === 'experiencias';

/** Entero −50…50 (basura → 0). */
function clampLogoX(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(LOGO_X_MAX, Math.max(LOGO_X_MIN, v)) + 0 : 0;
}

/** "+12 %", "−8 %", "0 %". */
function fmtLogoX(n) {
  const v = clampLogoX(n);
  return v === 0 ? '0 %' : `${v > 0 ? '+' : '−'}${Math.abs(v)} %`;
}

/** Guarda al instante un nuevo desplazamiento (botón «Centrar» o arrastre en la vista previa). */
function setLogoX(value) {
  if (!hasLogoX()) return;
  cancelDebounced('setting:logo_x'); // un guardado pendiente del deslizador mandaría un valor viejo después
  saveSetting('logo_x', String(clampLogoX(value)), { immediate: true });
}

/** Iframes de vista previa conocidos: panel lateral, hoja (celular/tablet) y diálogo «Ampliar». */
const previewFrames = () => ['#preview-frame', '#preview-frame-mobile', '#preview-frame-full'].map((sel) => $(sel)).filter(Boolean);

// El logo se arrastra dentro de la vista previa (preview-drag.js) y avisa aquí al soltarlo.
window.addEventListener('message', (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== 'cms-logo-x') return;
  if (!event.source || !previewFrames().some((f) => f.contentWindow === event.source)) return;
  const v = data.value;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < LOGO_X_MIN || v > LOGO_X_MAX) return;
  setLogoX(v); // no dispara eventos del control: no hay bucle de guardado
});

/** Entero 0–100 (los valores del encuadre). */
function clampPct(n) {
  if (n === '' || n == null) return 50;
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 50;
}

/** Convierte un clic (coordenadas de pantalla) en el % de la foto, acotado a 0–100. */
function focusFromPoint(clientX, clientY, rect) {
  if (!rect || !rect.width || !rect.height) return { x: 50, y: 50 };
  return {
    x: clampPct(((clientX - rect.left) / rect.width) * 100),
    y: clampPct(((clientY - rect.top) / rect.height) * 100),
  };
}

/** Guarda el encuadre (los dos valores en una sola escritura, con espera). */
function saveFocus(x, y) {
  state.settings.fondo_foco_x = String(clampPct(x));
  state.settings.fondo_foco_y = String(clampPct(y));
  applyBindings();
  debounced('setting:fondo_foco', () =>
    save(() => api('PATCH', '/api/cms/settings', { fondo_foco_x: state.settings.fondo_foco_x, fondo_foco_y: state.settings.fondo_foco_y })).catch(() => {}),
  );
}

function applyColors(values) {
  Object.assign(state.settings, values);
  for (const [k, v] of Object.entries(values)) {
    colorInputs[k].picker.value = v;
    colorInputs[k].hex.value = v.toUpperCase();
  }
  applyBindings();
  save(() => api('PATCH', '/api/cms/settings', values)).catch(() => {});
}

function wireImageUpload(input, purpose, progressEl, onDone) {
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (file) handleImage(file, purpose, progressEl, onDone);
  });
}

async function handleImage(file, purpose, progressEl, onDone) {
  const bar = progressEl.firstElementChild;
  progressEl.hidden = false;
  bar.style.width = '0';
  try {
    const target = await uploadFile(file, purpose, (p) => (bar.style.width = `${Math.round(p * 100)}%`));
    onDone(target.publicUrl);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    progressEl.hidden = true;
  }
}

function renderDesignPreview() {
  const s = state.settings;
  renderPctSliders();
  const bgImage = s.fondo_tipo === 'imagen' && s.fondo_imagen_url ? `url("${s.fondo_imagen_url}")` : 'none';
  const logo = $('#logo-img');
  if (logo) {
    logo.hidden = !s.logo_url;
    if (s.logo_url) logo.src = s.logo_url;
    logo.alt = s.logo_alt || '';
    $('#logo-empty').hidden = Boolean(s.logo_url);
    $('#logo-remove').disabled = !s.logo_url;
    $('#logo-stage').style.backgroundColor = s.color_fondo;
    $('#logo-stage').style.backgroundImage = bgImage;
    // Tamaño proporcional (400 px = todo el ancho de la muestra) y posición.
    const ancho = Math.min(400, Math.max(60, Number(s.logo_ancho) || Number(state.defaults.logo_ancho) || 260));
    logo.style.width = `${(ancho / 400) * 100}%`;
    $('#logo-stage').style.justifyItems = { left: 'start', right: 'end' }[s.logo_posicion] || 'center';
    $('#logo-size-value').textContent = `${ancho} px`;
    // Ajuste fino horizontal (solo se ve en "experiencias"; si la clave falta, 0).
    const lx = clampLogoX(s.logo_x ?? 0);
    const lxInput = $('#logo-x');
    if (lxInput.value !== String(lx)) lxInput.value = String(lx);
    lxInput.setAttribute('aria-valuetext', lx === 0 ? 'Sin ajuste' : `${Math.abs(lx)} % a la ${lx > 0 ? 'derecha' : 'izquierda'}`);
    $('#logo-x-value').textContent = fmtLogoX(lx);
  }
  const focusStage = $('#focus-stage');
  if (focusStage) {
    $('#bg-image-block').hidden = s.fondo_tipo !== 'imagen';
    const img = $('#focus-img');
    const hasImg = Boolean(s.fondo_imagen_url);
    $('#focus-frame').hidden = !hasImg;
    $('#focus-empty').hidden = hasImg;
    $('#focus-center').disabled = !hasImg;
    if (hasImg && img.getAttribute('src') !== s.fondo_imagen_url) img.src = s.fondo_imagen_url;
    const x = clampPct(s.fondo_foco_x);
    const y = clampPct(s.fondo_foco_y);
    const dot = $('#focus-dot');
    dot.style.left = `${x}%`;
    dot.style.top = `${y}%`;
    dot.setAttribute('aria-valuenow', String(x));
    dot.setAttribute('aria-valuetext', `${x}% desde la izquierda, ${y}% desde arriba. Usa las flechas para moverlo.`);
  }
  const sample = $('#btn-sample');
  if (sample) {
    sample.style.backgroundColor = s.color_fondo;
    sample.style.backgroundImage = bgImage;
    $('.sample-label', sample).style.color = s.color_texto;
    const [normal, hover] = $$('.sample-btn', sample);
    Object.assign(normal.style, { background: s.color_boton, color: s.color_boton_texto, borderColor: '#cccccc' });
    Object.assign(hover.style, { background: s.color_boton_hover, color: s.color_texto_boton_hover, borderColor: s.color_boton_hover });
  }
}

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------

const openItems = new Set();
const pendingDeletes = new Map();

function clicksFor(id) {
  return state.stats?.ranking.find((r) => r.id === id)?.clicks ?? null;
}

function renderButtons() {
  const list = $('#buttons-list');
  list.replaceChildren(...state.buttons.map(buttonItem));
  $('#buttons-empty').hidden = state.buttons.length > 0;
  renderButtonsSummary();
}

function renderButtonsSummary() {
  const visible = state.buttons.filter((b) => b.active && b.url).length;
  const hidden = state.buttons.filter((b) => !b.active && b.url).length;
  const missing = state.buttons.filter((b) => !b.url).length;
  fill(
    $('#buttons-summary'),
    h('span', { class: 'chip ok' }, icon('fa-solid fa-eye'), `${visible} visibles`),
    hidden ? h('span', { class: 'chip' }, icon('fa-solid fa-eye-slash'), `${hidden} ocultos`) : null,
    missing ? h('span', { class: 'chip warn' }, icon('fa-solid fa-triangle-exclamation'), `${missing} sin destino`) : null,
  );
}

function buttonItem(b) {
  const li = h('li', { class: 'item', dataset: { id: b.id } });
  const title = h('span', { class: 'item-title' });
  const sub = h('span', { class: 'item-sub' });
  const badge = h('span', { class: 'clicks-badge', title: `Clics en los últimos ${state.days} días` });
  const toggle = switchEl(b.active, 'Mostrar en la página', async (checked, input) => {
    if (checked && !b.url) {
      input.checked = false;
      toast('Primero agrega un PDF o un enlace a este botón.', 'info');
      openItem(true);
      return;
    }
    b.active = checked;
    refreshHead();
    renderButtonsSummary();
    try {
      await save(() => api('PATCH', `/api/cms/buttons/${b.id}`, { active: checked }));
      toast(checked ? `"${b.label}" ahora es visible` : `"${b.label}" quedó oculto`, 'ok', { duration: 2000 });
    } catch {
      b.active = !checked;
      input.checked = !checked;
      refreshHead();
      renderButtonsSummary();
    }
  });
  const main = h('button', { type: 'button', class: 'item-main', 'aria-expanded': 'false', title: 'Editar este botón' }, title, sub);
  const editText = h('span', { class: 'edit-text', text: 'Editar' });
  const chev = h('button', { type: 'button', class: 'btn btn-ghost btn-sm edit-btn', 'aria-label': 'Editar botón' }, icon('fa-solid fa-pen'), editText);
  const swText = h('span', { class: 'switch-text' });
  const body = h('div', { class: 'item-body', hidden: true });

  function refreshHead() {
    title.textContent = b.label || 'Sin nombre';
    const visible = b.active && b.url;
    li.classList.toggle('is-off', !visible);
    swText.textContent = visible ? 'Visible' : 'Oculto';
    swText.classList.toggle('off', !visible);
    toggle.querySelector('input').checked = Boolean(b.active);
    if (!b.url) {
      sub.className = 'item-sub warn';
      sub.replaceChildren(icon('fa-solid fa-triangle-exclamation'), h('span', { text: 'Sin destino: agrega un PDF o enlace' }));
    } else {
      sub.className = 'item-sub';
      const isPdf = b.kind === 'pdf';
      fill(
        sub,
        icon(isPdf ? 'fa-solid fa-file-pdf' : 'fa-solid fa-link'),
        h('span', { text: isPdf ? b.file_name || hostOf(b.url) : hostOf(b.url) }),
        !b.active ? h('span', { class: 'only-mobile', text: '· oculto' }) : null,
      );
    }
    const n = clicksFor(b.id);
    badge.hidden = n === null;
    badge.replaceChildren(icon('fa-solid fa-arrow-pointer'), String(n ?? 0), h('span', { class: 'badge-word', text: ` clic${n === 1 ? '' : 's'}` }));
  }

  function openItem(open) {
    if (open && !body.childElementCount) body.append(...buttonBody(b, refreshHead));
    body.hidden = !open;
    li.classList.toggle('is-open', open);
    main.setAttribute('aria-expanded', String(open));
    editText.textContent = open ? 'Cerrar' : 'Editar';
    chev.replaceChildren(icon(open ? 'fa-solid fa-xmark' : 'fa-solid fa-pen'), editText);
    chev.setAttribute('aria-label', open ? 'Cerrar edición' : 'Editar botón');
    if (open) openItems.add(b.id);
    else openItems.delete(b.id);
  }

  main.addEventListener('click', () => openItem(body.hidden));
  chev.addEventListener('click', () => openItem(body.hidden));

  li.append(
    h('div', { class: 'item-row' }, h('span', { class: 'handle', 'aria-hidden': 'true', title: 'Arrastra para ordenar' }, icon('fa-solid fa-grip-vertical')), main, badge, h('span', { class: 'switch-wrap' }, swText, toggle), chev),
    body,
  );
  li._refresh = refreshHead;
  refreshHead();
  if (openItems.has(b.id)) openItem(true);
  return li;
}

function patchButton(b, patch, refreshHead) {
  const wasEmpty = !b.url;
  if (patch.url && wasEmpty && !b.active) patch.active = true; // al darle destino por primera vez, se publica
  Object.assign(b, patch);
  refreshHead();
  renderButtonsSummary();
  return save(() => api('PATCH', `/api/cms/buttons/${b.id}`, patch)).then((r) => {
    Object.assign(b, r.button);
    refreshHead();
    renderButtonsSummary();
    if (patch.active && wasEmpty) toast(`"${b.label}" ya está visible en la página`);
    return r;
  });
}

function buttonBody(b, refreshHead) {
  // Nombre
  const labelField = h('label', { class: 'field' }, h('span', { class: 'field-label step' }, h('span', {}, h('b', { class: 'step-n', text: '1' }), 'Nombre del botón'), h('small', { text: 'En la página se ve en mayúsculas' })));
  const labelInput = h('input', { type: 'text', value: b.label, maxlength: 80, autocomplete: 'off' });
  labelField.append(labelInput);
  labelInput.addEventListener('input', () => {
    const v = labelInput.value.trim();
    setFieldError(labelField, v ? '' : 'El botón necesita un nombre');
    if (!v) return;
    b.label = v;
    refreshHead();
    debounced(`btn-label:${b.id}`, () => save(() => api('PATCH', `/api/cms/buttons/${b.id}`, { label: v })).catch(() => {}));
  });

  // Destino
  const dest = h('div');
  const destLabel = h('span', { class: 'field-label step', style: 'margin-top:18px' }, h('span', {}, h('b', { class: 'step-n', text: '2' }), '¿Qué se abre al tocarlo?'));
  const seg = segmented(
    [
      { value: 'pdf', label: 'Archivo PDF', icon: 'fa-regular fa-file-pdf' },
      { value: 'link', label: 'Enlace web', icon: 'fa-solid fa-link' },
    ],
    b.kind,
    (v) => {
      b.kind = v;
      renderDest();
    },
  );
  seg.style.marginTop = '8px';

  function renderDest() {
    dest.replaceChildren(b.kind === 'pdf' ? pdfArea() : linkArea());
  }

  function pdfArea() {
    const wrap = h('div');
    const bar = progressBar();
    const status = h('div', { class: 'upload-state', hidden: true }, h('span'), bar.el);
    const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });

    async function onFile(file) {
      status.hidden = false;
      status.firstChild.textContent = `Subiendo ${file.name} (${fmtSize(file.size)})…`;
      bar.set(0);
      try {
        const t = await uploadFile(file, 'pdf', (p) => bar.set(p));
        status.firstChild.textContent = 'Guardando…';
        await patchButton(b, { kind: 'pdf', url: t.publicUrl, file_name: file.name, file_path: t.path }, refreshHead);
        toast('PDF actualizado: la página ya muestra la carta nueva');
        renderDest();
      } catch (err) {
        toast(err.message, 'error');
        status.hidden = true;
      }
    }
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      input.value = '';
      if (f) onFile(f);
    });

    const hasPdf = b.kind === 'pdf' && b.url;
    if (hasPdf) {
      const card = h(
        'div',
        { class: 'file-card' },
        h('span', { class: 'file-icon' }, icon('fa-solid fa-file-pdf')),
        h('span', { class: 'file-info' }, h('strong', { text: b.file_name || hostOf(b.url) }), h('a', { href: b.url, target: '_blank', rel: 'noopener' }, 'Ver PDF ', icon('fa-solid fa-arrow-up-right-from-square'))),
        h('label', { class: 'btn btn-secondary btn-sm file-btn' }, icon('fa-solid fa-arrow-right-arrow-left'), 'Reemplazar', input),
      );
      acceptDrops(card, onFile);
      wrap.append(card);
    } else {
      const zone = h(
        'label',
        { class: 'dropzone' },
        icon('fa-solid fa-cloud-arrow-up'),
        h('strong', { text: 'Sube la carta en PDF' }),
        h('span', { text: 'Toca para elegir o arrastra el archivo aquí · máx. 25 MB' }),
        input,
      );
      acceptDrops(zone, onFile);
      wrap.append(zone);
    }
    wrap.append(status);
    return wrap;
  }

  function linkArea() {
    const field = h('label', { class: 'field' }, h('span', { class: 'field-label', text: 'Enlace' }));
    const input = h('input', { type: 'url', inputmode: 'url', placeholder: 'https://…', value: b.kind === 'link' ? b.url : '' });
    field.append(input);
    const commit = (value) =>
      debounced(`btn-url:${b.id}`, () => patchButton(b, { kind: 'link', url: value, file_name: '', file_path: '' }, refreshHead).catch(() => {}), 700);
    input.addEventListener('input', () => {
      const { value, error } = normalizeUrl(input.value);
      setFieldError(field, error && input.value.trim() ? error : '');
      if (!error && value) commit(value);
    });
    input.addEventListener('blur', () => {
      const { value, error } = normalizeUrl(input.value);
      if (!error && value !== input.value) input.value = value;
    });
    return h('div', {}, field, h('p', { class: 'hint', style: 'margin-top:6px' }, 'Puede ser una página web, un formulario o un PDF alojado en otro sitio.'));
  }

  renderDest();

  const optLabel = h('span', { class: 'field-label step', style: 'margin-top:18px' }, h('span', {}, h('b', { class: 'step-n', text: '3' }), 'Opciones'));
  const newTabInput = h('input', { type: 'checkbox', checked: b.new_tab });
  const newTab = h('label', { class: 'check', style: 'margin-top:8px' }, newTabInput, h('span', {}, 'Abrir en una pestaña nueva', h('small', { class: 'muted', text: ' (si no, se abre en la misma)' })));
  newTabInput.addEventListener('change', () => patchButton(b, { new_tab: newTabInput.checked }, refreshHead).catch(() => {}));

  const idx = () => state.buttons.indexOf(b);
  const foot = h(
    'div',
    { class: 'item-foot' },
    h(
      'div',
      { class: 'move-btns' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Subir', onclick: () => moveButton(idx(), -1) }, icon('fa-solid fa-arrow-up'), 'Subir'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Bajar', onclick: () => moveButton(idx(), 1) }, icon('fa-solid fa-arrow-down'), 'Bajar'),
    ),
    h('button', { type: 'button', class: 'btn btn-danger-ghost btn-sm', onclick: () => removeButton(b) }, icon('fa-regular fa-trash-can'), 'Eliminar botón'),
  );

  return [labelField, destLabel, seg, dest, optLabel, newTab, foot];
}

function saveButtonOrder() {
  renderButtons();
  return save(() => api('PUT', '/api/cms/buttons/order', { ids: state.buttons.map((b) => b.id) })).catch(() => {});
}

function moveButton(i, delta) {
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.buttons.length) return;
  [state.buttons[i], state.buttons[j]] = [state.buttons[j], state.buttons[i]];
  saveButtonOrder();
}

function removeButton(b) {
  const index = state.buttons.indexOf(b);
  state.buttons.splice(index, 1);
  openItems.delete(b.id);
  renderButtons();
  scheduleDelete(`/api/cms/buttons/${b.id}`, `Se eliminó "${b.label}"`, () => {
    state.buttons.splice(index, 0, b);
    renderButtons();
  });
}

/** Elimina después de unos segundos, para poder deshacer. */
function scheduleDelete(url, message, undo) {
  const run = () => {
    pendingDeletes.delete(url);
    save(() => api('DELETE', url)).catch(() => {});
  };
  const timer = setTimeout(run, 6000);
  pendingDeletes.set(url, timer);
  toast(message, 'info', {
    action: 'Deshacer',
    duration: 6000,
    onAction: () => {
      clearTimeout(timer);
      pendingDeletes.delete(url);
      undo();
    },
  });
}

function flushDeletes() {
  for (const [url, timer] of pendingDeletes) {
    clearTimeout(timer);
    api('DELETE', url, undefined, { keepalive: true }).catch(() => {});
  }
  pendingDeletes.clear();
}
window.addEventListener('pagehide', flushDeletes);

$('#add-button').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const { button } = await save(() => api('POST', '/api/cms/buttons', { label: 'Nuevo botón' }));
    state.buttons.push(button);
    openItems.add(button.id);
    renderButtons();
    const li = $(`#buttons-list [data-id="${button.id}"]`);
    li?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const input = $('input[type="text"]', li);
    input?.focus();
    input?.select();
    toast('Botón creado: ponle nombre y súbele su PDF');
  } catch {
  } finally {
    btn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Redes sociales
// ---------------------------------------------------------------------------

const PLACEHOLDERS = {
  facebook: 'https://facebook.com/tu-pagina',
  instagram: 'https://instagram.com/tu-cuenta',
  tiktok: 'https://tiktok.com/@tu-cuenta',
  youtube: 'https://youtube.com/@tu-canal',
  whatsapp: 'https://wa.me/51999999999',
  x: 'https://x.com/tu-cuenta',
  linkedin: 'https://linkedin.com/company/…',
  tripadvisor: 'https://tripadvisor.com/…',
  pinterest: 'https://pinterest.com/…',
  spotify: 'https://open.spotify.com/…',
  web: 'https://',
  email: 'reservas@tuempresa.com',
};

function renderSocials() {
  $('#socials-list').replaceChildren(...state.socials.map(socialItem));
  $('#socials-empty').hidden = state.socials.length > 0;
}

function socialItem(s) {
  const nets = netByKey();
  const iconWrap = h('span', { class: 'net-icon' }, icon(nets[s.network]?.icon || 'fa-solid fa-link'));
  const select = h('select', { class: 'input', 'aria-label': 'Red social' }, ...state.networks.map((n) => h('option', { value: n.key, selected: n.key === s.network }, n.label)));
  const field = h('label', { class: 'field', style: 'margin:0' });
  const input = h('input', { type: 'url', class: 'input', inputmode: 'url', placeholder: PLACEHOLDERS[s.network] || 'https://', value: s.url, 'aria-label': 'Enlace' });
  field.append(input);
  const li = h('li', { class: 'item social-item', dataset: { id: s.id } });
  const status = h('span', { class: 'social-status' });
  const badge = h('span', { class: 'clicks-badge social-clicks', hidden: true });

  const refreshBadge = () => {
    const sc = state.stats?.socials;
    badge.hidden = !sc;
    if (!sc) return;
    const n = (Array.isArray(sc.ranking) ? sc.ranking : []).find((r) => r.id === s.id)?.clicks ?? 0;
    badge.title = `Clics en los últimos ${state.days} días`;
    badge.replaceChildren(icon('fa-solid fa-arrow-pointer'), String(n), h('span', { class: 'badge-word', text: ` clic${n === 1 ? '' : 's'}` }));
  };

  const refresh = () => {
    refreshBadge();
    li.classList.toggle('is-off', !s.active || !s.url);
    iconWrap.replaceChildren(icon(nets[s.network]?.icon || 'fa-solid fa-link'));
    input.placeholder = PLACEHOLDERS[s.network] || 'https://';
    if (!s.url) {
      status.className = 'social-status warn';
      fill(status, icon('fa-solid fa-triangle-exclamation'), 'Falta el enlace: no aparece en la página');
    } else if (!s.active) {
      status.className = 'social-status';
      fill(status, icon('fa-solid fa-eye-slash'), 'Oculta en la página');
    } else {
      status.className = 'social-status ok';
      fill(status, icon('fa-solid fa-eye'), 'Visible en la página');
    }
  };

  select.addEventListener('change', () => {
    s.network = select.value;
    refresh();
    save(() => api('PATCH', `/api/cms/socials/${s.id}`, { network: s.network })).catch(() => {});
  });
  const allowMailto = () => s.network === 'email';
  input.addEventListener('input', () => {
    const { value, error } = normalizeUrl(input.value, { allowMailto: allowMailto() });
    setFieldError(field, error && input.value.trim() ? error : '');
    if (error) return;
    s.url = value;
    refresh();
    debounced(`social:${s.id}`, () => save(() => api('PATCH', `/api/cms/socials/${s.id}`, { url: value })).catch(() => {}), 700);
  });
  input.addEventListener('blur', () => {
    const { value, error } = normalizeUrl(input.value, { allowMailto: allowMailto() });
    if (!error && value !== input.value) input.value = value;
  });

  const toggle = switchEl(s.active, 'Mostrar en la página', (checked) => {
    s.active = checked;
    refresh();
    save(() => api('PATCH', `/api/cms/socials/${s.id}`, { active: checked })).catch(() => {});
  });
  const del = h('button', { type: 'button', class: 'icon-btn plain danger', 'aria-label': 'Eliminar red' }, icon('fa-regular fa-trash-can'));
  del.addEventListener('click', () => {
    const index = state.socials.indexOf(s);
    state.socials.splice(index, 1);
    renderSocials();
    scheduleDelete(`/api/cms/socials/${s.id}`, `Se quitó ${nets[s.network]?.label || 'la red'}`, () => {
      state.socials.splice(index, 0, s);
      renderSocials();
    });
  });

  li.append(
    h(
      'div',
      { class: 'item-row' },
      h('span', { class: 'handle', 'aria-hidden': 'true', title: 'Arrastra para ordenar' }, icon('fa-solid fa-grip-vertical')),
      h('div', { class: 'social-fields' }, h('div', { style: 'display:flex;gap:10px;align-items:center' }, iconWrap, select), field, status, badge),
      h('div', { class: 'social-actions' }, toggle, del),
    ),
  );
  li._refresh = refresh;
  refresh();
  return li;
}

function renderNetworkPicker() {
  const picker = $('#network-picker');
  picker.replaceChildren(
    ...state.networks.map((n) =>
      h(
        'button',
        {
          type: 'button',
          onclick: async () => {
            picker.hidden = true;
            try {
              const { social } = await save(() => api('POST', '/api/cms/socials', { network: n.key }));
              state.socials.push(social);
              renderSocials();
              const input = $(`#socials-list [data-id="${social.id}"] input[type="url"]`);
              input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              input?.focus();
            } catch {}
          },
        },
        icon(n.icon),
        n.label,
      ),
    ),
  );
}

$('#add-social').addEventListener('click', () => {
  const picker = $('#network-picker');
  picker.hidden = !picker.hidden;
});

// ---------------------------------------------------------------------------
// Estadísticas (en vivo)
// ---------------------------------------------------------------------------

const DEVICE = {
  mobile: { label: 'Celular', color: '#26615f', icon: 'fa-solid fa-mobile-screen' },
  tablet: { label: 'Tablet', color: '#c8a24a', icon: 'fa-solid fa-tablet-screen-button' },
  desktop: { label: 'Computadora', color: '#9fb5b2', icon: 'fa-solid fa-desktop' },
};
const charts = {};
let liveTimer = null;
let lastTotal = null;

async function loadStats() {
  const stats = await api('GET', `/api/cms/stats?days=${state.days}`);
  state.stats = stats;
  renderStats();
  $$('#buttons-list > li').forEach((li) => li._refresh?.());
  $$('#socials-list > li').forEach((li) => li._refresh?.());
}

function startLive() {
  stopLive();
  liveTimer = setInterval(() => {
    if (!document.hidden && currentTab === 'estadisticas') loadStats().catch(() => {});
  }, 8000);
  $('#live-pill').classList.remove('paused');
}
function stopLive() {
  clearInterval(liveTimer);
  liveTimer = null;
}
document.addEventListener('visibilitychange', () => {
  $('#live-pill').classList.toggle('paused', document.hidden);
  if (!document.hidden && currentTab === 'estadisticas') loadStats().catch(() => {});
});

const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
const plural = (n, one, many) => `${n.toLocaleString('es-PE')} ${n === 1 ? one : many}`;

function dayLabel(iso, long = false) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { day: 'numeric', month: 'short' });
}

function renderStats() {
  const s = state.stats;
  if (!s) return;
  const ranked = s.ranking.filter((r) => r.clicks > 0);
  const top = ranked[0];
  const mobile = s.devices.find((d) => d.device === 'mobile')?.clicks ?? 0;

  const totalEl = $('#kpi-total');
  totalEl.textContent = s.total.toLocaleString('es-PE');
  if (lastTotal !== null && s.total > lastTotal) {
    totalEl.classList.remove('bump');
    void totalEl.offsetWidth;
    totalEl.classList.add('bump');
  }
  lastTotal = s.total;
  $('#kpi-total-sub').textContent = `en ${s.days} días · ${plural(s.allTime, 'clic', 'clics')} desde el inicio`;
  $('#kpi-top').textContent = top ? top.label : '—';
  $('#kpi-top-sub').textContent = top ? `${plural(top.clicks, 'clic', 'clics')} · ${pct(top.clicks, s.total)}% del total` : 'Aún sin clics';
  $('#kpi-today').textContent = s.today.toLocaleString('es-PE');
  $('#kpi-mobile').textContent = s.total ? `${pct(mobile, s.total)}%` : '—';
  $('#kpi-mobile-sub').textContent = s.total ? `${mobile} de ${s.total} clics` : 'sin datos';

  // Frase que resume lo más importante
  const insight = $('#insight');
  if (!s.total) {
    insight.replaceChildren(icon('fa-regular fa-lightbulb'), h('p', { text: 'Todavía no hay clics en este periodo. Cuando tu público use la página, aquí verás qué cartas busca más, desde qué dispositivo y a qué hora.' }));
  } else {
    const second = ranked[1];
    const peakHour = s.hours.reduce((a, b) => (b.clicks > a.clicks ? b : a), s.hours[0]);
    const topDevice = s.devices[0];
    insight.replaceChildren(
      icon('fa-regular fa-lightbulb'),
      h(
        'p',
        {},
        `En los últimos ${s.days} días lo más buscado es `,
        h('strong', { text: `«${top.label}»` }),
        ` con ${pct(top.clicks, s.total)}% de los clics.`,
        second ? ` Le sigue «${second.label}».` : '',
        topDevice ? ` La mayoría entra desde ${DEVICE[topDevice.device]?.label.toLowerCase() || topDevice.device}` : '',
        peakHour?.clicks ? ` y la hora con más movimiento es alrededor de las ${String(peakHour.hour).padStart(2, '0')}:00.` : '.',
      ),
    );
  }

  // Ranking
  const max = Math.max(1, ...s.ranking.map((r) => r.clicks));
  $('#ranking').replaceChildren(
    ...s.ranking.map((r, i) =>
      h(
        'li',
        {},
        h('span', { class: 'rank-pos', text: i + 1 }),
        h('span', { class: 'rank-label', title: r.label }, r.label, r.deleted ? h('small', { text: ' (eliminado)' }) : !r.active ? h('small', { text: ' (oculto)' }) : null),
        h('span', { class: 'rank-count' }, r.clicks.toLocaleString('es-PE'), h('small', { text: `${pct(r.clicks, s.total)}%` })),
        h('span', { class: 'rank-bar' }, h('span', { style: `width:${(r.clicks / max) * 100}%` })),
      ),
    ),
  );

  // Dispositivos
  const devTotal = s.devices.reduce((a, d) => a + d.clicks, 0);
  $('#device-bar').replaceChildren(...s.devices.map((d) => h('span', { style: `width:${pct(d.clicks, devTotal)}%;background:${DEVICE[d.device]?.color}`, title: DEVICE[d.device]?.label })));
  $('#device-legend').replaceChildren(
    ...['mobile', 'desktop', 'tablet'].map((key) => {
      const n = s.devices.find((d) => d.device === key)?.clicks ?? 0;
      return h('li', {}, h('span', { class: 'sw', style: `background:${DEVICE[key].color}` }), icon(DEVICE[key].icon), DEVICE[key].label, h('b', { text: `${n} · ${pct(n, devTotal)}%` }));
    }),
  );

  renderSocialStats(s);

  $('#export-csv').href = `/api/cms/stats.csv?days=${s.days}${landingParam('&')}`;
  renderCharts(s);
}

// ---------- Redes sociales: tarjetas de vidrio + gráfico de líneas ----------

/** Color fijo por red (nunca por posición). El resto, las eliminadas y "Otras", en gris. */
const SOCIAL_COLORS = {
  facebook: '#3987e5',
  instagram: '#d95926',
  tiktok: '#199e70',
  youtube: '#c98500',
  whatsapp: '#d55181',
  x: '#008300',
  linkedin: '#9085e9',
  tripadvisor: '#e66767',
};
const SOCIAL_GRAY = '#c3c2b7';
/** Trazo por orden de aparición (además del color), y vuelve a empezar. */
const SOCIAL_DASHES = [[], [6, 4], [2, 3], [10, 4], [4, 2, 1, 2]];
/** Máximo de líneas en el gráfico; si hay más series, desde la 8.ª se suman en "Otras". */
const SOCIAL_MAX_SERIES = 8;
const SOCIAL_BG = '#1d4b49'; // color del fondo de la sección (anillo del punto al pasar el mouse)

const socialColor = (network, deleted) => (!deleted && SOCIAL_COLORS[network]) || SOCIAL_GRAY;
const socialDash = (i) => SOCIAL_DASHES[i % SOCIAL_DASHES.length];

/** Ajusta una serie al largo de stats.daily (rellena con 0 o recorta; valores no numéricos = 0). */
function alignSeries(data, length) {
  const src = Array.isArray(data) ? data : [];
  return Array.from({ length: Math.max(0, length | 0) }, (_, i) => {
    const n = Number(src[i]);
    return Number.isFinite(n) && n > 0 ? n : 0;
  });
}

/**
 * Series del gráfico (sin DOM), en el orden que manda el servidor.
 * null si la API no trae `series` (entonces se ocultan el gráfico y la leyenda).
 */
function socialSeries(socials, daily, networks) {
  if (!socials || !Array.isArray(socials.series)) return null;
  const len = Array.isArray(daily) ? daily.length : 0;
  const nets = Object.fromEntries((networks || []).map((n) => [n.key, n]));
  let rows = socials.series.map((s) => {
    const deleted = Boolean(s?.deleted);
    const network = String(s?.network || '');
    const label = String(s?.label || nets[network]?.label || network || 'Red');
    const data = alignSeries(s?.data, len);
    return {
      key: s?.id != null ? `id:${s.id}` : `del:${network}:${label}`,
      network,
      deleted,
      label,
      suffix: deleted ? ' (eliminada)' : '',
      icon: nets[network]?.icon || 'fa-solid fa-link',
      data,
      total: data.reduce((a, b) => a + b, 0),
      other: false,
    };
  });
  if (rows.length > SOCIAL_MAX_SERIES) {
    const keep = rows.slice(0, SOCIAL_MAX_SERIES - 1);
    const rest = rows.slice(SOCIAL_MAX_SERIES - 1);
    const data = Array.from({ length: len }, (_, i) => rest.reduce((a, r) => a + r.data[i], 0));
    keep.push({ key: 'otras', network: '', deleted: false, label: 'Otras', suffix: '', icon: 'fa-solid fa-ellipsis', data, total: data.reduce((a, b) => a + b, 0), other: true });
    rows = keep;
  }
  return rows.map((r, i) => ({ ...r, color: r.other ? SOCIAL_GRAY : socialColor(r.network, r.deleted), dash: socialDash(i) }));
}

/** Tarjetas de indicadores: una por red con clics o activa (sin DOM). */
function socialCards(socials, networks) {
  const total = Number(socials?.total) || 0;
  const ranking = Array.isArray(socials?.ranking) ? socials.ranking : [];
  const nets = Object.fromEntries((networks || []).map((n) => [n.key, n]));
  return ranking
    .filter((r) => (Number(r.clicks) || 0) > 0 || (r.active && !r.deleted))
    .map((r) => {
      const clicks = Number(r.clicks) || 0;
      return {
        id: r.id,
        icon: nets[r.network]?.icon || 'fa-solid fa-link',
        label: r.label || nets[r.network]?.label || r.network || 'Red',
        suffix: r.deleted ? ' (eliminada)' : !r.active ? ' (oculta)' : '',
        clicks,
        pct: total ? Math.round((clicks / total) * 100) : 0,
      };
    });
}

/** Muestra del trazo para la leyenda (14 px, mismo color y patrón que la línea). */
function dashSwatch(color, dash) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'sd-swatch');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '10');
  svg.setAttribute('viewBox', '0 0 14 10');
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(NS, 'line');
  line.setAttribute('x1', '0');
  line.setAttribute('y1', '5');
  line.setAttribute('x2', '14');
  line.setAttribute('y2', '5');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '2');
  if (dash.length) line.setAttribute('stroke-dasharray', dash.join(' '));
  svg.append(line);
  return svg;
}

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function renderSocialStats(s) {
  const has = Boolean(s.socials);
  // Si la API aún no trae datos de redes, no se muestra la sección (un "sin redes" sería falso).
  $('#social-dash').hidden = !has;
  if (!has) return;
  const total = Number(s.socials.total) || 0;
  const ranking = Array.isArray(s.socials.ranking) ? s.socials.ranking : [];
  const fmt = (n) => n.toLocaleString('es-PE');

  $('#social-total').textContent = `${plural(total, 'clic', 'clics')} · ${s.days} días`;

  // Indicadores: total + una tarjeta por red
  const cards = socialCards(s.socials, state.networks);
  fill(
    $('#social-kpis'),
    h('div', { class: 'glass sd-kpi total' }, h('span', { class: 'sd-kpi-label' }, h('span', { text: 'Clics en redes' })), h('strong', { class: 'sd-kpi-value', text: fmt(total) })),
    cards.map((c) =>
      h(
        'div',
        { class: 'glass sd-kpi' },
        h('span', { class: 'sd-kpi-label', title: c.label + c.suffix }, icon(c.icon), h('span', { text: c.label + c.suffix })),
        h('strong', { class: 'sd-kpi-value', text: fmt(c.clicks) }),
        h('span', { class: 'sd-kpi-sub', text: `${c.pct}% del total` }),
      ),
    ),
  );

  // Vacío: sin clics en el periodo (o sin redes configuradas)
  const empty = $('#social-empty');
  const hasNets = ranking.some((r) => !r.deleted);
  if (!total) {
    empty.hidden = false;
    if (!hasNets) fill(empty, icon('fa-regular fa-hand-pointer'), h('p', {}, 'Esta página no tiene redes configuradas. Agrégalas en la pestaña ', h('a', { href: '#redes', text: 'Redes' }), '.'));
    else fill(empty, icon('fa-regular fa-hand-pointer'), h('p', { text: 'Aún nadie tocó tus redes sociales en este periodo.' }));
  } else empty.hidden = true;

  const series = total ? socialSeries(s.socials, s.daily, state.networks) : null;
  $('#social-chart-card').hidden = !series || !series.length || !window.Chart;
  if ($('#social-chart-card').hidden) return;

  fill(
    $('#social-legend'),
    series.map((r) => h('li', {}, dashSwatch(r.color, r.dash), icon(r.icon), h('span', { text: r.label + r.suffix }), h('b', { text: fmt(r.total) }))),
  );
  renderSocialChart(s, series);
}

function renderSocialChart(s, series) {
  const canvas = $('#chart-social');
  const labels = s.daily.map((d) => dayLabel(d.day));
  const sig = series.map((r) => r.key).join('|');
  canvas.setAttribute(
    'aria-label',
    `Gráfico de líneas: clics por día en cada red social, últimos ${s.days} días. ` + series.map((r) => `${r.label}${r.suffix}: ${plural(r.total, 'clic', 'clics')}`).join('; ') + '.',
  );

  // Mismas series: solo se cambian los datos, sin animación ni parpadeo.
  if (charts.social && charts.social.$sig === sig) {
    charts.social.data.labels = labels;
    series.forEach((r, i) => (charts.social.data.datasets[i].data = r.data));
    charts.social.update('none');
    return;
  }
  charts.social?.destroy();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const tick = 'rgba(255,255,255,.72)';
  charts.social = new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((r) => ({
        label: r.label + r.suffix,
        data: r.data,
        borderColor: r.color,
        backgroundColor: r.color,
        borderWidth: 2,
        borderDash: r.dash,
        tension: 0.3,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBorderWidth: 2,
        pointHoverBackgroundColor: r.color,
        pointHoverBorderColor: SOCIAL_BG,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduceMotion.matches ? false : { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,30,29,.92)',
          titleColor: '#fff',
          bodyColor: '#fff',
          borderColor: 'rgba(255,255,255,.12)',
          borderWidth: 1,
          padding: 10,
          boxPadding: 4,
          callbacks: {
            title: (items) => {
              const d = state.stats?.daily?.[items[0]?.dataIndex];
              return d ? dayLabel(d.day, true) : '';
            },
            label: (item) => ` ${item.dataset.label}: ${plural(item.parsed.y, 'clic', 'clics')}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: tick, maxTicksLimit: 6, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.12)' }, border: { display: false }, ticks: { color: tick, precision: 0, maxTicksLimit: 5 } },
      },
    },
  });
  charts.social.$sig = sig;
}

function renderCharts(s) {
  if (!window.Chart) return;
  const brand = '#26615f';
  const grid = '#eef0ed';
  const tick = '#6b7774';
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const labels = s.daily.map((d) => dayLabel(d.day));
  const values = s.daily.map((d) => d.clicks);
  if (!charts.daily) {
    const ctx = $('#chart-daily').getContext('2d');
    const fill = ctx.createLinearGradient(0, 0, 0, 220);
    fill.addColorStop(0, 'rgba(38,97,95,.28)');
    fill.addColorStop(1, 'rgba(38,97,95,0)');
    charts.daily = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ data: values, borderColor: brand, backgroundColor: fill, fill: true, tension: 0.35, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: brand }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: (items) => dayLabel(state.stats.daily[items[0].dataIndex].day, true), label: (item) => ` ${plural(item.parsed.y, 'clic', 'clics')}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 6, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: tick, precision: 0, maxTicksLimit: 5 } },
        },
      },
    });
  } else {
    charts.daily.data.labels = labels;
    charts.daily.data.datasets[0].data = values;
    charts.daily.update();
  }

  const hours = s.hours.map((x) => x.clicks);
  const peak = Math.max(...hours);
  const colors = hours.map((v) => (v === peak && v > 0 ? brand : 'rgba(38,97,95,.28)'));
  if (!charts.hours) {
    charts.hours = new Chart($('#chart-hours'), {
      type: 'bar',
      data: { labels: s.hours.map((x) => `${x.hour}h`), datasets: [{ data: hours, backgroundColor: colors, borderRadius: 4, maxBarThickness: 14 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => `De ${items[0].label.replace('h', ':00')} a ${items[0].label.replace('h', ':59')}`, label: (item) => ` ${plural(item.parsed.y, 'clic', 'clics')}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: tick, maxTicksLimit: 8, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: grid }, border: { display: false }, ticks: { color: tick, precision: 0, maxTicksLimit: 4 } },
        },
      },
    });
  } else {
    charts.hours.data.datasets[0].data = hours;
    charts.hours.data.datasets[0].backgroundColor = colors;
    charts.hours.update();
  }
}

wireSegmented($('#period'), String(state.days), (v) => {
  state.days = Number(v);
  loadStats().catch(() => {});
});

// Borrar estadísticas
const resetDlg = $('#dlg-reset');
$('#reset-stats').addEventListener('click', () => {
  $('#reset-form').reset();
  $('#reset-confirm').disabled = true;
  resetDlg.showModal();
});
$('#reset-form').elements.confirm.addEventListener('input', (e) => ($('#reset-confirm').disabled = e.target.value.trim().toUpperCase() !== 'BORRAR'));
$('#reset-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const { deleted } = await save(() => api('DELETE', '/api/cms/clicks', { confirm: 'BORRAR' }));
    resetDlg.close();
    lastTotal = null;
    toast(`Estadísticas borradas (${plural(deleted, 'clic', 'clics')})`);
    loadStats().catch(() => {});
  } catch {}
});

// ---------------------------------------------------------------------------
// Cuenta
// ---------------------------------------------------------------------------

const accountBtn = $('#account-btn');
const accountMenu = $('#account-menu');
function toggleMenu(open) {
  accountMenu.hidden = !open;
  accountBtn.setAttribute('aria-expanded', String(open));
}
accountBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleMenu(accountMenu.hidden);
});
document.addEventListener('click', (e) => {
  if (!accountMenu.hidden && !accountMenu.contains(e.target)) toggleMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    toggleMenu(false);
    if (!$('#preview-sheet').hidden) $('#close-preview').click();
  }
});

accountMenu.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  toggleMenu(false);
  if (action === 'logout') {
    flushDeletes();
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.href = '/cms_login';
  }
  if (action === 'guide') {
    location.hash = '#botones';
    showTip(true);
  }
  if (action === 'password') {
    $('#password-form').reset();
    $('#password-error').hidden = true;
    $('#dlg-password').showModal();
  }
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = $('#password-error');
  err.hidden = true;
  if (f.next.value !== f.repeat.value) {
    err.textContent = 'Las contraseñas nuevas no coinciden.';
    err.hidden = false;
    return;
  }
  try {
    await api('POST', '/api/cms/password', { current: f.current.value, next: f.next.value });
    $('#dlg-password').close();
    toast('Contraseña actualizada');
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// Guía rápida (se muestra la primera vez; se puede volver a abrir desde el menú de cuenta)
const TIP_KEY = 'cms-guia-vista';
function showTip(show) {
  $('#welcome-tip').hidden = !show;
  if (show) $('#welcome-tip').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#welcome-close').addEventListener('click', () => {
  showTip(false);
  try {
    localStorage.setItem(TIP_KEY, '1');
  } catch {}
});

// ---------------------------------------------------------------------------
// Landings (qué página se está editando)
// ---------------------------------------------------------------------------

// ---------- Lógica pura (sin DOM) ----------

const TEMPLATE_LABELS = { experiencias: 'Experiencias', cartas: 'Outlets' };
const templateLabel = (t) => TEMPLATE_LABELS[t] || TEMPLATE_LABELS.cartas;
/** Más de esta cantidad de landings: aparece el buscador. */
const LANDING_SEARCH_MIN = 9;

/** Agrupa las landings por hotel, respetando el orden en que llegan (el servidor ya ordena). */
function landingGroups(landings) {
  const groups = [];
  const byHotel = new Map();
  for (const l of landings || []) {
    const hotel = String(l.hotel || '').trim() || 'Otras';
    let g = byHotel.get(hotel);
    if (!g) {
      g = { hotel, items: [] };
      byHotel.set(hotel, g);
      groups.push(g);
    }
    g.items.push(l);
  }
  return groups;
}

/** Texto en minúsculas y sin tildes, para buscar. */
function foldText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Filtra por nombre u hotel; cada palabra buscada debe aparecer (sin importar tildes ni mayúsculas). */
function filterLandings(landings, query) {
  const list = landings || [];
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...list];
  return list.filter((l) => {
    const hay = foldText(`${l.name || ''} ${l.hotel || ''}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Línea secundaria de cada opción: "Experiencias · 3 botones · 12 clics (30 d)". */
function landingOptionMeta(l) {
  const parts = [templateLabel(l.template)];
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  if (n(l.buttons_count)) parts.push(plural(l.buttons_count, 'botón', 'botones'));
  if (n(l.clicks_30d)) parts.push(`${plural(l.clicks_30d, 'clic', 'clics')} (30 d)`);
  return parts.join(' · ');
}

/** "Hotel · Experiencias" del botón disparador. */
function landingTriggerMeta(l) {
  return [String(l.hotel || '').trim(), templateLabel(l.template)].filter(Boolean).join(' · ');
}

/** Dirección legible (sin https://) para mostrar. */
function displayUrl(url, origin) {
  try {
    const u = new URL(url || '/', origin);
    return `${u.host}${u.pathname}`.replace(/\/$/, '');
  } catch {
    return String(url || '');
  }
}

/** Estilos del respaldo de la miniatura (sin red): color, imagen de fondo con su encuadre y logo. */
function thumbFallbackStyle(p) {
  if (!p || typeof p !== 'object') return null;
  const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/)/i.test(u.trim()) ? u.trim().replace(/["\\\n\r]/g, encodeURIComponent) : '');
  const color = /^#[0-9a-f]{3,8}$/i.test(String(p.color_fondo || '')) ? p.color_fondo : '#3b4b49';
  const img = p.fondo_tipo === 'imagen' ? safeUrl(p.fondo_imagen_url) : '';
  return {
    backgroundColor: color,
    backgroundImage: img ? `url("${img}")` : 'none',
    backgroundPosition: `${clampPct(p.fondo_foco_x)}% ${clampPct(p.fondo_foco_y)}%`,
    logo: safeUrl(p.logo_url),
  };
}

/** Landing a editar: la guardada si sigue existiendo; si no, la por defecto (o la primera). */
function pickLanding(landings, savedId) {
  const list = landings || [];
  return list.find((l) => l.id === savedId) || list.find((l) => l.is_default) || list[0] || null;
}

// ---------- Miniaturas (iframe a resolución de PC, perezoso y con caché) ----------

const thumbs = {
  activated: false, // se piden recién al abrir la lista por primera vez
  cache: new Map(), // id → HTML de la vista previa
  pending: new Map(), // id → promesa en curso
  gens: new Map(), // id → generación (sube al invalidar; descarta respuestas viejas)
};
const thumbGen = (id) => thumbs.gens.get(id) || 0;

/** Datos del respaldo: los de la API o, para la landing en edición, los ajustes vivos. */
function previewDataOf(l) {
  if (l?.id === landingId && state.settings && 'color_fondo' in state.settings) {
    const s = state.settings;
    return { logo_url: s.logo_url, fondo_tipo: s.fondo_tipo, fondo_imagen_url: s.fondo_imagen_url, color_fondo: s.color_fondo, fondo_foco_x: s.fondo_foco_x, fondo_foco_y: s.fondo_foco_y };
  }
  return l?.preview || null;
}

function thumbFallback(l) {
  const st = thumbFallbackStyle(previewDataOf(l));
  if (!st) return null;
  const fb = h('span', { class: 'lthumb-fb' });
  fb.style.backgroundColor = st.backgroundColor;
  fb.style.backgroundImage = st.backgroundImage;
  fb.style.backgroundPosition = st.backgroundPosition;
  if (st.logo) fb.append(h('img', { src: st.logo, alt: '', loading: 'lazy', decoding: 'async' }));
  return fb;
}

/** Pone (o reemplaza sin parpadeo) el iframe de una miniatura. */
function mountThumbFrame(box, html) {
  const { k, frameW, frameH } = thumbScale(Number(box.dataset.w), Number(box.dataset.h));
  const old = $$('.lthumb-frame', box);
  const frame = h('iframe', {
    class: 'lthumb-frame',
    sandbox: 'allow-same-origin',
    'aria-hidden': 'true',
    tabindex: '-1',
    title: '',
    style: `width:${frameW}px;height:${frameH}px;transform:scale(${k})`,
  });
  frame.addEventListener('load', () => {
    frame.classList.add('is-ready');
    old.forEach((f) => f.remove());
  });
  frame.srcdoc = html;
  box.append(frame);
}

function thumbEl(l, width, height) {
  const box = h('span', { class: 'lthumb', 'aria-hidden': 'true', dataset: { thumb: l.id, w: String(width), h: String(height) } });
  fill(box, thumbFallback(l));
  const html = thumbs.cache.get(l.id);
  if (typeof html === 'string') mountThumbFrame(box, html);
  return box;
}

const thumbBoxes = (id) => $$('.lthumb').filter((b) => b.dataset.thumb === id);

function putThumb(id, html) {
  if (thumbs.cache.get(id) === html) return;
  thumbs.cache.set(id, html);
  thumbBoxes(id).forEach((box) => mountThumbFrame(box, html));
}

/** Tras guardar en la landing actual: se descarta su HTML y se actualiza el respaldo. */
function invalidateThumb(id) {
  if (!id) return;
  thumbs.gens.set(id, thumbGen(id) + 1);
  thumbs.cache.delete(id);
  thumbs.pending.delete(id);
  for (const box of thumbBoxes(id)) {
    const l = landingById(id);
    if (!l) continue;
    $('.lthumb-fb', box)?.remove();
    const fb = thumbFallback(l);
    if (fb) box.prepend(fb);
  }
}

function loadThumb(id) {
  if (thumbs.cache.has(id)) return Promise.resolve(thumbs.cache.get(id));
  if (thumbs.pending.has(id)) return thumbs.pending.get(id);
  const gen = thumbGen(id);
  // Sin cabecera X-Landing-Id: el servidor la prefiere al ?landing= y mostraría la landing actual.
  const p = fetch(`/api/cms/preview?landing=${encodeURIComponent(id)}`, { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.text() : null))
    .catch(() => null)
    .then((html) => {
      if (thumbs.pending.get(id) === p) thumbs.pending.delete(id);
      if (typeof html === 'string' && gen === thumbGen(id)) putThumb(id, html);
      return html;
    });
  thumbs.pending.set(id, p);
  return p;
}

/** Pide las miniaturas que falten, de a 3 a la vez, empezando por la actual. */
function loadAllThumbs() {
  const ids = [landingId, ...state.landings.map((l) => l.id).filter((id) => id !== landingId)];
  const queue = ids.filter((id) => id && !thumbs.cache.has(id));
  let i = 0;
  const worker = async () => {
    while (i < queue.length) await loadThumb(queue[i++]);
  };
  for (let n = 0; n < 3; n++) worker();
}

// ---------- Selector (botón + lista desplegable) ----------

const landingById = (id) => state.landings.find((l) => l.id === id) || (state.landing?.id === id ? state.landing : null);
const picker = { open: false, built: false, active: -1, all: [], options: [], groups: [], none: null, hoverTimer: 0 };
const pickerEls = {
  root: $('#landing-picker'),
  trigger: $('#landing-switch'),
  pop: $('#landing-pop'),
  list: $('#landing-list'),
  searchWrap: $('#landing-search-wrap'),
  search: $('#landing-search'),
  hover: $('#landing-hover'),
};
const hoverMq = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1100px)');

function renderLandingSwitch() {
  const l = landingById(landingId);
  if (!l) return;
  $('#landing-switch-name').textContent = l.name || '';
  $('#landing-switch-meta').textContent = landingTriggerMeta(l);
  fill($('#landing-switch-thumb'), thumbEl(l, 64, 40));
}

/**
 * Arma la lista una sola vez (las miniaturas son iframes: moverlos o recrearlos los recargaría).
 * El buscador solo oculta opciones y grupos.
 */
function buildLandingOptions() {
  const { list, searchWrap } = pickerEls;
  searchWrap.hidden = state.landings.length < LANDING_SEARCH_MIN;
  picker.all = [];
  picker.groups = [];
  const optionIndex = (id) => picker.options.findIndex((o) => o.landing.id === id);
  const groups = landingGroups(state.landings).map((g, gi) => {
    const headId = `lsw-g-${gi}`;
    const groupEl = h(
      'div',
      { role: 'group', 'aria-labelledby': headId },
      h('div', { class: 'lsw-group-head', id: headId, role: 'presentation', text: g.hotel }),
      g.items.map((l) => {
        const selected = l.id === landingId;
        const open = h(
          'a',
          { class: 'lsw-open', href: l.url || '/', target: '_blank', rel: 'noopener', tabindex: '-1', title: 'Abrir página', 'aria-label': `Abrir ${l.name || 'la página'} en una pestaña nueva` },
          icon('fa-solid fa-arrow-up-right-from-square'),
        );
        open.addEventListener('click', (e) => e.stopPropagation()); // abrir no cambia la selección
        const opt = h(
          'div',
          { class: 'lsw-opt', role: 'option', id: `lsw-opt-${picker.all.length}`, 'aria-selected': String(selected), dataset: { id: l.id } },
          thumbEl(l, 80, 50),
          h('span', { class: 'lsw-opt-text' }, h('strong', { text: l.name || 'Sin nombre' }), h('small', { text: landingOptionMeta(l) })),
          open,
          icon('fa-solid fa-check lsw-check'),
        );
        opt.addEventListener('mousedown', (e) => e.preventDefault()); // el foco se queda en la lista
        opt.addEventListener('click', () => chooseLanding(l.id));
        opt.addEventListener('mousemove', () => {
          pickerEls.pop.classList.remove('is-kbd');
          const index = optionIndex(l.id);
          if (index >= 0 && picker.active !== index) setActiveOption(index, { scroll: false });
        });
        opt.addEventListener('mouseenter', () => scheduleHover(l, opt));
        opt.addEventListener('mouseleave', hideHover);
        picker.all.push({ el: opt, landing: l });
        return opt;
      }),
    );
    picker.groups.push(groupEl);
    return groupEl;
  });
  picker.none = h('div', { class: 'lsw-none', role: 'presentation', text: 'No hay páginas con ese nombre.', hidden: true });
  fill(list, groups, picker.none);
  picker.built = true;
}

/** Aplica el buscador: deja en `picker.options` solo las opciones visibles, en orden. */
function filterLandingOptions() {
  const query = pickerEls.searchWrap.hidden ? '' : pickerEls.search.value;
  const match = new Set(filterLandings(state.landings, query).map((l) => l.id));
  picker.options = picker.all.filter((o) => {
    o.el.hidden = !match.has(o.landing.id);
    return !o.el.hidden;
  });
  picker.groups.forEach((g) => (g.hidden = !$$('.lsw-opt', g).some((o) => !o.hidden)));
  picker.none.hidden = picker.options.length > 0;
}

function setActiveOption(index, { scroll = true } = {}) {
  const n = picker.options.length;
  picker.active = n ? Math.min(n - 1, Math.max(0, index)) : -1;
  picker.options.forEach((o, i) => o.el.classList.toggle('is-active', i === picker.active));
  const cur = picker.options[picker.active]?.el;
  for (const el of [pickerEls.list, pickerEls.search]) {
    if (cur) el.setAttribute('aria-activedescendant', cur.id);
    else el.removeAttribute('aria-activedescendant');
  }
  if (cur && scroll) cur.scrollIntoView({ block: 'nearest' });
}

/** Limita el alto de la lista al espacio visible bajo el disparador (sin pasar de 70vh). */
function fitPickerHeight() {
  const rect = pickerEls.trigger.getBoundingClientRect();
  const tabbar = $('.tabbar');
  const bottomUi = tabbar && getComputedStyle(tabbar).display !== 'none' ? tabbar.offsetHeight : 0;
  const room = window.innerHeight - rect.bottom - 6 - 12 - bottomUi;
  // Piso de 140 px (buscador + una opción): en ventanas bajas no se mete debajo de la barra inferior.
  pickerEls.pop.style.maxHeight = `${Math.max(140, Math.min(window.innerHeight * 0.7, room))}px`;
}

function openPicker() {
  if (picker.open || pickerEls.trigger.disabled) return;
  picker.open = true;
  if (!thumbs.activated) {
    thumbs.activated = true;
    renderLandingSwitch();
  }
  if (!picker.built) buildLandingOptions();
  loadAllThumbs();
  pickerEls.search.value = '';
  filterLandingOptions();
  pickerEls.pop.hidden = false;
  pickerEls.trigger.setAttribute('aria-expanded', 'true');
  fitPickerHeight();
  const current = picker.options.findIndex((o) => o.landing.id === landingId);
  setActiveOption(current < 0 ? 0 : current);
  (pickerEls.searchWrap.hidden ? pickerEls.list : pickerEls.search).focus({ preventScroll: true });
}

function closePicker({ returnFocus = false } = {}) {
  if (!picker.open) return;
  picker.open = false;
  hideHover();
  pickerEls.pop.hidden = true;
  pickerEls.pop.classList.remove('is-kbd');
  pickerEls.trigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) pickerEls.trigger.focus();
}

function chooseLanding(id) {
  closePicker({ returnFocus: true });
  if (id && id !== landingId) requestLandingSwitch(id);
}

// Vista grande al pasar el mouse (solo PC con mouse, ≥1100 px)
function hideHover() {
  clearTimeout(picker.hoverTimer);
  pickerEls.hover.hidden = true;
}

function scheduleHover(l, opt) {
  clearTimeout(picker.hoverTimer);
  if (!hoverMq.matches) return;
  picker.hoverTimer = setTimeout(() => showHover(l, opt), 350);
}

function showHover(l, opt) {
  if (!picker.open || !hoverMq.matches || !opt.isConnected) return;
  const card = pickerEls.hover;
  fill($('#landing-hover-thumb'), thumbEl(l, 400, 225));
  $('#landing-hover-name').textContent = l.name || '';
  $('#landing-hover-url').textContent = displayUrl(l.url, location.origin);
  card.hidden = false;
  const pr = pickerEls.pop.getBoundingClientRect();
  const or = opt.getBoundingClientRect();
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  let left = pr.right + 12;
  if (left + cw > window.innerWidth - 12) left = pr.left - 12 - cw;
  if (left < 12) return hideHover(); // no hay lugar a ningún lado
  const top = Math.min(Math.max(12, or.top + or.height / 2 - ch / 2), window.innerHeight - ch - 12);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

// Teclado: Enter / Espacio / ↓ abren; ↑ ↓ Inicio Fin mueven; Enter elige; Esc cierra.
pickerEls.trigger.addEventListener('click', () => (picker.open ? closePicker({ returnFocus: true }) : openPicker()));
pickerEls.trigger.addEventListener('keydown', (e) => {
  if (['Enter', ' ', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    if (!picker.open) openPicker();
    pickerEls.pop.classList.add('is-kbd'); // abierta con teclado: se marca la opción activa
  }
});

function onPickerKey(e) {
  const inSearch = e.target === pickerEls.search;
  const move = (i) => {
    e.preventDefault();
    pickerEls.pop.classList.add('is-kbd');
    hideHover();
    setActiveOption(i);
  };
  switch (e.key) {
    case 'ArrowDown':
      return move(picker.active + 1);
    case 'ArrowUp':
      return move(picker.active - 1);
    case 'Home':
      if (!inSearch) move(0);
      return;
    case 'End':
      if (!inSearch) move(picker.options.length - 1);
      return;
    case 'Enter':
      e.preventDefault();
      if (picker.options[picker.active]) chooseLanding(picker.options[picker.active].landing.id);
      return;
    case ' ':
      if (inSearch) return;
      e.preventDefault();
      if (picker.options[picker.active]) chooseLanding(picker.options[picker.active].landing.id);
      return;
    case 'Escape':
      e.preventDefault();
      e.stopPropagation();
      closePicker({ returnFocus: true });
      return;
    case 'Tab':
      closePicker({ returnFocus: true }); // el Tab sigue desde el disparador
  }
}
pickerEls.list.addEventListener('keydown', onPickerKey);
pickerEls.search.addEventListener('keydown', onPickerKey);
pickerEls.search.addEventListener('input', () => {
  hideHover();
  filterLandingOptions();
  setActiveOption(0);
});
pickerEls.list.addEventListener('scroll', hideHover, { passive: true });
document.addEventListener('click', (e) => {
  if (picker.open && !pickerEls.root.contains(e.target)) closePicker();
});
window.addEventListener('resize', () => {
  if (!picker.open) return;
  hideHover();
  fitPickerHeight();
});

/** En celular/tablet el selector va bajo la barra superior; desde 900 px, en la barra lateral. */
const sideMq = window.matchMedia('(min-width: 900px)');
function placeLandingBar() {
  const bar = $('#landing-bar');
  if (sideMq.matches) {
    const slot = $('#landing-slot-side');
    if (bar.parentElement !== slot) slot.append(bar);
  } else if (bar.nextElementSibling !== $('#content')) {
    $('#content').before(bar);
  }
}
sideMq.addEventListener('change', () => {
  closePicker();
  placeLandingBar();
});

let switchWait = null;
let switchTarget = '';
const hasPendingSaves = () => Boolean(timers.size || inFlight);

function switchLanding(id) {
  pref.set(LANDING_KEY, id);
  closePicker();
  pickerEls.trigger.disabled = true;
  location.reload(); // el #hash se conserva: se vuelve a la misma pestaña
}

/** Cambia de landing; si hay guardados pendientes, espera a que terminen. */
function requestLandingSwitch(id) {
  switchTarget = id;
  if (!hasPendingSaves()) return switchLanding(id);
  if (switchWait) return;
  toast('Espera a que termine de guardar', 'info');
  const started = Date.now();
  switchWait = setInterval(() => {
    if (!hasPendingSaves()) {
      clearInterval(switchWait);
      switchWait = null;
      switchLanding(switchTarget);
    } else if (Date.now() - started > 15000) {
      clearInterval(switchWait);
      switchWait = null;
      toast('Todavía se está guardando. Vuelve a elegir la página en unos segundos.', 'info');
    }
  }, 250);
}

/** Muestra en el panel a qué landing corresponde lo que se edita. */
function applyLanding() {
  const l = state.landing;
  if (!l) return;
  $('#brand-name').textContent = l.name;
  $('#stats-landing').textContent = ` · ${l.name}`;
  $('#dlg-preview-name').textContent = l.name;
  $$('[data-landing-url]').forEach((a) => (a.href = l.url || '/'));
  const tpl = /^[a-z0-9-]+$/.test(String(l.template || '')) ? l.template : 'cartas';
  document.body.classList.add(`tpl-${tpl}`);
  renderLandingSwitch();
  placeLandingBar();
  $('#landing-bar').hidden = false;
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

async function init() {
  const fail = (err) => $('#loading').replaceChildren(icon('fa-solid fa-circle-exclamation'), ` ${err.message}`);
  const saved = pref.get(LANDING_KEY) || '';
  try {
    const { landings } = await api('GET', '/api/cms/landings');
    state.landings = Array.isArray(landings) ? landings : [];
  } catch (err) {
    return fail(err);
  }
  const chosen = pickLanding(state.landings, saved);
  landingId = chosen?.id || '';
  if (saved && saved !== landingId) pref.remove(LANDING_KEY); // la guardada ya no existe
  try {
    const data = await api('GET', '/api/cms/state');
    Object.assign(state, data);
  } catch (err) {
    // La landing se borró entre las dos llamadas: se olvida la preferencia y se vuelve a la por defecto.
    if (err.status === 404 && saved) {
      pref.remove(LANDING_KEY);
      location.reload();
      return;
    }
    return fail(err);
  }
  if (state.landing?.id) landingId = state.landing.id;
  if (!state.landings.some((l) => l.id === landingId) && state.landing) state.landings.push(state.landing);
  applyLanding();
  $('#account-name').textContent = state.user.username;
  $('#avatar-initial').textContent = (state.user.username[0] || 'A').toUpperCase();

  bindSettings();
  renderDesign();
  applyBindings();
  renderButtons();
  renderSocials();
  renderNetworkPicker();
  setSave('idle');

  if (window.Sortable) {
    const opts = { handle: '.handle', animation: 160, ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag' };
    Sortable.create($('#buttons-list'), {
      ...opts,
      onEnd: () => {
        const ids = $$('#buttons-list > li').map((li) => li.dataset.id);
        state.buttons.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        saveButtonOrder();
      },
    });
    Sortable.create($('#socials-list'), {
      ...opts,
      onEnd: () => {
        const ids = $$('#socials-list > li').map((li) => li.dataset.id);
        state.socials.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        save(() => api('PUT', '/api/cms/socials/order', { ids })).catch(() => {});
      },
    });
  }

  $('#loading').remove();
  let seenTip = false;
  try {
    seenTip = localStorage.getItem(TIP_KEY) === '1';
  } catch {}
  $('#welcome-tip').hidden = seenTip;
  showTab(location.hash.slice(1) || 'botones');
  if (currentTab !== 'estadisticas') loadStats().catch(() => {}); // para los contadores de cada botón
  refreshPreview();
}

init();
