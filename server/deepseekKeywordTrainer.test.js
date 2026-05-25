import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireFileLock } from './fileLock.js';

import {
  extractJsonObject,
  filterKeywordEntriesByEvidence,
  findDictionaryEntriesWithTextEvidence,
  analyzeCommentsWithDeepSeek,
  getDeepSeekConfig,
  mergeEntriesIntoDictionary,
  normalizeKeywordEntries,
  readKeywordDictionary,
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

test('analyzeCommentsWithDeepSeek asks DeepSeek to analyze full sentence context', async () => {
  const requests = [];
  const result = await analyzeCommentsWithDeepSeek(
    {
      uid: 'mid 1',
      name: 'sentence tester',
      text: [
        '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
        '如果有原始数据我愿意改结论。',
      ].join('\n'),
    },
    {
      env: {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
      },
      fetch: async (url, options = {}) => {
        requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
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
                    axes: [
                      { axis: '对抗性动机', score: 45, evidence: ['先别急着扣帽子'], reasoning: '提醒对方不要贴标签，但没有转向人身攻击。' },
                    ],
                    sentenceAnalyses: [
                      {
                        quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
                        speechAct: '证据边界提醒',
                        target: '证据链覆盖范围',
                        stance: '反驳但保留合作空间',
                        contextRole: '要求对方回到证据充分性',
                        risk: 'low',
                        axisImpacts: [
                          {
                            axis: '证据敏感',
                            direction: 'positive',
                            strength: 0.8,
                            reasoning: '这句话要求回到证据覆盖范围。',
                          },
                          {
                            axis: '对抗性动机',
                            direction: 'risk',
                            strength: 0.2,
                            reasoning: '有反驳语气但没有人身攻击。',
                          },
                        ],
                        reasoning: '完整句表达的是证据不足和反贴标签，不应按“杠”字单独判定。',
                      },
                    ],
                    overall: { riskBand: '低风险讨论型', summary: '样本偏证据讨论。' },
                    confidence: 0.82,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  const analyzeRequest = requests.find((request) => request.url.endsWith('/chat/completions'));
  const userPrompt = analyzeRequest.body.messages.find((message) => message.role === 'user').content;

  assert.equal(result.ok, true);
  assert.equal(userPrompt.includes('逐句分析'), true);
  assert.equal(userPrompt.includes('不要只按单个关键词或梗词定性'), true);
  assert.equal(userPrompt.includes('不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。'), true);
  assert.deepEqual(result.sentenceAnalyses, [
    {
      quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
      speechAct: '证据边界提醒',
      target: '证据链覆盖范围',
      stance: '反驳但保留合作空间',
      contextRole: '要求对方回到证据充分性',
      risk: 'low',
      axisImpacts: [
        {
          axis: '证据敏感',
          direction: 'positive',
          strength: 0.8,
          reasoning: '这句话要求回到证据覆盖范围。',
        },
        {
          axis: '对抗性动机',
          direction: 'risk',
          strength: 0.2,
          reasoning: '有反驳语气但没有人身攻击。',
        },
      ],
      reasoning: '完整句表达的是证据不足和反贴标签，不应按“杠”字单独判定。',
    },
  ]);
  assert.equal(userPrompt.includes('axisImpacts'), true);
});

test('analyzeCommentsWithDeepSeek grounds sentence radar quotes to original comments', async () => {
  const originalSentence = '\u4e0d\u662f\u6211\u6760\uff0c\u4f60\u8fd9\u4e2a\u8bc1\u636e\u94fe\u53ea\u8986\u76d6\u4e00\u4e2a\u6837\u672c\uff0c\u5148\u522b\u6025\u7740\u6263\u5e3d\u5b50\u3002';
  const result = await analyzeCommentsWithDeepSeek(
    {
      uid: 'mid 2',
      name: 'quote grounding tester',
      text: [originalSentence, '\u5982\u679c\u6709\u539f\u59cb\u6570\u636e\u6211\u613f\u610f\u6539\u7ed3\u8bba\u3002'].join('\n'),
    },
    {
      env: {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
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
                    axes: [],
                    sentenceAnalyses: [
                      {
                        quote: '\u4f60\u8fd9\u4e2a\u8bc1\u636e\u94fe\u53ea\u8986\u76d6\u4e00\u4e2a\u6837\u672c\uff0c\u522b\u6025\u7740\u6263\u5e3d\u5b50',
                        speechAct: '\u8bc1\u636e\u8fb9\u754c\u63d0\u9192',
                        target: '\u8bc1\u636e\u94fe\u8986\u76d6\u8303\u56f4',
                        risk: 'low',
                        axisImpacts: [{ axis: '\u8bc1\u636e\u654f\u611f', direction: 'positive', strength: 0.8 }],
                      },
                      {
                        quote: '\u8fd9\u662f\u539f\u6587\u6ca1\u6709\u7684\u5e7b\u89c9\u53e5\u5b50',
                        speechAct: '\u5e7b\u89c9\u5f15\u7528',
                        target: '\u4e0d\u5b58\u5728\u7684\u539f\u6587',
                        risk: 'high',
                        axisImpacts: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', direction: 'risk', strength: 0.9 }],
                      },
                    ],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u6837\u672c\u504f\u8bc1\u636e\u8ba8\u8bba\u3002' },
                    confidence: 0.82,
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
  assert.deepEqual(result.sentenceAnalyses.map((item) => item.quote), [originalSentence]);
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

test('normalizes away truncated sentence fragments from keyword terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4f46\u6211\u7edd\u5bf9\u4e0d\u4f1a\u53bb\u7978\u5bb3\u522b',
      family: 'cooperation',
      meaning: 'truncated sentence fragment',
      evidenceCount: 1,
      evidenceSamples: ['\u4f46\u6211\u7edd\u5bf9\u4e0d\u4f1a\u53bb\u7978\u5bb3\u522b\u4eba'],
    },
    {
      term: '\u4e0d\u662f\u6760',
      family: 'cooperation',
      meaning: 'stable discourse marker',
      evidenceCount: 1,
      evidenceSamples: ['\u4e0d\u662f\u6760\uff0c\u8fd9\u53e5\u8bdd\u6709\u70b9\u95ee\u9898'],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u4e0d\u662f\u6760']);
});

test('normalizes away suffix-only Bilibili emote variants', () => {
  const entries = normalizeKeywordEntries([
    {
      term: 'Cat_confuse',
      variants: ['confuse'],
      family: 'cooperation',
      meaning: 'Bilibili emote marker copied from a bracket expression',
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['catconfuse']);
});

test('normalizes Bilibili emote wrapper artifacts to the spoken keyword', () => {
  const entries = normalizeKeywordEntries([
    { term: '\u70ed\u8bcd\u7cfb\u5217_\u77e5\u8bc6\u76f2\u533a', family: 'evasion', meaning: 'Bilibili hot-word emote wrapper' },
    { term: '\u70ed\u8bcd\u7cfb\u5217\u5999\u554a', family: 'cooperation', meaning: 'Bilibili hot-word emote wrapper' },
    { term: '\u61c2\u4e86\u5427doge', family: 'evasion', meaning: 'comment phrase with a trailing doge emote' },
    { term: 'doge', family: 'cooperation', meaning: 'standalone Bilibili emote shorthand' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u77e5\u8bc6\u76f2\u533a', '\u5999\u554a', '\u61c2\u4e86\u5427', 'doge']);
});

test('normalizes mixed-case ASCII runs inside keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: 'Doge', family: 'cooperation', meaning: 'mixed case Bilibili shorthand' },
    { term: 'UP\u4e3b', family: 'cooperation', meaning: 'Bilibili uploader shorthand' },
    { term: '\u5168B\u7ad9', family: 'absolutes', meaning: 'mixed Chinese and Latin platform name' },
    { term: 'PUA', family: 'attack', meaning: 'internet discourse acronym' },
    { term: 'A\u5230\u7206\u70b8', family: 'cooperation', meaning: 'mixed Latin adjective phrase' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['doge', 'up\u4e3b', '\u5168b\u7ad9', 'pua', 'a\u5230\u7206\u70b8']);
});

test('normalizes away keyword entries backed only by file-share ad evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7edd\u5bf9\u56de\u5f52',
      family: 'absolutes',
      meaning: 'title fragment from a file-share advert',
      evidenceCount: 1,
      evidenceSamples: ['\u3010\u8d85\u7ea7\u4f1a\u5458V4\u3011\u901a\u8fc7\u767e\u5ea6\u7f51\u76d8\u5206\u4eab\u7684\u6587\u4ef6\uff1a\u7edd\u5bf9\u56de\u5f52\u3010\u8bd5\u770b\u3011\u2026'],
      evidenceSources: [
        {
          source: 'Bilibili public search-discovered video comment scan',
          uid: 'BV-file-share',
          sample: '\u3010\u8d85\u7ea7\u4f1a\u5458V4\u3011\u901a\u8fc7\u767e\u5ea6\u7f51\u76d8\u5206\u4eab\u7684\u6587\u4ef6\uff1a\u7edd\u5bf9\u56de\u5f52\u3010\u8bd5\u770b\u3011\u2026',
        },
      ],
    },
    {
      term: '\u7edd\u5bf9\u4e0d\u591f\u7684',
      family: 'absolutes',
      meaning: 'real comment evidence',
      evidenceCount: 1,
      evidenceSamples: ['\u4f60\u8fd9\u8010\u529b\u662f\u771f\u7684\u5077\uff0c\u7edd\u5bf9\u4e0d\u591f\u7684'],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u7edd\u5bf9\u4e0d\u591f\u7684']);
});

test('normalizes away title-spliced video-context-only keyword terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5361\u9a6c\u65af\u514b\u8116\u5b50',
      family: 'attack',
      meaning: '\u4ece\u89c6\u9891\u6807\u9898\u62fc\u63a5\u51fa\u7684\u4e13\u540d\u548c\u5361\u8116\u5b50\u7247\u6bb5',
      evidenceCount: 1,
      evidenceSamples: ['Bilibili video context: \u3010\u7b2c186\u671f\u3011\u53c8\u53c8\u53c8\u5361\u9a6c\u65af\u514b\u8116\u5b50\u4e86\uff01'],
      evidenceSources: [
        {
          source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BV1EyDBBeE8a/',
          uid: 'BV1EyDBBeE8a',
          sample: 'Bilibili video context: \u3010\u7b2c186\u671f\u3011\u53c8\u53c8\u53c8\u5361\u9a6c\u65af\u514b\u8116\u5b50\u4e86\uff01',
        },
      ],
    },
    {
      term: '\u5361\u8116\u5b50',
      family: 'attack',
      meaning: '\u4e92\u8054\u7f51\u8ba8\u8bba\u91cc\u5bf9\u88ab\u9650\u5236\u6216\u5236\u88c1\u7684\u6bd4\u55bb',
      evidenceCount: 1,
      evidenceSamples: ['\u8fd9\u4e0d\u5c31\u662f\u88ab\u5361\u8116\u5b50\u4e86\u5417'],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5361\u8116\u5b50']);
});

test('normalizes away ask-baidu song title video-context evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u95ee\u767e\u5ea6',
      family: 'evasion',
      meaning: '\u628a\u89e3\u91ca\u8d23\u4efb\u8f6c\u79fb\u7ed9\u641c\u7d22\u5f15\u64ce',
      evidenceCount: 2,
      evidenceSamples: [
        'Bilibili video context: \u8bf7\u6b23\u8d4f\u9648\u745e\u6f14\u5531\u7684\u6b4c\u66f2\u300a\u95ee\u767e\u5ea6\u300b',
        'Bilibili video context: \u8fd9\u6bb5\u65f6\u95f4\u8fd9\u9996\u6b4c\u53c8\u706b\u4e86\u300a\u95ee\u767e\u5ea6\u300b\u9648\u745e\u6f14\u5531',
      ],
      evidenceSources: [
        {
          source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BV-baidu-song/',
          uid: 'BV-baidu-song',
          sample: 'Bilibili video context: \u8bf7\u6b23\u8d4f\u9648\u745e\u6f14\u5531\u7684\u6b4c\u66f2\u300a\u95ee\u767e\u5ea6\u300b',
        },
      ],
    },
    {
      term: '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528',
      family: 'evasion',
      meaning: '\u62d2\u7edd\u63d0\u4f9b\u4fe1\u606f\u5e76\u8d2c\u4f4e\u641c\u7d22\u5f15\u64ce',
      evidenceCount: 1,
      evidenceSamples: ['Bilibili video context: \u300a\u95ee\u767e\u5ea6\u300bMV\u539f\u5531\u6b4c\u66f2'],
      evidenceSources: [
        {
          source: 'Bilibili public search-discovered video context',
          uid: 'BV-baidu-mv',
          sample: 'Bilibili video context: \u300a\u95ee\u767e\u5ea6\u300bMV\u539f\u5531\u6b4c\u66f2',
        },
      ],
    },
    {
      term: '\u95ee\u767e\u5ea6',
      family: 'evasion',
      meaning: '\u771f\u5b9e\u8bc4\u8bba\u91cc\u628a\u8bf4\u660e\u8d23\u4efb\u8f6c\u79fb\u7ed9\u641c\u7d22',
      evidenceCount: 1,
      evidenceSamples: ['\u8fd9\u4f60\u90fd\u4e0d\u4f1a\u81ea\u5df1\u95ee\u767e\u5ea6\u5417'],
      evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-baidu-comment', sample: '\u8fd9\u4f60\u90fd\u4e0d\u4f1a\u81ea\u5df1\u95ee\u767e\u5ea6\u5417' }],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u95ee\u767e\u5ea6']);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u4f60\u90fd\u4e0d\u4f1a\u81ea\u5df1\u95ee\u767e\u5ea6\u5417']);
});

test('normalizes away misleading car-army video-context-only evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u8f66\u5bb6\u519b',
      family: 'attack',
      meaning: '\u6307\u4ee3\u7279\u5b9a\u7c89\u4e1d\u7fa4\u4f53\uff0c\u7528\u4e8e\u9635\u8425\u653b\u51fb\u6216\u5632\u8bbd',
      evidenceCount: 2,
      evidenceSamples: [
        'Bilibili video context: \u4f59\u627f\u4e1c\u548c\u96f7\u519b\u7c89\u4e1d\u5bf9\u6bd4\uff0c\u96f7\u519b\u7684\u82f9\u679c\u7c89\u4e1d\u6bd4\u8f83\u591a',
        'Bilibili video context: \u822a\u5929\u8f66\u5bb6\u519b\uff0c\u76ae\u76ae\u867e\u4e8b\u4ef6\u53cd\u8f6c',
      ],
      evidenceSources: [
        {
          source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BV-context/',
          uid: 'BV-context',
          sample: 'Bilibili video context: \u822a\u5929\u8f66\u5bb6\u519b\uff0c\u76ae\u76ae\u867e\u4e8b\u4ef6\u53cd\u8f6c',
        },
      ],
    },
    {
      term: '\u6ca1\u6709\u8f66\u5bb6\u519b',
      family: 'attack',
      meaning: '\u5426\u8ba4\u7279\u5b9a\u7c89\u4e1d\u9635\u8425\u5b58\u5728\u5e76\u8fdb\u884c\u9635\u8425\u5bf9\u7acb',
      evidenceCount: 1,
      evidenceSamples: ['Bilibili video context: \u4f59\u627f\u4e1c\u548c\u96f7\u519b\u7c89\u4e1d\u5bf9\u6bd4'],
    },
    {
      term: '\u8f66\u5bb6\u519b',
      family: 'attack',
      meaning: '\u771f\u5b9e\u8bc4\u8bba\u8bc1\u636e',
      evidenceCount: 1,
      evidenceSamples: ['\u5c0f\u7c73SU7\u8fd9\u4e8b\u4e00\u51fa\uff0c\u8f66\u5bb6\u519b\u53c8\u6765\u63a7\u8bc4\u4e86'],
      evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-car-comment', sample: '\u5c0f\u7c73SU7\u8fd9\u4e8b\u4e00\u51fa\uff0c\u8f66\u5bb6\u519b\u53c8\u6765\u63a7\u8bc4\u4e86' }],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u8f66\u5bb6\u519b']);
  assert.deepEqual(entries[0].evidenceSamples, ['\u5c0f\u7c73SU7\u8fd9\u4e8b\u4e00\u51fa\uff0c\u8f66\u5bb6\u519b\u53c8\u6765\u63a7\u8bc4\u4e86']);
});

test('mergeEntriesIntoDictionary prunes persisted title-spliced video-context-only terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-title-splice-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u5361\u9a6c\u65af\u514b\u8116\u5b50',
            family: 'attack',
            meaning: '\u4ece\u89c6\u9891\u6807\u9898\u62fc\u63a5\u51fa\u7684\u4e13\u540d\u548c\u5361\u8116\u5b50\u7247\u6bb5',
            evidenceCount: 1,
            evidenceSamples: ['Bilibili video context: \u3010\u7b2c186\u671f\u3011\u53c8\u53c8\u53c8\u5361\u9a6c\u65af\u514b\u8116\u5b50\u4e86\uff01'],
            evidenceSources: [
              {
                source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BV1EyDBBeE8a/',
                uid: 'BV1EyDBBeE8a',
                sample: 'Bilibili video context: \u3010\u7b2c186\u671f\u3011\u53c8\u53c8\u53c8\u5361\u9a6c\u65af\u514b\u8116\u5b50\u4e86\uff01',
              },
            ],
          },
          {
            term: '\u5361\u8116\u5b50',
            family: 'attack',
            meaning: '\u4e92\u8054\u7f51\u8ba8\u8bba\u91cc\u5bf9\u88ab\u9650\u5236\u6216\u5236\u88c1\u7684\u6bd4\u55bb',
            evidenceCount: 1,
            evidenceSamples: ['\u8fd9\u4e0d\u5c31\u662f\u88ab\u5361\u8116\u5b50\u4e86\u5417'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['\u5361\u8116\u5b50']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary compacts persisted Bilibili emote wrapper artifacts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-emote-wrapper-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { term: '\u70ed\u8bcd\u7cfb\u5217\u77e5\u8bc6\u76f2\u533a', family: 'evasion', meaning: 'Bilibili hot-word emote wrapper', evidenceCount: 1 },
          { term: '\u77e5\u8bc6\u76f2\u533a', family: 'evasion', meaning: 'spoken phrase from the same emote', evidenceCount: 1 },
          { term: '\u61c2\u4e86\u5427doge', family: 'evasion', meaning: 'comment phrase with trailing doge emote', evidenceCount: 1 },
          { term: '\u61c2\u4e86\u5427', family: 'evasion', meaning: 'spoken phrase without the emote suffix', evidenceCount: 1 },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['\u61c2\u4e86\u5427', '\u77e5\u8bc6\u76f2\u533a']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readKeywordDictionary returns the normalized canonical dictionary view', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-read-normalized-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { term: 'Doge', family: 'cooperation', meaning: 'mixed-case emote shorthand', evidenceCount: 1, evidenceSamples: ['Doge appears'] },
          { term: 'doge', family: 'cooperation', meaning: 'lowercase emote shorthand', evidenceCount: 1, evidenceSamples: ['doge appears'] },
          {
            term: '\u7edd\u5bf9\u56de\u5f52',
            family: 'absolutes',
            meaning: 'file-share advert title fragment',
            evidenceCount: 1,
            evidenceSamples: ['\u3010\u8d85\u7ea7\u4f1a\u5458V4\u3011\u901a\u8fc7\u767e\u5ea6\u7f51\u76d8\u5206\u4eab\u7684\u6587\u4ef6\uff1a\u7edd\u5bf9\u56de\u5f52\u3010\u8bd5\u770b\u3011\u2026'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await readKeywordDictionary({ dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['doge']);
    assert.equal(dictionary.entries[0].evidenceCount, 2);
    assert.deepEqual(dictionary.families.cooperation, ['doge']);
    assert.deepEqual(dictionary.families.absolutes, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('normalizes away standalone URL host fragments from keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: 'mps', family: 'evidence', meaning: 'domain fragment copied from cyberpolice.mps.gov.cn URL' },
    { term: 'gov', family: 'evidence', meaning: 'domain suffix copied from a government URL' },
    { term: 'cn', family: 'evidence', meaning: 'country TLD copied from a URL' },
    { term: 'cyberpolice', family: 'evidence', meaning: 'network police reporting concept from a cited URL' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), []);
});

test('normalizes away weak ASCII technical and id fragments while keeping known Bilibili shorthand', () => {
  const entries = normalizeKeywordEntries([
    { term: 'API', family: 'evidence', meaning: 'technical acronym copied from a video title' },
    { term: 'BUG', family: 'evidence', meaning: 'generic English issue word' },
    { term: 'MVP', family: 'cooperation', meaning: 'generic product acronym' },
    { term: 'NPC', family: 'attack', meaning: 'generic game abbreviation without Chinese context' },
    { term: 'R2', family: 'evidence', meaning: 'short id-like fragment' },
    { term: 'STLINE', family: 'evidence', meaning: 'asset or uploader id fragment' },
    { term: 'doge', family: 'cooperation', meaning: 'Bilibili emote shorthand' },
    { term: 'dddd', family: 'evidence', meaning: 'understood-by-insiders shorthand' },
    { term: 'yygq', family: 'attack', meaning: 'yin-yang sarcasm shorthand' },
    { term: 'wdnmd', family: 'attack', meaning: 'Chinese internet insult shorthand' },
    { term: 'nocap', family: 'evidence', meaning: 'internet slang shorthand' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['doge', 'dddd', 'yygq', 'wdnmd', 'nocap']);
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

test('mergeEntriesIntoDictionary prunes persisted weak ASCII technical and id fragments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-ascii-fragments-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { term: 'API', family: 'evidence', meaning: 'technical acronym copied from a video title', evidenceCount: 1 },
          { term: 'BUG', family: 'evidence', meaning: 'generic English issue word', evidenceCount: 1 },
          { term: 'MVP', family: 'cooperation', meaning: 'generic product acronym', evidenceCount: 1 },
          { term: 'R2', family: 'evidence', meaning: 'short id-like fragment', evidenceCount: 1 },
          { term: 'doge', family: 'cooperation', meaning: 'Bilibili emote shorthand', evidenceCount: 1 },
          { term: 'yygq', family: 'attack', meaning: 'yin-yang sarcasm shorthand', evidenceCount: 1 },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['yygq', 'doge']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary prunes persisted suffix-only emote fragments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-emote-fragment-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: 'Catconfuse',
            family: 'cooperation',
            meaning: 'Bilibili emote marker copied from a bracket expression',
            evidenceCount: 1,
            evidenceSamples: ['sample [Cat_confuse] comment'],
          },
          {
            term: 'confuse',
            family: 'cooperation',
            meaning: 'Bilibili emote marker copied from a bracket expression',
            evidenceCount: 1,
            evidenceSamples: ['sample [Cat_confuse] comment'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['catconfuse']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary does not expand variants from persisted entries during evidence refresh', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-no-persisted-variant-expansion-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u76ee\u6807\u5f31\u8bcd',
            family: 'attack',
            meaning: 'existing target term',
            variants: ['\u4e0d\u5e94\u8be5\u53d8\u6210\u65b0\u8bcd'],
            evidenceCount: 1,
            evidenceSamples: ['old sample'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary(
      [
        {
          term: '\u76ee\u6807\u5f31\u8bcd',
          family: 'attack',
          meaning: 'existing target term',
          evidenceCount: 1,
          evidenceSamples: ['new sample'],
        },
      ],
      { dictionaryPath },
    );

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['\u76ee\u6807\u5f31\u8bcd']);
    assert.equal(dictionary.entries[0].evidenceCount, 2);
    assert.equal(dictionary.entries[0].evidenceSamples.includes('new sample'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary keeps fresh comment evidence when context samples are already capped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-comment-evidence-priority-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u5178\u4e2d\u5178',
            family: 'attack',
            meaning: 'classic repeated meme pattern',
            evidenceCount: 5,
            evidenceSamples: [
              'Bilibili video context: context sample 1 \u5178\u4e2d\u5178',
              'Bilibili video context: context sample 2 \u5178\u4e2d\u5178',
              'Bilibili video context: context sample 3 \u5178\u4e2d\u5178',
              'Bilibili video context: context sample 4 \u5178\u4e2d\u5178',
              'Bilibili video context: context sample 5 \u5178\u4e2d\u5178',
            ],
            evidenceSources: [
              { source: 'Bilibili public search-discovered video context', uid: 'BVcontext1', sample: 'Bilibili video context: context sample 1 \u5178\u4e2d\u5178' },
              { source: 'Bilibili public search-discovered video context', uid: 'BVcontext2', sample: 'Bilibili video context: context sample 2 \u5178\u4e2d\u5178' },
              { source: 'Bilibili public search-discovered video context', uid: 'BVcontext3', sample: 'Bilibili video context: context sample 3 \u5178\u4e2d\u5178' },
              { source: 'Bilibili public search-discovered video context', uid: 'BVcontext4', sample: 'Bilibili video context: context sample 4 \u5178\u4e2d\u5178' },
              { source: 'Bilibili public search-discovered video context', uid: 'BVcontext5', sample: 'Bilibili video context: context sample 5 \u5178\u4e2d\u5178' },
            ],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary(
      [
        {
          term: '\u5178\u4e2d\u5178',
          family: 'attack',
          meaning: 'classic repeated meme pattern',
          evidenceCount: 1,
          evidenceSamples: ['\u8fd9\u53d1\u8a00\u771f\u662f\u5178\u4e2d\u5178'],
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVcomment/',
              uid: 'BVcomment',
              sample: '\u8fd9\u53d1\u8a00\u771f\u662f\u5178\u4e2d\u5178',
            },
          ],
        },
      ],
      { dictionaryPath },
    );

    const entry = dictionary.entries.find((item) => item.term === '\u5178\u4e2d\u5178');
    assert.equal(entry.evidenceSamples.includes('\u8fd9\u53d1\u8a00\u771f\u662f\u5178\u4e2d\u5178'), true);
    assert.equal(entry.evidenceSources.some((source) => source.uid === 'BVcomment'), true);
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

test('mergeEntriesIntoDictionary compacts same-family ASCII case variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-casefold-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: 'doge',
            family: 'cooperation',
            meaning: 'lowercase Bilibili emote marker',
            evidenceCount: 1,
            evidenceSamples: ['this comment uses doge'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-lower', sample: 'this comment uses doge' }],
          },
          {
            term: 'Doge',
            family: 'cooperation',
            meaning: 'uppercase Bilibili emote marker',
            evidenceCount: 1,
            evidenceSamples: ['Doge appears in mixed case'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-upper', sample: 'Doge appears in mixed case' }],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const lower = dictionary.entries.find((entry) => entry.term === 'doge');

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['doge']);
    assert.equal(lower.evidenceCount, 2);
    assert.deepEqual(lower.evidenceSamples, ['this comment uses doge', 'Doge appears in mixed case']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary shares evidence across same-meaning Chinese phrase variants', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-contained-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4',
            family: 'attack',
            meaning: 'same complaint phrase',
            evidenceCount: 1,
            evidenceSamples: ['\u771f\u7684\u662f\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-contained', sample: '\u771f\u7684\u662f\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4' }],
          },
          {
            term: '\u5403\u4e86\u4e09\u5768\u7fd4',
            family: 'attack',
            meaning: 'same complaint phrase',
            evidenceCount: 0,
            evidenceSamples: [],
            evidenceSources: [],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const shorter = dictionary.entries.find((entry) => entry.term === '\u5403\u4e86\u4e09\u5768\u7fd4');

    assert.equal(shorter.evidenceCount, 1);
    assert.deepEqual(shorter.evidenceSamples, ['\u771f\u7684\u662f\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4']);
    assert.equal(shorter.evidenceSources[0].uid, 'BV-contained');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary shares evidence across contained Chinese variants with shared samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-contained-sample-evidence-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u6025\u4e86',
            family: 'attack',
            meaning: 'generic emotional accusation',
            evidenceCount: 2,
            evidenceSamples: ['\u4e8b\u5b9e\u7f62\u4e86\uff0c\u662f\u4f60\u6025\u4e86', '\u4f60\u600e\u4e48\u53c8\u6025\u4e86'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-shared', sample: '\u4e8b\u5b9e\u7f62\u4e86\uff0c\u662f\u4f60\u6025\u4e86' }],
          },
          {
            term: '\u4f60\u6025\u4e86',
            family: 'attack',
            meaning: 'direct second-person emotional accusation',
            evidenceCount: 1,
            evidenceSamples: ['\u4e8b\u5b9e\u7f62\u4e86\uff0c\u662f\u4f60\u6025\u4e86'],
            evidenceSources: [{ source: 'Bilibili public video comment scan', uid: 'BV-shared', sample: '\u4e8b\u5b9e\u7f62\u4e86\uff0c\u662f\u4f60\u6025\u4e86' }],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const longer = dictionary.entries.find((entry) => entry.term === '\u4f60\u6025\u4e86');

    assert.equal(longer.evidenceCount, 2);
    assert.deepEqual(longer.evidenceSamples, ['\u4e8b\u5b9e\u7f62\u4e86\uff0c\u662f\u4f60\u6025\u4e86', '\u4f60\u600e\u4e48\u53c8\u6025\u4e86']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary keeps canonical ASCII terms split by family confidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-casefold-family-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: 'doge',
            family: 'cooperation',
            meaning: 'Bilibili emote marker',
            evidenceCount: 2,
            evidenceSamples: ['nice one doge'],
          },
          {
            term: 'Doge',
            family: 'attack',
            meaning: 'unrelated brand or topic marker',
            evidenceCount: 0,
            evidenceSamples: [],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const entry = dictionary.entries.find((item) => item.term === 'doge');

    assert.deepEqual(dictionary.entries.map((item) => item.term), ['doge']);
    assert.equal(entry.family, 'cooperation');
    assert.equal(entry.evidenceCount, 2);
    assert.deepEqual(entry.evidenceSamples, ['nice one doge']);
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

test('normalizes redundant numeric percent prefixes into percent discourse terms', () => {
  const entries = normalizeKeywordEntries([
    { term: '100百分百', family: 'absolutes', meaning: 'absolute certainty phrasing' },
    { term: '百分百', family: 'absolutes', meaning: 'absolute certainty phrasing' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['百分百']);
});

test('normalizes away Bilibili object IDs from keyword terms', () => {
  const entries = normalizeKeywordEntries([
    { term: 'BV11W3nz2Ed2', family: 'evidence', meaning: 'Bilibili video ID copied from source URL' },
    { term: 'av123456789', family: 'evidence', meaning: 'Bilibili av ID copied from source URL' },
    { term: 'BV号', family: 'evidence', meaning: 'discussion about Bilibili ids as text' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['bv号']);
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

test('findDictionaryEntriesWithTextEvidence maps missed comment wording variants back to target terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5835\u4f4f\u4eba\u6c11\u5634', family: 'attack', meaning: 'accuse someone of blocking public speech' },
        { term: '\u9ad8\u5b8c\u4e86', family: 'attack', meaning: 'sarcastic phrase for showing off too much' },
        { term: '\u61c2\u7684', family: 'evasion', meaning: 'implicit insider shorthand' },
      ],
    },
    '\u4f60\u662f\u8bf4\u6342\u4f4f\u4eba\u6c11\u7684\u5634\u5417\uff1f\n\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86\n\u61c2\u7684\u90fd\u61c2\uff0c\u522b\u95ee',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-missed-variants/',
      uid: 'BV-missed-variants',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5835\u4f4f\u4eba\u6c11\u5634', '\u9ad8\u5b8c\u4e86', '\u61c2\u7684']);
  assert.equal(entries.every((entry) => entry.evidenceCount === 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-missed-variants'), true);
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

test('findDictionaryEntriesWithTextEvidence maps search-dismissal wording back to ask-baidu terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u95ee\u767e\u5ea6', family: 'evasion', meaning: 'dismiss the other side by telling them to search' },
        { term: '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528', family: 'evasion', meaning: 'dismiss Baidu searching as useless' },
      ],
    },
    '\u8fd9\u4e2a\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417\uff1f\n\u81ea\u5df1\u767e\u5ea6\u4e00\u4e0b\u4e0d\u5c31\u884c\u4e86\uff1f\n\u767e\u5ea6\u4e00\u4e0b\u554a',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-baidu-dismissal/',
      uid: 'BV-baidu-dismissal',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528']);
  assert.equal(entries.every((entry) => entry.evidenceCount > 0), true);
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

test('findDictionaryEntriesWithTextEvidence maps common comment variants back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7ef7\u4e0d\u4f4f\u4e86', family: 'attack', meaning: 'cannot hold back laughter or sarcasm' },
        { term: '\u6ca1\u7528\u771f\u662f\u7ef7\u4e0d\u4f4f\u4e86', family: 'attack', meaning: 'mock uselessness' },
        { term: '\u90fd\u662f\u5bb6\u4eba', family: 'cooperation', meaning: 'parasocial family wording' },
        { term: '\u5bb6\u4eba', family: 'cooperation', meaning: 'parasocial family wording' },
      ],
    },
    '\u8fd9\u4e2a\u53d8\u58f0\u5668\u771f\u6ca1\u7ef7\u4f4f\n\u7eed\u822a\u6ca1\u7528\u771f\u7ef7\u4e0d\u4f4f\n\u5bb6\u4eba\u4eec\u8c01\u61c2\u554a\uff0c\u8bc4\u8bba\u533a\u7b11\u4e0d\u6d3b',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-common-alias/',
      uid: 'BV-common-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u7ef7\u4e0d\u4f4f\u4e86',
    '\u6ca1\u7528\u771f\u662f\u7ef7\u4e0d\u4f4f\u4e86',
    '\u90fd\u662f\u5bb6\u4eba',
    '\u5bb6\u4eba',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-common-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps repeated weak miss aliases back to targets', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u670d\u61cb\u7740', family: 'attack', meaning: 'dismiss dissent' },
        { term: '\u88c5\u4ec0\u4e48', family: 'attack', meaning: 'challenge posture' },
        { term: '\u521d\u542c\u4e0d\u77e5\u66f2\u4e2d\u610f', family: 'cooperation', meaning: 'song reflection phrase' },
        { term: '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981', family: 'attack', meaning: 'mock self importance' },
      ],
    },
    '\u4e0d\u670d\u4e5f\u61cb\u7740\n\u4f60\u5728\u88c5\u4ec0\u4e48\n\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba\n\u4eca\u5929\u624d\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-repeat-miss-alias/',
      uid: 'BV-repeat-miss-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u670d\u61cb\u7740',
    '\u88c5\u4ec0\u4e48',
    '\u521d\u542c\u4e0d\u77e5\u66f2\u4e2d\u610f',
    '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-repeat-miss-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps fresh noisy-search aliases back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7092\u9e21\u597d\u7528', family: 'cooperation', meaning: 'colloquial praise for usability' },
        { term: '\u4e0d\u53ef\u62b5\u6297\u529b', family: 'attack', meaning: 'force majeure sarcasm' },
        { term: '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba', family: 'attack', meaning: 'commenting without watching' },
        { term: '\u62d4\u7fa4', family: 'cooperation', meaning: 'excellent effect wording' },
        { term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86', family: 'attack', meaning: 'gross-out joke wording' },
      ],
    },
    '\u8fd9\u5de5\u5177\u8d85\u7ea7\u597d\u7528\n\u8fd9\u5c5e\u4e8e\u4e0d\u53ef\u6297\u529b\u4e86\n\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba\n\u8fd9\u4e2a\u6548\u679c\u62d4\u7fa4\n\u90a3\u4e0d\u662f\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-fresh-alias/',
      uid: 'BV-fresh-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u7092\u9e21\u597d\u7528',
    '\u4e0d\u53ef\u62b5\u6297\u529b',
    '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba',
    '\u62d4\u7fa4',
    '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-fresh-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps controversy-search aliases back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5403\u4e8f\u662f\u798f', family: 'attack', meaning: 'sarcastic blessing about taking losses' },
        { term: '\u51fa\u5904', family: 'evidence', meaning: 'request for source citation' },
        { term: '\u963f\u7f8e\u8389\u5361', family: 'attack', meaning: 'mocking America wording' },
        { term: '\u4e0d\u4e00\u4e00', family: 'evasion', meaning: 'avoid enumerating replies' },
        { term: '\u5927\u9b54\u6cd5\u5e08', family: 'attack', meaning: 'internet wizard meme phrasing' },
        { term: '\u5730\u56fe\u70ae', family: 'attack', meaning: 'attack a whole group or region' },
        { term: '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684', family: 'attack', meaning: 'accuse comments of bot automation' },
      ],
    },
    [
      '\u8fd9\u798f\u7ed9\u4f60\uff0c\u4f60\u53bb\u5403\u4e8f\u5427',
      '\u6709\u51fa\u5904\u5417\uff0c\u53d1\u51fa\u5904\u770b\u770b',
      '\u963f\u7f8e\u5229\u5361\u53c8\u5f00\u59cb\u4e86',
      '\u5c31\u4e0d\u4e00\u4e00\u8bc4\u4ef7\u4e86',
      '\u4e09\u5341\u5c81\u9b54\u6cd5\u5e08\u7b97\u662f\u8001\u6897\u4e86',
      '\u522b\u5f00\u5730\u56fe\u70ae\uff0c\u8fd9\u5c31\u662f\u5730\u57df\u9ed1',
      '\u8fd9\u4e9b\u90fd\u662f\u673a\u5668\u4eba\u53d1\u7684\uff0c\u50cf\u6c34\u519b\u63a7\u8bc4',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-controversy-alias/',
      uid: 'BV-controversy-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u5403\u4e8f\u662f\u798f',
    '\u51fa\u5904',
    '\u963f\u7f8e\u8389\u5361',
    '\u4e0d\u4e00\u4e00',
    '\u5927\u9b54\u6cd5\u5e08',
    '\u5730\u56fe\u70ae',
    '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-controversy-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps short missed phrase aliases back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u522b\u55b7', family: 'attack', meaning: 'preemptively ask commenters not to attack' },
        { term: '\u4e0d\u9ed1\u4e0d\u5439', family: 'cooperation', meaning: 'claim neutral evaluation' },
        { term: '\u4e0d\u674e\u59d0', family: 'evasion', meaning: 'homophone for not understanding' },
        { term: '\u4e0d\u662f\u4eba\u4e86', family: 'attack', meaning: 'accuse someone of inhuman behavior' },
        { term: '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23', family: 'attack', meaning: 'criticize three no relationship stance' },
        { term: '\u5f20\u5634\u903c\u903c\u53e8\u53e8', family: 'attack', meaning: 'mock someone for talking endlessly' },
      ],
    },
    [
      '\u8f7b\u70b9\u55b7\uff0c\u6211\u53ea\u662f\u4e2a\u65b0\u4eba',
      '\u4e0d\u5439\u4e0d\u9ed1\uff0c\u8fd9\u6b21\u771f\u7684\u8fd8\u884c',
      '\u6211\u4e0d\u7406\u89e3\uff0c\u8fd9\u4e5f\u80fd\u6d17',
      '\u8fd9\u4eba\u771f\u4e0d\u662f\u4eba',
      '\u8fd9\u5c31\u662f\u4e09\u4e0d\u539f\u5219\uff0c\u592a\u7ecf\u5178\u4e86',
      '\u4ed6\u5c31\u4f1a\u903c\u903c\u53e8\u53e8',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-short-miss-alias/',
      uid: 'BV-short-miss-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u522b\u55b7',
    '\u4e0d\u9ed1\u4e0d\u5439',
    '\u4e0d\u674e\u59d0',
    '\u4e0d\u662f\u4eba\u4e86',
    '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23',
    '\u5f20\u5634\u903c\u903c\u53e8\u53e8',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-short-miss-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps current weak miss comment forms back to targets', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u8349\u751f', family: 'cooperation', meaning: 'laughing interaction phrase' },
        { term: '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236', family: 'absolutes', meaning: 'absolute claim about copied rhythm comments' },
        { term: '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211', family: 'absolutes', meaning: 'claim first coin support' },
        { term: '\u53d1\u56fe', family: 'evidence', meaning: 'ask for screenshot evidence' },
        { term: '\u996d\u5708\u5473', family: 'attack', meaning: 'criticize fandom style discourse' },
        { term: '\u8d29\u5b50\u5c0f\u53f7', family: 'attack', meaning: 'accuse reseller sockpuppet account' },
      ],
    },
    [
      '\u8fd9\u6bb5\u771f\u7684\u751f\u8349\uff0c\u5f39\u5e55\u90fd\u7b11\u75af\u4e86',
      '\u8fd9\u91cc\u5168\u662f\u590d\u5236\u5f39\u5e55\uff0c\u5e26\u8282\u594f\u592a\u660e\u663e',
      '\u6211\u7b2c\u4e00\u4e2a\u6295\u5e01\uff0c\u522b\u8ddf\u6211\u62a2',
      '\u4f60\u5148\u4e0a\u56fe\uff0c\u6709\u56fe\u518d\u8bf4',
      '\u8fd9\u8bc4\u8bba\u533a\u996d\u5708\u5473\u592a\u51b2\u4e86',
      '\u4e00\u770b\u5c31\u662f\u9ec4\u725b\u5c0f\u53f7\u5728\u5e26\u4ef7',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-current-miss-alias/',
      uid: 'BV-current-miss-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u8349\u751f',
    '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236',
    '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211',
    '\u53d1\u56fe',
    '\u996d\u5708\u5473',
    '\u8d29\u5b50\u5c0f\u53f7',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-current-miss-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps latest weak miss variants back to targets', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5f39\u6027\u56de\u5e94', family: 'attack', meaning: 'selective response criticism' },
        { term: '\u7c89\u4e1d\u7206\u7834', family: 'attack', meaning: 'fan mobbing threat' },
        { term: '\u5c01100\u5e74', family: 'absolutes', meaning: 'hundred year ban hyperbole' },
        { term: '\u5c01\u53f7100\u5e74', family: 'absolutes', meaning: 'account hundred year ban hyperbole' },
        { term: '\u7c89\u5a07\u4f60\u51e0', family: 'attack', meaning: 'pink aesthetic meme jab' },
        { term: '\u4e0d\u662f\u6760', family: 'cooperation', meaning: 'soften disagreement' },
        { term: '\u7eaf\u594b\u5173', family: 'attack', meaning: 'bad game level joke' },
        { term: '\u5927\u8dcc\u763e', family: 'attack', meaning: 'bossy lecturing urge' },
        { term: '\u8d1f\u5206\u6eda\u7c97', family: 'attack', meaning: 'low quality dismissal' },
      ],
    },
    [
      '\u8fd9\u4eba\u53ea\u56de\u5e94\u8fd9\u4e2a\uff0c\u4e0d\u56de\u5e94\u90a3\u4e2a\uff0c\u771f\u662f\u9009\u62e9\u6027\u56de\u5e94',
      '\u5c0f\u5fc3\u88ab\u7c89\u4e1d\u7206\u7834\uff0c\u4e0a\u6b21\u8fd8\u6709\u4eba\u88ab\u7c89\u4e1d\u6252\u5b66\u6821',
      '\u8fd9\u53f7\u76f4\u63a5\u5c01\u53f7100\u5e74\uff0c\u76f8\u5f53\u4e8e\u5c01\u5230100\u5e74',
      '\u8d26\u53f7\u5c01100\u5e74\u4e5f\u592a\u5938\u5f20\u4e86',
      '\u7c89\u8272\u5a07\u5ae9\u4f60\u51e0\u5c81\uff0c\u8fd9\u4e0d\u5c31\u662f\u7c89\u5a07\u4f60\u51e0',
      '\u4e0d\u662f\u6211\u6760\uff0c\u6211\u53ea\u662f\u89c9\u5f97\u8fd9\u4e2a\u8bc1\u636e\u4e0d\u591f',
      '\u8fd9\u5173\u771f\u7caa\uff0c\u7eaf\u7caa\u5173\u4e86',
      '\u4ed6\u53c8\u51fa\u6765\u8bad\u7c89\uff0c\u7239\u5473\u763e\u72af\u4e86',
      '\u8fd9\u4e2a\u89c6\u9891\u96f6\u5206\u6eda\u7c97\uff0c\u8d1f\u5206\u6eda',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-latest-weak-alias/',
      uid: 'BV-latest-weak-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u5f39\u6027\u56de\u5e94',
    '\u7c89\u4e1d\u7206\u7834',
    '\u5c01100\u5e74',
    '\u5c01\u53f7100\u5e74',
    '\u7c89\u5a07\u4f60\u51e0',
    '\u4e0d\u662f\u6760',
    '\u7eaf\u594b\u5173',
    '\u5927\u8dcc\u763e',
    '\u8d1f\u5206\u6eda\u7c97',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-latest-weak-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps follow-up weak variants back to targets', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5ddd\u5efa\u56fd', family: 'attack', meaning: 'Trump nickname' },
        { term: '\u5ddd\u666e', family: 'attack', meaning: 'Trump shorthand' },
        { term: '\u540a\u6253', family: 'attack', meaning: 'dominates comparison' },
        { term: '\u798f\u745e\u63a7', family: 'cooperation', meaning: 'furry fan shorthand' },
        { term: '\u9644\u8bae', family: 'cooperation', meaning: 'agreement marker' },
        { term: '\u590d\u6d3b\u8d5b', family: 'attack', meaning: 'comeback sarcasm' },
        { term: '\u5c2c\u5230\u62a0\u811a', family: 'attack', meaning: 'extreme awkwardness' },
        { term: '\u8be5\u9a82\u5c31\u9a82', family: 'evasion', meaning: 'vague criticism permission' },
        { term: '\u76d6\u4e16\u592a\u4fdd', family: 'attack', meaning: 'moderation-style label attack' },
        { term: '\u8d76\u7f9a\u7f8a', family: 'attack', meaning: 'euphemistic insult' },
        { term: '\u611f\u8c22\u6307\u6b63', family: 'correction', meaning: 'accepts correction' },
        { term: '\u5e72\u5d29\u963f', family: 'attack', meaning: 'platform attack shorthand' },
        { term: '\u5e72\u8d27', family: 'cooperation', meaning: 'substantive content praise' },
        { term: '\u5e72\u8d27up', family: 'cooperation', meaning: 'substantive creator praise' },
        { term: '\u5965\u5229\u7ed9', family: 'attack', meaning: 'hype slogan' },
        { term: '\u767e\u53d8\u9a6c\u4e01', family: 'cooperation', meaning: 'changing stance meme' },
        { term: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047', family: 'attack', meaning: 'fandom treatment sarcasm' },
        { term: '\u9ad8\u7ea7jn', family: 'attack', meaning: 'coded insult label' },
        { term: '\u6401\u8fd9\u6401\u8fd9', family: 'attack', meaning: 'repetitive sarcasm' },
      ],
    },
    [
      '\u5efa\u56fd\u540c\u5fd7\u53c8\u6765\u4e86\uff0c\u7279\u6717\u666e\u8fd9\u53d1\u8a00\u592a\u7ecf\u5178',
      '\u5ddd\u5efa\u56fd\u8fd9\u6ce2\u771f\u662f\u5ddd\u666e\u672c\u666e',
      '\u8fd9\u6f14\u6280\u5b8c\u7206\u5bf9\u9762\uff0c\u53ef\u4ee5\u8bf4\u662f\u78be\u538b',
      '\u8fd9\u89d2\u8272\u4e00\u770b\u5c31\u662ffurry\u63a7\u4f1a\u559c\u6b22\u7684\u798f\u745e',
      '\u81e3\u9644\u8bae\uff0c\u6211\u4e5f\u8868\u793a\u9644\u8bae',
      '\u4e92\u8054\u7f51\u590d\u6d3b\u8d5b\u53c8\u5f00\u6253\u4e86',
      '\u8fd9\u6bb5\u5c34\u5c2c\u5230\u62a0\u811a\uff0c\u90fd\u80fd\u62a0\u51fa\u4e09\u5ba4\u4e00\u5385',
      '\u8be5\u9a82\u9a82\uff0c\u8be5\u55b7\u5c31\u55b7\uff0c\u4f46\u4f60\u5f97\u8bf4\u6e05\u695a\u4e3a\u4ec0\u4e48',
      '\u8fd9\u79cd\u8a00\u8bba\u76d6\u4e16\u592a\u4fdd\u53c8\u6765\u4e86\uff0c\u8fd8\u6709\u4eba\u6253\u6210\u683c\u4e16\u592a\u4fdd',
      '\u6df1\u84dd\u8d76\u7f9a\u7f8a\u554a\uff0c\u8fd9\u5c31\u662f\u4e2a\u5e72\u4f60\u5a18\u7684\u53e3\u5934\u8868\u8fbe',
      '\u8c22\u8c22\u6307\u51fa\uff0c\u524d\u9762\u8bf4\u6cd5\u5df2\u4fee\u6b63',
      '\u9053\u53cb\u4eec\u8bf4\u8981\u5e72\u5d29\u963fB\uff0c\u522b\u771f\u641e\u5d29\u963fB\u4e86',
      '\u8fd9\u671f\u771f\u5e72\u8d27\uff0c\u6709\u5e72\u8d27\u7684\u5185\u5bb9\u53ef\u4ee5\u591a\u6765\u70b9',
      '\u8fd9\u79cd\u5e72\u8d27up\u4e3b\u548c\u5e72\u8d27\u535a\u4e3b\u503c\u5f97\u5173\u6ce8',
      '\u5965\u5229\u7ed9\u5144\u5f1f\u4eec\uff0c\u5965\u529b\u7ed9\u5e72\u4e86',
      '\u8fd9\u53d8\u6765\u53d8\u53bb\u50cf\u767e\u53d8\u9a6c\u4e01',
      '\u8fd9\u5c31\u662f\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047\uff0c\u9ad8\u5983\u5f85\u9047\u662f\u5427',
      '\u53c8\u662f\u9ad8\u7ea7JN\u53d1\u8a00\uff0c\u9ad8\u7ea7jn\u884c\u4e3a',
      '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462\uff0c\u522b\u6401\u8fd9\u5957\u5a03',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-follow-up-alias/',
      uid: 'BV-follow-up-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u5ddd\u5efa\u56fd',
    '\u5ddd\u666e',
    '\u540a\u6253',
    '\u798f\u745e\u63a7',
    '\u9644\u8bae',
    '\u590d\u6d3b\u8d5b',
    '\u5c2c\u5230\u62a0\u811a',
    '\u8be5\u9a82\u5c31\u9a82',
    '\u76d6\u4e16\u592a\u4fdd',
    '\u8d76\u7f9a\u7f8a',
    '\u611f\u8c22\u6307\u6b63',
    '\u5e72\u5d29\u963f',
    '\u5e72\u8d27',
    '\u5e72\u8d27up',
    '\u5965\u5229\u7ed9',
    '\u767e\u53d8\u9a6c\u4e01',
    '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047',
    '\u9ad8\u7ea7jn',
    '\u6401\u8fd9\u6401\u8fd9',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-follow-up-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps generated sentence-form aliases back to weak absolute terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '100\u597d\u8bc4', family: 'absolutes', meaning: 'absolute review score claim' },
        { term: '\u767e\u5206\u767e\u597d\u8bc4\u7387', family: 'absolutes', meaning: 'perfect review rate claim' },
        { term: '100\u6ca1\u95ee\u9898', family: 'absolutes', meaning: 'absolute safety claim' },
        { term: '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211', family: 'absolutes', meaning: 'first coin certainty claim' },
        { term: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c', family: 'absolutes', meaning: 'dismisses evidence value absolutely' },
        { term: '\u7edd\u5bf9\u53ef\u4ee5\u723d', family: 'absolutes', meaning: 'absolute fun claim' },
        { term: '\u7edd\u5bf9\u53ef\u4ee5\u723d\u4e00\u4e0b', family: 'absolutes', meaning: 'absolute fun claim with soft tail' },
        { term: '\u6beb\u65e0\u540a\u7528', family: 'absolutes', meaning: 'absolute uselessness claim' },
        { term: '\u6ca1\u540a\u7528', family: 'absolutes', meaning: 'absolute uselessness shorthand' },
        { term: '\u7f57\u795e\u4f1f\u5927', family: 'absolutes', meaning: 'unquestioned idol praise' },
        { term: '\u5168\u662f\u5047\u7684', family: 'absolutes', meaning: 'universal fake claim' },
        { term: '\u5168\u662f\u9502\u7535\u6c60', family: 'absolutes', meaning: 'universal component claim' },
        { term: '\u5168\u90fd\u8fd8\u5728', family: 'absolutes', meaning: 'universal retention claim' },
        { term: '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528', family: 'absolutes', meaning: 'all money personal-use claim' },
        { term: '\u5168\u5458be', family: 'absolutes', meaning: 'all characters bad ending claim' },
      ],
    },
    [
      '\u95f2\u9c7c\u8fd9\u4e2a\u8d26\u53f7\u770b\u8d77\u6765\u662f100%\u597d\u8bc4\uff0c\u4f46\u5f97\u770b\u5dee\u8bc4\u5185\u5bb9',
      '\u4ed6\u4eec\u53ea\u8bf4\u767e\u5206\u767e\u597d\u8bc4\uff0c\u6ca1\u8bf4\u4e3a\u4ec0\u4e48\u80fd\u4fdd\u6301\u597d\u8bc4\u7387',
      '\u4f60\u600e\u4e48\u786e\u5b9a\u5bf9\u65b9100%\u6ca1\u95ee\u9898\uff1f',
      '\u8fd9\u671f\u89c6\u9891\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211\u7684',
      '\u6240\u4ee5\u82f1\u56fd\u8336\u5305\u6709\u4e24\u6761\u7ebf\u5bf9\u5427\uff1f\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440\u3002',
      '\u8fd9\u4e2aBD\u7edd\u5bf9\u53ef\u4ee5\u723d\u4e00\u4e0b\uff0c\u4f46\u4e0d\u4e00\u5b9a\u9002\u5408\u6240\u6709\u4eba',
      '\u5982\u679c\u5bb3\u6015\u7ffb\u8f66\uff0c\u8bf4\u7edd\u5bf9\u53ef\u4ee5\u723d\u5c31\u592a\u6b66\u65ad\u4e86',
      '\u8fd9\u9053\u5177\u6ca1\u540a\u7528\uff0c\u7b80\u76f4\u6ca1\u6709\u540a\u7528',
      '\u94bb\u77f3\u66f4\u6beb\u65e0\u540a\u7528[doge]',
      '\u7f57\u795e\u4f1f\u5927\uff0c\u65e0\u9700\u591a\u8a00\u3002',
      '\u8fd9\u4e09\u4e2a\u56fe\u6807\u5168\u90fd\u662f\u5047\u7684\uff0c\u4e0d\u53ef\u80fd\u8fd9\u6837\u663e\u793a',
      '\u8fd9\u4e9b\u8bbe\u5907\u91cc\u9762\u5168\u90fd\u662f\u9502\u7535\u6c60\uff0c\u4e0d\u8981\u88c5\u4f5c\u6ca1\u5173\u7cfb',
      '\u6536\u5230\u7684\u793c\u7269\u5168\u662f\u8fd8\u5728\uff0c\u4e00\u4ef6\u90fd\u6ca1\u6254',
      '\u4f4e\u4e8e5000\u6ca1\u7a0e\uff0c\u6240\u6709\u94b1\u5168\u90fd\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528',
      '\u8fd9\u756a\u6240\u6709\u4eba\u90fdbe\uff0c\u6211\u771f\u7684\u65e0\u6cd5\u63a5\u53d7',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-generated-alias/',
      uid: 'BV-generated-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '100\u597d\u8bc4',
    '\u767e\u5206\u767e\u597d\u8bc4\u7387',
    '100\u6ca1\u95ee\u9898',
    '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211',
    '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c',
    '\u7edd\u5bf9\u53ef\u4ee5\u723d',
    '\u7edd\u5bf9\u53ef\u4ee5\u723d\u4e00\u4e0b',
    '\u6beb\u65e0\u540a\u7528',
    '\u6ca1\u540a\u7528',
    '\u7f57\u795e\u4f1f\u5927',
    '\u5168\u662f\u5047\u7684',
    '\u5168\u662f\u9502\u7535\u6c60',
    '\u5168\u90fd\u8fd8\u5728',
    '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528',
    '\u5168\u5458be',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-generated-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps colloquial sentence tails back to weak attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7', family: 'attack', meaning: 'accuses sensitive overreaction' },
        { term: '\u4e0d\u662f\u4eba\u4e86', family: 'attack', meaning: 'dehumanizing rhetorical attack' },
        { term: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86', family: 'attack', meaning: 'gross-out mockery' },
        { term: '\u5403\u4e86\u4e09\u5768\u7fd4', family: 'attack', meaning: 'strong disgust metaphor' },
        { term: '\u5403\u76f8\u592a\u96be\u770b', family: 'attack', meaning: 'ugly monetization criticism' },
        { term: '\u6401\u8fd9\u5462', family: 'attack', meaning: 'mocking redundant speech' },
        { term: '\u9ad8\u5b8c\u4e86', family: 'attack', meaning: 'sarcastic one-upmanship' },
        { term: '\u72d7\u5c41\u4e0d\u901a', family: 'attack', meaning: 'dismisses logic as nonsense' },
        { term: '\u5173\u4e86\u5427', family: 'attack', meaning: 'dismissive shutdown request' },
        { term: '\u597d\u81ea\u4e3a\u4e4b', family: 'attack', meaning: 'warning dismissal' },
        { term: '\u5f88\u61c2\u561b', family: 'attack', meaning: 'sarcastic expertise jab' },
        { term: '\u8fd8\u6562\u53d1\u89c6\u9891', family: 'attack', meaning: 'mocking posting again' },
        { term: '\u7b11\u5760\u673a', family: 'attack', meaning: 'laughing crash hyperbole' },
        { term: '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9', family: 'attack', meaning: 'classic no-content reading criticism' },
        { term: '\u7cbe\u795e\u7537', family: 'attack', meaning: 'gendered mindset insult' },
        { term: '\u6485\u9192', family: 'attack', meaning: 'mocked awakened identity' },
        { term: '\u79d1\u6280\u4e0e\u72e0\u6d3b', family: 'attack', meaning: 'additive gimmick criticism' },
        { term: '\u523b\u8fdbdna', family: 'attack', meaning: 'internalized trait criticism' },
        { term: '\u4eae\u8840\u6761', family: 'attack', meaning: 'reveals hostility marker' },
        { term: '\u8001\u62a0', family: 'attack', meaning: 'stingy person insult' },
      ],
    },
    [
      '\u516d\u516d\u516d\uff0c\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86\uff1f',
      '\u5176\u4ed6rapper\u4e0d\u662f\u4eba\u4e86\u5457[doge]',
      '\u90a3\u4e0d\u662f\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86\u5417',
      '\u8fd9\u7535\u6e90\u611f\u89c9\u662f\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4',
      '\u8fd9\u6d3b\u52a8\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86',
      '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462\uff1f',
      '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86',
      '\u8fd9\u5927\u5c40\u89c2\u771f\u662f\u72d7\u5c41\u4e0d\u901a\u7684',
      '\u5173\u4e86\u5427\u6ca1\u610f\u601d\uff0c\u770b\u4e0d\u4e0b\u53bb\u4e86',
      '\u8fd8\u60f3\u7ee7\u7eed\u652f\u6301\u7684\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b\u5427',
      '\u5f88\u61c2\u561b\u8001\u94c1[doge]',
      '\u4f60\u8fd8\u6562\u53d1\u89c6\u9891\u5462',
      '\u8fd9\u8bc4\u8bba\u533a\u771f\u7ed9\u6211\u7b11\u5760\u673a\u4e86',
      '\u8fd9\u5c31\u662f\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba',
      '\u5979\u4e0d\u662f\u7cbe\u795e\u7537\uff0c\u800c\u662f\u7cbe\u795e\u7537\u4eba\u90a3\u4e00\u5957',
      '\u8fd9\u7fa4\u6485\u9192\u4eba\u548c\u6485\u9192\u8005\u53c8\u6765\u4e86',
      '\u8fd9\u5316\u5b66\u7b26\u53f7\u4e00\u770b\u5c31\u662f\u79d1\u6280\u4e0e\u72e0\u6d3b\u554a',
      '\u8fd9\u79cd\u96cc\u7ade\u662f\u523b\u8fdbdna\u7684',
      '\u4e3b\u6301\u4eba\u4e00\u4e0b\u573a\u5c31\u4eae\u8840\u6761\u4e86',
      '\u8fd9\u4eba\u5c31\u662f\u8001\u62a0\u6bd4\u571f\u8d22\u4e3b',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-colloquial-alias/',
      uid: 'BV-colloquial-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7',
    '\u4e0d\u662f\u4eba\u4e86',
    '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
    '\u5403\u4e86\u4e09\u5768\u7fd4',
    '\u5403\u76f8\u592a\u96be\u770b',
    '\u6401\u8fd9\u5462',
    '\u9ad8\u5b8c\u4e86',
    '\u72d7\u5c41\u4e0d\u901a',
    '\u5173\u4e86\u5427',
    '\u597d\u81ea\u4e3a\u4e4b',
    '\u5f88\u61c2\u561b',
    '\u8fd8\u6562\u53d1\u89c6\u9891',
    '\u7b11\u5760\u673a',
    '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9',
    '\u7cbe\u795e\u7537',
    '\u6485\u9192',
    '\u79d1\u6280\u4e0e\u72e0\u6d3b',
    '\u523b\u8fdbdna',
    '\u4eae\u8840\u6761',
    '\u8001\u62a0',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-colloquial-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps long missed phrase anchors back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u662f\u4eba\u4e86\u5457', family: 'attack', meaning: 'long rhetorical attack variant' },
        { term: '\u6211\u4e0d\u674e\u59d0', family: 'attack', meaning: 'homophone not understand variant' },
        { term: '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11', family: 'cooperation', meaning: 'hedged probability judgment' },
        { term: '\u8fb9\u70b8\u8fb9\u79ef\u5fb7', family: 'attack', meaning: 'nuclear bombing sarcasm' },
        { term: '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d', family: 'absolutes', meaning: 'absolute review judgment' },
        { term: '\u8f66\u8f71\u8f98', family: 'evasion', meaning: 'repetitive talk' },
        { term: '\u5b58\u7591\u7f57\u9a6c\u4eba', family: 'correction', meaning: 'historical identity caveat' },
      ],
    },
    [
      '\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457',
      '\u6211\u4e0d\u7406\u89e3\u8fd9\u79cd\u8bf4\u6cd5',
      '\u8fd9\u4e8b\u4e0d\u7edd\u5bf9\u4f46\u4e0d\u5c11',
      '\u6c22\u5f39\u8fb9\u70b8\u8fb9\u79ef\u5fb7',
      '\u5dee\u8bc4\u591a\u5c31\u4e00\u5b9a\u4e0d\u597d\u5417',
      '\u522b\u8f66\u8f71\u8f98\u8bdd\u4e86',
      '\u7f57\u9a6c\u4eba\u5b58\u7591',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-long-miss-alias/',
      uid: 'BV-long-miss-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u662f\u4eba\u4e86\u5457',
    '\u6211\u4e0d\u674e\u59d0',
    '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11',
    '\u8fb9\u70b8\u8fb9\u79ef\u5fb7',
    '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d',
    '\u8f66\u8f71\u8f98',
    '\u5b58\u7591\u7f57\u9a6c\u4eba',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-long-miss-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps evidence-backed weak anchors back to target terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0d\u8981\u80e1\u8bf4', family: 'correction', meaning: 'stop incorrect statement' },
        { term: '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302', family: 'absolutes', meaning: 'game cheating absolute claim' },
        { term: '\u51fa\u751f', family: 'attack', meaning: 'homophone insult' },
        { term: '\u5927\u53f7\u6ca1\u4e86', family: 'evasion', meaning: 'account gone evasion' },
        { term: '\u902e\u6355', family: 'attack', meaning: 'caught or beaten in competition' },
        { term: '\u9053\u5fc3\u7834\u788e', family: 'cooperation', meaning: 'mindset collapsed' },
        { term: '\u4f4e\u60c5\u5546', family: 'attack', meaning: 'low EQ blunt framing' },
        { term: '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86', family: 'evasion', meaning: 'understood immediately in-group cue' },
      ],
    },
    [
      '\u522b\u80e1\u8bf4\uff0c\u8fd9\u4e0d\u662f\u539f\u56e0',
      '\u8fbe\u7edd\u5bc6\u91cc\u9762\u5168\u662f\u6302',
      '\u7eaf\u51fa\u751f\u6253\u6cd5',
      '\u8fd9\u4e0b\u53f7\u6ca1\u4e86',
      '\u5f53\u573a\u88ab\u902e\u6355',
      '\u9053\u5fc3\u788e\u4e86',
      '\u4f4e\u60c5\u5546\uff1a\u8fd9\u5c31\u662f\u4e0d\u884c',
      '\u574f\u4e86\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-evidence-backed-alias/',
      uid: 'BV-evidence-backed-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4e0d\u8981\u80e1\u8bf4',
    '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302',
    '\u51fa\u751f',
    '\u5927\u53f7\u6ca1\u4e86',
    '\u902e\u6355',
    '\u9053\u5fc3\u7834\u788e',
    '\u4f4e\u60c5\u5546',
    '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-evidence-backed-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps priority weak action aliases back to target terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4fdd\u62a4\u6211\u65b9', family: 'cooperation', meaning: 'defend a participant in discussion' },
        { term: '\u6bd4\u515c', family: 'attack', meaning: 'slap threat meme' },
        { term: '\u5927\u6bd4\u515c', family: 'attack', meaning: 'big slap threat meme' },
        { term: '\u88ab\u62e7\u75bc\u4e86', family: 'attack', meaning: 'being pinched pain meme' },
        { term: '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c', family: 'attack', meaning: 'mock arrogant self-image' },
        { term: '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f', family: 'attack', meaning: 'bossy steel chairman label' },
        { term: '\u6e2f\u6ef4\u5bf9', family: 'cooperation', meaning: 'homophone agreement marker' },
        { term: '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5', family: 'cooperation', meaning: 'homophone agreement phrase' },
        { term: '\u6760\u7cbe', family: 'attack', meaning: 'contrarian label' },
      ],
    },
    [
      '\u4fdd\u62a4\u6211\u65b9up\uff0c\u5148\u522b\u55b7',
      '\u8fd9\u79cd\u53d1\u8a00\u771f\u60f3\u6247\u4f60\u6bd4\u515c',
      '\u7ed9\u4f60\u4e00\u4e2a\u5927\u6bd4\u515c\u6e05\u9192\u4e00\u4e0b',
      '\u8fd9\u6839\u672c\u4e0d\u662f\u813e\u6c14\u5dee\uff0c\u8fd9\u5c31\u662f\u88ab\u62e7\u75bc\u4e86\u6025\u4e86',
      '\u56de\u590d\u522b\u4eba\u65f6\u8bf4\u611f\u89c9\u81ea\u5df1\u5f88\u5c4cdoge',
      '\u54df\uff0c\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f',
      '\u6e2f\u6ef4\u5bf9\uff0c\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1',
      '\u8001\u6760\u7cbe\u53c8\u5f00\u59cb\u62ac\u6760\u4e86',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-priority-action-alias/',
      uid: 'BV-priority-action-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u4fdd\u62a4\u6211\u65b9',
    '\u6bd4\u515c',
    '\u5927\u6bd4\u515c',
    '\u88ab\u62e7\u75bc\u4e86',
    '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c',
    '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f',
    '\u6e2f\u6ef4\u5bf9',
    '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5',
    '\u6760\u7cbe',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceCount >= 1), true);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-priority-action-alias'), true);
});

