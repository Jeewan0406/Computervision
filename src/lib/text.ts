/**
 * Text helpers shared by chat rendering and the CodeFrame.
 * No browser APIs here, so these run in Node tests too.
 */

/** Some open models put their reasoning inside <think>…</think> at the start
 * of the answer. Split it out so the UI can show it in a collapsible box. */
export function splitThink(content: string): { reasoning: string; answer: string } {
  const m = content.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (!m) return { reasoning: '', answer: content };
  const closed = m[2] === '</think>';
  return {
    reasoning: m[1].trim(),
    answer: closed ? content.slice(m[0].length).trimStart() : '',
  };
}

export interface CodeBlock {
  lang: string;
  code: string;
  closed: boolean;
}

/** All fenced code blocks, including a final unclosed one while streaming. */
export function codeBlocks(md: string): CodeBlock[] {
  const out: CodeBlock[] = [];
  const re = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)(```|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    out.push({ lang: (m[1] || '').toLowerCase(), code: m[2].replace(/\n$/, ''), closed: m[3] === '```' });
    if (m[3] !== '```') break;
  }
  return out;
}

const looksLikeHtml = (s: string) => /<!doctype html|<html[\s>]|<body[\s>]|<div[\s>]|<canvas[\s>]/i.test(s);

/**
 * Pick the code the CodeFrame should show from a model answer.
 * Prefers the last complete HTML document; otherwise stitches HTML, CSS and
 * JS blocks together into one runnable page.
 */
export function extractRunnable(md: string): string | null {
  const blocks = codeBlocks(md);
  if (!blocks.length) return null;
  const html = [...blocks].reverse().find((b) => b.lang === 'html' || b.lang === 'htm' || (b.lang === '' && looksLikeHtml(b.code)));
  const css = blocks.filter((b) => b.lang === 'css').map((b) => b.code).join('\n\n');
  const js = blocks
    .filter((b) => ['js', 'javascript', 'jsx', 'mjs'].includes(b.lang))
    .map((b) => b.code)
    .join('\n\n');
  if (html && /<html[\s>]|<!doctype/i.test(html.code)) {
    let doc = html.code;
    if (css && !/<style/i.test(doc)) doc = doc.replace(/<\/head>/i, `<style>\n${css}\n</style>\n</head>`);
    if (js && !/<script/i.test(doc)) doc = doc.replace(/<\/body>/i, `<script>\n${js}\n</script>\n</body>`);
    return doc;
  }
  if (!html && !css && !js) {
    const svg = blocks.find((b) => b.lang === 'svg' || b.lang === 'xml');
    if (!svg) return null;
    return wrapDoc(svg.code, '', '');
  }
  return wrapDoc(html?.code ?? '', css, js);
}

export function wrapDoc(body: string, css: string, js: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>JeeA! CodeFrame</title>
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${js}
</script>
</body>
</html>`;
}

/** Code being written right now (last, possibly unclosed, HTML block). */
export function liveHtml(md: string): string | null {
  const blocks = codeBlocks(md);
  const html = [...blocks].reverse().find((b) => b.lang === 'html' || b.lang === 'htm');
  return html ? html.code : null;
}

/** Replace large code blocks with a short note (used in the CodeFrame chat). */
export function stripCode(md: string, note = '*📄 Code sent to the editor →*'): string {
  return md.replace(/```[\w+#.-]*[^\n]*\n[\s\S]*?(```|$)/g, (block) => {
    const lines = block.split('\n').length;
    return lines > 6 ? `\n${note} (${lines - 2} lines)\n` : block;
  });
}
