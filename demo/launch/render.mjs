// node render.mjs still 1.2 5 11   -> frame-<t>.png      node render.mjs video 47 -> silent.mp4 + events.json
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [mode, ...args] = process.argv.slice(2);
const dir = import.meta.dirname;
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new", "--remote-debugging-port=9333", "--hide-scrollbars", "--force-device-scale-factor=1", `--user-data-dir=${mkdtempSync(join(tmpdir(), "subq-video-"))}`, "about:blank"], { stdio: "ignore" });
let page;
for (let i = 0; i < 50 && !page; i++) {
  await new Promise((r) => setTimeout(r, 200));
  try { page = (await (await fetch("http://127.0.0.1:9333/json")).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id) { waiting.get(d.id)(d.result); waiting.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `file://${dir}/video.html` });
while (!(await js("window.READY === true"))) await new Promise((r) => setTimeout(r, 100));
const shot = async (t) => { await js(`render(${t})`); return Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"); };
if (mode === "still") for (const t of args) writeFileSync(join(dir, `frame-${t}.png`), await shot(+t));
else {
  writeFileSync(join(dir, "events.json"), await js("JSON.stringify(EV)"));
  const ff = spawn("ffmpeg", ["-loglevel", "error", "-y", "-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", "-preset", "slow", join(dir, "silent.mp4")], { stdio: ["pipe", "inherit", "inherit"] });
  const frames = Math.round(+args[0] * 30);
  for (let f = 0; f < frames; f++) if (!ff.stdin.write(await shot(f / 30))) await new Promise((r) => ff.stdin.once("drain", r));
  ff.stdin.end(); await new Promise((r) => ff.on("close", r));
}
ws.close(); chrome.kill();
