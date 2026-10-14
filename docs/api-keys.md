# Getting an AI key

Marvell, Research, Quant and Predict run on **your own AI key**. A key is a private password from an AI provider. You pay the provider directly; MercerFargo never sees it, and it stays in your browser (it is not synced to your account).

Open **Settings → AI & API keys** (`#/settings/ai`), paste the key into the provider's row, press **Save**, then **Test**. The row says *Connected* when it works. The first key you save becomes your default.

## Steps

1. **Pick a provider.** New here? Start with OpenRouter (it has free models) or Gemini (free tier).
2. **Open its key page** from the table below, sign in or sign up, and create a key. Most providers show it only once, so copy it straight away.
3. **Add credit if asked.** Paid APIs need a balance. A chat subscription (ChatGPT, Claude.ai) does not cover the API.
4. **Paste, Save, Test.**

## Provider key pages

| Provider | Create a key here | Notes |
| --- | --- | --- |
| OpenRouter | <https://openrouter.ai/settings/keys> | One key, many models. Models marked *free* cost nothing; buy credits at <https://openrouter.ai/settings/credits> for the rest. Best first choice. |
| OpenAI | <https://platform.openai.com/api-keys> | Billed separately from ChatGPT. Add prepaid credit under Billing first. |
| Anthropic | <https://platform.claude.com/settings/keys> | Billed separately from Claude.ai. Buy credits under Billing first. |
| xAI (Grok) | <https://console.x.ai> | Open *API Keys* in the console. Add credits before it works. |
| Gemini | <https://aistudio.google.com/apikey> | Sign in with Google. Free tier with rate limits. |
| DeepSeek | <https://platform.deepseek.com/api_keys> | Top up your balance at <https://platform.deepseek.com/top_up>. |
| Groq | <https://console.groq.com/keys> | Free tier with rate limits. |
| OpenCode Go | <https://opencode.ai/auth> | Subscribe to Go, copy the key. Works only on the *OpenCode Go* provider. |
| OpenCode Zen | <https://opencode.ai/auth> | Add balance, copy the key. Works only on the *OpenCode Zen* provider. |
| Custom | your own endpoint | Any OpenAI-compatible chat-completions URL, e.g. a local Ollama (`http://localhost:11434/v1/chat/completions`) or LM Studio. Paste the URL under the key box; local servers accept any text as the key. |

## If Test fails

- **401 / invalid key:** re-copy the key, with no spaces, into the right provider's row.
- **402 / quota / insufficient balance:** add credit on the provider's billing page.
- **404 / model not found:** pick another model in the model picker.
- **Blocked or network error:** some providers refuse direct browser calls; try OpenRouter or Gemini.

Keep keys private. If one leaks, delete it on the provider's key page and create a new one. Provider pages and prices change, so check their own docs if a step looks different.
