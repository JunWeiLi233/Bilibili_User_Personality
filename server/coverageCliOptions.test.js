import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCoverageRuntimeOptions } from './coverageCliOptions.js';

test('buildCoverageRuntimeOptions honors strict comment CLI flags', () => {
  const options = buildCoverageRuntimeOptions({
    argv: ['--strict-comment-backed', '--target-evidence', '2', '--max-actions', '7'],
    env: {},
  });

  assert.equal(options.requireCommentBackedEvidence, true);
  assert.equal(options.requireSourceBackedEvidence, true);
  assert.equal(options.prioritizeSourceGaps, true);
  assert.equal(options.targetEvidence, 2);
  assert.equal(options.maxActions, 7);
});

test('buildCoverageRuntimeOptions lets CLI flags override environment values', () => {
  const options = buildCoverageRuntimeOptions({
    argv: ['--target-evidence=2', '--max-actions=5', '--min-ratio=0.75'],
    env: {
      BILIBILI_HARVEST_TARGET_EVIDENCE: '3',
      BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS: '12',
      BILIBILI_COVERAGE_AUDIT_MIN_RATIO: '1',
    },
  });

  assert.equal(options.targetEvidence, 2);
  assert.equal(options.maxActions, 5);
  assert.equal(options.minCoverageRatio, 0.75);
});
