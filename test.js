// Runs the CLI against a local mock of the SubQ API. `npm test`
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtempSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("./bin/subq.js", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "subq-test-"));
let server, base, last;

const ANSWERS = {
  noul: { type: "noul", noul: 0.92 },
  choice: { type: "choice", choice: "tech", probabilities: { billing: 0.1, tech: 0.9 }, confidence: 0.8 },
  score: { type: "score", score: 1.86, legend: { 0: "low", 1: "mid", 2: "high" }, probabilities: { 0: 0, 1: 0.14, 2: 0.86 }, confidence: 0.79 },
};

before(async () => {
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    last = { url: req.url, body: raw && JSON.parse(raw) };
    const json = (code, obj) => res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(obj));
    if (req.headers.authorization !== "Bearer sk-good")
      return json(401, { detail: { error_type: "authentication_error", message: "Invalid API key" } });
    if (req.url === "/v1/models") return json(200, { object: "list", data: [{ id: "subq-preview", name: "SubQ Preview" }] });
    if (req.url === "/v1/systemone")
      return json(200, { answers: { answer: ANSWERS[last.body.questions.answer.type] }, usage: { input_tokens: 10, output_tokens: 2 } });
    if (req.url === "/v1/chat/completions") {
      const event = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
      res.writeHead(200, { "content-type": "text/event-stream" });
      // Split one event across two writes to exercise the line buffer.
      const second = event("lo");
      res.write(event("Hel") + second.slice(0, 9));
      await new Promise((r) => setTimeout(r, 20));
      return res.end(second.slice(9) + "data: [DONE]\n\n");
    }
    json(404, { detail: "Not found" });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/v1`;
});
after(() => server.close());

function run(args, { input = "", env = {} } = {}) {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, SUBQ_BASE_URL: base, SUBQ_API_KEY: "sk-good", XDG_CONFIG_HOME: tmp, ...env } },
      (err, stdout, stderr) => resolve({ code: err?.code ?? 0, stdout, stderr }),
    );
    child.stdin.end(input);
  });
}

test("ask: yes/no prints the probability and sends a noul", async () => {
  const r = await run(["ask", "Is this spam?", "free cruise", "--yes", "unsolicited offer"]);
  assert.equal(r.stdout, "0.92\n");
  assert.deepEqual(last.body, {
    model: "subq-snap-preview",
    state: "free cruise",
    questions: { answer: { type: "noul", instructions: "Is this spam?", criteria: { true: "unsolicited offer" } } },
  });
});

test("ask: choice reads state from stdin and parses label=description", async () => {
  const r = await run(["ask", "Which team?", "--choice", "billing=money stuff, tech"], { input: "app crashes\n" });
  assert.equal(r.stdout, "tech\n");
  assert.equal(last.body.state, "app crashes");
  assert.deepEqual(last.body.questions.answer.criteria, { billing: "money stuff", tech: null });
});

test("ask: score sends ordered levels, details go to stderr", async () => {
  const r = await run(["ask", "How urgent?", "server down", "--score", "low,mid,high"]);
  assert.equal(r.stdout, "1.86\n");
  assert.deepEqual(last.body.questions.answer.criteria, ["low", "mid", "high"]);
  assert.match(r.stderr, /high 0\.86.*confidence 0\.79.*tokens: 10 in \/ 2 out/);
});

test("ask: image is sent as bare base64 with a media type", async () => {
  const png = join(tmp, "a.PNG");
  writeFileSync(png, "fake");
  await run(["ask", "Cracked?", "photo", "-i", png]);
  assert.deepEqual(last.body.images, [{ mediaType: "image/png", base64: Buffer.from("fake").toString("base64") }]);
  const bad = await run(["ask", "Cracked?", "photo", "-i", "a.gif"]);
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /must be \.png/);
});

test("ask: missing state fails without calling the API", async () => {
  last = null;
  const r = await run(["ask", "Is this spam?"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Missing state/);
  assert.equal(last, null);
});

test("chat: streams deltas and appends piped stdin to the prompt", async () => {
  const r = await run(["chat", "Summarise", "-e", "none"], { input: "the diff" });
  assert.equal(r.stdout, "Hello\n");
  assert.equal(last.body.stream, true);
  assert.equal(last.body.reasoning_effort, "none");
  assert.deepEqual(last.body.messages, [{ role: "user", content: "Summarise\n\nthe diff" }]);
});

test("login: verifies, saves with 0600, and later commands use the saved key", async () => {
  const noEnv = { env: { SUBQ_API_KEY: "" } };
  const bad = await run(["login"], { input: "sk-bad\n", ...noEnv });
  assert.equal(bad.code, 1);
  assert.match(bad.stderr, /401 Invalid API key[\s\S]*subq login/);

  const ok = await run(["login"], { input: "sk-good\n", ...noEnv });
  assert.equal(ok.code, 0);
  const file = join(tmp, "subq", "config.json");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).apiKey, "sk-good");
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

  assert.equal((await run(["models"], noEnv)).stdout, "subq-preview\tSubQ Preview\n");
  await run(["logout"], noEnv);
  assert.match((await run(["models"], noEnv)).stderr, /No API key/);
});

test("unknown commands and flags exit 1 with a message", async () => {
  assert.equal((await run(["nope"])).code, 1);
  const r = await run(["ask", "q", "s", "--bogus"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /^subq: /);
});
