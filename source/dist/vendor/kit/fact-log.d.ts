import type { SliceDefinition } from "./pool.js";
/**
 * Where the journal lives between sessions. The default is localStorage;
 * tests (and headless hosts) inject a memory-backed one instead.
 */
export type FactLogStorage = {
    load(): string | null;
    save(text: string): void;
    clear(): void;
};
export type FactLogOptions = {
    /**
     * The application's input-boundary vocabulary: the fact types born from
     * outside the pool (keystrokes, clicks) that drive all state. Everything
     * else is derived and regenerates during replay, so it is never stored.
     */
    record: readonly string[];
    /**
     * Fact types that prove a recorded input has been applied — the state
     * owners' publications (an editor's BufferChanged/CaretMoved, a foundry's
     * SliceSaved). Markers pace the replay: the next journal group is emitted
     * only once a marker causally descended from the current one arrives, so
     * replay keeps the live session's ordering without keeping its clock.
     * Replay begins the moment a slice that emits a marker type is on the
     * board (its SliceMounted) — the state owner is the seed state, whether
     * or not it publishes anything at boot — or at the first marker itself,
     * whichever lands first.
     */
    markers: readonly string[];
    /** Storage key for the default localStorage backend. */
    storageKey: string;
    /** Journal schema/seed version: a mismatch discards the stored journal. */
    version: string;
    /**
     * A fact type (payload `{ entries: number }`) announced once boot replay
     * has finished and live recording begins. Part of the app's vocabulary.
     */
    announceAs?: string;
    /** Storage override for tests and headless hosts. */
    storage?: FactLogStorage;
    /** Discard the stored journal at start (an app's `?fresh` escape hatch). */
    discard?: boolean;
    /** "immediate" saves synchronously on every append (tests); default debounces. */
    saveMode?: "debounced" | "immediate";
};
/**
 * Infrastructure slice factory: the replayable fact log. The pool's history
 * IS the application, so persistence is not per-slice save code — this slice
 * journals the session's input facts and replays them through the pool on
 * the next boot. Every deterministic state owner (buffers, foundries,
 * timelines, snapshot rings) rebuilds itself by hearing the same inputs
 * again; the whole workspace — including undo history and dynamically
 * mounted slices — survives reload without any slice knowing it happened.
 *
 * Time travel is journaled causally, not temporally: a TimelineScrubbed is
 * translated to "the state after journal entry N" via the causal chain from
 * recorded inputs to their markers, and translated back to a concrete frame
 * during replay. Abandoned undo branches replay exactly as they happened —
 * the journal is append-only, like the pool it mirrors.
 */
export declare function factLogFor(options: FactLogOptions): SliceDefinition;
