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

test('buildKeywordHarvestQueries prioritizes exact searches for compact metric terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: '10w', family: 'evidence', evidenceCount: 1 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 4,
    },
  );

  assert.deepEqual(queries.slice(0, 3), ['10w', '10w \u70ed\u8bc4', '10w \u8bc4\u8bba\u533a']);
});

test('buildKeywordHarvestQueries prioritizes exact searches for mixed compact metric terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: '1w3', family: 'evidence', evidenceCount: 1 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 4,
    },
  );

  assert.deepEqual(queries.slice(0, 3), ['1w3', '1w3 \u70ed\u8bc4', '1w3 \u8bc4\u8bba\u533a']);
});

test('buildKeywordHarvestQueries prioritizes exact searches for compact RMB shorthand terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: '10r', family: 'evidence', evidenceCount: 1 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 4,
    },
  );

  assert.deepEqual(queries.slice(0, 3), ['10r', '10r \u70ed\u8bc4', '10r \u8bc4\u8bba\u533a']);
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

test('buildKeywordHarvestQueries uses comment-use aliases before ambiguous media titles', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: '\u95ee\u767e\u5ea6', family: 'evasion', evidenceCount: 1 }],
    },
    { maxQueries: 4, coverageMode: 'all-weak', queryVariantsPerTerm: 3 },
  );

  assert.deepEqual(queries.slice(0, 3), [
    '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5df1\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
  assert.equal(queries.some((query) => query.includes('\u767e\u5ea6\u4e00\u4e0b')), false);
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

test('buildKeywordHarvestQueries uses fresh aliases for noisy weak misses', () => {
  const cases = [
    {
      term: '\u7092\u9e21\u597d\u7528',
      family: 'cooperation',
      expectedAliasQuery: '\u8d85\u7ea7\u597d\u7528 \u8f6f\u4ef6 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e0d\u53ef\u62b5\u6297\u529b',
      family: 'attack',
      expectedAliasQuery: '\u4e0d\u53ef\u6297\u529b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba',
      family: 'attack',
      expectedAliasQuery: '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u62d4\u7fa4',
      family: 'cooperation',
      expectedAliasQuery: '\u6548\u679c\u62d4\u7fa4 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries.includes(item.expectedAliasQuery), true, `${item.term} should include ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries uses comment-form aliases for current weak misses', () => {
  const cases = [
    {
      term: '\u8349\u751f',
      family: 'cooperation',
      expectedAliasQuery: '\u751f\u8349 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236',
      family: 'absolutes',
      expectedAliasQuery: '\u590d\u5236\u5f39\u5e55 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u53d1\u56fe',
      family: 'evidence',
      expectedAliasQuery: '\u4e0a\u56fe \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u996d\u5708\u5473',
      family: 'attack',
      expectedAliasQuery: '\u996d\u5708\u5473\u592a\u51b2 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 5,
        queryVariantsPerTerm: 5,
      },
    );

    assert.equal(queries.includes(item.expectedAliasQuery), true, `${item.term} should include ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries uses controversy-context aliases for weak search misses', () => {
  const cases = [
    {
      term: '\u51fa\u5904',
      family: 'evidence',
      expectedAliasQuery: '\u6c42\u51fa\u5904 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
      expectedContextQuery: '\u6c42\u51fa\u5904 \u539f\u6587 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u963f\u7f8e\u8389\u5361',
      family: 'attack',
      expectedAliasQuery: '\u963f\u7f8e\u5229\u5361 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      expectedContextQuery: '\u963f\u7f8e\u5229\u5361 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a',
    },
    {
      term: '\u4e0d\u4e00\u4e00',
      family: 'evasion',
      expectedAliasQuery: '\u4e0d\u4e00\u4e00\u5217\u4e3e \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      expectedContextQuery: '\u4e0d\u4e00\u4e00 \u56de\u590d\u533a \u8bc4\u8bba\u533a',
    },
    {
      term: '\u5927\u9b54\u6cd5\u5e08',
      family: 'attack',
      expectedAliasQuery: '\u9b54\u6cd5\u5e08 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      expectedContextQuery: '\u9b54\u6cd5\u5e08 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u5730\u56fe\u70ae',
      family: 'attack',
      expectedAliasQuery: '\u5f00\u5730\u56fe\u70ae \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      expectedContextQuery: '\u5730\u56fe\u70ae \u5730\u57df\u9ed1 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684',
      family: 'attack',
      expectedAliasQuery: '\u4eba\u673a\u81ea\u52a8\u53d1 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      expectedContextQuery: '\u4eba\u673a\u81ea\u52a8\u53d1 \u6c34\u519b \u8bc4\u8bba\u533a',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: item.family, evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 48,
        queryVariantsPerTerm: 48,
      },
    );

    assert.equal(queries.includes(item.expectedAliasQuery), true, `${item.term} should include ${item.expectedAliasQuery}`);
    assert.equal(queries.includes(item.expectedContextQuery), true, `${item.term} should include ${item.expectedContextQuery}`);
  }
});

test('buildKeywordHarvestQueries starts with higher-signal aliases for ambiguous weak terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u963f\u7f8e\u8389\u5361', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u4e00\u4e00', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    '\u963f\u7f8e\u5229\u5361 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba',
    '\u7f8e\u5229\u575a \u4e2d\u7f8e \u70ed\u8bc4',
    '\u4e0d\u4e00\u4e00\u5217\u4e3e \u56de\u590d',
    '\u4e0d\u4e00\u4e00\u8bc4\u4ef7 \u8bc4\u8bba\u533a',
  ]);
});

test('buildKeywordHarvestQueries starts with comment variants for short missed phrases', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u522b\u55b7', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u9ed1\u4e0d\u5439', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e0d\u674e\u59d0', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 6,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    '\u522b\u55b7\u6211 \u8bc4\u8bba',
    '\u8f7b\u70b9\u55b7 \u70ed\u8bc4',
    '\u4e0d\u5439\u4e0d\u9ed1 \u8bc4\u8bba',
    '\u6709\u4e00\u8bf4\u4e00 \u70ed\u8bc4',
    '\u4e0d\u7406\u89e3 \u8bc4\u8bba',
    '\u6211\u4e0d\u7406\u89e3 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries starts with anchored variants for long missed phrases', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e0d\u662f\u4eba\u4e86\u5457', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u4e0d\u674e\u59d0', family: 'attack', evidenceCount: 1 },
        { term: '\u8fb9\u70b8\u8fb9\u79ef\u5fb7', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 6,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    '\u6c22\u5f39 \u8fb9\u70b8\u8fb9\u79ef\u5fb7 \u8bc4\u8bba',
    '\u6838\u7206 \u79ef\u5fb7 \u70ed\u8bc4',
    '\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457 \u8bc4\u8bba',
    '\u4e0d\u662f\u4eba\u4e86\u5457 \u5f39\u5e55',
    '\u6211\u4e0d\u7406\u89e3 \u8bc4\u8bba',
    '\u6211\u4e0d\u674e\u59d0 \u5f39\u5e55',
  ]);
});

test('buildKeywordHarvestQueries starts with comment anchors for evidence-backed weak terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e0d\u8981\u80e1\u8bf4', family: 'correction', evidenceCount: 1 },
        { term: '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302', family: 'absolutes', evidenceCount: 1 },
        { term: '\u51fa\u751f', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u53f7\u6ca1\u4e86', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    '\u4e0d\u8981\u80e1\u8bf4 \u56de\u590d',
    '\u522b\u80e1\u8bf4 \u8bc4\u8bba',
    '\u51fa\u751f \u6e38\u620f \u8bc4\u8bba',
    '\u7eaf\u51fa\u751f \u70ed\u8bc4',
    '\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302 \u8bc4\u8bba',
    '\u673a\u5bc6\u5168\u662f\u6302 \u70ed\u8bc4',
    '\u5927\u53f7\u6ca1\u4e86 \u8bc4\u8bba',
    '\u53f7\u6ca1\u4e86 \u70ed\u8bc4',
  ]);
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

test('buildKeywordHarvestQueries removes repeated whitespace query tokens', () => {
  const queries = buildKeywordHarvestQueries(
    { entries: [{ term: '\u54ea\u90fd\u6709\u4f60', family: 'attack', evidenceCount: 1 }] },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 40,
      queryVariantsPerTerm: 40,
    },
  );

  assert.equal(queries.includes('\u54ea\u513f\u90fd\u6709\u4f60 \u8bc4\u8bba\u533a \u8bc4\u8bba\u533a'), false);
  assert.equal(queries.includes('\u54ea\u513f\u90fd\u6709\u4f60 \u8bc4\u8bba\u533a'), true);
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
      recommendationGroup: 'doge',
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
      recommendationGroup: 'doge',
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
    recommendationGroup: 'weak',
    priorAttempts: 0,
    priorSuccessfulAttempts: 0,
    variantIndex: null,
    builtInVariant: true,
    previouslyTried: false,
  });
});

test('buildKeywordHarvestQueryPlan accepts audit action objects as priority queries', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'weak', family: 'attack', evidenceCount: 0 }],
    },
    {
      priorityQueries: [
        {
          term: 'weak',
          family: 'attack',
          nextQuery: 'weak 评论区',
          evidenceCount: 0,
          sourcedEvidence: false,
          recommendationGroup: 'weak',
          attempts: 2,
          successfulAttempts: 0,
        },
      ],
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 1,
    },
  );

  assert.equal(plan[0].query, 'weak 评论区');
  assert.equal(plan[0].source, 'priority');
  assert.equal(plan[0].term, 'weak');
  assert.equal(plan[0].priorAttempts, 2);
  assert.notEqual(plan[0].query, '[object Object]');
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
        {
          term: 'partial',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVpartial', sample: 'partial' }],
        },
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

test('buildCoverageActions broadens long contained phrase variants through shorter same-meaning anchors', () => {
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: '\u5927\u8c61\u611f\u5192\u4e86',
          family: 'evasion',
          meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
          evidenceCount: 1,
        },
        {
          term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
          family: 'evasion',
          meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
          evidenceCount: 1,
        },
      ],
    },
    {
      termAttempts: {
        '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc': {
          term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
            },
          ],
        },
      },
    },
    { targetEvidence: 3 },
  );

  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));
  assert.equal(byTerm['\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc'].status, 'weak_missed');
  assert.equal(
    byTerm['\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc'].nextQuery,
    '\u5927\u8c61\u611f\u5192\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
  );
});

test('buildCoverageActions broadens short contained fragments through longer same-meaning anchors', () => {
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: '\u0030\u4eba',
          family: 'attack',
          meaning: '\u7f51\u7edc\u6897\uff0c\u8868\u793a\u65e0\u4eba\u5173\u5fc3\uff0c\u7528\u4e8e\u8bbd\u523a\u5bf9\u65b9\u5b58\u5728\u611f\u4f4e',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public search-discovered video comment scan', sample: '\u90a3\u4e2a0\u4eba\u5728\u610f\u7684' }],
        },
        {
          term: '\u0030\u4eba\u5728\u610f',
          family: 'attack',
          meaning: '\u7f51\u7edc\u6897\uff0c\u8868\u793a\u65e0\u4eba\u5173\u5fc3\uff0c\u7528\u4e8e\u8bbd\u523a\u5bf9\u65b9\u5b58\u5728\u611f\u4f4e',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public search-discovered video comment scan', sample: '\u90a3\u4e2a0\u4eba\u5728\u610f\u7684' }],
        },
      ],
    },
    {
      searchedQueries: ['\u0030\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'],
      runs: [
        {
          queryDiagnostics: [
            {
              targetExistingTerms: ['\u0030\u4eba', '\u0030\u4eba\u5728\u610f'],
              acceptedTerms: [],
              commentsCollected: 442,
              trainingTextChars: 2000,
            },
          ],
        },
      ],
      termAttempts: {
        '\u0030\u4eba': {
          term: '\u0030\u4eba',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: '\u0030\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
            },
          ],
        },
        '\u0030\u4eba\u5728\u610f': {
          term: '\u0030\u4eba\u5728\u610f',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: '\u0030\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
            },
          ],
        },
      },
    },
    { targetEvidence: 3 },
  );

  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));
  assert.equal(byTerm['\u0030\u4eba'].status, 'weak_missed');
  assert.equal(byTerm['\u0030\u4eba'].nextQuery, '\u0030\u4eba\u5728\u610f \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildCoverageActions does not reuse a shorter anchor after irrelevant feedback', () => {
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: '\u0030\u4eba',
          family: 'attack',
          meaning: '\u7f51\u7edc\u6897\uff0c\u8868\u793a\u65e0\u4eba\u5173\u5fc3',
          evidenceCount: 1,
        },
        {
          term: '\u0030\u4eba\u5728\u610f',
          family: 'attack',
          meaning: '\u7f51\u7edc\u6897\uff0c\u8868\u793a\u65e0\u4eba\u5173\u5fc3',
          evidenceCount: 1,
        },
      ],
    },
    {
      runs: [
        {
          queryDiagnostics: [
            {
              targetExistingTerms: ['\u0030\u4eba'],
              acceptedTerms: [],
              commentsCollected: 442,
              trainingTextChars: 2000,
            },
          ],
        },
      ],
      termAttempts: {
        '\u0030\u4eba': {
          term: '\u0030\u4eba',
          attempts: 2,
          successfulAttempts: 0,
          queries: [
            {
              query: '\u0030\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
            },
            {
              query: '\u0030\u4eba \u8bc4\u8bba\u533a',
            },
          ],
        },
        '\u0030\u4eba\u5728\u610f': {
          term: '\u0030\u4eba\u5728\u610f',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: '\u0030\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
            },
          ],
        },
      },
    },
    { targetEvidence: 3 },
  );

  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));
  assert.equal(byTerm['\u0030\u4eba\u5728\u610f'].status, 'weak_missed');
  assert.equal(byTerm['\u0030\u4eba\u5728\u610f'].nextQuery, '\u0030\u4eba\u5728\u610f \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildCoverageActions does not fall back to over-specific long contained phrases after shorter anchors miss', () => {
  const shortQuery = '\u5927\u8c61\u611f\u5192\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4';
  const shortCommentQuery = '\u5927\u8c61\u611f\u5192\u4e86 \u8bc4\u8bba\u533a';
  const shortHotQuery = '\u5927\u8c61\u611f\u5192\u4e86 \u70ed\u8bc4';
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: '\u5927\u8c61\u611f\u5192\u4e86',
          family: 'evasion',
          meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
          evidenceCount: 1,
        },
        {
          term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
          family: 'evasion',
          meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
          evidenceCount: 1,
        },
      ],
    },
    {
      searchedQueries: [shortQuery, shortCommentQuery, shortHotQuery],
      termAttempts: {
        '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc': {
          term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
          attempts: 2,
          successfulAttempts: 0,
          queries: [{ query: shortQuery }, { query: shortCommentQuery }],
        },
      },
    },
    { targetEvidence: 3 },
  );

  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));
  assert.equal(byTerm['\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc'].status, 'weak_missed');
  assert.notEqual(
    byTerm['\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc'].nextQuery,
    '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc \u70ed\u8bc4',
  );
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

test('buildDictionaryCoverageAudit defers compact metric fragments behind discourse terms', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '10r', family: 'evidence', evidenceCount: 0 },
        { term: '3TP', family: 'evidence', evidenceCount: 0 },
        { term: '\u6760\u7cbe', family: 'attack', evidenceCount: 0 },
        { term: '\u6d17\u5730', family: 'evasion', evidenceCount: 0 },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, maxActions: 4 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['\u6760\u7cbe', '\u6d17\u5730', '3TP', '10r']);
  assert.equal(audit.recommendedQueries[0], '\u6760\u7cbe \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit keeps missed compact metrics behind fresh discourse terms', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '10r', family: 'evidence', evidenceCount: 1 },
        { term: '500w', family: 'evidence', evidenceCount: 1 },
        { term: '\u88ab\u9ed1', family: 'attack', evidenceCount: 1 },
        { term: '\u88ab\u9a82', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        '10r': {
          term: '10r',
          family: 'evidence',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '10r' }],
          lastQuery: '10r',
        },
        '500w': {
          term: '500w',
          family: 'evidence',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '500w' }],
          lastQuery: '500w',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['\u88ab\u9ed1', '\u88ab\u9a82']);
  assert.deepEqual(audit.recommendedQueries, ['\u88ab\u9ed1 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u88ab\u9a82 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4']);
});

test('buildDictionaryCoverageAudit keeps hard zero-evidence misses visible among weak sourced terms', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: 'zeroMiss', family: 'attack', evidenceCount: 0 },
        { term: 'weakA', family: 'attack', evidenceCount: 1 },
        { term: 'weakB', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        zeroMiss: {
          term: 'zeroMiss',
          family: 'attack',
          evidenceAtPlanTime: 0,
          lastEvidenceCount: 0,
          attempts: 6,
          successfulAttempts: 0,
          queries: [
            { query: 'zeroMiss 评论区 梗 热评' },
            { query: 'zeroMiss 评论区' },
            { query: 'zeroMiss 热评' },
            { query: 'zeroMiss B站 评论区 梗' },
            { query: 'zeroMiss B站 回复 评论区' },
            { query: 'zeroMiss 弹幕' },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions[0].term, 'zeroMiss');
  assert.equal(audit.nextActions[0].status, 'weak_missed');
  assert.equal(audit.recommendedQueries[0], audit.nextActions[0].nextQuery);
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

test('buildDictionaryCoverageAudit can require comment-backed evidence instead of video context only', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a video title',
            },
          ],
        },
        {
          term: 'commentBacked',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public video comment scan plus video context: https://www.bilibili.com/video/BVcomment/',
              uid: 'BVcomment',
              sample: 'commentBacked appears in a real reply',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  const byTerm = Object.fromEntries(audit.nextActions.map((item) => [item.term, item]));
  assert.equal(audit.coverage.sourcedEvidenceTerms, 1);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 1);
  assert.equal(audit.ok, false);
  assert.equal(byTerm.contextOnly.status, 'source_gap');
  assert.equal(byTerm.contextOnly.sourcedEvidence, false);
  assert.equal(audit.failureReasons.some((reason) => reason.includes('missing Bilibili comment evidence')), true);
});

test('buildDictionaryCoverageAudit counts only comment-backed evidence in strict comment mode', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext1/',
              uid: 'BVcontext1',
              sample: 'Bilibili video context: contextOnly from a video title',
            },
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext2/',
              uid: 'BVcontext2',
              sample: 'Bilibili video context: another title-only contextOnly hit',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  const action = audit.nextActions.find((item) => item.term === 'contextOnly');
  assert.equal(audit.coverage.totalEvidence, 0);
  assert.equal(audit.coverage.evidenceDeficit, 3);
  assert.equal(audit.coverage.zeroEvidenceTerms, 1);
  assert.equal(action.status, 'source_gap');
  assert.equal(action.evidenceCount, 2);
  assert.equal(action.coverageEvidenceCount, 0);
  assert.equal(action.evidenceNeeded, 3);
});

test('buildDictionaryCoverageAudit prioritizes weak context-only evidence for comment refresh', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: '\u8f66\u5bb6\u519b',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: \u822a\u5929\u8f66\u5bb6\u519b',
            },
          ],
        },
        {
          term: '\u666e\u901a\u5f31\u8bcd',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVcomment', sample: '\u666e\u901a\u5f31\u8bcd' }],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  const byTerm = Object.fromEntries(audit.nextActions.map((item) => [item.term, item]));
  assert.equal(byTerm['\u8f66\u5bb6\u519b'].status, 'source_gap');
  assert.equal(byTerm['\u8f66\u5bb6\u519b'].action, 'refresh_source_metadata');
  assert.equal(audit.nextActions[0].term, '\u8f66\u5bb6\u519b');
});

test('buildDictionaryCoverageAudit treats comment samples from mixed context scans as comment-backed evidence', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'commentSample',
          family: 'cooperation',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BVcomment/',
              uid: 'BVcomment',
              sample: '来支持力[打call]',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.coverage.sourcedEvidenceTerms, 1);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 0);
  assert.equal(audit.nextActions.length, 0);
});

test('buildDictionaryCoverageAudit treats non-context samples with Bilibili source metadata as comment-backed evidence', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'commentSampleOnly',
          family: 'cooperation',
          evidenceCount: 3,
          evidenceSamples: ['来支持力[打call]', 'Bilibili video context: title-only sample'],
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BVcomment/',
              uid: 'BVcomment',
              sample: 'Bilibili video context: title-only sample',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.coverage.sourcedEvidenceTerms, 1);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 0);
  assert.equal(audit.nextActions.length, 0);
});

test('buildDictionaryCoverageAudit prioritizes context-only source gaps before ordinary weak retries', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a video title',
            },
          ],
        },
        {
          term: 'weakRetry',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVweak', sample: 'weakRetry' }],
        },
      ],
    },
    {
      termAttempts: {
        weakRetry: {
          term: 'weakRetry',
          family: 'attack',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'weakRetry \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' }],
        },
      },
    },
    {
      targetEvidence: 3,
      maxActions: 2,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      prioritizeSourceGaps: true,
    },
  );

  assert.equal(audit.nextActions[0].term, 'contextOnly');
  assert.equal(audit.nextActions[0].status, 'source_gap');
  assert.equal(audit.recommendedQueries[0], 'contextOnly \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit keeps comment-missed source gaps ahead of ordinary weak terms', () => {
  const contextSource = {
    source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
    uid: 'BVcontext',
    sample: 'Bilibili video context: title-only source',
  };
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 2, evidenceSources: [contextSource] },
        { term: '\u95ee\u767e\u5ea6', family: 'evasion', evidenceCount: 2, evidenceSources: [contextSource] },
        {
          term: '\u666e\u901a\u5f31\u8bcd',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVweak', sample: '\u666e\u901a\u5f31\u8bcd' }],
        },
      ],
    },
    {
      termAttempts: {
        [Buffer.from('\u8f66\u5bb6\u519b', 'utf8').toString('base64url')]: {
          term: '\u8f66\u5bb6\u519b',
          family: 'attack',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '\u8f66\u5bb6\u519b \u8bc4\u8bba\u533a', strategyVersion: 4, ok: true, hit: false, videos: 4, comments: 20 }],
        },
        [Buffer.from('\u95ee\u767e\u5ea6', 'utf8').toString('base64url')]: {
          term: '\u95ee\u767e\u5ea6',
          family: 'evasion',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '\u95ee\u767e\u5ea6 \u8bc4\u8bba\u533a', strategyVersion: 4, ok: true, hit: false, videos: 2, comments: 7 }],
        },
      },
    },
    {
      targetEvidence: 3,
      maxActions: 3,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      prioritizeSourceGaps: true,
    },
  );

  assert.deepEqual(
    audit.nextActions.slice(0, 2).map((item) => item.status),
    ['source_gap', 'source_gap'],
  );
});

test('buildDictionaryCoverageAudit keeps comment-backed source refreshes on comment evidence queries', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'sourceGap',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: sourceGap from a title',
            },
          ],
        },
      ],
    },
    {
      searchedQueries: ['sourceGap \u662f\u4ec0\u4e48\u6897'],
      runs: [
        {
          queryDiagnostics: [
            [
              {
                targetExistingTerms: ['sourceGap'],
                acceptedTerms: [],
                commentsCollected: 12,
                trainingTextChars: 400,
              },
            ],
          ],
        },
      ],
      termAttempts: {
        sourceGap: {
          term: 'sourceGap',
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'sourceGap \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
            { query: 'sourceGap \u8bc4\u8bba\u533a' },
            { query: 'sourceGap \u70ed\u8bc4' },
          ],
        },
      },
    },
    {
      targetEvidence: 3,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      prioritizeSourceGaps: true,
    },
  );

  assert.equal(audit.nextActions[0].status, 'source_gap');
  assert.equal(audit.nextActions[0].nextQuery, 'sourceGap \u4e89\u8bae \u8bc4\u8bba\u533a');
  assert.equal(audit.recommendedQueries[0].includes('\u662f\u4ec0\u4e48\u6897'), false);
});

test('buildDictionaryCoverageAudit rotates source gaps behind fresh weak terms after a current comment miss', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a title',
            },
          ],
        },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        contextOnly: {
          term: 'contextOnly',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: 'contextOnly \u8bc4\u8bba\u533a',
              strategyVersion: 4,
              ok: true,
              hit: false,
              comments: 18,
            },
          ],
        },
      },
    },
    {
      targetEvidence: 3,
      maxActions: 2,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      prioritizeSourceGaps: true,
    },
  );

  assert.equal(audit.nextActions[0].term, 'freshWeak');
  assert.equal(audit.nextActions[1].term, 'contextOnly');
  assert.equal(audit.nextActions[1].currentCommentMisses, 1);
});

test('buildDictionaryCoverageAudit rotates comment-missed source gaps by default', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a title',
            },
          ],
        },
        { term: 'weakMiss', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        contextOnly: {
          term: 'contextOnly',
          attempts: 1,
          successfulAttempts: 1,
          queries: [
            {
              query: 'contextOnly \u8bc4\u8bba\u533a',
              strategyVersion: 4,
              ok: true,
              hit: false,
              videos: 3,
              comments: 12,
            },
          ],
        },
        weakMiss: {
          term: 'weakMiss',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: 'weakMiss \u8bc4\u8bba\u533a',
              strategyVersion: 4,
              ok: true,
              hit: false,
              videos: 3,
              comments: 12,
            },
          ],
        },
      },
    },
    {
      targetEvidence: 3,
      maxActions: 2,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
    },
  );

  assert.equal(audit.nextActions[0].term, 'weakMiss');
  assert.equal(audit.nextActions[1].term, 'contextOnly');
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

test('buildDictionaryCoverageAudit diversifies same-meaning contained phrase groups', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
          family: 'attack',
          meaning: '\u5938\u5f20\u5410\u69fd\u751f\u7406\u6027\u538c\u6076',
          evidenceCount: 1,
        },
        {
          term: '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
          family: 'attack',
          meaning: '\u5938\u5f20\u5410\u69fd\u751f\u7406\u6027\u538c\u6076',
          evidenceCount: 1,
        },
        { term: '\u4e0d\u670d\u61cb\u7740', family: 'attack', evidenceCount: 1 },
      ],
    },
    {},
    {
      targetEvidence: 3,
      maxActions: 2,
    },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), [
    '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
    '\u4e0d\u670d\u61cb\u7740',
  ]);
});

test('buildDictionaryCoverageAudit recommends precision queries for hard zero-evidence misses', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
        { term: '\u8c01\u662f\u8e6d\u6982\u5ff5', family: 'attack', evidenceCount: 0 },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        [Buffer.from('\u8f66\u5bb6\u519b', 'utf8').toString('base64url')]: {
          term: '\u8f66\u5bb6\u519b',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u8f66\u5bb6\u519b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
            { query: '\u96f7\u519b\u7c89\u4e1d \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
            { query: '\u5c0f\u7c73\u6c34\u519b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
          ],
        },
        [Buffer.from('\u8c01\u662f\u8e6d\u6982\u5ff5', 'utf8').toString('base64url')]: {
          term: '\u8c01\u662f\u8e6d\u6982\u5ff5',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u8c01\u662f\u8e6d\u6982\u5ff5 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
            { query: '\u8c01\u5728\u8e6dAI \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
          ],
        },
        [Buffer.from('\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', 'utf8').toString('base64url')]: {
          term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
            { query: '\u4e0d\u4f1a\u771f\u6709\u4eba\u4ee5\u4e3a \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 3, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions.find((item) => item.term === '\u8f66\u5bb6\u519b').nextQuery, '\u5c0f\u7c73\u6c7d\u8f66 \u8f66\u5bb6\u519b \u63a7\u8bc4');
  assert.equal(audit.nextActions.find((item) => item.term === '\u8c01\u662f\u8e6d\u6982\u5ff5').nextQuery, '\u8e6d\u6982\u5ff5\u662f\u8c01 AI');
  assert.equal(audit.nextActions.find((item) => item.term === '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97').nextQuery, '\u4e0d\u4f1a\u771f\u6709\u4eba \u8bc1\u636e \u56de\u590d');
});

test('buildDictionaryCoverageAudit rewrites hard misses after irrelevant query diagnostics', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
        { term: '\u8c01\u662f\u8e6d\u6982\u5ff5', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        [Buffer.from('\u8f66\u5bb6\u519b', 'utf8').toString('base64url')]: {
          term: '\u8f66\u5bb6\u519b',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 8,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4' },
            { query: '\u7c73\u7c89\u63a7\u8bc4 SU7' },
          ],
        },
        [Buffer.from('\u8c01\u662f\u8e6d\u6982\u5ff5', 'utf8').toString('base64url')]: {
          term: '\u8c01\u662f\u8e6d\u6982\u5ff5',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 8,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u8e6d\u6982\u5ff5 \u6e38\u620f\u516c\u53f8' },
            { query: '\u786c\u8e6dAI\u6982\u5ff5' },
          ],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4',
                commentsCollected: 26,
                trainingTextChars: 1746,
                targetExistingTerms: ['\u8f66\u5bb6\u519b', '\u6ca1\u6709\u8f66\u5bb6\u519b'],
                acceptedTerms: [],
              },
              {
                query: '\u8e6d\u6982\u5ff5 \u6e38\u620f\u516c\u53f8',
                commentsCollected: 18,
                trainingTextChars: 557,
                targetExistingTerms: ['\u8e6d\u6982\u5ff5', '\u8c01\u662f\u8e6d\u6982\u5ff5'],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions.find((item) => item.term === '\u8f66\u5bb6\u519b').nextQuery, '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a');
  assert.equal(audit.nextActions.find((item) => item.term === '\u8c01\u662f\u8e6d\u6982\u5ff5').nextQuery, '\u8c01\u662f\u8e6d\u6982\u5ff5 \u539f\u8bdd');
});

test('buildDictionaryCoverageAudit falls back to exact terms after feedback queries miss', () => {
  const term = '\u8f66\u5bb6\u519b';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 0 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 9,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a' },
            { query: '\u6ca1\u6709\u8f66\u5bb6\u519b \u5c0f\u7c73SU7' },
            { query: '\u8f66\u5bb6\u519b \u96f7\u519b \u539f\u8bdd' },
          ],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a',
                commentsCollected: 20,
                trainingTextChars: 500,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u8f66\u5bb6\u519b \u8bc4\u8bba\u533a');
});

test('buildDictionaryCoverageAudit retries exact term after weak missed irrelevant query feedback', () => {
  const term = '\u4e0d\u8bd7\u4eba';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'absolutes', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'absolutes',
          evidenceAtPlanTime: 1,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [
            { query: '\u4e0d\u8bd7\u4eba \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4' },
            { query: '\u4e0d\u8bd7\u4eba \u8bc4\u8bba\u533a' },
          ],
          lastQuery: '\u4e0d\u8bd7\u4eba \u8bc4\u8bba\u533a',
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u4e0d\u8bd7\u4eba \u8bc4\u8bba\u533a',
                commentsCollected: 7,
                trainingTextChars: 1102,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u4e0d\u8bd7\u4eba \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit prefers precision feedback queries for ambiguous missed terms', () => {
  const term = '\u51fa\u5904';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'evidence', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'evidence',
          evidenceAtPlanTime: 1,
          attempts: 1,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [{ query: '\u6c42\u51fa\u5904 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a' }],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u6c42\u51fa\u5904 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
                commentsCollected: 24,
                trainingTextChars: 813,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u6c42\u51fa\u5904 \u8bc4\u8bba\u533a');
});

test('buildDictionaryCoverageAudit avoids broad Baidu product retries after ask-baidu misses', () => {
  const term = '\u95ee\u767e\u5ea6';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'evidence', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'evidence',
          evidenceAtPlanTime: 1,
          attempts: 6,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u8bc4\u8bba\u533a', strategyVersion: 4 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u70ed\u8bc4', strategyVersion: 4 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d', strategyVersion: 4 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6', strategyVersion: 4 },
            { query: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', strategyVersion: 4 },
          ],
          lastQuery: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
                commentsCollected: 90,
                trainingTextChars: 2400,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.match(audit.nextActions[0].nextQuery, /\u81ea\u5df1\u767e\u5ea6|\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417/);
  assert.doesNotMatch(audit.nextActions[0].nextQuery, /\u767e\u5ea6\u4e00\u4e0b/);
});

test('buildDictionaryCoverageAudit keeps exact feedback retries comment-bearing after a comment miss', () => {
  const term = '\u7ef7\u4e0d\u4f4f\u4e86';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 1,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [{ query: '\u7ef7\u4e0d\u4f4f\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4' }],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u7ef7\u4e0d\u4f4f\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
                commentsCollected: 17,
                trainingTextChars: 1027,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u7ef7\u4e0d\u4f4f\u4e86 \u8bc4\u8bba\u533a');
});

test('buildDictionaryCoverageAudit treats text-only misses as irrelevant query feedback', () => {
  const term = '\u6807\u9898\u515a\u6253\u6cd5';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'evidence', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'evidence',
          evidenceAtPlanTime: 1,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [
            { query: '\u6807\u9898\u515a\u6253\u6cd5 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a' },
            { query: '\u6807\u9898\u515a\u6253\u6cd5 \u8bc4\u8bba\u533a' },
          ],
          lastQuery: '\u6807\u9898\u515a\u6253\u6cd5 \u8bc4\u8bba\u533a',
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u6807\u9898\u515a\u6253\u6cd5 \u8bc4\u8bba\u533a',
                commentsCollected: 0,
                trainingTextChars: 553,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u70ed\u8bc4`);
});

test('buildDictionaryCoverageAudit treats filtered search-context misses as irrelevant query feedback', () => {
  const term = '\u4e0d\u53ef\u62b5\u6297\u529b';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [
            { query: `${term} \u8bc4\u8bba\u533a`, strategyVersion: 4, ok: false, hit: false },
            { query: `${term} \u70ed\u8bc4`, strategyVersion: 4, ok: false, hit: false },
          ],
          lastQuery: `${term} \u70ed\u8bc4`,
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: `${term} \u70ed\u8bc4`,
                discoveredVideos: 0,
                discoveryContextVideos: 10,
                scannedVideos: 0,
                commentsCollected: 0,
                trainingTextChars: 0,
                targetExistingTerms: [term],
                acceptedTerms: [],
                sampleVideos: [
                  { title: '\u62b5\u6297\u529b\u5dee\u3001\u4f53\u8d28\u5f31\u6613\u751f\u75c5' },
                  { title: '\u5bf9\u6234\u773c\u955c\u7684\u5973\u751f\u6beb\u65e0\u62b5\u6297\u529b' },
                ],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, term);
});

test('buildDictionaryCoverageAudit tries bare aliases after scaffolded search results filter out', () => {
  const term = '\u4f60\u88c5\u4ec0\u4e48';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 1,
          queries: [
            { query: '\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 4, ok: false, hit: false },
            { query: '\u4f60\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 4, ok: false, hit: false },
          ],
          lastQuery: '\u4f60\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u4f60\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
                discoveredVideos: 0,
                discoveryContextVideos: 10,
                scannedVideos: 0,
                commentsCollected: 0,
                trainingTextChars: 0,
                targetExistingTerms: [term, '\u88c5\u4ec0\u4e48'],
                acceptedTerms: [],
                sampleVideos: [{ title: '\u4e2d\u6587\u8bc4\u8bba\u533ameme' }],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, term);
});

test('buildDictionaryCoverageAudit does not recommend globally searched feedback queries again', () => {
  const term = '\u8f66\u5bb6\u519b';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 0 }],
    },
    {
      harvestStrategyVersion: 2,
      searchedQueries: [
        '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a',
        '\u6ca1\u6709\u8f66\u5bb6\u519b \u5c0f\u7c73SU7',
        '\u8f66\u5bb6\u519b \u96f7\u519b \u539f\u8bdd',
      ],
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 9,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a',
                commentsCollected: 20,
                trainingTextChars: 500,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u8bc4\u8bba\u533a`);
});

test('buildDictionaryCoverageAudit can retry exact queries from older harvest strategy state', () => {
  const term = '\u8f66\u5bb6\u519b';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 0 }],
    },
    {
      harvestStrategyVersion: 0,
      searchedQueries: [term, '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a'],
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 9,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: term, hit: false },
            { query: '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a', hit: false },
            { query: '\u6ca1\u6709\u8f66\u5bb6\u519b \u5c0f\u7c73SU7', hit: false },
            { query: '\u8f66\u5bb6\u519b \u96f7\u519b \u539f\u8bdd', hit: false },
          ],
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: term,
                commentsCollected: 20,
                trainingTextChars: 500,
                targetExistingTerms: [term],
                acceptedTerms: [],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u8bc4\u8bba\u533a`);
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

test('harvestKeywordDictionary persists per-query collection diagnostics', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-query-diagnostics-'));
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
          videos: [{ bvid: 'BV1111111111', title: 'diagnostic title' }],
          comments: [{ rpid: '1', message: 'comment' }],
          entries: [],
          collectionDiagnostics: {
            discoveredVideos: 2,
            discoveryContextVideos: 3,
            scannedVideos: 1,
            commentsCollected: 1,
            trainingTextChars: 42,
            targetExistingTerms: ['doge'],
            acceptedTerms: [],
            evidenceRejected: 2,
            sampleVideos: [{ bvid: 'BV1111111111', title: 'diagnostic title' }],
          },
        }),
      },
    );

    assert.equal(result.queryDiagnostics.length, 1);
    assert.equal(result.queryDiagnostics[0].query, 'seed topic');
    assert.equal(result.queryDiagnostics[0].commentsCollected, 1);
    assert.equal(result.queryDiagnostics[0].trainingTextChars, 42);
    assert.deepEqual(result.queryDiagnostics[0].targetExistingTerms, ['doge']);
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(persisted.runs[0].queryDiagnostics, result.queryDiagnostics);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary preserves target diagnostics for failed discovery attempts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-failed-query-diagnostics-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        existingTermsOnly: true,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u76ee\u6807\u5931\u8d25\u8bcd',
              family: 'attack',
              evidenceCount: 1,
              meaning: 'same failed target',
            },
            {
              term: '\u76ee\u6807\u5931\u8d25\u8bcd\u5427',
              family: 'attack',
              evidenceCount: 1,
              meaning: 'same failed target',
            },
          ],
        }),
        searchVideoKeywords: async (payload) => ({
          ok: false,
          error: 'No Bilibili videos were discovered from the backend discovery mode.',
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
          collectionDiagnostics: {
            discoveredVideos: 0,
            discoveryContextVideos: 0,
            scannedVideos: 0,
            commentsCollected: 0,
            trainingTextChars: 0,
            targetExistingTerms: payload.targetExistingTerms,
            acceptedTerms: [],
            evidenceRejected: 0,
            sampleVideos: [],
          },
        }),
      },
    );

    assert.equal(result.queryDiagnostics.length, 1);
    assert.deepEqual(new Set(result.queryDiagnostics[0].targetExistingTerms), new Set(['\u76ee\u6807\u5931\u8d25\u8bcd', '\u76ee\u6807\u5931\u8d25\u8bcd\u5427']));
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    const attempts = Object.values(persisted.termAttempts);
    assert.equal(attempts.some((attempt) => attempt.term === '\u76ee\u6807\u5931\u8d25\u8bcd\u5427'), true);
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

