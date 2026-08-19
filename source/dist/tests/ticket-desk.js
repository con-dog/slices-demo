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
// --- The ticket desk: the work as facts, the minds as a bidding pool ---
// Part A drives the real mind through a scripted model-port: a filing opens
// a window, the mind bids, the desk awards (causedBy the bid), the turn
// opens with a [ticket] block, the ticket tool notes and closes, an ask
// files a ticket via the compat door, an unclosed turn parks and RESUME
// re-awards, a scrub restores the ledger, and two minds share one port.
// Part B drives the desk with fake minds and a speaker: arbitration by bid,
// ties by arrival, busy passes and idle re-opens, replay silence, and a
// successor desk that seeds from its predecessor.
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
            const answer = next === undefined ? new Error("script exhausted") : next(request);
            if (answer instanceof Error) {
                context.emit("ModelReturned", { callId: fact.payload.callId, ok: false, error: answer.message }, { causedBy: [fact.id] });
                return;
            }
            context.emit("ModelReturned", { callId: fact.payload.callId, ok: true, response: answer, usage: { input: 1000, output: 50, cacheRead: 900, cacheWrite: 0 } }, { causedBy: [fact.id] });
        });
    },
});
let speakA = () => "";
let speakB = () => "";
const speaker = (bind) => defineSlice({
    type: "test-speaker",
    consumes: [],
    emits: [
        "TimelineScrubbed",
        "WorkspaceReplayed",
        "TicketFiled",
        "TicketBidPlaced",
        "TicketPassed",
        "TicketResumeRequested",
        "TicketClosed",
        "TicketNoted",
    ],
    start(context) {
        bind(context.emit.bind(context));
    },
});
const runFor = async (pool, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        pool.advanceFrame();
        await new Promise((resolve) => setTimeout(resolve, 3));
    }
};
// ===================== Part A: the real mind =====================
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
pool.mount(factLog, { instanceId: "fact-log#1" });
pool.mount(ticketDesk, { instanceId: "ticket-desk#1" });
pool.mount(editorBuffer, { instanceId: "editor-buffer#1" });
pool.mount(foundry, { instanceId: "foundry#1" });
pool.mount(proofingHouse, { instanceId: "proofing-house#1" });
pool.mount(agentPort, { instanceId: "agent-port#1" });
pool.mount(fakeModelPort, { instanceId: "model-port#1" });
pool.mount(agentMind, { instanceId: "agent-mind#1" });
pool.mount(thread, { instanceId: "thread#1" });
pool.mount(speaker((speak) => (speakA = speak)), { instanceId: "test-speaker#1" });
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
// 1. Boot: the ledger is declared empty and not yet live; WorkspaceReplayed makes it live.
timeline.advanceUntil("BufferChanged");
const bootDeclared = timeline.delivered("TicketsDeclared");
assert(bootDeclared.length >= 1 && bootDeclared[0].payload.tickets.length === 0 && bootDeclared[0].payload.replayed === false, "The desk must declare an empty, not-yet-live ledger at boot.");
// The journal goes live the moment the state owners are mounted (an empty
// workspace has no seed to wait for), so both may already have landed.
if (timeline.delivered("WorkspaceReplayed").length === 0)
    timeline.advanceUntil("WorkspaceReplayed");
