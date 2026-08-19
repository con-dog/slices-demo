import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The rack: the desk's ledger with a face, in the third stage column (the
// grid mints `r2c3` on request). Top: the roster — one row per
// mind as it declared itself (specialty, tags, base bid, IDLE or WORKING
// t-N). Middle: TODO | DOING | DONE as a ratcheted marquee — one lane on
// show at a time, prev/next blocks stepping one lane, the visualizer's own
// idiom — each ticket a chip in the pool's chip
// grammar — id, text, tags, who holds it — with the desk's own signage
// (BIDDING, NO TAKERS, PARKED, WORKING, the outcome) and two buttons at most:
// RESUME|OPEN (TicketResumeRequested) and X (TicketClosed by a human). A
// click on the chip itself is FactSelected on the ticket's filing fact, so
// the causality inspector traces the whole job from there — the chat log
// this rack replaces is the causal tree; a working chip shows only the tool
// calls in flight (count, the last one, errors), never a transcript. Bottom: the file form (a text
// area — words plus #tags, Enter files, Shift+Enter breaks a line), the
// MODEL and EFFORT dropdowns side by side, the model-port's KEY controls
// (moved here from the archived console — same facts), and the session's
// token bill. Nothing
// here styles anything from a click; the rack renders facts and emits
// intents. Self-contained: adoptable.
export const ticketRack = defineSlice({
    type: "ticket-rack",
    description: "The desk's face: roster, TODO | DOING | DONE, file form, model settings.",
    consumes: [
        "TicketsDeclared",
        "MindDeclared",
        "SliceUnmounted",
        "AgentToolCalled",
        "AgentToolReturned",
        "AgentTurnEnded",
        "ModelSettingsDeclared",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: [
        "TicketFiled",
        "TicketResumeRequested",
        "TicketClosed",
        "FactSelected",
        "ModelSettingsRequested",
        "ViewSlotRequested",
    ],
    start(context) {
        const TEXT_WIDTH = 72;
        const rackStyles = `
  * { box-sizing: border-box; }
  :host { display: block; height: 100%; min-height: 0; }
  [data-ticket-rack] {
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
  [data-ticket-rack] .plate {
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
  [data-ticket-rack] .plate b { color: var(--text-bright, #ffe9c2); }
  [data-ticket-rack] .plate .state { color: var(--surface-400, #a8551a); }
  [data-ticket-rack] .plate .state.replaying { color: var(--accent-consume, #ff7a2e); }
  /* The roster: one row per declared mind, a stencil ledger. */
  [data-ticket-rack] .roster {
    flex: none;
    display: flex;
    flex-direction: column;
    max-height: 7rem;
    overflow-y: auto;
    border-bottom: 2px solid var(--surface-600, #66300f);
  }
  [data-ticket-rack] .mind {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.28rem 0.6rem;
    border-bottom: 1px solid var(--surface-600, #66300f);
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    white-space: nowrap;
    overflow: hidden;
  }
  [data-ticket-rack] .mind:last-child { border-bottom: 0; }
  [data-ticket-rack] .mind .id { color: var(--text-bright, #ffe9c2); font-weight: 700; }
  [data-ticket-rack] .mind .spec { color: var(--surface-200, #e8b366); text-transform: uppercase; }
  [data-ticket-rack] .mind .rule { color: var(--surface-400, #a8551a); overflow: hidden; text-overflow: ellipsis; }
  [data-ticket-rack] .mind .st {
    margin-left: auto;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .mind .st.working { color: var(--accent-consume, #ff7a2e); }
  [data-ticket-rack] .roster .empty {
    padding: 0.35rem 0.6rem;
    font-size: 0.6rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  /* The lanes are a ratcheted marquee (the visualizer's idiom): one lane
     on show between a prev and a next block, each press one whole lane,
     never a scroll. The hidden lanes keep their chips and counts. */
  [data-ticket-rack] .columns {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr) 2rem;
  }
  [data-ticket-rack] .lane-nav {
    padding: 0;
    border: 0;
    border-right: 2px solid var(--surface-600, #66300f);
    background: var(--surface-900, #29120a);
    color: var(--surface-200, #e8b366);
    font-size: 0.8rem;
  }
  [data-ticket-rack] .lane-nav[data-lane-next] {
    border-right: 0;
    border-left: 2px solid var(--surface-600, #66300f);
  }
  [data-ticket-rack] .lane-nav:hover:not(:disabled) {
    border-color: var(--surface-600, #66300f);
    color: var(--accent-consume, #ff7a2e);
  }
  [data-ticket-rack] .lane-nav:disabled { opacity: 0.35; cursor: default; }
  [data-ticket-rack] .column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  [data-ticket-rack] .column[hidden] { display: none; }
  [data-ticket-rack] .column h3 {
    flex: none;
    margin: 0;
    padding: 0.3rem 0.5rem;
    border-bottom: 1px solid var(--surface-600, #66300f);
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .column h3 b { color: var(--surface-200, #e8b366); }
  /* Which lane of how many — the marquee's own readout, right-aligned. */
  [data-ticket-rack] .column h3 .lane-at {
    float: right;
    color: var(--surface-400, #a8551a);
    letter-spacing: 0.1em;
  }
  [data-ticket-rack] .chips {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.4rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  /* rule-6 twin of the kit visualizer's .fact-chip: same border, surface,
     and text colour — a ticket is a fact with a face, so it wears the chip. */
  [data-ticket-rack] .ticket {
    display: flex;
    flex-direction: column;
    gap: 0.22rem;
    padding: 0.28rem 0.38rem;
    border: 1px solid var(--accent-consume, #ff7a2e);
    background: var(--chip-surface, rgb(29 13 5 / 0.82));
    color: var(--text-bright, #ffe9c2);
    font-size: 0.6rem;
    cursor: pointer;
  }
  [data-ticket-rack] .ticket:hover { border-color: var(--accent-emit, #ffb300); }
  [data-ticket-rack] .ticket[data-working] {
    border-color: var(--accent-emit, #ffb300);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent-emit, #ffb300) 55%, transparent);
  }
  [data-ticket-rack] .ticket[data-state="done"] { opacity: 0.6; }
  [data-ticket-rack] .ticket[data-state="done"]:hover { opacity: 1; }
  [data-ticket-rack] .ticket .head {
    display: flex;
    align-items: baseline;
    gap: 0.4rem;
    min-width: 0;
  }
  [data-ticket-rack] .ticket .tid {
    flex: none;
    color: var(--accent-emit, #ffb300);
    font-weight: 700;
    letter-spacing: 0.08em;
  }
  [data-ticket-rack] .ticket .text {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--text-bright, #ffe9c2);
  }
  [data-ticket-rack] .ticket .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.54rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .ticket .tag {
    padding: 0 0.25rem;
    border: 1px solid var(--surface-600, #66300f);
    color: var(--surface-200, #e8b366);
    text-transform: none;
    letter-spacing: 0.04em;
  }
  [data-ticket-rack] .ticket .to { color: var(--surface-200, #e8b366); text-transform: none; letter-spacing: 0.04em; }
  [data-ticket-rack] .ticket .flag { color: var(--accent-consume, #ff7a2e); }
  [data-ticket-rack] .ticket .flag.dim { color: var(--surface-400, #a8551a); }
  [data-ticket-rack] .ticket .flag.err { color: var(--accent-error, #ff2f2f); }
  [data-ticket-rack] .ticket .actions {
    display: flex;
    gap: 0.3rem;
    margin-left: auto;
  }
  [data-ticket-rack] .ticket .actions button {
    padding: 0.05rem 0.35rem;
    font-size: 0.54rem;
  }
  [data-ticket-rack] .ticket details.notes {
    font-size: 0.56rem;
    color: var(--surface-200, #e8b366);
  }
  [data-ticket-rack] .ticket details.notes summary {
    cursor: pointer;
    list-style: none;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .ticket details.notes summary::-webkit-details-marker { display: none; }
  [data-ticket-rack] .ticket details.notes summary::before { content: "> "; color: var(--accent-consume, #ff7a2e); }
  [data-ticket-rack] .ticket details.notes[open] summary::before { content: "v "; }
  [data-ticket-rack] .ticket details.notes p {
    margin: 0.15rem 0 0;
    padding-left: 0.4rem;
    border-left: 2px solid var(--surface-600, #66300f);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  [data-ticket-rack] .ticket details.notes p b { color: var(--surface-400, #a8551a); font-weight: 400; }
  [data-ticket-rack] form {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.5rem 0.6rem;
    border-top: 2px solid var(--surface-600, #66300f);
  }
  [data-ticket-rack] .controls {
    display: flex;
    align-items: stretch;
    gap: 0.4rem;
    min-width: 0;
  }
  [data-ticket-rack] input,
  [data-ticket-rack] textarea {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    padding: 0.28rem 0.5rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: var(--surface-900, #29120a);
    color: var(--text-bright, #ffe9c2);
    font: inherit;
    font-size: 0.66rem;
    line-height: 1.4;
  }
  /* The filing is a text area: a ticket may run to a few lines. Enter files,
     Shift+Enter breaks a line; no drag handle, no rounding. */
  [data-ticket-rack] textarea {
    min-height: 3.2rem;
    resize: none;
    scrollbar-width: thin;
    scrollbar-color: var(--surface-600, #66300f) transparent;
  }
  [data-ticket-rack] input:focus,
  [data-ticket-rack] textarea:focus {
    outline: none;
    border-color: var(--accent-emit, #ffb300);
  }
  [data-ticket-rack] input::placeholder,
  [data-ticket-rack] textarea::placeholder {
    color: var(--surface-400, #a8551a);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.6rem;
  }
  /* FILE stands beside the text area, top-aligned with its first line. */
  [data-ticket-rack] .controls.filing { align-items: flex-start; }
  [data-ticket-rack] .controls.filing button { align-self: stretch; }
  [data-ticket-rack] button {
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
  [data-ticket-rack] button:hover {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-ticket-rack] button[hidden] { display: none; }
  /* The dropdown: a face button and a menu of buttons that opens upward
     over the columns — square, bordered, no OS chrome anywhere. */
  [data-ticket-rack] .pick {
    position: relative;
    display: flex;
    min-width: 0;
  }
  [data-ticket-rack] .pick[data-grow] { flex: 1 1 0; }
  [data-ticket-rack] .pick-face {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-width: 0;
    text-align: left;
  }
  [data-ticket-rack] .pick-face .pick-label {
    flex: none;
    color: var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .pick-face .pick-value {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: none;
    letter-spacing: 0.04em;
    color: var(--text-bright, #ffe9c2);
  }
  /* A square chevron: a bordered corner, rotated — pointing up when open. */
  [data-ticket-rack] .pick-face .pick-caret {
    flex: none;
    width: 0.4rem;
    height: 0.4rem;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: translateY(-0.12rem) rotate(45deg);
  }
  [data-ticket-rack] .pick[data-open] .pick-face,
  [data-ticket-rack] .pick-face:hover {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-ticket-rack] .pick[data-open] .pick-face .pick-caret {
    transform: translateY(0.12rem) rotate(-135deg);
  }
  [data-ticket-rack] .pick-menu {
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
  [data-ticket-rack] .pick[data-open] .pick-menu { display: flex; }
  [data-ticket-rack] .pick-menu button {
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
  [data-ticket-rack] .pick-menu button:last-child { border-bottom: 0; }
  /* The mark: a hollow square, filled on the chosen entry. */
  [data-ticket-rack] .pick-menu button::before {
    content: "";
    flex: none;
    width: 0.5rem;
    height: 0.5rem;
    border: 2px solid var(--surface-400, #a8551a);
  }
  [data-ticket-rack] .pick-menu button[data-chosen]::before {
    background: var(--accent-emit, #ffb300);
    border-color: var(--accent-emit, #ffb300);
  }
  [data-ticket-rack] .pick-menu button:hover {
    background: var(--surface-900, #29120a);
    color: var(--accent-emit, #ffb300);
  }
  [data-ticket-rack] .pick-menu button[data-chosen] {
    color: var(--text-bright, #ffe9c2);
  }
  /* An option group's header: a stencil label on its own row, ruled off
     from the shelf above by a hard 2px line — a shelf mark, not a choice. */
  [data-ticket-rack] .pick-menu .pick-group {
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
  [data-ticket-rack] .pick-menu .pick-group:first-child { border-top: 0; }
  [data-ticket-rack] .pick-menu .pick-group + button { border-top: 0; }
  [data-ticket-rack] .meter {
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
  [data-ticket-rack] .meter b {
    color: var(--surface-200, #e8b366);
    font-weight: 700;
  }
`;
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = rackStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("section");
        view.dataset.ticketRack = "";
        view.innerHTML = `
      <header class="plate"><span>Tickets | <b data-open>0</b> open</span><span class="state" data-state>Live</span></header>
      <div class="roster" data-roster></div>
      <div class="columns">
        <button type="button" class="lane-nav" data-lane-prev aria-label="Previous lane">◀</button>
        <div class="column" data-lane="todo"><h3>Todo <b data-count="todo">0</b><span class="lane-at">1 | 3</span></h3><div class="chips" data-chips="todo"></div></div>
        <div class="column" data-lane="doing" hidden><h3>Doing <b data-count="doing">0</b><span class="lane-at">2 | 3</span></h3><div class="chips" data-chips="doing"></div></div>
        <div class="column" data-lane="done" hidden><h3>Done <b data-count="done">0</b><span class="lane-at">3 | 3</span></h3><div class="chips" data-chips="done"></div></div>
        <button type="button" class="lane-nav" data-lane-next aria-label="Next lane">▶</button>
      </div>
      <form data-form>
        <div class="controls filing">
          <textarea data-file rows="2" autocomplete="off" spellcheck="false" placeholder="File a ticket | words #tag #tag | Enter files | Shift+Enter breaks a line"></textarea>
          <button type="submit">File</button>
        </div>
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
        const roster = view.querySelector("[data-roster]");
        const form = view.querySelector("[data-form]");
        const fileField = view.querySelector("[data-file]");
        const lanePrev = view.querySelector("[data-lane-prev]");
        const laneNext = view.querySelector("[data-lane-next]");
        const keyField = view.querySelector("[data-key]");
        const keySet = view.querySelector("[data-key-set]");
        const keyForget = view.querySelector("[data-key-forget]");
        const state = view.querySelector("[data-state]");
        const openCount = view.querySelector("[data-open]");
        const meterIn = view.querySelector("[data-in]");
        const meterCached = view.querySelector("[data-cached]");
        const meterOut = view.querySelector("[data-out]");
        const meterTurns = view.querySelector("[data-turns]");
        const laneOf = (column) => view.querySelector(`[data-lane="${column}"]`);
        const chipsOf = (column) => view.querySelector(`[data-chips="${column}"]`);
        const countOf = (column) => view.querySelector(`[data-count="${column}"]`);
        const columns = {
            todo: { lane: laneOf("todo"), chips: chipsOf("todo"), count: countOf("todo") },
            doing: { lane: laneOf("doing"), chips: chipsOf("doing"), count: countOf("doing") },
            done: { lane: laneOf("done"), chips: chipsOf("done"), count: countOf("done") },
        };
        if (!roster || !form || !fileField || !lanePrev || !laneNext || !keyField || !keySet || !keyForget ||
            !state || !openCount || !meterIn || !meterCached || !meterOut || !meterTurns ||
            !columns.todo.lane || !columns.todo.chips || !columns.todo.count ||
            !columns.doing.lane || !columns.doing.chips || !columns.doing.count ||
            !columns.done.lane || !columns.done.chips || !columns.done.count) {
            throw new Error("Ticket rack could not initialize its view.");
        }
        const lanes = columns;
        // The marquee: which lane is on show. Local view state, like the
        // visualizer's page — a press steps one lane, the ends disable, no wrap.
        const LANE_ORDER = ["todo", "doing", "done"];
        let laneIndex = 0;
        const renderLanes = () => {
            for (const [at, key] of LANE_ORDER.entries())
                lanes[key].lane.hidden = at !== laneIndex;
            lanePrev.disabled = laneIndex === 0;
            laneNext.disabled = laneIndex >= LANE_ORDER.length - 1;
        };
        lanePrev.addEventListener("click", () => {
            laneIndex = Math.max(0, laneIndex - 1);
            renderLanes();
        });
        laneNext.addEventListener("click", () => {
            laneIndex = Math.min(LANE_ORDER.length - 1, laneIndex + 1);
            renderLanes();
        });
        renderLanes();
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
                throw new Error(`Ticket rack has no ${name} dropdown.`);
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
        // The effort ladder is the filing's own knob — local, per ticket, never a
        // fact until it rides TicketFiled.
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
        // cleared from the field. Enter commits it here (never as a filing).
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
        // The bill: summed from AgentTurnEnded, every mind's turns alike.
        const bill = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
        const compact = (count) => count >= 10000 ? `${(count / 1000).toFixed(1)}k` : count >= 1000 ? `${(count / 1000).toFixed(2)}k` : String(count);
        const renderMeter = () => {
            meterIn.textContent = compact(bill.input + bill.cacheWrite);
            meterCached.textContent = compact(bill.cacheRead);
            meterOut.textContent = compact(bill.output);
            meterTurns.textContent = String(bill.turns);
        };
        context.subscribe("AgentTurnEnded", (fact) => {
            bill.turns += 1;
            bill.input += fact.payload.usage.input;
            bill.output += fact.payload.usage.output;
            bill.cacheRead += fact.payload.usage.cacheRead;
            bill.cacheWrite += fact.payload.usage.cacheWrite;
            renderMeter();
        });
        // The filing: words plus #tags in one text area; Enter or FILE files it,
        // Shift+Enter breaks a line. Tags come out wherever they stand; the
        // words keep their line breaks (a ticket may be a short brief).
        const submit = () => {
            const raw = fileField.value.trim();
            if (raw === "")
                return;
            const tags = [];
            const lines = [];
            for (const line of raw.split("\n")) {
                const words = [];
                for (const token of line.split(/\s+/)) {
                    if (token.length > 1 && token.startsWith("#"))
                        tags.push(token.slice(1).toLowerCase());
                    else if (token !== "")
                        words.push(token);
                }
                lines.push(words.join(" "));
            }
            const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
            if (text === "")
                return;
            const chosen = effortValue;
            context.emit("TicketFiled", {
                text,
                ...(tags.length === 0 ? {} : { tags }),
                ...(chosen === "" ? {} : { effort: chosen }),
            });
            fileField.value = "";
        };
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            submit();
        });
        fileField.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" || event.shiftKey)
                return;
            event.preventDefault();
            submit();
        });
        // --- The ledger and the roster, rendered from facts. ---
        const clip = (value) => {
            const line = value.replace(/\s+/g, " ").trim();
            return line.length > TEXT_WIDTH ? `${line.slice(0, TEXT_WIDTH - 1)}…` : line;
        };
        const minds = new Map();
        let tickets = [];
        let replayed = false;
        // Work in flight per turn: how many tool calls, the last one's name, and
        // how many came back as errors — the chip's signage while a mind works.
        const callsByTurn = new Map();
        const CALLS_LIMIT = 200;
        const renderRoster = () => {
            roster.replaceChildren();
            if (minds.size === 0) {
                const empty = document.createElement("div");
                empty.className = "empty";
                empty.textContent = "No minds declared";
                roster.append(empty);
                return;
            }
            for (const [id, mind] of [...minds].sort(([a], [b]) => a.localeCompare(b))) {
                const row = document.createElement("div");
                row.className = "mind";
                const name = document.createElement("span");
                name.className = "id";
                name.textContent = id;
                const spec = document.createElement("span");
                spec.className = "spec";
                spec.textContent = mind.specialty;
                const rule = document.createElement("span");
                rule.className = "rule";
                rule.textContent =
                    `tags ${mind.tags.length === 0 ? "-" : mind.tags.join(",")} | base ${mind.baseBid}`;
                rule.title = mind.bidRule;
                const st = document.createElement("span");
                st.className = `st${mind.state === "working" ? " working" : ""}`;
                st.textContent = mind.state === "working" ? `working ${mind.ticketId ?? ""}`.trim() : "idle";
                row.append(name, spec, rule, st);
                roster.append(row);
            }
        };
        const flagOf = (ticket) => {
            if (ticket.state === "done")
                return { text: ticket.outcome ?? "done", kind: ticket.outcome === "done" || ticket.outcome === undefined ? "dim" : "err" };
            if (ticket.state === "doing")
                return ticket.working ? { text: "working", kind: "" } : { text: "parked", kind: "dim" };
            if (ticket.to !== undefined)
                return null;
            if (ticket.awaiting.length > 0)
                return { text: "bidding", kind: "" };
            if (ticket.bids.length + ticket.passed.length > 0)
                return { text: "no takers", kind: "err" };
            return { text: minds.size === 0 ? "no minds" : "parked", kind: "dim" };
        };
        const resumable = (ticket) => {
            if (ticket.state === "doing" && !ticket.working)
                return "Resume";
            if (ticket.state === "todo" && ticket.to === undefined && ticket.awaiting.length === 0)
                return "Open";
            return null;
        };
        const closable = (ticket) => ticket.state !== "done" && !ticket.working;
        const chipOf = (ticket) => {
            const chip = document.createElement("div");
            chip.className = "ticket";
            chip.dataset.ticketId = ticket.ticketId;
            chip.dataset.state = ticket.state;
            if (ticket.working)
                chip.dataset.working = "";
            chip.title = `${ticket.ticketId} | filed frame ${ticket.frame} | click: trace this ticket in the causality inspector`;
            const head = document.createElement("div");
            head.className = "head";
            const tid = document.createElement("span");
            tid.className = "tid";
            tid.textContent = ticket.ticketId;
            const text = document.createElement("span");
            text.className = "text";
            text.textContent = clip(ticket.text);
            head.append(tid, text);
            const meta = document.createElement("div");
            meta.className = "meta";
            for (const tag of ticket.tags) {
                const badge = document.createElement("span");
                badge.className = "tag";
                badge.textContent = tag;
                meta.append(badge);
            }
            if (ticket.parent !== undefined) {
                const parent = document.createElement("span");
                parent.className = "to";
                parent.textContent = `< ${ticket.parent}`;
                meta.append(parent);
            }
            if (ticket.to !== undefined) {
                const to = document.createElement("span");
                to.className = "to";
                to.textContent = `-> ${ticket.to}`;
                meta.append(to);
            }
            const calls = ticket.turnId === undefined ? undefined : callsByTurn.get(ticket.turnId);
            if (calls !== undefined && calls.count > 0) {
                const badge = document.createElement("span");
                badge.className = "to";
                badge.textContent = `${calls.count} call${calls.count === 1 ? "" : "s"} | last ${calls.last}${calls.errors > 0 ? ` | ${calls.errors} err` : ""}`;
                meta.append(badge);
            }
            const flag = flagOf(ticket);
            if (flag !== null) {
                const badge = document.createElement("span");
                badge.className = `flag${flag.kind === "" ? "" : ` ${flag.kind}`}`;
                badge.textContent = flag.text;
                meta.append(badge);
            }
            const actions = document.createElement("span");
            actions.className = "actions";
            const resume = resumable(ticket);
            if (resume !== null) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.resume = "";
                button.textContent = resume;
                actions.append(button);
            }
            if (closable(ticket)) {
                const button = document.createElement("button");
                button.type = "button";
                button.dataset.close = "";
                button.textContent = "X";
                button.title = "Close as done (a human's close)";
                actions.append(button);
            }
            if (actions.childElementCount > 0)
                meta.append(actions);
            chip.append(head, meta);
            if (ticket.notes.length > 0 || ticket.closeNote !== undefined) {
                const notes = document.createElement("details");
                notes.className = "notes";
                const summary = document.createElement("summary");
                summary.textContent = `${ticket.notes.length} note${ticket.notes.length === 1 ? "" : "s"}${ticket.closeNote === undefined ? "" : " | closed"}`;
                notes.append(summary);
                for (const note of ticket.notes) {
                    const line = document.createElement("p");
                    const by = document.createElement("b");
                    by.textContent = `${note.by}@${note.frame} `;
                    line.append(by, document.createTextNode(note.text));
                    notes.append(line);
                }
                if (ticket.closeNote !== undefined) {
                    const line = document.createElement("p");
                    const by = document.createElement("b");
                    by.textContent = `${ticket.outcome ?? "closed"} `;
                    line.append(by, document.createTextNode(ticket.closeNote));
                    notes.append(line);
                }
                chip.append(notes);
            }
            return chip;
        };
        const renderTickets = () => {
            for (const lane of Object.values(lanes))
                lane.chips.replaceChildren();
            const counts = { todo: 0, doing: 0, done: 0 };
            // Newest first in every column: the fresh work is at the top.
            for (const ticket of [...tickets].reverse()) {
                counts[ticket.state] += 1;
                lanes[ticket.state].chips.append(chipOf(ticket));
            }
            for (const key of ["todo", "doing", "done"])
                lanes[key].count.textContent = String(counts[key]);
            openCount.textContent = String(counts.todo + counts.doing);
            state.textContent = replayed ? "Live" : "Replaying";
            state.classList.toggle("replaying", !replayed);
        };
        // One listener for every chip: buttons are intents, the chip is a selection.
        view.addEventListener("click", (event) => {
            const target = event.target;
            const chip = target?.closest("[data-ticket-id]");
            if (!chip || !view.contains(chip))
                return;
            const ticketId = chip.dataset.ticketId ?? "";
            const ticket = tickets.find((entry) => entry.ticketId === ticketId);
            if (ticket === undefined)
                return;
            if (target?.closest("[data-resume]")) {
                context.emit("TicketResumeRequested", { ticketId });
                return;
            }
            if (target?.closest("[data-close]")) {
                context.emit("TicketClosed", { ticketId, outcome: "done", by: context.instanceId });
                return;
            }
            if (target?.closest("summary") || target?.closest("details"))
                return;
            context.emit("FactSelected", { factId: ticket.factId });
        });
        context.subscribe("TicketsDeclared", (fact) => {
            tickets = fact.payload.tickets;
            replayed = fact.payload.replayed;
            renderTickets();
        });
        context.subscribe("AgentToolCalled", (fact) => {
            const known = callsByTurn.get(fact.payload.turnId) ?? { count: 0, last: "", errors: 0 };
            known.count += 1;
            known.last = fact.payload.name;
            callsByTurn.set(fact.payload.turnId, known);
            if (callsByTurn.size > CALLS_LIMIT)
                callsByTurn.delete(callsByTurn.keys().next().value);
            renderTickets();
        });
        context.subscribe("AgentToolReturned", (fact) => {
            const known = callsByTurn.get(fact.payload.turnId);
            if (known === undefined || !fact.payload.isError)
                return;
            known.errors += 1;
            renderTickets();
        });
        context.subscribe("MindDeclared", (fact) => {
            minds.set(fact.sourceSlice, fact.payload);
            renderRoster();
            renderTickets();
        });
        context.subscribe("SliceUnmounted", (fact) => {
            if (!minds.delete(fact.payload.sliceId))
                return;
            renderRoster();
            renderTickets();
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
        renderRoster();
        renderTickets();
        renderMeter();
        return () => {
            window.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("keydown", onEscape);
            host.remove();
        };
    },
});
