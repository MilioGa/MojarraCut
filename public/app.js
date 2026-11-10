// MojarraCut — editor de video (renderer)
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const uid = (p = 'c') => p + Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = (t) => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
const fmtShort = (t) => { t = Math.round(t || 0); return t >= 60 ? `${Math.floor(t / 60)} min ${t % 60} s` : `${t} s`; };
const fmtSize = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB');
const ago = (ms) => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'hace un momento'; if (s < 3600) return `hace ${Math.floor(s / 60)} min`; if (s < 86400) return `hace ${Math.floor(s / 3600)} h`; return new Date(ms).toLocaleDateString(); };
const escHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const I = (n, s) => window.icon(n, s);
function hydrateIcons(root = document) { for (const e of $$('[data-i]', root)) { if (e.dataset.iDone) continue; e.insertAdjacentHTML('afterbegin', I(e.dataset.i)); e.dataset.iDone = 1; } }
const TRACK_COLORS = { video: 'var(--video)', audio: 'var(--audio)', text: 'var(--text-c)' };
const TRACK_ICON = { video: 'film', audio: 'music', text: 'captions' };
const KIND = { video: { label: 'Video', icon: 'film', color: 'var(--video)' }, image: { label: 'Imagen', icon: 'image', color: 'var(--image)' }, audio: { label: 'Audio', icon: 'music', color: 'var(--audio)' }, text: { label: 'Texto', icon: 'type', color: 'var(--text-c)' } };
const FORMATS = [
  { w: 1920, h: 1080, t: 'YouTube / horizontal', s: '16:9 · 1080p', i: 'monitor' },
  { w: 1080, h: 1920, t: 'Shorts · Reels · TikTok', s: '9:16 · vertical', i: 'smartphone' },
  { w: 1080, h: 1080, t: 'Cuadrado', s: '1:1 · Instagram', i: 'square' },
  { w: 3840, h: 2160, t: '4K', s: '16:9 · 2160p', i: 'tv' },
];
const TRANSITIONS = [
  { id: 'dissolve', name: 'Disolver' }, { id: 'black', name: 'A negro' },
  { id: 'slide-left', name: 'Deslizar ←' }, { id: 'slide-right', name: 'Deslizar →' },
  { id: 'slide-up', name: 'Deslizar ↑' }, { id: 'slide-down', name: 'Deslizar ↓' },
  { id: 'push-left', name: 'Empujar ←' }, { id: 'push-right', name: 'Empujar →' },
];
const TRANS_IDS = TRANSITIONS.map((t) => t.id);

// ================= Estado =================
let project = null, projectId = null;
let media = [];
const info = {};
let sel = { type: null, id: null };
let time = 0, playing = false, lastTick = 0;
let pps = 60;
let undoStack = [], redoStack = [];
let saveTimer = null, thumbTimer = null, ffmpegOk = false, dataDir = '';
let mediaFilter = 'all';
const canvas = $('#stage'), ctx = canvas.getContext('2d');
let multi = new Set();          // ids de clips seleccionados (incluye sel.id)
let clipboard = null, curFolder = null, propsTab = 'all';
const selClip = () => (sel.type === 'clip' ? findClip(sel.id) : null);
const selectedClips = () => (sel.type === 'clip' ? [...multi].map(findClip).filter(Boolean) : []);
const select = (type, id) => { sel = { type, id }; multi = new Set(type === 'clip' ? [id] : []); renderSel(); renderInspector(); };
function selectClips(ids, add) {
  const s = add ? new Set([...multi, ...ids]) : new Set(ids);
  if (!s.size) return select(null);
  multi = s; sel = { type: 'clip', id: s.has(sel.id) ? sel.id : [...s][s.size - 1] }; renderSel(); renderInspector();
}
const EFFECTS = {
  grayscale: { name: 'Escala de grises', icon: 'contrast', min: 0, max: 1, step: 0.01, def: 1, show: (v) => Math.round(v * 100) + '%', css: (v) => `grayscale(${v})` },
  sepia: { name: 'Sepia', icon: 'palette', min: 0, max: 1, step: 0.01, def: 1, show: (v) => Math.round(v * 100) + '%', css: (v) => `sepia(${v})` },
  invert: { name: 'Invertir colores', icon: 'aperture', min: 0, max: 1, step: 0.01, def: 1, show: (v) => Math.round(v * 100) + '%', css: (v) => `invert(${v})` },
  blur: { name: 'Desenfoque', icon: 'droplets', min: 0, max: 40, step: 0.5, def: 6, show: (v) => v + ' px', css: (v) => `blur(${v}px)` },
  brightness: { name: 'Brillo', icon: 'sun', min: 0, max: 3, step: 0.05, def: 1.3, show: (v) => Math.round(v * 100) + '%', css: (v) => `brightness(${v})` },
  contrast: { name: 'Contraste', icon: 'sun-dim', min: 0, max: 3, step: 0.05, def: 1.3, show: (v) => Math.round(v * 100) + '%', css: (v) => `contrast(${v})` },
  saturate: { name: 'Saturación', icon: 'droplets', min: 0, max: 3, step: 0.05, def: 1.6, show: (v) => Math.round(v * 100) + '%', css: (v) => `saturate(${v})` },
  hue: { name: 'Tono (matiz)', icon: 'palette', min: -180, max: 180, step: 1, def: 90, show: (v) => v + '°', css: (v) => `hue-rotate(${v}deg)` },
};
const effectsCss = (c) => (c.effects || []).filter((e) => EFFECTS[e.type] && e.enabled !== false).map((e) => EFFECTS[e.type].css(e.amount ?? EFFECTS[e.type].def)).join(' ') || 'none';
const aFadeIn = (c) => c.audioFadeIn ?? c.fadeIn ?? 0, aFadeOut = (c) => c.audioFadeOut ?? c.fadeOut ?? 0;

// ================= API =================
async function api(url, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = { 'Content-Type': 'application/json' }; delete o.json; }
  let r;
  try { r = await fetch(url, o); } catch { toast('No se pudo conectar con el motor de MojarraCut. Cierra y vuelve a abrir la app.', null, true); throw new Error('net'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) { const msg = (data && data.error) || `Error ${r.status}`; toast(msg, null, true); throw new Error(msg); }
  return data;
}

// ================= Utilidades de proyecto =================
const allClips = () => (project ? project.tracks.flatMap((t) => t.clips.map((c) => ({ c, t }))) : []);
const findClip = (id) => { if (!project) return null; for (const t of project.tracks) { const c = t.clips.find((x) => x.id === id); if (c) return { c, t }; } return null; };
const totalDur = () => Math.max(0, ...allClips().map(({ c }) => c.start + c.duration));
const kindOfName = (n) => (media.find((m) => m.name === n) || {}).kind || (/\.(png|jpe?g|gif|webp|bmp)$/i.test(n) ? 'image' : /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(n) ? 'audio' : 'video');
const clipKind = (c, t) => (t.type === 'text' ? 'text' : kindOfName(c.src));
const fits = (kind, ttype) => (kind === 'text' ? ttype === 'text' : kind === 'audio' ? ttype === 'audio' : ttype === 'video');
const usage = (name) => allClips().filter(({ c }) => c.src === name).length;

function normalize(p) {
  p.width ||= 1920; p.height ||= 1080; p.fps ||= 30; p.background ||= '#000000'; p.tracks ||= [];
  p.bin ||= {}; p.bin.folders ||= []; p.bin.map ||= {};
  for (const t of p.tracks) { t.id ||= uid('t'); t.type ||= 'video'; t.name ||= 'Pista'; t.clips ||= []; for (const c of t.clips) { c.id ||= uid(); c.start = +c.start || 0; c.duration = +c.duration || 1; c.in = +c.in || 0; } }
  return p;
}
// Transiciones: el clip B (con transition) entra sobre A; A se prolonga d segundos por debajo.
function linkTransitions(track) {
  const clips = [...track.clips].sort((a, b) => a.start - b.start), tail = new Map(), prevOf = new Map();
  if (track.type !== 'video') return { tail, prevOf };
  for (let i = 0; i < clips.length; i++) {
    const b = clips[i], tr = b.transition; if (!tr || !TRANS_IDS.includes(tr.type)) continue;
    const a = clips[i - 1], linked = a && Math.abs(a.start + a.duration - b.start) < 0.05;
    const d = Math.max(0.05, Math.min(tr.duration || 1, b.duration, linked ? a.duration : Infinity));
    if (linked) { tail.set(a.id, { d, type: tr.type, at: b.start }); prevOf.set(b.id, a.id); }
  }
  return { tail, prevOf };
}
const transDur = (c) => Math.max(0.05, Math.min(c.transition.duration || 1, c.duration));

function mutate(fn, { save = true } = {}) {
  undoStack.push(JSON.stringify(project)); if (undoStack.length > 300) undoStack.shift();
  redoStack = []; fn();
  if (sel.type === 'clip' && !multi.has(sel.id)) multi = new Set([sel.id]);
  if (sel.type !== 'clip') multi.clear();
  if (save) scheduleSave(); refresh();
}
function undo() { if (!undoStack.length) return toast('No hay nada que deshacer'); redoStack.push(JSON.stringify(project)); project = JSON.parse(undoStack.pop()); fixSel(); scheduleSave(); refresh(); toast('Deshecho', { label: 'Rehacer', fn: redo }); }
function redo() { if (!redoStack.length) return toast('No hay nada que rehacer'); undoStack.push(JSON.stringify(project)); project = JSON.parse(redoStack.pop()); fixSel(); scheduleSave(); refresh(); }
function fixSel() { multi = new Set([...multi].filter((id) => findClip(id))); if (sel.type === 'clip' && !findClip(sel.id)) sel = multi.size ? { type: 'clip', id: [...multi][0] } : { type: null }; if (sel.type !== 'clip') multi.clear(); if (sel.type === 'track' && !project.tracks.find((t) => t.id === sel.id)) sel = { type: null }; }
function setSave(state) {
  const s = $('#saveState'); s.classList.toggle('err', state === 'err');
  s.innerHTML = state === 'saving' ? `${I('loader-circle', 14)}Guardando…` : state === 'err' ? `${I('triangle-alert', 14)}No se pudo guardar` : `${I('circle-check', 14)}Guardado`;
}
function scheduleSave() {
  setSave('saving'); clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
async function flushSave() {
  clearTimeout(saveTimer); if (!project) return;
  try { await api('/api/project', { method: 'PUT', json: project }); setSave('ok'); scheduleThumb(); } catch { setSave('err'); }
}
function scheduleThumb() {
  clearTimeout(thumbTimer);
  thumbTimer = setTimeout(() => {
    if (!project || !totalDur()) return;
    const c = document.createElement('canvas'), k = 320 / Math.max(project.width, project.height);
    c.width = Math.round(project.width * k); c.height = Math.round(project.height * k);
    try { c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height); c.toBlob((b) => b && fetch('/api/thumb', { method: 'PUT', body: b }), 'image/jpeg', 0.75); } catch {}
  }, 1500);
}

// ================= Toast / modal / menú =================
let toastTimer;
function toast(msg, action, error) {
  const t = $('#toast'); t.innerHTML = ''; t.classList.toggle('error', !!error);
  t.append(el('span', '', (error ? I('circle-x') : '') )); t.firstChild.style.display = error ? 'flex' : 'none';
  t.append(el('span', '', escHtml(msg)));
  if (action) { const b = el('button', '', escHtml(action.label)); b.onclick = () => { action.fn(); t.classList.remove('show'); }; t.append(b); }
  t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), action || error ? 7000 : 2600);
}
let modalOnClose = null;
function modal(html, onClose) { $('#modalCard').innerHTML = html; hydrateIcons($('#modalCard')); $('#modal').classList.remove('hidden'); modalOnClose = onClose; setTimeout(() => { const f = $('#modalCard [autofocus]') || $('#modalCard button'); f && f.focus(); }, 30); }
function closeModal() { if (exporting) return; $('#modal').classList.add('hidden'); modalOnClose && modalOnClose(); modalOnClose = null; }
const modalOpen = () => !$('#modal').classList.contains('hidden');
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
function confirmDlg({ title, text, ok = 'Aceptar', danger }) {
  return new Promise((res) => {
    modal(`<h2>${danger ? I('triangle-alert', 20) : ''}${escHtml(title)}</h2><p class="dim">${text}</p><div class="actions"><button class="btn" id="cNo">Cancelar</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="cOk" autofocus>${escHtml(ok)}</button></div>`, () => res(false));
    $('#cNo').onclick = () => { modalOnClose = null; closeModal(); res(false); };
    $('#cOk').onclick = () => { modalOnClose = null; closeModal(); res(true); };
  });
}
function promptDlg({ title, value = '', ok = 'Guardar' }) {
  return new Promise((res) => {
    modal(`<h2>${escHtml(title)}</h2><input type="text" id="pIn" autofocus maxlength="80"><div class="actions"><button class="btn" id="pNo">Cancelar</button><button class="btn primary" id="pOk">${escHtml(ok)}</button></div>`, () => res(null));
    const i = $('#pIn'); i.value = value; setTimeout(() => i.select(), 40);
    const done = (v) => { modalOnClose = null; closeModal(); res(v); };
    $('#pNo').onclick = () => done(null); $('#pOk').onclick = () => done(i.value.trim() || null);
    i.onkeydown = (e) => { if (e.key === 'Enter') done(i.value.trim() || null); };
  });
}
function popMenu(x, y, items) {
  $$('.menu').forEach((m) => m.remove());
  const m = el('div', 'menu'); m.setAttribute('role', 'menu');
  for (const it of items) { const b = el('button', it.danger ? 'danger' : '', I(it.icon) + escHtml(it.label)); b.onclick = () => { m.remove(); it.fn(); }; m.append(b); }
  document.body.append(m);
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  setTimeout(() => window.addEventListener('mousedown', function h(e) { if (!m.contains(e.target)) { m.remove(); window.removeEventListener('mousedown', h); } }), 0);
  m.querySelector('button').focus();
}

// ================= Menú de proyectos =================
let projList = [];
async function showHome() {
  if (project) { pause(); await flushSave(); scheduleThumb(); await new Promise((r) => setTimeout(r, 50)); }
  for (const id in els) { els[id].pause(); delete els[id]; }
  project = null; projectId = null; undoStack = []; redoStack = []; sel = { type: null };
  await fetch('/api/close', { method: 'POST' }).catch(() => {});
  $('#editor').classList.add('hidden'); $('#home').classList.remove('hidden');
  document.title = 'MojarraCut';
  await loadHome(); $('#hSearch').focus();
}
async function loadHome() { projList = await api('/api/projects'); renderHome(); }
function renderHome() {
  const g = $('#hGrid'), q = $('#hSearch').value.trim().toLowerCase(); g.innerHTML = '';
  const nc = el('button', 'proj-card new-card', `${I('plus', 30)}<b>Nuevo proyecto</b><span class="small-txt">Elige el formato y empieza</span>`);
  nc.onclick = newProjectDlg; g.append(nc);
  const list = projList.filter((p) => !q || p.name.toLowerCase().includes(q));
  if (!list.length && q) g.append(el('div', 'empty', `${I('search', 26)}Ningún proyecto coincide con “${escHtml(q)}”.`));
  for (const p of list) {
    const c = el('div', 'proj-card'); c.tabIndex = 0; c.setAttribute('role', 'listitem'); c.title = `Abrir “${p.name}”`;
    const vert = p.height > p.width, fmtName = p.width === p.height ? '1:1' : vert ? '9:16' : '16:9';
    const th = el('div', 'proj-thumb', p.thumb ? '' : I('clapperboard', 40));
    if (p.thumb) th.style.backgroundImage = `url("/thumbs/${encodeURIComponent(p.id)}?v=${p.modified}")`;
    c.append(th, el('div', 'proj-info', `<div class="proj-name-c">${escHtml(p.name)}</div><div class="proj-meta"><span>${fmtName} · ${p.width}×${p.height}</span><span>${p.clips ? fmtShort(p.duration) : 'Vacío'}</span><span>${ago(p.modified)}</span></div>`));
    const mb = el('button', 'icon-btn proj-menu', I('ellipsis')); mb.title = 'Más acciones'; mb.setAttribute('aria-label', 'Más acciones de ' + p.name);
    mb.onclick = (e) => { e.stopPropagation(); const r = mb.getBoundingClientRect(); projectMenu(p, r.left, r.bottom + 4); };
    c.append(mb);
    c.onclick = () => openProject(p.id);
    c.onkeydown = (e) => { if (e.key === 'Enter') openProject(p.id); if (e.key === 'Delete') deleteProject(p); };
    c.oncontextmenu = (e) => { e.preventDefault(); projectMenu(p, e.clientX, e.clientY); };
    g.append(c);
  }
}
function projectMenu(p, x, y) {
  popMenu(x, y, [
    { icon: 'folder-open', label: 'Abrir', fn: () => openProject(p.id) },
    { icon: 'pencil', label: 'Renombrar', fn: async () => { const n = await promptDlg({ title: 'Renombrar proyecto', value: p.name }); if (n) { await api(`/api/projects/${p.id}`, { method: 'PATCH', json: { name: n } }); loadHome(); } } },
    { icon: 'copy', label: 'Duplicar', fn: async () => { await api(`/api/projects/${p.id}/duplicate`, { method: 'POST' }); toast('Proyecto duplicado'); loadHome(); } },
    { icon: 'trash-2', label: 'Eliminar', danger: true, fn: () => deleteProject(p) },
  ]);
}
async function deleteProject(p) {
  if (!(await confirmDlg({ title: `¿Eliminar “${p.name}”?`, text: 'El proyecto y sus medios se moverán a la papelera de MojarraCut. Podrás deshacerlo.', ok: 'Eliminar', danger: true }))) return;
  const r = await api(`/api/projects/${p.id}`, { method: 'DELETE' });
  await loadHome();
  toast(`“${p.name}” se movió a la papelera`, { label: 'Deshacer', fn: async () => { await api(`/api/trash/${r.trashId}/restore`, { method: 'POST' }); loadHome(); } });
}
function newProjectDlg() {
  let f = FORMATS[0];
  modal(`<h2>${I('clapperboard', 20)}Nuevo proyecto</h2><p class="dim">Ponle nombre y elige el formato. Puedes cambiarlo después.</p>
    <input type="text" id="npName" placeholder="Mi video" autofocus maxlength="80">
    <div class="fmt-grid">${FORMATS.map((x, i) => `<button class="fmt ${i ? '' : 'on'}" data-i2="${i}">${I(x.i, 22)}<div><div class="t">${x.t}</div><div class="s">${x.s}</div></div></button>`).join('')}</div>
    <div class="actions"><button class="btn" id="npNo">Cancelar</button><button class="btn primary" id="npOk">${I('plus')}Crear proyecto</button></div>`);
  $$('#modalCard .fmt').forEach((b) => (b.onclick = () => { $$('#modalCard .fmt').forEach((x) => x.classList.remove('on')); b.classList.add('on'); f = FORMATS[+b.dataset.i2]; }));
  const go = async () => { const name = $('#npName').value.trim() || 'Mi video'; closeModal(); const r = await api('/api/projects', { method: 'POST', json: { name, width: f.w, height: f.h } }); openProject(r.id); };
  $('#npNo').onclick = closeModal; $('#npOk').onclick = go; $('#npName').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
async function openProject(id) {
  await api(`/api/projects/${id}/open`, { method: 'POST' });
  projectId = id; undoStack = []; redoStack = []; sel = { type: null }; time = 0;
  await loadProject(); await loadMedia();
  $('#home').classList.add('hidden'); $('#editor').classList.remove('hidden');
  applyLayout(); setSave('ok'); refresh(); chatLoad();
  if (totalDur() > 0) setZoom(clamp((scrollEl.clientWidth - 80) / totalDur(), 5, 120)); else setZoom(60);
}
async function loadProject() { project = normalize(await api('/api/project', { cache: 'no-store' })); document.title = `${project.name} — MojarraCut`; }
$('#hNew').onclick = newProjectDlg;
$('#hSearch').oninput = renderHome;
$('#hFolder').onclick = () => fetch('/api/open-folder?w=root', { method: 'POST' });

// ===== Editar con Claude: abre Claude Code en la carpeta de datos, o explica cómo conseguirlo =====
async function openClaude() {
  let r; try { r = await (await fetch('/api/claude', { method: 'POST' })).json(); } catch { return toast('No se pudo abrir Claude'); }
  const ideas = ['Corta las pausas largas del video', 'Pon subtítulos estilo karaoke', 'Haz un resumen de 30 s para Reels', 'Exporta el video en MP4'];
  const tips = `<p class="dim" style="margin-top:12px">Ideas para pedirle:</p><ul class="claude-steps">${ideas.map((t) => `<li>"${t}"</li>`).join('')}</ul>`;
  if (r.ok) {
    modal(`<h2>${I('sparkles', 20)} Claude se está abriendo</h2>
      <p>Se abrió una ventana con Claude ya conectado a MojarraCut. Escríbele lo que quieres y verás los cambios aquí al instante (puedes deshacerlos con Ctrl+Z).</p>${tips}
      <div class="actions"><button class="btn primary" id="clOk" autofocus>Entendido</button></div>`);
    $('#clOk').onclick = closeModal; return;
  }
  const folder = escHtml(r.folder || '');
  modal(`<h2>${I('sparkles', 20)} Edita tus videos con Claude</h2>
    <p>Para que Claude edite por ti necesitas <b>Claude Code</b> (incluido en los planes de pago de Claude). Solo hay que configurarlo una vez:</p>
    <ol class="claude-steps">
      <li>Descarga la app de Claude para escritorio e inicia sesión.</li>
      <li>Abre la pestaña <b>Code</b> y elige esta carpeta como carpeta de trabajo:<span class="claude-path">${folder}</span></li>
      <li>Pídele lo que quieras: Claude ya sabe cómo funciona MojarraCut.</li>
    </ol>
    <p class="dim">¿Usas la terminal? Instala Claude Code y vuelve a pulsar este botón: se abrirá solo.</p>${tips}
    <div class="actions"><button class="btn" id="clCopy">${I('copy', 16)} Copiar carpeta</button><button class="btn" id="clDir">${I('folder-open', 16)} Abrir carpeta</button><button class="btn primary" id="clDl" autofocus>${I('download', 16)} Descargar Claude</button></div>`);
  $('#clCopy').onclick = () => { navigator.clipboard.writeText(r.folder || '').then(() => toast('Carpeta copiada')); };
  $('#clDir').onclick = () => fetch('/api/open-folder?w=root', { method: 'POST' });
  $('#clDl').onclick = () => { window.open('https://claude.com/download'); closeModal(); };
}
$('#hClaude').onclick = openClaude; $('#btnClaude').onclick = () => toggleChat();
$('#hHelp').onclick = () => showHelp();

// ================= Dock: paneles movibles y redimensionables =================
const DEFAULT_LAYOUT = { slots: ['media', 'viewer', 'props', 'timeline'], c0: 260, c2: 310, rb: 300 };
let layout = (() => { try { const l = JSON.parse(localStorage.getItem('mc-layout')); if (l && l.slots && l.slots.length === 4) return l; } catch {} return { ...DEFAULT_LAYOUT, slots: [...DEFAULT_LAYOUT.slots] }; })();
const dock = $('#dock');
const PANELS = Object.fromEntries(DEFAULT_LAYOUT.slots.map((id) => [id, $('#p-' + id)]));
const PANEL_NAMES = { media: ['Medios', 'film'], viewer: ['Visor', 'tv'], props: ['Propiedades', 'sliders-horizontal'], timeline: ['Línea de tiempo', 'layers'] };
const isHidden = (p) => (layout.hidden || []).includes(p);
// Calcula la cuadrícula según los paneles visibles (los ocultos no ocupan espacio)
function setGrid() {
  const v = layout.slots.map((p) => !isHidden(p)), [a, b, c, d] = v, anyTop = a || b || c;
  const cols = [a ? `${layout.c0}px` : '0px', a && (b || c) ? '5px' : '0px', b ? 'minmax(200px,1fr)' : '0px', c && b ? '5px' : '0px', c ? (b ? `${layout.c2}px` : '1fr') : '0px'];
  if (!b && a && !c) cols[0] = '1fr';
  if (!b && a && c) { cols[0] = `${layout.c0}px`; cols[1] = '5px'; cols[4] = '1fr'; }
  dock.style.gridTemplateColumns = cols.join(' ');
  dock.style.gridTemplateRows = anyTop && d ? `minmax(150px,1fr) 5px ${layout.rb}px` : anyTop ? '1fr 0px 0px' : '0px 0px 1fr';
  layout.slots.forEach((p, i) => $(`.slot[data-slot="${i}"]`).classList.toggle('hidden', !v[i]));
  $('.splitter[data-split="0"]').classList.toggle('hidden', !(a && (b || c)));
  $('.splitter[data-split="1"]').classList.toggle('hidden', !(c && b));
  $('.splitter[data-split="row"]').classList.toggle('hidden', !(anyTop && d));
}
function togglePanel(p, show) {
  layout.hidden ||= [];
  const hide = show === undefined ? !isHidden(p) : !show;
  if (hide && layout.slots.filter((x) => !isHidden(x)).length <= 1) return toast('Debe quedar al menos una ventana visible');
  layout.hidden = hide ? [...new Set([...layout.hidden, p])] : layout.hidden.filter((x) => x !== p);
  applyLayout();
  if (hide) toast(`Ventana “${PANEL_NAMES[p][0]}” oculta`, { label: 'Mostrar', fn: () => togglePanel(p, true) });
}
function windowsMenu(x, y) {
  popMenu(x, y, [
    ...Object.entries(PANEL_NAMES).map(([id, [n, ic]]) => ({ icon: isHidden(id) ? 'eye-off' : 'eye', label: (isHidden(id) ? 'Mostrar ' : 'Ocultar ') + n, fn: () => togglePanel(id) })),
    { icon: 'sparkles', label: (layout.claude === false ? 'Mostrar' : 'Ocultar') + ' chat de Claude', fn: () => toggleChat() },
    { icon: 'rotate-ccw', label: 'Restablecer ventanas', fn: () => { resetLayout(); toast('Ventanas restablecidas'); } },
  ]);
}
function applyLayout() {
  layout.slots.forEach((p, i) => { const s = $(`.slot[data-slot="${i}"]`); if (s.firstElementChild !== PANELS[p]) s.replaceChildren(PANELS[p]); });
  setGrid(); applyChatLayout();
  try { localStorage.setItem('mc-layout', JSON.stringify(layout)); } catch {}
  requestAnimationFrame(() => { fitStage(); refreshTimeline(); });
}
$$('.splitter').forEach((sp) => sp.addEventListener('pointerdown', (e) => {
  e.preventDefault(); sp.setPointerCapture(e.pointerId); sp.classList.add('active');
  const k = sp.dataset.split, x0 = e.clientX, y0 = e.clientY, o = { ...layout }, W = dock.clientWidth, H = dock.clientHeight;
  const mv = (ev) => {
    if (k === '0') layout.c0 = clamp(o.c0 + ev.clientX - x0, 150, W - layout.c2 - 260);
    else if (k === '1') layout.c2 = clamp(o.c2 - (ev.clientX - x0), 180, W - layout.c0 - 260);
    else layout.rb = clamp(o.rb - (ev.clientY - y0), 120, H - 160);
    setGrid(); fitStage();
  };
  const up = () => { sp.classList.remove('active'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); applyLayout(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
}));
$$('[data-drag]').forEach((h) => h.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || e.target.closest('button,input,label,select,textarea')) return;
  const panel = h.closest('.panel').dataset.panel, x0 = e.clientX, y0 = e.clientY, ghost = $('#dragGhost');
  let started = false, target = null;
  const mv = (ev) => {
    if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
    if (!started) { started = true; ghost.innerHTML = I('grip-vertical') + escHtml($('.ptitle', h).textContent); ghost.classList.remove('hidden'); document.body.style.cursor = 'grabbing'; }
    ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 12 + 'px';
    const s = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.slot');
    $$('.slot').forEach((x) => x.classList.toggle('drop-target', x === s && layout.slots[+s.dataset.slot] !== panel));
    target = s;
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    ghost.classList.add('hidden'); document.body.style.cursor = ''; $$('.slot').forEach((x) => x.classList.remove('drop-target'));
    if (!started || !target) return;
    const a = layout.slots.indexOf(panel), b = +target.dataset.slot; if (a === b) return;
    [layout.slots[a], layout.slots[b]] = [layout.slots[b], layout.slots[a]]; applyLayout();
    toast('Paneles intercambiados', { label: 'Restablecer', fn: resetLayout });
  };
  window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}));
