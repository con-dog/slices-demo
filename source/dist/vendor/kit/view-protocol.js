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
export const chartered = (base, factory) => ({
    ...base,
    start(context) {
        // kit: chartered wrapper — this body closes over the kit's view factory
        // and cannot start as written; an edit here is a verdict until the body
        // is rewritten self-contained. The line is real source (the pool stamps
        // start.toString() into SliceMounted; the type aliases above erase, so
        // this comment heads the running body), and the opened document says so
        // itself while the agent-port's outline marks the slice `kit`.
        const backlog = [];
        const handlers = [];
        let cleanup;
        let started = false;
        const dispatch = (fact) => {
            for (const entry of [...handlers]) {
                if (entry.type === "*" || entry.type === fact.type)
                    entry.handler(fact);
            }
        };
        const innerContext = {
            instanceId: context.instanceId,
            sliceType: context.sliceType,
            get frameNumber() {
                return context.frameNumber;
            },
            subscribe: (type, handler) => {
                const entry = { type, handler };
                handlers.push(entry);
                return () => {
                    const at = handlers.indexOf(entry);
                    if (at !== -1)
                        handlers.splice(at, 1);
                };
            },
            emit: context.emit,
            mountSlice: context.mountSlice,
            unmountSlice: context.unmountSlice,
        };
        context.subscribe("*", (fact) => {
            if (started) {
                dispatch(fact);
                return;
            }
            if (fact.type === "ViewConfigDeclared") {
                const payload = fact.payload;
                if (payload.view === base.type) {
                    started = true;
                    const inner = factory(payload.config).start(innerContext);
                    if (typeof inner === "function")
                        cleanup = inner;
                    for (const past of backlog)
                        dispatch(past);
                    backlog.length = 0;
                    return;
                }
            }
            backlog.push(fact);
        });
        return () => cleanup?.();
    },
});
