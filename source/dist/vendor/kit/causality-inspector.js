import { chartered } from "./view-protocol.js";
// Bounded index of delivered facts; eviction is oldest-first and walks skip
// ids that have fallen out.
const FACT_LIMIT = 1500;
// The panel lists at most this many causes and effects; the rest collapse
// into a "+N" line so the tree never outgrows its overlay.
const ROW_LIMIT = 16;
// Brutalist HUD panel: hard borders, uppercase stencil labels, accents only
// on the root and hover — signage, not softness. Colours are semantic tokens
// with literal fallbacks; the stage publishes the actual palette.
const inspectorStyles = `
  * { box-sizing: border-box; }
  [data-causality-inspector] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    border: 2px solid var(--surface-600, #3d3d3d);
    background: var(--chip-surface, rgb(10 10 10 / 0.88));
    color: var(--surface-200, #b5b5b5);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  [data-causality-inspector] header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.25rem 0.45rem;
    border-bottom: 2px solid var(--surface-600, #3d3d3d);
  }
  [data-causality-inspector] header p {
    margin: 0;
    color: var(--accent-emit, #ff2fd2);
    font-size: 0.54rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  [data-causality-inspector] header button {
    padding: 0 0.3rem;
    border: 1px solid var(--surface-600, #3d3d3d);
    border-radius: 0;
    background: none;
    color: var(--surface-400, #6f6f6f);
    font: inherit;
    font-size: 0.6rem;
    cursor: pointer;
  }
  [data-causality-inspector] header button:hover {
    border-color: var(--accent-emit, #ff2fd2);
    color: var(--accent-emit, #ff2fd2);
  }
  [data-causality-inspector] .rows {
    max-height: 11rem;
    overflow-y: auto;
    padding: 0.2rem 0;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-600, #3d3d3d) transparent;
  }
  [data-causality-inspector] .hint,
  [data-causality-inspector] .more {
    margin: 0;
    padding: 0.15rem 0.45rem;
    color: var(--surface-400, #6f6f6f);
    font-size: 0.54rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  [data-causality-inspector] .row {
    display: flex;
    gap: 0.35rem;
    width: 100%;
    padding: 0.12rem 0.45rem;
    border: 0;
    border-radius: 0;
    background: none;
    color: var(--surface-200, #b5b5b5);
    font: inherit;
    font-size: 0.56rem;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  [data-causality-inspector] .row:hover { color: var(--accent-consume, #00e0ff); }
  [data-causality-inspector] .row.is-root { color: var(--accent-emit, #ff2fd2); cursor: default; }
  [data-causality-inspector] .row b { flex: none; color: var(--text-bright, #eaeaea); font-weight: 700; }
  [data-causality-inspector] .row.is-root b { color: inherit; }
  [data-causality-inspector] .row i {
    overflow: hidden;
    flex: 1;
    color: var(--surface-400, #6f6f6f);
    font-style: normal;
    text-align: right;
    text-overflow: ellipsis;
  }
`;
/**
 * Infrastructure slice factory: the causal-tree inspector. It indexes every
 * delivered fact by id, and when one is selected (FactSelected) it walks
 * causedBy upwards and its reverse index downwards, listing causes above and
 * effects below. The walked tree is also published as CausalPathTraced, so
 * anything else showing facts can light the same path without knowing this
 * slice exists.
 */
