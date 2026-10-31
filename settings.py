"""Cover Songs settings page.

    .venv/bin/python settings.py            opens http://127.0.0.1:8766 in your browser

Upload the files for a song, set lyrics and section timings, pick photos, transitions, fonts and credits, and run the
checks, all in a form instead of editing JSON. It only listens on your own computer (127.0.0.1).
"""
import json
import mimetypes
import re
import shutil
import subprocess
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
SONGS = HERE / "songs"
BRAND = HERE / "brand"
FONTS = HERE / "content" / "fonts"
PRESETS = HERE / "content" / "presets"
PREVIEWS = HERE / "ui" / "previews"
UI = HERE / "ui" / "index.html"
PORT = 8766
SAMPLE = Path("/Users/ravi/Downloads/Srikaramagu.mp4")       # the template video; only used for look previews
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv"}
AUDIO_EXT = {".wav", ".mp3", ".m4a", ".aac", ".flac", ".aiff", ".aif"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp"}
FONT_EXT = {".ttf", ".otf", ".woff", ".woff2"}
# which file kinds exist, which extensions each accepts, and where they are stored
KINDS = {
    "master": AUDIO_EXT, "vocal": AUDIO_EXT, "raw_video": VIDEO_EXT, "final_export": VIDEO_EXT,
    "logo": IMAGE_EXT, "photo": IMAGE_EXT,
}
# the 9:16 look measured from Srikaramagu.mp4 (see docs/SAMPLE_ANALYSIS.md); fonts are the closest free match
DEFAULT_LOOK = {
    "lyrics_font": "Noto Sans Telugu", "lyrics_weight": 600, "lyrics_size": 58, "lyrics_lines": 2, "lyrics_top": 0.17, "lyrics_x": 0.0,
    "lyrics_fill_left": "#ff4f8b", "lyrics_fill_mid": "#f2dcec", "lyrics_fill_right": "#7fe6e0",
    "lyrics_outline": "#0d0620", "lyrics_outline_w": 0.10, "lyrics_glow": "#6a3bd9",
    "credits_font": "Noto Sans Telugu", "credits_weight": 600, "credits_size": 56,
    "credits_fill_left": "#ff4f8b", "credits_fill_right": "#ffb3c1", "credits_outline": "#0d0620", "credits_glow": "#6a3bd9",
    "title_size": 104, "title_fill_left": "#ff4f8b", "title_fill_right": "#ffb3c1", "title_outline": "#0d0620", "title_glow": "#6a3bd9",
    "logo_mode": "text", "logo_font": "Kaushan Script", "logo_text": "Soujanya Madabhushi",
    "logo_fill_left": "#ffe45e", "logo_fill_mid": "#ffb27a", "logo_fill_right": "#ff7a95",
    "logo_outline": "#1a0a14", "logo_outline_w": 0.12, "logo_glow": "#8a5cf0", "logo_size": 0.17, "logo_x": 0.15, "logo_y": 0.04,
    "end_font": "Kaushan Script", "end_size": 150, "end_fill": "#1f9a4a", "end_outline": "#05140a", "end_outline_w": 0.13, "end_glow": "#ffc46b",
    "end_tint": "#1f8f4a", "end_blur": 24,
}
DEFAULT_TRANSITIONS = {
    "opening_to_video": {"name": "pixelize", "seconds": 0.8},
    "section_to_section": {"name": "dissolve", "seconds": 0.6},
    "video_to_end": {"name": "fade", "seconds": 1.0},
    "interlude_in": {"name": "pixelize", "seconds": 0.8},
    "interlude_out": {"name": "fadeblack", "seconds": 0.8},
    "picture_to_picture": {"name": "fade", "seconds": 0.8},
}
# the finished videos: each has its own settings. layout "portrait" = one 9:16 frame; "side" = blurred text panel on the left, her video on the right
DEFAULT_OUTPUTS = {
    "instagram": {"label": "Instagram / Facebook (9:16)", "enabled": True, "layout": "portrait", "width": 1080, "preview_width": 540,
                  "opening": True, "ending": True, "interludes": True, "text_scale": 1.0, "start": None, "length": None, "fade": 0.0, "text_anim": {}, "look": {}},
    "youtube": {"label": "YouTube (side by side, 16:9)", "enabled": True, "layout": "side", "width": 1920, "preview_width": 1280, "split": 0.555,
                "video_focus": 0.3, "blur": 36, "opening": True, "ending": True, "interludes": True, "text_scale": 0.8, "card_scale": 0.5,
                "start": None, "length": None, "fade": 0.0, "text_anim": {},
                "look": {"lyrics_top": 0.36, "logo_x": 0.04, "logo_y": 0.80, "logo_size": 0.24}},
    "reel": {"label": "1-minute reel (stories, WhatsApp, 9:16)", "enabled": True, "layout": "portrait", "width": 1080, "preview_width": 540,
             "opening": False, "ending": False, "interludes": True, "text_scale": 1.0, "start": None, "length": 60, "snap_to_line": True, "fade": 0.5, "text_anim": {}, "look": {}},
}
DEFAULT_CONFIG = {
    "title": "", "language": "telugu",
    "files": {"master": None, "vocal": None, "raw_video": None, "final_export": None, "logo": None},
    "sync": {"method": "auto", "raw_video_offset": None, "use_master_audio": True},
    "sections": [], "lyric_times": [], "lyric_ends": [],
    "text_anim": {"in": "fade", "out": "reverse", "in_seconds": 0.5, "out_seconds": 0.3}, "auto_place": True,
    "outputs": DEFAULT_OUTPUTS, "photo_use": {}, "photo_motion": "zoom_in", "interlude_min_seconds": 8, "interludes": [],
    "look": DEFAULT_LOOK, "transitions": DEFAULT_TRANSITIONS,
    "opening": {"photo": None, "seconds": 6, "enabled": True}, "ending": {"photo": None, "seconds": 6, "enabled": True},
    "export": {"width": 1080, "height": 1920, "fps": 30},
}
DEFAULT_CREDITS = {
    "opening": {"title_line": "", "film": "", "lyricist": "", "music": "", "singers": "", "cover_by": "Soujanya Madabhushi"},
    "labels": {"telugu": ["సినిమా", "గీత రచయిత", "సంగీతం", "గానం"], "hindi": ["फ़िल्म", "गीतकार", "संगीत", "गायक"]},
    "ending": {"name": "Soujanya Madabhushi", "extra_lines": [], "show_song_credits": False},
    "caption": {"text": "", "hashtags": "#coversong"},
}
LOCK = threading.Lock()
PROBE = {}
RUN = {"proc": None, "lines": [], "mode": None, "song": None, "code": None, "outputs": None}


def start_run(name, mode, a=None, b=None, outputs=None, cached=False):
    with LOCK:
        if RUN["proc"] and RUN["proc"].poll() is None:
            raise ValueError("another build is still running")
        song_dir(name)
        cmd = [sys.executable, str(HERE / "tools" / "build_song.py"), str(SONGS / name), "--mode", mode]
        if a is not None and b is not None:
            cmd += ["--from", str(a), "--to", str(b)]
        if cached:
            cmd += ["--cached"]
        if outputs:
            if not all(re.fullmatch(r"[a-z]{3,12}", o) and o in DEFAULT_OUTPUTS for o in outputs):
                raise ValueError("unknown output")
            cmd += ["--output", ",".join(outputs)]
        RUN.update(proc=subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1, cwd=str(HERE)), lines=[], mode=mode, song=name, code=None, outputs=outputs)

    def pump(p):
        for line in p.stdout:
            line = line.rstrip()
            if line and "Warning" not in line and "warn" not in line.lower():
                RUN["lines"].append(line)
        RUN["code"] = p.wait()
    threading.Thread(target=pump, args=(RUN["proc"],), daemon=True).start()


