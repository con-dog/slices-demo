import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { agentPort } from "../slices/agent-port.js";
import { clock } from "../slices/clock.js";
import { completionOracle } from "../slices/completion-oracle.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { foundry } from "../slices/foundry.js";
import { ruleBook } from "../slices/rule-book.js";
import { schemaBook } from "../slices/schema-book.js";
import { syntaxOracle } from "../slices/syntax-oracle.js";
const defineSlice = sliceDefinerFor();
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- Adoption: the first edit of a compiled slice hands it to the foundry ---
// Every mounted slice opens as its real running source (SliceMounted carries
// startSource); editing one mounts the document's build and retires the boot
// instance once the build has landed — the IDE eats itself, and nothing is
// exempt: the buffer hands its whole workspace to its successor, the foundry
// adopts itself and keeps its lineage, a build that dies at start is thrown
// back and the predecessor kept. Time travel across an adoption point
// restores the original body, because the document and the boot code are the
// same text by construction. Driven through the agent port, as an LLM would.
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
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(ruleBook, { instanceId: "rule-book#1" });
pool.mount(completionOracle, { instanceId: "completion-oracle#1" });
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
// --- Opening a compiled slice shows its real running body, and saves nothing ---
api.emit("SliceSelected", { sliceId: "syntax-oracle#1" });
const opened = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "syntax-oracle",
});
assert(opened.payload.lines.join("\n").includes("tokenize"), "A compiled slice's document must carry its running start body.");
assert(timeline.delivered("SliceMounted", (fact) => fact.payload.sliceType === "syntax-oracle")
    .length === 1, "A navigation open must not mount a shadow copy.");
const preAdoptionFrame = pool.getFrameNumber();
// --- The first edit adopts: boot instance retired, document build mounted ---
api.emit("EditRequested", {
    edit: {
        kind: "insert",
        text: 'context.emit("TokensMapped", { revision: -1, lineTokens: [] });\n',
    },
});
const adopted = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "syntax-oracle",
});
assert(adopted.payload.sliceId === "syntax-oracle#2", `Adoption must mount the document's build, got ${adopted.payload.sliceId}.`);
assert(adopted.payload.startSource.length > 0, "The adopted mount must carry its own source in turn.");
// The successor mounts first; the boot instance retires when the successor's
// SliceMounted lands — one frame of overlap, in which state hands off.
assert(timeline.delivered("SliceUnmounted", (fact) => fact.payload.sliceId === "syntax-oracle#1")
    .length === 0, "The boot instance must outlive the successor's mount by a frame.");
// The adopted build runs: the edit's marker line fires at activation, and
// the original tokenizer beneath it still answers the buffer (resynced as a
// late joiner via the rule-9 BufferRestored re-publication). The boot
// instance's SliceUnmounted lands in that same frame.
timeline.advanceUntil("TokensMapped", {
    where: (fact) => fact.payload.revision === -1,
});
assert(timeline.delivered("SliceUnmounted", (fact) => fact.payload.sliceId === "syntax-oracle#1")
    .length === 1, "Adoption must retire the boot instance once the successor has landed.");
