import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  writeJsonFileAtomic,
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

test('analyzeCommentsWithDeepSeek maps mojibake axis labels to real Chinese labels', async () => {
  const originalSentence = '\u4f60\u522b\u7ed9\u4eba\u4e71\u6263\u5e3d\u5b50\uff0c\u5148\u62ff\u51fa\u539f\u59cb\u6765\u6e90\u3002';
  const badAttackAxis = String.fromCodePoint(0x7035, 0x89c4, 0x59c9, 0x6027, 0x52a8, 0x673a);
  const badEvidenceAxis = String.fromCodePoint(0x7487, 0x4f79, 0x5d41, 0x654f, 0x611f);

  const result = await analyzeCommentsWithDeepSeek(
    { text: originalSentence },
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
                    axes: [
                      { axis: badAttackAxis, score: 64, evidence: [originalSentence], reasoning: '\u5b58\u5728\u6263\u5e3d\u5b50\u7684\u5bf9\u6297\u8868\u8fbe\u3002' },
                      { axis: badEvidenceAxis, score: 76, evidence: [originalSentence], reasoning: '\u8981\u6c42\u63d0\u4f9b\u539f\u59cb\u6765\u6e90\u3002' },
                    ],
                    sentenceAnalyses: [
                      {
                        quote: originalSentence,
                        speechAct: '\u8981\u6c42\u8bc1\u636e',
                        target: '\u5bf9\u65b9\u7684\u65ad\u8a00',
                        risk: 'low',
                        axisImpacts: [
                          { axis: badEvidenceAxis, direction: 'positive', strength: 0.8, reasoning: '\u6574\u53e5\u8981\u6c42\u56de\u5230\u6765\u6e90\u3002' },
                          { axis: badAttackAxis, direction: 'risk', strength: 0.35, reasoning: '\u6709\u8f7b\u5fae\u53cd\u9a73\u8bed\u6c14\u3002' },
                        ],
                      },
                    ],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u504f\u8bc1\u636e\u8ba8\u8bba\u3002' },
                    confidence: 0.8,
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
  assert.equal(result.axes.find((axis) => axis.axis === '\u5bf9\u6297\u6027\u52a8\u673a').score, 64);
  assert.equal(result.axes.find((axis) => axis.axis === '\u8bc1\u636e\u654f\u611f').score, 76);
  assert.deepEqual(result.sentenceAnalyses[0].axisImpacts.map((impact) => impact.axis), ['\u8bc1\u636e\u654f\u611f', '\u5bf9\u6297\u6027\u52a8\u673a']);
});

test('analyzeCommentsWithDeepSeek rejects pipe-delimited axis label lists', async () => {
  const originalSentence = '\u8fd9\u53e5\u53ea\u662f\u8981\u6c42\u5bf9\u65b9\u8865\u5145\u6765\u6e90\u3002';
  const badAxisList = [
    String.fromCodePoint(0x7035, 0x89c4, 0x59c9),
    String.fromCodePoint(0x7481, 0x3087, 0x7161),
    String.fromCodePoint(0x7487, 0x4f79, 0x5d41),
    String.fromCodePoint(0x95ab, 0x660f, 0x7ddb),
    String.fromCodePoint(0x935a, 0x581c, 0x7d94),
    String.fromCodePoint(0x6dc7, 0xe1bd, 0xe11c),
  ].join('|') + '|';

  const result = await analyzeCommentsWithDeepSeek(
    { text: originalSentence },
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
                    axes: [{ axis: badAxisList, score: 88, evidence: [originalSentence], reasoning: '\u6a21\u578b\u8bef\u628a schema \u5019\u9009\u8f74\u5f53\u6210\u4e00\u4e2a\u8f74\u540d\u3002' }],
                    sentenceAnalyses: [
                      {
                        quote: originalSentence,
                        speechAct: '\u8981\u6c42\u6765\u6e90',
                        target: '\u5bf9\u65b9\u7684\u65ad\u8a00',
                        risk: 'low',
                        axisImpacts: [{ axis: badAxisList, direction: 'risk', strength: 0.9 }],
                      },
                    ],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u6a21\u578b\u8f93\u51fa\u4e86\u65e0\u6548\u8f74\u540d\u3002' },
                    confidence: 0.72,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(result.axes.find((axis) => axis.axis === '\u5bf9\u6297\u6027\u52a8\u673a').score, 50);
  assert.deepEqual(result.sentenceAnalyses[0].axisImpacts, []);
});

test('analyzeCommentsWithDeepSeek retries with compact comments when model returns garbled Chinese evidence', async () => {
  const originalSentence = '\u6ca1\u6709\u8f66\u5bb6\u519b\uff0c\u8fd9\u4e9b\u5c31\u662f\u5e9f\u94dc\u70c2\u94c1[doge]';
  const requests = [];
  const result = await analyzeCommentsWithDeepSeek(
    {
      uid: 'video:BV19yGa61Ee6',
      name: 'live sample',
      text: originalSentence,
    },
    {
      env: {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
      },
      fetch: async (url, options = {}) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
        }
        const body = JSON.parse(options.body);
        requests.push(body);
        if (requests.length === 1) {
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 50, evidence: ['??????????[doge]'], reasoning: '\u8bc4\u8bba\u4e3a\u4e71\u7801\uff0c\u8bc1\u636e\u4e0d\u8db3\u3002' }],
                      sentenceAnalyses: [],
                      overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '' },
                      confidence: 0.7,
                    }),
                  },
                },
              ],
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 62, evidence: [originalSentence], reasoning: '\u5bf9\u7fa4\u4f53\u548c\u7269\u54c1\u8fdb\u884c\u8d2c\u635f\u5f0f\u8868\u8fbe\u3002' }],
                    sentenceAnalyses: [
                      {
                        quote: originalSentence,
                        speechAct: '\u8d2c\u635f\u5f0f\u8bc4\u4ef7',
                        target: '\u8f66\u5bb6\u519b\u53ca\u76f8\u5173\u5bf9\u8c61',
                        stance: '\u8c03\u4f83\u4f46\u5e26\u8d1f\u9762\u6807\u7b7e',
                        contextRole: '\u7528\u6897\u548c\u8d2c\u4e49\u8bcd\u8868\u8fbe\u7acb\u573a',
                        risk: 'medium',
                        axisImpacts: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', direction: 'risk', strength: 0.62 }],
                        reasoning: '\u4e0d\u80fd\u53ea\u770b doge\uff0c\u6574\u53e5\u4ecd\u7136\u6709\u660e\u786e\u8d2c\u635f\u5bf9\u8c61\u3002',
                      },
                    ],
                    overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '\u6837\u672c\u542b\u6709\u8c03\u4f83\u5f0f\u5bf9\u6297\u8868\u8fbe\u3002' },
                    confidence: 0.78,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[1].max_tokens >= 6000, true);
  assert.equal(requests[1].messages.some((message) => String(message.content).includes('"comments"')), true);
  assert.equal(requests[1].messages.some((message) => String(message.content).includes(originalSentence)), true);
  assert.equal(result.axes[0].score, 62);
  assert.deepEqual(result.sentenceAnalyses.map((item) => item.quote), [originalSentence]);
});

test('analyzeCommentsWithDeepSeek rejects analysis when compact retry is still garbled', async () => {
  const originalSentence = '\u5df1\u6240\u4e0d\u6b32\u52ff\u65bd\u4e8e\u4eba';
  const result = await analyzeCommentsWithDeepSeek(
    {
      uid: 'video:BV19yGa61Ee6',
      name: 'garbled final sample',
      text: originalSentence,
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
                    axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 50, evidence: ['????????'], reasoning: '\u6837\u672c\u4e0d\u53ef\u89e3\u6790\u3002' }],
                    sentenceAnalyses: [],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u4e71\u7801\u6837\u672c\u3002' },
                    confidence: 0.7,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.match(result.error, /\u4e71\u7801|garbled/i);
});

test('analyzeCommentsWithDeepSeek retries with compact comments when model returns invalid JSON', async () => {
  const originalSentence = '\u8bdd\u867d\u5982\u6b64 \u53ef\u8bc4\u8bba\u533a\u600e\u4e48\u6ca1\u89c1\u51e0\u4e2a\u5fc3\u5e73\u6c14\u548c\u7684\u8bc4\u8bba';
  const requests = [];
  const result = await analyzeCommentsWithDeepSeek(
    {
      uid: 'video:BV19yGa61Ee6',
      name: 'live parse retry',
      text: originalSentence,
    },
    {
      env: {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
      },
      fetch: async (url, options = {}) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
        }
        const body = JSON.parse(options.body);
        requests.push(body);
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    requests.length === 1
                      ? '{"axes":[{"axis":"\u5bf9\u6297\u6027\u52a8\u673a","score":70,"evidence":["broken"]}'
                      : JSON.stringify({
                          axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 66, evidence: [originalSentence], reasoning: '\u5bf9\u8bc4\u8bba\u533a\u7684\u5bf9\u7acb\u6027\u6982\u62ec\u3002' }],
                          sentenceAnalyses: [
                            {
                              quote: originalSentence,
                              speechAct: '\u8bc4\u8bba\u533a\u5143\u6279\u8bc4',
                              target: '\u8bc4\u8bba\u533a\u8bed\u6c14',
                              risk: 'medium',
                              axisImpacts: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', direction: 'risk', strength: 0.66 }],
                            },
                          ],
                          overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '\u542b\u6709\u5bf9\u7acb\u6027\u5143\u8bc4\u8bba\u3002' },
                          confidence: 0.76,
                        }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.retriedCompactPrompt, true);
  assert.equal(requests[1].messages.some((message) => String(message.content).includes('"comments"')), true);
  assert.equal(result.axes[0].score, 66);
  assert.deepEqual(result.sentenceAnalyses.map((item) => item.quote), [originalSentence]);
});

test('analyzeCommentsWithDeepSeek retries when Chinese analysis is empty but syntactically valid', async () => {
  const originalSentence = '\u8bdd\u867d\u5982\u6b64 \u53ef\u8bc4\u8bba\u533a\u600e\u4e48\u6ca1\u89c1\u51e0\u4e2a\u5fc3\u5e73\u6c14\u548c\u7684\u8bc4\u8bba\uff0c\u5168\u662f\u9634\u9633\u602a\u6c14\u865a\u7a7a\u7d22\u654c\u57fa\u672c\u76d8\u548c\u5404\u79cd\u7c89\u7ea2\u7684\u3002';
  const requests = [];
  const result = await analyzeCommentsWithDeepSeek(
    { text: originalSentence },
    {
      env: {
        DEEPSEEK_API_KEY: 'test-key',
        DEEPSEEK_BASE_URL: 'https://api.deepseek.com',
        DEEPSEEK_MODEL: 'deepseek-v4-flash',
      },
      fetch: async (url, options = {}) => {
        if (String(url).endsWith('/models')) {
          return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
        }
        requests.push(JSON.parse(options.body));
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content:
                    requests.length === 1
                      ? JSON.stringify({ axes: [], sentenceAnalyses: [], overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '' }, confidence: 0.7 })
                      : JSON.stringify({
                          axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 70, evidence: [originalSentence], reasoning: '\u6709\u9635\u8425\u6807\u7b7e\u548c\u5bf9\u7acb\u6307\u5411\u3002' }],
                          sentenceAnalyses: [
                            {
                              quote: originalSentence,
                              speechAct: '\u8bc4\u8bba\u533a\u5143\u6279\u8bc4',
                              target: '\u8bc4\u8bba\u533a\u53d1\u8a00\u8005',
                              risk: 'medium',
                              axisImpacts: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', direction: 'risk', strength: 0.7 }],
                            },
                          ],
                          overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '\u6837\u672c\u542b\u9635\u8425\u5316\u6279\u8bc4\u3002' },
                          confidence: 0.78,
                        }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.equal(requests.length, 2);
  assert.equal(result.axes[0].score, 70);
  assert.deepEqual(result.sentenceAnalyses.map((item) => item.quote), [originalSentence]);
});

test('analyzeCommentsWithDeepSeek neutralizes unsupported axis scores when evidence is missing', async () => {
  const result = await analyzeCommentsWithDeepSeek(
    { text: '\u5df1\u6240\u4e0d\u6b32\u52ff\u65bd\u4e8e\u4eba' },
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
                    axes: [{ axis: '\u4fee\u6b63\u610f\u613f', score: 20, evidence: [], reasoning: '\u672a\u51fa\u73b0\u4fee\u6b63\u8bed\u5883\u3002' }],
                    sentenceAnalyses: [
                      {
                        quote: '\u5df1\u6240\u4e0d\u6b32\u52ff\u65bd\u4e8e\u4eba',
                        speechAct: '\u5f15\u7528\u683c\u8a00',
                        target: '\u666e\u904d\u9053\u5fb7\u539f\u5219',
                        risk: 'low',
                        axisImpacts: [{ axis: '\u5408\u4f5c\u8ba8\u8bba', direction: 'positive', strength: 0.6 }],
                      },
                    ],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u6837\u672c\u4f4e\u98ce\u9669\u3002' },
                    confidence: 0.7,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  const correction = result.axes.find((axis) => axis.axis === '\u4fee\u6b63\u610f\u613f');
  assert.equal(correction.score, 50);
  assert.match(correction.reasoning, /\u8bc1\u636e\u4e0d\u8db3/);
});

test('analyzeCommentsWithDeepSeek neutralizes correction scores without explicit correction evidence', async () => {
  const proverb = '\u5df1\u6240\u4e0d\u6b32\u52ff\u65bd\u4e8e\u4eba';
  const result = await analyzeCommentsWithDeepSeek(
    { text: proverb },
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
                    axes: [
                      {
                        axis: '\u4fee\u6b63\u610f\u613f',
                        score: 30,
                        evidence: [proverb],
                        reasoning: '\u683c\u8a00\u6697\u793a\u53cd\u601d\uff0c\u6240\u4ee5\u4fee\u6b63\u610f\u613f\u504f\u4f4e\u3002',
                      },
                    ],
                    sentenceAnalyses: [
                      {
                        quote: proverb,
                        speechAct: '\u5f15\u7528\u683c\u8a00',
                        target: '\u666e\u904d\u9053\u5fb7\u539f\u5219',
                        risk: 'low',
                        axisImpacts: [{ axis: '\u4fee\u6b63\u610f\u613f', direction: 'positive', strength: 0.8 }],
                      },
                    ],
                    overall: { riskBand: '\u4f4e\u98ce\u9669\u8ba8\u8bba\u578b', summary: '\u6837\u672c\u662f\u9053\u5fb7\u529d\u8beb\u3002' },
                    confidence: 0.7,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  const correction = result.axes.find((axis) => axis.axis === '\u4fee\u6b63\u610f\u613f');
  assert.equal(correction.score, 50);
  assert.match(correction.reasoning, /\u8bc1\u636e\u4e0d\u8db3/);
});

test('analyzeCommentsWithDeepSeek drops duplicate empty sentence analyses when a substantive quote exists', async () => {
  const quote = '\u8bdd\u867d\u5982\u6b64 \u53ef\u8bc4\u8bba\u533a\u600e\u4e48\u6ca1\u89c1\u51e0\u4e2a\u5fc3\u5e73\u6c14\u548c\u7684\u8bc4\u8bba\uff0c\u5168\u662f\u9634\u9633\u602a\u6c14\u865a\u7a7a\u7d22\u654c\u57fa\u672c\u76d8\u548c\u5404\u79cd\u7c89\u7ea2\u7684\u3002';
  const result = await analyzeCommentsWithDeepSeek(
    { text: quote },
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
                    axes: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', score: 55, evidence: [quote], reasoning: '\u6709\u6807\u7b7e\u5316\u6279\u8bc4\u3002' }],
                    sentenceAnalyses: [
                      {
                        quote,
                        speechAct: '\u5143\u8bc4\u8bba',
                        target: '\u8bc4\u8bba\u533a',
                        risk: 'medium',
                        axisImpacts: [{ axis: '\u5bf9\u6297\u6027\u52a8\u673a', direction: 'risk', strength: 0.4 }],
                      },
                      {
                        quote,
                        speechAct: '\u6c89\u9ed8/\u5360\u4f4d',
                        target: '\u65e0',
                        risk: 'low',
                        axisImpacts: [],
                      },
                    ],
                    overall: { riskBand: '\u6df7\u5408\u4e89\u8fa9\u578b', summary: '\u542b\u6807\u7b7e\u5316\u6279\u8bc4\u3002' },
                    confidence: 0.7,
                  }),
                },
              },
            ],
          }),
        };
      },
    },
  );

  assert.deepEqual(result.sentenceAnalyses.map((item) => item.speechAct), ['\u5143\u8bc4\u8bba']);
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
    { term: String.fromCodePoint(0x9411, 0xe161, 0x760e), family: 'cooperation', meaning: 'mojibake for hot comment' },
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

test('normalizes persisted ambiguous attack evidence by removing benign food samples', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u8150\u4e73',
      family: 'attack',
      meaning: '\u7f51\u7edc\u653b\u51fb\u8bed\u5883\u4e2d\u7684\u8c10\u97f3\u6216\u8d2c\u635f\u7528\u6cd5',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8bb0\u5f97\u4e00\u6b21\u8ddf\u670b\u53cb\u53bb\u6f6e\u6c55\u5927\u6392\u6863\uff0c\u70b9\u4e86\u4e2a\u8c46\u9171\u8fd8\u662f\u8150\u4e73\u7092\u901a\u83dc\uff0c\u771f\u7684\u5f88\u7f8e\u5473',
        '\u8638\u996d\uff01\u8150\u4e73\uff01\u53db\u5f92\uff01\u51fa\u5217',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', uid: 'BV-food', sample: '\u8bb0\u5f97\u4e00\u6b21\u8ddf\u670b\u53cb\u53bb\u6f6e\u6c55\u5927\u6392\u6863\uff0c\u70b9\u4e86\u4e2a\u8c46\u9171\u8fd8\u662f\u8150\u4e73\u7092\u901a\u83dc\uff0c\u771f\u7684\u5f88\u7f8e\u5473' },
        { source: 'Bilibili public video comment scan', uid: 'BV-attack', sample: '\u8638\u996d\uff01\u8150\u4e73\uff01\u53db\u5f92\uff01\u51fa\u5217' },
      ],
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8638\u996d\uff01\u8150\u4e73\uff01\u53db\u5f92\uff01\u51fa\u5217']);
  assert.equal(entries[0].evidenceSources[0].uid, 'BV-attack');
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

test('readKeywordDictionary rejects corrupt dictionary JSON instead of treating it as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-read-corrupt-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(dictionaryPath, '{ "version": 1, "entries": [', 'utf8');

    await assert.rejects(
      () => readKeywordDictionary({ dictionaryPath }),
      /Could not read keyword dictionary/,
    );
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

test('normalizes away mojibake Chinese-looking keyword terms', () => {
  const mojibakeAxisLabels = [
    String.fromCodePoint(0x7035, 0x89c4, 0x59c9),
    String.fromCodePoint(0x7481, 0x3087, 0x7161),
    String.fromCodePoint(0x7487, 0x4f79, 0x5d41),
    String.fromCodePoint(0x95ab, 0x660f, 0x7ddb),
    String.fromCodePoint(0x935a, 0x581c, 0x7d94),
    String.fromCodePoint(0x6dc7, 0xe1bd, 0xe11c),
  ];
  const entries = normalizeKeywordEntries([
    { term: '\u7035\u89c4\u59c9', family: 'attack', meaning: 'UTF-8/GBK mojibake for a Chinese category label' },
    ...mojibakeAxisLabels.map((term) => ({ term, family: 'attack', meaning: 'mojibake radar axis label' })),
    { term: '\u7537\u76d7\u5973\u5a3c', family: 'attack', meaning: 'real Chinese attack phrase' },
    { term: 'doge', family: 'cooperation', meaning: 'allowed Bilibili ASCII meme shorthand' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u7537\u76d7\u5973\u5a3c', 'doge']);
});

test('normalizes away pipe-delimited mojibake axis terms', () => {
  const mojibakeAxisTerms = [
    String.fromCodePoint(0x7035, 0x89c4, 0x59c9),
    String.fromCodePoint(0x7481, 0x3087, 0x7161),
    String.fromCodePoint(0x7487, 0x4f79, 0x5d41),
    String.fromCodePoint(0x95ab, 0x660f, 0x7ddb),
    String.fromCodePoint(0x935a, 0x581c, 0x7d94),
    String.fromCodePoint(0x6dc7, 0xe1bd, 0xe11c),
  ];
  const entries = normalizeKeywordEntries([
    ...mojibakeAxisTerms.map((term) => ({ term, family: 'attack', meaning: 'mojibake radar axis label' })),
    { term: `${mojibakeAxisTerms.join('|')}|`, family: 'attack', meaning: 'pipe-delimited mojibake axis labels' },
    { term: '\u5bf9\u6297', family: 'attack', meaning: 'real Chinese discussion term' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5bf9\u6297']);
});

test('normalizes away mixed mojibake axis labels with Chinese suffixes', () => {
  const entries = normalizeKeywordEntries([
    { term: String.fromCodePoint(0x7035, 0x89c4, 0x59c9, 0x6027, 0x52a8, 0x673a), family: 'attack', meaning: 'mojibake axis label with a readable suffix' },
    { term: String.fromCodePoint(0x7487, 0x4f79, 0x5d41, 0x654f, 0x611f), family: 'evidence', meaning: 'mojibake axis label with a readable suffix' },
    { term: String.fromCodePoint(0x95ab, 0x660f, 0x7ddb, 0x4e00, 0x81f4), family: 'absolutes', meaning: 'mojibake axis label with a readable suffix' },
    { term: String.fromCodePoint(0x935a, 0x581c, 0x7d94, 0x8ba8, 0x8bba), family: 'cooperation', meaning: 'mojibake axis label with a readable suffix' },
    { term: String.fromCodePoint(0x6dc7, 0xe1bd, 0xe11c, 0x610f, 0x613f), family: 'correction', meaning: 'mojibake axis label with a readable suffix' },
    { term: '\u8bc1\u636e\u654f\u611f', family: 'evidence', meaning: 'readable Chinese discussion phrase' },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u8bc1\u636e\u654f\u611f']);
});

test('normalizes away isolated enlightenment meme fragments while keeping the full meme phrase', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6211\u609f\u4e86',
      family: 'attack',
      meaning: '\u88ab\u4ece\u666e\u901a\u987f\u609f\u8bed\u5883\u91cc\u5207\u51fa\u6765\u7684\u6cdb\u5316\u7247\u6bb5',
      evidenceCount: 1,
      evidenceSamples: ['\u4e00\u5f00\u59cb\u6211\u4e5f\u770b\u5404\u79cd\u6559\u5b66\u89c6\u9891\uff0c\u7a81\u7136\u6211\u609f\u4e86\u3002'],
    },
    {
      term: '\u609f\u4e86',
      family: 'attack',
      meaning: '\u88ab\u4ece\u666e\u901a\u987f\u609f\u8bed\u5883\u91cc\u5207\u51fa\u6765\u7684\u6cdb\u5316\u7247\u6bb5',
      evidenceCount: 1,
      evidenceSamples: ['\u4f60\u609f\u4e86'],
    },
    {
      term: '\u5927\u5e08\u6211\u609f\u4e86',
      family: 'cooperation',
      meaning: '\u7528\u609f\u4e86\u6897\u8868\u793a\u63a5\u53d7\u6216\u8ddf\u4e0a\u5bf9\u65b9\u89e3\u91ca',
      evidenceCount: 1,
      evidenceSamples: ['\u5927\u5e08\uff0c\u6211\u609f\u4e86'],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5927\u5e08\u6211\u609f\u4e86']);
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

test('mergeEntriesIntoDictionary prunes persisted isolated enlightenment attack fragments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-enlightenment-fragments-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u6211\u609f\u4e86',
            family: 'attack',
            meaning: '\u88ab\u4ece\u666e\u901a\u987f\u609f\u8bed\u5883\u91cc\u5207\u51fa\u6765\u7684\u6cdb\u5316\u7247\u6bb5',
            evidenceCount: 2,
            evidenceSamples: ['\u6211\u609f\u4e86', '\u4f60\u609f\u4e86'],
          },
          {
            term: '\u609f\u4e86',
            family: 'attack',
            meaning: '\u88ab\u4ece\u666e\u901a\u987f\u609f\u8bed\u5883\u91cc\u5207\u51fa\u6765\u7684\u6cdb\u5316\u7247\u6bb5',
            evidenceCount: 2,
            evidenceSamples: ['\u6211\u609f\u4e86', '\u4f60\u609f\u4e86'],
          },
          {
            term: '\u5927\u5e08\u6211\u609f\u4e86',
            family: 'cooperation',
            meaning: '\u7528\u609f\u4e86\u6897\u8868\u793a\u63a5\u53d7\u6216\u8ddf\u4e0a\u5bf9\u65b9\u89e3\u91ca',
            evidenceCount: 1,
            evidenceSamples: ['\u5927\u5e08\uff0c\u6211\u609f\u4e86'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.deepEqual(dictionary.entries.map((entry) => entry.term), ['\u5927\u5e08\u6211\u609f\u4e86']);
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

test('mergeEntriesIntoDictionary does not reintroduce ambiguous alias evidence during prune', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-ambiguous-alias-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u5bb6\u4eba',
            family: 'cooperation',
            meaning: 'solidarity or friendly in-group address',
            evidenceCount: 2,
            evidenceSamples: [
              '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba',
              '\u76f4\u64ad\u95f4\u4e00\u53e3\u4e00\u4e2a\u5bb6\u4eba\u4eec\u5e26\u504f\uff0c\u4f60\u771f\u7684\u9700\u8981\u8fd9\u4e9b\u5417',
            ],
            evidenceSources: [
              { source: 'test', uid: '1', sample: '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba' },
              { source: 'test', uid: '2', sample: '\u5e26\u7740\u5168\u5bb6\u4eba\u548c\u6559\u6388\u4e00\u8d77\u5728\u6bd5\u8bbe\u524d\u5408\u5f71' },
              { source: 'test', uid: '3', sample: '\u8ddf\u5bb6\u4eba\u548c\u6743\u5a01\u7684\u4eba\u7684\u5173\u7cfb\uff0c\u53ef\u80fd\u4f1a\u6709\u51b2\u7a81' },
            ],
          },
          {
            term: '\u90fd\u662f\u5bb6\u4eba',
            family: 'cooperation',
            meaning: 'solidarity or friendly in-group address',
            evidenceCount: 2,
            evidenceSamples: [
              '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba',
              '\u76f4\u64ad\u95f4\u4e00\u53e3\u4e00\u4e2a\u5bb6\u4eba\u4eec\u5e26\u504f\uff0c\u4f60\u771f\u7684\u9700\u8981\u8fd9\u4e9b\u5417',
            ],
            evidenceSources: [
              { source: 'test', uid: '1', sample: '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba' },
              { source: 'test', uid: '2', sample: '\u5e26\u7740\u5168\u5bb6\u4eba\u548c\u6559\u6388\u4e00\u8d77\u5728\u6bd5\u8bbe\u524d\u5408\u5f71' },
              { source: 'test', uid: '3', sample: '\u8ddf\u5bb6\u4eba\u548c\u6743\u5a01\u7684\u4eba\u7684\u5173\u7cfb\uff0c\u53ef\u80fd\u4f1a\u6709\u51b2\u7a81' },
            ],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const entry = dictionary.entries.find((item) => item.term === '\u90fd\u662f\u5bb6\u4eba');

    assert.deepEqual(entry.evidenceSamples, ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba']);
    assert.deepEqual(entry.evidenceSources.map((source) => source.sample), ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba']);
    assert.equal(entry.evidenceCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('mergeEntriesIntoDictionary lets fresh comments replace capped public video title samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-comment-replaces-title-context-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u597d\u81ea\u4e3a\u4e4b',
            family: 'attack',
            meaning: 'dismissive warning phrase',
            evidenceCount: 5,
            evidenceSamples: [
              '\u8fd8\u60f3\u7ee7\u7eed\u652f\u6301\u7684\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b\u5427',
              'Bilibili public video title: title sample 1 \u597d\u81ea\u4e3a\u4e4b',
              'Bilibili public video title: title sample 2 \u597d\u81ea\u4e3a\u4e4b',
              'Bilibili public video title: title sample 3 \u597d\u81ea\u4e3a\u4e4b',
              'Bilibili public video title: title sample 4 \u597d\u81ea\u4e3a\u4e4b',
            ],
            evidenceSources: [
              { source: 'Bilibili public search-discovered video comment scan', uid: 'BVold', sample: '\u8fd8\u60f3\u7ee7\u7eed\u652f\u6301\u7684\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b\u5427' },
              { source: 'Bilibili public search-discovered video comment scan plus video object evidence', uid: 'BVtitle1', sample: 'Bilibili public video title: title sample 1 \u597d\u81ea\u4e3a\u4e4b' },
              { source: 'Bilibili public search-discovered video comment scan plus video object evidence', uid: 'BVtitle2', sample: 'Bilibili public video title: title sample 2 \u597d\u81ea\u4e3a\u4e4b' },
              { source: 'Bilibili public search-discovered video comment scan plus video object evidence', uid: 'BVtitle3', sample: 'Bilibili public video title: title sample 3 \u597d\u81ea\u4e3a\u4e4b' },
              { source: 'Bilibili public search-discovered video comment scan plus video object evidence', uid: 'BVtitle4', sample: 'Bilibili public video title: title sample 4 \u597d\u81ea\u4e3a\u4e4b' },
            ],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary(
      [
        {
          term: '\u597d\u81ea\u4e3a\u4e4b',
          family: 'attack',
          meaning: 'dismissive warning phrase',
          evidenceCount: 1,
          evidenceSamples: ['\u8fd9\u6b21\u4ed6\u4eec\u771f\u5f97\u597d\u81ea\u4e3a\u4e4b'],
          evidenceSources: [
            {
              source: 'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVfresh/',
              uid: 'BVfresh',
              sample: '\u8fd9\u6b21\u4ed6\u4eec\u771f\u5f97\u597d\u81ea\u4e3a\u4e4b',
            },
          ],
        },
      ],
      { dictionaryPath },
    );

    const entry = dictionary.entries.find((item) => item.term === '\u597d\u81ea\u4e3a\u4e4b');
    assert.equal(entry.evidenceSamples.includes('\u8fd9\u6b21\u4ed6\u4eec\u771f\u5f97\u597d\u81ea\u4e3a\u4e4b'), true);
    assert.equal(entry.evidenceSamples.filter((sample) => sample.startsWith('Bilibili public video title:')).length, 3);
    assert.equal(entry.evidenceSources.some((source) => source.uid === 'BVfresh'), true);
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

test('findDictionaryEntriesWithTextEvidence rejects ambiguous food-context evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u8150\u4e73', family: 'attack', meaning: '\u7f51\u7edc\u653b\u51fb\u8bed\u5883\u4e2d\u7684\u8c10\u97f3\u6216\u8d2c\u635f\u7528\u6cd5', evidenceCount: 0 }],
    },
    [
      '\u8bb0\u5f97\u4e00\u6b21\u8ddf\u670b\u53cb\u53bb\u6f6e\u6c55\u5927\u6392\u6863\uff0c\u70b9\u4e86\u4e2a\u8c46\u9171\u8fd8\u662f\u8150\u4e73\u7092\u901a\u83dc\uff0c\u771f\u7684\u5f88\u7f8e\u5473',
      '\u8638\u996d\uff01\u8150\u4e73\uff01\u53db\u5f92\uff01\u51fa\u5217',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-food-context/', uid: 'BV-food-context' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8638\u996d\uff01\u8150\u4e73\uff01\u53db\u5f92\uff01\u51fa\u5217']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal gua sha therapy evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u522e\u75e7', family: 'attack', meaning: '\u6e38\u620f\u6216\u4e89\u8bae\u8bed\u5883\u91cc\u6307\u4f4e\u4f24\u5bb3\u6216\u65e0\u6548\u8f93\u51fa', evidenceCount: 0 }],
    },
    [
      '\u6240\u4ee5\u600e\u4e48\u6253\u5440\uff0c\u621120\u7ea7\uff0c\u98de\u9f99\u5251\uff0c\u96be\u5ea60\uff0c\u6253\u7684\u8ddf\u522e\u75e7\u4e00\u6837',
      '\u8fd8\u8bb0\u5f97\u6881\u5bb6\u8f89\u6709\u4e2a\u7535\u5f71\u662f\u513f\u5b50\u522e\u75e7\uff0c\u7136\u540e\u88ab\u5916\u56fd\u4eba\u544a\u8650\u5f85\u513f\u7ae5\u3002\u3002\u3002\u3002',
      '\u6700\u540e\u8fd8\u662f\u6881\u5bb6\u8f89\u7684\u5916\u56fd\u8001\u677f\u4eb2\u81ea\u53bb\u522e\u75e7\u5411\u6cd5\u5b98\u8bc1\u660e\u8fd9\u662f\u4e2d\u56fd\u7597\u6cd5\uff0c\u800c\u4e14\u5f88\u8212\u670d',
      '\u522e\u75e7\uff08\u6307\u4f24\u5bb3\uff09',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-guasha-context/', uid: 'BV-guasha-context' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 2);
  assert.deepEqual(entries[0].evidenceSamples, [
    '\u6240\u4ee5\u600e\u4e48\u6253\u5440\uff0c\u621120\u7ea7\uff0c\u98de\u9f99\u5251\uff0c\u96be\u5ea60\uff0c\u6253\u7684\u8ddf\u522e\u75e7\u4e00\u6837',
    '\u522e\u75e7\uff08\u6307\u4f24\u5bb3\uff09',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects literal eel food and biology evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u9ec4\u9cdd', family: 'attack', meaning: '\u4e89\u8bae\u4e8b\u4ef6\u6216\u653b\u51fb\u8bed\u5883\u91cc\u7684\u9ec4\u9cdd\u6897', evidenceCount: 0 }],
    },
    [
      '\u8c01\u61c2\u60f3\u641c\u4e00\u4e0b\u9ec4\u9cdd\u600e\u4e48\u505a\u597d\u5403\u4ee5\u53ca\u751f\u7269\u79d1\u666e\u7684\u65f6\u5019\u641c\u51fa\u6765\u4e00\u5806\u8fd9\u4e2a\u7684\u65e0\u529b\u611f[\u7b11\u54ed]',
      '\u9ec4\u9cdd\u600e\u4e48\u53ef\u80fd\u585e\u5f97\u8fdb\u5b50\u5bab\uff0c\u9ec4\u9cdd\u95e8\u6211\u90fd\u770b\u4e86\uff0c\u5c31\u5728\u9634\u9053\u91cc\u7a7f\u6765\u7a7f\u53bb',
      '\u9ec4\u9cdd\uff0c\u6211\u662f\u65e0\u8f9c\u7684\u554a',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-eel-context/', uid: 'BV-eel-context' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 3);
  assert.deepEqual(entries[0].evidenceSamples, [
    '\u9ec4\u9cdd\u600e\u4e48\u53ef\u80fd\u585e\u5f97\u8fdb\u5b50\u5bab\uff0c\u9ec4\u9cdd\u95e8\u6211\u90fd\u770b\u4e86\uff0c\u5c31\u5728\u9634\u9053\u91cc\u7a7f\u6765\u7a7f\u53bb',
    '\u9ec4\u9cdd\uff0c\u6211\u662f\u65e0\u8f9c\u7684\u554a',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects quoted evil-laugh source discussion for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u6840\u6840\u6840', family: 'attack', meaning: '\u90aa\u6076\u7b11\u58f0\u6216\u9634\u9633\u602a\u6c14\u7684\u653b\u51fb\u8bed\u6c14', evidenceCount: 0 }],
    },
    [
      '\u6211\u6700\u65e9\u5728\u767d\u9a6c\u5578\u897f\u98ce\u4e2d\u89c1\u8fc7\u8fd9\u4e2a\u6840\u6840\u6840',
      '\u6840\u6840\u6840\uff0c\u4f60\u4eec\u8fd9\u7fa4\u4eba\u5c31\u7ee7\u7eed\u6025\u5427',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-evil-laugh/', uid: 'BV-evil-laugh' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u6840\u6840\u6840\uff0c\u4f60\u4eec\u8fd9\u7fa4\u4eba\u5c31\u7ee7\u7eed\u6025\u5427']);
});

test('findDictionaryEntriesWithTextEvidence rejects benign laoliu praise and title evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u8001\u516d', family: 'attack', meaning: '\u9634\u4eba\u3001\u5077\u88ad\u6216\u5410\u69fd\u5bf9\u65b9\u592a\u8001\u516d\u7684\u8bed\u5883', evidenceCount: 0 }],
    },
    [
      'top06 \u5927\u660e\u8001\u516d',
      '\u4e94\u5237\uff01\u8001\u516d\u5b9e\u5728\u662f\u592a\u597d\u770b\u4e86',
      '\u8fd9\u4eba\u53c8\u8e72\u8349\u9634\u4eba\uff0c\u771f\u8001\u516d',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-laoliu-context/', uid: 'BV-laoliu-context' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u4eba\u53c8\u8e72\u8349\u9634\u4eba\uff0c\u771f\u8001\u516d']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal powerhouse-country evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u5f3a\u56fd', family: 'attack', meaning: '\u4e89\u8bae\u8bed\u5883\u91cc\u5bf9\u6c11\u65cf\u6216\u56fd\u5bb6\u4f18\u8d8a\u611f\u7684\u8bbd\u523a', evidenceCount: 0 }],
    },
    [
      '\u4f60\u4eec\u731c\u731c\u97e9\u56fd\u68d2\u5b50\u4f1a\u4e0d\u4f1a\u8df3\u51fa\u6765\u547c\u5401\u68d2\u5b50\u624d\u662f\u4e16\u754c\u7b2c\u4e00\u5f3a\u56fd\uff1f',
      '\u83f2\u5f8b\u5bbe\u88ab\u89c6\u4e3a\u4e9a\u6d32\u9009\u7f8e\u5f3a\u56fd\uff0c\u66fe\u56db\u6b21\u8d62\u5f97\u73af\u7403\u5c0f\u59d0\u51a0\u519b\u3002',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-powerhouse-context/', uid: 'BV-powerhouse-context' },
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u4eec\u731c\u731c\u97e9\u56fd\u68d2\u5b50\u4f1a\u4e0d\u4f1a\u8df3\u51fa\u6765\u547c\u5401\u68d2\u5b50\u624d\u662f\u4e16\u754c\u7b2c\u4e00\u5f3a\u56fd\uff1f']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal ASMR and game-item evidence for rhetorical terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9885\u5185\u9ad8\u6f6e', family: 'attack', meaning: '\u5bf9\u8a00\u8bba\u81ea\u6211\u9676\u9189\u6216\u60c5\u7eea\u4e0a\u5934\u7684\u8bbd\u523a', evidenceCount: 0 },
        { term: '\u514d\u6b7b\u91d1\u724c', family: 'evasion', meaning: '\u7528\u7279\u6743\u6216\u8eab\u4efd\u56de\u907f\u6279\u8bc4\u7684\u6bd4\u55bb', evidenceCount: 0 },
      ],
    },
    [
      '\u7ecf\u5e38\u542casmr\u52a9\u7720 \u4f46\u662f\u6ca1\u9885\u5185\u9ad8\u6f6e\u8fc7\uff0c\u4e00\u76f4\u4e0d\u77e5\u9053asmr\u8fd8\u80fd\u5e72\u8fd9\u4e2a',
      '\u770b\u8fd9\u6bb5\u81ea\u6211\u611f\u52a8\u7684\u8f93\u51fa\uff0c\u4ed6\u4eec\u771f\u662f\u9885\u5185\u9ad8\u6f6e\u4e86',
      '\u90a3\u4e2a\u88ab\u6253\u6b7b\u4f1a\u5206\u88c2\u7684\u65b0\u602a\u914d\u4e0a\u514d\u6b7b\u91d1\u724c\u592a\u9006\u5929\u4e86\uff0c\u672c\u4f53\u5148\u89e6\u53d1\u4e00\u6b21\u514d\u6b7b\u91d1\u724c',
      '\u4e0d\u8981\u628a\u8001\u7c89\u8eab\u4efd\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u8be5\u9a82\u8fd8\u662f\u8981\u9a82',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-context/', uid: 'BV-literal-context' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u9885\u5185\u9ad8\u6f6e', '\u514d\u6b7b\u91d1\u724c']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u770b\u8fd9\u6bb5\u81ea\u6211\u611f\u52a8\u7684\u8f93\u51fa\uff0c\u4ed6\u4eec\u771f\u662f\u9885\u5185\u9ad8\u6f6e\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u4e0d\u8981\u628a\u8001\u7c89\u8eab\u4efd\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u8be5\u9a82\u8fd8\u662f\u8981\u9a82']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal beggar and game bait-shot evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e5e\u4e10', family: 'attack', meaning: '\u628a\u4eba\u8d2c\u4f4e\u4e3a\u8ba8\u8981\u5229\u76ca\u7684\u653b\u51fb\u8bed', evidenceCount: 0 },
        { term: '\u9a97\u70ae', family: 'evasion', meaning: '\u4ee5\u865a\u5047\u60c5\u611f\u6216\u627f\u8bfa\u8fdb\u884c\u6027\u6b3a\u9a97\u7684\u6307\u63a7', evidenceCount: 0 },
      ],
    },
    [
      '\u770b\u4e00\u4e2a\u4e5e\u4e10\u7528\u4e8c\u7ef4\u7801\u4e5e\u8ba8\uff0c\u5f88\u96be\u8ba9\u4eba\u6709\u540c\u60c5\u611f',
      '\u522b\u518d\u50cf\u4e5e\u4e10\u4e00\u6837\u5230\u5904\u8ba8\u798f\u5229\u4e86',
      '\u4fa7\u540e\u9a97\u70ae\u6700\u5f3a\u7684\u8fd8\u5f97\u662f\u8c22\u91cc\u767b\u4fe9\u5144\u5f1f',
      '\u56de\u590d @\u82c7\u540d\u4e00\u7978 :\u9a97\u70ae\uff1f\u90a3\u5c31\u662f\u81ea\u613f\u7684\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-beggar-shot/', uid: 'BV-literal-beggar-shot' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u4e5e\u4e10', '\u9a97\u70ae']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u522b\u518d\u50cf\u4e5e\u4e10\u4e00\u6837\u5230\u5904\u8ba8\u798f\u5229\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u56de\u590d @\u82c7\u540d\u4e00\u7978 :\u9a97\u70ae\uff1f\u90a3\u5c31\u662f\u81ea\u613f\u7684\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal customs, food, and word-explanation evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5165\u5173', family: 'attack', meaning: '\u501f\u5386\u53f2\u5165\u5173\u6897\u8bbd\u523a\u6269\u5f20\u6216\u6c11\u65cf\u4e3b\u4e49\u8bdd\u672f', evidenceCount: 0 },
        { term: '\u5165\u53e3\u5373\u5316', family: 'attack', meaning: '\u6ee5\u7528\u7f8e\u98df\u8bc4\u4ef7\u7684\u9634\u9633\u602a\u6c14', evidenceCount: 0 },
        { term: '\u745e\u601d\u62dc', family: 'cooperation', meaning: 'respect\u7684\u8c10\u97f3\uff0c\u8868\u8fbe\u8ba4\u53ef', evidenceCount: 0 },
      ],
    },
    [
      '\u56de\u590d @\u949f\u53ef\u4e00\u9047 :\u8fb9\u68c0\u4e5f\u6ca1\u6709\u8bfb\u5fc3\u672f\u554a[\u7b11\u54ed]\u8fd9\u4e0d\u662f\u5165\u5173\u4e86\u624d\u66b4\u9732\u7684\u5417',
      '\u7ea2\u79cb\u88e4\uff0c\u5165\u5173\uff0c\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8',
      '\u723d\u6ed1\u5f39\u7259\uff0c\u5165\u53e3\u5373\u5316\u3002',
      '\u4efb\u4f55\u5927\u4fbf\u7ec8\u5c06\u5165\u53e3\u5373\u5316',
      '\u554a\uff1f\u4e4b\u524d\u522b\u4e2a\u73ed\u6709\u4e2a\u4eba\u5728\u4ed6\u6570\u5b66\u4e66\u4e0a\u5199\u745e\u601d\u62dc \u6211\u4ee5\u4e3a\u4ed6\u5c31\u53eb\u745e\u601d\u62dc',
      '\u56de\u590d @\u7855official :\u5320\u4eba\u7cbe\u795e\uff0c\u745e\u601d\u62dc',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-contexts/', uid: 'BV-literal-contexts' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5165\u5173', '\u5165\u53e3\u5373\u5316', '\u745e\u601d\u62dc']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u7ea2\u79cb\u88e4\uff0c\u5165\u5173\uff0c\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u4efb\u4f55\u5927\u4fbf\u7ec8\u5c06\u5165\u53e3\u5373\u5316']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u56de\u590d @\u7855official :\u5320\u4eba\u7cbe\u795e\uff0c\u745e\u601d\u62dc']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal tree, missing-person, and split shenshen evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4e0a\u6811', family: 'cooperation', meaning: '\u8db3\u7403\u5708\u7b49\u7b49\u6d88\u606f\u7684\u81ea\u6211\u8c03\u4f83', evidenceCount: 0 },
        { term: '\u5931\u8e2a\u4eba\u53e3', family: 'attack', meaning: '\u8c03\u4f83\u957f\u65f6\u95f4\u4e0d\u51fa\u73b0\u7684\u4eba', evidenceCount: 0 },
        { term: '\u795e\u795e', family: 'attack', meaning: '\u9635\u8425\u6307\u79f0\u6216\u620f\u8c11\u5632\u8bbd', evidenceCount: 0 },
      ],
    },
    [
      '\u8868\u9762\u4e0a:\u5154\u5b50\u4e0a\u6811',
      '\u8f6c\u4f1a\u7a97\u8fd8\u6ca1\u5b98\u5ba3\uff0c\u7403\u8ff7\u53c8\u8981\u4e0a\u6811\u7b49\u6d88\u606f\u4e86',
      '\u7f51\u4e0a\u6d41\u4f20\u5931\u8e2a\u4eba\u53e3\u8d85\u8fc72/3\u88ab\u627e\u56de',
      '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86',
      '\u8868\u793a\u539f\u795e\u3001\u795e\u5948\u3001\u90fd\u662f\u5728shimeji\u7684\u57fa\u7840\u4e0a\u4fee\u6539\u7684',
      '\u8fd9\u7fa4\u795e\u795e\u53c8\u5f00\u59cb\u8df3\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-tree-missing-shenshen/', uid: 'BV-literal-tree-missing-shenshen' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u4e0a\u6811', '\u795e\u795e']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8f6c\u4f1a\u7a97\u8fd8\u6ca1\u5b98\u5ba3\uff0c\u7403\u8ff7\u53c8\u8981\u4e0a\u6811\u7b49\u6d88\u606f\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u8fd9\u7fa4\u795e\u795e\u53c8\u5f00\u59cb\u8df3\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects username, source-discussion, and standalone all-in evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u624b\u6b8b', family: 'attack', meaning: '\u5f62\u5bb9\u64cd\u4f5c\u5dee\u6216\u624b\u7b28', evidenceCount: 0 },
        { term: '\u5c4e\u5c71\u4ee3\u7801', family: 'attack', meaning: '\u5f62\u5bb9\u96be\u4ee5\u7ef4\u62a4\u7684\u6df7\u4e71\u4ee3\u7801', evidenceCount: 0 },
        { term: '\u68ad\u54c8', family: 'absolutes', meaning: '\u5168\u90e8\u62bc\u4e0a\u6216\u5f7b\u5e95\u6295\u5165', evidenceCount: 0 },
      ],
    },
    [
      '\u56de\u590d @\u624b\u6b8b\u5f88\u817b\u5bb3\u7684\u76ae\u5361\u4e18:\u4f60\u591f\u4e86\u554a',
      '\u8fd9\u91cc\u8fc7\u4e86\u597d\u591a\u53d8\u8fc7\u4e0d\u53bb[\u5927\u54ed]\u521d\u59cb\u5f13\u7bad\u52a0\u624b\u6b8b\u52a0\u79fb\u52a8\u7aef',
      '\u5c4e\u5c71\u4ee3\u7801\u7684\u6765\u6e90[\u85cf\u72d0]',
      '\u5c4e\u5c71\u4ee3\u7801\u770b\u5230bug\u5728\u54ea\uff0c\u4f46\u662f\u6211\u4e0d\u662f\u795e\u6211\u4e00\u4e2a\u4eba\u4e5f\u641e\u4e0d\u5b9a',
      '\u68ad\u54c8',
      '\u4f60\u770b\uff0c\u53c8\u68ad\u54c8[\u7b11\u54ed]',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-noisy-current-batch/', uid: 'BV-noisy-current-batch' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u624b\u6b8b', '\u5c4e\u5c71\u4ee3\u7801', '\u68ad\u54c8']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u91cc\u8fc7\u4e86\u597d\u591a\u53d8\u8fc7\u4e0d\u53bb[\u5927\u54ed]\u521d\u59cb\u5f13\u7bad\u52a0\u624b\u6b8b\u52a0\u79fb\u52a8\u7aef']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u5c4e\u5c71\u4ee3\u7801\u770b\u5230bug\u5728\u54ea\uff0c\u4f46\u662f\u6211\u4e0d\u662f\u795e\u6211\u4e00\u4e2a\u4eba\u4e5f\u641e\u4e0d\u5b9a']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u4f60\u770b\uff0c\u53c8\u68ad\u54c8[\u7b11\u54ed]']);
});

test('findDictionaryEntriesWithTextEvidence rejects disclaimer, projectile, affordability, and substring evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u62ac\u6760', family: 'attack', meaning: '\u6307\u8d23\u5bf9\u65b9\u65e0\u7406\u4e89\u8fa9', evidenceCount: 0 },
        { term: '\u6295\u5c04', family: 'attack', meaning: '\u6307\u8d23\u4ed6\u4eba\u628a\u81ea\u5df1\u8d1f\u9762\u7279\u8d28\u52a0\u5230\u522b\u4eba\u8eab\u4e0a', evidenceCount: 0 },
        { term: '\u73a9\u4e0d\u8d77', family: 'attack', meaning: '\u6307\u8d23\u5bf9\u65b9\u8f93\u4e0d\u8d77\u6216\u800d\u8d56', evidenceCount: 0 },
        { term: '\u4e38\u4e86', family: 'cooperation', meaning: '\u8c10\u97f3\u5b8c\u4e86\uff0c\u8868\u793a\u7cdf\u7cd5\u6216\u65e0\u5948', evidenceCount: 0 },
      ],
    },
    [
      '\u4e0d\u662f\u62ac\u6760\uff0c\u4f46\u4e07\u4e00\u4ee5\u540e\u51fa\u4e86\u65b0\u5fcd\u8005\u662f\u4e0d\u662f\u8fd8\u8981\u7ee7\u7eed\u9002\u914d[\u7b11\u54ed]',
      '\u771f\u662f\uff0c\u4eca\u5929\u521a\u9047\u5230\u62ac\u6760\u7684\u7ed9\u6211\u6076\u5fc3\u5230\u4e86',
      '\u4f2f\u5fb7\u6295\u5c04\u80fd\u529b\u5f3a\uff0c\u4f46\u662f\u8d76\u675c\u5170\u7279\u548c\u5fb7\u514b\u8fd8\u662f\u5dee\u5f97\u6709\u70b9\u591a\u54e6',
      '\u8fd9\u79cd\u4e00\u79cd\u5178\u578b\u7684\u6295\u5c04\uff08\u5fc3\u7406\u5b66\u540d\u5b57\uff09\uff0c\u4ed6\u5fc3\u91cc\u6709\u810f\u4e1c\u897f\uff0c\u8981\u638f\u51fa\u6765\u62cd\u5230\u522b\u4eba\u8eab\u4e0a',
      '\u4e70\u76d7\u7248\u7684\u4eba\u662f\u56e0\u4e3a\u76d7\u7248\u4fbf\u5b9c\uff0c\u5982\u679c\u76d7\u7248\u6ca1\u4e86\u57fa\u672c\u4e0a\u5c31\u4e0d\u73a9\u4e86\uff0c\u6b63\u7248\u73a9\u4e0d\u8d77',
      '\u8fd9\u68cb\u975e\u5f97\u957f\u5c06\uff0c\u5c31\u662f\u73a9\u4e0d\u8d77[\u7b11\u54ed]',
      '\u53eb\u59b9\u59b9\u53eb\u5b9d\u5b9d\u90fd\u53ef\u4ee5\u7406\u89e3\uff0c\u59b9\u5b9d\u8fd9\u4e2a\u8bcd\u9664\u975e\u5f62\u5bb9\u5f88\u5c0f\u7684\u5c0f\u5973\u5b69\u5426\u5219\u6211\u7684\u8bc4\u4ef7\u662f\u7cd6\u4e38\u4e86',
      '\u54c8\u54c8\u54c8\uff0c\u6211\u98ce\u70ed\u5feb\u597d\u53c8\u6d17\u4e86\u4e2a\u6fa1\uff0c\u4e38\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-disclaimer-literal-contexts/', uid: 'BV-disclaimer-literal-contexts' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u62ac\u6760', '\u6295\u5c04', '\u73a9\u4e0d\u8d77', '\u4e38\u4e86']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u771f\u662f\uff0c\u4eca\u5929\u521a\u9047\u5230\u62ac\u6760\u7684\u7ed9\u6211\u6076\u5fc3\u5230\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u8fd9\u79cd\u4e00\u79cd\u5178\u578b\u7684\u6295\u5c04\uff08\u5fc3\u7406\u5b66\u540d\u5b57\uff09\uff0c\u4ed6\u5fc3\u91cc\u6709\u810f\u4e1c\u897f\uff0c\u8981\u638f\u51fa\u6765\u62cd\u5230\u522b\u4eba\u8eab\u4e0a']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u8fd9\u68cb\u975e\u5f97\u957f\u5c06\uff0c\u5c31\u662f\u73a9\u4e0d\u8d77[\u7b11\u54ed]']);
  assert.equal(entries[3].evidenceCount, 1);
  assert.deepEqual(entries[3].evidenceSamples, ['\u54c8\u54c8\u54c8\uff0c\u6211\u98ce\u70ed\u5feb\u597d\u53c8\u6d17\u4e86\u4e2a\u6fa1\uff0c\u4e38\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects hot-word spam, title mention, and game-location evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u6211\u6545\u610f\u7684', family: 'cooperation', meaning: '\u8868\u793a\u6545\u610f\u505a\u67d0\u4e8b', evidenceCount: 0 },
        { term: '\u65e0\u6148\u60b2', family: 'attack', meaning: '\u8c03\u4f83\u51b7\u9177\u65e0\u60c5', evidenceCount: 0 },
        { term: '\u543e\u547d\u4f11\u77e3', family: 'attack', meaning: '\u8868\u793a\u7edd\u671b\u6216\u56f0\u5883\u7684\u8c03\u4f83', evidenceCount: 0 },
      ],
    },
    [
      '[\u70ed\u8bcd\u7cfb\u5217_\u6211\u6545\u610f\u7684][\u70ed\u8bcd\u7cfb\u5217_\u6211\u6545\u610f\u7684][\u70ed\u8bcd\u7cfb\u5217_\u6211\u6545\u610f\u7684]',
      '\u5bf9\u554a\uff0c\u6211\u6545\u610f\u7684[\u5472\u7259]',
      '\u6211\u9760\u3002\uff01\uff01\uff01\uff01\uff01\uff01\uff01\uff01\u7ec8\u4e8e\u6709\u4eba\u505a\u4e86\u3002\uff01\uff01\uff01\uff01\uff01\uff01\uff01\uff01\ud83d\ude2d\u592a\u597d\u4e86\u65e0\u6148\u60b2\u7ec8\u4e8e\u6709\u89c6\u9891\u4e86\u3002\u3002\u3002',
      'homo\u7279\u6709\u7684\u88c5\u840c\u65b0\uff0c\u6211\u8981\u6485\u4f60\u529b\uff08\u65e0\u6148\u60b2\uff09',
      '\u543e\u547d\u4f11\u77e3\uff0c\u4e00\u4e2a\u5728\u8681\u7a74\uff0c\u4e00\u4e2a\u5728\u51b0\u5c01\u738b\u5ea7\uff0c\u8fd8\u6709\u4e00\u4e2a\u5728\u7f8e\u4eba\u9c7c\u5c9b\u7684\u7814\u7a76\u6240\u91cc\uff0c\u90a3\u4f1a\u5237\u65e0\u547d\u4fee\u77e3',
      '\u8fd9\u6ce2\u88ab\u56f4\u4e86\uff0c\u771f\u7684\u543e\u547d\u4f11\u77e3[\u7b11\u54ed]',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-low-quality-evidence/', uid: 'BV-low-quality-evidence' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u6211\u6545\u610f\u7684', '\u65e0\u6148\u60b2', '\u543e\u547d\u4f11\u77e3']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u5bf9\u554a\uff0c\u6211\u6545\u610f\u7684[\u5472\u7259]']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['homo\u7279\u6709\u7684\u88c5\u840c\u65b0\uff0c\u6211\u8981\u6485\u4f60\u529b\uff08\u65e0\u6148\u60b2\uff09']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u8fd9\u6ce2\u88ab\u56f4\u4e86\uff0c\u771f\u7684\u543e\u547d\u4f11\u77e3[\u7b11\u54ed]']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal covering-mouth, proper-name sigma, and merchant-name evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u6342\u5634', family: 'attack', meaning: '\u6307\u538b\u5236\u8a00\u8bba\u6216\u4e0d\u8ba9\u6279\u8bc4\u53d1\u58f0', evidenceCount: 0 },
        { term: '\u897f\u683c\u739b', family: 'cooperation', meaning: 'sigma male\u7684\u8c10\u97f3\uff0c\u8868\u793a\u72ec\u7acb\u4e0d\u8fce\u5408', evidenceCount: 0 },
        { term: '\u5c0f\u998b\u732b', family: 'attack', meaning: '\u8c03\u4f83\u5bf9\u65b9\u8d2a\u5fc3\u6216\u60f3\u5360\u4fbf\u5b9c', evidenceCount: 0 },
      ],
    },
    [
      '\u6234\u7740\u6bdb\u7ebf\u5e3d\u6342\u5634\u90a3\u4e00\u5e55\u662f\u5728\u5267\u91cc\u8fb9\u7684\u561b?\u54ea\u4e2a\u6765\u7740\u554a',
      '\u6562\u5728\u73a9\u5bb6\u706b\u6c14\u6700\u5927\u7684\u65f6\u5019\u6342\u5634\uff0c\u9b54\u65b9\u6361\u5230\u9b3c\u624d\u516c\u5173\u4e86\u554a',
      '\u786e\u5b9e\u6311\u6218\u4e86\uff0c\u897f\u683c\u739b\u540e\u9762\u7528\u59cb\u7687\u5e1d\u7684\u5f29\u628a\u4f0a\u4ec0\u5854\u5c14\u5c04\u4e0b\u6765\u4e86',
      '\u674e\u54e5\u4f9d\u65e7\u897f\u683c\u739b',
      '\u56de\u590d @\u90a3\u9875\u7684\u538b\u82b1 :\u5c0f\u998b\u732b\u548c\u8c22\u5b9d\u6797\u4e24\u5bb6\u5728\u4ed6\u76f4\u64ad\u95f4\u5237\u793c\u7269\u8ba9\u5e2e\u7740\u5ba3\u4f20',
      '\u201c\u5c0f\u998b\u732b\u201d',
      '\u56de\u590d @\u963f\u5c0f\u67ef101 :\u5c0f\u998b\u732b\uff0c\u4ec0\u4e48\u90fd\u60f3\u5403\u53ea\u4f1a\u4e0d\u8fc7\u5ba1[doge]',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-mouth-sigma-merchant/', uid: 'BV-literal-mouth-sigma-merchant' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u6342\u5634', '\u897f\u683c\u739b', '\u5c0f\u998b\u732b']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u6562\u5728\u73a9\u5bb6\u706b\u6c14\u6700\u5927\u7684\u65f6\u5019\u6342\u5634\uff0c\u9b54\u65b9\u6361\u5230\u9b3c\u624d\u516c\u5173\u4e86\u554a']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u674e\u54e5\u4f9d\u65e7\u897f\u683c\u739b']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u56de\u590d @\u963f\u5c0f\u67ef101 :\u5c0f\u998b\u732b\uff0c\u4ec0\u4e48\u90fd\u60f3\u5403\u53ea\u4f1a\u4e0d\u8fc7\u5ba1[doge]']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal yang-qi health evidence for attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9633\u6c14\u4e0d\u8db3', family: 'attack', meaning: '\u9634\u9633\u602a\u6c14\u5730\u5632\u8bbd\u5bf9\u65b9\u4f53\u865a\u6216\u7cbe\u795e\u72b6\u6001\u4e0d\u4f73', evidenceCount: 0 },
      ],
    },
    [
      '\u89c6\u9891\u8bb2\u89e3\u4e86\u9633\u6c14\u4e0d\u8db3\u7684\u4e03\u4e2a\u5e38\u89c1\u8868\u73b0\uff0c\u5e2e\u52a9\u5927\u5bb6\u81ea\u6211\u8bca\u65ad\u662f\u5426\u9633\u865a\u3002',
      '\u6478\u809a\u8110\u6e29\u5dee\u611f\u53d7\u9633\u865a\uff0c\u624b\u811a\u51b0\u51c9\u63d0\u793a\u9633\u6c14\u4e0d\u8db3\uff0c\u6015\u51b7\u6015\u98ce\u6301\u7eed\u65f6\u95f4\u957f\uff0c\u9891\u7e41\u611f\u5192\u54b3\u55fd\u75c7\u72b6\u8f7b\uff0c\u8fc7\u654f\u6027\u9f3b\u708e\u5bd2\u90aa\u4fb5\u88ad\uff0c\u80c3\u5bd2\u8179\u6cfb\u813e\u9633\u4e0d\u8db3\uff0c\u591c\u5c3f\u591a\u80be\u9633\u865a\u8868\u73b0\uff0c\u517b\u6210\u597d\u4e60\u60ef\u9632\u9633\u865a',
      '\u4f60\u8fd9\u6837\u9a82\u4eba\u662f\u9633\u6c14\u4e0d\u8db3\u5427\uff0c\u522b\u592a\u865a\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-yang-qi-literal/', uid: 'BV-yang-qi-literal' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u9633\u6c14\u4e0d\u8db3']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u6837\u9a82\u4eba\u662f\u9633\u6c14\u4e0d\u8db3\u5427\uff0c\u522b\u592a\u865a\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects meme-source discussion for evasion phrase evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16', family: 'evasion', meaning: 'homo\u6897\uff0c\u7528\u8c10\u97f3\u548c\u5708\u5185\u6897\u9003\u907f\u8ba8\u8bba\u6216\u6076\u641e', evidenceCount: 0 },
      ],
    },
    [
      '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16\uff0c114514\uff0c\u61c2\u4e86\u5427\uff1f',
      '\u5f53\u521d\u770b\u5230\u201c114514\u201d\u53d8\u6210\u201c\u9038\u4e00\u65f6\uff0c\u8bef\u4e00\u4e16\u201d\u7684\u65f6\u5019\uff0c\u7b2c\u4e00\u611f\u89c9\u662f\u8fd9\u6897\u672c\u571f\u5316\u7684\u597d\u725b\u6279[\u7b11\u54ed]',
      '\u9038\u4e00\u65f6\uff0c\u8bef\u4e00\u4e16\uff0c\u9038\u4e45\u5fc6\u65e7\u7f62\u4e00\u9f84\u3002',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-yishi-meme-source/', uid: 'BV-yishi-meme-source' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u9038\u4e00\u65f6\u8bef\u4e00\u4e16']);
  assert.equal(entries[0].evidenceCount, 2);
  assert.deepEqual(entries[0].evidenceSamples, [
    '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16\uff0c114514\uff0c\u61c2\u4e86\u5427\uff1f',
    '\u9038\u4e00\u65f6\uff0c\u8bef\u4e00\u4e16\uff0c\u9038\u4e45\u5fc6\u65e7\u7f62\u4e00\u9f84\u3002',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects literal sexual-fantasy and biological-stress evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u610f\u6deb', family: 'attack', meaning: '\u8d2c\u4f4e\u5bf9\u65b9\u7a7a\u60f3\u3001\u4e0d\u5207\u5b9e\u9645\uff0c\u7528\u4e8e\u5632\u8bbd', evidenceCount: 0 },
        { term: '\u5e94\u6fc0', family: 'attack', meaning: '\u7f51\u7edc\u7528\u8bed\uff0c\u6307\u5bf9\u67d0\u4e8b\u8fc7\u5ea6\u53cd\u5e94\u3001\u4e00\u60ca\u4e00\u4e4d', evidenceCount: 0 },
      ],
    },
    [
      '\u8ba8\u538c\u610f\u6deb',
      '\u8bf4\u51fa\u4e86\u6211\u7684\u5fc3\u58f0\u2026\u2026\u88ab\u4eba\u610f\u6deb\u771f\u7684\u5f88\u6076\u5fc3\u7684\u8bf4',
      '\u4f60\u8fd9\u5c31\u662f\u5728\u610f\u6deb\u5bf9\u65b9\u4f1a\u9053\u6b49\uff0c\u522b\u505a\u68a6\u4e86',
      '\u5e94\u6fc0\u4e3a\u4ec0\u4e48\u548c\u514d\u75ab\u529b\u6709\u5173\u8bf6\uff1f\uff08\u65b0\u4eba\u597d\u5947\uff09',
      '\u6211\u7684\u706b\u7130\u5c31\u662f\u62ff\u56de\u5bb6\u4e4b\u540e\u5e94\u6fc0\u6b7b\u7684\uff0c\u4e00\u665a\u4e0a\u5c31\u50f5\u76f4\u4e86',
      '\u5565?\u4e4c\u9f9f\u4e5f\u4f1a\u5e94\u6fc0',
      '\u4f60\u4eec\u770b\u89c1\u7c73\u54c8\u6e38\u5c31\u5e94\u6fc0\uff0c\u522b\u592a\u6025',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-fantasy-stress/', uid: 'BV-literal-fantasy-stress' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u610f\u6deb', '\u5e94\u6fc0']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u5c31\u662f\u5728\u610f\u6deb\u5bf9\u65b9\u4f1a\u9053\u6b49\uff0c\u522b\u505a\u68a6\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u4f60\u4eec\u770b\u89c1\u7c73\u54c8\u6e38\u5c31\u5e94\u6fc0\uff0c\u522b\u592a\u6025']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal career-change and negated-mouthpiece evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u8f6c\u884c', family: 'attack', meaning: '\u5728\u7279\u5b9a\u8bed\u5883\u4e0b\u8bbd\u523a\u535a\u4e3b\u66f4\u6362\u8d5b\u9053\uff0c\u6697\u542b\u8c03\u4f83', evidenceCount: 0 },
        { term: '\u5634\u66ff', family: 'cooperation', meaning: '\u6307\u66ff\u522b\u4eba\u8bf4\u51fa\u4e86\u5fc3\u91cc\u8bdd\uff0c\u8868\u8fbe\u8ba4\u540c', evidenceCount: 0 },
      ],
    },
    [
      '\u8f6c\u884c\u5356\u753b\uff1f\u6211\u8bb0\u5f97\u4ed6\u4e00\u76f4\u90fd\u662f\u753b\u753b\u7684',
      '\u5bf9\u4e8e\u540e\u671f\u8f6c\u884c\u7684\u5efa\u8bae',
      '\u4ec0\u4e4830+40+ 0\u57fa\u7840\u8f6c\u884c\u7684\uff0c\u5c31\u95ee\u4f60\u4eec\u4e00\u53e5\uff0c\u4eba\u5bb6\u4e13\u4e1a\u79d1\u73ed\u7684\u90fd\u6ca1\u8981\u5168\uff0c\u8981\u4f60\u4e2a\u517c\u804c\u534a\u8def\u51fa\u5bb6\u7684\u5e72\u561b\uff1f',
      '\u8fd9up\u518d\u8fd9\u6837\u62cd\u4e0b\u53bb\u4e0d\u5982\u8f6c\u884c\u5356\u8bfe\u7b97\u4e86',
      '\u539f\u8457\u515a\u5fc3\u91cc\u7684\u8bdd\u5168\u7ed9up\u5634\u66ff\u51fa\u6765\u4e86\uff01\uff01',
      '\u8fd9\u4e0d\u662f\u6253\u5de5\u4eba\u5634\u66ff\uff0c\u8fd9\u662f\u65e0\u80fd\u72c2\u6012',
      '\u5634\u66ff\u6709\u5c41\u7528',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-career-mouthpiece/', uid: 'BV-career-mouthpiece' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u8f6c\u884c', '\u5634\u66ff']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9up\u518d\u8fd9\u6837\u62cd\u4e0b\u53bb\u4e0d\u5982\u8f6c\u884c\u5356\u8bfe\u7b97\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u539f\u8457\u515a\u5fc3\u91cc\u7684\u8bdd\u5168\u7ed9up\u5634\u66ff\u51fa\u6765\u4e86\uff01\uff01']);
});

test('findDictionaryEntriesWithTextEvidence rejects retirement-dance and standalone emote evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u6700\u540e\u4e00\u821e', family: 'evasion', meaning: '\u8d4c\u535a\u8bdd\u672f\uff0c\u6307\u6700\u540e\u4e00\u6b21\u5192\u9669\uff0c\u56de\u907f\u5bf9\u540e\u679c\u7684\u7406\u6027\u8ba8\u8bba', evidenceCount: 0 },
        { term: 'doge\u5723\u8bde', family: 'cooperation', meaning: '\u7f51\u7edc\u7528\u8bed\uff0c\u53d1\u5e16\u65f6\u6dfb\u52a0[doge]\u8868\u793a\u73a9\u7b11\u6216\u53cd\u8bbd\uff0c\u907f\u514d\u88ab\u8ba4\u771f\u653b\u51fb', evidenceCount: 0 },
      ],
    },
    [
      '\u6700\u540e\u4e00\u821e?\u6700\u540e\u4e00\u6b66!',
      '\u4ec0\u4e48\u53eb\u505a\u6700\u540e\u4e00\u821e\uff0c\u660e\u660e\u5c31\u662f\u6700\u540e\u4e00\u6b66\uff01',
      '\u6700\u540e\u4e00\u821e\u5417\uff0c\u611f\u89c9\u8fd8\u5f88\u6709\u6c34\u51c6\u554a\uff0c\u8fd8\u611f\u89c9\u8fd8\u6709\u7a76\u6781\u4e00\u821e',
      '\u8fd9\u628a\u5168\u538b\u4e0a\uff0c\u6700\u540e\u4e00\u821e\u4e86\uff0c\u8d62\u4e86\u4e0a\u5cb8\u8f93\u4e86\u7b97\u4e86',
      '\u7ed9\u5976\u8336\u6362\u4e2a\u5973\u88c5\u4e5f\u6beb\u65e0\u8fdd\u548c\u611f\u4e86\u73b0\u5728[doge-\u5723\u8bde]',
      '\u54c8\u54c8[doge-\u5723\u8bde]',
      '\u54c8\u54c8\u54c8[doge-\u5723\u8bde][doge-\u5723\u8bde][doge-\u5723\u8bde]',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-last-doge/', uid: 'BV-last-doge' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u6700\u540e\u4e00\u821e', 'doge\u5723\u8bde']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u628a\u5168\u538b\u4e0a\uff0c\u6700\u540e\u4e00\u821e\u4e86\uff0c\u8d62\u4e86\u4e0a\u5cb8\u8f93\u4e86\u7b97\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u7ed9\u5976\u8336\u6362\u4e2a\u5973\u88c5\u4e5f\u6beb\u65e0\u8fdd\u548c\u611f\u4e86\u73b0\u5728[doge-\u5723\u8bde]']);
});

test('findDictionaryEntriesWithTextEvidence rejects standalone dumpling insult evidence without a target', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u997a\u5b50\u8001\u516b', family: 'attack', meaning: '\u7528\u738b\u516b\u4fae\u8fb1\u5bf9\u65b9\uff0c\u7ed3\u5408\u997a\u5b50\u6897\u7684\u653b\u51fb\u6027\u8868\u8fbe', evidenceCount: 0 },
      ],
    },
    [
      '\u997a\u5b50\u8001\u516b\u3002[doge][doge]',
      '\u997a\u5b50\u8001\u516b[doge]',
      '\u4f60\u8fd9\u79cd\u6d17\u767d\u8bdd\u672f\u5c31\u662f\u997a\u5b50\u8001\u516b\uff0c\u522b\u88c5\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-dumpling-insult/', uid: 'BV-dumpling-insult' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u997a\u5b50\u8001\u516b']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u79cd\u6d17\u767d\u8bdd\u672f\u5c31\u662f\u997a\u5b50\u8001\u516b\uff0c\u522b\u88c5\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects standalone short attack evidence without a target', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u997a\u5b50\u738b\u516b', family: 'attack', meaning: '\u7528\u738b\u516b\u4fae\u8fb1\u5bf9\u65b9\uff0c\u7ed3\u5408\u997a\u5b50\u6897\u7684\u653b\u51fb\u6027\u8868\u8fbe', evidenceCount: 0 },
        { term: '\u53eb\u8fd9\u4e48\u723d', family: 'attack', meaning: '\u5bf9\u4ed6\u4eba\u5174\u594b\u8868\u73b0\u7684\u5632\u8bbd\uff0c\u6697\u793a\u5176\u8fc7\u5ea6\u6216\u505a\u4f5c', evidenceCount: 0 },
      ],
    },
    [
      '\u997a\u5b50\u738b\u516b\uff01',
      '\u53eb\u8fd9\u4e48\u723d',
      '\u4f60\u522b\u88c5\u4e86\uff0c\u8fd9\u79cd\u997a\u5b50\u738b\u516b\u8bdd\u672f\u5c31\u662f\u5728\u9a82\u4eba',
      '\u521a\u88ab\u53cd\u9a73\u5c31\u53eb\u8fd9\u4e48\u723d\uff0c\u4f60\u662f\u6025\u4e86\u5417',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-short-attack/', uid: 'BV-short-attack' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u997a\u5b50\u738b\u516b', '\u53eb\u8fd9\u4e48\u723d']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u522b\u88c5\u4e86\uff0c\u8fd9\u79cd\u997a\u5b50\u738b\u516b\u8bdd\u672f\u5c31\u662f\u5728\u9a82\u4eba']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u521a\u88ab\u53cd\u9a73\u5c31\u53eb\u8fd9\u4e48\u723d\uff0c\u4f60\u662f\u6025\u4e86\u5417']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal meme and cheat-code evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4ecb\u53f8\u9ebb\u82bd', family: 'attack', meaning: '\u65b9\u8a00\u8c10\u97f3\u201c\u8fd9\u662f\u4ec0\u4e48\u5440\u201d\uff0c\u8868\u793a\u8d28\u7591\u6216\u5632\u8bbd', evidenceCount: 0 },
        { term: '\u91d1\u5777\u5783', family: 'absolutes', meaning: '\u6e90\u81ea\u80a5\u6599\u5e7f\u544a\u7684\u6897\uff0c\u540e\u7528\u4e8e\u6307\u4ee3\u68c0\u9a8c\u795e\u66f2\u7684\u552f\u4e00\u6807\u51c6\u7b49\u7edd\u5bf9\u5316\u65ad\u8a00', evidenceCount: 0 },
        { term: '\u91d1\u624b\u6307', family: 'attack', meaning: '\u6307\u4e3b\u89d2\u5149\u73af\u6216\u4e0d\u5408\u7406\u7684\u4fbf\u5229\u6761\u4ef6\uff0c\u7528\u4e8e\u6279\u8bc4\u5267\u60c5\u903b\u8f91', evidenceCount: 0 },
      ],
    },
    [
      '\u4ecb\u53f8\u9ebb\u82bd',
      '\u4f60\u8fd9\u6ce2\u6d17\u767d\u771f\u662f\u4ecb\u53f8\u9ebb\u82bd\uff0c\u8bf4\u4e0d\u901a\u5427',
      '\u4e00\u4e2a\u9b3c\u755cup\u4e3b\u6ca1\u6709\u91d1\u5777\u5783\u662f\u53ef\u6015\u7684\uff0c\u6709\u4e86\u91d1\u5777\u5783\u4e0d\u53bb\u73cd\u60dc\u662f\u53ef\u60b2\u7684',
      '\u8fd8\u8bb0\u5f97\u300c\u91d1\u7ebf\u300d\u91cc\u9762\u5199\u7684\u91d1\u5777\u5783\u914d\u65b9\u516c\u5f00\u5417\uff1f\u8fd9\u6b21\u6210\u771f\u4e8b\u4e86\uff01',
      '\u8fd9\u79cd\u89c6\u9891\u68c0\u9a8c\u795e\u66f2\u53ea\u770b\u91d1\u5777\u5783\uff0c\u8fd9\u5c31\u662f\u552f\u4e00\u6807\u51c6\u5417',
      '\u8fd9\u4e2a\u53ef\u4ee5\u81ea\u5df1\u5206\u6790\u51fa\u6765\uff0c\u5982\u4f55\u6539\u51fa\u6240\u6709\u7684\u5b9d\u53ef\u68a6\uff0c\u8fd9\u73a9\u610f\u6700\u540e\u9762\u7684\u5c31\u662f\u5341\u516d\u8fdb\u5236\u91d1\u624b\u6307',
      '\u8fd9\u4e2a\u4e3b\u89d2\u770b\u5565\u609f\u5565\uff0c\u4ec0\u4e48\u90fd\u9760\u91d1\u624b\u6307\u63a8\u8fc7\u53bb\uff0c\u5267\u60c5\u592a\u79bb\u8c31',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-meme-cheat/', uid: 'BV-literal-meme-cheat' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u4ecb\u53f8\u9ebb\u82bd', '\u91d1\u5777\u5783', '\u91d1\u624b\u6307']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u6ce2\u6d17\u767d\u771f\u662f\u4ecb\u53f8\u9ebb\u82bd\uff0c\u8bf4\u4e0d\u901a\u5427']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u8fd9\u79cd\u89c6\u9891\u68c0\u9a8c\u795e\u66f2\u53ea\u770b\u91d1\u5777\u5783\uff0c\u8fd9\u5c31\u662f\u552f\u4e00\u6807\u51c6\u5417']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u8fd9\u4e2a\u4e3b\u89d2\u770b\u5565\u609f\u5565\uff0c\u4ec0\u4e48\u90fd\u9760\u91d1\u624b\u6307\u63a8\u8fc7\u53bb\uff0c\u5267\u60c5\u592a\u79bb\u8c31']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested meta and standalone meme evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7ecf\u5178\u52a0\u94b1', family: 'attack', meaning: '\u8bbd\u523a\u8ba8\u8bba\u4e2d\u603b\u662f\u5efa\u8bae\u52a0\u94b1\u5347\u7ea7\uff0c\u5e38\u7528\u4e8e\u8c03\u4f83\u6d88\u8d39\u4e3b\u4e49', evidenceCount: 0 },
        { term: '\u7cbe\u795e\u7537\u4eba', family: 'attack', meaning: '\u6307\u5973\u6027\u8ba4\u540c\u7537\u6027\u4ef7\u503c\u89c2\u3001\u8d2c\u4f4e\u81ea\u8eab\u6027\u522b\uff0c\u5e38\u4f5c\u653b\u51fb\u6027\u6807\u7b7e', evidenceCount: 0 },
        { term: '\u8b66\u60d5\u901f\u80dc\u8bba', family: 'attack', meaning: '\u5316\u7528\u5386\u53f2\u672f\u8bed\uff0c\u8bbd\u523a\u6025\u4e8e\u6c42\u6210\u6216\u8f7b\u4fe1\u5b98\u65b9\u7684\u6001\u5ea6', evidenceCount: 0 },
      ],
    },
    [
      '\u7ecf\u5178\u52a0\u94b1',
      '\u4f60\u8fd9\u5957\u914d\u7f6e\u63a8\u8350\u53c8\u662f\u7ecf\u5178\u52a0\u94b1\uff0c\u6839\u672c\u4e0d\u770b\u522b\u4eba\u9884\u7b97',
      '\u5979\u53ef\u4ece\u6ca1\u8bf4\u8fc7\u81ea\u5df1\u8ba8\u538c\u5a18\u7684\u4e1c\u897f\u4e5f\u6ca1\u8fb1\u9a82\u5973\u6027\u5c0f\u6bcd\u72d7[\u7b11\u54ed][\u7b11\u54ed]\u53ef\u4ee5\u628a\u6211\u5f53\u7537\u4eba\u6765\u4f7f\u2260\u6211\u5c31\u662f\u7537\u4eba\uff0c\u5979\u610f\u601d\u660e\u663e\u5c31\u662f\u7537\u4eba\u80fd\u505a\u7684\u4e8b\u60c5\u6211\u4e5f\u80fd\u505a\uff0c\u4e0d\u7528\u523b\u610f\u8ba9\u7740\u6211\uff0c\u8fd9\u662f\u8ddf\u7cbe\u795e\u7537\u4eba\u6700\u4e0d\u4e00\u6837\u7684\u4e1c\u897f',
      '\u8fd9\u79cd\u8a00\u8bba\u5c31\u662f\u628a\u7cbe\u795e\u7537\u4eba\u5f53\u8363\u8a89\uff0c\u53cd\u8fc7\u6765\u8e29\u81ea\u5df1\u4eba',
      '\u5efa\u8baeup\u76f4\u63a5\u89c6\u9891\u540d\u5b57\u5c31\u52a0\u4e0a\u8b66\u60d5\u901f\u80dc\u8bba[\u5999\u554a]\u70b9\u8fdb\u6765\u7684\u4f1a\u66f4\u591a',
      '\u4f60\u4eec\u8fd8\u5728\u8b66\u60d5\u901f\u80dc\u8bba\uff0c\u5b9e\u9645\u8fde\u57fa\u672c\u6750\u6599\u90fd\u6ca1\u770b\u5b8c',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-harvested-meta-meme/', uid: 'BV-harvested-meta-meme' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u7ecf\u5178\u52a0\u94b1', '\u7cbe\u795e\u7537\u4eba', '\u8b66\u60d5\u901f\u80dc\u8bba']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u5957\u914d\u7f6e\u63a8\u8350\u53c8\u662f\u7ecf\u5178\u52a0\u94b1\uff0c\u6839\u672c\u4e0d\u770b\u522b\u4eba\u9884\u7b97']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u8fd9\u79cd\u8a00\u8bba\u5c31\u662f\u628a\u7cbe\u795e\u7537\u4eba\u5f53\u8363\u8a89\uff0c\u53cd\u8fc7\u6765\u8e29\u81ea\u5df1\u4eba']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u4f60\u4eec\u8fd8\u5728\u8b66\u60d5\u901f\u80dc\u8bba\uff0c\u5b9e\u9645\u8fde\u57fa\u672c\u6750\u6599\u90fd\u6ca1\u770b\u5b8c']);
});

test('findDictionaryEntriesWithTextEvidence rejects nickname-only correction-label evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7ea0\u6b63\u54e5', family: 'attack', meaning: '\u5632\u8bbd\u7231\u7ea0\u6b63\u522b\u4eba\u7684\u4eba\u7684\u6807\u7b7e', evidenceCount: 0 },
      ],
    },
    [
      '\u7ea0\u6b63\u54e5\u73b0\u5728\u5728\u6296\u97f3',
      '\u770b\u6a21\u6837\u4e5f\u6ca1\u6709\u56db\u5341\u54c8\u54c8\u5565\u95ee\u9898\u554a\uff0c\u53eb\u54e5\u5c31\u884c\u4e86\u7ea0\u6b63\u54e5\u6709\u70b9\u4e0d\u548b\u597d\u542c',
      '\u4f60\u8fd9\u79cd\u9022\u5b57\u5c31\u6539\u7684\u7ea0\u6b63\u54e5\uff0c\u6839\u672c\u4e0d\u662f\u8ba8\u8bba\u95ee\u9898',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-correction-label/', uid: 'BV-correction-label' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u7ea0\u6b63\u54e5']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u79cd\u9022\u5b57\u5c31\u6539\u7684\u7ea0\u6b63\u54e5\uff0c\u6839\u672c\u4e0d\u662f\u8ba8\u8bba\u95ee\u9898']);
});

test('findDictionaryEntriesWithTextEvidence rejects standalone and neutral woke-pun evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u6485\u9192', family: 'attack', meaning: '\u8c10\u97f3\u201c\u89c9\u9192\u201d\uff0c\u8bbd\u523a\u81ea\u8ba4\u4e3a\u89c9\u9192\u7684\u5de6\u6d3e\u4eba\u58eb', evidenceCount: 0 },
        { term: '\u6485\u9192\u4eba', family: 'attack', meaning: '\u8c10\u97f3\u201c\u89c9\u9192\u201d\uff0c\u8bbd\u523a\u81ea\u8ba4\u4e3a\u89c9\u9192\u7684\u5de6\u6d3e\u4eba\u58eb', evidenceCount: 0 },
        { term: '\u6485\u9192\u8005', family: 'attack', meaning: '\u8c10\u97f3\u201c\u89c9\u9192\u201d\uff0c\u8bbd\u523a\u81ea\u8ba4\u4e3a\u89c9\u9192\u7684\u5de6\u6d3e\u4eba\u58eb', evidenceCount: 0 },
      ],
    },
    [
      '\u6485\uff01\u9192\uff01',
      '\u5b9e\u9645\u4e0a\u6485\u9192\u8005\u548c\u89c9\u9192\u8005\u5f88\u5bb9\u6613\u533a\u5206',
      '\u4f60\u8fd9\u5957\u628a\u522b\u4eba\u90fd\u6253\u6210\u53cd\u52a8\u7684\u6485\u9192\u4eba\u8bdd\u672f\uff0c\u6839\u672c\u4e0d\u662f\u8ba8\u8bba\u95ee\u9898',
      '\u8fd9\u7fa4\u6485\u9192\u8005\u53c8\u5f00\u59cb\u628a\u6b63\u5e38\u8d28\u7591\u6253\u6210\u7acb\u573a\u95ee\u9898',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-woke-pun/', uid: 'BV-woke-pun' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u6485\u9192', '\u6485\u9192\u4eba', '\u6485\u9192\u8005']);
  assert.equal(entries.every((entry) => entry.evidenceCount === 2), true);
  assert.deepEqual(entries[0].evidenceSamples, [
    '\u4f60\u8fd9\u5957\u628a\u522b\u4eba\u90fd\u6253\u6210\u53cd\u52a8\u7684\u6485\u9192\u4eba\u8bdd\u672f\uff0c\u6839\u672c\u4e0d\u662f\u8ba8\u8bba\u95ee\u9898',
    '\u8fd9\u7fa4\u6485\u9192\u8005\u53c8\u5f00\u59cb\u628a\u6b63\u5e38\u8d28\u7591\u6253\u6210\u7acb\u573a\u95ee\u9898',
  ]);
  assert.deepEqual(entries[1].evidenceSamples, entries[0].evidenceSamples);
  assert.deepEqual(entries[2].evidenceSamples, entries[0].evidenceSamples);
});

test('findDictionaryEntriesWithTextEvidence rejects source-meme insults and literal complaint evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: 'wdnmd', family: 'attack', meaning: '\u201c\u6211\u5e26\u4f60\u5417\u7684\u201d\u7f29\u5199\uff0c\u8fb1\u9a82\u6027\u653b\u51fb\u8868\u8fbe', evidenceCount: 0 },
        { term: '\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', meaning: '\u5a01\u80c1\u901a\u8fc7\u5b98\u65b9\u6295\u8bc9\u6e20\u9053\u7ef4\u6743\uff0c\u6697\u793a\u5bf9\u65b9\u865a\u5047\u5ba3\u4f20', evidenceCount: 0 },
      ],
    },
    [
      'wdnmd\u8fd9\u4e2a\u90fd\u4e0d\u706b\uff1f[\u70ed\u8bcd\u7cfb\u5217_\u77e5\u8bc6\u589e\u52a0]',
      '\ud83c\udf46\uff1aWDNMD',
      '\u4f60\u8fd9\u64cd\u4f5cwdnmd\uff0c\u522b\u518d\u9a82\u4eba\u4e86',
      '\u6211\u5de5\u4fe1\u90e8\u6295\u8bc9\u4e86\uff0c\u4e2d\u56fd\u79fb\u52a8\u7535\u4fe1\u5957\u9910\u6d88\u8d39\u6b3a\u8bc8\uff0c\u8981\u6c42\u8d54\u507f',
      '\u627e\u5de5\u4fe1\u90e8\u6295\u8bc9\u5305\u6709\u7528\u7684\uff0c\u621124\u5e74\u5347\u7ea7\u7684129\u5957\u9910\u6bcf\u6708\u4f18\u60e040',
      '\u4f60\u8fd9\u865a\u5047\u5ba3\u4f20\u518d\u4e0d\u6539\uff0c\u6211\u5c31\u5de5\u4fe1\u90e8\u6295\u8bc9\u4e86',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-wdnmd-complaint/', uid: 'BV-wdnmd-complaint' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['wdnmd', '\u5de5\u4fe1\u90e8\u6295\u8bc9']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u64cd\u4f5cwdnmd\uff0c\u522b\u518d\u9a82\u4eba\u4e86']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u4f60\u8fd9\u865a\u5047\u5ba3\u4f20\u518d\u4e0d\u6539\uff0c\u6211\u5c31\u5de5\u4fe1\u90e8\u6295\u8bc9\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects song-title evidence for metaphor terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5b64\u52c7\u8005', family: 'cooperation', meaning: '\u79f0\u8d5e\u6562\u4e8e\u5bf9\u6297\u7f51\u7edc\u66b4\u529b\u7684\u4e2a\u4eba\uff0c\u5e26\u6709\u6b63\u9762\u8272\u5f69', evidenceCount: 0 },
        { term: '\u5c81\u6708\u795e\u5077', family: 'attack', meaning: '\u5316\u7528\u7535\u5f71\u540d\uff0c\u6307\u67d0\u4eba\u901a\u8fc7\u4e0d\u6b63\u5f53\u624b\u6bb5\u7a83\u53d6\u4ed6\u4eba\u6210\u5c31\u6216\u673a\u4f1a', evidenceCount: 0 },
      ],
    },
    [
      '\u5b64\u52c7\u8005\u5176\u5b9e\u771f\u8fd8\u884c',
      '\u5347\u8c03\u7684\u5b64\u52c7\u8005\u914d\u751c\u871c\u871c\u6b4c\u8bcd\u65e2\u7136\u6709\u70b9\u751c',
      '\u5728\u8fd9\u79cd\u7f51\u66b4\u91cc\u8fd8\u613f\u610f\u53d1\u58f0\uff0c\u4ed6\u624d\u662f\u771f\u6b63\u7684\u5b64\u52c7\u8005',
      '\u3010\u300e\u65e0\u635f\u300f\u300a\u5c81\u6708\u795e\u5077\u300b\uff08demo\uff09\u91d1\u73df\u5c90\uff08\u9644\u4e0b\u8f7d\u94fe\u63a5\uff09-\u54d4\u54e9\u54d4\u54e9\u3011 https://b23.tv/dgGg3Gk[\u5403\u74dc]',
      '\u300a\u5c81\u6708\u795e\u5077\u300b\u80fd\u591f\u63e1\u7d27\u7684\u5c31\u522b\u653e\u4e86\u80fd\u591f\u62e5\u62b1\u7684\u5c31\u522b\u62c9\u626f',
      '\u5c81\u6708\u795e\u5077',
      '\u4ed6\u628a\u522b\u4eba\u7684\u673a\u4f1a\u90fd\u62a2\u8d70\u4e86\uff0c\u8fd9\u624d\u662f\u771f\u6b63\u7684\u5c81\u6708\u795e\u5077',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-song-metaphor/', uid: 'BV-song-metaphor' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u5b64\u52c7\u8005', '\u5c81\u6708\u795e\u5077']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u5728\u8fd9\u79cd\u7f51\u66b4\u91cc\u8fd8\u613f\u610f\u53d1\u58f0\uff0c\u4ed6\u624d\u662f\u771f\u6b63\u7684\u5b64\u52c7\u8005']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u4ed6\u628a\u522b\u4eba\u7684\u673a\u4f1a\u90fd\u62a2\u8d70\u4e86\uff0c\u8fd9\u624d\u662f\u771f\u6b63\u7684\u5c81\u6708\u795e\u5077']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal game-mode and self-emotion evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u9e21\u8d3c', family: 'attack', meaning: '\u5f62\u5bb9\u4eba\u72e1\u733e\u3001\u800d\u5c0f\u806a\u660e\uff0c\u542b\u8d2c\u4e49', evidenceCount: 0 },
        { term: '\u6781\u9650\u6a21\u5f0f', family: 'cooperation', meaning: '\u6e90\u81ea\u6e38\u620f\u6bd4\u55bb\uff0c\u6307\u6700\u56f0\u96be\u7684\u72b6\u6001', evidenceCount: 0 },
        { term: '\u6025\u6b7b\u4e86', family: 'attack', meaning: '\u8bbd\u523a\u5bf9\u65b9\u60c5\u7eea\u6fc0\u52a8\u3001\u6025\u4e8e\u53cd\u9a73', evidenceCount: 0 },
        { term: '\u96c6\u7f8e', family: 'cooperation', meaning: '\u59d0\u59b9\u7684\u8c10\u97f3\u7f51\u7edc\u79f0\u547c\uff0c\u7528\u4e8e\u53cb\u597d\u79f0\u547c\u5973\u6027\u7f51\u53cb', evidenceCount: 0 },
      ],
    },
    [
      '\u4e00\u4ee3\u8981\u514b\u5236\u9e21\u8d3c\u53ea\u80fd\u9760\u5927\u55b7\u83c7\u548c\u5730\u523a\u4e86',
      '\u9e21\u8d3c\u4e00\u51fa\uff0c\u51b0\u897f\u74dc\u5c31\u8981\u5f00\u6446\u4e86',
      '\u4ed6\u8fd9\u4e2a\u5403\u76f8\u592a\u9e21\u8d3c\u4e86\uff0c\u5c31\u662f\u60f3\u5360\u4fbf\u5b9c',
      '\u5907\u4efd\u4e86\u90a3\u6781\u9650\u6a21\u5f0f\u6709\u4ec0\u4e48\u7528\uff1f',
      '\u5b58\u6863\u7684\u8bdd\uff0c\u90a3\u73a9\u6781\u9650\u6a21\u5f0f\u7684\u610f\u4e49\u662f\u4ec0\u4e48\uff1f',
      '\u8fd9\u4e2a\u9879\u76ee\u5de5\u671f\u88ab\u538b\u5230\u6781\u9650\u6a21\u5f0f\uff0c\u5927\u5bb6\u90fd\u5f88\u96be\u9876',
      '\u521a\u4e70\u7684\u6e38\u620f\uff0c\u809d\u4e86\u4e24\u4e2a\u661f\u671f\u4e86\uff0c\u771f\u7684\u6025\u6b7b\u4e86[\u5927\u54ed][\u5927\u54ed]',
      '\u5546\u4eba\u6025\u6b7b\u4e86\uff0c\u68a6\u5e7b\u5012\u4e0d\u5012\u8ddf\u4f60\u4e00\u4e2a\u533a\u7684\u5978\u5546\u6709\u5565\u5173\u7cfb',
      '\u524d\u51e0\u5929\u53bb\u5b89\u4e1c\u661f\u51fa\u5dee\uff0c\u95fa\u871c\u7ed9\u6211\u63a8\u8350\u4e86\u8fd9\u4e00\u6b3e\u6e38\u620f',
      '\u524d\u51e0\u5929\u53bb\u767d\u4fc4\u7f57\u65af\u51fa\u5dee\uff0c\u95fa\u871c\u7ed9\u6211\u63a8\u8350\u4e86\u8fd9\u4e00\u6b3e\u6e38\u620f',
      '\u5982\u679c\u96c6\u7f8e\u4eec\u771f\u7684\u548c\u5979\u8bf4\u7684\u4e00\u6837\uff0c\u4e0d\u73a9\u4e86\uff0c\u8fd9\u53cd\u800c\u4e0d\u662f\u4ef6\u597d\u4e8b\u5417\uff1f',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-literal-game-self/', uid: 'BV-literal-game-self' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u9e21\u8d3c', '\u6781\u9650\u6a21\u5f0f', '\u6025\u6b7b\u4e86', '\u96c6\u7f8e']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4ed6\u8fd9\u4e2a\u5403\u76f8\u592a\u9e21\u8d3c\u4e86\uff0c\u5c31\u662f\u60f3\u5360\u4fbf\u5b9c']);
  assert.equal(entries[1].evidenceCount, 1);
  assert.deepEqual(entries[1].evidenceSamples, ['\u8fd9\u4e2a\u9879\u76ee\u5de5\u671f\u88ab\u538b\u5230\u6781\u9650\u6a21\u5f0f\uff0c\u5927\u5bb6\u90fd\u5f88\u96be\u9876']);
  assert.equal(entries[2].evidenceCount, 1);
  assert.deepEqual(entries[2].evidenceSamples, ['\u5546\u4eba\u6025\u6b7b\u4e86\uff0c\u68a6\u5e7b\u5012\u4e0d\u5012\u8ddf\u4f60\u4e00\u4e2a\u533a\u7684\u5978\u5546\u6709\u5565\u5173\u7cfb']);
  assert.equal(entries[3].evidenceCount, 1);
  assert.deepEqual(entries[3].evidenceSamples, ['\u5982\u679c\u96c6\u7f8e\u4eec\u771f\u7684\u548c\u5979\u8bf4\u7684\u4e00\u6837\uff0c\u4e0d\u73a9\u4e86\uff0c\u8fd9\u53cd\u800c\u4e0d\u662f\u4ef6\u597d\u4e8b\u5417\uff1f']);
});

test('findDictionaryEntriesWithTextEvidence rejects violent coercion for cooperative clarification evidence', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u4ea4\u4ee3\u6e05\u695a', family: 'cooperation', meaning: '\u8981\u6c42\u5bf9\u65b9\u7ed9\u51fa\u660e\u786e\u89e3\u91ca\uff0c\u4f53\u73b0\u7406\u6027\u8bc9\u6c42', evidenceCount: 0 },
      ],
    },
    [
      '\u4ea4\u4ee3\u6e05\u695a\u4e86\u8111\u888b\u4e0d\u5f00\u82b1\u5417doge',
      '\u4e0d\u4ea4\u4ee3\u6e05\u695a\u5c31\u7b49\u7740\u8111\u888b\u5f00\u82b1',
      '\u8fd9\u4ef6\u4e8b\u5efa\u8bae\u5148\u628a\u65f6\u95f4\u7ebf\u4ea4\u4ee3\u6e05\u695a\uff0c\u5927\u5bb6\u518d\u8ba8\u8bba',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-clarify/', uid: 'BV-clarify' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u4ea4\u4ee3\u6e05\u695a']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u4ef6\u4e8b\u5efa\u8bae\u5148\u628a\u65f6\u95f4\u7ebf\u4ea4\u4ee3\u6e05\u695a\uff0c\u5927\u5bb6\u518d\u8ba8\u8bba']);
});

test('findDictionaryEntriesWithTextEvidence rejects passive publish context for request-to-post evidence terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [{ term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' }],
    },
    [
      '\u56e0\u4e3a\u9700\u8981\u5e7f\u544a\u5546\u5ba1\u6838\u624d\u80fd\u53d1\u51fa\u6765\u7684\u8bc4\u8bba\uff0c\u80fd\u6709\u597d\u8d27\u624d\u5947\u602a\u4e86',
      '\u4f60\u4e3a\u4ec0\u4e48\u53ef\u4ee5\u53d1\u8bed\u97f3',
      '\u4ed6\u5b8c\u5168\u53ef\u4ee5\u53d1\u4e2a\u5fae\u535a\u8bf4\u81ea\u5df1\u4e0d\u662f\u7b2c\u4e00adc',
      '\u8fd9\u4e2a\u563f\u563f\u563f\u7684\u52a8\u9759\u662f\u9e1f\u53d1\u51fa\u6765\u7684\uff1f',
      '\u4f60\u89c9\u5f97\u4e0d\u5bf9\uff0c\u53ef\u4ee5\u53d1\u5f39\u5e55\u53d1\u8bc4\u8bba\u8bf4A\u5176\u5b9e\u662f\u5927\u5199i',
      '\u53ef\u4ee5\u53d1\u660e\u5386\u53f2\u7ed9\u660e\u667a\u5149\u79c0\u52a0\u4e2a\u5207\u652f\u4e39\u5927\u540d\u7684\u6807\u7b7e',
      '\u4f60\u6562\u53d1\u51fa\u6765\u4ed6\u8c03\u4f83\u4e86\u5417',
    ].join('\n'),
    { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-post-evidence/', uid: 'BV-post-evidence' },
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u53ef\u4ee5\u8d34']);
  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u6562\u53d1\u51fa\u6765\u4ed6\u8c03\u4f83\u4e86\u5417']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested platform-action evidence for cooperation and correction terms', () => {
  const dictionary = {
    entries: [
      { term: '\u6211\u9519\u4e86', family: 'correction', meaning: 'self correction phrase' },
      { term: '\u5c4f\u853d', family: 'cooperation', meaning: 'moderate discussion by reducing noise' },
      { term: '\u4e09\u89d2\u8d38\u6613', family: 'cooperation', meaning: 'cooperative exchange metaphor' },
      { term: '\u4e09\u8fde\u9001\u4e0a', family: 'cooperation', meaning: 'supportive Bilibili engagement' },
      { term: '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50', family: 'correction', meaning: 'stop self-indulgent discussion' },
    ],
  };
  const text = [
    '\u201c\u5973\u6743\u201d\u548c\u5b83\u7684\u62e5\u8d38\u8005\uff0c\u5c31\u662f\u4e00\u7fa4\u4e0d\u6298\u4e0d\u6263\u7684\u755c\u7272\uff0c\u793e\u4f1a\u7684\u5783\u573e\u3001\u86c0\u866b\uff01\u5982\u679c\u6211\u9519\u4e86\u4f60\u6765\u6253\u6211\u3002',
    '\u8bbe\u7f6e\u8bc4\u8bba\u533a\u5c4f\u853d\u8bcd\uff1f',
    '\u5c4f\u853d\u5173\u952e\u5b57',
    '\u81ea\u52a8\u5316\u5c4f\u853d\u811a\u672c\u52a0\u8bc4\u8bba\u533a\u7cbe\u9009',
    '\u53ea\u8981\u5c4f\u853d\u90a3\u51e0\u4e2a\u9aa1\u5b50up\u5c31\u884c\u4e86',
    '\u8fd9\u4e2a\u53f7\u6839\u672c\u4e0d\u6562\u5f00\uff0c\u7f51\u9875\u7aef\u4e5f\u7528\u4e86\u5c4f\u853d\u5668',
    '\u6e29\u99a8\u63d0\u793a\u628a\u4eba\u7ed9\u5c4f\u853d\u4e86\u5c31\u884c\u4e86\uff0c\u4e00\u6574\u5c40\u90fd\u770b\u4e0d\u5230\u4ed6\u7684\u4fe1\u606f\uff0c\u5c4f\u853d\u6309\u952e\u5c31\u5728\u8fd9\u91cc',
    '\u8fd9\u4eba\u5f88\u70e6\uff0c\u5c4f\u853d\u4e86\u8fd8\u51fa\u6765',
    '\u4ec0\u4e48\u8d5b\u535a\u4e09\u89d2\u8d38\u6613',
    '\u4e09\u8fde\u9001\u4e0a~',
    '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realCorrection = findDictionaryEntriesWithTextEvidence(dictionary, '\u521a\u624d\u770b\u9519\u4e86\uff0c\u6211\u9519\u4e86\uff0c\u8fd9\u91cc\u786e\u5b9e\u5e94\u8be5\u6539\u7ed3\u8bba\u3002');

  assert.deepEqual(realCorrection.map((entry) => entry.term), ['\u6211\u9519\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested literal food and drama proper-name evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u624b\u6495', family: 'attack', meaning: 'tear someone apart rhetorically' },
      { term: '\u597d\u6b7b', family: 'attack', meaning: 'celebrate someone being punished or dying' },
      { term: '\u4e09\u963f\u54e5', family: 'attack', meaning: 'mocking label from palace drama discourse' },
      { term: '\u7687\u4e0a', family: 'attack', meaning: 'sarcastic authority label' },
      { term: '\u8001\u56db', family: 'attack', meaning: 'sarcastic label for a faction or person' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
    ],
  };
  const text = [
    '\u4f60\u8981\u5b66\u4f1a\u4e0d\u9700\u8981\u5207\u83dc\u7684\u83dc\uff0c\u6bd4\u5982\u624b\u6495\u5305\u83dc\uff0c\u6392\u9aa8\u4e4b\u7c7b\u7684[\u85cf\u72d0]',
    '\u5c31\u662f\u51b2\u7740\u88ab\u5e9f\u53bb\u7684\u5427\uff01\u597d\u6b7b\u4e0d\u5982\u8d56\u6d3b\u7740\uff01\u5c31\u662f\u6ca1\u90a3\u4e2a\u547d',
    '\u4fa7\u9762\u53cd\u5e94\u96cd\u6b63\u89c9\u5f97\u4e09\u963f\u54e5\u793c\u6559\u4e0d\u884c',
    '\u7687\u4e0a\uff0c\u4e09\u963f\u54e5\u53c8\u957f\u9ad8\u4e86\uff08doge\uff09',
    '\u8001\u56db\uff1a\u6211\u4ee5\u524d\u5e26\u7684\u662f\u4ec0\u4e48\u963f\u54e5\uff0c\u662f\u80e4\u7965\u554a\uff01\u4ed6\u5f18\u65f6\u600e\u4e48\u6bd4\uff1f',
    '\u8fd9\u4e48\u6002\u7684\u5c0f\u70ae\u597d\u610f\u601d\u53d1\u51fa\u6765\uff1f',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u4e2a\u4eba\u88ab\u5f53\u573a\u624b\u6495\uff0c\u4e4b\u524d\u7684\u8bdd\u672f\u5168\u7ffb\u8f66\u4e86',
      '\u4f60\u8bf4\u6709\u8bc1\u636e\uff0c\u90a3\u5c31\u53ef\u4ee5\u8d34\u51fa\u6765\u770b\u770b',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u624b\u6495', '\u53ef\u4ee5\u8d34']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested comeback, username, and standalone praise evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u5931\u8e2a\u4eba\u53e3', family: 'attack', meaning: 'mock someone as missing from discussion' },
      { term: '\u76f4\u8a00\u4e0d\u8bb3', family: 'attack', meaning: 'sarcastic label for a rude direct statement' },
      { term: '\u751c\u83dc', family: 'cooperation', meaning: 'friendly nickname or positive metaphor' },
    ],
  };
  const text = [
    '\u7ec8\u4e8e\u56de\u6765\u4e86\u5931\u8e2a\u4eba\u53e3',
    '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52',
    '\u76f4\u8a00\u4e0d\u8bb3',
    '\u300a\u76f4\u8a00\u4e0d\u8bb3\u300b',
    '\u76f4\u8a00\u4e0d\u8bb3\u7684\u79c0\u54e5',
    '\u6211\u662f\u8fb2\u6c11\uff0c\u9019\u5c31\u662f\u751c\u83dc',
    '\u56de\u590d @\u514d\u8d39\u751c\u83dc\u997c :\ud83d\ude0b',
    '\u751c\u83dc',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u6bcf\u6b21\u88ab\u8981\u6c42\u7ed9\u8bc1\u636e\u5c31\u88c5\u5931\u8e2a\u4eba\u53e3',
      '\u522b\u62ff\u76f4\u8a00\u4e0d\u8bb3\u5f53\u501f\u53e3\uff0c\u8fd9\u5c31\u662f\u4eba\u8eab\u653b\u51fb',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u5931\u8e2a\u4eba\u53e3', '\u76f4\u8a00\u4e0d\u8bb3']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested numeric count, literal belief, and standalone reaction evidence', () => {
  const dictionary = {
    entries: [
      { term: '0\u4eba', family: 'attack', meaning: 'mocking no-one count' },
      { term: '0\u63d0\u5347', family: 'cooperation', meaning: 'concede that something offers no improvement' },
      { term: '\u4fe1\u4ef0', family: 'attack', meaning: 'mocking ideological belief' },
      { term: '\u4fe1\u606f\u8327\u623f', family: 'attack', meaning: 'accuse another side of living in an information bubble' },
      { term: '\u88c5\u5230', family: 'attack', meaning: 'accuse someone of posturing' },
      { term: '\u516d\u516d\u516d', family: 'attack', meaning: 'sarcastic praise' },
      { term: '\u6ca1\u60f3\u5230\u5427', family: 'attack', meaning: 'sarcastic reveal' },
      { term: '\u6ca1\u4eba\u5728\u4e4e', family: 'cooperation', meaning: 'deescalating by noting low stakes' },
      { term: '\u57c3\u53ca\u5427', family: 'evasion', meaning: 'avoid answering by sending someone elsewhere' },
    ],
  };
  const text = [
    '\u73b0\u5728\u51cc\u6668\u4e09\u70b9\uff0c1000+\u4eba',
    '2000\u4eba',
    '\u7b49\u7ea7\u8d85\u9650\u7b49\u4e8e0\u63d0\u5347\uff0c80\u7ea7\u7a81\u7834\u540e\u62c9\u9ad8\u7b49\u7ea7\u4ec5\u4ec5\u53ea\u662f\u63d0\u9ad8\u751f\u5b58',
    '\u66f4\u6b63\u4e00\u4e0b\uff0c\u7259\u818f\u53825\u5e74\u662f\u5b8c\u5168\u76840\u63d0\u5347',
    '\u5176\u5b9e\u5f88\u65e9\u524d\u5c31\u6709\u6697\u793a\u4e86\uff0c\u59ae\u9732\u4fe1\u4ef0\u82b1\u795e\uff0c\u6563\u5175\u4e13\u6b66\u5c31\u6765\u6e90\u745c\u82b1\u795e',
    '\u8981\u5b66\u4f1a\u5f00\u4e2a\u5c0f\u53f7\u4e3a\u81ea\u5df1\u5236\u9020\u4fe1\u606f\u8327\u623f\uff0c\u4f1a\u6e05\u51c0\u5f88\u591a',
    '\u7537\u5973\u770b\u5230\u7684\u8bc4\u8bba\u533a\u7adf\u7136\u4e0d\u4e00\u6837\uff0c\u4fe1\u606f\u8327\u623f\u6b63\u5728\u64cd\u7eb5\u7740\u6211\u4eec',
    '\u56fd\u670d\uff08\u817e\u8baf\uff09\u662f\u8fd9\u6837\u7684\u5566\u3002\u770b\u770b\u5251\u7075\u3002\u6c38\u4e45\u7684\u526f\u672c\u65f6\u88c5\u5230\u56fd\u670d\u53d8\u621030\u5929\u3002',
    '\u516d\u516d\u516d',
    '\u6211\u4ee5\u4e3a\u662f\u60ac\u7591\u7247\u2026\u2026\u6ca1\u60f3\u5230\u4e0d\u662f\u554a\u2026\u2026',
    '\u4eba\u5bb6\u6ca1\u60f3\u5230',
    '\u6ca1\u60f3\u5230\u554a\uff0c\u5979\u5c45\u7136\u8fd9\u6837',
    '\u524d\u51e0\u5e74\u5979\u8bf4\u81ea\u5df1\u662f\u7537\u4eba\u7684\u65f6\u5019\uff0c\u6211\u5c31\u8ba8\u538c\u5979\u4e86\uff0c\u7ed3\u679c\u6ca1\u60f3\u5230\u5979\u8fd8\u7ee7\u7eed\u706b',
    '\u53e3\u7891\u4e00\u76f4\u633a\u5dee\u7684\uff0c\u6ca1\u60f3\u5230\u5979\u53c8\u5f00\u59cb\u4e86',
    '\u6ca1\u60f3\u5230\u5427[doge]',
    '\u62d6\u6574\u4f53\u5973\u6027\u4e0b\u6c34\uff0c\u4ee5\u4e3a\u4f1a\u6709\u66f4\u591a\u4eba\u51fa\u6765\u633a\u5979\uff0c\u6ca1\u60f3\u5230\u5927\u5bb6\u90fd\u4e0d\u7cca\u6d82\uff0c\u4e0d\u5403\u8fd9\u4e00\u5957',
    '\u867d\u7136\u5f88\u66b4\u529b\u4f46\u8fd8\u771f\u6ca1\u95ee\u9898\uff0c\u53ef\u80fd\u6ca1\u60f3\u5230\u80fd3\uff1a0\u8fd9\u4e48\u8f7b\u677e\u5427',
    '\u524d\u9762\u7684\uff0c\u6ca1\u4eba\u5728\u4e4e\u4f60',
    '\u722c\u5427\u6ca1\u4eba\u5728\u4e4e\u7684',
    '\u57c3\u53ca\u5427\u56de\u4e0d\u56de\u5f52\uff0c\u6709\u9aa8\u6c14\u5c31\u522b\u56de\u5f52',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u771f\u6ca1\u60f3\u5230\u5427\uff0c\u4f60\u524d\u9762\u8bf4\u7684\u8bc1\u636e\u5168\u90fd\u88ab\u53cd\u9a73\u4e86',
      '\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898',
      '\u4f60\u8fd9\u5c31\u662f\u4fe1\u606f\u8327\u623f\uff0c\u53ea\u770b\u81ea\u5df1\u60f3\u770b\u7684\u8bc1\u636e',
      '\u4e0d\u8981\u518d\u88c5\u5230\u81ea\u5df1\u5f88\u61c2\u4e86',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u4fe1\u4ef0', '\u4fe1\u606f\u8327\u623f', '\u88c5\u5230', '\u6ca1\u60f3\u5230\u5427']);
});

test('normalizeKeywordEntries drops passive publish source evidence for request-to-post terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask another user to post evidence or context',
      evidenceCount: 3,
      evidenceSamples: [
        '\u4e00\u53d1\u51fa\u6765\u518d\u70b9\u51fb\u5c31\u8be5\u8bc4\u8bba\u5df2\u5220\u9664',
        '\u53d1\u6b63\u7ecf\u86c7\u7c7b\u79d1\u666e\u9650\u6d41\u9650\u7684\u6b7b\u6b7b\u7684',
        '\u4e0d\u8981\u603b\u628a\u4e2d\u56fd\u7684\u4e1c\u897f\u76f4\u63a5\u8d34\u51fa\u6765\u5ba3\u4f20',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', uid: 'BV-passive-post-1', sample: '\u4e00\u53d1\u51fa\u6765\u518d\u70b9\u51fb\u5c31\u8be5\u8bc4\u8bba\u5df2\u5220\u9664' },
        { source: 'Bilibili public video comment scan', uid: 'BV-passive-post-2', sample: '\u53d1\u6b63\u7ecf\u86c7\u7c7b\u79d1\u666e\u9650\u6d41\u9650\u7684\u6b7b\u6b7b\u7684' },
        { source: 'Bilibili public video comment scan', uid: 'BV-passive-post-3', sample: '\u4e0d\u8981\u603b\u628a\u4e2d\u56fd\u7684\u4e1c\u897f\u76f4\u63a5\u8d34\u51fa\u6765\u5ba3\u4f20' },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => ({ term: entry.term, evidenceCount: entry.evidenceCount, evidenceSamples: entry.evidenceSamples, evidenceSources: entry.evidenceSources })), [
    { term: '\u53ef\u4ee5\u8d34', evidenceCount: 0, evidenceSamples: [], evidenceSources: [] },
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested title and reaction-only evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u5154\u5154\u5c9b', family: 'cooperation', meaning: 'friendly community topic label' },
      { term: '\u56e2\u706d\u590d\u4ec7\u8005\u8054\u76df', family: 'cooperation', meaning: 'shared pop-culture reference' },
      { term: 'xswl', family: 'attack', meaning: 'mocking laughter shorthand' },
      { term: '\u6cea\u76ee', family: 'cooperation', meaning: 'empathetic agreement' },
    ],
  };
  const text = [
    '\u6211\u8fd8\u5728\u60f3\u5154\u5154\u5c9b\u662f\u54ea\u4e2a\u65b0up\u4e3b\uff0c\u8fd9\u4e2a\u5c01\u9762\u660e\u660e\u5c31\u5f88\u4e00\u6668\u554a',
    '\u4ed6\u56e2\u706d\u590d\u4ec7\u8005\u8054\u76df\u7684\u4e3b\u8981\u539f\u56e0\u8fd8\u662f\u590d\u4ec7\u8005\u4eec\u660e\u660e\u77e5\u9053\u81ea\u5df1\u8fd9\u8fb9\u7684\u60c5\u51b5\u8fd8\u8d2a\u4e8e\u4eab\u4e50',
    'xswl\u5b9d\u77f3\u6d88\u5931\u90a3\u7f8e\u961f\u4e3a\u4ec0\u4e48\u8981\u53bb\u8fd8\uff1f\uff01',
    '\u8fd9\u662f\u6881\u9f99\u628a\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\uff0c\u4e0d\u662f\u8bf4\u97f3\u4e50\u8282\u7528\u5417\uff0c\u600e\u4e48\u653e\u8fd9\u513f\u4e86xswl\u54c8\u54c8\u54c8\u54c8\u54c8',
    '\u6cea\u76ee\uff0c\u8fd9\u6bb5\u4e3a\u4ec0\u4e48\u4e0d\u653e\u8fdb\u6b63\u7247',
    '\u6cea\u76ee',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u5957\u903b\u8f91xswl\uff0c\u8bc1\u636e\u90fd\u88ab\u53cd\u9a73\u4e86\u8fd8\u786c\u62ac',
      '\u4f60\u613f\u610f\u8865\u5145\u6570\u636e\u518d\u6539\u7ed3\u8bba\uff0c\u771f\u6cea\u76ee',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['xswl', '\u6cea\u76ee']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested fandom, title, and literal belief evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u523b\u8fdbdna', family: 'attack', meaning: 'claim a bad habit is ingrained' },
      { term: '\u523b\u8fdbdna\u7684', family: 'attack', meaning: 'ingrained negative trait variant' },
      { term: '\u5168\u662f\u4e2d\u56fd', family: 'attack', meaning: 'mock overbroad national claim' },
      { term: '\u4fe1\u4ef0', family: 'attack', meaning: 'mock ideological shield' },
      { term: '\u90fd\u662f\u5bb6\u4eba', family: 'cooperation', meaning: 'community solidarity address' },
      { term: '\u5c01\u795e', family: 'cooperation', meaning: 'strong praise for a useful contribution' },
      { term: '\u795e\u4ed6\u5988', family: 'attack', meaning: 'mocking absurd expression' },
      { term: '\u4e2d\u7cfb', family: 'cooperation', meaning: 'cooperative classification term' },
      { term: '\u8c01\u61c2', family: 'evasion', meaning: 'appeal to insiders instead of explaining' },
    ],
  };
  const text = [
    '\u771f\u2022\u523b\u8fdbDNA\u7684\u6280\u80fd',
    '\u5012\u4e5f\u4e0d\u5168\u662f\uff0c\u4e2d\u56fd\u4e5f\u6709\u7389\u7687\u5927\u5e1d\u8fd9\u4e00\u8109\u7684\u795e\u8bdd',
    '\u6211\u4eec\u7684\u4fe1\u4ef0\uff0c\u5c31\u662f\u6211\u4eec\u81ea\u5df1\uff01',
    '\u5bb6\u4eba\u4eec\uff0c\u5168\u7403\u901a\u53f2\uff0c\u6211\u6c42\u6c42\u4f60\u4eec\u63a8\u8350\u8bfb\u6df1\u4e00\u70b9',
    '\u770b\u5230\u300a\u5c01\u795e\u6f14\u4e49\u300b\u4e86',
    '\u56de\u590d @\u54b8\u9c7cnini616 :\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u795e\u4ed6\u5988\u548c\u5f20\u7ff0\u642d\u5c31\u6709\u516b\u5206\u50cf',
    '\u611f\u89c9\u6cf0\u5bb9\u662f\u5728\u4e2d\u7cfb\uff0c\u5728\u73b9\u662fkangta\u7cfb\uff0c\u4e5f\u662f\u53f8\u9a6c\u7537\u4e24\u5927\u5206\u7c7b',
    '\u6709\u8c01\u61c2\uff01\u8fd9\u4e2a\u8dd1\u6b65\u771f\u7684\u5f88\u90d1\u723d',
    '\u8c01\u61c2\u554a\uff0c\u5f39\u5e55\u6863\u7684\u82e5\u9690\u82e5\u73b0\uff0c\u66f4\u50cf\u4e86',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u5c31\u662f\u628a\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u4e0d\u56de\u5e94\u8bc1\u636e',
      '\u8fd9\u6761\u8865\u5145\u628a\u65f6\u95f4\u7ebf\u8bf4\u6e05\u695a\u4e86\uff0c\u5c01\u795e',
      '\u522b\u53ea\u8bf4\u8c01\u61c2\uff0c\u5148\u628a\u8bc1\u636e\u8d34\u51fa\u6765',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u4fe1\u4ef0', '\u5c01\u795e', '\u8c01\u61c2']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested quote, literal game, and homophone evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u6211\u547d\u7531\u6211', family: 'attack', meaning: 'mock arrogant self-determination slogan' },
      { term: '\u6211\u547d\u7531\u6211\u4e0d\u7531\u5929', family: 'attack', meaning: 'mock arrogant self-determination slogan' },
      { term: '\u751f\u8349', family: 'attack', meaning: 'mock absurd behavior' },
      { term: '\u592a\u751f\u8349\u4e86', family: 'attack', meaning: 'mock absurd behavior' },
      { term: '\u65e0\u63a9\u4f53\u5e72\u62c9', family: 'attack', meaning: 'mock reckless action' },
      { term: '\u96c6\u7f8e', family: 'cooperation', meaning: 'friendly address for female users' },
    ],
  };
  const text = [
    '\u6211\u547d\u7531\u6211\u4e0d\u7531\u5929\uff01\uff01\uff01\uff01[doge]',
    '\u592a\u751f\u8349\u4e86',
    '\u6211\u73a9\u6e38\u620f\u8fd9\u4e48\u591a\u5e74\uff0c\u7ec8\u4e8e\u660e\u767d\u65e0\u63a9\u4f53\u5e72\u62c9\u662f\u4ec0\u4e48\u64cd\u4f5c\u4e86[doge]',
    '\u65e0\u63a9\u4f53\u5e72\u62c9',
    '\u4e0d\u6bd4\u54c8\u96c6\u7f8e\u62c9\u5730\u4e0a\u6709\u7d20\u8d28\uff1f',
    '\u795e\u4eba\u54c8\u96c6\u7f8e',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u79cd\u9634\u8c0b\u8bba\u5c31\u662f\u6211\u547d\u7531\u6211\u4e0d\u7531\u5929\u5f0f\u786c\u72b6',
      '\u4f60\u8fd9\u4e2a\u903b\u8f91\u592a\u751f\u8349\u4e86\uff0c\u5b8c\u5168\u4e0d\u770b\u8bc1\u636e',
      '\u800c\u4f60\u53ea\u77e5\u9053\u65e0\u63a9\u4f53\u5e72\u62c9\uff0c\u6839\u672c\u4e0d\u770b\u5bf9\u9762\u8bf4\u4e86\u4ec0\u4e48',
      '\u96c6\u7f8e\u4eec\u522b\u5435\u4e86\uff0c\u5148\u628a\u539f\u56e0\u8bf4\u6e05\u695a',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u6211\u547d\u7531\u6211',
    '\u6211\u547d\u7531\u6211\u4e0d\u7531\u5929',
    '\u751f\u8349',
    '\u592a\u751f\u8349\u4e86',
    '\u65e0\u63a9\u4f53\u5e72\u62c9',
    '\u96c6\u7f8e',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested suffix, address, and embedded-learning evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u4e0d\u674e\u59d0', family: 'attack', meaning: 'homophone for not understanding used as mockery' },
      { term: '\u6211\u4e0d\u674e\u59d0', family: 'attack', meaning: 'homophone for not understanding used as mockery' },
      { term: '\u5355\u8d706', family: 'attack', meaning: 'send a single 6 as sarcastic response' },
      { term: '\u5355\u8d70\u4e00\u4e2a6', family: 'cooperation', meaning: 'send a 6 as playful approval' },
      { term: '\u8d70\u4e00\u4e2a6', family: 'attack', meaning: 'sarcastic six meme' },
      { term: '\u90fd\u662f\u5bb6\u4eba', family: 'cooperation', meaning: 'solidarity or friendly in-group address' },
      { term: '\u9633\u5bff', family: 'cooperation', meaning: 'luck-cost meme' },
      { term: '\u81ea\u5df1\u5b66', family: 'evasion', meaning: 'pushes learning burden onto the other person' },
    ],
  };
  const text = [
    '\u4e3e\u8bc1\u56f0\u96be\uff1f\u6211\u4e0d\u7406\u89e3',
    '\u5355\u8d70\u4e00\u4e2a6a',
    '\u554a\uff0c\u8fd9\u5bb6\u4eba\u4eec\u5c5e\u5b9e\u662f\u4e00\u628a\u5b50\u65e0\u8bed\u4f4f\u4e86\u3002',
    '\u76f4\u64ad\u95f4\u4e00\u53e3\u4e00\u4e2a\u5bb6\u4eba\u4eec\u5e26\u504f\uff0c\u4f60\u771f\u7684\u9700\u8981\u8fd9\u4e9b\u5417',
    '\u6b63\u5e38\u5f00\u4e0d\u662f24\u5c0f\u65f6\u4e0d\u95f4\u65ad\u7535\u8bdd\u77ed\u4fe1\u9a9a\u6270\u5417\uff0c\u800c\u4e14\u8fd8\u4e0d\u662f\u4f60\u4e00\u4e2a\u4eba\uff0c\u662f\u4f60\u4e00\u5bb6\u4eba[doge]',
    '\u4e0d\u662f\u6211\u5c31\u5bfb\u601d\u7740\u5973\u751f\u6253\u6e38\u620f\u4e0d\u662f\u5f88\u6b63\u5e38\u4e48\uff0c\u548b\u7684\u5973\u751f\u6253\u6e38\u620f\u6d6a\u8d39\u4f60\u9633\u5bff\u4e86\u5457',
    '\u4f1a\u7ed9\u5973\u751f\u5fc3\u7406\u6697\u793a\u7684\uff0c\u89c9\u5f97\u81ea\u5df1\u5b66\u4e0d\u597d\u3002',
    '\u75db\u82e6\u5230\u4f60\u81ea\u5df1\u65e0\u6cd5\u627f\u53d7\uff0c\u81ea\u5df1\u5b66\u4f1a\u653e\u5f03',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u6211\u4e0d\u7406\u89e3\uff0c\u8fd9\u4e5f\u80fd\u6d17\uff1f',
      '\u8fd9\u6ce2\u8865\u5145\u5355\u8d70\u4e00\u4e2a6',
      '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba',
      '\u4f60\u9700\u8981\u4ebf\u70b9\u70b9\u9633\u5bff[doge]',
      '\u522b\u95ee\u6211\u4e86\uff0c\u4f60\u81ea\u5df1\u5b66\u81ea\u5df1\u641c',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u4e0d\u674e\u59d0',
    '\u6211\u4e0d\u674e\u59d0',
    '\u5355\u8d706',
    '\u5355\u8d70\u4e00\u4e2a6',
    '\u8d70\u4e00\u4e2a6',
    '\u90fd\u662f\u5bb6\u4eba',
    '\u9633\u5bff',
    '\u81ea\u5df1\u5b66',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested username-only ASCII evidence', () => {
  const dictionary = {
    entries: [
      { term: 'lsp', family: 'attack', meaning: 'sexualized insult shorthand' },
      { term: '\u7a7a\u964d', family: 'cooperation', meaning: 'timestamp navigation helper' },
    ],
  };

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, '\u56de\u590d @LSP\u7684N\u6b21\u65b9 :\u55f7\u55f7\uff0c\u597d\u7684');

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    ['\u4f60\u8fd9\u4e2alsp\u522b\u518d\u5237\u4e86', '\u7a7a\u964d2:15'].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['lsp', '\u7a7a\u964d']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested name, defense, title, and self-reaction evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u963f\u7f8e\u8389\u5361', family: 'attack', meaning: 'sarcastic nickname for America' },
      { term: '\u8c01\u5bb6\u5c0f\u5b69', family: 'attack', meaning: 'mock someone as childish' },
      { term: '\u7ec6\u8282\u53e5\u53f7', family: 'attack', meaning: 'mock nitpicking punctuation details' },
      { term: '\u6211\u6d3b\u5230\u5934\u4e86', family: 'cooperation', meaning: 'self-deprecating concession or despair' },
    ],
  };
  const text = [
    '\u54c8\u54c8\u50cf\u963f\u7f8e\u5a5a\u540e\u751f\u6d3b',
    '\u8bf4\u5b69\u5b50\u8eab\u4e0a\u592a\u8fc7\u5206\u4e86\u5427\uff0c\u8c01\u5bb6\u5c0f\u5b69\u4e0d\u662f\u5b9d\uff1f\uff08',
    '\u7b2c\u56db\u5173\uff1a\u7ec6\u8282\u53e5\u53f7',
    '\u6211\u6d3b\u5230\u5934\u4e86',
    '\uff1f\u6211\u6d3b\u5230\u5934\u4e86\uff1f',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u963f\u7f8e\u8389\u5361\u554a\uff0c\u4f60\u8fd8\u662f\u592a\u5e74\u8f7b',
      '\u8fd9\u8c01\u5bb6\u5c0f\u5b69\uff0c\u53c9\u51fa\u53bb',
      '\u56de\u590d @\u674e\u58a8\u5927\u5e08 :\u7ec6\u8282\u53e5\u53f7\uff0c\u7ec6\u8282\u5934\u50cf\u86cb\u4ed4',
      '\u4f60\u8bf4\u5f97\u5bf9\uff0c\u6211\u6d3b\u5230\u5934\u4e86\uff0c\u8fd9\u70b9\u6211\u6536\u56de',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u963f\u7f8e\u8389\u5361',
    '\u8c01\u5bb6\u5c0f\u5b69',
    '\u7ec6\u8282\u53e5\u53f7',
    '\u6211\u6d3b\u5230\u5934\u4e86',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested self-label, literal technical, and non-correction evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u5c0f\u7c89\u7ea2', family: 'attack', meaning: 'hostile label for blind patriotic users' },
      { term: 'pink', family: 'attack', meaning: 'alias for hostile pink label' },
      { term: '\u6211\u771f\u7ef7\u4e0d\u4f4f', family: 'attack', meaning: 'mocking cannot hold laughter' },
      { term: '\u8349\u751f', family: 'cooperation', meaning: 'playful laughter or acknowledgement' },
      { term: '\u5c4f\u853d', family: 'cooperation', meaning: 'constructive block/mute suggestion' },
      { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self-correction or softening prior claim' },
    ],
  };
  const text = [
    '\u6211\u7167\u6837\u9a82\u7f57\u5723\uff0c\u4e0d\u80fd\u8bf4\u6211\u662f\u7c89\u7ea2\u4e86\u55f7[\u559c\u6b22]',
    '\u4e3a\u4ec0\u4e48\u662f\u7c89\u7ea2\u8272\u7684\uff1f\u90a3\u81ea\u7136\u662f\u56e0\u4e3a\u8003\u8651\u5230\u4f60\u662f\u5973\u751f\u6240\u4ee5\u662f\u8349\u8393\u725b\u5976\u53e3\u5473\u7684',
    '\u6211\u4e2a\u4eba\u611f\u89c9\u8fd9\u4e2a\u8868\u60c5\u5305\u4e0d\u7b97\u5632\u8bbd\uff0c\u6211\u4f1a\u53d1[\u7c89\u7ea2\u5154\u5b50\u604b\u4e0e\u7bc7_\u6551\u547d]',
    '\u56de\u590d @pinkieMew :\u868c\u57e0\u4f5c\u4e3a\u7b2c\u4e00\u5b9c\u5c45\u57ce\u5e02\u5438\u5f15\u6c34\u6bcd\u5165\u4f4f\u6709\u5565\u597d\u5947\u602a\u7684[\u7591\u60d1]',
    '\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\uff0c\u6211\u771f\u7ef7\u4e0d\u4f4f\u4e86',
    '\u4e0a\u6e2f\u8fdb\u7403\u8fdb\u7403\u5c31\u4e0d\u770bVAR\uff0c\u6cf0\u5c71\u8fdb\u7403\u5fc5\u987b\u5f97\u770b\u4e00\u773c\uff0c\u771f\u8349\u4e86',
    '\u5173\u952e\u662f\u6ca1\u6709\u8df3\u8dc3\u952e\uff0c\u6211\u8349\u4e86\uff0c\u4f60\u6709\u4e2a\u8df3\u8dc3\u952e\u591a\u597d\u554a',
    '\u4e0d\u957f\u8111\u5b50\u53ef\u592a\u8349\u4e86',
    '\u53cd\u5c04\u9762\u592a\u5c0f\u4e86\uff0c\u96f7\u8fbe\u4f1a\u628a\u8fd9\u4e2a\u5f53\u6210\u6742\u6ce2\u5c4f\u853d',
    '\u4e0d\u8bf4\u522b\u7684\uff0c\u5c31ai\u914d\u97f3\uff0c\u8bf4\u9519\u4e86\u6362\u4e2a\u53f7\u4f60\u77e5\u9053\u4ed6\u662f\u8c01\u554a',
    '\u56de\u590d @NDTuning :\u8bf4\u9519\u4e86\u662f\u5766\u514b',
    '\u5982\u679c\u8bf4\u9519\u4e86\uff0c\u90a3\u5f88\u62b1\u6b49\u6253\u6270\u4e86',
    '\u4e2d\u95f4\u6709\u4e00\u90e8\u5206\u8bf4\u9519\u4e86 \u4e0d\u662f\u5730\u7403\u8981\u628a\u592a\u5e73\u6d0b\u63a8\u5012',
    '\u8bc4\u4ef72077\u7684\u65f6\u5019\u6709\u4e00\u53e5\u8bdd\u8bf4\u9519\u4e86\uff0c\u4e0d\u662f\u6ca1\u6709\u6279\u8bc4\u4e86\uff0c\u662f\u6ca1\u4eba\u5173\u6ce8\u4e86',
    '\u5979\u7a81\u7136\u6765\u8fd9\u4e48\u4e00\u53e5\uff0c\u6211\u8fd8\u4ee5\u4e3a\u6211\u8bf4\u9519\u8bdd\u4e86',
    '\u6d3b\u6b7b\u4eba\u7684\u4e0a\u9650\u90a3\u786e\u5b9e\u8bf4\u9519\u4e86\uff0c\u6d3b\u6b7b\u4eba\u4e0a\u9650\u5728\u65e9\u671f\u6cd5\u8001\u90a3',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u5c0f\u7c89\u7ea2\u90fd\u5f00\u59cb\u590d\u8bfb\u8fd9\u5957\u8bdd\u672f\u4e86',
      'pink\u90fd\u662f\u5728\u6821\u5b66\u751f\u8fd9\u8bdd\u7ffb\u6765\u8986\u53bb',
      '\u4f60\u8fd9\u4e2a\u903b\u8f91\u6211\u771f\u7ef7\u4e0d\u4f4f\uff0c\u8bc1\u636e\u5462',
      '\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86',
      '\u5148\u5c4f\u853d\u4eba\u8eab\u653b\u51fb\u518d\u597d\u597d\u8ba8\u8bba',
      '\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u6536\u56de\u521a\u624d\u90a3\u53e5',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u5c0f\u7c89\u7ea2',
    'pink',
    '\u6211\u771f\u7ef7\u4e0d\u4f4f',
    '\u8349\u751f',
    '\u5c4f\u853d',
    '\u524d\u9762\u8bf4\u91cd\u4e86',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested numeric, name-only, and generic publish evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u516d\u516d\u516d', family: 'attack', meaning: 'sarcastic 666 toward bad logic or behavior' },
      { term: '\u767e\u53d8\u9a6c\u4e01', family: 'cooperation', meaning: 'playful Bilibili meme reference' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
    ],
  };
  const text = [
    '\u516d\u516d\u516d\uff0c\u82f1\u8bed\u8001\u5e08\u8ba9\u5b66\u8fc7',
    '\u516b\u5c0f\u65f6\u516d\u516d\u516d',
    '\u9a6c\u4e01\u6211\u559c\u6b22\u4f60',
    '\u4e3b\u4efb\u662f\u4e0d\u662f\u5bf9\u9a6c\u4e01\u7684\u8eab\u9ad8\u6709\u4ec0\u4e48\u8bef\u89e3',
    '\u9a6c\u4e01\u5bb6\u306e\u9f99\u5973\u4ec6',
    '\u660e\u660e\u53ef\u4ee5\u53d1\u7bc7\u6b63\u5f53\u7684\u6587\u7ae0 \u975e\u7684\u6765\u4e94\u8fde\u95ee \u4f60\u662f\u771f\u7684\u60f3\u7ef4\u62a4\u6b63\u4e49 \u8fd8\u662f\u66fe\u70ed\u5ea6\u5462\uff1f',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u516d\u516d\u516d\uff0c\u4f60\u8fd9\u64cd\u4f5c\u771f\u79bb\u8c31',
      '\u8fd9\u671f\u767e\u53d8\u9a6c\u4e01\u7684\u68d7\u592a\u5999\u4e86',
      '\u4f60\u628a\u8bc1\u636e\u94fe\u63a5\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u516d\u516d\u516d',
    '\u767e\u53d8\u9a6c\u4e01',
    '\u53ef\u4ee5\u8d34',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested overbroad alias and platform evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427', family: 'attack', meaning: 'mocking weak evidence' },
      { term: '\u4e0d\u5c2c', family: 'cooperation', meaning: 'not awkward agreement' },
      { term: '\u5e72\u8d27up', family: 'cooperation', meaning: 'creator with useful substance' },
      { term: '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb', family: 'cooperation', meaning: 'boost this comment upward' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
      { term: '\u5c4f\u853d', family: 'cooperation', meaning: 'constructive block/mute suggestion' },
      { term: '\u6700\u540e\u4e00\u821e', family: 'evasion', meaning: 'last gamble evasion phrase' },
    ],
  };
  const text = [
    '\u8bf4\u5b9e\u8bdd\u5f39\u5e55\u4e00\u76f4\u8bf4\u4e0d\u591f\u51c6\u8fd9\u70b9\u6709\u70b9 \u5927\u4f17\u5360\u535c\u4e0d\u4f1a\u771f\u6709\u4eba\u8981\u4ec0\u4e48\u90fd\u5f80\u4e0a\u9760\u5427 \u60f3\u51c6\u53bb\u79c1\u5360\u5427',
    '\u4e00\u70b9\u90fd\u4e0d\u5c2c\u9ed1 \u8bf4\u771f\u7684\u6709\u70b9\u5931\u671b',
    '\u8fd9\u4e2a\u4e50\u8bc4\u6ca1\u5565\u5e72\u8d27',
    '\u90a3\u7b97\u5e72\u8d27\uff1f',
    '\u5e72\u8d27\u6162\u6162',
    '\u4ed6\u5c31\u662f\u5e74\u8f7b\u65f6\u6ca1\u53bb\u5b66\u7cfb\u7edf\u53d1\u58f0\uff0c\u7eaf\u9760\u673a\u80fd\u9876\u4e0a\u53bb\uff0c\u5531\u592a\u591a\uff0c\u5012\u55d3\u4e86',
    '\u4e0d\u662f\u7684\uff0c\u662f\u6b4c\u8ff7\u8ba9\u4ed6\u5148\u628a\u505a\u597d\u7684\u6b4c\u53d1\u51fa\u6765\uff0c\u4e0d\u8981\u7b49\u5230\u4e13\u8f91\u3002\u600e\u4e48\u53c8\u6210\u4e86\u65e7\u6b4c\u5462',
    '\u56de\u590d @Nof1sh :\u6ca1\u4e86 \u4e4b\u524d\u7684\u8bed\u97f3\u8bc4\u8bba\u90fd\u88ab\u5c4f\u853d\u6389\u4e86\u597d\u50cf \u4f46\u662f\u8fd8\u53ef\u4ee5\u53d1\u89c6\u9891',
    '\u9ad8\u97f3\u7684\u6700\u540e\u4e00\u821e',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427\uff0c\u8bc1\u636e\u5728\u54ea',
      '\u8fd9\u6bb5\u56de\u5e94\u4e0d\u5c2c\uff0c\u8bb2\u5f97\u5f88\u6e05\u695a',
      '\u5e72\u8d27up\uff0c\u8d44\u6599\u548c\u94fe\u63a5\u90fd\u8d34\u5168\u4e86',
      '\u8fd9\u6761\u8bc1\u636e\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb',
      '\u4f60\u628a\u8bc1\u636e\u94fe\u63a5\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      '\u5148\u5c4f\u853d\u4eba\u8eab\u653b\u51fb\u518d\u597d\u597d\u8ba8\u8bba',
      '\u522b\u6212\uff0c\u8bf4\u4e0d\u5b9a\u6700\u540e\u4e00\u821e\u5c31\u7ffb\u8eab\u4e86',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
    '\u4e0d\u5c2c',
    '\u5e72\u8d27up',
    '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb',
    '\u53ef\u4ee5\u8d34',
    '\u5c4f\u853d',
    '\u6700\u540e\u4e00\u821e',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested literal coin, expression, and image-reference evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u7ef7\u4e0d\u4f4f\u4e86', family: 'attack', meaning: 'mocking laughter at another person' },
      { term: '\u5fae\u8868\u60c5', family: 'attack', meaning: 'accuse someone through micro-expression reading' },
      { term: '\u5ddd\u5efa\u56fd', family: 'attack', meaning: 'political nickname used as attack' },
      { term: '\u5ddd\u666e', family: 'attack', meaning: 'Trump-related political attack shorthand' },
      { term: '\u94f8\u5e01', family: 'attack', meaning: 'homophone insult for stupid behavior' },
      { term: '\u5730\u72f1\u7b11\u8bdd', family: 'attack', meaning: 'hostile dark-humor attack' },
      { term: '\u53d1\u56fe', family: 'evidence', meaning: 'ask user to post image evidence' },
    ],
  };
  const text = [
    '\u8fd9\u8868\u60c5\u6ca1\u7ef7\u4f4f\uff0c\u597d\u61a8\u554a',
    '\u8fbe\u59ae\u5a05\u7684\u5267\u60c5\u4e5f\u5c31\u5e93\u6d1b\u80fd\u5199\u4e86\uff0c\u56e0\u4e3a\u5267\u60c5\u63d0\u73b0\u5168\u5728\u8fd9\u4e9b\u5fae\u8868\u60c5\u91cc\u4e86',
    '\u8fd9\u79bb\u7279\u6717\u666e\u5934\u50cf\u5370\u4e0a\u7f8e\u56fd\u56fd\u65d7\u4e0d\u8fdc\u4e86[doge]',
    '\u5218\u5df4:\u6211\u76f4\u63a5\u94f8\u5e01',
    '\u94f8\u5e01\u5e73\u5e02\uff0c\u767e\u8d27\u53ef\u5c45',
    '\u672c\u6765\u5c31\u662f\u5730\u72f1\u7b11\u8bdd\uff0c\u6211\u5c31\u56e0\u4e3a\u5f88\u5730\u72f1\u6240\u4ee5\u624d\u559c\u6b22',
    '\u4e0a\u56fe\u54ea\u4e2a\u662f\u54f2\u868c',
    '\u5bf9\u4e0d\u8d77\u6211\u6ca1\u7ef7\u4f4f',
    '\u6211\u53d1\u4e2a\u5206p\u89c6\u9891\u8fd8\u5f97100\u7c89\u624d\u914d\uff0c\u7ef7\u4e0d\u4f4f\u4e86',
    '\u5730\u72f1\u7b11\u8bdd\u554a',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u903b\u8f91\u6211\u771f\u7ef7\u4e0d\u4f4f\u4e86',
      '\u522b\u62ff\u5fae\u8868\u60c5\u7ed9\u4eba\u6263\u5e3d\u5b50\uff0c\u8bc1\u636e\u5462',
      '\u5ddd\u5efa\u56fd\u8fd9\u5957\u8bdd\u672f\u53c8\u6765\u4e86',
      '\u5ddd\u666e\u7c89\u4e1d\u53c8\u5f00\u59cb\u590d\u8bfb',
      '\u8fd9\u64cd\u4f5c\u771f\u94f8\u5e01\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      '\u62ff\u53d7\u5bb3\u8005\u5f00\u5730\u72f1\u7b11\u8bdd\u5c31\u662f\u6076\u5fc3',
      '\u4f60\u628a\u622a\u56fe\u53d1\u56fe\u770b\u770b',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u7ef7\u4e0d\u4f4f\u4e86',
    '\u5fae\u8868\u60c5',
    '\u5ddd\u5efa\u56fd',
    '\u5ddd\u666e',
    '\u94f8\u5e01',
    '\u5730\u72f1\u7b11\u8bdd',
    '\u53d1\u56fe',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested mechanic, fandom, and third-party correction evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u5f00\u5408', family: 'attack', meaning: 'doxxing or exposing private information' },
      { term: '\u96f7\u666e', family: 'attack', meaning: 'rape homophone attack meme' },
      { term: '\u6295\u5c04', family: 'attack', meaning: 'psychological projection accusation' },
      { term: '\u90fd\u662f\u5bb6\u4eba', family: 'cooperation', meaning: 'solidarity that everyone is family' },
      { term: '\u540a\u6253', family: 'attack', meaning: 'comparison that humiliates the other side' },
      { term: '\u798f\u745e\u63a7', family: 'cooperation', meaning: 'furry fan identity' },
      { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self-correction or softening prior claim' },
    ],
  };
  const text = [
    '\u81ea\u52a8\u5f00\u5408',
    '\u5927\u96f7\u666e\u5bfa',
    '\u90a3\u8981\u8fd9\u4e48\u8bf4\uff0c\u7985\u9662\u76f4\u6bd8\u4eba\u7684\u90a3\u4e2a\u6295\u5c04\u5492\u6cd5\u4e0d\u4e5f\u662f\u65b0\u5947\u73a9\u610f\u513f\u3002',
    '\u6295\u5c04\u5492\u6cd5\u786e\u5b9e\u65b0\u5947\uff0c\u4f46\u67b6\u4e0d\u4f4f\u4eba\u5bb6\u662f\u7985\u9662\u8840\u8109\u5e76\u4e14\u5b9e\u529b\u591f\u5f3a',
    '\u5bb6\u4eba\u4eec\u53d1\u70b9\u5f39\u5e55\u5440\u5440\u5440\u5440\u5440\u5440\uff01',
    '\u5bb6\u4eba\u4eec\u592a\u6709\u7eaa\u5ff5\u610f\u4e49\u4e86',
    '\u4e4b\u540e\u8fd9\u4e2a\u59d0\u59d0\u7684\u8eab\u4f53\u53ef\u5c31\u4e0d\u5f53\u4eba\u4e86',
    '\u6211\u548b\u8bb0\u5f97\u8fd9\u73a9\u610f\u513f\u6709\u4e2a\u4ea1\u8bed\u79d2\u6740\u6765\u7740\uff1f',
    '\u4e5f\u53ef\u80fd\u662f\u79d2\u6740\u4ed9\u5e1d\u7684\u7ec3\u6c14[doge]',
    '\u4e00\u56de\u5408\u79d2\u6740\u4e07\u4eba\u961f',
    '\u8fd9\u626b\u798f\u745e\u597d\u9ebb\u75f9\u7684\u626b',
    '\u9a9a\u798f\u745e',
    '\u8bf4\u9519\u4e86\uff0c\u662f\u9634\u4e50',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u62b5\u5236\u5f00\u5408\u7f51\u66b4\uff0c\u522b\u66dd\u4eba\u9690\u79c1',
      '\u4ed6\u8fd9\u662f\u5728\u62ffhomo\u6897\u96f7\u666e\u5927\u4f17',
      '\u4f60\u8fd9\u662f\u628a\u81ea\u5df1\u7684\u6076\u610f\u6295\u5c04\u5230\u522b\u4eba\u8eab\u4e0a',
      '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u522b\u5435\u4e86\u597d\u597d\u8ba8\u8bba',
      '\u8fd9\u6bb5\u6f14\u6280\u540a\u6253\u6d41\u91cf',
      '\u798f\u745e\u63a7\u770b\u5f97\u5f88\u723d\uff0c\u5236\u4f5c\u4e5f\u4e0d\u9519',
      '\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u6536\u56de\u521a\u624d\u90a3\u53e5',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u5f00\u5408',
    '\u96f7\u666e',
    '\u6295\u5c04',
    '\u90fd\u662f\u5bb6\u4eba',
    '\u540a\u6253',
    '\u798f\u745e\u63a7',
    '\u524d\u9762\u8bf4\u91cd\u4e86',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested loose reaction and audience-count evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u7ef7\u4e0d\u4f4f\u4e86', family: 'attack', meaning: 'mocking laughter at another person' },
      { term: '800\u4e07', family: 'evidence', meaning: '800\u4e07\u6e38\u620f\u5e01\uff0c\u6e38\u620f\u5185\u623f\u4ea7\u4ef7\u683c\uff0c\u7528\u4e8e\u8ba8\u8bba\u4ef7\u503c' },
    ],
  };
  const text = [
    '\u5f00\u5c40\u5c31\u6ca1\u7ef7\u4f4f',
    '\u62b9\u8336\u6ca1\u7ef7\u4f4f',
    '\u60f3\u5230\u4e00\u4e2a\u7b11\u8bdd\uff1a\u4eba\u4e00\u751f\u7ef7\u4e0d\u4f4f\u7684\u6b21\u6570\u662f\u6709\u9650\u7684',
    '\u8f7b\u677e\u7ef7\u4e0d\u4f4f[\u559c\u6b22]',
    '\u5434\u4eac\u8fd9\u52a8\u4f5c\u6ca1\u7ef7\u4f4f',
    '\u7ea6\u6389\u5fae\u5206\u7b26\u53f7\u6ca1\u7ef7\u4f4f',
    '\u8d85800\u4e07\u4eba',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      '\u73b0\u5728\u4f4f\u5b85\u6709\u4e2a\u95ee\u9898\uff0c\u4e00\u773c\u5c31\u611f\u89c9800\u4e07\u4e0d\u662f\u6bd5\u4e1a\u7ea7\u522b\u7684\u3002',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u7ef7\u4e0d\u4f4f\u4e86', '800\u4e07']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested title, standalone, and literal-grass evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708', family: 'attack', meaning: 'mock that something will not survive two months' },
      { term: '\u6807\u51c6\u7ed3\u5c40', family: 'cooperation', meaning: 'summarize an expected standard ending' },
      { term: '\u8349\u751f', family: 'cooperation', meaning: 'playful meme laughter' },
      { term: '\u540a\u6253', family: 'attack', meaning: 'comparison that humiliates the other side' },
    ],
  };
  const text = [
    '\u300a\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708\u300b',
    'Bilibili video context: \u4f0a\u6717\u73b0\u653f\u6743\u6491\u4e0d\u8fc7\u4e24\u4e2a\u6708',
    '\u6807\u51c6\u7ed3\u5c40',
    '\u6807\u51c6\u7ed3\u5c40\uff08\u8fd9\u4e2a\u771f\u7684\u5b8c\u5168\u4e0d\u77e5\u9053\u4e86\uff09',
    '\u6807\u51c6\u7ed3\u5c40\u662fJOJO\u7684\u5947\u5999\u5192\u9669\u91cc\u7684\u6897',
    '\u62cd\u90a3\u4e2a\u8349\u554a',
    '\u751f\u6d3b\u79d2\u6740\u5168\u56fd9\u6210\u4eba\u6c11',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u79cd\u70ed\u5ea6\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708\uff0c\u8fd8\u88c5\u4ec0\u4e48\u957f\u7ea2',
      '\u4ed6\u5148\u9053\u6b49\u518d\u6539\u53e3\uff0c\u8fd9\u624d\u662f\u6807\u51c6\u7ed3\u5c40',
      '\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86',
      '\u8fd9\u6bb5\u6f14\u6280\u540a\u6253\u6d41\u91cf',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708',
    '\u6807\u51c6\u7ed3\u5c40',
    '\u8349\u751f',
    '\u540a\u6253',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested loose meme and semantic-neighbor evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u751f\u8349', family: 'attack', meaning: 'mock absurd hostile behavior' },
      { term: '\u592a\u61c2\u4e86', family: 'attack', meaning: 'sarcastically accuse someone of pretending to understand' },
      { term: '\u540a\u6253', family: 'attack', meaning: 'comparison that humiliates the other side' },
      { term: '\u5403\u4e8f\u662f\u798f', family: 'attack', meaning: 'sarcastic criticism of telling others to accept losses' },
    ],
  };
  const text = [
    '\u54c8\u54c8\u54c8\u54c8\uff0c\u8fc7\u4e8e\u751f\u8349',
    '\u592a\u61c2\u4e86\uff01',
    '\u6211\u592a\u61c2\u4e86',
    '\u6211\u61c2\u4e86\uff0c\u592a\u61c2\u4e86\uff01',
    '\u7426\u7389\u8001\u5e08\u4e00\u62f3\u6253\u7206\u4f60\u7684\u5934',
    '\u4eba\u4eec\u8bf4\uff0c\u5403\u4e8f\u662f\u798f\uff0c\u6211\u60f3\u5403\u5403\u4e8f[\u5472\u7259]',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u4e2a\u903b\u8f91\u592a\u751f\u8349\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      '\u53c8\u5f00\u59cb\u6559\u5927\u5bb6\u600e\u4e48\u7ad9\u961f\uff0c\u4f60\u592a\u61c2\u4e86',
      '\u8fd9\u6bb5\u6f14\u6280\u540a\u6253\u6d41\u91cf',
      '\u522b\u518d\u62ff\u5403\u4e8f\u662f\u798f\u7ed9\u522b\u4eba\u753b\u997c\u4e86',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u751f\u8349',
    '\u592a\u61c2\u4e86',
    '\u540a\u6253',
    '\u5403\u4e8f\u662f\u798f',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested self-help, negated, and publish-neighbor evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u7231\u548b\u548b\u5730', family: 'evasion', meaning: 'dismissive refusal to keep explaining' },
      { term: '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86', family: 'attack', meaning: 'factional victory-brag dismissal' },
      { term: '\u6ca1\u7075\u9b42', family: 'attack', meaning: 'criticize an answer or work as soulless' },
      { term: '\u771fcs', family: 'attack', meaning: 'abbreviated insult' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask someone to post supporting evidence or image' },
      { term: '\u4f60\u4eec\u61c2\u5427', family: 'evasion', meaning: 'hint instead of explaining directly' },
    ],
  };
  const text = [
    '\u5fc3\u91cc\u4e0d\u8981\u6015\u5c31\u597d\u4e86\u3002\u544a\u8bc9\u81ea\u5df1\u8ddf\u81ea\u5df1\u6ca1\u5173\u7cfb\uff0c\u7231\u548b\u548b\u5730\uff0c\u6211\u5565\u4e8b\u90fd\u6ca1\u6709\uff0c\u6211\u5f88\u5065\u5eb7\uff0c\u5c31\u597d\u4e86\uff0c',
    '\u8c01\u4f1a\u88ab\u4eba\u770b\u4e0d\u8d77\uff0c\u53d7\u6b3a\u8d1f\uff0c\u88ab\u5931\u4e1a\u8fd8\u80fd\u7231\u548b\u548b\u5730\u554a\uff0c\u8fd9\u6ca1\u4eba\u80fd\u505a\u5230\u5427',
    '\u6c88\u9633\u770b\u4e86\u73b0\u573a\u8d62\u9ebb',
    '\u8bf4\u7075\u9b42\u7684\u660e\u663e\u88ab\u8282\u76ee\u91c7\u8bbf\u7ed9\u8bef\u5bfc\u4e86\uff0c\u4e0d\u662f\u6ca1\u7075\u9b42\uff0c\u662f\u8154\u8c03\u4e0d\u8ba8\u559c\u7f62\u4e86',
    '\u8fd9\u662f\u771fCS',
    '\u8001\u5e08\u4f60\u81ea\u5df1\u53d1\u51fa\u6765\u4e86',
    '\u4f60\u4eec\u61c2\u4e2a\u540a\uff0c\u5728\u8fd9\u8bc4\u8bba',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8bc1\u636e\u6211\u5c31\u4e0d\u8d34\u4e86\uff0c\u7231\u548b\u548b\u5730',
      '\u4f60\u4eec\u8fd8\u5728\u627e\u8bc1\u636e\uff0c\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86',
      '\u8fd9\u4e2a\u56de\u7b54\u6ca1\u7075\u9b42\uff0c\u50cf\u662f\u6d17\u7a3f',
      '\u4f60\u771fcs\uff0c\u522b\u88c5\u4e86',
      '\u53ef\u4ee5\u8d34\u4e00\u4e0b\u539f\u56fe\u8bc1\u636e',
      '\u7ec6\u8282\u4e0d\u80fd\u8bf4\uff0c\u4f60\u4eec\u61c2\u5427',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u7231\u548b\u548b\u5730',
    '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86',
    '\u6ca1\u7075\u9b42',
    '\u771fcs',
    '\u53ef\u4ee5\u8d34',
    '\u4f60\u4eec\u61c2\u5427',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested standalone reaction and broad heat evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u8e6d\u6982\u5ff5', family: 'attack', meaning: 'accuse someone of hijacking a concept rather than ordinary clout chasing' },
      { term: '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11', family: 'attack', meaning: 'mock absurd speech as speechless laughter' },
      { term: '\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11', family: 'attack', meaning: 'shorter variant of speechless laughter mockery' },
      { term: '\u5b66\u4f1a\u4e86\u5feb\u5220', family: 'attack', meaning: 'sarcastic warning that a harmful trick should be deleted' },
    ],
  };
  const text = [
    '\u8e6d\u70ed\u5ea6',
    '\u4e2a\u4e2a\u90fd\u8e6d\u70ed\u5ea6\u6709\u610f\u601d\u5417(\u30fc_\u30fc)!!',
    '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11',
    '\u771f\u5b66\u4f1a\u4e86\u5feb\u5220',
    '\u5b66\u4f1a\u4e86\u5feb\u5220',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u5c31\u662f\u628a\u666e\u901a\u529f\u80fd\u786c\u8e6dAI\u6982\u5ff5',
      '\u4f60\u8fd9\u6bb5\u8bdd\u592a\u79bb\u8c31\uff0c\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11',
      '\u8fd9\u79cd\u5f00\u76d2\u6559\u7a0b\u5b66\u4f1a\u4e86\u5feb\u5220\uff0c\u522b\u5bb3\u4eba',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u8e6d\u6982\u5ff5',
    '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11',
    '\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11',
    '\u5b66\u4f1a\u4e86\u5feb\u5220',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested terse label markers for summary terms', () => {
  const dictionary = {
    entries: [
      { term: '\u7701\u6d41', family: 'cooperation', meaning: 'summarize content for readers' },
      { term: '\u7701\u6d41\u4fa0', family: 'cooperation', meaning: 'commenter who summarizes content for readers' },
      { term: '\u8bf4\u767d\u4e86', family: 'cooperation', meaning: 'clarify the core point in plain terms' },
    ],
  };
  const text = [
    '\u7701\u6d41\u4fa0\u00d7',
    '\u7701\u6d41\u4fa0\uff1a',
    '\u7701\u6d41',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u7701\u6d41\u4fa0\u6765\u4e86\uff1a\u524d\u4e09\u5206\u949f\u90fd\u662f\u94fa\u57ab\uff0c\u76f4\u63a5\u770b\u7ed3\u5c3e\u5c31\u884c',
      '\u7701\u6d41\uff1a\u8fd9\u6bb5\u89c6\u9891\u7684\u7ed3\u8bba\u662f\u4e0d\u5efa\u8bae\u8ddf\u98ce',
      '\u8bf4\u767d\u4e86\uff0c\u4ed6\u5c31\u662f\u5728\u628a\u7ed3\u8bba\u8bf4\u7ed9\u8def\u4eba\u542c',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u7701\u6d41', '\u7701\u6d41\u4fa0', '\u8bf4\u767d\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested emote, negated, and standalone label evidence', () => {
  const dictionary = {
    entries: [
      { term: 'doge\u91d1\u7b8d', family: 'cooperation', meaning: 'Bilibili emote marker with playful tone' },
      { term: '\u53d7\u6559', family: 'cooperation', meaning: 'acknowledge learning from a reply' },
      { term: '\u826f\u4f5c\u65e0\u4eba', family: 'cooperation', meaning: 'recommend an underwatched good work' },
    ],
  };
  const text = [
    '\u7ec6\u8282\u56db\u5dddip[doge_\u91d1\u7b8d][\u7b11\u54ed]',
    '\u7f51\u6613\u4e91\u97f3\u9891\u8bf7\u641c\u4e0d\u53d7\u6559',
    '\u826f\u4f5c\u65e0\u4eba',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u6761\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u771f\u7684\u53d7\u6559\u4e86',
      '\u8fd9\u7247\u771f\u662f\u826f\u4f5c\u65e0\u4eba\u770b\uff0c\u503c\u5f97\u63a8\u4e00\u4e0b',
      '\u8fd9\u91cc\u624b\u52a8doge\u91d1\u7b8d\u662f\u5728\u73a9\u6897\uff0c\u4e0d\u662f\u653b\u51fb',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['doge\u91d1\u7b8d', '\u53d7\u6559', '\u826f\u4f5c\u65e0\u4eba']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested praise, apology-negation, and non-evidence screenshots', () => {
  const dictionary = {
    entries: [
      { term: '\u516d\u516d\u516d', family: 'attack', meaning: 'sarcastic praise used to mock an argument' },
      { term: '\u5bf9\u4e0d\u8d77', family: 'correction', meaning: 'apologize or walk back a statement' },
      { term: '\u622a\u56fe', family: 'evidence', meaning: 'ask for or provide screenshot evidence' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'invite posting evidence or source material' },
      { term: '\u8c01\u61c2', family: 'evasion', meaning: 'vague appeal to shared understanding' },
    ],
  };
  const text = [
    '\u54c8\u54c8\u54c8\u54c8\u54c8 \u516d\u516d\u516d',
    '\u6211\u4ece\u6ca1\u6709\u5bf9\u4e0d\u8d77\u4efb\u4f55\u4eba\u54c8\u54c8\u54c8',
    '\u8868\u60c5\u5305\u53ef\u7231\uff0c\u622a\u56fe\u62ff\u8d70\u4e86',
    '\u8001\u50bb\u5b50\uff0c\u6709\u672c\u4e8b\u628a\u5403\u86cb\u7cd5\u7684\u56fe\u7247\u53d1\u51fa\u6765',
    '300\u4eba\u6b63\u5728\u89c2\u770b\uff0c\u8c01\u61c2',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u64cd\u4f5c\u516d\u516d\u516d\uff0c\u8fde\u57fa\u672c\u8bc1\u636e\u90fd\u4e0d\u770b',
      '\u5bf9\u4e0d\u8d77\uff0c\u524d\u9762\u90a3\u53e5\u662f\u6211\u8bf4\u9519\u4e86',
      '\u6709\u622a\u56fe\u5c31\u8d34\u51fa\u6765\u5f53\u8bc1\u636e',
      '\u4f60\u53ef\u4ee5\u8d34\u4e00\u4e0b\u6765\u6e90\uff0c\u8fd9\u6837\u5927\u5bb6\u597d\u5bf9\u7167',
      '\u522b\u53ea\u8bf4\u8c01\u61c2\uff0c\u8bc1\u636e\u8d34\u51fa\u6765',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u516d\u516d\u516d',
    '\u5bf9\u4e0d\u8d77',
    '\u622a\u56fe',
    '\u53ef\u4ee5\u8d34',
    '\u8c01\u61c2',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects literal expression-definition evidence for attack terms', () => {
  const dictionary = {
    entries: [
      { term: '\u963f\u9ed1\u989c', family: 'attack', meaning: 'use a sexualized face meme as an insult or degrading comparison' },
    ],
  };
  const text = [
    '\u8fd9\u662f\u6597\u9e21\u773c\uff0c\u963f\u9ed1\u989c\u4e0d\u662f\u7ffb\u767d\u773c+\u5410\u820c\u5934+\u53cc\u624b\u6bd4\u8036\u90a3\u79cd\u5417[\u7b11\u54ed]',
    '\u6ca1\u6709\u7279\u522b\u7528\u529b\uff0c\u6240\u4ee5\u963f\u9ed1\u989c\u6ca1\u90a3\u4e48\u660e\u663e[\u7b11\u54ed]',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u4f60\u522b\u628a\u6bcf\u4e2a\u4eba\u90fd\u8bf4\u6210\u963f\u9ed1\u989c\uff0c\u8fd9\u79cd\u8bdd\u5f88\u4e0d\u5c0a\u91cd',
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u963f\u9ed1\u989c']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested shopping links, emote wrappers, and platform mentions', () => {
  const dictionary = {
    entries: [
      { term: '\u94fe\u63a5', family: 'evidence', meaning: 'ask for or provide a source link as evidence' },
      { term: '\u77e5\u8bc6\u589e\u52a0', family: 'cooperation', meaning: 'acknowledge learning from a comment' },
      { term: '\u8d34\u5427', family: 'evasion', meaning: 'deflect the discussion to Tieba or mention being hung there' },
    ],
  };
  const text = [
    '\u8fd9\u4e2a\u88e4\u5b50\u597d\u597d\u770b\u5662\uff0c\u6709\u65e0\u94fe\u63a5',
    '\u6bd5\u4e1a\u540e\u5c31\u4e0d\u8054\u7cfb\u4e86[\u70ed\u8bcd\u7cfb\u5217_\u77e5\u8bc6\u589e\u52a0]',
    '\u8fd9\u5728\u8d34\u5427\u7b97\u5723\u4eba',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8bc1\u636e\u94fe\u63a5\u8d34\u51fa\u6765\uff0c\u5426\u5219\u6ca1\u6cd5\u5224\u65ad',
      '\u770b\u5b8c\u8fd9\u6761\u79d1\u666e\u771f\u662f\u77e5\u8bc6\u589e\u52a0\u4e86',
      '\u522b\u53ea\u8bf4\u8d34\u5427\u89c1\uff0c\u8fd9\u91cc\u628a\u8bc1\u636e\u8bf4\u6e05\u695a',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u94fe\u63a5', '\u77e5\u8bc6\u589e\u52a0', '\u8d34\u5427']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested narration, joke reveal, emote suffix, and literal office evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u81ea\u5df1\u770b', family: 'evasion', meaning: 'dismissively tell others to look it up or inspect it themselves' },
      { term: '\u6ca1\u60f3\u5230\u5427', family: 'attack', meaning: 'sarcastic reveal after refuting someone' },
      { term: '\u8131\u5355', family: 'cooperation', meaning: 'relationship-status meme or supportive teasing' },
      { term: '\u516d\u6247\u95e8', family: 'cooperation', meaning: 'playful old-style reference for reporting a problem' },
    ],
  };
  const text = [
    '\u62ff\u7740\u81ea\u5df1\u534a\u8f88\u5b50\u7684\u79ef\u84c4\uff0c\u4ece\u521a\u521a\u53c2\u52a0\u8fd9\u4e2a\u8282\u76ee\u62b1\u7740\u5de8\u5927\u7684\u671f\u671b\u548c\u559c\u60a6\uff0c\u518d\u5230\u65bd\u5de5\u8fc7\u7a0b\u4e2d\u81ea\u5df1\u770b\u7740\u90a3\u4e9b\u7ea2\u7816\u6c34\u6ce5',
    '\u54c8\u54c8\u54c8 \u6ca1\u60f3\u5230\u5427\uff01\u6211\u62ff\u5251\u4e5f\u8df3\u4e86\u4e00\u6bb5\uff5e',
    '\u8fd9\u5f88\u6cb3\u91cc[\u8131\u5355doge]',
    '\u201c\u5f53\u65f6\u76f4\u63a5\u7ed9\u6211\u53fc\u4e0a\u4e86\uff0c\u6211\u5dee\u70b9\u62a5\u516d\u6247\u95e8\u270b\u201d',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u522b\u95ee\u6211\uff0c\u8bc1\u636e\u90fd\u5728\u56fe\u91cc\uff0c\u4f60\u81ea\u5df1\u770b',
      '\u8bc1\u636e\u8d34\u51fa\u6765\u4e86\uff0c\u6ca1\u60f3\u5230\u5427\uff0c\u524d\u9762\u90a3\u4e2a\u8bf4\u6211\u9020\u8c23\u7684\u5462',
      '\u795d\u4f60\u65e9\u65e5\u8131\u5355\uff0c\u522b\u518d\u5728\u8bc4\u8bba\u533a\u7834\u9632\u4e86',
      '\u8fd9\u4e2abug\u5efa\u8bae\u62a5\u516d\u6247\u95e8\uff0c\u8ba9up\u4fee\u4e00\u4e0b',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u81ea\u5df1\u770b', '\u6ca1\u60f3\u5230\u5427', '\u8131\u5355', '\u516d\u6247\u95e8']);
});

test('findDictionaryEntriesWithTextEvidence rejects apology reactions, standalone emotes, and bare bug labels', () => {
  const dictionary = {
    entries: [
      { term: '\u5bf9\u4e0d\u8d77', family: 'correction', meaning: 'apologize or walk back a statement' },
      { term: '\u5999\u554a', family: 'cooperation', meaning: 'praise a useful or clever explanation' },
      { term: '\u65e0\u8bed', family: 'cooperation', meaning: 'de-escalating expression of speechlessness' },
      { term: '\u5361bug', family: 'evidence', meaning: 'point to a bug or exploit as evidence for a claim' },
    ],
  };
  const text = [
    '\u5bf9\u4e0d\u8d77\u6211\u6ca1\u7ef7\u4f4f',
    '\u563f\uff0c\u6211\u65e9\u6709\u610f\u6599\uff0c\u65e9\u5c31\u7528\u9910\u5dfe\u7eb8\u64e6\u5e72\u51c0\u4e86[\u5999\u554a]',
    '\u7b2c\u4e00\u6b21\u662f\u90d1\u79c0\u598d\u548c\u4e8e\u6587\u6587\uff0c\u5269\u4e0b\u7684\u90fd\u6ca1\u6709\uff0c\u73b0\u5728[\u65e0\u8bed]',
    '\u5361BUG',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u5bf9\u4e0d\u8d77\uff0c\u524d\u9762\u8bf4\u9519\u4e86\uff0c\u6211\u6536\u56de',
      '\u8fd9\u4e2a\u8865\u5145\u8bc1\u636e\u771f\u5999\u554a\uff0c\u601d\u8def\u6e05\u695a',
      '\u6211\u771f\u7684\u65e0\u8bed\uff0c\u4f46\u8fd8\u662f\u5148\u628a\u8bc1\u636e\u8d34\u51fa\u6765',
      '\u8fd9\u4e2a\u89c6\u9891\u5c31\u662f\u5361bug\u7684\u8bc1\u636e\uff0c\u4e0d\u662f\u6b63\u5e38\u73a9\u6cd5',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u5bf9\u4e0d\u8d77', '\u5999\u554a', '\u65e0\u8bed', '\u5361bug']);
});

test('findDictionaryEntriesWithTextEvidence rejects harvested emote suffix and loose synonym evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u55d1\u74dc\u5b50', family: 'evasion', meaning: 'spectator popcorn-style stance instead of engaging' },
      { term: '\u516d\u516d\u516d', family: 'attack', meaning: 'sarcastic praise used as mockery' },
      { term: '\u540a\u6253', family: 'attack', meaning: 'claim one side crushes another in a hostile comparison' },
      { term: '\u65e0\u8bed', family: 'cooperation', meaning: 'de-escalating expression of speechlessness' },
    ],
  };
  const text = [
    '\u6211\u59d0\u592e\u8d22\u91d1\u878d\uff0c\u73b0\u5728\u5728\u5317\u4eac\uff0c\u60a8\u5728\u54ea\u9ad8\u5c31[\u55d1\u74dc\u5b50]',
    '\u8c46\u5305\u53f2 gemini \u795e[\u55d1\u74dc\u5b50]',
    '\u56de\u590d @\u5f00\u6717\u7684\u72d7\u5934\u6539\u9020 :\u516d\u516d\u516d',
    '\u7136\u540e\u9020\u4e2a\u9a71\u9010\u8230\u6253\u7206\u86cb\u86cb\u8272\u6cb9\u7530\u5c31\u9000[\u70ed\u8bcd\u7cfb\u5217_\u593a\u7b0b\u5450]',
    '[\u70ed\u8bcd\u7cfb\u5217_\u516d\u5230\u65e0\u8bed][\u70ed\u8bcd\u7cfb\u5217_\u516d\u5230\u65e0\u8bed]',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u522b\u53ea\u5728\u65c1\u8fb9\u55d1\u74dc\u5b50\uff0c\u8981\u53cd\u9a73\u5c31\u628a\u8bc1\u636e\u8d34\u51fa\u6765',
      '\u8fd9\u64cd\u4f5c\u516d\u516d\u516d\uff0c\u8fde\u57fa\u672c\u8bc1\u636e\u90fd\u4e0d\u770b',
      '\u522b\u52a8\u4e0d\u52a8\u5c31\u8bf4\u540a\u6253\uff0c\u5148\u628a\u5bf9\u6bd4\u6570\u636e\u653e\u51fa\u6765',
      '\u6211\u771f\u7684\u65e0\u8bed\uff0c\u4f46\u8fd8\u662f\u5148\u628a\u8bc1\u636e\u8d34\u51fa\u6765',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u55d1\u74dc\u5b50', '\u516d\u516d\u516d', '\u540a\u6253', '\u65e0\u8bed']);
});

test('normalizeKeywordEntries prunes generic support evidence for support-force term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u652f\u6301\u529b',
      family: 'cooperation',
      meaning: 'support-force meme wording rather than generic support comments',
      evidenceCount: 3,
      evidenceSamples: ['\u652f\u6301', '\u652f\u6301\u4f60', '\u8fd9\u6ce2\u652f\u6301\u529b\u62c9\u6ee1'],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u652f\u6301' },
        { source: 'Bilibili public video comment scan', sample: '\u652f\u6301\u4f60' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u6ce2\u652f\u6301\u529b\u62c9\u6ee1' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u6ce2\u652f\u6301\u529b\u62c9\u6ee1']);
  assert.deepEqual(entries[0].evidenceSources.map((source) => source.sample), ['\u8fd9\u6ce2\u652f\u6301\u529b\u62c9\u6ee1']);
});

test('normalizeKeywordEntries prunes generic support evidence for support-up term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u652f\u6301\u4e00\u4e0bup',
      family: 'cooperation',
      meaning: 'ask viewers to support the uploader rather than generic support comments',
      evidenceCount: 3,
      evidenceSamples: ['\u652f\u6301', '\u652f\u6301\u4f60', '\u559c\u6b22\u8fd9\u671f\u5c31\u652f\u6301\u4e00\u4e0bup'],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u652f\u6301' },
        { source: 'Bilibili public video comment scan', sample: '\u652f\u6301\u4f60' },
        { source: 'Bilibili public video comment scan', sample: '\u559c\u6b22\u8fd9\u671f\u5c31\u652f\u6301\u4e00\u4e0bup' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u559c\u6b22\u8fd9\u671f\u5c31\u652f\u6301\u4e00\u4e0bup']);
  assert.deepEqual(entries[0].evidenceSources.map((source) => source.sample), ['\u559c\u6b22\u8fd9\u671f\u5c31\u652f\u6301\u4e00\u4e0bup']);
});

test('normalizeKeywordEntries prunes username substring evidence for zhou-pi attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7ca5\u6279',
      family: 'attack',
      meaning: 'derogatory label for Arknights players',
      evidenceCount: 4,
      evidenceSamples: [
        '19\u5e7420\u5e74\u7ca5\u6279\u5e74\u4ee3\u9f0e\u76db\u671f\uff0c\u6076\u81ed\u7a0b\u5ea6\u4e0d\u4e0b\u4e8e\u25cb',
        '\u56de\u590d @AAA\u9178\u89d2\u7ca5\u6279\u53d1\u5546 :\u6240\u4ee5\u8bf4\uff0c\u4ee5\u540e\u63a2\u6708\u653e\u4e2a\u5730\u7403\u4e0d\u5c31\u884c\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '19\u5e7420\u5e74\u7ca5\u6279\u5e74\u4ee3\u9f0e\u76db\u671f\uff0c\u6076\u81ed\u7a0b\u5ea6\u4e0d\u4e0b\u4e8e\u25cb' },
        { source: 'Bilibili public video comment scan', sample: '\u56de\u590d @AAA\u9178\u89d2\u7ca5\u6279\u53d1\u5546 :\u6240\u4ee5\u8bf4\uff0c\u4ee5\u540e\u63a2\u6708\u653e\u4e2a\u5730\u7403\u4e0d\u5c31\u884c\u4e86' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['19\u5e7420\u5e74\u7ca5\u6279\u5e74\u4ee3\u9f0e\u76db\u671f\uff0c\u6076\u81ed\u7a0b\u5ea6\u4e0d\u4e0b\u4e8e\u25cb']);
});

test('normalizeKeywordEntries prunes video-title context evidence for dark-door insult term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6697\u95e8\u5b50',
      family: 'attack',
      meaning: 'derogatory insult that frames a woman as a hidden sex worker',
      evidenceCount: 4,
      evidenceSamples: [
        '\u660e\u661f=\u9ad8\u7ea7jn\uff0c\u5973\u4e3b\u64ad=\u6697\u95e8\u5b50',
        'Bilibili video context: \u5ab3\u5987\u5e72\u8d77\u8db3\u7597\u5e08 \u6000\u7591\u59bb\u5b50\u5916\u8fb9\u6709\u4eba\u505a\u8d77\u6697\u95e8\u5b50',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u660e\u661f=\u9ad8\u7ea7jn\uff0c\u5973\u4e3b\u64ad=\u6697\u95e8\u5b50' },
        { source: 'Bilibili public search-discovered video context', sample: 'Bilibili video context: \u5ab3\u5987\u5e72\u8d77\u8db3\u7597\u5e08 \u6000\u7591\u59bb\u5b50\u5916\u8fb9\u6709\u4eba\u505a\u8d77\u6697\u95e8\u5b50' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u660e\u661f=\u9ad8\u7ea7jn\uff0c\u5973\u4e3b\u64ad=\u6697\u95e8\u5b50']);
  assert.deepEqual(entries[0].evidenceSources.map((source) => source.sample), ['\u660e\u661f=\u9ad8\u7ea7jn\uff0c\u5973\u4e3b\u64ad=\u6697\u95e8\u5b50']);
});

test('normalizeKeywordEntries prunes public-title evidence for outdated-meme term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6897out\u4e86',
      family: 'absolutes',
      meaning: 'dismisses a meme as outdated',
      evidenceCount: 3,
      evidenceSamples: [
        '\u90a3\u4eca\u5929\u770b\u7684\u6897out\u4e86\uff01',
        'Bilibili public video title: \u518d\u4e5f\u4e0d\u6015\u88about\u4e86\uff01-1',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u90a3\u4eca\u5929\u770b\u7684\u6897out\u4e86\uff01' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u518d\u4e5f\u4e0d\u6015\u88about\u4e86\uff01-1' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u90a3\u4eca\u5929\u770b\u7684\u6897out\u4e86\uff01']);
});

test('normalizeKeywordEntries prunes rhetorical accusation evidence for correction mistake term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u641e\u9519\u4e86',
      family: 'correction',
      meaning: 'acknowledges a mistake and corrects it',
      evidenceCount: 2,
      evidenceSamples: [
        '\u90fd\u73a9\u79c1\u670d\u4e86\u8fd8\u6c2a\u91d1\u662f\u4e0d\u662f\u641e\u9519\u4e86\u4ec0\u4e48',
        '\u6211\u524d\u9762\u641e\u9519\u4e86\uff0c\u8fd9\u91cc\u66f4\u6b63\u4e00\u4e0b',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u90fd\u73a9\u79c1\u670d\u4e86\u8fd8\u6c2a\u91d1\u662f\u4e0d\u662f\u641e\u9519\u4e86\u4ec0\u4e48' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u524d\u9762\u641e\u9519\u4e86\uff0c\u8fd9\u91cc\u66f4\u6b63\u4e00\u4e0b' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u6211\u524d\u9762\u641e\u9519\u4e86\uff0c\u8fd9\u91cc\u66f4\u6b63\u4e00\u4e0b']);
});

test('normalizeKeywordEntries prunes meta-question evidence for evade-main-point term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u907f\u91cd\u5c31\u8f7b',
      family: 'evasion',
      meaning: 'accuses someone of avoiding the main issue',
      evidenceCount: 2,
      evidenceSamples: [
        '\u51e0\u4e2a\u6c34\u519b\u4e5f\u662f\u907f\u91cd\u5c31\u8f7b\uff0c\u95ee\u9898\u4e0d\u662f\u51fa\u5728\u9884\u5236\u83dc\u4e0a',
        '\u4e3a\u4ec0\u4e48\u53eb\u907f\u91cd\u5c31\u8f7b\u5462',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u51e0\u4e2a\u6c34\u519b\u4e5f\u662f\u907f\u91cd\u5c31\u8f7b\uff0c\u95ee\u9898\u4e0d\u662f\u51fa\u5728\u9884\u5236\u83dc\u4e0a' },
        { source: 'Bilibili public video comment scan', sample: '\u4e3a\u4ec0\u4e48\u53eb\u907f\u91cd\u5c31\u8f7b\u5462' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u51e0\u4e2a\u6c34\u519b\u4e5f\u662f\u907f\u91cd\u5c31\u8f7b\uff0c\u95ee\u9898\u4e0d\u662f\u51fa\u5728\u9884\u5236\u83dc\u4e0a']);
});

test('normalizeKeywordEntries prunes public-title evidence for discipline-customer attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u89c4\u8bad\u987e\u5ba2',
      family: 'attack',
      meaning: 'criticizes a business or speaker for disciplining customers',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8fd8\u662f\u5728\u89c4\u8bad\u987e\u5ba2',
        'Bilibili public video title: \u62c9\u9762\u4ed9\u4eba\u89c4\u8bad\u987e\u5ba2\u7981\u6b62\u5403\u9762\u65f6\u770b\u624b\u673a',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8fd8\u662f\u5728\u89c4\u8bad\u987e\u5ba2' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u62c9\u9762\u4ed9\u4eba\u89c4\u8bad\u987e\u5ba2\u7981\u6b62\u5403\u9762\u65f6\u770b\u624b\u673a' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd8\u662f\u5728\u89c4\u8bad\u987e\u5ba2']);
});

test('normalizeKeywordEntries prunes public-title evidence for haojiahuo reaction term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u597d\u5609\u4f19',
      family: 'attack',
      meaning: 'variant of good grief used for surprise or complaint',
      evidenceCount: 4,
      evidenceSamples: [
        '\u597d\u5609\u4f19\u6211\u5c31\u50bb\u76ef\u7740\u8fd9\u5f39\u5e55\u53d8\u8272[\u5fae\u7b11]',
        'Bilibili public video title: \u597d\u5609\u4f19',
        'Bilibili public video title: \u597d\u5609\u4f19\uff0c\u7ec8\u4e8e\u753b\u597d\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u597d\u5609\u4f19\u6211\u5c31\u50bb\u76ef\u7740\u8fd9\u5f39\u5e55\u53d8\u8272[\u5fae\u7b11]' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u597d\u5609\u4f19' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u597d\u5609\u4f19\uff0c\u7ec8\u4e8e\u753b\u597d\u4e86' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u597d\u5609\u4f19\u6211\u5c31\u50bb\u76ef\u7740\u8fd9\u5f39\u5e55\u53d8\u8272[\u5fae\u7b11]']);
});

test('normalizeKeywordEntries prunes public-title evidence for no-use absolute term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6beb\u65e0\u540a\u7528',
      family: 'absolutes',
      meaning: 'absolute dismissal that something is useless',
      evidenceCount: 2,
      evidenceSamples: [
        '\u522b\u4e70\uff0c\u6beb\u65e0\u540a\u7528',
        'Bilibili public video title: \u201c\u8001\u516c\u53d8\u6210\u4e27\u5c38\u6beb\u65e0\u540a\u7528...\u201d',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u522b\u4e70\uff0c\u6beb\u65e0\u540a\u7528' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u201c\u8001\u516c\u53d8\u6210\u4e27\u5c38\u6beb\u65e0\u540a\u7528...\u201d' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u522b\u4e70\uff0c\u6beb\u65e0\u540a\u7528']);
});

test('normalizeKeywordEntries prunes public-title evidence for hard-to-persuade attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c',
      family: 'attack',
      meaning: 'attacks someone as refusing advice and courting disaster',
      evidenceCount: 4,
      evidenceSamples: [
        '\u8fd9\u8f66\u4e0d\u9760\u8c31\uff0c\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c',
        'Bilibili public video title: \u4e3a\u4ec0\u4e48\u8bf4\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c\uff1f',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u8f66\u4e0d\u9760\u8c31\uff0c\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u4e3a\u4ec0\u4e48\u8bf4\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c\uff1f' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u8f66\u4e0d\u9760\u8c31\uff0c\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c']);
});

test('normalizeKeywordEntries prunes public-title evidence for good-era-arrived term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u597d\u65f6\u4ee3\u6765\u4e34\u529b',
      family: 'cooperation',
      meaning: 'expresses positive expectation that a good era has arrived',
      evidenceCount: 4,
      evidenceSamples: [
        '\u611f\u89c9\u65e0\u85cf\u6253\u6cd5\u7684\u4e95\u55b7\u671f\u4e86\uff0c\u597d\u65f6\u4ee3\u6765\u4e34\u529b\uff01',
        'Bilibili public video title: \u4eba\u4eba\u90fd\u6709\u9c81\u4f2f\u7279\u7684\u597d\u65f6\u4ee3\u6765\u4e34\u529b!',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u611f\u89c9\u65e0\u85cf\u6253\u6cd5\u7684\u4e95\u55b7\u671f\u4e86\uff0c\u597d\u65f6\u4ee3\u6765\u4e34\u529b\uff01' },
        { source: 'Bilibili public video title', sample: 'Bilibili public video title: \u4eba\u4eba\u90fd\u6709\u9c81\u4f2f\u7279\u7684\u597d\u65f6\u4ee3\u6765\u4e34\u529b!' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u611f\u89c9\u65e0\u85cf\u6253\u6cd5\u7684\u4e95\u55b7\u671f\u4e86\uff0c\u597d\u65f6\u4ee3\u6765\u4e34\u529b\uff01']);
});

test('normalizeKeywordEntries prunes standalone game-pun evidence for wild-dick attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u8352\u91ce\u5927\u8fea\u5ba2',
      family: 'attack',
      meaning: 'sexualized pun used as an insulting meme',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8352\u91ce\u5927\u8fea\u5ba2[\u7b11\u54ed]',
        '\u4f60\u8fd9\u8d77\u540d\u8352\u91ce\u5927\u8fea\u5ba2\u4e5f\u592a\u6076\u4fd7\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8352\u91ce\u5927\u8fea\u5ba2[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u8d77\u540d\u8352\u91ce\u5927\u8fea\u5ba2\u4e5f\u592a\u6076\u4fd7\u4e86' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u8d77\u540d\u8352\u91ce\u5927\u8fea\u5ba2\u4e5f\u592a\u6076\u4fd7\u4e86']);
});

test('normalizeKeywordEntries prunes standalone hui-character meme evidence without attack target', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5',
      family: 'attack',
      meaning: 'mocks pedantry by referencing the four ways to write hui',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5077\u5077\u544a\u8bc9\u4f60\u4eec \u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5',
        '\u4f60\u8fd9\u4e0d\u5c31\u662f\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5\u5417\uff0c\u522b\u5728\u8fd9\u62a0\u5b57\u773c\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5077\u5077\u544a\u8bc9\u4f60\u4eec \u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u4e0d\u5c31\u662f\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5\u5417\uff0c\u522b\u5728\u8fd9\u62a0\u5b57\u773c\u4e86' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u4e0d\u5c31\u662f\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5\u5417\uff0c\u522b\u5728\u8fd9\u62a0\u5b57\u773c\u4e86']);
});

test('normalizeKeywordEntries prunes loose bengbuzhu reaction evidence for attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7ef7\u4e0d\u4f4f\u4e86',
      family: 'attack',
      meaning: 'mocking that something is laughably absurd',
      evidenceCount: 2,
      evidenceSamples: [
        '\u73b0\u5728\u53c8\u53d1\u8fbe\u4e86 \u8001\u5a46\u8ddf\u5144\u5f1f\u8dd1\u4e86 \u6ca1\u7ef7\u4f4f',
        'up\u8bed\u6c14\u6ca1\u7ef7\u4f4f',
        '\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u8fd9\u4e2a\u6ca1\u7ef7\u4f4f',
        '\u4f60\u8fd9\u4e2a\u6211\u662f\u771f\u7ef7\u4e0d\u4f4f[\u7b11\u54ed]',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u73b0\u5728\u53c8\u53d1\u8fbe\u4e86 \u8001\u5a46\u8ddf\u5144\u5f1f\u8dd1\u4e86 \u6ca1\u7ef7\u4f4f' },
        { source: 'Bilibili public video comment scan', sample: 'up\u8bed\u6c14\u6ca1\u7ef7\u4f4f' },
        { source: 'Bilibili public video comment scan', sample: '\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u8fd9\u4e2a\u6ca1\u7ef7\u4f4f' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u4e2a\u6211\u662f\u771f\u7ef7\u4e0d\u4f4f[\u7b11\u54ed]' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u4e2a\u6211\u662f\u771f\u7ef7\u4e0d\u4f4f[\u7b11\u54ed]']);
});

test('normalizeKeywordEntries prunes numeric praise bengbuzhu reaction evidence for attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7ef7\u4e0d\u4f4f\u4e86',
      family: 'attack',
      meaning: 'mocking that something is laughably absurd',
      evidenceCount: 2,
      evidenceSamples: [
        '666\uff0c\u6ca1\u7ef7\u4f4f',
        '\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '666\uff0c\u6ca1\u7ef7\u4f4f' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b']);
});

test('normalizeKeywordEntries prunes standalone logic-gift labels without a target', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u903b\u8f91\u9b3c\u624d',
      family: 'attack',
      meaning: 'sarcastically mocks absurd logic',
      evidenceCount: 2,
      evidenceSamples: [
        '\u903b\u8f91\u9b3c\u624d',
        '\u4f60\u8fd9\u903b\u8f91\u9b3c\u624d\uff0c\u524d\u540e\u77db\u76fe\u8fd8\u8bf4\u81ea\u5df1\u6709\u8bc1\u636e',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u903b\u8f91\u9b3c\u624d' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u903b\u8f91\u9b3c\u624d\uff0c\u524d\u540e\u77db\u76fe\u8fd8\u8bf4\u81ea\u5df1\u6709\u8bc1\u636e' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u903b\u8f91\u9b3c\u624d\uff0c\u524d\u540e\u77db\u76fe\u8fd8\u8bf4\u81ea\u5df1\u6709\u8bc1\u636e']);
});

test('normalizeKeywordEntries prunes latest loose harvested cooperation and attack evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4e38\u4e86',
      family: 'cooperation',
      meaning: 'homophone of finished, used for self-deprecating concession',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5510\u4e38\u4e86',
        '\u540e\u9762\u4e3b\u89d2\u600e\u4e48\u53d8\u9b54\u4e38\u4e86\uff0c\u90a3\u58f0man\u7b11\u6b7b\u6211\u4e86\ud83d\ude02',
        '\u54c8\u54c8\u54c8\uff0c\u6211\u98ce\u70ed\u5feb\u597d\u53c8\u6d17\u4e86\u4e2a\u6fa1\uff0c\u4e38\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5510\u4e38\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u540e\u9762\u4e3b\u89d2\u600e\u4e48\u53d8\u9b54\u4e38\u4e86\uff0c\u90a3\u58f0man\u7b11\u6b7b\u6211\u4e86\ud83d\ude02' },
        { source: 'Bilibili public video comment scan', sample: '\u54c8\u54c8\u54c8\uff0c\u6211\u98ce\u70ed\u5feb\u597d\u53c8\u6d17\u4e86\u4e2a\u6fa1\uff0c\u4e38\u4e86' },
      ],
    },
    {
      term: '\u9488\u4e0d\u6233',
      family: 'attack',
      meaning: 'homophone of really good used sarcastically',
      evidenceCount: 2,
      evidenceSamples: [
        '\u771f\u4e0d\u9519\uff0c\u8fd9\u4e2a\u89c6\u9891\u9488\u4e0d\u6233\uff0c\u5443\u554a\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8[\u6b6a\u5634][\u6b6a\u5634]',
        'up\u5beb\u7684\u5f88\u4e0d\u932f[\u4ee5\u95ea\u4eae\u4e4b\u540d_\u9488\u4e0d\u6233]\u4e0d\u904e\u6709\u5e7e\u500b\u5730\u65b9\u9084\u662f\u6709\u51fa\u5165\u7684[\u7b11\u54ed]',
        '\u660e\u5929\u8003\u8bd5\u9488\u4e0d\u6233',
        '\u4f60\u8fd9\u9634\u9633\u602a\u6c14\u9488\u4e0d\u6233\uff0c\u8bc1\u636e\u5462',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u771f\u4e0d\u9519\uff0c\u8fd9\u4e2a\u89c6\u9891\u9488\u4e0d\u6233\uff0c\u5443\u554a\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8\u54c8[\u6b6a\u5634][\u6b6a\u5634]' },
        { source: 'Bilibili public video comment scan', sample: 'up\u5beb\u7684\u5f88\u4e0d\u932f[\u4ee5\u95ea\u4eae\u4e4b\u540d_\u9488\u4e0d\u6233]\u4e0d\u904e\u6709\u5e7e\u500b\u5730\u65b9\u9084\u662f\u6709\u51fa\u5165\u7684[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u660e\u5929\u8003\u8bd5\u9488\u4e0d\u6233' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u9634\u9633\u602a\u6c14\u9488\u4e0d\u6233\uff0c\u8bc1\u636e\u5462' },
      ],
    },
    {
      term: '\u4e0a\u7535\u89c6',
      family: 'cooperation',
      meaning: 'asks to surface a comment or item for visibility',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\u4e5f\u4e0a\u7535\u89c6\u4e86',
        '\u4e3b\u5305\u80fd\u4e0d\u80fd\u628a\u8fd9\u6761\u8bc1\u636e\u4e0a\u7535\u89c6',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u6211\u4e5f\u4e0a\u7535\u89c6\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u4e3b\u5305\u80fd\u4e0d\u80fd\u628a\u8fd9\u6761\u8bc1\u636e\u4e0a\u7535\u89c6' },
      ],
    },
    {
      term: '\u6807\u51c6\u7ed3\u5c40',
      family: 'cooperation',
      meaning: 'summarizes an expected standard ending',
      evidenceCount: 2,
      evidenceSamples: [
        '\u56de\u590d @\u9f9f\u901f\u4e4b\u738b-\u901a\u53e4\u9b3c\u65af :[\u70ed\u8bcd\u7cfb\u5217_\u6807\u51c6\u7ed3\u5c40]',
        '\u4ed6\u5148\u9053\u6b49\u518d\u6539\u53e3\uff0c\u8fd9\u624d\u662f\u6807\u51c6\u7ed3\u5c40',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u56de\u590d @\u9f9f\u901f\u4e4b\u738b-\u901a\u53e4\u9b3c\u65af :[\u70ed\u8bcd\u7cfb\u5217_\u6807\u51c6\u7ed3\u5c40]' },
        { source: 'Bilibili public video comment scan', sample: '\u4ed6\u5148\u9053\u6b49\u518d\u6539\u53e3\uff0c\u8fd9\u624d\u662f\u6807\u51c6\u7ed3\u5c40' },
      ],
    },
    {
      term: '\u5168\u662f\u7c89\u4e1d',
      family: 'attack',
      meaning: 'accuses the other side of being only fans',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5168\u662f\u7c89\u4e1d',
        '\u8bc4\u8bba\u533a\u5168\u662f\u7c89\u4e1d\u63a7\u8bc4\uff0c\u6839\u672c\u4e0d\u770b\u8bc1\u636e',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5168\u662f\u7c89\u4e1d' },
        { source: 'Bilibili public video comment scan', sample: '\u8bc4\u8bba\u533a\u5168\u662f\u7c89\u4e1d\u63a7\u8bc4\uff0c\u6839\u672c\u4e0d\u770b\u8bc1\u636e' },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u4e38\u4e86', ['\u54c8\u54c8\u54c8\uff0c\u6211\u98ce\u70ed\u5feb\u597d\u53c8\u6d17\u4e86\u4e2a\u6fa1\uff0c\u4e38\u4e86']],
    ['\u9488\u4e0d\u6233', ['\u4f60\u8fd9\u9634\u9633\u602a\u6c14\u9488\u4e0d\u6233\uff0c\u8bc1\u636e\u5462']],
    ['\u4e0a\u7535\u89c6', ['\u4e3b\u5305\u80fd\u4e0d\u80fd\u628a\u8fd9\u6761\u8bc1\u636e\u4e0a\u7535\u89c6']],
    ['\u6807\u51c6\u7ed3\u5c40', ['\u4ed6\u5148\u9053\u6b49\u518d\u6539\u53e3\uff0c\u8fd9\u624d\u662f\u6807\u51c6\u7ed3\u5c40']],
    ['\u5168\u662f\u7c89\u4e1d', ['\u8bc4\u8bba\u533a\u5168\u662f\u7c89\u4e1d\u63a7\u8bc4\uff0c\u6839\u672c\u4e0d\u770b\u8bc1\u636e']],
  ]);
});

test('normalizeKeywordEntries prunes negated praise, generic address, and truncated emote evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u795e\u4ed9\u4e0b\u51e1',
      family: 'absolutes',
      meaning: 'extreme praise, describing someone as perfect like a deity',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\u770b\u4f60\u795e\u4ed9\u4e0b\u51e1\u4e0d\u6b62\u4e00\u4e2a\u89c6\u9891\uff0c\u4f60\u6015\u662f\u5f53\u771f\u4e86\u3002\u82e6\u6d77\u65e0\u8fb9\uff0c\u56de\u5934\u662f\u5cb8\u3002\u4f60\u4e00\u4ecb\u51e1\u592b\uff0c\u4e0d\u8981\u5984\u60f3\u4ec0\u4e48\u795e\u4ed9\u4e0b\u51e1\u3002\u4f60\u53bb\u795e\u7ecf\u75c5\u79d1\u5f00\u4e9b\u836f\u5403\u4e00\u6bb5\u65f6\u95f4\u5e94\u8be5\u80fd\u7f13\u4e00\u7f13\u75c5\u60c5',
        '\u8fd9\u6bb5\u64cd\u4f5c\u771f\u662f\u795e\u4ed9\u4e0b\u51e1\uff0c\u5b8c\u5168\u6ca1\u6709\u5931\u8bef',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u6211\u770b\u4f60\u795e\u4ed9\u4e0b\u51e1\u4e0d\u6b62\u4e00\u4e2a\u89c6\u9891\uff0c\u4f60\u6015\u662f\u5f53\u771f\u4e86\u3002\u82e6\u6d77\u65e0\u8fb9\uff0c\u56de\u5934\u662f\u5cb8\u3002\u4f60\u4e00\u4ecb\u51e1\u592b\uff0c\u4e0d\u8981\u5984\u60f3\u4ec0\u4e48\u795e\u4ed9\u4e0b\u51e1\u3002\u4f60\u53bb\u795e\u7ecf\u75c5\u79d1\u5f00\u4e9b\u836f\u5403\u4e00\u6bb5\u65f6\u95f4\u5e94\u8be5\u80fd\u7f13\u4e00\u7f13\u75c5\u60c5' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u6bb5\u64cd\u4f5c\u771f\u662f\u795e\u4ed9\u4e0b\u51e1\uff0c\u5b8c\u5168\u6ca1\u6709\u5931\u8bef' },
      ],
    },
    {
      term: '\u90fd\u662f\u5bb6\u4eba',
      family: 'cooperation',
      meaning: 'solidarity that everyone is family',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5bb6\u4eba\u4eec\uff0c\u8c01\u61c2\u554a\u2197\uff1f\ud83c\udf49',
        '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5bb6\u4eba\u4eec\uff0c\u8c01\u61c2\u554a\u2197\uff1f\ud83c\udf49' },
        { source: 'Bilibili public video comment scan', sample: '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba' },
      ],
    },
    {
      term: '\u5854\u83f2',
      family: 'cooperation',
      meaning: 'Taffy-related cooperative context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\u5c31\u662f\u90a3\u79cd\u8f6f\u8f6f\u5976\u5976\u7684\u7537\u5b69\u5b50\uff0c\u4e00\u78b0\u8033\u6735\u548c\u8138\u5c31\u4f1a\u7ea2\u7684\u7537\u5b69\u5b50[\u6c38\u96cf\u5854\u83f2_...',
        '\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u6211\u5c31\u662f\u90a3\u79cd\u8f6f\u8f6f\u5976\u5976\u7684\u7537\u5b69\u5b50\uff0c\u4e00\u78b0\u8033\u6735\u548c\u8138\u5c31\u4f1a\u7ea2\u7684\u7537\u5b69\u5b50[\u6c38\u96cf\u5854\u83f2_...' },
        { source: 'Bilibili public video comment scan', sample: '\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5' },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u795e\u4ed9\u4e0b\u51e1', ['\u8fd9\u6bb5\u64cd\u4f5c\u771f\u662f\u795e\u4ed9\u4e0b\u51e1\uff0c\u5b8c\u5168\u6ca1\u6709\u5931\u8bef']],
    ['\u90fd\u662f\u5bb6\u4eba', ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba']],
    ['\u5854\u83f2', ['\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5']],
  ]);
});

test('normalizeKeywordEntries prunes game map-cannon and loose family evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5730\u56fe\u70ae',
      family: 'attack',
      meaning: 'attack a whole region or group indiscriminately',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5730\u56fe\u70ae\uff0c',
        '5.\u9ad8\u65af (\u4f24\u5bb3\u5728\u5730\u56fe\u70ae\u91cc\u4e0d\u662f\u6700\u9ad8\u7684\uff0c\u4f46\u6e05\u602a\u4e00\u5b9a\u662f\u6700\u5feb\u7684[\u8131\u5355doge]\uff09',
        '\u5c31\u53ea\u6015\u70b8\u6bdb\u602a\uff0c\u653b\u901f\u9ad8\u7684\u8fdc\u7a0b\u6280\u80fd\u602a\uff0c\u5f00\u91d1\u8272\u5730\u56fe\u70ae\u6280\u80fd\u7684\u602a',
        '\u522b\u5f00\u5730\u56fe\u70ae\uff0c\u8fd9\u5c31\u662f\u5730\u57df\u9ed1',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5730\u56fe\u70ae\uff0c' },
        { source: 'Bilibili public video comment scan', sample: '5.\u9ad8\u65af (\u4f24\u5bb3\u5728\u5730\u56fe\u70ae\u91cc\u4e0d\u662f\u6700\u9ad8\u7684\uff0c\u4f46\u6e05\u602a\u4e00\u5b9a\u662f\u6700\u5feb\u7684[\u8131\u5355doge]\uff09' },
        { source: 'Bilibili public video comment scan', sample: '\u5c31\u53ea\u6015\u70b8\u6bdb\u602a\uff0c\u653b\u901f\u9ad8\u7684\u8fdc\u7a0b\u6280\u80fd\u602a\uff0c\u5f00\u91d1\u8272\u5730\u56fe\u70ae\u6280\u80fd\u7684\u602a' },
        { source: 'Bilibili public video comment scan', sample: '\u522b\u5f00\u5730\u56fe\u70ae\uff0c\u8fd9\u5c31\u662f\u5730\u57df\u9ed1' },
      ],
    },
    {
      term: '\u795e\u4ed9\u4e0b\u51e1',
      family: 'absolutes',
      meaning: 'extreme praise, describing someone as perfect like a deity',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4ec0\u4e48\u795e\u4ed9\u4e0b\u51e1',
        '\u6211\u4e5f\u559c\u6b22\uff01\uff01\uff01\u611f\u89c9\u50cf\u521d\u604b\u7684\u767d\u6708\u5149\uff0c\u795e\u4ed9\u4e0b\u51e1[\u5927\u54ed]',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u4ec0\u4e48\u795e\u4ed9\u4e0b\u51e1' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u4e5f\u559c\u6b22\uff01\uff01\uff01\u611f\u89c9\u50cf\u521d\u604b\u7684\u767d\u6708\u5149\uff0c\u795e\u4ed9\u4e0b\u51e1[\u5927\u54ed]' },
      ],
    },
    {
      term: '\u90fd\u662f\u5bb6\u4eba',
      family: 'cooperation',
      meaning: 'solidarity that everyone is family',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8fd9\u79cd\u5730\u65b9\u7684\u53ef\u4e50\u4e5f\u624d18\uff0c\u5c0f\u6768\u54e5\u97f3\u4e50\u8282\u4e00\u676f\u6c3420\uff0c\u90fd\u662f\u5bb6\u4eba\u554a',
        '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u79cd\u5730\u65b9\u7684\u53ef\u4e50\u4e5f\u624d18\uff0c\u5c0f\u6768\u54e5\u97f3\u4e50\u8282\u4e00\u676f\u6c3420\uff0c\u90fd\u662f\u5bb6\u4eba\u554a' },
        { source: 'Bilibili public video comment scan', sample: '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba' },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u5730\u56fe\u70ae', ['\u522b\u5f00\u5730\u56fe\u70ae\uff0c\u8fd9\u5c31\u662f\u5730\u57df\u9ed1']],
    ['\u795e\u4ed9\u4e0b\u51e1', ['\u6211\u4e5f\u559c\u6b22\uff01\uff01\uff01\u611f\u89c9\u50cf\u521d\u604b\u7684\u767d\u6708\u5149\uff0c\u795e\u4ed9\u4e0b\u51e1[\u5927\u54ed]']],
    ['\u90fd\u662f\u5bb6\u4eba', ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba']],
  ]);
});

test('normalizeKeywordEntries prunes generic moral obligation evidence for charity phrasing attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u884c\u5584\u79ef\u5fb7',
      family: 'attack',
      meaning: 'moralizing attack that implies bad outcomes come from lacking virtue',
      evidenceCount: 2,
      evidenceSamples: [
        '\u884c\u5584\u79ef\u5fb7\u662f\u4e49\u52a1',
        '\u4f60\u90fd\u8bf4\u4e86\u4e07\u822c\u7686\u6709\u547d\uff0c\u884c\u5584\u79ef\u5fb7\u53c8\u6709\u4ec0\u4e48\u7528\uff1f',
        '\u4f60\u8fd9\u4e48\u5634\u6bd2\uff0c\u5148\u53bb\u884c\u5584\u79ef\u5fb7\u5427\uff0c\u522b\u518d\u5bb3\u4eba',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u884c\u5584\u79ef\u5fb7\u662f\u4e49\u52a1' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u90fd\u8bf4\u4e86\u4e07\u822c\u7686\u6709\u547d\uff0c\u884c\u5584\u79ef\u5fb7\u53c8\u6709\u4ec0\u4e48\u7528\uff1f' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u4e48\u5634\u6bd2\uff0c\u5148\u53bb\u884c\u5584\u79ef\u5fb7\u5427\uff0c\u522b\u518d\u5bb3\u4eba' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u4e48\u5634\u6bd2\uff0c\u5148\u53bb\u884c\u5584\u79ef\u5fb7\u5427\uff0c\u522b\u518d\u5bb3\u4eba']);
});

test('normalizeKeywordEntries prunes latest harvested medical, game, and generic cooperation evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u9633\u75ff',
      family: 'attack',
      meaning: 'vulgar attack on sexual ability',
      evidenceCount: 3,
      evidenceSamples: [
        '\u611f\u8c22\u533b\u751f\uff0c\u6211\u662f\u9526\u7389\u516b\u5e74\u7eaa20\u73ed\u5de6\u5b50\u8c6a\uff0c15\u5e74\u4e86\u4e00\u76f4\u5012\u704c\u624d\u53d1\u73b0\u81ea\u5df1\u9633\u75ff',
        '\u6ca1\u6709\u9633\u75ff',
        '\u5854\u83f2\u7684\u804a\u5929\u8bb0\u5f55\u6839\u672c\u4e0d\u662f\u4ed6\u672c\u4eba\u653e\u51fa\u53bb\u7684\uff0c\u662f\u8fd0\u8425\u7206\u51fa\u6765\u7684\u4f46\u662f\u5f53\u65f6\u963f\u8428\u524d\u5973\u53cb\u5df2\u7ecf\u51fa\u6765\u8f9f\u8c23\u4e86\uff0c\u963f\u8428\u5f53\u65f6\u6ca1\u6709\u51fa\u95e8\u8bb0\u5f55\u554a\u5e76\u4e14\u4e5f\u7206\u51fa\u6765\u9633\u75ff\u4e86',
        '\u6211\u6f58\u6b63\u541b\u6562\u4f5c\u6562\u5f53\uff0c\u9633\u75ff\u5c31\u662f\u9633\u75ff',
        '\u4f60\u8fd9\u53d1\u8a00\u771f\u9633\u75ff\uff0c\u522b\u88c5\u4e86',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u611f\u8c22\u533b\u751f\uff0c\u6211\u662f\u9526\u7389\u516b\u5e74\u7eaa20\u73ed\u5de6\u5b50\u8c6a\uff0c15\u5e74\u4e86\u4e00\u76f4\u5012\u704c\u624d\u53d1\u73b0\u81ea\u5df1\u9633\u75ff' },
        { source: 'Bilibili public video comment scan', sample: '\u6ca1\u6709\u9633\u75ff' },
        { source: 'Bilibili public video comment scan', sample: '\u5854\u83f2\u7684\u804a\u5929\u8bb0\u5f55\u6839\u672c\u4e0d\u662f\u4ed6\u672c\u4eba\u653e\u51fa\u53bb\u7684\uff0c\u662f\u8fd0\u8425\u7206\u51fa\u6765\u7684\u4f46\u662f\u5f53\u65f6\u963f\u8428\u524d\u5973\u53cb\u5df2\u7ecf\u51fa\u6765\u8f9f\u8c23\u4e86\uff0c\u963f\u8428\u5f53\u65f6\u6ca1\u6709\u51fa\u95e8\u8bb0\u5f55\u554a\u5e76\u4e14\u4e5f\u7206\u51fa\u6765\u9633\u75ff\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u6f58\u6b63\u541b\u6562\u4f5c\u6562\u5f53\uff0c\u9633\u75ff\u5c31\u662f\u9633\u75ff' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u53d1\u8a00\u771f\u9633\u75ff\uff0c\u522b\u88c5\u4e86' },
      ],
    },
    {
      term: '\u6b65\u5175',
      family: 'evasion',
      meaning: 'uses foot-soldier metaphor to avoid addressing evidence',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\u73a9\u90a3\u4e48\u4e45\u53ea\u6709\u6302\u548c\u5929\u57fa\u70ae\u80fd\u628a\u6211\u6253\u4e0b\u6765\uff0c\u4e00\u822c\u7684\u6b65\u5175\u5b8c\u5168\u6ca1\u6709\u62b5\u6297\u80fd\u529b',
        '\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u8bc1\u636e\u8bf4\u6e05\u695a',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u6211\u73a9\u90a3\u4e48\u4e45\u53ea\u6709\u6302\u548c\u5929\u57fa\u70ae\u80fd\u628a\u6211\u6253\u4e0b\u6765\uff0c\u4e00\u822c\u7684\u6b65\u5175\u5b8c\u5168\u6ca1\u6709\u62b5\u6297\u80fd\u529b' },
        { source: 'Bilibili public video comment scan', sample: '\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u8bc1\u636e\u8bf4\u6e05\u695a' },
      ],
    },
    {
      term: '\u4e25\u7236',
      family: 'attack',
      meaning: 'meme for something that hard-counters or humiliates an opponent',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4e5f\u662f\u71c3\u85aa\u866b\u4e25\u7236',
        '\u8fd9\u6b3e\u673a\u5b50\u5c31\u662f\u540c\u4ef7\u4f4d\u4e25\u7236\uff0c\u628a\u5bf9\u624b\u6253\u7206',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u4e5f\u662f\u71c3\u85aa\u866b\u4e25\u7236' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u6b3e\u673a\u5b50\u5c31\u662f\u540c\u4ef7\u4f4d\u4e25\u7236\uff0c\u628a\u5bf9\u624b\u6253\u7206' },
      ],
    },
    {
      term: '\u5b9e\u540d\u5236',
      family: 'cooperation',
      meaning: 'explicitly identify or support a stance',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8fd9\u5c31\u4e0d\u5f97\u4e0d\u63d0\u83dc\u5200\u5b9e\u540d\u5236\u7684\u5730\u533a\u4e86',
        '\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u5c31\u4e0d\u5f97\u4e0d\u63d0\u83dc\u5200\u5b9e\u540d\u5236\u7684\u5730\u533a\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790' },
      ],
    },
    {
      term: 'bgm\u5473',
      family: 'cooperation',
      meaning: 'constructive recognition of background music style',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8fd9bgm\u5473\u592a\u51b2\u4e86',
        '\u8fd9\u4e2abgm\u5473\u5f88\u5bf9\uff0c\u6c42\u6b4c\u540d',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u8fd9bgm\u5473\u592a\u51b2\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u4e2abgm\u5473\u5f88\u5bf9\uff0c\u6c42\u6b4c\u540d' },
      ],
    },
    {
      term: '\u6ca1\u6bdb\u75c5\u554a',
      family: 'cooperation',
      meaning: 'agreement that there is no issue',
      evidenceCount: 2,
      evidenceSamples: [
        '\u662f\u54af\uff0c\u6309\u7167\u56fd\u60c5\u53d1\u5200\u4e5f\u6ca1\u6bdb\u75c5\u7684\u8111\u5b50\u53ef\u4ee5\u53bb\u6cbb\u7597\u4e86',
        '\u8fd9\u4e2a\u89e3\u91ca\u6ca1\u6bdb\u75c5\u554a\uff0c\u6211\u540c\u610f',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u662f\u54af\uff0c\u6309\u7167\u56fd\u60c5\u53d1\u5200\u4e5f\u6ca1\u6bdb\u75c5\u7684\u8111\u5b50\u53ef\u4ee5\u53bb\u6cbb\u7597\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd9\u4e2a\u89e3\u91ca\u6ca1\u6bdb\u75c5\u554a\uff0c\u6211\u540c\u610f' },
      ],
    },
    {
      term: '\u90fd\u662f\u5bb6\u4eba',
      family: 'cooperation',
      meaning: 'solidarity that everyone is family',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5bb6\u4eba\u4eec\u70b9\u70b9\u5c0f\u7ea2\u5fc3\u652f\u6301\u4e0b',
        '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5bb6\u4eba\u4eec\u70b9\u70b9\u5c0f\u7ea2\u5fc3\u652f\u6301\u4e0b' },
        { source: 'Bilibili public video comment scan', sample: '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba' },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u9633\u75ff', ['\u4f60\u8fd9\u53d1\u8a00\u771f\u9633\u75ff\uff0c\u522b\u88c5\u4e86']],
    ['\u6b65\u5175', ['\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u8bc1\u636e\u8bf4\u6e05\u695a']],
    ['\u4e25\u7236', ['\u8fd9\u6b3e\u673a\u5b50\u5c31\u662f\u540c\u4ef7\u4f4d\u4e25\u7236\uff0c\u628a\u5bf9\u624b\u6253\u7206']],
    ['\u5b9e\u540d\u5236', ['\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790']],
    ['bgm\u5473', ['\u8fd9\u4e2abgm\u5473\u5f88\u5bf9\uff0c\u6c42\u6b4c\u540d']],
    ['\u6ca1\u6bdb\u75c5\u554a', ['\u8fd9\u4e2a\u89e3\u91ca\u6ca1\u6bdb\u75c5\u554a\uff0c\u6211\u540c\u610f']],
    ['\u90fd\u662f\u5bb6\u4eba', ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested platform selection, joke-label, and queue evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7b11\u70b9\u89e3\u6790',
      family: 'cooperation',
      meaning: 'explains why a joke is funny',
      evidenceCount: 2,
      evidenceSamples: [
        '\u7b11\u70b9\u89e3\u6790\uff1awoaaa\uff01',
        '\u7b11\u70b9\u89e3\u6790\uff1awin7',
        '\u7b11\u70b9\u89e3\u6790\u4e4b\u5e16\u5b50\u70ed\u5ea6\u5f88\u4f4e \u5427\u4e5f\u662f\u6ca1\u5565\u70ed\u5ea6\u7684 \u80fd\u52a0\u6743\u662f\u5b66\u957f\u7684\u53e3\u53e3\u76f8\u4f20\u548c\u5fae\u4fe1\u7fa4\u8f6c\u53d1',
        '\u7b11\u70b9\u89e3\u6790\uff1a\u4ed6\u524d\u9762\u8bf4\u7684\u662f\u53cd\u8bdd\uff0c\u6240\u4ee5\u8fd9\u91cc\u662f\u5728\u81ea\u5632',
      ],
      evidenceSources: [],
    },
    {
      term: '\u7cbe\u9009',
      family: 'evasion',
      meaning: 'selectively filters comments or evidence to avoid criticism',
      evidenceCount: 3,
      evidenceSamples: [
        '\u89c1\u8fc7\u51e0\u4e2a\uff0c\u65e9\u5c31\u5f00\u9a82\u4e86\uff0c\u4f46\u662f\u597d\u50cf\u6709\u4e00\u4e9b\u8bc4\u8bba\u53d1\u4e0d\u51fa\u53bb\uff0c\u8bf4\u662f\u8981up\u7cbe\u9009\uff0c\u8bc4\u8bba\u533a\u4e00\u5806\u6f14\u5458\uff0c\u4f46\u4e5f\u4e3e\u62a5\u4e86[OK][OK][OK]',
        '\u5176\u5b9e\u4f60\u53ea\u8981\u770b\u4e00\u4e0b\u8bc4\u8bba\u533a\u7684\u8bc4\u8bba\u662f\u4e0d\u662f\u7cbe\u9009\u5c31\u5927\u62b5\u77e5\u9053\u4e86[\u8fa3\u773c\u775b]',
        '\u522b\u53ea\u7cbe\u9009\u5bf9\u4f60\u6709\u5229\u7684\u8bc1\u636e\uff0c\u53cd\u4f8b\u4e5f\u8d34\u51fa\u6765',
      ],
      evidenceSources: [],
    },
    {
      term: '\u91ce\u6392',
      family: 'cooperation',
      meaning: 'cooperative discussion about random matchmaking or team coordination',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\u73a9\u7684\u533b\u751f\u6253\u6b7b\u96f7\u65af\u5c31\u53bb\u6551\u4fe9\u88ab\u96f7\u65af\u4e00\u811a\u8e22\u5012\u7684\u961f\u53cb\u4e86 \u7136\u540e\u5148\u6551\u8d77\u7684\u53bb\u8214\u96f7\u65af\u76d2\u5b50\u51fa\u5fc3\u4e86[\u7b11\u54ed]\u4e0d\u8fc7\u6211\u4eec\u4e09\u4e2a\u662f\u670b\u53cb\u4e0d\u662f\u91ce\u6392',
        '\u83ab\u540d\u5176\u5999\u5c01\u4eba \u6211\u548c\u597d\u53cb\u65b0\u52a0\u5761\u4e09\u6392\u4ece\u4e0d\u91ce\u6392 \u8981\u4e0d\u5c31\u662f\u5355\u4e09 \u665a\u4e0a\u4e00\u767b\u8fd9\u4e2a\u6837\u5b50',
        '\u91ce\u6392\u961f\u53cb\u613f\u610f\u914d\u5408\uff0c\u8fd9\u5c40\u624d\u6253\u5f97\u8d77\u6765',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u7b11\u70b9\u89e3\u6790', ['\u7b11\u70b9\u89e3\u6790\uff1a\u4ed6\u524d\u9762\u8bf4\u7684\u662f\u53cd\u8bdd\uff0c\u6240\u4ee5\u8fd9\u91cc\u662f\u5728\u81ea\u5632']],
    ['\u7cbe\u9009', ['\u522b\u53ea\u7cbe\u9009\u5bf9\u4f60\u6709\u5229\u7684\u8bc1\u636e\uff0c\u53cd\u4f8b\u4e5f\u8d34\u51fa\u6765']],
    ['\u91ce\u6392', ['\u91ce\u6392\u961f\u53cb\u613f\u610f\u914d\u5408\uff0c\u8fd9\u5c40\u624d\u6253\u5f97\u8d77\u6765']],
  ]);
});

test('normalizeKeywordEntries keeps zhubi as momentary dumb-action criticism', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u732a\u9f3b',
      family: 'attack',
      meaning: 'criticizes someone for acting dumb in the moment',
      evidenceCount: 4,
      evidenceSamples: [
        '\u732a\u9f3b\u5b50\u662f\u4e2a\u9053\u5177',
        '\u8fd9\u4e2a\u9762\u5177\u50cf\u732a\u9f3b\u5b50',
        '\u4f60\u521a\u624d\u8fd9\u6ce2\u732a\u9f3b\u64cd\u4f5c\uff0c\u628a\u961f\u53cb\u90fd\u770b\u61f5\u4e86',
        '\u4ed6\u8fd9\u4e00\u624b\u771f\u732a\u9f3b\uff0c\u522b\u518d\u786c\u62ac\u4e86',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u732a\u9f3b', [
      '\u4f60\u521a\u624d\u8fd9\u6ce2\u732a\u9f3b\u64cd\u4f5c\uff0c\u628a\u961f\u53cb\u90fd\u770b\u61f5\u4e86',
      '\u4ed6\u8fd9\u4e00\u624b\u771f\u732a\u9f3b\uff0c\u522b\u518d\u786c\u62ac\u4e86',
    ]],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested platform redirect, selected-comment, and reaction evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5c0f\u67d0\u4e66',
      family: 'evasion',
      meaning: 'redirects argument to another platform instead of explaining',
      evidenceCount: 2,
      evidenceSamples: [
        '\u542c\u58f0\u8bbe\u7f6e\uff1f\u53bb\u5c0f\u67d0\u4e66\u641c\u3010\u548c\u5e73\u7cbe\u82f1\u5b98\u65b9\u798f\u5229\u3011\uff0c\u6709\u66f4\u5168\u8bbe\u7f6e\u53c2\u8003~',
        '\u522b\u53ea\u8ba9\u4eba\u53bb\u5c0f\u67d0\u4e66\u641c\uff0c\u8bc1\u636e\u548c\u6765\u6e90\u5728\u8fd9\u91cc\u8bf4\u6e05\u695a',
      ],
      evidenceSources: [],
    },
    {
      term: '\u7cbe\u9009',
      family: 'evasion',
      meaning: 'selectively filters comments or evidence to avoid criticism',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5f00\u4e86\u7cbe\u9009\uff0c\u4e0d\u7136\u89c6\u9891\u4f1a\u88ab\u5c01[doge]',
        '\u522b\u53ea\u7cbe\u9009\u5bf9\u4f60\u6709\u5229\u7684\u8bc1\u636e\uff0c\u53cd\u4f8b\u4e5f\u8d34\u51fa\u6765',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4eca\u65e5\u9996\u7ef7\u4e86',
      family: 'cooperation',
      meaning: 'reaction that someone finally cannot hold back laughter',
      evidenceCount: 3,
      evidenceSamples: [
        '\u4eca\u65e5\u9996\u7ef7\u4e86',
        '\u4eca\u65e5\u9996\u7ef7\u7ed9\u4f60\u4e86',
        '\u4eca\u65e5\u9996\u7ef7\u4e86\uff0c\u4f46\u4f60\u524d\u9762\u7684\u65f6\u95f4\u7ebf\u786e\u5b9e\u8bb2\u6e05\u695a\u4e86',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u5c0f\u67d0\u4e66', ['\u522b\u53ea\u8ba9\u4eba\u53bb\u5c0f\u67d0\u4e66\u641c\uff0c\u8bc1\u636e\u548c\u6765\u6e90\u5728\u8fd9\u91cc\u8bf4\u6e05\u695a']],
    ['\u7cbe\u9009', ['\u522b\u53ea\u7cbe\u9009\u5bf9\u4f60\u6709\u5229\u7684\u8bc1\u636e\uff0c\u53cd\u4f8b\u4e5f\u8d34\u51fa\u6765']],
    ['\u4eca\u65e5\u9996\u7ef7\u4e86', ['\u4eca\u65e5\u9996\u7ef7\u4e86\uff0c\u4f46\u4f60\u524d\u9762\u7684\u65f6\u95f4\u7ebf\u786e\u5b9e\u8bb2\u6e05\u695a\u4e86']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested username, emote-only, and engagement evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u753b\u997c',
      family: 'attack',
      meaning: 'empty promise or future-faking accusation',
      evidenceCount: 3,
      evidenceSamples: [
        '@\u7537\u7684\u90fd\u7231\u753b\u997c',
        '\u4f60\u8fd8\u662f\u6ca1\u61c2\uff0c\u5c31\u662f\u5229\u7528\u4f60\u57fa\u56e0\u6765\u753b\u997c',
      ],
      evidenceSources: [],
    },
    {
      term: '\u7537\u7684\u90fd\u7231\u753b\u997c',
      family: 'attack',
      meaning: 'gendered attack that men all make empty promises',
      evidenceCount: 3,
      evidenceSamples: [
        '@\u7537\u7684\u90fd\u7231\u753b\u997c',
        '\u8bf4\u767d\u4e86\u5973\u7684\u5c31\u662f\u7ed9\u7537\u7684\u753b\u997c\u6279\u6362\u6280\u672f',
      ],
      evidenceSources: [],
    },
    {
      term: 'tv\u5455\u5410',
      family: 'attack',
      meaning: 'emote expressing disgust at a target',
      evidenceCount: 3,
      evidenceSamples: [
        '[\u5927\u7b11][\u51b7][\u54c8\u6b20][\u6293\u72c2][tv_\u5455\u5410]',
        '\u540c\u610f\uff0c\u8fd9\u90e8\u7247\u5b50\u611f\u89c9\u5c31\u4e0d\u662f\u4e3a\u4e86\u8bb2\u597d\u6545\u4e8b\u62cd\u7684\uff0c\u800c\u662f\u6545\u610f\u50cf\u89c2\u4f17\u663e\u6446[tv_\u5455\u5410]',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5df2\u8d5e10\u8bf7\u56de\u4e0b',
      family: 'cooperation',
      meaning: 'asks for a reply after liking',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5df2\u8d5e10\uff0c\u8bf7\u56de\u4e0b',
        '\u5df2\u8d5e10\uff0c\u8bf7\u56de\u4e0b\uff0c\u4f60\u524d\u9762\u7684\u65f6\u95f4\u7ebf\u8bc1\u636e\u80fd\u518d\u8865\u5145\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4e0a\u7535\u89c6',
      family: 'cooperation',
      meaning: 'comment becomes visible in a video or highlighted context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5367\u69fd\u6211\u4e0a\u7535\u89c6\u4e86',
        '\u8fd9\u6761\u4e0a\u7535\u89c6\u4e86\uff0c\u53ef\u4ee5\u628a\u539f\u6765\u7684\u8bc1\u636e\u94fe\u63a5\u4e5f\u8865\u4e0a',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u753b\u997c', ['\u4f60\u8fd8\u662f\u6ca1\u61c2\uff0c\u5c31\u662f\u5229\u7528\u4f60\u57fa\u56e0\u6765\u753b\u997c']],
    ['\u7537\u7684\u90fd\u7231\u753b\u997c', ['\u8bf4\u767d\u4e86\u5973\u7684\u5c31\u662f\u7ed9\u7537\u7684\u753b\u997c\u6279\u6362\u6280\u672f']],
    ['tv\u5455\u5410', ['\u540c\u610f\uff0c\u8fd9\u90e8\u7247\u5b50\u611f\u89c9\u5c31\u4e0d\u662f\u4e3a\u4e86\u8bb2\u597d\u6545\u4e8b\u62cd\u7684\uff0c\u800c\u662f\u6545\u610f\u50cf\u89c2\u4f17\u663e\u6446[tv_\u5455\u5410]']],
    ['\u5df2\u8d5e10\u8bf7\u56de\u4e0b', ['\u5df2\u8d5e10\uff0c\u8bf7\u56de\u4e0b\uff0c\u4f60\u524d\u9762\u7684\u65f6\u95f4\u7ebf\u8bc1\u636e\u80fd\u518d\u8865\u5145\u5417']],
    ['\u4e0a\u7535\u89c6', ['\u8fd9\u6761\u4e0a\u7535\u89c6\u4e86\uff0c\u53ef\u4ee5\u628a\u539f\u6765\u7684\u8bc1\u636e\u94fe\u63a5\u4e5f\u8865\u4e0a']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested literal system, game affection, and game blame evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5b9e\u540d\u5236',
      family: 'cooperation',
      meaning: 'explicitly identify or support a stance',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5b9e\u540d\u5236\u7684\u91cd\u8981\u6027\u3002',
        '\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5237\u597d\u611f',
      family: 'attack',
      meaning: 'accuses someone of performatively currying favor',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4e00\u770b\u5c31\u6ca1\u770b\uff0c\u4e91\u9732\u662f\u53ea\u9632\u5fa1\uff0c\u7ed9\u81ea\u5df1\u8001\u5a46\u5237\u597d\u611f\uff0c\u4e0d\u597d\u76f4\u63a5\u6253\u6b7b\u8214\u72d7',
        '\u8fd8\u662f\u611f\u89c9\u5728\u5237\u597d\u611f[\u5403\u74dc]',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6211\u7684\u95ee\u9898',
      family: 'correction',
      meaning: 'accepts responsibility or corrects oneself',
      evidenceCount: 2,
      evidenceSamples: [
        '\u661f\u7403\u8f70\u70b8\u7838\u6b7b\u6211\uff0c\u662fcs\u8f68\u9053\u64cd\u4f5c\u5458\u7684\u95ee\u9898\uff1b\u4f46\u98de\u9e70\u98ce\u66b4\u59d0\u59d0\u56e2\u6253\u6b7b\u6211\uff0c\u90a3\u4e00\u5b9a\u662f\u6211\u7684\u95ee\u9898\u3002',
        '\u53ef\u80fd\u662f\u6211\u7684\u95ee\u9898\uff0c\u6211\u628a\u524d\u9762\u7684\u8bf4\u6cd5\u6536\u56de',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u5b9e\u540d\u5236', ['\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790']],
    ['\u5237\u597d\u611f', ['\u8fd8\u662f\u611f\u89c9\u5728\u5237\u597d\u611f[\u5403\u74dc]']],
    ['\u6211\u7684\u95ee\u9898', ['\u53ef\u80fd\u662f\u6211\u7684\u95ee\u9898\uff0c\u6211\u628a\u524d\u9762\u7684\u8bf4\u6cd5\u6536\u56de']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested loose publish, understand, and title evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask another user to post evidence or context',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5176\u5b9e\u4f60\u73a9\u7684\u65f6\u5019\u6211\u8fd8\u5728\u8c03\u8bd5\uff0c\u7ed3\u679c\u83ab\u540d\u5176\u5999\u53d1\u51fa\u6765\u4e86\uff01[\u5927\u54ed]\uff01\u73b0\u5728\u624d\u662f\u5b8c\u6574\u7248\u54ed\u54ed',
        '\u8fd9\u80fd\u53d1\u51fa\u6765\u5417\uff1f',
        '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4f60\u4eec\u61c2\u5427',
      family: 'evasion',
      meaning: 'implies insiders understand without explaining',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5b69\u5b50\u4eec\u4f60\u4eec\u61c28900\u4e2a\u89c6\u9891\u662f\u4ec0\u4e48\u6982\u5ff5\u5417\uff1f',
        '\u522b\u7ed9\u6211\u4eec\u9ed1\u5ba2\u62db\u9ed1\u4e86\uff01\u6211\u4eec\u5e73\u65f6\u90fd\u7a7f\u8fd0\u52a8\u65b9\u4fbf\u968f\u65f6\u8dd1\u8def\u7684\uff0c\u4e0d\u7136\u88ab\u7ebf\u4e0b\u771f\u5b9e\u6216\u8005\u901a\u7f09\u5c31\u5f88\u2026\u4f60\u4eec\u61c2\u5427',
      ],
      evidenceSources: [],
    },
    {
      term: '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a',
      family: 'cooperation',
      meaning: 'praise that a vehicle performs better against stronger opponents',
      evidenceCount: 2,
      evidenceSamples: [
        '\u626d\u77e9\u4e0d\u8be6\uff0c\u9047\u5f3a\u5219\u5f3a',
        '\u8fd9\u8f66\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a\uff0c\u5b9e\u6d4b\u6570\u636e\u53ef\u4ee5\u53c2\u8003',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6548\u679c\u62d4\u7fa4',
      family: 'cooperation',
      meaning: 'positive evaluation that an effect works very well',
      evidenceCount: 3,
      evidenceSamples: [
        '\u8fd9\u662f\u54ea\u4f4dUP\u4e3b\u554a\uff0c\u7a81\u7136\u56de\u5fc6\u8d77\u6709\u6548\u679c\u62d4\u7fa4\u8fd9\u4e2a\u7cfb\u5217\u89c6\u9891\u4e86',
        '\u56de\u590d @treetree\u4ed4 :\u6548\u679c\u62d4\u7fa4[\u70ed\u8bcd\u7cfb\u5217_\u5999\u554a]',
        '\u8fd9\u4e2a\u89e3\u6cd5\u6548\u679c\u62d4\u7fa4\uff0c\u5efa\u8bae\u653e\u5230\u7f6e\u9876',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6211\u7684\u95ee\u9898',
      family: 'correction',
      meaning: 'accepts responsibility or corrects oneself',
      evidenceCount: 2,
      evidenceSamples: [
        '\u56de\u590d @RosenBob :\u6211\u4e5f\u4ee5\u4e3a\u662f\u6211\u7684\u95ee\u9898\uff0c\u6211\u53bb\u63a2\u7d22\u5bc6\u5ba4\u90fd\u6328\u4e2a\u70b9\u8721\u70db\u8fc7\u53bb',
        '\u53ef\u80fd\u662f\u6211\u7684\u95ee\u9898\uff0c\u6211\u628a\u524d\u9762\u7684\u8bf4\u6cd5\u6536\u56de',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u53ef\u4ee5\u8d34', ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']],
    ['\u4f60\u4eec\u61c2\u5427', ['\u522b\u7ed9\u6211\u4eec\u9ed1\u5ba2\u62db\u9ed1\u4e86\uff01\u6211\u4eec\u5e73\u65f6\u90fd\u7a7f\u8fd0\u52a8\u65b9\u4fbf\u968f\u65f6\u8dd1\u8def\u7684\uff0c\u4e0d\u7136\u88ab\u7ebf\u4e0b\u771f\u5b9e\u6216\u8005\u901a\u7f09\u5c31\u5f88\u2026\u4f60\u4eec\u61c2\u5427']],
    ['\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a', ['\u8fd9\u8f66\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a\uff0c\u5b9e\u6d4b\u6570\u636e\u53ef\u4ee5\u53c2\u8003']],
    ['\u6548\u679c\u62d4\u7fa4', ['\u8fd9\u4e2a\u89e3\u6cd5\u6548\u679c\u62d4\u7fa4\uff0c\u5efa\u8bae\u653e\u5230\u7f6e\u9876']],
    ['\u6211\u7684\u95ee\u9898', ['\u53ef\u80fd\u662f\u6211\u7684\u95ee\u9898\uff0c\u6211\u628a\u524d\u9762\u7684\u8bf4\u6cd5\u6536\u56de']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested bare agreement, self-state, and emote bot evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6ca1\u6bdb\u75c5\u554a',
      family: 'cooperation',
      meaning: 'agreement that an argument or description has no issue',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6ca1\u6bdb\u75c5\uff01',
        '\u90d1\u5973\u58eb\u8bf4\u7684\u6ca1\u6bdb\u75c5',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6ca1\u6551\u4e86',
      family: 'correction',
      meaning: 'admits a previous position is unsalvageable',
      evidenceCount: 2,
      evidenceSamples: [
        '\u592a\u597d\u4e86\uff0c\u7126\u8651\u6027\u52a0\u4e0a\u9ad8\u654f\u611f\u4eba\u683c\u52a0\u4e0a\u6cea\u5931\u7981\u52a0\u4e0a\u7ae5\u5e74\u521b\u4f24\u52a0\u4e0a\u8ba8\u597d\u578b\u4eba\u683c\uff0c\u6211\u6ca1\u6551\u4e86 [\u661f\u661f\u773c]',
        '\u524d\u9762\u90a3\u4e2a\u8bf4\u6cd5\u6ca1\u6551\u4e86\uff0c\u6211\u6536\u56de\u91cd\u8bf4',
      ],
      evidenceSources: [],
    },
    {
      term: 'ai\u8bc6\u7247\u9171',
      family: 'cooperation',
      meaning: 'calls the AI video-identification bot for help',
      evidenceCount: 2,
      evidenceSamples: [
        '@AI\u8bc6\u7247\u9171',
        '@AI\u8bc6\u7247\u9171 \u8bf7\u5e2e\u5fd9\u8bc6\u522b\u8fd9\u6bb5\u89c6\u9891\u6765\u6e90',
      ],
      evidenceSources: [],
    },
    {
      term: 'tv\u70b9\u8d5e',
      family: 'cooperation',
      meaning: 'uses a thumbs-up emote to support a comment',
      evidenceCount: 2,
      evidenceSamples: [
        '\u90a3\u5f88\u6709\u751f\u6d3b\u4e86[tv_\u70b9\u8d5e]',
        '\u8fd9\u4e2a\u8865\u5145\u5f88\u6709\u7528[tv_\u70b9\u8d5e]\uff0c\u5efa\u8bae\u7f6e\u9876',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6ca1\u6bdb\u75c5\u554a', ['\u90d1\u5973\u58eb\u8bf4\u7684\u6ca1\u6bdb\u75c5']],
    ['\u6ca1\u6551\u4e86', ['\u524d\u9762\u90a3\u4e2a\u8bf4\u6cd5\u6ca1\u6551\u4e86\uff0c\u6211\u6536\u56de\u91cd\u8bf4']],
    ['ai\u8bc6\u7247\u9171', ['@AI\u8bc6\u7247\u9171 \u8bf7\u5e2e\u5fd9\u8bc6\u522b\u8fd9\u6bb5\u89c6\u9891\u6765\u6e90']],
    ['tv\u70b9\u8d5e', ['\u8fd9\u4e2a\u8865\u5145\u5f88\u6709\u7528[tv_\u70b9\u8d5e]\uff0c\u5efa\u8bae\u7f6e\u9876']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested broad alias and literal gameplay evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask another user to post evidence or context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u7b28\u7684\u4eba\u603b\u662f\u4e0d\u4f1a\u7528\uff0c\u89c9\u5f97\u6fc0\u6602\u7684\u53d1\u52a8\u9891\u7387\u4f4e\uff0c\u4e8e\u662f\u9ed1\u5b83\u4e3a\u767d\u677f\uff0c\u800c\u806a\u660e\u7684\u4eba\u5219\u53ef\u4ee5\u53d1\u6325\u51fa\u5b83\u7684\u6700\u5927\u529f\u529b\u3002',
        '\u6211\u60f3\u6293\u4f4f\u8fd9\u4e2a\u98ce\u53e3\uff0c\u505a\u4e00\u4e2a\u7a00\u7f3a\u7684\uff0c\u771f\u6b63\u5e26\u5927\u5bb6\u63d0\u5347\u8ba4\u77e5\uff0c\u7cbe\u901a\u7b2c\u4e00\u6027\u539f\u7406\u3002',
        '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6211\u7684\u95ee\u9898',
      family: 'correction',
      meaning: 'admit a mistake or oversight',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8c22\u8c22\uff0c\u539f\u6765\u4e0d\u662f\u6211\u7684\u95ee\u9898',
        '\u6211\u7684\u95ee\u9898\uff0c\u521a\u624d\u770b\u9519\u4e86',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5c0f\u998b\u732b',
      family: 'attack',
      meaning: 'tease someone as greedy',
      evidenceCount: 3,
      evidenceSamples: [
        '182\u4f4d\u5c0f\u998b\u732b\u3002',
        '66\u4f4d\u5c0f\u998b\u732b\u3002',
        '\u56de\u590d @\u963f\u5c0f\u67ef101 :\u5c0f\u998b\u732b\uff0c\u4ec0\u4e48\u90fd\u60f3\u5403\u53ea\u4f1a\u4e0d\u8fc7\u5ba1[doge]',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4e0b\u996d',
      family: 'cooperation',
      meaning: 'watchable with a meal',
      evidenceCount: 3,
      evidenceSamples: [
        '\u4e0b\u996d',
        '\u771f\u4e0b\u996d',
        '\u4e0b\u996d\u89c6\u9891',
        '\u8fd9\u671f\u8282\u76ee\u5f88\u4e0b\u996d\uff0c\u770b\u7740\u8f7b\u677e',
      ],
      evidenceSources: [],
    },
    {
      term: '\u60c5\u7eea\u4ef7\u503c',
      family: 'cooperation',
      meaning: 'provide emotional support or social value',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5199\u8bba\u6587\u8fd9\u4e00\u5757\u8c46\u5305\u914d\u653e\u5728\u8138\u4e0a\u5417[\u5618\u58f0]\u9876\u591a\u653e\u5c41\u80a1\u4e0a\uff0c\u7ed9\u70b9\u60c5\u7eea\u4ef7\u503c',
        '\u4f60\u662f\u62a4\u822a\uff0c\u4f60\u662f\u7ed9\u522b\u4eba\u521b\u9020\u60c5\u7eea\u4ef7\u503c\u7684\uff0c\u4f60\u8981\u6c42\u8001\u677f\u6709\u610f\u601d\uff1f',
        '\u8fd9\u4e24\u6761\u8981\u6280\u672f\u6ca1\u6280\u672f\u8981\u60c5\u7eea\u4ef7\u503c\u6ca1\u60c5\u7eea\u4ef7\u503c\u7684\u600e\u4e48\u5165\u804c\u7684\uff1f',
        '\u8c22\u8c22\u4f60\u7684\u56de\u590d\uff0c\u786e\u5b9e\u7ed9\u4e86\u5f88\u591a\u60c5\u7eea\u4ef7\u503c',
      ],
      evidenceSources: [],
    },
    {
      term: '\u91ce\u6392',
      family: 'cooperation',
      meaning: 'coordinate with random teammates',
      evidenceCount: 4,
      evidenceSamples: [
        '\u8ba9\u8001\u677f\u8d77\u67aa \u4e0d\u7ed9\u8001\u677f\u5e26\u5305 \u8ba9\u8001\u677f\u6253\u67b6\u8bf4\u662f \u90a3\u8ddf\u91ce\u6392\u6709\u4ec0\u4e48\u533a\u522b[\u7b11\u54ed]',
        '\u8fd9\u4e0d\u5c31\u662f\u91ce\u6392\u5417\uff1f',
        '\u6211\u4e00\u4e2a\u666e\u901a\u73a9\u5bb6\uff0c\u7edd\u5bc6\u4e0d\u5e26\u4efb\u4f55\u4eba\uff0c\u6211\u81ea\u5df1\u91ce\u6392\u90fd\u7a7f55\u7532\u5e26\u91d1\u86cb\u3002',
        '\u91ce\u6392\u961f\u53cb\u613f\u610f\u914d\u5408\uff0c\u8fd9\u5c40\u624d\u6253\u5f97\u8d77\u6765',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u53ef\u4ee5\u8d34', ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']],
    ['\u6211\u7684\u95ee\u9898', ['\u6211\u7684\u95ee\u9898\uff0c\u521a\u624d\u770b\u9519\u4e86']],
    ['\u5c0f\u998b\u732b', ['\u56de\u590d @\u963f\u5c0f\u67ef101 :\u5c0f\u998b\u732b\uff0c\u4ec0\u4e48\u90fd\u60f3\u5403\u53ea\u4f1a\u4e0d\u8fc7\u5ba1[doge]']],
    ['\u4e0b\u996d', ['\u4e0b\u996d\u89c6\u9891', '\u8fd9\u671f\u8282\u76ee\u5f88\u4e0b\u996d\uff0c\u770b\u7740\u8f7b\u677e']],
    ['\u60c5\u7eea\u4ef7\u503c', ['\u8c22\u8c22\u4f60\u7684\u56de\u590d\uff0c\u786e\u5b9e\u7ed9\u4e86\u5f88\u591a\u60c5\u7eea\u4ef7\u503c']],
    ['\u91ce\u6392', ['\u91ce\u6392\u961f\u53cb\u613f\u610f\u914d\u5408\uff0c\u8fd9\u5c40\u624d\u6253\u5f97\u8d77\u6765']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested resource-share, definition, and bare reaction evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask another user to post evidence or context',
      evidenceCount: 3,
      evidenceSamples: [
        '\u56de\u590d @\u65f7\u91ce\u5bc2\u9759\u55a7\u56a3\u4c6b :\u8001\u5927\u5f53\u7136\u53ef\u4ee5\uff01\u53d1\u51fa\u6765\u5c31\u662f\u65b9\u4fbf\u5927\u4f19\u5b58\u7684',
        '\u56de\u590d @badada\u7684\u5c0f\u4e38\u5b50 :\u4f60\u53ef\u4ee5\u53d1\u5230\u4f60\u7684\u52a8\u6001\u91cc\uff0c\u8bc4\u8bba\u91cc\u8bf4\u4e00\u58f0\uff0c\u770b\u5230\u7684\u5c31\u53ef\u4ee5\u81ea\u53d6',
        '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u53d1\u56fe',
      family: 'evidence',
      meaning: 'ask user to post image evidence',
      evidenceCount: 2,
      evidenceSamples: [
        '\u7b2c\u4e00\u671f\u5f85\u8001\u5e08\u8bc4\u8bba\u53d1\u56fe',
        '\u56de\u590d @\u4e91\u8d77\u4e07\u8c61 :\u53d1\u56fe\u4e0d\u5c31\u884c\u4e86\uff0c\u62bd\u514d\u8d39100\u534a\u4ef7\u662f\u5728\u7684\u5427\uff0c\u622a\u56fe\u5462',
      ],
      evidenceSources: [],
    },
    {
      term: '\u7b11\u563b\u4e86',
      family: 'cooperation',
      meaning: 'light positive reaction',
      evidenceCount: 2,
      evidenceSamples: [
        '\u7b11\u563b\u4e86',
        '\u8fd9\u6bb5\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u770b\u5b8c\u7b11\u563b\u4e86',
      ],
      evidenceSources: [],
    },
    {
      term: '\u9633\u75ff',
      family: 'attack',
      meaning: 'hostile sexual insult',
      evidenceCount: 3,
      evidenceSamples: [
        'ED\u4e0d\u662f\u9633\u75ff\u5417\uff1f',
        'ed\u4e0d\u662f\u9633\u75ff\u5417',
        '\u4f60\u8fd9\u53d1\u8a00\u771f\u9633\u75ff\uff0c\u522b\u88c5\u4e86',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4f18\u96c5',
      family: 'cooperation',
      meaning: 'graceful positive reaction',
      evidenceCount: 4,
      evidenceSamples: [
        '\u4f18\u96c5\uff0c\u771f\u662f\u4f18\u96c5\u54c8\u54c8\u54c8',
        '\u4f18\u96c5\uff0c\u978b\u90fd\u662f\u9ed1\u767d\u8272\u7684',
        '\u8279\u4ece\u732b\u722c\u67b6\u4f18\u96c5\u7684\u8e31\u6b65\u4e0b\u6765\u4e86',
        '\u4ed6\u786e\u5b9e\u5f88\u4f18\u96c5\u8fd8\u5f88\u53ef\u7231\u5f88\u5e05\u6c14[doge]\u771f\u662f\u5947\u4e86\u602a\u4e86\uff0c\u660e\u660e\u662f\u4e2a\u9ad8\u9ad8\u7626\u7626\u7684\u9ab7\u9ac5\u5934',
      ],
      evidenceSources: [],
    },
    {
      term: 'tv\u70b9\u8d5e',
      family: 'cooperation',
      meaning: 'uses a thumbs-up emote to support a comment',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6210\u529f\u4eba\u58eb\u7684\u949b\u5408\u91d1\u624b\u673a[doge][tv_\u70b9\u8d5e]',
        '\u8fd9\u4e2a\u8865\u5145\u5f88\u6709\u7528[tv_\u70b9\u8d5e]\uff0c\u5efa\u8bae\u7f6e\u9876',
      ],
      evidenceSources: [],
    },
    {
      term: '\u4e0b\u996d',
      family: 'cooperation',
      meaning: 'watchable with a meal',
      evidenceCount: 3,
      evidenceSamples: [
        '\u4e0b\u996d\u5c31\u5b8c\u4e8b\u4e86',
        '\u4e0b\u996d\u89c6\u9891',
        '\u8fd9\u671f\u8282\u76ee\u5f88\u4e0b\u996d\uff0c\u770b\u7740\u8f7b\u677e',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u53ef\u4ee5\u8d34', ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']],
    ['\u53d1\u56fe', ['\u56de\u590d @\u4e91\u8d77\u4e07\u8c61 :\u53d1\u56fe\u4e0d\u5c31\u884c\u4e86\uff0c\u62bd\u514d\u8d39100\u534a\u4ef7\u662f\u5728\u7684\u5427\uff0c\u622a\u56fe\u5462']],
    ['\u7b11\u563b\u4e86', ['\u8fd9\u6bb5\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u770b\u5b8c\u7b11\u563b\u4e86']],
    ['\u9633\u75ff', ['\u4f60\u8fd9\u53d1\u8a00\u771f\u9633\u75ff\uff0c\u522b\u88c5\u4e86']],
    ['\u4f18\u96c5', ['\u4ed6\u786e\u5b9e\u5f88\u4f18\u96c5\u8fd8\u5f88\u53ef\u7231\u5f88\u5e05\u6c14[doge]\u771f\u662f\u5947\u4e86\u602a\u4e86\uff0c\u660e\u660e\u662f\u4e2a\u9ad8\u9ad8\u7626\u7626\u7684\u9ab7\u9ac5\u5934']],
    ['tv\u70b9\u8d5e', ['\u8fd9\u4e2a\u8865\u5145\u5f88\u6709\u7528[tv_\u70b9\u8d5e]\uff0c\u5efa\u8bae\u7f6e\u9876']],
    ['\u4e0b\u996d', ['\u4e0b\u996d\u89c6\u9891', '\u8fd9\u671f\u8282\u76ee\u5f88\u4e0b\u996d\uff0c\u770b\u7740\u8f7b\u677e']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested standalone objection, literal confession, and light praise evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5f02\u8bae',
      family: 'attack',
      meaning: 'hostile objection or challenge',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5f02\u8bae\uff01[doge]',
        '\u6211\u5bb6\u547c\u5438\u6211\u62b1\u8d70\u4e86\u54c8\u6ca1\u5f02\u8bae\u5427',
        '\u5f02\u8bae\uff01\uff08\u5e7b\u542c\uff09',
        '\u4f60\u8fd9\u4e2a\u8bf4\u6cd5\u6211\u6709\u5f02\u8bae\uff0c\u8bc1\u636e\u4e0d\u5bf9',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5fcf\u6094',
      family: 'correction',
      meaning: 'publicly admit fault and repent',
      evidenceCount: 2,
      evidenceSamples: [
        '\u795e\u7236\u542c\u5230\u6740\u4eba\u72c2\u7684\u5fcf\u6094\u540e',
        '\u6211\u9648\u7267\u6e90\u516c\u5f00\u5fcf\u6094',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5764\u5df4',
      family: 'attack',
      meaning: 'vulgar insult or hostile label',
      evidenceCount: 2,
      evidenceSamples: [
        '\u54c8\u54c8\u54c8\u54c8\u8fd9\u662f\u5764\u5df4\u561b',
        '\u8fd9\u4eba\u7d20\u8d28\u771f\u5764\u5df4\u5dee',
      ],
      evidenceSources: [],
    },
    {
      term: '\u751f\u8349',
      family: 'attack',
      meaning: 'mock absurd hostile behavior',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5176\u5b9e\u6f14\u5f97\u4e0d\u9519\uff0c\u5c31\u662f\u6709\u70b9\u751f\u8349\u4e86',
        '\u738b\u8005\u8363\u8000\u4e16\u754c\u751f\u8349',
        '\u4f60\u8fd9\u4e2a\u903b\u8f91\u592a\u751f\u8349\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      ],
      evidenceSources: [],
    },
    {
      term: '\u8349\u751f',
      family: 'cooperation',
      meaning: 'playful meme laughter',
      evidenceCount: 3,
      evidenceSamples: [
        '\u8349\u751f',
        '\u5176\u5b9e\u6f14\u5f97\u4e0d\u9519\uff0c\u5c31\u662f\u6709\u70b9\u751f\u8349\u4e86',
        '\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86',
      ],
      evidenceSources: [],
    },
    {
      term: 'up\u597d\u725b',
      family: 'cooperation',
      meaning: 'useful praise for creator contribution',
      evidenceCount: 3,
      evidenceSamples: [
        '\u54c7 UP\u597d\u725b',
        '\u54c7 UP\u597d\u725b \u52a0\u6cb9\u52a0\u6cb9',
        'up\u597d\u725b\uff0c\u8d44\u6599\u6574\u7406\u5f97\u5f88\u5168',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u5f02\u8bae', ['\u4f60\u8fd9\u4e2a\u8bf4\u6cd5\u6211\u6709\u5f02\u8bae\uff0c\u8bc1\u636e\u4e0d\u5bf9']],
    ['\u5fcf\u6094', ['\u6211\u9648\u7267\u6e90\u516c\u5f00\u5fcf\u6094']],
    ['\u5764\u5df4', ['\u8fd9\u4eba\u7d20\u8d28\u771f\u5764\u5df4\u5dee']],
    ['\u751f\u8349', ['\u4f60\u8fd9\u4e2a\u903b\u8f91\u592a\u751f\u8349\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b']],
    ['\u8349\u751f', ['\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86']],
    ['up\u597d\u725b', ['up\u597d\u725b\uff0c\u8d44\u6599\u6574\u7406\u5f97\u5f88\u5168']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested proper-name and literal setup evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5468\u5904',
      family: 'attack',
      meaning: 'derogatory meme label for a toxic player group',
      evidenceCount: 5,
      evidenceSamples: [
        '\u5468\u5904\u9664\u4e09\u5bb3\uff0c\u8bb2\u7684\u662f\u6709\u4e00\u4e2a\u6751\u6709\u4e2a\u6076\u9738\u53eb\u5468\u5904\u7ecf\u5e38\u6b3a\u8d1f\u5f53\u5730\u767e\u59d3\uff0c\u6709\u4e00\u5e74\u5f53\u5730\u51fa\u73b0\u4e86\u731b\u864e\u548c\u87d2\u86c7\uff0c\u4e8e\u662f\u6751\u91cc\u4eba\u90fd\u8bf4\u8fd9\u4e16\u4e0a\u6709\u4e09\u5bb3',
        '\u5468\u5904\u7ed3\u5c40\u4ee4\u4eba\u550f\u5618\uff0c\u540e\u9762\u53c2\u519b\u5f53\u4e0a\u5c06\u519b\u5e26\u9886\u6570\u5343\u58eb\u5175\u62b5\u6321\u5341\u4e07\u654c\u519b',
        '\u6709\u9690\u55bb\u7684\u4f5b\u6559\u601d\u60f3\uff0c\u8d2a\u55d4\u75f4\u4e2d\u5468\u5904\u662f\u75f4~\u9999\u6e2f\u4ed4\u662f\u55d4~\u90aa\u6559\u5934\u5b50\u662f\u8d2a',
        '\u56de\u590d @\u5f90run\u513f :\u538b\u6839\u5c31\u6ca1\u597d\uff0c\u53ea\u662f\u539f\u592a\u8fc7\u4e8e\u9006\u5929\u3002\u5468\u5904\u591a\u7684\u662f\u3002',
        '\u5468\u5904\u7f8e\u56fd\u5206\u5904',
      ],
      evidenceSources: [],
    },
    {
      term: '\u76ae\u5957',
      family: 'cooperation',
      meaning: 'cooperative discussion about avatar or asset setup',
      evidenceCount: 4,
      evidenceSamples: [
        '\u4f60\u4eec\u5b66\u6821\u6bd4\u6211\u4eec\u597d\uff0c\u8d77\u7801\u6ca1\u6709\u76ae\u5957\u4eba\uff0c\u4e00\u6574\u5929\u5728\u5b66\u6821\u91cc\u6643\u60a0',
        '\u5973\u4e3b\u64ad\u6709\u76ae\u5957\u4eba\u8d5a\u94b1\u5417[\u6c38\u96cf\u5854\u83f2\u00b71883_\u770b\u770b\u4f60\u7684]',
        '\u8fd9\u4e2a\u76ae\u5957\u7d20\u6750\u53ef\u4ee5\u8d34\u51fa\u6765\u7ed9\u5927\u5bb6\u53c2\u8003\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5854\u83f2',
      family: 'cooperation',
      meaning: 'Taffy-related cooperative context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5854\u83f2\u8eab\u4efd\u8bc1\u8981\u8fd9\u6837\uff0c\u65e9\u8d77\u5e94\u8be5\u53bb\u505a\u5973\u4e3b\u64ad\u800c\u4e0d\u662fvtb\u4e86',
        '\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5',
      ],
      evidenceSources: [],
    },
    {
      term: '\u88c5\u4ec0\u4e48',
      family: 'attack',
      meaning: 'accuses someone of posturing',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4e0b\u8f7d\u4e86in\u7684\u683c\u5f0f\u662fvix \u62d6\u5230cad\u663e\u793a\u5b89\u88c5\u5931\u8d25\u624b\u52a8\u5b89\u88c5\u5565\u7684\u600e\u4e48\u5b89 \u535a\u4e3b\u5927\u5927',
        '\u4e0d\u5c31\u662f\u60f3\u8bf4\u4f60\u4eec\u54c1\u5473\u5ba1\u7f8e\u725b\u903c\uff0c\u6770\u4f26\u843d\u4f0d\u4e0d\u5982\u4f60\u4eec\u4e86\u5417\uff1f\u88c5\u4ec0\u4e48\u7c89\u4e1d\u5462\u5728\u8fd9\u3002\u5c31\u4f60\u4e5f\u914d\uff1f',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u5468\u5904', [
      '\u56de\u590d @\u5f90run\u513f :\u538b\u6839\u5c31\u6ca1\u597d\uff0c\u53ea\u662f\u539f\u592a\u8fc7\u4e8e\u9006\u5929\u3002\u5468\u5904\u591a\u7684\u662f\u3002',
      '\u5468\u5904\u7f8e\u56fd\u5206\u5904',
    ]],
    ['\u76ae\u5957', ['\u8fd9\u4e2a\u76ae\u5957\u7d20\u6750\u53ef\u4ee5\u8d34\u51fa\u6765\u7ed9\u5927\u5bb6\u53c2\u8003\u4e00\u4e0b\u5417']],
    ['\u5854\u83f2', ['\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5']],
    ['\u88c5\u4ec0\u4e48', ['\u4e0d\u5c31\u662f\u60f3\u8bf4\u4f60\u4eec\u54c1\u5473\u5ba1\u7f8e\u725b\u903c\uff0c\u6770\u4f26\u843d\u4f0d\u4e0d\u5982\u4f60\u4eec\u4e86\u5417\uff1f\u88c5\u4ec0\u4e48\u7c89\u4e1d\u5462\u5728\u8fd9\u3002\u5c31\u4f60\u4e5f\u914d\uff1f']],
  ]);
});

test('normalizeKeywordEntries prunes standalone and emote-only elegant evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4f18\u96c5',
      family: 'cooperation',
      meaning: 'positive praise for graceful tone or behavior',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5b9e\u540d\u7fa1\u6155up\u8fd9\u6ea2\u51fa\u5c4f\u5e55\u7684\u624d\u534e[\u70b9\u8d5e][\u70b9\u8d5e][\u70b9\u8d5e]\uff0cYYDS\uff01\u5feb\u6765\u4e00\u952e\u4e09\u8fde\u5427[\u70ed\u8bcd\u7cfb\u5217_\u4f18\u96c5]',
        '\u4f18\u96c5',
        '\u4ed6\u786e\u5b9e\u5f88\u4f18\u96c5\u8fd8\u5f88\u53ef\u7231\u5f88\u5e05\u6c14[doge]\u771f\u662f\u5947\u4e86\u602a\u4e86\uff0c\u660e\u660e\u662f\u4e2a\u9ad8\u9ad8\u7626\u7626\u7684\u9ab7\u9ac5\u5934',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u4f18\u96c5', ['\u4ed6\u786e\u5b9e\u5f88\u4f18\u96c5\u8fd8\u5f88\u53ef\u7231\u5f88\u5e05\u6c14[doge]\u771f\u662f\u5947\u4e86\u602a\u4e86\uff0c\u660e\u660e\u662f\u4e2a\u9ad8\u9ad8\u7626\u7626\u7684\u9ab7\u9ac5\u5934']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested celebrity, negated get, and military unit evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6731\u4e00\u9f99',
      family: 'attack',
      meaning: 'negative celebrity object used in fan-war attacks',
      evidenceCount: 5,
      evidenceSamples: [
        '\u7b80\u76f4\u79bb\u8c31\uff0c\u6731\u4e00\u9f99\u8fd8\u4e11\uff1f\u592e\u89c6\u7684\u955c\u5934\u4e0b\u90fd\u5e05\u6210\u90a3\u4e2a\u6837\u5b50\uff0c\u8fd9\u4e16\u754c\u771f\u662f\u766b\u7684\u96be\u4ee5\u60f3\u8c61\u3002',
        '\u5218\u5b87\u5b81\u7684\u8138\u90fd\u80fd\u5938\uff0c\u90a3\u96be\u602a\u89c9\u5f97\u6731\u4e00\u9f99\u4e11\uff0c\u5ba1\u7f8e\uff08\uff1f\uff09\u5dee\u5f02\u592a\u5927\u4e86\u7406\u89e3\u4e00\u4e0b\u5979\u5427[\u5472\u7259]',
        '\u989d\uff01\u6731\u4e00\u9f99\u7684\u5c0f\u516c\u7237\u53ef\u662f\u7f8e\u51fa\u5708\u7684\uff0c\u4f60\u8bf4\u4ed6\u4e11[\u7b11\u54ed][\u7b11\u54ed][\u7b11\u54ed]',
        '\u6731\u4e00\u9f99\u4e0d\u641e\u7b11\u548c\u4ed6\u5f88\u597d\u7b11\u4e0d\u51b2\u7a81\u54c8\u54c8\u54c8',
        '\u6211\u5949\u529d\u6731\u4e00\u9f99\u7c89\u4e1d\u4e00\u53e5\uff0c\u8fd9\u4ef6\u4e8b\u95f9\u5230\u73b0\u5728\u4f60\u5bb6\u88ab\u7fa4\u5632\u5b8c\u5168\u662f\u4f60\u5bb6\u7c89\u4e1d\u81ea\u4f5c\u81ea\u53d7',
      ],
      evidenceSources: [],
    },
    {
      term: 'get\u5230',
      family: 'cooperation',
      meaning: 'expresses understanding or appreciation',
      evidenceCount: 2,
      evidenceSamples: [
        '\u53d1\u73b0\u6211get\u4e0d\u5230\u4ed6\u7684\u989c\uff01\u5c45\u7136\u5165\u5751\u4eba\u54c1\uff01',
        '\u8fd9\u4e2a\u89e3\u91ca\u6211get\u5230\u4e86\uff0c\u8c22\u8c22up',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6b65\u5175',
      family: 'evasion',
      meaning: 'uses foot-soldier metaphor to avoid addressing evidence',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8fd8\u6709\u6700\u91cd\u8981\u7684\u4e00\u70b9\uff0c\u666e\u9c81\u58eb18\u53f7\u6b65\u5175\u8fd8\u79bb\u5f00\u4e86\u6211\u4eec[tv_\u601d\u8003]',
        '\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u8bc1\u636e\u8bf4\u6e05\u695a',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6731\u4e00\u9f99', ['\u6211\u5949\u529d\u6731\u4e00\u9f99\u7c89\u4e1d\u4e00\u53e5\uff0c\u8fd9\u4ef6\u4e8b\u95f9\u5230\u73b0\u5728\u4f60\u5bb6\u88ab\u7fa4\u5632\u5b8c\u5168\u662f\u4f60\u5bb6\u7c89\u4e1d\u81ea\u4f5c\u81ea\u53d7']],
    ['get\u5230', ['\u8fd9\u4e2a\u89e3\u91ca\u6211get\u5230\u4e86\uff0c\u8c22\u8c22up']],
    ['\u6b65\u5175', ['\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u8bc1\u636e\u8bf4\u6e05\u695a']],
  ]);
});

test('normalizeKeywordEntries prunes empty signpost evidence for direction terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6307\u8def',
      family: 'cooperation',
      meaning: 'points readers to a source or reference',
      evidenceCount: 2,
      evidenceSamples: [
        'PS\uff1a\u5728\u672c\u89c6\u9891\u8bc4\u8bba\u533a\u6216\u4e0b\u534a\u90e8\u5206\u8bfe\u7a0b\u8bc4\u8bba\u533a\uff08\u6307\u8defhttps://www.bilibili.com/video/BV1Wq4y1S7Rn\uff09\u6253\u5361\u7686\u53ef',
        '\u5982\u679c\u6709\u540c\u5b66\u60f3\u7ee7\u7eed\u89c2\u770b\u66f4\u65b0\u524d\u7684\u65e7\u7248\u8bfe\u7a0b\uff0c\u6307\u8def\uff1a',
        '\u5317\u65b9\u4eba\u6307\u8def\u4e00\u822c\u90fd\u662f\u4e1c\u5357\u897f\u5317\uff0c\u5e76\u4e0d\u662f\u8001\u4e00\u8f88(',
        '\u5317\u4eac\u8d85\u7ea7\u9002\u5408\u8fd9\u4e48\u6307\u8defhhh',
        '\u5176\u5b9e\u8def\u4e0a\u7684\u6307\u8def\u724c\u6709\u4e1c\u5357\u897f\u5317\u7684',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6307\u8def', ['PS\uff1a\u5728\u672c\u89c6\u9891\u8bc4\u8bba\u533a\u6216\u4e0b\u534a\u90e8\u5206\u8bfe\u7a0b\u8bc4\u8bba\u533a\uff08\u6307\u8defhttps://www.bilibili.com/video/BV1Wq4y1S7Rn\uff09\u6253\u5361\u7686\u53ef']],
  ]);
});

test('normalizeKeywordEntries prunes literal mod item evidence without sharing context', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6a21\u7ec4',
      family: 'cooperation',
      meaning: 'request or share a useful mod',
      evidenceCount: 3,
      evidenceSamples: [
        '\u6211\u53ef\u4ee5\u7ed9\u4e09\u8fde\u4f46\u9996\u5148\u4f60\u4fdd\u8bc1\u4e0d\u4f1a\u62c9\u9ed1\u6211\u3002\u4ee5\u53ca\u9001\u7ed9\u6211\u8fd9\u4e09\u4e2a\u6a21\u7ec4\u3002\u3002',
        '\u6709\u589e\u5f3a\u6a21\u7ec4',
        '\u8fd9\u4e2a\u6a21\u7ec4\u94fe\u63a5\u53ef\u4ee5\u5206\u4eab\u4e00\u4e0b\u5417\uff0c\u6211\u60f3\u590d\u73b0\u8fd9\u4e2a\u95ee\u9898',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6a21\u7ec4', ['\u8fd9\u4e2a\u6a21\u7ec4\u94fe\u63a5\u53ef\u4ee5\u5206\u4eab\u4e00\u4e0b\u5417\uff0c\u6211\u60f3\u590d\u73b0\u8fd9\u4e2a\u95ee\u9898']],
  ]);
});

test('normalizeKeywordEntries prunes platform complaint evidence for youtube source term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6cb9\u7ba1',
      family: 'evidence',
      meaning: 'points to YouTube as an external source',
      evidenceCount: 2,
      evidenceSamples: [
        '\u897f\u65b9\u4eba\u505a\u7684\u8f6f\u4ef6\u5728\u4f7f\u7528\u4e0a\u90fd\u5f88\u5783\u573e\uff0c\u7eaf\u7eaf\u53cd\u4eba\u7c7b\uff0c\u6cb9\u7ba1\u63a8\u7279\u7b80\u76f4\u662f\u6211\u7528\u8fc7\u7684\u6700\u5783\u573e\u7684\u793e\u4ea4\u8f6f\u4ef6',
        '\u8fd9\u4e2a\u5e94\u8be5\u53ef\u4ee5\u5728AOA\u7684\u6cb9\u7ba1\u5b98\u7f51\u4e0a\u4e0b\u52301080P\u7684',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6cb9\u7ba1', ['\u8fd9\u4e2a\u5e94\u8be5\u53ef\u4ee5\u5728AOA\u7684\u6cb9\u7ba1\u5b98\u7f51\u4e0a\u4e0b\u52301080P\u7684']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested literal belief, course, and weak cooperation evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4fe1\u4ef0',
      family: 'attack',
      meaning: 'mocking ideological belief',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5de5\u5320\u590f\u5c14\u592b\u81ea\u6b64\u540e\u6094\u81ea\u5df1\u4fe1\u4ef0\u4e86\u539f\u59cb\u6708\u4eae',
        '\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898',
      ],
      evidenceSources: [],
    },
    {
      term: '\u65b0\u95fb\u5b66\u554a',
      family: 'attack',
      meaning: 'sarcastic attack on media framing',
      evidenceCount: 2,
      evidenceSamples: [
        '\u65b0\u95fb\u5b66\u6982\u8bba80+++',
        '\u8fd9\u79cd\u6807\u9898\u515a\u771f\u662f\u65b0\u95fb\u5b66\u554a\uff0c\u53ea\u8bb2\u7acb\u573a\u4e0d\u8bb2\u8bc1\u636e',
      ],
      evidenceSources: [],
    },
    {
      term: '\u7cef\u4e86',
      family: 'correction',
      meaning: 'softens or backs down from a prior claim',
      evidenceCount: 2,
      evidenceSamples: [
        '\u611f\u89c9\u9ed1\u55d3\u4ece\u8fd9\u91cc\u5f00\u59cb\u5c31\u5f7b\u5e95\u7cef\u4e86\u4e0d\u6562\u627epp\u4e86\u6709\u611f\u89c9\u5417',
        '\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u7cef\u4e86\uff0c\u6536\u56de\u90a3\u53e5',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5b66\u4e60\u4e86',
      family: 'cooperation',
      meaning: 'acknowledges learning from another comment',
      evidenceCount: 3,
      evidenceSamples: [
        '\u6211\u8981\u5b66\u4e60\u4e86',
        '\u8981\u5f00\u59cb\u5b66\u4e60\u4e86',
        '\u8fd9\u4e2a\u65f6\u95f4\u7ebf\u8bb2\u6e05\u695a\u4e86\uff0c\u5b66\u4e60\u4e86',
      ],
      evidenceSources: [],
    },
    {
      term: '\u798f\u745e\u63a7',
      family: 'cooperation',
      meaning: 'furry fan identity',
      evidenceCount: 2,
      evidenceSamples: [
        '\u8981\u6c42\u4e0d\u8ba9\u8bf4\u798f\u745e\uff0c\u90a3\u5fc5\u987b\u8bf4\u798f\u745e',
        '\u798f\u3002\u3002\u3002\u798f\u745e\u63a7\uff1f',
        '\u90a3\u6bb5\u97f3\u4e50\u662f\u7537\u4e3b\u513f\u5b50\u5e72\u7684\uff0c\u7136\u540e\u90a3\u4e2a\u798f\u745e\u63a7\u554a\uff0c\u597d\u50cf\u662f\u4ed6\u540c\u5b66\u53d1\u7ed9\u4ed6\u7684[doge]',
        '\u554a\uff1f\u54c8\u54c8\u4ec0\u4e48\u8ddf\u798f\u745e\u6709\u4ec0\u4e48\u5173\u7cfb\u60f3\u77e5\u9053[\u5403\u74dc]',
        '\u798f\u745e\u63a7\u770b\u5f97\u5f88\u723d\uff0c\u5236\u4f5c\u4e5f\u4e0d\u9519',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u4fe1\u4ef0', ['\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898']],
    ['\u65b0\u95fb\u5b66\u554a', ['\u8fd9\u79cd\u6807\u9898\u515a\u771f\u662f\u65b0\u95fb\u5b66\u554a\uff0c\u53ea\u8bb2\u7acb\u573a\u4e0d\u8bb2\u8bc1\u636e']],
    ['\u7cef\u4e86', ['\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u7cef\u4e86\uff0c\u6536\u56de\u90a3\u53e5']],
    ['\u5b66\u4e60\u4e86', ['\u8fd9\u4e2a\u65f6\u95f4\u7ebf\u8bb2\u6e05\u695a\u4e86\uff0c\u5b66\u4e60\u4e86']],
    ['\u798f\u745e\u63a7', ['\u798f\u745e\u63a7\u770b\u5f97\u5f88\u723d\uff0c\u5236\u4f5c\u4e5f\u4e0d\u9519']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested loose restored-metadata evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u798f\u745e\u63a7',
      family: 'cooperation',
      meaning: 'furry fan identity',
      evidenceCount: 3,
      evidenceSamples: [
        '\u798f\u745e\u63a7\u770b\u7684\u5f88\u723d\u8c22\u8c22\uff0c\u867d\u7136\u5185\u5bb9\u5f88c\u5f88\u523b\u677f\u4f46\u662f\u5236\u4f5c\u7684\u5f88\u4e0d\u9519',
        '\u90a3\u6bb5\u97f3\u4e50\u662f\u7537\u4e3b\u513f\u5b50\u5e72\u7684\uff0c\u7136\u540e\u90a3\u4e2a\u798f\u745e\u63a7\u554a\uff0c\u597d\u50cf\u662f\u4ed6\u540c\u5b66\u53d1\u7ed9\u4ed6\u7684[doge]\u7136\u540e\u4e24\u4e2a\u5408\u6210\u8f7d\u5165',
        '\u554a\uff1f\u54c8\u54c8\u4ec0\u4e48\u8ddf\u798f\u745e\u6709\u4ec0\u4e48\u5173\u7cfb\u60f3\u77e5\u9053[\u5403\u74dc]',
      ],
      evidenceSources: [],
    },
    {
      term: 'cos\u8def\u6613\u5341\u516d',
      family: 'cooperation',
      meaning: 'cosplay comparison to Louis XVI',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6211\uff1a\u8f7b\u5feb\u7ef7\u4f4f\uff0c\u677e\u5f1b\u7ef7\u4f4f\uff0c\u8212\u7f13\u7ef7\u4f4f\uff0c\u5b89\u9038\u7ef7\u4f4f\uff0c\u81ea\u5728\u7ef7\u4f4f',
        '\u8fd9\u4e2a\u5986\u9020\u662f\u5728cos\u8def\u6613\u5341\u516d\uff0c\u6885\u5f00\u4e8c\u5ea6\u4e86',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u798f\u745e\u63a7', ['\u798f\u745e\u63a7\u770b\u7684\u5f88\u723d\u8c22\u8c22\uff0c\u867d\u7136\u5185\u5bb9\u5f88c\u5f88\u523b\u677f\u4f46\u662f\u5236\u4f5c\u7684\u5f88\u4e0d\u9519']],
    ['cos\u8def\u6613\u5341\u516d', ['\u8fd9\u4e2a\u5986\u9020\u662f\u5728cos\u8def\u6613\u5341\u516d\uff0c\u6885\u5f00\u4e8c\u5ea6\u4e86']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested literal mode, commerce, and bare reaction evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask another user to post evidence or context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5176\u5b9e\u706b\u9505\u5e95\u6599\u5efa\u8bae\u5927\u5bb6\u8fd8\u662f\u8981\u4e0d\u6dfb\u6c34\u7684\u60c5\u51b5\u4e0b\u5148\u7092\u5316\u5f00\uff0c\u518d\u52a0\u70ed\u6c34',
        '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6a21\u7ec4',
      family: 'cooperation',
      meaning: 'cooperative game mod discussion',
      evidenceCount: 4,
      evidenceSamples: [
        '\u8fd9\u719f\u6089\u7684\u52a8\u4f5c\u6a21\u7ec4\uff0c\u662f\u4f60Adobe\u7684maximo',
        '\u8fd9\u4e0d\u662f\u594e\u6258\u65af\u7684\u6218\u6597\u6a21\u7ec4\uff1f',
        '\u5176\u4ed6\u89d2\u8272\u6ca1\u505a\u5750\u4e0b\u8fd9\u4e2a\u52a8\u4f5c\u6a21\u7ec4',
        '\u8fd9\u4e2a\u6a21\u7ec4\u94fe\u63a5\u53ef\u4ee5\u5206\u4eab\u4e00\u4e0b\uff0c\u65b9\u4fbf\u5927\u5bb6\u590d\u73b0',
      ],
      evidenceSources: [],
    },
    {
      term: '\u89c6\u9891\u540c\u6b3e',
      family: 'cooperation',
      meaning: 'request or share same item from the video',
      evidenceCount: 2,
      evidenceSamples: [
        '\u300a\u89c6\u9891\u540c\u6b3e\uff0c\u7acb\u5373\u8d2d\u4e70\u300b',
        '\u6c42\u89c6\u9891\u540c\u6b3e\u94fe\u63a5\uff0c\u60f3\u5bf9\u7167\u4e00\u4e0b',
      ],
      evidenceSources: [],
    },
    {
      term: '\u524d\u9762\u8bf4\u91cd\u4e86',
      family: 'correction',
      meaning: 'self-correction after overstating',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4f60\u8fd9\u53e5\u8bdd\u5c31\u8bf4\u9519\u4e86\u5417\uff1f\u600e\u4e48\u4f1a\u6ca1\u6709\u94b1\u554a',
        '\u4f60\u5f97\u8bf4\u900f\u660e\u70b9\uff0c\u4e0d\u7136\u6211\u4e0d\u597d\u56de\u7b54\u4f60\uff0c\u8bf4\u9519\u4e86\u4f60\u4e0d\u9ad8\u5174\u54e6',
        'UP\u4e3b\u8bf4\u9519\u4e86\u554a \u73b0\u5728\u66f4\u706b',
        '\u6211\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6536\u56de\u90a3\u53e5',
      ],
      evidenceSources: [],
    },
    {
      term: '\u6b65\u5175',
      family: 'evasion',
      meaning: 'hide behind a pawn/infantry excuse',
      evidenceCount: 2,
      evidenceSamples: ['\u6c22\u6b65\u5175', '\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u628a\u8bc1\u636e\u8bf4\u6e05\u695a'],
      evidenceSources: [],
    },
    {
      term: '\u6389\u5c0f\u73cd\u73e0',
      family: 'attack',
      meaning: 'mock someone crying',
      evidenceCount: 2,
      evidenceSamples: ['\u6389\u5c0f\u73cd\u73e0\u4e86\uff0c\u545c\u545c', '\u8fd9\u4e2a\u4e0d\u884c\uff0c\u7a7f\u51fa\u6765\u6389\u5c0f\u73cd\u73e0\u7684[tv_\u96be\u8fc7]', '\u4f60\u8fd9\u5c31\u6389\u5c0f\u73cd\u73e0\u4e86\uff0c\u8bc1\u636e\u5462'],
      evidenceSources: [],
    },
    {
      term: '\u5927\u9b54\u6cd5\u5e08',
      family: 'attack',
      meaning: 'mocking celibate wizard label',
      evidenceCount: 2,
      evidenceSamples: ['\u9b54\u6cd5\u5e08\u6218\u888d\uff1f', '\u8fd8\u5dee2\u4e2a\u6708\u5c31\u5927\u9b54\u6cd5\u5e08\u4e86[\u8131\u5355doge]', '\u8868\u9762\u4e0a\u662f\u9b54\u6cd5\u5e08\uff0c\u5b9e\u5730\u5374\u662f\u4e2a\u5c0f\u53d7', '\u4f60\u90fd\u8fd9\u6837\u4e86\u8fd8\u81ea\u79f0\u5927\u9b54\u6cd5\u5e08'],
      evidenceSources: [],
    },
    {
      term: '\u4fe1\u4ef0',
      family: 'attack',
      meaning: 'belief used as shield',
      evidenceCount: 2,
      evidenceSamples: [
        '\u90a3\u65f6\u5019\u7f51\u7edc\u5e76\u4e0d\u53d1\u8fbe\uff0c\u8fd9\u4e5f\u662f\u79cd\u4fe1\u4ef0\u5427\uff0c\u73a9\u7684\u771f\u7684\u5f88\u5f00\u5fc3',
        '\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5976\u51f6',
      family: 'cooperation',
      meaning: 'cute fierce tone',
      evidenceCount: 2,
      evidenceSamples: ['\u57fa\u672c\u4fe1\u606f\u5976\u51f6\u5976\u51f6\u90a3\u5730\u65b9\u7c73\u591a\u9762\u591a\u6469\u767b\u5e74\u4ee3\u5982', '\u8fd9\u53e5\u56de\u590d\u5976\u51f6\u5976\u51f6\u7684\uff0c\u6c14\u6c1b\u7f13\u548c\u4e86'],
      evidenceSources: [],
    },
    {
      term: '\u90fd\u662f\u5bb6\u4eba',
      family: 'cooperation',
      meaning: 'solidarity framing',
      evidenceCount: 2,
      evidenceSamples: ['\u7206\u7b11\u4e86\u5bb6\u4eba\u4eec', '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8bf4'],
      evidenceSources: [],
    },
    {
      term: '\u4e0d\u53ef\u62b5\u6297\u529b',
      family: 'attack',
      meaning: 'mocking unavoidable-force excuse',
      evidenceCount: 2,
      evidenceSamples: ['\u4e0d\u53ef\u6297\u529b\u56e0\u7d20', '\u522b\u628a\u6240\u6709\u5931\u8bef\u90fd\u53eb\u4e0d\u53ef\u62b5\u6297\u529b'],
      evidenceSources: [],
    },
    {
      term: '\u795e\u795e',
      family: 'attack',
      meaning: 'hostile ideological label',
      evidenceCount: 2,
      evidenceSamples: ['\u795e\u795e\u795e', '\u8fd9\u7fa4\u795e\u795e\u53c8\u6765\u6263\u5e3d\u5b50'],
      evidenceSources: [],
    },
    {
      term: '\u7b11\u9ebb\u4e86',
      family: 'attack',
      meaning: 'mocking laughter',
      evidenceCount: 2,
      evidenceSamples: ['\u7b11\u9ebb\u4e86', '\u7b11\u9ebb\u4e86\uff0c\u5c31\u8fd9\u64cd\u4f5c\u8fd8\u5439\u6709\u8bc1\u636e'],
      evidenceSources: [],
    },
    {
      term: '\u6781\u9650\u6a21\u5f0f',
      family: 'cooperation',
      meaning: 'metaphorical hard-mode framing',
      evidenceCount: 2,
      evidenceSamples: ['\u6211\u628a\u5ca9\u6d46\u4e0a\u7684\u65b9\u5757\u6316\u4e86\uff0c\u76f4\u63a5\u6b7b\u4e86\uff0c\u6781\u9650\u6a21\u5f0f', '\u8fd9\u4e2a\u9879\u76ee\u5de5\u671f\u5c31\u662f\u6781\u9650\u6a21\u5f0f\uff0c\u5efa\u8bae\u5148\u62c6\u4efb\u52a1'],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u53ef\u4ee5\u8d34', ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']],
    ['\u6a21\u7ec4', ['\u8fd9\u4e2a\u6a21\u7ec4\u94fe\u63a5\u53ef\u4ee5\u5206\u4eab\u4e00\u4e0b\uff0c\u65b9\u4fbf\u5927\u5bb6\u590d\u73b0']],
    ['\u89c6\u9891\u540c\u6b3e', ['\u6c42\u89c6\u9891\u540c\u6b3e\u94fe\u63a5\uff0c\u60f3\u5bf9\u7167\u4e00\u4e0b']],
    ['\u524d\u9762\u8bf4\u91cd\u4e86', ['\u6211\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6536\u56de\u90a3\u53e5']],
    ['\u6b65\u5175', ['\u522b\u62ff\u6b65\u5175\u5f53\u501f\u53e3\uff0c\u628a\u8bc1\u636e\u8bf4\u6e05\u695a']],
    ['\u6389\u5c0f\u73cd\u73e0', ['\u4f60\u8fd9\u5c31\u6389\u5c0f\u73cd\u73e0\u4e86\uff0c\u8bc1\u636e\u5462']],
    ['\u5927\u9b54\u6cd5\u5e08', ['\u4f60\u90fd\u8fd9\u6837\u4e86\u8fd8\u81ea\u79f0\u5927\u9b54\u6cd5\u5e08']],
    ['\u4fe1\u4ef0', ['\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898']],
    ['\u5976\u51f6', ['\u8fd9\u53e5\u56de\u590d\u5976\u51f6\u5976\u51f6\u7684\uff0c\u6c14\u6c1b\u7f13\u548c\u4e86']],
    ['\u90fd\u662f\u5bb6\u4eba', ['\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8bf4']],
    ['\u4e0d\u53ef\u62b5\u6297\u529b', ['\u522b\u628a\u6240\u6709\u5931\u8bef\u90fd\u53eb\u4e0d\u53ef\u62b5\u6297\u529b']],
    ['\u795e\u795e', ['\u8fd9\u7fa4\u795e\u795e\u53c8\u6765\u6263\u5e3d\u5b50']],
    ['\u7b11\u9ebb\u4e86', ['\u7b11\u9ebb\u4e86\uff0c\u5c31\u8fd9\u64cd\u4f5c\u8fd8\u5439\u6709\u8bc1\u636e']],
    ['\u6781\u9650\u6a21\u5f0f', ['\u8fd9\u4e2a\u9879\u76ee\u5de5\u671f\u5c31\u662f\u6781\u9650\u6a21\u5f0f\uff0c\u5efa\u8bae\u5148\u62c6\u4efb\u52a1']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested bare slogan, school identity, and tool-help evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4e3a\u53d1\u70e7\u800c\u751f',
      family: 'cooperation',
      meaning: 'enthusiast slogan used as constructive praise',
      evidenceCount: 2,
      evidenceSamples: [
        '\u4e3a\u53d1\u70e7\u800c\u751f',
        '\u8fd9\u6b21\u4e3a\u53d1\u70e7\u800c\u751f\u7684\u8bbe\u8ba1\u601d\u8def\u8bb2\u5f97\u5f88\u6e05\u695a',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5b9e\u540d\u5236',
      family: 'cooperation',
      meaning: 'explicitly identify or support a stance',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5e73\u5e84\u77ff\u533a\u7b2c\u4e00\u4e2d\u5b66xx\u5b9e\u540d\u5236\u89c2\u770b',
        '\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790',
      ],
      evidenceSources: [],
    },
    {
      term: '\u5b9e\u540d\u5236\u89c2\u770b',
      family: 'cooperation',
      meaning: 'explicit support by named viewing',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5b9e\u540d\u5236\u7684\u91cd\u8981\u6027\u3002',
        '\u5e73\u5e84\u77ff\u533a\u7b2c\u4e00\u4e2d\u5b66xx\u5b9e\u540d\u5236\u89c2\u770b',
        '\u8fd9\u4e2a\u89c6\u9891\u6211\u5b9e\u540d\u5236\u89c2\u770b\u5e76\u4e14\u4e09\u8fde',
      ],
      evidenceSources: [],
    },
    {
      term: '\u79d1\u5b66\u4e0a\u7f51',
      family: 'evasion',
      meaning: 'dodge evidence by telling others to use circumvention tools',
      evidenceCount: 2,
      evidenceSamples: [
        '\u56fd\u5185\u6709\u4e00\u4e9b\u4e86\uff0c\u79d1\u5b66\u4e0a\u7f51\u53ef\u4ee5\u7528app[doge]',
        '\u522b\u53ea\u8bf4\u79d1\u5b66\u4e0a\u7f51\u81ea\u5df1\u641c\uff0c\u8bc1\u636e\u94fe\u63a5\u5462',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u4e3a\u53d1\u70e7\u800c\u751f', ['\u8fd9\u6b21\u4e3a\u53d1\u70e7\u800c\u751f\u7684\u8bbe\u8ba1\u601d\u8def\u8bb2\u5f97\u5f88\u6e05\u695a']],
    ['\u5b9e\u540d\u5236', ['\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790']],
    ['\u5b9e\u540d\u5236\u89c2\u770b', ['\u8fd9\u4e2a\u89c6\u9891\u6211\u5b9e\u540d\u5236\u89c2\u770b\u5e76\u4e14\u4e09\u8fde']],
    ['\u79d1\u5b66\u4e0a\u7f51', ['\u522b\u53ea\u8bf4\u79d1\u5b66\u4e0a\u7f51\u81ea\u5df1\u641c\uff0c\u8bc1\u636e\u94fe\u63a5\u5462']],
  ]);
});

test('normalizeKeywordEntries prunes latest harvested neutral mentions, bare reactions, and literal food evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6ca1\u6bdb\u75c5\u554a',
      family: 'cooperation',
      meaning: 'agreement with a reasoned point',
      evidenceCount: 2,
      evidenceSamples: ['\u4e5f\u6ca1\u6bdb\u75c5', '\u5c0f\u5218\u8bf4\u7684\u8bdd\u6ca1\u6bdb\u75c5'],
      evidenceSources: [],
    },
    {
      term: '\u4e0d\u5c2c',
      family: 'cooperation',
      meaning: 'reassurance that a reply is not awkward',
      evidenceCount: 2,
      evidenceSamples: ['\u4e0d\u5c2c', '\u8fd9\u6bb5\u56de\u5e94\u4e0d\u5c2c\uff0c\u8bb2\u5f97\u5f88\u6e05\u695a'],
      evidenceSources: [],
    },
    {
      term: '\u60f3\u5200\u4eba',
      family: 'attack',
      meaning: 'directed hostile frustration',
      evidenceCount: 2,
      evidenceSamples: ['\u6211\u771f\u4e0d\u77e5\u9053\u6211\u8be5\u600e\u4e48\u529e\u4e86\uff0c\u8fd9\u51e0\u5929\u53c8\u60f3\u5200\u4eba\uff0c\u597d\u7126\u8651', '\u4f60\u8fd9\u641e\u7b11\u64cd\u4f5c\u770b\u5f97\u6211\u60f3\u5200\u4eba\uff0c\u592a\u4e0d\u6ee1\u4e86'],
      evidenceSources: [],
    },
    {
      term: '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52',
      family: 'cooperation',
      meaning: 'warm creator comeback greeting',
      evidenceCount: 2,
      evidenceSamples: ['\u5931\u8e2a\u4eba\u53e3\u56de\u5f52', '\u7ec8\u4e8e\u56de\u6765\u4e86\uff0c\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\uff0c\u6b22\u8fce'],
      evidenceSources: [],
    },
    {
      term: '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86',
      family: 'cooperation',
      meaning: 'warm creator comeback greeting',
      evidenceCount: 2,
      evidenceSamples: ['\u5931\u8e2a\u4eba\u53e3\u56de\u5f52', '\u597d\u4e45\u4e0d\u89c1\uff0c\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86\uff0c\u60f3\u4f60'],
      evidenceSources: [],
    },
    {
      term: '\u5ddd\u5efa\u56fd',
      family: 'attack',
      meaning: 'mocking Trump nickname',
      evidenceCount: 2,
      evidenceSamples: ['\u90a3\u662f\uff0c\u7279\u6717\u666e\uff1f[\u54e6\u547c]', '\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u6253\u51fb\u5b8c\u6bd5'],
      evidenceSources: [],
    },
    {
      term: '\u5ddd\u666e',
      family: 'attack',
      meaning: 'mocking Trump nickname',
      evidenceCount: 2,
      evidenceSamples: ['\u90a3\u662f\uff0c\u7279\u6717\u666e\uff1f[\u54e6\u547c]', '\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b\uff0c\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f'],
      evidenceSources: [],
    },
    {
      term: '\u8349\u751f',
      family: 'cooperation',
      meaning: 'playful laugh reaction',
      evidenceCount: 2,
      evidenceSamples: ['\u8349\u4e86', '\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86'],
      evidenceSources: [],
    },
    {
      term: '\u7a7a\u8033',
      family: 'cooperation',
      meaning: 'asks for clarification around misheard audio',
      evidenceCount: 2,
      evidenceSamples: ['\u7a7a\u8033\uff1aiPhone 2 iPhone 3', '\u914d\u4e2a\u5b57\u5e55\u5427\u3002\u672c\u6765\u5c31\u53e3\u9f7f\u4e0d\u6e05\u3002\u8fd8\u8ba9\u6211\u4eec\u7a7a\u8033'],
      evidenceSources: [],
    },
    {
      term: '\u7edd\u5bf9\u4e0d\u591f\u7684',
      family: 'absolutes',
      meaning: 'rigid insufficiency claim',
      evidenceCount: 2,
      evidenceSamples: ['\u5c31\u8fd9\u4e00\u7897\u996d\u7edd\u5bf9\u4e0d\u591f\u9971', '\u4f60\u8fd9\u8010\u529b\u662f\u771f\u7684\u5077\uff0c\u7edd\u5bf9\u4e0d\u591f\u7684'],
      evidenceSources: [],
    },
    {
      term: '\u753b\u997c',
      family: 'attack',
      meaning: 'empty promise criticism',
      evidenceCount: 4,
      evidenceSamples: ['\u7b2c\u4e00\u6b21\u770b\u89c1\u753b\u997c\u5f62\u5403\u64ad', '\u753b\u997c\u5145\u9965\u8fd9\u4e00\u5757', '\u753b\u997c\u5145\u9965', '\u4f60\u8fd8\u662f\u6ca1\u61c2\uff0c\u5c31\u662f\u5229\u7528\u4f60\u57fa\u56e0\u6765\u753b\u997c'],
      evidenceSources: [],
    },
    {
      term: '\u4f18\u96c5',
      family: 'cooperation',
      meaning: 'polished reply praise',
      evidenceCount: 2,
      evidenceSamples: ['\u597d\u6b79\u662f\u8364\u7d20\u642d\u914d\u8fd8\u6709\u6c64 \u4f18\u96c5', '\u8fd9\u4e2a\u8868\u8fbe\u786e\u5b9e\u5f88\u4f18\u96c5'],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u6ca1\u6bdb\u75c5\u554a', ['\u5c0f\u5218\u8bf4\u7684\u8bdd\u6ca1\u6bdb\u75c5']],
    ['\u4e0d\u5c2c', ['\u8fd9\u6bb5\u56de\u5e94\u4e0d\u5c2c\uff0c\u8bb2\u5f97\u5f88\u6e05\u695a']],
    ['\u60f3\u5200\u4eba', ['\u4f60\u8fd9\u641e\u7b11\u64cd\u4f5c\u770b\u5f97\u6211\u60f3\u5200\u4eba\uff0c\u592a\u4e0d\u6ee1\u4e86']],
    ['\u5931\u8e2a\u4eba\u53e3\u56de\u5f52', ['\u7ec8\u4e8e\u56de\u6765\u4e86\uff0c\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\uff0c\u6b22\u8fce']],
    ['\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86', ['\u597d\u4e45\u4e0d\u89c1\uff0c\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86\uff0c\u60f3\u4f60']],
    ['\u5ddd\u5efa\u56fd', ['\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u6253\u51fb\u5b8c\u6bd5']],
    ['\u5ddd\u666e', ['\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b\uff0c\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f']],
    ['\u8349\u751f', ['\u8fd9\u4e2a\u8f6c\u573a\u592a\u8349\u751f\u4e86']],
    ['\u7a7a\u8033', ['\u914d\u4e2a\u5b57\u5e55\u5427\u3002\u672c\u6765\u5c31\u53e3\u9f7f\u4e0d\u6e05\u3002\u8fd8\u8ba9\u6211\u4eec\u7a7a\u8033']],
    ['\u7edd\u5bf9\u4e0d\u591f\u7684', ['\u4f60\u8fd9\u8010\u529b\u662f\u771f\u7684\u5077\uff0c\u7edd\u5bf9\u4e0d\u591f\u7684']],
    ['\u753b\u997c', ['\u4f60\u8fd8\u662f\u6ca1\u61c2\uff0c\u5c31\u662f\u5229\u7528\u4f60\u57fa\u56e0\u6765\u753b\u997c']],
    ['\u4f18\u96c5', ['\u8fd9\u4e2a\u8868\u8fbe\u786e\u5b9e\u5f88\u4f18\u96c5']],
  ]);
});

test('normalizeKeywordEntries prunes weak literal ear-misheard notes without request context', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7a7a\u8033',
      family: 'cooperation',
      meaning: 'asks for clarification around misheard audio',
      evidenceCount: 3,
      evidenceSamples: [
        '\u55e8 \u55e8 \u55e8 \u55e8 \u5c0f\u8001\u5f1f\uff5e\uff08\u6307\u7a7a\u8033',
        '\u9ed1\u5361\u8482\uff08\u7a7a\u8033\uff09',
        '\u914d\u4e2a\u5b57\u5e55\u5427\u3002\u672c\u6765\u5c31\u53e3\u9f7f\u4e0d\u6e05\u3002\u8fd8\u8ba9\u6211\u4eec\u7a7a\u8033',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceSamples]), [
    ['\u7a7a\u8033', ['\u914d\u4e2a\u5b57\u5e55\u5427\u3002\u672c\u6765\u5c31\u53e3\u9f7f\u4e0d\u6e05\u3002\u8fd8\u8ba9\u6211\u4eec\u7a7a\u8033']],
  ]);
});

test('normalizeKeywordEntries prunes trump username mention evidence for chuan-jianguo attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5ddd\u5efa\u56fd',
      family: 'attack',
      meaning: 'mocking nickname for Trump',
      evidenceCount: 2,
      evidenceSamples: [
        '@\u7c73\u7c73\u6478\u6478 @\u534a\u95f4dio\u4e8c @Arcue1t @\u5ddd\u666e\u54e51\u53f7 \u80fd\u61c2\u5c31\u80fd\u7b11\uff0c\u4e0d\u7b11\u94c1\u6291\u90c1',
        '\u5efa\u8bbe\u56fd\u5bb6\u7684\u610f\u601d\uff0c\u4f46\u53eb\u5ddd\u5efa\u56fd\u4e0d\u662f\u4e3a\u4e86\u7f8e\u56fd[doge]',
        '\u54c8\u54c8\u54c8 \u4e3a\u6570\u4e0d\u591a\u7684\u641c\u5230\u5ddd\u5efa\u56fd[\u559c\u6781\u800c\u6ce3]',
        '\u5ddd\u666e\u73b0\u5728\u6210\u4e3a\u4e86up\u4e3b\u7684\u5fc3\u5c16\u5ba0[\u5fae\u7b11]',
        '\u597d\u591aup\u56e0\u4e3a\u5ddd\u666e\u90fd\u6da8\u4e86\u597d\u51e0\u5341\u4e07\u7c89[\u7b11\u54ed]',
        '\u4fdd\u62a4\u6211\u65b9\u5ddd\u666e\uff01[\u5999\u554a]',
        '\u91cd\u53d1\u4e86\u53c8\u770b\u4e86\u4e00\u6b21\u53d1\u73b0\u4e00\u4e2a\u5c0fbug\uff1f\u53d6\u666f\u7684\u5730\u8c8c\u975e\u5e38\u5e7f\u897f\uff0c\u4f46\u662f\u65b9\u8a00\u662f\u5ddd\u6e1d\u5730\u533a\u7684\uff0c\u662f\u4e0d\u662f\u56e0\u4e3a\u5e7f\u897f\u7684\u666f\u65e2\u7b26\u5408\u5927\u5bb6\u5bf9\u519c\u6751\u7684\u60f3\u8c61\u53c8\u517c\u5177\u7f8e\u611f\uff0c\u4f46\u65b9\u8a00\u590d\u6742\uff0c\u800c\u5ddd\u666e\u5bf9\u4e8e\u591a\u6570\u4eba\u53c8\u5f88\u5bb9\u6613\u542c\u61c2\u5462',
        '\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u9ad8\u79d1\u6280\u53ca\u519c\u4e1a\u6253\u51fb\u5b8c\u6bd5\uff01',
        '\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b[\u629f\u9f3b]\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '@\u7c73\u7c73\u6478\u6478 @\u534a\u95f4dio\u4e8c @Arcue1t @\u5ddd\u666e\u54e51\u53f7 \u80fd\u61c2\u5c31\u80fd\u7b11\uff0c\u4e0d\u7b11\u94c1\u6291\u90c1' },
        { source: 'Bilibili public video comment scan', sample: '\u5efa\u8bbe\u56fd\u5bb6\u7684\u610f\u601d\uff0c\u4f46\u53eb\u5ddd\u5efa\u56fd\u4e0d\u662f\u4e3a\u4e86\u7f8e\u56fd[doge]' },
        { source: 'Bilibili public video comment scan', sample: '\u54c8\u54c8\u54c8 \u4e3a\u6570\u4e0d\u591a\u7684\u641c\u5230\u5ddd\u5efa\u56fd[\u559c\u6781\u800c\u6ce3]' },
        { source: 'Bilibili public video comment scan', sample: '\u5ddd\u666e\u73b0\u5728\u6210\u4e3a\u4e86up\u4e3b\u7684\u5fc3\u5c16\u5ba0[\u5fae\u7b11]' },
        { source: 'Bilibili public video comment scan', sample: '\u597d\u591aup\u56e0\u4e3a\u5ddd\u666e\u90fd\u6da8\u4e86\u597d\u51e0\u5341\u4e07\u7c89[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u4fdd\u62a4\u6211\u65b9\u5ddd\u666e\uff01[\u5999\u554a]' },
        { source: 'Bilibili public video comment scan', sample: '\u91cd\u53d1\u4e86\u53c8\u770b\u4e86\u4e00\u6b21\u53d1\u73b0\u4e00\u4e2a\u5c0fbug\uff1f\u53d6\u666f\u7684\u5730\u8c8c\u975e\u5e38\u5e7f\u897f\uff0c\u4f46\u662f\u65b9\u8a00\u662f\u5ddd\u6e1d\u5730\u533a\u7684\uff0c\u662f\u4e0d\u662f\u56e0\u4e3a\u5e7f\u897f\u7684\u666f\u65e2\u7b26\u5408\u5927\u5bb6\u5bf9\u519c\u6751\u7684\u60f3\u8c61\u53c8\u517c\u5177\u7f8e\u611f\uff0c\u4f46\u65b9\u8a00\u590d\u6742\uff0c\u800c\u5ddd\u666e\u5bf9\u4e8e\u591a\u6570\u4eba\u53c8\u5f88\u5bb9\u6613\u542c\u61c2\u5462' },
        { source: 'Bilibili public video comment scan', sample: '\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u9ad8\u79d1\u6280\u53ca\u519c\u4e1a\u6253\u51fb\u5b8c\u6bd5\uff01' },
        { source: 'Bilibili public video comment scan', sample: '\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b[\u629f\u9f3b]\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSources.map(source => source.sample), [
    '\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u9ad8\u79d1\u6280\u53ca\u519c\u4e1a\u6253\u51fb\u5b8c\u6bd5\uff01',
  ]);
});

test('normalizeKeywordEntries prunes emote and expression evidence for tv-huaixiao attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: 'tv\u574f\u7b11',
      family: 'attack',
      meaning: 'mischievous emote used sarcastically',
      evidenceCount: 3,
      evidenceSamples: [
        '\u5f00\u670d\u4e4b\u524d\u8fd8\u627e\u8fc7\u4e59\u6e38\u7537\u8054\u52a8\u8fc7\u5462[tv_\u574f\u7b11]https://mp.weixin.qq.com/s/AHcSCzagZ0fvpJBisYGfGw',
        '\u545c\u545c\u545c\uff0c\u6211\u7684\u574f\u7b11[\u5927\u54ed]',
        '\u8fd1\u51e0\u5929\u6765\u770b\u5230\u7f51\u4e0a\u9b54\u6cd5\u5bf9\u8f70\uff0c\u4e00\u4e9bup\u4e3b\u5728\u90a3\u91cc\u80e1\u8bb2\uff0c\u5c31\u662f\u975e\u8822\u65e2\u574f[\u7b11\u54ed]',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5f00\u670d\u4e4b\u524d\u8fd8\u627e\u8fc7\u4e59\u6e38\u7537\u8054\u52a8\u8fc7\u5462[tv_\u574f\u7b11]https://mp.weixin.qq.com/s/AHcSCzagZ0fvpJBisYGfGw' },
        { source: 'Bilibili public video comment scan', sample: '\u545c\u545c\u545c\uff0c\u6211\u7684\u574f\u7b11[\u5927\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u8fd1\u51e0\u5929\u6765\u770b\u5230\u7f51\u4e0a\u9b54\u6cd5\u5bf9\u8f70\uff0c\u4e00\u4e9bup\u4e3b\u5728\u90a3\u91cc\u80e1\u8bb2\uff0c\u5c31\u662f\u975e\u8822\u65e2\u574f[\u7b11\u54ed]' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 0);
  assert.deepEqual(entries[0].evidenceSources, []);
});

test('normalizeKeywordEntries prunes game-reaction evidence for lived-to-the-end cooperation term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u6211\u6d3b\u5230\u5934\u4e86',
      family: 'cooperation',
      meaning: 'exaggerated reaction that one has seen enough',
      evidenceCount: 2,
      evidenceSamples: [
        '\u6d1b\u514b\u738b\u56fd\u51fa\u5927\u53d8\u4e86\uff0c\u770b\u89c1\u8fd9\u4e00\u5730\u9e2d\u795e\u611f\u89c9\u6211\u6d3b\u5230\u5934\u4e86[\u7b11\u54ed]',
        '\u6211\u6d3b\u5230\u5934\u4e86\uff0c\u8c22\u8c22\u4f60\u628a\u6765\u9f99\u53bb\u8109\u8bb2\u6e05\u695a',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u6d1b\u514b\u738b\u56fd\u51fa\u5927\u53d8\u4e86\uff0c\u770b\u89c1\u8fd9\u4e00\u5730\u9e2d\u795e\u611f\u89c9\u6211\u6d3b\u5230\u5934\u4e86[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u6d3b\u5230\u5934\u4e86\uff0c\u8c22\u8c22\u4f60\u628a\u6765\u9f99\u53bb\u8109\u8bb2\u6e05\u695a' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u6211\u6d3b\u5230\u5934\u4e86\uff0c\u8c22\u8c22\u4f60\u628a\u6765\u9f99\u53bb\u8109\u8bb2\u6e05\u695a']);
});

test('normalizeKeywordEntries prunes empathy-only who-understands evidence for evasion term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u8c01\u61c2',
      family: 'evasion',
      meaning: 'appeal to shared understanding instead of explaining',
      evidenceCount: 4,
      evidenceSamples: [
        'up\u4e3b\u957f\u7684\u8fd9\u4e48\u597d\u5374\u6765\u73a9\u62bd\u8c61\u8c01\u61c2',
        '\u5bb6\u4eba\u4eec\uff0c\u8c01\u61c2\u554a\u2197\uff1f\ud83c\udf49',
        '\u8c01\u61c2\u90a3\u79cd\u89c4\u5219\u79e9\u5e8f\u611f\u5f3a\u7684\u4eba\u5c31\u771f\u4f1a\u975e\u5e38\u9075\u5b88\u5e76\u5e0c\u671b\u5f97\u5230\u786e\u5207\u7b54\u590d',
        '\u522b\u95ee\u8bc1\u636e\u4e86\uff0c\u8c01\u61c2\u7684\u90fd\u61c2',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: 'up\u4e3b\u957f\u7684\u8fd9\u4e48\u597d\u5374\u6765\u73a9\u62bd\u8c61\u8c01\u61c2' },
        { source: 'Bilibili public video comment scan', sample: '\u5bb6\u4eba\u4eec\uff0c\u8c01\u61c2\u554a\u2197\uff1f\ud83c\udf49' },
        { source: 'Bilibili public video comment scan', sample: '\u8c01\u61c2\u90a3\u79cd\u89c4\u5219\u79e9\u5e8f\u611f\u5f3a\u7684\u4eba\u5c31\u771f\u4f1a\u975e\u5e38\u9075\u5b88\u5e76\u5e0c\u671b\u5f97\u5230\u786e\u5207\u7b54\u590d' },
        { source: 'Bilibili public video comment scan', sample: '\u522b\u95ee\u8bc1\u636e\u4e86\uff0c\u8c01\u61c2\u7684\u90fd\u61c2' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u522b\u95ee\u8bc1\u636e\u4e86\uff0c\u8c01\u61c2\u7684\u90fd\u61c2']);
});

test('normalizeKeywordEntries prunes broad understands-substring evidence for dong-de-dou-dong', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u61c2\u7684\u90fd\u61c2',
      family: 'evasion',
      meaning: 'implies evidence is unnecessary because insiders know',
      evidenceCount: 4,
      evidenceSamples: [
        'up\u4e3b\u58f0\u97f3\u66f4\u50cfAI\u6709\u6ca1\u6709\u61c2\u7684\uff08\uff09',
        '\u522b\u50bb\u4e86\u65e5\u8bed\u4f60\u770b\u4e0d\u61c2\u7684\uff1a\u201c\u5e1d\u738b\u5207\u5f00\u201d',
        '\u6211\u5c0f\u65f6\u5019\u771f\u7684\u4e00\u770b\u5c31\u61c2\u7684',
        '\u8bc1\u636e\u4e0d\u653e\u4e86\uff0c\u61c2\u7684\u90fd\u61c2',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: 'up\u4e3b\u58f0\u97f3\u66f4\u50cfAI\u6709\u6ca1\u6709\u61c2\u7684\uff08\uff09' },
        { source: 'Bilibili public video comment scan', sample: '\u522b\u50bb\u4e86\u65e5\u8bed\u4f60\u770b\u4e0d\u61c2\u7684\uff1a\u201c\u5e1d\u738b\u5207\u5f00\u201d' },
        { source: 'Bilibili public video comment scan', sample: '\u6211\u5c0f\u65f6\u5019\u771f\u7684\u4e00\u770b\u5c31\u61c2\u7684' },
        { source: 'Bilibili public video comment scan', sample: '\u8bc1\u636e\u4e0d\u653e\u4e86\uff0c\u61c2\u7684\u90fd\u61c2' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u8bc1\u636e\u4e0d\u653e\u4e86\uff0c\u61c2\u7684\u90fd\u61c2']);
});

test('normalizeKeywordEntries prunes neutral trump alias evidence for chuanpu attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5ddd\u666e',
      family: 'attack',
      meaning: 'Trump nickname used in critical contexts',
      evidenceCount: 4,
      evidenceSamples: [
        '\u5ddd\u666e\u73b0\u5728\u6210\u4e3a\u4e86up\u4e3b\u7684\u5fc3\u5c16\u5ba0[\u5fae\u7b11]',
        '\u597d\u591aup\u56e0\u4e3a\u5ddd\u666e\u90fd\u6da8\u4e86\u597d\u51e0\u5341\u4e07\u7c89[\u7b11\u54ed]',
        '\u4fdd\u62a4\u6211\u65b9\u5ddd\u666e\uff01[\u5999\u554a]',
        '\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b[\u629f\u9f3b]\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u5ddd\u666e\u73b0\u5728\u6210\u4e3a\u4e86up\u4e3b\u7684\u5fc3\u5c16\u5ba0[\u5fae\u7b11]' },
        { source: 'Bilibili public video comment scan', sample: '\u597d\u591aup\u56e0\u4e3a\u5ddd\u666e\u90fd\u6da8\u4e86\u597d\u51e0\u5341\u4e07\u7c89[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u4fdd\u62a4\u6211\u65b9\u5ddd\u666e\uff01[\u5999\u554a]' },
        { source: 'Bilibili public video comment scan', sample: '\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b[\u629f\u9f3b]\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u5ddd\u666e\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b[\u629f\u9f3b]\u81ea\u5df1\u6cbb\u4e0d\u4e86\u5c31\u602a\u6e38\u620f']);
});

test('normalizeKeywordEntries prunes literal america-name evidence for ameilika attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u963f\u7f8e\u8389\u5361',
      family: 'attack',
      meaning: 'mocking nickname for America',
      evidenceCount: 4,
      evidenceSamples: [
        '\u963f\u7f8e\u8389\u5361 \u662f\u65e9\u671f\u5bf9\u7f8e\u8054\u90a6\u7684\u7ffb\u8bd1\uff0c\u6b27\u7f57\u5df4 \u662f\u6b27\u6d32\u7684\u7ffb\u8bd1',
        '[\u7b11\u54ed]\u6211\u4e5f\u662f\ud83c\udf08\uff0c\u4f46\u662f\u559c\u6b22\u770bup\u7684\u7f8e\u5229\u575a\u8da3\u95fb[doge]\uff0c\u4e00\u671f\u4e0d\u843d',
        '\u90a3\u65f6\u795d\u798f\u4e0b\u8f88\u5b50\u7f8e\u5229\u575a\u5927\u5bb6\u662f\u771f\u5fc3\u7684',
        '\u963f\u7f8e\u554a\uff0c\u4f60\u592a\u8352\u8c2c\u52d2\uff0c\u8fd9\u6837\u771f\u7684\u4f1a\u5f88\u597d\u7b11',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u963f\u7f8e\u8389\u5361 \u662f\u65e9\u671f\u5bf9\u7f8e\u8054\u90a6\u7684\u7ffb\u8bd1\uff0c\u6b27\u7f57\u5df4 \u662f\u6b27\u6d32\u7684\u7ffb\u8bd1' },
        { source: 'Bilibili public video comment scan', sample: '[\u7b11\u54ed]\u6211\u4e5f\u662f\ud83c\udf08\uff0c\u4f46\u662f\u559c\u6b22\u770bup\u7684\u7f8e\u5229\u575a\u8da3\u95fb[doge]\uff0c\u4e00\u671f\u4e0d\u843d' },
        { source: 'Bilibili public video comment scan', sample: '\u90a3\u65f6\u795d\u798f\u4e0b\u8f88\u5b50\u7f8e\u5229\u575a\u5927\u5bb6\u662f\u771f\u5fc3\u7684' },
        { source: 'Bilibili public video comment scan', sample: '\u963f\u7f8e\u554a\uff0c\u4f60\u592a\u8352\u8c2c\u52d2\uff0c\u8fd9\u6837\u771f\u7684\u4f1a\u5f88\u597d\u7b11' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u963f\u7f8e\u554a\uff0c\u4f60\u592a\u8352\u8c2c\u52d2\uff0c\u8fd9\u6837\u771f\u7684\u4f1a\u5f88\u597d\u7b11']);
});

test('normalizeKeywordEntries prunes literal pig-nose fetish evidence for pig-nose attack term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u732a\u9f3b',
      family: 'attack',
      meaning: 'criticizes someone as acting dumb or making a stupid move',
      evidenceCount: 2,
      evidenceSamples: [
        '\u732a\u9f3b\u5b50\u662f\u4ec0\u4e48\u6027\u7656[\u7b11\u54ed]',
        '\u4f60\u8fd9\u64cd\u4f5c\u771f\u732a\u9f3b\uff0c\u521a\u624d\u90a3\u6ce2\u5c31\u662f\u5728\u72af\u8822',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u732a\u9f3b\u5b50\u662f\u4ec0\u4e48\u6027\u7656[\u7b11\u54ed]' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u8fd9\u64cd\u4f5c\u771f\u732a\u9f3b\uff0c\u521a\u624d\u90a3\u6ce2\u5c31\u662f\u5728\u72af\u8822' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u8fd9\u64cd\u4f5c\u771f\u732a\u9f3b\uff0c\u521a\u624d\u90a3\u6ce2\u5c31\u662f\u5728\u72af\u8822']);
});

test('normalizeKeywordEntries prunes persisted loose reaction evidence for bengbuzhu variants', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7ef7\u4e0d\u4f4f\u4e86',
      family: 'attack',
      meaning: '\u5f62\u5bb9\u770b\u5230\u5bf9\u65b9\u56de\u5e94\u540e\u5fcd\u4e0d\u4f4f\u7b11\u6216\u5d29\u6e83\uff0c\u5e38\u7528\u4e8e\u5632\u8bbd\u6216\u81ea\u5632',
      evidenceCount: 2,
      evidenceSamples: [
        '\u60f3\u5230\u4e00\u4e2a\u7b11\u8bdd\uff1a\u4eba\u4e00\u751f\u7ef7\u4e0d\u4f4f\u7684\u6b21\u6570\u662f\u6709\u9650\u7684\uff0c\u5982\u679c\u4f60\u4ee5\u524d\u7ef7\u4f4f\u4e86\uff0c\u4f60\u8001\u4e86\u4e4b\u540e\u5c31\u4f1a\u53d8\u6210\u7ef7\u7ef7\u70b8\u5f39',
        'Bilibili video context: \u8fd9\u4e0b\u771f\u7206\u4e86\uff01\u73a9\u673a\u5668\u5f39\u5e55\u96be\u7ef7\u9006\u5929\u89e3\u8bf4\u5f53\u573a\u6ca1\u7ef7\u4f4f',
        '\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
      ],
      evidenceSources: [
        {
          source: 'Bilibili public video comment scan',
          sample: '\u60f3\u5230\u4e00\u4e2a\u7b11\u8bdd\uff1a\u4eba\u4e00\u751f\u7ef7\u4e0d\u4f4f\u7684\u6b21\u6570\u662f\u6709\u9650\u7684\uff0c\u5982\u679c\u4f60\u4ee5\u524d\u7ef7\u4f4f\u4e86\uff0c\u4f60\u8001\u4e86\u4e4b\u540e\u5c31\u4f1a\u53d8\u6210\u7ef7\u7ef7\u70b8\u5f39',
        },
        {
          source: 'Bilibili public video context',
          sample: 'Bilibili video context: \u8fd9\u4e0b\u771f\u7206\u4e86\uff01\u73a9\u673a\u5668\u5f39\u5e55\u96be\u7ef7\u9006\u5929\u89e3\u8bf4\u5f53\u573a\u6ca1\u7ef7\u4f4f',
        },
        {
          source: 'Bilibili public video comment scan',
          sample: '\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b',
        },
      ],
    },
  ]);

  assert.deepEqual(entries.map((entry) => entry.evidenceSamples), [['\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b']]);
  assert.deepEqual(entries.map((entry) => entry.evidenceSources.map((source) => source.sample)), [
    ['\u4f60\u8fd9\u903b\u8f91\u771f\u7ef7\u4e0d\u4f4f\u4e86\uff0c\u8bc1\u636e\u90fd\u4e0d\u770b'],
  ]);
  assert.equal(entries[0].evidenceCount, 1);
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
    '\u8fd9\u4e2a\u53d8\u58f0\u5668\u771f\u6ca1\u7ef7\u4f4f\n\u7eed\u822a\u6ca1\u7528\u771f\u7ef7\u4e0d\u4f4f\n\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba',
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

test('findDictionaryEntriesWithTextEvidence maps current zero-evidence aliases back to targets', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '0\u63d0\u5347', family: 'cooperation', meaning: 'claim there is zero improvement' },
        { term: '10\u5e74\u8001\u7c89', family: 'evidence', meaning: 'long-time fan source framing' },
        { term: '12300\u5de5\u4fe1\u90e8\u6295\u8bc9', family: 'evidence', meaning: 'consumer complaint source channel' },
        { term: '2026\u6253\u5361', family: 'evasion', meaning: 'future check-in marker' },
        { term: '\u57c3\u53ca\u5427', family: 'evasion', meaning: 'forum-source reference' },
        { term: '\u7231\u548b\u548b\u5730', family: 'evasion', meaning: 'dismissive let-it-be wording' },
        { term: '\u767e\u5ea6\u767e\u79d1', family: 'evidence', meaning: 'citation to Baidu Baike' },
      ],
    },
    [
      '\u8fd9\u70b9\u786e\u5b9e\u96f6\u63d0\u5347\uff0c\u548c\u4e0a\u6b21\u4e00\u6837',
      '\u6211\u5341\u5e74\u8001\u7c89\u8bf4\u4e00\u53e5\uff0c\u8fd9\u8d44\u6599\u662f\u6709\u6765\u6e90\u7684',
      '\u5b9e\u5728\u4e0d\u884c\u5c31\u625312300\u6295\u8bc9\uff0c\u8d70\u5de5\u4fe1\u90e8\u6295\u8bc9\u6e20\u9053',
      '\u6253\u53612026\uff0c\u5230\u65f6\u5019\u518d\u56de\u6765\u770b',
      '\u4e0d\u89e3\u91ca\u4e86\uff0c\u81ea\u5df1\u53bb\u57c3\u53ca\u5427\u627e\u539f\u5e16',
      '\u968f\u4fbf\u4f60\u7231\u548b\u548b\u5730\uff0c\u53cd\u6b63\u6211\u4e0d\u89e3\u91ca\u4e86',
      '\u767e\u5ea6\u767e\u79d1\u6709\u5199\uff0c\u81ea\u5df1\u770b\u6765\u6e90',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-zero-evidence-alias/',
      uid: 'BV-zero-evidence-alias',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '0\u63d0\u5347',
    '10\u5e74\u8001\u7c89',
    '12300\u5de5\u4fe1\u90e8\u6295\u8bc9',
    '2026\u6253\u5361',
    '\u57c3\u53ca\u5427',
    '\u7231\u548b\u548b\u5730',
    '\u767e\u5ea6\u767e\u79d1',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-zero-evidence-alias'), true);
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

test('findDictionaryEntriesWithTextEvidence maps loaded dice title wording back to sentence terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', family: 'attack', meaning: 'loaded sieve metaphor' },
        { term: '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5', family: 'attack', meaning: 'loaded dice metaphor' },
      ],
    },
    [
      '\u8fd9\u628a\u771f\u7684\u50cf\u704c\u94c5\u7b5b\u5b50\uff0c\u600e\u4e48\u6447\u90fd\u51fa\u8fd9\u4e2a\u7ed3\u679c',
      '\u704c\u94c5\u9ab0\u5b50\u80fd\u4e0d\u80fd\u522b\u518d\u6765\u4e86\uff0c\u6982\u7387\u592a\u79bb\u8c31',
    ].join('\n'),
    {
      source: 'Bilibili public search-discovered video comment scan plus video context: https://www.bilibili.com/video/BV-loaded-dice/',
      uid: 'BV-loaded-dice',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5',
    '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-loaded-dice'), true);
});

test('findDictionaryEntriesWithTextEvidence maps obfuscated and corrected wording back to weak terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u5de5\u91cdhao', family: 'evasion', meaning: 'obfuscated public-account plug' },
        { term: '\u516c\u5f0f\u5957\u53cd\u4e86', family: 'correction', meaning: 'formula applied backwards correction' },
        { term: '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af', family: 'attack', meaning: 'fandom sarcasm harvest meme' },
        { term: '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728', family: 'attack', meaning: 'weaponized floating-log criticism' },
        { term: '\u72d7\u5c4e\u673a\u5236', family: 'attack', meaning: 'bad game mechanism complaint' },
        { term: '\u82df\u76841b', family: 'attack', meaning: 'overly passive play insult' },
        { term: '\u53e4\u5c38\u7ea7', family: 'attack', meaning: 'old fossil level insult variant' },
        { term: '\u62d0\u53cb\u5546', family: 'evasion', meaning: 'drag competitor comparison into the topic' },
        { term: '\u5173\u4e86\u5427', family: 'attack', meaning: 'dismiss content as worth shutting down' },
        { term: '\u5173\u4e86\u5427\u6ca1\u610f\u601d', family: 'attack', meaning: 'dismiss content as boring and should close' },
        { term: '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19', family: 'cooperation', meaning: 'push back on Guangxi stereotype' },
        { term: '\u8d35\u5bbe\u5f52\u96f6', family: 'attack', meaning: 'mock streamer viewer count dropping to zero' },
        { term: '\u56fd\u9645\u5b85\u7537\u8054\u76df', family: 'attack', meaning: 'joking faction alliance call' },
      ],
    },
    [
      '\u4ed6\u8fd8\u5728\u8bc4\u8bba\u91cc\u7559\u5de5\u91cd\u53f7\u5f15\u6d41\uff0c\u8fd9\u79cd\u522b\u5f53\u771f',
      '\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86\uff0c\u4e0d\u662f\u8fd9\u4e48\u5957\u7684',
      '\u6211\u5bb6\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86\u54e6\uff0c\u8fd8\u771f\u5f00\u59cb\u63d2\u79e7\u4e86',
      '\u6bcf\u4e2a\u6d6e\u6728\u4fa0\u7684\u80cc\u540e\u90fd\u662f\u88ab\u903c\u65e0\u5948\uff0c\u62ff\u8d77\u8f6e\u6905\u53cd\u51fb',
      '\u738b\u8005\u8fd9\u72d7\u5c4e\u5339\u914d\u673a\u5236\u771f\u5e26\u4e0d\u52a8',
      '\u8fd9\u4eba\u6253\u6cd5\u592a\u82df\u4e86\uff0c\u82df\u52301b',
      '\u9aa8\u7070\u7ea7\u8001\u73a9\u5bb6\u90fd\u770b\u4e0d\u4e0b\u53bb\u4e86',
      '\u62ffDNF\u6765\u62d0\u90a3\u80fd\u4e00\u6837\u5417\uff0c\u53cb\u5546\u56f4\u730e\u53c8\u6765\u4e86',
      '\u8fd9\u6d3b\u5173\u4e86\u5427\uff0c\u771f\u6ca1\u5fc5\u8981\u7ee7\u7eed',
      '\u8fd9\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d\uff0c\u8bc4\u8bba\u533a\u90fd\u770b\u817b\u4e86',
      '\u522b\u523b\u677f\u5370\u8c61\u4e86\uff0c\u5e7f\u897f\u4eba\u4e5f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19',
      '\u798f\u888b\u4e00\u505c\u8d35\u5bbe\u5f52\u96f6\uff0c\u76f4\u64ad\u95f4\u7acb\u523b\u6ca1\u4eba\u4e86',
      '\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df\u5427\uff0c\u662f\u65f6\u5019\u51fa\u5175\u5f81\u670d\u7f8e\u56fd\u4e86',
    ].join('\n'),
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-obfuscated-correction/',
      uid: 'BV-obfuscated-correction',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), [
    '\u5de5\u91cdhao',
    '\u516c\u5f0f\u5957\u53cd\u4e86',
    '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af',
    '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728',
    '\u72d7\u5c4e\u673a\u5236',
    '\u82df\u76841b',
    '\u53e4\u5c38\u7ea7',
    '\u62d0\u53cb\u5546',
    '\u5173\u4e86\u5427',
    '\u5173\u4e86\u5427\u6ca1\u610f\u601d',
    '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19',
    '\u8d35\u5bbe\u5f52\u96f6',
    '\u56fd\u9645\u5b85\u7537\u8054\u76df',
  ]);
  assert.equal(entries.every((entry) => entry.evidenceSources[0].uid === 'BV-obfuscated-correction'), true);
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

test('findDictionaryEntriesWithTextEvidence rejects homophone typo game-location evidence for despair attack terms', () => {
  const entries = findDictionaryEntriesWithTextEvidence(
    {
      entries: [
        { term: '\u543e\u547d\u4f11\u77e3', family: 'attack', meaning: 'despair catchphrase used as sarcastic attack' },
        { term: '\u65e0\u547d\u4fee\u77e3', family: 'attack', meaning: 'homophone typo for the same despair catchphrase' },
      ],
    },
    '\u543e\u547d\u4f11\u77e3\uff0c\u4e00\u4e2a\u5728\u8681\u7a74\uff0c\u4e00\u4e2a\u5728\u51b0\u5c01\u738b\u5ea7\uff0c\u8fd8\u6709\u4e00\u4e2a\u5728\u7f8e\u4eba\u9c7c\u5c9b\u7684\u7814\u7a76\u6240\u91cc\uff0c\u7814\u7a76\u6240\u91cc\u9762\u6709\u4e00\u4e2a\u516b\u89d2\u7b3c\uff0c\u90a3\u4f1a\u5237\u65e0\u547d\u4fee\u77e3[\u6253call][\u6253call][\u6253call]',
    {
      source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-homophone-attack/',
      uid: 'BV-homophone-attack',
    },
  );

  assert.deepEqual(entries.map((entry) => entry.term), []);
});

test('findDictionaryEntriesWithTextEvidence rejects literal self gacha context for gambler-mentality attack terms', () => {
  const dictionary = {
    entries: [
      { term: '\u8d4c\u5f92\u5fc3\u7406', family: 'attack', meaning: '\u6307\u8d23\u5bf9\u65b9\u7528\u8d4c\u5f92\u5fc3\u6001\u8fa9\u62a4\u6216\u505a\u5224\u65ad' },
    ],
  };

  const literalMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u8d4c\u5f92\u5fc3\u7406\u548b\u90a3\u4e48\u50cf\u6211\u62bd\u5361\u65f6\u5019\u7684\u611f\u89c9\uff0c\u603b\u89c9\u5f97\u4e0b\u4e00\u53d1\u5fc5\u51fa\uff0c\u7ed3\u679c\u2026',
    { source: 'Bilibili public video comment scan', uid: 'BVliteral' },
  );
  const hostileMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u8fd9\u5c31\u662f\u5178\u578b\u8d4c\u5f92\u5fc3\u7406\uff0c\u8f93\u4e86\u8fd8\u62ff\u8fd9\u5957\u903b\u8f91\u6d17\u5730\u3002',
    { source: 'Bilibili public video comment scan', uid: 'BVhostile' },
  );

  assert.deepEqual(literalMatches.map((entry) => entry.term), []);
  assert.deepEqual(hostileMatches.map((entry) => entry.term), ['\u8d4c\u5f92\u5fc3\u7406']);
});

test('findDictionaryEntriesWithTextEvidence rejects self-quoted meme context for careless-no-flash attack terms', () => {
  const dictionary = {
    entries: [
      { term: '\u5927\u610f\u4e86', family: 'attack', meaning: '\u501f\u68d7\u6307\u8d23\u5bf9\u65b9\u8f7b\u654c\u6216\u7ffb\u8f66' },
      { term: '\u5927\u610f\u4e86\u6ca1\u6709\u95ea', family: 'attack', meaning: '\u501f\u68d7\u6307\u8d23\u5bf9\u65b9\u8f7b\u654c\u6216\u7ffb\u8f66' },
    ],
  };

  const memeMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u6211\u5f53\u65f6\u5927\u610f\u4e86\uff0c\u6ca1\u6709\u5e26\u95ea[doge][doge]',
    { source: 'Bilibili public video comment scan', uid: 'BVmeme' },
  );
  const hostileMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u4f60\u8fd9\u6ce2\u5c31\u662f\u5927\u610f\u4e86\uff0c\u88ab\u4eba\u6253\u7206\u8fd8\u786c\u6d17\u3002',
    { source: 'Bilibili public video comment scan', uid: 'BVhostile' },
  );

  assert.deepEqual(memeMatches.map((entry) => entry.term), []);
  assert.deepEqual(hostileMatches.map((entry) => entry.term), ['\u5927\u610f\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects name-substring evidence for follow-power cooperation terms', () => {
  const dictionary = {
    entries: [
      { term: '\u5173\u6ce8\u529b', family: 'cooperation', meaning: '\u8868\u793a\u5173\u6ce8\u6216\u652f\u6301UP\u4e3b\u7684\u53e3\u8bed\u8868\u8fbe' },
    ],
  };

  const nameMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u5f88\u65e9\u5c31\u5173\u6ce8\u529b\u5143\u541b\u4e86\uff0c\u6ca1\u60f3\u5230\u80fd\u6709\u97f3\u4e50\u65b9\u9762\u7684\u78b0\u649e\u3002',
    { source: 'Bilibili public video comment scan', uid: 'BVname' },
  );
  const supportMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u4f18\u8d28up\uff0c\u5173\u6ce8\u529b[\u5999\u554a]',
    { source: 'Bilibili public video comment scan', uid: 'BVsupport' },
  );

  assert.deepEqual(nameMatches.map((entry) => entry.term), []);
  assert.deepEqual(supportMatches.map((entry) => entry.term), ['\u5173\u6ce8\u529b']);
});

test('findDictionaryEntriesWithTextEvidence rejects literal traditional-character descriptions for video-language attack terms', () => {
  const dictionary = {
    entries: [
      { term: '\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57', family: 'attack', meaning: '\u7528\u7e41\u4f53\u5b57\u6307\u8d23UP\u4e3b\u6216\u8d34\u6807\u7b7e' },
    ],
  };

  const literalMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u533b\u53e4\u6587 \u4e00\u672c\u6559\u6750\u9664\u4e86\u5e8f\u8a00\u5168\u662f\u7e41\u4f53\u5b57\u3002\u54ed\u8fbd',
    { source: 'Bilibili public video comment scan', uid: 'BVliteral' },
  );
  const attackMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    'UP\u662f\u9999\u6e2f\u4eba\u5417\uff1f\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57\u3002\u53bb\u77ed\u89c6\u9891\u5e73\u53f0\u53d1\u5427\uff0c\u963fB\u8fd9\u8fb9\u4e0d\u592a\u597d\u9a97',
    { source: 'Bilibili public video comment scan', uid: 'BVattack' },
  );

  assert.deepEqual(literalMatches.map((entry) => entry.term), []);
  assert.deepEqual(attackMatches.map((entry) => entry.term), ['\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57']);
});

test('findDictionaryEntriesWithTextEvidence rejects negated conversion evidence for reform cooperation terms', () => {
  const dictionary = {
    entries: [
      { term: '\u6539\u90aa\u5f52\u6b63', family: 'cooperation', meaning: '\u8868\u793a\u5bf9\u65b9\u6216\u81ea\u5df1\u884c\u4e3a\u8f6c\u5411\u66f4\u597d\u7684\u8ba4\u53ef' },
    ],
  };

  const negatedMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u5e76\u975e\u6539\u90aa\u5f52\u6b63',
    { source: 'Bilibili public video comment scan', uid: 'BVnegated' },
  );
  const positiveMatches = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u90fd\u662f\u8fc7\u6765\u4eba\uff0c\u54e5\u6df1\u6709\u4f53\u4f1a\u3002\u73b0\u5df2\u6539\u90aa\u5f52\u6b63',
    { source: 'Bilibili public video comment scan', uid: 'BVpositive' },
  );

  assert.deepEqual(negatedMatches.map((entry) => entry.term), []);
  assert.deepEqual(positiveMatches.map((entry) => entry.term), ['\u6539\u90aa\u5f52\u6b63']);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested literal and username false positives', () => {
  const dictionary = {
    entries: [
      { term: 'wdnmd', family: 'attack', meaning: 'Chinese internet insult shorthand' },
      { term: '\u8bf4\u6b7b\u4e86', family: 'attack', meaning: 'shut down discussion by declaring a person or argument dead' },
      { term: '\u5173\u4e86\u5427\u6ca1\u610f\u601d', family: 'attack', meaning: 'dismissively tell a creator to shut down because content is boring' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
      { term: '\u4fe1\u4ef0', family: 'attack', meaning: 'mocking ideological belief' },
      { term: '\u795e\u795e', family: 'attack', meaning: 'mocking ideological extremist label' },
      { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'self-correction or softening prior claim' },
      { term: '\u732a\u9f3b', family: 'attack', meaning: 'insulting pig-nose label' },
      { term: '\u5ddd\u5efa\u56fd', family: 'attack', meaning: 'Trump-related political nickname used as attack' },
      { term: '\u53ea\u53ef\u610f\u4f1a', family: 'evasion', meaning: 'avoid explaining by saying it can only be intuited' },
      { term: '\u53bb\u641c', family: 'evasion', meaning: 'dismissively tell another user to search for themselves' },
      { term: '\u9633\u5bff', family: 'cooperation', meaning: 'playful Bilibili cost-of-luck meme' },
    ],
  };
  const text = [
    '\u56de\u590d @lbwnbVSwdnmd :\u5e72\u7ffb\u6c34\u86ed\u8fd9\u4e00\u5757',
    '\u5e76\u975e\u98ce\u58f0\uff0c\u662f\u771f\u6709\u4eba\u8bf4\u51fa\u6765\u4ed6\u6b7b\u4e86\uff0c\u8bc4\u8bba\u533a\u7f6e\u9876\u90a3\u5f20\u56fe\u5c31\u662f\u3002',
    '\u6ca1\u5fc5\u8981\u7684\uff0c\u6444\u50cf\u5934\u5173\u4e86\u5427',
    '\u6444\u50cf\u5934\u5173\u4e86\u5427\u6c42\u6c42\u4e86',
    '\u5c31\u662f\u6c14\u4e0a\u6765\u5c31\u4e00\u4e0b\u5b50\u53d1\u51fa\u6765\u4e86\uff0c\u6ca1\u6709\u7406\u7531',
    '\u51e0\u5e74\u524d\u4e5f\u5f88\u591av\u6216\u8005\u4e3b\u64ad\u8bf4\u662f\u4e0d\u770b\u793e\u5a92\u4e0d\u770b\u8bba\u575b\u8d34\u5427wb\uff0c\u7ed3\u679c99%\u5728\u770b\u800c\u4e14\u8fd8\u7279\u522b\u5728\u610f\u6700\u540e\u76f4\u64ad\u7206\u53d1\u51fa\u6765[\u7b11\u54ed]',
    '\u4ee5\u53ca\u5982\u679c\u6211\u4e2d\u4e8c\u75c5\u65f6\uff0c\u4e5f\u8bf4\u6211\u662f\u4e2aDID\uff0c\u6211\u4e5f\u5f55\u8fc7\u89c6\u9891\uff0c\u53ea\u4e0d\u8fc7\u6ca1\u6709\u53d1\u51fa\u6765\u3002',
    '\u4fe1\u4ef0',
    '\u662f\u7684\u5f02\u5730\u604b\u4e45\u4e86\u5979\u5c31\u5728\u5fc3\u91cc\u88ab\u795e\u5316\u6210\u4fe1\u4ef0\u4e86',
    '\u8fd9\u90e8\u5267\u8ddf\u6cf0\u56fd\u6709\u90e8\u5267\u60c5\u5f88\u50cf\u4e5f\u662f\u6d89\u53ca\u4fe1\u4ef0\u9644\u8eab\u4e4b\u7c7b\u7684',
    '\u80a5\u795e\u795e\u4e86[\u661f\u661f\u773c]',
    '\u795e\u4e2d\u795e\u795e\u4e2d\u795e\uff0c\u6700\u5f3a\u7684\u4e00\u4e2a\u3002',
    '\u770b\u4e0d\u61c2\uff0c\u795e\u795e\u53e8\u53e8\u7684',
    '\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e\u795e',
    '\u4e0d\u6562\u8bf4\u91cd\u4e86\uff0c\u7ed9\u6c14\u6b7b\u4e86',
    '\u4f60\u770b\u672c\u5730\u4eba\u591a\u4e56 \u77e5\u9053\u8bf4\u9519\u8bdd\u7684\u540e\u679c',
    '\u4eba\u7d27\u5f20\u7684\u65f6\u5019\u662f\u5bb9\u6613\u8ba4\u9519\u4eba\uff0c\u6211\u5c31\u5f88\u5bb9\u6613\u7d27\u5f20\uff0c\u4e00\u7d27\u5f20\u5c31\u8ba4\u9519\u4eba\u8bf4\u9519\u8bdd',
    '\u8fd9\u4e2a\u8d5b\u5b63\u662f24\u6625\u72fc\u593a\u51a0\u4e86\uff0c\u5f52\u671f\u6ca1\u8bf4\u9519\u8fd8\u771f\u85cf\u4e86',
    '\u76f4\u63a5\u8d70\u53cd\u9988\u5c31\u884c\u4e86\uff0c\u53d1\u51fa\u6765\u6559\u5506\u5927\u5bb6\u4e00\u8d77\u6765\u5361\u660e\u663e\u662f\u72af\u4e86\u4e8b\u60f3\u627e\u4eba\u4e00\u8d77\u625b\u3002',
    '\u201c\u8fd9\u4e2a\u732a\u9f3b\u5b50\u662f\u5e72\u4ec0\u4e48\u7528\u7684\u6765\u7740\uff1f\u201d',
    '\u6211\u4ee5\u4e3a\u5c31\u662f\u4e2a\u732a\u9f3b',
    '\u8fd9\u662f\u53cc\u7f1d\u5e72\u6d89\u732a\u9f3b\u5b50 \u4f60\u7528\u5b83\u5b83\u5c31\u6709\u7528 \u4f60\u4e0d\u7528\u5b83\u5c31\u6ca1\u7528',
    '\u4eba\u5bb6\u8bf4\u7684\u662f\u6253\u7535\u8bdd\u7684\u662f\u738b\u5efa\u56fd\uff0c\u88c5\u4ec0\u4e48\u5927\u660e\u767d',
    '\u5efa\u56fd\u540c\u5fd7',
    '\u6211\u8bb0\u5f97\u5915\u9633\u7279\u522b\u559c\u6b22tf30\uff0c\u4e0a\u773c\u662f\u6a31\u82b1\u7c89\u8272\u3002\u5979\u8bd5\u8272tf42\u7684\u6548\u679c\u4e5f\u662f\u5f88\u660e\u5a9a\u7684\u7c89\u8272\u3002\u4f46\u6211\u752830\u5728\u6211\u8138\u4e0a\u5c31\u662f\u6a58\u7c89\uff0c\u7528\u90a3\u9897\u767d\u8272\u6253\u5e95\u80fd\u591a\u4e00\u4e9b\u7c89\u8272\u5427\u4f46\u4e5f\u662f\u53ea\u53ef\u610f\u4f1a\u4e0d\u53ef\u8a00\u4f20\u7684\u6548\u679c\u3002',
    '\u662f\u4ed6\u4eec\u8bed\u8a00\u8868\u8fbe\u65b9\u5f0f\u843d\u540e\uff0c\u4ee5\u81f3\u4e8e\u6211\u4eec\u8981\u53bb\u641c\u7d22\u624d\u80fd\u660e\u767d\u8fd9\u4e2a\u7b80\u5355\u610f\u601d',
    '\u7b54\uff1a\u4f60\u4eec\u7528\u81ea\u5df1\u9633\u5bff\u62bd\u5c31\u884c\u4e86\uff0c\u6211\u7528\u4f60\u4eec\u7684doge',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, text);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u64cd\u4f5cwdnmd\uff0c\u522b\u518d\u9a82\u4eba\u4e86',
      '\u4ed6\u53c8\u662f\u4e00\u53e5\u8bdd\u628a\u8ba8\u8bba\u8bf4\u6b7b\u4e86\uff0c\u6839\u672c\u4e0d\u7ed9\u8bc1\u636e',
      '\u8fd9\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d\uff0c\u522b\u518d\u64ad\u4e86',
      '\u4f60\u628a\u8bc1\u636e\u94fe\u63a5\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      '\u4ed6\u62ff\u4fe1\u4ef0\u5f53\u514d\u6b7b\u91d1\u724c\uff0c\u5c31\u662f\u4e0d\u56de\u5e94\u95ee\u9898',
      '\u522b\u518d\u7528\u795e\u795e\u90a3\u5957\u8bdd\u672f\u6263\u5e3d\u5b50\u4e86',
      '\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u6536\u56de\u521a\u624d\u90a3\u53e5',
      '\u4f60\u8fd9\u6ce2\u732a\u9f3b\u64cd\u4f5c\u5c31\u662f\u5f53\u65f6\u72af\u8822',
      '\u5ddd\u5efa\u56fd\uff1a\u62a5\u544a\u7ec4\u7ec7\uff01\u53c8\u6765\u590d\u8bfb\u90a3\u5957\u8bdd\u672f',
      '\u522b\u53ea\u8bf4\u53ea\u53ef\u610f\u4f1a\uff0c\u8bc1\u636e\u548c\u903b\u8f91\u5462',
      '\u4f60\u4e0d\u4f1a\u81ea\u5df1\u53bb\u641c\u5417\uff0c\u522b\u95ee\u6211',
      '\u8c22\u8c22\u4f60\u7528\u9633\u5bff\u6362\u6765\u7684\u62bd\u5361\u7ecf\u9a8c\uff0c\u6211\u660e\u767d\u4e86',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    'wdnmd',
    '\u8bf4\u6b7b\u4e86',
    '\u5173\u4e86\u5427\u6ca1\u610f\u601d',
    '\u53ef\u4ee5\u8d34',
    '\u4fe1\u4ef0',
    '\u795e\u795e',
    '\u524d\u9762\u8bf4\u91cd\u4e86',
    '\u732a\u9f3b',
    '\u5ddd\u5efa\u56fd',
    '\u53ea\u53ef\u610f\u4f1a',
    '\u53bb\u641c',
    '\u9633\u5bff',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested tool and generic job false positives', () => {
  const dictionary = {
    entries: [
      { term: '找个班上', family: 'attack', meaning: 'dismissively tell someone to get a job instead of posting' },
      { term: '截图', family: 'evidence', meaning: 'ask for or provide screenshot evidence' },
      { term: '浏览器搜', family: 'evidence', meaning: 'ask someone to verify a claim by searching in a browser' },
      { term: '怪我咯', family: 'correction', meaning: 'accept blame or correct a previous mistake' },
    ],
  };

  const falsePositiveText = [
    '找2500的前台被拒了，感觉现在符合“随便找个班上”这个词的只有进厂了，服务员要有经验，摇奶茶卡年龄并且也要经验',
    '工具自带的api免费使用，界面还挺好看，适用于对界面有一定要求，并且此类工具不多的用户，截图+OCR+翻译，好像就这三个功能',
    '感谢~~vivo x2oo pro 搭配华为运动健康也能截图。：）',
    '打开图片，里面有个screenshots文件夹，屏幕截图在那里面',
    '浏览器搜索Ttime，免费获取，不花钱',
    '整天靠着在影视剧里贬低亚裔男性，搞得自己都信了，这会儿接受不了现实也只能无能狂怒[怪我咯]',
    '说起来容易，实际上很难的。当你看着自己的钱来得这么容易的时候，总是希望自己可以多赚一点，人贪婪的的本性也就显现了，慢慢的，一开始可能还赢点钱，后面全部输回去，而且是有八九会倒贴，我就是，所以说很多道理看起来简单，做起来的时候才知道有多难[怪...',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '没活就找个班上，别天天在评论区发癫',
      '把聊天截图和来源贴一下',
      '你用浏览器搜一下原文来源，别只发截图',
      '怪我咯，前面看错了我收回',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '找个班上',
    '截图',
    '浏览器搜',
    '怪我咯',
  ]);
});

test('mergeEntriesIntoDictionary prunes persisted truncated emote reaction evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-truncated-emote-reaction-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '怪我咯',
            family: 'correction',
            meaning: 'accept blame or correct a previous mistake',
            evidenceCount: 1,
            evidenceSamples: [
              '说起来容易，实际上很难的。当你看着自己的钱来得这么容易的时候，总是希望自己可以多赚一点，人贪婪的的本性也就显现了，慢慢的，一开始可能还赢点钱，后面全部输回去，而且是有八九会倒贴，我就是，所以说很多道理看起来简单，做起来的时候才知道有多难[怪...',
            ],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });
    const entry = dictionary.entries.find((item) => item.term === '怪我咯');

    assert.deepEqual(entry.evidenceSamples, []);
    assert.equal(entry.evidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested substring and generic cooperation false positives', () => {
  const dictionary = {
    entries: [
      { term: '皮套', family: 'cooperation', meaning: 'cooperative discussion about avatar or asset setup' },
      { term: '模组', family: 'cooperation', meaning: 'cooperative game mod discussion' },
      { term: '小受', family: 'attack', meaning: 'derogatory label' },
      { term: '如果有', family: 'cooperation', meaning: 'conditional openness to evidence' },
      { term: '可以贴', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
    ],
  };
  const falsePositiveText = [
    '这集除了艾斯，其他奥特兄弟的皮套好新，有这钱为什么不给雷欧整套好一点的皮套？好好打磨剧情不好吗？非要整烂活[尴尬]，还把奥兄的人设给毁了',
    '你说的视频里面完全没有说明任务，破坏，惊变100天的内容，就用的烦村和击杀计分模组重了，怎么就认为是搬运呢[喜极而泣]',
    '我们从小受到的教育让我们看待事情很简单粗暴，非黑即白。',
    '如果有可能，我倒是宁愿傻呵呵的过一生，不要这么多体验和顿悟',
    '但如果有一天她遇到了线下的情绪，她表现出来的是和线上其实差不多，旁人只能发现她难受痛苦，然而这一次是真正吃到苦头了。',
    '在这个基础，就可以发现，野核并不等于刺客，蓝领并不等于坦克。',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '这个皮套素材可以贴出来给大家参考一下吗',
      '这个模组链接可以分享一下，方便大家复现',
      '别拿小受这种词骂人，先说事实',
      '如果有原始数据我愿意改结论',
      '你把证据截图可以贴一下吗',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '皮套',
    '模组',
    '小受',
    '如果有',
    '可以贴',
  ]);
});

test('mergeEntriesIntoDictionary prunes latest harvested generic cooperation samples', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-generic-cooperation-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '如果有',
            family: 'cooperation',
            meaning: 'conditional openness to evidence',
            evidenceCount: 2,
            evidenceSamples: [
              '如果有可能，我倒是宁愿傻呵呵的过一生，不要这么多体验和顿悟',
              '但如果有一天她遇到了线下的情绪，她表现出来的是和线上其实差不多，旁人只能发现她难受痛苦，然而这一次是真正吃到苦头了。',
            ],
          },
          {
            term: '可以贴',
            family: 'cooperation',
            meaning: 'ask another user to post evidence or context',
            evidenceCount: 1,
            evidenceSamples: ['在这个基础，就可以发现，野核并不等于刺客，蓝领并不等于坦克。'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.equal(dictionary.entries.find((item) => item.term === '如果有').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '可以贴').evidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested literal metallurgy and negated freshness false positives', () => {
  const dictionary = {
    entries: [
      { term: '炼铜', family: 'attack', meaning: 'homophone attack for child sexualization' },
      { term: '厉不厉害', family: 'attack', meaning: 'sarcastic challenge phrase' },
      { term: '热乎', family: 'cooperation', meaning: 'fresh or recently available context' },
      { term: '热乎的', family: 'cooperation', meaning: 'fresh or recently available context' },
    ],
  };
  const falsePositiveText = [
    '新系统的转炉炼铜你会了吗',
    '回复 @厉不厉害你鸡哥jj :小黑子，露出鸡脚了吧',
    '并非热乎',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '别说到处x暗示了，礼的直接把炼铜刻脸上了，有人管吗',
      '大波波这轻描淡写的就把这么多事儿办了，你们说厉不厉害',
      '热乎的资料刚发出来，可以参考',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '炼铜',
    '厉不厉害',
    '热乎',
    '热乎的',
  ]);
});

test('mergeEntriesIntoDictionary prunes persisted literal metallurgy and negated freshness evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-literal-metallurgy-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '炼铜',
            family: 'attack',
            meaning: 'homophone attack for child sexualization',
            evidenceCount: 1,
            evidenceSamples: ['新系统的转炉炼铜你会了吗'],
          },
          {
            term: '热乎',
            family: 'cooperation',
            meaning: 'fresh or recently available context',
            evidenceCount: 1,
            evidenceSamples: ['并非热乎'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.equal(dictionary.entries.find((item) => item.term === '炼铜').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '热乎').evidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested substring and loose alias false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u6b7b\u62ff', family: 'absolutes', meaning: 'rigidly clutching one point as absolute' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask another user to post evidence or context' },
      { term: '\u524d\u9762\u8bf4\u91cd\u4e86', family: 'correction', meaning: 'soften or retract an earlier overstatement' },
      { term: '\u8bf4\u9519\u4e86', family: 'correction', meaning: 'admit a prior statement was wrong' },
      { term: '\u6211\u7684\u95ee\u9898', family: 'correction', meaning: 'admit a mistake or oversight' },
      { term: '\u6b63\u9053\u7684\u5149', family: 'attack', meaning: 'mock self-righteous framing' },
      { term: '\u90fd\u662f\u5bb6\u4eba', family: 'cooperation', meaning: 'de-escalating shared-community framing' },
      { term: '\u8c01\u61c2', family: 'evasion', meaning: 'appeal to shared feeling instead of explaining' },
    ],
  };
  const falsePositiveText = [
    '\u81ea\u5df1\u4f5c\u6b7b\u62ff\u5200\u662f\u8fd9\u6837\u7684\uff0c\u8fd1\u8ddd\u79bb\u5c0f\u5200\u80fd\u5355\u6740\u6267\u6cd5\u4e86',
    '\u53ef\u4ee5\u53d1\u5956',
    '\u5f53\u5e74\u56e0\u4e3a\u8fd9\u4e8b\u5f88\u591a\u4eba\u603c\u4ed6\uff0c\u4f46\u6211\u89c9\u5f97\u4ed6\u6ca1\u6709\u4e00\u4e2a\u5b57\u8bf4\u9519\u4e86',
    '\u6211\u8f6c\u5934\u95ee\u4e86\u4e00\u4e0b\u6211\u5973\u670b\u53cb\u7684\u611f\u53d7',
    '\u4f60\u770b\u672c\u5730\u4eba\u591a\u4e56 \u77e5\u9053\u8bf4\u9519\u8bdd\u7684\u540e\u679c',
    '\u4eba\u7d27\u5f20\u7684\u65f6\u5019\u662f\u5bb9\u6613\u8ba4\u9519\u4eba\uff0c\u4e00\u7d27\u5f20\u5c31\u8ba4\u9519\u4eba\u8bf4\u9519\u8bdd',
    '\u6b63\u9053\u7684\u5149\u3002\u3002\u3002',
    '\u5b5d\u4e0d\u6d3b\u4e86\u5bb6\u4eba\u4eec',
    '\u5bb6\u4eba\u4eec\u6211\u542c\u534a\u5e74\u7684\u6b4c',
    '\u554a\u554a\u554a\u554a\u554a\u554a\u554a\u554a\uff0c\u8c01\u61c2\u554a\uff0c\u6211\u54ed\u6b7b',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u522b\u6b7b\u62ff\u4e00\u4e2a\u4f8b\u5b50\u5f53\u7edd\u5bf9\u8bc1\u636e',
      '\u4f60\u628a\u8bc1\u636e\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      '\u524d\u9762\u8bf4\u91cd\u4e86\uff0c\u6211\u6536\u56de\u521a\u624d\u90a3\u53e5',
      '\u6211\u8bf4\u9519\u4e86\uff0c\u8fd9\u91cc\u5e94\u8be5\u6539\u4e00\u4e0b',
      '\u6211\u7684\u95ee\u9898\uff0c\u521a\u624d\u770b\u9519\u4e86',
      '\u522b\u628a\u81ea\u5df1\u5305\u88c5\u6210\u6b63\u9053\u7684\u5149\u6765\u6263\u5e3d\u5b50',
      '\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba\uff0c\u5148\u522b\u5435\u597d\u597d\u8ba8\u8bba',
      '\u522b\u53ea\u8bf4\u8c01\u61c2\uff0c\u8bc1\u636e\u8d34\u51fa\u6765',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u6b7b\u62ff',
    '\u53ef\u4ee5\u8d34',
    '\u524d\u9762\u8bf4\u91cd\u4e86',
    '\u8bf4\u9519\u4e86',
    '\u6211\u7684\u95ee\u9898',
    '\u6b63\u9053\u7684\u5149',
    '\u90fd\u662f\u5bb6\u4eba',
    '\u8c01\u61c2',
  ]);
});

test('mergeEntriesIntoDictionary prunes latest harvested loose alias false positives', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-loose-aliases-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u6b7b\u62ff',
            family: 'absolutes',
            meaning: 'rigidly clutching one point as absolute',
            evidenceCount: 1,
            evidenceSamples: ['\u81ea\u5df1\u4f5c\u6b7b\u62ff\u5200\u662f\u8fd9\u6837\u7684\uff0c\u8fd1\u8ddd\u79bb\u5c0f\u5200\u80fd\u5355\u6740\u6267\u6cd5\u4e86'],
          },
          {
            term: '\u53ef\u4ee5\u8d34',
            family: 'cooperation',
            meaning: 'ask another user to post evidence or context',
            evidenceCount: 1,
            evidenceSamples: ['\u53ef\u4ee5\u53d1\u5956'],
          },
          {
            term: '\u524d\u9762\u8bf4\u91cd\u4e86',
            family: 'correction',
            meaning: 'soften or retract an earlier overstatement',
            evidenceCount: 1,
            evidenceSamples: ['\u5f53\u5e74\u56e0\u4e3a\u8fd9\u4e8b\u5f88\u591a\u4eba\u603c\u4ed6\uff0c\u4f46\u6211\u89c9\u5f97\u4ed6\u6ca1\u6709\u4e00\u4e2a\u5b57\u8bf4\u9519\u4e86'],
          },
          {
            term: '\u6211\u7684\u95ee\u9898',
            family: 'correction',
            meaning: 'admit a mistake or oversight',
            evidenceCount: 1,
            evidenceSamples: ['\u6211\u8f6c\u5934\u95ee\u4e86\u4e00\u4e0b\u6211\u5973\u670b\u53cb\u7684\u611f\u53d7'],
          },
          {
            term: '\u8bf4\u9519\u4e86',
            family: 'correction',
            meaning: 'admit a prior statement was wrong',
            evidenceCount: 1,
            evidenceSamples: ['\u4f60\u770b\u672c\u5730\u4eba\u591a\u4e56 \u77e5\u9053\u8bf4\u9519\u8bdd\u7684\u540e\u679c'],
          },
          {
            term: '\u90fd\u662f\u5bb6\u4eba',
            family: 'cooperation',
            meaning: 'de-escalating shared-community framing',
            evidenceCount: 1,
            evidenceSamples: ['\u5bb6\u4eba\u4eec\u6211\u542c\u534a\u5e74\u7684\u6b4c'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.equal(dictionary.entries.find((item) => item.term === '\u6b7b\u62ff').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '\u53ef\u4ee5\u8d34').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '\u524d\u9762\u8bf4\u91cd\u4e86').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '\u6211\u7684\u95ee\u9898').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '\u8bf4\u9519\u4e86').evidenceCount, 0);
    assert.equal(dictionary.entries.find((item) => item.term === '\u90fd\u662f\u5bb6\u4eba').evidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested Taffy emote-only evidence', () => {
  const dictionary = {
    entries: [
      { term: '\u5854\u83f2', family: 'cooperation', meaning: 'Taffy-related cooperative context' },
    ],
  };

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, '@_SayaKa [\u6c38\u96cf\u5854\u83f2_\u563b\u563b\u55b5]');

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(dictionary, '\u5854\u83f2\u76f8\u5173\u8d44\u6599\u53ef\u4ee5\u53c2\u8003\u8fd9\u4e2a\u94fe\u63a5');

  assert.deepEqual(realEntries.map((entry) => entry.term), ['\u5854\u83f2']);
});

test('mergeEntriesIntoDictionary prunes persisted Taffy emote-only evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-taffy-emote-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          {
            term: '\u5854\u83f2',
            family: 'cooperation',
            meaning: 'Taffy-related cooperative context',
            evidenceCount: 1,
            evidenceSamples: ['@_SayaKa [\u6c38\u96cf\u5854\u83f2_\u563b\u563b\u55b5]'],
          },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    assert.equal(dictionary.entries.find((item) => item.term === '\u5854\u83f2').evidenceCount, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested explanation and reaction false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u4e0d\u5c2c', family: 'cooperation', meaning: 'not awkward, constructive reassurance' },
      { term: '\u5982\u679c\u6709', family: 'cooperation', meaning: 'conditional openness to evidence' },
      { term: '\u6211\u9519\u4e86', family: 'correction', meaning: 'admit fault or correction' },
      { term: '\u8c01\u61c2', family: 'evasion', meaning: 'appeal to shared feeling instead of explaining' },
      { term: '\u5c0f\u7c89\u7ea2', family: 'attack', meaning: 'hostile pink label' },
      { term: 'pink', family: 'attack', meaning: 'alias for hostile pink label' },
      { term: '\u5c0f\u5b69\u5c04', family: 'attack', meaning: 'ambiguous hostile slang item' },
    ],
  };
  const falsePositiveText = [
    '\u5b98\u65b9\u4e0d\u5c2c\u6211\u90fd\u89c9\u5f97\u5c2c[doge]',
    '\u770b\u6765\u8fd9\u7247\u5b50\u6ca1\u7ed9\u5218\u5201\u6bdb\u9001\u94b1\u554a\uff0c\u90fd\u4e0d\u5c2c\u5439\u4e86',
    '\u5982\u679c\u6709\u4eba\u5728\u5c0f\u4fe9\u5343\u5e74\u524d\u7ed9\u4f60\u5728\u5168\u83cc\u73af\u5883\u4e0b\u505a\u4e00\u573a\u5168\u98ce\u9669\u96f6\u6536\u76ca\u7684\u5f00\u9885\u624b\u672f',
    '\u6211\u9519\u4e86\u53c8\u80fd\u600e\u4e48\u6837\uff1f\u6211\u4e0d\u53ef\u80fd\u7ed9\u4f60\u9053\u6b49\u6211\u4e5f\u4e0d\u627f\u8ba4\u6211\u6709\u9519',
    '\u8c01\u61c2\u554a\u4e00\u70b9\u8fdb\u6765\u90fd\u51c6\u5907\u5f00\u59cb\u9009\u724c\u4e86wwww',
    '\u8fd9\u662f\u4e3b\u89d2\u56e2\u6b7b\u4eba\u6700\u591a\u7684\u4e00\u90e8\u5427\uff0c\u524d\u4efb\u7c89\u7ea2\u84dd\uff0c\u5927\u5e08\u5144',
    '\u4e0d\u61c2\u5c31\u95ee\uff0c\u4f60\u4eec\u8bf4\u7684\u7684\u5c11\u4eba\u3001\u591a\u4eba\u3001\u4eba\u5c71\u4eba\u6d77\u3001\u660e\u7740\u6765\u3001\u5c0f\u5b69\u5c04\u3001\u7d27\u3001KDA\u662f\u4ec0\u4e48\u610f\u601d\u554a',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u6bb5\u89e3\u91ca\u4e0d\u5c2c\uff0c\u53ef\u4ee5\u7ee7\u7eed\u8865\u5145',
      '\u5982\u679c\u6709\u539f\u59cb\u8bc1\u636e\u6211\u613f\u610f\u6539\u7ed3\u8bba',
      '\u6211\u9519\u4e86\uff0c\u521a\u624d\u90a3\u53e5\u6536\u56de',
      '\u522b\u53ea\u8bf4\u8c01\u61c2\uff0c\u8bc1\u636e\u8d34\u51fa\u6765',
      '\u522b\u518d\u7528\u5c0f\u7c89\u7ea2\u8bdd\u672f\u6263\u5e3d\u5b50\u4e86',
      'pink\u90fd\u662f\u5728\u6821\u5b66\u751f\u8fd9\u8bdd\u7ffb\u6765\u8986\u53bb',
      '\u5c0f\u5b69\u5c04\u8fd9\u79cd\u8bf4\u6cd5\u662f\u5728\u9a82\u4eba\u5427',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u4e0d\u5c2c',
    '\u5982\u679c\u6709',
    '\u6211\u9519\u4e86',
    '\u8c01\u61c2',
    '\u5c0f\u7c89\u7ea2',
    'pink',
    '\u5c0f\u5b69\u5c04',
  ]);
});

test('mergeEntriesIntoDictionary prunes latest harvested explanation and reaction false positives', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'deepseek-prune-explanation-reaction-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeFile(
      dictionaryPath,
      JSON.stringify({
        version: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: [
          { term: '\u4e0d\u5c2c', family: 'cooperation', meaning: 'not awkward, constructive reassurance', evidenceCount: 2, evidenceSamples: ['\u5b98\u65b9\u4e0d\u5c2c\u6211\u90fd\u89c9\u5f97\u5c2c[doge]', '\u770b\u6765\u8fd9\u7247\u5b50\u6ca1\u7ed9\u5218\u5201\u6bdb\u9001\u94b1\u554a\uff0c\u90fd\u4e0d\u5c2c\u5439\u4e86'] },
          { term: '\u5982\u679c\u6709', family: 'cooperation', meaning: 'conditional openness to evidence', evidenceCount: 1, evidenceSamples: ['\u5982\u679c\u6709\u4eba\u5728\u5c0f\u4fe9\u5343\u5e74\u524d\u7ed9\u4f60\u505a\u4e00\u573a\u5f00\u9885\u624b\u672f'] },
          { term: '\u6211\u9519\u4e86', family: 'correction', meaning: 'admit fault or correction', evidenceCount: 1, evidenceSamples: ['\u6211\u9519\u4e86\u53c8\u80fd\u600e\u4e48\u6837\uff1f\u6211\u4e0d\u53ef\u80fd\u7ed9\u4f60\u9053\u6b49\u6211\u4e5f\u4e0d\u627f\u8ba4\u6211\u6709\u9519'] },
          { term: '\u8c01\u61c2', family: 'evasion', meaning: 'appeal to shared feeling instead of explaining', evidenceCount: 1, evidenceSamples: ['\u8c01\u61c2\u554a\u4e00\u70b9\u8fdb\u6765\u90fd\u51c6\u5907\u5f00\u59cb\u9009\u724c\u4e86wwww'] },
          { term: '\u5c0f\u7c89\u7ea2', family: 'attack', meaning: 'hostile pink label', evidenceCount: 1, evidenceSamples: ['\u8fd9\u662f\u4e3b\u89d2\u56e2\u6b7b\u4eba\u6700\u591a\u7684\u4e00\u90e8\u5427\uff0c\u524d\u4efb\u7c89\u7ea2\u84dd\uff0c\u5927\u5e08\u5144'] },
          { term: '\u5c0f\u5b69\u5c04', family: 'attack', meaning: 'ambiguous hostile slang item', evidenceCount: 1, evidenceSamples: ['\u4e0d\u61c2\u5c31\u95ee\uff0c\u5c0f\u5b69\u5c04\u662f\u4ec0\u4e48\u610f\u601d\u554a'] },
        ],
      }),
      'utf8',
    );

    const dictionary = await mergeEntriesIntoDictionary([], { dictionaryPath });

    for (const term of ['\u4e0d\u5c2c', '\u5982\u679c\u6709', '\u6211\u9519\u4e86', '\u8c01\u61c2', '\u5c0f\u7c89\u7ea2', '\u5c0f\u5b69\u5c04']) {
      assert.equal(dictionary.entries.find((item) => item.term === term).evidenceCount, 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested username literal and list false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u5c0f\u7c89\u7ea2', family: 'attack', meaning: 'hostile pink label' },
      { term: 'pink', family: 'attack', meaning: 'alias for hostile pink label' },
      { term: '\u5982\u679c\u6709', family: 'cooperation', meaning: 'conditional openness to evidence' },
      { term: '\u827e\u6ecb\u5200', family: 'attack', meaning: 'hostile KPL nickname' },
      { term: '\u827e\u6ecb\u91ce', family: 'attack', meaning: 'hostile KPL nickname' },
      { term: 'kda\u5927\u5e1d', family: 'attack', meaning: 'hostile KPL nickname' },
      { term: '\u5b9e\u540d\u5236', family: 'cooperation', meaning: 'explicitly identify or support a stance' },
      { term: '\u5b9e\u540d\u5236\u89c2\u770b', family: 'cooperation', meaning: 'explicit support by named viewing' },
      { term: '\u4e00\u6761\u9f99', family: 'cooperation', meaning: 'organized full-process help' },
      { term: '\u4e3b\u5305', family: 'cooperation', meaning: 'friendly host address or request' },
      { term: '\u8bb0\u9519\u4e86', family: 'correction', meaning: 'self correction for a remembered fact' },
    ],
  };
  const falsePositiveText = [
    '\u56de\u590d @\u9ec4\u8272\u65b9\u5757\u548c\u7c89\u7ea2\u6076\u9b54 :\u90fd\u8bf4\u4e86\u662f\u8f85\u52a9\uff0c\u539f\u672c\u5341\u5f71\u672f\u4f7f\u7528\u8005\u5c31\u6ca1\u6709\u80fd\u529b\u79d2\u6389\u9b54\u865a\u7f57',
    '\u8fd9\u4e2a\u955c\u5934\u8fd8\u7528\u4e86\u7ea2\u706f\u533a\u7684\u7ecf\u5178\u7c89\u7ea2\u6253\u5149',
    '\u5982\u679c\u6709\u5929\u4e0e\u66b4\u541b\u5e2e\u5fd9\u662f\u4e0d\u7b97\u5916\u4eba\u7684',
    '\u5c11\u5c7f\uff0c\u6d41\u91cf\uff0c\u5927\u5927\u9634\uff0ckda\u5927\u5e1d\uff0c\u827e\u6ecb\u5200\uff0c\u827e\u6ecb\u91ce\uff0cpcg\uff0c\u90fd\u662f\u4ec0\u4e48\u610f\u601d\u554a\uff0c\u4ece\u6765\u4e0d\u770bkpl',
    '\u76f4\u64ad\u95f4\u5c3c\u5b5d\u53ef\u662f\u771f\u7684\u82b1\u94b1\u5b9e\u540d\u5236\u7ed9\u81ea\u5df1\u8ba4\u8dcc\uff0c\u6bd4jee\u9006\u5929\u591a\u4e86',
    '\u4e00\u6761\u9f99\u7684\u8fd8\u662f\u4e2a\u7ef4\u65cf\u5927\u53d4[\u7b11\u54ed]',
    '\u4e3b\u5305\u662f\u4e0d\u6709\u70b9\u3002\u3002\u3002',
    '\u4e5f\u8bb8\u4ed9\u8349\u8bb0\u9519\u4e86\u5462',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u522b\u518d\u7528\u5c0f\u7c89\u7ea2\u8bdd\u672f\u6263\u5e3d\u5b50\u4e86',
      'pink\u90fd\u662f\u5728\u6821\u5b66\u751f\u8fd9\u8bdd\u7ffb\u6765\u8986\u53bb',
      '\u5982\u679c\u6709\u539f\u59cb\u8bc1\u636e\u6211\u613f\u610f\u6539\u7ed3\u8bba',
      '\u827e\u6ecb\u5200\u8fd9\u79cd\u9ed1\u79f0\u662f\u5728\u9a82\u4eba\u5427',
      '\u827e\u6ecb\u91ce\u8fd9\u4e2a\u8bcd\u522b\u4e71\u62ff\u6765\u653b\u51fb\u9009\u624b',
      '\u522b\u62ffkda\u5927\u5e1d\u5f53\u9ed1\u79f0\u590d\u8bfb',
      '\u6211\u5b9e\u540d\u5236\u652f\u6301\u8fd9\u4e2a\u5206\u6790',
      '\u8fd9\u4e2a\u89c6\u9891\u6211\u5b9e\u540d\u5236\u89c2\u770b\u5e76\u4e14\u4e09\u8fde',
      '\u8bc1\u636e\u94fe\u63a5\u548c\u6574\u7406\u4e00\u6761\u9f99\u90fd\u53ef\u4ee5\u8d34\u51fa\u6765',
      '\u4e3b\u5305\u80fd\u4e0d\u80fd\u8bb2\u4e00\u4e0b\u6765\u6e90',
      '\u6211\u8bb0\u9519\u4e86\uff0c\u521a\u624d\u90a3\u53e5\u6536\u56de',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u5c0f\u7c89\u7ea2',
    'pink',
    '\u5982\u679c\u6709',
    '\u827e\u6ecb\u5200',
    '\u827e\u6ecb\u91ce',
    'kda\u5927\u5e1d',
    '\u5b9e\u540d\u5236',
    '\u5b9e\u540d\u5236\u89c2\u770b',
    '\u4e00\u6761\u9f99',
    '\u4e3b\u5305',
    '\u8bb0\u9519\u4e86',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested emote and bookmark false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u5154\u5154\u5c9b', family: 'cooperation', meaning: 'friendly Rabbit Island community reference' },
      { term: '\u5154\u5154\u5c9b\u7761\u89c9', family: 'cooperation', meaning: 'Rabbit Island sleeping emote text' },
      { term: '\u63d2\u4e2a\u773c', family: 'cooperation', meaning: 'bookmark for later follow-up' },
      { term: '\u7b11\u563b\u4e86', family: 'cooperation', meaning: 'light positive reaction' },
      { term: '\u5f00\u667a\u4e86', family: 'attack', meaning: 'mocking someone as only now enlightened' },
    ],
  };
  const falsePositiveText = [
    '\u96be\u9053\u4e0d\u662f\u523b\u610f\u7684\u5f2f\u4e0b\u8170\u7684\u5417[\u5154\u5154\u5c9b_\u7761\u89c9]',
    '\u63d2\u4e2a\u773c\u4e24\u5468\u540e\u7ee7\u7eed\uff0c\u4e4b\u524d PHQ-9 \u9a6c\u4e0a\u4e5f\u8981\u5230\u7b2c\u4e09\u6b21\u54e9[doge]',
    '\u63d2\u4e2a\u773c\u6bcf\u5929\u4e00\u95ee\u6d3b\u7740\u5417',
    '\u738b\u516c\u770bwbg\u6700\u63ea\u5fc3\uff0c\u770b\u52302\u6bd40\u7b11\u563b\u4e86\uff0c2\u6bd41\u8138\u8272\u4e0d\u5bf9\u4e86\uff0c2\u6bd42\u4e0d\u8bf4\u8bdd\u4e86',
    '\u5b66\u9738\u7ed9\u7684\u6ee1\u5206\u7b54\u6848\u786c\u662f\u81ea\u5df1\u6539\u6210\u4e86\u96f6\u5206\uff0c\u7b11\u563b\u4e86',
    '\u6211\u8bfb\u5c0f\u5b66\u65f6\u7684\u4e92\u8054\u7f51\u4e0a\uff0c99%\u90fd\u662f\u7537\u4eba\u7684\u8fd9\u7c7b\u6076\u81ed\u8a00\u8bba\uff0c\u8fd9\u51e0\u5e74\u4e92\u8054\u7f51\u50cf\u7a81\u7136\u5f00\u667a\u4e86\u4e00\u6837',
    '\u5f53\u4e00\u4e2a\u4eba\u53ef\u4ee5\u627f\u8ba4\u81ea\u5df1\u201c\u6211\u6ca1\u5f00\u667a\u201d\u65f6\uff0c\u4ed6\u5c31\u5df2\u7ecf\u5f00\u667a\u4e86\u3002',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u5154\u5154\u5c9b\u8fd9\u8fb9\u6709\u8865\u5145\u8d44\u6599\u53ef\u4ee5\u8d34\u5417',
      '\u5154\u5154\u5c9b\u7761\u89c9\u8868\u60c5\u5305\u6765\u6e90\u53ef\u4ee5\u8865\u4e00\u4e0b',
      '\u63d2\u4e2a\u773c\uff0c\u7b49\u4f60\u628a\u8bc1\u636e\u94fe\u63a5\u8865\u4e0a',
      '\u8fd9\u6bb5\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u770b\u5b8c\u7b11\u563b\u4e86',
      '\u4f60\u8fd9\u903b\u8f91\u7ec8\u4e8e\u5f00\u667a\u4e86\uff1f\u8bc1\u636e\u524d\u9762\u90fd\u8d34\u4e86',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u5154\u5154\u5c9b',
    '\u5154\u5154\u5c9b\u7761\u89c9',
    '\u63d2\u4e2a\u773c',
    '\u7b11\u563b\u4e86',
    '\u5f00\u667a\u4e86',
  ]);
});

test('normalizeKeywordEntries prunes self-sabotage mocking evidence for xiaoxile cooperation term', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u7b11\u563b\u4e86',
      family: 'cooperation',
      meaning: 'light positive reaction',
      evidenceCount: 2,
      evidenceSamples: [
        '\u5b66\u9738\u7ed9\u7684\u6ee1\u5206\u7b54\u6848\u786c\u662f\u81ea\u5df1\u6539\u6210\u4e86\u96f6\u5206\uff0c\u7b11\u563b\u4e86',
        '\u8fd9\u6bb5\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u770b\u5b8c\u7b11\u563b\u4e86',
      ],
      evidenceSources: [],
    },
  ]);

  assert.deepEqual(entries[0].evidenceSamples, ['\u8fd9\u6bb5\u89e3\u91ca\u5f88\u6e05\u695a\uff0c\u770b\u5b8c\u7b11\u563b\u4e86']);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested alias and proper-name false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50', family: 'attack', meaning: 'accuse someone of repeatedly labeling others' },
      { term: '\u5999\u554a\u5999\u554a', family: 'attack', meaning: 'sarcastic praise for absurd logic' },
      { term: '\u6e05\u4e00\u8272', family: 'absolutes', meaning: 'overgeneralize a group as all the same' },
      { term: '\u5708\u7c73\u4e0d\u8d56', family: 'attack', meaning: 'sarcastic criticism that monetization is effective' },
      { term: '\u9f99\u54e5\u7684\u5144\u5f1f', family: 'attack', meaning: 'hostile meme nickname' },
      { term: '\u7f57\u4e0d\u6cfc', family: 'attack', meaning: 'hostile pun nickname' },
    ],
  };
  const falsePositiveText = [
    '\u95ee:\u5976\u916a\u88ab\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50\uff1f',
    '\u56de\u590d @\u5c0f\u8c4c\u8c46\u68a6\u9b47 :\u90a3\u7070\u7070\u88ab\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50[\u55d1\u74dc\u5b50]',
    '\u6211\u4eec\u6708\u5f71\u5b97\u4e00\u4e2a\u53a8\u623f\u7684\u4f19\u592b\u90fd\u80fd\u628a\u4f60\u4eec\u638c\u95e8\u6309\u5728\u5730\u4e0a\u63cd[\u5999\u554a][\u5999\u554a]',
    '\u6709\u914d\u53d7\u7684\u6f5c\u529b[\u5999\u554a][\u5999\u554a][doge]',
    '\u6e05\u4e00\u8272\u662f\u5973\u8131\u53e3\u79c0\u6f14\u5458\u7684\u5929\u82b1\u677f\u4e86\uff0c\u793e\u4f1a\u9605\u5386\u4e30\u5bcc',
    '\u5708\u7c73\u4e0d\u8d56',
    '\u7c73\u54c8\u6e38\u7684\u8fd0\u8425\u601d\u8def\u5c31\u8fd9\u6837\uff0c\u5404\u79cd\u5708\u7c73\u6d3b\u52a8\uff0c\u7136\u540e\u8001\u6e38\u620f\u81ea\u751f\u81ea\u706d',
    '\u7f57\u54e5\u7684\u4e0d\u662f\u554a\u5df2\u7ecf\u8ddf\u9f99\u54e5\u7684\u5144\u5f1f\u4e00\u6837\uff0c\u53ea\u4e0d\u8fc7\u4e00\u4e2a\u662f\u9017\u53f7\uff0c\u4e00\u4e2a\u662f\u5192\u53f7',
    '\u9f99\u54e5\u7684\u5144\u5f1f\uff0c\u8f69\u59b9\u7684\u5575\uff0c\u7f57\u54e5\u7684\u4e0d\u662f\u554a[doge]',
    '\u7f57\u4e0d\u6cfc\uff0c\u6307\u7684\u662f\u7f57\u54e5\u7684\u4e0d\u662f\u554a\u50cf\u6cfc\u51fa\u53bb\u7684\u6c34\u4e00\u6837\u5bf9',
    '\u80fd\u60f3\u51fa\u7f57\u4e0d\u6cfc\u7684\u52a0\u91cc\u5f97\u8bf7\u4e2a\u9ad8\u4eba\u4e86',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u4e0d\u662f\u8ba8\u8bba\uff0c\u5c31\u662f\u7ed9\u5bf9\u65b9\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50\u8fd8\u4e0d\u7ed9\u8bc1\u636e',
      '\u4f60\u8fd9\u903b\u8f91\u771f\u662f\u5999\u554a\u5999\u554a\uff0c\u8bc1\u636e\u5462',
      '\u8bc4\u8bba\u533a\u6e05\u4e00\u8272\u90fd\u5728\u9a82\u4eba\uff0c\u522b\u8bf4\u6ca1\u6709\u5e26\u8282\u594f',
      '\u7c73\u54c8\u6e38\u8fd9\u6ce2\u5708\u7c73\u4e0d\u8d56\uff0c\u8001\u73a9\u5bb6\u53c8\u88ab\u5272',
      '\u522b\u518d\u62ff\u9f99\u54e5\u7684\u5144\u5f1f\u8fd9\u79cd\u9ed1\u79f0\u590d\u8bfb\u4e86',
      '\u4ed6\u4eec\u7528\u7f57\u4e0d\u6cfc\u5f53\u9ed1\u79f0\u5e26\u8282\u594f\uff0c\u4e0d\u662f\u8ba8\u8bba',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50',
    '\u5999\u554a\u5999\u554a',
    '\u6e05\u4e00\u8272',
    '\u5708\u7c73\u4e0d\u8d56',
    '\u9f99\u54e5\u7684\u5144\u5f1f',
    '\u7f57\u4e0d\u6cfc',
  ]);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested literal and generic praise false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u5f00\u5408', family: 'attack', meaning: 'doxxing or privacy exposure slang' },
      { term: '\u8f7b\u5feb\u7ef7\u4f4f', family: 'cooperation', meaning: 'calmly hold back a reaction' },
      { term: '\u8f7b\u677e\u7ef7\u4f4f', family: 'cooperation', meaning: 'calmly hold back a reaction' },
      { term: '\u610f\u6ee1\u79bb', family: 'cooperation', meaning: 'leave satisfied after useful context' },
      { term: '\u4e0b\u996d', family: 'cooperation', meaning: 'watchable with a meal' },
      { term: '\u53ef\u4ee5\u8d34', family: 'cooperation', meaning: 'ask someone to post evidence or context' },
      { term: '\u795e\u795e', family: 'attack', meaning: 'hostile ideological label' },
      { term: '\u5854\u83f2', family: 'cooperation', meaning: 'friendly Taffy community reference' },
      { term: '\u8054\u540d\u6b3e', family: 'cooperation', meaning: 'collaborative model or shared reference' },
      { term: '\u6e7f\u6e7f', family: 'attack', meaning: 'mocking homophone nickname' },
    ],
  };
  const falsePositiveText = [
    '\u51b7\u77e5\u8bc6\uff0c\u4f60\u4e0d\u7528\u8ddf\u7740\u5f00\u5408\u9f3b\u5b54',
    '\u5389\u5bb3\uff0c\u80fd\u63a7\u5236\u9f3b\u5b54\u5f00\u5408',
    '\u8f7b\u5feb\u7ef7\u4f4f\uff0c\u677e\u5f1b\u7ef7\u4f4f\uff0c\u8212\u7f13\u7ef7\u4f4f\uff0c\u5b89\u9038\u7ef7\u4f4f\uff0c\u81ea\u5728\u7ef7\u4f4f',
    '\u8f7b\u677e\u7ef7\u4f4f',
    '\u610f\u6ee1\u79bb',
    '\u6211\u73b0\u5728\u5c31\u7ecf\u5e38\u5c0f\u7c73\u6912\u4e0b\u996d\uff0c\u4e00\u9910\u4fe9\u6839',
    '\u5c0f\u7c73\u6912\u4e0b\u996d',
    '\u6211\u559c\u6b22\u751f\u5403\u5c0f\u7c73\u8fa3\uff0c\u4e0b\u996d',
    '\u6211\u52a8\u6001\u6709\u53d1\u51fa\u6765\u8fc7',
    '\u5df2\u56db\u8fde\uff0c\u8bf7\u95ee\u5e08\u5085\uff0c\u8fd9\u4e2a\u5973\u751f\u4ec0\u4e48\u65f6\u5019\u53ef\u4ee5\u53d1\u8d22',
    '\u8fd8\u6709\u8138\u81ea\u5df1\u53d1\u51fa\u6765',
    '\u53bb\u63a8\u4e0a\u4e00\u770b\u5c31\u77e5\u9053\u8fd9\u79cd\u4eba\u7684\u672a\u6765\u4e86\uff0c\u57fa\u672c\u4e0a\u51fa\u53bb\u5c31\u53ef\u4ee5\u8d34\u4e0a\u88ab\u8feb\u5bb3\u7684\u5934\u8854',
    'k\u795e\u795e\u4e86',
    '\u5854\u83f2\u7684\u804a\u5929\u8bb0\u5f55\u6839\u672c\u4e0d\u662f\u4ed6\u672c\u4eba\u653e\u51fa\u53bb\u7684',
    '\u9020\u8c23\u8fd9\u4e2a\u786e\u5b9e\u6ca1\u5f97\u6d17\uff0c\u4f46\u90e8\u5206\u6296\u53cb\u6068\u4e0d\u5f97\u628a\u5854\u83f2\u6367\u6210\u5723\u4eba',
    '\u9020\u8c23\u8fd9\u4e2a\u786e\u5b9e\u6ca1\u5f97\u6d17\uff0c\u4f46\u90e8\u5206\u6296\u53cb\u6068\u4e0d\u5f97\u628a\u5979\u6367\u6210\u5723\u4eba\uff0c\u8fd9\u6837\u6367\u6740\u53ea\u4f1a\u8ba9\u77e5\u9053\u8fd9\u4ef6\u4e8b\u4e14\u5bf9\u5854\u83f2\u672c\u6765\u5c31\u53cd\u611f\u7684\u4eba\u8d8a\u6765\u8d8a\u538c\u6076\u5c31\u4f1a\u4e0d\u65ad\u7684\u65e7\u4e8b\u5728\u63d0',
    'up\u4e3b\u8054\u540d\u6b3e[doge]',
    '\u8fd9\u8f66\u673a\u68b0\u5e08Mmax2\u660e\u65e5\u9999\u8054\u540d\u6b3e\u672c\u6765\u5c31\u662f\u7535\u81ea\u554a',
    '\u6211\u559c\u6b22\u4ed6\u6e7f\u6e7f\u7684',
    '\u6211\u559c\u6b22\u6e7f\u6e7f\u7684\u9c8d\u9c7c',
    '\u6240\u4ee5\u6e7f\u6e7f\u4e86\u7684\u66f4\u597d\u5403',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u5f00\u5408\u7f51\u66b4\u5c31\u662f\u62ff\u9690\u79c1\u5e26\u8282\u594f',
      '\u8fd9\u6bb5\u89e3\u91ca\u8ba9\u5927\u5bb6\u8f7b\u677e\u7ef7\u4f4f\u60c5\u7eea\u7ee7\u7eed\u8ba8\u8bba',
      '\u770b\u5b8c\u8d44\u6599\u610f\u6ee1\u79bb\uff0c\u611f\u8c22\u6574\u7406',
      '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      '\u522b\u518d\u7528\u795e\u795e\u90a3\u5957\u8bdd\u672f\u6263\u5e3d\u5b50\u4e86',
      '\u8bf4\u5218\u8bd7\u8bd7\u201c\u6e7f\u6e7f\u201d\u8fd9\u79cd\u8c10\u97f3\u662f\u5728\u6076\u610f\u8c03\u4f83\u5427',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u5f00\u5408',
    '\u8f7b\u677e\u7ef7\u4f4f',
    '\u610f\u6ee1\u79bb',
    '\u53ef\u4ee5\u8d34',
    '\u795e\u795e',
    '\u6e7f\u6e7f',
  ]);
});

test('normalizeKeywordEntries prunes latest harvested label-attachment evidence for post-source terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53ef\u4ee5\u8d34',
      family: 'cooperation',
      meaning: 'ask someone to post evidence or context',
      evidenceCount: 2,
      evidenceSamples: [
        '\u53bb\u63a8\u4e0a\u4e00\u770b\u5c31\u77e5\u9053\u8fd9\u79cd\u4eba\u7684\u672a\u6765\u4e86\uff0c\u57fa\u672c\u4e0a\u51fa\u53bb\u5c31\u53ef\u4ee5\u8d34\u4e0a\u88ab\u8feb\u5bb3\u7684\u5934\u8854\uff0c\u66f4\u65b9\u4fbf\u62ff\u653f\u6cbb\u907f\u96be\uff0c',
        '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u53bb\u63a8\u4e0a\u4e00\u770b\u5c31\u77e5\u9053\u8fd9\u79cd\u4eba\u7684\u672a\u6765\u4e86\uff0c\u57fa\u672c\u4e0a\u51fa\u53bb\u5c31\u53ef\u4ee5\u8d34\u4e0a\u88ab\u8feb\u5bb3\u7684\u5934\u8854\uff0c\u66f4\u65b9\u4fbf\u62ff\u653f\u6cbb\u907f\u96be\uff0c' },
        { source: 'Bilibili public video comment scan', sample: '\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']);
  assert.deepEqual(entries[0].evidenceSources.map((source) => source.sample), ['\u4f60\u628a\u8bc1\u636e\u622a\u56fe\u53ef\u4ee5\u8d34\u4e00\u4e0b\u5417']);
});

test('normalizeKeywordEntries prunes body-state narrative evidence for not-human attack terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u4e0d\u662f\u4eba\u4e86',
      family: 'attack',
      meaning: 'attack that frames someone as not human',
      evidenceCount: 3,
      evidenceSamples: [
        '\u4e4b\u540e\u8fd9\u4e2a\u59d0\u59d0\u7684\u8eab\u4f53\u53ef\u5c31\u4e0d\u5f53\u4eba\u4e86',
        '\u4e0d\u5f53\u4eba\u4e86',
        '\u8f6c\u79fb\u4f24\u5bb3\uff0c\u7b56\u5212j\u771f\u4e0d\u662f\u4eba',
        '\u5c0f\u56e2\u4f53\u7684\u7ed3\u6676\u7c89\u4e5f\u592a\u79bb\u8c31\u4e86\uff0c\u4e32\u4e5f\u5c31\u4e32\u4e86\uff0c\u8fd8\u5e26\u4eba\u5bb6\u5b69\u5b50\u7684\u8282\u594f\uff0c\u8fd9\u624d\u771f\u4e0d\u662f\u4eba',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u4e4b\u540e\u8fd9\u4e2a\u59d0\u59d0\u7684\u8eab\u4f53\u53ef\u5c31\u4e0d\u5f53\u4eba\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u4e0d\u5f53\u4eba\u4e86' },
        { source: 'Bilibili public video comment scan', sample: '\u8f6c\u79fb\u4f24\u5bb3\uff0c\u7b56\u5212j\u771f\u4e0d\u662f\u4eba' },
        { source: 'Bilibili public video comment scan', sample: '\u5c0f\u56e2\u4f53\u7684\u7ed3\u6676\u7c89\u4e5f\u592a\u79bb\u8c31\u4e86\uff0c\u4e32\u4e5f\u5c31\u4e32\u4e86\uff0c\u8fd8\u5e26\u4eba\u5bb6\u5b69\u5b50\u7684\u8282\u594f\uff0c\u8fd9\u624d\u771f\u4e0d\u662f\u4eba' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 2);
  assert.deepEqual(entries[0].evidenceSamples, [
    '\u8f6c\u79fb\u4f24\u5bb3\uff0c\u7b56\u5212j\u771f\u4e0d\u662f\u4eba',
    '\u5c0f\u56e2\u4f53\u7684\u7ed3\u6676\u7c89\u4e5f\u592a\u79bb\u8c31\u4e86\uff0c\u4e32\u4e5f\u5c31\u4e32\u4e86\uff0c\u8fd8\u5e26\u4eba\u5bb6\u5b69\u5b50\u7684\u8282\u594f\uff0c\u8fd9\u624d\u771f\u4e0d\u662f\u4eba',
  ]);
});

test('normalizeKeywordEntries prunes persisted Taffy proper-name drama evidence', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u5854\u83f2',
      family: 'cooperation',
      meaning: 'friendly Taffy community reference',
      evidenceCount: 2,
      evidenceSamples: [
        '\u9020\u8c23\u8fd9\u4e2a\u786e\u5b9e\u6ca1\u5f97\u6d17\uff0c\u4f46\u5728\u6296\u6d77\u5c31\u662f\u5c0f\u5deb\u89c1\u5927\u5deb\u4e86\uff0c\u4f46\u90e8\u5206\u6296\u53cb\u6068\u4e0d\u5f97\u628a\u5979\u6367\u6210\u5723\u4eba\u5c31\u4e0d\u5bf9\u4e86\uff0c\u8fd9\u6837\u6367\u6740\u53ea\u4f1a\u8ba9\u77e5\u9053\u8fd9\u4ef6\u4e8b\u4e14\u5bf9\u5854\u83f2\u672c\u6765\u5c31\u53cd\u611f\u7684\u4eba\uff0c\u8d8a\u6765\u8d8a\u538c\u6076\u5c31\u4f1a\u4e0d\u65ad\u7684\u65e7\u4e8b\u5728\u63d0[\u5403\u74dc]',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', sample: '\u9020\u8c23\u8fd9\u4e2a\u786e\u5b9e\u6ca1\u5f97\u6d17\uff0c\u4f46\u5728\u6296\u6d77\u5c31\u662f\u5c0f\u5deb\u89c1\u5927\u5deb\u4e86\uff0c\u4f46\u90e8\u5206\u6296\u53cb\u6068\u4e0d\u5f97\u628a\u5979\u6367\u6210\u5723\u4eba\u5c31\u4e0d\u5bf9\u4e86\uff0c\u8fd9\u6837\u6367\u6740\u53ea\u4f1a\u8ba9\u77e5\u9053\u8fd9\u4ef6\u4e8b\u4e14\u5bf9\u5854\u83f2\u672c\u6765\u5c31\u53cd\u611f\u7684\u4eba\uff0c\u8d8a\u6765\u8d8a\u538c\u6076\u5c31\u4f1a\u4e0d\u65ad\u7684\u65e7\u4e8b\u5728\u63d0[\u5403\u74dc]' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 0);
  assert.deepEqual(entries[0].evidenceSamples, []);
  assert.deepEqual(entries[0].evidenceSources, []);
});

test('findDictionaryEntriesWithTextEvidence rejects latest harvested generic mod, emote, and praise false positives', () => {
  const dictionary = {
    entries: [
      { term: '\u6a21\u7ec4', family: 'cooperation', meaning: 'request or share a useful mod' },
      { term: '\u8131\u5355', family: 'cooperation', meaning: 'support someone getting into a relationship' },
      { term: '\u95ee\u8001\u9a6c\u672c\u4eba', family: 'evasion', meaning: 'dismissively tell someone to ask the original speaker' },
      { term: '\u5168\u90fd\u662f\u5bf9', family: 'absolutes', meaning: 'unqualified agreement used as closed judgment' },
      { term: '\u61c2\u4e86\u5427', family: 'evasion', meaning: 'dismissive phrase implying the answer is obvious' },
    ],
  };
  const falsePositiveText = [
    '\u4e3b\u64ad\u4e3b\u64ad\uff0c\u6211\u8981\u8fd9\u4e00\u4e2a\u6a21\u7ec4\uff0c\u6211\u7ed9\u4f60\u4e00\u952e\u4e09\u8fde\u4e86',
    '\u56db\u963f\u54e5\u7684\u533e\u989d\u3010\u9ad8\u77bb\u8fdc\u77a9\u3011\uff08\u8fd9\u7b97\u4e0d\u7b97\u6697\u793a\u4e86\u56db\u7237\u6700\u540e\u80fd\u593a\u5ae1\u6210\u529f[\u8131\u5355doge]\uff09',
    'All Your Base Are Belong to Us\uff081998\uff09',
    '\u54c8\u54c8\u54c8\u8fd9\u5c4a\u7f51\u53cb\u592a\u9002\u5408\u8bedc\u4e86\uff0c\u5168\u90fd\u662f\u5bf9\u8d34\u5408\u4eba\u7269\u6f14\u6280\u7684\u6b23\u8d4f\u554a',
    '\u59d0\u59b9\u52a0\u6cb9\u54e6\uff0c\u5176\u5b9e\u771f\u7684\u4e0d\u600e\u4e48\u96be\uff0c\u5b8c\u5168\u662f\u5bf9\u4e2d\u8003\u6709\u5e2e\u52a9\u7684\u7ec3\u4e60',
    '\u5982\u679c\u6709\u4e00\u4e2a\u884c\u661f\u62a4\u536b\u7684\u8bdd\uff0c\u90a3\u53d7\u5230\u4f24\u5bb3\u7684\u5168\u662f\u5bf9\u9762\u7684',
    '\u8fd9\u6e38\u620f\uff0c\u6bd5\u7adf\u662f\u5c11\u4f17\uff0c\u8fd9\u79cd\u653b\u7565\u89c6\u9891\u505a\u597d\u4e86\uff0c\u6d41\u91cf\u4e5f\u5dee\uff0c\u505a\u4e0d\u597d\uff0c\u4e00\u5806\u4eba\u55b7\uff0c\u61c2\u4e86\u5427[doge]',
    '\u4f60\u770b\uff0c\u61c2\u4e86\u5427',
  ].join('\n');

  const entries = findDictionaryEntriesWithTextEvidence(dictionary, falsePositiveText);

  assert.deepEqual(entries.map((entry) => entry.term), []);

  const realEntries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u8fd9\u4e2a\u6a21\u7ec4\u94fe\u63a5\u53ef\u4ee5\u5206\u4eab\u4e00\u4e0b\u5417\uff0c\u6211\u60f3\u590d\u73b0\u8fd9\u4e2a\u95ee\u9898',
      '\u795d\u4f60\u65e9\u65e5\u8131\u5355\uff0c\u627e\u5230\u559c\u6b22\u7684\u5bf9\u8c61',
      '\u522b\u95ee\u6211\u4e86\uff0c\u95ee\u8001\u9a6c\u672c\u4eba\u53bb',
      '\u4f60\u8fd9\u4e2a\u8bf4\u6cd5\u6ca1\u6709\u4efb\u4f55\u53cd\u4f8b\uff0c\u662f\u4e0d\u662f\u89c9\u5f97\u81ea\u5df1\u5168\u90fd\u662f\u5bf9',
      '\u8bc1\u636e\u4e0d\u7ed9\uff0c\u53ea\u8bf4\u6211\u90fd\u8bf4\u5230\u8fd9\u4efd\u4e0a\u4e86\u4f60\u61c2\u4e86\u5427',
    ].join('\n'),
  );

  assert.deepEqual(realEntries.map((entry) => entry.term), [
    '\u6a21\u7ec4',
    '\u8131\u5355',
    '\u95ee\u8001\u9a6c\u672c\u4eba',
    '\u5168\u90fd\u662f\u5bf9',
    '\u61c2\u4e86\u5427',
  ]);
});

test('findDictionaryEntriesWithTextEvidence keeps pig-nose insult for momentary dumb behavior criticism', () => {
  const dictionary = {
    entries: [
      {
        term: '\u732a\u9f3b',
        family: 'attack',
        meaning: 'criticizes someone as acting dumb or making a stupid move in the moment',
      },
    ],
  };

  const entries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    '\u4f60\u8fd9\u64cd\u4f5c\u771f\u732a\u9f3b\uff0c\u521a\u624d\u90a3\u6ce2\u5c31\u662f\u5728\u72af\u8822',
  );

  assert.deepEqual(entries.map((entry) => entry.term), ['\u732a\u9f3b']);
});

test('findDictionaryEntriesWithTextEvidence maps pig-nose insult homophones to the same criticism term', () => {
  const dictionary = {
    entries: [
      {
        term: '\u732a\u9f3b',
        family: 'attack',
        meaning: 'criticizes someone as acting dumb or making a stupid move in the moment',
      },
    ],
  };

  const entries = findDictionaryEntriesWithTextEvidence(
    dictionary,
    [
      '\u4f60\u8fd9\u6ce2\u771f\u732a\u903c\uff0c\u660e\u660e\u53ef\u4ee5\u5148\u770b\u5730\u56fe\u518d\u4e0a',
      '\u522b\u518d\u732a\u6bd4\u64cd\u4f5c\u4e86\uff0c\u521a\u624d\u90a3\u4e00\u4e0b\u5c31\u662f\u5728\u72af\u8822',
    ].join('\n'),
  );

  assert.deepEqual(entries.map((entry) => [entry.term, entry.evidenceCount]), [['\u732a\u9f3b', 2]]);
});

test('normalizeKeywordEntries prunes persisted literal traditional-character samples for video-language attack terms', () => {
  const entries = normalizeKeywordEntries([
    {
      term: '\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57',
      family: 'attack',
      meaning: '\u7528\u7e41\u4f53\u5b57\u6307\u8d23UP\u4e3b\u6216\u8d34\u6807\u7b7e',
      evidenceCount: 5,
      evidenceSamples: [
        'UP\u662f\u9999\u6e2f\u4eba\u5417\uff1f\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57\u3002\u53bb\u77ed\u89c6\u9891\u5e73\u53f0\u53d1\u5427\uff0c\u963fB\u8fd9\u8fb9\u4e0d\u592a\u597d\u9a97',
        '\u533b\u53e4\u6587 \u4e00\u672c\u6559\u6750\u9664\u4e86\u5e8f\u8a00\u5168\u662f\u7e41\u4f53\u5b57\u3002\u54ed\u8fbd',
        '\u6f2b\u753b\u5168\u662f\u7e41\u4f53\u5b57',
      ],
      evidenceSources: [
        { source: 'Bilibili public video comment scan', uid: 'BVattack', sample: 'UP\u662f\u9999\u6e2f\u4eba\u5417\uff1f\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57\u3002\u53bb\u77ed\u89c6\u9891\u5e73\u53f0\u53d1\u5427\uff0c\u963fB\u8fd9\u8fb9\u4e0d\u592a\u597d\u9a97' },
        { source: 'Bilibili public video comment scan', uid: 'BVliteral1', sample: '\u533b\u53e4\u6587 \u4e00\u672c\u6559\u6750\u9664\u4e86\u5e8f\u8a00\u5168\u662f\u7e41\u4f53\u5b57\u3002\u54ed\u8fbd' },
        { source: 'Bilibili public video comment scan', uid: 'BVliteral2', sample: '\u6f2b\u753b\u5168\u662f\u7e41\u4f53\u5b57' },
      ],
    },
  ]);

  assert.equal(entries[0].evidenceCount, 1);
  assert.deepEqual(entries[0].evidenceSamples, [
    'UP\u662f\u9999\u6e2f\u4eba\u5417\uff1f\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57\u3002\u53bb\u77ed\u89c6\u9891\u5e73\u53f0\u53d1\u5427\uff0c\u963fB\u8fd9\u8fb9\u4e0d\u592a\u597d\u9a97',
  ]);
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

test('trainKeywordDictionary fallback treats zhubi as dumb-action criticism', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-zhubi-fallback-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const result = await trainKeywordDictionary(
      {
        text: '\u4f60\u521a\u624d\u8fd9\u6ce2\u732a\u9f3b\u64cd\u4f5c\uff0c\u628a\u961f\u53cb\u90fd\u770b\u61f5\u4e86',
        uid: 'BV-zhubi',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-zhubi/',
      },
      {
        dictionaryPath,
        env: {},
      },
    );

    const entry = result.dictionary.entries.find((item) => item.term === '\u732a\u9f3b');
    assert.equal(result.usedFallback, true);
    assert.equal(entry.family, 'attack');
    assert.equal(entry.meaning.includes('\u5f53\u4e0b\u884c\u4e3a\u72af\u8822'), true);
    assert.deepEqual(entry.evidenceSamples, ['\u4f60\u521a\u624d\u8fd9\u6ce2\u732a\u9f3b\u64cd\u4f5c\uff0c\u628a\u961f\u53cb\u90fd\u770b\u61f5\u4e86']);
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

test('trainKeywordDictionary rejects DeepSeek existing-term evidence that lacks the matched term surface', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-existing-deepseek-surface-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await mergeEntriesIntoDictionary(
      [
        { term: '\u5173\u4e86\u5427\u6ca1\u610f\u601d', family: 'attack', meaning: 'dismissive command to stop watching because it is pointless', confidence: 0.7 },
      ],
      { dictionaryPath },
    );

    const result = await trainKeywordDictionary(
      {
        text: '\u4f60\u770b\u5f39\u5e55\u91cc\u8ba9\u4f60\u770b\u5f39\u5e55\u7684\u5c31\u77e5\u9053\u4ec0\u4e48\u53eb\u9ed1\u516c\u5173\u4e86\u5427',
        uid: 'BV-existing-deepseek-surface',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-existing-deepseek-surface/',
        existingTermsOnly: true,
        targetExistingTerms: ['\u5173\u4e86\u5427\u6ca1\u610f\u601d'],
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
                      matches: [
                        {
                          term: '\u5173\u4e86\u5427\u6ca1\u610f\u601d',
                          evidence: '\u4f60\u770b\u5f39\u5e55\u91cc\u8ba9\u4f60\u770b\u5f39\u5e55\u7684\u5c31\u77e5\u9053\u4ec0\u4e48\u53eb\u9ed1\u516c\u5173\u4e86\u5427',
                          confidence: 0.9,
                        },
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

    assert.deepEqual(result.dictionaryEvidenceEntries, []);
    assert.equal(result.dictionary.entries.find((entry) => entry.term === '\u5173\u4e86\u5427\u6ca1\u610f\u601d').evidenceCount || 0, 0);
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

test('writeJsonFileAtomic leaves a complete JSON file and removes sibling temp files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dict-atomic-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    await writeJsonFileAtomic(dictionaryPath, {
      version: 1,
      entries: [{ term: '\u5b8c\u6574\u5199\u5165', family: 'cooperation' }],
    });

    const parsed = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    const files = await readdir(dir);

    assert.equal(parsed.entries[0].term, '\u5b8c\u6574\u5199\u5165');
    assert.deepEqual(files, ['dictionary.json']);
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

test('trainKeywordDictionary forwards abort signal to DeepSeek keyword requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-abort-signal-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  const controller = new AbortController();
  const seenSignals = [];
  try {
    const result = await trainKeywordDictionary(
      {
        text: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427',
        uid: 'BV-abort-signal',
      },
      {
        dictionaryPath,
        signal: controller.signal,
        env: {
          DEEPSEEK_API_KEY: 'test-key',
          DEEPSEEK_MODEL: 'deepseek-v4-flash',
          DEEPSEEK_REASONING_EFFORT: 'medium',
        },
        fetch: async (url, options = {}) => {
          if (String(url).endsWith('/models')) {
            return { ok: true, json: async () => ({ data: [{ id: 'deepseek-v4-flash' }] }) };
          }
          seenSignals.push(options.signal);
          return {
            ok: true,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      keywords: [{ term: '\u4e0d\u4f1a\u771f\u6709\u4eba', family: 'attack', meaning: 'sarcastic challenge' }],
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
    assert.deepEqual(seenSignals, [controller.signal]);
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

test('maps DeepSeek meme family output to non-attack dictionary evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-meme-family-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const result = await trainKeywordDictionary(
      {
        text: '\u8fd9\u91cc\u5237doge\u53ea\u662f\u5f39\u5e55\u73a9\u6897\uff0c\u4e0d\u662f\u5728\u9a82\u4eba\u3002',
        uid: 'BV-meme-family',
        source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV-meme-family/',
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
                      keywords: [{ term: 'doge', family: 'meme', meaning: 'danmaku meme marker, not an attack', risk: 'neutral', confidence: 0.86 }],
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
    assert.deepEqual(result.entries.map((entry) => [entry.term, entry.family]), [['doge', 'cooperation']]);
    assert.deepEqual(result.dictionary.families.attack, []);
    assert.deepEqual(result.dictionary.families.cooperation, ['doge']);
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
