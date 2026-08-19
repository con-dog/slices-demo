import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The header band's only occupant — this app has no title plate. A pure
// fan-out consumer: filename signage plus caret, size, findings, and mode,
// each printed from a different owner's facts — plus two flags: LOCKED
// when the open document's type is in the lock-book's ledger (machine
// authors bounce off it; the human does not), and REWOUND when this boot's
// journal lost its tail (the fact-log's WorkspaceRewound, requested or the
// crash-loop guard's). The body is self-contained
// (no module-scope references), so this slice is adoptable: the IDE's own
// chrome can be edited from inside the IDE.
export const statusPlate = defineSlice({
    type: "status-plate",
    description: "Header signage: caret, size, findings, lock, rewind, and mode from facts.",
    consumes: [
        "BufferChanged",
        "BufferRestored",
        "CaretMoved",
        "DiagnosticsPublished",
        "SliceLocksDeclared",
        "WorkspaceRewound",
        "TimelineScrubbed",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["ViewSlotRequested"],
    start(context) {
        const plateStyles = `
  * { box-sizing: border-box; }
  [data-status-plate] {
    display: flex;
    gap: 1rem;
    align-items: center;
    height: 100%;
    padding: 0 0.7rem;
    border: 2px solid var(--surface-600, #453413);
    background: var(--surface-950, #1d0d05);
    color: var(--surface-200, #dcc089);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  [data-status-plate] .file {
    color: var(--accent-emit, #ffb000);
    font-weight: 800;
    letter-spacing: 0.16em;
  }
  [data-status-plate] .stats {
    display: flex;
    flex: 1;
    gap: 1rem;
    justify-content: flex-end;
  }
  [data-status-plate] p { display: flex; gap: 0.45rem; margin: 0; }
  [data-status-plate] span { color: var(--surface-400, #8a6a28); }
  [data-status-plate] strong { font-variant-numeric: tabular-nums; font-weight: 700; }
  [data-status-plate] .mode { color: var(--accent-emit, #ffb000); font-weight: 800; }
  [data-status-plate] .mode.is-replay { color: var(--accent-consume, #ffe3a1); }
  [data-status-plate] .lint.is-dirty strong { color: var(--accent-emit, #ffb000); }
  [data-status-plate] .flag { color: var(--accent-consume, #ffe3a1); font-weight: 800; }
  [data-status-plate] .flag[hidden] { display: none; }
`;
        // The host is the stage's geometry surface; the shadow root is this
        // slice's sealed interior (CLAUDE.md).
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = plateStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("header");
        view.dataset.statusPlate = "";
        view.innerHTML = `
      <p class="file">Slice-IDE</p>
      <div class="stats">
        <p><span>LN</span> <strong data-caret>1:1</strong></p>
        <p><span>CH</span> <strong data-chars>0</strong></p>
        <p class="lint"><span>Lint</span> <strong data-lint>0</strong></p>
        <p class="flag" data-locked hidden title="Machine authors cannot edit, copy or delete this slice; you can (UNLOCK in the toolbar)">Locked</p>
        <p class="flag" data-rewound hidden>Rewound</p>
        <p class="mode" data-mode>Live</p>
      </div>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
        const caretLabel = view.querySelector("[data-caret]");
        const charsLabel = view.querySelector("[data-chars]");
        const lintLabel = view.querySelector("[data-lint]");
        const lintBlock = view.querySelector(".lint");
        const modeLabel = view.querySelector("[data-mode]");
        const lockedFlag = view.querySelector("[data-locked]");
        const rewoundFlag = view.querySelector("[data-rewound]");
        if (!caretLabel || !charsLabel || !lintLabel || !lintBlock || !modeLabel || !lockedFlag || !rewoundFlag) {
            throw new Error("Status plate could not initialize its view.");
        }
        // The lock flag: the open document's type against the lock-book's
        // ledger, both learned from facts and re-read whenever either moves.
        const locks = new Map();
        let openType = null;
        const printLock = () => {
            const locked = openType !== null && (locks.get(openType) ?? 0) > 0;
            lockedFlag.hidden = !locked;
        };
        context.subscribe("SliceLocksDeclared", (fact) => {
            locks.clear();
            for (const [type, level] of Object.entries(fact.payload.locks))
                locks.set(type, level);
            printLock();
        });
        context.subscribe("WorkspaceRewound", (fact) => {
            rewoundFlag.hidden = false;
            rewoundFlag.textContent = `Rewound -${fact.payload.dropped}`;
            rewoundFlag.title =
                fact.payload.reason === "crash-loop"
                    ? `The last replay never finished, so the guard dropped the journal's last ${fact.payload.dropped} input(s); ${fact.payload.remaining} remain`
                    : `REWIND dropped the journal's last ${fact.payload.dropped} input(s); ${fact.payload.remaining} remain`;
        });
        // The wordmark stands alone — which slice is open is the editor's own
        // signage. The stats print from the body the buffer publishes.
        const printDocument = (payload) => {
            caretLabel.textContent = `${payload.caret.line + 1}:${payload.caret.column + 1}`;
            charsLabel.textContent = String(payload.lines.join("\n").length);
            openType = payload.meta.type;
            printLock();
        };
        context.subscribe("BufferChanged", (fact) => {
            printDocument(fact.payload);
            modeLabel.textContent = "Live";
            modeLabel.classList.remove("is-replay");
        });
        context.subscribe("BufferRestored", (fact) => printDocument(fact.payload));
        context.subscribe("CaretMoved", (fact) => {
            caretLabel.textContent = `${fact.payload.caret.line + 1}:${fact.payload.caret.column + 1}`;
        });
        context.subscribe("DiagnosticsPublished", (fact) => {
            const count = fact.payload.diagnostics.length;
            lintLabel.textContent = String(count);
            lintBlock.classList.toggle("is-dirty", count > 0);
        });
        // Live-versus-parked follows the facts: a scrub parks the view, any
        // live publication (an edit, a caret, a file switch) returns it.
        context.subscribe("TimelineScrubbed", () => {
            modeLabel.textContent = "Replay";
            modeLabel.classList.add("is-replay");
        });
        context.subscribe("CaretMoved", () => {
            modeLabel.textContent = "Live";
            modeLabel.classList.remove("is-replay");
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
        joinStage("r1c1");
        return () => host.remove();
    },
});
