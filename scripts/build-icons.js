// Genera public/icons.js con iconos Lucide (ISC) embebidos -> funciona sin internet
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..', 'node_modules', 'lucide-static', 'icons');
const names = ['play','pause','skip-back','skip-forward','chevron-left','chevron-right','undo-2','redo-2','scissors','trash-2','copy','type','captions','file-down','file-up','plus','magnet','zoom-in','zoom-out','eye','eye-off','volume-2','volume-x','lock','lock-open','grip-vertical','grip-horizontal','film','image','music','folder-open','upload','download','keyboard','circle-help','rotate-ccw','x','crop','sparkles','arrow-left','layers','monitor','smartphone','square','clapperboard','ellipsis','pencil','check','triangle-alert','info','loader-circle','blend','move','house','layout-panel-left','search','clock','file-video','circle-check','circle-x','folder','external-link','sliders-horizontal','wand-sparkles','tv','arrow-up-down','folder-plus','clipboard-paste','sun','contrast','droplets','palette','aperture','circle-half','sun-dim','scan','mouse-pointer-2','box-select','corner-left-up','folder-input','audio-waveform','clipboard-copy','mic','languages','captions-off'];
const out = {};
for (const n of names) {
  const f = path.join(dir, n + '.svg');
  if (!fs.existsSync(f)) { console.warn('falta', n); continue; }
  out[n] = fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\s+/g, ' ').trim();
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'icons.js'),
  '// Iconos: Lucide (https://lucide.dev) — licencia ISC\nwindow.ICONS=' + JSON.stringify(out) + ';\n' +
  "window.icon=(n,s=16)=>`<svg class=\"i\" width=\"${s}\" height=\"${s}\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">${window.ICONS[n]||''}</svg>`;\n");
console.log(Object.keys(out).length, 'iconos');
