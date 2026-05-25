export const RADAR_AXES = ['对抗性动机', '认知闭合', '证据敏感', '逻辑一致', '合作讨论', '修正意愿'];

const AXIS_ALIASES = new Map([
  ['attack', '对抗性动机'],
  ['antagonism', '对抗性动机'],
  ['ad_hominem', '对抗性动机'],
  ['person_attack', '对抗性动机'],
  ['对抗', '对抗性动机'],
  ['攻击', '对抗性动机'],
  ['攻击性', '对抗性动机'],
  ['人身攻击', '对抗性动机'],
  ['阵营攻击', '对抗性动机'],
  ['动机揣测', '对抗性动机'],
  ['closure', '认知闭合'],
  ['cognitive_closure', '认知闭合'],
  ['absolute', '认知闭合'],
  ['absolutes', '认知闭合'],
  ['generalization', '认知闭合'],
  ['认知封闭', '认知闭合'],
  ['绝对化', '认知闭合'],
  ['全称判断', '认知闭合'],
  ['泛化', '认知闭合'],
  ['evidence', '证据敏感'],
  ['evidence_sensitivity', '证据敏感'],
  ['source_checking', '证据敏感'],
  ['举证', '证据敏感'],
  ['证据', '证据敏感'],
  ['信源', '证据敏感'],
  ['来源意识', '证据敏感'],
  ['logic', '逻辑一致'],
  ['logical_consistency', '逻辑一致'],
  ['reasoning', '逻辑一致'],
  ['逻辑', '逻辑一致'],
  ['论证', '逻辑一致'],
  ['因果', '逻辑一致'],
  ['cooperation', '合作讨论'],
  ['collaboration', '合作讨论'],
  ['constructive', '合作讨论'],
  ['合作', '合作讨论'],
  ['澄清', '合作讨论'],
  ['让步', '合作讨论'],
  ['讨论意愿', '合作讨论'],
  ['correction', '修正意愿'],
  ['self_correction', '修正意愿'],
  ['revision', '修正意愿'],
  ['修正', '修正意愿'],
  ['更正', '修正意愿'],
  ['承认错误', '修正意愿'],
  ['改结论', '修正意愿'],
  ...RADAR_AXES.map((axis) => [axis, axis]),
]);

const POSITIVE_RISKS = new Set(['positive', 'low']);
const RISK_RISKS = new Set(['high', 'medium']);

function clamp01(value, fallback = 0.5) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

export function normalizeRadarAxis(axis) {
  const clean = String(axis || '').trim();
  if (!clean) return '';
  return AXIS_ALIASES.get(clean) || AXIS_ALIASES.get(clean.toLowerCase()) || '';
}

function normalizeDirection(direction, risk) {
  const clean = String(direction || '').trim().toLowerCase();
  if (clean === 'positive' || clean === 'support') return 'positive';
  if (clean === 'risk' || clean === 'negative') return 'risk';
  return POSITIVE_RISKS.has(String(risk || '').trim().toLowerCase()) ? 'positive' : 'risk';
}

function sentenceText(sentence = {}) {
  return [sentence.quote, sentence.speechAct, sentence.target, sentence.stance, sentence.contextRole, sentence.reasoning]
    .map((item) => String(item || ''))
    .join(' ');
}

function isMemeOrQuotedNonAttack(sentence = {}) {
  const text = sentenceText(sentence);
  const hasMemeFrame = /(?:\u6897|\u73a9\u6897|\u540d\u573a\u9762|\u53f0\u8bcd|\u5f15\u7528|\u590d\u8ff0|\u8f6c\u8ff0|\u8868\u60c5\u5305|\u539f\u8bdd|\u6bb5\u5b50|\u8c10\u97f3|meme|quote|quoted|copypasta|catchphrase|inside joke)/i.test(text);
  if (!hasMemeFrame) return false;
  return /(?:\u4e0d\u662f\u9a82|\u4e0d\u662f\u653b\u51fb|\u6ca1\u6709\u9a82|\u6ca1\u6709\u653b\u51fb|\u53ea\u662f|\u4ec5\u4ec5|\u7528\u6765\u8c03\u4f83|\u5f00\u73a9\u7b11|\u8c03\u4f83|\u73a9\u7b11|not attacking|not an attack|not insulting|just a meme|only a meme|as a joke|joking)/i.test(text);
}

function addImpact(impacts, impact) {
  const axis = normalizeRadarAxis(impact.axis);
  if (!axis) return;
  const existing = impacts.find((item) => item.axis === axis && item.direction === impact.direction);
  const strength = clamp01(impact.strength, 0.5);
  if (!existing) {
    impacts.push({ ...impact, axis, strength });
    return;
  }
  if (strength > existing.strength) existing.strength = strength;
  if (!existing.reasoning && impact.reasoning) existing.reasoning = impact.reasoning;
}

