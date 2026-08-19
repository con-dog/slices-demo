import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The resident author: agent-port with a brain and without a window. It
// works tickets: it bids on every TicketOpened the desk calls (a number from
// the constants at the top of its body — its own visible opinion), and when
// TicketAssigned names it, assembles a Messages API request from what the
// board already told it — the guide-book's manual, the api-book's context
// reference, the rule-book's law, the schema-book's vocabulary — and hands
// it to the model-port as ModelCallRequested. Every tool the model may call
// is either an intent of the human's own vocabulary (edit, undo, proof,
// operate…) emitted at machine priority 1, or a cache read (read, outline,
// facts, trace) that costs the history nothing; every tool's answer is a digest of
// what the cascade changed, rendered by the same cascade-digest the port
// uses (duplicated here, rule 6). So an AI edit is inspectable history: TicketAssigned →
// ModelCallRequested → ModelReturned → AgentToolCalled → EditRequested →
// BufferChanged → AgentToolReturned → …, scrubbable on the timeline, and the
// EditRequested facts journal like typing (the turn does not — a model turn is
// not deterministic; its edits are). Several minds may live at once — DUPLICATE
// this slice and edit its constants to make a specialist; each declares itself
// as MindDeclared, so the desk's roster is facts, never a mount list. The body
// is self-contained: this mind is adoptable, so the agent's prompt and loop
// are a document you can edit from inside while it runs.
export const agentMind = defineSlice({
    type: "agent-mind",
    description: "The resident author: bids on tickets, works them as model turns.",
    consumes: ["*", "TicketOpened", "TicketAssigned"],
    emits: [
        "MindDeclared",
        "TicketBidPlaced",
        "TicketPassed",
        "TicketFiled",
        "TicketNoted",
        "TicketClosed",
        "AgentTurnStarted",
        "AgentSaid",
        "AgentToolCalled",
        "AgentToolReturned",
        "AgentTurnEnded",
        "ModelCallRequested",
        "EditRequested",
        "SliceSelected",
        "SliceHideRequested",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
        "StepPressed",
        "StepBackPressed",
        "ProofRequested",
        "OperateRequested",
        "ThreadPinRequested",
    ],
    start(context) {
        // The machine author's rank (rule 7): the keyboard types at 10.
        const AGENT_PRIORITY = 1;
        // --- This mind's charter: what it is for, and how it bids. DUPLICATE the
        // slice and edit these five lines to make a specialist; the desk reads
        // only the numbers. bid = BASE_BID + TAG_BONUS per tag the ticket shares
        // with TAGS − BUSY_PENALTY while a turn is live (the desk auctions one
        // ticket at a time, so an award lands before the next call); a bid of 0
        // or less is a pass. Every mind identical means arrival order wins — the
        // desk's first-come rule.
        const SPECIALTY = "general";
        const TAGS = [];
        const BASE_BID = 1;
        const TAG_BONUS = 2;
        const BUSY_PENALTY = 1;
        const MAX_TOKENS = 16000;
        const TOOL_ROUNDS_LIMIT = 24;
        // The session's conversation is bounded by whole turns, cut only at a
        // turn's opening user message so tool_use/tool_result pairs stay whole.
        const CONVERSATION_MESSAGE_LIMIT = 60;
        const RING_LIMIT = 5000;
        const FACTS_DEFAULT_LIMIT = 40;
        const TRACE_NODE_LIMIT = 60;
        const SETTLE_TIMEOUT_MS = 3000;
        const SETTLE_QUIET_BEATS = 2;
        const DIGEST_CONTEXT_LINES = 3;
        const DIGEST_LINE_WIDTH = 120;
        const DIGEST_CHAR_LIMIT = 2000;
        const DIGEST_NEW_DOC_LINES = 8;
        const DIGEST_FACT_TYPES = 14;
        const OUTLINE_TAG_LIMIT = 8;
        // --- Caches (rule-6 twin of the port's): the workspace as the mind sees it. ---
        const ring = [];
        const byId = new Map();
        const childrenOf = new Map();
        let totalFacts = 0;
        const documents = new Map();
        const slices = new Map();
        let vocabulary = [];
        let schemaShapes = {};
        let guideTopics = [];
        let apiEntries = [];
        let lintRules = [];
        // The locks as the lock-book declared them: type -> the minimum priority
        // an intent needs. This mind writes at 1, so every entry refuses it; the
        // outline marks them, and the digest says `refused:` when one bites.
        let locks = {};
        // The chartered views' charters: view type -> every type the config names.
        const charters = new Map();
        let activeFileId = null;
        let replayed = false;
        let active = true;
        // The thread as its owner last declared it: what the human is doing,
        // and what happened since — the one line a fresh turn ramps from.
        let thread = { text: "", since: -1, subject: [], trail: [], away: 0 };
        const THREAD_TRAIL_LINES = 8;
        // The ledger as the desk last declared it.
        let tickets = [];
        // The stage, overheard (rule-6 twin of the port's): seats, holders, tokens.
        let stageSlots = [];
        const stageHeld = new Map();
        const stageDenied = new Map();
        let stageTokens = {};
        const kitMarked = (startSource) => {
            const brace = startSource.indexOf("{");
            if (brace === -1)
                return false;
            return startSource.slice(brace + 1).trimStart().startsWith("// kit:");
        };
        // The books version the cached system prompt was rendered from.
        let booksVersion = 0;
        let systemVersion = -1;
        let systemCache = "";
        const baselines = new Map();
        // Fact ids of SliceMounted re-publications (rule 9 from the pool): known
        // instances told again to a newcomer, never births in a digest.
        const republished = new Set();
        // The document roster as the last digest rendered it (from the buffer's
        // `fileIds`), so the next digest can name what appeared or vanished.
        let roster = [];
        const viewOf = (fact) => ({
            id: fact.id,
            type: fact.type,
            frame: fact.frame,
            sourceSlice: fact.sourceSlice,
            causedBy: [...fact.causedBy],
            payload: fact.payload,
        });
        const documentOf = (payload) => ({
            fileId: payload.fileId,
            meta: {
                type: payload.meta.type,
                description: payload.meta.description,
                consumes: [...payload.meta.consumes],
                emits: [...payload.meta.emits],
            },
            lines: [...payload.lines],
            caret: { ...payload.caret },
            anchor: payload.anchor === null ? null : { ...payload.anchor },
            revision: payload.revision,
        });
        // --- Text renderings: the diet the model reads. ---
        const clip = (text, width) => text.length > width ? `${text.slice(0, width - 1)}…` : text;
        const tagList = (tags) => tags.length === 0
            ? "-"
            : tags.length > OUTLINE_TAG_LIMIT
                ? `${tags.slice(0, OUTLINE_TAG_LIMIT).join(",")} +${tags.length - OUTLINE_TAG_LIMIT}`
                : tags.join(",");
        const numbered = (lines, from, to) => {
            const width = String(to).length;
            const out = [];
            for (let index = from; index <= to; index += 1) {
                const text = lines[index - 1];
                if (text === undefined)
                    continue;
                out.push(`${String(index).padStart(width, " ")}| ${clip(text, DIGEST_LINE_WIDTH)}`);
            }
            return out;
        };
        // What one settled window changed, as text: the cascade itself (every
        // fact type in order, with counts), the revision move per document with
        // the touched lines in context, the roster's moves (documents that
        // appeared or vanished — a delete, a create, a scrub), slice mounts,
        // unmounts and verdicts, the violations, lint, dead letters
        // — never the whole workspace; and when nothing changed, WHY (a missed
        // find, nothing to change, an unknown id, a lock that outranked the
        // intent), never one word for four diagnoses. Refusals (IntentRefused)
        // always print, even beside a change: an open that landed next to a
        // bounced edit must not read as the edit landing. Renders against the
        // per-document baseline of the previous digest, then advances it.
        const renderDigest = (window) => {
            const out = [];
            const active = activeFileId === null ? undefined : documents.get(activeFileId);
            const erroredCount = [...slices.values()].filter((entry) => entry.errored).length;
            out.push(`frame ${context.frameNumber} | doc ${active?.fileId ?? "-"}` +
                (active
                    ? ` rev ${active.revision} caret ${active.caret.line + 1}:${active.caret.column + 1}`
                    : "") +
                ` | slices ${slices.size}` +
                (erroredCount > 0 ? ` (${erroredCount} errored)` : ""));
            // The cascade, one line: every type in the window in first-appearance
            // order with a count — the facts are the product, not just their
            // residue in text and mounts.
            const seenTypes = new Map();
            for (const fact of window)
                seenTypes.set(fact.type, (seenTypes.get(fact.type) ?? 0) + 1);
            if (seenTypes.size > 0) {
                const shown = [...seenTypes].slice(0, DIGEST_FACT_TYPES);
                out.push(`facts: ${shown.map(([type, count]) => (count > 1 ? `${type} x${count}` : type)).join(" -> ")}` +
                    (seenTypes.size > shown.length ? ` +${seenTypes.size - shown.length} types` : ""));
            }
            // Documents: the last publication per file inside the window wins, and
            // the last publication of all carries the roster — which documents
            // exist now. Its moves against the previous digest's roster are said
            // aloud, so a vanished document is never a surprise on the next read.
            // A file is "restored" only when no BufferChanged for it is in the
            // window: a rule-9 re-publication landing beside an edit (a newcomer
            // that consumes the document) must not relabel the edit.
            const touched = new Map();
            let rosterNow = null;
            for (const fact of window) {
                if (fact.type !== "BufferChanged" && fact.type !== "BufferRestored")
                    continue;
                const { fileId, fileIds } = fact.payload;
                const prior = touched.get(fileId);
                touched.set(fileId, {
                    restored: fact.type === "BufferRestored" && (prior === undefined || prior.restored),
                    frame: fact.frame,
                });
                if (fileIds !== undefined)
                    rosterNow = fileIds;
            }
            // Refusals: an owner said no and why — a lock the intent's priority
            // fell below, the immortal last document. Read off the window's own
            // facts, printed whatever else happened.
            const refusals = window
                .filter((fact) => fact.type === "IntentRefused")
                .map((fact) => {
                const verdict = fact.payload;
                const why = verdict.reason === "locked"
                    ? `locked: needs priority >= ${verdict.minPriority ?? "?"}, got ${verdict.priority ?? "?"} — a human unlocks it (LOCK|UNLOCK in the toolbar); do not work around it`
                    : verdict.reason === "immortal"
                        ? "the last document is immortal"
                        : verdict.reason;
                return `${verdict.intent} on ${verdict.fileId} (${why})`;
            });
            // Nothing changed — say which nothing. Four diagnoses used to share one
            // string; each gets its own word, read off the window's own facts.
            const noopReason = () => {
                if (refusals.length > 0)
                    return " | refused (see refused:)";
                if (window.some((fact) => fact.type === "ContractViolated"))
                    return " | malformed intent (see violations)";
                const edits = window
                    .filter((fact) => fact.type === "EditRequested")
                    .map((fact) => fact.payload.edit);
                if (edits.length > 0) {
                    // The workspace boots empty: an edit with nothing open lands nowhere.
                    if (documents.size === 0)
                        return " | no document open (SliceCreateRequested opens one)";
                    const misses = edits.filter((edit) => edit.kind === "replace-match");
                    if (misses.length > 0) {
                        return ` | replace-match missed: ${misses.map((edit) => JSON.stringify(clip(edit.find ?? "", 40))).join(", ")}`;
                    }
                    const kinds = [...new Set(edits.map((edit) => edit.kind))];
                    if (kinds.every((kind) => kind === "caret-move" || kind === "caret-set" || kind === "select-all")) {
                        return " | caret only";
                    }
                    return ` | nothing to change (${kinds.join(", ")})`;
                }
                for (const type of ["SliceDeleteRequested", "SliceDuplicateRequested", "SliceSelected", "SliceHideRequested"]) {
                    const intent = window.find((fact) => fact.type === type);
                    if (intent === undefined)
                        continue;
                    const sliceId = intent.payload.sliceId ?? "";
                    const typeName = sliceId.split("#")[0];
                    const known = [...slices.values()].some((entry) => entry.sliceType === typeName) || documents.has(typeName);
                    if (!known)
                        return ` | ${type}: no such slice or document ${JSON.stringify(sliceId)}`;
                    if (type === "SliceSelected")
                        return " | SliceSelected: already open";
                    if (type === "SliceDeleteRequested")
                        return " | SliceDeleteRequested: refused (the last document is immortal)";
                    if (type === "SliceHideRequested") {
                        return window.some((fact) => fact.type === "SliceVisibilityChanged")
                            ? " | visibility toggled (no document change)"
                            : " | SliceHideRequested: no effect";
                    }
                    return ` | ${type}: no effect`;
                }
                return "";
            };
            // Said only when something in the window COULD have changed a document
            // — an edit or a workspace intent. A proof, a read, a select of what is
            // already open leave the line out: silence about the untouched is not
            // a diagnosis.
            const couldHaveChanged = window.some((fact) => fact.type === "EditRequested" ||
                fact.type === "SliceCreateRequested" ||
                fact.type === "SliceDuplicateRequested" ||
                fact.type === "SliceDeleteRequested" ||
                fact.type === "SliceHideRequested" ||
                fact.type === "StepBackPressed" ||
                fact.type === "StepPressed" ||
                fact.type === "TimelineScrubbed");
            if (touched.size === 0 && couldHaveChanged)
                out.push(`no BufferChanged${noopReason()}`);
            else if (window.length === 0)
                out.push("nothing since the last digest");
            if (refusals.length > 0)
                out.push(`refused: ${[...new Set(refusals)].join(" | ")}`);
            if (rosterNow !== null) {
                const before = new Set(roster);
                const after = new Set(rosterNow);
                const moves = [
                    ...rosterNow.filter((id) => !before.has(id)).map((id) => `+${id}`),
                    ...roster.filter((id) => !after.has(id)).map((id) => `-${id}`),
                ];
                // The first roster of a session is the seed, not a move.
                if (roster.length > 0 && moves.length > 0)
                    out.push(`docs: ${moves.join(" ")}`);
                roster = [...rosterNow];
            }
            for (const [fileId, mark] of touched) {
                const doc = documents.get(fileId);
                if (doc === undefined)
                    continue;
                const base = baselines.get(fileId);
                const verb = mark.restored ? "restored" : "rev";
                // A re-publication of what the last digest already showed — same
                // revision, same text — is not a change; say nothing about it.
                if (base !== undefined &&
                    base.frame !== mark.frame &&
                    base.revision === doc.revision &&
                    base.lines.length === doc.lines.length &&
                    base.lines.every((line, at) => line === doc.lines[at])) {
                    continue;
                }
                if (base === undefined || base.frame === mark.frame) {
                    // First sighting: the whole document is the change — show its head.
                    const shown = Math.min(doc.lines.length, DIGEST_NEW_DOC_LINES);
                    out.push(`+ ${fileId} ${verb} ${doc.revision} (${doc.lines.length} lines)`);
                    out.push(...numbered(doc.lines, 1, shown));
                    if (doc.lines.length > shown)
                        out.push(`  … ${doc.lines.length - shown} more`);
                }
                else {
                    let first = 0;
                    const limit = Math.min(base.lines.length, doc.lines.length);
                    while (first < limit && base.lines[first] === doc.lines[first])
                        first += 1;
                    let tailBase = base.lines.length - 1;
                    let tailDoc = doc.lines.length - 1;
                    while (tailBase >= first && tailDoc >= first && base.lines[tailBase] === doc.lines[tailDoc]) {
                        tailBase -= 1;
                        tailDoc -= 1;
                    }
                    if (first > tailDoc && base.lines.length === doc.lines.length) {
                        out.push(`~ ${fileId} ${verb} ${base.revision}->${doc.revision} (meta only)`);
                    }
                    else {
                        const from = Math.max(1, first + 1 - DIGEST_CONTEXT_LINES);
                        const to = Math.min(doc.lines.length, Math.max(first, tailDoc) + 1 + DIGEST_CONTEXT_LINES);
                        const removed = tailBase - first + 1;
                        const added = tailDoc - first + 1;
                        out.push(`~ ${fileId} ${verb} ${base.revision}->${doc.revision} lines ${first + 1}-${Math.max(first + 1, tailDoc + 1)}` +
                            (removed !== added ? ` (${added >= 0 ? added : 0} in, ${removed >= 0 ? removed : 0} out)` : ""));
                        out.push(...numbered(doc.lines, from, to));
                    }
                }
                baselines.set(fileId, {
                    revision: doc.revision,
                    lines: [...doc.lines],
                    frame: mark.frame,
                });
            }
            // Slices: births and deaths in order, then the last error verdict per
            // slice (a hot reload clears and re-flags; only the final word counts).
            const sliceNotes = [];
            const errorNotes = new Map();
            for (const fact of window) {
                const payload = fact.payload;
                if (fact.type === "SliceMounted") {
                    if (!republished.has(fact.id))
                        sliceNotes.push(`+${payload.sliceId}`);
                }
                else if (fact.type === "SliceUnmounted")
                    sliceNotes.push(`-${payload.sliceId}`);
                else if (fact.type === "SliceErrorChanged") {
                    errorNotes.set(payload.sliceId, payload.errored
                        ? `!${payload.sliceId} ${JSON.stringify(clip(payload.message ?? "", DIGEST_LINE_WIDTH))}`
                        : `ok ${payload.sliceId}`);
                }
            }
            sliceNotes.push(...errorNotes.values());
            if (sliceNotes.length > 0)
                out.push(`slices: ${sliceNotes.join(" ")}`);
            // Silence is a verdict too: a document changed but no instance moved —
            // a content-identical save or a navigation open. Said aloud, so nobody
            // mistakes text for behaviour.
            else if (touched.size > 0)
                out.push("slices: unchanged (no mount, unmount, or verdict in this cascade)");
            // Verdicts: one summary line (lint | violations | sketched | proofs), then
            // the findings themselves, indented — only what actually happened.
            const summary = [];
            const details = [];
            const lint = [...window].reverse().find((fact) => fact.type === "DiagnosticsPublished");
            if (lint !== undefined) {
                const found = lint.payload.diagnostics;
                if (found.length > 0) {
                    summary.push(`${found.length} lint`);
                    for (const entry of found.slice(0, 4)) {
                        const finding = entry;
                        const label = finding.ruleId ?? finding.id ?? "lint";
                        details.push(`  ${label}${finding.line !== undefined ? ` L${finding.line + 1}` : ""}: ${clip(finding.message ?? "", DIGEST_LINE_WIDTH)}`);
                    }
                }
            }
            const violations = window.filter((fact) => fact.type === "ContractViolated");
            if (violations.length > 0) {
                summary.push(`${violations.length} violations`);
                for (const fact of violations.slice(0, 4)) {
                    const verdict = fact.payload;
                    details.push(`  ${verdict.factType} ${verdict.reason} from ${verdict.sourceSlice}`);
                }
            }
            const sketched = new Set();
            for (const fact of window) {
                if (fact.type !== "ContractSketched")
                    continue;
                for (const type of fact.payload.types)
                    sketched.add(type);
            }
            if (sketched.size > 0)
                summary.push(`sketched: ${[...sketched].join(",")}`);
            // Dead letters: a touched document's emits that no living slice
            // consumes (a wildcard consumer does not count, as in the visualizer —
            // except for the types its CHARTER names, ViewConfigDeclared being on
            // the board) — the commonest way a slice mounts green and does nothing.
            const dead = [];
            for (const fileId of touched.keys()) {
                const doc = documents.get(fileId);
                if (doc === undefined)
                    continue;
                for (const type of doc.meta.emits) {
                    const consumed = [...slices.values()].some((entry) => entry.consumes.includes(type) || (charters.get(entry.sliceType)?.has(type) ?? false));
                    if (!consumed && !dead.includes(type))
                        dead.push(type);
                }
            }
            if (dead.length > 0)
                summary.push(`dead letters: ${dead.join(",")} (no living consumer)`);
            for (const fact of window) {
                if (fact.type !== "ProofReturned")
                    continue;
                const report = fact.payload;
                summary.push(`proof ${report.proofId}: ${report.ok ? "ok" : `${report.verdicts.length} verdicts`}`);
                for (const entry of report.verdicts.slice(0, 6)) {
                    details.push(`  ${entry.kind}${entry.line !== undefined ? ` L${entry.line + 1}` : ""}: ${clip(entry.message, DIGEST_LINE_WIDTH)}`);
                }
            }
            if (summary.length > 0)
                out.push(`verdicts: ${summary.join(" | ")}`, ...details);
            const text = out.join("\n");
            return text.length > DIGEST_CHAR_LIMIT
                ? `${text.slice(0, DIGEST_CHAR_LIMIT - 12)}\n… (clipped)`
                : text;
        };
        const renderRead = (options = {}) => {
            const fileId = options.fileId ?? activeFileId;
            const doc = fileId === null ? undefined : documents.get(fileId);
            if (fileId === null || doc === undefined) {
                return `no document ${fileId ?? "(none active)"} | documents: ${[...documents.keys()].join(",") || "-"}`;
            }
            const from = Math.max(1, options.from ?? 1);
            const to = Math.min(doc.lines.length, options.to ?? doc.lines.length);
            const header = `${doc.fileId} | rev ${doc.revision} | ${doc.lines.length} lines | ` +
                `type=${doc.meta.type} desc=${JSON.stringify(doc.meta.description)} ` +
                `in=[${doc.meta.consumes.join(",")}] out=[${doc.meta.emits.join(",")}]` +
                (from > 1 || to < doc.lines.length ? ` | showing ${from}-${to}` : "");
            const width = String(to).length;
            const body = [];
            for (let index = from; index <= to; index += 1) {
                body.push(`${String(index).padStart(width, " ")}| ${doc.lines[index - 1] ?? ""}`);
            }
            return [header, ...body].join("\n");
        };
        // The desk's ledger in one line: counts by state, then this mind's own.
        const renderTicketsLine = () => {
            const todo = tickets.filter((ticket) => ticket.state === "todo").length;
            const doing = tickets.filter((ticket) => ticket.state === "doing");
            const parked = doing.filter((ticket) => !ticket.working).length;
            const done = tickets.filter((ticket) => ticket.state === "done").length;
            const mine = tickets.filter((ticket) => ticket.to === context.instanceId && ticket.state === "doing");
            return (`tickets: ${todo} todo | ${doing.length} doing${parked > 0 ? ` (${parked} parked)` : ""} | ${done} done` +
                (mine.length > 0 ? ` | mine: ${mine.map((ticket) => ticket.ticketId).join(",")}` : ""));
        };
        const renderOutline = () => {
            const out = [];
            out.push(`frame ${context.frameNumber} | active ${activeFileId ?? "-"} | ${replayed ? "live" : "booting"} | vocabulary ${vocabulary.length} types`);
            out.push(renderTicketsLine());
            const lockMark = (type) => (locks[type] ?? 0) > 0 ? ` | locked >=${locks[type]}` : "";
            out.push(`documents (${documents.size}):`);
            for (const [fileId, doc] of [...documents].sort(([a], [b]) => a.localeCompare(b))) {
                out.push(`  ${fileId} | rev ${doc.revision} | ${doc.lines.length} lines | in=[${tagList(doc.meta.consumes)}] out=[${tagList(doc.meta.emits)}]` +
                    lockMark(doc.meta.type));
            }
            out.push(`slices (${slices.size}):`);
            for (const [sliceId, entry] of [...slices].sort(([a], [b]) => a.localeCompare(b))) {
                out.push(`  ${sliceId} | in: ${tagList(entry.consumes)} | out: ${tagList(entry.emits)}` +
                    (entry.errored ? ` | errored: ${JSON.stringify(clip(entry.message ?? "", DIGEST_LINE_WIDTH))}` : "") +
                    (entry.hidden ? " | hidden" : "") +
                    (entry.kit === true ? " | kit" : "") +
                    lockMark(entry.sliceType) +
                    (entry.fileId !== undefined ? ` | doc: ${entry.fileId}` : ""));
            }
            // The stage: the seat grammar (r<row>c<col> on the page, s<n>r<row>c<col>
            // on the screens below, @anchor, tray-N, backdrop) drawn as rows — a
            // picture, since placement is planned against it — any other vocabulary
            // listed plainly with its grid seat in brackets. A trailing free cell,
            // row, or screen is the rung (+c4, +r3, +s2): asking mints it.
            out.push(`stage (${stageHeld.size} seats held | ${Object.keys(stageTokens).length} tokens):`);
            const screens = new Map();
            const trays = new Map();
            const other = [];
            const freeAnchors = [];
            for (const slot of stageSlots) {
                const holder = stageHeld.get(slot)?.sliceId;
                const cell = /^(?:s(\d+))?r(\d+)c(\d+)(?:@([a-z]+))?$/.exec(slot);
                const tray = /^tray-(\d+)$/.exec(slot);
                if (cell) {
                    const screenNo = cell[1] === undefined ? 1 : Number(cell[1]);
                    const rows = screens.get(screenNo) ?? new Map();
                    screens.set(screenNo, rows);
                    const row = rows.get(Number(cell[2])) ?? new Map();
                    rows.set(Number(cell[2]), row);
                    const entry = row.get(Number(cell[3])) ?? { anchors: [] };
                    row.set(Number(cell[3]), entry);
                    if (cell[4] === undefined)
                        entry.holder = holder;
                    else if (holder !== undefined)
                        entry.anchors.push(`@${cell[4]} <- ${holder}`);
                    else if (!freeAnchors.includes(cell[4]))
                        freeAnchors.push(cell[4]);
                }
                else if (tray)
                    trays.set(Number(tray[1]), holder);
                else
                    other.push(slot);
            }
            const vacant = (entry) => entry.holder === undefined && entry.anchors.length === 0;
            const screenNumbers = [...screens.keys()].sort((a, b) => a - b);
            for (const screenNo of screenNumbers) {
                const rows = screens.get(screenNo) ?? new Map();
                const rowNumbers = [...rows.keys()].sort((a, b) => a - b);
                const prefix = screenNo === 1 ? "" : `s${screenNo}`;
                const emptyScreen = rowNumbers.every((rowNo) => [...(rows.get(rowNo) ?? [])].every(([, e]) => vacant(e)));
                if (screenNo === screenNumbers[screenNumbers.length - 1] && screenNo > 1 && emptyScreen) {
                    out.push(`  +s${screenNo}`);
                    continue;
                }
                for (const rowNo of rowNumbers) {
                    const cols = [...(rows.get(rowNo) ?? [])].sort((a, b) => a[0] - b[0]);
                    if (rowNo === rowNumbers[rowNumbers.length - 1] && cols.every(([, entry]) => vacant(entry))) {
                        out.push(`  +${prefix}r${rowNo}`);
                        continue;
                    }
                    const parts = cols.map(([col, entry], i) => {
                        if (vacant(entry) && i === cols.length - 1)
                            return `+c${col}`;
                        const seat = entry.holder === undefined ? "free" : `<- ${entry.holder}`;
                        return `c${col} ${seat}${entry.anchors.length > 0 ? ` (${entry.anchors.join(", ")})` : ""}`;
                    });
                    out.push(`  ${prefix}r${rowNo} [${parts.join(" | ")}]`);
                }
            }
            if (trays.size > 0) {
                const bays = [...trays].sort((a, b) => a[0] - b[0]);
                const parts = bays.map(([index, holder], i) => holder === undefined ? (i === bays.length - 1 ? `+${index}` : `${index} free`) : `${index} <- ${holder}`);
                out.push(`  tray [${parts.join(" | ")}]`);
            }
            for (const slot of other) {
                const holder = stageHeld.get(slot);
                const seat = holder?.grid === undefined
                    ? ""
                    : ` [r${holder.grid.row}${holder.grid.rowEnd === holder.grid.row + 1 ? "" : `/${holder.grid.rowEnd}`} c${holder.grid.column}${holder.grid.columnEnd === holder.grid.column + 1 ? "" : `/${holder.grid.columnEnd}`}]`;
                out.push(`  ${slot} ${holder === undefined ? "free" : `<- ${holder.sliceId}${seat}`}`);
            }
            if (freeAnchors.length > 0)
                out.push(`  anchors free on any cell: ${freeAnchors.map((a) => `@${a}`).join(" ")}`);
            for (const [sliceId, entry] of [...stageDenied].sort(([a], [b]) => a.localeCompare(b))) {
                out.push(`  denied ${sliceId} -> ${entry.slot} (${entry.reason})`);
            }
            return out.join("\n");
        };
        // A fact handle as anything the mind prints: `frame:seq`, `intent frame:seq`,
        // the bare sequence, or `last` — the last intent this mind emitted.
        let lastIntentId = null;
        const resolveFactId = (handle) => {
            const bare = handle.trim().replace(/^(?:intent|fact)\s+/i, "");
            if (bare === "last")
                return lastIntentId;
            if (byId.has(bare))
                return bare;
            if (/^\d+$/.test(bare)) {
                for (const id of byId.keys())
                    if (id.endsWith(`:${bare}`))
                        return id;
            }
            return null;
        };
        const renderFacts = (options) => {
            const wanted = options.types === undefined ? null : new Set(options.types);
            const since = options.sinceFrame ?? -1;
            const limit = Math.max(1, options.limit ?? FACTS_DEFAULT_LIMIT);
            const picked = ring.filter((fact) => fact.frame > since && (wanted === null || wanted.has(fact.type)));
            const shown = picked.slice(-limit);
            const lines = shown.map((fact) => `${fact.id} ${fact.type} <${fact.sourceSlice}> ${clip(JSON.stringify(fact.payload), DIGEST_LINE_WIDTH)}`);
            return [
                `facts ${shown.length}/${picked.length}${picked.length > shown.length ? " (newest kept)" : ""} | frame ${context.frameNumber}`,
                ...lines,
            ].join("\n");
        };
        const renderTrace = (handle) => {
            const factId = resolveFactId(handle);
            const root = factId === null ? undefined : byId.get(factId);
            if (factId === null || root === undefined)
                return `no fact ${handle} in memory (ids look like frame:seq; \`last\` is your last intent)`;
            const line = (fact, depth, mark) => `${"  ".repeat(depth)}${mark} ${fact.id} ${fact.type} <${fact.sourceSlice}>`;
            const walk = (next, mark) => {
                const out = [];
                const seen = new Set([factId]);
                let frontier = [factId];
                let depth = 0;
                while (frontier.length > 0 && out.length < TRACE_NODE_LIMIT) {
                    depth += 1;
                    const upcoming = [];
                    for (const id of frontier) {
                        for (const link of next(id)) {
                            if (seen.has(link))
                                continue;
                            seen.add(link);
                            const fact = byId.get(link);
                            if (fact === undefined)
                                continue;
                            out.push(line(fact, depth, mark));
                            upcoming.push(link);
                        }
                    }
                    frontier = upcoming;
                }
                return out;
            };
            return [
                `${root.id} ${root.type} <${root.sourceSlice}> ${clip(JSON.stringify(root.payload), DIGEST_LINE_WIDTH)}`,
                "causes:",
                ...walk((id) => byId.get(id)?.causedBy ?? [], "<"),
                "effects:",
                ...walk((id) => childrenOf.get(id) ?? [], ">"),
            ].join("\n");
        };
        // A one-line index of the law: each type with its top-level fields, so
        // the model knows payload keys without reading every shape.
        const renderSchemaIndex = () => {
            const lines = [];
            for (const type of Object.keys(schemaShapes).sort()) {
                const shape = schemaShapes[type];
                if (shape?.is === "object" && shape.fields) {
                    const optional = new Set(shape.optional ?? []);
                    const fields = Object.keys(shape.fields).map((name) => (optional.has(name) ? `${name}?` : name));
                    lines.push(`${type} {${fields.join(", ")}}`);
                }
                else
                    lines.push(`${type} <${shape?.is ?? "unknown"}>`);
            }
            return lines.join("\n");
        };
        // --- The system prompt: the books, rendered once per books version. ---
        // Stable bytes are the whole point: it is cached at the API (one
        // cache_control breakpoint on the last block), so the ramp costs a
        // fraction after the first turn. Nothing volatile lives here.
        const PREAMBLE = [
            "You are the resident author inside Slice-IDE — a running program that edits itself.",
            "There is no file system: every document IS a slice (a contract as data plus a body",
            "that is the inside of start(context) { … }), and the foundry autosaves every edit",
            "into the live pool. You act only through tools. Each write tool emits one intent",
            "fact into the pool at machine priority 1 (a human typing outranks you) and returns a",
            "digest of what the cascade changed. Reads (outline, read, facts, trace) cost the history",
            "nothing.",
            "",
            "Working rules:",
            "- Start with outline, then read the lines you need. Never guess document contents.",
            "  The outline's `stage:` block says who holds each seat; the digest's `docs:` line",
            "  says which documents appeared or vanished (a delete, a create, a scrub) — a",
            "  document you read earlier may be gone; read again after time travel.",
            "- One edit intent is one undo step; a batch (`edits`) is one frame and one undo",
            "  step. Habit: the whole contract (meta-set type, meta-set description, tags-set",
            "  consumes, tags-set emits) in ONE edits batch, then the whole body in ONE edit",
            "  (select-all + insert, or a single insert into an empty document) — never one",
            "  remount per field. Prefer replace-match {find, text, occurrence?}",
            "  for surgery — content-anchored, no line arithmetic; a miss digests as `no",
            "  BufferChanged`.",
            "- The body is ONLY JavaScript — the inside of start(context) { … }. Never write the",
            "  type, description or tags as text lines in the body: those are meta-set and",
            "  tags-set. A compile verdict `Unexpected identifier` means prose in the body (or a",
            "  stray word), not a template-literal problem — read the digest's numbered lines.",
            "- A view slice (a panel, a button, a HUD) needs TWO blocks every view slice",
            "  carries: the shadow-view setup (the host, its shadow root, the token style;",
            "  hidden until seated — never document.currentScript) and the slot-protocol",
            "  block (the seat request). Read a small view slice (transport-controls) with",
            "  read, copy both blocks, write the whole body in ONE edit, then proof.",
            "- A view wears the theme (THE LOOK in the manual): token colours via var(--x, fallback),",
            "  2px solid borders, border-radius 0, monospace, UPPERCASE labels — never a colour of",
            "  your own. Define the stylesheet const BEFORE the shadow-view block uses it.",
            "- Proof a non-trivial body before a bulk write; a broken autosave greys the card.",
            "- The digest's `slices:` line says whether the autosave mounted (+id), remounted",
            "  (-old +new) or flagged (!id \"message\"); `verdicts:` lists lint, violations,",
            "  sketched types and proof results. They are the truth of what happened. After",
            "  an edit, `slices: unchanged` means the running program did NOT change — only",
            "  the text did (a content-identical save, or a navigation open). Never report",
            "  such an edit as done.",
            "- Every document takes edits, the IDE's own slices included — but some are LOCKED",
            "  to you (outline: `locked >=N`): the stage, the buffer, the renderer, the",
            "  keyboard, the clock, the foundry, the fact-log, the firewall, the schema-book,",
            "  the lock-book, the toolbar, the tray, the agent-port. You write at priority 1;",
            "  a lock is a rank on the board that only a human's toolbar press (LOCK|UNLOCK,",
            "  at 10) changes. An edit, copy or delete of a locked document is refused — the",
            "  digest says `refused:` and nothing changed. NEVER work around a lock (no",
            "  second clock, no slice that speaks a locked slice's types, no rename into a",
            "  locked name — that is refused too): close the ticket blocked, naming the slice",
            "  that needs unlocking. The first edit of an unlocked compiled slice adopts it —",
            "  its build replaces the boot instance once the build has started; a build that",
            "  dies at start is unmounted again and the boot instance kept, with `!id \"start",
            "  failed | …\"` in the digest. Four kit slices (visualizer, timeline,",
            "  causality-inspector, firewall — `kit` in the outline) open as source whose",
            "  first line says so: their bodies reference module scope and cannot start as",
            "  written, so an edit there is a verdict, not a change, unless you rewrite the",
            "  body to be self-contained. Say what the digest says, not what you intended.",
            "- A malformed intent is never a throw: the firewall flags it and the digest shows",
            "  the violation. Fix and retry.",
            "- A slice body references only its own locals and `context` — the context API",
            "  below is everything it gets; whatever else it needs arrives as facts it consumes.",
            "- The lint rules below are law; the compliance oracle scans every revision.",
            "- Duplicated code is fine (rule 6): every view slice carries its own copy of the",
            "  shadow-view and slot-protocol blocks, and nothing tracks the copies.",
            "- The `[thread]` line in each ask is what the human is doing — their pinned goal and",
            "  the trail since. Serve it; if an ask contradicts it, say so in a clause and do the",
            "  ask. Pin the thread yourself (thread tool) only for a multi-step job with no thread",
            "  pinned, or when the human tells you the goal changed — never re-pin their words.",
            "- You work tickets, one per turn. Your message opens with a `[ticket t-N]` block: its",
            "  text, tags, parent, and notes so far. Leave `ticket note` breadcrumbs on long work.",
            "  Your LAST act is `ticket close { outcome: done|blocked|wontfix, note }` — a turn that",
            "  ends without a close parks the ticket for a human. `ticket file { text, tags }`",
            "  files a subtask (its parent is your ticket); it goes to bidding, not necessarily to",
            "  you. Never file a ticket for work you can do now.",
            "- When done, answer in a sentence or two: what changed. Do not narrate tool calls.",
        ].join("\n");
        const systemText = () => {
            if (systemVersion === booksVersion)
                return systemCache;
            const parts = [PREAMBLE];
            if (guideTopics.length > 0) {
                parts.push("## OPERATOR'S MANUAL\n" +
                    guideTopics.map((topic) => `### ${topic.title}\n${topic.body}`).join("\n\n"));
            }
            if (apiEntries.length > 0) {
                parts.push("## CONTEXT API\n" +
                    apiEntries.map((entry) => `${entry.name} — ${entry.signature}\n  ${entry.doc}`).join("\n"));
            }
            if (lintRules.length > 0) {
                parts.push("## LINT RULES\n" +
                    lintRules.map((rule) => `${rule.id}: ${rule.message} (pattern ${rule.pattern})`).join("\n"));
            }
            const index = renderSchemaIndex();
            if (index !== "")
                parts.push(`## EVENT TYPES (payload keys)\n${index}`);
            systemCache = parts.join("\n\n");
            systemVersion = booksVersion;
            return systemCache;
        };
        // --- The tools: the human's vocabulary, one entry each, in a fixed order. ---
        const caretSchema = {
            type: "object",
            properties: { line: { type: "integer", minimum: 0 }, column: { type: "integer", minimum: 0 } },
            required: ["line", "column"],
        };
        const editSchema = {
            type: "object",
            properties: {
                kind: {
                    type: "string",
                    enum: [
                        "insert",
                        "backspace",
                        "delete",
                        "caret-move",
                        "caret-set",
                        "select-all",
                        "replace-range",
                        "replace-match",
                        "meta-set",
                        "tag-add",
                        "tag-remove",
                        "tags-set",
                    ],
                },
                text: { type: "string" },
                direction: { type: "string", enum: ["left", "right", "up", "down", "line-start", "line-end"] },
                extend: { type: "boolean" },
                line: { type: "integer", minimum: 0 },
                column: { type: "integer", minimum: 0 },
                from: caretSchema,
                to: caretSchema,
                find: { type: "string" },
                occurrence: { type: "integer", minimum: 1 },
                field: { type: "string", enum: ["type", "description"] },
                value: { type: "string" },
                side: { type: "string", enum: ["consumes", "emits"] },
                tag: { type: "string" },
                tags: { type: "array", items: { type: "string" } },
            },
            required: ["kind"],
        };
        const TOOLS = [
            {
                name: "outline",
                description: "One line per document (id | rev | lines | in/out tags | locked), per living slice (id | in | out | errored | kit | locked | doc — `kit` marks a compiled kit slice whose source cannot start as written; `locked >=N` marks a document that refuses your edits, copies and deletes — you write at priority 1, and only a human unlocks it), then the stage: every seat and who holds it. Call this first on every task to see what exists; it is cheap.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "read",
                description: "A document as numbered lines (1-based) with a meta header — the active document by default, or fileId; from/to bound the range. Call this before editing code you have not seen this turn.",
                input_schema: {
                    type: "object",
                    properties: {
                        fileId: { type: "string", description: "Document id (equals the slice type). Default: the active document." },
                        from: { type: "integer", minimum: 1 },
                        to: { type: "integer", minimum: 1 },
                    },
                },
            },
            {
                name: "edit",
                description: "Emit EditRequested intents on a document (fileId, else the active one) and return the digest of what changed. The body is JavaScript only — the inside of start(context); the contract (type, description, consumes, emits) is meta-set/tags-set, never text lines in the body. Give one `edit`, or `edits` (an array): a batch lands in one frame — one BufferChanged, one undo step, one remount — so declare a whole contract or make several surgical replacements in one call. Kinds: insert {text} | backspace | delete | caret-move {direction: left|right|up|down|line-start|line-end, extend?} | caret-set {line, column, extend?} (zero-based) | select-all | replace-range {from, to, text} (zero-based carets) | replace-match {find, text, occurrence?} (the Nth non-overlapping occurrence of find becomes text; a miss is a no-op) | meta-set {field: type|description, value} | tag-add {side: consumes|emits, tag} | tag-remove {side, tag} | tags-set {side, tags} (write a whole side as data). Bulk-write a body as select-all then insert. A locked document (outline: `locked >=N`) refuses you: the digest says `refused:` and nothing changes — close the ticket blocked naming the slice; never work around a lock.",
                input_schema: {
                    type: "object",
                    properties: {
                        fileId: {
                            type: "string",
                            description: "Edit THIS document: it is selected first (an ordinary SliceSelected, same frame), then the edits apply. Without it the edits hit whatever document is active — read the digest header's `doc` to know which. A compiled slice's document opens by its type.",
                        },
                        edit: editSchema,
                        edits: { type: "array", items: editSchema, minItems: 1 },
                    },
                },
            },
            {
                name: "proof",
                description: "Assay a document before committing it: the foundry's compile and shape checks plus the rule-book's lint, mounting nothing. Give meta + lines for a candidate you have not typed yet, or fileId to assay a document as it stands (default: the active one). Returns ok | verdicts | sketched.",
                input_schema: {
                    type: "object",
                    properties: {
                        fileId: { type: "string", description: "Assay this existing document instead of a candidate. Omit meta and lines." },
                        meta: {
                            type: "object",
                            properties: {
                                type: { type: "string" },
                                description: { type: "string", maxLength: 80 },
                                consumes: { type: "array", items: { type: "string" } },
                                emits: { type: "array", items: { type: "string" } },
                            },
                            required: ["type", "description", "consumes", "emits"],
                        },
                        lines: { type: "array", items: { type: "string" }, description: "The body: the inside of start(context), one entry per line." },
                    },
                },
            },
            {
                name: "select_slice",
                description: "Open a slice's document in the editor by living instance id (from outline, e.g. slice-3#7): the buffer publishes it and later edits target it. Call this before editing a document that is not the active one.",
                input_schema: { type: "object", properties: { sliceId: { type: "string" } }, required: ["sliceId"] },
            },
            {
                name: "workspace",
                description: "Workspace intents: create (a new blank document slice-N becomes active), duplicate {sliceId|fileId} (same contract and body under a fresh type), delete {sliceId|fileId} (the document and, if the foundry saved it, the instance — the last document is immortal; a document with no living instance is deleted by its id), hide {sliceId} (toggle the card's pool visibility; needs the living instance). A locked type refuses duplicate and delete (digest: `refused:`). Returns the digest.",
                input_schema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["create", "duplicate", "delete", "hide"] },
                        sliceId: { type: "string", description: "Living instance id (slice-2#7) — or, for duplicate|delete, the document id (slice-2): the id IS the type." },
                        fileId: { type: "string", description: "Document id, for duplicate|delete when the document has no living instance." },
                    },
                    required: ["action"],
                },
            },
            {
                name: "undo",
                description: "Step the timeline back one recorded edit (the buffer restores the earlier document). Call read afterwards — cached text is stale.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "redo",
                description: "Step the timeline forward one recorded edit.",
                input_schema: { type: "object", properties: {} },
            },
            {
                name: "facts",
                description: "Recent facts from the mind's ring (a cache read — costs the history nothing): one line each, `id type <source> payload`, oldest first. Filter by types and/or sinceFrame; limit defaults to 40. Use it to see the cascade itself — every fact the digest's `facts:` line counted — e.g. to confirm a ViewSlotAssigned for your slice exists.",
                input_schema: {
                    type: "object",
                    properties: {
                        types: { type: "array", items: { type: "string" }, description: "Only these fact types." },
                        sinceFrame: { type: "integer", minimum: 0, description: "Only facts after this pool frame." },
                        limit: { type: "integer", minimum: 1, maximum: 200 },
                    },
                },
            },
            {
                name: "trace",
                description: "Causes and effects of one fact. `factId` is a fact id as printed everywhere (`frame:seq`, e.g. `68548:2619` — the digest's `intent 68548:2619` line, a facts line, AgentToolReturned); `intent 68548:2619`, the bare sequence `2619`, and `last` (the last intent this mind emitted) are accepted too. Use to understand why a slice errored or what an intent cascaded into.",
                input_schema: { type: "object", properties: { factId: { type: "string" } }, required: ["factId"] },
            },
            {
                name: "operate",
                description: "Press an authored tool: speak one fact of the OPEN vocabulary — a type a saved slice sketched, never a registry type (those have owners; a refusal carries no emission). Returns the digest.",
                input_schema: {
                    type: "object",
                    properties: { type: { type: "string" }, payload: { description: "The fact's payload, if any." } },
                    required: ["type"],
                },
            },
            {
                name: "thread",
                description: "Pin the thread — one sentence saying what is being worked on right now (the [thread] line in your message; the human sees it in the header and the trail of what happens under it). Pin it when you take up a multi-step job the human did not already pin, or when the goal changes; name the document (its id) in the sentence so drift away from it is counted. An empty text marks it DONE. Journaled like an edit; returns the digest.",
                input_schema: {
                    type: "object",
                    properties: { text: { type: "string", description: "The sentence, or \"\" for done." } },
                    required: ["text"],
                },
            },
            {
                name: "ticket",
                description: "The desk's intents for the ticket you are working (default ticketId: yours). note {text}: a breadcrumb on the ticket. close {outcome: done|blocked|wontfix, note?}: your last act every turn — the ticket leaves DOING; without it the ticket parks for a human. file {text, tags?}: a subtask (parent = your ticket) that goes to bidding among every mind — never for work you can do now. Journaled like an edit; returns the ledger line and the digest.",
                input_schema: {
                    type: "object",
                    properties: {
                        action: { type: "string", enum: ["note", "close", "file"] },
                        text: { type: "string", description: "note: the breadcrumb; file: the new ticket's text; close: use note." },
                        note: { type: "string", description: "close: what happened, in a sentence." },
                        outcome: { type: "string", enum: ["done", "blocked", "wontfix"] },
                        tags: { type: "array", items: { type: "string" }, description: "file: tags a specialist's bid rule reads." },
                        ticketId: { type: "string", description: "Another ticket (t-N); default: the one you are working." },
                    },
                    required: ["action"],
                },
            },
        ];
        // --- The wildcard subscription: caches, ring, and the model's answers. ---
        context.subscribe("*", (fact) => {
            totalFacts += 1;
            ring.push(fact);
            byId.set(fact.id, fact);
            for (const cause of fact.causedBy) {
                const children = childrenOf.get(cause);
                if (children)
                    children.push(fact.id);
                else
                    childrenOf.set(cause, [fact.id]);
            }
            while (ring.length > RING_LIMIT) {
                const evicted = ring.shift();
                if (!evicted)
                    break;
                byId.delete(evicted.id);
                childrenOf.delete(evicted.id);
            }
            switch (fact.type) {
                case "BufferChanged":
                case "BufferRestored": {
                    documents.set(fact.payload.fileId, documentOf(fact.payload));
                    activeFileId = fact.payload.fileId;
                    if (!baselines.has(fact.payload.fileId)) {
                        baselines.set(fact.payload.fileId, {
                            revision: fact.payload.revision,
                            lines: [...fact.payload.lines],
                            frame: fact.frame,
                        });
                    }
                    // The roster prunes: a document the buffer no longer lists leaves
                    // the cache from the outcome fact itself, never from an intent.
                    const roster = fact.payload.fileIds;
                    if (roster === undefined)
                        break; // an older buffer's bare publication
                    const living = new Set(roster);
                    for (const fileId of [...documents.keys()]) {
                        if (living.has(fileId))
                            continue;
                        documents.delete(fileId);
                        baselines.delete(fileId);
                    }
                    break;
                }
                case "CaretMoved": {
                    activeFileId = fact.payload.fileId;
                    const doc = documents.get(fact.payload.fileId);
                    if (doc) {
                        doc.caret = { ...fact.payload.caret };
                        doc.anchor = fact.payload.anchor === null ? null : { ...fact.payload.anchor };
                    }
                    break;
                }
                case "SliceMounted": {
                    // The pool re-publishes living mounts to late joiners; a mount of an
                    // instance already known is a re-publication, not a birth — the
                    // digest must not read it as one.
                    if (slices.has(fact.payload.sliceId)) {
                        republished.add(fact.id);
                        break;
                    }
                    slices.set(fact.payload.sliceId, {
                        sliceType: fact.payload.sliceType,
                        ...(fact.payload.description !== undefined ? { description: fact.payload.description } : {}),
                        consumes: [...fact.payload.consumes],
                        emits: [...fact.payload.emits],
                        errored: false,
                        hidden: false,
                        ...(kitMarked(fact.payload.startSource) ? { kit: true } : {}),
                    });
                    // Rule 9: a newcomer that listens for minds hears this one's charter.
                    if (fact.payload.sliceId !== context.instanceId &&
                        (fact.payload.consumes.includes("MindDeclared") || fact.payload.consumes.includes("*")) &&
                        mindDeclaredFrame !== context.frameNumber) {
                        declareMind();
                    }
                    break;
                }
                case "SliceUnmounted": {
                    slices.delete(fact.payload.sliceId);
                    for (const [slot, holder] of [...stageHeld]) {
                        if (holder.sliceId === fact.payload.sliceId)
                            stageHeld.delete(slot);
                    }
                    stageDenied.delete(fact.payload.sliceId);
                    break;
                }
                case "StageSlotsDeclared": {
                    stageSlots = [...fact.payload.slots];
                    // An older stage (an adopted document built before `held`) may
                    // still speak the bare declaration: nothing to seed, keep the deltas.
                    const held = fact.payload.held;
                    if (held === undefined)
                        break;
                    for (const slot of [...stageHeld.keys()]) {
                        if (held[slot] === undefined)
                            stageHeld.delete(slot);
                    }
                    for (const [slot, sliceId] of Object.entries(held)) {
                        const known = stageHeld.get(slot);
                        if (known === undefined || known.sliceId !== sliceId) {
                            stageHeld.set(slot, { sliceId, geometry: known?.geometry ?? "" });
                        }
                    }
                    break;
                }
                case "StageTokensDeclared": {
                    stageTokens = { ...fact.payload.tokens };
                    break;
                }
                case "SliceLocksDeclared": {
                    locks = { ...fact.payload.locks };
                    break;
                }
                case "ViewConfigDeclared": {
                    // A chartered view listens for the types its charter names.
                    const named = new Set();
                    const leaves = (value) => {
                        if (typeof value === "string")
                            named.add(value);
                        else if (Array.isArray(value))
                            for (const entry of value)
                                leaves(entry);
                        else if (typeof value === "object" && value !== null)
                            for (const entry of Object.values(value))
                                leaves(entry);
                    };
                    leaves(fact.payload.config);
                    charters.set(fact.payload.view, named);
                    break;
                }
                case "ViewSlotAssigned": {
                    stageHeld.set(fact.payload.slot, {
                        sliceId: fact.payload.sliceId,
                        geometry: fact.payload.geometry,
                        ...(fact.payload.grid === undefined ? {} : { grid: { ...fact.payload.grid } }),
                    });
                    stageDenied.delete(fact.payload.sliceId);
                    break;
                }
                case "ViewSlotDenied": {
                    stageDenied.set(fact.payload.sliceId, { slot: fact.payload.slot, reason: fact.payload.reason });
                    break;
                }
                case "SliceSaved": {
                    const entry = slices.get(fact.payload.sliceId);
                    if (entry)
                        entry.fileId = fact.payload.fileId;
                    break;
                }
                case "SliceErrorChanged": {
                    const entry = slices.get(fact.payload.sliceId);
                    if (entry) {
                        entry.errored = fact.payload.errored;
                        if (fact.payload.message !== undefined)
                            entry.message = fact.payload.message;
                        else
                            delete entry.message;
                    }
                    break;
                }
                case "SliceVisibilityChanged": {
                    const entry = slices.get(fact.payload.sliceId);
                    if (entry)
                        entry.hidden = fact.payload.hidden;
                    break;
                }
                case "VocabularyDeclared": {
                    vocabulary = [...fact.payload.types];
                    break;
                }
                case "SchemasDeclared": {
                    schemaShapes = { ...fact.payload.shapes };
                    booksVersion += 1;
                    break;
                }
                case "GuideDeclared": {
                    guideTopics = fact.payload.topics.map((topic) => ({ ...topic }));
                    booksVersion += 1;
                    break;
                }
                case "ApiDeclared": {
                    apiEntries = fact.payload.entries.map((entry) => ({ ...entry }));
                    booksVersion += 1;
                    break;
                }
                case "LintRulesDeclared": {
                    lintRules = fact.payload.rules.map((rule) => ({ ...rule }));
                    booksVersion += 1;
                    break;
                }
                case "ThreadDeclared": {
                    thread = {
                        text: fact.payload.text,
                        since: fact.payload.since,
                        subject: [...fact.payload.subject],
                        trail: fact.payload.trail.map((entry) => ({ ...entry })),
                        away: fact.payload.away,
                    };
                    break;
                }
                case "WorkspaceReplayed": {
                    replayed = true;
                    break;
                }
                case "TicketsDeclared": {
                    tickets = fact.payload.tickets.map((ticket) => ({ ...ticket }));
                    break;
                }
                case "TicketOpened": {
                    onTicketOpened(fact.payload.ticketId, fact.payload.tags);
                    break;
                }
                case "TicketAssigned": {
                    if (fact.payload.to !== context.instanceId)
                        break;
                    onTicketAssigned({
                        ticketId: fact.payload.ticketId,
                        text: fact.payload.text,
                        tags: [...fact.payload.tags],
                        ...(fact.payload.effort === undefined ? {} : { effort: fact.payload.effort }),
                    });
                    break;
                }
                case "ModelReturned": {
                    onModelReturned(fact);
                    break;
                }
                default:
                    break;
            }
        });
        // --- Settle: the pool quiet for two beats, then the window as facts. ---
        const schedule = typeof window !== "undefined" && "requestAnimationFrame" in window
            ? (beat) => window.requestAnimationFrame(() => beat())
            : (beat) => void setTimeout(beat, 16);
        const factsSince = (sinceFrame) => ring.filter((fact) => fact.frame > sinceFrame).map(viewOf);
        const settle = () => {
            const sinceFrame = context.frameNumber;
            const deadline = Date.now() + SETTLE_TIMEOUT_MS;
            return new Promise((resolve) => {
                let lastCount = totalFacts;
                let quietBeats = 0;
                const beat = () => {
                    if (!active)
                        return resolve(factsSince(sinceFrame));
                    if (totalFacts === lastCount)
                        quietBeats += 1;
                    else {
                        quietBeats = 0;
                        lastCount = totalFacts;
                    }
                    if (quietBeats >= SETTLE_QUIET_BEATS || Date.now() >= deadline) {
                        return resolve(factsSince(sinceFrame));
                    }
                    schedule(beat);
                };
                schedule(beat);
            });
        };
        const conversation = [];
        // Awards that landed while a turn was live (two in one frame): next up.
        const queue = [];
        let live = null;
        let turnCount = 0;
        let callCount = 0;
        // --- The charter, declared (rule 9): the desk's roster is these facts. ---
        let mindDeclaredFrame = -1;
        const declareMind = () => {
            mindDeclaredFrame = context.frameNumber;
            context.emit("MindDeclared", {
                specialty: SPECIALTY,
                tags: [...TAGS],
                baseBid: BASE_BID,
                bidRule: `${BASE_BID} + ${TAG_BONUS} per shared tag - ${BUSY_PENALTY} while working; 0 passes`,
                state: live === null ? "idle" : "working",
                ...(live === null ? {} : { ticketId: live.ticketId }),
            });
        };
        // The bid: the charter's arithmetic, nothing hidden.
        const bidFor = (tags) => {
            const shared = tags.filter((tag) => TAGS.includes(tag)).length;
            return BASE_BID + TAG_BONUS * shared - (live === null ? 0 : BUSY_PENALTY);
        };
        const onTicketOpened = (ticketId, tags) => {
            if (!active)
                return;
            const bid = bidFor(tags);
            if (bid <= 0) {
                context.emit("TicketPassed", { ticketId, mind: context.instanceId });
                return;
            }
            context.emit("TicketBidPlaced", { ticketId, mind: context.instanceId, bid });
        };
        const onTicketAssigned = (job) => {
            if (!active)
                return;
            if (live !== null) {
                queue.push(job);
                return;
            }
            startTurn(job);
        };
        const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
        const addUsage = (into, more) => {
            if (!more)
                return;
            into.input += more.input;
            into.output += more.output;
            into.cacheRead += more.cacheRead;
            into.cacheWrite += more.cacheWrite;
        };
        const cloneJson = (value) => JSON.parse(JSON.stringify(value));
        // Trim whole turns from the front, never mid-pair.
        const trimConversation = () => {
            while (conversation.length > CONVERSATION_MESSAGE_LIMIT) {
                let cut = -1;
                for (let index = 1; index < conversation.length; index += 1) {
                    const message = conversation[index];
                    const first = Array.isArray(message.content) ? message.content[0] : undefined;
                    if (message.role === "user" && first?.type === "text") {
                        cut = index;
                        break;
                    }
                }
                if (cut === -1)
                    break;
                conversation.splice(0, cut);
            }
        };
        // The thread, rendered for a turn's opening message: the sentence, how
        // far it has drifted, and the last few steps of the trail — so a model
        // waking up cold reads "where was I" exactly as the returning human does.
        const renderThread = () => {
            if (thread.text === "")
                return "[thread] none pinned";
            const head = `[thread] NOW: ${thread.text} | since frame ${thread.since}` +
                (thread.subject.length > 0 ? ` | subject ${thread.subject.join(",")}` : "") +
                (thread.away > 0 ? ` | ${thread.away} edits AWAY from the subject` : "");
            const recent = thread.trail.slice(-THREAD_TRAIL_LINES);
            if (recent.length === 0)
                return head;
            const lines = recent.map((entry) => `  ${entry.frame} ${entry.kind} ${entry.note}${entry.times > 1 ? ` x${entry.times}` : ""}`);
            return `${head}\n  trail (last ${recent.length} of ${thread.trail.length}, oldest first):\n${lines.join("\n")}`;
        };
        const workspaceHeader = () => {
            const active = activeFileId === null ? undefined : documents.get(activeFileId);
            const erroredCount = [...slices.values()].filter((entry) => entry.errored).length;
            return (`[workspace] frame ${context.frameNumber} | active doc ${active?.fileId ?? "-"}` +
                (active ? ` rev ${active.revision} (${active.lines.length} lines)` : "") +
                ` | slices ${slices.size}${erroredCount > 0 ? ` (${erroredCount} errored)` : ""}` +
                `\n${renderThread()}`);
        };
        const callModel = (turn, causedBy) => {
            if (!active || live !== turn)
                return;
            callCount += 1;
            // Instance-prefixed: two minds share one model-port, and each must take
            // only its own answers.
            turn.callId = `${context.instanceId}:call-${callCount}`;
            // Two cache breakpoints: the ramp (system) and the conversation so far
            // (the last block of the last message) — so a long turn's rounds cost
            // the new tool results, not the whole history again. The marker rides
            // the request copy only; the stored conversation stays plain.
            const messages = cloneJson(conversation);
            const tail = messages[messages.length - 1];
            if (tail !== undefined && Array.isArray(tail.content) && tail.content.length > 0) {
                tail.content[tail.content.length - 1].cache_control = { type: "ephemeral" };
            }
            const request = {
                max_tokens: MAX_TOKENS,
                system: [{ type: "text", text: systemText(), cache_control: { type: "ephemeral" } }],
                tools: cloneJson(TOOLS),
                messages,
            };
            if (turn.effort !== undefined)
                request.output_config = { effort: turn.effort };
            context.emit("ModelCallRequested", { callId: turn.callId, request }, causedBy === undefined ? {} : { causedBy: [causedBy] });
        };
        const endTurn = (turn, stopReason, error, causedBy) => {
            if (live !== turn)
                return;
            live = null;
            context.emit("AgentTurnEnded", {
                turnId: turn.id,
                stopReason,
                usage: { ...turn.usage },
                ...(error === undefined ? {} : { error }),
            }, causedBy === undefined ? {} : { causedBy: [causedBy] });
            const next = queue.shift();
            if (next !== undefined)
                startTurn(next);
            else
                declareMind();
        };
        // The ticket, rendered for the turn's opening message: what was asked,
        // how it was tagged, where it came from, and the breadcrumbs so far.
        const renderTicket = (job) => {
            const ticket = tickets.find((entry) => entry.ticketId === job.ticketId);
            const bid = ticket?.bids.find((placed) => placed.mind === context.instanceId);
            const head = `[ticket ${job.ticketId}]` +
                (ticket === undefined ? "" : ` filed frame ${ticket.frame}`) +
                ` | tags ${job.tags.length === 0 ? "-" : job.tags.join(",")}` +
                (ticket?.parent === undefined ? "" : ` | parent ${ticket.parent}`) +
                ` | assigned to you (${context.instanceId}${bid === undefined ? "" : `, bid ${bid.bid}`})`;
            const notes = ticket?.notes ?? [];
            const trail = notes.length === 0
                ? ""
                : `\nnotes (${notes.length}, oldest first): ${notes.map((note) => `${note.by}@${note.frame}: ${note.text}`).join(" | ")}`;
            return `${head}\n${job.text}${trail}`;
        };
        const startTurn = (job) => {
            turnCount += 1;
            const turn = {
                id: `${context.instanceId}:turn-${turnCount}`,
                ticketId: job.ticketId,
                text: job.text,
                ...(job.effort === undefined ? {} : { effort: job.effort }),
                callId: null,
                rounds: 0,
                usage: zeroUsage(),
            };
            live = turn;
            context.emit("AgentTurnStarted", { turnId: turn.id, text: job.text, ticketId: job.ticketId });
            declareMind();
            conversation.push({
                role: "user",
                content: [{ type: "text", text: `${workspaceHeader()}\n\n${renderTicket(job)}` }],
            });
            trimConversation();
            callModel(turn);
        };
        // One tool call: write tools emit an intent and settle into a digest;
        // read tools answer from the caches. `causedBy` keeps the chain intact
        // across the async hops (emits outside delivery carry no cause).
        const runTool = async (turn, block, causedBy) => {
            const input = (block.input ?? {});
            const cause = { causedBy: [causedBy] };
            const write = async (emitIntent) => {
                const intentId = emitIntent();
                lastIntentId = intentId.split(",")[0];
                const window = await settle();
                return `${renderDigest(window)}\nintent ${intentId}`;
            };
            switch (block.name) {
                case "outline":
                    return { text: renderOutline(), isError: false };
                case "read":
                    return { text: renderRead(input), isError: false };
                case "trace":
                    return { text: renderTrace(String(input.factId ?? "")), isError: false };
                case "facts":
                    return {
                        text: renderFacts({
                            ...(Array.isArray(input.types) ? { types: input.types.map(String) } : {}),
                            ...(typeof input.sinceFrame === "number" ? { sinceFrame: input.sinceFrame } : {}),
                            ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
                        }),
                        isError: false,
                    };
                case "edit": {
                    // One edit or a batch; a batch is emitted synchronously so it lands
                    // in one frame (one BufferChanged, one undo step, one remount). A
                    // fileId selects that document first — an ordinary SliceSelected in
                    // the same frame; the select lands on delivery, the edits on the
                    // tick — so "edit THIS document" is one call and never a guess.
                    // Read the intent charitably: some doors (a Bedrock-routed model)
                    // leak the kind into an XML-ish string and flatten the rest to the
                    // top level — `"edit": "\n<parameter name=\"kind\">delete", "from":
                    // {…}` — and a flat { kind, … } with no wrapper is unambiguous too.
                    // The fact emitted is the same EditRequested either way; only the
                    // parse forgives.
                    const { edit: rawEdit, edits: rawEdits, fileId: _fileId, ...flat } = input;
                    const kindOf = (value) => {
                        if (typeof value !== "string")
                            return null;
                        const leaked = /name="kind">\s*([\w-]+)/.exec(value);
                        if (leaked !== null)
                            return leaked[1];
                        return /^[\w-]+$/.test(value.trim()) ? value.trim() : null;
                    };
                    let batch;
                    if (Array.isArray(rawEdits))
                        batch = rawEdits;
                    else if (typeof rawEdit === "object" && rawEdit !== null)
                        batch = [rawEdit];
                    else if (kindOf(rawEdit) !== null)
                        batch = [{ kind: kindOf(rawEdit), ...flat }];
                    else if (typeof flat.kind === "string")
                        batch = [flat];
                    else
                        batch = [];
                    if (batch.length === 0 || batch.some((entry) => typeof entry !== "object" || entry === null)) {
                        return { text: "edit requires { edit: { kind, … } } or { edits: [ { kind, … }, … ] }", isError: true };
                    }
                    const target = typeof input.fileId === "string" ? input.fileId : null;
                    if (target !== null) {
                        const known = documents.has(target) || [...slices.values()].some((entry) => entry.sliceType === target);
                        if (!known) {
                            return {
                                text: `edit: no document or slice ${JSON.stringify(target)} — see outline (documents open by id; a compiled slice's document by its type)`,
                                isError: true,
                            };
                        }
                    }
                    return {
                        text: await write(() => [
                            ...(target === null || target === activeFileId
                                ? []
                                : [context.emit("SliceSelected", { sliceId: target }, cause)]),
                            ...batch.map((edit) => context.emit("EditRequested", { edit: edit, priority: AGENT_PRIORITY }, cause)),
                        ].join(",")),
                        isError: false,
                    };
                }
                case "proof": {
                    const proofId = `${turn.id}-proof-${turn.rounds}-${block.id ?? "x"}`;
                    // A fileId assays the document as it stands (from the cache — the
                    // same text the buffer published); meta + lines assay a candidate.
                    let meta = input.meta;
                    let lines = Array.isArray(input.lines) ? input.lines : undefined;
                    if (meta === undefined || lines === undefined) {
                        const fileId = typeof input.fileId === "string" ? input.fileId : activeFileId;
                        const doc = fileId === null ? undefined : documents.get(fileId);
                        if (doc === undefined)
                            return { text: `proof: no document ${fileId ?? "(none active)"} — give meta + lines, or a fileId from the outline`, isError: true };
                        meta = { type: doc.meta.type, description: doc.meta.description, consumes: [...doc.meta.consumes], emits: [...doc.meta.emits] };
                        lines = [...doc.lines];
                    }
                    return {
                        text: await write(() => context.emit("ProofRequested", { proofId, meta, lines }, cause)),
                        isError: false,
                    };
                }
                case "select_slice":
                    return {
                        text: await write(() => context.emit("SliceSelected", { sliceId: String(input.sliceId ?? "") }, cause)),
                        isError: false,
                    };
                case "workspace": {
                    // The document id IS the slice type, so a bare id names the document
                    // for duplicate|delete whether or not an instance lives.
                    const sliceId = String(input.sliceId ?? input.fileId ?? "");
                    const action = String(input.action ?? "");
                    if (action !== "create" && sliceId === "")
                        return { text: `${action} requires sliceId or fileId`, isError: true };
                    return {
                        text: await write(() => {
                            if (action === "create")
                                return context.emit("SliceCreateRequested", {}, cause);
                            if (action === "duplicate")
                                return context.emit("SliceDuplicateRequested", { sliceId, priority: AGENT_PRIORITY }, cause);
                            if (action === "delete")
                                return context.emit("SliceDeleteRequested", { sliceId, priority: AGENT_PRIORITY }, cause);
                            return context.emit("SliceHideRequested", { sliceId }, cause);
                        }),
                        isError: false,
                    };
                }
                case "undo":
                    return { text: await write(() => context.emit("StepBackPressed", {}, cause)), isError: false };
                case "redo":
                    return { text: await write(() => context.emit("StepPressed", {}, cause)), isError: false };
                case "operate": {
                    const type = String(input.type ?? "");
                    return {
                        text: await write(() => context.emit("OperateRequested", input.payload === undefined ? { type } : { type, payload: input.payload }, cause)),
                        isError: false,
                    };
                }
                case "thread":
                    return {
                        text: await write(() => context.emit("ThreadPinRequested", { text: String(input.text ?? "") }, cause)),
                        isError: false,
                    };
                case "ticket": {
                    const action = String(input.action ?? "");
                    const ticketId = typeof input.ticketId === "string" && input.ticketId !== "" ? input.ticketId : turn.ticketId;
                    const text = String(input.text ?? input.note ?? "").trim();
                    const ledgerLine = () => {
                        const ticket = tickets.find((entry) => entry.ticketId === ticketId);
                        return ticket === undefined
                            ? `ticket ${ticketId} | not on the ledger`
                            : `ticket ${ticket.ticketId} | ${ticket.state}${ticket.to === undefined ? "" : ` | to ${ticket.to}`} | ${ticket.notes.length} note${ticket.notes.length === 1 ? "" : "s"}` +
                                (ticket.outcome === undefined ? "" : ` | ${ticket.outcome}`);
                    };
                    if (action === "note") {
                        if (text === "")
                            return { text: "ticket note requires text", isError: true };
                        const digest = await write(() => context.emit("TicketNoted", { ticketId, text, by: context.instanceId }, cause));
                        return { text: `${ledgerLine()}\n${digest}`, isError: false };
                    }
                    if (action === "close") {
                        const outcome = String(input.outcome ?? "done");
                        if (outcome !== "done" && outcome !== "blocked" && outcome !== "wontfix") {
                            return { text: "ticket close requires outcome done|blocked|wontfix", isError: true };
                        }
                        const digest = await write(() => context.emit("TicketClosed", { ticketId, outcome, ...(text === "" ? {} : { note: text }), by: context.instanceId }, cause));
                        return { text: `${ledgerLine()}\n${digest}`, isError: false };
                    }
                    if (action === "file") {
                        if (text === "")
                            return { text: "ticket file requires text", isError: true };
                        const tags = Array.isArray(input.tags) ? input.tags.map(String) : [];
                        const digest = await write(() => context.emit("TicketFiled", { text, tags, parent: turn.ticketId }, cause));
                        const filed = tickets.filter((entry) => entry.parent === turn.ticketId).slice(-1)[0];
                        return { text: `${filed === undefined ? "filed" : `filed ${filed.ticketId} | ${filed.state}`}\n${digest}`, isError: false };
                    }
                    return { text: "ticket requires action note|close|file", isError: true };
                }
                default:
                    return { text: `unknown tool ${block.name ?? "?"}`, isError: true };
            }
        };
        // A model-port hot reload leaves two ports alive for one frame: a call
        // answered by both is taken once.
        const answered = new Set();
        const onModelReturned = (fact) => {
            const turn = live;
            if (turn === null || fact.payload.callId !== turn.callId)
                return;
            if (answered.has(fact.payload.callId))
                return;
            answered.add(fact.payload.callId);
            if (!fact.payload.ok) {
                endTurn(turn, "error", fact.payload.error ?? "model call failed", fact.id);
                return;
            }
            addUsage(turn.usage, fact.payload.usage);
            const response = (fact.payload.response ?? {});
            const content = Array.isArray(response.content) ? response.content : [];
            const stopReason = response.stop_reason ?? "end_turn";
            // The transcript keeps the response verbatim — thinking blocks included,
            // passed back unchanged as the API requires.
            conversation.push({ role: "assistant", content: cloneJson(content) });
            for (const block of content) {
                if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
                    context.emit("AgentSaid", { turnId: turn.id, text: block.text });
                }
            }
            if (stopReason === "refusal") {
                endTurn(turn, stopReason, `refusal${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`, fact.id);
                return;
            }
            if (stopReason === "max_tokens") {
                endTurn(turn, stopReason, `the model hit max_tokens (${MAX_TOKENS})`, fact.id);
                return;
            }
            const calls = content.filter((block) => block.type === "tool_use");
            if (calls.length === 0 || stopReason === "end_turn") {
                endTurn(turn, stopReason, undefined, fact.id);
                return;
            }
            turn.rounds += 1;
            if (turn.rounds > TOOL_ROUNDS_LIMIT) {
                endTurn(turn, stopReason, `tool round limit (${TOOL_ROUNDS_LIMIT}) reached`, fact.id);
                return;
            }
            // Tools run in order, each settled before the next; every result rides
            // back in one user message, as the API expects.
            void (async () => {
                const results = [];
                let lastFact = fact.id;
                for (const block of calls) {
                    if (!active || live !== turn)
                        return;
                    const toolUseId = block.id ?? `${turn.id}-tool-${results.length}`;
                    const calledId = context.emit("AgentToolCalled", { turnId: turn.id, toolUseId, name: block.name ?? "?", input: block.input ?? {} }, { causedBy: [lastFact] });
                    const answer = await runTool(turn, block, calledId);
                    if (!active || live !== turn)
                        return;
                    lastFact = context.emit("AgentToolReturned", { turnId: turn.id, toolUseId, text: answer.text, isError: answer.isError }, { causedBy: [calledId] });
                    results.push({
                        type: "tool_result",
                        tool_use_id: toolUseId,
                        content: answer.text,
                        ...(answer.isError ? { is_error: true } : {}),
                    });
                }
                conversation.push({ role: "user", content: results });
                callModel(turn, lastFact);
            })();
        };
        // Rule 9 seed: the desk hears this mind's charter the moment it starts.
        declareMind();
        return () => {
            active = false;
            live = null;
            queue.length = 0;
        };
    },
});
