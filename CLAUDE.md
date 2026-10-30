# Cover Songs: notes for Claude Code (read this first)

Turns the raw files of one cover song (Telugu or Hindi, sung by Soujanya Madabhushi) into finished videos: lyrics placed on her voice,
opening and end cards, interlude pictures, transitions, text animations, three outputs (Instagram 9:16, YouTube side by side, 1-minute reel).
A local settings page (`settings.py`, port 8766) drives everything. Owner: Ravi (not the singer). Read `README.md` and `docs/SETUP.md` too.

## How to work with this user
- Large readable text; explanations behind an "i" icon in the page; times always shown as min:sec (never 150.8).
- Be honest: you cannot hear audio, only measure it; say what was tested and what was not. The user tests on their own phone.
- A tool should not need correcting: when a miss is found, fix the cause and add an automatic check (see `auto_times` warnings), not just the one case.
- Never commit media (videos, audio, photos, snapshots, `work/`, `out/`), venvs, or the 1.2 GB model caches. `.gitignore` covers them.
- Do not commit or push unless asked.

## Layout
- `settings.py`      stdlib HTTP server + JSON API for the page; starts builds as subprocesses (`tools/build_song.py`).
- `ui/index.html`    the whole page (one file, plain JS). Steps are collapsible cards; summaries/progress panel at the top.
- `lib/lyrics.py`    lyrics text -> screens ([label] blocks, [order], [Aalap] blocks, long-line and comma splitting).
- `lib/align.py`     forced alignment with torchaudio MMS_FA (romanised with uroman). `lib/voice.py` voice-activity map.
- `lib/sync.py`      finds where a separate master audio sits inside the video's sound (spectral cross-correlation).
- `lib/pipeline.py`  the build: voice source (vocal > master > video), placement, warnings, gaps/interludes, outputs, `compose` call.
- `lib/render.py`    Chrome (Playwright) draws text/cards to PNG, ffmpeg composes; `lib/anim.js` text animations (shared with the page);
                     `lib/trans.py` extra xfade transitions as expressions.
- `songs/<song>/`    `song.json`, `lyrics.txt`, `credits.json` (tracked); media, `work/`, `out/`, `snapshots/` (ignored).
- `content/presets/` saved looks. `brand/` her logo (ignored, upload again on a new machine).

## Rules learned the hard way
- Placement times are in the video's timeline: voice source time + sync offset. Screens whose lines are sung > 4 s apart are split,
  and no lyric screen may span a long silence (that silence is an interlude).
- Interludes = instrumental gaps longer than `interlude_min_seconds`; each gap can be forced Yes/No in the page.
- ffmpeg `xfade` custom expressions must sample planes (`a0/a1/a2`); `lib/trans.py` expands `A()`/`B()`.
- torch 2.2.2 needs `numpy<2`; scipy pinned `<1.14`; demucs 4.0.1 is installed `--no-deps`.
- After changing settings/page code, restart the server (`pkill -f settings.py; .venv/bin/python settings.py`).
- Test on both songs in `songs/` (a Hindi and a Telugu one); a fix tested on only one has broken the other before.

## Common commands
```
bash scripts/setup.sh                      # new machine
.venv/bin/python settings.py               # the page, http://127.0.0.1:8766
.venv/bin/python tools/build_song.py songs/<song> --mode align
.venv/bin/python tools/build_song.py songs/<song> --mode preview --output reel --from 60 --to 90
.venv/bin/python tools/build_song.py songs/<song> --mode final
```
