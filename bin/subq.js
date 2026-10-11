#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, extname, dirname, basename } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

const BASE = (process.env.SUBQ_BASE_URL || "https://api.subq.ai/v1").replace(/\/$/, "");
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "subq");
const CONFIG = join(CONFIG_DIR, "config.json");
const HISTORY = join(CONFIG_DIR, "history");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const HELP = `subq ${version} - unofficial CLI for the SubQ API

Usage:
  subq                               Open an interactive session
  subq login                         Save your API key (get one at https://console.subq.ai)
  subq ask <question> [state]        One judgment about a piece of text
  subq filter <question>             Keep the stdin lines the answer is yes for
  subq each <question>               Judge every stdin line: prints answer<TAB>line
  subq models                        List models your key can use
  subq logout                        Delete the saved key

Question types (ask, each):
  (default)                 yes/no: prints the probability of yes, 0 to 1
  --yes <text>              describe what counts as yes
  --no <text>               describe what counts as no
  --choice <a,b=desc,c>     pick one option: prints the chosen label
  --score <low,mid,high>    2-10 ordered levels: prints a weighted score

ask options:
  -i, --image <path>        attach a PNG, JPEG or WebP (repeat for up to 4)
  -t, --threshold <p>       yes/no only: exit 0 if the probability is at least p, else 1
  The state is the text being judged: second argument, or piped on stdin.

filter and each options:
  -f, --files               each line is a path: judge that file's text, or the image
  -t, --threshold <p>       filter: keep lines at or above p (default 0.5)
  -v, --invert              filter: keep the lines that do not match
  -j, --jobs <n>            requests in flight at once (default 8)
  filter exits 1 when nothing matched, like grep.

Common options:
  -m, --model <id>          override the model
  --json                    print the raw API response (ask, models)

Environment:
  SUBQ_API_KEY              overrides the saved key
  SUBQ_BASE_URL             overrides ${"https://api.subq.ai/v1"}

Examples:
  subq ask "Is this spam?" "You won a free cruise, click here"
  subq ask "Which team owns this?" --choice billing,tech,sales < ticket.txt
  git diff --cached | subq ask -t 0.5 "Does this diff add a secret or API key?" && echo "check your diff"
  subq filter "Is this a complaint?" < reviews.txt
  ls photos/*.jpg | subq filter -f "Is there a person in this photo?"
  subq each "How urgent is this?" --score low,medium,high < tickets.txt | sort -rn

Enterprise keys with subq-preview also get chat:
  subq chat [prompt] [-s system] [-e effort]      subq -p <prompt>`;

const HINTS = {
  401: "Invalid or missing API key. Run `subq login`.",
  402: "Out of credits. Top up at https://console.subq.ai",
  403: "This API key cannot use that model (subq-preview is enterprise only). Run `subq models` to see what it can use.",
  429: "Rate limited. Wait a moment and retry.",
  503: "SubQ is temporarily unavailable. Retry shortly.",
};

class Fail extends Error {}
const fail = (message, status) => {
  throw Object.assign(new Fail(message), { status });
};
const dim = (s) => (process.stderr.isTTY ? `\x1b[2m${s}\x1b[0m` : s);

function apiKey() {
  if (process.env.SUBQ_API_KEY) return process.env.SUBQ_API_KEY;
  let saved;
  try {
    saved = JSON.parse(readFileSync(CONFIG, "utf8")).apiKey;
  } catch {}
  return saved || fail("No API key. Run `subq login` or set SUBQ_API_KEY.");
}

async function api(path, body, key = apiKey(), signal) {
  let res;
  // Rate limits and brief outages are retried three times: after 0.5s, 1s and 2s.
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(BASE + path, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, ...(body && { "Content-Type": "application/json" }) },
        body: body && JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if (signal?.aborted) fail("Interrupted");
      fail(`Could not reach ${BASE}: ${e.cause?.message || e.message}`);
    }
    if ((res.status !== 429 && res.status !== 503) || attempt === 3) break;
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const j = JSON.parse(text);
      // Decisions errors use `detail`, the OpenAI-compatible endpoints use `error`.
      message = j.detail?.message ?? j.error?.message ?? (typeof j.detail === "string" ? j.detail : text);
    } catch {}
    fail(`${res.status} ${message}`.trim() + (HINTS[res.status] ? `\n${HINTS[res.status]}` : ""), res.status);
  }
  return res;
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text.trim();
}

