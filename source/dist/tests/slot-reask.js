import { Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
// The stage touches document/matchMedia at start; the shim gives it inert
// surfaces so the slot ledger can be exercised headless (the pool-smoke
// pattern from apps/life).
const stubNode = () => ({
    dataset: {},
    style: {},
    append: () => { },
    remove: () => { },
    textContent: "",
    attachShadow: () => ({ append: () => { } }),
    querySelector: () => stubNode(),
    getContext: () => new Proxy({}, { get: () => () => 0 }),
});
globalThis.document = {
    createElement: stubNode,
    head: { append: () => { } },
    body: { append: () => { } },
};
globalThis.matchMedia = () => ({
    matches: false,
    addEventListener: () => { },
    removeEventListener: () => { },
});
globalThis.window = globalThis;
const defineSlice = sliceDefinerFor();
const { stage } = await import("../slices/stage.js");
const { layoutBook } = await import("../slices/layout-book.js");
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// The view half of the slot protocol, the join block every view carries:
// while the declaration's `held` does not name this instance in its seat,
// ask — a first ask, a denial's next chance, and a new stage's fresh
// ledger are all the same one line.
const claimant = (slot, type = "test-claimant") => defineSlice({
    type,
    consumes: ["StageSlotsDeclared", "ViewSlotAssigned"],
    emits: ["ViewSlotRequested"],
    start(context) {
        context.subscribe("StageSlotsDeclared", (fact) => {
            if (fact.payload.held[slot] !== context.instanceId)
                context.emit("ViewSlotRequested", { slot });
        });
    },
});
const pool = new Pool({ onHandlerError: (error) => { throw error; } });
const timeline = trackFrames(pool);
pool.mount(stage, { instanceId: "stage#1" });
pool.mount(claimant("r2c2"), { instanceId: "claimant#1" });
pool.mount(claimant("r2c2"), { instanceId: "claimant#2" });
// First request wins; the second is refused, not forgotten.
const first = timeline.advanceUntil("ViewSlotAssigned");
assert(first.payload.sliceId === "claimant#1" && first.payload.slot === "r2c2", "The first claimant must win the contested seat.");
const denials = timeline.delivered("ViewSlotDenied");
assert(denials.some((fact) => fact.payload.sliceId === "claimant#2" && fact.payload.reason === "occupied"), "The second claimant must be denied with reason occupied.");
// Asking minted the shape: r2c2 made row 2 two cells wide, so the
// declaration lists both cells and each row's next rung.
const minted = timeline.delivered("StageSlotsDeclared").at(-1);
assert(minted !== undefined &&
    ["r1c1", "r1c2", "r2c1", "r2c2", "r2c3", "r3c1", "tray-1", "tray-2", "backdrop", "r2c2@br"].every((slot) => minted.payload.slots.includes(slot)), `Asking r2c2 must mint row 2 with two cells and list every rung, got ${JSON.stringify(minted?.payload.slots)}.`);
// The holder departs: the freed seat is declared, the refused claimant
// re-asks, and the vacancy is won without any new vocabulary.
pool.unmount("claimant#1");
const inherited = timeline.advanceUntil("ViewSlotAssigned", {
    where: (fact) => fact.payload.sliceId === "claimant#2",
});
assert(inherited.payload.slot === "r2c2", "The refused claimant must inherit the freed seat on the next declaration.");
assert(inherited.payload.geometry.includes("grid-column: 2 / 3"), `The inherited assignment must carry the seat's geometry, got ${inherited.payload.geometry}.`);
assert(JSON.stringify(inherited.payload.grid) === JSON.stringify({ row: 2, rowEnd: 3, column: 2, columnEnd: 3 }), `A grid seat's grant must carry the placement as data, got ${JSON.stringify(inherited.payload.grid)}.`);
// Occupancy is in the declaration: the one that announced the vacancy names
// no holder for the seat (and, the row's top cell emptied, no longer lists
// it — the shape retracted, r2c2 back to a rung), and a later one names
// the heir — a late joiner reads who sits where without replaying grants.
const declarations = timeline.delivered("StageSlotsDeclared");
assert(declarations.some((fact) => fact.frame > first.frame && fact.frame < inherited.frame && fact.payload.held["r2c2"] === undefined), "The vacancy's declaration must not name a holder for the freed seat.");
// The inherited seat holds: a later claimant is refused in its turn, and
// the sitting holder is never re-denied — a seated view stops asking.
pool.mount(claimant("r2c2"), { instanceId: "claimant#3" });
const refusedAgain = timeline.advanceUntil("ViewSlotDenied", {
    where: (fact) => fact.payload.sliceId === "claimant#3",
});
const seated = timeline.delivered("StageSlotsDeclared");
assert(seated[seated.length - 1].payload.held["r2c2"] === "claimant#2", `The next declaration must name the heir as the seat's holder, got ${JSON.stringify(seated[seated.length - 1].payload.held)}.`);
assert(timeline
    .delivered("ViewSlotDenied")
    .every((fact) => fact.payload.sliceId !== "claimant#2" || fact.frame < inherited.frame), "The seated claimant must not be denied again after inheriting.");
assert(refusedAgain.payload.reason === "occupied", "The late claimant is refused as occupied.");
// A request can outlive its requester: under replay's hot-reload churn an
// instance may unmount before the stage hears its request. Granting the
// corpse would wedge the seat forever (its SliceUnmounted has already
// passed), so the stage must drop the request — and the seat must remain
// winnable by the living. The hasty claimant asks in start; unmounting it
// in the same staging window makes its SliceUnmounted deliver BEFORE its
// request, the exact production ordering.
const hasty = defineSlice({
    type: "hasty-claimant",
    consumes: [],
    emits: ["ViewSlotRequested"],
    start(context) {
        context.emit("ViewSlotRequested", { slot: "r2c2@br" });
    },
});
pool.mount(hasty, { instanceId: "hasty#1" });
pool.unmount("hasty#1");
timeline.advance(4);
assert(timeline.delivered("ViewSlotRequested", (fact) => fact.sourceSlice === "hasty#1")
    .length === 1, "The corpse's request must still be delivered (the ordering under test).");
assert(timeline
    .delivered("ViewSlotAssigned")
    .every((fact) => fact.payload.sliceId !== "hasty#1"), "The stage must never grant a seat to an unmounted requester.");
assert(timeline
    .delivered("ViewSlotDenied")
    .every((fact) => fact.payload.sliceId !== "hasty#1"), "A corpse's request is dropped, not denied — nobody is listening.");
// The seat the corpse asked for is still winnable by the living — and an
// anchor is a HUD seat over its cell: a corner panel, pinned bottom-right.
pool.mount(claimant("r2c2@br"), { instanceId: "claimant#4" });
const unwedged = timeline.advanceUntil("ViewSlotAssigned", {
    where: (fact) => fact.payload.sliceId === "claimant#4",
});
assert(unwedged.payload.slot === "r2c2@br" &&
    unwedged.payload.geometry.includes("align-self: end") &&
    unwedged.payload.geometry.includes("justify-self: end"), `A living claimant must win the anchor a corpse once asked for, got ${unwedged.payload.geometry}.`);
// A band insets its cell: r2c2@top is a strip across the top of r2c2, and
// the cell's holder is re-seated with matching padding in the same reshape.
pool.mount(claimant("r2c2@top"), { instanceId: "claimant#5" });
timeline.advanceUntil("ViewSlotAssigned", { where: (fact) => fact.payload.sliceId === "claimant#5" });
const padded = timeline.delivered("ViewSlotAssigned", (fact) => fact.payload.sliceId === "claimant#2").at(-1);
assert(padded !== undefined && padded.payload.geometry.includes("padding-top: calc(2.6rem + 0.5rem)"), `A held @top band must inset the cell's occupant, got ${padded?.payload.geometry}.`);
// Malformed names are unknown seats; any well-formed coordinate mints.
pool.mount(claimant("stage-left"), { instanceId: "claimant#6" });
const unknown = timeline.advanceUntil("ViewSlotDenied", { where: (fact) => fact.payload.sliceId === "claimant#6" });
assert(unknown.payload.reason === "unknown-slot", "A name outside the grammar is denied as unknown-slot.");
pool.mount(claimant("r1c3"), { instanceId: "claimant#7" });
const thirds = timeline.advanceUntil("ViewSlotAssigned", { where: (fact) => fact.payload.sliceId === "claimant#7" });
// Row 1 is now three cells over row 2's two: a six-track grid, r1c3 on
// tracks 5-6, and r2c2 re-seated onto tracks 4-6.
assert(thirds.payload.geometry.includes("grid-column: 5 / 7"), `r1c3 in a three-cell row over a two-cell row spans tracks 5-6, got ${thirds.payload.geometry}.`);
const reseated = timeline.delivered("ViewSlotAssigned", (fact) => fact.payload.sliceId === "claimant#2").at(-1);
assert(reseated !== undefined && reseated.payload.geometry.includes("grid-column: 4 / 7"), `Every holder is re-seated on a mint: r2c2 over six tracks is 4 / 7, got ${reseated?.payload.geometry}.`);
pool.unmount("claimant#7");
timeline.advance(3);
const retracted = timeline.delivered("ViewSlotAssigned", (fact) => fact.payload.sliceId === "claimant#2").at(-1);
assert(retracted !== undefined && retracted.payload.geometry.includes("grid-column: 2 / 3"), `An empty top cell retracts its row and re-seats the rest, got ${retracted?.payload.geometry}.`);
// A screen is a coordinate too: s2r1c1 mints a second screen below the
// page — its own snap point, its rows on the grid after the page's — and
// the vocabulary offers the next screen as a rung. Nothing on the page
// moves: the page's row count is untouched by a screen below it.
pool.mount(claimant("s2r1c1"), { instanceId: "claimant#8" });
const below = timeline.advanceUntil("ViewSlotAssigned", { where: (fact) => fact.payload.sliceId === "claimant#8" });
assert(below.payload.geometry.includes("grid-row: 3;") && below.payload.geometry.includes("scroll-snap-align: start"), `A second screen's first row sits after the page's two rows and snaps, got ${below.payload.geometry}.`);
const screened = timeline.delivered("StageSlotsDeclared").at(-1);
assert(screened !== undefined &&
    ["s2r1c1", "s2r1c2", "s2r2c1", "s3r1c1"].every((slot) => screened.payload.slots.includes(slot)) &&
    !screened.payload.slots.includes("s1r1c1"), `Minting a screen lists its cells, its next row and the next screen, never an s1 spelling, got ${JSON.stringify(screened?.payload.slots)}.`);
pool.mount(claimant("s1r1c1"), { instanceId: "claimant#9" });
const spelled = timeline.advanceUntil("ViewSlotDenied", { where: (fact) => fact.payload.sliceId === "claimant#9" });
assert(spelled.payload.reason === "unknown-slot", "The page is never spelled s1: one name per seat.");
pool.unmount("claimant#8");
timeline.advance(3);
const unscreened = timeline.delivered("StageSlotsDeclared").at(-1);
assert(unscreened !== undefined && !unscreened.payload.slots.includes("s2r2c1") && unscreened.payload.slots.includes("s2r1c1"), "An emptied last screen retracts to a rung.");
// The layout-book pins what the grammar cannot: a fixed-height row and a
// weighted split. Mounting it reshapes; the weights land in the tracks.
pool.mount(layoutBook, { instanceId: "layout-book#1" });
const shape = timeline.advanceUntil("LayoutDeclared");
assert(shape.payload.rows["r1"]?.height === "2.5rem" && shape.payload.anchors?.band === "2.6rem", "The layout-book pins the status strip's height and the band size.");
// One book at a time: a second would fight the first (each re-declares on
// the other's late-joiner burst), so the IDE's book steps aside for a test
// book that pins a weighted split.
pool.unmount("layout-book#1");
timeline.advance(2);
const weighted = defineSlice({
    type: "test-book",
    consumes: ["SliceMounted"],
    emits: ["LayoutDeclared"],
    start(context) {
        context.emit("LayoutDeclared", { rows: { r1: { height: "2.5rem" }, 2: { cells: [2, 1] } } });
    },
});
pool.mount(weighted, { instanceId: "test-book#1" });
timeline.advance(3);
const split = timeline.delivered("ViewSlotAssigned", (fact) => fact.payload.sliceId === "claimant#2").at(-1);
assert(split !== undefined && split.payload.geometry.includes("grid-column: 3 / 4"), `A [2, 1] row puts its second cell on the last of three tracks, got ${split?.payload.geometry}.`);
// A stage hot-reload: the successor seeds its ledger from the predecessor's
// declaration and re-seats every holder from its own hand — the views
// never re-ask, and nobody loses a seat.
pool.mount(stage, { instanceId: "stage#2" });
const reseat = timeline.advanceUntil("ViewSlotAssigned", {
    where: (fact) => fact.sourceSlice === "stage#2" && fact.payload.sliceId === "claimant#2",
});
assert(reseat.payload.slot === "r2c2", "The successor stage re-seats the sitting holder.");
pool.unmount("stage#1");
timeline.advance(3);
const successorLedger = timeline
    .delivered("StageSlotsDeclared", (fact) => fact.sourceSlice === "stage#2")
    .at(-1);
assert(successorLedger !== undefined &&
    successorLedger.payload.held["r2c2"] === "claimant#2" &&
    successorLedger.payload.held["r2c2@br"] === "claimant#4" &&
    successorLedger.payload.held["r2c2@top"] === "claimant#5", `The successor's ledger must carry every inherited seat, got ${JSON.stringify(successorLedger?.payload.held)}.`);
console.log("slot re-ask: asking mints, a refused view inherits the freed seat, a corpse's request wedges nothing, and a successor stage re-seats everyone.");
