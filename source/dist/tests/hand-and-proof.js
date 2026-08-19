import { firewall, Pool } from "@slices/kit";
import { trackFrames } from "@slices/kit/testing";
import { agentHand } from "../slices/agent-hand.js";
import { agentPort } from "../slices/agent-port.js";
import { proofingHouse } from "../slices/proofing-house.js";
import { ruleBook } from "../slices/rule-book.js";
import { schemaBook } from "../slices/schema-book.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The machine author's two new doors, as executable assertions ---
// operate(): pressing an authored tool's buttons through the port alone —
// the agent-hand grows its runtime glove one word at a time, every growth a
// SliceMounted fact, registry words refused. proof(): assaying a candidate
// document without mounting it — compile, shape, and lint verdicts before
// any edit commits.
const pool = new Pool({
    onHandlerError: (error) => {
        throw error;
    },
});
const timeline = trackFrames(pool);
pool.mount(firewall, { instanceId: "firewall#1" });
pool.mount(schemaBook, { instanceId: "schema-book#1" });
pool.mount(ruleBook, { instanceId: "rule-book#1" });
pool.mount(agentHand, { instanceId: "agent-hand#1" });
pool.mount(proofingHouse, { instanceId: "proofing-house#1" });
pool.mount(agentPort, { instanceId: "agent-port#1" });
// Boot: the law lands, the hand learns which words are the registry's.
timeline.advanceUntil("SchemasDeclared");
const api = globalThis.slicesAgent;
assert(api !== undefined, "The port must attach its API to the global host.");
// Sketched-vocabulary facts are outside the registry's type map, so the
// recorded frames are scanned by runtime string.
const spoken = (type) => timeline.frames.flatMap((record) => record.facts.filter((fact) => fact.type === type));
const gloveMounts = () => timeline.delivered("SliceMounted", (fact) => fact.payload.sliceType === "agent-glove");
// --- operate: a novel word mints the glove, and the glove speaks it ---
api.emit("OperateRequested", { type: "PingSounded", payload: { n: 1 } });
timeline.advance(4);
assert(spoken("PingSounded").length === 1, "The glove must speak a novel word once.");
assert(spoken("PingSounded")[0].sourceSlice.startsWith("agent-glove"), "The word must come from the glove, never the hand or the port.");
assert(gloveMounts().length === 1, "The first word mints exactly one glove.");
assert(gloveMounts()[0].payload.emits.includes("PingSounded"), "The glove's mounted contract must declare the word it speaks.");
timeline.expectNone("ContractViolated", "A sketched-then-spoken word must pass the firewall clean.");
// --- operate: a second novel word regrows the glove; the old one retires ---
api.emit("OperateRequested", { type: "PongSounded" });
timeline.advance(4);
assert(spoken("PongSounded").length === 1, "The regrown glove must speak the new word.");
assert(gloveMounts().length === 2, "A novel word regrows the glove once.");
const grown = gloveMounts()[1].payload;
assert(grown.emits.includes("PingSounded") && grown.emits.includes("PongSounded"), "The regrown contract must carry the whole operated vocabulary.");
assert(timeline.delivered("SliceUnmounted", (fact) => fact.payload.sliceId === gloveMounts()[0].payload.sliceId).length === 1, "The outgrown glove must retire.");
// --- operate: a known word is spoken by the live glove, no new mount ---
api.emit("OperateRequested", { type: "PingSounded", payload: { n: 2 } });
timeline.advance(4);
assert(spoken("PingSounded").length === 2, "A known word is spoken again.");
assert(gloveMounts().length === 2, "A known word never mints a glove.");
// --- operate: registry words are refused — their owners have doors ---
api.emit("OperateRequested", { type: "FrameTicked", payload: { frameNumber: 1 } });
timeline.advance(4);
timeline.expectNone("FrameTicked", "The hand must refuse the registry's own words.");
// --- proof: a sound candidate assays ok, its novel words named sketched ---
api.emit("ProofRequested", {
    proofId: "assay-1",
    meta: {
        type: "probe",
        description: "A candidate.",
        consumes: ["FrameTicked"],
        emits: ["PulseSounded"],
    },
    lines: ["let beats = 0;", 'context.subscribe("FrameTicked", () => {', "  beats += 1;", "});"],
});
const sound = timeline.advanceUntil("ProofReturned", {
    where: (fact) => fact.payload.proofId === "assay-1",
});
assert(sound.payload.ok, "A sound candidate must assay ok.");
assert(sound.payload.verdicts.length === 0, "A sound candidate carries no verdicts.");
assert(sound.payload.sketched.includes("PulseSounded") &&
    !sound.payload.sketched.includes("FrameTicked"), "The assay must name exactly the words the law lacks.");
// --- proof: a broken candidate earns compile and lint verdicts, mounts nothing ---
const mountsBefore = timeline.delivered("SliceMounted").length;
api.emit("ProofRequested", {
    proofId: "assay-2",
    meta: { type: "probe", description: "A broken candidate.", consumes: [], emits: [] },
    lines: ["const x = ;", 'const css = "position: fixed;";'],
});
const broken = timeline.advanceUntil("ProofReturned", {
    where: (fact) => fact.payload.proofId === "assay-2",
});
assert(!broken.payload.ok, "A broken candidate must not assay ok.");
assert(broken.payload.verdicts.some((verdict) => verdict.kind === "compile"), "A syntax error must come back as a compile verdict.");
assert(broken.payload.verdicts.some((verdict) => verdict.kind === "lint" && verdict.line === 1), "A rule-book hit must come back as a lint verdict naming its line.");
assert(timeline.delivered("SliceMounted").length === mountsBefore, "The assay must mount nothing, sound or broken.");
console.log("hand and proof: the machine author presses and assays through the door.");