test('findDictionaryEntriesWithTextEvidence maps latest sample-backed weak aliases', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047', family: 'attack', meaning: 'sarcastic treatment meme' },
        { term: '\u9ad8\u7ea7jn', family: 'attack', meaning: 'abusive shorthand label' },
        { term: '\u6401\u8fd9\u5462', family: 'attack', meaning: 'mocking repetition phrase' },
        { term: '\u4e2a\u7b7e', family: 'cooperation', meaning: 'profile signature reference' },
        { term: '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', family: 'attack', meaning: 'keyboard warrior insult' },
        { term: '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', family: 'attack', meaning: 'loaded dice metaphor' },
        { term: '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5', family: 'attack', meaning: 'loaded dice metaphor variant' },
        { term: '\u7ed9\u7237\u722c', family: 'attack', meaning: 'dismissive insult' },
        { term: '\u7ed9\u7237\u6574\u5b5d\u4e86', family: 'attack', meaning: 'mocking laughter phrase' },
        { term: '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c', family: 'absolutes', meaning: 'absolute dismissal of reference value' },
        { term: '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8', family: 'absolutes', meaning: 'absolute denial wording' },
      ],
    },
    [
      '\u8fd9\u5c31\u662f\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047',
      '\u660e\u661f=\u9ad8\u7ea7JN\uff0c\u5973\u4e3b\u64ad=\u6697\u95e8\u5b50',
      '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462',
      '\u6211\u7684\u4e2a\u7b7e\u4e5f\u662f\u8fd9\u9996\u6b4c',
      '\u952e\u76d8\u8bbe\u8ba1\u5e08\u5f53\u4e45\u4e86\uff0c\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929',
      '\u6211\u4eec\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5',
      '\u5f15\u5bfc\u786e\u5b9e\u8bf4\u8fc7\u201c\u6211\u4eec\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5\u201d',
      '\u60a8\u914d\u5417\uff0c\u7ed9\u7237\u722c',
      '\u771f\u7ed9\u7237\u6574\u5b5d\u4e86',
      '\u6240\u4ee5\u82f1\u56fd\u8336\u5305\u6709\u4e24\u6761\u7ebf\u5bf9\u5427\uff1f\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440',
      '\u56fd\u5185\u73b0\u5728\u53ea\u662f\u8981\u6c42\u660e\u786e\u6587\u5316\u6765\u6e90\uff0c\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8\u5176\u4ed6\u6c11\u65cf\u4f7f\u7528',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-sample-backed-alias/',
      uid: 'BV-sample-backed-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047',
    '\u9ad8\u7ea7jn',
    '\u6401\u8fd9\u5462',
    '\u4e2a\u7b7e',
    '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929',
    '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5',
    '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5',
    '\u7ed9\u7237\u722c',
    '\u7ed9\u7237\u6574\u5b5d\u4e86',
    '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c',
    '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8',
  ]);
});

