/**
 * Server-only entrypoint: the state machine and code generators.
 *
 * Do NOT import this from web or mobile bundles. It is not a secret per se,
 * but shipping these functions to clients is unnecessary, bloats bundles,
 * and signals to code reviewers that authorization logic has leaked out
 * of the server.
 *
 * The package's `exports` map enforces this separation at the module
 * resolver level.
 */

export { transition, isTerminal } from "./state-machine.js";
export {
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
  assertValidDeviceCode,
} from "./codes.js";
export {
  DEVICE_CODE_BYTES,
  USER_CODE_ALPHABET,
} from "./constants.js";
