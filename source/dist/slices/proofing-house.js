import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The assay office. The foundry autosaves every committed edit, so by the
// time it judges a document the document is already on the board — a machine
// author writing blind learns of a broken body only after the save. This
// slice is the pre-flight: ProofRequested carries a CANDIDATE document, and
// the answer says what the foundry would say — without mounting, without
// running, without touching the buffer. It assembles the foundry's own
// wrapper (rule 6: deliberately duplicated from foundry.ts, drift the
// maintainer's job), compiles it with a capturing definer, checks the
// definition's shape against the same limits, and runs the rule-book's
// compliance law over the candidate lines.
//
// Compile and shape and lint, NEVER execution: start is not called, so a
// body that dies at runtime is still the foundry's verdict to catch — the
// assay proves the metal, not the machine. The body is self-contained, so
// this slice is adoptable.
export const proofingHouse = defineSlice({
    type: "proofing-house",
    description: "Pre-flight assay: compiles and lints a candidate doc without mounting.",
    consumes: ["ProofRequested", "LintRulesDeclared", "SchemasDeclared"],
    emits: ["ProofReturned"],
    start(context) {
        const DESCRIPTION_LIMIT = 80;
        // The compliance law and the contracted types, learned as facts.
        let rules = [];
        let contracted = new Set();
        context.subscribe("LintRulesDeclared", (fact) => {
            rules = fact.payload.rules.map((rule) => ({ ...rule }));
        });
        context.subscribe("SchemasDeclared", (fact) => {
            contracted = new Set(fact.payload.types);
        });
        context.subscribe("ProofRequested", (fact) => {
            const { proofId, meta, lines } = fact.payload;
            const verdicts = [];
            // --- Shape: what the foundry's assertMountable would refuse. ---
            if (typeof meta.type !== "string" || meta.type.length === 0) {
                verdicts.push({ kind: "shape", message: 'The document needs a non-empty "type".' });
            }
            const isEventList = (list) => Array.isArray(list) && list.every((entry) => typeof entry === "string");
            if (!isEventList(meta.consumes) || !isEventList(meta.emits)) {
                verdicts.push({
                    kind: "shape",
                    message: "consumes and emits must be string arrays.",
                });
            }
            if (typeof meta.description === "string" &&
                meta.description.length > DESCRIPTION_LIMIT) {
                verdicts.push({
                    kind: "shape",
                    message: `description is over ${DESCRIPTION_LIMIT} chars.`,
                });
            }
            // --- Compile: the foundry's wrapper, built but never started. ---
            try {
                const assembled = [
                    "defineSlice({",
                    `  type: ${JSON.stringify(meta.type)},`,
                    `  description: ${JSON.stringify(meta.description)},`,
                    `  consumes: ${JSON.stringify(meta.consumes)},`,
                    `  emits: ${JSON.stringify(meta.emits)},`,
                    "  start(context) {",
                    "    try {",
                    lines.join("\n"),
                    "    } catch (error) {",
                    "      reportStartFailure(error);",
                    "    }",
                    "  },",
                    "});",
                ].join("\n");
                const captured = [];
                const capture = (definition) => {
                    captured.push(definition);
                    return definition;
                };
                const factory = new Function("defineSlice", "reportStartFailure", `"use strict";\n${assembled}`);
                factory(capture, () => { });
                const definition = captured[0];
                if (definition === undefined || typeof definition.start !== "function") {
                    verdicts.push({ kind: "compile", message: "The body did not assemble into a definition." });
                }
            }
            catch (error) {
                verdicts.push({
                    kind: "compile",
                    message: error instanceof Error ? error.message : String(error),
                });
            }
            // --- Lint: the rule-book's law over the candidate's own lines. ---
            for (const rule of rules) {
                if ((rule.exempt ?? []).includes(meta.type))
                    continue;
                let pattern;
                try {
                    pattern = new RegExp(rule.pattern);
                }
                catch {
                    continue;
                }
                lines.forEach((line, at) => {
                    if (pattern.test(line)) {
                        verdicts.push({
                            kind: "lint",
                            message: `${rule.id} | ${rule.message}`,
                            line: at,
                        });
                    }
                });
            }
            // --- The open vocabulary: which of its words the law has no shape for.
            const sketched = [...new Set([...meta.consumes, ...meta.emits])].filter((type) => type !== "*" && !contracted.has(type));
            context.emit("ProofReturned", {
                proofId,
                ok: verdicts.length === 0,
                verdicts,
                sketched,
            });
        });
    },
});
