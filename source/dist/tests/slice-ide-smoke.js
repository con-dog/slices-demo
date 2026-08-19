import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
const defineSlice = sliceDefinerFor();
import { clipboard } from "../slices/clipboard.js";
import { clock } from "../slices/clock.js";
import { completionOracle } from "../slices/completion-oracle.js";
import { complianceOracle } from "../slices/compliance-oracle.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { foundry } from "../slices/foundry.js";
import { ruleBook } from "../slices/rule-book.js";
import { schemaBook } from "../slices/schema-book.js";
import { syntaxOracle } from "../slices/syntax-oracle.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The editor's example flow, as an executable assertion ---
// EditRequested -> FrameTicked -> BufferChanged -> TokensMapped +
// DiagnosticsPublished, each hop one frame, no slice calling another. The
// clock is a stepper: editor time advances only because someone typed. The
// document is structured — a contract half (meta) plus the body of
// start(context) as lines — and both halves ride the same intent channel.
// One-shot fact emitters, mounted when the script needs them.
const typist = (edits) => defineSlice({
    type: "test-typist",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        for (const { text, priority } of edits) {
            context.emit("EditRequested", { edit: { kind: "insert", text }, priority });
        }
    },
});
const caretMover = defineSlice({
    type: "test-caret-mover",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", {
            edit: { kind: "caret-move", direction: "right" },
            priority: 10,
        });
    },
});
const scrubber = (frameNumber) => defineSlice({
    type: "test-scrubber",
    consumes: [],
    emits: ["TimelineScrubbed"],
    start(context) {
        context.emit("TimelineScrubbed", { frameNumber });
    },
});
const pool = new Pool({ onHandlerError: (error) => { throw error; } });
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(clock, { instanceId: "clock#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
// The foundry autosaves in the same pool the editor lives in — every edit
// below is also a save, and the assertions ride along.
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(ruleBook, { instanceId: "rule-book#1" });
pool.mount(complianceOracle, { instanceId: "compliance-oracle#1" });
pool.mount(completionOracle, { instanceId: "completion-oracle#1" });
pool.mount(syntaxOracle, { instanceId: "syntax-oracle#1" });
// The workspace boots empty — no seed, no placeholder — so nothing is
// published until an intent opens a document. The first ADD is that intent:
// the buffer names it slice-1, and it is the first undo marker.
const adder = defineSlice({
    type: "test-adder",
    consumes: [],
    emits: ["SliceCreateRequested"],
    start(context) {
        context.emit("SliceCreateRequested", {});
    },
});
timeline.advanceUntil("SliceMounted", { where: (fact) => fact.payload.sliceType === "syntax-oracle" });
assert(timeline.delivered("BufferChanged").length === 0, "An empty workspace must publish no document at boot.");
pool.mount(adder, { instanceId: "test-adder#0" });
const seed = timeline.advanceUntil("BufferChanged");
assert(seed.payload.revision === 1, "The first document must be revision 1.");
assert(seed.payload.fileId === "slice-1" && seed.payload.meta.type === "slice-1", `The first ADD must be the slice-1 skeleton, got: ${seed.payload.fileId}.`);
assert(seed.payload.lines.length === 1 && seed.payload.lines[0] === "", "The newborn body must be a blank page — no boilerplate.");
const seedFindings = timeline.advanceUntil("DiagnosticsPublished", {
    where: (fact) => fact.payload.revision === 1,
});
assert(seedFindings.payload.diagnostics.length === 0, "The skeleton seed must be born clean.");
// The syntax painting shares the findings' frame, so it is already recorded.
assert(timeline.delivered("TokensMapped", (fact) => fact.payload.revision === 1).length === 1, "The syntax oracle must paint the seed revision.");
// --- Autosave: there is no save button — the seed is already living ---
assert(timeline.delivered("SliceSaved", (fact) => fact.payload.fileId === "slice-1")
    .length === 1, "The first document must autosave into the pool.");
assert(timeline.delivered("SliceMounted", (fact) => fact.payload.sliceType === "slice-1")
    .length === 1, "The autosaved document must be a mounted slice with a card.");
// --- Typing: intents wait for the stepper's tick; priority orders a frame ---
// Two authors in one frame: the lower-priority insertion must land after the
// higher-priority one, never inside it.
pool.mount(typist([
    { text: "~", priority: 1 },
    { text: "!", priority: 10 },
]), { instanceId: "test-typist#1" });
const edited = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 2,
});
assert(edited.payload.lines[0].startsWith("!~"), `Priority must order the frame's edits, got: ${edited.payload.lines[0]}.`);
assert(edited.causedBy.length > 0, "An edit's publication must carry its cause.");
assert(timeline.delivered("FrameTicked").length > 0, "The stepper clock must have ticked for the typed frame.");
timeline.advanceUntil("TokensMapped", { where: (fact) => fact.payload.revision === 2 });
assert(timeline.delivered("DiagnosticsPublished", (fact) => fact.payload.revision === 2)
    .length === 1, "The compliance oracle must re-check the edited revision.");
