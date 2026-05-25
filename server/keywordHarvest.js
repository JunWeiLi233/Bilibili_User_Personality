import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary as defaultReadKeywordDictionary } from './deepseekKeywordTrainer.js';
import { searchVideoKeywords as defaultSearchVideoKeywords } from './videoKeywordSearch.js';

const HARVEST_STRATEGY_VERSION = 3;
const DEFAULT_SEED_QUERIES = [
  '\u4e2d\u6587\u4e92\u8054\u7f51 \u6897 \u8bc4\u8bba\u533a',
  '\u8bc4\u8bba\u533a \u70ed\u8bc4 \u6897',
  '\u4e89\u8bae \u70ed\u8bc4 \u8bc4\u8bba\u533a',
  '\u8f9f\u8c23 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
  '\u79d1\u666e \u6570\u636e \u5f15\u7528 \u8bc4\u8bba',
  '\u53d1\u94fe\u63a5 \u8d34\u539f\u6587 \u51fa\u5904 \u8bc4\u8bba',
  '\u4fee\u6b63 \u66f4\u6b63 \u9053\u6b49 \u8bc4\u8bba',
  '\u4e0d\u4f1a\u767e\u5ea6 \u81ea\u5df1\u67e5 \u81ea\u5df1\u641c \u8bc4\u8bba',
  '\u7edd\u5bf9 \u5168\u662f \u6839\u672c\u6ca1\u6709 \u8bc4\u8bba',
  '\u6c34\u519b \u6d17\u5730 \u7ad9\u961f \u8bc4\u8bba\u533a',
];
const FAMILY_CONTEXT = {
  attack: '\u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
  absolutes: '\u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
  evidence: '\u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
  evasion: '\u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
  cooperation: '\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
  correction: '\u66f4\u6b63 \u8bc4\u8bba\u533a',
};
const TERM_QUERY_TEMPLATES = [
  (term, family) => `${term} ${FAMILY_CONTEXT[family] || '\u8bc4\u8bba\u533a \u70ed\u8bc4'}`,
  (term) => `${term} \u8bc4\u8bba\u533a`,
  (term) => `${term} \u70ed\u8bc4`,
  (term) => `${term} \u5f39\u5e55`,
  (term) => `${term} \u4e89\u8bae \u8bc4\u8bba\u533a`,
  (term) => `${term} \u662f\u4ec0\u4e48\u6897`,
  (term) => `${term} \u4ec0\u4e48\u610f\u601d`,
  (term) => `${term} \u51fa\u5904`,
  (term) => `${term} \u540d\u6897`,
  (term) => `${term} \u540d\u573a\u9762 \u8bc4\u8bba\u533a`,
  (term) => `${term} \u5207\u7247 \u8bc4\u8bba`,
  (term) => `${term} \u8bc4\u8bba \u6897`,
  (term) => `${term} B\u7ad9`,
  (term) => term,
];
const DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES = [
  '{term} \u70ed\u8bc4',
  '{term} \u56de\u590d',
  '{term} \u4e92\u52a8',
  '{term} \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
  '{term} \u5207\u7247 \u8bc4\u8bba',
  '{family} {term} \u8bc4\u8bba',
  '{term} \u8bc4\u8bba\u56de\u590d',
  '{term} \u56de\u590d\u533a',
  '{term} \u8282\u594f',
  '{term} \u7c89\u4e1d',
  '{term} \u76f4\u64ad\u5207\u7247',
  '{term} B\u7ad9\u8bc4\u8bba',
];
const TERM_SEARCH_ALIASES = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97': ['\u4e0d\u4f1a\u771f\u6709\u4eba', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97', '\u4e0d\u4f1a\u771f\u6709\u4eba\u4ee5\u4e3a'],
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427': ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', '\u4e0d\u4f1a\u771f\u6709\u4eba', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97'],
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427': [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
    '\u4e0d\u4f1a\u771f\u6709\u4eba',
    '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97',
    '\u8fd9\u4e5f\u53eb\u8bc1\u636e',
    '\u62ff\u8fd9\u4e2a\u5f53\u8bc1\u636e',
  ],
  '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86': ['\u8d62\u9ebb\u4e86', '\u8d62\u9ebb'],
  '\u5355\u8d706': ['\u5355\u8d70\u4e00\u4e2a6', '\u8d70\u4e00\u4e2a6'],
  '\u5355\u8d70\u4e00\u4e2a6': ['\u5355\u8d706', '\u8d70\u4e00\u4e2a6'],
  '\u8d70\u4e00\u4e2a6': ['\u5355\u8d706', '\u5355\u8d70\u4e00\u4e2a6'],
  '\u8f66\u5bb6\u519b': ['\u96f7\u519b\u7c89\u4e1d', '\u5c0f\u7c73\u8f66\u7c89', 'SU7\u7c89\u4e1d', '\u7c73\u7c89\u63a7\u8bc4', '\u5c0f\u7c73\u6c34\u519b'],
  '\u6ca1\u6709\u8f66\u5bb6\u519b': ['\u8f66\u5bb6\u519b', '\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b', '\u4e0d\u662f\u8f66\u5bb6\u519b', '\u7c73\u7c89\u63a7\u8bc4', '\u5c0f\u7c73\u6c34\u519b'],
  '\u8e6d\u6982\u5ff5': ['AI\u6982\u5ff5', '\u786c\u8e6d\u6982\u5ff5', '\u8e6d\u70ed\u5ea6'],
  '\u8c01\u662f\u8e6d\u6982\u5ff5': ['\u8e6d\u6982\u5ff5', '\u8c01\u5728\u8e6d\u6982\u5ff5', '\u8c01\u5728\u8e6dAI', '\u8e6d\u6982\u5ff5\u662f\u8c01', 'AI\u6982\u5ff5', '\u786c\u8e6d\u6982\u5ff5'],
  '\u7cbe\u795e\u5916\u56fd\u4eba': ['\u7cbe\u5916', '\u6d0b\u5974', '\u6b96\u4eba'],
  '\u524d\u9762\u8bf4\u91cd\u4e86': ['\u6211\u8bf4\u91cd\u4e86', '\u8bf4\u91cd\u4e86', '\u521a\u624d\u8bf4\u91cd\u4e86', '\u8bf4\u9519\u4e86', '\u521a\u624d\u8bf4\u9519\u4e86', '\u6211\u6536\u56de'],
  '\u95ee\u8001\u9a6c\u672c\u4eba': ['\u95ee\u672c\u4eba', '\u53bb\u95ee\u672c\u4eba', '\u95ee\u9a6c\u65af\u514b\u672c\u4eba', '\u95ee\u9a6c\u65af\u514b', '\u95ee\u57c3\u9686', 'Elon'],
  '\u53ef\u4ee5\u8d34': ['\u53ef\u4ee5\u53d1', '\u8d34\u51fa\u6765', '\u53d1\u51fa\u6765', '\u53ef\u4ee5\u8d34\u4e00\u4e0b', '\u53ef\u4ee5\u53d1\u4e00\u4e0b'],
  '\u81ea\u5df1\u67e5': ['\u81ea\u5df1\u641c', '\u4f60\u81ea\u5df1\u641c', '\u81ea\u5df1\u67e5\u53bb'],
  '\u81ea\u5df1\u67e5\u53bb': ['\u81ea\u5df1\u67e5', '\u81ea\u5df1\u641c'],
  '\u81ea\u5df1\u641c': ['\u81ea\u5df1\u67e5'],
  '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528': ['\u95ee\u767e\u5ea6'],
  '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb': ['\u9ad8\u4f4e\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u9001\u4e0a\u53bb', '\u9876\u4e0a\u53bb'],
  '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708': ['\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708', '\u6d3b\u4e0d\u8fc7\u4fe9\u6708', '\u6ca1\u6d3b\u8fc7\u4fe9\u6708'],
  '\u54ea\u90fd\u6709\u4f60': ['\u54ea\u513f\u90fd\u6709\u4f60', '\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u5230\u54ea\u90fd\u6709\u4f60'],
  '\u600e\u4e48\u54ea\u54ea\u90fd\u6709\u4f60': ['\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u54ea\u54ea\u90fd\u6709\u4f60', '\u54ea\u513f\u90fd\u6709\u4f60'],
  'tv\u574f\u7b11': ['\u574f\u7b11', 'tv\u574f\u7b11\u8868\u60c5'],
  '\u61c2\u7684\u90fd\u61c2': ['dddd'],
  dddd: ['\u61c2\u7684\u90fd\u61c2'],
  yygq: ['\u9634\u9633\u602a\u6c14'],
  pink: ['\u7c89\u7ea2', '\u5c0f\u7c89\u7ea2'],
};
const TERM_TOPIC_CONTEXTS = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u8bc1\u636e', '\u79d1\u666e', '\u6d4b\u8bc4'],
  '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97': ['\u8bc1\u636e', '\u79d1\u666e', '\u6d4b\u8bc4'],
  '\u8fd9\u4e5f\u53eb\u8bc1\u636e': ['\u8bc1\u636e', '\u8f9f\u8c23', '\u8bc4\u8bba\u533a'],
  '\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', '\u7279\u65af\u62c9', '\u65b0\u80fd\u6e90\u8f66', '\u96f7\u519b', 'SU7', '\u8f66\u5708'],
  '\u96f7\u519b\u7c89\u4e1d': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u8f66\u5708'],
  '\u7c73\u7c89\u63a7\u8bc4': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u5c0f\u7c73\u6c34\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u6ca1\u6709\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', '\u7279\u65af\u62c9', '\u65b0\u80fd\u6e90\u8f66', '\u96f7\u519b', 'SU7'],
  '\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8', '\u5143\u5b87\u5b99', '\u533a\u5757\u94fe'],
  'AI\u6982\u5ff5': ['AI', '\u79d1\u6280\u516c\u53f8', '\u4eba\u5de5\u667a\u80fd'],
  '\u8c01\u662f\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8', '\u5143\u5b87\u5b99'],
  '\u8c01\u5728\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8'],
  '\u8c01\u5728\u8e6dAI': ['AI', '\u79d1\u6280\u516c\u53f8', '\u4eba\u5de5\u667a\u80fd'],
  '\u7cbe\u795e\u5916\u56fd\u4eba': ['\u56fd\u9645\u653f\u6cbb', '\u65f6\u653f', '\u7559\u5b66', '\u4e2d\u7f8e', '\u56fd\u5916'],
  '\u7cbe\u5916': ['\u56fd\u9645\u653f\u6cbb', '\u65f6\u653f', '\u4e2d\u7f8e'],
  '\u6211\u8bf4\u91cd\u4e86': ['\u76f4\u64ad\u5207\u7247', '\u66f4\u6b63', '\u9053\u6b49'],
  '\u8bf4\u9519\u4e86': ['\u66f4\u6b63', '\u76f4\u64ad\u5207\u7247', '\u6536\u56de'],
  '\u95ee\u9a6c\u65af\u514b\u672c\u4eba': ['\u7279\u65af\u62c9', '\u5c0f\u7c73\u6c7d\u8f66', '\u8bbf\u8c08'],
  '\u95ee\u9a6c\u65af\u514b': ['\u7279\u65af\u62c9', '\u8bbf\u8c08', '\u9a6c\u65af\u514b\u91c7\u8bbf'],
  '\u9001\u4e0a\u53bb': ['\u8bc4\u8bba\u533a', '\u56de\u590d', '\u7f6e\u9876'],
  '\u9876\u4e0a\u53bb': ['\u8bc4\u8bba\u533a', '\u56de\u590d', '\u7f6e\u9876'],
  '\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708': ['\u8282\u594f', '\u70ed\u8bc4', '\u56de\u590d\u533a'],
  '\u54ea\u513f\u90fd\u6709\u4f60': ['\u70ed\u8bc4', '\u56de\u590d\u533a', '\u8bc4\u8bba\u533a'],
  '\u574f\u7b11': ['\u5f39\u5e55', '\u8868\u60c5', '\u70ed\u8bc4'],
};
const TERM_PRECISION_QUERIES = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u4e0d\u4f1a\u771f\u6709\u4eba \u8bc1\u636e \u56de\u590d', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97 \u8bc1\u636e', '\u8fd9\u4e5f\u53eb\u8bc1\u636e \u8bc4\u8bba'],
  '\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66 \u8f66\u5bb6\u519b \u63a7\u8bc4', '\u96f7\u519b \u8f66\u5bb6\u519b \u70ed\u8bc4', '\u7c73\u7c89\u63a7\u8bc4 SU7', '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4'],
  '\u8e6d\u6982\u5ff5': ['\u8e6d\u6982\u5ff5\u662f\u8c01 AI', '\u8c01\u5728\u8e6d\u6982\u5ff5 AI', '\u786c\u8e6dAI\u6982\u5ff5', '\u8e6d\u6982\u5ff5 \u6e38\u620f\u516c\u53f8'],
};
const TERM_NEGATIVE_FEEDBACK_QUERIES = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u539f\u8bdd', '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427 \u8bc4\u8bba', '\u8fd9\u53eb\u8bc1\u636e\u5427 \u4e0d\u4f1a\u771f\u6709\u4eba'],
  '\u8f66\u5bb6\u519b': ['\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a', '\u6ca1\u6709\u8f66\u5bb6\u519b \u5c0f\u7c73SU7', '\u8f66\u5bb6\u519b \u96f7\u519b \u539f\u8bdd'],
  '\u8e6d\u6982\u5ff5': ['\u8c01\u662f\u8e6d\u6982\u5ff5 \u539f\u8bdd', '\u8c01\u662f\u8e6d\u6982\u5ff5 \u8bc4\u8bba', '\u8e6d\u6982\u5ff5\u662f\u8c01 \u539f\u8bdd'],
};

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

