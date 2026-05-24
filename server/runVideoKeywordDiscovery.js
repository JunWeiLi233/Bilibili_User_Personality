import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULT_HARVEST_STATE_PATH, harvestKeywordDictionaryRounds } from './keywordHarvest.js';

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

async function readListFile(path) {
  if (!path) return [];
  try {
    return parseList(await readFile(path, 'utf8'));
  } catch (error) {
    console.warn(`Could not read query file ${path}: ${error.message}`);
    return [];
  }
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeNumberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function printKeyword(entry) {
  const family = entry.family || 'unknown';
  const term = entry.term || '';
  const meaning = entry.meaning ? ` - ${entry.meaning}` : '';
  console.log(`- [${family}] ${term}${meaning}`);
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await writeFile(path, `${json}\n`, 'utf8');
}

function summarizeRound(round) {
  const okResults = round.results.filter((item) => item.result?.ok);
  const videosScanned = okResults.reduce((sum, item) => sum + (item.result.videos?.length || 0), 0);
  const commentsCollected = okResults.reduce((sum, item) => sum + (item.result.comments?.length || 0), 0);
  const evidenceRejected = okResults.reduce((sum, item) => sum + (item.result.keywordTraining?.evidenceRejected || 0), 0);
  const acceptedEvidenceCount = okResults.reduce(
    (sum, item) => sum + (item.result.entries || []).reduce((entrySum, entry) => entrySum + (Number(entry.evidenceCount) || 0), 0),
    0,
  );
  const existingDictionaryEvidenceTerms = okResults.reduce((sum, item) => sum + (item.result.keywordTraining?.dictionaryEvidenceEntries?.length || 0), 0);
  return {
    okResults,
    videosScanned,
    commentsCollected,
    evidenceRejected,
    acceptedEvidenceCount,
    existingDictionaryEvidenceTerms,
  };
}

function reportRound(round, index, total) {
  const summary = summarizeRound(round);
  console.log(`\nRound ${index + 1}/${total}`);
  console.log(`Queries generated: ${round.candidateQueries.length}`);
  console.log(`Queries attempted: ${round.queries.length}`);
  for (const query of round.queries) console.log(`- ${query}`);
  console.log(`Successful searches: ${summary.okResults.length}`);
  console.log(`Videos scanned this round: ${summary.videosScanned}`);
  console.log(`Comments collected: ${summary.commentsCollected}`);
  console.log(`Model keywords rejected without text evidence: ${summary.evidenceRejected}`);
  console.log(`Existing dictionary terms refreshed from comments: ${summary.existingDictionaryEvidenceTerms}`);
  console.log(`Accepted keyword evidence hits: ${summary.acceptedEvidenceCount}`);
  console.log(`Dictionary terms before: ${round.growth.before}`);
  console.log(`Dictionary terms after: ${round.growth.after}`);
  console.log(`New dictionary terms: ${round.growth.added}`);
  console.log(`Duplicate dictionary terms: ${round.growth.duplicates}`);
  console.log(`Weak terms resolved this round: ${round.coverageProgress.weakTermsResolved}`);
  console.log(`Zero-evidence terms resolved this round: ${round.coverageProgress.zeroEvidenceResolved}`);
  console.log(`Evidence gained this round: ${round.coverageProgress.evidenceGained}`);
  console.log(`Evidence deficit reduced this round: ${round.coverageProgress.evidenceDeficitReduced}`);
  console.log(`Weak evidence terms: ${round.coverage.weakTerms}`);
  console.log(`Zero evidence terms: ${round.coverage.zeroEvidenceTerms}`);
  console.log(`Evidence deficit remaining: ${round.coverage.evidenceDeficit}`);
  console.log(`Source-backed evidence terms: ${round.coverage.sourcedEvidenceTerms}`);
  console.log(`Coverage ratio: ${(round.coverage.coverageRatio * 100).toFixed(2)}%`);
  console.log(`Average evidence per term: ${round.coverage.averageEvidence}`);
  console.log(`Attempted dictionary terms: ${round.termAttemptSummary.attemptedTerms}`);
  console.log(`Successful dictionary terms: ${round.termAttemptSummary.successfulTerms}`);
  console.log(`Unattempted dictionary terms: ${round.termAttemptSummary.unattemptedTerms}`);
  console.log(`Exhausted dictionary terms: ${round.termAttemptSummary.exhaustedTerms}`);
}

function serializeResult(result, statePath, reportPath) {
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
      termAttemptSummary: round.termAttemptSummary,
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
        acceptedEvidenceCount: (item.result?.entries || []).reduce((sum, entry) => sum + (Number(entry.evidenceCount) || 0), 0),
        controversialPopularQueries: item.result?.controversialPopularQueries || [],
        controversialPopularSearchOrder: item.result?.controversialPopularSearchOrder || null,
        plan: round.plan?.find((planItem) => planItem.query === item.query) || null,
        entries: item.result?.entries || [],
      })),
    })),
  };
}

