import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Owns the keyboard resource: raw keydown capture, translated into intent
// facts. Auto-repeat rides the browser's own repeat events, so a held key is
// simply many intents. Undo/redo are not edits — they travel as the
// transport vocabulary (StepBackPressed / StepPressed) and the timeline
// answers them; this slice never touches the document. A live completion
// offer is the one modality, and it is carried entirely by facts: the
// oracle's CompletionOffered bends Tab, Escape, and the vertical arrows
// until its closing edge unbends them. The body is self-contained (no
// module-scope references), so this slice is adoptable.
export const keyboard = defineSlice({
    type: "keyboard",
    description: "Captures keydown and turns keys into edit and transport intents.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["CompletionOffered"],
    emits: [
        "EditRequested",
        "StepBackPressed",
        "StepPressed",
        "CopyRequested",
        "CutRequested",
        "CompletionNavigated",
        "CompletionDismissed",
    ],
    start(context) {
        // Human intents outrank any machine author's (rule 7 arbitration is by
        // priority carried in the fact, never by source name — the agent-port
        // emits the same EditRequested at priority 1).
        const HUMAN_PRIORITY = 10;
        const requestEdit = (edit) => context.emit("EditRequested", { edit, priority: HUMAN_PRIORITY });
        // The oracle's live offer, cached from its facts. Every transition —
        // fresh offer, navigation, dismissal, caret motion, time travel —
        // arrives as a CompletionOffered (empty items are the closing edge), so
        // this cache never guesses at the document.
        let offer = null;
        context.subscribe("CompletionOffered", (fact) => {
            offer = fact.payload.items.length > 0 ? fact.payload : null;
        });
        const onKeyDown = (event) => {
            // Keys aimed at a native form control (the editor's contract fields)
            // are that control's business — the composed path sees through open
            // shadow roots, so the check works from this window-level capture.
            const target = event.composedPath()[0];
            if (target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement) {
                return;
            }
            // Cmd/Ctrl chords. Z steps back through recorded edits, shift-Z steps
            // forward; A/C/X are selection intents (the clipboard slice owns the
            // OS clipboard and answers Copy/Cut); V reads the clipboard here,
            // because the paste text enters the pool as an ordinary insert intent.
            // Everything else with a command modifier stays the browser's.
            if (event.metaKey || event.ctrlKey) {
                switch (event.code) {
                    case "KeyZ":
                        context.emit(event.shiftKey ? "StepPressed" : "StepBackPressed", {});
                        event.preventDefault();
                        return;
                    case "KeyA":
                        requestEdit({ kind: "select-all" });
                        event.preventDefault();
                        return;
                    case "KeyC":
                        context.emit("CopyRequested", {});
                        event.preventDefault();
                        return;
                    case "KeyX":
                        context.emit("CutRequested", {});
                        event.preventDefault();
                        return;
                    case "KeyV":
                        event.preventDefault();
                        navigator.clipboard
                            ?.readText()
                            .then((text) => {
                            if (text.length > 0) {
                                requestEdit({ kind: "insert", text: text.replace(/\r\n/g, "\n") });
                            }
                        })
                            .catch(() => {
                            // The browser refused clipboard read; nothing to paste.
                        });
                        return;
                    default:
                }
                return;
            }
            // While an offer is live, three keys bend: Tab accepts the selected
            // candidate as an ordinary replace-range over the offer's range — one
            // intent, one undo step, journaled and replayed like any keystroke —
            // Escape dismisses, and the vertical arrows navigate the popup. Enter
            // stays a newline (the tag fields' law: Tab takes the suggestion).
            if (offer !== null) {
                if (event.key === "Tab") {
                    const item = offer.items[Math.min(offer.selected, offer.items.length - 1)];
                    requestEdit({
                        kind: "replace-range",
                        from: offer.from,
                        to: offer.to,
                        text: item.label,
                    });
                    offer = null;
                    event.preventDefault();
                    return;
                }
                if (event.key === "Escape") {
                    context.emit("CompletionDismissed", {});
                    offer = null;
                    event.preventDefault();
                    return;
                }
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    context.emit("CompletionNavigated", {
                        direction: event.key === "ArrowDown" ? "down" : "up",
                    });
                    event.preventDefault();
                    return;
                }
            }
            switch (event.key) {
                case "Enter":
                    requestEdit({ kind: "insert", text: "\n" });
                    event.preventDefault();
                    return;
                case "Tab":
                    requestEdit({ kind: "insert", text: "  " });
                    event.preventDefault();
                    return;
                case "Backspace":
                    requestEdit({ kind: "backspace" });
                    event.preventDefault();
                    return;
                case "Delete":
                    requestEdit({ kind: "delete" });
                    event.preventDefault();
                    return;
                case "ArrowLeft":
                    requestEdit({ kind: "caret-move", direction: "left", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                case "ArrowRight":
                    requestEdit({ kind: "caret-move", direction: "right", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                case "ArrowUp":
                    requestEdit({ kind: "caret-move", direction: "up", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                case "ArrowDown":
                    requestEdit({ kind: "caret-move", direction: "down", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                case "Home":
                    requestEdit({ kind: "caret-move", direction: "line-start", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                case "End":
                    requestEdit({ kind: "caret-move", direction: "line-end", extend: event.shiftKey });
                    event.preventDefault();
                    return;
                default:
            }
            // Printable characters: exactly the single-glyph keys.
            if (event.key.length === 1) {
                requestEdit({ kind: "insert", text: event.key });
                event.preventDefault();
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    },
});