function hasEvidenceSource(entry) {
  return evidenceCount(entry) > 0 && Array.isArray(entry?.evidenceSources) && entry.evidenceSources.length > 0;
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

function normalizeQueryText(query) {
  const seen = new Set();
  return String(query || '')
    .trim()
    .split(/\s+/)
    .filter((token) => {
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    })
    .join(' ');
}

function renderQueryTemplate(template, term, family) {
  return normalizeQueryText(String(template || '').replaceAll('{term}', term).replaceAll('{family}', family));
}

function queryTemplatesFromOptions(options = {}) {
  const extraTemplates = parseTemplateList(options.extraQueryTemplates);
  const exhaustedTemplates =
    options.includeExhaustedFallbackTemplates === false ? [] : parseTemplateList(options.exhaustedSuggestionTemplates || DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES);
  return [
    ...TERM_QUERY_TEMPLATES.map((template) => ({ template, builtIn: true })),
    ...extraTemplates.map((template) => ({ template: (term, family) => renderQueryTemplate(template, term, family), builtIn: false })),
    ...exhaustedTemplates.map((template) => ({ template: (term, family) => renderQueryTemplate(template, term, family), builtIn: false })),
  ];
}

function searchTermsForTerm(term) {
  return unique([term, ...(TERM_SEARCH_ALIASES[String(term || '').trim()] || [])]);
}

function isCompactMetricSearchTerm(term) {
  return /^[0-9]+(?:\.[0-9]+)?(?:[wW\u4e07kK\u79d2sSrR][0-9]*(?:\.[0-9]+)?)?$/.test(String(term || '').trim());
}

function coveragePriorityPenalty(item = {}) {
  const term = String(item.term || '').trim();
  if (!term) return 0;
  if (isCompactMetricSearchTerm(term)) return 3;
  if (/^[A-Za-z0-9]+$/.test(term) && /\d/.test(term)) return 2;
  return 0;
}

function contextualQueriesForTerm(term) {
  return unique(
    searchTermsForTerm(term).flatMap((searchTerm) => {
      const contexts = TERM_TOPIC_CONTEXTS[searchTerm] || [];
      return contexts.flatMap((context) => [
        normalizeQueryText(`${searchTerm} ${context} \u8bc4\u8bba\u533a`),
        normalizeQueryText(`${context} ${searchTerm} \u70ed\u8bc4`),
      ]);
    }),
  );
}

function hasSharedSearchAlias(termA, termB) {
  const aliasesA = new Set(searchTermsForTerm(termA));
  return searchTermsForTerm(termB).some((term) => aliasesA.has(term));
}

function relatedTargetExistingTerms(dictionary, planItem, options = {}) {
  const term = String(planItem?.term || '').trim();
  if (!term) return [];
  const family = String(planItem?.family || '').trim();
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 100);
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  return unique(
    entries
      .filter((entry) => {
        const entryTerm = String(entry?.term || '').trim();
        if (!entryTerm) return false;
        if (family && String(entry?.family || '').trim() !== family) return false;
        if (evidenceCount(entry) >= targetEvidence) return false;
        return entryTerm === term || hasSharedSearchAlias(term, entryTerm);
      })
      .map((entry) => entry.term),
  ).slice(0, 8);
}

