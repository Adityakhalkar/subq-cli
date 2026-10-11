# Original soundtrack built from Apple's recorded loops and drum samples (GarageBand / Logic library).
# Only the *shape* is borrowed from the reference song: 120 bpm, a four-second build, a drop, accents on the bar lines.
# All pitched loops are in C minor; the Electro House loops are 128 bpm and are slowed to 120.  python3 arrange.py
import subprocess, os, numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt
SR, LEN = 44100, 52.0
N = int(SR * LEN)
EH = "/Library/Audio/Apple Loops/Apple/02 Electro House/"
FX = "/Library/Audio/Apple Loops/Apple/03 Dubstep/"
KIT = "/Library/Application Support/Logic/Ultrabeat Samples/Epic Electro/"
def read(path, tempo=None):
    af = ["-filter:a", f"atempo={tempo}"] if tempo else []
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", path, *af, "-ar", str(SR), "-ac", "2", "_l.wav"], check=True)
    x = wavfile.read("_l.wav")[1].astype(float) / 32768; os.remove("_l.wav"); return x
def loop(name):   # slowed to 120 bpm, snapped to whole 2-second bars, levelled
    x = read(EH + name + ".caf", 120 / 128); n = round(len(x) / SR / 2) * 2 * SR
    x = np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]; return x / (np.sqrt((x ** 2).mean()) + 1e-9) * .1
def shot(path): x = read(path); return x / (np.abs(x).max() + 1e-9)
mix = np.zeros((N, 2))
def lay(x, a, b, gain=1.0, fade_in=.01, fade_out=.01):
    i, j = int(a * SR), int(min(b, LEN) * SR); seg = np.tile(x, (int((j - i) / len(x)) + 1, 1))[: j - i] * gain
    fi, fo = int(fade_in * SR), int(fade_out * SR); seg[:fi] *= np.linspace(0, 1, fi)[:, None]; seg[-fo:] *= np.linspace(1, 0, fo)[:, None]
    mix[i:j] += seg
def hit(x, t, gain=1.0):
    i = int(t * SR); n = min(len(x), N - i); mix[i:i + n] += x[:n] * gain
def opening(x):   # filter opens over the loop: muffled to bright
    lo = sosfilt(butter(2, 350, "low", fs=SR, output="sos"), x, axis=0); r = (np.linspace(0, 1, len(x)) ** 2)[:, None]; return lo * (1 - r) + x * r
pad, lead, lead2 = loop("Deep Dream Synth"), loop("Big Anthem Synth"), loop("Epic Anthem Synth")
bass, bass2 = loop("Bouncer Bass"), loop("Power Tool Bass")
beat, beat2, beat3 = loop("Four Four Beat"), loop("Rocket Fuel Beat 01"), loop("Rocket Fuel Beat 02")
roll, clap_top = loop("Big Snare Roll Topper"), loop("House Clap Topper")
rise = read(FX + "Rising Synth Effects 02.caf"); rise = rise / np.abs(rise).max()
crash, clap, kick = shot(KIT + "WA_electrik_crash1.aif"), shot(KIT + "WA_electrik_clap1.aif"), shot(KIT + "WA_electrik_bd1.aif")
def build(a, b):  # snare roll and riser into a quarter-second of silence before the drop
    lay(roll, b - 2, b - .25, .9, fade_in=1.2); hit(rise, b - .25 - len(rise) / SR, .35)
# hook: 0-4 build under the book, 4.0 drop on the answer
lay(opening(np.tile(pad, (1, 1))[: 4 * SR]), 0, 3.75, 1.3, fade_in=.6); build(0 + 2, 4)
hit(crash, 4, .7); lay(lead, 4, 8, 1.0); lay(bass, 4, 8, 1.0); lay(beat2, 4, 8, 1.1)
for t in (6, 6.5, 7): hit(clap, t, .5)
# story: pull back, then build again
hit(crash, 8, .4); lay(pad, 8, 19.75, 1.0); lay(bass, 8, 19.75, .9); lay(beat, 8, 16, 1.0); lay(clap_top, 12, 18, .6); build(18, 20)
# demo: full, lifting at 36
hit(crash, 20, .7); lay(lead, 20, 36, 1.0); lay(bass2, 20, 44, 1.0); lay(beat2, 20, 36, 1.1); lay(clap_top, 28, 36, .5)
hit(crash, 36, .6); lay(lead2, 36, 44, 1.0); lay(beat3, 36, 44, 1.15)
lay(pad, 44, 46, .8)                       # drums drop out for the stamp...
hit(crash, 44.5, .8)
hit(kick, 44.5, .9)                        # ...which lands as a single hit
# install: one last chord bed, fading
hit(crash, 46, .6); lay(pad, 46, 52, 1.0, fade_out=3); lay(bass, 46, 50, .6, fade_out=2)
mix = np.tanh(mix * 1.6) ; mix = mix / np.abs(mix).max() * .92
os.makedirs("sound", exist_ok=True); wavfile.write("sound/music.wav", SR, (mix * 32767).astype(np.int16))
w = SR; print("loudness by second:", " ".join(str(int(np.sqrt((mix[i:i + w] ** 2).mean()) * 100)) for i in range(0, N - w, w)))
