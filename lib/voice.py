"""Where the voice is, measured on the vocal recording (fine steps of 0.05 s, so lyric screens can start and end with the singing)."""
import numpy as np
import soundfile as sf


def segments(vocal_path, hop=0.05, smooth=0.2, frac=0.25, merge_gap=0.6, min_len=0.6):
    x, sr = sf.read(str(vocal_path), dtype="float32")
    x = x.mean(1) if x.ndim > 1 else x
    h = int(sr * hop)
    n = len(x) // h
    db = 20 * np.log10(np.sqrt((x[:n * h].reshape(n, h) ** 2).mean(1)) + 1e-9)
    k = max(1, int(smooth / hop))
    db = np.convolve(db, np.ones(k) / k, "same")
    lo, hi = np.percentile(db, 20), np.percentile(db, 95)
    on = db > lo + (hi - lo) * frac
    segs, s = [], None
    for i, v in enumerate(on):
        if v and s is None:
            s = i
        if not v and s is not None:
            segs.append([s * hop, i * hop])
            s = None
    if s is not None:
        segs.append([s * hop, n * hop])
    out = []
    for a, b in segs:
        if out and a - out[-1][1] < merge_gap:
            out[-1][1] = b
        else:
            out.append([a, b])
    return [[round(a, 2), round(b, 2)] for a, b in out if b - a >= min_len]


def containing(segs, t, slack=0.3):
    for a, b in segs:
        if a - slack <= t <= b + slack:
            return a, b
    return None