function queryVariantCountForTerm(term, options = {}) {
  return queryTemplatesFromOptions(options).length * searchTermsForTerm(term).length + contextualQueriesForTerm(term).length;
}

function queryVariantsForTerm(term, family, limit = TERM_QUERY_TEMPLATES.length, options = {}) {
  const variants = [];
  const templateItems = queryTemplatesFromOptions(options);
  const searchTerms = searchTermsForTerm(term);
  const pushManualVariant = (query, builtIn = true) => {
    variants.push({
      query: normalizeQueryText(query),
      variantIndex: variants.length,
      builtIn,
    });
  };
  const pushTemplateVariant = (item, searchTerm) => {
    variants.push({
      query: normalizeQueryText(item.template(searchTerm, family)),
      variantIndex: variants.length,
      builtIn: item.builtIn,
    });
  };
  for (const searchTerm of searchTerms.filter(isCompactMetricSearchTerm)) {
    pushManualVariant(searchTerm);
    pushManualVariant(`${searchTerm} \u70ed\u8bc4`);
    pushManualVariant(`${searchTerm} \u8bc4\u8bba\u533a`);
  }
  const [primaryTemplate, ...remainingTemplates] = templateItems;
  if (primaryTemplate) {
    for (const searchTerm of searchTerms) pushTemplateVariant(primaryTemplate, searchTerm);
  }
  for (const query of contextualQueriesForTerm(term)) {
    variants.push({
      query,
      variantIndex: variants.length,
      builtIn: true,
    });
  }
  for (const item of remainingTemplates) {
    for (const searchTerm of searchTerms) {
      variants.push({
        query: item.template(searchTerm, family),
        variantIndex: variants.length,
        builtIn: item.builtIn,
      });
    }
  }
  return unique(variants.map((item) => item.query))
    .map((query) => variants.find((item) => item.query === query))
    .slice(0, limit);
}

