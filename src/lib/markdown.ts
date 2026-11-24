import { Marked, type Tokens } from 'marked';
import DOMPurify from 'dompurify';
import { mathReady, renderTex } from './math';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import ruby from 'highlight.js/lib/languages/ruby';
import diff from 'highlight.js/lib/languages/diff';

const langs: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  javascript, typescript, python, xml, css, json, bash, java, c, cpp, csharp, go, rust, sql, yaml, markdown, php, kotlin, swift, ruby, diff,
};
for (const [name, fn] of Object.entries(langs)) hljs.registerLanguage(name, fn);
hljs.registerAliases(['html', 'htm', 'svg', 'vue'], { languageName: 'xml' });
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['py'], { languageName: 'python' });
hljs.registerAliases(['sh', 'shell', 'zsh', 'console'], { languageName: 'bash' });
hljs.registerAliases(['yml'], { languageName: 'yaml' });
hljs.registerAliases(['md'], { languageName: 'markdown' });
hljs.registerAliases(['cs'], { languageName: 'csharp' });

const RUNNABLE = new Set(['html', 'htm', 'svg', 'css', 'js', 'javascript', 'jsx']);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const md = new Marked({ gfm: true, breaks: false });
md.use({
  renderer: {
    code(token: Tokens.Code) {
      const lang = (token.lang || '').trim().split(/\s+/)[0].toLowerCase();
      let body: string;
      try {
        body = lang && hljs.getLanguage(lang)
          ? hljs.highlight(token.text, { language: lang, ignoreIllegals: true }).value
          : escapeHtml(token.text);
      } catch {
        body = escapeHtml(token.text);
      }
      const run = RUNNABLE.has(lang) ? '<button class="cb-btn" data-act="run" title="Run in CodeFrame">▶ Run</button>' : '';
      return `<div class="codeblock" data-lang="${escapeHtml(lang)}"><div class="codeblock-head"><span class="codeblock-lang">${escapeHtml(lang || 'text')}</span><span class="codeblock-actions">${run}<button class="cb-btn" data-act="download" title="Download">⤓</button><button class="cb-btn" data-act="copy" title="Copy code">Copy</button></span></div><pre><code class="hljs">${body}</code></pre></div>`;
    },
  },
});

// Maths: $$...$$ or \[...\] as a block; $...$ or \(...\) inline. The inline
// rule follows Pandoc so prices like "$5 and $10" are not taken as maths.
const tex = (text: string, display: boolean, raw: string) => renderTex(text, display) ?? escapeHtml(raw);
md.use({
  extensions: [
    {
      name: 'mathBlock',
      level: 'block',
      // Only at the start of a line: "\[" inside a sentence is an escaped
      // bracket (e.g. citation links like [\[1\]](url)), not maths.
      start(src: string) {
        const m = /(?:^|\n)[ ]{0,3}(?=\$\$|\\\[)/.exec(src);
        return m ? m.index + m[0].length : undefined;
      },
      tokenizer(src: string) {
        const m = /^[ ]{0,3}(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])[ \t]*(?:\n+|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], text: (m[1] ?? m[2]).trim(), src: m[0].trim() };
        return undefined;
      },
      renderer(t: Tokens.Generic) {
        return `<div class="math-block">${tex(t.text, true, t.src)}</div>\n`;
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src: string) {
        const i = src.search(/\$|\\\(/);
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        let m = /^\$\$([^$]+?)\$\$/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
        m = /^\$(?![\s$])((?:\\.|[^\\\n$])+?)(?<![\s\\])\$(?![\d$])/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        m = /^\\\(([\s\S]+?)\\\)/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
        return undefined;
      },
      renderer(t: Tokens.Generic) {
        return tex(t.text, !!t.display, t.raw);
      },
    },
  ],
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const cache = new Map<string, string>();

/** Markdown → safe HTML. Model output is untrusted, so it is always sanitized. */
export function renderMarkdown(src: string): string {
  const key = `${mathReady() ? 1 : 0}${src}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const html = DOMPurify.sanitize(md.parse(src, { async: false }) as string, {
    ADD_ATTR: ['target', 'data-act', 'data-lang'],
    FORBID_TAGS: ['style', 'form', 'input', 'iframe'],
  });
  if (cache.size > 400) cache.clear();
  cache.set(key, html);
  return html;
}

/** Markdown tokens (with the maths extensions), for exporting to other formats. */
export const lexMarkdown = (src: string) => md.lexer(src);

export const extFor = (lang: string) =>
  ({ javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', html: 'html', xml: 'xml', css: 'css', json: 'json', bash: 'sh', sh: 'sh', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs', go: 'go', rust: 'rs', sql: 'sql', yaml: 'yml', markdown: 'md', php: 'php', kotlin: 'kt', swift: 'swift', ruby: 'rb' } as Record<string, string>)[lang] ?? 'txt';
