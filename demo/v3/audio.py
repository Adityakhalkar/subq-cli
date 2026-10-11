# Soundtrack for v3.html from events.json. 120 bpm, D minor. Drop a music.mp3/.wav/.m4a next to this file to use
# your own track as the bed instead of the synthesized one; the sound effects are laid on top either way.
import json, os, subprocess, numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile
SR, LEN = 44100, 58.0
N = int(SR * LEN); rng = np.random.default_rng(11)
bus = {k: np.zeros((N, 2)) for k in ("drums", "bass", "keys", "sfx")}
tt = lambda d: np.arange(int(SR * d)) / SR
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
filt = lambda x, kind, f, order=2: sosfilt(butter(order, f, kind, fs=SR, output="sos"), x)
def put(name, t, sig, gain=1.0, pan=0.0):
    i = int(t * SR)
    if not 0 <= i < N: return
    sig = sig[: N - i] * gain
    bus[name][i:i + len(sig), 0] += sig * (1 - max(0, pan)); bus[name][i:i + len(sig), 1] += sig * (1 + min(0, pan))
def kick(): x = tt(.35); return np.sin(2 * np.pi * np.cumsum(46 + 90 * np.exp(-x * 34)) / SR) * np.exp(-x * 9)
def hat(d=60): x = tt(.06); return filt(rng.standard_normal(len(x)), "band", [6000, 11000]) * np.exp(-x * d)
def snap(): x = tt(.16); return filt(rng.standard_normal(len(x)), "band", [1400, 3600]) * np.exp(-x * 32)
def ep(m, d=1.6):  # soft electric piano: sine plus a bell partial
    x = tt(d); f = hz(m)
    return (np.sin(2 * np.pi * f * x + .6 * np.sin(2 * np.pi * f * x) * np.exp(-x * 3)) * np.exp(-x * 2.2) + .12 * np.sin(2 * np.pi * 4 * f * x) * np.exp(-x * 12)) * np.minimum(1, x * 250)
def bassnote(m, d=.26): x = tt(d); f = hz(m); return (np.sin(2 * np.pi * f * x) + .25 * np.sin(4 * np.pi * f * x)) * np.minimum(1, x * 200) * np.exp(-x * 5)
def blip(f0, f1, d=.1, decay=35): x = tt(d); return np.sin(2 * np.pi * np.cumsum(np.linspace(f0, f1, len(x))) / SR) * np.exp(-x * decay) * np.minimum(1, x * 600)
def swell(d, lo, hi, shape=2): x = tt(d); return filt(rng.standard_normal(len(x)), "band", [lo, hi]) * np.sin(np.pi * x / d) ** shape
def riser(d): x = tt(d); return filt(rng.standard_normal(len(x)), "band", [1500, 7000]) * (x / d) ** 2.5
def thump(f=50, d=.7): x = tt(d); return np.sin(2 * np.pi * np.cumsum(f + 50 * np.exp(-x * 30)) / SR) * np.exp(-x * 6)
CH = [(38, [62, 65, 69, 72]), (34, [58, 62, 65, 69]), (41, [60, 65, 69, 72]), (36, [60, 64, 67, 71])]  # Dm7 Bbmaj7 Fmaj C
SCALE = [62, 64, 65, 67, 69, 72, 74, 76, 77, 79, 81, 84]

ext = next((f for f in ("music.mp3", "music.wav", "music.m4a") if os.path.exists(f)), None)
def chordbar(t, root, tri, level, full):
    for i, m in enumerate(tri): put("keys", t + i * .012, ep(m, 2.2), level, (i - 1.5) * .25)
    for i in range(8):
        if full or i in (0, 3, 6): put("bass", t + i * .25, bassnote(root + (12 if i in (3, 6) else 0)), .5)
        if full: put("keys", t + i * .25, ep(tri[[0, 2, 1, 3, 2, 1, 3, 2][i]] + 12, .5), .1, .4 if i % 2 else -.4)
    for b in range(4):
        put("drums", t + b * .5, kick(), .8 if full else .45)
        if full:
            put("drums", t + b * .5 + .25, hat(), .1)
            if b % 2: put("drums", t + b * .5, snap(), .22)