function attemptedVariantQueries(attempt, options = {}) {
  const requireCurrentStrategyVersion = options.requireCurrentStrategyVersion === true;
  const assumeLegacyQueriesCurrent = options.assumeLegacyQueriesCurrent === true;
  return new Set(
    (attempt?.queries || [])
      .filter(
        (item) =>
          !requireCurrentStrategyVersion ||
          item.hit === true ||
          Number(item.strategyVersion || 0) >= HARVEST_STRATEGY_VERSION ||
          (assumeLegacyQueriesCurrent && !Number(item.strategyVersion || 0)),
      )
      .map((item) => item.query)
      .filter(Boolean),
  );
}

function isTermAttemptExhausted(term, family, attempt, options = {}) {
  if (!attempt || Number(attempt.successfulAttempts) > 0) return false;
  const triedQueries = attemptedVariantQueries(attempt);
  if (triedQueries.size === 0) return false;
  return queryVariantsForTerm(term, family, queryVariantCountForTerm(term, options), options).every((item) => triedQueries.has(item.query));
}

function isRepeatedlyMissedAttempt(attempt, threshold = 3) {
  return (
    attempt &&
    Math.max(0, Number(attempt.attempts) || 0) >= Math.max(1, Number(threshold) || 1) &&
    Math.max(0, Number(attempt.successfulAttempts) || 0) === 0
  );
}

function isHardMissedZeroEvidenceAttempt(attempt, threshold = 3) {
  const retryThreshold = Math.max(1, Number(threshold) || 1);
  const evidenceAtPlanTime = Math.max(0, Number(attempt?.evidenceAtPlanTime) || 0);
  const lastEvidenceCount = Math.max(0, Number(attempt?.lastEvidenceCount) || 0);
  return isRepeatedlyMissedAttempt(attempt, retryThreshold) && Math.max(0, Number(attempt?.attempts) || 0) >= retryThreshold * 2 && evidenceAtPlanTime === 0 && lastEvidenceCount === 0;
}

function isHardMissedPlanItem(planItem, termAttempts, retryBeforeUnattemptedLimit) {
  if (!planItem?.term) return false;
  return isHardMissedZeroEvidenceAttempt(getTermAttempt(termAttempts, planItem.term), retryBeforeUnattemptedLimit);
}

function selectHarvestPlan(candidatePlan, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const defaultHardMissedQueries = Math.max(2, Math.ceil(maxQueries / 2));
  const maxHardMissedQueries = Math.max(0, Number(options.maxHardMissedQueries ?? defaultHardMissedQueries) || 0);
  const termAttempts = options.termAttempts && typeof options.termAttempts === 'object' ? options.termAttempts : {};
  const searchedQuerySet = options.searchedQuerySet instanceof Set ? options.searchedQuerySet : new Set();
  const skipSeen = options.skipSeen !== false;
  const selected = [];
  const selectedHardMissedTerms = new Set();
  for (const item of candidatePlan) {
    if (selected.length >= maxQueries) break;
    const query = String(item?.query || '').trim();
    const hardMissed = isHardMissedPlanItem(item, termAttempts, options.retryBeforeUnattemptedLimit);
    const canRetrySeenPriority = hardMissed && item?.source === 'priority';
    if (!query || (skipSeen && searchedQuerySet.has(query) && !canRetrySeenPriority)) continue;
    const hardMissedTerm = String(item?.term || '').trim();
    if (hardMissed && !selectedHardMissedTerms.has(hardMissedTerm) && selectedHardMissedTerms.size >= maxHardMissedQueries) continue;
    if (hardMissed && selectedHardMissedTerms.has(hardMissedTerm)) continue;
    selected.push(item);
    if (hardMissed && hardMissedTerm) selectedHardMissedTerms.add(hardMissedTerm);
  }
  return selected;
}

function sortEntriesForCoverage(entries) {
  return [...entries].sort(
    (a, b) =>
      coveragePriorityPenalty(a) - coveragePriorityPenalty(b) ||
      evidenceCount(a) - evidenceCount(b) ||
      String(a.term || '').localeCompare(String(b.term || '')),
  );
}

function coverageActionRank(action) {
  return (
    {
      retry_with_new_variant: 0,
      harvest: 1,
      refresh_source_metadata: 2,
      harvest_more_evidence: 3,
      add_query_template: 4,
      none: 9,
    }[action] ?? 8
  );
}

function actionSortRank(action, options = {}) {
  const baseRank = coverageActionRank(action?.action);
  const priorityPenalty = coveragePriorityPenalty(action);
  const retryLimit = Math.max(0, Number(options.retryBeforeUnattemptedLimit ?? 3) || 0);
  const attempts = Math.max(0, Number(action?.attempts) || 0);
  const successfulAttempts = Math.max(0, Number(action?.successfulAttempts) || 0);
  const evidence = Math.max(0, Number(action?.evidenceCount) || 0);
  if (
    options.prioritizeHardZeroEvidence === true &&
    action?.action === 'retry_with_new_variant' &&
    retryLimit > 0 &&
    attempts >= retryLimit * 2 &&
    successfulAttempts === 0 &&
    evidence === 0
  ) {
    return coverageActionRank('harvest') - 0.5 + priorityPenalty;
  }
  if (action?.action === 'retry_with_new_variant' && retryLimit > 0 && attempts >= retryLimit) {
    return coverageActionRank('harvest') + 0.5 + priorityPenalty;
  }
  return baseRank + priorityPenalty;
}

function recommendationGroupForTerm(term) {
  const clean = String(term || '').trim();
  if (clean.startsWith('\u4e0d\u4f1a\u771f\u6709\u4eba')) return '\u4e0d\u4f1a\u771f\u6709\u4eba';
  if (clean.includes('\u8f66\u5bb6\u519b')) return '\u8f66\u5bb6\u519b';
  if (clean.includes('\u8e6d\u6982\u5ff5')) return '\u8e6d\u6982\u5ff5';
  if (clean === '\u7cbe\u795e\u5916\u56fd\u4eba' || clean === '\u7cbe\u5916') return '\u7cbe\u795e\u5916\u56fd\u4eba';
  return clean;
}

