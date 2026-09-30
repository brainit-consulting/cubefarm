import { describe, expect, it } from 'vitest';
import { fixStep, type FixRecord } from './fixOutcome.ts';

const OLD = 'aaaaaaaaaaaaaaaaaaaa';
const NEW = 'bbbbbbbbbbbbbbbbbbbb';

function rec(patch: Partial<FixRecord> = {}): FixRecord {
  return { prNumber: 45, status: 'fixing', round: 1, summary: 'The toolbar overflows.', mergeNote: null, sessionFailures: 0, testedSha: OLD, passedSha: null, fixReason: 'qa', ...patch };
}

const opts = { agent: 'Ada', minutes: 3 };

describe('fixStep', () => {
  for (const fixReason of ['qa', null] as const) {
    it(`QA fix (${fixReason}) with a new commit goes back to QA`, () => {
      const step = fixStep(rec({ fixReason, sessionFailures: 1 }), NEW, opts);
      expect(step.set).toEqual({ status: 'queued', round: 2, sessionFailures: 0 });
      expect(step.log.text).toBe('✔ Fix pushed for PR #45 in 3m. Back to QA.');
    });

    it(`QA fix (${fixReason}) without a new commit is a failed session`, () => {
      const step = fixStep(rec({ fixReason }), OLD, opts);
      expect(step.set).toEqual({ status: 'failed', sessionFailures: 1 });
      expect(step.set.round).toBeUndefined();
      expect(step.log).toEqual({ kind: 'error', text: '✗ No new commits were pushed for PR #45' });
    });
  }

  it('the second unpushed QA fix goes to the manager, saying nothing was pushed', () => {
    const step = fixStep(rec({ sessionFailures: 1 }), OLD, opts);
    expect(step.set.status).toBe('needs-human');
    expect(step.set.sessionFailures).toBe(2);
    expect(step.set.round).toBeUndefined();
    expect(step.set.mergeNote).toMatch(/fix was never pushed/);
    expect(step.set.summary).toMatch(/^No new commits were pushed.*The toolbar overflows\.$/);
    expect(step.log.text).toBe('✗ No new commits were pushed for PR #45');
    expect(step.toast.kind).toBe('error');
  });

  it("doesn't count an unpushed fix while the usage limit is hit", () => {
    const step = fixStep(rec({ sessionFailures: 1 }), OLD, { ...opts, countFailure: false });
    expect(step.set).toEqual({ status: 'failed', sessionFailures: 1 });
  });

  it('conflict fix with a new commit goes back in line to merge', () => {
    const step = fixStep(rec({ fixReason: 'conflict', passedSha: OLD }), NEW, opts);
    expect(step.set).toEqual({ status: 'passed', mergeNote: 'waiting for fresh checks' });
    expect(step.log.text).toBe('✔ PR #45 fixed in 3m. Back in line to merge.');
  });

  it("conflict fix without a new commit is a failed session, then the manager's", () => {
    const first = fixStep(rec({ fixReason: 'conflict', passedSha: OLD }), OLD, opts);
    expect(first.set).toEqual({ status: 'failed', sessionFailures: 1 });
    expect(first.log.text).toBe('✗ No new commits were pushed for PR #45');
    const second = fixStep(rec({ fixReason: 'conflict', passedSha: OLD, sessionFailures: 1 }), OLD, opts);
    expect(second.set.status).toBe('needs-human');
    expect(second.set.mergeNote).toMatch(/conflict was not resolved/);
  });

  it('checks fix without a new commit is fine: a flaky check may have been re-run', () => {
    for (const head of [OLD, NEW]) {
      const step = fixStep(rec({ fixReason: 'checks', passedSha: OLD }), head, opts);
      expect(step.set).toEqual({ status: 'passed', mergeNote: 'waiting for fresh checks' });
      expect(step.log.kind).toBe('done');
    }
  });

  it("trusts the session when the head couldn't be read", () => {
    expect(fixStep(rec(), null, opts).set).toEqual({ status: 'queued', round: 2, sessionFailures: 0 });
    expect(fixStep(rec({ fixReason: 'conflict', passedSha: OLD }), null, opts).set.status).toBe('passed');
    expect(fixStep(rec({ testedSha: null }), OLD, opts).set.status).toBe('queued');
  });
});
