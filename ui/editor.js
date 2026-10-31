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
  ED.plan.pics.filter(p => p.card).forEach(p => edLoadCard(p.card));
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
  // as tall as the window allows with the tools and timeline still in view; full screen (⛶): the whole screen
  const box = $e('edStage'), ar = P.size[0] / P.size[1], fs = document.fullscreenElement === $e('edStageBox');
  let h, w;
  if (fs) { h = innerHeight; w = Math.round(h * ar); if (w > innerWidth) { w = innerWidth; h = Math.round(w / ar); } }
  else {
    const room = innerHeight - tlH() - (ED.full ? 100 : 150), cardW = $e('s0').clientWidth - 48 - 84;   // 84: the play controls beside it
    h = Math.max(320, Math.min(side ? 640 : 1000, room)); w = Math.round(h * ar);
    const maxW = side ? cardW * 0.5 : cardW * 0.42;
    if (w > maxW) { w = Math.round(maxW); h = Math.round(w / ar); }
    box.style.width = w + 'px'; box.style.height = h + 'px';
    // measure: the card from its top to the timeline's bottom must fit in the window; shrink the picture by what is over
    const over = $e('edTLWrap').getBoundingClientRect().bottom - $e('s0').getBoundingClientRect().top - innerHeight + (ED.full ? 10 : 18);
    if (over > 0 && h - over >= 320) { h = Math.round(h - over); w = Math.round(h * ar); }
  }
  $e('edPanel').style.maxHeight = (h + 56) + 'px';
  if (!fs) $e('edLeft').style.width = (w + 84) + 'px';
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
  const cd = $e('edCard'); cd.style.width = gw + 'px'; cd.style.height = h + 'px';
  const inner = $e('edInner'); inner.style.width = cw + 'px'; inner.style.height = ch + 'px'; inner.style.transform = `scale(${gw / cw})`;
  ED.lastScreen = null; edLogo();
}
// her name: the picture the builder draws (plan.logo); while it is being dragged, a typed copy follows the pointer until the
// server has drawn it in its new place (the builder always writes the name, also when a logo picture is uploaded)
function edLogo(live) {
  if (!ED.plan) return;
  if (live) ED.logoLive = true;
  const L = edLook(), lg = ED.imgs[ED.plan.logo];
  if (L.logo_show === false) { $e('edLogo').innerHTML = ''; return; }   // switched off
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
  const L = Object.assign(edLook(), styleOf(s.i) || {}), eff = s.fx || P.anim.in, k = P.k, fx = Anim.FX[eff] || Anim.FX.fade;
  const ps = posOf(s.i), top = ps ? ps.y : L.lyrics_top, xo = ps ? ps.x : (+L.lyrics_x || 0);
  const key = JSON.stringify([s.i, s.lines, top, xo, L.lyrics_font, L.lyrics_weight, L.lyrics_size, L.lyrics_top, L.lyrics_fill_left, L.lyrics_fill_mid, L.lyrics_fill_right, L.lyrics_outline, L.lyrics_outline_w, L.lyrics_glow, eff, k, ED.fontsReady]);
  if (ED.lastScreen !== key) {
    const font = fontCss(L.lyrics_font);
    const [lines, size] = fitLines(s.lines, font, L.lyrics_weight, L.lyrics_size * k, P.canvas[0] * 0.9, L.lyrics_outline_w);
    box.innerHTML = `<div class="blk" style="position:absolute;left:${4 + xo * 100}%;right:${4 - xo * 100}%;top:${top * 100}%">` + Anim.html(lines, { font, weight: L.lyrics_weight, size, left: L.lyrics_fill_left, mid: L.lyrics_fill_mid,
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
  if (!p.parts) { const mo = FX.cardMotion(t - p.start); ED.lastPic = ED.lastPic || {};
    let tex = edTex(p.url, 0); if (tex) ED.lastPic[p.kind] = p.url; else if (ED.lastPic[p.kind]) tex = edTex(ED.lastPic[p.kind], 0);   // a redrawn card still loading: the last one meanwhile
    return [{ tex, ...mo }, null, null, 0]; }
  const local = t - p.start, ps = p.parts;
  for (let j = ps.length - 1; j >= 1; j--) {
    if (local >= ps[j].s && local < ps[j].s + ps[j].din) return [edPartLayer(ps[j - 1], local), edPartLayer(ps[j], local), ps[j].tin, (local - ps[j].s) / ps[j].din];
    if (local >= ps[j].s + ps[j].din) return [edPartLayer(ps[j], local), null, null, 0];
  }
  return [edPartLayer(ps[0], local), null, null, 0];
}
function edPictures(t, frame) {
  const P = ED.plan, cv = $e('edGL'); ED.cardOn = null;
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
  const still = !(p.tin && t < p.start + p.din) && !(p.tout && t >= p.end - p.dout);
  ED.lastCard = ED.lastCard || {};
  const cardUrl = p.card && (edCardReady(p) ? (ED.lastCard[p.kind] = p.card) : ED.lastCard[p.kind]);
  if (cardUrl && still) {                       // a card, standing: background here, text pieces as pictures above (edCardEls)
    const cd = ED.cards[cardUrl], mo = FX.cardMotion(t - p.start);
    a.tex = edTex(cd.bg, 0) || a.tex; ED.cardOn = { p: Object.assign({}, p, { card: cardUrl }), z: mo.z };
  }
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
  edLyrics(t); edTexts(t); edPictures(t, frame); edCardEls(); edEffects(t);
  if (ED.pop && performance.now() - (ED.popAt || 0) > 300) { ED.popAt = performance.now(); edPopFollow(); }
  const f = P.fade, a = P.clip[0], b = P.clip[1];
  $e('edFade').style.opacity = f > 0 ? Math.max(0, 1 - Math.min((t - a) / f, (b - t) / f)) : 0;
  // a clock with a fixed shape (m:ss.t), changed only when it changes: a clock that grows and shrinks shifts the tool row
  const clk = clock(t) + ' / ' + clock(P.dur), play = v.paused ? '▶' : '❚❚';
  if (clk !== ED.clk) { ED.clk = clk; $e('edTime').textContent = clock(t); $e('edDur').textContent = '/ ' + clock(P.dur); }
  if (play !== ED.playTxt) { ED.playTxt = play; $e('edPlay').textContent = play; }
  if (document.fullscreenElement) { $e('edMaxTime').textContent = clk; const sk = $e('edMaxSeek'); sk.max = P.dur; if (document.activeElement !== sk) sk.value = t; $e('edMaxPlay').textContent = v.paused ? '▶' : '❚❚'; }
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
const TL = { ruler: 20, wave: 30, eff: 22, txt: 22, vid: 24, lyr: 32, pic: 36, pad: 5 };
function tlH() { return TL.ruler + TL.wave + TL.eff + TL.txt + TL.vid + TL.lyr + TL.pic + TL.pad * 6; }
function tlX(t) { return GUT + t * ED.pxs - ED.scroll; }
function tlT(x) { return (x - GUT + ED.scroll) / ED.pxs; }
function edFit() { const P = ED.plan; if (!P) return; ED.pxs = Math.max(0.5, ($e('edTLWrap').clientWidth - GUT - 8) / P.dur); edTLSize(); }
function edZoom(f) {
  const w = $e('edTLWrap'), P = ED.plan; if (!P) return;
  const tc = ED.vid.currentTime, before = tlX(tc);
  ED.pxs = Math.max((w.clientWidth - GUT - 8) / P.dur, Math.min(400, ED.pxs * f)); edTLSize();
  w.scrollLeft = Math.max(0, GUT + tc * ED.pxs - before); edDrawTL();
}
function edTLSize() { const P = ED.plan; if (!P) return; $e('edTLSpace').style.width = Math.ceil(GUT + 8 + P.dur * ED.pxs) + 'px'; edDrawTL(); }
function tlRows() { const y0 = TL.ruler, ye = y0 + TL.wave + TL.pad, yt = ye + TL.eff + TL.pad, yv = yt + TL.txt + TL.pad, y1 = yv + TL.vid + TL.pad, y2 = y1 + TL.lyr + TL.pad;
  return { wave: [y0, TL.wave], eff: [ye, TL.eff], txt: [yt, TL.txt], vid: [yv, TL.vid], lyr: [y1, TL.lyr], pic: [y2, TL.pic] }; }
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
// the layers of the timeline: name, icon and colour (lane tint, blocks, name tag)
const TRK = { wave: ['🎵', 'Song', '#8b7fc0'], eff: ['💥', 'Effects', '#f0a020'], txt: ['🅣', 'Text', '#2b8fe6'], vid: ['🎬', 'Video', '#4b63d8'],
  lyr: ['🎤', 'Lyrics', '#9a52e8'], pic: ['🖼️', 'Pictures', '#14a593'] };
const GUT = 92;                     // the fixed column with the layer names
function shade(hx, f) {             // lighter (f > 0, towards white) or darker (f < 0, towards black)
  const c = [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16)); return hex(...c.map(v => f > 0 ? v + (255 - v) * f : v * (1 + f)));
}
function blockDraw(g, x, y, w, h, col, on, label, ink) {   // a rounded block with a soft top light, an edge and a shadow
  g.save(); g.shadowColor = 'rgba(30,10,60,.28)'; g.shadowBlur = 5; g.shadowOffsetY = 1.5;
  const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, shade(col, .28)); gr.addColorStop(1, col);
  g.fillStyle = gr; rr(g, x, y, w, h, 6); g.fill(); g.restore();
  g.strokeStyle = shade(col, -.25); g.lineWidth = 1; rr(g, x + .5, y + .5, w - 1, h - 1, 6); g.stroke();
  if (on) { g.save(); g.shadowColor = '#ff2d6f'; g.shadowBlur = 8; g.strokeStyle = '#fff'; g.lineWidth = 2.5; rr(g, x, y, w, h, 6); g.stroke(); g.restore(); g.strokeStyle = '#ff2d6f'; g.lineWidth = 1.2; rr(g, x - 1.5, y - 1.5, w + 3, h + 3, 7); g.stroke(); }
  if (label && w > 26) { g.save(); g.beginPath(); g.rect(x + 4, y, w - 8, h); g.clip(); g.fillStyle = ink || '#fff'; g.font = '700 11.5px Manrope,sans-serif';
    g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = ink ? 0 : 2; g.fillText(label, x + 7, y + h / 2 + 4); g.restore(); }
}
function edDrawTL() {
  const cv = $e('edTL'), wrap = $e('edTLWrap'); if (!cv || !ED.open) return;
  const P = ED.plan, W = wrap.clientWidth, H = tlH(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  ED.scroll = wrap.scrollLeft;
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cs = getComputedStyle(document.body), ink = cs.color, dark = matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.dataset.theme !== 'light';
  if (!P || !P.ready) { g.fillStyle = ink; g.font = '15px Manrope,sans-serif'; g.fillText(ED.err || 'Loading…', 12, 40); return; }
  const R = tlRows(), t0 = Math.max(0, tlT(GUT)), t1 = tlT(W), sel0 = ED.sel, sel = sel0;
  // lanes: each layer tinted in its own colour, with a thin line between layers
  Object.entries(R).forEach(([k, [y, h]]) => { g.fillStyle = TRK[k][2] + (dark ? '22' : '14'); g.fillRect(GUT, y - TL.pad / 2, W - GUT, h + TL.pad);
    g.fillStyle = TRK[k][2] + '40'; g.fillRect(GUT, y + h + TL.pad / 2 - .5, W - GUT, 1); });
  // ruler: seconds with small ticks between
  g.fillStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(80,40,140,.05)'; g.fillRect(GUT, 0, W - GUT, TL.ruler);
  const steps = [1, 2, 5, 10, 15, 30, 60], step = steps.find(s => s * ED.pxs >= 70) || 60, minor = step / 5;
  g.fillStyle = ink;
  for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) { const x = tlX(t); if (x < GUT) continue; g.globalAlpha = .25; g.fillRect(x, TL.ruler - 5, 1, 5); }
  g.font = '600 11px Manrope,sans-serif';
  for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) { const x = tlX(t); if (x < GUT) continue; g.globalAlpha = .5; g.fillRect(x, 4, 1, TL.ruler - 4); g.globalAlpha = .85; g.fillText(fmt(t), x + 4, 13); }
  g.globalAlpha = 1;
  // the part this video covers (the reel is a cut of the song)
  const [ca, cb] = P.clip;
  g.fillStyle = 'rgba(0,0,0,.2)'; if (ca > 0) g.fillRect(tlX(0), TL.ruler, tlX(ca) - tlX(0), H); if (cb < P.dur) g.fillRect(tlX(cb), TL.ruler, tlX(P.dur) - tlX(cb), H);
  // the song: loudness, and where her voice is
  const [wy, wh] = R.wave, wc = TRK.wave[2];
  if (ED.peaks) { const pk = ED.peaks.peaks, rate = ED.peaks.rate, gr = g.createLinearGradient(0, wy, 0, wy + wh); gr.addColorStop(0, shade(wc, .2)); gr.addColorStop(.5, wc); gr.addColorStop(1, shade(wc, .2)); g.fillStyle = gr;
    for (let x = GUT; x < W; x++) { const a = Math.floor(tlT(x) * rate), b = Math.max(a + 1, Math.floor(tlT(x + 1) * rate)); let m = 0; for (let k = a; k < b && k < pk.length; k++) m = Math.max(m, pk[k]); const h = m / 100 * (wh - 8) / 2; g.fillRect(x, wy + wh / 2 - 2 - h, 1, Math.max(1, h * 2)); } }
  g.fillStyle = '#20c9b5'; (P.voice || []).forEach(([a, b]) => { if (b < t0 || a > t1) return; const x = Math.max(GUT, tlX(a)); rr(g, x, wy + wh - 4, Math.max(2, tlX(b) - x), 3, 2); g.fill(); });
  // effects
  const [ey, eh] = R.eff;
  (S.config.effects || []).forEach((e, k) => { if (e.end < t0 || e.start > t1) return;
    const x = tlX(e.start), w = Math.max(4, tlX(e.end) - x);
    blockDraw(g, x, ey + 1, w, eh - 2, TRK.eff[2], sel0 && sel0.kind === 'effect' && sel0.k === k, (EFF_ICON[e.type] || '') + ' ' + ((FX_EFF[e.type] || {}).label || e.type), '#3a2200'); });
  // free text
  const [ty, th] = R.txt;
  (S.config.texts || []).forEach((x, k) => { if (x.end < t0 || x.start > t1) return;
    const xx = tlX(x.start), w = Math.max(4, tlX(x.end) - xx);
    blockDraw(g, xx, ty + 1, w, th - 2, TRK.txt[2], sel0 && sel0.kind === 'text' && sel0.k === k, '🅣 ' + (x.lines || [''])[0]); });
  // her video, in parts
  const [vy, vh] = R.vid;
  edClips().forEach(c => { if (c.end < t0 || c.start > t1) return;
    const x = tlX(c.start), w = Math.max(3, tlX(c.end) - x), f = c.fx;
    const lab = [(FX.FILTERS && FX.FILTERS[f.filter] && f.filter !== 'original') ? FX.FILTERS[f.filter].label : '', f.motion && f.motion !== 'still' && FX.MOTIONS[f.motion] ? FX.MOTIONS[f.motion].label : ''].filter(Boolean).join(' · ') || 'her video';
    blockDraw(g, x + 1, vy + 1, w - 2, vh - 2, c.plain ? shade(TRK.vid[2], .35) : TRK.vid[2], sel0 && sel0.kind === 'clip' && sel0.k === c.k, '🎬 ' + lab); });
  edClips().slice(1).forEach(c => { const x = tlX(c.start); g.fillStyle = '#fff'; g.fillRect(x - 1.5, vy - 1, 3, vh + 2); g.fillStyle = '#ff2d6f'; g.beginPath(); g.arc(x, vy + vh / 2, 4.5, 0, 7); g.fill(); });
  // lyric screens (orange: moved by you, pink: added); taken out: a faint dashed outline, click to bring back
  const [ly, lh] = R.lyr;
  edScreens(true).filter(s => s.off).forEach(s => { if (s.end < t0 || s.start > t1) return;
    const x = tlX(s.start), w = Math.max(3, tlX(s.end) - x); g.setLineDash([4, 3]); g.strokeStyle = TRK.lyr[2] + 'b0'; g.lineWidth = 1.5; rr(g, x + 1, ly + 4, w - 2, lh - 8, 6); g.stroke(); g.setLineDash([]);
    if (w > 30) { g.fillStyle = TRK.lyr[2]; g.font = '11px Manrope,sans-serif'; g.fillText('✕ ' + scrLabel(s), x + 6, ly + lh / 2 + 4); } });
  tlScreens().forEach(s => { if (s.end < t0 || s.start > t1) return;
    const x = tlX(s.start), w = Math.max(3, tlX(s.end) - x);
    blockDraw(g, x, ly + 2, w, lh - 4, s.added ? '#dc3c82' : s.manual ? '#e0960a' : TRK.lyr[2], sel && sel.kind === 'screen' && sel.i === s.i, scrLabel(s) + '  ' + (s.lines[0] || ''));
    g.fillStyle = 'rgba(255,255,255,.75)'; if (w > 14) { g.fillRect(x + 2, ly + 10, 2, lh - 20); g.fillRect(x + w - 4, ly + 10, 2, lh - 20); } });
  // pictures: cards and interludes
  const [py, ph] = R.pic;
  P.pics.forEach(p => { if (p.end < t0 || p.start > t1) return;
    const x = tlX(p.start), w = Math.max(3, tlX(p.end) - x), on = sel && ((sel.kind === 'interlude' && sel.n === p.n && p.kind === 'interlude') || (sel.kind === p.kind && p.kind !== 'interlude'));
    blockDraw(g, x, py + 2, w, ph - 4, p.kind === 'interlude' ? TRK.pic[2] : '#e2782a', on, '');
    (p.parts || [{ url: p.url, s: 0, e: p.end - p.start }]).forEach((q, j) => {
      const it = ED.imgs[q.url], qx = tlX(p.start + q.s), qw = tlX(p.start + q.e) - qx;
      if (it && it.ok && qw > 16) { const tw = Math.min(qw - 6, (ph - 10) * 9 / 16); g.save(); g.beginPath(); rr(g, qx + 4, py + 5, tw, ph - 10, 4); g.clip(); coverDraw(g, it.im, it.im.width, it.im.height, qx + 4, py + 5, tw, ph - 10); g.restore(); }
      if (j && p.kind === 'interlude') { const xb = tlX(p.start + partBound(p, j)); g.fillStyle = '#fff'; g.fillRect(xb - 1.5, py + 1, 3, ph - 2); g.beginPath(); g.arc(xb, py + ph / 2, 4.5, 0, 7); g.fill(); } });   // the line between two pictures: drag it
    const lab = p.kind === 'opening' ? 'Opening card' : p.kind === 'ending' ? 'End card' : `Interlude${(p.parts || []).length > 1 ? ' · ' + p.parts.length + ' pictures' : ''}`;
    if (w > 70) { g.save(); g.beginPath(); g.rect(x, py, w, ph); g.clip(); g.fillStyle = '#fff'; g.font = '700 11.5px Manrope,sans-serif'; g.shadowColor = '#000'; g.shadowBlur = 4;
      g.fillText(lab, x + Math.min(w - 60, (ph - 10) * 9 / 16 + 12), py + ph / 2 + 4); g.restore(); } });
  // pictures and cards switched off: faint outlines (click to bring back); transitions: small diamonds (click to change or delete)
  g.setLineDash([4, 3]); g.lineWidth = 1.5; g.strokeStyle = TRK.pic[2] + 'c0';
  edOffPics().forEach(o => { const x = tlX(o.start), w = Math.max(4, tlX(o.end) - x); rr(g, x + 1, py + 4, w - 2, ph - 8, 6); g.stroke();
    if (w > 40) { g.fillStyle = TRK.pic[2]; g.font = '11px Manrope,sans-serif'; g.fillText('✕ ' + o.label, x + 6, py + ph / 2 + 4); } });
  g.setLineDash([]);
  edTransList().forEach(c => { const x = tlX(c.at), on = sel0 && sel0.kind === 'trans' && sel0.key === c.key; if (x < GUT - 8 || x > W + 8) return;
    g.save(); g.translate(x, py + ph - 3); g.rotate(Math.PI / 4); g.fillStyle = c.name === 'cut' ? '#9a9a9a' : '#fff'; g.strokeStyle = on ? '#ff2d6f' : '#1f1a33'; g.lineWidth = on ? 3 : 1.5;
    g.fillRect(-6, -6, 12, 12); g.strokeRect(-6, -6, 12, 12); g.restore(); });
  // the layer names: a fixed column that does not scroll
  g.fillStyle = getComputedStyle($e('edTLWrap')).backgroundColor || '#fff'; g.fillRect(0, 0, GUT, H);
  g.fillStyle = dark ? 'rgba(255,255,255,.06)' : 'rgba(80,40,140,.06)'; g.fillRect(0, 0, GUT, H);
  Object.entries(R).forEach(([k, [y, h]]) => { const [ic, nm, col] = TRK[k];
    g.fillStyle = col; rr(g, 6, y + 1, 4, h - 2, 2); g.fill();
    g.fillStyle = ink; g.font = '700 12px Manrope,sans-serif'; g.fillText(ic + ' ' + nm, 15, y + h / 2 + 4); });
  g.fillStyle = TRK.lyr[2] + '55'; g.fillRect(GUT - 1, 0, 1, H);
  // playhead, with its time
  const tp = ED.vid.currentTime || 0, xh = tlX(tp);
  if (xh >= GUT - 1) { g.fillStyle = '#ff2d6f'; g.fillRect(xh - 1, 0, 2, H);
    if (!(ED.drag && ED.drag.label)) { const lab = clock(tp); g.font = '700 11px Manrope,sans-serif'; const tw = g.measureText(lab).width + 10, lx = Math.max(GUT, Math.min(W - tw - 2, xh - tw / 2));
      g.fillStyle = '#ff2d6f'; rr(g, lx, 1, tw, TL.ruler - 3, 5); g.fill(); g.fillStyle = '#fff'; g.fillText(lab, lx + 5, 13); } }
  // follow the playhead while playing
  if (!ED.vid.paused && !ED.drag && (xh > W - 40 || xh < GUT)) { wrap.scrollLeft = Math.max(0, tp * ED.pxs - 60); }
  if (ED.drag && ED.drag.label) { const d = ED.drag; g.font = 'bold 13px Manrope,sans-serif'; const tw = g.measureText(d.label).width + 14;
    const lx = Math.max(GUT, Math.min(W - tw - 2, d.lx - tw / 2)); g.fillStyle = '#1f1a33'; rr(g, lx, d.ly - 26, tw, 22, 6); g.fill(); g.fillStyle = '#fff'; g.fillText(d.label, lx + 7, d.ly - 10); }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, Math.min(r, w / 2)) : g.rect(x, y, w, h); }

