export const RADAR_AXES = ['对抗性动机', '认知闭合', '证据敏感', '逻辑一致', '合作讨论', '修正意愿'];

const AXIS_ALIASES = new Map([
  ['attack', '对抗性动机'],
  ['closure', '认知闭合'],
  ['evidence', '证据敏感'],
  ['logic', '逻辑一致'],
  ['cooperation', '合作讨论'],
  ['correction', '修正意愿'],
  ...RADAR_AXES.map((axis) => [axis, axis]),
]);

const POSITIVE_RISKS = new Set(['positive', 'low']);

function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function normalizeRadarAxis(axis) {
  return AXIS_ALIASES.get(String(axis || '').trim()) || '';
}

function normalizeDirection(direction, risk) {
  const clean = String(direction || '').trim().toLowerCase();
  if (clean === 'positive' || clean === 'support') return 'positive';
  if (clean === 'risk' || clean === 'negative') return 'risk';
  return POSITIVE_RISKS.has(String(risk || '').trim().toLowerCase()) ? 'positive' : 'risk';
}

function inferSentenceImpact(sentence = {}) {
  const text = [sentence.quote, sentence.speechAct, sentence.target, sentence.stance, sentence.contextRole, sentence.reasoning]
    .map((item) => String(item || ''))
    .join(' ');
  const risk = String(sentence.risk || '').trim().toLowerCase();
  const direction = POSITIVE_RISKS.has(risk) ? 'positive' : 'risk';
  if (/修正|改结论|更正|承认|说重|错/.test(text)) return { axis: '修正意愿', direction, strength: 0.75 };
  if (/来源|证据|数据|样本|原文|链接/.test(text)) return { axis: '证据敏感', direction, strength: 0.7 };
  if (/合作|让步|澄清|条件|如果|愿意/.test(text)) return { axis: '合作讨论', direction, strength: 0.7 };
  if (/逻辑|偷换|因果|类比|以偏概全|稻草人/.test(text)) return { axis: '逻辑一致', direction, strength: 0.65 };
  if (/所有|全部|根本|一定|必然|绝对|都一个样/.test(text)) return { axis: '认知闭合', direction: 'risk', strength: 0.7 };
  return { axis: '对抗性动机', direction, strength: risk === 'high' ? 0.75 : 0.45 };
}

function normalizeAxisImpact(impact = {}, sentence = {}) {
  const axis = normalizeRadarAxis(impact.axis);
  if (!axis) return null;
  return {
    axis,
    direction: normalizeDirection(impact.direction, sentence.risk),
    strength: clamp01(impact.strength, 0.5),
    reasoning: String(impact.reasoning || '').trim().slice(0, 240),
  };
}

export function buildSentenceRadarMarks(sentenceAnalyses = [], options = {}) {
  const confidence = clamp01(options.confidence, 0.7);
  return sentenceAnalyses.flatMap((sentence, sentenceIndex) => {
    const quote = String(sentence?.quote || '').trim();
    if (!quote) return [];
    const rawImpacts = Array.isArray(sentence.axisImpacts) && sentence.axisImpacts.length > 0 ? sentence.axisImpacts : [inferSentenceImpact(sentence)];
    return rawImpacts
      .map((impact, impactIndex) => normalizeAxisImpact(impact, sentence))
      .filter(Boolean)
      .slice(0, 3)
      .map((impact, impactIndex) => ({
        id: `sentence-radar-${sentenceIndex}-${impact.axis}-${impactIndex}`,
        quote,
        axis: impact.axis,
        direction: impact.direction,
        strength: impact.strength,
        speechAct: String(sentence.speechAct || '完整句判断').trim(),
        target: String(sentence.target || '整句语境').trim(),
        risk: String(sentence.risk || 'neutral').trim(),
        reasoning: impact.reasoning || String(sentence.reasoning || sentence.contextRole || '').trim().slice(0, 240),
        confidence,
      }));
  });
}