test('findDictionaryEntriesWithTextEvidence maps network-cable meme anchors back to target term', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', family: 'attack', meaning: 'keyboard warrior insult' }],
    },
    '\u8fd9\u79cd\u952e\u76d8\u4fa0\u7ed9\u4f60\u4e00\u6839\u7f51\u7ebf\u4ed6\u80fd\u4e0a\u5929\uff0c\u4e0d\u770b\u5b8c\u5c31\u5f00\u55b7',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-network-cable-meme/',
      uid: 'BV-network-cable-meme',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929']);
  assert.equal(entries[0].evidenceSources[0].uid, 'BV-network-cable-meme');
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
      [{ term: '\u65b0\u9c9c\u8bcd', family: 'cooperation', meaning: 'existing dictionary term', confidence: 0.7, evidenceCount: 0 }],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: 'Bilibili comment has [\u65b0\u9c9c\u8bcd]\nanother \u65b0\u9c9c\u8bcd reply',
        uid: 'BV-existing',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing/',
      },
      {
        dictionaryPath,
        env: {},
      },
    );

    const existing = result.dictionary.entries.find((entry) => entry.term === '\u65b0\u9c9c\u8bcd');
    assert.equal(result.generatedEntries.length, 0);
    assert.deepEqual(result.dictionaryEvidenceEntries.map((entry) => entry.term), ['\u65b0\u9c9c\u8bcd']);
    assert.equal(existing.evidenceCount, 2);
    assert.equal(existing.evidenceSamples.includes('Bilibili comment has [\u65b0\u9c9c\u8bcd]'), true);
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
      [{ term: '\u65b0\u9c9c\u8bcd', family: 'cooperation', meaning: 'existing dictionary term', confidence: 0.7, evidenceCount: 0 }],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: '\u65b0\u9c9c\u8bcd appears here and \u5168\u65b0\u8bcd appears too',
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
    assert.deepEqual(result.entries.map((entry) => entry.term), ['\u65b0\u9c9c\u8bcd']);
    assert.equal(result.dictionary.entries.some((entry) => entry.term === '\u5168\u65b0\u8bcd'), false);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === '\u65b0\u9c9c\u8bcd').evidenceCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trainKeywordDictionary existing-only mode refuses non-current normalized terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-only-current-terms-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [{ term: '\u5df2\u6709\u8bcd', family: 'cooperation', meaning: 'existing dictionary term', confidence: 0.7, evidenceCount: 0 }],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: '\u5df2\u6709\u8bcd and \u672a\u6536\u5f55\u8bcd both appear here',
        uid: 'BV-existing-only-current',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-only-current/',
        existingTermsOnly: true,
      },
      {
        dictionaryPath,
        env: { DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_MODEL: 'deepseek-v4-flash' },
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
                      matches: [
                        { term: '\u672a\u6536\u5f55\u8bcd', evidence: '\u672a\u6536\u5f55\u8bcd' },
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

    assert.deepEqual(result.entries.map((entry) => entry.term), ['\u5df2\u6709\u8bcd']);
    assert.equal(result.dictionary.entries.some((entry) => entry.term === '\u672a\u6536\u5f55\u8bcd'), false);
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
    const userMessage = chatBodies[0].messages.find((message) => message.role === 'user')?.content || '';
    assert.equal(userMessage.includes('Read the full comment sentence'), true);
    assert.equal(userMessage.includes('not just isolated keyword hits'), true);
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

test('trainKeywordDictionary existing-only no-hit runs do not propagate stale alias evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-nohit-no-alias-propagation-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u95ee\u767e\u5ea6',
            family: 'evasion',
            meaning: 'dismiss by telling someone to search',
            evidenceCount: 0,
            evidenceSamples: [],
          },
          {
            term: '\u4e0d\u4f1a\u767e\u5ea6',
            family: 'evasion',
            meaning: 'literal search tutorial phrase from older data',
            evidenceCount: 1,
            evidenceSamples: ['old unrelated sample'],
            evidenceSources: [{ source: 'old source', uid: 'old', sample: 'old unrelated sample' }],
          },
        ],
      }),
      'utf8',
    );
    const before = await readFile(dictionaryPath, 'utf8');

    const result = await trainKeywordDictionary(
      {
        text: '\u8fd9\u91cc\u53ea\u6709\u666e\u901a\u8bc4\u8bba\uff0c\u6ca1\u6709\u641c\u7d22\u6253\u53d1\u8bdd\u672f',
        uid: 'BV-existing-nohit',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-nohit/',
        existingTermsOnly: true,
        targetExistingTerms: ['\u95ee\u767e\u5ea6'],
      },
      {
        dictionaryPath,
        env: { DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_MODEL: 'deepseek-v4-flash' },
        fetch: async (url) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          return { ok: true, json: async () => ({ choices: [{ message: { content: '{"matches":[]}' } }] }) };
        },
      },
    );

    const after = await readFile(dictionaryPath, 'utf8');
    assert.deepEqual(result.entries, []);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === '\u95ee\u767e\u5ea6').evidenceCount || 0, 0);
    assert.equal(after, before);
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

