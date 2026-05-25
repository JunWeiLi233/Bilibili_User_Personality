import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSentenceRadarMarks, normalizeRadarAxis } from './languageUnderstanding.js';

test('buildSentenceRadarMarks maps full sentence impacts onto radar axes', () => {
  const marks = buildSentenceRadarMarks(
    [
      {
        quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
        speechAct: '证据边界提醒',
        target: '证据链覆盖范围',
        stance: '反驳但保留合作空间',
        contextRole: '要求对方回到证据充分性',
        risk: 'low',
        axisImpacts: [
          { axis: '证据敏感', direction: 'positive', strength: 0.8, reasoning: '要求回到证据覆盖范围。' },
          { axis: '对抗性动机', direction: 'risk', strength: 0.2, reasoning: '有反驳语气但没有人身攻击。' },
        ],
      },
      {
        quote: '所有支持这个观点的人都一个样，根本不是讨论问题。',
        speechAct: '阵营泛化',
        target: '支持者群体',
        risk: 'high',
        axisImpacts: [{ axis: '认知闭合', direction: 'risk', strength: 0.9, reasoning: '用所有和都一个样做全称判断。' }],
      },
    ],
    { confidence: 0.82 },
  );

  assert.deepEqual(
    marks.map((mark) => ({
      axis: mark.axis,
      direction: mark.direction,
      strength: mark.strength,
      quote: mark.quote,
      speechAct: mark.speechAct,
    })),
    [
      {
        axis: '证据敏感',
        direction: 'positive',
        strength: 0.8,
        quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
        speechAct: '证据边界提醒',
      },
      {
        axis: '对抗性动机',
        direction: 'risk',
        strength: 0.2,
        quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
        speechAct: '证据边界提醒',
      },
      {
        axis: '认知闭合',
        direction: 'risk',
        strength: 0.9,
        quote: '所有支持这个观点的人都一个样，根本不是讨论问题。',
        speechAct: '阵营泛化',
      },
    ],
  );
  assert.equal(marks[0].confidence, 0.82);
  assert.equal(marks[0].sentenceIndex, 0);
  assert.equal(marks[1].sentenceIndex, 0);
  assert.equal(marks[2].sentenceIndex, 1);
  assert.equal(marks[0].target, '证据链覆盖范围');
});

test('buildSentenceRadarMarks infers radar axis when model omits axisImpacts', () => {
  const marks = buildSentenceRadarMarks([
    {
      quote: '如果有更完整的来源可以贴一下，我愿意改结论。',
      speechAct: '开放修正',
      target: '结论强度',
      risk: 'positive',
      reasoning: '愿意基于来源调整判断。',
    },
  ]);

  assert.equal(marks.length, 3);
  assert.equal(marks[0].axis, '修正意愿');
  assert.equal(marks[0].direction, 'positive');
  assert.deepEqual(marks.slice(1).map((mark) => mark.axis), ['证据敏感', '合作讨论']);
});

test('buildSentenceRadarMarks infers multiple sentence-level radar marks from full context', () => {
  const marks = buildSentenceRadarMarks([
    {
      quote: '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。',
      speechAct: '证据边界提醒',
      target: '样本覆盖范围',
      risk: 'low',
      reasoning: '先要求回到证据范围，同时提醒对方不要贴标签。',
    },
  ]);

  assert.deepEqual(
    marks.map((mark) => ({ axis: mark.axis, direction: mark.direction })),
    [
      { axis: '证据敏感', direction: 'positive' },
      { axis: '合作讨论', direction: 'positive' },
      { axis: '对抗性动机', direction: 'risk' },
    ],
  );
  assert.equal(marks[0].quote, '不是我杠，你这个证据链只覆盖一个样本，先别急着扣帽子。');
  assert.equal(marks[2].strength <= 0.3, true);
});

test('buildSentenceRadarMarks normalizes model axis aliases before rendering radar marks', () => {
  const marks = buildSentenceRadarMarks([
    {
      quote: '所有支持这个观点的人都一个样，根本不是讨论问题。',
      speechAct: '阵营泛化',
      target: '支持者群体',
      risk: 'high',
      axisImpacts: [
        { axis: 'absolutes', direction: 'negative', strength: 0.92, reasoning: '全称化判断。' },
        { axis: 'person_attack', direction: 'risk', strength: 0.66, reasoning: '把讨论对象转向人群标签。' },
      ],
    },
  ]);

  assert.deepEqual(
    marks.map((mark) => ({ axis: mark.axis, direction: mark.direction, strength: mark.strength })),
    [
      { axis: '认知闭合', direction: 'risk', strength: 0.92 },
      { axis: '对抗性动机', direction: 'risk', strength: 0.66 },
    ],
  );
});

