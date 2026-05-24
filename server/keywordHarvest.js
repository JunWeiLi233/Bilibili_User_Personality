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
  (term) => `${term} \u8bc4\u8bba\u533a`,
  (term) => `${term} \u6897`,
  (term) => `${term} \u53d1\u8a00`,
  (term) => `${term} \u4e89\u8bae`,
  (term) => term,
];
const DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES = [
  '{term} \u70ed\u8bc4',
  '{term} \u56de\u590d',
  '{term} \u4e92\u52a8',
  '{term} \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
  '{term} \u5207\u7247 \u8bc4\u8bba',
  '{family} {term} \u8bc4\u8bba',
];

function asPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function escapeJsonUnicode(json) {
  return json.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function evidenceCount(entry) {
  return Math.max(0, Number(entry?.evidenceCount) || 0);
}

function termAttemptKey(term) {
  return Buffer.from(String(term || ''), 'utf8').toString('base64url');
}

function getTermAttempt(termAttempts, term) {
  if (!termAttempts || typeof termAttempts !== 'object') return null;
  return termAttempts[termAttemptKey(term)] || termAttempts[term] || null;
}

function parseTemplateList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function renderQueryTemplate(template, term, family) {
  return String(template || '').replaceAll('{term}', term).replaceAll('{family}', family).trim();
}

function queryTemplatesFromOptions(options = {}) {
  const extraTemplates = parseTemplateList(options.extraQueryTemplates);
  return [
    ...TERM_QUERY_TEMPLATES.map((template) => ({ template, builtIn: true })),
    ...extraTemplates.map((template) => ({ template: (term, family) => renderQueryTemplate(template, term, family), builtIn: false })),
  ];
}

function queryVariantsForTerm(term, family, limit = TERM_QUERY_TEMPLATES.length, options = {}) {
  return queryTemplatesFromOptions(options).slice(0, limit).map((item, index) => ({
    query: item.template(term, family),
    variantIndex: index,
    builtIn: item.builtIn,
  }));
}

function attemptedVariantQueries(attempt) {
  return new Set((attempt?.queries || []).map((item) => item.query).filter(Boolean));
}

function isTermAttemptExhausted(term, family, attempt, options = {}) {
  if (!attempt || Number(attempt.successfulAttempts) > 0) return false;
  const triedQueries = attemptedVariantQueries(attempt);
  if (triedQueries.size === 0) return false;
  const templateCount = queryTemplatesFromOptions(options).length;
  return queryVariantsForTerm(term, family, templateCount, options).every((item) => triedQueries.has(item.query));
}

function sortEntriesForCoverage(entries) {
  return [...entries].sort((a, b) => evidenceCount(a) - evidenceCount(b) || String(a.term || '').localeCompare(String(b.term || '')));
}

function coverageActionRank(action) {
  return (
    {
      retry_with_new_variant: 0,
      harvest: 1,
      harvest_more_evidence: 2,
      add_query_template: 3,
      none: 9,
    }[action] ?? 8
  );
}

export function buildKeywordHarvestQueryPlan(dictionary, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 10000);
  const seedQueries = unique(options.seedQueries || DEFAULT_SEED_QUERIES);
  const coverageMode = String(options.coverageMode || 'balanced').trim().toLowerCase();
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const allEntries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const termAttempts = options.termAttempts && typeof options.termAttempts === 'object' ? options.termAttempts : {};
  const actionMap = new Map(
    buildCoverageActions(dictionary, { termAttempts }, { ...options, targetEvidence }).map((item) => [item.term, item]),
  );
  const entries =
    coverageMode === 'all-weak'
      ? allEntries
          .filter((entry) => evidenceCount(entry) < targetEvidence)
          .sort((a, b) => {
            const actionA = actionMap.get(String(a.term || '').trim());
            const actionB = actionMap.get(String(b.term || '').trim());
            return (
              coverageActionRank(actionA?.action) - coverageActionRank(actionB?.action) ||
              evidenceCount(a) - evidenceCount(b) ||
              String(a.term || '').localeCompare(String(b.term || ''))
            );
          })
      : allEntries;
  const familyCounts = new Map();
  const dictionaryPlan = [];
  const variantsPerTerm = asPositiveInt(options.queryVariantsPerTerm, 2, TERM_QUERY_TEMPLATES.length);
  const templateCount = queryTemplatesFromOptions(options).length;

  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const count = familyCounts.get(family) || 0;
    if (coverageMode !== 'all-weak' && count >= asPositiveInt(options.termsPerFamily, 4, 20)) continue;
    familyCounts.set(family, count + 1);
    const attempt = getTermAttempt(termAttempts, term);
    const attempts = Math.max(0, Number(attempt?.attempts) || 0);
    const successfulAttempts = Math.max(0, Number(attempt?.successfulAttempts) || 0);
    if (coverageMode === 'all-weak' && isTermAttemptExhausted(term, family, attempt, options)) continue;
    const triedQueries = attemptedVariantQueries(attempt);
    const adaptiveVariantsPerTerm =
      coverageMode === 'all-weak' && attempts > 0 && successfulAttempts === 0
        ? Math.min(templateCount, Math.max(variantsPerTerm, attempts + variantsPerTerm))
        : variantsPerTerm;
    const variants = queryVariantsForTerm(term, family, adaptiveVariantsPerTerm, options);
    const orderedVariants = coverageMode === 'all-weak' ? [...variants.filter((item) => !triedQueries.has(item.query)), ...variants.filter((item) => triedQueries.has(item.query))] : variants;
    for (const variant of orderedVariants) {
      dictionaryPlan.push({
        query: variant.query,
        source: 'dictionary',
        term,
        family,
        evidenceCount: evidenceCount(entry),
        priorAttempts: attempts,
        priorSuccessfulAttempts: successfulAttempts,
        variantIndex: variant.variantIndex,
        builtInVariant: variant.builtIn,
        previouslyTried: triedQueries.has(variant.query),
      });
    }
  }

  const seedPlan = seedQueries.map((query) => ({ query, source: 'seed' }));
  const orderedPlan = coverageMode === 'all-weak' ? [...dictionaryPlan, ...seedPlan] : [...seedPlan, ...dictionaryPlan];
  const seenQueries = new Set();
  const plan = [];
  for (const item of orderedPlan) {
    const query = String(item.query || '').trim();
    if (!query || seenQueries.has(query)) continue;
    seenQueries.add(query);
    plan.push({ ...item, query });
    if (plan.length >= maxQueries) break;
  }
  return plan;
}

