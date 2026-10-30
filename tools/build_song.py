"""Build a song from its folder.

    .venv/bin/python tools/build_song.py songs/bachpan --mode align             place the lyrics on the voice (times for the settings page)
    .venv/bin/python tools/build_song.py songs/bachpan --mode preview [--from 30 --to 90]    small, fast copy
    .venv/bin/python tools/build_song.py songs/bachpan --mode final                          full size
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
import pipeline

ap = argparse.ArgumentParser()
ap.add_argument("song"); ap.add_argument("--mode", choices=["align", "preview", "final"], default="preview")
ap.add_argument("--output", default="all", help="instagram, youtube, reel, a comma list, or all (the ones switched on)")
ap.add_argument("--cached", action="store_true", help="align: reuse the saved placement if the lyrics and voice are unchanged")
ap.add_argument("--from", dest="a", type=float); ap.add_argument("--to", dest="b", type=float); a = ap.parse_args()
outs = None if a.output == "all" else a.output.split(",")
pipeline.build(a.song, a.mode, (a.a, a.b) if a.a is not None and a.b is not None else None, outs, a.cached)
