import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSentenceRadarMarks } from './languageUnderstanding.js';

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

  assert.equal(marks.length, 1);
  assert.equal(marks[0].axis, '修正意愿');
  assert.equal(marks[0].direction, 'positive');
});
