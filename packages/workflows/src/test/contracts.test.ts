import { describe, it, expectTypeOf } from 'vitest';
import type { TaskSpec, ChangePlan, QAReport, PRInput } from './contracts.js';

describe('contracts', () => {
  it('TaskSpec has required fields', () => {
    expectTypeOf<TaskSpec>().toHaveProperty('goal');
    expectTypeOf<TaskSpec>().toHaveProperty('acceptanceCriteria');
    expectTypeOf<TaskSpec>().toHaveProperty('hintedRepos');
  });

  it('ChangePlan perRepo entries have requiredForQA', () => {
    expectTypeOf<ChangePlan['perRepo'][number]>().toHaveProperty('requiredForQA');
  });

  it('QAReport tracks passed and failed test cases', () => {
    expectTypeOf<QAReport>().toHaveProperty('passed');
    expectTypeOf<QAReport>().toHaveProperty('failed');
  });

  it('PRInput bundles all workflow artifacts', () => {
    expectTypeOf<PRInput>().toHaveProperty('taskSpec');
    expectTypeOf<PRInput>().toHaveProperty('changePlan');
    expectTypeOf<PRInput>().toHaveProperty('codeResult');
    expectTypeOf<PRInput>().toHaveProperty('qaReport');
  });
});
