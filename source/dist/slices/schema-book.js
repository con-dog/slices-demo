import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The law as a document. This slice owns every event type's payload shape —
// as DATA, in its own body, published as SchemasDeclared (rule 9) — the way
// rule-book owns the compliance rules. The firewall compiles what this
// slice declares; the completion oracle seeds its vocabulary from it; the
// agent-port serves it to harnesses. Nothing imports validation anywhere:
// the type system's runtime half lives HERE, on the board, and because the
// body is self-contained this slice is adoptable — the law itself can be
// edited from inside the editor it governs.
export const schemaBook = defineSlice({
    type: "schema-book",
    description: "Owns the law: every payload shape as data, one declaration.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["SliceMounted"],
    emits: ["SchemasDeclared"],
    start(context) {
        // Local shape grammar (mirrors the kit's Shape DSL, duplicated by rule
        // 6 — this body may reference nothing outside itself).
        const str = { is: "string" };
        const strFull = { is: "string", nonEmpty: true };
        const num = { is: "number" };
        const num0 = { is: "number", min: 0 };
        const bool = { is: "boolean" };
        const empty = { is: "object", fields: {} };
        const lit = (...oneOf) => ({ is: "literal", oneOf });
        const arr = (items, nonEmpty) => ({
            is: "array",
            items,
            ...(nonEmpty ? { nonEmpty } : {}),
        });
        const rec = (values) => ({ is: "record", values });
        const obj = (fields, optional) => ({
            is: "object",
            fields,
            ...(optional ? { optional } : {}),
        });
        const nullable = (inner) => ({ is: "nullable", inner });
        const choice = (key, variants) => ({
            is: "choice",
            key,
            variants,
        });
        const unknown = { is: "unknown" };
        const caret = obj({ line: num0, column: num0 });
        const meta = obj({
            type: strFull,
            description: str,
            consumes: arr(str),
            emits: arr(str),
        });
        const document = obj({
            fileId: strFull,
            meta,
            lines: arr(str, true),
            caret,
            anchor: nullable(caret),
            revision: num,
            fileIds: arr(strFull, true),
        });
        const edit = choice("kind", {
            insert: obj({ text: strFull }),
            backspace: empty,
            delete: empty,
            "caret-move": obj({
                direction: lit("left", "right", "up", "down", "line-start", "line-end"),
                extend: bool,
            }, ["extend"]),
            "caret-set": obj({ line: num0, column: num0, extend: bool }, ["extend"]),
            "select-all": empty,
            "replace-range": obj({ from: caret, to: caret, text: str }),
            "replace-match": obj({ find: strFull, text: str, occurrence: { is: "number", min: 1 } }, ["occurrence"]),
            "meta-set": obj({ field: lit("type", "description"), value: str }),
            "tag-add": obj({ side: lit("consumes", "emits"), tag: strFull }),
            "tag-remove": obj({ side: lit("consumes", "emits"), tag: strFull }),
            "tags-set": obj({ side: lit("consumes", "emits"), tags: arr(strFull) }),
        });
        const tokenSpan = obj({
            start: num0,
            length: { is: "number", min: 1 },
            kind: lit("keyword", "string", "comment", "number", "punct", "ident"),
        });
        const lintRule = obj({ id: strFull, pattern: strFull, message: str, exempt: arr(strFull) }, ["exempt"]);
        const apiEntry = obj({ name: strFull, signature: strFull, doc: strFull });
        const proofVerdict = obj({ kind: lit("compile", "shape", "lint"), message: str, line: num0 }, ["line"]);
        const completionItem = obj({ label: strFull, signature: str, doc: str }, ["signature", "doc"]);
        const guideTopic = obj({ id: strFull, title: strFull, body: strFull });
        const threadStep = obj({
            frame: num,
            kind: lit("pin", "edit", "open", "create", "delete", "verdict", "fixed", "ask", "mind", "back"),
            note: str,
            times: { is: "number", min: 1 },
        });
        const agentUsage = obj({ input: num0, output: num0, cacheRead: num0, cacheWrite: num0 });
        const effort = lit("low", "medium", "high", "xhigh", "max");
        const ticketBid = obj({ mind: strFull, bid: num, note: str }, ["note"]);
        const ticketNote = obj({ by: strFull, text: str, frame: num });
        const ticket = obj({
            ticketId: strFull,
            factId: strFull,
            frame: num,
            text: str,
            tags: arr(str),
            parent: strFull,
            effort,
            state: lit("todo", "doing", "done"),
            to: strFull,
            bids: arr(ticketBid),
            passed: arr(strFull),
            awaiting: arr(strFull),
            notes: arr(ticketNote),
            working: bool,
            turnId: strFull,
            outcome: lit("done", "blocked", "wontfix"),
            closeNote: str,
        }, ["parent", "effort", "to", "turnId", "outcome", "closeNote"]);
        const diagnostic = obj({
            ruleId: str,
            line: num0,
            column: num0,
            length: num0,
            message: str,
        });
        const SCHEMAS = {
            FrameTicked: { version: 1, shape: obj({ frameNumber: num }) },
            StepPressed: { version: 1, shape: empty },
            StepBackPressed: { version: 1, shape: empty },
            TimelineScrubbed: { version: 1, shape: obj({ frameNumber: num }) },
            EditRequested: { version: 4, shape: obj({ edit, priority: num }) },
            BufferChanged: { version: 5, shape: document },
            CaretMoved: {
                version: 3,
                shape: obj({ fileId: strFull, caret, anchor: nullable(caret), revision: num }),
            },
            BufferRestored: { version: 5, shape: document },
            CopyRequested: { version: 1, shape: empty },
            CutRequested: { version: 1, shape: empty },
            SliceCreateRequested: { version: 1, shape: empty },
            // v2: `priority` — the asker's rank, so a locked type can refuse.
            SliceDuplicateRequested: { version: 2, shape: obj({ sliceId: strFull, priority: num }, ["priority"]) },
            SliceDeleteRequested: { version: 2, shape: obj({ sliceId: strFull, priority: num }, ["priority"]) },
            // The locks: a rank on a document, set by a hand of rank; the ledger;
            // and the verdict an owner speaks when an intent falls below the bar.
            SliceLockRequested: { version: 1, shape: obj({ sliceId: strFull, minPriority: num0, priority: num }) },
            SliceLocksDeclared: { version: 1, shape: obj({ locks: rec(num) }) },
            IntentRefused: {
                version: 1,
                shape: obj({
                    intent: strFull,
                    fileId: strFull,
                    reason: lit("locked", "immortal"),
                    priority: num,
                    minPriority: num,
                }, ["priority", "minPriority"]),
            },
            WorkspaceReplayed: { version: 1, shape: obj({ entries: num0 }) },
            ThreadPinRequested: { version: 1, shape: obj({ text: str }) },
            ThreadDeclared: {
                version: 1,
                shape: obj({
                    text: str,
                    since: num,
                    subject: arr(strFull),
                    trail: arr(threadStep),
                    away: num0,
                }),
            },
            SliceSaved: {
                version: 1,
                shape: obj({ sliceId: str, sliceType: strFull, fileId: strFull }),
            },
            ContractSketched: { version: 1, shape: obj({ types: arr(strFull, true) }) },
            VocabularyDeclared: { version: 1, shape: obj({ types: arr(str, true) }) },
            SchemasDeclared: {
                version: 1,
                shape: obj({
                    types: arr(strFull, true),
                    versions: rec(num),
                    shapes: rec(unknown),
                }),
            },
            CompletionRequested: {
                version: 1,
                shape: obj({ field: strFull, prefix: strFull }),
            },
            CompletionSuggested: {
                version: 1,
                shape: obj({ field: strFull, prefix: str, suggestions: arr(str) }),
            },
            OperateRequested: {
                version: 1,
                shape: obj({ type: strFull, payload: unknown }, ["payload"]),
            },
            ProofRequested: {
                version: 1,
                shape: obj({ proofId: strFull, meta, lines: arr(str, true) }),
            },
            ProofReturned: {
                version: 1,
                shape: obj({
                    proofId: strFull,
                    ok: bool,
                    verdicts: arr(proofVerdict),
                    sketched: arr(str),
                }),
            },
            ApiDeclared: { version: 1, shape: obj({ entries: arr(apiEntry, true) }) },
            CompletionOffered: {
                version: 2,
                shape: obj({
                    revision: num,
                    from: caret,
                    to: caret,
                    items: arr(completionItem),
                    selected: num0,
                }),
            },
            CompletionNavigated: {
                version: 1,
                shape: obj({ direction: lit("up", "down") }),
            },
            CompletionDismissed: { version: 1, shape: empty },
            TokensMapped: {
                version: 1,
                shape: obj({ revision: num, lineTokens: arr(arr(tokenSpan)) }),
            },
            LintRulesDeclared: { version: 1, shape: obj({ rules: arr(lintRule, true) }) },
            GuideDeclared: { version: 1, shape: obj({ topics: arr(guideTopic, true) }) },
            DiagnosticsPublished: {
                version: 1,
                shape: obj({ revision: num, diagnostics: arr(diagnostic) }),
            },
            ContractViolated: {
                version: 1,
                shape: obj({
                    factId: str,
                    factType: str,
                    sourceSlice: str,
                    reason: lit("undeclared-emit", "invalid-payload", "unknown-source", "unknown-type"),
                    expectedVersion: num,
                }, ["expectedVersion"]),
            },
            FactSelected: { version: 1, shape: obj({ factId: strFull }) },
            FactDeselected: { version: 1, shape: empty },
            CausalPathTraced: {
                version: 1,
                shape: obj({ rootId: str, factIds: arr(str) }),
            },
            SliceSelected: { version: 1, shape: obj({ sliceId: strFull }) },
            SliceHideRequested: { version: 1, shape: obj({ sliceId: strFull }) },
            SliceVisibilityChanged: {
                version: 1,
                shape: obj({ sliceId: strFull, hidden: bool }),
            },
            SliceErrorChanged: {
                version: 1,
                shape: obj({ sliceId: strFull, errored: bool, message: str }, ["message"]),
            },
            ViewConfigDeclared: {
                version: 1,
                shape: obj({ view: strFull, config: rec(unknown) }),
            },
            // The layout-book's word: rows keyed by number, each a height and a
            // cell count or weight list (`cells` is a number or an array, so it
            // stays unknown here); the stage compiles it.
            LayoutDeclared: {
                version: 1,
                shape: obj({
                    rows: rec(obj({ height: str, cells: unknown }, ["height", "cells"])),
                    columns: obj({ floor: str, cap: str }, ["floor", "cap"]),
                    anchors: obj({ band: str, corner: str, center: str }, ["band", "corner", "center"]),
                }, ["columns", "anchors"]),
            },
            // The journal as facts (the fact-log's own entry format stays opaque)
            // and the disk mirror's doors.
            JournalDeclared: { version: 1, shape: obj({ version: str, entries: arr(unknown), trimmed: num0 }) },
            JournalAppended: { version: 1, shape: obj({ index: num0, entry: unknown }) },
            WorkspaceDiskRequested: { version: 1, shape: obj({ action: lit("link", "unlink", "overwrite") }) },
            WorkspaceRestoreRequested: { version: 1, shape: empty },
            WorkspaceBackupRead: { version: 1, shape: obj({ version: str, entries: arr(unknown) }) },
            WorkspaceDiskDeclared: {
                version: 1,
                shape: obj({
                    state: lit("unsupported", "none", "prompt", "synced", "backup", "error"),
                    name: str,
                    local: num0,
                    disk: num0,
                    savedAt: str,
                    error: str,
                }, ["name", "disk", "savedAt", "error"]),
            },
            WorkLogExportRequested: { version: 1, shape: empty },
            WorkLogExported: {
                version: 1,
                shape: obj({ fileName: strFull, bytes: num0, tickets: num0, turns: num0, steps: num0 }),
            },
            StageSlotsDeclared: { version: 2, shape: obj({ slots: arr(str, true), held: rec(str) }) },
            StageTokensDeclared: { version: 1, shape: obj({ tokens: rec(str) }) },
            ViewSlotRequested: { version: 1, shape: obj({ slot: str }) },
            ViewSlotAssigned: {
                version: 2,
                shape: obj({
                    sliceId: str,
                    slot: str,
                    geometry: str,
                    grid: obj({ row: num, rowEnd: num, column: num, columnEnd: num }),
                }, ["grid"]),
            },
            ViewSlotDenied: {
                version: 1,
                shape: obj({ sliceId: str, slot: str, reason: lit("unknown-slot", "occupied") }),
            },
            // `lock` is the slice's own rank, when its definition declares one —
            // the lock-book's seed rides the mount fact.
            SliceMounted: {
                version: 2,
                shape: obj({
                    sliceId: str,
                    sliceType: strFull,
                    description: str,
                    consumes: arr(str),
                    emits: arr(str),
                    startSource: str,
                    lock: num0,
                }, ["description", "lock"]),
            },
            SliceUnmounted: { version: 1, shape: obj({ sliceId: str }) },
            // The resident mind and its transport: asks in, turns and model calls
            // out. Response bodies stay `unknown` — the port hands them through.
            AgentAskRequested: {
                version: 1,
                shape: obj({ text: strFull, effort }, ["effort"]),
            },
            // Tickets: the work as facts — filed, opened for bids, bid on, awarded,
            // noted, closed; the ledger and each mind's charter as state (rule 9).
            TicketFiled: {
                version: 1,
                shape: obj({ text: strFull, tags: arr(str), parent: strFull, effort }, ["tags", "parent", "effort"]),
            },
            TicketOpened: { version: 1, shape: obj({ ticketId: strFull, text: str, tags: arr(str) }) },
            TicketBidPlaced: {
                version: 1,
                shape: obj({ ticketId: strFull, mind: strFull, bid: num, note: str }, ["note"]),
            },
            TicketPassed: { version: 1, shape: obj({ ticketId: strFull, mind: strFull }) },
            TicketAssigned: {
                version: 1,
                shape: obj({ ticketId: strFull, to: strFull, text: str, tags: arr(str), effort }, ["effort"]),
            },
            TicketNoted: { version: 1, shape: obj({ ticketId: strFull, text: str, by: strFull }, ["by"]) },
            TicketClosed: {
                version: 1,
                shape: obj({ ticketId: strFull, outcome: lit("done", "blocked", "wontfix"), note: str, by: strFull }, ["note", "by"]),
            },
            TicketResumeRequested: { version: 1, shape: obj({ ticketId: strFull }) },
            TicketsDeclared: {
                version: 1,
                shape: obj({ tickets: arr(ticket), replayed: bool, serial: num0 }),
            },
            MindDeclared: {
                version: 1,
                shape: obj({
                    specialty: str,
                    tags: arr(str),
                    baseBid: num,
                    bidRule: str,
                    state: lit("idle", "working"),
                    ticketId: strFull,
                }, ["ticketId"]),
            },
            // v2: the turn names the ticket it serves.
            AgentTurnStarted: {
                version: 2,
                shape: obj({ turnId: strFull, text: str, ticketId: strFull }, ["ticketId"]),
            },
            AgentSaid: { version: 1, shape: obj({ turnId: strFull, text: str }) },
            AgentToolCalled: {
                version: 1,
                shape: obj({ turnId: strFull, toolUseId: strFull, name: strFull, input: unknown }),
            },
            AgentToolReturned: {
                version: 1,
                shape: obj({ turnId: strFull, toolUseId: strFull, text: str, isError: bool }),
            },
            AgentTurnEnded: {
                version: 1,
                shape: obj({ turnId: strFull, stopReason: str, usage: agentUsage, error: str }, ["error"]),
            },
            ModelCallRequested: {
                version: 1,
                shape: obj({ callId: strFull, model: strFull, request: unknown }, ["model"]),
            },
            ModelReturned: {
                version: 1,
                shape: obj({ callId: strFull, ok: bool, response: unknown, error: str, usage: agentUsage }, ["response", "error", "usage"]),
            },
            // The port's resource, set from the console: every field optional, an
            // empty string forgets. The key rides this one intent, then lives only
            // in the port's storage — the declaration carries a hint, never the key.
            ModelSettingsRequested: {
                version: 1,
                shape: obj({ key: str, provider: lit("anthropic", "openrouter", ""), model: str }, ["key", "provider", "model"]),
            },
            // The door's models travel shelved by vendor (label + ids); an
            // unlisted choice rides first on a `custom` shelf.
            ModelSettingsDeclared: {
                version: 2,
                shape: obj({
                    provider: lit("anthropic", "openrouter"),
                    model: strFull,
                    groups: arr(obj({ label: strFull, models: arr(strFull) })),
                    keyHint: nullable(str),
                }),
            },
            // The RESET button: the fact-log discards its journal and reboots.
            WorkspaceResetRequested: { version: 1, shape: empty },
            // The REWIND button: the fact-log drops the journal's tail and
            // reboots; the boot after a trim announces what went, and why.
            WorkspaceRewindRequested: { version: 1, shape: empty },
            WorkspaceRewound: {
                version: 1,
                shape: obj({ dropped: num0, remaining: num0, reason: lit("requested", "crash-loop") }),
            },
        };
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("SchemasDeclared", {
                types: Object.keys(SCHEMAS),
                versions: Object.fromEntries(Object.entries(SCHEMAS).map(([type, entry]) => [type, entry.version])),
                shapes: Object.fromEntries(Object.entries(SCHEMAS).map(([type, entry]) => [type, entry.shape])),
            });
        };
        declare();
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("SchemasDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
