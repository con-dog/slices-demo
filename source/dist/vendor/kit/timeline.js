import { chartered } from "./view-protocol.js";
// Only frames that carried facts are recorded, as a bounded ring. While
// playing, every frame carries a FrameTicked, so this is ~30s of live play;
// while paused, facts are sparse and the window is effectively unlimited.
const HISTORY_LIMIT = 1800;
// Marker frames are indexed in their own bounded ring: a chatty pool (a
// second clock, a busy game) evicts fact records in under a minute, and the
// step buttons' walk targets must survive that flood — undo reaches back
// further than the scrubber's visual window. Where every frame is a marker
// frame (Life playing), the rings shadow each other and nothing changes.
const MARKER_LIMIT = HISTORY_LIMIT;
// Tooltray block: interior styling only, sealed inside its shadow root.
// Colours are semantic tokens with literal fallbacks; the application's
// stage publishes the actual palette via StageTokensDeclared.
const timelineStyles = `
  * { box-sizing: border-box; }
  [data-timeline] {
    display: grid;
    gap: 0.25rem;
    align-content: center;
    height: 100%;
    padding: 0.3rem 0.6rem;
    border: 2px solid var(--surface-600, #3d3d3d);
    border-radius: 0;
    background: var(--surface-800, #242424);
    color: var(--text-bright, #d9d9d9);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.66rem;
    cursor: default;
  }
  [data-timeline] input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 0.9rem;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  [data-timeline] input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    background: var(--surface-600, #3d3d3d);
  }
  [data-timeline] input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 0.7rem;
    height: 1.1rem;
    margin-top: -0.42rem;
    border: none;
    border-radius: 0;
    background: var(--accent-emit, #ff2fd2);
  }
  [data-timeline] input[type="range"]::-moz-range-track {
    height: 4px;
    background: var(--surface-600, #3d3d3d);
  }
  [data-timeline] input[type="range"]::-moz-range-thumb {
    width: 0.7rem;
    height: 1.1rem;
    border: none;
    border-radius: 0;
    background: var(--accent-emit, #ff2fd2);
  }
  [data-timeline] input[type="range"]:disabled { cursor: default; opacity: 0.4; }
  [data-timeline] .timeline-info {
    display: flex;
    gap: 0.55rem;
    align-items: baseline;
    overflow: hidden;
    white-space: nowrap;
  }
  [data-timeline] .timeline-mode {
    color: var(--accent-emit, #ff2fd2);
    font-size: 0.56rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  [data-timeline] .timeline-mode.is-history { color: var(--accent-consume, #00e0ff); }
  [data-timeline] strong { font-variant-numeric: tabular-nums; }
  [data-timeline] .timeline-facts {
    overflow: hidden;
    opacity: 0.7;
    text-overflow: ellipsis;
  }
`;
/**
 * Infrastructure slice factory: the fact-history scrubber. Like the spec's
 * Logger it consumes every fact; releasing the scrubber names a frame via
 * TimelineScrubbed, and whatever the application does with that (pause, re-
 * publish recorded state) is the application's business. Time travel is new
 * facts flowing forward — the pool's log is never rewound.
 */
