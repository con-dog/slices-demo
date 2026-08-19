import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// A state slice (rules 8 + 9) with one piece of state that never changes at
// runtime: the compliance vocabulary. It re-declares for late joiners the
// same way the stage re-declares its slots. The body is self-contained (no
// module-scope references), so this slice is adoptable: edit its document
// and the law itself hot-reloads.
export const ruleBook = defineSlice({
    type: "rule-book",
    description: "Publishes the design law as data: compliance rules as facts.",
    consumes: ["SliceMounted"],
    emits: ["LintRulesDeclared"],
    start(context) {
        // The design law as data. Slices may import only their contracts, so
        // the compliance rules cannot be imported from slices.config.mjs — they
        // are published as facts instead, and the compliance oracle compiles
        // them. The pattern spellings below are regex-equivalent to the build
        // lint's but deliberately not byte-equal (a character class here, an
        // escape there): slices-lint greps slice SOURCES for its patterns, and
        // this file must not trip the very law it declares. `exempt` mirrors the
        // build lint's exemptFiles: placement and page chrome are the stage's
        // monopoly, so its own document does not trip the placement rules.
        const RULES = [
            {
                id: "no-middle-dot",
                pattern: "\\u00b7",
                message: "the Unicode middle dot is banned (separators are pipes)",
            },
            {
                id: "no-rounded-corners",
                pattern: "border-radius\\s*:(?!\\s*0[;\\s])",
                message: "non-zero border-radius (brutalist law: no rounded corners)",
            },
            {
                id: "no-grid-placement",
                pattern: "\\bgrid-(?:row|column|area)\\s*:",
                message: "grid placement (request a slot from the stage instead)",
                exempt: ["stage"],
            },
            {
                id: "no-viewport-position",
                pattern: "\\bposition\\s*:\\s*(?:fixed|sticky)\\b",
                message: "viewport positioning (request a slot from the stage instead)",
                exempt: ["stage"],
            },
            {
                id: "no-document-head",
                pattern: "\\bdocument\\s*\\.\\s*head\\b",
                message: "touches document head (styles live in the slice's shadow root)",
                exempt: ["stage"],
            },
            {
                id: "no-page-measure",
                pattern: "\\bgetComputed[S]tyle\\s*\\(\\s*document\\s*\\.\\s*(?:body|documentElement)\\b",
                message: "measures the page's own layout (read the stage's tokens and the grant's grid — layout is facts)",
                exempt: ["stage"],
            },
            {
                id: "no-body-styles",
                pattern: "(?:^|[^-\\w])body\\s*\\{",
                message: "styles body (page chrome belongs to the stage slice)",
                exempt: ["stage"],
            },
            {
                id: "no-root-styles",
                pattern: ":r[o]ot\\b",
                message: "styles the root (shared tokens belong to the stage slice)",
                exempt: ["stage"],
            },
        ];
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            context.emit("LintRulesDeclared", { rules: RULES });
        };
        declare();
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("LintRulesDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
    },
});
