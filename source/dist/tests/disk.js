import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
const makeDir = (name) => ({ name, files: new Map(), dirs: new Map(), permission: "granted" });
const handleOf = (dir) => ({
    name: dir.name,
    async getFileHandle(name, options) {
        let file = dir.files.get(name);
        if (file === undefined) {
            if (!options?.create)
                throw Object.assign(new Error("not found"), { name: "NotFoundError" });
            file = { text: "", lastModified: 0 };
            dir.files.set(name, file);
        }
        const record = file;
        return {
            async getFile() {
                return { text: async () => record.text, lastModified: record.lastModified };
            },
            async createWritable() {
                let buffer = "";
                return {
                    async write(data) {
                        buffer += data;
                    },
                    async close() {
                        record.text = buffer;
                        record.lastModified += 1;
                    },
                };
            },
        };
    },
    async getDirectoryHandle(name, options) {
        let sub = dir.dirs.get(name);
        if (sub === undefined) {
            if (!options?.create)
                throw Object.assign(new Error("not found"), { name: "NotFoundError" });
            sub = makeDir(name);
            dir.dirs.set(name, sub);
        }
        return handleOf(sub);
    },
    async removeEntry(name) {
        dir.files.delete(name);
        dir.dirs.delete(name);
    },
    async queryPermission() {
        return dir.permission;
    },
    async requestPermission() {
        dir.permission = "granted";
        return "granted";
    },
});
let pickable = null;
globalThis.showDirectoryPicker = async () => {
    if (pickable === null)
        throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    return handleOf(pickable);
};
// IndexedDB, just enough: one database, one store, callbacks on a microtask.
const idbRecords = new Map();
const request = (run) => {
    const req = { result: undefined, error: null, onsuccess: null, onerror: null };
    queueMicrotask(() => {
        try {
            req.result = run();
            req.onsuccess?.();
        }
        catch (error) {
            req.error = error;
            req.onerror?.();
        }
    });
    return req;
};
const fakeIdb = {
    open() {
        const store = {
            get: (key) => request(() => idbRecords.get(key)),
            put: (value, key) => request(() => (idbRecords.set(key, value), key)),
            delete: (key) => request(() => void idbRecords.delete(key)),
        };
        const db = { createObjectStore: () => undefined, transaction: () => ({ objectStore: () => store }), close: () => undefined };
        const opening = request(() => db);
        return opening;
    },
};
globalThis.indexedDB = fakeIdb;
const STORAGE_KEY = "slice-ide|fact-log";
const localStore = new Map();
const fakeStorage = {
    getItem: (key) => localStore.get(key) ?? null,
    setItem: (key, value) => void localStore.set(key, value),
    removeItem: (key) => void localStore.delete(key),
};
globalThis.window = { localStorage: fakeStorage, addEventListener: () => undefined, removeEventListener: () => undefined };
const { factLog } = await import("../slices/fact-log.js");
const { diskPort } = await import("../slices/disk-port.js");
const { schemaBook } = await import("../slices/schema-book.js");
const { editorBuffer } = await import("../slices/editor-buffer.js");
const { clock } = await import("../slices/clock.js");
const defineSlice = sliceDefinerFor();
const speaker = (type, payload) => defineSlice({ type: `test-${type.toLowerCase()}`, consumes: [], emits: [type], start(context) { context.emit(type, payload); } });
const settle = async (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
// A session: pool, timeline, the state owners, the disk-port. Returns the
// pool and a `say` that mounts a one-shot speaker, advances, unmounts.
let serial = 0;
const boot = () => {
    const pool = new Pool({ onHandlerError: (error) => { throw error; } });
    const timeline = trackFrames(pool);
    pool.mount(firewall, { instanceId: `firewall#${++serial}` });
    pool.mount(schemaBook, { instanceId: `schema-book#${++serial}` });
    pool.mount(clock, { instanceId: `clock#${++serial}` });
    pool.mount(editorBuffer, { instanceId: `editor-buffer#${++serial}` });
    pool.mount(factLog, { instanceId: `fact-log#${++serial}` });
    pool.mount(diskPort, { instanceId: `disk-port#${++serial}` });
    const say = async (type, payload) => {
        const id = `speaker#${++serial}`;
        pool.mount(speaker(type, payload), { instanceId: id });
        timeline.advance(2);
        pool.unmount(id);
        timeline.advance(1);
        await settle();
        timeline.advance(2);
    };
    const disk = () => timeline.delivered("WorkspaceDiskDeclared").at(-1)?.payload;
    return { pool, timeline, say, disk };
};
// --- Session 1: an empty page links an empty directory, works, and the disk follows ---
const dirA = makeDir("workspace-a");
pickable = dirA;
const one = boot();
one.timeline.advance(3);
await settle();
one.timeline.advance(2);
assert(one.disk()?.state === "none", `Boot with nothing remembered declares none, got ${JSON.stringify(one.disk())}.`);
assert(one.timeline.delivered("JournalDeclared").length >= 1, "The fact-log publishes its journal at boot.");
await one.say("WorkspaceDiskRequested", { action: "link" });
await settle();
one.timeline.advance(2);
assert(one.disk()?.state === "synced" && one.disk()?.name === "workspace-a", `Linking an empty directory syncs, got ${JSON.stringify(one.disk())}.`);
assert(idbRecords.has("root"), "The handle is remembered in IndexedDB.");
// Work: ADD opens the first document, then a keystroke; both journal.
await one.say("SliceCreateRequested", {});
await one.say("EditRequested", { edit: { kind: "insert", text: "// on disk" }, priority: 10 });
assert(one.timeline.delivered("JournalAppended").length === 2, `Two inputs, two appends, got ${one.timeline.delivered("JournalAppended").length}.`);
await settle(600);
const journalA = JSON.parse(dirA.files.get("journal.json")?.text ?? "{}");
assert(journalA.v === "7" && journalA.entries?.length === 2, `The disk journal mirrors both inputs, got ${JSON.stringify(journalA)}.`);
const mirrored = dirA.dirs.get("slices")?.files.get("slice-1.ts")?.text ?? "";
assert(mirrored.includes('import { sliceDefinerFor } from "@slices/kit/define";') &&
    mirrored.includes('type: "slice-1"') &&
    mirrored.includes("// on disk"), `The document is mirrored as importable source, got:\n${mirrored}`);
const localAfterOne = localStore.get(STORAGE_KEY);
assert(localAfterOne !== undefined, "The journal is in the (fake) localStorage too.");
// --- Session 2: the cache is cleared; the remembered directory needs a click; RESTORE brings the journal back ---
localStore.clear();
const two = boot();
two.timeline.advance(3);
await settle();
two.timeline.advance(2);
// The remembered handle is recalled, but this fake grants without asking:
// with an empty page and a full disk, that is a backup to claim.
assert(two.disk()?.state === "backup" && two.disk()?.disk === 2 && two.disk()?.local === 0, `A cleared page against a full disk offers RESTORE, got ${JSON.stringify(two.disk())}.`);
await two.say("WorkspaceRestoreRequested", {});
await settle();
two.timeline.advance(2);
const read = two.timeline.delivered("WorkspaceBackupRead").at(-1);
assert(read !== undefined && read.payload.entries.length === 2, "RESTORE reads the disk's journal into a fact.");
const restored = JSON.parse(localStore.get(STORAGE_KEY) ?? "{}");
assert(restored.v === "7" && restored.entries?.length === 2, `The fact-log takes the disk's journal as its store (and would reboot), got ${JSON.stringify(restored)}.`);
// --- Session 3: the store holds the restored journal; the disk agrees; the page is synced without a click ---
const three = boot();
three.timeline.advance(4);
await settle();
three.timeline.advance(2);
assert(three.disk()?.state === "synced" && three.disk()?.local === 2, `Same journal on both sides is synced, got ${JSON.stringify(three.disk())}.`);
// A journal that is only ahead catches the disk up: one more keystroke.
await three.say("EditRequested", { edit: { kind: "insert", text: "!" }, priority: 10 });
await settle(600);
const journalB = JSON.parse(dirA.files.get("journal.json")?.text ?? "{}");
assert(journalB.entries?.length === 3, `The disk follows the page, got ${journalB.entries?.length}.`);
// --- Session 4: another lineage on disk (a foreign journal); OVERWRITE writes the page's over it ---
dirA.files.set("journal.json", { text: JSON.stringify({ v: "7", entries: [{ group: 0, type: "SliceCreateRequested", payload: {} }, { group: 1, type: "SliceSelected", payload: { sliceId: "x#1" } }, { group: 2, type: "SliceCreateRequested", payload: {} }, { group: 3, type: "SliceCreateRequested", payload: {} }] }), lastModified: 9 });
const four = boot();
four.timeline.advance(4);
await settle();
four.timeline.advance(2);
assert(four.disk()?.state === "backup", `A diverged disk journal is a backup, never overwritten silently, got ${JSON.stringify(four.disk())}.`);
await four.say("WorkspaceDiskRequested", { action: "overwrite" });
await settle(100);
four.timeline.advance(2);
const journalC = JSON.parse(dirA.files.get("journal.json")?.text ?? "{}");
assert(four.disk()?.state === "synced" && journalC.entries?.length === 3, `OVERWRITE puts the page's journal on the disk, got ${journalC.entries?.length}.`);
// --- Unlink forgets the handle; a fresh boot is back to none ---
await four.say("WorkspaceDiskRequested", { action: "unlink" });
await settle();
four.timeline.advance(2);
assert(four.disk()?.state === "none" && !idbRecords.has("root"), "UNLINK forgets the directory.");
console.log("disk: link, mirror (journal + slices/*.ts), restore after a cleared cache, catch up, refuse to clobber, overwrite, unlink.");
