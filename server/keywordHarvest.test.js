import assert from 'node:assert/strict';
import test from 'node:test';

import { buildKeywordHarvestQueries, harvestKeywordDictionary, summarizeDictionaryGrowth } from './keywordHarvest.js';

test('buildKeywordHarvestQueries combines seed queries with dictionary terms by family', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
        { term: '懂的都懂', family: 'evasion' },
        { term: 'yygq', family: 'attack' },
      ],
    },
    {
      seedQueries: ['seed topic'],
      maxQueries: 5,
      termsPerFamily: 2,
    },
  );

  assert.deepEqual(queries, [
    'seed topic',
    'doge Bilibili discussion comments',
    'yygq Bilibili comment meme',
    '懂的都懂 Bilibili reply argument comments',
  ]);
});

test('summarizeDictionaryGrowth reports new terms, families, and duplicates', () => {
  const summary = summarizeDictionaryGrowth(
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  );

  assert.equal(summary.before, 1);
  assert.equal(summary.after, 2);
  assert.equal(summary.added, 1);
  assert.equal(summary.duplicates, 1);
  assert.deepEqual(summary.families, { cooperation: 1, attack: 2 });
  assert.deepEqual(summary.newTerms.map((entry) => entry.term), ['yygq', 'yygq']);
});

test('harvestKeywordDictionary runs dictionary-seeded searches and reports growth', async () => {
  const dictionaries = [
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  ];
  const searched = [];
  const result = await harvestKeywordDictionary(
    {
      seedQueries: ['seed topic'],
      maxQueries: 2,
      discoveryLimit: 1,
      pages: 1,
    },
    {
      readKeywordDictionary: async () => dictionaries.shift() || dictionaries.at(-1),
      searchVideoKeywords: async (payload) => {
        searched.push(payload);
        return { ok: true, warnings: [], entries: [{ term: 'yygq', family: 'attack' }] };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.queries, ['seed topic', 'doge Bilibili discussion comments']);
  assert.equal(searched.length, 2);
  assert.deepEqual(searched[0], { searchQueries: ['seed topic'], discoveryLimit: 1, pages: 1 });
  assert.equal(result.growth.added, 1);
});
