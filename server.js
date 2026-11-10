// MojarraCut — servidor local sin dependencias (Node 18+). Lo arranca main.js (Electron).
// Modo desarrollo sin Electron:  node -e "require('./server.js')"  ->  http://localhost:5173
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const SUBS = require('./public/subs.js');
const { spawn, spawnSync } = require('child_process');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const WORK = process.env.MOJARRA_DIR || path.join(ROOT, 'datos');
const PROJECTS = path.join(WORK, 'proyectos');
const TRASH = path.join(WORK, 'papelera');
const ACTIVE_FILE = path.join(WORK, 'activo.txt');
const PORT = Number(process.env.PORT) || 5173;
let portNow = PORT; const PORT_NOW = () => portNow;

fs.mkdirSync(PROJECTS, { recursive: true });
try { fs.copyFileSync(path.join(ROOT, 'CLAUDE.md'), path.join(WORK, 'CLAUDE.md')); } catch {}
// ===== Chat con Claude dentro de la app =====
// Cada mensaje lanza `claude -p` (reanudando la sesión anterior) y reenvía el progreso por SSE como evento "claude".
const chat = { proc: null, stopped: false };
const MODEL_OK = /^[a-z0-9.\-\[\]]{1,40}$/i, EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
function toolDesc(name, i = {}) {
  const f = (s) => String(s || '').split(/[\\/]/).pop();
  if (/^(Read|Edit|Write|MultiEdit)$/.test(name)) return ({ Read: 'Leyendo', Edit: 'Editando', Write: 'Escribiendo', MultiEdit: 'Editando' })[name] + ' ' + f(i.file_path);
  if (name === 'Bash' || name === 'PowerShell') return 'Ejecutando: ' + String(i.description || i.command || '').slice(0, 90);
  if (name === 'Grep' || name === 'Glob') return 'Buscando ' + String(i.pattern || '').slice(0, 60);
  return name;
}
function startChat(exe, b) {
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--dangerously-skip-permissions'];
  if (b.model && MODEL_OK.test(b.model)) args.push('--model', b.model);
  if (EFFORTS.includes(b.effort)) args.push('--effort', b.effort);
  if (b.session && /^[0-9a-f-]{36}$/i.test(b.session)) args.push('--resume', b.session);
  // Contexto directo: así Claude no tiene que buscar carpetas (más rápido y gasta menos)
  let act = ''; try { act = fs.readFileSync(path.join(WORK, 'activo.txt'), 'utf8').trim(); } catch {}
  args.push('--append-system-prompt', `Estás en el chat integrado de MojarraCut. La carpeta de datos es el directorio actual (${WORK}); ignora otras rutas de CLAUDE.md.` +
    (act ? ` El proyecto abierto es "${act}": edita proyectos/${act}/project.json (medios en proyectos/${act}/medios.json, transcripciones en proyectos/${act}/transcripciones/).` : '') +
    ` La API local está en http://localhost:${PORT_NOW()}. Haz los cambios directamente sin pedir confirmación y responde breve, en el idioma del usuario.`);
  const content = [];
  for (const im of (b.images || []).slice(0, 8)) { const m = /^data:(image\/(png|jpeg|gif|webp));base64,(.+)$/.exec(im || ''); if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[3] } }); }
  content.push({ type: 'text', text: String(b.text || '').slice(0, 20000) || 'Mira la imagen.' });
  const proc = spawn(exe, args, { cwd: WORK, windowsHide: true, shell: /\.cmd$/i.test(exe) });
  chat.proc = proc; chat.stopped = false; send('claude', { k: 'start' });
  let buf = '', err = '', done = false;
  const finish = (d) => { if (done) return; done = true; chat.proc = null; send('claude', { k: 'done', ...d }); };
  proc.stdout.on('data', (d) => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); let o; try { o = JSON.parse(line); } catch { continue; }
      if (o.type === 'system' && o.subtype === 'init') send('claude', { k: 'session', session: o.session_id, model: o.model });
      else if (o.type === 'stream_event' && !o.parent_tool_use_id && o.event?.delta?.type === 'text_delta') send('claude', { k: 'text', t: o.event.delta.text });
      else if (o.type === 'stream_event' && !o.parent_tool_use_id && o.event?.type === 'message_start') send('claude', { k: 'msg' });
      else if (o.type === 'assistant' && !o.parent_tool_use_id) for (const c of o.message?.content || []) { if (c.type === 'tool_use') send('claude', { k: 'tool', d: toolDesc(c.name, c.input) }); }
      else if (o.type === 'result') finish({ session: o.session_id, cost: o.total_cost_usd, error: o.is_error ? (o.result || 'Error') : null });
    }
  });
  proc.stderr.on('data', (d) => (err += d).length > 4000 && (err = err.slice(-4000)));
  proc.on('error', (e) => finish({ error: e.message }));
  proc.on('close', (code) => finish({ error: chat.stopped ? 'Detenido' : code ? (err.trim().split('\n').pop() || 'Claude terminó con error ' + code) : null }));
  proc.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n');
}
// Busca el ejecutable de Claude Code (instalador nativo, npm o el PATH)
function findClaude() {
  const home = require('os').homedir(), win = process.platform === 'win32';
  const cands = win ? [path.join(home, '.local', 'bin', 'claude.exe'), path.join(process.env.APPDATA || '', 'npm', 'claude.cmd')] : [path.join(home, '.local', 'bin', 'claude'), path.join(home, '.claude', 'local', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  // Claude Code incluido en la app de escritorio de Claude: %LOCALAPPDATA%\Claude-Data\claude_*\claude-code\<versión>\<hash>\claude.exe
  if (win) try {
    const base = path.join(process.env.LOCALAPPDATA || '', 'Claude-Data'), found = [];
    for (const d of fs.readdirSync(base)) { const cc = path.join(base, d, 'claude-code'); if (!fs.existsSync(cc)) continue;
      for (const v of fs.readdirSync(cc)) { const vd = path.join(cc, v); try { for (const h of fs.readdirSync(vd)) { const exe = path.join(vd, h, 'claude.exe'); if (fs.existsSync(exe)) found.push({ exe, v, t: fs.statSync(exe).mtimeMs }); } } catch {} } }
    const ver = (s) => s.split('.').map((n) => +n || 0);
    found.sort((a, b) => { const x = ver(a.v), y = ver(b.v); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] - x[i]; return b.t - a.t; });
    if (found[0]) return found[0].exe;
  } catch {}
  try { const r = require('child_process').spawnSync(win ? 'where' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true }); const l = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean); return l.find((x) => /\.(exe|cmd)$/i.test(x)) || l[0] || null; } catch { return null; }
}

