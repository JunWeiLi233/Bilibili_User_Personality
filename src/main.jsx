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
import { buildSentenceRadarMarks } from './languageUnderstanding.js';
import './styles.css';

const INVERSE_AXES = new Set(['证据敏感', '逻辑一致', '合作讨论', '修正意愿']);

const analysisModes = [
  {
    id: 'deepseek',
    label: 'DeepSeek 直析',
    description: 'DeepSeek V4 直接分析评论话语行为，全面理解语境、反讽和言外之意，无需关键词匹配。',
  },
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
    pattern: /(你懂|你连|智商|脑子|洗傻|小丑|蠢|急了|典|孝|绷|笑死|你配|你也配|你算老几|你什么东西|你来|你行你上|就你|你这种|你个|看你主页|翻你动态|查成分|你主子|你爹|孝子|逆天|闹麻了|唐|啥狗|出生|急了急了|破防|这就破防|急成这样).{0,20}/,
    diagnosis: '攻击对象从命题转向发言者能力或身份，讨论收益主要来自羞辱而非论证。',
    deltas: { attack: 28, cooperation: -18, logic: -10 },
  },
  {
    act: '阵营/动机归因',
    type: '语义偷换',
    severity: '高',
    target: '动机',
    pattern: /(其实就是|所以你就是|给资本|洗地|收钱|屁股|站队|水军|五毛|美分|粉红|小粉红|精外|洋奴|殖人|1450|来电了|蛙|湾湾|神神|兔兔|你国|贵国|境外势力|恰饭|恰烂钱|广告费|收了多少|到账).{0,22}/,
    diagnosis: '把方法、证据要求或局部观点改写成立场归属，绕开原命题。',
    deltas: { attack: 20, logic: -24, cooperation: -14 },
  },
  {
    act: '举证责任转移',
    type: '缺证断言',
    severity: '中',
    target: '证明责任',
    pattern: /(你自己搜|自己查|懂的都懂|这还用问|懒得解释|不解释|百度一下|不会百度|问百度|去百度|自己去找|不会搜|搜一下不会|这都不知道|常识|不用我教|自己学|去看书|多读书|这还用说|这都不懂).{0,20}/,
    diagnosis: '要求对方替自己完成证明，削弱可核验性。',
    deltas: { evidence: -28, cooperation: -10 },
  },
  {
    act: '全称化/过度概括',
    type: '逻辑错误',
    severity: '中',
    target: '命题范围',
    pattern: /(所有|全部|都是|没有一个|哪个不是|从来|永远|根本|全都|一律|无一例外|百分百|百分之一百|任何人|谁都|没人|没有人|没有一个人|没有哪个|从古至今|自古以来|历来).{0,24}/,
    diagnosis: '把有限样本扩展成全称判断，缺少边界条件。',
    deltas: { closure: 26, logic: -20 },
  },
  {
    act: '强事实断言缺证',
    type: '事实错误',
    severity: '中',
    target: '事实',
    pattern: /(早就没有|不可能|必然|肯定|绝对|毫无疑问|毋庸置疑|不用怀疑|不可能是|肯定是|绝对是|很明显|明摆着|众所周知|大家都知道|谁不知道|不用想|毫无疑问地|确定无疑).{0,24}/,
    diagnosis: '使用强事实断言但没有同步给出可核验来源。',
    deltas: { closure: 18, evidence: -16, logic: -10 },
  },
  {
    act: '合作性限定',
    type: '低风险讨论',
    severity: '低',
    target: '观点',
    pattern: /(可能|不一定|如果|我理解|能否|可以贴|补充|限定|或许|大概|也许|有可能|据我所知|就我所见|以我目前|暂时|目前看来|现阶段|这里有一个|让我补充|提供一下|仅供参考|个人看法|在我看来|我的理解).{0,24}/,
    diagnosis: '使用条件化和澄清表达，说明仍在推进命题讨论。',
    deltas: { cooperation: 24, evidence: 8, closure: -10 },
    positive: true,
  },
  {
    act: '显式修正',
    type: '低风险讨论',
    severity: '低',
    target: '自我修正',
    pattern: /(我错了|我说重了|更正|修正|改结论|承认|说错了|搞错了|弄错了|记错了|确实|你说得对|受教|学习|感谢指正|谢谢指正|有道理|你说的有道理|这倒也是|那倒也对|收回|前面说错|之前说错|是我搞混).{0,24}/,
    diagnosis: '出现自我修正或结论降级，是区分正常争论和杠精行为的重要反向证据。',
    deltas: { correction: 32, cooperation: 12 },
    positive: true,
  },
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const lexiconFamilyMeta = {
  attack: {
    label: '攻击/嘲讽',
    axis: '对抗性动机',
    type: '情绪化表达',
    severity: '中',
    polarity: 'risk',
    diagnosis: '动态语库命中攻击或嘲讽语义族，会推高对抗性动机并压低合作讨论。',
  },
  absolutes: {
    label: '绝对化',
    axis: '认知闭合',
    type: '缺少限定',
    severity: '中',
    polarity: 'risk',
    diagnosis: '动态语库命中绝对化断言语义族，会推高认知闭合并影响逻辑一致性。',
  },
  evidence: {
    label: '证据线索',
    axis: '证据敏感',
    type: '证据请求',
    severity: '低',
    polarity: 'support',
    diagnosis: '动态语库命中证据或来源相关语义族，会作为证据敏感的正向线索。',
  },
  evasion: {
    label: '举证回避',
    axis: '证据敏感',
    type: '缺证断言',
    severity: '中',
    polarity: 'risk',
    diagnosis: '动态语库命中举证回避语义族，会降低证据敏感并增加证明责任转移风险。',
  },
  cooperation: {
    label: '合作讨论',
    axis: '合作讨论',
    type: '合作线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '动态语库命中澄清、条件化或合作语义族，会作为合作讨论的正向线索。',
  },
  correction: {
    label: '自我修正',
    axis: '修正意愿',
    type: '修正线索',
    severity: '低',
    polarity: 'support',
    diagnosis: '动态语库命中修正或承认语义族，会作为修正意愿的正向线索。',
  },
};

