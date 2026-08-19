import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The page shape as a document. The stage owns the grid and the seat
// grammar — a seat is a coordinate, `r<row>c<col>`, and asking for one
// mints it, equal widths, one screen shared equally by the rows — so most
// layouts need no book at all: five requests are three thirds over two
// halves, and s2r1c1 is a second screen. This book says only what the
// grammar cannot: a fixed-height row, a weighted split, how big the anchor
// seats are. It is a state slice (rules 8 + 9) with one piece of state,
// published as LayoutDeclared and re-declared for late joiners, the way the
// rule-book publishes the law and the schema-book the shapes. The stage is
// locked to the human's rank; this book is not — a mind restructures the
// page with one replace-match here, the foundry hot-reloads it, the stage
// reshapes, every view is re-seated as new facts, and the edit is journaled
// and undoable like typing. The body is self-contained, so it is adoptable.
export const layoutBook = defineSlice({
    type: "layout-book",
    description: "Publishes the page shape as data: row heights, cell weights, anchor sizes.",
    consumes: ["SliceMounted"],
    emits: ["LayoutDeclared"],
    start(context) {
        // Rows keyed by name: r1, r2, … on the page (a bare number is a page
        // row), s2r1, s2r2, … on the second screen, and so on. height: a CSS
        // length (fixed) or "<n>fr" (a weighted share of its screen); absent is
        // "1fr". cells: a count (equal widths) or one whole-number weight per
        // cell ([2, 1] is two thirds | one third); requests may mint more
        // cells, rows, and screens, never fewer.
        //
        // The IDE: r1 is the status strip (status-plate in r1c1, thread-plate at
        // r1c1@center); r2 is the workbench — visualizer in r2c1 under the
        // slice-toolbar at r2c1@top with the causality-inspector at r2c1@br,
        // the editor in r2c2, the ticket-rack in r2c3 — and takes the rest of
        // the screen. Ask for r3c1 and a third row appears beneath, sharing the
        // page (pin r2 as "3fr" here to keep it tall); ask for s2r1c1 and a
        // second screen appears below the page instead, the page ratcheting
        // to it — its rows share it the same way (s2r1: { cells: [3, 1] }).
        const ROWS = {
            r1: { height: "2.5rem" },
            r2: {},
        };
        // Per-cell width bounds (past the cap the grid centres; under the floor
        // the page scrolls) and the anchor seats' sizes: the @top | @bottom
        // band's height, the corner panels' width, the @center strip's width.
        const COLUMNS = { floor: "22rem", cap: "44rem" };
        const ANCHORS = { band: "2.6rem", corner: "17.5rem", center: "clamp(16rem, 34vw, 34rem)" };
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("LayoutDeclared", { rows: ROWS, columns: COLUMNS, anchors: ANCHORS });
        };
        // Rule 9: a late joiner that listens (the stage, its successors) gets
        // the shape as it stands; a burst of mounts collapses into one. The
        // hand-off etiquette: a successor's mount (this type, not this
        // instance, after hearing itself) is the moment to fall silent — the
        // successor speaks the new shape in the same frame, and a predecessor
        // re-declaring the old one after it would win the last word for one
        // frame. The pool re-publishes living mounts to a newcomer before its
        // own mount fact, so a predecessor is known before this instance hears
        // itself and is never mistaken for a successor.
        let heardSelf = false;
        let superseded = false;
        declare();
        context.subscribe("SliceMounted", (fact) => {
            if (fact.payload.sliceType === context.sliceType) {
                if (fact.payload.sliceId === context.instanceId)
                    heardSelf = true;
                else if (heardSelf)
                    superseded = true;
            }
            if (superseded)
                return;
            const consumes = fact.payload.consumes;
            if (!consumes.includes("LayoutDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
