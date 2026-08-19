import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// A deliberately small JavaScript tokenizer: enough to paint keywords,
// strings, comments, and numbers. It carries block-comment and template-
// string state across lines, and nothing else — this is signage, not a
// parser. Painting arrives one frame after the text (the renderer paints
// plain first), which is the architecture being honest, not a bug.
//
// The body is self-contained (no module-scope references): this slice is
// adoptable — its mounted source is its document, and the first edit hands
// the instance to the foundry.
export const syntaxOracle = defineSlice({
    type: "syntax-oracle",
    description: "Tokenizes the document; painting travels as TokensMapped facts.",
    consumes: ["BufferChanged", "BufferRestored"],
    emits: ["TokensMapped"],
    start(context) {
        const KEYWORDS = new Set([
            "async", "await", "break", "case", "catch", "class", "const", "continue",
            "default", "delete", "do", "else", "export", "extends", "false", "finally",
            "for", "from", "function", "get", "if", "import", "in", "instanceof", "let",
            "new", "null", "of", "return", "set", "static", "switch", "this", "throw",
            "true", "try", "typeof", "undefined", "var", "void", "while", "yield",
        ]);
        const isIdentStart = (ch) => /[A-Za-z_$]/.test(ch);
        const isIdentPart = (ch) => /[\w$]/.test(ch);
        const isDigit = (ch) => ch >= "0" && ch <= "9";
        const tokenize = (lines) => {
            const lineTokens = [];
            // Multi-line carries: inside /* ... */ or inside `...`.
            let inBlockComment = false;
            let inTemplate = false;
            for (const line of lines) {
                const spans = [];
                let at = 0;
                const push = (start, end, kind) => {
                    if (end > start)
                        spans.push({ start, length: end - start, kind });
                };
                while (at < line.length) {
                    if (inBlockComment) {
                        const close = line.indexOf("*/", at);
                        const end = close === -1 ? line.length : close + 2;
                        push(at, end, "comment");
                        inBlockComment = close === -1;
                        at = end;
                        continue;
                    }
                    if (inTemplate) {
                        let end = at;
                        while (end < line.length && line[end] !== "`") {
                            end += line[end] === "\\" ? 2 : 1;
                        }
                        const closed = end < line.length;
                        push(at, closed ? end + 1 : line.length, "string");
                        inTemplate = !closed;
                        at = closed ? end + 1 : line.length;
                        continue;
                    }
                    const ch = line[at];
                    if (ch === " " || ch === "\t") {
                        at += 1;
                    }
                    else if (ch === "/" && line[at + 1] === "/") {
                        push(at, line.length, "comment");
                        at = line.length;
                    }
                    else if (ch === "/" && line[at + 1] === "*") {
                        const close = line.indexOf("*/", at + 2);
                        const end = close === -1 ? line.length : close + 2;
                        push(at, end, "comment");
                        inBlockComment = close === -1;
                        at = end;
                    }
                    else if (ch === '"' || ch === "'") {
                        let end = at + 1;
                        while (end < line.length && line[end] !== ch) {
                            end += line[end] === "\\" ? 2 : 1;
                        }
                        push(at, Math.min(end + 1, line.length), "string");
                        at = Math.min(end + 1, line.length);
                    }
                    else if (ch === "`") {
                        inTemplate = true;
                        push(at, at + 1, "string");
                        at += 1;
                    }
                    else if (isDigit(ch)) {
                        let end = at + 1;
                        while (end < line.length && /[\w.]/.test(line[end]))
                            end += 1;
                        push(at, end, "number");
                        at = end;
                    }
                    else if (isIdentStart(ch)) {
                        let end = at + 1;
                        while (end < line.length && isIdentPart(line[end]))
                            end += 1;
                        const word = line.slice(at, end);
                        if (KEYWORDS.has(word))
                            push(at, end, "keyword");
                        at = end;
                    }
                    else {
                        push(at, at + 1, "punct");
                        at += 1;
                    }
                }
                lineTokens.push(spans);
            }
            return lineTokens;
        };
        const paint = (payload) => context.emit("TokensMapped", {
            revision: payload.revision,
            lineTokens: tokenize(payload.lines),
        });
        context.subscribe("BufferChanged", (fact) => paint(fact.payload));
        context.subscribe("BufferRestored", (fact) => paint(fact.payload));
    },
});
