/* Live preview and timeline ("Preview & edit" card). Plays a small copy of the video with everything the finished video gets:
 * lyrics with their animation (lib/anim.js, the same code the builder runs), her name, the opening and end cards (drawn by the
 * builder's own code on the server), interlude pictures with filters, motion and transitions (lib/fx.js, checked against ffmpeg
 * by tools/check_preview.py). The timing comes from the server's plan of the video (/api/plan), the same plan the builder uses.
 * Lyric screens and interludes are moved on the timeline by dragging. Works on the page's settings S (unsaved changes included).
 */
const ED = {
  out: 'instagram', plan: null, planKey: '', vid: null, gl: null, stage: null, imgs: {}, peaks: null, proxy: null,
  sel: null, pxs: 0, scroll: 0, drag: null, raf: 0, lastScreen: null, planT: null, open: false, err: '', thumbs: {}
};
const $e = id => document.getElementById(id);

// ---------- look, as the builder computes it (pipeline.look_for + the output's own look) ----------
const TELUGU_ONLY = new Set(FONTS.telugu.map(f => f[0]));
function edLook() {
  const L = Object.assign({}, S.config.look);
  if (S.config.language === 'hindi' && TELUGU_ONLY.has(L.lyrics_font)) L.lyrics_font = 'Noto Sans Devanagari';
  return Object.assign(L, (S.config.outputs[ED.out] || {}).look || {});
}
function edOutCfg() { return S.config.outputs[ED.out]; }

// ---------- plan from the server ----------
function edRefreshSoon(ms) { if (!ED.open) return; clearTimeout(ED.planT); ED.planT = setTimeout(edLoadPlan, ms == null ? 350 : ms); }
async function edLoadPlan() {
  if (!S || !ED.open) return;
  if (ED.drag && ED.drag.moved) { edRefreshSoon(); return; }     // not while something is being dragged: it would jump
  const body = JSON.stringify({ config: S.config, credits: S.credits, lyrics: S.lyrics });
  if (body + ED.out === ED.planKey && ED.plan) return;
  ED.planKey = body + ED.out;
  try {
    const p = await api(`/api/plan?name=${encodeURIComponent(S.name)}&output=${ED.out}`, { method: 'POST', body });
    if (body + ED.out !== ED.planKey) return;                 // a newer change is on its way
    ED.plan = p; ED.err = p.ready ? '' : p.why;
  } catch (e) { ED.err = 'The preview could not be worked out: ' + e.message; ED.plan = null; }
  if (ED.plan && ED.plan.ready) { edSizeStage(); edLoadImages(); if (ED.imgs[ED.plan.logo] && ED.imgs[ED.plan.logo].ok) { ED.logoLive = false; edLogo(); } }
  const typing = document.activeElement && document.activeElement.closest && document.activeElement.closest('#edPanel') && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  edMsg(); if (!typing) edPanel(); edDrawTL();      // never redraw the panel under the person typing in it
}
function edLoadImages() {
  const want = [ED.plan.logo];
  ED.plan.pics.forEach(p => { if (p.url) want.push(p.url); (p.parts || []).forEach(q => want.push(q.url)); });
  want.forEach(u => {
    if (ED.imgs[u]) return;
    ED.imgs[u] = { ok: false };
    loadPicture(u).then(im => { ED.imgs[u] = { im, ok: true }; if (u === ED.plan.logo) { ED.logoLive = false; edLogo(); } edDrawTL(); }, () => { ED.imgs[u].err = true; });
  });
}
// a picture's colours as they are stored, without the browser's colour management: the builder reads pictures that way
// (snapshots of a phone's HDR video carry HDR colour marks that Chrome would otherwise apply; measured 8 apart on 0-255)
async function loadPicture(u) {
  const b = await (await fetch(u)).blob();
  return createImageBitmap(b, { colorSpaceConversion: 'none' });
}

// ---------- the preview copy of the video ----------
async function edProxy(start) {
  let st;
  try { st = await api('/api/proxy?name=' + encodeURIComponent(S.name), start ? { method: 'POST', body: '{}' } : undefined); } catch (e) { return; }
  ED.proxy = st;
  if (st.state === 'ready') {
    if (ED.vid.dataset.src !== st.url) { const t = ED.vid.currentTime || 0; ED.vid.dataset.src = st.url; ED.vid.src = st.url; ED.vid.currentTime = t; }
    if (!ED.peaks || ED.peaks.url !== st.peaks) { try { const j = await (await fetch(st.peaks)).json(); ED.peaks = { url: st.peaks, ...j }; } catch (e) {} }
  } else if (st.state === 'none' && !start) { return edProxy(true); }
  else if (st.state === 'working' || st.state === 'none') { setTimeout(() => ED.open && edProxy(false), 1500); }
  edMsg(); edDrawTL();
}

// ---------- stage ----------
function edSizeStage() {
  const P = ED.plan, side = P.layout.mode === 'side';
  // as tall as the window allows with the timeline still in view (the whole editor on one screen)
  const box = $e('edStage'), ar = P.size[0] / P.size[1];
  const room = innerHeight - tlH() - (ED.full ? 150 : 205), cardW = $e('s0').clientWidth - 156 - 60;
  let h = Math.max(300, Math.min(side ? 560 : 860, room)), w = Math.round(h * ar);
  const maxW = side ? cardW * 0.62 : cardW * 0.5;
  if (w > maxW) { w = Math.round(maxW); h = Math.round(w / ar); }
  box.style.width = w + 'px'; box.style.height = h + 'px';
  // measure: the card from its top to the timeline's bottom must fit in the window; shrink the picture by what is over
  const over = $e('edTLWrap').getBoundingClientRect().bottom - $e('s0').getBoundingClientRect().top - innerHeight + (ED.full ? 12 : 24);
  if (over > 0 && h - over >= 300) { h = Math.round(h - over); w = Math.round(h * ar); }
  $e('edPanel').style.maxHeight = (h + 56) + 'px';
  $e('edLeft').style.width = Math.max(w, 336) + 'px';             // as wide as the picture, with room for the play controls on one line
  box.style.width = w + 'px'; box.style.height = h + 'px';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const base = $e('edBase'); base.width = Math.round(w * dpr); base.height = Math.round(h * dpr);
  const pw = side ? P.wl / P.size[0] : 1, gw = Math.round(w * pw);
  const gl = $e('edGL'); gl.style.width = gw + 'px'; gl.style.height = h + 'px';
  if (gl.width !== Math.round(gw * dpr) || gl.height !== Math.round(h * dpr)) { gl.width = Math.round(gw * dpr); gl.height = Math.round(h * dpr); if (ED.stage) ED.stage.forget(); }
  ED.panel = ED.panel || document.createElement('canvas'); ED.panel.width = gl.width; ED.panel.height = gl.height;
  ED.small = ED.small || document.createElement('canvas');
  const ov = $e('edOver'), cw = P.canvas[0], ch = P.canvas[1];
  ov.style.width = gw + 'px'; ov.style.height = h + 'px';
  const inner = $e('edInner'); inner.style.width = cw + 'px'; inner.style.height = ch + 'px'; inner.style.transform = `scale(${gw / cw})`;
  ED.lastScreen = null; edLogo();
}
// her name: the picture the builder draws (plan.logo); while it is being dragged, a typed copy follows the pointer until the
// server has drawn it in its new place (the builder always writes the name, also when a logo picture is uploaded)
function edLogo(live) {
  if (!ED.plan) return;
  if (live) ED.logoLive = true;
  const L = edLook(), lg = ED.imgs[ED.plan.logo];
  const typed = logoHtml(Object.assign({}, L, { logo_mode: 'text', logo_size: L.logo_size * ED.plan.canvas[0] / 1080 }));
  if (!ED.logoLive && lg && lg.ok)      // the drawn name, plus an invisible typed copy that tells where the name is for dragging
    $e('edLogo').innerHTML = `<div id="edLogoHit" style="opacity:0">${typed}</div><img src="${ED.plan.logo}" style="position:absolute;left:0;top:0;width:100%;height:100%">`;
  else $e('edLogo').innerHTML = `<div id="edLogoHit">${typed}</div>`;
}

function coverDraw(g, src, sw, sh, x, y, w, h, fy) {
  const k = Math.max(w / sw, h / sh), dw = sw * k, dh = sh * k;
  g.drawImage(src, x + (w - dw) / 2, y + (h - dh) * (fy == null ? .5 : fy), dw, dh);
}
// her video as the builder lays it out (render.compose): 9:16 = blurred, darker copy behind the video fitted to the width;
// side by side = a blurred copy on the left (the panel), her video filling the right. The blur is the builder's (plan.bg_blur,
// a share of the width) and the darkening subtracts like its eq=brightness=-0.25 (the #edDim filter in the page)
function edVideoSrc(t) {
  const v = ED.vid, c = edClipAt(t);
  if (!c || c.plain) return v;
  if (!ED.vstage) { const cv = document.createElement('canvas'); try { ED.vstage = new FX.Stage(cv); } catch (e) { return v; } }
  const st = ED.vstage;
  if (st.cv.width !== v.videoWidth || st.cv.height !== v.videoHeight) { st.cv.width = v.videoWidth; st.cv.height = v.videoHeight; }
  const pr = FX.params(c.fx), m = FX.matrix(pr), mo = FX.motion(c.fx.motion || 'still', (t - c.start) / Math.max(.01, c.end - c.start));
  st.draw({ tex: st.layer(v, null, pr.bl * st.cv.width / 1080), z: mo.z, x: mo.x, y: mo.y, m: m.m, o: m.o, v: pr.v, n: pr.n }, null, null, 0, Math.floor(t * 30));
  return st.cv;
}
function edDrawBase() {
  const P = ED.plan, v0 = ED.vid, base = $e('edBase'), g = base.getContext('2d');
  if (!v0.videoWidth) { g.fillStyle = '#111'; g.fillRect(0, 0, base.width, base.height); return false; }
  const v = edVideoSrc(v0.currentTime), vw = v0.videoWidth, vh = v0.videoHeight;
  const pan = ED.panel, pg = pan.getContext('2d'), sm = ED.small, side = P.layout.mode === 'side';
  sm.width = Math.max(8, Math.round(pan.width / 8)); sm.height = Math.max(8, Math.round(pan.height / 8));
  const sg = sm.getContext('2d'); sg.filter = `blur(${P.bg_blur * sm.width}px)`; coverDraw(sg, v, vw, vh, 0, 0, sm.width, sm.height);
  pg.imageSmoothingQuality = 'high'; pg.filter = side ? 'none' : 'url(#edDim)'; pg.drawImage(sm, 0, 0, pan.width, pan.height); pg.filter = 'none';
  if (!side) {
    const h = pan.width * vh / vw; pg.drawImage(v, 0, (pan.height - h) / 2, pan.width, h);
    g.drawImage(pan, 0, 0);
  } else {
    g.drawImage(pan, 0, 0);
    const wr = base.width - pan.width;
    g.save(); g.beginPath(); g.rect(pan.width, 0, wr, base.height); g.clip();
    coverDraw(g, v, vw, vh, pan.width, 0, wr, base.height, P.layout.focus); g.restore();
  }
  return true;
}