const newProject = (name = 'Mi video', width = 1920, height = 1080, fps = 30) => ({
  name, width, height, fps, background: '#000000',
  tracks: [
    { id: 'v2', type: 'video', name: 'Video 2', clips: [] },
    { id: 'v1', type: 'video', name: 'Video 1', clips: [] },
    { id: 't1', type: 'text', name: 'Subtítulos', clips: [] },
    { id: 'a1', type: 'audio', name: 'Audio 1', clips: [] },
    { id: 'a2', type: 'audio', name: 'Música', clips: [] },
  ],
});
const slug = (s) => (s || 'video').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';
function uniqueDir(base, name) { let id = slug(name), k = 2; while (fs.existsSync(path.join(base, id))) id = `${slug(name)}-${k++}`; return id; }
function createProject(p) {
  const id = uniqueDir(PROJECTS, p.name);
  const dir = path.join(PROJECTS, id);
  for (const d of ['media', 'exports']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(p, null, 2));
  return id;
}

// Migración desde la versión 1 (un solo proyecto en la raíz)
if (fs.existsSync(path.join(WORK, 'project.json'))) {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(WORK, 'project.json'), 'utf8'));
    const id = createProject(old);
    for (const d of ['media', 'exports']) {
      const src = path.join(WORK, d);
      if (fs.existsSync(src)) for (const f of fs.readdirSync(src)) fs.renameSync(path.join(src, f), path.join(PROJECTS, id, d, f));
      try { fs.rmdirSync(src); } catch {}
    }
    fs.unlinkSync(path.join(WORK, 'project.json'));
  } catch (e) { console.error('migración', e); }
}

let active = null;
try { const a = fs.readFileSync(ACTIVE_FILE, 'utf8').trim(); if (a && fs.existsSync(path.join(PROJECTS, a, 'project.json'))) active = a; } catch {}
const P = () => { if (!active) { const e = new Error('No hay proyecto abierto'); e.code = 409; throw e; } return path.join(PROJECTS, active); };
const PROJECT = () => path.join(P(), 'project.json');
const MEDIA = () => path.join(P(), 'media');
const EXPORTS = () => path.join(P(), 'exports');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.srt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
};
const IMG = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const AUD = ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'];
const kindOf = (f) => { const e = path.extname(f).toLowerCase(); return IMG.includes(e) ? 'image' : AUD.includes(e) ? 'audio' : 'video'; };

function findBin(name) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim();
  const wg = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', name + '.exe');
  return fs.existsSync(wg) ? wg : null;
}
const tryReq = (m, f) => { try { const p = f(require(m)); return p && fs.existsSync(p) ? p : null; } catch { return null; } };
const FFMPEG = process.env.MOJARRA_FFMPEG || tryReq('ffmpeg-static', (x) => x) || findBin('ffmpeg');
const FFPROBE = process.env.MOJARRA_FFPROBE || tryReq('ffprobe-static', (x) => x.path) || findBin('ffprobe');
const probeCache = new Map();
function probe(file) {
  if (!FFPROBE) return null;
  const st = fs.statSync(file), key = file + st.mtimeMs;
  if (probeCache.has(key)) return probeCache.get(key);
  const r = spawnSync(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' });
  let out = null;
  try {
    const j = JSON.parse(r.stdout), v = j.streams.find((s) => s.codec_type === 'video');
    out = { duration: Number(j.format.duration) || null, width: v ? v.width : null, height: v ? v.height : null, hasAudio: j.streams.some((s) => s.codec_type === 'audio') };
  } catch {}
  probeCache.set(key, out); return out;
}

// ---------- Eventos en vivo (SSE): cambios hechos por Claude u otros programas ----------
const clients = new Set();
let lastWritten = '', lastSeen = '', mediaSig = '', listSig = '';
const send = (ev, data) => { for (const c of clients) c.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
setInterval(() => {
  try { const s = fs.readdirSync(PROJECTS).map((d) => { try { return d + fs.statSync(path.join(PROJECTS, d, 'project.json')).mtimeMs; } catch { return d; } }).join('|'); if (s !== listSig) { listSig = s; send('projects', {}); } } catch {}
  if (!active) return;
  let txt; try { txt = fs.readFileSync(PROJECT(), 'utf8'); } catch { return; }
  if (txt !== lastSeen) {
    lastSeen = txt;
    if (txt !== lastWritten) { try { JSON.parse(txt); lastWritten = txt; send('project', { external: true }); } catch {} }
  }
  try { const sig = fs.readdirSync(MEDIA()).join('|'); if (sig !== mediaSig) { mediaSig = sig; writeIndex(); send('media', {}); } } catch {}
}, 400);

// ---------- Índice de medios para Claude (medios.json): evita ffprobe y lecturas extra ----------
const TRANSCRIPTS = () => path.join(P(), 'transcripciones');
const transcriptFile = (name) => path.join(TRANSCRIPTS(), name + '.json');
function writeIndex() {
  if (!active) return;
  try {
    const files = fs.readdirSync(MEDIA()).filter((f) => !f.startsWith('.') && fs.statSync(path.join(MEDIA(), f)).isFile());
    const out = files.map((f) => {
      const i = probe(path.join(MEDIA(), f)) || {}, k = kindOf(f), tr = fs.existsSync(transcriptFile(f));
      const r = { name: f, kind: k };
      if (k !== 'image' && i.duration) r.duration = +i.duration.toFixed(3);
      if (k !== 'audio' && i.width) { r.width = i.width; r.height = i.height; }
      if (k === 'video') r.hasAudio = !!i.hasAudio;
      if (tr) r.transcript = `transcripciones/${f}.txt`;
      return r;
    });
    const txt = '{"note":"Generado por MojarraCut. Duraciones en segundos. No editar.","media":[\n' + out.map((o) => JSON.stringify(o)).join(',\n') + '\n]}\n';
    const f = path.join(P(), 'medios.json');
    if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== txt) fs.writeFileSync(f, txt);
  } catch {}
}

// ---------- Transcripción con tiempos por palabra: LOCAL (whisper.cpp, sin internet) u ONLINE (API con tu clave) ----------
// Nada viene instalado: el usuario descarga el motor y los modelos que quiera desde la app.
const WHISPER_DIR = path.join(WORK, 'transcripcion');
const MODELS_DIR = path.join(WHISPER_DIR, 'modelos');
const ENGINE_DIR = path.join(WHISPER_DIR, 'motor');
const CONFIG_FILE = path.join(WORK, 'config.json');
const HF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
const MODELS = [
  { id: 'tiny-q5_1', name: 'Muy rápido', size: 32e6, desc: 'El más ligero. Bien para pruebas; comete bastantes errores.' },
  { id: 'base-q5_1', name: 'Rápido', size: 60e6, desc: 'Ligero y veloz. Aceptable con voz clara.' },
  { id: 'small-q5_1', name: 'Equilibrado', size: 190e6, desc: 'Recomendado: buena precisión en español sin ser pesado.', rec: true },
  { id: 'medium-q5_0', name: 'Preciso', size: 539e6, desc: 'Más preciso, bastante más lento en CPU.' },
  { id: 'large-v3-turbo-q5_0', name: 'Máxima calidad', size: 574e6, desc: 'El más preciso; lento sin tarjeta gráfica.' },
];
const ONLINE = {
  groq: { name: 'Groq (whisper-large-v3-turbo)', url: 'https://api.groq.com/openai/v1/audio/transcriptions', model: 'whisper-large-v3-turbo', keyUrl: 'https://console.groq.com/keys' },
  openai: { name: 'OpenAI (whisper-1)', url: 'https://api.openai.com/v1/audio/transcriptions', model: 'whisper-1', keyUrl: 'https://platform.openai.com/api-keys' },
};
const readConfig = () => { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } };
const writeConfig = (c) => { fs.mkdirSync(WORK, { recursive: true }); fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); };
function findFile(dir, names) { try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isFile() && names.includes(e.name.toLowerCase())) return p; if (e.isDirectory()) { const r = findFile(p, names); if (r) return r; } } } catch {} return null; }
const whisperBin = () => findFile(ENGINE_DIR, ['whisper-cli.exe', 'whisper-cli']);
const modelPath = (id) => path.join(MODELS_DIR, `ggml-${id}.bin`);
const installed = (id) => fs.existsSync(modelPath(id));
let dl = null; // descarga en curso { id, progress, error }

