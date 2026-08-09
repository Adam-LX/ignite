/**
 * Ignite engine surface (approach C — in-repo, not a separate package yet).
 *
 * Import from `../engine` (or a subpath) for reusable primitives.
 * Do not import game/menu/meta/modes/ai soccer from here.
 *
 * @see docs/ENGINE.md
 */
export * from "./core";
export * from "./input";
export * from "./clip";
export * from "./audio";
export * from "./diag";
