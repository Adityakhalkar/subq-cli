# Sound for film.html, built only from the film's own events (events.json). No beat: a drone, and one sound per square.
import json, numpy as np
from scipy.signal import butter, sosfilt
from scipy.io import wavfile
SR, LEN = 44100, 26.0
N = int(SR * LEN); rng = np.random.default_rng(3); mix = np.zeros((N, 2))
tt = lambda d: np.arange(int(SR * d)) / SR
hz = lambda m: 440 * 2 ** ((m - 69) / 12)
filt = lambda x, kind, f, order=2: sosfilt(butter(order, f, kind, fs=SR, output="sos"), x)
def put(t, sig, gain=1.0, pan=0.0):
    i = int(t * SR)
    if not 0 <= i < N: return
    sig = sig[: N - i] * gain
    mix[i:i + len(sig), 0] += sig * (1 - max(0, pan)); mix[i:i + len(sig), 1] += sig * (1 + min(0, pan))
def pluck(m, d=1.2, bright=1.0):
    x = tt(d); f = hz(m)
    return (np.sin(2 * np.pi * f * x) * np.exp(-x * 4) + .4 * bright * np.sin(2 * np.pi * 2 * f * x) * np.exp(-x * 8) + .15 * bright * np.sin(2 * np.pi * 3.01 * f * x) * np.exp(-x * 14)) * np.minimum(1, x * 500)
def thump(f=50, d=.7): x = tt(d); return np.sin(2 * np.pi * np.cumsum(f + 60 * np.exp(-x * 30)) / SR) * np.exp(-x * 7)
def swell(d, lo, hi, shape=2): x = tt(d); return filt(rng.standard_normal(len(x)), "band", [lo, hi]) * np.sin(np.pi * x / d) ** shape
def drone(notes, d, cutoff):
    x = tt(d); s = sum(2 * ((hz(m + det) * x + rng.random()) % 1) - 1 for m in notes for det in (-.06, .06))
    return filt(s, "low", cutoff, 4) / len(notes)
PENTA = [62, 65, 67, 69, 72, 74, 77, 79, 81, 84]  # D minor pentatonic
# a quiet drone under everything, opening up as the squares multiply
d = drone([38, 50, 57], LEN, 500) * .5 + drone([62, 69], LEN, 1400) * np.clip((tt(LEN) - 12) / 6, 0, 1)[: int(SR * LEN)] * .35
env = np.minimum(1, tt(LEN) / 3) * (1 - .6 * np.clip((tt(LEN) - 18.6) / 1.4, 0, 1) * (tt(LEN) < 20.1)); put(0, d * env, .32)
for e in json.load(open("events.json")):
    t, k, v = e["t"], e["k"], e.get("v")
    if k == "key": x = tt(.012); put(t, filt(rng.standard_normal(len(x)), "band", [1500, 5500]) * np.exp(-x * 400), .13 + .05 * rng.random(), rng.uniform(-.2, .2))
    elif k == "fill": x = tt(1.0); put(t, np.sin(2 * np.pi * np.cumsum(np.linspace(147, 587, len(x))) / SR) * np.sin(np.pi * x) ** .7, .22)
    elif k == "yes":
        put(t, thump(), .9)
        for i, m in enumerate([50, 62, 69, 74, 77]): put(t + i * .02, pluck(m, 2.5), .32, (i - 2) * .2)
    elif k == "y": put(t, pluck(81, .8), .3, .2)
    elif k == "n": put(t, pluck(57, .5, .3), .22, -.2)
    elif k == "stretch":
        for i in range(6): put(t + .1 + i * .07, pluck(PENTA[i + 2], .7), .22, (i - 2.5) * .2)
        put(t, swell(.8, 600, 5000), .14)
    elif k == "sort": put(t, swell(.8, 900, 8000), .2); put(t + .7, pluck(74, 1.2), .25)
    elif k == "burst":
        put(t, swell(1.3, 300, 7000, 1), .3); put(t, thump(45, .9), .5)
        for i in range(60): put(t + rng.random() ** .6 * 1.1, pluck(PENTA[rng.integers(0, 10)] + 12, .4), .06, rng.uniform(-.8, .8))
    elif k == "sweep":
        probs = [float(l.split("\t")[0]) for l in open("../launch/heart.tsv")]
        for i in range(0, 1600, 3):  # every third answer gets a grain; pitch climbs with the rows
            p = probs[i]; row = i // 40
            put(t + i / 1600 * v, pluck(PENTA[(row // 4) % 10] + (12 if p > .7 else 0), .25, 1.4 if p > .7 else .3), .03 + .06 * p, (i % 40 - 20) / 25)
    elif k in ("lub", "dub"): put(t, thump(58 if k == "lub" else 48, .5), .8)
    elif k == "gather": x = tt(1.5); put(t, filt(rng.standard_normal(len(x)), "high", 2500) * (x / 1.5) ** 2.5, .28); put(t, np.sin(2 * np.pi * np.cumsum(np.linspace(110, 440, len(x))) / SR) * (x / 1.5) ** 2, .2)
    elif k == "land":
        put(t, thump(42, 1.4), 1.0)
        for i, m in enumerate([38, 50, 62, 66, 69, 74, 81]): put(t, pluck(m, 4.5), .3, (i - 3) * .15)   # D major: the answer resolves
    elif k == "end":
        for i, m in enumerate([74, 78, 81, 86]): put(t + .4 + i * .14, pluck(m, 3), .18, (i - 1.5) * .3)
# long echo for space
dly = int(.33 * SR)
for n, g in ((1, .3), (2, .15), (3, .07)): mix[n * dly:] += mix[: N - n * dly][:, ::-1] * g
mix = np.tanh(mix * 1.15); mix *= np.minimum(1, (LEN - np.arange(N) / SR) / 2)[:, None]; mix = mix / np.abs(mix).max() * .9
wavfile.write("audio.wav", SR, (mix * 32767).astype(np.int16)); print("ok rms", round(float(np.sqrt((mix ** 2).mean())), 3))
