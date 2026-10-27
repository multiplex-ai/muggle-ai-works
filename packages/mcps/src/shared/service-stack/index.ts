/** Local service-stack ledger: one set of local services shared by agents in different checkouts. */

export * from "./service-stack-types.js";
export type { IPortListener, IPortListenerReading, PortListenerReader } from "./port-listener-types.js";
export { BUSY_EXIT_CODE } from "./service-stack-constants.js";
export {
  checkServiceStack,
  claimServiceStack,
  finishStackRun,
  portOfUrl,
  readServiceStackStatus,
  reapServiceStack,
  releaseServiceStack,
  startStackRun,
} from "./service-stack.js";
export {
  decideStackClaim,
  decideStackReap,
  decideStackRelease,
  decideStackRunEnd,
  decideStackRunStart,
  findVacatedNeeds,
  needsConflict,
} from "./service-stack-decisions.js";
export { stopVacatedServices } from "./service-stopper.js";
export { describeStackMismatch } from "./stack-mismatch-description.js";
