import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDictionaryCoverageAudit,
  buildCoverageActions,
  buildKeywordHarvestQueries,
  buildKeywordHarvestQueryPlan,
  harvestKeywordDictionary,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
  summarizeDictionaryGrowth,
  summarizeEvidenceCoverage,
  summarizeTermAttempts,
} from './keywordHarvest.js';

test('buildKeywordHarvestQueries prioritizes weak-evidence dictionary terms by family', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 8 },
        { term: 'yygq', family: 'attack', evidenceCount: 5 },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: ['seed topic'],
      maxQueries: 8,
      termsPerFamily: 2,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    'seed topic',
    '典中典 评论区 梗 热评',
    '典中典 评论区',
    '懂的都懂 回复 评论区 热评',
    'dddd 回复 评论区 热评',
    'yygq 评论区 梗 热评',
    '阴阳怪气 评论区 梗 热评',
    'doge 讨论 评论区 热评',
  ]);
});

test('buildKeywordHarvestQueries can generate several Bilibili-oriented variants per weak term', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      maxQueries: 4,
      termsPerFamily: 1,
      queryVariantsPerTerm: 4,
    },
  );

  assert.deepEqual(queries, [
    'doge 讨论 评论区 热评',
    'doge 评论区',
    'doge 热评',
    'doge 弹幕',
  ]);
});

test('buildKeywordHarvestQueries uses stable search aliases for hard-to-find terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', evidenceCount: 0 },
        { term: '\u61c2\u7684\u90fd\u61c2', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 6,
      termsPerFamily: 2,
      queryVariantsPerTerm: 3,
    },
  );

  assert.deepEqual(queries, [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u4e0d\u4f1a\u771f\u6709\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u61c2\u7684\u90fd\u61c2 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'dddd \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u61c2\u7684\u90fd\u61c2 \u8bc4\u8bba\u533a',
  ]);
});

test('buildKeywordHarvestQueries uses conversational aliases for repeatedly missed terms', () => {
  const cases = [
    {
      term: '\u7cbe\u795e\u5916\u56fd\u4eba',
      family: 'attack',
      expectedAliasQuery: '\u7cbe\u5916 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u524d\u9762\u8bf4\u91cd\u4e86',
      family: 'correction',
      expectedAliasQuery: '\u6211\u8bf4\u91cd\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u95ee\u8001\u9a6c\u672c\u4eba',
      family: 'evasion',
      expectedAliasQuery: '\u95ee\u672c\u4eba \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      expectedAliasQuery: '\u53ef\u4ee5\u53d1 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 0 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries.includes(item.expectedAliasQuery), true);
  }
});

test('buildKeywordHarvestQueries uses topic contexts for hard zero-evidence terms', () => {
  const cases = [
    {
      term: '\u8f66\u5bb6\u519b',
      expectedContextQuery: '\u8f66\u5bb6\u519b \u5c0f\u7c73\u6c7d\u8f66 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u8e6d\u6982\u5ff5',
      expectedContextQuery: '\u8e6d\u6982\u5ff5 AI \u8bc4\u8bba\u533a',
    },
    {
      term: '\u7cbe\u795e\u5916\u56fd\u4eba',
      expectedContextQuery: '\u7cbe\u795e\u5916\u56fd\u4eba \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: 'attack', evidenceCount: 0 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 32,
        queryVariantsPerTerm: 32,
      },
    );

    assert.equal(queries.includes(item.expectedContextQuery), true);
  }
});

test('buildKeywordHarvestQueries applies topic contexts to search aliases', () => {
  const cases = [
    {
      term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
      family: 'attack',
      expectedContextQuery: '\u4e0d\u4f1a\u771f\u6709\u4eba \u8bc1\u636e \u8bc4\u8bba\u533a',
    },
    {
      term: '\u524d\u9762\u8bf4\u91cd\u4e86',
      family: 'correction',
      expectedContextQuery: '\u6211\u8bf4\u91cd\u4e86 \u76f4\u64ad\u5207\u7247 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u95ee\u8001\u9a6c\u672c\u4eba',
      family: 'evasion',
      expectedContextQuery: '\u95ee\u9a6c\u65af\u514b\u672c\u4eba \u7279\u65af\u62c9 \u8bc4\u8bba\u533a',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 0 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 40,
        queryVariantsPerTerm: 40,
      },
    );

    assert.equal(queries.includes(item.expectedContextQuery), true);
  }
});

