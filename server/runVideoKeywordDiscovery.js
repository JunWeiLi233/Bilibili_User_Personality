import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { DEFAULT_HARVEST_STATE_PATH, harvestKeywordDictionary } from './keywordHarvest.js';

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function printKeyword(entry) {
  const family = entry.family || 'unknown';
  const term = entry.term || '';
  const meaning = entry.meaning ? ` - ${entry.meaning}` : '';
  console.log(`- [${family}] ${term}${meaning}`);
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

const seedQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const maxQueries = numberFromEnv('BILIBILI_HARVEST_MAX_QUERIES', seedQueries.length || 12);
const termsPerFamily = numberFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4);
const discoveryLimit = numberFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6);
const pages = numberFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2);
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
const reportPath = process.env.BILIBILI_HARVEST_REPORT_PATH || join(process.cwd(), 'server', 'keywordHarvestReport.json');
const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';

const result = await harvestKeywordDictionary({
  seedQueries,
  maxQueries,
  termsPerFamily,
  discoveryLimit,
  pages,
  statePath,
  resetState,
  skipSeen,
});

console.log(`Queries generated: ${result.candidateQueries.length}`);
console.log(`Queries attempted: ${result.queries.length}`);
for (const query of result.queries) console.log(`- ${query}`);

const okResults = result.results.filter((item) => item.result?.ok);
const videosScanned = okResults.reduce((sum, item) => sum + (item.result.videos?.length || 0), 0);
const commentsCollected = okResults.reduce((sum, item) => sum + (item.result.comments?.length || 0), 0);
const evidenceRejected = okResults.reduce((sum, item) => sum + (item.result.keywordTraining?.evidenceRejected || 0), 0);
const acceptedEvidenceCount = okResults.reduce(
  (sum, item) => sum + (item.result.entries || []).reduce((entrySum, entry) => entrySum + (Number(entry.evidenceCount) || 0), 0),
  0,
);

console.log(`Successful searches: ${okResults.length}`);
console.log(`Videos scanned this run: ${videosScanned}`);
console.log(`Known scanned videos: ${result.state.scannedBvids.length}`);
console.log(`Known searched queries: ${result.state.searchedQueries.length}`);
console.log(`Comments collected: ${commentsCollected}`);
console.log(`Model keywords rejected without text evidence: ${evidenceRejected}`);
console.log(`Accepted keyword evidence hits: ${acceptedEvidenceCount}`);
console.log(`Dictionary terms before: ${result.growth.before}`);
console.log(`Dictionary terms after: ${result.growth.after}`);
console.log(`New dictionary terms: ${result.growth.added}`);
console.log(`Duplicate dictionary terms: ${result.growth.duplicates}`);

if (Object.keys(result.growth.families).length) {
  console.log('Dictionary family coverage:');
  for (const [family, count] of Object.entries(result.growth.families).sort()) {
    console.log(`- ${family}: ${count}`);
  }
}

if (result.warnings.length) {
  console.log('Warnings:');
  for (const warning of result.warnings) console.log(`- ${warning}`);
}

if (result.growth.newTerms.length) {
  console.log('New keywords:');
  for (const entry of result.growth.newTerms.slice(0, 40)) printKeyword(entry);
}

await writeJson(reportPath, {
  generatedAt: new Date().toISOString(),
  statePath,
  reportPath,
  queries: result.queries,
  candidateQueries: result.candidateQueries,
  growth: result.growth,
  warnings: result.warnings,
  state: result.state,
  results: result.results.map((item) => ({
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
    acceptedEvidenceCount: (item.result?.entries || []).reduce((sum, entry) => sum + (Number(entry.evidenceCount) || 0), 0),
    entries: item.result?.entries || [],
  })),
});
console.log(`Harvest state: ${statePath}`);
console.log(`Harvest report: ${reportPath}`);

if (!result.ok && result.queries.length > 0) {
  console.error('No Bilibili video searches completed successfully.');
  process.exitCode = 1;
} else if (result.queries.length === 0) {
  console.log('No new queries to run. Increase BILIBILI_HARVEST_MAX_QUERIES or set BILIBILI_HARVEST_RESET=1 to revisit prior queries.');
}