// --- Caret motion is state, not an undo step ---
pool.mount(caretMover, { instanceId: "test-caret-mover#1" });
timeline.advanceUntil("CaretMoved");
assert(timeline.delivered("BufferChanged").length === 2, "A caret move must not publish BufferChanged (it is never an undo marker).");
// --- The stepper keeps answering later bursts the same way ---
pool.mount(typist([{ text: "Z", priority: 10 }]), { instanceId: "test-typist#2" });
const resumed = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 3,
});
// The caret sat at the line's end (column 2) after the earlier edits and
// the clamped arrow-right.
assert(resumed.payload.lines[0] === "!~Z", `A later edit must apply at the caret, got: ${resumed.payload.lines[0]}.`);
// --- The law still bites: a violating body trips the declared rules ---
pool.mount(typist([{ text: "border-radius" + ": 4px;", priority: 10 }]), {
    instanceId: "test-typist#law",
});
const lawEdit = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 4,
});
timeline.advanceUntil("DiagnosticsPublished", {
    where: (fact) => fact.payload.revision === 4 &&
        fact.payload.diagnostics.some((d) => d.ruleId === "no-rounded-corners"),
});
// The broken text still autosaved: failure is a verdict on the card
// (SliceErrorChanged greys it and hangs the red X), never a blocked save.
assert(timeline.delivered("SliceErrorChanged", (fact) => fact.payload.errored).length > 0, "A body that will not compile must flag the card via SliceErrorChanged.");
// --- Time travel: scrubbing replays the recorded document as new facts ---
pool.mount(scrubber(seed.frame), { instanceId: "test-scrubber#1" });
const restored = timeline.advanceUntil("BufferRestored");
assert(restored.payload.lines.join("\n") === seed.payload.lines.join("\n"), "Scrubbing to the seed's frame must restore the seed body exactly.");
timeline.advanceUntil("DiagnosticsPublished", {
    where: (fact) => fact.payload.diagnostics.length === 0,
});
// The restored seed compiles and lints clean again: the flag comes off as a
// fact, the same way it went on.
timeline.advanceUntil("SliceErrorChanged", {
    where: (fact) => !fact.payload.errored,
});
// Typing after a restore branches from the restored document — the buffer
// builds on what was replayed, never on the pre-scrub text.
pool.mount(typist([{ text: "Q", priority: 10 }]), { instanceId: "test-typist#3" });
const branched = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 5,
});
assert(branched.payload.lines[0] === "Q", `A post-restore edit must branch from the restored text, got: ${branched.payload.lines[0]}.`);
// --- Selection: shift-motion grows a range; editing consumes it ---
const selector = defineSlice({
    type: "test-selector",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        // Park at the branch line's start, select rightward past the end
        // (clamped), then type over the selection: "Q" must become "*".
        context.emit("EditRequested", {
            edit: { kind: "caret-set", line: 0, column: 0 },
            priority: 10,
        });
        context.emit("EditRequested", {
            edit: { kind: "caret-move", direction: "right", extend: true },
            priority: 10,
        });
        context.emit("EditRequested", {
            edit: { kind: "caret-move", direction: "right", extend: true },
            priority: 10,
        });
        context.emit("EditRequested", { edit: { kind: "insert", text: "*" }, priority: 10 });
    },
});
pool.mount(selector, { instanceId: "test-selector#1" });
const replaced = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 6,
});
assert(replaced.payload.lines[0] === "*", `Typing over a selection must replace it, got: ${replaced.payload.lines[0]}.`);
assert(replaced.payload.anchor === null, "An applied edit must collapse the selection.");
// --- Cut: the clipboard slice answers CutRequested with a delete intent ---
const cutter = defineSlice({
    type: "test-cutter",
    consumes: [],
    emits: ["EditRequested", "CutRequested"],
    start(context) {
        context.emit("EditRequested", {
            edit: { kind: "caret-set", line: 0, column: 0 },
            priority: 10,
        });
        context.emit("EditRequested", {
            edit: { kind: "caret-move", direction: "line-end", extend: true },
            priority: 10,
        });
    },
});
pool.mount(clipboard, { instanceId: "clipboard#1" });
pool.mount(cutter, { instanceId: "test-cutter#1" });
timeline.advanceUntil("CaretMoved", {
    where: (fact) => fact.payload.anchor !== null,
});
const cutRequester = defineSlice({
    type: "test-cut-requester",
    consumes: [],
    emits: ["CutRequested"],
    start(context) {
        context.emit("CutRequested", {});
    },
});
pool.mount(cutRequester, { instanceId: "test-cut-requester#1" });
const cut = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 7,
});
assert(cut.payload.lines[0] === "", `Cutting the selected line must empty it, got: ${cut.payload.lines[0]}.`);
// --- The contract is data: fields and tags ride the same intent channel ---
const metaTypist = defineSlice({
    type: "test-meta-typist",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", {
            edit: { kind: "meta-set", field: "description", value: "Written by a test." },
            priority: 10,
        });
        context.emit("EditRequested", {
            edit: { kind: "tag-add", side: "consumes", tag: "StepPressed" },
            priority: 10,
        });
        context.emit("EditRequested", {
            edit: { kind: "tag-add", side: "emits", tag: "PingSent" },
            priority: 10,
        });
    },
});
pool.mount(metaTypist, { instanceId: "test-meta-typist#1" });
const contractEdited = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 8,
});
assert(contractEdited.payload.meta.description === "Written by a test." &&
    contractEdited.payload.meta.consumes.includes("StepPressed") &&
    contractEdited.payload.meta.emits.includes("PingSent"), "Contract edits must land in the published meta.");