test('buildKeywordHarvestQueries broadens hard zero-evidence terms with fresher controversy wording', () => {
  const cases = [
    {
      term: '\u524d\u9762\u8bf4\u91cd\u4e86',
      family: 'correction',
      expectedQuery: '\u8bf4\u9519\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u95ee\u8001\u9a6c\u672c\u4eba',
      family: 'evasion',
      expectedQuery: '\u95ee\u9a6c\u65af\u514b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8e6d\u6982\u5ff5',
      family: 'attack',
      expectedQuery: 'AI\u6982\u5ff5 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u8f66\u5bb6\u519b',
      family: 'attack',
      expectedQuery: '\u96f7\u519b\u7c89\u4e1d \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 0 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 48,
        queryVariantsPerTerm: 48,
      },
    );

    assert.equal(queries.includes(item.expectedQuery), true);
  }
});

test('buildKeywordHarvestQueries broadens repeatedly missed conversational hard terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708', family: 'attack', evidenceCount: 1 },
        { term: '\u54ea\u90fd\u6709\u4f60', family: 'attack', evidenceCount: 1 },
        { term: 'tv\u574f\u7b11', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 3,
      targetEvidence: 3,
    },
  );

  assert.equal(queries.includes('\u9ad8\u4f4e\u7ed9\u4f60\u9001\u4e0a\u53bb \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u54ea\u513f\u90fd\u6709\u4f60 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u574f\u7b11 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
});

test('buildKeywordHarvestQueries broadens persistent zero-evidence attack terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', evidenceCount: 0 },
        { term: '\u6ca1\u6709\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
        { term: '\u8c01\u662f\u8e6d\u6982\u5ff5', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 36,
      queryVariantsPerTerm: 12,
      targetEvidence: 3,
    },
  );

  assert.equal(queries.includes('\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u8fd9\u4e5f\u53eb\u8bc1\u636e \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u7c73\u7c89\u63a7\u8bc4 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u8c01\u5728\u8e6d\u6982\u5ff5 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u8c01\u5728\u8e6dAI \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
});

test('buildKeywordHarvestQueries all-weak mode targets every weak term before broad seeds', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'strong', family: 'attack', evidenceCount: 4 },
        { term: 'weakA', family: 'attack', evidenceCount: 0 },
        { term: 'weakB', family: 'attack', evidenceCount: 1 },
        { term: 'weakC', family: 'evasion', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: ['seed topic'],
      coverageMode: 'all-weak',
      targetEvidence: 3,
      maxQueries: 8,
      termsPerFamily: 1,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'weakA 评论区 梗 热评',
    'weakB 评论区 梗 热评',
    'weakC 回复 评论区 热评',
    'seed topic',
  ]);
});

test('buildKeywordHarvestQueryPlan keeps dictionary term metadata for state tracking', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: ['seed topic'],
      coverageMode: 'all-weak',
      maxQueries: 3,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(plan, [
    {
      query: 'doge 讨论 评论区 热评',
      source: 'dictionary',
      term: 'doge',
      family: 'cooperation',
      evidenceCount: 0,
      priorAttempts: 0,
      priorSuccessfulAttempts: 0,
      sourcedEvidence: false,
      variantIndex: 0,
      builtInVariant: true,
      previouslyTried: false,
    },
    {
      query: 'doge 评论区',
      source: 'dictionary',
      term: 'doge',
      family: 'cooperation',
      evidenceCount: 0,
      priorAttempts: 0,
      priorSuccessfulAttempts: 0,
      sourcedEvidence: false,
      variantIndex: 1,
      builtInVariant: true,
      previouslyTried: false,
    },
    { query: 'seed topic', source: 'seed' },
  ]);
});

test('buildKeywordHarvestQueryPlan expands to untried variants for repeatedly missed terms', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: 2,
          successfulAttempts: 0,
          queries: [{ query: 'doge 讨论 评论区 热评' }, { query: 'doge 评论区' }],
        },
      },
    },
  );

  assert.deepEqual(
    plan.map((item) => [item.query, item.variantIndex, item.previouslyTried]),
    [
      ['doge 热评', 2, false],
      ['doge 弹幕', 3, false],
      ['doge 讨论 评论区 热评', 0, true],
      ['doge 评论区', 1, true],
    ],
  );
});