function readKey() {
  const { stdin, stderr } = process;
  if (!stdin.isTTY) return readStdin();
  stderr.write("SubQ API key (input hidden): ");
  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.resume();
  return new Promise((resolve) => {
    let key = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\u0003") process.exit(130);
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stderr.write("\n");
          return resolve(key.trim());
        }
        key = ch === "\u007f" || ch === "\b" ? key.slice(0, -1) : key + ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function saveKey(key) {
  if (!key) fail("No key entered.");
  // GET /models answers 200 for any key, so the only real check is a tiny billed decision (about 100 tokens).
  const probe = { model: "subq-snap-preview", state: "ok", questions: { answer: { type: "noul", instructions: "Is this ok?" } } };
  let note = "";
  try {
    await api("/systemone", probe, key);
  } catch (e) {
    // 402 and 403 mean the key itself was accepted.
    if (e.status !== 402 && e.status !== 403) throw e;
    note = e.status === 402 ? " (note: this account has no credits yet)" : " (note: this key cannot use subq-snap-preview)";
  }
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG, JSON.stringify({ apiKey: key }, null, 2) + "\n", { mode: 0o600 });
  chmodSync(CONFIG, 0o600);
  return `Key verified and saved to ${CONFIG}${note}`;
}

async function login() {
  console.log(await saveKey(await readKey()));
}

function logout() {
  rmSync(CONFIG, { force: true });
  console.log("Saved key removed.");
}

async function models(argv) {
  const { values: o } = parseArgs({ args: argv, options: { json: { type: "boolean" } } });
  const body = await (await api("/models")).json();
  if (o.json) return console.log(JSON.stringify(body, null, 2));
  for (const m of body.data ?? []) console.log(m.name ? `${m.id}\t${m.name}` : m.id);
}

// ponytail: options split on commas, so a description cannot contain one. Use the API directly if you need that.
const list = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

const options = (s) =>
  Object.fromEntries(
    list(s).map((item) => {
      const [label, ...desc] = item.split("=");
      return [label.trim(), desc.join("=").trim() || null];
    }),
  );
// The API returns float32 noise like 0.9844077229499817; three decimals is all the signal there is.
const round = (v) => (typeof v === "number" ? +v.toFixed(3) : v);

const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

function image(path) {
  const mediaType = MEDIA[extname(path).toLowerCase()] || fail(`${path}: images must be .png, .jpg, .jpeg or .webp`);
  try {
    return { mediaType, base64: readFileSync(path).toString("base64") };
  } catch (e) {
    fail(`${path}: ${e.message}`);
  }
}

const JUDGE = {
  yes: { type: "string" },
  no: { type: "string" },
  choice: { type: "string" },
  score: { type: "string" },
  threshold: { type: "string", short: "t" },
  model: { type: "string", short: "m", default: "subq-snap-preview" },
};

function question(instructions, o) {
  if (o.choice && o.score) fail("Use --choice or --score, not both.");
  if (o.choice) return { type: "choice", instructions, criteria: options(o.choice) };
  if (o.score) return { type: "score", instructions, criteria: list(o.score) };
  const criteria = { ...(o.yes && { true: o.yes }), ...(o.no && { false: o.no }) };
  return { type: "noul", instructions, ...((o.yes || o.no) && { criteria }) };
}

function threshold(o, fallback) {
  const t = Number(o.threshold ?? fallback);
  if (!(t >= 0 && t <= 1)) fail("--threshold must be a number from 0 to 1.");
  return t;
}

async function ask(argv, fallbackState) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { ...JUDGE, image: { type: "string", short: "i", multiple: true }, json: { type: "boolean" } },
  });
  const [instructions, ...rest] = positionals;
  if (!instructions) fail('Missing question. Example: subq ask "Is this spam?" "You won a free cruise"');
  const q = question(instructions, o);
  if (o.threshold != null && q.type !== "noul") fail("--threshold only works with yes/no questions.");
  const state = rest.join(" ") || (await readStdin()) || fallbackState;
  if (!state) fail("Missing state: pass the text to judge as a second argument or pipe it on stdin.");

  const images = (o.image ?? []).map(image);
  const body = { model: o.model, state, questions: { answer: q }, ...(images.length && { images }) };
  const out = await (await api("/systemone", body)).json();
  const a = out.answers?.answer ?? fail(`Unexpected response: ${JSON.stringify(out)}`);
  if (o.threshold != null && a.noul < threshold(o)) process.exitCode = 1;
  if (o.json) return console.log(JSON.stringify(out, null, 2));

  // The answer alone goes to stdout so it pipes cleanly; details go to stderr.
  console.log(round(a[a.type]));
  const details = [];
  if (a.probabilities) {
    const name = (k) => a.legend?.[k] ?? k;
    details.push(Object.entries(a.probabilities).map(([k, p]) => `${name(k)} ${round(p)}`).join(", "));
  }
  if (a.confidence != null) details.push(`confidence ${round(a.confidence)}`);
  if (out.usage) details.push(`tokens: ${out.usage.input_tokens} in / ${out.usage.output_tokens} out`);
  if (details.length) console.error(dim(details.join(" | ")));
}