export function timelineFor(options) {
    const resetToLiveOn = new Set(options.resetToLiveOn ?? []);
    return {
        type: "timeline",
        description: "Records fact history; scrubbing names a frame to replay.",
        consumes: ["*"],
        emits: ["TimelineScrubbed", "ViewSlotRequested"],
        start(context) {
            // The host is the stage's geometry surface; the shadow root is this
            // slice's sealed interior.
            const host = document.createElement("div");
            host.style.display = "none";
            const shadow = host.attachShadow({ mode: "open" });
            const style = document.createElement("style");
            style.textContent = timelineStyles;
            const tokenStyle = document.createElement("style");
            const view = document.createElement("aside");
            view.dataset.timeline = "";
            view.innerHTML = `
      <div class="timeline-info">
        <span class="timeline-mode">Live</span>
        <span>Frame <strong data-frame>–</strong></span>
        <span class="timeline-facts" data-facts>Waiting for facts…</span>
      </div>
      <input type="range" min="0" max="0" value="0" step="1" disabled aria-label="Timeline scrubber" />
    `;
            shadow.append(style, tokenStyle, view);
            document.body.append(host);
            const mode = view.querySelector(".timeline-mode");
            const frameLabel = view.querySelector("[data-frame]");
            const factsLabel = view.querySelector("[data-facts]");
            const slider = view.querySelector("input");
            if (!mode || !frameLabel || !factsLabel || !slider) {
                throw new Error("Timeline could not initialize its view.");
            }
            const history = [];
            let followLive = true;
            // While in history mode the thumb anchors to a frame, not an index: the
            // ring grows and shifts underneath, and an index would drift backwards.
            let anchorFrame = null;
            // The step buttons' walk targets, indexed apart from the fact ring so
            // markerless traffic cannot evict them.
            const markerTypes = new Set([
                ...(options.stepBack?.markers ?? []),
                ...(options.stepForward?.markers ?? []),
            ]);
            const markerFrames = [];
            const recordMarker = (fact) => {
                if (!markerTypes.has(fact.type))
                    return;
                const last = markerFrames[markerFrames.length - 1];
                if (last && last.frame === fact.frame) {
                    if (!last.types.includes(fact.type))
                        last.types.push(fact.type);
                    return;
                }
                markerFrames.push({ frame: fact.frame, types: [fact.type] });
                if (markerFrames.length > MARKER_LIMIT)
                    markerFrames.shift();
            };
            const renderRecord = (index) => {
                const record = history[index];
                if (!record)
                    return;
                mode.textContent = followLive ? "Live" : "History";
                mode.classList.toggle("is-history", !followLive);
                frameLabel.textContent = String(record.frame);
                factsLabel.textContent = record.facts
                    .map((fact) => `${fact.sourceSlice} → ${fact.type}`)
                    .join("  |  ");
            };
            slider.addEventListener("input", () => {
                const index = Number(slider.value);
                followLive = index === history.length - 1;
                anchorFrame = followLive ? null : (history[index]?.frame ?? null);
                renderRecord(index);
            });
            // Emit only on release so a drag is one fact, not one per pixel.
            slider.addEventListener("change", () => {
                const record = history[Number(slider.value)];
                if (record)
                    context.emit("TimelineScrubbed", { frameNumber: record.frame });
            });
            // Wildcard form of the slot protocol: one dispatcher called from the
            // "*" subscription. This slice needs nothing extra when placed.
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
                const last = history[history.length - 1];
                if (last && last.frame === fact.frame) {
                    last.facts.push({ type: fact.type, sourceSlice: fact.sourceSlice });
                }
                else {
                    history.push({
                        frame: fact.frame,
                        facts: [{ type: fact.type, sourceSlice: fact.sourceSlice }],
                    });
                    if (history.length > HISTORY_LIMIT)
                        history.shift();
                }
                recordMarker(fact);
                if (resetToLiveOn.has(fact.type)) {
                    followLive = true;
                    anchorFrame = null;
                }
                // One step back: the state on show came from the newest marker frame
                // at or before the anchor; walk to the marker before that one and
                // name it. Restore bursts carry no marker, so they are stepped over.
                if (options.stepBack && fact.type === options.stepBack.on) {
                    const markers = new Set(options.stepBack.markers);
                    const upper = !followLive && anchorFrame !== null ? anchorFrame : Infinity;
                    let shown = null;
                    let target = null;
                    for (const record of markerFrames) {
                        if (record.frame > upper)
                            break;
                        if (!record.types.some((type) => markers.has(type)))
                            continue;
                        target = shown;
                        shown = record;
                    }
                    if (target) {
                        followLive = false;
                        anchorFrame = target.frame;
                        context.emit("TimelineScrubbed", { frameNumber: target.frame });
                    }
                }
                // One step forward: the next marker frame after the anchor. Restore
                // bursts carry no marker, so they are stepped over here too. Reaching
                // past the newest marker parks there; only new facts declare a new
                // "now" (via resetToLiveOn).
                if (options.stepForward &&
                    fact.type === options.stepForward.on &&
                    !followLive &&
                    anchorFrame !== null) {
                    const markers = new Set(options.stepForward.markers);
                    for (const record of markerFrames) {
                        if (record.frame <= anchorFrame)
                            continue;
                        if (!record.types.some((type) => markers.has(type)))
                            continue;
                        anchorFrame = record.frame;
                        context.emit("TimelineScrubbed", { frameNumber: record.frame });
                        break;
                    }
                }
                slider.disabled = false;
                slider.max = String(history.length - 1);
                if (followLive) {
                    slider.value = slider.max;
                    renderRecord(history.length - 1);
                }
                else {
                    // Hold the thumb on the scrubbed frame while the ring moves under it.
                    const index = history.findIndex((record) => record.frame === anchorFrame);
                    if (index !== -1) {
                        slider.value = String(index);
                        renderRecord(index);
                    }
                }
            });
            return () => host.remove();
        },
    };
}
/** The chartered form: no options — the stage publishes them as facts. */
export const timeline = chartered({
    type: "timeline",
    description: "Records fact history; scrubbing names a frame to replay.",
    consumes: ["*"],
    emits: ["TimelineScrubbed", "ViewSlotRequested"],
}, (config) => timelineFor(config));
