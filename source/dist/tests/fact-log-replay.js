import { factLogFor, firewall, Pool, } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { clock } from "../slices/clock.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { schemaBook } from "../slices/schema-book.js";
const defineSlice = sliceDefinerFor();
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The reload, as an executable assertion ---
// Session one types, scrubs back, and branches; session two is a fresh pool
// that shares nothing but the stored journal. The fact-log replays the
// journal through the pool and every state owner rebuilds itself — the
// branch, the caret, and the undo history all survive the "reload".
const memoryStorage = () => {
    let text = null;
    return {
        load: () => text,
        save: (next) => {
            text = next;
        },
        clear: () => {
            text = null;
        },
    };
};
const storage = memoryStorage();
const factLog = () => factLogFor({
    record: [
        "EditRequested",
        "SliceSelected",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
    ],
    markers: ["BufferChanged", "CaretMoved", "BufferRestored", "SliceSaved"],
    storageKey: "test",
    version: "2",
    announceAs: "WorkspaceReplayed",
    storage,
    saveMode: "immediate",
});
const typist = (text) => defineSlice({
    type: "test-typist",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", { edit: { kind: "insert", text }, priority: 10 });
    },
});
// The workspace boots empty: ADD opens the first document (slice-1, revision
// 1), and that intent is journaled like any other.
const adder = defineSlice({
    type: "test-adder",
    consumes: [],
    emits: ["SliceCreateRequested"],
    start(context) {
        context.emit("SliceCreateRequested", {});
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
// --- Session one: an empty journal records live inputs ---
const first = new Pool({ onHandlerError: (error) => { throw error; } });
const one = trackFrames(first);
first.mount(firewall, { instanceId: "firewall#1" });
first.mount(schemaBook, { instanceId: "schema-book#1" });
first.mount(clock, { instanceId: "clock#1" });
first.mount(editorBuffer, { instanceId: "editor-buffer#1" });
first.mount(factLog(), { instanceId: "fact-log#1" });
const emptyReplay = one.advanceUntil("WorkspaceReplayed");
assert(emptyReplay.payload.entries === 0, "A first boot must announce an empty journal.");
first.mount(adder, { instanceId: "test-adder#1" });
one.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 1 });
first.mount(typist("A"), { instanceId: "test-typist#1" });
const afterA = one.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 2,
});
first.mount(typist("B"), { instanceId: "test-typist#2" });
one.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 3 });
// Undo travels as a scrub; typing afterwards branches from the restored text.
first.mount(scrubber(afterA.frame), { instanceId: "test-scrubber#1" });
one.advanceUntil("BufferRestored", {
    where: (fact) => fact.payload.lines[0] === afterA.payload.lines[0],
});
first.mount(typist("C"), { instanceId: "test-typist#3" });
const finalOne = one.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.revision === 4,
});
assert(finalOne.payload.lines[0].startsWith("AC"), `Session one must end on the branch, got: ${finalOne.payload.lines[0]}.`);
assert(storage.load() !== null, "The journal must have been persisted.");
// --- Session two: a fresh pool replays the journal on boot ---
const second = new Pool({ onHandlerError: (error) => { throw error; } });
const two = trackFrames(second);
second.mount(firewall, { instanceId: "firewall#1" });
second.mount(schemaBook, { instanceId: "schema-book#1" });
second.mount(clock, { instanceId: "clock#1" });
second.mount(editorBuffer, { instanceId: "editor-buffer#1" });
second.mount(factLog(), { instanceId: "fact-log#1" });
const replayed = two.advanceUntil("WorkspaceReplayed", { maxFrames: 64 });
assert(replayed.payload.entries === 5, `The journal must carry ADD, A, B, the scrub, and C — got ${replayed.payload.entries}.`);
const restoredFinal = two.delivered("BufferChanged").at(-1);
if (restoredFinal === undefined)
    throw new Error("Replay must re-publish the document.");
assert(restoredFinal.payload.lines.join("\n") === finalOne.payload.lines.join("\n"), "Replay must end on session one's exact final document, branch included.");
assert(restoredFinal.payload.caret.line === finalOne.payload.caret.line &&
    restoredFinal.payload.caret.column === finalOne.payload.caret.column, "Replay must restore the caret, not just the text.");
assert(restoredFinal.payload.revision === finalOne.payload.revision, "Replay must walk the same revision history, not just reach the same text.");
// The undo history is rebuilt too: scrubbing the new session to its own
// revision-2 frame restores what session one's revision 2 said.
const replayedA = two.delivered("BufferChanged", (fact) => fact.payload.revision === 2)[0];
assert(replayedA !== undefined, "Replay must re-publish every revision.");
second.mount(scrubber(replayedA.frame), { instanceId: "test-scrubber#1" });
two.advanceUntil("BufferRestored", {
    where: (fact) => fact.payload.lines[0] === afterA.payload.lines[0],
});
// And the journal keeps growing: the new session's inputs append after the
// replayed ones, so the next boot replays both sessions as one history.
second.mount(typist("D"), { instanceId: "test-typist#1" });
two.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 5 });
const third = new Pool({ onHandlerError: (error) => { throw error; } });
const three = trackFrames(third);
third.mount(firewall, { instanceId: "firewall#1" });
third.mount(schemaBook, { instanceId: "schema-book#1" });
third.mount(clock, { instanceId: "clock#1" });
third.mount(editorBuffer, { instanceId: "editor-buffer#1" });
third.mount(factLog(), { instanceId: "fact-log#1" });
const secondReplay = three.advanceUntil("WorkspaceReplayed", { maxFrames: 96 });
assert(secondReplay.payload.entries === 7, `The journal must have grown across sessions, got ${secondReplay.payload.entries}.`);
const finalThree = three.delivered("BufferChanged").at(-1);
assert(finalThree !== undefined && finalThree.payload.lines[0].startsWith("AD"), `The third boot must replay both sessions, got: ${finalThree?.payload.lines[0]}.`);
one.expectNone("ContractViolated", "Recording must not violate any contract");
two.expectNone("ContractViolated", "Replay must not violate any contract");
three.expectNone("ContractViolated", "Chained replay must not violate any contract");
console.log("Fact-log journal, boot replay, branch fidelity, caret, undo-history, and cross-session append tests passed.");
