import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// ARCHIVED — unmounted since the ticket desk took r2c3 (slices/ticket-rack.ts
// is the panel now: tickets, bids, the roster, and the model settings that
// used to live here). Kept as a reference. Mount it again and it works — the mind still emits
// every fact this panel renders, and its ask files a ticket via the desk.
//
// The resident mind's panel: a third stage column (the elastic grid mints
// `r2c3` on request), showing the session as the pool told it — asks,
// what the model said, one line per tool call with its digest folded
// beneath — and a native textarea whose Enter is an AgentAskRequested
// intent. The port's resource is set from here too: the KEY field and the
// MODEL dropdown speak ModelSettingsRequested, and the panel renders the
// port's ModelSettingsDeclared answer (door, model list shelved by vendor, a
// redacted key hint) — the key itself is typed into a native password field,
// sent once, and never shown again. The dropdowns are built from buttons,
// not <select>: a native select's open list is the OS's, and the OS does not
// do brutalism; option groups are header rows between the buttons, one per
// vendor shelf the port declares. The footer is an instrument, not ambience: the session's token
// bill summed from AgentTurnEnded facts (IN | CACHED | OUT | TURNS), so the
// diet is visible. Nothing here styles anything directly from a click; the
// panel only renders facts and emits intents. Self-contained: adoptable.
export const agentConsole = defineSlice({
    type: "agent-console",
    description: "The mind's panel: asks in, the turn's facts out, the token bill.",
    consumes: [
        "AgentTurnStarted",
        "AgentSaid",
        "AgentToolCalled",
        "AgentToolReturned",
        "AgentTurnEnded",
        "ModelSettingsDeclared",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["AgentAskRequested", "ModelSettingsRequested", "ViewSlotRequested"],
    start(context) {
        const consoleStyles = `
  * { box-sizing: border-box; }
  :host { display: block; height: 100%; min-height: 0; }
  [data-agent-console] {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border: 2px solid var(--surface-600, #66300f);
    background: var(--surface-950, #1d0d05);
    color: var(--surface-200, #e8b366);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.72rem;
  }
  [data-agent-console] .plate {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex: none;
    padding: 0.4rem 0.6rem;
    border-bottom: 2px solid var(--surface-600, #66300f);
    font-size: 0.62rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] .plate .state {
    color: var(--surface-400, #a8551a);
  }
  [data-agent-console] .plate .state.working {
    color: var(--accent-consume, #ff7a2e);
  }
  [data-agent-console] .log {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.5rem 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }
  [data-agent-console] .row {
    margin: 0;
    padding: 0.35rem 0.5rem;
    border-left: 3px solid var(--surface-600, #66300f);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    line-height: 1.4;
  }
  [data-agent-console] .row .tag {
    display: block;
    margin-bottom: 0.15rem;
    font-size: 0.58rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-agent-console] .row.ask {
    border-left-color: var(--text-bright, #ffe9c2);
    color: var(--text-bright, #ffe9c2);
  }
  [data-agent-console] .row.said {
    border-left-color: var(--accent-emit, #ffb300);
    color: var(--surface-200, #e8b366);
  }
  [data-agent-console] .row.ended {
    border-left-color: var(--surface-400, #a8551a);
    color: var(--surface-400, #a8551a);
    font-size: 0.62rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  [data-agent-console] .row.ended.error {
    border-left-color: var(--accent-error, #ff2f2f);
    color: var(--accent-error, #ff2f2f);
  }
  [data-agent-console] details.tool {
    border-left: 3px solid var(--accent-consume, #ff7a2e);
    padding: 0.2rem 0.5rem;
    color: var(--surface-200, #e8b366);
  }
  [data-agent-console] details.tool.error {
    border-left-color: var(--accent-error, #ff2f2f);
  }
  [data-agent-console] details.tool summary {
    cursor: pointer;
    list-style: none;
    font-size: 0.66rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  [data-agent-console] details.tool summary::-webkit-details-marker { display: none; }
  [data-agent-console] details.tool summary::before {
    content: "> ";
    color: var(--accent-consume, #ff7a2e);
  }
  [data-agent-console] details.tool[open] summary::before { content: "v "; }
  [data-agent-console] details.tool pre {
    margin: 0.3rem 0 0.2rem;
    padding: 0.35rem 0.45rem;
    border: 1px solid var(--surface-600, #66300f);
    background: var(--surface-900, #29120a);
    color: var(--surface-200, #e8b366);
    font: inherit;
    font-size: 0.64rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 18rem;
    overflow: auto;
  }
  [data-agent-console] form {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-top: 2px solid var(--surface-600, #66300f);
  }
  [data-agent-console] .controls {
    display: flex;
    align-items: stretch;
    gap: 0.4rem;
    min-width: 0;
  }
  [data-agent-console] textarea,
  [data-agent-console] input {
    width: 100%;
    min-width: 0;
    padding: 0.4rem 0.5rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: var(--surface-900, #29120a);
    color: var(--text-bright, #ffe9c2);
    font: inherit;
    line-height: 1.4;
  }
  [data-agent-console] textarea {
    min-height: 3.6rem;
    resize: vertical;
  }
  [data-agent-console] input {
    flex: 1 1 auto;
    padding: 0.28rem 0.5rem;
    font-size: 0.66rem;
  }
  [data-agent-console] textarea:focus,
  [data-agent-console] input:focus {
    outline: none;
    border-color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] textarea::placeholder,
  [data-agent-console] input::placeholder {
    color: var(--surface-400, #a8551a);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.6rem;
  }
  [data-agent-console] button {
    padding: 0.28rem 0.55rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: none;
    color: var(--surface-200, #e8b366);
    font: inherit;
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
  }
  [data-agent-console] button[type="submit"] { margin-left: auto; }
  [data-agent-console] button:hover {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] button[hidden] { display: none; }
  /* The dropdown: a face button and a menu of buttons that opens upward
     over the log — square, bordered, no OS chrome anywhere. */
  [data-agent-console] .pick {
    position: relative;
    display: flex;
    min-width: 0;
  }
  [data-agent-console] .pick[data-grow] { flex: 1 1 0; }
  [data-agent-console] .pick-face {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-width: 0;
    text-align: left;
  }
  [data-agent-console] .pick-face .pick-label {
    flex: none;
    color: var(--surface-400, #a8551a);
  }
  [data-agent-console] .pick-face .pick-value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0.04em;
    color: var(--text-bright, #ffe9c2);
  }
  /* A square chevron: a bordered corner, rotated — pointing up when open. */
  [data-agent-console] .pick-face .pick-caret {
    flex: none;
    width: 0.4rem;
    height: 0.4rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: translateY(-0.12rem) rotate(45deg);
  }
  [data-agent-console] .pick[data-open] .pick-face,
  [data-agent-console] .pick-face:hover {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] .pick[data-open] .pick-face .pick-caret {
    transform: translateY(0.12rem) rotate(-135deg);
  }
  [data-agent-console] .pick-menu {
    position: absolute;
    left: 0;
    bottom: calc(100% + 0.25rem);
    z-index: 5;
    display: none;
    flex-direction: column;
    min-width: 100%;
    max-height: 14rem;
    overflow-y: auto;
    border: 2px solid var(--accent-emit, #ffb300);
    background: var(--surface-950, #1d0d05);
  }
  [data-agent-console] .pick[data-open] .pick-menu { display: flex; }
  [data-agent-console] .pick-menu button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.36rem 0.55rem;
    border: 0;
    border-bottom: 1px solid var(--surface-600, #66300f);
    text-align: left;
    text-transform: none;
    letter-spacing: 0.04em;
    white-space: nowrap;
    color: var(--surface-200, #e8b366);
  }
  [data-agent-console] .pick-menu button:last-child { border-bottom: 0; }
  /* The mark: a hollow square, filled on the chosen entry. */
  [data-agent-console] .pick-menu button::before {
    content: "";
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border: 2px solid var(--surface-400, #a8551a);
  }
  [data-agent-console] .pick-menu button[data-chosen]::before {
    background: var(--accent-emit, #ffb300);
    border-color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] .pick-menu button:hover {
    background: var(--surface-900, #29120a);
    color: var(--accent-emit, #ffb300);
  }
  [data-agent-console] .pick-menu button[data-chosen] {
    color: var(--text-bright, #ffe9c2);
  }
  /* An option group's header: a stencil label on its own row, ruled off
     from the shelf above by a hard 2px line — a shelf mark, not a choice. */
  [data-agent-console] .pick-menu .pick-group {
    display: block;
    padding: 0.3rem 0.55rem 0.2rem;
    border-top: 2px solid var(--surface-600, #66300f);
    border-bottom: 1px solid var(--surface-600, #66300f);
    font-size: 0.56rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
    background: var(--surface-900, #29120a);
    cursor: default;
    user-select: none;
  }
  [data-agent-console] .pick-menu .pick-group:first-child { border-top: 0; }
  [data-agent-console] .pick-menu .pick-group + button { border-top: 0; }
  [data-agent-console] .meter {
    flex: none;
    display: flex;
    gap: 0.6rem;
    padding: 0.35rem 0.6rem;
    border-top: 2px solid var(--surface-600, #66300f);
    font-size: 0.6rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-agent-console] .meter b {
    color: var(--surface-200, #e8b366);
    font-weight: 700;
  }
`;
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = consoleStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("section");
        view.dataset.agentConsole = "";
        view.innerHTML = `
      <header class="plate"><span>Mind</span><span class="state" data-state>Idle</span></header>
      <div class="log" data-log></div>
      <form data-form>
        <textarea data-ask rows="3" placeholder="Ask the resident | Enter sends, Shift+Enter breaks"></textarea>
        <div class="controls">
          <div class="pick" data-pick="model" data-grow>
            <button type="button" class="pick-face" data-face aria-haspopup="listbox">
              <span class="pick-label">Model</span><span class="pick-value" data-value>-</span><span class="pick-caret"></span>
            </button>
            <div class="pick-menu" data-menu role="listbox"></div>
          </div>
          <div class="pick" data-pick="effort">
            <button type="button" class="pick-face" data-face aria-haspopup="listbox">
              <span class="pick-label">Effort</span><span class="pick-value" data-value>default</span><span class="pick-caret"></span>
            </button>
            <div class="pick-menu" data-menu role="listbox"></div>
          </div>
          <button type="submit">Ask</button>
        </div>
        <div class="controls">
          <input type="password" data-key autocomplete="off" spellcheck="false" placeholder="Key | paste sk-ant-… or sk-or-…">
          <button type="button" data-key-set>Set</button>
          <button type="button" data-key-forget hidden>Forget</button>
        </div>
      </form>
      <footer class="meter">
        <span>In <b data-in>0</b></span>
        <span>Cached <b data-cached>0</b></span>
        <span>Out <b data-out>0</b></span>
        <span>Turns <b data-turns>0</b></span>
      </footer>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
        const log = view.querySelector("[data-log]");
        const form = view.querySelector("[data-form]");
        const ask = view.querySelector("[data-ask]");
        const keyField = view.querySelector("[data-key]");
        const keySet = view.querySelector("[data-key-set]");
        const keyForget = view.querySelector("[data-key-forget]");
        const state = view.querySelector("[data-state]");
        const meterIn = view.querySelector("[data-in]");
        const meterCached = view.querySelector("[data-cached]");
        const meterOut = view.querySelector("[data-out]");
        const meterTurns = view.querySelector("[data-turns]");
        if (!log || !form || !ask || !keyField || !keySet || !keyForget || !state || !meterIn || !meterCached || !meterOut || !meterTurns) {
            throw new Error("Agent console could not initialize its view.");
        }
        const picks = [];
        const closeAll = (except) => {
            for (const pick of picks)
                if (pick !== except)
                    pick.close();
        };
        const dropdown = (name, onChoose) => {
            const element = view.querySelector(`[data-pick="${name}"]`);
            const face = element?.querySelector("[data-face]");
            const value = element?.querySelector("[data-value]");
            const menu = element?.querySelector("[data-menu]");
            if (!element || !face || !value || !menu)
                throw new Error(`Agent console has no ${name} dropdown.`);
            const pick = {
                element,
                close: () => {
                    delete element.dataset.open;
                },
                set: (groups, chosen) => {
                    menu.replaceChildren();
                    for (const group of groups) {
                        if (group.label !== "") {
                            const header = document.createElement("span");
                            header.className = "pick-group";
                            header.setAttribute("role", "group");
                            header.setAttribute("aria-label", group.label);
                            header.dataset.group = group.label;
                            header.textContent = group.label;
                            menu.append(header);
                        }
                        for (const entry of group.entries) {
                            const item = document.createElement("button");
                            item.type = "button";
                            item.setAttribute("role", "option");
                            item.dataset.value = entry.value;
                            item.textContent = entry.label;
                            if (entry.value === chosen) {
                                item.dataset.chosen = "";
                                value.textContent = entry.label;
                            }
                            item.addEventListener("click", () => {
                                pick.close();
                                face.blur();
                                onChoose(entry.value);
                            });
                            menu.append(item);
                        }
                    }
                },
            };
            face.addEventListener("click", () => {
                const open = element.dataset.open !== undefined;
                closeAll();
                if (!open)
                    element.dataset.open = "";
            });
            picks.push(pick);
            return pick;
        };
        // A click that lands outside every dropdown closes them; the composed
        // path sees through this shadow root, so a window-level listener works.
        const onPointerDown = (event) => {
            const path = event.composedPath();
            if (picks.some((pick) => path.includes(pick.element)))
                return;
            closeAll();
        };
        const onEscape = (event) => {
            if (event.key === "Escape")
                closeAll();
        };
        window.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("keydown", onEscape);
        // The effort ladder is the ask's own knob — local, per turn, never a fact
        // until it rides AgentAskRequested.
        const EFFORTS = [
            { value: "", label: "default" },
            { value: "low", label: "low" },
            { value: "medium", label: "medium" },
            { value: "high", label: "high" },
            { value: "xhigh", label: "xhigh" },
            { value: "max", label: "max" },
        ];
        let effortValue = "";
        const effortPick = dropdown("effort", (chosen) => {
            effortValue = chosen;
            effortPick.set([{ label: "", entries: EFFORTS }], effortValue);
        });
        effortPick.set([{ label: "", entries: EFFORTS }], effortValue);
        // The model is the port's resource: choosing one is an intent, and the
        // face follows the port's declaration, not the click.
        const modelPick = dropdown("model", (chosen) => {
            context.emit("ModelSettingsRequested", { model: chosen });
        });
        // The port shelves the door's models by vendor; each shelf is an option
        // group. Ids already wear their vendor/ prefix on the OpenRouter door, so
        // the entry label is the id itself.
        context.subscribe("ModelSettingsDeclared", (fact) => {
            const { model, groups, keyHint, provider } = fact.payload;
            modelPick.set(groups.map((group) => ({
                label: group.label,
                entries: group.models.map((entry) => ({ value: entry, label: entry })),
            })), model);
            keyField.placeholder =
                keyHint === null ? "Key | paste sk-ant-… or sk-or-…" : `Key | ${keyHint} | ${provider}`;
            keyForget.hidden = keyHint === null;
        });
        // The key: typed into a native password field, sent once as an intent,
        // cleared from the field. Enter commits it here (never as an ask).
        const commitKey = () => {
            const typed = keyField.value.trim();
            if (typed === "")
                return;
            context.emit("ModelSettingsRequested", { key: typed });
            keyField.value = "";
            keyField.blur();
        };
        keySet.addEventListener("click", commitKey);
        keyForget.addEventListener("click", () => {
            context.emit("ModelSettingsRequested", { key: "" });
        });
        keyField.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commitKey();
            }
        });
        const bill = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
        let liveTurns = 0;
        const compact = (count) => count >= 10000 ? `${(count / 1000).toFixed(1)}k` : count >= 1000 ? `${(count / 1000).toFixed(2)}k` : String(count);
        const renderMeter = () => {
            meterIn.textContent = compact(bill.input + bill.cacheWrite);
            meterCached.textContent = compact(bill.cacheRead);
            meterOut.textContent = compact(bill.output);
            meterTurns.textContent = String(bill.turns);
            state.textContent = liveTurns > 0 ? "Working" : "Idle";
            state.classList.toggle("working", liveTurns > 0);
        };
        const append = (node) => {
            log.append(node);
            log.scrollTop = log.scrollHeight;
        };
        const row = (kind, tag, text) => {
            const element = document.createElement("p");
            element.className = `row ${kind}`;
            const label = document.createElement("span");
            label.className = "tag";
            label.textContent = tag;
            element.append(label, document.createTextNode(text));
            return element;
        };
        // Tool rows are keyed by toolUseId so the answer folds under the call.
        const toolRows = new Map();
        const summarize = (name, input) => {
            const short = JSON.stringify(input) ?? "";
            return `${name} ${short.length > 90 ? `${short.slice(0, 89)}…` : short}`;
        };
        const submit = () => {
            const text = ask.value.trim();
            if (text === "")
                return;
            const chosen = effortValue;
            context.emit("AgentAskRequested", chosen === "" ? { text } : { text, effort: chosen });
            ask.value = "";
        };
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            submit();
        });
        ask.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
            }
        });
        context.subscribe("AgentTurnStarted", (fact) => {
            liveTurns += 1;
            append(row("ask", fact.payload.turnId, fact.payload.text));
            renderMeter();
        });
        context.subscribe("AgentSaid", (fact) => {
            append(row("said", "said", fact.payload.text));
        });
        context.subscribe("AgentToolCalled", (fact) => {
            const details = document.createElement("details");
            details.className = "tool";
            const summary = document.createElement("summary");
            summary.textContent = summarize(fact.payload.name, fact.payload.input);
            const pre = document.createElement("pre");
            pre.textContent = "…";
            details.append(summary, pre);
            toolRows.set(fact.payload.toolUseId, details);
            append(details);
        });
        context.subscribe("AgentToolReturned", (fact) => {
            const details = toolRows.get(fact.payload.toolUseId);
            if (!details)
                return;
            const pre = details.querySelector("pre");
            if (pre)
                pre.textContent = fact.payload.text;
            const summary = details.querySelector("summary");
            if (summary) {
                const firstLine = fact.payload.text.split("\n").find((line) => line.trim() !== "" && !line.startsWith("frame ")) ?? "";
                summary.textContent = `${summary.textContent} -> ${firstLine}`;
            }
            details.classList.toggle("error", fact.payload.isError);
            toolRows.delete(fact.payload.toolUseId);
            log.scrollTop = log.scrollHeight;
        });
        context.subscribe("AgentTurnEnded", (fact) => {
            liveTurns = Math.max(0, liveTurns - 1);
            bill.turns += 1;
            bill.input += fact.payload.usage.input;
            bill.output += fact.payload.usage.output;
            bill.cacheRead += fact.payload.usage.cacheRead;
            bill.cacheWrite += fact.payload.usage.cacheWrite;
            const usage = fact.payload.usage;
            const summary = `${fact.payload.turnId} | ${fact.payload.stopReason} | in ${compact(usage.input + usage.cacheWrite)} ` +
                `cached ${compact(usage.cacheRead)} out ${compact(usage.output)}` +
                (fact.payload.error !== undefined ? ` | ${fact.payload.error}` : "");
            const line = row(fact.payload.error !== undefined ? "ended error" : "ended", "turn ended", summary);
            append(line);
            renderMeter();
        });
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
        joinStage("r2c3");
        renderMeter();
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onEscape);
            host.remove();
        };
    },
});
