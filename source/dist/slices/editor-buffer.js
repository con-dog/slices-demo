import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The single owner of every document (rule 8): all slice contracts, their
// code bodies, carets, and the active pointer live here and nowhere else.
// Edit intents apply to the active document on the next FrameTicked; any
// change (body text, contract field, tag) publishes BufferChanged (the undo
// grain), caret-only changes publish CaretMoved (never an undo step).
// Navigation is slices, not files: SliceSelected (a visualizer card click)
// opens the slice's document — the one it was saved from, the doc that
// names its type, or a structured stub from its SliceMounted contract.
// Opening, creating, duplicating, and deleting all publish BufferChanged —
// markers, so undo steps back through them. Snapshots record the whole
// workspace; typing after a restore branches.
export const editorBuffer = defineSlice({
    type: "editor-buffer",
    description: "Owns every slice document and the open one; applies intents, replays.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "EditRequested",
        "FrameTicked",
        "SliceSelected",
        "SliceCreateRequested",
        "SliceDuplicateRequested",
        "SliceDeleteRequested",
        "SliceSaved",
        "TimelineScrubbed",
        "SliceMounted",
        "SliceUnmounted",
        "BufferRestored",
        "SliceLocksDeclared",
    ],
    emits: ["BufferChanged", "CaretMoved", "BufferRestored", "IntentRefused"],
    start(context) {
        const SNAPSHOT_LIMIT = 600;
        // The design law's description limit (the foundry refuses longer ones);
        // clamped here so an intent can never plant an unmountable value.
        const DESCRIPTION_LIMIT = 80;
        // A document IS a slice, structured: the contract half as data (the id IS
        // the type) and a code body that is the inside of start(context) { … } —
        // the foundry assembles the wrapper when it autosaves, so no document
        // ever carries defineSlice text. There are no placeholder files and no
        // seed: the workspace boots empty — nothing open, nothing mounted — and
        // every document arrives by intent (ADD, a card click, DUPLICATE).
        const skeletonDoc = (type) => ({
            meta: {
                type,
                description: "A newborn slice, still warm from the toolbar.",
                consumes: ["FrameTicked"],
                emits: [],
            },
            // The body starts empty: the form above it is the contract, the blank
            // page below is start(context), and no boilerplate explains either.
            lines: [""],
            caret: { line: 0, column: 0 },
            anchor: null,
        });
        // A mounted slice's definition, cached from SliceMounted facts so a
        // SliceSelected for a slice with no document can open its real source: the
        // mount fact carries the running start function's own text, so the body a
        // compiled slice opens with IS the code that is executing — never a copy.
        // Which lines of a body begin inside a multi-line template literal. A
        // template's columns are string content — dedent must never touch them —
        // while code indentation is only formatting. Signage-grade scanning, the
        // syntax oracle's fidelity: line comments, block comments, quotes, and
        // backticks carry across. Interpolation is entered: `${` opens a hole of
        // code (its braces counted so an object literal inside does not close it)
        // that may itself hold a nested template — the stage's stylesheet is one —
        // so a backtick inside a hole opens the inner string instead of closing
        // the outer one, and a line that begins inside a hole is code.
        const templateStarts = (lines) => {
            const starts = [];
            const stack = [];
            const top = () => stack[stack.length - 1];
            let inBlockComment = false;
            for (const line of lines) {
                starts.push(top()?.template === true);
                let at = 0;
                while (at < line.length) {
                    const ch = line[at];
                    const frame = top();
                    if (inBlockComment) {
                        const close = line.indexOf("*/", at);
                        if (close === -1)
                            at = line.length;
                        else {
                            inBlockComment = false;
                            at = close + 2;
                        }
                    }
                    else if (frame?.template === true) {
                        if (ch === "\\")
                            at += 2;
                        else if (ch === "`") {
                            stack.pop();
                            at += 1;
                        }
                        else if (ch === "$" && line[at + 1] === "{") {
                            stack.push({ template: false, braces: 0 });
                            at += 2;
                        }
                        else
                            at += 1;
                    }
                    else if (ch === "/" && line[at + 1] === "/") {
                        at = line.length;
                    }
                    else if (ch === "/" && line[at + 1] === "*") {
                        inBlockComment = true;
                        at += 2;
                    }
                    else if (ch === '"' || ch === "'") {
                        let end = at + 1;
                        while (end < line.length && line[end] !== ch) {
                            end += line[end] === "\\" ? 2 : 1;
                        }
                        at = Math.min(end + 1, line.length);
                    }
                    else if (ch === "`") {
                        stack.push({ template: true });
                        at += 1;
                    }
                    else if (ch === "{") {
                        if (frame !== undefined)
                            frame.braces += 1;
                        at += 1;
                    }
                    else if (ch === "}") {
                        if (frame !== undefined) {
                            if (frame.braces === 0)
                                stack.pop();
                            else
                                frame.braces -= 1;
                        }
                        at += 1;
                    }
                    else {
                        at += 1;
                    }
                }
            }
            return starts;
        };
        // The inside of start(context), recovered from the mounted function's source:
        // strip the signature and outer braces, drop blank edges, dedent code lines
        // by their common margin. Lines inside template literals keep every column —
        // dedenting them would change the string the program builds — so the margin
        // is measured over code lines only. A shape this cannot read (an arrow with
        // no block) opens blank; the contract half is still real and editable.
        const bodyLines = (startSource) => {
            if (startSource === undefined)
                return [""];
            const open = startSource.indexOf("{");
            const close = startSource.lastIndexOf("}");
            if (open === -1 || close <= open)
                return [""];
            const lines = startSource.slice(open + 1, close).split("\n");
            while (lines.length > 0 && lines[0].trim() === "")
                lines.shift();
            while (lines.length > 0 && lines[lines.length - 1].trim() === "")
                lines.pop();
            if (lines.length === 0)
                return [""];
            const inTemplate = templateStarts(lines);
            const margins = lines
                .filter((line, index) => line.trim() !== "" && !inTemplate[index])
                .map((line) => (line.match(/^[ \t]*/)?.[0] ?? "").length);
            if (margins.length === 0)
                return [...lines];
            const margin = Math.min(...margins);
            return lines.map((line, index) => (inTemplate[index] ? line : line.slice(margin)));
        };
        // The whole workspace at one instant — what a snapshot records, so time
        // travel restores not just text but which documents existed and which was
        // open.
        const cloneDoc = (doc) => ({
            meta: {
                type: doc.meta.type,
                description: doc.meta.description,
                consumes: [...doc.meta.consumes],
                emits: [...doc.meta.emits],
            },
            lines: [...doc.lines],
            caret: { ...doc.caret },
            anchor: doc.anchor === null ? null : { ...doc.anchor },
        });
        // A type name is kebab law: whatever an intent carries is folded to it.
        const kebab = (value) => value
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, "-")
            .replace(/-{2,}/g, "-")
            .replace(/^-+|-+$/g, "");
        // Empty at boot (no document is open until an intent opens one), or a
        // predecessor's whole workspace when this buffer is a hot reload's
        // successor (below). activeId is null exactly while docs is empty.
        const docs = new Map();
        let activeId = null;
        let revision = 0;
        const active = () => {
            const doc = activeId === null ? undefined : docs.get(activeId);
            if (!doc)
                throw new Error(`Active document ${activeId} is missing.`);
            return doc;
        };
        // Slice navigation state, derived from the pool's own lifecycle facts:
        // which document each saved type came from, and every mounted type's
        // public contract (for stubs). Neither is workspace state — a scrub
        // restores documents, not the pool's mount history.
        const savedDocs = new Map();
        const contracts = new Map();
        const typeOf = (sliceId) => sliceId.split("#")[0];
        const resolveDocId = (type) => {
            const saved = savedDocs.get(type);
            if (saved !== undefined && docs.has(saved))
                return saved;
            if (docs.has(type))
                return type;
            return null;
        };
        // The locks, as the lock-book last declared them: type -> the minimum
        // priority an intent needs to touch that document. This buffer never
        // decides who is locked; it only refuses below the bar, and says so —
        // IntentRefused is the verdict the digest prints, never a silent no-op.
        const locks = new Map();
        context.subscribe("SliceLocksDeclared", (fact) => {
            locks.clear();
            for (const [type, level] of Object.entries(fact.payload.locks))
                locks.set(type, level);
        });
        const lockOf = (type) => locks.get(type) ?? 0;
        const refuse = (intent, fileId, reason, priority, minPriority) => {
            context.emit("IntentRefused", {
                intent,
                fileId,
                reason,
                priority,
                ...(minPriority === undefined ? {} : { minPriority }),
            });
        };
        // A compiled slice's document, generated from its mounted definition:
        // the contract half is real and editable (the wildcard included — a
        // slice that consumes "*" must say so, or its build dies at start), and
        // the body is the running start function's own source — every mounted
        // slice opens as readable, real code, whether or not it can be adopted
        // yet.
        const stubDoc = (type, contract) => ({
            meta: {
                type,
                description: contract.description ?? "",
                consumes: [...contract.consumes],
                emits: [...contract.emits],
            },
            lines: bodyLines(contract.startSource),
            caret: { line: 0, column: 0 },
            anchor: null,
        });
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
        // An empty workspace is never recorded: a scrub to before the first
        // document lands on the first document (the ring's oldest state), the
        // way it once landed on the seed.
        const record = () => {
            if (activeId === null)
                return;
            snapshots.record(context.frameNumber + 1, {
                activeId,
                docs: [...docs.entries()].map(([id, doc]) => [id, cloneDoc(doc)]),
            });
        };
        const docPayload = (id = activeId) => {
            const doc = id === null ? undefined : docs.get(id);
            if (id === null || !doc)
                throw new Error(`Document ${id} is missing.`);
            const copy = cloneDoc(doc);
            return {
                fileId: id,
                meta: copy.meta,
                lines: copy.lines,
                caret: copy.caret,
                anchor: copy.anchor,
                revision,
                // The roster: which documents exist, in this buffer's order. A
                // listener reads deletions and scrub-restored rosters from the same
                // fact that names the changed document.
                fileIds: [...docs.keys()],
            };
        };
        const clampedCaret = (doc, line, column) => {
            const targetLine = Math.max(0, Math.min(line, doc.lines.length - 1));
            return {
                line: targetLine,
                column: Math.max(0, Math.min(column, doc.lines[targetLine].length)),
            };
        };
        const beforeOrEqual = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
        const selectionRange = (doc) => {
            if (doc.anchor === null)
                return null;
            if (doc.anchor.line === doc.caret.line && doc.anchor.column === doc.caret.column) {
                return null;
            }
            return beforeOrEqual(doc.anchor, doc.caret)
                ? { start: doc.anchor, end: doc.caret }
                : { start: doc.caret, end: doc.anchor };
        };
        // Removes the selected range (if any); the caret lands on its start.
        const deleteSelection = (doc) => {
            const range = selectionRange(doc);
            doc.anchor = null;
            if (range === null)
                return false;
            const head = doc.lines[range.start.line].slice(0, range.start.column);
            const tail = doc.lines[range.end.line].slice(range.end.column);
            doc.lines.splice(range.start.line, range.end.line - range.start.line + 1, head + tail);
            doc.caret = { ...range.start };
            return true;
        };
        // Each application returns whether the document (not just the caret)
        // changed. Body text and contract fields share the one intent channel.
        const apply = (edit) => {
            const doc = active();
            // A caret motion without `extend` collapses any selection; with it,
            // the anchor plants where the caret stood when the selection began.
            if (edit.kind === "caret-move" || edit.kind === "caret-set") {
                if (edit.extend)
                    doc.anchor ??= { ...doc.caret };
                else
                    doc.anchor = null;
            }
            switch (edit.kind) {
                case "insert": {
                    deleteSelection(doc);
                    const current = doc.lines[doc.caret.line];
                    const before = current.slice(0, doc.caret.column);
                    const after = current.slice(doc.caret.column);
                    const inserted = (before + edit.text + after).split("\n");
                    const lastInserted = inserted[inserted.length - 1];
                    doc.lines.splice(doc.caret.line, 1, ...inserted);
                    doc.caret = {
                        line: doc.caret.line + inserted.length - 1,
                        column: lastInserted.length - after.length,
                    };
                    return true;
                }
                case "backspace": {
                    if (deleteSelection(doc))
                        return true;
                    const current = doc.lines[doc.caret.line];
                    if (doc.caret.column > 0) {
                        doc.lines[doc.caret.line] =
                            current.slice(0, doc.caret.column - 1) + current.slice(doc.caret.column);
                        doc.caret = { ...doc.caret, column: doc.caret.column - 1 };
                        return true;
                    }
                    if (doc.caret.line === 0)
                        return false;
                    const previous = doc.lines[doc.caret.line - 1];
                    doc.lines.splice(doc.caret.line - 1, 2, previous + current);
                    doc.caret = { line: doc.caret.line - 1, column: previous.length };
                    return true;
                }
                case "delete": {
                    if (deleteSelection(doc))
                        return true;
                    const current = doc.lines[doc.caret.line];
                    if (doc.caret.column < current.length) {
                        doc.lines[doc.caret.line] =
                            current.slice(0, doc.caret.column) + current.slice(doc.caret.column + 1);
                        return true;
                    }
                    if (doc.caret.line === doc.lines.length - 1)
                        return false;
                    doc.lines.splice(doc.caret.line, 2, current + doc.lines[doc.caret.line + 1]);
                    return true;
                }
                case "caret-move": {
                    const current = doc.lines[doc.caret.line];
                    switch (edit.direction) {
                        case "left":
                            doc.caret =
                                doc.caret.column > 0
                                    ? { ...doc.caret, column: doc.caret.column - 1 }
                                    : doc.caret.line > 0
                                        ? {
                                            line: doc.caret.line - 1,
                                            column: doc.lines[doc.caret.line - 1].length,
                                        }
                                        : doc.caret;
                            break;
                        case "right":
                            doc.caret =
                                doc.caret.column < current.length
                                    ? { ...doc.caret, column: doc.caret.column + 1 }
                                    : doc.caret.line < doc.lines.length - 1
                                        ? { line: doc.caret.line + 1, column: 0 }
                                        : doc.caret;
                            break;
                        case "up":
                            doc.caret = clampedCaret(doc, doc.caret.line - 1, doc.caret.column);
                            break;
                        case "down":
                            doc.caret = clampedCaret(doc, doc.caret.line + 1, doc.caret.column);
                            break;
                        case "line-start":
                            doc.caret = { ...doc.caret, column: 0 };
                            break;
                        case "line-end":
                            doc.caret = { ...doc.caret, column: current.length };
                            break;
                    }
                    return false;
                }
                case "caret-set": {
                    doc.caret = clampedCaret(doc, edit.line, edit.column);
                    return false;
                }
                case "select-all": {
                    doc.anchor = { line: 0, column: 0 };
                    doc.caret = {
                        line: doc.lines.length - 1,
                        column: doc.lines[doc.lines.length - 1].length,
                    };
                    return false;
                }
                case "replace-range": {
                    const from = clampedCaret(doc, edit.from.line, edit.from.column);
                    const to = clampedCaret(doc, edit.to.line, edit.to.column);
                    const [start, end] = beforeOrEqual(from, to) ? [from, to] : [to, from];
                    doc.anchor = null;
                    if (edit.text.length === 0 && start.line === end.line && start.column === end.column) {
                        return false;
                    }
                    const head = doc.lines[start.line].slice(0, start.column);
                    const tail = doc.lines[end.line].slice(end.column);
                    const inserted = (head + edit.text + tail).split("\n");
                    const lastInserted = inserted[inserted.length - 1];
                    doc.lines.splice(start.line, end.line - start.line + 1, ...inserted);
                    doc.caret = {
                        line: start.line + inserted.length - 1,
                        column: lastInserted.length - tail.length,
                    };
                    return true;
                }
                case "replace-match": {
                    // Content-anchored surgery: the anchor is the text itself, so a
                    // batch of these needs no re-fetch and no bottom-up ordering.
                    // Defensive on top of the schema (the firewall flags but still
                    // delivers): an empty find or an identical replacement is a no-op.
                    if (edit.find.length === 0 || edit.find === edit.text)
                        return false;
                    const joined = doc.lines.join("\n");
                    const wanted = Math.max(1, Math.floor(edit.occurrence ?? 1));
                    let at = -1;
                    let searchFrom = 0;
                    for (let seen = 0; seen < wanted; seen += 1) {
                        at = joined.indexOf(edit.find, searchFrom);
                        if (at === -1)
                            return false;
                        searchFrom = at + edit.find.length;
                    }
                    doc.anchor = null;
                    const next = joined.slice(0, at) + edit.text + joined.slice(at + edit.find.length);
                    doc.lines = next.split("\n");
                    const head = next.slice(0, at + edit.text.length).split("\n");
                    doc.caret = {
                        line: head.length - 1,
                        column: head[head.length - 1].length,
                    };
                    return true;
                }
                case "meta-set": {
                    if (edit.field === "description") {
                        const value = edit.value.slice(0, DESCRIPTION_LIMIT);
                        if (doc.meta.description === value)
                            return false;
                        doc.meta.description = value;
                        return true;
                    }
                    // Renaming the type renames the document — the id IS the type.
                    // An empty or colliding name is a no-op, never an error state.
                    const next = kebab(edit.value);
                    if (next.length === 0 || next === doc.meta.type)
                        return false;
                    if (docs.has(next))
                        return false;
                    docs.delete(doc.meta.type);
                    doc.meta.type = next;
                    docs.set(next, doc);
                    activeId = next;
                    return true;
                }
                case "tag-add": {
                    const list = doc.meta[edit.side];
                    if (list.includes(edit.tag))
                        return false;
                    list.push(edit.tag);
                    return true;
                }
                case "tag-remove": {
                    const list = doc.meta[edit.side];
                    const index = list.indexOf(edit.tag);
                    if (index === -1)
                        return false;
                    list.splice(index, 1);
                    return true;
                }
                case "tags-set": {
                    // A whole side written as data: deduped, order kept, empty tags
                    // dropped. Unchanged content is a no-op — no marker, no remount.
                    const next = [];
                    for (const tag of edit.tags) {
                        const trimmed = tag.trim();
                        if (trimmed.length > 0 && !next.includes(trimmed))
                            next.push(trimmed);
                    }
                    const list = doc.meta[edit.side];
                    if (list.length === next.length && list.every((tag, at) => tag === next[at]))
                        return false;
                    list.splice(0, list.length, ...next);
                    return true;
                }
            }
        };
        // Intents wait for the tick (the clock owns time); within a frame the
        // higher priority applies first, so a machine author's insertion lands
        // after — never inside — the human's keystrokes.
        let pending = [];
        context.subscribe("EditRequested", (fact) => {
            pending.push({ edit: fact.payload.edit, priority: fact.payload.priority });
        });
        // Apply the frame's intents to the active document. A successor that
        // has not yet received its predecessor's hand-off holds them: the
        // predecessor is already gone from the frame that would apply them, so
        // they wait for the hand-off and apply the moment it closes (below).
        const applyPending = () => {
            if (pending.length === 0)
                return;
            if (!seeded && predecessorSeen && !predecessorGone)
                return;
            seed();
            // No document is open: there is nothing to apply the frame's intents
            // to (typing into an empty workspace), so they drop — ADD or a card
            // click opens one first.
            if (activeId === null) {
                pending = [];
                return;
            }
            const target = activeId;
            const batch = [...pending].sort((a, b) => b.priority - a.priority);
            pending = [];
            let changed = false;
            // The lock bar: an intent below the active document's lock — or a
            // rename INTO a locked name, which would hand that type to the
            // foundry — is refused, one verdict per frame, and the rest apply.
            let refused = null;
            for (const { edit, priority } of batch) {
                const renamed = edit.kind === "meta-set" && edit.field === "type" ? kebab(edit.value) : null;
                const bar = Math.max(lockOf(target), renamed === null ? 0 : lockOf(renamed));
                if (priority < bar) {
                    if (refused === null || priority < refused.priority)
                        refused = { priority, bar };
                    continue;
                }
                changed = apply(edit) || changed;
            }
            if (refused !== null)
                refuse("EditRequested", target, "locked", refused.priority, refused.bar);
            if (changed) {
                revision += 1;
                record();
                context.emit("BufferChanged", docPayload());
            }
            else {
                record();
                const doc = active();
                context.emit("CaretMoved", {
                    fileId: target,
                    caret: { ...doc.caret },
                    anchor: doc.anchor === null ? null : { ...doc.anchor },
                    revision,
                });
            }
        };
        context.subscribe("FrameTicked", applyPending);
        // The predecessor's SliceUnmounted closes the hand-off: it was enqueued
        // after the predecessor's re-publication (the buffer subscribes before
        // the foundry that retires it), so every document has arrived — held
        // intents apply now, to the inherited workspace.
        context.subscribe("SliceUnmounted", (fact) => {
            if (typeOf(fact.payload.sliceId) !== context.sliceType)
                return;
            if (fact.payload.sliceId === context.instanceId)
                return;
            predecessorGone = true;
            // The hand-off is closed: whatever arrived is the workspace, and an
            // empty one is a workspace too.
            seeded = true;
            applyPending();
        });
        // Every navigation, creation, and deletion lands here: re-point the
        // active document and publish the whole new view. A switch is a
        // BufferChanged — an undo marker — so Back steps back through it, and
        // the snapshot carries the pointer too.
        const openDoc = (docId) => {
            activeId = docId;
            pending = [];
            revision += 1;
            record();
            context.emit("BufferChanged", docPayload());
        };
        // A card click. The document is the one the slice was saved from, the
        // doc that names its type, or — for a compiled slice with no source in
        // the pool — a structured stub from its cached SliceMounted contract.
        context.subscribe("SliceSelected", (fact) => {
            seed();
            const type = typeOf(fact.payload.sliceId);
            let docId = resolveDocId(type);
            if (docId === null) {
                const contract = contracts.get(type);
                if (contract === undefined)
                    return;
                docs.set(type, stubDoc(type, contract));
                docId = type;
            }
            if (docId === activeId)
                return;
            openDoc(docId);
        });
        // A fresh slice: the buffer names it (slice-N, the only law) and seeds
        // a mountable skeleton.
        context.subscribe("SliceCreateRequested", () => {
            seed();
            let n = 1;
            while (docs.has(`slice-${n}`))
                n += 1;
            const id = `slice-${n}`;
            docs.set(id, skeletonDoc(id));
            openDoc(id);
        });
        // A copy under a fresh type: same contract, same body, renamed — so
        // saving the copy mounts a sibling instead of replacing the original.
        context.subscribe("SliceDuplicateRequested", (fact) => {
            seed();
            const type = typeOf(fact.payload.sliceId);
            const priority = fact.payload.priority ?? 0;
            if (priority < lockOf(type)) {
                refuse("SliceDuplicateRequested", type, "locked", priority, lockOf(type));
                return;
            }
            const sourceId = resolveDocId(type);
            const contract = contracts.get(type);
            const sourceDoc = sourceId !== null ? docs.get(sourceId) : undefined;
            const source = sourceDoc !== undefined
                ? cloneDoc(sourceDoc)
                : contract !== undefined
                    ? stubDoc(type, contract)
                    : null;
            if (source === null)
                return;
            let copyId = `${type}-copy`;
            for (let n = 2; docs.has(copyId); n += 1)
                copyId = `${type}-copy-${n}`;
            source.meta.type = copyId;
            docs.set(copyId, source);
            openDoc(copyId);
        });
        // Deleting removes the slice's document (the foundry unmounts the
        // instance); the active view re-points to the first survivor, and the
        // last document is immortal.
        context.subscribe("SliceDeleteRequested", (fact) => {
            const type = typeOf(fact.payload.sliceId);
            const priority = fact.payload.priority ?? 0;
            if (priority < lockOf(type)) {
                refuse("SliceDeleteRequested", type, "locked", priority, lockOf(type));
                return;
            }
            const docId = resolveDocId(type);
            if (docId === null)
                return;
            if (docs.size <= 1) {
                refuse("SliceDeleteRequested", docId, "immortal", priority);
                return;
            }
            docs.delete(docId);
            savedDocs.delete(type);
            const survivor = activeId === docId || activeId === null ? [...docs.keys()][0] : activeId;
            openDoc(survivor);
        });
        // The foundry names the document each saved type came from; a later
        // SliceSelected for that slice opens the real source, not a stub.
        context.subscribe("SliceSaved", (fact) => {
            savedDocs.set(fact.payload.sliceType, fact.payload.fileId);
        });
        // Time travel: restore the whole recorded workspace — contracts, code,
        // carets, and which document was open — as a fresh fact. Restores never
        // bump the revision and are never undo markers; typing afterwards
        // branches.
        context.subscribe("TimelineScrubbed", (fact) => {
            const restored = snapshots.seek(fact.payload.frameNumber);
            if (restored === undefined)
                return;
            docs.clear();
            for (const [id, doc] of restored.docs)
                docs.set(id, cloneDoc(doc));
            activeId = restored.activeId;
            pending = [];
            record();
            context.emit("BufferRestored", docPayload());
        });
        // Every mount teaches the buffer that slice's public contract (stub
        // fodder), and late joiners never ask (rule 9): a newly mounted slice
        // that consumes the document gets it re-published as BufferRestored,
        // which is never an undo marker. The frame guard collapses a burst of
        // mounts (including the startup batch, whose seed publication lands in
        // the same frame). A newcomer of this buffer's own type is a successor
        // — the foundry mounts it a frame before retiring this one — and it
        // gets the whole workspace, every document, the open one last.
        let lastPublishFrame = 0;
        let seeded = false;
        let predecessorSeen = false;
        let predecessorGone = false;
        context.subscribe("SliceMounted", (fact) => {
            contracts.set(fact.payload.sliceType, {
                description: fact.payload.description,
                consumes: fact.payload.consumes,
                emits: fact.payload.emits,
                startSource: fact.payload.startSource,
            });
            const ownType = fact.payload.sliceType === context.sliceType;
            if (ownType && fact.payload.sliceId !== context.instanceId)
                predecessorSeen = true;
            // The pool re-publishes living mounts to a newcomer before its own
            // mount fact, so by the time this buffer hears itself it knows whether
            // a predecessor lives: seed the skeleton only when none does — a
            // successor waits for the predecessor's hand-off instead.
            if (fact.payload.sliceId === context.instanceId) {
                if (!predecessorSeen)
                    seed();
                return;
            }
            if (!seeded)
                return;
            const consumes = fact.payload.consumes;
            const wantsDocument = consumes.includes("BufferChanged") ||
                consumes.includes("BufferRestored") ||
                consumes.includes("*");
            if (!wantsDocument)
                return;
            // An empty workspace has nothing to hand over or re-publish.
            if (activeId === null)
                return;
            if (ownType) {
                // The whole workspace, the open document last — so the successor's
                // active pointer, and every other consumer's, ends where this one's
                // is. Unguarded: a second copy of the open document in the same
                // frame is harmless, a wrong last word is not.
                for (const id of docs.keys()) {
                    if (id === activeId)
                        continue;
                    context.emit("BufferRestored", docPayload(id));
                }
                lastPublishFrame = context.frameNumber + 1;
                context.emit("BufferRestored", docPayload());
                return;
            }
            if (lastPublishFrame >= context.frameNumber + 1)
                return;
            lastPublishFrame = context.frameNumber + 1;
            context.emit("BufferRestored", docPayload());
        });
        // A predecessor's hand-off, heard as a late joiner: its documents become
        // this buffer's, its open one stays open, and its revision counter
        // carries on — the undo grain does not restart at a hot reload. Nothing
        // is re-published: every consumer heard the same facts.
        context.subscribe("BufferRestored", (fact) => {
            if (fact.sourceSlice === context.instanceId)
                return;
            const { fileId, meta, lines, caret, anchor } = fact.payload;
            docs.set(fileId, {
                meta: {
                    type: meta.type,
                    description: meta.description,
                    consumes: [...meta.consumes],
                    emits: [...meta.emits],
                },
                lines: [...lines],
                caret: { ...caret },
                anchor: anchor === null ? null : { ...anchor },
            });
            activeId = fileId;
            revision = Math.max(revision, fact.payload.revision);
            seeded = true;
            record();
        });
        // Booting plants nothing: the workspace starts empty and the first
        // document is the first undo marker. "Seeded" only says this buffer is
        // the one that answers now — a successor that was promised a hand-off
        // and never got one (its predecessor died holding nothing) takes over on
        // its first intent instead.
        function seed() {
            seeded = true;
        }
    },
});
