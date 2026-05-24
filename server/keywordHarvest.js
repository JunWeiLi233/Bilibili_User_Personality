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

function asPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

export function buildKeywordHarvestQueries(dictionary, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const seedQueries = unique(options.seedQueries || DEFAULT_SEED_QUERIES);
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const familyCounts = new Map();
  const dictionaryQueries = [];

  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const count = familyCounts.get(family) || 0;
    if (count >= asPositiveInt(options.termsPerFamily, 4, 20)) continue;
    familyCounts.set(family, count + 1);
    dictionaryQueries.push(`${term} ${FAMILY_CONTEXT[family] || 'Bilibili comments'}`);
  }

  return unique([...seedQueries, ...dictionaryQueries]).slice(0, maxQueries);
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

export async function harvestKeywordDictionary(options = {}, deps = {}) {
  const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
  const searchVideoKeywords = deps.searchVideoKeywords || defaultSearchVideoKeywords;
  const before = await readKeywordDictionary();
  const queries = buildKeywordHarvestQueries(before, {
    seedQueries: options.seedQueries,
    maxQueries: options.maxQueries,
    termsPerFamily: options.termsPerFamily,
  });
  const results = [];
  const warnings = [];

  for (const query of queries) {
    try {
      const result = await searchVideoKeywords({
        searchQueries: [query],
        discoveryLimit: options.discoveryLimit,
        pages: options.pages,
      });
      results.push({ query, result });
      if (!result.ok) warnings.push(`${query}: ${result.error}`);
      for (const warning of result.warnings || []) warnings.push(`${query}: ${warning}`);
    } catch (error) {
      warnings.push(`${query}: ${error.message}`);
      results.push({ query, result: { ok: false, error: error.message } });
    }
  }

  const after = await readKeywordDictionary();
  return {
    ok: results.some((item) => item.result?.ok),
    queries,
    results,
    warnings,
    growth: summarizeDictionaryGrowth(before, after),
    dictionary: after,
  };
}
