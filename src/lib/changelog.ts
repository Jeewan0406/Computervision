/** In-app release log ("What's new"). Mirrors CHANGELOG.md. */
export const APP_VERSION = '1.2.0';

export interface Release {
  version: string;
  date: string;
  title: string;
  items: { tag: 'new' | 'improved' | 'fixed' | 'scale' | 'security'; feature: string; text: string }[];
}

export const CHANGELOG: Release[] = [
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
