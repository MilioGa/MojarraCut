// MojarraCut — subtítulos: diseños, animación por palabra y conversión a ASS (libass) para exportar.
// Se usa en el visor (navegador) y en el servidor (Node), así el MP4 coincide con la vista previa.
(function (root) {
  const FONTS = ['Arial', 'Arial Black', 'Impact', 'Segoe UI', 'Verdana', 'Trebuchet MS', 'Georgia', 'Comic Sans MS', 'Courier New'];

  // Diseños listos. Al elegir uno se copian sus valores al estilo del clip (luego se pueden ajustar).
  const PRESETS = {
    clasico:  { name: 'Clásico',   style: { font: 'Arial', fontSize: 64, color: '#ffffff', bold: true, outline: 3, outlineColor: '#000000', background: null, uppercase: false, shadow: 0, glow: 0, highlight: '#ffd400', anim: 'none' } },
    caja:     { name: 'Caja',      style: { font: 'Arial', fontSize: 60, color: '#ffffff', bold: true, outline: 0, outlineColor: '#000000', background: '#000000', backgroundOpacity: 0.65, uppercase: false, shadow: 0, glow: 0, highlight: '#ffd400', anim: 'highlight' } },
    impacto:  { name: 'Impacto',   style: { font: 'Impact', fontSize: 92, color: '#ffffff', bold: false, outline: 6, outlineColor: '#000000', background: null, uppercase: true, shadow: 0, glow: 0, highlight: '#39ff6a', anim: 'pop' } },
    karaoke:  { name: 'Karaoke',   style: { font: 'Arial Black', fontSize: 66, color: '#ffffff', bold: false, outline: 4, outlineColor: '#1b1033', background: null, uppercase: false, shadow: 0, glow: 0, highlight: '#ff4fa3', anim: 'karaoke' } },
    marcador: { name: 'Marcador',  style: { font: 'Arial Black', fontSize: 70, color: '#ffffff', bold: false, outline: 4, outlineColor: '#000000', background: null, uppercase: true, shadow: 0, glow: 0, highlight: '#7c6cff', anim: 'marker' } },
    neon:     { name: 'Neón',      style: { font: 'Segoe UI', fontSize: 68, color: '#eafcff', bold: true, outline: 2, outlineColor: '#00d9ff', background: null, uppercase: false, shadow: 0, glow: 14, highlight: '#ff3df2', anim: 'highlight' } },
    aparecer: { name: 'Aparecer',  style: { font: 'Trebuchet MS', fontSize: 66, color: '#ffffff', bold: true, outline: 3, outlineColor: '#000000', background: null, uppercase: false, shadow: 3, glow: 0, highlight: '#ffffff', anim: 'reveal' } },
    tv:       { name: 'TV',        style: { font: 'Verdana', fontSize: 54, color: '#ffe14d', bold: true, outline: 3, outlineColor: '#000000', background: null, uppercase: false, shadow: 2, glow: 0, highlight: '#ffffff', anim: 'none' } },
    minimal:  { name: 'Minimal',   style: { font: 'Segoe UI', fontSize: 48, color: '#ffffff', bold: false, outline: 0, outlineColor: '#000000', background: null, uppercase: false, shadow: 4, glow: 0, highlight: '#9fd3ff', anim: 'none' } },
  };
  const ANIMS = [
    ['none', 'Sin animación'], ['highlight', 'Resaltar palabra'], ['pop', 'Saltar palabra (pop)'],
    ['karaoke', 'Karaoke (relleno)'], ['marker', 'Marcador de color'], ['reveal', 'Aparecer palabra a palabra'],
  ];

  // Texto → líneas → palabras (tokens). Cada token sabe su índice global para emparejarlo con la palabra hablada.
  function tokenize(text, upper) {
    let k = 0;
    return String(text || '').split('\n').map((ln) => ln.split(/\s+/).filter(Boolean).map((t) => ({ t: upper ? t.toLocaleUpperCase('es') : t, i: k++ })));
  }
  // Tiempos [s,e] (relativos al inicio del clip) de cada token. Usa clip.words si coinciden en número;
  // si no, los estima repartiendo la duración según el largo de cada palabra (funciona con subtítulos escritos a mano).
  function wordTimes(c) {
    const toks = tokenize(c.text).flat(), n = toks.length, D = Math.max(0.05, +c.duration || 1);
    if (!n) return [];
    if (Array.isArray(c.words) && c.words.length === n) return c.words.map((w) => [Math.max(0, +w.s || 0), Math.min(D, Math.max(+w.s || 0, +w.e || 0))]);
    const lens = toks.map((x) => x.t.length + 2), tot = lens.reduce((a, b) => a + b, 0);
    let acc = 0; return lens.map((l) => { const s = (acc / tot) * D; acc += l; return [s, (acc / tot) * D]; });
  }
  // Índice de la palabra activa en el tiempo local t (−1 antes de la primera)
  function activeWord(times, t) { let k = -1; for (let i = 0; i < times.length; i++) if (t >= times[i][0] - 0.001) k = i; return k; }

  // ---------- ASS (para el render con ffmpeg/libass) ----------
  const assColor = (hex, alpha = 0) => { const h = String(hex || '#ffffff').replace('#', '').padEnd(6, 'f'); const a = Math.round(Math.max(0, Math.min(255, alpha))).toString(16).padStart(2, '0'); return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase(); };
  const assTime = (t) => { t = Math.max(0, t); const cs = Math.round(t * 100), h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const assEsc = (s) => String(s).replace(/\\/g, '⧵').replace(/\{/g, '(').replace(/\}/g, ')');
  const FONT_K = 1.0; // ajuste de tamaño libass ↔ canvas

  function toASS(clips, W, H) {
    const head = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n`;
    const styles = [], events = [];
    clips.forEach((c, ci) => {
      const s = c.style || {}, size = Math.round((s.fontSize || 64) * FONT_K), op = c.opacity ?? 1, A = 255 * (1 - op);
      const box = !!s.background, outline = box ? Math.round(size * 0.28) : (s.outline ?? 3);
      const name = 'S' + ci;
      styles.push(`Style: ${name},${s.font || 'Arial'},${size},${assColor(s.color, A)},${assColor(s.color, A)},${assColor(box ? s.background : s.outlineColor || '#000000', box ? 255 * (1 - (s.backgroundOpacity ?? 0.6) * op) : A)},${assColor(s.glow ? s.outlineColor : '#000000', s.glow ? 120 : 110)},${s.bold === false ? 0 : -1},0,0,0,100,100,0,0,${box ? 3 : 1},${outline},${s.shadow || 0},2,10,10,10,1`);
      const pos = s.position === 'top' ? `\\an8\\pos(${W / 2 + (c.x || 0)},${Math.round(H * 0.08) + (c.y || 0)})` : s.position === 'center' ? `\\an5\\pos(${W / 2 + (c.x || 0)},${H / 2 + (c.y || 0)})` : `\\an2\\pos(${W / 2 + (c.x || 0)},${Math.round(H * 0.92) + (c.y || 0)})`;
      const glow = s.glow ? `\\blur${Math.max(1, Math.round(s.glow / 4))}` : '';
      const lines = tokenize(c.text, s.uppercase), times = wordTimes(c), anim = s.anim || 'none';
      const fi = Math.round((c.fadeIn || 0) * 1000), fo = Math.round((c.fadeOut || 0) * 1000);
      const ev = (a, b, body, first, last) => { if (b - a < 0.01) return; const fad = (first && fi) || (last && fo) ? `\\fad(${first ? fi : 0},${last ? fo : 0})` : ''; events.push(`Dialogue: ${ci},${assTime(c.start + a)},${assTime(c.start + b)},${name},,0,0,0,,{${pos}${glow}${fad}}${body}`); };
      const hx = (v) => '&H' + Math.round(v).toString(16).padStart(2, '0').toUpperCase() + '&';
      const a3 = box ? 255 * (1 - (s.backgroundOpacity ?? 0.6) * op) : A;
      const base = `\\1c${assColor(s.color)}\\3c${assColor(box ? s.background : s.outlineColor || '#000000')}\\bord${outline}\\fscx100\\fscy100\\1a${hx(A)}\\3a${hx(a3)}\\4a${hx(s.glow ? 120 : 110)}`;
      const hl = assColor(s.highlight || '#ffd400');
      if (anim === 'none' || !times.length) { ev(0, c.duration, lines.map((l) => l.map((w) => assEsc(w.t)).join(' ')).join('\\N'), true, true); return; }
      if (anim === 'karaoke') { // relleno progresivo palabra a palabra con \kf (Primary = ya cantado, Secondary = pendiente)
        let cur = 0; const body = lines.map((l) => l.map((w) => { const [a, b] = times[w.i]; let out = ''; if (a - cur > 0.01) out += `{\\k${Math.round((a - cur) * 100)}}`; out += `{\\kf${Math.max(1, Math.round((b - a) * 100))}}${assEsc(w.t)}`; cur = b; return out; }).join(' ')).join('\\N');
        events.push(`Dialogue: ${ci},${assTime(c.start)},${assTime(c.start + c.duration)},${name},,0,0,0,,{${pos}${glow}\\1c${hl}\\2c${assColor(s.color)}${fi || fo ? `\\fad(${fi},${fo})` : ''}}${body}`);
        return;
      }
      // Un evento por palabra activa (desde que empieza hasta que empieza la siguiente)
      const n = times.length, fmtLine = (k) => lines.map((l) => l.map((w) => {
        const t = assEsc(w.t);
        if (anim === 'reveal') return w.i > k ? `{\\alpha&HFF&}${t}{${base}}` : t;
        if (w.i !== k) return t;
        if (anim === 'highlight') return `{\\1c${hl}}${t}{${base}}`;
        if (anim === 'pop') return `{\\1c${hl}\\fscx112\\fscy112\\t(0,90,\\fscx122\\fscy122)\\t(90,180,\\fscx115\\fscy115)}${t}{${base}}`;
        if (anim === 'marker') return `{\\3c${hl}\\bord${Math.round(size * 0.22)}\\shad0}${t}{${base}}`;
        return t;
      }).join(' ')).join('\\N');
      if (times[0][0] > 0.03 && anim !== 'reveal') ev(0, times[0][0], fmtLine(-1), true, false);
      for (let k = 0; k < n; k++) ev(k === 0 && anim === 'reveal' ? Math.min(times[0][0], 0) : times[k][0], k + 1 < n ? times[k + 1][0] : c.duration, fmtLine(k), k === 0 && (times[0][0] <= 0.03 || anim === 'reveal'), k === n - 1);
    });
    return head + styles.join('\n') + `\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` + events.join('\n') + '\n';
  }

  const api = { FONTS, PRESETS, ANIMS, tokenize, wordTimes, activeWord, toASS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SUBS = api;
})(typeof window !== 'undefined' ? window : globalThis);
