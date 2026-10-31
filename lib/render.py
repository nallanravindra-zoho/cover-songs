"""Draw the lyric screens, logo and interlude pictures and compose them over a video with ffmpeg.

screens: [{"start", "end", "lines": [..]}]   interludes: [{"start", "end", "image": path}]
"""
import hashlib, json, os, shutil, subprocess, sys, tempfile
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import settings as cfg
import trans
import fx

GF = "https://fonts.googleapis.com/css2?family={}&display=swap"


def fam(name):
    return name.replace(" ", "+") + ":wght@400;500;600;700"


def glow(a, b):
    return f"0 0 8px {a},-4px 0 16px {a},4px 0 16px {b},0 0 30px {b}"


def page(look, fonts, cw=1080, ch=1920):
    links = "".join(f'<link rel="stylesheet" href="{GF.format(fam(f))}">' for f in fonts)
    return f"<!doctype html><html><head><meta charset=utf-8>{links}<style>html,body{{margin:0;background:transparent}}#c{{width:{cw}px;height:{ch}px;position:relative;overflow:hidden}}</style></head><body><div id=c></div></body></html>"


def launch(pw):
    try:
        return pw.chromium.launch(channel="chrome", headless=True)
    except Exception:
        return pw.chromium.launch(headless=True)


class Shots:
    """One headless Chrome page that turns HTML snippets into transparent PNGs."""

    def __init__(self, look, w=720, canvas=(1080, 1920), browser=None, extra_fonts=()):
        """browser: an already running Chrome to open the page in (the settings page keeps one); otherwise one is started."""
        self.own = browser is None
        if self.own:
            from playwright.sync_api import sync_playwright
            self.pw = sync_playwright().start()
            browser = launch(self.pw)
        self.b = browser
        self.cw, self.ch = canvas
        self.w, self.h = w, round(w * self.ch / self.cw)
        self.pg = self.b.new_page(viewport={"width": self.cw, "height": self.ch}, device_scale_factor=w / self.cw)
        self.pg.set_content(page(look, sorted({look["lyrics_font"], look["logo_font"], look["credits_font"], look["end_font"], *extra_fonts}), self.cw, self.ch))
        self.pg.add_script_tag(path=str(Path(__file__).resolve().parent / "anim.js"))
        self.pg.wait_for_timeout(2500)

    def widths(self, texts, font, weight, size):
        """Pixel width of each text on the 1080-wide canvas, measured in the browser with the real font."""
        return self.pg.evaluate("""async ([t, f, w, s]) => {
            await document.fonts.load(`${w} ${s}px '${f}'`, t.join(' '));
            const c = document.createElement('canvas').getContext('2d'); c.font = `${w} ${s}px '${f}'`;
            return t.map(x => c.measureText(x).width); }""", [texts, font, weight, size])

    def anim_screen(self, lines, size, look, effect, din, dout, out_mode, fps, base, canvas_w):
        """Frames of an animated lyric screen: the way in (din s), the finished screen (hold.png) and the way out (dout s).
        Cached by content, so unchanged screens are not drawn again. Returns {"dir", "nin", "nout", "hold"}."""
        L = look
        style = {"font": f"'{L['lyrics_font']}'", "weight": L["lyrics_weight"], "size": size, "left": L["lyrics_fill_left"], "mid": L["lyrics_fill_mid"],
                 "right": L["lyrics_fill_right"], "outline": L["lyrics_outline"], "ow": L["lyrics_outline_w"], "glow": L["lyrics_glow"], "lh": 1.35}
        nin, nout = max(1, round(din * fps)), (0 if out_mode == "cut" else max(1, round(dout * fps)))
        key = hashlib.md5(json.dumps([lines, style, effect, nin, nout, out_mode, L["lyrics_top"], L.get("lyrics_x") or 0, self.cw, self.ch, self.w], ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
        d = Path(base) / key
        res = {"dir": str(d), "nin": nin, "nout": nout, "hold": str(d / "hold.png")}
        if (d / "done").exists():
            return res
        d.mkdir(parents=True, exist_ok=True)
        unit = self.pg.evaluate("n => (Anim.FX[n] || {}).unit || 'block'", effect)
        self.pg.evaluate("""async ([lines, st, unit, top, x]) => {
            await document.fonts.load(`${st.weight} 40px ${st.font}`, lines.join(' '));
            const c = document.getElementById('c');
            c.innerHTML = '<div class="blk" style="position:absolute;left:' + (4 + x) + '%;right:' + (4 - x) + '%;top:' + top + '%">' + Anim.html(lines, st, unit) + '</div>';
            Anim.prepare(c); }""", [lines, style, unit, L["lyrics_top"] * 100, float(L.get("lyrics_x") or 0) * 100])
        self.pg.wait_for_timeout(150)
        ctx = {"W": self.cw, "H": self.ch}
        loc = self.pg.locator("#c")

        def shot(name, eff, p, path):
            self.pg.evaluate("([n, p, ctx]) => Anim.apply(document.getElementById('c'), n, p, ctx)", [eff, p, ctx])
            loc.screenshot(path=str(path), omit_background=True)
        for i in range(nin):
            shot("in", effect, (i + 1) / nin, d / f"in_{i:03d}.png")
        shutil.copy(d / f"in_{nin - 1:03d}.png", d / "hold.png")
        for i in range(nout):
            shot("out", effect if out_mode == "reverse" else "fade", 1 - (i + 1) / nout, d / f"out_{i:03d}.png")
        (d / "done").write_text("ok")
        return res

    def png(self, html, out, transparent=True):
        self.pg.evaluate("h => { document.getElementById('c').innerHTML = h; }", html)
        self.pg.evaluate("() => document.fonts.ready")
        self.pg.wait_for_timeout(250)
        self.pg.locator("#c").screenshot(path=str(out), omit_background=transparent)
        return out

    def close(self):
        if self.own:
            self.b.close()
            self.pw.stop()
        else:
            self.pg.close()


def _anim_ids():
    import re as _re
    return set(_re.findall(r"add\('([a-z_]+)'", (Path(__file__).resolve().parent / "anim.js").read_text(encoding="utf-8")))


ANIM_FX = _anim_ids() | {"none"}


def gtext(lines, font, weight, size, left, right, outline, ow, glow, mid=None, lh=1.35):
    """Each line: dark outline + soft glow underneath, a left-to-right gradient fill on top (pink > pale > cyan in her videos)."""
    fill = f"linear-gradient(90deg,{left},{mid + ',' if mid else ''}{right})"
    out = []
    for l in lines:
        t = escape(l)
        out.append(f"<div style=\"display:table;margin:0 auto;position:relative;white-space:nowrap;font-family:'{font}';font-weight:{weight};font-size:{size}px;line-height:{lh}\">"
                   f"<div style=\"padding:0 {size * .12}px;color:{outline};-webkit-text-stroke:{ow * size}px {outline};text-shadow:0 0 {size * .28}px {glow},0 0 {size * .1}px {glow}\">{t}</div>"
                   f"<div style=\"padding:0 {size * .12}px;position:absolute;left:0;top:0;color:transparent;background:{fill};-webkit-background-clip:text;background-clip:text\">{t}</div></div>")
    return "".join(out)


def fit_lines(sh, lines, font, weight, size, maxw=None, ow=0.1):
    """Make long text fit the frame: shrink a little first; if that is not enough, break the long lines at a space and shrink the rest.
    Returns (lines, size)."""
    maxw = maxw or sh.cw * 0.92

    def need(ls, sz):
        return [w + sz * (0.24 + ow) for w in sh.widths(ls, font, weight, sz)]
    ws = need(lines, size)
    if max(ws) <= maxw:
        return lines, size
    if size * maxw / max(ws) >= 0.78 * size:
        return lines, size * maxw / max(ws)
    new = []
    for l, w in zip(lines, ws):
        words = l.split()
        if w > maxw and len(words) > 1:
            cuts = [(abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))), i) for i in range(1, len(words))]
            i = min(cuts)[1]
            new += [" ".join(words[:i]), " ".join(words[i:])]
        else:
            new.append(l)
    ws = need(new, size)
    return new, max(0.55 * size, min(size, size * maxw / max(ws)))


