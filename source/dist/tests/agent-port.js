import { firewall, Pool } from "@slices/kit";
import { trackFrames } from "@slices/kit/testing";
import { sliceDefinerFor } from "@slices/kit/define";
import { agentPort } from "../slices/agent-port.js";
import { clock } from "../slices/clock.js";
import { completionOracle } from "../slices/completion-oracle.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { foundry } from "../slices/foundry.js";
import { guideBook } from "../slices/guide-book.js";
import { schemaBook } from "../slices/schema-book.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
const defineSlice = sliceDefinerFor();
// --- The machine author's whole loop, as an executable assertion ---
// An outside harness (here: this test, standing in for an LLM) drives the
// editor through the port's global API alone: declare a novel emit on the
// seed document, bulk-write a body, and watch the foundry mount the result —
// then read it all back through facts | snapshot | trace | settle. No DOM,
// no direct pool access, no agent-only fact types.
const pool = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(guideBook, { instanceId: "guide-book#1" });
pool.mount(clock, { instanceId: "clock#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(completionOracle, { instanceId: "completion-oracle#1" });
pool.mount(agentPort, { instanceId: "agent-port#1" });
// The workspace boots empty (no seed, no placeholder): the first ADD opens
// the first document, which the buffer names slice-1.
const firstAdd = defineSlice({
    type: "test-first-add",
    consumes: [],
    emits: ["SliceCreateRequested"],
    start(context) {
        context.emit("SliceCreateRequested", {});
    },
});
pool.mount(firstAdd, { instanceId: "test-first-add#1" });
// Boot: the first document publishes and autosaves.
timeline.advanceUntil("BufferChanged");
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API to the global host.");
// --- Guardrail: only the port's own emits list is checked synchronously ---
let threw = false;
try {
    api.emit("FrameTicked", { frameNumber: 1 });
}
catch {
    threw = true;
}
assert(threw, "The port must refuse event types outside its declared emits.");
// --- Author a living slice through the port ---
// Step 1: grow the contract — declare a novel emit the registry lacks.
api.emit("EditRequested", {
    edit: { kind: "tag-add", side: "emits", tag: "Ping" },
});
timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.meta.emits.includes("Ping"),
});
timeline.advanceUntil("ContractSketched", {
    where: (fact) => fact.payload.types.includes("Ping"),
});
// Step 2: bulk-write the body — the paste idiom, select-all then one insert.
api.emit("EditRequested", { edit: { kind: "select-all" } });
api.emit("EditRequested", {
    edit: { kind: "insert", text: 'context.emit("Ping", { beat: 1 });' },
});
timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.lines.join("\n").includes('"Ping"'),
});
timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "slice-1" && fact.payload.emits.includes("Ping"),
});
// Step 3: the autosaved instance speaks — a sketched type flows shape-free.
timeline.advance(4);
assert(timeline.frames.some((record) => record.facts.some((fact) => fact.type === "Ping" &&
    fact.sourceSlice.startsWith("slice-1#"))), "The authored slice must emit its sketched fact into the pool.");
timeline.expectNone("ContractViolated", "Sketched vocabulary must pass the firewall shape-free");
// --- The port stamps machine priority; a harness cannot promote itself ---
api.emit("EditRequested", {
    edit: { kind: "caret-move", direction: "left" },
    priority: 99,
});
timeline.advance(2);
assert(timeline
    .delivered("EditRequested", (fact) => fact.sourceSlice === "agent-port#1")
    .every((fact) => fact.payload.priority === 1), "Every port-borne edit must carry machine priority 1.");
