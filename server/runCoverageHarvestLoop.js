import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary } from './deepseekKeywordTrainer.js';
import { coverageDeltaFromHarvest, hasCoverageDeltaProgress } from './coverageProgress.js';
import { buildCoverageRuntimeOptions } from './coverageCliOptions.js';
import {
  buildDictionaryCoverageAudit,
  DEFAULT_HARVEST_STATE_PATH,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
} from './keywordHarvest.js';

// Default to flash/max for the auto-coverage loop, but allow an explicit opt-in
// override (deepseek-v4-pro validation) via a dedicated env var. A stray DEEPSEEK_MODEL
// in the environment is still ignored, preserving the default-flash contract.
process.env.DEEPSEEK_MODEL = process.env.BILIBILI_HARVEST_MODEL || 'deepseek-v4-flash';
process.env.DEEPSEEK_REASONING_EFFORT = process.env.BILIBILI_HARVEST_REASONING_EFFORT || 'max';

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveIntFromEnv(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

function nonNegativeIntFromEnv(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), max) : fallback;
}

function flagFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function priorityQueryItemsFromAudit(audit, limit) {
  return (audit.nextActions || [])
    .flatMap((item) => {
      const queries = [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]
        .map((query) => String(query || '').trim())
        .filter(Boolean);
      return queries.map((query) => ({ ...item, query, nextQuery: query }));
    })
    .slice(0, limit);
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await writeFile(path, `${json}\n`, 'utf8');
}

async function buildAudit(options) {
  const dictionary = await readKeywordDictionary(options.dictionaryPath ? { dictionaryPath: options.dictionaryPath } : {});
  const state = await readKeywordHarvestState(options.statePath);
  return buildDictionaryCoverageAudit(dictionary, state, options);
}

