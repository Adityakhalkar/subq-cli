# subq-cli

A command-line client for the [SubQ API](https://docs.subq.ai). Paste your API key once, then ask and chat from your terminal.

Unofficial: this is a community tool, not made by or affiliated with SubQ.

## Install

Needs Node.js 20 or newer. No other dependencies.

Run it without installing:

```sh
npx subq-cli login
npx subq-cli ask "Is this spam?" "You won a free cruise"
```

Or install it once and use the short `subq` command:

```sh
npm install -g subq-cli
subq login
```

`subq login` asks for your key (create one at [console.subq.ai](https://console.subq.ai)), checks it with one tiny request (about 100 tokens), and saves it to `~/.config/subq/config.json` with owner-only permissions. Setting `SUBQ_API_KEY` in your environment works too and takes priority.

## Interactive session

Run `subq` with no arguments to open a session in your terminal. The first time, it asks for your API key. If you use Claude Code, the keys and commands will feel familiar.

```
╭──────────────────────────────────────────────────────────────────╮
│ ✻ subq v0.3.0                                                    │
│                                                                  │
│ / commands · @ files · ! shell · Esc to interrupt                │
│ model: subq-snap-preview                                         │
│ Ask a yes/no question. Add `| text` or @file to judge something. │
│ cwd: ~/projects/app                                              │
╰──────────────────────────────────────────────────────────────────╯

> Is this spam? | You won a free cruise, click here to claim
● Yes  ████████████████████ 98% yes
  ⎿ 93 in, 0 out, 93 tokens this session
```

It picks the mode from what your key can use:

- **`subq-snap-preview`** (the usual case in the public preview): you ask yes/no questions and get a probability back. Put the text to judge after a `|`, attach it with `@file`, or leave it out and the model answers from general knowledge.
- **`subq-preview`**: a streaming chat that keeps its history.

`/model` opens a picker that also shows models your key does not have yet.

| Type | What it does |
| --- | --- |
| `/` | lists the commands as you type; Tab completes, and a unique prefix like `/mo` is enough |
| `@path` | attaches a text file, or an image (PNG, JPEG, WebP) in question mode. Tab completes paths |
| `!command` | runs a shell command; your next messages are about its output |
| `\` at end of line | continues the message on the next line |
| Esc or Ctrl-C | stops a reply. Ctrl-C twice, Ctrl-D or `/exit` quits |
| ↑ | previous messages, kept between sessions |

| Command | What it does |
| --- | --- |
| `/model` | pick a model |
| `/clear` | start a new conversation |
| `/status` | model, key and connection details |
| `/cost` | tokens used this session |
| `/login`, `/logout` | change or delete the saved API key |
| `/effort [level\|off]` | reasoning effort for chat (`none` is fastest) |
| `/system [text\|off]` | set or remove the chat system prompt |
| `/file [path\|off]` | load a text file to ask several questions about |
| `/ask <question> \| <text>` | yes/no probability, from inside a chat |

For scripts, `subq -p "question"` prints one answer and exits, using chat if your key has it and a yes/no judgment otherwise.

## Ask: judgments from `subq-snap-preview`

`subq ask <question> [state]` sends one question about a piece of text (the *state*) to the Decisions API. Pass the state as the second argument or pipe it in.

```sh
# Yes/no: prints the probability of yes, from 0 to 1
subq ask "Is this spam?" "You won a free cruise, click here"
# 0.981

# Say what counts as yes and no
subq ask "Should a nurse see this?" --yes "breathing trouble or chest pain" --no "stable symptoms" < note.txt

# Pick one option. Add a description with label=description
cat ticket.txt | subq ask "Which team owns this?" --choice "billing=charges and refunds,tech,sales"
# tech

# Score on 2 to 10 ordered levels: prints a probability-weighted score
subq ask "How urgent is this?" --score low,medium,high < ticket.txt
# 1.86

# Attach up to 4 images (PNG, JPEG, WebP)
subq ask "Is the screen cracked?" "Customer photo" -i phone.jpg
```

Only the answer is printed to stdout, so it drops straight into scripts:

```sh
if (( $(subq ask "Is this spam?" "$msg") > 0.8 )); then echo "spam"; fi
```

Probabilities, confidence and token usage go to stderr. Use `--json` for the full API response.

## Chat: `subq-preview`

```sh
subq chat "Explain server-sent events in two sentences"
git diff | subq chat "Write a commit message for this diff"
subq chat -s "Reply in French" -e none "Hello"
```

Responses stream as they are generated. `-s` sets a system prompt and `-e` sets the reasoning effort (`none` is fastest for short answers).

## Other commands

```sh
subq models     # models your key can use
subq logout     # delete the saved key
subq help
```

Every command takes `-m <model>` to override the model. `SUBQ_BASE_URL` overrides the API base URL.

## Development

```sh
npm test        # runs the CLI against a local mock of the API
```

## License

MIT
