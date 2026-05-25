import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractJsonObject,
  filterKeywordEntriesByEvidence,
  findDictionaryEntriesWithTextEvidence,
  getDeepSeekConfig,
  mergeEntriesIntoDictionary,
  normalizeKeywordEntries,
  trainKeywordDictionary,
} from './deepseekKeywordTrainer.js';

test('selects configured DeepSeek V4 model when the key is present', async () => {
  const config = await getDeepSeekConfig({
    env: {
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      DEEPSEEK_REASONING_EFFORT: 'medium',
    },
    fetch: async (url, options) => {
      assert.equal(String(url), 'https://api.deepseek.com/models');
      assert.equal(options.headers.authorization, 'Bearer test-key');
      return {
        ok: true,
        json: async () => ({
          data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
        }),
      };
    },
  });

  assert.equal(config.provider, 'deepseek');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.reasoningEffort, 'medium');
  assert.equal(config.available, true);
  assert.equal(config.keyConfigured, true);
});

test('reports DeepSeek API key missing without exposing secrets', async () => {
  const config = await getDeepSeekConfig({ env: {} });

  assert.equal(config.provider, 'deepseek');
  assert.equal(config.model, 'deepseek-v4-flash');
  assert.equal(config.reasoningEffort, 'medium');
  assert.equal(config.available, false);
  assert.equal(config.keyConfigured, false);
});

test('normalizes DeepSeek keyword output into supported dictionary families', () => {
  const entries = normalizeKeywordEntries([
    { term: '不会真有人', family: 'sarcasm', meaning: '反讽式资格审查', variants: ['不会真有人觉得'] },
    { term: '懂的都懂', family: 'evidenceShift', meaning: '拒绝解释，把举证责任推给对方' },
    { term: '我说重了', family: 'correction', meaning: '自我降级修正' },
    { term: '变体1', family: 'attack', meaning: '中文含义和语用功能' },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.family]), [
    ['不会真有人', 'attack'],
    ['不会真有人觉得', 'attack'],
    ['懂的都懂', 'evasion'],
    ['我说重了', 'correction'],
  ]);
});

test('normalizes noisy punctuation and rejects low-quality keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: '去问地理老师的）O', family: 'evasion', meaning: '噪声样本' },
    { term: '问百度！！', family: 'evasion', meaning: '把解释责任转移到搜索引擎' },
    { term: '[doge]', family: 'cooperation', meaning: '表情梗' },
    { term: '᭙ᦔꪀꪑᦔ', family: 'attack', meaning: 'model copied decorative script noise' },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.family]), [
    ['问百度', 'evasion'],
    ['doge', 'cooperation'],
  ]);
});

test('mergeEntriesIntoDictionary prunes persisted non Chinese or Latin noise terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-noise-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { term: 'doge', family: 'cooperation', meaning: 'common Bilibili expression', evidenceCount: 1 },
          { term: '᭙ᦔꪀꪑᦔ', family: 'attack', meaning: 'decorative script noise', evidenceCount: 1 },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['doge']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary shares existing alias evidence with longer dictionary variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-alias-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u8e6d\u6982\u5ff5',
            family: 'attack',
            meaning: 'base concept accusation',
            evidenceCount: 1,
            evidenceSamples: ['这就是蹭概念'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-alias', sample: '这就是蹭概念' }],
          },
          {
            term: '\u8c01\u662f\u8e6d\u6982\u5ff5',
            family: 'attack',
            meaning: 'question form variant',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const variant = dictionary.entries.find((entry) => entry.term === '\u8c01\u662f\u8e6d\u6982\u5ff5');

    assert.equal(variant.evidenceCount, 1);
    assert.deepEqual(variant.evidenceSamples, ['这就是蹭概念']);
    assert.equal(variant.evidenceSources[0].uid, 'BV-alias');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('normalizes away promotional commerce artifacts from keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: '最高领26618元', family: 'absolutes', meaning: 'promotional ad copy copied from comments' },
    { term: '88会员', family: 'evidence', meaning: 'shopping membership program, not discourse behavior' },
    { term: '88vip', family: 'evidence', meaning: 'shopping membership shorthand, not discourse behavior' },
    { term: '梭哈', family: 'absolutes', meaning: '绝对化投入表达' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['梭哈']);
});

test('normalizes away Bilibili object IDs from keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: 'BV11W3nz2Ed2', family: 'evidence', meaning: 'Bilibili video ID copied from source URL' },
    { term: 'av123456789', family: 'evidence', meaning: 'Bilibili av ID copied from source URL' },
    { term: 'BV号', family: 'evidence', meaning: 'discussion about Bilibili ids as text' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['BV号']);
});