const dictionaryPath = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH;
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
const reportPath = process.env.BILIBILI_COVERAGE_LOOP_REPORT_PATH || join(process.cwd(), 'server', 'keywordCoverageLoopReport.json');
const maxCycles = nonNegativeIntFromEnv('BILIBILI_COVERAGE_LOOP_MAX_CYCLES', 3, 50);
const roundsPerCycle = positiveIntFromEnv('BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE', positiveIntFromEnv('BILIBILI_HARVEST_ROUNDS', 1), 20);
const maxQueries = positiveIntFromEnv('BILIBILI_HARVEST_MAX_QUERIES', 12, 100);
const runtimeOptions = buildCoverageRuntimeOptions({ maxActionsFallback: maxQueries });
const targetEvidence = runtimeOptions.targetEvidence;
const maxActions = runtimeOptions.maxActions;
const minCoverageRatio = runtimeOptions.minCoverageRatio;
const requireComplete = runtimeOptions.requireComplete;
const requireSourceBackedEvidence = runtimeOptions.requireSourceBackedEvidence;
const requireCommentBackedEvidence = runtimeOptions.requireCommentBackedEvidence;
const existingTermsOnly = process.env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1';
const coverageMode = String(process.env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase();
const seedQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const controversyQueries = parseList(process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || process.env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
const extraQueryTemplates = parseList(process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
const exhaustedSuggestionTemplates = parseList(process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
const discoveryMode = String(process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase();
const discoveryLimit = positiveIntFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6, 20);
const discoveryPages = positiveIntFromEnv('BILIBILI_VIDEO_DISCOVERY_PAGES', 1, 5);
const controversialPopularQueryLimit = nonNegativeIntFromEnv('BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT', 4, 20);
const controversialPopularSearchOrder = String(process.env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click').trim().toLowerCase();
const includeGenericPopular = flagFromEnv('BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR', false);
const includeDanmaku = flagFromEnv('BILIBILI_HARVEST_INCLUDE_DANMAKU', false);
const pages = positiveIntFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2, 20);
const perQueryTimeoutMs = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_TIMEOUT_MS', 180000, 30 * 60 * 1000);
const queryVariantsPerTerm = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2, 20);
const termsPerFamily = positiveIntFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4, 20);
const retryBeforeUnattemptedLimit = runtimeOptions.retryBeforeUnattemptedLimit;
const maxHardMissedQueries = nonNegativeIntFromEnv('BILIBILI_HARVEST_MAX_HARD_MISSED_QUERIES', Math.max(2, Math.ceil(maxQueries / 2)), 100);
const staleMissedDiscoveryLimit = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT', 4, 20);
const staleMissedPages = nonNegativeIntFromEnv('BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES', 3, 5);
const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';
const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
// Corpus-mode knobs: let every scan (including priority-term scans) opportunistically
// match a large pool of weak dictionary terms in the same comment section, so one
// broad high-traffic scan can lift many terms at once instead of one term per query.
const commentPoolTargetTermsLimit = positiveIntFromEnv('BILIBILI_HARVEST_COMMENT_POOL_TARGET_LIMIT', 24, 200);
const priorityCommentPoolTargets = flagFromEnv('BILIBILI_HARVEST_PRIORITY_COMMENT_POOL_TARGETS', false);
const preFilterCommentsToTargets = flagFromEnv('BILIBILI_HARVEST_PREFILTER_COMMENTS', false);
const strict = runtimeOptions.strict;
const expandTargetsFromComments = flagFromEnv('BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS', existingTermsOnly && requireCommentBackedEvidence);

const auditOptions = {
  dictionaryPath,
  statePath,
  targetEvidence,
  maxActions,
  minCoverageRatio,
  requireComplete,
  requireSourceBackedEvidence,
  requireCommentBackedEvidence,
  prioritizeSourceGaps: requireCommentBackedEvidence,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
  retryBeforeUnattemptedLimit,
};

const cycles = [];
let audit = await buildAudit(auditOptions);
let stopReason = audit.ok ? 'coverage_gate_passed' : maxCycles === 0 ? 'cycle_limit' : '';
console.log('Coverage harvest loop');
console.log(`DeepSeek model: ${process.env.DEEPSEEK_MODEL}`);
console.log(`DeepSeek reasoning effort: ${process.env.DEEPSEEK_REASONING_EFFORT}`);
console.log(`Initial coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);

for (let cycle = 1; cycle <= maxCycles && !audit.ok; cycle += 1) {
  const priorityQueries = priorityQueryItemsFromAudit(audit, maxQueries);
  if (priorityQueries.length === 0) {
    stopReason = 'no_recommended_queries';
    break;
  }
  console.log(`\nCycle ${cycle}/${maxCycles}`);
  console.log(`Priority queries: ${priorityQueries.length}`);
  for (const item of priorityQueries.slice(0, 8)) console.log(`- ${item.query}`);

  const harvest = await harvestKeywordDictionaryRounds({
    priorityQueries,
    seedQueries,
    controversyQueries,
    maxQueries,
    termsPerFamily,
    queryVariantsPerTerm,
    extraQueryTemplates,
    exhaustedSuggestionTemplates,
    retryBeforeUnattemptedLimit,
    maxHardMissedQueries,
    staleMissedDiscoveryLimit,
    staleMissedPages,
    targetEvidence,
    coverageMode,
    requireSourceBackedEvidence,
    requireCommentBackedEvidence,
    prioritizeSourceGaps: requireCommentBackedEvidence,
    commentPoolTargetTermsLimit,
    priorityCommentPoolTargets,
    preFilterCommentsToTargets,
    existingTermsOnly,
    discoveryMode,
    discoveryLimit,
    discoveryPages,
    controversialPopularQueryLimit,
    controversialPopularSearchOrder,
    includeGenericPopular,
    includeDanmaku,
    pages,
    perQueryTimeoutMs,
    expandTargetsFromComments,
    rounds: roundsPerCycle,
    statePath,
    resetState: cycle === 1 ? resetState : false,
    skipSeen,
  });
  const nextAudit = await buildAudit(auditOptions);
  const executedQueries = harvest.rounds.flatMap((round) => round.queries);
  const harvestProgressItems = harvest.rounds.map((round) => round.coverageProgress);
  const delta = coverageDeltaFromHarvest(audit.coverage, nextAudit.coverage, harvestProgressItems);
  cycles.push({
    cycle,
    priorityQueries,
    harvest: {
      ok: harvest.ok,
      rounds: harvest.rounds.length,
      queries: executedQueries,
      warnings: harvest.rounds.flatMap((round) => round.warnings || []),
      coverageProgress: harvestProgressItems,
      trainingDiagnostics: harvest.rounds.map((round) => round.trainingDiagnostics),
      queryDiagnostics: harvest.rounds.map((round) => round.queryDiagnostics || []),
    },
    coverageDelta: delta,
    coverageBefore: audit.coverage,
    coverageAfter: nextAudit.coverage,
  });
  console.log(`Coverage after cycle: ${(nextAudit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${nextAudit.coverage.weakTerms}, zero ${nextAudit.coverage.zeroEvidenceTerms}`);
  console.log(
    `Delta: deficit -${delta.evidenceDeficitReduced}, zero -${delta.zeroEvidenceResolved}, weak -${delta.weakTermsResolved}, unsourced -${delta.unsourcedEvidenceReduced}, evidence +${delta.totalEvidenceGained}, terms +${delta.termsAdded}`,
  );
  if (executedQueries.length === 0) {
    stopReason = 'no_queries_run';
    audit = nextAudit;
    break;
  }
  if (
    !hasCoverageDeltaProgress(delta) &&
    process.env.BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS === '1'
  ) {
    stopReason = 'no_coverage_progress';
    audit = nextAudit;
    break;
  }
  audit = nextAudit;
}

if (!stopReason) stopReason = audit.ok ? 'coverage_gate_passed' : 'cycle_limit';

const report = {
  generatedAt: new Date().toISOString(),
  maxCycles,
  roundsPerCycle,
  stopReason,
  finalOk: audit.ok,
  finalAudit: audit,
  cycles,
};
await writeJson(reportPath, report);
console.log(`\nFinal coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%`);
console.log(`Weak terms: ${audit.coverage.weakTerms}`);
console.log(`Zero-evidence terms: ${audit.coverage.zeroEvidenceTerms}`);
console.log(`Stop reason: ${stopReason}`);
console.log(`Coverage loop report: ${reportPath}`);

if (strict && !audit.ok) {
  process.exitCode = 1;
}
