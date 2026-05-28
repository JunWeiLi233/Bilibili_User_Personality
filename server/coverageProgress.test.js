import test from 'node:test';
import assert from 'node:assert/strict';

import { coverageDelta, coverageDeltaFromHarvest, hasCoverageDeltaProgress, hasCoverageGateProgress } from './coverageProgress.js';

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

test('hasCoverageGateProgress accepts target action progress even when new weak terms offset totals', () => {
  const beforeCoverage = {
    terms: 100,
    totalEvidence: 300,
    coverageRatio: 0.35,
    evidenceDeficit: 120,
    weakTerms: 70,
    zeroEvidenceTerms: 0,
    unsourcedEvidenceTerms: 0,
  };
  const afterCoverage = {
    terms: 104,
    totalEvidence: 313,
    coverageRatio: 0.3567,
    evidenceDeficit: 123,
    weakTerms: 72,
    zeroEvidenceTerms: 0,
    unsourcedEvidenceTerms: 0,
  };

  assert.equal(
    hasCoverageGateProgress(beforeCoverage, afterCoverage, {
      beforeActions: [
        { term: '\u626e\u6f14\u5c0f\u4e11', needs: 2 },
        { term: '\u8865\u836f\u554a', needs: 2 },
      ],
      afterActions: [{ term: '\u8865\u836f\u554a', needs: 2 }],
    }),
    true,
  );
});

test('coverageDeltaFromHarvest ignores audit-only drift when harvest made no evidence progress', () => {
  const before = {
    terms: 2157,
    totalEvidence: 6033,
    coverageRatio: 0.5415,
    evidenceDeficit: 2086,
    weakTerms: 989,
    zeroEvidenceTerms: 227,
    unsourcedEvidenceTerms: 0,
  };
  const after = {
    terms: 2157,
    totalEvidence: 6035,
    coverageRatio: 0.5415,
    evidenceDeficit: 2084,
    weakTerms: 989,
    zeroEvidenceTerms: 225,
    unsourcedEvidenceTerms: 0,
  };
  const harvestProgress = [
    { weakTermsResolved: 0, zeroEvidenceResolved: 0, evidenceGained: 0, evidenceDeficitReduced: 0 },
  ];

  assert.deepEqual(coverageDeltaFromHarvest(before, after, harvestProgress), {
    evidenceDeficitReduced: 0,
    zeroEvidenceResolved: 0,
    weakTermsResolved: 0,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 0,
    termsAdded: 0,
    coverageRatioDelta: 0,
  });
  assert.equal(hasCoverageDeltaProgress(coverageDeltaFromHarvest(before, after, harvestProgress)), false);
});

test('coverageDeltaFromHarvest reports audit delta after real harvest evidence progress', () => {
  const before = { totalEvidence: 10, evidenceDeficit: 5, zeroEvidenceTerms: 2, weakTerms: 4 };
  const after = { totalEvidence: 12, evidenceDeficit: 3, zeroEvidenceTerms: 1, weakTerms: 3 };
  const harvestProgress = [
    { weakTermsResolved: 0, zeroEvidenceResolved: 1, evidenceGained: 2, evidenceDeficitReduced: 2 },
  ];

  assert.deepEqual(coverageDeltaFromHarvest(before, after, harvestProgress), {
    evidenceDeficitReduced: 2,
    zeroEvidenceResolved: 1,
    weakTermsResolved: 1,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 2,
    termsAdded: 0,
    coverageRatioDelta: 0,
  });
  assert.equal(hasCoverageDeltaProgress(coverageDeltaFromHarvest(before, after, harvestProgress)), true);
});