test('extracts JSON object from verbose DeepSeek responses', () => {
  const parsed = extractJsonObject('```json\n{"keywords":[{"term":"典中典","family":"attack"}]}\n```');
  assert.deepEqual(parsed, { keywords: [{ term: '典中典', family: 'attack' }] });
});

test('filters keyword entries to terms with direct text evidence', () => {
  const entries = filterKeywordEntriesByEvidence(
    [
      { term: '[doge]', family: 'cooperation', meaning: '表情梗' },
      { term: 'notpresent', family: 'attack', meaning: 'model hallucination' },
    ],
    'this Bilibili comment uses [doge] only\nsecond [doge] sample',
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1source/', uid: 'BV1source' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['doge']);
  assert.equal(entries[0].evidenceCount, 2);
  assert.deepEqual(entries[0].evidenceSamples, ['this Bilibili comment uses [doge] only', 'second [doge] sample']);
  assert.deepEqual(entries[0].evidenceSources[0], {
    source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1source/',
    uid: 'BV1source',
    sample: 'this Bilibili comment uses [doge] only',
  });
});

test('findDictionaryEntriesWithTextEvidence refreshes existing dictionary term evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: 'doge', family: 'cooperation', meaning: '琛ㄦ儏姊?', evidenceCount: 0 },
        { term: 'missing', family: 'attack', meaning: 'not present', evidenceCount: 0 },
      ],
    },
    'first [doge] comment\nsecond doge sample',
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['doge']);
  assert.equal(entries[0].evidenceCount, 2);
  assert.deepEqual(entries[0].evidenceSamples, ['first [doge] comment', 'second doge sample']);
});

test('findDictionaryEntriesWithTextEvidence can match stable internet aliases', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86', family: 'attack', meaning: 'long-form win-meme phrase' },
        { term: '\u8c01\u662f\u8e6d\u6982\u5ff5', family: 'attack', meaning: 'question-form variant' },
        { term: '\u81ea\u5df1\u67e5\u53bb', family: 'evasion', meaning: 'imperative variant' },
        { term: '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528', family: 'evasion', meaning: 'question-form variant' },
        { term: 'dddd', family: 'evasion', meaning: 'abbreviation for \u61c2\u7684\u90fd\u61c2' },
        { term: 'yygq', family: 'attack', meaning: 'abbreviation for \u9634\u9633\u602a\u6c14' },
        { term: 'pink', family: 'attack', meaning: 'shorthand for \u7c89\u7ea2' },
      ],
    },
    '\u6211\u4eec\u8d62\u9ebb\u4e86\n\u8fd9\u5c31\u662f\u8e6d\u6982\u5ff5\n\u81ea\u5df1\u67e5\u5427\n\u95ee\u767e\u5ea6\u4e5f\u884c\n\u61c2\u7684\u90fd\u61c2\uff0c\u4e0d\u89e3\u91ca\n\u8fd9\u6761\u8bc4\u8bba\u6709\u70b9\u9634\u9633\u602a\u6c14\n\u5c0f\u7c89\u7ea2\u53c8\u6765\u4e86',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-alias/',
      uid: 'BV-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86',
    '\u8c01\u662f\u8e6d\u6982\u5ff5',
    '\u81ea\u5df1\u67e5\u53bb',
    '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528',
    'dddd',
    'yygq',
    'pink',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount === 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence matches bidirectional short-form aliases', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', meaning: 'short sarcasm stem' },
        { term: '\u61c2\u7684\u90fd\u61c2', family: 'evasion', meaning: 'implicit proof shift' },
        { term: '\u5355\u8d706', family: 'attack', meaning: 'bullet-comment joke form' },
        { term: '\u81ea\u5df1\u67e5', family: 'evasion', meaning: 'shift proof burden' },
      ],
    },
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u8fd8\u5728\u8fd9\u6837\u8bf4\u5427\ndddd\uff0c\u61d2\u5f97\u89e3\u91ca\n\u5355\u8d70\u4e00\u4e2a6\n\u4f60\u81ea\u5df1\u641c\u4e00\u4e0b',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-short-alias/',
      uid: 'BV-short-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
    '\u61c2\u7684\u90fd\u61c2',
    '\u5355\u8d706',
    '\u81ea\u5df1\u67e5',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount === 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-short-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps short sarcasm stems to long variants', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427', family: 'attack', meaning: 'long sarcasm variant' },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', meaning: 'long evidence sarcasm variant' },
      ],
    },
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u8fd8\u5728\u62ff\u8fd9\u4e2a\u5f53\u8bc1\u636e\u5427',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-sarcasm-stem/',
      uid: 'BV-sarcasm-stem',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount === 1), true);
});

