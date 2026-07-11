import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const editable = new Compartment();
const vscodeHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.bool, tags.null], color: "#c586c0" },
  { tag: [tags.name, tags.variableName, tags.propertyName], color: "#9cdcfe" },
  { tag: [tags.definition(tags.function(tags.variableName)), tags.function(tags.variableName)], color: "#dcdcaa" },
  { tag: [tags.typeName, tags.className], color: "#4ec9b0" },
  { tag: [tags.string, tags.special(tags.string)], color: "#ce9178" },
  { tag: tags.number, color: "#b5cea8" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#6a9955", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#d4d4d4" }
]);
const theme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "#eee8dc" },
  ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.65" },
  ".cm-content": { minHeight: "360px", padding: "16px 0", caretColor: "var(--chat-accent)" },
  ".cm-line": { padding: "0 16px" },
  ".cm-gutters": { backgroundColor: "rgba(0,0,0,.18)", color: "var(--chat-muted)", border: "0" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(133,132,189,.08)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(133,132,189,.32)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--chat-accent)" },
  "&.cm-focused": { outline: "none" }
}, { dark: true });

export default function CodeEditor({ value, language, disabled, onChange }) {
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const view = new EditorView({
      doc: value,
      parent: hostRef.current,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        language === "javascript" ? javascript() : python(),
        syntaxHighlighting(vscodeHighlight),
        theme,
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": "Код решения", "aria-multiline": "true" }),
        editable.of([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        })
      ]
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editable.reconfigure([EditorState.readOnly.of(disabled), EditorView.editable.of(!disabled)])
    });
  }, [disabled]);

  return <div className="codeEditor" ref={hostRef} />;
}
