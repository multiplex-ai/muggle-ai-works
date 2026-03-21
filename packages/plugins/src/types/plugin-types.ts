/**
 * Plugin runtime lifecycle phases.
 */
export type TPluginLifecyclePhase =
  | "beforeCommand"
  | "afterCommand"
  | "beforeToolRegistration"
  | "afterToolRegistration";

/**
 * Generic plugin context provided to lifecycle hooks.
 */
export interface IPluginContext {
  /**
   * Logical plugin identifier.
   */
  pluginName: string;
}

/**
 * Plugin lifecycle hook signature.
 */
export interface IPluginHook {
  /**
   * Hook phase.
   */
  phase: TPluginLifecyclePhase;
  /**
   * Hook implementation.
   *
   * @param pluginContext - Runtime context for the hook invocation.
   */
  run: (pluginContext: IPluginContext) => Promise<void> | void;
}
