import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { Compartment, EditorState } from '@codemirror/state';

/** CodeMirror 6 editor. Loaded lazily, only when CodeFrame opens. */
export default function CodeEditor({
  value,
  onChange,
  dark,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  dark: boolean;
  readOnly: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const theme = useRef(new Compartment());
  const ro = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const applying = useRef(false);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          html(),
          EditorView.lineWrapping,
          theme.current.of(dark ? oneDark : []),
          ro.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !applying.current) onChangeRef.current(u.state.doc.toString());
          }),
          EditorView.theme({
            '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
            '.cm-scroller': { fontFamily: 'var(--mono)', fontVariantLigatures: 'none' },
            '.cm-gutters': { backgroundColor: 'transparent', border: 'none' },
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    applying.current = true;
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
    applying.current = false;
    if (readOnly) v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
  }, [value, readOnly]);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div className="code-editor" ref={host} />;
}
