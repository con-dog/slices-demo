import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The slice actions band above the visualizer: there is no file tree, so the
// cards below are the workspace and this band is its only chrome. Every
// button press is an intent — the buffer and the foundry each answer the
// part that is theirs — and the picked slice arrives the same way everyone
// else learns it, from SliceSelected facts in the pool. THIS jumps to the
// card of the slice whose document the editor is showing: the band watches
// the buffer's facts for the open type and the pool's mounts for its living
// instance, and the jump itself is only another SliceSelected intent.
// LOCK|UNLOCK (one button, label follows the lock-book's ledger) speaks
// SliceLockRequested at the human's rank, 10 — a machine author's tools
// stamp 1, so what this band locks, only this band (or another hand of
// rank) unlocks; DUPLICATE and DELETE carry the same rank, so a human's
// press passes a lock a mind's would bounce off. The body is
// self-contained (no module-scope references), so it is adoptable.
export const sliceToolbar = defineSlice({
    type: "slice-toolbar",
    description: "The slice actions band: this, hide, add, duplicate, delete, lock.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "SliceSelected",
        "SliceMounted",
        "SliceUnmounted",
        "SliceVisibilityChanged",
        "SliceLocksDeclared",
        "BufferChanged",
        "BufferRestored",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: [
        "SliceSelected",
        "SliceHideRequested",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
        "SliceLockRequested",
        "ViewSlotRequested",
    ],
    start(context) {
        // The human's rank (rule 7): the keyboard types at 10, and so do these
        // presses — a lock at 10 lets them through and bounces machines.
        const HUMAN_PRIORITY = 10;
        const toolbarStyles = `
  * { box-sizing: border-box; }
  [data-slice-toolbar] {
    display: flex;
    gap: 0.55rem;
    align-items: center;
    height: 100%;
    padding: 0 0.55rem;
    border: 2px solid var(--surface-600, #66300f);
    background: var(--surface-950, #1d0d05);
    color: var(--surface-200, #e8b366);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  /* The band's plate: a bare "SLICE |" — which slice is picked is the card's
     own signage (its highlight in the visualizer), never repeated here. */
  [data-slice-toolbar] .label {
    flex: none;
    margin: 0;
    color: var(--surface-400, #a8551a);
    white-space: nowrap;
  }
  [data-slice-toolbar] button {
    flex: none;
    padding: 0.28rem 0.55rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: none;
    color: var(--surface-200, #e8b366);
    font: inherit;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
  }
  [data-slice-toolbar] button:hover:not(:disabled) {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-slice-toolbar] button[data-act="delete"]:hover:not(:disabled) {
    border-color: var(--accent-consume, #ff7a2e);
    color: var(--accent-consume, #ff7a2e);
  }
  [data-slice-toolbar] button:disabled {
    opacity: 0.35;
    cursor: default;
  }
  /* A locked pick: the button reads UNLOCK and wears the consume accent as signage. */
  [data-slice-toolbar] button[data-act="lock"][data-locked] {
    border-color: var(--accent-consume, #ff7a2e);
    color: var(--accent-consume, #ff7a2e);
  }
`;
        // The host is the stage's geometry surface; the shadow root is this
        // slice's sealed interior (CLAUDE.md).
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = toolbarStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("nav");
        view.dataset.sliceToolbar = "";
        view.innerHTML = `
      <p class="label">Slice |</p>
      <button type="button" data-act="this" disabled>This</button>
      <button type="button" data-act="hide" disabled>Hide</button>
      <button type="button" data-act="add">Add</button>
      <button type="button" data-act="duplicate" disabled>Duplicate</button>
      <button type="button" data-act="delete" disabled>Delete</button>
      <button type="button" data-act="lock" disabled title="Locked: machine authors cannot edit, copy or delete this slice; you can">Lock</button>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
        const jump = view.querySelector('[data-act="this"]');
        const conceal = view.querySelector('[data-act="hide"]');
        const duplicate = view.querySelector('[data-act="duplicate"]');
        const remove = view.querySelector('[data-act="delete"]');
        const lock = view.querySelector('[data-act="lock"]');
        if (!jump || !conceal || !duplicate || !remove || !lock) {
            throw new Error("Slice toolbar could not initialize its view.");
        }
        // The selection echo (whatever the pool last said is picked), the open
        // document's type (from the buffer's facts), and the living instance of
        // each mounted type (from the pool's lifecycle facts) — THIS lights up
        // when the open document's slice is alive on a card.
        let selected = null;
        let activeType = null;
        const instances = new Map();
        // Hot-reload manners: the foundry's autosave replaces the instance every
        // edit (unmount + mount, same type, same frame), and the pick follows
        // the replacement instead of dying with the old id.
        let vacatedSelection = null;
        // Pool visibility as last announced by the visualizer's
        // SliceVisibilityChanged facts — this band never decides, only requests.
        const hidden = new Set();
        // The locks as the lock-book last declared them (type -> min priority);
        // this band never decides, only requests, and reads the label back.
        const locks = new Map();
        const typeOf = (sliceId) => sliceId.split("#")[0];
        const isLocked = (sliceId) => (locks.get(typeOf(sliceId)) ?? 0) > 0;
        const render = () => {
            jump.disabled = activeType === null || !instances.has(activeType);
            conceal.disabled = selected === null;
            conceal.textContent =
                selected !== null && hidden.has(selected) ? "Show" : "Hide";
            duplicate.disabled = selected === null;
            remove.disabled = selected === null;
            lock.disabled = selected === null;
            const locked = selected !== null && isLocked(selected);
            lock.textContent = locked ? "Unlock" : "Lock";
            if (locked)
                lock.dataset.locked = "";
            else
                delete lock.dataset.locked;
        };
        view.addEventListener("click", (event) => {
            const button = event.target instanceof Element
                ? event.target.closest("[data-act]")
                : null;
            if (!button)
                return;
            if (button.dataset.act === "this") {
                const instance = activeType === null ? undefined : instances.get(activeType);
                if (instance !== undefined)
                    context.emit("SliceSelected", { sliceId: instance });
            }
            else if (button.dataset.act === "hide" && selected !== null) {
                context.emit("SliceHideRequested", { sliceId: selected });
            }
            else if (button.dataset.act === "add") {
                context.emit("SliceCreateRequested", {});
            }
            else if (button.dataset.act === "duplicate" && selected !== null) {
                context.emit("SliceDuplicateRequested", { sliceId: selected, priority: HUMAN_PRIORITY });
            }
            else if (button.dataset.act === "delete" && selected !== null) {
                context.emit("SliceDeleteRequested", { sliceId: selected, priority: HUMAN_PRIORITY });
            }
            else if (button.dataset.act === "lock" && selected !== null) {
                // LOCK raises the bar to the human's rank; UNLOCK clears it (0).
                context.emit("SliceLockRequested", {
                    sliceId: selected,
                    minPriority: isLocked(selected) ? 0 : HUMAN_PRIORITY,
                    priority: HUMAN_PRIORITY,
                });
            }
        });
        context.subscribe("SliceLocksDeclared", (fact) => {
            locks.clear();
            for (const [type, level] of Object.entries(fact.payload.locks))
                locks.set(type, level);
            render();
        });
        context.subscribe("SliceSelected", (fact) => {
            selected = fact.payload.sliceId;
            render();
        });
        context.subscribe("SliceVisibilityChanged", (fact) => {
            if (fact.payload.hidden)
                hidden.add(fact.payload.sliceId);
            else
                hidden.delete(fact.payload.sliceId);
            render();
        });
        context.subscribe("SliceMounted", (fact) => {
            instances.set(fact.payload.sliceType, fact.payload.sliceId);
            if (vacatedSelection !== null &&
                vacatedSelection.type === fact.payload.sliceType &&
                vacatedSelection.frame === fact.frame) {
                selected = fact.payload.sliceId;
                vacatedSelection = null;
            }
            render();
        });
        context.subscribe("SliceUnmounted", (fact) => {
            for (const [type, instance] of instances) {
                if (instance === fact.payload.sliceId)
                    instances.delete(type);
            }
            if (fact.payload.sliceId !== selected)
                return render();
            selected = null;
            vacatedSelection = {
                type: fact.payload.sliceId.split("#")[0],
                frame: fact.frame,
            };
            render();
        });
        context.subscribe("BufferChanged", (fact) => {
            activeType = fact.payload.meta.type;
            render();
        });
        context.subscribe("BufferRestored", (fact) => {
            activeType = fact.payload.meta.type;
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
        joinStage("r2c1@top");
        return () => host.remove();
    },
});
