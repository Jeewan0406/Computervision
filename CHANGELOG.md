# Changelog

All notable changes to JeeA! are listed here. The same notes appear in the app under **What's new** (✨).

## 1.4.0 — 2026-11-22 — Answers with fresh facts from the web

### New
- **Web: Auto** — JeeA! decides by itself when a question needs up-to-date facts (news, dates, prices, people in office, versions, results) and searches before the model answers. A 🌐 button in the chat box switches between Auto, On (every message) and Off; the same choice is in Settings → Web search.
- **Sources** — answers that used the web show numbered source chips, and the [1], [2] marks in the answer link to them. Works in Chat, Compare (one search shared by every model) and Team (the same results go to every role). The search can be stopped with the Stop button.
- **Free sources** — Wikipedia article intros, plus Wikipedia's "In the news" and daily "Current events" pages for news questions, through MediaWiki's keyless `origin=*` mode.
- **JeeA Gateway** — new `POST /v1/search` endpoint: with the secret `TAVILY_API_KEY`, the site owner adds full web search for every visitor, cached for 10 minutes and limited per visitor (`SEARCH_PER_MINUTE`, default 6). Returns 501 when no key is set, and the app then uses Wikipedia only.

### Improved
- **Date awareness** — every Chat, Compare and Team request now tells the model today's date and the user's time zone.
- **Logo** — redrawn with far fewer shapes: a bold "J!" speech bubble in gold on a dzong-maroon tile, with a strip of the five prayer-flag colours. Readable as a 16-pixel browser icon. App icons regenerated.

## 1.3.0 — 2026-11-22 — Bhutan colours and more free models

### New
- **Look** — new logo (a chat bubble with three connected model dots and a gold jewel, under the five prayer-flag colours, on a saffron-to-maroon tile) and a Bhutan-inspired **Druk** theme: saffron, gold and maroon, a dzong-white light mode, a prayer-flag ribbon along the top and a faint woven-textile pattern. All text colour pairs were checked for WCAG AA contrast. Existing users on the old default colour move to Druk; other accents remain in Settings.
- **Free providers** — OVHcloud AI Endpoints (no key; 2 requests per minute per IP and per model), Ollama Cloud, Z.ai (GLM flash models) and SiliconFlow (some models free). Providers can now list exactly which models are free, so Free tags stay accurate.
- **JeeA Gateway** — optional Cloudflare Workers AI binding: seven chat models on Cloudflare's free daily allowance with no extra key (streams translated to the OpenAI format), plus optional keys for SambaNova, Hugging Face, Cohere, Ollama Cloud, Z.ai, SiliconFlow and OVHcloud.

## 1.2.0 — 2026-11-22 — More free models, friendlier picker

### New
- **Puter** — hundreds of models (GPT, Claude, Gemini, Llama and more) through a free Puter account. JeeA! needs no key; usage counts against each person's own Puter allowance.
- **JeeA Gateway** (`proxy/jeea-gateway.js`) — a Cloudflare Worker that keeps the site owner's free keys (NVIDIA, Groq, Gemini, Cerebras, Mistral, OpenRouter free models) secret and shares those models with every visitor, with an origin lock and a per-visitor limit. Switched on through `public/jeea.config.json`.

### Improved
- The model picker is now inside the chat box in Chat, Agent and CodeFrame, opens upward, and fits phones.
- Friendly model names ("Llama 3.3 70B", "Gemini 2.5 Flash", "Claude Opus 5.5"), with the source shown for gateway models ("Llama 3.3 70B · NVIDIA").
- A green **Free** tag on free models; type "free" in the picker to see only free models.
- NVIDIA NIM defaults and guidance updated.

### Security
- Puter.js is bundled at a pinned version (2.6.5) and loaded only when chosen; its vulnerable `postal-mime` dependency is forced to the fixed 4.x line (`npm audit`: 0 vulnerabilities).

## 1.1.0 — 2026-11-22 — Agents

### New
- **Agent** — give a goal; the agent plans and uses 13 tools step by step: Wikipedia search and reading, web pages, exact maths, a JavaScript sandbox, date and time, long-term memory, workspace files, creating CodeFrame apps and asking other models. Every step is shown with its arguments, result and timing.
- **Tool calling** — native tool calling for OpenAI-compatible providers and Claude (via Anthropic's SDK, with thinking blocks passed back unchanged), plus an automatic text tool protocol for models without it, including the free model.
- **24/7 agents** — `.github/workflows/agents.yml` runs the tasks in `agents/tasks.json` on GitHub Actions every hour when due, using repository secrets or the free model, and saves Markdown reports to the `agent-results` branch. The Agent page lists the runs, shows each report and has a task builder.

### Security
- Agent code runs in a Web Worker inside a sandboxed iframe without same-origin access, with a time limit.
- The CORS proxy's web-reading mode never forwards your Authorization header to other sites.

### Fixed
- Removed GitHub Models, which GitHub retired on 30 July 2026.
- The model picker now also searches the friendly model names it shows, and offers "use as custom model id" only once.

## 1.0.0 — 2026-11-22 — JeeA! is born

### New
- **Chat** — standard chat with streaming answers, Markdown, tables, code highlighting, a reasoning view, edit-and-resend, regenerate, searchable history, pin, rename and Markdown export.
- **Free model** — chat at once with the shared free Pollinations Classic model. No sign-up and no key.
- **API Slots** — unlimited keys across 16 providers (Gemini, Groq, OpenRouter, Mistral, Cerebras, Hugging Face, Cohere, SambaNova, NVIDIA, OpenAI, Anthropic, DeepSeek, xAI, Together, Ollama and LM Studio), plus your own OpenAI-compatible or Anthropic-style endpoint. Test a key, load live model lists, enable or disable keys, back up and restore.
- **Compare** — one prompt to up to 6 models side by side, with time to first token, total time, speed and token counts; voting, a personal leaderboard and an anonymous AI judge.
- **Team** — different models in different roles: Pipeline, Mixture of Agents and Debate modes, with 5 ready-made teams (Code Squad, Research Desk, Mixture of Agents, Debate Club, Writer's Room).
- **CodeFrame** — describe an app, watch the code stream into the editor and run it in a locked sandbox; device sizes, console capture, "fix these errors", versions, download and fullscreen.
- **Logs** — every request with provider, model, key name, status, latency and tokens; stat tiles, an hourly chart, a per-provider table, filters and CSV/JSON export.
- **Design** — new JeeA! logo, dark and light themes, 5 accent colours, phone layout, installable PWA.

### Scale and reliability
- Static site with no JeeA! server: each browser calls providers directly with its own keys.
- Round-robin key rotation, rate-limit cooldowns that respect `Retry-After`, retries with exponential backoff and jitter, and an automatic fallback chain.
- Per-key concurrency limit, pacing for the shared free model, and an offline cache through a service worker.

### Security
- Keys stay in the browser, with an optional "forget when the tab closes" mode.
- Model output is sanitized before display.
- CodeFrame previews run in a sandboxed iframe without same-origin access.