timeline.advanceUntil("TokensMapped", {
    where: (fact) => fact.payload.revision === opened.payload.revision + 1 &&
        fact.payload.lineTokens.some((line) => line.length > 0),
});
timeline.expectNone("ContractViolated", "Adoption must not breach any contract");
// --- Time travel across the adoption point restores the original body ---
// (Done before the buffer itself is adopted, below: undo history does not
// cross a hot reload of the buffer — a successor's ring starts at the hand-off.)
const scrubber = defineSlice({
    type: "test-scrubber",
    consumes: [],
    emits: ["TimelineScrubbed"],
    start(context) {
        context.emit("TimelineScrubbed", { frameNumber: preAdoptionFrame });
    },
});
pool.mount(scrubber, { instanceId: "test-scrubber#1" });
const restored = timeline.advanceUntil("BufferRestored", {
    where: (fact) => fact.payload.fileId === "syntax-oracle",
});
assert(!restored.payload.lines[0].includes("revision: -1"), "The restored document must be the pre-adoption body.");
timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "syntax-oracle" &&
        fact.sourceSlice === "pool" &&
        !fact.payload.startSource.includes("revision: -1"),
});
timeline.advance(3);
const afterScrub = Object.keys(api.snapshot().slices).filter((id) => id.startsWith("syntax-oracle#"));
assert(afterScrub.length === 1 && afterScrub[0] !== "syntax-oracle#1", `The scrub must re-save the adopted instance, never resurrect the boot one; living: ${afterScrub.join(",")}.`);
// --- The buffer adopts: its successor inherits every document ---
// The predecessor buffer, hearing a newcomer of its own type mount, re-publishes
// the whole workspace (rule 9); the successor seeds from those facts instead of
// a skeleton, and typing carries on through it — no document lost, the
// revision counter unbroken.
api.emit("SliceSelected", { sliceId: "editor-buffer#1" });
const bufferDoc = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "editor-buffer",
});
assert(bufferDoc.payload.lines.join("\n").includes("snapshotRing"), "The buffer's document must show its real body.");
api.emit("EditRequested", { edit: { kind: "insert", text: "// annotation\n" } });
const bufferSuccessor = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "editor-buffer" && fact.payload.sliceId !== "editor-buffer#1",
});
timeline.advanceUntil("SliceUnmounted", {
    where: (fact) => fact.payload.sliceId === "editor-buffer#1",
});
timeline.advance(3);
assert(timeline.delivered("SliceErrorChanged", (fact) => fact.payload.sliceId.startsWith("editor-buffer") && fact.payload.errored).length === 0, "The buffer's body must be self-contained: its build starts clean.");
const handedOff = timeline.delivered("BufferRestored", (fact) => fact.sourceSlice === "editor-buffer#1" &&
    fact.frame > bufferSuccessor.frame &&
    fact.payload.fileId === "syntax-oracle");
assert(handedOff.length === 1, "The predecessor must hand off every document, not just the open one.");
// The successor owns the workspace: opening the adopted oracle's document
// again yields exactly what the predecessor last published for it, from the
// successor.
api.emit("SliceSelected", { sliceId: livingOf("syntax-oracle")[0] });
const reopened = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "syntax-oracle" && fact.sourceSlice === bufferSuccessor.payload.sliceId,
});
assert(reopened.payload.lines.join("\n") === handedOff[0].payload.lines.join("\n"), "The successor buffer must carry the predecessor's documents.");
assert(reopened.payload.revision > bufferDoc.payload.revision, "The revision counter must carry across the hand-off.");
api.emit("EditRequested", { edit: { kind: "insert", text: "// via successor\n" } });
timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "syntax-oracle" && fact.payload.lines.includes("// via successor"),
});
timeline.expectNone("ContractViolated", "The buffer's adoption must not breach any contract");
// --- The foundry adopts itself and keeps its lineage ---
// The retiring foundry re-publishes SliceSaved (its ledger) to the newcomer,
// and the pool re-publishes the living mount table; so the successor knows
// what it owns and what merely lives — a later edit hot-reloads instead of
// minting a sibling, and a navigation open still mounts nothing.
api.emit("SliceSelected", { sliceId: "foundry#1" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.fileId === "foundry" });
api.emit("EditRequested", { edit: { kind: "insert", text: "// self\n" } });
const foundrySuccessor = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "foundry" && fact.payload.sliceId !== "foundry#1",
});
timeline.advanceUntil("SliceUnmounted", { where: (fact) => fact.payload.sliceId === "foundry#1" });
timeline.advance(3);
assert(timeline.delivered("SliceErrorChanged", (fact) => fact.payload.sliceId.startsWith("foundry") && fact.payload.errored).length === 0, "The foundry's body must be self-contained: its build starts clean.");
assert(livingOf("foundry").length === 1, `Exactly one foundry must live, got ${livingOf("foundry").join(",")}.`);
// Navigation under the successor: a compiled slice's card opens, nothing mounts.
api.emit("SliceSelected", { sliceId: "clock#1" });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.fileId === "clock" });
timeline.advance(4);
assert(livingOf("clock").length === 1, "A navigation open under the successor foundry must not mount a shadow copy.");
// An owned document under the successor: the edit hot-reloads, never a sibling.
const oracleBefore = livingOf("syntax-oracle");
assert(oracleBefore.length === 1, "One adopted oracle must live before the successor edits it.");
api.emit("SliceSelected", { sliceId: oracleBefore[0] });
timeline.advanceUntil("BufferChanged", { where: (fact) => fact.payload.fileId === "syntax-oracle" });
api.emit("EditRequested", { edit: { kind: "insert", text: "// under the successor\n" } });
timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "syntax-oracle" && fact.sourceSlice === "pool" && fact.payload.sliceId !== oracleBefore[0],
});
timeline.advanceUntil("SliceUnmounted", { where: (fact) => fact.payload.sliceId === oracleBefore[0] });
timeline.advance(2);
assert(livingOf("syntax-oracle").length === 1, `The successor foundry must hot-reload what it inherited, got ${livingOf("syntax-oracle").join(",")}.`);
assert(Object.keys(api.snapshot().slices).some((id) => id === foundrySuccessor.payload.sliceId), "The successor foundry must still be the one living.");
// --- The safety net: a build that dies at start is thrown back ---
// The successor mounts, its start throws, and when its SliceMounted lands the
// foundry unmounts IT and keeps the predecessor — a red X, not a hole.
const oracleKept = livingOf("syntax-oracle")[0];
api.emit("EditRequested", { edit: { kind: "insert", text: 'throw new Error("boom");\n' } });
const dying = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "syntax-oracle" && fact.payload.sliceId !== oracleKept,
});
timeline.advanceUntil("SliceUnmounted", { where: (fact) => fact.payload.sliceId === dying.payload.sliceId });
timeline.advance(2);
assert(livingOf("syntax-oracle").length === 1 && livingOf("syntax-oracle")[0] === oracleKept, `A build that dies at start must not replace its predecessor, living: ${livingOf("syntax-oracle").join(",")}.`);
const verdict = timeline.delivered("SliceErrorChanged", (fact) => fact.payload.sliceId === oracleKept);
assert(verdict.length > 0 && verdict[verdict.length - 1].payload.errored &&
    (verdict[verdict.length - 1].payload.message ?? "").includes("start failed"), "The verdict must hang on the kept instance.");
