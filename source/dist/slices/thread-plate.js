import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The thread's signage: NOW | the sentence | AWAY n | TRAIL n | DONE, centred
// in the header band's empty middle (the r1c1@center seat). Type a
// sentence, Enter pins it (ThreadPinRequested — the thread slice owns the
// answer); DONE pins the empty text. TRAIL drops the "where was I" panel
// under the band: newest step first, in sentences. When a workspace replays
// with a thread still pinned — you came back — the panel opens on its own,
// because the moment you return is the moment you need it. Everything shown
// is read from ThreadDeclared; the plate holds no state of its own. The
// body is self-contained, so the plate is adoptable like every other view.
export const threadPlate = defineSlice({
    type: "thread-plate",
    description: "Header signage for the thread: pin it, see the trail, mark it done.",
    consumes: [
        "ThreadDeclared",
        "WorkspaceReplayed",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["ThreadPinRequested", "WorkLogExportRequested", "ViewSlotRequested"],
    start(context) {
        const plateStyles = `
  * { box-sizing: border-box; }
  :host { position: relative; }
  [data-thread-plate] {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    height: 100%;
    padding: 0.35rem 0.5rem;
    color: var(--surface-200, #e8b366);
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 0.66rem;
    letter-spacing: 0.1em;
  }
  [data-thread-plate] .now {
    flex: none;
    color: var(--accent-emit, #ffb300);
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  [data-thread-plate] .now.is-empty { color: var(--surface-400, #a8551a); }
  [data-thread-plate] input {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: 0 0.5rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: var(--surface-900, #29120a);
    color: var(--text-bright, #ffe9c2);
    font: inherit;
    letter-spacing: 0.06em;
  }
  [data-thread-plate] input:focus {
    outline: none;
    border-color: var(--accent-emit, #ffb300);
  }
  [data-thread-plate] input.is-pinned {
    border-color: var(--accent-emit, #ffb300);
  }
  [data-thread-plate] input::placeholder {
    color: var(--surface-400, #a8551a);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.6rem;
  }
  [data-thread-plate] button {
    flex: none;
    height: 100%;
    padding: 0 0.5rem;
    border: 2px solid var(--surface-600, #66300f);
    border-radius: 0;
    background: none;
    color: var(--surface-200, #e8b366);
    font: inherit;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
  }
  [data-thread-plate] button:hover,
  [data-thread-plate] button.is-open {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-thread-plate] button[hidden] { display: none; }
  [data-thread-plate] .away {
    flex: none;
    padding: 0.1rem 0.4rem;
    border: 2px solid var(--accent-consume, #ff7a2e);
    color: var(--accent-consume, #ff7a2e);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  [data-thread-plate] .away[hidden] { display: none; }
  /* The drop panel: hung under the band from this seat, over the stage. */
  [data-thread-plate] .trail {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    margin-top: 0.4rem;
    border: 2px solid var(--accent-emit, #ffb300);
    background: var(--surface-950, #1d0d05);
    color: var(--surface-200, #e8b366);
  }
  [data-thread-plate] .trail[hidden] { display: none; }
  [data-thread-plate] .trail .head {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    padding: 0.4rem 0.6rem;
    border-bottom: 2px solid var(--surface-600, #66300f);
    color: var(--accent-emit, #ffb300);
    font-size: 0.6rem;
    font-weight: 800;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  [data-thread-plate] .trail .head .since {
    margin-left: auto;
    color: var(--surface-400, #a8551a);
    font-weight: 400;
  }
  /* EXPORT: the work log (this trail, every ticket's turns and digests) as
     one JSON file — a fact out, the work-log slice hands the file over. */
  [data-thread-plate] .trail .head button {
    padding: 0.1rem 0.45rem;
    border: 2px solid var(--surface-600, #66300f);
    background: transparent;
    color: var(--surface-200, #e8b366);
    font: inherit;
    font-size: 0.58rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    cursor: pointer;
  }
  [data-thread-plate] .trail .head button:hover {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  [data-thread-plate] .trail ol {
    margin: 0;
    padding: 0.35rem 0;
    list-style: none;
    max-height: 18rem;
    overflow-y: auto;
  }
  [data-thread-plate] .trail li {
    display: grid;
    grid-template-columns: 3.4rem 4.6rem 1fr auto;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.22rem 0.6rem;
    line-height: 1.35;
  }
  [data-thread-plate] .trail li + li { border-top: 1px solid var(--surface-600, #66300f); }
  [data-thread-plate] .trail li:first-child { color: var(--text-bright, #ffe9c2); }
  [data-thread-plate] .trail .frame {
    color: var(--surface-400, #a8551a);
    font-variant-numeric: tabular-nums;
    font-size: 0.6rem;
  }
  [data-thread-plate] .trail .kind {
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--surface-400, #a8551a);
  }
  [data-thread-plate] .trail li[data-kind="edit"] .kind,
  [data-thread-plate] .trail li[data-kind="create"] .kind,
  [data-thread-plate] .trail li[data-kind="fixed"] .kind { color: var(--accent-emit, #ffb300); }
  [data-thread-plate] .trail li[data-kind="verdict"] .kind,
  [data-thread-plate] .trail li[data-kind="refused"] .kind,
  [data-thread-plate] .trail li[data-kind="delete"] .kind { color: var(--accent-error, #ff2f2f); }
  [data-thread-plate] .trail li[data-kind="mind"] .kind,
  [data-thread-plate] .trail li[data-kind="ask"] .kind,
  [data-thread-plate] .trail li[data-kind="back"] .kind { color: var(--accent-consume, #ff7a2e); }
  [data-thread-plate] .trail li.is-away .note { color: var(--accent-consume, #ff7a2e); }
  [data-thread-plate] .trail .note {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  [data-thread-plate] .trail .times {
    color: var(--surface-400, #a8551a);
    font-variant-numeric: tabular-nums;
    font-size: 0.6rem;
  }
  [data-thread-plate] .trail .empty {
    padding: 0.5rem 0.6rem;
    color: var(--surface-400, #a8551a);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
`;
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = plateStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("section");
        view.dataset.threadPlate = "";
        view.innerHTML = `
      <span class="now is-empty" data-now>Now</span>
      <input type="text" data-text spellcheck="false" autocomplete="off"
        placeholder="What are you doing? | Enter pins" aria-label="The thread" />
      <span class="away" data-away hidden></span>
      <button type="button" data-trail hidden>Trail</button>
      <button type="button" data-done hidden>Done</button>
      <div class="trail" data-panel hidden>
        <div class="head"><span>Where was I</span><button type="button" data-export title="Download the work log as JSON: this trail, every ticket's turns, digests, verdicts">Export</button><span class="since" data-since></span></div>
        <ol data-steps></ol>
      </div>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
        const nowLabel = view.querySelector("[data-now]");
        const input = view.querySelector("[data-text]");
        const awayTag = view.querySelector("[data-away]");
        const trailButton = view.querySelector("[data-trail]");
        const doneButton = view.querySelector("[data-done]");
        const panel = view.querySelector("[data-panel]");
        const sinceLabel = view.querySelector("[data-since]");
        const steps = view.querySelector("[data-steps]");
        const exportButton = view.querySelector("[data-export]");
        if (!nowLabel || !input || !awayTag || !trailButton || !doneButton || !panel || !sinceLabel || !steps || !exportButton) {
            throw new Error("Thread plate could not initialize its view.");
        }
        // What the thread slice last declared — the only state the plate reads.
        let declared = {
            text: "",
            since: -1,
            subject: [],
            trail: [],
            away: 0,
        };
        let panelOpen = false;
        let replayed = false;
        const pin = (text) => context.emit("ThreadPinRequested", { text });
        const renderTrail = () => {
            steps.textContent = "";
            const edits = declared.trail.filter((entry) => entry.kind === "edit").reduce((sum, entry) => sum + entry.times, 0);
            sinceLabel.textContent =
                declared.since < 0
                    ? ""
                    : `since frame ${declared.since} | ${edits} edit${edits === 1 ? "" : "s"}` +
                        (declared.away > 0 ? ` | ${declared.away} away` : "");
            if (declared.trail.length === 0) {
                const empty = document.createElement("li");
                empty.className = "empty";
                empty.textContent = "Nothing yet | the trail fills as you work";
                steps.append(empty);
                return;
            }
            const subject = new Set(declared.subject);
            // Newest first: the last thing that happened is the thing you need.
            for (const entry of [...declared.trail].reverse()) {
                const row = document.createElement("li");
                row.dataset.kind = entry.kind;
                if (entry.kind === "edit" && subject.size > 0 && !subject.has(entry.note))
                    row.classList.add("is-away");
                const frame = document.createElement("span");
                frame.className = "frame";
                frame.textContent = String(entry.frame);
                const kind = document.createElement("span");
                kind.className = "kind";
                kind.textContent = entry.kind === "back" ? "time" : entry.kind;
                const note = document.createElement("span");
                note.className = "note";
                note.textContent =
                    entry.kind === "edit" ? `edited ${entry.note}` :
                        entry.kind === "open" ? `opened ${entry.note}` :
                            entry.kind === "create" ? `created ${entry.note}` :
                                entry.kind === "delete" ? `deleted ${entry.note}` :
                                    entry.kind === "pin" ? `pinned: ${entry.note}` :
                                        entry.kind === "ask" ? `asked: ${entry.note}` :
                                            entry.kind === "mind" ? `mind: ${entry.note}` :
                                                entry.note;
                note.title = note.textContent;
                const times = document.createElement("span");
                times.className = "times";
                times.textContent = entry.times > 1 ? `x${entry.times}` : "";
                row.append(frame, kind, note, times);
                steps.append(row);
            }
        };
        const setPanel = (open) => {
            panelOpen = open && declared.text !== "";
            panel.hidden = !panelOpen;
            trailButton.classList.toggle("is-open", panelOpen);
            if (panelOpen)
                renderTrail();
        };
        const render = () => {
            const pinned = declared.text !== "";
            // The field shows the pinned sentence unless the human is mid-edit.
            if (shadow.activeElement !== input)
                input.value = declared.text;
            input.classList.toggle("is-pinned", pinned);
            nowLabel.classList.toggle("is-empty", !pinned);
            trailButton.hidden = !pinned;
            doneButton.hidden = !pinned;
            const stepCount = declared.trail.length;
            trailButton.textContent = stepCount > 0 ? `Trail ${stepCount}` : "Trail";
            awayTag.hidden = !(pinned && declared.away > 0);
            awayTag.textContent = `Away ${declared.away}`;
            awayTag.title = declared.subject.length > 0 ? `${declared.away} edits outside ${declared.subject.join(", ")}` : "";
            if (!pinned)
                setPanel(false);
            else if (panelOpen)
                renderTrail();
        };
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                const next = input.value.replace(/\s+/g, " ").trim();
                if (next !== declared.text)
                    pin(next);
                input.blur();
            }
            else if (event.key === "Escape") {
                event.preventDefault();
                input.value = declared.text;
                input.blur();
            }
        });
        input.addEventListener("blur", () => {
            // Leaving the field without Enter keeps the pinned sentence — nothing
            // is pinned by accident.
            input.value = declared.text;
        });
        trailButton.addEventListener("click", () => setPanel(!panelOpen));
        exportButton.addEventListener("click", () => context.emit("WorkLogExportRequested", {}));
        doneButton.addEventListener("click", () => {
            setPanel(false);
            pin("");
        });
        context.subscribe("ThreadDeclared", (fact) => {
            declared = {
                text: fact.payload.text,
                since: fact.payload.since,
                subject: [...fact.payload.subject],
                trail: fact.payload.trail.map((entry) => ({ ...entry })),
                away: fact.payload.away,
            };
            render();
        });
        // You came back: the workspace just replayed with a thread still
        // pinned, so the trail opens on its own — "where was I" without asking.
        context.subscribe("WorkspaceReplayed", () => {
            replayed = true;
            if (declared.text !== "")
                setPanel(true);
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
        joinStage("r1c1@center");
        return () => host.remove();
    },
});
