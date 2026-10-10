#!/usr/bin/env node
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, extname } from "node:path";
import { createInterface } from "node:readline/promises";

const BASE = (process.env.SUBQ_BASE_URL || "https://api.subq.ai/v1").replace(/\/$/, "");
const CONFIG_DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "subq");
const CONFIG = join(CONFIG_DIR, "config.json");
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const HELP = `subq ${version} - unofficial CLI for the SubQ API

Usage:
  subq login                         Save your API key (get one at https://console.subq.ai)
  subq logout                        Delete the saved key
  subq models                        List models your key can use
  subq ask <question> [state]        Ask subq-snap-preview for a judgment
  subq chat [prompt]                 Chat with subq-preview (no prompt = interactive)

ask options:
  (default)                 yes/no: prints the probability of yes, 0 to 1
  --yes <text>              describe what counts as yes
  --no <text>               describe what counts as no
  --choice <a,b=desc,c>     pick one option: prints the chosen label
  --score <low,mid,high>    2-10 ordered levels: prints a weighted score
  -i, --image <path>        attach a PNG, JPEG or WebP (repeat for up to 4)
  The state is the text being judged: second argument, or piped on stdin.

chat options:
  -s, --system <text>       system prompt
  -e, --effort <level>      reasoning effort, e.g. none, medium, high
  Piped stdin is appended to the prompt.

Common options:
  -m, --model <id>          override the model
  --json                    print the raw API response

Environment:
  SUBQ_API_KEY              overrides the saved key
  SUBQ_BASE_URL             overrides ${"https://api.subq.ai/v1"}

Examples:
  subq ask "Is this spam?" "You won a free cruise, click here"
  cat ticket.txt | subq ask "Which team owns this?" --choice billing,tech,sales
  subq ask "How urgent is this?" --score low,medium,high < ticket.txt
  subq ask "Is the screen cracked?" "Customer photo" -i phone.jpg
  subq chat "Explain SSE in two sentences"
  git diff | subq chat "Write a commit message for this diff"`;

const HINTS = {
  401: "Invalid or missing API key. Run `subq login`.",
  402: "Out of credits. Top up at https://console.subq.ai",
  403: "This API key cannot use that model. Run `subq models` to see what it can use.",
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

async function api(path, body, key = apiKey()) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method: body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${key}`, ...(body && { "Content-Type": "application/json" }) },
      body: body && JSON.stringify(body),
    });
  } catch (e) {
    fail(`Could not reach ${BASE}: ${e.cause?.message || e.message}`);
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

async function login() {
  const key = await readKey();
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
  console.log(`Key verified and saved to ${CONFIG}${note}`);
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

const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

async function ask(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      yes: { type: "string" },
      no: { type: "string" },
      choice: { type: "string" },
      score: { type: "string" },
      image: { type: "string", short: "i", multiple: true },
      model: { type: "string", short: "m", default: "subq-snap-preview" },
      json: { type: "boolean" },
    },
  });
  const [instructions, ...rest] = positionals;
  if (!instructions) fail('Missing question. Example: subq ask "Is this spam?" "You won a free cruise"');
  if (o.choice && o.score) fail("Use --choice or --score, not both.");
  const state = rest.join(" ") || (await readStdin());
  if (!state) fail("Missing state: pass the text to judge as a second argument or pipe it on stdin.");

  const question = { type: "noul", instructions };
  if (o.choice) {
    question.type = "choice";
    question.criteria = Object.fromEntries(
      list(o.choice).map((item) => {
        const [label, ...desc] = item.split("=");
        return [label.trim(), desc.join("=").trim() || null];
      }),
    );
  } else if (o.score) {
    question.type = "score";
    question.criteria = list(o.score);
  } else if (o.yes || o.no) {
    question.criteria = { ...(o.yes && { true: o.yes }), ...(o.no && { false: o.no }) };
  }

  const images = (o.image ?? []).map((path) => {
    const mediaType = MEDIA[extname(path).toLowerCase()] || fail(`${path}: images must be .png, .jpg, .jpeg or .webp`);
    let bytes;
    try {
      bytes = readFileSync(path);
    } catch (e) {
      fail(`${path}: ${e.message}`);
    }
    return { mediaType, base64: bytes.toString("base64") };
  });

  const body = { model: o.model, state, questions: { answer: question }, ...(images.length && { images }) };
  const out = await (await api("/systemone", body)).json();
  if (o.json) return console.log(JSON.stringify(out, null, 2));

  // The answer alone goes to stdout so it pipes cleanly; details go to stderr.
  const a = out.answers?.answer ?? fail(`Unexpected response: ${JSON.stringify(out)}`);
  console.log(a[a.type]);
  const details = [];
  if (a.probabilities) {
    const name = (k) => a.legend?.[k] ?? k;
    details.push(Object.entries(a.probabilities).map(([k, p]) => `${name(k)} ${p}`).join(", "));
  }
  if (a.confidence != null) details.push(`confidence ${a.confidence}`);
  if (out.usage) details.push(`tokens: ${out.usage.input_tokens} in / ${out.usage.output_tokens} out`);
  if (details.length) console.error(dim(details.join(" | ")));
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
  const messages = o.system ? [{ role: "system", content: o.system }] : [];

  const send = async () => {
    const res = await api("/chat/completions", {
      model: o.model,
      messages,
      stream: !o.json,
      ...(o.effort && { reasoning_effort: o.effort }),
    });
    if (o.json) return console.log(JSON.stringify(await res.json(), null, 2));

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
          process.stdout.write(delta);
        }
        if (event.usage) usage = event.usage;
      }
    }
    process.stdout.write("\n");
    if (!text) console.error(dim("(empty response; if reasoning used the whole budget, try --effort none)"));
    if (usage) console.error(dim(`tokens: ${usage.prompt_tokens} in / ${usage.completion_tokens} out`));
    messages.push({ role: "assistant", content: text });
  };

  const prompt = [positionals.join(" "), await readStdin()].filter(Boolean).join("\n\n");
  if (prompt) {
    messages.push({ role: "user", content: prompt });
    return send();
  }
  if (!process.stdin.isTTY) fail('No prompt. Example: subq chat "Explain SSE in two sentences"');

  apiKey();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("close", () => process.exit(0));
  console.error(dim(`${o.model} | /exit or Ctrl-D to quit`));
  for (;;) {
    const line = (await rl.question("> ")).trim();
    if (!line) continue;
    if (line === "/exit" || line === "/quit") break;
    messages.push({ role: "user", content: line });
    try {
      await send();
    } catch (e) {
      if (!(e instanceof Fail)) throw e;
      messages.pop();
      console.error(`subq: ${e.message}`);
    }
  }
  rl.close();
}

const commands = { login, logout, models, ask, chat };
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || ["help", "-h", "--help"].includes(cmd)) console.log(HELP);
  else if (["-v", "--version"].includes(cmd)) console.log(version);
  else if (Object.hasOwn(commands, cmd)) await commands[cmd](rest);
  else fail(`Unknown command: ${cmd}. Run \`subq help\`.`);
} catch (e) {
  if (!(e instanceof Fail) && !String(e.code).startsWith("ERR_PARSE_ARGS")) throw e;
  console.error(`subq: ${e.message}`);
  process.exit(1);
}
