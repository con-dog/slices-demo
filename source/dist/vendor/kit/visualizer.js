import { chartered } from "./view-protocol.js";
// How long an activated slice/wire stays lit, and how long a pulse travels.
const HEAT_MS = 650;
const PULSE_MS = 340;
// While playing, a throttled type animates only every Nth occurrence.
const THROTTLE_INTERVAL = 24;
// The pool is an instrument, not ambience: the horizontal axis is time (one
// column per recent fact-bearing frame, about COLUMN_PX wide) and the
// vertical axis is a swimlane per emitting slice, least-recently-active lane
// evicted past MAX_LANES.
const COLUMN_PX = 120;
const MAX_LANES = 8;
// A coalesced chip remembers this many member fact ids for causal lighting.
const COALESCE_ID_CAP = 64;
// This slice styles only its own interior, sealed inside its shadow root.
// Every colour below is a semantic token with a literal fallback: the
// application's stage publishes the actual palette via StageTokensDeclared
// and this slice applies it to :host — the same visualizer wears any skin.
const visualizerStyles = `
  * { box-sizing: border-box; }
  [data-slice-visualizer] {
    position: relative;
    display: grid;
    /* slices + wires + pool share the stage row, so the whole visualizer is a
       square that aligns top and bottom with the game square; the pool takes
       whatever the bands leave. */
    grid-template-rows: var(--slice-band, 10.25rem) var(--wire-band, 3.5rem) minmax(0, 1fr);
    height: 100%;
    color: var(--surface-200, #b5b5b5);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  [data-slice-visualizer] .slice-band {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-rows: minmax(0, 1fr);
    gap: 0.5rem;
    min-height: 0;
  }
  [data-slice-visualizer] .slice-band:not(.has-pages) .slice-nav { display: none; }
  [data-slice-visualizer] .slice-nav {
    width: 2rem;
    border: 2px solid var(--surface-600, #3d3d3d);
    border-radius: 0;
    background: var(--surface-800, #242424);
    color: var(--surface-200, #b5b5b5);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
  }
  [data-slice-visualizer] .slice-nav:hover:not(:disabled) {
    border-color: var(--accent-consume, #00e0ff);
    color: var(--accent-consume, #00e0ff);
  }
  [data-slice-visualizer] .slice-nav:disabled { opacity: 0.35; cursor: default; }
  [data-slice-visualizer] .slice-row {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    gap: 0.5rem;
    min-height: 0;
  }
  [data-slice-visualizer] .slice {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding: 0.5rem 0.55rem;
    border: 2px solid var(--surface-600, #3d3d3d);
    background: var(--surface-800, #242424);
    transition: border-color 100ms linear, box-shadow 100ms linear;
  }
  [data-slice-visualizer] .slice.is-source {
    border-color: var(--accent-emit, #ff2fd2);
    box-shadow: 0 0 0 1px var(--accent-emit, #ff2fd2), 0 0 16px color-mix(in srgb, var(--accent-emit, #ff2fd2) 55%, transparent);
  }
  [data-slice-visualizer] .slice.is-target {
    border-color: var(--accent-consume, #00e0ff);
    box-shadow: 0 0 0 1px var(--accent-consume, #00e0ff), 0 0 16px color-mix(in srgb, var(--accent-consume, #00e0ff) 45%, transparent);
  }
  /* Selectable mode (the selectSlices option): cards are buttons for their
     slice. The selection mark is a hard inset bar, not a glow — heat is
     traffic, selection is signage. */
  [data-slice-visualizer][data-selectable] .slice { cursor: pointer; }
  [data-slice-visualizer][data-selectable] .slice:hover {
    border-color: var(--surface-200, #b5b5b5);
  }
  [data-slice-visualizer] .slice.is-selected {
    border-color: var(--accent-emit, #ff2fd2);
    box-shadow: inset 0 3px 0 var(--accent-emit, #ff2fd2);
  }
  /* Hidden from the pool (SliceVisibilityChanged): the card stays, dotted. */
  [data-slice-visualizer] .slice.is-hidden { border-style: dotted; }
  /* Errored (SliceErrorChanged): the card stays but greys out, and a square
     red box with an exclamation mark sits in its top-right corner — hard
     edges, no softness. A mark, not an X: an X reads as a close button, and
     nothing here is clickable; the message is the tooltip. */
  [data-slice-visualizer] .slice.is-errored > :not(.slice-error) { opacity: 0.35; }
  [data-slice-visualizer] .slice .slice-error {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    display: none;
    place-items: center;
    width: 1rem;
    height: 1rem;
    background: var(--accent-error, #ff2f2f);
    color: var(--surface-950, #131313);
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1;
    cursor: default;
    user-select: none;
  }
  [data-slice-visualizer] .slice.is-errored .slice-error { display: grid; }
  /* Locked (SliceLocksDeclared): a square padlock box in the top-right
     corner, the consume accent — the lock is read where the slice is
     picked. Hard edges only: a bordered square shackle over a solid body.
     When the card is also errored, the red mark sits to its left. */
  [data-slice-visualizer] .slice .slice-lock {
    position: absolute;
    top: 0.35rem;
    right: 0.35rem;
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    width: 1.2rem;
    height: 1.2rem;
    background: var(--accent-consume, #00e0ff);
  }
  [data-slice-visualizer] .slice .slice-lock::before {
    content: "";
    width: 0.5rem;
    height: 0.4rem;
    border: 2px solid var(--surface-950, #131313);
    border-bottom: 0;
  }
  [data-slice-visualizer] .slice .slice-lock::after {
    content: "";
    width: 0.78rem;
    height: 0.46rem;
    margin-bottom: 0.14rem;
    background: var(--surface-950, #131313);
  }
  [data-slice-visualizer] .slice.is-locked .slice-lock { display: flex; }
  [data-slice-visualizer] .slice.is-locked.is-errored .slice-error { right: 1.8rem; }
  [data-slice-visualizer] .slice.is-errored > .slice-lock { opacity: 1; }
  [data-slice-visualizer] .slice-kind {
    overflow: hidden;
    margin: 0;
    color: var(--surface-400, #6f6f6f);
    font-size: 0.54rem;
    letter-spacing: 0.1em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  [data-slice-visualizer] .slice h3 {
    overflow: hidden;
    margin: 0.18rem 0 0.3rem;
    color: var(--text-bright, #eaeaea);
    font-size: 0.78rem;
    letter-spacing: 0.07em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  [data-slice-visualizer] .slice-description {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
    margin: 0 0 0.4rem;
    color: var(--surface-400, #6f6f6f);
    font-size: 0.58rem;
    line-height: 1.35;
  }
  [data-slice-visualizer] .contract {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-600, #3d3d3d) transparent;
  }
  [data-slice-visualizer] .contract::-webkit-scrollbar { width: 6px; }
  [data-slice-visualizer] .contract::-webkit-scrollbar-thumb {
    border-radius: 0;
    background: var(--surface-600, #3d3d3d);
  }
  [data-slice-visualizer] .contract-row {
    display: flex;
    gap: 0.3rem;
    margin-top: 0.25rem;
  }
  [data-slice-visualizer] .contract-row > span {
    flex: none;
    width: 1.6rem;
    padding-top: 0.1rem;
    color: var(--surface-400, #6f6f6f);
    font-size: 0.52rem;
    font-weight: 800;
    letter-spacing: 0.1em;
  }
  [data-slice-visualizer] .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.2rem;
    min-width: 0;
  }
  [data-slice-visualizer] .chip {
    padding: 0.06rem 0.25rem;
    border: 1px solid var(--surface-600, #3d3d3d);
    font-size: 0.54rem;
    white-space: nowrap;
  }
  [data-slice-visualizer] .chip.consume { border-color: var(--accent-consume, #00e0ff); color: var(--accent-consume, #00e0ff); }
  [data-slice-visualizer] .chip.emit { border-color: var(--accent-emit, #ff2fd2); color: var(--accent-emit, #ff2fd2); }
  [data-slice-visualizer] .empty { color: var(--surface-600, #3d3d3d); font-size: 0.54rem; }
  [data-slice-visualizer] .wire-zone { position: relative; }
  [data-slice-visualizer] .wire {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--surface-600, #3d3d3d);
  }
  [data-slice-visualizer] .wire.lane-emit {
    background: color-mix(in srgb, var(--accent-emit, #ff2fd2) 30%, var(--surface-600, #3d3d3d));
  }
  [data-slice-visualizer] .wire.lane-consume {
    background: color-mix(in srgb, var(--accent-consume, #00e0ff) 30%, var(--surface-600, #3d3d3d));
  }
  [data-slice-visualizer] .wire::before,
  [data-slice-visualizer] .wire::after {
    content: "";
    position: absolute;
    left: 50%;
    width: 8px;
    height: 4px;
    transform: translateX(-50%);
    background: inherit;
  }
  [data-slice-visualizer] .wire::before { top: 0; }
  [data-slice-visualizer] .wire::after { bottom: 0; }
  [data-slice-visualizer] .wire.is-hot-emit {
    background: var(--accent-emit, #ff2fd2);
    box-shadow: 0 0 8px var(--accent-emit, #ff2fd2);
  }
  [data-slice-visualizer] .wire.is-hot-consume {
    background: var(--accent-consume, #00e0ff);
    box-shadow: 0 0 8px var(--accent-consume, #00e0ff);
  }
  [data-slice-visualizer] .pool-basin {
    position: relative;
    min-height: 0;
    overflow: hidden;
    border: 2px solid var(--surface-400, #6f6f6f);
    border-top: 4px solid var(--accent-consume, #00e0ff);
    /* The one sanctioned gradient: the water. Its colours are tokens too. */
    background:
      repeating-linear-gradient(180deg, var(--water-line, rgb(0 224 255 / 0.07)) 0 2px, transparent 2px 28px),
      linear-gradient(180deg, var(--water-glint, rgb(0 148 200 / 0.28)) 0%, var(--water-deep, rgb(0 74 110 / 0.44)) 100%),
      var(--surface-900, #1b1b1b);
  }
  [data-slice-visualizer] .pool-frame {
    position: absolute;
    z-index: 3;
    top: 0.5rem;
    left: 0.6rem;
    margin: 0;
    color: var(--accent-consume, #00e0ff);
    font-size: 0.64rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  /* The instrument's layers: lane rules and labels under a frame grid under
     the chips. Only the chip layer takes clicks; the water shows through. */
  [data-slice-visualizer] .pool-lanes,
  [data-slice-visualizer] .pool-grid,
  [data-slice-visualizer] .pool-chips {
    position: absolute;
    inset: 0;
  }
  [data-slice-visualizer] .pool-lanes,
  [data-slice-visualizer] .pool-grid { pointer-events: none; }
  [data-slice-visualizer] .pool-grid-line {
    position: absolute;
    width: 1px;
    background: color-mix(in srgb, var(--text-bright, #eaeaea) 9%, transparent);
  }
  [data-slice-visualizer] .pool-grid-frame {
    position: absolute;
    bottom: 2px;
    transform: translateX(-50%);
    color: var(--surface-400, #6f6f6f);
    font-size: 0.5rem;
    letter-spacing: 0.06em;
  }
  [data-slice-visualizer] .pool-lane-rule {
    position: absolute;
    left: 6px;
    right: 6px;
    height: 1px;
    background: color-mix(in srgb, var(--text-bright, #eaeaea) 12%, transparent);
  }
  [data-slice-visualizer] .pool-lane-label {
    position: absolute;
    left: 10px;
    margin: 0;
    color: var(--surface-400, #6f6f6f);
    font-size: 0.5rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  [data-slice-visualizer] .fact-chip {
    position: absolute;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 0.28rem;
    margin: 0;
    padding: 0.1rem 0.3rem;
    transform: translate(-50%, -50%);
    border: 1px solid var(--accent-consume, #00e0ff);
    background: var(--chip-surface, rgb(6 20 26 / 0.82));
    color: var(--text-bright, #dff8ff);
    font-size: 0.56rem;
    white-space: nowrap;
    animation: chip-surface 180ms linear;
    cursor: pointer;
  }
  [data-slice-visualizer] .fact-chip .chip-type {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
  }
  [data-slice-visualizer] .fact-chip .chip-count {
    flex: none;
    color: var(--accent-emit, #ff2fd2);
    font-weight: 700;
  }
  /* One square dot per slice whose contract consumes the fact's type. */
  [data-slice-visualizer] .chip-dots { display: flex; flex: none; gap: 2px; }
  [data-slice-visualizer] .chip-dots .dot {
    width: 4px;
    height: 4px;
    background: var(--accent-consume, #00e0ff);
  }
  [data-slice-visualizer] .chip-dots .dot-more {
    color: var(--accent-consume, #00e0ff);
    font-size: 0.5rem;
  }
  /* A dead letter: no mounted contract consumes this type. */
  [data-slice-visualizer] .fact-chip.is-dead {
    border-style: dashed;
    border-color: var(--accent-emit, #ff2fd2);
    background: color-mix(in srgb, var(--accent-emit, #ff2fd2) 16%, var(--chip-surface, rgb(6 20 26 / 0.82)));
  }
  /* Heartbeat facts (throttledTypes) are thin ticks on the lane, never boxes. */
  [data-slice-visualizer] .fact-tick {
    position: absolute;
    z-index: 1;
    width: 3px;
    transform: translateX(-50%);
    background: color-mix(in srgb, var(--accent-consume, #00e0ff) 50%, transparent);
    cursor: pointer;
  }
  [data-slice-visualizer] .fact-tick:hover { background: var(--accent-consume, #00e0ff); }
  [data-slice-visualizer] .fact-chip:hover { border-color: var(--accent-emit, #ff2fd2); }
  [data-slice-visualizer] .pool-basin.has-selection [data-fact-id]:not(.on-path):not(.is-root) {
    opacity: 0.22;
  }
  [data-slice-visualizer] .fact-chip.on-path { border-color: var(--accent-emit, #ff2fd2); }
  [data-slice-visualizer] .fact-tick.on-path,
  [data-slice-visualizer] .fact-tick.is-root { background: var(--accent-emit, #ff2fd2); }
  [data-slice-visualizer] .fact-chip.is-root {
    border-color: var(--accent-emit, #ff2fd2);
    box-shadow: 0 0 10px color-mix(in srgb, var(--accent-emit, #ff2fd2) 60%, transparent);
  }
  @keyframes chip-surface { from { opacity: 0; } }
  [data-slice-visualizer] .pulse {
    position: absolute;
    z-index: 4;
    top: 0;
    left: 0;
    width: 0.5rem;
    height: 0.5rem;
    background: var(--accent-emit, #ff2fd2);
    box-shadow: 0 0 10px var(--accent-emit, #ff2fd2);
  }
  [data-slice-visualizer] .pulse.consume {
    background: var(--accent-consume, #00e0ff);
    box-shadow: 0 0 10px var(--accent-consume, #00e0ff);
  }
  @media (max-width: 64rem) {
    [data-slice-visualizer] {
      /* Stacked mode scrolls, so the pool keeps its full square height.
         --stage-size is stage-owned; the fallback only matters unstaged. */
      grid-template-rows: var(--slice-band) var(--wire-band) var(--stage-size, 24rem);
    }
    [data-slice-visualizer] .slice-description { display: none; }
  }
`;
function chips(events, kind) {
    if (events.length === 0)
        return '<span class="empty">—</span>';
    return events
        .map((event) => `<span class="chip ${kind}">${event}</span>`)
        .join("");
}
/**
 * Infrastructure slice factory: the pool visualizer. It receives every
 * delivered fact and reflects the pool's live topology as an electrical grid
 * — slices on top, wires dropping into the water, pulses travelling emit-down
 * and consume-up. The water itself is an instrument: facts land on a time ×
 * emitter grid (columns are frames, rows are swimlanes), consecutive repeats
 * coalesce into one chip with a ×N badge, consumer dots expose dead letters,
 * and heartbeat types run as thin lane ticks. It knows no slice by name (the
 * grid derives from SliceMounted / SliceUnmounted facts) and no palette
 * (tokens arrive as facts). Clicking a fact chip publishes FactSelected; a
 * CausalPathTraced answer lights the causal path.
 */