def song_dir(name):
    if not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", name or "") or name.startswith("_"):
        raise ValueError("song names can only use letters, numbers, - and _")
    return SONGS / name


def safe_file(name):
    name = Path(name or "").name
    name = re.sub(r"[^\w.\- ]", "_", name).strip(" .")
    if not name:
        raise ValueError("bad file name")
    return name


def merge(base, over):
    out = json.loads(json.dumps(base))
    for k, v in (over or {}).items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def list_songs():
    return sorted(p.name for p in SONGS.iterdir() if p.is_dir() and not p.name.startswith("_") and (p / "song.json").exists())


def read_json(path, default):
    try:
        return merge(default, json.loads(path.read_text(encoding="utf-8")))
    except Exception:
        return json.loads(json.dumps(default))


def read_song(name):
    d = song_dir(name)
    cfg = read_json(d / "song.json", DEFAULT_CONFIG)
    for k in ("interlude_in", "interlude_out"):          # older files kept a list of styles; an interlude takes exactly one
        t = cfg["transitions"].get(k, {})
        if "names" in t:
            t["name"] = (t.pop("names") or [DEFAULT_TRANSITIONS[k]["name"]])[0]
    cfg.pop("interlude_tr", None)
    for k in [k for k in cfg if k.startswith("_")]:
        del cfg[k]
    cred = read_json(d / "credits.json", DEFAULT_CREDITS)
    for k in [k for k in cred if k.startswith("_")]:
        del cred[k]
    lyr = (d / "lyrics.txt").read_text(encoding="utf-8") if (d / "lyrics.txt").exists() else ""
    photos = sorted(f.name for f in (d / "photos").glob("*") if f.suffix.lower() in IMAGE_EXT) if (d / "photos").exists() else []
    return {"name": name, "config": cfg, "credits": cred, "lyrics": lyr, "photos": photos, "files": file_info(name, cfg)}


