import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { agentMind } from "../slices/agent-mind.js";
import { agentPort } from "../slices/agent-port.js";
import { apiBook } from "../slices/api-book.js";
import { clock } from "../slices/clock.js";
import { editorBuffer } from "../slices/editor-buffer.js";
import { factLog } from "../slices/fact-log.js";
import { foundry } from "../slices/foundry.js";
import { guideBook } from "../slices/guide-book.js";
import { proofingHouse } from "../slices/proofing-house.js";
import { ruleBook } from "../slices/rule-book.js";
import { schemaBook } from "../slices/schema-book.js";
import { thread } from "../slices/thread.js";
import { ticketDesk } from "../slices/ticket-desk.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The resident mind's loop, with the model scripted ---
// A fake model-port speaks the transport's two facts exactly like the real
// one — ModelCallRequested in, ModelReturned out, causedBy the request — but
// answers from a script instead of the network. So the whole chain is
// exercised in node: an ask files a ticket, the desk awards it to the mind,
// the turn's first model call goes out, a tool_use becomes a
// priority-1 EditRequested that the buffer applies and the foundry autosaves,
// the digest rides back as a tool_result, and the turn ends with its bill.
const defineSlice = sliceDefinerFor();
const script = [];
const requests = [];
const fakeModelPort = defineSlice({
    type: "model-port",
    description: "Test double: answers ModelCallRequested from a script.",
    consumes: ["ModelCallRequested"],
    emits: ["ModelReturned"],
    start(context) {
        context.subscribe("ModelCallRequested", (fact) => {
            const request = fact.payload.request;
            requests.push(request);
            const next = script.shift();
            if (next === undefined) {
                context.emit("ModelReturned", { callId: fact.payload.callId, ok: false, error: "script exhausted" }, { causedBy: [fact.id] });
                return;
            }
            const answer = next(request);
            if (answer instanceof Error) {
                context.emit("ModelReturned", { callId: fact.payload.callId, ok: false, error: answer.message }, { causedBy: [fact.id] });
                return;
            }
            context.emit("ModelReturned", {
                callId: fact.payload.callId,
                ok: true,
                response: answer,
                usage: { input: 1000, output: 50, cacheRead: 900, cacheWrite: 0 },
            }, { causedBy: [fact.id] });
        });
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
pool.mount(guideBook, { instanceId: "guide-book#1" });
pool.mount(apiBook, { instanceId: "api-book#1" });
pool.mount(ruleBook, { instanceId: "rule-book#1" });
pool.mount(clock, { instanceId: "clock#1" });
// The desk opens windows only in a live workspace: the fact-log's
// WorkspaceReplayed (entries: 0, headless) is what makes it live.
pool.mount(factLog, { instanceId: "fact-log#1" });
pool.mount(ticketDesk, { instanceId: "ticket-desk#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(proofingHouse, { instanceId: "proofing-house#1" });
pool.mount(agentPort, { instanceId: "agent-port#1" });
pool.mount(fakeModelPort, { instanceId: "model-port#1" });
pool.mount(agentMind, { instanceId: "agent-mind#1" });
pool.mount(thread, { instanceId: "thread#1" });
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
// The journal goes live the moment the state owners are mounted (an empty
// workspace has no seed to wait for), so this may already have landed.
if (timeline.delivered("WorkspaceReplayed").length === 0)
    timeline.advanceUntil("WorkspaceReplayed");
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API to the global host.");
// The mind settles on wall-clock beats while the pool is pumped by frames:
// pump a frame every few milliseconds for a while so both clocks interleave,
// as a browser's rAF and the pool's heartbeat do.
const runFor = async (ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        pool.advanceFrame();
        await new Promise((resolve) => setTimeout(resolve, 3));
    }
};
// --- Turn 1: read, edit, done ---
script.push(() => ({
    content: [
        { type: "text", text: "Looking first." },
        { type: "tool_use", id: "tu-1", name: "outline", input: {} },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [
        {
            type: "tool_use",
            id: "tu-2",
            name: "edit",
            input: { edit: { kind: "insert", text: 'context.emit("Ping", { n: 1 });' } },
        },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [{ type: "text", text: "Inserted the Ping emitter." }],
    stop_reason: "end_turn",
}));
api.emit("AgentAskRequested", { text: "add a Ping emitter", effort: "low" });
await runFor(600);
const started = timeline.delivered("AgentTurnStarted");
assert(started.length === 1, "An ask must open exactly one turn.");
const turnId = started[0].payload.turnId;
const calls = timeline.delivered("ModelCallRequested");
assert(calls.length === 3, `Turn 1 must make three model calls, got ${calls.length}.`);
const first = requests[0];
assert(Array.isArray(first.system) && first.system[0].cache_control !== undefined, "The system prompt must carry a cache breakpoint.");
const systemText = first.system[0].text;
assert(systemText.includes("OPERATOR'S MANUAL") && systemText.includes("CONTEXT API") && systemText.includes("LINT RULES"), "The system prompt must be assembled from the books.");
assert(first.output_config.effort === "low", "The ask's effort must ride the request.");
assert(Array.isArray(first.tools) && first.tools.some((tool) => tool.name === "edit"), "The tools must include edit.");
assert(requests[1].system[0].text === systemText, "The system prompt must be byte-stable across calls (the cache depends on it).");
// The conversation is cached too: the last block of the last message carries
// the second breakpoint, so a long turn's rounds cost only the new results.
for (const request of requests.slice(0, 3)) {
    const sent = request.messages;
    const tail = sent[sent.length - 1].content;
    assert(tail[tail.length - 1].cache_control !== undefined, "The last message block must carry a cache breakpoint.");
    assert(tail.slice(0, -1).every((block) => block.cache_control === undefined), "Only the tail block carries it.");
}
const edits = timeline.delivered("EditRequested", (fact) => fact.sourceSlice === "agent-mind#1");
assert(edits.length === 1, "The edit tool must emit exactly one EditRequested.");
assert(edits[0].payload.priority === 1, "The mind's edits must carry machine priority 1.");
const toolCalled = timeline.delivered("AgentToolCalled", (fact) => fact.payload.toolUseId === "tu-2");
assert(toolCalled.length === 1, "The edit must be announced as AgentToolCalled.");
assert(edits[0].causedBy.includes(toolCalled[0].id), "The intent must be the causal child of its tool call.");
const returned = timeline.delivered("ModelReturned");
assert(toolCalled[0].causedBy.some((id) => returned.some((fact) => fact.id === id)), "The tool call must be caused by the model's answer.");
const changed = timeline.delivered("BufferChanged", (fact) => fact.payload.lines.join("\n").includes('"Ping"'));
assert(changed.length >= 1, "The buffer must apply the mind's edit.");
assert(timeline.delivered("SliceMounted", (fact) => fact.payload.sliceType === "slice-1").length >= 2, "The foundry must autosave the mind's edit (a remount of slice-1).");
const toolReturned = timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === "tu-2");
assert(toolReturned.length === 1, "The edit tool must answer once.");
assert(toolReturned[0].payload.text.includes("rev ") && toolReturned[0].payload.text.includes('"Ping"'), `The tool answer must be a digest of the change, got ${JSON.stringify(toolReturned[0].payload.text)}.`);
const outlineAnswer = timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === "tu-1");
assert(outlineAnswer.length === 1 && outlineAnswer[0].payload.text.includes("documents ("), "The outline tool must answer from the cache.");
const thirdRequest = requests[2];
const messages = thirdRequest.messages;
const lastUser = messages[messages.length - 1];
assert(lastUser.role === "user" && lastUser.content[0].type === "tool_result", "Tool results must ride back in one user message.");
assert(messages[0].role === "user" && String(messages[0].content[0].text).includes("[workspace]"), "The ask must carry the workspace header.");
const said = timeline.delivered("AgentSaid", (fact) => fact.payload.turnId === turnId);
assert(said.length === 2, `The model's text blocks must land as AgentSaid, got ${said.length}.`);
const ended = timeline.delivered("AgentTurnEnded", (fact) => fact.payload.turnId === turnId);
assert(ended.length === 1, "The turn must end once.");
assert(ended[0].payload.stopReason === "end_turn" && ended[0].payload.error === undefined, "A clean turn ends on end_turn without error.");
assert(ended[0].payload.usage.input === 3000 && ended[0].payload.usage.cacheRead === 2700, "The turn's usage must sum every call.");
// --- Turn 2: the model call fails; the turn ends with the error, no crash ---
script.push(() => new Error("503 overloaded"));
api.emit("AgentAskRequested", { text: "do something else" });
await runFor(300);
const failed = timeline.delivered("AgentTurnEnded", (fact) => fact.payload.turnId !== turnId);
assert(failed.length === 1, "A failed model call must still end the turn.");
assert(failed[0].payload.error === "503 overloaded", `The error must ride the ending, got ${JSON.stringify(failed[0].payload)}.`);
// --- Turn 3: proof answers with verdicts; asks queue while a turn is live ---
script.push(() => ({
    content: [
        {
            type: "tool_use",
            id: "tu-3",
            name: "proof",
            input: {
                meta: { type: "probe", description: "a probe", consumes: [], emits: [] },
                lines: ["const x = ;"],
            },
        },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Broken." }], stop_reason: "end_turn" }), () => ({ content: [{ type: "text", text: "Queued turn done." }], stop_reason: "end_turn" }));
api.emit("AgentAskRequested", { text: "proof a broken body" });
api.emit("AgentAskRequested", { text: "then say hi" });
await runFor(800);
const proofAnswer = timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === "tu-3");
assert(proofAnswer.length === 1, "The proof tool must answer.");
assert(proofAnswer[0].payload.text.includes("proof ") && proofAnswer[0].payload.text.includes("compile"), `The proof digest must carry the compile verdict, got ${JSON.stringify(proofAnswer[0].payload.text)}.`);
const allEnded = timeline.delivered("AgentTurnEnded");
assert(allEnded.length === 4, `Queued asks must run one after another, got ${allEnded.length} endings.`);
// --- Turn 4: a batch of edits is one frame — one BufferChanged, one undo step ---
script.push(() => ({
    content: [
        {
            type: "tool_use",
            id: "tu-4",
            name: "edit",
            input: {
                edits: [
                    { kind: "tags-set", side: "consumes", tags: ["FrameTicked", "StepPressed"] },
                    { kind: "tag-add", side: "emits", tag: "Pong" },
                    { kind: "meta-set", field: "description", value: "Batched by the mind." },
                ],
            },
        },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Contract declared." }], stop_reason: "end_turn" }));
const changesBefore = timeline.delivered("BufferChanged").length;
api.emit("AgentAskRequested", { text: "declare the contract" });
await runFor(600);
const batchIntents = timeline.delivered("EditRequested", (fact) => fact.sourceSlice === "agent-mind#1");
assert(batchIntents.length === 4, `The batch must emit one intent per edit, got ${batchIntents.length}.`);
const batchFrames = new Set(batchIntents.slice(1).map((fact) => fact.frame));
assert(batchFrames.size === 1, "A batch's intents must all land in one frame.");
assert(timeline.delivered("BufferChanged").length === changesBefore + 1, "A batch must be exactly one BufferChanged.");
const batchedDoc = timeline.delivered("BufferChanged").at(-1);
assert(batchedDoc !== undefined &&
    JSON.stringify(batchedDoc.payload.meta.consumes) === JSON.stringify(["FrameTicked", "StepPressed"]) &&
    batchedDoc.payload.meta.emits.includes("Pong") &&
    batchedDoc.payload.meta.description === "Batched by the mind.", `Every edit of the batch must apply, got ${JSON.stringify(batchedDoc?.payload.meta)}.`);
const batchAnswer = timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === "tu-4");
assert(batchAnswer.length === 1 && batchAnswer[0].payload.text.includes("meta only"), `The batch tool must answer with the digest, got ${JSON.stringify(batchAnswer[0]?.payload.text)}.`);
// --- Turn 5: the cascade is readable (facts), handles trace, proof by id,
// delete by document id ---
script.push(() => ({
    content: [
        { type: "tool_use", id: "tu-5a", name: "workspace", input: { action: "create" } },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [
        { type: "tool_use", id: "tu-5b", name: "facts", input: { types: ["BufferChanged", "SliceMounted"], limit: 5 } },
        { type: "tool_use", id: "tu-5c", name: "trace", input: { factId: "last" } },
        { type: "tool_use", id: "tu-5d", name: "proof", input: { fileId: "slice-2" } },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [
        { type: "tool_use", id: "tu-5e", name: "workspace", input: { action: "delete", fileId: "slice-2" } },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Looked, proved, deleted." }], stop_reason: "end_turn" }));
api.emit("AgentAskRequested", { text: "create, inspect, delete" });
await runFor(900);
const answerOf = (id) => timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === id)[0]?.payload.text ?? "";
assert(answerOf("tu-5a").includes("docs: +slice-2") && /^facts: AgentToolCalled -> SliceCreateRequested -> BufferChanged/m.test(answerOf("tu-5a")), `The create must digest the roster move and open with the cascade's types, got ${JSON.stringify(answerOf("tu-5a"))}.`);
const factsAnswer = answerOf("tu-5b");
assert(factsAnswer.startsWith("facts ") && /\d+:\d+ (BufferChanged|SliceMounted) </.test(factsAnswer) && !factsAnswer.includes(" EditRequested <"), `The facts tool must list ring facts filtered by type, got ${JSON.stringify(factsAnswer)}.`);
const traceAnswer = answerOf("tu-5c");
assert(/^\d+:\d+ SliceCreateRequested <agent-mind#1>/.test(traceAnswer), `trace("last") must resolve to the mind's last intent, got ${JSON.stringify(traceAnswer)}.`);
assert(answerOf("tu-5d").includes("proof ") && !answerOf("tu-5d").includes("no document"), `proof { fileId } must assay the existing document, got ${JSON.stringify(answerOf("tu-5d"))}.`);
assert(answerOf("tu-5e").includes("docs: -slice-2"), `A delete by document id must remove the document, got ${JSON.stringify(answerOf("tu-5e"))}.`);
// --- Turn 6: edit { fileId } lands on that document ---
script.push(() => ({
    content: [
        { type: "tool_use", id: "tu-6c", name: "workspace", input: { action: "create" } },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [
        {
            type: "tool_use",
            id: "tu-6d",
            name: "edit",
            input: { fileId: "slice-1", edits: [{ kind: "select-all" }, { kind: "insert", text: "// aimed at slice-1" }] },
        },
        { type: "tool_use", id: "tu-6e", name: "edit", input: { fileId: "no-such-doc", edit: { kind: "insert", text: "x" } } },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Aimed." }], stop_reason: "end_turn" }));
api.emit("AgentAskRequested", { text: "edit slice-1 by name" });
await runFor(900);
// slice-2 was created and is active; the aimed edit must land on slice-1.
const aimed = answerOf("tu-6d");
assert(aimed.includes("doc slice-1") && aimed.includes("// aimed at slice-1") && aimed.includes("+ slice-1") === false, `edit { fileId } must select and edit that document, got ${JSON.stringify(aimed)}.`);
const seedNow = api.snapshot().documents["slice-1"];
assert(seedNow.lines.join("\n") === "// aimed at slice-1", "The aimed edit must land on slice-1's text.");
assert(api.snapshot().documents["slice-2"] !== undefined && !api.snapshot().documents["slice-2"].lines.join("\n").includes("aimed"), "The created document must be untouched by an edit aimed elsewhere.");
assert(answerOf("tu-6e").startsWith("edit: no document or slice"), `An unknown fileId must be refused before anything is emitted, got ${JSON.stringify(answerOf("tu-6e"))}.`);
// --- Turn 7: a leaked tool input is read for what it means ---
// A Bedrock-routed model sometimes emits `"edit": "\n<parameter name=\"kind\">…"`
// with the fields flattened beside it, or a flat { kind, … } with no wrapper.
// The intent is unambiguous; the fact emitted is the same EditRequested.
script.push(() => ({
    content: [
        {
            type: "tool_use",
            id: "tu-7a",
            name: "edit",
            input: { fileId: "slice-1", edit: '\n<parameter name="kind">replace-match', find: "aimed at slice-1", text: "read charitably" },
        },
        { type: "tool_use", id: "tu-7b", name: "edit", input: { kind: "insert", text: " (flat)" } },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Parsed." }], stop_reason: "end_turn" }));
api.emit("AgentAskRequested", { text: "leaked tool inputs" });
await runFor(600);
assert(!answerOf("tu-7a").startsWith("edit requires") && answerOf("tu-7a").includes("read charitably"), `A leaked kind with flat fields must be read as the edit it means, got ${JSON.stringify(answerOf("tu-7a"))}.`);
assert(!answerOf("tu-7b").startsWith("edit requires") && api.snapshot().documents["slice-1"].lines.join("\n").endsWith(" (flat)"), `A flat { kind, … } must be accepted, got ${JSON.stringify(answerOf("tu-7b"))}.`);
// --- Turn 8: the thread — the mind pins it as an intent, and every ask opens with it ---
// The thread tool emits ThreadPinRequested (journaled like an edit); the
// thread slice answers ThreadDeclared; the next ask's opening message
// carries the [thread] line, so a cold turn reads "where was I" too.
script.push(() => ({
    content: [{ type: "tool_use", id: "tu-8a", name: "thread", input: { text: "give slice-1 a Pong" } }],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Pinned." }], stop_reason: "end_turn" }), () => ({ content: [{ type: "text", text: "Reading the thread." }], stop_reason: "end_turn" }));
api.emit("AgentAskRequested", { text: "pin the thread" });
await runFor(600);
const pinIntents = timeline.delivered("ThreadPinRequested", (fact) => fact.sourceSlice === "agent-mind#1");
assert(pinIntents.length === 1 && pinIntents[0].payload.text === "give slice-1 a Pong", "The thread tool must emit ThreadPinRequested from the mind.");
const pinCall = timeline.delivered("AgentToolCalled", (fact) => fact.payload.toolUseId === "tu-8a");
assert(pinCall.length === 1 && pinIntents[0].causedBy.includes(pinCall[0].id), "The pin intent must be the tool call's causal child.");
assert(api.snapshot().thread.text === "give slice-1 a Pong", "The thread slice must answer, and the port must carry it.");
api.emit("AgentAskRequested", { text: "what was I doing" });
await runFor(600);
const lastRequest = timeline.delivered("ModelCallRequested").slice(-1)[0].payload.request;
const opening = lastRequest.messages.filter((message) => message.role === "user").slice(-1)[0];
const openingText = String(opening.content[0].text ?? "");
assert(openingText.includes("[thread] NOW: give slice-1 a Pong") && openingText.includes("subject slice-1"), `An ask must open with the thread line, got ${JSON.stringify(openingText.split("\n").slice(0, 3))}.`);
timeline.expectNone("ContractViolated", "The mind's facts must all pass the firewall.");
console.log("agent-mind: the resident author's loop holds.");
