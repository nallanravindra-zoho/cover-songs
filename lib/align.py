"""Place known lyrics on a vocal recording (forced alignment with Meta's MMS multilingual aligner).

    .venv/bin/python lib/align.py lyrics.txt vocals.wav out.json [--lang hin]
Writes {"lines": [{"text", "start", "end", "words": n}], "seconds": total}. Times are measured from the audio, nothing is heard by me:
lines the aligner could barely match have a low "score" and should be checked.
"""
import json, re, subprocess, sys, tempfile
from pathlib import Path
import numpy as np
import torch
import torchaudio
from torchaudio.pipelines import MMS_FA as bundle
import uroman

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lyrics as ly


def load16k(path):
    tmp = Path(tempfile.mkdtemp()) / "a.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-ac", "1", "-ar", "16000", str(tmp)], check=True)
    import soundfile as sf
    x, sr = sf.read(str(tmp), dtype="float32")
    return torch.from_numpy(x)[None, :]


def romanize(text, lang):
    u = uroman.Uroman()
    words = []
    for w in text.replace(",", " ").split():
        r = re.sub(r"[^a-z']", "", u.romanize_string(w, lcode=lang).lower())
        if r:
            words.append(r)
    return words


def emissions(model, wav, chunk=30.0, pad=2.0):
    """Run the model in overlapping chunks (memory) and stitch the frames."""
    sr, n = 16000, wav.shape[1]
    step = int(chunk * sr)
    outs, frame_s = [], None
    with torch.inference_mode():
        for s in range(0, n, step):
            a, b = max(0, s - int(pad * sr)), min(n, s + step + int(pad * sr))
            em, _ = model(wav[:, a:b])
            em = torch.log_softmax(em, dim=-1)
            fr = (b - a) / sr / em.shape[1]
            frame_s = fr
            lo = int(round((s - a) / sr / fr))
            hi = em.shape[1] - int(round((b - min(n, s + step)) / sr / fr))
            outs.append(em[:, lo:hi])
    return torch.cat(outs, dim=1), frame_s


def vocal_activity(wav, frames, frame_s, win=0.25, grow=0.4, min_run=4.0):
    """True per emission frame where the vocal stem has real sound (energy well above its quiet level)."""
    x = wav[0].numpy()
    h = int(16000 * win)
    n = len(x) // h
    db = 20 * np.log10(np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1)) + 1e-9)
    lo, hi = np.percentile(db, 30), np.percentile(db, 95)
    on = db > lo + (hi - lo) * 0.35
    k = int(grow / win)
    on = np.convolve(on.astype(float), np.ones(2 * k + 1), "same") > 0
    i = 0
    while i < len(on):                         # sound that lasts under min_run seconds is a hum or leak, not a sung line
        if on[i]:
            j = i
            while j < len(on) and on[j]:
                j += 1
            if (j - i) * win < min_run:
                on[i:j] = False
            i = j
        else:
            i += 1
    t = np.arange(frames) * frame_s
    return on[np.minimum((t / win).astype(int), n - 1)]


def align(lyrics_path, audio_path, lang="hin", gate=True):
    text = Path(lyrics_path).read_text(encoding="utf-8")
    _, flat = ly.screens(text)
    wav = load16k(audio_path)
    model = bundle.get_model(with_star=False)
    tok, aligner = bundle.get_tokenizer(), bundle.get_aligner()
    em, fr = emissions(model, wav)
    if gate:                                   # outside vocal sound the only allowed symbol is "blank"
        off = torch.from_numpy(~vocal_activity(wav, em.shape[1], fr))
        em = em.clone()
        em[0, off, 1:] = -20.0
        em[0, off, 0] = 0.0
    words_per_line = [romanize(l, lang) for l in flat]
    words = [w for ws in words_per_line for w in ws]
    spans = aligner(em[0], tok(words))
    res, k = [], 0
    for text_line, ws in zip(flat, words_per_line):
        if not ws:
            res.append({"text": text_line, "start": None, "end": None, "words": 0, "score": 0})
            continue
        sp = spans[k:k + len(ws)]
        k += len(ws)
        st, en = sp[0][0].start * fr, sp[-1][-1].end * fr
        score = float(np.mean([s.score for w in sp for s in w]))
        res.append({"text": text_line, "start": round(st, 2), "end": round(en, 2), "words": len(ws), "score": round(score, 3)})
    return {"lines": res, "seconds": wav.shape[1] / 16000}


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    lang = sys.argv[sys.argv.index("--lang") + 1] if "--lang" in sys.argv else "hin"
    if "--lang" in sys.argv:
        args.remove(lang)
    r = align(args[0], args[1], lang, gate="--nogate" not in sys.argv)
    Path(args[2]).write_text(json.dumps(r, indent=1, ensure_ascii=False), encoding="utf-8")
    for l in r["lines"]:
        print(f"{l['start']!s:>7} {l['end']!s:>7}  s={l['score']:.2f}  {l['text']}")
