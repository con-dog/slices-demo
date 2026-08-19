import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { schemaBook } from "../slices/schema-book.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The work log: the ticket tree as one file ---
// A mind's turn (its tool calls, the digests it read, what it said, how it
// ended), the desk's ledger, the thread and its trail, the verdicts it ran
// into: WorkLogExportRequested makes one JSON of it and hands it out. The
// download is a resource: here the page is a stub that captures the file.
// The download surface: document.createElement("a").click() on a Blob URL.
const captured = [];
let pendingName = "";
globalThis.document = {
    createElement: () => ({
        style: {},
        set download(name) {
            pendingName = name;
        },
        href: "",
        click() { },
        remove() { },
    }),
    body: { append: () => { } },
};
const realCreate = URL.createObjectURL;
URL.createObjectURL = (blob) => {
    captured.push({ name: "", blob });
    return "blob:test";
};
URL.revokeObjectURL = () => { };
const { workLog } = await import("../slices/work-log.js");
const defineSlice = sliceDefinerFor();
const speaker = (type, payload, instanceId) => [
    defineSlice({
        type: `test-${type.toLowerCase()}`,
        consumes: [],
        emits: [type],
        start(context) {
            context.emit(type, payload);
        },
    }),
    instanceId,
];
const pool = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(workLog, { instanceId: "work-log#1" });
timeline.advance(2);
// Each speaker mounts under the id the fact should come from, speaks in
// start, and leaves once heard, so the same mind can speak again.
let serial = 0;
const say = (type, payload, instanceId) => {
    const [slice, id] = speaker(type, payload, instanceId);
    serial += 1;
    const mountId = id ?? `${slice.type}#${serial}`;
    pool.mount(slice, { instanceId: mountId });
    timeline.advance(2);
    pool.unmount(mountId);
    timeline.advance(1);
};
// A ticket worked by a mind: filed, awarded, one round of tool use, a
// verdict along the way, closed. The ledger arrives as TicketsDeclared (the
// desk's word); the turn arrives as the mind's facts.
say("ThreadDeclared", {
    text: "make slice-1 count lines",
    since: 3,
    subject: ["slice-1"],
    trail: [
        { frame: 3, kind: "pin", note: "make slice-1 count lines", times: 1 },
        { frame: 9, kind: "edit", note: "slice-1", times: 4 },
        { frame: 12, kind: "verdict", note: "slice-1: Unexpected token", times: 1 },
    ],
    away: 0,
});
say("TicketsDeclared", {
    tickets: [
        {
            ticketId: "t-1",
            factId: "9:1",
            frame: 9,
            text: "count lines in slice-1",
            tags: ["ask"],
            state: "done",
            to: "agent-mind#1",
            bids: [{ mind: "agent-mind#1", bid: 1 }],
            passed: [],
            awaiting: [],
            notes: [{ by: "agent-mind#1", text: "reading first", frame: 11 }],
            working: false,
            turnId: "agent-mind#1:turn-1",
            outcome: "done",
            closeNote: "mounted clean",
        },
    ],
    replayed: true,
    serial: 1,
});
say("AgentTurnStarted", { turnId: "agent-mind#1:turn-1", text: "count lines in slice-1", ticketId: "t-1" }, "agent-mind#1");
say("AgentToolCalled", { turnId: "agent-mind#1:turn-1", toolUseId: "call-1", name: "edit", input: { fileId: "slice-1", edit: { kind: "insert", text: "x" } } }, "agent-mind#1");
say("AgentToolReturned", { turnId: "agent-mind#1:turn-1", toolUseId: "call-1", text: "frame 12 | doc slice-1 rev 2\nfacts: EditRequested -> BufferChanged", isError: false }, "agent-mind#1");
say("SliceErrorChanged", { sliceId: "slice-1#1", errored: true, message: "Unexpected token" }, "foundry#1");
say("AgentToolCalled", { turnId: "agent-mind#1:turn-1", toolUseId: "call-2", name: "read", input: { fileId: "nope" } }, "agent-mind#1");
say("AgentToolReturned", { turnId: "agent-mind#1:turn-1", toolUseId: "call-2", text: "no such document", isError: true }, "agent-mind#1");
say("AgentSaid", { turnId: "agent-mind#1:turn-1", text: "Fixed and closing." }, "agent-mind#1");
say("AgentTurnEnded", { turnId: "agent-mind#1:turn-1", stopReason: "end_turn", usage: { input: 1200, output: 80, cacheRead: 900, cacheWrite: 0 } }, "agent-mind#1");
say("IntentRefused", { intent: "EditRequested", fileId: "clock", reason: "locked", priority: 1, minPriority: 10 }, "editor-buffer#1");
// A stray turn from before this log mounted (no start heard): still kept.
say("AgentSaid", { turnId: "agent-mind#1:turn-0", text: "hello" }, "agent-mind#1");
// The press: one fact in, one file out, one fact back.
say("WorkLogExportRequested", {}, "thread-plate#1");
const exported = timeline.delivered("WorkLogExported")[0];
assert(exported !== undefined, "The press must be answered with WorkLogExported.");
assert(captured.length === 1, `Exactly one file must be handed out, got ${captured.length}.`);
assert(exported.payload.fileName === pendingName && /^slice-ide-work-log-frame-\d+\.json$/.test(pendingName), `The fact names the file the anchor downloaded, got ${exported.payload.fileName} vs ${pendingName}.`);
assert(exported.payload.tickets === 1 && exported.payload.turns === 2 && exported.payload.steps === 3, `The fact counts what it held, got ${JSON.stringify(exported.payload)}.`);
const text = await captured[0].blob.text();
assert(exported.payload.bytes === new TextEncoder().encode(text).length, "bytes is the file's size.");
const log = JSON.parse(text);
assert(log.format === "slice-ide-work-log/1", "The file names its format.");
assert(log.thread.text === "make slice-1 count lines" && log.thread.trail.length === 3, "The thread and its trail are in the file.");
const ticket = log.tickets[0];
assert(ticket.ticketId === "t-1" && ticket.outcome === "done" && ticket.turns.length === 1, `The ticket carries its turn, got ${JSON.stringify(ticket)}.`);
const turn = ticket.turns[0];
assert(turn.mind === "agent-mind#1" && turn.rounds === 2 && turn.errors === 1 && turn.usage.input === 1200, `The turn is described: mind, rounds, errors, usage — got ${JSON.stringify(turn)}.`);
assert(turn.events.map((event) => event.kind).join(",") === "call,return,call,return,said", `The turn's events are in order, got ${turn.events.map((event) => event.kind).join(",")}.`);
assert(log.unticketed.length === 1 && log.unticketed[0].turnId === "agent-mind#1:turn-0" && log.unticketed[0].mind === "?", "A turn no ticket claims is listed after, mind unknown.");
assert(log.verdicts.length === 1 && log.verdicts[0].sliceId === "slice-1#1" && log.verdicts[0].errored, "Verdicts are in the file.");
assert(log.refusals.length === 1 && log.refusals[0].reason === "locked", "Refusals are in the file.");
URL.createObjectURL = realCreate;
console.log("work-log: one press, one JSON — thread, tickets with their turns and digests, verdicts and refusals.");
