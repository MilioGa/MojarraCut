// Genera el arte del instalador propio (build/setup/): fondos, botones y la animación del pez (AVI RLE8)
// para cada escala de pantalla (100–200 %). Uso: npx electron scripts/setup-art.js
const { app, BrowserWindow } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), { spawnSync } = require('child_process');
const OUT = path.join(__dirname, '..', 'build', 'setup');
const FF = require('ffmpeg-static');
const VERSION = require('../package.json').version;
const SCALES = [100, 125, 150, 175, 200];
// Medidas base (escala 100 %) — deben coincidir con setup.nsi
const L = { W: 640, H: 430, anim: [220, 30, 200, 128], btn: [210, 356, 220, 46], panel: [120, 266, 400, 64] };

// Todo se dibuja en canvas dentro de una página (misma tipografía que la app)
const PAGE = `<!doctype html><meta charset=utf-8><body style="margin:0"><script>
const L=${JSON.stringify(L)};
const BG='#15122e', PANEL='#221d45';
function rr(c,x,y,w,h,r){c.beginPath();c.moveTo(x+r,y);c.arcTo(x+w,y,x+w,y+h,r);c.arcTo(x+w,y+h,x,y+h,r);c.arcTo(x,y+h,x,y,r);c.arcTo(x,y,x+w,y,r);c.closePath();}
function rnd(seed){let r=seed;return()=>((r=(r*9301+49297)%233280)/233280);}
function bg(c,k){
  c.fillStyle=BG;c.fillRect(0,0,L.W,L.H);
  let g=c.createRadialGradient(0,0,0,0,0,215);g.addColorStop(0,'rgba(124,108,255,.55)');g.addColorStop(1,'rgba(124,108,255,0)');c.fillStyle=g;c.fillRect(0,0,L.W,L.H);
  g=c.createRadialGradient(L.W,L.H,0,L.W,L.H,300);g.addColorStop(0,'rgba(255,79,163,.28)');g.addColorStop(1,'rgba(255,79,163,0)');c.fillStyle=g;c.fillRect(0,0,L.W,L.H);
  c.strokeStyle='rgba(255,255,255,.07)';c.lineWidth=1.5;
  for(let i=0;i<3;i++){c.beginPath();for(let x=0;x<=L.W;x+=8)c.lineTo(x,L.H-28-i*14+Math.sin(x/70+i)*7);c.stroke();}
  const R=rnd(11),[ax,ay,aw,ah]=L.anim;
  for(let i=0;i<46;i++){const x=R()*L.W,y=R()*L.H,s=1+R()*3.2;if(x>ax-12&&x<ax+aw+12&&y>ay-12&&y<ay+ah+12)continue;if(y>150&&y<345&&x>90&&x<550)continue;c.fillStyle='rgba(255,255,255,'+(.12+R()*.4)+')';c.beginPath();c.arc(x,y,s,0,7);c.fill();}
}
function text(c,t,y,size,weight,color){c.font=weight+' '+size+'px "Segoe UI", Arial';c.fillStyle=color;c.textAlign='center';c.textBaseline='alphabetic';c.fillText(t,L.W/2,y);}
function panel(c){const [x,y,w,h]=L.panel;c.fillStyle=PANEL;rr(c,x,y,w,h,12);c.fill();c.strokeStyle='rgba(255,255,255,.08)';c.lineWidth=1;rr(c,x+.5,y+.5,w-1,h-1,12);c.stroke();}
function button(c,label){const [x,y,w,h]=L.btn;c.save();c.shadowColor='rgba(124,108,255,.55)';c.shadowBlur=18;c.shadowOffsetY=4;
  const g=c.createLinearGradient(x,y,x+w,y+h);g.addColorStop(0,'#9a8cff');g.addColorStop(1,'#6a58f2');c.fillStyle=g;rr(c,x,y,w,h,12);c.fill();c.restore();
  c.font='600 17px "Segoe UI", Arial';c.fillStyle='#fff';c.textAlign='center';c.textBaseline='middle';c.fillText(label,x+w/2,y+h/2+1);}
function page(kind,ver){
  const cv=document.createElement('canvas');return (k)=>{cv.width=L.W*k;cv.height=L.H*k;const c=cv.getContext('2d');c.scale(k,k);bg(c,k);
    if(kind==='welcome'){text(c,'MojarraCut',202,40,800,'#fff');text(c,'Versión '+ver,234,13,400,'#a9a2de');panel(c);}
    if(kind==='install'){text(c,'Instalando MojarraCut…',206,26,700,'#fff');text(c,'Esto solo tarda unos segundos',236,14,400,'#cfc9f7');}
    if(kind==='finish'){text(c,'¡Listo para crear!',202,32,800,'#fff');text(c,'Tus proyectos se guardarán en Documentos\\\\MojarraCut',232,14,400,'#d9d4ff');panel(c);}
    return {cv,c};};
}
window.render=(kind,k,label)=>{const {cv,c}=page(kind,'${VERSION}')(k);const full=cv.toDataURL('image/png');let btn=null;
  if(label){button(c,label);const [x,y,w,h]=L.btn,t=document.createElement('canvas');t.width=Math.round(w*k);t.height=Math.round(h*k);t.getContext('2d').drawImage(cv,Math.round(x*k),Math.round(y*k),t.width,t.height,0,0,t.width,t.height);btn=t.toDataURL('image/png');}
  return {full,btn};};
// Fotograma de la animación: el pez flota, mueve la cola y suelta burbujas (bucle perfecto)
window.frame=(i,n,k)=>{const [ax,ay,aw,ah]=L.anim,cv=document.createElement('canvas');cv.width=Math.round(aw*k);cv.height=Math.round(ah*k);const c=cv.getContext('2d');c.scale(k,k);
  c.fillStyle=BG;c.fillRect(0,0,aw,ah);const t=i/n,ph=t*Math.PI*2,cx=aw/2,cy=ah/2+Math.sin(ph)*6,S=86;
  for(let b=0;b<5;b++){const bt=(t+b/5)%1,bx=cx-S*0.36+Math.sin(bt*9+b)*6-14,by=cy-6-bt*70,r=2+bt*4;c.strokeStyle='rgba(200,192,255,'+(0.75*(1-bt))+')';c.lineWidth=1.4;c.beginPath();c.arc(bx,by,r,0,7);c.stroke();}
  c.save();c.translate(cx,cy);c.rotate(Math.sin(ph)*0.05);const s=S/256;c.scale(s,s);c.translate(-128,-128);
  c.shadowColor='rgba(124,108,255,.6)';c.shadowBlur=26;c.fillStyle='#7c6cff';rr(c,8,8,240,240,30);c.fill();c.shadowBlur=0;
  c.fillStyle='#fff';c.beginPath();c.ellipse(118,128,62,40,0,0,7);c.fill();
  const w=Math.sin(ph*2)*16;c.beginPath();c.moveTo(172,128);c.lineTo(214,86+w*0.6);c.lineTo(214,170-w*0.6);c.closePath();c.fill();
  c.fillStyle='#241a4a';c.beginPath();c.arc(92,120,8,0,7);c.fill();c.restore();
  return cv.toDataURL('image/png');};
</script>`;

