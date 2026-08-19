import { isRecord, isStringArray } from "./contracts.js";
import { POOL_SOURCE, } from "./pool.js";
import { matchesShape, SCHEMAS_DECLARED, } from "./schema.js";
/**
 * The shared name for runtime vocabulary sketching, kit vocabulary like
 * ViewSlotRequested: a loader declares `{ types: string[] }` under it and
 * the firewall passes those types shape-free until they earn a schema.
 */
export const CONTRACT_SKETCHED = "ContractSketched";
/**
 * The pure firewall: a plain slice with no constructor and no injected
 * knowledge. The law arrives on the board — some slice (an app's
 * schema-book) publishes SchemasDeclared, and this slice compiles it and
 * judges every fact against it. Until the law lands, payload checks stand
 * down (validation is detection, never a gate); structural checks (declared
 * emits, known sources) need no law and run from the first frame. Because
 * the pool is frame-batched, validation is detection, not prevention: an
 * invalid fact is delivered in frame N and flagged in N+1.
 */
export const firewall = {
    type: "firewall",
    description: "Compiles the declared law from facts and flags violations.",
    consumes: ["*"],
    emits: ["ContractViolated"],
    // The law's enforcer ranks its own document at the human's hand: wherever
    // documents exist, an intent below 10 does not edit, rename into, copy or
    // delete it. Its own opinion, on the board in its mount fact.
    lock: 10,
    start(context) {
        // kit: compiled kit slice — this body references the kit's own imports
        // and cannot start as written; an edit here is a verdict until the body
        // is rewritten self-contained (the agent-port's outline marks it `kit`).
        // Declared emits per slice, learned from SliceMounted facts. Entries are
        // never deleted on SliceUnmounted: a dying slice's last facts can share a
        // frame with its unmount fact, and eager deletion would flag them falsely.
        const declaredEmits = new Map();
        const sketched = new Set();
        let shapes = null;
        let versions = {};
        context.subscribe("*", (fact) => {
            // Guard on source, not fact type: even a malformed ContractViolated
            // fact of our own must never trigger a self-sustaining report loop.
            if (fact.sourceSlice === context.instanceId)
                return;
            const report = (reason, expectedVersion) => {
                context.emit("ContractViolated", {
                    factId: fact.id,
                    factType: fact.type,
                    sourceSlice: fact.sourceSlice,
                    reason,
                    ...(expectedVersion === undefined ? {} : { expectedVersion }),
                });
            };
            if (fact.type === "SliceMounted") {
                const payload = fact.payload;
                declaredEmits.set(payload.sliceId, new Set(payload.emits));
            }
            // Learn the law before judging the fact that carries it.
            if (fact.type === SCHEMAS_DECLARED && isRecord(fact.payload)) {
                const payload = fact.payload;
                if (isRecord(payload.shapes)) {
                    shapes = payload.shapes;
                    versions = isRecord(payload.versions)
                        ? payload.versions
                        : {};
                }
            }
            if (fact.type === CONTRACT_SKETCHED) {
                if (isRecord(fact.payload) && isStringArray(fact.payload.types)) {
                    for (const type of fact.payload.types)
                        sketched.add(type);
                }
            }
            if (fact.sourceSlice !== POOL_SOURCE) {
                const emits = declaredEmits.get(fact.sourceSlice);
                if (!emits)
                    report("unknown-source");
                else if (!emits.has(fact.type))
                    report("undeclared-emit");
            }
            if (shapes === null)
                return;
            const shape = shapes[fact.type];
            if (shape === undefined) {
                if (!sketched.has(fact.type))
                    report("unknown-type");
                return;
            }
            if (!matchesShape(shape, fact.payload)) {
                report("invalid-payload", versions[fact.type]);
            }
        });
    },
};