function precisionQueriesForTerm(term) {
  return TERM_PRECISION_QUERIES[recommendationGroupForTerm(term)] || [];
}

function negativeFeedbackQueriesForTerm(term) {
  return TERM_NEGATIVE_FEEDBACK_QUERIES[recommendationGroupForTerm(term)] || [];
}

function exactFeedbackQueriesForTerm(term) {
  return searchTermsForTerm(term).slice(0, 8);
}

function flattenQueryDiagnostics(runs = []) {
  return runs.flatMap((run) => (Array.isArray(run?.queryDiagnostics) ? run.queryDiagnostics.flat() : []));
}

function hasIrrelevantQueryFeedback(state = {}, term) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return false;
  return flattenQueryDiagnostics(state.runs || []).some((item) => {
    const targets = Array.isArray(item?.targetExistingTerms) ? item.targetExistingTerms.map((target) => String(target || '').trim()) : [];
    const accepted = Array.isArray(item?.acceptedTerms) ? item.acceptedTerms.map((target) => String(target || '').trim()).filter(Boolean) : [];
    return (
      targets.includes(cleanTerm) &&
      accepted.length === 0 &&
      Math.max(0, Number(item?.commentsCollected) || 0) > 0 &&
      Math.max(0, Number(item?.trainingTextChars) || 0) > 0
    );
  });
}

function diversifyCoverageActions(actions, limit) {
  const selected = [];
  const selectedGroups = new Set();
  const push = (item, enforceNewGroup) => {
    if (!item || selected.length >= limit || selected.includes(item)) return;
    const group = recommendationGroupForTerm(item.term);
    if (enforceNewGroup && group && selectedGroups.has(group)) return;
    selected.push(item);
    if (group) selectedGroups.add(group);
  };
  for (const item of actions) push(item, true);
  for (const item of actions) push(item, false);
  return selected;
}

function priorityPlanFromCoverageActions(priorityQueries, actionMap) {
  const actions = [...actionMap.values()];
  return priorityQueries.map((query) => {
    const cleanQuery = String(query || '').trim();
    const matchedAction = actions.find(
      (action) =>
        action.nextQuery === cleanQuery ||
        (Array.isArray(action.suggestedQueries) && action.suggestedQueries.includes(cleanQuery)) ||
        exactFeedbackQueriesForTerm(action.term).includes(cleanQuery) ||
        precisionQueriesForTerm(action.term).includes(cleanQuery) ||
        negativeFeedbackQueriesForTerm(action.term).includes(cleanQuery),
    );
    if (!matchedAction) return { query: cleanQuery, source: 'priority' };
    return {
      query: cleanQuery,
      source: 'priority',
      term: matchedAction.term,
      family: matchedAction.family,
      evidenceCount: matchedAction.evidenceCount,
      sourcedEvidence: matchedAction.sourcedEvidence,
      priorAttempts: matchedAction.attempts,
      priorSuccessfulAttempts: matchedAction.successfulAttempts,
      variantIndex: null,
      builtInVariant: true,
      previouslyTried: false,
    };
  });
}