// Renaming the type renames the document — the id IS the type, kebab law.
const renamer = defineSlice({
    type: "test-renamer",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", {
            edit: { kind: "meta-set", field: "type", value: "My Slice!!" },
            priority: 10,
        });
    },
});
pool.mount(renamer, { instanceId: "test-renamer#1" });
const renamed = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 9,
});
assert(renamed.payload.fileId === "my-slice" && renamed.payload.meta.type === "my-slice", `A type edit must rename the document to kebab, got: ${renamed.payload.fileId}.`);
// The rename follows through the pool: the old type's instance is replaced
// by one living under the new name — no ghost card.
timeline.advanceUntil("SliceSaved", {
    where: (fact) => fact.payload.fileId === "my-slice",
});
assert(timeline.delivered("SliceUnmounted").some((fact) => fact.payload.sliceId.startsWith("slice-1#")), "Renaming must unmount the old type's autosaved instance.");
// --- Autocomplete is pool traffic: the completion oracle answers prefixes ---
assert(timeline
    .delivered("VocabularyDeclared")
    .some((fact) => fact.payload.types.includes("BufferChanged")), "The completion oracle must declare the contracted vocabulary.");
const completionAsker = defineSlice({
    type: "test-completion-asker",
    consumes: [],
    emits: ["CompletionRequested"],
    start(context) {
        context.emit("CompletionRequested", { field: "consumes", prefix: "Frame" });
    },
});
pool.mount(completionAsker, { instanceId: "test-completion-asker#1" });
const suggested = timeline.advanceUntil("CompletionSuggested");
assert(suggested.payload.prefix === "Frame" &&
    suggested.payload.suggestions.includes("FrameTicked"), `"Frame" must complete to FrameTicked, got: ${suggested.payload.suggestions.join(",")}.`);
// --- Navigation is slices, not files: a card pick opens a contract stub ---
const opener = (sliceId) => defineSlice({
    type: "test-opener",
    consumes: [],
    emits: ["SliceSelected"],
    start(context) {
        context.emit("SliceSelected", { sliceId });
    },
});
pool.mount(opener("rule-book#1"), { instanceId: "test-opener#1" });
const stubbed = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "rule-book",
});
assert(stubbed.payload.meta.type === "rule-book" &&
    stubbed.payload.meta.emits.includes("LintRulesDeclared"), "A compiled slice must open as a stub carrying its mounted contract.");
// A navigation open is not an edit: the autosave gate must not mount a
// shadow copy of a slice that already lives in the pool.
timeline.advance(3);
assert(timeline.delivered("SliceMounted", (fact) => fact.payload.sliceType === "rule-book")
    .length === 1 &&
    timeline.delivered("SliceSaved", (fact) => fact.payload.fileId === "rule-book")
        .length === 0, "Opening a compiled slice's stub must not autosave a shadow copy of it.");
