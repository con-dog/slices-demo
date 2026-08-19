import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Owns the back / step buttons — undo and redo. There is no play/pause:
// editor time is input-driven, so live-versus-parked belongs to the
// timeline, which answers these intents with TimelineScrubbed and the
// buffer replays. Both buttons are always live; stepping past either end of
// history simply finds no marker and does nothing. The body is
// self-contained (no module-scope references), so this slice is adoptable.
export const transportControls = defineSlice({
    type: "transport-controls",
    description: "Back and step buttons: undo and redo through recorded edits.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["StepPressed", "StepBackPressed", "ViewSlotRequested"],
    start(context) {
        const transportStyles = `
  * { box-sizing: border-box; }
  [data-transport-controls] {
    display: flex;
    gap: 0.5rem;
    height: 100%;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  [data-transport-controls] button {
    flex: 1 1 0;
    border: 2px solid var(--surface-200, #e8b366);
    border-radius: 0;
    background: var(--surface-800, #341809);
    color: var(--text-bright, #ffe9c2);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
  }
  [data-transport-controls] button:hover {
    border-color: var(--accent-emit, #ffb300);
    background: var(--accent-emit, #ffb300);
    color: #1d0d05;
  }
`;
        // The host is the stage's geometry surface; the shadow root is this
        // slice's sealed interior (CLAUDE.md).
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = transportStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("aside");
        view.dataset.transportControls = "";
        view.innerHTML = `
      <button type="button" data-back>Back</button>
      <button type="button" data-step>Step</button>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
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
        joinStage("tray-2");
        const back = view.querySelector("[data-back]");
        const step = view.querySelector("[data-step]");
        if (!back || !step) {
            throw new Error("Transport controls could not initialize their view.");
        }
        back.addEventListener("click", () => {
            context.emit("StepBackPressed", {});
        });
        step.addEventListener("click", () => {
            context.emit("StepPressed", {});
        });
        return () => host.remove();
    },
});
