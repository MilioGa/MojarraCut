// Empaqueta dist/win-unpacked con el instalador propio (build/setup.nsi) → dist/MojarraCut Setup <versión>.exe
// Requiere: `electron-builder --win dir` y `electron scripts/setup-art.js` antes.
const path = require('path'), fs = require('fs'), { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const VERSION = require('../package.json').version;
const SRC = path.join(ROOT, 'dist', 'win-unpacked');
const OUT = path.join(ROOT, 'dist', `MojarraCut Setup ${VERSION}.exe`);
const ART = path.join(ROOT, 'build', 'setup');
const cache = path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache', 'nsis');
const nsisDir = fs.existsSync(cache) && fs.readdirSync(cache).filter((d) => /^nsis-\d/.test(d)).sort().pop();
if (!nsisDir) throw new Error('No encuentro makensis (ejecuta electron-builder una vez para descargarlo)');
const makensis = path.join(cache, nsisDir, 'Bin', 'makensis.exe');
const resDir = fs.readdirSync(cache).filter((d) => /^nsis-resources/.test(d)).sort().pop();
const plugins = resDir ? path.join(cache, resDir, 'plugins', 'x86-unicode') : '';
if (!fs.existsSync(path.join(SRC, 'MojarraCut.exe'))) throw new Error('Falta dist/win-unpacked: ejecuta electron-builder --win dir');
if (!fs.existsSync(path.join(ART, 'anim_100.avi'))) throw new Error('Falta el arte: ejecuta electron scripts/setup-art.js');
const r = spawnSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${VERSION}`, `-DSRC=${SRC}`, `-DOUTFILE=${OUT}`, `-DART=${ART}`, `-DPLUGINS=${plugins}`, path.join(ROOT, 'build', 'setup.nsi')], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status || 1);
console.log('Instalador:', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1) + ' MB');
