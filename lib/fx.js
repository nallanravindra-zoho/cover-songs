/* Live-preview drawing of moving pictures, filters and transitions (WebGL). The video builder makes the same things with ffmpeg:
 *   filters and motions come from fx.json (the same numbers lib/fx.py uses);
 *   transitions are ports of ffmpeg's xfade formulas (libavfilter/vf_xfade.c, ffmpeg 7.1) and of lib/trans.py.
 * tools/check_preview.py compares this drawing with ffmpeg's, frame by frame.
 *
 *   FX.load()                         -> fetches fx.json (once)
 *   FX.params(spec) / FX.matrix(p)    -> the colour formula of a filter (same maths as fx.py)
 *   FX.motion(name, u)                -> {z, x, y} of a picture motion at progress u (0..1)
 *   new FX.Stage(canvas)              -> .layer(source, key, blurPx) -> texture;  .draw(A, B, transition, t)
 *     a layer is {tex, z, x, y, m (9 numbers, row by row), o (3), v (vignette), n (grain), seed}
 */
(function () {
  const FX = { DEF: null };
  const IDENT = { b: 1, c: 1, s: 1, h: 0, w: 0, t: 0, f: 0, sep: 0, g: 0, v: 0, n: 0, bl: 0 };
  FX.IDENT = IDENT;

  FX.use = function (def) {
    FX.DEF = def;
    FX.FILTERS = {}; def.filters.forEach(f => FX.FILTERS[f[0]] = { id: f[0], label: f[1], group: f[2], p: f[3] });
    FX.MOTIONS = {}; def.motions.forEach(m => FX.MOTIONS[m[0]] = Object.assign({ id: m[0], label: m[1] }, m[2]));
    return def;
  };
  FX.load = async function () { return FX.DEF || FX.use(await (await fetch('/fx.json')).json()); };

  FX.params = function (spec) {
    spec = spec || {};
    const pre = (FX.FILTERS[spec.filter || 'original'] || FX.FILTERS.original).p;
    const a = spec.amount == null ? 1 : +spec.amount, out = {};
    for (const k in IDENT) out[k] = IDENT[k] + ((k in pre ? pre[k] : IDENT[k]) - IDENT[k]) * a;
    for (const [k, v] of Object.entries(spec.adjust || {})) {
      if (k === 'b' || k === 'c' || k === 's') out[k] *= +v; else if (k in out) out[k] += +v;
    }
    return out;
  };

  // 3x3 matrices row by row; mul(A, B) = A @ B
  const mul = (A, B) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j]; r.push(s); } return r; };
  const mv = (A, v) => [0, 1, 2].map(i => A[i * 3] * v[0] + A[i * 3 + 1] * v[1] + A[i * 3 + 2] * v[2]);
  const diag = (a, b, c) => [a, 0, 0, 0, b, 0, 0, 0, c];
  const sat = s => [.213 + .787 * s, .715 - .715 * s, .072 - .072 * s, .213 - .213 * s, .715 + .285 * s, .072 - .072 * s, .213 - .213 * s, .715 - .715 * s, .072 + .928 * s];
  const hue = d => { const c = Math.cos(d * Math.PI / 180), s = Math.sin(d * Math.PI / 180);
    return [.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928,
            .213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283,
            .213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]; };
  const sepia = a => { const i = 1 - a; return [.393 + .607 * i, .769 - .769 * i, .189 - .189 * i, .349 - .349 * i, .686 + .314 * i, .168 - .168 * i, .272 - .272 * i, .534 - .534 * i, .131 + .869 * i]; };
  const gray = a => { const i = 1 - a; return [.2126 + .7874 * i, .7152 - .7152 * i, .0722 - .0722 * i, .2126 - .2126 * i, .7152 + .2848 * i, .0722 - .0722 * i, .2126 - .2126 * i, .7152 - .7152 * i, .0722 + .9278 * i]; };
  const cl = x => Math.min(1, Math.max(0, x));

  FX.matrix = function (p) {
    let M = diag(1, 1, 1), o = [0, 0, 0];
    const step = (A, b) => { M = mul(A, M); o = mv(A, o).map((x, i) => x + (b ? b[i] : 0)); };
    step(diag(p.b, p.b, p.b));
    step(diag(p.c, p.c, p.c), [.5 * (1 - p.c), .5 * (1 - p.c), .5 * (1 - p.c)]);
    step(sat(p.s)); step(hue(p.h)); step(sepia(cl(p.sep))); step(gray(cl(p.g)));
    step(diag(1 + .10 * p.w, 1 + .02 * p.w, 1 - .12 * p.w));
    step(diag(1 + .06 * p.t, 1 - .10 * p.t, 1 + .06 * p.t));
    const f = cl(p.f); step(diag(1 - .35 * f, 1 - .35 * f, 1 - .35 * f), [.12 * f, .12 * f, .12 * f]);
    return { m: M, o };
  };

  const EASE = { lin: u => u, inout: u => u * u * (3 - 2 * u), out: u => 1 - Math.pow(1 - u, 3), wave: u => Math.sin(Math.PI * u) };
  const LEGACY = { pan: 'drift_left', none: 'still' };
  FX.motion = function (name, u) {
    const m = FX.MOTIONS[LEGACY[name] || name] || FX.MOTIONS.zoom_in, e = (EASE[m.ease] || EASE.lin)(Math.min(1, Math.max(0, u)));
    const val = (k, d) => { const r = m[k] || [d, d]; return r[0] + (r[1] - r[0]) * e; };
    return { z: Math.max(1, val('z', 1)), x: val('x', .5), y: val('y', .5) };
  };
  // the opening and end cards move like the builder's zoompan: z = min(1 + 0.0002 per frame, 1.06), centred
  FX.cardMotion = t => ({ z: Math.min(1 + 0.0002 * (Math.floor(t * 30) + 1), 1.06), x: .5, y: .5 });

  // ---------- transitions: GLSL bodies. P = ffmpeg's progress (1 -> 0), Q = 1 - P; x, y = pixel; W, H = size ----------
  // A(x, y) and B(x, y) give the two pictures' finished pixels; mx(a, b, m) = a*m + b*(1-m) as in vf_xfade.c.
  // fadeblack/fadewhite fade to luma 0 / 255 in ffmpeg's YUV (darker than video black, brighter than video white), so they are done in YUV too.
  const TR = {
    fade: 'col = mx(A(x,y), B(x,y), P);',
    cut: 'col = P > .5 ? A(x,y) : B(x,y);',          // no transition (the builder: a three-frame fade)
    wipeleft: 'float z = floor(W*P); col = x > z ? B(x,y) : A(x,y);',
    wiperight: 'float z = floor(W*(1.-P)); col = x > z ? A(x,y) : B(x,y);',
    wipeup: 'float z = floor(H*P); col = y > z ? B(x,y) : A(x,y);',
    wipedown: 'float z = floor(H*(1.-P)); col = y > z ? A(x,y) : B(x,y);',
    slideleft: 'float zx = -floor(P*W) + x; float zz = md(zx, W); col = (zx >= 0. && zx < W) ? B(zz,y) : A(zz,y);',
    slideright: 'float zx = floor(P*W) + x; float zz = md(zx, W); col = (zx >= 0. && zx < W) ? B(zz,y) : A(zz,y);',
    slideup: 'float zy = -floor(P*H) + y; float zz = md(zy, H); col = (zy >= 0. && zy < H) ? B(x,zz) : A(x,zz);',
    slidedown: 'float zy = floor(P*H) + y; float zz = md(zy, H); col = (zy >= 0. && zy < H) ? B(x,zz) : A(x,zz);',
    circlecrop: 'float z = pow(2.*abs(P-.5), 3.) * length(vec2(floor(W/2.), floor(H/2.))); float d = length(vec2(x - floor(W/2.), y - floor(H/2.))); col = z < d ? vec3(0.) : (P < .5 ? B(x,y) : A(x,y));',
    rectcrop: 'float zh = floor(abs(P-.5)*H), zw = floor(abs(P-.5)*W); bool inn = abs(x - floor(W/2.)) < zw && abs(y - floor(H/2.)) < zh; col = !inn ? vec3(0.) : (P < .5 ? B(x,y) : A(x,y));',
    distance: 'vec3 a = A(x,y), b = B(x,y); float d = length(yuv(a) - yuv(b)) <= P ? 1. : 0.; col = mx(mx(a, b, d), b, P);',
    fadeblack: 'vec3 k = vec3(0., 128./255., 128./255.); col = rgb(mx(mx(yuv(A(x,y)), k, ss(.8, 1., P)), mx(k, yuv(B(x,y)), ss(.2, 1., P)), P));',
    fadewhite: 'vec3 k = vec3(1., 128./255., 128./255.); col = rgb(mx(mx(yuv(A(x,y)), k, ss(.8, 1., P)), mx(k, yuv(B(x,y)), ss(.2, 1., P)), P));',
    fadegrays: 'vec3 a = A(x,y), b = B(x,y); vec3 ga = vec3(dot(a, LUMA)), gb = vec3(dot(b, LUMA)); col = mx(mx(a, ga, ss(.8, 1., P)), mx(gb, b, ss(.2, 1., P)), P);',
    radial: 'float sm = atan(x - floor(W/2.), y - floor(H/2.)) - (P - .5) * (3.14159265 * 2.5); col = mx(B(x,y), A(x,y), ss(0., 1., sm));',
    smoothleft: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + x/W - P*2.));',
    smoothright: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + (W-1.-x)/W - P*2.));',
    smoothup: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + y/H - P*2.));',
    smoothdown: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + (H-1.-y)/H - P*2.));',
    circleopen: 'float z = length(vec2(floor(W/2.), floor(H/2.))); float sm = length(vec2(x - floor(W/2.), y - floor(H/2.)))/z + (P - .5)*3.; col = mx(A(x,y), B(x,y), ss(0., 1., sm));',
    circleclose: 'float z = length(vec2(floor(W/2.), floor(H/2.))); float sm = length(vec2(x - floor(W/2.), y - floor(H/2.)))/z + (1. - P - .5)*3.; col = mx(B(x,y), A(x,y), ss(0., 1., sm));',
    vertopen: 'float w2 = W/2.; col = mx(B(x,y), A(x,y), ss(0., 1., 2. - abs((x - w2)/w2) - P*2.));',
    vertclose: 'float w2 = W/2.; col = mx(B(x,y), A(x,y), ss(0., 1., 1. + abs((x - w2)/w2) - P*2.));',
    horzopen: 'float h2 = H/2.; col = mx(B(x,y), A(x,y), ss(0., 1., 2. - abs((y - h2)/h2) - P*2.));',
    horzclose: 'float h2 = H/2.; col = mx(B(x,y), A(x,y), ss(0., 1., 1. + abs((y - h2)/h2) - P*2.));',
    dissolve: 'float sm = frand(x, y)*2. + P*2. - 1.5; col = sm >= .5 ? A(x,y) : B(x,y);',
    pixelize: 'float d = min(P, 1.-P); float di = ceil(d*50.)/50.; float sq = 2.*di*min(W,H)/20.; float sx = di > 0. ? floor(min((floor(x/sq)+.5)*sq, W-1.)) : x; float sy = di > 0. ? floor(min((floor(y/sq)+.5)*sq, H-1.)) : y; col = mx(A(sx,sy), B(sx,sy), P);',
    diagtl: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + x/W*y/H - P*2.));',
    diagtr: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + (W-1.-x)/W*y/H - P*2.));',
    diagbl: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + x/W*(H-1.-y)/H - P*2.));',
    diagbr: 'col = mx(B(x,y), A(x,y), ss(0., 1., 1. + (W-1.-x)/W*(H-1.-y)/H - P*2.));',
    hlslice: 'float sm = ss(-.5, 0., x/W - P*1.5); col = mx(B(x,y), A(x,y), sm <= fract(10.*x/W) ? 0. : 1.);',
    hrslice: 'float xx = (W-1.-x)/W; float sm = ss(-.5, 0., xx - P*1.5); col = mx(B(x,y), A(x,y), sm <= fract(10.*xx) ? 0. : 1.);',
    vuslice: 'float sm = ss(-.5, 0., y/H - P*1.5); col = mx(B(x,y), A(x,y), sm <= fract(10.*y/H) ? 0. : 1.);',
    vdslice: 'float yy = (H-1.-y)/H; float sm = ss(-.5, 0., yy - P*1.5); col = mx(B(x,y), A(x,y), sm <= fract(10.*yy) ? 0. : 1.);',
    hlwind: 'float fx = 1. - x/W; float r = frand(0., y); float m = ss(0., -.2, fx*(1.-.2) + .2*r - (1.-P)*(1.+.2)); col = mx(B(x,y), A(x,y), m);',
    hrwind: 'float fx = x/W; float r = frand(0., y); float m = ss(0., -.2, fx*(1.-.2) + .2*r - (1.-P)*(1.+.2)); col = mx(B(x,y), A(x,y), m);',
    vuwind: 'float fy = 1. - y/H; float r = frand(x, 0.); float m = ss(0., -.2, fy*(1.-.2) + .2*r - (1.-P)*(1.+.2)); col = mx(B(x,y), A(x,y), m);',
    vdwind: 'float fy = y/H; float r = frand(x, 0.); float m = ss(0., -.2, fy*(1.-.2) + .2*r - (1.-P)*(1.+.2)); col = mx(B(x,y), A(x,y), m);',
    hblur: 'float pr = P <= .5 ? P*2. : (1.-P)*2.; float sz = floor(1. + floor(W/2.)*pr); vec3 sa = vec3(0.), sb = vec3(0.); float n = 0.;' +
           'for (int i = 0; i < 64; i++) { float xx = x + floor((float(i) + .5) * sz / 64.); if (xx < W) { sa += A(xx,y); sb += B(xx,y); n += 1.; } } col = mx(sa/n, sb/n, P);',
    wipetl: 'float zw = floor(W*P), zh = floor(H*P); col = (y <= zh && x <= zw) ? A(x,y) : B(x,y);',
    wipetr: 'float zw = floor(W*(1.-P)), zh = floor(H*P); col = (y <= zh && x > zw) ? A(x,y) : B(x,y);',
    wipebl: 'float zw = floor(W*P), zh = floor(H*(1.-P)); col = (y > zh && x <= zw) ? A(x,y) : B(x,y);',
    wipebr: 'float zw = floor(W*(1.-P)), zh = floor(H*(1.-P)); col = (y > zh && x > zw) ? A(x,y) : B(x,y);',
    squeezeh: 'float z = .5 + (y/H - .5)/P; col = (z < 0. || z > 1.) ? B(x,y) : A(x, floor(z*(H-1.) + .5));',
    squeezev: 'float z = .5 + (x/W - .5)/P; col = (z < 0. || z > 1.) ? B(x,y) : A(floor(z*(W-1.) + .5), y);',
    zoomin: 'float zf = ss(.5, 1., P); float u = .5 + (x/W - .5)*zf, v = .5 + (y/H - .5)*zf; col = mx(A(ceil(u*(W-1.)), ceil(v*(H-1.))), B(x,y), ss(0., .5, P));',
    fadefast: 'vec3 a = yuv(A(x,y)), b = yuv(B(x,y)); vec3 m = pow(vec3(P), 1. + log(1. + abs(a - b))); col = rgb(a*m + b*(1.-m));',
    fadeslow: 'vec3 a = yuv(A(x,y)), b = yuv(B(x,y)); vec3 m = pow(vec3(P), 1. + log(2. - abs(a - b))); col = rgb(a*m + b*(1.-m));',
    coverleft: 'float zx = -floor(P*W) + x; col = (zx >= 0. && zx < W) ? B(md(zx, W), y) : A(x,y);',
    coverright: 'float zx = floor(P*W) + x; col = (zx >= 0. && zx < W) ? B(md(zx, W), y) : A(x,y);',
    coverup: 'float zy = -floor(P*H) + y; col = (zy >= 0. && zy < H) ? B(x, md(zy, H)) : A(x,y);',
    coverdown: 'float zy = floor(P*H) + y; col = (zy >= 0. && zy < H) ? B(x, md(zy, H)) : A(x,y);',
    revealleft: 'float zx = -floor(P*W) + x; col = (zx >= 0. && zx < W) ? B(x,y) : A(md(zx, W), y);',
    revealright: 'float zx = floor(P*W) + x; col = (zx >= 0. && zx < W) ? B(x,y) : A(md(zx, W), y);',
    revealup: 'float zy = -floor(P*H) + y; col = (zy >= 0. && zy < H) ? B(x,y) : A(x, md(zy, H));',
    revealdown: 'float zy = floor(P*H) + y; col = (zy >= 0. && zy < H) ? B(x,y) : A(x, md(zy, H));',
    // lib/trans.py (custom expressions, written with Q running 0 -> 1)
    glitchrows: 'float r = rnd(floor(y/(H/28.))); col = Q > r ? B(x,y) : A(x + (r-.5)*W*.25*sin(Q*3.14159265), y);',
    mosaic: 'float r = rnd(floor(x/(W/16.))*7. + floor(y/(H/28.))*131.); col = Q > r ? B(x,y) : A(x,y);',
    glitchblocks: 'float r = rnd(floor(x/(W/6.))*17. + floor(y/(H/10.))*57.); col = Q > r ? B(x,y) : A(x + (r-.5)*40.*sin(Q*3.14159265), y);',
    blindsv: 'col = md(x, W/10.)/(W/10.) < Q ? B(x,y) : A(x,y);',
    blindsh: 'col = md(y, H/12.)/(H/12.) < Q ? B(x,y) : A(x,y);',
    checker: 'col = Q > md(floor(x/(W/8.)) + floor(y/(H/14.)), 2.)*.5 ? B(x,y) : A(x,y);',
    diamond: 'col = abs(x-W/2.)/(W/2.) + abs(y-H/2.)/(H/2.) < Q*2. ? B(x,y) : A(x,y);',
    whipleft: 'float e = Q*Q*(3.-2.*Q); col = x < W*(1.-e) ? A(x + W*e, y) : B(x - W*(1.-e), y);',
    whipright: 'float e = Q*Q*(3.-2.*Q); col = x > W*e ? A(x - W*e, y) : B(x + W*(1.-e), y);',
    whipup: 'float e = Q*Q*(3.-2.*Q); col = y < H*(1.-e) ? A(x, y + H*e) : B(x, y - H*(1.-e));',
    zoomthrough: 'float s1 = 1. + Q*.6, s2 = 1.25 - Q*.25; col = (1.-Q)*A(W/2. + (x-W/2.)/s1, H/2. + (y-H/2.)/s1) + Q*B(W/2. + (x-W/2.)/s2, H/2. + (y-H/2.)/s2);',
    zoomout: 'float s1 = 1. - Q*.35, s2 = .75 + Q*.25; col = (1.-Q)*A(W/2. + (x-W/2.)/s1, H/2. + (y-H/2.)/s1) + Q*B(W/2. + (x-W/2.)/s2, H/2. + (y-H/2.)/s2);',
    ripple: 'float o = sin(y/(H/18.) + Q*12.)*W*.03*sin(Q*3.14159265); col = (1.-Q)*A(x+o, y) + Q*B(x+o, y);',
    flash: 'float f = 1. - abs(2.*Q - 1.); float f3 = f*f*f; col = ((1.-Q)*A(x,y) + Q*B(x,y))*(1.-f3) + f3;',
    doorsopen: 'float e = Q*Q*(3.-2.*Q); if (x < W/2.) { col = x < W/2.*(1.-e) ? A(x + W/2.*e, y) : B(x,y); } else { col = x > W/2. + W/2.*e ? A(x - W/2.*e, y) : B(x,y); }',
    doorsclose: 'float e = Q*Q*(3.-2.*Q); col = x < W/2.*e ? B(x + W/2.*(1.-e), y) : (x > W - W/2.*e ? B(x - W/2.*(1.-e), y) : A(x,y));',
    whipdown: 'float e = Q*Q*(3.-2.*Q); col = y > H*e ? A(x, y - H*e) : B(x, y + H*(1.-e));',
    lumafade: 'col = Q*1.2 - .1 > dot(A(x,y), LUMA) ? B(x,y) : A(x,y);',
    heart: 'float sc = W*.36*(Q*2.4+.001); float u = (x-W/2.)/sc, v = -(y-H*.47)/sc; float q = u*u+v*v-1.; col = q*q*q - u*u*v*v*v <= 0. ? B(x,y) : A(x,y);',
    star: 'float r = length(vec2(x-W/2., y-H/2.))/length(vec2(W/2., H/2.)); col = r < Q*1.6*(.62+.38*cos(5.*atan(y-H/2., x-W/2.))) ? B(x,y) : A(x,y);',
    cross: 'col = (abs(x-W/2.)/W < Q*.75 || abs(y-H/2.)/H < Q*.75) ? B(x,y) : A(x,y);',
    circlegrid: 'float c = W/7.; col = length(vec2(x-(floor(x/c)+.5)*c, y-(floor(y/c)+.5)*c))/c < Q*.75 ? B(x,y) : A(x,y);',
    diagstripes: 'col = md((x+y)/(W/6.), 1.) < Q ? B(x,y) : A(x,y);',
    bounceslide: 'float eb = 1. - (1.-Q)*(1.-Q)*cos(Q*3.*3.14159265); col = x >= W*(1.-eb) ? B(x - W*(1.-eb), y) : A(x + W*eb, y);',
    spin: 'float s = Q < .5 ? 1. - Q*1.6 : .2 + (Q-.5)*1.6, a = Q < .5 ? Q*3.14159265 : (Q-1.)*3.14159265; float u = x-W/2., v = y-H/2.;' +
          'float xs = W/2. + (u*cos(a)+v*sin(a))/s, ys = H/2. + (-u*sin(a)+v*cos(a))/s; bool inn = xs >= 0. && xs <= W-1. && ys >= 0. && ys <= H-1.; col = !inn ? vec3(0.) : (Q < .5 ? A(xs,ys) : B(xs,ys));',
    twirl: 'float u = x-W/2., v = y-H/2.; float a = 12.566*Q*(1.-Q)*max(0., 1.-length(vec2(u,v))/length(vec2(W/2.,H/2.))); float xs = W/2. + u*cos(a) - v*sin(a), ys = H/2. + u*sin(a) + v*cos(a); col = (1.-Q)*A(xs,ys) + Q*B(xs,ys);',
    filmroll: 'float o = H*1.08*Q*Q*(3.-2.*Q); col = y < H - o ? A(x, y + o) : (y < H*1.08 - o ? vec3(0.) : B(x, y - (H*1.08 - o)));',
    blackflash: 'float f = 1. - abs(2.*Q - 1.); float f3 = f*f*f; col = ((1.-Q)*A(x,y) + Q*B(x,y))*(1.-f3);',
    shakecut: 'float o = sin(Q*40.)*W*.03*(1.-abs(2.*Q-1.)); col = Q < .5 ? A(x+o,y) : B(x+o,y);',
    flashcut: 'float d = (Q-.5)/.12; float f = exp(-d*d); col = (Q < .5 ? A(x,y) : B(x,y))*(1.-f) + f;',
    slicesslide: 'float rw = floor(y/(H/12.)); float q = clamp((Q - rnd(rw*7.+3.)*.4)/.6, 0., 1.); q = q*q*(3.-2.*q); col = x < W*(1.-q) ? A(x + W*q, y) : B(x - W*(1.-q), y);',
    barslide: 'float c = md(floor(x/(W/10.)), 2.); if (c < .5) { col = y < H*(1.-Q) ? A(x, y + H*Q) : B(x, y - H*(1.-Q)); } else { col = y > H*Q ? A(x, y - H*Q) : B(x, y + H*(1.-Q)); }',
  };
  FX.TRANSITIONS = Object.keys(TR);
  FX.load_effects = () => FX.DEF.effects.map(e => ({ id: e[0], label: e[1], group: e[2] }));

  const VS = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }';
  const FS_HEAD = `precision highp float;
uniform sampler2D tA, tB; uniform vec2 R; uniform float P, Q, frame;
uniform vec3 zA, zB; uniform mat3 mA, mB; uniform vec3 oA, oB; uniform vec2 vnA, vnB; uniform float seedA, seedB;
const vec3 LUMA = vec3(.299, .587, .114);
float md(float a, float b) { return a - b * floor(a / b); }
float ss(float e0, float e1, float x) { float t = clamp((x - e0) / (e1 - e0), 0., 1.); return t * t * (3. - 2. * t); }
vec3 mx(vec3 a, vec3 b, float m) { return a * m + b * (1. - m); }
vec3 yuv(vec3 c) { return vec3(16. + 219. * dot(c, vec3(.299, .587, .114)), 128. + 224. * dot(c, vec3(-.168736, -.331264, .5)), 128. + 224. * dot(c, vec3(.5, -.418688, -.081312))) / 255.; }
vec3 rgb(vec3 v) { float Y = (v.x * 255. - 16.) / 219., U = (v.y * 255. - 128.) / 224., V = (v.z * 255. - 128.) / 224.; return vec3(Y + 1.402 * V, Y - .344136 * U - .714136 * V, Y + 1.772 * U); }
float frand(float x, float y) { float r = sin(x * 12.9898 + y * 78.233) * 43758.545; return r - floor(r); }
uniform sampler2D tR;
float rnd(float v) { return texture2D(tR, vec2((mod(v, 4096.) + .5) / 4096., .5)).r; }
float hash3(vec3 p) { p = fract(p * .1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
vec3 lay(sampler2D t, vec3 zm, mat3 m, vec3 o, vec2 vn, float seed, float x, float y) {
  vec2 q = (floor(vec2(clamp(x, 0., R.x - 1.), clamp(y, 0., R.y - 1.))) + .5) / R;
  float z = zm.x; vec2 uv = vec2(zm.y, zm.z) * (1. - 1. / z) + q / z;
  vec3 c = clamp(m * texture2D(t, uv).rgb + o, 0., 1.);
  float d = length(q * 2. - 1.) / 1.41421356; float s = clamp((d - .3) / .7, 0., 1.); c *= 1. - min(vn.x, 1.) * s * s;
  if (vn.y > 0.) c += (hash3(vec3(floor(x), floor(y), frame + seed)) - .5) * vn.y * .3;
  return c; }
vec3 A(float x, float y) { return lay(tA, zA, mA, oA, vnA, seedA, x, y); }
vec3 B(float x, float y) { return lay(tB, zB, mB, oB, vnB, seedB, x, y); }
void main() { float W = R.x, H = R.y; float x = floor(gl_FragCoord.x), y = H - 1. - floor(gl_FragCoord.y); vec3 col;
`;

  class Stage {
    constructor(canvas) {
      this.cv = canvas;
      const gl = this.gl = canvas.getContext('webgl', { premultipliedAlpha: false, preserveDrawingBuffer: true, alpha: false });
      if (!gl) throw new Error('WebGL is not available in this browser');
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
      const rt = new Uint8Array(4096 * 4);
      for (let i = 0; i < 4096; i++) { const r = Math.sin(i * 12.9898) * 43758.5453, v = Math.round((r - Math.floor(r)) * 255); rt.set([v, v, v, 255], i * 4); }
      this.rtab = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.rtab);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4096, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rt);
      this.progs = {};
      this.tex = new Map();
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      this.white = this._texFrom(null);
    }
    _compile(name) {
      const gl = this.gl, body = TR[name] || TR.fade;
      const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(name + ': ' + gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram();
      gl.attachShader(p, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS_HEAD + body + '\n gl_FragColor = vec4(clamp(col, 0., 1.), 1.); }'));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; ['tA', 'tB', 'tR', 'R', 'P', 'Q', 'frame', 'zA', 'zB', 'mA', 'mB', 'oA', 'oB', 'vnA', 'vnB', 'seedA', 'seedB'].forEach(k => u[k] = gl.getUniformLocation(p, k));
      return this.progs[name] = { p, u, a: gl.getAttribLocation(p, 'p') };
    }
    _texFrom(src) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      return t;
    }
    /* A texture of a picture, cover-cropped to the stage's shape (as the builder crops it), with an optional soft blur.
       Cached by key; source may be an <img>, a canvas or a <video> (live: pass key null to upload a fresh frame each call). */
    layer(src, key, blurPx) {
      if (key && this.tex.has(key)) return this.tex.get(key);
      const W = this.cv.width, H = this.cv.height;
      const sw = src.videoWidth || src.naturalWidth || src.width, sh = src.videoHeight || src.naturalHeight || src.height;   // video, <img>, ImageBitmap or canvas
      let tex;
      if (sw === W && sh === H && !blurPx) {
        tex = key ? this._texFrom(src) : (this._live = this._live || this._texFrom(null));
        if (!key) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src); }
      } else {
        const c = this._scratch = this._scratch || document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d'), k = Math.max(W / sw, H / sh);
        g.filter = blurPx ? `blur(${blurPx}px)` : 'none';
        g.drawImage(src, (W - sw * k) / 2, (H - sh * k) / 2, sw * k, sh * k);
        tex = key ? this._texFrom(c) : (this._live = this._live || this._texFrom(null));
        if (!key) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, c); }
      }
      if (key) this.tex.set(key, tex);
      return tex;
    }
    forget() { const gl = this.gl; this.tex.forEach(t => gl.deleteTexture(t)); this.tex.clear(); }
    /* Draw layer A alone (B null), or the transition `name` from A to B at time progress t (0 = all A, 1 = all B). */
    draw(A, B, name, t, frame) {
      const gl = this.gl, pr = this.progs[B ? name : 'fade'] || this._compile(B ? name : 'fade'), u = pr.u;
      gl.viewport(0, 0, this.cv.width, this.cv.height);
      gl.useProgram(pr.p);
      gl.enableVertexAttribArray(pr.a); gl.vertexAttribPointer(pr.a, 2, gl.FLOAT, false, 0, 0);
      const P = B ? 1 - Math.min(1, Math.max(0, t)) : 1;
      gl.uniform2f(u.R, this.cv.width, this.cv.height); gl.uniform1f(u.P, P); gl.uniform1f(u.Q, 1 - P); gl.uniform1f(u.frame, frame || 0);
      const set = (L, ab, unit) => {
        L = L || A;
        gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, L.tex || this.white); gl.uniform1i(u['t' + ab], unit);
        gl.uniform3f(u['z' + ab], L.z || 1, L.x == null ? .5 : L.x, L.y == null ? .5 : L.y);
        const m = L.m || [1, 0, 0, 0, 1, 0, 0, 0, 1];
        gl.uniformMatrix3fv(u['m' + ab], false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
        const o = L.o || [0, 0, 0]; gl.uniform3f(u['o' + ab], o[0], o[1], o[2]);
        gl.uniform2f(u['vn' + ab], L.v || 0, L.n || 0); gl.uniform1f(u['seed' + ab], L.seed || 0);
      };
      set(A, 'A', 0); set(B, 'B', 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.rtab); gl.uniform1i(u.tR, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
  FX.Stage = Stage;
  window.FX = FX;
})();
