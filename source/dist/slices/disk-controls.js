import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// The DISK block: the fourth tray bay (the grid mints `tray-4` on request).
// One or two buttons whose labels follow the disk-port's declaration —
// LINK DISK (pick a directory), GRANT DISK (re-grant the remembered one
// this session), DISK ✓ name + UNLINK while the mirror is live, and RESTORE
// | OVERWRITE when the disk holds a journal that is not this page's. Each
// press is a fact the disk-port (or, for RESTORE, the fact-log) answers;
// the irreversible ones arm first (SURE?, the tray's idiom). Nothing is
// read from the URL. The body is self-contained, so this slice is
// adoptable — and locked, since it is a way back.
export const diskControls = defineSlice({
    type: "disk-controls",
    description: "LINK | GRANT | RESTORE | OVERWRITE | UNLINK: the disk mirror's buttons.",
    // Load-bearing: this slice's own rank on its document — an intent below the
    // human's 10 does not edit, rename into, copy or delete it. Its opinion of
    // itself, on the board in its mount fact; the lock-book aggregates.
    lock: 10,
    consumes: [
        "WorkspaceDiskDeclared",
        "StageSlotsDeclared",
        "StageTokensDeclared",
        "ViewSlotAssigned",
    ],
    emits: ["WorkspaceDiskRequested", "WorkspaceRestoreRequested", "ViewSlotRequested"],
    start(context) {
        const ARM_MS = 3000;
        const diskStyles = `
  * { box-sizing: border-box; }
  [data-disk-controls] {
    display: flex;
    gap: 0.5rem;
    height: 100%;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  }
  [data-disk-controls] button {
    flex: 1 1 0;
    min-width: 0;
    padding: 0 0.3rem;
    border: 2px solid var(--surface-200, #e8b366);
    border-radius: 0;
    background: var(--surface-800, #341809);
    color: var(--text-bright, #ffe9c2);
    font: inherit;
    font-size: 0.66rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  [data-disk-controls] button[hidden] { display: none; }
  [data-disk-controls] button:hover {
    border-color: var(--accent-emit, #ffb300);
    background: var(--accent-emit, #ffb300);
    color: #1d0d05;
  }
  [data-disk-controls] button:disabled {
    border-color: var(--surface-600, #66300f);
    color: var(--surface-400, #a8551a);
    background: transparent;
    cursor: default;
  }
  /* Live mirror: the primary wears the emit accent as signage. */
  [data-disk-controls] button[data-state="synced"] {
    border-color: var(--accent-emit, #ffb300);
    color: var(--accent-emit, #ffb300);
  }
  /* A journal to be claimed: RESTORE glows consume, the way REWIND arms. */
  [data-disk-controls] button[data-state="backup"] {
    border-color: var(--accent-consume, #ff7a2e);
    color: var(--accent-consume, #ff7a2e);
  }
  [data-disk-controls] button[data-state="error"] {
    border-color: var(--accent-error, #ff2f2f);
    color: var(--accent-error, #ff2f2f);
  }
  [data-disk-controls] button[data-armed] {
    border-color: var(--accent-error, #ff2f2f);
    background: var(--accent-error, #ff2f2f);
    color: #1d0d05;
  }
`;
        const host = document.createElement("div");
        host.style.display = "none";
        const shadow = host.attachShadow({ mode: "open" });
        const style = document.createElement("style");
        style.textContent = diskStyles;
        const tokenStyle = document.createElement("style");
        const view = document.createElement("aside");
        view.dataset.diskControls = "";
        view.innerHTML = `
      <button type="button" data-primary>Disk</button>
      <button type="button" data-secondary hidden>Unlink</button>
    `;
        shadow.append(style, tokenStyle, view);
        document.body.append(host);
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
        joinStage("tray-4");
        const primary = view.querySelector("[data-primary]");
        const secondary = view.querySelector("[data-secondary]");
        if (!primary || !secondary)
            throw new Error("Disk controls could not initialize their view.");
        // The arm (the tray's idiom): one press asks SURE?, a second within
        // ARM_MS fires; arming one disarms the other. Which intent a press
        // fires follows the declared state, read at press time.
        let declared = { state: "none", local: 0 };
        const armTimers = new Map();
        const disarm = (button) => {
            const timer = armTimers.get(button);
            if (timer !== undefined)
                clearTimeout(timer);
            armTimers.delete(button);
            delete button.dataset.armed;
            render();
        };
        const arm = (button) => {
            for (const other of [primary, secondary])
                if (other !== button)
                    disarm(other);
            button.dataset.armed = "";
            button.textContent = "Sure?";
            armTimers.set(button, setTimeout(() => disarm(button), ARM_MS));
        };
        const press = (button, arms, fire) => {
            if (button.dataset.armed !== undefined) {
                disarm(button);
                fire();
                return;
            }
            if (arms)
                arm(button);
            else
                fire();
        };
        const render = () => {
            const s = declared.state;
            const name = declared.name ?? "";
            const counts = `page ${declared.local}${declared.disk === undefined ? "" : ` | disk ${declared.disk}`}${declared.savedAt ? ` | saved ${declared.savedAt}` : ""}`;
            primary.dataset.state = s;
            secondary.dataset.state = s;
            primary.disabled = s === "unsupported";
            secondary.hidden = true;
            if (primary.dataset.armed !== undefined || secondary.dataset.armed !== undefined)
                return;
            switch (s) {
                case "unsupported":
                    primary.textContent = "No disk API";
                    primary.title = "This browser has no File System Access API (Chrome and Edge do): the journal lives in the cache only";
                    break;
                case "none":
                    primary.textContent = "Link disk";
                    primary.title = "Pick a directory: the journal and every document are mirrored there, and can be restored from there";
                    break;
                case "prompt":
                    primary.textContent = "Grant disk";
                    primary.title = `Re-grant ${name}: the browser asks once per session`;
                    secondary.hidden = false;
                    secondary.textContent = "Unlink";
                    secondary.title = `Forget ${name}`;
                    break;
                case "synced":
                    primary.textContent = `Disk | ${name}`;
                    primary.title = `Mirroring the journal and documents to ${name} | ${counts}`;
                    secondary.hidden = false;
                    secondary.textContent = "Unlink";
                    secondary.title = `Stop mirroring and forget ${name} (the files stay)`;
                    break;
                case "backup":
                    primary.textContent = "Restore";
                    primary.title = declared.error ?? `${name} holds a journal that is not this page's | ${counts} | RESTORE takes the disk's and reboots`;
                    secondary.hidden = false;
                    secondary.textContent = "Overwrite";
                    secondary.title = `Write this page's journal over ${name}'s | ${counts}`;
                    break;
                case "error":
                    primary.textContent = "Link disk";
                    primary.title = declared.error ?? "The last disk operation failed";
                    secondary.hidden = declared.name === undefined;
                    secondary.textContent = "Unlink";
                    secondary.title = `Forget ${name}`;
                    break;
            }
        };
        primary.addEventListener("click", () => {
            switch (declared.state) {
                case "none":
                case "prompt":
                case "error":
                    press(primary, false, () => context.emit("WorkspaceDiskRequested", { action: "link" }));
                    break;
                case "synced":
                    break;
                case "backup":
                    if (declared.error !== undefined)
                        return;
                    press(primary, true, () => context.emit("WorkspaceRestoreRequested", {}));
                    break;
                default:
                    break;
            }
        });
        secondary.addEventListener("click", () => {
            switch (declared.state) {
                case "backup":
                    press(secondary, true, () => context.emit("WorkspaceDiskRequested", { action: "overwrite" }));
                    break;
                case "prompt":
                case "synced":
                case "error":
                    press(secondary, true, () => context.emit("WorkspaceDiskRequested", { action: "unlink" }));
                    break;
                default:
                    break;
            }
        });
        context.subscribe("WorkspaceDiskDeclared", (fact) => {
            declared = { ...fact.payload };
            for (const button of [primary, secondary]) {
                const timer = armTimers.get(button);
                if (timer !== undefined)
                    clearTimeout(timer);
                armTimers.delete(button);
                delete button.dataset.armed;
            }
            render();
        });
        render();
        return () => {
            for (const timer of armTimers.values())
                clearTimeout(timer);
            host.remove();
        };
    },
});