test('mergeEntriesIntoDictionary respects the dictionary write lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-dictionary-lock-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const release = await acquireFileLock(`${dictionaryPath}.lock`, { staleMs: 60_000 });
    await assert.rejects(
      () =>
        mergeEntriesIntoDictionary(
          [{ term: '\u9501\u6d4b\u8bd5', family: 'attack', meaning: 'lock test', confidence: 0.7, evidenceCount: 1 }],
          { dictionaryPath },
        ),
      /Another Bilibili dictionary job is already running/,
    );
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary existing-only mode refuses new terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-keywords-existing-only-merge-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [{ term: '已有词', family: 'attack', meaning: 'current term', confidence: 0.7, evidenceCount: 1 }],
      { dictionaryPath },
    );

    const dictionary = await mergeEntriesIntoDictionary(
      [
        { term: '已有词', family: 'attack', meaning: 'current term', confidence: 0.7, evidenceCount: 2, evidenceSamples: ['已有词 sample'] },
        { term: '新增词', family: 'attack', meaning: 'should not be added', confidence: 0.7, evidenceCount: 1 },
      ],
      { dictionaryPath, existingTermsOnly: true },
    );

    assert.equal(dictionary.entries.some((entry) => entry.term === '新增词'), false);
    assert.equal(dictionary.entries.find((entry) => entry.term === '已有词').evidenceCount, 2);
    const persisted = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    assert.equal(persisted.entries.some((entry) => entry.term === '新增词'), false);
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
                        { term: '\u672a\u51fa\u73b0\u8bcd', family: 'attack', meaning: 'not in source text' },
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
