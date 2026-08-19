import type { SliceDefinition } from "./pool.js";
export type TimelineOptions = {
    /** The stage slot to request (e.g. "tray-1"). */
    slot: string;
    /**
     * Fact types that declare a new "now": on any of these the scrubber snaps
     * back to following live history instead of staying parked in the past
     * (e.g. an app's PlayPressed / StepPressed).
     */
    resetToLiveOn?: readonly string[];
    /**
     * The button form of grabbing the scrubber, for apps whose state owners
     * replay on TimelineScrubbed. `on` is the fact type that triggers one step
     * backwards (e.g. an app's StepBackPressed); `markers` are the fact types
     * that mark state-bearing frames (e.g. FrameTicked). Each step parks the
     * anchor on the marker frame before the one the shown state came from and
     * names it in a TimelineScrubbed fact.
     */
    stepBack?: {
        on: string;
        markers: readonly string[];
    };
    /**
     * The mirror of stepBack, for apps whose "step" means redo rather than a
     * fresh tick of simulated time (an editor, not a game). Each step parks the
     * anchor on the next marker frame after the current one and names it in a
     * TimelineScrubbed fact. Following live means there is no future to step
     * into, so it does nothing there — history only grows behind "now".
     */
    stepForward?: {
        on: string;
        markers: readonly string[];
    };
};
/**
 * Infrastructure slice factory: the fact-history scrubber. Like the spec's
 * Logger it consumes every fact; releasing the scrubber names a frame via
 * TimelineScrubbed, and whatever the application does with that (pause, re-
 * publish recorded state) is the application's business. Time travel is new
 * facts flowing forward — the pool's log is never rewound.
 */
export declare function timelineFor(options: TimelineOptions): SliceDefinition;
/** The chartered form: no options — the stage publishes them as facts. */
export declare const timeline: SliceDefinition;
