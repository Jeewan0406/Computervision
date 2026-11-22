/**
 * Friendly model names and "Free" detection. Pure functions (no imports),
 * so they can be unit-tested in Node.
 *
 *   "meta/llama-3.3-70b-instruct"            -> "Llama 3.3 70B"
 *   "gemini-2.5-flash"                       -> "Gemini 2.5 Flash"
 *   "claude-opus-5-5"                        -> "Claude Opus 5.5"
 *   "openai/gpt-oss-120b"                    -> "GPT-OSS 120B"
 *   "nvidia:deepseek-ai/deepseek-r1"         -> "DeepSeek R1"
 */

const FAMILY: Record<string, string> = {
  gpt: 'GPT', claude: 'Claude', gemini: 'Gemini', gemma: 'Gemma', llama: 'Llama', qwen: 'Qwen', qwq: 'QwQ',
  deepseek: 'DeepSeek', mistral: 'Mistral', mixtral: 'Mixtral', codestral: 'Codestral', ministral: 'Ministral',
  magistral: 'Magistral', pixtral: 'Pixtral', devstral: 'Devstral', grok: 'Grok', command: 'Command', nemotron: 'Nemotron',
  phi: 'Phi', kimi: 'Kimi', glm: 'GLM', granite: 'Granite', olmo: 'OLMo', yi: 'Yi', jamba: 'Jamba', sonar: 'Sonar',
  aya: 'Aya', lfm: 'LFM', hermes: 'Hermes', dolphin: 'Dolphin', minimax: 'MiniMax', fable: 'Fable', mythos: 'Mythos',
};

const UPPER = new Set(['oss', 'vl', 'r1', 'r2', 'v2', 'v3', 'v4', 'ai', 'it', 'moe', 'xl', 'xxl', 'a', 'r', 'sql']);
const DROP = new Set(['instruct', 'it', 'hf', 'versatile', 'latest', 'meta', 'base', 'fp8', 'gguf', 'awq', 'free', 'cloud']);

const ROUTES = /^(nvidia|groq|gemini|openrouter|cerebras|mistral|sambanova|together|huggingface|cohere|deepseek|xai|openai|anthropic|cloudflare|ollama|zai|siliconflow|ovh):/i;

const ROUTE_LABEL: Record<string, string> = {
  nvidia: 'NVIDIA', groq: 'Groq', gemini: 'Gemini', openrouter: 'OpenRouter', cerebras: 'Cerebras', mistral: 'Mistral',
  sambanova: 'SambaNova', together: 'Together', huggingface: 'Hugging Face', cohere: 'Cohere', deepseek: 'DeepSeek',
  xai: 'xAI', openai: 'OpenAI', anthropic: 'Anthropic', cloudflare: 'Cloudflare', ollama: 'Ollama Cloud', zai: 'Z.ai',
  siliconflow: 'SiliconFlow', ovh: 'OVHcloud',
};

/** Source of a gateway model id: "nvidia:meta/llama…" -> "NVIDIA". */
export function routeLabel(id: string): string | null {
  const m = id.match(ROUTES);
  return m ? ROUTE_LABEL[m[1].toLowerCase()] ?? null : null;
}

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);

export function prettyModel(id: string): string {
  if (!id) return '';
  // Drop a gateway route ("nvidia:…"), the org path ("meta/…") and the ":free" suffix.
  let s = id.replace(ROUTES, '');
  s = s.split('/').pop() ?? s;
  s = s.replace(/:free$/i, '').replace(/:/g, '-');
  // "llama3.2" -> "llama-3.2", "gemma3" -> "gemma-3"
  s = s.replace(/([a-z]{3,})(\d)/gi, '$1-$2');
  const raw = s.split(/[-_\s]+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    const lw = w.toLowerCase();
    // Dates and build stamps: 0324, 20250219, 2507, 03-2025
    if (/^\d{4}$/.test(w) && i > 1) continue;
    if (/^\d{6,8}$/.test(w)) continue;
    if (/^\d{2}$/.test(w) && /^\d{4}$/.test(raw[i + 1] ?? '')) continue;
    if (DROP.has(lw) && !(lw === 'meta' && i > 0) && out.length) continue;
    if (lw === 'meta' && i === 0) continue;
    // Merge "5" "5" -> "5.5" (Claude / Fable versions)
    if (/^\d$/.test(w) && /^\d$/.test(raw[i + 1] ?? '') && out.length && !/\d/.test(out[out.length - 1])) {
      out.push(`${w}.${raw[i + 1]}`);
      i++;
      continue;
    }
    if (/^\d+(\.\d+)?[bmk]$/i.test(w)) { out.push(w.toUpperCase()); continue; } // 70b -> 70B
    if (/^a\d+(\.\d+)?b$/i.test(w)) { out.push(w.toUpperCase()); continue; } // a3b -> A3B
    if (FAMILY[lw]) { out.push(FAMILY[lw]); continue; }
    if (UPPER.has(lw)) { out.push(lw.toUpperCase()); continue; }
    if (/^o\d$/i.test(w)) { out.push(lw); continue; } // OpenAI o3, o4
    out.push(/^\d/.test(w) ? w : cap(lw));
  }
  // "GPT 5 Mini" -> "GPT-5 Mini", "GPT OSS 20B" -> "GPT-OSS 20B"
  if (out[0] === 'GPT' && out[1]) out.splice(0, 2, `GPT-${out[1]}`);
  const name = out.join(' ').trim();
  return name || id;
}

/** Is this model free to use? Keyless, free-tier and local providers are;
 * on OpenRouter-style providers only ids ending in ":free" are. */
export function isFreeModel(provider: { access: string; freeSuffixOnly?: boolean; freeModels?: string[] } | undefined, model: string): boolean {
  if (/:free$/i.test(model)) return true;
  if (!provider) return false;
  if (provider.freeSuffixOnly) return false;
  if (provider.freeModels) return provider.freeModels.includes(model);
  return provider.access === 'keyless' || provider.access === 'free-tier' || provider.access === 'local';
}