// what is under the pointer on the timeline
function tlHit(x, y) {
  const R = tlRows(), t = Math.max(0, tlT(x)), edge = 9;
  if (x < GUT) return { kind: 'time', t: ED.vid.currentTime, zone: 'none', gutter: true };
  const inRow = r => y >= R[r][0] && y < R[r][0] + R[r][1];
  if (inRow('txt')) for (let k = (S.config.texts || []).length - 1; k >= 0; k--) { const e = S.config.texts[k], a = tlX(e.start), b = tlX(e.end);
    if (x >= a - 3 && x <= b + 3) return { kind: 'text', k, e, zone: x - a < edge && b - a > 2 * edge ? 'start' : b - x < edge && b - a > 2 * edge ? 'end' : 'move' }; }
  if (inRow('eff')) for (let k = (S.config.effects || []).length - 1; k >= 0; k--) { const e = S.config.effects[k], a = tlX(e.start), b = tlX(e.end);
    if (x >= a - 3 && x <= b + 3) return { kind: 'effect', k, e, zone: x - a < edge && b - a > 2 * edge ? 'start' : b - x < edge && b - a > 2 * edge ? 'end' : 'move' }; }
  if (inRow('pic') && y > R.pic[0] + R.pic[1] - 14) for (const c of edTransList()) if (Math.abs(x - tlX(c.at)) < 8) return { kind: 'trans', c, zone: 'none' };
  if (inRow('vid')) { for (const c of edClips().slice(1)) if (Math.abs(x - tlX(c.start)) < 7) return { kind: 'cut', k: c.k - 1, zone: 'ew' };
    const c = edClipAt(t); if (c) return { kind: 'clip', k: c.k, c, zone: 'none' }; }
  if (inRow('lyr')) for (const s of tlScreens()) { const a = tlX(s.start), b = tlX(s.end);
    if (x >= a - edge / 2 && x <= b + edge / 2) return { kind: 'screen', i: s.i, s, zone: x - a < edge && b - a > 2 * edge ? 'start' : b - x < edge && b - a > 2 * edge ? 'end' : x - a < edge ? 'start' : b - x < edge ? 'end' : 'move' }; }
  if (inRow('pic')) for (const o of edOffPics()) if (x >= tlX(o.start) && x <= tlX(o.end) && !(ED.plan.pics || []).some(p => x >= tlX(p.start) && x <= tlX(p.end))) return { kind: 'off', o, zone: 'none' };
  if (inRow('lyr')) for (const s of edScreens(true).filter(s => s.off)) if (x >= tlX(s.start) && x <= tlX(s.end)) return { kind: 'screen', i: s.i, s, zone: 'none' };
  if (inRow('pic') && ED.plan) for (const p of ED.plan.pics) for (let j = 1; j < (p.parts || []).length; j++) {
    const xb = tlX(p.start + partBound(p, j)); if (Math.abs(x - xb) < 6) return { kind: 'pbound', p, j, zone: 'ew' }; }
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
  const blk = h.p || h.e;
  ED.drag = { h, x0: x, moved: false, lx: x, ly: y, s0: blk ? blk.start : null, e0: blk ? blk.end : null };   // where the block was when the drag began
  if (h.kind === 'time' && !h.gutter) { edSeek(tlT(x)); ED.drag.scrub = true; }
}
function tlMove(ev) {
  const cv = $e('edTL'), r = cv.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
  const d = ED.drag;
  if (!d) { const h = tlHit(x, y); cv.style.cursor = h.kind === 'time' ? 'pointer' : h.zone === 'move' ? 'grab' : h.zone === 'none' ? 'pointer' : 'ew-resize'; return; }
  d.lx = x; d.ly = y;
  if (d.scrub) { edSeek(Math.max(0, tlT(x))); return; }
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
  } else if (h.kind === 'pbound') {
    const p = ED.plan.pics.find(x => x.kind === 'interlude' && x.n === h.p.n), pics = ilPics(p.n - 1), len = p.end - p.start;
    if (!d.b0) d.b0 = partLens(p);                                    // each picture's length when the drag began
    const L = d.b0.slice(), lo = 1, cut = L.slice(0, h.j).reduce((a, b) => a + b, 0);
    const nb = Math.max(cut - L[h.j - 1] + lo, Math.min(cut + L[h.j] - lo, cut + dt));
    L[h.j - 1] = nb - (cut - L[h.j - 1]); L[h.j] = L[h.j] - (nb - cut);
    pics.forEach((q, j) => q.weight = Math.round(L[j] * 100) / 100);
    p.parts.forEach((q, j) => Object.assign(q, partTimes(p, j)));
    d.label = `picture ${h.j}: ${L[h.j - 1].toFixed(1)} s · picture ${h.j + 1}: ${L[h.j].toFixed(1)} s`; edSeek(p.start + nb);
  } else if (h.kind === 'effect' || h.kind === 'text') {
    const e = (h.kind === 'text' ? S.config.texts : S.config.effects)[h.k], len = d.e0 - d.s0;
    if (h.zone === 'start') e.start = r2(Math.max(0, Math.min(d.e0 - 0.2, d.s0 + dt)));
    else if (h.zone === 'end') e.end = r2(Math.min(ED.plan.dur, Math.max(d.s0 + 0.2, d.e0 + dt)));
    else { e.start = r2(Math.max(0, Math.min(ED.plan.dur - len, d.s0 + dt))); e.end = r2(e.start + len); }
    d.label = fmt(e.start) + ' – ' + fmt(e.end); edSeek(h.zone === 'end' ? Math.max(e.start, e.end - 0.5) : e.start);
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
    else if (h.kind === 'effect') { edSelect({ kind: 'effect', k: h.k }); edSeek(h.e.start); }
    else if (h.kind === 'text') { edSelect({ kind: 'text', k: h.k }); edSeek(h.e.start + Math.min(1, (h.e.end - h.e.start) / 2)); }
    else if (h.kind === 'trans') { edSelect({ kind: 'trans', key: h.c.key }); edSeek(Math.max(0, h.c.go)); edPop('trans', h.c); }
    else if (h.kind === 'off') { edSelect({ kind: 'off', o: h.o }); edSeek(h.o.start); }
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
  if (!sel || !P || !P.ready) { box.innerHTML = `<div class="hint" style="margin:0">Click a block on the timeline, or the words on the picture, and its settings show here. How it all works: the <b>i</b> next to “Preview &amp; edit”.</div>`; return; }
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
      ${posOf(sel.i) ? `<div class="row" style="margin-top:8px"><span class="chip">Has its own place on the picture</span><button class="small" onclick="setPos(${id},null);mark();ED.lastScreen=null;edRefreshSoon(0);edPanel()">Back to where all lyrics are</button></div>` : ''}
      ${edStyleTools(sel.i)}
      <div class="hint" style="margin-top:8px">Double-click the words on the picture to type there. While this screen is selected, dragging the words on the picture moves only this screen. Move it in time on the timeline.</div>`;
    return;
  }
  if (sel.kind === 'clip') {
    const c = edClips()[sel.k]; if (!c) { ED.sel = null; return edPanel(); }
    const f = c.fx, n = edClips().length;
    box.innerHTML = `<h3 style="margin-top:0">Her video${n > 1 ? `, part ${sel.k + 1} of ${n}` : ''} <small class="hint">${fmt(c.start)} – ${fmt(c.end)}</small></h3>
      <div class="row"><button class="small" onclick="edPop('filter')">🎨 Filter: ${esc((FX.FILTERS[f.filter || 'original'] || FX.FILTERS.original).label)}</button>
      <button class="small" onclick="edPop('motion')">✨ Motion: ${esc((FX.MOTIONS[f.motion || 'still'] || FX.MOTIONS.still).label)}</button></div>
      <div class="row" style="margin-top:10px"><button class="small" onclick="edSplit()">✂ Split at the playhead</button>${sel.k < n - 1 ? `<button class="small" onclick="edJoin(${sel.k})">Join with the next part</button>` : ''}
      <button class="small" onclick="edDelete()">🗑 ${sel.k ? 'Delete this cut' : 'Remove filter and motion'}</button><button class="small" onclick="edSelect(null)">Done</button></div>
      <div class="hint" style="margin-top:8px">Split her video (✂) to give each part its own filter and motion. Drag a cut (the white line on the video row) to move it.</div>`;
    return;
  }
  if (sel.kind === 'cardel') { box.innerHTML = edPiecePanel(sel); return; }
  if (sel.kind === 'logo') {
    const L = S.config.look, on = L.logo_show !== false;
    box.innerHTML = `<h3 style="margin-top:0">✍️ Her name <small class="hint">on every video, at the top</small></h3>
      <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} onchange="S.config.look.logo_show=this.checked;mark();edLogo(true);edRefreshSoon(0);edPanel()"> Show her name on the video</label>
      ${on ? `<label class="l" style="margin-top:8px">Words</label><input type="text" value="${esc(L.logo_text)}" oninput="S.config.look.logo_text=this.value;mark();edLogo(true);edRefreshSoon()">
      <div class="popgrp">Font</div><div class="fonttiles">${fontList('script').map(f => `<div class="ftile ${f === L.logo_font ? 'on' : ''}" onclick="S.config.look.logo_font='${f.replace(/'/g, "\\'")}';mark();edLogo(true);edRefreshSoon();edPanel()"><b style="font-family:${fontCss(f)}">${esc((L.logo_text || 'Soujanya').split(' ')[0])}</b><small>${esc(f)}</small></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><b>Size</b><button class="small" onclick="S.config.look.logo_size=Math.max(.06,+(S.config.look.logo_size-.02).toFixed(2));mark();edLogo(true);edRefreshSoon();edPanel()">−</button><b>${Math.round(L.logo_size * 100)}</b><button class="small" onclick="S.config.look.logo_size=Math.min(.6,+(S.config.look.logo_size+.02).toFixed(2));mark();edLogo(true);edRefreshSoon();edPanel()">+</button></div>
      <div class="popgrp">Colours</div><div class="pals">${PAL.name.map(([n, v]) => `<div class="pal" style="min-width:76px;padding:5px" onclick="styleTab='name';pickPal('${n.replace(/'/g, "\\'")}');edLogo(true);edRefreshSoon();edPanel()"><i style="height:22px;background:linear-gradient(90deg,${v[0]},${v[1]},${v[2]})"></i><small>${n}</small></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="small" onclick="edNameHome()">Back to the usual place (top left)</button></div>
      <div class="hint" style="margin-top:8px"><b>Drag her name on the picture</b> to place it anywhere (it shows on the whole video). More colour settings: step 6, “Her name”.</div>` : ''}
      <div class="row" style="margin-top:8px"><button class="small" onclick="edSelect(null)">Done</button></div>`;
    return;
  }
  if (sel.kind === 'opening' || sel.kind === 'ending') {
    const k = sel.kind, O = S.credits.opening, lab = S.credits.labels[S.config.language] || ['', '', '', ''], E = S.credits.ending;
    const fld = (path, label, v) => `<div><label class="l">${label}</label><input type="text" value="${esc(v || '')}" oninput="set('${path}',this.value);mark();edRefreshSoon()"></div>`;
    box.innerHTML = `<h3 style="margin-top:0">${k === 'opening' ? 'Opening card' : 'End card'} <small class="hint">the card redraws a second after you type</small></h3>
      ${k === 'opening' ? `<div class="grid" style="gap:8px">${fld('credits.opening.title_line', 'Title', O.title_line)}${fld('credits.opening.cover_by', 'Cover by', O.cover_by)}
        ${fld('credits.opening.film', lab[0] || 'Film', O.film)}${fld('credits.opening.lyricist', lab[1] || 'Lyricist', O.lyricist)}${fld('credits.opening.music', lab[2] || 'Music', O.music)}${fld('credits.opening.singers', lab[3] || 'Singers', O.singers)}</div>
        <details style="margin-top:6px"><summary style="cursor:pointer;font-weight:700">The words in front of each credit</summary><div class="grid" style="gap:8px">${lab.map((x, i) => `<div><label class="l">${['Film', 'Lyricist', 'Music', 'Singers'][i]}</label><input type="text" value="${esc(x)}" oninput="S.credits.labels[S.config.language][${i}]=this.value;mark();edRefreshSoon()"></div>`).join('')}</div></details>`
      : `<div class="grid" style="gap:8px">${fld('credits.ending.name', 'Name', E.name)}</div>
        <label class="l" style="margin-top:8px">Extra lines (one per line; “Label: words” shows as two lines)</label><textarea style="min-height:70px" oninput="S.credits.ending.extra_lines=this.value.split('\\n').map(x=>x.trim()).filter(Boolean);mark();edRefreshSoon()">${esc((E.extra_lines || []).join('\n'))}</textarea>
        <label class="switch"><input type="checkbox" ${E.show_song_credits ? 'checked' : ''} onchange="S.credits.ending.show_song_credits=this.checked;mark();edRefreshSoon()"> Show the original song's credits under her name</label>`}
      <div class="grid" style="margin-top:8px"><div><label class="l">Lasts (min:sec)</label>${tinp(`config.${k}.seconds`, 6, 92)}</div>
      <div><label class="l">Photo behind it</label><select data-path="config.${k}.photo" class="photoSel"></select></div></div>
      <div class="popgrp">Font of the card's words</div><div class="fonttiles">${fontList(k === 'opening' ? 'lang' : 'script').map(f => { const key = k === 'opening' ? 'credits_font' : 'end_font';
        return `<div class="ftile ${f === S.config.look[key] ? 'on' : ''}" onclick="S.config.look.${key}='${f.replace(/'/g, "\\'")}';mark();edRefreshSoon();edPanel()"><b style="font-family:${fontCss(f)}">${esc((k === 'opening' ? (O.title_line || S.config.title || 'Title') : (E.name || 'Soujanya')).slice(0, 12))}</b><small>${esc(f)}</small></div>`; }).join('')}</div>
      <div class="row" style="margin-top:8px"><button class="small" onclick="edDelete()">🗑 Delete card</button><button class="small" onclick="edSelect(null)">Done</button></div>`;
    $$('#edPanel [data-path]').forEach(bind); fillPhotoSelects(); return;
  }
  if (sel.kind === 'text') {
    const x = (S.config.texts || [])[sel.k]; if (!x) { ED.sel = null; return edPanel(); }
    const id = `'t${sel.k}'`;
    box.innerHTML = `<h3 style="margin-top:0">🅣 Text <small class="hint">${fmt(x.start)} – ${fmt(x.end)}</small></h3>
      <label class="l">Words (one line per line on screen)</label><textarea id="edWords" style="font-size:19px;min-height:70px" oninput="edWords(${id},this.value)">${esc((x.lines || []).join('\n'))}</textarea>
      <div class="row" style="margin-top:8px"><label class="l" style="margin:0">Animation</label><select onchange="S.config.texts[${sel.k}].anim=this.value||undefined;mark();ED.txtKey={};edRefreshSoon(0)"><option value="">Same as the lyrics</option>${Anim.groups.map(gr => `<optgroup label="${gr}">${Anim.EFFECTS.filter(f => f.group === gr).map(f => `<option value="${f.id}" ${f.id === x.anim ? 'selected' : ''}>${f.label}</option>`).join('')}</optgroup>`).join('')}</select>
      <button class="small" onclick="edSeek(${x.start});ED.vid.play()">▶ Play it</button><button class="small" onclick="edDelete()">🗑 Delete</button><button class="small" onclick="edSelect(null)">Done</button></div>
      ${edStyleTools(`t${sel.k}`)}
      <div class="hint" style="margin-top:8px">Drag the words on the picture to place them, double-click them to type there. On the timeline (blue “text” row) drag the block to move it in time and its ends to set how long it shows.</div>`;
    return;
  }
  if (sel.kind === 'effect') {
    const e = (S.config.effects || [])[sel.k]; if (!e) { ED.sel = null; return edPanel(); }
    box.innerHTML = `<h3 style="margin-top:0">${EFF_ICON[e.type] || ''} ${esc((FX_EFF[e.type] || {}).label || e.type)} <small class="hint">${fmt(e.start)} – ${fmt(e.end)}</small></h3>
      <div class="row"><button class="small" onclick="edPop('effects')">💥 Change the effect</button><button class="small" onclick="edSeek(${e.start});ED.vid.play()">▶ Play it</button>
      <button class="small" onclick="edDelete()">🗑 Delete</button><button class="small" onclick="edSelect(null)">Done</button></div>
      <div class="slider" style="margin-top:10px"><span style="min-width:110px">Strength</span><input type="range" min="0.2" max="2" step="0.1" value="${e.amount == null ? 1 : e.amount}" oninput="S.config.effects[${sel.k}].amount=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+' %';mark()"><output>${Math.round((e.amount == null ? 1 : e.amount) * 100)} %</output></div>
      <div class="hint">Drag it on the orange row to move it, drag its ends to change its length.</div>`;
    return;
  }
  if (sel.kind === 'trans') {
    const c = edTransList().find(x => x.key === sel.key); if (!c) { ED.sel = null; return edPanel(); }
    box.innerHTML = `<h3 style="margin-top:0">🔀 Transition: ${esc(tLabel(c.name))}</h3><div class="hint">${esc(c.label)}</div>
      <div class="row"><button class="small" onclick="edPop('trans', edTransList().find(x => x.key === '${c.key}'))">Change it</button><button class="small" onclick="edSeek(${Math.max(0, c.go)});ED.vid.play()">▶ Play it</button>
      <button class="small" onclick="edDelete()">🗑 Delete (straight cut)</button><button class="small" onclick="edSelect(null)">Done</button></div>`;
    return;
  }
  if (sel.kind === 'off') {
    const o = sel.o;
    box.innerHTML = `<h3 style="margin-top:0">${esc(o.label)} (deleted)</h3><div class="hint">${fmt(o.start)} – ${fmt(o.end)}${o.kind === 'interlude' ? ': her video plays here now.' : ''}</div>
      <div class="row"><button class="primary small" onclick='edRestore(${JSON.stringify(o)})'>Bring it back</button><button class="small" onclick="edSelect(null)">Done</button></div>`;
    return;
  }
  const g = sel.n - 1, ov = ilOv(g), pics = ilPics(g), T = S.config.transitions, it = P.pics.find(p => p.kind === 'interlude' && p.n === sel.n);
  const opt = (cur, def) => trOptions(cur, def);
  box.innerHTML = `<h3 style="margin-top:0">Interlude (gap ${sel.n})${it ? ` · ${fmt(it.start)} – ${fmt(it.end)}` : ' · <span style="color:var(--warn)">not in this video</span>'}</h3>
    <div class="grid"><div><label class="l">Transition in</label><select onchange="ilOv(${g}).tin=this.value||undefined;edChanged()">${opt(ov.tin, T.interlude_in.name)}</select></div>
    <div><label class="l">Transition out</label><select onchange="ilOv(${g}).tout=this.value||undefined;edChanged()">${opt(ov.tout, T.interlude_out.name)}</select></div></div>
    <div class="edpics">${pics.map((q, j) => edPicCard(g, q, j, pics.length)).join('')}</div>
    <div class="row" style="margin-top:10px"><button class="primary small" onclick="ilPics(${g}).push({photo:''});edChanged();edPanel()">+ Add a picture</button>
    <button class="small" onclick="photoIn.click()">Upload photos</button><button class="small" onclick="edDelete()">🗑 Delete interlude</button><button class="small" onclick="edSelect(null)">Done</button></div>
    <div class="hint" style="margin-top:6px">The pictures follow one another. Drag the white line between two pictures on the timeline (or type a length) to show one longer; drag the interlude's ends to stretch them all. Each has its own filter, motion and transition from the picture before it.</div>`;
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
        ${n > 1 ? `<div><label class="l">Shows for (seconds)</label><input type="number" min="1" step="0.5" style="width:90px" value="${(() => { const p = ED.plan && ED.plan.pics.find(x => x.kind === 'interlude' && x.n === g + 1); return p ? partLens(p)[j].toFixed(1) : ''; })()}" onchange="edSetPicLen(${g + 1},${j},this.value)"></div>` : ''}
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
function posOf(id) {               // a screen's own place on the picture ({x, y}), or undefined
  if (isText(id)) { const x = S.config.texts[+id.slice(1)]; return x && (x.pos || { x: 0, y: 0.72 }); }
  if (typeof id === 'string') { const a = (S.config.added_screens || [])[+id.slice(1)]; return a && a.pos; }
  return (S.config.screen_pos || {})[id];
}
function setPos(id, v) {
  if (isText(id)) { S.config.texts[+id.slice(1)].pos = v || { x: 0, y: 0.72 }; return; }
  if (typeof id === 'string') { const a = S.config.added_screens[+id.slice(1)]; if (v) a.pos = v; else delete a.pos; }
  else { const P = S.config.screen_pos = S.config.screen_pos || {}; if (v) P[id] = v; else delete P[id]; }
}
// drag the lyrics (up, down, sideways) or her name on the picture. With a lyric screen selected, only that screen moves.
function edTextAt(ev) {             // the free text under the pointer, topmost first
  const els = [...($e('edTxt') || { children: [] }).children].reverse();
  for (const el of els) { const b = el.firstElementChild && el.firstElementChild.getBoundingClientRect(); if (!b) continue;
    const ln = [...el.querySelectorAll('.ln')].map(x => x.getBoundingClientRect()); const l = Math.min(...ln.map(r => r.left)), r = Math.max(...ln.map(r => r.right));
    if (ev.clientY >= b.top && ev.clientY <= b.bottom && ev.clientX >= l - 10 && ev.clientX <= r + 10) return el.dataset.t; }
  return null;
}
function edStageDown(ev) {
  if (!ED.plan || ev.target.id === 'edInline' || (ev.target.closest && ev.target.closest('.cardpiece'))) return;
  const tid = edTextAt(ev);
  if (tid) {                          // a free text: click selects it, drag places it
    ev.preventDefault(); const k = +tid.slice(1), box = $e('edOver').getBoundingClientRect(), p0 = Object.assign({ x: 0, y: 0.72 }, S.config.texts[k].pos), x0 = ev.clientX, y0 = ev.clientY; let moved = false;
    const mv = e => { const dx = (e.clientX - x0) / box.width, dy = (e.clientY - y0) / box.height; if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 4) moved = true; if (!moved) return;
      S.config.texts[k].pos = { x: +Math.max(-.4, Math.min(.4, p0.x + dx)).toFixed(3), y: +Math.max(0, Math.min(.95, p0.y + dy)).toFixed(3) }; ED.txtKey = {}; mark(); };
    const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); ED.vid.pause(); edSelect({ kind: 'text', k }); if (moved) edRefreshSoon(); };
    document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); return;
  }
  const box = $e('edOver').getBoundingClientRect(), x = (ev.clientX - box.left) / box.width;
  if (x < 0 || x > 1) return;
  const L = edLook(), o = edOutCfg();
  const lh = $e('edLogoHit'), logoHit = lh && lh.firstElementChild && lh.firstElementChild.getBoundingClientRect();
  const onLogo = logoHit && ev.clientX >= logoHit.left && ev.clientX <= logoHit.right && ev.clientY >= logoHit.top && ev.clientY <= logoHit.bottom;
  const lyr = $e('edLyr').firstElementChild && $e('edLyr').firstElementChild.getBoundingClientRect();
  const onLyr = lyr && ev.clientY >= lyr.top && ev.clientY <= lyr.bottom;
  if (!onLogo && !onLyr) {            // a card on the picture: its words open on the left
    const pc = (ED.plan.pics || []).find(q => q.kind !== 'interlude' && ED.vid.currentTime >= q.start && ED.vid.currentTime < q.end);
    if (pc) { ED.vid.pause(); edSelect({ kind: pc.kind }); }
    return;
  }
  ev.preventDefault();
  const where = k => (o.look && k in o.look) ? o.look : S.config.look;         // a setting this video overrides is changed for this video
  const s = edScreenAt(ED.vid.currentTime), own = onLyr && s && ED.sel && ED.sel.kind === 'screen' && ED.sel.i === s.i;
  const p0 = own ? (posOf(s.i) || { x: +L.lyrics_x || 0, y: L.lyrics_top }) : { x: +L.lyrics_x || 0, y: L.lyrics_top };
  const lg0 = [L.logo_x, L.logo_y], x0 = ev.clientX, y0 = ev.clientY;
  const mv = e => { const dx = (e.clientX - x0) / box.width, dy = (e.clientY - y0) / box.height;
    if (onLogo) { where('logo_x').logo_x = +Math.max(0, Math.min(.8, lg0[0] + dx)).toFixed(3); where('logo_y').logo_y = +Math.max(0, Math.min(.9, lg0[1] + dy)).toFixed(3); edLogo(true); }
    else { const np = { x: +Math.max(-.3, Math.min(.3, p0.x + dx)).toFixed(3), y: +Math.max(.02, Math.min(.85, p0.y + dy)).toFixed(3) };
      if (own) setPos(s.i, np); else { where('lyrics_top').lyrics_top = np.y; where('lyrics_x').lyrics_x = np.x; }
      ED.lastScreen = null; }
    mark(); };
  let moved = false; const mv0 = mv; const mv2 = e => { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 4) moved = true; if (moved) mv0(e); };
  const up = () => { document.removeEventListener('pointermove', mv2); document.removeEventListener('pointerup', up);
    if (!moved) { ED.vid.pause(); if (onLogo) edSelect({ kind: 'logo' }); else if (onLyr && s) edSelect({ kind: 'screen', i: s.i }); return; }      // a click: select it
    $$('[data-path]').forEach(bind); updatePreviews(); edRefreshSoon(); if (own) edPanel();
    toastEd(own ? 'Moved this screen only (its own place).' : onLogo ? 'Moved her name.' : 'Moved all lyrics. Click one screen first to move only that one.'); };
  document.addEventListener('pointermove', mv2); document.addEventListener('pointerup', up); return;
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}
// double-click the lyrics on the picture to type the words there
function edInline(ev) {
  const tid = ev && edTextAt(ev);
  if (tid) return edInlineText(tid);
  const s = ED.plan && edScreenAt(ED.vid.currentTime), blk = $e('edLyr').firstElementChild;
  if (!s || !blk) return;
  const r = blk.getBoundingClientRect(), st = $e('edStage').getBoundingClientRect();
  if (ev && (ev.clientY < r.top || ev.clientY > r.bottom)) return;
  ED.vid.pause(); edSelect({ kind: 'screen', i: s.i });
  const old = $e('edInline'); if (old) old.remove();
  const ta = document.createElement('textarea'); ta.id = 'edInline';
  ta.value = (edScreens(true).find(x => x.i === s.i) || s).lines.join('\n');
  const w = Math.max(r.width + 16, st.width * 0.8);
  Object.assign(ta.style, { left: Math.max(4, (st.width - w) / 2) + 'px', top: Math.max(4, r.top - st.top - 8) + 'px', width: w + 'px', height: Math.max(60, r.height + 16) + 'px' });
  $e('edStage').appendChild(ta); ta.focus(); ta.select();
  ta.oninput = () => { edWords(s.i, ta.value); const pw = $e('edWords'); if (pw) pw.value = ta.value; };
  ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ta.blur(); };
  ta.onblur = () => { ta.remove(); edPanel(); };
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
  FX_EFF = Object.fromEntries(FX.load_effects().map(e => [e.id, e]));
  if (!ED.noiseTile) {                 // grey grain for the Noise and Retro DV effects (the builder adds random grain too)
    const c = document.createElement('canvas'); c.width = c.height = 200; const g = c.getContext('2d'), im = g.createImageData(200, 200);
    for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (Math.random() - .5) * 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    g.putImageData(im, 0, 0); ED.noiseTile = c.toDataURL(); $e('edFxNoise').style.backgroundImage = `url(${ED.noiseTile})`;
    // the warm light of "Light leak", as fx.overlay_png("leak"): strength (1 - d)^1.6, d = distance from the top-left corner / 1.2
    const st = []; for (let i = 0; i <= 20; i++) { const d = i / 20, f = Math.pow(1 - d, 1.6); st.push(`rgba(255,150,60,${f.toFixed(4)}) ${(d * 1.2 / Math.SQRT2 * 100).toFixed(2)}%`); }
    $e('edFxLeak').style.background = `radial-gradient(ellipse farthest-corner at 0 0, ${st.join(',')}, rgba(255,150,60,0))`;
  }
  if (!ED.favs) edLoadFavs();
  if (!ED.vid) {
    ED.vid = $e('edVid');
    ED.vid.addEventListener('seeked', () => { ED.tlDirty = true; });
    const cv = $e('edTL');
    cv.addEventListener('pointerdown', tlDown); cv.addEventListener('pointermove', tlMove); cv.addEventListener('pointerup', tlUp); cv.addEventListener('dblclick', tlDbl);
    $e('edTLWrap').addEventListener('scroll', () => edDrawTL());
    $e('edTLWrap').addEventListener('wheel', e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); edZoom(e.deltaY < 0 ? 1.25 : 0.8); } }, { passive: false });
    $e('edStage').addEventListener('pointerdown', edStageDown);
    $e('edCard').addEventListener('pointerdown', edCardDown);
    $e('edStage').addEventListener('pointermove', edHoverName); $e('edStage').addEventListener('pointerleave', () => { $e('edHover').style.display = 'none'; });
    $e('edStage').addEventListener('dblclick', edInline);
    window.addEventListener('resize', () => { if (ED.open && ED.plan) { edSizeStage(); edDrawTL(); } });
    document.addEventListener('keydown', ev => {
      if (!ED.open || tapOn || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (ev.key === 'Escape' && document.activeElement && document.activeElement.id === 'edWords') document.activeElement.blur();
      const r = $e('s0').getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      if (ev.key === 'Escape') { if (ED.pop) edPopClose(); else if (ED.full) edFull(false); return; }
      if (ev.code === 'Space') { ev.preventDefault(); edPlay(); }
      else if ((ev.key === 'Delete' || ev.key === 'Backspace') && ED.sel) { ev.preventDefault(); edDelete(); }
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
  if (isText(id)) { S.config.texts[+id.slice(1)].lines = lines; mark(); ED.txtKey = {}; return; }
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
function edPop(kind, trans) {
  ED.pop = kind; ED.popT = edTarget(ED.vid.currentTime); ED.popFixed = trans || null; edPopRender();
  const pop = $e('edPop');                                          // beside the picture, as tall as it
  pop.style.maxHeight = Math.max(320, $e('edStage').getBoundingClientRect().height + 60) + 'px';
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
    const c = ED.popFixed || edTransAt(t); if (!c) { head('🔀 Transition', ''); box.innerHTML = '<div class="hint">No transition near the playhead: transitions are where a card or an interlude picture comes and goes.</div>'; return; }
    ED.popTr = c; head('🔀 Transition', c.label);
    box.innerHTML = `<div class="row" style="margin-bottom:8px">${['Trending ★', ...Object.keys(TCAT).filter(k => k !== 'Trending ★'), 'All'].map(k => `<button class="small ${k === (ED.trCat || 'Trending ★') ? 'primary' : ''}" onclick="ED.trCat='${k}';edPopRender()">${k}</button>`).join('')}</div>
      <div class="poptiles"><div class="ptile tr ${c.name === 'cut' ? 'on' : ''}" onclick="edSetTrans('cut')"><div class="ph0" style="font-size:22px">✕</div><small>None (cut)</small></div>${TLIST.filter(n => FX.TRANSITIONS.includes(n) && ((ED.trCat || 'Trending ★') === 'All' || TCAT[ED.trCat || 'Trending ★'].test(n))).map(n => `<div class="ptile tr ${n === c.name ? 'on' : ''}" onclick="edSetTrans('${n}')"><div class="ph0" data-t="${n}">${tLabel(n)}</div><small>${tLabel(n)}</small></div>`).join('')}</div>
      <div class="slider" style="margin-top:10px"><span style="min-width:110px">Length</span><input type="range" min="0.2" max="2" step="0.1" value="${c.seconds}" oninput="edTransSec(+this.value);this.nextElementSibling.textContent=this.value+' s'"><output>${c.seconds} s</output></div>
      ${c.all ? `<div class="row" style="margin-top:10px"><button class="small" onclick="edTransAll()">${c.all}</button></div>` : ''}
      <div class="hint">Pick one and the preview plays the transition. The tiles play a short sample with two pictures from her video.</div>`;
    $$('#edPopBody .tr').forEach(card => { const n = card.querySelector('.ph0').dataset.t; if (n) { card.dataset.t = n; tio.observe(card); } });
    return;
  }
  if (kind === 'text') { const s = edScreenNear(t); head('🔤 Text', s ? `lyric screen ${scrLabel(s)} or all lyrics` : 'all lyrics'); box.innerHTML = edStyleTools(s ? s.i : null, true); return; }
  if (kind === 'effects') {
    const sel = ED.sel && ED.sel.kind === 'effect' ? ED.sel.k : (S.config.effects || []).findIndex(e => t >= e.start && t < e.end);
    const e = sel >= 0 ? S.config.effects[sel] : null; ED.popEff = sel;
    head('💥 Effects', e ? `the ${(FX_EFF[e.type] || {}).label} effect at ${fmt(e.start)} (pick another to change it)` : `a new effect from ${fmt(t)}`);
    const groups = [...new Set(Object.values(FX_EFF).map(x => x.group))];
    box.innerHTML = groups.map(gr => `<div class="popgrp">${gr}</div><div class="poptiles">${Object.values(FX_EFF).filter(x => x.group === gr).map(x =>
      `<div class="ptile ${e && e.type === x.id ? 'on' : ''}" onclick="edSetEffect('${x.id}')"><div class="effico">${EFF_ICON[x.id]}</div><small>${x.label}</small></div>`).join('')}</div>`).join('') +
      (e ? `<div class="slider" style="margin-top:12px"><span style="min-width:110px">Strength</span><input type="range" min="0.2" max="2" step="0.1" value="${e.amount == null ? 1 : e.amount}" oninput="S.config.effects[${sel}].amount=+this.value;this.nextElementSibling.textContent=Math.round(this.value*100)+' %';mark()"><output>${Math.round((e.amount == null ? 1 : e.amount) * 100)} %</output></div>
      <div class="row" style="margin-top:10px"><button class="small" onclick="edSeek(${e.start});ED.vid.play()">▶ Play it</button><button class="small" onclick="ED.sel={kind:'effect',k:${sel}};edDelete()">🗑 Delete this effect</button><button class="small" onclick="ED.sel=null;edPopRender()">+ Add another</button></div>` : '') +
      `<div class="hint" style="margin-top:8px">An effect covers the whole picture, lyrics included, for its stretch of time (2 seconds when added). Drag it on the orange effects row to move it or change its length.</div>`;
    return;
  }
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
function edTransList() {
  const P = ED.plan, T = S.config.transitions, c = [];
  if (!P) return c;
  P.pics.forEach(p => {
    if (p.kind === 'opening') c.push({ key: 'open', at: p.end, name: p.tout, seconds: T.opening_to_video.seconds, label: 'opening card → her video', slot: 'opening_to_video', go: p.end - p.dout - 0.5 });
    if (p.kind === 'ending') c.push({ key: 'end', at: p.start, name: p.tin, seconds: T.video_to_end.seconds, label: 'her video → end card', slot: 'video_to_end', go: p.start - 0.5 });
    if (p.kind === 'interlude') {
      c.push({ key: 'in' + p.n, at: p.start, name: p.tin, seconds: T.interlude_in.seconds, label: `into the interlude at ${fmt(p.start)}`, il: p.n, ik: 'tin', slot: 'interlude_in', go: p.start - 0.5, all: 'Use it for going into every interlude' });
      c.push({ key: 'out' + p.n, at: p.end, name: p.tout, seconds: T.interlude_out.seconds, label: `out of the interlude at ${fmt(p.end)}`, il: p.n, ik: 'tout', slot: 'interlude_out', go: p.end - p.dout - 0.5, all: 'Use it for coming out of every interlude' });
      p.parts.slice(1).forEach((q, j) => c.push({ key: 'pp' + p.n + '_' + (j + 1), at: p.start + q.s, name: q.tin, seconds: q.din, label: `picture ${j + 1} → picture ${j + 2} (${fmt(p.start + q.s)})`, il: p.n, pj: j + 1, slot: 'picture_to_picture', go: p.start + q.s - 0.5, all: 'Use it between all pictures' }));
    } });
  return c;
}
function edTransAt(t) { const c = edTransList(); return c.length ? c.reduce((a, b) => Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a) : null; }
function edSetTrans(n) {
  const c = ED.popTr;
  if (c.pj != null) ilPics(c.il - 1)[c.pj].trans = n;
  else if (c.il != null) ilOv(c.il - 1)[c.ik] = n;
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
  else { S.config.transitions[c.slot].name = c.name; (S.config.interludes || []).forEach(o => o && delete o[c.ik]); }
  mark(); renderSlots(); renderDetected(); edRefreshSoon(0); toastEd('Done: ' + tLabel(c.name) + ' everywhere.');
}
// keep the popup on what is under the playhead as it moves
function edPopFollow() {
  if (!ED.pop || ED.popFixed) return;
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

// ---------- effects over a stretch of time: the same formulas as the builder's (fx.effect_chain), drawn with CSS/SVG on the whole picture ----------
let FX_EFF = {};
const EFF_ICON = { shake: '〰️', zoom: '🔍', glitch: '📺', flash: '⚡', dip: '🌑', strobe: '◐', invert: '🔄', rgb: '🌈', blur: '💭', oldfilm: '🎞️', vhs: '📼',
  heartbeat: '💓', zoompunch: '👊', dizzy: '😵', swing: '🎐', earthquake: '🌋', rgbshake: '🔴', flicker: '💡', fadeinblack: '🌘', fadeoutblack: '🌒', fadeinwhite: '🌕', fadeoutwhite: '⬜',
  lightleak: '🌅', spotlight: '🔦', rainbow: '🌈', bwfade: '🖤', contrast: '◑', noise: '📡', retrodv: '📹', letterbox: '🎬', blurin: '🌫️', blurout: '😶‍🌫️' };
const frc = x => x - Math.floor(x);
function rnd(v) { const r = Math.sin(v * 12.9898) * 43758.5453; return r - Math.floor(r); }
function edEffects(t) {
  const wrap = $e('edFxWrap'), P = ED.plan; if (!wrap || !P) return;
  const st = $e('edStage'), sw = st.clientWidth, sh = st.clientHeight, W = P.size[0];
  let add = 0, gray = false, inv = false, blur = 0, rgb = 0, sep = false, sat = 1, dx = 0, dy = 0, sc = 1, rot = 0, hueDeg = 0, hueSat = 1, con = 1, bars = 0, scan = false, spot = 0, leak = 0, noise = 0;
  (S.config.effects || []).forEach(e => { if (!(t >= e.start && t < e.end) || !FX_EFF[e.type]) return;
    const k = e.amount == null ? 1 : +e.amount, T = t - e.start, len = e.end - e.start;
    switch (e.type) {
      case 'flash': add += 0.55 * k * Math.pow(1 - frc(2 * T), 2); break;
      case 'dip': add -= k * Math.sin(Math.PI * T / Math.max(0.01, len)); break;
      case 'strobe': gray = gray || Math.floor(8 * T) % 2 === 1; break;
      case 'invert': inv = true; break;
      case 'blur': blur += 8 * k * W / 1080; break;
      case 'rgb': rgb += Math.max(1, Math.round(10 * k * W / 1080)); break;
      case 'oldfilm': sep = true; add += 0.05 * k * Math.sin(2 * Math.PI * 11 * T) * Math.sin(2 * Math.PI * 3.3 * T + 0.5); break;
      case 'vhs': rgb += Math.max(1, Math.round(5 * k * W / 1080)); sat *= 1.3; sc *= 1.01; dy += 0.004 * k * Math.sin(2 * Math.PI * 13 * T); break;
      case 'shake': { const A = 0.012 * k; sc *= 1 + 2.4 * A; dx += A * Math.sin(2 * Math.PI * 9.3 * T); dy += 0.6 * A * Math.sin(2 * Math.PI * 7.1 * T + 1); break; }
      case 'zoom': sc *= 1 + 0.08 * k * Math.pow(1 - frc(2 * T), 3); break;
      case 'fadeinblack': add -= k * (1 - T / Math.max(.01, len)); break;
      case 'fadeoutblack': add -= k * T / Math.max(.01, len); break;
      case 'fadeinwhite': add += k * (1 - T / Math.max(.01, len)); break;
      case 'fadeoutwhite': add += k * T / Math.max(.01, len); break;
      case 'flicker': add += 0.15 * k * Math.sin(2 * Math.PI * 9 * T) * Math.sin(2 * Math.PI * 4.7 * T + 1); break;
      case 'rainbow': hueDeg += 120 * T; break;
      case 'bwfade': hueSat *= Math.max(0, 1 - k * T / Math.max(.01, len)); break;
      case 'contrast': con *= 1 + 0.35 * k; break;
      case 'noise': noise += 35 * k; break;
      case 'retrodv': rgb += Math.max(1, Math.round(3 * k * W / 1080)); noise += 20 * k; scan = true; break;
      case 'letterbox': bars = Math.max(bars, 0.12 * k); break;
      case 'spotlight': spot = Math.max(spot, Math.min(1, 0.95 * k)); break;
      case 'lightleak': leak = Math.max(leak, Math.min(1, 0.85 * k)); break;
      case 'blurin': case 'blurout': { const j = Math.min(7, Math.floor(T / Math.max(.01, len) * 8)), f = e.type === 'blurin' ? 1 - (j + .5) / 8 : (j + .5) / 8; blur += 14 * k * f * W / 1080; break; }
      case 'rgbshake': if (frc(T * 6) < .5) rgb += Math.max(1, Math.round(14 * k * W / 1080)); break;
      case 'earthquake': { const A = 0.03 * k; sc *= 1 + 2.4 * A; dx += A * Math.sin(2 * Math.PI * 13 * T); dy += 0.6 * A * Math.sin(2 * Math.PI * 11 * T + 1); break; }
      case 'heartbeat': { const ph = T - 0.8 * Math.floor(T / 0.8), b = x => Math.exp(-(x / .06) * (x / .06)); sc *= 1 + 0.07 * k * (b(ph) + 0.7 * b(ph - .22)); break; }
      case 'zoompunch': sc *= 1 + 0.2 * k * (1 - Math.pow(1 - Math.min(T / .35, 1), 3)); break;
      case 'dizzy': sc *= 1.18; rot += 0.06 * k * Math.sin(2 * Math.PI * 1.2 * T); dx += 0.02 * k * Math.sin(2 * Math.PI * 0.8 * T); break;
      case 'swing': sc *= 1.2; rot += 0.09 * k * Math.sin(2 * Math.PI * 0.9 * T); break;
      case 'glitch': { sc *= 1.04; const seed = Math.round(e.start * 10), j = Math.floor(T * 10);
        if (rnd(j * 7.13 + seed) > 0.6) { rgb += Math.max(1, Math.round(16 * k * W / 1080)); dx += (rnd(j * 3.7 + seed + 1) - 0.5) * 0.06 * k; } break; }
    } });
  const f = [];
  if (hueDeg || hueSat !== 1) { $e('edHueM').setAttribute('values', hueMatrix(hueDeg, hueSat)); f.push('url(#edHue)'); }
  if (con !== 1) f.push(`contrast(${con})`);
  if (sep) f.push('sepia(1)');
  if (sat !== 1) f.push(`saturate(${sat})`);
  if (add) { ['R', 'G', 'B'].forEach(c => $e('edAdd' + c).setAttribute('intercept', add)); f.push('url(#edAdd)'); }
  if (gray) f.push('url(#edGray)');
  if (inv) f.push('invert(1)');
  if (rgb) { const d = rgb * sw / W; $e('edRGBr').setAttribute('dx', -d); $e('edRGBb').setAttribute('dx', d); f.push('url(#edRGB)'); }
  if (blur) f.push(`blur(${blur * sw / W}px)`);
  wrap.style.filter = f.join(' ') || 'none';
  wrap.style.transform = dx || dy || sc !== 1 || rot ? `translate(${-dx * sw}px, ${-dy * sh}px) rotate(${rot}rad) scale(${sc})` : 'none';
  // pictures laid over the frame (as the builder's overlays): cinema bars, scanlines, spotlight, warm light, grain
  const ov = $e('edFxOver');
  if (ov) {
    const L = [];
    if (bars) L.push(`linear-gradient(#000 0 ${bars * 50}%, transparent ${bars * 50}% ${100 - bars * 50}%, #000 ${100 - bars * 50}%)`);
    if (scan) { const st = Math.max(2, Math.round(4 * W / 1080)) * sh / P.size[1]; L.push(`repeating-linear-gradient(rgba(0,0,0,.28) 0 ${st / 4}px, rgba(0,0,0,.14) ${st / 4}px ${st / 2}px, transparent ${st / 2}px ${st}px)`); }
    if (spot) { const stops = []; for (let i = 0; i <= 10; i++) { const d = .3 + .7 * i / 10, q = (d - .3) / .7; stops.push(`rgba(0,0,0,${(spot * q * q).toFixed(3)}) ${(d * 100).toFixed(1)}%`); }   // 100% = the corners, as the builder's vignette
      L.push(`radial-gradient(ellipse farthest-corner at 50% 50%, transparent 30%, ${stops.join(',')})`); }
    ov.style.background = L.join(',') || 'none';
    const lk = $e('edFxLeak'); lk.style.opacity = leak;
    const nz = $e('edFxNoise'); nz.style.opacity = Math.min(1, noise / 90); if (noise) nz.style.backgroundPosition = `${Math.floor(Math.random() * 200)}px ${Math.floor(Math.random() * 200)}px`;
  }
}
function edSetEffect(type) {
  const E = S.config.effects = S.config.effects || [], t = ED.vid.currentTime;
  let k = ED.popEff;
  if (k != null && k >= 0 && E[k]) E[k].type = type;
  else { E.push({ type, start: r2(t), end: r2(Math.min(ED.plan.dur, t + 2)) }); k = E.length - 1; }
  mark(); ED.sel = { kind: 'effect', k }; edPanel(); edDrawTL(); edPopRender();
  edSeek(E[k].start); ED.vid.play();
}

// ---------- delete what is selected (or bring it back) ----------
function edOffPics() {            // interludes and cards that were switched off, where they would be
  const out = [], C = S.config, P = ED.plan; if (!P) return out;
  (candidateGaps() || []).filter(g => g.mode === 'no' && g.len > 1.5).forEach(g => out.push({ kind: 'interlude', n: g.i + 1, start: g.start, end: g.end, label: 'interlude' }));
  if (C.opening.enabled === false) out.push({ kind: 'opening', start: 0, end: Math.min(+C.opening.seconds || 6, P.dur / 3), label: 'opening card' });
  if (C.ending.enabled === false) { const l = Math.min(+C.ending.seconds || 6, P.dur / 3); out.push({ kind: 'ending', start: P.dur - l, end: P.dur, label: 'end card' }); }
  return out;
}
function edDelete() {
  const sel = ED.sel; if (!sel) return toastEd('Click a block on the timeline first, then Delete.');
  const C = S.config, done = m => { mark(); renderDetected(); edRefreshSoon(0); edDrawTL(); edPanel(); toastEd(m); };
  if (sel.kind === 'screen') return edRemoveScreen(sel.i);
  if (sel.kind === 'effect') { C.effects.splice(sel.k, 1); ED.sel = null; return done('Effect deleted.'); }
  if (sel.kind === 'text') { C.texts.splice(sel.k, 1); ED.sel = null; ED.txtKey = {}; return done('Text deleted.'); }
  if (sel.kind === 'interlude') { ilOv(sel.n - 1).on = false; ED.sel = null; return done('Interlude deleted: her video plays there. Click its outline to bring it back.'); }
  if (sel.kind === 'opening' || sel.kind === 'ending') { C[sel.kind].enabled = false; ED.sel = null; return done((sel.kind === 'opening' ? 'Opening' : 'End') + ' card deleted. Click its outline to bring it back.'); }
  if (sel.kind === 'trans') { const c = edTransList().find(x => x.key === sel.key); if (c) { ED.popTr = c; edSetTrans('cut'); } ED.sel = null; return done('Transition deleted: a straight cut now.'); }
  if (sel.kind === 'clip') {
    const v = vcCfg(); while (v.fx.length < edClips().length) v.fx.push({});
    if (sel.k > 0) { v.cuts.sort((a, b) => a - b); v.cuts.splice(sel.k - 1, 1); v.fx.splice(sel.k, 1); ED.sel = { kind: 'clip', k: sel.k - 1 }; return done('That part of her video is joined to the one before it (her video itself is never cut out: the song goes on).'); }
    v.fx[0] = {}; return done('Filter and motion of this part removed.');
  }
  if (sel.kind === 'off') return;
}
function edRestore(o) {
  if (o.kind === 'interlude') { const ov = ilOv(o.n - 1); ov.on = true; }
  else S.config[o.kind].enabled = true;
  ED.sel = null; mark(); renderDetected(); edRefreshSoon(0); edPanel(); edDrawTL();
}

// ---------- the preview full screen (⛶): picture only, with play, back/forward and a time bar that hide when the mouse rests ----------
function edMax() {
  const bx = $e('edStageBox');
  if (document.fullscreenElement) document.exitFullscreen(); else bx.requestFullscreen().catch(e => toastEd('Full screen is not allowed here: ' + e.message));
}
document.addEventListener('fullscreenchange', () => { if (!ED.plan) return; ED.lastScreen = null; setTimeout(() => { edSizeStage(); edLogo(); }, 60); });
document.addEventListener('mousemove', () => { if (!document.fullscreenElement) return; const bar = $e('edMaxBar'); bar.classList.remove('idle'); clearTimeout(ED.idleT); ED.idleT = setTimeout(() => bar.classList.add('idle'), 2500); });

// ---------- text style: for all lyrics, or for one screen (screen_style / added_screens[].style) ----------
const STYLE_KEYS = ['lyrics_font', 'lyrics_weight', 'lyrics_size', 'lyrics_fill_left', 'lyrics_fill_mid', 'lyrics_fill_right', 'lyrics_outline', 'lyrics_outline_w', 'lyrics_glow'];
function styleOf(id) {
  if (id == null) return null;
  if (isText(id)) { const x = S.config.texts[+id.slice(1)]; return x && x.style; }
  if (typeof id === 'string') { const a = (S.config.added_screens || [])[+id.slice(1)]; return a && a.style; }
  return (S.config.screen_style || {})[id];
}
function setStyle(id, vals) {             // vals: {key: value}; to all lyrics (id null or "all") or to this screen
  if (isText(id)) { const x = S.config.texts[+id.slice(1)]; x.style = Object.assign(x.style || {}, vals); }
  else if (ED.styleAll || id == null) { Object.assign(S.config.look, vals); renderStyle(); renderAnim(); updatePreviews(); }
  else if (typeof id === 'string') { const a = S.config.added_screens[+id.slice(1)]; a.style = Object.assign(a.style || {}, vals); }
  else { const st = S.config.screen_style = S.config.screen_style || {}; st[id] = Object.assign(st[id] || {}, vals); }
  mark(); ED.lastScreen = null; edRefreshSoon(); edPanel(); if (ED.pop === 'text') edPopRender();
}
function clearStyle(id) {
  if (isText(id)) delete S.config.texts[+id.slice(1)].style; else if (typeof id === 'string') delete S.config.added_screens[+id.slice(1)].style; else delete (S.config.screen_style || {})[id];
  mark(); ED.lastScreen = null; edRefreshSoon(); edPanel(); if (ED.pop === 'text') edPopRender();
}
function edStyleTools(id, wide) {
  if (ED.styleAll == null) ED.styleAll = true;
  const own = styleOf(id), all = !isText(id) && (id == null || ED.styleAll), L = Object.assign({}, S.config.look, all ? {} : own || {});
  const words = isText(id) ? (S.config.texts[+id.slice(1)].lines || [''])[0] : id != null ? ((edScreens(true).find(x => x.i === id) || {}).lines || [''])[0] : (S.config.language === 'hindi' ? 'बचपन की' : 'శ్రీకరమగు');
  const sample = (words || '').slice(0, 14), jid = typeof id === 'string' ? `'${id}'` : id;
  const fonts = fontList('lang');
  return `<div class="edstyle${wide ? ' wide' : ''}">
    ${id != null && !isText(id) ? `<div class="row" style="margin:8px 0"><b>Text style for</b><button class="small ${all ? 'primary' : ''}" onclick="ED.styleAll=true;edPanel();if(ED.pop==='text')edPopRender()">All lyrics</button><button class="small ${all ? '' : 'primary'}" onclick="ED.styleAll=false;edPanel();if(ED.pop==='text')edPopRender()">Only this screen</button>
      ${own ? `<button class="small" onclick="clearStyle(${jid})">Undo this screen's own style</button>` : ''}</div>` : ''}
    <div class="popgrp" id="edIdeasHead">✨ Colour ideas for this background <button class="small" onclick="edIdeas(${jid})">${ED.ideas && ED.ideas.id === id ? 'Look again' : 'Find ideas'}</button></div><div class="pals" id="edIdeas">${ED.ideas && ED.ideas.id === id ? ED.ideas.html : ''}</div>
    <div class="popgrp">Font</div><div class="fonttiles">${fonts.map(f => `<div class="ftile ${f === L.lyrics_font ? 'on' : ''}" onclick="setStyle(${jid},{lyrics_font:'${f.replace(/'/g, "\\'")}'})"><b style="font-family:${fontCss(f)};font-weight:${L.lyrics_weight}">${esc(sample)}</b><small>${esc(f)}</small></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><b>Size</b><button class="small" onclick="setStyle(${jid},{lyrics_size:Math.max(30,${L.lyrics_size}-4)})">−</button><b>${L.lyrics_size}</b><button class="small" onclick="setStyle(${jid},{lyrics_size:Math.min(140,${L.lyrics_size}+4)})">+</button>
      <b style="margin-left:10px">Weight</b><select onchange="setStyle(${jid},{lyrics_weight:+this.value})">${[[400, 'Regular'], [500, 'Medium'], [600, 'Semi-bold'], [700, 'Bold']].map(([v, n]) => `<option value="${v}" ${+L.lyrics_weight === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="slider" style="margin-top:6px"><span style="min-width:110px">Outline</span><input type="range" min="0" max="0.2" step="0.005" value="${L.lyrics_outline_w}" onchange="setStyle(${jid},{lyrics_outline_w:+this.value})"><output>${Math.round(L.lyrics_outline_w * 100)} %</output></div>
    <div class="popgrp">Colours</div><div class="pals">${PAL.lyrics.map(([n, v]) => palTile(jid, n, v, L)).join('')}</div>
    <div class="popgrp">★ Your saved colours</div><div class="pals" id="edFavs">${(ED.favs || []).map(f => palTile(jid, f.name, f.c, L, true)).join('') || '<span class="hint" style="margin:0">None yet: press ♥ on a colour idea you like.</span>'}</div>
    <div class="row" style="margin-top:8px">${['lyrics_fill_left', 'lyrics_fill_mid', 'lyrics_fill_right', 'lyrics_outline', 'lyrics_glow'].map((k, i) => `<label class="cpick" title="${['Left', 'Middle', 'Right', 'Outline', 'Glow'][i]}"><input type="color" value="${L[k]}" onchange="setStyle(${jid},{${k}:this.value})"><small>${['Left', 'Middle', 'Right', 'Outline', 'Glow'][i]}</small></label>`).join('')}</div>
  </div>`;
}
function palTile(jid, name, v, L, fav) {
  const on = [L.lyrics_fill_left, L.lyrics_fill_mid, L.lyrics_fill_right, L.lyrics_outline, L.lyrics_glow].every((x, i) => String(x).toLowerCase() === String(v[i]).toLowerCase());
  return `<div class="pal ${on ? 'on' : ''}" style="min-width:76px;padding:5px" onclick='setStyle(${jid},${JSON.stringify(palVals(v))})'><i style="height:22px;background:linear-gradient(90deg,${v[0]},${v[1]},${v[2]});border-color:${v[3]};box-shadow:0 0 8px ${v[4]}"></i><small>${esc(name)}</small>${fav ? `<span class="favx" title="Forget it" onclick='event.stopPropagation();edFav(${JSON.stringify({ name, c: v })},true)'>✕</span>` : ''}</div>`;
}
function palVals(v) { return { lyrics_fill_left: v[0], lyrics_fill_mid: v[1], lyrics_fill_right: v[2], lyrics_outline: v[3], lyrics_glow: v[4] }; }
async function edLoadFavs() { try { ED.favs = (await api('/api/palettes')).palettes; } catch (e) { ED.favs = []; } }
async function edFav(p, remove) {
  try { ED.favs = (await api('/api/palettes', { method: 'POST', body: JSON.stringify(Object.assign({}, p, { remove: !!remove })) })).palettes; toastEd(remove ? 'Forgotten.' : '★ Saved: offered again in every song.'); }
  catch (e) { toastEd('Could not save: ' + e.message); }
  edPanel(); if (ED.pop === 'text') edPopRender();
}

// colour ideas from what is behind the words: its average colour, brightness and main hue
const hex = (r, g, b) => '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
function hsl(h, s, l) { h = ((h % 360) + 360) % 360; s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)); return hex(f(0) * 255, f(8) * 255, f(4) * 255); }
function lum(hx) { const c = [1, 3, 5].map(i => parseInt(hx.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; }
function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
function edBgSample(id) {
  const tid = typeof id === 'string' ? id.replace(/'/g, '') : null, tel = tid && isText(tid) && $e('edTxt').querySelector(`[data-t="${tid}"]`);
  const base = $e('edBase'), blk = tel ? tel.firstElementChild : $e('edLyr').firstElementChild, st = $e('edStage').getBoundingClientRect();   // behind these words
  let x = 0, y = base.height * 0.1, w = base.width, h = base.height * 0.2;
  if (blk) { const r = blk.getBoundingClientRect(), k = base.width / st.width; x = Math.max(0, (r.left - st.left) * k); y = Math.max(0, (r.top - st.top) * k); w = Math.min(base.width - x, r.width * k); h = Math.min(base.height - y, Math.max(20, r.height * k)); }
  const d = base.getContext('2d').getImageData(x, y, Math.max(1, w), Math.max(1, h)).data;
  let R = 0, G = 0, B = 0, n = 0; const hues = new Array(12).fill(0);
  for (let i = 0; i < d.length; i += 16) { const r = d[i], g = d[i + 1], b = d[i + 2]; R += r; G += g; B += b; n++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    if (sat > .15 && mx > 40) { let hh = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); hh = (hh * 60 + 360) % 360; hues[Math.floor(hh / 30)] += sat; } }
  const avg = hex(R / n, G / n, B / n), top = hues.indexOf(Math.max(...hues)), colourful = Math.max(...hues) / n > 0.05;
  const crop = document.createElement('canvas'); crop.width = 160; crop.height = 50; crop.getContext('2d').drawImage(base, x, y, Math.max(1, w), Math.max(1, h), 0, 0, 160, 50);
  return { avg, dark: lum(avg) < 0.22, hue: colourful ? top * 30 + 15 : null, crop: crop.toDataURL('image/jpeg', .8) };
}
function suggestPalettes(bg) {
  const H = bg.hue == null ? 330 : bg.hue, dark = bg.dark, L1 = dark ? 74 : 32, L2 = dark ? 90 : 18, ol = dark ? hsl(H, 45, 7) : '#ffffff', gl = c => c;
  const mk = (name, a, b, c, glow) => ({ name, c: [a, b, c, dark ? ol : hsl(H + 180, 30, 96), glow] });
  const ideas = [
    mk('Opposite colour', hsl(H + 180, 90, L1), hsl(H + 180, 40, L2), hsl(H + 150, 90, L1), hsl(H + 180, 90, 50)),
    mk('Two opposites', hsl(H + 150, 90, L1), hsl(H + 180, 30, L2), hsl(H + 210, 90, L1), hsl(H + 200, 85, 45)),
    mk('Triad', hsl(H + 120, 85, L1), hsl(H + 180, 30, L2), hsl(H + 240, 85, L1), hsl(H + 240, 80, 45)),
    mk('Matches the scene', hsl(H - 30, 85, L1), hsl(H, 35, L2), hsl(H + 30, 85, L1), hsl(H, 85, 45)),
    mk(dark ? 'Gold' : 'Deep red', dark ? '#ffe45e' : '#9b0d2a', dark ? '#fff4bf' : '#5a0618', dark ? '#ffb300' : '#c2185b', dark ? '#ff9800' : '#ff8fb1'),
    mk(dark ? 'Clean white' : 'Ink', dark ? '#ffffff' : '#1a1030', dark ? '#ffffff' : '#120a22', dark ? '#e8f4ff' : '#2b1650', dark ? '#7a8cff' : '#ffffff'),
    mk('Neon', dark ? '#3ff8ff' : '#0077aa', dark ? '#ffffff' : '#00334d', dark ? '#ff4fd8' : '#b0007a', dark ? '#b14bff' : '#7fe6ff'),
    mk(dark ? 'Pastel' : 'Rich', dark ? '#ffb3d1' : '#7a1fa2', dark ? '#fff0f6' : '#3b0a52', dark ? '#a8e6ff' : '#0b5ca8', dark ? '#d4a3ff' : '#ffd1f0'),
  ];
  // keep the ones that stand out from the background; your saved colours first when they do
  const favs = (ED.favs || []).map(f => ({ name: '★ ' + f.name, c: f.c, fav: true }));
  return [...favs, ...ideas].map(p => Object.assign(p, { score: Math.min(contrast(p.c[1], bg.avg), contrast(p.c[0], bg.avg)) }))
    .filter(p => p.score >= 2.2 || p.fav).sort((a, b) => (b.fav - a.fav) || (b.score - a.score)).slice(0, 10);
}
function edIdeas(jid) {
  const id0 = typeof jid === 'string' ? jid.replace(/'/g, '') : jid; jid = typeof id0 === 'string' ? `'${id0}'` : id0;   // "t0" or 3, quoted for the buttons
  const bg = edBgSample(jid), box = $e('edIdeas'); if (!box) return;
  const L = Object.assign({}, S.config.look, ED.styleAll && !isText(id0) ? {} : styleOf(id0) || {}), words = (isText(id0) ? (S.config.texts[+id0.slice(1)].lines || [''])[0] : $e('edLyr').innerText.split('\n')[0]) || 'Soujanya';
  const html = suggestPalettes(bg).map(p => `<div class="idea" title="Contrast ${p.score.toFixed(1)}">
    <div class="ideabg" style="background-image:url(${bg.crop})" onclick='setStyle(${jid},${JSON.stringify(palVals(p.c))})'>${gtext([words.slice(0, 16)], { font: fontCss(L.lyrics_font), weight: L.lyrics_weight, size: 22, left: p.c[0], mid: p.c[1], right: p.c[2], outline: p.c[3], ow: L.lyrics_outline_w, glow: p.c[4] })}</div>
    <div class="row" style="gap:4px;justify-content:space-between"><small>${esc(p.name)}</small>${p.fav ? '' : `<button class="small" title="Save: offered again in every song" onclick='edFav(${JSON.stringify({ name: p.name, c: p.c })})'>♥</button>`}</div></div>`).join('')
    || '<span class="hint">No idea stands out enough here: try the colour pickers.</span>';
  ED.ideas = { id: id0, html }; box.innerHTML = html;
}

function clock(t) { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); }

// ---------- each picture's share of its interlude (same rule as fx.interlude_parts) ----------
function partWeights(p) { const pics = ilPics(p.n - 1), any = pics.some(q => q.weight); return pics.map(q => any ? Math.max(0.05, +q.weight || 1) : 1); }
function partBound(p, j) { const w = partWeights(p), W = w.reduce((a, b) => a + b, 0); return (p.end - p.start) * w.slice(0, j).reduce((a, b) => a + b, 0) / W; }
function partLens(p) { const n = p.parts.length; return Array.from({ length: n }, (_, j) => partBound(p, j + 1) - partBound(p, j)); }
function partTimes(p, j) {
  const q = p.parts[j], n = p.parts.length, b = k => partBound(p, k), next = p.parts[j + 1];
  return { s: j ? b(j) - q.din / 2 : 0, e: j === n - 1 ? p.end - p.start : b(j + 1) + (next ? next.din / 2 : 0) };
}
function edSetPicLen(n, j, v) {     // one picture's length in seconds; the others keep theirs, all scaled to fit the interlude
  const p = ED.plan.pics.find(x => x.kind === 'interlude' && x.n === n); if (!p) return;
  const L = partLens(p); L[j] = Math.max(1, +v || 1);
  ilPics(n - 1).forEach((q, k) => q.weight = Math.round(L[k] * 100) / 100); edChanged(); edPanel();
}

// ---------- free text (titles, thanks, credits ..): S.config.texts = [{lines, start, end, pos, style, anim}] ----------
function isText(id) { return typeof id === 'string' && id[0] === 't'; }
function edAddText() {
  const t = r2(ED.vid.currentTime), T = S.config.texts = S.config.texts || [];
  T.push({ lines: ['Your text here'], start: t, end: r2(Math.min(ED.plan.dur, t + 4)), pos: { x: 0, y: 0.72 }, style: { lyrics_size: Math.round(S.config.look.lyrics_size * 0.8) } });
  mark(); ED.txtKey = {}; edSelect({ kind: 'text', k: T.length - 1 }); edRefreshSoon(0);
  setTimeout(() => { const w = $e('edWords'); if (w) { w.focus(); w.select(); } }, 60);
}
// drawn like the lyrics (same animation code and line fitting), each at its own place; several can be on at once
function edTexts(t) {
  const P = ED.plan, box = $e('edTxt'); if (!box) return;
  ED.txtKey = ED.txtKey || {};
  const on = new Set();
  (S.config.texts || []).forEach((x, k) => {
    if (!(t >= x.start && t < x.end) || !(x.lines || []).length) return;
    const id = 't' + k; on.add(id);
    const L = Object.assign(edLook(), x.style || {}), eff = x.anim || P.anim.in, fx = Anim.FX[eff] || Anim.FX.fade, ps = x.pos || { x: 0, y: 0.72 };
    let el = box.querySelector(`[data-t="${id}"]`); if (!el) { el = document.createElement('div'); el.dataset.t = id; el.style.cssText = 'position:absolute;inset:0'; box.appendChild(el); }
    const key = JSON.stringify([x.lines, ps, L.lyrics_font, L.lyrics_weight, L.lyrics_size, L.lyrics_fill_left, L.lyrics_fill_mid, L.lyrics_fill_right, L.lyrics_outline, L.lyrics_outline_w, L.lyrics_glow, eff, P.k, ED.fontsReady]);
    if (ED.txtKey[id] !== key) {
      const font = fontCss(L.lyrics_font), [lines, size] = fitLines(x.lines, font, L.lyrics_weight, L.lyrics_size * P.k, P.canvas[0] * 0.9, L.lyrics_outline_w);
      el.innerHTML = `<div class="blk" style="position:absolute;left:${4 + ps.x * 100}%;right:${4 - ps.x * 100}%;top:${ps.y * 100}%">` + Anim.html(lines, { font, weight: L.lyrics_weight, size, left: L.lyrics_fill_left, mid: L.lyrics_fill_mid,
        right: L.lyrics_fill_right, outline: L.lyrics_outline, ow: L.lyrics_outline_w, glow: L.lyrics_glow, lh: 1.35 }, fx.unit) + '</div>';
      Anim.prepare(el); ED.txtKey[id] = key;
    }
    const len = x.end - x.start, din = Math.min(+S.config.text_anim.in_seconds || .5, len * .45), dout = Math.min(+S.config.text_anim.out_seconds || .3, len * .4), om = P.anim.out, local = t - x.start;
    let name = eff === 'none' ? 'fade' : eff, p = 1;
    if (eff !== 'none' && local < din) p = local / din;
    else if (om !== 'cut' && eff !== 'none' && x.end - t < dout) { p = (x.end - t) / dout; if (om === 'fade') name = 'fade'; }
    Anim.apply(el, name, p, { W: P.canvas[0], H: P.canvas[1] });
  });
  [...box.children].forEach(el => { if (!on.has(el.dataset.t)) { el.remove(); delete ED.txtKey[el.dataset.t]; } });
}

function edInlineText(tid) {
  const k = +tid.slice(1), el = $e('edTxt').querySelector(`[data-t="${tid}"]`); if (!el) return;
  ED.vid.pause(); edSelect({ kind: 'text', k });
  const r = el.firstElementChild.getBoundingClientRect(), st = $e('edStage').getBoundingClientRect(), old = $e('edInline'); if (old) old.remove();
  const ta = document.createElement('textarea'); ta.id = 'edInline'; ta.value = (S.config.texts[k].lines || []).join('\n');
  const w = st.width * 0.8;
  Object.assign(ta.style, { left: (st.width - w) / 2 + 'px', top: Math.max(4, Math.min(st.height - 80, r.top - st.top - 8)) + 'px', width: w + 'px', height: Math.max(60, r.height + 16) + 'px' });
  $e('edStage').appendChild(ta); ta.focus(); ta.select();
  ta.oninput = () => { edWords(tid, ta.value); const pw = $e('edWords'); if (pw) pw.value = ta.value; };
  ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) ta.blur(); };
  ta.onblur = () => { ta.remove(); edPanel(); edRefreshSoon(); };
}

// ---------- undo / redo: snapshots of the song's settings (config, credits, lyrics) once a change settles ----------
// A drag or a burst of typing is one step (the snapshot waits until nothing changed for 0.45 s). Up to 150 steps per song.
const HIST = { stack: [], pos: -1, t: null };
function histSnap() { return JSON.stringify({ config: S.config, credits: S.credits, lyrics: S.lyrics }); }
function histInit() { clearTimeout(HIST.t); HIST.t = null; HIST.stack = [histSnap()]; HIST.pos = 0; histUI(); }
function histPush() {
  clearTimeout(HIST.t);
  HIST.t = setTimeout(histNow, 450);
}
function histNow() {
  HIST.t = null; if (!S || HIST.pos < 0) return;
  const s = histSnap(); if (s === HIST.stack[HIST.pos]) return;
  HIST.stack = HIST.stack.slice(0, HIST.pos + 1); HIST.stack.push(s);
  if (HIST.stack.length > 150) HIST.stack.shift();
  HIST.pos = HIST.stack.length - 1; histUI();
}
function histApply(i, what) {
  if (HIST.t) histNow();                         // a change still waiting becomes its own step first
  if (i < 0 || i >= HIST.stack.length) return toastEd(what === 'undo' ? 'Nothing more to undo.' : 'Nothing more to redo.');
  HIST.pos = i;
  const d = JSON.parse(HIST.stack[i]); S.config = d.config; S.credits = d.credits; S.lyrics = d.lyrics;
  dirty = true; $('#saveState').textContent = 'Not saved'; $('#saveState').className = 'dirty';
  ED.lastScreen = null; ED.txtKey = {}; ED.planKey = '';
  const sel = ED.sel; renderAll(); ED.sel = sel; if (ED.open) { edRefreshSoon(0); edPanel(); edDrawTL(); if (ED.pop) edPopRender(); }
  histUI(); toastEd(what === 'undo' ? '↶ Undone' : '↷ Redone');
}
function edUndo() { if (HIST.t) histNow(); histApply(HIST.pos - 1, 'undo'); }
function edRedo() { histApply(HIST.pos + 1, 'redo'); }
function histUI() { const u = $e('edUndoBtn'), r = $e('edRedoBtn'); if (u) u.disabled = HIST.pos <= 0 && !HIST.t; if (r) r.disabled = HIST.pos >= HIST.stack.length - 1; }
// ⌘Z / ⇧⌘Z (Ctrl on other computers): inside a text box the box's own undo, elsewhere the editor's
function edUndoKey(redo) {
  const a = document.activeElement;
  if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|number|search/.test(a.type)))) { document.execCommand(redo ? 'redo' : 'undo'); return; }
  redo ? edRedo() : edUndo();
}
document.addEventListener('keydown', ev => {
  if (!(ev.metaKey || ev.ctrlKey) || ev.key.toLowerCase() !== 'z' && ev.key.toLowerCase() !== 'y') return;
  const a = document.activeElement; if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && /text|number|search/.test(a.type)))) return;   // the box's own undo
  ev.preventDefault(); (ev.key.toLowerCase() === 'y' || ev.shiftKey) ? edRedo() : edUndo();
});

