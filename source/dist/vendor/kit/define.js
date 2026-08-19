/**
 * The kernel's export surface for slices. Under the import law a slice may
 * import types from its application's contracts and machinery from here —
 * nothing else. The only machination a slice needs is the definer: it binds
 * the application's event map once (currying is load-bearing, see pool.ts)
 * and is the identity at runtime. Everything else a slice touches arrives
 * as facts.
 */
export { sliceDefinerFor } from "./pool.js";
