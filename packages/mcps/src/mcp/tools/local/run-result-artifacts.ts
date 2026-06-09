export function findFailingStepScreenshot(
  screenshotFiles: string[],
): { file: string; stepNum: number } | undefined {
  // Generation and replay halt at the failing step, so the highest-numbered
  // `stepNNN_` frame on disk is the one captured at the failure.
  let best: { file: string; stepNum: number } | undefined;
  for (const file of screenshotFiles) {
    const match = /^step(\d+)_/.exec(file);
    if (!match) continue;
    const stepNum = parseInt(match[1], 10);
    if (!best || stepNum > best.stepNum) best = { file: file, stepNum: stepNum };
  }
  return best;
}
