import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { agentPort } from "../slices/agent-port.js";
import { clock } from "../slices/clock.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { schemaBook } from "../slices/schema-book.js";
import { thread } from "../slices/thread.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The thread: one sentence, and the trail of what happened under it ---
// Pin it, edit under it, wander away from it, go back in time, mark it done:
// every step is derived from facts already on the board and comes back as
// ThreadDeclared — the same fact the header, the port and the mind read.
const defineSlice = sliceDefinerFor();
const speaker = (type, payload) => defineSlice({
    type: `test-${type.toLowerCase()}`,
    consumes: [],
    emits: [type],
    start(context) {
        context.emit(type, payload);
    },
});
const pool = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(clock, { instanceId: "clock#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(thread, { instanceId: "thread#1" });
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
const seed = timeline.advanceUntil("BufferChanged");
const seedId = seed.payload.fileId;
const latest = () => {
    const all = timeline.delivered("ThreadDeclared");
    return all[all.length - 1].payload;
};
// --- Boot: the thread declares empty, for whoever is listening (rule 9) ---
timeline.advance(2);
assert(latest().text === "" && latest().since === -1, "An unpinned thread declares empty.");
// --- Pin: the sentence, the frame, and the subject it names ---
let n = 0;
const say = (type, payload) => {
    n += 1;
    pool.mount(speaker(type, payload), { instanceId: `say#${n}` });
    // mount frame, then intent -> tick -> BufferChanged -> ThreadDeclared.
    timeline.advance(5);
};
say("ThreadPinRequested", { text: `  make ${seedId}   count blank lines ` });
const pinned = latest();
assert(pinned.text === `make ${seedId} count blank lines`, `The pinned text is normalised: ${pinned.text}`);
assert(pinned.since > 0, "The pin remembers its frame.");
assert(pinned.subject.length === 1 && pinned.subject[0] === seedId, "The subject is the document the sentence names.");
assert(pinned.trail.length === 1 && pinned.trail[0].kind === "pin", "The first step of the trail is the pin itself.");
assert(pinned.away === 0, "Nothing has drifted yet.");
// --- Edits under the thread coalesce into one step; the subject is not away ---
for (let i = 0; i < 3; i += 1) {
    say("EditRequested", { edit: { kind: "insert", text: "x" }, priority: 10 });
}
const edited = latest();
const editSteps = edited.trail.filter((step) => step.kind === "edit");
assert(editSteps.length === 1, `Three edits to one document are one step, got ${editSteps.length}.`);
assert(editSteps[0].times === 3 && editSteps[0].note === seedId, `The step counts the edits it swallowed: ${JSON.stringify(edited.trail)}`);
assert(edited.away === 0, "Editing the subject is not wandering.");
// --- Wander: a new document appears and takes edits; away counts them ---
say("SliceCreateRequested", {});
const created = latest();
assert(created.trail.some((step) => step.kind === "create"), "A new document is a step.");
const otherId = created.trail.filter((step) => step.kind === "create").pop()?.note;
assert(otherId !== undefined && otherId !== seedId, "The created document is named.");
say("EditRequested", { edit: { kind: "insert", text: "y" }, priority: 10 });
say("EditRequested", { edit: { kind: "insert", text: "z" }, priority: 10 });
const wandered = latest();
assert(wandered.away === 2, `Two edits outside the subject are two away, got ${wandered.away}.`);
assert(wandered.trail[wandered.trail.length - 1].kind === "edit" && wandered.trail[wandered.trail.length - 1].note === otherId, "The trail's last step names where the edits went.");
assert(wandered.subject.length === 1 && wandered.subject[0] === seedId, "The subject is unchanged by wandering.");
// --- Time travel is a step too (and satisfies the staleness law) ---
say("TimelineScrubbed", { frameNumber: pinned.since });
const back = latest();
assert(back.trail[back.trail.length - 1].kind === "back", "A scrub is a step in the trail.");
assert(back.text === pinned.text, "Time travel does not unpin the thread — the thread is about the trip.");
// --- The port reads the same fact: outline first line after the header, snapshot carries the trail ---
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API.");
const outline = api.outline();
assert(outline.split("\n")[1].startsWith(`thread: ${pinned.text}`), `The outline prints the thread first: ${outline.split("\n")[1]}`);
assert(api.snapshot().thread.trail.length === back.trail.length, "snapshot().thread carries the trail.");
// --- Re-pin keeps the trail; DONE lets it all go ---
say("ThreadPinRequested", { text: `now ${otherId}` });
const repinned = latest();
assert(repinned.since === pinned.since, "A re-pin keeps the original frame — the thread evolved.");
assert(repinned.trail.length === back.trail.length + 1, "A re-pin adds a step and keeps the trail.");
assert(repinned.subject[0] === otherId, "The subject follows the sentence.");
say("ThreadPinRequested", { text: "" });
const done = latest();
assert(done.text === "" && done.since === -1 && done.trail.length === 0 && done.away === 0, "DONE clears the thread and its trail.");
assert(api.outline().split("\n")[1] === "thread: none pinned", "The outline says so.");
// --- Late joiner: a new consumer gets the thread as it stands (rule 9) ---
say("ThreadPinRequested", { text: "again" });
const before = timeline.delivered("ThreadDeclared").length;
pool.mount(defineSlice({
    type: "test-listener",
    consumes: ["ThreadDeclared"],
    emits: [],
    start() { },
}), { instanceId: "listener#1" });
timeline.advance(3);
assert(timeline.delivered("ThreadDeclared").length > before, "A late joiner is answered.");
assert(latest().text === "again", "…with the current thread.");
timeline.expectNone("ContractViolated", "Every thread fact must pass the firewall clean.");
console.log("thread: the sentence pins, the trail follows, wandering counts, DONE lets go.");
