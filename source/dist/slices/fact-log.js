import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The replayable fact log, returned as an ordinary slice under the ordinary
// law: types from the contracts, the definer from the kernel, and nothing
// whispered — no factory, no options, no charter. This slice OWNS the
// journal resource the way keyboard owns keydown and clipboard owns the OS
// clipboard, so the journal's vocabulary is its own opinion, visible in its
// source: what it records (the input boundary), what paces replay (the state
// owners' markers), where the journal lives, and the version that retires
// stale recordings. The pool's history IS the application: this slice
// journals the session's input facts and replays them through the pool on
// the next boot, and every deterministic state owner rebuilds by hearing the
// same inputs again — documents, edit history, undo branches, and every
// autosaved slice return without any of them knowing a reload happened.
//
// Time travel is journaled causally, not temporally: a TimelineScrubbed is
// stored as "the state after journal entry N" via the causal chain from
// recorded inputs to their markers, and named as a concrete frame again
// during replay. Abandoned undo branches replay exactly as they happened —
// the journal is append-only, like the pool it mirrors.
export const factLog = defineSlice({
    type: "fact-log",
    description: "Journals the session's input facts and replays them on boot.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["*"],
    emits: [
        "EditRequested",
        "SliceSelected",
        "SliceHideRequested",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
        "SliceLockRequested",
        "ThreadPinRequested",
        "TicketFiled",
        "TicketBidPlaced",
        "TicketPassed",
        "TicketNoted",
        "TicketClosed",
        "TicketResumeRequested",
        "TimelineScrubbed",
        "WorkspaceReplayed",
        "WorkspaceRewound",
        "JournalDeclared",
        "JournalAppended",
    ],
    start(context) {
        // --- The journal's own opinions, in its own source ---
        // What it records: the input boundary — the facts born outside the pool
        // (keystrokes, card clicks, toolbar intents, the agent-port's edits).
        // Everything else is derived and regenerates during replay, so it is
        // never stored. This list and the emits list above are the same law
        // twice: a journal may only replay what it declared it would speak.
        const RECORD = new Set([
            "EditRequested",
            "SliceSelected",
            "SliceHideRequested",
            "SliceCreateRequested",
            "SliceDuplicateRequested",
            "SliceDeleteRequested",
            // A lock is a workspace opinion: pinned once, replayed on every boot.
            "SliceLockRequested",
            // The thread is an input like any other: pinned once, replayed on
            // every boot, so "what was I doing" survives the reload with the work.
            "ThreadPinRequested",
            // The desk's intents: filings, bids, passes, notes, closes, resumes —
            // the ledger rebuilds from them (the desk applies them silently while
            // replaying, so no window opens and no model call fires on boot).
            "TicketFiled",
            "TicketBidPlaced",
            "TicketPassed",
            "TicketNoted",
            "TicketClosed",
            "TicketResumeRequested",
        ]);
        // What proves a recorded input has been applied: the state owners'
        // publications. Replay emits the next journal group only once a marker
        // causally descended from the current one arrives — the live session's
        // ordering without the live session's clock. Replay begins the moment a
        // slice that emits markers is on the board (the workspace boots empty,
        // so there is no seed publication to wait for — the state owner's own
        // mount is the seed state); a marker before that would do the same.
        const MARKERS = new Set([
            "BufferChanged",
            "CaretMoved",
            "BufferRestored",
            "SliceSaved",
        ]);
        // Pacers advance replay like markers do but never seed it and never
        // enter the state index: the desk declares its ledger at boot, before
        // the buffer's seed, and a ledger declaration is not a document state.
        const PACERS = new Set(["TicketsDeclared"]);
        // What REWIND drops back through: the inputs that change a document or
        // the roster — the ones an autosave turns into running code. Everything
        // journaled after the last of them goes with it (a note, a pin, a
        // select — all cheap), never anything before it: intents replay against
        // the text as it stood, so a hole in the middle would land later edits
        // on the wrong lines.
        const PROGRAM_CHANGING = new Set([
            "EditRequested",
            "SliceCreateRequested",
            "SliceDuplicateRequested",
            "SliceDeleteRequested",
        ]);
        const STORAGE_KEY = "slice-ide|fact-log";
        // Journals replay edit intents against stub documents regenerated at
        // replay time, so any drift in stub text lands old carets in the wrong
        // places — a version mismatch discards the stale journal cleanly.
        // v5: the type-only import law rebound every slice's definer; v6: the
        // journal's return as an ordinary slice; v7: the workspace boots empty
        // (no seed document for old journals' first edits to land in).
        const VERSION = "7";
        const SCRUB_TYPE = "TimelineScrubbed";
        const SAVE_DEBOUNCE_MS = 200;
        const GROUP_DEADLINE_MS = 150;
        const CAUSE_MAP_LIMIT = 16384;
        const STATE_INDEX_LIMIT = 8192;
        const isEntry = (value) => {
            if (typeof value !== "object" || value === null)
                return false;
            const entry = value;
            if (typeof entry.group !== "number")
                return false;
            if (typeof entry.scrub === "number")
                return true;
            return typeof entry.type === "string" && "payload" in entry;
        };
        // Where the journal lives between sessions. A headless host (the node
        // tests) simply keeps none. The escape hatch is a fact —
        // WorkspaceResetRequested, the tray's RESET button — and it is the
        // resource owner's to honour, like focus is the keyboard's: the journal
        // is discarded, and the page reboots into an empty workspace.
        const store = typeof window !== "undefined" && "localStorage" in window
            ? window.localStorage
            : undefined;
        // Once reset, this instance never writes again — the pagehide flush on
        // the way out must not resurrect what was just discarded.
        let discarded = false;
        // A hot reload of this slice (it is adoptable) mounts a fresh instance
        // into a workspace that already replayed: replaying the journal again
        // would type the whole session twice. The page load is the session's
        // identity — performance.timeOrigin is constant for one document and
        // fresh for a reload — so the instance that finished a replay stamps
        // it, and a successor in the same document keeps the journal, appends
        // to it, and does not replay it. A real reload replays as ever.
        const LOAD_KEY = "slice-ide|fact-log|replayed-load";
        const session = typeof window !== "undefined" && "sessionStorage" in window ? window.sessionStorage : undefined;
        const loadId = typeof performance !== "undefined" && typeof performance.timeOrigin === "number"
            ? String(performance.timeOrigin)
            : null;
        const replayedThisLoad = loadId !== null && session?.getItem(LOAD_KEY) === loadId;
        // The crash-loop guard. A replay in progress is stamped with the load
        // it belongs to and the stamp is cleared when WorkspaceReplayed fires —
        // or when the page leaves on purpose (pagehide runs only if the main
        // thread is alive). A stamp from ANOTHER load found at boot therefore
        // means the last replay stuck the page (a body that loops forever, a
        // pathological cascade), and the same journal would strand every
        // reload: the guard trims the tail back through the last
        // program-changing input, once, and says so (WorkspaceRewound). A
        // requested REWIND stamps what it dropped for the next boot to announce.
        const REPLAYING_KEY = "slice-ide|fact-log|replaying";
        const REWOUND_KEY = "slice-ide|fact-log|rewound";
        // --- The journal ---
        const loadJournal = () => {
            try {
                const text = store?.getItem(STORAGE_KEY) ?? null;
                if (text === null)
                    return [];
                const parsed = JSON.parse(text);
                if (typeof parsed !== "object" || parsed === null)
                    return [];
                const journal = parsed;
                if (journal.v !== VERSION)
                    return [];
                if (!Array.isArray(journal.entries) || !journal.entries.every(isEntry)) {
                    return [];
                }
                return journal.entries;
            }
            catch {
                return [];
            }
        };
        const entries = loadJournal();
        // Drop the journal's tail back through the last program-changing group
        // (or the last group of all when none is); returns how many entries went.
        const trimTail = () => {
            if (entries.length === 0)
                return 0;
            let cut = entries.length - 1;
            while (cut >= 0) {
                const entry = entries[cut];
                if (!("scrub" in entry) && PROGRAM_CHANGING.has(entry.type))
                    break;
                cut -= 1;
            }
            const group = cut < 0 ? entries[entries.length - 1].group : entries[cut].group;
            let first = entries.length;
            while (first > 0 && entries[first - 1].group >= group)
                first -= 1;
            const dropped = entries.length - first;
            entries.length = first;
            return dropped;
        };
        const readRewound = () => {
            try {
                const text = store?.getItem(REWOUND_KEY) ?? null;
                if (text === null)
                    return null;
                const parsed = JSON.parse(text);
                if (typeof parsed.dropped !== "number")
                    return null;
                return { dropped: parsed.dropped, reason: parsed.reason === "crash-loop" ? "crash-loop" : "requested" };
            }
            catch {
                return null;
            }
        };
        let rewound = readRewound();
        try {
            store?.removeItem(REWOUND_KEY);
        }
        catch {
            // A store that will not forget will be told again next boot; harmless.
        }
        const strandedLoad = store?.getItem(REPLAYING_KEY) ?? null;
        if (strandedLoad !== null && strandedLoad !== loadId && !replayedThisLoad) {
            const dropped = trimTail();
            if (dropped > 0)
                rewound = { dropped, reason: "crash-loop" };
            try {
                store?.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, entries }));
                store?.removeItem(REPLAYING_KEY);
            }
            catch {
                // Nothing to do: the next boot finds the same stamp and trims again.
            }
        }
        const replayCount = replayedThisLoad ? 0 : entries.length;
        if (replayCount > 0 && loadId !== null) {
            try {
                store?.setItem(REPLAYING_KEY, loadId);
            }
            catch {
                // No stamp, no guard — the journal still replays.
            }
        }
        if (rewound !== null) {
            context.emit("WorkspaceRewound", {
                dropped: rewound.dropped,
                remaining: entries.length,
                reason: rewound.reason,
            });
        }
        // The journal as a fact: the baseline a mirror (the disk-port) starts
        // from — published at boot and again for a late joiner that names the
        // type (rule 9; never for the wildcard, the payload is the whole
        // journal). Appends follow as JournalAppended, one per recorded input.
        // `trimmed` is what this boot dropped, so a mirror one trim longer knows
        // it is stale, not another lineage.
        let journalDeclaredFrame = -1;
        const declareJournal = () => {
            journalDeclaredFrame = context.frameNumber;
            context.emit("JournalDeclared", {
                version: VERSION,
                entries: [...entries],
                trimmed: rewound?.dropped ?? 0,
            });
        };
        declareJournal();
        let saveHandle;
        let saveFailed = false;
        // The store is the human's. Once this instance has written the journal,
        // finding the key gone means someone wiped the storage from outside
        // (DevTools, another tab's RESET) — that is a reset by other means, and
        // writing the journal back on the way out (the pagehide flush) would
        // resurrect exactly what they discarded. So a wiped store discards this
        // instance too: it stops journaling, and the reload starts clean.
        let persisted = entries.length > 0;
        const wipedOutside = () => {
            if (!persisted)
                return false;
            try {
                return store !== undefined && store.getItem(STORAGE_KEY) === null;
            }
            catch {
                return false;
            }
        };
        const flush = () => {
            if (saveHandle !== undefined)
                clearTimeout(saveHandle);
            saveHandle = undefined;
            if (discarded)
                return;
            if (wipedOutside()) {
                discarded = true;
                entries.length = 0;
                return;
            }
            try {
                store?.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, entries }));
                persisted = true;
            }
            catch (error) {
                if (!saveFailed) {
                    saveFailed = true;
                    console.warn("fact-log could not persist the journal.", error);
                }
            }
        };
        const scheduleSave = () => {
            if (saveHandle !== undefined)
                clearTimeout(saveHandle);
            saveHandle = setTimeout(flush, SAVE_DEBOUNCE_MS);
        };
        // --- Causal bookkeeping ---
        // Which journal entry a fact descends from, propagated along causedBy.
        // Chains are shallow (a few frames), so the map is pruned FIFO.
        const indexByFact = new Map();
        const factOrder = [];
        const remember = (id, index) => {
            if (indexByFact.has(id))
                return;
            indexByFact.set(id, index);
            factOrder.push(id);
            if (factOrder.length > CAUSE_MAP_LIMIT) {
                for (const stale of factOrder.splice(0, CAUSE_MAP_LIMIT / 2)) {
                    indexByFact.delete(stale);
                }
            }
        };
        // The frame each entry's first marker landed in (this session), so a
        // replayed scrub entry can name a concrete frame again.
        const markerFrameByIndex = new Map();
        // Which entry's state was on show as of a given frame — the journal's
        // mirror of a snapshot ring. Scrubs make it non-monotone in value
        // (parking shows an older entry), never in frame.
        const stateIndex = [];
        const stateIndexAppend = (frame, index) => {
            stateIndex.push({ frame, index });
            if (stateIndex.length > STATE_INDEX_LIMIT) {
                stateIndex.splice(0, STATE_INDEX_LIMIT / 2);
            }
        };
        const stateIndexAt = (frameNumber) => {
            for (let i = stateIndex.length - 1; i >= 0; i -= 1) {
                if (stateIndex[i].frame <= frameNumber)
                    return stateIndex[i].index;
            }
            return -1;
        };
        // The pool types emit by the declared union; replay dispatches by the
        // journal's runtime strings — every one of them recorded from this
        // slice's own RECORD list, which the emits list above mirrors — so the
        // signature is loosened once, the agent-port's own idiom.
        const emitLoose = context.emit;
        // --- Replay ---
        // waiting: no state owner yet (no marker-emitting slice has mounted).
        // replaying: journal groups are being re-emitted, paced by markers.
        // live: recording — the only phase that appends to the journal.
        let phase = "waiting";
        let seedFrame = -1;
        let cursor = 0;
        let groupFirstIndex = 0;
        let deadlineHandle;
        // Inputs arriving mid-replay (the user typing during boot) are journaled
        // after the replayed entries rather than interleaved into them.
        const sideQueue = [];
        const clearDeadline = () => {
            if (deadlineHandle !== undefined)
                clearTimeout(deadlineHandle);
            deadlineHandle = undefined;
        };
        // Live appends restart grouping after the replayed entries.
        let groupOrdinal = entries.reduce((max, entry) => Math.max(max, entry.group), -1);
        let lastAppendFrame = -1;
        const groupFor = (frame) => {
            if (frame !== lastAppendFrame) {
                groupOrdinal += 1;
                lastAppendFrame = frame;
            }
            return groupOrdinal;
        };
        const append = (fact) => {
            if (discarded)
                return;
            const index = entries.length;
            if (fact.type === SCRUB_TYPE) {
                const payload = fact.payload;
                const frameNumber = typeof payload?.frameNumber === "number" ? payload.frameNumber : -1;
                entries.push({ group: groupFor(fact.frame), scrub: stateIndexAt(frameNumber) });
            }
            else {
                entries.push({ group: groupFor(fact.frame), type: fact.type, payload: fact.payload });
            }
            // Seed the causal map so this input's markers attribute back to it —
            // including a foreign scrub's BufferRestored, which is what lets a
            // later drag onto a restore frame translate correctly.
            remember(fact.id, index);
            scheduleSave();
            context.emit("JournalAppended", { index, entry: entries[index] });
        };
        const finishReplay = () => {
            clearDeadline();
            phase = "live";
            lastAppendFrame = -1;
            for (const queued of sideQueue)
                append(queued);
            sideQueue.length = 0;
            if (loadId !== null) {
                try {
                    session?.setItem(LOAD_KEY, loadId);
                }
                catch {
                    // A host without session storage simply replays on every mount.
                }
            }
            try {
                store?.removeItem(REPLAYING_KEY);
            }
            catch {
                // A stamp that will not clear reads as a stranded replay next boot;
                // the guard then trims one input it did not need to. Rare, and said.
            }
            context.emit("WorkspaceReplayed", { entries: replayCount });
        };
        const emitNextGroup = () => {
            clearDeadline();
            if (cursor >= replayCount) {
                finishReplay();
                return;
            }
            const group = entries[cursor].group;
            groupFirstIndex = cursor;
            while (cursor < replayCount && entries[cursor].group === group) {
                const entry = entries[cursor];
                const id = "scrub" in entry
                    ? context.emit("TimelineScrubbed", {
                        frameNumber: entry.scrub < 0
                            ? seedFrame
                            : (markerFrameByIndex.get(entry.scrub) ?? seedFrame),
                    })
                    : emitLoose(entry.type, entry.payload);
                remember(id, cursor);
                cursor += 1;
            }
            // A recorded input can be a no-op (nothing answers it), so a deadline
            // keeps the replay from parking on a group that never earns a marker.
            deadlineHandle = setTimeout(() => {
                if (phase === "replaying")
                    emitNextGroup();
            }, GROUP_DEADLINE_MS);
        };
        // The reset: discard the journal, forget everything in memory, and reboot
        // the page — the state owners cannot un-know, so a fresh workspace is a
        // fresh boot. Headless hosts (tests) get the discard without the reload.
        const reset = () => {
            discarded = true;
            phase = "live";
            clearDeadline();
            if (saveHandle !== undefined)
                clearTimeout(saveHandle);
            saveHandle = undefined;
            entries.length = 0;
            sideQueue.length = 0;
            store?.removeItem(STORAGE_KEY);
            store?.removeItem(REPLAYING_KEY);
            store?.removeItem(REWOUND_KEY);
            if (typeof location !== "undefined" && typeof location.reload === "function") {
                location.reload();
            }
        };
        // The rewind: drop the tail back through the last program-changing
        // input, write the journal at once (no debounce — the page is about to
        // go), stamp what went for the next boot to announce, and reboot: the
        // state owners cannot un-know, so the workspace before that input is a
        // fresh replay. Headless hosts (tests) get the trim and the announcement
        // without the reload. Never journaled, like RESET.
        const rewind = () => {
            const dropped = trimTail();
            clearDeadline();
            if (saveHandle !== undefined)
                clearTimeout(saveHandle);
            saveHandle = undefined;
            try {
                store?.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, entries }));
                store?.setItem(REWOUND_KEY, JSON.stringify({ dropped, reason: "requested" }));
                persisted = true;
            }
            catch (error) {
                console.warn("fact-log could not persist the rewound journal.", error);
            }
            if (typeof location !== "undefined" && typeof location.reload === "function") {
                discarded = true;
                location.reload();
                return;
            }
            context.emit("WorkspaceRewound", { dropped, remaining: entries.length, reason: "requested" });
        };
        // The restore: the disk-port read a journal off the disk (RESTORE) and
        // hands it over in this journal's own format; the store is ours, so we
        // write it and reboot — the state owners cannot un-know, so the
        // workspace the disk had is a fresh replay. A foreign version is
        // ignored (the disk-port checks first and says so). Headless hosts get
        // the write without the reload. Never journaled, like REWIND and RESET.
        const restore = (version, backup) => {
            if (version !== VERSION || !backup.every(isEntry))
                return;
            clearDeadline();
            if (saveHandle !== undefined)
                clearTimeout(saveHandle);
            saveHandle = undefined;
            entries.length = 0;
            for (const entry of backup)
                entries.push(entry);
            try {
                store?.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, entries }));
                store?.removeItem(REPLAYING_KEY);
                persisted = true;
            }
            catch (error) {
                console.warn("fact-log could not persist the restored journal.", error);
            }
            if (typeof location !== "undefined" && typeof location.reload === "function") {
                discarded = true;
                location.reload();
            }
        };
        context.subscribe("*", (fact) => {
            if (fact.type === "WorkspaceResetRequested") {
                reset();
                return;
            }
            if (fact.type === "WorkspaceRewindRequested") {
                rewind();
                return;
            }
            if (fact.type === "WorkspaceBackupRead") {
                const payload = fact.payload;
                restore(payload.version, payload.entries);
                return;
            }
            if (fact.type === "SliceMounted") {
                const payload = fact.payload;
                if (payload.consumes.includes("JournalDeclared") && journalDeclaredFrame !== context.frameNumber) {
                    declareJournal();
                }
            }
            // Propagate journal attribution along the causal graph.
            let inherited = -1;
            for (const cause of fact.causedBy) {
                const index = indexByFact.get(cause);
                if (index !== undefined && index > inherited)
                    inherited = index;
            }
            if (inherited >= 0)
                remember(fact.id, inherited);
            if (PACERS.has(fact.type)) {
                if (inherited >= 0 && phase === "replaying" && inherited >= groupFirstIndex) {
                    emitNextGroup();
                }
                return;
            }
            // The seed state is on the table — a state owner that publishes
            // markers has mounted (its own SliceMounted lands before any intent
            // this replay emits can be delivered), or a marker itself arrived —
            // so replay can begin.
            const ownerMounted = fact.type === "SliceMounted" &&
                fact.payload.emits.some((type) => MARKERS.has(type));
            if (seedFrame < 0 && (ownerMounted || MARKERS.has(fact.type))) {
                seedFrame = fact.frame;
                if (phase === "waiting") {
                    if (replayCount > 0) {
                        phase = "replaying";
                        emitNextGroup();
                    }
                    else {
                        finishReplay();
                    }
                }
            }
            if (MARKERS.has(fact.type)) {
                if (inherited >= 0) {
                    if (!markerFrameByIndex.has(inherited)) {
                        markerFrameByIndex.set(inherited, fact.frame);
                    }
                    stateIndexAppend(fact.frame, inherited);
                    if (phase === "replaying" && inherited >= groupFirstIndex) {
                        emitNextGroup();
                    }
                }
                return;
            }
            // Recording. Never our own emissions: replayed facts are already in
            // the journal, and re-recording them would double it every boot.
            if (fact.sourceSlice === context.instanceId)
                return;
            if (!RECORD.has(fact.type) && fact.type !== SCRUB_TYPE)
                return;
            if (phase === "live")
                append(fact);
            else
                sideQueue.push(fact);
        });
        // The journal must survive the tab closing mid-debounce. Leaving on
        // purpose mid-replay is not a stranding: the stamp goes with the page.
        const onHidden = () => {
            if (typeof document === "undefined" || document.visibilityState === "hidden") {
                flush();
            }
        };
        const onLeave = () => {
            flush();
            if (phase !== "live") {
                try {
                    store?.removeItem(REPLAYING_KEY);
                }
                catch {
                    // Then the next boot trims one input it did not need to, and says so.
                }
            }
        };
        const hasWindow = typeof window !== "undefined";
        if (hasWindow) {
            window.addEventListener("pagehide", onLeave);
            window.addEventListener("visibilitychange", onHidden);
        }
        return () => {
            clearDeadline();
            flush();
            if (hasWindow) {
                window.removeEventListener("pagehide", onLeave);
                window.removeEventListener("visibilitychange", onHidden);
            }
        };
    },
});