// Scrubbing back across the switch (and the rename) restores the whole
// recorded workspace — documents, names, and the active pointer.
pool.mount(scrubber(cut.frame), { instanceId: "test-scrubber#2" });
const reopened = timeline.advanceUntil("BufferRestored", {
    where: (fact) => fact.payload.fileId === "slice-1",
});
assert(reopened.payload.lines[0] === "" && reopened.payload.meta.type === "slice-1", "The restored view must be the cut slice-1 document, pre-rename.");
// --- The workspace is state: slices are added, copied, and deleted by intent ---
pool.mount(adder, { instanceId: "test-adder#1" });
const created = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "slice-2",
});
assert(created.payload.meta.type === "slice-2" &&
    created.payload.meta.consumes.includes("FrameTicked"), "A new slice must be named by the buffer and seeded forgeable.");
const copier = defineSlice({
    type: "test-copier",
    consumes: [],
    emits: ["SliceDuplicateRequested"],
    start(context) {
        context.emit("SliceDuplicateRequested", { sliceId: "slice-2#1" });
    },
});
pool.mount(copier, { instanceId: "test-copier#1" });
const copied = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "slice-2-copy",
});
assert(copied.payload.meta.type === "slice-2-copy", "A duplicate must rename its type, so forging it mounts a sibling.");
const reaper = defineSlice({
    type: "test-reaper",
    consumes: [],
    emits: ["SliceDeleteRequested"],
    start(context) {
        context.emit("SliceDeleteRequested", { sliceId: "slice-2#1" });
    },
});
pool.mount(reaper, { instanceId: "test-reaper#1" });
const afterDelete = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.frame > copied.frame,
});
assert(afterDelete.payload.fileId !== "slice-2", "Deleting must drop the document and re-point away from it.");
assert(timeline
    .delivered("SliceUnmounted")
    .some((fact) => fact.payload.sliceId.startsWith("slice-2#")), "Deleting a slice must unmount its autosaved instance.");
