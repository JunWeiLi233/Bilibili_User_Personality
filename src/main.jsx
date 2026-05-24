import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brain,
  ChartPolar,
  CheckCircle,
  ClipboardText,
  Detective,
  Faders,
  FlagBanner,
  Gauge,
  Lightning,
  MagnifyingGlass,
  Scales,
  ShieldWarning,
  WarningCircle,
} from '@phosphor-icons/react';
import './styles.css';

const INVERSE_AXES = new Set(['证据敏感', '逻辑一致', '合作讨论', '修正意愿']);

const analysisModes = [
  {
    id: 'hybrid',
    label: '混合模式',
    description: '语义裁判为主，动态语库为辅；适合中文梗、反讽和近义变体。',
  },
  {
    id: 'semantic',
    label: '语义裁判',
    description: '优先判断话语行为：攻击谁、是否回应命题、是否举证、是否修正。',
  },
  {
    id: 'lexicon',
    label: '语库模式',
    description: '只使用可解释词族和规则命中；透明但更容易落后于新梗。',
  },
];

const axisDescriptions = {
  对抗性动机: '从话语行为判断攻击目标是否从“观点”转向“人、阵营或动机”。',
  认知闭合: '从全称判断、必然化、拒绝歧义和过早定论判断闭合倾向。',
  证据敏感: '从是否给来源、回应反证、转移举证责任判断，数值越低风险越高。',
  逻辑一致: '从稻草人、偷换概念、以偏概全和因果跳跃判断，数值越低风险越高。',
  合作讨论: '从澄清、让步、限定条件和复述对方观点判断，数值越低风险越高。',
  修正意愿: '从被纠错后的承认、补充、降级表述和沉默/反击判断，数值越低风险越高。',
};

const researchFrames = [
  {
    label: '讽刺与反讽检测',
    source: 'Chinese social media sarcasm studies',
    claim: '表面情绪和真实意图可能相反，必须结合上下文和话语功能，而不是只看词面。',
  },
  {
    label: '线上去抑制',
    source: 'Suler, 2004',
    claim: '匿名性、不可见性与异步反馈会降低自我约束，使挑衅和羞辱性表达更容易出现。',
  },
  {
    label: '动机性推理',
    source: 'Kunda, 1990',
    claim: '人会选择性寻找支持自身立场的信息，并对反证采用更高的怀疑门槛。',
  },
  {
    label: '语用论辩',
    source: 'van Eemeren & Grootendorst',
    claim: '谬误可视为破坏批判性讨论规则的语言行动，而不是单纯“说话难听”。',
  },
];

const sampleTextA = `你连这个都不懂还谈产业？国产替代就是骗补，哪个不是 PPT 项目？
B 站早就没有长视频创作者了，都是切片号。
你说要看数据，其实就是给资本洗地。
笑死，这种观点也有人信，真是被营销洗傻了。
别扯什么来源，你自己搜一下不就知道了。
所有支持这个观点的人都一个样，根本不是讨论问题。`;

const sampleTextB = `这个优化像上次那款一样翻车，所以估计也撑不了多久。
厂家肯定偷偷降规格了，不然不会这样。
我看了一下评测数据，可能是固件版本不同，前面那句我说重了。
如果有更完整的来源可以贴一下，我愿意改结论。
这个类比不一定准确，但目前样本里确实有两个相似案例。`;

const bilibiliFetchedSamples = [
  {
    name: 'BV19y 评论样本 A',
    uid: 'mid 130960422 · BV19yGa61Ee6',
    source: '公开视频热门评论/楼中楼聚合',
    text: `谁是正宗核心供应商，谁是蹭概念
回复 @costoffree :可以不信，但不能怀疑事实
回复 @小陈子爱长沙 :👌
回复 @猫子樱桃 :正在做`,
  },
  {
    name: 'BV19y 评论样本 B',
    uid: 'mid 8567536 · BV19yGa61Ee6',
    source: '公开视频热门评论/楼中楼聚合',
    text: `核心供应商都在国内，为啥我们做不出来
回复 @关中王-李 :星舰v3作为人类历史上推力第一的火箭，起飞推力8240吨。我国现役最强火箭长征五号，起飞推力1000吨，目前规划的长征九号，起飞推力预计6000吨，请问你说的正在做，是指哪艘？`,
  },
  {
    name: 'BV19y 评论样本 C',
    uid: 'mid 1438219989 · BV19yGa61Ee6',
    source: '公开视频热门评论/楼中楼聚合',
    text: `回复 @老王头头头头头 :抄作业是指抄答案。不管题目。给专利费买专利是买解题思路和答案。连最基础的你都搞不懂。
回复 @燃烧的拖把 :我了解的不够全面。我知道了，在火箭回收方面空差X确实开放了部分非核心专利。网络上可以查得到。还有就是特斯拉。那句话怎么说来着？如果不是马上开源国内的电动车产业能如此飞快的崛起吗？
开放了包括但不限于三电系统、充电技术、Autopilot/FSD核心软件技术、初代Roadster相关专利。
回复 @燃烧的拖把 :另外就是你可以去空X官网看一看。人家在上面公布了很多相关的技术。这些都已经不是秘密。为此。国内有些不要脸的公司还拿来在国内注册的专利。承认别人强很难吗？`,
  },
];

