// Pruebas automáticas de usabilidad: 10 heurísticas de Nielsen.
// Se ejecutan dentro de la app real (?test=1, o `npm test` en Electron) sobre un proyecto temporal.
(async () => {
  const results = [];
  const H = ['1. Visibilidad del estado del sistema', '2. Relación con el mundo real', '3. Control y libertad del usuario', '4. Consistencia y estándares', '5. Prevención de errores', '6. Reconocer antes que recordar', '7. Flexibilidad y eficiencia de uso', '8. Diseño estético y minimalista', '9. Ayudar a reconocer y recuperarse de errores', '10. Ayuda y documentación'];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const q = (s) => document.querySelector(s), qa = (s) => [...document.querySelectorAll(s)];
  const key = (k, o = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k, bubbles: true, ...o }));
  const toastText = () => q('#toast').classList.contains('show') ? q('#toast').textContent : '';
  async function check(h, name, fn) {
    let pass = false, detail = '';
    try { const r = await fn(); pass = r === true || (r && r.pass); detail = (r && r.detail) || ''; } catch (e) { detail = 'Excepción: ' + e.message; }
    results.push({ h, name, pass, detail });
  }
  const closeAll = async () => { if (!q('#modal').classList.contains('hidden')) { key('Escape'); await wait(80); } };

  // ---------- preparar proyecto de prueba con medios generados ----------
  const pr = await (await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Prueba Nielsen', width: 1920, height: 1080 }) })).json();
  await MC.openProject(pr.id);
  const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const g = cv.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 640, 360); grd.addColorStop(0, '#7c6cff'); grd.addColorStop(1, '#14b8a6'); g.fillStyle = grd; g.fillRect(0, 0, 640, 360);
  const png = await new Promise((r) => cv.toBlob(r, 'image/png'));
  const sr = 22050, n = sr * 3, wav = new DataView(new ArrayBuffer(44 + n * 2));
  const ws = (o, s) => [...s].forEach((c, i) => wav.setUint8(o + i, c.charCodeAt(0)));
  ws(0, 'RIFF'); wav.setUint32(4, 36 + n * 2, true); ws(8, 'WAVEfmt '); wav.setUint32(16, 16, true); wav.setUint16(20, 1, true); wav.setUint16(22, 1, true); wav.setUint32(24, sr, true); wav.setUint32(28, sr * 2, true); wav.setUint16(32, 2, true); wav.setUint16(34, 16, true); ws(36, 'data'); wav.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) wav.setInt16(44 + i * 2, Math.sin(i / 10) * 6000, true);
  const emptyMediaMsg = q('#mediaList').textContent;
  const stageHintVisible = !q('#stageHint').classList.contains('hidden');
  await fetch('/api/upload?name=prueba.png', { method: 'POST', body: png });
  await fetch('/api/upload?name=tono.wav', { method: 'POST', body: new Blob([wav.buffer], { type: 'audio/wav' }) });
  await wait(1800);

  // ===== H1 Visibilidad del estado =====
  await check(1, 'Indicador de guardado pasa de “Guardando…” a “Guardado”', async () => {
    MC.addMediaAt('prueba.png', null, 0); const a = q('#saveState').textContent; await wait(900); const b = q('#saveState').textContent;
    return { pass: /Guardando/.test(a) && /Guardado/.test(b), detail: `“${a.trim()}” → “${b.trim()}”` };
  });
  await check(1, 'El código de tiempo refleja la posición del cursor', async () => { MC.setTime(2.5); return { pass: q('#tcNow').textContent === '00:02.50', detail: q('#tcNow').textContent }; });
  await check(1, 'La selección se resalta en el timeline y en Propiedades', async () => {
    const id = MC.project.tracks.flatMap((t) => t.clips)[0].id; MC.select('clip', id); await wait(50);
    return { pass: !!q(`.clip.sel[data-id="${id}"]`) && /Clip/.test(q('#propsKind').textContent), detail: q('#propsKind').textContent };
  });
  await check(1, 'Se muestra el estado de conexión con Claude', () => ({ pass: /conectado/i.test(q('#claudeState').textContent), detail: q('#claudeState').textContent.trim() }));

  // ===== H2 Mundo real =====
  await check(2, 'Vocabulario de edición en español (Cortar, Línea de tiempo, Exportar, Subtítulo)', () => { const t = document.body.innerText; const w = ['Cortar', 'Línea de tiempo', 'Exportar', 'Subtítulo', 'Medios', 'Propiedades']; const miss = w.filter((x) => !t.includes(x)); return { pass: !miss.length, detail: miss.length ? 'Faltan: ' + miss.join(', ') : w.join(', ') }; });
  await check(2, 'Formatos nombrados por plataforma (YouTube, TikTok…)', async () => { MC.select(null); await wait(30); const t = q('#inspector').innerText; return { pass: /YouTube/.test(t) && /TikTok/.test(t), detail: 'Selector de formato del proyecto' }; });
  await check(2, 'Tiempos en formato mm:ss.cc y duraciones en segundos', () => ({ pass: /^\d\d:\d\d\.\d\d$/.test(q('#tcTotal').textContent), detail: q('#tcTotal').textContent }));

  // ===== H3 Control y libertad =====
  await check(3, 'Deshacer revierte una acción y Rehacer la restaura', async () => {
    const n0 = MC.project.tracks.flatMap((t) => t.clips).length; MC.addText('hola'); await wait(50); const n1 = MC.project.tracks.flatMap((t) => t.clips).length;
    key('z', { ctrlKey: true }); await wait(50); const n2 = MC.project.tracks.flatMap((t) => t.clips).length;
    key('y', { ctrlKey: true }); await wait(50); const n3 = MC.project.tracks.flatMap((t) => t.clips).length;
    return { pass: n1 === n0 + 1 && n2 === n0 && n3 === n1, detail: `${n0} → ${n1} → deshacer ${n2} → rehacer ${n3}` };
  });
  await check(3, 'Esc cierra los diálogos', async () => { key('?'); await wait(60); const open = !q('#modal').classList.contains('hidden'); key('Escape'); await wait(60); return open && q('#modal').classList.contains('hidden'); });
  await check(3, 'Eliminar un clip ofrece “Deshacer” en el aviso', async () => {
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.text); MC.select('clip', c.id); key('Delete'); await wait(60);
    const ok = /Deshacer/.test(toastText()); MC.undo(); return { pass: ok, detail: toastText() };
  });
  await check(3, 'La exportación tiene botón para cancelar', async () => { q('#btnExport').click(); await wait(80); const ok = !!q('#exCancel'); await closeAll(); return ok; });
  await check(3, 'Siempre se puede volver al menú de proyectos', () => !!q('#btnHome') && q('#btnHome').offsetParent !== null);

  // ===== H4 Consistencia =====
  await check(4, 'Todos los botones de icono tienen título o etiqueta accesible', () => { const bad = qa('#editor button').filter((b) => b.offsetParent && !b.textContent.trim() && !b.title && !b.getAttribute('aria-label')); return { pass: !bad.length, detail: bad.length ? bad.length + ' sin etiqueta' : qa('#editor button').length + ' botones revisados' }; });
  await check(4, 'Iconos vectoriales consistentes (sin emojis en la interfaz)', () => { const emo = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u; const bad = qa('button,label,.ptitle').filter((e) => e.offsetParent && emo.test(e.textContent)); return { pass: !bad.length, detail: `${qa('svg.i').length} iconos SVG; ${bad.length} con emoji` }; });
  await check(4, 'Un único estilo de botón primario visible por pantalla', () => { const p = qa('.btn.primary').filter((b) => b.offsetParent); return { pass: p.length === 1, detail: p.map((b) => b.textContent.trim()).join(', ') }; });
  await check(4, 'La tecla Supr elimina cualquier tipo de selección (clip/pista)', async () => {
    const tr = MC.project.tracks.find((t) => !t.clips.length); MC.select('track', tr.id); key('Delete'); await wait(60);
    return { pass: !MC.project.tracks.includes(tr) || !MC.project.tracks.find((t) => t.id === tr.id), detail: 'Pista vacía eliminada con Supr' };
  });

  // ===== H5 Prevención de errores =====
  await check(5, 'Impide solapar clips en la misma pista', async () => {
    const t = MC.project.tracks.find((x) => x.clips.some((c) => c.src === 'prueba.png'));
    const c1 = t.clips[0]; MC.addMediaAt('prueba.png', t.id, c1.start + c1.duration); await wait(50);
    const c2 = t.clips[1]; MC.select('clip', c2.id); await wait(50);
    const inp = qa('#inspector .field').find((f) => /Inicio/.test(f.textContent)).querySelector('input');
    inp.value = c1.start + 1; inp.dispatchEvent(new Event('change')); await wait(50);
    return { pass: c2.start === c1.start + c1.duration && /solapar/i.test(toastText()), detail: toastText() };
  });
  await check(5, 'Pide confirmación antes de borrar una pista con clips', async () => {
    const t = MC.project.tracks.find((x) => x.clips.length); MC.select('track', t.id); key('Delete'); await wait(80);
    const ok = !q('#modal').classList.contains('hidden') && /Eliminar/.test(q('#modalCard').textContent); await closeAll();
    return { pass: ok && MC.project.tracks.includes(t), detail: 'Diálogo de confirmación mostrado; la pista sigue intacta' };
  });
  await check(5, 'Acciones no aplicables aparecen deshabilitadas', async () => { MC.select(null); await wait(30); return { pass: q('#btnDup').disabled && q('#btnDelete').disabled && q('#btnTrans').disabled, detail: 'Duplicar / Eliminar / Transición sin selección' }; });
  await check(5, 'Valores numéricos fuera de rango se corrigen al límite', async () => {
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.src === 'prueba.png'); MC.select('clip', c.id); await wait(30);
    const inp = qa('#inspector .field').find((f) => /Fundido imagen salida/.test(f.textContent)).querySelector('input');
    inp.value = 999; inp.dispatchEvent(new Event('change')); await wait(50);
    return { pass: c.fadeOut <= c.duration, detail: `fundido=${c.fadeOut} (máx ${c.duration})` };
  });

  // ===== H6 Reconocer antes que recordar =====
  await check(6, 'Las herramientas muestran su atajo en el tooltip', () => { const b = ['#btnSplit', '#btnDelete', '#btnDup', '#btnAddText', '#btnUndo', '#btnPlay']; const miss = b.filter((s) => !/\(.+\)/.test(q(s).title)); return { pass: !miss.length, detail: miss.length ? 'Sin atajo: ' + miss.join(', ') : b.length + ' herramientas con atajo visible' }; });
  await check(6, 'Los medios muestran miniatura, tipo y duración', async () => { await wait(300); const it = qa('.media-item'); const ok = it.length >= 2 && it.every((x) => x.querySelector('.badge') && x.querySelector('.media-meta .d').textContent.trim()); return { pass: ok, detail: it.map((x) => x.querySelector('.badge').textContent + ': ' + x.querySelector('.media-meta .d').textContent).join(' · ') }; });
  await check(6, 'Propiedades contextuales según lo seleccionado', async () => {
    const t = MC.project.tracks.flatMap((x) => x.clips).find((c) => c.src === 'prueba.png'); MC.select('clip', t.id); await wait(30); const a = q('#inspector').innerText;
    MC.select('media', 'tono.wav'); await wait(30); const b = q('#inspector').innerText;
    return { pass: /Recorte/i.test(a) && /Transición/i.test(a) && /Información/i.test(b), detail: 'Imagen → Recorte/Transición; medio → Información' };
  });
  await check(6, 'Las transiciones se eligen viendo una vista previa visual', async () => {
    const t = MC.project.tracks.flatMap((x) => x.clips).find((c) => c.src === 'prueba.png'); MC.select('clip', t.id); await wait(30);
    const o = qa('#inspector .trans-opt'); return { pass: o.length >= 9 && o.every((x) => x.querySelector('.trans-prev')), detail: o.length + ' opciones con miniatura' };
  });

  // ===== H7 Flexibilidad y eficiencia =====
  await check(7, 'Atajo S corta el clip bajo el cursor', async () => {
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.src === 'prueba.png'); MC.select('clip', c.id); MC.setTime(c.start + 1); const n0 = MC.project.tracks.flatMap((t) => t.clips).length;
    key('s'); await wait(50); const n1 = MC.project.tracks.flatMap((t) => t.clips).length; return { pass: n1 === n0 + 1, detail: `${n0} → ${n1} clips` };
  });
  await check(7, 'Los paneles se pueden redimensionar', async () => {
    const sp = q('.splitter[data-split="0"]'), r = sp.getBoundingClientRect(), w0 = MC.layout.c0;
    sp.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 2, clientY: r.top + 50, pointerId: 1, bubbles: true }));
    sp.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 62, clientY: r.top + 50, pointerId: 1, bubbles: true }));
    sp.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 62, clientY: r.top + 50, pointerId: 1, bubbles: true }));
    await wait(50); return { pass: MC.layout.c0 > w0, detail: `${w0}px → ${MC.layout.c0}px` };
  });
  await check(7, 'Los paneles se pueden intercambiar arrastrando su título', async () => {
    const h = q('#p-media .panel-head'), r = h.getBoundingClientRect(), dst = q('.slot[data-slot="2"]').getBoundingClientRect();
    h.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 60, clientY: r.top + 15, button: 0, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: dst.left + 50, clientY: dst.top + 80 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: dst.left + 50, clientY: dst.top + 80 }));
    await wait(80); const ok = MC.layout.slots[2] === 'media'; const s = MC.layout.slots.join(' / '); MC.resetLayout(); await wait(50);
    return { pass: ok, detail: s };
  });
  await check(7, 'Las pistas se reordenan arrastrando el asa', async () => {
    const before = MC.project.tracks.map((t) => t.id); const g0 = qa('.track-head .tgrip')[0], h = qa('.track-head')[0].offsetHeight, r = g0.getBoundingClientRect();
    g0.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + 3, clientY: r.top + 3, bubbles: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: r.left + 3, clientY: r.top + h * 2.2 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + 3, clientY: r.top + h * 2.2 }));
    await wait(60); const after = MC.project.tracks.map((t) => t.id); return { pass: after[0] !== before[0] && after.length === before.length, detail: `1ª pista: ${before[0]} → ${after[0]}` };
  });
  await check(7, 'Atajo T crea un subtítulo y Ctrl+D duplica', async () => { const n0 = MC.project.tracks.flatMap((t) => t.clips).length; key('t'); await wait(50); document.activeElement.blur(); key('d', { ctrlKey: true }); await wait(50); const n1 = MC.project.tracks.flatMap((t) => t.clips).length; return { pass: n1 === n0 + 2, detail: `${n0} → ${n1}` }; });

  // ===== H8 Estética y minimalismo =====
  await check(8, 'Clips de audio no muestran opciones visuales irrelevantes', async () => {
    MC.addMediaAt('tono.wav', null, 0); await wait(60); const t = q('#inspector').innerText;
    return { pass: !/Transformación|Recorte|TRANSFORMACIÓN|RECORTE/.test(t) && /Audio|AUDIO/.test(t), detail: 'Audio: solo Tiempo, Audio y Acciones' };
  });
  await check(8, 'Sin desbordamiento horizontal de la ventana', () => ({ pass: document.documentElement.scrollWidth <= innerWidth, detail: `${document.documentElement.scrollWidth}px / ${innerWidth}px` }));
  await check(8, 'Barra superior con pocas acciones (≤ 10 controles visibles)', () => { const n = qa('.topbar button, .topbar input').filter((b) => b.offsetParent).length; return { pass: n <= 10, detail: n + ' controles' }; });

  // ===== H9 Recuperarse de errores =====
  await check(9, 'Los errores del motor se muestran en lenguaje claro', async () => { try { await fetch('/api/projects/no-existe/open', { method: 'POST' }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); }); } catch (e) { return { pass: /no existe/i.test(e.message), detail: e.message }; } return false; });
  await check(9, 'Entrada inválida explica qué hacer y no rompe el valor', async () => {
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.src === 'prueba.png'); MC.select('clip', c.id); await wait(30);
    const inp = qa('#inspector .field').find((f) => /Duración/.test(f.textContent)).querySelector('input'); const d0 = c.duration;
    inp.value = ''; inp.dispatchEvent(new Event('change')); await wait(50);
    return { pass: c.duration === d0 && /número/.test(toastText()), detail: toastText() };
  });
  await check(9, 'Los avisos de error se distinguen visualmente', () => ({ pass: q('#toast').classList.contains('error'), detail: 'Aviso con estilo de error e icono' }));
  await check(9, 'Borrar un proyecto es recuperable (papelera + Deshacer)', async () => {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Temporal"}' }).then((x) => x.json());
    const d = await fetch(`/api/projects/${r.id}`, { method: 'DELETE' }).then((x) => x.json());
    const back = await fetch(`/api/trash/${d.trashId}/restore`, { method: 'POST' }).then((x) => x.json());
    const ok = !!back.id; await fetch(`/api/projects/${back.id}`, { method: 'DELETE' });
    return { pass: ok, detail: 'Eliminado → restaurado desde la papelera' };
  });

  // ===== H10 Ayuda y documentación =====
  await check(10, 'La tecla ? abre la ayuda con la lista de atajos', async () => { key('?'); await wait(60); const n = qa('#modalCard .kbd').length; await closeAll(); return { pass: n >= 8, detail: n + ' atajos documentados' }; });
  await check(10, 'Estados vacíos con instrucciones', () => ({ pass: /Importa/.test(emptyMediaMsg) && stageHintVisible, detail: 'Medios vacíos y visor vacío explican qué hacer' }));
  await check(10, 'Propiedades del proyecto explican cómo trabajar con Claude', async () => { MC.select(null); await wait(30); return /Claude/.test(q('#inspector').innerText); });
  await check(10, 'Ayuda accesible desde el menú de proyectos', () => !!q('#hHelp'));

  // ===== v1.2 =====
  const all = () => MC.project.tracks.flatMap((t) => t.clips);
  await check(7, 'Copiar y pegar (Ctrl+C / Ctrl+V) duplica la selección', async () => { const c = all()[0]; MC.select('clip', c.id); key('c', { ctrlKey: true }); key('v', { ctrlKey: true }); await wait(60); const n = all().length; MC.undo(); return { pass: n === all().length + 1, detail: 'pegado y deshecho' }; });
  await check(7, 'Ctrl+A selecciona todos los clips', async () => { key('a', { ctrlKey: true }); await wait(30); const ok = MC.multi.size === all().length; MC.select(null); return ok; });
  await check(4, 'Clic derecho en encabezado de pista ofrece Eliminar', async () => { q('.track-head').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 500 })); await wait(40); const ok = /Eliminar pista/.test(document.body.innerText); key('Escape'); document.body.click(); await wait(40); return ok; });
  await check(3, 'Se puede ocultar una ventana y volver a mostrarla', async () => { const b = q('#p-media .phide'); b.click(); await wait(40); const hid = !q('#p-media').offsetParent; MC.resetLayout(); await wait(40); return { pass: hid && !!q('#p-media').offsetParent, detail: 'Medios oculto → restablecido' }; });
  await check(6, 'Carpetas en el panel de medios', async () => { const n = MC.project.bin.folders.length; const p = MC.newFolder(); await wait(80); const inp = q('#modalCard input'); if (inp) { inp.value = 'Pruebas'; inp.dispatchEvent(new Event('input')); } const btn = qa('#modalCard button').find((b) => /Crear/.test(b.textContent)); btn && btn.click(); await Promise.race([p, wait(500)]); await wait(80); return { pass: MC.project.bin.folders.length === n + 1, detail: 'carpeta creada desde el diálogo' }; });

  await check(6, 'Galería visual de diseños de subtítulo (reconocer, no recordar)', async () => {
    MC.addText('Hola mundo prueba'); await wait(60); const n = qa('#inspector .sub-card').length;
    qa('#inspector .sub-card').find((b) => /Karaoke/.test(b.textContent)).click(); await wait(60);
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.id === MC.sel.id);
    return { pass: n >= 6 && c.style.anim === 'karaoke', detail: `${n} diseños; elegido Karaoke` };
  });
  await check(1, 'La animación sigue la palabra que se escucha', async () => {
    const c = MC.project.tracks.flatMap((t) => t.clips).find((x) => x.id === MC.sel.id); c.words = [{ s: 0, e: 0.5 }, { s: 0.5, e: 1 }, { s: 1, e: 2 }];
    const tm = SUBS.wordTimes(c); return { pass: SUBS.activeWord(tm, 0.7) === 1 && /\\kf/.test(SUBS.toASS([c], 1920, 1080)), detail: 'palabra activa correcta y exportación karaoke' };
  });

  // ---------- limpiar ----------
  await MC.showHome();
  await fetch(`/api/projects/${pr.id}`, { method: 'DELETE' });

  // ---------- informe ----------
  const passed = results.filter((r) => r.pass).length;
  const byH = H.map((name, i) => { const rs = results.filter((r) => r.h === i + 1); return { name, total: rs.length, ok: rs.filter((r) => r.pass).length, rs }; });
  window.__NIELSEN = { passed, total: results.length, byH, date: new Date().toISOString() };
  console.log('NIELSEN_RESULT ' + JSON.stringify(window.__NIELSEN));
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:30px;z-index:200;background:#161921;border:1px solid #2a2f3a;border-radius:14px;padding:22px;overflow:auto;font:13px Segoe UI;color:#e6e8ee;box-shadow:0 20px 60px #000c';
  box.innerHTML = `<h2 style="margin:0 0 4px">Pruebas de las 10 heurísticas de Nielsen</h2><p style="color:#8f97a8;margin:0 0 14px">${passed} de ${results.length} comprobaciones superadas</p>` +
    byH.map((h) => `<h3 style="margin:14px 0 6px">${h.ok === h.total ? '✅' : '⚠️'} ${h.name} <span style="color:#8f97a8;font-weight:400">(${h.ok}/${h.total})</span></h3>` + h.rs.map((r) => `<div style="padding:3px 0 3px 22px;color:${r.pass ? '#e6e8ee' : '#fca5a5'}">${r.pass ? '✔' : '✘'} ${r.name}${r.detail ? ` <span style="color:#8f97a8">— ${String(r.detail).replace(/</g, '&lt;')}</span>` : ''}</div>`).join('')).join('') +
    '<p><button onclick="this.closest(\'div\').remove()" style="margin-top:14px;padding:8px 14px;border-radius:8px;border:0;background:#7c6cff;color:#fff;cursor:pointer">Cerrar</button></p>';
  document.body.append(box);
})();
