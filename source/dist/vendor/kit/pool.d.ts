export type FactId = string;
export type SliceInstanceId = string;
export declare const WILDCARD_EVENT_TYPE: "*";
/**
 * The pool's identity when it announces its own lifecycle facts. Real slice
 * instance ids always contain "#", so this can never collide with one.
 */
export declare const POOL_SOURCE: SliceInstanceId;
/** An application's event vocabulary: event type name → payload shape. */
export type EventMap = Record<string, unknown>;
/**
 * Lifecycle facts the pool itself enqueues. An application merges these into
 * its own event map (type-only) so slices can consume them like any fact.
 */
export type SystemEventPayloads = {
    SliceMounted: {
        sliceId: SliceInstanceId;
        sliceType: string;
        description?: string;
        consumes: readonly string[];
        emits: readonly string[];
        /**
         * The running start function's own source (Function.prototype.toString).
         * The mount fact carries the whole definition — contract AND code — so
         * the pool's history is self-describing and an editor can open any
         * mounted slice's real body without a file system. Drift-proof by
         * construction: this IS the code that runs, never a shipped copy of it.
         */
        startSource: string;
        /**
         * The slice's own rank, when it declares one: the minimum priority an
         * intent needs to edit, rename into, copy or delete this slice's
         * document, wherever documents exist. Part of the definition, so it
         * rides the mount fact like the contract does — a slice's opinion of
         * itself, on the board, never a list somebody else keeps.
         */
        lock?: number;
    };
    SliceUnmounted: {
        sliceId: SliceInstanceId;
    };
};
export type Fact<Events extends EventMap = EventMap, Type extends keyof Events & string = keyof Events & string> = Type extends keyof Events & string ? Readonly<{
    id: FactId;
    type: Type;
    /** The frame in which this fact is delivered. */
    frame: number;
    sourceSlice: SliceInstanceId;
    /** A fact can have several direct causes, so causality is a graph. */
    causedBy: readonly FactId[];
    payload: Readonly<Events[Type]>;
}> : never;
export type Unsubscribe = () => void;
export type SliceCleanup = () => void;
export type EmitOptions = {
    /** Overrides the currently delivered fact as this emission's direct cause. */
    causedBy?: readonly FactId[];
};
export interface SliceContext<Events extends EventMap = EventMap, Consumes extends (keyof Events & string) | typeof WILDCARD_EVENT_TYPE = (keyof Events & string) | typeof WILDCARD_EVENT_TYPE, Emits extends keyof Events & string = keyof Events & string> {
    readonly instanceId: SliceInstanceId;
    readonly sliceType: string;
    readonly frameNumber: number;
    subscribe<Type extends Consumes>(type: Type, handler: (fact: Type extends typeof WILDCARD_EVENT_TYPE ? Fact<Events> : Fact<Events, Extract<Type, keyof Events & string>>) => void): Unsubscribe;
    emit<Type extends Emits>(type: Type, payload: Events[Type], options?: EmitOptions): FactId;
    /**
     * Dynamic composition, ordinary context API: there are no capabilities
     * and no special slices — any slice may mount or unmount. Authority is
     * transparency, not privilege: every mount lands on the board as a
     * SliceMounted fact carrying the definition (contract AND code) and the
     * current causes, so a forged slice's lineage traces back to the intent
     * that forged it and misuse is visible in the history, not prevented in
     * secret.
     */
    mountSlice(definition: SliceDefinition, options?: MountOptions): SliceInstanceId;
    unmountSlice(instanceId: SliceInstanceId): void;
}
export type SliceDefinition = Readonly<{
    type: string;
    description?: string;
    consumes: readonly string[];
    emits: readonly string[];
    /** The slice's own rank (see SystemEventPayloads.SliceMounted.lock). */
    lock?: number;
    start: (context: SliceContext) => void | SliceCleanup;
}>;
/**
 * Binds the generic definer to one application's event map, so each slice
 * stays strongly typed while the kernel itself knows no event vocabulary.
 * Currying is load-bearing: it pins Events once while consumes/emits stay
 * inferred from each slice's literal arrays.
 */
export declare function sliceDefinerFor<Events extends EventMap>(): <Consumes extends readonly ((keyof Events & string) | typeof WILDCARD_EVENT_TYPE)[], Emits extends readonly (keyof Events & string)[]>(definition: {
    type: string;
    description?: string;
    consumes: Consumes;
    emits: Emits;
    lock?: number;
    start: (context: SliceContext<Events, Consumes[number], Emits[number]>) => void | SliceCleanup;
}) => SliceDefinition;
export type MountOptions = {
    instanceId?: SliceInstanceId;
    causedBy?: readonly FactId[];
};
export type PoolOptions = {
    onHandlerError?: (error: unknown, fact: Fact, sliceId: SliceInstanceId) => void;
};
/**
 * The pool is intentionally policy-free and application-agnostic: facts move
 * one frame at a time, lifecycle changes become active only at a frame
 * boundary, and the only structural rule it enforces is that slices stay
 * within their declared consumes/emits lists. Payload validation is not the
 * kernel's business — that is the firewall slice's job.
 */
export declare class Pool {
    private readonly slices;
    private readonly subscriptions;
    private readonly pendingLifecycle;
    private readonly instancesByType;
    private currentFrame;
    private nextFrame;
    private frameNumber;
    private factSequence;
    private subscriptionSequence;
    private isDelivering;
    private isActivatingSlice;
    private currentCauses;
    private readonly onHandlerError;
    constructor(options?: PoolOptions);
    getFrameNumber(): number;
    getCurrentFrame(): readonly Fact[];
    /**
     * Mounting is staged. A requested slice starts at the next frame boundary
     * and can receive the facts delivered in that frame — including its own
     * SliceMounted fact, which the pool enqueues here at staging time.
     */
    mount(definition: SliceDefinition, options?: MountOptions): SliceInstanceId;
    private mountedPayload;
    /**
     * Unmounting is staged too: the slice completes the current frame and is
     * absent from the next one. Facts it already emitted remain historical.
     * Deactivation removes subscriptions before delivery, so a slice never
     * observes its own SliceUnmounted fact.
     */
    unmount(instanceId: SliceInstanceId): void;
    /**
     * The pool's own metabolism. Frame advancement is kernel behaviour, not a
     * granted privilege: the loop advances at host cadence (animation frames
     * in a browser, a short timer elsewhere) and drains each beat — advancing
     * until a frame comes up empty, bounded so a pathological slice that
     * answers every fact with another cannot wedge the beat. Time as FACTS
     * (ticks, cadences, pauses) remains the business of ordinary clock
     * slices; they emit, and the metabolism delivers. Returns a stop.
     */
    run(): () => void;
    /**
     * The frame barrier. It first seals and promotes queued facts, then activates
     * staged lifecycle changes, then delivers a stable subscription snapshot.
     * Facts emitted by startup code therefore wait for the following frame too.
     * Returns how many facts the frame delivered — zero means the pool was
     * quiet, which is how the draining metabolism knows a cascade has settled.
     */
    advanceFrame(): number;
    private createContext;
    private activateSlice;
    private deactivateSlice;
    private subscribeFrom;
    private emitFrom;
    private enqueueSystemFact;
    private enqueueFact;
    private stageLifecycleChange;
    private applyLifecycleChangesFor;
    private matchingSubscriptions;
    private removeSubscriptionsFor;
    private allocateInstanceId;
}