// `subq each` and `subq filter`: one question over every line of stdin, a few requests at a time, output in input order.
async function each(argv, filtering) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      ...JUDGE,
      files: { type: "boolean", short: "f" },
      invert: { type: "boolean", short: "v" },
      jobs: { type: "string", short: "j", default: "8" },
    },
  });
  const name = filtering ? "filter" : "each";
  const instructions = positionals.join(" ");
  if (!instructions) fail(`Missing question. Example: subq ${name} "Is this a complaint?" < reviews.txt`);
  const q = question(instructions, o);
  if (filtering && q.type !== "noul") fail("filter asks a yes/no question. Use `subq each` with --choice or --score.");
  const keep = threshold(o, 0.5);
  if (process.stdin.isTTY) fail(`Pipe the lines to judge on stdin. Example: subq ${name} "Is this a complaint?" < reviews.txt`);
  const lines = (await readStdin()).split("\n").filter((line) => line.trim());

  const load = (line) => {
    if (!o.files) return { state: line };
    const path = line.trim();
    if (MEDIA[extname(path).toLowerCase()]) return { state: "See the attached image.", images: [image(path)] };
    try {
      return { state: readFileSync(path, "utf8").trim() || "(empty file)" };
    } catch (e) {
      fail(`${path}: ${e.message}`);
    }
  };

  const answers = [];
  let next = 0;
  let printed = 0;
  let matched = 0;
  let tokens = 0;
  const worker = async () => {
    while (next < lines.length) {
      const i = next++;
      const out = await (await api("/systemone", { model: o.model, ...load(lines[i]), questions: { answer: q } })).json();
      answers[i] = out.answers?.answer ?? fail(`Unexpected response: ${JSON.stringify(out)}`);
      tokens += (out.usage?.input_tokens ?? 0) + (out.usage?.output_tokens ?? 0);
      for (; answers[printed]; printed++) {
        const a = answers[printed];
        if (!filtering) console.log(`${round(a[a.type])}\t${lines[printed]}`);
        else if (a.noul >= keep !== !!o.invert) {
          matched++;
          console.log(lines[printed]);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(+o.jobs || 8, 32)) }, worker));
  console.error(dim(`${lines.length} judged${filtering ? `, ${matched} kept` : ""}, ${tokens} tokens`));
  if (filtering && !matched) process.exitCode = 1;
}

// Streams a chat completion, calling onDelta for each piece of text.
async function streamChat(body, onDelta, signal) {
  const res = await api("/chat/completions", { ...body, stream: true }, undefined, signal);
  let text = "";
  let usage;
  let buffer = "";
  const decoder = new TextDecoder();
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        onDelta(delta);
      }
      if (event.usage) usage = event.usage;
    }
  }
  return { text, usage };
}

async function chat(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      model: { type: "string", short: "m", default: "subq-preview" },
      system: { type: "string", short: "s" },
      effort: { type: "string", short: "e" },
      json: { type: "boolean" },
    },
  });
  const prompt = [positionals.join(" "), await readStdin()].filter(Boolean).join("\n\n");
  if (!prompt) {
    if (!process.stdin.isTTY) fail('No prompt. Example: subq chat "Explain SSE in two sentences"');
    return tui(o);
  }
  const body = {
    model: o.model,
    messages: [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content: prompt }],
    ...(o.effort && { reasoning_effort: o.effort }),
  };
  if (o.json) return console.log(JSON.stringify(await (await api("/chat/completions", body)).json(), null, 2));
  const { text, usage } = await streamChat(body, (delta) => process.stdout.write(delta));
  process.stdout.write("\n");
  if (!text) console.error(dim("(empty response; if reasoning used the whole budget, try --effort none)"));
  if (usage) console.error(dim(`tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`));
}

