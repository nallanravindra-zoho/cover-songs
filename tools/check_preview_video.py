"""Automatic check: does the live preview in the settings page look like the video the builder makes?

    .venv/bin/python tools/check_preview_video.py <song> [instagram|youtube|reel]      (the settings page must be running)

Makes test changes (in memory only, the song's settings are not changed): the second interlude gets two pictures (a filter, a
motion and a glitch transition between them), her video is cut before it with a filter and motion on the part after the cut,
the lyrics get new words on one screen and lose another, and three effects (RGB split, flash, shake) are put on. It builds that part of the video into a temporary folder, plays the same moments in the page's
preview (headless Chrome) and compares the pictures. Differences are on a 0-255 scale, averaged over the frame: "overall" on
8x8 blocks (colour, position, timing), "detail" pixel by pixel (the preview plays a smaller copy of her video, so it is softer).
Exit code 1 if a moment differs by more than the limits.
"""
import io, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE / "lib"))
import pipeline as P
import render as R

LIMIT, LIMIT_DETAIL = 6.5, 14.0     # overall (8x8 blocks) and pixel by pixel: the preview copy of the video is smaller, so fine detail differs more
URL = "http://127.0.0.1:8766/"
OVERRIDE = """(o) => { const ov = S.config.interludes = S.config.interludes || []; while (ov.length < 2) ov.push({});
  ov[1] = Object.assign({}, ov[1] || {}, o.il); Object.assign(S.config, o.conf); }"""


