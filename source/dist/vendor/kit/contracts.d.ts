/**
 * Shared structural helpers. Contracts themselves are pure types in each
 * application (the runtime law travels as SchemasDeclared facts, published
 * by an app's schema-book slice and compiled by the firewall) — the kit
 * keeps only these small guards, used by the firewall and any slice that
 * inspects loosely-typed payloads.
 */
export declare const isRecord: (value: unknown) => value is Record<string, unknown>;
export declare const isFiniteNumber: (value: unknown) => value is number;
export declare const isStringArray: (value: unknown) => value is readonly string[];