function resetLayout() { layout = { ...DEFAULT_LAYOUT, slots: [...DEFAULT_LAYOUT.slots], hidden: [] }; applyLayout(); }
$('#btnLayout').onclick = (e) => { const r = e.currentTarget.getBoundingClientRect(); windowsMenu(r.left, r.bottom + 4); };
// Botón "ocultar" y clic derecho en la cabecera de cada ventana
for (const [id, p] of Object.entries(PANELS)) {
  const head = $('.panel-head', p), b = el('button', 'icon-btn sm phide', I('x', 14));
  b.title = 'Ocultar esta ventana (recupérala en el menú Ventanas)'; b.setAttribute('aria-label', 'Ocultar ventana'); b.onclick = () => togglePanel(id, false);
  head.append(b);
  head.addEventListener('contextmenu', (e) => { if (e.target.closest('input')) return; e.preventDefault(); popMenu(e.clientX, e.clientY, [
    { icon: 'eye-off', label: `Ocultar “${PANEL_NAMES[id][0]}”`, fn: () => togglePanel(id, false) },
    ...Object.entries(PANEL_NAMES).filter(([k]) => isHidden(k)).map(([k, [n]]) => ({ icon: 'eye', label: 'Mostrar ' + n, fn: () => togglePanel(k, true) })),
    { icon: 'rotate-ccw', label: 'Restablecer ventanas', fn: resetLayout },
  ]); });
}

