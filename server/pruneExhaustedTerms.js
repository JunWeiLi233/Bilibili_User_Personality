import { readKeywordDictionary, writeJsonFileAtomic, DEFAULT_DICTIONARY_PATH } from './deepseekKeywordTrainer.js';
import { DEFAULT_HARVEST_STATE_PATH, readKeywordHarvestState, selectExhaustedTerms } from './keywordHarvest.js';
import { buildCoverageRuntimeOptions } from './coverageCliOptions.js';

// Prune-after-N-tries curation: remove dictionary terms that have been harvested
// at least BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER times and still cannot be attested
// in public comments. Keeps real slang that just needs more crawling; lets coverage
// converge toward 100% honestly over sustained harvest runs.

const runtime = buildCoverageRuntimeOptions({ maxActionsFallback: 20 });
const attemptThreshold = Math.max(1, Number(process.env.BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER || 10));
const requireZeroEvidence = process.env.BILIBILI_HARVEST_PRUNE_INCLUDE_PARTIAL !== '1';
const apply = process.env.BILIBILI_HARVEST_PRUNE_APPLY === '1';
const statePath = process.env.BILIBILI_HARVEST_STATE_PATH || DEFAULT_HARVEST_STATE_PATH;
const dictionaryPath = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH || DEFAULT_DICTIONARY_PATH;

const dictionary = await readKeywordDictionary(process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH ? { dictionaryPath } : {});
const state = await readKeywordHarvestState(statePath);
const exhausted = selectExhaustedTerms(dictionary, state, {
  targetEvidence: runtime.targetEvidence,
  attemptThreshold,
  requireZeroEvidence,
  requireSourceBackedEvidence: runtime.requireSourceBackedEvidence,
  requireCommentBackedEvidence: runtime.requireCommentBackedEvidence,
});

console.log(`Exhausted-term prune (>= ${attemptThreshold} attempts, ${requireZeroEvidence ? 'zero-evidence only' : 'any below target'})`);
console.log(`Candidates: ${exhausted.length}`);
for (const item of exhausted.slice(0, 40)) console.log(`- [${item.family}] ${item.term} (attempts ${item.attempts}, evidence ${item.evidence})`);

if (!apply) {
  console.log('\nDry run. Set BILIBILI_HARVEST_PRUNE_APPLY=1 to remove these terms.');
} else if (exhausted.length > 0) {
  const remove = new Set(exhausted.map((item) => item.term));
  const before = dictionary.entries.length;
  dictionary.entries = dictionary.entries.filter((entry) => !remove.has(String(entry.term || '').trim()));
  await writeJsonFileAtomic(dictionaryPath, dictionary);
  console.log(`\nPruned ${before - dictionary.entries.length} exhausted term(s): ${before} -> ${dictionary.entries.length}`);
}
