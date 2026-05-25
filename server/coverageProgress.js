export function coverageDelta(before = {}, after = {}) {
  return {
    evidenceDeficitReduced: Math.max(0, Number(before.evidenceDeficit || 0) - Number(after.evidenceDeficit || 0)),
    zeroEvidenceResolved: Math.max(0, Number(before.zeroEvidenceTerms || 0) - Number(after.zeroEvidenceTerms || 0)),
    weakTermsResolved: Math.max(0, Number(before.weakTerms || 0) - Number(after.weakTerms || 0)),
    unsourcedEvidenceReduced: Math.max(0, Number(before.unsourcedEvidenceTerms || 0) - Number(after.unsourcedEvidenceTerms || 0)),
    totalEvidenceGained: Math.max(0, Number(after.totalEvidence || 0) - Number(before.totalEvidence || 0)),
    termsAdded: Math.max(0, Number(after.terms || 0) - Number(before.terms || 0)),
    coverageRatioDelta: Number((Number(after.coverageRatio || 0) - Number(before.coverageRatio || 0)).toFixed(4)),
  };
}

export function hasCoverageGateProgress(before = {}, after = {}) {
  const delta = coverageDelta(before, after);
  return (
    delta.evidenceDeficitReduced > 0 ||
    delta.zeroEvidenceResolved > 0 ||
    delta.weakTermsResolved > 0 ||
    delta.unsourcedEvidenceReduced > 0
  );
}
