import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { clock } from "../slices/clock.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { factLog } from "../slices/fact-log.js";
import { schemaBook } from "../slices/schema-book.js";
const defineSlice = sliceDefinerFor();
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- REWIND and the crash-loop guard, as executable assertions ---
// The journal is the workspace; a brick is an input in it. REWIND
// (WorkspaceRewindRequested, the tray's button) drops the tail back through
// the last input that changed a document and everything journaled after it,
// then reboots; the boot after it announces WorkspaceRewound. The guard does
// the same on its own when a boot finds the previous replay's stamp still
// standing — the last replay never finished, so the same tail would strand
// every reload. Under node there is no page to reboot: each "session" is a
// fresh pool over the same fake localStorage, and the assertions are what
// the journal holds and what the next boot announces.
const STORAGE_KEY = "slice-ide|fact-log";
const REPLAYING_KEY = "slice-ide|fact-log|replaying";
const store = new Map();
const fakeStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
};
globalThis.window = {
    localStorage: fakeStorage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
};
const journal = () => {
    const text = store.get(STORAGE_KEY);
    if (text === undefined)
        return [];
    return JSON.parse(text).entries;
};
const typist = (text) => defineSlice({
    type: "test-typist",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", { edit: { kind: "insert", text }, priority: 10 });
    },
});
const pinner = (text) => defineSlice({
    type: "test-pinner",
    consumes: [],
    emits: ["ThreadPinRequested"],
    start(context) {
        context.emit("ThreadPinRequested", { text });
    },
});
// The workspace boots empty: ADD opens the first document (revision 1) —
// itself a document-changing input the journal records.
const adder = defineSlice({
    type: "test-adder",
    consumes: [],
    emits: ["SliceCreateRequested"],
    start(context) {
        context.emit("SliceCreateRequested", {});
    },
});
const rewinder = defineSlice({
    type: "test-rewinder",
    consumes: [],
    emits: ["WorkspaceRewindRequested"],
    start(context) {
        context.emit("WorkspaceRewindRequested", {});
    },
});
const boot = () => {
    const pool = new Pool({ onHandlerError: (error) => { throw error; } });
    const timeline = trackFrames(pool);
    pool.mount(firewall, { instanceId: "firewall#1" });
    pool.mount(schemaBook, { instanceId: "schema-book#1" });
    pool.mount(clock, { instanceId: "clock#1" });
    pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
    pool.mount(factLog, { instanceId: "fact-log#1" });
    return { pool, timeline };
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
// --- Session one: A, B, a pin — then REWIND ---
const one = boot();
one.timeline.advanceUntil("WorkspaceReplayed");
one.pool.mount(adder, { instanceId: "test-adder#1" });
one.timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 1 });
one.pool.mount(typist("A"), { instanceId: "test-typist#1" });
one.timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 2 });
one.pool.mount(typist("B"), { instanceId: "test-typist#2" });
one.timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 3 });
one.pool.mount(pinner("fix the thing"), { instanceId: "test-pinner#1" });
one.timeline.advanceUntil("ThreadPinRequested");
await settle();
assert(journal().length === 4, `The journal must hold ADD, A, B and the pin, got ${journal().length}.`);
one.pool.mount(rewinder, { instanceId: "test-rewinder#1" });
const rewound = one.timeline.advanceUntil("WorkspaceRewound", { maxFrames: 8 });
assert(rewound.payload.reason === "requested" && rewound.payload.dropped === 2 && rewound.payload.remaining === 2, `REWIND must drop the tail back through the last document-changing input (B and the pin), got ${JSON.stringify(rewound.payload)}.`);
assert(journal().length === 2 && journal()[1].type === "EditRequested", "The stored journal must be trimmed at once, no debounce.");
one.timeline.expectNone("ContractViolated", "The rewind facts must pass the firewall");
// --- Session two: the boot after the rewind announces it, and replays what is left ---
const two = boot();
const announced = two.timeline.advanceUntil("WorkspaceRewound", { maxFrames: 8 });
assert(announced.payload.reason === "requested" && announced.payload.dropped === 2, "The boot after a REWIND must announce what went (from the stamp the rewind left).");
const replayed = two.timeline.advanceUntil("WorkspaceReplayed", { maxFrames: 32 });
assert(replayed.payload.entries === 2, `Only ADD and A must replay, got ${replayed.payload.entries}.`);
const doc = two.timeline.delivered("BufferChanged").at(-1);
assert(doc !== undefined && doc.payload.lines[0] === "A", `The workspace must stand as before B, got ${JSON.stringify(doc?.payload.lines)}.`);
assert(!store.has(REPLAYING_KEY), "A finished replay must clear its stamp.");
two.timeline.expectNone("ContractViolated", "The announcement must pass the firewall");
// --- Session three: a stranded replay stamp from another load trips the guard ---
store.set(REPLAYING_KEY, "some-other-load");
const three = boot();
const guarded = three.timeline.advanceUntil("WorkspaceRewound", { maxFrames: 8 });
assert(guarded.payload.reason === "crash-loop" && guarded.payload.dropped === 1 && guarded.payload.remaining === 1, `The guard must trim the last input once and say so, got ${JSON.stringify(guarded.payload)}.`);
const trimmed = three.timeline.advanceUntil("WorkspaceReplayed", { maxFrames: 32 });
assert(trimmed.payload.entries === 1, "After the guard, only the ADD is left to replay.");
assert(!store.has(REPLAYING_KEY), "The guard must clear the stranded stamp.");
assert(journal().length === 1, "The guard must persist the trimmed journal.");
// --- A stamp from THIS load is a hot reload's, not a stranding ---
const loadId = String(performance.timeOrigin);
store.set(STORAGE_KEY, JSON.stringify({
    v: "7",
    entries: [
        { group: 0, type: "SliceCreateRequested", payload: {} },
        { group: 1, type: "EditRequested", payload: { edit: { kind: "insert", text: "Z" }, priority: 10 } },
    ],
}));
store.set(REPLAYING_KEY, loadId);
const four = boot();
four.timeline.advanceUntil("WorkspaceReplayed", { maxFrames: 32 });
assert(four.timeline.delivered("WorkspaceRewound").length === 0, "A stamp from this load must not trip the guard.");
assert(journal().length === 2, "The journal must be untouched by a same-load stamp.");
console.log("rewind: REWIND trims the journal's tail through the last document-changing input and the next boot announces it; a stranded replay stamp trims once as crash-loop; a same-load stamp is left alone.");
