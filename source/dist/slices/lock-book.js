import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The lock ledger as a document. "Nothing is exempt" is the law and stays
// the law: every document takes edits, the stage and the foundry included.
// But an edit is an intent, and intents carry a priority — the keyboard's
// 10, a machine author's 1 — so a document can carry a rank of its own,
// below which it refuses. That is a lock: not a kernel list, not a
// privilege, a number on the board (SliceLocksDeclared, rule 9) that any
// hand of rank may change (SliceLockRequested — the toolbar's LOCK|UNLOCK
// speaks at 10; the port stamps 1, so a harness cannot unlock what a human
// locked, exactly as it cannot outrank a keystroke). The buffer and the
// foundry consult the ledger and refuse with IntentRefused — a verdict the
// digest prints, never a shrug. This book keeps NO list of who is locked:
// a load-bearing slice (one whose breakage takes the human's way back with
// it — the stage, the buffer, the renderer, the keyboard, the clock, the
// foundry, the fact-log, the tray, the law, the harness's door) declares
// its own rank in its definition (`lock: 10`), the pool stamps it into the
// slice's SliceMounted fact beside its contract and code, and this book
// aggregates what it hears — every default lock is on the board as the
// slice's own opinion of itself, never external knowledge kept here. A
// human can unlock any of them with a press (a journaled intent, which
// outranks the seed from then on, reload after reload); a mind cannot, and
// its guide tells it to close blocked instead of working around a lock.
// Everything else — the minds, the desk, the rack, the oracles, the plates
// — declares nothing and stays open, so the party trick (the agent editing
// its own body while it runs) is untouched. The body is self-contained:
// this book is adoptable, and locked, so only a human can.
export const lockBook = defineSlice({
    type: "lock-book",
    description: "Owns the locks: which documents refuse intents below which priority.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["SliceLockRequested", "SliceLocksDeclared", "SliceMounted"],
    emits: ["SliceLocksDeclared", "IntentRefused"],
    start(context) {
        const locks = new Map();
        const typeOf = (sliceId) => sliceId.split("#")[0];
        // Types a hand of rank has spoken for (SliceLockRequested applied, lock
        // or clear): from then on a mount's self-declared rank no longer seeds
        // them — the human's word outranks the slice's opinion, and the pool's
        // re-publication of living mounts to newcomers must not re-lock what
        // was unlocked. Instances already heard are not re-seeded either.
        const decided = new Set();
        const heard = new Set();
        // Frame guard (rule 9), without dropping changes: a change landing in a
        // frame that already declared marks the ledger dirty, and this book's
        // own declaration — heard back one frame later, since it consumes its
        // own type — flushes it. A burst of self-declaring mounts is one
        // declaration and one complete echo, never a partial ledger left
        // standing.
        let declaredFrame = -1;
        let dirty = false;
        const declare = () => {
            declaredFrame = context.frameNumber;
            dirty = false;
            context.emit("SliceLocksDeclared", { locks: Object.fromEntries(locks) });
        };
        const changed = () => {
            if (declaredFrame === context.frameNumber)
                dirty = true;
            else
                declare();
        };
        // A request is judged by the same rule it sets: the current lock is the
        // bar, and an intent below it is refused (a machine at 1 cannot clear a
        // human's 10; it may lock an open document, and only a hand of rank
        // undoes that). Clearing is minPriority 0 or less.
        context.subscribe("SliceLockRequested", (fact) => {
            const type = typeOf(fact.payload.sliceId);
            const current = locks.get(type) ?? 0;
            const { priority, minPriority } = fact.payload;
            if (priority < current) {
                context.emit("IntentRefused", {
                    intent: "SliceLockRequested",
                    fileId: type,
                    reason: "locked",
                    priority,
                    minPriority: current,
                });
                return;
            }
            const next = Math.max(0, Math.floor(minPriority));
            decided.add(type);
            if (next === current)
                return;
            if (next === 0)
                locks.delete(type);
            else
                locks.set(type, next);
            changed();
        });
        // A successor (a hot reload of this book — a human's, since the book is
        // locked) seeds from the predecessor's ledger, heard as any late joiner
        // hears it; the predecessor ignores foreign declarations. The pool
        // re-publishes living mounts to a newcomer before its own mount fact,
        // so a predecessor is known before this instance hears itself.
        let predecessorSeen = false;
        let heardSelf = false;
        let inherited = false;
        context.subscribe("SliceLocksDeclared", (fact) => {
            if (fact.sourceSlice === context.instanceId) {
                // The echo: whatever changed after this frame's declaration goes
                // out now, complete.
                if (dirty)
                    declare();
                return;
            }
            if (!predecessorSeen || inherited)
                return;
            inherited = true;
            locks.clear();
            for (const [type, level] of Object.entries(fact.payload.locks))
                locks.set(type, level);
            changed();
        });
        // Rule 9: a late joiner that listens gets the ledger as it stands.
        declare();
        context.subscribe("SliceMounted", (fact) => {
            if (fact.payload.sliceType === context.sliceType) {
                if (fact.payload.sliceId === context.instanceId)
                    heardSelf = true;
                else if (!heardSelf)
                    predecessorSeen = true;
            }
            // The seed: a slice that declares its own rank in its definition
            // (`lock`, stamped into this fact by the pool) is locked to it — once
            // per instance, never over a hand's decision, never over a lock the
            // ledger already holds for the type (a lock outlives hot reloads; a
            // successor built from a document declares none and inherits by type).
            const type = fact.payload.sliceType;
            const rank = fact.payload.lock;
            let seeded = false;
            if (!heard.has(fact.payload.sliceId)) {
                heard.add(fact.payload.sliceId);
                if (rank !== undefined && rank > 0 && !decided.has(type) && !locks.has(type)) {
                    locks.set(type, Math.floor(rank));
                    seeded = true;
                }
            }
            if (seeded)
                changed();
            const consumes = fact.payload.consumes;
            const listens = consumes.includes("SliceLocksDeclared") || consumes.includes("*");
            if (!listens || seeded)
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
