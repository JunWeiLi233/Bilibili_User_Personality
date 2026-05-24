import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary } from './deepseekKeywordTrainer.js';
import {
  buildDictionaryCoverageAudit,
  DEFAULT_HARVEST_STATE_PATH,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
} from './keywordHarvest.js';

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

function numberFromEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
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
const targetEvidence = positiveIntFromEnv('BILIBILI_HARVEST_TARGET_EVIDENCE', 3, 1000);
const maxActions = positiveIntFromEnv('BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS', maxQueries, 1000);
const minCoverageRatio = numberFromEnv('BILIBILI_COVERAGE_AUDIT_MIN_RATIO', 1);
const requireComplete = process.env.BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE !== '0';
const requireSourceBackedEvidence =
  process.env.BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES === '1' ||
  process.env.BILIBILI_HARVEST_REQUIRE_SOURCES === '1';
const coverageMode = String(process.env.BILIBILI_HARVEST_COVERAGE_MODE || 'all-weak').trim().toLowerCase();
const seedQueries = parseList(process.env.BILIBILI_VIDEO_SEARCH_QUERIES || process.env.BILIBILI_VIDEO_SEARCH_QUERY);
const controversyQueries = parseList(process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES || process.env.BILIBILI_CONTROVERSY_SEARCH_QUERY);
const extraQueryTemplates = parseList(process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES);
const exhaustedSuggestionTemplates = parseList(process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES);
const discoveryMode = String(process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial').trim().toLowerCase();
const discoveryLimit = positiveIntFromEnv('BILIBILI_VIDEO_DISCOVERY_LIMIT', 6, 20);
const pages = positiveIntFromEnv('BILIBILI_VIDEO_COMMENT_PAGES', 2, 20);
const queryVariantsPerTerm = positiveIntFromEnv('BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM', 2, 20);
const termsPerFamily = positiveIntFromEnv('BILIBILI_HARVEST_TERMS_PER_FAMILY', 4, 20);
const skipSeen = process.env.BILIBILI_HARVEST_SKIP_SEEN !== '0';
const resetState = process.env.BILIBILI_HARVEST_RESET === '1';
const strict = process.env.BILIBILI_COVERAGE_LOOP_STRICT === '1';

const auditOptions = {
  dictionaryPath,
  statePath,
  targetEvidence,
  maxActions,
  minCoverageRatio,
  requireComplete,
  requireSourceBackedEvidence,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
};

const cycles = [];
let audit = await buildAudit(auditOptions);
console.log('Coverage harvest loop');
console.log(`Initial coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${audit.coverage.weakTerms}, zero ${audit.coverage.zeroEvidenceTerms}`);

for (let cycle = 1; cycle <= maxCycles && !audit.ok; cycle += 1) {
  const priorityQueries = audit.recommendedQueries.slice(0, maxQueries);
  if (priorityQueries.length === 0) break;
  console.log(`\nCycle ${cycle}/${maxCycles}`);
  console.log(`Priority queries: ${priorityQueries.length}`);
  for (const query of priorityQueries.slice(0, 8)) console.log(`- ${query}`);

  const harvest = await harvestKeywordDictionaryRounds({
    priorityQueries,
    seedQueries,
    controversyQueries,
    maxQueries,
    termsPerFamily,
    queryVariantsPerTerm,
    extraQueryTemplates,
    exhaustedSuggestionTemplates,
    targetEvidence,
    coverageMode,
    requireSourceBackedEvidence,
    discoveryMode,
    discoveryLimit,
    pages,
    rounds: roundsPerCycle,
    statePath,
    resetState: cycle === 1 ? resetState : false,
    skipSeen,
  });
  const nextAudit = await buildAudit(auditOptions);
  cycles.push({
    cycle,
    priorityQueries,
    harvest: {
      ok: harvest.ok,
      rounds: harvest.rounds.length,
      queries: harvest.rounds.flatMap((round) => round.queries),
      warnings: harvest.rounds.flatMap((round) => round.warnings || []),
      coverageProgress: harvest.rounds.map((round) => round.coverageProgress),
    },
    coverageBefore: audit.coverage,
    coverageAfter: nextAudit.coverage,
  });
  console.log(`Coverage after cycle: ${(nextAudit.coverage.coverageRatio * 100).toFixed(2)}%, weak ${nextAudit.coverage.weakTerms}, zero ${nextAudit.coverage.zeroEvidenceTerms}`);
  audit = nextAudit;
}

const report = {
  generatedAt: new Date().toISOString(),
  maxCycles,
  roundsPerCycle,
  finalOk: audit.ok,
  finalAudit: audit,
  cycles,
};
await writeJson(reportPath, report);
console.log(`\nFinal coverage: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%`);
console.log(`Weak terms: ${audit.coverage.weakTerms}`);
console.log(`Zero-evidence terms: ${audit.coverage.zeroEvidenceTerms}`);
console.log(`Coverage loop report: ${reportPath}`);

if (strict && !audit.ok) {
  process.exitCode = 1;
}
