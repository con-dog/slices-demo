import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The work log as a file. The ticket tree on the board IS the work log —
// filing, bids, award, the mind's tool calls, its edits, its close — but a
// reader outside the page (a human, or the LLM they hand the file to) needs
// it in one piece: where did the mind struggle, what did the digest tell it,
// how many rounds did it burn, why did the turn end. This slice keeps that
// record from facts already on the board — the thread's declaration, the
// desk's ledger, every turn's AgentToolCalled | AgentToolReturned |
// AgentSaid | AgentTurnEnded, plus the verdicts, refusals and violations a
// mind runs into — and answers WorkLogExportRequested (the trail panel's
// EXPORT, or the port) by handing out one JSON file. It owns the download
// the way clipboard owns the OS clipboard: a resource, behind a fact. Never
// journaled — an export is not workspace state. Bounded rings, oldest out.
// The body is self-contained, so the slice is adoptable.
export const workLog = defineSlice({
    type: "work-log",
    description: "Keeps the work log and hands it out as JSON: thread, tickets, turns, digests.",
    consumes: [
        "ThreadDeclared",
        "TicketsDeclared",
        "AgentTurnStarted",
        "AgentSaid",
        "AgentToolCalled",
        "AgentToolReturned",
        "AgentTurnEnded",
        "SliceErrorChanged",
        "IntentRefused",
        "ContractViolated",
        "WorkLogExportRequested",
    ],
    emits: ["WorkLogExported"],
    start(context) {
        const FORMAT = "slice-ide-work-log/1";
        const TURN_LIMIT = 200;
        const RING_LIMIT = 500;
        let thread = null;
        let tickets = [];
        // Insertion-ordered by first hearing; oldest evicted past the limit.
        const turns = new Map();
        const verdicts = [];
        const refusals = [];
        const violations = [];
        const bounded = (ring, entry) => {
            ring.push(entry);
            while (ring.length > RING_LIMIT)
                ring.shift();
        };
        const turnOf = (turnId, frame) => {
            const known = turns.get(turnId);
            if (known)
                return known;
            // A turn heard mid-flight (this slice mounted after it began) still
            // gets a record: mind unknown, start where first heard.
            const fresh = { turnId, mind: "?", text: "", startFrame: frame, events: [] };
            turns.set(turnId, fresh);
            while (turns.size > TURN_LIMIT) {
                const oldest = turns.keys().next().value;
                if (oldest === undefined)
                    break;
                turns.delete(oldest);
            }
            return fresh;
        };
        context.subscribe("ThreadDeclared", (fact) => {
            thread = {
                text: fact.payload.text,
                since: fact.payload.since,
                subject: [...fact.payload.subject],
                trail: fact.payload.trail.map((step) => ({ ...step })),
                away: fact.payload.away,
            };
        });
        context.subscribe("TicketsDeclared", (fact) => {
            tickets = fact.payload.tickets.map((ticket) => ({
                ...ticket,
                tags: [...ticket.tags],
                bids: ticket.bids.map((bid) => ({ ...bid })),
                passed: [...ticket.passed],
                awaiting: [...ticket.awaiting],
                notes: ticket.notes.map((note) => ({ ...note })),
            }));
        });
        context.subscribe("AgentTurnStarted", (fact) => {
            const turn = turnOf(fact.payload.turnId, fact.frame);
            turn.mind = fact.sourceSlice;
            turn.text = fact.payload.text;
            turn.startFrame = fact.frame;
            if (fact.payload.ticketId !== undefined)
                turn.ticketId = fact.payload.ticketId;
        });
        context.subscribe("AgentSaid", (fact) => {
            turnOf(fact.payload.turnId, fact.frame).events.push({ frame: fact.frame, kind: "said", text: fact.payload.text });
        });
        context.subscribe("AgentToolCalled", (fact) => {
            turnOf(fact.payload.turnId, fact.frame).events.push({
                frame: fact.frame,
                kind: "call",
                toolUseId: fact.payload.toolUseId,
                name: fact.payload.name,
                input: fact.payload.input,
            });
        });
        context.subscribe("AgentToolReturned", (fact) => {
            turnOf(fact.payload.turnId, fact.frame).events.push({
                frame: fact.frame,
                kind: "return",
                toolUseId: fact.payload.toolUseId,
                text: fact.payload.text,
                isError: fact.payload.isError,
            });
        });
        context.subscribe("AgentTurnEnded", (fact) => {
            const turn = turnOf(fact.payload.turnId, fact.frame);
            turn.endFrame = fact.frame;
            turn.stopReason = fact.payload.stopReason;
            turn.usage = { ...fact.payload.usage };
            if (fact.payload.error !== undefined)
                turn.error = fact.payload.error;
        });
        context.subscribe("SliceErrorChanged", (fact) => {
            bounded(verdicts, {
                frame: fact.frame,
                sliceId: fact.payload.sliceId,
                errored: fact.payload.errored,
                ...(fact.payload.message === undefined ? {} : { message: fact.payload.message }),
            });
        });
        context.subscribe("IntentRefused", (fact) => {
            bounded(refusals, { frame: fact.frame, ...fact.payload });
        });
        context.subscribe("ContractViolated", (fact) => {
            bounded(violations, {
                frame: fact.frame,
                factType: fact.payload.factType,
                sourceSlice: fact.payload.sourceSlice,
                reason: fact.payload.reason,
            });
        });
        // The file: tickets in filing order, each carrying the turns that
        // worked it (rounds counted, so a struggle reads at a glance); turns no
        // ticket claims (a mid-flight mount, a pruned ledger) listed after.
        const build = () => {
            const allTurns = [...turns.values()];
            const claimed = new Set();
            const describe = (turn) => ({
                ...turn,
                rounds: turn.events.filter((event) => event.kind === "call").length,
                errors: turn.events.filter((event) => event.kind === "return" && event.isError).length,
            });
            const ticketRows = tickets.map((ticket) => {
                const own = allTurns.filter((turn) => turn.ticketId === ticket.ticketId);
                for (const turn of own)
                    claimed.add(turn.turnId);
                return { ...ticket, turns: own.map(describe) };
            });
            const unticketed = allTurns.filter((turn) => !claimed.has(turn.turnId)).map(describe);
            const stepCount = thread?.trail.length ?? 0;
            const log = {
                format: FORMAT,
                frame: context.frameNumber,
                exportedAt: new Date().toISOString(),
                thread,
                tickets: ticketRows,
                unticketed,
                verdicts: [...verdicts],
                refusals: [...refusals],
                violations: [...violations],
            };
            return { json: JSON.stringify(log, null, 2), tickets: ticketRows.length, turns: allTurns.length, steps: stepCount };
        };
        // The download: a Blob behind an anchor, clicked and gone. The one place
        // this slice touches the page, and only for the click.
        const download = (fileName, json) => {
            const blob = new Blob([json], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = fileName;
            anchor.style.display = "none";
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        context.subscribe("WorkLogExportRequested", () => {
            const built = build();
            const fileName = `slice-ide-work-log-frame-${context.frameNumber}.json`;
            download(fileName, built.json);
            context.emit("WorkLogExported", {
                fileName,
                bytes: new TextEncoder().encode(built.json).length,
                tickets: built.tickets,
                turns: built.turns,
                steps: built.steps,
            });
        });
    },
});