test('buildSentenceRadarMarks supplements sparse model impacts with full-sentence semantic hints', () => {
  const marks = buildSentenceRadarMarks([
    {
      quote: 'Everyone in that camp is a shill, but show the source and I will revise my conclusion.',
      speechAct: 'mixed evidence request and motive labeling',
      target: 'camp identity and source quality',
      risk: 'medium',
      axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 0.62, reasoning: 'Targets faction identity.' }],
      reasoning: 'The sentence combines camp labeling with an evidence request and willingness to revise.',
    },
  ]);

  assert.equal(marks.length, 3);
  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('attack') && mark.direction === 'risk'), true);
  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('correction') && mark.direction === 'positive'), true);
  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('evidence') && mark.direction === 'risk'), true);
  assert.equal(marks[0].quote, 'Everyone in that camp is a shill, but show the source and I will revise my conclusion.');
});

test('buildSentenceRadarMarks does not treat meme quotes as direct attacks', () => {
  const quote = '\u8fd9\u53e5\u201c\u7ed9\u4f60\u4e00\u4e2a\u5927\u6bd4\u515c\u201d\u662f\u590d\u8ff0\u540d\u573a\u9762\u73a9\u6897\uff0c\u4e0d\u662f\u9a82\u4eba\u4e5f\u4e0d\u662f\u653b\u51fb\u8c01\u3002';
  const marks = buildSentenceRadarMarks([
    {
      quote,
      speechAct: '\u73a9\u6897\u5f15\u7528',
      target: '\u539f\u53f0\u8bcd',
      risk: 'neutral',
      reasoning: '\u8bcd\u9762\u6709\u653b\u51fb\u6027\uff0c\u4f46\u6574\u53e5\u660e\u786e\u8bf4\u662f\u540d\u573a\u9762\u73a9\u6897\u548c\u975e\u653b\u51fb\u7528\u6cd5\u3002',
    },
  ]);

  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('cooperation') && mark.direction === 'positive'), true);
  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('attack') && mark.strength > 0.25), false);
});

test('buildSentenceRadarMarks caps model attack impact for explicit meme quote usage', () => {
  const quote = 'Calling it a personal attack here is just a meme quote, not attacking the person.';
  const marks = buildSentenceRadarMarks([
    {
      quote,
      speechAct: 'meme quote',
      target: 'quoted catchphrase',
      risk: 'medium',
      axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 0.85, reasoning: 'Contains personal attack wording.' }],
    },
  ]);

  const attackMark = marks.find((mark) => mark.axis === normalizeRadarAxis('attack'));
  assert.equal(attackMark?.strength, 0.25);
  assert.equal(marks.some((mark) => mark.axis === normalizeRadarAxis('cooperation') && mark.direction === 'positive'), true);
});

test('buildSentenceRadarMarks treats quoted meme usage as non-attack without explicit disclaimer', () => {
  const quote = '\u8fd9\u53e5\u201c\u7ed9\u4f60\u4e00\u4e2a\u5927\u6bd4\u515c\u201d\u8fd9\u4e2a\u6897\u592a\u597d\u7b11\u4e86\uff0c\u53f0\u8bcd\u611f\u5f88\u5f3a\u3002';
  const marks = buildSentenceRadarMarks([
    {
      quote,
      speechAct: '\u73a9\u6897\u590d\u8ff0',
      target: '\u539f\u53f0\u8bcd',
      risk: 'medium',
      axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 0.82, reasoning: '\u542b\u6709\u201c\u6bd4\u515c\u201d\u7b49\u653b\u51fb\u8bcd\u9762\u3002' }],
    },
  ]);

  const attackMark = marks.find((mark) => mark.axis === normalizeRadarAxis('attack'));
  assert.equal(attackMark?.strength, 0.25);
});

test('buildSentenceRadarMarks keeps hostile targeted meme usage as attack evidence', () => {
  const quote = '\u4f60\u5c31\u662f\u4e2a\u5c0f\u4e11\uff0c\u522b\u62ff\u73a9\u6897\u5f53\u501f\u53e3\u3002';
  const marks = buildSentenceRadarMarks([
    {
      quote,
      speechAct: '\u76f4\u63a5\u8d34\u6807\u7b7e',
      target: '\u5bf9\u65b9',
      risk: 'high',
      axisImpacts: [{ axis: 'attack', direction: 'risk', strength: 0.82, reasoning: '\u76f4\u63a5\u628a\u5bf9\u65b9\u79f0\u4e3a\u5c0f\u4e11\u3002' }],
    },
  ]);

  const attackMark = marks.find((mark) => mark.axis === normalizeRadarAxis('attack'));
  assert.equal(attackMark?.strength, 0.82);
});