// Remove the poison: the next good build replaces the kept instance and the
// flag clears on the replacement.
api.emit("EditRequested", {
    edit: { kind: "replace-match", find: 'throw new Error("boom");\n', text: "" },
});
timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "syntax-oracle" && !fact.payload.lines.join("\n").includes("boom"),
});
timeline.advanceUntil("SliceErrorChanged", {
    where: (fact) => fact.payload.sliceId.startsWith("syntax-oracle") && !fact.payload.errored,
});
timeline.advance(2);
assert(timeline.delivered("SliceUnmounted", (fact) => fact.payload.sliceId === oracleKept).length === 1 &&
    livingOf("syntax-oracle").length === 1, `The clean build must replace the kept instance, living: ${livingOf("syntax-oracle").join(",")}.`);
// --- Stub bodies dedent code but never template-literal content ---
const templateCarrier = defineSlice({
    type: "test-template-carrier",
    consumes: [],
    emits: [],
    start(context) {
        const banner = `
LINE ONE
  LINE TWO
`;
        void banner;
        void context;
    },
});
pool.mount(templateCarrier, { instanceId: "test-template-carrier#1" });
timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "test-template-carrier",
});
api.emit("SliceSelected", { sliceId: "test-template-carrier#1" });
const carrierDoc = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "test-template-carrier",
});
assert(carrierDoc.payload.lines[0] === "const banner = `", `Code lines must dedent flush, got ${JSON.stringify(carrierDoc.payload.lines[0])}.`);
assert(carrierDoc.payload.lines.includes("  LINE TWO"), "Template-literal columns are string content and must survive untouched.");
assert(carrierDoc.payload.lines.includes("void banner;"), "Code after the template must dedent to the same margin.");
// --- replace-range: one surgical intent, one undo step ---
const seedInstance = Object.keys(api.snapshot().slices).find((id) => id.startsWith("slice-1#"));
assert(seedInstance !== undefined, "The seed slice must be alive.");
api.emit("SliceSelected", { sliceId: seedInstance });
timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "slice-1",
});
api.emit("EditRequested", {
    edit: { kind: "insert", text: "const a = 1;\nconst b = 2;" },
});
const filled = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "slice-1" && fact.payload.lines.length === 2,
});
api.emit("EditRequested", {
    edit: {
        kind: "replace-range",
        from: { line: 0, column: 6 },
        to: { line: 1, column: 7 },
        text: "sum = 1;\nconst product",
    },
});
const surgical = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "slice-1" && fact.payload.lines[0] === "const sum = 1;",
});
assert(surgical.payload.lines.length === 2 && surgical.payload.lines[1] === "const product = 2;", `replace-range must splice across lines, got ${JSON.stringify(surgical.payload.lines)}.`);
assert(surgical.payload.revision === filled.payload.revision + 1, "A replace-range must be exactly one undo step.");
assert(surgical.payload.caret.line === 1 && surgical.payload.caret.column === 13, "The caret must land after the inserted text.");
// --- The vocabulary owner is fact-fed, so even it adopts cleanly ---
api.emit("SliceSelected", { sliceId: "completion-oracle#1" });
const oracleDoc = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "completion-oracle",
});
assert(oracleDoc.payload.lines.join("\n").includes("SchemasDeclared"), "The oracle's body must seed from the firewall's declared law, not an import.");
api.emit("EditRequested", { edit: { kind: "insert", text: "// adopted\n" } });
timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "completion-oracle" &&
        fact.payload.sliceId !== "completion-oracle#1",
});
timeline.advanceUntil("SliceUnmounted", {
    where: (fact) => fact.payload.sliceId === "completion-oracle#1",
});
timeline.advance(4);
assert(timeline.delivered("SliceErrorChanged", (fact) => fact.payload.sliceId.startsWith("completion-oracle")).length === 0, "The ambient contracts surface must satisfy knownEventTypes.");
// --- A compiled kit slice says what it is: its first line, and the outline ---
// The kit's firewall (and the chartered views) cannot start as written; the
// running source opens with the `// kit:` marker, and the port marks the
// living slice `kit` before anyone opens the card.
assert(/  firewall#1 \| in: .*\| kit/.test(api.outline()), `The outline must mark the kit's firewall, got ${JSON.stringify(api.outline().split("\n").find((line) => line.includes("firewall#1")))}.`);
api.emit("SliceSelected", { sliceId: "firewall#1" });
const firewallDoc = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "firewall",
});
assert(firewallDoc.payload.lines[0].startsWith("// kit:") && firewallDoc.payload.meta.consumes.includes("*"), `A kit slice's document must open with the marker and keep its wildcard, got ${JSON.stringify(firewallDoc.payload.lines[0])} in=${JSON.stringify(firewallDoc.payload.meta.consumes)}.`);
assert(!/  completion-oracle#\d+ \| in: .*\| kit/.test(api.outline()), "An app slice must not wear the kit mark.");
// --- A wildcard consumer's document keeps its `*`, so the port adopts ---
// The stub used to strip the wildcard, and a build without it died at start
// (`did not declare * in consumes`). Now the contract IS the contract.
api.emit("SliceSelected", { sliceId: "agent-port#1" });
const portDoc = timeline.advanceUntil("BufferChanged", {
    where: (fact) => fact.payload.fileId === "agent-port",
});
assert(portDoc.payload.meta.consumes.includes("*"), `The port's document must keep its wildcard, got ${JSON.stringify(portDoc.payload.meta.consumes)}.`);
api.emit("EditRequested", { edit: { kind: "insert", text: "// adopted\n" } });
const portSuccessor = timeline.advanceUntil("SliceMounted", {
    where: (fact) => fact.payload.sliceType === "agent-port" && fact.payload.sliceId !== "agent-port#1",
});
timeline.advanceUntil("SliceUnmounted", { where: (fact) => fact.payload.sliceId === "agent-port#1" });
timeline.advance(4);
assert(timeline.delivered("SliceErrorChanged", (fact) => fact.payload.sliceId.startsWith("agent-port")).every((fact) => !fact.payload.errored), "The port's build must start cleanly with its wildcard declared.");
const nextApi = globalThis.slicesAgent;
assert(nextApi !== undefined && nextApi !== api, "The successor port must take over the host global.");
const livingPorts = Object.keys(nextApi.snapshot().slices).filter((id) => id.startsWith("agent-port#"));
assert(livingPorts.length === 1 && livingPorts[0] === portSuccessor.payload.sliceId, `Exactly the successor port must live, got ${livingPorts.join(",")}.`);
console.log("adoption: the IDE eats its first slice and survives the trip.");