test('findDictionaryEntriesWithTextEvidence maps harvest aliases back to hard zero-evidence terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7cbe\u795e\u5916\u56fd\u4eba', family: 'attack', meaning: 'long form political insult' },
        { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self correction phrase' },
        { term: '\u95ee\u8001\u9a6c\u672c\u4eba', family: 'evasion', meaning: 'ask the principal actor' },
        { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'request to paste evidence' },
      ],
    },
    '\u53c8\u5728\u8bf4\u7cbe\u5916\u4e86\n\u6211\u8bf4\u91cd\u4e86\uff0c\u5148\u6536\u56de\n\u8fd9\u4e2a\u4f60\u5f97\u53bb\u95ee\u672c\u4eba\n\u53ef\u4ee5\u53d1\u51fa\u6765\u770b\u770b',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-hard-alias/',
      uid: 'BV-hard-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u7cbe\u795e\u5916\u56fd\u4eba',
    '\u524d\u9762\u8bf4\u91cd\u4e86',
    '\u95ee\u8001\u9a6c\u672c\u4eba',
    '\u53ef\u4ee5\u8d34',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount === 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-hard-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps newer controversy aliases back to weak dictionary terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self correction phrase' },
        { term: '\u95ee\u8001\u9a6c\u672c\u4eba', family: 'evasion', meaning: 'ask the principal actor' },
        { term: '\u8e6d\u6982\u5ff5', family: 'attack', meaning: 'accuse concept riding' },
        { term: '\u8f66\u5bb6\u519b', family: 'attack', meaning: 'car fandom label' },
      ],
    },
    '\u521a\u624d\u8bf4\u9519\u4e86\uff0c\u8fd9\u53e5\u6211\u6536\u56de\n\u8fd9\u4e2a\u4f60\u5f97\u95ee\u9a6c\u65af\u514b\u53bb\nAI\u6982\u5ff5\u4e5f\u80fd\u8e6d\u4e0a\n\u96f7\u519b\u7c89\u4e1d\u53c8\u5728\u51b2\u8bc4\u8bba\u533a',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-current-alias/',
      uid: 'BV-current-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u524d\u9762\u8bf4\u91cd\u4e86',
    '\u95ee\u8001\u9a6c\u672c\u4eba',
    '\u8e6d\u6982\u5ff5',
    '\u8f66\u5bb6\u519b',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-current-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps repeatedly missed conversational aliases back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb', family: 'cooperation', meaning: 'boost this reply' },
        { term: '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708', family: 'attack', meaning: 'mock survival time' },
        { term: '\u54ea\u90fd\u6709\u4f60', family: 'attack', meaning: 'everywhere again' },
        { term: 'tv\u574f\u7b11', family: 'attack', meaning: 'smirk emote' },
      ],
    },
    '\u9ad8\u4f4e\u7ed9\u4f60\u9001\u4e0a\u53bb\n\u8fd9\u4e2a\u8282\u594f\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708\n\u600e\u4e48\u54ea\u513f\u90fd\u6709\u4f60\n\u574f\u7b11\u8868\u60c5\u5237\u5c4f',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-missed-alias/',
      uid: 'BV-missed-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb',
    '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708',
    '\u54ea\u90fd\u6709\u4f60',
    'tv\u574f\u7b11',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-missed-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps persistent zero-evidence attack aliases back to dictionary terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack', meaning: 'sarcastic gatekeeping stem' },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427', family: 'attack', meaning: 'sarcastic gatekeeping question' },
        { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', meaning: 'dismiss evidence sarcastically' },
        { term: '\u6ca1\u6709\u8f66\u5bb6\u519b', family: 'attack', meaning: 'deny car fandom brigading' },
        { term: '\u8c01\u662f\u8e6d\u6982\u5ff5', family: 'attack', meaning: 'ask who is concept riding' },
      ],
    },
    '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97\u8fd9\u4e5f\u53eb\u8bc1\u636e\u5427\n\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b\uff0c\u90fd\u662f\u7c73\u7c89\u63a7\u8bc4\n\u8fd9\u4e2a\u9879\u76ee\u5230\u5e95\u8c01\u5728\u8e6d\u6982\u5ff5',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-zero-attack-alias/',
      uid: 'BV-zero-attack-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427',
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
    '\u6ca1\u6709\u8f66\u5bb6\u519b',
    '\u8c01\u662f\u8e6d\u6982\u5ff5',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-zero-attack-alias'), true);
});

