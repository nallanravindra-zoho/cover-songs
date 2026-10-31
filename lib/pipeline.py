"""The whole build for one song folder, driven by its song.json / lyrics.txt / credits.json.

Steps: vocal recording (separated from the video's sound if not supplied) -> lyrics placed on it by forced alignment ->
screens start and end with the voice -> manual times from the settings page override the automatic ones -> interludes ->
render with Chrome (text) and ffmpeg (video). Nothing here listens to audio: times are measured.
"""
import hashlib, json, math, subprocess, sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE / "lib"))
import settings as cfg
import lyrics as ly
import voice
import fx

BREAK_GAP = 4.0      # seconds of silence between two lines paired on one screen that makes them separate screens
SNAP_BACK = 1.5      # a line starts at the first sound of its singing stretch only if that is at most this many seconds before the aligned start
END_TAIL = 0.8       # seconds a screen stays after the last aligned word
LANG = {"hindi": "hin", "telugu": "tel"}
TELUGU_FONTS = {f for f in ("Noto Sans Telugu", "Hind Guntur", "Anek Telugu", "Mandali", "Ramabhadra", "Gurajada", "Suranna", "NTR", "Dhurjati", "Ramaraja",
                            "Sree Krushnadevaraya", "Mallanna", "Peddana", "Tenali Ramakrishna", "Noto Serif Telugu", "Tiro Telugu", "Ponnala", "Timmana")}


def mmss(t):
    """Seconds as minutes:seconds, e.g. 192.6 -> 3:12.6, 90 -> 1:30 (tenths only when there are some)."""
    r = round(float(t) * 10) / 10
    m, sec = int(r // 60), r - int(r // 60) * 60
    return f"{m}:{int(sec):02d}" + (f".{round((sec - int(sec)) * 10)}" if abs(sec - int(sec)) > 0.04 else "")


def lyr_key(text, per):
    return hashlib.md5((str(per) + text.strip()).encode()).hexdigest()[:12]


def log(msg):
    print(msg, flush=True)


def probe(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], capture_output=True, text=True).stdout)


def load_song(song):
    song = Path(song)
    c = cfg.read_song(song.name)
    c["dir"] = song
    return c


def video_path(c):
    f = c["config"]["files"]
    for k in ("raw_video", "final_export"):
        if f.get(k) and (c["dir"] / f[k]).exists():
            return c["dir"] / f[k]
    raise SystemExit("No video yet: upload the raw video in step 2.")


def look_for(c):
    look = json.loads(json.dumps(cfg.DEFAULT_LOOK))
    look.update(c["config"]["look"])
    if c["config"]["language"] == "hindi" and look["lyrics_font"] in TELUGU_FONTS:
        look["lyrics_font"] = "Noto Sans Devanagari"
    return look


def master_path(c):
    f = c["config"]["files"].get("master")
    return c["dir"] / f if f and (c["dir"] / f).exists() else None


def voice_source(c):
    """Where her voice is taken from: her own vocal file, else the mastered audio, else the video's sound."""
    f = c["config"]["files"]
    if f.get("vocal") and (c["dir"] / f["vocal"]).exists():
        return "vocal", c["dir"] / f["vocal"]
    m = master_path(c)
    return ("master", m) if m else ("video", video_path(c))


def sig(p):
    p = Path(p).resolve()                      # the same file gives the same key whether the song was named as songs/x or by its full path
    st = p.stat()
    return hashlib.md5(f"{p}|{st.st_size}|{st.st_mtime}".encode()).hexdigest()[:10]


def sync_info(c, work):
    """{"offset": s, "ok": bool, "conf": x, "ref": name}: a moment at t in the voice source is at t + offset in the video. Cached."""
    kind, src = voice_source(c)
    if kind == "video":
        return {"offset": 0.0, "ok": True, "conf": None, "ref": "video"}
    sy = c["config"].get("sync", {})
    if sy.get("method") == "manual" and sy.get("raw_video_offset") is not None:
        return {"offset": float(sy["raw_video_offset"]), "ok": True, "conf": None, "ref": kind}
    ref = master_path(c) or src                         # the vocal is on the master's timeline
    v = video_path(c)
    key = sig(ref) + sig(v)
    cache = work / "sync.json"
    if cache.exists():
        d = json.loads(cache.read_text())
        if d.get("key") == key:
            return d
    import sync
    log("STEP lining the audio file up with the video's sound (the video is large, this can take a minute)")
    off, conf = sync.offset(ref, v)
    d = {"key": key, "offset": round(off, 3), "conf": round(conf, 1), "ok": conf >= 9.0, "ref": kind}
    if not d["ok"]:
        d["offset"] = 0.0
        log(f"WARN I could not find the audio file inside the video's sound (match {conf:.0f}, needs 9). I assume they start together. If the lyrics look shifted, set the offset by hand in the Files step.")
    else:
        log(f"NOTE the audio file starts {off:+.2f} s into the video's timeline (match {conf:.0f})")
    cache.write_text(json.dumps(d))
    return d


