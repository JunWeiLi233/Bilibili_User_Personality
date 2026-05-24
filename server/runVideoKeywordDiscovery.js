import { harvestKeywordDictionary } from './keywordHarvest.js';

function parseList(value) {
  return String(value || '')
    .split(/[\r\n,，;；]+/)
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

const seedQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const maxQueries = numberFromEnv('BILIBILI_HARVEST_MAX_QUERIES', seedQueries.length || 12);
const termsPerFamily = numberFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4);
const discoveryLimit = numberFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6);
const pages = numberFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2);

const result = await harvestKeywordDictionary({
  seedQueries,
  maxQueries,
  termsPerFamily,
  discoveryLimit,
  pages,
});

console.log(`Queries attempted: ${result.queries.length}`);
for (const query of result.queries) console.log(`- ${query}`);

const okResults = result.results.filter((item) => item.result?.ok);
const videosScanned = okResults.reduce((sum, item) => sum + (item.result.videos?.length || 0), 0);
const commentsCollected = okResults.reduce((sum, item) => sum + (item.result.comments?.length || 0), 0);

console.log(`Successful searches: ${okResults.length}`);
console.log(`Videos scanned: ${videosScanned}`);
console.log(`Comments collected: ${commentsCollected}`);
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

if (!result.ok) {
  console.error('No Bilibili video searches completed successfully.');
  process.exitCode = 1;
}
