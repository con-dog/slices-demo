import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The view side of the editor, now structured: the contract half is a form
// (name, description, and consume/emit tags with pool-driven autocomplete),
// the code half is the body of start(context) — the author never sees the
// defineSlice wrapper the foundry assembles. It owns no document state
// beyond the last facts it heard, and every output is intent: a click is a
// caret-set, a committed field is a meta-set, a committed tag is a tag-add.
// The body is self-contained (no module-scope references), so this slice is
// adoptable: how the editor paints can be edited from inside the editor.
export const editorRenderer = defineSlice({
    type: "editor-renderer",
    description: "Paints the contract form and code body from facts; outputs intents.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "BufferChanged",
        "BufferRestored",
        "CaretMoved",
        "TokensMapped",
        "DiagnosticsPublished",
        "VocabularyDeclared",
        "CompletionSuggested",
        "CompletionOffered",
        "TimelineScrubbed",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["EditRequested", "CompletionRequested", "ViewSlotRequested"],
    start(context) {
        const HUMAN_PRIORITY = 10;
        // Amber phosphor interior. Everything is painted from facts: the
        // contract form and text from the buffer's, colour from the syntax
        // oracle's, findings from the compliance oracle's, tag validity from
        // the completion oracle's vocabulary. The scanline overlay is this
        // app's one sanctioned texture, as the pool's water is the visualizer's.
        const editorStyles = `
  * { box-sizing: border-box; }
  [data-editor] {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    border: 2px solid var(--surface-600, #453413);
    background: var(--surface-950, #0d0903);
    color: var(--surface-200, #dcc089);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.82rem;
    line-height: 1.45;
  }
  [data-editor]::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: repeating-linear-gradient(
      180deg,
      rgb(255 176 0 / 0.028) 0 1px,
      transparent 1px 3px
    );
  }
  /* The structured half: the contract as a form, not code. Two stacked
     sections — naming, then the contract rows — split by a hard divider;
     one shared label column keeps every field box on the same left edge. */
  [data-editor] .meta {
    flex: none;
    border-bottom: 2px solid var(--surface-600, #453413);
  }
  [data-editor] .meta-section {
    display: grid;
    grid-template-columns: 2.9rem minmax(0, 1fr);
    gap: 0.4rem 0.45rem;
    align-items: start;
    padding: 0.55rem 0.6rem;
  }
  [data-editor] .meta-section + .meta-section {
    border-top: 2px solid var(--surface-600, #453413);
  }
  [data-editor] .meta .label {
    padding-top: 0.3rem;
    color: var(--surface-400, #8a6a28);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    user-select: none;
  }
  [data-editor] .meta input[data-meta] {
    padding: 0.14rem 0.35rem;
    border: 2px solid var(--surface-600, #453413);
    border-radius: 0;
    background: none;
    color: var(--text-bright, #ffedc7);
    font: inherit;
    font-size: 0.7rem;
  }
  [data-editor] .meta input[data-meta]:focus {
    border-color: var(--accent-emit, #ffb000);
    outline: none;
  }
  [data-editor] input[data-meta="type"] { width: 16rem; max-width: 100%; }
  [data-editor] input[data-meta="description"] { width: 100%; }
  /* IN and OUT are each ONE widget: the tags flow like a slice card's
     contract rows, the typed text rides inline with a native caret and no
     inner border, and past three rows the field ratchet-scrolls. */
  [data-editor] .tag-field {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
    align-content: flex-start;
    min-height: 1.75rem;
    max-height: 4.7rem;
    overflow-y: auto;
    padding: 0.25rem 0.35rem;
    border: 2px solid var(--surface-600, #453413);
    cursor: text;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-600, #453413) transparent;
  }
  [data-editor] .tag-field::-webkit-scrollbar { width: 6px; }
  [data-editor] .tag-field::-webkit-scrollbar-thumb {
    border-radius: 0;
    background: var(--surface-600, #453413);
  }
  [data-editor] .tag-field:focus-within {
    border-color: var(--accent-emit, #ffb000);
  }
  /* The list wrapper is transparent to layout: tags and the inline entry
     text wrap through the field as one flow. */
  [data-editor] .tag-list { display: contents; }
  [data-editor] .tag {
    display: inline-flex;
    gap: 0.15rem;
    align-items: center;
    padding: 0.05rem 0.1rem 0.05rem 0.32rem;
    border: 1px solid var(--surface-600, #453413);
    font-size: 0.6rem;
    white-space: nowrap;
  }
  [data-editor] .tag.consume { border-color: var(--accent-consume, #ff7a2e); color: var(--accent-consume, #ff7a2e); }
  [data-editor] .tag.emit { border-color: var(--accent-emit, #ffb000); color: var(--accent-emit, #ffb000); }
  /* A tag outside the declared vocabulary: dotted and dim, never an error. */
  [data-editor] .tag.novel { border-style: dotted; opacity: 0.5; }
  [data-editor] .tag button {
    padding: 0 0.2rem;
    border: 0;
    border-radius: 0;
    background: none;
    color: inherit;
    font: inherit;
    font-size: 0.6rem;
    cursor: pointer;
  }
  [data-editor] .tag button:hover { background: var(--surface-600, #453413); }
  [data-editor] .tag-field input {
    width: 7ch;
    min-width: 1ch;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-bright, #ffedc7);
    font: inherit;
    font-size: 0.6rem;
  }
  [data-editor] .tag-field input:focus { outline: none; }
  /* The completion's remainder, ghosted flush after the typed text. */
  [data-editor] .ghost {
    margin-left: -0.25rem;
    color: var(--surface-400, #8a6a28);
    font-size: 0.6rem;
    white-space: nowrap;
    pointer-events: none;
    user-select: none;
  }
  /* The code half: the inside of start(context), no wrapper on show. */
  [data-editor] .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.45rem 0 1.2rem;
    cursor: text;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-600, #453413) transparent;
  }
  [data-editor] .line { display: flex; white-space: pre; }
  [data-editor] .ln {
    flex: none;
    width: 2.7rem;
    padding-right: 0.65rem;
    border-right: 2px solid var(--surface-600, #66300f);
    color: var(--surface-400, #8a6a28);
    font-size: 0.62rem;
    line-height: inherit;
    text-align: right;
    user-select: none;
  }
  [data-editor] .line.has-diag .ln {
    color: var(--accent-emit, #ffb000);
    font-weight: 800;
  }
  [data-editor] .code {
    position: relative;
    flex: 1;
    min-height: 1.45em;
    /* The gutter gap is margin, not padding: the caret and diagnostic
       overlays position in ch from this box's padding edge, and the click
       handler measures columns from its left — all three must agree that
       the box edge IS column zero. */
    margin-left: 0.55rem;
    white-space: pre;
  }
  [data-editor] .t-keyword { color: var(--accent-emit, #ffb000); font-weight: 700; }
  [data-editor] .t-string { color: var(--accent-consume, #ffe3a1); }
  [data-editor] .t-comment { color: var(--surface-400, #8a6a28); }
  [data-editor] .t-number { color: var(--text-bright, #ffedc7); }
  [data-editor] .t-punct { color: var(--surface-400, #8a6a28); }
  [data-editor] .sel {
    position: absolute;
    top: 0;
    z-index: 0;
    height: 1.45em;
    background: rgb(255 176 0 / 0.2);
    pointer-events: none;
  }
  [data-editor] .caret {
    position: absolute;
    top: 0;
    z-index: 2;
    width: 1ch;
    height: 1.45em;
    background: var(--accent-emit, #ffb000);
    color: var(--surface-950, #0d0903);
    animation: caret-blink 1.1s steps(1) infinite;
  }
  @keyframes caret-blink { 50% { opacity: 0; } }
  [data-editor] .diag {
    position: absolute;
    top: 0;
    z-index: 1;
    height: 1.45em;
    border-bottom: 2px solid var(--accent-emit, #ffb000);
    background: rgb(255 176 0 / 0.14);
    pointer-events: none;
  }
  [data-editor].is-paused .caret { animation: none; opacity: 0.45; }
  /* The completion offer: a popup anchored under the offer's line, the
     selected candidate's docs below the list, and its remainder ghosted at
     an end-of-line caret. Hard 2px border, no radius — the amber border is
     signage because the element is active, never softness. */
  [data-editor] .complete {
    position: absolute;
    top: 1.45em;
    z-index: 10;
    display: block;
    min-width: 16ch;
    max-width: 46ch;
    border: 2px solid var(--accent-emit, #ffb000);
    background: var(--surface-950, #0d0903);
    font-size: 0.7rem;
    line-height: 1.4;
    white-space: normal;
  }
  [data-editor] .complete .item {
    display: block;
    padding: 0.08rem 0.4rem;
    color: var(--surface-200, #dcc089);
    white-space: nowrap;
  }
  [data-editor] .complete .item.on {
    background: var(--accent-emit, #ffb000);
    color: var(--surface-950, #0d0903);
    font-weight: 700;
  }
  [data-editor] .complete .docs {
    display: block;
    padding: 0.25rem 0.4rem 0.3rem;
    border-top: 2px solid var(--surface-600, #453413);
  }
  [data-editor] .complete .sig {
    display: block;
    color: var(--text-bright, #ffedc7);
    white-space: pre-wrap;
  }
  [data-editor] .complete .doc {
    display: block;
    margin-top: 0.15rem;
    color: var(--surface-400, #8a6a28);
    white-space: pre-wrap;
  }
  /* Nothing open: the workspace boots empty (no seed, no placeholder), so
     the page says so in stencil until ADD or a card click opens a document.
     The form's fields are dead until then — there is nothing to commit to. */
  [data-editor] .empty {
    margin: 0;
    padding: 1.6rem 0.75rem;
    color: var(--surface-400, #8a6a28);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-align: center;
    text-transform: uppercase;
    user-select: none;
  }
  [data-editor].is-empty .meta input { opacity: 0.4; }
  [data-editor] .ghost-code {
    position: absolute;
    top: 0;
    z-index: 1;
    height: 1.45em;
    color: var(--surface-400, #8a6a28);
    pointer-events: none;
    user-select: none;
  }
`;
        const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        // The host is the stage's geometry surface; the shadow root is this
        // slice's sealed interior (CLAUDE.md).
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = editorStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("section");
        view.dataset.editor = "";
        view.innerHTML = `
      <div class="meta">
        <div class="meta-section">
          <span class="label">Name</span>
          <input data-meta="type" maxlength="40" spellcheck="false" autocomplete="off">
          <span class="label">Desc</span>
          <input data-meta="description" maxlength="80" spellcheck="false" autocomplete="off">
        </div>
        <div class="meta-section">
          <span class="label">In</span>
          <div class="tag-field" data-side="consumes">
            <span class="tag-list"></span>
            <input data-tag="consumes" spellcheck="false" autocomplete="off" placeholder="+ type&hellip;">
            <span class="ghost" data-hint="consumes"></span>
          </div>
          <span class="label">Out</span>
          <div class="tag-field" data-side="emits">
            <span class="tag-list"></span>
            <input data-tag="emits" spellcheck="false" autocomplete="off" placeholder="+ type&hellip;">
            <span class="ghost" data-hint="emits"></span>
          </div>
        </div>
      </div>
      <div class="scroll" aria-label="Editor"></div>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
        const scroll = view.querySelector(".scroll");
        const typeInput = view.querySelector('[data-meta="type"]');
        const descriptionInput = view.querySelector('[data-meta="description"]');
        if (!scroll || !typeInput || !descriptionInput) {
            throw new Error("Editor renderer could not initialize its view.");
        }
        let meta = null;
        let lines = [];
        let caret = { line: 0, column: 0 };
        let anchor = null;
        let revision = -1;
        let tokens = null;
        let diagnostics = null;
        // The declared vocabulary (for known-versus-novel tag signage) and the
        // last completion answer per tag field, matched by prefix so stale
        // answers drop on the floor.
        let vocabulary = new Set();
        const hints = new Map();
        // The oracle's live offer for the code body. A stale revision or empty
        // items both mean "no popup" — the offer trails the text by a frame,
        // like every oracle's answer.
        let offer = null;
        const requestEdit = (edit) => context.emit("EditRequested", { edit, priority: HUMAN_PRIORITY });
        // --- The contract form ---
        const renderTags = () => {
            for (const row of view.querySelectorAll(".tag-field")) {
                const side = row.dataset.side === "emits" ? "emits" : "consumes";
                const list = row.querySelector(".tag-list");
                const input = row.querySelector("input");
                const ghost = row.querySelector(".ghost");
                if (!list || !input || !ghost)
                    continue;
                const kind = side === "emits" ? "emit" : "consume";
                list.innerHTML = (meta?.[side] ?? [])
                    .map((tag) => {
                    // The wildcard is grammar, not vocabulary: never novel.
                    const novel = tag !== "*" && vocabulary.size > 0 && !vocabulary.has(tag) ? " novel" : "";
                    return (`<span class="tag ${kind}${novel}">${escapeHtml(tag)}` +
                        `<button type="button" data-remove="${escapeHtml(tag)}" aria-label="Remove ${escapeHtml(tag)}">-</button></span>`);
                })
                    .join("");
                // The entry text rides inline: the input hugs its own content so
                // the completion's remainder can ghost flush after the caret.
                const typed = input.value;
                input.style.width = typed.length > 0 ? `${typed.length}ch` : "";
                const suggestion = hints.get(side);
                ghost.textContent =
                    typed.length > 0 &&
                        suggestion !== undefined &&
                        suggestion.toLowerCase().startsWith(typed.toLowerCase())
                        ? suggestion.slice(typed.length)
                        : "";
                if (shadow.activeElement === input) {
                    input.scrollIntoView({ block: "nearest" });
                }
            }
        };
        const renderMeta = () => {
            view.classList.toggle("is-empty", meta === null);
            for (const input of view.querySelectorAll(".meta input")) {
                input.disabled = meta === null;
            }
            if (meta === null)
                return;
            typeInput.value = meta.type;
            descriptionInput.value = meta.description;
            renderTags();
        };
        // Committing a field is an intent; the buffer owns what it becomes
        // (kebab law, collision no-ops), and the answering fact repaints the
        // form — a rejected rename visibly snaps back.
        const commitMeta = (field, value) => {
            if (meta === null || meta[field] === value)
                return;
            requestEdit({ kind: "meta-set", field, value });
        };
        for (const [input, field] of [
            [typeInput, "type"],
            [descriptionInput, "description"],
        ]) {
            input.addEventListener("change", () => commitMeta(field, input.value));
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter")
                    return;
                commitMeta(field, input.value);
                event.preventDefault();
            });
        }
        // Tag entry: typing asks the completion oracle (pool traffic, one frame
        // behind), Tab commits the suggested type, Enter commits exactly what
        // was typed — novel types are allowed and wear the dotted signage.
        for (const input of view.querySelectorAll("[data-tag]")) {
            const side = input.dataset.tag === "emits" ? "emits" : "consumes";
            const commitTag = (tag) => {
                const trimmed = tag.trim();
                if (trimmed.length === 0)
                    return;
                requestEdit({ kind: "tag-add", side, tag: trimmed });
                input.value = "";
                hints.delete(side);
                renderTags();
            };
            input.addEventListener("input", () => {
                hints.delete(side);
                if (input.value.trim().length > 0) {
                    context.emit("CompletionRequested", { field: side, prefix: input.value.trim() });
                }
                renderTags();
            });
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    commitTag(input.value);
                    event.preventDefault();
                }
                else if (event.key === "Tab") {
                    const suggestion = hints.get(side);
                    if (suggestion !== undefined)
                        commitTag(suggestion);
                    event.preventDefault();
                }
                else if (event.key === "Backspace" && input.value.length === 0) {
                    const last = meta?.[side].at(-1);
                    if (last !== undefined)
                        requestEdit({ kind: "tag-remove", side, tag: last });
                    event.preventDefault();
                }
            });
        }
        // Removing a tag is an intent from its "-" button; a click anywhere
        // else on a tag field hands the caret to its inline entry text.
        view.querySelector(".meta")?.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            const button = target?.closest("[data-remove]");
            const tag = button?.dataset.remove;
            if (button && tag) {
                const row = button.closest(".tag-field");
                const side = row?.dataset.side === "emits" ? "emits" : "consumes";
                requestEdit({ kind: "tag-remove", side, tag });
                return;
            }
            target?.closest(".tag-field")?.querySelector("input")?.focus();
        });
        // --- The code body ---
        const paintedLine = (line, spans) => {
            if (!spans || spans.length === 0)
                return escapeHtml(line);
            const parts = [];
            let at = 0;
            for (const span of spans) {
                if (span.start > at)
                    parts.push(escapeHtml(line.slice(at, span.start)));
                const end = span.start + span.length;
                parts.push(`<span class="t-${span.kind}">${escapeHtml(line.slice(span.start, end))}</span>`);
                at = end;
            }
            if (at < line.length)
                parts.push(escapeHtml(line.slice(at)));
            return parts.join("");
        };
        // The selection normalized to document order, or null when collapsed.
        const selectionRange = () => {
            if (anchor === null)
                return null;
            if (anchor.line === caret.line && anchor.column === caret.column)
                return null;
            const forward = anchor.line < caret.line ||
                (anchor.line === caret.line && anchor.column <= caret.column);
            return forward ? { start: anchor, end: caret } : { start: caret, end: anchor };
        };
        const render = () => {
            if (meta === null) {
                scroll.innerHTML = '<p class="empty">No slice open | add one or pick a card</p>';
                return;
            }
            const lineTokens = tokens?.revision === revision ? tokens.lineTokens : [];
            const found = diagnostics?.revision === revision ? diagnostics.list : [];
            const selected = selectionRange();
            const live = offer !== null && offer.revision === revision && offer.items.length > 0
                ? offer
                : null;
            const chosen = live === null
                ? null
                : live.items[Math.min(live.selected, live.items.length - 1)];
            // The remainder the selected candidate would add, ghosted only at an
            // end-of-line caret — mid-line it would overpaint real text. Its first
            // character rides inside the caret block itself (dark on amber), the
            // rest trails dim after it.
            let ghost = "";
            if (live !== null && chosen !== null && caret.line === live.to.line) {
                const lineText = lines[caret.line] ?? "";
                const typed = lineText.slice(live.from.column, live.to.column);
                if (caret.column === live.to.column &&
                    caret.column === lineText.length &&
                    chosen.label.toLowerCase().startsWith(typed.toLowerCase())) {
                    ghost = chosen.label.slice(typed.length);
                }
            }
            const scrollTop = scroll.scrollTop;
            const html = [];
            for (const [index, line] of lines.entries()) {
                const onLine = found.filter((diagnostic) => diagnostic.line === index);
                const overlays = onLine.map((diagnostic) => `<span class="diag" style="left: ${diagnostic.column}ch; width: ${diagnostic.length}ch;"></span>`);
                if (selected && index >= selected.start.line && index <= selected.end.line) {
                    const from = index === selected.start.line ? selected.start.column : 0;
                    const to = index === selected.end.line ? selected.end.column : line.length;
                    // A fully-selected empty line still shows a sliver of selection.
                    const width = Math.max(to - from, index === selected.end.line ? 0 : 0.4);
                    if (width > 0) {
                        overlays.push(`<span class="sel" style="left: ${from}ch; width: ${width}ch;"></span>`);
                    }
                }
                if (caret.line === index) {
                    const under = ghost !== "" ? ghost[0] : line.charAt(caret.column) || " ";
                    overlays.push(`<span class="caret" style="left: ${caret.column}ch;">${escapeHtml(under)}</span>`);
                    if (ghost.length > 1) {
                        overlays.push(`<span class="ghost-code" style="left: ${caret.column + 1}ch;">${escapeHtml(ghost.slice(1))}</span>`);
                    }
                }
                if (live !== null && chosen !== null && index === live.from.line) {
                    const rows = live.items
                        .map((item, at) => `<span class="item${at === live.selected ? " on" : ""}">${escapeHtml(item.label)}</span>`)
                        .join("");
                    const sig = chosen.signature
                        ? `<span class="sig">${escapeHtml(chosen.signature)}</span>`
                        : "";
                    const doc = chosen.doc
                        ? `<span class="doc">${escapeHtml(chosen.doc)}</span>`
                        : "";
                    const docs = sig || doc ? `<span class="docs">${sig}${doc}</span>` : "";
                    overlays.push(`<span class="complete" style="left: ${live.from.column}ch;">${rows}${docs}</span>`);
                }
                html.push(`<div class="line${onLine.length > 0 ? " has-diag" : ""}" data-line="${index}">` +
                    `<span class="ln">${index + 1}</span>` +
                    `<span class="code">${paintedLine(line, lineTokens[index])}${overlays.join("")}</span>` +
                    `</div>`);
            }
            scroll.innerHTML = html.join("");
            scroll.scrollTop = scrollTop;
            scroll
                .querySelector(`[data-line="${caret.line}"]`)
                ?.scrollIntoView({ block: "nearest" });
        };
        // Pointer positions become document positions by measuring char cells
        // (monospace makes 1ch exact); the buffer clamps whatever comes out.
        const positionAt = (clientX, clientY) => {
            const at = shadow.elementFromPoint(clientX, clientY);
            let lineElement = at instanceof Element ? at.closest("[data-line]") : null;
            if (!lineElement) {
                // Dragging above or below the text clamps to the first or last line.
                const rect = scroll.getBoundingClientRect();
                if (clientX < rect.left - 40 || clientX > rect.right + 40)
                    return null;
                if (clientY < rect.top - 40 || clientY > rect.bottom + 40)
                    return null;
                const edge = clientY < rect.top ? '[data-line="0"]' : `[data-line="${lines.length - 1}"]`;
                lineElement = scroll.querySelector(edge);
                if (!lineElement)
                    return null;
            }
            const line = Number(lineElement.dataset.line);
            const code = lineElement.querySelector(".code");
            if (!code)
                return null;
            const probe = document.createElement("span");
            probe.textContent = "0000000000";
            probe.style.visibility = "hidden";
            code.append(probe);
            const charWidth = probe.getBoundingClientRect().width / 10 || 1;
            probe.remove();
            const column = Math.max(0, Math.round((clientX - code.getBoundingClientRect().left) / charWidth));
            return { line, column };
        };
        // A click parks the caret; a drag extends a selection. Both are intents
        // like any keystroke — the browser gesture never mutates anything.
        let dragging = false;
        let lastDragCell = "";
        const requestCaret = (at, extend) => requestEdit({ kind: "caret-set", line: at.line, column: at.column, extend });
        scroll.addEventListener("mousedown", (event) => {
            const at = positionAt(event.clientX, event.clientY);
            if (!at)
                return;
            // Clicking into the code hands the keyboard back to the pool: any
            // focused form input must let go, or keystrokes would stay native.
            if (shadow.activeElement instanceof HTMLElement)
                shadow.activeElement.blur();
            dragging = true;
            lastDragCell = `${at.line}:${at.column}`;
            requestCaret(at, event.shiftKey);
            event.preventDefault();
        });
        const onDragMove = (event) => {
            if (!dragging)
                return;
            const at = positionAt(event.clientX, event.clientY);
            if (!at)
                return;
            const cell = `${at.line}:${at.column}`;
            if (cell === lastDragCell)
                return;
            lastDragCell = cell;
            requestCaret(at, true);
        };
        const onDragEnd = () => {
            dragging = false;
        };
        window.addEventListener("mousemove", onDragMove);
        window.addEventListener("mouseup", onDragEnd);
        const onDocument = (payload) => {
            meta = payload.meta;
            lines = payload.lines;
            caret = payload.caret;
            anchor = payload.anchor;
            revision = payload.revision;
            renderMeta();
            render();
        };
        context.subscribe("BufferChanged", (fact) => {
            onDocument(fact.payload);
            view.classList.remove("is-paused");
        });
        context.subscribe("BufferRestored", (fact) => {
            // Restores never bump the revision, so the stale-revision check would
            // let an old offer linger — completion advice from the past closes by
            // hand. The oracle publishes the closing edge too; this is the view's
            // own hygiene, not a protocol.
            offer = null;
            onDocument(fact.payload);
        });
        context.subscribe("CaretMoved", (fact) => {
            caret = fact.payload.caret;
            anchor = fact.payload.anchor;
            view.classList.remove("is-paused");
            render();
        });
        context.subscribe("TokensMapped", (fact) => {
            tokens = { revision: fact.payload.revision, lineTokens: fact.payload.lineTokens };
            render();
        });
        context.subscribe("DiagnosticsPublished", (fact) => {
            diagnostics = { revision: fact.payload.revision, list: fact.payload.diagnostics };
            render();
        });
        context.subscribe("VocabularyDeclared", (fact) => {
            vocabulary = new Set(fact.payload.types);
            renderTags();
        });
        context.subscribe("CompletionOffered", (fact) => {
            offer = fact.payload.items.length > 0 ? fact.payload : null;
            render();
        });
        context.subscribe("CompletionSuggested", (fact) => {
            const side = fact.payload.field;
            const input = view.querySelector(`[data-tag="${side}"]`);
            // Only the answer to what is still typed counts; stale answers drop.
            if (!input || input.value.trim() !== fact.payload.prefix)
                return;
            const suggestion = fact.payload.suggestions[0];
            if (suggestion === undefined)
                hints.delete(side);
            else
                hints.set(side, suggestion);
            renderTags();
        });
        // Live-versus-parked is not a clock mode: a scrub parks the view in
        // history, and any live publication (typing, caret, a slice switch)
        // returns it. The plate follows the facts themselves.
        context.subscribe("TimelineScrubbed", () => {
            offer = null;
            view.classList.add("is-paused");
            render();
        });
        const joinStage = (slot) => {
            context.subscribe("StageTokensDeclared", (fact) => {
                tokenStyle.textContent = `:host { ${Object.entries(fact.payload.tokens)
                    .map(([name, value]) => `--${name}: ${value};`)
                    .join(" ")} }`;
            });
            // Occupancy is in the declaration: while it does not name this
            // instance in the seat, ask — first ask, a denial's next chance, a
            // new stage's fresh ledger, all the same one line.
            context.subscribe("StageSlotsDeclared", (fact) => {
                if (fact.payload.held[slot] !== context.instanceId)
                    context.emit("ViewSlotRequested", { slot });
            });
            context.subscribe("ViewSlotAssigned", (fact) => {
                if (fact.payload.sliceId !== context.instanceId)
                    return;
                host.dataset.slot = fact.payload.slot;
                host.style.cssText = fact.payload.geometry;
            });
        };
        joinStage("r2c2");
        // The empty plate stands until the first document arrives.
        renderMeta();
        render();
        return () => {
            window.removeEventListener("mousemove", onDragMove);
            window.removeEventListener("mouseup", onDragEnd);
            host.remove();
        };
    },
});
