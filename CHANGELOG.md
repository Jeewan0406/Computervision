# Changelog

All notable changes to JeeA! are listed here. The same notes appear in the app under **What's new** (✨).

## 1.9.0 — 2026-11-24 — Files and pictures that work, thinking levels, more free models, new logo

### Fixed
- **Attach and paste** — attaching `answer.pptx` failed with "looks like a binary file. Only text files can be attached." The message box now reads PDF (pdf.js), Word `.docx` (mammoth), PowerPoint `.pptx` (slide text in order, with speaker notes) and Excel `.xlsx` (every sheet, shared strings, numbers, booleans) in the browser, plus text and code files (`src/lib/extract.ts`). Old `.doc/.ppt/.xls` files get a clear "save as" message.
- **Paste** — copying from Word, PowerPoint, Excel or a web page puts both text and a picture on the clipboard; the box used to take the picture. Text now wins; a screenshot, a copied picture or a copied file is attached (`pasteAction` in `src/lib/attach.ts`).

### New
- **Pictures** in Chat and Compare: paste, drop or attach PNG, JPEG, WebP, GIF, BMP or AVIF. They are resized in the browser to at most 1,568 px and sent as image parts (OpenAI `image_url`, Anthropic base64 `image` blocks); up to 8 newest pictures per request. Sent messages show the pictures and file chips instead of the full file text.
- **Thinking levels** — Low, Medium (default), High, Extra high, Max (`src/lib/thinking.ts`, picker in every message box). Written critical-thinking steps grow with the level for every model. Claude gets `output_config.effort` where the model supports it (all five levels on the Claude 5 family and Opus 4.7/4.8; no Extra high on 4.6; Opus 4.5 up to High); OpenAI o-series and GPT-5 models get `reasoning_effort` (low/medium/high), retried without it if refused. At Max, Chat runs a second pass: the model reviews its first answer and writes the improved one; the first answer stays in the reasoning panel.
- **Free models without a key**, checked on 2026-11-24 from GitHub's servers with `agents/probe-free.mjs` (workflow "Check free models"):
  - OVHcloud AI Endpoints: model list updated to the live one (33 models; chat models include Llama 3.3 70B, gpt-oss 120B/20B, Qwen3.5 397B, DeepSeek V4.1 Flash, Mistral Small 3.2, Gemma 4, Qwen VL vision models).
  - AI Horde (`oai.aihorde.net`, anonymous key): works and allows browser calls, but answers took about 50 seconds; volunteers run the models and could see prompts; unfiltered community models are hidden.
  - WebLLM (`@mlc-ai/web-llm` 0.2.87): open models run on the visitor's GPU through WebGPU, in a Web Worker; downloaded once (about 0.7–5 GB). Small models get a short system text with the date and web results (`src/lib/small.ts`).
  - Chrome built-in AI (Gemini Nano): used only when the browser offers the `LanguageModel` Prompt API; detected at run time.
  - Not added: Kilo AI Gateway free models work without a key but send no CORS headers, so browsers cannot call them — the JeeA Gateway now forwards them instead (`kilo:` models; set `KILO_FREE=off` to hide). LLM7, OpenRouter and Pollinations' new gateway now return 401 without a key; mlvoca returned 403 and apifreellm 404.

### Improved
- **Logo** — the owner's new design (a head with a network brain). The mark is a mask image, so it takes the theme's text colour; new favicon (PNG), Apple touch icon and app icons; service-worker cache `jeea-v3`.

## 1.8.1 — 2026-11-24 — Settings always within reach