// --- facts | snapshot | trace read the same history back ---
const changes = api.facts({ types: ["BufferChanged"] });
assert(changes.length >= 2, "facts() must surface the BufferChanged history.");
const snapshot = api.snapshot();
assert(snapshot.activeFileId === "slice-1", "The snapshot must name the open document.");
const doc = snapshot.documents["slice-1"];
assert(doc !== undefined, "The snapshot must carry the open document.");
assert(doc.meta.emits.includes("Ping"), "The snapshot document must wear the grown contract.");
assert(doc.lines.join("\n").includes('context.emit("Ping"'), "The snapshot document must carry the bulk-written body.");
const savedEntry = Object.entries(snapshot.slices).find(([sliceId]) => sliceId.startsWith("slice-1#"));
assert(savedEntry !== undefined, "The snapshot must list the autosaved instance.");
assert(savedEntry[1].fileId === "slice-1", "The autosaved instance must name its source document.");
assert(snapshot.vocabulary.includes("Ping"), "The snapshot vocabulary must include the sketched type.");
const lastChange = changes[changes.length - 1];
const trace = api.trace(lastChange.id);
assert(trace !== null, "trace() must find a ringed fact.");
assert(trace.causes.some((node) => node.type === "EditRequested"), "A BufferChanged must trace back to the intent that caused it.");
// --- settle: the harness's await-the-cascade primitive ---
const pending = api.settle({ timeoutMs: 1500 });
api.emit("EditRequested", { edit: { kind: "insert", text: "x" } });
timeline.advance(8);
const settled = await pending;
assert(!settled.timedOut, "settle() must resolve as quiet, not by timeout.");
assert(settled.facts.some((fact) => fact.type === "BufferChanged"), "settle() must return the cascade the emission caused.");
// --- send: one round trip, emit plus settle ---
const roundTrip = api.send("EditRequested", {
    edit: { kind: "insert", text: "y" },
});
timeline.advance(8);
const sent = await roundTrip;
assert(sent.factId.length > 0, "send() must return the emitted fact's id.");
assert(sent.facts.some((fact) => fact.type === "BufferChanged"), "send() must return the cascade its own intent caused.");
// --- replace-match: content-anchored surgery, no line/column arithmetic ---
// The anchor is the text itself, so a batch of edits needs no document
// re-fetch between intents and no bottom-up ordering.
const anchored = api.send("EditRequested", {
    edit: { kind: "replace-match", find: "{ beat: 1 }", text: "{ beat: 2 }" },
});
timeline.advance(8);
const anchoredDone = await anchored;
assert(anchoredDone.facts.some((fact) => fact.type === "BufferChanged" &&
    fact.payload.lines.join("\n").includes("{ beat: 2 }")), "replace-match must land the anchored replacement.");