// Descarga con redirecciones (GitHub y Hugging Face redirigen a su CDN)
function download(url, dest, onProgress, hops = 0) {
  return new Promise((resolve, reject) => {
    const https = require('https');
    const req = https.get(url, { headers: { 'User-Agent': 'MojarraCut' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 8) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, dest, onProgress, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Error ${res.statusCode} al descargar`)); }
      const total = +res.headers['content-length'] || 0; let got = 0;
      const tmp = dest + '.part', w = fs.createWriteStream(tmp);
      res.on('data', (c) => { got += c.length; if (total) onProgress(got / total); });
      res.pipe(w); w.on('finish', () => { w.close(() => { fs.renameSync(tmp, dest); resolve(); }); });
      res.on('error', reject); w.on('error', reject);
      dl.abort = () => { req.destroy(); w.destroy(); try { fs.unlinkSync(tmp); } catch {} };
    });
    req.on('error', reject);
  });
}
async function engineUrl() {
  try {
    const r = await fetch('https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=10', { headers: { 'User-Agent': 'MojarraCut' } });
    for (const rel of await r.json()) { const a = (rel.assets || []).find((x) => x.name === 'whisper-bin-x64.zip'); if (a) return a.browser_download_url; }
  } catch {}
  return 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip';
}
async function installModel(id) {
  if (dl) throw new Error('Ya hay una descarga en curso');
  const m = MODELS.find((x) => x.id === id); if (!m) throw new Error('Modelo desconocido');
  dl = { id, progress: 0, step: 'motor', error: null }; send('whisper', whisperState());
  try {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    if (!whisperBin()) {             // el motor (≈9 MB) se descarga junto con el primer modelo
      fs.mkdirSync(ENGINE_DIR, { recursive: true });
      const zip = path.join(WHISPER_DIR, 'motor.zip');
      await download(await engineUrl(), zip, (p) => { dl.progress = p * 0.05; send('whisper', whisperState()); });
      const tar = process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:/Windows', 'System32', 'tar.exe') : 'unzip';
      const r = spawnSync(tar, process.platform === 'win32' ? ['-xf', zip, '-C', ENGINE_DIR] : ['-o', zip, '-d', ENGINE_DIR]);
      try { fs.unlinkSync(zip); } catch {}
      if (r.status !== 0 || !whisperBin()) throw new Error('No se pudo instalar el motor de transcripción');
    }
    dl.step = 'modelo';
    await download(HF + `ggml-${id}.bin`, modelPath(id), (p) => { dl.progress = 0.05 + p * 0.95; send('whisper', whisperState()); });
    const cfg = readConfig(); cfg.localModel ||= id; writeConfig(cfg);
    dl = null; send('whisper', whisperState());
  } catch (e) { dl = { ...dl, error: e.message }; send('whisper', whisperState()); dl = null; throw e; }
}
function whisperState() {
  const cfg = readConfig();
  return {
    engine: !!whisperBin(), downloading: dl && { id: dl.id, progress: dl.progress, step: dl.step, error: dl.error },
    models: MODELS.map((m) => ({ ...m, installed: installed(m.id) })), localModel: cfg.localModel || null,
    online: Object.entries(ONLINE).map(([id, o]) => ({ id, name: o.name, keyUrl: o.keyUrl, hasKey: !!(cfg.keys || {})[id] })), onlineProvider: cfg.onlineProvider || 'groq',
  };
}

let tjob = { running: false, name: null, progress: 0, error: null };
let tproc = null;
// Agrupa palabras en frases cortas aptas para subtítulos
function phrasesOf(words, { maxChars = 32, maxDur = 3.2, gap = 0.6 } = {}) {
  const out = []; let cur = null;
  for (const w of words) {
    const len = cur ? cur.words.map((x) => x.t).join(' ').length + 1 + w.t.length : 0;
    if (!cur || w.s - cur.e > gap || len > maxChars || w.e - cur.s > maxDur || /[.!?…]$/.test(cur.words[cur.words.length - 1].t)) {
      cur = { s: w.s, e: w.e, words: [] }; out.push(cur);
    }
    cur.words.push(w); cur.e = w.e;
  }
  return out.map((p) => ({ s: +p.s.toFixed(2), e: +p.e.toFixed(2), text: p.words.map((w) => w.t).join(' '), words: p.words }));
}
function saveTranscript(proj, name, words, language, via) {
  words = words.map((x) => ({ t: String(x.t).trim(), s: +(+x.s).toFixed(2), e: +(+x.e).toFixed(2) })).filter((x) => x.t && !/^\[.*\]$/.test(x.t) && !/^\(.*\)$/.test(x.t));
  const ph = phrasesOf(words);
  const dir = path.join(PROJECTS, proj, 'transcripciones'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ media: name, language, via, words, phrases: ph }));
  fs.writeFileSync(path.join(dir, name + '.txt'), `# Transcripción de ${name} (segundos dentro del archivo, inicio-fin)\n` + ph.map((p) => `${p.s}-${p.e} ${p.text}`).join('\n') + '\n');
}
function startTranscribe(name, lang, mode, modelId) {
  if (tjob.running) throw new Error('Ya hay una transcripción en curso');
  const src = inside(MEDIA(), name); if (!src || !fs.existsSync(src)) throw new Error('No existe el medio');
  const cfg = readConfig(), online = mode === 'online';
  let bin, model, prov, key;
  if (online) {
    prov = cfg.onlineProvider || 'groq'; key = (cfg.keys || {})[prov];
    if (!key) throw new Error('Falta la clave de API del servicio en línea');
  } else {
    bin = whisperBin(); modelId = modelId || cfg.localModel; model = modelId && modelPath(modelId);
    if (!bin || !model || !fs.existsSync(model)) throw new Error('Descarga primero un modelo de transcripción local');
    if (cfg.localModel !== modelId) { cfg.localModel = modelId; writeConfig(cfg); }
  }
  const proj = active, tmp = path.join(os.tmpdir(), 'mojarra-tr-' + Date.now()); fs.mkdirSync(tmp, { recursive: true });
  const aud = path.join(tmp, online ? 'a.mp3' : 'a.wav'), outBase = path.join(tmp, 'out');
  tjob = { running: true, name, progress: 0, error: null, project: proj, mode: online ? 'online' : 'local' }; send('transcribe', tjob);
  const fail = (e) => { tjob = { ...tjob, running: false, error: String(e).slice(0, 400) }; tproc = null; send('transcribe', tjob); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
  const done = () => { tjob = { ...tjob, running: false, progress: 1 }; tproc = null; if (proj === active) writeIndex(); send('transcribe', tjob); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {} };
  // audio mono 16 kHz (en línea: mp3 compacto para subir poco)
  const ff = spawn(FFMPEG, ['-y', '-i', src, '-vn', '-ar', '16000', '-ac', '1', ...(online ? ['-b:a', '32k'] : ['-c:a', 'pcm_s16le']), aud]);
  tproc = ff;
  ff.on('close', async (code) => {
    if (!tjob.running) return;
    if (code !== 0 || !fs.existsSync(aud)) return fail('El archivo no tiene audio que se pueda transcribir');
    if (online) {
      try {
        if (fs.statSync(aud).size > 24e6) return fail('El audio es demasiado largo para el servicio en línea (máx. ≈ 100 min)');
        tjob.progress = 0.3; send('transcribe', tjob);
        const o = ONLINE[prov], fd = new FormData();
        fd.append('file', new Blob([fs.readFileSync(aud)], { type: 'audio/mpeg' }), 'audio.mp3');
        fd.append('model', o.model); fd.append('response_format', 'verbose_json'); fd.append('timestamp_granularities[]', 'word');
        if (lang && lang !== 'auto') fd.append('language', lang);
        const ctl = new AbortController(); tproc = { kill: () => ctl.abort() };
        const r = await fetch(o.url, { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd, signal: ctl.signal });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return fail(r.status === 401 ? 'La clave de API no es válida' : 'El servicio respondió: ' + (j.error?.message || r.status));
        if (!tjob.running) return;
        saveTranscript(proj, name, (j.words || []).map((w) => ({ t: w.word, s: w.start, e: w.end })), j.language || lang, prov);
        return done();
      } catch (e) { return tjob.running && fail(e.name === 'AbortError' ? 'Cancelada' : 'Sin conexión con el servicio: ' + e.message); }
    }
    const threads = Math.max(2, Math.min(8, os.cpus().length - 1));
    const w = spawn(bin, ['-m', model, '-f', aud, '-l', lang || 'auto', '-oj', '-of', outBase, '-ml', '1', '-sow', '-pp', '-t', String(threads)], { cwd: path.dirname(bin) });
    tproc = w; let err = '';
    const onOut = (d) => { const s = d.toString(); err = (err + s).slice(-2000); const m = s.match(/progress\s*=\s*(\d+)%/g); if (m) { tjob.progress = +m[m.length - 1].match(/\d+/)[0] / 100; send('transcribe', tjob); } };
    w.stdout.on('data', onOut); w.stderr.on('data', onOut);
    w.on('close', (c2) => {
      if (!tjob.running) return;
      let j; try { j = JSON.parse(fs.readFileSync(outBase + '.json', 'utf8')); } catch { return fail(c2 ? 'Falló la transcripción: ' + err.split('\n').filter(Boolean).slice(-2).join(' ') : 'Sin resultado'); }
      const ws = [];   // un trozo sin espacio inicial continúa la palabra anterior
      for (const x of j.transcription || []) {
        const t = String(x.text || ''), w = { t, s: x.offsets.from / 1000, e: x.offsets.to / 1000 };
        if (ws.length && t && !/^\s/.test(t) && !/^[¿¡]/.test(t)) { const p = ws[ws.length - 1]; p.t += t; p.e = w.e; } else ws.push(w);
      }
      saveTranscript(proj, name, ws, j.result?.language || lang, 'local:' + modelId);
      done();
    });
  });
}

// ---------- Transiciones (misma lógica que app.js) ----------
const TRANS_TYPES = ['dissolve', 'black', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'push-left', 'push-right'];
function linkTransitions(track) {
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  const tail = new Map(), prevOf = new Map();
  for (let i = 0; i < clips.length; i++) {
    const b = clips[i], tr = b.transition;
    if (!tr || !TRANS_TYPES.includes(tr.type) || track.type !== 'video') continue;
    const a = clips[i - 1];
    const linked = a && Math.abs(a.start + a.duration - b.start) < 0.05;
    const d = Math.max(0.05, Math.min(tr.duration || 1, b.duration, linked ? a.duration : Infinity));
    if (linked) { tail.set(a.id, { d, type: tr.type, at: b.start }); prevOf.set(b.id, a.id); }
  }
  return { tail, prevOf };
}

// ---------- Efectos (equivalentes a los filtros CSS del visor) ----------
function effectFilters(list) {
  let f = '';
  for (const e of list || []) {
    if (e.enabled === false) continue;
    const DEF = { grayscale: 1, sepia: 1, invert: 1, blur: 6, brightness: 1.3, contrast: 1.3, saturate: 1.6, hue: 90 };
    const a = num(e.amount ?? DEF[e.type]);
    switch (e.type) {
      case 'grayscale': { const k = (x, y) => num(x * (1 - a) + y * a); // matriz CSS grayscale
        f += `,colorchannelmixer=rr=${k(1, 0.2126)}:rg=${k(0, 0.7152)}:rb=${k(0, 0.0722)}:gr=${k(0, 0.2126)}:gg=${k(1, 0.7152)}:gb=${k(0, 0.0722)}:br=${k(0, 0.2126)}:bg=${k(0, 0.7152)}:bb=${k(1, 0.0722)}`; break; }
      case 'sepia': { const k = (x, y) => num(x * (1 - a) + y * a);
        f += `,colorchannelmixer=rr=${k(1, 0.393)}:rg=${k(0, 0.769)}:rb=${k(0, 0.189)}:gr=${k(0, 0.349)}:gg=${k(1, 0.686)}:gb=${k(0, 0.168)}:br=${k(0, 0.272)}:bg=${k(0, 0.534)}:bb=${k(1, 0.131)}`; break; }
      case 'invert': f += `,lutrgb=r='val*(1-2*${a})+maxval*${a}':g='val*(1-2*${a})+maxval*${a}':b='val*(1-2*${a})+maxval*${a}'`; break;
      case 'blur': if (a > 0) f += `,gblur=sigma=${a}`; break;
      case 'brightness': f += `,colorchannelmixer=rr=${a}:gg=${a}:bb=${a}`; break;
      case 'contrast': f += `,lutrgb=r='clip((val-128)*${a}+128,0,255)':g='clip((val-128)*${a}+128,0,255)':b='clip((val-128)*${a}+128,0,255)'`; break;
      case 'saturate': { const s = a, k = (lum, id) => num(lum * (1 - s) + id * s); // matriz CSS saturate
        f += `,colorchannelmixer=rr=${k(0.2126, 1)}:rg=${k(0.7152, 0)}:rb=${k(0.0722, 0)}:gr=${k(0.2126, 0)}:gg=${k(0.7152, 1)}:gb=${k(0.0722, 0)}:br=${k(0.2126, 0)}:bg=${k(0.7152, 0)}:bb=${k(0.0722, 1)}`; break; }
      case 'hue': f += `,hue=h=${a},format=rgba`; break;
    }
  }
  return f;
}

// ---------- Render con ffmpeg ----------
let render = { running: false, progress: 0, log: '', output: null, error: null };
let renderProc = null;
function esc(p) { return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"); }
function colorHex(c, a = 1) { const h = (c || '#ffffff').replace('#', ''); return `0x${h.slice(0, 6)}@${a}`; }
const num = (v) => Number(Number(v).toFixed(4));

function buildRender(project) {
  const W = project.width, H = project.height, FPS = project.fps || 30;
  const all = project.tracks.flatMap((t) => t.clips);
  const total = Math.max(0.1, ...all.map((c) => c.start + c.duration));
  const args = ['-y', '-f', 'lavfi', '-i', `color=c=${colorHex(project.background)}:s=${W}x${H}:r=${FPS}:d=${num(total)}`];
  const filters = [], audioLabels = [];
  let idx = 1, last = '[0:v]', n = 0;
  const tmp = path.join(EXPORTS(), '_tmp'); fs.mkdirSync(tmp, { recursive: true });

  for (const track of [...project.tracks].reverse()) {           // capa inferior = última pista
    if (track.hidden && track.type !== 'audio') continue;
    const { tail } = linkTransitions(track);
    if (track.type === 'text') {      // subtítulos con diseños y animación por palabra → libass
      if (!track.clips.length) continue;
      const af = path.join(tmp, `subs${n++}.ass`);
      fs.writeFileSync(af, '\ufeff' + SUBS.toASS([...track.clips].sort((a, b) => a.start - b.start), W, H), 'utf8');
      // solo las fuentes usadas (cargar toda la carpeta de Windows es lento)
      const sys = process.platform === 'win32' ? path.join(process.env.WINDIR || 'C:/Windows', 'Fonts') : '/usr/share/fonts';
      const FILES = { 'Arial': ['arial.ttf', 'arialbd.ttf'], 'Arial Black': ['ariblk.ttf'], 'Impact': ['impact.ttf'], 'Segoe UI': ['segoeui.ttf', 'segoeuib.ttf'], 'Verdana': ['verdana.ttf', 'verdanab.ttf'], 'Trebuchet MS': ['trebuc.ttf', 'trebucbd.ttf'], 'Georgia': ['georgia.ttf', 'georgiab.ttf'], 'Comic Sans MS': ['comic.ttf', 'comicbd.ttf'], 'Courier New': ['cour.ttf', 'courbd.ttf'] };
      const fontsDir = path.join(tmp, 'fonts'); fs.mkdirSync(fontsDir, { recursive: true });
      for (const fam of new Set(['Arial', ...track.clips.map((c) => (c.style || {}).font || 'Arial')]))
        for (const f of FILES[fam] || []) { const s = path.join(sys, f); try { if (fs.existsSync(s) && !fs.existsSync(path.join(fontsDir, f))) fs.copyFileSync(s, path.join(fontsDir, f)); } catch {} }
      filters.push(`${last}ass=filename='${esc(af)}':fontsdir='${esc(fontsDir)}'[ot${n}]`);
      last = `[ot${n}]`;
      continue;
    }
    for (const c of [...track.clips].sort((a, b) => a.start - b.start)) {
      const fadeIn = c.fadeIn || 0, fadeOut = c.fadeOut || 0, end = c.start + c.duration;
      if (track.type === 'text') {
        const s = c.style || {};
        const tf = path.join(tmp, `t${n++}.txt`); fs.writeFileSync(tf, c.text || '');
        const y = s.position === 'top' ? `${Math.round(H * 0.08)}` : s.position === 'center' ? '(h-text_h)/2' : `h-text_h-${Math.round(H * 0.08)}`;
        let alpha = `${c.opacity ?? 1}`;
        if (fadeIn || fadeOut) alpha = `${c.opacity ?? 1}*min(1,min((t-${c.start})/${fadeIn || 0.0001},(${end}-t)/${fadeOut || 0.0001}))`;
        const font = s.bold === false ? 'arial.ttf' : 'arialbd.ttf';
        filters.push(`${last}drawtext=fontfile='${esc('C:/Windows/Fonts/' + font)}':textfile='${esc(tf)}':fontsize=${s.fontSize || 64}:fontcolor=${colorHex(s.color)}:x=(w-text_w)/2+${c.x || 0}:y=${y}+${c.y || 0}:line_spacing=8:text_align=C` +
          (s.background ? `:box=1:boxcolor=${colorHex(s.background, s.backgroundOpacity ?? 0.6)}:boxborderw=18` : '') +
          `:borderw=${s.outline ?? 3}:bordercolor=black:alpha='${alpha}':enable='between(t,${c.start},${end})'[ot${n}]`);
        last = `[ot${n}]`;
        continue;
      }
      const file = path.join(MEDIA(), c.src);
      if (!fs.existsSync(file)) throw new Error(`Falta el archivo "${c.src}" en la carpeta media del proyecto.`);
      const info = probe(file) || {};
      const kind = kindOf(c.src);
      const tl = tail.get(c.id);                                 // este clip se prolonga bajo la transición del siguiente
      const ext = tl ? tl.d : 0, visDur = c.duration + ext;
      if (kind === 'image') args.push('-loop', '1', '-framerate', String(FPS), '-t', String(num(visDur)), '-i', file);
      else args.push('-ss', String(num(c.in || 0)), '-t', String(num(visDur)), '-i', file);
      const i = idx++;
      if (track.type !== 'audio' && kind !== 'audio') {
        const cr = c.crop || {}, cl = cr.l || 0, ct = cr.t || 0, cw = 1 - cl - (cr.r || 0), ch = 1 - ct - (cr.b || 0);
        const sw = (info.width || W) * cw, sh = (info.height || H) * ch;
        const fit = Math.min(W / sw, H / sh) * (c.scale ?? 1);
        const w = Math.max(2, Math.round(sw * fit / 2) * 2), h = Math.max(2, Math.round(sh * fit / 2) * 2);
        let f = `[${i}:v]fps=${FPS}`;
        if (kind === 'video' && ext) f += `,tpad=stop_mode=clone:stop_duration=${num(ext)}`;
        if (cl || ct || cw < 1 || ch < 1) f += `,crop=w=iw*${num(cw)}:h=ih*${num(ch)}:x=iw*${num(cl)}:y=ih*${num(ct)}`;
        f += `,scale=${w}:${h},format=rgba` + effectFilters(c.effects);
        if ((c.opacity ?? 1) < 1) f += `,colorchannelmixer=aa=${c.opacity}`;
        const tr = c.transition && TRANS_TYPES.includes(c.transition.type) && track.type === 'video' ? c.transition : null;
        const td = tr ? Math.max(0.05, Math.min(tr.duration || 1, c.duration)) : 0;
        if (tr && tr.type === 'dissolve') f += `,fade=t=in:st=0:d=${num(Math.max(td, fadeIn))}:alpha=1`;
        else if (tr && tr.type === 'black') f += `,fade=t=in:st=${num(td / 2)}:d=${num(td / 2)}:alpha=1`;
        else if (fadeIn) f += `,fade=t=in:st=0:d=${fadeIn}:alpha=1`;
        if (tl && tl.type === 'black') f += `,fade=t=out:st=${num(c.duration)}:d=${num(ext / 2)}:alpha=1`;
        else if (fadeOut) f += `,fade=t=out:st=${num(c.duration - fadeOut)}:d=${fadeOut}:alpha=1`;
        f += `,setpts=PTS-STARTPTS+${num(c.start)}/TB[v${i}]`;
        filters.push(f);
        let x = `(W-w)/2+${c.x || 0}`, y = `(H-h)/2+${c.y || 0}`;
        const p = `clip((t-${num(c.start)})/${num(td || 1)},0,1)`;
        if (tr) {
          if (tr.type === 'slide-left' || tr.type === 'push-left') x += `+W*(1-${p})`;
          if (tr.type === 'slide-right' || tr.type === 'push-right') x += `-W*(1-${p})`;
          if (tr.type === 'slide-up') y += `+H*(1-${p})`;
          if (tr.type === 'slide-down') y += `-H*(1-${p})`;
        }
        if (tl && (tl.type === 'push-left' || tl.type === 'push-right')) {
          const q = `clip((t-${num(tl.at)})/${num(ext)},0,1)`;
          x += tl.type === 'push-left' ? `-W*${q}` : `+W*${q}`;
        }
        filters.push(`${last}[v${i}]overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:enable='between(t,${num(c.start)},${num(end + ext)})'[o${i}]`);
        last = `[o${i}]`;
      }
      const wantsAudio = !track.muted && !c.muted && (kind === 'audio' || (info.hasAudio && kind === 'video'));
      if (wantsAudio) {
        let a = `[${i}:a]atrim=0:${num(c.duration)},asetpts=PTS-STARTPTS,volume=${c.volume ?? 1}`;
        const afi = Math.min(+(c.audioFadeIn ?? fadeIn) || 0, c.duration), afo = Math.min(+(c.audioFadeOut ?? fadeOut) || 0, c.duration);
        if (afi) a += `,afade=t=in:st=0:d=${num(afi)}`;
        if (afo) a += `,afade=t=out:st=${num(c.duration - afo)}:d=${num(afo)}`;
        const ms = Math.round(c.start * 1000);
        a += `,adelay=${ms}|${ms}[a${i}]`;
        filters.push(a); audioLabels.push(`[a${i}]`);
      }
    }
  }
  filters.push(`${last}format=yuv420p[vout]`);
  if (audioLabels.length) filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest,atrim=0:${num(total)}[aout]`);
  const script = path.join(tmp, 'filter.txt');
  fs.writeFileSync(script, filters.join(';\n'));
  const safe = (project.name || 'video').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ]/g, '').trim() || 'video';
  const out = `${safe}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.mp4`;
  args.push('-filter_complex_script', script, '-map', '[vout]');
  if (audioLabels.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-r', String(FPS), '-t', String(num(total)), '-movflags', '+faststart', path.join(EXPORTS(), out));
  return { args, out, total };
}

function startRender(project) {
  if (!FFMPEG) throw new Error('No se encontró ffmpeg. Reinstala MojarraCut para recuperarlo.');
  if (render.running) throw new Error('Ya hay una exportación en curso.');
  const { args, out, total } = buildRender(project);
  render = { running: true, progress: 0, log: '', output: null, error: null, project: active };
  const p = renderProc = spawn(FFMPEG, args);
  p.stderr.on('data', (d) => {
    const s = d.toString(); render.log = (render.log + s).slice(-6000);
    const m = s.match(/time=(\d+):(\d+):([\d.]+)/);
    if (m) render.progress = Math.min(0.99, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / total);
    send('render', render);
  });
  p.on('close', (code) => {
    renderProc = null; render.running = false;
    if (render.cancelled) render.error = 'Exportación cancelada.';
    else if (code === 0) { render.progress = 1; render.output = out; } else render.error = 'ffmpeg terminó con código ' + code;
    send('render', render);
  });
}

// ---------- Proyectos ----------
function listProjects() {
  return fs.readdirSync(PROJECTS).filter((d) => fs.existsSync(path.join(PROJECTS, d, 'project.json'))).map((id) => {
    const f = path.join(PROJECTS, id, 'project.json'), st = fs.statSync(f);
    let p = {}; try { p = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    const clips = (p.tracks || []).flatMap((t) => t.clips || []);
    return {
      id, name: p.name || id, width: p.width, height: p.height, modified: st.mtimeMs, clips: clips.length,
      duration: Math.max(0, ...clips.map((c) => (+c.start || 0) + (+c.duration || 0))),
      thumb: fs.existsSync(path.join(PROJECTS, id, 'thumb.jpg')), active: id === active,
    };
  }).sort((a, b) => b.modified - a.modified);
}
function setActive(id) {
  active = id; lastWritten = lastSeen = mediaSig = '';
  if (id) { lastSeen = lastWritten = fs.readFileSync(PROJECT(), 'utf8'); }
  fs.writeFileSync(ACTIVE_FILE, id || '');
  if (id) writeIndex();
}
function copyDir(a, b) { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) { const s = path.join(a, f), d = path.join(b, f); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }

// ---------- HTTP ----------
function body(req) { return new Promise((res, rej) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej); }); }
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function serveFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const [s, e] = range.replace('bytes=', '').split('-');
      const start = Number(s) || 0, end = e ? Math.min(Number(e), st.size - 1) : st.size - 1;
      // archivo vacío (p. ej. aún descargándose) o rango imposible: 416 en vez de romper el servidor
      if (!st.size || !(start >= 0) || !(end >= start)) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    }
  });
}
const inside = (base, p) => { const r = path.resolve(base, p); return r.startsWith(base + path.sep) ? r : null; };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname), M = req.method;
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify({ ffmpeg: !!FFMPEG, active, dir: WORK })}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res)); return;
    }
    // proyectos
    if (p === '/api/projects' && M === 'GET') return json(res, 200, listProjects());
    if (p === '/api/projects' && M === 'POST') {
      const b = JSON.parse((await body(req)).toString('utf8') || '{}');
      const id = createProject(newProject((b.name || '').trim() || 'Mi video', +b.width || 1920, +b.height || 1080, +b.fps || 30));
      return json(res, 200, { id });
    }
    let m;
    if ((m = p.match(/^\/api\/projects\/([^/]+)(\/\w+)?$/))) {
      const id = m[1], act = m[2], dir = inside(PROJECTS, id);
      if (!dir || !fs.existsSync(dir)) return json(res, 404, { error: 'El proyecto no existe' });
      if (act === '/open' && M === 'POST') { setActive(id); return json(res, 200, { ok: true }); }
      if (act === '/duplicate' && M === 'POST') {
        const pj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); pj.name += ' (copia)';
        const nid = uniqueDir(PROJECTS, pj.name); copyDir(dir, path.join(PROJECTS, nid));
        fs.writeFileSync(path.join(PROJECTS, nid, 'project.json'), JSON.stringify(pj, null, 2)); return json(res, 200, { id: nid });
      }
      if (!act && M === 'PATCH') {
        const b = JSON.parse((await body(req)).toString('utf8')); const f = path.join(dir, 'project.json');
        const pj = JSON.parse(fs.readFileSync(f, 'utf8')); if (b.name) pj.name = String(b.name).slice(0, 80);
        const txt = JSON.stringify(pj, null, 2); if (id === active) lastWritten = txt; fs.writeFileSync(f, txt); return json(res, 200, { ok: true });
      }
      if (!act && M === 'DELETE') {             // a la papelera (recuperable)
        if (id === active) setActive(null);
        fs.mkdirSync(TRASH, { recursive: true }); const tid = uniqueDir(TRASH, id); fs.renameSync(dir, path.join(TRASH, tid));
        return json(res, 200, { ok: true, trashId: tid });
      }
      if (act === '/restore' && M === 'POST') return json(res, 400, { error: 'usa /api/trash' });
    }
    if ((m = p.match(/^\/api\/trash\/([^/]+)\/restore$/)) && M === 'POST') {
      const src = inside(TRASH, m[1]); if (!src || !fs.existsSync(src)) return json(res, 404, { error: 'No está en la papelera' });
      const id = uniqueDir(PROJECTS, m[1].replace(/-\d+$/, '')); fs.renameSync(src, path.join(PROJECTS, id)); return json(res, 200, { id });
    }
    if (p === '/api/close' && M === 'POST') { setActive(null); return json(res, 200, { ok: true }); }
    if ((m = p.match(/^\/thumbs\/([^/]+)$/))) { const d = inside(PROJECTS, m[1]); return d ? serveFile(req, res, path.join(d, 'thumb.jpg')) : (res.writeHead(403), res.end()); }

    // proyecto activo
    if (p === '/api/project' && M === 'GET') { const t = fs.readFileSync(PROJECT()); res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Project': active }); return res.end(t); }
    if (p === '/api/project' && M === 'PUT') {
      const txt = JSON.stringify(JSON.parse((await body(req)).toString('utf8')), null, 2);
      lastWritten = lastSeen = txt; fs.writeFileSync(PROJECT(), txt); return json(res, 200, { ok: true });
    }
    if (p === '/api/thumb' && M === 'PUT') { fs.writeFileSync(path.join(P(), 'thumb.jpg'), await body(req)); return json(res, 200, { ok: true }); }
    if (p === '/api/media' && M === 'GET') {
      const files = fs.readdirSync(MEDIA()).filter((f) => !f.startsWith('.')).map((f) => {
        const st = fs.statSync(path.join(MEDIA(), f)); return { name: f, kind: kindOf(f), size: st.size, modified: st.mtimeMs };
      });
      return json(res, 200, files);
    }
    if ((m = p.match(/^\/api\/media\/(.+)$/)) && M === 'DELETE') {
      const f = inside(MEDIA(), m[1]); if (!f) return json(res, 403, {});
      fs.mkdirSync(path.join(P(), '.borrados'), { recursive: true }); fs.renameSync(f, path.join(P(), '.borrados', path.basename(f))); return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/media\/(.+)\/restore$/)) && M === 'POST') {
      const f = inside(path.join(P(), '.borrados'), m[1]); if (!f || !fs.existsSync(f)) return json(res, 404, {});
      fs.renameSync(f, path.join(MEDIA(), path.basename(f))); return json(res, 200, { ok: true });
    }
    if (p === '/api/upload' && M === 'POST') {
      const name = path.basename(url.searchParams.get('name') || 'archivo').replace(/[<>:"|?*\x00-\x1f]/g, '_');
      let dest = path.join(MEDIA(), name), k = 1;
      while (fs.existsSync(dest)) { const e = path.extname(name); dest = path.join(MEDIA(), `${path.basename(name, e)} (${k++})${e}`); }
      await new Promise((ok, ko) => { const w = fs.createWriteStream(dest); req.pipe(w); w.on('finish', ok); w.on('error', ko); });
      return json(res, 200, { name: path.basename(dest), kind: kindOf(dest) });
    }
    if (p === '/api/transcribe' && M === 'GET') return json(res, 200, tjob);
    if (p === '/api/transcribe' && M === 'POST') {
      try { startTranscribe(url.searchParams.get('name'), url.searchParams.get('lang') || 'auto', url.searchParams.get('mode'), url.searchParams.get('model')); return json(res, 200, { ok: true }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    // bienvenida animada: se muestra en la primera apertura y tras cada actualización
    if (p === '/api/welcome' && M === 'GET') { let v = '0'; try { v = require('./package.json').version; } catch {} return json(res, 200, { version: v, show: readConfig().welcomed !== v }); }
    if (p === '/api/welcome' && M === 'POST') { const c = readConfig(); try { c.welcomed = require('./package.json').version; } catch {} writeConfig(c); return json(res, 200, { ok: true }); }
    // motor/modelos de transcripción y servicio en línea
    if (p === '/api/whisper' && M === 'GET') return json(res, 200, whisperState());
    if (p === '/api/whisper/download' && M === 'POST') { installModel(url.searchParams.get('id')).catch(() => {}); return json(res, 200, { ok: true }); }
    if (p === '/api/whisper/download' && M === 'DELETE') { if (dl && dl.abort) dl.abort(); return json(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/whisper\/models\/([\w.-]+)$/)) && M === 'DELETE') {
      try { fs.unlinkSync(modelPath(m[1])); } catch {} const cfg = readConfig(); if (cfg.localModel === m[1]) { cfg.localModel = MODELS.map((x) => x.id).find(installed) || null; writeConfig(cfg); }
      send('whisper', whisperState()); return json(res, 200, { ok: true });
    }
    if (p === '/api/whisper/config' && M === 'PUT') {    // la clave se guarda solo en este equipo y nunca se devuelve
      const b = JSON.parse((await body(req)).toString('utf8') || '{}'), cfg = readConfig();
      if (b.onlineProvider && ONLINE[b.onlineProvider]) cfg.onlineProvider = b.onlineProvider;
      if (b.localModel && installed(b.localModel)) cfg.localModel = b.localModel;
      if (b.provider && ONLINE[b.provider] && typeof b.key === 'string') { cfg.keys ||= {}; if (b.key.trim()) cfg.keys[b.provider] = b.key.trim(); else delete cfg.keys[b.provider]; }
      writeConfig(cfg); return json(res, 200, whisperState());
    }
    if (p === '/api/transcribe' && M === 'DELETE') { if (tproc) { tjob.running = false; tjob.error = 'Cancelada'; try { tproc.kill(); } catch {} send('transcribe', tjob); } return json(res, 200, { ok: true }); }
    if (p === '/api/transcript' && M === 'GET') {
      const f = inside(TRANSCRIPTS(), (url.searchParams.get('name') || '') + '.json');
      if (!f || !fs.existsSync(f)) return json(res, 404, { error: 'Sin transcripción' });
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(fs.readFileSync(f));
    }
    if (p === '/api/transcripts' && M === 'GET') { let l = []; try { l = fs.readdirSync(TRANSCRIPTS()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch {} return json(res, 200, l); }
    if (p === '/api/render' && M === 'POST') { startRender(JSON.parse(fs.readFileSync(PROJECT(), 'utf8'))); return json(res, 200, { ok: true }); }
    if (p === '/api/render' && M === 'DELETE') { if (renderProc) { render.cancelled = true; renderProc.kill(); } return json(res, 200, { ok: true }); }
    if (p === '/api/render' && M === 'GET') return json(res, 200, { ...render, ffmpeg: !!FFMPEG });
    // Chat integrado: Claude Code en modo headless, con streaming hacia la app
    if (p === '/api/claude/chat' && M === 'POST') {
      const exe = findClaude(); if (!exe) return json(res, 200, { ok: false, found: false });
      if (chat.proc) return json(res, 409, { ok: false, error: 'Claude todavía está respondiendo' });
      const b = JSON.parse((await body(req)).toString() || '{}');
      startChat(exe, b); return json(res, 200, { ok: true });
    }
    if (p === '/api/claude/chat' && M === 'DELETE') { if (chat.proc) { chat.stopped = true; try { chat.proc.kill(); } catch {} } return json(res, 200, { ok: true }); }
    // Historial del chat guardado dentro de cada proyecto: proyectos/<id>/chat.json
    if (p === '/api/claude/history') {
      const id = url.searchParams.get('id') || '';
      if (!/^[\w.\- ]+$/.test(id) || !fs.existsSync(path.join(PROJECTS, id))) return json(res, 404, { error: 'Proyecto no encontrado' });
      const f = path.join(PROJECTS, id, 'chat.json');
      if (M === 'GET') { try { return json(res, 200, JSON.parse(fs.readFileSync(f, 'utf8'))); } catch { return json(res, 200, {}); } }
      if (M === 'PUT') { const b = await body(req); JSON.parse(b.toString()); fs.writeFileSync(f, b); return json(res, 200, { ok: true }); }
    }
    if (p === '/api/claude/chat' && M === 'GET') return json(res, 200, { busy: !!chat.proc, found: !!findClaude() });
    // "Editar con Claude": abre Claude Code en una terminal, ya situado en la carpeta de datos (donde está CLAUDE.md)
    if (p === '/api/claude' && M === 'GET') return json(res, 200, { found: !!findClaude(), folder: path.normalize(WORK) });
    if (p === '/api/claude' && M === 'POST') {
      const exe = findClaude(); if (!exe) return json(res, 200, { ok: false, found: false, folder: path.normalize(WORK) });
      if (process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '"Claude · MojarraCut"', 'cmd', '/k', `"${exe}"`], { cwd: WORK, detached: true, windowsVerbatimArguments: true, stdio: 'ignore' }).unref();
      else if (process.platform === 'darwin') spawn('osascript', ['-e', `tell app "Terminal" to do script "cd ${JSON.stringify(WORK)} && ${JSON.stringify(exe)}"`], { detached: true, stdio: 'ignore' }).unref();
      else spawn('x-terminal-emulator', ['-e', exe], { cwd: WORK, detached: true, stdio: 'ignore' }).unref();
      return json(res, 200, { ok: true, found: true, folder: path.normalize(WORK) });
    }
    if (p === '/api/open-folder' && M === 'POST') { spawn('explorer', [url.searchParams.get('w') === 'media' ? MEDIA() : url.searchParams.get('w') === 'root' ? WORK : EXPORTS()], { detached: true }); return json(res, 200, { ok: true }); }
    if (p.startsWith('/media/')) { const f = inside(MEDIA(), p.slice(7)); return f ? serveFile(req, res, f) : (res.writeHead(403), res.end()); }
    if (p.startsWith('/exports/')) { const f = inside(EXPORTS(), p.slice(9)); return f ? serveFile(req, res, f) : (res.writeHead(403), res.end()); }
    const f = inside(PUBLIC, p === '/' ? 'index.html' : p.slice(1));
    return f ? serveFile(req, res, f) : (res.writeHead(403), res.end());
  } catch (e) { json(res, e.code === 409 ? 409 : 500, { error: e.message }); }
});
module.exports = new Promise((resolve) => {
  const go = (port) => server.once('error', (e) => { if (e.code === 'EADDRINUSE') go(port + 1); }).listen(port, '127.0.0.1', () => { portNow = port;
    console.log(`MojarraCut -> http://localhost:${port}  |  datos: ${WORK}  |  ffmpeg: ${FFMPEG || 'no'}`);
    resolve(port);
  });
  go(PORT);
});
