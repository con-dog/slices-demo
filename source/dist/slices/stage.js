import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The arbitration slice for screen space (spec rule 7): view slices emit
// ViewSlotRequested intents and this slice alone decides placement — as
// facts, never via the cascade. It is also a state slice (rules 8 + 9): the
// slot vocabulary, the design tokens, and the assignment ledger live here and
// are re-declared for late-joining consumers.
//
// The page is screens of rows of cells, and a seat is a coordinate:
// `r<row>c<col>` is a cell on the page (screen 1), `s<n>r<row>c<col>` a
// cell on screen n below it (a viewport-tall snap screen the page ratchets
// to), `…@<anchor>` a HUD seat pinned over a cell (tl, tr, bl, br, top,
// bottom, center), `tray-<n>` a block on the fixed tooltray, `backdrop` the
// page behind everything. Asking mints: a row's cell count is the highest
// column anyone holds (equal widths), a screen's row count the highest row
// (equal heights), the page's screen count the highest screen — and an
// empty top cell, empty last row, or empty last screen retracts by itself.
// The whole shape is derived from the ledger on every reshape, so there is
// no counter to get out of step. What the grammar cannot say — a
// fixed-height row, a 2:1 split, the anchors' sizes — the layout-book
// publishes as LayoutDeclared, and this slice compiles it. Nothing else knows CSS: a grant's
// geometry is opaque cssText, and every reshape re-emits tokens and every held
// seat's geometry as new facts (the breakpoint-flip pattern), so the layout is
// scrubbable history. First request still wins; slot names are still stage
// geometry, never feature names.
export const stage = defineSlice({
    type: "stage",
    description: "Owns grid, tokens, seats as facts; a seat is r<row>c<col> or s<n>r<row>c<col>.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "ViewSlotRequested",
        "ViewConfigDeclared",
        "LayoutDeclared",
        "StageSlotsDeclared",
        "SliceMounted",
        "SliceUnmounted",
    ],
    emits: [
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewConfigDeclared",
        "ViewSlotAssigned",
        "ViewSlotDenied",
    ],
    start(context) {
        // --- The grammar -----------------------------------------------------
        // Every seat name parses into one of four kinds; anything else is an
        // unknown slot. Screen 1 is the page and is never spelled (`r2c1`, not
        // `s1r2c1` — one name per seat, so `held` reads true for everyone);
        // screens 2 and up carry their prefix. Anchors are the seven HUD
        // positions over a cell: the corners overlay it, `top` and `bottom` are
        // bands that inset it (the cell's occupant wears the matching padding,
        // so the two never overlap), `center` floats in its middle.
        const ANCHORS = ["tl", "tr", "bl", "br", "top", "bottom", "center"];
        const parse = (slot) => {
            if (slot === "backdrop")
                return { kind: "backdrop" };
            const tray = /^tray-([1-9]\d*)$/.exec(slot);
            if (tray)
                return { kind: "tray", index: Number(tray[1]) };
            const cell = /^(?:s([1-9]\d*))?r([1-9]\d*)c([1-9]\d*)(?:@([a-z]+))?$/.exec(slot);
            if (!cell)
                return null;
            if (cell[1] === "1")
                return null;
            const screen = cell[1] === undefined ? 1 : Number(cell[1]);
            const row = Number(cell[2]);
            const col = Number(cell[3]);
            if (cell[4] === undefined)
                return { kind: "cell", screen, row, col };
            if (!ANCHORS.includes(cell[4]))
                return null;
            return { kind: "anchor", screen, row, col, anchor: cell[4] };
        };
        // A row's name, and a cell's: the spelling the vocabulary uses.
        const rowName = (screen, row) => (screen === 1 ? `r${row}` : `s${screen}r${row}`);
        const cellName = (screen, row, col) => `${rowName(screen, row)}c${col}`;
        // --- The ledger and the book ------------------------------------------
        // slot name -> holding slice instance. First request wins; a holder's
        // re-request is idempotently re-assigned (that is the snapshot path).
        const holders = new Map();
        // The living, from the pool's own lifecycle facts: seats are granted
        // only to instances that still exist, so a request delivered after its
        // requester's death cannot wedge a seat (see ViewSlotRequested).
        const living = new Set();
        // The layout-book's word, as last declared. Empty until it speaks: every
        // row a 1fr share of the first screen, every cell weight 1.
        let bookRows = {};
        let bookColumns = {};
        let bookAnchors = {};
        // --- The shape, derived ------------------------------------------------
        // Screens: as many as the book pins or anyone holds; rows per screen and
        // cells per row likewise — never fewer than one. The book keys a row by
        // its name (`r2`, `s2r1`); a bare number is a page row (`2` is `r2`).
        const bookRow = (screen, row) => bookRows[rowName(screen, row)] ?? (screen === 1 ? bookRows[String(row)] : undefined);
        const bookKeys = () => Object.keys(bookRows)
            .map((key) => /^(?:s([1-9]\d*))?r?([1-9]\d*)$/.exec(key))
            .filter((m) => m !== null && m[1] !== "1")
            .map((m) => ({ screen: m[1] === undefined ? 1 : Number(m[1]), row: Number(m[2]) }));
        const bookCells = (screen, row) => {
            const cells = bookRow(screen, row)?.cells;
            if (Array.isArray(cells))
                return cells.length;
            return typeof cells === "number" ? Math.max(1, Math.floor(cells)) : 0;
        };
        const seatsHeld = () => [...holders.keys()].map(parse).filter((seat) => seat !== null);
        const placed = () => seatsHeld().flatMap((seat) => (seat.kind === "cell" || seat.kind === "anchor" ? [seat] : []));
        const screenCount = () => Math.max(1, ...bookKeys().map((k) => k.screen), ...placed().map((seat) => seat.screen));
        const rowCount = (screen) => Math.max(1, ...bookKeys().filter((k) => k.screen === screen).map((k) => k.row), ...placed().filter((seat) => seat.screen === screen).map((seat) => seat.row));
        const cellCount = (screen, row) => Math.max(1, bookCells(screen, row), ...placed().filter((seat) => seat.screen === screen && seat.row === row).map((seat) => seat.col));
        // A row's cell weights: the book's, padded with 1s for minted cells.
        const weights = (screen, row) => {
            const declared = bookRow(screen, row)?.cells;
            const count = cellCount(screen, row);
            const out = [];
            for (let i = 0; i < count; i += 1) {
                // Whole numbers only: the LCM track math needs integers.
                const w = Array.isArray(declared) ? Math.round(Number(declared[i])) : NaN;
                out.push(Number.isFinite(w) && w > 0 ? w : 1);
            }
            return out;
        };
        const trayCount = () => Math.max(1, ...seatsHeld().map((seat) => (seat.kind === "tray" ? seat.index : 0)));
        const heightOf = (screen, row) => {
            const raw = bookRow(screen, row)?.height?.trim();
            if (raw === undefined || raw === "" || raw === "screen")
                return { kind: "share", weight: 1 };
            const share = /^(\d+(?:\.\d+)?)fr$/.exec(raw);
            if (share)
                return { kind: "share", weight: Math.max(0.01, Number(share[1])) };
            return { kind: "fixed", css: raw };
        };
        // --- Metrics ---------------------------------------------------------
        // Columns are LCM tracks: a row of 3 over a row of 2 is a 6-track grid,
        // each cell spanning tracks / cells; the track gap makes the cell widths
        // come out exactly equal-split with one gap between neighbours. The
        // page width follows the widest row under a per-cell floor and cap
        // (the book may move both): past the cap the grid centres, under the
        // floor it overflows and the page scrolls — scrollbars are the floor's
        // honest consequence, never clipped away. Half the leftover is the tray
        // inset. Width and height are decoupled: each screen's share rows split
        // that screen's height (the viewport less the page chrome and the
        // tooltray), and screens stack below the page rather than squeeze it.
        const GAP = 1.25;
        const ROW_GAP = 0.75;
        const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
        const lcm = (a, b) => (a * b) / gcd(a, b);
        const screens = () => Array.from({ length: screenCount() }, (_, i) => i + 1);
        const rowsOf = (screen) => Array.from({ length: rowCount(screen) }, (_, i) => i + 1);
        const allRows = () => screens().flatMap((screen) => rowsOf(screen).map((row) => ({ screen, row })));
        // A row's line in the one body grid: every earlier screen's rows first.
        const gridRow = (screen, row) => screens().filter((s) => s < screen).reduce((sum, s) => sum + rowCount(s), 0) + row;
        const unitsOf = (screen, row) => weights(screen, row).reduce((sum, w) => sum + w, 0);
        const tracks = () => allRows().reduce((acc, r) => lcm(acc, unitsOf(r.screen, r.row)), 1);
        const widest = () => Math.max(...allRows().map((r) => cellCount(r.screen, r.row)));
        const cellFloor = () => bookColumns.floor ?? "22rem";
        const cellCap = () => bookColumns.cap ?? "44rem";
        const gapsRem = (n) => `${((n - 1) * GAP).toFixed(2)}rem`;
        const pageWidth = () => {
            const n = widest();
            return `clamp(calc(${n} * ${cellFloor()} + ${gapsRem(n)}), calc(100vw - 2.75rem), calc(${n} * ${cellCap()} + ${gapsRem(n)}))`;
        };
        const cellSize = () => `calc((${pageWidth()} - ${gapsRem(widest())}) / ${widest()})`;
        const stageInset = () => `max(0.75rem, calc((100vw - (${pageWidth()})) / 2))`;
        const trackSize = () => `calc((${pageWidth()} - ${gapsRem(tracks())}) / ${tracks()})`;
        // Each screen's budget for its share rows: the viewport minus the page's
        // chrome (the top padding on the page, the tooltray on every screen),
        // its fixed rows, and the gaps between its rows.
        const rowTracks = () => screens()
            .flatMap((screen) => {
            const rows = rowsOf(screen);
            const heights = rows.map((row) => heightOf(screen, row));
            const fixed = heights.filter((h) => h.kind === "fixed");
            const totalWeight = heights.reduce((sum, h) => sum + (h.kind === "share" ? h.weight : 0), 0);
            const chrome = screen === 1 ? "6.5rem" : "6.25rem";
            const budget = `calc(100vh - ${chrome} - ${((rows.length - 1) * ROW_GAP).toFixed(2)}rem${fixed
                .map((h) => ` - (${h.css})`)
                .join("")})`;
            return heights.map((h) => {
                if (h.kind === "fixed")
                    return h.css;
                const share = `${(h.weight / totalWeight).toFixed(4)}`;
                return `minmax(calc(26rem * ${share}), calc((${budget}) * ${share}))`;
            });
        })
            .join(" ");
        const manyScreens = () => screenCount() > 1;
        const BAND = () => bookAnchors.band ?? "2.6rem";
        const CORNER = () => bookAnchors.corner ?? "17.5rem";
        const CENTER = () => bookAnchors.center ?? "clamp(16rem, 34vw, 34rem)";
        // The fire terminal theme: gold and burnt orange over maroon-black rust,
        // published as data. The semantic names (accent-*, surface-*, water-*,
        // text-bright, chip-surface) are the kit view slices' vocabulary; the
        // same slices wear Life's neon and Invaders' matrix green in the other
        // apps. Metric tokens are re-derived per shape, so a reshape republishes
        // them.
        const tokens = () => ({
            "accent-emit": "#ffb300",
            "accent-consume": "#ff7a2e",
            /* The alarm colour: the visualizer's red ! badge on an errored card. */
            "accent-error": "#ff2f2f",
            "surface-950": "#1d0d05",
            "surface-900": "#29120a",
            /* Panel interiors (slice cards, chevrons, tray blocks) share the
               editor's ground; only the pool sits on surface-900 under its water. */
            "surface-800": "#1d0d05",
            "surface-600": "#66300f",
            "surface-400": "#a8551a",
            "surface-200": "#e8b366",
            "text-bright": "#ffe9c2",
            "chip-surface": "rgb(41 18 8 / 0.88)",
            "water-line": "rgb(255 140 40 / 0.07)",
            "water-glint": "rgb(140 55 15 / 0.3)",
            "water-deep": "rgb(64 22 8 / 0.55)",
            "header-band": "3.25rem",
            "tray-height": "4.75rem",
            "slice-band": "10.25rem",
            "wire-band": "3.5rem",
            "stage-size": cellSize(),
            "stage-inset": stageInset(),
        });
        // --- Geometry: the compiler ------------------------------------------
        // Seat -> CSS declarations for the host element, shipped in
        // ViewSlotAssigned payloads and applied opaquely by the assignee. Derived
        // per shape, so a reshape re-emits fresh geometry to every holder.
        const columnSpan = (screen, row, col) => {
            const w = weights(screen, row);
            const per = tracks() / unitsOf(screen, row);
            const before = w.slice(0, col - 1).reduce((sum, x) => sum + x, 0);
            const start = 1 + before * per;
            return `${start} / ${start + w[col - 1] * per}`;
        };
        // The ratchet's teeth: every screen's first row is a snap point.
        const snap = (row) => row === 1 ? " scroll-snap-align: start; scroll-snap-stop: always; scroll-margin-top: 0.75rem;" : "";
        const TRAY_COMMON = "position: fixed; z-index: 10; bottom: 0.75rem; height: 3.25rem;";
        const TRAY_BAY = 11.5;
        const geometry = (slot) => {
            const seat = parse(slot);
            if (seat === null)
                return "";
            switch (seat.kind) {
                case "backdrop":
                    return "position: fixed; z-index: -1; inset: 0; width: 100vw; height: 100vh;";
                case "tray": {
                    // Tray blocks stack right-to-left in fixed-width bays; tray-1
                    // flexes across whatever the bays leave.
                    const trays = trayCount();
                    if (seat.index === 1) {
                        return `${TRAY_COMMON} left: ${stageInset()}; right: calc(${stageInset()} + ${((trays - 1) * TRAY_BAY).toFixed(2)}rem);`;
                    }
                    const offset = (trays - seat.index) * TRAY_BAY;
                    const edge = offset === 0 ? stageInset() : `calc(${stageInset()} + ${offset.toFixed(2)}rem)`;
                    return `${TRAY_COMMON} right: ${edge}; width: 11rem;`;
                }
                case "cell": {
                    const cell = cellName(seat.screen, seat.row, seat.col);
                    const place = `grid-row: ${gridRow(seat.screen, seat.row)}; grid-column: ${columnSpan(seat.screen, seat.row, seat.col)}; min-width: 0; min-height: 0;`;
                    const top = holders.has(`${cell}@top`) ? ` padding-top: calc(${BAND()} + 0.5rem);` : "";
                    const bottom = holders.has(`${cell}@bottom`) ? ` padding-bottom: calc(${BAND()} + 0.5rem);` : "";
                    return `${place}${top}${bottom}${snap(seat.row)}`;
                }
                case "anchor": {
                    const cell = cellName(seat.screen, seat.row, seat.col);
                    const place = `grid-row: ${gridRow(seat.screen, seat.row)}; grid-column: ${columnSpan(seat.screen, seat.row, seat.col)}; min-width: 0;`;
                    const topHeld = holders.has(`${cell}@top`);
                    const bottomHeld = holders.has(`${cell}@bottom`);
                    switch (seat.anchor) {
                        case "top":
                            return `${place} align-self: start; z-index: 2; height: ${BAND()};`;
                        case "bottom":
                            return `${place} align-self: end; z-index: 2; height: ${BAND()};`;
                        case "center":
                            return `${place} align-self: center; justify-self: center; z-index: 3; height: 2.5rem; width: ${CENTER()};`;
                        default: {
                            // A corner: a panel pinned inside the cell, clear of any band.
                            const vertical = seat.anchor.startsWith("t") ? "start" : "end";
                            const horizontal = seat.anchor.endsWith("l") ? "start" : "end";
                            const inset = (held) => (held ? `calc(${BAND()} + 0.6rem)` : "0.6rem");
                            const margin = `${inset(vertical === "start" && topHeld)} 0.6rem ${inset(vertical === "end" && bottomHeld)} 0.6rem`;
                            return `${place} align-self: ${vertical}; justify-self: ${horizontal}; z-index: 2; width: ${CORNER()}; margin: ${margin};`;
                        }
                    }
                }
            }
        };
        // The grant's placement as data (SlotGrid): the grid lines the geometry
        // names, for seats the grid places; fixed seats (tray, backdrop) have
        // none. Read out of the same string, so the two can never disagree.
        const gridOf = (css) => {
            const row = /grid-row:\s*(-?\d+)(?:\s*\/\s*(-?\d+))?/.exec(css);
            const col = /grid-column:\s*(-?\d+)(?:\s*\/\s*(-?\d+))?/.exec(css);
            if (row === null || col === null)
                return undefined;
            const span = (start, end) => {
                const from = Number(start);
                return { from, to: end === undefined ? from + 1 : Number(end) };
            };
            const r = span(row[1], row[2]);
            const c = span(col[1], col[2]);
            return { row: r.from, rowEnd: r.to, column: c.from, columnEnd: c.to };
        };
        const grant = (sliceId, slot) => {
            const css = geometry(slot);
            const grid = gridOf(css);
            context.emit("ViewSlotAssigned", {
                sliceId,
                slot,
                geometry: css,
                ...(grid === undefined ? {} : { grid }),
            });
        };
        // The stage's own stylesheet: body (the grid the seats live in) and the
        // tray backdrop — both stage-owned resources. Rebuilt on every reshape.
        // min-width: fit-content keeps the centred grid scrollable instead of
        // cropped when the floor wins.
        const style = document.createElement("style");
        const restyle = () => {
            const stacked = manyScreens();
            style.textContent = `${stacked
                ? `
  html {
    /* The ratchet: whole screens only, hard steps, never smooth. Only
       declared while a second screen exists — a lone snap point would
       fight plain scrolling on short viewports. */
    scroll-snap-type: y mandatory;
    scroll-behavior: auto;
  }
`
                : ""}
  body {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: repeat(${tracks()}, ${trackSize()});
    grid-template-rows: ${rowTracks()};
    justify-content: center;
    align-content: start;
    column-gap: ${GAP}rem;
    row-gap: ${ROW_GAP}rem;
    min-height: calc(100vh - 5rem);
    min-width: fit-content;
    margin: 0;
    padding: 0.75rem;
    padding-bottom: ${stacked ? "5.75rem" : "0.75rem"};
    /* The ground is deep rust — palette-dark, but a shade warmer and
       lighter than the panels, so every plate still reads as a cast block. */
    background: #30150b;
  }
  [data-tooltray-backdrop] {
    position: fixed;
    z-index: 5;
    right: 0;
    bottom: 0;
    left: 0;
    height: 4.75rem;
    border-top: 2px solid #a8551a;
    background: #29120a;
  }
`;
        };
        restyle();
        document.head.append(style);
        // The tooltray backdrop is page chrome: the strip the tray slots sit on.
        // It carries no controls — each control is its own slice.
        const tray = document.createElement("div");
        tray.dataset.tooltrayBackdrop = "";
        document.body.append(tray);
        // --- The vocabulary, spelled out ----------------------------------------
        // Every built seat, then the next rung of each row, each screen's next
        // row, the next screen, and the next tray block — ordinary requestable
        // names, so the declaration IS the growth grammar spelled extensionally
        // (any coordinate is requestable; the rungs are the suggested next
        // ones). Anchors on built cells come last, so the shape reads first.
        const slotNames = () => {
            const names = ["backdrop"];
            const anchors = [];
            for (const screen of screens()) {
                for (const row of rowsOf(screen)) {
                    const cells = cellCount(screen, row);
                    for (let col = 1; col <= cells + 1; col += 1)
                        names.push(cellName(screen, row, col));
                    for (let col = 1; col <= cells; col += 1) {
                        for (const anchor of ANCHORS)
                            anchors.push(`${cellName(screen, row, col)}@${anchor}`);
                    }
                }
                names.push(cellName(screen, rowCount(screen) + 1, 1));
            }
            names.push(cellName(screenCount() + 1, 1, 1));
            for (let i = 1; i <= trayCount() + 1; i += 1)
                names.push(`tray-${i}`);
            return [...names, ...anchors];
        };
        // The kit views' charters: their configuration as facts, owned here
        // because the stage is the app's identity — what this app looks like
        // AND how its infrastructure behaves. A chartered view starts itself
        // when its charter lands, so nothing is passed to a constructor.
        const CHARTERS = {
            visualizer: {
                slot: "r2c1",
                // Editor facts are all chip-worthy, but the dungeon speaks at game
                // rate — its heartbeat types render as lane ticks, never boxes.
                throttledTypes: [
                    "DoomTicked",
                    "PoseChanged",
                    "DemonsMoved",
                    "HelmIntent",
                ],
                // The cards are the file tree; the toolbar's SHOW|HIDE button.
                selectSlices: true,
                hideSlices: true,
            },
            timeline: {
                slot: "tray-1",
                // Typing or opening a slice declares a new "now" (a branch, if
                // parked); Back/Step are undo/redo over BufferChanged markers.
                resetToLiveOn: [
                    "EditRequested",
                    "SliceSelected",
                    "SliceCreateRequested",
                    "SliceDuplicateRequested",
                    "SliceDeleteRequested",
                ],
                stepBack: { on: "StepBackPressed", markers: ["BufferChanged"] },
                stepForward: { on: "StepPressed", markers: ["BufferChanged"] },
            },
            "causality-inspector": { slot: "r2c1@br" },
        };
        const charter = () => {
            for (const [view, config] of Object.entries(CHARTERS)) {
                context.emit("ViewConfigDeclared", { view, config });
            }
        };
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        // The declaration carries occupancy too (`held`: slot -> holder), so a
        // late joiner reads who sits where from the same fact that names the
        // seats; grants and unmounts are the deltas between declarations.
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("StageTokensDeclared", { tokens: tokens() });
            context.emit("StageSlotsDeclared", {
                slots: slotNames(),
                held: Object.fromEntries(holders),
            });
        };
        // A reshape is the breakpoint-flip pattern: the stylesheet rebuilds, the
        // metric tokens and slot list re-declare, and every held slot's geometry
        // goes out again as new facts — the new layout is readable from the
        // history alone. The shape is derived from the ledger and the book, so
        // there is nothing to retract by hand: whatever nobody holds is gone.
        const reshape = () => {
            restyle();
            declare();
            for (const [slot, holder] of holders)
                grant(holder, slot);
        };
        charter();
        declare();
        // The layout-book spoke: the shape it pins (row heights, cell weights,
        // anchor sizes) is compiled into the grid and every holder re-seated.
        // The youngest living book has the word: during a hot reload the
        // predecessor and successor overlap for a frame and both may declare,
        // and a duplicated book is a second voice for good — a declaration
        // from a source mounted earlier than the one last taken is ignored,
        // until that source departs.
        const mountRank = new Map();
        let bookSource = null;
        const rankOf = (sliceId) => mountRank.get(sliceId) ?? Number.POSITIVE_INFINITY;
        context.subscribe("LayoutDeclared", (fact) => {
            const source = fact.sourceSlice;
            if (bookSource !== null && source !== bookSource && rankOf(source) < rankOf(bookSource))
                return;
            bookSource = source;
            bookRows = { ...fact.payload.rows };
            bookColumns = { ...(fact.payload.columns ?? {}) };
            bookAnchors = { ...(fact.payload.anchors ?? {}) };
            reshape();
        });
        // A charter's landing is a late-joiner moment: the chartered view
        // starts inside that delivery and its subscriptions attach a frame
        // later, so hearing our own charter land re-declares slots and tokens
        // one frame after it — the newborn interior gets both, deterministically.
        let recharteredFrame = -1;
        context.subscribe("ViewConfigDeclared", () => {
            if (recharteredFrame === context.frameNumber)
                return;
            recharteredFrame = context.frameNumber;
            declare();
        });
        // A successor (a hot reload of this stage) seeds its ledger from the
        // predecessor's declaration, heard as any late joiner hears it, and
        // re-seats every holder from its own hand — no view has to notice the
        // stage changed under it. The predecessor ignores foreign declarations.
        // The pool re-publishes living mounts to a newcomer before its own mount
        // fact, so a predecessor is known before this instance hears itself.
        let predecessorSeen = false;
        let heardSelf = false;
        let inherited = false;
        context.subscribe("StageSlotsDeclared", (fact) => {
            if (fact.sourceSlice === context.instanceId)
                return;
            if (!predecessorSeen || inherited)
                return;
            inherited = true;
            for (const [slot, holder] of Object.entries(fact.payload.held)) {
                if (parse(slot) !== null && !holders.has(slot))
                    holders.set(slot, holder);
            }
            reshape();
        });
        // The shape as a string: screens x rows x cells, trays, and which bands
        // are held — everything whose change moves somebody else's geometry.
        const shapeKey = () => `${allRows().map((r) => `${r.screen}.${r.row}:${cellCount(r.screen, r.row)}`).join(",")}|${trayCount()}|${[...holders.keys()]
            .filter((slot) => /@(?:top|bottom)$/.test(slot))
            .sort()
            .join(",")}`;
        context.subscribe("ViewSlotRequested", (fact) => {
            const slot = fact.payload.slot;
            const requester = fact.sourceSlice;
            // A request can outlive its requester: under replay's hot-reload
            // churn, an instance may unmount between emitting this and the stage
            // hearing it. Granting a corpse wedges the seat forever (its
            // SliceUnmounted already passed, so nothing would ever free it), and
            // denying one is noise — the request is simply dropped.
            if (!living.has(requester))
                return;
            if (parse(slot) === null) {
                context.emit("ViewSlotDenied", {
                    sliceId: requester,
                    slot,
                    reason: "unknown-slot",
                });
                return;
            }
            const holder = holders.get(slot);
            if (holder !== undefined && holder !== requester) {
                if (living.has(holder)) {
                    context.emit("ViewSlotDenied", {
                        sliceId: requester,
                        slot,
                        reason: "occupied",
                    });
                    return;
                }
                // The sitting holder died with its grant in flight — no future
                // unmount will free this seat, so the ledger heals itself: the
                // corpse is evicted and the living asker takes the vacancy.
                holders.delete(slot);
            }
            // A seat the current shape already has is granted alone; one that
            // grows the shape (a new cell, row, tray bay, or a band that insets
            // its cell) reshapes, and the asker's grant rides the same
            // re-emission as every sitting tenant's new geometry.
            const before = shapeKey();
            holders.set(slot, requester);
            if (shapeKey() !== before) {
                reshape();
                return;
            }
            grant(requester, slot);
        });
        // A departing slice frees its seats for future requesters; if the shape
        // moved (an empty top cell, an empty last row, an empty top tray bay, a
        // band gone), the grid breathes in — otherwise the vacancy is simply
        // declared, and the fresh declaration prompts every unseated view to
        // ask again: first request wins the vacancy exactly as it won the
        // original.
        context.subscribe("SliceUnmounted", (fact) => {
            living.delete(fact.payload.sliceId);
            if (fact.payload.sliceId === bookSource)
                bookSource = null;
            const before = shapeKey();
            let freed = false;
            for (const [slot, holder] of holders) {
                if (holder === fact.payload.sliceId) {
                    holders.delete(slot);
                    freed = true;
                }
            }
            if (!freed)
                return;
            if (shapeKey() !== before)
                reshape();
            else
                declare();
        });
        // Late joiners never ask: any newly mounted slice that consumes the
        // declarations gets fresh ones (and a chartered view gets its charter
        // again), and answers with its slot request.
        let charteredFrame = -1;
        context.subscribe("SliceMounted", (fact) => {
            living.add(fact.payload.sliceId);
            // Mount order, first hearing wins (the pool re-publishes living
            // mounts to newcomers; a re-hearing must not make an elder young).
            if (!mountRank.has(fact.payload.sliceId))
                mountRank.set(fact.payload.sliceId, mountRank.size);
            if (fact.payload.sliceType === context.sliceType) {
                if (fact.payload.sliceId === context.instanceId)
                    heardSelf = true;
                else if (!heardSelf)
                    predecessorSeen = true;
            }
            const consumes = fact.payload.consumes;
            const wantsCharter = consumes.includes("ViewConfigDeclared") || consumes.includes("*");
            if (wantsCharter && charteredFrame !== context.frameNumber) {
                charteredFrame = context.frameNumber;
                charter();
            }
            if (!consumes.includes("StageSlotsDeclared") &&
                !consumes.includes("StageTokensDeclared") &&
                !consumes.includes("*")) {
                return;
            }
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
        return () => {
            style.remove();
            tray.remove();
        };
    },
});