const baseLexicons = {
  attack: ['你懂', '洗傻', '笑死', '智商', '脑子', '蠢', '跪', '急了', '别扯', '装', '洗地', '你连', '典', '孝', '绷', '小丑'],
  absolutes: ['所有', '全部', '都是', '从来', '永远', '肯定', '必然', '早就没有', '哪个不是', '根本', '没有一个'],
  evidence: ['数据', '来源', '论文', '报告', '统计', '样本', '链接', '证据', '评测', '引用'],
  evasion: ['你自己搜', '这还用说', '懂的都懂', '懒得解释', '不解释', '自己查', '这还用问'],
  cooperation: ['如果', '可能', '不一定', '我理解', '你是说', '能否', '可以贴', '我愿意', '补充', '限定'],
  correction: ['我错了', '我说重了', '更正', '修正', '前面那句', '改结论', '承认', '确实'],
};

const lexiconFamilies = [
  {
    key: 'attack',
    label: '攻击/嘲讽语义族',
    description: '不只抓脏词，也抓资格审查、阴阳怪气、阵营标签和新梗。',
    examples: ['你急了', '典', '孝', '洗地', '懂哥'],
  },
  {
    key: 'absolutes',
    label: '绝对化断言语义族',
    description: '用于识别高认知闭合：全称判断、必然化、零例外表达。',
    examples: ['全是', '必然', '根本', '没有一个', '早就'],
  },
  {
    key: 'evasion',
    label: '举证回避语义族',
    description: '关注把证明责任推给对方的话术，而不是单个固定短语。',
    examples: ['自己查', '懂的都懂', '不解释', '这还用问'],
  },
  {
    key: 'cooperation',
    label: '合作性修正语义族',
    description: '保留反向证据，避免把正常反驳误判成杠。',
    examples: ['可能', '不一定', '我说重了', '可以补充'],
  },
];

