/** The process listening on a local TCP port. */
export interface IPortListener {
  pid: number;
  /** Its command line, or empty when the platform would not say. */
  commandLine: string;
  /** Its parent, grandparent and so on, nearest first. */
  ancestorPids: number[];
}

/** What a look at one port found. */
export interface IPortListenerReading {
  /** False when the platform tool to read listeners is missing or failed, so the port is unknown. */
  isReadable: boolean;
  /** The listener, or null when nothing listens there. */
  listener: IPortListener | null;
}

/** Reads the listener on a local TCP port; injected by tests. */
export type PortListenerReader = (port: number) => Promise<IPortListenerReading>;

/** Exit code and output of a platform tool that ran. */
export interface IListenerToolOutcome {
  exitCode: number;
  stdout: string;
}
