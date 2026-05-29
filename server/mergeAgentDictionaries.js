import { readFile } from 'node:fs/promises';

import {
  mergeEntriesIntoDictionary,
  readKeywordDictionary,
  DEFAULT_DICTIONARY_PATH,
} from './deepseekKeywordTrainer.js';

// Merge dictionaries produced by parallel resolver agents back into the main
// dictionary. Each agent ran in its own worktree with an independent dictionary
// copy. We union their evidence via the existing merge pipeline.

const agentPaths = process.argv.slice(2).filter(Boolean);
if (agentPaths.length === 0) {
  console.log('Usage: node mergeAgentDictionaries.js <worktree-path-1> [worktree-path-2 ...]');
  process.exit(1);
}

const mainDict = await readKeywordDictionary();
const before = new Map(
  (mainDict.entries || []).map((e) => [String(e.term || ''), Number(e.evidenceCount || 0)])
);

console.log(`Merging evidence from ${agentPaths.length} agent worktree(s) into main dictionary`);
console.log(`Main dictionary: ${(mainDict.entries || []).length} entries`);

let totalAdded = 0;

for (let i = 0; i < agentPaths.length; i++) {
  const wtPath = agentPaths[i];
  const dictPath = `${wtPath}/server/deepseekKeywordDictionary.json`;
  let agentDict;
  try {
    agentDict = JSON.parse(await readFile(dictPath, 'utf-8'));
  } catch (err) {
    console.log(`  [agent ${i + 1}] SKIP: cannot read ${dictPath}: ${err.message}`);
    continue;
  }
  const agentEntries = Array.isArray(agentDict.entries) ? agentDict.entries : [];
  if (agentEntries.length === 0) {
    console.log(`  [agent ${i + 1}] SKIP: no entries`);
    continue;
  }

  await mergeEntriesIntoDictionary(agentEntries, {
    existingTermsOnly: true,
    dictionaryPath: DEFAULT_DICTIONARY_PATH,
  });

  // Count evidence gained by comparing against baseline
  const mergedDict = await readKeywordDictionary();
  const after = new Map(
    (mergedDict.entries || []).map((e) => [String(e.term || ''), Number(e.evidenceCount || 0)])
  );
  let gained = 0;
  for (const [term, beforeCount] of before) {
    const afterCount = after.get(term) ?? 0;
    if (afterCount > beforeCount) gained += afterCount - beforeCount;
    before.set(term, afterCount); // update baseline for next agent
  }

  console.log(`  [agent ${i + 1}] merged ${agentEntries.length} entries, evidence gained: ${gained}`);
  totalAdded += gained;
}

console.log(`Done. Total evidence added: ${totalAdded}`);
