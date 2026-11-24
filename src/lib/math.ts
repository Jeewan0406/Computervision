// LaTeX maths in answers ($...$, $$...$$, \(...\), \[...\]) rendered with
// KaTeX. KaTeX (about 270 kB plus fonts) loads only when a message needs it.
import { create } from 'zustand';

type Katex = typeof import('katex').default;
let katex: Katex | null = null;
let loading: Promise<void> | null = null;

/** `ready` flips to true once KaTeX has loaded, so open messages re-render. */
export const useMath = create<{ ready: boolean }>(() => ({ ready: false }));
export const mathReady = () => katex !== null;

/** Text that probably contains maths. */
export const MATH_HINT = /\$[^\s$]|\\\(|\\\[/;

export function loadMath(): Promise<void> {
  if (!loading) {
    loading = Promise.all([import('katex'), import('katex/dist/katex.min.css')])
      .then(([m]) => {
        katex = m.default;
        useMath.setState({ ready: true });
      })
      .catch(() => {
        loading = null; // offline: try again next time
      });
  }
  return loading;
}

/** HTML for one formula, or null while KaTeX is not loaded. Never throws. */
export function renderTex(tex: string, display: boolean): string | null {
  if (!katex) return null;
  try {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      strict: 'ignore',
      trust: false, // no \href, \url or \includegraphics from model output
      output: 'htmlAndMathml',
      maxSize: 20,
      maxExpand: 500,
    });
  } catch {
    return null;
  }
}