const priorityQueries = await readListFile(process.env.BILIBILI_HARVEST_PRIORITY_QUERY_FILE);
const seedQueries = [
  ...parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY),
  ...(await readListFile(process.env.BILIBILI_VIDEO_SEARCH_QUERY_FILE)),
];
const controversyQueries = parseList(process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || process.env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
const extraQueryTemplates = parseList(process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
const exhaustedSuggestionTemplates = parseList(process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
const maxQueries = numberFromEnv('BILIBILI_HARVEST_MAX_QUERIES', seedQueries.length || 12);
const termsPerFamily = numberFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4);
const queryVariantsPerTerm = numberFromEnv('BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2);
const targetEvidence = numberFromEnv('BILIBILI_HARVEST_TARGET_EVIDENCE', 3);
const retryBeforeUnattemptedLimit = nonNegativeNumberFromEnv('BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT', 3);
const coverageMode = String(process.env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase();
const requireSourceBackedEvidence = process.env.BILIBILI_HARVEST_REQUIRE_SOURCES === '1';
const existingTermsOnly = process.env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1';
const discoveryLimit = numberFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6);
const pages = numberFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2);
const rounds = numberFromEnv('BILIBILI_HARVEST_ROUNDS', 1);
const discoveryMode = String(process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase();
const controversialPopularQueryLimit = nonNegativeNumberFromEnv('BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT', 4);
const controversialPopularSearchOrder = String(process.env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click').trim().toLowerCase();
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
const reportPath = process.env.BILIBILI_HARVEST_REPORT_PATH || join(process.cwd(), 'server', 'keywordHarvestReport.json');
const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';

const result = await harvestKeywordDictionaryRounds({
  priorityQueries,
  seedQueries,
  controversyQueries,
  maxQueries,
  termsPerFamily,
  queryVariantsPerTerm,
  retryBeforeUnattemptedLimit,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
  targetEvidence,
  coverageMode,
  requireSourceBackedEvidence,
  existingTermsOnly,
  discoveryMode,
  discoveryLimit,
  controversialPopularQueryLimit,
  controversialPopularSearchOrder,
  pages,
  rounds,
  statePath,
  resetState,
  skipSeen,
});

for (let index = 0; index < result.rounds.length; index += 1) {
  reportRound(result.rounds[index], index, result.requestedRounds);
}

if (result.state) {
  console.log(`\nKnown scanned videos: ${result.state.scannedBvids.length}`);
  console.log(`Known searched queries: ${result.state.searchedQueries.length}`);
}

if (Object.keys(result.growth?.families || {}).length) {
  console.log('Dictionary family coverage:');
  for (const [family, count] of Object.entries(result.growth.families).sort()) {
    console.log(`- ${family}: ${count}`);
  }
}

if (result.coverage?.complete) {
  console.log(`Coverage target reached: every dictionary term has at least ${result.coverage.targetEvidence} evidence hit(s).`);
} else if (result.coverage?.weakSamples?.length) {
  console.log('Next weak dictionary terms to target:');
  for (const entry of result.coverage.weakSamples.slice(0, 10)) {
    console.log(`- [${entry.family}] ${entry.term}: ${entry.evidenceCount}/${result.coverage.targetEvidence}`);
  }
}

const nextActions = (result.coverageActions || []).filter((item) => item.action !== 'none').slice(0, 10);
if (nextActions.length) {
  console.log('Next coverage actions:');
  for (const item of nextActions) {
    const nextQuery = item.nextQuery ? `, next query "${item.nextQuery}"` : '';
    console.log(`- [${item.status}] ${item.term}: ${item.action}, needs ${item.evidenceNeeded}${nextQuery}`);
  }
}

if (result.termAttemptSummary?.repeatedlyMissedTerms?.length) {
  console.log('Dictionary terms attempted without evidence yet:');
  for (const entry of result.termAttemptSummary.repeatedlyMissedTerms.slice(0, 10)) {
    const suffix = entry.lastError ? ` (${entry.lastError})` : '';
    console.log(`- [${entry.family}] ${entry.term}: ${entry.attempts} attempt(s), last query "${entry.lastQuery}"${suffix}`);
  }
}

if (result.termAttemptSummary?.exhaustedSamples?.length) {
  console.log('Dictionary terms that exhausted built-in query variants:');
  for (const entry of result.termAttemptSummary.exhaustedSamples.slice(0, 10)) {
    const suffix = entry.lastError ? ` (${entry.lastError})` : '';
    console.log(`- [${entry.family}] ${entry.term}: ${entry.variantsTried} variant(s), last query "${entry.lastQuery}"${suffix}`);
    for (const query of entry.suggestedQueries || []) console.log(`  suggested: ${query}`);
  }
}

const warnings = result.rounds.flatMap((round) => round.warnings);
if (warnings.length) {
  console.log('Warnings:');
  for (const warning of warnings) console.log(`- ${warning}`);
}

const newTerms = result.rounds.flatMap((round) => round.growth.newTerms || []);
if (newTerms.length) {
  console.log('New keywords:');
  for (const entry of newTerms.slice(0, 40)) printKeyword(entry);
}

await writeJson(reportPath, serializeResult(result, statePath, reportPath));
console.log(`Harvest state: ${statePath}`);
console.log(`Harvest report: ${reportPath}`);

if (!result.ok && result.rounds.some((round) => round.queries.length > 0)) {
  console.error('No Bilibili video searches completed successfully.');
  process.exitCode = 1;
} else if (result.rounds.every((round) => round.queries.length === 0)) {
  console.log('No new queries to run. Increase BILIBILI_HARVEST_MAX_QUERIES, add new query templates in code, or set BILIBILI_HARVEST_RESET=1 to revisit prior queries.');
}
