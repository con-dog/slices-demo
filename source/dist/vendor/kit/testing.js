import { sliceDefinerFor } from "./pool.js";
/**
 * Frame bookkeeping for tests. Mounts a wildcard recorder slice into the
 * pool (call this before the first advanceFrame so nothing is missed) and
 * drives the pool by expectation instead of by counted frames.
 */
export function trackFrames(pool) {
    const frames = [];
    const defineSlice = sliceDefinerFor();
    pool.mount(defineSlice({
        type: "frame-timeline",
        description: "Test recorder: keeps every delivered fact, per frame.",
        consumes: ["*"],
        emits: [],
        start(context) {
            context.subscribe("*", (fact) => {
                const last = frames[frames.length - 1];
                if (last && last.frame === fact.frame)
                    last.facts.push(fact);
                else
                    frames.push({ frame: fact.frame, facts: [fact] });
            });
        },
    }), { instanceId: "frame-timeline#1" });
    const describe = () => frames.length === 0
        ? "  (no facts delivered)"
        : frames
            .map((record) => `  frame ${record.frame}: ${record.facts
            .map((fact) => `${fact.sourceSlice} → ${fact.type}`)
            .join(" | ")}`)
            .join("\n");
    function delivered(type, where) {
        return frames.flatMap((record) => record.facts.filter((fact) => fact.type === type && (!where || where(fact))));
    }
    function advanceUntil(type, options = {}) {
        const { where, maxFrames = 16 } = options;
        for (let step = 0; step < maxFrames; step += 1) {
            pool.advanceFrame();
            const record = frames[frames.length - 1];
            if (!record || record.frame !== pool.getFrameNumber())
                continue;
            const found = record.facts.find((fact) => fact.type === type && (!where || where(fact)));
            if (found)
                return found;
        }
        const wanted = where ? `${type} fact matching the predicate` : `${type} fact`;
        throw new Error(`No ${wanted} within ${maxFrames} frames. Timeline:\n${describe()}`);
    }
    return {
        frames,
        advance(count = 1) {
            for (let step = 0; step < count; step += 1)
                pool.advanceFrame();
        },
        advanceUntil: advanceUntil,
        delivered: delivered,
        expectNone(type, message) {
            const offenders = delivered(type);
            if (offenders.length === 0)
                return;
            const label = message ?? `Expected no ${type} facts`;
            throw new Error(`${label}; found ${offenders.length}. Timeline:\n${describe()}`);
        },
        describe,
    };
}
