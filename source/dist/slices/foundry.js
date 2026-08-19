import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The self-hosting step: this slice compiles documents into living slices,
// continuously. It holds the pool's dynamic-composition capability (granted
// at mount, the way frame advancement goes to the clock) and autosaves: every
// edit the buffer publishes is assembled — the contract half as data, the
// code body as the inside of start(context) — into a defineSlice call,
// evaluated with a capturing definer, and mounted into THIS pool. There is no
// save button: the saved slice's card lives beside the editor's own, its
// facts land in the same water, and each edit hot-reloads the instance as
// SliceMounted | SliceUnmounted facts — scrubbable history.
//
// Nothing is exempt. There is no kernel list: every mounted slice's document
// takes edits — the stage, the buffer, the fact-log, the firewall, the kit
// views, this foundry itself. What makes that survivable is HOW a
// replacement happens. The successor mounts first, and the predecessor is
// retired only when the successor's SliceMounted lands, one frame later —
// so for one frame both live, and in that frame the predecessor does what
// every state owner already does for a late joiner (rule 9): it re-publishes
// its state, and the successor, hearing a foreign copy of its own state
// facts, seeds itself from them. The pool plays the same game with its
// mount table (living SliceMounted facts go to a newcomer that listens), and
// this foundry re-publishes SliceSaved — its lineage — the same way, so a
// foundry can adopt itself and still know what it owns. A successor that
// dies at start (an undefined name, a body that was never self-contained —
// the kit views ship as chartered wrappers) is unmounted again and the
// predecessor kept: a red mark on the card, never a hole in the program.
// Bricking is still possible — a buffer that hands off nothing, a clock
// that never ticks — and RESET is the way out; that is the deal.
//
// A document that will not compile still saves: the last good instance keeps
// running (or, for a document that never compiled, a contract-only stub
// mounts so the card exists), and the failure travels as SliceErrorChanged —
// the visualizer greys the card and hangs a red mark on it. The same fact
// carries the other verdicts this slice aggregates: lint findings from the
// compliance oracle, and ContractViolated flags whose source is a saved
// instance. Errors never block the save; they are
// signage. The body is self-contained: this foundry is adoptable.
export const foundry = defineSlice({
    type: "foundry",
    description: "Autosaves the document as a live slice; errors grey its card.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "EditRequested",
        "CaretMoved",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
        "BufferChanged",
        "BufferRestored",
        "DiagnosticsPublished",
        "ContractViolated",
        "SchemasDeclared",
        "SliceMounted",
        "SliceUnmounted",
        "SliceSaved",
        "SliceLocksDeclared",
        "SliceSelected",
    ],
    emits: ["SliceSaved", "ContractSketched", "SliceErrorChanged"],
    start(context) {
        const DESCRIPTION_LIMIT = 80;
        // Saved lineage: fileId (= slice type) -> the live instance to replace
        // on the next save, plus the exact source it was built from (dedupe: a
        // rule-9 re-publication or a navigation open must not re-mount).
        const saved = new Map();
        const lastSource = new Map();
        // The error ledger, per fileId: any entry greys the card. Compile and
        // violation verdicts clear on the next successful save; the lint verdict
        // follows the compliance oracle's findings for the open document.
        const errors = new Map();
        // What was last announced per instance, so the flag only travels on change.
        const announced = new Map();
        // Event types already sketched into the open vocabulary, and the types
        // the firewall's law covers — learned from SchemasDeclared facts, never
        // imported (the contracts are type-only for slices).
        const sketched = new Set();
        let contracted = new Set();
        context.subscribe("SchemasDeclared", (fact) => {
            contracted = new Set(fact.payload.types);
        });
        // Live instances per type from the pool's own lifecycle facts, by id: a
        // navigation open of a compiled slice's stub must not save a shadow
        // copy, and adoption must know which boot instance to retire.
        const mountedTypes = new Map();
        // Which document the editor is showing (for attributing diagnostics).
        let activeFileId = "";
        // An edit intent is in flight: the next BufferChanged is an edit (or a
        // rename), not a navigation open. CaretMoved answers caret-only ticks,
        // so it clears the flag the same way BufferChanged does.
        let pendingEdit = false;
        let pendingCreate = false;
        // The locks, as the lock-book declared them (rule 6: the buffer keeps
        // the same map). Each owner does its own part of a delete or a copy, so
        // each consults the same bar: an intent below a type's lock is the
        // buffer's to refuse aloud (IntentRefused) and this foundry's to leave
        // alone — no unmount, no create pending for a copy that never comes,
        // and no edit pending for a keystroke the buffer will bounce (else the
        // open that a machine's `edit { fileId }` sends ahead of its refused
        // edit would read as an edit and adopt the compiled slice for nothing).
        const locks = new Map();
        context.subscribe("SliceLocksDeclared", (fact) => {
            locks.clear();
            for (const [type, level] of Object.entries(fact.payload.locks))
                locks.set(type, level);
        });
        const outranked = (sliceId, priority) => (priority ?? 0) < (locks.get(sliceId.split("#")[0]) ?? 0);
        // Where an edit in this frame will land: the document a same-frame
        // SliceSelected opens (the machine author's `edit { fileId }` idiom —
        // select, then edit, one frame), else the one on show.
        let selectedThisFrame = null;
        context.subscribe("SliceSelected", (fact) => {
            selectedThisFrame = { type: fact.payload.sliceId.split("#")[0], frame: fact.frame };
        });
        context.subscribe("EditRequested", (fact) => {
            const target = selectedThisFrame !== null && selectedThisFrame.frame === fact.frame
                ? selectedThisFrame.type
                : activeFileId;
            if (outranked(target, fact.payload.priority))
                return;
            pendingEdit = true;
        });
        context.subscribe("CaretMoved", () => {
            pendingEdit = false;
        });
        context.subscribe("SliceCreateRequested", () => {
            pendingCreate = true;
        });
        context.subscribe("SliceDuplicateRequested", (fact) => {
            if (outranked(fact.payload.sliceId, fact.payload.priority))
                return;
            pendingCreate = true;
        });
        // Replacements in flight: successor instance -> the document it was built
        // from and the instances it replaces (a hot reload's previous build, or
        // the boot instances an adoption retires). Settled when the successor's
        // SliceMounted lands: the predecessors go, unless the successor died at
        // start — then the successor goes and the predecessors stay.
        const retiring = new Map();
        const diedAtStart = new Set();
        let republishedFrame = -1;
        // Once this foundry has retired itself in favour of its successor it is
        // a bystander for the rest of the frame: the successor answers. And a
        // successor defers to a still-living predecessor (heard from the pool's
        // re-publication before its own mount fact) until that predecessor's
        // SliceUnmounted — the two never save the same publication.
        let retired = false;
        let heardSelf = false;
        let predecessorLiving = false;
        context.subscribe("SliceMounted", (fact) => {
            const type = fact.payload.sliceType;
            const ids = mountedTypes.get(type) ?? new Set();
            ids.add(fact.payload.sliceId);
            mountedTypes.set(type, ids);
            if (type === context.sliceType) {
                if (fact.payload.sliceId === context.instanceId)
                    heardSelf = true;
                else if (!heardSelf)
                    predecessorLiving = true;
            }
            if (retired)
                return;
            // Late joiners never ask (rule 9): a newcomer that listens for the
            // lineage hears it again — a successor foundry seeds its ledger from
            // this. The frame guard collapses a burst of mounts.
            const consumes = fact.payload.consumes;
            if (consumes.includes("SliceSaved") || consumes.includes("*")) {
                if (republishedFrame !== context.frameNumber) {
                    republishedFrame = context.frameNumber;
                    for (const [fileId, sliceId] of saved) {
                        if (sliceId === fact.payload.sliceId)
                            continue;
                        context.emit("SliceSaved", { sliceId, sliceType: fileId, fileId });
                    }
                }
            }
            settle(fact.payload.sliceId);
        });
        context.subscribe("SliceUnmounted", (fact) => {
            const type = fact.payload.sliceId.split("#")[0];
            if (type === context.sliceType && fact.payload.sliceId !== context.instanceId) {
                predecessorLiving = false;
            }
            const ids = mountedTypes.get(type);
            if (ids === undefined)
                return;
            ids.delete(fact.payload.sliceId);
            if (ids.size === 0)
                mountedTypes.delete(type);
        });
        // A predecessor's lineage, heard as a late joiner: what it saved, this
        // foundry now owns. Its own emissions are already in the ledger.
        const inherited = new Set();
        context.subscribe("SliceSaved", (fact) => {
            if (fact.sourceSlice === context.instanceId)
                return;
            saved.set(fact.payload.fileId, fact.payload.sliceId);
            // The predecessor's build IS what runs; the first sight of the
            // document is the baseline, not a change to save.
            if (!lastSource.has(fact.payload.fileId))
                inherited.add(fact.payload.fileId);
        });
        // The successor's SliceMounted is the moment of truth for a replacement.
        const settle = (sliceId) => {
            const entry = retiring.get(sliceId);
            if (entry === undefined)
                return;
            retiring.delete(sliceId);
            const { fileId, predecessors } = entry;
            if (diedAtStart.has(sliceId) && predecessors.length > 0) {
                // The safety net: a body that died at start does not replace a
                // running one. The successor goes, the last predecessor stays the
                // owned instance, and the verdict hangs on it.
                diedAtStart.delete(sliceId);
                context.unmountSlice(sliceId);
                announced.delete(sliceId);
                const kept = predecessors[predecessors.length - 1];
                saved.set(fileId, kept);
                announced.set(kept, "stale");
                announce(fileId);
                return;
            }
            diedAtStart.delete(sliceId);
            let flagged = false;
            for (const predecessor of predecessors) {
                const previousKey = announced.get(predecessor);
                announced.delete(predecessor);
                if (previousKey !== undefined && previousKey.startsWith("true|"))
                    flagged = true;
                if (predecessor === context.instanceId)
                    retired = true;
                context.unmountSlice(predecessor);
            }
            // The flag names an instance, so a flagged instance's replacement
            // re-announces its own state either way — including the all-clear a
            // fix earns. The sentinel never equals a real key, forcing the emit.
            if (flagged) {
                announced.set(sliceId, "stale");
                announce(fileId);
            }
        };
        // The toolbar's DELETE: if this foundry saved the named slice's type,
        // the instance is unmounted (the buffer deletes the document — each
        // owner does its own part). Compiled-in slices are not the foundry's to
        // kill, so the intent passes them by.
        context.subscribe("SliceDeleteRequested", (fact) => {
            if (outranked(fact.payload.sliceId, fact.payload.priority))
                return;
            const type = fact.payload.sliceId.split("#")[0];
            const instance = saved.get(type);
            if (instance === undefined)
                return;
            saved.delete(type);
            lastSource.delete(type);
            errors.delete(type);
            context.unmountSlice(instance);
        });
        const assertMountable = (value) => {
            if (typeof value !== "object" || value === null) {
                throw new Error("The assembled document is not a definition object.");
            }
            const definition = value;
            if (typeof definition.type !== "string" || definition.type.length === 0) {
                throw new Error('The document needs a non-empty "type".');
            }
            const isEventList = (list) => Array.isArray(list) && list.every((entry) => typeof entry === "string");
            if (!isEventList(definition.consumes) || !isEventList(definition.emits)) {
                throw new Error(`${definition.type}: consumes and emits must be string arrays.`);
            }
            if (typeof definition.start !== "function") {
                throw new Error(`${definition.type}: "start" must be a function.`);
            }
            if (typeof definition.description === "string" &&
                definition.description.length > DESCRIPTION_LIMIT) {
                throw new Error(`${definition.type}: description is over ${DESCRIPTION_LIMIT} chars.`);
            }
            return value;
        };
        // Open vocabulary: whatever the document speaks that the law has no
        // schema for is declared as sketched, so the firewall lets it flow
        // shape-free instead of flagging unknown-type.
        const sketch = (meta) => {
            const novel = [...new Set([...meta.consumes, ...meta.emits])].filter((type) => type !== "*" && !contracted.has(type) && !sketched.has(type));
            if (novel.length === 0)
                return;
            for (const type of novel)
                sketched.add(type);
            context.emit("ContractSketched", { types: novel });
        };
        // The one channel for the card's health: emitted when the verdict (or
        // the instance wearing it) changes, and re-announced after every
        // hot-reload because the flag names a live instance.
        const announce = (fileId) => {
            const instance = saved.get(fileId);
            if (instance === undefined)
                return;
            const verdicts = errors.get(fileId) ?? {};
            const message = [verdicts.compile, verdicts.violated, verdicts.lint]
                .filter((entry) => entry !== undefined)
                .join(" | ");
            const errored = message.length > 0;
            const key = `${errored}|${message}`;
            if (announced.get(instance) === key)
                return;
            // A clean instance that was never flagged has nothing to clear — a
            // quiet hot reload should not drop a chip in the water.
            if (!errored && !announced.has(instance))
                return;
            announced.set(instance, key);
            context.emit("SliceErrorChanged", {
                sliceId: instance,
                errored,
                ...(errored ? { message } : {}),
            });
        };
        // Mount the successor now; retire what it replaces when its SliceMounted
        // lands (settle, above). `predecessors` are the boot instances an
        // adoption retires; a hot reload's previous build joins them.
        const mount = (fileId, definition, predecessors = []) => {
            const previous = saved.get(fileId);
            const replacing = previous !== undefined ? [...predecessors, previous] : predecessors;
            const sliceId = context.mountSlice(definition);
            if (replacing.length > 0)
                retiring.set(sliceId, { fileId, predecessors: replacing });
            saved.set(fileId, sliceId);
            // fileId names the saved slice's source document, so the buffer can
            // answer a later SliceSelected with it.
            context.emit("SliceSaved", { sliceId, sliceType: definition.type, fileId });
        };
        // One autosave: assemble, compile, and hot-reload the instance. Failure
        // is a verdict, never a crash — and never a lost card: with no good
        // instance to keep, a contract-only stub mounts in its place.
        const save = (fileId, meta, lines, predecessors = []) => {
            const source = JSON.stringify({ meta, lines });
            if (lastSource.get(fileId) === source)
                return;
            lastSource.set(fileId, source);
            sketch(meta);
            const verdicts = errors.get(fileId) ?? {};
            try {
                // The wrapper the author never types: contract fields serialized as
                // data, the body dropped into start. A capturing defineSlice stands
                // in for the contracts' — the assembled code calls it, we keep what
                // it was given. No module machinery, no bundler. The body runs
                // inside a try: autosave mounts half-typed code all the time, and a
                // start that dies (an undefined name, an undeclared subscribe) must
                // become a verdict on the card, never a crash in the pool's frame
                // barrier.
                const assembled = [
                    "defineSlice({",
                    `  type: ${JSON.stringify(meta.type)},`,
                    `  description: ${JSON.stringify(meta.description)},`,
                    `  consumes: ${JSON.stringify(meta.consumes)},`,
                    `  emits: ${JSON.stringify(meta.emits)},`,
                    "  start(context) {",
                    "    try {",
                    lines.join("\n"),
                    "    } catch (error) {",
                    "      reportStartFailure(error);",
                    "    }",
                    "  },",
                    "});",
                ].join("\n");
                const captured = [];
                const capture = (definition) => {
                    captured.push(definition);
                    return definition;
                };
                const reportStartFailure = (error) => {
                    const failed = errors.get(fileId) ?? {};
                    failed.compile = `start failed | ${error instanceof Error ? error.message : String(error)}`;
                    errors.set(fileId, failed);
                    // The instance that died is the one this save mounted; settle()
                    // decides, when its SliceMounted lands, whether it stays.
                    const dying = saved.get(fileId);
                    if (dying !== undefined)
                        diedAtStart.add(dying);
                    announce(fileId);
                };
                // No ambient surface: a document body references nothing but its
                // own locals and `context`, exactly like a compiled slice under the
                // type-only import law — whatever it needs to know arrives as facts.
                const factory = new Function("defineSlice", "reportStartFailure", `"use strict";\n${assembled}`);
                factory(capture, reportStartFailure);
                const definition = assertMountable(captured[0]);
                // A fresh compile is a fresh slate for the code's own verdicts.
                delete verdicts.compile;
                delete verdicts.violated;
                errors.set(fileId, verdicts);
                mount(fileId, definition, predecessors);
            }
            catch (error) {
                verdicts.compile = error instanceof Error ? error.message : String(error);
                errors.set(fileId, verdicts);
                if (!saved.has(fileId) && predecessors.length > 0) {
                    // An adoption that will not compile keeps the boot instance running
                    // and claims it: the verdict hangs on its card, and the next good
                    // build replaces it like any owned instance.
                    saved.set(fileId, predecessors[predecessors.length - 1]);
                }
                else if (!saved.has(fileId)) {
                    // Born broken: the card still appears, wearing the contract and a
                    // no-op body until the code compiles.
                    mount(fileId, {
                        type: meta.type,
                        description: meta.description,
                        consumes: meta.consumes.filter((entry) => entry !== "*"),
                        emits: [...meta.emits],
                        start: () => { },
                    }, predecessors);
                }
            }
            announce(fileId);
        };
        // The autosave gate. Edits and creations always save; a navigation open
        // saves only what this foundry already owns (deduped to a no-op unless
        // the content actually differs) — picking a compiled slice's card opens
        // its stub without mounting a shadow copy of it.
        context.subscribe("BufferChanged", (fact) => {
            if (retired || predecessorLiving)
                return;
            const { fileId, meta, lines } = fact.payload;
            const edited = pendingEdit;
            const created = pendingCreate;
            pendingEdit = false;
            pendingCreate = false;
            const previousActive = activeFileId;
            activeFileId = fileId;
            // A type edit renamed the document: the old name's instance follows it.
            if (edited && !created && previousActive !== fileId) {
                const orphan = saved.get(previousActive);
                if (orphan !== undefined) {
                    context.unmountSlice(orphan);
                    announced.delete(orphan);
                    saved.delete(previousActive);
                    lastSource.delete(previousActive);
                    const carried = errors.get(previousActive);
                    errors.delete(previousActive);
                    if (carried !== undefined)
                        errors.set(fileId, carried);
                }
            }
            if (!edited && !created && inherited.has(fileId)) {
                // A navigation open of an inherited document: what is on show is
                // what the predecessor built. Adopt it as the baseline, save nothing.
                inherited.delete(fileId);
                lastSource.set(fileId, JSON.stringify({ meta, lines }));
                return;
            }
            inherited.delete(fileId);
            const foreign = mountedTypes.has(meta.type) && !saved.has(fileId);
            let predecessors = [];
            if (foreign) {
                // Navigation opens never save — picking a compiled slice's card
                // opens its source without mounting a shadow copy of it.
                if (!edited && !created)
                    return;
                // Adoption: the first edit of a compiled slice's document builds the
                // document and retires the boot instance once the build has landed
                // — from here on the type is foundry-owned, and hot reload,
                // restores, and DELETE treat it like any authored slice. Any slice:
                // the buffer, the stage, this foundry. The boot body and the
                // document body are the same text by construction (SliceMounted
                // carries the running source), so undoing past the adoption point
                // restores the original behaviour, not a stub.
                const owned = new Set(saved.values());
                predecessors = [...(mountedTypes.get(meta.type) ?? [])].filter((id) => !owned.has(id));
            }
            save(fileId, meta, lines, predecessors);
        });
        // Time travel: the restored document re-saves the instance the foundry
        // already owns, so the card follows the scrub; rule-9 re-publications
        // carry unchanged content and dedupe to nothing. Restores never mint new
        // instances — mount history is pool history, not workspace state.
        context.subscribe("BufferRestored", (fact) => {
            if (retired || predecessorLiving)
                return;
            const { fileId, meta, lines } = fact.payload;
            activeFileId = fileId;
            if (!saved.has(fileId))
                return;
            save(fileId, meta, lines);
        });
        // The compliance oracle's findings for the open document, folded into
        // the same error channel as compile failures — one frame behind the
        // text, like every oracle here.
        context.subscribe("DiagnosticsPublished", (fact) => {
            if (!saved.has(activeFileId))
                return;
            const verdicts = errors.get(activeFileId) ?? {};
            const count = fact.payload.diagnostics.length;
            if (count === 0)
                delete verdicts.lint;
            else
                verdicts.lint = `${count} lint finding${count === 1 ? "" : "s"}`;
            errors.set(activeFileId, verdicts);
            announce(activeFileId);
        });
        // The firewall flagged a fact from a saved instance: the card wears it
        // until the next successful save of that document.
        context.subscribe("ContractViolated", (fact) => {
            for (const [fileId, instance] of saved) {
                if (instance !== fact.payload.sourceSlice)
                    continue;
                const verdicts = errors.get(fileId) ?? {};
                verdicts.violated = `contract violated | ${fact.payload.reason} | ${fact.payload.factType}`;
                errors.set(fileId, verdicts);
                announce(fileId);
                return;
            }
        });
    },
});
