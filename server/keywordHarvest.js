import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary as defaultReadKeywordDictionary } from './deepseekKeywordTrainer.js';
import { searchVideoKeywords as defaultSearchVideoKeywords } from './videoKeywordSearch.js';

const DEFAULT_SEED_QUERIES = [
  'Chinese internet slang Bilibili comments',
  'Bilibili comment memes',
  'Bilibili argument comments',
];
const FAMILY_CONTEXT = {
  attack: 'Bilibili comment meme',
  absolutes: 'Bilibili absolute claim comments',
  evidence: 'Bilibili source evidence comments',
  evasion: 'Bilibili reply argument comments',
  cooperation: 'Bilibili discussion comments',
  correction: 'Bilibili correction comments',
};
const TERM_QUERY_TEMPLATES = [
  (term, family) => `${term} ${FAMILY_CONTEXT[family] || 'Bilibili comments'}`,
  (term) => `${term} Bilibili comments`,
  (term) => `${term} B\u7ad9 \u8bc4\u8bba\u533a`,
  (term) => `${term} \u54d4\u54e9\u54d4\u54e9 \u5f39\u5e55`,
  (term) => `${term} \u8bc4\u8bba \u6897`,
];

function asPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function evidenceCount(entry) {
  return Math.max(0, Number(entry?.evidenceCount) || 0);
}

function sortEntriesForCoverage(entries) {
  return [...entries].sort((a, b) => evidenceCount(a) - evidenceCount(b) || String(a.term || '').localeCompare(String(b.term || '')));
}

export function buildKeywordHarvestQueries(dictionary, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const seedQueries = unique(options.seedQueries || DEFAULT_SEED_QUERIES);
  const entries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const familyCounts = new Map();
  const dictionaryQueries = [];
  const variantsPerTerm = asPositiveInt(options.queryVariantsPerTerm, 2, TERM_QUERY_TEMPLATES.length);

  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const count = familyCounts.get(family) || 0;
    if (count >= asPositiveInt(options.termsPerFamily, 4, 20)) continue;
    familyCounts.set(family, count + 1);
    for (const template of TERM_QUERY_TEMPLATES.slice(0, variantsPerTerm)) {
      dictionaryQueries.push(template(term, family));
    }
  }

  return unique([...seedQueries, ...dictionaryQueries]).slice(0, maxQueries);
}

export const DEFAULT_HARVEST_STATE_PATH = join(process.cwd(), 'server', 'keywordHarvestState.json');

export async function readKeywordHarvestState(statePath = DEFAULT_HARVEST_STATE_PATH) {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return {
      version: state.version || 1,
      updatedAt: state.updatedAt || null,
      searchedQueries: Array.isArray(state.searchedQueries) ? state.searchedQueries : [],
      scannedBvids: Array.isArray(state.scannedBvids) ? state.scannedBvids : [],
      runs: Array.isArray(state.runs) ? state.runs : [],
    };
  } catch {
    return { version: 1, updatedAt: null, searchedQueries: [], scannedBvids: [], runs: [] };
  }
}

async function writeKeywordHarvestState(state, statePath = DEFAULT_HARVEST_STATE_PATH) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function summarizeDictionaryGrowth(before, after) {
  const beforeEntries = Array.isArray(before?.entries) ? before.entries : [];
  const afterEntries = Array.isArray(after?.entries) ? after.entries : [];
  const beforeTerms = new Set(beforeEntries.map((entry) => entry.term).filter(Boolean));
  const afterTerms = new Set(afterEntries.map((entry) => entry.term).filter(Boolean));
  const newTerms = afterEntries.filter((entry) => entry.term && !beforeTerms.has(entry.term));
  const families = {};
  for (const entry of afterEntries) {
    const family = entry.family || 'unknown';
    families[family] = (families[family] || 0) + 1;
  }
  return {
    before: beforeTerms.size,
    after: afterTerms.size,
    added: Math.max(0, afterTerms.size - beforeTerms.size),
    newTerms,
    families,
    duplicates: afterEntries.length - afterTerms.size,
  };
}

export function summarizeEvidenceCoverage(dictionary, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const totalEvidence = entries.reduce((sum, entry) => sum + evidenceCount(entry), 0);
  const weakEntries = entries.filter((entry) => evidenceCount(entry) < targetEvidence);
  const zeroEvidence = entries.filter((entry) => evidenceCount(entry) === 0);
  const byFamily = {};
  for (const entry of entries) {
    const family = entry.family || 'unknown';
    if (!byFamily[family]) byFamily[family] = { terms: 0, evidence: 0, weak: 0, zero: 0 };
    byFamily[family].terms += 1;
    byFamily[family].evidence += evidenceCount(entry);
    if (evidenceCount(entry) < targetEvidence) byFamily[family].weak += 1;
    if (evidenceCount(entry) === 0) byFamily[family].zero += 1;
  }
  return {
    targetEvidence,
    terms: entries.length,
    totalEvidence,
    averageEvidence: entries.length ? Number((totalEvidence / entries.length).toFixed(2)) : 0,
    weakTerms: weakEntries.length,
    zeroEvidenceTerms: zeroEvidence.length,
    weakSamples: sortEntriesForCoverage(weakEntries).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
    })),
    byFamily,
  };
}

