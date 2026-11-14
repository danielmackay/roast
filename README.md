# roast

A Claude Code mod for Matt Pocock's grilling skills (`/grill-me`, `/grill-with-docs`). Instead of reading a wall of questions and typing your replies, you answer each round in a pane beside the chat, and roast sends your answers back to Claude for the next round.

## What it does

- When a grilling skill loads, roast asks Claude to hand each round to the pane. If Claude writes the round as text instead, roast reads the `❓ **Q1**` / `➡️` format itself.
- For each question you **agree** or **disagree** with Claude's recommendation, or pick one of the listed options. You can add a comment to any answer, and a comment alone is an answer when nothing else fits.
- **Agree with all recommended** fills every question you haven't touched.
- **Send** submits the round as your next prompt. It won't send while a question is unanswered.
- **History** lists every round of the session and your answers.

## Keys in the pane

| Key | Action |
| --- | --- |
| `a` / `d` | agree / disagree (questions without options) |
| `1`–`9` | pick an option |
| `c` | jump to the comment box |
| `j` / `k` | next / previous question |
| `r` | agree with all recommended |
| `s` | send the round |
| `h` | history |

`/roast` reopens the pane.

Left and right arrows moving between buttons is a keybinding, not part of the mod. Add this to `~/.claude/keybindings.json`:

```json
{ "context": "Pane", "bindings": { "right": "abovePrompt:next", "left": "abovePrompt:previous", "up": null, "down": null } }
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install roast --marketplace danielmackay/roast
```

Answer `y` to add the marketplace, then press Enter to install at the user scope.

From a shell:

```
claude plugin install roast --marketplace danielmackay/roast
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `danielmackay/roast`, then Add plugin.

Needs Matt Pocock's skills plugin for the grilling skills themselves.
