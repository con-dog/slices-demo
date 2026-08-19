import type { SliceDefinition } from "./pool.js";
export type CausalityInspectorOptions = {
    /** The stage slot to request (e.g. "overlay-right"). */
    slot: string;
};
/**
 * Infrastructure slice factory: the causal-tree inspector. It indexes every
 * delivered fact by id, and when one is selected (FactSelected) it walks
 * causedBy upwards and its reverse index downwards, listing causes above and
 * effects below. The walked tree is also published as CausalPathTraced, so
 * anything else showing facts can light the same path without knowing this
 * slice exists.
 */
export declare function causalityInspectorFor(options: CausalityInspectorOptions): SliceDefinition;
/** The chartered form: no options — the stage publishes them as facts. */
export declare const causalityInspector: SliceDefinition;