const speechActRules = [
  {
    act: '人身/资格攻击',
    type: '情绪化表达',
    severity: '高',
    target: '人',
    pattern: /(你懂|你连|智商|脑子|洗傻|小丑|蠢|急了|典|孝|绷|笑死).{0,20}/,
    diagnosis: '攻击对象从命题转向发言者能力或身份，讨论收益主要来自羞辱而非论证。',
    deltas: { attack: 28, cooperation: -18, logic: -10 },
  },
  {
    act: '阵营/动机归因',
    type: '语义偷换',
    severity: '高',
    target: '动机',
    pattern: /(其实就是|所以你就是|给资本|洗地|收钱|屁股|站队).{0,22}/,
    diagnosis: '把方法、证据要求或局部观点改写成立场归属，绕开原命题。',
    deltas: { attack: 20, logic: -24, cooperation: -14 },
  },
  {
    act: '举证责任转移',
    type: '缺证断言',
    severity: '中',
    target: '证明责任',
    pattern: /(你自己搜|自己查|懂的都懂|这还用问|懒得解释|不解释).{0,20}/,
    diagnosis: '要求对方替自己完成证明，削弱可核验性。',
    deltas: { evidence: -28, cooperation: -10 },
  },
  {
    act: '全称化/过度概括',
    type: '逻辑错误',
    severity: '中',
    target: '命题范围',
    pattern: /(所有|全部|都是|没有一个|哪个不是|从来|永远|根本).{0,24}/,
    diagnosis: '把有限样本扩展成全称判断，缺少边界条件。',
    deltas: { closure: 26, logic: -20 },
  },
  {
    act: '强事实断言缺证',
    type: '事实错误',
    severity: '中',
    target: '事实',
    pattern: /(早就没有|不可能|必然|肯定|绝对).{0,24}/,
    diagnosis: '使用强事实断言但没有同步给出可核验来源。',
    deltas: { closure: 18, evidence: -16, logic: -10 },
  },
  {
    act: '合作性限定',
    type: '低风险讨论',
    severity: '低',
    target: '观点',
    pattern: /(可能|不一定|如果|我理解|能否|可以贴|补充|限定).{0,24}/,
    diagnosis: '使用条件化和澄清表达，说明仍在推进命题讨论。',
    deltas: { cooperation: 24, evidence: 8, closure: -10 },
    positive: true,
  },
  {
    act: '显式修正',
    type: '低风险讨论',
    severity: '低',
    target: '自我修正',
    pattern: /(我错了|我说重了|更正|修正|改结论|承认).{0,24}/,
    diagnosis: '出现自我修正或结论降级，是区分正常争论和杠精行为的重要反向证据。',
    deltas: { correction: 32, cooperation: 12 },
    positive: true,
  },
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function buildRuntimeLexicon(customLexicon = {}) {
  return Object.fromEntries(
    Object.entries(baseLexicons).map(([key, terms]) => {
      const customTerms = customLexicon[key] || [];
      return [key, [...new Set([...terms, ...customTerms])]];
    }),
  );
}

function splitComments(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function countMatches(text, terms) {
  return terms.reduce((sum, term) => sum + (text.split(term).length - 1), 0);
}

function perThousand(text, terms) {
  return (countMatches(text, terms) / Math.max(text.length, 1)) * 1000;
}

function classifySpeechAct(comment, index, totalComments) {
  const matched = speechActRules
    .map((rule) => {
      const match = comment.match(rule.pattern);
      if (!match) return null;
      return {
        id: `semantic-${index}-${rule.act}`,
        source: '语义裁判',
        speechAct: rule.act,
        target: rule.target,
        type: rule.type,
        severity: rule.severity,
        comment,
        highlight: match[0].trim(),
        diagnosis: `${rule.act}。${rule.diagnosis}`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中话语行为规则；重点检查它是否仍在回应原命题。`,
        confidence: rule.positive ? 0.64 : rule.severity === '高' ? 0.86 : 0.75,
        deltas: rule.deltas,
        positive: rule.positive,
      };
    })
    .filter(Boolean);

  return matched.length > 0
    ? matched
    : [
        {
          id: `semantic-neutral-${index}`,
          source: '语义裁判',
          speechAct: '普通观点表达',
          target: '观点',
          type: '未检出高风险错误',
          severity: '低',
          comment,
          highlight: comment,
          diagnosis: '未发现明显攻击、偷换、举证回避或强全称化。仍需结合上下文判断事实真伪。',
          evidence: `第 ${index + 1}/${totalComments} 条评论未命中高风险话语行为规则。`,
          confidence: 0.54,
          deltas: {},
          neutral: true,
        },
      ];
}

function classifyLexiconError(comment, index, totalComments, runtimeLexicon) {
  const lexiconRules = [
    {
      type: '情绪化表达',
      severity: '中',
      terms: runtimeLexicon.attack,
      diagnosis: '动态语库命中攻击或嘲讽语义族，建议再看上下文确认是否为玩笑、引用或反讽。',
    },
    {
      type: '缺证断言',
      severity: '中',
      terms: runtimeLexicon.evasion,
      diagnosis: '动态语库命中举证回避语义族，可能存在证明责任转移。',
    },
    {
      type: '逻辑错误',
      severity: '中',
      terms: runtimeLexicon.absolutes,
      diagnosis: '动态语库命中绝对化断言语义族，可能存在过度概括。',
    },
  ];

  for (const rule of lexiconRules) {
    const term = rule.terms.find((item) => comment.includes(item));
    if (term) {
      return {
        id: `lexicon-${index}-${term}`,
        source: '动态语库',
        speechAct: '词族风险提示',
        target: '词面线索',
        type: rule.type,
        severity: rule.severity,
        comment,
        highlight: term,
        diagnosis: rule.diagnosis,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中“${term}”。词面命中只作为辅助证据，不单独定性。`,
        confidence: 0.62,
      };
    }
  }
  return null;
}

function inferCandidateFamily(term, sourceLine) {
  if (/[都全根必肯没无]/.test(term) || /(所有|全部|根本|肯定|必然)/.test(sourceLine)) return 'absolutes';
  if (/(搜|查|解释|懂)/.test(term) || /(你自己搜|懂的都懂|懒得解释)/.test(sourceLine)) return 'evasion';
  if (/(可能|如果|数据|来源|补充|更正)/.test(sourceLine)) return 'cooperation';
  return 'attack';
}

function extractCandidateTerms(text, runtimeLexicon) {
  const known = new Set(Object.values(runtimeLexicon).flat());
  const stop = new Set(['这个', '不是', '就是', '一下', '观点', '评论', '数据', '来源', '如果', '可以', '没有', '因为']);
  const candidates = new Map();
  splitComments(text).forEach((line) => {
    const compact = line.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
    for (let size = 2; size <= 4; size += 1) {
      for (let index = 0; index <= compact.length - size; index += 1) {
        const term = compact.slice(index, index + size);
        if (known.has(term) || stop.has(term) || /^\d+$/.test(term)) continue;
        const contextBoost = /你|都|全|洗|急|懂|孝|典|赢|绷|乐|搜|查|根|肯/.test(term) ? 2 : 1;
        const item = candidates.get(term) || {
          term,
          score: 0,
          sourceLine: line,
          family: inferCandidateFamily(term, line),
        };
        item.score += contextBoost;
        candidates.set(term, item);
      }
    }
  });
  return [...candidates.values()]
    .filter((item) => item.score >= 2)
    .sort((a, b) => b.score - a.score || b.term.length - a.term.length)
    .slice(0, 8);
}

function normalizeForRisk(score) {
  return INVERSE_AXES.has(score.axis) ? 100 - score.value : score.value;
}

function getRiskBand(index) {
  if (index >= 70) return '高风险对抗型';
  if (index >= 45) return '混合争辩型';
  return '低风险讨论型';
}

function getTrollIndex(user) {
  const weights = {
    对抗性动机: 0.2,
    认知闭合: 0.16,
    证据敏感: 0.18,
    逻辑一致: 0.18,
    合作讨论: 0.16,
    修正意愿: 0.12,
  };
  return Math.round(
    user.scores.reduce((sum, score) => sum + normalizeForRisk(score) * weights[score.axis], 0),
  );
}

function scoreComments({ name, uid, text, source, runtimeLexicon = baseLexicons, analysisMode = 'hybrid' }) {
  const comments = splitComments(text);
  const joined = comments.join('\n');
  const total = Math.max(comments.length, 1);
  const density = (terms) => countMatches(joined, terms) / total;
  const semanticActs = comments.flatMap((comment, index) => classifySpeechAct(comment, index, total));
  const negativeActs = semanticActs.filter((act) => !act.positive && !act.neutral);
  const positiveActs = semanticActs.filter((act) => act.positive);
  const lexiconErrors = comments
    .map((comment, index) => classifyLexiconError(comment, index, total, runtimeLexicon))
    .filter(Boolean);

  const semanticSeed = {
    attack: 26,
    closure: 30,
    evidence: 56,
    logic: 68,
    cooperation: 46,
    correction: 36,
  };

  semanticActs.forEach((act) => {
    Object.entries(act.deltas || {}).forEach(([key, value]) => {
      semanticSeed[key] = clamp(semanticSeed[key] + value);
    });
  });

  const lexiconSeed = {
    attack: clamp(28 + density(runtimeLexicon.attack) * 24 + perThousand(joined, runtimeLexicon.attack) * 2.8),
    closure: clamp(30 + density(runtimeLexicon.absolutes) * 18 + perThousand(joined, runtimeLexicon.absolutes) * 2.2),
    evidence: clamp(55 + density(runtimeLexicon.evidence) * 16 - density(runtimeLexicon.evasion) * 22),
    logic: clamp(68 - (lexiconErrors.length / total) * 24),
    cooperation: clamp(46 + density(runtimeLexicon.cooperation) * 18 - density(runtimeLexicon.attack) * 16 - density(runtimeLexicon.evasion) * 12),
    correction: clamp(36 + density(runtimeLexicon.correction) * 28 + density(runtimeLexicon.cooperation) * 8 - density(runtimeLexicon.evasion) * 12),
  };

  const mix = (key) => {
    if (analysisMode === 'semantic') return semanticSeed[key];
    if (analysisMode === 'lexicon') return lexiconSeed[key];
    return semanticSeed[key] * 0.65 + lexiconSeed[key] * 0.35;
  };

  const scores = [
    {
      axis: '对抗性动机',
      value: mix('attack'),
      benchmark: 52,
      note: `语义裁判检出 ${negativeActs.filter((act) => ['人', '动机'].includes(act.target)).length} 条人/动机攻击；语库攻击密度 ${perThousand(joined, runtimeLexicon.attack).toFixed(1)} / 千字。`,
    },
    {
      axis: '认知闭合',
      value: mix('closure'),
      benchmark: 49,
      note: `全称化或强事实断言 ${negativeActs.filter((act) => ['命题范围', '事实'].includes(act.target)).length} 条；绝对化语义族密度 ${perThousand(joined, runtimeLexicon.absolutes).toFixed(1)} / 千字。`,
    },
    {
      axis: '证据敏感',
      value: mix('evidence'),
      benchmark: 58,
      note: `证据词 ${countMatches(joined, runtimeLexicon.evidence)} 次，举证回避 ${countMatches(joined, runtimeLexicon.evasion)} 次。`,
    },
    {
      axis: '逻辑一致',
      value: mix('logic'),
      benchmark: 61,
      note: `语义裁判检出 ${negativeActs.length} 条高风险话语行为；词面规则检出 ${lexiconErrors.length} 条辅助证据。`,
    },
    {
      axis: '合作讨论',
      value: mix('cooperation'),
      benchmark: 55,
      note: `澄清、让步或条件化表达 ${countMatches(joined, runtimeLexicon.cooperation)} 次；正向话语行为 ${positiveActs.length} 条。`,
    },
    {
      axis: '修正意愿',
      value: mix('correction'),
      benchmark: 46,
      note: `修正或承认表达 ${countMatches(joined, runtimeLexicon.correction)} 次；显式修正 ${positiveActs.filter((act) => act.target === '自我修正').length} 条。`,
    },
  ].map((score) => ({ ...score, value: Math.round(clamp(score.value)) }));

  const primaryErrors =
    analysisMode === 'lexicon'
      ? lexiconErrors
      : [...negativeActs, ...(analysisMode === 'hybrid' ? lexiconErrors.slice(0, 2) : [])];

  const fallbackErrors =
    primaryErrors.length > 0
      ? primaryErrors
      : [
          {
            id: 'generated-empty',
            source: analysisMode === 'lexicon' ? '动态语库' : '语义裁判',
            speechAct: '未检出高风险话语行为',
            target: '观点',
            type: '未检出高风险错误',
            severity: '低',
            comment: comments[0] || '当前样本为空或缺少可分析评论。',
            highlight: comments[0] || '当前样本为空或缺少可分析评论。',
            diagnosis: '当前样本没有明显攻击、偷换、举证回避或强全称化。低风险不等于观点正确，只表示此样本缺少高冲突语言证据。',
            evidence: `已检查 ${comments.length} 条评论。`,
            confidence: 0.58,
          },
        ];

  const confidence = clamp(0.5 + Math.min(total, 30) / 100 + Math.min(primaryErrors.length, 10) / 85, 0.45, 0.92);

  return {
    id: `generated-${Date.now()}-${analysisMode}`,
    uid: uid || '自定义样本',
    name: name || '自定义 B 站用户',
    bio: source || '由粘贴评论样本即时生成',
    sampleSize: comments.length,
    analyzed: comments.length,
    confidence,
    stanceSwitchRate: clamp((positiveActs.length + countMatches(joined, runtimeLexicon.correction)) / Math.max(total * 2, 1), 0, 1),
    disagreementRate: clamp((negativeActs.length + lexiconErrors.length * 0.4) / Math.max(total, 1), 0, 1),
    engineLabel: analysisModes.find((mode) => mode.id === analysisMode)?.label || '混合模式',
    speechSummary: {
      negative: negativeActs.length,
      positive: positiveActs.length,
      lexicon: lexiconErrors.length,
      mode: analysisMode,
    },
    scores,
    errors: fallbackErrors,
  };
}

const defaultUsers = [
  scoreComments({ name: '山前反证员', uid: 'UID 349872641', text: sampleTextA, analysisMode: 'hybrid' }),
  scoreComments({ name: '冷启动观测站', uid: 'UID 68190422', text: sampleTextB, analysisMode: 'hybrid' }),
  ...bilibiliFetchedSamples.map((sample) =>
    scoreComments({
      name: sample.name,
      uid: sample.uid,
      text: sample.text,
      source: sample.source,
      analysisMode: 'hybrid',
    }),
  ),
];

function RadarChart({ scores }) {
  const size = 360;
  const center = size / 2;
  const radius = 128;
  const levels = [0.25, 0.5, 0.75, 1];
  const angleStep = (Math.PI * 2) / scores.length;
  const point = (index, value) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const distance = radius * (value / 100);
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  };
  const polygon = scores.map((score, index) => point(index, normalizeForRisk(score)).join(',')).join(' ');
  const baseline = scores
    .map((score, index) => point(index, normalizeForRisk({ ...score, value: score.benchmark })).join(','))
    .join(' ');

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="杠精倾向雷达图">
      {levels.map((level) => {
        const ring = scores.map((_, index) => point(index, level * 100).join(',')).join(' ');
        return <polygon key={level} points={ring} className="radar-ring" />;
      })}
      {scores.map((score, index) => {
        const [x, y] = point(index, 100);
        const [labelX, labelY] = point(index, 116);
        return (
          <g key={score.axis}>
            <line x1={center} y1={center} x2={x} y2={y} className="radar-axis" />
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className="radar-label">
              {score.axis}
            </text>
          </g>
        );
      })}
      <polygon points={baseline} className="radar-baseline" />
      <polygon points={polygon} className="radar-shape" />
      {scores.map((score, index) => {
        const [x, y] = point(index, normalizeForRisk(score));
        return <circle key={score.axis} cx={x} cy={y} r="4.5" className="radar-dot" />;
      })}
    </svg>
  );
}