if (timeline.delivered("TicketsDeclared", (fact) => fact.payload.replayed === true).length === 0) {
    timeline.advanceUntil("TicketsDeclared", { where: (fact) => fact.payload.replayed === true });
}
const minds = timeline.delivered("MindDeclared", (fact) => fact.sourceSlice === "agent-mind#1");
assert(minds.length >= 1 && minds[0].payload.state === "idle" && minds[0].payload.specialty === "general", "The mind must declare its charter at start.");
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API to the global host.");
// 2. A filing → window → bid → award (causedBy the bid) → turn → note → close.
script.push(() => ({ content: [{ type: "tool_use", id: "tu-1", name: "outline", input: {} }], stop_reason: "tool_use" }), () => ({
    content: [
        { type: "tool_use", id: "tu-2", name: "edit", input: { edit: { kind: "insert", text: 'context.emit("Ping", { n: 1 });' } } },
        { type: "tool_use", id: "tu-3", name: "ticket", input: { action: "note", text: "emitter in, checking the card" } },
    ],
    stop_reason: "tool_use",
}), () => ({
    content: [
        { type: "text", text: "Inserted the Ping emitter." },
        { type: "tool_use", id: "tu-4", name: "ticket", input: { action: "close", outcome: "done", note: "Ping emitter added to slice-1." } },
    ],
    stop_reason: "tool_use",
}), () => ({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn" }));
const filedId = api.emit("TicketFiled", { text: "add a Ping emitter", tags: ["Emit"], effort: "low" });
await runFor(pool, 700);
const opened = timeline.delivered("TicketOpened");
assert(opened.length === 1 && opened[0].payload.ticketId === "t-1" && opened[0].payload.tags[0] === "emit", `A filing must open one window with lowercased tags, got ${JSON.stringify(opened.map((f) => f.payload))}.`);
const bids = timeline.delivered("TicketBidPlaced");
assert(bids.length === 1 && bids[0].sourceSlice === "agent-mind#1" && bids[0].payload.mind === "agent-mind#1" && bids[0].payload.bid === 1, `The idle mind must bid its base, got ${JSON.stringify(bids.map((f) => f.payload))}.`);
const awards = timeline.delivered("TicketAssigned");
assert(awards.length === 1 && awards[0].payload.to === "agent-mind#1" && awards[0].payload.effort === "low", "The desk must award the only bidder, effort aboard.");
assert(awards[0].causedBy.includes(bids[0].id), "The award must be caused by the winning bid.");
const started = timeline.delivered("AgentTurnStarted");
assert(started.length === 1 && started[0].payload.ticketId === "t-1", "The turn must name its ticket.");
assert(String(requests[0].output_config?.effort) === "low", "The ticket's effort must ride the request.");
const opening = String((requests[0].messages[0].content[0]).text ?? "");
assert(opening.includes("[workspace]") && opening.includes("[ticket t-1]") && opening.includes("tags emit") && opening.includes("assigned to you (agent-mind#1, bid 1)"), `The turn must open with the ticket block, got ${JSON.stringify(opening.split("\n").slice(0, 6))}.`);
const working = timeline.delivered("MindDeclared", (fact) => fact.payload.state === "working");
assert(working.length >= 1 && working[0].payload.ticketId === "t-1", "The mind must declare working on its ticket.");
const answerOf = (id) => timeline.delivered("AgentToolReturned", (fact) => fact.payload.toolUseId === id)[0]?.payload.text ?? "";
assert(answerOf("tu-1").includes("tickets: 0 todo | 1 doing | 0 done | mine: t-1"), `The outline must carry the ticket line, got ${JSON.stringify(answerOf("tu-1").split("\n").slice(0, 3))}.`);
assert(answerOf("tu-3").startsWith("ticket t-1 | doing | to agent-mind#1 | 1 note"), `The note tool must answer with the ledger line, got ${JSON.stringify(answerOf("tu-3").split("\n")[0])}.`);
assert(answerOf("tu-4").startsWith("ticket t-1 | done | to agent-mind#1 | 1 note | done"), `The close tool must answer with the closed ledger line, got ${JSON.stringify(answerOf("tu-4").split("\n")[0])}.`);
const noted = timeline.delivered("TicketNoted");
assert(noted.length === 1 && noted[0].sourceSlice === "agent-mind#1" && noted[0].payload.by === "agent-mind#1", "The note must be the mind's own intent.");
const noteCall = timeline.delivered("AgentToolCalled", (fact) => fact.payload.toolUseId === "tu-3");
assert(noted[0].causedBy.includes(noteCall[0].id), "The note intent must be the tool call's causal child.");
const ended = timeline.delivered("AgentTurnEnded");
assert(ended.length === 1, "The turn must end once.");
const ledger = api.snapshot().tickets;
assert(ledger.replayed === true && ledger.tickets.length === 1, "The port must carry the ledger.");
const t1 = ledger.tickets[0];
assert(t1.ticketId === "t-1" && t1.state === "done" && t1.outcome === "done" && t1.working === false && t1.factId === filedId, `t-1 must be closed and keep its filing fact, got ${JSON.stringify(t1)}.`);
assert(t1.notes.length === 1 && t1.closeNote === "Ping emitter added to slice-1." && t1.tags[0] === "emit" && t1.effort === "low", `t-1 must carry its notes, close note, tags and effort, got ${JSON.stringify(t1)}.`);
assert(ledger.minds["agent-mind#1"]?.state === "idle", "The roster must show the mind idle again.");
assert(api.outline().includes("tickets: 0 todo | 0 doing | 1 done | minds: agent-mind#1 idle"), `The port's outline must carry the ticket line, got ${JSON.stringify(api.outline().split("\n").slice(0, 4))}.`);
assert(timeline.delivered("BufferChanged", (fact) => fact.payload.lines.join("\n").includes('"Ping"')).length >= 1, "The mind's edit must land in the buffer.");
// 4 + 5. The compat door: an ask files a ticket; a turn without a close parks it; RESUME re-awards.
script.push(() => ({ content: [{ type: "text", text: "Hi. (forgot to close)" }], stop_reason: "end_turn" }));
// send() settles on wall-clock beats: pump the pool alongside it.
const [asked] = await Promise.all([api.send("AgentAskRequested", { text: "say hi" }), runFor(pool, 250)]);
const filedByDesk = asked.facts.find((fact) => fact.type === "TicketFiled");
assert(filedByDesk !== undefined && filedByDesk.sourceSlice === "ticket-desk#1" && filedByDesk.payload.tags?.[0] === "ask", "An ask must be filed by the desk, tagged ask.");
assert(asked.facts.some((fact) => fact.type === "AgentTurnStarted" && fact.payload.ticketId === "t-2"), "The ask's turn must start within the settled cascade (the relay relies on it).");
await runFor(pool, 300);
let t2 = api.snapshot().tickets.tickets.find((ticket) => ticket.ticketId === "t-2");
assert(t2 !== undefined && t2.state === "doing" && t2.working === false && t2.to === "agent-mind#1", `An unclosed turn must park the ticket, got ${JSON.stringify(t2)}.`);
assert(api.outline().includes("1 doing (1 parked)"), "The outline must count the parked ticket.");
script.push(() => ({ content: [{ type: "tool_use", id: "tu-5", name: "ticket", input: { action: "close", outcome: "wontfix", note: "just a greeting" } }], stop_reason: "tool_use" }), () => ({ content: [{ type: "text", text: "Closed." }], stop_reason: "end_turn" }));
const [resumed] = await Promise.all([api.send("TicketResumeRequested", { ticketId: "t-2" }), runFor(pool, 250)]);
assert(resumed.facts.some((fact) => fact.type === "TicketAssigned" && fact.payload.to === "agent-mind#1"), "RESUME must re-award the parked ticket to its holder.");
await runFor(pool, 400);
t2 = api.snapshot().tickets.tickets.find((ticket) => ticket.ticketId === "t-2");
assert(t2 !== undefined && t2.state === "done" && t2.outcome === "wontfix" && t2.closeNote === "just a greeting", `The resumed turn must close the ticket, got ${JSON.stringify(t2)}.`);
assert(timeline.delivered("AgentTurnStarted").length === 3, "RESUME must open a fresh turn.");
// 8. Time travel: the ledger as it was, then as it is.
const awardOfT1 = timeline.delivered("TicketAssigned")[0];
const beforeScrub = pool.getFrameNumber();
speakA("TimelineScrubbed", { frameNumber: awardOfT1.frame });
await runFor(pool, 60);
const restored = timeline.delivered("TicketsDeclared").slice(-1)[0].payload.tickets;
assert(restored.length === 1 && restored[0].ticketId === "t-1" && restored[0].state === "doing" && restored[0].working === false, `A scrub to the award must restore t-1 as doing (parked), got ${JSON.stringify(restored.map((t) => [t.ticketId, t.state, t.working]))}.`);
// Forward again: to the frame just before the scrub (a restore records too,
// like the buffer's — the newest state after a scrub is the restored one).
speakA("TimelineScrubbed", { frameNumber: beforeScrub });
await runFor(pool, 60);
const forward = timeline.delivered("TicketsDeclared").slice(-1)[0].payload.tickets;
assert(forward.length === 2 && forward.every((ticket) => ticket.state === "done"), `A scrub forward must restore both tickets done, got ${JSON.stringify(forward.map((t) => [t.ticketId, t.state]))}.`);
// 9. Two minds share one port: each takes only its own answers, and two
// tickets filed in one frame go to two idle minds.
pool.mount(agentMind, { instanceId: "agent-mind#2" });
await runFor(pool, 60);
assert(api.snapshot().tickets.minds["agent-mind#2"]?.state === "idle", "The second mind must join the roster.");
script.push(
// #1 works t-3, #2 works t-4 — whichever call arrives first, each mind
// closes its own ticket (default ticketId is the turn's).
() => ({ content: [{ type: "tool_use", id: "tu-6", name: "ticket", input: { action: "close", outcome: "done", note: "one" } }], stop_reason: "tool_use" }), () => ({ content: [{ type: "tool_use", id: "tu-7", name: "ticket", input: { action: "close", outcome: "done", note: "two" } }], stop_reason: "tool_use" }), () => ({ content: [{ type: "text", text: "closed" }], stop_reason: "end_turn" }), () => ({ content: [{ type: "text", text: "closed" }], stop_reason: "end_turn" }));
api.emit("TicketFiled", { text: "first of a pair" });
api.emit("TicketFiled", { text: "second of a pair" });
await runFor(pool, 900);
const pair = api.snapshot().tickets.tickets.filter((ticket) => ticket.ticketId === "t-3" || ticket.ticketId === "t-4");
assert(pair.length === 2 && pair.every((ticket) => ticket.state === "done"), `Both tickets must close, got ${JSON.stringify(pair.map((t) => [t.ticketId, t.state, t.to]))}.`);
assert(new Set(pair.map((ticket) => ticket.to)).size === 2, `Two idle minds must take one ticket each, got ${JSON.stringify(pair.map((t) => [t.ticketId, t.to]))}.`);
const secondWindow = timeline.delivered("TicketOpened", (fact) => fact.payload.ticketId === "t-4");
const firstAward = timeline.delivered("TicketAssigned", (fact) => fact.payload.ticketId === "t-3");
assert(secondWindow.length === 1 && firstAward.length === 1 && secondWindow[0].frame >= firstAward[0].frame, "The desk must auction one ticket at a time: t-4's window opens no earlier than t-3's award.");
const pairTurns = timeline.delivered("AgentTurnStarted", (fact) => fact.payload.ticketId === "t-3" || fact.payload.ticketId === "t-4");
assert(pairTurns.length === 2 && new Set(pairTurns.map((fact) => fact.sourceSlice)).size === 2, "Each mind must run its own turn.");
assert(timeline.delivered("AgentTurnEnded", (fact) => fact.payload.turnId.startsWith("agent-mind#2:")).length === 1, "The second mind's turn must end (its ModelReturned reached it).");
timeline.expectNone("ContractViolated", "Every ticket fact must pass the firewall.");
const handles = new Map();
const fakeMind = (type, charter) => defineSlice({
    type,
    consumes: ["TicketOpened", "TicketAssigned", "SliceMounted"],
    emits: ["MindDeclared", "TicketBidPlaced", "TicketPassed", "AgentTurnStarted", "AgentTurnEnded"],
    start(context) {
        let live = null;
        let turns = 0;
        const declare = () => context.emit("MindDeclared", {
            specialty: type,
            tags: charter.tags,
            baseBid: charter.base,
            bidRule: "test",
            state: live === null ? "idle" : "working",
            ...(live === null ? {} : { ticketId: live }),
        });
        context.subscribe("TicketOpened", (fact) => {
            const shared = fact.payload.tags.filter((tag) => charter.tags.includes(tag)).length;
            const bid = charter.base + charter.bonus * shared - (live === null ? 0 : 1);
            if (bid <= 0)
                context.emit("TicketPassed", { ticketId: fact.payload.ticketId, mind: context.instanceId });
            else
                context.emit("TicketBidPlaced", { ticketId: fact.payload.ticketId, mind: context.instanceId, bid });
        });
        context.subscribe("TicketAssigned", (fact) => {
            if (fact.payload.to !== context.instanceId || live !== null)
                return;
            live = fact.payload.ticketId;
            turns += 1;
            context.emit("AgentTurnStarted", { turnId: `${context.instanceId}:turn-${turns}`, text: fact.payload.text, ticketId: live });
            declare();
        });
        context.subscribe("SliceMounted", (fact) => {
            if (fact.payload.sliceId !== context.instanceId && fact.payload.consumes.includes("MindDeclared"))
                declare();
        });
        handles.set(context.instanceId, {
            end: () => {
                if (live === null)
                    return;
                context.emit("AgentTurnEnded", { turnId: `${context.instanceId}:turn-${turns}`, stopReason: "end_turn", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
                live = null;
                declare();
            },
        });
        declare();
    },
});
const poolB = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const tlB = trackFrames(poolB);
poolB.mount(ticketDesk, { instanceId: "ticket-desk#1" });
poolB.mount(speaker((speak) => (speakB = speak)), { instanceId: "test-speaker#1" });
poolB.mount(fakeMind("general-mind", { tags: [], base: 1, bonus: 2 }), { instanceId: "general-mind#1" });
poolB.mount(fakeMind("css-mind", { tags: ["css"], base: 0, bonus: 3 }), { instanceId: "css-mind#1" });
tlB.advance(3);
const ledgerB = () => tlB.delivered("TicketsDeclared").slice(-1)[0].payload.tickets;
// 6. Replay silence: nothing opens, journaled bids award silently, RESUME wakes it.
speakB("TicketFiled", { text: "filed while replaying" });
tlB.advance(3);
speakB("TicketBidPlaced", { ticketId: "t-1", mind: "general-mind#1", bid: 1 });
tlB.advance(3);
assert(tlB.delivered("TicketOpened").length === 0 && tlB.delivered("TicketAssigned").length === 0, "Before WorkspaceReplayed the desk must open no window and emit no award.");
assert(ledgerB()[0].state === "doing" && ledgerB()[0].to === "general-mind#1" && ledgerB()[0].working === false, `A journaled bid must award silently (doing, parked), got ${JSON.stringify(ledgerB()[0])}.`);
speakB("TicketFiled", { text: "todo, filed while replaying" });
tlB.advance(3);
speakB("WorkspaceReplayed", { entries: 2 });
tlB.advance(4);
assert(tlB.delivered("TicketOpened").length === 0 && tlB.delivered("TicketAssigned").length === 0, "WorkspaceReplayed must open nothing by itself: no window, no award, no model call on boot.");
assert(ledgerB()[1].state === "todo" && ledgerB()[1].awaiting.length === 0, "A todo ticket from the journal waits, parked, for a live event.");
speakB("TicketResumeRequested", { ticketId: "t-1" });
tlB.advance(3);
assert(tlB.delivered("TicketAssigned").length === 1 && tlB.delivered("TicketAssigned")[0].payload.to === "general-mind#1", "RESUME on the parked ticket must re-award it to its holder.");
assert(tlB.delivered("AgentTurnStarted").length === 1, "The holder must take the resumed ticket.");
// 3. Arbitration: a tagged ticket goes to the specialist; the general mind is busy and passes.
speakB("TicketFiled", { text: "fix the chip border", tags: ["css"] });
tlB.advance(4);
const t3Bids = tlB.delivered("TicketBidPlaced", (fact) => fact.payload.ticketId === "t-3");
const t3Pass = tlB.delivered("TicketPassed", (fact) => fact.payload.ticketId === "t-3");
assert(t3Bids.length === 1 && t3Bids[0].payload.mind === "css-mind#1" && t3Bids[0].payload.bid === 3, `The specialist must bid its bonus, got ${JSON.stringify(t3Bids.map((f) => f.payload))}.`);
assert(t3Pass.length === 1 && t3Pass[0].payload.mind === "general-mind#1", "The busy general mind must pass.");
assert(ledgerB().find((t) => t.ticketId === "t-3")?.to === "css-mind#1", "The specialist must win the tagged ticket.");
// The parked todo (t-2) is untagged: the specialist bids 0 (passes), the general mind is busy — no takers.
speakB("TicketResumeRequested", { ticketId: "t-2" });
tlB.advance(4);
let t2B = ledgerB().find((t) => t.ticketId === "t-2");
assert(t2B !== undefined && t2B.state === "todo" && t2B.to === undefined && t2B.awaiting.length === 0 && t2B.passed.length === 2, `An untagged ticket with only busy or unsuited minds has no takers, got ${JSON.stringify(t2B)}.`);
// The general mind comes free: idle re-opens the unserved ticket and wins it.
handles.get("general-mind#1")?.end();
tlB.advance(5);
t2B = ledgerB().find((t) => t.ticketId === "t-2");
assert(t2B !== undefined && t2B.state === "doing" && t2B.to === "general-mind#1", `A mind going idle must re-open and take the unserved ticket, got ${JSON.stringify(t2B)}.`);
// Ties by arrival: two identical minds, the lexically-first instance answers first and wins.
poolB.mount(fakeMind("twin-mind", { tags: [], base: 5, bonus: 0 }), { instanceId: "twin-mind#1" });
poolB.mount(fakeMind("twin-mind", { tags: [], base: 5, bonus: 0 }), { instanceId: "twin-mind#2" });
tlB.advance(3);
speakB("TicketFiled", { text: "a coin toss" });
tlB.advance(4);
const t4 = ledgerB().find((t) => t.ticketId === "t-4");
assert(t4 !== undefined && t4.to === "twin-mind#1" && t4.bids.filter((b) => b.bid === 5).length === 2, `Ties must go to the earlier arrival, got ${JSON.stringify(t4?.bids)} -> ${t4?.to}.`);
// A human closes a doing ticket from the rack: X is TicketClosed.
speakB("TicketClosed", { ticketId: "t-4", outcome: "done", by: "human" });
tlB.advance(3);
assert(ledgerB().find((t) => t.ticketId === "t-4")?.state === "done", "A human's close must land.");
// A mind that dies mid-turn parks its ticket; RESUME re-opens bidding when the holder is gone.
poolB.unmount("css-mind#1");
tlB.advance(3);
let t3B = ledgerB().find((t) => t.ticketId === "t-3");
assert(t3B !== undefined && t3B.state === "doing" && t3B.working === false, "A holder's unmount must park its ticket.");
speakB("TicketResumeRequested", { ticketId: "t-3" });
tlB.advance(4);
t3B = ledgerB().find((t) => t.ticketId === "t-3");
assert(t3B !== undefined && t3B.to !== "css-mind#1" && t3B.to !== undefined, `RESUME with the holder gone must re-open bidding and award afresh, got ${JSON.stringify([t3B?.state, t3B?.to])}.`);
// 7. A successor desk seeds from its predecessor and continues numbering.
poolB.mount(ticketDesk, { instanceId: "ticket-desk#2" });
tlB.advance(4);
const seeded = tlB.delivered("TicketsDeclared", (fact) => fact.sourceSlice === "ticket-desk#2").slice(-1)[0];
assert(seeded !== undefined && seeded.payload.serial === 4 && seeded.payload.tickets.length === 4 && seeded.payload.replayed === true, `The successor must seed the ledger, serial and liveness, got ${JSON.stringify(seeded?.payload.serial)}.`);
poolB.unmount("ticket-desk#1");
tlB.advance(3);
speakB("TicketFiled", { text: "after the hand-off" });
tlB.advance(4);
const afterHandoff = tlB.delivered("TicketsDeclared", (fact) => fact.sourceSlice === "ticket-desk#2").slice(-1)[0].payload.tickets;
assert(afterHandoff.length === 5 && afterHandoff[4].ticketId === "t-5", `The successor must number on from the predecessor, got ${JSON.stringify(afterHandoff.map((t) => t.ticketId))}.`);
assert(tlB.delivered("TicketOpened", (fact) => fact.payload.ticketId === "t-5").length === 1, "The successor must open windows once it is the desk.");
assert(tlB.delivered("TicketFiled").length === 5, "No filing may be doubled across the hand-off.");
console.log("ticket-desk: the work is facts, the minds bid, the desk awards, and the ledger survives.");
