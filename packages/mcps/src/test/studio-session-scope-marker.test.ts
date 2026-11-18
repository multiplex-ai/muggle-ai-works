/** Tests for reading Studio's session-wait lines and driving the local-execution lock from them. */

import { describe, expect, it, vi } from "vitest";

import {
  createSessionWaitLockListener,
  createStudioSessionScopeStdoutReader,
  parseStudioSessionScopeLine,
} from "../mcp/local/services/studio-session-scope-marker.js";
import { StudioSessionScopeStateEnum } from "../mcp/local/services/studio-session-scope-types.js";

vi.mock("../shared/logger.js", () => ({
  getLogger: () => ({
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const WAITING_LINE = '[muggle-session-scope] {"state":"waiting","scopeName":"persist:user-1-project-2","holderRunLabel":"workflow run r1"}';
const ACQUIRED_LINE = '[muggle-session-scope] {"state":"acquired","scopeName":"persist:user-1-project-2","holderRunLabel":"workflow run r1"}';

function createLockHandleSpy() {
  return {
    release: vi.fn(async () => undefined),
    yieldForSessionWait: vi.fn(async () => undefined),
    reclaimAfterSessionWait: vi.fn(async () => undefined),
  };
}

describe("parseStudioSessionScopeLine", () => {
  it("reads the waiting and acquired states, CRLF included", () => {
    expect(parseStudioSessionScopeLine(WAITING_LINE)).toBe(StudioSessionScopeStateEnum.Waiting);
    expect(parseStudioSessionScopeLine(`${ACQUIRED_LINE}\r`)).toBe(StudioSessionScopeStateEnum.Acquired);
  });

  it("ignores other lines, malformed payloads and unknown states", () => {
    expect(parseStudioSessionScopeLine("[studio] run started")).toBeNull();
    expect(parseStudioSessionScopeLine("[muggle-session-scope] {not json")).toBeNull();
    expect(parseStudioSessionScopeLine('[muggle-session-scope] {"state":"expired"}')).toBeNull();
  });
});

describe("createStudioSessionScopeStdoutReader", () => {
  it("tells the listener each state in order, including a line split across chunks", () => {
    const listener = vi.fn();
    const readStdout = createStudioSessionScopeStdoutReader(listener);

    readStdout(`[studio] booting\n${WAITING_LINE.slice(0, 30)}`);
    readStdout(`${WAITING_LINE.slice(30)}\n[studio] waiting\n${ACQUIRED_LINE}\n`);

    expect(listener.mock.calls).toEqual([[StudioSessionScopeStateEnum.Waiting], [StudioSessionScopeStateEnum.Acquired]]);
  });

  it("never calls the listener for a Studio that prints no session-scope line", () => {
    const listener = vi.fn();
    const readStdout = createStudioSessionScopeStdoutReader(listener);

    readStdout("[studio] booting\n[studio] run finished\n");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("createSessionWaitLockListener", () => {
  it("yields the lock on waiting and reclaims it on acquired", () => {
    const lockHandle = createLockHandleSpy();
    const listener = createSessionWaitLockListener(lockHandle);

    listener(StudioSessionScopeStateEnum.Waiting);
    expect(lockHandle.yieldForSessionWait).toHaveBeenCalledTimes(1);
    expect(lockHandle.reclaimAfterSessionWait).not.toHaveBeenCalled();

    listener(StudioSessionScopeStateEnum.Acquired);
    expect(lockHandle.reclaimAfterSessionWait).toHaveBeenCalledTimes(1);
    expect(lockHandle.release).not.toHaveBeenCalled();
  });

  it("keeps the run going when the lock cannot follow the state", async () => {
    const lockHandle = createLockHandleSpy();
    lockHandle.yieldForSessionWait.mockRejectedValueOnce(new Error("lock file unreadable"));

    expect(() => createSessionWaitLockListener(lockHandle)(StudioSessionScopeStateEnum.Waiting)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
