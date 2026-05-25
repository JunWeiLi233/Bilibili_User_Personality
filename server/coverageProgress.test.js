import test from 'node:test';
import assert from 'node:assert/strict';

import { coverageDelta, hasCoverageGateProgress } from './coverageProgress.js';

test('hasCoverageGateProgress rejects dictionary growth that does not reduce coverage gaps', () => {
  const before = {
    terms: 100,
    totalEvidence: 300,
    coverageRatio: 0.35,
    evidenceDeficit: 120,
    weakTerms: 70,
    zeroEvidenceTerms: 0,
    sourcedEvidenceTerms: 100,
    unsourcedEvidenceTerms: 0,
  };
  const after = {
    terms: 102,
    totalEvidence: 305,
    coverageRatio: 0.34,
    evidenceDeficit: 120,
    weakTerms: 72,
    zeroEvidenceTerms: 0,
    sourcedEvidenceTerms: 102,
    unsourcedEvidenceTerms: 0,
  };

  assert.equal(hasCoverageGateProgress(before, after), false);
  assert.deepEqual(coverageDelta(before, after), {
    evidenceDeficitReduced: 0,
    zeroEvidenceResolved: 0,
    weakTermsResolved: 0,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 5,
    termsAdded: 2,
    coverageRatioDelta: -0.01,
  });
});

test('hasCoverageGateProgress accepts real evidence, zero, weak, or source-gap progress', () => {
  assert.equal(hasCoverageGateProgress({ evidenceDeficit: 4 }, { evidenceDeficit: 3 }), true);
  assert.equal(hasCoverageGateProgress({ zeroEvidenceTerms: 2 }, { zeroEvidenceTerms: 1 }), true);
  assert.equal(hasCoverageGateProgress({ weakTerms: 4 }, { weakTerms: 3 }), true);
  assert.equal(hasCoverageGateProgress({ unsourcedEvidenceTerms: 2 }, { unsourcedEvidenceTerms: 1 }), true);
});