def vocals_for(c, work):
    kind, src = voice_source(c)
    if kind == "vocal":
        return src
    d = work / f"sep_{sig(src)}"
    out = d / "htdemucs/voicesrc/vocals.wav"
    if not out.exists():
        d.mkdir(parents=True, exist_ok=True)
        log(f"STEP separating her voice from the {'mastered audio' if kind == 'master' else 'video sound'} (about 1.5 minutes)")
        wav = d / "voicesrc.wav"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(wav)], check=True)
        subprocess.run([sys.executable, "-m", "demucs", "--two-stems=vocals", "-n", "htdemucs", "-d", "cpu", "-o", str(d), str(wav)], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def aligned_audio(c, work, dur):
    """The audio for the finished video: the mastered file placed on the video's timeline (None if the video's own sound is used)."""
    m = master_path(c)
    if not m or not c["config"].get("sync", {}).get("use_master_audio", True):
        return None
    sy = sync_info(c, work)
    if not sy["ok"]:
        return None
    out = work / f"audio_{sig(m)}_{sy['offset']}.m4a"
    if not out.exists():
        off = sy["offset"]
        cmd = ["ffmpeg", "-y", "-loglevel", "error"] + (["-ss", f"{-off:.3f}"] if off < 0 else []) + ["-i", str(m), "-vn", "-ac", "2"]
        if off > 0:
            cmd += ["-af", f"adelay={int(off * 1000)}:all=1"]
        subprocess.run(cmd + ["-t", f"{dur:.3f}", "-c:a", "aac", "-b:a", "192k", str(out)], check=True)
    return out


def auto_times(c, work, screens, flat, force=False, per=2):
    """Per screen {start, end, low} from the voice, and the voice map. Cached in work/auto_times.json."""
    import torch
    import align as A
    vocals = vocals_for(c, work)
    sy = sync_info(c, work)
    key = hashlib.md5((str(sy["offset"]) + str(per) + json.dumps(flat, ensure_ascii=False) + json.dumps([s["src"] for s in screens]) + str(vocals.stat().st_mtime) + str(vocals.stat().st_size)).encode()).hexdigest()
    cache = work / "auto_times.json"
    if cache.exists() and not force:
        d = json.loads(cache.read_text(encoding="utf-8"))
        if d.get("key") == key:
            return d
    lang = LANG.get(c["config"]["language"], "hin")
    log("STEP analysing her voice (the slow part: about 1 to 2 minutes for a full song)")
    wav = A.load16k(vocals)
    emf = work / "emissions.pt"
    ek = f"{vocals.stat().st_mtime}-{vocals.stat().st_size}"
    if emf.exists() and torch.load(emf).get("key") == ek:
        e = torch.load(emf)
    else:
        model = A.bundle.get_model(with_star=False)
        em, fr = A.emissions(model, wav)
        e = {"em": em, "fr": fr, "key": ek}
        torch.save(e, emf)
    em, fr = e["em"], e["fr"]
    segs = [[a + sy["offset"], b + sy["offset"]] for a, b in voice.segments(vocals)]
    off = sy["offset"]
    log("STEP placing each lyric line on the voice")
    aal_idx = {i for sc_ in screens for i in sc_["src"] if sc_.get("aalap")}      # aalap: sung without words, so nothing to match
    words_pl = [["*"] if i in aal_idx else A.romanize(l, lang) for i, l in enumerate(flat)]   # "*" = any sound: an aalap soaks up what is not words
    tok, al = A.bundle.get_tokenizer(), A.bundle.get_aligner()
    em_star = torch.cat([em, torch.zeros_like(em[..., :1])], dim=-1)
    spans = al(em_star[0], tok([w for ws in words_pl for w in ws]))
    lines, k = {}, 0
    star = {}
    for i, ws in enumerate(words_pl):
        if not ws:
            lines[i] = None
            continue
        sp = spans[k:k + len(ws)]
        k += len(ws)
        if i in aal_idx:                                  # where the aligner heard the aalap
            star[i] = (sp[0][0].start * fr + off, sp[0][-1].end * fr + off)
            lines[i] = None
            continue
        w = [(x[0].start * fr + off, x[-1].end * fr + off) for x in sp]
        w = [x for x in w if voice.containing(segs, (x[0] + x[1]) / 2, 0.3)] or w     # a word cannot be sung where the voice is silent
        cl, cur = [], [w[0]]
        for p, q in zip(w, w[1:]):                  # words more than 6 s apart (inside the voice) belong to different places: keep the densest run
            if q[0] - p[1] > 6.0:
                cl.append(cur)
                cur = []
            cur.append(q)
        cl.append(cur)
        best = max(cl, key=lambda cc: (len(cc), cc[0][0]))
        st_, en_ = best[0][0], min(best[-1][1], best[-1][0] + 1.5)
        if en_ - st_ > max(6.0, 3.0 * len(ws) + 2.0):    # a few words cannot take this long: the aligner stretched them over noise or an aalap, so trust the end
            st_ = en_ - min(en_ - st_, 1.5 * len(ws) + 1.0)
        lines[i] = {"start": st_, "end": en_, "score": float(np.mean([s.score for x in sp for s in x])), "n": len(ws)}
    log("STEP checking the result and finding the instrumental gaps")
    dur = probe(video_path(c))
    breaks = []                                   # two lines paired on one screen but sung far apart (an interlude between them): one screen each
    for sc in screens:
        for a, b in zip(sc["src"], sc["src"][1:]):
            if lines[a] and lines[b] and lines[b]["start"] - lines[a]["end"] > BREAK_GAP:
                breaks.append(b)
    if breaks:
        log(f"NOTE {len(breaks)} lyric screen(s) split: their lines are sung far apart")
        screens = ly.screens(c["lyrics"], per, breaks=set(breaks))[0]
    S = []
    for s in screens:
        if s.get("aalap"):
            S.append(None)                                        # timed below, from the voice between its neighbours
            continue
        ts = [lines[i] for i in s["src"] if lines[i]]
        ref = [t for t in ts if t["n"] >= 3] or ts            # one-word fillers are too unreliable to set the time
        S.append({"a0": min(t["start"] for t in ref), "a1": max(t["end"] for t in ref), "low": any(t["score"] < 0.2 for t in ts)})
    warnings = []
    for n, s in enumerate(S):                                     # an aalap lasts as long as the voice is heard between the lines around it
        if s is not None:
            continue
        prev_a1 = max([S[k]["a1"] + END_TAIL for k in range(n) if S[k]], default=0.0)
        next_a0 = min([S[k]["a0"] for k in range(n + 1, len(S)) if S[k]], default=dur)
        i_src = screens[n]["src"][0]
        lo, hi = prev_a1, next_a0                         # the aligner's own estimate of this aalap, kept between the lines around it
        if i_src in star:
            lo, hi = max(lo, star[i_src][0]), min(hi, star[i_src][1])
        pieces = [(max(a, lo), min(b, hi)) for a, b in segs if min(b, hi) - max(a, lo) >= 1.5]
        if not pieces and (lo, hi) != (prev_a1, next_a0):   # the estimate hit silence: fall back to any singing between the lines
            pieces = [(max(a, prev_a1), min(b, next_a0)) for a, b in segs if min(b, next_a0) - max(a, prev_a1) >= 1.5]
        if pieces:
            a, b = max(pieces, key=lambda x: x[1] - x[0])
            S[n] = {"a0": a, "a1": b, "low": False}
        else:
            warnings.append(f"Aalap (screen {n + 1}): I hear no singing between {mmss(prev_a1)} and {mmss(next_a0)}, so it is shown only briefly at {mmss(prev_a1)}.")
            S[n] = {"a0": prev_a1 + 0.3, "a1": min(next_a0, prev_a1 + 3.0), "low": True}
    out, prev_end = [], -1.0
    for n, s in enumerate(S):         # a screen starts at its first sung word; if the voice began just before it (within SNAP_BACK s), at the first sound
        st = max(0.0, s["a0"] - 0.1)
        sg = voice.containing(segs, s["a0"])
        if sg and s["a0"] - sg[0] <= SNAP_BACK and sg[0] >= prev_end - 0.1:
            st = sg[0]
        out.append({"start": round(st, 2), "low": s["low"], "a0": round(s["a0"], 2), "a1": round(s["a1"], 2)})
        prev_end = s["a1"]
    runs = []                                                 # stretches of singing; silences up to BREAK_GAP s inside a run are ordinary pauses
    for a, b in segs:
        if runs and a - runs[-1][1] <= BREAK_GAP:
            runs[-1][1] = b
        else:
            runs.append([a, b])
    for n, s in enumerate(S):                                 # end with the voice, or when the next line starts
        sg2 = voice.containing(segs, s["a1"])
        off = min(sg2[1], s["a1"] + END_TAIL) if sg2 else s["a1"] + 0.5     # the separated voice rings on after the last word: do not follow the tail
        nxt = out[n + 1]["start"] - 0.05 if n + 1 < len(out) else dur
        end = max(out[n]["start"] + 0.8, min(off, nxt))
        run = voice.containing([tuple(r) for r in runs], out[n]["start"], 0.5)
        if run and end > run[1] + END_TAIL + 0.01:            # never keep lyrics on screen across a long silence: that silence is an interlude
            warnings.append(f"Screen {n + 1}: its text was cut at {mmss(run[1] + END_TAIL)} because the singing stops there for {mmss(end - run[1])}.")
            end = max(out[n]["start"] + 0.8, run[1] + END_TAIL)
        out[n]["end"] = round(end, 2)
        out[n]["a_end"] = round(s["a1"], 2)
    hard = []
    for n, (s, o) in enumerate(zip(S, out)):                  # things worth a look, reported so nobody has to find them by watching
        nlines = len(screens[n]["src"])
        if o["end"] - o["start"] > max(12, 9 * nlines):
            warnings.append(f"Screen {n + 1} ({mmss(o['start'])}-{mmss(o['end'])}) stays up for {mmss(o['end'] - o['start'])}: check that it is sung that long.")
        if not voice.containing(segs, o["start"], 1.0):
            warnings.append(f"Screen {n + 1} starts at {mmss(o['start'])}, where I hear no voice: check its time.")
        if s["low"]:
            hard.append(n + 1)
    if hard:
        warnings.append("Hard to match to the voice (marked unsure in the table): screens " + ", ".join(map(str, hard)) + ". Check their times.")
    d = {"key": key, "screens": out, "voice": segs, "seconds": round(dur, 2), "breaks": sorted(set(breaks)), "lyr": lyr_key(c["lyrics"], per), "warnings": warnings, "source": voice_source(c)[0], "offset": sy["offset"]}
    cache.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
    return d


def merged_times(c, screens, auto):
    """Manual times from the settings page win; blanks fall back to the automatic ones."""
    ms, me = c["config"].get("lyric_times", []), c["config"].get("lyric_ends", [])
    out = []
    for i, a in enumerate(auto["screens"]):
        st = ms[i] if i < len(ms) and ms[i] is not None else a["start"]
        en = me[i] if i < len(me) and me[i] is not None else a["end"]
        if en <= st:
            en = st + 0.8
        out.append({"start": st, "end": en, "low": a["low"]})
    return out


def candidate_gaps(times, dur, shortest=4.0):
    """Every instrumental gap between lyric screens longer than `shortest` seconds."""
    res, prev = [], 0.0
    for t in times + [{"start": dur, "end": dur}]:
        if t["start"] - prev > shortest:
            res.append({"gap_from": round(prev, 2), "gap_to": round(t["start"], 2)})
        prev = max(prev, t.get("end", t["start"]))
    return res


def interludes_for(c, times, dur, min_gap, say=log):
    """One entry per gap: it gets pictures when it is longer than min_gap seconds, unless the settings say Yes or No for that gap.
    Each has one transition in and one out (the defaults, or its own), and one or more pictures that follow each other."""
    T = c["config"]["transitions"]
    ov = c["config"].get("interludes") or []
    res = []
    for i, g in enumerate(candidate_gaps(times, dur)):
        o = ov[i] if i < len(ov) and ov[i] else {}
        length = g["gap_to"] - g["gap_from"]
        on = o.get("on") if o.get("on") is not None else length > min_gap
        why = "yes (you set it)" if o.get("on") is True else "no (you set it)" if o.get("on") is False else (f"yes, longer than {mmss(min_gap)}" if on else f"no, not longer than {mmss(min_gap)}")
        say(f"GAP {i + 1}: {mmss(g['gap_from'])}-{mmss(g['gap_to'])} ({mmss(length)} long) picture: {why}")
        if not on:
            continue
        st = o["start"] if o.get("start") is not None else g["gap_from"] + 0.6
        en = o["end"] if o.get("end") is not None else g["gap_to"] - 0.6
        if en - st < 1.5:
            say(f"NOTE gap {i + 1} skipped: the picture would be shorter than 1.5 s")
            continue
        pics = [dict(x) for x in (o.get("pictures") or []) if isinstance(x, dict)] or [{"photo": o.get("photo") or ""}]
        it = {"start": round(st, 2), "end": round(en, 2), "tin": o.get("tin") or T["interlude_in"]["name"], "tout": o.get("tout") or T["interlude_out"]["name"],
              "din": T["interlude_in"]["seconds"], "dout": T["interlude_out"]["seconds"], "pictures": pics, "n": i + 1}
        room = (it["end"] - it["start"]) / 2 - 0.1
        it["din"], it["dout"] = max(0.2, min(it["din"], room)), max(0.2, min(it["dout"], room))
        if len(pics) > 1 and (it["end"] - it["start"]) / len(pics) < 1.5:
            say(f"NOTE interlude {i + 1}: {len(pics)} pictures in {mmss(it['end'] - it['start'])} leaves less than 1.5 s each")
        res.append(it)
    return res


def frame_for_cards(c, work, dur):
    f = work / f"frame_{sig(video_path(c))}.jpg"          # one per video, so a replaced video gets its own card background
    if not f.exists():
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{dur * 0.3:.1f}", "-i", str(video_path(c)), "-frames:v", "1", "-vf",
                        "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", str(f)], check=True)
    return f


