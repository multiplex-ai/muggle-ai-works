/** A gate wrapper's payload pre-filter, modelled in TypeScript so it can be checked on every platform. */
export interface WrapperPrefilter {
  /** Whether the wrapper's pre-filter would start Node for this hook payload (its JSON text). */
  test(payloadJson: string): boolean;
}

/** A child_process call whose options do not carry an inline `windowsHide: true`. */
export interface UnhiddenSpawnCall {
  file: string;
  line: number;
  callee: string;
}