def lyric_html(look, lines, sh=None, k=1.0):
    """Lyric screen. k scales the text (smaller panels use a smaller k); long lines are fitted to the canvas."""
    L = look
    size = L["lyrics_size"] * k
    if sh is not None:
        lines, size = fit_lines(sh, lines, L["lyrics_font"], L["lyrics_weight"], size, sh.cw * 0.9, L["lyrics_outline_w"])
    x = float(L.get("lyrics_x") or 0) * 100
    return (f"<div style=\"position:absolute;left:{4 + x}%;right:{4 - x}%;top:{L['lyrics_top'] * 100}%\">"
            + gtext(lines, L["lyrics_font"], L["lyrics_weight"], size, L["lyrics_fill_left"], L["lyrics_fill_right"],
                    L["lyrics_outline"], L["lyrics_outline_w"], L["lyrics_glow"], L["lyrics_fill_mid"]) + "</div>")


def logo_html(look, cw=1080, k=1.0):
    """Her handwritten name: yellow > orange > pink gradient letters, dark outline, violet glow (as in the reference video)."""
    L = look
    first, second = (L["logo_text"].split(" ", 1) + [""])[:2]
    size = L["logo_size"] * cw * 0.26 * k
    g = lambda t: gtext([t], L["logo_font"], 400, size, L["logo_fill_left"], L["logo_fill_right"], L["logo_outline"], L["logo_outline_w"], L["logo_glow"], L["logo_fill_mid"]).replace("margin:0 auto", "margin:0")
    return (f"<div style=\"position:absolute;left:{L['logo_x'] * 100}%;top:{L['logo_y'] * 100}%;transform:rotate(-3deg);transform-origin:0 0\">"
            + g(first) + "<div style=\"margin-left:%spx\">" % (size * 0.9) + g(second) + "</div></div>")