export async function harvestKeywordDictionary(options = {}, deps = {}) {
  const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
  const searchVideoKeywords = deps.searchVideoKeywords || defaultSearchVideoKeywords;
  const statePath = options.statePath || DEFAULT_HARVEST_STATE_PATH;
  const skipSeen = options.skipSeen !== false;
  const state = options.resetState ? { version: 1, updatedAt: null, searchedQueries: [], scannedBvids: [], runs: [] } : await readKeywordHarvestState(statePath);
  const before = await readKeywordDictionary();
  const searchedQuerySet = new Set(state.searchedQueries);
  const scannedBvidSet = new Set(state.scannedBvids);
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const candidateQueries = buildKeywordHarvestQueries(before, {
    seedQueries: options.seedQueries,
    maxQueries: skipSeen ? Math.min(100, maxQueries + searchedQuerySet.size) : maxQueries,
    termsPerFamily: options.termsPerFamily,
    queryVariantsPerTerm: options.queryVariantsPerTerm,
  });
  const queries = (skipSeen ? candidateQueries.filter((query) => !searchedQuerySet.has(query)) : candidateQueries).slice(0, maxQueries);
  const results = [];
  const warnings = [];

  for (const query of queries) {
    try {
      const result = await searchVideoKeywords({
        searchQueries: [query],
        discoveryMode: options.discoveryMode,
        discoveryLimit: options.discoveryLimit,
        pages: options.pages,
        excludeBvids: skipSeen ? [...scannedBvidSet] : [],
      });
      results.push({ query, result });
      if (!result.ok) warnings.push(`${query}: ${result.error}`);
      for (const warning of result.warnings || []) warnings.push(`${query}: ${warning}`);
      searchedQuerySet.add(query);
      for (const video of result.videos || []) {
        if (video.bvid) scannedBvidSet.add(video.bvid);
      }
    } catch (error) {
      warnings.push(`${query}: ${error.message}`);
      results.push({ query, result: { ok: false, error: error.message } });
      searchedQuerySet.add(query);
    }
  }

  const after = await readKeywordDictionary();
  const growth = summarizeDictionaryGrowth(before, after);
  const coverage = summarizeEvidenceCoverage(after, { targetEvidence: options.targetEvidence });
  const finishedAt = new Date().toISOString();
  const nextState = {
    version: 1,
    updatedAt: finishedAt,
    searchedQueries: [...searchedQuerySet].sort(),
    scannedBvids: [...scannedBvidSet].sort(),
    runs: [
      ...state.runs.slice(-49),
      {
        at: finishedAt,
        queries: queries.length,
        successfulQueries: results.filter((item) => item.result?.ok).length,
        videosScanned: results.reduce((sum, item) => sum + (item.result?.videos?.length || 0), 0),
        commentsCollected: results.reduce((sum, item) => sum + (item.result?.comments?.length || 0), 0),
        evidenceRejected: results.reduce((sum, item) => sum + (item.result?.keywordTraining?.evidenceRejected || 0), 0),
        acceptedEvidenceCount: results.reduce(
          (sum, item) => sum + (item.result?.entries || []).reduce((entrySum, entry) => entrySum + (Number(entry.evidenceCount) || 0), 0),
          0,
        ),
        dictionaryBefore: growth.before,
        dictionaryAfter: growth.after,
        dictionaryAdded: growth.added,
        weakTerms: coverage.weakTerms,
        zeroEvidenceTerms: coverage.zeroEvidenceTerms,
        warnings: warnings.length,
      },
    ],
  };
  await writeKeywordHarvestState(nextState, statePath);

  return {
    ok: results.some((item) => item.result?.ok),
    state: nextState,
    candidateQueries,
    queries,
    results,
    warnings,
    growth,
    coverage,
    dictionary: after,
  };
}

export async function harvestKeywordDictionaryRounds(options = {}, deps = {}) {
  const rounds = asPositiveInt(options.rounds, 1, 100);
  const results = [];
  for (let index = 0; index < rounds; index += 1) {
    const result = await harvestKeywordDictionary(
      {
        ...options,
        resetState: index === 0 ? options.resetState : false,
      },
      deps,
    );
    results.push(result);
    if (result.queries.length === 0) break;
  }
  const last = results.at(-1) || null;
  return {
    ok: results.some((result) => result.ok),
    requestedRounds: rounds,
    rounds: results,
    state: last?.state || null,
    growth: last?.growth || null,
    coverage: last?.coverage || null,
    dictionary: last?.dictionary || null,
  };
}
