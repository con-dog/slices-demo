import { type EventMap, type Fact, type Pool } from "./pool.js";
export type FrameRecord<Events extends EventMap> = {
    frame: number;
    facts: Fact<Events>[];
};
type Where<Events extends EventMap, Type extends keyof Events & string> = (fact: Fact<Events, Type>) => boolean;
export interface FrameTimeline<Events extends EventMap> {
    /** Every delivered fact, grouped by the frame it was delivered in. */
    readonly frames: readonly FrameRecord<Events>[];
    advance(count?: number): void;
    /**
     * Advance the pool until a fact of the given type (and matching `where`,
     * if given) is delivered, and return it typed. Throws with the full
     * recorded timeline if maxFrames pass without one — the timeline in the
     * error is the point: no hand-counted advanceFrame() calls with per-frame
     * comments.
     */
    advanceUntil<Type extends keyof Events & string>(type: Type, options?: {
        where?: Where<Events, Type>;
        maxFrames?: number;
    }): Fact<Events, Type>;
    /** All recorded facts of a type (and matching `where`), across all frames. */
    delivered<Type extends keyof Events & string>(type: Type, where?: Where<Events, Type>): Fact<Events, Type>[];
    /** Assert nothing of the type was ever delivered; throws with the timeline. */
    expectNone(type: keyof Events & string, message?: string): void;
    /** The recorded timeline, one line per frame — also used in errors. */
    describe(): string;
}
/**
 * Frame bookkeeping for tests. Mounts a wildcard recorder slice into the
 * pool (call this before the first advanceFrame so nothing is missed) and
 * drives the pool by expectation instead of by counted frames.
 */
export declare function trackFrames<Events extends EventMap>(pool: Pool): FrameTimeline<Events>;
export {};
