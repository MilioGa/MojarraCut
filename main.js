// MojarraCut — proceso principal de Electron (funciona 100% sin internet)
// `npm start` abre la app · `npm test` ejecuta las pruebas de heurísticas de Nielsen y escribe tests/reporte-nielsen.md
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const TEST = process.argv.includes('--test');
if (process.env.MOJARRA_DEV_DIR) app.setPath('userData', path.join(process.env.MOJARRA_DEV_DIR, '.electron')); // copia de desarrollo independiente
if (!TEST && !app.requestSingleInstanceLock()) app.quit();

const unpack = (p) => p && p.replace('app.asar', 'app.asar.unpacked');
// MOJARRA_DEV_DIR permite probar la app de escritorio con datos de desarrollo sin tocar Documentos
process.env.MOJARRA_DIR = TEST ? path.join(app.getPath('temp'), 'mojarracut-test') : process.env.MOJARRA_DEV_DIR || path.join(app.getPath('documents'), 'MojarraCut');
if (TEST) process.env.PORT = '5191';
try { process.env.MOJARRA_FFMPEG = unpack(require('ffmpeg-static')); } catch {}
try { process.env.MOJARRA_FFPROBE = unpack(require('ffprobe-static').path); } catch {}

// Un error inesperado no debe mostrar ventanas al usuario ni cerrar la app: se registra y se sigue
const logErr = (e) => { try { fs.appendFileSync(path.join(process.env.MOJARRA_DIR, 'errores.log'), `[${new Date().toISOString()}] ${e && e.stack || e}\n`); } catch {} };
process.on('uncaughtException', logErr); process.on('unhandledRejection', logErr);

let win;
app.whenReady().then(async () => {
  const port = await require('./server.js');
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1000, minHeight: 640, backgroundColor: '#0f1115',
    title: 'MojarraCut', icon: path.join(__dirname, 'build', 'icon.png'), show: false,
    // Una sola barra superior: la de la app, con los botones de ventana de Windows integrados
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#161921', symbolColor: '#e6e8ee', height: 48 },
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { if (!TEST) win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (_e, i) => { if (i.key === 'F12') win.webContents.toggleDevTools(); });
  if (TEST) {
    win.webContents.on('console-message', (_e, _lvl, msg) => {
      if (!msg.startsWith('NIELSEN_RESULT ')) return;
      const r = JSON.parse(msg.slice(15));
      const md = [`# Pruebas de usabilidad — 10 heurísticas de Nielsen`, '', `Fecha: ${r.date} · Resultado: **${r.passed}/${r.total}** comprobaciones superadas`, '',
        ...r.byH.flatMap((h) => [`## ${h.ok === h.total ? '✅' : '⚠️'} ${h.name} (${h.ok}/${h.total})`, '', ...h.rs.map((x) => `- ${x.pass ? '✔' : '✘'} ${x.name}${x.detail ? ` — ${x.detail}` : ''}`), ''])].join('\n');
      const out = path.join(__dirname, 'tests', 'reporte-nielsen.md');
      try { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, md); } catch {}
      console.log(`\nNielsen: ${r.passed}/${r.total}  ->  ${out}`);
      setTimeout(() => app.exit(r.passed === r.total ? 0 : 1), 1500);
    });
  }
  win.loadURL(`http://localhost:${port}${TEST ? '/?test=1' : ''}`);
});
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