// 💡 in the tool row: colour ideas for the words on the picture right now (a selected text or lyric screen, else the one playing)
function edIdeasHere() {
  const t = ED.vid.currentTime; let id = null;
  if (ED.sel && (ED.sel.kind === 'text' || ED.sel.kind === 'screen')) id = ED.sel.kind === 'text' ? 't' + ED.sel.k : ED.sel.i;
  else { const k = (S.config.texts || []).findIndex(x => t >= x.start && t < x.end), sc = edScreenAt(t);
    if (k >= 0) id = 't' + k; else if (sc) id = sc.i; else { const n = edScreenNear(t); if (n) { id = n.i; edSeek(n.start + 0.3); } } }
  if (id == null) return toastEd('No lyrics or text yet.');
  ED.vid.pause(); edSelect(isText(id) ? { kind: 'text', k: +id.slice(1) } : { kind: 'screen', i: id });
  setTimeout(() => { edIdeas(typeof id === 'string' ? `'${id}'` : id); const h = $e('edIdeasHead'); if (h) h.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 350);   // after the picture shows those words
}

// ffmpeg's hue filter as an RGB matrix (turn the colour by deg in YUV, scale it by sat): the same maths as fx.hue_matrix
function hueMatrix(deg, sat) {
  const Y = [.299, .587, .114, -.168736, -.331264, .5, .5, -.418688, -.081312], c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180);
  const R = [1, 0, 0, 0, c * sat, -s * sat, 0, s * sat, c * sat];
  const inv = m => { const [a, b, c2, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c2 * C;
    return [A, -(b * i - c2 * h), b * f - c2 * e, B, a * i - c2 * g, -(a * f - c2 * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det); };
  const mul = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let t = 0; for (let k = 0; k < 3; k++) t += A[i * 3 + k] * B[k * 3 + j]; r.push(t); } return r; };
  const M = mul(inv(Y), mul(R, Y));
  return [M[0], M[1], M[2], 0, 0, M[3], M[4], M[5], 0, 0, M[6], M[7], M[8], 0, 0, 0, 0, 0, 1, 0].map(v => +v.toFixed(5)).join(' ');
}

