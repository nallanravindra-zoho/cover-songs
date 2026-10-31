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
    if spec["kind"] in ("opening", "ending"):
        return out if out.exists() and out.with_suffix(".json").exists() else render_card(sh, spec, work, out)
    if not out.exists():
        tmp = out.with_name("tmp_" + out.name)
        sh.png(html(sh, dict(spec, work=str(work))), tmp, transparent=spec["kind"] == "logo")
        tmp.replace(out)
    return out


def path(spec, work):
    """Where the picture for this spec is kept: her name is a transparent PNG, the rest are JPEGs."""
    return Path(work) / "still" / f"{spec['kind']}_{key(spec)}.{'png' if spec['kind'] == 'logo' else 'jpg'}"


def render_card(sh, spec, work, out):
    """A card: its background, and each text piece as its own transparent picture, laid on the background at the piece's place
    (where the card always had it, or where it was dragged in the preview: spec["els_pos"]). The pieces' pictures and places are
    written next to the card (<card>.json) so the preview can show them and let them be dragged."""
    from PIL import Image
    kind, d = spec["kind"], Path(work) / "still"
    base = dict(spec, els_pos=None)                     # the pieces do not depend on where they are put
    pk = key(base)
    sh.ensure_fonts([v.get("font") for v in (spec.get("els_style") or {}).values()])
    bgh, pieces = R.card_parts(kind, spec["look"], spec["credits"], spec["language"], R.data_uri(spec["bg"]) if spec.get("bg") else "",
                               spec.get("title", ""), sh, spec.get("k", 1.0), spec.get("blur", 0), spec.get("photo_h"), spec.get("els_style"))
    bgf = d / f"{kind}_{pk}_bg.jpg"
    if not bgf.exists():
        sh.png(bgh, bgf, transparent=False)
    meta = {"bg": bgf.name, "els": []}
    for pc in pieces:
        f = d / f"{kind}_{pk}_{pc['id']}.png"
        mf = f.with_suffix(".json")
        if f.exists() and mf.exists():
            m = json.loads(mf.read_text())
        else:
            r = sh.piece_png(pc["html"], pc["size"], f)
            if not r:
                continue
            m = {"w": r[0], "h": r[1], "cx": round(r[2], 5), "cy": round(r[3], 5)}
            mf.write_text(json.dumps(m))
        meta["els"].append(dict(m, id=pc["id"], file=f.name))
    img = Image.open(bgf).convert("RGBA")
    W, H = img.size
    pos = spec.get("els_pos") or {}
    for e in meta["els"]:
        x, y = (pos.get(e["id"]) or {}).get("x", e["cx"]), (pos.get(e["id"]) or {}).get("y", e["cy"])
        pc = Image.open(d / e["file"]).convert("RGBA")
        img.alpha_composite(pc, (round(x * W - e["w"] / 2), round(y * H - e["h"] / 2)))
    meta["size"] = [W, H]
    tmp = out.with_name("tmp_" + out.name)
    img.convert("RGB").save(tmp, quality=95)
    out.with_suffix(".json").write_text(json.dumps(meta))
    tmp.replace(out)
    return out
