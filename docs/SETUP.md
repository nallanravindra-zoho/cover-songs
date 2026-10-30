# Setting up on another computer or Claude account

1. **Get the code:** `git clone https://github.com/nallanravindra-zoho/cover-songs.git` and open the folder in Claude Code.
   (Claude Code reads `CLAUDE.md` automatically, so a new account/session starts with the full picture.)
2. **Install the tools (macOS):**
   ```
   brew install ffmpeg            # video and audio
   # Google Chrome must be installed (the text is drawn with it)
   bash scripts/setup.sh          # makes .venv and installs everything
   ```
3. **Run:** `.venv/bin/python settings.py` and open http://127.0.0.1:8766.
4. **First build downloads models** into `~/.cache` (about 1.2 GB for the lyric aligner, plus the voice-separation model, ~80 MB).
   Needs internet once; the page also loads fonts from Google Fonts for its previews.

## What is NOT in git (bring or recreate)
| Thing | Why | What to do |
|---|---|---|
| Videos, audio, photos, snapshots, `out/`, `work/` | large, private | upload again in the page (Files step) |
| `brand/logo.jpg` | her brand picture | upload in the Files step |
| `.venv/` and model caches | machine specific | `scripts/setup.sh` |

Songs' `song.json`, `lyrics.txt` and `credits.json` are in git, so a cloned repo shows the songs; upload their video/audio to rebuild them.

## Using a different GitHub account
```
git remote set-url origin https://github.com/<other-account>/cover-songs.git
git push -u origin main
```
or make a fork. For pushing, sign in with `gh auth login` (or a personal access token) as that account.
