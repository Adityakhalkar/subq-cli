# Synthesizes the soundtrack and sound effects from events.json (written by render.mjs). 120 bpm, D minor.
import json, numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile
SR, LEN = 44100, 47.0
N = int(SR * LEN)
rng = np.random.default_rng(7)
bus = {k: np.zeros((N, 2)) for k in ("drums", "bass", "pluck", "pad", "sfx")}
tt = lambda d: np.arange(int(SR * d)) / SR
def put(name, t, sig, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    sig = sig[: N - i] * gain
    bus[name][i:i + len(sig), 0] += sig * (1 - max(0, pan))
    bus[name][i:i + len(sig), 1] += sig * (1 + min(0, pan))
def filt(x, kind, f, order=2): return sosfilt(butter(order, f, kind, fs=SR, output="sos"), x)
hz = lambda midi: 440 * 2 ** ((midi - 69) / 12)

def kick():
    x = tt(.32); f = 45 + 110 * np.exp(-x * 38)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-x * 11) + .25 * filt(rng.standard_normal(len(x)), "high", 2500) * np.exp(-x * 300)
def hat(d=45): x = tt(.08); return filt(rng.standard_normal(len(x)), "high", 7500) * np.exp(-x * d)
def clap(): x = tt(.22); return filt(rng.standard_normal(len(x)), "band", [1100, 4200]) * (np.exp(-x * 26) + .5 * np.exp(-((x - .012) * 400) ** 2))
def crash(): x = tt(3.5); return filt(rng.standard_normal(len(x)), "high", 5000) * np.exp(-x * 1.6)
def pluck(m, d=.9):
    x = tt(d); f = hz(m)
    return (np.sin(2 * np.pi * f * x) * np.exp(-x * 5) + .45 * np.sin(2 * np.pi * 2 * f * x) * np.exp(-x * 9) + .2 * np.sin(2 * np.pi * 4.01 * f * x) * np.exp(-x * 16)) * np.minimum(1, x * 400)
def bassnote(m, d=.24):
    x = tt(d); f = hz(m); s = np.sin(2 * np.pi * f * x) + .35 * np.sin(2 * np.pi * 2 * f * x) + .15 * np.sin(2 * np.pi * 3 * f * x)
    return s * np.minimum(1, x * 300) * np.exp(-x * 6)
def pad(notes, d, attack=.6):
    x = tt(d); s = np.zeros(len(x))
    for m in notes:
        for det in (-.07, 0, .07): s += 2 * ((hz(m + det) * x + rng.random()) % 1) - 1
    return filt(s, "low", 1100, 4) * np.minimum(1, x / attack) * np.minimum(1, (d - x) / .5) / len(notes)
def blip(f0, f1, d=.09, decay=40): x = tt(d); return np.sin(2 * np.pi * np.cumsum(np.linspace(f0, f1, len(x))) / SR) * np.exp(-x * decay) * np.minimum(1, x * 800)
def noise_swell(d, lo, hi): x = tt(d); return filt(rng.standard_normal(len(x)), "band", [lo, hi]) * np.sin(np.pi * x / d) ** 2
def riser(d): x = tt(d); return (filt(rng.standard_normal(len(x)), "high", 3000) * .6 + .3 * np.sin(2 * np.pi * np.cumsum(np.linspace(180, 1500, len(x))) / SR)) * (x / d) ** 2

