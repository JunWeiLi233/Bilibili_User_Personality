import { join } from 'node:path';

import { DEFAULT_HARVEST_STATE_PATH } from './keywordHarvest.js';

function numberFromEnv(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeNumberFromEnv(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function flagFromEnv(env, name, fallback = false) {
  const value = env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function buildVideoKeywordDiscoveryOptions({
  env = process.env,
  priorityQueries = [],
  seedQueries = [],
  controversyQueries = [],
  extraQueryTemplates = [],
  exhaustedSuggestionTemplates = [],
} = {}) {
  const maxQueries = numberFromEnv(env, 'BILIBILI_HARVEST_MAX_QUERIES', seedQueries.length || 12);
  const requireSourceBackedEvidence =
    env.BILIBILI_HARVEST_REQUIRE_SOURCES === '1' ||
    env.BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES === '1';
  const requireCommentBackedEvidence = env.BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS === '1';
  return {
    priorityQueries,
    seedQueries,
    controversyQueries,
    maxQueries,
    termsPerFamily: numberFromEnv(env, 'BILIBILI_HARVEST_TERMS_PER_FAMILY', 4),
    queryVariantsPerTerm: numberFromEnv(env, 'BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2),
    retryBeforeUnattemptedLimit: nonNegativeNumberFromEnv(env, 'BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT', 3),
    staleMissedDiscoveryLimit: nonNegativeNumberFromEnv(env, 'BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT', 4),
    staleMissedPages: nonNegativeNumberFromEnv(env, 'BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES', 3),
    extraQueryTemplates,
    exhaustedSuggestionTemplates,
    targetEvidence: numberFromEnv(env, 'BILIBILI_HARVEST_TARGET_EVIDENCE', 3),
    coverageMode: String(env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase(),
    requireSourceBackedEvidence,
    requireCommentBackedEvidence,
    prioritizeSourceGaps: requireCommentBackedEvidence,
    existingTermsOnly: env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1',
    discoveryMode: String(env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase(),
    discoveryLimit: numberFromEnv(env, 'BILIBILI_VIDEO_DISCOVERY_LIMIT', 6),
    controversialPopularQueryLimit: nonNegativeNumberFromEnv(env, 'BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT', 4),
    controversialPopularSearchOrder: String(env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click').trim().toLowerCase(),
    includeGenericPopular: flagFromEnv(env, 'BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR', false),
    includeDanmaku: flagFromEnv(env, 'BILIBILI_HARVEST_INCLUDE_DANMAKU', false),
    pages: numberFromEnv(env, 'BILIBILI_VIDEO_COMMENT_PAGES', 2),
    rounds: numberFromEnv(env, 'BILIBILI_HARVEST_ROUNDS', 1),
    statePath: env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH,
    reportPath: env.BILIBILI_HARVEST_REPORT_PATH || join(process.cwd(), 'server', 'keywordHarvestReport.json'),
    resetState: env.BILIBILI_HARVEST_RESET === '1',
    skipSeen: env.BILIBILI_HARVEST_SKIP_SEEN !== '0',
  };
}

