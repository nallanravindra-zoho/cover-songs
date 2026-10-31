"""Picture filters and motions for interlude pictures (definitions in fx.json, shared with the live preview in fx.js).

A filter is turned into one colour formula, out = M * rgb + o (values 0..1), plus a vignette, film grain and a soft blur.
The preview computes the same M and o in fx.js; tools/check_preview.py compares the two.
"""
import hashlib, json, math
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
DEF = json.loads((HERE / "fx.json").read_text(encoding="utf-8"))
FILTERS = {f[0]: {"id": f[0], "label": f[1], "group": f[2], "p": f[3]} for f in DEF["filters"]}
MOTIONS = {m[0]: {"id": m[0], "label": m[1], **m[2]} for m in DEF["motions"]}
IDENT = {"b": 1, "c": 1, "s": 1, "h": 0, "w": 0, "t": 0, "f": 0, "sep": 0, "g": 0, "v": 0, "n": 0, "bl": 0}
LEGACY_MOTION = {"pan": "drift_left", "none": "still"}


def params(spec):
    """{"filter": id, "amount": 0..1, "adjust": {key: value}} -> the full set of adjustments.
    The filter is blended with "unchanged" by amount; the adjust sliders then multiply (b, c, s) or add (the rest)."""
    spec = spec or {}
    pre = FILTERS.get(spec.get("filter") or "original", FILTERS["original"])["p"]
    a = float(spec.get("amount", 1) if spec.get("amount") is not None else 1)
    out = {k: IDENT[k] + (pre.get(k, IDENT[k]) - IDENT[k]) * a for k in IDENT}
    for k, v in (spec.get("adjust") or {}).items():
        if k in ("b", "c", "s"):
            out[k] *= float(v)
        elif k in out:
            out[k] += float(v)
    return out


def _sat(s):
    return np.array([[.213 + .787 * s, .715 - .715 * s, .072 - .072 * s],
                     [.213 - .213 * s, .715 + .285 * s, .072 - .072 * s],
                     [.213 - .213 * s, .715 - .715 * s, .072 + .928 * s]])


def _hue(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[.213 + c * .787 - s * .213, .715 - c * .715 - s * .715, .072 - c * .072 + s * .928],
                     [.213 - c * .213 + s * .143, .715 + c * .285 + s * .140, .072 - c * .072 - s * .283],
                     [.213 - c * .213 - s * .787, .715 - c * .715 + s * .715, .072 + c * .928 + s * .072]])


def _sepia(a):
    i = 1 - a
    return np.array([[.393 + .607 * i, .769 - .769 * i, .189 - .189 * i],
                     [.349 - .349 * i, .686 + .314 * i, .168 - .168 * i],
                     [.272 - .272 * i, .534 - .534 * i, .131 + .869 * i]])


def _gray(a):
    i = 1 - a
    return np.array([[.2126 + .7874 * i, .7152 - .7152 * i, .0722 - .0722 * i],
                     [.2126 - .2126 * i, .7152 + .2848 * i, .0722 - .0722 * i],
                     [.2126 - .2126 * i, .7152 - .7152 * i, .0722 + .9278 * i]])


def matrix(p):
    """(M 3x3, o 3): the colour formula for these adjustments, applied in this order:
    brightness, contrast, saturation, hue, sepia, black and white, warmth, tint, fade."""
    M, o = np.eye(3), np.zeros(3)

    def step(A, b=None):
        nonlocal M, o
        M = A @ M
        o = A @ o + (np.zeros(3) if b is None else np.asarray(b, float))
    step(np.eye(3) * p["b"])
    step(np.eye(3) * p["c"], [0.5 * (1 - p["c"])] * 3)
    step(_sat(p["s"]))
    step(_hue(p["h"]))
    step(_sepia(min(1, max(0, p["sep"]))))
    step(_gray(min(1, max(0, p["g"]))))
    step(np.diag([1 + .10 * p["w"], 1 + .02 * p["w"], 1 - .12 * p["w"]]))
    step(np.diag([1 + .06 * p["t"], 1 - .10 * p["t"], 1 + .06 * p["t"]]))
    f = min(1, max(0, p["f"]))
    step(np.eye(3) * (1 - .35 * f), [.12 * f] * 3)
    return M, o


def is_plain(spec):
    p = params(spec)
    return all(abs(p[k] - IDENT[k]) < 1e-6 for k in IDENT)