function ErrorComment({ item }) {
  const hasHighlight = item.highlight && item.comment.includes(item.highlight);
  const parts = hasHighlight ? item.comment.split(item.highlight) : [item.comment];
  return (
    <article className="error-item">
      <div className="error-head">
        <span className={`severity severity-${item.severity}`}>{item.severity}风险</span>
        <span>{item.type}</span>
      </div>
      <div className="source-row">
        <span>{item.source || '模型证据'}</span>
        <span>{item.speechAct || '话语行为'} · 目标：{item.target || '未标注'}</span>
      </div>
      <p className="comment-text">
        {hasHighlight ? (
          <>
            {parts[0]}
            <mark>{item.highlight}</mark>
            {parts.slice(1).join(item.highlight)}
          </>
        ) : (
          item.comment
        )}
      </p>
      <div className="diagnosis-grid">
        <div>
          <span>诊断</span>
          <p>{item.diagnosis}</p>
        </div>
        <div>
          <span>数据证据</span>
          <p>{item.evidence}</p>
        </div>
      </div>
      <div className="confidence-line">
        <span>置信度</span>
        <div>
          <i style={{ width: `${item.confidence * 100}%` }} />
        </div>
        <b>{Math.round(item.confidence * 100)}%</b>
      </div>
    </article>
  );
}

