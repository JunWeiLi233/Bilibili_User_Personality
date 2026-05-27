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
    '典中典 套路 评论区 热评',
    '典中典起手 评论区 热评',
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

test('buildKeywordHarvestQueries uses high-signal comment queries for noisy weak terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u9ed1\u5316\u53cc\u9c7c', family: 'attack', evidenceCount: 2 },
        { term: '\u5f88\u84dd\u7684\u62c9', family: 'cooperation', evidenceCount: 2 },
        { term: '\u753b\u997c', family: 'attack', evidenceCount: 2 },
        { term: '\u8bb0\u9519\u4e86', family: 'correction', evidenceCount: 2 },
        { term: '\u8282\u594f\u72d7', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 5,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u9ed1\u5316\u53cc\u9c7c \u70ed\u8bc4',
    '\u5f88\u84dd\u7684\u5566 \u70ed\u8bc4',
    '\u753b\u997c \u70ed\u8bc4',
    '\u8bb0\u9519\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a',
    '\u8282\u594f\u72d7 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next coverage actions', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6840\u6840\u6840', family: 'attack', evidenceCount: 2 },
        { term: '\u7d27\u548c', family: 'attack', evidenceCount: 2 },
        { term: '\u8b66\u60d5\u901f\u80dc\u8bba', family: 'attack', evidenceCount: 2 },
        { term: '\u65e7\u65f6\u4ee3\u7684\u4ea7\u7269', family: 'attack', evidenceCount: 2 },
        { term: '\u6485\u9192', family: 'attack', evidenceCount: 2 },
        { term: '\u7edd\u5bf9\u5316', family: 'absolutes', evidenceCount: 2 },
        { term: '\u5f00\u9664\u91ce\u6838', family: 'attack', evidenceCount: 2 },
        { term: '\u5f00\u667a\u4e86', family: 'attack', evidenceCount: 2 },
        { term: '\u523b\u8fdbdna', family: 'cooperation', evidenceCount: 2 },
        { term: '\u7a7a\u8033', family: 'cooperation', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 10,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6840\u6840\u6840 \u70ed\u8bc4',
    '\u7d27\u548c \u70ed\u8bc4',
    '\u8b66\u60d5\u901f\u80dc\u8bba \u70ed\u8bc4',
    '\u65e7\u65f6\u4ee3\u7684\u4ea7\u7269 \u70ed\u8bc4',
    '\u6485\u9192\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u522b\u7edd\u5bf9\u5316 \u8bc4\u8bba',
    '\u5f00\u9664\u91ce\u6838 \u70ed\u8bc4',
    '\u5f00\u667a\u4e86 \u70ed\u8bc4',
    '\u523b\u8fdbdna\u7684 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u7a7a\u8033 \u5f39\u5e55',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for follow-up weak actions', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8001\u56db', family: 'attack', evidenceCount: 2 },
        { term: '\u8001\u786c\u5e01', family: 'attack', evidenceCount: 2 },
        { term: '\u8001\u5b50\u53c8\u4e0d\u778e', family: 'attack', evidenceCount: 2 },
        { term: '\u8138\u76ae\u591f\u539a', family: 'attack', evidenceCount: 2 },
        { term: '\u826f\u5fc3\u8fa3', family: 'attack', evidenceCount: 2 },
        { term: '\u4eae\u8840\u6761', family: 'attack', evidenceCount: 2 },
        { term: '\u9f99\u50b2\u5929', family: 'attack', evidenceCount: 2 },
        { term: '\u9885\u5185\u9ad8\u6f6e', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u52d2\u8001\u56db \u70ed\u8bc4',
    '\u8001\u786c\u5e01 \u70ed\u8bc4',
    '\u8001\u5b50\u53c8\u4e0d\u778e \u70ed\u8bc4',
    '\u8138\u76ae\u591f\u539a \u70ed\u8bc4',
    '\u592a\u826f\u5fc3\u8fa3 \u70ed\u8bc4',
    '\u4eae\u8840\u6761\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u9f99\u50b2\u5929\u5267\u672c \u70ed\u8bc4',
    '\u9885\u5185\u9ad8\u6f6e \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for later weak actions', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u9a74\u9a6c', family: 'attack', evidenceCount: 2 },
        { term: '\u5988\u5988\u751f\u7684', family: 'attack', evidenceCount: 2 },
        { term: '\u9a6c\u540e\u70ae', family: 'attack', evidenceCount: 2 },
        { term: '\u9a6c\u524d\u5352', family: 'attack', evidenceCount: 2 },
        { term: '\u739b\u4e3d\u82cf', family: 'attack', evidenceCount: 2 },
        { term: '\u5a9a\u5bcc', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 6,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u9a82\u9a74\u9a6c \u70ed\u8bc4',
    '\u5988\u5988\u751f\u7684 \u70ed\u8bc4',
    '\u7eaf\u7eaf\u9a6c\u540e\u70ae \u70ed\u8bc4',
    '\u9a6c\u524d\u5352 \u70ed\u8bc4',
    '\u739b\u4e3d\u82cf\u53e4\u5076\u5267 \u70ed\u8bc4',
    '\u53c8\u5a9a\u5bcc\u4e86 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7537\u7684\u90fd\u7231\u753b\u997c', family: 'attack', evidenceCount: 2 },
        { term: '\u4e5e\u4e10', family: 'attack', evidenceCount: 2 },
        { term: '\u6c42\u9524\u5f97\u9524', family: 'attack', evidenceCount: 2 },
        { term: '\u5168\u662f\u6c34\u519b', family: 'attack', evidenceCount: 2 },
        { term: '\u5168\u662f\u4e2d\u56fd', family: 'attack', evidenceCount: 2 },
        { term: '\u62f3\u6b96\u4e00\u4f53', family: 'attack', evidenceCount: 2 },
        { term: '\u4e73\u8ffd', family: 'attack', evidenceCount: 2 },
        { term: '\u962e\u962e', family: 'cooperation', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7537\u7684\u90fd\u7231\u753b\u997c \u70ed\u8bc4',
    '\u8fd9\u79cd\u4e5e\u4e10 \u70ed\u8bc4',
    '\u6c42\u9524\u5f97\u9524 \u70ed\u8bc4',
    '\u8bc4\u8bba\u533a\u5168\u662f\u6c34\u519b \u70ed\u8bc4',
    '\u7b54 \u5168\u662f\u4e2d\u56fd \u70ed\u8bc4',
    '\u62f3\u6b96\u4e00\u4f53 \u70ed\u8bc4',
    '\u4e73\u8ffd\u7684\u4eba \u70ed\u8bc4',
    '\u962e\u962e\u8fdd\u7ea6 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next current weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u745e\u601d\u62dc', family: 'cooperation', evidenceCount: 2 },
        { term: '\u8d5b\u5bc4', family: 'attack', evidenceCount: 2 },
        { term: '\u4e09\u8fde\u9001\u4e0a', family: 'cooperation', evidenceCount: 2 },
        { term: '\u4e0a\u5634\u8138', family: 'attack', evidenceCount: 2 },
        { term: '\u795e\u70e6', family: 'attack', evidenceCount: 2 },
        { term: '\u6e7f\u6e7f', family: 'attack', evidenceCount: 2 },
        { term: '\u5c4e\u5c71\u4ee3\u7801', family: 'attack', evidenceCount: 2 },
        { term: '\u6311\u62e8\u79bb\u95f4', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u745e\u601d\u62dc \u70ed\u8bc4',
    '\u8d5b\u5bc4 \u9000\u94b1 \u70ed\u8bc4',
    '\u4e09\u8fde\u9001\u4e0a \u70ed\u8bc4',
    '\u4e0a\u5634\u8138 \u70ed\u8bc4',
    '\u795e\u70e6\u5979 \u70ed\u8bc4',
    '\u5218\u8bd7\u8bd7 \u6e7f\u6e7f \u70ed\u8bc4',
    '\u5c4e\u5c71\u4ee3\u7801 \u70ed\u8bc4',
    '\u6311\u62e8\u79bb\u95f4 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for post-harvest weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6211\u6562\u8bf4', family: 'absolutes', evidenceCount: 2 },
        { term: '\u6211\u6709\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e', family: 'absolutes', evidenceCount: 2 },
        { term: '\u65e0\u5f62\u7684\u5927\u624b', family: 'attack', evidenceCount: 2 },
        { term: '\u7ec6\u8282\u53e5\u53f7', family: 'attack', evidenceCount: 2 },
        { term: '\u663e\u5fae\u955c\u90fd\u4e0d\u4f1a\u7528', family: 'attack', evidenceCount: 2 },
        { term: '\u60f3\u5200\u4eba', family: 'attack', evidenceCount: 2 },
        { term: '\u60f3\u4e00\u51fa\u662f\u4e00\u51fa', family: 'attack', evidenceCount: 2 },
        { term: '\u5c0f\u5b69\u59d0', family: 'cooperation', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6211\u6562\u8bf4 \u70ed\u8bc4',
    '\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e \u70ed\u8bc4',
    '\u65e0\u5f62\u7684\u5927\u624b \u70ed\u8bc4',
    '\u7ec6\u8282\u53e5\u53f7 \u70ed\u8bc4',
    '\u663e\u5fae\u955c\u90fd\u4e0d\u4f1a\u7528 \u70ed\u8bc4',
    '\u60f3\u5200\u4eba\u7684\u773c\u795e\u85cf\u4e0d\u4f4f \u70ed\u8bc4',
    '\u60f3\u4e00\u51fa\u662f\u4e00\u51fa \u70ed\u8bc4',
    '\u5c0f\u5b69\u59d0 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for later post-harvest weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5c0f\u4ed9\u7537', family: 'attack', evidenceCount: 2 },
        { term: '\u7b11\u4e96', family: 'attack', evidenceCount: 2 },
        { term: '\u659c\u773c\u7b11', family: 'attack', evidenceCount: 2 },
        { term: '\u5b66\u65b0\u95fb\u5b66', family: 'attack', evidenceCount: 2 },
        { term: '\u8840\u4e66', family: 'cooperation', evidenceCount: 2 },
        { term: '\u4e25\u7236', family: 'attack', evidenceCount: 2 },
        { term: '\u4e00\u65b9\u901a\u884c', family: 'attack', evidenceCount: 2 },
        { term: '\u4e00\u6761\u9f99', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5c0f\u4ed9\u7537 \u70ed\u8bc4',
    '\u7b11\u4e96 \u70ed\u8bc4',
    '\u659c\u773c\u7b11 \u8868\u60c5 \u70ed\u8bc4',
    '\u5b66\u65b0\u95fb\u5b66 \u70ed\u8bc4',
    '\u4e07\u4eba\u8840\u4e66 \u70ed\u8bc4',
    '\u7535\u5b50\u4e25\u7236 \u70ed\u8bc4',
    '\u5355\u5411\u8f93\u51fa \u4e00\u65b9\u901a\u884c \u70ed\u8bc4',
    '\u7f51\u66b4\u4e00\u6761\u9f99 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for zero-evidence queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '0\u63d0\u5347', family: 'cooperation', evidenceCount: 0 },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', evidenceCount: 0 },
        { term: '12300\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', evidenceCount: 0 },
        { term: '2026\u6253\u5361', family: 'evasion', evidenceCount: 0 },
        { term: '\u57c3\u53ca\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u5200', family: 'attack', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u91ce', family: 'attack', evidenceCount: 0 },
        { term: '\u7231\u548b\u548b\u5730', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '10\u5e74\u8001\u7c89 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '12300\u5de5\u4fe1\u90e8\u6295\u8bc9 \u6d88\u8d39 \u8bc4\u8bba',
    '2026\u6253\u5361 \u6253\u5361 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u57c3\u53ca\u5427 \u8d34\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u5200 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u91ce \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7231\u548b\u548b\u5730 \u6001\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '0\u63d0\u5347 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current post-harvest misses', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e00\u8f6c\u653b\u52bf', family: 'attack', evidenceCount: 2 },
        { term: '\u4f0a\u5229\u4e9a\u6211\u8f6f\u811a\u4e86', family: 'cooperation', evidenceCount: 2 },
        { term: '\u4f18\u5316\u51fa\u53bb', family: 'attack', evidenceCount: 2 },
        { term: '\u6709\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb', family: 'attack', evidenceCount: 2 },
        { term: '\u6709\u4eba\u6025\u4e86', family: 'attack', evidenceCount: 2 },
        { term: '\u5728\u6211\u770b\u6765', family: 'absolutes', evidenceCount: 2 },
        { term: '\u627e\u4e2a\u73ed\u4e0a', family: 'attack', evidenceCount: 2 },
        { term: '\u8fd9\u90fd\u4e0d\u77e5\u9053', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e00\u8f6c\u653b\u52bf \u70ed\u8bc4',
    '\u4f0a\u5229\u4e9a\u6211\u8f6f\u811a\u4e86 \u70ed\u8bc4',
    '\u4f18\u5316\u51fa\u53bb \u70ed\u8bc4',
    '\u6709\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb \u70ed\u8bc4',
    '\u6709\u4eba\u6025\u4e86 \u70ed\u8bc4',
    '\u5728\u6211\u770b\u6765 \u70ed\u8bc4',
    '\u627e\u4e2a\u73ed\u4e0a \u70ed\u8bc4',
    '\u8fd9\u90fd\u4e0d\u77e5\u9053 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next current post-harvest queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u771f\u5c0f\u4e11', family: 'attack', evidenceCount: 2 },
        { term: '\u6b63\u4e49\u5f00\u76d2', family: 'attack', evidenceCount: 2 },
        { term: '\u6307\u8def', family: 'cooperation', evidenceCount: 2 },
        { term: '\u4f17\u6240\u5468\u77e5', family: 'absolutes', evidenceCount: 2 },
        { term: '\u5468\u5904', family: 'attack', evidenceCount: 2 },
        { term: '\u8f6c\u884c', family: 'attack', evidenceCount: 2 },
        { term: '\u5c0a\u91cd\u795d\u798f', family: 'evasion', evidenceCount: 2 },
        { term: '\u505a\u7968', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u771f\u5c0f\u4e11 \u70ed\u8bc4',
    '\u6b63\u4e49\u5f00\u76d2 \u70ed\u8bc4',
    '\u6307\u8def \u70ed\u8bc4',
    '\u4f17\u6240\u5468\u77e5 \u70ed\u8bc4',
    '\u5468\u5904\u9664\u4e09\u5bb3 \u70ed\u8bc4',
    '\u8fd8\u662f\u8f6c\u884c\u5427 \u70ed\u8bc4',
    '\u5c0a\u91cd\u795d\u798f \u70ed\u8bc4',
    '\u6295\u7968\u505a\u7968 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current ASCII misses', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'ex\u4eba', family: 'attack', evidenceCount: 2 },
        { term: 'gai\u5df2\u6025\u54ed', family: 'attack', evidenceCount: 2 },
        { term: 'get\u5230', family: 'cooperation', evidenceCount: 2 },
        { term: 'nocap', family: 'absolutes', evidenceCount: 2 },
        { term: 'tv\u5455\u5410', family: 'attack', evidenceCount: 2 },
        { term: '0\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '100\u6ca1\u95ee\u9898', family: 'absolutes', evidenceCount: 1 },
        { term: '3a\u53d83o', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'ex\u4eba \u70ed\u8bc4',
    'gai\u5df2\u6025\u54ed \u70ed\u8bc4',
    'get\u5230 \u70ed\u8bc4',
    'nocap \u70ed\u8bc4',
    'tv\u5455\u5410 \u8868\u60c5 \u70ed\u8bc4',
    '0\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '100%\u6ca1\u95ee\u9898 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    '3a\u53d83o \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current comment-backed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u626e\u6f14\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u7206\u7834\u4f60', family: 'attack', evidenceCount: 1 },
        { term: '\u88ab\u62e7\u75bc\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u5954\u4e0d\u4f4f', family: 'attack', evidenceCount: 1 },
        { term: '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4', family: 'attack', evidenceCount: 1 },
        { term: '\u95ed\u7740\u773c\u775b\u4ed8\u94b1', family: 'attack', evidenceCount: 1 },
        { term: '\u907f\u91cd\u5c31\u8f7b', family: 'evasion', evidenceCount: 1 },
        { term: '\u51b0\u6cb3\u65f6\u4ee3', family: 'attack', evidenceCount: 1 },
        { term: '\u75c5\u5927\u90ce', family: 'attack', evidenceCount: 1 },
        { term: '\u8865\u836f\u554a', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e0d\u5e26\u8111\u5b50', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u626e\u6f14\u5c0f\u4e11 \u70ed\u8bc4',
    '\u7206\u7834\u4f60 \u70ed\u8bc4',
    '\u88ab\u62e7\u75bc\u4e86 \u70ed\u8bc4',
    '\u5954\u4e0d\u4f4f \u70ed\u8bc4',
    '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4 \u70ed\u8bc4',
    '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u70ed\u8bc4',
    '\u95ed\u7740\u773c\u775b\u4ed8\u94b1 \u70ed\u8bc4',
    '\u907f\u91cd\u5c31\u8f7b \u70ed\u8bc4',
    '\u51b0\u6cb3\u65f6\u4ee3 \u70ed\u8bc4',
    '\u75c5\u5927\u90ce \u70ed\u8bc4',
    '\u8865\u836f\u554a \u70ed\u8bc4',
    '\u4e0d\u5e26\u8111\u5b50 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next comment-backed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u95ed\u7740\u773c\u775b\u4ed8\u94b1', family: 'attack', evidenceCount: 1 },
        { term: '\u907f\u91cd\u5c31\u8f7b', family: 'evasion', evidenceCount: 1 },
        { term: '\u51b0\u6cb3\u65f6\u4ee3', family: 'attack', evidenceCount: 1 },
        { term: '\u75c5\u5927\u90ce', family: 'attack', evidenceCount: 1 },
        { term: '\u8865\u836f\u554a', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e0d\u5e26\u8111\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u5f97\u4e0d\u5c1d', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u548c\u5356\u7684\u73a9', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u5982ravenfiled', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u8bd7\u4eba', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u95ed\u7740\u773c\u775b\u4ed8\u94b1 \u70ed\u8bc4',
    '\u907f\u91cd\u5c31\u8f7b \u70ed\u8bc4',
    '\u51b0\u6cb3\u65f6\u4ee3 \u70ed\u8bc4',
    '\u75c5\u5927\u90ce \u70ed\u8bc4',
    '\u8865\u836f\u554a \u70ed\u8bc4',
    '\u4e0d\u5e26\u8111\u5b50 \u70ed\u8bc4',
    '\u4e0d\u5f97\u4e0d\u5c1d \u70ed\u8bc4',
    '\u4e0d\u548c\u5356\u7684\u73a9 \u70ed\u8bc4',
    '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11 \u70ed\u8bc4',
    '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u70ed\u8bc4',
    '\u4e0d\u5982ravenfiled \u70ed\u8bc4',
    '\u4e0d\u8bd7\u4eba \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for later comment-backed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e0d\u662f\u5f88\u8ba4\u53ef', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e0d\u662f\u4f60\u649e\u7684\u4f60\u4e3a\u5565\u8981\u6276', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u5b8c\u5168\u662f', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e0d\u5b66\u6570\u7406\u5316\u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u4e89\u4e0d\u62a2\u5ab3\u5987\u513f\u5c31\u98de\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0d\u77e5\u9053ai\u5ba1\u6838', family: 'attack', evidenceCount: 1 },
        { term: '\u6b65\u5175', family: 'attack', evidenceCount: 1 },
        { term: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e0d\u662f\u5f88\u8ba4\u53ef \u70ed\u8bc4',
    '\u4e0d\u662f\u4f60\u649e\u7684\u4f60\u4e3a\u5565\u8981\u6276 \u70ed\u8bc4',
    '\u4e0d\u5b8c\u5168\u662f \u70ed\u8bc4',
    '\u4e0d\u5b66\u6570\u7406\u5316\u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd \u70ed\u8bc4',
    '\u4e0d\u4e89\u4e0d\u62a2\u5ab3\u5987\u513f\u5c31\u98de\u4e86 \u70ed\u8bc4',
    '\u4e0d\u77e5\u9053ai\u5ba1\u6838 \u70ed\u8bc4',
    '\u6b65\u5175 \u70ed\u8bc4',
    '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for follow-up comment-backed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u7b56\u5212\u4f60\u6765\u5f53', family: 'attack', evidenceCount: 1 },
        { term: '\u8e6d\u6982\u5ff5', family: 'attack', evidenceCount: 1 },
        { term: '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5dee\u8bc4\u8fde\u5929', family: 'attack', evidenceCount: 1 },
        { term: '\u4ea7\u51fa\u4e0d\u6613', family: 'cooperation', evidenceCount: 1 },
        { term: '\u7a0b\u6577\u884d', family: 'attack', evidenceCount: 1 },
        { term: '\u5403\u4e0d\u5230\u8461\u8404\u8bf4\u8461\u8404\u9178', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86 \u70ed\u8bc4',
    '\u7b56\u5212\u4f60\u6765\u5f53 \u70ed\u8bc4',
    '\u8e6d\u6982\u5ff5 \u70ed\u8bc4',
    '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d \u70ed\u8bc4',
    '\u5dee\u8bc4\u8fde\u5929 \u70ed\u8bc4',
    '\u4ea7\u51fa\u4e0d\u6613 \u70ed\u8bc4',
    '\u7a0b\u6577\u884d \u70ed\u8bc4',
    '\u5403\u4e0d\u5230\u8461\u8404\u8bf4\u8461\u8404\u9178 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for continued comment-backed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5403\u4e8f\u662f\u798f', family: 'attack', evidenceCount: 1 },
        { term: '\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u4e11\u6bd4', family: 'attack', evidenceCount: 1 },
        { term: '\u81ed\u5973\u4e0d\u884c\u81ed\u7537\u53ef\u4ee5', family: 'attack', evidenceCount: 1 },
        { term: '\u7eaf\u594b\u5173', family: 'attack', evidenceCount: 1 },
        { term: '\u7eaf\u504f\u89c1', family: 'attack', evidenceCount: 1 },
        { term: '\u7eaf\u94c1\u8111\u762b', family: 'attack', evidenceCount: 1 },
        { term: '\u7eaf\u5c0f\u4eba', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5403\u4e8f\u662f\u798f \u70ed\u8bc4',
    '\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86 \u70ed\u8bc4',
    '\u4e11\u6bd4 \u70ed\u8bc4',
    '\u81ed\u5973\u4e0d\u884c\u81ed\u7537\u53ef\u4ee5 \u70ed\u8bc4',
    '\u7eaf\u594b\u5173 \u70ed\u8bc4',
    '\u7eaf\u504f\u89c1 \u70ed\u8bc4',
    '\u7eaf\u94c1\u8111\u762b \u70ed\u8bc4',
    '\u7eaf\u5c0f\u4eba \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next continued weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7eaf\u763e\u5927\u7684\u6765\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981', family: 'attack', evidenceCount: 1 },
        { term: '\u4ece\u5c0f\u4e11\u5230\u5927', family: 'attack', evidenceCount: 1 },
        { term: '\u6751\u53e3\u96c6\u5408\u6c34\u6ce5\u81ea\u5e26', family: 'attack', evidenceCount: 1 },
        { term: '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302', family: 'attack', evidenceCount: 1 },
        { term: '\u6253\u4e86\u81ea\u5df1\u7535\u8bdd', family: 'attack', evidenceCount: 1 },
        { term: '\u6253\u6458\u6843\u5b50\u70df\u96fe\u5f39', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u5927\u9634', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7eaf\u763e\u5927\u7684\u6765\u4e86 \u70ed\u8bc4',
    '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981 \u70ed\u8bc4',
    '\u4ece\u5c0f\u4e11\u5230\u5927 \u70ed\u8bc4',
    '\u6751\u53e3\u96c6\u5408\u6c34\u6ce5\u81ea\u5e26 \u70ed\u8bc4',
    '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302 \u70ed\u8bc4',
    '\u6253\u4e86\u81ea\u5df1\u7535\u8bdd \u70ed\u8bc4',
    '\u6253\u6458\u6843\u5b50\u70df\u96fe\u5f39 \u70ed\u8bc4',
    '\u5927\u5927\u9634 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for further continued weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5927\u8dcc\u763e', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u53f7\u6ca1\u4e86', family: 'evasion', evidenceCount: 1 },
        { term: '\u5927\u529b\u91d1\u521a\u6307', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u540d\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u9b54\u6cd5\u5e08', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u610f\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u5927\u610f\u4e86\u6ca1\u6709\u95ea', family: 'attack', evidenceCount: 1 },
        { term: '\u5e26\u6c9f', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5927\u8dcc\u763e \u70ed\u8bc4',
    '\u5927\u53f7\u6ca1\u4e86 \u70ed\u8bc4',
    '\u5927\u529b\u91d1\u521a\u6307 \u70ed\u8bc4',
    '\u5927\u540d\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053 \u70ed\u8bc4',
    '\u5927\u9b54\u6cd5\u5e08 \u70ed\u8bc4',
    '\u5927\u610f\u4e86 \u70ed\u8bc4',
    '\u5927\u610f\u4e86\u6ca1\u6709\u95ea \u70ed\u8bc4',
    '\u5e26\u6c9f \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next further weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5355\u8d706', family: 'attack', evidenceCount: 1 },
        { term: '\u5355\u8d70\u4e00\u4e2a6', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5f39\u6027\u56de\u5e94', family: 'attack', evidenceCount: 1 },
        { term: '\u86cb\u4ed4\u6d3e\u5bf9\u5168\u662f\u5c0f\u5b69\u4f60\u641e\u8fd9\u4e2a', family: 'attack', evidenceCount: 1 },
        { term: '\u5c9b\u4e0a\u5b8c\u5168\u662f\u5e7b\u5883', family: 'absolutes', evidenceCount: 1 },
        { term: '\u767b\u9f3b\u5b50\u4e0a\u8138', family: 'attack', evidenceCount: 1 },
        { term: '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5355\u8d70\u4e00\u4e2a6 \u70ed\u8bc4',
    '\u5355\u8d70\u4e00\u4e2a6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236 \u70ed\u8bc4',
    '\u5f39\u6027\u56de\u5e94 \u70ed\u8bc4',
    '\u86cb\u4ed4\u6d3e\u5bf9\u5168\u662f\u5c0f\u5b69\u4f60\u641e\u8fd9\u4e2a \u70ed\u8bc4',
    '\u5c9b\u4e0a\u5b8c\u5168\u662f\u5e7b\u5883 \u70ed\u8bc4',
    '\u767b\u9f3b\u5b50\u4e0a\u8138 \u70ed\u8bc4',
    '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries avoids concatenated and over-broad meme probes', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5355\u8f66\u53d8\u6469\u6258', family: 'evasion', evidenceCount: 0 },
        { term: '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 4,
      preferShortCommentVariants: true,
    },
  );

  assert.ok(queries.includes('\u640f\u4e00\u640f \u5355\u8f66\u53d8\u6469\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4'));
  assert.ok(queries.includes('\u574f\u4e86\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4'));
  assert.equal(queries.includes('\u5355\u8f66\u53d8\u6469\u6258\u62bd\u5956'), false);
  assert.equal(queries.includes('\u4e00\u904d\u5c31\u770b\u61c2\u4e86'), false);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for following weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7535\u952fpro', family: 'cooperation', evidenceCount: 1 },
        { term: '\u9876\u4f60\u7684\u80ba', family: 'attack', evidenceCount: 1 },
        { term: '\u5b9a\u53eb\u4f60\u597d\u8bc4\u5982\u6f6e', family: 'attack', evidenceCount: 1 },
        { term: '\u4e1c\u6d77\u6bcf\u6b21\u540c\u6846\u7edd\u5bf9\u6709\u7b11\u70b9', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4e1c\u6237\u897f\u751c', family: 'attack', evidenceCount: 1 },
        { term: '\u61c2\u7684\u90fd\u61c2', family: 'evasion', evidenceCount: 1 },
        { term: '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7535\u952fpro max \u70ed\u8bc4',
    '\u9876\u4f60\u7684\u80ba \u70ed\u8bc4',
    '\u5b9a\u53eb\u4f60\u597d\u8bc4\u5982\u6f6e \u70ed\u8bc4',
    '\u590f\u4e1c\u6d77 \u540c\u6846 \u7b11\u70b9 \u70ed\u8bc4',
    '\u4e1c\u6237\u897f\u751c \u70ed\u8bc4',
    '\u61c2\u7684\u90fd\u61c2 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86 \u70ed\u8bc4',
    '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next zero-evidence queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '3pp\u5927\u795e', family: 'cooperation', evidenceCount: 1 },
        { term: '58\u5206\u5148\u751f', family: 'attack', evidenceCount: 1 },
        { term: '7\u79d2\u7126\u8651', family: 'attack', evidenceCount: 1 },
        { term: '985\u5f53\u7136\u4e0d\u662f\u767d\u4e0a\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u963f\u9ed1\u989c', family: 'attack', evidenceCount: 1 },
        { term: '\u7231\u6765\u81ea', family: 'cooperation', evidenceCount: 1 },
        { term: '\u7231\u6765\u81ea\u997a\u5b50', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6697\u95e8\u5b50', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '3pp\u5927\u795e \u70ed\u8bc4',
    '58\u5206\u5148\u751f \u70ed\u8bc4',
    '7\u79d2\u7126\u8651 \u70ed\u8bc4',
    '985\u5f53\u7136\u4e0d\u662f\u767d\u4e0a\u7684 \u70ed\u8bc4',
    '\u963f\u9ed1\u989c \u70ed\u8bc4',
    '\u7231\u6765\u81ea \u70ed\u8bc4',
    '\u7231\u6765\u81ea\u997a\u5b50 \u70ed\u8bc4',
    '\u6697\u95e8\u5b50 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for follow-up zero-evidence queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7231\u548b\u548b\u7684', family: 'evasion', evidenceCount: 0 },
        { term: '\u62d4\u7fa4', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7231\u548b\u548b\u7684 \u6001\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6548\u679c\u62d4\u7fa4 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for later weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5bf9\u51b2\u5947\u624d', family: 'attack', evidenceCount: 1 },
        { term: '\u591a\u5c11\u6709\u70b9\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u6076\u81ed\u6897', family: 'attack', evidenceCount: 1 },
        { term: '\u53d1\u56fe', family: 'evidence', evidenceCount: 1 },
        { term: '\u53d1\u73b0\u5168\u662f\u7f3a', family: 'absolutes', evidenceCount: 1 },
        { term: '\u9632\u6760\u6211\u5148\u8bf4', family: 'cooperation', evidenceCount: 1 },
        { term: '\u653eppt', family: 'attack', evidenceCount: 1 },
        { term: '\u975e\u5e38\u70c2', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5bf9\u51b2\u5947\u624d \u70ed\u8bc4',
    '\u591a\u5c11\u6709\u70b9\u5c0f\u4e11 \u70ed\u8bc4',
    '\u6076\u81ed\u6897 \u70ed\u8bc4',
    '\u53d1\u56fe \u622a\u56fe \u56de\u590d',
    '\u53d1\u73b0\u5168\u662f\u7f3a \u70ed\u8bc4',
    '\u9632\u6760\u6211\u5148\u8bf4 \u70ed\u8bc4',
    '\u653ePPT\u4e00\u6837 \u70ed\u8bc4',
    '\u975e\u5e38\u70c2 \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next later weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u80a5\u7f8e\u5976\u9f99', family: 'attack', evidenceCount: 1 },
        { term: '\u80ba\u7269', family: 'attack', evidenceCount: 1 },
        { term: '\u5206\u8d43\u4e0d\u5747', family: 'attack', evidenceCount: 1 },
        { term: '\u798f\u745e\u63a7', family: 'cooperation', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u80a5\u7f8e\u5976\u9f99 \u70ed\u8bc4',
    '\u592a\u80ba\u7269\u4e86 \u70ed\u8bc4',
    '\u5206\u8d43\u4e0d\u5747 \u70ed\u8bc4',
    'furry\u63a7 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current resumed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8ddf\u98ce\u55b7', family: 'attack', evidenceCount: 1 },
        { term: '\u6897\u767e\u79d1', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6897out\u4e86', family: 'absolutes', evidenceCount: 1 },
        { term: '\u516c\u77e5\u8bdd\u672f', family: 'attack', evidenceCount: 1 },
        { term: '\u5171\u6c89\u6ca6', family: 'cooperation', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 5,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u522b\u8ddf\u98ce\u55b7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6897\u767e\u79d1 \u6c42\u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u6897out\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u516c\u77e5\u8bdd\u672f \u522b\u6d17 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u8d77\u5171\u6c89\u6ca6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next resumed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u72d7\u6258', family: 'attack', evidenceCount: 1 },
        { term: '\u6302\u8def\u706f', family: 'attack', evidenceCount: 1 },
        { term: '\u5173\u6ce8\u529b', family: 'cooperation', evidenceCount: 1 },
        { term: '\u68fa\u6750\u677f\u7ed9\u4f60\u5907\u597d\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u5e7f\u4e1c\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u89c4\u8bad\u987e\u5ba2', family: 'attack', evidenceCount: 1 },
        { term: '\u8be1\u8ba1\u591a\u7aef\u76841', family: 'attack', evidenceCount: 1 },
        { term: '\u9b3c\u56fe\u6253\u7801', family: 'cooperation', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u62bd\u5361\u72d7\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d44\u672c\u5bb6\u6302\u8def\u706f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u8fd9\u5173\u6ce8\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u68fa\u6750\u677f\u7ed9\u4f60\u5907\u597d\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'IP\u5e7f\u4e1c\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5e97\u5bb6\u89c4\u8bad\u987e\u5ba2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8be1\u8ba1\u591a\u7aef\u76841 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9b3c\u56fe\u6253\u7801 \u6c42\u539f\u56fe \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for media and fandom weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u90ed\u8299\u84c9\u540c\u6b3e', family: 'attack', evidenceCount: 1 },
        { term: '\u679c\u8747play', family: 'attack', evidenceCount: 1 },
        { term: '\u6d77\u738b', family: 'attack', evidenceCount: 1 },
        { term: '\u542b\u7b11\u534a\u6b65\u98a0', family: 'attack', evidenceCount: 1 },
        { term: '\u7f55\u89c1ip', family: 'attack', evidenceCount: 1 },
        { term: '\u6c49\u5b50\u8336', family: 'attack', evidenceCount: 1 },
        { term: '\u6beb\u65e0\u540a\u7528', family: 'absolutes', evidenceCount: 1 },
        { term: '\u597d\u5609\u4f19', family: 'attack', evidenceCount: 1 },
        { term: '\u597d\u78d5\u7684\u5f88', family: 'cooperation', evidenceCount: 1 },
        { term: '\u597d\u62fc\u622a\u56fe', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 10,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u90ed\u8299\u84c9\u540c\u6b3e \u6392\u5c71\u5012\u6d77 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u679c\u8747play \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d77\u738b \u517b\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u542b\u7b11\u534a\u6b65\u98a0 \u5510\u4f2f\u864e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f55\u89c1ip \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6c49\u5b50\u8336 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u540a\u7528 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    '\u597d\u5609\u4f19 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u597d\u78d5\u7684\u5f88 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u597d\u62fc\u622a\u56fe \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for advice and attitude weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u597d\u65f6\u4ee3\u6765\u4e34\u529b', family: 'cooperation', evidenceCount: 1 },
        { term: '\u597d\u50cf\u5927\u6982\u53ef\u80fd\u5e94\u8be5\u6216\u8bb8', family: 'cooperation', evidenceCount: 1 },
        { term: '\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c', family: 'attack', evidenceCount: 1 },
        { term: '\u597d\u81ea\u4e3a\u4e4b', family: 'attack', evidenceCount: 1 },
        { term: '\u597d\u81ea\u4e3a\u4e4b\u5427', family: 'attack', evidenceCount: 1 },
        { term: '\u6838\u6b66\u5668\u51fd\u6570\u4e50', family: 'attack', evidenceCount: 1 },
        { term: '\u9ed1\u5386\u53f2\u5236\u9020\u673a', family: 'attack', evidenceCount: 1 },
        { term: '\u9ed1\u9676\u6e0a\u660e', family: 'attack', evidenceCount: 1 },
        { term: '\u5f88\u68d2\u5148\u751f', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5f88\u7239\u5473', family: 'attack', evidenceCount: 1 },
        { term: '\u5f88\u61c2\u561b', family: 'attack', evidenceCount: 1 },
        { term: '\u5f88\u61c2\u561b\u8001\u94c1', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u597d\u65f6\u4ee3\u6765\u4e34\u529b \u70ed\u8bc4',
    '\u597d\u50cf\u5927\u6982\u53ef\u80fd\u5e94\u8be5\u6216\u8bb8 \u70ed\u8bc4',
    '\u597d\u8a00\u96be\u529d\u8be5\u6b7b\u7684\u9b3c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u597d\u81ea\u4e3a\u4e4b\u5427 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u597d\u81ea\u4e3a\u4e4b\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6838\u6b66\u5668\u51fd\u6570\u4e50 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9ed1\u5386\u53f2\u5236\u9020\u673a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9ed1\u9676\u6e0a\u660e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f88\u68d2\u5148\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u53d1\u8a00\u5f88\u7239\u5473 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    '\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for meme attack weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6d3b\u7684\u50cf\u4e2a\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u8bb0\u5fc6\u4fee\u6b63', family: 'attack', evidenceCount: 1 },
        { term: '\u76d1\u72f1\u6765\u7684\u5988\u5988', family: 'attack', evidenceCount: 1 },
        { term: '\u5efa\u5c0f\u7fa4', family: 'attack', evidenceCount: 1 },
        { term: '\u9274\u5b9a\u4e3a\u5c4e', family: 'attack', evidenceCount: 1 },
        { term: '\u952e\u76d8\u8bbe\u8ba1\u5e08', family: 'attack', evidenceCount: 1 },
        { term: '\u5956\u538b\u6291', family: 'attack', evidenceCount: 1 },
        { term: '\u4ea4\u4ee3\u6e05\u695a', family: 'cooperation', evidenceCount: 1 },
        { term: '\u8857\u8fb9\u9ec4\u6bdb', family: 'attack', evidenceCount: 1 },
        { term: '\u8857\u5a03\u513f\u98de\u5347', family: 'attack', evidenceCount: 1 },
        { term: '\u4eca\u5929\u88ab\u6253\u4e86\u6ca1\u6709', family: 'attack', evidenceCount: 1 },
        { term: '\u91d1\u5777\u5783', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6d3b\u5f97\u50cf\u4e2a\u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bb0\u5fc6\u4fee\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76d1\u72f1\u6765\u7684\u5988\u5988 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62c9\u7fa4\u5efa\u5c0f\u7fa4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9274\u5b9a\u4e3a\u5c4e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u952e\u76d8\u8bbe\u8ba1\u5e08 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5956\u538b\u6291 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ea4\u4ee3\u6e05\u695a \u56de\u590d \u70ed\u8bc4',
    '\u8857\u8fb9\u9ec4\u6bdb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8857\u5a03\u513f\u98de\u5347 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eca\u5929\u88ab\u6253\u4e86\u6ca1\u6709 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u91d1\u5777\u5783 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for politics and absolutes weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7cbe\u795e\u7f8e\u56fd\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u7ea0\u6b63\u54e5', family: 'correction', evidenceCount: 1 },
        { term: '\u9152\u5e9f\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u9152\u6cb8\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u4e0d\u591f\u7684', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u53ef\u4ee5\u723d', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u4e70\u7684\u5230', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u6ca1\u6709\u5077\u5403', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7cbe\u795e\u7f8e\u56fd\u4eba \u65f6\u653f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7ea0\u6b63\u54e5 \u56de\u590d \u70ed\u8bc4',
    '\u9152\u5e9f\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9152\u6cb8\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d \u6570\u636e\u53ef\u89c6\u5316 \u8bc4\u8bba',
    '\u7edd\u5bf9\u4e0d\u591f\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c \u6c7d\u8f66 \u8bc4\u8bba',
    '\u7edd\u5bf9\u53ef\u4ee5\u723d \u6e38\u620f \u8bc4\u8bba\u533a',
    '\u7edd\u5bf9\u4e70\u7684\u5230 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u6ca1\u6709\u5077\u5403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898 \u6d88\u8d39 \u8bc4\u8bba',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for fresh zero-evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7edd\u5bf9\u5e05\u54e5', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u4e5f\u662f', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u6709\u95ee\u9898\u7684', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u5bf9\u4e3b\u7ebf', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7edd\u6d3b\u5f3a\u5ea6', family: 'attack', evidenceCount: 1 },
        { term: '\u5f00\u9664\u51e1\u51e1', family: 'attack', evidenceCount: 1 },
        { term: '\u5f00\u56fd\u7684\u65f6\u5019', family: 'attack', evidenceCount: 1 },
        { term: '\u5f00\u723d\u54af', family: 'attack', evidenceCount: 1 },
        { term: '\u770b\u8fc7\u53bb\u5168\u662f\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u770b\u6ee1\u79bb', family: 'attack', evidenceCount: 1 },
        { term: '\u770b\u95e8\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u770b\u4e0b\u7075\u6839', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7edd\u5bf9\u5e05\u54e5 \u989c\u503c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u4e5f\u662f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u6709\u95ee\u9898\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7edd\u5bf9\u4e3b\u7ebf \u6e38\u620f \u5267\u60c5 \u8bc4\u8bba',
    '\u7edd\u6d3b\u5f3a\u5ea6 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f00\u9664\u51e1\u51e1 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f00\u56fd\u7684\u65f6\u5019 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f00\u723d\u54af \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u770b\u8fc7\u53bb\u5168\u662f\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684 \u65f6\u653f \u8bc4\u8bba\u533a',
    '\u770b\u6ee1\u79bb \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u770b\u95e8\u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u770b\u4e0b\u7075\u6839 \u4fee\u4ed9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for assertion and conspiracy weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8003\u5f97\u50cf\u53f2', family: 'attack', evidenceCount: 1 },
        { term: '\u55d1\u836f\u63a8\u5e7f\u5e7f\u544a', family: 'attack', evidenceCount: 1 },
        { term: '\u53ef\u4e0d\u662f\u5c31\u6025\u4e86\u561b', family: 'attack', evidenceCount: 1 },
        { term: '\u53ef\u80fd\u5012\u95ed\u4f46\u7edd\u4e0d\u53ef\u80fd\u53d8\u8d28', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u780d\u4e86', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u662f\u53ef\u4ee5\u7684', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u662f\u82e6\u8089\u8ba1', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u662f\u4eba\u7684\u9519', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u662f\u60f3\u91d1\u8749\u8131\u58f3', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80af\u5b9a\u662f\u60f3\u754f\u7f6a\u81ea\u6740', family: 'absolutes', evidenceCount: 1 },
        { term: '\u6050\u6016\u7ae5\u8c23\u7edd\u5bf9\u7b2c\u4e00', family: 'absolutes', evidenceCount: 1 },
        { term: '\u63a7\u80c3\u4e4b\u795e', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8003\u5f97\u50cf\u53f2 \u8003\u8bd5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u55d1\u836f\u63a8\u5e7f\u5e7f\u544a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53ef\u4e0d\u662f\u5c31\u6025\u4e86\u561b \u56de\u590d \u70ed\u8bc4',
    '\u53ef\u80fd\u5012\u95ed\u4f46\u7edd\u4e0d\u53ef\u80fd\u53d8\u8d28 \u54c1\u724c \u8bc4\u8bba',
    '\u80af\u5b9a\u780d\u4e86 \u6e38\u620f \u6539\u52a8 \u8bc4\u8bba',
    '\u80af\u5b9a\u662f\u53ef\u4ee5\u7684 \u56de\u590d \u70ed\u8bc4',
    '\u80af\u5b9a\u662f\u82e6\u8089\u8ba1 \u65f6\u653f \u8bc4\u8bba\u533a',
    '\u80af\u5b9a\u662f\u4eba\u7684\u9519 \u6e38\u620f \u8bc4\u8bba\u533a',
    '\u80af\u5b9a\u662f\u60f3\u91d1\u8749\u8131\u58f3 \u65f6\u653f \u8bc4\u8bba',
    '\u80af\u5b9a\u662f\u60f3\u754f\u7f6a\u81ea\u6740 \u65f6\u653f \u8bc4\u8bba',
    '\u6050\u6016\u7ae5\u8c23\u7edd\u5bf9\u7b2c\u4e00 \u660e\u661f\u5927\u4fa6\u63a2 \u8bc4\u8bba',
    '\u63a7\u80c3\u4e4b\u795e \u996e\u98df \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for slang and gaming weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u80ef\u7fa4\u6267\u6cd5', family: 'attack', evidenceCount: 1 },
        { term: '\u8de8\u670d\u6267\u6cd5', family: 'attack', evidenceCount: 1 },
        { term: '\u5feb\u4e50\u4e00\u8d5b\u5b63\u96be\u8fc7\u603b\u51b3\u8d5b', family: 'attack', evidenceCount: 1 },
        { term: '\u5feb\u901f\u5e73\u6574', family: 'attack', evidenceCount: 1 },
        { term: '\u5764\u5df4', family: 'attack', evidenceCount: 1 },
        { term: '\u62c9\u5c0f\u7fa4', family: 'attack', evidenceCount: 1 },
        { term: '\u62c9\u6905\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u62c9jb\u5012', family: 'attack', evidenceCount: 1 },
        { term: '\u84dd\u516c\u4e3b', family: 'attack', evidenceCount: 1 },
        { term: '\u84dd\u7626\u9999\u83c7', family: 'attack', evidenceCount: 1 },
        { term: '\u70c2\u6897\u738b', family: 'attack', evidenceCount: 1 },
        { term: '\u635e\u7684\u4e00\u6279', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8de8\u7fa4\u6267\u6cd5 \u7fa4\u804a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8de8\u670d\u6267\u6cd5 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5feb\u4e50\u4e00\u8d5b\u5b63\u96be\u8fc7\u603b\u51b3\u8d5b \u4f53\u80b2 \u8bc4\u8bba',
    '\u5feb\u901f\u5e73\u6574 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5764\u5df4 \u8521\u5f90\u5764 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62c9\u5c0f\u7fa4 \u7fa4\u804a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62c9\u6905\u5b50 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62c9jb\u5012 \u56de\u590d \u70ed\u8bc4',
    '\u84dd\u516c\u4e3b \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u84dd\u7626\u9999\u83c7 \u8001\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u70c2\u6897\u738b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u635e\u7684\u4e00\u6279 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for lao nickname and edge-slang weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7262\u7334', family: 'attack', evidenceCount: 1 },
        { term: '\u7262\u5c06', family: 'attack', evidenceCount: 1 },
        { term: '\u7262\u4f1f', family: 'attack', evidenceCount: 1 },
        { term: '\u7262\u7956\u51b2\u4e4b', family: 'attack', evidenceCount: 1 },
        { term: '\u8001\u868c\u542b\u73e0', family: 'attack', evidenceCount: 1 },
        { term: '\u8001\u5904\u7537', family: 'attack', evidenceCount: 1 },
        { term: '\u8001\u9ad8\u9ad8\u9b54\u52a8\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u8001\u5e08\u56fe\u7247\u53ef\u4ee5\u62ff\u5417', family: 'cooperation', evidenceCount: 1 },
        { term: '\u8001\u5934\u662f\u8fd9\u6837\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u8001ass', family: 'attack', evidenceCount: 1 },
        { term: '\u8001sp', family: 'attack', evidenceCount: 1 },
        { term: '\u51b7\u677f\u51f3', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7262\u7334 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7262\u5c06 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7262\u4f1f \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7262\u7956\u51b2\u4e4b \u6570\u5b66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001\u868c\u542b\u73e0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001\u5904\u7537 \u604b\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001\u9ad8\u9ad8\u9b54\u52a8\u7684 \u8001\u9ad8\u4e0e\u5c0f\u8309 \u8bc4\u8bba',
    '\u8001\u5e08\u56fe\u7247\u53ef\u4ee5\u62ff\u5417 \u6c42\u56fe \u8bc4\u8bba\u533a',
    '\u8001\u5934\u662f\u8fd9\u6837\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001ass \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001sp \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5750\u51b7\u677f\u51f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for product and couple-slang weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u674e\u59d0\u4e07\u5c81', family: 'attack', evidenceCount: 1 },
        { term: '\u674e\u6c0f\u7236\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u91cc\u9762\u5168\u662f\u9502\u7535\u6c60', family: 'attack', evidenceCount: 1 },
        { term: '\u5386\u53f2\u7b2c\u4e00\u63a7\u80c3', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4fe9\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86\u5c5e\u4e8e\u662f', family: 'attack', evidenceCount: 1 },
        { term: '\u8054\u52a8\u676f', family: 'attack', evidenceCount: 1 },
        { term: '\u604b\u4e11\u7656', family: 'attack', evidenceCount: 1 },
        { term: '\u826f\u4f5c\u65e0\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u4e24\u516c\u6bcd', family: 'attack', evidenceCount: 1 },
        { term: '\u4e24\u60c5\u76f8\u60a6', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e24\u5143\u5e97', family: 'attack', evidenceCount: 1 },
        { term: '\u91cf\u5b50\u76d1\u63a7\u6444\u50cf\u5934', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u674e\u59d0\u4e07\u5c81 \u56de\u590d \u70ed\u8bc4',
    '\u674e\u6c0f\u7236\u5b50 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u91cc\u9762\u5168\u662f\u9502\u7535\u6c60 \u7535\u52a8\u8f66 \u8bc4\u8bba',
    '\u5386\u53f2\u7b2c\u4e00\u63a7\u80c3 \u996e\u98df \u8bc4\u8bba\u533a',
    '\u4fe9\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86\u5c5e\u4e8e\u662f \u4ea4\u901a \u8bc4\u8bba',
    '\u8054\u52a8\u676f \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u604b\u4e11\u7656 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u826f\u4f5c\u65e0\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e24\u516c\u6bcd \u60c5\u4fa3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e24\u60c5\u76f8\u60a6 \u56de\u590d \u70ed\u8bc4',
    '\u4e24\u5143\u5e97 \u5ec9\u4ef7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u91cf\u5b50\u76d1\u63a7\u6444\u50cf\u5934 \u8bc4\u8bba\u533a \u70ed\u8bc4',
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

test('buildKeywordHarvestQueries uses high-signal comment queries for fan turn and sci-fi weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u96f6\u63d0\u5347', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6d41\u6c13\u53ea\u662f\u6d17\u767d\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u516d\u6247\u95e8', family: 'attack', evidenceCount: 1 },
        { term: '\u905b\u9e1f\u54e5', family: 'attack', evidenceCount: 1 },
        { term: '\u9f99\u764c', family: 'attack', evidenceCount: 1 },
        { term: '\u8def\u4eba\u76d8', family: 'attack', evidenceCount: 1 },
        { term: '\u8def\u8f6c\u9ed1', family: 'attack', evidenceCount: 1 },
        { term: '\u9a74\u5e08', family: 'attack', evidenceCount: 1 },
        { term: '\u7eff\u6f14', family: 'attack', evidenceCount: 1 },
        { term: '\u8f6e\u6905\u8f74', family: 'attack', evidenceCount: 1 },
        { term: '\u7f57\u8f91\u515c\u5e95', family: 'attack', evidenceCount: 1 },
        { term: '\u7f57\u795e\u4f1f\u5927', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u96f6\u63d0\u5347 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d41\u6c13\u53ea\u662f\u6d17\u767d\u4e86 \u5267\u60c5 \u8bc4\u8bba',
    '\u516d\u6247\u95e8 \u6b66\u4fa0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u905b\u9e1f\u54e5 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9f99\u764c \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8def\u4eba\u76d8 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8def\u8f6c\u9ed1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a74\u5e08 \u5f8b\u5e08 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7eff\u6f14 \u6f14\u5531\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8f6e\u6905\u8f74 \u952e\u76d8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f57\u8f91\u515c\u5e95 \u4e09\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f57\u795e\u4f1f\u5927 \u4e09\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for logic and culture weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u903b\u8f91\u9b3c\u624d', family: 'attack', evidenceCount: 1 },
        { term: '\u9ebble\u4f6c', family: 'attack', evidenceCount: 1 },
        { term: '\u9a82\u4eba\u4ed9\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u8fc8\u5361\u8d70\u4e86\u4e4b\u540e', family: 'attack', evidenceCount: 1 },
        { term: '\u5356\u7968', family: 'evidence', evidenceCount: 1 },
        { term: '\u5e3d\u5b50\u53d4', family: 'attack', evidenceCount: 1 },
        { term: '\u5e3d\u5b50\u53d4\u53d4', family: 'attack', evidenceCount: 1 },
        { term: '\u6ca1\u4eba\u5417', family: 'evasion', evidenceCount: 1 },
        { term: '\u6ca1\u4e00\u70b9\u5e38\u8bc6', family: 'attack', evidenceCount: 1 },
        { term: '\u6ca1\u6709\u6587\u5316', family: 'attack', evidenceCount: 1 },
        { term: '\u6ca1\u6709\u4e00\u4e2a\u9732\u8138', family: 'attack', evidenceCount: 1 },
        { term: '\u6ca1\u6709\u4e00\u4e2a\u4eba\u771f\u6b63\u73a9\u5230\u4e86', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u903b\u8f91\u9b3c\u624d \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9ebble\u4f6c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a82\u4eba\u4ed9\u4eba \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fc8\u5361\u8d70\u4e86\u4e4b\u540e \u8352\u91ce\u5927\u9556\u5ba2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5356\u7968 \u6f14\u5531\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5e3d\u5b50\u53d4 \u8b66\u5bdf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5e3d\u5b50\u53d4\u53d4 \u8b66\u5bdf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u4eba\u5417 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u4e00\u70b9\u5e38\u8bc6 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u6709\u6587\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u6709\u4e00\u4e2a\u9732\u8138 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u6709\u4e00\u4e2a\u4eba\u771f\u6b63\u73a9\u5230\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for fandom and politics weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6ca1\u6709\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b', family: 'absolutes', evidenceCount: 1 },
        { term: '\u6ca1\u6709\u4e00\u4e2aup\u6562\u8bb2', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7164\u6c14\u6cc4\u9732', family: 'attack', evidenceCount: 1 },
        { term: '\u7f8e\u6b66\u5e1d', family: 'attack', evidenceCount: 1 },
        { term: '\u7f8e\u54c9', family: 'attack', evidenceCount: 1 },
        { term: '\u68a6\u91cc\u4ec0\u4e48\u90fd\u6709', family: 'evasion', evidenceCount: 1 },
        { term: '\u68a6\u7537', family: 'attack', evidenceCount: 1 },
        { term: '\u5999\u554a', family: 'cooperation', evidenceCount: 1 },
        { term: '\u660e\u660e\u5c31\u6709', family: 'correction', evidenceCount: 1 },
        { term: '\u6a21\u7ec4', family: 'evidence', evidenceCount: 1 },
        { term: '\u9b54\u6014\u7c89\u4e1d', family: 'attack', evidenceCount: 1 },
        { term: '\u9ed8\u5951\u5927\u8d5b', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6ca1\u6709\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u6709\u4e00\u4e2aup\u6562\u8bb2 \u4e89\u8bae \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7164\u6c14\u6cc4\u9732 \u5b89\u5168\u4e8b\u6545 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f8e\u6b66\u5e1d \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f8e\u54c9 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u68a6\u91cc\u4ec0\u4e48\u90fd\u6709 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u68a6\u7537 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5999\u554a \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u660e\u660e\u5c31\u6709 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6a21\u7ec4 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9b54\u6014\u7c89\u4e1d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9ed8\u5951\u5927\u8d5b \u7efc\u827a \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for entertainment and gender weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047', family: 'attack', evidenceCount: 1 },
        { term: '\u54ea\u6839\u8471', family: 'attack', evidenceCount: 1 },
        { term: '\u7537\u76d7\u5973\u5a3c', family: 'attack', evidenceCount: 1 },
        { term: '\u7537\u51dd\u5ba1\u7f8e', family: 'attack', evidenceCount: 1 },
        { term: '\u5357\u6850', family: 'attack', evidenceCount: 1 },
        { term: '\u6320\u644a', family: 'attack', evidenceCount: 1 },
        { term: '\u5185\u5a31\u7684\u5e95\u7ebf', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5185\u5a31\u53ea\u6709\u8fea\u4e3d\u70ed\u5df4', family: 'absolutes', evidenceCount: 1 },
        { term: '\u80fd\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u4e0d\u5bf9\u52b2', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u731c\u6211\u4e3a\u4ec0\u4e48\u4e0d\u7b11', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u8d85\u7231', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047 \u5185\u5a31 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u54ea\u6839\u8471 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7537\u76d7\u5973\u5a3c \u5a31\u4e50\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7537\u51dd\u5ba1\u7f8e \u6027\u522b\u8bae\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5357\u6850 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6320\u644a \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5185\u5a31\u7684\u5e95\u7ebf \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5185\u5a31\u53ea\u6709\u8fea\u4e3d\u70ed\u5df4 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u80fd\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u4e0d\u5bf9\u52b2 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u731c\u6211\u4e3a\u4ec0\u4e48\u4e0d\u7b11 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u8d85\u7231 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for reply and counterwind weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4f60\u7684\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4f60\u597d\u6025', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u597d\u6025\u554a', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u51e0\u5e74\u7ea7', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u8bf4\u7684\u6709\u9053\u7406', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4f60\u7279me', family: 'attack', evidenceCount: 1 },
        { term: '\u4f60\u7ec6\u54c1', family: 'evasion', evidenceCount: 1 },
        { term: '\u4f60\u6709\u836f\u554a', family: 'attack', evidenceCount: 1 },
        { term: '\u9006\u98ce\u5c40', family: 'attack', evidenceCount: 1 },
        { term: '\u9006\u98ce\u8f93\u51fa', family: 'attack', evidenceCount: 1 },
        { term: '\u9006\u5929\u5c0f\u9ed1\u5b50', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4f60\u7684\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u597d\u6025 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u597d\u6025\u554a \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u51e0\u5e74\u7ea7 \u5c0f\u5b66\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u8bf4\u7684\u6709\u9053\u7406 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u7279me \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u7ec6\u54c1 \u61c2\u7684\u90fd\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u6709\u836f\u554a \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9006\u98ce\u5c40 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9006\u98ce\u8f93\u51fa \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9006\u5929\u5c0f\u9ed1\u5b50 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for event and bait weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5a18\u897f\u76ae', family: 'attack', evidenceCount: 1 },
        { term: '\u6d85\u69c3\u6253\u91ce', family: 'attack', evidenceCount: 1 },
        { term: '\u60a8\u914d\u5417', family: 'attack', evidenceCount: 1 },
        { term: '\u519c\u6797\u535a\u4e3b', family: 'attack', evidenceCount: 1 },
        { term: '\u6d53\u7709\u5927\u773c\u7684\u4e5f\u53db\u53d8\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u6012\u4e86\u4e00\u4e0b', family: 'attack', evidenceCount: 1 },
        { term: '\u6b27\u9752\u54c8\u62c9\u5c11', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6392\u6c14\u53e3\u5439\u51fa\u6765\u5168\u662f\u81ed\u6c14', family: 'attack', evidenceCount: 1 },
        { term: '\u5224\u51b3\u4e66', family: 'evidence', evidenceCount: 1 },
        { term: '\u80d6\u732b', family: 'attack', evidenceCount: 1 },
        { term: '\u55b7\u6c14\u80cc\u5305\u6545\u969c', family: 'attack', evidenceCount: 1 },
        { term: '\u9a97\u4eba\u8fdb\u6765', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5a18\u897f\u76ae \u65b9\u8a00 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d85\u69c3\u6253\u91ce \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u60a8\u914d\u5417 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u519c\u6797\u535a\u4e3b \u4e09\u519c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d53\u7709\u5927\u773c\u7684\u4e5f\u53db\u53d8\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6012\u4e86\u4e00\u4e0b \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b27\u9752\u54c8\u62c9\u5c11 \u4fc4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6392\u6c14\u53e3\u5439\u51fa\u6765\u5168\u662f\u81ed\u6c14 \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5224\u51b3\u4e66 \u6cd5\u5f8b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u80d6\u732b \u793e\u4f1a\u4e8b\u4ef6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u55b7\u6c14\u80cc\u5305\u6545\u969c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a97\u4eba\u8fdb\u6765 \u6807\u9898\u515a \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for comment and character weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8d2b\u7a77\u62ef\u6551\u4e86\u4ed6', family: 'attack', evidenceCount: 1 },
        { term: '\u5e73\u6574\u5668', family: 'attack', evidenceCount: 1 },
        { term: '\u8bc4\u8bba\u533a\u4e0d\u6562\u60f3', family: 'attack', evidenceCount: 1 },
        { term: '\u8bc4\u8bba\u533a\u6218\u795e', family: 'attack', evidenceCount: 1 },
        { term: '\u8bc4\u8bba\u738b\u5427', family: 'attack', evidenceCount: 1 },
        { term: '\u6d66\u50cf\u5973', family: 'attack', evidenceCount: 1 },
        { term: '\u5343\u5e74\u662f\u54ee\u5929\u72ac', family: 'attack', evidenceCount: 1 },
        { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', evidenceCount: 1 },
        { term: '\u4e7e\u9686\u8001\u513f', family: 'attack', evidenceCount: 1 },
        { term: '\u743c\u5965\u65af\u5361\u5956', family: 'attack', evidenceCount: 1 },
        { term: '\u90b1\u83b9\u83b9plus\u7248', family: 'attack', evidenceCount: 1 },
        { term: '\u5708\u5b50\u8d8a\u5927\u795e\u4eba\u8d8a\u591a', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8d2b\u7a77\u62ef\u6551\u4e86\u4ed6 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5e73\u6574\u5668 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bc4\u8bba\u533a\u4e0d\u6562\u60f3 \u56de\u590d \u70ed\u8bc4',
    '\u8bc4\u8bba\u533a\u6218\u795e \u56de\u590d \u70ed\u8bc4',
    '\u8bc4\u8bba\u738b\u5427 \u8d34\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d66\u50cf\u5973 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5343\u5e74\u662f\u54ee\u5929\u72ac \u4e8c\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u524d\u9762\u8bf4\u91cd\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e7e\u9686\u8001\u513f \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u743c\u5965\u65af\u5361\u5956 \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u90b1\u83b9\u83b9plus\u7248 \u6b22\u4e50\u9882 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5708\u5b50\u8d8a\u5927\u795e\u4eba\u8d8a\u591a \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for absolute and fandom weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5168\u90fd\u8fd8\u5728', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u90fd\u662f\u5708\u94b1\u518d\u5708\u94b1', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u607c', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u642c\u8fd0', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u8fd4\u4fee\u8d27\u548c\u5e93\u5b58', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u7c89\u4e1d', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u5047\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u5938\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u4eba\u60c5\u4e16\u6545', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u4e09\u89d2\u65a9', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u6570\u636e\u8bbe\u5b9a\u5bf9\u6bd4', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u662f\u6211\u4eec\u9a6c\u54e5', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5168\u90fd\u8fd8\u5728 \u8001\u7c89 \u56de\u5fc6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u90fd\u662f\u5708\u94b1\u518d\u5708\u94b1 \u5546\u4e1a\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u607c \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u642c\u8fd0 \u539f\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u8fd4\u4fee\u8d27\u548c\u5e93\u5b58 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u7c89\u4e1d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u5047\u7684 \u8f9f\u8c23 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u5938\u7684 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u4eba\u60c5\u4e16\u6545 \u804c\u573a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u4e09\u89d2\u65a9 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u6570\u636e\u8bbe\u5b9a\u5bf9\u6bd4 \u6218\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u6211\u4eec\u9a6c\u54e5 \u9a6c\u4fdd\u56fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next absolute and reply weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5168\u662f\u65b0\u53f7', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u662f\u946b\u4ed8', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u662f\u7384\u5b66', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u662f\u5e94\u8bd5', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u662f\u5e7c\u6001\u5ba1\u7f8e', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u635f\u97f3\u54c1\u8d28', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u7cfb\u5217\u901a\u75c5', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u4ed9\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u5168\u5458be', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5168\u4e2d\u56fd\u4eba\u90fd\u65e0\u6cd5\u53cd\u9a73', family: 'absolutes', evidenceCount: 1 },
        { term: '\u786e\u5b9e\u5982\u6b64', family: 'correction', evidenceCount: 1 },
        { term: '\u8ba9\u4e09\u8ffd\u56db', family: 'cooperation', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5168\u662f\u65b0\u53f7 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u946b\u4ed8 \u652f\u4ed8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u7384\u5b66 \u6d4b\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u5e94\u8bd5 \u6559\u80b2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u5e7c\u6001\u5ba1\u7f8e \u5ba1\u7f8e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u635f\u97f3\u54c1\u8d28 \u97f3\u8d28 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u7cfb\u5217\u901a\u75c5 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u4ed9\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u5458be \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u4e2d\u56fd\u4eba\u90fd\u65e0\u6cd5\u53cd\u9a73 \u6c11\u65cf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u786e\u5b9e\u5982\u6b64 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8ba9\u4e09\u8ffd\u56db \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for people and slang weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4eba\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c', family: 'attack', evidenceCount: 1 },
        { term: '\u4eba\u592b\u611f', family: 'attack', evidenceCount: 1 },
        { term: '\u4eba\u5747\u8fc8\u5df4\u8d6b', family: 'attack', evidenceCount: 1 },
        { term: '\u4eba\u8089tas', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11', family: 'attack', evidenceCount: 1 },
        { term: '\u8ba4\u77e5\u7684\u53c2\u5dee', family: 'attack', evidenceCount: 1 },
        { term: '\u65e5\u672c\u7701', family: 'attack', evidenceCount: 1 },
        { term: '\u65e5\u884c\u4e00\u9274', family: 'attack', evidenceCount: 1 },
        { term: '\u8089\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u5982\u98df\u5219\u5410', family: 'attack', evidenceCount: 1 },
        { term: '\u5982\u53f2\u6076\u7269', family: 'attack', evidenceCount: 1 },
        { term: '\u4e73\u5f02\u73af', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4eba\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c \u9053\u5fb7\u6279\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eba\u592b\u611f \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eba\u5747\u8fc8\u5df4\u8d6b \u70ab\u5bcc \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eba\u8089tas \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8ba4\u77e5\u7684\u53c2\u5dee \u8ba4\u77e5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e5\u672c\u7701 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e5\u884c\u4e00\u9274 \u9274\u8d4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8089\u5c0f\u4e11 \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5982\u98df\u5219\u5410 \u70c2\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5982\u53f2\u6076\u7269 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e73\u5f02\u73af \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for sports and creator weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8f6f\u811a\u8bd7\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u585e\u6bd2', family: 'attack', evidenceCount: 1 },
        { term: '\u8d5b\u535agirls', family: 'attack', evidenceCount: 1 },
        { term: '\u8d5b\u8ba1', family: 'attack', evidenceCount: 1 },
        { term: '\u8d5b\u5b63\u86cb', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e09\u89c2\u8b66\u5bdf', family: 'attack', evidenceCount: 1 },
        { term: '\u4e09\u548c\u5927\u795e', family: 'attack', evidenceCount: 1 },
        { term: '\u4e09\u8054', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e09\u5e74\u5c31\u8d70\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u9a9a\u64cd', family: 'attack', evidenceCount: 1 },
        { term: '\u9a9a\u64cd\u4f5c', family: 'attack', evidenceCount: 1 },
        { term: '\u626b\u96f7\u9886\u57df\u5927\u795e', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8f6f\u811a\u8bd7\u4eba \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u585e\u6bd2 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5b\u535agirls \u8d5b\u535a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5b\u8ba1 \u8d5b\u4e8b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5b\u5b63\u86cb \u8d5b\u5b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e09\u89c2\u8b66\u5bdf \u4ef7\u503c\u89c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e09\u548c\u5927\u795e \u793e\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e09\u8054 \u70b9\u8d5e\u6295\u5e01\u6536\u85cf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e09\u5e74\u5c31\u8d70\u4e86 \u52b3\u52a8\u6cd5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a9a\u64cd \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a9a\u64cd\u4f5c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u626b\u96f7\u9886\u57df\u5927\u795e \u626b\u96f7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for accusation and evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5239\u8f66\u70eb\u811a', family: 'attack', evidenceCount: 1 },
        { term: '\u5565\u7bee\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u5c71\u5730\u4f6c', family: 'attack', evidenceCount: 1 },
        { term: '\u5220\u4e86\u8ba9\u6211\u53d1', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0a\u5927\u53f7\u8bf4\u8bdd', family: 'attack', evidenceCount: 1 },
        { term: '\u5c04\u5fc5\u7a00', family: 'attack', evidenceCount: 1 },
        { term: '\u8c01tm\u53d1\u4f60\u5de5\u8d44', family: 'attack', evidenceCount: 1 },
        { term: '\u8eab\u8fb9\u5168\u662f\u6367\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u795e\u91d1\u8282\u594f', family: 'attack', evidenceCount: 1 },
        { term: '\u795e\u79d8\u7684\u5927\u624b', family: 'attack', evidenceCount: 1 },
        { term: '\u795e\u4ed9\u4e0b\u51e1', family: 'absolutes', evidenceCount: 1 },
        { term: '\u77f3\u9524', family: 'evidence', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5239\u8f66\u70eb\u811a \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5565\u7bee\u5b50 \u4e1c\u5317\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c71\u5730\u4f6c \u9a91\u884c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5220\u4e86\u8ba9\u6211\u53d1 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0a\u5927\u53f7\u8bf4\u8bdd \u5c0f\u53f7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c04\u5fc5\u7a00 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8c01tm\u53d1\u4f60\u5de5\u8d44 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8eab\u8fb9\u5168\u662f\u6367\u7684 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u795e\u91d1\u8282\u594f \u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u795e\u79d8\u7684\u5927\u624b \u8d44\u672c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u795e\u4ed9\u4e0b\u51e1 \u5938\u5f20 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u77f3\u9524 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for Cantonese and education weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8bc6\u6761\u649a', family: 'attack', evidenceCount: 1 },
        { term: '\u8bc6\u6761\u94c1', family: 'attack', evidenceCount: 1 },
        { term: '\u8bc6\u6761\u94c1\u54a9', family: 'attack', evidenceCount: 1 },
        { term: '\u4e8b\u540e\u8865\u62cd\u7279\u5199', family: 'attack', evidenceCount: 1 },
        { term: '\u662f\u4eba\u662f\u9b3c\u90fd\u5728\u79c0', family: 'attack', evidenceCount: 1 },
        { term: '\u624b\u956f', family: 'attack', evidenceCount: 1 },
        { term: '\u53d7\u6559\u4e86', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e66\u65e0\u7838', family: 'attack', evidenceCount: 1 },
        { term: '\u4e66\u65e0\u7838\u61c2', family: 'attack', evidenceCount: 1 },
        { term: '\u8700\u9ecd', family: 'attack', evidenceCount: 1 },
        { term: '\u5237\u597d\u611f', family: 'attack', evidenceCount: 1 },
        { term: '\u5237\u9898\u5bb6', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8bc6\u6761\u649a \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bc6\u6761\u94c1 \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bc6\u6761\u94c1\u54a9 \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e8b\u540e\u8865\u62cd\u7279\u5199 \u6446\u62cd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u662f\u4eba\u662f\u9b3c\u90fd\u5728\u79c0 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u624b\u956f \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53d7\u6559\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e66\u65e0\u7838 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e66\u65e0\u7838\u61c2 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8700\u9ecd \u53d4\u53d4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5237\u597d\u611f \u4eba\u8bbe \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5237\u9898\u5bb6 \u6559\u80b2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for attack and absolutes weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u53cc\u8d62\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u53f8\u9a6c\u8138', family: 'attack', evidenceCount: 1 },
        { term: '\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0', family: 'attack', evidenceCount: 1 },
        { term: '\u849c\u8304\u8111\u888b', family: 'attack', evidenceCount: 1 },
        { term: '\u849c\u8304\u8111\u74dc', family: 'attack', evidenceCount: 1 },
        { term: '\u5c81\u6708\u795e\u5077', family: 'attack', evidenceCount: 1 },
        { term: '\u788e\u4e09\u89c2', family: 'attack', evidenceCount: 1 },
        { term: '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4ed6\u8d85\u7231', family: 'attack', evidenceCount: 1 },
        { term: '\u4ed6\u7edd\u5bf9\u662f\u6700\u8fd1\u624d\u6da8\u4ef7\u7684', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4ed6\u5168\u662f\u5bf9\u7684', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5b83m\u7684', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u53cc\u8d62\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53f8\u9a6c\u8138 \u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u849c\u8304\u8111\u888b \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u849c\u8304\u8111\u74dc \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c81\u6708\u795e\u5077 \u8001\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u788e\u4e09\u89c2 \u4e09\u89c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528 \u7edd\u5bf9\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ed6\u8d85\u7231 \u78d5cp \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ed6\u7edd\u5bf9\u662f\u6700\u8fd1\u624d\u6da8\u4ef7\u7684 \u6da8\u4ef7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ed6\u5168\u662f\u5bf9\u7684 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5b83m\u7684 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for politics product and request weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u53f0\u6e7e\u7f51\u519b\u673a\u5668\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u592a\u9633\u66b4\u6652\u7edd\u5bf9\u6709\u7528', family: 'absolutes', evidenceCount: 1 },
        { term: '\u592a\u88c5\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u7cd6\u6210\u8fd9\u6837', family: 'attack', evidenceCount: 1 },
        { term: '\u5957\u5305\u4ed9\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u8e22\u5230\u68c9\u82b1\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u751c\u83dc', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6761\u5f62\u7801', family: 'attack', evidenceCount: 1 },
        { term: '\u8d34\u724c\u8d27', family: 'attack', evidenceCount: 1 },
        { term: '\u901a\u5bb5\u6253\u87ba\u4e1d', family: 'attack', evidenceCount: 1 },
        { term: '\u540c\u6c42', family: 'cooperation', evidenceCount: 1 },
        { term: '\u9ab0\u5b50\u5988', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u53f0\u6e7e\u7f51\u519b\u673a\u5668\u4eba \u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u592a\u9633\u66b4\u6652\u7edd\u5bf9\u6709\u7528 \u504f\u65b9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u592a\u88c5\u4e86 \u4eba\u8bbe \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7cd6\u6210\u8fd9\u6837 \u78d5cp \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5957\u5305\u4ed9\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8e22\u5230\u68c9\u82b1\u4e86 \u6c9f\u901a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u751c\u83dc \u5929\u624d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6761\u5f62\u7801 \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d34\u724c\u8d27 \u4ea7\u54c1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u901a\u5bb5\u6253\u87ba\u4e1d \u6253\u5de5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u540c\u6c42 \u8d44\u6e90 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9ab0\u5b50\u5988 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for shill product and irony weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u571f\u72d7\u653e\u6d0b\u5c41', family: 'attack', evidenceCount: 1 },
        { term: '\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u6258\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u6258\u5b50\u6ee1\u5929\u98de', family: 'attack', evidenceCount: 1 },
        { term: '\u8131\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u6b6a\u5634\u5e73\u677f', family: 'attack', evidenceCount: 1 },
        { term: '\u6c6a\u6c6a\u961f\u52c7\u95ef\u732b\u7a9d', family: 'attack', evidenceCount: 1 },
        { term: '\u4ea1\u7075\u6cd5\u5e08', family: 'attack', evidenceCount: 1 },
        { term: '\u738b\u5927\u9a74', family: 'attack', evidenceCount: 1 },
        { term: '\u4f2a5g', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u4e0d\u5165\u5730\u72f1\u8c01\u5165\u5730\u72f1', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u5e38\u7b11', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u571f\u72d7\u653e\u6d0b\u5c41 \u5d07\u6d0b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6258\u5b50 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6258\u5b50\u6ee1\u5929\u98de \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8131\u5b50 \u6258\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b6a\u5634\u5e73\u677f \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6c6a\u6c6a\u961f\u52c7\u95ef\u732b\u7a9d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ea1\u7075\u6cd5\u5e08 \u8003\u53e4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u738b\u5927\u9a74 \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f2a5g \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u4e0d\u5165\u5730\u72f1\u8c01\u5165\u5730\u72f1 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u5e38\u7b11 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for first-person stance weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6211\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u90fd\u591a', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u7684\u95ee\u9898', family: 'correction', evidenceCount: 1 },
        { term: '\u6211\u6545\u610f\u7684', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6211\u53ef\u4ee5\u4e0d\u7528\u4f46\u662f\u4f60\u4e0d\u80fd\u6ca1\u6709', family: 'absolutes', evidenceCount: 1 },
        { term: '\u6211\u561e\u4e2a\u4e56\u4e56', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u7406\u89e3', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6211\u7406\u89e3\u4f60\u7684\u5fc3\u60c5', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6211\u7834\u9632', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u4e0a\u6211\u4e5f\u884c', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u662f\u89c9\u5f97', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6211\u662f\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u6211\u6709\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6211\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u90fd\u591a \u8d44\u5386 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u7684\u95ee\u9898 \u8ba4\u9519 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u6545\u610f\u7684 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u53ef\u4ee5\u4e0d\u7528\u4f46\u662f\u4f60\u4e0d\u80fd\u6ca1\u6709 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u561e\u4e2a\u4e56\u4e56 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u7406\u89e3 \u5171\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u7406\u89e3\u4f60\u7684\u5fc3\u60c5 \u5171\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u7834\u9632 \u81ea\u5632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u4e0a\u6211\u4e5f\u884c \u8d28\u7591 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u662f\u89c9\u5f97 \u8868\u6001 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u662f\u5c0f\u4e11 \u81ea\u5632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u6709\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for gaming metric and history weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u65e0\u8fb9\u6c2a\u6d77', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0\u654c\u4e4b\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0\u8111\u653e\u5927', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0\u8111\u55b7', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0\u75db\u547b\u541f', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0\u9700\u591a\u8a00', family: 'absolutes', evidenceCount: 1 },
        { term: '\u65e0\u63a9\u4f53\u5e72\u62c9', family: 'attack', evidenceCount: 1 },
        { term: '\u65e0cp', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e94\u6bd2\u4ff1\u5168', family: 'attack', evidenceCount: 1 },
        { term: '\u4e94\u51a0\u738b\u8b66\u544a', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4e94\u7ef4\u56fe\u5168\u90fd\u4f4e\u7684\u53ef\u601c', family: 'absolutes', evidenceCount: 1 },
        { term: '\u5438\u7279\u4e50', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u65e0\u8fb9\u6c2a\u6d77 \u6c2a\u91d1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u654c\u4e4b\u4eba \u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u8111\u653e\u5927 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u8111\u55b7 \u9ed1\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u75db\u547b\u541f \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u9700\u591a\u8a00 \u7ed3\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u63a9\u4f53\u5e72\u62c9 \u5c04\u51fb\u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0cp \u89d2\u8272 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e94\u6bd2\u4ff1\u5168 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e94\u51a0\u738b\u8b66\u544a \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e94\u7ef4\u56fe\u5168\u90fd\u4f4e\u7684\u53ef\u601c \u6570\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5438\u7279\u4e50 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for whitewash clown and reply weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u897f\u65b9\u4f2a\u53f2', family: 'absolutes', evidenceCount: 1 },
        { term: '\u6d17\u767d\u5f31\u4e09\u5206', family: 'attack', evidenceCount: 1 },
        { term: '\u6d17\u4e0d\u4e86\u4e00\u70b9', family: 'attack', evidenceCount: 1 },
        { term: '\u6d17\u8111\u5931\u8d25', family: 'attack', evidenceCount: 1 },
        { term: '\u6d17\u94b1\u7247', family: 'attack', evidenceCount: 1 },
        { term: '\u7ec6\u8bf4\u4f60\u7684\u7ecf\u5386', family: 'evasion', evidenceCount: 1 },
        { term: '\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd', family: 'attack', evidenceCount: 1 },
        { term: '\u4e0b\u996d', family: 'cooperation', evidenceCount: 1 },
        { term: '\u663e\u5f97\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11', family: 'attack', evidenceCount: 1 },
        { term: '\u5411\u5ba1\u6838\u7ad6\u8d77\u4e2d\u6307\u5427', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u4e11\u65b9', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u4e11\u53ef\u4ee5\u5e26\u4e2a', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u897f\u65b9\u4f2a\u53f2 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d17\u767d\u5f31\u4e09\u5206 \u6d17\u767d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d17\u4e0d\u4e86\u4e00\u70b9 \u6d17\u767d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d17\u8111\u5931\u8d25 \u53cd\u9a73 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d17\u94b1\u7247 \u7535\u5f71 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7ec6\u8bf4\u4f60\u7684\u7ecf\u5386 \u8ffd\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0b\u996d \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u663e\u5f97\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11 \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5411\u5ba1\u6838\u7ad6\u8d77\u4e2d\u6307\u5427 \u5ba1\u6838 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u4e11\u65b9 \u7acb\u573a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u4e11\u53ef\u4ee5\u5e26\u4e2a \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for platform gaming and reaction weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5c0f\u4e11\u638f\u51fa\u4e86\u7236\u6bcd\u8d2d\u4e70\u5238', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u5b69\u54e5', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5c0f\u5b69\u5c04', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u8001\u591a\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u9e1f\u4f0f\u7279\u52a0', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u7834\u7ad9', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5c0f\u4eba\u56fd\u56fd\u738b', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0f\u4eba\u9000\u6563', family: 'attack', evidenceCount: 1 },
        { term: '\u5c0ftip', family: 'cooperation', evidenceCount: 1 },
        { term: '\u7b11\u9ebb\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u7b11\u5760\u673a', family: 'absolutes', evidenceCount: 1 },
        { term: '\u7b11\u5760\u673a\u4e86', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5c0f\u4e11\u638f\u51fa\u4e86\u7236\u6bcd\u8d2d\u4e70\u5238 AI\u5267\u672c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u5b69\u54e5 \u6f14\u6280 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u5b69\u5c04 \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u8001\u591a\u4e86 \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u9e1f\u4f0f\u7279\u52a0 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u7834\u7ad9 B\u7ad9 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u4eba\u56fd\u56fd\u738b \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u4eba\u9000\u6563 \u80cc\u523a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0ftip \u6559\u7a0b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u9ebb\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u5760\u673a \u7b11\u54ed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u5760\u673a\u4e86 \u7b11\u54ed \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for media fandom and blame weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u68b0\u9501\u4ece\u91cc\u4ece\u5916\u5168\u90fd\u6253\u4e0d\u5f00', family: 'absolutes', evidenceCount: 1 },
        { term: '\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6', family: 'attack', evidenceCount: 1 },
        { term: '\u5fc3\u91cc\u6ca1\u70b9b\u6570', family: 'attack', evidenceCount: 1 },
        { term: '\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b', family: 'attack', evidenceCount: 1 },
        { term: '\u65b0\u5170\u515a', family: 'attack', evidenceCount: 1 },
        { term: '\u65b0\u95fb\u5b66\u7684\u9b45\u529b', family: 'attack', evidenceCount: 1 },
        { term: '\u661f\u661f\u773c', family: 'cooperation', evidenceCount: 1 },
        { term: '\u884c\u5584\u79ef\u5fb7', family: 'attack', evidenceCount: 1 },
        { term: '\u865a\u7a7a\u5efa\u4e00\u4e2a\u9776\u5b50', family: 'attack', evidenceCount: 1 },
        { term: '\u865a\u7a7a\u8feb\u5bb3', family: 'attack', evidenceCount: 1 },
        { term: '\u865a\u8363\u5c60\u592b', family: 'cooperation', evidenceCount: 1 },
        { term: '\u8f69\u59b9\u7684\u5567', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u68b0\u9501\u4ece\u91cc\u4ece\u5916\u5168\u90fd\u6253\u4e0d\u5f00 \u6c7d\u8f66 \u8f66\u95e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6 \u7269\u7406 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5fc3\u91cc\u6ca1\u70b9b\u6570 \u5ddd\u666e \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b \u5ddd\u666e \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65b0\u5170\u515a \u67ef\u5357 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65b0\u95fb\u5b66\u7684\u9b45\u529b \u5a92\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u661f\u661f\u773c \u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u884c\u5584\u79ef\u5fb7 \u56e0\u679c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u865a\u7a7a\u5efa\u4e00\u4e2a\u9776\u5b50 \u865a\u7a7a\u6253\u9776 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u865a\u7a7a\u8feb\u5bb3 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u865a\u8363\u5c60\u592b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8f69\u59b9\u7684\u5567 \u9f99\u54e5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for proverb beauty and creator weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u4f3c\u4e86', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4e9a\u519bfmvp', family: 'attack', evidenceCount: 1 },
        { term: '\u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u4e25\u67e5\u80cc\u666f', family: 'attack', evidenceCount: 1 },
        { term: '\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f', family: 'absolutes', evidenceCount: 1 },
        { term: '\u9633\u75ff', family: 'attack', evidenceCount: 1 },
        { term: '\u4e5f\u4e0d\u5b8c\u5168\u662f', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4e5f\u662f\u5f88\u6709\u751f\u6d3b\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u4e00\u5531\u4e00\u4e2a\u4e0d\u5431\u58f0', family: 'attack', evidenceCount: 1 },
        { term: '\u4e00\u9493\u5f00\u5929\u95e8', family: 'absolutes', evidenceCount: 1 },
        { term: '\u4e00\u5768\u52fe\u77f3', family: 'attack', evidenceCount: 1 },
        { term: '\u4e00\u773c\u5230\u5934', family: 'absolutes', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u4f3c\u4e86 \u732b\u732b \u661f\u661f\u773c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e9a\u519bfmvp \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e25\u67e5\u80cc\u666f \u7f51\u53cb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f \u7f8e\u5973 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9633\u75ff \u4e0b\u8f88\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e5f\u4e0d\u5b8c\u5168\u662f \u89e3\u91ca \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e5f\u662f\u5f88\u6709\u751f\u6d3b\u4e86 \u751f\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u5531\u4e00\u4e2a\u4e0d\u5431\u58f0 \u5531\u6b4c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u9493\u5f00\u5929\u95e8 \u9493\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u5768\u52fe\u77f3 \u5e26\u8d27 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u773c\u5230\u5934 \u4e09\u548c\u5927\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for anime crime and fandom weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e00\u773c\u79d1\u6280', family: 'attack', evidenceCount: 1 },
        { term: '\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86', family: 'cooperation', evidenceCount: 1 },
        { term: '\u4f9d\u6258\u5b9e', family: 'attack', evidenceCount: 1 },
        { term: '\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c', family: 'attack', evidenceCount: 1 },
        { term: '\u4ebf\u70b9\u70b9', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5f02\u98df\u7656', family: 'attack', evidenceCount: 1 },
        { term: '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16', family: 'evasion', evidenceCount: 1 },
        { term: '\u61ff\u7c89', family: 'attack', evidenceCount: 1 },
        { term: '\u9634\u6210\u5565\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u94f6\u624b\u956f', family: 'attack', evidenceCount: 1 },
        { term: '\u5f15\u86c7\u51fa\u6d1e', family: 'attack', evidenceCount: 1 },
        { term: '\u9e70\u89d2\u8981\u5012\u4e86', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e00\u773c\u79d1\u6280 \u5403\u74dc \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86 Fate \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f9d\u6258\u5b9e \u9760\u5b9e\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c \u864e\u6251 \u8bc4\u5206 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ebf\u70b9\u70b9 \u840c\u65b0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f02\u98df\u7656 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16 \u9003\u907f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u61ff\u7c89 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9634\u6210\u5565\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u94f6\u624b\u956f \u56e2\u4f19 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f15\u86c7\u51fa\u6d1e \u4e13\u5bb6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9e70\u89d2\u8981\u5012\u4e86 \u660e\u65e5\u65b9\u821f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for sports game platform weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8d62\u4e00\u573a\u5439\u4e00\u573a', family: 'attack', evidenceCount: 1 },
        { term: '\u8d62\u8005\u504f\u5dee', family: 'evidence', evidenceCount: 1 },
        { term: '\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427', family: 'attack', evidenceCount: 1 },
        { term: '\u786c\u64e6', family: 'attack', evidenceCount: 1 },
        { term: '\u6c38\u4e0d\u53d6\u5173', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6c38\u4e0d\u8da3\u5173', family: 'cooperation', evidenceCount: 1 },
        { term: '\u7528\u6237\u81ea\u9002\u5e94', family: 'evasion', evidenceCount: 1 },
        { term: '\u4f18\u96c5', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5e7d\u9ed8\u4f18\u5316', family: 'attack', evidenceCount: 1 },
        { term: '\u6cb9\u7ba1', family: 'evidence', evidenceCount: 1 },
        { term: '\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb', family: 'attack', evidenceCount: 1 },
        { term: '\u6709\u4f55\u8bf4\u6cd5', family: 'evidence', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8d62\u4e00\u573a\u5439\u4e00\u573a \u7403\u8ff7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d62\u8005\u504f\u5dee \u6295\u8d44 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427 \u5e26\u8d27 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u786c\u64e6 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6c38\u4e0d\u53d6\u5173 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6c38\u4e0d\u8da3\u5173 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7528\u6237\u81ea\u9002\u5e94 \u6e38\u620f\u7b56\u5212 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f18\u96c5 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5e7d\u9ed8\u4f18\u5316 \u6e38\u620f\u66f4\u65b0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6cb9\u7ba1 \u642c\u8fd0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb \u89e3\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u4f55\u8bf4\u6cd5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for music platform and evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6709\u6ca1\u53ef\u80fd', family: 'evasion', evidenceCount: 1 },
        { term: '\u6709\u8111\u5b50\u4f46\u4e0d\u591a', family: 'attack', evidenceCount: 1 },
        { term: '\u6709\u4e00\u70b9\u75d4\u75ae', family: 'attack', evidenceCount: 1 },
        { term: '\u6709\u8bc1\u636e\u5417', family: 'evidence', evidenceCount: 1 },
        { term: '\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a', family: 'cooperation', evidenceCount: 1 },
        { term: '\u5143\u7d20\u670b\u53cb', family: 'cooperation', evidenceCount: 1 },
        { term: '\u8fd0\u6c14\u771f\u597d', family: 'attack', evidenceCount: 1 },
        { term: '\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba', family: 'cooperation', evidenceCount: 1 },
        { term: '\u518d\u95ee\u5220\u4e86', family: 'evasion', evidenceCount: 1 },
        { term: '\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e', family: 'attack', evidenceCount: 1 },
        { term: '\u6e23\u6d6a', family: 'attack', evidenceCount: 1 },
        { term: '\u6218\u7ee9\u6e05\u96f6\u5361', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6709\u6ca1\u53ef\u80fd \u6709\u6ca1\u6709\u53ef\u80fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u8111\u5b50\u4f46\u4e0d\u591a \u7f51\u53cb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u4e00\u70b9\u75d4\u75ae \u8fd9\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u8bc1\u636e\u5417 \u5bf9\u7ebf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5143\u7d20\u670b\u53cb \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd0\u6c14\u771f\u597d \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba \u97f3\u4e50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u518d\u95ee\u5220\u4e86 \u5220\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6e23\u6d6a \u5fae\u535a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6218\u7ee9\u6e05\u96f6\u5361 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for referee brand and bot weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u957f\u6b8b\u7bc7', family: 'attack', evidenceCount: 1 },
        { term: '\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u8fd9\u4e2a\u88c1\u5224\u80af\u5b9a\u662f\u6709\u95ee\u9898\u7684', family: 'evidence', evidenceCount: 1 },
        { term: '\u8fd9\u4e2a\u5708\u5b50\u5c31\u662f\u70c2', family: 'absolutes', evidenceCount: 1 },
        { term: '\u8fd9\u724c\u5b50\u6211\u8fd9\u8f88\u5b50\u90fd\u4e0d\u4f1a\u78b0\u4e86', family: 'absolutes', evidenceCount: 1 },
        { term: '\u8fd9\u5b8c\u5168\u662f\u65e0\u79c1\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u771f\u90fd\u5047\u90fd', family: 'evasion', evidenceCount: 1 },
        { term: '\u771f\u5c31\u4e71\u55b7', family: 'attack', evidenceCount: 1 },
        { term: '\u771f\u4ebabot', family: 'attack', evidenceCount: 1 },
        { term: '\u771ftm\u4e0d\u8981\u8138', family: 'attack', evidenceCount: 1 },
        { term: '\u7741\u7740\u773c\u775b\u585e\u76f2\u76d2', family: 'attack', evidenceCount: 1 },
        { term: '\u6b63\u9053\u7684\u5149', family: 'cooperation', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u957f\u6b8b\u7bc7 \u7ae5\u661f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u4e2a\u88c1\u5224\u80af\u5b9a\u662f\u6709\u95ee\u9898\u7684 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u4e2a\u5708\u5b50\u5c31\u662f\u70c2 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u724c\u5b50\u6211\u8fd9\u8f88\u5b50\u90fd\u4e0d\u4f1a\u78b0\u4e86 \u907f\u96f7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u5b8c\u5168\u662f\u65e0\u79c1\u7684 \u8bbd\u523a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771f\u90fd\u5047\u90fd \u5206\u4e0d\u6e05 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771f\u5c31\u4e71\u55b7 \u5bf9\u7ebf \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771f\u4ebabot \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771ftm\u4e0d\u8981\u8138 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7741\u7740\u773c\u775b\u585e\u76f2\u76d2 \u6d88\u8d39\u8005 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b63\u9053\u7684\u5149 \u70ed\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for justice actor and zhubi weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6b63\u786e\u4e2a\u53fc', family: 'attack', evidenceCount: 1 },
        { term: '\u6b63\u4e49\u4e4b\u58eb', family: 'cooperation', evidenceCount: 1 },
        { term: '\u652f\u6301\u4e00\u4e0bup', family: 'cooperation', evidenceCount: 1 },
        { term: '\u77e5\u5c0f\u793c\u800c\u65e0\u5927\u4e49', family: 'attack', evidenceCount: 1 },
        { term: '\u503c\u4eba', family: 'attack', evidenceCount: 1 },
        { term: '\u804c\u4e1a\u6f14\u5458', family: 'attack', evidenceCount: 1 },
        { term: '\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf\u53d1\u529b\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u8098\u904d\u5168\u7f51', family: 'attack', evidenceCount: 1 },
        { term: '\u6731\u4e00\u9f99', family: 'attack', evidenceCount: 1 },
        { term: '\u732a\u9f3b', family: 'attack', evidenceCount: 1 },
        { term: '\u732a\u8840\u9992\u5934', family: 'attack', evidenceCount: 1 },
        { term: '\u6293\u5230\u4e00\u4e2a\u8001\u5b9e\u4eba', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6b63\u786e\u4e2a\u53fc \u65b9\u8a00 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b63\u4e49\u4e4b\u58eb \u9053\u5fb7\u7ed1\u67b6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u652f\u6301\u4e00\u4e0bup up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u77e5\u5c0f\u793c\u800c\u65e0\u5927\u4e49 \u5178\u6545 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u503c\u4eba \u7c73\u54c8\u6e38 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u804c\u4e1a\u6f14\u5458 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf\u53d1\u529b\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8098\u904d\u5168\u7f51 \u5468\u6770\u4f26 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6731\u4e00\u9f99 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u732a\u9f3b \u4f60\u600e\u4e48\u8fd9\u4e48\u732a\u9f3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u732a\u8840\u9992\u5934 \u5403\u4eba\u8840\u9992\u5934 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6293\u5230\u4e00\u4e2a\u8001\u5b9e\u4eba \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for expert profit and self-learn weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e13\u4e1a\u9009\u624b\u4e0d\u8bb8\u53c2\u52a0', family: 'attack', evidenceCount: 1 },
        { term: '\u7816\u5bb6\u53eb\u517d', family: 'attack', evidenceCount: 1 },
        { term: '\u8d5a\u7ffb', family: 'attack', evidenceCount: 1 },
        { term: '\u8d5a\u7ffb\u4e86', family: 'attack', evidenceCount: 1 },
        { term: '\u88c5\u5927\u5e08', family: 'attack', evidenceCount: 1 },
        { term: '\u88c5\u9ad8\u624b', family: 'attack', evidenceCount: 1 },
        { term: '\u88c5\u5510', family: 'attack', evidenceCount: 1 },
        { term: '\u88c5\u51f6\u6597\u72e0', family: 'attack', evidenceCount: 1 },
        { term: '\u8d44\u654c', family: 'attack', evidenceCount: 1 },
        { term: '\u5b50\u6db5', family: 'attack', evidenceCount: 1 },
        { term: '\u81ea\u5df1\u9009\u7684\u81ea\u5df1\u53d7\u7740', family: 'absolutes', evidenceCount: 1 },
        { term: '\u81ea\u5df1\u5b66', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e13\u4e1a\u9009\u624b\u4e0d\u8bb8\u53c2\u52a0 \u6bd4\u8d5b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7816\u5bb6\u53eb\u517d \u4e13\u5bb6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5a\u7ffb \u5546\u5bb6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d5a\u7ffb\u4e86 \u5546\u5bb6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u88c5\u5927\u5e08 \u6307\u70b9\u6c5f\u5c71 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u88c5\u9ad8\u624b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u88c5\u5510 \u5510\u6c0f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u88c5\u51f6\u6597\u72e0 \u952e\u76d8\u4fa0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d44\u654c \u7acb\u573a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5b50\u6db5 \u5c0f\u4f5c\u6587 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5df1\u9009\u7684\u81ea\u5df1\u53d7\u7740 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5df1\u5b66 \u6559\u7a0b \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for mixed meme and roman weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u81ea\u6170\u961f', family: 'attack', evidenceCount: 1 },
        { term: '\u81ea\u4fe1\u9ede\u628a\u597d\u50cf\u53bb\u6389', family: 'cooperation', evidenceCount: 1 },
        { term: '\u67006', family: 'cooperation', evidenceCount: 1 },
        { term: '\u6700\u53fc\u7684', family: 'attack', evidenceCount: 1 },
        { term: '\u6700\u540e\u4e00\u821e', family: 'cooperation', evidenceCount: 1 },
        { term: '\u562c\u562c\u562c', family: 'attack', evidenceCount: 1 },
        { term: '\u4f5c\u4e1a\u6284\u6b6a', family: 'attack', evidenceCount: 1 },
        { term: '\u5750e\u5f85\u6bd9', family: 'evasion', evidenceCount: 1 },
        { term: 'a\u5230\u7206\u70b8', family: 'cooperation', evidenceCount: 1 },
        { term: 'ar\u4e0a\u5927\u53f7\u8bf4\u8bdd', family: 'attack', evidenceCount: 1 },
        { term: 'dei\u63a7\u5236', family: 'evasion', evidenceCount: 1 },
        { term: 'dj\u5982\u6765', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u81ea\u6170\u961f \u56fd\u8db3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u4fe1\u9ede\u628a\u597d\u50cf\u53bb\u6389 \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u67006 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6700\u53fc\u7684 \u9009\u624b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6700\u540e\u4e00\u821e \u9000\u5f79 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u562c\u562c\u562c \u9017\u732b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f5c\u4e1a\u6284\u6b6a \u6284\u4f5c\u4e1a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5750e\u5f85\u6bd9 \u82f1\u96c4\u8054\u76df \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'a\u5230\u7206\u70b8 \u5973\u56e2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'ar\u4e0a\u5927\u53f7\u8bf4\u8bdd \u660e\u65e5\u65b9\u821f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'dei\u63a7\u5236 \u8bed\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'dj\u5982\u6765 \u97f3\u4e50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for ASCII slang weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'dna\u89c9\u9192', family: 'cooperation', evidenceCount: 1 },
        { term: 'gay\u8fbe', family: 'attack', evidenceCount: 1 },
        { term: 'hapi\u8a00\u8bba', family: 'attack', evidenceCount: 1 },
        { term: 'ip\u9519\u8bef', family: 'evasion', evidenceCount: 1 },
        { term: 'judge\u4eba', family: 'attack', evidenceCount: 1 },
        { term: 'kda\u5c04', family: 'attack', evidenceCount: 1 },
        { term: 'low\u7537', family: 'attack', evidenceCount: 1 },
        { term: 'n\u5237', family: 'cooperation', evidenceCount: 1 },
        { term: 'pv\u8bc8\u9a97', family: 'attack', evidenceCount: 1 },
        { term: 'pvppve\u5168\u90fd\u7528\u4e0d\u4e86', family: 'attack', evidenceCount: 1 },
        { term: 'py\u73b0\u573a', family: 'attack', evidenceCount: 1 },
        { term: 'sm\u5973\u738b', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'dna\u89c9\u9192 \u540d\u573a\u9762 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'gay\u8fbe \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'hapi\u8a00\u8bba \u70c2\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'ip\u9519\u8bef \u5c5e\u5730 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'judge\u4eba \u8bf4\u6559 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'kda\u5c04 \u82f1\u96c4\u8054\u76df \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'low\u7537 \u666e\u4fe1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'n\u5237 \u5267\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'pv\u8bc8\u9a97 \u624b\u6e38 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'pvppve\u5168\u90fd\u7528\u4e0d\u4e86 \u6e38\u620f\u7b56\u5212 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'py\u73b0\u573a \u6697\u7bb1\u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'sm\u5973\u738b \u89d2\u8272 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for fresh zero evidence queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'td\u5c0f\u9752\u86d9', family: 'attack', evidenceCount: 1 },
        { term: 'tv\u767d\u773c', family: 'attack', evidenceCount: 1 },
        { term: 'yj\u5f00\u4f1a', family: 'attack', evidenceCount: 1 },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', evidenceCount: 0 },
        { term: '12300\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', evidenceCount: 0 },
        { term: '2026\u6253\u5361', family: 'evasion', evidenceCount: 0 },
        { term: '\u57c3\u53ca\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u5200', family: 'attack', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u91ce', family: 'attack', evidenceCount: 0 },
        { term: '\u7231\u548b\u548b\u5730', family: 'evasion', evidenceCount: 0 },
        { term: '\u62d4\u7fa4', family: 'cooperation', evidenceCount: 0 },
        { term: '\u868c\u57e0\u4f4f\u7684', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'td\u5c0f\u9752\u86d9 \u4e24\u9762\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'tv\u767d\u773c B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'yj\u5f00\u4f1a \u660e\u65e5\u65b9\u821f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '10\u5e74\u8001\u7c89 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '12300\u5de5\u4fe1\u90e8\u6295\u8bc9 \u6d88\u8d39 \u8bc4\u8bba',
    '2026\u6253\u5361 \u6253\u5361 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u57c3\u53ca\u5427 \u8d34\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u5200 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u91ce \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7231\u548b\u548b\u5730 \u6001\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6548\u679c\u62d4\u7fa4 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u868c\u57e0\u4f4f\u7684 \u7ef7\u4e0d\u4f4f \u56de\u590d \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current B and evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4fddkdi', family: 'cooperation', evidenceCount: 0 },
        { term: '\u676f\u53cb\u9171', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6807\u9898\u515a\u6253\u6cd5', family: 'attack', evidenceCount: 0 },
        { term: '\u6807\u51c6\u7ed3\u5c40', family: 'absolutes', evidenceCount: 0 },
        { term: '\u4e0d\u52a8\u5982\u5c71', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e0d\u591abb', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e0d\u5c2c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'evidence', evidenceCount: 0 },
        { term: '\u4e0d\u53ef\u62b5\u6297\u529b', family: 'attack', evidenceCount: 0 },
        { term: '\u4e0d\u4e00\u4e00', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e0d\u4e00\u4e00\u8bc4\u4ef7', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e0d\u7528\u6211\u591a\u8bf4\u4e86\u5427', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4fddkdi \u8bc4\u5206 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u676f\u53cb\u9171 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6807\u9898\u515a\u6253\u6cd5 \u89c6\u9891\u6807\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6807\u51c6\u7ed3\u5c40 \u5267\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u52a8\u5982\u5c71 \u8fa9\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u591abb \u76f4\u63a5\u5f00\u55b7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u5c2c \u5c34\u5c2c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u53ef\u62b5\u6297\u529b \u4e0d\u53ef\u6297\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u4e00\u4e00\u5217\u4e3e \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u4e00\u4e00\u8bc4\u4ef7 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u7528\u6211\u591a\u8bf4\u4e86\u5427 \u61c2\u7684\u90fd\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for watch and meme weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u63d2\u4e2a\u773c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6210\u90fd\u54d2\u52fe\u52fe', family: 'attack', evidenceCount: 0 },
        { term: '\u6210\u90fd\u52fe\u52fe\u54d2', family: 'attack', evidenceCount: 0 },
        { term: '\u6210\u89c1\u662f\u4e00\u5ea7\u5927\u5c71', family: 'absolutes', evidenceCount: 0 },
        { term: '\u5403\u4e86\u5410', family: 'attack', evidenceCount: 0 },
        { term: '\u5b58\u7591\u7f57\u9a6c\u4eba', family: 'evidence', evidenceCount: 0 },
        { term: '\u54d2\u52fe\u52fe', family: 'attack', evidenceCount: 0 },
        { term: '\u5927\u8c61\u611f\u5192\u4e86', family: 'evasion', evidenceCount: 0 },
        { term: '\u5355\u8f66\u53d8\u6469\u6258', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6389\u5c0f\u73cd\u73e0', family: 'cooperation', evidenceCount: 0 },
        { term: '\u61c2\u5f97\u81ea\u7136\u61c2', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u63d2\u4e2a\u773c \u540e\u7eed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6210\u90fd\u54d2\u52fe\u52fe \u5730\u57df\u9ed1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6210\u90fd\u52fe\u52fe\u54d2 \u5730\u57df\u9ed1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6210\u89c1\u662f\u4e00\u5ea7\u5927\u5c71 \u54ea\u5412 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5403\u4e86\u5410 \u6076\u5fc3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f57\u9a6c\u4eba\u5b58\u7591 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u54d2\u52fe\u52fe \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5927\u8c61\u611f\u5192\u4e86 \u56de\u907f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u640f\u4e00\u640f \u5355\u8f66\u53d8\u6469\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u574f\u4e86\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6389\u5c0f\u73cd\u73e0 \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u61c2\u5f97\u81ea\u7136\u61c2 \u8c1c\u8bed\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for correction and account weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u61c2\u4e86\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u8be5\u9a82\u5c31\u9a82', family: 'attack', evidenceCount: 0 },
        { term: '\u611f\u8c22\u6307\u6b63', family: 'correction', evidenceCount: 0 },
        { term: '\u641e\u9519\u4e86', family: 'correction', evidenceCount: 0 },
        { term: '\u5de5\u91cdhao', family: 'cooperation', evidenceCount: 0 },
        { term: '\u516c\u5f0f\u5957\u53cd\u4e86', family: 'correction', evidenceCount: 0 },
        { term: '\u5bab\u9888\u7cdc\u70c2', family: 'attack', evidenceCount: 0 },
        { term: '\u62d0\u53cb\u5546', family: 'attack', evidenceCount: 0 },
        { term: '\u602a\u6211\u54af', family: 'evasion', evidenceCount: 0 },
        { term: '\u53f7\u88ab\u76d7', family: 'evasion', evidenceCount: 0 },
        { term: '\u53f7\u88ab\u76d7\u4e86', family: 'evasion', evidenceCount: 0 },
        { term: '\u8352\u91ce\u5927\u8fea\u5ba2', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u61c2\u4e86\u5427 \u8c1c\u8bed\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8be5\u9a82\u5c31\u9a82 \u7406\u6027\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u611f\u8c22\u6307\u6b63 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u641e\u9519\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5de5\u91cd\u53f7 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5bab\u9888\u7cdc\u70c2 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62ffDNF\u6765\u62d0 \u53cb\u5546 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u602a\u6211\u54af \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53f7\u88ab\u76d7 \u7529\u9505 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53f7\u88ab\u76d7\u4e86 \u7529\u9505 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8352\u91ce\u5927\u8fea\u5ba2 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for meme and dispute weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u7687\u4e0a', family: 'attack', evidenceCount: 0 },
        { term: '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5', family: 'evasion', evidenceCount: 0 },
        { term: '\u6d3b\u52a8\u771f\u5b9e\u6709\u6548', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5373\u6b7b', family: 'attack', evidenceCount: 0 },
        { term: '\u6781\u9650\u6a21\u5f0f', family: 'attack', evidenceCount: 0 },
        { term: '\u96c6\u7f8e\u529d\u5220', family: 'attack', evidenceCount: 0 },
        { term: '\u5956\u52b1\u7684\u6709\u70b9\u591a', family: 'cooperation', evidenceCount: 0 },
        { term: '\u997a\u5b50\u8001\u516b', family: 'attack', evidenceCount: 0 },
        { term: '\u997a\u5b50\u738b\u516b', family: 'attack', evidenceCount: 0 },
        { term: '\u6405\u6df7\u6c34', family: 'evasion', evidenceCount: 0 },
        { term: '\u53eb\u8fd9\u4e48\u723d', family: 'attack', evidenceCount: 0 },
        { term: '\u4ecb\u53f8\u9ebb\u82bd', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u7687\u4e0a \u5723\u65e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5 \u5b54\u4e59\u5df1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d3b\u52a8\u771f\u5b9e\u6709\u6548 \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5373\u6b7b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6781\u9650\u6a21\u5f0f \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u96c6\u7f8e\u529d\u5220 \u5c0f\u4ed9\u5973 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5956\u52b1\u7684\u6709\u70b9\u591a \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u997a\u5b50\u8001\u516b \u54ea\u5412 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u997a\u5b50\u738b\u516b \u54ea\u5412 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6405\u6df7\u6c34 \u5e26\u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53eb\u8fd9\u4e48\u723d \u8bed\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4ecb\u53f8\u9ebb\u82bd \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for reaction and platform weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4eca\u65e5\u9996\u7ef7\u4e86', family: 'attack', evidenceCount: 0 },
        { term: '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50', family: 'evasion', evidenceCount: 0 },
        { term: '\u7ecf\u5178\u52a0\u94b1', family: 'attack', evidenceCount: 0 },
        { term: '\u7cbe\u9009', family: 'evasion', evidenceCount: 0 },
        { term: '\u770b\u7834\u4e0d\u8bf4\u7834', family: 'evasion', evidenceCount: 0 },
        { term: '\u79d1\u5b66\u4e0a\u7f51', family: 'cooperation', evidenceCount: 0 },
        { term: '\u55d1\u74dc\u5b50', family: 'evasion', evidenceCount: 0 },
        { term: '\u6050\u827e', family: 'attack', evidenceCount: 0 },
        { term: '\u6050\u827e\u75c7', family: 'attack', evidenceCount: 0 },
        { term: '\u53e3high', family: 'attack', evidenceCount: 0 },
        { term: '\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50', family: 'attack', evidenceCount: 0 },
        { term: '\u62c9\u8868', family: 'evidence', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50 \u522b\u81ea\u55e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7ecf\u5178\u52a0\u94b1 \u5546\u5355 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bc4\u8bba\u7cbe\u9009 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u770b\u7834\u4e0d\u8bf4\u7834 \u61c2\u7684\u90fd\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u79d1\u5b66\u4e0a\u7f51 \u68af\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u55d1\u74dc\u5b50 \u5403\u74dc \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6050\u827e \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6050\u827e\u75c7 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53e3high \u5634\u55e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50 \u6263\u5e3d\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62c9\u8868 \u6570\u636e\u5bf9\u6bd4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for evidence and niche meme weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u62c9\u5938', family: 'attack', evidenceCount: 0 },
        { term: '\u8001\u5b9e\u4eba\u662f\u8001\u5b9e\u4e0d\u662f\u50bb', family: 'attack', evidenceCount: 0 },
        { term: '\u8001\u53ae', family: 'attack', evidenceCount: 0 },
        { term: '\u5386\u53f2\u9057\u7559\u95ee\u9898', family: 'evasion', evidenceCount: 0 },
        { term: '\u8054\u540d\u6b3e', family: 'cooperation', evidenceCount: 0 },
        { term: '\u730e\u6740\u8005', family: 'attack', evidenceCount: 0 },
        { term: '\u6d4f\u89c8\u5668\u641c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u9f99\u54e5\u7684\u5144\u5f1f', family: 'attack', evidenceCount: 0 },
        { term: '\u7f57\u4e0d\u6cfc', family: 'attack', evidenceCount: 0 },
        { term: '\u7f57\u9a6c\u5b58\u7591', family: 'evidence', evidenceCount: 0 },
        { term: '\u66fc\u5fb7\u62c9\u6548\u5e94', family: 'evidence', evidenceCount: 0 },
        { term: '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u62c9\u80ef \u8868\u73b0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001\u5b9e\u4eba\u662f\u8001\u5b9e\u4e0d\u662f\u50bb \u522b\u6b3a\u8d1f\u8001\u5b9e\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8001\u53ae \u9a82\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5386\u53f2\u9057\u7559\u95ee\u9898 \u7529\u9505 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8054\u540d\u6b3e \u5468\u8fb9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u730e\u6740\u8005 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6d4f\u89c8\u5668\u641c \u81ea\u5df1\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9f99\u54e5\u7684\u5144\u5f1f \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f57\u4e0d\u6cfc \u7f57\u6c38\u6d69 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f57\u9a6c\u5b58\u7591 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u66fc\u5fb7\u62c9\u6548\u5e94 \u8bb0\u5fc6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for fandom and fatalism weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6ca1\u6551\u4e86', family: 'attack', evidenceCount: 0 },
        { term: '\u6ca1\u4eba\u5728\u4e4e', family: 'evasion', evidenceCount: 0 },
        { term: '\u6885\u7f57cp', family: 'attack', evidenceCount: 0 },
        { term: '\u8499\u9f13\u4eba', family: 'attack', evidenceCount: 0 },
        { term: '\u79d2\u61c2\u79d2\u7b11', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5999\u554a\u5999\u554a', family: 'cooperation', evidenceCount: 0 },
        { term: '\u660e\u5929\u6765\u4e0a\u73ed', family: 'attack', evidenceCount: 0 },
        { term: '\u6a21\u68f1\u4e24\u53ef', family: 'evasion', evidenceCount: 0 },
        { term: '\u90a3\u80af\u5b9a\u662f\u4eba\u7684\u9519', family: 'attack', evidenceCount: 0 },
        { term: '\u5976\u51f6', family: 'attack', evidenceCount: 0 },
        { term: '\u5976\u51f6\u5976\u51f6', family: 'attack', evidenceCount: 0 },
        { term: '\u5185\u5a31\u4e0d\u7206\u540c', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6ca1\u6551\u4e86 \u6446\u70c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6ca1\u4eba\u5728\u4e4e \u53cd\u6b63\u6ca1\u4eba\u5728\u4e4e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6885\u7f57cp \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8499\u9f13\u4eba \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u79d2\u61c2\u79d2\u7b11 \u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5999\u554a\u5999\u554a \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u660e\u5929\u6765\u4e0a\u73ed \u7b56\u5212 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6a21\u68f1\u4e24\u53ef \u8f66\u8f71\u8f98\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u90a3\u80af\u5b9a\u662f\u4eba\u7684\u9519 \u4e0d\u662f\u673a\u5236\u95ee\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5976\u51f6 \u53ef\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5976\u51f6\u5976\u51f6 \u53ef\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5185\u5a31\u4e0d\u7206\u540c \u5185\u5a31 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for reply gaming and vtuber weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4f60\u7ba1\u5f97\u7740\u4eba\u5bb6', family: 'evasion', evidenceCount: 0 },
        { term: '\u4f60\u55b7\u6211\u5c31\u662f\u4f60\u5bf9', family: 'evasion', evidenceCount: 0 },
        { term: '\u4f60\u53ea\u7ba1\u5c04\u5269\u4e0b\u7684\u4ea4\u7ed9\u5269\u4e0b\u7684', family: 'attack', evidenceCount: 0 },
        { term: '\u634f\u5ac2', family: 'attack', evidenceCount: 0 },
        { term: '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a', family: 'attack', evidenceCount: 0 },
        { term: '\u7cef\u4e86', family: 'attack', evidenceCount: 0 },
        { term: '\u6b27\u9633\u5a1c\u5a1c', family: 'attack', evidenceCount: 0 },
        { term: '\u6015\u88ab\u5220\u8bc4', family: 'evasion', evidenceCount: 0 },
        { term: '\u6392\u957f', family: 'attack', evidenceCount: 0 },
        { term: '\u914d\u961f\u4fa0', family: 'attack', evidenceCount: 0 },
        { term: '\u670b\u53cb\u8d39', family: 'cooperation', evidenceCount: 0 },
        { term: '\u76ae\u5957', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4f60\u7ba1\u5f97\u7740\u4eba\u5bb6 \u4f60\u7ba1\u5f97\u7740\u5417 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u55b7\u6211\u5c31\u662f\u4f60\u5bf9 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4f60\u53ea\u7ba1\u5c04 \u5269\u4e0b\u7684\u4ea4\u7ed9\u5269\u4e0b\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u634f\u5ac2 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7cef\u4e86 \u4e0d\u6562\u6253 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b27\u9633\u5a1c\u5a1c \u660e\u661f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6015\u88ab\u5220\u8bc4 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6392\u957f \u6392\u961f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u914d\u961f\u4fa0 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u670b\u53cb\u8d39 \u4ed8\u8d39 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76ae\u5957 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current slang and comment weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u76ae\u7279\u6258', family: 'cooperation', evidenceCount: 0 },
        { term: '\u76ae\u7279\u6258\u5148\u751f', family: 'cooperation', evidenceCount: 0 },
        { term: '\u76ae\u7279\u62d6', family: 'cooperation', evidenceCount: 0 },
        { term: '\u9a97\u70ae', family: 'evasion', evidenceCount: 0 },
        { term: '\u9a97\u4eba\u6211\u76f4\u63a5\u53bb\u6b7b', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7834\u4e86\u76f8\u4e86', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5176\u5b9e\u4e0d\u5b8c\u5168', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8d77\u6765\u771f\u7684\u7ef7\u4e0d\u4f4f', family: 'attack', evidenceCount: 0 },
        { term: '\u5f3a\u5ea6\u5728\u7ebf', family: 'cooperation', evidenceCount: 0 },
        { term: '\u62a2\u4e2a\u6c99\u53d1', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5207ki', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8f7b\u5feb\u7ef7\u4f4f', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u76ae\u7279\u6258 \u76ae\u7279\u6258\u5148\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76ae\u7279\u6258\u5148\u751f \u76ae\u7279\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76ae\u7279\u62d6 \u76ae\u7279\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a97\u70ae \u6e23\u7537 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9a97\u4eba\u6211\u76f4\u63a5\u53bb\u6b7b \u53d1\u8a93 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7834\u4e86\u76f8\u4e86 \u8868\u60c5\u5305 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5176\u5b9e\u4e0d\u5b8c\u5168 \u53cd\u9a73 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u8d77\u6765\u771f\u7684\u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f3a\u5ea6\u5728\u7ebf \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u62a2\u4e2a\u6c99\u53d1 \u6c99\u53d1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5207ki \u65e5\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8f7b\u5feb\u7ef7\u4f4f \u600e\u4e48\u8ba9\u6211\u7ef7\u5f97\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next meme and evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u8f7b\u677e\u7ef7\u4e0d\u4f4f', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6e05\u9192\u5730\u5815\u843d', family: 'cooperation', evidenceCount: 0 },
        { term: '\u533a\u533a52', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5708\u7684\u7c73', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5168\u90fd\u662f\u5bf9', family: 'absolutes', evidenceCount: 0 },
        { term: '\u5168\u662f\u654f\u611f\u8bdd\u9898', family: 'evasion', evidenceCount: 0 },
        { term: '\u7136\u540e\u62bd\u7684\u5168\u662f\u81ea\u5df1\u5c0f\u53f7', family: 'evidence', evidenceCount: 0 },
        { term: '\u5203\u7259\u6b7b\u56da', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8ba4\u771f\u4f60\u5c31\u8f93\u4e86', family: 'evasion', evidenceCount: 0 },
        { term: '\u5982\u679c\u6709', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8f6f\u6587', family: 'evidence', evidenceCount: 0 },
        { term: '\u5f31\u5f31\u8bf4\u4e00\u53e5', family: 'correction', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u8f7b\u677e\u7ef7\u4e0d\u4f4f \u600e\u4e48\u8ba9\u6211\u7ef7\u5f97\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6e05\u9192\u5730\u5815\u843d \u6446\u70c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u533a\u533a52 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5708\u7684\u7c73 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u90fd\u662f\u5bf9 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5168\u662f\u654f\u611f\u8bdd\u9898 \u4e0d\u597d\u8bf4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7136\u540e\u62bd\u7684\u5168\u662f\u81ea\u5df1\u5c0f\u53f7 \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5203\u7259\u6b7b\u56da \u52a8\u6f2b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8ba4\u771f\u4f60\u5c31\u8f93\u4e86 \u4e50\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8981\u662f\u771f\u6709 \u53cd\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u662f\u8f6f\u6587\u5427 \u5e7f\u544a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f31\u5f31\u5730\u8bf4\u4e00\u53e5 \u4e0d\u61c2\u5c31\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for latest meme and comment weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e09\u963f\u54e5', family: 'attack', evidenceCount: 0 },
        { term: '\u4e09\u89d2\u8d38\u6613', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8272\u5f31\u5927\u519b', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6c99\u96d5\u6897', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5220\u8bc4\u62c9\u9ed1', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e0a\u7535\u89c6', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e0a\u6811', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8bbe\u5b50', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8c01\u61c2', family: 'evasion', evidenceCount: 0 },
        { term: '\u795e\u795e', family: 'attack', evidenceCount: 0 },
        { term: '\u751f\u8349', family: 'attack', evidenceCount: 0 },
        { term: '\u751f\u4ea7\u961f\u7684\u9a74', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e09\u963f\u54e5 \u8fd8\u73e0\u683c\u683c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e09\u89d2\u8d38\u6613 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8272\u5f31\u5927\u519b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6c99\u96d5\u6897 \u641e\u7b11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5220\u8bc4\u62c9\u9ed1 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0a\u7535\u89c6 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0a\u6811 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8bbe\u5b50 oc \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8c01\u61c2\u554a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u795e\u795e \u6b96\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u751f\u8349 \u65e5\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u751f\u4ea7\u961f\u7684\u9a74 \u5e72\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for archive and product weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5b9e\u540d\u5236', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5b9e\u540d\u5236\u89c2\u770b', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e16\u754c\u754c\u4e16', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e8b\u5728\u4eba\u4e3a', family: 'cooperation', evidenceCount: 0 },
        { term: '\u89c6\u89d2\u4e22\u5931', family: 'evasion', evidenceCount: 0 },
        { term: '\u89c6\u9891\u5168\u90fd\u4e0d\u89c1\u4e86', family: 'evasion', evidenceCount: 0 },
        { term: '\u89c6\u9891\u540c\u6b3e', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6536\u85cf\u4ece\u672a\u505c\u6b62\u884c\u52a8\u4ece\u672a\u5f00\u59cb', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8212\u670d\u6d41', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7761\u524d\u5c0f\u751c\u997c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6b7b\u62ff', family: 'absolutes', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5b9e\u540d\u5236 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5b9e\u540d\u5236\u89c2\u770b \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e16\u754c\u754c\u4e16 \u7f51\u6613\u4e91 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e8b\u5728\u4eba\u4e3a \u52b1\u5fd7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u89c6\u89d2\u4e22\u5931 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u89c6\u9891\u5168\u90fd\u4e0d\u89c1\u4e86 \u4e0b\u67b6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u89c6\u9891\u540c\u6b3e \u79cd\u8349 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6536\u85cf\u4ece\u672a\u505c\u6b62 \u884c\u52a8\u4ece\u672a\u5f00\u59cb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8212\u670d\u6d41 \u9635\u5bb9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7761\u524d\u5c0f\u751c\u997c \u52a8\u6f2b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6b7b\u62ff\u4e0d\u653e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for vtuber forum and unsubscribe weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u641c\u5457', family: 'evasion', evidenceCount: 0 },
        { term: '\u7d20\u6750\u4e22\u5931', family: 'evasion', evidenceCount: 0 },
        { term: '\u5854\u83f2', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5854\u5723', family: 'cooperation', evidenceCount: 0 },
        { term: '\u592a\u76d1\u4e86', family: 'cooperation', evidenceCount: 0 },
        { term: '\u592a\u6709\u795e\u97f5\u4e86\u8001\u94c1', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6001\u5ea6\u51b3\u5b9a\u4e00\u5207', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5929\u6587\u9635\u8425', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8d34\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u5077\u5077\u53d6\u5173', family: 'cooperation', evidenceCount: 0 },
        { term: '\u56fe\u7247\u53ef\u4ee5\u62ff\u5417', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5154\u5154\u5c9b', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u641c\u5457 \u81ea\u5df1\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7d20\u6750\u4e22\u5931 \u526a\u8f91 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5854\u83f2 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5854\u5723 \u5854\u83f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u592a\u76d1\u4e86 \u505c\u66f4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u592a\u6709\u795e\u97f5\u4e86\u8001\u94c1 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6001\u5ea6\u51b3\u5b9a\u4e00\u5207 \u52aa\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5929\u6587\u9635\u8425 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8d34\u5427 \u8001\u54e5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5077\u5077\u53d6\u5173 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u56fe\u7247\u53ef\u4ee5\u62ff\u5417 \u6388\u6743 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5154\u5154\u5c9b \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for meme gaming and product weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u56e2\u706d\u590d\u4ec7\u8005\u8054\u76df', family: 'attack', evidenceCount: 0 },
        { term: '\u541e\u4e4b', family: 'attack', evidenceCount: 0 },
        { term: '\u8131\u5355', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e38\u4e86', family: 'attack', evidenceCount: 0 },
        { term: '\u73a9\u6e38\u4e0d\u6df7\u5708', family: 'evasion', evidenceCount: 0 },
        { term: '\u7f51\u76d8\u89c1', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5fd8\u8bb0\u4e86\u5f53\u5c0f\u4e11\u7684\u6765\u65f6\u8def', family: 'attack', evidenceCount: 0 },
        { term: '\u671b\u5468\u77e5', family: 'absolutes', evidenceCount: 0 },
        { term: '\u5371\u9669\u53d1\u8a00', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e3a\u53d1\u70e7\u800c\u751f', family: 'evidence', evidenceCount: 0 },
        { term: '\u543b\u9888\u4e4b\u4ea4', family: 'attack', evidenceCount: 0 },
        { term: '\u95ee\u8001\u9a6c\u672c\u4eba', family: 'evidence', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u56e2\u706d\u590d\u4ec7\u8005\u8054\u76df \u6f2b\u5a01 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u541e\u4e4b \u8868\u60c5\u5305 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8131\u5355 \u604b\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e38\u4e86 \u5b8c\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u73a9\u6e38\u4e0d\u6df7\u5708 \u6e38\u620f\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7f51\u76d8\u89c1 \u8d44\u6e90 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5fd8\u8bb0\u4e86\u5f53\u5c0f\u4e11\u7684\u6765\u65f6\u8def \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u671b\u5468\u77e5 \u901a\u77e5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5371\u9669\u53d1\u8a00 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e3a\u53d1\u70e7\u800c\u751f \u5c0f\u7c73 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u543b\u9888\u4e4b\u4ea4 \u6bb5\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u95ee\u8001\u9a6c\u672c\u4eba \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for fandom platform and typo meme weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u6211\u6ef4\u5b69\u6765', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6211\u6d3b\u5230\u5934\u4e86', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6211\u5c06\u652f\u4ed8\u60a8\u753b\u753b\u7684\u8d39\u7528', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6211\u63a8\u8d5b\u9ad8', family: 'cooperation', evidenceCount: 0 },
        { term: '\u65e0\u7aef\u8054\u60f3', family: 'evasion', evidenceCount: 0 },
        { term: '\u65e0\u547d\u4fee\u77e3', family: 'attack', evidenceCount: 0 },
        { term: '\u65e0\u6240\u540a\u8c13', family: 'evasion', evidenceCount: 0 },
        { term: '\u543e\u547d\u4f11\u77e3', family: 'attack', evidenceCount: 0 },
        { term: '\u819d\u8df3\u53cd\u5c04\u5f0f\u559c\u5267', family: 'attack', evidenceCount: 0 },
        { term: '\u5c0f\u9ec4\u9c7c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5c0f\u67d0\u4e66', family: 'evasion', evidenceCount: 0 },
        { term: '\u5c0f\u786e\u5e78', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u6211\u6ef4\u5b69\u6765 \u8868\u60c5\u5305 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u6d3b\u5230\u5934\u4e86 \u7b11\u6b7b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u5c06\u652f\u4ed8\u60a8\u753b\u753b\u7684\u8d39\u7528 \u7ea6\u7a3f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6211\u63a8\u8d5b\u9ad8 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u7aef\u8054\u60f3 \u4e0d\u8981\u8054\u60f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u547d\u4fee\u77e3 \u543e\u547d\u4f11\u77e3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65e0\u6240\u540a\u8c13 \u65e0\u6240\u8c13 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u543e\u547d\u4f11\u77e3 \u53e4\u6587 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u819d\u8df3\u53cd\u5c04\u5f0f\u559c\u5267 \u559c\u5267 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u9ec4\u9c7c \u95f2\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u67d0\u4e66 \u5c0f\u7ea2\u4e66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0f\u786e\u5e78 \u751f\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for creator jokes and source weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5c0f\u53d4\u6587\u5b66', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5c0fup', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7b11\u70b9\u89e3\u6790', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7b11\u6b7b\u52a0\u6342\u8138', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7b11\u563b\u4e86', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e9b\u8bb8\u98ce\u971c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u8c22\u8c22\u4f60\u8bfe\u4ee3\u8868', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4fe1\u7528\u52061000', family: 'evidence', evidenceCount: 0 },
        { term: '\u4fe1\u6e90', family: 'evidence', evidenceCount: 0 },
        { term: '\u8840\u8d5a', family: 'absolutes', evidenceCount: 0 },
        { term: '\u538b\u529b\u6765\u5230\u4e86\u5c0f\u7334\u8fd9\u8fb9', family: 'attack', evidenceCount: 0 },
        { term: '\u773c\u91cc\u6709\u5149', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5c0f\u53d4\u6587\u5b66 \u77ed\u5267 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5c0fup up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u70b9\u89e3\u6790 \u6ca1\u770b\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u6b7b\u52a0\u6342\u8138 \u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7b11\u563b\u4e86 \u641e\u7b11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e9b\u8bb8\u98ce\u971c \u7231\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8c22\u8c22\u4f60\u8bfe\u4ee3\u8868 \u603b\u7ed3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4fe1\u7528\u52061000 \u829d\u9ebb\u4fe1\u7528 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4fe1\u6e90 \u6d88\u606f\u6765\u6e90 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8840\u8d5a \u8d2d\u7269 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u538b\u529b\u6765\u5230\u4e86\u5c0f\u7334\u8fd9\u8fb9 \u9ed1\u795e\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u773c\u91cc\u6709\u5149 \u68a6\u60f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for platform gaming and homophone weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u592e\u5988', family: 'cooperation', evidenceCount: 0 },
        { term: '\u9633\u6c14\u4e0d\u8db3', family: 'attack', evidenceCount: 0 },
        { term: '\u9633\u5bff', family: 'cooperation', evidenceCount: 0 },
        { term: '\u9080\u8bf7\u7801', family: 'cooperation', evidenceCount: 0 },
        { term: '\u91ce\u6392', family: 'cooperation', evidenceCount: 0 },
        { term: '\u91ce\u718a', family: 'evasion', evidenceCount: 0 },
        { term: '\u4e00\u822c\u5411', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e00\u5206\u56da', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e00\u5206\u56da\u5f92', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e00\u5206\u9690\u58eb', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e00\u4f8b\u6bcd', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e00\u7c92\u6bcd', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u592e\u5988 \u592e\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9633\u6c14\u4e0d\u8db3 \u7f51\u53cb \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9633\u5bff \u771f\u5b9e\u4f24\u5bb3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9080\u8bf7\u7801 \u5185\u6d4b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u91ce\u6392 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u91ce\u718a \u535a\u5fb7\u4e4b\u95e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u822c\u5411 \u4e8c\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u5206\u56da \u4e00\u5206\u56da\u5f92 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u5206\u56da\u5f92 \u6210\u5206 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u5206\u9690\u58eb \u6210\u5206 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u4f8b\u6bcd \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u7c92\u6bcd \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for follow-back fandom and evidence weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e00\u5207\u5982\u56fe', family: 'evidence', evidenceCount: 0 },
        { term: '\u4e00\u66f2\u5fe0\u8bda\u7684\u8d5e\u6b4c', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5df2\u5173\u8bf7\u56de', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5df2\u5173\u5df2\u8d5e\u8bf7\u56de', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5df2\u8001\u5b9e', family: 'correction', evidenceCount: 0 },
        { term: '\u5df2\u8d5e10\u8bf7\u56de\u4e0b', family: 'cooperation', evidenceCount: 0 },
        { term: '\u5f02\u8bae', family: 'attack', evidenceCount: 0 },
        { term: '\u610f\u6797\u8bda\u4e0d\u6b3a', family: 'cooperation', evidenceCount: 0 },
        { term: '\u610f\u6ee1\u79bb', family: 'cooperation', evidenceCount: 0 },
        { term: '\u7528\u7231\u53d1\u7535', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6709\u5e1d\u6709\u6211', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6709\u4eba\u6252\u5230\u7c89\u7c4d\u4e86', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e00\u5207\u5982\u56fe \u622a\u56fe \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e00\u66f2\u5fe0\u8bda\u7684\u8d5e\u6b4c \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5df2\u5173\u8bf7\u56de \u4e92\u5173 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5df2\u5173\u5df2\u8d5e\u8bf7\u56de \u4e92\u8d5e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5df2\u8001\u5b9e \u8ba4\u9519 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5df2\u8d5e10\u8bf7\u56de\u4e0b \u4e92\u8d5e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f02\u8bae \u53cd\u5bf9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u610f\u6797\u8bda\u4e0d\u6b3a \u6545\u4e8b\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u610f\u6ee1\u79bb \u6ee1\u610f\u79bb\u5f00 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7528\u7231\u53d1\u7535 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u5e1d\u6709\u6211 \u7c89\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6709\u4eba\u6252\u5230\u7c89\u7c4d\u4e86 \u7c89\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for retry missed compact and meme queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '0\u63d0\u5347', family: 'cooperation', evidenceCount: 0 },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', evidenceCount: 0 },
        { term: '12300\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', evidenceCount: 0 },
        { term: '2026\u6253\u5361', family: 'evasion', evidenceCount: 0 },
        { term: '\u57c3\u53ca\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u5200', family: 'attack', evidenceCount: 0 },
        { term: '\u827e\u6ecb\u91ce', family: 'attack', evidenceCount: 0 },
        { term: '\u7231\u548b\u548b\u5730', family: 'evasion', evidenceCount: 0 },
        { term: '\u7231\u548b\u548b\u7684', family: 'evasion', evidenceCount: 0 },
        { term: '\u868c\u57e0\u4f4f\u7684', family: 'correction', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 10,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '10\u5e74\u8001\u7c89 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '12300\u5de5\u4fe1\u90e8\u6295\u8bc9 \u6d88\u8d39 \u8bc4\u8bba',
    '2026\u6253\u5361 \u6253\u5361 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u57c3\u53ca\u5427 \u8d34\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u5200 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u827e\u6ecb\u91ce \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7231\u548b\u548b\u5730 \u6001\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7231\u548b\u548b\u7684 \u6001\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u868c\u57e0\u4f4f\u7684 \u7ef7\u4e0d\u4f4f \u56de\u590d \u70ed\u8bc4',
    '0\u63d0\u5347 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for current unattempted meme and fandom queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u9c7c\u63a8', family: 'cooperation', evidenceCount: 0 },
        { term: '\u539f\u6765\u4f60\u4e5f\u73a9\u539f\u795e', family: 'attack', evidenceCount: 0 },
        { term: '\u613f\u6d1e\u5bdf\u8001\u5934\u5ffd\u60a0\u4f60\u4eec', family: 'attack', evidenceCount: 0 },
        { term: '\u613f\u6d1e\u5bdf\u4e4b\u7236\u5ffd\u60a0\u4f60\u4eec', family: 'attack', evidenceCount: 0 },
        { term: '\u9605\u8bfb\u7406\u89e3\u6ee1\u5206', family: 'correction', evidenceCount: 0 },
        { term: '\u54b1\u4eec\u773c\u5149\u4e00\u6837', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6cbe\u597d\u8fd0', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6cbe\u6cbe\u597d\u8fd0', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6218\u4e59\u5973', family: 'attack', evidenceCount: 0 },
        { term: '\u8fd9\u4e2a\u662f\u771f\u7ef7\u4e0d\u4f4f', family: 'attack', evidenceCount: 0 },
        { term: '\u8fd9\u5f88\u68d2\u5148\u751f', family: 'attack', evidenceCount: 0 },
        { term: '\u8fd9\u91cc\u6709\u4e2a\u8001\u5b9e\u4eba', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u9c7c\u63a8 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u539f\u6765\u4f60\u4e5f\u73a9\u539f\u795e \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u613f\u6d1e\u5bdf\u8001\u5934\u5ffd\u60a0\u4f60\u4eec \u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u613f\u6d1e\u5bdf\u4e4b\u7236\u5ffd\u60a0\u4f60\u4eec \u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u9605\u8bfb\u7406\u89e3\u6ee1\u5206 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u54b1\u4eec\u773c\u5149\u4e00\u6837 \u5ba1\u7f8e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6cbe\u597d\u8fd0 \u62bd\u5361 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6cbe\u6cbe\u597d\u8fd0 \u62bd\u5361 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6218\u4e59\u5973 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u4e2a\u662f\u771f\u7ef7\u4e0d\u4f4f \u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u5f88\u68d2\u5148\u751f \u5f88\u68d2\u5148\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8fd9\u91cc\u6709\u4e2a\u8001\u5b9e\u4eba \u8001\u5b9e\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for knowledge and slang weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u9488\u4e0d\u6233', family: 'cooperation', evidenceCount: 0 },
        { term: '\u771f\u5b9e\u4f4f', family: 'attack', evidenceCount: 0 },
        { term: '\u771f\u5b9e\u4f4f\u4e86', family: 'attack', evidenceCount: 0 },
        { term: '\u771fcs', family: 'attack', evidenceCount: 0 },
        { term: '\u652f\u6301\u529b', family: 'cooperation', evidenceCount: 0 },
        { term: '\u77e5\u8bc6\u76f2\u533a', family: 'cooperation', evidenceCount: 0 },
        { term: '\u77e5\u8bc6\u589e\u52a0', family: 'cooperation', evidenceCount: 0 },
        { term: '\u76f4\u7537\u4e0d\u7ba1\u5bf9\u65b9\u53eb\u8001\u5a46', family: 'attack', evidenceCount: 0 },
        { term: '\u76f4\u8a00\u4e0d\u8bb3', family: 'correction', evidenceCount: 0 },
        { term: '\u53ea\u6e21\u6709\u7f18\u4eba', family: 'evasion', evidenceCount: 0 },
        { term: '\u53ea\u53ef\u610f\u4f1a', family: 'evasion', evidenceCount: 0 },
        { term: '\u667a\u8005\u4e0d\u5165\u7231\u6cb3', family: 'evasion', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u9488\u4e0d\u6233 \u771f\u4e0d\u9519 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771f\u5b9e\u4f4f \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771f\u5b9e\u4f4f\u4e86 \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u771fcs \u771f\u755c\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u652f\u6301\u529b up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u77e5\u8bc6\u76f2\u533a \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u77e5\u8bc6\u589e\u52a0 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76f4\u7537\u4e0d\u7ba1\u5bf9\u65b9\u53eb\u8001\u5a46 \u8001\u5a46 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u76f4\u8a00\u4e0d\u8bb3 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53ea\u6e21\u6709\u7f18\u4eba \u6559\u7a0b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u53ea\u53ef\u610f\u4f1a \u4e0d\u53ef\u8a00\u4f20 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u667a\u8005\u4e0d\u5165\u7231\u6cb3 \u604b\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for identity and account weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28', family: 'cooperation', evidenceCount: 0 },
        { term: '\u4e2d\u7cfb', family: 'cooperation', evidenceCount: 0 },
        { term: '\u79cd\u82b1\u4eba', family: 'cooperation', evidenceCount: 0 },
        { term: '\u6293\u5230\u4e00\u4e2a\u6d3b\u7684', family: 'attack', evidenceCount: 0 },
        { term: '\u7d2b\u96f7\u5b8c\u5168\u662f\u88ab\u8fde\u7d2f\u7684\u5427', family: 'attack', evidenceCount: 0 },
        { term: '\u7d2b\u96f7\u5b8c\u5168\u662f\u88ab\u7275\u8fde\u7684', family: 'attack', evidenceCount: 0 },
        { term: '\u81ea\u62bd\u53f7', family: 'attack', evidenceCount: 0 },
        { term: '\u81ea\u5e26\u72d7\u7cae', family: 'cooperation', evidenceCount: 0 },
        { term: '\u81ea\u5df1\u53bb\u67e5\u67e5', family: 'evidence', evidenceCount: 0 },
        { term: '\u81ea\u5728\u6781\u610f\u7ef7', family: 'attack', evidenceCount: 0 },
        { term: '\u65cf\u8c31\u4e16\u88ad', family: 'attack', evidenceCount: 0 },
        { term: '\u5634\u66ff', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u4e2d\u56fd\u5b9d\u5b9d\u4f53\u8d28 \u751f\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e2d\u7cfb \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u79cd\u82b1\u4eba \u7231\u56fd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6293\u5230\u4e00\u4e2a\u6d3b\u7684 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7d2b\u96f7\u5b8c\u5168\u662f\u88ab\u8fde\u7d2f\u7684\u5427 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u7d2b\u96f7\u5b8c\u5168\u662f\u88ab\u7275\u8fde\u7684 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u62bd\u53f7 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5e26\u72d7\u7cae \u7ec3\u5ea6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5df1\u53bb\u67e5\u67e5 \u67e5\u8bc1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u81ea\u5728\u6781\u610f\u7ef7 \u9f99\u73e0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u65cf\u8c31\u4e16\u88ad \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5634\u66ff \u8bf4\u51fa\u5fc3\u58f0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for mixed ascii meme weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'ai\u8bc6\u7247\u9171', family: 'cooperation', evidenceCount: 0 },
        { term: 'bgm\u5473', family: 'attack', evidenceCount: 0 },
        { term: 'bonjour\u4ebb\u5c14\u5973\u5b50', family: 'attack', evidenceCount: 0 },
        { term: 'bug\u8f6c\u6b63', family: 'attack', evidenceCount: 0 },
        { term: 'catconfuse', family: 'attack', evidenceCount: 0 },
        { term: 'cd4\u7ec6\u80de', family: 'attack', evidenceCount: 0 },
        { term: 'cos\u8def\u6613\u5341\u516d', family: 'attack', evidenceCount: 0 },
        { term: 'cp\u7cae', family: 'cooperation', evidenceCount: 0 },
        { term: 'doge\u91d1\u7b8d', family: 'attack', evidenceCount: 0 },
        { term: 'doge\u5723\u8bde', family: 'cooperation', evidenceCount: 0 },
        { term: 'ip\u53ef\u4fe1', family: 'evidence', evidenceCount: 0 },
        { term: 'k\u54e5', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'ai\u8bc6\u7247\u9171 B\u7ad9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'bgm\u5473 \u97f3\u4e50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'bonjour\u4ebb\u5c14\u5973\u5b50 \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'bug\u8f6c\u6b63 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'catconfuse B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'cd4\u7ec6\u80de \u533b\u5b66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'cos\u8def\u6613\u5341\u516d \u89d2\u8272 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'cp\u7cae \u4e8c\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge\u91d1\u7b8d B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'doge\u5723\u8bde B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'ip\u53ef\u4fe1 IP\u5c5e\u5730 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'k\u54e5 \u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for platform and acronym weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'kda\u5927\u5e1d', family: 'attack', evidenceCount: 0 },
        { term: 'nat\u7c7b\u578b', family: 'evidence', evidenceCount: 0 },
        { term: 'tv\u70b9\u8d5e', family: 'cooperation', evidenceCount: 0 },
        { term: 'tv\u574f\u7b11', family: 'attack', evidenceCount: 0 },
        { term: 'up\u597d\u725b', family: 'cooperation', evidenceCount: 0 },
        { term: 'windowxp\u542f\u52a8', family: 'evasion', evidenceCount: 0 },
        { term: 'xswl', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 7,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'kda\u5927\u5e1d \u82f1\u96c4\u8054\u76df \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'nat\u7c7b\u578b \u8054\u673a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'tv\u70b9\u8d5e B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'tv\u574f\u7b11 B\u7ad9\u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'up\u597d\u725b UP\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'windowxp\u542f\u52a8 \u97f3\u6548 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    'xswl \u7b11\u6b7b\u6211\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for near-complete missed weak queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u963f\u9ed1\u989c', family: 'attack', evidenceCount: 2 },
        { term: '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406', family: 'cooperation', evidenceCount: 2 },
        { term: '\u534a\u607c', family: 'attack', evidenceCount: 2 },
        { term: '\u9f3b\u5b50\u5360\u9886\u5927\u8111', family: 'attack', evidenceCount: 2 },
        { term: '\u5e76\u975e\u5076\u9047', family: 'attack', evidenceCount: 2 },
        { term: '\u75c5\u5f2f\u94a9', family: 'attack', evidenceCount: 2 },
        { term: '\u4e0d\u670d\u618b\u7740', family: 'attack', evidenceCount: 2 },
        { term: '\u4e0d\u662f\u6760', family: 'cooperation', evidenceCount: 2 },
        { term: '\u8f66\u8f71\u8f98\u8bdd', family: 'attack', evidenceCount: 2 },
        { term: '\u5403\u53f2', family: 'attack', evidenceCount: 2 },
        { term: '\u5f73\u4e8e', family: 'cooperation', evidenceCount: 2 },
        { term: '\u5927\u8868\u732a', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 12,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u963f\u9ed1\u989c \u70ed\u8bc4',
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u53cd\u9a73 \u56de\u590d \u70ed\u8bc4',
    '\u534a\u607c \u8868\u60c5 \u56de\u590d \u70ed\u8bc4',
    '\u9f3b\u5b50\u5360\u9886\u5927\u8111 \u4e0a\u5934 \u56de\u590d \u70ed\u8bc4',
    '\u5e76\u975e\u5076\u9047 \u523b\u610f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u75c5\u5f2f\u94a9 \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u670d\u618b\u7740 \u56de\u603c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u662f\u6211\u6760 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u8f66\u8f71\u8f98\u8bdd \u91cd\u590d\u89c2\u70b9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5403\u53f2 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5f73\u4e8e \u884c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5927\u8868\u732a faze \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
});

test('buildKeywordHarvestQueries uses high-signal comment queries for next near-complete retry queue', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u5927\u75c5\u4eba', family: 'attack', evidenceCount: 2 },
        { term: '\u5178\u4e2d\u5178', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    '\u5927\u75c5\u4eba \u7cbe\u795e\u72b6\u6001 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u5178\u4e2d\u5178 \u5957\u8def \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ]);
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
      expectedAliasQuery: '\u524d\u9762\u8bf4\u91cd\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
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
      expectedAliasQuery: '\u4e0d\u53ef\u62b5\u6297\u529b \u4e0d\u53ef\u6297\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba',
      family: 'attack',
      expectedAliasQuery: '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u62d4\u7fa4',
      family: 'cooperation',
      expectedAliasQuery: '\u6548\u679c\u62d4\u7fa4 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4',
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

test('buildKeywordHarvestQueries uses latest weak miss aliases before exact stale queries', () => {
  const cases = [
    {
      term: '\u7c89\u4e1d\u7206\u7834',
      family: 'attack',
      expectedAliasQuery: '\u7206\u7834\u4f60 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5c01100\u5e74',
      family: 'absolutes',
      expectedAliasQuery: '\u5c01\u53f7100\u5e74 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u4e0d\u662f\u6760',
      family: 'cooperation',
      expectedAliasQuery: '\u4e0d\u662f\u6211\u6760 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8d1f\u5206\u6eda\u7c97',
      family: 'attack',
      expectedAliasQuery: '\u6eda\u7c97 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
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

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries avoids cable-repair noise for give-network-cable meme terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', family: 'attack', evidenceCount: 1 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 8,
      queryVariantsPerTerm: 8,
    },
  );

  assert.equal(queries.includes('\u952e\u76d8\u4fa0\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'), true);
});

test('buildKeywordHarvestQueries uses follow-up weak aliases before exact stale queries', () => {
  const cases = [
    {
      term: '\u5ddd\u5efa\u56fd',
      family: 'attack',
      expectedAliasQuery: '\u5ddd\u666e \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5ddd\u666e',
      family: 'attack',
      expectedAliasQuery: '\u7279\u6717\u666e \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u540a\u6253',
      family: 'attack',
      expectedAliasQuery: '\u5b8c\u7206 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u798f\u745e\u63a7',
      family: 'cooperation',
      expectedAliasQuery: 'furry\u63a7 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u9644\u8bae',
      family: 'cooperation',
      expectedAliasQuery: '\u81e3\u9644\u8bae \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u590d\u6d3b\u8d5b',
      family: 'attack',
      expectedAliasQuery: '\u6253\u590d\u6d3b\u8d5b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5c2c\u5230\u62a0\u811a',
      family: 'attack',
      expectedAliasQuery: '\u5c34\u5c2c\u5230\u62a0\u811a \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u8be5\u9a82\u5c31\u9a82',
      family: 'evasion',
      expectedAliasQuery: '\u8be5\u9a82\u5c31\u9a82 \u7406\u6027\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u76d6\u4e16\u592a\u4fdd',
      family: 'attack',
      expectedAliasQuery: '\u683c\u4e16\u592a\u4fdd \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u8d76\u7f9a\u7f8a',
      family: 'attack',
      expectedAliasQuery: '\u5e72\u4f60\u5a18 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u611f\u8c22\u6307\u6b63',
      family: 'correction',
      expectedAliasQuery: '\u611f\u8c22\u6307\u6b63 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5e72\u5d29\u963f',
      family: 'attack',
      expectedAliasQuery: '\u5e72\u5d29\u963fB \u8bc4\u8bba\u533a',
    },
    {
      term: '\u5e72\u8d27',
      family: 'cooperation',
      expectedAliasQuery: '\u5e72\u8d27up \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5e72\u8d27up',
      family: 'cooperation',
      expectedAliasQuery: '\u5e72\u8d27 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5965\u5229\u7ed9',
      family: 'attack',
      expectedAliasQuery: '\u5965\u529b\u7ed9 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u767e\u53d8\u9a6c\u4e01',
      family: 'cooperation',
      expectedAliasQuery: '\u9a6c\u4e01 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047',
      family: 'attack',
      expectedAliasQuery: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047 \u8bc4\u8bba',
    },
    {
      term: '\u9ad8\u7ea7jn',
      family: 'attack',
      expectedAliasQuery: '\u660e\u661f \u9ad8\u7ea7JN \u8bc4\u8bba',
    },
    {
      term: '\u6401\u8fd9\u6401\u8fd9',
      family: 'attack',
      expectedAliasQuery: '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462 \u8bc4\u8bba',
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

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
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
    '\u4e0d\u4e00\u4e00\u5217\u4e3e \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u4e00\u4e00 \u8bc4\u8bba',
  ]);
});

test('buildKeywordHarvestQueries generates higher-signal sentence-form aliases for weak absolute terms', () => {
  const cases = [
    {
      term: '100\u597d\u8bc4',
      expectedAliasQuery: '100%\u597d\u8bc4 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u767e\u5206\u767e\u597d\u8bc4\u7387',
      expectedAliasQuery: '100%\u597d\u8bc4\u7387 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '100\u6ca1\u95ee\u9898',
      expectedAliasQuery: '100%\u6ca1\u95ee\u9898 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211',
      expectedAliasQuery: '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211 \u70ed\u8bc4',
    },
    {
      term: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440',
      expectedAliasQuery: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u7edd\u5bf9\u53ef\u4ee5\u723d',
      expectedAliasQuery: '\u7edd\u5bf9\u53ef\u4ee5\u723d \u6e38\u620f \u8bc4\u8bba\u533a',
    },
    {
      term: '\u7edd\u5bf9\u53ef\u4ee5\u723d\u4e00\u4e0b',
      expectedAliasQuery: '\u7edd\u5bf9\u53ef\u4ee5\u723d \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u6beb\u65e0\u540a\u7528',
      expectedAliasQuery: '\u6ca1\u540a\u7528 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
    },
    {
      term: '\u7f57\u795e\u4f1f\u5927',
      expectedAliasQuery: '\u7f57\u795e\u4f1f\u5927 \u4e09\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5168\u662f\u5047\u7684',
      expectedAliasQuery: '\u5168\u662f\u5047\u7684 \u8f9f\u8c23 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5168\u90fd\u8fd8\u5728',
      expectedAliasQuery: '\u5168\u90fd\u8fd8\u5728 \u8001\u7c89 \u56de\u5fc6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528',
      expectedAliasQuery: '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528 \u7edd\u5bf9\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5168\u5458be',
      expectedAliasQuery: '\u5168\u5458be \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: 'absolutes', evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries broadens long absolute phrases to searchable tails', () => {
  const cases = [
    {
      term: '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d',
      expectedAliasQuery: '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d \u6570\u636e\u53ef\u89c6\u5316 \u8bc4\u8bba',
    },
    {
      term: '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b',
      expectedAliasQuery: '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c',
      expectedAliasQuery: '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c \u6c7d\u8f66 \u8bc4\u8bba',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: 'absolutes', evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries keeps vague absolute tails anchored to the original phrase', () => {
  const cases = [
    {
      term: '\u7edd\u5bf9\u4e5f\u662f',
      rejectedQuery: '\u4e5f\u662f \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
      expectedFirst: '\u7edd\u5bf9\u4e5f\u662f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7edd\u5bf9\u5e05\u54e5',
      rejectedQuery: '\u5e05\u54e5 \u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
      expectedFirst: '\u7edd\u5bf9\u5e05\u54e5 \u989c\u503c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: 'absolutes', evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries[0], item.expectedFirst);
    assert.equal(queries.includes(item.rejectedQuery), false, `${item.term} should not search generic tail ${item.rejectedQuery}`);
  }
});

test('buildKeywordHarvestQueries generates colloquial aliases for weak attack phrases', () => {
  const cases = [
    {
      term: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7',
      expectedAliasQuery: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7 \u70ed\u8bc4',
      expectedIncludedQuery: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
      expectedAliasQuery: '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u70ed\u8bc4',
    },
    {
      term: '\u5403\u4e86\u4e09\u5768\u7fd4',
      expectedAliasQuery: '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5403\u76f8\u592a\u96be\u770b',
      expectedAliasQuery: '\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u6401\u8fd9\u5462',
      expectedAliasQuery: '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462 \u8bc4\u8bba',
    },
    {
      term: '\u9ad8\u5b8c\u4e86',
      expectedAliasQuery: '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u72d7\u5c41\u4e0d\u901a',
      expectedAliasQuery: '\u72d7\u5c41\u4e0d\u901a\u7684 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5173\u4e86\u5427',
      expectedAliasQuery: '\u8fd9\u6d3b\u5173\u4e86\u5427 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u597d\u81ea\u4e3a\u4e4b',
      expectedAliasQuery: '\u597d\u81ea\u4e3a\u4e4b\u5427 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5f88\u61c2\u561b',
      expectedAliasQuery: '\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u8fd8\u6562\u53d1\u89c6\u9891',
      expectedAliasQuery: '\u8fd8\u6562\u53d1\u89c6\u9891\u5462 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u7b11\u5760\u673a',
      expectedAliasQuery: '\u7b11\u5760\u673a \u7b11\u54ed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9',
      expectedAliasQuery: '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u7cbe\u795e\u7537',
      expectedAliasQuery: '\u7cbe\u795e\u7537\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u6485\u9192',
      expectedAliasQuery: '\u6485\u9192\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u79d1\u6280\u4e0e\u72e0\u6d3b',
      expectedAliasQuery: '\u79d1\u6280\u4e0e\u72e0\u6d3b\u554a \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u523b\u8fdbdna',
      expectedAliasQuery: '\u523b\u8fdbdna\u7684 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u4eae\u8840\u6761',
      expectedAliasQuery: '\u4eae\u8840\u6761\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u8001\u62a0',
      expectedAliasQuery: '\u8001\u62a0\u6bd4 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
  ];

  for (const item of cases) {
    const queries = buildKeywordHarvestQueries(
      {
        entries: [{ term: item.term, family: 'attack', evidenceCount: 1 }],
      },
      {
        seedQueries: [],
        coverageMode: 'all-weak',
        maxQueries: 4,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
    if (item.expectedIncludedQuery) {
      assert.equal(queries.includes(item.expectedIncludedQuery), true, `${item.term} should include ${item.expectedIncludedQuery}`);
    }
  }
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
    '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302 \u70ed\u8bc4',
    '\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302 \u8bc4\u8bba',
    '\u5927\u53f7\u6ca1\u4e86 \u70ed\u8bc4',
    '\u5927\u53f7\u6ca1\u4e86 \u8bc4\u8bba',
  ]);
});

test('buildKeywordHarvestQueries starts with priority weak action aliases', () => {
  const cases = [
    {
      term: '\u4fdd\u62a4\u6211\u65b9',
      family: 'cooperation',
      expectedAliasQuery: '\u4fdd\u62a4\u6211\u65b9up \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6bd4\u515c',
      family: 'attack',
      expectedAliasQuery: '\u6bd4\u515c \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u5927\u6bd4\u515c',
      family: 'attack',
      expectedAliasQuery: '\u5927\u6bd4\u515c \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u88ab\u62e7\u75bc\u4e86',
      family: 'attack',
      expectedAliasQuery: '\u88ab\u62e7\u75bc\u4e86 \u70ed\u8bc4',
    },
    {
      term: '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c',
      family: 'attack',
      expectedAliasQuery: '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c \u8bc4\u8bba\u533a',
    },
    {
      term: '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f',
      family: 'attack',
      expectedAliasQuery: '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f \u8bc4\u8bba\u533a',
    },
    {
      term: '\u6e2f\u6ef4\u5bf9',
      family: 'cooperation',
      expectedAliasQuery: '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5 \u8bc4\u8bba\u533a',
    },
    {
      term: '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5',
      family: 'cooperation',
      expectedAliasQuery: '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1 \u8bc4\u8bba',
    },
    {
      term: '\u6760\u7cbe',
      family: 'attack',
      expectedAliasQuery: '\u6760\u7cbe \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
    },
    {
      term: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047',
      family: 'attack',
      expectedAliasQuery: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047 \u8bc4\u8bba',
    },
    {
      term: '\u9ad8\u7ea7jn',
      family: 'attack',
      expectedAliasQuery: '\u660e\u661f \u9ad8\u7ea7JN \u8bc4\u8bba',
    },
    {
      term: '\u6401\u8fd9\u5462',
      family: 'attack',
      expectedAliasQuery: '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462 \u8bc4\u8bba',
    },
    {
      term: '\u4e2a\u7b7e',
      family: 'cooperation',
      expectedAliasQuery: '\u6211\u7684\u4e2a\u7b7e\u4e5f\u662f \u8bc4\u8bba',
    },
    {
      term: '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929',
      family: 'attack',
      expectedAliasQuery: '\u952e\u76d8\u4fa0 \u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929 \u70ed\u8bc4',
    },
    {
      term: '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5',
      family: 'attack',
      expectedAliasQuery: '\u704c\u94c5\u7b5b\u5b50 \u70ed\u8bc4',
    },
    {
      term: '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5',
      family: 'attack',
      expectedAliasQuery: '\u704c\u94c5\u9ab0\u5b50 \u70ed\u8bc4',
    },
    {
      term: '\u7ed9\u7237\u722c',
      family: 'attack',
      expectedAliasQuery: '\u7ed9\u7237\u722c \u8bc4\u8bba',
    },
    {
      term: '\u7ed9\u7237\u6574\u5b5d\u4e86',
      family: 'attack',
      expectedAliasQuery: '\u7ed9\u7237\u6574\u5b5d\u4e86 \u8bc4\u8bba',
    },
    {
      term: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c',
      family: 'absolutes',
      expectedAliasQuery: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440 \u8bc4\u8bba',
    },
    {
      term: '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8',
      family: 'absolutes',
      expectedAliasQuery: '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8 \u8bc4\u8bba',
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
        maxQueries: 8,
        queryVariantsPerTerm: 4,
      },
    );

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
  }
});

test('buildKeywordHarvestQueries starts with comment aliases for current zero-evidence terms', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '0\u63d0\u5347', family: 'cooperation', evidenceCount: 0 },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', evidenceCount: 0 },
        { term: '12300\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', evidenceCount: 0 },
        { term: '2026\u6253\u5361', family: 'evasion', evidenceCount: 0 },
        { term: '\u57c3\u53ca\u5427', family: 'evasion', evidenceCount: 0 },
        { term: '\u7231\u548b\u548b\u5730', family: 'evasion', evidenceCount: 0 },
        { term: '\u767e\u5ea6\u767e\u79d1', family: 'evidence', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 28,
      queryVariantsPerTerm: 4,
      targetEvidence: 3,
    },
  );

  assert.equal(queries.includes('\u96f6\u63d0\u5347 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u5341\u5e74\u8001\u7c89 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a'), true);
  assert.equal(queries.includes('\u5de5\u4fe1\u90e8\u6295\u8bc9 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a'), true);
  assert.equal(queries.includes('\u6253\u53612026 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u57c3\u53ca\u5427\u8001\u54e5 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u968f\u4fbf\u4f60\u7231\u548b\u548b\u5730 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4'), true);
  assert.equal(queries.includes('\u767e\u5ea6\u767e\u79d1\u6709\u5199 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a'), true);
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

test('buildKeywordHarvestQueries avoids noisy literal searches for obfuscated and ambiguous weak terms', () => {
  const cases = [
    {
      term: '\u5de5\u91cdhao',
      family: 'evasion',
      expectedAliasQuery: '\u5de5\u91cd\u53f7 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      noisyFragment: 'hao',
    },
    {
      term: '\u516c\u5f0f\u5957\u53cd\u4e86',
      family: 'correction',
      expectedAliasQuery: '\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      noisyFragment: '\u5b89\u5168\u5957',
    },
    {
      term: '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af',
      family: 'attack',
      expectedAliasQuery: '\u6211\u5bb6\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u516c\u5b50\u4eec\u53ef\u4ee5',
    },
    {
      term: '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728',
      family: 'attack',
      expectedAliasQuery: '\u6d6e\u6728\u4fa0 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u653b\u51fb\u4ed6\u4eba',
    },
    {
      term: '\u72d7\u5c4e\u673a\u5236',
      family: 'attack',
      expectedAliasQuery: '\u72d7\u5c4e\u5339\u914d\u673a\u5236 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u72d7\u5c4e\u5f62\u6001',
    },
    {
      term: '\u82df\u76841b',
      family: 'attack',
      expectedAliasQuery: '\u592a\u82df\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u82df\u7740',
    },
    {
      term: '\u53e4\u5c38\u7ea7',
      family: 'attack',
      expectedAliasQuery: '\u9aa8\u7070\u7ea7 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u53e4\u5c38',
    },
    {
      term: '\u62d0\u53cb\u5546',
      family: 'evasion',
      expectedAliasQuery: '\u62ffDNF\u6765\u62d0 \u53cb\u5546 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      noisyFragment: '\u62d0\u53cb\u5546',
    },
    {
      term: '\u5173\u4e86\u5427',
      family: 'attack',
      expectedAliasQuery: '\u8fd9\u6d3b\u5173\u4e86\u5427 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u6709\u610f\u601d',
    },
    {
      term: '\u5173\u4e86\u5427\u6ca1\u610f\u601d',
      family: 'attack',
      expectedAliasQuery: '\u8fd9\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u5047\u5531',
    },
    {
      term: '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19',
      family: 'cooperation',
      expectedAliasQuery: '\u5e7f\u897f\u7cbe\u795e\u5c0f\u4f19\u523b\u677f\u5370\u8c61 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
      noisyFragment: '\u5e7f\u897f\u75ab\u60c5',
    },
    {
      term: '\u8d35\u5bbe\u5f52\u96f6',
      family: 'attack',
      expectedAliasQuery: '\u798f\u888b\u4e00\u505c\u8d35\u5bbe\u5f52\u96f6 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
      noisyFragment: 'Bitcoin',
    },
    {
      term: '\u56fd\u9645\u5b85\u7537\u8054\u76df',
      family: 'attack',
      expectedAliasQuery: '\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      noisyFragment: '\u5b85\u7537\u9996\u76f8',
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

    assert.equal(queries[0], item.expectedAliasQuery, `${item.term} should start with ${item.expectedAliasQuery}`);
    assert.equal(queries[0].includes(item.noisyFragment), false, `${item.term} first query should avoid ${item.noisyFragment}`);
  }
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
    'weakC 回复 评论区 热评',
    'weakB 评论区 梗 热评',
    'weakA 评论区 梗 热评',
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

test('buildKeywordHarvestQueryPlan rotates repeated comment misses behind unattempted terms', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'commentMissed', family: 'attack', evidenceCount: 1 },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      retryBeforeUnattemptedLimit: 3,
      termAttempts: {
        commentMissed: {
          term: 'commentMissed',
          evidenceAtPlanTime: 1,
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'commentMissed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 12 },
            { query: 'commentMissed \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 8 },
            { query: 'commentMissed \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 10 },
          ],
        },
      },
    },
  );

  assert.deepEqual(plan.map((item) => item.term), ['freshWeak', 'freshWeak']);
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

test('summarizeTermAttempts ignores stale harvest strategy attempts', () => {
  const summary = summarizeTermAttempts(
    {
      harvestStrategyVersion: 4,
      termAttempts: {
        doge: { term: 'doge', family: 'cooperation', attempts: 99, successfulAttempts: 0, lastQuery: 'doge \u8bc4\u8bba\u533a' },
      },
    },
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 1 },
        { term: 'yygq', family: 'attack', evidenceCount: 0 },
      ],
    },
  );

  assert.equal(summary.attemptedTerms, 0);
  assert.equal(summary.successfulTerms, 0);
  assert.equal(summary.unattemptedTerms, 2);
  assert.deepEqual(summary.repeatedlyMissedTerms, []);
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

test('buildCoverageActions tries own variants before related contained terms after a miss', () => {
  const actions = buildCoverageActions(
    {
      entries: [
        { term: '\u6bd4\u515c', family: 'attack', evidenceCount: 2, evidenceSources: [{ source: 'Bilibili public comment', sample: '\u6bd4\u515c' }] },
        { term: '\u5927\u6bd4\u515c', family: 'attack', evidenceCount: 2, evidenceSources: [{ source: 'Bilibili public comment', sample: '\u5927\u6bd4\u515c' }] },
      ],
    },
    {
      harvestStrategyVersion: 6,
      searchedQueries: ['\u5927\u6bd4\u515c \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'],
      termAttempts: {
        [Buffer.from('\u6bd4\u515c', 'utf8').toString('base64url')]: {
          term: '\u6bd4\u515c',
          family: 'attack',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '\u5927\u6bd4\u515c \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', hit: false }],
        },
      },
    },
    { targetEvidence: 3, queryVariantsPerTerm: 4, requireCommentBackedEvidence: true },
  );

  const action = actions.find((item) => item.term === '\u6bd4\u515c');
  assert.equal(action.action, 'retry_with_new_variant');
  assert.equal(action.nextQuery, '\u6bd4\u515c \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildCoverageActions retries alias comment queries earlier after scaffold misses', () => {
  const actions = buildCoverageActions(
    {
      entries: [{ term: '\u4fdd\u62a4\u6211\u65b9', family: 'cooperation', evidenceCount: 2, evidenceSources: [{ source: 'Bilibili public comment', sample: '\u4fdd\u62a4\u6211\u65b9' }] }],
    },
    {
      harvestStrategyVersion: 6,
      termAttempts: {
        [Buffer.from('\u4fdd\u62a4\u6211\u65b9', 'utf8').toString('base64url')]: {
          term: '\u4fdd\u62a4\u6211\u65b9',
          family: 'cooperation',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '\u4fdd\u62a4\u6211\u65b9up \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4', hit: false }],
        },
      },
    },
    { targetEvidence: 3, queryVariantsPerTerm: 6, requireCommentBackedEvidence: true },
  );

  const action = actions.find((item) => item.term === '\u4fdd\u62a4\u6211\u65b9');
  assert.equal(action.nextQuery, '\u4fdd\u62a4\u6211\u65b9up \u8bc4\u8bba\u533a');
});

test('buildCoverageActions starts strict comment-backed weak terms with short comment searches', () => {
  const actions = buildCoverageActions(
    {
      entries: [
        {
          term: '\u79d1\u6280\u4e0e\u72e0\u6d3b',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVsample', sample: '\u79d1\u6280\u4e0e\u72e0\u6d3b' }],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireCommentBackedEvidence: true },
  );

  assert.equal(actions[0].status, 'weak_unattempted');
  assert.equal(actions[0].nextQuery, '\u79d1\u6280\u4e0e\u72e0\u6d3b \u8bc4\u8bba\u533a');
  assert.notEqual(actions[0].nextQuery, '\u79d1\u6280\u4e0e\u72e0\u6d3b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit prioritizes near-complete weak terms within the same action class', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: '\u4e00\u6761\u8bc1\u636e\u8bcd',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BVone', sample: '\u4e00\u6761\u8bc1\u636e\u8bcd' }],
        },
        {
          term: '\u4e24\u6761\u8bc1\u636e\u8bcd',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            { source: 'Bilibili public video comment scan', uid: 'BVtwo1', sample: '\u4e24\u6761\u8bc1\u636e\u8bcd sample 1' },
            { source: 'Bilibili public video comment scan', uid: 'BVtwo2', sample: '\u4e24\u6761\u8bc1\u636e\u8bcd sample 2' },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.nextActions[0].term, '\u4e24\u6761\u8bc1\u636e\u8bcd');
  assert.equal(audit.nextActions[0].evidenceNeeded, 1);
});

test('buildKeywordHarvestQueries starts with near-complete weak terms in all-weak mode', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: '\u4e00\u6761\u8bc1\u636e\u8bcd', family: 'attack', evidenceCount: 1 },
        { term: '\u4e24\u6761\u8bc1\u636e\u8bcd', family: 'attack', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 1,
      targetEvidence: 3,
    },
  );

  assert.equal(queries[0], '\u4e24\u6761\u8bc1\u636e\u8bcd \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4');
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

test('buildDictionaryCoverageAudit rotates repeated comment misses after unattempted weak terms', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: 'commentMissed', family: 'attack', evidenceCount: 1 },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        commentMissed: {
          term: 'commentMissed',
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 3,
          successfulAttempts: 0,
          queries: [
            { query: 'commentMissed \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 12 },
            { query: 'commentMissed \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 8 },
            { query: 'commentMissed \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 10 },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshWeak', 'commentMissed']);
  assert.equal(audit.nextActions[1].currentCommentMisses, 3);
});

test('buildDictionaryCoverageAudit defers backed strict comment misses after repeated scans', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'backedCommentMissed',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            { source: 'Bilibili public video comment scan', uid: 'BVbacked1', sample: 'backedCommentMissed sample 1' },
            { source: 'Bilibili public video comment scan', uid: 'BVbacked2', sample: 'backedCommentMissed sample 2' },
          ],
        },
        { term: 'freshStrictWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        backedCommentMissed: {
          term: 'backedCommentMissed',
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 3,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: 'backedCommentMissed \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 240 },
            { query: 'backedCommentMissed \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 180 },
            { query: 'backedCommentMissed \u56de\u590d', strategyVersion: 6, ok: true, hit: false, comments: 220 },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshStrictWeak', 'backedCommentMissed']);
});

test('buildDictionaryCoverageAudit rotates backed strict comment misses after one current scan miss', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: 'partialHit', family: 'attack', evidenceCount: 2 },
        {
          term: 'backedOnceMissed',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            { source: 'Bilibili public video comment scan', uid: 'BVbacked1', sample: 'backedOnceMissed sample 1' },
            { source: 'Bilibili public video comment scan', uid: 'BVbacked2', sample: 'backedOnceMissed sample 2' },
          ],
        },
        { term: 'freshStrictWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        partialHit: {
          term: 'partialHit',
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 1,
          successfulAttempts: 1,
          lastEvidenceCount: 2,
          queries: [{ query: 'partialHit \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: true, comments: 80 }],
        },
        backedOnceMissed: {
          term: 'backedOnceMissed',
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 1,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [{ query: 'backedOnceMissed \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 64 }],
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3, requireCommentBackedEvidence: true },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshStrictWeak', 'partialHit']);
  assert.equal(audit.nextActions.some((item) => item.term === 'backedOnceMissed'), false);
});

test('buildDictionaryCoverageAudit lets zero-evidence retries pass already-backed comment misses', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'backedMiss',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            { source: 'Bilibili public video comment scan', uid: 'BVbacked1', sample: 'backedMiss sample 1' },
            { source: 'Bilibili public video comment scan', uid: 'BVbacked2', sample: 'backedMiss sample 2' },
          ],
        },
        { term: 'zeroMiss', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        backedMiss: {
          term: 'backedMiss',
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'backedMiss \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 24 }],
          lastQuery: 'backedMiss \u8bc4\u8bba\u533a',
        },
        zeroMiss: {
          term: 'zeroMiss',
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'zeroMiss \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 20 }],
          lastQuery: 'zeroMiss \u8bc4\u8bba\u533a',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['zeroMiss', 'backedMiss']);
});

test('buildDictionaryCoverageAudit rotates no-video discovery misses after retry limit behind fresh weak terms', () => {
  const missed = 'noVideoMiss';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: missed, family: 'attack', evidenceCount: 1 },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        [missed]: {
          term: missed,
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 1,
          successfulAttempts: 0,
          queries: [
            {
              query: 'noVideoMiss \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
              strategyVersion: 6,
              ok: false,
              hit: false,
              videos: 0,
              comments: 0,
              error: 'No Bilibili videos were discovered from the backend discovery mode.',
            },
          ],
          lastQuery: 'noVideoMiss \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
          lastError: 'No Bilibili videos were discovered from the backend discovery mode.',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshWeak', missed]);
  assert.equal(audit.nextActions[1].nextQuery, 'noVideoMiss \u8bc4\u8bba\u533a');
});

test('buildDictionaryCoverageAudit rotates timeout-heavy retries behind partial evidence refreshes', () => {
  const timeoutTerm = 'timeoutHeavy';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: timeoutTerm, family: 'attack', evidenceCount: 0 },
        { term: 'partialEvidence', family: 'attack', evidenceCount: 1, evidenceSamples: ['partialEvidence sample'] },
      ],
    },
    {
      termAttempts: {
        [timeoutTerm]: {
          term: timeoutTerm,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 2,
          successfulAttempts: 0,
          queries: [
            {
              query: 'timeoutHeavy \u8bc4\u8bba\u533a',
              strategyVersion: 6,
              ok: false,
              hit: false,
              videos: 0,
              comments: 0,
              error: 'Bilibili harvest query "timeoutHeavy \u8bc4\u8bba\u533a" timed out after 35000ms',
            },
          ],
          lastQuery: 'timeoutHeavy \u8bc4\u8bba\u533a',
          lastError: 'Bilibili harvest query "timeoutHeavy \u8bc4\u8bba\u533a" timed out after 35000ms',
        },
        partialEvidence: {
          term: 'partialEvidence',
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 1,
          successfulAttempts: 1,
          lastEvidenceCount: 1,
          queries: [{ query: 'partialEvidence \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: true, videos: 1, comments: 24 }],
          lastQuery: 'partialEvidence \u8bc4\u8bba\u533a',
          lastError: '',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['partialEvidence', timeoutTerm]);
});

test('buildDictionaryCoverageAudit rotates repeated no-video zero-evidence misses behind fresh weak terms', () => {
  const missed = 'repeatedNoVideo';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: missed, family: 'attack', evidenceCount: 0 },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        [missed]: {
          term: missed,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 4,
          successfulAttempts: 0,
          queries: [
            {
              query: 'repeatedNoVideo \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
              strategyVersion: 6,
              ok: false,
              hit: false,
              videos: 0,
              comments: 0,
              error: 'No Bilibili videos were discovered from the backend discovery mode.',
            },
            {
              query: 'repeatedNoVideo \u8bc4\u8bba\u533a',
              strategyVersion: 6,
              ok: false,
              hit: false,
              videos: 0,
              comments: 0,
              error: 'No Bilibili videos were discovered from the backend discovery mode.',
            },
          ],
          lastQuery: 'repeatedNoVideo \u8bc4\u8bba\u533a',
          lastError: 'No Bilibili videos were discovered from the backend discovery mode.',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshWeak', missed]);
});

test('buildDictionaryCoverageAudit rotates hard zero-evidence comment misses behind fresh weak terms', () => {
  const missed = 'commentScannedNoHit';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: missed, family: 'attack', evidenceCount: 0 },
        { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        [missed]: {
          term: missed,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 8,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            {
              query: 'commentScannedNoHit \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
              strategyVersion: 6,
              ok: true,
              hit: false,
              videos: 6,
              comments: 1469,
              error: '',
            },
          ],
          lastQuery: 'commentScannedNoHit \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
          lastError: '',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['freshWeak', missed]);
});

test('buildDictionaryCoverageAudit demotes saturated zero-evidence comment misses behind fresher retries', () => {
  const saturated = 'saturatedCommentMiss';
  const fresher = 'fresherCommentMiss';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: saturated, family: 'attack', evidenceCount: 0 },
        { term: fresher, family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        [saturated]: {
          term: saturated,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 5,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: 'saturatedCommentMiss \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 80 },
            { query: 'saturatedCommentMiss \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 90 },
            { query: 'saturatedCommentMiss \u56de\u590d', strategyVersion: 6, ok: true, hit: false, comments: 70 },
          ],
          lastQuery: 'saturatedCommentMiss \u56de\u590d',
        },
        [fresher]: {
          term: fresher,
          family: 'attack',
          evidenceAtPlanTime: 0,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: 'fresherCommentMiss \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, comments: 32 },
            { query: 'fresherCommentMiss \u70ed\u8bc4', strategyVersion: 6, ok: true, hit: false, comments: 24 },
          ],
          lastQuery: 'fresherCommentMiss \u70ed\u8bc4',
        },
      },
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), [fresher, saturated]);
});

test('buildDictionaryCoverageAudit treats stale duplicate-evidence successes as misses', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term: 'duplicateHit', family: 'attack', evidenceCount: 1 }],
    },
    {
      termAttempts: {
        duplicateHit: {
          term: 'duplicateHit',
          family: 'attack',
          evidenceAtPlanTime: 1,
          attempts: 1,
          successfulAttempts: 1,
          lastEvidenceCount: 1,
          queries: [
            {
              query: 'duplicateHit \u70ed\u8bc4',
              strategyVersion: 6,
              ok: true,
              hit: true,
              videos: 10,
              comments: 100,
              error: '',
            },
          ],
        },
      },
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.termAttemptSummary.successfulTerms, 0);
  assert.equal(audit.nextActions[0].term, 'duplicateHit');
  assert.equal(audit.nextActions[0].status, 'weak_missed');
  assert.equal(audit.nextActions[0].successfulAttempts, 0);
});

test('buildDictionaryCoverageAudit defers duplicate accepted no-progress retries behind fresh weak terms', () => {
  const duplicateTerm = 'duplicateAccepted';
  const freshTerm = 'freshWeak';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: duplicateTerm, family: 'attack', evidenceCount: 2 },
        { term: freshTerm, family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      termAttempts: {
        [duplicateTerm]: {
          term: duplicateTerm,
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 3,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            {
              query: 'duplicateAccepted \u70ed\u8bc4',
              strategyVersion: 6,
              ok: true,
              hit: false,
              videos: 8,
              comments: 120,
              error: '',
            },
          ],
        },
      },
      runs: [
        {
          acceptedEvidenceCount: 1,
          coverageIncreasingAcceptedEvidenceCount: 0,
          queryDiagnostics: [
            {
              query: 'duplicateAccepted \u70ed\u8bc4',
              targetExistingTerms: [duplicateTerm],
              acceptedTerms: [duplicateTerm],
              commentsCollected: 120,
            },
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 2, retryBeforeUnattemptedLimit: 3 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), [freshTerm, duplicateTerm]);
  assert.equal(audit.nextActions[1].duplicateAcceptedNoProgress, true);
});

test('buildDictionaryCoverageAudit defers compact metric fragments behind discourse terms', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '10r', family: 'evidence', evidenceCount: 0 },
        { term: '3TP', family: 'evidence', evidenceCount: 0 },
        { term: '0\u63d0\u5347', family: 'cooperation', evidenceCount: 0 },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', evidenceCount: 0 },
        { term: '\u6760\u7cbe', family: 'attack', evidenceCount: 0 },
        { term: '\u6d17\u5730', family: 'evasion', evidenceCount: 0 },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, maxActions: 6 },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), ['10\u5e74\u8001\u7c89', '\u6760\u7cbe', '\u6d17\u5730', '3TP', '10r', '0\u63d0\u5347']);
  assert.equal(audit.recommendedQueries[0], '10\u5e74\u8001\u7c89 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4');
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

test('buildDictionaryCoverageAudit treats comment-backed mode as source-backed mode', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 2,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: 'Bilibili video context: contextOnly from a video title',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.requireSourceBackedEvidence, true);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 1);
  assert.equal(audit.nextActions[0].status, 'source_gap');
  assert.equal(audit.nextActions[0].action, 'refresh_source_metadata');
  assert.equal(audit.nextActions[0].evidenceNeeded, 3);
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

test('buildDictionaryCoverageAudit treats comment samples from mixed context scans as weak comment-backed evidence', () => {
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
  assert.equal(audit.coverage.totalEvidence, 1);
  assert.equal(audit.nextActions[0].term, 'commentSample');
  assert.equal(audit.nextActions[0].coverageEvidenceCount, 1);
});

test('buildDictionaryCoverageAudit treats non-context samples with Bilibili source metadata as weak comment-backed evidence', () => {
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
  assert.equal(audit.coverage.totalEvidence, 1);
  assert.equal(audit.nextActions[0].term, 'commentSampleOnly');
  assert.equal(audit.nextActions[0].coverageEvidenceCount, 1);
});

test('buildDictionaryCoverageAudit does not count video-title object evidence as comment-backed evidence', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'titleOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSamples: ['Bilibili public video title: titleOnly appears only in the video title'],
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan plus video object evidence: https://www.bilibili.com/video/BVtitle/',
              uid: 'BVtitle',
              sample: 'Bilibili public video title: titleOnly appears only in the video title',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.coverage.sourcedEvidenceTerms, 0);
  assert.equal(audit.coverage.unsourcedEvidenceTerms, 1);
  assert.equal(audit.nextActions[0].term, 'titleOnly');
  assert.equal(audit.nextActions[0].status, 'source_gap');
  assert.equal(audit.nextActions[0].coverageEvidenceCount, 0);
});

test('buildDictionaryCoverageAudit counts only comment samples when title evidence is mixed in', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term: 'mixedTitle',
          family: 'attack',
          evidenceCount: 3,
          evidenceSamples: ['real comment mixedTitle', 'Bilibili public video title: mixedTitle title only'],
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVcomment/',
              uid: 'BVcomment',
              sample: 'real comment mixedTitle',
            },
            {
              source: 'Bilibili public search-discovered video comment scan plus video object evidence: https://www.bilibili.com/video/BVtitle/',
              uid: 'BVtitle',
              sample: 'Bilibili public video title: mixedTitle title only',
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    { targetEvidence: 3, requireSourceBackedEvidence: true, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.coverage.totalEvidence, 1);
  assert.equal(audit.coverage.weakTerms, 1);
  assert.equal(audit.nextActions[0].term, 'mixedTitle');
  assert.equal(audit.nextActions[0].coverageEvidenceCount, 1);
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
  assert.equal(audit.recommendedQueries[0], 'contextOnly \u8bc4\u8bba\u533a');
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
          queries: [{ query: '\u8f66\u5bb6\u519b \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, videos: 4, comments: 20 }],
        },
        [Buffer.from('\u95ee\u767e\u5ea6', 'utf8').toString('base64url')]: {
          term: '\u95ee\u767e\u5ea6',
          family: 'evasion',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: '\u95ee\u767e\u5ea6 \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, videos: 2, comments: 7 }],
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
  assert.equal(audit.nextActions[0].nextQuery, 'sourceGap \u56de\u590d');
  assert.equal(audit.recommendedQueries[0].includes('\u662f\u4ec0\u4e48\u6897'), false);
});

test('buildDictionaryCoverageAudit treats danmaku searches as comment-backed source refreshes', () => {
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
      termAttempts: {
        sourceGap: {
          term: 'sourceGap',
          attempts: 4,
          successfulAttempts: 0,
          queries: [
            { query: 'sourceGap 评论区 梗 热评' },
            { query: 'sourceGap 评论区' },
            { query: 'sourceGap 热评' },
            { query: 'sourceGap 回复' },
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
  assert.equal(audit.nextActions[0].nextQuery, 'sourceGap 弹幕');
});

test('buildDictionaryCoverageAudit prefers literal source-gap comment queries before aliases', () => {
  const term = '\u95ee\u767e\u5ea6';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        {
          term,
          family: 'evasion',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVcontext/',
              uid: 'BVcontext',
              sample: `Bilibili video context: ${term}`,
            },
          ],
        },
      ],
    },
    { termAttempts: {} },
    {
      targetEvidence: 3,
      requireSourceBackedEvidence: true,
      requireCommentBackedEvidence: true,
      prioritizeSourceGaps: true,
    },
  );

  assert.equal(audit.nextActions[0].status, 'source_gap');
  assert.equal(audit.nextActions[0].nextQuery, '\u95ee\u767e\u5ea6 \u8bc4\u8bba\u533a');
  assert.notEqual(audit.nextActions[0].nextQuery, '\u4e0d\u4f1a\u767e\u5ea6 \u8bc4\u8bba\u533a');
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
              strategyVersion: 6,
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
              strategyVersion: 6,
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
              strategyVersion: 6,
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

test('buildDictionaryCoverageAudit diversifies common suffix duplicate groups', () => {
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [
        { term: '\u4eae\u8840\u6761', family: 'attack', evidenceCount: 2 },
        { term: '\u4eae\u8840\u6761\u4e86', family: 'attack', evidenceCount: 2 },
        { term: '\u6485\u9192', family: 'cooperation', evidenceCount: 2 },
        { term: '\u6485\u9192\u4eba', family: 'cooperation', evidenceCount: 2 },
        { term: '\u753b\u997c', family: 'attack', evidenceCount: 2 },
      ],
    },
    {},
    {
      targetEvidence: 3,
      maxActions: 3,
    },
  );

  assert.deepEqual(audit.nextActions.map((item) => item.term), [
    '\u753b\u997c',
    '\u6485\u9192',
    '\u4eae\u8840\u6761',
  ]);
  assert.equal(audit.nextActions.find((item) => item.term === '\u6485\u9192').recommendationGroup, '\u6485\u9192');
  assert.equal(audit.nextActions.some((item) => item.term === '\u6485\u9192\u4eba'), false);
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

test('buildDictionaryCoverageAudit rewrites hard misses when only unrelated terms were accepted', () => {
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
          attempts: 8,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4' },
            { query: '\u7c73\u7c89\u63a7\u8bc4 SU7' },
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
                targetExistingTerms: [term],
                acceptedTerms: ['doge', '\u786e\u5b9e', '\u54c8\u54c8'],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 3 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a');
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

test('buildDictionaryCoverageAudit treats unrelated accepted terms as target miss feedback', () => {
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
                commentsCollected: 22,
                trainingTextChars: 2048,
                targetExistingTerms: [term],
                acceptedTerms: ['doge', '\u786e\u5b9e', '\u54c8\u54c8'],
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
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u8bc4\u8bba\u533a', strategyVersion: 6 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u70ed\u8bc4', strategyVersion: 6 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d', strategyVersion: 6 },
            { query: '\u4e0d\u4f1a\u767e\u5ea6', strategyVersion: 6 },
            { query: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', strategyVersion: 6 },
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

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u89c6\u9891\u6807\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4`);
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
            { query: `${term} \u8bc4\u8bba\u533a`, strategyVersion: 6, ok: false, hit: false },
            { query: `${term} \u70ed\u8bc4`, strategyVersion: 6, ok: false, hit: false },
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

test('buildDictionaryCoverageAudit keeps priority aliases after filtered misses for known retry terms', () => {
  const term = '\u5927\u75c5\u4eba';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 2 }],
    },
    {
      termAttempts: {
        [Buffer.from(term, 'utf8').toString('base64url')]: {
          term,
          family: 'attack',
          evidenceAtPlanTime: 2,
          attempts: 2,
          successfulAttempts: 0,
          lastEvidenceCount: 0,
          queries: [
            { query: `${term} \u8bc4\u8bba\u533a`, strategyVersion: 6, ok: true, hit: false },
            { query: `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`, strategyVersion: 6, ok: true, hit: false },
          ],
          lastQuery: `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`,
        },
      },
      runs: [
        {
          queryDiagnostics: [
            [
              {
                query: `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`,
                discoveredVideos: 4,
                discoveryContextVideos: 8,
                scannedVideos: 4,
                commentsCollected: 24,
                trainingTextChars: 500,
                targetExistingTerms: [term],
                acceptedTerms: [],
                sampleVideos: [{ title: '\u7cbe\u795e\u72b6\u6001\u5927\u75c5\u4eba' }],
              },
            ],
          ],
        },
      ],
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u5927\u75c5\u4eba \u7cbe\u795e\u72b6\u6001 \u8bc4\u8bba\u533a \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit keeps high-signal follow-up priority aliases after first priority misses', () => {
  const cases = [
    {
      term: '\u5927\u75c5\u4eba',
      family: 'attack',
      triedQuery: '\u5927\u75c5\u4eba \u7cbe\u795e\u72b6\u6001 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: 'kpk \u5927\u75c5\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5178\u4e2d\u5178',
      family: 'attack',
      triedQuery: '\u5178\u4e2d\u5178 \u5957\u8def \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5178\u4e2d\u5178\u8d77\u624b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5f73\u4e8e',
      family: 'cooperation',
      triedQuery: '\u5f73\u4e8e \u884c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5f73\u4e8e\u6cd5 \u6559\u5b66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];
  const state = { termAttempts: {}, runs: [{ queryDiagnostics: [] }] };
  const entries = [];
  for (const item of cases) {
    entries.push({ term: item.term, family: item.family, evidenceCount: 2 });
    state.termAttempts[Buffer.from(item.term, 'utf8').toString('base64url')] = {
      term: item.term,
      family: item.family,
      evidenceAtPlanTime: 2,
      attempts: 1,
      successfulAttempts: 0,
      lastEvidenceCount: 0,
      queries: [{ query: item.triedQuery, strategyVersion: 6, ok: true, hit: false }],
      lastQuery: item.triedQuery,
    };
    state.runs[0].queryDiagnostics.push([
      {
        query: item.triedQuery,
        discoveredVideos: 4,
        scannedVideos: 4,
        commentsCollected: 20,
        trainingTextChars: 500,
        targetExistingTerms: [item.term],
        acceptedTerms: [],
      },
    ]);
  }

  const audit = buildDictionaryCoverageAudit({ entries }, state, { targetEvidence: 3, maxActions: 3 });
  const byTerm = Object.fromEntries(audit.nextActions.map((action) => [action.term, action]));
  for (const item of cases) {
    assert.equal(byTerm[item.term].nextQuery, item.nextQuery);
  }
});

test('buildDictionaryCoverageAudit keeps high-signal follow-up aliases for current zero-evidence misses', () => {
  const cases = [
    {
      term: '\u6389\u5c0f\u73cd\u73e0',
      family: 'cooperation',
      triedQuery: '\u6389\u5c0f\u73cd\u73e0 \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u770b\u54ed\u4e86\u6389\u5c0f\u73cd\u73e0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u61c2\u5f97\u81ea\u7136\u61c2',
      family: 'evasion',
      triedQuery: '\u61c2\u5f97\u81ea\u7136\u61c2 \u8c1c\u8bed\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u61c2\u7684\u81ea\u7136\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u61c2\u4e86\u5427',
      family: 'evasion',
      triedQuery: '\u61c2\u4e86\u5427 \u8c1c\u8bed\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e0b\u61c2\u4e86\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u611f\u8c22\u6307\u6b63',
      family: 'correction',
      triedQuery: '\u611f\u8c22\u6307\u6b63 \u66f4\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8c22\u8c22\u6307\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5de5\u91cdhao',
      family: 'evasion',
      triedQuery: '\u5de5\u91cd\u53f7 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u516c\u4f17\u53f7 \u5f15\u6d41 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5bab\u9888\u7cdc\u70c2',
      family: 'attack',
      triedQuery: '\u5bab\u9888\u7cdc\u70c2 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5bab\u9888\u7cdc\u70c2\u4e0d\u662f\u75c5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u62d0\u53cb\u5546',
      family: 'attack',
      triedQuery: '\u62ffDNF\u6765\u62d0 \u53cb\u5546 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u62ff\u53cb\u5546\u6765\u62d0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u602a\u6211\u54af',
      family: 'evasion',
      triedQuery: '\u602a\u6211\u54af \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e5f\u602a\u6211\u54af \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];
  const state = { termAttempts: {}, runs: [{ queryDiagnostics: [] }] };
  const entries = [];
  for (const item of cases) {
    entries.push({ term: item.term, family: item.family, evidenceCount: 0 });
    state.termAttempts[Buffer.from(item.term, 'utf8').toString('base64url')] = {
      term: item.term,
      family: item.family,
      evidenceAtPlanTime: 0,
      attempts: 1,
      successfulAttempts: 0,
      queries: [{ query: item.triedQuery, strategyVersion: 6, ok: true, hit: false, comments: 20 }],
      lastQuery: item.triedQuery,
    };
    state.runs[0].queryDiagnostics.push([
      {
        query: item.triedQuery,
        discoveredVideos: 4,
        scannedVideos: 4,
        commentsCollected: 20,
        trainingTextChars: 500,
        targetExistingTerms: [item.term],
        acceptedTerms: [],
      },
    ]);
  }

  const audit = buildDictionaryCoverageAudit(
    { entries },
    state,
    { targetEvidence: 3, maxActions: cases.length, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );
  const byTerm = Object.fromEntries(audit.nextActions.map((action) => [action.term, action]));
  for (const item of cases) {
    assert.equal(byTerm[item.term].nextQuery, item.nextQuery);
  }
});

test('buildDictionaryCoverageAudit keeps high-signal follow-up aliases for next zero-evidence misses', () => {
  const cases = [
    {
      term: '\u8352\u91ce\u5927\u8fea\u5ba2',
      family: 'attack',
      triedQuery: '\u8352\u91ce\u5927\u8fea\u5ba2 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8352\u91ce\u5927\u8fea\u5ba2 \u8352\u91ce\u5927\u9556\u5ba2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7687\u4e0a',
      family: 'attack',
      triedQuery: '\u7687\u4e0a \u5723\u65e8 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u7687\u4e0a\u5723\u660e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5',
      family: 'evasion',
      triedQuery: '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5 \u5b54\u4e59\u5df1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5b54\u4e59\u5df1 \u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6d3b\u52a8\u771f\u5b9e\u6709\u6548',
      family: 'evidence',
      triedQuery: '\u6d3b\u52a8\u771f\u5b9e\u6709\u6548 \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u62bd\u5956\u771f\u5b9e\u6709\u6548 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5373\u6b7b',
      family: 'attack',
      triedQuery: '\u5373\u6b7b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u89e6\u53d1\u5373\u6b7b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6781\u9650\u6a21\u5f0f',
      family: 'attack',
      triedQuery: '\u6781\u9650\u6a21\u5f0f \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5f00\u542f\u6781\u9650\u6a21\u5f0f \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u96c6\u7f8e\u529d\u5220',
      family: 'attack',
      triedQuery: '\u96c6\u7f8e\u529d\u5220 \u5c0f\u4ed9\u5973 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u96c6\u7f8e\u4eec\u529d\u5220 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5956\u52b1\u7684\u6709\u70b9\u591a',
      family: 'attack',
      triedQuery: '\u5956\u52b1\u7684\u6709\u70b9\u591a \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5956\u52b1\u6709\u70b9\u591a \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u997a\u5b50\u8001\u516b',
      family: 'attack',
      triedQuery: '\u997a\u5b50\u8001\u516b \u54ea\u5412 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u997a\u5b50\u5bfc\u6f14\u8001\u516b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u997a\u5b50\u738b\u516b',
      family: 'attack',
      triedQuery: '\u997a\u5b50\u738b\u516b \u54ea\u5412 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u997a\u5b50\u5bfc\u6f14\u738b\u516b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6405\u6df7\u6c34',
      family: 'attack',
      triedQuery: '\u6405\u6df7\u6c34 \u5e26\u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u522b\u6405\u6df7\u6c34 \u5e26\u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4ecb\u53f8\u9ebb\u82bd',
      family: 'attack',
      triedQuery: '\u4ecb\u53f8\u9ebb\u82bd \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u662f\u4ec0\u4e48\u5440 \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];
  const state = { termAttempts: {}, runs: [{ queryDiagnostics: [] }] };
  const entries = [];
  for (const item of cases) {
    entries.push({ term: item.term, family: item.family, evidenceCount: 0 });
    state.termAttempts[Buffer.from(item.term, 'utf8').toString('base64url')] = {
      term: item.term,
      family: item.family,
      evidenceAtPlanTime: 0,
      attempts: 1,
      successfulAttempts: 0,
      queries: [{ query: item.triedQuery, strategyVersion: 6, ok: true, hit: false, comments: 20 }],
      lastQuery: item.triedQuery,
    };
    state.runs[0].queryDiagnostics.push([
      {
        query: item.triedQuery,
        discoveredVideos: 4,
        scannedVideos: 4,
        commentsCollected: 20,
        trainingTextChars: 500,
        targetExistingTerms: [item.term],
        acceptedTerms: [],
      },
    ]);
  }

  const audit = buildDictionaryCoverageAudit(
    { entries },
    state,
    { targetEvidence: 3, maxActions: cases.length, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );
  const byTerm = Object.fromEntries(audit.nextActions.map((action) => [action.term, action]));
  for (const item of cases) {
    assert.equal(byTerm[item.term].nextQuery, item.nextQuery);
  }
});

test('buildDictionaryCoverageAudit keeps strict comment retries comment-scoped after aliases are spent', () => {
  const term = '\u4eca\u65e5\u9996\u7ef7\u4e86';
  const triedQueries = [
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u8bc4\u8bba',
    '\u4eca\u5929\u7b2c\u4e00\u6b21\u7ef7\u4e0d\u4f4f',
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u8bc4\u8bba\u533a',
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u70ed\u8bc4',
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u56de\u590d',
    '\u4eca\u65e5\u9996\u7ef7\u4e86 \u5f39\u5e55',
  ];
  const state = {
    termAttempts: {
      [Buffer.from(term, 'utf8').toString('base64url')]: {
        term,
        family: 'attack',
        evidenceAtPlanTime: 0,
        attempts: triedQueries.length,
        successfulAttempts: 0,
        queries: triedQueries.map((query) => ({ query, strategyVersion: 6, ok: true, hit: false, comments: 20 })),
        lastQuery: triedQueries.at(-1),
      },
    },
    runs: [
      {
        queryDiagnostics: triedQueries.map((query) => [
          {
            query,
            discoveredVideos: 4,
            scannedVideos: 4,
            commentsCollected: 20,
            trainingTextChars: 500,
            targetExistingTerms: [term],
            acceptedTerms: [],
          },
        ]),
      },
    ],
  };

  const audit = buildDictionaryCoverageAudit(
    { entries: [{ term, family: 'attack', evidenceCount: 0 }] },
    state,
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 5, requireCommentBackedEvidence: true },
  );

  assert.equal(audit.nextActions[0].nextQuery, '\u4eca\u65e5\u9996\u7ef7\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4');
});

test('buildDictionaryCoverageAudit upgrades sparse strict comment retries to comment-area hot-comment queries', () => {
  const cases = [
    {
      term: '\u6d4f\u89c8\u5668\u641c',
      family: 'evidence',
      triedQuery: '\u6d4f\u89c8\u5668\u641c \u81ea\u5df1\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      sparseQuery: '\u6d4f\u89c8\u5668\u641c \u8bc4\u8bba',
      nextQuery: '\u81ea\u5df1\u6d4f\u89c8\u5668\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u9f99\u54e5\u7684\u5144\u5f1f',
      family: 'attack',
      triedQuery: '\u9f99\u54e5\u7684\u5144\u5f1f \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      sparseQuery: '\u9f99\u54e5\u7684\u5144\u5f1f \u8bc4\u8bba',
      nextQuery: '\u9f99\u54e5\u5144\u5f1f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7f57\u9a6c\u5b58\u7591',
      family: 'correction',
      triedQuery: '\u7f57\u9a6c\u5b58\u7591 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      sparseQuery: '\u7f57\u9a6c\u5b58\u7591 \u8bc4\u8bba',
      nextQuery: '\u7f57\u9a6c\u4eba\u5b58\u7591 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];
  const state = { termAttempts: {}, runs: [{ queryDiagnostics: [] }] };
  const entries = [];
  for (const item of cases) {
    entries.push({ term: item.term, family: item.family, evidenceCount: 0 });
    state.termAttempts[Buffer.from(item.term, 'utf8').toString('base64url')] = {
      term: item.term,
      family: item.family,
      evidenceAtPlanTime: 0,
      attempts: 1,
      successfulAttempts: 0,
      queries: [{ query: item.triedQuery, strategyVersion: 6, ok: true, hit: false, comments: 20 }],
      lastQuery: item.triedQuery,
    };
    state.runs[0].queryDiagnostics.push([
      {
        query: item.triedQuery,
        discoveredVideos: 4,
        scannedVideos: 4,
        commentsCollected: 20,
        trainingTextChars: 500,
        targetExistingTerms: [item.term],
        acceptedTerms: [],
      },
    ]);
  }

  const audit = buildDictionaryCoverageAudit(
    { entries },
    state,
    { targetEvidence: 3, maxActions: cases.length, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );
  const byTerm = Object.fromEntries(audit.nextActions.map((action) => [action.term, action]));
  for (const item of cases) {
    assert.equal(byTerm[item.term].nextQuery, item.nextQuery);
    assert.notEqual(byTerm[item.term].nextQuery, item.sparseQuery);
  }
});

test('buildDictionaryCoverageAudit avoids definition-only templates in strict comment mode', () => {
  const term = '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406';
  const tried = [
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u8bc4\u8bba\u533a',
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u70ed\u8bc4',
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u5f39\u5e55',
    '\u6446\u4e8b\u5b9e\u8bb2\u9053\u7406 \u4e89\u8bae \u8bc4\u8bba\u533a',
  ];
  const state = {
    termAttempts: {
      [Buffer.from(term, 'utf8').toString('base64url')]: {
        term,
        family: 'cooperation',
        attempts: tried.length,
        successfulAttempts: 0,
        queries: tried.map((query) => ({ query, strategyVersion: 6, ok: true, hit: false, comments: 12 })),
        lastQuery: tried.at(-1),
      },
    },
  };

  const audit = buildDictionaryCoverageAudit(
    { entries: [{ term, family: 'cooperation', evidenceCount: 2 }] },
    state,
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );

  const nextQuery = audit.nextActions[0].nextQuery;
  assert.equal(nextQuery.includes('\u662f\u4ec0\u4e48\u6897'), false);
  assert.equal(nextQuery.includes('\u4ec0\u4e48\u610f\u601d'), false);
  assert.equal(nextQuery.includes('\u51fa\u5904'), false);
  assert.equal(nextQuery.includes('\u540d\u573a\u9762'), false);
  assert.equal(nextQuery.includes('\u5207\u7247'), false);
  assert.equal(nextQuery.includes('B\u7ad9'), false);
  assert.notEqual(nextQuery, term);
  assert.match(nextQuery, /\u8bc4\u8bba|\u70ed\u8bc4|\u56de\u590d|\u5f39\u5e55/u);
});

test('buildDictionaryCoverageAudit prefers semantic aliases over generic comment retries after misses', () => {
  const cases = [
    {
      term: '\u6d4f\u89c8\u5668\u641c',
      family: 'evidence',
      triedQuery: '\u6d4f\u89c8\u5668\u641c \u81ea\u5df1\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u81ea\u5df1\u6d4f\u89c8\u5668\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u9f99\u54e5\u7684\u5144\u5f1f',
      family: 'attack',
      triedQuery: '\u9f99\u54e5\u7684\u5144\u5f1f \u62bd\u8c61 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u9f99\u54e5\u5144\u5f1f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7f57\u9a6c\u5b58\u7591',
      family: 'correction',
      triedQuery: '\u7f57\u9a6c\u5b58\u7591 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u7f57\u9a6c\u4eba\u5b58\u7591 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6ca1\u4eba\u5728\u4e4e',
      family: 'cooperation',
      triedQuery: '\u6ca1\u4eba\u5728\u4e4e \u53cd\u6b63\u6ca1\u4eba\u5728\u4e4e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u53cd\u6b63\u6ca1\u4eba\u5728\u4e4e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u660e\u5929\u6765\u4e0a\u73ed',
      family: 'attack',
      triedQuery: '\u660e\u5929\u6765\u4e0a\u73ed \u7b56\u5212 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4f60\u660e\u5929\u6765\u4e0a\u73ed \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4f60\u7ba1\u5f97\u7740\u4eba\u5bb6',
      family: 'evasion',
      triedQuery: '\u4f60\u7ba1\u5f97\u7740\u4eba\u5bb6 \u4f60\u7ba1\u5f97\u7740\u5417 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4f60\u7ba1\u5f97\u7740\u5417 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4f60\u55b7\u6211\u5c31\u662f\u4f60\u5bf9',
      family: 'evasion',
      triedQuery: '\u4f60\u55b7\u6211\u5c31\u662f\u4f60\u5bf9 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4f60\u9a82\u6211\u5c31\u662f\u4f60\u5bf9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4f60\u53ea\u7ba1\u5c04\u5269\u4e0b\u7684\u4ea4\u7ed9\u5269\u4e0b\u7684',
      family: 'cooperation',
      triedQuery: '\u4f60\u53ea\u7ba1\u5c04 \u5269\u4e0b\u7684\u4ea4\u7ed9\u5269\u4e0b\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4f60\u53ea\u7ba1\u5c04 \u5269\u4e0b\u7684\u4ea4\u7ed9\u957f\u6625 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u634f\u5ac2',
      family: 'attack',
      triedQuery: '\u634f\u5ac2 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u539f\u795e\u634f\u5ac2 \u7eb3\u897f\u59b2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a',
      family: 'cooperation',
      triedQuery: '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u626d\u77e9\u4e0d\u8be6 \u9047\u5f3a\u5219\u5f3a \u67f4\u6cb9\u673a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7cef\u4e86',
      family: 'attack',
      triedQuery: '\u7cef\u4e86 \u4e0d\u6562\u6253 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4ed6\u7cef\u4e86 \u4e0d\u6562\u6253 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6392\u957f',
      family: 'cooperation',
      triedQuery: '\u6392\u957f \u6392\u961f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6392\u957f\u6765\u4e86 \u524d\u6392 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u914d\u961f\u4fa0',
      family: 'correction',
      triedQuery: '\u914d\u961f\u4fa0 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u539f\u795e\u914d\u961f\u4fa0 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u9a97\u4eba\u6211\u76f4\u63a5\u53bb\u6b7b',
      family: 'attack',
      triedQuery: '\u9a97\u4eba\u6211\u76f4\u63a5\u53bb\u6b7b \u53d1\u8a93 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u9a97\u4f60\u6211\u76f4\u63a5\u53bb\u6b7b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7834\u4e86\u76f8\u4e86',
      family: 'attack',
      triedQuery: '\u7834\u4e86\u76f8\u4e86 \u8868\u60c5\u5305 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e0b\u7834\u76f8\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5176\u5b9e\u4e0d\u5b8c\u5168',
      family: 'correction',
      triedQuery: '\u5176\u5b9e\u4e0d\u5b8c\u5168 \u53cd\u9a73 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5176\u5b9e\u4e0d\u5b8c\u5168\u662f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8d77\u6765\u771f\u7684\u7ef7\u4e0d\u4f4f',
      family: 'attack',
      triedQuery: '\u7b11\u8d77\u6765\u771f\u7684\u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u771f\u7684\u7ef7\u4e0d\u4f4f\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5f3a\u5ea6\u5728\u7ebf',
      family: 'cooperation',
      triedQuery: '\u5f3a\u5ea6\u5728\u7ebf \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u89d2\u8272\u5f3a\u5ea6\u5728\u7ebf \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u62a2\u4e2a\u6c99\u53d1',
      family: 'cooperation',
      triedQuery: '\u62a2\u4e2a\u6c99\u53d1 \u6c99\u53d1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u524d\u6392\u62a2\u4e2a\u6c99\u53d1 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5207ki',
      family: 'cooperation',
      triedQuery: '\u5207ki \u65e5\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5207ki\u662f\u4ec0\u4e48 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8f7b\u5feb\u7ef7\u4f4f',
      family: 'cooperation',
      triedQuery: '\u8f7b\u5feb\u7ef7\u4f4f \u600e\u4e48\u8ba9\u6211\u7ef7\u5f97\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u600e\u4e48\u8ba9\u6211\u7ef7\u5f97\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8f7b\u677e\u7ef7\u4e0d\u4f4f',
      family: 'cooperation',
      triedQuery: '\u8f7b\u677e\u7ef7\u4e0d\u4f4f \u600e\u4e48\u8ba9\u6211\u7ef7\u5f97\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u7b11\u5f97\u8f7b\u677e\u7ef7\u4e0d\u4f4f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u533a\u533a52',
      family: 'cooperation',
      triedQuery: '\u533a\u533a52 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u533a\u533a52\u7ea0\u7f20 \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5708\u7684\u7c73',
      family: 'cooperation',
      triedQuery: '\u5708\u7684\u7c73 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u94b1\u5708\u7684\u7c73 \u7c73\u54c8\u6e38 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5168\u90fd\u662f\u5bf9',
      family: 'absolutes',
      triedQuery: '\u5168\u90fd\u662f\u5bf9 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4f60\u5168\u90fd\u662f\u5bf9 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5168\u662f\u654f\u611f\u8bdd\u9898',
      family: 'evasion',
      triedQuery: '\u5168\u662f\u654f\u611f\u8bdd\u9898 \u4e0d\u597d\u8bf4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u5168\u662f\u654f\u611f\u8bdd\u9898 \u4e0d\u597d\u8bf4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7136\u540e\u62bd\u7684\u5168\u662f\u81ea\u5df1\u5c0f\u53f7',
      family: 'evidence',
      triedQuery: '\u7136\u540e\u62bd\u7684\u5168\u662f\u81ea\u5df1\u5c0f\u53f7 \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u62bd\u7684\u5168\u662f\u81ea\u5df1\u5c0f\u53f7 \u62bd\u5956 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8ba4\u771f\u4f60\u5c31\u8f93\u4e86',
      family: 'evasion',
      triedQuery: '\u8ba4\u771f\u4f60\u5c31\u8f93\u4e86 \u4e50\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u770b\u4e2a\u4e50\u5b50\u8ba4\u771f\u4f60\u5c31\u8f93\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5982\u679c\u6709',
      family: 'cooperation',
      triedQuery: '\u5982\u679c\u6709\u5982\u679c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8981\u662f\u771f\u6709 \u53cd\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8f6f\u6587',
      family: 'evidence',
      triedQuery: '\u8f6f\u6587 \u5e7f\u544a \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u662f\u8f6f\u6587\u5427 \u5e7f\u544a \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5f31\u5f31\u8bf4\u4e00\u53e5',
      family: 'correction',
      triedQuery: '\u5f31\u5f31\u8bf4\u4e00\u53e5 \u4e0d\u61c2\u5c31\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5f31\u5f31\u5730\u8bf4\u4e00\u53e5 \u4e0d\u61c2\u5c31\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e09\u963f\u54e5',
      family: 'attack',
      triedQuery: '\u4e09\u963f\u54e5 \u8fd8\u73e0\u683c\u683c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4e09\u963f\u54e5\u6765\u4e86 \u8fd8\u73e0\u683c\u683c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e09\u89d2\u8d38\u6613',
      family: 'cooperation',
      triedQuery: '\u4e09\u89d2\u8d38\u6613 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u6ce2\u4e09\u89d2\u8d38\u6613 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8272\u5f31\u5927\u519b',
      family: 'cooperation',
      triedQuery: '\u8272\u5f31\u5927\u519b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8272\u5f31\u5927\u519b\u96c6\u5408 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6c99\u96d5\u6897',
      family: 'cooperation',
      triedQuery: '\u6c99\u96d5\u6897 \u641e\u7b11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4ec0\u4e48\u6c99\u96d5\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5220\u8bc4\u62c9\u9ed1',
      family: 'evasion',
      triedQuery: '\u5220\u8bc4\u62c9\u9ed1 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u88ab\u5220\u8bc4\u62c9\u9ed1 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e0a\u7535\u89c6',
      family: 'cooperation',
      triedQuery: '\u4e0a\u7535\u89c6 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6211\u4e0a\u7535\u89c6\u4e86 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e0a\u6811',
      family: 'cooperation',
      triedQuery: '\u4e0a\u6811 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u7b49\u6d88\u606f\u4e0a\u6811 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u8bbe\u5b50',
      family: 'cooperation',
      triedQuery: '\u8bbe\u5b50 oc \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e2a\u8bbe\u5b50 oc \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u795e\u795e',
      family: 'attack',
      triedQuery: '\u795e\u795e \u6b96\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e5f\u80fd\u795e\u795e \u6b96\u4eba \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u751f\u8349',
      family: 'attack',
      triedQuery: '\u751f\u8349 \u65e5\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u771f\u7684\u751f\u8349 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u751f\u4ea7\u961f\u7684\u9a74',
      family: 'cooperation',
      triedQuery: '\u751f\u4ea7\u961f\u7684\u9a74 \u5e72\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u751f\u4ea7\u961f\u7684\u9a74\u90fd\u4e0d\u6562\u8fd9\u4e48\u7528 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52',
      family: 'cooperation',
      triedQuery: '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u4e0b\u5931\u8e2a\u4eba\u53e3\u56de\u5f52 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e16\u754c\u754c\u4e16',
      family: 'cooperation',
      triedQuery: '\u4e16\u754c\u754c\u4e16 \u7f51\u6613\u4e91 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4e16\u754c\u754c\u4e16\u7f51\u6613\u4e91 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u89c6\u89d2\u4e22\u5931',
      family: 'evasion',
      triedQuery: '\u89c6\u89d2\u4e22\u5931 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u7b2c\u4e00\u89c6\u89d2\u4e22\u5931 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u89c6\u9891\u5168\u90fd\u4e0d\u89c1\u4e86',
      family: 'evasion',
      triedQuery: '\u89c6\u9891\u5168\u90fd\u4e0d\u89c1\u4e86 \u4e0b\u67b6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4ed6\u7684\u89c6\u9891\u5168\u90fd\u4e0d\u89c1\u4e86 \u4e0b\u67b6 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u89c6\u9891\u540c\u6b3e',
      family: 'cooperation',
      triedQuery: '\u89c6\u9891\u540c\u6b3e \u79cd\u8349 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6c42\u89c6\u9891\u540c\u6b3e \u79cd\u8349 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6536\u85cf\u4ece\u672a\u505c\u6b62\u884c\u52a8\u4ece\u672a\u5f00\u59cb',
      family: 'cooperation',
      triedQuery: '\u6536\u85cf\u4ece\u672a\u505c\u6b62 \u884c\u52a8\u4ece\u672a\u5f00\u59cb \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6536\u85cf\u4ece\u672a\u505c\u6b62\u884c\u52a8\u4ece\u672a\u5f00\u59cb \u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u7761\u524d\u5c0f\u751c\u997c',
      family: 'cooperation',
      triedQuery: '\u7761\u524d\u5c0f\u751c\u997c \u52a8\u6f2b \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4eca\u665a\u7761\u524d\u5c0f\u751c\u997c \u52a8\u6f2b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6b7b\u62ff',
      family: 'absolutes',
      triedQuery: '\u6b7b\u62ff\u4e0d\u653e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6b7b\u62ff\u7740\u4e0d\u653e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u641c\u5457',
      family: 'evasion',
      triedQuery: '\u641c\u5457 \u81ea\u5df1\u641c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4e0d\u4f1a\u81ea\u5df1\u641c\u5457 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5854\u5723',
      family: 'cooperation',
      triedQuery: '\u5854\u5723 \u5854\u83f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5854\u5723\u6765\u4e86 \u5854\u83f2 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u592a\u76d1\u4e86',
      family: 'cooperation',
      triedQuery: '\u592a\u76d1\u4e86 \u505c\u66f4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u756a\u592a\u76d1\u4e86 \u505c\u66f4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u592a\u6709\u795e\u97f5\u4e86\u8001\u94c1',
      family: 'cooperation',
      triedQuery: '\u592a\u6709\u795e\u97f5\u4e86\u8001\u94c1 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6709\u795e\u97f5\u4e86\u8001\u94c1 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6001\u5ea6\u51b3\u5b9a\u4e00\u5207',
      family: 'cooperation',
      triedQuery: '\u6001\u5ea6\u51b3\u5b9a\u4e00\u5207 \u52aa\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u771f\u7684\u6001\u5ea6\u51b3\u5b9a\u4e00\u5207 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5929\u6587\u9635\u8425',
      family: 'cooperation',
      triedQuery: '\u5929\u6587\u9635\u8425 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5929\u6587\u9635\u8425\u600e\u4e48\u9009 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5077\u5077\u53d6\u5173',
      family: 'cooperation',
      triedQuery: '\u5077\u5077\u53d6\u5173 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6211\u8981\u5077\u5077\u53d6\u5173 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u56fe\u7247\u53ef\u4ee5\u62ff\u5417',
      family: 'cooperation',
      triedQuery: '\u56fe\u7247\u53ef\u4ee5\u62ff\u5417 \u6388\u6743 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u56fe\u53ef\u4ee5\u62ff\u5417 \u6388\u6743 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5154\u5154\u5c9b',
      family: 'cooperation',
      triedQuery: '\u5154\u5154\u5c9b \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5154\u5154\u5c9b\u7761\u89c9 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5154\u5154\u5c9b\u7761\u89c9',
      family: 'cooperation',
      triedQuery: '\u5154\u5154\u5c9b\u7761\u89c9 \u865a\u62df\u4e3b\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5154\u5154\u5c9b \u7761\u89c9 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5fd8\u8bb0\u4e86\u5f53\u5c0f\u4e11\u7684\u6765\u65f6\u8def',
      family: 'correction',
      triedQuery: '\u5fd8\u8bb0\u4e86\u5f53\u5c0f\u4e11\u7684\u6765\u65f6\u8def \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5fd8\u4e86\u81ea\u5df1\u5f53\u5c0f\u4e11\u7684\u6765\u65f6\u8def \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5371\u9669\u53d1\u8a00',
      family: 'evasion',
      triedQuery: '\u5371\u9669\u53d1\u8a00 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u8fd9\u662f\u4ec0\u4e48\u5371\u9669\u53d1\u8a00 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u4e3a\u53d1\u70e7\u800c\u751f',
      family: 'cooperation',
      triedQuery: '\u4e3a\u53d1\u70e7\u800c\u751f \u5c0f\u7c73 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5c0f\u7c73\u4e3a\u53d1\u70e7\u800c\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u543b\u9888\u4e4b\u4ea4',
      family: 'cooperation',
      triedQuery: '\u543b\u9888\u4e4b\u4ea4 \u6bb5\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u520e\u9888\u4e4b\u4ea4 \u543b\u9888\u4e4b\u4ea4 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u95ee\u8001\u9a6c\u672c\u4eba',
      family: 'correction',
      triedQuery: '\u95ee\u8001\u9a6c\u672c\u4eba \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u95ee\u672c\u4eba \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6211\u6ef4\u5b69\u6765',
      family: 'cooperation',
      triedQuery: '\u6211\u6ef4\u5b69\u6765 \u8868\u60c5\u5305 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6211\u7684\u5b69\u6765 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6211\u5c06\u652f\u4ed8\u60a8\u753b\u753b\u7684\u8d39\u7528',
      family: 'cooperation',
      triedQuery: '\u6211\u5c06\u652f\u4ed8\u60a8\u753b\u753b\u7684\u8d39\u7528 \u7ea6\u7a3f \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6211\u5c06\u652f\u4ed8\u4f60\u753b\u753b\u7684\u8d39\u7528 \u7ea6\u7a3f \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u6211\u63a8\u8d5b\u9ad8',
      family: 'cooperation',
      triedQuery: '\u6211\u63a8\u8d5b\u9ad8 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u6211\u63a8\u6700\u68d2\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u65e0\u7aef\u8054\u60f3',
      family: 'evasion',
      triedQuery: '\u65e0\u7aef\u8054\u60f3 \u4e0d\u8981\u8054\u60f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u4e0d\u8981\u65e0\u7aef\u8054\u60f3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u65e0\u547d\u4fee\u77e3',
      family: 'attack',
      triedQuery: '\u65e0\u547d\u4fee\u77e3 \u543e\u547d\u4f11\u77e3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u543e\u547d\u4f11\u77e3 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u819d\u8df3\u53cd\u5c04\u5f0f\u559c\u5267',
      family: 'evasion',
      triedQuery: '\u819d\u8df3\u53cd\u5c04\u5f0f\u559c\u5267 \u559c\u5267 \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u819d\u8df3\u53cd\u5c04\u5f0f \u559c\u5267 \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
    {
      term: '\u5c0f\u9ec4\u9c7c',
      family: 'evidence',
      triedQuery: '\u5c0f\u9ec4\u9c7c \u95f2\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4',
      nextQuery: '\u5c0f\u9ec4\u9c7c \u4e8c\u624b \u8bc4\u8bba\u533a \u70ed\u8bc4',
    },
  ];
  const state = { termAttempts: {}, runs: [{ queryDiagnostics: [] }] };
  const entries = [];
  for (const item of cases) {
    entries.push({ term: item.term, family: item.family, evidenceCount: 0 });
    state.termAttempts[Buffer.from(item.term, 'utf8').toString('base64url')] = {
      term: item.term,
      family: item.family,
      evidenceAtPlanTime: 0,
      attempts: 1,
      successfulAttempts: 0,
      queries: [{ query: item.triedQuery, strategyVersion: 6, ok: true, hit: false, comments: 20 }],
      lastQuery: item.triedQuery,
    };
    state.runs[0].queryDiagnostics.push([
      {
        query: item.triedQuery,
        discoveredVideos: 4,
        scannedVideos: 4,
        commentsCollected: 20,
        trainingTextChars: 500,
        targetExistingTerms: [item.term],
        acceptedTerms: [],
      },
    ]);
  }

  const audit = buildDictionaryCoverageAudit(
    { entries },
    state,
    { targetEvidence: 3, maxActions: cases.length, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );
  const byTerm = Object.fromEntries(audit.nextActions.map((action) => [action.term, action]));
  for (const item of cases) {
    assert.equal(byTerm[item.term].nextQuery, item.nextQuery);
    assert.notEqual(byTerm[item.term].nextQuery, `${item.term} \u8bc4\u8bba\u533a \u70ed\u8bc4`);
  }
});

test('buildDictionaryCoverageAudit does not fall back to bare queries when strict comment retry was already tried', () => {
  const term = '\u4e0d\u4e00\u4e00';
  const triedQueries = [
    '\u4e0d\u4e00\u4e00\u5217\u4e3e \u8bc4\u8bba\u533a \u70ed\u8bc4',
    '\u4e0d\u4e00\u4e00\u8bc4\u4ef7 \u8bc4\u8bba\u533a \u70ed\u8bc4',
  ];
  const state = {
    termAttempts: {
      [Buffer.from(term, 'utf8').toString('base64url')]: {
        term,
        family: 'evasion',
        evidenceAtPlanTime: 0,
        attempts: 2,
        successfulAttempts: 0,
        queries: triedQueries.map((query) => ({ query, strategyVersion: 6, ok: true, hit: false, comments: 20 })),
        lastQuery: triedQueries.at(-1),
      },
    },
  };

  const audit = buildDictionaryCoverageAudit(
    { entries: [{ term, family: 'evasion', evidenceCount: 0 }] },
    state,
    { targetEvidence: 3, maxActions: 1, retryBeforeUnattemptedLimit: 1, requireCommentBackedEvidence: true },
  );

  assert.notEqual(audit.nextActions[0].nextQuery, '\u4e0d\u4e00\u4e00\u5217\u4e3e');
  assert.match(audit.nextActions[0].nextQuery, /\u8bc4\u8bba|\u70ed\u8bc4|\u56de\u590d|\u5f39\u5e55/u);
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
            { query: '\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 6, ok: false, hit: false },
            { query: '\u4f60\u88c5\u4ec0\u4e48 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', strategyVersion: 6, ok: false, hit: false },
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

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`);
});

test('buildDictionaryCoverageAudit ignores globally searched queries from stale harvest strategy state', () => {
  const term = 'doge';
  const audit = buildDictionaryCoverageAudit(
    {
      entries: [{ term, family: 'attack', evidenceCount: 0 }],
    },
    {
      harvestStrategyVersion: 4,
      searchedQueries: [`${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`],
      termAttempts: {},
    },
    { targetEvidence: 3, maxActions: 1 },
  );

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`);
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

  assert.equal(audit.nextActions[0].nextQuery, `${term} \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4`);
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

test('harvestKeywordDictionary does not report coverage progress when every query fails without evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-no-progress-failed-'));
  const statePath = join(dir, 'state.json');
  const dictionaries = [
    {
      entries: [
        { term: 'staleExternal', family: 'attack', evidenceCount: 1 },
        { term: 'queuedWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
    {
      entries: [
        { term: 'staleExternal', family: 'attack', evidenceCount: 3 },
        { term: 'queuedWeak', family: 'attack', evidenceCount: 1 },
      ],
    },
  ];
  try {
    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        coverageMode: 'all-weak',
        targetEvidence: 3,
        statePath,
      },
      {
        readKeywordDictionary: async () => dictionaries.shift() || dictionaries.at(-1),
        searchVideoKeywords: async () => ({
          ok: false,
          error: 'No Bilibili videos were discovered from the backend discovery mode.',
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.deepEqual(result.coverageProgress, {
      weakTermsResolved: 0,
      zeroEvidenceResolved: 0,
      evidenceGained: 0,
      evidenceDeficitReduced: 0,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary report actions respect retry-before-unattempted limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-report-retry-limit-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 6,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: [],
        scannedBvids: [],
        termAttempts: {
          noVideoMiss: {
            term: 'noVideoMiss',
            family: 'attack',
            evidenceAtPlanTime: 1,
            attempts: 1,
            successfulAttempts: 0,
            queries: [
              {
                query: 'noVideoMiss \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
                strategyVersion: 6,
                ok: false,
                hit: false,
                videos: 0,
                comments: 0,
                error: 'No Bilibili videos were discovered from the backend discovery mode.',
              },
            ],
            lastQuery: 'noVideoMiss \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
            lastError: 'No Bilibili videos were discovered from the backend discovery mode.',
          },
        },
        runs: [],
      }),
      'utf8',
    );

    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        coverageMode: 'all-weak',
        targetEvidence: 3,
        retryBeforeUnattemptedLimit: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: 'noVideoMiss', family: 'attack', evidenceCount: 1 },
            { term: 'freshWeak', family: 'attack', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async () => ({
          ok: false,
          error: 'No Bilibili videos were discovered from the backend discovery mode.',
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.deepEqual(
      result.coverageActions.filter((item) => item.action !== 'none').slice(0, 2).map((item) => item.term),
      ['freshWeak', 'noVideoMiss'],
    );
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

test('harvestKeywordDictionary records a failed attempt when a search exceeds the per-query timeout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-query-timeout-'));
  const statePath = join(dir, 'state.json');
  try {
    let capturedSignal = null;
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: ['slowTerm \u8bc4\u8bba\u533a'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        perQueryTimeoutMs: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: 'slowTerm', family: 'attack', evidenceCount: 0 }],
        }),
        searchVideoKeywords: async (payload) =>
          new Promise((resolve) => {
            capturedSignal = payload.abortSignal;
            setTimeout(() => resolve({ ok: true, warnings: [], videos: [], comments: [], entries: [] }), 50);
          }),
      },
    );

    assert.equal(capturedSignal?.aborted, true);
    assert.equal(result.ok, false);
    assert.match(result.warnings.join('\n'), /timed out after 1ms/);
    assert.equal(result.results[0].result.ok, false);
    assert.match(result.results[0].result.error, /timed out after 1ms/);
    assert.deepEqual(result.queryDiagnostics[0].targetExistingTerms, ['slowTerm']);
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempt = state.termAttempts[Buffer.from('slowTerm', 'utf8').toString('base64url')];
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.successfulAttempts, 0);
    assert.match(attempt.lastError, /timed out after 1ms/);
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
      harvestStrategyVersion: 6,
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
      harvestStrategyVersion: 6,
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
              strategyVersion: 6,
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
      harvestStrategyVersion: 6,
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
              strategyVersion: 6,
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
      harvestStrategyVersion: 6,
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
      harvestStrategyVersion: 6,
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
        harvestStrategyVersion: 6,
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

test('harvestKeywordDictionary skips known shared-search duplicate groups in limited runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-known-search-group-'));
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
            { term: '\u8f66\u8f71\u8f98', family: 'evasion', evidenceCount: 2 },
            { term: '\u8f66\u8f71\u8f98\u8bdd', family: 'attack', evidenceCount: 2 },
            { term: '\u5403\u53f2', family: 'attack', evidenceCount: 2 },
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

    assert.deepEqual(result.plan.map((item) => item.term), ['\u8f66\u8f71\u8f98', '\u5403\u53f2']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary skips colloquial suffix duplicate groups in limited runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-colloquial-search-group-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionary(
      {
        maxQueries: 5,
        coverageMode: 'all-weak',
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u4ece\u826f', family: 'correction', evidenceCount: 2 },
            { term: '\u4ece\u826f\u4e86', family: 'correction', evidenceCount: 2 },
            { term: '\u7231\u548b\u548b\u5730', family: 'evasion', evidenceCount: 0 },
            { term: '\u7231\u548b\u548b\u7684', family: 'evasion', evidenceCount: 0 },
            { term: '\u6485\u9192', family: 'cooperation', evidenceCount: 2 },
            { term: '\u6485\u9192\u4eba', family: 'cooperation', evidenceCount: 2 },
            { term: '\u4eae\u8840\u6761', family: 'attack', evidenceCount: 2 },
            { term: '\u4eae\u8840\u6761\u4e86', family: 'attack', evidenceCount: 2 },
            { term: '\u62d4\u7fa4', family: 'cooperation', evidenceCount: 0 },
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

    assert.deepEqual(result.plan.map((item) => item.term), ['\u4ece\u826f', '\u6485\u9192', '\u4eae\u8840\u6761', '\u7231\u548b\u548b\u5730', '\u62d4\u7fa4']);
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
    assert.equal(attempt.lastQuery, '典中典 \u5957\u8def \u8bc4\u8bba\u533a \u70ed\u8bc4');
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
        harvestStrategyVersion: 6,
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

test('harvestKeywordDictionary ignores searched query backfill from stale strategy state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-stale-search-backfill-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 5,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: ['doge \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4'],
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
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 1 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [],
          comments: [],
          entries: [],
          collectionDiagnostics: { targetExistingTerms: ['doge'], acceptedTerms: [] },
        }),
      },
    );

    assert.equal(result.backfilledAttempts, 0);
    assert.deepEqual(result.queries, ['doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4']);
    const attempt = Object.values(result.state.termAttempts).find((item) => item.term === 'doge');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.lastQuery, 'doge \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4');
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

test('harvestKeywordDictionary enables danmaku scans for danmaku priority queries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-danmaku-query-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: [
          {
            term: '\u6401\u8fd9\u5462',
            family: 'attack',
            query: '\u6401\u8fd9\u5462 \u5f39\u5e55',
          },
        ],
        maxQueries: 1,
        existingTermsOnly: true,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u6401\u8fd9\u5462', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
            keywordTraining: { dictionaryEvidenceEntries: [] },
            dictionary: { entries: [{ term: '\u6401\u8fd9\u5462', family: 'attack', evidenceCount: 1 }] },
          };
        },
      },
    );

    assert.equal(payloads[0].includeDanmaku, true);
    assert.equal(payloads[0].allowNetworkDanmaku, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary enables danmaku after a current comment miss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-miss-danmaku-'));
  const statePath = join(dir, 'state.json');
  const term = '\u7ed9\u7237\u722c';
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 6,
        termAttempts: {
          [term]: {
            term,
            family: 'attack',
            attempts: 1,
            successfulAttempts: 0,
            queries: [{ query: `${term} \u8bc4\u8bba\u533a`, strategyVersion: 6, ok: true, hit: false, videos: 1, comments: 10 }],
          },
        },
      }),
      'utf8',
    );

    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: [{ term, family: 'attack', query: `${term} \u8bc4\u8bba\u533a` }],
        maxQueries: 1,
        existingTermsOnly: true,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term, family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
            keywordTraining: { dictionaryEvidenceEntries: [] },
            dictionary: { entries: [{ term, family: 'attack', evidenceCount: 1 }] },
          };
        },
      },
    );

    assert.equal(payloads[0].includeDanmaku, true);
    assert.equal(payloads[0].allowNetworkDanmaku, true);
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

test('harvestKeywordDictionary enables filtered discovery fallback for strict comment-backed refreshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-pool-fallback-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVpool111111' }],
            comments: [{ message: '\u76ee\u6807\u5f31\u8bcd \u8bc4\u8bba\u8bc1\u636e', rpid: '1' }],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].includeVideoContext, false);
    assert.equal(payloads[0].includeVideoObjectEvidence, false);
    assert.equal(payloads[0].allowFilteredDiscoveryFallback, true);
    assert.equal(payloads[0].preferFilteredDiscoveryFallback, true);
    assert.deepEqual(payloads[0].targetExistingTerms, ['\u76ee\u6807\u5f31\u8bcd']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary prioritizes target search during strict comment-backed refreshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-prioritize-search-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVtarget11111' }],
            comments: [{ message: '\u76ee\u6807\u5f31\u8bcd \u8bc4\u8bba\u8bc1\u636e', rpid: '1' }],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].prioritizeSearchQueries, true);
    assert.equal(payloads[0].targetSearchOnly, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary broadens strict comment discovery after a comment miss', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-broaden-after-miss-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        harvestStrategyVersion: 6,
        termAttempts: {
          '\u76ee\u6807\u5f31\u8bcd': {
            term: '\u76ee\u6807\u5f31\u8bcd',
            family: 'attack',
            attempts: 1,
            successfulAttempts: 0,
            queries: [
              {
                query: '\u76ee\u6807\u5f31\u8bcd \u8bc4\u8bba\u533a',
                strategyVersion: 6,
                ok: true,
                hit: false,
                videos: 4,
                comments: 18,
              },
            ],
          },
        },
      }),
    );
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVbroad11111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].prioritizeSearchQueries, true);
    assert.equal(payloads[0].targetSearchOnly, false);
    assert.equal(payloads[0].includeDanmaku, true);
    assert.equal(payloads[0].discoveryLimit, 2);
    assert.equal(payloads[0].pages, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary still expands strict comment retries when stale limit equals discovery limit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-expand-stale-floor-'));
  const statePath = join(dir, 'state.json');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        harvestStrategyVersion: 6,
        termAttempts: {
          '\u76ee\u6807\u5f31\u8bcd': {
            term: '\u76ee\u6807\u5f31\u8bcd',
            family: 'attack',
            attempts: 1,
            successfulAttempts: 0,
            queries: [{ query: '\u76ee\u6807\u5f31\u8bcd \u8bc4\u8bba\u533a', strategyVersion: 6, ok: true, hit: false, videos: 4, comments: 20 }],
          },
        },
      }),
    );
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 4,
        staleMissedDiscoveryLimit: 4,
        pages: 2,
        staleMissedPages: 3,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return { ok: true, warnings: [], videos: [], comments: [], entries: [] };
        },
      },
    );

    assert.equal(payloads[0].discoveryLimit, 8);
    assert.equal(payloads[0].pages, 4);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary sends a weak-term batch to strict comment-pool refreshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-pool-targets-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u4e00\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e8c\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e09\u53f7\u5f31\u8bcd', family: 'cooperation', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVpool222222' }],
            comments: [{ message: '\u4e8c\u53f7\u5f31\u8bcd \u8bc4\u8bba\u8bc1\u636e', rpid: '1' }],
            entries: [],
          };
        },
      },
    );

    assert.equal(new Set(payloads[0].targetExistingTerms).size, 3);
    assert.equal(payloads[0].targetExistingTerms.includes('\u4e00\u53f7\u5f31\u8bcd'), true);
    assert.equal(payloads[0].targetExistingTerms.includes('\u4e8c\u53f7\u5f31\u8bcd'), true);
    assert.equal(payloads[0].targetExistingTerms.includes('\u4e09\u53f7\u5f31\u8bcd'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary keeps strict priority action targets out of the comment pool by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-priority-no-pool-targets-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        priorityQueries: [{ term: 'priorityWeak', family: 'attack', nextQuery: 'priorityWeak \u8bc4\u8bba\u533a \u70ed\u8bc4' }],
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: 'priorityWeak', family: 'attack', evidenceCount: 1 },
            { term: 'poolWeakA', family: 'attack', evidenceCount: 1 },
            { term: 'poolWeakB', family: 'cooperation', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVpriority11' }],
            comments: [{ message: 'poolWeakA unrelated evidence', rpid: '1' }],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(payloads[0].targetExistingTerms, ['priorityWeak']);
    assert.deepEqual(payloads[0].directTargetExistingTerms, ['priorityWeak']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary keeps comment target expansion off by default during strict refreshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-no-comment-expand-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVnoexpand111' }],
            comments: [{ message: '\u65e0\u5173\u5f31\u8bcd \u8bc4\u8bba\u8bc1\u636e', rpid: '1' }],
            entries: [],
            collectionDiagnostics: {
              targetExistingTerms: payload.targetExistingTerms,
              acceptedTerms: [],
            },
          };
        },
      },
    );

    assert.equal(payloads[0].expandTargetsFromComments, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary does not mark unrelated comment-pool targets as misses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-pool-no-miss-pollution-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        coverageMode: 'all-weak',
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u4e00\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e8c\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e09\u53f7\u5f31\u8bcd', family: 'cooperation', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVpoolmiss111' }],
            comments: [],
            entries: [],
            collectionDiagnostics: {
              targetExistingTerms: payload.targetExistingTerms,
              acceptedTerms: [],
            },
          };
        },
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempts = Object.values(state.termAttempts);

    assert.deepEqual(attempts.map((attempt) => attempt.term), payloads[0].directTargetExistingTerms);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary records accepted comment-pool target hits without miss-polluting the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-comment-pool-hit-only-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    let acceptedPoolTerm = '';
    await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        coverageMode: 'all-weak',
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            { term: '\u4e00\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e8c\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: 1 },
            { term: '\u4e09\u53f7\u5f31\u8bcd', family: 'cooperation', evidenceCount: 1 },
          ],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          acceptedPoolTerm = payload.targetExistingTerms.find((term) => !payload.directTargetExistingTerms.includes(term));
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BVpoolhit222' }],
            comments: [{ message: `${acceptedPoolTerm} \u8bc4\u8bba\u8bc1\u636e`, rpid: '1' }],
            entries: [],
            keywordTraining: {
              dictionaryEvidenceEntries: [
                {
                  term: acceptedPoolTerm,
                  family: 'attack',
                  evidenceCount: 2,
                  evidenceSamples: [`${acceptedPoolTerm} \u8bc4\u8bba\u8bc1\u636e`, `${acceptedPoolTerm} \u7b2c\u4e8c\u6761\u8bc1\u636e`],
                  evidenceSources: [
                    { source: 'Bilibili public video comment scan', uid: 'BVpoolhit222', sample: `${acceptedPoolTerm} \u8bc4\u8bba\u8bc1\u636e` },
                    { source: 'Bilibili public video comment scan', uid: 'BVpoolhit222', sample: `${acceptedPoolTerm} \u7b2c\u4e8c\u6761\u8bc1\u636e` },
                  ],
                },
              ],
            },
            dictionary: {
              entries: [
                { term: '\u4e00\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: acceptedPoolTerm === '\u4e00\u53f7\u5f31\u8bcd' ? 2 : 1 },
                { term: '\u4e8c\u53f7\u5f31\u8bcd', family: 'attack', evidenceCount: acceptedPoolTerm === '\u4e8c\u53f7\u5f31\u8bcd' ? 2 : 1 },
                { term: '\u4e09\u53f7\u5f31\u8bcd', family: 'cooperation', evidenceCount: acceptedPoolTerm === '\u4e09\u53f7\u5f31\u8bcd' ? 2 : 1 },
              ],
            },
            collectionDiagnostics: {
              targetExistingTerms: payload.targetExistingTerms,
              acceptedTerms: [acceptedPoolTerm],
            },
          };
        },
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempts = Object.fromEntries(Object.values(state.termAttempts).map((attempt) => [attempt.term, attempt]));
    const primaryTerm = payloads[0].directTargetExistingTerms[0];
    const untouchedPoolTerm = payloads[0].targetExistingTerms.find((term) => term !== primaryTerm && term !== acceptedPoolTerm);

    assert.equal(attempts[primaryTerm].attempts, 1);
    assert.equal(attempts[primaryTerm].successfulAttempts, 0);
    assert.equal(attempts[acceptedPoolTerm].attempts, 1);
    assert.equal(attempts[acceptedPoolTerm].successfulAttempts, 1);
    assert.equal(attempts[untouchedPoolTerm], undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary ignores new dictionary terms during existing-only runs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-existing-only-no-growth-'));
  const statePath = join(dir, 'state.json');
  try {
    let reads = 0;
    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        targetEvidence: 3,
        statePath,
      },
      {
        readKeywordDictionary: async () => {
          reads += 1;
          return {
            entries:
              reads === 1
                ? [{ term: 'existingWeak', family: 'attack', evidenceCount: 1 }]
                : [
                    { term: 'existingWeak', family: 'attack', evidenceCount: 1 },
                    { term: 'newExternalTerm', family: 'attack', evidenceCount: 1 },
                  ],
          };
        },
        searchVideoKeywords: async () => ({ ok: true, videos: [], comments: [], entries: [] }),
      },
    );

    assert.equal(result.growth.added, 0);
    assert.deepEqual(result.growth.newTerms, []);
    assert.equal(result.coverage.terms, 1);
    assert.equal(result.dictionary.entries.some((entry) => entry.term === 'newExternalTerm'), false);
    assert.match(result.warnings.join('\n'), /existing-only harvest ignored 1 new dictionary term/);
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

test('harvestKeywordDictionary stores merged dictionary evidence count after a hit', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-merged-count-attempt-'));
  const statePath = join(dir, 'state.json');
  const term = '\u5408\u5e76\u540e\u4e09\u6761\u8bc1\u636e';
  try {
    const result = await harvestKeywordDictionary(
      {
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        targetEvidence: 3,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term, family: 'attack', evidenceCount: 2 }],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
          keywordTraining: {
            dictionaryEvidenceEntries: [{ term, family: 'attack', evidenceCount: 1, evidenceSamples: [term] }],
          },
          dictionary: {
            entries: [{ term, family: 'attack', evidenceCount: 3 }],
          },
          collectionDiagnostics: {
            targetExistingTerms: [term],
            acceptedTerms: [term],
          },
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempt = state.termAttempts[Buffer.from(term, 'utf8').toString('base64url')];

    assert.equal(attempt.successfulAttempts, 1);
    assert.equal(attempt.lastEvidenceCount, 3);
    assert.equal(attempt.queries[0].hit, true);
    assert.equal(result.state.runs[0].coverageIncreasingAcceptedEvidenceCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary does not record duplicate accepted evidence as a successful attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-duplicate-accepted-attempt-'));
  const statePath = join(dir, 'state.json');
  const term = '\u5f88\u61c2\u561b';
  try {
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: [`${term} \u70ed\u8bc4`],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        coverageMode: 'all-weak',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [
            {
              term,
              family: 'attack',
              evidenceCount: 1,
              evidenceSources: [
                {
                  source: 'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVold/',
                  uid: 'BVold',
                  sample: '\u5f88\u61c2\u561b\u8001\u94c1[doge]',
                },
              ],
            },
          ],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BVold' }],
          comments: [{ rpid: '1', message: '\u5f88\u61c2\u561b\u8001\u94c1[doge]' }],
          entries: [],
          keywordTraining: {
            dictionaryEvidenceEntries: [
              {
                term,
                family: 'attack',
                evidenceCount: 1,
                evidenceSources: [
                  {
                    source: 'Bilibili public existing evidence-source video comment scan: https://www.bilibili.com/video/BVold/',
                    uid: 'BVold',
                    sample: '\u5f88\u61c2\u561b\u8001\u94c1[doge]',
                  },
                ],
              },
            ],
          },
          dictionary: {
            entries: [{ term, family: 'attack', evidenceCount: 1 }],
          },
          collectionDiagnostics: {
            targetExistingTerms: [term],
            acceptedTerms: [term],
          },
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempt = state.termAttempts[Buffer.from(term, 'utf8').toString('base64url')];

    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.successfulAttempts, 0);
    assert.equal(attempt.lastEvidenceCount, 0);
    assert.equal(attempt.queries[0].hit, false);
    assert.equal(result.state.runs[0].acceptedEvidenceCount, 1);
    assert.equal(result.state.runs[0].coverageIncreasingAcceptedEvidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary preserves prior successful attempts after a duplicate retry', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-preserve-prior-success-'));
  const statePath = join(dir, 'state.json');
  const term = '\u5df2\u7ecf\u8865\u8fc7\u8bc1\u636e';
  const key = Buffer.from(term, 'utf8').toString('base64url');
  try {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        harvestStrategyVersion: 6,
        updatedAt: '2026-01-01T00:00:00.000Z',
        searchedQueries: [],
        scannedBvids: [],
        termAttempts: {
          [key]: {
            key,
            term,
            family: 'attack',
            evidenceAtPlanTime: 1,
            lastEvidenceCount: 2,
            attempts: 1,
            successfulAttempts: 1,
            lastQuery: `${term} \u8bc4\u8bba\u533a`,
            queries: [{ query: `${term} \u8bc4\u8bba\u533a`, hit: true, strategyVersion: 6 }],
          },
        },
        runs: [],
      }),
      'utf8',
    );

    const result = await harvestKeywordDictionary(
      {
        priorityQueries: [`${term} \u70ed\u8bc4`],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        coverageMode: 'all-weak',
        targetEvidence: 3,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term, family: 'attack', evidenceCount: 2 }],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BVduplicate' }],
          comments: [{ rpid: '1', message: term }],
          entries: [],
          keywordTraining: {
            dictionaryEvidenceEntries: [{ term, family: 'attack', evidenceCount: 2, evidenceSamples: [term] }],
          },
          dictionary: {
            entries: [{ term, family: 'attack', evidenceCount: 2 }],
          },
          collectionDiagnostics: {
            targetExistingTerms: [term],
            acceptedTerms: [term],
          },
        }),
      },
    );

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    const attempt = state.termAttempts[key];
    const action = result.coverageActions.find((item) => item.term === term);

    assert.equal(attempt.attempts, 2);
    assert.equal(attempt.successfulAttempts, 1);
    assert.equal(action.successfulAttempts, 1);
    assert.equal(action.status, 'weak_partial');
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
        harvestStrategyVersion: 6,
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

test('harvestKeywordDictionary carries duplicate priority action targets into one query', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-duplicate-priority-targets-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: [
          { term: 'alphaTerm', family: 'attack', nextQuery: 'shared query 评论区', evidenceCount: 1 },
          { term: 'betaTerm', family: 'evasion', nextQuery: 'shared query 评论区', evidenceCount: 1 },
        ],
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
            { term: 'alphaTerm', family: 'attack', evidenceCount: 1 },
            { term: 'betaTerm', family: 'evasion', evidenceCount: 1 },
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

    assert.equal(payloads.length, 1);
    assert.equal(payloads[0].searchQueries[0], 'shared query 评论区');
    assert.deepEqual(new Set(payloads[0].targetExistingTerms), new Set(['alphaTerm', 'betaTerm']));
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

test('harvestKeywordDictionary does not record strict comment success from context-only dictionary growth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-strict-context-growth-miss-'));
  const statePath = join(dir, 'state.json');
  try {
    const beforeDictionary = {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 1,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVold/',
              uid: 'BVold',
              sample: 'Bilibili video context: contextOnly old title',
            },
          ],
        },
      ],
    };
    const afterDictionary = {
      entries: [
        {
          term: 'contextOnly',
          family: 'attack',
          evidenceCount: 3,
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVold/',
              uid: 'BVold',
              sample: 'Bilibili video context: contextOnly old title',
            },
            {
              source: 'Bilibili public search-discovered video context: https://www.bilibili.com/video/BVnew/',
              uid: 'BVnew',
              sample: 'Bilibili video context: contextOnly new title',
            },
          ],
        },
      ],
    };
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: ['contextOnly \u8bc4\u8bba\u533a'],
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
        readKeywordDictionary: async () => beforeDictionary,
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BVnew' }],
          comments: [],
          entries: [],
          dictionary: afterDictionary,
          collectionDiagnostics: {
            targetExistingTerms: ['contextOnly'],
            acceptedTerms: [],
            commentsCollected: 0,
            trainingTextChars: 0,
          },
        }),
      },
    );

    const attempt = Object.values(result.state.termAttempts).find((item) => item.term === 'contextOnly');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.successfulAttempts, 0);
    assert.equal(attempt.queries[0].hit, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary disables video-title evidence during strict comment refreshes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-strict-no-title-evidence-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        priorityQueries: ['contextOnly \u8bc4\u8bba\u533a'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: 'contextOnly', family: 'attack', evidenceCount: 1 }],
        }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
            keywordTraining: { dictionaryEvidenceEntries: [] },
            dictionary: { entries: [{ term: 'contextOnly', family: 'attack', evidenceCount: 1 }] },
          };
        },
      },
    );

    assert.equal(payloads[0].includeVideoContext, false);
    assert.equal(payloads[0].includeVideoObjectEvidence, false);
    assert.equal(payloads[0].evidenceSourceVideoFallback, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary reports accepted evidence by unique comment samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-unique-evidence-count-'));
  const statePath = join(dir, 'state.json');
  try {
    const evidenceEntry = {
      term: 'sampleTerm',
      family: 'attack',
      evidenceCount: 3,
      evidenceSamples: ['sampleTerm first comment', 'sampleTerm second comment'],
      evidenceSources: [
        {
          source: 'Bilibili public existing evidence-source video comment scan: https://www.bilibili.com/video/BV1111111111/',
          uid: 'BV1111111111',
          sample: 'sampleTerm first comment',
        },
        {
          source: 'Bilibili public existing evidence-source video comment scan: https://www.bilibili.com/video/BV1111111111/',
          uid: 'BV1111111111',
          sample: 'sampleTerm second comment',
        },
      ],
    };
    const result = await harvestKeywordDictionary(
      {
        priorityQueries: ['sampleTerm comment'],
        seedQueries: [],
        maxQueries: 1,
        existingTermsOnly: true,
        requireCommentBackedEvidence: true,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({
          entries: [{ term: 'sampleTerm', family: 'attack', evidenceCount: 2 }],
        }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [{ message: 'sampleTerm first comment' }, { message: 'sampleTerm second comment' }],
          entries: [evidenceEntry],
          keywordTraining: { dictionaryEvidenceEntries: [evidenceEntry] },
          dictionary: { entries: [evidenceEntry] },
        }),
      },
    );

    assert.equal(result.trainingDiagnostics.dictionaryEvidenceCount, 2);
    assert.equal(result.state.runs[0].acceptedEvidenceCount, 2);
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
