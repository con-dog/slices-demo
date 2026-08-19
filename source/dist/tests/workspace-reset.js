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
// --- RESET, as an executable assertion ---
// The app's own fact-log keeps its journal in window.localStorage and honours
// WorkspaceResetRequested — the tray's RESET button — by discarding it and
// rebooting the page. Under node there is no page to reboot, so the assertion
// is the discard: the storage entry goes, and nothing this instance records
// afterwards resurrects it (the debounced save and the pagehide flush both
// stay silent). Nothing is read from the URL: no location exists here at all.
const STORAGE_KEY = "slice-ide|fact-log";
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
const typist = (text) => defineSlice({
    type: "test-typist",
    consumes: [],
    emits: ["EditRequested"],
    start(context) {
        context.emit("EditRequested", { edit: { kind: "insert", text }, priority: 10 });
    },
});
// The workspace boots empty: ADD opens the first document (revision 1).
const adder = defineSlice({
    type: "test-adder",
    consumes: [],
    emits: ["SliceCreateRequested"],
    start(context) {
        context.emit("SliceCreateRequested", {});
    },
});
const resetter = defineSlice({
    type: "test-resetter",
    consumes: [],
    emits: ["WorkspaceResetRequested"],
    start(context) {
        context.emit("WorkspaceResetRequested", {});
    },
});
const pool = new Pool({ onHandlerError: (error) => { throw error; } });
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(clock, { instanceId: "clock#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(factLog, { instanceId: "fact-log#1" });
timeline.advanceUntil("WorkspaceReplayed");
pool.mount(adder, { instanceId: "test-adder#1" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 1 });
// A recorded edit lands in storage once the debounce fires.
pool.mount(typist("A"), { instanceId: "test-typist#1" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 2 });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(store.has(STORAGE_KEY), "The journal must have been persisted before the reset.");
// RESET: the entry goes, and stays gone.
pool.mount(resetter, { instanceId: "test-resetter#1" });
timeline.advanceUntil("WorkspaceResetRequested");
timeline.advance(2);
assert(!store.has(STORAGE_KEY), "WorkspaceResetRequested must discard the journal.");
assert(timeline.delivered("ContractViolated").length === 0, "The reset intent must pass the firewall.");
pool.mount(typist("B"), { instanceId: "test-typist#2" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 3 });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(!store.has(STORAGE_KEY), "A reset fact-log must never write the journal again (the page reboots).");
// --- A wipe from outside (DevTools, another tab's RESET) is a reset too ---
// A fresh instance persists, the store is cleared underneath it, and its
// next flush — the debounce, or the pagehide flush on the way out — must
// not write the journal back: that is exactly how a cleared workspace used
// to resurrect on reload.
const second = new Pool({ onHandlerError: (error) => { throw error; } });
const two = trackFrames(second);
second.mount(firewall, { instanceId: "firewall#1" });
second.mount(schemaBook, { instanceId: "schema-book#1" });
second.mount(clock, { instanceId: "clock#1" });
second.mount(editorBuffer, { instanceId: "editor-buffer#1" });
second.mount(factLog, { instanceId: "fact-log#1" });
two.advanceUntil("WorkspaceReplayed");
second.mount(adder, { instanceId: "test-adder#1" });
two.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 1 });
second.mount(typist("C"), { instanceId: "test-typist#1" });
two.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 2 });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(store.has(STORAGE_KEY), "The second instance must have persisted before the wipe.");
store.delete(STORAGE_KEY);
second.mount(typist("D"), { instanceId: "test-typist#2" });
two.advanceUntil("BufferChanged", { where: (fact) => fact.payload.revision === 3 });
await new Promise((resolve) => setTimeout(resolve, 300));
assert(!store.has(STORAGE_KEY), "A journal wiped from outside must stay wiped — the flush must not resurrect it.");
console.log("workspace-reset: RESET discards the journal as a fact, an outside wipe is honoured, and nothing resurrects either.");
