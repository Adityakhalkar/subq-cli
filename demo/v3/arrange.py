# Builds sound/music.wav from Apple Loops (the recorded loop library that ships with GarageBand / Logic).
# Every loop here is 120 bpm, and each kit's parts share a key. python3 arrange.py <kit>
import subprocess, sys, os, numpy as np
from scipy.io import wavfile
SR, LEN = 44100, 52.0
N = int(SR * LEN); L = "/Library/Audio/Apple Loops/Apple/07 Chillwave/"
KITS = {  # synth for the opening, synth for the body, bass, guitar
    "la": ("Landing in LA Synth 01", "Landing in LA Synth 03", "Landing in LA Bass 02", "Landing in LA Guitar"),
    "hyperlapse": ("Hyperlapse Synth", "Hyperlapse Synth", "Hyperlapse Bass", "Hyperlapse Guitar"),
    "pictures": ("Moving Pictures Synth", "Moving Pictures Synth", "Moving Pictures Bass", "Moving Pictures Rhythm Guitar"),
}
kit = sys.argv[1] if len(sys.argv) > 1 else "la"
intro, body, bass, guitar = KITS[kit]
def load(name):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", L + name + ".caf", "-ar", str(SR), "-ac", "2", "_l.wav"], check=True)
    x = wavfile.read("_l.wav")[1].astype(float) / 32768; os.remove("_l.wav")
    n = round(len(x) / SR / 2) * 2 * SR   # snap to whole 2-second bars
    return np.pad(x, ((0, max(0, n - len(x))), (0, 0)))[:n]
mix = np.zeros((N, 2))
def lay(name, a, b, gain=1.0):   # tile a loop from second a to second b, with short fades at the ends
    x = load(name); i, j = int(a * SR), int(min(b, LEN) * SR)
    seg = np.tile(x, (int((j - i) / len(x)) + 1, 1))[: j - i] * gain
    f = int(.02 * SR); seg[:f] *= np.linspace(0, 1, f)[:, None]; seg[-f:] *= np.linspace(1, 0, f)[:, None]
    mix[i:j] += seg
# hook 0-8 / story 8-20 / demo 20-46 / install 46-52: parts enter on the scene changes
lay(intro, 0, 8, .8); lay(guitar, 4, 8, .5)
lay(intro, 8, 20, .7); lay("Minimal Backbeat 01", 8, 20, .7); lay(bass, 12, 20, .7)
lay(body, 20, 46, .7); lay(bass, 20, 46, .8); lay("Doubledown Beat 01", 20, 36, .8); lay("Doubledown Beat 02", 36, 46, .8); lay(guitar, 30, 46, .45)
lay(intro, 46, 52, .8); lay(bass, 46, 52, .6)
mix = mix / np.abs(mix).max() * .9
os.makedirs("sound", exist_ok=True); wavfile.write("sound/music.wav", SR, (mix * 32767).astype(np.int16)); print("kit:", kit)
