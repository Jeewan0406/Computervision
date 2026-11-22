# Changelog

All notable changes to JeeA! are listed here. The same notes appear in the app under **What's new** (✨).

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
