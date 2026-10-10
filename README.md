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

Run `subq` with no arguments to open a session in your terminal. The first time, it asks for your API key.

It picks the mode from what your key can use. If your key has `subq-preview`, it is a chat. If it only has `subq-snap-preview` (the usual case in the public preview), you ask yes/no questions and get a probability back:

```
> Is this spam? | You won a free cruise, click here to claim
● Yes  ████████████████████ 98% yes
  ⎿ 93 in, 0 out, 93 tokens this session
```

Put the text to judge after a `|`, or load a file with `/file` and ask several questions about it. With no text, the model answers from general knowledge.

In chat mode it looks like this:

```
╭────────────────────────────────────────────────────────╮
│ ✻ subq v0.2.1                                          │
│                                                        │
│ /help for commands, Ctrl-C to interrupt, /exit to quit │
│ model: subq-preview                                    │
│ cwd: ~/projects/app                                    │
╰────────────────────────────────────────────────────────╯

> what is a noul?
● A noul is a yes/no gate...
  ⎿ 12 in, 48 out, 60 tokens this session
```

Replies stream as they are generated and the conversation keeps its history. Ctrl-C stops a reply, a trailing `\` continues your message on the next line, and Tab completes commands.

| Command | What it does |
| --- | --- |
| `/model [id]` | list the models your key can use, or switch to one |
| `/effort [level\|off]` | set the reasoning effort (`none` is fastest) |
| `/system [text\|off]` | set or remove the system prompt |
| `/ask <question> \| <text>` | yes/no probability from `subq-snap-preview`, from inside a chat |
| `/file [path\|off]` | load a text file to ask questions about |
| `/clear` | start a new conversation |
| `/exit` | quit (or Ctrl-D) |

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