// `subq -p`: chat if the key has the chat model, otherwise a yes/no judgment.
async function print(argv) {
  const { data = [] } = await (await api("/models")).json();
  if (data.some((m) => m.id === "subq-preview")) return chat(argv);
  return ask(argv, "No additional context was provided.");
}

const MODELS = { "subq-preview": "chat · enterprise only", "subq-snap-preview": "yes/no, choice and scale questions" };

const TUI_HELP = [
  ["/help", "show this list"],
  ["/clear", "start a new conversation"],
  ["/model [id]", "pick a model"],
  ["/effort [level|off]", "reasoning effort, e.g. none, medium, high"],
  ["/system [text|off]", "set or remove the system prompt"],
  ["/ask <question> [| text]", "yes/no probability from subq-snap-preview"],
  ["/file [path|off]", "load a text file to ask questions about"],
  ["/status", "model, key and connection details"],
  ["/cost", "tokens used this session"],
  ["/login", "save a different API key"],
  ["/logout", "delete the saved API key"],
  ["/exit", "quit (or Ctrl-D)"],
  ["question [a, b, c]", "pick one of the options"],
  ["question [low < mid < high]", "rate on a scale"],
  ["question | text", "judge that text"],
  ["@path", "attach a file or image to your message"],
  ["!command", "run a shell command and ask about its output"],
  ["\\ at end of line", "continue on the next line"],
  ["Esc or Ctrl-C", "interrupt a reply"],
];

