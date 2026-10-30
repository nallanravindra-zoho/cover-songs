#!/usr/bin/env bash
# One-time setup on a new Mac:  bash scripts/setup.sh
set -e
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: brew install ffmpeg"; exit 1; }
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt
# demucs 4.0.1 without its dependency list: a newer dependency (sphn) does not build on macOS and is not needed
.venv/bin/python -m pip install --no-deps demucs==4.0.1
# Playwright uses your installed Google Chrome; this only adds a fallback browser
.venv/bin/python -m playwright install chromium || true
echo
echo "Done. Start the settings page with:  .venv/bin/python settings.py"
