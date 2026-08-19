/**
 * Shared structural helpers. Contracts themselves are pure types in each
 * application (the runtime law travels as SchemasDeclared facts, published
 * by an app's schema-book slice and compiled by the firewall) — the kit
 * keeps only these small guards, used by the firewall and any slice that
 * inspects loosely-typed payloads.
 */
export const isRecord = (value) => typeof value === "object" && value !== null;
export const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
export const isStringArray = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
