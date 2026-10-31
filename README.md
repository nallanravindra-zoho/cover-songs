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
4 Interludes and transitions, 5 Photos (and snapshots of the video), 6 Look and fonts (fonts, colours, 46 lyric animations),
7 Credits and cards, 8 Check and make. Save with the button or Cmd+S. Times are always typed and shown as min:sec.
Defaults come from the Srikaramagu video: two-line lyrics with a pink-to-turquoise gradient, closest free font match (not her confirmed font).
Fonts for the previews load from Google Fonts, so the page needs internet.

## Preview & edit (the card at the top)
Plays the song with everything the finished video gets, before anything is made: her video with its filters and motion, lyrics with
their animation, her name, the opening and end cards, and the interlude pictures with their filters, motion and transitions. Switch
between Instagram, YouTube and the reel. Every change anywhere on the page shows at once. The picture, the tools and the timeline fit
in the window; **⛶ Full screen** gives the editor the whole window.

The picture is in the middle with its play controls beside it (play, previous/next, ±5 s, one frame back/on, the clock): the settings
of what you selected on its left, the choices of the tool you picked on its right, and the "i" next to the title explains it all.
**↶ Undo / ↷ Redo** (also ⌘Z / ⇧⌘Z, and the Edit menu in the Mac app) step back and forth through every change; a drag or a burst
of typing is one step. Inside a text box ⌘Z undoes the typing as usual. Save stays a separate step (the button under the step rail).

**Tools** (one row under the picture, InShot-style; each changes what is under the playhead or what is selected):
- ✂️ **Split** cuts her video at the playhead, so each part can have its own filter and motion.
- 🎨 **Filter**: 27 looks with strength and fine adjustments, shown on the current frame, for her video's part or an interlude picture.
- 🎥 **Motion**: 14 (zooms, drifts, pulse, sway) for her video's part or a picture.
- ✨ **Lyric anim.**: 68 animations for the lyric screen under the playhead, or for every screen (fades, slides, rolls, spins, line /
  word / letter by letter, reveals, glitch, heartbeat, jelly …).
- 🔀 **Transition**: the transition nearest the playhead, 90 of them; "New ✦" has the CapCut / InShot-style ones (doors, whip, heart,
  star, bubbles, spin, twirl, film roll, flash cut, shake cut, slices …); "None (cut)" for a straight cut. It plays at once.
- 💥 **Effects** (32): Move (shake, zoom beat, glitch, heartbeat, zoom punch, dizzy, swing, earthquake, RGB shake), Light (flash, dip
  to black, B&W strobe, invert, flicker, fades from/to black and white, light leak, spotlight), Colour (rainbow, B&W fade, contrast
  pop) and Look (RGB split, dreamy blur, old film, VHS, noise, Retro DV, cinema bars, blur in/out), over a stretch of time on the whole
  picture (orange row on the timeline: drag, stretch, delete).
- 💡 **Colour ideas** for the words on the picture right now (the same as "Find ideas" in the text settings).
- 🔤 **Text**: font (tiles in the screen's own words), size, weight, outline, colours; for all lyrics or only this screen.
  ✨ **Colour ideas** are worked out from the picture behind the words (opposite colours, triads, gold, neon ..., only ones that stand
  out from it); press ♥ to keep a set: saved sets (content/palettes.json) are offered first in every song.
- ✏️ **Lyrics** / ➕ **Add lyric**: change the words, remove a screen, add one at the playhead.
- ✚ **Add text**: any text (a title, a thank-you, credits) at the playhead, on its own blue "text" row: drag it in time and stretch it
  for as long as it should show; on the picture drag it anywhere and double-click to type; its own font, colours and animation.
- 🖼️ **Pictures**: the pictures of the nearest interlude. Drag the white line between two pictures on the timeline (or type a length)
  to show one longer than the other. 🗑️ **Delete** (or the Delete key): the selected block, whatever it is.

**On the picture**: **her name** (top) shows a dashed outline when pointed at: drag it anywhere (for the whole video), click it to
change its words, script font, size and colours, or switch it off. On a **card**, each piece of text (opening: title, her name,
credits; end card: her name, the lines under it) can be dragged anywhere and clicked for its own font, size and colours; click the
card itself to change its words. The card is redrawn by the video maker's own code in a second or two. Click the words to select that screen (its text style opens on the right); double-click to type the words right on
the picture; drag them anywhere (only that screen while it is selected, otherwise all lyrics); drag her name anywhere.
**⛶** on the picture shows it full screen with play, ±5 s, previous/next and a time bar; **Editor full screen** gives the whole editor
the window.

**Timeline**: one lane per layer, named in the fixed column on the left and each in its own colour: 🎵 Song (loudness; green line =
her voice), 💥 Effects, 🅣 Text, 🎬 Video (her video's parts), 🎤 Lyrics, 🖼️ Pictures (cards and interludes). Drag lyric screens, interludes, cards, effects and the cuts in her video; drag the ends to make them longer or shorter;
double-click a lyric screen to go back to its automatic time. The diamonds under the pictures are transitions (click to change or
delete). Deleted interludes, cards and screens stay as faint outlines: click one to bring it back. Space plays and pauses; the arrow
keys step a second (Shift: a tenth). Step 4 keeps which gaps get pictures and the transition styles; there are no timing tables.

The first time, the page makes a small copy of the video for smooth playback (10 to 40 seconds; the progress shows on the picture).
How close the preview is to the video is checked automatically:
```
.venv/bin/python tools/check_preview.py                                  # every transition, filter and motion against ffmpeg
.venv/bin/python tools/check_preview_video.py <song> [instagram|youtube|reel]   # the preview against a built video (page running)
```
Measured on both songs: within 1-2 of 255 for transitions and filters, within 1-4 overall for whole frames (with a filtered,
zooming part of her video, changed, removed and restyled lyrics, effects, and two pictures in an interlude); every effect and a
straight cut were also compared once on a built reel (within 0.1-6). Her video is a little softer in the preview because it plays the
small copy; the grain of "Old film" and "VHS" is random, so it differs grain by grain.

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
.venv/bin/python tools/build_song.py songs/<song> --mode preview --output reel --from 60 --to 90   # on the command line these are seconds
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
lib/               lyrics, alignment, voice map, audio sync, pipeline, renderer, animations, transitions,
                   picture filters and motions (fx.json, fx.py, fx.js), card pictures (stills.py)
tools/             build_song.py (builds), new_song.py, make_proxy.py (preview copy), check_preview*.py (automatic checks)
ui/                the settings page (index.html) and its preview and timeline (editor.js)
docs/              plan, sample analysis, setup; CLAUDE.md at the top level is for Claude Code
```
