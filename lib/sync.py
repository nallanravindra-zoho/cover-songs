"""Line up a separate audio file (the mastered song) with the video's own sound.

offset(ref, video) returns (seconds, confidence): a moment at t in the reference audio is at t + seconds in the video.
Both sounds are reduced to a loudness picture in 16 frequency bands (100 frames a second) and slid against each other, so it works
even when the video only has the song faintly through a room microphone.
"""
import subprocess
import numpy as np
from scipy.signal import fftconvolve

SR = 8000
HOP = 80          # 10 ms
NB = 16


def load(path, seconds=None):
    cmd = ["ffmpeg", "-v", "error"] + (["-t", str(seconds)] if seconds else []) + ["-i", str(path), "-vn", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"]
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)


def bands(x):
    n = (len(x) - 256) // HOP
    idx = np.arange(256)[None, :] + HOP * np.arange(n)[:, None]
    sp = np.abs(np.fft.rfft(x[idx] * np.hanning(256), axis=1))[:, 2:128]
    edges = np.unique(np.round(np.geomspace(1, sp.shape[1], NB + 1)).astype(int)) - 1
    b = np.stack([sp[:, a:max(a + 1, c)].mean(1) for a, c in zip(edges[:-1], edges[1:])], 1)
    b = np.log(b + 1e-4)
    b -= b.mean(0)
    return b / (b.std(0) + 1e-6)


def offset(ref_path, video_path, video_audio=None):
    """video_audio: an already extracted 8 kHz float array of the video's sound (cached by the caller), else it is read now."""
    a = bands(load(ref_path))
    v = bands(video_audio if video_audio is not None else load(video_path))
    n = len(a) + len(v)
    c = sum(fftconvolve(v[:, k], a[::-1, k], mode="full") for k in range(a.shape[1]))
    lag = np.arange(len(c)) - (len(a) - 1)                   # frames: video index = ref index + lag
    i = int(np.argmax(c))
    peak = c[i]
    mask = np.abs(lag - lag[i]) > 100                         # everything more than a second away from the peak
    conf = float((peak - c[mask].mean()) / (c[mask].std() + 1e-9))
    return lag[i] * HOP / SR, conf