function App() {
  const [profiles, setProfiles] = React.useState(defaultUsers);
  const [selectedId, setSelectedId] = React.useState(defaultUsers[0].id);
  const [activeError, setActiveError] = React.useState('全部');
  const [query, setQuery] = React.useState('山前反证员');
  const [uid, setUid] = React.useState('UID 349872641');
  const [commentText, setCommentText] = React.useState(sampleTextA);
  const [autoUid, setAutoUid] = React.useState('');
  const [bvidPool, setBvidPool] = React.useState('BV19yGa61Ee6');
  const [fetchState, setFetchState] = React.useState({ status: 'idle', message: '输入 UID 后可自动发现公开视频对象；若 B 站空间接口风控，请提供 BV 视频池。' });
  const [aicuPages, setAicuPages] = React.useState(2);
  const [analysisMode, setAnalysisMode] = React.useState('hybrid');
  const [customLexicon, setCustomLexicon] = React.useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('bili-argument-lexicon') || '{}');
    } catch {
      return {};
    }
  });
  const [analysisState, setAnalysisState] = React.useState('ready');

  const runtimeLexicon = React.useMemo(() => buildRuntimeLexicon(customLexicon), [customLexicon]);
  const candidateTerms = React.useMemo(() => extractCandidateTerms(commentText, runtimeLexicon), [commentText, runtimeLexicon]);
  const selectedUser = profiles.find((user) => user.id === selectedId) || profiles[0];
  const trollIndex = getTrollIndex(selectedUser);
  const errorTypes = ['全部', ...new Set(selectedUser.errors.map((error) => error.type))];
  const visibleErrors =
    activeError === '全部'
      ? selectedUser.errors
      : selectedUser.errors.filter((error) => error.type === activeError);

  React.useEffect(() => {
    window.localStorage.setItem('bili-argument-lexicon', JSON.stringify(customLexicon));
  }, [customLexicon]);

  const addTermToLexicon = (family, term) => {
    setCustomLexicon((current) => {
      const nextTerms = [...new Set([...(current[family] || []), term])];
      return { ...current, [family]: nextTerms };
    });
  };

  const runAnalysis = () => {
    setAnalysisState('loading');
    window.setTimeout(() => {
      const generated = scoreComments({ name: query, uid, text: commentText, runtimeLexicon, analysisMode });
      setProfiles((current) => [generated, ...current.filter((item) => !item.id.startsWith('generated-'))]);
      setSelectedId(generated.id);
      setActiveError('全部');
      setAnalysisState('ready');
    }, 360);
  };

  const loadSample = (sample, profile) => {
    setQuery(profile.name);
    setUid(profile.uid);
    setCommentText(sample);
  };

  const fetchUidComments = async () => {
    setFetchState({ status: 'loading', message: '正在抓取公开对象并过滤该 UID 的评论...' });
    try {
      const response = await fetch('/api/bilibili/analyze-uid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: autoUid,
          bvidPool,
          videoLimit: 8,
          pagesPerVideo: 4,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        setFetchState({
          status: 'error',
          message: `${data.error}${data.details ? ` (${data.details})` : ''}`,
        });
        return;
      }
      setQuery(data.uname || `UID ${data.uid}`);
      setUid(`mid ${data.uid}`);
      setCommentText(data.commentText || '');
      setFetchState({
        status: data.comments.length > 0 ? 'ready' : 'empty',
        message: `扫描 ${data.videos.length} 个公开视频，命中 ${data.comments.length} 条该 UID 评论。${data.confidenceHint}。${data.warnings?.length ? `警告：${data.warnings.join('；')}` : ''}`,
      });
    } catch (error) {
      setFetchState({ status: 'error', message: `采集失败：${error.message}。请确认已运行 npm run server。` });
    }
  };

  const fetchAicuHistory = async () => {
    setFetchState({ status: 'loading', message: '正在从 AICU 历史索引导入评论...' });
    try {
      const response = await fetch('/api/aicu/replies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: autoUid,
          pages: aicuPages,
          ps: 20,
          mode: 0,
          keyword: '',
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        setFetchState({ status: 'error', message: data.error || 'AICU 历史索引导入失败。' });
        return;
      }
      setQuery(`AICU UID ${data.uid}`);
      setUid(`AICU uid ${data.uid}`);
      setCommentText(data.commentText || '');
      setFetchState({
        status: data.fetched > 0 ? 'ready' : 'empty',
        message: `AICU 索引总评论 ${data.total} 条，本次导入 ${data.fetched} 条。${data.confidenceHint}。导入后点击“生成画像”进行本地语义分析。`,
      });
    } catch (error) {
      setFetchState({ status: 'error', message: `AICU 导入失败：${error.message}。` });
    }
  };

  return (
    <main>
      <section className="hero-shell">
        <nav className="topbar" aria-label="分析工作台导航">
          <div className="brand">
            <span><Detective size={18} weight="duotone" /></span>
            <strong>BiliArgument Lab</strong>
          </div>
          <div className="nav-metrics">
            <span>评论样本 {selectedUser.sampleSize}</span>
            <span>模型版本 PDI-0.6</span>
            <span>{selectedUser.engineLabel || '混合模式'}</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="intro-panel">
            <div className="eyebrow"><MagnifyingGlass size={16} /> research first</div>
            <h1>用话语行为而不是静态词表识别“杠精倾向”。</h1>
            <p>
              新版把中文梗、谐音、反讽当作动态语境问题处理。词表只做辅助召回，核心判断转向：
              是否回应原命题、是否转向人身或阵营、是否转移举证责任、是否愿意修正。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">目标用户</label>
              <div>
                <input
                  id="user-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入 UID、昵称或样本标签"
                />
                <button type="button" onClick={runAnalysis}>
                  <Lightning size={17} weight="fill" />
                  {analysisState === 'loading' ? '分析中' : '生成画像'}
                </button>
              </div>
            </div>
          </section>

          <aside className="research-panel" aria-label="研究框架">
            <div className="section-title">
              <Brain size={20} weight="duotone" />
              <span>心理学与论辩学框架</span>
            </div>
            {researchFrames.map((frame) => (
              <div className="research-row" key={frame.label}>
                <strong>{frame.label}</strong>
                <p>{frame.claim}</p>
                <small>{frame.source}</small>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section className="input-section">
        <div className="input-grid">
          <div>
            <span className="eyebrow"><ClipboardText size={16} /> sample intake</span>
            <h2>输入 UID，自动围绕公开对象抓取发言</h2>
            <p>系统会先尝试从 UID 的公开投稿发现视频对象；如果空间接口被风控，就使用你提供的 BV 视频池，在这些公开评论区中过滤该 UID 的发言。</p>
            <div className="crawler-box">
              <label htmlFor="auto-uid">B 站 UID / mid</label>
              <input
                id="auto-uid"
                value={autoUid}
                onChange={(event) => setAutoUid(event.target.value)}
                placeholder="例如 1438219989"
              />
              <label htmlFor="bvid-pool">BV 视频池，空格或逗号分隔</label>
              <textarea
                id="bvid-pool"
                value={bvidPool}
                onChange={(event) => setBvidPool(event.target.value)}
                placeholder="例如 BV19yGa61Ee6 BVxxxx"
              />
              <label htmlFor="aicu-pages">AICU 导入页数，每页 20 条</label>
              <input
                id="aicu-pages"
                value={aicuPages}
                min="1"
                max="10"
                type="number"
                onChange={(event) => setAicuPages(event.target.value)}
              />
              <button type="button" onClick={fetchUidComments} disabled={fetchState.status === 'loading'}>
                {fetchState.status === 'loading' ? '抓取中' : '自动抓取公开发言'}
              </button>
              <button type="button" className="secondary-crawl" onClick={fetchAicuHistory} disabled={fetchState.status === 'loading'}>
                {fetchState.status === 'loading' ? '导入中' : '使用 AICU 历史索引'}
              </button>
              <p className={`fetch-status fetch-${fetchState.status}`}>{fetchState.message}</p>
            </div>
            <div className="mode-selector" role="tablist" aria-label="分析模式">
              {analysisModes.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  className={analysisMode === mode.id ? 'active' : ''}
                  onClick={() => setAnalysisMode(mode.id)}
                >
                  <strong>{mode.label}</strong>
                  <span>{mode.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="comment-form">
            <label htmlFor="uid-input">UID 或来源说明</label>
            <input id="uid-input" value={uid} onChange={(event) => setUid(event.target.value)} />
            <label htmlFor="comment-input">评论样本</label>
            <textarea id="comment-input" value={commentText} onChange={(event) => setCommentText(event.target.value)} />
            <div className="sample-actions">
              <button type="button" onClick={() => loadSample(sampleTextA, { name: '山前反证员', uid: 'UID 349872641' })}>
                载入高风险样本
              </button>
              <button type="button" onClick={() => loadSample(sampleTextB, { name: '冷启动观测站', uid: 'UID 68190422' })}>
                载入混合样本
              </button>
              {bilibiliFetchedSamples.map((sample) => (
                <button key={sample.uid} type="button" onClick={() => loadSample(sample.text, sample)}>
                  载入{sample.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="lexicon-section">
        <div className="lexicon-grid">
          <div>
            <span className="eyebrow"><Brain size={16} /> adaptive lexicon</span>
            <h2>智能语库降级为辅助证据</h2>
            <p>
              系统仍会追踪梗、谐音和近义变体，但它们只进入“风险提示”。真正影响最高权重的是话语行为：
              攻击对象、举证责任、命题回应和修正意愿。
            </p>
          </div>
          <div className="family-list">
            {lexiconFamilies.map((family) => (
              <article key={family.key}>
                <strong>{family.label}</strong>
                <p>{family.description}</p>
                <span>{[...family.examples, ...(customLexicon[family.key] || [])].slice(0, 8).join(' / ')}</span>
              </article>
            ))}
          </div>
          <div className="candidate-panel">
            <div className="section-title">
              <WarningCircle size={18} />
              <span>样本内疑似新词</span>
            </div>
            <div className="candidate-list">
              {candidateTerms.length === 0 ? (
                <p>当前样本没有明显新词候选。可以继续粘贴更多评论提高召回率。</p>
              ) : (
                candidateTerms.map((item) => (
                  <button key={`${item.term}-${item.family}`} type="button" onClick={() => addTermToLexicon(item.family, item.term)}>
                    <strong>{item.term}</strong>
                    <span>加入{lexiconFamilies.find((family) => family.key === item.family)?.label}</span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="user-rail">
          <div className="rail-title">
            <ClipboardText size={18} />
            <span>用户样本</span>
          </div>
          {profiles.map((user) => (
            <button
              className={`user-card ${user.id === selectedId ? 'active' : ''}`}
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedId(user.id);
                setActiveError('全部');
                setQuery(user.name);
                setUid(user.uid);
              }}
            >
              <strong>{user.name}</strong>
              <span>{user.uid}</span>
              <i>{user.bio}</i>
            </button>
          ))}
          <div className="method-note">
            <Scales size={18} />
            <p>评分不是人格诊断，只表示在给定评论样本中的论辩行为风险。</p>
          </div>
        </aside>

        <section className="analysis-core">
          <div className="profile-header">
            <div>
              <span className="eyebrow"><Gauge size={16} /> profile output</span>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.uid} · {selectedUser.bio}</p>
            </div>
            <div className="score-block">
              <span>杠精指数</span>
              <strong>{trollIndex}</strong>
              <small>{getRiskBand(trollIndex)}</small>
            </div>
          </div>

          <div className={`radar-card ${analysisState === 'loading' ? 'is-loading' : ''}`}>
            <div className="chart-area">
              <RadarChart scores={selectedUser.scores} />
            </div>
            <div className="score-list">
              {selectedUser.scores.map((score) => (
                <div className="score-row" key={score.axis}>
                  <div>
                    <strong>{score.axis}</strong>
                    <span>{axisDescriptions[score.axis]}</span>
                    <em>{score.note}</em>
                  </div>
                  <b>{normalizeForRisk(score)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="metric-strip">
            <div>
              <span>有效评论</span>
              <strong>{selectedUser.analyzed}</strong>
            </div>
            <div>
              <span>高风险话语</span>
              <strong>{selectedUser.speechSummary?.negative ?? 0}</strong>
            </div>
            <div>
              <span>正向修正</span>
              <strong>{selectedUser.speechSummary?.positive ?? 0}</strong>
            </div>
            <div>
              <span>语库辅助证据</span>
              <strong>{selectedUser.speechSummary?.lexicon ?? 0}</strong>
            </div>
          </div>
        </section>

        <aside className="error-panel">
          <div className="section-title">
            <ShieldWarning size={20} weight="duotone" />
            <span>评论错误高亮</span>
          </div>
          <div className="filter-row" role="tablist" aria-label="错误类型筛选">
            {errorTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={activeError === type ? 'active' : ''}
                onClick={() => setActiveError(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="error-list">
            {visibleErrors.map((error) => (
              <ErrorComment item={error} key={error.id} />
            ))}
          </div>
        </aside>
      </section>

      <section className="model-section">
        <div className="model-header">
          <span className="eyebrow"><Faders size={16} /> scoring protocol</span>
          <h2>从评论到雷达图的计算路径</h2>
        </div>
        <div className="protocol-grid">
          <article>
            <FlagBanner size={24} />
            <strong>1. 语料清洗</strong>
            <p>按行切分评论，保留带有主张、评价或反驳的文本片段。</p>
          </article>
          <article>
            <WarningCircle size={24} />
            <strong>2. 话语行为裁判</strong>
            <p>判断攻击对象、举证责任、命题回应和是否出现自我修正。</p>
          </article>
          <article>
            <ChartPolar size={24} />
            <strong>3. 动态语库辅助</strong>
            <p>新梗和近义变体只作为风险线索，避免静态词表直接定性。</p>
          </article>
          <article>
            <CheckCircle size={24} />
            <strong>4. 证据回放</strong>
            <p>每个评分都保留可追溯评论片段，避免只给抽象标签或主观印象。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
