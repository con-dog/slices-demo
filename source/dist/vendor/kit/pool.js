export const WILDCARD_EVENT_TYPE = "*";
/**
 * The pool's identity when it announces its own lifecycle facts. Real slice
 * instance ids always contain "#", so this can never collide with one.
 */
export const POOL_SOURCE = "pool";
/**
 * Binds the generic definer to one application's event map, so each slice
 * stays strongly typed while the kernel itself knows no event vocabulary.
 * Currying is load-bearing: it pins Events once while consumes/emits stay
 * inferred from each slice's literal arrays.
 */
export function sliceDefinerFor() {
    return function defineSlice(definition) {
        return definition;
    };
}
/**
 * The pool is intentionally policy-free and application-agnostic: facts move
 * one frame at a time, lifecycle changes become active only at a frame
 * boundary, and the only structural rule it enforces is that slices stay
 * within their declared consumes/emits lists. Payload validation is not the
 * kernel's business — that is the firewall slice's job.
 */
export class Pool {
    slices = new Map();
    subscriptions = new Map();
    pendingLifecycle = [];
    instancesByType = new Map();
    currentFrame = [];
    nextFrame = [];
    frameNumber = 0;
    factSequence = 0;
    subscriptionSequence = 0;
    isDelivering = false;
    isActivatingSlice = null;
    currentCauses = [];
    onHandlerError;
    constructor(options = {}) {
        this.onHandlerError =
            options.onHandlerError ??
                ((error, fact, sliceId) => {
                    console.error(`Slice ${sliceId} failed while handling ${fact.type}.`, error);
                });
    }
    getFrameNumber() {
        return this.frameNumber;
    }
    getCurrentFrame() {
        return this.currentFrame;
    }
    /**
     * Mounting is staged. A requested slice starts at the next frame boundary
     * and can receive the facts delivered in that frame — including its own
     * SliceMounted fact, which the pool enqueues here at staging time.
     */
    mount(definition, options = {}) {
        const instanceId = options.instanceId ?? this.allocateInstanceId(definition.type);
        if (this.slices.has(instanceId)) {
            throw new Error(`Slice instance ${instanceId} already exists.`);
        }
        const mounted = {
            id: instanceId,
            definition,
            active: false,
            mountCauses: options.causedBy ?? this.currentCauses,
        };
        this.slices.set(instanceId, mounted);
        const causes = options.causedBy ?? this.currentCauses;
        // The mount table is the pool's own state, and the pool owes late joiners
        // what every state owner owes them (rule 9): a newcomer that listens for
        // mounts hears the living instances again — those already active, since
        // anything staged this frame is in the queue it is about to read. Nothing
        // is re-published at boot (nothing is active yet), so this costs only
        // the late mounts that ask for it: a hot-reloaded foundry, stage, buffer,
        // or visualizer rebuilds its picture of the pool from these facts.
        const watchesMounts = definition.consumes.includes("SliceMounted") ||
            definition.consumes.includes(WILDCARD_EVENT_TYPE);
        if (watchesMounts) {
            for (const other of this.slices.values()) {
                if (!other.active)
                    continue;
                this.enqueueSystemFact("SliceMounted", this.mountedPayload(other), causes);
            }
        }
        this.enqueueSystemFact("SliceMounted", this.mountedPayload(mounted), causes);
        this.stageLifecycleChange(() => this.activateSlice(mounted));
        return instanceId;
    }
    mountedPayload(slice) {
        return {
            sliceId: slice.id,
            sliceType: slice.definition.type,
            description: slice.definition.description,
            consumes: slice.definition.consumes,
            emits: slice.definition.emits,
            startSource: slice.definition.start.toString(),
            ...(slice.definition.lock === undefined ? {} : { lock: slice.definition.lock }),
        };
    }
    /**
     * Unmounting is staged too: the slice completes the current frame and is
     * absent from the next one. Facts it already emitted remain historical.
     * Deactivation removes subscriptions before delivery, so a slice never
     * observes its own SliceUnmounted fact.
     */
    unmount(instanceId) {
        if (!this.slices.has(instanceId))
            return;
        this.enqueueSystemFact("SliceUnmounted", { sliceId: instanceId }, this.currentCauses);
        this.stageLifecycleChange(() => this.deactivateSlice(instanceId));
    }
    /**
     * The pool's own metabolism. Frame advancement is kernel behaviour, not a
     * granted privilege: the loop advances at host cadence (animation frames
     * in a browser, a short timer elsewhere) and drains each beat — advancing
     * until a frame comes up empty, bounded so a pathological slice that
     * answers every fact with another cannot wedge the beat. Time as FACTS
     * (ticks, cadences, pauses) remains the business of ordinary clock
     * slices; they emit, and the metabolism delivers. Returns a stop.
     */
    run() {
        const DRAIN_LIMIT = 256;
        const beat = () => {
            for (let spins = 0; spins < DRAIN_LIMIT; spins += 1) {
                if (this.advanceFrame() === 0)
                    break;
            }
        };
        if (typeof window !== "undefined" && "requestAnimationFrame" in window) {
            let handle = 0;
            const loop = () => {
                beat();
                handle = window.requestAnimationFrame(loop);
            };
            handle = window.requestAnimationFrame(loop);
            return () => window.cancelAnimationFrame(handle);
        }
        const timer = setInterval(beat, 16);
        return () => clearInterval(timer);
    }
    /**
     * The frame barrier. It first seals and promotes queued facts, then activates
     * staged lifecycle changes, then delivers a stable subscription snapshot.
     * Facts emitted by startup code therefore wait for the following frame too.
     * Returns how many facts the frame delivered — zero means the pool was
     * quiet, which is how the draining metabolism knows a cascade has settled.
     */
    advanceFrame() {
        if (this.isDelivering) {
            throw new Error("A slice cannot advance the pool while a frame is being delivered.");
        }
        this.frameNumber += 1;
        this.currentFrame = this.nextFrame;
        this.nextFrame = [];
        this.applyLifecycleChangesFor(this.frameNumber);
        this.isDelivering = true;
        try {
            for (const fact of this.currentFrame) {
                for (const subscription of this.matchingSubscriptions(fact.type)) {
                    const slice = this.slices.get(subscription.sliceId);
                    if (!slice?.active)
                        continue;
                    this.currentCauses = [fact.id];
                    try {
                        subscription.handler(fact);
                    }
                    catch (error) {
                        this.onHandlerError(error, fact, subscription.sliceId);
                    }
                    finally {
                        this.currentCauses = [];
                    }
                }
            }
        }
        finally {
            this.currentCauses = [];
            this.isDelivering = false;
        }
        return this.currentFrame.length;
    }
    createContext(slice) {
        const thisPool = this;
        return {
            instanceId: slice.id,
            sliceType: slice.definition.type,
            get frameNumber() {
                return thisPool.frameNumber;
            },
            subscribe: (type, handler) => this.subscribeFrom(slice, type, handler),
            emit: (type, payload, options) => this.emitFrom(slice, type, payload, options),
            mountSlice: (definition, options) => this.mount(definition, options),
            unmountSlice: (instanceId) => this.unmount(instanceId),
        };
    }
    activateSlice(slice) {
        if (slice.active)
            return;
        slice.active = true;
        this.isActivatingSlice = slice.id;
        this.currentCauses = slice.mountCauses;
        try {
            slice.cleanup = slice.definition.start(this.createContext(slice)) ?? undefined;
        }
        finally {
            this.currentCauses = [];
            this.isActivatingSlice = null;
        }
    }
    deactivateSlice(instanceId) {
        const slice = this.slices.get(instanceId);
        if (!slice)
            return;
        slice.active = false;
        slice.cleanup?.();
        this.removeSubscriptionsFor(instanceId);
        this.slices.delete(instanceId);
    }
    subscribeFrom(slice, eventType, handler) {
        if (!slice.definition.consumes.includes(eventType)) {
            throw new Error(`${slice.id} did not declare ${eventType} in consumes.`);
        }
        const subscription = {
            id: ++this.subscriptionSequence,
            sliceId: slice.id,
            eventType,
            handler,
        };
        const attach = () => {
            if (this.slices.get(slice.id)?.active)
                this.subscriptions.set(subscription.id, subscription);
        };
        if (this.isActivatingSlice === slice.id) {
            attach();
        }
        else {
            this.stageLifecycleChange(attach);
        }
        return () => this.stageLifecycleChange(() => this.subscriptions.delete(subscription.id));
    }
    emitFrom(slice, type, payload, options = {}) {
        if (!slice.active) {
            throw new Error(`Inactive slice ${slice.id} cannot emit ${type}.`);
        }
        if (!slice.definition.emits.includes(type)) {
            throw new Error(`${slice.id} did not declare ${type} in emits.`);
        }
        return this.enqueueFact(type, payload, slice.id, options.causedBy ?? this.currentCauses);
    }
    enqueueSystemFact(type, payload, causedBy) {
        return this.enqueueFact(type, payload, POOL_SOURCE, causedBy);
    }
    enqueueFact(type, payload, sourceSlice, causedBy) {
        const fact = {
            id: `${this.frameNumber + 1}:${++this.factSequence}`,
            type,
            frame: this.frameNumber + 1,
            sourceSlice,
            causedBy: [...causedBy],
            payload,
        };
        this.nextFrame.push(fact);
        return fact.id;
    }
    stageLifecycleChange(apply) {
        this.pendingLifecycle.push({ frame: this.frameNumber + 1, apply });
    }
    applyLifecycleChangesFor(frame) {
        const remaining = [];
        for (const change of this.pendingLifecycle) {
            if (change.frame <= frame)
                change.apply();
            else
                remaining.push(change);
        }
        this.pendingLifecycle.splice(0, this.pendingLifecycle.length, ...remaining);
    }
    matchingSubscriptions(eventType) {
        return [...this.subscriptions.values()]
            .filter((subscription) => subscription.eventType === eventType || subscription.eventType === WILDCARD_EVENT_TYPE)
            .sort((left, right) => left.sliceId.localeCompare(right.sliceId) || left.id - right.id);
    }
    removeSubscriptionsFor(sliceId) {
        for (const [id, subscription] of this.subscriptions) {
            if (subscription.sliceId === sliceId)
                this.subscriptions.delete(id);
        }
    }
    allocateInstanceId(sliceType) {
        let next = (this.instancesByType.get(sliceType) ?? 0) + 1;
        // Composition roots name instances explicitly (stage#1), so the counter
        // alone cannot promise a free id: skip any name still living. A staged
        // unmount leaves the map only at the next frame barrier, so a mount
        // replacing an instance in the same frame lands beside it, never on it.
        while (this.slices.has(`${sliceType}#${next}`))
            next += 1;
        this.instancesByType.set(sliceType, next);
        return `${sliceType}#${next}`;
    }
}