// ---------- lyrics, with the builder's line fitting (render.fit_lines) ----------
const _mc = document.createElement('canvas').getContext('2d');
function fitLines(lines, font, weight, size, maxw, ow) {
  const need = (ls, sz) => ls.map(l => { _mc.font = `${weight} ${sz}px ${font}`; return _mc.measureText(l).width + sz * (0.24 + ow); });
  let ws = need(lines, size);
  if (Math.max(...ws) <= maxw) return [lines, size];
  if (size * maxw / Math.max(...ws) >= 0.78 * size) return [lines, size * maxw / Math.max(...ws)];
  const out = [];
  lines.forEach((l, i) => { const w = l.split(' ').filter(Boolean);
    if (ws[i] > maxw && w.length > 1) { let best = null;
      for (let k = 1; k < w.length; k++) { const d = Math.abs(w.slice(0, k).join(' ').length - w.slice(k).join(' ').length); if (!best || d < best[0]) best = [d, k]; }
      out.push(w.slice(0, best[1]).join(' '), w.slice(best[1]).join(' ')); } else out.push(l); });
  ws = need(out, size);
  return [out, Math.max(0.55 * size, Math.min(size, size * maxw / Math.max(...ws)))];
}
function edScreenAt(t) { return (ED.plan.screens || []).find(s => t >= s.start && t < s.end); }
function edScreenNear(t) { const all = tlScreens(); return all.find(s => t >= s.start && t < s.end) || all.find(s => s.start >= t) || all[all.length - 1]; }
function edLyrics(t) {
  const P = ED.plan, box = $e('edLyr'), s = edScreenAt(t);
  if (!s) { if (ED.lastScreen) { box.innerHTML = ''; ED.lastScreen = null; } return; }
  const L = edLook(), eff = s.fx || P.anim.in, k = P.k, fx = Anim.FX[eff] || Anim.FX.fade;
  const key = JSON.stringify([s.i, s.lines, L.lyrics_font, L.lyrics_weight, L.lyrics_size, L.lyrics_top, L.lyrics_fill_left, L.lyrics_fill_mid, L.lyrics_fill_right, L.lyrics_outline, L.lyrics_outline_w, L.lyrics_glow, eff, k, ED.fontsReady]);
  if (ED.lastScreen !== key) {
    const font = fontCss(L.lyrics_font);
    const [lines, size] = fitLines(s.lines, font, L.lyrics_weight, L.lyrics_size * k, P.canvas[0] * 0.9, L.lyrics_outline_w);
    box.innerHTML = `<div class="blk" style="position:absolute;left:4%;right:4%;top:${L.lyrics_top * 100}%">` + Anim.html(lines, { font, weight: L.lyrics_weight, size, left: L.lyrics_fill_left, mid: L.lyrics_fill_mid,
      right: L.lyrics_fill_right, outline: L.lyrics_outline, ow: L.lyrics_outline_w, glow: L.lyrics_glow, lh: 1.35 }, fx.unit) + '</div>';
    Anim.prepare(box); ED.lastScreen = key;
    document.fonts.load(`${L.lyrics_weight} 40px ${font}`, lines.join(' ')).then(() => { if (!ED.fontsReady) { ED.fontsReady = 1; ED.lastScreen = null; } });
  }
  const om = P.anim.out, local = t - s.start;
  let name = eff === 'none' ? 'fade' : eff, p = 1;
  if (eff !== 'none' && local < s.din) p = local / s.din;
  else if (om !== 'cut' && eff !== 'none' && s.end - t < s.dout) { p = (s.end - t) / s.dout; if (om === 'fade') name = 'fade'; }
  Anim.apply(box, name, p, { W: P.canvas[0], H: P.canvas[1] });
}

// ---------- pictures: opening/end cards and interludes, with their transitions ----------
function edTex(url, blurPx) {
  const it = ED.imgs[url]; if (!it || !it.ok) return null;
  return ED.stage.layer(it.im, url + '|' + blurPx, blurPx);
}
function edPartLayer(q, local) {
  const pr = FX.params(q), m = q.baked ? null : FX.matrix(pr);
  const tex = edTex(q.url, q.baked ? 0 : pr.bl * ED.panel.width / ED.plan.canvas[0]);
  const mo = FX.motion(q.motion, (local - q.s) / Math.max(.01, q.e - q.s));
  return { tex, z: mo.z, x: mo.x, y: mo.y, m: m && m.m, o: m && m.o, v: q.v, n: q.grain, seed: q.s * 7 };
}
function edPicLayer(p, t) {        // the picture's own frame at time t (inside an interlude, possibly a transition between two pictures)
  if (!p.parts) { const mo = FX.cardMotion(t - p.start); return [{ tex: edTex(p.url, 0), ...mo }, null, null, 0]; }
  const local = t - p.start, ps = p.parts;
  for (let j = ps.length - 1; j >= 1; j--) {
    if (local >= ps[j].s && local < ps[j].s + ps[j].din) return [edPartLayer(ps[j - 1], local), edPartLayer(ps[j], local), ps[j].tin, (local - ps[j].s) / ps[j].din];
    if (local >= ps[j].s + ps[j].din) return [edPartLayer(ps[j], local), null, null, 0];
  }
  return [edPartLayer(ps[0], local), null, null, 0];
}
function edPictures(t, frame) {
  const P = ED.plan, cv = $e('edGL');
  const p = P.pics.find(x => t >= x.start && t < x.end);
  if (!p) { cv.style.visibility = 'hidden'; return; }
  if (!ED.stage) { try { ED.stage = new FX.Stage(cv); } catch (e) { ED.err = e.message; edMsg(); return; } }
  const [a, b, tr, tt] = edPicLayer(p, t);
  if (!a.tex) { cv.style.visibility = 'hidden'; return; }
  const video = () => {             // her video with her name on it, as the builder has it when a transition starts or ends
    const lg = ED.imgs[P.logo];
    if (!lg || !lg.ok) return { tex: ED.stage.layer(ED.panel, null, 0) };
    const c = ED.panelL = ED.panelL || document.createElement('canvas'); c.width = ED.panel.width; c.height = ED.panel.height;
    const g = c.getContext('2d'); g.drawImage(ED.panel, 0, 0); g.drawImage(lg.im, 0, 0, c.width, c.height);
    return { tex: ED.stage.layer(c, null, 0) }; };
  if (p.tin && t < p.start + p.din) {           // her video -> the picture
    const pic = b ? a : a;                       // (a part-to-part transition never overlaps the way in)
    ED.stage.draw(video(), pic, p.tin, (t - p.start) / p.din, frame);
  } else if (p.tout && t >= p.end - p.dout) {   // the picture -> her video
    ED.stage.draw(b ? b : a, video(), p.tout, (t - (p.end - p.dout)) / p.dout, frame);
  } else if (b) ED.stage.draw(a, b, tr, tt, frame);
  else ED.stage.draw(a, null, null, 0, frame);
  cv.style.visibility = 'visible';
}

// ---------- the play loop ----------
function edFrame() {
  ED.raf = requestAnimationFrame(edFrame);
  if (!ED.open || !ED.plan || !ED.plan.ready) return;
  const v = ED.vid, P = ED.plan;
  let t = v.currentTime;
  if (!v.paused && t >= P.clip[1]) { v.pause(); v.currentTime = P.clip[1] - 0.05; }
  if (!edDrawBase()) return;
  const frame = Math.floor(t * 30);
  edLyrics(t); edPictures(t, frame);
  if (ED.pop && performance.now() - (ED.popAt || 0) > 300) { ED.popAt = performance.now(); edPopFollow(); }
  const f = P.fade, a = P.clip[0], b = P.clip[1];
  $e('edFade').style.opacity = f > 0 ? Math.max(0, 1 - Math.min((t - a) / f, (b - t) / f)) : 0;
  $e('edTime').textContent = fmt(t) + ' / ' + fmt(P.dur);
  $e('edPlay').textContent = v.paused ? '▶ Play' : '❚❚ Pause';
  if (!v.paused || ED.tlDirty) { edDrawTL(); ED.tlDirty = false; }
}
function edPlay() {
  const v = ED.vid, P = ED.plan; if (!P) return;
  if (v.paused) { if (v.currentTime < P.clip[0] || v.currentTime >= P.clip[1] - 0.1) v.currentTime = P.clip[0]; v.play(); } else v.pause();
}
function edSeek(t) { if (!ED.plan) return; ED.vid.currentTime = Math.max(0, Math.min(ED.plan.dur - 0.05, t)); ED.tlDirty = true; }
function edJump(d) {
  const t = ED.vid.currentTime, ts = (ED.plan.screens || []).map(s => s.start).concat(ED.plan.pics.map(p => p.start)).sort((a, b) => a - b);
  const n = d > 0 ? ts.find(x => x > t + 0.05) : [...ts].reverse().find(x => x < t - 0.3);
  if (n != null) edSeek(n);
}
function edMsg() {
  const m = $e('edMsg'), px = ED.proxy;
  let h = '';
  if (ED.err) h = esc(ED.err);
  else if (!ED.plan) h = '<span class="spin"></span>Working out the video…';
  if (px && px.state === 'working') h += `<div class="edbar"><i style="width:${Math.round((px.progress || 0) * 100)}%"></i></div><small>Making a small copy of the video for smooth playback: ${Math.round((px.progress || 0) * 100)} %</small>`;
  else if (px && px.state === 'error') h += `<small>The small copy could not be made: ${esc(px.error || '')}</small>`;
  m.innerHTML = h; m.style.display = h ? '' : 'none';
  const notes = ED.plan && ED.plan.notes || [];
  $e('edNotes').innerHTML = notes.length ? notes.map(n => '• ' + esc(n)).join('<br>') : '';
}