async function tui(o = {}) {
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  // SubQ's palette: the five squares of its logo, with the orange as the accent. 256-colour fallbacks for older terminals.
  const rich = /truecolor|24bit/.test(process.env.COLORTERM || "");
  const hue = (rgb, fallback) => paint(rich ? `38;2;${rgb}` : `38;5;${fallback}`);
  const accent = hue("235;82;30", 202);
  const gray = hue("153;148;137", 245);
  const squares = [hue("255;226;55", 220), hue("45;91;255", 27), gray, accent, hue("63;125;49", 64)];
  const [yellow, blue, , orange, green] = squares.map((c) => c("██"));
  const LOGO = [`${yellow}  ${blue}`, `  ${gray("██")}  `, `${orange}  ${green}`];
  const faint = paint("2");
  const bold = paint("1");
  const red = paint("31");
  const width = (s) => s.replace(/\x1b\[[0-9;]*m/g, "").length;

  try {
    apiKey();
  } catch {
    console.log(`${accent("■")} Welcome to subq. Paste your API key to get started (create one at https://console.subq.ai).`);
    await login();
  }

  const names = TUI_HELP.map(([cmd]) => cmd.split(" ")[0]).filter((n) => n.startsWith("/"));
  let model = o.model || "subq-preview";
  let effort = o.effort;
  let system = o.system;
  let context;
  // Keys in the public preview often only have the decision model, which answers yes/no questions instead of chatting.
  const decision = () => model.startsWith("subq-snap");
  if (!o.model) {
    try {
      const { data = [] } = await (await api("/models")).json();
      const ids = data.map((m) => m.id);
      if (!ids.includes(model)) model = ids.find((id) => id.startsWith("subq-snap")) ?? model;
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
    }
  }
  // The chat-only commands are left out of the lists while a judgment model is selected.
  const shown = () => TUI_HELP.filter(([cmd]) => !decision() || !/^\/(effort|system)/.test(cmd));
  const HOW = "Ask a yes/no question. Add `| text` or @file to judge something.\nOr give options: Which team? [billing, tech]  How urgent? [low < mid < high]";
  let messages = [];
  let busy = false;
  let picking = false;
  let secret = false;
  let menuRows = 0;
  let controller;
  let lastInterrupt = 0;
  const total = { in: 0, out: 0 };

  const banner = () => {
    const rows = [
      `${LOGO[0]}  ${bold("SubQ")} ${faint(`community CLI v${version}`)}`,
      `${LOGO[1]}  ${faint(`model: ${model}`)}`,
      `${LOGO[2]}  ${faint(`cwd: ${process.cwd().replace(homedir(), "~")}`)}`,
      "",
      faint("/ commands · @ files · ! shell · Esc to interrupt"),
      ...(decision() ? HOW.split("\n").map(faint) : []),
    ];
    const inner = Math.max(...rows.map(width));
    console.log(gray(`┌${"─".repeat(inner + 2)}┐`));
    for (const row of rows) console.log(`${gray("│")} ${row}${" ".repeat(inner - width(row))} ${gray("│")}`);
    console.log(gray(`└${"─".repeat(inner + 2)}┘`));
  };
  const note = (text, paintFn = faint) => console.log(paintFn(`  ⎿ ${text.replaceAll("\n", "\n    ")}`));
  const count = (usage, inKey, outKey) => {
    total.in += usage[inKey] ?? 0;
    total.out += usage[outKey] ?? 0;
    note(`${usage[inKey]} in, ${usage[outKey]} out, ${total.in + total.out} tokens this session`);
  };

  const spinner = () => {
    const began = Date.now();
    let i = 0;
    // One square stepping through the logo's five colours.
    const draw = () =>
      process.stdout.write(
        `\r${squares[i++ % squares.length]("■")} ${faint(`${decision() ? "Judging" : "Thinking"}… ${Math.floor((Date.now() - began) / 1000)}s`)}`,
      );
    draw();
    const timer = setInterval(draw, 120);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write("\r\x1b[K");
    };
  };

  // Runs one request with the spinner, Ctrl-C interrupt and error display. Returns false if it did not finish.
  const run = async (work) => {
    busy = true;
    controller = new AbortController();
    const stop = spinner();
    try {
      await work(stop, controller.signal);
      return true;
    } catch (e) {
      stop();
      if (controller.signal.aborted) note("Interrupted");
      else if (e instanceof Fail) note(e.message.replace("Run `subq models`", "Type /model"), red);
      else throw e;
      return false;
    } finally {
      busy = false;
    }
  };

  // Replaces @path mentions with the file's contents. Anything that is not a readable file is left alone.
  const attach = (input) => {
    const docs = [];
    const images = [];
    const names = [];
    const text = input.replace(/(^|\s)@(\S+)/g, (whole, lead, raw) => {
      for (const name of [raw, raw.replace(/[?.,!;:]+$/, "")]) {
        const path = name.replace(/^~/, homedir());
        const mediaType = MEDIA[extname(path).toLowerCase()];
        try {
          if (mediaType) images.push({ mediaType, base64: readFileSync(path).toString("base64") });
          else docs.push(`${name}:\n${readFileSync(path, "utf8")}`);
        } catch {
          continue;
        }
        names.push(name);
        return `${lead}${raw}`;
      }
      return whole;
    });
    if (names.length) note(`attached ${names.join(", ")}`);
    return { text, docs: docs.join("\n\n"), images };
  };

  const shell = (command) => {
    const r = spawnSync(command, { shell: true, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 10 * 1024 * 1024 });
    if (r.error) return note(r.error.message, red);
    const text = `${r.stdout}${r.stderr}`.trimEnd();
    if (!text) return note(`exit ${r.status}, no output`);
    console.log(text);
    context = `$ ${command}\n${text}`;
    note(`exit ${r.status}. Your next messages are about this output (/file off to drop it)`);
  };

  // Arrow-key list. Resolves with the chosen item, or null on Esc.
  const pick = (title, items, start) =>
    new Promise((resolve) => {
      let at = Math.max(0, start);
      picking = true;
      const draw = (first) => {
        if (!first) process.stdout.write(`\x1b[${items.length + 1}A`);
        process.stdout.write(`\x1b[J${faint(title)}\n`);
        const wide = Math.max(...items.map((item) => item.label.length));
        items.forEach((item, i) => {
          const label = item.label.padEnd(wide);
          console.log(`${i === at ? accent("❯") : " "} ${i === at ? bold(label) : label}  ${faint(item.hint)}`);
        });
      };
      const onKey = (_s, key = {}) => {
        if (key.name === "up" || key.name === "k") at = (at + items.length - 1) % items.length;
        else if (key.name === "down" || key.name === "j") at = (at + 1) % items.length;
        else if (key.name === "return" || key.name === "escape" || (key.ctrl && key.name === "c")) {
          process.stdin.off("keypress", onKey);
          process.stdout.write(`\x1b[${items.length + 1}A\x1b[J`);
          rl.write(null, { ctrl: true, name: "u" }); // drop what readline collected from those keys
          picking = false;
          return resolve(key.name === "return" ? items[at] : null);
        } else return;
        draw();
      };
      process.stdin.on("keypress", onKey);
      draw(true);
    });

  const say = async (input) => {
    const { text: typed, docs, images } = attach(input);
    if (images.length) note("Images only work with subq-snap-preview; sending the text only.");
    const content = docs ? `${typed}\n\n${docs}` : typed;
    messages.push({ role: "user", content });
    const prelude = [system, context && `Use this document to answer:\n\n${context}`].filter(Boolean).join("\n\n");
    let started = false;
    const done = await run(async (stop, signal) => {
      try {
        const { text, usage } = await streamChat(
          {
            model,
            messages: prelude ? [{ role: "system", content: prelude }, ...messages] : messages,
            ...(effort && { reasoning_effort: effort }),
          },
          (delta) => {
            if (!started) {
              stop();
              process.stdout.write(accent("■ "));
              started = true;
            }
            process.stdout.write(delta);
          },
          signal,
        );
        stop();
        if (started) process.stdout.write("\n");
        else note("Empty response. If reasoning used the whole budget, try /effort none");
        messages.push({ role: "assistant", content: text });
        if (usage) count(usage, "prompt_tokens", "completion_tokens");
      } catch (e) {
        if (started) process.stdout.write("\n");
        throw e;
      }
    });
    if (!done) messages.pop();
  };

  const judge = (input) => {
    const { text, docs, images } = attach(input);
    const cut = text.indexOf("|");
    const instructions = (cut < 0 ? text : text.slice(0, cut)).trim();
    const given = [cut < 0 ? "" : text.slice(cut + 1).trim(), docs].filter(Boolean).join("\n\n");
    const state = given || context || (images.length ? "See the attached image." : "No additional context was provided.");
    if (!instructions) return note("usage: Is this spam? | You won a free cruise");
    // A trailing [a, b, c] makes it a choice, [low < mid < high] a scale.
    const q = { type: "noul", instructions };
    const tail = instructions.match(/^(.*\S)\s*\[([^\[\]]+)\]$/s);
    const levels = tail ? tail[2].split("<").map((x) => x.trim()).filter(Boolean) : [];
    if (levels.length > 1) Object.assign(q, { type: "score", instructions: tail[1], criteria: levels });
    else if (tail && list(tail[2]).length > 1) Object.assign(q, { type: "choice", instructions: tail[1], criteria: options(tail[2]) });
    return run(async (stop, signal) => {
      const body = { model: decision() ? model : "subq-snap-preview", state, questions: { answer: q }, ...(images.length && { images }) };
      const out = await (await api("/systemone", body, undefined, signal)).json();
      stop();
      const a = out.answers?.answer;
      if (a?.[a.type] == null) fail(`Unexpected response: ${JSON.stringify(out)}`);
      const bar = (p) => accent("█".repeat(Math.round(p * 20))) + faint("░".repeat(20 - Math.round(p * 20)));
      const pct = (p) => `${Math.round(p * 100)}%`.padStart(4);
      if (a.type === "noul") console.log(`${accent("■")} ${bold(a.noul >= 0.5 ? "Yes" : "No")}  ${bar(a.noul)} ${pct(a.noul)} yes`);
      else {
        const label = (k) => String(a.legend?.[k] ?? k);
        const rows = Object.entries(a.probabilities ?? {});
        const wide = Math.max(0, ...rows.map(([k]) => label(k).length));
        if (a.type === "choice") console.log(`${accent("■")} ${bold(a.choice)}`);
        else console.log(`${accent("■")} ${bold(label(Math.round(a.score)))}  ${faint(`${round(a.score)} on a 0 to ${levels.length - 1} scale`)}`);
        for (const [k, p] of rows) console.log(`  ${label(k).padEnd(wide)}  ${bar(p)} ${pct(p)}`);
      }
      if (out.usage) count(out.usage, "input_tokens", "output_tokens");
    });
  };

  const slash = async (line) => {
    const [typed, ...words] = line.split(" ");
    const arg = words.join(" ").trim();
    // A unique prefix is enough: /mo runs /model.
    const matches = names.filter((n) => n.startsWith(typed));
    const name = !names.includes(typed) && matches.length === 1 ? matches[0] : typed;
    if (name === "/help") for (const [cmd, what] of shown()) console.log(`  ${accent(cmd.padEnd(26))} ${faint(what)}`);
    else if (name === "/clear") {
      messages = [];
      context = undefined;
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      banner();
    } else if (name === "/model" || name === "/models") {
      if (arg) {
        model = arg;
        return note(`model set to ${model}${decision() ? `\n${HOW}` : ""}`);
      }
      let ids;
      if (!(await run(async (stop, signal) => {
        ids = ((await (await api("/models", null, undefined, signal)).json()).data ?? []).map((m) => m.id);
        stop();
      }))) return;
      const items = [...new Set([...ids, ...Object.keys(MODELS)])].map((id) => ({
        id,
        label: id,
        locked: !ids.includes(id),
        hint: [MODELS[id], ids.includes(id) ? id === model && "current" : "not enabled for this key"].filter(Boolean).join(" · "),
      }));
      const choice = await pick("Select a model  ↑↓ move · Enter choose · Esc cancel", items, items.findIndex((i) => i.id === model));
      if (!choice) return note(`model unchanged (${model})`);
      if (choice.locked) return note(`${choice.id} is not enabled for this API key.${choice.id === "subq-preview" ? " SubQ offers it to enterprise accounts only." : ""}`);
      model = choice.id;
      note(`model set to ${model}${decision() ? `\n${HOW}` : ""}`);
    } else if (name === "/effort") {
      if (arg) effort = arg === "off" ? undefined : arg;
      note(`reasoning effort: ${effort ?? "model default"}`);
    } else if (name === "/system") {
      if (arg) system = arg === "off" ? undefined : arg;
      note(`system prompt: ${system ?? "none"}`);
    } else if (name === "/ask") {
      await judge(arg);
    } else if (name === "/file") {
      if (!arg) return note(context ? `${context.length} characters loaded` : "usage: /file notes.txt (or /file off)");
      if (arg === "off") {
        context = undefined;
        return note("file removed");
      }
      try {
        context = readFileSync(arg.replace(/^~/, homedir()), "utf8");
      } catch (e) {
        return note(e.message, red);
      }
      note(`loaded ${arg} (${context.length} characters). Questions are now asked about this file.`);
    } else if (name === "/status") {
      console.log(`  ${faint("version")}  ${version}`);
      console.log(`  ${faint("model")}    ${model} ${faint(`(${decision() ? "judgments" : "chat"})`)}`);
      console.log(`  ${faint("api key")}  ${process.env.SUBQ_API_KEY ? "SUBQ_API_KEY environment variable" : CONFIG}`);
      console.log(`  ${faint("api")}      ${BASE}`);
      console.log(`  ${faint("context")}  ${context ? `${context.length} characters` : "none"}`);
    } else if (name === "/cost") {
      note(`${total.in} in, ${total.out} out, ${total.in + total.out} tokens this session. Rates and balance: https://console.subq.ai`);
    } else if (name === "/login") {
      secret = true;
      process.stdout.write("API key (input hidden): ");
      const key = (await rl.question("")).trim();
      if (rl.history[0] === key) rl.history.shift(); // never keep the key in input history
      secret = false;
      process.stdout.write("\n");
      await run(async (stop) => {
        const saved = await saveKey(key);
        stop();
        note(saved + (process.env.SUBQ_API_KEY ? "\nSUBQ_API_KEY is set in your environment and still takes priority." : ""));
      });
    } else if (name === "/logout") {
      rmSync(CONFIG, { force: true });
      note("Saved key removed.");
    } else note(`Unknown command ${name}. Try /help`);
  };

  // Keystrokes typed while a reply is streaming would be echoed into it, so readline's output is muted while busy.
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!busy && !picking && !secret) process.stdout.write(chunk);
      callback();
    },
  });
  Object.defineProperty(output, "columns", { get: () => process.stdout.columns });
  let history = [];
  try {
    history = readFileSync(HISTORY, "utf8").split("\n").filter(Boolean);
  } catch {}
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: true,
    history,
    historySize: 500,
    removeHistoryDuplicates: true,
    completer: (line) => {
      if (/^\/\S*$/.test(line)) {
        // Several matches are already listed under the prompt, so Tab only completes a unique one.
        const hits = names.filter((n) => n.startsWith(line));
        return [hits.length === 1 ? hits : [], line];
      }
      const typed = line.match(/(?:^|\s)@(\S*)$/)?.[1];
      if (typed == null) return [[], line];
      const path = typed.replace(/^~/, homedir());
      const base = path.endsWith("/") ? "" : basename(path);
      try {
        const hits = readdirSync(path.endsWith("/") ? path : dirname(path) || ".", { withFileTypes: true })
          .filter((e) => e.name.startsWith(base) && (base.startsWith(".") || !e.name.startsWith(".")))
          .map((e) => typed.slice(0, typed.length - base.length) + e.name + (e.isDirectory() ? "/" : ""));
        return [hits, typed];
      } catch {
        return [[], typed];
      }
    },
  });

  // Lists matching commands under the prompt while a slash command is being typed.
  const menu = () => {
    if (busy || picking || secret) return;
    const hits = /^\/\S*$/.test(rl.line) ? shown().filter(([cmd]) => cmd.split(" ")[0].startsWith(rl.line)) : [];
    if (!hits.length && !menuRows) return;
    const rows = hits.map(([cmd, what]) => faint(`  ${cmd.padEnd(26)} ${what}`.slice(0, (process.stdout.columns || 80) - 1)));
    menuRows = rows.length;
    // Draw below the prompt, then put the cursor back where the user is typing (the prompt is 2 columns wide).
    process.stdout.write(`\n\x1b[J${rows.join("\n")}\x1b[${Math.max(rows.length, 1)}A\x1b[${rl.cursor + 3}G`);
  };
  process.stdin.on("keypress", (_s, key = {}) => {
    if (key.name === "escape" && busy) return controller.abort();
    if (busy || picking || secret) return;
    if (key.name === "return" || key.name === "enter") {
      if (menuRows) process.stdout.write("\x1b[J");
      menuRows = 0;
      return;
    }
    setImmediate(menu); // after readline has applied the key
  });

  const bye = () => {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(HISTORY, rl.history.filter((h) => h !== "/exit" && h !== "/quit").join("\n") + "\n", { mode: 0o600 });
    } catch {}
    if (total.in + total.out) console.log(faint(`${total.in + total.out} tokens used this session`));
    process.exit(0);
  };
  rl.on("close", () => {
    process.stdout.write("\n\x1b[J");
    bye();
  });
  rl.on("SIGINT", () => {
    if (busy) return controller.abort();
    if (picking || secret) return;
    if (rl.line) {
      rl.write(null, { ctrl: true, name: "u" });
      return setImmediate(menu);
    }
    if (Date.now() - lastInterrupt < 2000) return rl.close();
    lastInterrupt = Date.now();
    process.stdout.write(`\n${faint("Press Ctrl-C again to exit")}\n`);
    rl.prompt();
  });

  banner();
  let pending = "";
  for (;;) {
    if (!pending) console.log();
    const asked = rl.question(pending ? faint("… ") : accent("> "));
    // Anything typed while the last reply was streaming is still in the line; put the cursor after it.
    if (rl.line) rl.write(null, { ctrl: true, name: "e" });
    const line = await asked;
    // A trailing backslash continues the message on the next line.
    if (line.endsWith("\\")) {
      pending += line.slice(0, -1) + "\n";
      continue;
    }
    const input = (pending + line).trim();
    pending = "";
    if (!input) continue;
    if (input === "/exit" || input === "/quit") break;
    if (input === "?") await slash("/help");
    else if (input.startsWith("!")) shell(input.slice(1).trim());
    else if (input.startsWith("/")) await slash(input);
    else if (decision()) await judge(input);
    else await say(input);
  }
  rl.removeAllListeners("close");
  rl.close();
  bye();
}

const commands = { login, logout, models, ask, chat, each, filter: (argv) => each(argv, true) };
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd && process.stdin.isTTY && process.stdout.isTTY) await tui();
  else if (!cmd || ["help", "-h", "--help"].includes(cmd)) console.log(HELP);
  else if (["-v", "--version"].includes(cmd)) console.log(version);
  else if (["-p", "--print"].includes(cmd)) await print(rest);
  else if (Object.hasOwn(commands, cmd)) await commands[cmd](rest);
  else fail(`Unknown command: ${cmd}. Run \`subq help\`.`);
} catch (e) {
  if (!(e instanceof Fail) && !String(e.code).startsWith("ERR_PARSE_ARGS")) throw e;
  console.error(`subq: ${e.message}`);
  process.exit(1);
}