def output_cfg(conf, name):
    base = json.loads(json.dumps(cfg.DEFAULT_OUTPUTS[name]))
    return cfg.merge(base, (conf.get("outputs") or {}).get(name, {}))


def reel_range(oc, times, screens_n, dur):
    """The reel starts at the first sung line (or the time you set) and is `length` seconds long; if a lyric screen ends shortly before
    the limit, it stops there so the cut never lands in the middle of a line."""
    first = times[0]["start"] if times else 0.0
    a = float(oc["start"]) if oc.get("start") is not None else max(0.0, first - 0.5)
    L = float(oc.get("length") or 60)
    b = min(dur, a + L)
    if oc.get("snap_to_line", True) and b - a >= L - 0.01:
        ends = [t["end"] for t in times if b - 10 <= t["end"] <= b]
        if ends:
            b = max(ends) + 0.4
    return a, b


def cached_auto(c, screens, per):
    """The saved placement, if it still belongs to these lyrics (the preview never starts the slow analysis itself)."""
    f = c["dir"] / "work" / "auto_times.json"
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        return None
    if d.get("lyr") != lyr_key(c["lyrics"], per):
        return None
    n = len(ly.screens(c["lyrics"], per, breaks=set(d.get("breaks", [])))[0])
    return d if len(d.get("screens", [])) == n else None