const save = (dataUrl, file) => fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
const toBmp = (png, bmp) => { const r = spawnSync(FF, ['-y', '-v', 'error', '-i', png, '-pix_fmt', 'bgr24', bmp]); if (r.status) throw new Error(r.stderr.toString()); fs.unlinkSync(png); };

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-setup-'));
  const html = path.join(tmp, 'art.html'); fs.writeFileSync(html, PAGE);
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadFile(html); await new Promise((r) => setTimeout(r, 300));
  const N = 30;
  for (const s of SCALES) {
    const k = s / 100;
    for (const [kind, label] of [['welcome', 'Instalar'], ['install', null], ['finish', 'Terminar']]) {
      const r = await w.webContents.executeJavaScript(`render(${JSON.stringify(kind)},${k},${JSON.stringify(label)})`);
      save(r.full, path.join(tmp, 'a.png')); toBmp(path.join(tmp, 'a.png'), path.join(OUT, `${kind}_${s}.bmp`));
      if (r.btn) { save(r.btn, path.join(tmp, 'b.png')); toBmp(path.join(tmp, 'b.png'), path.join(OUT, `btn_${kind}_${s}.bmp`)); }
    }
    const fd = path.join(tmp, 'f' + s); fs.mkdirSync(fd);
    for (let i = 0; i < N; i++) save(await w.webContents.executeJavaScript(`frame(${i},${N},${k})`), path.join(fd, `${String(i).padStart(3, '0')}.png`));
    const r = spawnSync(FF, ['-y', '-v', 'error', '-framerate', '15', '-i', path.join(fd, '%03d.png'),
      '-vf', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full:reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-c:v', 'msrle', '-an', path.join(OUT, `anim_${s}.avi`)]);
    if (r.status) throw new Error(r.stderr.toString());
    console.log('escala', s, 'ok');
  }
  // icono .ico para el instalador y el desinstalador
  spawnSync(FF, ['-y', '-v', 'error', '-i', path.join(__dirname, '..', 'build', 'icon.png'), '-vf', 'scale=256:256', path.join(OUT, 'icon.ico')]);
  fs.rmSync(tmp, { recursive: true, force: true });
  app.quit();
});