test('buildKeywordHarvestQueryPlan prioritizes retry actions before fresh harvest actions', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'fresh', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      includeExhaustedFallbackTemplates: false,
      termAttempts: {
        missed: {
          term: 'missed',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'missed 评论区 梗 热评' }],
        },
      },
    },
  );

  assert.equal(plan[0].term, 'missed');
  assert.equal(plan[0].query, 'missed 评论区');
  assert.equal(plan[0].previouslyTried, false);
  assert.equal(plan[1].term, 'missed');
});

test('buildKeywordHarvestQueryPlan rotates repeatedly missed terms behind unattempted terms', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'fresh', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      retryBeforeUnattemptedLimit: 3,
      termAttempts: {
        missed: {
          term: 'missed',
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'missed 评论区 梗 热评' },
            { query: 'missed 评论区' },
            { query: 'missed 热评' },
          ],
        },
      },
    },
  );

  assert.equal(plan[0].term, 'fresh');
  assert.equal(plan[0].query, 'fresh 评论区 梗 热评');
  assert.equal(plan[1].term, 'fresh');
});

test('buildKeywordHarvestQueryPlan can prioritize source metadata gaps', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'coveredNoSource', family: 'attack', evidenceCount: 3, evidenceSamples: ['sample without source'] },
        { term: 'weak', family: 'attack', evidenceCount: 0 },
        {
          term: 'coveredWithSource',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV1source', sample: 'sample with source' }],
        },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      requireSourceBackedEvidence: true,
      targetEvidence: 3,
      maxQueries: 2,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(plan.map((item) => [item.term, item.evidenceCount, item.sourcedEvidence]), [
    ['weak', 0, false],
    ['coveredNoSource', 3, false],
  ]);
});

test('buildKeywordHarvestQueryPlan runs priority queries before automatic coverage plan', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'weak', family: 'attack', evidenceCount: 0 }],
    },
    {
      priorityQueries: ['audit exported query'],
      seedQueries: ['seed topic'],
      coverageMode: 'all-weak',
      maxQueries: 3,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(plan.map((item) => [item.query, item.source]), [
    ['audit exported query', 'priority'],
    ['weak 评论区 梗 热评', 'dictionary'],
    ['seed topic', 'seed'],
  ]);
});

test('buildKeywordHarvestQueryPlan annotates audit priority queries with term metadata', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'weak', family: 'attack', evidenceCount: 0 }],
    },
    {
      priorityQueries: ['weak 评论区 梗 热评'],
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(plan[0], {
    query: 'weak 评论区 梗 热评',
    source: 'priority',
    term: 'weak',
    family: 'attack',
    evidenceCount: 0,
    sourcedEvidence: false,
    priorAttempts: 0,
    priorSuccessfulAttempts: 0,
    variantIndex: null,
    builtInVariant: true,
    previouslyTried: false,
  });
});


test('buildKeywordHarvestQueryPlan skips terms that exhausted every built-in query variant', () => {
  const allQueries = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 0 },
        { term: 'yygq', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.deepEqual(plan.map((item) => item.term), ['yygq', 'yygq']);
});

test('buildKeywordHarvestQueryPlan automatically uses exhausted fallback templates', () => {
  const allQueries = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.equal(plan[0].query, 'doge \u56de\u590d');
  assert.equal(plan[0].builtInVariant, false);
  assert.equal(plan[0].previouslyTried, false);
});

test('buildKeywordHarvestQueryPlan keeps broadening after first exhausted fallback wave', () => {
  const allQueries = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
    'doge \u56de\u590d',
    'doge \u4e92\u52a8',
    'cooperation doge \u8bc4\u8bba',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.equal(plan[0].query, 'doge \u8bc4\u8bba\u56de\u590d');
});

