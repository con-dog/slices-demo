/**
 * Schemas as data. A payload contract is a Shape — a JSON-able description,
 * never a function — so the law can travel: the firewall compiles shapes
 * into validators (the way a compliance oracle compiles lint rules from
 * LintRulesDeclared) and publishes the whole map as a SchemasDeclared fact.
 * Slices that need the vocabulary or the shapes consume that fact; nothing
 * imports validation code. Applications keep their payload TYPES beside
 * these as plain TypeScript — types erase, so the type half of a contract
 * is importable by any slice under the type-only import law.
 */
export type Shape = {
    is: "string";
    nonEmpty?: true;
} | {
    is: "number";
    min?: number;
} | {
    is: "boolean";
} | {
    is: "literal";
    oneOf: readonly (string | number | boolean)[];
} | {
    is: "array";
    items: Shape;
    nonEmpty?: true;
} | {
    is: "record";
    values: Shape;
} | {
    is: "object";
    fields: Readonly<Record<string, Shape>>;
    optional?: readonly string[];
} | {
    is: "nullable";
    inner: Shape;
}
/** A discriminated union of records, switched on the `key` field. */
 | {
    is: "choice";
    key: string;
    variants: Readonly<Record<string, Shape>>;
} | {
    is: "unknown";
};
export type EventSchema = {
    version: number;
    shape: Shape;
};
export type SchemaMap = Readonly<Record<string, EventSchema>>;
/**
 * The firewall's declaration of the law (rule 9: re-published for late
 * joiners): every contracted type, its version, and its shape as data.
 */
export type SchemasDeclaredPayload = {
    types: readonly string[];
    versions: Readonly<Record<string, number>>;
    shapes: Readonly<Record<string, unknown>>;
};
export declare const SCHEMAS_DECLARED: "SchemasDeclared";
/** The compiler: one Shape, one structural check. Extra fields pass. */
export declare const matchesShape: (shape: Shape, value: unknown) => boolean;
/** Terse builders so application schema maps read like the contracts they are. */
export declare const shape: {
    readonly string: (options?: {
        nonEmpty?: true;
    }) => Shape;
    readonly number: (options?: {
        min?: number;
    }) => Shape;
    readonly boolean: () => Shape;
    readonly literal: (...oneOf: readonly (string | number | boolean)[]) => Shape;
    readonly array: (items: Shape, options?: {
        nonEmpty?: true;
    }) => Shape;
    readonly record: (values: Shape) => Shape;
    readonly object: (fields: Readonly<Record<string, Shape>>, optional?: readonly string[]) => Shape;
    readonly nullable: (inner: Shape) => Shape;
    readonly choice: (key: string, variants: Readonly<Record<string, Shape>>) => Shape;
    readonly empty: () => Shape;
    readonly unknown: () => Shape;
};
export declare const systemSchemas: SchemaMap;
export declare const viewProtocolSchemas: SchemaMap;
export declare const inspectionSchemas: SchemaMap;
export declare const contractViolatedSchema: EventSchema;
export declare const schemasDeclaredSchema: EventSchema;
