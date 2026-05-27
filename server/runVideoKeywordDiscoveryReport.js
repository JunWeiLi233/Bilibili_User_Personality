import { countAcceptedEvidenceHitsForResult } from './keywordHarvest.js';

export function priorityActionItemsFromCoverageActions(actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .filter((item) => item?.action && item.action !== 'none')
    .flatMap((item) => {
      const queries = [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]
        .map((query) => String(query || '').trim())
        .filter(Boolean);
      return queries.map((query) => ({ ...item, query, nextQuery: query }));
    });
}

export function priorityActionItemsFromHarvestResult(result = {}) {
  return priorityActionItemsFromCoverageActions(
    Array.isArray(result.priorityCoverageActions) && result.priorityCoverageActions.length
      ? result.priorityCoverageActions
      : result.coverageActions,
  );
}

export function serializeVideoKeywordDiscoveryReport(result, statePath, reportPath) {
  return {
    generatedAt: new Date().toISOString(),
    statePath,
    reportPath,
    requestedRounds: result.requestedRounds,
    growth: result.growth,
    coverage: result.coverage,
    coverageActions: result.coverageActions,
    state: result.state,
    rounds: result.rounds.map((round, index) => ({
      round: index + 1,
      queries: round.queries,
      candidateQueries: round.candidateQueries,
      growth: round.growth,
      coverage: round.coverage,
      coverageProgress: round.coverageProgress,
      acceptedEvidenceCount: round.acceptedEvidenceCount || 0,
      coverageIncreasingAcceptedEvidenceCount: round.coverageIncreasingAcceptedEvidenceCount || 0,
      termAttemptSummary: round.termAttemptSummary,
      trainingDiagnostics: round.trainingDiagnostics,
      queryDiagnostics: round.queryDiagnostics,
      warnings: round.warnings,
      results: round.results.map((item) => ({
        query: item.query,
        ok: Boolean(item.result?.ok),
        error: item.result?.error || '',
        videos: (item.result?.videos || []).map((video) => ({
          bvid: video.bvid,
          title: video.title,
          sourceUrl: video.sourceUrl,
        })),
        comments: item.result?.comments?.length || 0,
        evidenceRejected: item.result?.keywordTraining?.evidenceRejected || 0,
        existingDictionaryEvidence: item.result?.keywordTraining?.dictionaryEvidenceEntries || [],
        acceptedEvidenceCount: countAcceptedEvidenceHitsForResult(item.result || {}),
        controversialPopularQueries: item.result?.controversialPopularQueries || [],
        controversialPopularSearchOrder: item.result?.controversialPopularSearchOrder || null,
        plan: round.plan?.find((planItem) => planItem.query === item.query) || null,
        entries: item.result?.entries || [],
      })),
    })),
  };
}
