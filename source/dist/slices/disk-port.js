import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The disk as a resource. The journal in localStorage is the workspace's
// truth — and it dies with the cache. This slice owns a directory the human
// picked (the File System Access API's own prompt; the handle remembered
// in IndexedDB, re-granted with a click each session), the way the fact-log
// owns localStorage and clipboard owns the OS clipboard, and mirrors the
// board onto it: `journal.json` is the fact-log's journal exactly as it
// publishes it (JournalDeclared at boot, JournalAppended per input — one
// owner, one format), and `slices/<id>.ts` is every document as source (the
// same defineSlice wrapper the foundry assembles, importable, lint-able,
// git-able). Nothing is read into the page by itself: when the disk's
// journal is not this page's — another browser, a cleared cache, a RESET —
// the mirror pauses and the DISK block offers RESTORE (the fact-log takes
// the disk's journal as its store and reboots) or OVERWRITE (the page's
// journal goes over the disk's). A journal that is only ahead of the disk
// simply catches it up, and one this boot trimmed (REWIND) is written over
// the longer disk copy without asking. Every state change is a fact
// (WorkspaceDiskDeclared, rule 9). Nothing here is journaled: the disk is
// a mirror of the journal, never workspace state. The body is
// self-contained, so the slice is adoptable — and locked, since it is a way
// back.
export const diskPort = defineSlice({
    type: "disk-port",
    description: "Owns a picked directory: mirrors the journal and documents, offers RESTORE.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "JournalDeclared",
        "JournalAppended",
        "WorkspaceDiskRequested",
        "WorkspaceRestoreRequested",
        "BufferChanged",
        "BufferRestored",
        "SliceMounted",
    ],
    emits: ["WorkspaceDiskDeclared", "WorkspaceBackupRead"],
    start(context) {
        const DB_NAME = "slice-ide-disk";
        const DB_STORE = "handles";
        const DB_KEY = "root";
        const JOURNAL_FILE = "journal.json";
        const SLICES_DIR = "slices";
        const WRITE_DEBOUNCE_MS = 400;
        const picker = globalThis
            .showDirectoryPicker;
        const idb = globalThis.indexedDB;
        const supported = typeof picker === "function" && idb !== undefined;
        // The remembered handle: IndexedDB keeps a directory handle across
        // reloads (permission is asked again per session — that is the click).
        const withStore = (mode, run) => new Promise((resolve, reject) => {
            if (idb === undefined) {
                reject(new Error("no IndexedDB"));
                return;
            }
            const opening = idb.open(DB_NAME, 1);
            opening.onupgradeneeded = () => opening.result.createObjectStore(DB_STORE);
            opening.onerror = () => reject(opening.error);
            opening.onsuccess = () => {
                const db = opening.result;
                const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
                request.onsuccess = () => {
                    resolve(request.result);
                    db.close();
                };
                request.onerror = () => {
                    reject(request.error);
                    db.close();
                };
            };
        });
        const rememberHandle = (handle) => withStore("readwrite", (store) => store.put(handle, DB_KEY));
        const forgetHandle = () => withStore("readwrite", (store) => store.delete(DB_KEY));
        const recallHandle = () => withStore("readonly", (store) => store.get(DB_KEY));
        // --- State ---
        let state = supported ? "none" : "unsupported";
        let handle = null;
        let error;
        let diskCount;
        let diskSavedAt;
        // The journal as the fact-log publishes it: version, entries, this
        // boot's trim. Unknown until JournalDeclared lands.
        let journal = null;
        // The documents, for the source mirror: id -> meta + lines.
        const documents = new Map();
        const mirrored = new Set();
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("WorkspaceDiskDeclared", {
                state,
                ...(handle === null ? {} : { name: handle.name }),
                local: journal?.entries.length ?? 0,
                ...(diskCount === undefined ? {} : { disk: diskCount }),
                ...(diskSavedAt === undefined ? {} : { savedAt: diskSavedAt }),
                ...(error === undefined ? {} : { error }),
            });
        };
        const fail = (what, cause) => {
            state = "error";
            error = `${what} | ${cause instanceof Error ? cause.message : String(cause)}`;
            declare();
        };
        // --- The files ---
        const writeText = async (dir, name, text) => {
            const file = await dir.getFileHandle(name, { create: true });
            const stream = await file.createWritable();
            await stream.write(text);
            await stream.close();
        };
        const readJournalFile = async (dir) => {
            let text;
            try {
                const file = await dir.getFileHandle(JOURNAL_FILE);
                text = await (await file.getFile()).text();
            }
            catch {
                return null;
            }
            try {
                const parsed = JSON.parse(text);
                if (typeof parsed !== "object" || parsed === null)
                    return null;
                const record = parsed;
                if (typeof record.v !== "string" || !Array.isArray(record.entries))
                    return null;
                return {
                    v: record.v,
                    entries: record.entries,
                    ...(typeof record.savedAt === "string" ? { savedAt: record.savedAt } : {}),
                };
            }
            catch {
                return null;
            }
        };
        // Writes are serialized and debounced: the journal file is rewritten
        // whole (a copy per write is the API's cost; the debounce keeps a
        // typing burst to one), each document file likewise.
        let chain = Promise.resolve();
        const enqueue = (work) => {
            chain = chain.then(work).catch((cause) => fail("disk write", cause));
        };
        let journalTimer = null;
        const writeJournalNow = () => {
            if (handle === null || journal === null)
                return;
            const dir = handle;
            const text = JSON.stringify({ v: journal.version, savedAt: new Date().toISOString(), entries: journal.entries });
            const count = journal.entries.length;
            enqueue(async () => {
                await writeText(dir, JOURNAL_FILE, text);
                diskCount = count;
                diskSavedAt = new Date().toISOString();
            });
        };
        const scheduleJournal = () => {
            if (state !== "synced")
                return;
            if (journalTimer !== null)
                clearTimeout(journalTimer);
            journalTimer = setTimeout(() => {
                journalTimer = null;
                writeJournalNow();
            }, WRITE_DEBOUNCE_MS);
        };
        // A document as source: the foundry's wrapper (rule-6 twin) under the
        // import law's two lines, so the file drops into any app's slices/.
        const camel = (id) => id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/[^A-Za-z0-9_$]/g, "");
        const sourceOf = (id, meta, lines) => [
            'import { sliceDefinerFor } from "@slices/kit/define";',
            'import type { EventPayloads } from "../contracts/events.js";',
            "",
            "const defineSlice = sliceDefinerFor<EventPayloads>();",
            "",
            `// Mirrored from the Slice-IDE workspace (document ${id}) by disk-port.`,
            `export const ${camel(id) || "slice"} = defineSlice({`,
            `  type: ${JSON.stringify(meta.type)},`,
            `  description: ${JSON.stringify(meta.description)},`,
            `  consumes: ${JSON.stringify(meta.consumes)} as const,`,
            `  emits: ${JSON.stringify(meta.emits)} as const,`,
            "  start(context) {",
            ...lines.map((line) => (line === "" ? "" : `    ${line}`)),
            "  },",
            "});",
            "",
        ].join("\n");
        const docTimers = new Map();
        const writeDocumentNow = (id) => {
            if (handle === null)
                return;
            const dir = handle;
            const doc = documents.get(id);
            if (doc === undefined)
                return;
            const text = sourceOf(id, doc.meta, doc.lines);
            enqueue(async () => {
                const slices = await dir.getDirectoryHandle(SLICES_DIR, { create: true });
                await writeText(slices, `${id}.ts`, text);
                mirrored.add(id);
            });
        };
        const scheduleDocument = (id) => {
            if (state !== "synced")
                return;
            const pending = docTimers.get(id);
            if (pending !== undefined)
                clearTimeout(pending);
            docTimers.set(id, setTimeout(() => {
                docTimers.delete(id);
                writeDocumentNow(id);
            }, WRITE_DEBOUNCE_MS));
        };
        const removeDocumentFile = (id) => {
            if (handle === null || state !== "synced" || !mirrored.has(id))
                return;
            const dir = handle;
            enqueue(async () => {
                const slices = await dir.getDirectoryHandle(SLICES_DIR, { create: true });
                await slices.removeEntry(`${id}.ts`).catch(() => undefined);
                mirrored.delete(id);
            });
        };
        const mirrorEverything = () => {
            writeJournalNow();
            for (const id of documents.keys())
                writeDocumentNow(id);
        };
        // --- Reconciling disk and page ---
        // Same entries: in sync. Disk a prefix of the page's: the page is ahead,
        // catch the disk up. Page a prefix of the disk's, and this boot trimmed:
        // a REWIND the disk had not heard of, write it. Anything else the disk
        // holds is another lineage — RESTORE or OVERWRITE is the human's call.
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        const prefixOf = (shorter, longer) => shorter.length <= longer.length && shorter.every((entry, i) => same(entry, longer[i]));
        const reconcile = async () => {
            if (handle === null || journal === null)
                return;
            const disk = await readJournalFile(handle);
            diskCount = disk?.entries.length;
            diskSavedAt = disk?.savedAt;
            error = undefined;
            const local = journal.entries;
            if (disk === null || disk.entries.length === 0) {
                state = "synced";
                if (local.length > 0 || documents.size > 0)
                    mirrorEverything();
            }
            else if (disk.v !== journal.version) {
                state = "backup";
                error = `disk journal is v${disk.v}, this build is v${journal.version} | overwrite, or restore in the build that wrote it`;
            }
            else if (prefixOf(disk.entries, local)) {
                state = "synced";
                if (disk.entries.length !== local.length || documents.size > 0)
                    mirrorEverything();
            }
            else if (prefixOf(local, disk.entries) && journal.trimmed > 0 && disk.entries.length - local.length <= journal.trimmed) {
                state = "synced";
                mirrorEverything();
            }
            else {
                state = "backup";
            }
            declare();
        };
        const open = async (dir) => {
            handle = dir;
            const permission = await dir.queryPermission({ mode: "readwrite" });
            if (permission === "granted") {
                await reconcile();
                return;
            }
            state = "prompt";
            declare();
        };
        // Boot: recall the remembered directory, if any. Its permission is
        // usually `prompt` here — the click comes from the DISK block.
        if (supported) {
            recallHandle()
                .then((remembered) => {
                if (remembered !== undefined)
                    return open(remembered);
                state = "none";
                declare();
                return undefined;
            })
                .catch((cause) => fail("recall directory", cause));
        }
        context.subscribe("JournalDeclared", (fact) => {
            journal = { version: fact.payload.version, entries: [...fact.payload.entries], trimmed: fact.payload.trimmed };
            if (handle !== null && state !== "prompt")
                void reconcile().catch((cause) => fail("read disk", cause));
        });
        context.subscribe("JournalAppended", (fact) => {
            if (journal === null)
                return;
            journal.entries[fact.payload.index] = fact.payload.entry;
            journal.entries.length = fact.payload.index + 1;
            scheduleJournal();
        });
        // The documents: every change is mirrored while synced; a document that
        // left the roster loses its file. Restores refresh the cache only — the
        // file follows the next edit, as the foundry's autosave does.
        const remember = (fact) => {
            documents.set(fact.payload.fileId, { meta: fact.payload.meta, lines: [...fact.payload.lines] });
            const roster = new Set(fact.payload.fileIds);
            for (const id of [...documents.keys()]) {
                if (!roster.has(id)) {
                    documents.delete(id);
                    removeDocumentFile(id);
                }
            }
        };
        context.subscribe("BufferChanged", (fact) => {
            remember(fact);
            scheduleDocument(fact.payload.fileId);
        });
        context.subscribe("BufferRestored", (fact) => remember(fact));
        context.subscribe("WorkspaceDiskRequested", (fact) => {
            if (!supported) {
                declare();
                return;
            }
            const action = fact.payload.action;
            if (action === "unlink") {
                handle = null;
                state = "none";
                error = undefined;
                diskCount = undefined;
                diskSavedAt = undefined;
                forgetHandle().then(declare).catch((cause) => fail("forget directory", cause));
                return;
            }
            if (action === "overwrite") {
                if (handle === null)
                    return;
                state = "synced";
                error = undefined;
                mirrorEverything();
                declare();
                return;
            }
            // link: re-grant the remembered directory, or pick one. The picker
            // and the permission prompt need the human's activation — the click
            // that emitted this fact, one frame ago, still counts.
            const grant = async () => {
                if (handle !== null) {
                    const permission = await handle.requestPermission({ mode: "readwrite" });
                    if (permission === "granted") {
                        await reconcile();
                        return;
                    }
                    state = "prompt";
                    declare();
                    return;
                }
                const picked = await picker({ mode: "readwrite", id: "slice-ide" });
                await rememberHandle(picked);
                await open(picked);
            };
            grant().catch((cause) => {
                // The human closed the picker: nothing changed, nothing to report.
                if (cause instanceof Error && cause.name === "AbortError")
                    return;
                fail("link directory", cause);
            });
        });
        context.subscribe("WorkspaceRestoreRequested", () => {
            if (handle === null || state !== "backup" || error !== undefined)
                return;
            const dir = handle;
            readJournalFile(dir)
                .then((disk) => {
                if (disk === null)
                    return;
                context.emit("WorkspaceBackupRead", { version: disk.v, entries: disk.entries });
            })
                .catch((cause) => fail("read disk", cause));
        });
        // Rule 9: a late joiner that listens gets the state as it stands.
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("WorkspaceDiskDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
        // Leaving: whatever is debounced goes now (best effort — the page may
        // not wait; the next boot catches the disk up from the journal anyway).
        const onLeave = () => {
            if (journalTimer !== null) {
                clearTimeout(journalTimer);
                journalTimer = null;
                writeJournalNow();
            }
            for (const [id, timer] of docTimers) {
                clearTimeout(timer);
                writeDocumentNow(id);
            }
            docTimers.clear();
        };
        const hasWindow = typeof window !== "undefined";
        if (hasWindow)
            window.addEventListener("pagehide", onLeave);
        return () => {
            if (hasWindow)
                window.removeEventListener("pagehide", onLeave);
            if (journalTimer !== null)
                clearTimeout(journalTimer);
            for (const timer of docTimers.values())
                clearTimeout(timer);
        };
    },
});