export function buildKeywordHarvestQueryPlan(dictionary, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 10000);
  const priorityQueries = unique(options.priorityQueries || []);
  const seedQueries = unique(options.seedQueries || DEFAULT_SEED_QUERIES);
  const coverageMode = String(options.coverageMode || 'balanced').trim().toLowerCase();
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const requireSourceBackedEvidence = options.requireSourceBackedEvidence === true;
  const allEntries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const termAttempts = options.termAttempts && typeof options.termAttempts === 'object' ? options.termAttempts : {};
  const actionMap = new Map(
    buildCoverageActions(dictionary, { ...options.state, termAttempts }, { ...options, targetEvidence }).map((item) => [item.term, item]),
  );
  const entries =
    coverageMode === 'all-weak'
      ? allEntries
          .filter((entry) => evidenceCount(entry) < targetEvidence || (requireSourceBackedEvidence && evidenceCount(entry) > 0 && !hasEvidenceSource(entry)))
          .sort((a, b) => {
            const actionA = actionMap.get(String(a.term || '').trim());
            const actionB = actionMap.get(String(b.term || '').trim());
            return (
              actionSortRank(actionA, options) - actionSortRank(actionB, options) ||
              evidenceCount(a) - evidenceCount(b) ||
              String(a.term || '').localeCompare(String(b.term || ''))
            );
          })
      : allEntries;
  const familyCounts = new Map();
  const dictionaryPlan = [];
  const variantsPerTerm = asPositiveInt(options.queryVariantsPerTerm, 2, Number.MAX_SAFE_INTEGER);

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
        ? Math.min(queryVariantCountForTerm(term, options), Math.max(variantsPerTerm, attempts + variantsPerTerm))
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
        sourcedEvidence: hasEvidenceSource(entry),
        priorAttempts: attempts,
        priorSuccessfulAttempts: successfulAttempts,
        variantIndex: variant.variantIndex,
        builtInVariant: variant.builtIn,
        previouslyTried: triedQueries.has(variant.query),
      });
    }
  }

  const seedPlan = seedQueries.map((query) => ({ query, source: 'seed' }));
  const priorityPlan = priorityPlanFromCoverageActions(priorityQueries, actionMap);
  const orderedPlan =
    coverageMode === 'all-weak'
      ? [...priorityPlan, ...dictionaryPlan, ...seedPlan]
      : [...priorityPlan, ...seedPlan, ...dictionaryPlan];
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
      harvestStrategyVersion: Math.max(0, Number(state.harvestStrategyVersion) || 0),
      updatedAt: state.updatedAt || null,
      searchedQueries: Array.isArray(state.searchedQueries) ? state.searchedQueries : [],
      scannedBvids: Array.isArray(state.scannedBvids) ? state.scannedBvids : [],
      termAttempts: state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {},
      runs: Array.isArray(state.runs) ? state.runs : [],
    };
  } catch {
    return { version: 1, harvestStrategyVersion: 0, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] };
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
  const sourcedEvidence = entries.filter(hasEvidenceSource);
  const unsourcedEvidence = entries.filter((entry) => evidenceCount(entry) > 0 && !hasEvidenceSource(entry));
  const evidenceDeficit = weakEntries.reduce((sum, entry) => sum + Math.max(0, targetEvidence - evidenceCount(entry)), 0);
  const byFamily = {};
  for (const entry of entries) {
    const family = entry.family || 'unknown';
    if (!byFamily[family]) byFamily[family] = { terms: 0, evidence: 0, weak: 0, zero: 0, sourced: 0 };
    byFamily[family].terms += 1;
    byFamily[family].evidence += evidenceCount(entry);
    if (evidenceCount(entry) < targetEvidence) byFamily[family].weak += 1;
    if (evidenceCount(entry) === 0) byFamily[family].zero += 1;
    if (hasEvidenceSource(entry)) byFamily[family].sourced += 1;
  }
  return {
    complete: weakEntries.length === 0,
    targetEvidence,
    terms: entries.length,
    totalEvidence,
    averageEvidence: entries.length ? Number((totalEvidence / entries.length).toFixed(2)) : 0,
    coverageRatio: entries.length ? Number(((entries.length - weakEntries.length) / entries.length).toFixed(4)) : 1,
    evidenceDeficit,
    sourcedEvidenceTerms: sourcedEvidence.length,
    sourceCoverageRatio: entries.length ? Number((sourcedEvidence.length / entries.length).toFixed(4)) : 1,
    unsourcedEvidenceTerms: unsourcedEvidence.length,
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
    unsourcedEvidenceSamples: sortEntriesForCoverage(unsourcedEvidence).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
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
  const searchedQueries = new Set(Array.isArray(state.searchedQueries) ? state.searchedQueries : []);
  const assumeLegacyQueriesCurrent =
    !Object.prototype.hasOwnProperty.call(state, 'harvestStrategyVersion') ||
    Number(state.harvestStrategyVersion || 0) >= HARVEST_STRATEGY_VERSION;
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  return entries.map((entry) => {
    const term = String(entry.term || '').trim();
    const family = entry.family || 'attack';
    const attempt = getTermAttempt(attempts, term);
    const count = evidenceCount(entry);
    const exhausted = isTermAttemptExhausted(term, family, attempt, options);
    const successfulAttempts = Number(attempt?.successfulAttempts) || 0;
    const attemptsCount = Number(attempt?.attempts) || 0;
    const currentStrategyTriedQueries = attemptedVariantQueries(attempt, {
      requireCurrentStrategyVersion: true,
      assumeLegacyQueriesCurrent,
    });
    const triedQueries = new Set([...attemptedVariantQueries(attempt), ...searchedQueries]);
    const availableVariants = queryVariantsForTerm(term, family, queryTemplatesFromOptions(options).length, options);
    const hardMissedZeroEvidence = isHardMissedZeroEvidenceAttempt(attempt, options.retryBeforeUnattemptedLimit);
    const feedbackQuery =
      hardMissedZeroEvidence && hasIrrelevantQueryFeedback(state, term)
        ? negativeFeedbackQueriesForTerm(term).find((query) => !triedQueries.has(query))
        : '';
    const exactFeedbackQuery =
      hardMissedZeroEvidence && hasIrrelevantQueryFeedback(state, term)
        ? exactFeedbackQueriesForTerm(term).find((query) => !currentStrategyTriedQueries.has(query))
        : '';
    const precisionQuery = hardMissedZeroEvidence ? precisionQueriesForTerm(term).find((query) => !triedQueries.has(query)) : '';
    const nextVariant =
      (feedbackQuery ? { query: feedbackQuery, variantIndex: null, builtIn: false } : null) ||
      (exactFeedbackQuery ? { query: exactFeedbackQuery, variantIndex: null, builtIn: false } : null) ||
      (precisionQuery ? { query: precisionQuery, variantIndex: null, builtIn: false } : null) ||
      availableVariants.find((variant) => !triedQueries.has(variant.query)) ||
      null;
    let status = 'covered';
    let action = 'none';
    if (count >= targetEvidence && options.requireSourceBackedEvidence === true && count > 0 && !hasEvidenceSource(entry)) {
      status = 'source_gap';
      action = nextVariant ? 'refresh_source_metadata' : 'add_query_template';
    } else if (count < targetEvidence && exhausted) {
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
      sourcedEvidence: hasEvidenceSource(entry),
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

export function buildDictionaryCoverageAudit(dictionary = {}, state = {}, options = {}) {
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const maxActions = asPositiveInt(options.maxActions, 20, 1000);
  const minCoverageRatio = Math.min(1, Math.max(0, Number(options.minCoverageRatio ?? 1)));
  const requireComplete = options.requireComplete !== false;
  const requireSourceBackedEvidence = options.requireSourceBackedEvidence === true;
  const coverage = summarizeEvidenceCoverage(dictionary, { targetEvidence });
  const termAttemptSummary = summarizeTermAttempts(state, dictionary, options);
  const coverageActions = buildCoverageActions(dictionary, state, options);
  const actionSummary = coverageActions.reduce((summary, item) => {
    summary[item.action] = (summary[item.action] || 0) + 1;
    return summary;
  }, {});
  const sortedActions = coverageActions
    .filter((item) => item.action !== 'none')
    .sort(
      (a, b) =>
        actionSortRank(a, { ...options, prioritizeHardZeroEvidence: true }) - actionSortRank(b, { ...options, prioritizeHardZeroEvidence: true }) ||
        a.evidenceCount - b.evidenceCount ||
        String(a.term || '').localeCompare(String(b.term || '')),
    );
  const nextActions = diversifyCoverageActions(sortedActions, maxActions);
  const recommendedQueries = unique(
    nextActions.flatMap((item) => [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]),
  ).slice(0, maxActions);
  const familyGaps = Object.entries(coverage.byFamily || {})
    .map(([family, item]) => ({
      family,
      terms: item.terms,
      weak: item.weak,
      zero: item.zero,
      evidence: item.evidence,
      coverageRatio: item.terms ? Number(((item.terms - item.weak) / item.terms).toFixed(4)) : 1,
    }))
    .sort((a, b) => b.weak - a.weak || b.zero - a.zero || a.family.localeCompare(b.family));
  const failureReasons = [];
  if (coverage.coverageRatio < minCoverageRatio) {
    failureReasons.push(`coverage ratio ${coverage.coverageRatio} is below ${minCoverageRatio}`);
  }
  if (requireComplete && !coverage.complete) {
    failureReasons.push(`${coverage.weakTerms} term(s) are below ${targetEvidence} evidence hit(s)`);
  }
  if (requireSourceBackedEvidence && coverage.unsourcedEvidenceTerms > 0) {
    failureReasons.push(`${coverage.unsourcedEvidenceTerms} evidence-backed term(s) are missing Bilibili source metadata`);
  }
  if (termAttemptSummary.exhaustedTerms > 0) {
    failureReasons.push(`${termAttemptSummary.exhaustedTerms} exhausted term(s) need extra query templates`);
  }
  return {
    ok: failureReasons.length === 0,
    generatedAt: new Date().toISOString(),
    targetEvidence,
    minCoverageRatio,
    requireComplete,
    requireSourceBackedEvidence,
    coverage,
    termAttemptSummary,
    actionSummary,
    familyGaps,
    nextActions,
    recommendedQueries,
    failureReasons,
  };
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

function summarizeTrainingDiagnostics(results = []) {
  const diagnostics = {
    deepseekCalls: 0,
    fallbackCalls: 0,
    evidenceRejected: 0,
    dictionaryEvidenceTerms: 0,
    dictionaryEvidenceCount: 0,
    generatedTerms: 0,
  };
  for (const item of results) {
    const training = item?.result?.keywordTraining;
    if (!training) continue;
    if (training.available && training.keyConfigured) diagnostics.deepseekCalls += 1;
    if (training.usedFallback) diagnostics.fallbackCalls += 1;
    diagnostics.evidenceRejected += Math.max(0, Number(training.evidenceRejected) || 0);
    const dictionaryEvidenceEntries = Array.isArray(training.dictionaryEvidenceEntries) ? training.dictionaryEvidenceEntries : [];
    diagnostics.dictionaryEvidenceTerms += dictionaryEvidenceEntries.length;
    diagnostics.dictionaryEvidenceCount += dictionaryEvidenceEntries.reduce((sum, entry) => sum + (Math.max(0, Number(entry?.evidenceCount) || 0)), 0);
    diagnostics.generatedTerms += Array.isArray(training.generatedEntries)
      ? training.generatedEntries.length
      : Array.isArray(item?.result?.entries)
        ? item.result.entries.length
        : 0;
  }
  return diagnostics;
}

function summarizeQueryDiagnostics(results = []) {
  return results.map((item) => {
    const diagnostics = item?.result?.collectionDiagnostics || {};
    return {
      query: item.query,
      ok: Boolean(item?.result?.ok),
      error: item?.result?.error || '',
      discoveredVideos: Math.max(0, Number(diagnostics.discoveredVideos) || 0),
      discoveryContextVideos: Math.max(0, Number(diagnostics.discoveryContextVideos) || 0),
      scannedVideos: Math.max(0, Number(diagnostics.scannedVideos) || 0),
      commentsCollected: Math.max(0, Number(diagnostics.commentsCollected) || 0),
      trainingTextChars: Math.max(0, Number(diagnostics.trainingTextChars) || 0),
      targetExistingTerms: Array.isArray(diagnostics.targetExistingTerms) ? diagnostics.targetExistingTerms : [],
      acceptedTerms: Array.isArray(diagnostics.acceptedTerms) ? diagnostics.acceptedTerms : [],
      evidenceRejected: Math.max(0, Number(diagnostics.evidenceRejected) || 0),
      sampleVideos: Array.isArray(diagnostics.sampleVideos) ? diagnostics.sampleVideos.slice(0, 5) : [],
    };
  });
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
    strategyVersion: HARVEST_STRATEGY_VERSION,
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

function backfillTermAttemptsFromSearchedQueries(termAttempts, dictionary, searchedQueries, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const searchedQuerySet = new Set(searchedQueries);
  const templateCount = queryTemplatesFromOptions(options).length;
  const backfilledAt = options.backfilledAt || new Date().toISOString();
  let backfilled = 0;
  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const key = termAttemptKey(term);
    const current = getTermAttempt(termAttempts, term) || {};
    const triedQueries = attemptedVariantQueries(current);
    for (const variant of queryVariantsForTerm(term, family, templateCount, options)) {
      if (!searchedQuerySet.has(variant.query) || triedQueries.has(variant.query)) continue;
      const queryRecord = {
        at: current.lastAttemptAt || backfilledAt,
        query: variant.query,
        strategyVersion: Math.max(0, Number(options.harvestStrategyVersion) || 0),
        ok: true,
        hit: false,
        videos: 0,
        comments: 0,
        error: 'backfilled from searched query history',
      };
      const previousQueries = Array.isArray(current.queries) ? current.queries : [];
      const nextQueries = [...previousQueries, queryRecord].slice(-20);
      termAttempts[key] = {
        key,
        term,
        family: current.family || family,
        evidenceAtPlanTime: current.evidenceAtPlanTime ?? evidenceCount(entry),
        lastVariantIndex: variant.variantIndex,
        attempts: Math.max(0, Number(current.attempts) || 0) + 1,
        successfulAttempts: Math.max(0, Number(current.successfulAttempts) || 0),
        lastAttemptAt: current.lastAttemptAt || backfilledAt,
        lastSuccessfulAt: current.lastSuccessfulAt || null,
        lastQuery: variant.query,
        lastError: current.lastError || '',
        lastEvidenceCount: Number(current.lastEvidenceCount) || 0,
        queries: nextQueries,
      };
      Object.assign(current, termAttempts[key]);
      triedQueries.add(variant.query);
      backfilled += 1;
    }
  }
  return backfilled;
}

export async function harvestKeywordDictionary(options = {}, deps = {}) {
  const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
  const searchVideoKeywords = deps.searchVideoKeywords || defaultSearchVideoKeywords;
  const statePath = options.statePath || DEFAULT_HARVEST_STATE_PATH;
  const skipSeen = options.skipSeen !== false;
  const state = options.resetState
    ? { version: 1, harvestStrategyVersion: 0, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] }
    : await readKeywordHarvestState(statePath);
  const before = await readKeywordDictionary();
  const beforeCoverage = summarizeEvidenceCoverage(before, { targetEvidence: options.targetEvidence });
  const searchedQuerySet = new Set(state.searchedQueries);
  const skipSearchedQuerySet =
    Number(state.harvestStrategyVersion || 0) >= HARVEST_STRATEGY_VERSION ? new Set(state.searchedQueries) : new Set();
  const scannedBvidSet = new Set(state.scannedBvids);
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const termAttempts = { ...state.termAttempts };
  const backfilledAttempts = backfillTermAttemptsFromSearchedQueries(termAttempts, before, searchedQuerySet, {
    ...options,
    harvestStrategyVersion: state.harvestStrategyVersion,
    backfilledAt: state.updatedAt || new Date().toISOString(),
  });
  const candidatePlan = buildKeywordHarvestQueryPlan(before, {
    state,
    priorityQueries: options.priorityQueries,
    seedQueries: options.seedQueries,
    maxQueries: skipSeen ? Math.min(10000, maxQueries + searchedQuerySet.size + 100) : Math.min(10000, maxQueries + 100),
    termsPerFamily: options.termsPerFamily,
    queryVariantsPerTerm: options.queryVariantsPerTerm,
    targetEvidence: options.targetEvidence,
    coverageMode: options.coverageMode,
    requireSourceBackedEvidence: options.requireSourceBackedEvidence,
    termAttempts,
    extraQueryTemplates: options.extraQueryTemplates,
  });
  const plan = selectHarvestPlan(candidatePlan, {
    maxQueries,
    maxHardMissedQueries: options.maxHardMissedQueries,
    termAttempts,
    retryBeforeUnattemptedLimit: options.retryBeforeUnattemptedLimit,
    searchedQuerySet: skipSearchedQuerySet,
    skipSeen,
  });
  const candidateQueries = candidatePlan.map((item) => item.query);
  const queries = plan.map((item) => item.query);
  const results = [];
  const warnings = [];

  for (const planItem of plan) {
    const query = planItem.query;
    const attemptFinishedAt = new Date().toISOString();
    const priorAttempt = planItem.term ? getTermAttempt(termAttempts, planItem.term) : null;
    const deepenScan = isRepeatedlyMissedAttempt(priorAttempt, options.retryBeforeUnattemptedLimit);
    const hardMissedZeroEvidence = isHardMissedZeroEvidenceAttempt(priorAttempt, options.retryBeforeUnattemptedLimit);
    const hardMissedDiscoveryLimit =
      options.hardMissedDiscoveryLimit ?? Math.max(Number(options.staleMissedDiscoveryLimit) || 1, (Number(options.discoveryLimit) || 1) * 4);
    const hardMissedDiscoveryPages = options.hardMissedDiscoveryPages ?? Math.max(3, Number(options.discoveryPages) || 1);
    const hardMissedPages = options.hardMissedPages ?? Math.max(Number(options.staleMissedPages) || 1, (Number(options.pages) || 1) + 4);
    const effectiveDiscoveryLimit =
      hardMissedZeroEvidence
        ? Math.max(Number(options.discoveryLimit) || 1, Number(hardMissedDiscoveryLimit) || 1)
        : deepenScan && options.staleMissedDiscoveryLimit
        ? Math.max(Number(options.discoveryLimit) || 1, Number(options.staleMissedDiscoveryLimit) || 1)
        : options.discoveryLimit;
    const effectivePages =
      hardMissedZeroEvidence
        ? Math.max(Number(options.pages) || 1, Number(hardMissedPages) || 1)
        : deepenScan && options.staleMissedPages
        ? Math.max(Number(options.pages) || 1, Number(options.staleMissedPages) || 1)
        : options.pages;
    try {
      const searchPayload = {
        searchQueries: [query],
        controversyQueries: options.controversyQueries,
        discoveryMode: options.discoveryMode,
        discoveryLimit: effectiveDiscoveryLimit,
        pages: effectivePages,
        excludeBvids: skipSeen && !deepenScan ? [...scannedBvidSet] : [],
      };
      if (hardMissedZeroEvidence || options.discoveryPages !== undefined) {
        searchPayload.discoveryPages = hardMissedZeroEvidence ? hardMissedDiscoveryPages : options.discoveryPages;
      }
      if (options.existingTermsOnly !== undefined) {
        searchPayload.existingTermsOnly = options.existingTermsOnly;
      }
      if (options.existingTermsOnly === true && planItem.term) {
        searchPayload.targetExistingTerms = relatedTargetExistingTerms(before, planItem, options);
      }
      if (options.controversialPopularQueryLimit !== undefined) {
        searchPayload.controversialPopularQueryLimit = options.controversialPopularQueryLimit;
      }
      if (options.controversialPopularSearchOrder !== undefined) {
        searchPayload.controversialPopularSearchOrder = options.controversialPopularSearchOrder;
      }
      if (options.includeGenericPopular !== undefined) {
        searchPayload.includeGenericPopular = options.includeGenericPopular;
      }
      const result = await searchVideoKeywords(searchPayload);
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
    requireSourceBackedEvidence: options.requireSourceBackedEvidence,
    extraQueryTemplates: options.extraQueryTemplates,
    exhaustedSuggestionTemplates: options.exhaustedSuggestionTemplates,
  });
  const trainingDiagnostics = summarizeTrainingDiagnostics(results);
  const queryDiagnostics = summarizeQueryDiagnostics(results);
  const finishedAt = new Date().toISOString();
  const nextState = {
    version: 1,
    harvestStrategyVersion: HARVEST_STRATEGY_VERSION,
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
        evidenceRejected: trainingDiagnostics.evidenceRejected,
        trainingDiagnostics,
        queryDiagnostics,
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
        backfilledAttempts,
        weakTerms: coverage.weakTerms,
        zeroEvidenceTerms: coverage.zeroEvidenceTerms,
        warnings: warnings.length,
      },
    ],
  };
  await writeKeywordHarvestState(nextState, statePath);

  return {
    ok: results.some((item) => item.result?.ok),
    backfilledAttempts,
    state: nextState,
    candidateQueries,
    queries,
    plan,
    results,
    warnings,
    growth,
    coverage,
    coverageProgress,
    trainingDiagnostics,
    queryDiagnostics,
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
