Set Shell zsh
Set FontFamily "Roboto Mono"
Set FontSize 22
Set Width 1280
Set Height 720
Set Padding 36
Set TypingSpeed 40ms
Set Theme { "name": "subq-paper", "background": "#f0ede8", "foreground": "#0f0e0d", "cursor": "#e04e1f", "selection": "#d8d4cc", "black": "#0f0e0d", "red": "#c8321e", "green": "#3f7d31", "yellow": "#b8860b", "blue": "#0834bc", "magenta": "#7a3fa0", "cyan": "#2a7a7a", "white": "#57534a", "brightBlack": "#928e84", "brightRed": "#e04e1f", "brightGreen": "#3f7d31", "brightYellow": "#e8b53c", "brightBlue": "#2d5bff", "brightMagenta": "#7a3fa0", "brightCyan": "#2a7a7a", "brightWhite": "#0f0e0d" }
Hide
Type `cd work && export COLORTERM=truecolor PS1='%F{202}$%f ' && subq() { node ../../bin/subq.js "$@" } && clear`
Enter
Sleep 500ms
Show
Type "subq"
Enter
Sleep 2.5s
Type "Is this spam? | You won a free cruise, click here to claim"
Enter
Sleep 3s
Type "Which team owns this? [billing, tech, sales] | I was charged twice"
Enter
Sleep 3.5s
Type "How urgent is this? [low < medium < high] | The server is down for everyone"
Enter
Sleep 4s
Type "/"
Sleep 2.5s
Type "exit"
Enter
Sleep 1s
Hide
Type "clear"
Enter
Show
Type "cat reviews.txt"
Enter
Sleep 2.5s
Type `subq filter "Is this a complaint?" < reviews.txt`
Enter
Sleep 4.5s
Type `subq each "How urgent?" --score low,medium,high < reviews.txt | sort -rn`
Enter
Sleep 6s
Hide
Type "clear"
Enter
Show
Type "git diff --cached | tail -1"
Enter
Sleep 2s
Type `git diff --cached | subq ask -t 0.5 "Does this add a secret?" && echo BLOCKED`
Enter
Sleep 4.5s
Hide
Type "clear"
Enter
Show
Type "npm install -g subq-cli"
Sleep 4s