test('buildKeywordHarvestQueryPlan can reopen exhausted terms with extra runtime templates', () => {
  const allQueries = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 2,
      extraQueryTemplates: ['{term} \u9ad8\u80fd \u70ed\u8bc4'],
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.equal(plan[0].query, 'doge \u9ad8\u80fd \u70ed\u8bc4');
  assert.equal(plan[0].builtInVariant, false);
  assert.equal(plan[0].previouslyTried, false);
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

test('summarizeEvidenceCoverage reports weak terms and family coverage', () => {
  const coverage = summarizeEvidenceCoverage(
    {
      entries: [
        {
          term: 'doge',
          family: 'cooperation',
          evidenceCount: 4,
          evidenceSources: [{ source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1source/', uid: 'BV1source' }],
        },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 2 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.equal(coverage.terms, 3);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.totalEvidence, 6);
  assert.equal(coverage.averageEvidence, 2);
  assert.equal(coverage.coverageRatio, 0.3333);
  assert.equal(coverage.evidenceDeficit, 4);
  assert.equal(coverage.sourcedEvidenceTerms, 1);
  assert.equal(coverage.unsourcedEvidenceTerms, 1);
  assert.equal(coverage.sourceCoverageRatio, 0.3333);
  assert.equal(coverage.weakTerms, 2);
  assert.equal(coverage.zeroEvidenceTerms, 1);
  assert.deepEqual(coverage.weakSamples.map((entry) => entry.term), ['典中典', '懂的都懂']);
  assert.deepEqual(coverage.zeroEvidenceSamples.map((entry) => entry.term), ['典中典']);
  assert.deepEqual(coverage.unsourcedEvidenceSamples.map((entry) => entry.term), ['懂的都懂']);
  assert.deepEqual(coverage.byFamily.attack, { terms: 1, evidence: 0, weak: 1, zero: 1, sourced: 0 });
});

test('summarizeEvidenceCoverage marks coverage complete when every term reaches target evidence', () => {
  const coverage = summarizeEvidenceCoverage(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 3 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 5 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.equal(coverage.complete, true);
  assert.equal(coverage.coverageRatio, 1);
  assert.equal(coverage.evidenceDeficit, 0);
  assert.equal(coverage.weakTerms, 0);
});

test('summarizeTermAttempts reports attempted, successful, unattempted, and missed terms', () => {
  const summary = summarizeTermAttempts(
    {
      termAttempts: {
        doge: { term: 'doge', family: 'cooperation', attempts: 2, successfulAttempts: 1 },
        yygq: { term: 'yygq', family: 'attack', attempts: 3, successfulAttempts: 0, lastQuery: 'yygq 评论区' },
      },
    },
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 2 },
        { term: 'yygq', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 0 },
      ],
    },
  );

  assert.equal(summary.attemptedTerms, 2);
  assert.equal(summary.successfulTerms, 1);
  assert.equal(summary.unattemptedTerms, 1);
  assert.deepEqual(summary.unattemptedSamples.map((entry) => entry.term), ['懂的都懂']);
  assert.deepEqual(summary.repeatedlyMissedTerms.map((entry) => entry.term), ['yygq']);
  assert.equal(summary.exhaustedTerms, 0);
});

test('summarizeTermAttempts reports exhausted terms after every built-in variant misses', () => {
  const variants = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
  ];
  const summary = summarizeTermAttempts(
    {
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: variants.length,
          successfulAttempts: 0,
          lastQuery: 'doge',
          queries: variants.map((query) => ({ query })),
        },
      },
    },
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    { includeExhaustedFallbackTemplates: false },
  );

  assert.equal(summary.exhaustedTerms, 1);
  assert.deepEqual(summary.exhaustedSamples.map((entry) => entry.term), ['doge']);
  assert.equal(summary.exhaustedSamples[0].variantsTried, 14);
  assert.equal(summary.exhaustedSamples[0].suggestedQueries.includes('doge \u56de\u590d'), true);
});

test('buildCoverageActions classifies covered, unattempted, missed, partial, and exhausted terms', () => {
  const variants = [
    'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge \u8bc4\u8bba\u533a',
    'doge \u70ed\u8bc4',
    'doge \u5f39\u5e55',
    'doge \u4e89\u8bae \u8bc4\u8bba\u533a',
    'doge \u662f\u4ec0\u4e48\u6897',
    'doge \u4ec0\u4e48\u610f\u601d',
    'doge \u51fa\u5904',
    'doge \u540d\u6897',
    'doge \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
    'doge \u5207\u7247 \u8bc4\u8bba',
    'doge \u8bc4\u8bba \u6897',
    'doge B\u7ad9',
    'doge',
  ];
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: 'covered',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1covered/',
              uid: 'BV1covered',
              sample: 'covered source-backed sample',
            },
          ],
        },
        { term: 'sourceGap', family: 'attack', evidenceCount: 3, evidenceSamples: ['sample without source'] },
        { term: 'newbie', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
        { term: 'partial', family: 'attack', evidenceCount: 1 },
        { term: 'doge', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        missed: {
          term: 'missed',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'missed B\u7ad9 \u8bc4\u8bba\u533a \u6897' }],
          lastQuery: 'missed B\u7ad9 \u8bc4\u8bba\u533a \u6897',
        },
        partial: {
          term: 'partial',
          attempts: 1,
          successfulAttempts: 1,
          queries: [{ query: 'partial B\u7ad9 \u8bc4\u8bba\u533a \u6897', hit: true }],
        },
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: variants.length,
          successfulAttempts: 0,
          queries: variants.map((query) => ({ query })),
        },
      },
    },
    { targetEvidence: 3, requireSourceBackedEvidence: true, includeExhaustedFallbackTemplates: false },
  );
  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));

  assert.equal(byTerm.covered.action, 'none');
  assert.equal(byTerm.sourceGap.status, 'source_gap');
  assert.equal(byTerm.sourceGap.action, 'refresh_source_metadata');
  assert.equal(byTerm.sourceGap.nextQuery, 'sourceGap \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
  assert.equal(byTerm.newbie.action, 'harvest');
  assert.equal(byTerm.missed.action, 'retry_with_new_variant');
  assert.equal(byTerm.missed.nextQuery, 'missed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
  assert.equal(byTerm.partial.action, 'harvest_more_evidence');
  assert.equal(byTerm.doge.status, 'exhausted');
  assert.equal(byTerm.doge.action, 'add_query_template');
  assert.equal(byTerm.doge.suggestedQueries.includes('doge \u56de\u590d'), true);
});