def placeholder_html(n, hue):
    return (f"<div style=\"position:absolute;inset:0;background:radial-gradient(circle at 50% 38%,hsl({hue},70%,55%) 0,hsl({hue},60%,28%) 38%,hsl({hue + 40},55%,10%) 100%);\">"
            f"<div style=\"position:absolute;left:50%;top:38%;width:30%;aspect-ratio:1;margin:-15% 0 0 -15%;border-radius:50%;border:10px solid rgba(255,255,255,.35)\"></div>"
            f"<div style=\"position:absolute;left:0;right:0;top:62%;text-align:center;color:#fff;font:700 4.4vw/1.3 'Noto Sans Devanagari',sans-serif;text-shadow:0 0 20px #000\">"
            f"interlude photo {n}<br><span style=\"font-size:.6em;font-weight:500\">(placeholder: your real photo goes here)</span></div></div>")


def panel_picture_html(bg, photo=None, n=1, hue=350, cw=1066, ch=1080):
    """YouTube layout: the interlude picture sits as a card in the middle of the blurred left panel."""
    h = f"<img src=\"{bg}\" style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur(40px);transform:scale(1.15)\">"
    box = "position:absolute;left:50%;top:50%;height:68%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.45);overflow:hidden"
    if photo:
        h += f"<div style=\"{box}\"><img src=\"{photo}\" style=\"width:100%;height:100%;object-fit:cover\"></div>"
    else:
        h += (f"<div style=\"{box};background:radial-gradient(circle at 50% 38%,hsl({hue},70%,55%) 0,hsl({hue},60%,28%) 45%,hsl({hue + 40},55%,10%) 100%)\">"
              f"<div style=\"position:absolute;left:0;right:0;top:66%;text-align:center;color:#fff;font:700 34px/1.3 'Noto Sans Devanagari',sans-serif\">interlude photo {n}<br>"
              f"<span style=\"font-size:22px;font-weight:500\">(placeholder)</span></div></div>")
    return h


