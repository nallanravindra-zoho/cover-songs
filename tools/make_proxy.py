"""Make the small preview copy of a song's video for the live preview in the settings page, with the finished video's sound
(the mastered audio lined up with the video when there is one), plus the loudness outline drawn under the timeline.

    .venv/bin/python tools/make_proxy.py songs/<song>

Writes songs/<song>/work/proxy_<key>.mp4, peaks_<key>.json and proxy_status.json (read by the page while this runs).
"""
import json, subprocess, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import numpy as np
import pipeline as P


def status(work, **kw):
    (work / "proxy_status.json").write_text(json.dumps(dict(kw, at=time.time())))


def proxy_key(c, work):
    v = P.video_path(c)
    m = P.master_path(c)
    use_m = bool(m and c["config"].get("sync", {}).get("use_master_audio", True))
    return "v2_" + P.sig(v) + ("_" + P.sig(m) if use_m else ""), use_m


def main(song):
    c = P.load_song(song)
    work = c["dir"] / "work"
    work.mkdir(exist_ok=True)
    key, use_m = proxy_key(c, work)
    out, peaks = work / f"proxy_{key}.mp4", work / f"peaks_{key}.json"
    if out.exists() and peaks.exists():
        status(work, state="ready", key=key, progress=1)
        return
    status(work, state="working", key=key, progress=0, step="lining up the sound" if use_m else "starting")
    v = P.video_path(c)
    dur = P.probe(v)
    audio = P.aligned_audio(c, work, dur) if use_m else None
    status(work, state="working", key=key, progress=0.02, step="making a small copy of the video")
    tmp = work / f"proxy_{key}.part.mp4"
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-progress", "pipe:1", "-hwaccel", "videotoolbox", "-i", str(v)]
    if audio:
        cmd += ["-i", str(audio), "-map", "0:v:0", "-map", "1:a:0"]
    else:
        cmd += ["-map", "0:v:0", "-map", "0:a:0?"]
    # marked as ordinary (SDR) video with the colour values unchanged: that is what the builder makes of a phone's HDR video,
    # so the browser shows the preview with the finished video's colours instead of tone-mapping it (measured: 24 -> 5 apart)
    cmd += ["-vf", "scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)',fps=30,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709", "-c:v", "libx264", "-preset", "veryfast", "-crf", "25",
            "-g", "15", "-keyint_min", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-movflags", "+faststart", "-t", f"{dur:.3f}", str(tmp)]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    last = 0
    for line in p.stdout:
        if line.startswith("out_time_us=") and line.strip()[12:].isdigit():
            done = int(line.strip()[12:]) / 1e6 / max(1, dur)
            if time.time() - last > 0.5:
                status(work, state="working", key=key, progress=round(0.02 + 0.93 * min(1, done), 3), step="making a small copy of the video")
                last = time.time()
    if p.wait() != 0:
        err = p.stderr.read()[-600:]
        if "videotoolbox" in err.lower() or "hwaccel" in err.lower():     # no hardware decoding for this file: plain decoding
            subprocess.run([x for x in cmd if x not in ("-hwaccel", "videotoolbox")], check=True, capture_output=True)
        else:
            status(work, state="error", key=key, error=err)
            raise SystemExit(err)
    tmp.replace(out)
    status(work, state="working", key=key, progress=0.97, step="measuring the loudness for the timeline")
    raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(out), "-vn", "-ac", "1", "-ar", "2000", "-f", "s16le", "-"], capture_output=True).stdout
    a = np.abs(np.frombuffer(raw, np.int16).astype(np.float32)) / 32768
    per = 100                                             # 20 values per second
    n = len(a) // per
    pk = a[:n * per].reshape(n, per).max(axis=1) if n else np.zeros(0)
    pk = pk / max(1e-6, float(np.percentile(pk, 99.5)) if n else 1)
    peaks.write_text(json.dumps({"rate": 20, "peaks": [int(min(1, x) * 100) for x in pk]}))
    status(work, state="ready", key=key, progress=1)


if __name__ == "__main__":
    try:
        main(sys.argv[1])
    except SystemExit:
        raise
    except Exception as e:
        c = P.load_song(sys.argv[1])
        status(c["dir"] / "work", state="error", error=str(e)[-600:])
        raise
