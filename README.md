# subq-cli

A command-line client for the [SubQ API](https://docs.subq.ai). Paste your API key once, then get yes/no, multiple-choice and scale judgments from your terminal: one at a time, or over thousands of lines.

It is built around `subq-snap-preview`, the model every key has. Chat with `subq-preview` works too, but SubQ offers that model to enterprise accounts only.

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
╭──────────────────────────────────────────────────────────────────────────────╮
│ ✻ subq v0.4.0                                                                │
│                                                                              │
│ / commands · @ files · ! shell · Esc to interrupt                            │
│ model: subq-snap-preview                                                     │
│ Ask a yes/no question. Add `| text` or @file to judge something.             │
│ Or give options: Which team? [billing, tech]  How urgent? [low < mid < high] │
│ cwd: ~/projects/app                                                          │
╰──────────────────────────────────────────────────────────────────────────────╯

> Is this spam? | You won a free cruise, click here to claim
● Yes  ████████████████████  98% yes

> Which team owns this? [billing, tech, sales] | I was charged twice
● billing
  billing  ███████████████████░  97%
  tech     ░░░░░░░░░░░░░░░░░░░░   1%
  sales    ░░░░░░░░░░░░░░░░░░░░   1%

> How urgent is this? [low < medium < high] | The server is down for all customers
● high  1.946 on a 0 to 2 scale
  low     ░░░░░░░░░░░░░░░░░░░░   2%
  medium  ░░░░░░░░░░░░░░░░░░░░   2%
  high    ███████████████████░  96%
```

End a question with `[a, b, c]` to pick one option, or `[low < mid < high]` to rate on a scale. Put the text to judge after a `|`, attach it with `@file`, or leave it out and the model answers from general knowledge.

With an enterprise key that has `subq-preview`, the session opens as a streaming chat.

`/model` opens a picker that also shows models your key does not have.

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

Probabilities, confidence and token usage go to stderr. Use `--json` for the full API response.

For yes/no questions, `-t` turns the answer into an exit code: 0 if the probability is at least the threshold, 1 if not.

```sh
# .git/hooks/pre-commit
if git diff --cached | subq ask -t 0.5 "Does this diff add a password, token or API key?" > /dev/null; then
  echo "This commit may contain a secret."; exit 1
fi
```

## Filter and each: one question over many lines

`subq filter` works like `grep`, but matches on meaning. It reads lines from stdin and prints the ones the answer is yes for.

```sh
subq filter "Is this a complaint?" < reviews.txt
# The app crashes every time I open settings
# I was charged twice this month, refund me now

subq filter -v "Is this a complaint?" < reviews.txt      # the rest
subq filter -t 0.9 "Is this a complaint?" < reviews.txt  # only when 90% sure
```

With `-f`, each line is a path and the file is judged: its text, or the picture if it is an image.

```sh
ls photos/*.jpg | subq filter -f "Is there a person in this photo?"
git ls-files '*.md' | subq filter -f "Does this document mention pricing?"
```

`subq each` prints the answer and the line, separated by a tab, so `sort`, `cut` and `awk` can take it from there.

```sh
subq each "How urgent is this?" --score low,medium,high < tickets.txt | sort -rn | head
# 1.838	I was charged twice this month, refund me now
# 1.717	The app crashes every time I open settings

subq each "Which team owns this?" --choice billing,tech,sales < tickets.txt
# billing	I was charged twice this month, refund me now
```

Each line is one request of about 100 tokens, so 10,000 short lines cost under 10 cents at $0.09 per million tokens. Eight requests run at once (`-j` changes that), output stays in input order, and rate limits are retried. `filter` exits 1 when nothing matched.

## Chat: `subq-preview` (enterprise keys)

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