// ---------- timeline ----------
const TL = { ruler: 24, wave: 46, vid: 30, lyr: 40, pic: 46, pad: 7 };
function tlH() { return TL.ruler + TL.wave + TL.vid + TL.lyr + TL.pic + TL.pad * 4; }
function tlX(t) { return t * ED.pxs - ED.scroll; }
function tlT(x) { return (x + ED.scroll) / ED.pxs; }
function edFit() { const P = ED.plan; if (!P) return; ED.pxs = Math.max(0.5, ($e('edTLWrap').clientWidth - 4) / P.dur); edTLSize(); }
function edZoom(f) {
  const w = $e('edTLWrap'), P = ED.plan; if (!P) return;
  const tc = ED.vid.currentTime, before = tlX(tc);
  ED.pxs = Math.max(w.clientWidth / P.dur, Math.min(400, ED.pxs * f)); edTLSize();
  w.scrollLeft = Math.max(0, tc * ED.pxs - before); edDrawTL();
}
function edTLSize() { const P = ED.plan; if (!P) return; $e('edTLSpace').style.width = Math.ceil(P.dur * ED.pxs) + 'px'; edDrawTL(); }
function tlRows() { const y0 = TL.ruler, yv = y0 + TL.wave + TL.pad, y1 = yv + TL.vid + TL.pad, y2 = y1 + TL.lyr + TL.pad; return { wave: [y0, TL.wave], vid: [yv, TL.vid], lyr: [y1, TL.lyr], pic: [y2, TL.pic] }; }
function edEff(i) { return effTimes(i); }
// every lyric screen of the song (not only the ones in this video) with its current times and the changes made here:
// new words (screen_text), taken out (screen_off), added (added_screens, ids "a0", "a1", ..). Same rules as pipeline.edited_screens.
function edScreens(withOff) {
  const C = S.config, txt = C.screen_text || {}, off = C.screen_off || {}, an = C.screen_anim || {}, out = [];
  SCR.forEach((s, i) => { const t = edEff(i); if (t.start == null) return;
    if (off[i] && !withOff) return;
    out.push({ i, lines: txt[i] || s.lines, start: t.start, end: t.end, manual: t.manual, off: !!off[i], edited: !!txt[i], anim: an[i], section: s.section }); });
  (C.added_screens || []).forEach((a, k) => { if (a.start == null) return;
    out.push({ i: 'a' + k, k, lines: a.lines || [], start: a.start, end: a.end, manual: true, added: true, anim: a.anim, section: 'added' }); });
  return out.sort((a, b) => a.start - b.start);
}
function tlScreens() { return edScreens(false); }
function scrLabel(s) { return typeof s.i === 'string' ? '+' : String(s.i + 1); }
function setScreenTimes(id, a, b) {
  if (typeof id === 'string') { const x = S.config.added_screens[+id.slice(1)]; x.start = r2(a); x.end = r2(b); }
  else { S.config.lyric_times[id] = r2(a); S.config.lyric_ends[id] = r2(b); }
}
// her video in clips (video_clips: cut times, and per clip a filter and motion); same rules as pipeline.video_clips
function vcCfg() { const v = S.config.video_clips = S.config.video_clips || {}; v.cuts = v.cuts || []; v.fx = v.fx || []; return v; }
function edClips() {
  const v = S.config.video_clips || {}, dur = ED.plan ? ED.plan.dur : 0;
  const cuts = (v.cuts || []).filter(x => x > 0 && x < dur).sort((a, b) => a - b), e = [0, ...cuts, dur];
  return e.slice(0, -1).map((a, k) => { const f = (v.fx || [])[k] || {};
    return { k, start: a, end: e[k + 1], fx: f, plain: FX.FILTERS && isPlainFx(f) && (f.motion || 'still') === 'still' }; });
}
function isPlainFx(f) { const p = FX.params(f); return Object.keys(FX.IDENT).every(k => Math.abs(p[k] - FX.IDENT[k]) < 1e-6); }
function edClipAt(t) { return edClips().find(c => t >= c.start && t < c.end); }
function edSplit() {
  const t = r2(ED.vid.currentTime), v = vcCfg(), cs = edClips(), c = cs.find(x => t > x.start + 0.3 && t < x.end - 0.3);
  if (!c) return toastEd('Move the playhead into her video, away from an existing cut, to split it there.');
  while (v.fx.length < cs.length) v.fx.push({});
  v.cuts = [...v.cuts.filter(x => x > 0 && x < ED.plan.dur), t].sort((a, b) => a - b);
  v.fx.splice(c.k + 1, 0, JSON.parse(JSON.stringify(v.fx[c.k] || {})));
  mark(); edSelect({ kind: 'clip', k: c.k + 1 }); toastEd('Video split at ' + fmt(t) + '. Each part can have its own filter and motion.');
}
function edJoin(k) { const v = vcCfg(); v.cuts.sort((a, b) => a - b); v.cuts.splice(k, 1); v.fx.splice(k + 1, 1); mark(); edSelect({ kind: 'clip', k }); }
function toastEd(m) { const e = $e('edToast'); if (!e) return; e.textContent = m; e.style.opacity = 1; clearTimeout(ED.toastT); ED.toastT = setTimeout(() => e.style.opacity = 0, 3500); }
function edDrawTL() {
  const cv = $e('edTL'), wrap = $e('edTLWrap'); if (!cv || !ED.open) return;
  const P = ED.plan, W = wrap.clientWidth, H = tlH(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  ED.scroll = wrap.scrollLeft;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.body), ink = cs.color;
  if (!P || !P.ready) { g.fillStyle = ink; g.font = '15px Manrope,sans-serif'; g.fillText(ED.err || 'Loading…', 12, 40); return; }
  const R = tlRows(), t0 = tlT(0), t1 = tlT(W), sel0 = ED.sel;
  // ruler
  const steps = [1, 2, 5, 10, 15, 30, 60], step = steps.find(s => s * ED.pxs >= 70) || 60;
  g.font = '12px Manrope,sans-serif'; g.fillStyle = ink;
  for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) { const x = tlX(t); g.globalAlpha = .45; g.fillRect(x, 0, 1, 8); g.globalAlpha = .8; g.fillText(fmt(t), x + 3, 17); }
  g.globalAlpha = 1;
  // the part this video covers (the reel is a cut of the song)
  const [ca, cb] = P.clip;
  g.fillStyle = 'rgba(0,0,0,.18)'; if (ca > 0) g.fillRect(tlX(0), TL.ruler, tlX(ca) - tlX(0), H); if (cb < P.dur) g.fillRect(tlX(cb), TL.ruler, tlX(P.dur) - tlX(cb), H);
  // loudness and where the voice is
  const [wy, wh] = R.wave;
  g.fillStyle = 'rgba(127,127,160,.13)'; g.fillRect(0, wy, W, wh);
  if (ED.peaks) { const pk = ED.peaks.peaks, rate = ED.peaks.rate; g.fillStyle = ink; g.globalAlpha = .45;
    for (let x = 0; x < W; x++) { const a = Math.floor(tlT(x) * rate), b = Math.max(a + 1, Math.floor(tlT(x + 1) * rate)); let m = 0; for (let k = a; k < b && k < pk.length; k++) m = Math.max(m, pk[k]); const h = m / 100 * (wh - 10) / 2; g.fillRect(x, wy + wh / 2 - h, 1, Math.max(1, h * 2)); }
    g.globalAlpha = 1; }
  g.fillStyle = 'rgba(34,205,185,.95)'; (P.voice || []).forEach(([a, b]) => { if (b < t0 || a > t1) return; g.fillRect(tlX(a), wy + wh - 5, Math.max(1, tlX(b) - tlX(a)), 4); });
  // her video, in clips
  const [vy, vh] = R.vid;
  edClips().forEach(c => { if (c.end < t0 || c.start > t1) return;
    const x = tlX(c.start), w = Math.max(3, tlX(c.end) - x), on = sel0 && sel0.kind === 'clip' && sel0.k === c.k;
    g.fillStyle = c.plain ? 'rgba(90,90,120,.55)' : 'rgba(60,110,220,.85)'; rr(g, x + 1, vy + 2, w - 2, vh - 4, 5); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#ff2d6f'; g.lineWidth = 1.5; g.stroke(); }
    if (w > 40) { g.save(); g.beginPath(); g.rect(x + 4, vy, w - 8, vh); g.clip(); g.fillStyle = '#fff'; g.font = 'bold 11.5px Manrope,sans-serif';
      const f = c.fx, lab = [(FX.FILTERS && FX.FILTERS[f.filter] && f.filter !== 'original') ? FX.FILTERS[f.filter].label : '', f.motion && f.motion !== 'still' && FX.MOTIONS[f.motion] ? FX.MOTIONS[f.motion].label : ''].filter(Boolean).join(' · ') || 'her video';
      g.fillText('🎬 ' + lab, x + 7, vy + vh / 2 + 4); g.restore(); } });
  edClips().slice(1).forEach(c => { const x = tlX(c.start); g.fillStyle = '#fff'; g.fillRect(x - 1.5, vy, 3, vh); g.fillStyle = '#ff2d6f'; g.beginPath(); g.arc(x, vy + vh / 2, 4, 0, 7); g.fill(); });
  // lyric screens
  const [ly, lh] = R.lyr;
  g.fillStyle = 'rgba(127,127,160,.10)'; g.fillRect(0, ly, W, lh);
  const sel = ED.sel;
  edScreens(true).filter(s => s.off).forEach(s => { if (s.end < t0 || s.start > t1) return;      // taken out: a faint outline, click to bring back
    const x = tlX(s.start), w = Math.max(3, tlX(s.end) - x); g.setLineDash([4, 3]); g.strokeStyle = 'rgba(150,80,235,.7)'; g.lineWidth = 1.5; rr(g, x + 1, ly + 5, w - 2, lh - 10, 6); g.stroke(); g.setLineDash([]);
    if (w > 30) { g.fillStyle = 'rgba(150,80,235,.9)'; g.font = '11px Manrope,sans-serif'; g.fillText('✕ ' + scrLabel(s), x + 6, ly + lh / 2 + 4); } });
  tlScreens().forEach(s => { if (s.end < t0 || s.start > t1) return;
    const x = tlX(s.start), w = Math.max(3, tlX(s.end) - x), on = sel && sel.kind === 'screen' && sel.i === s.i;
    g.fillStyle = s.added ? 'rgba(220,60,130,.92)' : s.manual ? 'rgba(224,150,0,.92)' : 'rgba(150,80,235,.92)'; rr(g, x, ly + 3, w, lh - 6, 6); g.fill();
    if (on) { g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#ff2d6f'; g.lineWidth = 1.5; g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(x + 1, ly + 10, 2, lh - 20); g.fillRect(x + w - 3, ly + 10, 2, lh - 20);
    if (w > 22) { g.save(); g.beginPath(); g.rect(x + 5, ly, w - 10, lh); g.clip(); g.fillStyle = '#fff'; g.font = 'bold 12px Manrope,sans-serif';
      g.fillText(scrLabel(s) + '  ' + (s.lines[0] || ''), x + 7, ly + lh / 2 + 4); g.restore(); } });
  // pictures: cards and interludes
  const [py, ph] = R.pic;
  g.fillStyle = 'rgba(127,127,160,.10)'; g.fillRect(0, py, W, ph);
  P.pics.forEach(p => { if (p.end < t0 || p.start > t1) return;
    const x = tlX(p.start), w = Math.max(3, tlX(p.end) - x), on = sel && ((sel.kind === 'interlude' && sel.n === p.n && p.kind === 'interlude') || (sel.kind === p.kind && p.kind !== 'interlude'));
    g.fillStyle = p.kind === 'interlude' ? 'rgba(20,170,150,.9)' : 'rgba(230,120,30,.9)'; rr(g, x, py + 3, w, ph - 6, 6); g.fill();
    (p.parts || [{ url: p.url, s: 0, e: p.end - p.start }]).forEach((q, j) => {
      const it = ED.imgs[q.url], qx = tlX(p.start + q.s), qw = tlX(p.start + q.e) - qx;
      if (it && it.ok && qw > 16) { const tw = Math.min(qw - 6, (ph - 12) * 9 / 16); g.save(); g.beginPath(); rr(g, qx + 3, py + 6, tw, ph - 12, 4); g.clip(); coverDraw(g, it.im, it.im.width, it.im.height, qx + 3, py + 6, tw, ph - 12); g.restore(); }
      if (j) { g.fillStyle = '#fff'; g.fillRect(qx, py + 4, 2, ph - 8); } });
    if (on) { rr(g, x, py + 3, w, ph - 6, 6); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.strokeStyle = '#ff2d6f'; g.lineWidth = 1.5; g.stroke(); }
    g.fillStyle = 'rgba(255,255,255,.85)'; if (p.kind !== 'opening') g.fillRect(x + 1, py + 12, 2, ph - 24); if (p.kind !== 'ending') g.fillRect(x + w - 3, py + 12, 2, ph - 24);
    const lab = p.kind === 'opening' ? 'Opening card' : p.kind === 'ending' ? 'End card' : `Interlude${(p.parts || []).length > 1 ? ' · ' + p.parts.length + ' pictures' : ''}`;
    if (w > 70) { g.save(); g.beginPath(); g.rect(x, py, w, ph); g.clip(); g.fillStyle = '#fff'; g.font = 'bold 12px Manrope,sans-serif'; g.shadowColor = '#000'; g.shadowBlur = 4;
      g.fillText(lab, x + Math.min(w - 60, (ph - 12) * 9 / 16 + 10), py + ph / 2 + 4); g.restore(); } });
  g.fillStyle = ink; g.globalAlpha = .7; g.font = '11px Manrope,sans-serif';
  g.fillText('video', 4, vy - 1); g.fillText('lyrics', 4, ly - 1); g.fillText('pictures', 4, py - 1); g.globalAlpha = 1;
  // playhead
  const xh = tlX(ED.vid.currentTime || 0); g.fillStyle = '#ff2d6f'; g.fillRect(xh - 1, 0, 2, H); g.beginPath(); g.moveTo(xh - 6, 0); g.lineTo(xh + 6, 0); g.lineTo(xh, 8); g.fill();
  // follow the playhead while playing
  if (!ED.vid.paused && !ED.drag && (xh > W - 40 || xh < 0)) { wrap.scrollLeft = Math.max(0, ED.vid.currentTime * ED.pxs - 60); }
  if (ED.drag && ED.drag.label) { const d = ED.drag; g.font = 'bold 13px Manrope,sans-serif'; const tw = g.measureText(d.label).width + 14;
    const lx = Math.max(2, Math.min(W - tw - 2, d.lx - tw / 2)); g.fillStyle = '#1f1a33'; rr(g, lx, d.ly - 26, tw, 22, 6); g.fill(); g.fillStyle = '#fff'; g.fillText(d.label, lx + 7, d.ly - 10); }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, Math.min(r, w / 2)) : g.rect(x, y, w, h); }