def blocks(a, b, n=8):
    h, w = a.shape[0] // n * n, a.shape[1] // n * n
    f = lambda x: x[:h, :w].astype(np.float32).reshape(h // n, n, w // n, n, 3).mean((1, 3))
    return float(np.abs(f(a) - f(b)).mean())


def overrides(c, il_start):
    """The test changes: two pictures in the second interlude; her video cut 8 s before it, the part after the cut warm and slowly
    zooming in (with dark corners); a free text low on the picture; the second picture shown 2.5 times as long as the first; the words of the first screen changed and the second screen taken out; effects: an RGB split
    before the cut, a flash on her zooming part, a shake over the way into the interlude; every lyric screen its own colours and size."""
    ph = c["photos"]
    il = {"on": True, "pictures": [{"photo": ph[0] if ph else "", "filter": "vintage", "weight": 2}, {"photo": ph[1] if len(ph) > 1 else "", "filter": "bw", "motion": "drift_left", "trans": "glitchrows", "weight": 5}]}
    conf = {"video_clips": {"cuts": [round(il_start - 8, 2)], "fx": [{}, {"filter": "warm", "motion": "zoom_in", "adjust": {"v": 0.4}}]},
            "screen_text": {"0": ["checking new words", "on two lines"]}, "screen_off": {"1": True},
            "texts": [{"lines": ["A free text", "placed low"], "start": round(il_start - 10, 2), "end": round(il_start - 2, 2), "pos": {"x": 0.05, "y": 0.8},
                       "style": {"lyrics_size": 54, "lyrics_fill_left": "#ffffff", "lyrics_fill_mid": "#ffe45e", "lyrics_fill_right": "#ffffff"}, "anim": "fade_up"}],
            "screen_style": {str(i): {"lyrics_size": 66, "lyrics_fill_left": "#ffe45e", "lyrics_fill_mid": "#ffffff", "lyrics_fill_right": "#7fe6e0", "lyrics_glow": "#ff3d9a"} for i in range(80)},
            "effects": [{"type": "rgb", "start": round(il_start - 10, 2), "end": round(il_start - 8.5, 2)},
                        {"type": "flash", "start": round(il_start - 4.25, 2), "end": round(il_start - 3.6, 2)},
                        {"type": "shake", "start": round(il_start - 0.3, 2), "end": round(il_start + 1.2, 2)}]}
    return {"il": il, "conf": conf}


def apply(c, o):
    ov = c["config"].setdefault("interludes", [])
    while len(ov) < 2:
        ov.append({})
    ov[1] = dict(ov[1] or {}, **o["il"])
    c["config"].update(o["conf"])


def build(song, output, outdir):
    c = P.load_song(HERE / "songs" / song)
    apply(c, overrides(c, 0))
    work = c["dir"] / "work"
    per = int(P.look_for(c)["lyrics_lines"])
    auto = P.cached_auto(c, None, per)
    if not auto:
        raise SystemExit("place the lyrics on the voice first (the settings page does it)")
    dur = P.probe(P.video_path(c))
    B = P.song_plan(c, auto, dur, say=lambda m: None)
    plan = P.output_plan(c, output, "preview", None, B, say=lambda m: None)
    il0 = next((p for p in plan["pics"] if p["kind"] == "interlude" and p["n"] == 2), None) or next((p for p in plan["pics"] if p["kind"] == "interlude"), None)
    o = overrides(c, il0["start"] if il0 else 30)
    c = P.load_song(HERE / "songs" / song)
    apply(c, o)
    B = P.song_plan(c, auto, dur, say=lambda m: None)
    plan = P.output_plan(c, output, "preview", None, B, say=lambda m: None)
    il = next((p for p in plan["pics"] if p["kind"] == "interlude" and p["n"] == 2), None) or next((p for p in plan["pics"] if p["kind"] == "interlude"), None)
    if not il:
        raise SystemExit("this video has no interlude to check")
    a, b = max(plan["clip"][0], il["start"] - 11), min(plan["clip"][1], il["end"] + 3)
    rng = None if output == "reel" else (a, b)
    P.build_output(c, output, "preview", rng, B, P.frame_for_cards(c, work, dur), R, P.video_path(c), work, outdir)
    off = plan["clip"][0] if output == "reel" else a
    moments = [il["start"] - 9, il["start"] - 4, il["start"] + il["din"] * 0.5]        # before the cut, her warm zooming part, the way in
    for q in il["parts"]:
        moments.append(il["start"] + (q["s"] + q["e"]) / 2)
        if q["tin"]:
            moments.append(il["start"] + q["s"] + q["din"] * 0.5)
    moments.append(il["end"] - il["dout"] * 0.5)
    # on the built video's frames: in the middle of a fast transition one frame (1/30 s) already changes the picture a lot
    moments = [t for t in moments if plan["clip"][0] + 0.2 <= t <= plan["clip"][1] - 0.2]
    return outdir / f"{output}_preview.mp4", off, sorted(off + round((t - off) * 30) / 30 for t in moments), o


def main():
    from playwright.sync_api import sync_playwright
    song = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "instagram"
    tmp = Path(tempfile.mkdtemp(prefix="check_video_"))
    video, off, moments, o = build(song, output, tmp)
    rows, errs = [], []
    with sync_playwright() as p:
        br = R.launch(p)
        pg = br.new_page(viewport={"width": 1400, "height": 1300}, device_scale_factor=1)
        pg.on("pageerror", lambda e: errs.append(str(e)))
        mine = ("/api/", f"/media/{song}/work/")                      # the preview's own requests (other steps of the page are not checked here)
        pg.on("response", lambda r: errs.append(f"{r.status} {r.url}") if r.status >= 400 and any(m in r.url for m in mine) else None)
        try:
            pg.goto(URL)
        except Exception:
            raise SystemExit("start the settings page first: .venv/bin/python settings.py")
        pg.wait_for_function("typeof S !== 'undefined' && S && S.name")
        if pg.evaluate("S.name") != song:
            pg.select_option("#songSel", song)
            pg.dispatch_event("#songSel", "change")
            pg.wait_for_function(f"S && S.name === '{song}'")
        pg.wait_for_timeout(1000)
        pg.evaluate(OVERRIDE, o)
        pg.evaluate("openCard(document.getElementById('s0'), true)")
        pg.wait_for_function("ED.plan && ED.plan.ready", timeout=30000)
        pg.evaluate(f"edSetOut('{output}')")
        pg.wait_for_function(f"ED.plan && ED.plan.ready && ED.plan.output === '{output}'", timeout=30000)
        pg.wait_for_function("ED.proxy && ED.proxy.state === 'ready' && ED.vid.readyState >= 2", timeout=300000)
        pg.wait_for_function("[ED.plan.logo].concat(ED.plan.pics.map(p => p.url), ED.plan.pics.flatMap(p => (p.parts || []).map(q => q.url))).filter(Boolean).every(u => ED.imgs[u] && ED.imgs[u].ok)", timeout=120000)
        pg.wait_for_timeout(2000)
        for t in moments:
            pg.evaluate(f"ED.vid.pause(); edSeek({t})")
            pg.wait_for_function("!ED.vid.seeking")
            pg.wait_for_timeout(700)
            shot = Image.open(io.BytesIO(pg.locator("#edStage").screenshot())).convert("RGB")
            # both can be wrong the same way (once the text size was 0 in both): the free text must really be on the picture
            if pg.evaluate("t => (S.config.texts || []).some(x => t >= x.start && t < x.end)", t):
                hgt = pg.evaluate("(() => { const b = $e('edTxt').querySelector('.ln'); return b ? b.getBoundingClientRect().height : 0; })()")
                if hgt < 8:
                    errs.append(f"{P.mmss(t)}: the free text is not visible in the preview")
            # the preview copy and the built video are both re-timed to 30 frames a second, so the same moment can be one frame
            # apart in the two: compare with the closest of the frames around it
            raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-ss", f"{max(0, t - off - 2 / 30):.3f}", "-i", str(video), "-frames:v", "5", "-vf", f"scale={shot.width}:{shot.height}",
                                  "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
            n = shot.width * shot.height * 3
            refs = [np.frombuffer(raw[i * n:(i + 1) * n], np.uint8).reshape(shot.height, shot.width, 3) for i in range(len(raw) // n)]
            ds = [float(np.abs(np.asarray(shot, np.float32) - r.astype(np.float32)).mean()) for r in refs]
            k = int(np.argmin(ds))
            rows.append((t, blocks(np.asarray(shot), refs[k]), ds[k]))
            Image.fromarray(np.hstack([np.asarray(shot), refs[k]])).save(tmp / f"compare_{t:.2f}.png")
        br.close()
    bad = list(errs)
    for t, d, dd in rows:
        ok = d <= LIMIT and dd <= LIMIT_DETAIL
        print(f"{P.mmss(t):>8s}  overall {d:4.1f}  detail {dd:4.1f}  {'ok' if ok else 'DIFFERENT'}")
        if not ok:
            bad.append(f"{P.mmss(t)} differs by {d:.1f} overall, {dd:.1f} in detail")
    print(f"\nSide-by-side pictures (preview left, video right): {tmp}")
    if bad:
        print("NOT OK: " + "; ".join(bad))
        sys.exit(1)
    print(f"The preview matches the built {output} video at all {len(rows)} moments.")


if __name__ == "__main__":
    main()
