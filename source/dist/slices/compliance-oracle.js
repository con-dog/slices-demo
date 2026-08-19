import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The live linter: it knows no rule of its own. The law arrives as
// LintRulesDeclared facts (patterns are RegExp sources), the document arrives
// as buffer facts, and findings leave as DiagnosticsPublished — the whole
// compliance check is scrubbable pool traffic.
export const complianceOracle = defineSlice({
    type: "compliance-oracle",
    description: "Checks the document against the declared rules; findings are facts.",
    consumes: ["LintRulesDeclared", "BufferChanged", "BufferRestored"],
    emits: ["DiagnosticsPublished"],
    start(context) {
        let compiled = [];
        let lines = null;
        let revision = 0;
        let subjectType = "";
        const scan = () => {
            // Wait for both halves: the law (rules) and the subject (text). Both
            // can land in the same frame in either order; whichever arrives second
            // triggers the first real scan.
            if (lines === null || compiled.length === 0)
                return;
            const diagnostics = [];
            // A rule that exempts this document's type does not bind it.
            const binding = compiled.filter(({ rule }) => !(rule.exempt ?? []).includes(subjectType));
            for (const [lineIndex, line] of lines.entries()) {
                for (const { rule, regex } of binding) {
                    const match = regex.exec(line);
                    if (match === null)
                        continue;
                    diagnostics.push({
                        ruleId: rule.id,
                        line: lineIndex,
                        column: match.index,
                        length: Math.max(match[0].length, 1),
                        message: rule.message,
                    });
                }
            }
            context.emit("DiagnosticsPublished", { revision, diagnostics });
        };
        context.subscribe("LintRulesDeclared", (fact) => {
            compiled = fact.payload.rules.flatMap((rule) => {
                try {
                    return [{ rule, regex: new RegExp(rule.pattern) }];
                }
                catch {
                    // An uncompilable pattern is the rule-book's bug, not a crash here.
                    return [];
                }
            });
            scan();
        });
        const onDocument = (payload) => {
            lines = payload.lines;
            revision = payload.revision;
            subjectType = payload.meta.type;
            scan();
        };
        context.subscribe("BufferChanged", (fact) => onDocument(fact.payload));
        context.subscribe("BufferRestored", (fact) => onDocument(fact.payload));
    },
});
