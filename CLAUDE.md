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
- `ui/index.html`    the page (plain JS; the preview card's code is in `ui/editor.js`). Steps are collapsible cards; summaries/progress panel at the top.
- `lib/lyrics.py`    lyrics text -> screens ([label] blocks, [order], [Aalap] blocks, long-line and comma splitting).
- `lib/align.py`     forced alignment with torchaudio MMS_FA (romanised with uroman). `lib/voice.py` voice-activity map.
- `lib/sync.py`      finds where a separate master audio sits inside the video's sound (spectral cross-correlation).
- `lib/pipeline.py`  the build: voice source (vocal > master > video) + `sync_info` offset, placement, warnings, gaps/interludes, outputs, `compose`.
                     Lyrics `[Aalap]` blocks are timed from the voice (star token in the aligner), not matched to words.
- `lib/render.py`    Chrome (Playwright) draws text/cards to PNG, ffmpeg composes; `lib/anim.js` text animations (shared with the page);
                     `lib/trans.py` extra xfade transitions as expressions.
- `lib/fx.json|fx.py|fx.js` picture filters (one colour formula, same maths in Python and JS) and motions (zoompan in the build,
                     WebGL in the preview); fx.js also has every xfade transition ported from ffmpeg 7.1's vf_xfade.c and lib/trans.py.
- `lib/stills.py`    cards, her name, default and YouTube-panel pictures: one function for the builder and the preview (/api/still).
- `ui/editor.js`     "Preview & edit" card: plays work/proxy_*.mp4 (tools/make_proxy.py) with the server's plan (/api/plan =
                     pipeline.output_plan, the same plan build_output renders); drag timeline; interlude pictures panel.
- `songs/<song>/`    `song.json`, `lyrics.txt`, `credits.json` (tracked); media, `work/`, `out/`, `snapshots/` (ignored).
                     An interlude's pictures: `interludes[i].pictures = [{photo, filter, amount, adjust, motion, trans, trans_seconds}]`.
                     Lyric edits: `screen_text{i: lines}`, `screen_off{i: true}`, `added_screens[{start,end,lines,anim}]` (ids "a0".. ),
                     `screen_anim{i: effect}`; her video: `video_clips{cuts: [s], fx: [{filter, amount, adjust, motion}] per part}`
                     (pipeline.edited_screens / video_clips; render.video_fx_chain: lut3d, gblur, zoompan, vignette, noise per part).
- `content/presets/` saved looks. `brand/` her logo (ignored, upload again on a new machine).

## Rules learned the hard way
- Placement times are in the video's timeline: voice source time + sync offset. Screens whose lines are sung > 4 s apart are split,
  and no lyric screen may span a long silence (that silence is an interlude).
- Interludes = instrumental gaps longer than `interlude_min_seconds`; each gap can be forced Yes/No in the page.
- ffmpeg `xfade` custom expressions must sample planes (`a0/a1/a2`); `lib/trans.py` expands `A()`/`B()`.
- torch 2.2.2 needs `numpy<2`; scipy pinned `<1.14`; demucs 4.0.1 is installed `--no-deps`.
- After changing Python code, restart the server (`pkill -f settings.py; .venv/bin/python settings.py`); ui/*.js and index.html
  are read on every page load (a reload is enough). Ask before restarting while Ravi is using the page: a restart stops a running
  job (snapshots delete the old ones first, so a stopped run leaves none).
- Card backgrounds are cached per video (`frame_<sig>.jpg`); a preview range that excludes a card is logged, not an error.
- The video can be very large (1.5 GB): never decode it whole; seek with `-ss` before `-i`, and take audio from the master when there is one.
- Test on both songs in `songs/` (a Hindi and a Telugu one); a fix tested on only one has broken the other before.
- The preview must match the video: after touching transitions, filters, motions, cards or the plan, run `tools/check_preview.py`
  and `tools/check_preview_video.py <song> <output>` (page running). Timing lives only in `pipeline.output_plan`; never re-derive it in JS.
- xfade's progress P runs 1 -> 0 (custom expressions too). Custom expressions must not use st()/ld(): xfade runs them on several
  threads sharing that memory, so the video changed on every run (`trans.inline_registers` writes them out).
- ffmpeg's fadeblack/fadewhite fade to luma 0/255 (beyond video black/white); distance/fadefast/fadeslow work on YUV planes.
- Her phone videos are HDR (HLG, BT.2020) and the builder does not tone-map: the preview copy is marked SDR with the same values, and
  the preview loads pictures without colour management (snapshots carry HDR cICP tags), so it shows what the video really gets.
- `pipeline.sig()` resolves paths: a song named as songs/x or by its full path shares the same caches.

## Common commands
```
bash scripts/setup.sh                      # new machine
.venv/bin/python settings.py               # the page, http://127.0.0.1:8766
.venv/bin/python tools/build_song.py songs/<song> --mode align
.venv/bin/python tools/build_song.py songs/<song> --mode preview --output reel --from 60 --to 90
.venv/bin/python tools/build_song.py songs/<song> --mode final
.venv/bin/python tools/check_preview.py                        # preview vs ffmpeg: transitions, filters, motions
.venv/bin/python tools/check_preview_video.py <song> instagram   # preview vs a built video (page running)
```
