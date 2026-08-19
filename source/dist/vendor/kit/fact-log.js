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
const SCRUB_TYPE = "TimelineScrubbed";
const SAVE_DEBOUNCE_MS = 200;
const GROUP_DEADLINE_MS = 150;
const CAUSE_MAP_LIMIT = 16384;
const STATE_INDEX_LIMIT = 8192;
const localStorageBackend = (key) => {
    const store = typeof window !== "undefined" && "localStorage" in window
        ? window.localStorage
        : undefined;
    return {
        load: () => store?.getItem(key) ?? null,
        save: (text) => store?.setItem(key, text),
        clear: () => store?.removeItem(key),
    };
};
/**
 * Infrastructure slice factory: the replayable fact log. The pool's history
 * IS the application, so persistence is not per-slice save code — this slice
 * journals the session's input facts and replays them through the pool on
 * the next boot. Every deterministic state owner (buffers, foundries,
 * timelines, snapshot rings) rebuilds itself by hearing the same inputs
 * again; the whole workspace — including undo history and dynamically
 * mounted slices — survives reload without any slice knowing it happened.
 *
 * Time travel is journaled causally, not temporally: a TimelineScrubbed is
 * translated to "the state after journal entry N" via the causal chain from
 * recorded inputs to their markers, and translated back to a concrete frame
 * during replay. Abandoned undo branches replay exactly as they happened —
 * the journal is append-only, like the pool it mirrors.
 */
export function factLogFor(options) {
    const recordTypes = new Set(options.record);
    const markerTypes = new Set(options.markers);
    const emits = [...new Set([...options.record, SCRUB_TYPE])];
    if (options.announceAs !== undefined)
        emits.push(options.announceAs);
    return {
        type: "fact-log",
        description: "Journals the session's input facts and replays them on boot.",
        consumes: ["*"],
        emits,
        start(context) {
            const storage = options.storage ?? localStorageBackend(options.storageKey);
            if (options.discard)
                storage.clear();
            // --- The journal ---
            const loadJournal = () => {
                if (options.discard)
                    return [];
                try {
                    const text = storage.load();
                    if (text === null)
                        return [];
                    const parsed = JSON.parse(text);
                    if (typeof parsed !== "object" || parsed === null)
                        return [];
                    const journal = parsed;
                    if (journal.v !== options.version)
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
            const replayCount = entries.length;
            let saveHandle;
            let saveFailed = false;
            const flush = () => {
                if (saveHandle !== undefined)
                    clearTimeout(saveHandle);
                saveHandle = undefined;
                try {
                    storage.save(JSON.stringify({ v: options.version, entries }));
                }
                catch (error) {
                    if (!saveFailed) {
                        saveFailed = true;
                        console.warn("fact-log could not persist the journal.", error);
                    }
                }
            };
            const scheduleSave = () => {
                if (options.saveMode === "immediate") {
                    flush();
                    return;
                }
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
            };
            const finishReplay = () => {
                clearDeadline();
                phase = "live";
                lastAppendFrame = -1;
                for (const queued of sideQueue)
                    append(queued);
                sideQueue.length = 0;
                if (options.announceAs !== undefined) {
                    context.emit(options.announceAs, { entries: replayCount });
                }
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
                        ? context.emit(SCRUB_TYPE, {
                            frameNumber: entry.scrub < 0
                                ? seedFrame
                                : (markerFrameByIndex.get(entry.scrub) ?? seedFrame),
                        })
                        : context.emit(entry.type, entry.payload);
                    remember(id, cursor);
                    cursor += 1;
                }
                // A recorded input can be a no-op (nothing answers it), so a deadline
                // keeps the replay from parking on a group that never earns a marker.
                if (typeof setTimeout === "function") {
                    deadlineHandle = setTimeout(() => {
                        if (phase === "replaying")
                            emitNextGroup();
                    }, GROUP_DEADLINE_MS);
                }
            };
            context.subscribe("*", (fact) => {
                // Propagate journal attribution along the causal graph.
                let inherited = -1;
                for (const cause of fact.causedBy) {
                    const index = indexByFact.get(cause);
                    if (index !== undefined && index > inherited)
                        inherited = index;
                }
                if (inherited >= 0)
                    remember(fact.id, inherited);
                // The seed state is on the table — a state owner that publishes
                // markers has mounted (its SliceMounted lands before any intent this
                // replay emits can be delivered), or a marker itself arrived — so
                // replay can begin.
                const ownerMounted = fact.type === "SliceMounted" &&
                    fact.payload.emits?.some((type) => markerTypes.has(type)) === true;
                if (seedFrame < 0 && (ownerMounted || markerTypes.has(fact.type))) {
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
                if (markerTypes.has(fact.type)) {
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
                if (!recordTypes.has(fact.type) && fact.type !== SCRUB_TYPE)
                    return;
                if (phase === "live")
                    append(fact);
                else
                    sideQueue.push(fact);
            });
            // The journal must survive the tab closing mid-debounce.
            const onHidden = () => {
                if (typeof document === "undefined" || document.visibilityState === "hidden") {
                    flush();
                }
            };
            const hasWindow = typeof window !== "undefined";
            if (hasWindow) {
                window.addEventListener("pagehide", flush);
                window.addEventListener("visibilitychange", onHidden);
            }
            return () => {
                clearDeadline();
                flush();
                if (hasWindow) {
                    window.removeEventListener("pagehide", flush);
                    window.removeEventListener("visibilitychange", onHidden);
                }
            };
        },
    };
}