assert(anchoredDone.facts.filter((fact) => fact.type === "BufferChanged").length === 1, "A replace-match must be exactly one undo step.");
// occurrence names the Nth match, counted non-overlapping.
const doubled = api.send("EditRequested", {
    edit: { kind: "replace-match", find: "xy", text: "xyxy" },
});
timeline.advance(8);
await doubled;
const second = api.send("EditRequested", {
    edit: { kind: "replace-match", find: "xy", text: "z!", occurrence: 2 },
});
timeline.advance(8);
await second;
const anchoredBody = api.snapshot().documents["slice-1"].lines.join("\n");
assert(anchoredBody.includes("xyz!") && !anchoredBody.includes("xyxy"), `occurrence must pick the Nth non-overlapping match, got ${JSON.stringify(anchoredBody)}.`);
// A find that misses is a no-op, never an error: the tick still lands, the
// cascade carries CaretMoved instead of BufferChanged, and no verdict flies.
const missed = api.send("EditRequested", {
    edit: { kind: "replace-match", find: "no-such-anchor", text: "z" },
});
timeline.advance(8);
const missedDone = await missed;
assert(!missedDone.facts.some((fact) => fact.type === "BufferChanged"), "A missed find must not change the document.");
assert(missedDone.facts.some((fact) => fact.type === "CaretMoved"), "A missed find still ticks: the cascade must carry CaretMoved.");
assert(missedDone.violations.length === 0, "A miss is lawful, not a violation.");
// --- The diet: digest | read | outline cost a harness a fraction of snapshot ---
// A write's settled result carries what changed as text — the revision move
// with the touched lines in context — so the harness never re-reads the
// workspace to learn what its own intent did.
assert(missedDone.digest.includes("no BufferChanged"), `A missed find must digest as no BufferChanged, got ${JSON.stringify(missedDone.digest)}.`);
assert(anchoredDone.digest.includes("rev ") && anchoredDone.digest.includes("{ beat: 2 }"), `An anchored edit must digest its revision move and the touched line, got ${JSON.stringify(anchoredDone.digest)}.`);
assert(anchoredDone.digest.split("\n").every((line) => line.length <= 130), "Digest lines must stay clipped.");
// digest() alone renders what changed since the last render — and nothing twice.
const quiet = api.digest();
assert(quiet.includes("nothing since the last digest"), `Nothing changed since the last settled digest, got ${JSON.stringify(quiet)}.`);
const tagged = api.send("EditRequested", {
    edit: { kind: "tag-add", side: "consumes", tag: "TimelineScrubbed" },
});
timeline.advance(8);
const taggedDone = await tagged;
assert(taggedDone.digest.includes("meta only"), `A contract-only edit must digest as meta only, got ${JSON.stringify(taggedDone.digest)}.`);
const page = api.read({ from: 1, to: 1 });
assert(page.startsWith("slice-1 | rev ") &&
    page.includes("in=[FrameTicked,TimelineScrubbed]") &&
    page.split("\n").length === 2, `read() must render a header and the requested numbered lines, got ${JSON.stringify(page)}.`);