// what is under the pointer on the timeline
function tlHit(x, y) {
  const R = tlRows(), t = tlT(x), edge = 9;
  const inRow = r => y >= R[r][0] && y < R[r][0] + R[r][1];
  if (inRow('vid')) { for (const c of edClips().slice(1)) if (Math.abs(x - tlX(c.start)) < 7) return { kind: 'cut', k: c.k - 1, zone: 'ew' };
    const c = edClipAt(t); if (c) return { kind: 'clip', k: c.k, c, zone: 'none' }; }
  if (inRow('lyr')) for (const s of tlScreens()) { const a = tlX(s.start), b = tlX(s.end);
    if (x >= a - edge / 2 && x <= b + edge / 2) return { kind: 'screen', i: s.i, s, zone: x - a < edge && b - a > 2 * edge ? 'start' : b - x < edge && b - a > 2 * edge ? 'end' : x - a < edge ? 'start' : b - x < edge ? 'end' : 'move' }; }
  if (inRow('lyr')) for (const s of edScreens(true).filter(s => s.off)) if (x >= tlX(s.start) && x <= tlX(s.end)) return { kind: 'screen', i: s.i, s, zone: 'none' };
  if (inRow('pic') && ED.plan) for (const p of ED.plan.pics) { const a = tlX(p.start), b = tlX(p.end);
    if (x >= a && x <= b) { let zone = x - a < edge ? 'start' : b - x < edge ? 'end' : 'move';
      if (p.kind === 'opening') zone = zone === 'end' ? 'end' : 'none'; if (p.kind === 'ending') zone = zone === 'start' ? 'start' : 'none';
      return { kind: p.kind, n: p.n, p, zone }; } }
  return { kind: 'time', t };
}
function snapT(t, exclude) {      // pull a dragged time onto the voice's start/end, the playhead or a neighbour within 8 pixels
  const cand = [ED.vid.currentTime];
  (ED.plan.voice || []).forEach(([a, b]) => cand.push(a, b));
  tlScreens().forEach(s => { if (s.i !== exclude) cand.push(s.start, s.end); });
  let best = t, d = 8 / ED.pxs;
  cand.forEach(c => { if (Math.abs(c - t) < d) { d = Math.abs(c - t); best = c; } });
  return best;
}
const r2 = t => Math.round(t * 100) / 100;
function tlDown(ev) {
  const cv = $e('edTL'), r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  const h = tlHit(x, y); cv.setPointerCapture(ev.pointerId);
  ED.drag = { h, x0: x, moved: false, lx: x, ly: y, s0: h.p ? h.p.start : null, e0: h.p ? h.p.end : null };   // where the block was when the drag began
  if (h.kind === 'time') { edSeek(tlT(x)); ED.drag.scrub = true; }
}
function tlMove(ev) {
  const cv = $e('edTL'), r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  const d = ED.drag;
  if (!d) { const h = tlHit(x, y); cv.style.cursor = h.kind === 'time' ? 'pointer' : h.zone === 'move' ? 'grab' : h.zone === 'none' ? 'pointer' : 'ew-resize'; return; }
  d.lx = x; d.ly = y;
  if (d.scrub) { edSeek(tlT(x)); return; }
  if (!d.moved && Math.abs(x - d.x0) < 4) return;
  d.moved = true; cv.style.cursor = d.h.zone === 'move' ? 'grabbing' : 'ew-resize';
  const dt = (x - d.x0) / ED.pxs, h = d.h;
  if (h.kind === 'screen') {
    const all = tlScreens(), k = all.findIndex(s => s.i === h.i), prev = all[k - 1], next = all[k + 1];
    const lo = prev ? prev.end + 0.05 : 0, hi = next ? next.start - 0.05 : ED.plan.dur;
    let a = h.s.start, b = h.s.end;
    if (h.zone === 'start') a = Math.max(lo, Math.min(b - 0.5, snapT(h.s.start + dt, h.i)));
    else if (h.zone === 'end') b = Math.min(hi, Math.max(a + 0.5, snapT(h.s.end + dt, h.i)));
    else { const len = b - a; a = snapT(h.s.start + dt, h.i); a = Math.max(lo, Math.min(hi - len, a)); b = a + len; }
    if (h.zone === 'none') return;
    setScreenTimes(h.i, a, b);
    d.label = h.zone === 'end' ? 'ends ' + fmt(b) : h.zone === 'start' ? 'starts ' + fmt(a) : fmt(a) + ' – ' + fmt(b);
    edLocalScreen(h.i, a, b); edSeek(h.zone === 'end' ? Math.max(a, b - 1) : a);
  } else if (h.kind === 'cut') {
    const v = vcCfg(); v.cuts.sort((p, q) => p - q);
    const t0 = d.c0 == null ? (d.c0 = v.cuts[h.k]) : d.c0, lo = (h.k ? v.cuts[h.k - 1] : 0) + 0.5, hi = (h.k + 1 < v.cuts.length ? v.cuts[h.k + 1] : ED.plan.dur) - 0.5;
    v.cuts[h.k] = r2(Math.max(lo, Math.min(hi, t0 + dt))); d.label = 'cut at ' + fmt(v.cuts[h.k]); edSeek(v.cuts[h.k]);
  } else if (h.kind === 'interlude' && h.zone !== 'none') {
    const ov = ilOv(h.p.n - 1), s0 = d.s0, e0 = d.e0;          // an interlude stays between the lyric screens around it
    const lo = Math.max(0, ...tlScreens().filter(x => x.end <= s0 + 0.01).map(x => x.end + 0.1)), hi = Math.min(ED.plan.dur, ...tlScreens().filter(x => x.start >= e0 - 0.01).map(x => x.start - 0.1));
    let a = s0, b = e0;
    if (h.zone === 'start') a = Math.max(lo, Math.min(e0 - 1.5, s0 + dt));
    else if (h.zone === 'end') b = Math.min(hi, Math.max(s0 + 1.5, e0 + dt));
    else { const len = e0 - s0; a = Math.max(lo, Math.min(hi - len, s0 + dt)); b = a + len; }
    ov.start = r2(a); ov.end = r2(b); d.label = fmt(a) + ' – ' + fmt(b);
    d.live = { a, b }; edSeek(h.zone === 'end' ? b - 1 : a);
  } else if (h.kind === 'opening' && h.zone === 'end') {
    const b = Math.max(1, Math.min(ED.plan.dur / 3, d.e0 + dt)); S.config.opening.seconds = r2(b); d.label = 'opening card until ' + fmt(b); d.live = { a: 0, b }; edSeek(b - 1);
  } else if (h.kind === 'ending' && h.zone === 'start') {
    const a = Math.max(ED.plan.dur * 2 / 3, Math.min(ED.plan.dur - 1, d.s0 + dt)); S.config.ending.seconds = r2(ED.plan.dur - a); d.label = 'end card from ' + fmt(a); d.live = { a, b: ED.plan.dur }; edSeek(a);
  }
  if (d.live) { const q = ED.plan.pics.find(x => x.kind === h.p.kind && x.n === h.p.n); if (q) Object.assign(q, { start: d.live.a, end: d.live.b }); }
  mark(); edDrawTL();
}
function edLocalScreen(i, a, b) {   // move a screen in the preview at once; the server's plan follows when the drag ends
  const s = (ED.plan.screens || []).find(x => x.i === i);
  if (s) { s.start = a; s.end = b; const len = b - a; s.din = Math.min(+S.config.text_anim.in_seconds || .5, len * .45); s.dout = Math.min(+S.config.text_anim.out_seconds || .3, len * .4); }
}
function tlUp(ev) {
  const d = ED.drag; ED.drag = null; if (!d) return;
  if (!d.moved && !d.scrub) {
    const h = d.h;
    if (h.kind === 'screen') { edSelect({ kind: 'screen', i: h.i }); edSeek(h.s.start + 0.05); }
    else if (h.kind === 'clip') { edSelect({ kind: 'clip', k: h.k }); }
    else if (h.kind === 'interlude') { edSelect({ kind: 'interlude', n: h.n }); edSeek(h.p.start); }
    else if (h.kind === 'opening' || h.kind === 'ending') { edSelect({ kind: h.kind }); edSeek(h.p.start); }
  }
  if (d.moved) { renderScreens(); renderDetected(); edRefreshSoon(0); }
  edDrawTL();
}
function tlDbl(ev) {
  const cv = $e('edTL'), r = cv.getBoundingClientRect(), h = tlHit(ev.clientX - r.left, ev.clientY - r.top);
  if (h.kind === 'screen' && typeof h.i === 'number') { S.config.lyric_times[h.i] = null; S.config.lyric_ends[h.i] = null; mark(); renderScreens(); edRefreshSoon(0); }
  if (h.kind === 'interlude') { const o = ilOv(h.n - 1); delete o.start; delete o.end; mark(); renderDetected(); edRefreshSoon(0); }
}

