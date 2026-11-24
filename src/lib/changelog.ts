/** In-app release log ("What's new"). Mirrors CHANGELOG.md. */
export const APP_VERSION = '1.9.0';

export interface Release {
  version: string;
  date: string;
  title: string;
  items: { tag: 'new' | 'improved' | 'fixed' | 'scale' | 'security'; feature: string; text: string }[];
}

export const CHANGELOG: Release[] = [
  {
    version: '1.9.0',
    date: '2026-11-24',
    title: 'Files and pictures that work, thinking levels, more free models, new logo',
    items: [
      { tag: 'fixed', feature: 'Attach and paste', text: 'PowerPoint (.pptx) and Excel (.xlsx) files no longer fail with "binary file": JeeA! now reads PDF, Word, PowerPoint (with speaker notes), Excel (every sheet), text and code files in your browser. Text copied from Word, PowerPoint or a web page now pastes as text instead of becoming a picture.' },
      { tag: 'new', feature: 'Pictures', text: 'Paste a screenshot, drop a photo or attach an image in Chat and Compare. Pictures are made smaller in your browser and sent to models that can see images (for example Claude, GPT, Gemini, or the free Qwen VL models on OVHcloud).' },
      { tag: 'new', feature: 'Thinking levels', text: 'A 🧠 picker in every message box: Low, Medium, High, Extra high and Max. Higher levels give every model written critical-thinking steps (split the problem, check assumptions and numbers, give counter-arguments, compare options and sources). Claude and OpenAI reasoning models also get their real effort setting. At Max, Chat makes the model check its first answer as a strict reviewer and rewrite it.' },
      { tag: 'new', feature: 'Free models', text: 'Checked from GitHub\'s servers today: OVHcloud (no key) now lists its current models, including Llama 3.3 70B, gpt-oss 120B, Qwen3.5 397B and DeepSeek V4.1 Flash. New: AI Horde (volunteer community, no key, slow), and two kinds of models that run inside your own browser with no server at all: WebLLM (Llama, Qwen, Phi, Gemma; needs WebGPU) and Chrome\'s built-in Gemini Nano where Chrome offers it.' },
      { tag: 'new', feature: 'Gateway', text: 'The JeeA Gateway can now pass on Kilo AI Gateway\'s free models with no key (Kilo blocks direct browser calls).' },
      { tag: 'improved', feature: 'Logo', text: 'The new JeeA! logo: a head whose brain is a network of linked nodes. It follows the light and dark themes, and the browser and phone icons use it too.' },
    ],
  },
  {
    version: '1.8.1',
    date: '2026-11-24',
    title: 'Settings always within reach',
    items: [
      { tag: 'fixed', feature: 'Settings', text: 'On laptop screens about 650 pixels tall or less, the bottom of the left panel (Settings, What\'s new, theme) was pushed below the window after Projects moved to the top. The panel\'s middle now scrolls and the bottom bar always stays visible.' },
      { tag: 'improved', feature: 'Settings button', text: 'Every page now also has a ⚙ Settings button at the top right, so Settings is one tap away on phones too.' },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-11-24',
    title: 'One big instructions box, a stricter answer standard, projects on top',
    items: [
      { tag: 'improved', feature: 'Custom instructions', text: 'Now one box that holds up to 50,000 characters, with a live character and token count. Text from the old two boxes was kept and joined.' },
      { tag: 'new', feature: 'Answer standard', text: 'Every model in Chat, Compare, Team and Agent now follows JeeA!\'s answer standard: length that fits the question (short, medium or long), only trusted and recent sources (research, institutions, news organisations, leading manufacturers; never Wikipedia, blogs or unverified sites), two or more sources per key claim, facts and figures with dates and units, and APA 7th citations with a reference list.' },
      { tag: 'new', feature: 'Company sources', text: 'The hourly trusted-news job now also reads the newsrooms of NVIDIA, Microsoft, Google, Apple, Samsung, Siemens, Toyota, OpenAI, Huawei and GE Vernova (578 items from 37 sources in the first run). The gateway\'s trusted-site search adds standards bodies and leading manufacturers.' },
      { tag: 'improved', feature: 'More sources', text: 'Each search now gives models up to 12 results (was 8), so claims can be backed by several sources.' },
      { tag: 'improved', feature: 'Projects', text: 'The project switcher, with New project and settings buttons, is now at the top of the left panel and visible on every page.' },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-11-24',
    title: 'Custom instructions and projects',
    items: [
      { tag: 'new', feature: 'Custom instructions', text: 'Tell JeeA! once about yourself and how you want answers (Settings → Custom instructions). They apply to every conversation in Chat, Compare, Team, Agent and CodeFrame; each area can be switched off.' },
      { tag: 'new', feature: 'Projects', text: 'Group related conversations in a project with its own instructions and files (text, code, PDF with page numbers, Word). Every chat in the project uses them; chats do not see each other. Switch projects at the top of the conversation list, and move any conversation into a project.' },
      { tag: 'new', feature: 'Large files', text: 'When a project\'s files are bigger than the space chosen for them, each question gets only the passages most related to it, labelled with file name and page, so models can cite them.' },
      { tag: 'improved', feature: 'Clear order', text: 'Models are told which instruction wins: the answer rules\' hard rules first, then the most specific (this chat, then the project, then your custom instructions). Badges under the chat box show which ones are active.' },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-11-24',
    title: 'Trusted sources, APA 7th, documents and images',
    items: [
      { tag: 'new', feature: 'Trusted news', text: 'Every hour, this site\'s GitHub job collects news and releases from trusted organisations: UN News, ReliefWeb, NASA, ESA, the European Commission, GOV.UK and the CDC, new papers from Nature, Science, The Lancet, NEJM, BMJ, PNAS, PLOS ONE and Cell, and reports from BBC News, NPR, DW, Al Jazeera, France 24, The Guardian, CBC and BBS. Questions about recent events are answered from these, with several sources and their dates.' },
      { tag: 'improved', feature: 'Sources', text: 'Wikipedia is no longer used. Blogs, forums and social media are filtered out everywhere, including the gateway\'s web search. A setting can leave out news organisations, so only official and scholarly sources are used.' },
      { tag: 'new', feature: 'APA 7th', text: 'Every source now comes with a ready APA 7th in-text citation, such as (United Nations, 2026a), and a reference entry, which models copy. Same author and year get a, b, c letters in title order.' },
      { tag: 'new', feature: 'Export', text: 'Any answer, or a whole chat, can be saved as a Word document, PDF, Excel workbook (tables, text and sources), PowerPoint slides, Markdown, or an image (PNG, JPG, SVG). Coloured citations stay coloured in Word and PowerPoint.' },
      { tag: 'new', feature: 'Images', text: 'A new Images page makes pictures from a description: free with a Puter account (GPT Image, Gemini, FLUX, Grok), free for visitors through the JeeA Gateway (FLUX on Cloudflare), or with your own OpenAI key. Download as PNG, JPG or WebP.' },
      { tag: 'improved', feature: 'Answer quality', text: 'Models are told to list only events found in the sources, with their dates, and never to invent times, places or numbers.' },
      { tag: 'improved', feature: 'Agent', text: 'The Wikipedia tools are now off by default (they stay in the Tools list), and agents get the same trusted search results as Chat.' },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-11-24',
    title: 'Your answer rules, and the web for every question',
    items: [
      { tag: 'new', feature: 'Answer rules', text: 'The site owner\'s answer rules (plain English, checked and cited sources, honesty, Checks lines and more) now go to every model in Chat, Compare, Team and Agent. A short note tells the models how the rules work inside JeeA!: they can only cite the web results they were given, Wikipedia does not count as evidence, and there are no widgets. Switch them off or edit them in Settings → Answer rules.' },
      { tag: 'new', feature: 'Web for every question', text: 'Web search is now On by default and runs before every question in Chat, Compare, Team and Agent (greetings such as "hi" are skipped). Auto and Off are still on the 🌐 button.' },
      { tag: 'new', feature: 'Research sources', text: 'Recent scholarly works with their abstracts from OpenAlex (last 2 years, widened to 5 when too few), shown with authors, year and journal. Each result is labelled with its type, so models can judge it.' },
      { tag: 'new', feature: 'Maths', text: 'Answers now show LaTeX maths, boxed formulas and coloured citations ($...$, $$...$$, \\textcolor). The maths library loads only when a message needs it.' },
      { tag: 'improved', feature: 'Clear errors', text: 'When a model refuses a request because it is too long, the error now explains that the answer rules add about 8,600 tokens and how to fix it.' },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-22',
    title: 'Answers with fresh facts from the web',
    items: [
      { tag: 'new', feature: 'Web: Auto', text: 'JeeA! now decides by itself when a question needs up-to-date facts (news, dates, prices, people in office, versions, results) and searches the web before the model answers. No button to press. The 🌐 button in the chat box switches between Auto, On (every message) and Off.' },
      { tag: 'new', feature: 'Sources', text: 'Answers that used the web show numbered source chips you can open, and the [1], [2] marks in the answer link to them. Works in Chat, Compare (one search shared by all models) and Team (shared by every role).' },
      { tag: 'new', feature: 'Free sources', text: 'Wikipedia articles, plus Wikipedia\'s "In the news" and daily "Current events" pages for news questions. No key needed.' },
      { tag: 'new', feature: 'JeeA Gateway', text: 'New /v1/search endpoint: the site owner can add full web search (Tavily) with a secret key; results are cached for 10 minutes and limited per visitor.' },
      { tag: 'improved', feature: 'Date awareness', text: 'Every chat now tells the model today\'s date and your time zone, so "today" and "this year" questions are answered correctly.' },
      { tag: 'improved', feature: 'Logo', text: 'A cleaner logo: a bold "J!" speech bubble on a maroon-to-saffron tile, readable even as a 16-pixel browser icon.' },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-22',
    title: 'Bhutan colours and more free models',
    items: [
      { tag: 'new', feature: 'Look', text: 'New logo and a Bhutan-inspired "Druk" theme: saffron, gold and maroon, a dzong-white light mode, a prayer-flag ribbon and a faint woven-textile pattern. Other colours stay in Settings.' },
      { tag: 'new', feature: 'Free models', text: 'Added OVHcloud AI (no key, 2 requests per minute per model), Ollama Cloud, Z.ai GLM flash models and SiliconFlow free models. Free tags now follow each provider\'s own free list.' },
      { tag: 'new', feature: 'JeeA Gateway', text: 'Can now serve Cloudflare Workers AI models (Llama 3.3 70B, Llama 4 Scout, Mistral Small 3.1, QwQ 32B and more) on Cloudflare\'s free daily allowance, with no extra key, plus optional keys for seven more providers.' },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-11-22',
    title: 'More free models, friendlier picker',
    items: [
      { tag: 'new', feature: 'Puter', text: 'Hundreds of models (GPT, Claude, Gemini, Llama and more) with a free Puter account. No key needed in JeeA!; each person\'s usage counts against their own Puter allowance.' },
      { tag: 'new', feature: 'JeeA Gateway', text: 'The site owner can share free NVIDIA (and Groq, Gemini, Cerebras, Mistral, OpenRouter free) models with every visitor through a small Cloudflare Worker that keeps the keys secret.' },
      { tag: 'improved', feature: 'Model picker', text: 'Now inside the chat box in Chat, Agent and CodeFrame, with friendly names such as "Llama 3.3 70B" and a green Free tag on free models. Type "free" to see only free models.' },
      { tag: 'improved', feature: 'NVIDIA', text: 'Updated NVIDIA NIM defaults and guidance.' },
      { tag: 'security', feature: 'Dependencies', text: 'Puter.js is bundled at a pinned version and loads only when you choose it; a vulnerable email-parser dependency is forced to its fixed version.' },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-22',
    title: 'Agents, in your browser and 24/7 on GitHub',
    items: [
      { tag: 'new', feature: 'Agent', text: 'Give a goal; the agent plans and uses tools step by step: Wikipedia search and reading, web pages, exact maths, a JavaScript sandbox, date and time, long-term memory, workspace files, web-app creation and asking other models. Every step is shown.' },
      { tag: 'new', feature: 'Tool calling', text: 'Native tool calling for OpenAI-compatible providers and Claude, plus an automatic text tool protocol for models without it, including the free model.' },
      { tag: 'new', feature: '24/7 agents', text: 'Scheduled agents run on GitHub Actions in your repository, even when your computer is off. Reports are saved to the agent-results branch and shown in the Agent page.' },
      { tag: 'security', feature: 'Sandbox', text: 'Agent code runs in a Web Worker inside an isolated iframe with a time limit, so it cannot read your keys or freeze the page.' },
      { tag: 'fixed', feature: 'Providers', text: 'Removed GitHub Models, which GitHub retired on 30 July 2026.' },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-22',
    title: 'JeeA! is born',
    items: [
      { tag: 'new', feature: 'Chat', text: 'Standard chat with streaming answers, Markdown, code highlighting, reasoning view, edit-and-resend, regenerate and history.' },
      { tag: 'new', feature: 'Free model', text: 'Chat instantly with a shared free model (Pollinations Classic). No sign-up and no key.' },
      { tag: 'new', feature: 'API Slots', text: 'Add as many keys as you like for 16 providers, plus your own OpenAI-compatible or Anthropic-style endpoint.' },
      { tag: 'new', feature: 'Compare', text: 'Send one prompt to up to 6 models side by side, with speed and token metrics, voting, a leaderboard and an AI judge.' },
      { tag: 'new', feature: 'Team', text: 'Give different models different roles: Pipeline, Mixture of Agents or Debate, with 5 ready-made teams.' },
      { tag: 'new', feature: 'CodeFrame', text: 'Describe an app and watch it being written and run live in a safe sandbox, with editor, console, devices and versions.' },
      { tag: 'new', feature: 'Logs', text: 'Activity log of every request: provider, model, key, status, latency, tokens. Filter and export to CSV or JSON.' },
      { tag: 'scale', feature: 'Reliability', text: 'Key rotation, rate-limit cooldowns, retries with backoff and jitter, and automatic fallback to other models.' },
      { tag: 'scale', feature: 'Architecture', text: 'No server: a static site where each browser calls providers directly, so there is no central bottleneck. Offline cache via a service worker.' },
      { tag: 'security', feature: 'Privacy', text: 'Keys and chats stay in your browser. Optional "forget keys when the tab closes" mode. Generated code runs in an isolated sandbox.' },
    ],
  },
];