timeline.expectNone("ContractViolated", "The editor flows must not violate any contract");
// --- The foundry, isolated: every published document autosaves ---
const ECHO_META = {
    type: "echo",
    description: "Autosaved in a test: answers every tick with a step.",
    consumes: ["FrameTicked"],
    emits: ["StepPressed"],
};
const ECHO_BODY = [
    'context.subscribe("FrameTicked", () => {',
    '  context.emit("StepPressed", {});',
    "});",
];
// A fake buffer: whatever document it publishes, the foundry autosaves.
const scribe = (fileId, meta, bodyLines) => defineSlice({
    type: "test-scribe",
    consumes: [],
    emits: ["BufferChanged"],
    start(context) {
        context.emit("BufferChanged", {
            fileId,
            meta,
            lines: bodyLines,
            caret: { line: 0, column: 0 },
            anchor: null,
            fileIds: [fileId],
            revision: 99,
        });
    },
});
const forgePool = new Pool({ onHandlerError: (error) => { throw error; } });
const forge = trackFrames(forgePool);
forgePool.mount(firewall, { instanceId: "firewall#1" });
forgePool.mount(schemaBook, { instanceId: "schema-book#1" });
forgePool.mount(foundry, { instanceId: "foundry#1" });
forgePool.mount(scribe("workshop", ECHO_META, ECHO_BODY), {
    instanceId: "test-scribe#1",
});
const savedFact = forge.advanceUntil("SliceSaved");
assert(savedFact.payload.sliceType === "echo", "The saved slice must carry its type.");
assert(savedFact.payload.fileId === "workshop", "The save must name the source document, for later card picks.");
const liveMount = forge.delivered("SliceMounted", (fact) => fact.payload.sliceType === "echo");
assert(liveMount.length === 1, "Autosaving must mount the compiled slice into the pool.");
// The saved slice is alive: it answers a tick with its own fact.
const ticker = defineSlice({
    type: "test-ticker",
    consumes: [],
    emits: ["FrameTicked"],
    start(context) {
        context.emit("FrameTicked", { frameNumber: 1 });
    },
});
forgePool.mount(ticker, { instanceId: "test-ticker#1" });
const echoed = forge.advanceUntil("StepPressed");
assert(echoed.sourceSlice === savedFact.payload.sliceId, "The saved slice must be the one answering the tick.");
assert(echoed.causedBy.length > 0, "The saved slice's facts must carry causality.");
// Republishing the same content is a no-op — autosave dedupes by content —
// while a changed body hot-reloads the instance as lifecycle facts.
forgePool.mount(scribe("workshop", ECHO_META, ECHO_BODY), {
    instanceId: "test-scribe#same",
});
forge.advance(3);
assert(forge.delivered("SliceMounted", (fact) => fact.payload.sliceType === "echo").length === 1, "An unchanged document must not remount.");
forgePool.mount(scribe("workshop", ECHO_META, [...ECHO_BODY, "void 0;"]), {
    instanceId: "test-scribe#2",
});
const resaved = forge.advanceUntil("SliceSaved", {
    where: (fact) => fact.payload.sliceId !== savedFact.payload.sliceId,
});
// The successor mounts first; the previous instance retires once the
// successor's SliceMounted has landed — one frame later, never the same one.
forge.advanceUntil("SliceUnmounted", {
    where: (fact) => fact.payload.sliceId === savedFact.payload.sliceId,
});
const unmounts = forge.delivered("SliceUnmounted", (fact) => fact.payload.sliceId === savedFact.payload.sliceId);
assert(unmounts.length === 1, "A changed body must unmount the previous instance exactly once.");
assert(resaved.payload.sliceType === "echo", "The hot reload must keep the type.");
// --- Open vocabulary: a saved slice's novel fact type flows unflagged ---
const PING_META = {
    type: "pinger",
    description: "Answers every tick with a novel PingSent fact.",
    consumes: ["FrameTicked"],
    emits: ["PingSent"],
};
const PING_BODY = [
    "let pings = 0;",
    'context.subscribe("FrameTicked", () => {',
    "  pings += 1;",
    '  context.emit("PingSent", { pings });',
    "});",
];
forgePool.mount(scribe("pinger", PING_META, PING_BODY), {
    instanceId: "test-scribe#ping",
});
const sketchedFact = forge.advanceUntil("ContractSketched");
assert(sketchedFact.payload.types.includes("PingSent"), "Saving a novel emitter must sketch its vocabulary.");
forgePool.mount(ticker, { instanceId: "test-ticker#ping" });
forge.advance(4);
// PingSent is deliberately outside the typed vocabulary — compare as plain
// strings, which is exactly what "open" means here.
const pings = forge.frames.flatMap((record) => record.facts.filter((fact) => fact.type === "PingSent"));
assert(pings.length > 0, "The novel PingSent fact must flow through the pool.");
forge.expectNone("ContractViolated", "A sketched type must pass the firewall shape-free");
// --- Errors are verdicts, never blocked saves and never crashes ---
const BROKEN_META = { type: "broken", description: "", consumes: [], emits: [] };
// A body that will not compile still saves: a contract-only stub mounts so
// the card exists, wearing the red X.
forgePool.mount(scribe("broken", BROKEN_META, ["this is (not) javascript {{{"]), {
    instanceId: "test-scribe#3",
});
const flagged = forge.advanceUntil("SliceErrorChanged", {
    where: (fact) => fact.payload.errored,
});
const stubMounts = forge.delivered("SliceMounted", (fact) => fact.payload.sliceType === "broken");
assert(stubMounts.length === 1, "A broken document must still mount a stub card.");
assert(flagged.payload.sliceId === stubMounts[0].payload.sliceId, "The error flag must name the stub instance.");
// A body that compiles but dies on start is a verdict too...
forgePool.mount(scribe("broken", BROKEN_META, ["boom();"]), {
    instanceId: "test-scribe#4",
});
forge.advanceUntil("SliceErrorChanged", {
    where: (fact) => fact.payload.errored && (fact.payload.message ?? "").includes("start failed"),
});
// ...and the fix clears the flag the same way it was raised.
forgePool.mount(scribe("broken", BROKEN_META, ["void 0;"]), {
    instanceId: "test-scribe#5",
});
forge.advanceUntil("SliceErrorChanged", { where: (fact) => !fact.payload.errored });
forge.expectNone("ContractViolated", "The autosave flows must not violate any contract");
// The law-edit fact above must also have tokens painted for its revision.
assert(lawEdit.payload.revision === 4, "The law edit must be revision 4.");
console.log("Slice-IDE seed, edit-cascade, priority, caret, stepper-clock, law, time-travel, selection, clipboard, contract-edit, rename, completion, slice-navigation, and autosave-foundry smoke tests passed.");
