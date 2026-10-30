# Cover Songs

Turns the weekly raw files for one of Soujanya's Telugu/Hindi cover songs into a finished vertical (9:16) Instagram video:
her video lined up to the mastered audio, synced two-line lyrics, opening credits card, interludes with photos,
transitions, her logo, and an end card, all in one consistent look.

Status: working. Lyrics are placed on her voice automatically, with opening/end cards, interlude pictures, transitions, text animations and three outputs (Instagram, YouTube, 1-minute reel). See `CLAUDE.md` (for Claude Code), `docs/SETUP.md` (new machine / account) and `docs/PLAN.md`.

## One-time setup
```
cd cover-songs
bash scripts/setup.sh
```
Needs ffmpeg (`brew install ffmpeg`) and Google Chrome. Details: `docs/SETUP.md`.

## Settings page (no need to edit JSON)
```
.venv/bin/python settings.py
```
Opens http://127.0.0.1:8766 (only on your own computer). A "What is happening" panel at the top shows what is in, and what the tool is doing.
Steps (each a collapsible card with a one-line summary): 1 Song and saved looks, 2 **Lyrics**, 3 **Files** (upload / drag and drop),
4 Timings and transitions, 5 Photos (and snapshots of the video), 6 Look and fonts (fonts, colours, 46 lyric animations),
7 Credits and cards, 8 Check and make. Save with the button or Cmd+S. Times are always typed and shown as min:sec.
Defaults come from the Srikaramagu video: two-line lyrics with a pink-to-turquoise gradient, closest free font match (not her confirmed font).
Fonts for the previews load from Google Fonts, so the page needs internet.

## How a video is made
1. **Lyrics first** (step 2), then **files** (step 3). Needed: the lyrics and a video. Optional: mastered audio (recommended for a long video) and her vocal file.
2. **Placement is automatic** once both are in (switch off with the checkbox in the status panel). Her voice is taken from, in order: her vocal file,
   the mastered audio, the video's own sound. If the voice comes from the master, its position inside the video is found by comparing the sounds
   (`lib/sync.py`), and the master becomes the finished video's sound.
3. Each lyric line is placed on the voice (torchaudio MMS forced aligner). Screens start and end with the singing. A **"Worth a look"** box lists anything
   suspicious (screens that stay up too long, lines hard to match). Grey numbers in step 4 are automatic; type over any to correct it.
4. **Interludes** are instrumental gaps longer than a setting (default 8 s); each gap can be forced Yes/No, with its own picture and transitions.
   Opening card (original credits) and end card (her name, credits) are built from step 7.
5. **Step 8** makes the videos: Instagram / Facebook 9:16, YouTube side by side, and a 1-minute reel, each with its own settings. A preview covers only the
   seconds you choose (a card outside that range is not shown; the log says so); "final" makes the whole video.

Same from the terminal:
```
.venv/bin/python tools/build_song.py songs/<song> --mode align
.venv/bin/python tools/build_song.py songs/<song> --mode preview --output reel --from 1:00 --to 1:30   # seconds, e.g. 60 and 90
.venv/bin/python tools/build_song.py songs/<song> --mode final --output all
```
Files land in `songs/<song>/out/<output>_<preview|final>.mp4`.

### Lyrics file format
```
[Aalap]            # sung without words: shown as written, timed from where the voice is heard
ఓ...ఓ...

[pallavi]
line one
line two

[charanam 1]
...

[order]
Aalap, pallavi, charanam 1, pallavi, Aalap
```
Write a repeated part once and list it again in `[order]`. A long line gets its own two-line screen.

## Each song
1. Make it in the page (**+ New song**) or `.venv/bin/python tools/new_song.py <name>`.
2. Add lyrics, then files (names in `song.json`): `master`, `vocal`, `raw_video`, `final_export` (optional, to compare), photos, `brand/logo.*` (once).
3. Fill in `credits.json` in step 7. Media, venvs, `out/`, `work/` and `snapshots/` are git-ignored; only configs and code are tracked.

## Layout
```
songs/<song>/      raw files + song.json, lyrics.txt, credits.json  (out/ = builds)
songs/_template/   copied by tools/new_song.py
brand/             logo and other small shared brand files
content/           saved looks (presets)
lib/               lyrics, alignment, voice map, audio sync, pipeline, renderer, animations, transitions
tools/             build_song.py (builds), new_song.py
ui/                the settings page (one HTML file)
docs/              plan, sample analysis, setup; CLAUDE.md at the top level is for Claude Code
```
