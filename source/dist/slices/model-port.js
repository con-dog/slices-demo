import { sliceDefinerFor } from "@slices/kit/define";
const defineSlice = sliceDefinerFor();
// Owns the model transport the way keyboard owns keydown and clipboard owns
// the OS clipboard: the network handle to the Messages API is private to this
// slice, and everything that crosses the boundary is a fact. ModelCallRequested
// carries a request body the mind assembled (system, tools, messages); this
// port adds the model and the key, POSTs, and answers ModelReturned — the raw
// response on success, an error string on any fault, never a throw — with
// causedBy pointing at the request, so the causal chain survives the async
// hop. It knows nothing of prompts, tools, or turns: swap it for a bridge or a
// local model speaking the same two facts and the mind never notices.
//
// The key, the door, and the model are the port's resource too, kept in its
// own localStorage entries. They are set from inside the app — the ticket rack's
// KEY field and MODEL dropdown speak ModelSettingsRequested; a harness may
// emit the same fact — never from the URL. The port answers every change,
// and every late joiner (rule 9), with ModelSettingsDeclared: the door, the
// effective model, that door's model list, and a redacted hint of the key.
// The key crosses the boundary once, inbound, in the request; it is never
// re-published. Two doors speak the same wire shape: Anthropic's API, or
// OpenRouter's Anthropic-compatible endpoint (an sk-or-… key picks it unless
// the provider is set explicitly), where models wear a vendor/ namespace and
// the door serves every vendor's models through the one Messages shape —
// Anthropic, OpenAI, Google, GLM (Z.ai), DeepSeek — so the list travels as
// vendor groups, and the ticket rack renders each as an option group. Slices
// import no SDK (contracts are type-only), so this is raw fetch.
export const modelPort = defineSlice({
    type: "model-port",
    description: "Owns the model transport: ModelCallRequested in, ModelReturned out.",
    consumes: ["ModelCallRequested", "ModelSettingsRequested", "SliceMounted"],
    emits: ["ModelReturned", "ModelSettingsDeclared"],
    start(context) {
        // Two providers speak the same Messages API wire shape; only the door,
        // the auth header, and the model namespace differ. OpenRouter keys are
        // told by their prefix (sk-or-…) unless the provider is set explicitly.
        // Each door's models are shelved by vendor: Anthropic's door has one
        // shelf; OpenRouter's Messages door serves every vendor's models (tool
        // use included) under vendor/ ids, so it has a shelf per vendor. The
        // first model of the first shelf is the door's default.
        const PROVIDERS = {
            anthropic: {
                endpoint: "https://api.anthropic.com/v1/messages",
                groups: [
                    {
                        label: "anthropic",
                        models: ["claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-haiku-4-5"],
                    },
                ],
                headers: (secret) => ({
                    "x-api-key": secret,
                    "anthropic-version": "2023-06-01",
                    // The API serves browsers only when the caller says it knows the
                    // key lives in the page — this is a local dev tool on 127.0.0.1.
                    "anthropic-dangerous-direct-browser-access": "true",
                }),
            },
            openrouter: {
                endpoint: "https://openrouter.ai/api/v1/messages",
                groups: [
                    {
                        label: "anthropic",
                        models: [
                            "anthropic/claude-opus-5",
                            "anthropic/claude-sonnet-5",
                            "anthropic/claude-fable-5",
                            "anthropic/claude-opus-4.8",
                            "anthropic/claude-haiku-4.5",
                        ],
                    },
                    {
                        label: "openai",
                        models: [
                            "openai/gpt-5.6-sol",
                            "openai/gpt-5.6-terra",
                            "openai/gpt-5.6-luna",
                            "openai/gpt-5.5",
                            "openai/gpt-5.4",
                            "openai/gpt-5.4-mini",
                            "openai/gpt-5.3-codex",
                        ],
                    },
                    {
                        label: "google",
                        models: [
                            "google/gemini-3.7-flash",
                            "google/gemini-3.5-flash",
                            "google/gemini-3.1-pro-preview",
                            "google/gemini-2.5-pro",
                            "google/gemini-2.5-flash",
                        ],
                    },
                    {
                        label: "glm",
                        models: ["z-ai/glm-5.2", "z-ai/glm-5.1", "z-ai/glm-5", "z-ai/glm-5-turbo", "z-ai/glm-4.7", "z-ai/glm-4.7-flash"],
                    },
                    {
                        label: "deepseek",
                        models: [
                            "deepseek/deepseek-v4-pro",
                            "deepseek/deepseek-v4-flash",
                            "deepseek/deepseek-v3.2",
                            "deepseek/deepseek-r1-0528",
                        ],
                    },
                ],
                // OpenRouter's CORS allow-list has no anthropic-version — its door
                // is versionless, so the browser preflight must not carry it.
                headers: (secret) => ({
                    Authorization: `Bearer ${secret}`,
                    "HTTP-Referer": "http://127.0.0.1:4175/",
                    "X-Title": "Slice-IDE",
                }),
            },
        };
        const STORAGE = {
            key: "slice-ide|model-key",
            provider: "slice-ide|model-provider",
            model: "slice-ide|model-name",
        };
        const NO_KEY = "no-key | paste an API key into the ticket rack's KEY field (sk-ant-… for Anthropic, sk-or-… for OpenRouter)";
        const KEY_HINT_TAIL = 4;
        // A hot reload (this slice is adoptable) must not answer from a corpse:
        // the pool refuses emits from an unmounted instance, so async replies
        // check the flag first.
        let active = true;
        const storage = () => {
            try {
                return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
            }
            catch {
                return null;
            }
        };
        const remembered = (name) => storage()?.getItem(STORAGE[name]) ?? null;
        const remember = (name, value) => {
            const store = storage();
            if (value === null)
                store?.removeItem(STORAGE[name]);
            else
                store?.setItem(STORAGE[name], value);
        };
        // The port's resource, read from its own storage; the URL is never asked.
        let key = remembered("key");
        let provider = remembered("provider");
        let model = remembered("model");
        const isProvider = (value) => value === "anthropic" || value === "openrouter";
        // The door: set explicitly, or told by the key's prefix.
        const detectProvider = () => isProvider(provider) ? provider : key?.startsWith("sk-or-") ? "openrouter" : "anthropic";
        // OpenRouter ids wear a vendor/ prefix; Anthropic's are bare. A model that
        // visibly belongs to the other door is not carried across a flip.
        const foreignToDoor = (name, door) => door === "anthropic" ? name.includes("/") : !name.includes("/");
        // The model: the chosen one (listed or not — a harness may name any id
        // the door serves), or the door's first shelf's first.
        const shelvesOf = (door) => PROVIDERS[door].groups;
        const effectiveModel = (door) => model !== null && !foreignToDoor(model, door) ? model : shelvesOf(door)[0].models[0];
        const keyHint = () => key === null ? null : `${key.slice(0, key.startsWith("sk-or-") ? 6 : 7)}…${key.slice(-KEY_HINT_TAIL)}`;
        // Frame guard (rule 9): a burst of mounts collapses into one declaration.
        let declaredFrame = -1;
        const declare = () => {
            declaredFrame = context.frameNumber;
            const door = detectProvider();
            const chosen = effectiveModel(door);
            const shelves = shelvesOf(door);
            const listed = shelves.some((shelf) => shelf.models.includes(chosen));
            context.emit("ModelSettingsDeclared", {
                provider: door,
                model: chosen,
                // The door's shelves, plus an unlisted choice on a `custom` shelf
                // first (a harness may name any id the door serves) so the rack
                // can always show what is set.
                groups: [
                    ...(listed ? [] : [{ label: "custom", models: [chosen] }]),
                    ...shelves.map((shelf) => ({ label: shelf.label, models: [...shelf.models] })),
                ],
                keyHint: keyHint(),
            });
        };
        declare();
        context.subscribe("SliceMounted", (fact) => {
            const consumes = fact.payload.consumes;
            if (!consumes.includes("ModelSettingsDeclared") && !consumes.includes("*"))
                return;
            if (declaredFrame === context.frameNumber)
                return;
            declare();
        });
        // Settings arrive as one intent; each present field is applied, an empty
        // string forgets, and the new state is declared — the secret is stored,
        // never echoed. A door flip drops a model the new door cannot serve.
        context.subscribe("ModelSettingsRequested", (fact) => {
            const { payload } = fact;
            const before = detectProvider();
            if (payload.key !== undefined) {
                key = payload.key === "" ? null : payload.key;
                remember("key", key);
            }
            if (payload.provider !== undefined) {
                provider = payload.provider === "" ? null : payload.provider;
                remember("provider", provider);
            }
            if (payload.model !== undefined) {
                model = payload.model === "" ? null : payload.model;
                remember("model", model);
            }
            const after = detectProvider();
            if (after !== before && model !== null && foreignToDoor(model, after)) {
                model = null;
                remember("model", null);
            }
            declare();
        });
        const usageOf = (raw) => {
            const usage = (raw ?? {});
            const count = (name) => {
                const value = usage[name];
                return typeof value === "number" && Number.isFinite(value) ? value : 0;
            };
            return {
                input: count("input_tokens"),
                output: count("output_tokens"),
                cacheRead: count("cache_read_input_tokens"),
                cacheWrite: count("cache_creation_input_tokens"),
            };
        };
        context.subscribe("ModelCallRequested", (fact) => {
            const { callId, model: requested, request } = fact.payload;
            const cause = { causedBy: [fact.id] };
            const fail = (error) => {
                if (!active)
                    return;
                context.emit("ModelReturned", { callId, ok: false, error }, cause);
            };
            if (typeof fetch !== "function")
                return fail("no fetch in this host");
            const secret = key;
            if (secret === null)
                return fail(NO_KEY);
            const door = PROVIDERS[detectProvider()];
            // The request names a model, or the settings do, or the door's first
            // answers — the mind never needs to know whose door it is.
            const body = JSON.stringify({
                ...(typeof request === "object" && request !== null ? request : {}),
                model: requested ?? effectiveModel(detectProvider()),
            });
            fetch(door.endpoint, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...door.headers(secret),
                },
                body,
            })
                .then(async (response) => {
                const json = await response.json().catch(() => null);
                if (!active)
                    return;
                if (!response.ok) {
                    const message = json?.error?.message ??
                        response.statusText;
                    fail(`${response.status} ${message}`);
                    return;
                }
                context.emit("ModelReturned", {
                    callId,
                    ok: true,
                    response: json,
                    usage: usageOf(json?.usage),
                }, cause);
            })
                .catch((error) => {
                fail(error instanceof Error ? error.message : String(error));
            });
        });
        return () => {
            active = false;
        };
    },
});
