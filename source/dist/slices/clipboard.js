import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Owns the OS clipboard resource (rule 8: one owner per resource). The
// keyboard cannot copy — it does not know the text; this slice caches the
// document and selection from the buffer's facts and answers CopyRequested /
// CutRequested. A cut is a copy plus an ordinary backspace intent: with a
// selection active, the buffer deletes the range, so no special "cut" edit
// exists. Paste lives in the keyboard slice, where the clipboard's text
// enters the pool as a plain insert intent. The body is self-contained (no
// module-scope references), so this slice is adoptable.
export const clipboard = defineSlice({
    type: "clipboard",
    description: "Owns the OS clipboard: copies the selection, cuts via intents.",
    consumes: [
        "BufferChanged",
        "BufferRestored",
        "CaretMoved",
        "CopyRequested",
        "CutRequested",
    ],
    emits: ["EditRequested"],
    start(context) {
        const HUMAN_PRIORITY = 10;
        let lines = [];
        let caret = { line: 0, column: 0 };
        let anchor = null;
        const selectedText = () => {
            if (lines.length === 0 || anchor === null)
                return "";
            if (anchor.line === caret.line && anchor.column === caret.column)
                return "";
            const forward = anchor.line < caret.line ||
                (anchor.line === caret.line && anchor.column <= caret.column);
            const start = forward ? anchor : caret;
            const end = forward ? caret : anchor;
            if (start.line === end.line) {
                return lines[start.line].slice(start.column, end.column);
            }
            return [
                lines[start.line].slice(start.column),
                ...lines.slice(start.line + 1, end.line),
                lines[end.line].slice(0, end.column),
            ].join("\n");
        };
        const write = (text) => {
            // Feature-detected: absent under the node test harness, and a browser
            // may refuse — either way the intent simply finds no answer.
            if (typeof navigator !== "undefined" && navigator.clipboard) {
                navigator.clipboard.writeText(text).catch(() => { });
            }
        };
        context.subscribe("BufferChanged", (fact) => {
            lines = fact.payload.lines;
            caret = fact.payload.caret;
            anchor = fact.payload.anchor;
        });
        context.subscribe("BufferRestored", (fact) => {
            lines = fact.payload.lines;
            caret = fact.payload.caret;
            anchor = fact.payload.anchor;
        });
        context.subscribe("CaretMoved", (fact) => {
            caret = fact.payload.caret;
            anchor = fact.payload.anchor;
        });
        context.subscribe("CopyRequested", () => {
            const text = selectedText();
            if (text.length > 0)
                write(text);
        });
        context.subscribe("CutRequested", () => {
            const text = selectedText();
            if (text.length === 0)
                return;
            write(text);
            context.emit("EditRequested", {
                edit: { kind: "backspace" },
                priority: HUMAN_PRIORITY,
            });
        });
    },
});