// ================= Medios =================
let transcribed = new Set();
async function loadMedia() {
  media = await api('/api/media');
  try { transcribed = new Set(await api('/api/transcripts')); } catch { transcribed = new Set(); }
  renderMediaList();
  for (const m of media) if (!info[mkey(m.name)]) analyze(m);
}
const mkey = (n) => projectId + '/' + n;
const minfo = (n) => info[mkey(n)] || {};
function analyze(m) {
  const url = '/media/' + encodeURIComponent(m.name), k = mkey(m.name);
  info[k] = { duration: m.kind === 'image' ? 5 : null };
  const redraw = () => { renderMediaList(); refreshTimeline(); if (sel.type === 'media' || sel.type === 'clip') renderInspector(); drawFrame(); };
  if (m.kind === 'image') {
    const img = new Image(); img.src = url;
    img.onload = () => { Object.assign(info[k], { w: img.naturalWidth, h: img.naturalHeight, thumb: url, img }); redraw(); };
  } else if (m.kind === 'video') {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url;
    v.onloadedmetadata = () => { Object.assign(info[k], { duration: v.duration, w: v.videoWidth, h: v.videoHeight }); v.currentTime = Math.min(1, v.duration / 3); };
    v.onseeked = () => {
      const c = document.createElement('canvas'); c.width = 240; c.height = Math.round(240 * (v.videoHeight / v.videoWidth || 0.5625));
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      info[k].thumb = c.toDataURL('image/jpeg', 0.7); v.removeAttribute('src'); v.load(); redraw();
    };
    v.onerror = () => { info[k].error = true; redraw(); };
  }
  if (m.kind === 'audio' || (m.kind === 'video' && m.size < 150e6)) {
    fetch(url).then((r) => r.arrayBuffer()).then((buf) => new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf))
      .then((ab) => {
        const d = ab.getChannelData(0), N = Math.min(6000, Math.ceil(ab.duration * 50)), step = Math.max(1, Math.floor(d.length / N)), peaks = new Float32Array(N);
        for (let i = 0; i < N; i++) { let mx = 0; for (let j = i * step, e = j + step; j < e; j += 8) { const a = Math.abs(d[j] || 0); if (a > mx) mx = a; } peaks[i] = mx; }
        info[k].peaks = peaks; info[k].duration ||= ab.duration; redraw();
      }).catch(() => {});
  }
}
function renderMediaList() {
  const list = $('#mediaList'); list.innerHTML = '';
  if (!project) return;
  const bin = project.bin, folders = bin.folders;
  if (curFolder && !folders.find((f) => f.id === curFolder)) curFolder = null;
  renderCrumbs();
  const inFolder = (name) => (bin.map[name] && folders.find((f) => f.id === bin.map[name]) ? bin.map[name] : null) === curFolder;
  const items = media.filter((m) => (mediaFilter === 'all' || m.kind === mediaFilter) && inFolder(m.name));
  const subs = folders.filter((f) => (f.parent || null) === curFolder);
  if (!media.length && !folders.length) { list.append(el('div', 'empty', `${I('upload', 28)}<b>Sin medios todavía</b>Importa videos, imágenes o audio con el botón <b>Importar</b> o arrastrándolos aquí.`)); return; }
  if (curFolder) { // casilla "subir" para sacar medios de la carpeta arrastrándolos
    const parent = (folders.find((f) => f.id === curFolder) || {}).parent || null;
    const up = el('div', 'media-item folder up'); up.tabIndex = 0; up.title = 'Subir un nivel · suelta aquí para sacar el medio de esta carpeta';
    up.append(el('div', 'media-thumb', I('corner-left-up', 30)), el('div', 'media-meta', `<div class="n">..</div><div class="d">Subir</div>`));
    up.ondblclick = up.onclick = () => { curFolder = parent; renderMediaList(); };
    dropTarget(up, parent); list.append(up);
  }
  for (const f of subs) list.append(folderTile(f));
  if (!items.length && !subs.length) { list.append(el('div', 'empty', curFolder ? `${I('folder', 26)}Carpeta vacía.<br>Arrastra medios aquí desde otra carpeta.` : 'No hay medios de este tipo.')); return; }
  for (const m of items) {
    const i = minfo(m.name), used = usage(m.name);
    const it = el('div', 'media-item' + (sel.type === 'media' && sel.id === m.name ? ' sel' : '')); it.draggable = true; it.tabIndex = 0;
    it.title = `${m.name}\n${used ? `Usado en ${used} clip(s)` : 'Sin usar'} · Doble clic para añadir al cursor`;
    const th = el('div', 'media-thumb', i.thumb ? '' : I(i.error ? 'triangle-alert' : KIND[m.kind].icon, 26));
    if (i.thumb) th.style.backgroundImage = `url("${i.thumb}")`;
    const b = el('span', 'badge', I(KIND[m.kind].icon, 11) + KIND[m.kind].label); b.style.background = KIND[m.kind].color;
    it.append(th, b);
    if (used) it.append(el('span', 'used-dot'));
    it.append(el('div', 'media-meta', `<div class="n">${escHtml(m.name)}</div><div class="d">${i.error ? 'Formato no soportado' : m.kind === 'image' ? (i.w ? `${i.w}×${i.h}` : 'Imagen') : i.duration ? fmt(i.duration) : 'Analizando…'}</div>`));
    it.ondragstart = (e) => { e.dataTransfer.setData('text/mojarra', m.name); e.dataTransfer.effectAllowed = 'copyMove'; dragMedia = m.name; };
    it.ondragend = () => { dragMedia = null; clearDropMarks(); clearTimeout(springTimer); $$('.drop-in').forEach((n) => n.classList.remove('drop-in')); };
    it.onclick = () => { select('media', m.name); renderMediaList(); };
    it.ondblclick = () => addMediaAt(m.name, null, time);
    it.onkeydown = (e) => { if (e.key === 'Enter') addMediaAt(m.name, null, time); };
    it.oncontextmenu = (e) => { e.preventDefault(); select('media', m.name); renderMediaList(); popMenu(e.clientX, e.clientY, [
      { icon: 'plus', label: 'Añadir en el cursor', fn: () => addMediaAt(m.name, null, time) },
      { icon: 'folder-input', label: 'Mover a carpeta…', fn: () => moveToFolderDlg(m.name) },
      ...(m.kind !== 'image' ? [{ icon: 'mic', label: transcribed.has(m.name) ? 'Transcrito · volver a transcribir…' : 'Transcribir audio…', fn: () => transcribeMedia(m.name) }] : []),
      { icon: 'trash-2', label: 'Quitar del proyecto', danger: true, fn: () => deleteMedia(m.name) }]); };
    list.append(it);
  }
}
// ---- Carpetas del panel de medios (se guardan en project.bin) ----
const folderPath = (id) => { const out = []; let f = project.bin.folders.find((x) => x.id === id); while (f) { out.unshift(f); f = project.bin.folders.find((x) => x.id === f.parent); } return out; };
function moveMedia(name, folderId) {
  if ((project.bin.map[name] || null) === folderId) return;
  mutate(() => { if (folderId) project.bin.map[name] = folderId; else delete project.bin.map[name]; });
  const f = project.bin.folders.find((x) => x.id === folderId); toast(`“${name}” movido a ${f ? '“' + f.name + '”' : 'Medios'}`, { label: 'Deshacer', fn: undo });
}
let dragFolder = null, springTimer = null;
const isInside = (id, anc) => { for (let f = project.bin.folders.find((x) => x.id === id); f; f = project.bin.folders.find((x) => x.id === f.parent)) if (f.id === anc) return true; return false; };
function moveFolder(fid, parent) {
  const f = project.bin.folders.find((x) => x.id === fid); if (!f || (f.parent || null) === parent) return;
  if (parent && isInside(parent, fid)) return toast('No puedes mover una carpeta dentro de sí misma');
  mutate(() => (f.parent = parent));
  const p = project.bin.folders.find((x) => x.id === parent); toast(`Carpeta “${f.name}” movida a ${p ? '“' + p.name + '”' : 'Medios'}`, { label: 'Deshacer', fn: undo });
}
function dropTarget(node, folderId) {
  const ok = () => dragMedia || (dragFolder && dragFolder !== folderId && !(folderId && isInside(folderId, dragFolder)));
  node.addEventListener('dragover', (e) => {
    if (!ok()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    if (!node.classList.contains('drop-in')) { // mantener encima ~0.8 s abre la carpeta (para llegar a subcarpetas)
      node.classList.add('drop-in'); clearTimeout(springTimer);
      if (folderId !== curFolder && node.classList.contains('folder')) springTimer = setTimeout(() => { curFolder = folderId; renderMediaList(); }, 800);
    }
  });
  node.addEventListener('dragleave', (e) => { if (node.contains(e.relatedTarget)) return; node.classList.remove('drop-in'); clearTimeout(springTimer); });
  node.addEventListener('drop', (e) => {
    if (!ok()) return; e.preventDefault(); e.stopPropagation(); node.classList.remove('drop-in'); clearTimeout(springTimer);
    if (dragMedia) moveMedia(dragMedia, folderId); else moveFolder(dragFolder, folderId);
    dragMedia = dragFolder = null;
  });
}
function folderTile(f) {
  const n = Object.values(project.bin.map).filter((x) => x === f.id).length + project.bin.folders.filter((x) => x.parent === f.id).length;
  const it = el('div', 'media-item folder'); it.tabIndex = 0; it.title = `Carpeta “${f.name}” · doble clic para abrir · arrastra medios aquí`;
  it.append(el('div', 'media-thumb', I('folder', 34)), el('div', 'media-meta', `<div class="n">${escHtml(f.name)}</div><div class="d">${n} elemento(s)</div>`));
  it.ondblclick = () => { curFolder = f.id; renderMediaList(); };
  it.onkeydown = (e) => { if (e.key === 'Enter') { curFolder = f.id; renderMediaList(); } if (e.key === 'F2') renameFolder(f); if (e.key === 'Delete') { e.stopPropagation(); deleteFolder(f); } };
  it.oncontextmenu = (e) => { e.preventDefault(); popMenu(e.clientX, e.clientY, [{ icon: 'folder-open', label: 'Abrir', fn: () => { curFolder = f.id; renderMediaList(); } }, { icon: 'pencil', label: 'Renombrar', fn: () => renameFolder(f) }, { icon: 'trash-2', label: 'Eliminar carpeta', danger: true, fn: () => deleteFolder(f) }]); };
  it.draggable = true;
  it.ondragstart = (e) => { e.dataTransfer.setData('text/mojarra-folder', f.id); e.dataTransfer.effectAllowed = 'move'; dragFolder = f.id; };
  it.ondragend = () => { dragFolder = null; clearTimeout(springTimer); $$('.drop-in').forEach((n) => n.classList.remove('drop-in')); };
  dropTarget(it, f.id);
  return it;
}
function renderCrumbs() {
  const c = $('#mediaCrumb'); c.innerHTML = '';
  const mk = (label, id, icon) => { const b = el('button', 'crumb', (icon ? I(icon, 13) : '') + escHtml(label)); b.title = id ? `Abrir “${label}”` : 'Volver a la raíz de Medios'; b.onclick = () => { curFolder = id; renderMediaList(); }; dropTarget(b, id); return b; };
  c.append(mk('Medios', null, 'film'));
  for (const f of folderPath(curFolder)) { c.append(el('span', 'dim', I('chevron-right', 12))); c.append(mk(f.name, f.id)); }
  c.classList.toggle('hidden', !curFolder && !project.bin.folders.length);
}
async function newFolder() {
  const name = await promptDlg({ title: 'Nueva carpeta', value: 'Nueva carpeta', ok: 'Crear' }); if (!name) return;
  mutate(() => project.bin.folders.push({ id: uid('f'), name, parent: curFolder }));
}
async function renameFolder(f) { const n = await promptDlg({ title: 'Renombrar carpeta', value: f.name }); if (n) mutate(() => (f.name = n)); }
function deleteFolder(f) {
  mutate(() => {
    for (const k in project.bin.map) if (project.bin.map[k] === f.id) { if (f.parent) project.bin.map[k] = f.parent; else delete project.bin.map[k]; }
    project.bin.folders.forEach((x) => { if (x.parent === f.id) x.parent = f.parent || null; });
    project.bin.folders.splice(project.bin.folders.indexOf(f), 1);
  });
  toast(`Carpeta “${f.name}” eliminada (su contenido se conservó)`, { label: 'Deshacer', fn: undo });
}
function moveToFolderDlg(name) {
  const opts = [{ id: null, label: 'Medios (raíz)' }, ...project.bin.folders.map((f) => ({ id: f.id, label: folderPath(f.id).map((x) => x.name).join(' › ') }))];
  modal(`<h2>${I('folder-input', 20)}Mover “${escHtml(name)}”</h2><div class="move-list">${opts.map((o, i) => `<button class="opt btn" data-k="${i}">${I(o.id ? 'folder' : 'film')}${escHtml(o.label)}</button>`).join('')}</div>
    <div class="actions"><button class="btn" id="mfNew">${I('folder-plus')}Nueva carpeta</button><button class="btn ghost" id="mfNo">Cancelar</button></div>`);
  $$('#modalCard [data-k]').forEach((b) => (b.onclick = () => { closeModal(); moveMedia(name, opts[+b.dataset.k].id); }));
  $('#mfNo').onclick = closeModal;
  $('#mfNew').onclick = async () => { closeModal(); const n = await promptDlg({ title: 'Nueva carpeta', value: 'Nueva carpeta', ok: 'Crear y mover' }); if (!n) return; const id = uid('f'); mutate(() => { project.bin.folders.push({ id, name: n, parent: null }); project.bin.map[name] = id; }); };
}
$$('.media-filter .chip').forEach((c) => (c.onclick = () => { mediaFilter = c.dataset.f; $$('.media-filter .chip').forEach((x) => x.classList.toggle('on', x === c)); renderMediaList(); }));
async function uploadFiles(files) {
  const arr = [...files]; if (!arr.length) return [];
  const names = [];
  for (const [k, f] of arr.entries()) {
    if (/\.srt$/i.test(f.name)) { importSrt(await f.text()); continue; }
    if (!/^(video|audio|image)\//.test(f.type) && !/\.(mp4|mov|mkv|webm|avi|mp3|wav|ogg|m4a|aac|flac|png|jpe?g|gif|webp|bmp)$/i.test(f.name)) { toast(`“${f.name}” no es un video, audio o imagen compatible`, null, true); continue; }
    toast(`Importando ${k + 1}/${arr.length}: ${f.name}…`);
    const r = await api('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
    names.push(r.name);
  }
  if (curFolder && names.length) mutate(() => names.forEach((n) => (project.bin.map[n] = curFolder)));
  await loadMedia();
  if (names.length) toast(`${names.length} archivo(s) importado(s)`);
  return names;
}
$('#fileInput').onchange = (e) => { uploadFiles(e.target.files); e.target.value = ''; };
async function deleteMedia(name) {
  const n = usage(name);
  if (n && !(await confirmDlg({ title: `¿Quitar “${name}”?`, text: `Este archivo se usa en <b>${n} clip(s)</b>; también se quitarán del timeline.`, ok: 'Quitar', danger: true }))) return;
  const before = JSON.stringify(project);
  await api('/api/media/' + encodeURIComponent(name), { method: 'DELETE' });
  if (n) mutate(() => { for (const t of project.tracks) t.clips = t.clips.filter((c) => c.src !== name); });
  if (sel.type === 'media') sel = { type: null };
  await loadMedia(); renderInspector();
  toast(`“${name}” quitado`, { label: 'Deshacer', fn: async () => { await api(`/api/media/${encodeURIComponent(name)}/restore`, { method: 'POST' }); if (n) { undoStack.push(JSON.stringify(project)); project = JSON.parse(before); scheduleSave(); refresh(); } loadMedia(); } });
}
function mediaDuration(name) { return kindOfName(name) === 'image' ? 5 : minfo(name).duration || 5; }
function addMediaAt(name, trackId, start) {
  const kind = kindOfName(name);
  let track = project.tracks.find((t) => t.id === trackId);
  if (!track || !fits(kind, track.type) || track.locked) track = project.tracks.find((t) => fits(kind, t.type) && !t.locked && !overlaps(t, start, mediaDuration(name)));
  if (!track) {
    const type = kind === 'audio' ? 'audio' : 'video';
    track = { id: uid('t'), type, name: (type === 'audio' ? 'Audio ' : 'Video ') + (project.tracks.filter((t) => t.type === type).length + 1), clips: [] };
    mutate(() => (type === 'audio' ? project.tracks.push(track) : project.tracks.unshift(track)), { save: false });
  }
  const c = { id: uid(), src: name, start: Math.max(0, start), in: 0, duration: mediaDuration(name), volume: 1 };
  if (kind !== 'audio') Object.assign(c, { scale: 1, x: 0, y: 0, opacity: 1 });
  mutate(() => { track.clips.push(c); sel = { type: 'clip', id: c.id }; });
}
const overlaps = (t, s, d, ignore) => t.clips.some((c) => c.id !== ignore && s < c.start + c.duration - 1e-3 && s + d > c.start + 1e-3);

// ================= Motor de reproducción =================
const els = {};
let actx = null, master = null, recDest = null;
function ensureAudio() {
  if (actx) return; actx = new AudioContext(); master = actx.createGain(); master.connect(actx.destination);
  recDest = actx.createMediaStreamDestination(); master.connect(recDest);
  for (const id in els) wire(els[id]);
}
function wire(m) { if (!actx || m._gain) return; const src = actx.createMediaElementSource(m); m._gain = actx.createGain(); src.connect(m._gain).connect(master); }
function mediaEl(c, kind) {
  let m = els[c.id];
  if (m && m._src !== c.src) { m.pause(); delete els[c.id]; m = null; }
  if (!m) {
    m = document.createElement(kind === 'audio' ? 'audio' : 'video');
    m.preload = 'auto'; m.playsInline = true; m._src = c.src; m.src = '/media/' + encodeURIComponent(c.src);
    m.addEventListener('seeked', () => { if (!playing) drawFrame(); });
    m.addEventListener('loadeddata', () => { if (!playing) drawFrame(); });
    els[c.id] = m; wire(m);
  }
  return m;
}
function fadeMul(c, t) {
  const lt = t - c.start; let k = 1;
  if (c.fadeIn > 0) k = Math.min(k, lt / c.fadeIn);
  if (c.fadeOut > 0) k = Math.min(k, (c.duration - lt) / c.fadeOut);
  return clamp(k, 0, 1);
}
function syncMedia(t) {
  const live = new Set();
  if (!project) return;
  for (const tr of project.tracks) {
    const { tail } = linkTransitions(tr);
    for (const c of tr.clips) {
      const kind = clipKind(c, tr); if (kind === 'text' || kind === 'image') continue;
      const ext = (tail.get(c.id) || {}).d || 0, end = c.start + c.duration;
      const active = t >= c.start && t < end + ext, audible = t < end;
      if (!active && !(c.start - t < 1.5 && c.start > t)) { const m = els[c.id]; if (m && !m.paused) m.pause(); continue; }
      const m = mediaEl(c, kind); live.add(c.id);
      const want = t - c.start + (c.in || 0);
      if (!active) { if (!m.paused) m.pause(); if (Math.abs(m.currentTime - (c.in || 0)) > 0.1 && m.readyState >= 1) m.currentTime = c.in || 0; continue; }
      const lt = t - c.start, fi = aFadeIn(c), fo = aFadeOut(c);
      const af = clamp(Math.min(fi > 0 ? lt / fi : 1, fo > 0 ? (c.duration - lt) / fo : 1), 0, 1);
      const vol = (!audible || tr.muted || c.muted) ? 0 : (c.volume ?? 1) * af;
      if (m._gain) { m._gain.gain.value = vol; m.volume = 1; } else m.volume = clamp(vol, 0, 1);
      if (m.readyState >= 1) {
        const wantC = Math.min(want, (m.duration || Infinity) - 0.03);
        if (!playing) { if (!m.paused) m.pause(); if (Math.abs(m.currentTime - wantC) > 0.02) m.currentTime = wantC; }
        else if (want < (m.duration || Infinity)) { if (Math.abs(m.currentTime - want) > 0.3) m.currentTime = want; if (m.paused) m.play().catch(() => {}); }
        else if (!m.paused) m.pause();
      }
    }
  }
  for (const id in els) if (!live.has(id) && !findClip(id)) { els[id].pause(); delete els[id]; }
}
const visualRects = [];      // para seleccionar/arrastrar en el visor
function drawFrame() {
  if (!project) return;
  const W = project.width, H = project.height;
  ctx.fillStyle = project.background; ctx.fillRect(0, 0, W, H);
  visualRects.length = 0;
  for (const tr of [...project.tracks].reverse()) {
    if (tr.hidden || tr.type === 'audio') continue;
    const { tail } = tr.type === 'video' ? linkTransitions(tr) : { tail: new Map() };
    for (const c of tr.clips) {
      const tl = tail.get(c.id), ext = tl ? tl.d : 0;
      if (time < c.start || time >= c.start + c.duration + ext) continue;
      let alpha = (c.opacity ?? 1), dx = 0, dy = 0;
      const tri = tr.type === 'video' && c.transition && TRANS_IDS.includes(c.transition.type) ? c.transition : null;
      const lt = time - c.start;
      // fundidos / transición de entrada
      if (tri && lt < transDur(c)) {
        const p = clamp(lt / transDur(c), 0, 1);
        if (tri.type === 'dissolve') alpha *= Math.min(p, c.fadeIn ? lt / c.fadeIn : 1);
        else if (tri.type === 'black') alpha *= clamp(2 * p - 1, 0, 1);
        else if (tri.type === 'slide-left' || tri.type === 'push-left') dx = W * (1 - p);
        else if (tri.type === 'slide-right' || tri.type === 'push-right') dx = -W * (1 - p);
        else if (tri.type === 'slide-up') dy = H * (1 - p);
        else if (tri.type === 'slide-down') dy = -H * (1 - p);
      } else if (c.fadeIn > 0 && lt < c.fadeIn) alpha *= clamp(lt / c.fadeIn, 0, 1);
      if (tl && time >= c.start + c.duration) {       // cola bajo la transición del siguiente clip
        const q = clamp((time - tl.at) / tl.d, 0, 1);
        if (tl.type === 'black') alpha *= clamp(1 - 2 * q, 0, 1);
        if (tl.type === 'push-left') dx -= W * q;
        if (tl.type === 'push-right') dx += W * q;
      } else if (c.fadeOut > 0 && c.duration - lt < c.fadeOut) alpha *= clamp((c.duration - lt) / c.fadeOut, 0, 1);
      ctx.save(); ctx.globalAlpha = clamp(alpha, 0, 1);
      if (tr.type === 'text') { const r = drawText(c, lt); if (r) visualRects.push({ id: c.id, ...r }); }
      else {
        const kind = kindOfName(c.src);
        const src = kind === 'image' ? minfo(c.src).img : els[c.id];
        const sw = kind === 'image' ? src?.naturalWidth : src?.videoWidth, sh = kind === 'image' ? src?.naturalHeight : src?.videoHeight;
        if (src && sw) {
          const cr = c.crop || {}, cl = cr.l || 0, ct = cr.t || 0, cw = 1 - cl - (cr.r || 0), ch = 1 - ct - (cr.b || 0);
          const w0 = sw * cw, h0 = sh * ch, f = Math.min(W / w0, H / h0) * (c.scale ?? 1), w = w0 * f, h = h0 * f;
          const x = (W - w) / 2 + (c.x || 0) + dx, y = (H - h) / 2 + (c.y || 0) + dy;
          ctx.filter = effectsCss(c);
          try { ctx.drawImage(src, sw * cl, sh * ct, w0, h0, x, y, w, h); } catch {}
          ctx.filter = 'none';
          visualRects.push({ id: c.id, x, y, w, h });
        }
      }
      ctx.restore();
    }
  }
  if (!playing && !exporting) for (const r of visualRects) if (multi.has(r.id)) { ctx.save(); ctx.strokeStyle = '#a99dff'; ctx.lineWidth = Math.max(2, W / 500); ctx.setLineDash([W / 120, W / 160]); ctx.strokeRect(r.x, r.y, r.w, r.h); ctx.restore(); }
  $('#stageHint').classList.toggle('hidden', totalDur() > 0);
}
// Subtítulos: diseño + animación por palabra (misma lógica que el export ASS, ver subs.js)
function drawText(c, lt = 0) {
  const s = c.style || {}, W = project.width, H = project.height, size = s.fontSize || 64;
  const fam = `"${s.font || 'Arial'}", Arial, sans-serif`, weight = s.bold === false ? 400 : 700;
  ctx.font = `${weight} ${size}px ${fam}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  const lines = SUBS.tokenize(c.text, s.uppercase), lh = size * 1.18, bh = lines.length * lh;
  const anim = s.anim || 'none', times = anim === 'none' ? [] : SUBS.wordTimes(c), k = times.length ? SUBS.activeWord(times, lt) : -1;
  const hl = s.highlight || '#ffd400', ow = s.background ? 0 : (s.outline ?? 3), oc = s.outlineColor || '#000000';
  const sp = ctx.measureText(' ').width;
  let y = s.position === 'top' ? H * 0.08 : s.position === 'center' ? (H - bh) / 2 : H * 0.92 - bh;
  y += c.y || 0; const cx = W / 2 + (c.x || 0);
  let maxW = 0;
  lines.forEach((ln, li) => {
    const ws = ln.map((w) => ctx.measureText(w.t).width), lw = ws.reduce((a, b) => a + b, 0) + sp * Math.max(0, ln.length - 1);
    maxW = Math.max(maxW, lw);
    const ly = y + li * lh; let x = cx - lw / 2;
    if (s.background && ln.length) {
      const vis = anim === 'reveal' ? ln.filter((w) => w.i <= k) : ln;
      if (vis.length) { const vw = anim === 'reveal' ? vis.reduce((a, w) => a + ws[ln.indexOf(w)], 0) + sp * (vis.length - 1) : lw;
        ctx.save(); ctx.globalAlpha *= s.backgroundOpacity ?? 0.6; ctx.fillStyle = s.background; const p = size * 0.28;
        ctx.fillRect(x - p, ly - p * 0.6, vw + 2 * p, lh + p * 0.4); ctx.restore(); }
    }
    ln.forEach((w, j) => {
      const tw = ws[j], cur = w.i === k;
      if (anim === 'reveal' && w.i > k) { x += tw + sp; return; }
      let fill = s.color || '#ffffff', scale = 1;
      if (cur && (anim === 'highlight' || anim === 'pop')) fill = hl;
      if (anim === 'karaoke' && w.i < k) fill = hl;
      if (cur && anim === 'pop') { const e = clamp((lt - times[k][0]) / 0.09, 0, 1), e2 = clamp((lt - times[k][0] - 0.09) / 0.09, 0, 1); scale = 1.12 + 0.1 * e - 0.07 * e2; }
      ctx.save();
      if (scale !== 1) { ctx.translate(x + tw / 2, ly + size / 2); ctx.scale(scale, scale); ctx.translate(-(x + tw / 2), -(ly + size / 2)); }
      if (s.shadow) { ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowOffsetX = ctx.shadowOffsetY = s.shadow; ctx.shadowBlur = s.shadow; }
      if (s.glow) { ctx.shadowColor = oc; ctx.shadowBlur = s.glow; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; }
      if (cur && anim === 'marker') { ctx.lineWidth = size * 0.44; ctx.strokeStyle = hl; ctx.strokeText(w.t, x, ly); }
      else if (ow) { ctx.lineWidth = ow * 2; ctx.strokeStyle = oc; ctx.strokeText(w.t, x, ly); }
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = fill; ctx.fillText(w.t, x, ly);
      if (anim === 'karaoke' && cur) { // relleno progresivo de la palabra que suena
        const p = clamp((lt - times[k][0]) / Math.max(0.01, times[k][1] - times[k][0]), 0, 1);
        ctx.beginPath(); ctx.rect(x - 2, ly - size, (tw + 4) * p, size * 3); ctx.clip(); ctx.fillStyle = hl; ctx.fillText(w.t, x, ly);
      }
      ctx.restore(); x += tw + sp;
    });
  });
  const pad = size * 0.3;
  return { x: cx - maxW / 2 - pad, y: y - pad, w: maxW + 2 * pad, h: bh + 2 * pad };
}
function setTime(t, { sync = true } = {}) {
  time = clamp(t, 0, Math.max(totalDur(), 0));
  if (sync) syncMedia(time);
  drawFrame(); updatePlayhead();
}
function play() {
  if (!project) return;
  if (playing) return pause();
  if (!totalDur()) return toast('Añade algún clip al timeline para reproducir');
  ensureAudio(); actx.resume();
  if (time >= totalDur() - 0.01) time = 0;
  playing = true; lastTick = performance.now(); setPlayBtn(); syncMedia(time); requestAnimationFrame(tick);
}
function pause() { if (!playing) return; playing = false; setPlayBtn(); syncMedia(time); drawFrame(); }
function setPlayBtn() { const b = $('#btnPlay'); b.innerHTML = I(playing ? 'pause' : 'play', 18); b.setAttribute('aria-label', playing ? 'Pausa' : 'Reproducir'); }
function tick(now) {
  if (!playing) return;
  time += (now - lastTick) / 1000; lastTick = now;
  if (time >= totalDur()) { time = totalDur(); pause(); if (exporting) finishExport(); updatePlayhead(); return; }
  syncMedia(time); drawFrame(); updatePlayhead(true);
  if (exporting) updateExportBar(time / totalDur());
  requestAnimationFrame(tick);
}
function fitStage() {
  if (!project) return; const w = $('#stageWrap'), aw = w.clientWidth - 20, ah = w.clientHeight - 20;
  const k = Math.min(aw / project.width, ah / project.height);
  canvas.style.width = Math.max(10, project.width * k) + 'px'; canvas.style.height = Math.max(10, project.height * k) + 'px';
}
new ResizeObserver(() => fitStage()).observe($('#stageWrap'));

// Visor: clic = seleccionar clip; arrastrar = mover el clip seleccionado
canvas.addEventListener('pointerdown', (e) => {
  if (!project || playing) return;
  const r = canvas.getBoundingClientRect(), k = project.width / r.width;
  const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
  const hit = [...visualRects].reverse().find((v) => px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h);
  if (!hit) { select(null); return; }
  const f = findClip(hit.id); if (!f) return;
  if (sel.id !== hit.id) select('clip', hit.id);
  if (f.t.locked) return;
  const before = JSON.stringify(project), ox = f.c.x || 0, oy = f.c.y || 0; let moved = false;
  canvas.setPointerCapture(e.pointerId);
  const mv = (ev) => { const ddx = (ev.clientX - e.clientX) * k, ddy = (ev.clientY - e.clientY) * k; if (Math.abs(ddx) + Math.abs(ddy) > 3) moved = true; if (!moved) return; f.c.x = Math.round(ox + ddx); f.c.y = Math.round(oy + ddy); if (ev.shiftKey) { if (Math.abs(f.c.x) < 30 * k) f.c.x = 0; if (Math.abs(f.c.y) < 30 * k) f.c.y = 0; } drawFrame(); };
  const up = () => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', up); if (moved) { undoStack.push(before); redoStack = []; scheduleSave(); renderInspector(); } };
  canvas.addEventListener('pointermove', mv); canvas.addEventListener('pointerup', up);
});
canvas.addEventListener('dblclick', play);
canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault(); if (!project) return;
  const r = canvas.getBoundingClientRect(), k = project.width / r.width, px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
  const hit = [...visualRects].reverse().find((v) => px >= v.x && px <= v.x + v.w && py >= v.y && py <= v.y + v.h);
  const f = hit && findClip(hit.id);
  if (f && !multi.has(f.c.id)) select('clip', f.c.id);
  popMenu(e.clientX, e.clientY, f ? [
    { icon: 'clipboard-copy', label: 'Copiar (Ctrl+C)', fn: copySel },
    ...(clipboard ? [{ icon: 'clipboard-paste', label: 'Pegar en el cursor', fn: pasteAtPlayhead }] : []),
    { icon: 'copy', label: 'Duplicar', fn: duplicateSel },
    ...(f.t.type !== 'text' ? [{ icon: 'wand-sparkles', label: 'Añadir efecto…', fn: () => { propsTab = 'efectos'; renderInspector(); } }] : []),
    { icon: 'rotate-ccw', label: 'Restablecer posición y escala', fn: () => mutate(() => Object.assign(f.c, { x: 0, y: 0, scale: 1 })) },
    { icon: 'trash-2', label: 'Eliminar', danger: true, fn: deleteSel },
  ] : [
    ...(clipboard ? [{ icon: 'clipboard-paste', label: 'Pegar en el cursor', fn: pasteAtPlayhead }] : []),
    { icon: playing ? 'pause' : 'play', label: playing ? 'Pausa' : 'Reproducir', fn: play },
    { icon: 'type', label: 'Añadir texto aquí', fn: () => addText() },
    { icon: 'download', label: 'Exportar…', fn: openExport },
  ]);
});
$('#ruler').addEventListener('contextmenu', (e) => { e.preventDefault(); const t = xToTime(e.clientX); popMenu(e.clientX, e.clientY, [{ icon: 'skip-forward', label: `Mover el cursor a ${fmt(t)}`, fn: () => setTime(t) }, ...(clipboard ? [{ icon: 'clipboard-paste', label: 'Pegar aquí', fn: () => { setTime(t); pasteAtPlayhead(); } }] : [])]); });
// Soltar en cualquier parte de la lista = mover a la carpeta que se está viendo (p. ej. tras abrirse sola al pasar encima)
{
  const ml = $('#mediaList');
  const can = () => project && ((dragMedia && (project.bin.map[dragMedia] || null) !== curFolder) || (dragFolder && dragFolder !== curFolder && !(curFolder && isInside(curFolder, dragFolder)) && (project.bin.folders.find((f) => f.id === dragFolder)?.parent || null) !== curFolder));
  ml.addEventListener('dragover', (e) => { if (!can()) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; ml.classList.add('drop-in'); });
  ml.addEventListener('dragleave', (e) => { if (!ml.contains(e.relatedTarget)) ml.classList.remove('drop-in'); });
  ml.addEventListener('drop', (e) => {
    ml.classList.remove('drop-in'); if (!can()) return; e.preventDefault(); e.stopPropagation(); clearTimeout(springTimer);
    if (dragMedia) moveMedia(dragMedia, curFolder); else moveFolder(dragFolder, curFolder);
    dragMedia = dragFolder = null;
  });
  document.addEventListener('dragend', () => ml.classList.remove('drop-in'));
}
$('#mediaList').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.media-item')) return; e.preventDefault();
  popMenu(e.clientX, e.clientY, [
    { icon: 'upload', label: 'Importar archivos…', fn: () => $('#fileInput').click() },
    { icon: 'folder-plus', label: 'Nueva carpeta', fn: newFolder },
    ...(curFolder ? [{ icon: 'corner-left-up', label: 'Subir un nivel', fn: () => { curFolder = (project.bin.folders.find((f) => f.id === curFolder) || {}).parent || null; renderMediaList(); } }] : []),
    { icon: 'folder-open', label: 'Ver carpeta en el Explorador', fn: () => fetch('/api/open-folder?w=media', { method: 'POST' }) },
  ]);
});

// ================= Timeline =================
const tracksEl = $('#tracks'), scrollEl = $('#tlScroll'), contentEl = $('#tlContent');
let dragMedia = null;
function refresh() {
  if (!project) return;
  if (canvas.width !== project.width || canvas.height !== project.height) { canvas.width = project.width; canvas.height = project.height; }
  fitStage();
  if (document.activeElement !== $('#projName')) $('#projName').value = project.name || '';
  $('#fmtLabel').textContent = `${project.width}×${project.height} · ${project.fps} fps`;
  refreshTimeline(); renderInspector(); renderMediaList(); setTime(time);
  updateToolbar();
}
function updateToolbar() {
  if (!project) return;
  $('#btnUndo').disabled = !undoStack.length; $('#btnRedo').disabled = !redoStack.length;
  const c = selClip();
  $('#btnSplit').disabled = !allClips().length; $('#btnDelete').disabled = !sel.type; $('#btnDup').disabled = !c;
  $('#btnTrans').disabled = !(c && c.t.type === 'video' && multi.size === 1);
  $('#btnCopy').disabled = !c; $('#btnPaste').disabled = !clipboard;
  $('#selCount').textContent = multi.size > 1 ? `${multi.size} clips seleccionados` : '';
}
function refreshTimeline() {
  if (!project) return;
  const width = Math.max(scrollEl.clientWidth, (totalDur() + 30) * pps);
  contentEl.style.width = width + 'px';
  renderRuler(width);
  const heads = $('#trackHeads'); heads.innerHTML = '';
  tracksEl.innerHTML = '';
  project.tracks.forEach((tr, ti) => {
    const h = el('div', 'track-head' + (sel.type === 'track' && sel.id === tr.id ? ' sel' : '')); h.dataset.id = tr.id;
    const grip = el('span', 'tgrip', I('grip-vertical', 14)); grip.title = 'Arrastra para reordenar la pista';
    const dot = el('span', 'tdot'); dot.style.background = TRACK_COLORS[tr.type];
    const body = el('div', 'tbody');
    const name = el('input', 'tname'); name.value = tr.name; name.title = 'Nombre de la pista (clic para editar)'; name.setAttribute('aria-label', 'Nombre de pista');
    name.onchange = () => mutate(() => (tr.name = name.value || tr.name)); name.onkeydown = (e) => { if (e.key === 'Enter') name.blur(); };
    const btns = el('div', 'tbtns'); btns.append(el('span', 'dim', I(TRACK_ICON[tr.type], 13)));
    const tb = (on, off, key, title) => { const b = el('button', 'tbtn' + (tr[key] ? ' on' : ''), I(tr[key] ? on : off, 14)); b.title = title + (tr[key] ? ' (activado)' : ''); b.setAttribute('aria-pressed', !!tr[key]); b.onclick = (e) => { e.stopPropagation(); mutate(() => (tr[key] = !tr[key])); }; btns.append(b); };
    if (tr.type !== 'audio') tb('eye-off', 'eye', 'hidden', 'Ocultar pista');
    if (tr.type !== 'text') tb('volume-x', 'volume-2', 'muted', 'Silenciar pista');
    tb('lock', 'lock-open', 'locked', 'Bloquear pista');
    body.append(name, btns);
    h.append(grip, dot, body);
    h.onclick = (e) => { if (!e.target.closest('input,button')) select('track', tr.id); };
    h.oncontextmenu = (e) => { e.preventDefault(); select('track', tr.id); trackMenu(e.clientX, e.clientY, tr, name); };
    grip.addEventListener('pointerdown', (e) => startTrackDrag(e, tr, h));
    heads.append(h);

    const row = el('div', 'track' + (tr.hidden ? ' hidden-t' : '') + (tr.muted ? ' muted-t' : '') + (sel.type === 'track' && sel.id === tr.id ? ' sel-t' : '')); row.dataset.id = tr.id;
    for (const c of tr.clips) row.append(clipEl(c, tr));
    if (tr.type === 'video') {
      const sorted = [...tr.clips].sort((a, b) => a.start - b.start);
      for (let i = 0; i < sorted.length; i++) {
        const b = sorted[i], a = sorted[i - 1];
        if (b.transition && TRANS_IDS.includes(b.transition.type)) {
          const d = transDur(b), m = el('div', 'trans-mark' + (sel.type === 'clip' && sel.id === b.id && selTrans ? ' sel' : ''), d * pps > 22 ? I('blend', 12) : '');
          m.style.left = b.start * pps + 'px'; m.style.width = Math.max(14, d * pps) + 'px';
          m.title = `Transición: ${(TRANSITIONS.find((x) => x.id === b.transition.type) || {}).name} (${d.toFixed(1)} s) — clic para editar`;
          m.onmousedown = (e) => { e.stopPropagation(); selTrans = true; select('clip', b.id); setTimeout(() => $('#transSec')?.scrollIntoView({ block: 'nearest' }), 0); };
          row.append(m);
        } else if (a && Math.abs(a.start + a.duration - b.start) < 0.05 && !tr.locked) {
          const p = el('button', 'cut-add', I('plus', 12)); p.style.left = b.start * pps + 'px'; p.title = 'Añadir transición entre estos clips';
          p.onmousedown = (e) => e.stopPropagation();
          p.onclick = () => { mutate(() => { b.transition = { type: 'dissolve', duration: Math.min(1, b.duration, a.duration) }; sel = { type: 'clip', id: b.id }; }); selTrans = true; toast('Transición “Disolver” añadida. Cámbiala en Propiedades.'); };
          row.append(p);
        }
      }
    }
    row.addEventListener('mousedown', (e) => { if (e.target === row && e.button === 0) startMarquee(e); });
    row.addEventListener('contextmenu', (e) => { if (e.target !== row) return; e.preventDefault(); timelineMenu(e.clientX, e.clientY, tr, xToTime(e.clientX)); });
    row.addEventListener('dragover', (e) => { if (!dragMedia && !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); const ok = !dragMedia || (fits(kindOfName(dragMedia), tr.type) && !tr.locked); clearDropMarks(); row.classList.add(ok ? 'drop-ok' : 'drop-bad'); e.dataTransfer.dropEffect = ok ? 'copy' : 'none'; });
    row.addEventListener('dragleave', () => row.classList.remove('drop-ok', 'drop-bad'));
    row.addEventListener('drop', async (e) => {
      e.preventDefault(); e.stopPropagation(); clearDropMarks(); $('#dropOverlay').classList.add('hidden');
      const t = xToTime(e.clientX);
      if (e.dataTransfer.files.length) { const names = await uploadFiles(e.dataTransfer.files); setTimeout(() => { let s = t; for (const n of names) { addMediaAt(n, tr.id, s); s += mediaDuration(n); } }, 700); return; }
      const n = e.dataTransfer.getData('text/mojarra'); if (!n) return;
      if (!fits(kindOfName(n), tr.type)) return toast(`Un ${KIND[kindOfName(n)].label.toLowerCase()} no va en una pista de ${tr.type === 'text' ? 'texto' : tr.type}. Se colocó en una compatible.`), addMediaAt(n, null, snap(t).t);
      addMediaAt(n, tr.id, snap(t).t);
    });
    tracksEl.append(row);
  });
  if (!project.tracks.length) heads.append(el('div', 'hint', '&nbsp;Sin pistas. Pulsa “Pista”.'));
  renderSel(); updatePlayhead();
}
let selTrans = false;
function clearDropMarks() { $$('.drop-ok,.drop-bad').forEach((n) => n.classList.remove('drop-ok', 'drop-bad')); }
function clipEl(c, tr) {
  const kind = clipKind(c, tr);
  const d = el('div', 'clip ' + kind); d.dataset.id = c.id;
  d.style.left = c.start * pps + 'px'; d.style.width = Math.max(4, c.duration * pps) + 'px';
  const i = minfo(c.src);
  if (i.thumb && kind !== 'audio') d.style.backgroundImage = `url("${i.thumb}")`;
  d.title = `${kind === 'text' ? c.text : c.src}\n${fmt(c.start)} → ${fmt(c.start + c.duration)} (${c.duration.toFixed(2)} s)`;
  d.append(el('div', 'clabel', I(KIND[kind].icon, 12) + escHtml(kind === 'text' ? (c.text || '').replace(/\n/g, ' ') : c.src) + (c.volume != null && c.volume !== 1 ? ` · ${Math.round(c.volume * 100)}%` : '')));
  if (i.peaks && (kind === 'audio' || kind === 'video')) d.append(waveCanvas(c, i));
  if (kind !== 'audio') {
    if (c.fadeIn && !c.transition) { const f = el('div', 'fade in'); f.style.width = c.fadeIn * pps + 'px'; d.append(f); }
    if (c.fadeOut) { const f = el('div', 'fade out'); f.style.width = c.fadeOut * pps + 'px'; d.append(f); }
  }
  if (kind === 'audio' || (kind === 'video' && i.peaks)) d.append(volumeLine(c, tr, d));
  if ((c.effects || []).length) d.append(el('span', 'fx-ic', I('wand-sparkles', 12)));
  if (c.crop && (c.crop.l || c.crop.t || c.crop.r || c.crop.b)) d.append(el('span', 'crop-ic', I('crop', 12)));
  d.append(el('div', 'h l'), el('div', 'h r'));
  d.querySelector('.h.l').title = d.querySelector('.h.r').title = 'Arrastra para recortar';
  d.addEventListener('mousedown', (e) => startClipDrag(e, c, tr, d));
  d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!multi.has(c.id)) select('clip', c.id); popMenu(e.clientX, e.clientY, [
    { icon: 'scissors', label: 'Cortar en el cursor', fn: splitAtPlayhead },
    { icon: 'copy', label: multi.size > 1 ? `Duplicar ${multi.size} clips` : 'Duplicar', fn: duplicateSel },
    { icon: 'clipboard-copy', label: multi.size > 1 ? `Copiar ${multi.size} clips (Ctrl+C)` : 'Copiar (Ctrl+C)', fn: copySel },
    ...(clipboard ? [{ icon: 'clipboard-paste', label: `Pegar en el cursor (Ctrl+V)`, fn: pasteAtPlayhead }] : []),
    ...(tr.type === 'video' ? [{ icon: 'blend', label: c.transition ? 'Quitar transición' : 'Añadir transición', fn: () => toggleTransition(c) }] : []),
    ...(kind === 'video' || kind === 'audio' ? [{ icon: 'captions', label: 'Crear subtítulos desde la voz…', fn: () => voiceSubsDlg(c, tr) }] : []),
    { icon: 'trash-2', label: multi.size > 1 ? `Eliminar ${multi.size} clips` : 'Eliminar', danger: true, fn: deleteSel },
  ]); });
  return d;
}
// ================= Transcripción offline → subtítulos sincronizados por palabra =================
const LANGS = [['auto', 'Detectar automáticamente'], ['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['it', 'Italiano'], ['de', 'Alemán']];
let trWait = null;
function onTranscribeEvent(j) {
  let bar = $('#trStatus');
  if (j.running) {
    if (!bar) { bar = el('div', 'tr-status'); bar.id = 'trStatus'; document.body.append(bar); }
    bar.innerHTML = `<div class="tr-bar">${I('mic', 14)}<span>Transcribiendo <b>${escHtml(j.name)}</b>…</span><progress max="1" value="${j.progress || 0}"></progress><span>${Math.round((j.progress || 0) * 100)}%</span><button class="icon-btn" title="Cancelar">${I('x', 14)}</button></div>`;
    bar.querySelector('button').onclick = () => fetch('/api/transcribe', { method: 'DELETE' });
    return;
  }
  bar && bar.remove();
  if (trWait && trWait.name === j.name) { const w = trWait; trWait = null; j.error ? w.reject(new Error(j.error)) : w.resolve(); }
  else if (j.error) toast('Transcripción: ' + j.error, null, true);
  if (project) loadMedia();
}
async function getTranscript(name, { lang = 'auto', mode = 'local', model, force } = {}) {
  if (!force) { const r = await fetch('/api/transcript?name=' + encodeURIComponent(name)); if (r.ok) return r.json(); }
  const done = new Promise((resolve, reject) => (trWait = { name, resolve, reject }));
  const s = await fetch(`/api/transcribe?name=${encodeURIComponent(name)}&lang=${lang}&mode=${mode}${model ? '&model=' + model : ''}`, { method: 'POST' }).then((x) => x.json());
  if (s.error) { trWait = null; throw new Error(s.error); }
  await done;
  return fetch('/api/transcript?name=' + encodeURIComponent(name)).then((x) => x.json());
}
// Convierte la transcripción del tramo usado por el clip (in → in+duración) en subtítulos en el timeline
function buildVoiceSubs(c, tx, presetKey) {
  const a = c.in || 0, b = a + c.duration, style = { ...SUBS.PRESETS[presetKey].style, preset: presetKey, position: 'bottom' };
  if (!style.background) delete style.background;
  const ph = (tx.phrases || []).map((p) => ({ ...p, words: p.words.filter((w) => w.s >= a - 0.05 && w.s < b) })).filter((p) => p.words.length);
  const out = ph.map((p, i) => {
    const s0 = Math.max(a, p.words[0].s), next = ph[i + 1] ? Math.max(a, ph[i + 1].words[0].s) : b;
    let e = Math.min(b, Math.max(p.words[p.words.length - 1].e, s0 + 0.4));
    if (next - e < 0.45) e = next;                 // sin parpadeos entre frases seguidas
    e = Math.min(e, next);
    return { id: uid(), start: +(c.start + s0 - a).toFixed(3), duration: +Math.max(0.1, e - s0).toFixed(3), text: p.words.map((w) => w.t).join(' '),
      words: p.words.map((w) => ({ s: +Math.max(0, w.s - s0).toFixed(2), e: +Math.max(0, Math.min(e, w.e) - s0).toFixed(2) })), style: { ...style } };
  });
  return out;
}
// Diálogo único: transcribir un medio (y opcionalmente crear subtítulos para un clip). Local u online.
let whisperRefresh = null;
const fmtMB = (b) => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB';
async function voiceSubsDlg(c, tr, onlyTranscribe = false) {
  const name = c.src; if (!name || kindOfName(name) === 'image') return;
  const has = transcribed.has(name);
  let W = await fetch('/api/whisper').then((x) => x.json());
  let mode = W.models.some((m) => m.installed) || !W.online.some((o) => o.hasKey) ? 'local' : 'online';
  let model = W.localModel || (W.models.find((m) => m.installed) || {}).id, preset = 'impacto', redo = !has;
  modal(`<h2>${I(onlyTranscribe ? 'mic' : 'captions', 20)} ${onlyTranscribe ? 'Transcribir audio' : 'Subtítulos desde la voz'}</h2>
    <p class="dim">${onlyTranscribe ? 'La transcripción queda guardada en el proyecto: tú y Claude pueden usarla para editar por texto.' : 'Crea subtítulos sincronizados palabra por palabra con lo que se dice en'} <b>${escHtml(name)}</b>.</p>
    ${has ? `<label class="chk-line"><input type="checkbox" id="vsRedo"> Ya está transcrito (se reutiliza gratis). Volver a transcribir</label>` : ''}
    <div id="vsHow"></div>
    ${onlyTranscribe ? '' : `<label class="dim" style="display:block;margin:12px 0 4px">Diseño de los subtítulos</label><div class="sub-grid" id="vsGrid"></div>`}
    <div class="actions"><button class="btn" id="vsNo">Cancelar</button><button class="btn primary" id="vsOk">${I(onlyTranscribe ? 'mic' : 'captions', 15)} ${onlyTranscribe ? 'Transcribir' : 'Crear subtítulos'}</button></div>`, () => (whisperRefresh = null));
  const how = $('#vsHow'), ok = $('#vsOk');
  const paintHow = () => {
    if (!redo) { how.innerHTML = ''; ok.disabled = false; return; }
    const dlg = W.downloading;
    how.innerHTML = `<div class="mode-tabs" role="tablist">
        <button class="mode-tab ${mode === 'local' ? 'on' : ''}" data-m="local">${I('monitor', 16)}<b>En tu PC</b><span>Sin internet · gratis · privado</span></button>
        <button class="mode-tab ${mode === 'online' ? 'on' : ''}" data-m="online">${I('external-link', 16)}<b>Con internet</b><span>Más rápido · usa tu clave de API</span></button></div>
      <div class="field"><label for="vsLang">Idioma</label><select id="vsLang">${LANGS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>` +
      (mode === 'local' ? `<div class="model-list">${W.models.map((m) => `
        <div class="model-row ${m.installed ? 'inst' : ''} ${m.id === model ? 'on' : ''}" data-id="${m.id}">
          <div class="mi"><b>${m.name}${m.rec ? ' <span class="tag">Recomendado</span>' : ''}</b><span class="dim">${m.desc}</span></div>
          <span class="dim sz">${fmtMB(m.size)}</span>
          ${dlg && dlg.id === m.id ? `<div class="dlp"><progress max="1" value="${dlg.progress}"></progress><button class="icon-btn" data-cancel title="Cancelar descarga">${I('x', 14)}</button></div>`
            : m.installed ? `<span class="ok-tag">${I(m.id === model ? 'circle-check' : 'check', 14)} ${m.id === model ? 'En uso' : 'Descargado'}</span><button class="icon-btn" data-del="${m.id}" title="Borrar modelo">${I('trash-2', 14)}</button>`
            : `<button class="btn small" data-dl="${m.id}" ${dlg ? 'disabled' : ''}>${I('download', 13)} Descargar</button>`}
        </div>`).join('')}</div>
        <div class="hint">${W.engine ? '' : 'La primera descarga incluye también el motor de transcripción (≈ 9 MB). '}Los modelos se guardan en Documentos\\MojarraCut\\transcripcion y funcionan sin internet.</div>`
      : `<div class="field"><label for="vsProv">Servicio</label><select id="vsProv">${W.online.map((o) => `<option value="${o.id}" ${o.id === W.onlineProvider ? 'selected' : ''}>${o.name}</option>`).join('')}</select></div>
        <div class="field"><label for="vsKey">Clave de API</label><input type="password" id="vsKey" placeholder="${(W.online.find((o) => o.id === W.onlineProvider) || {}).hasKey ? '•••••• guardada (escribe para cambiarla)' : 'Pega aquí tu clave'}" autocomplete="off"></div>
        <div class="hint">El audio se envía al servicio elegido para transcribirlo y se cobra en tu cuenta de ese servicio. La clave se guarda solo en este equipo. <a href="${(W.online.find((o) => o.id === W.onlineProvider) || {}).keyUrl}" target="_blank">Obtener una clave</a></div>`);
    hydrateIcons(how);
    how.querySelectorAll('.mode-tab').forEach((b) => (b.onclick = () => { mode = b.dataset.m; paintHow(); }));
    how.querySelectorAll('.model-row.inst').forEach((r) => (r.onclick = (e) => { if (e.target.closest('button')) return; model = r.dataset.id; paintHow(); }));
    how.querySelectorAll('[data-dl]').forEach((b) => (b.onclick = () => { fetch('/api/whisper/download?id=' + b.dataset.dl, { method: 'POST' }); }));
    how.querySelectorAll('[data-cancel]').forEach((b) => (b.onclick = () => fetch('/api/whisper/download', { method: 'DELETE' })));
    how.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { W = await fetch('/api/whisper/models/' + b.dataset.del, { method: 'DELETE' }).then(() => fetch('/api/whisper')).then((x) => x.json()); if (model === b.dataset.del) model = W.localModel; paintHow(); }));
    const prov = $('#vsProv'); if (prov) prov.onchange = async () => { W = await fetch('/api/whisper/config', { method: 'PUT', body: JSON.stringify({ onlineProvider: prov.value }) }).then((x) => x.json()); paintHow(); };
    const key = $('#vsKey'); if (key) key.oninput = () => (ok.disabled = !key.value.trim() && !(W.online.find((o) => o.id === W.onlineProvider) || {}).hasKey);
    ok.disabled = mode === 'local' ? !(model && W.models.find((m) => m.id === model && m.installed)) : !(W.online.find((o) => o.id === W.onlineProvider) || {}).hasKey;
  };
  whisperRefresh = (st) => { const was = W.downloading; W = st; if (!model) model = (W.models.find((m) => m.installed) || {}).id; if (st.downloading && st.downloading.error) toast('Descarga: ' + st.downloading.error, null, true); else if (was && !st.downloading) toast('Modelo descargado: ya puedes transcribir sin internet'); const lang = $('#vsLang')?.value; paintHow(); if (lang && $('#vsLang')) $('#vsLang').value = lang; };
  const redoBox = $('#vsRedo'); if (redoBox) redoBox.onchange = () => { redo = redoBox.checked; paintHow(); };
  if (!onlyTranscribe) { const g = $('#vsGrid'); const paint = () => { g.innerHTML = ''; for (const [k, p] of Object.entries(SUBS.PRESETS)) { const b = presetCard(k, p, k === preset); b.onclick = () => { preset = k; paint(); }; g.append(b); } }; paint(); }
  paintHow();
  $('#vsNo').onclick = closeModal;
  ok.onclick = async () => {
    const lang = $('#vsLang')?.value || 'auto', key = $('#vsKey')?.value.trim();
    if (mode === 'online' && redo && key) await fetch('/api/whisper/config', { method: 'PUT', body: JSON.stringify({ provider: W.onlineProvider, key }) });
    closeModal();
    try {
      const tx = await getTranscript(name, { lang, mode, model, force: redo && has });
      transcribed.add(name);
      if (onlyTranscribe) return toast(`Transcripción de “${name}” lista: ${tx.phrases.length} frases`);
      const subs = buildVoiceSubs(c, tx, preset);
      if (!subs.length) return toast('No se detectó voz en ese tramo del clip');
      mutate(() => { const nt = { id: uid('t'), type: 'text', name: 'Subtítulos (voz)', clips: subs }; project.tracks.splice(0, 0, nt); sel = { type: 'clip', id: subs[0].id }; });
      toast(`${subs.length} subtítulos creados y sincronizados con la voz`, { label: 'Deshacer', fn: undo });
    } catch (e) { toast(e.message, null, true); }
  };
}
const transcribeMedia = (name) => voiceSubsDlg({ src: name }, null, true);
// Línea de volumen con dos puntos de fundido (inicio y final) dibujada sobre el clip
function volumeLine(c, tr, d) {
  const wrap = el('div', 'vol'), H = 48; // alto útil del clip
  const W = () => c.duration * pps;
  const yOf = (v) => 3 + (H - 6) * (1 - clamp(v, 0, 2) / 2);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('vol-svg');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline'); svg.append(poly);
  const hit = el('div', 'vol-hit'), h1 = el('div', 'vol-dot'), h2 = el('div', 'vol-dot'), tip = el('div', 'vol-tip');
  hit.title = 'Arrastra arriba/abajo para cambiar el volumen (doble clic = 100%)';
  h1.title = 'Arrastra para el fundido de entrada del audio'; h2.title = 'Arrastra para el fundido de salida del audio';
  wrap.append(svg, hit, h1, h2, tip);
  const draw = () => {
    const w = W(), y = yOf(c.volume ?? 1), fi = Math.min(aFadeIn(c), c.duration) * pps, fo = Math.min(aFadeOut(c), c.duration) * pps, b = H - 2;
    svg.setAttribute('width', w); svg.setAttribute('height', H);
    poly.setAttribute('points', `0,${fi ? b : y} ${fi},${y} ${w - fo},${y} ${w},${fo ? b : y}`);
    hit.style.top = y - 5 + 'px'; h1.style.left = fi + 'px'; h2.style.left = w - fo + 'px'; h1.style.top = h2.style.top = y + 'px';
  };
  draw();
  const drag = (mode) => (e) => {
    if (e.button !== 0) return; e.stopPropagation(); e.preventDefault();
    if (!multi.has(c.id)) select('clip', c.id);
    if (tr.locked) return toast('La pista está bloqueada');
    const before = JSON.stringify(project), x0 = e.clientX, y0 = e.clientY, o = { v: c.volume ?? 1, fi: aFadeIn(c), fo: aFadeOut(c) };
    wrap.classList.add('active');
    const mv = (ev) => {
      if (mode === 'v') { c.volume = +clamp(o.v - (ev.clientY - y0) / ((H - 6) / 2), 0, 2).toFixed(2); if (Math.abs(c.volume - 1) < 0.04) c.volume = 1; tip.textContent = Math.round(c.volume * 100) + '%'; }
      if (mode === 'in') { c.audioFadeIn = +clamp(o.fi + (ev.clientX - x0) / pps, 0, c.duration - aFadeOut(c)).toFixed(2); tip.textContent = 'Entrada ' + c.audioFadeIn.toFixed(1) + ' s'; }
      if (mode === 'out') { c.audioFadeOut = +clamp(o.fo - (ev.clientX - x0) / pps, 0, c.duration - aFadeIn(c)).toFixed(2); tip.textContent = 'Salida ' + c.audioFadeOut.toFixed(1) + ' s'; }
      tip.style.display = 'block'; draw(); if (!playing) syncMedia(time);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); wrap.classList.remove('active'); tip.style.display = ''; if (JSON.stringify(project) !== before) { undoStack.push(before); redoStack = []; scheduleSave(); refresh(); } };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  hit.addEventListener('pointerdown', drag('v')); h1.addEventListener('pointerdown', drag('in')); h2.addEventListener('pointerdown', drag('out'));
  [hit, h1, h2].forEach((x) => x.addEventListener('mousedown', (e) => e.stopPropagation()));
  hit.ondblclick = (e) => { e.stopPropagation(); mutate(() => (c.volume = 1)); };
  return wrap;
}
// Selección por recuadro (arrastrar en una zona vacía del timeline)
function startMarquee(e) {
  if (playing) pause();
  const add = e.ctrlKey || e.shiftKey || e.metaKey, base = add ? new Set(multi) : new Set();
  const cr = () => contentEl.getBoundingClientRect();
  const x0 = e.clientX - cr().left, y0 = e.clientY - cr().top; let box = null;
  const rowsTop = tracksEl.offsetTop, rowH = tracksEl.firstElementChild ? tracksEl.firstElementChild.offsetHeight : 58;
  const mv = (ev) => {
    const x1 = ev.clientX - cr().left, y1 = ev.clientY - cr().top;
    if (!box && Math.hypot(x1 - x0, y1 - y0) < 5) return;
    if (!box) { box = el('div', 'marquee'); contentEl.append(box); }
    const L = Math.min(x0, x1), R = Math.max(x0, x1), T = Math.min(y0, y1), B = Math.max(y0, y1);
    Object.assign(box.style, { left: L + 'px', top: T + 'px', width: R - L + 'px', height: B - T + 'px' });
    const t0 = L / pps, t1 = R / pps, r0 = Math.floor((T - rowsTop) / rowH), r1 = Math.floor((B - rowsTop) / rowH);
    const ids = new Set(base);
    project.tracks.forEach((tr, i) => { if (i < r0 || i > r1) return; for (const c of tr.clips) if (c.start < t1 && c.start + c.duration > t0) ids.add(c.id); });
    multi = ids; sel = ids.size ? { type: 'clip', id: [...ids][ids.size - 1] } : { type: null }; renderSel(); drawFrame();
  };
  const up = (ev) => {
    window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up);
    if (!box) { if (!add) select(null); seekFromEvent(ev, true); return; }
    box.remove(); renderInspector();
    if (multi.size > 1) toast(`${multi.size} clips seleccionados — arrástralos, cópialos (Ctrl+C) o elimínalos`);
  };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}
function waveCanvas(c, i) {
  const w = Math.min(4000, Math.max(4, Math.round(c.duration * pps))), cv = el('canvas'); cv.width = w; cv.height = 30;
  const g = cv.getContext('2d'); g.fillStyle = '#bbf7d0'; const rate = i.peaks.length / i.duration;
  for (let x = 0; x < w; x++) { const p = i.peaks[Math.floor((c.in + x / pps) * rate)] || 0, h = Math.max(1, Math.min(30, p * 30 * (c.volume ?? 1))); g.fillRect(x, 30 - h, 1, h); }
  return cv;
}
function renderSel() { updateToolbar(); renderScrubLanes(); $$('.track-head').forEach((n) => n.classList.toggle('sel', sel.type === 'track' && n.dataset.id === sel.id)); $$('.clip').forEach((n) => n.classList.toggle('sel', multi.has(n.dataset.id))); }
function renderRuler(width) {
  const r = $('#ruler'); r.innerHTML = '';
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]; const major = steps.find((s) => s * pps >= 80) || 600;
  const minor = major / (major >= 1 ? 5 : 2);
  for (let t = 0; t * pps < width; t += minor) {
    const isMaj = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    const k = el('div', 'tick' + (isMaj ? '' : ' minor'), isMaj ? fmt(t).replace(/\.00$/, '') : ''); k.style.left = t * pps + 'px'; r.append(k);
  }
}
function xToTime(clientX) { return Math.max(0, (clientX - contentEl.getBoundingClientRect().left) / pps); }
function updatePlayhead(follow) {
  $('#playhead').style.left = time * pps + 'px';
  $('#tcNow').textContent = fmt(time); $('#tcTotal').textContent = fmt(totalDur());
  if (follow) { const x = time * pps; if (x > scrollEl.scrollLeft + scrollEl.clientWidth - 60) scrollEl.scrollLeft = x - 100; }
  updateScrub();
}
function seekFromEvent(e, once) {
  if (playing) pause();
  const move = (ev) => setTime(snap(xToTime(ev.clientX), null, true).t);
  move(e); if (once) { $('#snapline').style.display = 'none'; return; }
  const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); $('#snapline').style.display = 'none'; };
  window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
}
$('#ruler').addEventListener('mousedown', seekFromEvent);
function snap(t, ignoreId, noPlayhead) {
  const line = $('#snapline');
  if (!$('#snapToggle').checked) { line.style.display = 'none'; return { t, hit: false }; }
  const pts = [0]; if (!noPlayhead) pts.push(time);
  for (const { c } of allClips()) if (c.id !== ignoreId) pts.push(c.start, c.start + c.duration);
  const thr = 8 / pps; let best = null;
  for (const p of pts) if (Math.abs(p - t) < thr && (best === null || Math.abs(p - t) < Math.abs(best - t))) best = p;
  if (best !== null) { line.style.left = best * pps + 'px'; line.style.display = 'block'; return { t: best, hit: true }; }
  line.style.display = 'none'; return { t, hit: false };
}
function startClipDrag(e, c, tr, d) {
  if (e.button !== 0) return; e.stopPropagation();
  selTrans = false;
  if (e.ctrlKey || e.shiftKey || e.metaKey) {                       // añadir / quitar de la selección
    const s = new Set(multi); s.has(c.id) ? s.delete(c.id) : s.add(c.id); selectClips([...s]); return;
  }
  if (!multi.has(c.id)) select('clip', c.id);
  else if (sel.id !== c.id) { sel = { type: 'clip', id: c.id }; renderInspector(); }
  if (tr.locked) return toast('La pista está bloqueada. Desbloquéala con el candado para editarla.');
  const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'move';
  if (mode === 'move' && multi.size > 1) return startGroupDrag(e);
  const x0 = e.clientX, o = { ...c }, before = JSON.stringify(project);
  const kind = clipKind(c, tr), srcDur = kind === 'video' || kind === 'audio' ? mediaDuration(c.src) : Infinity;
  let moved = false, curTrack = tr;
  const mv = (ev) => {
    const dt = (ev.clientX - x0) / pps; if (Math.abs(ev.clientX - x0) > 2) moved = true; if (!moved) return;
    if (mode === 'move') {
      let s = Math.max(0, o.start + dt);
      const a = snap(s, c.id), b = snap(s + c.duration, c.id);
      s = a.hit ? a.t : b.hit ? b.t - c.duration : s; snap(a.hit ? s : s + c.duration, c.id);
      c.start = Math.max(0, s);
      const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.track');
      const target = row && project.tracks.find((t) => t.id === row.dataset.id);
      if (target && target !== curTrack && fits(kind, target.type) && !target.locked) {
        curTrack.clips.splice(curTrack.clips.indexOf(c), 1); target.clips.push(c); curTrack = target; row.append(d);
      }
    } else if (mode === 'l') {
      let s = snap(o.start + dt, c.id).t; s = clamp(s, Math.max(0, o.start - (kind === 'video' || kind === 'audio' ? o.in || 0 : Infinity)), o.start + o.duration - 0.05);
      c.start = s; c.duration = o.duration - (s - o.start); if (kind === 'video' || kind === 'audio') c.in = (o.in || 0) + (s - o.start);
    } else {
      let e2 = snap(o.start + o.duration + dt, c.id).t; e2 = clamp(e2, o.start + 0.05, o.start + srcDur - (o.in || 0));
      c.duration = e2 - o.start;
    }
    d.style.left = c.start * pps + 'px'; d.style.width = c.duration * pps + 'px';
    if (!playing) setTime(time);
  };
  const up = () => {
    window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); $('#snapline').style.display = 'none';
    if (!moved) return;
    if (overlaps(curTrack, c.start, c.duration, c.id)) { toast('No se puede: se solaparía con otro clip. Suéltalo en un hueco o en otra pista.', null, true); project = JSON.parse(before); refresh(); return; }
    undoStack.push(before); redoStack = []; scheduleSave(); refresh();
  };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}
// ---- Menús contextuales (clic derecho) ----
function trackMenu(x, y, tr, nameInput) {
  const i = project.tracks.indexOf(tr);
  popMenu(x, y, [
    { icon: 'pencil', label: 'Renombrar', fn: () => { const n = $(`.track-head[data-id="${tr.id}"] .tname`); n && (n.focus(), n.select()); } },
    ...(tr.type !== 'audio' ? [{ icon: tr.hidden ? 'eye' : 'eye-off', label: tr.hidden ? 'Mostrar pista' : 'Ocultar pista', fn: () => mutate(() => (tr.hidden = !tr.hidden)) }] : []),
    ...(tr.type !== 'text' ? [{ icon: tr.muted ? 'volume-2' : 'volume-x', label: tr.muted ? 'Activar sonido' : 'Silenciar pista', fn: () => mutate(() => (tr.muted = !tr.muted)) }] : []),
    { icon: tr.locked ? 'lock-open' : 'lock', label: tr.locked ? 'Desbloquear pista' : 'Bloquear pista', fn: () => mutate(() => (tr.locked = !tr.locked)) },
    ...(tr.clips.length ? [{ icon: 'layers', label: `Seleccionar sus ${tr.clips.length} clip(s)`, fn: () => selectClips(tr.clips.map((c) => c.id)) }] : []),
    ...(clipboard ? [{ icon: 'clipboard-paste', label: `Pegar en el cursor (${fmt(time)})`, fn: pasteAtPlayhead }] : []),
    ...(i > 0 ? [{ icon: 'chevron-left', label: 'Subir pista', fn: () => mutate(() => project.tracks.splice(i - 1, 0, project.tracks.splice(i, 1)[0])) }] : []),
    ...(i < project.tracks.length - 1 ? [{ icon: 'chevron-right', label: 'Bajar pista', fn: () => mutate(() => project.tracks.splice(i + 1, 0, project.tracks.splice(i, 1)[0])) }] : []),
    { icon: 'copy', label: 'Duplicar pista', fn: () => mutate(() => { const n = JSON.parse(JSON.stringify(tr)); n.id = uid('t'); n.name += ' (copia)'; n.clips.forEach((c) => (c.id = uid())); project.tracks.splice(i, 0, n); sel = { type: 'track', id: n.id }; }) },
    { icon: 'plus', label: 'Añadir pista…', fn: addTrack },
    { icon: 'trash-2', label: 'Eliminar pista', danger: true, fn: () => deleteTrack(tr) },
  ]);
}
function timelineMenu(x, y, tr, t) {
  popMenu(x, y, [
    ...(clipboard ? [{ icon: 'clipboard-paste', label: `Pegar aquí (${fmt(t)})`, fn: () => { setTime(t); pasteAtPlayhead(); } }] : []),
    { icon: 'skip-forward', label: 'Mover el cursor aquí', fn: () => setTime(t) },
    ...(tr.type === 'text' ? [{ icon: 'type', label: 'Añadir subtítulo aquí', fn: () => { setTime(t); addText(); } }] : []),
    ...(tr.clips.length ? [{ icon: 'layers', label: 'Seleccionar todo en esta pista', fn: () => selectClips(tr.clips.map((c) => c.id)) }] : []),
    ...(allClips().length ? [{ icon: 'layers', label: 'Seleccionar todos los clips (Ctrl+A)', fn: () => selectClips(allClips().map(({ c }) => c.id)) }] : []),
    { icon: 'plus', label: 'Añadir pista…', fn: addTrack },
  ]);
}
// Mover varios clips a la vez (mismo desplazamiento en el tiempo)
function startGroupDrag(e) {
  const items = selectedClips().filter(({ t }) => !t.locked); if (!items.length) return;
  const before = JSON.stringify(project), x0 = e.clientX, o = new Map(items.map(({ c }) => [c.id, c.start]));
  const minStart = Math.min(...o.values()), ids = new Set(items.map(({ c }) => c.id)); let moved = false;
  const mv = (ev) => {
    let dt = (ev.clientX - x0) / pps; if (Math.abs(ev.clientX - x0) > 2) moved = true; if (!moved) return;
    dt = Math.max(dt, -minStart);
    const lead = items[0].c, sn = snap(o.get(lead.id) + dt, lead.id); if (sn.hit && !ids.has(sn.t)) dt = sn.t - o.get(lead.id);
    for (const { c } of items) { c.start = Math.max(0, o.get(c.id) + dt); const n = $(`.clip[data-id="${c.id}"]`); if (n) n.style.left = c.start * pps + 'px'; }
    if (!playing) setTime(time);
  };
  const up = () => {
    window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); $('#snapline').style.display = 'none';
    if (!moved) return;
    const bad = items.some(({ c, t }) => t.clips.some((x) => !ids.has(x.id) && c.start < x.start + x.duration - 1e-3 && c.start + c.duration > x.start + 1e-3));
    if (bad) { toast('No se puede: algún clip se solaparía con otro. Suéltalos en un hueco.', null, true); project = JSON.parse(before); refresh(); return; }
    undoStack.push(before); redoStack = []; scheduleSave(); refresh();
  };
  window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
}
// Reordenar pistas arrastrando
function startTrackDrag(e, tr, h) {
  e.preventDefault(); e.stopPropagation();
  const heads = $('#trackHeads'), rows = $$('.track-head', heads), from = project.tracks.indexOf(tr);
  const line = el('div', 'insert-line'), line2 = el('div', 'insert-line'); $('#tlHeaders').append(line); contentEl.append(line2);
  h.classList.add('dragging'); document.body.style.cursor = 'grabbing';
  let to = from;
  const mv = (ev) => {
    const top = heads.getBoundingClientRect().top, y = ev.clientY - top;
    to = clamp(Math.round(y / rows[0].offsetHeight), 0, rows.length);
    const off = heads.offsetTop + to * rows[0].offsetHeight - 1.5;
    line.style.top = off - $('#tlHeaders').scrollTop + 'px'; line2.style.top = 26 + to * rows[0].offsetHeight - 1.5 + 'px';
  };
  const up = () => {
    window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
    line.remove(); line2.remove(); h.classList.remove('dragging'); document.body.style.cursor = '';
    const dest = to > from ? to - 1 : to;
    if (dest !== from) mutate(() => project.tracks.splice(dest, 0, project.tracks.splice(from, 1)[0]));
  };
  mv(e); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
}

// ================= Acciones de edición =================
function splitAtPlayhead() {
  const s = selectedClips(), targets = s.length ? s : allClips();
  const hits = targets.filter(({ c, t }) => !t.locked && time > c.start + 0.02 && time < c.start + c.duration - 0.02);
  if (!hits.length) return toast('Coloca el cursor rojo sobre un clip para cortarlo');
  mutate(() => {
    for (const { c, t } of hits) {
      const k = clipKind(c, t), cut = time - c.start;
      const b = { ...JSON.parse(JSON.stringify(c)), id: uid(), start: time, duration: c.duration - cut };
      if (k === 'video' || k === 'audio') b.in = (c.in || 0) + cut;
      delete b.transition; b.fadeIn = 0; b.audioFadeIn = 0; c.fadeOut = 0; c.audioFadeOut = 0; c.duration = cut; t.clips.push(b);
    }
    const last = hits[hits.length - 1]; sel = { type: 'clip', id: last.t.clips[last.t.clips.length - 1].id }; multi = new Set([sel.id]);
  });
}
async function deleteSel() {
  if (sel.type === 'clip') {
    const items = selectedClips().filter(({ t }) => !t.locked); if (!items.length) return toast('La pista está bloqueada');
    mutate(() => { for (const { c, t } of items) t.clips.splice(t.clips.indexOf(c), 1); sel = { type: null }; multi.clear(); });
    toast(items.length > 1 ? `${items.length} clips eliminados` : 'Clip eliminado', { label: 'Deshacer', fn: undo });
  }
  else if (sel.type === 'track') deleteTrack(project.tracks.find((t) => t.id === sel.id));
  else if (sel.type === 'media') deleteMedia(sel.id);
}
async function deleteTrack(tr) {
  if (!tr) return;
  if (tr.clips.length && !(await confirmDlg({ title: `¿Eliminar la pista “${tr.name}”?`, text: `Se eliminarán también sus <b>${tr.clips.length} clip(s)</b>. Puedes deshacerlo con Ctrl+Z.`, ok: 'Eliminar pista', danger: true }))) return;
  mutate(() => { project.tracks.splice(project.tracks.indexOf(tr), 1); sel = { type: null }; });
  toast('Pista eliminada', { label: 'Deshacer', fn: undo });
}
const snapshotSel = () => { const items = selectedClips(); if (!items.length) return null; const t0 = Math.min(...items.map(({ c }) => c.start)), t1 = Math.max(...items.map(({ c }) => c.start + c.duration)); return { span: t1 - t0, items: items.map(({ c, t }) => ({ c: JSON.parse(JSON.stringify(c)), trackId: t.id, type: t.type, name: t.name, off: c.start - t0 })) }; };
function pasteClips(snapData, at) {
  const placed = [];
  mutate(() => {
    const free = snapData.items.every((it) => { const t = project.tracks.find((x) => x.id === it.trackId); return t && !t.locked && !overlaps(t, at + it.off, it.c.duration); });
    const newTracks = {};
    for (const it of snapData.items) {
      let t = project.tracks.find((x) => x.id === it.trackId);
      if (!free || !t) {
        t = newTracks[it.trackId] ||= (() => { const nt = { id: uid('t'), type: it.type, name: it.name + ' (copia)', clips: [] }; const i = project.tracks.findIndex((x) => x.id === it.trackId); project.tracks.splice(i < 0 ? 0 : i, 0, nt); return nt; })();
      }
      const n = { ...JSON.parse(JSON.stringify(it.c)), id: uid(), start: +(at + it.off).toFixed(3) }; t.clips.push(n); placed.push(n.id);
    }
    multi = new Set(placed); sel = { type: 'clip', id: placed[placed.length - 1] };
  });
  return placed.length;
}
function duplicateSel() {
  const s = snapshotSel(); if (!s) return toast('Selecciona uno o más clips para duplicarlos');
  const end = Math.min(...s.items.map((x) => x.c.start)) + s.span;
  const n = pasteClips(s, end); toast(n > 1 ? `${n} clips duplicados` : 'Clip duplicado');
}
function copySel() { const s = snapshotSel(); if (!s) return toast('Selecciona uno o más clips para copiarlos'); clipboard = s; updateToolbar(); toast(`${s.items.length} clip(s) copiado(s). Mueve el cursor y pulsa Ctrl+V para pegar.`); }
function pasteAtPlayhead() { if (!clipboard) return toast('No hay nada copiado (Ctrl+C sobre clips)'); const n = pasteClips(clipboard, time); toast(`${n} clip(s) pegado(s) en ${fmt(time)}`, { label: 'Deshacer', fn: undo }); }
function toggleTransition(c) {
  mutate(() => { if (c.transition) delete c.transition; else c.transition = { type: 'dissolve', duration: Math.min(1, c.duration) }; });
  selTrans = !!c.transition;
}
function addText(text = 'Escribe tu texto', start = time, duration = 3) {
  let tr = project.tracks.find((t) => t.type === 'text' && !t.locked && !overlaps(t, start, duration));
  mutate(() => {
    if (!tr) { tr = { id: uid('t'), type: 'text', name: 'Texto ' + (project.tracks.filter((t) => t.type === 'text').length + 1), clips: [] }; project.tracks.unshift(tr); }
    const c = { id: uid(), start, duration, text, style: { fontSize: 64, color: '#ffffff', position: 'bottom', bold: true, outline: 3 } };
    tr.clips.push(c); sel = { type: 'clip', id: c.id };
  });
  setTimeout(() => { const ta = $('#inspector textarea'); if (ta) { ta.focus(); ta.select(); } }, 0);
}
function addTrack() {
  modal(`<h2>${I('layers', 20)}Nueva pista</h2><p class="dim">Elige el tipo de pista</p>
    <div class="opt"><span data-i="film"></span><div class="grow"><div class="t">Video / Imagen</div><div class="s">Clips visuales. Las pistas de arriba se dibujan encima.</div></div><button class="btn" data-t="video" autofocus>Añadir</button></div>
    <div class="opt"><span data-i="music"></span><div class="grow"><div class="t">Audio</div><div class="s">Voz, música, efectos.</div></div><button class="btn" data-t="audio">Añadir</button></div>
    <div class="opt"><span data-i="captions"></span><div class="grow"><div class="t">Texto / Subtítulos</div><div class="s">Títulos y subtítulos.</div></div><button class="btn" data-t="text">Añadir</button></div>
    <div class="actions"><button class="btn ghost" id="atNo">Cancelar</button></div>`);
  $('#atNo').onclick = closeModal;
  $$('#modalCard [data-t]').forEach((b) => (b.onclick = () => {
    const type = b.dataset.t, n = project.tracks.filter((t) => t.type === type).length + 1;
    const tr = { id: uid('t'), type, name: { video: 'Video ', audio: 'Audio ', text: 'Texto ' }[type] + n, clips: [] };
    mutate(() => { if (type === 'audio') project.tracks.push(tr); else project.tracks.unshift(tr); sel = { type: 'track', id: tr.id }; }); closeModal();
  }));
}

// ================= Subtítulos SRT =================
const srtTime = (s) => { const m = s.trim().match(/(\d+):(\d+):(\d+)[,.](\d+)/); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0; };
const toSrtTime = (t) => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
function importSrt(txt) {
  const cues = txt.replace(/\r/g, '').split(/\n\n+/).map((b) => b.split('\n')).map((l) => { const i = l.findIndex((x) => x.includes('-->')); if (i < 0) return null; const [a, b] = l[i].split('-->'); return { s: srtTime(a), e: srtTime(b), text: l.slice(i + 1).join('\n').trim() }; }).filter((x) => x && x.text);
  if (!cues.length) return toast('Ese archivo .srt no contiene subtítulos válidos', null, true);
  mutate(() => {
    project.tracks.unshift({ id: uid('t'), type: 'text', name: 'Subtítulos SRT', clips: cues.map((q) => ({ id: uid(), start: q.s, duration: Math.max(0.1, q.e - q.s), text: q.text, style: { fontSize: 56, color: '#ffffff', position: 'bottom', bold: true, outline: 3, background: '#000000', backgroundOpacity: 0.55 } })) });
  });
  toast(`${cues.length} subtítulos importados`, { label: 'Deshacer', fn: undo });
}
function exportSrt() {
  const cues = project.tracks.filter((t) => t.type === 'text' && !t.hidden).flatMap((t) => t.clips).sort((a, b) => a.start - b.start);
  if (!cues.length) return toast('No hay subtítulos que exportar');
  download(new Blob([cues.map((c, i) => `${i + 1}\n${toSrtTime(c.start)} --> ${toSrtTime(c.start + c.duration)}\n${c.text}\n`).join('\n')], { type: 'text/plain' }), (project.name || 'subtitulos') + '.srt');
}
function download(blob, name) { const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
$('#srtInput').onchange = async (e) => { const f = e.target.files[0]; if (f) importSrt(await f.text()); e.target.value = ''; };

// ================= Propiedades =================
function renderInspector() {
  if (!project) return;
  const ins = $('#inspector'); const active = document.activeElement;
  if (active && ins.contains(active) && active.matches('input[type=number],input[type=text],textarea')) return;
  const scroll = ins.scrollTop; ins.innerHTML = '';
  if (sel.type === 'clip' && multi.size > 1) renderMultiProps(ins, selectedClips());
  else if (sel.type === 'clip' && selClip()) renderClipProps(ins, selClip());
  else if (sel.type === 'track' && project.tracks.find((t) => t.id === sel.id)) renderTrackProps(ins, project.tracks.find((t) => t.id === sel.id));
  else if (sel.type === 'media' && media.find((m) => m.name === sel.id)) renderMediaProps(ins, media.find((m) => m.name === sel.id));
  else { $('#propsKind').textContent = 'Proyecto'; renderProjectSettings(ins); }
  buildPropTabs(ins); hydrateIcons(ins); ins.scrollTop = scroll;
}
const CATS = { tiempo: ['Tiempo', 'clock'], texto: ['Texto', 'type'], diseno: ['Diseño', 'palette'], transicion: ['Transición', 'blend'], audio: ['Audio', 'volume-2'], efectos: ['Efectos', 'wand-sparkles'], recorte: ['Recorte', 'crop'], transform: ['Transformar', 'move'] };
// Galería de diseños de subtítulo + animación por palabra
function presetCard(key, p, active) {
  const s = p.style, b = el('button', 'sub-card' + (active ? ' on' : '')); b.type = 'button'; b.title = `Diseño “${p.name}”`;
  const words = (s.uppercase ? 'HOLA MUNDO' : 'Hola mundo').split(' ');
  const shadow = [s.outline ? `0 0 ${s.outline}px ${s.outlineColor}, 0 0 1px ${s.outlineColor}` : '', s.glow ? `0 0 ${s.glow / 2}px ${s.outlineColor}` : '', s.shadow ? `${s.shadow / 2}px ${s.shadow / 2}px 2px #0009` : ''].filter(Boolean).join(',') || 'none';
  const st = `font-family:'${s.font}',Arial;font-weight:${s.bold === false ? 400 : 700};color:${s.color};text-shadow:${shadow};${s.outline && !s.background ? `-webkit-text-stroke:${Math.min(1.5, s.outline / 3)}px ${s.outlineColor};paint-order:stroke fill;` : ''}`;
  const hlStyle = s.anim === 'marker' ? `background:${s.highlight};border-radius:4px;padding:0 3px` : s.anim === 'none' ? '' : `color:${s.highlight}`;
  const w2 = s.anim === 'reveal' ? `<span style="opacity:.25">${words[1]}</span>` : `<span style="${hlStyle}${s.anim === 'pop' ? ';display:inline-block;transform:scale(1.15)' : ''}">${words[1]}</span>`;
  b.innerHTML = `<span class="sub-prev" style="${s.background ? `background:${s.background}${Math.round((s.backgroundOpacity ?? 0.6) * 255).toString(16).padStart(2, '0')};` : ''}"><span style="${st}">${words[0]} ${w2}</span></span><span class="sub-name">${p.name}</span>`;
  return b;
}
function designSection(c, t) {
  const d = sec('Diseño y animación', 'palette', null, 'diseno'), s = c.style;
  const g = el('div', 'sub-grid');
  for (const [key, p] of Object.entries(SUBS.PRESETS)) {
    const b = presetCard(key, p, s.preset === key);
    b.onclick = () => mutate(() => { const keep = { position: s.position }; Object.assign(c.style, p.style, keep, { preset: key }); if (!p.style.background) delete c.style.background; });
    g.append(b);
  }
  d.append(g);
  d.append(selectField('Animación', s, 'anim', SUBS.ANIMS, 'none'));
  if ((s.anim || 'none') !== 'none') {
    if (s.anim !== 'reveal') d.append(colorField('Color resaltado', s, 'highlight', '#ffd400'));
    const n = SUBS.tokenize(c.text).flat().length, exact = Array.isArray(c.words) && c.words.length === n;
    d.append(el('div', 'hint', exact ? `${I('audio-waveform', 12)} Sincronizado con la voz (${n} palabras de la transcripción).`
      : `${I('clock', 12)} Tiempos por palabra <b>estimados</b> según la duración. Para sincronizar con la voz, usa <b>Transcribir</b> en el medio con audio.`));
    if (c.words && !exact) d.append(el('div', 'hint', 'El texto cambió y ya no coincide con la transcripción: se usan tiempos estimados.'));
  }
  const others = t.clips.filter((x) => x !== c);
  if (others.length) {
    const b = el('button', 'btn small', I('copy', 13) + ` Aplicar a los ${others.length} subtítulos de la pista`);
    b.onclick = () => mutate(() => { for (const o of others) o.style = { ...JSON.parse(JSON.stringify(s)), position: s.position }; toast('Diseño aplicado a toda la pista'); });
    d.append(b);
  }
  return d;
}
function sec(title, icon, id, cat) { const s = el('div', 'insp-sec'); if (id) s.id = id; if (cat) s.dataset.cat = cat; s.append(el('h3', '', (icon ? I(icon, 13) : '') + title)); return s; }
// Selector de categorías: muestra solo la sección elegida (o todas)
function buildPropTabs(ins) {
  const cats = [...new Set($$('.insp-sec[data-cat]', ins).map((s) => s.dataset.cat))];
  if (cats.length < 3) return;
  if (propsTab !== 'all' && !cats.includes(propsTab)) propsTab = 'all';
  const bar = el('div', 'prop-tabs'); bar.setAttribute('role', 'tablist');
  const mk = (id, label, icon) => {
    const b = el('button', 'ptab' + (propsTab === id ? ' on' : ''), (icon ? I(icon, 13) : '') + `<span>${label}</span>`);
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', propsTab === id); b.title = label; b.dataset.tab = id;
    b.onclick = () => { propsTab = id; renderInspector(); ins.scrollTop = 0; }; bar.append(b);
  };
  mk('all', 'Todo', 'layers'); for (const c of cats) mk(c, CATS[c][0], CATS[c][1]);
  const head = ins.querySelector('.insp-sec:not([data-cat])'); head ? head.after(bar) : ins.prepend(bar);
  if (propsTab !== 'all') $$('.insp-sec[data-cat]', ins).forEach((s) => s.classList.toggle('hidden', s.dataset.cat !== propsTab));
}
function effectsSection(clips) {
  const one = clips.length === 1 ? clips[0] : null;
  const s = sec('Efectos', 'wand-sparkles', 'fxSec', 'efectos');
  if (one) {
    const list = one.effects || [];
    if (!list.length) s.append(el('div', 'hint', 'Sin efectos. Añade uno para cambiar el aspecto del clip.'));
    list.forEach((fx, idx) => {
      const def = EFFECTS[fx.type]; if (!def) return;
      const row = el('div', 'fx-row' + (fx.enabled === false ? ' off' : ''));
      const head = el('div', 'fx-head', `${I(def.icon, 14)}<b>${def.name}</b>`);
      const sp = el('div', 'spacer'); head.append(sp);
      const tg = el('button', 'tbtn', I(fx.enabled === false ? 'eye-off' : 'eye', 14)); tg.title = fx.enabled === false ? 'Activar efecto' : 'Desactivar efecto';
      tg.onclick = () => mutate(() => (fx.enabled = fx.enabled === false));
      const rm = el('button', 'tbtn', I('x', 14)); rm.title = 'Quitar efecto'; rm.onclick = () => mutate(() => one.effects.splice(idx, 1));
      head.append(tg, rm); row.append(head);
      fx.amount ??= def.def;
      row.append(rangeField('Intensidad', fx, 'amount', def.min, def.max, def.step, def.def, def.show));
      s.append(row);
    });
  } else s.append(el('div', 'hint', `Se añadirá a los ${clips.length} clips visuales seleccionados.`));
  const add = el('button', 'btn small', I('plus') + 'Añadir efecto');
  add.onclick = (e) => { const r = add.getBoundingClientRect(); popMenu(r.left, r.bottom + 4, Object.entries(EFFECTS).map(([k, d]) => ({ icon: d.icon, label: d.name, fn: () => { mutate(() => { for (const c of clips) (c.effects ||= []).push({ type: k, amount: d.def }); }); propsTab = 'efectos'; renderInspector(); } }))); };
  const row = el('div', 'btn-row'); row.append(add);
  if (clips.some((c) => (c.effects || []).length)) { const clr = el('button', 'btn small', I('rotate-ccw') + 'Quitar todos'); clr.onclick = () => mutate(() => clips.forEach((c) => delete c.effects)); row.append(clr); }
  s.append(row); return s;
}
function renderMultiProps(ins, items) {
  $('#propsKind').textContent = `${items.length} clips`;
  const t0 = Math.min(...items.map(({ c }) => c.start)), t1 = Math.max(...items.map(({ c }) => c.start + c.duration));
  const head = el('div', 'insp-sec');
  head.append(el('div', 'insp-title', `${I('layers', 18)}${items.length} clips seleccionados`));
  const kinds = {}; items.forEach(({ c, t }) => { const k = clipKind(c, t); kinds[k] = (kinds[k] || 0) + 1; });
  head.append(el('div', 'kv', `<span>Tipos</span><span>${Object.entries(kinds).map(([k, n]) => `${n} ${KIND[k].label.toLowerCase()}`).join(', ')}</span><span>Desde</span><span>${fmt(t0)}</span><span>Hasta</span><span>${fmt(t1)}</span><span>Ocupan</span><span>${fmt(t1 - t0)}</span>`));
  ins.append(head);
  const tm = sec('Tiempo', 'clock', null, 'tiempo');
  const shift = { v: +t0.toFixed(2) };
  tm.append(numField('Mover a (s)', shift, 'v', { min: 0, step: 0.1, onSet: (v) => { const d = v - t0; const ids = new Set(items.map(({ c }) => c.id)); const bad = items.some(({ c, t }) => t.clips.some((x) => !ids.has(x.id) && c.start + d < x.start + x.duration - 1e-3 && c.start + d + c.duration > x.start + 1e-3)); if (bad) return toast('Se solaparía con otros clips', null, true), renderInspector(); mutate(() => items.forEach(({ c }) => (c.start = +(c.start + d).toFixed(3)))); } }));
  tm.append(el('div', 'hint', 'O arrastra cualquiera de los clips seleccionados en el timeline.'));
  ins.append(tm);
  const aud = items.filter(({ c, t }) => ['audio', 'video'].includes(clipKind(c, t)));
  if (aud.length) {
    const au = sec('Audio', 'volume-2', null, 'audio'); const v = { v: aud[0].c.volume ?? 1 };
    const f = rangeField('Volumen', v, 'v', 0, 2, 0.05, 1, (x) => Math.round(x * 100) + '%');
    const r = f.querySelector('input'); r.addEventListener('input', () => aud.forEach(({ c }) => (c.volume = +r.value))); r.addEventListener('change', () => refresh());
    au.append(f, el('div', 'hint', `Afecta a ${aud.length} clip(s) con audio.`)); ins.append(au);
  }
  const vis = items.filter(({ c, t }) => ['video', 'image'].includes(clipKind(c, t))).map(({ c }) => c);
  if (vis.length) ins.append(effectsSection(vis));
  const ac = sec('Acciones', 'wand-sparkles'), row = el('div', 'btn-row');
  for (const [ic, lb, fn, cls] of [['copy', 'Duplicar', duplicateSel], ['clipboard-copy', 'Copiar', copySel], ['scissors', 'Cortar en cursor', splitAtPlayhead], ['trash-2', 'Eliminar', deleteSel, 'danger']]) { const b = el('button', 'btn small ' + (cls || ''), I(ic) + lb); b.onclick = fn; row.append(b); }
  ac.append(row); ins.append(ac);
}
function renderClipProps(ins, { c, t }) {
  const kind = clipKind(c, t); $('#propsKind').textContent = 'Clip · ' + KIND[kind].label;
  const head = el('div', 'insp-sec');
  head.append(el('div', 'insp-title', `<span style="color:${KIND[kind].color}">${I(KIND[kind].icon, 18)}</span>${escHtml(kind === 'text' ? 'Texto' : c.src)}`));
  head.append(el('div', 'hint', `En la pista <b>${escHtml(t.name)}</b>${t.locked ? ' · ' + I('lock', 12) + ' bloqueada' : ''}`)); ins.append(head);
  if (kind === 'text') {
    const s = sec('Texto', 'type', null, 'texto');
    const ta = el('textarea'); ta.value = c.text || ''; ta.setAttribute('aria-label', 'Texto del subtítulo');
    let snapshot = null;
    ta.onfocus = () => (snapshot = JSON.stringify(project));
    ta.oninput = () => { c.text = ta.value; drawFrame(); const lb = $(`.clip[data-id="${c.id}"] .clabel`); if (lb) lb.lastChild.textContent = ta.value.replace(/\n/g, ' '); scheduleSave(); };
    ta.onblur = () => { if (snapshot && snapshot !== JSON.stringify(project)) { undoStack.push(snapshot); redoStack = []; } snapshot = null; };
    s.append(ta, el('div', 'hint', 'Usa Intro para un salto de línea.')); ins.append(s);
    c.style ||= {};
    ins.append(designSection(c, t));
    const st = sec('Estilo del texto', 'pencil', null, 'diseno');
    st.append(selectField('Fuente', c.style, 'font', SUBS.FONTS.map((f) => [f, f]), 'Arial'));
    st.append(numField('Tamaño', c.style, 'fontSize', { min: 8, max: 300, step: 2, def: 64 }));
    st.append(colorField('Color', c.style, 'color', '#ffffff'));
    st.append(selectField('Posición', c.style, 'position', [['bottom', 'Abajo'], ['center', 'Centro'], ['top', 'Arriba']], 'bottom'));
    st.append(checkField('Negrita', c.style, 'bold', true));
    st.append(checkField('MAYÚSCULAS', c.style, 'uppercase', false));
    st.append(numField('Contorno', c.style, 'outline', { min: 0, max: 12, step: 1, def: 3 }));
    st.append(colorField('Color contorno', c.style, 'outlineColor', '#000000'));
    st.append(numField('Sombra', c.style, 'shadow', { min: 0, max: 20, step: 1, def: 0 }));
    st.append(numField('Brillo neón', c.style, 'glow', { min: 0, max: 40, step: 1, def: 0 }));
    st.append(checkField('Fondo', { v: !!c.style.background }, 'v', false, (v) => mutate(() => { if (v) c.style.background = '#000000'; else delete c.style.background; })));
    if (c.style.background) { st.append(colorField('Color fondo', c.style, 'background', '#000000')); st.append(rangeField('Opac. fondo', c.style, 'backgroundOpacity', 0, 1, 0.05, 0.6, (v) => Math.round(v * 100) + '%')); }
    ins.append(st);
  }
  const tm = sec('Tiempo', 'clock', null, 'tiempo');
  tm.append(numField('Inicio (s)', c, 'start', { min: 0, step: 0.1, validate: (v) => !overlaps(t, v, c.duration, c.id) || 'Se solaparía con otro clip' }));
  tm.append(numField('Duración (s)', c, 'duration', { min: 0.05, step: 0.1, max: kind === 'video' || kind === 'audio' ? +(mediaDuration(c.src) - (c.in || 0)).toFixed(2) : undefined, validate: (v) => !overlaps(t, c.start, v, c.id) || 'Se solaparía con otro clip' }));
  if (kind === 'video' || kind === 'audio') tm.append(numField('Desde (s)', c, 'in', { min: 0, step: 0.1, def: 0, max: +(mediaDuration(c.src) - c.duration).toFixed(2) }));
  if (!c.transition && kind !== 'audio') tm.append(numField('Fundido imagen entrada', c, 'fadeIn', { min: 0, step: 0.1, def: 0, max: c.duration }));
  if (kind !== 'audio') tm.append(numField('Fundido imagen salida', c, 'fadeOut', { min: 0, step: 0.1, def: 0, max: c.duration }));
  ins.append(tm);
  if (t.type === 'video') {
    const ts = sec('Transición de entrada', 'blend', 'transSec', 'transicion');
    const grid = el('div', 'trans-grid');
    const none = el('button', 'trans-opt' + (c.transition ? '' : ' on'), `<span class="trans-prev" style="background:#3b82f6"></span>Ninguna`);
    none.onclick = () => mutate(() => delete c.transition); grid.append(none);
    for (const x of TRANSITIONS) {
      const b = el('button', 'trans-opt' + (c.transition?.type === x.id ? ' on' : ''), `<span class="trans-prev">${transPreview(x.id)}</span>${x.name}`);
      b.title = x.name; b.onclick = () => mutate(() => { c.transition = { type: x.id, duration: c.transition?.duration || Math.min(1, c.duration) }; }); grid.append(b);
    }
    ts.append(grid);
    if (c.transition) {
      ts.append(rangeField('Duración', c.transition, 'duration', 0.1, Math.max(0.2, Math.min(4, c.duration)), 0.05, 1, (v) => v.toFixed(2) + ' s'));
      const { prevOf } = linkTransitions(t);
      ts.append(el('div', 'hint', prevOf.has(c.id) ? 'Mezcla con el clip anterior de esta pista.' : `${I('info', 12)} No hay un clip pegado antes en esta pista: la transición se hará sobre lo que haya debajo.`));
    } else ts.append(el('div', 'hint', 'Elige cómo entra este clip. Si está pegado a otro clip, se mezclan.'));
    ins.append(ts);
  }
  if (kind === 'video' || kind === 'audio') {
    const au = sec('Audio', 'volume-2', null, 'audio');
    au.append(rangeField('Volumen', c, 'volume', 0, 2, 0.05, 1, (v) => Math.round(v * 100) + '%'));
    const af = { i: aFadeIn(c), o: aFadeOut(c) };
    au.append(numField('Fundido entrada', af, 'i', { min: 0, step: 0.1, max: +c.duration.toFixed(2), onSet: (v) => mutate(() => (c.audioFadeIn = v)) }));
    au.append(numField('Fundido salida', af, 'o', { min: 0, step: 0.1, max: +c.duration.toFixed(2), onSet: (v) => mutate(() => (c.audioFadeOut = v)) }));
    au.append(checkField('Silenciar', c, 'muted', false));
    au.append(el('div', 'hint', 'En el timeline: arrastra la línea del clip para el volumen y sus puntos para los fundidos.'));
    ins.append(au);
  }
  if (kind === 'video' || kind === 'image') ins.append(effectsSection([c]));
  if (kind === 'video' || kind === 'image') ins.append(cropSection(c));
  if (kind !== 'audio') {
    const tf = sec('Transformación', 'move', null, 'transform');
    if (kind !== 'text') tf.append(rangeField('Escala', c, 'scale', 0.1, 3, 0.01, 1, (v) => Math.round(v * 100) + '%'));
    tf.append(numField('Posición X', c, 'x', { step: 10, def: 0 }));
    tf.append(numField('Posición Y', c, 'y', { step: 10, def: 0 }));
    tf.append(rangeField('Opacidad', c, 'opacity', 0, 1, 0.01, 1, (v) => Math.round(v * 100) + '%'));
    tf.append(el('div', 'hint', 'También puedes arrastrar el clip en el visor (Mayús = centrar).'));
    const rs = el('button', 'btn small', I('rotate-ccw') + 'Restablecer'); rs.onclick = () => mutate(() => Object.assign(c, { scale: 1, x: 0, y: 0, opacity: 1 }));
    tf.append(rs); ins.append(tf);
  }
  const ac = sec('Acciones', 'wand-sparkles'); const row = el('div', 'btn-row');
  const b1 = el('button', 'btn small', I('scissors') + 'Cortar'); b1.onclick = splitAtPlayhead;
  const b2 = el('button', 'btn small', I('copy') + 'Duplicar'); b2.onclick = duplicateSel;
  const b3 = el('button', 'btn small danger', I('trash-2') + 'Eliminar'); b3.onclick = deleteSel;
  row.append(b1, b2, b3); ac.append(row); ins.append(ac);
}
function transPreview(id) {
  const m = { dissolve: 'opacity:.55', black: 'background:#000;opacity:.8', 'slide-left': 'left:50%', 'slide-right': 'right:50%', 'slide-up': 'top:50%', 'slide-down': 'bottom:50%', 'push-left': 'left:50%;box-shadow:-22px 0 0 #1e40af', 'push-right': 'right:50%;box-shadow:22px 0 0 #1e40af' };
  return `<i style="${m[id] || ''}"></i>`;
}
function cropSection(c) {
  const s = sec('Recorte', 'crop', null, 'recorte');
  const cr = { l: 0, t: 0, r: 0, b: 0, ...(c.crop || {}) };
  const i = minfo(c.src), box = el('div', 'crop-box');
  if (i.w && i.h) box.style.aspectRatio = `${i.w}/${i.h}`;
  if (i.thumb) box.style.backgroundImage = `url("${i.thumb}")`;
  const frame = el('div', 'frame'), shades = [0, 1, 2, 3].map(() => el('div', 'shade'));
  const hs = ['tl', 'tr', 'bl', 'br'].map((k) => { const h = el('div', 'hdl'); h.dataset.k = k; h.style.cursor = k === 'tl' || k === 'br' ? 'nwse-resize' : 'nesw-resize'; return h; });
  box.append(...shades, frame, ...hs);
  const lay = () => {
    const L = cr.l * 100, T = cr.t * 100, R = cr.r * 100, B = cr.b * 100;
    Object.assign(frame.style, { left: L + '%', top: T + '%', right: R + '%', bottom: B + '%' });
    Object.assign(shades[0].style, { left: 0, top: 0, right: 0, height: T + '%' }); Object.assign(shades[1].style, { left: 0, bottom: 0, right: 0, height: B + '%' });
    Object.assign(shades[2].style, { left: 0, top: T + '%', bottom: B + '%', width: L + '%' }); Object.assign(shades[3].style, { right: 0, top: T + '%', bottom: B + '%', width: R + '%' });
    hs[0].style.left = hs[2].style.left = L + '%'; hs[1].style.left = hs[3].style.left = 100 - R + '%';
    hs[0].style.top = hs[1].style.top = T + '%'; hs[2].style.top = hs[3].style.top = 100 - B + '%';
  };
  lay();
  const commit = () => { const v = { l: +cr.l.toFixed(4), t: +cr.t.toFixed(4), r: +cr.r.toFixed(4), b: +cr.b.toFixed(4) }; mutate(() => { if (v.l || v.t || v.r || v.b) c.crop = v; else delete c.crop; }); };
  const drag = (k) => (e) => {
    e.preventDefault(); const rect = box.getBoundingClientRect(), o = { ...cr }, x0 = e.clientX, y0 = e.clientY;
    const mv = (ev) => {
      const dx = (ev.clientX - x0) / rect.width, dy = (ev.clientY - y0) / rect.height, MIN = 0.05;
      if (k === 'move') { const w = 1 - o.l - o.r, h = 1 - o.t - o.b; cr.l = clamp(o.l + dx, 0, 1 - w); cr.r = 1 - w - cr.l; cr.t = clamp(o.t + dy, 0, 1 - h); cr.b = 1 - h - cr.t; }
      if (k.includes('l')) cr.l = clamp(o.l + dx, 0, 1 - cr.r - MIN);
      if (k.includes('r') && k !== 'move') cr.r = clamp(o.r - dx, 0, 1 - cr.l - MIN);
      if (k.includes('t')) cr.t = clamp(o.t + dy, 0, 1 - cr.b - MIN);
      if (k.includes('b')) cr.b = clamp(o.b - dy, 0, 1 - cr.t - MIN);
      lay(); c.crop = { ...cr }; drawFrame();
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); c.crop = JSON.parse(before).crop; commit(); };
    const before = JSON.stringify({ crop: c.crop ?? null }); window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  hs.forEach((h) => h.addEventListener('pointerdown', drag(h.dataset.k)));
  frame.addEventListener('pointerdown', drag('move'));
  s.append(box);
  const pct = (k, label) => { const f = numField(label + ' %', { v: Math.round(cr[k] * 100) }, 'v', { min: 0, max: 90, step: 1, onSet: (v) => { cr[k] = v / 100; if (1 - cr.l - cr.r < 0.05 || 1 - cr.t - cr.b < 0.05) return toast('El recorte dejaría la imagen vacía', null, true), renderInspector(); commit(); } }); return f; };
  s.append(pct('l', 'Izquierda'), pct('r', 'Derecha'), pct('t', 'Arriba'), pct('b', 'Abajo'));
  const rs = el('button', 'btn small', I('rotate-ccw') + 'Quitar recorte'); rs.disabled = !c.crop; rs.onclick = () => mutate(() => delete c.crop); s.append(rs);
  return s;
}
function renderTrackProps(ins, tr) {
  $('#propsKind').textContent = 'Pista';
  const h = el('div', 'insp-sec'); h.append(el('div', 'insp-title', `<span style="color:${TRACK_COLORS[tr.type]}">${I(TRACK_ICON[tr.type], 18)}</span>${escHtml(tr.name)}`)); ins.append(h);
  const s = sec('Pista', 'layers');
  const nm = el('input'); nm.type = 'text'; nm.value = tr.name; nm.onchange = () => mutate(() => (tr.name = nm.value || tr.name)); s.append(fieldWrap('Nombre', nm));
  const dur = tr.clips.reduce((a, c) => a + c.duration, 0);
  s.append(el('div', 'kv', `<span>Tipo</span><span>${{ video: 'Video / imagen', audio: 'Audio', text: 'Texto / subtítulos' }[tr.type]}</span><span>Clips</span><span>${tr.clips.length}</span><span>Contenido</span><span>${fmt(dur)}</span><span>Posición</span><span>${project.tracks.indexOf(tr) + 1} de ${project.tracks.length}</span>`));
  ins.append(s);
  const o = sec('Opciones', 'sliders-horizontal');
  if (tr.type !== 'audio') o.append(checkField('Oculta', tr, 'hidden', false));
  if (tr.type !== 'text') o.append(checkField('Silenciada', tr, 'muted', false));
  o.append(checkField('Bloqueada', tr, 'locked', false)); ins.append(o);
  const a = sec('Acciones', 'wand-sparkles'), row = el('div', 'btn-row');
  const del = el('button', 'btn small danger', I('trash-2') + 'Eliminar pista'); del.onclick = () => deleteTrack(tr);
  row.append(del); a.append(row, el('div', 'hint', 'Arrastra el asa ⋮⋮ de la cabecera para cambiar su orden. Las pistas de arriba se ven encima.')); ins.append(a);
}
function renderMediaProps(ins, m) {
  $('#propsKind').textContent = 'Medio · ' + KIND[m.kind].label;
  const i = minfo(m.name), n = usage(m.name);
  const h = el('div', 'insp-sec'); h.append(el('div', 'insp-title', `<span style="color:${KIND[m.kind].color}">${I(KIND[m.kind].icon, 18)}</span>${escHtml(m.name)}`));
  if (i.thumb) { const p = el('div', 'crop-box'); p.style.backgroundImage = `url("${i.thumb}")`; p.style.marginTop = '10px'; h.append(p); }
  ins.append(h);
  const s = sec('Información', 'info');
  s.append(el('div', 'kv', `<span>Tipo</span><span>${KIND[m.kind].label}</span>${m.kind !== 'image' ? `<span>Duración</span><span>${i.duration ? fmt(i.duration) : '—'}</span>` : ''}${i.w ? `<span>Resolución</span><span>${i.w}×${i.h}</span>` : ''}<span>Tamaño</span><span>${fmtSize(m.size)}</span><span>En uso</span><span>${n ? n + ' clip(s)' : 'No'}</span>`));
  ins.append(s);
  const a = sec('Acciones', 'wand-sparkles'), row = el('div', 'btn-row');
  const add = el('button', 'btn small', I('plus') + 'Añadir en el cursor'); add.onclick = () => addMediaAt(m.name, null, time);
  const fo = el('button', 'btn small', I('folder-open') + 'Ver carpeta'); fo.onclick = () => fetch('/api/open-folder?w=media', { method: 'POST' });
  const del = el('button', 'btn small danger', I('trash-2') + 'Quitar'); del.onclick = () => deleteMedia(m.name);
  row.append(add, fo, del); a.append(row); ins.append(a);
}
function renderProjectSettings(ins) {
  const s = sec('Proyecto', 'clapperboard');
  const res = { v: `${project.width}x${project.height}` };
  const presets = FORMATS.map((f) => [`${f.w}x${f.h}`, `${f.t} (${f.s})`]);
  s.append(selectField('Formato', res, 'v', presets.some((p) => p[0] === res.v) ? presets : [[res.v, res.v], ...presets], null, (v) => mutate(() => { const [w, h] = v.split('x').map(Number); project.width = w; project.height = h; })));
  s.append(selectField('FPS', project, 'fps', [[24, '24'], [25, '25'], [30, '30'], [60, '60']], 30, (v) => mutate(() => (project.fps = +v))));
  s.append(colorField('Fondo', project, 'background', '#000000'));
  ins.append(s);
  const st = sec('Resumen', 'info');
  st.append(el('div', 'kv', `<span>Duración</span><span>${fmt(totalDur())}</span><span>Clips</span><span>${allClips().length}</span><span>Pistas</span><span>${project.tracks.length}</span><span>Medios</span><span>${media.length}</span>`));
  ins.append(st);
  const h = sec('Trabajar con Claude', 'sparkles');
  h.append(el('div', 'hint', `Pídele a Claude: <i>“haz un video de 30 s con mis clips, música al 30 % y subtítulos”</i>. Claude edita el proyecto y lo verás aquí al instante.<br><br>¿No quedó como querías? Ajústalo tú o pulsa <kbd>Ctrl</kbd>+<kbd>Z</kbd> para deshacer el cambio de Claude.<br><br>Selecciona un clip, pista o medio para ver sus propiedades.`));
  ins.append(h);
}
function fieldWrap(label, input) { const f = el('div', 'field'); const l = el('label', '', label); const id = uid('f'); input.id = id; l.htmlFor = id; f.append(l, input); return f; }
function commitField(obj, key, val) { if (obj[key] === val) return; mutate(() => (obj[key] = val)); }
function numField(label, obj, key, { min, max, step = 1, def, validate, onSet } = {}) {
  const i = el('input'); i.type = 'number'; i.step = step; if (min != null) i.min = min; if (max != null) i.max = max;
  i.value = +(+(obj[key] ?? def ?? 0)).toFixed(3);
  i.onchange = () => {
    let v = parseFloat(i.value);
    if (isNaN(v)) { toast(`“${label}” necesita un número`, null, true); i.value = obj[key] ?? def ?? 0; return; }
    if (min != null && v < min) { v = min; toast(`${label}: el mínimo es ${min}`); }
    if (max != null && v > max) { v = max; toast(`${label}: el máximo es ${max}`); }
    const ok = validate ? validate(v) : true;
    if (ok !== true) { toast(ok, null, true); i.value = obj[key] ?? def ?? 0; return; }
    i.blur(); onSet ? onSet(v) : commitField(obj, key, v);
  };
  i.onkeydown = (e) => { if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = obj[key] ?? def ?? 0; i.blur(); } };
  return fieldWrap(label, i);
}
function rangeField(label, obj, key, min, max, step, def, show = (v) => v) {
  const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = obj[key] ?? def;
  const out = el('span', 'dim small-txt', show(+r.value)); out.style.minWidth = '44px';
  let snapshot = null;
  r.onpointerdown = r.onkeydown = () => { snapshot ||= JSON.stringify(project); };
  r.oninput = () => { snapshot ||= JSON.stringify(project); obj[key] = +r.value; out.textContent = show(+r.value); drawFrame(); if (!playing) syncMedia(time); };
  r.onchange = () => { if (snapshot) { undoStack.push(snapshot); redoStack = []; snapshot = null; } scheduleSave(); refreshTimeline(); $('#btnUndo').disabled = false; };
  r.ondblclick = () => { snapshot = JSON.stringify(project); obj[key] = def; r.value = def; r.onchange(); out.textContent = show(def); drawFrame(); };
  r.title = 'Doble clic para restablecer';
  const row = el('div', 'row'); row.append(r, out); const f = fieldWrap(label, row); r.id = f.querySelector('label').htmlFor; return f;
}
function colorField(label, obj, key, def) { const i = el('input'); i.type = 'color'; i.value = obj[key] || def; let old = obj[key]; i.oninput = () => { obj[key] = i.value; drawFrame(); }; i.onchange = () => { const v = i.value; obj[key] = old; old = v; commitField(obj, key, v); }; return fieldWrap(label, i); }
function selectField(label, obj, key, opts, def, onSet) {
  const s = el('select'); for (const [v, t] of opts) { const o = el('option', '', t); o.value = v; s.append(o); }
  s.value = obj[key] ?? def; s.onchange = () => (onSet ? onSet(s.value) : commitField(obj, key, s.value)); return fieldWrap(label, s);
}
function checkField(label, obj, key, def, onSet) { const i = el('input'); i.type = 'checkbox'; i.checked = obj[key] ?? def; i.onchange = () => (onSet ? onSet(i.checked) : commitField(obj, key, i.checked)); return fieldWrap(label, i); }

// ================= Exportar =================
let exporting = null;
function openExport() {
  if (!totalDur()) return toast('El timeline está vacío: añade clips antes de exportar');
  modal(`<h2>${I('download', 20)}Exportar video</h2><p class="dim">${project.width}×${project.height} · ${project.fps} fps · ${fmt(totalDur())}</p>
    <div class="opt">${I('file-video', 22)}<div class="grow"><div class="t">MP4 (H.264 + AAC) — recomendado</div><div class="s">Compatible con YouTube, TikTok, Instagram, WhatsApp, Premiere y DaVinci.</div></div><button class="btn primary" id="exMp4" ${ffmpegOk ? '' : 'disabled'} autofocus>Exportar</button></div>
    ${ffmpegOk ? '' : `<p class="hint">${I('triangle-alert', 12)} No se encontró el motor de exportación (ffmpeg). Reinstala MojarraCut.</p>`}
    <div class="opt">${I('film', 22)}<div class="grow"><div class="t">WebM (rápido, sin ffmpeg)</div><div class="s">Se graba en tiempo real desde el visor.</div></div><button class="btn" id="exWebm">Exportar</button></div>
    <div class="opt">${I('captions', 22)}<div class="grow"><div class="t">Subtítulos .srt</div><div class="s">Para subirlos aparte a YouTube.</div></div><button class="btn" id="exSrt">Descargar</button></div>
    <div id="exProg" class="hidden"><div class="bar"><div id="exBar"></div></div><p class="hint" id="exMsg"></p></div>
    <div class="actions"><button class="btn danger hidden" id="exCancel">${I('x')}Cancelar exportación</button><button class="btn ghost" id="exClose">Cerrar</button></div>`);
  $('#exClose').onclick = () => { if (exporting) return toast('Cancela la exportación antes de cerrar'); closeModal(); };
  $('#exSrt').onclick = exportSrt;
  $('#exWebm').onclick = startWebmExport;
  $('#exCancel').onclick = cancelExport;
  $('#exMp4').onclick = async () => {
    await flushSave();
    try { await api('/api/render', { method: 'POST' }); } catch { return; }
    exporting = { mp4: true }; $('#exCancel').classList.remove('hidden');
    $('#exProg').classList.remove('hidden'); $('#exMsg').textContent = 'Preparando…';
  };
}
function updateExportBar(p) { const b = $('#exBar'); if (b) b.style.width = Math.round(p * 100) + '%'; }
function onRenderEvent(r) {
  if (!$('#exProg')) return;
  $('#exProg').classList.remove('hidden'); updateExportBar(r.progress);
  if (r.running) { $('#exMsg').textContent = `Exportando MP4… ${Math.round(r.progress * 100)}% (puedes seguir editando, se usa lo guardado)`; return; }
  exporting = null; $('#exCancel')?.classList.add('hidden');
  if (r.output) { $('#exMsg').innerHTML = `${I('circle-check', 14)} <b>¡Listo!</b> ${escHtml(r.output)} · <a href="#" id="openEx" style="color:var(--accent2)">Abrir carpeta</a>`; $('#openEx').onclick = (e) => { e.preventDefault(); fetch('/api/open-folder?w=exports', { method: 'POST' }); }; toast('Video exportado'); }
  else if (r.error) $('#exMsg').innerHTML = `${I('circle-x', 14)} ${escHtml(r.error)}${r.cancelled ? '' : `<details><summary>Detalles técnicos</summary><code style="font-size:10px;white-space:pre-wrap;user-select:text">${escHtml((r.log || '').slice(-800))}</code></details>`}`;
}
function startWebmExport() {
  ensureAudio(); actx.resume();
  sel = { type: null }; renderSel();
  const stream = new MediaStream([...canvas.captureStream(project.fps).getVideoTracks(), ...recDest.stream.getAudioTracks()]);
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6 }); const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => { const c = exporting && exporting.cancelled; exporting = null; $('#exCancel')?.classList.add('hidden'); if (c) { $('#exMsg') && ($('#exMsg').textContent = 'Exportación cancelada.'); return; } download(new Blob(chunks, { type: 'video/webm' }), (project.name || 'video') + '.webm'); $('#exMsg') && ($('#exMsg').innerHTML = I('circle-check', 14) + ' Descargado'); };
  exporting = { rec }; $('#exProg').classList.remove('hidden'); $('#exCancel').classList.remove('hidden'); $('#exMsg').textContent = 'Grabando en tiempo real…';
  pause(); setTime(0); setTimeout(() => { rec.start(250); play(); }, 400);
}
function finishExport() { if (exporting && exporting.rec && exporting.rec.state !== 'inactive') setTimeout(() => exporting.rec.stop(), 200); }
function cancelExport() {
  if (!exporting) return;
  if (exporting.mp4) { fetch('/api/render', { method: 'DELETE' }); return; }
  exporting.cancelled = true; pause(); exporting.rec.stop();
}

// ================= Ayuda y atajos =================
function showHelp() {
  const k = [['Espacio', 'Reproducir / pausa'], ['S', 'Cortar en el cursor'], ['Supr', 'Eliminar la selección'], ['Arrastrar en vacío', 'Seleccionar varios clips con un recuadro'], ['Ctrl / Mayús + clic', 'Añadir o quitar de la selección'], ['Ctrl+A', 'Seleccionar todos los clips'], ['Ctrl+C / Ctrl+V', 'Copiar / pegar en el cursor'], ['Ctrl+X', 'Cortar (copiar y quitar)'], ['Ctrl+D', 'Duplicar'], ['T', 'Nuevo subtítulo'], ['Ctrl+Z / Ctrl+Y', 'Deshacer / rehacer'], ['Ctrl+S', 'Guardar ahora'], ['← / →', 'Mover 1 frame (Mayús: 1 s)'], ['Inicio / Fin', 'Ir al inicio / final'], ['+ / −', 'Zoom del timeline (o Ctrl+rueda)'], ['Esc', 'Quitar selección / cerrar diálogo'], ['?', 'Esta ayuda']];
  modal(`<h2>${I('keyboard', 20)}Ayuda rápida</h2>
    <div class="hint"><b>Editar:</b> arrastra un medio al timeline. Arrastra un clip para moverlo o sus bordes para recortarlo. Pasa el ratón entre dos clips pegados y pulsa <b>+</b> para añadir una transición.<br>
    <b>Paneles:</b> arrastra el título de un panel (asa ⋮⋮) sobre otro para intercambiarlos; arrastra las líneas divisorias para cambiar su tamaño.<br>
    <b>Pistas:</b> arrastra el asa ⋮⋮ de una pista para reordenarla.<br><b>Claude:</b> pídele cambios en el chat; puedes deshacerlos con Ctrl+Z.</div>
    <div class="keys">${k.map(([a, b]) => `<span class="kbd">${a}</span><span>${b}</span>`).join('')}</div><div class="actions"><button class="btn primary" id="hOk" autofocus>Entendido</button></div>`);
  $('#hOk').onclick = closeModal;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOpen()) { closeModal(); return; }
  if (modalOpen() || !project) return;
  if (e.target.matches('input,textarea,select')) { if (e.key === 'Escape') e.target.blur(); return; }
  const ctrl = e.ctrlKey || e.metaKey, fr = 1 / project.fps, k = e.key.toLowerCase();
  if (e.code === 'Space') { e.preventDefault(); play(); }
  else if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (ctrl && k === 'y') { e.preventDefault(); redo(); }
  else if (ctrl && k === 'd') { e.preventDefault(); duplicateSel(); }
  else if (ctrl && k === 's') { e.preventDefault(); flushSave(); toast('Guardado'); }
  else if (ctrl && k === 'c') { e.preventDefault(); copySel(); }
  else if (ctrl && k === 'v') { e.preventDefault(); pasteAtPlayhead(); }
  else if (ctrl && k === 'x') { e.preventDefault(); copySel(); deleteSel(); }
  else if (ctrl && k === 'a') { e.preventDefault(); selectClips(allClips().map(({ c }) => c.id)); }
  else if (ctrl) return;
  else if (k === 's') splitAtPlayhead();
  else if (k === 't') addText();
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSel();
  else if (e.key === 'ArrowLeft') { e.preventDefault(); setTime(time - (e.shiftKey ? 1 : fr)); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); setTime(time + (e.shiftKey ? 1 : fr)); }
  else if (e.key === 'Home') setTime(0);
  else if (e.key === 'End') setTime(totalDur());
  else if (e.key === '+' || e.key === '=') setZoom(pps * 1.25);
  else if (e.key === '-') setZoom(pps / 1.25);
  else if (e.key === 'Escape') { select(null); renderMediaList(); }
  else if (e.key === '?') showHelp();
});
function setZoom(v) {
  const anchor = time * pps - scrollEl.scrollLeft;
  pps = clamp(v, 5, 400); $('#zoom').value = pps; refreshTimeline(); scrollEl.scrollLeft = time * pps - anchor;
}
$('#zoom').oninput = (e) => setZoom(+e.target.value);
$('#zoomIn').onclick = () => setZoom(pps * 1.25); $('#zoomOut').onclick = () => setZoom(pps / 1.25);
scrollEl.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); } }, { passive: false });
scrollEl.addEventListener('scroll', () => { $('#tlHeaders').scrollTop = scrollEl.scrollTop; });