test('trainKeywordDictionary updates evidence for existing terms found in crawled comments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [{ term: 'freshterm', family: 'cooperation', meaning: 'existing dictionary term', confidence: 0.7, evidenceCount: 0 }],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: 'Bilibili comment has [freshterm]\nanother freshterm reply',
        uid: 'BV-existing',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing/',
      },
      {
        dictionaryPath,
        env: {},
      },
    );

    const existing = result.dictionary.entries.find((entry) => entry.term === 'freshterm');
    assert.equal(result.generatedEntries.length, 0);
    assert.deepEqual(result.dictionaryEvidenceEntries.map((entry) => entry.term), ['freshterm']);
    assert.equal(existing.evidenceCount, 2);
    assert.equal(existing.evidenceSamples.includes('Bilibili comment has [freshterm]'), true);
    assert.equal(existing.evidenceSources[0].uid, 'BV-existing');
    assert.equal(existing.evidenceSources[0].source.includes('bilibili.com/video/BV-existing'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trainKeywordDictionary can refresh only existing dictionary terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-only-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [{ term: 'freshterm', family: 'cooperation', meaning: 'existing dictionary term', confidence: 0.7, evidenceCount: 0 }],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: 'freshterm appears here and brandnewterm appears too',
        uid: 'BV-existing-only',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-only/',
        existingTermsOnly: true,
      },
      {
        dictionaryPath,
        env: { DEEPSEEK_API_KEY: 'test-key' },
        fetch: async () => {
          throw new Error('DeepSeek should not be called in existing-only mode');
        },
      },
    );

    assert.deepEqual(result.generatedEntries, []);
    assert.deepEqual(result.entries.map((entry) => entry.term), ['freshterm']);
    assert.equal(result.dictionary.entries.some((entry) => entry.term === 'brandnewterm'), false);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === 'freshterm').evidenceCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trainKeywordDictionary uses DeepSeek V4 to map exact source phrases to existing terms only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-deepseek-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const chatBodies = [];
  try {
    await mergeEntriesIntoDictionary(
      [
        { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self correction phrase', confidence: 0.7 },
        { term: '\u8e6d\u6982\u5ff5', family: 'attack', meaning: 'concept-riding accusation', confidence: 0.7 },
      ],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: '\u64a4\u56de\u8fd9\u53e5\uff0c\u524d\u9762\u7684\u7ed3\u8bba\u4e0d\u51c6\u786e\n\u8fd9\u4e0d\u662f\u666e\u901a\u7684AI\u70ed\u5ea6\u5417',
        uid: 'BV-existing-deepseek',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-deepseek/',
        existingTermsOnly: true,
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url, options = {}) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          const body = JSON.parse(options.body);
          chatBodies.push(body);
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      matches: [
                        { term: '\u524d\u9762\u8bf4\u91cd\u4e86', evidence: '\u64a4\u56de\u8fd9\u53e5', confidence: 0.86 },
                        { term: '\u65b0\u8bcd', evidence: '\u666e\u901a', confidence: 0.9 },
                        { term: '\u8e6d\u6982\u5ff5', evidence: '\u4e0d\u5728\u539f\u6587\u7684\u8bc1\u636e', confidence: 0.8 },
                      ],
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.equal(result.available, true);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.generatedEntries, []);
    assert.deepEqual(result.dictionaryEvidenceEntries.map((entry) => entry.term), ['\u524d\u9762\u8bf4\u91cd\u4e86']);
    assert.equal(result.dictionaryEvidenceEntries[0].evidenceCount, 1);
    assert.equal(result.dictionaryEvidenceEntries[0].evidenceSamples[0].includes('\u64a4\u56de\u8fd9\u53e5'), true);
    assert.equal(result.dictionaryEvidenceEntries[0].evidenceSources[0].uid, 'BV-existing-deepseek');
    assert.equal(result.dictionary.entries.some((entry) => entry.term === '\u65b0\u8bcd'), false);
    assert.equal(chatBodies[0].model, 'deepseek-v4-flash');
    assert.equal(chatBodies[0].reasoning_effort, 'medium');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trainKeywordDictionary scopes existing-only evidence to target terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-target-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const chatBodies = [];
  try {
    await mergeEntriesIntoDictionary(
      [
        { term: '\u76ee\u6807\u5f31\u8bcd', family: 'attack', meaning: 'target weak term', confidence: 0.7 },
        { term: '\u8def\u8fc7\u70ed\u8bcd', family: 'attack', meaning: 'unrelated popular term', confidence: 0.7 },
      ],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: '\u8def\u8fc7\u70ed\u8bcd\u5728\u8bc4\u8bba\u91cc\u51fa\u73b0\n\u7a00\u6709\u4e0a\u4e0b\u6587\u5728\u8bc4\u8bba\u91cc\u51fa\u73b0',
        uid: 'BV-existing-target',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-target/',
        existingTermsOnly: true,
        targetExistingTerms: ['\u76ee\u6807\u5f31\u8bcd'],
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url, options = {}) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          const body = JSON.parse(options.body);
          chatBodies.push(body);
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      matches: [
                        { term: '\u8def\u8fc7\u70ed\u8bcd', evidence: '\u8def\u8fc7\u70ed\u8bcd', confidence: 0.9 },
                        { term: '\u76ee\u6807\u5f31\u8bcd', evidence: '\u7a00\u6709\u4e0a\u4e0b\u6587', confidence: 0.9 },
                      ],
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.deepEqual(result.dictionaryEvidenceEntries.map((entry) => entry.term), ['\u76ee\u6807\u5f31\u8bcd']);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === '\u76ee\u6807\u5f31\u8bcd').evidenceCount, 1);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === '\u8def\u8fc7\u70ed\u8bcd').evidenceCount || 0, 0);
    const userMessage = chatBodies[0].messages.find((message) => message.role === 'user')?.content || '';
    const candidateBlock = userMessage.match(/EXISTING_TERMS:\n([\s\S]*?)\n\nUID:/)?.[1] || '';
    assert.equal(candidateBlock.includes('\u8def\u8fc7\u70ed\u8bcd'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merges learned keyword entries into a persistent local dictionary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-keywords-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const dictionary = await mergeEntriesIntoDictionary(
      [
        { term: '典中典', family: 'attack', meaning: '套娃式嘲讽' },
        { term: '自己查', family: 'evasion', meaning: '转移举证责任' },
      ],
      { dictionaryPath },
    );

    assert.deepEqual(dictionary.families.attack, ['典中典']);
    assert.deepEqual(dictionary.families.evasion, ['自己查']);
    const persisted = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    assert.equal(persisted.entries.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('merges dictionary conflicts by term instead of family plus term', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-keywords-dedupe-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [
        { term: 'doge', family: 'attack', meaning: '嘲讽表情', confidence: 0.7 },
        { term: '单走一个6', family: 'attack', meaning: '弹幕式嘲讽', confidence: 0.68 },
      ],
      { dictionaryPath },
    );

    const dictionary = await mergeEntriesIntoDictionary(
      [
        { term: 'doge', family: 'cooperation', meaning: '轻松玩梗', confidence: 0.72 },
        { term: '单走一个6', family: 'cooperation', meaning: '认可或玩梗', confidence: 0.72 },
      ],
      { dictionaryPath },
    );

    assert.equal(dictionary.entries.filter((entry) => entry.term === 'doge').length, 1);
    assert.equal(dictionary.entries.filter((entry) => entry.term === '单走一个6').length, 1);
    assert.equal(dictionary.families.attack.includes('doge'), true);
    assert.equal(dictionary.families.cooperation.includes('doge'), false);
    assert.equal(dictionary.families.attack.includes('单走一个6'), true);
    assert.equal(dictionary.families.cooperation.includes('单走一个6'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trains dictionary through DeepSeek V4 chat output and persists learned terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const seen = [];
  try {
    const result = await trainKeywordDictionary(
      {
        text: '不会真有人觉得这叫证据吧，懂的都懂。',
        uid: '453244911',
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url, options = {}) => {
          seen.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null, headers: options.headers });
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }] }) };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keywords: [
                        { term: '不会真有人', family: 'sarcasm', meaning: '用反问包装资格审查' },
                        { term: '懂的都懂', family: 'evidenceShift', meaning: '暗示无需证明' },
                      ],
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.provider, 'deepseek');
    assert.equal(result.model, 'deepseek-v4-flash');
    assert.equal(result.reasoningEffort, 'medium');
    assert.equal(result.entries.length >= 2, true);
    assert.equal(result.dictionary.families.attack.includes('不会真有人'), true);
    assert.equal(result.dictionary.families.evasion.includes('懂的都懂'), true);
    assert.equal(seen.some((call) => call.url === 'https://api.deepseek.com/chat/completions'), true);
    assert.equal(seen.find((call) => call.body?.model)?.body.response_format.type, 'json_object');
    assert.equal(seen.find((call) => call.body?.model)?.body.reasoning_effort, 'medium');
    assert.deepEqual(seen.find((call) => call.body?.model)?.body.thinking, { type: 'enabled' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects DeepSeek keywords that are not evidenced in crawled text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const result = await trainKeywordDictionary(
      {
        text: 'this Bilibili comment uses [doge] only',
        uid: 'BV-evidence',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-evidence/',
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keywords: [
                        { term: '[doge]', family: 'cooperation', meaning: '表情梗' },
                        { term: 'notpresent', family: 'attack', meaning: 'not in source text' },
                      ],
                    }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.equal(result.usedFallback, false);
    assert.equal(result.evidenceRejected, 1);
    assert.deepEqual(result.entries.map((entry) => entry.term), ['doge']);
    assert.equal(result.entries[0].evidenceCount, 1);
    assert.deepEqual(result.entries[0].evidenceSamples, ['this Bilibili comment uses [doge] only']);
    assert.equal(result.entries[0].evidenceSources[0].uid, 'BV-evidence');
    assert.deepEqual(result.dictionary.families.cooperation, ['doge']);
    assert.deepEqual(result.dictionary.families.attack, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('retries DeepSeek keyword generation when JSON mode returns empty content', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-retry-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const chatBodies = [];
  try {
    const result = await trainKeywordDictionary(
      {
        text: '单走一个6，谁是蹭概念，问百度有什么用。',
        uid: 'BV19yGa61Ee6',
      },
      {
        dictionaryPath,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url, options = {}) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          const body = JSON.parse(options.body);
          chatBodies.push(body);
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content:
                      chatBodies.length === 1
                        ? ''
                        : JSON.stringify({
                            keywords: [
                              { term: '单走一个6', family: 'attack', meaning: '弹幕式戏谑表达', variants: [] },
                              { term: '问百度', family: 'evasion', meaning: '把解释责任转给搜索引擎', variants: [] },
                            ],
                          }),
                  },
                },
              ],
            }),
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.usedFallback, false);
    assert.equal(chatBodies.length, 2);
    assert.equal(chatBodies[0].response_format.type, 'json_object');
    assert.equal(chatBodies[1].response_format, undefined);
    assert.equal(chatBodies[1].reasoning_effort, 'medium');
    assert.equal(chatBodies[1].max_tokens, 3200);
    assert.equal(result.entries.some((entry) => entry.term === '单走一个6'), true);
    assert.equal(result.entries.some((entry) => entry.term === '问百度'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