def wrap_words(text, n):
    out, cur = [], ""
    for w in (text or "").split():
        if cur and len(cur + " " + w) > n:
            out.append(cur)
            cur = w
        else:
            cur = (cur + " " + w).strip()
    return out + ([cur] if cur else [])


def data_uri(path):
    import base64
    b = base64.b64encode(Path(path).read_bytes()).decode()
    return f"data:image/jpeg;base64,{b}" if str(path).lower().endswith((".jpg", ".jpeg")) else f"data:image/png;base64,{b}"


def opening_html(look, credits, language, bg, title_fallback="", sh=None, k=1.0, blur=0):
    """Opening card: title, her name, the original song's credits stacked (as in her Srikaramagu video)."""
    L, O = look, credits["opening"]
    lab = credits["labels"].get(language) or ["", "", "", ""]
    rows = [(lab[0], O.get("film")), (lab[1], O.get("lyricist")), (lab[2], O.get("music")), (lab[3], O.get("singers"))]
    lines = [x for a, b in rows if b for x in (a, b) if x]
    title = O.get("title_line") or title_fallback
    tl, ts = wrap_words(title, 14), L["title_size"] * k
    cl, cs = lines, L["credits_size"] * k
    if sh is not None:
        tl, ts = fit_lines(sh, tl, L["credits_font"], L["credits_weight"], ts, sh.cw * 0.9)
        cl, cs = fit_lines(sh, cl or [" "], L["credits_font"], L["credits_weight"], cs, sh.cw * 0.88)
        cs = min(cs, 0.50 * sh.ch / (max(1, len(cl)) * 1.35))
    cw = sh.cw if sh is not None else 1080
    filt = f"filter:blur({blur}px);transform:scale(1.15);" if blur else ""
    h = (f"<img src=\"{bg}\" style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover;{filt}\">"
         "<div style=\"position:absolute;inset:0;background:linear-gradient(rgba(0,0,0,.30),rgba(0,0,0,.10) 45%,rgba(0,0,0,.35))\"></div>"
         "<div style=\"position:absolute;left:5%;right:5%;top:5%\">"
         + gtext(tl, L["credits_font"], L["credits_weight"], ts, L["title_fill_left"], L["title_fill_right"], L["title_outline"], 0.1, L["title_glow"])
         + "</div>"
         "<div style=\"position:absolute;left:6%;right:6%;top:37%\">"
         + gtext([O.get("cover_by", "")], L["logo_font"], 400, 96 * k, L["logo_fill_left"], L["logo_fill_right"], L["logo_outline"], L["logo_outline_w"], L["logo_glow"], L["logo_fill_mid"])
         + "</div>"
         "<div style=\"position:absolute;left:6%;right:6%;top:47%\">"
         + gtext(cl, L["credits_font"], L["credits_weight"], cs, L["title_fill_left"], L["title_fill_right"], L["title_outline"], 0.1, L["title_glow"])
         + "</div>")
    return h