def kind_path(name, kind, fname):
    return BRAND / fname if kind == "logo" else song_dir(name) / fname


def file_info(name, cfg):
    info = {}
    for kind, fname in cfg["files"].items():
        p = kind_path(name, kind, fname) if fname else None
        info[kind] = {"file": fname, "exists": bool(p and p.exists()), "size": p.stat().st_size if p and p.exists() else 0,
                      "seconds": duration(p) if p and p.exists() and kind != "logo" else None}
    return info


def mmss(t):
    r = round(float(t) * 10) / 10
    m, sec = int(r // 60), r - int(r // 60) * 60
    return f"{m}:{int(sec):02d}" + (f".{round((sec - int(sec)) * 10)}" if abs(sec - int(sec)) > 0.04 else "")


def duration(p):
    key = (str(p), p.stat().st_mtime)
    if key not in PROBE:
        r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)], capture_output=True, text=True)
        try:
            PROBE[key] = round(float(r.stdout.strip()), 2)
        except ValueError:
            PROBE[key] = None
    return PROBE[key]


def save_song(name, data):
    d = song_dir(name)
    if not d.exists():
        raise ValueError("no such song")
    with LOCK:
        if "config" in data:
            (d / "song.json").write_text(json.dumps(data["config"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if "credits" in data:
            (d / "credits.json").write_text(json.dumps(data["credits"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if "lyrics" in data:
            (d / "lyrics.txt").write_text(data["lyrics"], encoding="utf-8")


def new_song(name):
    d = song_dir(name)
    if d.exists():
        raise ValueError("that song already exists")
    shutil.copytree(SONGS / "_template", d)
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    (d / "song.json").write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (d / "photos").mkdir(exist_ok=True)
    (d / "lyrics.txt").write_text("", encoding="utf-8")


# ---------- lyrics ----------
sys.path.insert(0, str(HERE / "lib"))
import lyrics as ly  # noqa: E402


def screens(text, per=2, name=None):
    breaks = set()
    if name:                                           # screens whose lines are sung far apart were split when the lyrics were placed
        f = song_dir(name) / "work" / "auto_times.json"
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            import hashlib
            if d.get("lyr") == hashlib.md5((str(per) + text.strip()).encode()).hexdigest()[:12]:
                breaks = set(d.get("breaks", []))
        except Exception:
            pass
    return [{"section": x["section"], "lines": x["lines"]} for x in ly.screens(text, per, breaks=breaks)[0]]


# ---------- checks ----------
def check_song(name):
    s = read_song(name)
    cfg, cred, res = s["config"], s["credits"], []

    def add(level, text):
        res.append({"level": level, "text": text})

    f = s["files"]
    for kind, label, need in (("master", "Mastered audio", True), ("vocal", "Vocal recording", True), ("raw_video", "Raw video", True),
                              ("final_export", "Her finished export (for comparing)", False), ("logo", "Logo", False)):
        i = f[kind]
        if i["exists"]:
            add("good", f"{label}: {i['file']}" + (f" ({mmss(i['seconds'])} long)" if i["seconds"] else ""))
        else:
            add("bad" if need else "warn", f"{label}: not uploaded yet")
    dm, dv = f["master"]["seconds"], f["vocal"]["seconds"]
    if dm and dv and abs(dm - dv) > 0.5:
        add("warn", f"Master ({mmss(dm)}) and vocal ({mmss(dv)}) differ in length by {mmss(abs(dm - dv))}. They should start together; check the vocal was exported from the same start.")
    if cfg["sync"]["method"] == "manual" and cfg["sync"]["raw_video_offset"] is None:
        add("bad", "Sync is set to manual but no offset was entered.")
    sc = screens(s["lyrics"], int(cfg["look"]["lyrics_lines"]))
    if not sc:
        add("bad", "No lyrics yet.")
    else:
        add("good", f"Lyrics: {len(sc)} screens of {cfg['look']['lyrics_lines']} lines")
        lt = cfg["lyric_times"]
        if not lt:
            add("warn", "Lyric timings not set yet: use the tap-along in step 4.")
        else:
            ts = [x for x in lt if x is not None]
            if len(lt) != len(sc):
                add("bad", f"{len(lt)} lyric times but {len(sc)} screens. Re-tap or edit the table (lyrics changed after timing).")
            elif len(ts) < len(lt):
                add("warn", f"{len(lt) - len(ts)} screens have no time yet.")
            elif any(b <= a for a, b in zip(ts, ts[1:])):
                add("bad", "Lyric times are not in increasing order.")
            else:
                add("good", "All lyric screens have times, in order.")
            if ts and dm and ts[-1] > dm:
                add("bad", f"The last lyric time {mmss(ts[-1])} is after the end of the audio ({mmss(dm)}).")
    secs = cfg["sections"]
    if secs:
        bad = [x for x in secs if x.get("end") is not None and x.get("start") is not None and x["end"] <= x["start"]]
        add("bad" if bad else "good", f"Sections: {len(secs)} ({sum(1 for x in secs if x.get('kind') == 'interlude')} interludes)" + (": some end before they start." if bad else ""))
    else:
        add("warn", "No sections entered; they will be found from the vocal when the build step exists.")
    inter = sum(1 for x in secs if x.get("kind") == "interlude")
    used = {}
    for ph, use in cfg["photo_use"].items():
        used.setdefault(use, []).append(ph)
    for i in range(1, inter + 1):
        if not used.get(f"interlude:{i}"):
            add("warn", f"Interlude {i} has no photo.")
    if not cfg["opening"]["photo"]:
        add("warn", "Opening card has no photo.")
    if not cred["opening"]["title_line"] and not cfg["title"]:
        add("warn", "No title line for the opening card.")
    if not any(cred["opening"][k] for k in ("film", "lyricist", "music", "singers")):
        add("warn", "No original song credits filled in.")
    return res


# ---------- stills and transition previews ----------
STILL_LOCK = threading.Lock()


def make_still(src, ss, out, vf):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(ss), "-i", str(src), "-frames:v", "1", "-vf", vf, str(out)])
    return out.exists() and out.stat().st_size > 0


def backdrop(song=None):
    """A 9:16 still for the look preview: a frame of the song's raw video if there is one, else the template video with its baked-in
    lyrics blurred away. Returns the URL path."""
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    if song:
        cfg = read_song(song)["config"]
        rv = cfg["files"].get("raw_video")
        p = song_dir(song) / rv if rv else None
        if p and p.exists():
            out = PREVIEWS / f"bg_{song}.jpg"
            with STILL_LOCK:
                if not out.exists() or out.stat().st_mtime < p.stat().st_mtime:
                    make_still(p, (duration(p) or 20) * 0.3, out, "scale=540:960:force_original_aspect_ratio=increase,crop=540:960")
            return f"/previews/{out.name}"
    out = PREVIEWS / "bg_sample.jpg"
    with STILL_LOCK:
        if not out.exists() and SAMPLE.exists():
            make_still(SAMPLE, 60, out, "scale=540:960,split[a][b];[a]crop=540:230:0:60,boxblur=22:3[t];[b][t]overlay=0:60")
    return "/previews/bg_sample.jpg" if out.exists() else None


def two_stills():
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    a, b = PREVIEWS / "A.png", PREVIEWS / "B.png"
    with STILL_LOCK:
        if SAMPLE.exists():
            if not a.exists():
                make_still(SAMPLE, 3, a, "scale=270:480")
            if not b.exists():
                make_still(SAMPLE, 10, b, "scale=270:480")
        from PIL import Image, ImageDraw
        for p, col, txt in ((a, (70, 20, 60), "OPENING"), (b, (20, 40, 90), "NEXT PART")):
            if not p.exists():
                im = Image.new("RGB", (270, 480), col)
                ImageDraw.Draw(im).text((100, 230), txt, fill=(255, 255, 255))
                im.save(p)
    return a, b


TRANS_LOCK = threading.Lock()


def transition_preview(name):
    if not re.fullmatch(r"[a-z]{3,20}", name or ""):
        raise ValueError("bad transition name")
    out = PREVIEWS / f"t_{name}.mp4"
    with TRANS_LOCK:
        if not out.exists():
            a, b = two_stills()
            import trans
            tn, tx = trans.xfade_arg(name)
            f = f"[0:v]fps=24,format=yuv420p,setsar=1[a];[1:v]fps=24,format=yuv420p,setsar=1[b];[a][b]xfade=transition={tn}{tx}:duration=0.9:offset=0.6,format=yuv420p[v]"
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-loop", "1", "-t", "2.4", "-i", str(a), "-loop", "1", "-t", "2.4", "-i", str(b),
                                "-filter_complex", f, "-map", "[v]", "-t", "2.4", "-c:v", "libx264", "-crf", "30", "-preset", "veryfast", "-movflags", "+faststart", str(out)],
                               capture_output=True, text=True)
            if r.returncode != 0:
                raise RuntimeError(r.stderr[-200:])
    return f"/previews/t_{name}.mp4"


# ---------- presets and fonts ----------
def list_presets():
    PRESETS.mkdir(parents=True, exist_ok=True)
    if not (PRESETS / "house.json").exists():
        (PRESETS / "house.json").write_text(json.dumps({"look": DEFAULT_LOOK, "transitions": DEFAULT_TRANSITIONS}, indent=2) + "\n", encoding="utf-8")
    return {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted(PRESETS.glob("*.json"))}


def save_preset(name, data):
    if not re.fullmatch(r"[A-Za-z0-9_\- ]{1,40}", name or ""):
        raise ValueError("preset names can only use letters, numbers, spaces, - and _")
    PRESETS.mkdir(parents=True, exist_ok=True)
    (PRESETS / f"{name}.json").write_text(json.dumps({"look": data["look"], "transitions": data["transitions"]}, indent=2) + "\n", encoding="utf-8")


PALETTES = HERE / "content" / "palettes.json"


def list_palettes():
    """Colour sets for the lyrics that Ravi liked (saved from the preview's colour ideas); offered again in every song."""
    try:
        return json.loads(PALETTES.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_palette(data):
    """Add one ({"name", "c": [left, mid, right, outline, glow]}) or, with "remove", take one out (by its colours)."""
    pals = list_palettes()
    c = data.get("c")
    if not (isinstance(c, list) and len(c) == 5 and all(isinstance(x, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", x) for x in c)):
        raise ValueError("a colour set is five colours like #ff4f8b")
    pals = [x for x in pals if x.get("c") != c]
    if not data.get("remove"):
        pals.insert(0, {"name": str(data.get("name") or "My colours")[:40], "c": c})
    PALETTES.parent.mkdir(parents=True, exist_ok=True)
    PALETTES.write_text(json.dumps(pals[:60], indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return pals[:60]


def list_fonts():
    return sorted(f.name for f in FONTS.glob("*") if f.suffix.lower() in FONT_EXT) if FONTS.exists() else []



# ---------- snapshots of the video, to use as interlude photos ----------
def video_of(name):
    cfg = read_song(name)["config"]
    for k in ("raw_video", "final_export"):
        f = cfg["files"].get(k)
        if f and (song_dir(name) / f).exists():
            return song_dir(name) / f
    raise ValueError("upload the video first (Files step)")


def sharpness(png_bytes):
    import io
    import numpy as np
    from PIL import Image
    g = np.asarray(Image.open(io.BytesIO(png_bytes)).convert("L"), float)
    lap = g[1:-1, 1:-1] * 4 - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def make_snapshots(name, count=12, at=None):
    """PNG frames of the video in songs/<name>/snapshots. Evenly spaced through the song (skipping the first and last 8 s, where the cards
    go); each is the sharpest of five frames around its target so it is not a blurred moment. `at` adds frames at exact times instead."""
    v = video_of(name)
    dur = duration(v) or 0
    out = song_dir(name) / "snapshots"
    out.mkdir(exist_ok=True)

    def grab(t, path=None, small=False):
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(v), "-frames:v", "1"]
        if small:
            cmd += ["-vf", "scale=360:-2", "-f", "image2pipe", "-vcodec", "png", "-"]
            return subprocess.run(cmd, capture_output=True).stdout
        subprocess.run(cmd + [str(path)])
        return path
    if at:
        times = [float(t) for t in at]
    else:
        for old in out.glob("snap_*.png"):
            old.unlink()
        lo, hi = min(8.0, dur * 0.1), max(dur - 8.0, dur * 0.9)
        times = [lo + (hi - lo) * (i + 0.5) / count for i in range(count)]
        best = []
        for t in times:                                   # the sharpest frame near each target
            cands = [(sharpness(b), t + d) for d in (-1.0, -0.5, 0.0, 0.5, 1.0) if (b := grab(t + d, small=True))]
            best.append(max(cands)[1] if cands else t)
        times = best
    made = []
    for t in times:
        m, sec = int(t // 60), int(t % 60)
        f = out / f"snap_{m}m{sec:02d}s_{int(round(t * 10)):05d}.png"
        grab(t, f)
        if f.exists():
            made.append(f.name)
    return made


def list_snapshots(name):
    d = song_dir(name) / "snapshots"
    return sorted(f.name for f in d.glob("*.png")) if d.exists() else []


# ---------- live preview: the plan of a video, its card pictures, and a small copy of the video ----------
STILLS = {}                 # (song, key) -> (spec, work, fonts, pw, canvas): what /api/still draws
SHOT_Q = None


def shot_worker():
    """Playwright must stay on the thread that started it: one thread draws every card picture, keeping a Chrome page per style."""
    import queue
    global SHOT_Q
    SHOT_Q = queue.Queue()
    sys.path.insert(0, str(HERE / "lib"))
    import render as R
    import stills
    pages = {}

    def run():
        from playwright.sync_api import sync_playwright
        browser = R.launch(sync_playwright().start())
        while True:
            job, done = SHOT_Q.get()
            try:
                spec, work, look, pw, canvas = job
                fk = (tuple(sorted({look["lyrics_font"], look["logo_font"], look["credits_font"], look["end_font"]})), pw, tuple(canvas))
                if fk not in pages:
                    while len(pages) >= 2:
                        pages.pop(next(iter(pages))).close()
                    pages[fk] = R.Shots(look, pw, tuple(canvas), browser)
                done["path"] = stills.render(pages[fk], spec, work)
            except Exception as e:
                done["error"] = str(e)
            done["ev"].set()
    threading.Thread(target=run, daemon=True).start()


def draw_still(name, key):
    if (name, key) not in STILLS:
        raise ValueError("this picture is no longer in the plan: refresh the preview")
    spec, work, look, pw, canvas = STILLS[(name, key)]
    import stills
    out = stills.path(spec, work)
    if out.exists():
        return out
    with LOCK:
        if SHOT_Q is None:
            shot_worker()
    done = {"ev": threading.Event()}
    SHOT_Q.put(((spec, work, look, pw, canvas), done))
    done["ev"].wait(120)
    if "error" in done or "path" not in done:
        raise RuntimeError(done.get("error", "drawing the picture took too long"))
    return done["path"]


def _quiet(fn, *a):
    try:
        fn(*a)
    except Exception:
        pass


def preview_plan(name, data, output):
    """The plan of one output (lyric screens, cards, interludes and their pictures) from the page's current, possibly unsaved,
    settings, with a URL for every picture. Uses the saved placement; it never runs the slow analysis."""
    import pipeline as P
    import stills
    if output not in DEFAULT_OUTPUTS:
        raise ValueError("unknown output")
    c = read_song(name)
    c["dir"] = song_dir(name)
    if data.get("config"):
        c["config"] = merge(DEFAULT_CONFIG, data["config"])
    if data.get("credits"):
        c["credits"] = merge(DEFAULT_CREDITS, data["credits"])
    if "lyrics" in data:
        c["lyrics"] = data["lyrics"]
    per = int(P.look_for(c)["lyrics_lines"])
    auto = P.cached_auto(c, None, per)
    if not auto:
        return {"ready": False, "why": "The lyrics are not placed on the voice yet (or the lyrics changed since): wait for the placement to finish."}
    work = c["dir"] / "work"
    dur = P.probe(P.video_path(c))
    notes = []
    B = P.song_plan(c, auto, dur, say=lambda m: None)
    plan = P.output_plan(c, output, "preview", None, B, say=lambda m: notes.append(m) if m.startswith("NOTE") else None)
    frame = P.frame_for_cards(c, work, dur)

    def url(s):
        sp = P.still_spec(c, plan, s, frame)
        k = stills.key(sp)
        STILLS[(name, k)] = (sp, str(work), plan["look"], plan["pw"], plan["canvas"])
        if not stills.path(sp, work).exists():                              # start drawing it now, before the page asks
            threading.Thread(target=lambda: _quiet(draw_still, name, k), daemon=True).start()
        return f"/api/still?name={name}&key={k}"
    plan["logo"] = url(plan["logo"])
    for p in plan["pics"]:
        if p.get("still"):
            p["url"] = url(p.pop("still"))
        for q in p.get("parts", []):
            if q.get("still"):
                q["baked"] = q["still"]["kind"] == "panel"
                q["url"] = url(q.pop("still"))
            else:
                q["url"] = f"/media/{name}/photos/{q['photo']}"
    plan["notes"] = [n[5:] for n in notes]
    plan["voice"] = auto.get("voice", [])
    plan["ready"] = True
    return plan


def proxy_state(name):
    d = song_dir(name) / "work"
    try:
        st = json.loads((d / "proxy_status.json").read_text())
    except Exception:
        st = {"state": "none"}
    if st.get("state") == "ready":
        k = st.get("key")
        if not (d / f"proxy_{k}.mp4").exists():
            st = {"state": "none"}
        else:
            st["url"] = f"/media/{name}/work/proxy_{k}.mp4"
            st["peaks"] = f"/media/{name}/work/peaks_{k}.json"
    if st.get("state") == "working" and not (PROXY.get(name) and PROXY[name].poll() is None):
        st = {"state": "none"}                         # left over from a server that was stopped mid-way
    return st


PROXY = {}


def start_proxy(name):
    """Start making the preview copy (unless it is being made). The page asks again whenever the video or the master changes."""
    with LOCK:
        p = PROXY.get(name)
        if p and p.poll() is None:
            return
        PROXY[name] = subprocess.Popen([sys.executable, str(HERE / "tools" / "make_proxy.py"), str(song_dir(name))], cwd=str(HERE),
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


# ---------- http ----------
class H(BaseHTTPRequestHandler):
    server_version = "CoverSongs/1"

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        b = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def err(self, e, code=400):
        self.send_json({"error": str(e)}, code)

    def send_file(self, p):
        if not p.is_file():
            return self.err("not found", 404)
        size = p.stat().st_size
        ctype = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
        start, end, code = 0, size - 1, 200
        m = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if m and (m.group(1) or m.group(2)):
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:
                start = max(0, size - int(m.group(2)))
            end = min(end, size - 1)
            code = 206
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(end - start + 1))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            with open(p, "rb") as fh:
                fh.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = fh.read(min(1 << 20, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_GET(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self.send_file(UI)
            if u.path in ("/anim.js", "/fx.js", "/fx.json"):
                return self.send_file(HERE / "lib" / u.path[1:])
            if u.path == "/editor.js":
                return self.send_file(HERE / "ui" / "editor.js")
            if u.path == "/api/still":
                return self.send_file(draw_still(q.get("name"), q.get("key")))
            if u.path == "/api/proxy":
                return self.send_json(proxy_state(q.get("name")))
            if u.path == "/api/snapshots":
                return self.send_json({"files": list_snapshots(q.get("name"))})
            if u.path == "/api/songs":
                return self.send_json({"songs": list_songs()})
            if u.path == "/api/song":
                return self.send_json(read_song(q.get("name")))
            if u.path == "/api/check":
                return self.send_json({"results": check_song(q.get("name"))})
            if u.path == "/api/presets":
                return self.send_json(list_presets())
            if u.path == "/api/palettes":
                return self.send_json({"palettes": list_palettes()})
            if u.path == "/api/fonts":
                return self.send_json({"files": list_fonts()})
            if u.path == "/api/backdrop":
                return self.send_json({"url": backdrop(q.get("name") or None)})
            if u.path == "/api/status":
                p = RUN["proc"]
                return self.send_json({"running": bool(p and p.poll() is None), "lines": RUN["lines"][-60:], "mode": RUN["mode"], "song": RUN["song"], "code": RUN["code"], "outputs": RUN["outputs"]})
            if u.path == "/api/auto_times":
                f = song_dir(q.get("name")) / "work" / "auto_times.json"
                return self.send_json(json.loads(f.read_text(encoding="utf-8")) if f.exists() else {})
            if u.path == "/api/transition":
                return self.send_json({"url": transition_preview(q.get("name"))})
            parts = [unquote(x) for x in u.path.split("/")[1:]]
            if parts[0] == "media" and len(parts) >= 3:
                root = song_dir(parts[1]).resolve()
                p = (root / "/".join(parts[2:])).resolve()
                if root in p.parents:
                    return self.send_file(p)
            if parts[0] == "brand" and len(parts) == 2:
                return self.send_file(BRAND / safe_file(parts[1]))
            if parts[0] == "fonts" and len(parts) == 2:
                return self.send_file(FONTS / safe_file(parts[1]))
            if parts[0] == "previews" and len(parts) == 2:
                return self.send_file(PREVIEWS / safe_file(parts[1]))
            self.err("not found", 404)
        except Exception as e:
            self.err(e)

    def do_POST(self):
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/upload":
                return self.upload(q)
            data = self.body()
            if u.path == "/api/save":
                save_song(q["name"], data)
                return self.send_json({"ok": True})
            if u.path == "/api/snapshots":
                made = make_snapshots(q["name"], int(data.get("count") or 12), data.get("at"))
                return self.send_json({"files": list_snapshots(q["name"]), "made": made})
            if u.path == "/api/use_snapshot":
                src = song_dir(q["name"]) / "snapshots" / safe_file(q["file"])
                if not src.exists():
                    raise ValueError("no such snapshot")
                (song_dir(q["name"]) / "photos").mkdir(exist_ok=True)
                shutil.copy(src, song_dir(q["name"]) / "photos" / src.name)
                return self.send_json({"ok": True, "file": src.name})
            if u.path == "/api/palettes":
                return self.send_json({"palettes": save_palette(data)})
            if u.path == "/api/plan":
                return self.send_json(preview_plan(q["name"], data, q.get("output", "instagram")))
            if u.path == "/api/proxy":
                song_dir(q["name"])
                start_proxy(q["name"])
                return self.send_json(proxy_state(q["name"]))
            if u.path == "/api/lyric_screens":
                return self.send_json({"screens": screens(data.get("lyrics", ""), int(data.get("per", 2)), data.get("name"))})
            if u.path == "/api/run":
                start_run(q["name"], data.get("mode", "preview"), data.get("from"), data.get("to"), data.get("outputs"), bool(data.get("cached")))
                return self.send_json({"ok": True})
            if u.path == "/api/new":
                new_song(q["name"])
                return self.send_json({"ok": True})
            if u.path == "/api/preset":
                save_preset(q["name"], data)
                return self.send_json({"ok": True})
            if u.path == "/api/delete_file":
                d = song_dir(q["name"])
                kind, fname = q["kind"], safe_file(q["file"])
                p = kind_path(q["name"], kind, fname) if kind != "photo" else d / "photos" / fname
                if p.exists():
                    p.unlink()
                return self.send_json({"ok": True})
            self.err("not found", 404)
        except Exception as e:
            self.err(e)

    def upload(self, q):
        """Raw file body. kind=master|vocal|raw_video|final_export|logo|photo|font; the page then stores the file name in the config."""
        kind, fname = q.get("kind"), safe_file(q.get("file"))
        ext = Path(fname).suffix.lower()
        if kind == "font":
            if ext not in FONT_EXT:
                raise ValueError("fonts must be .ttf, .otf, .woff or .woff2")
            dest = FONTS / fname
        else:
            if kind not in KINDS or ext not in KINDS[kind]:
                raise ValueError(f"a {kind} file must be one of: {', '.join(sorted(KINDS.get(kind, [])))}")
            d = song_dir(q.get("name"))
            if not d.exists():
                raise ValueError("no such song")
            if kind == "photo":
                dest = d / "photos" / fname
            elif kind == "logo":
                dest = BRAND / f"logo{ext}"
                fname = dest.name
            else:
                dest = d / f"{kind}{ext}"
                fname = dest.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        left = int(self.headers.get("Content-Length") or 0)
        with open(tmp, "wb") as fh:
            while left > 0:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                fh.write(chunk)
                left -= len(chunk)
        if left:
            tmp.unlink()
            raise ValueError("upload was cut off")
        tmp.replace(dest)
        self.send_json({"ok": True, "file": fname})


def main():
    SONGS.mkdir(exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Cover Songs settings page: {url}   (Ctrl+C to stop)")
    if "--no-open" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
