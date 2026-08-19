import type { SliceDefinition } from "./pool.js";
export type VisualizerOptions = {
    /** The stage slot to request (e.g. "stage-right"). */
    slot: string;
    /**
     * High-frequency fact types (a 60Hz tick stream, a per-tick entity field).
     * They render as thin ticks on their lane instead of chips, and while
     * playing they pulse only every Nth occurrence; while paused every fact
     * animates. Defaults to ["FrameTicked"].
     */
    throttledTypes?: readonly string[];
    /**
     * Makes the slice cards clickable: a click publishes SliceSelected with
     * the card's slice id, and the card wearing the current selection is
     * marked. What selection MEANS (an IDE opens the slice's document) is the
     * consuming application's business — this slice only announces the click.
     */
    selectSlices?: boolean;
    /**
     * Makes this slice the owner of pool visibility: a SliceHideRequested
     * intent (a toolbar's SHOW|HIDE button) is answered with
     * SliceVisibilityChanged, and the flag applies when that fact comes back
     * through the pool. A hidden slice keeps its card — dotted border — but
     * its emissions get no lane and no chips in the water.
     */
    hideSlices?: boolean;
};
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
export declare function visualizerFor(options: VisualizerOptions): SliceDefinition;
/** The chartered form: no options — the stage publishes them as facts. */
export declare const visualizer: SliceDefinition;