$('#btnPlay').onclick = play; $('#btnStart').onclick = () => setTime(0); $('#btnEnd').onclick = () => setTime(totalDur());
$('#btnPrev').onclick = () => setTime(time - 1 / project.fps); $('#btnNext').onclick = () => setTime(time + 1 / project.fps);
$('#btnUndo').onclick = undo; $('#btnRedo').onclick = redo; $('#btnSplit').onclick = splitAtPlayhead; $('#btnDelete').onclick = deleteSel;
$('#btnDup').onclick = duplicateSel; $('#btnAddText').onclick = () => addText(); $('#btnSrtOut').onclick = exportSrt; $('#btnAddTrack').onclick = addTrack;
$('#btnTrans').onclick = () => { const f = selClip(); if (f) { if (!f.c.transition) toggleTransition(f.c); selTrans = true; renderInspector(); setTimeout(() => $('#transSec')?.scrollIntoView({ block: 'nearest' }), 0); } };
$('#btnExport').onclick = openExport; $('#btnHelp').onclick = showHelp; $('#btnHome').onclick = showHome;
$('#projName').onchange = (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = project.name; return toast('El nombre no puede estar vacío'); } mutate(() => (project.name = v)); document.title = `${v} — MojarraCut`; };
$('#projName').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };

let dragDepth = 0;
window.addEventListener('dragenter', (e) => { if (project && e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropOverlay').classList.remove('hidden'); } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').classList.add('hidden'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#dropOverlay').classList.add('hidden'); if (project && e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files); });
window.addEventListener('resize', () => { if (project) { fitStage(); refreshTimeline(); } });
window.addEventListener('beforeunload', () => { if (project) navigator.sendBeacon && flushSave(); });

// ================= Conexión en vivo (Claude) =================
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', (e) => { const d = JSON.parse(e.data); ffmpegOk = d.ffmpeg; dataDir = d.dir; const c = $('#claudeState'); c.classList.remove('off'); c.lastChild.textContent = 'Claude conectado'; });
  es.addEventListener('project', async () => {
    if (!project) return;
    const prev = JSON.stringify(project);
    await loadProject();
    if (JSON.stringify(project) === prev) return;
    undoStack.push(prev); redoStack = []; fixSel();
    await loadMedia(); refresh();
    toast('Claude actualizó el proyecto', { label: 'Deshacer', fn: undo });
  });
  es.addEventListener('projects', () => { if (!project && !$('#home').classList.contains('hidden')) loadHome(); });
  es.addEventListener('media', () => project && loadMedia());
  es.addEventListener('render', (e) => onRenderEvent(JSON.parse(e.data)));
  es.addEventListener('transcribe', (e) => onTranscribeEvent(JSON.parse(e.data)));
  es.addEventListener('claude', (e) => onChatEvent(JSON.parse(e.data)));
  es.addEventListener('whisper', (e) => whisperRefresh && whisperRefresh(JSON.parse(e.data)));
  es.onerror = () => { const c = $('#claudeState'); c.classList.add('off'); c.lastChild.textContent = 'Desconectado'; };
}

// ================= Línea de tiempo del visor (sincronizada con la del editor) =================
const scrub = $('#scrub');
const scrubDur = () => Math.max(totalDur(), (scrollEl.scrollLeft + scrollEl.clientWidth) / pps, 1);
function renderScrubLanes() {
  if (!project) return;
  const lanes = $('#scrubLanes'); lanes.innerHTML = ''; const D = scrubDur();
  const groups = ['text', 'video', 'audio'].map((type) => project.tracks.filter((t) => t.type === type && !(t.hidden && type !== 'audio')));
  groups.forEach((tracks, gi) => {
    const lane = el('div', 'scrub-lane');
    for (const t of tracks) for (const c of t.clips) {
      const b = el('div', 'scrub-clip' + (multi.has(c.id) ? ' sel' : '')); b.style.left = (c.start / D) * 100 + '%'; b.style.width = Math.max(0.3, (c.duration / D) * 100) + '%';
      b.style.background = gi === 0 ? 'var(--text-c)' : gi === 2 ? 'var(--audio)' : clipKind(c, t) === 'image' ? 'var(--image)' : 'var(--video)'; lane.append(b);
    }
    lanes.append(lane);
  });
}
function updateScrub() {
  if (!project) return;
  const D = scrubDur();
  $('#scrubHead').style.left = (time / D) * 100 + '%';
  const v = $('#scrubView'); v.style.left = (scrollEl.scrollLeft / pps / D) * 100 + '%'; v.style.width = Math.min(100, (scrollEl.clientWidth / pps / D) * 100) + '%';
}
scrub.addEventListener('pointerdown', (e) => {
  if (!project || e.button !== 0) return; e.preventDefault(); scrub.setPointerCapture(e.pointerId);
  const r = scrub.getBoundingClientRect(), D = scrubDur(), onView = e.target.id === 'scrubView';
  const x0 = e.clientX, s0 = scrollEl.scrollLeft;
  if (playing && !onView) pause();
  const mv = (ev) => {
    if (onView) { scrollEl.scrollLeft = s0 + ((ev.clientX - x0) / r.width) * D * pps; updateScrub(); }
    else setTime(clamp((ev.clientX - r.left) / r.width, 0, 1) * D);
  };
  if (!onView) mv(e);
  const up = () => { scrub.removeEventListener('pointermove', mv); scrub.removeEventListener('pointerup', up); };
  scrub.addEventListener('pointermove', mv); scrub.addEventListener('pointerup', up);
});
scrollEl.addEventListener('scroll', updateScrub);
const _refreshTimeline = refreshTimeline;
refreshTimeline = function () { _refreshTimeline(); renderScrubLanes(); updateScrub(); };
$('#btnCopy').onclick = copySel; $('#btnPaste').onclick = pasteAtPlayhead; $('#btnNewFolder').onclick = newFolder;

// Exponer para pruebas automáticas
window.MC = { get project() { return project; }, get sel() { return sel; }, get multi() { return multi; }, get clipboard() { return clipboard; }, selectClips, copySel, pasteAtPlayhead, duplicateSel, newFolder, moveMedia, get curFolder() { return curFolder; }, set curFolder(v) { curFolder = v; }, get time() { return time; }, get layout() { return layout; }, get undoDepth() { return undoStack.length; }, openProject, showHome, addMediaAt, addText, splitAtPlayhead, deleteSel, undo, redo, select, setTime, mutate, resetLayout, applyLayout, linkTransitions, drawFrame, visualRects };

(async function init() {
  if (/Electron/.test(navigator.userAgent)) document.body.classList.add('desktop');
  hydrateIcons(); setPlayBtn(); connect();
  await showHome();
  const testing = new URLSearchParams(location.search).has('test');
  if (testing) { const s = document.createElement('script'); s.src = 'tests/nielsen.js'; document.body.append(s); }
  else try { const w = await api('/api/welcome'); if (w.show) showWelcome(w.version); } catch {}
})();

// ================= Bienvenida animada (primera apertura y después de cada actualización) =================
function showWelcome(version) {
  const ov = el('div', 'welcome');
  const fish = `<svg viewBox="0 0 256 256" class="w-fish"><rect x="8" y="8" width="240" height="240" rx="28" fill="#7c6cff"/><ellipse cx="118" cy="128" rx="62" ry="40" fill="#fff"/><path class="w-tail" d="M172 128 L214 86 L214 170 Z" fill="#fff"/><circle cx="92" cy="120" r="8" fill="#241a4a"/></svg>`;
  const feats = [
    ['captions', 'Subtítulos que siguen la voz', 'Transcribe en tu PC o con internet y elige un diseño animado: karaoke, pop, marcador…'],
    ['sparkles', 'Claude edita por ti', 'Pídele un video y lo verás armarse en la línea de tiempo. Corrige lo que quieras a mano.'],
    ['film', 'Edición completa', 'Transiciones, efectos, recorte y exportación a MP4 en tu propia computadora.'],
  ];
  const title = 'MojarraCut'.split('').map((ch, i) => `<span style="animation-delay:${0.35 + i * 0.05}s">${ch}</span>`).join('');
  ov.innerHTML = `<div class="w-bubbles">${Array.from({ length: 22 }, (_, i) => `<i style="left:${(i * 37) % 100}%;width:${4 + (i * 7) % 12}px;height:${4 + (i * 7) % 12}px;animation-delay:${(i * 0.43) % 6}s;animation-duration:${6 + (i % 5)}s"></i>`).join('')}</div>
    <div class="w-card">
      ${fish}
      <h1 class="w-title">${title}</h1>
      <p class="w-sub">Versión ${escHtml(version)}</p>
      <div class="w-feats">${feats.map(([ic, t, d], i) => `<div class="w-feat" style="animation-delay:${1 + i * 0.15}s">${I(ic, 22)}<b>${t}</b><span>${d}</span></div>`).join('')}</div>
      <button class="btn primary w-go">Empezar ${I('chevron-right', 16)}</button>
    </div>`;
  document.body.append(ov);
  const close = () => { ov.classList.add('out'); fetch('/api/welcome', { method: 'POST' }); setTimeout(() => ov.remove(), 450); document.removeEventListener('keydown', esc, true); };
  const esc = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.stopPropagation(); close(); } };
  ov.querySelector('.w-go').onclick = close; document.addEventListener('keydown', esc, true);
  setTimeout(() => ov.querySelector('.w-go').focus(), 1500);
}

