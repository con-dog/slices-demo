import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Owns the REWIND and RESET buttons: the third tray block (the elastic
// grid mints `tray-3` on request). Each press is an intent the fact-log,
// which owns the journal, answers. REWIND is WorkspaceRewindRequested:
// drop the journal's tail back through the last input that changed a
// document and reboot into the workspace as it stood before it — the way
// out of a semantic brick (the page still answers the mouse but the program
// is wrong) that keeps the session; press again to go one input further.
// RESET is WorkspaceResetRequested: discard the whole journal and reboot
// into an empty workspace. Neither can be undone by the timeline, so each
// button arms first: one press reads SURE?, a second within a few seconds
// fires, and the arm times out on its own. Nothing is read from the URL.
// The body is self-contained (no module-scope references), so this slice is
// adoptable — and locked by default, since it is the human's way back.
export const workspaceControls = defineSlice({
    type: "workspace-controls",
    description: "REWIND and RESET: drop the journal's last input, or discard it all, and reboot.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["WorkspaceRewindRequested", "WorkspaceResetRequested", "ViewSlotRequested"],
    start(context) {
        const ARM_MS = 3000;
        const workspaceStyles = `
  * { box-sizing: border-box; }
  [data-workspace-controls] {
    display: flex;
    gap: 0.5rem;
    height: 100%;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  [data-workspace-controls] button {
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
  [data-workspace-controls] button:hover {
    border-color: var(--accent-emit, #ffb300);
    background: var(--accent-emit, #ffb300);
    color: #1d0d05;
  }
  /* REWIND is the gentler press: it wears the consume accent when armed. */
  [data-workspace-controls] button[data-rewind][data-armed] {
    border-color: var(--accent-consume, #ff7a2e);
    background: var(--accent-consume, #ff7a2e);
    color: #1d0d05;
  }
  /* Armed: the destructive press wears the error tint, as signage. */
  [data-workspace-controls] button[data-armed] {
    border-color: var(--accent-error, #ff2f2f);
    background: var(--accent-error, #ff2f2f);
    color: #1d0d05;
  }
`;
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = workspaceStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("aside");
        view.dataset.workspaceControls = "";
        view.innerHTML = `
      <button type="button" data-rewind title="Drop the journal's last document-changing input (and everything after it) and reboot; press again to go further back">Rewind</button>
      <button type="button" data-reset title="Discard the journal and reboot into an empty workspace">Reset</button>
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
        joinStage("tray-3");
        const rewind = view.querySelector("[data-rewind]");
        const reset = view.querySelector("[data-reset]");
        if (!rewind || !reset) {
            throw new Error("Workspace controls could not initialize their view.");
        }
        // The arm: one press asks SURE?, the second within ARM_MS fires the
        // intent; arming one button disarms the other, so SURE? is never
        // ambiguous about which press it confirms.
        const arms = [];
        const armed = (button, label, fire) => {
            let timer = null;
            const disarm = () => {
                if (timer !== null)
                    clearTimeout(timer);
                timer = null;
                delete button.dataset.armed;
                button.textContent = label;
            };
            arms.push(disarm);
            button.addEventListener("click", () => {
                if (button.dataset.armed !== undefined) {
                    disarm();
                    fire();
                    return;
                }
                for (const disarmOther of arms)
                    disarmOther();
                button.dataset.armed = "";
                button.textContent = "Sure?";
                timer = setTimeout(disarm, ARM_MS);
            });
        };
        armed(rewind, "Rewind", () => context.emit("WorkspaceRewindRequested", {}));
        armed(reset, "Reset", () => context.emit("WorkspaceResetRequested", {}));
        return () => {
            for (const disarm of arms)
                disarm();
            host.remove();
        };
    },
});
