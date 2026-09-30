import type { QaView } from '../shared/types.ts';

// After a successful fix session: did it push anything? A QA fix or a conflict resolution that left the PR's head
// where it was counts as a failed session, so QA doesn't re-test the same commit and the manager hears "nothing was
// pushed" instead of another identical QA report. A checks fix may legitimately push nothing (a re-run flaky check).

/** Fix sessions in a row that may push nothing before the PR goes to the manager. */
export const MAX_UNPUSHED_FIXES = 2;

/** The parts of a QA record a finished fix reads and writes. */
export interface FixRecord extends Pick<QaView, 'prNumber' | 'status' | 'round' | 'summary' | 'mergeNote'> {
  sessionFailures: number;
  testedSha: string | null;
  passedSha: string | null;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
}

export interface FixStep {
  set: Partial<FixRecord>;
  log: { kind: 'done' | 'error'; text: string };
  toast: { kind: 'info' | 'error'; text: string };
}

/**
 * What the office does after a fix session ended well. head: the PR's head commit now, or null when GitHub couldn't
 * be asked (then it trusts the session, as before). countFailure: false while the usage limit is hit (not the PR's fault).
 */
export function fixStep(rec: FixRecord, head: string | null, opts: { agent: string; minutes: number; countFailure?: boolean }): FixStep {
  const pr = rec.prNumber;
  const merge = rec.fixReason === 'checks' || rec.fixReason === 'conflict';
  // The commit the fix started from: QA's sign-off for merge fixes, the tested commit for QA fixes.
  const before = rec.fixReason === 'conflict' ? (rec.passedSha ?? rec.testedSha) : rec.testedSha;
  if (rec.fixReason !== 'checks' && head && before && head === before) {
    const failures = rec.sessionFailures + (opts.countFailure === false ? 0 : 1);
    const needsHuman = failures >= MAX_UNPUSHED_FIXES;
    const what = rec.fixReason === 'conflict' ? 'the merge conflict was not resolved' : 'the fix was never pushed';
    const note = `No new commits were pushed: ${what} (still at ${head.slice(0, 7)}).`;
    return {
      set: needsHuman
        ? { status: 'needs-human', sessionFailures: failures, mergeNote: note, summary: rec.summary ? `${note} Last findings: ${rec.summary}` : note }
        : { status: 'failed', sessionFailures: failures },
      log: { kind: 'error', text: `✗ No new commits were pushed for PR #${pr}` },
      toast: needsHuman
        ? { kind: 'error', text: `PR #${pr} needs a human: ${failures} fix sessions pushed no commits` }
        : { kind: 'info', text: `${opts.agent} pushed nothing to PR #${pr}; it goes back for another fix` },
    };
  }
  if (merge) {
    // Back in line to merge: new commits go through QA again first, a re-run of flaky checks doesn't.
    return {
      set: { status: 'passed', mergeNote: 'waiting for fresh checks' },
      log: { kind: 'done', text: `✔ PR #${pr} fixed in ${opts.minutes}m. Back in line to merge.` },
      toast: { kind: 'info', text: `${opts.agent} fixed PR #${pr}; it merges once it passes again` },
    };
  }
  return {
    set: { status: 'queued', round: rec.round + 1, sessionFailures: 0 },
    log: { kind: 'done', text: `✔ Fix pushed for PR #${pr} in ${opts.minutes}m. Back to QA.` },
    toast: { kind: 'info', text: `${opts.agent} pushed fixes for PR #${pr}; QA round ${rec.round + 1} is queued` },
  };
}