def song_plan(c, auto, dur, say=log):
    """What every output shares: the lyric screens with their times and the interludes."""
    look0 = look_for(c)
    per = int(look0["lyrics_lines"])
    screens = edited_screens(c, ly.screens(c["lyrics"], per, breaks=set(auto.get("breaks", [])))[0], merged_times(c, ly.screens(c["lyrics"], per, breaks=set(auto.get("breaks", [])))[0], auto))
    times = [{"start": s["start"], "end": s["end"]} for s in screens]
    IL = interludes_for(c, times, dur, c["config"].get("interlude_min_seconds", 8), say)
    return {"look0": look0, "screens": screens, "times": times, "IL": IL, "dur": dur, "T": c["config"]["transitions"], "video": video_clips(c, dur)}


def edited_screens(c, screens, times):
    """The lyric screens after the changes made in the preview: new words for a screen (screen_text), a screen taken out
    (screen_off), screens added at a time of their own (added_screens), and a screen's own animation (screen_anim).
    Each keeps an id: its number in the lyrics (0, 1, ..) or "a0", "a1", .. for added ones. Sorted by time."""
    conf = c["config"]
    txt, off, an = conf.get("screen_text") or {}, conf.get("screen_off") or {}, conf.get("screen_anim") or {}
    out = []
    for i, (s, t) in enumerate(zip(screens, times)):
        if off.get(str(i)):
            continue
        lines = [x for x in (txt.get(str(i)) or s["lines"]) if x.strip()] or s["lines"]
        out.append(dict(s, lines=lines, start=t["start"], end=t["end"], i=i, fx_in=an.get(str(i)) or None))
    for k, a in enumerate(conf.get("added_screens") or []):
        lines = [x for x in (a.get("lines") or []) if x.strip()]
        if lines and a.get("start") is not None and float(a.get("end") or 0) > float(a["start"]):
            out.append({"section": "added", "lines": lines, "src": [], "start": float(a["start"]), "end": float(a["end"]), "i": f"a{k}", "fx_in": a.get("anim") or None})
    out.sort(key=lambda s: s["start"])
    for s, n in zip(out, out[1:]):                       # two screens are never on at once: the earlier one ends as the next begins
        if s["end"] > n["start"] - 0.05:
            s["end"] = max(s["start"] + 0.3, n["start"] - 0.05)
    return out