def end_html(look, credits, bg, sh=None, language="hindi", k=1.0, photo_h=None):
    """End card laid out like the opening card: her name big at the top, then the credits spread below it, over a blurred, tinted copy
    of the picture. photo_h (percent) is the height of the sharp picture at the bottom, or None for no sharp picture."""
    L, O = look, credits["opening"]
    name = (credits["ending"].get("name") or "").split(" ")
    extra = credits["ending"].get("extra_lines") or []
    lab = credits["labels"].get(language) or ["", "", "", ""]
    rows = [(lab[0], O.get("film")), (lab[1], O.get("lyricist")), (lab[2], O.get("music")), (lab[3], O.get("singers"))]
    song = [x for a, b in rows if b for x in (a, b) if x] if credits["ending"].get("show_song_credits", False) else []
    pairs = []
    for x in extra:                                    # "Singer: Name" -> two lines, as the opening card shows a label and then its value
        a, sep, b = x.partition(":")
        pairs += [a.strip() + ":", b.strip()] if sep and b.strip() and len(a) <= 30 else [x]
    lines = song + pairs
    esz, csz = L["end_size"] * k, L["credits_size"] * k
    ch = sh.ch if sh is not None else 1920
    if sh is not None and name:
        name, esz = fit_lines(sh, name, L["end_font"], 400, esz, sh.cw * 0.9, L["end_outline_w"])
    if lines:
        if sh is not None:
            lines, csz = fit_lines(sh, lines, L["credits_font"], L["credits_weight"], csz, sh.cw * 0.88)
        csz = min(csz, 0.40 * ch / (len(lines) * 1.7))               # all the lines must fit between the name and the picture
    top_credits = max(24.0, 4 + len(name) * esz * 1.2 / (ch / 100) + 4)
    photo_h = (28 if lines else 56) if photo_h is None else photo_h
    h = (f"<img src=\"{bg}\" style=\"position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:blur({L['end_blur'] * 1.5}px);transform:scale(1.15)\">"
         f"<div style=\"position:absolute;inset:0;background:{L['end_tint']};opacity:.5;mix-blend-mode:multiply\"></div>")
    if photo_h:
        h += (f"<img src=\"{bg}\" style=\"position:absolute;left:0;right:0;bottom:0;width:100%;height:{photo_h}%;object-fit:cover;object-position:top;"
              "-webkit-mask-image:linear-gradient(transparent,#000 22%)\">")
    h += ("<div style=\"position:absolute;left:3%;right:3%;top:4%;transform:rotate(-3deg)\">"
          + gtext(name, L["end_font"], 400, esz, L["end_fill"], L["end_fill"], L["end_outline"], L["end_outline_w"], L["end_glow"]) + "</div>")
    if lines:
        h += (f"<div style=\"position:absolute;left:6%;right:6%;top:{top_credits}%\">"
              + gtext(lines, L["credits_font"], L["credits_weight"], csz, L["title_fill_left"], L["title_fill_right"], L["title_outline"], 0.1, L["title_glow"], lh=1.7) + "</div>")
    return h


def video_size(src):
    """Width and height of a video as it is shown (a phone video's rotation applied)."""
    r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:stream_side_data=rotation",
                        "-of", "json", str(src)], capture_output=True, text=True)
    st = json.loads(r.stdout)["streams"][0]
    rot = next((abs(int(d.get("rotation", 0))) for d in st.get("side_data_list", []) if "rotation" in d), 0)
    return (st["height"], st["width"]) if rot in (90, 270) else (st["width"], st["height"])


def video_fx_chain(src, vfx, a, L, fps, k):
    """Her video with each clip's filter and motion (pipeline.video_fx): colour table, blur, motion (zoompan, one frame in, one out),
    vignette and grain, each switched on only during its clip. Returns (extra inputs, filter text ending in [vs], next input number)."""
    vw, vh = video_size(src)
    SW, SH = vfx["size"]
    k2 = max(SW / vw, SH / vh)
    SW2, SH2 = int(round(vw * k2 / 2)) * 2, int(round(vh * k2 / 2)) * 2
    ch = f"[0:v]fps={fps},scale={SW2}:{SH2},format=gbrp"
    clips = []
    for v in vfx["clips"]:
        t0, t1 = v["start"] - a, v["end"] - a
        if t1 <= 0 or t0 >= L:
            continue
        clips.append(dict(v, t0=t0, t1=t1))
        on = f":enable='between(t,{t0:.3f},{t1:.3f})'"
        if v.get("lut"):
            ch += f",lut3d=file='{v['lut']}':interp=tetrahedral{on}"
        if v.get("blur", 0) > 0:
            ch += f",gblur=sigma={v['blur']:.2f}{on}"
    if any((v.get("motion") or "still") != "still" for v in clips):
        z, x, y = fx.motion_exprs_timed(clips)
        ch += f",zoompan=z='{z}':x='{x}':y='{y}':d=1:s={SW2}x{SH2}:fps={fps}"
    ins, lab = [], "vx0"
    ch += f"[{lab}]"
    parts = [ch]
    for j, v in enumerate(c for c in clips if c.get("v", 0) > 0):
        ins += ["-loop", "1", "-framerate", str(fps), "-i", str(fx.vignette_png(SW2, SH2, v["v"], vfx["work"]))]
        parts.append(f"[{lab}][{k}:v]overlay=0:0:shortest=1:enable='between(t,{v['t0']:.3f},{v['t1']:.3f})'[vx{j + 1}]")
        lab, k = f"vx{j + 1}", k + 1
    tail = f"[{lab}]"
    for v in clips:
        if v.get("grain", 0) > 0:
            tail += f"noise=c0s={max(1, round(v['grain'] * 40))}:c0f=t+u:enable='between(t,{v['t0']:.3f},{v['t1']:.3f})',"
    parts.append(tail + "format=yuv420p[vs]")
    return ins, ";".join(parts), k


