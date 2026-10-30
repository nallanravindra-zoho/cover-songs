"""Write the lyrics from the audio itself (Whisper, via faster-whisper).

    .venv/bin/python lib/transcribe.py vocals.wav out.json [--lang hi]
Returns {"segments": [{"text", "start", "end"}]}. For sung Hindi/Telugu over music expect wrong words: the point of this
output is to compare it with the lyrics a person provides.
"""
import json, sys
from pathlib import Path
import subprocess
import numpy as np
from faster_whisper import WhisperModel

args = [a for a in sys.argv[1:] if not a.startswith("--")]
lang = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "hi"
if "--lang" in sys.argv:
    args.remove(lang)
PROMPT = {"hi": "यह एक पुराना हिंदी गाना है।", "te": "ఇది ఒక పాత తెలుగు పాట."}
m = WhisperModel("medium", device="cpu", compute_type="int8")
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", args[0], "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
audio = np.frombuffer(raw, np.float32)
segs, info = m.transcribe(audio, language=lang, task="transcribe", vad_filter=True, beam_size=5, condition_on_previous_text=False,
                          word_timestamps=True, initial_prompt=PROMPT.get(lang))
out = [{"text": s.text.strip(), "start": round(s.start, 2), "end": round(s.end, 2),
        "words": [{"w": w.word.strip(), "start": round(w.start, 2), "end": round(w.end, 2)} for w in (s.words or [])]} for s in segs]
Path(args[1]).write_text(json.dumps({"segments": out, "language": info.language}, indent=1, ensure_ascii=False), encoding="utf-8")
for s in out:
    print(f"{s['start']:>7} {s['end']:>7}  {s['text']}")
