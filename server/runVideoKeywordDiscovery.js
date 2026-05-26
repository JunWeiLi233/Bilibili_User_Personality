import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { withFileLock } from './fileLock.js';
import { countAcceptedEvidenceHits, harvestKeywordDictionaryRounds } from './keywordHarvest.js';
import { priorityActionItemsFromCoverageActions, serializeVideoKeywordDiscoveryReport } from './runVideoKeywordDiscoveryReport.js';
import { buildVideoKeywordDiscoveryOptions, parsePriorityQueryContent } from './runVideoKeywordDiscoveryOptions.js';

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

async function readPriorityQueryFile(path) {
  if (!path) return [];
  try {
    return parsePriorityQueryContent(await readFile(path, 'utf8'));
  } catch (error) {
    console.warn(`Could not read priority query file ${path}: ${error.message}`);
    return [];
  }
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
  const acceptedEvidenceCount = okResults.reduce((sum, item) => sum + countAcceptedEvidenceHits(item.result.entries || []), 0);
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

const priorityQueries = [
  ...(await readPriorityQueryFile(process.env.BILIBILI_HARVEST_PRIORITY_ACTION_FILE)),
  ...(await readPriorityQueryFile(process.env.BILIBILI_HARVEST_PRIORITY_QUERY_FILE)),
];
const seedQueries = [
  ...parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY),
  ...(await readListFile(process.env.BILIBILI_VIDEO_SEARCH_QUERY_FILE)),
];
const controversyQueries = parseList(process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || process.env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
const extraQueryTemplates = parseList(process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
const exhaustedSuggestionTemplates = parseList(process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
const harvestOptions = buildVideoKeywordDiscoveryOptions({
  priorityQueries,
  seedQueries,
  controversyQueries,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
});
const { statePath, reportPath, lockPath, lockStaleMs } = harvestOptions;

const result = await withFileLock(
  lockPath,
  () => harvestKeywordDictionaryRounds(harvestOptions),
  { staleMs: lockStaleMs },
);

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

if (process.env.BILIBILI_HARVEST_PRIORITY_ACTION_FILE && result.coverageActions) {
  const priorityActionItems = priorityActionItemsFromCoverageActions(result.coverageActions);
  await writeJson(process.env.BILIBILI_HARVEST_PRIORITY_ACTION_FILE, priorityActionItems);
}

await writeJson(reportPath, serializeVideoKeywordDiscoveryReport(result, statePath, reportPath));
console.log(`Harvest state: ${statePath}`);
console.log(`Harvest report: ${reportPath}`);

if (!result.ok && result.rounds.some((round) => round.queries.length > 0)) {
  console.error('No Bilibili video searches completed successfully.');
  process.exitCode = 1;
} else if (result.rounds.every((round) => round.queries.length === 0)) {
  console.log('No new queries to run. Increase BILIBILI_HARVEST_MAX_QUERIES, add new query templates in code, or set BILIBILI_HARVEST_RESET=1 to revisit prior queries.');
}
