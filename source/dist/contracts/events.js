/**
 * This is the only application-level shared surface, and it is PURE TYPES:
 * event names and payload types — never behaviour, never functions, never
 * values. Slices import types from here (`import type`, lint-enforced) and
 * the definer from the kernel (`@slices/kit/define`); everything else they
 * learn arrives as facts. The runtime half of the law — every payload
 * shape as data — lives in the `schema-book` slice, which publishes it as
 * SchemasDeclared; the firewall compiles what it hears. Nothing is
 * whispered: the vocabulary, the shapes, and every configuration are pool
 * traffic.
 *
 * The document is rows of text: buffer facts carry the whole file as
 * `lines` (Life-grid style — consumers derive dimensions from the payload)
 * plus the caret as a zero-based line/column pair. Time in this app is
 * input-driven: the clock is a stepper that answers EditRequested intents
 * with FrameTicked, so game time only advances when someone types.
 */
export {};
