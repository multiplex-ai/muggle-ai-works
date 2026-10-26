# LLM source

Who supplies the model for tests Studio runs on this computer: Muggle AI credit (default), the user's own Anthropic API key, or a local / self-hosted model. Cloud runs always use Muggle AI credit.

The CLI owns the options, labels, and storage. Render what `muggle llm-source --json` returns — never hardcode labels, and never write `preferences.json` or the credentials file directly.

**Never collect an API key in chat.** A key typed here lands in the conversation transcript. The key is accepted only at the CLI's hidden terminal prompt.

## Step 1 — load the question

Run `muggle llm-source --json`. It returns `header`, `prompt`, `scopeNote`, `options` (each `source`, `label`, `description`), and `current` (the source in effect; any key is already masked).

## Step 2 — ask

One `AskUserQuestion`: `header` = `header`, question text = `prompt` followed by `scopeNote`, one option per entry in `options` using `label` and `description`. Pre-select the option whose `source` equals `current.source`.

## Step 3 — apply

| Picked `source` | Do |
| :-------------- | :- |
| `current.source` again | Nothing to change. Say which source stays in effect. |
| `muggle-credit` | `muggle llm-source --use muggle-credit` |
| `local-model` | Ask in chat for the endpoint URL and the vision-capable model name (neither is secret), then `muggle llm-source --use local-model --base-url <url> --model <name>`. If the endpoint needs its own key, tell the user to run `muggle llm-source` in a terminal instead. |
| `anthropic-api-key` | Do not run anything. Tell the user to run `muggle llm-source` in their own terminal and paste the key at the hidden prompt. |

## Step 4 — confirm

Print the line the CLI reported. To show the source later: `muggle llm-source --show`.