function inferSentenceImpacts(sentence = {}) {
  const text = sentenceText(sentence);
  const risk = String(sentence.risk || '').trim().toLowerCase();
  const defaultDirection = POSITIVE_RISKS.has(risk) ? 'positive' : 'risk';
  const memeNonAttack = isMemeOrQuotedNonAttack(sentence);
  const impacts = [];

  if (/修正|改结论|更正|承认|说重|错了|搞错|记错|收回|愿意改|可以改|感谢指正|谢谢指正/.test(text)) {
    addImpact(impacts, { axis: '修正意愿', direction: 'positive', strength: 0.78, reasoning: '整句表达愿意承认、修正或降低结论强度。' });
  }
  if (/来源|证据|数据|样本|原文|链接|出处|引用|截图|信源|有据|无图无真相|证据链|覆盖|可核验/.test(text)) {
    addImpact(impacts, {
      axis: '证据敏感',
      direction: /张口就来|没证据|证据不足|来源呢|出处在哪|贴原文|发链接|可核验|样本|证据链|覆盖/.test(text) ? 'positive' : defaultDirection,
      strength: /证据链|可核验|原始数据|出处在哪|贴原文|发链接/.test(text) ? 0.78 : 0.68,
      reasoning: '整句围绕证据、来源、样本范围或可核验性展开。'
    });
  }
  if (/合作|让步|澄清|条件|如果|可以贴|我理解|补充|据我所知|就我所见|可能|不一定|愿意|一起看|先别急/.test(text)) {
    addImpact(impacts, { axis: '合作讨论', direction: 'positive', strength: 0.68, reasoning: '整句保留澄清、让步或继续讨论的空间。' });
  }
  if (/逻辑|偷换|因果|类比|以偏概全|稻草人|前后矛盾|自相矛盾|推不出|论证/.test(text)) {
    addImpact(impacts, { axis: '逻辑一致', direction: defaultDirection, strength: 0.66, reasoning: '整句评价论证关系、因果链或逻辑一致性。' });
  }
  if (/所有|全部|全都|全是|根本|一定|必然|绝对|肯定|从来|永远|都一个样|没有一个|一律|百分百/.test(text)) {
    addImpact(impacts, { axis: '认知闭合', direction: 'risk', strength: risk === 'high' ? 0.86 : 0.72, reasoning: '整句使用全称化、绝对化或封闭判断。' });
  }
  if (/扣帽子|急了|破防|滚粗|小丑|逆天|懂哥|杠精|精神.{0,4}人|孝|典中典|赢麻了|人身|阵营|动机|洗地|殖人|粉红|水军|别来沾边|复活赛|比兜/.test(text)) {
    addImpact(impacts, {
      axis: '对抗性动机',
      direction: 'risk',
      strength: RISK_RISKS.has(risk) ? 0.75 : /不是我杠|先别急|别急着扣帽子/.test(text) ? 0.25 : 0.55,
      reasoning: '整句包含攻击性标签、阵营化指称或对抗性语气。'
    });
  }

  if (/\b(correct|correction|revise|revision|self[-_ ]?correct|admit|update conclusion|change my mind|thanks for correcting)\b/i.test(text)) {
    addImpact(impacts, { axis: 'correction', direction: 'positive', strength: 0.76, reasoning: 'The full sentence signals willingness to revise or accept correction.' });
  }
  if (/\b(evidence|source|proof|data|sample|citation|reference|link|verifiable|burden of proof|show receipts)\b/i.test(text)) {
    addImpact(impacts, { axis: 'evidence', direction: defaultDirection, strength: 0.7, reasoning: 'The full sentence is organized around evidence, sourcing, or verification.' });
  }
  if (/\b(cooperate|cooperation|clarify|clarification|condition|conditional|maybe|possibly|open to|willing to discuss|common ground)\b/i.test(text)) {
    addImpact(impacts, { axis: 'cooperation', direction: 'positive', strength: 0.66, reasoning: 'The full sentence keeps room for clarification, conditions, or continued discussion.' });
  }
  if (/\b(logic|logical|reasoning|causal|causation|analogy|contradiction|inconsistent|straw ?man|false equivalence|non sequitur)\b/i.test(text)) {
    addImpact(impacts, { axis: 'logic', direction: defaultDirection, strength: 0.66, reasoning: 'The full sentence evaluates the reasoning relation instead of only naming a topic.' });
  }
  if (/\b(always|never|everyone|nobody|all of them|none of them|absolute|certainly|must be|no exception|百分百)\b/i.test(text)) {
    addImpact(impacts, { axis: 'closure', direction: 'risk', strength: risk === 'high' ? 0.84 : 0.7, reasoning: 'The full sentence uses absolute or closed-category judgment.' });
  }
  if (/\b(insult|ad hominem|personal attack|labeling|motive guessing|camp attack|fandom attack|brigading|shill|hater)\b/i.test(text)) {
    addImpact(impacts, { axis: 'attack', direction: 'risk', strength: RISK_RISKS.has(risk) ? 0.76 : 0.58, reasoning: 'The full sentence targets identity, motive, or faction rather than only the proposition.' });
  }

  if (impacts.length === 0) {
    addImpact(impacts, {
      axis: '对抗性动机',
      direction: defaultDirection,
      strength: risk === 'high' ? 0.75 : 0.45,
      reasoning: '模型未给出明确轴时，按整句风险等级保守映射到对抗性动机。'
    });
  }

  if (memeNonAttack) {
    addImpact(impacts, {
      axis: 'cooperation',
      direction: 'positive',
      strength: 0.55,
      reasoning: 'The sentence explicitly frames the keyword as meme, quote, or playful reuse, so the keyword alone is not attack evidence.',
    });
    const attackAxis = normalizeRadarAxis('attack');
    return impacts
      .filter((impact) => !(impact.axis === attackAxis && impact.direction === 'risk' && impact.strength > 0.25))
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 3);
  }

  return impacts
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);
}

