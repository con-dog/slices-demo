import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// This slice owns time as FACTS — and this app's time is purely input-driven:
// a stepper that answers EditRequested intents with one FrameTicked per
// delivery frame, so editor time advances exactly when someone types and
// stands still otherwise. There is no play/pause: with no wall-clock cadence,
// "paused" would gate nothing — live-versus-parked is the timeline's state,
// not a clock mode. Frame advancement is not here at all: the pool's own
// metabolism (pool.run() in the composition root) beats and drains, because
// moving frames is kernel behaviour, not a privilege a slice holds. The
// body is self-contained, so even time is adoptable — edit the clock from
// inside the editor it ticks for.
export const clock = defineSlice({
    type: "clock",
    description: "A stepper clock: input drives ticks; no wall clock, no pause.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: ["EditRequested"],
    emits: ["FrameTicked"],
    start(context) {
        let tickCount = 0;
        // A burst of intents in one frame collapses into a single tick: the
        // buffer applies the whole frame's worth of edits on that one tick.
        let tickedFrame = -1;
        context.subscribe("EditRequested", () => {
            if (tickedFrame === context.frameNumber)
                return;
            tickedFrame = context.frameNumber;
            context.emit("FrameTicked", { frameNumber: ++tickCount });
        });
    },
});
