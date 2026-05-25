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

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePriorityQueryItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const query = String(item.query || item.nextQuery || '').trim();
  const nextQuery = String(item.nextQuery || item.query || '').trim();
  const term = String(item.term || '').trim();
  if (!query && !nextQuery) return null;
  return {
    ...item,
    ...(term ? { term } : {}),
    query: query || nextQuery,
    nextQuery: nextQuery || query,
  };
}

export function parsePriorityQueryContent(value) {
  const content = String(value || '').trim();
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const normalized = items.map(normalizePriorityQueryItem).filter(Boolean);
    if (normalized.length) return normalized;
  } catch {
    // Fall through to legacy text parsing.
  }
  const lines = content
    .split(/[\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (lines.every((line) => line.startsWith('{'))) {
    return lines.map((line) => {
      try {
        return normalizePriorityQueryItem(JSON.parse(line)) || line;
      } catch {
        return line;
      }
    });
  }
  return parseList(content);
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
  const requireCommentBackedEvidence = env.BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS === '1';
  const requireSourceBackedEvidence =
    requireCommentBackedEvidence ||
    env.BILIBILI_HARVEST_REQUIRE_SOURCES === '1' ||
    env.BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES === '1';
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
    lockPath: env.BILIBILI_HARVEST_LOCK_PATH || join(process.cwd(), 'server', '.keyword-harvest.lock'),
    lockStaleMs: numberFromEnv(env, 'BILIBILI_HARVEST_LOCK_STALE_MS', 6 * 60 * 60 * 1000),
    resetState: env.BILIBILI_HARVEST_RESET === '1',
    skipSeen: env.BILIBILI_HARVEST_SKIP_SEEN !== '0',
  };
}
