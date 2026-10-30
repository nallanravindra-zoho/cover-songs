# Plan (original plan, with what has since been built)

> **Status (2026-10-31):** all three phases are largely built; see README.md for how it works now. Still open: syncing is done for a separate master audio, but
> not for a raw video recorded separately from a clean mastered audio without any song in its own sound; cover image + caption export; batch weekly checklist;
> her confirmed font. Below is the original plan for reference.

Goal: each week Ravi supplies the raw files; the tool outputs the finished 9:16 video.
Her workflow: record vocal on a karaoke track -> master -> record video in one take, lip-syncing -> line the video up
to the mastered audio -> transitions between pallavi / charanams, photos in interludes, credits, lyrics -> export.

## Inputs per song (`songs/<song>/`)
final export (reference), mastered audio, vocal stem, raw video, photos, lyrics (Telugu/Hindi script, labelled parts), credits, logo (`brand/logo.png`).

## Automation, and how sure we are
| Step | Method | Confidence |
|---|---|---|
| Match raw video to master | cross-correlate the song heard in the raw video with the master; fallback = clap / one manual mark | high if the song is audible in the video |
| Sections + interludes | gaps in the vocal stem = interludes; sections from the lyrics order | high with the stem |
| Interlude photos | she picks, the tool places them with slow zoom + dissolves; faces kept in frame | high |
| Opening / end cards, logo | from `credits.json` + `brand/` | high |
| Transitions | the transition set from raaga-thoram (ffmpeg xfade) | high |
| Lyrics text | pasted, labelled, two lines at a time, house style | high |
| **Lyric line timing** | forced alignment of her typed lyrics on the voice (built, automatic), with tap-along and typed times as corrections | auto: good on tested songs, flags what it is unsure of |
| Export | 1080x1920 first; later 16:9 and a cover image + caption text | high |

## Phases
- **Phase 1 - analyse and set up (this session):** project skeleton, sample analysis, README, per-song folder + JSON config. Then, once raw files arrive: sync raw video to master, section/interlude detection, rebuild the sample as the first test.
- **Phase 2 - lyrics + visuals:** tap-along timing tool, lyric renderer (Playwright canvas -> ffmpeg), opening/end cards, interludes with photos, transitions, branding; compare against her export side by side.
- **Phase 3 - polish and weekly workflow:** local settings page with presets (stdlib server, as in raaga-thoram), assisted/auto lyric timing, extra formats, batch / checklist for the weekly run, optional reusable Claude skill.

## Reused from raaga-thoram (copied, never modified)
venv + ffmpeg compose; Playwright frame rendering; `tools/matte` Apple Vision person matte; `tools/title_reveal`; stdlib `settings.py` + `ui/index.html` with presets; per-folder JSON config; README with settings tables.

## Working rules
Large readable text; explanations behind an "i" icon; keys/notes only as names; honest reporting (audio is measured, not heard); Ravi tests on his own phone.

## Early lyrics demo (2026-10-30; the script `tools/lyric_demo.py` no longer exists, `tools/build_song.py` replaced it)
Test on a finished film video (songs/bachpan, not her cover): demucs vocal stem -> MMS forced aligner (lib/align.py, gated to where the
vocal stem has sound, one-word fillers ignored for timing) = Version A; faster-whisper medium with a Hindi prompt (lib/transcribe.py) = Version B;
interludes = gaps of 6 s or more between lyric screens, filled with placeholder pictures; rendered by lib/render.py (Chrome PNGs + ffmpeg);
side by side in songs/bachpan/out/side_by_side.mp4. Measured, not heard. Needs: torch 2.2.2, numpy<2, demucs==4.0.1 (--no-deps), faster-whisper.
Findings: A is good on lines with score >= 0.3 and flags the rest; B is usable only for the first lines, then drifts into English.
