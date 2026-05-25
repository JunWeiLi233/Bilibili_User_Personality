import { readFile } from 'node:fs/promises';

import { DEFAULT_DICTIONARY_PATH, mergeEntriesIntoDictionary } from './deepseekKeywordTrainer.js';

function summarize(dictionary) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const asciiEntries = entries.filter((entry) => /^[A-Za-z0-9]+$/.test(String(entry.term || '')));
  return {
    totalEntries: entries.length,
    asciiEntries: asciiEntries.length,
  };
}

const before = await readFile(DEFAULT_DICTIONARY_PATH, 'utf8')
  .then((raw) => JSON.parse(raw))
  .catch(() => ({ entries: [] }));

const pruned = await mergeEntriesIntoDictionary([]);
const beforeSummary = summarize(before);
const afterSummary = summarize(pruned);

console.log(`Dictionary path: ${DEFAULT_DICTIONARY_PATH}`);
console.log(`Entries: ${beforeSummary.totalEntries} -> ${afterSummary.totalEntries}`);
console.log(`ASCII terms: ${beforeSummary.asciiEntries} -> ${afterSummary.asciiEntries}`);