export function buildKeywordHarvestQueries(dictionary, options = {}) {
  return buildKeywordHarvestQueryPlan(dictionary, options).map((item) => item.query);
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
      termAttempts: state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {},
      runs: Array.isArray(state.runs) ? state.runs : [],
    };
  } catch {
    return { version: 1, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] };
  }
}

async function writeKeywordHarvestState(state, statePath = DEFAULT_HARVEST_STATE_PATH) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${escapeJsonUnicode(JSON.stringify(state, null, 2))}\n`, 'utf8');
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
  const evidenceDeficit = weakEntries.reduce((sum, entry) => sum + Math.max(0, targetEvidence - evidenceCount(entry)), 0);
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
    complete: weakEntries.length === 0,
    targetEvidence,
    terms: entries.length,
    totalEvidence,
    averageEvidence: entries.length ? Number((totalEvidence / entries.length).toFixed(2)) : 0,
    coverageRatio: entries.length ? Number(((entries.length - weakEntries.length) / entries.length).toFixed(4)) : 1,
    evidenceDeficit,
    weakTerms: weakEntries.length,
    zeroEvidenceTerms: zeroEvidence.length,
    weakSamples: sortEntriesForCoverage(weakEntries).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
    })),
    zeroEvidenceSamples: sortEntriesForCoverage(zeroEvidence).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
    })),
    byFamily,
  };
}

function suggestedQueriesForExhaustedTerm(term, family, attempt, options = {}) {
  const triedQueries = attemptedVariantQueries(attempt);
  const templates = parseTemplateList(options.exhaustedSuggestionTemplates || DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES);
  return unique(templates.map((template) => renderQueryTemplate(template, term, family)))
    .filter((query) => query && !triedQueries.has(query))
    .slice(0, 8);
}

export function summarizeTermAttempts(state = {}, dictionary = {}, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const attempts = state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {};
  const attemptedTerms = Object.values(attempts).filter((item) => Number(item?.attempts) > 0);
  const successfulTerms = attemptedTerms.filter((item) => Number(item?.successfulAttempts) > 0);
  const entryTerms = new Set(entries.map((entry) => String(entry.term || '').trim()).filter(Boolean));
  const unattemptedTerms = entries
    .filter((entry) => entry.term && !getTermAttempt(attempts, entry.term))
    .map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
    }));
  const repeatedlyMissedTerms = attemptedTerms
    .filter((item) => Number(item.successfulAttempts) === 0)
    .sort((a, b) => Number(b.attempts) - Number(a.attempts) || String(a.term || '').localeCompare(String(b.term || '')))
    .slice(0, 20)
    .map((item) => ({
      term: item.term,
      family: item.family,
      attempts: Number(item.attempts) || 0,
      lastQuery: item.lastQuery || '',
      lastError: item.lastError || '',
    }));
  const exhaustedTerms = entries
    .map((entry) => {
      const term = String(entry.term || '').trim();
      const family = entry.family || 'attack';
      const attempt = getTermAttempt(attempts, term);
      return { entry, attempt, term, family };
    })
    .filter((item) => item.term && isTermAttemptExhausted(item.term, item.family, item.attempt, options))
    .sort((a, b) => evidenceCount(a.entry) - evidenceCount(b.entry) || String(a.term).localeCompare(String(b.term)))
    .slice(0, 20)
    .map((item) => ({
      term: item.term,
      family: item.family,
      evidenceCount: evidenceCount(item.entry),
      attempts: Number(item.attempt?.attempts) || 0,
      variantsTried: queryTemplatesFromOptions(options).length,
      lastQuery: item.attempt?.lastQuery || '',
      lastError: item.attempt?.lastError || '',
      suggestedQueries: suggestedQueriesForExhaustedTerm(item.term, item.family, item.attempt, options),
    }));
  return {
    attemptedTerms: attemptedTerms.filter((item) => entryTerms.has(item.term)).length,
    successfulTerms: successfulTerms.filter((item) => entryTerms.has(item.term)).length,
    unattemptedTerms: unattemptedTerms.length,
    unattemptedSamples: sortEntriesForCoverage(unattemptedTerms).slice(0, 20),
    repeatedlyMissedTerms,
    exhaustedTerms: exhaustedTerms.length,
    exhaustedSamples: exhaustedTerms,
  };
}

export function buildCoverageActions(dictionary = {}, state = {}, options = {}) {
  const entries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const attempts = state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {};
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  return entries.map((entry) => {
    const term = String(entry.term || '').trim();
    const family = entry.family || 'attack';
    const attempt = getTermAttempt(attempts, term);
    const count = evidenceCount(entry);
    const exhausted = isTermAttemptExhausted(term, family, attempt, options);
    const successfulAttempts = Number(attempt?.successfulAttempts) || 0;
    const attemptsCount = Number(attempt?.attempts) || 0;
    const triedQueries = attemptedVariantQueries(attempt);
    const availableVariants = queryVariantsForTerm(term, family, queryTemplatesFromOptions(options).length, options);
    const nextVariant = availableVariants.find((variant) => !triedQueries.has(variant.query)) || null;
    let status = 'covered';
    let action = 'none';
    if (count < targetEvidence && exhausted) {
      status = 'exhausted';
      action = 'add_query_template';
    } else if (count < targetEvidence && attemptsCount === 0) {
      status = 'weak_unattempted';
      action = 'harvest';
    } else if (count < targetEvidence && successfulAttempts === 0) {
      status = 'weak_missed';
      action = nextVariant ? 'retry_with_new_variant' : 'add_query_template';
    } else if (count < targetEvidence) {
      status = 'weak_partial';
      action = 'harvest_more_evidence';
    }
    return {
      term,
      family,
      status,
      action,
      evidenceCount: count,
      targetEvidence,
      evidenceNeeded: Math.max(0, targetEvidence - count),
      attempts: attemptsCount,
      successfulAttempts,
      exhausted,
      nextQuery: nextVariant?.query || '',
      suggestedQueries: exhausted ? suggestedQueriesForExhaustedTerm(term, family, attempt, options) : [],
      lastQuery: attempt?.lastQuery || '',
      lastError: attempt?.lastError || '',
    };
  });
}

function summarizeCoverageProgress(beforeCoverage, afterCoverage) {
  return {
    weakTermsResolved: Math.max(0, (beforeCoverage?.weakTerms || 0) - (afterCoverage?.weakTerms || 0)),
    zeroEvidenceResolved: Math.max(0, (beforeCoverage?.zeroEvidenceTerms || 0) - (afterCoverage?.zeroEvidenceTerms || 0)),
    evidenceGained: Math.max(0, (afterCoverage?.totalEvidence || 0) - (beforeCoverage?.totalEvidence || 0)),
    evidenceDeficitReduced: Math.max(0, (beforeCoverage?.evidenceDeficit || 0) - (afterCoverage?.evidenceDeficit || 0)),
  };
}

function collectEvidenceTerms(result) {
  return new Set(
    [...(result?.entries || []), ...(result?.keywordTraining?.dictionaryEvidenceEntries || [])]
      .filter((entry) => Number(entry?.evidenceCount) > 0)
      .map((entry) => String(entry.term || '').trim())
      .filter(Boolean),
  );
}

function updateTermAttempt(termAttempts, planItem, result, finishedAt) {
  if (!planItem?.term) return;
  const term = String(planItem.term).trim();
  const key = termAttemptKey(term);
  const current = getTermAttempt(termAttempts, term) || {};
  const evidenceTerms = collectEvidenceTerms(result);
  const evidenceEntry = [...(result?.entries || []), ...(result?.keywordTraining?.dictionaryEvidenceEntries || [])].find((entry) => entry?.term === term);
  const hit = evidenceTerms.has(term);
  const queryRecord = {
    at: finishedAt,
    query: planItem.query,
    ok: Boolean(result?.ok),
    hit,
    videos: result?.videos?.length || 0,
    comments: result?.comments?.length || 0,
    error: result?.error || '',
  };
  termAttempts[key] = {
    key,
    term,
    family: planItem.family || current.family || 'unknown',
    evidenceAtPlanTime: planItem.evidenceCount ?? current.evidenceAtPlanTime ?? 0,
    lastVariantIndex: planItem.variantIndex ?? current.lastVariantIndex ?? null,
    attempts: Math.max(0, Number(current.attempts) || 0) + 1,
    successfulAttempts: Math.max(0, Number(current.successfulAttempts) || 0) + (hit ? 1 : 0),
    lastAttemptAt: finishedAt,
    lastSuccessfulAt: hit ? finishedAt : current.lastSuccessfulAt || null,
    lastQuery: planItem.query,
    lastError: result?.ok ? '' : result?.error || '',
    lastEvidenceCount: hit ? Number(evidenceEntry?.evidenceCount) || 0 : Number(current.lastEvidenceCount) || 0,
    queries: [...(Array.isArray(current.queries) ? current.queries : []), queryRecord].slice(-20),
  };
}

export async function harvestKeywordDictionary(options = {}, deps = {}) {
  const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
  const searchVideoKeywords = deps.searchVideoKeywords || defaultSearchVideoKeywords;
  const statePath = options.statePath || DEFAULT_HARVEST_STATE_PATH;
  const skipSeen = options.skipSeen !== false;
  const state = options.resetState ? { version: 1, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] } : await readKeywordHarvestState(statePath);
  const before = await readKeywordDictionary();
  const beforeCoverage = summarizeEvidenceCoverage(before, { targetEvidence: options.targetEvidence });
  const searchedQuerySet = new Set(state.searchedQueries);
  const scannedBvidSet = new Set(state.scannedBvids);
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const candidatePlan = buildKeywordHarvestQueryPlan(before, {
    seedQueries: options.seedQueries,
    maxQueries: skipSeen ? Math.min(10000, maxQueries + searchedQuerySet.size) : maxQueries,
    termsPerFamily: options.termsPerFamily,
    queryVariantsPerTerm: options.queryVariantsPerTerm,
    targetEvidence: options.targetEvidence,
    coverageMode: options.coverageMode,
    termAttempts: state.termAttempts,
    extraQueryTemplates: options.extraQueryTemplates,
  });
  const plan = (skipSeen ? candidatePlan.filter((item) => !searchedQuerySet.has(item.query)) : candidatePlan).slice(0, maxQueries);
  const candidateQueries = candidatePlan.map((item) => item.query);
  const queries = plan.map((item) => item.query);
  const results = [];
  const warnings = [];
  const termAttempts = { ...state.termAttempts };

  for (const planItem of plan) {
    const query = planItem.query;
    const attemptFinishedAt = new Date().toISOString();
    try {
      const result = await searchVideoKeywords({
        searchQueries: [query],
        controversyQueries: options.controversyQueries,
        discoveryMode: options.discoveryMode,
        discoveryLimit: options.discoveryLimit,
        pages: options.pages,
        excludeBvids: skipSeen ? [...scannedBvidSet] : [],
      });
      results.push({ query, result });
      if (!result.ok) warnings.push(`${query}: ${result.error}`);
      for (const warning of result.warnings || []) warnings.push(`${query}: ${warning}`);
      searchedQuerySet.add(query);
      updateTermAttempt(termAttempts, planItem, result, attemptFinishedAt);
      for (const video of result.videos || []) {
        if (video.bvid) scannedBvidSet.add(video.bvid);
      }
    } catch (error) {
      warnings.push(`${query}: ${error.message}`);
      const result = { ok: false, error: error.message };
      results.push({ query, result });
      searchedQuerySet.add(query);
      updateTermAttempt(termAttempts, planItem, result, attemptFinishedAt);
    }
  }

  const after = await readKeywordDictionary();
  const growth = summarizeDictionaryGrowth(before, after);
  const coverage = summarizeEvidenceCoverage(after, { targetEvidence: options.targetEvidence });
  const coverageProgress = summarizeCoverageProgress(beforeCoverage, coverage);
  const termAttemptSummary = summarizeTermAttempts({ termAttempts }, after, {
    extraQueryTemplates: options.extraQueryTemplates,
    exhaustedSuggestionTemplates: options.exhaustedSuggestionTemplates,
  });
  const coverageActions = buildCoverageActions(after, { termAttempts }, {
    targetEvidence: options.targetEvidence,
    extraQueryTemplates: options.extraQueryTemplates,
    exhaustedSuggestionTemplates: options.exhaustedSuggestionTemplates,
  });
  const finishedAt = new Date().toISOString();
  const nextState = {
    version: 1,
    updatedAt: finishedAt,
    searchedQueries: [...searchedQuerySet].sort(),
    scannedBvids: [...scannedBvidSet].sort(),
    termAttempts,
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
        weakTermsResolved: coverageProgress.weakTermsResolved,
        zeroEvidenceResolved: coverageProgress.zeroEvidenceResolved,
        evidenceGained: coverageProgress.evidenceGained,
        evidenceDeficitReduced: coverageProgress.evidenceDeficitReduced,
        attemptedTerms: termAttemptSummary.attemptedTerms,
        successfulTerms: termAttemptSummary.successfulTerms,
        unattemptedTerms: termAttemptSummary.unattemptedTerms,
        exhaustedTerms: termAttemptSummary.exhaustedTerms,
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
    plan,
    results,
    warnings,
    growth,
    coverage,
    coverageProgress,
    termAttemptSummary,
    coverageActions,
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
    if ((result.coverage?.terms || 0) > 0 && result.coverage?.complete) break;
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
    termAttemptSummary: last?.termAttemptSummary || null,
    coverageActions: last?.coverageActions || null,
    dictionary: last?.dictionary || null,
  };
}