// ================= Chat con Claude integrado (panel derecho) =================
// Usa Claude Code instalado en el equipo (modo headless). Cada proyecto recuerda su conversación.
const CC_MODELS = [['', 'Modelo predeterminado'], ['fable', 'Fable (el más capaz)'], ['opus', 'Opus'], ['sonnet', 'Sonnet (equilibrado)'], ['haiku', 'Haiku (rápido y barato)']];
const CC_EFFORTS = [['', 'Esfuerzo auto'], ['low', 'Esfuerzo bajo'], ['medium', 'Esfuerzo medio'], ['high', 'Esfuerzo alto'], ['xhigh', 'Esfuerzo muy alto'], ['max', 'Esfuerzo máximo']];
const ccStore = { get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
let cc = { busy: false, session: null, log: [], imgs: [], bot: null, typing: null };
function applyChatLayout() {
  const row = $('.work-row'); row.classList.toggle('no-claude', layout.claude === false);
  row.style.setProperty('--cw', (layout.cw || 360) + 'px');
}
function toggleChat(show) {
  layout.claude = show === undefined ? layout.claude === false : show; applyLayout();
  if (layout.claude !== false) setTimeout(() => $('#ccText').focus(), 50);
}
$('#ccHide').onclick = () => toggleChat(false);
$('#claudeSplit').addEventListener('pointerdown', (e) => {
  e.preventDefault(); const sp = e.currentTarget; sp.setPointerCapture(e.pointerId); sp.classList.add('active');
  const x0 = e.clientX, w0 = layout.cw || 360;
  const mv = (ev) => { layout.cw = clamp(w0 - (ev.clientX - x0), 260, Math.max(300, innerWidth - 700)); applyChatLayout(); fitStage(); };
  const up = () => { sp.classList.remove('active'); sp.removeEventListener('pointermove', mv); sp.removeEventListener('pointerup', up); applyLayout(); };
  sp.addEventListener('pointermove', mv); sp.addEventListener('pointerup', up);
});
for (const [id, list, key] of [['#ccModel', CC_MODELS, 'mc-cc-model'], ['#ccEffort', CC_EFFORTS, 'mc-cc-effort']]) {
  const sel = $(id); sel.innerHTML = list.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
  sel.value = ccStore.get(key, ''); sel.onchange = () => ccStore.set(key, sel.value);
}
const ccKey = () => 'mc-cc-' + projectId;
let ccSaveT = null;
function ccSave() { // se guarda en proyectos/<id>/chat.json (viaja con el proyecto)
  const id = projectId; if (!id) return; clearTimeout(ccSaveT);
  ccSaveT = setTimeout(() => fetch('/api/claude/history?id=' + encodeURIComponent(id), { method: 'PUT', body: JSON.stringify({ session: cc.session, log: cc.log.slice(-200).map(({ node, ...e }) => e) }) }).catch(() => {}), 400);
}
async function chatLoad() {
  let d = {}; try { d = await (await fetch('/api/claude/history?id=' + encodeURIComponent(projectId))).json(); } catch {}
  let migrated = false; // trae el historial que versiones anteriores guardaban en el navegador
  if (!d.log) { const old = ccStore.get(ccKey(), null); if (old && old.log) { d = old; migrated = true; try { localStorage.removeItem(ccKey()); } catch {} } }
  cc.session = d.session || null; cc.log = d.log || []; cc.imgs = []; renderThumbs(); renderChat(); if (migrated) ccSave();
}
function mdLite(t) { return escHtml(t).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>'); }
function ccEntry(e) {
  if (e.r === 'user') { const d = el('div', 'cc-msg user'); d.innerHTML = (e.imgs || []).map((s) => `<img src="${s}" alt="">`).join('') + escHtml(e.t); return d; }
  if (e.r === 'bot') { const d = el('div', 'cc-msg bot'); d.innerHTML = mdLite(e.t); return d; }
  if (e.r === 'tool') { const d = el('div', 'cc-tool'); d.innerHTML = I('wand-sparkles', 13) + escHtml(e.t); return d; }
  if (e.r === 'err') { const d = el('div', 'cc-msg err'); d.textContent = e.t; return d; }
  const d = el('div', 'cc-meta'); d.textContent = e.t; return d;
}
function renderChat() {
  const log = $('#ccLog'); log.replaceChildren();
  if (!cc.log.length) {
    log.innerHTML = `<div class="cc-empty">${I('sparkles', 26)}<p><b>Pídele a Claude que edite tu video.</b><br>Verás los cambios en la línea de tiempo al instante y puedes deshacerlos con Ctrl+Z.</p><div class="chips">${['Corta las pausas largas', 'Pon subtítulos estilo karaoke', 'Agrega transiciones suaves entre clips', 'Exporta el video en MP4'].map((t) => `<button class="chip">${t}</button>`).join('')}</div></div>`;
    log.querySelectorAll('.cc-empty .chip').forEach((b) => (b.onclick = () => { $('#ccText').value = b.textContent; $('#ccText').focus(); }));
  } else cc.log.forEach((e) => log.append(ccEntry(e)));
  if (cc.busy) showTyping();
  log.scrollTop = log.scrollHeight;
}
function ccPush(e) {
  const log = $('#ccLog'); if (log.querySelector('.cc-empty')) log.replaceChildren();
  cc.log.push(e); const n = ccEntry(e); log.insertBefore(n, cc.typing && cc.typing.isConnected ? cc.typing : null); log.scrollTop = log.scrollHeight; ccSave(); return n;
}
function showTyping() { if (!cc.typing) cc.typing = el('div', 'cc-typing', '<i></i><i></i><i></i>'); $('#ccLog').append(cc.typing); }
function setBusy(b) {
  cc.busy = b; const s = $('#ccSend'); s.innerHTML = b ? I('square', 14) + 'Detener' : I('send', 14) + 'Enviar'; s.classList.toggle('cc-go', !b);
  if (b) showTyping(); else { cc.typing && cc.typing.remove(); cc.bot = null; }
}
// Imágenes adjuntas: botón, pegar (Ctrl+V) y arrastrar
function addImageFile(f) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) return toast('Solo imágenes PNG, JPG, GIF o WebP');
  if (cc.imgs.length >= 8) return toast('Máximo 8 imágenes por mensaje');
  const img = new Image(), url = URL.createObjectURL(f);
  img.onload = () => { // se reduce a 1568 px como máximo (lo que Claude aprovecha) para que pese menos
    const k = Math.min(1, 1568 / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); cc.imgs.push(c.toDataURL(f.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88)); renderThumbs();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('No se pudo leer la imagen'); }; img.src = url;
}
function renderThumbs() {
  $('#ccThumbs').innerHTML = cc.imgs.map((s, i) => `<div class="cc-thumb"><img src="${s}" alt=""><button data-i2="${i}" title="Quitar" aria-label="Quitar imagen">×</button></div>`).join('');
  $('#ccThumbs').querySelectorAll('button').forEach((b) => (b.onclick = () => { cc.imgs.splice(+b.dataset.i2, 1); renderThumbs(); }));
}
$('#ccFile').onchange = (e) => { [...e.target.files].forEach(addImageFile); e.target.value = ''; };
$('#ccText').addEventListener('paste', (e) => { const fl = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (fl.length) { e.preventDefault(); fl.forEach(addImageFile); } });
const ccIn = $('#ccInput');
ccIn.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.stopPropagation(); ccIn.classList.add('drop'); } });
ccIn.addEventListener('dragleave', () => ccIn.classList.remove('drop'));
ccIn.addEventListener('drop', (e) => { ccIn.classList.remove('drop'); const fl = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/')); if (fl.length) { e.preventDefault(); e.stopPropagation(); fl.forEach(addImageFile); } });
$('#ccText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$('#ccSend').onclick = () => (cc.busy ? fetch('/api/claude/chat', { method: 'DELETE' }) : sendChat());
$('#ccNew').onclick = () => { if (cc.busy) return toast('Espera a que Claude termine o detenlo'); cc.session = null; cc.log = []; ccSave(); renderChat(); toast('Conversación nueva'); };
async function sendChat() {
  const ta = $('#ccText'), text = ta.value.trim(); if ((!text && !cc.imgs.length) || cc.busy) return;
  try { flushSave(); } catch {}
  const imgs = cc.imgs; ccPush({ r: 'user', t: text, imgs }); ta.value = ''; cc.imgs = []; renderThumbs(); setBusy(true);
  let r; try { r = await (await fetch('/api/claude/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, images: imgs, model: $('#ccModel').value, effort: $('#ccEffort').value, session: cc.session }) })).json(); } catch { r = { ok: false, error: 'No hay conexión con MojarraCut' }; }
  if (!r.ok) { setBusy(false); ccPush({ r: 'err', t: r.found === false ? 'No encontré Claude Code en este equipo. Instala la app de Claude (claude.com/download) y vuelve a intentarlo.' : r.error || 'No se pudo enviar' }); if (r.found === false) openClaude(); }
}
function onChatEvent(d) {
  if (d.k === 'start') { if (!cc.busy) setBusy(true); }
  else if (d.k === 'session') { cc.session = d.session; ccSave(); }
  else if (d.k === 'msg') cc.bot = null;
  else if (d.k === 'text') {
    if (!cc.bot) { cc.bot = { r: 'bot', t: '' }; cc.bot.node = ccPush(cc.bot); }
    cc.bot.t += d.t; cc.bot.node.innerHTML = mdLite(cc.bot.t); const log = $('#ccLog'); log.scrollTop = log.scrollHeight;
  }
  else if (d.k === 'tool') { cc.bot = null; ccPush({ r: 'tool', t: d.d }); }
  else if (d.k === 'done') { if (d.session) cc.session = d.session; if (d.error) ccPush({ r: 'err', t: d.error }); setBusy(false); ccSave(); }
}
fetch('/api/claude/chat').then((r) => r.json()).then((s) => { if (s.busy) setBusy(true); }).catch(() => {});
