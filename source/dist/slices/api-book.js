import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The context API reference as a document. A body receives exactly one
// object — `context` — and everything it can do hangs off it, so its
// reference belongs on the board the way the schema-book owns the shapes,
// the rule-book the compliance rules, and the guide-book the driving
// semantics: as DATA in this slice's own body, published ApiDeclared
// (rule 9). The completion oracle serves the entries at the caret; the
// prose duplicates what pool.ts says (rule 6 — duplication allowed, drift
// the maintainer's job). The body is self-contained, so the reference is
// adoptable — edit the API docs from inside the editor they complete in.
export const apiBook = defineSlice({
    type: "api-book",
    description: "Owns the context API reference: signatures and docstrings as data.",
    consumes: ["SliceMounted"],
    emits: ["ApiDeclared"],
    start(context) {
        const ENTRIES = [
            {
                name: "emit",
                signature: "context.emit(type, payload, options?): FactId",
                doc: [
                    "Publishes one fact. The type must be in this slice's emits list",
                    "and the payload must satisfy the schema-book's declared shape, or",
                    "the firewall answers with a ContractViolated verdict — delivered,",
                    "never thrown. Emissions land on the next heartbeat, causally",
                    "chained to the fact being handled; options.causedBy overrides the",
                    "cause. Returns the new fact's id.",
                ].join(" "),
            },
            {
                name: "subscribe",
                signature: "context.subscribe(type, handler): Unsubscribe",
                doc: [
                    "Registers a handler for every delivered fact of a consumed type.",
                    "The handler receives the whole fact — { id, type, frame,",
                    "sourceSlice, causedBy, payload } — and the call returns an",
                    'unsubscribe function. A slice consuming "*" hears everything.',
                ].join(" "),
            },
            {
                name: "frameNumber",
                signature: "context.frameNumber: number",
                doc: [
                    "The pool's current delivery frame, read live. Snapshot rings key",
                    "their records by it, and rule-9 frame guards compare against it",
                    "so a burst of mounts collapses into one declaration.",
                ].join(" "),
            },
            {
                name: "instanceId",
                signature: "context.instanceId: SliceInstanceId",
                doc: [
                    "This instance's pool-allocated id (type#N). Slot grants and",
                    "visibility facts name instances by it — compare before applying",
                    "what a fact assigns to you.",
                ].join(" "),
            },
            {
                name: "sliceType",
                signature: "context.sliceType: string",
                doc: [
                    "This slice's declared type name — also its document id, under",
                    "the id-IS-type law.",
                ].join(" "),
            },
            {
                name: "mountSlice",
                signature: "context.mountSlice(definition, options?): SliceInstanceId",
                doc: [
                    "Dynamic composition as ordinary API: mounts a definition into",
                    "the running pool. There are no capabilities — every mount lands",
                    "on the board as a SliceMounted fact carrying contract, code, and",
                    "cause, so authority is transparency, not privilege. The foundry",
                    "uses this for every autosave.",
                ].join(" "),
            },
            {
                name: "unmountSlice",
                signature: "context.unmountSlice(instanceId): void",
                doc: [
                    "Retires an instance: it completes the current frame, its cleanup",
                    "runs, and the pool publishes SliceUnmounted. The stage frees any",
                    "slot it held for the next asker.",
                ].join(" "),
            },
        ];
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("ApiDeclared", { entries: ENTRIES });
        };
        declare();
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("ApiDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