test('harvestKeywordDictionary deepens scans after a current comment miss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-missed-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const state = {
      version: 1,
      harvestStrategyVersion: 4,
      updatedAt: null,
      searchedQueries: [],
      scannedBvids: ['BVprevious'],
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: 'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
              strategyVersion: 4,
              ok: true,
              hit: false,
              comments: 12,
            },
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
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 1 }] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVcommentmiss' }],
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

test('harvestKeywordDictionary deepens scans after current videos have no comments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-empty-comment-videos-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const state = {
      version: 1,
      harvestStrategyVersion: 4,
      updatedAt: null,
      searchedQueries: [],
      scannedBvids: ['BVempty1', 'BVempty2'],
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: 'doge',
              strategyVersion: 4,
              ok: true,
              hit: false,
              videos: 2,
              comments: 0,
            },
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
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 1 }] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVfresh' }],
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

    assert.deepEqual(result.plan.map((item) => item.term), ['hardA', 'normal', undefined]);
    assert.equal(searched.length, 3);
    assert.equal(searched[0].discoveryLimit, 8);
    assert.equal(searched[1].discoveryLimit, 2);
    assert.equal(searched[2].discoveryLimit, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary fills limited runs with distinct term groups before duplicate variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-distinct-groups-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        updatedAt: null,
        searchedQueries: [],
        scannedBvids: [],
        termAttempts: {
          '\u5927\u8c61\u611f\u5192\u4e86': {
            term: '\u5927\u8c61\u611f\u5192\u4e86',
            attempts: 1,
            successfulAttempts: 0,
            queries: [{ query: '\u5927\u8c61\u611f\u5192\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4' }],
          },
          '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc': {
            term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
            attempts: 1,
            successfulAttempts: 0,
            queries: [{ query: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4' }],
          },
        },
        runs: [],
      }),
      'utf8',
    );

    const result = await harvestKeywordDictionary(
      {
        maxQueries: 2,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
            { term: '\u767d\u5ad6', family: 'attack', evidenceCount: 1 },
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

    assert.deepEqual(result.plan.map((item) => item.term), ['\u5927\u8c61\u611f\u5192\u4e86', '\u767d\u5ad6']);
    assert.equal(searched.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary skips same-meaning contained duplicate groups in limited runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-contained-distinct-groups-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionary(
      {
        maxQueries: 2,
        coverageMode: 'all-weak',
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
              family: 'attack',
              meaning: '\u5938\u5f20\u5410\u69fd\u751f\u7406\u6027\u538c\u6076',
              evidenceCount: 1,
            },
            {
              term: '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
              family: 'attack',
              meaning: '\u5938\u5f20\u5410\u69fd\u751f\u7406\u6027\u538c\u6076',
              evidenceCount: 1,
            },
            { term: '\u4e0d\u670d\u61cb\u7740', family: 'attack', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.deepEqual(result.plan.map((item) => item.term), [
      '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
      '\u4e0d\u670d\u61cb\u7740',
    ]);
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

test('harvestKeywordDictionary prefixes planned terms into controversial discovery queries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-term-controversy-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        controversyQueries: ['politics debate', 'game drama'],
        maxQueries: 1,
        existingTermsOnly: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 0 }],
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

    assert.deepEqual(payloads[0].controversyQueries.slice(0, 4), [
      '\u76ee\u6807\u5f31\u8bcd \u4e89\u8bae \u70ed\u8bc4',
      '\u76ee\u6807\u5f31\u8bcd \u8282\u594f \u8bc4\u8bba\u533a',
      '\u76ee\u6807\u5f31\u8bcd \u6e38\u620f \u8282\u594f \u70ed\u8bc4',
      '\u76ee\u6807\u5f31\u8bcd \u65f6\u653f \u4e89\u8bae \u8bc4\u8bba\u533a',
    ]);
    assert.equal(payloads[0].controversyQueries.includes('politics debate'), true);
    assert.equal(payloads[0].controversyQueries.includes('game drama'), true);
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

test('harvestKeywordDictionary targets related weak aliases during existing-only training', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-related-target-existing-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', evidenceCount: 0 },
            { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427', family: 'attack', evidenceCount: 0 },
            { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', evidenceCount: 0 },
            { term: '\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
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

    assert.deepEqual(payloads[0].targetExistingTerms, [
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary targets same-meaning contained phrase variants during existing-only training', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-contained-target-existing-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4',
              family: 'attack',
              meaning: 'same complaint phrase',
              evidenceCount: 0,
            },
            {
              term: '\u5403\u4e86\u4e09\u5768\u7fd4',
              family: 'attack',
              meaning: 'same complaint phrase',
              evidenceCount: 0,
            },
            {
              term: '\u4e0d\u76f8\u5173',
              family: 'attack',
              meaning: 'different attack phrase',
              evidenceCount: 0,
            },
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

    assert.deepEqual(new Set(payloads[0].targetExistingTerms), new Set(['\u5403\u4e86\u4e09\u5768\u7fd4', '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4']));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary records attempts for related target terms from one scan', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-related-target-attempts-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
          ],
        }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
          collectionDiagnostics: {
            targetExistingTerms: payload.targetExistingTerms,
            acceptedTerms: [],
          },
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const shortAttempt = state.termAttempts[Buffer.from('\u5927\u8c61\u611f\u5192\u4e86', 'utf8').toString('base64url')];
    const longAttempt = state.termAttempts[Buffer.from('\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc', 'utf8').toString('base64url')];

    assert.equal(shortAttempt.attempts, 1);
    assert.equal(longAttempt.attempts, 1);
    assert.equal(longAttempt.lastQuery, shortAttempt.lastQuery);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary records a hit when the returned dictionary gained target evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-dictionary-gain-attempt-'));
  const statePath = join(dir, 'state.json');
  const term = '\u76ee\u6807\u5df2\u589e\u8bc1\u636e';
  try {
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term, family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
          keywordTraining: {
            dictionaryEvidenceEntries: [],
          },
          dictionary: {
            entries: [{ term, family: 'attack', evidenceCount: 2 }],
          },
          collectionDiagnostics: {
            targetExistingTerms: [term],
            acceptedTerms: [],
          },
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempt = state.termAttempts[Buffer.from(term, 'utf8').toString('base64url')];

    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.successfulAttempts, 1);
    assert.equal(attempt.lastEvidenceCount, 2);
    assert.equal(attempt.queries[0].hit, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary backfills shorter-anchor searched queries for related contained terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-contained-backfill-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 4,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: ['\u5927\u8c61\u611f\u5192\u4e86 \u70ed\u8bc4'],
        scannedBvids: [],
        termAttempts: {},
        runs: [],
      }),
      'utf8',
    );

    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
            {
              term: '\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
              family: 'evasion',
              meaning: '\u7f51\u7edc\u8c1c\u8bed\u9677\u9631',
              evidenceCount: 1,
            },
          ],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const longAttempt = state.termAttempts[Buffer.from('\u5927\u8c61\u611f\u5192\u4e86\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc', 'utf8').toString('base64url')];

    assert.equal(longAttempt.queries.some((item) => item.query === '\u5927\u8c61\u611f\u5192\u4e86 \u70ed\u8bc4'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary keeps target terms for feedback priority queries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-feedback-priority-target-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: [],
        scannedBvids: [],
        termAttempts: {
          [Buffer.from('\u8f66\u5bb6\u519b', 'utf8').toString('base64url')]: {
            term: '\u8f66\u5bb6\u519b',
            family: 'attack',
            evidenceAtPlanTime: 0,
            attempts: 8,
            successfulAttempts: 0,
            lastEvidenceCount: 0,
            queries: [{ query: '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4' }],
          },
        },
        runs: [
          {
            queryDiagnostics: [
              [
                {
                  query: '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4',
                  commentsCollected: 20,
                  trainingTextChars: 500,
                  targetExistingTerms: ['\u8f66\u5bb6\u519b', '\u6ca1\u6709\u8f66\u5bb6\u519b'],
                  acceptedTerms: [],
                },
              ],
            ],
          },
        ],
      }),
      'utf8',
    );
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: ['\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
            { term: '\u6ca1\u6709\u8f66\u5bb6\u519b', family: 'attack', evidenceCount: 0 },
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

    assert.deepEqual(payloads[0].targetExistingTerms, ['\u8f66\u5bb6\u519b', '\u6ca1\u6709\u8f66\u5bb6\u519b']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary targets context-only source gaps during existing-only refresh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-context-source-gap-target-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: ['\u5178\u4e2d\u5178 \u8bc4\u8bba\u533a'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        requireSourceBackedEvidence: true,
        requireCommentBackedEvidence: true,
        prioritizeSourceGaps: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u5178\u4e2d\u5178',
              family: 'attack',
              evidenceCount: 3,
              evidenceSources: [
                {
                  source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
                  uid: 'BVcontext',
                  sample: 'Bilibili video context: \u5178\u4e2d\u5178\u4e4b\u7eb8\u624e\u798f',
                },
              ],
            },
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

    assert.deepEqual(payloads[0].targetExistingTerms, ['\u5178\u4e2d\u5178']);
    assert.equal(payloads[0].includeVideoContext, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary keeps strict comment coverage in result summaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-strict-comment-summary-'));
  const statePath = join(dir, 'state.json');
  try {
    const contextOnlyDictionary = {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a title',
            },
          ],
        },
      ],
    };
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: ['contextOnly 评论区'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        requireSourceBackedEvidence: true,
        requireCommentBackedEvidence: true,
        prioritizeSourceGaps: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => contextOnlyDictionary,
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.equal(result.coverage.totalEvidence, 0);
    assert.equal(result.coverage.zeroEvidenceTerms, 1);
    assert.equal(result.coverageActions[0].status, 'source_gap');
    assert.equal(result.coverageActions[0].coverageEvidenceCount, 0);
    assert.equal(result.state.runs[0].zeroEvidenceTerms, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary targets exact source-gap priority terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-exact-source-gap-target-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        requireSourceBackedEvidence: true,
        requireCommentBackedEvidence: true,
        prioritizeSourceGaps: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
              family: 'attack',
              evidenceCount: 3,
              evidenceSources: [{ source: 'Bilibili public search-discovered video context', uid: 'BV1', sample: 'Bilibili video context: \u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97' }],
            },
            {
              term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
              family: 'attack',
              evidenceCount: 3,
              evidenceSources: [{ source: 'Bilibili public search-discovered video context', uid: 'BV1', sample: 'Bilibili video context: \u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427' }],
            },
            {
              term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
              family: 'attack',
              evidenceCount: 3,
              evidenceSources: [{ source: 'Bilibili public search-discovered video context', uid: 'BV1', sample: 'Bilibili video context: \u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427' }],
            },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return { ok: true, warnings: [], videos: [{ bvid: 'BV1111111111' }], comments: [], entries: [] };
        },
      },
    );

    assert.deepEqual(new Set(payloads[0].targetExistingTerms), new Set([
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
    ]));
    assert.equal(payloads[0].includeVideoContext, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary runs hard zero-evidence priority queries even when globally searched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-hard-zero-priority-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 2,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: ['车家军'],
        scannedBvids: [],
        termAttempts: {
          [Buffer.from('没有车家军', 'utf8').toString('base64url')]: {
            term: '没有车家军',
            family: 'attack',
            evidenceAtPlanTime: 0,
            lastEvidenceCount: 0,
            attempts: 6,
            successfulAttempts: 0,
            queries: [
              { query: '没有车家军 评论区 梗 热评', strategyVersion: 2 },
              { query: '没有车家军 评论区', strategyVersion: 2 },
              { query: '没有车家军 热评', strategyVersion: 2 },
              { query: '没有车家军 B站 评论区 梗', strategyVersion: 2 },
              { query: '没有车家军 B站 回复 评论区', strategyVersion: 2 },
              { query: '没有车家军 弹幕', strategyVersion: 2 },
            ],
          },
        },
        runs: [],
      }),
      'utf8',
    );

    const searched = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: ['车家军'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: '没有车家军', family: 'attack', evidenceCount: 0 }] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload.searchQueries[0]);
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

    assert.deepEqual(searched, ['车家军']);
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