assert(page.split("\n")[1].startsWith("1| "), "read() lines must be numbered from 1.");
assert(api.read({ fileId: "no-such-doc" }).startsWith("no document no-such-doc"), "read() of an unknown document must say so, not throw.");
const outline = api.outline();
assert(outline.includes("documents (") && outline.includes("  slice-1 | rev "), `outline() must list the documents, got ${JSON.stringify(outline)}.`);
assert(/  slice-1#\d+ \| in: /.test(outline) && outline.includes("| doc: slice-1"), "outline() must list the autosaved instance with its source document.");
assert(outline.includes("vocabulary ") && outline.includes("| active slice-1 |"), "outline() must name the active document and the vocabulary size.");
const wholeWorkspace = JSON.stringify(api.snapshot()).length;
const dietRead = outline.length + taggedDone.digest.length;
assert(dietRead * 5 < wholeWorkspace, `outline+digest (${dietRead} chars) must be at least 5x smaller than snapshot (${wholeWorkspace} chars).`);
console.log(`agent-port: snapshot ${wholeWorkspace} chars vs outline+digest ${dietRead} chars.`);
// --- The meta is data: tags-set writes a whole side, a batch is one frame ---
// Five subscriptions used to be five intents, five frames, five remounts. A
// tags-set is one intent; an array payload to send() is a batch that lands
// in one frame — one BufferChanged, one undo step, one remount.
const wholeSide = api.send("EditRequested", {
    edit: { kind: "tags-set", side: "consumes", tags: ["FrameTicked", "StepPressed", "StepPressed", " "] },
});
timeline.advance(8);
const wholeSideDone = await wholeSide;
assert(wholeSideDone.facts.filter((fact) => fact.type === "BufferChanged").length === 1, "tags-set must be exactly one BufferChanged.");
assert(JSON.stringify(api.snapshot().documents["slice-1"].meta.consumes) ===
    JSON.stringify(["FrameTicked", "StepPressed"]), `tags-set must replace the side, deduped and trimmed, got ${JSON.stringify(api.snapshot().documents["slice-1"].meta.consumes)}.`);
assert(wholeSideDone.digest.includes("meta only"), "tags-set must digest as a meta-only move.");
// The batch mixes text and contract: the earlier surgery left the body
// uncompilable (a verdict, never a blocked save), so a select-all + insert
// rides in the same frame as the tag edits — one BufferChanged, one mount.
const batch = api.send("EditRequested", [
    { edit: { kind: "select-all" } },
    { edit: { kind: "insert", text: 'context.emit("Ping", { beat: 3 });' } },
    { edit: { kind: "tag-add", side: "consumes", tag: "CaretMoved" } },
    { edit: { kind: "tag-add", side: "consumes", tag: "StepBackPressed" } },
    { edit: { kind: "tag-add", side: "consumes", tag: "FactSelected" } },
    { edit: { kind: "tag-remove", side: "consumes", tag: "StepPressed" } },
    { edit: { kind: "meta-set", field: "description", value: "Batched." } },
]);
timeline.advance(8);
const batchDone = await batch;
assert(batchDone.factIds.length === 7 && batchDone.factId === batchDone.factIds[0], "A batch must return every intent's id.");
assert(batchDone.facts.filter((fact) => fact.type === "BufferChanged").length === 1, "A batch must coalesce into one BufferChanged — one undo step.");
assert((batchDone.digest.match(/\+slice-1#\d+/g) ?? []).length === 1, `A batch must remount the autosaved instance once, not once per intent, got ${JSON.stringify(batchDone.digest)}.`);
const batchedDoc = api.snapshot().documents["slice-1"];
assert(batchedDoc.lines.join("\n") === 'context.emit("Ping", { beat: 3 });' &&
    batchedDoc.meta.description === "Batched." &&
    JSON.stringify(batchedDoc.meta.consumes) ===
        JSON.stringify(["FrameTicked", "CaretMoved", "StepBackPressed", "FactSelected"]), `Every intent of the batch must apply, in order, got ${JSON.stringify(batchedDoc.meta)}.`);
// --- The roster: a vanished document is said aloud, never a surprise ---
// BufferChanged carries fileIds, so the port prunes on the outcome and the
// digest names the move; a scrub that restores a deleted document brings it
// back the same way. Nothing is guessed from a delete intent.
// No kit timeline here: a stand-in answers StepBackPressed | StepPressed with
// a TimelineScrubbed to a frame this test picks — the buffer's restore path
// is what is under test, not the transport.
let scrubTo = 0;
pool.mount(defineSlice({
    type: "test-scrubber",
    consumes: ["StepBackPressed", "StepPressed"],
    emits: ["TimelineScrubbed"],
    start(context) {
        const scrub = () => context.emit("TimelineScrubbed", { frameNumber: scrubTo });
        context.subscribe("StepBackPressed", scrub);
        context.subscribe("StepPressed", scrub);
    },
}), { instanceId: "test-scrubber#1" });
timeline.advance(2);
const created = api.send("SliceCreateRequested", {});
timeline.advance(8);
const createdDone = await created;
const createdFrame = createdDone.facts.find((fact) => fact.type === "BufferChanged")?.frame ?? 0;
assert(createdDone.digest.includes("docs: +slice-2"), `A created document must digest as a roster move, got ${JSON.stringify(createdDone.digest)}.`);
assert(api.outline().includes("  slice-2 | rev "), "The outline must list the created document.");
const deleted = api.send("SliceDeleteRequested", { sliceId: "slice-2#0" });
timeline.advance(8);
const deletedDone = await deleted;
const deletedFrame = deletedDone.facts.find((fact) => fact.type === "BufferChanged")?.frame ?? 0;
assert(deletedDone.digest.includes("docs: -slice-2"), `A deleted document must digest as a roster move, got ${JSON.stringify(deletedDone.digest)}.`);
assert(!api.outline().includes("  slice-2 | rev "), "The outline must drop the deleted document.");
assert(api.read({ fileId: "slice-2" }).startsWith("no document slice-2"), "read() of a deleted document must say so.");
scrubTo = createdFrame;
const undone = api.send("StepBackPressed", {});
timeline.advance(8);
const undoneDone = await undone;
assert(undoneDone.digest.includes("docs: +slice-2"), `Undoing the delete must digest the document's return, got ${JSON.stringify(undoneDone.digest)}.`);
assert(api.outline().includes("  slice-2 | rev "), "A scrub that restores a document must bring it back to the outline.");
scrubTo = deletedFrame;
const redone = api.send("StepPressed", {});
timeline.advance(8);
await redone;
assert(!api.outline().includes("  slice-2 | rev "), "Redoing the delete must drop the document again.");
// The immortal last document: a refused delete leaves the roster alone.
const refused = api.send("SliceDeleteRequested", { sliceId: "slice-1#0" });
timeline.advance(8);
const refusedDone = await refused;
assert(!refusedDone.digest.includes("docs:") && api.outline().includes("  slice-1 | rev "), "A refused delete must not drop the document — the outcome, not the intent, is the signal.");
// --- The stage is readable: seats, holders, tokens — from the declaration ---
// A stage publishes `held` in StageSlotsDeclared (the rule-9 seed) and grants
// as ViewSlotAssigned; the port caches both and the outline ends with who
// holds what. Here a fake stage speaks the protocol so the cache is pinned
// headless.
const fakeStage = defineSlice({
    type: "test-stage",
    consumes: ["SliceMounted"],
    emits: ["StageSlotsDeclared", "StageTokensDeclared", "ViewSlotAssigned", "ViewSlotDenied"],
    start(context) {
        context.emit("StageTokensDeclared", { tokens: { "neon-pink": "#ff2fd2", "neon-blue": "#00e0ff" } });
        // The seat grammar, spelled as the stage spells it: cells and rungs,
        // the tray, then anchors on built cells — plus one foreign name, so the
        // plain listing is pinned too.
        context.emit("StageSlotsDeclared", {
            slots: ["backdrop", "r1c1", "r1c2", "r2c1", "r2c2", "r2c3", "r3c1", "s2r1c1", "s2r1c2", "s2r2c1", "s3r1c1", "tray-1", "tray-2", "legacy-seat", "r1c1@center", "r2c1@top", "r2c1@br"],
            held: { r1c1: "seated#1", "r2c1@top": "band#4" },
        });
        context.emit("ViewSlotAssigned", {
            sliceId: "seated#2",
            slot: "r2c2",
            geometry: "grid-row: 2; grid-column: 2 / 3;",
            grid: { row: 2, rowEnd: 3, column: 2, columnEnd: 3 },
        });
        context.emit("ViewSlotAssigned", {
            sliceId: "seated#5",
            slot: "legacy-seat",
            geometry: "grid-row: 4; grid-column: 1 / -1;",
            grid: { row: 4, rowEnd: 5, column: 1, columnEnd: -1 },
        });
        context.emit("ViewSlotAssigned", {
            sliceId: "below#6",
            slot: "s2r1c1",
            geometry: "grid-row: 3; grid-column: 1 / 2;",
            grid: { row: 3, rowEnd: 4, column: 1, columnEnd: 2 },
        });
        context.emit("ViewSlotDenied", { sliceId: "late#3", slot: "r2c2", reason: "occupied" });
    },
});
pool.mount(fakeStage, { instanceId: "test-stage#1" });
timeline.advance(4);
const staged = api.outline();
assert(staged.includes("stage (5 seats held | 2 tokens):") &&
    staged.includes("  r1 [c1 <- seated#1 | +c2]") &&
    staged.includes("  r2 [c1 free (@top <- band#4) | c2 <- seated#2 | +c3]") &&
    staged.includes("  +r3") &&
    staged.includes("  s2r1 [c1 <- below#6 | +c2]") &&
    staged.includes("  +s2r2") &&
    staged.includes("  +s3") &&
    staged.includes("  tray [1 free | +2]") &&
    staged.includes("  legacy-seat <- seated#5 [r4 c1/-1]") &&
    staged.includes("  anchors free on any cell: @center @br") &&
    staged.includes("  denied late#3 -> r2c2 (occupied)"), `The outline must end with the stage drawn as rows, got ${JSON.stringify(staged)}.`);
const stageView = api.snapshot().stage;
assert(stageView.held["r2c2"]?.geometry === "grid-row: 2; grid-column: 2 / 3;" &&
    stageView.held["r2c2"]?.grid?.column === 2 &&
    stageView.tokens["neon-pink"] === "#ff2fd2", "snapshot().stage must carry each holder's geometry and the tokens.");
// A holder's unmount frees its seat in the cache, no declaration needed.
pool.mount(defineSlice({ type: "seated", consumes: [], emits: [], start() { } }), { instanceId: "seated#2" });
timeline.advance(2);
pool.unmount("seated#2");
timeline.advance(2);
assert(api.outline().includes("  r2 [c1 free (@top <- band#4) | c2 free | +c3]"), "An unmounted holder must free its seat in the outline.");
// --- A chartered view consumes what its charter names ---
// Ping was a dead letter above (nothing declares it). A wildcard view whose
// charter (ViewConfigDeclared, on the board) names Ping is its consumer, so
// the digest stops calling it dead — the false positive a chartered timeline
// (`*` + stepForward.on) would otherwise cause.
pool.mount(defineSlice({
    type: "test-charter-stage",
    consumes: [],
    emits: ["ViewConfigDeclared"],
    start(context) {
        context.emit("ViewConfigDeclared", { view: "test-view", config: { stepForward: { on: "Ping" } } });
    },
}), { instanceId: "test-charter-stage#1" });
pool.mount(defineSlice({ type: "test-view", consumes: ["*"], emits: [], start() { } }), { instanceId: "test-view#1" });
timeline.advance(2);
const chartered = api.send("EditRequested", { edit: { kind: "insert", text: " " } });
timeline.advance(8);
const charteredDone = await chartered;
assert(!charteredDone.digest.includes("dead letters"), `A type a living view's charter names must not read as a dead letter, got ${JSON.stringify(charteredDone.digest)}.`);
// --- The digest names the cascade, and says which nothing when nothing changed ---
// facts: is the window's own types in order; a no-op names its diagnosis;
// dead letters are emits no living slice consumes.
assert(/^facts: EditRequested x\d+ -> FrameTicked -> BufferChanged/m.test(batchDone.digest), `The digest must open with the cascade's fact types in order, got ${JSON.stringify(batchDone.digest)}.`);
assert(missedDone.digest.includes('no BufferChanged | replace-match missed: "no-such-anchor"'), `A missed find must be named as such, got ${JSON.stringify(missedDone.digest)}.`);
const identical = api.send("EditRequested", {
    edit: { kind: "tags-set", side: "consumes", tags: [...api.snapshot().documents["slice-1"].meta.consumes] },
});
timeline.advance(8);
const identicalDone = await identical;
assert(identicalDone.digest.includes("no BufferChanged | nothing to change (tags-set)"), `A content-identical edit must say nothing to change, got ${JSON.stringify(identicalDone.digest)}.`);
const caretOnly = api.send("EditRequested", { edit: { kind: "caret-move", direction: "line-start" } });
timeline.advance(8);
const caretOnlyDone = await caretOnly;
assert(caretOnlyDone.digest.includes("no BufferChanged | caret only"), `A caret move must digest as caret only, got ${JSON.stringify(caretOnlyDone.digest)}.`);
const ghost = api.send("SliceDeleteRequested", { sliceId: "no-such-slice#9" });
timeline.advance(8);
const ghostDone = await ghost;
assert(ghostDone.digest.includes('SliceDeleteRequested: no such slice or document "no-such-slice#9"'), `A delete of an unknown id must say so, got ${JSON.stringify(ghostDone.digest)}.`);
assert(refusedDone.digest.includes("no BufferChanged | refused (see refused:)") &&
    refusedDone.digest.includes("refused: SliceDeleteRequested on slice-1 (the last document is immortal)"), `A refused delete must say why, got ${JSON.stringify(refusedDone.digest)}.`);
// The seed slice emits Ping, which nothing living consumes: a dead letter.
assert(batchDone.digest.includes("dead letters: Ping (no living consumer)"), `An emit with no living consumer must be named a dead letter, got ${JSON.stringify(batchDone.digest)}.`);
// --- trace takes any handle the port prints; proof assays a document by id ---
const lastIntent = api.trace("last");
assert(lastIntent !== null && lastIntent.fact.type === "SliceDeleteRequested", "trace(\"last\") must resolve to the port's last emitted fact.");
const seq = lastIntent.fact.id.split(":")[1];
assert(api.trace(`intent ${lastIntent.fact.id}`)?.fact.id === lastIntent.fact.id, "trace must accept the digest's `intent frame:seq` form.");
assert(api.trace(seq)?.fact.id === lastIntent.fact.id, "trace must accept the bare sequence.");
assert(api.trace("999999:1") === null, "trace of an unknown handle must return null, not throw.");
const assayed = api.proof({ fileId: "slice-1" });
timeline.advance(8);
const assayedDone = await assayed;
// No proofing-house lives in this pool (report is null); the request itself
// must carry the document as it stands.
const assayRequest = assayedDone.facts.find((fact) => fact.type === "ProofRequested");
assert(assayRequest !== undefined &&
    assayRequest.payload.meta.type === "slice-1" &&
    assayRequest.payload.lines.join("\n") === api.snapshot().documents["slice-1"].lines.join("\n"), `proof({ fileId }) must assay the document as it stands, got ${JSON.stringify(assayRequest?.payload)}.`);
let proofThrew = false;
try {
    await api.proof({ fileId: "no-such-doc" });
}
catch {
    proofThrew = true;
}
assert(proofThrew, "proof of an unknown document must say so.");
// --- The ramp: the operator's manual is readable through the port ---
// The semantics a harness once mined from source (time, undo, the foundry's
// adoption law) travel as GuideDeclared facts, served by the snapshot.
const guide = api.snapshot().guide;
assert(guide !== null, "The guide must be declared and cached.");
const topicIds = guide.topics.map((topic) => topic.id);
for (const wanted of [
    "transport",
    "time",
    "edits",
    "undo",
    "documents",
    "foundry",
    "vocabulary",
    "persistence",
]) {
    assert(topicIds.includes(wanted), `The guide must carry the ${wanted} page.`);
}
const foundryPage = guide.topics.find((topic) => topic.id === "foundry");
assert(foundryPage !== undefined && foundryPage.body.includes("no exceptions"), "The foundry page must say that every slice adopts — there is no kernel list.");
// --- The law is discoverable, and breaking it is a verdict, not a throw ---
// The firewall is the only validator: the port pre-checks nothing beyond
// its own emits list, so a malformed payload is delivered, flagged, and
// returned to the harness in the settled cascade's violations.
const law = api.snapshot().schemas;
assert(law !== null && law.types.includes("EditRequested"), "The declared law must be readable through the port.");
assert(law.shapes["EditRequested"] !== undefined, "Payload shapes must travel as data, discoverable by the harness.");
const malformed = api.send("EditRequested", { edit: { kind: "bogus" } });
timeline.advance(6);
const flagged = await malformed;
assert(flagged.digest.includes("no BufferChanged | malformed intent (see violations)"), `A malformed intent must be diagnosed as such, got ${JSON.stringify(flagged.digest)}.`);
assert(flagged.violations.some((fact) => fact.payload.reason === "invalid-payload"), "A malformed intent must come back as a ContractViolated verdict.");
console.log("agent-port: the machine author's loop holds.");
