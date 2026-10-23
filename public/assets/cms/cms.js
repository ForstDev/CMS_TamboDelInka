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
};
const netByKey = () => Object.fromEntries(state.networks.map((n) => [n.key, n]));

// ---------------------------------------------------------------------------
// API y autoguardado
// ---------------------------------------------------------------------------

async function api(method, url, body, opts = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    keepalive: opts.keepalive,
  });
  if (res.status === 401) {
    location.href = '/cms_login';
    throw new Error('Tu sesión expiró.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No se pudo conectar con el servidor.');
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

function putFile(url, file, contentType, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', contentType);
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
  const frames = [$('#preview-frame'), $('#preview-frame-mobile')].filter((f) => f && f.offsetParent !== null);
  if (!frames.length) return;
  try {
    const res = await fetch('/api/cms/preview', { credentials: 'same-origin' });
    if (!res.ok) return;
    const html = await res.text();
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
  refreshPreview();
});
$('#close-preview').addEventListener('click', () => {
  $('#preview-sheet').hidden = true;
  document.body.style.overflow = '';
});
window.matchMedia('(min-width: 1280px)').addEventListener('change', schedulePreview);

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
  document.title = `${TITLES[name]} · ${state.settings.cms_nombre || 'Panel'}`;
  window.scrollTo({ top: 0 });
  if (name === 'estadisticas') {
    loadStats().catch(() => {});
    startLive();
  } else {
    stopLive();
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
    input.value = state.settings[key] ?? '';
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
  acceptDrops($('#bg-thumb'), (file) => handleImage(file, 'fondo', $('#bg-progress'), (url) => saveSetting('fondo_imagen_url', url, { immediate: true })));

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

  renderDesignPreview();
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
  }
  const thumb = $('#bg-thumb');
  if (thumb) {
    $('#bg-image-block').hidden = s.fondo_tipo !== 'imagen';
    thumb.style.backgroundImage = s.fondo_imagen_url ? `url("${s.fondo_imagen_url}")` : 'none';
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

  $('#export-csv').href = `/api/cms/stats.csv?days=${s.days}`;
  renderCharts(s);
}

/** Filas de "Clics en redes sociales" (sin DOM). Respeta el orden que manda el servidor. */
function socialStatsRows(socials, networks) {
  const total = Number(socials?.total) || 0;
  const ranking = Array.isArray(socials?.ranking) ? socials.ranking : [];
  const nets = Object.fromEntries((networks || []).map((n) => [n.key, n]));
  const max = Math.max(1, ...ranking.map((r) => Number(r.clicks) || 0));
  return ranking.map((r) => {
    const clicks = Number(r.clicks) || 0;
    return {
      id: r.id,
      icon: nets[r.network]?.icon || 'fa-solid fa-link',
      label: r.label || nets[r.network]?.label || r.network || 'Red',
      suffix: r.deleted ? ' (eliminada)' : !r.active ? ' (oculta)' : '',
      clicks,
      pct: total ? Math.round((clicks / total) * 100) : 0,
      width: (clicks / max) * 100,
    };
  });
}

function renderSocialStats(s) {
  const has = Boolean(s.socials);
  // Si la API aún no trae datos de redes, no se muestra la tarjeta (un "sin redes" sería falso).
  $('#social-card').hidden = !has;
  if (!has) return;
  const total = Number(s.socials?.total) || 0;
  const rows = socialStatsRows(s.socials, state.networks);

  const totalEl = $('#social-total');
  totalEl.hidden = !has;
  fill(totalEl, h('b', { text: total.toLocaleString('es-PE') }), total === 1 ? ' clic' : ' clics');

  const empty = $('#social-empty');
  if (!rows.length) {
    empty.hidden = false;
    fill(empty, icon('fa-regular fa-hand-pointer'), h('p', {}, 'Todavía no hay redes configuradas. Agrégalas en la pestaña ', h('a', { href: '#redes', text: 'Redes' }), '.'));
  } else if (!total) {
    empty.hidden = false;
    fill(empty, icon('fa-regular fa-hand-pointer'), h('p', { text: 'Aún nadie tocó tus redes sociales en este periodo. Aquí verás cuántas personas pasan de tu página a tu Facebook, Instagram, etc.' }));
  } else empty.hidden = true;

  const list = $('#social-ranking');
  list.hidden = !rows.length;
  list.replaceChildren(
    ...rows.map((r) =>
      h(
        'li',
        {},
        h('span', { class: 'net-icon sm' }, icon(r.icon)),
        h('span', { class: 'rank-label', title: r.label + r.suffix }, r.label, r.suffix ? h('small', { text: r.suffix }) : null),
        h('span', { class: 'rank-count' }, r.clicks.toLocaleString('es-PE'), h('small', { text: `${r.pct}%` })),
        h('span', { class: 'rank-bar' }, h('span', { style: `width:${r.width}%` })),
      ),
    ),
  );
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
// Inicio
// ---------------------------------------------------------------------------

async function init() {
  try {
    const data = await api('GET', '/api/cms/state');
    Object.assign(state, data);
  } catch (err) {
    $('#loading').replaceChildren(icon('fa-solid fa-circle-exclamation'), ` ${err.message}`);
    return;
  }
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