// ---------- the cards' text pieces (title, her name, credits ..): each drawn by the builder (stills.render_card), placed and styled here ----------
const CARD_PIECE_LABEL = { title: 'Title', cover: 'Her name (cover by)', credits: 'Song credits', name: 'Her name', lines: 'Lines under the name' };
async function edLoadCard(url) {
  ED.cards = ED.cards || {};
  if (ED.cards[url]) return;
  ED.cards[url] = { loading: true };
  try {
    const m = await api(url);
    await Promise.all([m.bg, ...m.els.map(e => e.url)].map(u => ED.imgs[u] && ED.imgs[u].ok ? 0 : loadPicture(u).then(im => { ED.imgs[u] = { im, ok: true }; })));
    ED.cards[url] = m; ED.cardKey = null;
  } catch (e) { delete ED.cards[url]; }
}
function edCardReady(p) { const c = ED.cards && ED.cards[p.card]; return !!(c && c.els && ED.imgs[c.bg] && ED.imgs[c.bg].ok); }
function cardEl(kind, id) { const c = S.config[kind]; c.els = c.els || {}; c.els[id] = c.els[id] || {}; return c.els[id]; }
function edCardEls() {
  const box = $e('edCard'); if (!box) return;
  const on = ED.cardOn;
  if (!on) { if (box.firstChild) { box.innerHTML = ''; ED.cardKey = null; } return; }
  const p = on.p, cd = ED.cards[p.card], els = (S.config[p.kind] || {}).els || {};
  const key = p.card + JSON.stringify(els) + (ED.sel && ED.sel.kind === 'cardel' ? ED.sel.id : '');
  if (ED.cardKey !== key) {
    ED.cardKey = key;
    box.innerHTML = cd.els.map(e => { const ps = els[e.id] || {}, x = ps.x != null ? ps.x : e.cx, y = ps.y != null ? ps.y : e.cy, w = e.w / cd.size[0] * 100, h = e.h / cd.size[1] * 100;
      const sel = ED.sel && ED.sel.kind === 'cardel' && ED.sel.id === e.id;
      return `<img src="${ED.imgs[e.url].im ? e.url : ''}" data-el="${e.id}" class="cardpiece${sel ? ' on' : ''}" title="${CARD_PIECE_LABEL[e.id] || e.id}: drag to move, click for its font and colours" draggable="false"
        style="left:${(x * 100 - w / 2).toFixed(3)}%;top:${(y * 100 - h / 2).toFixed(3)}%;width:${w.toFixed(3)}%;height:${h.toFixed(3)}%">`; }).join('');
  }
  box.style.transform = `scale(${on.z})`;                    // the card's slow zoom, as the builder's zoompan
}
function edCardDown(ev) {
  const img = ev.target.closest && ev.target.closest('.cardpiece'); if (!img || !ED.cardOn) return;
  ev.preventDefault(); ev.stopPropagation(); ED.vid.pause();
  const kind = ED.cardOn.p.kind, id = img.dataset.el, cd = ED.cards[ED.cardOn.p.card], e = cd.els.find(x => x.id === id);
  const box = $e('edCard').getBoundingClientRect(), ps = (S.config[kind].els || {})[id] || {};
  const x0 = ps.x != null ? ps.x : e.cx, y0 = ps.y != null ? ps.y : e.cy, X = ev.clientX, Y = ev.clientY; let moved = false;
  const mv = m => { const dx = (m.clientX - X) / box.width, dy = (m.clientY - Y) / box.height; if (Math.abs(m.clientX - X) + Math.abs(m.clientY - Y) > 4) moved = true; if (!moved) return;
    const el = cardEl(kind, id); el.x = +Math.max(0, Math.min(1, x0 + dx)).toFixed(4); el.y = +Math.max(0, Math.min(1, y0 + dy)).toFixed(4);
    img.style.left = (el.x * 100 - e.w / cd.size[0] * 50) + '%'; img.style.top = (el.y * 100 - e.h / cd.size[1] * 50) + '%'; mark(); };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up);
    edSelect({ kind: 'cardel', card: kind, id }); if (moved) { ED.cardKey = null; edRefreshSoon(); } };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}
