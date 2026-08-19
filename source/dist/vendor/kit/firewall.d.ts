import { type SliceDefinition } from "./pool.js";
export type ViolationReason = "undeclared-emit" | "invalid-payload" | "unknown-source" | "unknown-type";
/**
 * The payload shape an application's ContractViolated event must carry —
 * the firewall emits it whenever a fact breaks the declared law.
 */
export type ContractViolatedPayload = {
    factId: string;
    factType: string;
    sourceSlice: string;
    reason: ViolationReason;
    expectedVersion?: number;
};
/**
 * The shared name for runtime vocabulary sketching, kit vocabulary like
 * ViewSlotRequested: a loader declares `{ types: string[] }` under it and
 * the firewall passes those types shape-free until they earn a schema.
 */
export declare const CONTRACT_SKETCHED: "ContractSketched";
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
export declare const firewall: SliceDefinition;
