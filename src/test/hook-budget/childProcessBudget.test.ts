import { describe, expect, it, vi } from "vitest";
import { HOOK_CHILD_PROCESS_DEADLINE_MS } from "../../hook-budget/constants.js";

type BudgetModule = typeof import("../../hook-budget/childProcessBudget.js");

// The deadline is process-wide state, so each case loads a fresh copy of the module.
async function loadBudget(): Promise<BudgetModule> {
  vi.resetModules();
  return import("../../hook-budget/childProcessBudget.js");
}

describe("boundedChildTimeoutMs", () => {
  it("passes the caller's ceiling through when no hook deadline is enforced", async () => {
    const budget = await loadBudget();
    expect(budget.boundedChildTimeoutMs(10_000)).toBe(10_000);
  });

  it("cuts the ceiling to what is left of the hook budget", async () => {
    const budget = await loadBudget();
    budget.enforceHookChildProcessDeadline(Date.now());
    const timeoutMs = budget.boundedChildTimeoutMs(10_000);
    expect(timeoutMs).not.toBeNull();
    expect(timeoutMs).toBeLessThanOrEqual(HOOK_CHILD_PROCESS_DEADLINE_MS);
    expect(timeoutMs).toBeGreaterThan(0);
  });

  it("keeps a ceiling already shorter than the remaining budget", async () => {
    const budget = await loadBudget();
    budget.enforceHookChildProcessDeadline(Date.now());
    expect(budget.boundedChildTimeoutMs(5)).toBe(5);
  });

  it("returns null once the budget is spent, so no child is started", async () => {
    const budget = await loadBudget();
    budget.enforceHookChildProcessDeadline(Date.now() - HOOK_CHILD_PROCESS_DEADLINE_MS - 1);
    expect(budget.boundedChildTimeoutMs(10_000)).toBeNull();
  });
});
