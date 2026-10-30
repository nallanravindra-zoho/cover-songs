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
Opens http://127.0.0.1:8766 (only on your own computer). Steps on the page: Song and saved looks, Files (upload / drag and drop),
Lyrics, Timings (waveform, tap-along lyric timing, parts and interludes), Photos, Look and fonts (live previews of the lyric,
opening and end cards), Transitions (playable samples), Credits, Check. Click **Save** (or Cmd+S).
Defaults come from the Srikaramagu video: two-line white lyrics with a pink and turquoise glow in Noto Sans Telugu (closest free
match, not her confirmed font), green script end card. Fonts for the previews load from Google Fonts, so the page needs internet.

## Building a video (hybrid: automatic times, you correct)
On the settings page: step 4 **Auto-place lyrics from the voice** (finds her voice in the vocal recording, or separates it from the video's sound,
places each lyric line, and starts/ends each screen with the voice). Grey numbers are automatic; type a number to override one. Step 9 builds a
**preview** of any seconds range, or the **final** video. Same thing from the terminal:
```
.venv/bin/python tools/build_song.py songs/bachpan --mode align
.venv/bin/python tools/build_song.py songs/bachpan --mode preview --from 28 --to 75
.venv/bin/python tools/build_song.py songs/bachpan --mode final
```
Three videos, each with its own settings (step 8 on the page, or `--output instagram|youtube|reel|all`): Instagram / Facebook 9:16,
YouTube side by side (blurred text panel left, her video right, matching her YouTube upload), and a 1-minute 9:16 reel for stories / WhatsApp.
Files land in `songs/<song>/out/<output>_<preview|final>.mp4`.

Text animations for the lyrics (46: fades, slides, line/word/letter by letter, reveals, glitch, neon flicker; `lib/anim.js`, shared by the renderer and the page's live tiles) and 15 extra trending transitions made with ffmpeg xfade expressions (`lib/trans.py`: glitch rows/blocks, mosaic, whip pans, zoom through, flash, ripple, diamond, blinds, checkerboard, bar slide) are chosen in the page (step 6 and step 4).

Built: lyrics, her name, interlude photos (only for instrumental gaps longer than a setting, default 15 s) with 57 transition styles.
Not built yet: opening card, end card, syncing a separate raw video to the mastered audio.

## Each song
1. `.venv/bin/python tools/new_song.py srikaramagu` makes `songs/srikaramagu/` from `songs/_template/`.
2. Put the raw files in it (names in `song.json`):

| File | What it is |
|---|---|
| `master.wav` | the mastered song audio |
| `vocal.wav` | her separate voice recording |
| `raw_video.mp4` | her one-take video |
| `final_export.mp4` | last time's finished video, only for comparing (optional) |
| `photos/` | the interlude pictures |
| `lyrics.txt` | lyrics in Telugu/Hindi script, a `[label]` line before each part |
| `credits.json` | original song credits, her end card, caption and hashtags |
| `../../brand/logo.png` | her handwritten logo (once, shared by all songs) |

3. Fill in `song.json`, `lyrics.txt`, `credits.json`.
4. (Phase 2) build commands will appear here.

Media, venvs and `out/` folders are git-ignored; only configs and code are tracked.

## Layout
```
songs/<song>/      raw files + song.json, lyrics.txt, credits.json  (out/ = builds)
songs/_template/   copied by tools/new_song.py
brand/             logo and other small shared brand files
content/           shared assets (fonts, transitions)  - media ignored
lib/               audio sync, sections, lyrics helpers (Phase 1-2)
tools/             new_song.py, later: matte, title_reveal (copied from raaga-thoram), tap-along
ui/                settings page (Phase 3)
docs/              plan and sample analysis
```
