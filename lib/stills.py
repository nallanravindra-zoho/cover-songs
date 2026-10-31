"""Full-frame pictures drawn by Chrome: the opening card, the end card, her name, the default interlude picture and (YouTube
layout) the interlude panel. The video builder and the live preview both call render() with the same spec, so the preview shows the very
picture the video gets. Cached by content in songs/<song>/work/still/.
"""
import hashlib, json
from pathlib import Path

import render as R
import fx


def _stamp(p):
    p = Path(p) if p else None
    return [str(p), p.stat().st_size, p.stat().st_mtime] if p and p.exists() else None


def key(spec):
    s = dict(spec)
    for k in ("bg", "photo"):
        s[k + "_stamp"] = _stamp(spec.get(k))
    return hashlib.md5(json.dumps(s, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:16]


def html(sh, spec):
    kind = spec["kind"]
    bg = R.data_uri(spec["bg"]) if spec.get("bg") else ""
    if kind == "opening":
        return R.opening_html(spec["look"], spec["credits"], spec["language"], bg, spec.get("title", ""), sh, spec.get("k", 1.0), blur=spec.get("blur", 0))
    if kind == "ending":
        return R.end_html(spec["look"], spec["credits"], bg, sh, spec["language"], spec.get("k", 1.0), spec.get("photo_h"))
    if kind == "logo":
        return R.logo_html(spec["look"], spec["canvas"][0], 1.0)
    if kind == "placeholder":
        return R.placeholder_html(spec["n"], spec["hue"])
    if kind == "panel":
        photo = None
        if spec.get("photo") and Path(spec["photo"]).exists():
            photo = R.data_uri(fx.still(spec["photo"], (800, 800), spec.get("filter"), Path(spec["work"]) / "fx", 800 / 734))
        return R.panel_picture_html(bg, photo, spec["n"], spec["hue"], spec["canvas"][0], spec["canvas"][1])
    raise ValueError(f"unknown picture kind {kind}")


def render(sh, spec, work):
    """The picture for this spec at the Shots page's size (cached)."""
    (Path(work) / "still").mkdir(parents=True, exist_ok=True)
    out = path(spec, work)
    if not out.exists():
        tmp = out.with_name("tmp_" + out.name)
        sh.png(html(sh, dict(spec, work=str(work))), tmp, transparent=spec["kind"] == "logo")
        tmp.replace(out)
    return out


def path(spec, work):
    """Where the picture for this spec is kept: her name is a transparent PNG, the rest are JPEGs."""
    return Path(work) / "still" / f"{spec['kind']}_{key(spec)}.{'png' if spec['kind'] == 'logo' else 'jpg'}"
