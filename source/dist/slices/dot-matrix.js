import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Page-texture slice: it owns the background canvas and its animation frame
// loop; its only pool traffic is the slot protocol. It references no stage
// tokens (the greys are its own), but speaks the full protocol anyway so the
// protocol stays uniform across every view slice. The body is self-contained
// (no module-scope references), so this slice is adoptable.
export const dotMatrix = defineSlice({
    type: "dot-matrix",
    description: "Paints the grey dot grid behind the page; dots swell and pop.",
    consumes: [
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["ViewSlotRequested"],
    start(context) {
        // Grid pitch and dot sizes in CSS pixels; the canvas oversamples by DPR.
        const PITCH = 26;
        const BASE_DOT = 2;
        // A swelling dot ratchets through discrete sizes — hard steps, no easing —
        // then flashes a hollow square outline and pops back to a base dot. Same
        // backdrop as Life's and Invaders', wearing this app's washed concrete.
        const SWELL_SIZES = [4, 6, 8, 11, 14];
        // Rust tints a step off the ground — the backdrop is aggregate in the
        // pour, not signage; only the panels carry the gold.
        const SWELL_GREYS = ["#3a1a0d", "#452010", "#522613", "#602d16", "#70351a"];
        const STEP_MS = 140;
        const POP_SIZE = 16;
        const POP_MS = 90;
        const POP_GREY = "#8a4418";
        const BASE_GREY = "#3b1b0e";
        // Per-animation-frame chance a resting dot starts swelling, and the
        // ceiling on how many swell at once. Purely decorative, so Math.random
        // is fine here — unlike the editor, the backdrop is not replayed.
        const SPAWN_CHANCE = 0.02;
        const MAX_ACTIVE = 7;
        // Inert to the pointer (the slice's own decision, on :host); being
        // behind everything is the backdrop slot's geometry, which the stage
        // owns. Sealed inside this slice's shadow root.
        const dotMatrixStyles = `
  :host { pointer-events: none; }
  [data-dot-matrix] {
    display: block;
    width: 100%;
    height: 100%;
  }
`;
        // The host is the stage's geometry surface; the shadow root is this
        // slice's sealed interior (CLAUDE.md). A canvas cannot host a shadow
        // root, so the host wraps it.
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = dotMatrixStyles;
        const tokenStyle = document.createElement("style");
        const canvas = document.createElement("canvas");
        canvas.dataset.dotMatrix = "";
        canvas.setAttribute("aria-hidden", "true");
        shadow.append(style, tokenStyle, canvas);
        document.body.append(host);
        const paint2d = canvas.getContext("2d");
        if (!paint2d)
            throw new Error("Dot matrix could not initialize its canvas.");
        const joinStage = (slot) => {
            context.subscribe("StageTokensDeclared", (fact) => {
                tokenStyle.textContent = `:host { ${Object.entries(fact.payload.tokens)
                    .map(([name, value]) => `--${name}: ${value};`)
                    .join(" ")} }`;
            });
            // Occupancy is in the declaration: while it does not name this
            // instance in the seat, ask — first ask, a denial's next chance, a
            // new stage's fresh ledger, all the same one line.
            context.subscribe("StageSlotsDeclared", (fact) => {
                if (fact.payload.held[slot] !== context.instanceId)
                    context.emit("ViewSlotRequested", { slot });
            });
            context.subscribe("ViewSlotAssigned", (fact) => {
                if (fact.payload.sliceId !== context.instanceId)
                    return;
                host.dataset.slot = fact.payload.slot;
                host.style.cssText = fact.payload.geometry;
            });
        };
        joinStage("backdrop");
        let cols = 0;
        let rows = 0;
        // Cell index (row * cols + col) -> timestamp the swell started.
        const active = new Map();
        const drawBaseDot = (cell) => {
            const x = (cell % cols) * PITCH;
            const y = Math.floor(cell / cols) * PITCH;
            paint2d.clearRect(x, y, PITCH, PITCH);
            paint2d.fillStyle = BASE_GREY;
            const inset = (PITCH - BASE_DOT) / 2;
            paint2d.fillRect(x + inset, y + inset, BASE_DOT, BASE_DOT);
        };
        const resize = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.ceil(window.innerWidth * dpr);
            canvas.height = Math.ceil(window.innerHeight * dpr);
            paint2d.setTransform(dpr, 0, 0, dpr, 0, 0);
            cols = Math.ceil(window.innerWidth / PITCH);
            rows = Math.ceil(window.innerHeight / PITCH);
            active.clear();
            for (let cell = 0; cell < cols * rows; cell += 1)
                drawBaseDot(cell);
        };
        window.addEventListener("resize", resize);
        resize();
        // Only the cells that are swelling repaint each frame; the resting grid
        // is drawn once per resize.
        const draw = (now) => {
            for (const [cell, startedAt] of active) {
                const x = (cell % cols) * PITCH;
                const y = Math.floor(cell / cols) * PITCH;
                paint2d.clearRect(x, y, PITCH, PITCH);
                const step = Math.floor((now - startedAt) / STEP_MS);
                if (step < SWELL_SIZES.length) {
                    const size = SWELL_SIZES[step];
                    const inset = (PITCH - size) / 2;
                    paint2d.fillStyle = SWELL_GREYS[step];
                    paint2d.fillRect(x + inset, y + inset, size, size);
                }
                else if (now - startedAt < SWELL_SIZES.length * STEP_MS + POP_MS) {
                    const inset = (PITCH - POP_SIZE) / 2;
                    paint2d.strokeStyle = POP_GREY;
                    paint2d.lineWidth = 2;
                    paint2d.strokeRect(x + inset + 1, y + inset + 1, POP_SIZE - 2, POP_SIZE - 2);
                }
                else {
                    active.delete(cell);
                    drawBaseDot(cell);
                }
            }
            if (active.size < MAX_ACTIVE && Math.random() < SPAWN_CHANCE && cols * rows > 0) {
                const cell = Math.floor(Math.random() * cols * rows);
                if (!active.has(cell))
                    active.set(cell, now);
            }
            frameHandle = window.requestAnimationFrame(draw);
        };
        let frameHandle = window.requestAnimationFrame(draw);
        return () => {
            window.cancelAnimationFrame(frameHandle);
            window.removeEventListener("resize", resize);
            host.remove();
        };
    },
});