function normalizeAxisImpact(impact = {}, sentence = {}) {
  const axis = normalizeRadarAxis(impact.axis);
  if (!axis) return null;
  const direction = normalizeDirection(impact.direction, sentence.risk);
  const memeCappedAttack = isMemeOrQuotedNonAttack(sentence) && axis === normalizeRadarAxis('attack') && direction === 'risk';
  return {
    axis,
    direction,
    strength: memeCappedAttack ? Math.min(clamp01(impact.strength, 0.5), 0.25) : clamp01(impact.strength, 0.5),
    reasoning: String(
      memeCappedAttack
        ? impact.reasoning || 'Keyword appears inside a meme/quote frame, so attack impact is capped without a hostile target.'
        : impact.reasoning || '',
    ).trim().slice(0, 240),
  };
}

function hasAsciiSemanticHints(sentence = {}) {
  return /\b(correct|correction|revise|revision|self[-_ ]?correct|admit|update conclusion|change my mind|thanks for correcting|evidence|source|proof|data|sample|citation|reference|link|verifiable|burden of proof|show receipts|cooperate|cooperation|clarify|clarification|condition|conditional|maybe|possibly|open to|willing to discuss|common ground|logic|logical|reasoning|causal|causation|analogy|contradiction|inconsistent|straw ?man|false equivalence|non sequitur|always|never|everyone|nobody|all of them|none of them|absolute|certainly|must be|no exception|insult|ad hominem|personal attack|labeling|motive guessing|camp attack|fandom attack|brigading|shill|hater)\b/i.test(sentenceText(sentence));
}

function composeSentenceImpacts(modelImpacts, sentence) {
  if (!hasAsciiSemanticHints(sentence)) return modelImpacts;
  const impacts = [];
  for (const impact of modelImpacts) addImpact(impacts, impact);
  for (const impact of inferSentenceImpacts(sentence)) addImpact(impacts, impact);
  return impacts.sort((a, b) => b.strength - a.strength).slice(0, 3);
}

export function buildSentenceRadarMarks(sentenceAnalyses = [], options = {}) {
  const confidence = clamp01(options.confidence, 0.7);
  return sentenceAnalyses.flatMap((sentence, sentenceIndex) => {
    const quote = String(sentence?.quote || '').trim();
    if (!quote) return [];
    const modelImpacts = Array.isArray(sentence.axisImpacts) ? sentence.axisImpacts.map((impact) => normalizeAxisImpact(impact, sentence)).filter(Boolean) : [];
    const rawImpacts = modelImpacts.length > 0 ? composeSentenceImpacts(modelImpacts, sentence) : inferSentenceImpacts(sentence);
    return rawImpacts
      .map((impact, impactIndex) => normalizeAxisImpact(impact, sentence))
      .filter(Boolean)
      .slice(0, 3)
      .map((impact, impactIndex) => ({
        id: `sentence-radar-${sentenceIndex}-${impact.axis}-${impactIndex}`,
        sentenceIndex,
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
