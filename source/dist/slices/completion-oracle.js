import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The vocabulary owner: every event type the pool could speak, gathered
// from the firewall's SchemasDeclared (the contracted law, as facts — never
// an import), from the foundry's sketches, and from what mounted slices
// declare. It is published as a state fact (VocabularyDeclared, rule 9 —
// re-declared for late joiners and whenever it grows) so the editor can
// mark tags known or novel, and it answers CompletionRequested with prefix
// matches — autocomplete as pool traffic, one frame behind the keystroke
// like every other oracle.
//
// It is also the caret's oracle: every BufferChanged is inspected where the
// caret stands, and a completable spot becomes an unsolicited
// CompletionOffered — after `context.` the api-book's member reference
// (ApiDeclared), inside the quoted first argument of emit or subscribe the
// vocabulary itself, each type documented by its schema-book shape. The
// offer owns its selection (CompletionNavigated moves it, CompletionDismissed
// and any caret motion close it), and closing edges are published once —
// never a steady stream. The body is self-contained, so it is adoptable.
export const completionOracle = defineSlice({
    type: "completion-oracle",
    description: "Owns the vocabulary; answers prefixes and offers at the caret.",
    consumes: [
        "ApiDeclared",
        "BufferChanged",
        "BufferRestored",
        "CaretMoved",
        "CompletionDismissed",
        "CompletionNavigated",
        "CompletionRequested",
        "ContractSketched",
        "SchemasDeclared",
        "SliceMounted",
        "TimelineScrubbed",
        "VocabularyDeclared",
    ],
    emits: [
        "VocabularyDeclared",
        "CompletionSuggested",
        "CompletionOffered",
    ],
    start(context) {
        const SUGGESTION_LIMIT = 6;
        const OFFER_LIMIT = 8;
        const types = new Set();
        // The doc sources: the api-book's member reference and the schema-book's
        // shapes (an event type's doc panel IS its declared payload, rendered).
        let api = [];
        let shapes = {};
        let versions = {};
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        // An empty vocabulary is never declared — the seed arrives as the
        // firewall's SchemasDeclared within the first beats of the session.
        // Growth is never dropped by the guard: types learned in a frame that
        // has already declared leave the vocabulary dirty, and this slice's own
        // declaration — heard back one frame later, since it consumes its own
        // type — flushes it, complete. Otherwise every type the boot burst
        // taught after the first declaration would stay unpublished for the
        // session, and the editor would paint most of the registry as novel
        // (dotted).
        let declaredFrame = -1;
        let dirty = false;
        const declare = () => {
            if (types.size === 0)
                return;
            declaredFrame = context.frameNumber;
            dirty = false;
            context.emit("VocabularyDeclared", { types: [...types].sort() });
        };
        // Publish now if this frame has not, else remember to.
        const grow = () => {
            if (declaredFrame === context.frameNumber)
                dirty = true;
            else
                declare();
        };
        context.subscribe("VocabularyDeclared", (fact) => {
            if (fact.sourceSlice === context.instanceId && dirty)
                declare();
        });
        const learn = (candidates) => {
            let grew = false;
            for (const type of candidates) {
                if (type === "*" || types.has(type))
                    continue;
                types.add(type);
                grew = true;
            }
            return grew;
        };
        context.subscribe("SchemasDeclared", (fact) => {
            shapes = { ...fact.payload.shapes };
            versions = { ...fact.payload.versions };
            if (learn(fact.payload.types))
                grow();
        });
        context.subscribe("ContractSketched", (fact) => {
            if (learn(fact.payload.types))
                grow();
        });
        context.subscribe("SliceMounted", (fact) => {
            const grew = learn([...fact.payload.consumes, ...fact.payload.emits]);
            const wantsVocabulary = fact.payload.consumes.includes("VocabularyDeclared") ||
                fact.payload.consumes.includes("*");
            if (grew)
                grow();
            else if (wantsVocabulary && declaredFrame !== context.frameNumber)
                declare();
        });
        context.subscribe("CompletionRequested", (fact) => {
            const prefix = fact.payload.prefix.toLowerCase();
            const suggestions = [...types]
                .filter((type) => type.toLowerCase().startsWith(prefix))
                .sort()
                .slice(0, SUGGESTION_LIMIT);
            context.emit("CompletionSuggested", {
                field: fact.payload.field,
                prefix: fact.payload.prefix,
                suggestions,
            });
        });
        // --- The caret's offer ---
        context.subscribe("ApiDeclared", (fact) => {
            api = fact.payload.entries;
        });
        // A compact printer for the schema-book's shape grammar — signage, not
        // a type checker: two levels deep, then an honest "...".
        const renderShape = (shape, depth) => {
            if (typeof shape !== "object" || shape === null)
                return "?";
            const node = shape;
            switch (node.is) {
                case "string":
                case "number":
                case "boolean":
                case "unknown":
                    return node.is;
                case "literal":
                    return (node.oneOf ?? [])
                        .map((value) => JSON.stringify(value))
                        .join(" | ");
                case "array":
                    return `${renderShape(node.items, depth - 1)}[]`;
                case "record":
                    return `Record<string, ${renderShape(node.values, depth - 1)}>`;
                case "nullable":
                    return `${renderShape(node.inner, depth - 1)} | null`;
                case "choice": {
                    const variants = Object.keys(node.variants ?? {});
                    return `{ ${String(node.key)}: ${variants
                        .map((variant) => JSON.stringify(variant))
                        .join(" | ")}, ... }`;
                }
                case "object": {
                    const fields = node.fields ?? {};
                    const optional = new Set(node.optional ?? []);
                    const names = Object.keys(fields);
                    if (names.length === 0)
                        return "{}";
                    if (depth <= 0)
                        return "{ ... }";
                    return `{ ${names
                        .map((name) => `${name}${optional.has(name) ? "?" : ""}: ${renderShape(fields[name], depth - 1)}`)
                        .join(", ")} }`;
                }
                default:
                    return "?";
            }
        };
        // An event type's popup docs: the payload's fields one per line, or the
        // sketch disclaimer for types the law has no entry for yet.
        const typeItem = (type) => {
            const shape = shapes[type];
            if (shape === undefined) {
                return {
                    label: type,
                    signature: `${type} (sketched)`,
                    doc: "No declared shape yet — the firewall passes it shape-free until it graduates.",
                };
            }
            const node = shape;
            const version = versions[type];
            const signature = `${type} (schema v${version ?? "?"})`;
            if (node.is === "object") {
                const fields = node.fields ?? {};
                const optional = new Set(node.optional ?? []);
                const names = Object.keys(fields);
                if (names.length === 0)
                    return { label: type, signature, doc: "No payload fields." };
                const lines = names.map((name) => `${name}${optional.has(name) ? "?" : ""}: ${renderShape(fields[name], 1)}`);
                return { label: type, signature, doc: lines.join("\n") };
            }
            return { label: type, signature, doc: renderShape(shape, 2) };
        };
        // Where the caret can complete: a member being typed after `context.`,
        // an event type being typed inside the quoted first argument of emit or
        // subscribe. Signage-grade scanning — comments are not excluded.
        const MEMBER_CONTEXT = /(^|[^\w$.])context\.([A-Za-z_$][\w$]*)?$/;
        const TYPE_CONTEXT = /\b(?:emit|subscribe)\s*\(\s*["']([\w-]*)$/;
        let offer = null;
        // The closing edge is one empty-items fact, published only when an
        // offer was live — dismissal is signage, never a steady stream.
        const publish = (next) => {
            const previous = offer;
            offer = next;
            if (next !== null) {
                context.emit("CompletionOffered", next);
            }
            else if (previous !== null) {
                context.emit("CompletionOffered", {
                    revision: previous.revision,
                    from: previous.to,
                    to: previous.to,
                    items: [],
                    selected: 0,
                });
            }
        };
        const offerAt = (payload) => {
            if (payload.anchor !== null)
                return null;
            const line = payload.lines[payload.caret.line] ?? "";
            const head = line.slice(0, payload.caret.column);
            let prefix = null;
            let items = [];
            const member = MEMBER_CONTEXT.exec(head);
            const typed = member === null ? TYPE_CONTEXT.exec(head) : null;
            if (member !== null) {
                prefix = member[2] ?? "";
                const wanted = prefix.toLowerCase();
                items = api
                    .filter((entry) => entry.name.toLowerCase().startsWith(wanted))
                    .map((entry) => ({
                    label: entry.name,
                    signature: entry.signature,
                    doc: entry.doc,
                }));
            }
            else if (typed !== null) {
                prefix = typed[1];
                const wanted = prefix.toLowerCase();
                items = [...types]
                    .filter((type) => type.toLowerCase().startsWith(wanted))
                    .sort()
                    .slice(0, OFFER_LIMIT)
                    .map(typeItem);
            }
            if (prefix === null || items.length === 0)
                return null;
            // An already-complete word is not an offer.
            if (items.length === 1 && items[0].label === prefix)
                return null;
            return {
                revision: payload.revision,
                from: {
                    line: payload.caret.line,
                    column: payload.caret.column - prefix.length,
                },
                to: { line: payload.caret.line, column: payload.caret.column },
                items,
                selected: 0,
            };
        };
        context.subscribe("BufferChanged", (fact) => publish(offerAt(fact.payload)));
        // Caret motion, time travel, and Escape all close the offer; the next
        // change re-offers. Restores never re-open it — a parked view offering
        // completions would be typing advice from the past.
        context.subscribe("CaretMoved", () => publish(null));
        context.subscribe("BufferRestored", () => publish(null));
        context.subscribe("TimelineScrubbed", () => publish(null));
        context.subscribe("CompletionDismissed", () => publish(null));
        context.subscribe("CompletionNavigated", (fact) => {
            if (offer === null)
                return;
            const count = offer.items.length;
            const step = fact.payload.direction === "down" ? 1 : -1;
            publish({
                ...offer,
                selected: (offer.selected + step + count) % count,
            });
        });
    },
});