const familyOrder = Object.keys(lexiconFamilyMeta);

function buildRuntimeLexicon(customLexicon = {}) {
  return Object.fromEntries(
    Object.entries(baseLexicons).map(([key, terms]) => {
      const customTerms = customLexicon[key] || [];
      return [key, [...new Set([...terms, ...customTerms])]];
    }),
  );
}

function mergeDictionaryFamilies(currentLexicon, families = {}) {
  return Object.fromEntries(
    familyOrder.map((family) => {
      const learned = Array.isArray(families[family]) ? families[family] : [];
      return [family, [...new Set([...(currentLexicon[family] || []), ...learned])]];
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

function hasMemeFrame(text) {
  return /(?:\u6897|\u73a9\u6897|\u540d\u573a\u9762|\u53f0\u8bcd|\u5f15\u7528|\u590d\u8ff0|\u8f6c\u8ff0|\u8868\u60c5\u5305|\u539f\u8bdd|\u6bb5\u5b50|\u8c10\u97f3|meme|quote|quoted|copypasta|catchphrase|inside joke)/i.test(text);
}

function hasQuoteFrame(text) {
  return /[\"\u201c\u201d\u300c\u300d\u300e\u300f\u300a\u300b].{1,36}[\"\u201c\u201d\u300c\u300d\u300e\u300f\u300a\u300b]/.test(text)
    || /(?:\u8fd9\u53e5|\u90a3\u53e5|\u8fd9\u4e2a\u8bcd|\u8fd9\u4e2a\u6897|\u53f0\u8bcd|\u539f\u53e5|line|phrase|quote|catchphrase)/i.test(text);
}

function stripQuotedSegments(text) {
  return text
    .replace(/[\u201c\u300c\u300e\u300a\"].{1,60}[\u201d\u300d\u300f\u300b\"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasExplicitNonAttackFrame(text) {
  return /(?:\u4e0d\u662f\u9a82|\u4e0d\u662f\u653b\u51fb|\u6ca1\u6709\u9a82|\u6ca1\u6709\u653b\u51fb|\u4e0d\u662f\u4eba\u8eab|\u6ca1\u6709\u4eba\u8eab|\u53ea\u662f|\u4ec5\u4ec5|\u7528\u6765\u8c03\u4f83|\u5f00\u73a9\u7b11|\u8c03\u4f83|\u73a9\u7b11|not attacking|not an attack|not insulting|not ad hominem|just a meme|only a meme|as a joke|joking)/i.test(text);
}

function hasMemeDiscussionFrame(text) {
  return /(?:\u8fd9\u4e2a|\u8fd9\u53e5|\u8fd9\u6bb5|\u8fd9\u4e2a\u8bcd).{0,16}(?:\u6897|\u53f0\u8bcd|\u540d\u573a\u9762|\u539f\u53e5)|(?:\u6897|\u53f0\u8bcd|\u540d\u573a\u9762|\u539f\u53e5).{0,20}(?:\u592a\u597d\u7b11|\u597d\u7b11|\u590d\u8bfb|\u51fa\u5904|\u5f39\u5e55|\u5237\u5c4f|meme|quote|catchphrase)/i.test(text);
}

function hasDirectHostileTarget(text) {
  return /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u4ed6\u4eec|\u5979|\u5979\u4eec|\u5b83|\u5b83\u4eec|\u8fd9\u4eba|\u8fd9\u7fa4|\u7c89\u4e1d|\u73a9\u5bb6|up\u4e3b|\u4f5c\u8005|\u5bf9\u9762).{0,10}(?:\u50bb|\u8822|\u6eda|\u5c0f\u4e11|\u6025\u4e86|\u7834\u9632|\u6760\u7cbe|\u6b96\u4eba|\u7c89\u7ea2|\u6c34\u519b|\u6d17\u5730|\u8111\u5b50|\u667a\u5546|\u6bd4\u515c|\u53bb\u722c|\u522b\u6765\u6cbe\u8fb9|idiot|stupid|moron|shill|hater)/i.test(text);
}

function isMemeOrQuotedNonAttackText(text) {
  if (!hasMemeFrame(text)) return false;
  if (hasExplicitNonAttackFrame(text)) return true;
  if (hasMemeDiscussionFrame(text)) return true;
  return hasQuoteFrame(text) && !hasDirectHostileTarget(stripQuotedSegments(text));
}

function findLexiconMarks(comment, index, totalComments, runtimeLexicon) {
  const marks = [];
  const memeNonAttack = isMemeOrQuotedNonAttackText(comment);
  for (const family of familyOrder) {
    const meta = lexiconFamilyMeta[family];
    const terms = runtimeLexicon[family] || [];
    for (const term of terms) {
      if (!term || !comment.includes(term)) continue;
      if (memeNonAttack && meta.polarity === 'risk') continue;
      marks.push({
        id: `lexicon-${index}-${family}-${term}`,
        source: '动态语库',
        speechAct: `${meta.label}词汇标记`,
        target: meta.axis,
        type: meta.type,
        severity: meta.severity,
        comment,
        highlight: term,
        family,
        axis: meta.axis,
        polarity: meta.polarity,
        diagnosis: `${meta.diagnosis} 词面命中只作为 radar 辅助证据，不单独定性。`,
        evidence: `第 ${index + 1}/${totalComments} 条评论命中字典词“${term}”（${meta.label}），已计入 radar「${meta.axis}」相关计算。`,
        confidence: meta.polarity === 'risk' ? 0.64 : 0.6,
      });
    }
  }
  return [...new Map(marks.map((mark) => [`${mark.family}:${mark.highlight}`, mark])).values()].slice(0, 4);
}

function summarizeVocabularyMarks(marks) {
  const grouped = new Map();
  for (const mark of marks) {
    const key = `${mark.family}:${mark.highlight}`;
    const current = grouped.get(key) || {
      term: mark.highlight,
      family: mark.family,
      label: lexiconFamilyMeta[mark.family]?.label || mark.family,
      axis: mark.axis,
      polarity: mark.polarity,
      count: 0,
    };
    current.count += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((a, b) => b.count - a.count || familyOrder.indexOf(a.family) - familyOrder.indexOf(b.family))
    .slice(0, 14);
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
  const lexiconMarks = comments.flatMap((comment, index) => findLexiconMarks(comment, index, total, runtimeLexicon));
  const riskLexiconMarks = lexiconMarks.filter((mark) => mark.polarity === 'risk');
  const vocabularyMarks = summarizeVocabularyMarks(lexiconMarks);

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
    logic: clamp(68 - (riskLexiconMarks.length / total) * 18 + density(runtimeLexicon.evidence) * 5),
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
      note: `语义裁判检出 ${negativeActs.filter((act) => ['人', '动机'].includes(act.target)).length} 条人/动机攻击；字典 attack 标记 ${lexiconMarks.filter((mark) => mark.family === 'attack').length} 次，密度 ${perThousand(joined, runtimeLexicon.attack).toFixed(1)} / 千字。`,
    },
    {
      axis: '认知闭合',
      value: mix('closure'),
      benchmark: 49,
      note: `全称化或强事实断言 ${negativeActs.filter((act) => ['命题范围', '事实'].includes(act.target)).length} 条；字典 absolutes 标记 ${lexiconMarks.filter((mark) => mark.family === 'absolutes').length} 次。`,
    },
    {
      axis: '证据敏感',
      value: mix('evidence'),
      benchmark: 58,
      note: `证据词 ${countMatches(joined, runtimeLexicon.evidence)} 次，举证回避 ${countMatches(joined, runtimeLexicon.evasion)} 次；两类字典标记共同影响此轴。`,
    },
    {
      axis: '逻辑一致',
      value: mix('logic'),
      benchmark: 61,
      note: `语义裁判检出 ${negativeActs.length} 条高风险话语行为；风险类字典标记 ${riskLexiconMarks.length} 条作为辅助扣分。`,
    },
    {
      axis: '合作讨论',
      value: mix('cooperation'),
      benchmark: 55,
      note: `澄清、让步或条件化表达 ${countMatches(joined, runtimeLexicon.cooperation)} 次；cooperation 字典标记 ${lexiconMarks.filter((mark) => mark.family === 'cooperation').length} 次。`,
    },
    {
      axis: '修正意愿',
      value: mix('correction'),
      benchmark: 46,
      note: `修正或承认表达 ${countMatches(joined, runtimeLexicon.correction)} 次；correction 字典标记 ${lexiconMarks.filter((mark) => mark.family === 'correction').length} 次。`,
    },
  ].map((score) => ({ ...score, value: Math.round(clamp(score.value)) }));

  const primaryErrors =
    analysisMode === 'lexicon'
      ? lexiconMarks
      : [...negativeActs, ...(analysisMode === 'hybrid' ? lexiconMarks.slice(0, 4) : [])];

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
    disagreementRate: clamp((negativeActs.length + riskLexiconMarks.length * 0.35) / Math.max(total, 1), 0, 1),
    engineLabel: analysisModes.find((mode) => mode.id === analysisMode)?.label || '混合模式',
    speechSummary: {
      negative: negativeActs.length,
      positive: positiveActs.length,
      lexicon: lexiconMarks.length,
      mode: analysisMode,
    },
    vocabularyMarks,
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
  const [query, setQuery] = React.useState('');
  const [uid, setUid] = React.useState('UID 349872641');
  const [commentText, setCommentText] = React.useState(sampleTextA);
  const [fetchState, setFetchState] = React.useState({
    status: 'idle',
    message: '输入 UID 或视频链接后会直接扫描 B 站公开对象，并用 DeepSeek V4 Flash medium 学习关键词。',
  });
  const [keywordResults, setKeywordResults] = React.useState([]);
  const [analysisMode, setAnalysisMode] = React.useState('hybrid');
  const [customLexicon, setCustomLexicon] = React.useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('bili-argument-lexicon') || '{}');
    } catch {
      return {};
    }
  });
  const [analysisState, setAnalysisState] = React.useState('ready');
  const [deepSeekConfig, setDeepSeekConfig] = React.useState(null);

  const runtimeLexicon = React.useMemo(() => buildRuntimeLexicon(customLexicon), [customLexicon]);
  const selectedUser = profiles.find((user) => user.id === selectedId) || profiles[0];
  const trollIndex = getTrollIndex(selectedUser);
  const errorTypes = ['全部', ...new Set(selectedUser.errors.map((error) => error.type))];
  const visibleErrors =
    activeError === '全部'
      ? selectedUser.errors
      : selectedUser.errors.filter((error) => error.type === activeError);
  const isVideoSearch = /BV[0-9A-Za-z]+|bilibili\.com\/video|b23\.tv/i.test(query);

  React.useEffect(() => {
    window.localStorage.setItem('bili-argument-lexicon', JSON.stringify(customLexicon));
  }, [customLexicon]);

  React.useEffect(() => {
    let cancelled = false;
    async function loadDeepSeekDictionary() {
      try {
        const [configResponse, dictionaryResponse] = await Promise.all([
          fetch('/api/deepseek/config'),
          fetch('/api/deepseek/dictionary'),
        ]);
        const config = await configResponse.json();
        const dictionaryPayload = await dictionaryResponse.json();
        if (cancelled) return;
        setDeepSeekConfig(config);
        if (dictionaryPayload.ok && dictionaryPayload.dictionary?.families) {
          setCustomLexicon((current) => mergeDictionaryFamilies(current, dictionaryPayload.dictionary.families));
        }
        setFetchState((current) =>
          current.status === 'idle'
            ? {
                ...current,
                message: config.available
                  ? `DeepSeek V4 模型 ${config.model}（${config.reasoningEffort || 'medium'}）已配置；输入 UID 或视频链接后会抓取公开文本、抽取中文关键词并写入本地词典。`
                  : '未检测到 DEEPSEEK_API_KEY；输入 UID 或视频链接后仍会用本地规则提取关键词并写入本地词典。',
              }
            : current,
        );
      } catch {
        if (!cancelled) {
          setFetchState((current) =>
            current.status === 'idle'
              ? {
                  ...current,
                  message: 'DeepSeek 配置读取失败；请确认 npm run server 和 DEEPSEEK_API_KEY。',
                }
              : current,
          );
        }
      }
    }
    loadDeepSeekDictionary();
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchVideoKeywords = async () => {
    const videoLink = query.trim();
    if (videoLink && !/BV[0-9A-Za-z]+|bilibili\.com\/video|b23\.tv/i.test(videoLink)) {
      setFetchState({ status: 'error', message: '留空使用后端默认视频；或输入包含 BV 号的 B 站视频链接。' });
      return;
    }
    setKeywordResults([]);
    setAnalysisState('loading');
    setFetchState({
      status: 'loading',
      message: videoLink
        ? '正在扫描该视频的公开评论，并用 DeepSeek V4 Flash medium 提取关键词...'
        : '正在调用后端代码里的默认 B 站视频，并用 DeepSeek V4 Flash medium 提取关键词...',
    });
    try {
      const response = await fetch('/api/bilibili/video-keywords', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(videoLink ? { videoLink } : {}),
          pages: 2,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        setFetchState({ status: 'error', message: data.error || '视频关键词搜索失败。' });
        setAnalysisState('ready');
        return;
      }

      const nextCommentText = data.commentText || '';
      const entries = data.entries || [];
      let learnedRuntimeLexicon = runtimeLexicon;
      const trainData = data.keywordTraining;
      let learnedNote = '未发现可写入本地词典的新关键词。';
      if (trainData?.ok) {
        const nextCustomLexicon = mergeDictionaryFamilies(customLexicon, trainData.dictionary?.families || {});
        setCustomLexicon(nextCustomLexicon);
        learnedRuntimeLexicon = buildRuntimeLexicon(nextCustomLexicon);
        learnedNote = `${trainData.available ? `DeepSeek V4 ${trainData.model}（${trainData.reasoningEffort || 'medium'}）` : '本地规则'}学习 ${entries.length} 个中文关键词${trainData.usedFallback ? '（使用规则兜底）' : ''}。`;
      }

      setQuery(data.video.bvid);
      setUid(`video ${data.video.bvid}`);
      setCommentText(nextCommentText);
      setKeywordResults(entries);
      if (nextCommentText.trim()) {
        if (analysisMode === 'deepseek') {
          const deepseekProfile = await runDeepSeekAnalysis(
            nextCommentText,
            data.video.title || data.video.bvid,
            `video ${data.video.bvid}`,
            data.video.sourceUrl,
          );
          if (deepseekProfile) {
            setProfiles((current) => [deepseekProfile, ...current.filter((item) => !item.id.startsWith('generated-'))]);
            setSelectedId(deepseekProfile.id);
            setActiveError('全部');
          }
        } else {
          const generated = scoreComments({
            name: data.video.title || data.video.bvid,
            uid: `video ${data.video.bvid}`,
            text: nextCommentText,
            source: data.video.sourceUrl,
            runtimeLexicon: learnedRuntimeLexicon,
            analysisMode,
          });
          setProfiles((current) => [generated, ...current.filter((item) => !item.id.startsWith('generated-'))]);
          setSelectedId(generated.id);
          setActiveError('全部');
        }
      }

      if (analysisMode !== 'deepseek') {
        setFetchState({
          status: data.comments.length > 0 ? 'ready' : 'empty',
          message: `扫描 ${data.videos?.length || 1} 个视频（首个：《${data.video.title}》），采集 ${data.comments.length} 条公开评论。${learnedNote}${data.confidenceHint}。`,
        });
      }
      setAnalysisState('ready');
    } catch (error) {
      setFetchState({ status: 'error', message: `视频关键词搜索失败：${error.message}。请确认已运行 npm run server。` });
      setAnalysisState('ready');
    }
  };

  const fetchUidComments = async () => {
    const searchUid = query.trim().match(/\d+/)?.[0] || '';
    if (!searchUid) {
      setFetchState({ status: 'error', message: '请输入数字 UID。' });
      return;
    }
    setKeywordResults([]);
    setAnalysisState('loading');
    setFetchState({ status: 'loading', message: '正在直接扫描该 UID 的公开投稿、动态与评论互动...' });
    try {
      const response = await fetch('/api/bilibili/analyze-uid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: searchUid,
          bvidPool: '',
          objectLimit: 8,
          dynamicLimit: 8,
          pagesPerObject: 2,
        }),
      });
      const data = await response.json();
      if (!data.ok) {
        setFetchState({
          status: 'error',
          message: `${data.error}${data.details ? ` (${data.details})` : ''}`,
        });
        setAnalysisState('ready');
        return;
      }
      setQuery(data.uid);
      setUid(`mid ${data.uid}`);
      const nextCommentText = data.commentText || '';
      setCommentText(nextCommentText);
      const statementCount = data.statements?.length ?? data.comments.length;
      const dynamicCount = data.dynamics?.length ?? 0;
      const postCount = data.authoredPosts?.length ?? 0;
      let learnedRuntimeLexicon = runtimeLexicon;
      let learnedNote = deepSeekConfig?.available
        ? `DeepSeek V4 模型 ${deepSeekConfig.model}（${deepSeekConfig.reasoningEffort || 'medium'}）未发现新关键词。`
        : 'DeepSeek 未配置，本地规则未发现新词。';
      if (nextCommentText.trim()) {
        setFetchState({ status: 'loading', message: '正在用 DeepSeek V4 提取中文关键词并写入本地词典...' });
        try {
          const trainResponse = await fetch('/api/deepseek/train-keywords', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              uid: data.uid,
              text: nextCommentText,
              source: data.source,
            }),
          });
          const trainData = await trainResponse.json();
          if (trainData.ok) {
            const nextCustomLexicon = mergeDictionaryFamilies(customLexicon, trainData.dictionary?.families || {});
            setCustomLexicon(nextCustomLexicon);
            learnedRuntimeLexicon = buildRuntimeLexicon(nextCustomLexicon);
            setKeywordResults(trainData.entries || []);
            learnedNote = `${trainData.available ? `DeepSeek V4 ${trainData.model}（${trainData.reasoningEffort || 'medium'}）` : '本地规则'}学习 ${trainData.entries.length} 个中文关键词${trainData.usedFallback ? '（使用规则兜底）' : ''}。`;
          } else {
            learnedNote = `DeepSeek 词典训练失败：${trainData.error || '未知错误'}。`;
          }
        } catch (error) {
          learnedNote = `DeepSeek 词典训练失败：${error.message}。`;
        }
      }
      if (statementCount > 0) {
        if (analysisMode === 'deepseek') {
          const deepseekProfile = await runDeepSeekAnalysis(
            nextCommentText,
            data.uname || `UID ${data.uid}`,
            `mid ${data.uid}`,
            data.source,
          );
          if (deepseekProfile) {
            setProfiles((current) => [deepseekProfile, ...current.filter((item) => !item.id.startsWith('generated-'))]);
            setSelectedId(deepseekProfile.id);
            setActiveError('全部');
          }
        } else {
          const generated = scoreComments({
            name: data.uname || `UID ${data.uid}`,
            uid: `mid ${data.uid}`,
            text: nextCommentText,
            runtimeLexicon: learnedRuntimeLexicon,
            analysisMode,
          });
          setProfiles((current) => [generated, ...current.filter((item) => !item.id.startsWith('generated-'))]);
          setSelectedId(generated.id);
          setActiveError('全部');
        }
      }
      if (analysisMode !== 'deepseek') {
        setFetchState({
          status: statementCount > 0 ? 'ready' : 'empty',
          message: `扫描 ${data.objects?.length ?? data.videos.length} 个公开对象（视频 ${data.videos.length} / 动态 ${dynamicCount}），采集 ${postCount} 条公开动态原文与 ${data.comments.length} 条该 UID 评论互动。${learnedNote}${data.confidenceHint}。${data.warnings?.length ? `警告：${data.warnings.join('；')}` : ''}`,
        });
      }
      setAnalysisState('ready');
    } catch (error) {
      setFetchState({ status: 'error', message: `采集失败：${error.message}。请确认已运行 npm run server。` });
      setAnalysisState('ready');
    }
  };

  function buildDeepSeekProfile(result, { name, uid, source, commentText }) {
    const comments = splitComments(commentText);
    const axes = result.axes || [];
    const scores = axes.map((axis) => ({
      axis: axis.axis,
      value: Math.round(clamp(Number(axis.score) || 50)),
      benchmark: { '对抗性动机': 52, '认知闭合': 49, '证据敏感': 58, '逻辑一致': 61, '合作讨论': 55, '修正意愿': 46 }[axis.axis] || 50,
      note: `${axis.reasoning || ''} 证据：${(axis.evidence || []).join('；')}`,
    }));

    const errors = axes.flatMap((axis) => {
      const evidence = Array.isArray(axis.evidence) ? axis.evidence : [];
      return evidence.map((quote, index) => ({
        id: `deepseek-${axis.axis}-${index}`,
        source: 'DeepSeek V4 直析',
        speechAct: axis.axis,
        target: '话语行为',
        type: axis.score >= 70 || axis.score <= 30 ? '高风险话语' : '中性话语',
        severity: axis.score >= 70 ? '高' : axis.score <= 30 ? '中' : '低',
        comment: quote,
        highlight: quote.slice(0, 40),
        diagnosis: axis.reasoning || '',
        evidence: `DeepSeek V4 从评论中抽取的原文证据（${axis.axis}轴）。`,
        confidence: result.confidence || 0.7,
      }));
    });
    const sentenceAnalyses = Array.isArray(result.sentenceAnalyses) ? result.sentenceAnalyses : [];
    const sentenceRadarMarks = buildSentenceRadarMarks(sentenceAnalyses, { confidence: result.confidence || 0.7 });
    const sentenceMarksByQuote = sentenceRadarMarks.reduce((groups, mark) => {
      const marks = groups.get(mark.quote) || [];
      marks.push(mark);
      groups.set(mark.quote, marks);
      return groups;
    }, new Map());
    const sentenceErrors = sentenceAnalyses.map((item, index) => ({
      id: `deepseek-sentence-${index}`,
      source: 'DeepSeek V4 逐句分析',
      speechAct: item.speechAct || '完整句判断',
      target: (sentenceMarksByQuote.get(item.quote || '') || []).map((mark) => mark.axis).join(' / ') || item.target || '整句语境',
      type: item.risk === 'high' ? '高风险话语' : item.risk === 'medium' ? '中性话语' : '低风险话语',
      severity: item.risk === 'high' ? '高' : item.risk === 'medium' ? '中' : '低',
      comment: item.quote || '',
      highlight: (item.quote || '').slice(0, 40),
      diagnosis: [
        (sentenceMarksByQuote.get(item.quote || '') || []).length > 0
          ? `Radar: ${(sentenceMarksByQuote.get(item.quote || '') || []).map((mark) => `${mark.axis} ${Math.round(mark.strength * 100)}%`).join(' / ')}`
          : '',
        item.stance,
        item.contextRole,
        item.reasoning,
      ].filter(Boolean).join('；'),
      evidence: 'DeepSeek V4 按完整句子的命题、对象、语气、证据关系和上下文作用判断，不只按单个关键词定性。',
      confidence: result.confidence || 0.7,
    }));
    const combinedErrors = [...sentenceErrors, ...errors];

    return {
      id: `generated-${Date.now()}-deepseek`,
      uid: uid || '自定义样本',
      name: name || '自定义 B 站用户',
      bio: source || '由 DeepSeek V4 直接分析评论样本生成',
      sampleSize: comments.length,
      analyzed: comments.length,
      confidence: result.confidence || 0.7,
      stanceSwitchRate: 0,
      disagreementRate: 0,
      engineLabel: 'DeepSeek 直析',
      speechSummary: {
        negative: axes.filter((a) => a.score >= 70).length,
        positive: axes.filter((a) => a.score <= 30 && ['证据敏感', '逻辑一致', '合作讨论', '修正意愿'].includes(a.axis)).length,
        lexicon: 0,
        mode: 'deepseek',
      },
      vocabularyMarks: [],
      sentenceRadarMarks,
      scores,
      errors: combinedErrors.length > 0 ? combinedErrors : [{
        id: 'deepseek-empty',
        source: 'DeepSeek V4 直析',
        speechAct: '综合分析',
        target: '话语行为',
        type: '中性话语',
        severity: '低',
        comment: comments[0] || '',
        highlight: comments[0]?.slice(0, 40) || '',
        diagnosis: result.overall?.summary || 'DeepSeek V4 对评论样本进行了全面话语行为分析。',
        evidence: `已分析 ${comments.length} 条评论的全量话语行为模式。`,
        confidence: result.confidence || 0.7,
      }],
    };
  }

  const runDeepSeekAnalysis = async (commentText, name, uid, source) => {
    setFetchState({ status: 'loading', message: 'DeepSeek V4 正在直接分析评论话语行为...' });
    try {
      const response = await fetch('/api/deepseek/analyze-comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: commentText, uid, name }),
      });
      const result = await response.json();
      if (!result.ok) {
        setFetchState({ status: 'error', message: `DeepSeek 分析失败：${result.error || '未知错误'}` });
        setAnalysisState('ready');
        return null;
      }
      setFetchState({
        status: 'ready',
        message: `DeepSeek V4 ${result.model}（${result.reasoningEffort || 'medium'}）直接分析了 ${splitComments(commentText).length} 条评论。风险判定：${result.overall?.riskBand || '未知'}。${result.overall?.summary || ''}`,
      });
      return buildDeepSeekProfile(result, { name, uid, source, commentText });
    } catch (error) {
      setFetchState({ status: 'error', message: `DeepSeek 分析失败：${error.message}` });
      setAnalysisState('ready');
      return null;
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
              输入 UID 后直接扫描 B 站公开资料、投稿、动态和评论互动，再用话语行为模型生成画像。
              词表只做辅助召回，核心判断转向：是否回应原命题、是否转向人身或阵营、是否转移举证责任、是否愿意修正。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">B 站 UID / 视频链接</label>
              <div>
                <input
                  id="user-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如 453244911 或 https://www.bilibili.com/video/BV..."
                />
                <button type="button" onClick={isVideoSearch ? fetchVideoKeywords : fetchUidComments} disabled={analysisState === 'loading'}>
                  <Lightning size={17} weight="fill" />
                  {analysisState === 'loading' ? '抓取中' : isVideoSearch ? '找视频关键词' : '搜索 UID'}
                </button>
                <button type="button" onClick={fetchVideoKeywords} disabled={analysisState === 'loading'}>
                  <Lightning size={17} weight="fill" />
                  后端默认视频
                </button>
              </div>
              <p className={`fetch-status fetch-${fetchState.status}`}>{fetchState.message}</p>
              <div className="mode-selector" role="radiogroup" aria-label="分析模式">
                {analysisModes.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mode-chip ${analysisMode === mode.id ? 'active' : ''}`}
                    onClick={() => setAnalysisMode(mode.id)}
                    title={mode.description}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
              {keywordResults.length > 0 && (
                <div className="keyword-results" aria-label="DeepSeek 提取关键词">
                  {keywordResults.slice(0, 12).map((entry) => (
                    <span className="keyword-chip" key={`${entry.family}-${entry.term}`} title={entry.meaning || entry.family}>
                      {entry.term}
                    </span>
                  ))}
                </div>
              )}
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
                setQuery(user.uid.match(/\d+/)?.[0] || '');
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
            {selectedUser.vocabularyMarks?.length > 0 && (
              <div className="vocabulary-radar" aria-label="字典词汇 radar 标记">
                <div className="vocabulary-radar-head">
                  <strong>字典词汇标记</strong>
                  <span>这些词来自本地/DeepSeek 语库，并参与 radar 对应轴计算</span>
                </div>
                <div className="vocabulary-chip-grid">
                  {selectedUser.vocabularyMarks.map((mark) => (
                    <span className={`vocabulary-chip vocabulary-${mark.polarity}`} key={`${mark.family}-${mark.term}`}>
                      <b>{mark.term}</b>
                      <i>{mark.label} · {mark.axis}{mark.count > 1 ? ` ×${mark.count}` : ''}</i>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {selectedUser.sentenceRadarMarks?.length > 0 && (
              <div className="sentence-radar" aria-label="完整句 radar 标记">
                <div className="vocabulary-radar-head">
                  <strong>完整句 radar 标记</strong>
                  <span>DeepSeek 按整句判断话语行为，并把每句映射到对应 radar 轴。</span>
                </div>
                <div className="sentence-radar-list">
                  {selectedUser.sentenceRadarMarks.slice(0, 8).map((mark) => (
                    <article className={`sentence-radar-item sentence-${mark.direction}`} key={mark.id}>
                      <div className="sentence-radar-meta">
                        <strong>{mark.axis}</strong>
                        <span>{mark.speechAct} / {mark.target} / {Math.round(mark.strength * 100)}%</span>
                      </div>
                      <p>{mark.quote}</p>
                      <em>{mark.reasoning}</em>
                    </article>
                  ))}
                </div>
              </div>
            )}
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
