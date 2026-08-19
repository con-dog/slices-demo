import { firewall, Pool } from "@slices/kit";
import { sliceDefinerFor } from "@slices/kit/define";
import { trackFrames } from "@slices/kit/testing";
import { modelPort } from "../slices/model-port.js";
import { schemaBook } from "../slices/schema-book.js";
function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
// --- The model transport's doors, with the network stubbed ---
// The port owns two resources it reads from the host: storage (where the
// key, door, and model are kept) and fetch (the door itself). Settings arrive
// as ModelSettingsRequested facts — the console's KEY field and MODEL
// dropdown speak them — and the port declares ModelSettingsDeclared back.
// Here storage and fetch are stubs, so the assertions are about the wire:
// which endpoint, which auth header, which model, that the answer comes back
// as ModelReturned causedBy the request, and that the key never rides a
// declaration — the mind's whole contract, and the console's.
const defineSlice = sliceDefinerFor();
const host = globalThis;
const store = new Map();
const fakeStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
};
const requests = [];
let nextResponse = { status: 200, json: {} };
host.window = { localStorage: fakeStorage };
host.fetch = (async (url, init) => {
    requests.push({
        url,
        headers: init?.headers,
        body: JSON.parse(String(init?.body)),
    });
    const { status, json } = nextResponse;
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? "OK" : "Error",
        json: async () => json,
    };
});
const caller = defineSlice({
    type: "caller",
    description: "Test double: emits ModelCallRequested and ModelSettingsRequested on demand.",
    consumes: ["ModelReturned", "ModelSettingsDeclared"],
    emits: ["ModelCallRequested", "ModelSettingsRequested"],
    start(context) {
        globalThis.__speak = {
            call: (payload) => void context.emit("ModelCallRequested", payload),
            settings: (payload) => void context.emit("ModelSettingsRequested", payload),
        };
    },
});
const speak = () => {
    const found = globalThis.__speak;
    if (!found)
        throw new Error("caller not mounted");
    return found;
};
const boot = () => {
    const pool = new Pool({
        onHandlerError: (error) => {
            throw error;
        },
    });
    const timeline = trackFrames(pool);
    pool.mount(firewall, { instanceId: "firewall#1" });
    pool.mount(schemaBook, { instanceId: "schema-book#1" });
    pool.mount(caller, { instanceId: "caller#1" });
    pool.mount(modelPort, { instanceId: "model-port#1" });
    timeline.advance(2);
    return { pool, timeline };
};
const call = () => speak().call({
    callId: "call-1",
    request: { max_tokens: 10, messages: [{ role: "user", content: "hi" }] },
});
const runFor = async (pool, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        pool.advanceFrame();
        await new Promise((resolve) => setTimeout(resolve, 3));
    }
};
const lastDeclared = (timeline) => {
    const declared = timeline.delivered("ModelSettingsDeclared");
    assert(declared.length > 0, "The port must declare its settings.");
    return declared[declared.length - 1].payload;
};
// --- Boot with nothing stored: declared, no key, Anthropic door by default ---
{
    const { pool, timeline } = boot();
    const declared = lastDeclared(timeline);
    assert(declared.keyHint === null && declared.provider === "anthropic" && declared.model === "claude-opus-5", `A bare boot declares no key and the Anthropic door: ${JSON.stringify(declared)}`);
    const anthropicIds = declared.groups.flatMap((group) => group.models);
    assert(anthropicIds.includes("claude-sonnet-5") && !anthropicIds.some((m) => m.includes("/")), "The Anthropic list is bare ids.");
    assert(declared.groups.length === 1 && declared.groups[0].label === "anthropic", `The Anthropic door has one vendor shelf: ${JSON.stringify(declared.groups.map((g) => g.label))}`);
    const violations = timeline.delivered("ContractViolated");
    assert(violations.length === 0, `Declarations must pass the firewall: ${JSON.stringify(violations.map((v) => v.payload))}`);
    call();
    await runFor(pool, 60);
    const returned = timeline.delivered("ModelReturned");
    assert(returned.length === 1 && returned[0].payload.error?.startsWith("no-key"), "No key must answer no-key without fetching.");
    assert(requests.length === 0, "No key means no network call.");
}
// --- Anthropic door: a key set by fact is stored, hinted, and sent as x-api-key ---
nextResponse = {
    status: 200,
    json: {
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 },
    },
};
{
    const { pool, timeline } = boot();
    speak().settings({ key: "sk-ant-test-key-1234" });
    timeline.advance(2);
    assert(store.get("slice-ide|model-key") === "sk-ant-test-key-1234", "The key must be kept in the port's storage entry.");
    const declared = lastDeclared(timeline);
    assert(declared.keyHint === "sk-ant-…1234", `The declaration carries a hint, got ${String(declared.keyHint)}.`);
    const leaked = timeline.delivered("ModelSettingsDeclared").some((fact) => JSON.stringify(fact.payload).includes("test-key"));
    assert(!leaked, "The key must never ride a declaration.");
    const violations = timeline.delivered("ContractViolated");
    assert(violations.length === 0, `Settings facts must pass the firewall: ${JSON.stringify(violations.map((v) => v.payload))}`);
    call();
    await runFor(pool, 120);
    const sent = requests[0];
    assert(sent !== undefined, "The port must fetch.");
    assert(sent.url === "https://api.anthropic.com/v1/messages", `Anthropic door: ${sent.url}`);
    assert(sent.headers["x-api-key"] === "sk-ant-test-key-1234" && sent.headers.Authorization === undefined, "Anthropic auth is x-api-key.");
    assert(sent.headers["anthropic-dangerous-direct-browser-access"] === "true" && sent.headers["anthropic-version"] === "2023-06-01", "The browser-access and version headers must ride the Anthropic call.");
    assert(sent.body.model === "claude-opus-5", `Anthropic default model, got ${String(sent.body.model)}.`);
    const returned = timeline.delivered("ModelReturned");
    assert(returned.length === 1 && returned[0].payload.ok, "A 200 must come back as ok.");
    assert(returned[0].payload.usage?.input === 12 && returned[0].payload.usage?.cacheRead === 5 && returned[0].payload.usage?.cacheWrite === 7, "Usage must be flattened.");
    const request = timeline.delivered("ModelCallRequested")[0];
    assert(returned[0].causedBy.includes(request.id), "ModelReturned must be caused by its request across the async hop.");
}
// --- The stored key persists across boots; an sk-or- key flips the door and drops the foreign model ---
requests.length = 0;
{
    const { pool, timeline } = boot();
    assert(lastDeclared(timeline).keyHint === "sk-ant-…1234", "A stored key must be declared on the next boot.");
    speak().settings({ model: "claude-sonnet-5" });
    timeline.advance(2);
    assert(lastDeclared(timeline).model === "claude-sonnet-5" && store.get("slice-ide|model-name") === "claude-sonnet-5", "A chosen model is declared and remembered.");
    speak().settings({ key: "sk-or-test-key-9f9a" });
    timeline.advance(2);
    const declared = lastDeclared(timeline);
    assert(declared.provider === "openrouter" && declared.keyHint === "sk-or-…9f9a", `An sk-or- key picks OpenRouter: ${JSON.stringify(declared)}`);
    assert(declared.model === "anthropic/claude-opus-5" && store.get("slice-ide|model-name") === undefined, "A door flip forgets a model the new door cannot serve.");
    const routedIds = declared.groups.flatMap((group) => group.models);
    assert(routedIds.every((m) => m.includes("/")), "The OpenRouter list wears vendor namespaces.");
    const shelves = declared.groups.map((group) => group.label);
    assert(["anthropic", "openai", "google", "glm", "deepseek"].every((vendor) => shelves.includes(vendor)), `The OpenRouter door shelves every vendor as an option group: ${JSON.stringify(shelves)}`);
    assert(shelves[0] === "anthropic" && declared.groups[0].models[0] === "anthropic/claude-opus-5", "The first shelf's first model is the door's default.");
    for (const group of declared.groups) {
        assert(group.models.length > 0, `Shelf ${group.label} must not be empty.`);
        const prefix = { anthropic: "anthropic/", openai: "openai/", google: "google/", glm: "z-ai/", deepseek: "deepseek/" }[group.label];
        assert(prefix !== undefined && group.models.every((m) => m.startsWith(prefix)), `Shelf ${group.label} holds only its vendor's ids: ${JSON.stringify(group.models)}`);
    }
    call();
    await runFor(pool, 120);
    const sent = requests[0];
    assert(sent.url === "https://openrouter.ai/api/v1/messages", `OpenRouter door: ${sent.url}`);
    assert(sent.headers.Authorization === "Bearer sk-or-test-key-9f9a" && sent.headers["x-api-key"] === undefined, "OpenRouter auth is a Bearer token.");
    assert(sent.headers["anthropic-dangerous-direct-browser-access"] === undefined && sent.headers["anthropic-version"] === undefined, "Anthropic-only headers must not ride an OpenRouter call (its CORS allow-list refuses them).");
    assert(sent.body.model === "anthropic/claude-opus-5", `OpenRouter default model wears the namespace, got ${String(sent.body.model)}.`);
    assert(sent.body.max_tokens === 10, "The request body must pass through untouched.");
}
// --- A model outside the list is honoured and listed; the provider can be forced; empty strings forget ---
requests.length = 0;
{
    const { pool, timeline } = boot();
    speak().settings({ model: "anthropic/claude-opus-4.7" });
    timeline.advance(2);
    let declared = lastDeclared(timeline);
    assert(declared.model === "anthropic/claude-opus-4.7" && declared.groups[0].label === "custom" && declared.groups[0].models[0] === "anthropic/claude-opus-4.7", `An unlisted model is used and shown first on a custom shelf: ${JSON.stringify(declared.groups[0])}`);
    assert(declared.groups.filter((group) => group.label === "custom").length === 1, "One custom shelf, never more.");
    call();
    await runFor(pool, 120);
    assert(String(requests[0].body.model) === "anthropic/claude-opus-4.7", "The chosen model rides the call.");
    // Another vendor's model on the same door is a listed choice: no custom
    // shelf, and it rides the call unchanged — the door is one Messages shape.
    speak().settings({ model: "deepseek/deepseek-v4-flash" });
    timeline.advance(2);
    declared = lastDeclared(timeline);
    assert(declared.model === "deepseek/deepseek-v4-flash" && declared.provider === "openrouter", `A listed DeepSeek model is chosen: ${JSON.stringify(declared.model)}`);
    assert(declared.groups.every((group) => group.label !== "custom"), "A listed choice earns no custom shelf.");
    requests.length = 0;
    call();
    await runFor(pool, 120);
    assert(String(requests[0].body.model) === "deepseek/deepseek-v4-flash" && requests[0].url === "https://openrouter.ai/api/v1/messages", "The other vendor's model rides the OpenRouter door.");
    speak().settings({ provider: "anthropic", model: "" });
    timeline.advance(2);
    declared = lastDeclared(timeline);
    assert(declared.provider === "anthropic" && declared.model === "claude-opus-5", `A forced provider overrides key detection and an empty model forgets: ${JSON.stringify(declared)}`);
    speak().settings({ provider: "", key: "" });
    timeline.advance(2);
    declared = lastDeclared(timeline);
    assert(declared.keyHint === null && store.get("slice-ide|model-key") === undefined && store.get("slice-ide|model-provider") === undefined, "Empty strings forget the key and the provider.");
}
// --- A non-2xx answer is an error string, never a throw ---
requests.length = 0;
nextResponse = { status: 401, json: { error: { message: "API key is invalid." } } };
{
    const { pool, timeline } = boot();
    speak().settings({ key: "sk-ant-bad" });
    timeline.advance(2);
    call();
    await runFor(pool, 120);
    const returned = timeline.delivered("ModelReturned");
    assert(returned.length === 1 && !returned[0].payload.ok && returned[0].payload.error === "401 API key is invalid.", `An HTTP error must ride back as text, got ${JSON.stringify(returned[0]?.payload)}.`);
}
// --- Late joiners: a slice consuming ModelSettingsDeclared mounted later gets a fresh declaration ---
{
    const { pool, timeline } = boot();
    const before = timeline.delivered("ModelSettingsDeclared").length;
    const listener = defineSlice({
        type: "listener",
        description: "Test double: a late consumer of the settings.",
        consumes: ["ModelSettingsDeclared"],
        emits: [],
        start() { },
    });
    pool.mount(listener, { instanceId: "listener#1" });
    timeline.advance(2);
    assert(timeline.delivered("ModelSettingsDeclared").length > before, "A late consumer must hear the settings again (rule 9).");
}
console.log("model-port: settings travel as facts, both doors open on the same wire, and errors ride back as facts.");