export function causalityInspectorFor(options) {
    return {
        type: "causality-inspector",
        description: "Walks a selected fact's causal tree: causes above, effects below.",
        consumes: ["*"],
        emits: ["ViewSlotRequested", "CausalPathTraced", "FactSelected", "FactDeselected"],
        start(context) {
            // The host is the stage's geometry surface; the shadow root is this
            // slice's sealed interior.
            const host = document.createElement("div");
            host.style.display = "none";
            const shadow = host.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = inspectorStyles;
            const tokenStyle = document.createElement("style");
            const view = document.createElement("aside");
            view.dataset.causalityInspector = "";
            view.innerHTML = `
      <header>
        <p>Causality</p>
        <button type="button" data-close aria-label="Deselect">X</button>
      </header>
      <div class="rows"><p class="hint">Click a fact in the pool</p></div>
    `;
            shadow.append(style, tokenStyle, view);
            document.body.append(host);
            const rows = view.querySelector(".rows");
            const close = view.querySelector("[data-close]");
            if (!rows || !close) {
                throw new Error("Causality inspector could not initialize its view.");
            }
            const records = new Map();
            const childrenOf = new Map();
            const evictionOrder = [];
            let rootId = null;
            // The last published tree, serialized — a re-walk that finds nothing new
            // must not emit another identical CausalPathTraced fact.
            let lastTraceKey = null;
            const remember = (fact) => {
                if (records.has(fact.id))
                    return;
                records.set(fact.id, {
                    id: fact.id,
                    type: fact.type,
                    sourceSlice: fact.sourceSlice,
                    frame: fact.frame,
                    causedBy: fact.causedBy,
                });
                evictionOrder.push(fact.id);
                for (const cause of fact.causedBy) {
                    const children = childrenOf.get(cause) ?? [];
                    children.push(fact.id);
                    childrenOf.set(cause, children);
                }
                if (evictionOrder.length > FACT_LIMIT) {
                    const evicted = evictionOrder.shift();
                    if (evicted !== undefined) {
                        records.delete(evicted);
                        childrenOf.delete(evicted);
                    }
                }
            };
            const byTime = (left, right) => left.frame - right.frame || left.id.localeCompare(right.id);
            // Both walks skip this slice's own facts: a published trace descends
            // from the tree it describes, and listing it would snowball every
            // later re-walk.
            const walk = (start, edges) => {
                const seen = new Set([start]);
                const found = [];
                const queue = [...edges(records.get(start), start)];
                while (queue.length > 0) {
                    const id = queue.shift();
                    if (id === undefined || seen.has(id))
                        continue;
                    seen.add(id);
                    const record = records.get(id);
                    if (record === undefined)
                        continue;
                    queue.push(...edges(record, id));
                    if (record.sourceSlice === context.instanceId)
                        continue;
                    found.push(record);
                }
                return found.sort(byTime);
            };
            const ancestorsOf = (id) => walk(id, (record) => record?.causedBy ?? []);
            const descendantsOf = (id) => walk(id, (_record, at) => childrenOf.get(at) ?? []);
            // True when the fact's causal ancestry reaches the selected root — the
            // signal that the displayed tree just grew a new effect.
            const reachesRoot = (fact) => {
                if (rootId === null)
                    return false;
                const seen = new Set();
                const queue = [...fact.causedBy];
                while (queue.length > 0) {
                    const id = queue.shift();
                    if (id === undefined || seen.has(id))
                        continue;
                    if (id === rootId)
                        return true;
                    seen.add(id);
                    const record = records.get(id);
                    if (record)
                        queue.push(...record.causedBy);
                }
                return false;
            };
            const rowHtml = (record, marker, isRoot) => `<button type="button" class="row${isRoot ? " is-root" : ""}" data-fact-id="${record.id}">` +
                `<span>${marker}</span><b>F${record.frame}</b><span>${record.type}</span>` +
                `<i>${record.sourceSlice}</i></button>`;
            const render = (root, causes, effects) => {
                const parts = [];
                if (causes.length > ROW_LIMIT) {
                    parts.push(`<p class="more">+${causes.length - ROW_LIMIT} earlier</p>`);
                }
                for (const cause of causes.slice(-ROW_LIMIT)) {
                    parts.push(rowHtml(cause, "▲", false));
                }
                parts.push(rowHtml(root, "●", true));
                for (const effect of effects.slice(0, ROW_LIMIT)) {
                    parts.push(rowHtml(effect, "▼", false));
                }
                if (effects.length > ROW_LIMIT) {
                    parts.push(`<p class="more">+${effects.length - ROW_LIMIT} later</p>`);
                }
                rows.innerHTML = parts.join("");
            };
            const renderHint = (message) => {
                rows.innerHTML = `<p class="hint">${message}</p>`;
            };
            const trace = () => {
                if (rootId === null)
                    return;
                const root = records.get(rootId);
                if (root === undefined) {
                    renderHint("Fact no longer recorded");
                    return;
                }
                const causes = ancestorsOf(rootId);
                const effects = descendantsOf(rootId);
                render(root, causes, effects);
                const factIds = [...causes, ...effects].map((record) => record.id);
                const traceKey = `${rootId}|${factIds.join(",")}`;
                if (traceKey === lastTraceKey)
                    return;
                lastTraceKey = traceKey;
                context.emit("CausalPathTraced", { rootId, factIds });
            };
            // Clicking a listed cause or effect re-roots the tree on it — as a new
            // FactSelected fact, so re-rooting replays like any other selection.
            rows.addEventListener("click", (event) => {
                const row = event.target instanceof Element
                    ? event.target.closest("[data-fact-id]")
                    : null;
                const factId = row?.dataset.factId;
                if (factId && factId !== rootId)
                    context.emit("FactSelected", { factId });
            });
            close.addEventListener("click", () => {
                if (rootId !== null)
                    context.emit("FactDeselected", {});
            });
            // Wildcard form of the slot protocol: one dispatcher called from the
            // "*" subscription. The panel is sized by its content; being placed
            // needs no re-measure.
            let slotRequested = false;
            let seatedBy = null;
            const stageFact = (fact, slot) => {
                if (fact.type === "StageTokensDeclared") {
                    const payload = fact.payload;
                    tokenStyle.textContent = `:host { ${Object.entries(payload.tokens)
                        .map(([name, value]) => `--${name}: ${value};`)
                        .join(" ")} }`;
                }
                else if (fact.type === "StageSlotsDeclared") {
                    const payload = fact.payload;
                    // A declaration from a stage other than the one holding this seat
                    // is a new stage (a hot reload of the stage): its ledger is empty,
                    // so the claim is re-asked from it.
                    if (slotRequested && seatedBy !== null && fact.sourceSlice !== seatedBy)
                        slotRequested = false;
                    if (!slotRequested && payload.slots.includes(slot)) {
                        slotRequested = true;
                        context.emit("ViewSlotRequested", { slot });
                    }
                }
                else if (fact.type === "ViewSlotAssigned") {
                    const payload = fact.payload;
                    if (payload.sliceId !== context.instanceId)
                        return;
                    seatedBy = fact.sourceSlice;
                    host.dataset.slot = payload.slot;
                    host.style.cssText = payload.geometry;
                }
                else if (fact.type === "ViewSlotDenied") {
                    // A denial is not forever: the claim clears, and the next
                    // declaration re-asks — the stage declares when a seat frees.
                    const payload = fact.payload;
                    if (payload.sliceId === context.instanceId)
                        slotRequested = false;
                }
            };
            context.subscribe("*", (fact) => {
                stageFact(fact, options.slot);
                remember(fact);
                if (fact.type === "FactSelected") {
                    rootId = fact.payload.factId;
                    lastTraceKey = null;
                    trace();
                }
                else if (fact.type === "FactDeselected") {
                    rootId = null;
                    lastTraceKey = null;
                    renderHint("Click a fact in the pool");
                }
                else if (fact.sourceSlice !== context.instanceId && reachesRoot(fact)) {
                    // A new effect grew on the displayed tree; our own facts never
                    // re-walk it, or each published trace would trigger the next.
                    trace();
                }
            });
            return () => host.remove();
        },
    };
}
/** The chartered form: no options — the stage publishes them as facts. */
export const causalityInspector = chartered({
    type: "causality-inspector",
    description: "Walks a selected fact's causal tree: causes above, effects below.",
    consumes: ["*"],
    emits: ["ViewSlotRequested", "CausalPathTraced", "FactSelected", "FactDeselected"],
}, (config) => causalityInspectorFor(config));
