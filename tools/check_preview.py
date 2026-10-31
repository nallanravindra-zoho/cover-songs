"""Automatic check: does the live preview draw what the video builder makes?

    .venv/bin/python tools/check_preview.py            (a few minutes; add names, e.g. fade warm zoom_in, to check only those)

Draws the same two test pictures with ffmpeg (as the builder does) and with lib/fx.js in Chrome (as the settings page does), and
compares them pixel by pixel for every transition, filter and picture motion, and checks the colour tables (LUT) that give her
video the same filters. Differences are shown on a 0-255 scale (average
over all pixels and colours). Transitions with a random pattern (dissolve, mosaic, glitch, wind) are compared on 8x8 blocks,
because the browser's and ffmpeg's random numbers differ while the look is the same. The custom transitions of lib/trans.py
are also made twice, to catch a formula that gives a different video on every run.
Exit code 1 if anything differs by more than the limit.
"""
import base64, io, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import fx
import trans

W, H = 180, 320
LIMIT, LIMIT_RANDOM = 6.0, 9.0
RANDOM = {"dissolve", "mosaic", "glitchrows", "glitchblocks", "hlwind", "hrwind", "vuwind", "vdwind", "distance"}


def test_picture(seed, w=W, h=H):
    """A colourful picture with edges and texture, so moves and colour changes show."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    a = np.stack([0.5 + 0.5 * np.sin(6 * x + seed), 0.5 + 0.5 * np.cos(5 * y - seed), 0.5 + 0.4 * np.sin(4 * (x + y) * (seed + 1))], -1)
    im = Image.fromarray((a * 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for _ in range(14):
        x0, y0 = rng.integers(0, w), rng.integers(0, h)
        r = int(rng.integers(w // 14, w // 5))
        d.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=tuple(int(v) for v in rng.integers(0, 255, 3)))
    for i in range(0, w, max(4, w // 12)):
        d.line([(i, 0), (i, h)], fill=(20, 20, 20), width=max(1, w // 180))
    return im


def png_uri(im):
    b = io.BytesIO()
    im.save(b, "PNG")
    return "data:image/png;base64," + base64.b64encode(b.getvalue()).decode()


def rgb_frames(cmd, w, h):
    raw = subprocess.run(cmd + ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    n = w * h * 3
    return [np.frombuffer(raw[i * n:(i + 1) * n], np.uint8).reshape(h, w, 3) for i in range(len(raw) // n)]


def ffmpeg_transition(name, fa, fb):
    tn, tx = trans.xfade_arg(name)
    f = (f"[0:v]format=yuv444p,fps=20[a];[1:v]format=yuv444p,fps=20[b];[a][b]xfade=transition={tn}{tx}:duration=1:offset=0.5,"
         "format=rgb24")
    fr = rgb_frames(["ffmpeg", "-loglevel", "error", "-loop", "1", "-t", "2", "-framerate", "20", "-i", fa, "-loop", "1", "-t", "2", "-framerate", "20", "-i", fb,
                     "-filter_complex", f], W, H)
    return {t: fr[10 + int(round(t * 20))] for t in (0.25, 0.5, 0.75)}    # frame 10 is the transition's start (0.5 s)


def diff(a, b, block=1):
    a, b = a.astype(np.float32), b.astype(np.float32)
    if block > 1:
        h, w = a.shape[0] // block * block, a.shape[1] // block * block
        a = a[:h, :w].reshape(h // block, block, w // block, block, 3).mean((1, 3))
        b = b[:h, :w].reshape(h // block, block, w // block, block, 3).mean((1, 3))
    return float(np.abs(a - b).mean())


PAGE = """<!doctype html><html><body style="margin:0"><canvas id="c" width="%d" height="%d"></canvas></body></html>"""


def main():
    from playwright.sync_api import sync_playwright
    tmp = Path(tempfile.mkdtemp(prefix="check_preview_"))
    A, B = test_picture(1), test_picture(2)
    fa, fb = tmp / "a.png", tmp / "b.png"
    A.save(fa)
    B.save(fb)
    def_json = json.loads((HERE / "lib" / "fx.json").read_text(encoding="utf-8"))
    bad, rows = [], []
    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=True)
        except Exception:
            br = p.chromium.launch(headless=True)
        pg = br.new_page()
        pg.set_content(PAGE % (W, H))
        pg.add_script_tag(path=str(HERE / "lib" / "fx.js"))
        pg.evaluate("""async ([def, a, b]) => {
            FX.use(def); window.st = new FX.Stage(document.getElementById('c'));
            const load = u => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; });
            window.ia = await load(a); window.ib = await load(b); }""", [def_json, png_uri(A), png_uri(B)])

        def grab(js, arg=None):
            px = pg.evaluate("""([js, arg]) => { (new Function('arg', js))(arg); const gl = st.gl, w = st.cv.width, h = st.cv.height;
                const d = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d); return Array.from(d); }""", [js, arg])
            a = np.array(px, np.uint8).reshape(H, W, 4)[::-1, :, :3]
            return a

        # --- transitions: every one the page offers ---
        names = pg.evaluate("FX.TRANSITIONS")
        ui = (HERE / "ui" / "index.html").read_text(encoding="utf-8")
        import re
        tl = re.search(r"const TLIST=\[(.*?)\];", ui, re.S).group(1)
        offered = set(re.findall(r"'([a-z]+)'", tl)) | set(re.findall(r"'([a-z]+)'", re.search(r"const TREND=\[(.*?)\];", ui).group(1))) \
            | set(re.findall(r"'([a-z]+)'", re.search(r"const MORE=\[(.*?)\];", ui).group(1)))
        missing = sorted(offered - set(names))
        if missing:
            bad.append(f"transitions offered in the page but not drawn by the preview: {', '.join(missing)}")
        only = set(sys.argv[1:])
        for name in sorted(offered & set(names)):
            if only and name not in only:
                continue
            ref = ffmpeg_transition(name, str(fa), str(fb))
            if name in trans.CUSTOM and any(not np.array_equal(ref[t], again) for t, again in ffmpeg_transition(name, str(fa), str(fb)).items()):
                bad.append(f"transition {name}: ffmpeg gives a different result each run (a formula that is not safe to run on several threads)")
            worst = 0.0
            for t, want in ref.items():
                got = grab("const A = {tex: st.layer(ia, 'a')}, B = {tex: st.layer(ib, 'b')}; st.draw(A, B, arg[0], arg[1]);", [name, t])
                worst = max(worst, diff(got, want, 8 if name in RANDOM else 1))
            lim = LIMIT_RANDOM if name in RANDOM else LIMIT
            rows.append(("transition", name, worst, lim))
        # --- filters: lib/fx.py on the picture vs the preview's colour formula ---
        for fid in [f[0] for f in def_json["filters"] if not only or f[0] in only]:
            spec = {"filter": fid}
            pm, pj = fx.params(spec), pg.evaluate("s => FX.params(s)", spec)
            M, o = fx.matrix(pm)
            mj = pg.evaluate("p => FX.matrix(p)", pj)
            if not (np.allclose(M.flatten(), mj["m"], atol=1e-9) and np.allclose(o, mj["o"], atol=1e-9)):
                bad.append(f"filter {fid}: the preview's colour formula differs from the builder's")
            if pm["n"] > 0 or pm["bl"] > 0:
                pm2 = dict(spec, adjust={"n": -pm["n"], "bl": -pm["bl"]})      # grain is random and blur is approximate: compared without them
            else:
                pm2 = spec
            want = np.asarray(Image.open(fx.still(fa, (W, H), pm2, tmp, W / 1080)).convert("RGB")).astype(np.float32)
            va = fx.vignette_alpha(W, H, fx.params(pm2)["v"])
            if va is not None:
                want = want * (1 - np.round(va * 255)[..., None] / 255)
            got = grab("const p = FX.params(arg), m = FX.matrix(p); st.draw({tex: st.layer(ia, 'a'), m: m.m, o: m.o, v: p.v}, null, 'fade', 0);", pm2)
            rows.append(("filter", fid, diff(got, want.astype(np.uint8)), LIMIT))
            # her video gets the same colours through ffmpeg's lut3d (render.video_fx_chain): the table against the formula
            M, o = fx.matrix(fx.params(spec))
            exact = np.clip(np.asarray(A, np.float32) / 255 @ M.T + o, 0, 1) * 255
            lut = rgb_frames(["ffmpeg", "-loglevel", "error", "-i", str(fa), "-vf", f"format=gbrp,lut3d=file='{fx.lut_file(fx.params(spec), tmp)}':interp=tetrahedral,format=rgb24"], W, H)[0]
            rows.append(("video", fid, diff(lut, exact.round().astype(np.uint8)), 2.0))
        # --- motions: ffmpeg zoompan (as the builder moves a picture) vs the preview ---
        pre = 3
        big = test_picture(3, W * pre, H * pre)
        fbig = tmp / "big.png"
        big.save(fbig)
        pg.evaluate("async u => { window.ibig = await new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = u; }); }", png_uri(big))
        frames = 41
        for mid in [m[0] for m in def_json["motions"] if not only or m[0] in only]:
            z, x, y = fx.zoompan_exprs(mid, frames)
            fr = rgb_frames(["ffmpeg", "-loglevel", "error", "-i", str(fbig), "-vf", f"zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={W}x{H}:fps=20,format=rgb24"], W, H)
            worst = 0.0
            for i in (10, 20, 30):
                got = grab("const m = FX.motion(arg[0], arg[1]); st.draw({tex: st.layer(ibig, 'big'), z: m.z, x: m.x, y: m.y}, null, 'fade', 0);", [mid, i / (frames - 1)])
                worst = max(worst, diff(got, fr[i], 4))
            rows.append(("motion", mid, worst, LIMIT))
        br.close()
    w = max(len(r[1]) for r in rows)
    for kind, name, d, lim in rows:
        flag = "ok" if d <= lim else "DIFFERENT"
        print(f"{kind:10s} {name:{w}s}  difference {d:5.1f}  {flag}")
        if d > lim:
            bad.append(f"{kind} {name}: differs by {d:.1f} (limit {lim})")
    print()
    if bad:
        print("NOT OK:\n  " + "\n  ".join(bad))
        sys.exit(1)
    print(f"All {len(rows)} checks match: the preview draws transitions, filters and motions like the video builder.")


if __name__ == "__main__":
    main()
