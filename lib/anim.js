/* Lyric text animations. Shared by the video renderer (headless Chrome, frame by frame) and the settings page (live previews).
 *
 *   Anim.html(lines, style, unit)   -> markup for a block of lines in her style, split into the unit the effect animates
 *   Anim.prepare(root)              -> call once after the markup is in the page (fixes the gradient across split words/letters)
 *   Anim.apply(root, name, p, ctx)  -> show the text at progress p (0 = hidden, 1 = fully shown) of effect `name`
 *
 * style: {font, weight, size, left, mid, right, outline, ow, glow, lh}.   ctx: {W, H} canvas size in px (for slides).
 * p runs 0 -> 1 when the text comes in; the renderer runs it 1 -> 0 for the "reverse" way out.
 */
(function () {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const EASE = {
    lin: t => t,
    out: t => 1 - Math.pow(1 - t, 3),
    outq: t => 1 - Math.pow(1 - t, 5),
    inout: t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    back: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
    elastic: t => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1),
    bounce: t => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + .75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + .9375; return n * (t -= 2.625 / d) * t + .984375; },
  };
  const rnd = k => { const v = Math.sin(k * 12.9898) * 43758.5453; return v - Math.floor(v); };

  // e = eased progress of this unit (0 hidden .. 1 shown), i = unit index, n = unit count, c = {W,H}
  // returns any of: o (opacity) x y (px) s sx sy (scale) r (deg) rx ry (deg 3D) blur (px) clip [top,right,bottom,left in %]
  const FX = {};
  const add = (id, label, group, unit, stagger, ease, fn) => { FX[id] = { id, label, group, unit, stagger, ease, fn }; };

  // --- fade & scale (whole block) ---
  add('fade', 'Fade', 'Fade & scale', 'block', 0, 'lin', e => ({ o: e }));
  add('fade_up', 'Rise', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, y: (1 - e) * 60 }));
  add('fade_down', 'Drop in', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, y: -(1 - e) * 60 }));
  add('zoom_in', 'Zoom in', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, s: .6 + .4 * e }));
  add('zoom_out', 'Zoom out', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, s: 1.6 - .6 * e }));
  add('blur_in', 'Blur focus', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, blur: (1 - e) * 22 }));
  add('stretch', 'Stretch', 'Fade & scale', 'block', 0, 'out', e => ({ o: e, sx: 1.7 - .7 * e }));
  add('pop', 'Pop', 'Fade & scale', 'block', 0, 'back', e => ({ o: clamp(e * 3), s: .2 + .8 * e }));
  // --- slide / move (whole block) ---
  add('slide_left', 'Slide from left', 'Slide & move', 'block', 0, 'out', (e, i, n, c) => ({ o: clamp(e * 2), x: -(1 - e) * c.W * .8 }));
  add('slide_right', 'Slide from right', 'Slide & move', 'block', 0, 'out', (e, i, n, c) => ({ o: clamp(e * 2), x: (1 - e) * c.W * .8 }));
  add('slide_up', 'Slide up', 'Slide & move', 'block', 0, 'out', (e, i, n, c) => ({ o: clamp(e * 2), y: (1 - e) * c.H * .25 }));
  add('slide_down', 'Slide down', 'Slide & move', 'block', 0, 'out', (e, i, n, c) => ({ o: clamp(e * 2), y: -(1 - e) * c.H * .25 }));
  add('tilt', 'Tilt in', 'Slide & move', 'block', 0, 'out', e => ({ o: e, r: -12 * (1 - e), s: .8 + .2 * e }));
  add('flip_x', 'Flip up', 'Slide & move', 'block', 0, 'out', e => ({ o: clamp(e * 2), rx: 90 * (1 - e) }));
  add('flip_y', 'Flip around', 'Slide & move', 'block', 0, 'out', e => ({ o: clamp(e * 2), ry: 90 * (1 - e) }));
  add('bounce_drop', 'Bounce drop', 'Slide & move', 'block', 0, 'bounce', (e, i, n, c) => ({ o: clamp(e * 6), y: -(1 - e) * c.H * .18 }));
  add('elastic', 'Elastic', 'Slide & move', 'block', 0, 'elastic', e => ({ o: clamp(e * 4), s: e }));
  // --- line by line ---
  add('lines_up', 'Lines rise', 'Line by line', 'line', .6, 'out', e => ({ o: e, y: (1 - e) * 50 }));
  add('lines_alt', 'Lines from both sides', 'Line by line', 'line', .5, 'out', (e, i, n, c) => ({ o: clamp(e * 2), x: (i % 2 ? 1 : -1) * (1 - e) * c.W * .5 }));
  add('lines_zoom', 'Lines zoom', 'Line by line', 'line', .6, 'back', e => ({ o: clamp(e * 3), s: .4 + .6 * e }));
  add('lines_wipe', 'Lines wipe', 'Line by line', 'line', .6, 'inout', e => ({ clip: [0, (1 - e) * 100, 0, 0] }));
  add('lines_blur', 'Lines focus', 'Line by line', 'line', .6, 'out', e => ({ o: e, blur: (1 - e) * 18 }));
  // --- word by word ---
  add('words_fade', 'Words fade', 'Word by word', 'word', .75, 'lin', e => ({ o: e }));
  add('words_pop', 'Words pop', 'Word by word', 'word', .75, 'back', e => ({ o: clamp(e * 3), s: .2 + .8 * e }));
  add('words_rise', 'Words rise', 'Word by word', 'word', .75, 'out', e => ({ o: e, y: (1 - e) * 50 }));
  add('words_drop', 'Words drop', 'Word by word', 'word', .75, 'bounce', e => ({ o: clamp(e * 6), y: -(1 - e) * 120 }));
  add('words_blur', 'Words focus', 'Word by word', 'word', .75, 'out', e => ({ o: e, blur: (1 - e) * 16 }));
  add('words_flip', 'Words flip', 'Word by word', 'word', .75, 'out', e => ({ o: clamp(e * 2), rx: 90 * (1 - e) }));
  // --- letter by letter ---
  add('type', 'Typewriter', 'Letter by letter', 'letter', .96, 'lin', e => ({ o: e > .02 ? 1 : 0 }));
  add('letters_fade', 'Letters fade', 'Letter by letter', 'letter', .85, 'lin', e => ({ o: e }));
  add('letters_rise', 'Letters rise', 'Letter by letter', 'letter', .85, 'out', e => ({ o: e, y: (1 - e) * 40 }));
  add('letters_drop', 'Letters drop', 'Letter by letter', 'letter', .85, 'bounce', e => ({ o: clamp(e * 6), y: -(1 - e) * 140 }));
  add('letters_wave', 'Letters wave', 'Letter by letter', 'letter', .85, 'out', (e, i) => ({ o: e, y: (1 - e) * 36 * Math.sin(i * .9 + 1.5) }));
  add('letters_pop', 'Letters pop', 'Letter by letter', 'letter', .85, 'back', e => ({ o: clamp(e * 3), s: .1 + .9 * e }));
  add('letters_spin', 'Letters spin', 'Letter by letter', 'letter', .85, 'out', e => ({ o: e, r: -180 * (1 - e) }));
  add('letters_flip', 'Letters flip', 'Letter by letter', 'letter', .85, 'out', e => ({ o: clamp(e * 2), rx: 90 * (1 - e) }));
  add('letters_blur', 'Letters focus', 'Letter by letter', 'letter', .85, 'out', e => ({ o: e, blur: (1 - e) * 12 }));
  // --- reveal (masks) ---
  add('wipe_right', 'Wipe right', 'Reveal', 'block', 0, 'inout', e => ({ clip: [0, (1 - e) * 100, 0, 0] }));
  add('wipe_left', 'Wipe left', 'Reveal', 'block', 0, 'inout', e => ({ clip: [0, 0, 0, (1 - e) * 100] }));
  add('wipe_up', 'Wipe up', 'Reveal', 'block', 0, 'inout', e => ({ clip: [(1 - e) * 100, 0, 0, 0] }));
  add('wipe_center', 'Open from the middle', 'Reveal', 'block', 0, 'inout', e => ({ clip: [0, (1 - e) * 50, 0, (1 - e) * 50] }));
  add('wipe_down', 'Curtain down', 'Reveal', 'block', 0, 'inout', e => ({ clip: [0, 0, (1 - e) * 100, 0] }));
  // --- impact ---
  add('glitch', 'Glitch', 'Impact', 'block', 0, 'lin', (e, i, n, c) => {
    const f = Math.floor(e * 14), j = (1 - e) * (rnd(f) - .5) * 60;
    return { o: e < .12 ? 0 : (rnd(f + 5) > .35 ? 1 : .25), x: j, sx: 1 + (1 - e) * (rnd(f + 9) - .5) * .5, blur: (1 - e) * (rnd(f + 3) > .6 ? 4 : 0) };
  });
  add('flicker', 'Neon flicker', 'Impact', 'block', 0, 'lin', e => { const f = Math.floor(e * 18); return { o: e >= 1 ? 1 : (rnd(f * 3.1) > .45 ? 1 : .12) * clamp(e * 3) }; });
  add('shake', 'Shake in', 'Impact', 'block', 0, 'lin', e => ({ o: clamp(e * 4), x: Math.sin(e * 60) * (1 - e) * 30, y: Math.cos(e * 47) * (1 - e) * 12 }));
  add('swing', 'Swing', 'Impact', 'block', 0, 'out', e => ({ o: clamp(e * 3), r: Math.sin(e * 9) * (1 - e) * 14 }));

  const tf = d => {
    const t = [];
    if (d.x || d.y) t.push(`translate(${d.x || 0}px,${d.y || 0}px)`);
    if (d.rx != null) t.push(`perspective(900px) rotateX(${d.rx}deg)`);
    if (d.ry != null) t.push(`perspective(900px) rotateY(${d.ry}deg)`);
    if (d.r) t.push(`rotate(${d.r}deg)`);
    const sx = (d.sx != null ? d.sx : 1) * (d.s != null ? d.s : 1), sy = (d.sy != null ? d.sy : 1) * (d.s != null ? d.s : 1);
    if (sx !== 1 || sy !== 1) t.push(`scale(${sx},${sy})`);
    return t.join(' ') || 'none';
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const graphemes = s => (window.Intl && Intl.Segmenter ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].map(x => x.segment) : [...s]);

  function html(lines, o, unit) {
    unit = unit || 'block';
    const fill = `linear-gradient(90deg,${o.left},${o.mid ? o.mid + ',' : ''}${o.right})`;
    const pad = o.size * .12, lh = o.lh || 1.35;
    let k = 0;
    const split = (text, front) => {
      if (unit === 'word' || unit === 'letter') {
        const words = text.split(/(\s+)/);
        return words.map(w => {
          if (/^\s+$/.test(w) || w === '') return `<span style="white-space:pre">${esc(w)}</span>`;
          const parts = unit === 'letter' ? graphemes(w) : [w];
          return `<span style="white-space:nowrap">` + parts.map(p => { const idx = front ? FRONT_IDX.next() : BACK_IDX.next();
            return `<span class="u" data-u="${idx}" style="display:inline-block;white-space:pre${front ? `;color:transparent;background:${fill};-webkit-background-clip:text;background-clip:text` : ''}">${esc(p)}</span>`; }).join('') + `</span>`;
        }).join('');
      }
      return esc(text);
    };
    const counter = () => { let n = 0; return { next: () => n++, reset: () => { n = 0; } }; };
    const BACK_IDX = counter(), FRONT_IDX = counter();
    return lines.map((l, li) =>
      `<div class="ln" data-l="${li}" style="display:table;margin:0 auto;position:relative;white-space:nowrap;font-family:${o.font};font-weight:${o.weight};font-size:${o.size}px;line-height:${lh}">` +
      `<div class="bk" style="padding:0 ${pad}px;color:${o.outline};-webkit-text-stroke:${o.ow * o.size}px ${o.outline};text-shadow:0 0 ${o.size * .28}px ${o.glow},0 0 ${o.size * .1}px ${o.glow}">${split(l, false)}</div>` +
      `<div class="fr" style="padding:0 ${pad}px;position:absolute;left:0;top:0;color:transparent;` +
      (unit === 'word' || unit === 'letter' ? '' : `background:${fill};-webkit-background-clip:text;background-clip:text`) + `">${split(l, true)}</div></div>`).join('');
  }

  function prepare(root) {
    // each split word/letter carries its own gradient, sized to the whole line so the colours run across the line
    root.querySelectorAll('.ln').forEach(ln => {
      const fr = ln.querySelector('.fr'), w = fr.offsetWidth;
      fr.querySelectorAll('.u').forEach(u => { u.style.backgroundSize = w + 'px 100%'; u.style.backgroundPosition = (-u.offsetLeft) + 'px 0'; });
    });
    root.__units = {};
    root.querySelectorAll('.u').forEach(u => { (root.__units[u.dataset.u] = root.__units[u.dataset.u] || []).push(u); });
  }

  function paint(els, d) {
    const css = { opacity: d.o == null ? 1 : clamp(d.o), transform: tf(d), filter: d.blur ? `blur(${d.blur}px)` : 'none',
                  clipPath: d.clip ? `inset(${d.clip.map(v => v + '%').join(' ')})` : 'none' };
    els.forEach(el => { Object.assign(el.style, css); });
  }

  function apply(root, name, p, ctx) {
    ctx = ctx || { W: 1080, H: 1920 };
    const fx = FX[name] || FX.fade, ease = EASE[fx.ease] || EASE.lin;
    const blk = root.querySelector('.blk') || root;
    let els, n;
    // reset everything first (other levels)
    blk.style.opacity = 1; blk.style.transform = 'none'; blk.style.filter = 'none'; blk.style.clipPath = 'none';
    root.querySelectorAll('.ln').forEach(l => { l.style.opacity = 1; l.style.transform = 'none'; l.style.filter = 'none'; l.style.clipPath = 'none'; });
    if (fx.unit === 'block') { paint([blk], fx.fn(ease(clamp(p)), 0, 1, ctx)); return; }
    if (fx.unit === 'line') els = [...root.querySelectorAll('.ln')].map(l => [l]);
    else { const m = root.__units || {}; els = Object.keys(m).sort((a, b) => a - b).map(k => m[k]); }
    n = els.length;
    const g = fx.stagger, win = 1 - g;
    els.forEach((group, i) => {
      const start = n > 1 ? (i / (n - 1)) * g : 0;
      const lp = clamp((p - start) / (win > 0.02 ? win : 0.02));
      paint(group, fx.fn(ease(lp), i, n, ctx));
    });
  }

  window.Anim = { FX, EFFECTS: Object.values(FX), html, prepare, apply, groups: [...new Set(Object.values(FX).map(f => f.group))] };
})();
