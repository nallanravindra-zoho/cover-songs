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
    """Times of the pictures inside one interlude (seconds from the interlude's start). Each picture gets an equal share;
    the transition into a picture is centred on the boundary. Returns [{..picture, "s", "e", "tin", "din"}]."""
    pics = it["pictures"]
    n = len(pics)
    share = total / n
    out = []
    for j, pc in enumerate(pics):
        d = 0.0
        if j:
            d = float(pc.get("trans_seconds") or between["seconds"])
            d = max(0.2, min(d, share * 0.5))
        out.append(dict(pc, motion=pc.get("motion") or default_motion, tin=(pc.get("trans") or between["name"]) if j else None, din=round(d, 3)))
    for j, o in enumerate(out):
        o["s"] = 0.0 if j == 0 else round(j * share - o["din"] / 2, 3)
        o["e"] = round(total, 3) if j == n - 1 else round((j + 1) * share + out[j + 1]["din"] / 2, 3)
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