CHORDS = [(50, [62, 65, 69]), (46, [58, 62, 65]), (41, [57, 60, 65]), (48, [55, 60, 64])]  # Dm, Bb, F, C: (bass, triad)
chord = lambda t: CHORDS[int((t - 10) // 2) % 4] if t >= 10 else CHORDS[0]

# intro: one note per logo square, then a pad
for e in json.load(open("events.json")):
    t, k, v = e["t"], e["k"], e.get("v")
    if k == "note": put("pluck", t, pluck([62, 65, 69, 72, 76][v], 1.6), .5, (v - 2) * .25)
    elif k == "key": put("sfx", t, (filt(rng.standard_normal(400), "band", [1800, 6000]) * np.exp(-tt(400 / SR) * 500)), .11 + .05 * rng.random(), rng.uniform(-.3, .3))
    elif k == "pop": put("sfx", t, blip(880, 1320), .32)
    elif k == "yes": put("sfx", t, blip(1046, 1568, .12, 30), .3)
    elif k == "no": put("sfx", t, blip(392, 330, .12, 30), .22)
    elif k == "tick": put("sfx", t, blip(1500, 1500, .04, 90), .2)
    elif k == "whoosh": put("sfx", t - .3, noise_swell(.6, 500, 6000), .28)
    elif k == "swish": put("sfx", t, noise_swell(.75, 900, 9000), .22)
    elif k == "thump": put("sfx", t, np.sin(2 * np.pi * 52 * tt(.6)) * np.exp(-tt(.6) * 7), 1.0); put("sfx", t, filt(rng.standard_normal(int(SR * .15)), "low", 900) * np.exp(-tt(.15) * 40), .7)
    elif k == "count":
        for i in range(16): put("sfx", t + v * (i / 16) ** .7, blip(700 + 60 * i, 700 + 60 * i, .03, 120), .12)
    elif k == "roll":
        for i in range(int(v / .125)): put("sfx", t + i * .125, blip(600 + 40 * i, 620 + 40 * i, .05, 70), .09, np.sin(i) * .4)
put("pad", 1.5, pad([50, 62, 65, 69], 2.6, 1.2), .5)
# 4-8: pulse under the numbers
put("pad", 4, pad([50, 62, 65, 69], 2.1), .55); put("pad", 6, pad([46, 58, 62, 65], 2.1), .55)
for b in np.arange(4, 8, .5): put("drums", b, kick(), .45); put("bass", b, bassnote(38 if b < 6 else 34, .45), .5)
# 8-10: build
put("pad", 8, pad([48, 60, 64, 67], 2.1), .55); put("sfx", 8, riser(2), .35)
for b in list(np.arange(8, 9, .5)) + list(np.arange(9, 9.5, .25)) + list(np.arange(9.5, 10, .125)): put("drums", b, clap(), .22 + (b - 8) * .1)
# 10-36: groove
put("drums", 10, crash(), .3)
for bar in np.arange(10, 36, 2):
    root, tri = chord(bar)
    put("pad", bar, pad(tri, 2.1, .2), .3)
    for i in range(8):
        t = bar + i * .25
        put("bass", t, bassnote(root - 12 + (12 if i in (3, 6) else 0)), .55)
        arp = tri + [tri[0] + 12]
        put("pluck", t, pluck(arp[[0, 2, 1, 3, 2, 1, 3, 2][i]] + (12 if bar >= 26 else 0), .7), .2 if bar < 18 else .26, .35 if i % 2 else -.35)
    for b in range(4):
        put("drums", bar + b * .5, kick(), .9)
        put("drums", bar + b * .5 + .25, hat(), .16)
        if bar >= 18 and b % 2: put("drums", bar + b * .5, clap(), .3)
        if bar >= 18:
            for s in (.125, .375): put("drums", bar + b * .5 + s, hat(80), .07)
for t in (20, 26, 32): put("drums", t, crash(), .18)
for i in range(8): put("drums", 35.5 + i * .0625, clap(), .12 + i * .03)
# 36-42: breakdown while the heart fills in
put("drums", 36, crash(), .25)
for bar in np.arange(36, 42, 2):
    root, tri = CHORDS[int((bar - 36) // 2) % 4]
    put("pad", bar, pad([root] + tri, 2.1, .3), .6)
    for i in range(4): put("pluck", bar + i * .5, pluck(tri[i % 3] + 12, 1.2), .28, (-1) ** i * .4)
put("sfx", 40, riser(2), .4)
for b in np.arange(41, 42, .125): put("drums", b, clap(), .1 + (b - 41) * .3)
# 42: landing
put("drums", 42, kick(), 1.0); put("drums", 42, crash(), .4)
put("pad", 42, pad([38, 50, 62, 65, 69, 76], 5, .05), .8)
for i, m in enumerate([62, 65, 69, 72, 76, 81]): put("pluck", 42 + i * .125, pluck(m, 3), .4, (i - 2.5) * .2)

# echo on the plucks, then duck pad and bass under each kick
d = int(.375 * SR); wet = np.zeros((N, 2))
for n, g in ((1, .4), (2, .2), (3, .1)): wet[n * d:, (n % 2)] += bus["pluck"][: N - n * d, 0] * g; wet[n * d:, 1 - (n % 2)] += bus["pluck"][: N - n * d, 1] * g * .5
bus["pluck"] += wet
duck = np.ones(N)
for b in np.arange(10, 36, .5): i = int(b * SR); x = tt(.3)[: N - i]; duck[i:i + len(x)] = np.minimum(duck[i:i + len(x)], 1 - .55 * np.exp(-x * 14))
for k in ("pad", "bass"): bus[k] *= duck[:, None]
mix = bus["drums"] * .8 + bus["bass"] * .6 + bus["pluck"] + bus["pad"] * .5 + bus["sfx"]
mix = np.tanh(mix * 1.1)
fade = np.minimum(1, (LEN - np.arange(N) / SR) / 1.5)
mix = mix / np.abs(mix).max() * .9 * fade[:, None]
wavfile.write("audio.wav", SR, (mix * 32767).astype(np.int16))
print("peak", round(float(np.abs(mix).max()), 2), "rms", round(float(np.sqrt((mix ** 2).mean())), 3))
