import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The desk: the work as facts, on the same pool as everything else — never a
// second pool. A ticket is filed (by the rack, a harness, or a mind from
// inside its own turn), the desk calls for bids, every mind on the roster
// answers with a number, and the desk awards the highest — priority carried
// in the intent, ties by arrival, never a source name read (the arbitration
// law; everyone bidding 1 collapses to first-come). The winner works the
// ticket in one turn and closes it; a turn that ends without a close parks
// the ticket for a human's RESUME. Every ticket keeps the id of its filing
// fact, so a chip's click traces the whole job through the causality
// inspector: filing -> bids -> award -> the mind's tool calls -> its edits.
//
// The desk is the replay gate. Filings, bids, passes, notes, closes and
// resumes are journaled; while the workspace replays them the desk applies
// each silently — ledger and TicketsDeclared, but no TicketOpened and no
// TicketAssigned — so a reload never re-bids and never fires a model call:
// a doing ticket comes back parked, a todo one waits for a live event (a
// filing, a mind going idle, a new mind, a RESUME) to open its window. The
// roster is MindDeclared facts, never a mount list: a duplicated, renamed
// mind is a bidder the moment it declares. AgentAskRequested is the compat
// door: an ask files a ticket, tagged `ask`. Everything it knows travels as
// TicketsDeclared (rule 9), and a snapshot ring answers TimelineScrubbed.
// Self-contained: adoptable.
export const ticketDesk = defineSlice({
    type: "ticket-desk",
    description: "Owns the ticket ledger: files, calls for bids, awards, closes.",
    consumes: [
        "TicketFiled",
        "TicketBidPlaced",
        "TicketPassed",
        "TicketNoted",
        "TicketClosed",
        "TicketResumeRequested",
        "AgentAskRequested",
        "MindDeclared",
        "AgentTurnStarted",
        "AgentTurnEnded",
        "WorkspaceReplayed",
        "TimelineScrubbed",
        "TicketsDeclared",
        "SliceMounted",
        "SliceUnmounted",
    ],
    emits: ["TicketFiled", "TicketOpened", "TicketAssigned", "TicketsDeclared"],
    start(context) {
        const TICKET_LIMIT = 200;
        const NOTE_LIMIT = 40;
        const SNAPSHOT_LIMIT = 600;
        // The ledger, in filing order.
        const tickets = new Map();
        let serial = 0;
        let replayed = false;
        // The roster: every mind that declared itself, and whether it is idle.
        const roster = new Map();
        // Turns known to be live, so a scrub can tell a working ticket from a parked one.
        const liveTurns = new Set();
        // The fact id of each mind's bid on each ticket — the award's cause.
        const bidFacts = new Map();
        // One auction at a time, in filing order: the ticket whose window is
        // open now, and the ones queued for a window. An award lands before the
        // next call goes out, so a busy mind's pass and an idle mind's bid are
        // both true when they answer.
        let openTicket = null;
        const pendingOpen = [];
        // A successor (a hot reload of this slice) mirrors its predecessor until
        // the predecessor's SliceUnmounted, so the overlap frame never double-acts.
        // Desks mounted after this one are its successors, never its predecessor.
        let predecessor = null;
        let born = false;
        const successors = new Set();
        const cloneEntry = (entry) => ({
            ...entry,
            tags: [...entry.tags],
            bids: entry.bids.map((bid) => ({ ...bid })),
            passed: [...entry.passed],
            awaiting: [...entry.awaiting],
            notes: entry.notes.map((note) => ({ ...note })),
        });
        const entryOf = (ticket) => ({
            ticketId: ticket.ticketId,
            factId: ticket.factId,
            frame: ticket.frame,
            text: ticket.text,
            tags: [...ticket.tags],
            ...(ticket.parent === undefined ? {} : { parent: ticket.parent }),
            ...(ticket.effort === undefined ? {} : { effort: ticket.effort }),
            state: ticket.state,
            ...(ticket.to === undefined ? {} : { to: ticket.to }),
            bids: ticket.bids.map((bid) => ({ ...bid })),
            passed: [...ticket.passed],
            awaiting: [...ticket.awaiting],
            notes: ticket.notes.map((note) => ({ ...note })),
            working: ticket.working,
            ...(ticket.turnId === undefined ? {} : { turnId: ticket.turnId }),
            ...(ticket.outcome === undefined ? {} : { outcome: ticket.outcome }),
            ...(ticket.closeNote === undefined ? {} : { closeNote: ticket.closeNote }),
        });
        const ledger = () => [...tickets.values()].map(cloneEntry);
        const replaceLedger = (entries) => {
            tickets.clear();
            for (const entry of entries)
                tickets.set(entry.ticketId, cloneEntry(entry));
        };
        // Bounded ring of recorded states keyed by the frame their publishing
        // facts were delivered in; seek answers with the newest state at or
        // before the named frame.
        const snapshotRing = (limit) => {
            const ring = [];
            return {
                record(frame, state) {
                    ring.push({ frame, state });
                    if (ring.length > limit)
                        ring.shift();
                },
                seek(frameNumber) {
                    let target;
                    for (const shot of ring) {
                        if (shot.frame > frameNumber)
                            break;
                        target = shot;
                    }
                    return (target ?? ring[0])?.state;
                },
            };
        };
        const snapshots = snapshotRing(SNAPSHOT_LIMIT);
        const record = () => snapshots.record(context.frameNumber + 1, ledger());
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("TicketsDeclared", { tickets: ledger(), replayed, serial });
        };
        // Every mutation is recorded for the scrubber and declared for the board.
        const mutated = () => {
            record();
            declare();
        };
        // The oldest closed tickets leave the ledger once it outgrows the cap.
        const prune = () => {
            while (tickets.size > TICKET_LIMIT) {
                const victim = [...tickets.values()].find((entry) => entry.state === "done");
                if (victim === undefined)
                    break;
                tickets.delete(victim.ticketId);
                bidFacts.delete(victim.ticketId);
            }
        };
        // A window opens: bids and passes are wiped, and every mind on the roster
        // is awaited. The call itself (TicketOpened) goes out after the ledger is
        // declared, and only in a live workspace.
        const openWindow = (entry) => {
            entry.bids = [];
            entry.passed = [];
            entry.awaiting = [...roster.keys()];
            bidFacts.delete(entry.ticketId);
        };
        const openable = (entry) => entry.state === "todo" && entry.to === undefined;
        // Ask for a window: queued behind the open one, opened by pump(). A live
        // workspace only — while replaying, nothing opens.
        const requestOpen = (entry) => {
            if (!replayed || !openable(entry) || pendingOpen.includes(entry.ticketId))
                return;
            pendingOpen.push(entry.ticketId);
        };
        // Open the next queued window, if none is open. A window with nobody to
        // await (an empty roster) closes on the spot and the next one is tried.
        // Returns whether the ledger changed (the caller declares once).
        const pump = () => {
            let changed = false;
            while (openTicket === null && pendingOpen.length > 0) {
                const entry = tickets.get(pendingOpen.shift());
                if (entry === undefined || !openable(entry))
                    continue;
                openWindow(entry);
                changed = true;
                if (entry.awaiting.length === 0)
                    continue;
                openTicket = entry.ticketId;
            }
            return changed;
        };
        const callForBids = () => {
            const entry = openTicket === null ? undefined : tickets.get(openTicket);
            if (entry === undefined || !replayed)
                return;
            context.emit("TicketOpened", { ticketId: entry.ticketId, text: entry.text, tags: [...entry.tags] });
        };
        // Queue a window for a ticket (or every unserved one), open what can be
        // opened, declare, call. The declaration precedes the call, so a mind's
        // ledger cache is current when the call lands.
        const openNow = (due) => {
            for (const entry of due)
                requestOpen(entry);
            const before = openTicket;
            const changed = pump();
            if (changed)
                mutated();
            if (openTicket !== null && openTicket !== before)
                callForBids();
        };
        const reopenAll = () => openNow([...tickets.values()].filter(openable));
        // The award: once every awaited mind has answered, the highest bid from a
        // living mind wins; ties go to the earlier arrival. Returns the winning
        // bid's fact id (the award's cause), null when nothing was awarded.
        const settle = (entry) => {
            if (!openable(entry) || entry.awaiting.length > 0)
                return false;
            let winner;
            for (const bid of entry.bids) {
                if (!roster.has(bid.mind))
                    continue;
                if (winner === undefined || bid.bid > winner.bid)
                    winner = bid;
            }
            if (winner === undefined)
                return false;
            entry.to = winner.mind;
            entry.state = "doing";
            entry.working = false;
            return bidFacts.get(entry.ticketId)?.get(winner.mind) ?? null;
        };
        const award = (entry, cause) => {
            if (!replayed || entry.to === undefined)
                return;
            context.emit("TicketAssigned", {
                ticketId: entry.ticketId,
                to: entry.to,
                text: entry.text,
                tags: [...entry.tags],
                ...(entry.effort === undefined ? {} : { effort: entry.effort }),
            }, cause === null ? {} : { causedBy: [cause] });
        };
        // A window closed (awarded, passed over, or emptied): the next one opens.
        const windowClosed = (entry) => {
            if (openTicket === entry.ticketId)
                openTicket = null;
        };
        // A bid or a pass closes the mind's part of the window; the last answer
        // settles, and the award lands before the next window opens.
        const answered = (entry, mind) => {
            entry.awaiting = entry.awaiting.filter((name) => name !== mind);
            const cause = settle(entry);
            if (entry.awaiting.length === 0)
                windowClosed(entry);
            const before = openTicket;
            pump();
            mutated();
            if (cause !== false)
                award(entry, cause);
            if (openTicket !== null && openTicket !== before)
                callForBids();
        };
        const deferring = () => predecessor !== null;
        context.subscribe("TicketFiled", (fact) => {
            if (deferring())
                return;
            // Whitespace folds within a line; line breaks stay (a ticket may be a
            // short brief from the rack's text area), runs of blank lines to one.
            const text = fact.payload.text
                .split("\n")
                .map((line) => line.replace(/\s+/g, " ").trim())
                .join("\n")
                .replace(/\n{3,}/g, "\n\n")
                .trim();
            if (text === "")
                return;
            serial += 1;
            const tags = [...new Set((fact.payload.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
            const entry = {
                ticketId: `t-${serial}`,
                factId: fact.id,
                frame: fact.frame,
                text,
                tags,
                ...(fact.payload.parent === undefined ? {} : { parent: fact.payload.parent }),
                ...(fact.payload.effort === undefined ? {} : { effort: fact.payload.effort }),
                state: "todo",
                bids: [],
                passed: [],
                awaiting: [],
                notes: [],
                working: false,
            };
            tickets.set(entry.ticketId, entry);
            prune();
            const before = openTicket;
            requestOpen(entry);
            pump();
            mutated();
            if (openTicket !== null && openTicket !== before)
                callForBids();
        });
        // The compat door: an ask is a ticket, tagged so.
        context.subscribe("AgentAskRequested", (fact) => {
            if (deferring())
                return;
            context.emit("TicketFiled", {
                text: fact.payload.text,
                tags: ["ask"],
                ...(fact.payload.effort === undefined ? {} : { effort: fact.payload.effort }),
            });
        });
        context.subscribe("TicketBidPlaced", (fact) => {
            if (deferring())
                return;
            const entry = tickets.get(fact.payload.ticketId);
            if (entry === undefined || !openable(entry))
                return;
            const { mind, bid } = fact.payload;
            entry.passed = entry.passed.filter((name) => name !== mind);
            const known = entry.bids.find((placed) => placed.mind === mind);
            const placed = {
                mind,
                bid,
                ...(fact.payload.note === undefined ? {} : { note: fact.payload.note }),
            };
            if (known !== undefined)
                Object.assign(known, placed);
            else
                entry.bids.push(placed);
            let facts = bidFacts.get(entry.ticketId);
            if (facts === undefined)
                bidFacts.set(entry.ticketId, (facts = new Map()));
            facts.set(mind, fact.id);
            answered(entry, mind);
        });
        context.subscribe("TicketPassed", (fact) => {
            if (deferring())
                return;
            const entry = tickets.get(fact.payload.ticketId);
            if (entry === undefined || !openable(entry))
                return;
            const { mind } = fact.payload;
            entry.bids = entry.bids.filter((placed) => placed.mind !== mind);
            if (!entry.passed.includes(mind))
                entry.passed.push(mind);
            answered(entry, mind);
        });
        context.subscribe("TicketNoted", (fact) => {
            if (deferring())
                return;
            const entry = tickets.get(fact.payload.ticketId);
            if (entry === undefined)
                return;
            const text = fact.payload.text.trim();
            if (text === "")
                return;
            entry.notes.push({ by: fact.payload.by ?? fact.sourceSlice, text, frame: fact.frame });
            while (entry.notes.length > NOTE_LIMIT)
                entry.notes.shift();
            mutated();
        });
        context.subscribe("TicketClosed", (fact) => {
            if (deferring())
                return;
            const entry = tickets.get(fact.payload.ticketId);
            if (entry === undefined || entry.state === "done")
                return;
            entry.state = "done";
            entry.outcome = fact.payload.outcome;
            if (fact.payload.note !== undefined && fact.payload.note.trim() !== "")
                entry.closeNote = fact.payload.note.trim();
            else
                delete entry.closeNote;
            entry.working = false;
            entry.awaiting = [];
            prune();
            mutated();
        });
        // RESUME: a parked ticket goes back to its holder (or to bidding when the
        // holder is gone); a todo ticket nobody serves opens its window.
        context.subscribe("TicketResumeRequested", (fact) => {
            if (deferring())
                return;
            const entry = tickets.get(fact.payload.ticketId);
            if (entry === undefined)
                return;
            if (entry.state === "doing" && !entry.working) {
                if (entry.to !== undefined && roster.has(entry.to)) {
                    award(entry, null);
                    return;
                }
                delete entry.to;
                entry.state = "todo";
                openNow([entry]);
                return;
            }
            if (openable(entry) && entry.awaiting.length === 0)
                openNow([entry]);
        });
        // The roster: a new mind, or one coming free, re-opens every unserved ticket.
        context.subscribe("MindDeclared", (fact) => {
            const before = roster.get(fact.sourceSlice);
            roster.set(fact.sourceSlice, fact.payload.state);
            if (deferring())
                return;
            if (before === undefined || (before === "working" && fact.payload.state === "idle"))
                reopenAll();
        });
        context.subscribe("AgentTurnStarted", (fact) => {
            liveTurns.add(fact.payload.turnId);
            if (deferring())
                return;
            const ticketId = fact.payload.ticketId;
            const entry = ticketId === undefined ? undefined : tickets.get(ticketId);
            if (entry === undefined)
                return;
            entry.working = true;
            entry.turnId = fact.payload.turnId;
            mutated();
        });
        context.subscribe("AgentTurnEnded", (fact) => {
            liveTurns.delete(fact.payload.turnId);
            if (deferring())
                return;
            const entry = [...tickets.values()].find((candidate) => candidate.turnId === fact.payload.turnId);
            if (entry === undefined || !entry.working)
                return;
            // Still doing after its turn: parked, until a RESUME or a human's close.
            entry.working = false;
            mutated();
        });
        context.subscribe("SliceUnmounted", (fact) => {
            const gone = fact.payload.sliceId;
            if (gone === predecessor) {
                // The hand-off closes: this instance is the desk now.
                predecessor = null;
                return;
            }
            if (!roster.delete(gone))
                return;
            if (deferring())
                return;
            let changed = false;
            const awards = [];
            for (const entry of tickets.values()) {
                if (entry.awaiting.includes(gone)) {
                    entry.awaiting = entry.awaiting.filter((name) => name !== gone);
                    changed = true;
                    const cause = settle(entry);
                    if (entry.awaiting.length === 0)
                        windowClosed(entry);
                    if (cause !== false)
                        awards.push({ entry, cause });
                }
                if (entry.state === "doing" && entry.to === gone && entry.working) {
                    entry.working = false;
                    changed = true;
                }
            }
            const before = openTicket;
            if (pump())
                changed = true;
            if (!changed)
                return;
            mutated();
            for (const { entry, cause } of awards)
                award(entry, cause);
            if (openTicket !== null && openTicket !== before)
                callForBids();
        });
        // Live: from here on windows open. Nothing opens by itself on boot — a
        // doing ticket is parked, a todo one waits for a live event.
        context.subscribe("WorkspaceReplayed", () => {
            if (replayed)
                return;
            replayed = true;
            mutated();
        });
        // Time travel: the ledger as it was, published again; a restored doing
        // ticket is working only if its turn is still live.
        context.subscribe("TimelineScrubbed", (fact) => {
            if (deferring())
                return;
            const restored = snapshots.seek(fact.payload.frameNumber);
            if (restored === undefined)
                return;
            replaceLedger(restored);
            for (const entry of tickets.values()) {
                entry.working = entry.turnId !== undefined && liveTurns.has(entry.turnId);
                // A window in flight belongs to the history just left behind: the
                // restored ticket waits, parked, for a live event to open it again.
                if (openable(entry))
                    entry.awaiting = [];
            }
            openTicket = null;
            pendingOpen.length = 0;
            mutated();
        });
        // A successor seeds from the predecessor's declaration and mirrors it
        // until the predecessor unmounts; a late joiner reads the same fact.
        context.subscribe("TicketsDeclared", (fact) => {
            if (fact.sourceSlice === context.instanceId || successors.has(fact.sourceSlice))
                return;
            if (predecessor === null && (tickets.size > 0 || serial > 0))
                return;
            predecessor = fact.sourceSlice;
            replaceLedger(fact.payload.tickets.map(entryOf));
            serial = fact.payload.serial;
            replayed = fact.payload.replayed;
            mutated();
        });
        // Rule 9: a late joiner that listens gets the ledger as it stands.
        declare();
        context.subscribe("SliceMounted", (fact) => {
            if (fact.payload.sliceId === context.instanceId)
                born = true;
            else if (born && fact.payload.sliceType === context.sliceType)
                successors.add(fact.payload.sliceId);
            const consumes = fact.payload.consumes;
            if (!consumes.includes("TicketsDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