def video_clips(c, dur):
    """Her video cut into clips at the times in video_clips.cuts; each clip has its own filter and motion (video_clips.fx)."""
    vc = c["config"].get("video_clips") or {}
    cuts = sorted(float(x) for x in (vc.get("cuts") or []) if 0 < float(x) < dur)
    fxs = vc.get("fx") or []
    edges = [0.0] + cuts + [dur]
    out = []
    for k in range(len(edges) - 1):
        f = dict(fxs[k]) if k < len(fxs) and isinstance(fxs[k], dict) else {}
        p = fx.params(f)
        out.append(dict(f, start=round(edges[k], 3), end=round(edges[k + 1], 3), plain=fx.is_plain(f) and (f.get("motion") or "still") == "still", v=round(p["v"], 3), grain=round(p["n"], 3)))
    return out


def zoom_pre(wl, H):
    """How much larger than the frame a moving picture is prepared, so slow zooms stay smooth."""
    return 3 if wl * H * 9 < 3e7 else 2


def output_plan(c, name, mode, rng, B, say=log):
    """Everything that decides what one output video looks like and when, without drawing anything. The builder draws it;
    the live preview in the settings page plays the same plan."""
    conf = c["config"]
    dur, screens, times, IL, look0 = B["dur"], B["screens"], B["times"], B["IL"], B["look0"]
    T = conf["transitions"]
    oc = output_cfg(conf, name)
    look = cfg.merge(look0, oc.get("look") or {})
    side = oc["layout"] == "side"
    final = mode == "final"
    Wf = int(oc["width"] if final else oc["preview_width"])
    if side:
        W = Wf // 2 * 2
        H = round(W * 9 / 16) // 2 * 2
        wl = round(W * oc["split"]) // 2 * 2
        canvas, pw = (round(1080 * wl / H), 1080), wl
        layout = {"mode": "side", "wl": wl, "focus": oc.get("video_focus", 0.3), "blur": max(8, int(oc.get("blur", 36) * W / 1920))}
        kc = oc.get("card_scale", 0.5)
    else:
        W = Wf // 2 * 2
        H = round(W * 16 / 9) // 2 * 2
        wl = W
        canvas, pw, layout, kc = (1080, 1920), W, None, 1.0
    k = oc.get("text_scale", 1.0)
    if name == "reel":                                   # the part of the song this video covers (screens outside it are not drawn)
        clip = reel_range(oc, times, len(screens), dur)
        say(f"REEL {mmss(clip[0])}-{mmss(clip[1])} ({mmss(clip[1] - clip[0])} long)")
    elif oc.get("start") is not None or oc.get("length"):
        a0 = float(oc.get("start") or 0)
        clip = (a0, min(dur, a0 + float(oc["length"])) if oc.get("length") else dur)
    else:
        clip = tuple(rng) if rng else (0.0, dur)
    ta = cfg.merge(conf.get("text_anim") or {}, {k2: v2 for k2, v2 in (oc.get("text_anim") or {}).items() if v2 not in ("", None)})
    import render as R
    eff, out_mode = ta.get("in", "fade"), ta.get("out", "reverse")
    if eff not in R.ANIM_FX:
        say(f"NOTE unknown text animation {eff!r}: fade is used")
        eff = "fade"
    sc = []
    for s in screens:
        if s["end"] > clip[0] and s["start"] < clip[1]:
            length = s["end"] - s["start"]
            fx_s = s.get("fx_in") if s.get("fx_in") in R.ANIM_FX else eff        # a screen's own animation, else the video's
            sc.append(dict(s, fx=fx_s, din=round(min(float(ta.get("in_seconds", .5)), length * .45), 3), dout=round(min(float(ta.get("out_seconds", .3)), length * .4), 3)))
    pics = []
    if oc.get("opening", True) and conf["opening"].get("enabled", True):
        o_end = min(float(conf["opening"].get("seconds") or 6), dur / 3)
        pics.append({"start": 0.0, "end": o_end, "tin": None, "din": 0, "tout": T["opening_to_video"]["name"], "dout": T["opening_to_video"]["seconds"], "zoom": "card", "kind": "opening",
                     "still": {"kind": "opening", "photo": conf["opening"].get("photo"), "k": kc, "blur": 30 if side else 0}})
    if oc.get("ending", True) and conf["ending"].get("enabled", True):
        e_len = min(float(conf["ending"].get("seconds") or 6), dur / 3)
        pics.append({"start": dur - e_len, "end": dur, "tin": T["video_to_end"]["name"], "din": T["video_to_end"]["seconds"], "tout": None, "dout": 0, "zoom": "card", "kind": "ending",
                     "still": {"kind": "ending", "photo": conf["ending"].get("photo"), "k": kc, "photo_h": 0 if side else None}})
    if oc.get("interludes", True):
        between = T.get("picture_to_picture") or cfg.DEFAULT_TRANSITIONS["picture_to_picture"]
        default_motion = conf.get("photo_motion") or "zoom_in"
        for it in IL:
            parts = fx.interlude_parts(it, it["end"] - it["start"], default_motion, between)
            for j, q in enumerate(parts):
                hue = (350, 200, 30)[(it["n"] + j - 1) % 3]
                photo = q.get("photo") or ""
                has = bool(photo) and (c["dir"] / "photos" / photo).exists()
                if photo and not has:
                    say(f"NOTE interlude {it['n']}: photo {photo} not found, the default picture is used")
                p = fx.params(q)
                q.update(v=round(p["v"], 3), grain=round(p["n"], 3), photo=photo if has else "", hue=hue)
                if side:
                    q["still"] = {"kind": "panel", "photo": photo if has else None, "n": it["n"], "hue": hue, "filter": {k2: q.get(k2) for k2 in ("filter", "amount", "adjust")}}
                elif not has:
                    q["still"] = {"kind": "placeholder", "n": it["n"], "hue": hue}
            pics.append(dict(it, zoom="interlude", kind="interlude", parts=parts))
    pics.sort(key=lambda p: p["start"])
    keep = []                                       # a picture needs room: the video must be on screen between two pictures
    for p in pics:
        if p["kind"] != "interlude":
            keep.append(p)
            continue
        before = max([q["end"] for q in keep], default=-9)
        after = min([q["start"] for q in pics if q["kind"] == "ending"], default=dur + 9)
        prev_dout = next((q["dout"] for q in reversed(keep)), 0)
        if p["start"] - before >= prev_dout + p["din"] + 0.8 and after - p["end"] >= p["dout"] + 0.8:
            keep.append(p)
        else:
            say(f"NOTE interlude {mmss(p['start'])}-{mmss(p['end'])} skipped: it overlaps a card or another picture")
    keep.sort(key=lambda p: p["start"])
    for p_ in pics:
        if p_["kind"] in ("opening", "ending") and not (p_["start"] >= clip[0] - 0.01 and p_["end"] <= clip[1] + 0.01):
            say(f"NOTE the {p_['kind']} card ({mmss(p_['start'])}-{mmss(p_['end'])}) is not in this video: it lies outside {mmss(clip[0])}-{mmss(clip[1])}")
    keep = [p for p in keep if p["start"] >= clip[0] - 0.01 and p["end"] <= clip[1] + 0.01]
    Wfin = int(oc["width"]) // 2 * 2                    # the blurred background, as a share of the width in the final video (render.compose)
    if side:
        b = max(8, int(oc.get("blur", 36) * Wfin / 1920))
        bg_blur = math.sqrt(6 * b * (b + 1) / 3) / (round(Wfin * oc["split"]) // 2 * 2)
    else:
        bg_blur = math.sqrt(4 * 24 * 25 / 3) / Wfin
    return {"output": name, "label": oc["label"], "size": [W, H], "wl": wl, "canvas": list(canvas), "pw": pw, "layout": layout or {"mode": "portrait"}, "kc": kc, "k": k,
            "clip": [round(clip[0], 3), round(clip[1], 3)], "dur": dur, "fade": float(oc.get("fade") or 0), "look": look,
            "anim": {"in": eff, "out": out_mode}, "screens": sc, "pics": keep, "pre": zoom_pre(wl, H),
            "logo": {"kind": "logo"}, "bg_blur": round(bg_blur, 5), "video": B["video"]}


def video_fx(P, work):
    """What the builder needs to give her video its clips' filters and motion: the size her video is worked on, and per clip a
    colour table (LUT), blur, vignette picture and grain. None when no clip has anything."""
    clips = [v for v in P["video"] if not v["plain"]]
    if not clips:
        return None
    W, H = P["size"]
    wl = P["wl"]
    SW, SH = (wl, H) if P["layout"]["mode"] != "side" else (max(wl, W - wl), H)
    out = []
    for v in clips:
        p = fx.params(v)
        out.append(dict(v, lut=str(fx.lut_file(p, work / "fx")) if not fx.colour_plain(p) else None, blur=p["bl"] * SW / 1080))
    return {"size": [SW, SH], "clips": out, "work": str(work / "fx")}


def still_spec(c, P, s, frame):
    """A picture spec from the plan, completed with what it is drawn from (look, credits, background)."""
    conf = c["config"]
    sp = dict(s, look=P["look"], canvas=P["canvas"], pw=P["pw"])
    if s["kind"] in ("opening", "ending"):
        f = s.get("photo")
        sp["bg"] = str(c["dir"] / "photos" / f) if f and (c["dir"] / "photos" / f).exists() else str(frame)
        sp.update(credits=c["credits"], language=conf["language"], title=conf.get("title", ""))
        sp.pop("photo", None)
    elif s["kind"] == "panel":
        sp["bg"] = str(frame)
        sp["photo"] = str(c["dir"] / "photos" / s["photo"]) if s.get("photo") else None
    return sp


def build(song, mode, rng=None, outputs=None, cached=False):
    import render as R
    c = load_song(song)
    work = c["dir"] / "work"
    out = c["dir"] / "out"
    (work / "png").mkdir(parents=True, exist_ok=True)
    out.mkdir(exist_ok=True)
    conf = c["config"]
    per = int(look_for(c)["lyrics_lines"])
    screens, flat = ly.screens(c["lyrics"], per)
    if not screens:
        raise SystemExit("No lyrics yet: add them in step 3.")
    auto = auto_times(c, work, screens, flat, force=(mode == "align" and not cached), per=per)
    if mode == "align":
        screens = ly.screens(c["lyrics"], per, breaks=set(auto.get("breaks", [])))[0]
        gaps = candidate_gaps(merged_times(c, screens, auto), probe(video_path(c)))
        log(f"DONE placed {len(screens)} lyric screens, {len(gaps)} instrumental gaps: " + ", ".join(f"{mmss(g['gap_from'])}-{mmss(g['gap_to'])}" for g in gaps))
        for w in auto.get("warnings", []):
            log("WARN " + w)
        return
    src = video_path(c)
    dur = probe(src)
    B = song_plan(c, auto, dur)
    frame = frame_for_cards(c, work, dur)
    names = [n for n in (outputs or [n for n in cfg.DEFAULT_OUTPUTS if output_cfg(conf, n)["enabled"]]) if n in cfg.DEFAULT_OUTPUTS]
    if not names:
        raise SystemExit("No output is switched on: tick at least one in step 8.")
    for name in names:
        log(f"OUTPUT {name}: {output_cfg(conf, name)['label']}")
        build_output(c, name, mode, rng, B, frame, R, src, work, out)
    log("DONE " + ", ".join(f"{n}_{mode}.mp4" for n in names))


def build_output(c, name, mode, rng, B, frame, R, src, work, out):
    import stills
    P = output_plan(c, name, mode, rng, B)
    look, canvas, pw, k = P["look"], tuple(P["canvas"]), P["pw"], P["k"]
    W, H = P["size"]
    wl = P["wl"]
    eff, out_mode = P["anim"]["in"], P["anim"]["out"]
    layout = P["layout"] if P["layout"]["mode"] == "side" else None
    sh = R.Shots(look, pw, canvas)
    sc = P["screens"]
    log(f"STEP drawing {len(sc)} lyric screens (animation: {eff})")
    for n, s in enumerate(sc):
        din, dout, e = s["din"], s["dout"], s["fx"]
        if e in ("fade", "none"):
            s["png"] = str(sh.png(R.lyric_html(look, s["lines"], sh, k), work / f"png/{name}_L_{n:02d}.png"))
            s["fin"], s["fout"] = (0.02 if e == "none" else round(din, 2)), (0.02 if out_mode == "cut" or e == "none" else round(dout, 2))
        else:
            lines, size = R.fit_lines(sh, s["lines"], look["lyrics_font"], look["lyrics_weight"], look["lyrics_size"] * k, sh.cw * 0.9, look["lyrics_outline_w"])
            an = sh.anim_screen(lines, size, look, e, din, dout, out_mode, 30, work / "anim", pw)
            an.update(din=an["nin"] / 30, dout=an["nout"] / 30)
            s["anim"] = an
    logo = stills.render(sh, still_spec(c, P, P["logo"], frame), work)
    pre = P["pre"]
    for p in P["pics"]:
        if p.get("still"):
            p["image"] = str(stills.render(sh, still_spec(c, P, p["still"], frame), work))
        for q in p.get("parts", []):
            if q.get("still"):
                base = stills.render(sh, still_spec(c, P, q["still"], frame), work)
            else:
                base = c["dir"] / "photos" / q["photo"]
            colour = None if q.get("still", {}).get("kind") == "panel" else {k2: q.get(k2) for k2 in ("filter", "amount", "adjust")}
            q["image"] = str(fx.still(base, (wl * pre, H * pre), colour, work / "fx", wl * pre / canvas[0]))
            q["vig"] = str(fx.vignette_png(wl, H, q["v"], work / "fx")) if q["v"] > 0 else None
    sh.close()
    log("STEP putting the video together")
    clip = tuple(P["clip"])
    vfx = video_fx(P, work)
    R.compose(src, sc, logo, P["pics"], out / f"{name}_{mode}.mp4", (W, H), layout, 30, dur_total=P["dur"], clip=clip, fade=P["fade"], audio=aligned_audio(c, work, P["dur"]), vfx=vfx)
    report = {"output": name, "size": [W, H], "clip": clip, "screens": [{"lines": s["lines"], "start": s["start"], "end": s["end"]} for s in sc],
              "pictures": [{k2: v for k2, v in p.items() if k2 not in ("image",)} for p in P["pics"]]}
    (out / f"{name}_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    for p in P["pics"]:
        log(f"PICTURE {p['kind']} {mmss(p['start'])}-{mmss(p['end'])} in:{p['tin']} out:{p['tout']}" + (f" ({len(p['parts'])} pictures)" if len(p.get("parts", [])) > 1 else ""))
    log(f"DONE {name}_{mode}.mp4 ({W}x{H})")