// a card piece's own font, size and colours (S.config.opening.els / ending.els); the builder redraws it (a second or two)
const PIECE_DEFAULTS = {
  title: L => ({ font: L.credits_font, size: L.title_size, fill_left: L.title_fill_left, fill_right: L.title_fill_right, outline: L.title_outline, glow: L.title_glow, role: 'lang' }),
  cover: L => ({ font: L.logo_font, size: 96, fill_left: L.logo_fill_left, fill_right: L.logo_fill_right, outline: L.logo_outline, glow: L.logo_glow, role: 'script' }),
  credits: L => ({ font: L.credits_font, size: L.credits_size, fill_left: L.title_fill_left, fill_right: L.title_fill_right, outline: L.title_outline, glow: L.title_glow, role: 'lang' }),
  name: L => ({ font: L.end_font, size: L.end_size, fill_left: L.end_fill, fill_right: L.end_fill, outline: L.end_outline, glow: L.end_glow, role: 'script' }),
  lines: L => ({ font: L.credits_font, size: L.credits_size, fill_left: L.title_fill_left, fill_right: L.title_fill_right, outline: L.title_outline, glow: L.title_glow, role: 'lang' }),
};
function pieceStyle(kind, id) { const d = PIECE_DEFAULTS[id](edLook()), o = ((S.config[kind] || {}).els || {})[id] || {}; const r = Object.assign({}, d); ['font', 'size', 'fill_left', 'fill_right', 'outline', 'glow'].forEach(k => { if (o[k] != null && o[k] !== '') r[k] = o[k]; }); return r; }
function setPiece(kind, id, vals) { Object.assign(cardEl(kind, id), vals); mark(); edRefreshSoon(150); edPanel(); }
function resetPiece(kind, id, what) {
  const el = cardEl(kind, id);
  (what === 'place' ? ['x', 'y'] : ['font', 'size', 'fill_left', 'fill_right', 'outline', 'glow']).forEach(k => delete el[k]);
  mark(); ED.cardKey = null; edRefreshSoon(0); edPanel();
}
function edPiecePanel(sel) {
  const { card: kind, id } = sel, st = pieceStyle(kind, id), own = ((S.config[kind] || {}).els || {})[id] || {}, J = `'${kind}','${id}'`;
  const words = id === 'title' ? (S.credits.opening.title_line || S.config.title || 'Title') : id === 'cover' ? (S.credits.opening.cover_by || 'Soujanya') : id === 'name' ? (S.credits.ending.name || 'Soujanya') : (S.config.language === 'hindi' ? 'फ़िल्म' : 'సినిమా');
  const pals = (id === 'cover' || id === 'name' ? PAL.name : PAL.opening).map(([n, v]) => `<div class="pal" style="min-width:76px;padding:5px" onclick='setPiece(${JSON.stringify(kind)},${JSON.stringify(id)},${JSON.stringify({ fill_left: v[0], fill_right: v[2] || v[0], outline: v[3] || v[1], glow: v[4] || v[2] })})'><i style="height:22px;background:linear-gradient(90deg,${v[0]},${v[2] || v[0]})"></i><small>${n}</small></div>`).join('');
  return `<h3 style="margin-top:0">🪧 ${esc(CARD_PIECE_LABEL[id] || id)} <small class="hint">on the ${kind === 'opening' ? 'opening' : 'end'} card</small></h3>
    <div class="hint" style="margin:0 0 6px">Drag it on the picture to place it anywhere. Its words are in the card's settings.</div>
    <div class="row"><button class="small" onclick="edSelect({kind:'${kind}'})">✏️ The card's words</button>${own.x != null ? `<button class="small" onclick="resetPiece(${J},'place')">Back to its usual place</button>` : ''}
      ${['font', 'size', 'fill_left', 'outline'].some(k => own[k] != null) ? `<button class="small" onclick="resetPiece(${J},'style')">Back to the card's style</button>` : ''}<button class="small" onclick="edSelect(null)">Done</button></div>
    <div class="popgrp">Font</div><div class="fonttiles">${fontList(PIECE_DEFAULTS[id](edLook()).role).map(f => `<div class="ftile ${f === st.font ? 'on' : ''}" onclick="setPiece(${J},{font:'${f.replace(/'/g, "\\'")}'})"><b style="font-family:${fontCss(f)}">${esc(words.slice(0, 12))}</b><small>${esc(f)}</small></div>`).join('')}</div>
    <div class="row" style="margin-top:8px"><b>Size</b><button class="small" onclick="setPiece(${J},{size:Math.max(20,${+st.size}-6)})">−</button><b>${Math.round(st.size)}</b><button class="small" onclick="setPiece(${J},{size:Math.min(260,${+st.size}+6)})">+</button></div>
    <div class="popgrp">Colours</div><div class="pals">${pals}</div>
    <div class="row" style="margin-top:8px">${[['fill_left', 'Left'], ['fill_right', 'Right'], ['outline', 'Outline'], ['glow', 'Glow']].map(([k, n]) => `<label class="cpick"><input type="color" value="${st[k]}" onchange="setPiece(${J},{${k}:this.value})"><small>${n}</small></label>`).join('')}</div>
    <div class="hint" style="margin-top:6px">The card is redrawn by the video maker's own code a second or two after a change.</div>`;
}

// her name on the picture: a dashed outline and a move cursor when pointed at (it can be dragged anywhere; click for its settings)
function edHoverName(ev) {
  const lh = $e('edLogoHit'), r = lh && lh.firstElementChild && lh.firstElementChild.getBoundingClientRect(), box = $e('edHover');
  const on = r && r.width && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom && !ED.cardOn;
  if (!on) { box.style.display = 'none'; $e('edStage').style.cursor = ''; return; }
  const st = $e('edStage').getBoundingClientRect();
  Object.assign(box.style, { display: 'block', left: (r.left - st.left - 4) + 'px', top: (r.top - st.top - 4) + 'px', width: (r.width + 8) + 'px', height: (r.height + 8) + 'px' });
  $e('edStage').style.cursor = 'move';
}

function edNameHome() { const o = edOutCfg(), w = (o.look && 'logo_x' in o.look) ? o.look : S.config.look; w.logo_x = w === S.config.look ? 0.15 : 0.04; w.logo_y = w === S.config.look ? 0.04 : 0.80; mark(); edLogo(true); edRefreshSoon(0); }
