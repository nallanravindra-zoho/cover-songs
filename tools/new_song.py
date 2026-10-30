"""Starts a new song folder from the template:   .venv/bin/python tools/new_song.py srikaramagu"""
import re, shutil, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent.parent
if len(sys.argv) != 2 or not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", sys.argv[1]) or sys.argv[1].startswith("_"):
    sys.exit("usage: new_song.py <name>   (letters, numbers, - and _), e.g. srikaramagu")
dest = HERE / "songs" / sys.argv[1]
if dest.exists():
    sys.exit(f"{dest} already exists")
shutil.copytree(HERE / "songs" / "_template", dest)
print(f"Created {dest}\nPut master.wav, vocal.wav, raw_video.mp4, final_export.mp4 and the photos in it,\n"
      "fill in lyrics.txt, credits.json and song.json.")
