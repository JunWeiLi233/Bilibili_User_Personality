import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary } from './deepseekKeywordTrainer.js';
import { buildCoverageRuntimeOptions } from './coverageCliOptions.js';
import { buildDictionaryCoverageAudit, DEFAULT_HARVEST_STATE_PATH, readKeywordHarvestState } from './keywordHarvest.js';

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(payload, null, 2).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  await writeFile(path, `${json}\n`, 'utf8');
}

function priorityActionItemsFromAudit(audit) {
  return (audit.nextActions || []).flatMap((item) => {
    const queries = [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]
      .map((query) => String(query || '').trim())
      .filter(Boolean);
    return queries.map((query) => ({ ...item, query, nextQuery: query }));
  });
}

const dictionaryPath = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH;
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
const reportPath = process.env.BILIBILI_COVERAGE_AUDIT_REPORT_PATH || join(process.cwd(), 'server', 'keywordCoverageAudit.json');
const queryFilePath = process.env.BILIBILI_COVERAGE_QUERY_FILE_PATH || join(process.cwd(), 'server', 'keywordCoverageQueries.txt');
const actionFilePath = process.env.BILIBILI_COVERAGE_ACTION_FILE_PATH || join(process.cwd(), 'server', 'keywordCoverageActions.json');
const runtimeOptions = buildCoverageRuntimeOptions({ maxActionsFallback: 20 });
const targetEvidence = runtimeOptions.targetEvidence;
const maxActions = runtimeOptions.maxActions;
const minCoverageRatio = runtimeOptions.minCoverageRatio;
const requireComplete = runtimeOptions.requireComplete;
const requireSourceBackedEvidence = runtimeOptions.requireSourceBackedEvidence;
const requireCommentBackedEvidence = runtimeOptions.requireCommentBackedEvidence;
const strict = runtimeOptions.strict;
const extraQueryTemplates = process.env.BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES || '';
const exhaustedSuggestionTemplates = process.env.BILIBILI_HARVEST_EXHAUSTED_SUGGESTION_TEMPLATES || '';
const retryBeforeUnattemptedLimit = runtimeOptions.retryBeforeUnattemptedLimit;

const dictionary = await readKeywordDictionary(dictionaryPath ? { dictionaryPath } : {});
const state = await readKeywordHarvestState(statePath);
const audit = buildDictionaryCoverageAudit(dictionary, state, {
  targetEvidence,
  maxActions,
  minCoverageRatio,
  requireComplete,
  requireSourceBackedEvidence,
  requireCommentBackedEvidence,
  prioritizeSourceGaps: requireCommentBackedEvidence,
  extraQueryTemplates,
  exhaustedSuggestionTemplates,
  retryBeforeUnattemptedLimit,
});

console.log('Dictionary coverage audit');
console.log(`Dictionary terms: ${audit.coverage.terms}`);
console.log(`Target evidence per term: ${audit.targetEvidence}`);
console.log(`Coverage ratio: ${(audit.coverage.coverageRatio * 100).toFixed(2)}%`);
console.log(`Weak terms: ${audit.coverage.weakTerms}`);
console.log(`Zero-evidence terms: ${audit.coverage.zeroEvidenceTerms}`);
console.log(`Evidence deficit: ${audit.coverage.evidenceDeficit}`);
console.log(`Source-backed terms: ${audit.coverage.sourcedEvidenceTerms}`);
console.log(`Unsourced evidence terms: ${audit.coverage.unsourcedEvidenceTerms}`);
console.log(`Attempted terms: ${audit.termAttemptSummary.attemptedTerms}`);
console.log(`Successful terms: ${audit.termAttemptSummary.successfulTerms}`);
console.log(`Exhausted terms: ${audit.termAttemptSummary.exhaustedTerms}`);

if (audit.familyGaps.length) {
  console.log('Largest family gaps:');
  for (const gap of audit.familyGaps.slice(0, 8)) {
    console.log(`- ${gap.family}: ${gap.weak}/${gap.terms} weak, ${gap.zero} zero, coverage ${(gap.coverageRatio * 100).toFixed(2)}%`);
  }
}

if (audit.coverage.unsourcedEvidenceSamples.length) {
  console.log(requireCommentBackedEvidence ? 'Context-only evidence terms to refresh from comments:' : 'Unsourced evidence terms to refresh:');
  for (const entry of audit.coverage.unsourcedEvidenceSamples.slice(0, 12)) {
    console.log(
      `- [${entry.family}] ${entry.term}: ${entry.evidenceCount} evidence hit(s), missing ${
        requireCommentBackedEvidence ? 'Bilibili comment evidence' : 'Bilibili source metadata'
      }`,
    );
  }
}

if (audit.nextActions.length) {
  console.log('Next coverage actions:');
  for (const item of audit.nextActions.slice(0, 12)) {
    const nextQuery = item.nextQuery ? `, next query "${item.nextQuery}"` : '';
    console.log(`- [${item.status}] ${item.term}: ${item.action}, needs ${item.evidenceNeeded}${nextQuery}`);
  }
}

if (audit.recommendedQueries.length) {
  console.log('Recommended next queries/templates:');
  for (const query of audit.recommendedQueries.slice(0, 12)) console.log(`- ${query}`);
}

if (audit.failureReasons.length) {
  console.log('Coverage gate reasons:');
  for (const reason of audit.failureReasons) console.log(`- ${reason}`);
}

await writeJson(reportPath, audit);
console.log(`Coverage audit report: ${reportPath}`);
if (audit.recommendedQueries.length) {
  await mkdir(dirname(queryFilePath), { recursive: true });
  await writeFile(queryFilePath, `${audit.recommendedQueries.join('\n')}\n`, 'utf8');
  console.log(`Recommended query file: ${queryFilePath}`);
}
const priorityActionItems = priorityActionItemsFromAudit(audit);
if (priorityActionItems.length) {
  await writeJson(actionFilePath, priorityActionItems);
  console.log(`Recommended action file: ${actionFilePath}`);
}

if (strict && !audit.ok) {
  process.exitCode = 1;
}
