/** Environment variable the Azure Monitor OpenTelemetry distro reads to choose its resource detectors. */
export const RESOURCE_DETECTORS_ENV_VAR = "OTEL_NODE_RESOURCE_DETECTORS";

/**
 * Resource detectors that read only the process and `os` module. The default set adds `host`, whose machine id is
 * read on Windows by running `REG.exe` through a console shell without `windowsHide`, which opens a console window.
 */
export const CONSOLE_FREE_RESOURCE_DETECTORS = "env,os";
