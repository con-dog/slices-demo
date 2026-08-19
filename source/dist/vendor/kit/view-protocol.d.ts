import type { SliceDefinition } from "./pool.js";
/**
 * The view protocol: the event vocabulary the kit's infrastructure view
 * slices (visualizer, timeline, causality inspector) speak with an
 * application's stage slice. The stage itself stays app-owned — layout is an
 * application's design — but the payload shapes and their contracts live
 * here so every app agrees with the kit's slices by construction.
 *
 * Theming is data, not code: the kit's view slices style themselves with
 * semantic design tokens (accent-emit, accent-consume, surface-950…200,
 * text-bright, water-line, water-glint, water-deep, chip-surface, plus the
 * layout tokens slice-band and wire-band), each with a literal fallback. An
 * application's stage publishes its own values via StageTokensDeclared —
 * neon pink over concrete in one app, phosphor green in another — and the
 * same slice wears either skin.
 */
export type SlotDenialReason = "unknown-slot" | "occupied";
export type ViewProtocolPayloads = {
    /**
     * A view slice's charter: its configuration as data, on the board. The
     * application's stage (its identity owner) publishes one per kit view —
     * `view` names the slice type, `config` carries what a factory option
     * bag once whispered — and the view slice starts itself when its
     * charter arrives. Configuration is state (rules 8 + 9): re-published
     * for late joiners, visible in the history, editable at the source.
     */
    ViewConfigDeclared: {
        view: string;
        config: Readonly<Record<string, unknown>>;
    };
    StageSlotsDeclared: {
        slots: readonly string[];
        /** Occupancy (slot -> holder instance), when the stage publishes it as its rule-9 seed. */
        held?: Readonly<Record<string, string>>;
    };
    StageTokensDeclared: {
        tokens: Readonly<Record<string, string>>;
    };
    ViewSlotRequested: {
        slot: string;
    };
    ViewSlotAssigned: {
        sliceId: string;
        slot: string;
        geometry: string;
        /** A grid seat's placement as data (one-based lines, -1 the last), when the stage says. */
        grid?: {
            row: number;
            rowEnd: number;
            column: number;
            columnEnd: number;
        };
    };
    ViewSlotDenied: {
        sliceId: string;
        slot: string;
        reason: SlotDenialReason;
    };
};
/** The selection vocabulary of the causality inspector and fact displays. */
export type InspectionPayloads = {
    FactSelected: {
        factId: string;
    };
    FactDeselected: Record<string, never>;
    CausalPathTraced: {
        rootId: string;
        factIds: readonly string[];
    };
    /**
     * A slice card was picked in the visualizer (its selectSlices option).
     * Selection is an intent like any other: what opening a slice MEANS is the
     * consuming application's business — an IDE answers with that slice's
     * document, other apps may not listen at all.
     */
    SliceSelected: {
        sliceId: string;
    };
    /**
     * An intent to toggle a slice's visibility in the pool (a toolbar's
     * SHOW|HIDE button). The visualizer owns the answer: it flips the flag and
     * publishes SliceVisibilityChanged, so every observer agrees through the
     * pool — the click never styles anything directly.
     */
    SliceHideRequested: {
        sliceId: string;
    };
    /**
     * A slice's pool visibility, as owned by the visualizer (its hideSlices
     * option). Hidden means the slice keeps its card (dotted border) but its
     * emissions get no lane and no chips in the water.
     */
    SliceVisibilityChanged: {
        sliceId: string;
        hidden: boolean;
    };
    /**
     * A slice's health, as judged by whatever application slice owns the
     * verdict (an IDE's foundry aggregating compile, lint, and contract
     * violations). The visualizer wears it: an errored slice keeps its card
     * but greys out and gains a red exclamation badge; `message` becomes the badge's
     * tooltip. The owner re-announces after every remount, since the flag
     * names a live instance.
     */
    SliceErrorChanged: {
        sliceId: string;
        errored: boolean;
        message?: string;
    };
    /**
     * The locks, as declared by whatever application slice owns them (an
     * IDE's lock-book): slice TYPE -> the minimum priority an intent needs
     * to edit, rename into, copy or delete that slice's document; absent
     * means unlocked. A state fact (rule 9: re-published for late joiners
     * and on every change). The visualizer wears it: every living card of a
     * locked type gains a square padlock badge (top-right, the consume
     * accent), so the lock is read where the slice is picked. Keyed by type,
     * not instance, because a lock outlives hot reloads.
     */
    SliceLocksDeclared: {
        locks: Readonly<Record<string, number>>;
    };
};
/**
 * Wraps a view factory as a chartered slice: a plain definition with no
 * constructor arguments whose start waits for the board. When the stage
 * publishes ViewConfigDeclared naming this slice's type, the factory runs
 * with that config — so a kit view carries no whispered options, and its
 * configuration is scrubbable history like everything else.
 *
 * The wrapper subscribes from activation and backlogs every fact it hears
 * before its charter, then replays the backlog through the view's own
 * handlers once it starts — so a chartered view misses nothing, including
 * the boot frame's SliceMounted burst its cards and consumer dots are built
 * from. The view's subscriptions register against a facade context whose
 * dispatch the wrapper owns; everything else passes through untouched.
 */
export declare const chartered: (base: Pick<SliceDefinition, "type" | "description" | "consumes" | "emits">, factory: (config: Readonly<Record<string, unknown>>) => SliceDefinition) => SliceDefinition;