// ---------- the settings of one interlude ----------
function ilOv(g) { const a = S.config.interludes = S.config.interludes || []; while (a.length <= g) a.push({}); if (!a[g]) a[g] = {}; return a[g]; }
function ilPics(g) { const o = ilOv(g); if (!o.pictures || !o.pictures.length) o.pictures = [{ photo: o.photo || '' }]; delete o.photo; return o.pictures; }
function edSelect(sel) { ED.sel = sel; edPanel(); edDrawTL(); }
function edChanged() { mark(); renderDetected(); edRefreshSoon(150); }
function fxOptions(cur) { return Object.values(FX.FILTERS).map(f => `<option value="${f.id}" ${f.id === (cur || 'original') ? 'selected' : ''}>${f.label}</option>`).join(''); }
function moOptions(cur) { return Object.values(FX.MOTIONS).map(m => `<option value="${m.id}" ${m.id === cur ? 'selected' : ''}>${m.label}</option>`).join(''); }
function trOptions(cur, def) { return `<option value="">Same as default (${tLabel(def)})</option>` + TLIST.filter(n => FX.TRANSITIONS.includes(n)).map(n => `<option value="${n}" ${cur === n ? 'selected' : ''}>${tLabel(n)}</option>`).join(''); }
const ADJ = [['b', 'Brightness', .5, 1.5, .01, 1], ['c', 'Contrast', .5, 1.6, .01, 1], ['s', 'Colour strength', 0, 2, .01, 1], ['w', 'Warmth', -1, 1, .02, 0], ['t', 'Tint (green ↔ pink)', -1, 1, .02, 0], ['f', 'Fade', 0, 1, .02, 0], ['v', 'Dark corners', 0, 1, .02, 0], ['n', 'Film grain', 0, 1, .02, 0], ['bl', 'Soft blur', 0, 12, .5, 0]];
function edPanel() {
  const box = $e('edPanel'); if (!box || !S) return;
  const sel = ED.sel, P = ED.plan;
  if (!sel || !P || !P.ready) { box.innerHTML = `<div class="hint" style="margin:0;font-size:16px"><b>How to edit</b><br>• Move the playhead (click the timeline), then use a tool on the left: it changes what is under the playhead.<br>
    • ✂️ <b>Split</b> cuts her video in two, so each part can have its own <b>Filter</b> and <b>Motion</b>.<br>• Drag blocks on the timeline to move them, drag their ends to make them longer or shorter; double-click a lyric block to go back to its automatic time.<br>
    • Click any block to change it here.</div>`; return; }
  if (sel.kind === 'screen') {
    const sc = edScreens(true).find(x => x.i === sel.i); if (!sc) { ED.sel = null; return edPanel(); }
    const id = typeof sel.i === 'string' ? "'" + sel.i + "'" : sel.i, an = Anim.FX[sc.anim] ? Anim.FX[sc.anim].label : 'same as the others';
    if (sc.off) { box.innerHTML = `<h3 style="margin-top:0">Lyric screen ${scrLabel(sc)} (taken out)</h3><div class="edlines" style="opacity:.6">${sc.lines.map(esc).join('<br>')}</div>
      <div class="row" style="margin-top:10px"><button class="primary small" onclick="edRestoreScreen(${id})">Bring it back</button><button class="small" onclick="edSelect(null)">Done</button></div>`; return; }
    box.innerHTML = `<h3 style="margin-top:0">Lyric screen ${scrLabel(sc)} <small class="hint">${esc(sc.section || '')} · ${fmt(sc.start)} – ${fmt(sc.end)}</small></h3>
      <label class="l">Words (one line per line on screen)</label><textarea id="edWords" style="font-size:20px;min-height:84px" oninput="edWords(${id},this.value)">${esc(sc.lines.join('\n'))}</textarea>
      ${sc.edited ? `<button class="small" style="margin-top:6px" onclick="edResetWords(${id})">Back to the words from the lyrics</button>` : ''}
      <div class="row" style="margin-top:10px"><button class="small" onclick="edPop('anim')">✨ Animation: ${esc(an)}</button><button class="small" onclick="edSeek(${sc.start});ED.vid.play()">▶ Play from here</button></div>
      <div class="row" style="margin-top:10px">${typeof sel.i === 'number' && sc.manual ? `<button class="small" onclick="S.config.lyric_times[${sel.i}]=null;S.config.lyric_ends[${sel.i}]=null;mark();renderScreens();edRefreshSoon(0);edPanel()">Back to the automatic time</button>` : ''}
      <button class="small" onclick="edRemoveScreen(${id})">🗑 Remove this screen</button><button class="small" onclick="edSelect(null)">Done</button></div>
      <div class="hint" style="margin-top:8px">Move it or change its length on the timeline (drag the block or its ends).</div>`;
    return;
  }
  if (sel.kind === 'clip') {
    const c = edClips()[sel.k]; if (!c) { ED.sel = null; return edPanel(); }
    const f = c.fx, n = edClips().length;
    box.innerHTML = `<h3 style="margin-top:0">Her video${n > 1 ? `, part ${sel.k + 1} of ${n}` : ''} <small class="hint">${fmt(c.start)} – ${fmt(c.end)}</small></h3>
      <div class="row"><button class="small" onclick="edPop('filter')">🎨 Filter: ${esc((FX.FILTERS[f.filter || 'original'] || FX.FILTERS.original).label)}</button>
      <button class="small" onclick="edPop('motion')">✨ Motion: ${esc((FX.MOTIONS[f.motion || 'still'] || FX.MOTIONS.still).label)}</button></div>
      <div class="row" style="margin-top:10px"><button class="small" onclick="edSplit()">✂ Split at the playhead</button>${sel.k < n - 1 ? `<button class="small" onclick="edJoin(${sel.k})">Join with the next part</button>` : ''}
      <button class="small" onclick="edSelect(null)">Done</button></div>
      <div class="hint" style="margin-top:8px">Split her video (✂) to give each part its own filter and motion. Drag a cut (the white line on the video row) to move it.</div>`;
    return;
  }
  if (sel.kind === 'opening' || sel.kind === 'ending') {
    const k = sel.kind;
    box.innerHTML = `<h3 style="margin-top:0">${k === 'opening' ? 'Opening card' : 'End card'}</h3>
      <div class="grid"><div><label class="l">Lasts (min:sec)</label>${tinp(`config.${k}.seconds`, 6, 92)}</div>
      <div><label class="l">Photo behind it</label><select data-path="config.${k}.photo" class="photoSel"></select></div></div>
      <div class="hint">The words on the card are in step 7, the colours and fonts in step 6. Changes show here in a second or two (the card is drawn by the same code that makes the video).</div>
      <div class="row"><button class="small" onclick="openCard(document.getElementById('s8'),true);document.getElementById('s8').scrollIntoView({behavior:'smooth'})">Go to step 7</button><button class="small" onclick="edSelect(null)">Done</button></div>`;
    $$('#edPanel [data-path]').forEach(bind); fillPhotoSelects(); return;
  }
  const g = sel.n - 1, ov = ilOv(g), pics = ilPics(g), T = S.config.transitions, it = P.pics.find(p => p.kind === 'interlude' && p.n === sel.n);
  const opt = (cur, def) => trOptions(cur, def);
  box.innerHTML = `<h3 style="margin-top:0">Interlude (gap ${sel.n})${it ? ` · ${fmt(it.start)} – ${fmt(it.end)}` : ' · <span style="color:var(--warn)">not in this video</span>'}</h3>
    <div class="grid"><div><label class="l">Transition in</label><select onchange="ilOv(${g}).tin=this.value||undefined;edChanged()">${opt(ov.tin, T.interlude_in.name)}</select></div>
    <div><label class="l">Transition out</label><select onchange="ilOv(${g}).tout=this.value||undefined;edChanged()">${opt(ov.tout, T.interlude_out.name)}</select></div></div>
    <div class="edpics">${pics.map((q, j) => edPicCard(g, q, j, pics.length)).join('')}</div>
    <div class="row" style="margin-top:10px"><button class="primary small" onclick="ilPics(${g}).push({photo:''});edChanged();edPanel()">+ Add a picture</button>
    <button class="small" onclick="photoIn.click()">Upload photos</button><button class="small" onclick="edSelect(null)">Done</button></div>
    <div class="hint" style="margin-top:6px">The pictures share the interlude's time equally, one after another. Each has its own filter and motion, and its own transition from the picture before it.</div>`;
  edThumbs();
}
function edPicCard(g, q, j, n) {
  const pr = q.adjust || {}, def = S.config.photo_motion || 'zoom_in', bt = S.config.transitions.picture_to_picture || { name: 'fade', seconds: 0.8 };
  return `<div class="edpic"><div class="row" style="align-items:flex-start;gap:12px">
    <canvas class="edthumb" width="90" height="160" data-g="${g}" data-j="${j}"></canvas>
    <div style="flex:1;min-width:200px"><b>Picture ${j + 1}</b>
      <div style="margin-top:6px"><select onchange="ilPics(${g})[${j}].photo=this.value;edChanged();edPanel()"><option value="">Default picture</option>${S.photos.map(f => `<option value="${esc(f)}" ${q.photo === f ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select></div>
      <div class="grid" style="margin-top:8px;gap:8px">
        <div><label class="l">Motion</label><select onchange="ilPics(${g})[${j}].motion=this.value;edChanged()">${moOptions(q.motion || def)}</select></div>
        ${j ? `<div><label class="l">Transition from picture ${j}</label><select onchange="ilPics(${g})[${j}].trans=this.value||undefined;edChanged()">${trOptions(q.trans, bt.name)}</select></div>` : ''}
      </div>
      <div class="row" style="margin-top:8px">${j ? `<button class="small" onclick="edMovePic(${g},${j},-1)">↑ Earlier</button>` : ''}${j < n - 1 ? `<button class="small" onclick="edMovePic(${g},${j},1)">↓ Later</button>` : ''}
        ${n > 1 ? `<button class="small" onclick="ilPics(${g}).splice(${j},1);edChanged();edPanel()">✕ Remove</button>` : ''}</div>
    </div></div>
    <details class="edfx" ${q.filter && q.filter !== 'original' || Object.keys(pr).length ? 'open' : ''}><summary>Filter: <b>${(FX.FILTERS[q.filter || 'original'] || FX.FILTERS.original).label}</b>${q.amount != null && q.amount < 1 ? ` · ${Math.round(q.amount * 100)} %` : ''}</summary>
      <div class="edfilters">${Object.values(FX.FILTERS).map(f => `<div class="edf ${f.id === (q.filter || 'original') ? 'on' : ''}" onclick="ilPics(${g})[${j}].filter='${f.id}';edChanged();edPanel()"><canvas width="54" height="96" data-g="${g}" data-j="${j}" data-f="${f.id}"></canvas><small>${f.label}</small></div>`).join('')}</div>
      <div class="slider" style="margin-top:8px"><span style="min-width:120px">Strength</span><input type="range" min="0" max="1" step="0.05" value="${q.amount == null ? 1 : q.amount}" oninput="ilPics(${g})[${j}].amount=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+' %';edChanged()" onchange="edPanel()"><output>${Math.round((q.amount == null ? 1 : q.amount) * 100)} %</output></div>
      <div style="margin-top:6px"><b style="font-size:14px">Fine adjustments</b> <button class="small" onclick="delete ilPics(${g})[${j}].adjust;edChanged();edPanel()">Reset</button></div>
      ${ADJ.map(([k, lab, mn, mx, st, d]) => { const v = pr[k] == null ? d : (k === 'b' || k === 'c' || k === 's' ? pr[k] : pr[k] + 0);
        return `<div class="slider"><span style="min-width:120px;font-size:14px">${lab}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" oninput="edAdj(${g},${j},'${k}',+this.value,${d});this.nextElementSibling.textContent=(+this.value).toFixed(2)"><output>${(+v).toFixed(2)}</output></div>`; }).join('')}
    </details></div>`;
}
function edAdj(g, j, k, v, d) { const q = ilPics(g)[j]; q.adjust = q.adjust || {}; if (Math.abs(v - d) < 1e-6) delete q.adjust[k]; else q.adjust[k] = v; if (!Object.keys(q.adjust).length) delete q.adjust; edChanged(); }
function edMovePic(g, j, d) { const a = ilPics(g); const [x] = a.splice(j, 1); a.splice(j + d, 0, x); edChanged(); edPanel(); }
// small pictures of each photo through each filter, drawn by the same WebGL code as the preview
function edThumbs() {
  const cs = $$('#edPanel canvas[data-g]'); if (!cs.length) return;
  if (!ED.thumbStage) { const c = document.createElement('canvas'); c.width = 90; c.height = 160; try { ED.thumbStage = new FX.Stage(c); } catch (e) { return; } }
  const st = ED.thumbStage;
  cs.forEach(cv => {
    const q = ilPics(+cv.dataset.g)[+cv.dataset.j], url = q.photo ? `/media/${S.name}/photos/${encodeURIComponent(q.photo)}` : null;
    const spec = cv.dataset.f ? { filter: cv.dataset.f } : q;
    const draw = im => { st.cv.width = cv.width; st.cv.height = cv.height; st.forget();
      const pr = FX.params(spec), m = FX.matrix(pr);
      st.draw({ tex: st.layer(im, null, pr.bl * cv.width / 1080), m: m.m, o: m.o, v: pr.v, n: pr.n }, null, null, 0, 0);
      cv.getContext('2d').drawImage(st.cv, 0, 0); };
    if (!url) { const c = cv.getContext('2d'); const gr = c.createRadialGradient(cv.width / 2, cv.height * .38, 2, cv.width / 2, cv.height * .38, cv.height * .6);
      gr.addColorStop(0, 'hsl(350,70%,55%)'); gr.addColorStop(.45, 'hsl(350,60%,28%)'); gr.addColorStop(1, 'hsl(30,55%,10%)'); c.fillStyle = gr; c.fillRect(0, 0, cv.width, cv.height);
      const im = new Image(); im.onload = () => draw(im); im.src = cv.toDataURL(); return; }
    const it = ED.thumbs[url];
    if (it && it.ok) return draw(it.im);
    if (!it) { ED.thumbs[url] = {}; loadPicture(url).then(im => { ED.thumbs[url] = { im, ok: true }; edThumbs(); }); }
  });
}

// ---------- quick text tools (the same settings as step 6) ----------
function edTextTools(open) {
  const L = S.config.look, sel = Anim.FX[S.config.text_anim.in];
  return `<details class="edfx" style="margin-top:14px" ${open ? 'open' : ''}><summary><b>Lyrics look</b> · ${esc(L.lyrics_font)} · size ${L.lyrics_size} · ${sel ? sel.label : 'Fade'}</summary>
    <div class="row" style="margin-top:8px"><label class="l" style="margin:0">Font</label><select onchange="S.config.look.lyrics_font=this.value;styleChanged()">${fontList('lang').map(f => `<option ${f === L.lyrics_font ? 'selected' : ''} style="font-family:${fontCss(f)}">${esc(f)}</option>`).join('')}</select></div>
    <div class="row" style="margin-top:8px"><label class="l" style="margin:0">Size</label><button class="small" onclick="S.config.look.lyrics_size=Math.max(30,S.config.look.lyrics_size-4);styleChanged();edPanel()">−</button><b>${L.lyrics_size}</b><button class="small" onclick="S.config.look.lyrics_size=Math.min(130,S.config.look.lyrics_size+4);styleChanged();edPanel()">+</button>
      <span class="hint" style="margin:0">Drag the lyrics up or down on the picture to move them.</span></div>
    <div class="pals" style="margin-top:8px">${PAL.lyrics.map(([n, v]) => `<div class="pal" style="min-width:74px;padding:5px" onclick="styleTab='lyrics';pickPal('${n.replace(/'/g, "\\'")}');edPanel()"><i style="height:22px;background:linear-gradient(90deg,${v[0]},${v[1]},${v[2]})"></i><small>${n}</small></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><label class="l" style="margin:0">Animation</label><select onchange="pickAnim(this.value);S.config.screen_anim={};ED.lastScreen=null;edRefreshSoon(0)">${Anim.groups.map(gr => `<optgroup label="${gr}">${Anim.EFFECTS.filter(f => f.group === gr).map(f => `<option value="${f.id}" ${f.id === S.config.text_anim.in ? 'selected' : ''}>${f.label}</option>`).join('')}</optgroup>`).join('')}</select></div>
  </details>`;
}
// drag the lyrics (up/down) or her name (anywhere) on the picture
function edStageDown(ev) {
  if (!ED.plan) return;
  const box = $e('edOver').getBoundingClientRect(), x = (ev.clientX - box.left) / box.width, y = (ev.clientY - box.top) / box.height;
  if (x < 0 || x > 1) return;
  const L = edLook(), o = edOutCfg();
  const lh = $e('edLogoHit'), logoHit = lh && lh.firstElementChild && lh.firstElementChild.getBoundingClientRect();
  const onLogo = logoHit && ev.clientX >= logoHit.left && ev.clientX <= logoHit.right && ev.clientY >= logoHit.top && ev.clientY <= logoHit.bottom;
  const lyr = $e('edLyr').firstElementChild && $e('edLyr').firstElementChild.getBoundingClientRect();
  const onLyr = lyr && ev.clientY >= lyr.top && ev.clientY <= lyr.bottom;
  if (!onLogo && !onLyr) return;
  ev.preventDefault();
  const where = k => (o.look && k in o.look) ? o.look : S.config.look;         // a setting this video overrides is changed for this video
  const keys = onLogo ? ['logo_x', 'logo_y'] : ['lyrics_top'];
  const start = keys.map(k => L[k]), x0 = ev.clientX, y0 = ev.clientY;
  const mv = e => { const dx = (e.clientX - x0) / box.width, dy = (e.clientY - y0) / box.height;
    if (onLogo) { where('logo_x').logo_x = +Math.max(0, Math.min(.8, start[0] + dx)).toFixed(3); where('logo_y').logo_y = +Math.max(0, Math.min(.9, start[1] + dy)).toFixed(3); edLogo(true); }
    else { where('lyrics_top').lyrics_top = +Math.max(.02, Math.min(.85, start[0] + dy)).toFixed(3); ED.lastScreen = null; }
    mark(); };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); $$('[data-path]').forEach(bind); updatePreviews(); edRefreshSoon(); };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}

// ---------- opening the card ----------
function edOutputs() {
  $e('edOuts').innerHTML = OUT_NAMES.map(n => `<button class="small ${n === ED.out ? 'primary' : ''}" onclick="edSetOut('${n}')">${S.config.outputs[n].label.replace(/ \(.*\)/, '')}</button>`).join('');
}
function edSetOut(n) { ED.out = n; ED.planKey = ''; ED.plan = null; edOutputs(); edMsg(); edLoadPlan(); }
async function edOpen() {
  if (!S) return;
  ED.open = true;
  await FX.load();
  if (!ED.vid) {
    ED.vid = $e('edVid');
    ED.vid.addEventListener('seeked', () => { ED.tlDirty = true; });
    const cv = $e('edTL');
    cv.addEventListener('pointerdown', tlDown); cv.addEventListener('pointermove', tlMove); cv.addEventListener('pointerup', tlUp); cv.addEventListener('dblclick', tlDbl);
    $e('edTLWrap').addEventListener('scroll', () => edDrawTL());
    $e('edTLWrap').addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); edZoom(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false });
    $e('edStage').addEventListener('pointerdown', edStageDown);
    window.addEventListener('resize', () => { if (ED.open && ED.plan) { edSizeStage(); edDrawTL(); } });
    document.addEventListener('keydown', ev => {
      if (!ED.open || tapOn || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (ev.key === 'Escape' && document.activeElement && document.activeElement.id === 'edWords') document.activeElement.blur();
      const r = $e('s0').getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      if (ev.key === 'Escape') { if (ED.pop) edPopClose(); else if (ED.full) edFull(false); return; }
      if (ev.code === 'Space') { ev.preventDefault(); edPlay(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); edSeek(ED.vid.currentTime - (ev.shiftKey ? 0.1 : 1)); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); edSeek(ED.vid.currentTime + (ev.shiftKey ? 0.1 : 1)); }
    });
    cancelAnimationFrame(ED.raf); ED.raf = requestAnimationFrame(edFrame);
  }
  if (ED.song !== S.name) {        // another song: start afresh
    ED.song = S.name; ED.plan = null; ED.planKey = ''; ED.peaks = null; ED.sel = null; ED.proxy = null; ED.imgs = {}; ED.thumbs = {};
    ED.vid.removeAttribute('src'); ED.vid.dataset.src = ''; if (ED.stage) ED.stage.forget();
    const rv = S.files.raw_video;          // until the small copy is ready, play the raw video if the browser can
    if (rv && rv.exists && /\.mp4$/i.test(rv.file)) { ED.vid.src = `/media/${S.name}/${encodeURIComponent(rv.file)}?v=${rv.size}`; ED.vid.dataset.src = 'raw'; }
  }
  edOutputs(); edMsg(); edPanel();
  await edLoadPlan();
  if (ED.plan && ED.plan.ready && !ED.pxs) edFit(); else if (ED.plan && ED.plan.ready) edTLSize();
  edProxy(false);
}
function edClose() { ED.open = false; if (ED.vid) ED.vid.pause(); }
function edEditInterlude(n) {      // from the lists in steps 4 and 5: open the preview on this interlude
  const sec = $e('s0'); openCard(sec, true);
  setTimeout(() => { edSelect({ kind: 'interlude', n }); const p = ED.plan && ED.plan.pics.find(x => x.kind === 'interlude' && x.n === n); if (p) edSeek(p.start); sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
}

// ---------- changing the lyrics in the preview ----------
function edWords(id, text) {
  const lines = text.split('\n').map(x => x.trim()).filter(Boolean);
  if (typeof id === 'string') S.config.added_screens[+id.slice(1)].lines = lines;
  else { const t = S.config.screen_text = S.config.screen_text || {}; if (lines.length && lines.join('\n') !== SCR[id].lines.join('\n')) t[id] = lines; else delete t[id]; }
  mark(); edLocalWords(id, lines); edDrawTL();
}
function edLocalWords(id, lines) { const s = ED.plan && (ED.plan.screens || []).find(x => x.i === id); if (s && lines.length) { s.lines = lines; ED.lastScreen = null; } }
function edResetWords(id) { delete (S.config.screen_text || {})[id]; mark(); edLocalWords(id, SCR[id].lines); edPanel(); edDrawTL(); }
function edRemoveScreen(id) {
  if (typeof id === 'string') { S.config.added_screens.splice(+id.slice(1), 1); ED.sel = null; }
  else { const o = S.config.screen_off = S.config.screen_off || {}; o[id] = true; }
  mark(); renderDetected(); edRefreshSoon(0); edPanel(); edDrawTL(); toastEd('Screen removed. Click its outline on the timeline to bring it back.');
}
function edRestoreScreen(id) { delete (S.config.screen_off || {})[id]; mark(); renderDetected(); edRefreshSoon(0); edPanel(); edDrawTL(); }
function edAddScreen() {            // a new screen at the playhead, in the free time around it
  const t = ED.vid.currentTime, all = tlScreens();
  if (all.some(s => t >= s.start && t < s.end)) return toastEd('There is already a lyric screen here: move the playhead to a gap between screens.');
  const prev = all.filter(s => s.end <= t).pop(), next = all.find(s => s.start > t);
  const a = Math.max(t, prev ? prev.end + 0.05 : 0), b = Math.min(a + 3, next ? next.start - 0.05 : ED.plan.dur);
  if (b - a < 0.8) return toastEd('Not enough room here for a screen: move the playhead to a longer gap.');
  const A = S.config.added_screens = S.config.added_screens || [];
  A.push({ start: r2(a), end: r2(b), lines: ['Type the words here'] });
  mark(); edRefreshSoon(0); edSelect({ kind: 'screen', i: 'a' + (A.length - 1) });
  setTimeout(() => { const w = $e('edWords'); if (w) { w.focus(); w.select(); } }, 50);
}

// ---------- toolbar: InShot-style popups that change what is under the playhead ----------
function edTarget(t) {
  const P = ED.plan, p = P && P.pics.find(x => t >= x.start && t < x.end);
  if (p && p.kind === 'interlude') { const local = t - p.start; let j = 0; p.parts.forEach((q, i) => { if (local >= q.s + (i ? q.din / 2 : 0)) j = i; });
    return { kind: 'part', n: p.n, j, label: `interlude picture ${j + 1}${p.parts.length > 1 ? ' of ' + p.parts.length : ''} (${fmt(p.start)})` }; }
  if (p) return { kind: 'card', which: p.kind, label: p.kind === 'opening' ? 'the opening card' : 'the end card' };
  const c = edClipAt(t); return c ? { kind: 'clip', k: c.k, label: `her video${edClips().length > 1 ? ', part ' + (c.k + 1) : ''} (${fmt(c.start)} – ${fmt(c.end)})` } : null;
}
function fxOf(tg) { return tg.kind === 'part' ? ilPics(tg.n - 1)[tg.j] : (() => { const v = vcCfg(), n = edClips().length; while (v.fx.length < n) v.fx.push({}); return v.fx[tg.k]; })(); }
function edPop(kind) {
  ED.pop = kind; ED.popT = edTarget(ED.vid.currentTime); edPopRender();
  const pop = $e('edPop'), tl = $e('edTLWrap').getBoundingClientRect();   // above the timeline, so the timeline stays usable
  pop.style.maxHeight = Math.max(320, (tl.top > 200 ? tl.top : innerHeight) - 64 - 10) + 'px';
  pop.classList.add('on'); $$('#edTools button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
}
function edPopClose() { ED.pop = null; $e('edPop').classList.remove('on'); $$('#edTools button').forEach(b => b.classList.remove('on')); }
function edPopRender() {
  const box = $e('edPopBody'), kind = ED.pop, tg = ED.popT, t = ED.vid.currentTime;
  const head = (title, what) => { $e('edPopHead').innerHTML = `<b>${title}</b><small>${what ? 'for ' + esc(what) : ''}</small>`; };
  if (kind === 'filter' || kind === 'motion') {
    if (!tg || tg.kind === 'card') { head(kind === 'filter' ? 'Filter' : 'Motion', ''); box.innerHTML = `<div class="hint">The playhead is on ${tg ? tg.label : 'nothing'}. Move it onto her video or an interlude picture.</div>`; return; }
    const f = fxOf(tg), cur = kind === 'filter' ? (f.filter || 'original') : (f.motion || (tg.kind === 'part' ? (S.config.photo_motion || 'zoom_in') : 'still'));
    head(kind === 'filter' ? '🎨 Filter' : '✨ Motion', tg.label);
    if (kind === 'filter') {
      const groups = [...new Set(Object.values(FX.FILTERS).map(x => x.group))], pr = f.adjust || {};
      box.innerHTML = groups.map(gr => `<div class="popgrp">${gr}</div><div class="poptiles">${Object.values(FX.FILTERS).filter(x => x.group === gr).map(x =>
        `<div class="ptile ${x.id === cur ? 'on' : ''}" onclick="edSetFx('filter','${x.id}')"><canvas width="66" height="117" data-f="${x.id}"></canvas><small>${x.label}</small></div>`).join('')}</div>`).join('') +
        `<div class="slider" style="margin-top:10px"><span style="min-width:110px">Strength</span><input type="range" min="0" max="1" step="0.05" value="${f.amount == null ? 1 : f.amount}" oninput="fxOf(ED.popT).amount=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+' %';edFxChanged()"><output>${Math.round((f.amount == null ? 1 : f.amount) * 100)} %</output></div>
        <details style="margin-top:6px"><summary style="cursor:pointer;font-weight:700">Adjust (brightness, contrast, warmth…)</summary>${ADJ.map(([k, lab, mn, mx, st, d]) => { const v = pr[k] == null ? d : pr[k];
          return `<div class="slider"><span style="min-width:110px;font-size:14px">${lab}</span><input type="range" min="${mn}" max="${mx}" step="${st}" value="${v}" oninput="edAdjT('${k}',+this.value,${d});this.nextElementSibling.textContent=(+this.value).toFixed(2)"><output>${(+v).toFixed(2)}</output></div>`; }).join('')}
          <button class="small" onclick="delete fxOf(ED.popT).adjust;edFxChanged();edPopRender()">Reset adjustments</button></details>
        <div class="row" style="margin-top:12px"><button class="small" onclick="edFxAll('filter')">Use this filter for all ${tg.kind === 'part' ? 'interlude pictures' : 'of her video'}</button></div>`;
      edPopThumbs();
    } else {
      box.innerHTML = `<div class="poptiles">${Object.values(FX.MOTIONS).map(m => `<div class="ptile mo ${m.id === cur ? 'on' : ''}" onclick="edSetFx('motion','${m.id}')"><div class="moico" data-m="${m.id}"><i></i></div><small>${m.label}</small></div>`).join('')}</div>
        <div class="row" style="margin-top:12px"><button class="small" onclick="edFxAll('motion')">Use this motion for all ${tg.kind === 'part' ? 'interlude pictures' : 'of her video'}</button></div>
        <div class="hint">The motion runs over the whole ${tg.kind === 'part' ? 'picture' : 'part of her video'}. Split her video (✂) to move only one part.</div>`;
      edMotionIcons();
    }
    return;
  }
  if (kind === 'anim') {
    const s = edScreenNear(t); if (!s) { head('✨ Lyric animation', ''); box.innerHTML = '<div class="hint">No lyric screens yet.</div>'; return; }
    ED.popScreen = s.i; const cur = s.anim || S.config.text_anim.in;
    head('✨ Lyric animation', `lyric screen ${scrLabel(s)} (${fmt(s.start)})`);
    box.innerHTML = Anim.groups.map(gr => `<div class="popgrp">${gr}</div><div class="poptiles">${Anim.EFFECTS.filter(f => f.group === gr).map(f =>
      `<div class="ptile an ${f.id === cur ? 'on' : ''}" onclick="edSetAnim('${f.id}')"><div class="stage" data-a="${f.id}"></div><small>${f.label}</small></div>`).join('')}</div>`).join('') +
      `<div class="row" style="margin-top:12px"><button class="small" onclick="edAnimAll()">Use this animation for every screen</button></div>
      <div class="grid" style="margin-top:10px"><div><label class="l">Way out</label><select onchange="S.config.text_anim.out=this.value;mark();edRefreshSoon(0)"><option value="reverse" ${S.config.text_anim.out === 'reverse' ? 'selected' : ''}>Same animation backwards</option><option value="fade" ${S.config.text_anim.out === 'fade' ? 'selected' : ''}>Fade out</option><option value="cut" ${S.config.text_anim.out === 'cut' ? 'selected' : ''}>Disappear at once</option></select></div>
      <div><label class="l">Speed of the way in</label><div class="slider"><input type="range" min="0.1" max="1.5" step="0.05" value="${S.config.text_anim.in_seconds}" oninput="S.config.text_anim.in_seconds=+this.value;this.nextElementSibling.textContent=this.value+' s';mark();edRefreshSoon()"><output>${S.config.text_anim.in_seconds} s</output></div></div></div>`;
    edAnimTiles(); return;
  }
  if (kind === 'trans') {
    const c = edTransAt(t); if (!c) { head('🔀 Transition', ''); box.innerHTML = '<div class="hint">No transition near the playhead: transitions are where a card or an interlude picture comes and goes.</div>'; return; }
    ED.popTr = c; head('🔀 Transition', c.label);
    box.innerHTML = `<div class="row" style="margin-bottom:8px">${['Trending ★', ...Object.keys(TCAT).filter(k => k !== 'Trending ★'), 'All'].map(k => `<button class="small ${k === (ED.trCat || 'Trending ★') ? 'primary' : ''}" onclick="ED.trCat='${k}';edPopRender()">${k}</button>`).join('')}</div>
      <div class="poptiles">${TLIST.filter(n => FX.TRANSITIONS.includes(n) && ((ED.trCat || 'Trending ★') === 'All' || TCAT[ED.trCat || 'Trending ★'].test(n))).map(n => `<div class="ptile tr ${n === c.name ? 'on' : ''}" onclick="edSetTrans('${n}')"><div class="ph0" data-t="${n}">${tLabel(n)}</div><small>${tLabel(n)}</small></div>`).join('')}</div>
      <div class="slider" style="margin-top:10px"><span style="min-width:110px">Length</span><input type="range" min="0.2" max="2" step="0.1" value="${c.seconds}" oninput="edTransSec(+this.value);this.nextElementSibling.textContent=this.value+' s'"><output>${c.seconds} s</output></div>
      ${c.all ? `<div class="row" style="margin-top:10px"><button class="small" onclick="edTransAll()">${c.all}</button></div>` : ''}
      <div class="hint">Pick one and the preview plays the transition. The tiles play a short sample with two pictures from her video.</div>`;
    $$('#edPopBody .tr .ph0').forEach(x => tio.observe(x.parentElement));
    $$('#edPopBody .tr').forEach(card => card.dataset.t = card.querySelector('.ph0').dataset.t);
    return;
  }
  if (kind === 'text') { head('🔤 Text', 'all lyrics'); box.innerHTML = edTextTools(true); return; }
}
function edFxChanged() { mark(); renderDetected(); edRefreshSoon(150); ED.tlDirty = true; }
function edSetFx(key, v) { const f = fxOf(ED.popT); if (key === 'filter' && v === 'original') delete f.filter; else f[key] = v; edFxChanged(); edPopRender(); edPanel(); }
function edAdjT(k, v, d) { const q = fxOf(ED.popT); q.adjust = q.adjust || {}; if (Math.abs(v - d) < 1e-6) delete q.adjust[k]; else q.adjust[k] = v; if (!Object.keys(q.adjust).length) delete q.adjust; edFxChanged(); }
function edFxAll(key) {
  const f = fxOf(ED.popT), keys = key === 'filter' ? ['filter', 'amount', 'adjust'] : ['motion'];
  const copy = x => keys.forEach(k => { if (f[k] == null) delete x[k]; else x[k] = JSON.parse(JSON.stringify(f[k])); });
  if (ED.popT.kind === 'part') ED.plan.pics.filter(p => p.kind === 'interlude').forEach(p => ilPics(p.n - 1).forEach(copy));
  else { const v = vcCfg(); while (v.fx.length < edClips().length) v.fx.push({}); v.fx.forEach(copy); }
  edFxChanged(); toastEd('Done: used for all ' + (ED.popT.kind === 'part' ? 'interlude pictures' : 'parts of her video') + '.');
}
function edPopThumbs() {           // each filter on the current frame (her video) or the current picture, drawn by the preview's own code
  const tg = ED.popT; if (!ED.thumbStage) { const c = document.createElement('canvas'); try { ED.thumbStage = new FX.Stage(c); } catch (e) { return; } }
  const st = ED.thumbStage, base = tg.kind === 'part' ? (() => { const p = ED.plan.pics.find(x => x.kind === 'interlude' && x.n === tg.n), q = p && p.parts[tg.j], it = q && ED.imgs[q.url]; return it && it.ok ? it.im : null; })() : ED.vid;
  if (!base) return;
  const f = fxOf(tg);
  $$('#edPopBody canvas[data-f]').forEach(cv => { st.cv.width = cv.width; st.cv.height = cv.height; st.forget();
    const pr = FX.params({ filter: cv.dataset.f, amount: f.amount, adjust: f.adjust }), m = FX.matrix(pr);
    st.draw({ tex: st.layer(base, null, pr.bl * cv.width / 1080), m: m.m, o: m.o, v: pr.v, n: pr.n }, null, null, 0, 0); cv.getContext('2d').drawImage(st.cv, 0, 0); });
}
function edMotionIcons() {          // a small square moving the way each motion moves the picture
  const ics = $$('#edPopBody .moico'); cancelAnimationFrame(ED.moRaf); const t0 = performance.now();
  const loop = now => { if (!ED.pop) return; const u = ((now - t0) / 2200) % 1;
    ics.forEach(ic => { const m = FX.motion(ic.dataset.m, u), i = ic.firstElementChild, w = 100 / m.z;
      i.style.width = w + '%'; i.style.height = w + '%'; i.style.left = m.x * (100 - w) + '%'; i.style.top = m.y * (100 - w) + '%'; });
    ED.moRaf = requestAnimationFrame(loop); };
  ED.moRaf = requestAnimationFrame(loop);
}
function edAnimTiles() {
  const L = S.config.look, txt = S.config.language === 'hindi' ? 'बचपन की' : 'శ్రీకరమగు';
  animTiles = $$('#edPopBody .stage').map(st => { const id = st.dataset.a, fx = Anim.FX[id];
    st.innerHTML = '<div class="blk" style="position:absolute;left:3%;right:3%;top:16px">' + Anim.html([txt], { font: fontCss(L.lyrics_font), weight: L.lyrics_weight, size: 22, left: L.lyrics_fill_left, mid: L.lyrics_fill_mid, right: L.lyrics_fill_right, outline: L.lyrics_outline, ow: L.lyrics_outline_w, glow: L.lyrics_glow, lh: 1.35 }, fx.unit) + '</div>';
    Anim.prepare(st); return { st, id }; });
  startAnimLoop();
}
function edSetAnim(id) {
  const sid = ED.popScreen;
  if (typeof sid === 'string') S.config.added_screens[+sid.slice(1)].anim = id;
  else { const a = S.config.screen_anim = S.config.screen_anim || {}; if (id === S.config.text_anim.in) delete a[sid]; else a[sid] = id; }
  mark(); edRefreshSoon(0); ED.lastScreen = null; edPopRender(); edPanel(); edDrawTL();
  const s = tlScreens().find(x => x.i === sid); if (s) { edSeek(s.start); }
}
function edAnimAll() {
  const sid = ED.popScreen, s = tlScreens().find(x => x.i === sid), id = (s && s.anim) || S.config.text_anim.in;
  S.config.text_anim.in = id; S.config.screen_anim = {}; (S.config.added_screens || []).forEach(a => delete a.anim);
  mark(); renderAnim(); edRefreshSoon(0); ED.lastScreen = null; edPopRender(); toastEd('Every lyric screen now uses ' + (Anim.FX[id] || { label: id }).label + '.');
}
// the transition nearest the playhead, and where its setting is kept
function edTransAt(t) {
  const P = ED.plan, T = S.config.transitions, c = [];
  if (!P) return null;
  P.pics.forEach(p => {
    if (p.kind === 'opening') c.push({ at: p.end, name: p.tout, seconds: T.opening_to_video.seconds, label: 'opening card → her video', slot: 'opening_to_video', go: p.end - p.dout - 0.5 });
    if (p.kind === 'ending') c.push({ at: p.start, name: p.tin, seconds: T.video_to_end.seconds, label: 'her video → end card', slot: 'video_to_end', go: p.start - 0.5 });
    if (p.kind === 'interlude') {
      c.push({ at: p.start, name: p.tin, seconds: T.interlude_in.seconds, label: `into the interlude at ${fmt(p.start)}`, il: p.n, key: 'tin', slot: 'interlude_in', go: p.start - 0.5, all: 'Use it for going into every interlude' });
      c.push({ at: p.end, name: p.tout, seconds: T.interlude_out.seconds, label: `out of the interlude at ${fmt(p.end)}`, il: p.n, key: 'tout', slot: 'interlude_out', go: p.end - p.dout - 0.5, all: 'Use it for coming out of every interlude' });
      p.parts.slice(1).forEach((q, j) => c.push({ at: p.start + q.s, name: q.tin, seconds: q.din, label: `picture ${j + 1} → picture ${j + 2} (${fmt(p.start + q.s)})`, il: p.n, pj: j + 1, slot: 'picture_to_picture', go: p.start + q.s - 0.5, all: 'Use it between all pictures' }));
    } });
  if (!c.length) return null;
  return c.reduce((a, b) => Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a);
}
function edSetTrans(n) {
  const c = ED.popTr;
  if (c.pj != null) ilPics(c.il - 1)[c.pj].trans = n;
  else if (c.il != null) ilOv(c.il - 1)[c.key] = n;
  else S.config.transitions[c.slot].name = n;
  c.name = n; mark(); renderSlots(); renderDetected(); edRefreshSoon(0); edPopRender();
  setTimeout(() => { edSeek(Math.max(0, c.go)); ED.vid.play(); }, 450);   // play it
}
function edTransSec(v) {
  const c = ED.popTr;
  if (c.pj != null) ilPics(c.il - 1)[c.pj].trans_seconds = v; else S.config.transitions[c.slot].seconds = v;
  c.seconds = v; mark(); renderSlots(); edRefreshSoon();
}
function edTransAll() {
  const c = ED.popTr;
  if (c.pj != null) { S.config.transitions.picture_to_picture.name = c.name; ED.plan.pics.filter(p => p.kind === 'interlude').forEach(p => ilPics(p.n - 1).forEach(q => delete q.trans)); }
  else { S.config.transitions[c.slot].name = c.name; (S.config.interludes || []).forEach(o => o && delete o[c.key]); }
  mark(); renderSlots(); renderDetected(); edRefreshSoon(0); toastEd('Done: ' + tLabel(c.name) + ' everywhere.');
}
// keep the popup on what is under the playhead as it moves
function edPopFollow() {
  if (!ED.pop) return;
  const t = ED.vid.currentTime, tg = edTarget(t), key = JSON.stringify(tg) + (ED.pop === 'anim' ? (edScreenNear(t) || {}).i : '') + (ED.pop === 'trans' ? JSON.stringify(edTransAt(t) && edTransAt(t).label) : '');
  if (key !== ED.popKey) { ED.popKey = key; if (!ED.vid.paused && ED.pop === 'trans') return; ED.popT = tg; edPopRender(); }
}

// ---------- the editor fits the window: picture, tools and timeline on one screen ----------
function edFull(on) {
  ED.full = on == null ? !ED.full : on;
  $e('s0').classList.toggle('edfull', ED.full); document.body.style.overflow = ED.full ? 'hidden' : '';
  $e('edFullBtn').textContent = ED.full ? '✕ Close full screen' : '⛶ Full screen';
  if (ED.plan) { edSizeStage(); edFit(); }
}

function edEditHere() { const s = edScreenNear(ED.vid.currentTime); if (!s) return toastEd('No lyric screens yet.'); edSelect({ kind: 'screen', i: s.i }); if (ED.vid.currentTime < s.start || ED.vid.currentTime >= s.end) edSeek(s.start + 0.05);
  setTimeout(() => { const w = $e('edWords'); if (w) w.focus(); }, 50); }
function edPicsHere() {
  const t = ED.vid.currentTime, ils = (ED.plan ? ED.plan.pics : []).filter(p => p.kind === 'interlude');
  if (!ils.length) return toastEd('This video has no interludes. Gaps longer than the rule in step 5 get pictures.');
  const p = ils.reduce((a, b) => Math.min(Math.abs(b.start - t), Math.abs(b.end - t)) < Math.min(Math.abs(a.start - t), Math.abs(a.end - t)) || (t >= b.start && t < b.end) ? b : a);
  edSelect({ kind: 'interlude', n: p.n }); if (t < p.start || t >= p.end) edSeek(p.start + 0.05);
}