def compose(src, screens, logo_png, pics, out, size, layout=None, fps=30, dur_total=None, clip=None, fade=0.0, audio=None, vfx=None, effects=None):
    """Video + logo + lyric screens, with full-panel pictures (opening card, interlude photos, end card) that come in and go out with their
    own transition (ffmpeg xfade).

    size: (width, height) of the finished video.
    layout: None / {"mode": "portrait"}: one 9:16 frame.  {"mode": "side", "wl": left width, "focus": 0..1, "blur": n}: a blurred, text-carrying
            left panel and her video, un-blurred, filling the right panel. Pictures replace the left panel only.
    pics: [{"start","end","image","tin","din","tout","dout","zoom"}]; tin None = starts the video, tout None = ends it.
    clip: (from, to) seconds of the song to build; times are shifted so the cut begins at 0.
    vfx: filters and motion for clips of her video (pipeline.video_fx), or None.  effects: [{"type", "start", "end", "amount"}] on the song's times."""
    W, H = size
    side = bool(layout and layout.get("mode") == "side")
    wl = layout["wl"] if side else W
    wr = W - wl if side else 0
    D = dur_total
    a, b = clip if clip else (0.0, D)
    cut = a > 0 or b < D - 0.01
    L = b - a
    screens = [dict(s, start=s["start"] - a, end=min(L, s["end"] - a)) for s in screens if s["end"] > a and s["start"] < b]   # start may be < 0: it was already on screen when the cut begins
    pics = [dict(p, start=p["start"] - a, end=p["end"] - a) for p in pics if p["start"] >= a - 0.01 and p["end"] <= b + 0.01]
    ins = (["-ss", f"{a:.3f}", "-t", f"{L:.3f}"] if cut else []) + ["-i", str(src), "-loop", "1", "-framerate", str(fps), "-i", str(logo_png)]
    if side:
        fc = [f"[0:v]split[a][b];[a]scale={wl}:{H}:force_original_aspect_ratio=increase,crop={wl}:{H},boxblur={layout.get('blur', 36)}:6,fps={fps},format=yuv420p[v0]"]
    else:
        fc = [f"[0:v]split[a][b];[a]scale={wl}:{H}:force_original_aspect_ratio=increase,crop={wl}:{H},boxblur=24:4,eq=brightness=-0.25[bg];"
              f"[b]scale={wl}:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps={fps},format=yuv420p[v0]"]
    fc += ["[1:v]format=rgba[lg]", "[v0][lg]overlay=0:0:shortest=0[v1]"]
    last, k = "v1", 2
    if vfx:
        vins, vchain, k = video_fx_chain(src, vfx, a, L, fps, k)
        ins += vins
        fc[0] = vchain + ";" + fc[0].replace("[0:v]split", "[vs]split", 1)
    for s in screens:
        an = s.get("anim")
        if not an:
            if s["start"] < 0:
                s = dict(s, start=0.0, fin=0.02)
            d = max(0.3, s["end"] - s["start"])
            fi, fo = s.get("fin", 0.2), s.get("fout", 0.2)
            ins += ["-loop", "1", "-framerate", str(fps), "-t", f"{d + 0.2:.2f}", "-i", s["png"]]
            fc.append(f"[{k}:v]format=rgba,fade=t=in:st=0:d={fi}:alpha=1,fade=t=out:st={max(0, d - fo):.2f}:d={fo}:alpha=1,setpts=PTS+{s['start']:.2f}/TB[l{k}]")
            fc.append(f"[{last}][l{k}]overlay=0:0:eof_action=pass[o{k}]")
            last, k = f"o{k}", k + 1
            continue
        st, en, di, do = s["start"], s["end"], an["din"], an["dout"]
        parts = [("-framerate", f"{an['dir']}/in_%03d.png", st)] if st >= 0 else []     # already on screen at the cut: no way-in
        hs = max(0.0, st + di)
        parts.append(("hold", an["hold"], hs))
        if an["nout"]:
            parts.append(("-framerate", f"{an['dir']}/out_%03d.png", en - do))
        for kind, path, t0 in parts:
            if kind == "hold":
                ins += ["-loop", "1", "-framerate", str(fps), "-t", f"{max(0.05, (en - do) - hs) + 0.15:.2f}", "-i", path]
            else:
                ins += ["-framerate", str(fps), "-i", path]
            fc.append(f"[{k}:v]format=rgba,setpts=PTS+{t0:.3f}/TB[l{k}]")
            fc.append(f"[{last}][l{k}]overlay=0:0:eof_action=pass[o{k}]")
            last, k = f"o{k}", k + 1
    norm = f"fps={fps},format=yuv420p,setsar=1,settb=AVTB"
    pics = sorted(pics, key=lambda p: p["start"])
    pre = 3 if wl * H * 9 < 3e7 else 2
    if not pics:
        final = last
    else:
        blocks = []                                   # ("seg", a, b) cuts of the video, ("pic", i) pictures, in time order
        for i, p in enumerate(pics):
            sa = 0.0 if i == 0 else pics[i - 1]["end"] - (pics[i - 1]["dout"] if pics[i - 1]["tout"] else 0)
            sb = p["start"] + (p["din"] if p["tin"] else 0)
            if p["tin"]:
                blocks.append(("seg", sa, sb))
            blocks.append(("pic", i))
        if pics[-1]["tout"]:
            blocks.append(("seg", pics[-1]["end"] - pics[-1]["dout"], None))
        nseg = sum(1 for x in blocks if x[0] == "seg")
        n = 0
        if nseg:
            fc.append(f"[{last}]split={nseg}" + "".join(f"[m{i}]" for i in range(nseg)))
        for bi, blk in enumerate(blocks):
            if blk[0] == "seg":
                tr = f"trim=start={blk[1]:.3f}" + (f":end={blk[2]:.3f}" if blk[2] else "")
                fc.append(f"[m{n}]{tr},setpts=PTS-STARTPTS,{norm}[b{bi}]")
                n += 1
            elif pics[blk[1]].get("parts"):              # an interlude: one or more prepared pictures, each moving, with transitions between them
                p = pics[blk[1]]
                labs = []
                for j, q in enumerate(p["parts"]):
                    frames = int(round((q["e"] - q["s"]) * fps)) + 2
                    z, x, y = fx.zoompan_exprs(q["motion"], frames)
                    ins += ["-i", str(q["image"])]
                    chain = f"[{k}:v]zoompan=z='{z}':x='{x}':y='{y}':d={frames}:s={wl}x{H}:fps={fps}"
                    k += 1
                    if q.get("vig"):
                        ins += ["-loop", "1", "-framerate", str(fps), "-i", str(q["vig"])]
                        chain += f"[zp{bi}_{j}];[zp{bi}_{j}][{k}:v]overlay=0:0:shortest=1"
                        k += 1
                    if q.get("grain"):
                        chain += f",noise=c0s={max(1, round(q['grain'] * 40))}:c0f=t+u"
                    fc.append(chain + f",{norm}[pp{bi}_{j}]")
                    labs.append(f"pp{bi}_{j}")
                cur_p = labs[0]
                for j in range(1, len(labs)):
                    q = p["parts"][j]
                    tname, xtra = trans.xfade_arg(q["tin"])
                    nxt = f"[b{bi}]" if j == len(labs) - 1 else f"[px{bi}_{j}]"
                    fc.append(f"[{cur_p}][{labs[j]}]xfade=transition={tname}{xtra}:duration={q['din']}:offset={q['s']:.3f}{nxt}")
                    cur_p = nxt[1:-1]
                if len(labs) == 1:
                    fc.append(f"[{labs[0]}]null[b{bi}]")
            else:
                p = pics[blk[1]]
                ins += ["-i", str(p["image"])]
                frames = int((p["end"] - p["start"]) * fps) + 2
                zi = "min(zoom+0.0002,1.06)" if p.get("zoom") == "card" else "min(zoom+0.0006,1.2)"
                fc.append(f"[{k}:v]scale={wl * pre}:{H * pre}:force_original_aspect_ratio=increase:flags=lanczos,crop={wl * pre}:{H * pre},"
                          f"zoompan=z='{zi}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={wl}x{H}:fps={fps},{norm}[b{bi}]")
                k += 1
        cur = "b0"
        for bi in range(1, len(blocks)):
            A, B = blocks[bi - 1], blocks[bi]
            if A[0] == "seg":
                p = pics[B[1]]
                name, d, off = p["tin"], p["din"], p["start"]
            else:
                p = pics[A[1]]
                name, d, off = p["tout"], p["dout"], p["end"] - p["dout"]
            tname, xtra = trans.xfade_arg(name)
            fc.append(f"[{cur}][b{bi}]xfade=transition={tname}{xtra}:duration={d}:offset={off:.3f}[x{bi}]")
            cur = f"x{bi}"
        final = cur
    if side:                                          # her video, sharp, fills the right panel (top of the picture kept by `focus`)
        fc.append(f"[b]scale={wr}:{H}:force_original_aspect_ratio=increase,crop={wr}:{H}:(iw-ow)/2:(ih-oh)*{layout.get('focus', 0.3)},fps={fps},format=yuv420p,setsar=1,settb=AVTB[right]")
        fc.append(f"[{final}]setsar=1,settb=AVTB[leftp]")
        fc.append("[leftp][right]hstack=inputs=2[hs]")
        final = "hs"
    if effects:                                       # shake, flash, glitch ..: over the whole frame, text included (fx.effect_graph)
        eg, lab = fx.effect_graph(effects, W, H, a, L, final, fps)
        if eg:
            fc.append(eg)
            final = lab
    af = []
    if fade and cut or fade and L > 3 * fade:
        fc.append(f"[{final}]fade=t=in:st=0:d={fade},fade=t=out:st={max(0, L - fade):.2f}:d={fade}[vf]")
        final = "vf"
        af = ["-af", f"afade=t=in:st=0:d={fade},afade=t=out:st={max(0, L - fade):.2f}:d={fade}"]
    amap = "0:a"
    if audio:                                         # the mastered audio, already placed on the video's timeline, replaces the video's own sound
        amap = f"{ins.count('-i')}:a"
        ins += (["-ss", f"{a:.3f}", "-t", f"{L:.3f}"] if cut else []) + ["-i", str(audio)]
    cmd = ["ffmpeg", "-y", "-loglevel", "error"] + ins + ["-filter_complex", ";".join(fc), "-map", f"[{final}]", "-map", amap] + af + [
        "-c:v", "libx264", "-crf", "21", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-shortest", "-t", f"{L:.3f}"]
    r = subprocess.run(cmd + [str(out)], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-1800:])
    return out
