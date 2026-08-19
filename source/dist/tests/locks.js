import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { agentPort } from "../slices/agent-port.js";
import { clock } from "../slices/clock.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { foundry } from "../slices/foundry.js";
import { lockBook } from "../slices/lock-book.js";
import { schemaBook } from "../slices/schema-book.js";
import { syntaxOracle } from "../slices/syntax-oracle.js";
const defineSlice = sliceDefinerFor();
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The locks: a rank on a document, not a kernel list ---
// Intents carry a priority (the keyboard's 10, a machine's 1) and the
// lock-book's ledger says which documents refuse below which rank. The
// buffer refuses edits, renames INTO a locked name, copies and deletes below
// the bar and says so (IntentRefused); the foundry leaves such deletes and
// copies alone, and does not adopt a compiled slice on the open a machine's
// `edit { fileId }` sends ahead of an edit that will bounce. A human's press
// at 10 passes, and a human's LOCK|UNLOCK is a journaled intent any hand of
// rank may speak — but the port stamps 1, so a harness cannot unlock what a
// human locked, exactly as it cannot outrank a keystroke.
const pool = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(lockBook, { instanceId: "lock-book#1" });
pool.mount(clock, { instanceId: "clock#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(syntaxOracle, { instanceId: "syntax-oracle#1" });
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
timeline.advanceUntil("BufferChanged");
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API to the global host.");
const livingOf = (type) => Object.keys(api.snapshot().slices).filter((id) => id.startsWith(`${type}#`));
// A hand of rank: the toolbar's presses and the keyboard's keystrokes, at 10.
const HUMAN = 10;
let handSerial = 0;
const hand = (type, payload) => {
    handSerial += 1;
    pool.mount(defineSlice({
        type: "test-hand",
        consumes: [],
        emits: [type],
        start(context) {
            context.emit(type, payload);
        },
    }), { instanceId: `test-hand#${handSerial}` });
};
// --- The ledger seeds from what the mounts declare, and the port sees it ---
// No list anywhere: the clock's definition says `lock: 10`, the pool stamps
// it into clock#1's SliceMounted, and the book aggregates. The boot burst
// lands after the book's first declaration, so the complete ledger is the
// echo one frame later — never a partial one left standing.
const declared = timeline.delivered("SliceLocksDeclared").at(-1);
assert(declared !== undefined, "The lock-book must declare its ledger at boot (rule 9).");
assert(timeline.delivered("SliceMounted").some((fact) => fact.payload.sliceId === "clock#1" && fact.payload.lock === 10), "The clock's own rank must ride its mount fact.");
assert(declared.payload.locks.clock === 10, "The clock must be locked to the human's rank by default.");
assert(declared.payload.locks.foundry === 10 && declared.payload.locks.firewall === 10, "Every self-declared rank in the burst must be in the published ledger.");
assert(declared.payload.locks["syntax-oracle"] === undefined, "An oracle is not load-bearing: unlocked by default.");
assert(api.snapshot().locks.clock === 10, "snapshot().locks must carry the ledger.");
assert(api.outline().includes("clock#1") && api.outline().includes("locked >=10"), "The outline must mark locked slices.");
// --- A machine's edit of a locked document is refused, and the open adopts nothing ---
api.emit("SliceSelected", { sliceId: "clock#1" });
api.emit("EditRequested", { edit: { kind: "insert", text: "// machine\n" } });
const refusedEdit = timeline.advanceUntil("IntentRefused", { maxFrames: 12 });
assert(refusedEdit.payload.intent === "EditRequested" &&
    refusedEdit.payload.fileId === "clock" &&
    refusedEdit.payload.reason === "locked" &&
    refusedEdit.payload.priority === 1 &&
    refusedEdit.payload.minPriority === 10, `The buffer must refuse the machine's edit with the bar it fell below, got ${JSON.stringify(refusedEdit.payload)}.`);
timeline.advance(4);
const clockDoc = api.snapshot().documents.clock;
assert(clockDoc !== undefined && !clockDoc.lines.join("\n").includes("// machine"), "The refused edit must not land.");
assert(livingOf("clock").length === 1 && livingOf("clock")[0] === "clock#1", "A refused edit must not adopt the clock on its open.");
const digest = api.digest();
assert(digest.includes("refused: EditRequested on clock (locked: needs priority >= 10, got 1"), `The digest must print the refusal, got:\n${digest}`);
// --- The port cannot unlock what the human's rank locked ---
api.emit("SliceLockRequested", { sliceId: "clock#1", minPriority: 0, priority: 10 });
const refusedUnlock = timeline.advanceUntil("IntentRefused", { maxFrames: 8 });
assert(refusedUnlock.payload.intent === "SliceLockRequested" && refusedUnlock.payload.priority === 1, "The port must stamp lock requests at machine rank, and the lock-book must refuse them below the bar.");
assert(api.snapshot().locks.clock === 10, "A refused unlock must leave the lock standing.");
// --- Delete and duplicate below the bar: the buffer refuses, the foundry stays its hand ---
api.emit("SliceDeleteRequested", { sliceId: "clock#1", priority: 10 });
const refusedDelete = timeline.advanceUntil("IntentRefused", { maxFrames: 8 });
assert(refusedDelete.payload.intent === "SliceDeleteRequested" && refusedDelete.payload.priority === 1, "The port must stamp deletes at machine rank.");
timeline.advance(3);
assert(livingOf("clock").length === 1, "A refused delete must leave the instance running.");
assert(api.snapshot().documents.clock !== undefined, "A refused delete must leave the document.");
api.emit("SliceDuplicateRequested", { sliceId: "clock#1" });
const refusedCopy = timeline.advanceUntil("IntentRefused", { maxFrames: 8 });
assert(refusedCopy.payload.intent === "SliceDuplicateRequested", "A copy of a locked type must be refused below the bar.");
timeline.advance(3);
assert(api.snapshot().documents["clock-copy"] === undefined, "A refused copy must not create a document.");
// --- A rename INTO a locked name is refused too (it would hand the type to the foundry) ---
api.emit("SliceSelected", { sliceId: "syntax-oracle#1" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.fileId === "syntax-oracle" });
// (The foundry is mounted here and declares its rank; a lock is a living
// slice's own word on the board, so a type nobody mounted has none.)
api.emit("EditRequested", { edit: { kind: "meta-set", field: "type", value: "foundry" } });
const refusedRename = timeline.advanceUntil("IntentRefused", { maxFrames: 8 });
assert(refusedRename.payload.intent === "EditRequested" && refusedRename.payload.minPriority === 10, "Renaming into a locked name must be refused with that name's bar.");
timeline.advance(3);
assert(api.snapshot().documents.foundry === undefined, "The refused rename must not mint the locked name.");
// --- The human's rank passes: an edit at 10 lands and adopts ---
hand("EditRequested", { edit: { kind: "insert", text: "// human\n" }, priority: HUMAN });
const humanAdopted = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "syntax-oracle",
    maxFrames: 12,
});
assert(humanAdopted.payload.sliceId === "syntax-oracle#2", "A human's edit must adopt the unlocked oracle.");
// --- LOCK at 10, then the machine bounces; UNLOCK, then it lands ---
hand("SliceLockRequested", { sliceId: "syntax-oracle#2", minPriority: HUMAN, priority: HUMAN });
const locked = timeline.advanceUntil("SliceLocksDeclared", {
    where: (fact) => fact.payload.locks["syntax-oracle"] === 10,
    maxFrames: 8,
});
assert(locked !== undefined, "A hand of rank must be able to lock a slice.");
timeline.advance(2);
api.emit("EditRequested", { edit: { kind: "insert", text: "// machine again\n" } });
const bounced = timeline.advanceUntil("IntentRefused", { maxFrames: 8 });
assert(bounced.payload.fileId === "syntax-oracle", "The freshly locked oracle must refuse the machine.");
hand("SliceLockRequested", { sliceId: "syntax-oracle#2", minPriority: 0, priority: HUMAN });
timeline.advanceUntil("SliceLocksDeclared", {
    where: (fact) => fact.payload.locks["syntax-oracle"] === undefined,
    maxFrames: 8,
});
timeline.advance(2);
api.emit("EditRequested", { edit: { kind: "insert", text: "// machine lands\n" } });
const landed = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "syntax-oracle" && fact.payload.lines.join("\n").includes("// machine lands"),
    maxFrames: 12,
});
assert(landed !== undefined, "Once unlocked, the machine's edit must land.");
// --- The lock ledger is a state fact: a late joiner hears it ---
const listener = defineSlice({
    type: "test-listener",
    consumes: ["SliceLocksDeclared"],
    emits: [],
    start(context) {
        context.subscribe("SliceLocksDeclared", () => undefined);
    },
});
const beforeJoin = timeline.delivered("SliceLocksDeclared").length;
pool.mount(listener, { instanceId: "test-listener#1" });
timeline.advance(3);
assert(timeline.delivered("SliceLocksDeclared").length > beforeJoin, "The lock-book must re-declare for a late joiner (rule 9).");
timeline.expectNone("ContractViolated", "Every lock fact must pass the firewall");
console.log("locks: the ledger seeds from each load-bearing slice's own declared rank; machine edits, copies, deletes, unlocks and renames-into bounce with IntentRefused; the human's rank passes and LOCK|UNLOCK is its hand.");