def vignette_alpha(w, h, v):
    """Darkening 0..1 per pixel: grows from 30 % of the way to the corners, strongest in the corners. Same formula in fx.js."""
    if v <= 0:
        return None
    xs = ((np.arange(w) + .5) / w) * 2 - 1
    ys = ((np.arange(h) + .5) / h) * 2 - 1
    d = np.sqrt(xs[None, :] ** 2 + ys[:, None] ** 2) / math.sqrt(2)
    s = np.clip((d - .3) / .7, 0, 1)
    return np.clip(min(1.0, v) * s * s, 0, 1)


def vignette_png(w, h, v, work):
    """A black picture whose transparency is the vignette, laid over the moving picture by ffmpeg."""
    from PIL import Image
    out = Path(work) / f"vig_{w}x{h}_{round(v, 3)}.png"
    if not out.exists():
        a = (vignette_alpha(w, h, v) * 255 + .5).astype(np.uint8)
        im = np.zeros((h, w, 4), np.uint8)
        im[..., 3] = a
        Image.fromarray(im, "RGBA").save(out)
    return out


def still(src, size, spec, work, scale=1.0):
    """The picture cover-cropped to `size`, with the filter's colour formula and blur applied (cached).
    scale = how many picture pixels one pixel of the 1080-wide frame is (for the blur)."""
    from PIL import Image, ImageFilter, ImageOps
    src = Path(src)
    st = src.stat()
    p = params(spec)
    key = hashlib.md5(json.dumps([str(src), st.st_size, st.st_mtime, size, p, scale], sort_keys=True).encode()).hexdigest()[:16]
    out = Path(work) / f"still_{key}.jpg"
    if out.exists():
        return out
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    W, H = size
    k = max(W / im.width, H / im.height)
    nw, nh = max(W, round(im.width * k)), max(H, round(im.height * k))
    im = im.resize((nw, nh), Image.LANCZOS).crop(((nw - W) // 2, (nh - H) // 2, (nw - W) // 2 + W, (nh - H) // 2 + H))
    if p["bl"] > 0:
        im = im.filter(ImageFilter.GaussianBlur(p["bl"] * scale))
    M, o = matrix(p)
    if not (np.allclose(M, np.eye(3)) and np.allclose(o, 0)):
        a = np.asarray(im, np.float32) / 255.0
        a = np.clip(a @ M.T.astype(np.float32) + o.astype(np.float32), 0, 1)
        im = Image.fromarray((a * 255 + .5).astype(np.uint8))
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, quality=95, subsampling=0)
    return out


def motion(name):
    return MOTIONS.get(LEGACY_MOTION.get(name, name) or "zoom_in", MOTIONS["zoom_in"])


def _ease(kind, U):
    return {"lin": U, "inout": f"({U})*({U})*(3-2*({U}))", "out": f"(1-pow(1-({U}),3))", "wave": f"sin(PI*({U}))"}[kind or "lin"]


def zoompan_exprs(name, frames):
    """ffmpeg zoompan z, x, y expressions for this motion over `frames` frames. x and y place the visible window inside the
    picture: 0 = left/top edge, 1 = right/bottom edge (the same numbers fx.js uses for the preview)."""
    m = motion(name)
    U = f"min(on/{max(1, frames - 1)},1)"
    E = _ease(m.get("ease"), U)

    def val(key, default):
        a, b = m.get(key, [default, default])
        return f"{a}" if a == b else f"({a}+({b - a})*{E})"
    z = val("z", 1)
    return z, f"{val('x', .5)}*(iw-iw/zoom)", f"{val('y', .5)}*(ih-ih/zoom)"


def interlude_parts(it, total, default_motion, between):
    """Times of the pictures inside one interlude (seconds from the interlude's start). Each picture's share is its "weight"
    (its length in seconds when it was last set; equal when none is set), scaled to the interlude's length; the transition into a
    picture is centred on the boundary. Same rule as partTimes() in ui/editor.js. Returns [{..picture, "s", "e", "tin", "din"}]."""
    pics = it["pictures"]
    n = len(pics)
    ws = [max(0.05, float(pc.get("weight") or 0) or 1.0) for pc in pics] if any(pc.get("weight") for pc in pics) else [1.0] * n
    W = sum(ws)
    b = [total * sum(ws[:j]) / W for j in range(n + 1)]            # boundaries
    out = []
    for j, pc in enumerate(pics):
        d = 0.0
        if j:
            d = float(pc.get("trans_seconds") or between["seconds"])
            d = max(0.2, min(d, (b[j] - b[j - 1]) * 0.5, (b[j + 1] - b[j]) * 0.5))
        tin = (pc.get("trans") or between["name"]) if j else None
        out.append(dict(pc, motion=pc.get("motion") or default_motion, tin=tin, din=0.1 if tin == "cut" else round(d, 3)))
    for j, o in enumerate(out):
        o["s"] = 0.0 if j == 0 else round(b[j] - o["din"] / 2, 3)
        o["e"] = round(total, 3) if j == n - 1 else round(b[j + 1] + out[j + 1]["din"] / 2, 3)
    return out


def colour_plain(p):
    M, o = matrix(p)
    return bool(np.allclose(M, np.eye(3)) and np.allclose(o, 0))


def lut_file(p, work, n=33):
    """The colour formula as a 3D table (.cube) for ffmpeg's lut3d, used on her video: the same out = M * rgb + o, cut to 0..1."""
    M, o = matrix(p)
    key = hashlib.md5(json.dumps([M.round(6).tolist(), o.round(6).tolist(), n]).encode()).hexdigest()[:16]
    out = Path(work) / f"lut_{key}.cube"
    if not out.exists():
        g = np.linspace(0, 1, n)
        b, gg, r = np.meshgrid(g, g, g, indexing="ij")                  # .cube order: red changes fastest
        rgb = np.stack([r.ravel(), gg.ravel(), b.ravel()], 1)
        v = np.clip(rgb @ M.T + o, 0, 1)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(f"LUT_3D_SIZE {n}\n" + "\n".join(f"{a:.6f} {c:.6f} {d:.6f}" for a, c, d in v) + "\n")
    return out


def motion_exprs_timed(clips, fps_var="it"):
    """zoompan z, x, y for her video: each clip's motion over the clip's own time (t from its start to its end), still elsewhere."""
    def part(key, default):
        e = f"{default}"
        for v in reversed(clips):
            m = motion(v.get("motion") or "still")
            a, b = m.get(key, [default, default])
            U = f"min(max(({fps_var}-{v['t0']:.3f})/{max(0.01, v['t1'] - v['t0']):.3f},0),1)"
            val = f"{a}" if a == b else f"({a}+({b - a})*{_ease(m.get('ease'), U)})"
            e = f"if(between({fps_var},{v['t0']:.3f},{v['t1']:.3f}),{val},{e})"
        return e
    return part("z", 1), f"{part('x', .5)}*(iw-iw/zoom)", f"{part('y', .5)}*(ih-ih/zoom)"


# ---------- effects over a stretch of time (shake, flash, glitch ..), on the whole frame; the preview does the same in editor.js ----------
EFFECTS = {e[0]: {"id": e[0], "label": e[1], "group": e[2]} for e in DEF["effects"]}


def rnd(v):
    """The same pseudo-random number 0..1 as editor.js's rnd()."""
    r = math.sin(v * 12.9898) * 43758.5453
    return r - math.floor(r)


def glitch_slots(e):
    """The tenths of a second in which a glitch effect jumps: [(t0, t1, dx share of the width)]."""
    seed, out = round(e["start"] * 10), []
    for j in range(int((e["end"] - e["start"]) * 10) + 1):
        if rnd(j * 7.13 + seed) > 0.6:
            a = e["start"] + j / 10
            out.append((a, min(e["end"], a + 0.1), (rnd(j * 3.7 + seed + 1) - 0.5) * 0.06 * e.get("amount", 1)))
    return out


def effect_chain(effects, W, H, a, L, fps=30):
    """ffmpeg filters for the effects (times on the song, `a` = where this video starts): colour effects first, then the moves.
    Returns a list of (kind, text): ("f", filters to append) or ("g", a geometric step written as split/move/overlay)."""
    col, geo = [], []
    for e in effects:
        t0, t1 = e["start"] - a, e["end"] - a
        if t1 <= 0 or t0 >= L:
            continue
        k, on, T = float(e.get("amount", 1)), f"enable='between(t,{t0:.3f},{t1:.3f})'", f"(t-{t0:.3f})"
        ty = e["type"]
        if ty == "flash":
            col.append(f"eq=brightness='0.855*0.55*{k}*pow(1-(2*{T}-floor(2*{T})),2)':eval=frame:{on}")
        elif ty == "dip":
            col.append(f"eq=brightness='-0.855*{k}*sin(PI*{T}/{max(0.01, t1 - t0):.3f})':eval=frame:{on}")
        elif ty == "strobe":
            col.append(f"hue=s='if(mod(floor(8*{T}),2),0,1)':{on}")
        elif ty == "invert":
            col.append(f"negate={on}")
        elif ty == "blur":
            col.append(f"gblur=sigma={8 * k * W / 1080:.2f}:{on}")
        elif ty == "rgb":
            s = max(1, round(10 * k * W / 1080))
            col.append(f"rgbashift=rh={-s}:bh={s}:{on}")
        elif ty == "oldfilm":
            col.append(f"colorchannelmixer=rr=.393:rg=.769:rb=.189:gr=.349:gg=.686:gb=.168:br=.272:bg=.534:bb=.131:{on}")
            col.append(f"eq=brightness='0.855*0.05*{k}*sin(2*PI*11*{T})*sin(2*PI*3.3*{T}+0.5)':eval=frame:{on}")
            col.append(f"noise=c0s={round(18 * k)}:c0f=t+u:{on}")
        elif ty == "vhs":
            s = max(1, round(5 * k * W / 1080))
            S = 1.3
            m = [.213 + .787 * S, .715 - .715 * S, .072 - .072 * S, .213 - .213 * S, .715 + .285 * S, .072 - .072 * S, .213 - .213 * S, .715 - .715 * S, .072 + .928 * S]
            col.append(f"rgbashift=rh={-s}:bh={s}:{on}")
            col.append("colorchannelmixer=" + ":".join(f"{n}={v:.4f}" for n, v in zip(("rr", "rg", "rb", "gr", "gg", "gb", "br", "bg", "bb"), m)) + f":{on}")
            col.append(f"noise=c0s={round(14 * k)}:c0f=t+u:{on}")
            geo.append(("crop", 1.01, "0", f"0.004*{k}*sin(2*PI*13*{T})", t0, t1))
        elif ty == "shake":
            A = 0.012 * k
            geo.append(("crop", 1 + 2.4 * A, f"{A}*sin(2*PI*9.3*{T})", f"{0.6 * A}*sin(2*PI*7.1*{T}+1)", t0, t1))
        elif ty == "zoom":
            geo.append(("zoom", f"1+0.08*{k}*pow(1-(2*(it-{t0:.3f})-floor(2*(it-{t0:.3f}))),3)", t0, t1))
        elif ty == "glitch":
            s = max(1, round(16 * k * W / 1080))
            dxe = "0"
            for g0, g1, dx in reversed(glitch_slots(e)):
                g0, g1 = g0 - a, g1 - a
                col.append(f"rgbashift=rh={-s}:bh={s}:enable='between(t,{g0:.3f},{g1:.3f})'")
                dxe = f"if(between(t,{g0:.3f},{g1:.3f}),{dx:.4f},{dxe})"
            geo.append(("crop", 1.04, dxe, "0", t0, t1))
    return col, geo


def effect_graph(effects, W, H, a, L, src, fps=30):
    """The effects as filter-graph text from label `src`; returns (text, output label) or (None, src) when there are none.
    A move (shake, zoom, glitch) works on a copy of the frames of its own stretch only, laid back over the video."""
    col, geo = effect_chain(effects, W, H, a, L, fps)
    if not col and not geo:
        return None, src
    parts, lab = [], src
    if col:
        parts.append(f"[{lab}]" + ",".join(col) + "[efc]")
        lab = "efc"
    for j, g in enumerate(geo):
        t0, t1 = max(0.0, g[-2]), min(L, g[-1])
        cut = f"trim=start={t0:.3f}:end={t1:.3f}"
        if g[0] == "crop":
            sc = g[1]
            SW, SH = int(round(W * sc / 2)) * 2, int(round(H * sc / 2)) * 2
            mv = f"{cut},scale={SW}:{SH},crop={W}:{H}:x='(iw-ow)/2+({g[2]})*{W}':y='(ih-oh)/2+({g[3]})*{H}'"
        else:
            mv = f"{cut},zoompan=z='{g[1]}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s={W}x{H}:fps={fps},setpts=PTS-STARTPTS+{t0:.3f}/TB"
        parts.append(f"[{lab}]split[efa{j}][efb{j}];[efb{j}]{mv}[efm{j}];[efa{j}][efm{j}]overlay=0:0:eof_action=pass:repeatlast=0[efg{j}]")
        lab = f"efg{j}"
    return ";".join(parts), lab
