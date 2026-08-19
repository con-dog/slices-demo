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
export const SCHEMAS_DECLARED = "SchemasDeclared";
const isPlainRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** The compiler: one Shape, one structural check. Extra fields pass. */
export const matchesShape = (shape, value) => {
    switch (shape.is) {
        case "string":
            return typeof value === "string" && (!shape.nonEmpty || value.length > 0);
        case "number":
            return (typeof value === "number" &&
                Number.isFinite(value) &&
                (shape.min === undefined || value >= shape.min));
        case "boolean":
            return typeof value === "boolean";
        case "literal":
            return shape.oneOf.includes(value);
        case "array":
            return (Array.isArray(value) &&
                (!shape.nonEmpty || value.length > 0) &&
                value.every((entry) => matchesShape(shape.items, entry)));
        case "record":
            return (isPlainRecord(value) &&
                Object.values(value).every((entry) => matchesShape(shape.values, entry)));
        case "object": {
            if (!isPlainRecord(value))
                return false;
            const optional = new Set(shape.optional ?? []);
            return Object.entries(shape.fields).every(([field, fieldShape]) => {
                const present = value[field];
                if (present === undefined)
                    return optional.has(field);
                return matchesShape(fieldShape, present);
            });
        }
        case "nullable":
            return value === null || matchesShape(shape.inner, value);
        case "choice": {
            if (!isPlainRecord(value))
                return false;
            const tag = value[shape.key];
            if (typeof tag !== "string")
                return false;
            const variant = shape.variants[tag];
            return variant !== undefined && matchesShape(variant, value);
        }
        case "unknown":
            return true;
    }
};
/** Terse builders so application schema maps read like the contracts they are. */
export const shape = {
    string: (options) => ({ is: "string", ...options }),
    number: (options) => ({ is: "number", ...options }),
    boolean: () => ({ is: "boolean" }),
    literal: (...oneOf) => ({
        is: "literal",
        oneOf,
    }),
    array: (items, options) => ({
        is: "array",
        items,
        ...options,
    }),
    record: (values) => ({ is: "record", values }),
    object: (fields, optional) => ({ is: "object", fields, ...(optional ? { optional } : {}) }),
    nullable: (inner) => ({ is: "nullable", inner }),
    choice: (key, variants) => ({
        is: "choice",
        key,
        variants,
    }),
    empty: () => ({ is: "object", fields: {} }),
    unknown: () => ({ is: "unknown" }),
};
// --- Shared schema data: the kernel's own facts and the kit view protocol ---
// Applications spread these into their schema maps, so every app agrees with
// the kit's slices by construction — as data, never as validator code.
export const systemSchemas = {
    SliceMounted: {
        version: 2,
        shape: shape.object({
            sliceId: shape.string(),
            sliceType: shape.string({ nonEmpty: true }),
            description: shape.string(),
            consumes: shape.array(shape.string()),
            emits: shape.array(shape.string()),
            startSource: shape.string(),
            lock: shape.number(),
        }, ["description", "lock"]),
    },
    SliceUnmounted: {
        version: 1,
        shape: shape.object({ sliceId: shape.string() }),
    },
};
export const viewProtocolSchemas = {
    ViewConfigDeclared: {
        version: 1,
        shape: shape.object({
            view: shape.string({ nonEmpty: true }),
            config: shape.record(shape.unknown()),
        }),
    },
    // `held` (slot -> holder) is the occupancy seed a stage may publish beside
    // the vocabulary; a stage that does not is still lawful.
    StageSlotsDeclared: {
        version: 2,
        shape: shape.object({
            slots: shape.array(shape.string(), { nonEmpty: true }),
            held: shape.record(shape.string()),
        }, ["held"]),
    },
    StageTokensDeclared: {
        version: 1,
        shape: shape.object({ tokens: shape.record(shape.string()) }),
    },
    ViewSlotRequested: {
        version: 1,
        shape: shape.object({ slot: shape.string() }),
    },
    // `grid` is a grid seat's placement as data beside the opaque geometry;
    // fixed seats, and stages that never say, carry none.
    ViewSlotAssigned: {
        version: 2,
        shape: shape.object({
            sliceId: shape.string(),
            slot: shape.string(),
            geometry: shape.string(),
            grid: shape.object({
                row: shape.number(),
                rowEnd: shape.number(),
                column: shape.number(),
                columnEnd: shape.number(),
            }),
        }, ["grid"]),
    },
    ViewSlotDenied: {
        version: 1,
        shape: shape.object({
            sliceId: shape.string(),
            slot: shape.string(),
            reason: shape.literal("unknown-slot", "occupied"),
        }),
    },
};
export const inspectionSchemas = {
    FactSelected: {
        version: 1,
        shape: shape.object({ factId: shape.string({ nonEmpty: true }) }),
    },
    FactDeselected: { version: 1, shape: shape.empty() },
    CausalPathTraced: {
        version: 1,
        shape: shape.object({
            rootId: shape.string(),
            factIds: shape.array(shape.string()),
        }),
    },
    SliceSelected: {
        version: 1,
        shape: shape.object({ sliceId: shape.string({ nonEmpty: true }) }),
    },
    SliceHideRequested: {
        version: 1,
        shape: shape.object({ sliceId: shape.string({ nonEmpty: true }) }),
    },
    SliceVisibilityChanged: {
        version: 1,
        shape: shape.object({
            sliceId: shape.string({ nonEmpty: true }),
            hidden: shape.boolean(),
        }),
    },
    SliceErrorChanged: {
        version: 1,
        shape: shape.object({
            sliceId: shape.string({ nonEmpty: true }),
            errored: shape.boolean(),
            message: shape.string(),
        }, ["message"]),
    },
    SliceLocksDeclared: {
        version: 1,
        shape: shape.object({ locks: shape.record(shape.number()) }),
    },
};
export const contractViolatedSchema = {
    version: 1,
    shape: shape.object({
        factId: shape.string(),
        factType: shape.string(),
        sourceSlice: shape.string(),
        reason: shape.literal("undeclared-emit", "invalid-payload", "unknown-source", "unknown-type"),
        expectedVersion: shape.number(),
    }, ["expectedVersion"]),
};
export const schemasDeclaredSchema = {
    version: 1,
    shape: shape.object({
        types: shape.array(shape.string({ nonEmpty: true }), { nonEmpty: true }),
        versions: shape.record(shape.number()),
        shapes: shape.record(shape.unknown()),
    }),
};