test('buildDictionaryCoverageAudit reports gate status and next harvest actions', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'covered',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1covered/',
              uid: 'BV1covered',
              sample: 'covered source-backed sample',
            },
          ],
        },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
        { term: 'partial', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        missed: {
          term: 'missed',
          family: 'attack',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'missed B\u7ad9 \u8bc4\u8bba\u533a \u6897' }],
          lastQuery: 'missed B\u7ad9 \u8bc4\u8bba\u533a \u6897',
        },
        partial: {
          term: 'partial',
          family: 'evasion',
          attempts: 1,
          successfulAttempts: 1,
          queries: [{ query: 'partial B\u7ad9 \u56de\u590d \u8bc4\u8bba\u533a', hit: true }],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2 },
  );

  assert.equal(audit.ok, false);
  assert.equal(audit.coverage.coverageRatio, 0.3333);
  assert.equal(audit.coverage.sourcedEvidenceTerms, 1);
  assert.equal(audit.actionSummary.retry_with_new_variant, 1);
  assert.equal(audit.actionSummary.harvest_more_evidence, 1);
  assert.deepEqual(audit.nextActions.map((item) => item.term), ['missed', 'partial']);
  assert.equal(audit.recommendedQueries[0], 'missed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
  assert.equal(audit.familyGaps[0].family, 'attack');
  assert.equal(audit.failureReasons.some((reason) => reason.includes('term(s) are below')), true);
});

test('buildDictionaryCoverageAudit rotates stale retries after unattempted harvest actions', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: 'fresh', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        missed: {
          term: 'missed',
          family: 'attack',
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'missed 评论区 梗 热评' },
            { query: 'missed 评论区' },
            { query: 'missed 热评' },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['fresh', 'missed']);
  assert.deepEqual(audit.recommendedQueries, ['fresh 评论区 梗 热评', 'missed 弹幕']);
});

test('buildDictionaryCoverageAudit can require source-backed evidence metadata', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: 'unsourced', family: 'attack', evidenceCount: 3, evidenceSamples: ['unsourced sample'] },
        {
          term: 'sourced',
          family: 'cooperation',
          evidenceCount: 3,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVsourced', sample: 'sourced sample' }],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true },
  );

  assert.equal(audit.coverage.complete, true);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 1);
  assert.equal(audit.ok, false);
  assert.equal(audit.failureReasons.some((reason) => reason.includes('missing Bilibili source metadata')), true);
});

