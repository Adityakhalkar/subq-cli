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

## Ask: judgments from `subq-snap-preview`

`subq ask <question> [state]` sends one question about a piece of text (the *state*) to the Decisions API. Pass the state as the second argument or pipe it in.

```sh
# Yes/no: prints the probability of yes, from 0 to 1
subq ask "Is this spam?" "You won a free cruise, click here"
# 0.97

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
subq chat                       # interactive, /exit or Ctrl-D to quit
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