### Fixed
- On laptop windows about 650 pixels tall or less, the bottom of the left panel (Settings, What's new, theme, GitHub) was pushed below the window after Projects moved to the top, and the panel could not scroll. The middle of the panel now scrolls and the bottom bar always stays visible.

### Improved
- A ⚙ Settings button now sits at the top right of every page.
- On very narrow phones (320 px), top-bar buttons get smaller so nothing runs off the screen.

## 1.8.0 — 2026-11-24 — One big instructions box, a stricter answer standard, projects on top

### New
- **Answer standard** (`src/lib/standard.ts`) — always sent to every model in Chat, Compare, Team and Agent: length that fits the question; only trusted, recent sources (research, institutions, news organisations, leading manufacturers; never Wikipedia, blogs, forums, social media or unverified sites); two or more sources per key claim; facts and figures with units and dates; APA 7th citations and a reference list; "(unverified)" when nothing trusted is found.
- **Company sources** — new `maker` source type. The trusted-news job reads the newsrooms of NVIDIA, Microsoft, Google, Apple, Samsung, Siemens, Toyota, OpenAI, Huawei and GE Vernova (first run: 578 items from 37 of 41 sources; Intel, IBM, ABB and Schneider Electric removed). The gateway's trusted-site list adds ISO, IEC and leading manufacturers.

### Improved
- **Custom instructions** — one box of up to 50,000 characters with a live character and token count; text from the old two boxes is kept (settings migration v4).
- **More sources** — up to 12 results per question (was 8): up to 9 from the trusted-news index for news questions (7 otherwise) and 5 from OpenAlex.
- **Projects** — the project switcher, with New project and settings buttons, is at the top of the left panel on every page.

## 1.7.0 — 2026-11-24 — Custom instructions and projects

### New
- **Custom instructions** — Settings → Custom instructions: *What should JeeA! know about you?* and *How should JeeA! respond?* (up to 4,000 characters each), sent to every conversation in Chat, Compare, Team, Agent and CodeFrame, with a switch per area.
- **Projects** — conversations grouped with shared instructions and files. A project switcher sits at the top of the conversation list; new conversations join the selected project; any conversation can be moved in or out. The description is private and never sent. Files: text, code, PDF (pdf.js, with page numbers) and Word (mammoth), read in the browser and kept in IndexedDB.
- **Passages for large files** — when files exceed the chosen space (Small, Medium, Large), only the passages most related to the question are sent, labelled with file and page.

### Improved
- Every request states which instruction wins: answer rules' hard rules first, then this conversation, the project, and the custom instructions. Badges under the chat box show the active layers.
- The PDF reader's worker is saved as .js so every static host serves it as JavaScript.

## 1.6.0 — 2026-11-24 — Trusted sources, APA 7th, documents and images

### New
- **Trusted-news index** — a *Trusted News* GitHub Actions job (`.github/workflows/news.yml`, hourly) reads feeds from intergovernmental bodies, governments, leading journals and established news organisations (`agents/feeds.json`) and publishes `latest.json` to the `news-data` branch, which is replaced on every run. In its first runs, 27 of 39 candidate sources worked; the 12 that refused or no longer exist were removed.
- **APA 7th citations** — every source gets a ready in-text citation and reference (`src/lib/apa.ts`), with a, b, c letters for the same author and year in title order. Models copy them.
- **Export** — Word (.docx), PDF (print), Excel (.xlsx), PowerPoint (.pptx), Markdown and images (PNG, JPG, SVG) for any answer or a whole chat. Libraries load only when used.
- **Images page** — image generation with Puter (free with an account), the JeeA Gateway (FLUX.1 [schnell] on Workers AI, new `/v1/images/generations` endpoint) or your own OpenAI key; PNG, JPG and WebP downloads; a local gallery.

### Improved
- **Sources** — Wikipedia removed; blogs, forums and social media filtered out everywhere; the gateway's search is limited to trusted sites. A setting can leave out news organisations.
- **Answer quality** — the app note tells models to use two or more sources per key claim, and to list only events found in the results, with dates, never inventing times, places or numbers.
- **Agent** — the Wikipedia tools are off by default (still available in the Tools list).

## 1.5.0 — 2026-11-24 — Your answer rules, and the web for every question

### New
- **Answer rules** — the site owner's rules (`src/rules/answer-rules.md`, kept word for word) go to every model in Chat, Compare, Team and Agent, with a short note (`src/rules/jeea-context.md`) on how to apply them inside JeeA!: only the numbered web results count as opened sources, Wikipedia never counts as evidence, scholarly results show only the abstract, and there is no widget tool. Settings → Answer rules can switch them off, edit them (saved in the browser) or reset them. They add about 8,600 tokens per request.
- **Web search for every question** — On is now the default (existing "Auto" users are moved to On). Every question in Chat, Compare, Team and Agent is searched first; bare greetings are skipped. Auto and Off remain.
- **Research sources** — OpenAlex scholarly works with abstracts, from the last 2 years (widened to 5 when fewer than 2 are found), without retracted works. Results are labelled with their type, authors, date, journal, DOI and the part shown; source chips show author and year.
- **Maths** — LaTeX in answers (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`, `\boxed`, `\textcolor`) is rendered with KaTeX, loaded only when a message needs it. Prices such as "$5 and $10" are left as text.

### Improved
- A "request too long" error now explains that the answer rules add about 8,600 tokens and how to fix it.
- Agent answers now show their web sources.

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