export function visualizerFor(options) {
    const throttledTypes = new Set(options.throttledTypes ?? ["FrameTicked"]);
    return {
        type: "visualizer",
        description: "Watches the pool and renders the slice → pool → slice grid.",
        consumes: ["*"],
        emits: [
            "ViewSlotRequested",
            "FactSelected",
            "FactDeselected",
            ...(options.selectSlices ? ["SliceSelected"] : []),
            ...(options.hideSlices ? ["SliceVisibilityChanged"] : []),
        ],
        start(context) {
            // The host is the stage's geometry surface; the shadow root is this
            // slice's sealed interior.
            const host = document.createElement("div");
            host.style.display = "none";
            const shadow = host.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = visualizerStyles;
            const tokenStyle = document.createElement("style");
            const view = document.createElement("section");
            view.dataset.sliceVisualizer = "";
            if (options.selectSlices)
                view.dataset.selectable = "";
            view.innerHTML = `
      <div class="slice-band">
        <button type="button" class="slice-nav" data-nav-prev aria-label="Previous slices">◀</button>
        <div class="slice-row" aria-label="Slice slices"></div>
        <button type="button" class="slice-nav" data-nav-next aria-label="Next slices">▶</button>
      </div>
      <div class="wire-zone" aria-hidden="true"></div>
      <div class="pool-basin" aria-label="Pool">
        <p class="pool-frame">POOL | Frame <b data-pool-frame>0</b></p>
        <div class="pool-lanes" aria-hidden="true"></div>
        <div class="pool-grid" aria-hidden="true"></div>
        <div class="pool-chips"></div>
      </div>
    `;
            shadow.append(style, tokenStyle, view);
            document.body.append(host);
            const sliceBand = view.querySelector(".slice-band");
            const sliceRow = view.querySelector(".slice-row");
            const navPrev = view.querySelector("[data-nav-prev]");
            const navNext = view.querySelector("[data-nav-next]");
            const wireZone = view.querySelector(".wire-zone");
            const basin = view.querySelector(".pool-basin");
            const poolFrame = view.querySelector("[data-pool-frame]");
            const laneLayer = view.querySelector(".pool-lanes");
            const gridLayer = view.querySelector(".pool-grid");
            const chipLayer = view.querySelector(".pool-chips");
            if (!sliceBand ||
                !sliceRow ||
                !navPrev ||
                !navNext ||
                !wireZone ||
                !basin ||
                !poolFrame ||
                !laneLayer ||
                !gridLayer ||
                !chipLayer) {
                throw new Error("Visualizer could not initialize its view.");
            }
            const slices = new Map();
            const sliceOrder = [];
            const cards = new Map();
            const emitWires = new Map();
            const consumeWires = new Map();
            const emitX = new Map();
            const consumeX = new Map();
            const heatTimers = new Map();
            let playing = true;
            let pageIndex = 0;
            // The causal selection, as last announced by a CausalPathTraced fact.
            // A click only publishes FactSelected; the highlight arrives back
            // through the pool, so selection is scrubbable history like everything
            // else — this slice never walks the causal graph itself.
            let selection = null;
            // The selected slice card, as last announced by a SliceSelected fact.
            // A click only publishes the intent; the mark arrives back through the
            // pool, so every selector (this slice, a toolbar, a replay) agrees.
            let selectedSlice = null;
            // Slices hidden from the pool, as announced by SliceVisibilityChanged
            // facts. This slice owns the flip (the hideSlices option) but applies
            // it like everyone else: when the fact comes back through the pool.
            const hiddenSlices = new Set();
            // Errored slices (SliceErrorChanged facts): instance id -> message.
            // Applied when a card renders, since a hot reload rebuilds the card.
            const erroredSlices = new Map();
            const typeOf = (id) => id.split("#")[0];
            // Locked types (SliceLocksDeclared, keyed by slice TYPE — a lock
            // outlives hot reloads): type -> the minimum priority an intent needs.
            const lockedTypes = new Map();
            const lockTitle = (level) => `Locked >=${level}: intents below priority ${level} (a machine author's 1) cannot edit, copy or delete this slice; the human's toolbar unlocks it`;
            const applyLock = (card, sliceId) => {
                const level = lockedTypes.get(typeOf(sliceId));
                card.classList.toggle("is-locked", level !== undefined);
                const badge = card.querySelector(".slice-lock");
                if (badge)
                    badge.title = level === undefined ? "" : lockTitle(level);
            };
            // Hot-reload manners, both orders. An unmount+mount of the same slice
            // type in one frame is a replacement, so the new card keeps the old
            // card's marquee position and inherits its selection instead of
            // jumping to the end. A mount while an older instance of the type
            // still lives (a successor mounted before its predecessor retires) is
            // a replacement in progress: the new card sits right after the old
            // one and is named its heir, so when the old card goes the selection
            // crosses over instead of clearing.
            const vacatedByType = new Map();
            let vacatedSelection = null;
            const heirs = new Map();
            const applySliceSelection = () => {
                for (const [id, card] of cards) {
                    card.classList.toggle("is-selected", id === selectedSlice);
                }
            };
            // The slice band is a ratcheted marquee: at most two wide slices per window
            // (one when even that cannot stay readable), and the nav blocks step one
            // whole window at a time. Never a continuous scroll.
            const MIN_CARD_PX = 150;
            const MAX_VISIBLE_sliceS = 2;
            const perPage = () => Math.max(1, Math.min(MAX_VISIBLE_sliceS, Math.floor(sliceBand.clientWidth / MIN_CARD_PX)));
            // Every slice drops up to two lanes onto the pool's bus bar: an emit lane
            // (pulses travel down) and a consume lane (pulses travel up), present
            // only where the contract declares that side. Positions are measured, so
            // mounts and resizes re-layout.
            const LANE_OFFSET = 6;
            const layoutWires = () => {
                const zoneLeft = wireZone.getBoundingClientRect().left;
                for (const [id, card] of cards) {
                    const rect = card.getBoundingClientRect();
                    if (rect.width === 0)
                        continue; // outside the marquee window
                    const centre = rect.left + rect.width / 2 - zoneLeft;
                    const emitWire = emitWires.get(id);
                    const consumeWire = consumeWires.get(id);
                    // A single lane sits on centre; a pair straddles it.
                    const spread = emitWire && consumeWire ? LANE_OFFSET : 0;
                    if (emitWire) {
                        emitX.set(id, centre - spread);
                        emitWire.style.left = `${centre - spread}px`;
                    }
                    if (consumeWire) {
                        consumeX.set(id, centre + spread);
                        consumeWire.style.left = `${centre + spread}px`;
                    }
                }
            };
            // Shows the current window of slices; everything else (card + lanes) is
            // hidden and stops receiving pulses until ratcheted back into view.
            const renderWindow = () => {
                const n = perPage();
                const pageCount = Math.max(1, Math.ceil(sliceOrder.length / n));
                pageIndex = Math.min(pageIndex, pageCount - 1);
                const visible = new Set(sliceOrder.slice(pageIndex * n, pageIndex * n + n));
                for (const [id, card] of cards) {
                    const show = visible.has(id);
                    card.style.display = show ? "" : "none";
                    const emitWire = emitWires.get(id);
                    if (emitWire)
                        emitWire.style.display = show ? "" : "none";
                    const consumeWire = consumeWires.get(id);
                    if (consumeWire)
                        consumeWire.style.display = show ? "" : "none";
                    if (!show) {
                        emitX.delete(id);
                        consumeX.delete(id);
                    }
                }
                sliceBand.classList.toggle("has-pages", sliceOrder.length > n);
                navPrev.disabled = pageIndex === 0;
                navNext.disabled = pageIndex >= pageCount - 1;
                requestAnimationFrame(layoutWires);
            };
            navPrev.addEventListener("click", () => {
                pageIndex = Math.max(0, pageIndex - 1);
                renderWindow();
            });
            navNext.addEventListener("click", () => {
                pageIndex += 1;
                renderWindow();
            });
            // layoutPool is defined below with the pool model; resize events only
            // fire once start() has returned, so the late binding is safe.
            const handleResize = () => {
                renderWindow();
                layoutPool();
            };
            window.addEventListener("resize", handleResize);
            if (options.selectSlices) {
                sliceRow.addEventListener("click", (event) => {
                    const card = event.target instanceof Element
                        ? event.target.closest(".slice")
                        : null;
                    const sliceId = card?.dataset.sliceId;
                    if (sliceId)
                        context.emit("SliceSelected", { sliceId });
                });
            }
            const addslice = (slice) => {
                // The pool re-publishes living mounts to late joiners; a card is
                // built once per instance.
                if (slices.has(slice.id))
                    return;
                slices.set(slice.id, slice);
                const card = document.createElement("article");
                card.className = "slice";
                card.dataset.sliceId = slice.id;
                card.classList.toggle("is-selected", slice.id === selectedSlice);
                card.classList.toggle("is-hidden", hiddenSlices.has(slice.id));
                const error = erroredSlices.get(slice.id);
                card.classList.toggle("is-errored", error !== undefined);
                card.innerHTML = `
        <span class="slice-lock" aria-label="locked"></span>
        <span class="slice-error" aria-label="errored">!</span>
        <p class="slice-kind">slice | ${slice.id}</p>
        <h3>${slice.label}</h3>
        <p class="slice-description">${slice.description}</p>
        <div class="contract">
          <div class="contract-row"><span>IN</span><div class="chips">${chips(slice.consumes, "consume")}</div></div>
          <div class="contract-row"><span>OUT</span><div class="chips">${chips(slice.emits, "emit")}</div></div>
        </div>
      `;
                applyLock(card, slice.id);
                if (error !== undefined) {
                    const badge = card.querySelector(".slice-error");
                    if (badge)
                        badge.title = error;
                }
                // A replacement mount takes the vacated card's place in the row; a
                // successor of a still-living instance sits right after it; everything
                // else joins at the end.
                const vacatedAt = vacatedByType.get(typeOf(slice.id));
                vacatedByType.delete(typeOf(slice.id));
                const elderAt = (() => {
                    for (let index = sliceOrder.length - 1; index >= 0; index -= 1) {
                        if (typeOf(sliceOrder[index]) === typeOf(slice.id))
                            return index;
                    }
                    return -1;
                })();
                if (vacatedAt !== undefined && vacatedAt < sliceOrder.length) {
                    const anchor = cards.get(sliceOrder[vacatedAt] ?? "");
                    sliceRow.insertBefore(card, anchor ?? null);
                    sliceOrder.splice(vacatedAt, 0, slice.id);
                }
                else if (elderAt !== -1) {
                    const elder = sliceOrder[elderAt];
                    heirs.set(elder, slice.id);
                    const anchor = cards.get(sliceOrder[elderAt + 1] ?? "");
                    sliceRow.insertBefore(card, anchor ?? null);
                    sliceOrder.splice(elderAt + 1, 0, slice.id);
                }
                else {
                    sliceRow.append(card);
                    sliceOrder.push(slice.id);
                }
                cards.set(slice.id, card);
                if (slice.emits.length > 0) {
                    const wire = document.createElement("div");
                    wire.className = "wire lane-emit";
                    wireZone.append(wire);
                    emitWires.set(slice.id, wire);
                }
                if (slice.consumes.length > 0) {
                    const wire = document.createElement("div");
                    wire.className = "wire lane-consume";
                    wireZone.append(wire);
                    consumeWires.set(slice.id, wire);
                }
                renderWindow();
            };
            const removeslice = (id) => {
                slices.delete(id);
                cards.get(id)?.remove();
                cards.delete(id);
                emitWires.get(id)?.remove();
                emitWires.delete(id);
                emitX.delete(id);
                consumeWires.get(id)?.remove();
                consumeWires.delete(id);
                consumeX.delete(id);
                const index = sliceOrder.indexOf(id);
                if (index !== -1) {
                    sliceOrder.splice(index, 1);
                    vacatedByType.set(typeOf(id), index);
                }
                renderWindow();
            };
            const consumersFor = (fact) => [...slices.values()].filter((slice) => slice.id !== fact.sourceSlice &&
                (slice.consumes.includes(fact.type) ||
                    slice.consumes.includes("*")));
            // Heat = a transient neon class with its own refreshable timer, so
            // overlapping facts never strobe each other off.
            const heat = (key, element, className) => {
                element.classList.add(className);
                const existing = heatTimers.get(key);
                if (existing !== undefined)
                    window.clearTimeout(existing);
                heatTimers.set(key, window.setTimeout(() => {
                    element.classList.remove(className);
                    heatTimers.delete(key);
                }, HEAT_MS));
            };
            const entries = [];
            const lanes = [];
            const columnFrames = [];
            const gridCells = [];
            let maxColumns = 6;
            // Chart insets: room for the POOL header above, the frame axis below.
            const PAD = { top: 30, bottom: 16, left: 10, right: 10 };
            const dropEntry = (index) => {
                entries[index]?.element.remove();
                entries.splice(index, 1);
            };
            const dropColumn = (frame) => {
                for (let i = entries.length - 1; i >= 0; i--) {
                    if (entries[i]?.frame === frame)
                        dropEntry(i);
                }
            };
            // Finds or inserts the column for a frame; false = already scrolled
            // off the left edge (a pulse can land its chip a beat late).
            const columnFor = (frame) => {
                if (columnFrames.includes(frame))
                    return true;
                if (columnFrames.length >= maxColumns && frame < (columnFrames[0] ?? 0))
                    return false;
                let at = columnFrames.length;
                while (at > 0 && (columnFrames[at - 1] ?? 0) > frame)
                    at -= 1;
                columnFrames.splice(at, 0, frame);
                while (columnFrames.length > maxColumns) {
                    const dropped = columnFrames.shift();
                    if (dropped !== undefined)
                        dropColumn(dropped);
                }
                return columnFrames.includes(frame);
            };
            const laneFor = (id, frame) => {
                let lane = lanes.find((candidate) => candidate.id === id);
                if (!lane) {
                    if (lanes.length >= MAX_LANES) {
                        // Evict the least-recently-active lane, entries and all.
                        const lru = lanes.reduce((a, b) => a.lastActive <= b.lastActive ? a : b);
                        for (let i = entries.length - 1; i >= 0; i--) {
                            if (entries[i]?.lane === lru.id)
                                dropEntry(i);
                        }
                        lru.labelEl.remove();
                        lru.ruleEl.remove();
                        lanes.splice(lanes.indexOf(lru), 1);
                    }
                    const labelEl = document.createElement("p");
                    labelEl.className = "pool-lane-label";
                    labelEl.textContent = id;
                    const ruleEl = document.createElement("div");
                    ruleEl.className = "pool-lane-rule";
                    laneLayer.append(ruleEl, labelEl);
                    lane = { id, labelEl, ruleEl, lastActive: frame };
                    lanes.push(lane);
                }
                lane.lastActive = frame;
                return lane;
            };
            const layoutPool = () => {
                const width = basin.clientWidth;
                const height = basin.clientHeight;
                if (width === 0 || height === 0)
                    return;
                const usableW = Math.max(width - PAD.left - PAD.right, 60);
                const usableH = Math.max(height - PAD.top - PAD.bottom, 40);
                maxColumns = Math.max(3, Math.floor(usableW / COLUMN_PX));
                while (columnFrames.length > maxColumns) {
                    const dropped = columnFrames.shift();
                    if (dropped !== undefined)
                        dropColumn(dropped);
                }
                // A coalesced chip migrates to its newest column; prune columns its
                // migration emptied, so every gridline still marks a visible fact.
                for (let i = columnFrames.length - 1; i >= 0; i--) {
                    const frame = columnFrames[i];
                    if (!entries.some((entry) => entry.frame === frame)) {
                        columnFrames.splice(i, 1);
                    }
                }
                const colW = usableW / maxColumns;
                // Columns are right-aligned so the newest frame rides the right edge.
                const xFor = (frame) => {
                    const visual = columnFrames.indexOf(frame) + (maxColumns - columnFrames.length);
                    return PAD.left + colW * (visual + 0.5);
                };
                while (gridCells.length < columnFrames.length) {
                    const line = document.createElement("div");
                    line.className = "pool-grid-line";
                    const label = document.createElement("p");
                    label.className = "pool-grid-frame";
                    label.style.margin = "0";
                    gridLayer.append(line, label);
                    gridCells.push({ line, label });
                }
                while (gridCells.length > columnFrames.length) {
                    const cell = gridCells.pop();
                    cell?.line.remove();
                    cell?.label.remove();
                }
                columnFrames.forEach((frame, i) => {
                    const cell = gridCells[i];
                    if (!cell)
                        return;
                    const x = xFor(frame);
                    cell.line.style.left = `${x}px`;
                    cell.line.style.top = `${PAD.top}px`;
                    cell.line.style.bottom = `${PAD.bottom}px`;
                    cell.label.style.left = `${x}px`;
                    cell.label.textContent = String(frame);
                });
                // A lane lives only while it has entries in the window — the chart
                // reads "who is talking now", not "who has ever talked".
                for (let i = lanes.length - 1; i >= 0; i--) {
                    const lane = lanes[i];
                    if (lane && !entries.some((entry) => entry.lane === lane.id)) {
                        lane.labelEl.remove();
                        lane.ruleEl.remove();
                        lanes.splice(i, 1);
                    }
                }
                const laneH = usableH / Math.max(lanes.length, 1);
                lanes.forEach((lane, row) => {
                    const top = PAD.top + row * laneH;
                    lane.ruleEl.style.top = `${top}px`;
                    lane.labelEl.style.top = `${top + 2}px`;
                });
                // Same lane + same column stacks downward instead of overlapping.
                const stacks = new Map();
                for (const entry of entries) {
                    const row = lanes.findIndex((lane) => lane.id === entry.lane);
                    if (row === -1)
                        continue;
                    const key = `${entry.lane}|${entry.frame}|${entry.tick}`;
                    const index = stacks.get(key) ?? 0;
                    stacks.set(key, index + 1);
                    const laneTop = PAD.top + row * laneH;
                    const x = xFor(entry.frame);
                    if (entry.tick) {
                        entry.element.style.left = `${x + index * 5}px`;
                        entry.element.style.top = `${laneTop + laneH * 0.62}px`;
                        entry.element.style.height = `${Math.max(laneH * 0.38 - 3, 6)}px`;
                    }
                    else {
                        entry.element.style.maxWidth = `${Math.max(colW * 1.5, 90)}px`;
                        entry.element.style.left = `${x}px`;
                        entry.element.style.top = `${Math.min(laneTop + laneH / 2 + index * 16, laneTop + laneH - 9)}px`;
                    }
                }
            };
            // The slices whose CONTRACTS name the type — wildcard infrastructure
            // (this slice, a timeline, a fact log) deliberately does not count, or
            // no fact could ever read as unconsumed. Zero declared consumers is the
            // pool's best passive diagnostic: a dead letter. One exception keeps
            // it honest: a chartered view listens for the types its CHARTER names
            // (a timeline's stepBack.on, resetToLiveOn…) — the charter is on the
            // board as ViewConfigDeclared, so those count for the view's type.
            const charters = new Map();
            const stringLeaves = (value, into) => {
                if (typeof value === "string")
                    into.add(value);
                else if (Array.isArray(value))
                    for (const entry of value)
                        stringLeaves(entry, into);
                else if (typeof value === "object" && value !== null) {
                    for (const entry of Object.values(value))
                        stringLeaves(entry, into);
                }
            };
            const declaredConsumersOf = (entry) => [...slices.values()]
                .filter((slice) => slice.id !== entry.lane &&
                (slice.consumes.includes(entry.type) ||
                    (charters.get(slice.id.split("#")[0])?.has(entry.type) ?? false)))
                .map((slice) => slice.id);
            const renderEntry = (entry) => {
                const consumers = declaredConsumersOf(entry);
                const span = entry.count > 1 && entry.firstFrame !== entry.frame
                    ? `F${entry.firstFrame}-F${entry.frame}`
                    : `F${entry.frame}`;
                const consumedBy = consumers.length === 0
                    ? "NO CONSUMERS"
                    : `consumed by ${consumers.join(" | ")}`;
                const badge = entry.count > 1 ? ` x${entry.count}` : "";
                entry.element.title = `${span} ${entry.type}${badge} | ${consumedBy}`;
                if (entry.tick)
                    return;
                entry.element.classList.toggle("is-dead", consumers.length === 0);
                const dots = consumers
                    .slice(0, 6)
                    .map(() => '<span class="dot"></span>')
                    .join("");
                const more = consumers.length > 6
                    ? `<span class="dot-more">+${consumers.length - 6}</span>`
                    : "";
                entry.element.innerHTML = `<span class="chip-type">${entry.type}</span>${entry.count > 1 ? `<b class="chip-count">×${entry.count}</b>` : ""}${consumers.length > 0 ? `<span class="chip-dots">${dots}${more}</span>` : ""}`;
            };
            const decorateEntry = (entry) => {
                const isRoot = selection !== null && entry.factIds.includes(selection.rootId);
                const onPath = selection !== null &&
                    entry.factIds.some((id) => selection?.path.has(id));
                entry.element.classList.toggle("is-root", isRoot);
                entry.element.classList.toggle("on-path", onPath && !isRoot);
            };
            const applySelection = () => {
                basin.classList.toggle("has-selection", selection !== null);
                for (const entry of entries)
                    decorateEntry(entry);
            };
            basin.addEventListener("click", (event) => {
                const mark = event.target instanceof Element
                    ? event.target.closest("[data-fact-id]")
                    : null;
                const factId = mark?.dataset.factId;
                if (factId)
                    context.emit("FactSelected", { factId });
                else if (selection)
                    context.emit("FactDeselected", {});
            });
            const addFactToPool = (fact, tick) => {
                // A hidden emitter gets no lane and no chips — its card (dotted)
                // and the contract dots on other slices' chips are unaffected.
                if (hiddenSlices.has(fact.sourceSlice))
                    return;
                if (!columnFor(fact.frame))
                    return; // older than the visible window
                const lane = laneFor(fact.sourceSlice, fact.frame);
                if (tick) {
                    // Ticks mark cadence per column; repeats in one column just count.
                    const same = entries.find((entry) => entry.tick &&
                        entry.lane === lane.id &&
                        entry.type === fact.type &&
                        entry.frame === fact.frame);
                    if (same) {
                        same.count += 1;
                        if (same.factIds.length < COALESCE_ID_CAP)
                            same.factIds.push(fact.id);
                        same.element.dataset.factId = fact.id;
                        renderEntry(same);
                        decorateEntry(same);
                        return;
                    }
                }
                else {
                    // Coalesce a consecutive same-type run in this lane into one chip
                    // with a ×N badge riding the right edge — twelve GenerationAdvanced
                    // boxes carry the information of one.
                    let last;
                    for (let i = entries.length - 1; i >= 0; i--) {
                        const candidate = entries[i];
                        if (candidate && candidate.lane === lane.id && !candidate.tick) {
                            last = candidate;
                            break;
                        }
                    }
                    if (last && last.type === fact.type) {
                        last.count += 1;
                        last.frame = fact.frame;
                        if (last.factIds.length < COALESCE_ID_CAP)
                            last.factIds.push(fact.id);
                        last.element.dataset.factId = fact.id;
                        renderEntry(last);
                        decorateEntry(last);
                        layoutPool();
                        return;
                    }
                }
                const element = document.createElement(tick ? "div" : "p");
                element.className = tick ? "fact-tick" : "fact-chip";
                element.dataset.factId = fact.id;
                const entry = {
                    element,
                    lane: lane.id,
                    type: fact.type,
                    frame: fact.frame,
                    firstFrame: fact.frame,
                    count: 1,
                    factIds: [fact.id],
                    tick,
                };
                entries.push(entry);
                renderEntry(entry);
                decorateEntry(entry);
                chipLayer.append(element);
                layoutPool();
            };
            const firePulse = (x, kind, onDone) => {
                const viewRect = view.getBoundingClientRect();
                const zoneRect = wireZone.getBoundingClientRect();
                const px = zoneRect.left - viewRect.left + x - 4;
                const topY = zoneRect.top - viewRect.top;
                const bottomY = zoneRect.bottom - viewRect.top + 26; // dive past the bus bar
                const pulse = document.createElement("div");
                pulse.className = kind === "consume" ? "pulse consume" : "pulse";
                view.append(pulse);
                const [from, to] = kind === "emit" ? [topY, bottomY] : [bottomY, topY];
                const animation = pulse.animate([
                    { transform: `translate(${px}px, ${from}px)` },
                    { transform: `translate(${px}px, ${to}px)` },
                ], {
                    duration: PULSE_MS,
                    easing: kind === "emit" ? "ease-in" : "ease-out",
                });
                animation.onfinish = () => {
                    pulse.remove();
                    onDone?.();
                };
                animation.oncancel = () => pulse.remove();
            };
            const showFact = (fact, tick) => {
                const targets = consumersFor(fact);
                const deliver = () => {
                    for (const target of targets) {
                        const card = cards.get(target.id);
                        const wire = consumeWires.get(target.id);
                        const x = consumeX.get(target.id);
                        if (card)
                            heat(`${target.id}|target`, card, "is-target");
                        if (wire)
                            heat(`${target.id}|consume`, wire, "is-hot-consume");
                        if (x !== undefined)
                            firePulse(x, "consume");
                    }
                };
                const sourceCard = cards.get(fact.sourceSlice);
                const sourceX = emitX.get(fact.sourceSlice);
                if (sourceCard && sourceX !== undefined) {
                    heat(`${fact.sourceSlice}|source`, sourceCard, "is-source");
                    const wire = emitWires.get(fact.sourceSlice);
                    if (wire)
                        heat(`${fact.sourceSlice}|emit`, wire, "is-hot-emit");
                    firePulse(sourceX, "emit", () => {
                        addFactToPool(fact, tick);
                        deliver();
                    });
                }
                else {
                    // Pool-sourced facts (and facts from off-window slices) surface
                    // directly in the water.
                    addFactToPool(fact, tick);
                    deliver();
                }
            };
            // Wildcard form of the slot protocol: one dispatcher called from the "*"
            // subscription. The marquee window was measured while hidden, so being
            // placed re-measures it.
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
                    renderWindow();
                    layoutPool();
                }
                else if (fact.type === "ViewSlotDenied") {
                    // A denial is not forever: the claim clears, and the next
                    // declaration re-asks — the stage declares when a seat frees.
                    const payload = fact.payload;
                    if (payload.sliceId === context.instanceId)
                        slotRequested = false;
                }
            };
            // Per-type occurrence counters for the animation throttle.
            const occurrences = new Map();
            context.subscribe("*", (fact) => {
                stageFact(fact, options.slot);
                if (fact.type === "ViewConfigDeclared") {
                    const charter = fact.payload;
                    const named = new Set();
                    stringLeaves(charter.config, named);
                    charters.set(charter.view, named);
                }
                // Facts are processed strictly in delivery order, so a mount and an
                // unmount landing in the same frame resolve correctly.
                if (fact.type === "SliceMounted") {
                    const payload = fact.payload;
                    addslice({
                        id: payload.sliceId,
                        label: payload.sliceType.replace(/-/g, " "),
                        description: payload.description ?? "",
                        consumes: payload.consumes,
                        emits: payload.emits,
                    });
                    // The selected slice was hot-reloaded: its replacement (same
                    // type, same frame) inherits the selection mark.
                    if (vacatedSelection !== null &&
                        vacatedSelection.type === payload.sliceType &&
                        vacatedSelection.frame === fact.frame) {
                        selectedSlice = payload.sliceId;
                        vacatedSelection = null;
                        applySliceSelection();
                    }
                }
                else if (fact.type === "SliceUnmounted") {
                    const gone = fact.payload
                        .sliceId;
                    const heir = heirs.get(gone);
                    heirs.delete(gone);
                    removeslice(gone);
                    erroredSlices.delete(gone);
                    if (selectedSlice === gone) {
                        if (heir !== undefined && cards.has(heir)) {
                            selectedSlice = heir;
                            applySliceSelection();
                        }
                        else {
                            selectedSlice = null;
                            vacatedSelection = { type: typeOf(gone), frame: fact.frame };
                        }
                    }
                }
                else if (fact.type === "SliceErrorChanged") {
                    const payload = fact.payload;
                    if (payload.errored) {
                        erroredSlices.set(payload.sliceId, payload.message ?? "");
                    }
                    else {
                        erroredSlices.delete(payload.sliceId);
                    }
                    const card = cards.get(payload.sliceId);
                    if (card) {
                        card.classList.toggle("is-errored", payload.errored);
                        const badge = card.querySelector(".slice-error");
                        if (badge)
                            badge.title = payload.message ?? "";
                    }
                }
                else if (fact.type === "SliceLocksDeclared") {
                    const payload = fact.payload;
                    lockedTypes.clear();
                    for (const [type, level] of Object.entries(payload.locks))
                        lockedTypes.set(type, level);
                    for (const [sliceId, card] of cards)
                        applyLock(card, sliceId);
                }
                else if (fact.type === "SliceSelected") {
                    selectedSlice = fact.payload.sliceId;
                    applySliceSelection();
                    // The marquee ratchets to the window holding the selected card
                    // (an off-window pick, a toolbar's jump) — a step, never a scroll.
                    const index = sliceOrder.indexOf(selectedSlice);
                    if (index !== -1) {
                        const page = Math.floor(index / perPage());
                        if (page !== pageIndex) {
                            pageIndex = page;
                            renderWindow();
                        }
                    }
                }
                else if (fact.type === "SliceHideRequested" && options.hideSlices) {
                    // This slice owns pool visibility: the intent is answered with a
                    // state fact, and the flag applies below when that fact arrives.
                    const requested = fact.payload.sliceId;
                    context.emit("SliceVisibilityChanged", {
                        sliceId: requested,
                        hidden: !hiddenSlices.has(requested),
                    });
                }
                else if (fact.type === "SliceVisibilityChanged") {
                    const payload = fact.payload;
                    if (payload.hidden)
                        hiddenSlices.add(payload.sliceId);
                    else
                        hiddenSlices.delete(payload.sliceId);
                    cards
                        .get(payload.sliceId)
                        ?.classList.toggle("is-hidden", payload.hidden);
                    if (payload.hidden) {
                        for (let i = entries.length - 1; i >= 0; i--) {
                            if (entries[i]?.lane === payload.sliceId)
                                dropEntry(i);
                        }
                        layoutPool();
                    }
                }
                else if (fact.type === "PlaybackStateChanged") {
                    // Paused frames arrive one Step at a time, so every fact animates;
                    // at full speed the tick stream is throttled below.
                    playing = fact.payload.playing;
                }
                else if (fact.type === "CausalPathTraced") {
                    const payload = fact.payload;
                    selection = {
                        rootId: payload.rootId,
                        path: new Set(payload.factIds),
                    };
                    applySelection();
                }
                else if (fact.type === "FactDeselected") {
                    selection = null;
                    applySelection();
                }
                poolFrame.textContent = String(fact.frame);
                // Heartbeat streams always land in the pool (as ticks — cheap and
                // bounded by the column window) but only pulse every Nth occurrence
                // while playing; paused frames arrive one Step at a time, so there
                // every fact animates.
                const tick = throttledTypes.has(fact.type);
                if (tick && playing) {
                    const count = (occurrences.get(fact.type) ?? 0) + 1;
                    occurrences.set(fact.type, count);
                    if (count % THROTTLE_INTERVAL !== 0) {
                        addFactToPool(fact, tick);
                        return;
                    }
                }
                showFact(fact, tick);
            });
            return () => {
                for (const timer of heatTimers.values())
                    window.clearTimeout(timer);
                heatTimers.clear();
                window.removeEventListener("resize", handleResize);
                for (const animation of view.getAnimations({ subtree: true }))
                    animation.cancel();
                host.remove();
            };
        },
    };
}
/** The chartered form: no options — the stage publishes them as facts. */
export const visualizer = chartered({
    type: "visualizer",
    description: "Watches the pool and renders the slice → pool → slice grid.",
    consumes: ["*"],
    emits: [
        "ViewSlotRequested",
        "FactSelected",
        "FactDeselected",
        "SliceSelected",
        "SliceVisibilityChanged",
    ],
}, (config) => visualizerFor(config));
