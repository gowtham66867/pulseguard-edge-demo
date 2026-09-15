import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runProofSuite } from '../lib/evaluation.ts';

describe('browser verification harness', () => {
  it('passes every safety proof against the live agent implementation', () => {
    const report = runProofSuite();
    assert.equal(report.passed, true);
    assert.equal(report.checks.every((check) => check.passed), true);
    assert.equal(report.scenarioMatrix.every((row) => row.passed), true);
  });

  it('replays the documented workload instead of returning a canned badge', () => {
    const report = runProofSuite();
    assert.equal(report.windowsProcessed, 612);
    assert.ok(report.checks.length >= 6);
    assert.deepEqual(report.scenarioMatrix.map((row) => row.observed), [
      'MONITOR',
      'RE-MEASURE',
      'CAREGIVER',
      'CLINICIAN',
    ]);
  });
});