if not ext:
    put("keys", 4.5, sum(ep(m, 3.4) for m in [50, 62, 65, 69]) , .3)
    for k, bar in enumerate(np.arange(8, 18, 2)): chordbar(bar, *CH[k % 4], .2, False)
    for m in [48, 60, 64, 67]: put("keys", 18, ep(m, 2), .2)
    for k, bar in enumerate(np.arange(20, 46, 2)): chordbar(bar, *CH[k % 4], .2, True)
    for k, bar in enumerate(np.arange(46, 52, 2)):
        for i, m in enumerate(CH[k % 4][1]): put("keys", bar + i * .5, ep(m + 12, 1.6), .2, (-1) ** i * .4)
        put("bass", bar, bassnote(CH[k % 4][0], 1.6), .4)
    for i, m in enumerate([38, 50, 62, 66, 69, 74]): put("keys", 52 + i * .03, ep(m, 5), .3, (i - 2.5) * .2)
    put("drums", 52, kick(), .9); put("drums", 20, kick(), .9)
for e in json.load(open("events.json")):
    t, k, v = e["t"], e["k"], e.get("v")
    if k == "key": x = tt(.01); put("sfx", t, filt(rng.standard_normal(len(x)), "band", [1200, 3800]) * np.exp(-x * 450), .07 + .03 * rng.random(), rng.uniform(-.25, .25))
    elif k == "flutter":   # pages riffling, faster and faster
        for i in range(70): put("sfx", t + v * (i / 70) ** .55, swell(.03, 2500, 9000, 1), .05 + .08 * i / 70, rng.uniform(-.6, .6))
    elif k == "big": put("sfx", t, thump(44, 1.2), .9); put("sfx", t, swell(.5, 200, 3000, 1) * np.exp(-tt(.5) * 6), .25)
    elif k == "pop": put("sfx", t, blip(880, 1175), .2)
    elif k == "sq": put("keys", t, ep(SCALE[v] + 12, .6), .2, (v - 5.5) / 8)
    elif k == "grow": put("sfx", t, blip(300, 900, .55, 4) * np.sin(np.pi * tt(.55) / .55), .12)
    elif k == "yes": put("keys", t, ep(86, .6), .18, .2)
    elif k == "no": put("keys", t, ep(62, .4), .14, -.2)
    elif k == "tick": put("sfx", t, blip(1400, 1400, .04, 90), .12)
    elif k == "whoosh": put("sfx", t - .3, swell(.6, 500, 5000), .16)
    elif k == "swish": put("sfx", t, swell(.75, 900, 7000), .14)
    elif k == "thump": put("sfx", t, thump(50, .6), .9)
    elif k == "drop": put("sfx", t - 2, riser(2), .22)
    elif k == "roll":
        for i in range(int(v / .125)): put("keys", t + i * .125, ep(SCALE[i % 12] + 12, .3), .07 + .002 * i, np.sin(i) * .5)
    elif k == "final": put("sfx", t - 2, riser(2), .25); put("sfx", t, thump(42, 1.4), .9)
# room: one shared reverb, then gentle ducking under the kick
x = tt(1.6); ir = filt(rng.standard_normal((len(x), 2)).T, "low", 4500).T * np.exp(-x * 3.2)[:, None]; ir /= np.abs(ir).sum(0)
dry = bus["keys"] + bus["sfx"] * .8
wet = np.stack([fftconvolve(dry[:, c], ir[:, c])[:N] for c in (0, 1)], 1)
mix = bus["drums"] * .75 + bus["bass"] * .55 + bus["keys"] + bus["sfx"] + wet * 2.2
if ext:
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", ext, "-ar", str(SR), "-ac", "2", "-t", str(LEN), "_music.wav"], check=True)
    m = wavfile.read("_music.wav")[1].astype(float) / 32768; m = np.pad(m, ((0, max(0, N - len(m))), (0, 0)))[:N]
    mix += m / max(1e-9, np.abs(m).max()) * .7; os.remove("_music.wav")
peak = np.abs(mix).max(); mix = mix / peak
mix = np.sign(mix) * (1 - np.exp(-2.2 * np.abs(mix))) / (1 - np.exp(-2.2))   # soft limiter
mix *= (np.minimum(1, (LEN - np.arange(N) / SR) / 2) * .9)[:, None]
wavfile.write("audio.wav", SR, (mix * 32767).astype(np.int16)); print("music:", ext or "synthesized", "| rms", round(float(np.sqrt((mix ** 2).mean())), 3))
