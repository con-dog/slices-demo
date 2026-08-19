import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The thread: one sentence saying what you are doing right now, and what
// happened while you were doing it. The pool remembers everything and tells
// no one — a human coming back after twenty minutes and a model turn waking
// up cold have the same problem, and this slice is the same answer for both.
// It owns the pinned sentence (ThreadPinRequested is the intent — journaled,
// so a reload replays it), and derives a trail from facts already on the
// board: edits, opens, verdicts, what the mind said, trips back in time —
// coalesced into human steps ("edited line-counter x12"), never a fact dump.
// If the sentence names documents, those are the subject, and every edit
// that lands elsewhere counts as `away` — the rabbit-hole meter. Everything
// it knows travels as ThreadDeclared (rule 9: re-published for late joiners
// and on every change), so the plate, the port, and the mind read one fact.
// The body is self-contained, so the thread itself is adoptable.
export const thread = defineSlice({
    type: "thread",
    description: "Owns the thread: what you are doing now, and the trail since you pinned it.",
    consumes: [
        "ThreadPinRequested",
        "ThreadDeclared",
        "BufferChanged",
        "TimelineScrubbed",
        "SliceErrorChanged",
        "IntentRefused",
        "AgentTurnStarted",
        "AgentSaid",
        "SliceMounted",
    ],
    emits: ["ThreadDeclared"],
    start(context) {
        const TRAIL_LIMIT = 24;
        const NOTE_WIDTH = 96;
        let text = "";
        let since = -1;
        let away = 0;
        let trail = [];
        // The workspace as the buffer last described it: the roster and each
        // document's revision, so an edit, an open, a create, and a delete are
        // told apart from the same BufferChanged fact.
        let roster = [];
        const revisions = new Map();
        let activeFileId = null;
        const errored = new Set();
        const clip = (value) => {
            const line = value.replace(/\s+/g, " ").trim();
            return line.length > NOTE_WIDTH ? `${line.slice(0, NOTE_WIDTH - 1)}…` : line;
        };
        // The subject: every document id the sentence names, in roster order.
        // Recomputed at every declaration, so a thread pinned before its
        // document exists ("write a line-counter") adopts it once it is created.
        const subjectOf = () => {
            if (text === "")
                return [];
            const words = new Set(text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));
            return roster.filter((fileId) => words.has(fileId.toLowerCase()));
        };
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("ThreadDeclared", {
                text,
                since,
                subject: subjectOf(),
                trail: trail.map((step) => ({ ...step })),
                away,
            });
        };
        // A step joins the trail, or bumps the last one when it says the same
        // thing again — the grain a human reads, not the grain the pool logs.
        const step = (kind, note) => {
            if (text === "")
                return;
            const last = trail[trail.length - 1];
            if (last !== undefined && last.kind === kind && last.note === note) {
                last.times += 1;
                last.frame = context.frameNumber;
            }
            else {
                trail.push({ frame: context.frameNumber, kind, note, times: 1 });
                while (trail.length > TRAIL_LIMIT)
                    trail.shift();
            }
            declare();
        };
        context.subscribe("ThreadPinRequested", (fact) => {
            const next = fact.payload.text.replace(/\s+/g, " ").trim();
            if (next === text)
                return;
            if (next === "") {
                // DONE: the thread and its trail are let go together.
                text = "";
                since = -1;
                away = 0;
                trail = [];
                declare();
                return;
            }
            const repin = text !== "";
            text = next;
            if (!repin) {
                since = context.frameNumber;
                away = 0;
                trail = [];
            }
            // A re-pin keeps the trail — the thread evolved, it did not restart.
            step("pin", repin ? `now: ${clip(next)}` : clip(next));
        });
        // A successor (a hot reload of this slice) seeds from the predecessor's
        // declaration — the same fact any late joiner reads — so the thread
        // survives its own edit; the predecessor re-declares on the successor's
        // mount, since the successor consumes ThreadDeclared.
        context.subscribe("ThreadDeclared", (fact) => {
            if (fact.sourceSlice === context.instanceId)
                return;
            if (text !== "" || fact.payload.text === "")
                return;
            text = fact.payload.text;
            since = fact.payload.since;
            away = fact.payload.away;
            trail = fact.payload.trail.map((entry) => ({ ...entry }));
            declare();
        });
        context.subscribe("BufferChanged", (fact) => {
            const { fileId, revision, fileIds } = fact.payload;
            const before = new Set(roster);
            const after = [...fileIds];
            const known = revisions.get(fileId);
            const wasActive = activeFileId;
            roster = after;
            revisions.set(fileId, revision);
            activeFileId = fileId;
            for (const id of before)
                if (!fileIds.includes(id))
                    revisions.delete(id);
            // The roster's deltas first: what vanished, then what appeared.
            for (const id of before)
                if (!fileIds.includes(id))
                    step("delete", id);
            if (!before.has(fileId) && before.size > 0) {
                step("create", fileId);
                return;
            }
            if (known !== undefined && revision > known) {
                const subject = subjectOf();
                if (subject.length > 0 && !subject.includes(fileId))
                    away += 1;
                step("edit", fileId);
                return;
            }
            if (fileId !== wasActive && wasActive !== null)
                step("open", fileId);
        });
        context.subscribe("TimelineScrubbed", (fact) => {
            step("back", `went back to frame ${fact.payload.frameNumber}`);
        });
        context.subscribe("SliceErrorChanged", (fact) => {
            const { sliceId, message } = fact.payload;
            if (fact.payload.errored) {
                errored.add(sliceId);
                step("verdict", `${sliceId}: ${clip(message ?? "errored")}`);
            }
            else if (errored.delete(sliceId)) {
                step("fixed", `${sliceId} came good`);
            }
        });
        // A refusal is a step too: the mind bounced off a lock (or the last
        // document), and the human reading the trail should see where.
        context.subscribe("IntentRefused", (fact) => {
            const { intent, fileId, reason, priority, minPriority } = fact.payload;
            const why = reason === "locked"
                ? `locked${minPriority === undefined ? "" : ` >=${minPriority}`}${priority === undefined ? "" : `, got ${priority}`}`
                : "the last document is immortal";
            step("refused", `${intent} on ${fileId} (${why})`);
        });
        context.subscribe("AgentTurnStarted", (fact) => step("ask", clip(fact.payload.text)));
        context.subscribe("AgentSaid", (fact) => step("mind", clip(fact.payload.text)));
        // Rule 9: a late joiner that listens gets the thread as it stands.
        declare();
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("ThreadDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
