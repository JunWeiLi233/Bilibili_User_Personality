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

function zeroDelta() {
  return {
    evidenceDeficitReduced: 0,
    zeroEvidenceResolved: 0,
    weakTermsResolved: 0,
    unsourcedEvidenceReduced: 0,
    totalEvidenceGained: 0,
    termsAdded: 0,
    coverageRatioDelta: 0,
  };
}

export function hasCoverageDeltaProgress(delta = {}) {
  return (
    Number(delta.evidenceDeficitReduced || 0) > 0 ||
    Number(delta.zeroEvidenceResolved || 0) > 0 ||
    Number(delta.weakTermsResolved || 0) > 0 ||
    Number(delta.unsourcedEvidenceReduced || 0) > 0 ||
    Number(delta.totalEvidenceGained || 0) > 0
  );
}

export function coverageDeltaFromHarvest(before = {}, after = {}, harvestProgressItems = []) {
  const items = Array.isArray(harvestProgressItems) ? harvestProgressItems : [];
  const harvestMadeEvidenceProgress = items.some((item) => (
    Number(item?.evidenceDeficitReduced || 0) > 0 ||
    Number(item?.zeroEvidenceResolved || 0) > 0 ||
    Number(item?.weakTermsResolved || 0) > 0 ||
    Number(item?.evidenceGained || 0) > 0
  ));
  return harvestMadeEvidenceProgress ? coverageDelta(before, after) : zeroDelta();
}

function actionNeed(action) {
  return Math.max(0, Number(action?.needs) || 0);
}

export function actionProgressDelta(beforeActions = [], afterActions = []) {
  const afterByTerm = new Map(
    (Array.isArray(afterActions) ? afterActions : [])
      .map((action) => [String(action?.term || '').trim(), action])
      .filter(([term]) => term),
  );
  let actionTermsResolved = 0;
  let actionEvidenceNeedReduced = 0;
  for (const action of Array.isArray(beforeActions) ? beforeActions : []) {
    const term = String(action?.term || '').trim();
    if (!term) continue;
    const beforeNeed = actionNeed(action);
    const afterAction = afterByTerm.get(term);
    if (!afterAction) {
      actionTermsResolved += 1;
      actionEvidenceNeedReduced += beforeNeed;
      continue;
    }
    actionEvidenceNeedReduced += Math.max(0, beforeNeed - actionNeed(afterAction));
  }
  return { actionTermsResolved, actionEvidenceNeedReduced };
}

export function hasCoverageGateProgress(before = {}, after = {}, options = {}) {
  const delta = coverageDelta(before, after);
  const actionDelta = actionProgressDelta(options.beforeActions, options.afterActions);
  return (
    delta.evidenceDeficitReduced > 0 ||
    delta.zeroEvidenceResolved > 0 ||
    delta.weakTermsResolved > 0 ||
    delta.unsourcedEvidenceReduced > 0 ||
    actionDelta.actionTermsResolved > 0 ||
    actionDelta.actionEvidenceNeedReduced > 0
  );
}
