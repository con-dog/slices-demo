import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The machine author's rank. Arbitration is by priority carried in the fact,
// never by source name (rule 7): the keyboard emits at 10, so a human typing
// mid-burst always outranks the agent. The port stamps this itself — a
// harness cannot promote its own edits — and stamps it on every ranked
// intent alike (edits, deletes, duplicates, lock requests), so a document
// the human locked at 10 refuses the harness the way it refuses a mind: a
// lock is a rank on the board, and the port cannot outrank it.
// Everything the port may speak into the pool is the human's own intent
// vocabulary — no agent-only STATE types exist. Every entry here that drives
// workspace state is already in the fact-log's record list, so agent work
// journals, survives reload, and replays without the agent present. The two
// machine-door types are deliberately outside the journal: OperateRequested
// mirrors the human's clicks on an authored tool's view (also unjournaled),
// and ProofRequested is a pure query — assaying a candidate changes nothing.
// AgentAskRequested delegates to the resident mind: also unjournaled (a model
// turn is not deterministic — the edits it emits are, and those journal).
const EMITS = [
    "EditRequested",
    "SliceSelected",
    "SliceHideRequested",
    "SliceCreateRequested",
    "SliceDuplicateRequested",
    "SliceDeleteRequested",
    "SliceLockRequested",
    "StepPressed",
    "StepBackPressed",
    "FactSelected",
    "FactDeselected",
    "OperateRequested",
    "ProofRequested",
    "AgentAskRequested",
    "ModelSettingsRequested",
    "WorkspaceResetRequested",
    "WorkspaceRewindRequested",
    "ThreadPinRequested",
    "WorkLogExportRequested",
    "TicketFiled",
    "TicketNoted",
    "TicketClosed",
    "TicketResumeRequested",
];
// Owns the agent transport resource, the way keyboard owns keydown and
// clipboard owns the OS clipboard: an outside process (an LLM harness driving
// DevTools, a test) reaches the pool only through this slice. The API it
// hangs on the global host is fact-shaped — emit intents in, observe facts
// out — because the pool's vocabulary IS the editor's API: bulk writes are
// select-all + insert (the paste idiom), contract edits are meta-set,
// tag-add and tags-set, undo is StepBackPressed. Reads come from a bounded wildcard ring
// and caches — reads are never facts, so watching costs the history nothing.
// The port emits from transport callbacks exactly as the keyboard emits from
// keydown; the clock's heartbeat delivers on the next beat.
export const agentPort = defineSlice({
    type: "agent-port",
    description: "Owns the agent transport: a global API to emit and observe facts.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["*"],
    emits: EMITS,
    start(context) {
        // The port's constants live in its body: this slice is adoptable, and a
        // document body references nothing outside itself and `context`.
        const AGENT_PRIORITY = 1;
        const RING_LIMIT = 5000;
        const FACTS_DEFAULT_LIMIT = 200;
        const TRACE_NODE_LIMIT = 200;
        const SETTLE_TIMEOUT_MS = 3000;
        // Two consecutive quiet beats: one beat can land between an emission and the
        // clock's drain, so a single quiet observation is not yet a settled pool.
        const SETTLE_QUIET_BEATS = 2;
        // The digest is the harness's diet: what changed, never the whole workspace.
        // Bounded so a runaway cascade cannot cost a harness its context.
        const DIGEST_CONTEXT_LINES = 3;
        const DIGEST_LINE_WIDTH = 120;
        const DIGEST_CHAR_LIMIT = 2000;
        const DIGEST_NEW_DOC_LINES = 8;
        const DIGEST_FACT_TYPES = 14;
        const OUTLINE_TAG_LIMIT = 8;
        const OUTLINE_TICKET_LIMIT = 8;
        // The bridge: a second door on the same resource, always dialled — the
        // slice-ide MCP relay listens on this port when it is running, and the page
        // keeps knocking (with backoff) until it does. Nothing is read from the URL.
        const BRIDGE_PORT = 4176;
        const BRIDGE_RETRY_MIN_MS = 500;
        const BRIDGE_RETRY_MAX_MS = 30000;
        // The intent vocabulary, twin of the contract's emits above (rule 6):
        // the body must carry its own copy to stay self-contained.
        const EMITS = [
            "EditRequested",
            "SliceSelected",
            "SliceHideRequested",
            "SliceCreateRequested",
            "SliceDuplicateRequested",
            "SliceDeleteRequested",
            "SliceLockRequested",
            "StepPressed",
            "StepBackPressed",
            "FactSelected",
            "FactDeselected",
            "OperateRequested",
            "ProofRequested",
            "AgentAskRequested",
            "ModelSettingsRequested",
            "WorkspaceResetRequested",
            "WorkspaceRewindRequested",
            "ThreadPinRequested",
            "WorkLogExportRequested",
            "TicketFiled",
            "TicketNoted",
            "TicketClosed",
            "TicketResumeRequested",
        ];
        // --- The ring: recent facts plus the indexes trace() walks. ---
        const ring = [];
        const byId = new Map();
        const childrenOf = new Map();
        let totalFacts = 0;
        // --- The snapshot caches, fed by the same wildcard subscription. ---
        const documents = new Map();
        const slices = new Map();
        let vocabulary = [];
        let schemas = null;
        let guide = null;
        let diagnostics = null;
        let activeFileId = null;
        let replayed = false;
        let stopped = false;
        let thread = { text: "", since: -1, subject: [], trail: [], away: 0 };
        // The desk and the minds, overheard: the ledger as last declared, each
        // mind's charter by instance id (pruned on unmount).
        let tickets = [];
        let desk = false;
        const minds = new Map();
        // The stage, overheard: the declaration seeds seats and holders (rule 9),
        // grants and unmounts are the deltas, tokens ride their own fact.
        let stageSlots = [];
        const stageHeld = new Map();
        const stageDenied = new Map();
        let stageTokens = {};
        // The locks as the lock-book declared them: type -> the minimum priority
        // an intent needs; the outline marks locked documents and slices, since
        // the port's own rank (1) bounces off every default lock.
        let locks = {};
        // The chartered views' charters: view type -> every type the config names.
        const charters = new Map();
        // The kit's marker at the head of a compiled slice's start body: the
        // source says so itself, and the outline repeats it before anyone opens
        // the card.
        const kitMarked = (startSource) => {
            const brace = startSource.indexOf("{");
            if (brace === -1)
                return false;
            return startSource.slice(brace + 1).trimStart().startsWith("// kit:");
        };
        const baselines = new Map();
        // Fact ids of SliceMounted re-publications (rule 9 from the pool): known
        // instances told again to a newcomer, never births in a digest.
        const republished = new Set();
        // The document roster as the last digest rendered it (from the buffer's
        // `fileIds`), so the next digest can name what appeared or vanished.
        let roster = [];
        let digestFrame = 0;
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
                    // The roster prunes: a document the buffer no longer lists (deleted,
                    // or absent from a scrub-restored workspace) leaves the cache from
                    // the outcome fact itself — never guessed from an intent.
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
                        doc.anchor =
                            fact.payload.anchor === null ? null : { ...fact.payload.anchor };
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
                        ...(fact.payload.description !== undefined
                            ? { description: fact.payload.description }
                            : {}),
                        consumes: [...fact.payload.consumes],
                        emits: [...fact.payload.emits],
                        errored: false,
                        hidden: false,
                        ...(kitMarked(fact.payload.startSource) ? { kit: true } : {}),
                    });
                    break;
                }
                case "SliceUnmounted": {
                    slices.delete(fact.payload.sliceId);
                    minds.delete(fact.payload.sliceId);
                    for (const [slot, holder] of [...stageHeld]) {
                        if (holder.sliceId === fact.payload.sliceId)
                            stageHeld.delete(slot);
                    }
                    stageDenied.delete(fact.payload.sliceId);
                    break;
                }
                case "StageSlotsDeclared": {
                    stageSlots = [...fact.payload.slots];
                    // The declaration is the seed: seats it no longer lists as held
                    // are free, seats it names keep their last-known geometry.
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
                    stageDenied.set(fact.payload.sliceId, {
                        slot: fact.payload.slot,
                        reason: fact.payload.reason,
                    });
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
                    schemas = {
                        types: [...fact.payload.types],
                        versions: { ...fact.payload.versions },
                        shapes: { ...fact.payload.shapes },
                    };
                    break;
                }
                case "GuideDeclared": {
                    guide = { topics: fact.payload.topics.map((topic) => ({ ...topic })) };
                    break;
                }
                case "DiagnosticsPublished": {
                    diagnostics = {
                        revision: fact.payload.revision,
                        diagnostics: fact.payload.diagnostics.map((entry) => ({ ...entry })),
                    };
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
                case "TicketsDeclared": {
                    tickets = fact.payload.tickets.map((ticket) => ({ ...ticket }));
                    desk = fact.payload.replayed;
                    break;
                }
                case "MindDeclared": {
                    minds.set(fact.sourceSlice, { ...fact.payload, tags: [...fact.payload.tags] });
                    break;
                }
                case "WorkspaceReplayed": {
                    replayed = true;
                    break;
                }
                default:
                    break;
            }
        });
        // The pool types emit by the declared union; the port dispatches by
        // runtime string, so it loosens the signature once — after its own
        // whitelist and the contract validator have both passed the payload.
        const emitLoose = context.emit;
        // The port validates nothing beyond its own emits list: the firewall is
        // the only validator, so a malformed payload is delivered, flagged, and
        // comes back to the harness as a ContractViolated verdict in the
        // settled cascade — validation feedback as pool traffic, not as an
        // imported check.
        const emit = (type, payload) => {
            if (!EMITS.includes(type)) {
                throw new Error(`agent-port cannot emit ${type} | allowed: ${EMITS.join(", ")}`);
            }
            const agentType = type;
            const given = payload ?? {};
            // Every ranked intent is stamped, never trusted: a harness edits,
            // copies, deletes and locks at machine rank, whatever it wrote.
            const ranked = agentType === "EditRequested" ||
                agentType === "SliceDeleteRequested" ||
                agentType === "SliceDuplicateRequested" ||
                agentType === "SliceLockRequested";
            const stamped = ranked && typeof given === "object" && given !== null
                ? { ...given, priority: AGENT_PRIORITY }
                : given;
            const id = emitLoose(agentType, stamped);
            lastEmittedId = id;
            return id;
        };
        // A fact handle as anything the port prints: `frame:seq`, `intent
        // frame:seq`, the bare sequence, or `last` — the last fact this port
        // emitted.
        let lastEmittedId = null;
        const resolveFactId = (handle) => {
            const bare = String(handle).trim().replace(/^(?:intent|fact)\s+/i, "");
            if (bare === "last")
                return lastEmittedId;
            if (byId.has(bare))
                return bare;
            if (/^\d+$/.test(bare)) {
                for (const id of byId.keys())
                    if (id.endsWith(`:${bare}`))
                        return id;
            }
            return null;
        };
        const factsSince = (sinceFrame) => ring.filter((fact) => fact.frame > sinceFrame).map(viewOf);
        // --- The diet: text renderings a harness can afford to read every turn. ---
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
        const stageView = () => ({
            slots: [...stageSlots],
            held: Object.fromEntries([...stageHeld].map(([slot, holder]) => [slot, { ...holder }])),
            denied: Object.fromEntries([...stageDenied].map(([sliceId, entry]) => [sliceId, { ...entry }])),
            tokens: { ...stageTokens },
        });
        const renderOutline = () => {
            const out = [];
            out.push(`frame ${context.frameNumber} | active ${activeFileId ?? "-"} | ${replayed ? "live" : "booting"} | vocabulary ${vocabulary.length} types`);
            // The thread: what the human is doing, before the inventory of what exists.
            out.push(thread.text === ""
                ? "thread: none pinned"
                : `thread: ${thread.text} | since frame ${thread.since}` +
                    (thread.subject.length > 0 ? ` | subject ${thread.subject.join(",")}` : "") +
                    (thread.away > 0 ? ` | ${thread.away} away` : "") +
                    ` | ${thread.trail.length} step${thread.trail.length === 1 ? "" : "s"} (snapshot().thread.trail)`);
            // The tickets: the work in flight, counts then the open ones (done
            // tickets are counted, never listed — snapshot().tickets has them all).
            const todo = tickets.filter((ticket) => ticket.state === "todo");
            const doing = tickets.filter((ticket) => ticket.state === "doing");
            const done = tickets.filter((ticket) => ticket.state === "done").length;
            const parked = doing.filter((ticket) => !ticket.working).length;
            out.push(`tickets: ${todo.length} todo | ${doing.length} doing${parked > 0 ? ` (${parked} parked)` : ""} | ${done} done` +
                (desk ? "" : " | desk replaying") +
                ` | minds: ${minds.size === 0
                    ? "-"
                    : [...minds]
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([id, mind]) => `${id} ${mind.state}${mind.ticketId === undefined ? "" : ` ${mind.ticketId}`}`)
                        .join(", ")}`);
            const open = [...todo, ...doing].slice(-OUTLINE_TICKET_LIMIT);
            for (const ticket of open) {
                const flag = ticket.state === "doing"
                    ? ticket.working ? "working" : "parked"
                    : ticket.awaiting.length > 0
                        ? "bidding"
                        : ticket.bids.length + ticket.passed.length > 0
                            ? "no takers"
                            : "parked";
                out.push(`  ${ticket.ticketId} ${ticket.state} ${flag}${ticket.to === undefined ? "" : ` -> ${ticket.to}`}` +
                    ` | ${ticket.tags.length === 0 ? "-" : ticket.tags.join(",")} | ${JSON.stringify(clip(ticket.text, DIGEST_LINE_WIDTH))}` +
                    (ticket.notes.length > 0 ? ` | ${ticket.notes.length} note${ticket.notes.length === 1 ? "" : "s"}` : ""));
            }
            if (todo.length + doing.length > open.length)
                out.push(`  … ${todo.length + doing.length - open.length} more open (snapshot().tickets)`);
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
        // Feature-detected like the clock's heartbeat: browsers beat on
        // animation frames (right behind the clock's drain), the node harness
        // on a short timer while the test driver advances the pool itself.
        const schedule = typeof window !== "undefined" && "requestAnimationFrame" in window
            ? (beat) => window.requestAnimationFrame(() => beat())
            : (beat) => void setTimeout(beat, 16);
        const settle = (options = {}) => {
            const timeoutMs = options.timeoutMs ?? SETTLE_TIMEOUT_MS;
            const sinceFrame = context.frameNumber;
            const deadline = Date.now() + timeoutMs;
            return new Promise((resolve) => {
                let lastCount = totalFacts;
                let quietBeats = 0;
                const finish = (timedOut) => {
                    const facts = factsSince(sinceFrame);
                    const digest = renderDigest(facts);
                    digestFrame = context.frameNumber;
                    resolve({
                        facts,
                        violations: facts.filter((entry) => entry.type === "ContractViolated"),
                        timedOut,
                        digest,
                    });
                };
                const beat = () => {
                    if (stopped)
                        return finish(true);
                    if (totalFacts === lastCount)
                        quietBeats += 1;
                    else {
                        quietBeats = 0;
                        lastCount = totalFacts;
                    }
                    if (quietBeats >= SETTLE_QUIET_BEATS)
                        return finish(false);
                    if (Date.now() >= deadline)
                        return finish(true);
                    schedule(beat);
                };
                schedule(beat);
            });
        };
        let proofCount = 0;
        const api = {
            emit,
            async send(type, payload) {
                // A batch lands in one frame: emits are synchronous and the pool
                // stamps every queued fact frame+1, so the buffer coalesces the
                // batch into one BufferChanged (one undo step) and the foundry
                // remounts once.
                const batch = Array.isArray(payload) ? payload : [payload];
                if (batch.length === 0)
                    throw new Error("agent-port send: an empty batch emits nothing");
                const factIds = batch.map((entry) => emit(type, entry));
                const settled = await settle();
                return { factId: factIds[0], factIds, ...settled };
            },
            async operate(type, payload) {
                return api.send("OperateRequested", payload === undefined ? { type } : { type, payload });
            },
            async proof(given, lines) {
                proofCount += 1;
                const proofId = `proof-${proofCount}`;
                // A { fileId } (or {}) assays a document as it stands, from the cache;
                // meta + lines assay a candidate not yet typed.
                let meta = given;
                let body = lines;
                if (!("type" in given) || body === undefined) {
                    const fileId = ("fileId" in given && typeof given.fileId === "string" ? given.fileId : null) ?? activeFileId;
                    const doc = fileId === null ? undefined : documents.get(fileId);
                    if (doc === undefined)
                        throw new Error(`proof: no document ${fileId ?? "(none active)"} — give meta + lines, or a fileId from the outline`);
                    meta = { type: doc.meta.type, description: doc.meta.description, consumes: [...doc.meta.consumes], emits: [...doc.meta.emits] };
                    body = [...doc.lines];
                }
                const settled = await api.send("ProofRequested", { proofId, meta, lines: body });
                const answer = settled.facts.find((entry) => entry.type === "ProofReturned" &&
                    entry.payload.proofId === proofId);
                return {
                    ...settled,
                    report: answer === undefined ? null : answer.payload,
                };
            },
            facts(options = {}) {
                const { sinceFrame, types, limit = FACTS_DEFAULT_LIMIT } = options;
                const wanted = types === undefined ? null : new Set(types);
                return ring
                    .filter((fact) => (sinceFrame === undefined || fact.frame > sinceFrame) &&
                    (wanted === null || wanted.has(fact.type)))
                    .slice(-Math.max(0, limit))
                    .map(viewOf);
            },
            snapshot() {
                return {
                    frame: context.frameNumber,
                    replayed,
                    thread: { ...thread, subject: [...thread.subject], trail: thread.trail.map((entry) => ({ ...entry })) },
                    tickets: {
                        replayed: desk,
                        tickets: tickets.map((ticket) => ({ ...ticket })),
                        minds: Object.fromEntries([...minds].map(([id, mind]) => [id, { ...mind, tags: [...mind.tags] }])),
                    },
                    activeFileId,
                    documents: Object.fromEntries([...documents].map(([fileId, doc]) => [fileId, documentOf(doc)])),
                    slices: Object.fromEntries([...slices].map(([sliceId, entry]) => [
                        sliceId,
                        { ...entry, consumes: [...entry.consumes], emits: [...entry.emits] },
                    ])),
                    vocabulary: [...vocabulary],
                    schemas: schemas === null
                        ? null
                        : {
                            types: [...schemas.types],
                            versions: { ...schemas.versions },
                            shapes: { ...schemas.shapes },
                        },
                    guide: guide === null
                        ? null
                        : { topics: guide.topics.map((topic) => ({ ...topic })) },
                    diagnostics: diagnostics === null
                        ? null
                        : { ...diagnostics, diagnostics: [...diagnostics.diagnostics] },
                    stage: stageView(),
                    locks: { ...locks },
                };
            },
            trace(handle, options = {}) {
                const { maxNodes = TRACE_NODE_LIMIT } = options;
                const factId = resolveFactId(handle);
                const root = factId === null ? undefined : byId.get(factId);
                if (factId === null || root === undefined)
                    return null;
                const walk = (next) => {
                    const out = [];
                    const seen = new Set([factId]);
                    let frontier = [factId];
                    let depth = 0;
                    while (frontier.length > 0 && out.length < maxNodes) {
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
                                out.push({ ...viewOf(fact), depth });
                                upcoming.push(link);
                                if (out.length >= maxNodes)
                                    break;
                            }
                            if (out.length >= maxNodes)
                                break;
                        }
                        frontier = upcoming;
                    }
                    return out;
                };
                return {
                    fact: viewOf(root),
                    causes: walk((id) => byId.get(id)?.causedBy ?? []),
                    effects: walk((id) => childrenOf.get(id) ?? []),
                };
            },
            digest(options = {}) {
                const sinceFrame = options.sinceFrame ?? digestFrame;
                const text = renderDigest(factsSince(sinceFrame));
                digestFrame = context.frameNumber;
                return text;
            },
            read(options = {}) {
                return renderRead(options);
            },
            outline() {
                return renderOutline();
            },
            help: {
                emits: [...EMITS],
                editKinds: [
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
                reads: ["outline", "read", "digest", "facts", "trace", "snapshot"],
                usage: "Ramp cheaply: outline() (one line per document and living slice, " +
                    "then the stage: every seat and who holds it; a slice marked `kit` " +
                    "opens as source that cannot start as written; one marked `locked " +
                    ">=N` refuses this door's edits, copies and deletes — the port stamps " +
                    "priority 1, the human's toolbar locks and unlocks at 10 — and the " +
                    "digest says `refused:` when you hit one; do not work around a lock, " +
                    "say which slice needs unlocking), " +
                    "then read({ fileId?, from?, to? }) for the lines you need; " +
                    "snapshot().guide is the operator's manual (time, undo, documents, the " +
                    "foundry's adoption law) — read it once, and snapshot() itself only when " +
                    "you need the whole workspace as data. emit(type, payload) queues an " +
                    "intent (EditRequested payload: { edit }; priority is stamped by the " +
                    "port). Bulk-write a body with select-all then one insert; surgical " +
                    "edits are replace-match { find, text, occurrence? } (content-anchored: " +
                    "the Nth occurrence of find becomes text, no line arithmetic, a miss is " +
                    "a no-op — the digest says `no BufferChanged | replace-match missed`) or replace-range { from, " +
                    "to, text } (zero-based carets); each is one undo step. Contract " +
                    "edits: meta-set { field: type|description, value }, tag-add|tag-remove " +
                    "{ side, tag }, or tags-set { side, tags } to write a whole side as " +
                    "data. send(type, payload) is emit plus settle in one call — an ARRAY " +
                    "payload is a batch that lands in one frame (one BufferChanged, one " +
                    "undo step, one remount) — and every settled result " +
                    "carries digest — compact text of what the cascade changed (revision " +
                    "move, touched lines in context, slice mounts, verdicts, violations): " +
                    "read that, not facts; its `facts:` line is the cascade's own types in " +
                    "order, and when nothing changed it says why. digest() alone renders " +
                    "what changed since the last digest. A malformed payload is not rejected " +
                    "here — the firewall flags it, and it returns in the result's " +
                    "violations. trace(handle) walks causality from any printed handle " +
                    "(`frame:seq`, `intent frame:seq`, the bare sequence, `last`); " +
                    "proof({ fileId }) assays a document as it stands. operate(type, " +
                    "payload) presses an authored tool: it " +
                    "speaks one fact of the OPEN vocabulary (sketched types only; registry " +
                    "types are refused, and a refusal carries no emission in its cascade). " +
                    "proof(meta, lines) assays a candidate document before you commit it: " +
                    "the foundry's compile and shape checks plus the rule-book's lint, " +
                    "mounting nothing — the report rides back as ok | verdicts | sketched. " +
                    "ModelSettingsRequested { key?, provider?, model? } sets the model-port's " +
                    "resource (the ticket rack's KEY field and MODEL dropdown speak the same " +
                    "fact; an empty string forgets). The work is tickets: send(\"TicketFiled\", " +
                    "{ text, tags?, effort? }) files one, the desk calls for bids, the winning " +
                    "mind works it in one turn and closes it (TicketClosed); TicketNoted adds " +
                    "a breadcrumb, TicketResumeRequested re-awards a parked one or opens a " +
                    "todo one nobody serves; outline() prints the counts and the open " +
                    "tickets, snapshot().tickets carries them all with bids and notes and " +
                    "the minds' roster. emit(\"AgentAskRequested\", { text }) still works: " +
                    "the desk files it as a ticket. WorkspaceResetRequested discards the " +
                    "journal and reboots the page (the tray's RESET button); " +
                    "WorkspaceRewindRequested drops the journal's tail back through the last " +
                    "document-changing input and reboots (the tray's REWIND button — the way " +
                    "out of a semantic brick that keeps the session; the boot after it " +
                    "announces WorkspaceRewound). This API is " +
                    "also served over a local WebSocket the page dials on its own — the " +
                    "slice-ide MCP relay's door (npm run mcp).",
            },
            settle,
        };
        // The host global is the transport surface — the machine author's door,
        // the way keydown is the human's. globalThis keeps the same port drivable
        // under the node test harness, where window does not exist.
        const host = globalThis;
        host.slicesAgent = api;
        // --- The second door: a local WebSocket, always dialled. ---
        // Same resource, same api object — an outside process (the slice-ide MCP
        // relay) speaks { id, method, params } and gets { id, result } or
        // { id, error }. Feature-detected like everything else the port touches:
        // no WebSocket (the node tests) means no bridge, silently. A closed port
        // is not an error either — the page keeps knocking, backing off to half
        // a minute, so starting the relay after the page is enough.
        const bridgePort = () => {
            if (typeof window === "undefined" || typeof WebSocket === "undefined")
                return null;
            return BRIDGE_PORT;
        };
        const answer = async (raw) => {
            let id = null;
            try {
                const message = JSON.parse(raw);
                id = message.id ?? null;
                const method = typeof message.method === "string" ? message.method : "";
                const member = api[method];
                if (member === undefined)
                    throw new Error(`unknown method ${method}`);
                const params = Array.isArray(message.params) ? message.params : [];
                const result = typeof member === "function"
                    ? await member.apply(api, params)
                    : member;
                return JSON.stringify({ id, result: result === undefined ? null : result });
            }
            catch (error) {
                return JSON.stringify({
                    id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        };
        let socket = null;
        let retryMs = BRIDGE_RETRY_MIN_MS;
        let retryTimer = null;
        const connect = (port) => {
            if (stopped)
                return;
            const ws = new WebSocket(`ws://127.0.0.1:${port}`);
            socket = ws;
            ws.onopen = () => {
                retryMs = BRIDGE_RETRY_MIN_MS;
            };
            ws.onmessage = (event) => {
                void answer(String(event.data)).then((reply) => {
                    if (ws.readyState === ws.OPEN)
                        ws.send(reply);
                });
            };
            ws.onerror = () => {
                ws.close();
            };
            ws.onclose = () => {
                if (socket === ws)
                    socket = null;
                if (stopped)
                    return;
                retryTimer = setTimeout(() => connect(port), retryMs);
                retryMs = Math.min(retryMs * 2, BRIDGE_RETRY_MAX_MS);
            };
        };
        const bridge = bridgePort();
        if (bridge !== null)
            connect(bridge);
        return () => {
            stopped = true;
            if (retryTimer !== null)
                clearTimeout(retryTimer);
            socket?.close();
            if (host.slicesAgent === api)
                delete host.slicesAgent;
        };
    },
});