test('buildDictionaryCoverageAudit diversifies recommendations across related weak term groups', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', evidenceCount: 0 },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427', family: 'attack', evidenceCount: 0 },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', evidenceCount: 0 },
        { term: '\u8e6d\u6982\u5ff5', family: 'attack', evidenceCount: 0 },
      ],
    },
    {},
    {
      targetEvidence: 3,
      maxActions: 2,
    },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
    '\u8e6d\u6982\u5ff5',
  ]);
  assert.equal(audit.recommendedQueries.some((query) => query.includes('\u8e6d\u6982\u5ff5')), true);
});

test('harvestKeywordDictionary runs dictionary-seeded searches and reports growth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-'));
  const statePath = join(dir, 'state.json');
  const dictionaries = [
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  ];
  try {
    const searched = [];
    const result = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => dictionaries.shift() || dictionaries.at(-1),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: payload.searchQueries[0] === 'seed topic' ? 'BV1111111111' : 'BV2222222222' }],
            comments: [{ rpid: payload.searchQueries[0], message: 'comment' }],
            entries: [{ term: 'yygq', family: 'attack' }],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.queries, ['seed topic', 'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4']);
    assert.equal(searched.length, 2);
    assert.deepEqual(searched[0], {
      searchQueries: ['seed topic'],
      controversyQueries: undefined,
      discoveryMode: undefined,
      discoveryLimit: 1,
      pages: 1,
      excludeBvids: [],
    });
    assert.equal(result.growth.added, 1);
    assert.equal(result.coverage.weakTerms, 2);
    assert.equal(result.coverageProgress.evidenceGained, 0);
    assert.equal(result.termAttemptSummary.attemptedTerms, 1);
    assert.equal(result.coverageActions.some((item) => item.action !== 'none'), true);
    assert.deepEqual(result.state.scannedBvids, ['BV1111111111', 'BV2222222222']);
    const dogeAttempt = Object.values(result.state.termAttempts).find((item) => item.term === 'doge');
    assert.equal(dogeAttempt.attempts, 1);
    assert.equal(dogeAttempt.successfulAttempts, 0);
    assert.equal(dogeAttempt.lastVariantIndex, 0);
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(persisted.runs.length, 1);
    assert.equal(persisted.runs[0].videosScanned, 2);
    assert.equal(persisted.runs[0].attemptedTerms, 1);
    assert.equal(persisted.runs[0].exhaustedTerms, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary reports DeepSeek training diagnostics per run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-diagnostics-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [{ rpid: '1', message: 'comment' }],
          entries: [],
          keywordTraining: {
            available: true,
            keyConfigured: true,
            usedFallback: false,
            evidenceRejected: 2,
            dictionaryEvidenceEntries: [
              { term: 'doge', family: 'cooperation', evidenceCount: 1 },
            ],
          },
        }),
      },
    );

    assert.deepEqual(result.trainingDiagnostics, {
      deepseekCalls: 1,
      fallbackCalls: 0,
      evidenceRejected: 2,
      dictionaryEvidenceTerms: 1,
      dictionaryEvidenceCount: 1,
      generatedTerms: 0,
    });
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(persisted.runs[0].trainingDiagnostics, result.trainingDiagnostics);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary uses untried query variants after prior missed attempts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-retry-variant-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const second = await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV2222222222' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.deepEqual(second.queries, ['doge \u8bc4\u8bba\u533a']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary deepens scans for repeatedly missed terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-stale-missed-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const state = {
      version: 1,
      updatedAt: null,
      searchedQueries: [],
      scannedBvids: ['BVprevious'],
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4' },
            { query: 'doge \u8bc4\u8bba\u533a' },
            { query: 'doge \u70ed\u8bc4' },
          ],
        },
      },
      runs: [],
    };
    await writeFile(statePath, JSON.stringify(state), 'utf8');

    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        retryBeforeUnattemptedLimit: 3,
        discoveryLimit: 2,
        pages: 1,
        staleMissedDiscoveryLimit: 5,
        staleMissedPages: 4,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVstale' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(searched[0].discoveryLimit, 5);
    assert.equal(searched[0].pages, 4);
    assert.deepEqual(searched[0].excludeBvids, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary escalates zero-evidence repeatedly missed scans', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-hard-missed-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const state = {
      version: 1,
      updatedAt: null,
      searchedQueries: [],
      scannedBvids: ['BVprevious'],
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: 'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4' },
            { query: 'doge \u8bc4\u8bba\u533a' },
            { query: 'doge \u70ed\u8bc4' },
          ],
        },
      },
      runs: [],
    };
    await writeFile(statePath, JSON.stringify(state), 'utf8');

    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        retryBeforeUnattemptedLimit: 3,
        discoveryLimit: 2,
        pages: 1,
        staleMissedDiscoveryLimit: 4,
        staleMissedPages: 3,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVstale' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(searched[0].discoveryLimit, 8);
    assert.equal(searched[0].discoveryPages, 3);
    assert.equal(searched[0].pages, 5);
    assert.deepEqual(searched[0].excludeBvids, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary caps hard zero-evidence scans per run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-hard-cap-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const state = {
      version: 1,
      updatedAt: null,
      searchedQueries: [],
      scannedBvids: [],
      termAttempts: {
        hardA: {
          term: 'hardA',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [{ query: 'hardA \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' }],
        },
        hardB: {
          term: 'hardB',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [{ query: 'hardB \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' }],
        },
        normal: {
          term: 'normal',
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 1,
          successfulAttempts: 1,
          lastEvidenceCount: 1,
          queries: [{ query: 'normal \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' }],
        },
      },
      runs: [],
    };
    await writeFile(statePath, JSON.stringify(state), 'utf8');

    const result = await harvestKeywordDictionary(
      {
        maxQueries: 3,
        maxHardMissedQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        retryBeforeUnattemptedLimit: 3,
        discoveryLimit: 2,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: 'hardA', family: 'attack', evidenceCount: 0 },
            { term: 'hardB', family: 'attack', evidenceCount: 0 },
            { term: 'normal', family: 'attack', evidenceCount: 2 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(result.plan.map((item) => item.term), ['hardA', 'normal', 'normal']);
    assert.equal(searched.length, 3);
    assert.equal(searched[0].discoveryLimit, 8);
    assert.equal(searched[1].discoveryLimit, 2);
    assert.equal(searched[2].discoveryLimit, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary scales default hard zero-evidence scans with query budget', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-hard-scale-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const entries = ['hardA', 'hardB', 'hardC', 'hardD', 'normalA', 'normalB'].map((term) => ({
      term,
      family: 'attack',
      evidenceCount: term.startsWith('hard') ? 0 : 2,
    }));
    const state = {
      version: 1,
      searchedQueries: [],
      scannedBvids: [],
      termAttempts: Object.fromEntries(
        entries.map((entry) => [
          entry.term,
          {
            term: entry.term,
            family: entry.family,
            evidenceAtPlanTime: entry.evidenceCount,
            attempts: entry.term.startsWith('hard') ? 6 : 1,
            successfulAttempts: entry.term.startsWith('hard') ? 0 : 1,
            lastEvidenceCount: entry.evidenceCount,
            queries: [{ query: `${entry.term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4` }],
          },
        ]),
      ),
      runs: [],
    };
    await writeFile(statePath, JSON.stringify(state), 'utf8');

    const result = await harvestKeywordDictionary(
      {
        maxQueries: 8,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        retryBeforeUnattemptedLimit: 3,
        discoveryLimit: 2,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(result.plan.filter((item) => item.term?.startsWith('hard')).map((item) => item.term), [
      'hardA',
      'hardB',
      'hardC',
      'hardD',
    ]);
    assert.equal(result.queries.filter((query) => query.startsWith('hard')).length, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary writes ASCII-safe term attempt state for Chinese terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-ascii-state-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: '典中典', family: 'attack', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const raw = await readFile(statePath, 'utf8');
    assert.equal(/[^\x00-\x7F]/.test(raw), false);
    const state = JSON.parse(raw);
    const attempt = Object.values(state.termAttempts).find((item) => item.term === '典中典');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.query, undefined);
    assert.equal(attempt.lastQuery, '典中典 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary skips seen queries and videos from persistent state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-seen-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const second = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic', 'new seed'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV2222222222' }],
          comments: [],
          entries: [],
          excludeBvidsEcho: payload.excludeBvids,
        }),
      },
    );

    assert.deepEqual(second.queries, ['new seed']);
    assert.deepEqual(second.results[0].result.excludeBvidsEcho, ['BV1111111111']);
    const state = await readKeywordHarvestState(statePath);
    assert.deepEqual(state.searchedQueries, ['new seed', 'seed topic']);
    assert.deepEqual(state.scannedBvids, ['BV1111111111', 'BV2222222222']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary records term attempts for audit priority queries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-priority-attempt-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: ['weak 评论区 梗 热评'],
        seedQueries: [],
        maxQueries: 1,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'weak', family: 'attack', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const attempt = Object.values(result.state.termAttempts).find((item) => item.term === 'weak');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.successfulAttempts, 0);
    assert.equal(attempt.lastQuery, 'weak 评论区 梗 热评');
    assert.equal(attempt.queries[0].query, 'weak 评论区 梗 热评');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary backfills searched audit queries into term attempts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-backfill-priority-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: ['weak 评论区 梗 热评'],
        scannedBvids: [],
        termAttempts: {},
        runs: [],
      }),
      'utf8',
    );

    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'weak', family: 'attack', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.equal(result.backfilledAttempts, 1);
    assert.deepEqual(result.queries, ['weak 评论区']);
    const attempt = Object.values(result.state.termAttempts).find((item) => item.term === 'weak');
    assert.equal(attempt.attempts, 2);
    assert.equal(attempt.queries[0].query, 'weak 评论区 梗 热评');
    assert.equal(attempt.queries[0].error, 'backfilled from searched query history');
    assert.equal(attempt.queries[1].query, 'weak 评论区');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards discovery mode to video search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-mode-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryMode: 'mixed',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].discoveryMode, 'mixed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards controversy queries to video search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-controversy-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        controversyQueries: ['politics debate', 'game drama'],
        maxQueries: 1,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(payloads[0].controversyQueries, ['politics debate', 'game drama']);
    assert.equal(payloads[0].discoveryMode, 'controversial');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards controversial popular discovery options when configured', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-controversial-popular-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryMode: 'controversial',
        controversialPopularQueryLimit: 3,
        controversialPopularSearchOrder: 'click',
        includeGenericPopular: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].controversialPopularQueryLimit, 3);
    assert.equal(payloads[0].controversialPopularSearchOrder, 'click');
    assert.equal(payloads[0].includeGenericPopular, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards existing-only training mode to video search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-existing-only-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        existingTermsOnly: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].existingTermsOnly, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary targets the planned weak term during existing-only training', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-target-existing-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 0 },
            { term: '\u8def\u8fc7\u70ed\u8bcd', family: 'attack', evidenceCount: 4 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(payloads[0].targetExistingTerms, ['\u76ee\u6807\u5f31\u8bcd']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionaryRounds keeps running new unseen queries across rounds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-rounds-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const result = await harvestKeywordDictionaryRounds(
      {
        seedQueries: ['seed one', 'seed two'],
        maxQueries: 1,
        rounds: 3,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload.searchQueries[0]);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: payload.searchQueries[0] === 'seed one' ? 'BV1111111111' : 'BV2222222222' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.requestedRounds, 3);
    assert.equal(result.rounds.length, 3);
    assert.deepEqual(result.rounds.map((round) => round.queries), [['seed one'], ['seed two'], []]);
    assert.deepEqual(searched, ['seed one', 'seed two']);
    const state = await readKeywordHarvestState(statePath);
    assert.deepEqual(state.searchedQueries, ['seed one', 'seed two']);
    assert.deepEqual(state.scannedBvids, ['BV1111111111', 'BV2222222222']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionaryRounds stops early when evidence coverage is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-covered-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionaryRounds(
      {
        seedQueries: ['seed one', 'seed two'],
        maxQueries: 1,
        rounds: 5,
        discoveryLimit: 1,
        pages: 1,
        statePath,
        targetEvidence: 3,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'done', family: 'attack', evidenceCount: 3 }] }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: payload.searchQueries[0] === 'seed one' ? 'BV1111111111' : 'BV2222222222' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.rounds.length, 1);
    assert.equal(result.coverage.complete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
