import { useData } from './data';
import { useUI } from './ui';
import { wrapDoc } from './text';
import { uid, titleFrom } from './utils';

/** Open a code snippet in a new CodeFrame project and switch to it. */
export function openInCodeFrame(code: string, lang: string) {
  let doc = code;
  if (lang === 'css') doc = wrapDoc('<h1>CSS preview</h1><p>Edit the HTML to see your styles.</p><button>Button</button>', code, '');
  else if (['js', 'javascript', 'jsx'].includes(lang)) doc = wrapDoc('<div id="app"></div>', '', code);
  else if (lang === 'svg') doc = wrapDoc(code, 'body{display:grid;place-items:center;min-height:100vh;margin:0}', '');
  else if (!/<html[\s>]|<!doctype/i.test(code)) doc = wrapDoc(code, '', '');
  const id = useData.getState().create('code', {
    title: titleFrom(`Snippet: ${lang || 'html'}`),
    code: doc,
    versions: [{ id: uid(), at: Date.now(), code: doc, note: 'Imported from chat' }],
  });
  useData.getState().setActive('code', id);
  useUI.getState().setView('code');
}
