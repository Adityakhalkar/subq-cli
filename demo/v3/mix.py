# Lays your own sound under the video. Nothing here is synthesized.
#   sound/music.(mp3|wav|m4a)   the track (required)
#   sound/<cue>.(wav|mp3)       optional one-shot effects, placed at every matching cue in events.json:
#                               key, pop, whoosh, big, thump, sq, grow, yes, no, tick, swish, drop, final, flutter
# python3 mix.py [music_start_seconds] [music_gain] [effects_gain]   ->  subq-cli-launch-v3.mp4
import json, glob, os, subprocess, sys, numpy as np
from scipy.io import wavfile
SR = 44100
LEN = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "silent.mp4"]))
N = int(SR * LEN)
start, mgain, fgain = (float(a) for a in (sys.argv[1:] + ["0", "0.8", "0.5"][len(sys.argv) - 1:])[:3])
def load(path, ss=0):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-ss", str(ss), "-i", path, "-ar", str(SR), "-ac", "2", "_tmp.wav"], check=True)
    x = wavfile.read("_tmp.wav")[1].astype(float) / 32768; os.remove("_tmp.wav"); return x
find = lambda name: next(iter(sorted(glob.glob(f"sound/{name}.*"))), None)
music = find("music") or sys.exit("Put a track at sound/music.mp3 (or .wav / .m4a) first.")
m = load(music, start)[:N]; mix = np.zeros((N, 2)); mix[: len(m)] = m / max(1e-9, np.abs(m).max()) * mgain
used = {}
for e in json.load(open("events.json")):
    f = find(e["k"])
    if not f: continue
    s = used.get(f); s = used.setdefault(f, load(f)) if s is None else s
    i = int(e["t"] * SR); n = min(len(s), N - i); mix[i:i + n] += s[:n] / max(1e-9, np.abs(s).max()) * fgain * (.35 if e["k"] == "key" else 1)
mix *= np.minimum(1, (LEN - np.arange(N) / SR) / 2)[:, None]; mix = np.clip(mix / max(1, np.abs(mix).max()), -1, 1) * .95
wavfile.write("audio.wav", SR, (mix * 32767).astype(np.int16))
subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", "silent.mp4", "-i", "audio.wav", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "subq-cli-launch-v3.mp4"], check=True)
print("music:", music, "| effects:", [os.path.basename(f) for f in used] or "none", "-> subq-cli-launch-v3.mp4")
