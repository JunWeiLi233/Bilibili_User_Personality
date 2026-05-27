import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { withFileLock } from './fileLock.js';

const SUPPORTED_FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];
const DEEPSEEK_V4_MODELS = ['deepseek-v4-flash', 'deepseek-v4-pro'];
const REASONING_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const STOP_TERMS = new Set([
  '变体1',
  '变体2',
  '词或短语',
  '用户名',
  '视频标题',
  '普通名词',
  '证据',
  '来源',
  '数据',
  '报告',
  '论文',
  '攻击',
  '规避',
  '关键词',
  '分类',
]);
const URL_HOST_FRAGMENT_TERMS = new Set(['http', 'https', 'www', 'com', 'cn', 'net', 'org', 'gov', 'mps']);
STOP_TERMS.add('\u6211\u609f\u4e86');
STOP_TERMS.add('\u609f\u4e86');
const ALLOWED_ASCII_KEYWORD_TERMS = new Set([
  'allin',
  'catconfuse',
  'dddd',
  'doge',
  'giegie',
  'lsp',
  'nb',
  'nocap',
  'nt',
  'op',
  'pink',
  'pua',
  'up',
  'wdnmd',
  'xswl',
  'yygq',
  'yyds',
]);
const KNOWN_MOJIBAKE_CHINESE_TERMS = new Set([
  '\u7035\u89c4\u59c9',
  '\u9422\u98ce\u6d0d\u6fc2\u51b2',
  String.fromCodePoint(0x9411, 0xe161, 0x760e),
  String.fromCodePoint(0x7481, 0x3087, 0x7161),
  String.fromCodePoint(0x7487, 0x4f79, 0x5d41),
  String.fromCodePoint(0x95ab, 0x660f, 0x7ddb),
  String.fromCodePoint(0x935a, 0x581c, 0x7d94),
  String.fromCodePoint(0x6dc7, 0xe1bd, 0xe11c),
]);
const KNOWN_MOJIBAKE_CHINESE_PREFIXES = [
  '\u7035\u89c4\u59c9',
  '\u9422\u98ce\u6d0d\u6fc2\u51b2',
  String.fromCodePoint(0x7481, 0x3087, 0x7161),
  String.fromCodePoint(0x7487, 0x4f79, 0x5d41),
  String.fromCodePoint(0x95ab, 0x660f, 0x7ddb),
  String.fromCodePoint(0x935a, 0x581c, 0x7d94),
  String.fromCodePoint(0x6dc7),
];
const MOJIBAKE_MARKER_CHARS = new Set([
  '\u7035',
  '\u59c9',
  '\u9422',
  '\u6d0d',
  '\u6fc2',
  '\u60e7',
  '\u74a7',
  '\u6d94',
  '\u95ab',
  '\u7ddf',
]);
const ANALYSIS_AXIS_LABELS = ['对抗性动机', '认知闭合', '证据敏感', '逻辑一致', '合作讨论', '修正意愿'];
const ANALYSIS_AXIS_ALIASES = new Map([
  ['attack', '对抗性动机'],
  ['antagonism', '对抗性动机'],
  ['对抗', '对抗性动机'],
  ['攻击', '对抗性动机'],
  ['人身攻击', '对抗性动机'],
  [String.fromCodePoint(0x7035, 0x89c4, 0x59c9, 0x6027, 0x52a8, 0x673a), '对抗性动机'],
  [String.fromCodePoint(0x7035, 0x89c4, 0x59c9), '对抗性动机'],
  ['closure', '认知闭合'],
  ['cognitive_closure', '认知闭合'],
  ['认知封闭', '认知闭合'],
  ['绝对化', '认知闭合'],
  [String.fromCodePoint(0x7481, 0x3087, 0x7161, 0x95ee, 0x95ed, 0x609d), '认知闭合'],
  [String.fromCodePoint(0x7481, 0x3087, 0x7161), '认知闭合'],
  ['evidence', '证据敏感'],
  ['evidence_sensitivity', '证据敏感'],
  ['证据', '证据敏感'],
  ['来源', '证据敏感'],
  [String.fromCodePoint(0x7487, 0x4f79, 0x5d41, 0x654f, 0x611f), '证据敏感'],
  [String.fromCodePoint(0x7487, 0x4f79, 0x5d41), '证据敏感'],
  ['logic', '逻辑一致'],
  ['logical_consistency', '逻辑一致'],
  ['逻辑', '逻辑一致'],
  ['论证', '逻辑一致'],
  [String.fromCodePoint(0x95ab, 0x660f, 0x7ddb, 0x7e3d), '逻辑一致'],
  [String.fromCodePoint(0x95ab, 0x660f, 0x7ddb), '逻辑一致'],
  ['cooperation', '合作讨论'],
  ['collaboration', '合作讨论'],
  ['合作', '合作讨论'],
  ['澄清', '合作讨论'],
  [String.fromCodePoint(0x935a, 0x581c, 0x7d94), '合作讨论'],
  ['correction', '修正意愿'],
  ['self_correction', '修正意愿'],
  ['revision', '修正意愿'],
  ['修正', '修正意愿'],
  ['更正', '修正意愿'],
  [String.fromCodePoint(0x6dc7), '修正意愿'],
]);
const FAMILY_ALIASES = {
  sarcasm: 'attack',
  meme: 'cooperation',
  insult: 'attack',
  stanceAttack: 'attack',
  evidenceShift: 'evasion',
  proofShift: 'evasion',
  dodge: 'evasion',
  absolute: 'absolutes',
  overgeneralization: 'absolutes',
  source: 'evidence',
  proof: 'evidence',
  collaborate: 'cooperation',
  hedge: 'cooperation',
  revision: 'correction',
};
const TERM_EVIDENCE_ALIASES = {
  '0\u63d0\u5347': ['\u96f6\u63d0\u5347', '\u6ca1\u6709\u63d0\u5347', '\u4e00\u70b9\u63d0\u5347\u6ca1\u6709', '\u6beb\u65e0\u63d0\u5347'],
  '10\u5e74\u8001\u7c89': ['\u5341\u5e74\u8001\u7c89', '\u8001\u7c89\u5341\u5e74', '\u5341\u5e74\u8001\u7c89\u4e0d\u8bf7\u81ea\u6765'],
  '12300\u5de5\u4fe1\u90e8\u6295\u8bc9': ['\u5de5\u4fe1\u90e8\u6295\u8bc9', '12300\u6295\u8bc9', '\u625312300\u6295\u8bc9'],
  '2026\u6253\u5361': ['\u6253\u53612026', '2026\u5e74\u6253\u5361', '2026\u6253\u5361\u6210\u529f'],
  '\u57c3\u53ca\u5427': ['\u57c3\u53ca\u5427\u8001\u54e5', '\u57c3\u53ca\u5427\u5427\u53cb', '\u57c3\u53ca\u5427\u6765\u4e86'],
  '\u7231\u548b\u548b\u5730': ['\u968f\u4fbf\u4f60\u7231\u548b\u548b\u5730', '\u7231\u548b\u548b\u7684', '\u7231\u600e\u4e48\u7740\u600e\u4e48\u7740'],
  '\u7231\u548b\u548b\u7684': ['\u968f\u4fbf\u4f60\u7231\u548b\u548b\u7684', '\u7231\u548b\u548b\u5730', '\u7231\u600e\u4e48\u7740\u600e\u4e48\u7740'],
  '\u767e\u5ea6\u767e\u79d1': ['\u767e\u5ea6\u767e\u79d1\u6709\u5199', '\u767e\u79d1\u6709\u5199', '\u67e5\u767e\u5ea6\u767e\u79d1'],
  '\u767e\u79d1': ['\u767e\u5ea6\u767e\u79d1\u6709\u5199', '\u767e\u79d1\u6709\u5199', '\u67e5\u767e\u79d1'],
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97': ['\u4e0d\u4f1a\u771f\u6709\u4eba', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97', '\u4e0d\u4f1a\u771f\u6709\u4eba\u4ee5\u4e3a'],
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427': ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', '\u4e0d\u4f1a\u771f\u6709\u4eba', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97'],
  '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427': [
    '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97',
    '\u4e0d\u4f1a\u771f\u6709\u4eba',
    '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97',
    '\u8fd9\u4e5f\u53eb\u8bc1\u636e',
  ],
  '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86': ['\u8d62\u9ebb\u4e86', '\u8d62\u9ebb'],
  '\u5355\u8d706': ['\u5355\u8d70\u4e00\u4e2a6', '\u8d70\u4e00\u4e2a6'],
  '\u5355\u8d70\u4e00\u4e2a6': ['\u5355\u8d706', '\u8d70\u4e00\u4e2a6'],
  '\u8d70\u4e00\u4e2a6': ['\u5355\u8d706', '\u5355\u8d70\u4e00\u4e2a6'],
  '\u8f66\u5bb6\u519b': ['\u96f7\u519b\u7c89\u4e1d', '\u5c0f\u7c73\u8f66\u7c89', 'SU7\u7c89\u4e1d', '\u7c73\u7c89\u63a7\u8bc4', '\u5c0f\u7c73\u6c34\u519b'],
  '\u6ca1\u6709\u8f66\u5bb6\u519b': ['\u8f66\u5bb6\u519b', '\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b', '\u4e0d\u662f\u8f66\u5bb6\u519b', '\u7c73\u7c89\u63a7\u8bc4', '\u5c0f\u7c73\u6c34\u519b'],
  '\u8e6d\u6982\u5ff5': ['AI\u6982\u5ff5', '\u786c\u8e6d\u6982\u5ff5', '\u8e6d\u70ed\u5ea6'],
  '\u8c01\u662f\u8e6d\u6982\u5ff5': ['\u8e6d\u6982\u5ff5', '\u8c01\u5728\u8e6d\u6982\u5ff5', '\u8c01\u5728\u8e6dAI', '\u8e6d\u6982\u5ff5\u662f\u8c01', 'AI\u6982\u5ff5', '\u786c\u8e6d\u6982\u5ff5'],
  '\u7cbe\u795e\u5916\u56fd\u4eba': ['\u7cbe\u5916', '\u6d0b\u5974', '\u6b96\u4eba'],
  '\u524d\u9762\u8bf4\u91cd\u4e86': ['\u6211\u8bf4\u91cd\u4e86', '\u8bf4\u91cd\u4e86', '\u521a\u624d\u8bf4\u91cd\u4e86', '\u8bf4\u9519\u4e86', '\u521a\u624d\u8bf4\u9519\u4e86', '\u6211\u6536\u56de'],
  '\u95ee\u8001\u9a6c\u672c\u4eba': ['\u95ee\u672c\u4eba', '\u53bb\u95ee\u672c\u4eba', '\u95ee\u9a6c\u65af\u514b\u672c\u4eba', '\u95ee\u9a6c\u65af\u514b', '\u95ee\u57c3\u9686', 'Elon'],
  '\u53ef\u4ee5\u8d34': ['\u53ef\u4ee5\u53d1', '\u8d34\u51fa\u6765', '\u53d1\u51fa\u6765', '\u53ef\u4ee5\u8d34\u4e00\u4e0b', '\u53ef\u4ee5\u53d1\u4e00\u4e0b'],
  '\u81ea\u5df1\u67e5': ['\u81ea\u5df1\u641c', '\u4f60\u81ea\u5df1\u641c', '\u81ea\u5df1\u67e5\u53bb'],
  '\u81ea\u5df1\u67e5\u53bb': ['\u81ea\u5df1\u67e5', '\u81ea\u5df1\u641c'],
  '\u81ea\u5df1\u641c': ['\u81ea\u5df1\u67e5'],
  '\u95ee\u767e\u5ea6': ['\u4e0d\u4f1a\u767e\u5ea6', '\u81ea\u5df1\u767e\u5ea6', '\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417', '\u4e0d\u4f1a\u81ea\u5df1\u767e\u5ea6\u5417'],
  '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528': ['\u4e0d\u4f1a\u767e\u5ea6', '\u81ea\u5df1\u767e\u5ea6', '\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417', '\u95ee\u767e\u5ea6'],
  '\u62d0\u53cb\u5546': ['\u62ffDNF\u6765\u62d0', '\u62ffdnf\u6765\u62d0', '\u53cb\u5546\u56f4\u730e', '\u62ff\u53cb\u5546\u6765\u62d0', '\u62ffdnf\u62d0'],
  '\u5173\u4e86\u5427': ['\u8fd9\u6d3b\u5173\u4e86\u5427', '\u6ca1\u6d3b\u5173\u4e86\u5427', '\u522b\u64ad\u4e86\u5173\u4e86\u5427'],
  '\u5173\u4e86\u5427\u6ca1\u610f\u601d': ['\u8fd9\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d', '\u5173\u4e86\u5427\u771f\u6ca1\u610f\u601d', '\u6ca1\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d'],
  '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19': ['\u5e7f\u897f\u7cbe\u795e\u5c0f\u4f19\u523b\u677f\u5370\u8c61', '\u5e7f\u897f\u4eba\u4e5f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19', '\u522b\u523b\u677f\u5370\u8c61\u5e7f\u897f\u7cbe\u795e\u5c0f\u4f19', '\u5e7f\u897f\u4eba\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19'],
  '\u8d35\u5bbe\u5f52\u96f6': ['\u798f\u888b\u4e00\u505c\u8d35\u5bbe\u5f52\u96f6', '\u798f\u888b\u4e00\u505c\uff0c\u8d35\u5bbe\u5f52\u96f6', '\u76f4\u64ad\u95f4\u8d35\u5bbe\u5f52\u96f6', '\u4e3b\u64ad\u8d35\u5bbe\u5f52\u96f6'],
  '\u56fd\u9645\u5b85\u7537\u8054\u76df': ['\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u7ec4\u5efa\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u5b85\u7537\u8054\u76df\u51fa\u5175', '\u51fa\u5175\u5f81\u670d\u7f8e\u56fd'],
  '\u5b85\u7537\u8054\u76df': ['\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u7ec4\u5efa\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u5b85\u7537\u8054\u76df\u51fa\u5175', '\u51fa\u5175\u5f81\u670d\u7f8e\u56fd'],
  '\u5835\u4f4f\u4eba\u6c11\u5634': ['\u6342\u4f4f\u4eba\u6c11\u7684\u5634', '\u6342\u4f4f\u4eba\u6c11\u5634', '\u5835\u4f4f\u4eba\u6c11\u7684\u5634', '\u5835\u5634'],
  '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb': ['\u9ad8\u4f4e\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u9001\u4e0a\u53bb', '\u9876\u4e0a\u53bb'],
  '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708': ['\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708', '\u6d3b\u4e0d\u8fc7\u4fe9\u6708', '\u6ca1\u6d3b\u8fc7\u4fe9\u6708'],
  '\u54ea\u90fd\u6709\u4f60': ['\u54ea\u513f\u90fd\u6709\u4f60', '\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u5230\u54ea\u90fd\u6709\u4f60'],
  '\u600e\u4e48\u54ea\u54ea\u90fd\u6709\u4f60': ['\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u54ea\u54ea\u90fd\u6709\u4f60', '\u54ea\u513f\u90fd\u6709\u4f60'],
  'tv\u574f\u7b11': ['\u574f\u7b11', 'tv\u574f\u7b11\u8868\u60c5'],
  '\u5c0f\u7c89\u7ea2': ['\u7c89\u7ea2'],
  '\u7ef7\u4e0d\u4f4f\u4e86': ['\u7ef7\u4e0d\u4f4f', '\u6ca1\u7ef7\u4f4f', '\u771f\u7ef7\u4e0d\u4f4f'],
  '\u6ca1\u7528\u771f\u662f\u7ef7\u4e0d\u4f4f\u4e86': ['\u6ca1\u7528\u771f\u7ef7\u4e0d\u4f4f', '\u6ca1\u7528\u7ef7\u4e0d\u4f4f', '\u6ca1\u7528\u771f\u662f\u7ef7\u4e0d\u4f4f'],
  '\u4e0d\u670d\u61cb\u7740': ['\u4e0d\u670d\u4e5f\u61cb\u7740', '\u4e0d\u670d\u5c31\u61cb\u7740'],
  '\u8d37\u83f2\u4e0d\u670d\u61cb\u7740': ['\u4e0d\u670d\u61cb\u7740', '\u4e0d\u670d\u4e5f\u61cb\u7740', '\u4e0d\u670d\u5c31\u61cb\u7740'],
  '\u88c5\u4ec0\u4e48': ['\u88c5\u5565', '\u4f60\u88c5\u4ec0\u4e48', '\u5728\u88c5\u4ec0\u4e48'],
  '\u4f60\u88c5\u4ec0\u4e48': ['\u88c5\u4ec0\u4e48', '\u88c5\u5565', '\u5728\u88c5\u4ec0\u4e48'],
  '\u4e0d\u662f\u5229\u5203\u4f60\u88c5\u4ec0\u4e48': ['\u4f60\u88c5\u4ec0\u4e48', '\u88c5\u4ec0\u4e48', '\u5728\u88c5\u4ec0\u4e48'],
  '\u521d\u542c\u4e0d\u77e5\u66f2\u4e2d\u610f': ['\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba', '\u521d\u542c\u4e0d\u77e5\u66f2\u4e2d\u610f\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba'],
  '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981': ['\u5982\u6b64\u91cd\u8981', '\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981'],
  '\u62d4\u7fa4': ['\u6548\u679c\u62d4\u7fa4'],
  '\u7092\u9e21\u597d\u7528': ['\u8d85\u7ea7\u597d\u7528', '\u8d85\u597d\u7528', '\u7092\u9e21\u597d\u4f7f'],
  '\u4e0d\u53ef\u62b5\u6297\u529b': ['\u4e0d\u53ef\u6297\u529b'],
  '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba': ['\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba', '\u4e0d\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba', '\u6ca1\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba', '\u770b\u90fd\u4e0d\u770b\u5c31\u8bc4\u8bba'],
  '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba': ['\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba', '\u4e0d\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba', '\u6ca1\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba'],
  '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86': ['\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86', '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb', '\u9f3b\u5c4e\u559d\u8fdb\u53bb'],
  '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86': ['\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86', '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb', '\u9f3b\u5c4e\u559d\u8fdb\u53bb'],
  '\u732a\u9f3b': ['\u732a\u903c', '\u732a\u6bd4', '\u732a\u5e01'],
  '\u5403\u4e8f\u662f\u798f': ['\u8fd9\u798f\u7ed9\u4f60', '\u4f60\u53bb\u5403\u4e8f', '\u8c01\u5403\u4e8f\u8c01\u6709\u798f'],
  '\u51fa\u5904': ['\u6c42\u51fa\u5904', '\u6709\u51fa\u5904\u5417', '\u539f\u6587\u51fa\u5904', '\u51fa\u5904\u5462', '\u53d1\u51fa\u5904'],
  '\u963f\u7f8e\u8389\u5361': ['\u963f\u7f8e\u5229\u5361', '\u7f8e\u5229\u575a', '\u6f02\u4eae\u56fd', '\u963f\u7f8e'],
  '\u4e0d\u4e00\u4e00': ['\u4e0d\u4e00\u4e00\u5217\u4e3e', '\u4e0d\u4e00\u4e00\u56de\u590d', '\u4e0d\u4e00\u4e00\u8bc4\u4ef7', '\u5c31\u4e0d\u4e00\u4e00\u8bc4\u4ef7\u4e86', '\u4e0d\u4e00\u4e00\u8bf4\u660e'],
  '\u5927\u9b54\u6cd5\u5e08': ['\u9b54\u6cd5\u5e08', '\u4e09\u5341\u5c81\u9b54\u6cd5\u5e08', '30\u5c81\u9b54\u6cd5\u5e08'],
  '\u5730\u56fe\u70ae': ['\u5f00\u5730\u56fe\u70ae', '\u5730\u57df\u9ed1', '\u5730\u57df\u70ae'],
  '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684': ['\u4eba\u673a\u81ea\u52a8\u53d1', '\u90fd\u662f\u673a\u5668\u4eba', '\u673a\u5668\u4eba\u53d1\u7684', '\u81ea\u52a8\u53d1\u7684'],
  '\u522b\u55b7': ['\u522b\u55b7\u6211', '\u8f7b\u70b9\u55b7', '\u5148\u522b\u55b7', '\u4e0d\u559c\u52ff\u55b7'],
  '\u4e0d\u9ed1\u4e0d\u5439': ['\u4e0d\u5439\u4e0d\u9ed1', '\u6709\u4e00\u8bf4\u4e00', '\u5ba2\u89c2\u8bc4\u4ef7', '\u8bf4\u53e5\u516c\u9053\u8bdd'],
  '\u4e0d\u674e\u59d0': ['\u4e0d\u7406\u89e3', '\u6211\u4e0d\u7406\u89e3', '\u4e0d\u674e\u59d0\u554a', '\u6211\u4e0d\u674e\u59d0'],
  '\u6211\u4e0d\u674e\u59d0': ['\u4e0d\u674e\u59d0', '\u4e0d\u7406\u89e3', '\u6211\u4e0d\u7406\u89e3', '\u4e0d\u674e\u59d0\u554a'],
  '\u4e0d\u662f\u4eba\u4e86': ['\u4f60\u4e0d\u662f\u4eba', '\u771f\u4e0d\u662f\u4eba', '\u8fd8\u662f\u4eba\u5417', '\u4e0d\u5f53\u4eba'],
  '\u4e0d\u662f\u4eba\u4e86\u5457': ['\u4e0d\u662f\u4eba\u4e86', '\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457', '\u4f60\u4e0d\u662f\u4eba', '\u771f\u4e0d\u662f\u4eba'],
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23': ['\u4e09\u4e0d\u539f\u5219', '\u4e0d\u4e3b\u52a8 \u4e0d\u62d2\u7edd \u4e0d\u8d1f\u8d23', '\u4e0d\u4e3b\u52a8\u4e0d\u6297\u62d2\u4e0d\u8d1f\u8d23'],
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd': ['\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23', '\u4e09\u4e0d\u539f\u5219', '\u4e0d\u4e3b\u52a8 \u4e0d\u62d2\u7edd'],
  '\u5f20\u5634\u903c\u903c\u53e8\u53e8': ['\u903c\u903c\u53e8\u53e8', '\u903c\u903c\u53e8', '\u778e\u903c\u903c', '\u5c31\u4f1a\u903c\u903c'],
  '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11': ['\u4e0d\u7edd\u5bf9\u4f46\u4e0d\u5c11', '\u97e9\u56fd\u4e0d\u5c11', '\u4e0d\u7edd\u5bf9 \u97e9\u56fd \u4e0d\u5c11'],
  '\u8fb9\u70b8\u8fb9\u79ef\u5fb7': ['\u6c22\u5f39\u8fb9\u70b8\u8fb9\u79ef\u5fb7', '\u6838\u7206\u79ef\u5fb7', '\u6838\u5f39\u79ef\u5fb7', '\u8fb9\u70b8\u8fb9\u79ef\u5fb7'],
  '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d': ['\u5dee\u8bc4\u591a\u4e00\u5b9a\u4e0d\u597d', '\u5dee\u8bc4\u591a\u5c31\u4e00\u5b9a\u4e0d\u597d', '\u5dee\u8bc4\u591a\u4e0d\u597d'],
  '\u8f66\u8f71\u8f98': ['\u8f66\u8f71\u8f98\u8bdd', '\u8f66\u8f71\u8f98\u6765\u56de\u8bf4', '\u8f66\u8f71\u8f98\u4e00\u6837'],
  '\u5b58\u7591\u7f57\u9a6c\u4eba': ['\u7f57\u9a6c\u4eba\u5b58\u7591', '\u7f57\u9a6c\u8eab\u4efd\u5b58\u7591', '\u5b58\u7591\u7684\u7f57\u9a6c\u4eba'],
  '\u4e0d\u8981\u80e1\u8bf4': ['\u522b\u80e1\u8bf4', '\u4e0d\u8981\u4e71\u8bf4', '\u522b\u4e71\u8bf4', '\u80e1\u8bf4\u4ec0\u4e48'],
  '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302': ['\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302', '\u8fbe\u7edd\u5bc6\u91cc\u9762\u5168\u662f\u6302', '\u7edd\u5bc6\u5168\u662f\u6302', '\u673a\u5bc6\u5168\u662f\u6302', '\u5168\u662f\u6302'],
  '\u51fa\u751f': ['\u7eaf\u51fa\u751f', '\u51fa\u751f\u4e1c\u897f', '\u5c0f\u51fa\u751f', '\u51fa\u751f\u6253\u6cd5'],
  '\u5927\u53f7\u6ca1\u4e86': ['\u53f7\u6ca1\u4e86', '\u5927\u53f7\u6ca1', '\u53f7\u88ab\u5c01\u4e86', '\u8d26\u53f7\u6ca1\u4e86'],
  '\u902e\u6355': ['\u88ab\u902e\u6355', '\u5f53\u573a\u902e\u6355', '\u5f53\u573a\u88ab\u902e\u6355', '\u6b27\u6d32\u902e\u6355'],
  '\u9053\u5fc3\u7834\u788e': ['\u9053\u5fc3\u788e\u4e86', '\u9053\u5fc3\u5d29\u4e86', '\u9053\u5fc3\u7834\u9632', '\u9053\u5fc3\u7834\u788e\u4e86'],
  '\u4f4e\u60c5\u5546': ['\u4f4e\u60c5\u5546\uff1a', '\u9ad8\u60c5\u5546\u4f4e\u60c5\u5546', '\u9ad8\u60c5\u5546 \u4f4e\u60c5\u5546'],
  '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86': ['\u574f\u4e86\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86', '\u7b2c\u4e00\u904d\u5c31\u770b\u61c2\u4e86', '\u574f\u4e86 \u770b\u61c2\u4e86'],
  '\u90fd\u662f\u5bb6\u4eba': ['\u5bb6\u4eba\u4eec', '\u5bb6\u4eba\u4eec\u8c01\u61c2', '\u5bb6\u4eba\u4eec\u7b11\u4e0d\u6d3b'],
  '\u5bb6\u4eba': ['\u5bb6\u4eba\u4eec', '\u5bb6\u4eba\u4eec\u8c01\u61c2', '\u5bb6\u4eba\u4eec\u7b11\u4e0d\u6d3b'],
  '\u8349\u751f': ['\u751f\u8349', '\u8349\u4e86', '\u8349\u554a'],
  '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236': ['\u590d\u5236\u5f39\u5e55', '\u5168\u662f\u590d\u5236\u5f39\u5e55', '\u5e26\u8282\u594f\u5f39\u5e55', '\u5f39\u5e55\u590d\u5236'],
  '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211': ['\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u6211\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u9996\u4e2a\u6295\u5e01'],
  '\u53d1\u56fe': ['\u4e0a\u56fe', '\u6c42\u56fe', '\u653e\u56fe', '\u56fe\u5462'],
  '\u996d\u5708\u5473': ['\u996d\u5708\u5473\u592a\u51b2', '\u50cf\u996d\u5708', '\u996d\u5708\u90a3\u5473', '\u996d\u5708\u5f0f'],
  '\u8d29\u5b50\u5c0f\u53f7': ['\u9ec4\u725b\u5c0f\u53f7', '\u5012\u5356\u5c0f\u53f7', '\u8d29\u5b50\u53f7', '\u5c0f\u53f7\u5e26\u4ef7'],
  '\u5f39\u6027\u56de\u5e94': ['\u9009\u62e9\u6027\u56de\u5e94', '\u53ea\u56de\u5e94\u8fd9\u4e2a', '\u4e0d\u56de\u5e94\u90a3\u4e2a', '\u88c5\u6b7b\u4e0d\u56de\u5e94'],
  '\u7c89\u4e1d\u7206\u7834': ['\u7206\u7834\u4f60', '\u88ab\u7c89\u4e1d\u7206\u7834', '\u7c89\u4e1d\u6252\u5730\u5740', '\u7c89\u4e1d\u6252\u5b66\u6821'],
  '\u5c01100\u5e74': ['\u5c01\u53f7100\u5e74', '\u5c01\u4e00\u767e\u5e74', '\u5c01\u4e86\u4e00\u767e\u5e74', '\u5c01\u5230100\u5e74'],
  '\u5c01\u53f7100\u5e74': ['\u5c01100\u5e74', '\u5c01\u53f7\u4e00\u767e\u5e74', '\u5c01\u5230100\u5e74', '\u8d26\u53f7\u5c01100\u5e74'],
  '\u7c89\u5a07\u4f60\u51e0': ['\u7c89\u5a07\u4f60\u51e0\u5c81', '\u7c89\u8272\u5a07\u5ae9\u4f60\u51e0\u5c81', '\u5a07\u5ae9\u4f60\u51e0\u5c81', '\u7504\u5b1b\u4f20\u7c89\u5a07\u4f60\u51e0'],
  '\u4e0d\u662f\u6760': ['\u4e0d\u662f\u6211\u6760', '\u6211\u4e0d\u662f\u6760', '\u4e0d\u662f\u62ac\u6760', '\u4e0d\u7b97\u62ac\u6760'],
  '\u7eaf\u594b\u5173': ['\u7eaf\u7caa\u5173', '\u594b\u5173', '\u7caa\u5173', '\u8fd9\u5173\u771f\u7caa'],
  '\u5927\u8dcc\u763e': ['\u5927\u7239\u763e', '\u7239\u5473\u763e', '\u8bad\u7c89', '\u51fa\u6765\u8bad\u7c89'],
  '\u8d1f\u5206\u6eda\u7c97': ['\u6eda\u7c97', '\u8d1f\u5206\u6eda', '\u96f6\u5206\u6eda\u7c97', '\u5dee\u8bc4\u6eda\u7c97', '\u8d1f\u5206\u6eda\u7c97\u5427', '\u96f6\u5206\u6eda', '\u6eda\u7c97\u5427', '\u5efa\u8bae\u6eda\u7c97'],
  '\u5ddd\u5efa\u56fd': ['\u5ddd\u666e', '\u7279\u6717\u666e', '\u5efa\u56fd\u540c\u5fd7', '\u5510\u7eb3\u5fb7\u7279\u6717\u666e'],
  '\u5ddd\u666e': ['\u7279\u6717\u666e', '\u5ddd\u5efa\u56fd', 'Trump', '\u5510\u7eb3\u5fb7\u7279\u6717\u666e'],
  '\u540a\u6253': ['\u5b8c\u7206', '\u78be\u538b', '\u79d2\u6740', '\u6253\u7206'],
  '\u798f\u745e\u63a7': ['furry\u63a7', '\u798f\u745e', 'furry', '\u6bdb\u8338\u8338\u63a7'],
  '\u9644\u8bae': ['\u81e3\u9644\u8bae', '\u6211\u9644\u8bae', '\u8868\u793a\u9644\u8bae', '\u53cc\u624b\u9644\u8bae'],
  '\u590d\u6d3b\u8d5b': ['\u6253\u590d\u6d3b\u8d5b', '\u590d\u6d3b\u8d5b\u6253', '\u4e92\u8054\u7f51\u590d\u6d3b\u8d5b', '\u8d26\u53f7\u590d\u6d3b\u8d5b'],
  '\u5c2c\u5230\u62a0\u811a': ['\u5c34\u5c2c\u5230\u62a0\u811a', '\u5c2c\u5f97\u62a0\u811a', '\u62a0\u51fa\u4e09\u5ba4\u4e00\u5385', '\u5c2c\u5230\u811a\u8dbe\u6293\u5730', '\u5c34\u5c2c\u5f97\u62a0\u811a', '\u5c2c\u5230\u811a\u8dbe\u6293\u5730'],
  '\u8be5\u9a82\u5c31\u9a82': ['\u8be5\u9a82\u9a82', '\u8be5\u9a82\u8fd8\u662f\u9a82', '\u8be5\u9a82\u5c31\u8981\u9a82', '\u8be5\u55b7\u5c31\u55b7', '\u8be5\u9a82\u5c31\u5f97\u9a82', '\u8be5\u6279\u8bc4\u5c31\u6279\u8bc4'],
  '\u76d6\u4e16\u592a\u4fdd': ['\u683c\u4e16\u592a\u4fdd', '\u8a00\u8bba\u76d6\u4e16\u592a\u4fdd', '\u5c0f\u76d6\u4e16\u592a\u4fdd', '\u5ba1\u67e5\u76d6\u4e16\u592a\u4fdd'],
  '\u8d76\u7f9a\u7f8a': ['\u5e72\u4f60\u5a18', '\u8d76\u7f9a\u7f8a\u554a', '\u8d76\u7f9a\u7f8a\u7684', '\u6df1\u84dd\u8d76\u7f9a\u7f8a'],
  '\u611f\u8c22\u6307\u6b63': ['\u611f\u8c22\u6307\u51fa', '\u8c22\u8c22\u6307\u6b63', '\u8c22\u8c22\u6307\u51fa', '\u5df2\u4fee\u6b63'],
  '\u5e72\u5d29\u963f': ['\u5e72\u5d29\u963fB', '\u5e72\u5d29b\u7ad9', '\u5e72\u5d29B\u7ad9', '\u641e\u5d29\u963fB'],
  '\u5e72\u8d27': ['\u5e72\u8d27up', '\u6709\u5e72\u8d27', '\u771f\u5e72\u8d27', '\u6ee1\u6ee1\u5e72\u8d27'],
  '\u5e72\u8d27up': ['\u5e72\u8d27', '\u5e72\u8d27up\u4e3b', '\u5e72\u8d27UP', '\u5e72\u8d27\u535a\u4e3b'],
  '\u5965\u5229\u7ed9': ['\u5965\u529b\u7ed9', '\u5965\u5229\u7ed9\u5144\u5f1f\u4eec', '\u5965\u5229\u7ed9\u5e72\u4e86', '\u7ed9\u529b\u55f7'],
  '\u767e\u53d8\u9a6c\u4e01': ['\u9a6c\u4e01', '\u767e\u53d8\u9a6c\u4e01\u6765\u4e86', '\u50cf\u767e\u53d8\u9a6c\u4e01', '\u767e\u53d8\u9a6c\u4e01\u662f\u5427'],
  '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047': ['\u9ad8\u5983\u5f85\u9047', '\u9ad8\u8d35\u5983\u5e94\u5f97\u7684\u5f85\u9047', '\u8fd9\u5c31\u662f\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047', '\u9ad8\u5983\u8be5\u6709\u7684\u5f85\u9047'],
  '\u9ad8\u7ea7jn': ['\u9ad8\u7ea7JN', '\u9ad8\u7ea7jn\u662f\u5427', '\u9ad8\u7ea7jn\u53d1\u8a00', '\u9ad8\u7ea7jn\u884c\u4e3a'],
  '\u6401\u8fd9\u6401\u8fd9': ['\u6401\u8fd9\u6401\u8fd9\u5462', '\u6401\u8fd9\u6401\u8fd9\u4e86', '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462', '\u6401\u8fd9\u5957\u5a03'],
  '\u6401\u8fd9\u5462': ['\u4f60\u6401\u8fd9\u6401\u8fd9\u5462', '\u6401\u8fd9\u6401\u8fd9\u5462', '\u6401\u8fd9\u5462\u662f\u5427', '\u6401\u8fd9\u5957\u5a03'],
  '\u4e2a\u7b7e': ['\u6211\u7684\u4e2a\u7b7e', '\u4e2a\u7b7e\u4e5f\u662f', '\u4e2a\u7b7e\u662f\u8fd9\u9996\u6b4c', '\u4e2a\u6027\u7b7e\u540d'],
  '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929': ['\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u7ed9\u4f60\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u7ed9\u4f60\u4e00\u6839\u7f51\u7ebf\u4ed6\u80fd\u4e0a\u5929', '\u952e\u76d8\u4fa0\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u952e\u76d8\u8bbe\u8ba1\u5e08\u7ed9\u6839\u7f51\u7ebf'],
  '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5': ['\u6211\u4eec\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', '\u7ed9\u7b5b\u5b50\u91cc\u704c\u94c5', '\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', '\u704c\u94c5\u7b5b\u5b50', '\u7b5b\u5b50\u704c\u94c5'],
  '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5': ['\u6211\u4eec\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5', '\u7ed9\u9ab0\u5b50\u704c\u94c5', '\u9ab0\u5b50\u704c\u4e86\u94c5', '\u704c\u94c5\u9ab0\u5b50', '\u9ab0\u5b50\u704c\u94c5'],
  '\u7ed9\u7237\u722c': ['\u7ed9\u7237\u722c', '\u7ed9\u7237\u722c\u5427', '\u60a8\u914d\u5417\u7ed9\u7237\u722c'],
  '\u7ed9\u7237\u6574\u5b5d\u4e86': ['\u7ed9\u7237\u6574\u5b5d\u4e86', '\u7ed9\u7237\u6574\u7b11\u4e86', '\u771f\u7ed9\u7237\u6574\u5b5d\u4e86'],
  '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c': ['\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440', '\u6ca1\u6709\u53c2\u8003\u4ef7\u503c', '\u6839\u672c\u6ca1\u53c2\u8003\u4ef7\u503c'],
  '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8': ['\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8', '\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8', '\u6839\u672c\u6ca1\u8bf4\u4e0d\u5141\u8bb8'],
  '\u5de5\u91cdhao': ['\u5de5\u91cd\u53f7', '\u516c\u91cd\u53f7', '\u516c\u7cbd\u53f7'],
  '\u516c\u5f0f\u5957\u53cd\u4e86': ['\u516c\u5f0f\u7528\u53cd\u4e86', '\u516c\u5f0f\u5957\u9519\u4e86', '\u516c\u5f0f\u53cd\u4e86', '\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86', '\u4f60\u516c\u5f0f\u7528\u53cd\u4e86'],
  '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af': ['\u6211\u5bb6\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86', '\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86', '\u5f00\u59cb\u63d2\u79e7\u4e86', '\u4f1a\u63d2\u79e7\u4e86\u54e6'],
  '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728': ['\u6d6e\u6728\u4fa0', '\u6d6e\u6728\u6253\u65ad', '\u62ff\u8d77\u8f6e\u6905', '\u6bcf\u4e2a\u6d6e\u6728\u4fa0'],
  '\u72d7\u5c4e\u673a\u5236': ['\u72d7\u5c4e\u5339\u914d\u673a\u5236', '\u72d7\u5c4e\u673a\u5236\u771f\u5e26\u4e0d\u52a8', '\u5339\u914d\u673a\u5236\u72d7\u5c4e', '\u72d7\u5c4e\u5148\u6478\u540e\u62ff\u673a\u5236'],
  '\u82df\u76841b': ['\u592a\u82df\u4e86', '\u82df\u52301b', '\u82df\u7684\u4e00\u6279', '\u82df\u5f97\u4e00\u6279'],
  '\u53e4\u5c38\u7ea7': ['\u9aa8\u7070\u7ea7', '\u9aa8\u7070\u7ea7\u8001\u73a9\u5bb6', '\u8001\u53e4\u8463\u7ea7', '\u53e4\u8463\u7ea7'],
  '\u4fdd\u62a4\u6211\u65b9': ['\u4fdd\u62a4\u6211\u65b9up', '\u4fdd\u62a4\u6211\u65b9\u961f\u53cb', '\u4fdd\u62a4\u6211\u65b9\u53cb\u519b', '\u4fdd\u62a4\u6211\u65b9\u8001\u5e08'],
  '\u6bd4\u515c': ['\u6247\u4f60\u6bd4\u515c', '\u7ed9\u4f60\u4e00\u6bd4\u515c', '\u5927\u6bd4\u515c', '\u4e00\u4e2a\u6bd4\u515c'],
  '\u5927\u6bd4\u515c': ['\u6bd4\u515c', '\u6247\u4f60\u5927\u6bd4\u515c', '\u7ed9\u4f60\u4e00\u4e2a\u5927\u6bd4\u515c', '\u5927\u903c\u515c'],
  '\u88ab\u62e7\u75bc\u4e86': ['\u62e7\u75bc\u4e86', '\u88ab\u62e7\u75db\u4e86', '\u53c8\u88ab\u62e7\u75bc\u4e86', '\u62e7\u75bc', '\u88ab\u62e7\u75bc\u4e86\u6025\u4e86', '\u62e7\u75bc\u4e86\u6025\u4e86'],
  '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c': ['\u89c9\u5f97\u81ea\u5df1\u5f88\u5c4c', '\u771f\u89c9\u5f97\u81ea\u5df1\u5f88\u5c4c', '\u611f\u89c9\u81ea\u5df1\u5f88\u725b', '\u89c9\u5f97\u81ea\u5df1\u5f88\u725b\u903c', '\u89c9\u5f97\u81ea\u5df1\u5c31\u662f\u6b63\u4e49\u4e4b\u58eb', '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4cdoge'],
  '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f': ['\u94a2\u94c1\u8463\u4e8b\u957f', '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f\u662f\u5427', '\u67d0\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f', '\u94a2\u94c1\u516c\u53f8\u8001\u603b', '\u54df\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f'],
  '\u6e2f\u6ef4\u5bf9': ['\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5', '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1', '\u8bb2\u5f97\u5bf9', '\u8bb2\u7684\u5bf9', '\u521a\u6ef4\u5bf9'],
  '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5': ['\u6e2f\u6ef4\u5bf9', '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1', '\u8bb2\u5f97\u5bf9\u6ca1\u6bdb\u75c5', '\u8bb2\u7684\u5bf9\u6ca1\u6bdb\u75c5'],
  '\u6760\u7cbe': ['\u62ac\u6760\u7cbe', '\u8001\u6760\u7cbe', '\u8fd9\u6760\u7cbe', '\u6760\u7cbe\u672c\u7cbe'],
  '\u61c2\u7684\u90fd\u61c2': ['dddd'],
  dddd: ['\u61c2\u7684\u90fd\u61c2'],
  yygq: ['\u9634\u9633\u602a\u6c14'],
  pink: ['\u7c89\u7ea2', '\u5c0f\u7c89\u7ea2'],
};

export const DEFAULT_DICTIONARY_PATH = process.env.DEEPSEEK_KEYWORD_DICTIONARY_PATH || join(process.cwd(), 'server', 'deepseekKeywordDictionary.json');

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function uniqueBy(items, keyFn) {
  return [...new Map(items.filter(Boolean).map((item) => [keyFn(item), item])).values()];
}

function cleanTerm(term) {
  return String(term || '')
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '')
    .replace(/^\d+(?=百分百$)/u, '')
    .replace(/(?<=\p{Script=Han})[A-Za-z]$/u, '')
    .trim();
}

function cleanKeywordTerm(term) {
  if (looksLikeMojibakeChinese(term)) return '';
  let cleaned = cleanTerm(term)
    .replace(/[A-Za-z0-9]+/g, (match) => match.toLowerCase())
    .replace(/^热词系列/u, '')
    .trim();
  if (/[\p{Script=Han}]/u.test(cleaned) && /doge$/i.test(cleaned) && cleaned.length > 'doge'.length + 1) {
    cleaned = cleaned.replace(/doge$/i, '');
  }
  return cleaned;
}

function parseTargetTerms(...values) {
  const terms = [];
  for (const value of values) {
    if (Array.isArray(value)) {
      terms.push(...value);
    } else if (value !== undefined && value !== null) {
      terms.push(...String(value).split(/[\r\n,;|]+/));
    }
  }
  return new Set(terms.map(cleanKeywordTerm).filter(Boolean));
}

function dictionaryScopedToTerms(dictionary, targetTerms) {
  if (!targetTerms || targetTerms.size === 0) return dictionary;
  return {
    ...dictionary,
    entries: (Array.isArray(dictionary?.entries) ? dictionary.entries : []).filter((entry) => targetTerms.has(cleanKeywordTerm(entry?.term))),
  };
}

function looksLikeMojibakeChinese(term) {
  const text = String(term || '').trim();
  if (!text || !/[\p{Script=Han}]/u.test(text)) return false;
  if (KNOWN_MOJIBAKE_CHINESE_TERMS.has(text)) return true;
  if (KNOWN_MOJIBAKE_CHINESE_PREFIXES.some((prefix) => text.startsWith(prefix) && text.length > prefix.length)) return true;
  if (/[\ue000-\uf8ff\ufffd]/u.test(text)) return true;
  if (/[�]|\?{2,}/u.test(text)) return true;

  const chars = [...text];
  const markerCount = chars.filter((char) => MOJIBAKE_MARKER_CHARS.has(char)).length;
  return markerCount >= 2 && markerCount / chars.length >= 0.5;
}

function isNoisyTerm(term) {
  if (URL_HOST_FRAGMENT_TERMS.has(String(term).toLowerCase())) return true;
  if (looksLikeMojibakeChinese(term)) return true;
  if (!term || STOP_TERMS.has(term) || /^变体\d+$/.test(term)) return true;
  if (/[^\p{Script=Han}A-Za-z0-9]/u.test(term)) return true;
  if (/^(?:BV[0-9A-Za-z]{8,}|av\d{6,})$/i.test(term)) return true;
  if (/^\d+(?:vip|VIP|会员)$/.test(term)) return true;
  if (/\d{3,}元/.test(term) || /^最高领\d+元$/.test(term)) return true;
  if (/^\d+$/.test(term)) return true;
  if (/^[A-Za-z]$/.test(term)) return true;
  if (/^[A-Za-z0-9]+$/.test(term) && !ALLOWED_ASCII_KEYWORD_TERMS.has(String(term).toLowerCase())) return true;
  if (/^去问(?!百度|谷歌|Google|搜索|老师|客服)/i.test(term)) return true;
  if (term === '\u4f46\u6211\u7edd\u5bf9\u4e0d\u4f1a\u53bb\u7978\u5bb3\u522b') return true;
  return false;
}

function isNoisyEvidenceSample(sample) {
  const text = String(sample || '').trim();
  if (!text) return true;
  if (/^\u5f02\u8bae(?:[\u0021\uff01\u3002\s]|\[doge\]|\uff08\u5e7b\u542c\uff09)*$/u.test(text)) return true;
  if (text === '\u6389\u5c0f\u73cd\u73e0\u4e86\uff0c\u545c\u545c') return true;
  if (/百度网盘分享的文件|通过百度网盘分享|超级会员v?\d+/i.test(text)) return true;
  return false;
}

function isAsciiSuffixFragmentOf(fragment, term) {
  return /^[A-Za-z]{4,}$/.test(fragment) && /^[A-Za-z]{6,}$/.test(term) && term.length >= fragment.length + 3 && term.toLowerCase().endsWith(fragment.toLowerCase());
}

function pruneSuffixOnlyFragments(entries = []) {
  return entries.filter((entry) => {
    const term = cleanTerm(entry?.term);
    if (!/^[A-Za-z]{4,}$/.test(term)) return true;
    return !entries.some((candidate) => {
      const candidateTerm = cleanTerm(candidate?.term);
      return (
        candidate !== entry &&
        candidate.family === entry.family &&
        isAsciiSuffixFragmentOf(term, candidateTerm) &&
        String(candidate.meaning || '').trim() === String(entry.meaning || '').trim() &&
        ((candidate.evidenceSamples || []).length === 0 ||
          (entry.evidenceSamples || []).length === 0 ||
          (candidate.evidenceSamples || []).some((sample) => (entry.evidenceSamples || []).includes(sample)))
      );
    });
  });
}

function normalizeFamily(family) {
  const raw = String(family || '').trim();
  return SUPPORTED_FAMILIES.includes(raw) ? raw : FAMILY_ALIASES[raw] || 'attack';
}

function isVideoContextSample(sample) {
  return /^(?:Bilibili video context|Bilibili public video title):/u.test(String(sample || '').trim());
}

function evidenceSampleSortKey(sample) {
  return isVideoContextSample(sample) ? 1 : 0;
}

function isVideoContextSource(source = {}) {
  const sourceText = String(source?.source || '').trim();
  return isVideoContextSample(source?.sample) || sourceText.includes('search-discovered video context');
}

function hasVideoContextOnlyEvidence(evidenceSamples = [], evidenceSources = []) {
  const samples = unique([
    ...evidenceSamples.map((sample) => String(sample || '').trim()),
    ...evidenceSources.map((source) => String(source?.sample || '').trim()),
  ]).filter(Boolean);
  return samples.length > 0 && samples.every(isVideoContextSample);
}

function isTitleSplicedVideoContextOnlyTerm(term, evidenceSamples = [], evidenceSources = []) {
  const clean = cleanTerm(term);
  if (!hasVideoContextOnlyEvidence(evidenceSamples, evidenceSources)) return false;
  if (clean === '\u5361\u8116\u5b50') return false;
  return /^\u5361\p{Script=Han}{2,8}\u8116\u5b50$/u.test(clean);
}

function isAskBaiduSongVideoContextOnlyTerm(term, evidenceSamples = [], evidenceSources = []) {
  const clean = cleanTerm(term);
  const askBaiduTerms = new Set(['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528']);
  if (!askBaiduTerms.has(clean)) return false;
  if (!hasVideoContextOnlyEvidence(evidenceSamples, evidenceSources)) return false;
  const samples = unique([
    ...evidenceSamples.map((sample) => String(sample || '').trim()),
    ...evidenceSources.map((source) => String(source?.sample || '').trim()),
  ]).filter(Boolean);
  return samples.every((sample) => {
    const text = sample.replace(/^Bilibili video context:\s*/u, '');
    return /\u300a\u95ee\u767e\u5ea6\u300b/u.test(text) && /(?:\u6b4c\u66f2|\u6f14\u5531|\u539f\u5531|\u7ffb\u5531|\u6b4c\u8bcd|MV|\u9648\u745e|\u8bf7\u6b23\u8d4f)/iu.test(text);
  });
}

function isMisleadingCarArmyVideoContextOnlyTerm(term, evidenceSamples = [], evidenceSources = []) {
  const clean = cleanTerm(term);
  const carArmyTerms = new Set(['\u8f66\u5bb6\u519b', '\u6ca1\u6709\u8f66\u5bb6\u519b']);
  if (!carArmyTerms.has(clean)) return false;
  if (!hasVideoContextOnlyEvidence(evidenceSamples, evidenceSources)) return false;
  const samples = unique([
    ...evidenceSamples.map((sample) => String(sample || '').trim()),
    ...evidenceSources.map((source) => String(source?.sample || '').trim()),
  ]).filter(Boolean);
  const acceptableSamples = samples.filter((sample) => {
    const text = sample.replace(/^Bilibili video context:\s*/u, '');
    if (/\u822a\u5929\u8f66\u5bb6\u519b/u.test(text)) return false;
    if (clean === '\u6ca1\u6709\u8f66\u5bb6\u519b' && !/(?:\u6ca1\u6709\u8f66\u5bb6\u519b|\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b|\u4e0d\u662f\u8f66\u5bb6\u519b)/u.test(text)) return false;
    if (clean === '\u8f66\u5bb6\u519b' && !/\u8f66\u5bb6\u519b/u.test(text)) return false;
    return /(?:\u5c0f\u7c73|\u96f7\u519b|SU7|\u7c73\u7c89|\u5c0f\u7c73\u6c7d\u8f66|\u65b0\u80fd\u6e90\u8f66|\u8f66\u5708|\u8f66\u7c89|\u63a7\u8bc4|\u6c34\u519b)/iu.test(text);
  });
  return acceptableSamples.length === 0;
}

function evidenceSourceSortKey(source = {}) {
  return isVideoContextSource(source) ? 1 : 0;
}

function evidenceUnitCount(evidenceSamples = [], evidenceSources = []) {
  const units = new Set();
  for (const sample of evidenceSamples || []) {
    const clean = String(sample || '').trim();
    if (clean) units.add(`sample:${clean}`);
  }
  for (const source of evidenceSources || []) {
    const sample = String(source?.sample || '').trim();
    if (sample) {
      units.add(`sample:${sample}`);
      continue;
    }
    const sourceText = String(source?.source || '').trim();
    const uid = String(source?.uid || '').trim();
    if (sourceText || uid) units.add(`source:${sourceText}\n${uid}`);
  }
  return units.size;
}

function mergeKeywordEntry(existing, incoming, now) {
  if (!existing) return { ...incoming, updatedAt: incoming.updatedAt || now };

  const existingConfidence = Number(existing.confidence) || 0;
  const incomingConfidence = Number(incoming.confidence) || 0;
  const shouldReplaceFamily = existing.family !== incoming.family && incomingConfidence >= existingConfidence + 0.15;
  const shouldReplaceDetails = shouldReplaceFamily || existing.family === incoming.family || !existing.meaning;
  const base = shouldReplaceFamily ? incoming : existing;
  const details = shouldReplaceDetails ? incoming : {};
  const targetFamily = shouldReplaceFamily ? incoming.family : existing.family;
  const mergedEvidenceSamples = unique([...(existing.evidenceSamples || []), ...(incoming.evidenceSamples || [])]);
  const evidenceSamples = mergedEvidenceSamples
    .filter((sample) => !isAmbiguousBenignEvidenceSample(incoming.term, targetFamily, sample))
    .sort((a, b) => evidenceSampleSortKey(a) - evidenceSampleSortKey(b))
    .slice(0, 5);
  const mergedEvidenceSources = uniqueBy(
    [...(existing.evidenceSources || []), ...(incoming.evidenceSources || [])].sort(
      (a, b) => evidenceSourceSortKey(a) - evidenceSourceSortKey(b),
    ),
    (item) => `${item.source || ''}\n${item.uid || ''}\n${item.sample || ''}`,
  );
  const evidenceSources = uniqueBy(
    [...(existing.evidenceSources || []), ...(incoming.evidenceSources || [])].sort(
      (a, b) => evidenceSourceSortKey(a) - evidenceSourceSortKey(b),
    ),
    (item) => `${item.source || ''}\n${item.uid || ''}\n${item.sample || ''}`,
  )
    .filter((source) => !isAmbiguousBenignEvidenceSample(incoming.term, targetFamily, source.sample))
    .slice(0, 8);
  const existingEvidenceCount = Math.max(0, Number(existing.evidenceCount) || 0);
  const incomingEvidenceCount = Math.max(0, Number(incoming.evidenceCount) || 0);
  const ambiguousEvidenceWasFiltered = evidenceSamples.length < Math.min(mergedEvidenceSamples.length, 5) || evidenceSources.length < Math.min(mergedEvidenceSources.length, 8);
  const sampleBackedEvidenceCount = evidenceUnitCount(evidenceSamples, evidenceSources);

  return {
    ...base,
    ...details,
    term: incoming.term,
    family: shouldReplaceFamily ? incoming.family : existing.family,
    meaning: details.meaning || existing.meaning || incoming.meaning,
    risk: details.risk || existing.risk || incoming.risk,
    confidence: Math.max(existingConfidence, incomingConfidence),
    evidenceCount:
      sampleBackedEvidenceCount > 0
        ? sampleBackedEvidenceCount
        : ambiguousEvidenceWasFiltered
          ? Math.max(evidenceSamples.length, evidenceSources.length)
          : existingEvidenceCount + incomingEvidenceCount,
    evidenceSamples,
    evidenceSources,
    updatedAt: now,
  };
}

function aliasEvidenceEntriesForEntry(entryMap, entry) {
  const aliases = evidenceAliasesForTerm(entry?.term);
  return aliases
    .map((alias) => entryMap.get(cleanTerm(alias)))
    .filter((aliasEntry) => aliasEntry && Number(aliasEntry.evidenceCount || 0) > 0)
    .map((aliasEntry) => ({
      ...entry,
      evidenceCount: Math.max(0, Number(aliasEntry.evidenceCount) || 0),
      evidenceSamples: aliasEntry.evidenceSamples || [],
      evidenceSources: aliasEntry.evidenceSources || [],
    }));
}

function evidenceAliasesForTerm(term) {
  const rawTerm = String(term || '').trim();
  const cleanedTerm = cleanTerm(rawTerm).toLowerCase();
  return unique([
    ...(TERM_EVIDENCE_ALIASES[rawTerm] || []),
    ...(TERM_EVIDENCE_ALIASES[cleanedTerm] || []),
  ]);
}

function caseFoldEvidenceEntriesForEntry(entryMap, entry) {
  const term = cleanTerm(entry?.term);
  if (!/^[A-Za-z0-9]+$/.test(term)) return [];
  const foldedTerm = term.toLowerCase();
  return [...entryMap.values()]
    .filter((candidate) => {
      const candidateTerm = cleanTerm(candidate?.term);
      return (
        candidateTerm !== term &&
        candidate.family === entry.family &&
        /^[A-Za-z0-9]+$/.test(candidateTerm) &&
        candidateTerm.toLowerCase() === foldedTerm &&
        Number(candidate.evidenceCount || 0) > 0
      );
    })
    .map((candidate) => ({
      ...entry,
      evidenceCount: Math.max(0, Number(candidate.evidenceCount) || 0),
      evidenceSamples: candidate.evidenceSamples || [],
      evidenceSources: candidate.evidenceSources || [],
    }));
}

function containedPhraseEvidenceEntriesForEntry(entryMap, entry) {
  const term = cleanTerm(entry?.term);
  const meaning = String(entry?.meaning || '').trim();
  if (term.length < 2 || !/\p{Script=Han}/u.test(term)) return [];
  const evidenceSamples = entry.evidenceSamples || [];
  return [...entryMap.values()]
    .filter((candidate) => {
      const candidateTerm = cleanTerm(candidate?.term);
      const sameMeaning = meaning && String(candidate.meaning || '').trim() === meaning;
      const sharedEvidenceSample = (candidate.evidenceSamples || []).some((sample) => evidenceSamples.includes(sample));
      return (
        candidate !== entry &&
        candidate.family === entry.family &&
        (sameMeaning || sharedEvidenceSample) &&
        /\p{Script=Han}/u.test(candidateTerm) &&
        candidateTerm !== term &&
        (candidateTerm.includes(term) || term.includes(candidateTerm)) &&
        Number(candidate.evidenceCount || 0) > 0
      );
    })
    .map((candidate) => ({
      ...entry,
      evidenceCount: Math.max(0, Number(candidate.evidenceCount) || 0),
      evidenceSamples: candidate.evidenceSamples || [],
      evidenceSources: candidate.evidenceSources || [],
    }));
}

function propagateAliasEvidence(entryMap, now) {
  for (const entry of [...entryMap.values()]) {
    for (const aliasEvidenceEntry of [
      ...aliasEvidenceEntriesForEntry(entryMap, entry),
      ...caseFoldEvidenceEntriesForEntry(entryMap, entry),
      ...containedPhraseEvidenceEntriesForEntry(entryMap, entry),
    ]) {
      entryMap.set(entry.term, mergeKeywordEntry(entryMap.get(entry.term), aliasEvidenceEntry, now));
    }
  }
}

function normalizeEvidenceSources(rawSources = []) {
  if (!Array.isArray(rawSources)) return [];
  return uniqueBy(
    rawSources
      .map((item) => ({
        source: String(item?.source || '').trim(),
        uid: String(item?.uid || '').trim(),
        sample: String(item?.sample || '').trim(),
      }))
      .filter((item) => item.source || item.uid || item.sample),
    (item) => `${item.source}\n${item.uid}\n${item.sample}`,
  ).slice(0, 8);
}

function normalizeAnalysisQuoteText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, '');
}

function splitAnalysisSourceSentences(text) {
  return unique(
    String(text || '')
      .split(/[\r\n]+/)
      .flatMap((line) => String(line || '').split(/(?<=[\u3002\uff01\uff1f!?;；])/u))
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function textUnits(text) {
  const normalized = normalizeAnalysisQuoteText(text);
  if (normalized.length <= 1) return new Set(normalized ? [normalized] : []);
  const units = new Set();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    units.add(normalized.slice(index, index + 2));
  }
  return units;
}

function textOverlapScore(a, b) {
  const left = textUnits(a);
  const right = textUnits(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const unit of left) {
    if (right.has(unit)) shared += 1;
  }
  return shared / Math.min(left.size, right.size);
}

function groundSentenceQuote(quote, sourceSentences = []) {
  const rawQuote = String(quote || '').trim();
  const normalizedQuote = normalizeAnalysisQuoteText(rawQuote);
  if (!normalizedQuote) return '';
  const exact = sourceSentences.find((sentence) => sentence.includes(rawQuote));
  if (exact) return exact;
  const normalizedExact = sourceSentences.find((sentence) => normalizeAnalysisQuoteText(sentence).includes(normalizedQuote));
  if (normalizedExact) return normalizedExact;
  const best = sourceSentences
    .map((sentence) => ({ sentence, score: textOverlapScore(rawQuote, sentence) }))
    .sort((a, b) => b.score - a.score)[0];
  return best?.score >= 0.45 ? best.sentence : '';
}

function authHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  };
}

export function extractJsonObject(raw) {
  const text = String(raw || '').trim();
  if (!text) return {};
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced?.[1] || text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(jsonText);
}

function isRecoveredPlaceholderMeaning(meaning) {
  return /Recovered term metadata after an interrupted local dictionary write/i.test(String(meaning || ''));
}

function recoveredMeaningForTerm(term, family) {
  const cleanTerm = String(term || '').trim();
  const familyMeanings = {
    attack: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u5632\u8bbd\u3001\u8d2c\u4f4e\u6216\u5bf9\u67d0\u4eba\u3001\u7fa4\u4f53\u3001\u52a8\u673a\u3001\u8bf4\u6cd5\u4f5c\u654c\u610f\u8bc4\u4ef7`,
    absolutes: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u7f3a\u5c11\u9650\u5b9a\u7684\u5f3a\u65ad\u8a00\u3001\u5168\u79f0\u5316\u6216\u7edd\u5bf9\u5316\u8868\u8fbe`,
    evidence: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u8bf7\u6c42\u3001\u8865\u5145\u6216\u6307\u5411\u53ef\u6838\u9a8c\u7684\u6765\u6e90\u3001\u8bc1\u636e\u6216\u539f\u59cb\u6750\u6599`,
    evasion: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u6697\u793a\u3001\u8f6c\u79fb\u89e3\u91ca\u8d23\u4efb\u6216\u4ee5\u5708\u5185\u9ed8\u5951\u4ee3\u66ff\u76f4\u63a5\u8bf4\u660e`,
    cooperation: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u8868\u793a\u652f\u6301\u3001\u8865\u5145\u3001\u8f7b\u677e\u4e92\u52a8\u6216\u5408\u4f5c\u5f0f\u8ba8\u8bba`,
    correction: `\u201c${cleanTerm}\u201d\u7528\u4e8e\u627f\u8ba4\u4fe1\u606f\u4e0d\u51c6\u3001\u4fee\u6b63\u8bf4\u6cd5\u6216\u964d\u4f4e\u539f\u5148\u7ed3\u8bba\u5f3a\u5ea6`,
  };
  return familyMeanings[family] || `\u201c${cleanTerm}\u201d\u7684\u4e2d\u6587\u4e92\u8054\u7f51\u8bed\u7528\u4e49\uff0c\u9700\u7ed3\u5408\u5b8c\u6574\u53d1\u8a00\u4e0a\u4e0b\u6587\u5224\u65ad`;
}

export function normalizeKeywordEntries(rawEntries = []) {
  const entries = [];
  for (const item of rawEntries) {
    const family = normalizeFamily(item.family);
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const cleanedTerms = unique([item.term, ...variants].map(cleanKeywordTerm)).filter((term) => term.length >= 2 && term.length <= 12);
    const terms = cleanedTerms.filter((term) => !cleanedTerms.some((candidate) => candidate !== term && isAsciiSuffixFragmentOf(term, candidate)));
    const rawMeaning = String(item.meaning || item.reason || '').trim();
    const meaning = isRecoveredPlaceholderMeaning(rawMeaning) ? recoveredMeaningForTerm(terms[0] || item.term, family) : rawMeaning;
    if (!meaning || /中文含义|语用功能|^含义$|^解释$/.test(meaning)) continue;
    const rawEvidenceSamples = Array.isArray(item.evidenceSamples)
      ? unique(item.evidenceSamples.map((sample) => String(sample || '').trim()).filter(Boolean))
      : [];
    const evidenceSamples = rawEvidenceSamples.filter((sample) => !isNoisyEvidenceSample(sample)).slice(0, 5);
    const evidenceSources = normalizeEvidenceSources(item.evidenceSources).filter((source) => !isNoisyEvidenceSample(source.sample));
    const rawEvidenceCount = Math.max(0, Number(item.evidenceCount) || 0);
    if (rawEvidenceCount > 0 && rawEvidenceSamples.length > 0 && evidenceSamples.length === 0) continue;
    for (const term of terms) {
      if (isNoisyTerm(term)) continue;
      const termEvidenceSamples = evidenceSamples.filter((sample) => !isAmbiguousBenignEvidenceSample(term, family, sample));
      const termEvidenceSources = evidenceSources.filter((source) => !isAmbiguousBenignEvidenceSample(term, family, source.sample));
      if (isTitleSplicedVideoContextOnlyTerm(term, termEvidenceSamples, termEvidenceSources)) continue;
      if (isAskBaiduSongVideoContextOnlyTerm(term, termEvidenceSamples, termEvidenceSources)) continue;
      if (isMisleadingCarArmyVideoContextOnlyTerm(term, termEvidenceSamples, termEvidenceSources)) continue;
      const sampleBackedEvidenceCount = evidenceUnitCount(termEvidenceSamples, termEvidenceSources);
      const evidenceCount =
        sampleBackedEvidenceCount > 0
          ? Math.min(rawEvidenceCount || sampleBackedEvidenceCount, sampleBackedEvidenceCount)
          : rawEvidenceCount > 0 && (termEvidenceSamples.length !== evidenceSamples.length || termEvidenceSources.length !== evidenceSources.length)
          ? Math.max(termEvidenceSamples.length, termEvidenceSources.length)
          : rawEvidenceCount;
      entries.push({
        term,
        family,
        meaning,
        risk: String(item.risk || '').trim() || (family === 'cooperation' || family === 'correction' ? 'positive' : 'medium'),
        confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.68,
        evidenceCount,
        evidenceSamples: termEvidenceSamples,
        evidenceSources: termEvidenceSources,
      });
    }
  }
  const now = new Date().toISOString();
  const entryMap = new Map();
  for (const entry of entries) {
    entryMap.set(entry.term, mergeKeywordEntry(entryMap.get(entry.term), entry, now));
  }
  return pruneSuffixOnlyFragments([...entryMap.values()]).map(({ updatedAt, ...entry }) => entry);
}

function cleanEvidenceText(text) {
  return cleanTerm(text).toLowerCase();
}

function generatedEvidenceAliasesForTerm(term) {
  const raw = String(term || '').trim();
  const clean = cleanTerm(term);
  const aliases = [];
  if (raw === '0\u63d0\u5347') aliases.push('\u96f6\u63d0\u5347', '\u6ca1\u6709\u63d0\u5347', '\u4e00\u70b9\u63d0\u5347\u6ca1\u6709', '\u6beb\u65e0\u63d0\u5347');
  const percentMatch = clean.match(/^(100|100%|\u767e\u5206\u767e|\u767e\u5206\u4e4b\u767e)(.+)$/);
  if (percentMatch) {
    const tail = percentMatch[2];
    aliases.push(`100${tail}`, `100%${tail}`, `\u767e\u5206\u767e${tail}`, `\u767e\u5206\u4e4b\u767e${tail}`);
    if (tail.endsWith('\u7387')) aliases.push(`100${tail.slice(0, -1)}`, `100%${tail.slice(0, -1)}`, `\u767e\u5206\u767e${tail.slice(0, -1)}`);
    else aliases.push(`100${tail}\u7387`, `100%${tail}\u7387`, `\u767e\u5206\u767e${tail}\u7387`);
  }
  if (/^\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211\u7684?$/.test(clean)) {
    aliases.push('\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u9996\u4e2a\u6295\u5e01', '\u6211\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u6295\u5e01\u80af\u5b9a\u662f\u6211');
  }
  aliases.push(...generatedUniversalQuantifierAliases(clean));
  if (/^(\u6839\u672c\u6ca1\u6709|\u7edd\u5bf9|\u80af\u5b9a|\u5168\u662f|\u5168\u90fd|\u5168\u90fd\u662f|\u6beb\u65e0|\u6ca1\u6709\u4e00\u4e2a|\u6ca1\u540a|\u6ca1\u5185\u5473)/.test(clean)) {
    aliases.push(...generatedChineseTailAliases(clean));
  }
  if (clean.startsWith('\u6beb\u65e0')) {
    const tail = clean.slice(2);
    aliases.push(`\u6ca1${tail}`, `\u6ca1\u6709${tail}`);
  }
  if (clean.startsWith('\u6ca1\u540a\u7528')) aliases.push('\u6beb\u65e0\u540a\u7528');
  if (clean.startsWith('\u7f57\u795e\u4f1f\u5927')) aliases.push('\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00', '\u7f57\u795e\u4f1f\u5927\uff0c\u65e0\u9700\u591a\u8a00');
  if (isChineseColloquialAliasCandidate(clean)) aliases.push(...generatedColloquialPhraseAliases(clean));
  aliases.push(...generatedFixedCommentSuffixAliases(clean));
  return unique(aliases.filter((alias) => alias && alias !== clean));
}

function isChineseColloquialAliasCandidate(clean) {
  return /^[\u4e00-\u9fa5]+$/.test(clean) && clean.length >= 4;
}

function generatedChineseTailAliases(clean) {
  const aliases = [];
  const shortTails = ['\u5440', '\u554a', '\u5427', '\u5462', '\u561b'];
  for (const suffix of shortTails) {
    if (clean.endsWith(suffix) && clean.length > suffix.length + 2) aliases.push(clean.slice(0, -suffix.length));
    else aliases.push(`${clean}${suffix}`);
  }
  if (clean.endsWith('\u7684') && clean.length > 3) aliases.push(clean.slice(0, -1));
  if (clean.endsWith('\u4e86') && clean.length > 3) aliases.push(clean.slice(0, -1));
  if (clean.endsWith('\u4e00\u4e0b') && clean.length > 4) aliases.push(clean.slice(0, -2));
  else if (clean.startsWith('\u7edd\u5bf9\u53ef\u4ee5')) aliases.push(`${clean}\u4e00\u4e0b`);
  return aliases;
}

function generatedUniversalQuantifierAliases(clean) {
  const aliases = [];
  if (clean.startsWith('\u5168\u662f') && clean.length > 2) {
    const tail = clean.slice(2);
    aliases.push(`\u5168\u90fd\u662f${tail}`, `\u5168\u90fd${tail}`, `\u5168\u90e8\u662f${tail}`);
  }
  if (clean.startsWith('\u5168\u90fd\u662f') && clean.length > 3) {
    const tail = clean.slice(3);
    aliases.push(`\u5168\u662f${tail}`, `\u5168\u90fd${tail}`, `\u5168\u90e8\u662f${tail}`);
  }
  if (clean.startsWith('\u5168\u90fd') && !clean.startsWith('\u5168\u90fd\u662f') && clean.length > 2) {
    const tail = clean.slice(2);
    aliases.push(`\u5168\u662f${tail}`, `\u5168\u90fd\u662f${tail}`, `\u5168\u90e8\u662f${tail}`);
  }
  const allIsMatch = clean.match(/^\u6240\u6709(.+)\u5168\u662f(.+)$/);
  if (allIsMatch) aliases.push(`\u6240\u6709${allIsMatch[1]}\u5168\u90fd\u662f${allIsMatch[2]}`, `\u5168\u662f${allIsMatch[2]}`, `\u5168\u90fd\u662f${allIsMatch[2]}`);
  if (clean.startsWith('\u5168\u5458') && clean.length > 2) {
    const tail = clean.slice(2);
    aliases.push(`\u6240\u6709\u4eba\u90fd${tail}`, `\u5168\u4f53${tail}`);
  }
  return aliases;
}

function generatedColloquialPhraseAliases(clean) {
  const aliases = [];
  if (clean.length >= 4) {
    for (const suffix of ['\u554a', '\u5427', '\u5462', '\u561b', '\u5457']) {
      if (clean.endsWith(suffix)) aliases.push(clean.slice(0, -suffix.length));
      else aliases.push(`${clean}${suffix}`);
    }
    if (clean.endsWith('\u4e86') && clean.length > 4) aliases.push(clean.slice(0, -1));
    else aliases.push(`${clean}\u4e86`);
  }
  if (clean.startsWith('\u9f3b\u5c4e')) aliases.push(`\u628a${clean}`);
  if (clean.startsWith('\u5403\u4e86')) aliases.push(`\u903c\u6211${clean}`, `\u8ba9\u6211${clean}`);
  if (clean === '\u5403\u76f8\u592a\u96be\u770b') aliases.push('\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86', '\u5403\u76f8\u96be\u770b');
  if (clean === '\u6401\u8fd9\u5462') aliases.push('\u6401\u8fd9\u6401\u8fd9\u5462', '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462');
  if (clean === '\u9ad8\u5b8c\u4e86') aliases.push('\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86');
  return aliases;
}

function generatedFixedCommentSuffixAliases(clean) {
  const pairs = [
    ['\u72d7\u5c41\u4e0d\u901a', '\u72d7\u5c41\u4e0d\u901a\u7684'],
    ['\u5173\u4e86\u5427', '\u5173\u4e86\u5427\u6ca1\u610f\u601d'],
    ['\u597d\u81ea\u4e3a\u4e4b', '\u597d\u81ea\u4e3a\u4e4b\u5427'],
    ['\u5f88\u61c2\u561b', '\u5f88\u61c2\u561b\u8001\u94c1'],
    ['\u8fd8\u6562\u53d1\u89c6\u9891', '\u8fd8\u6562\u53d1\u89c6\u9891\u5462'],
    ['\u7b11\u5760\u673a', '\u7b11\u5760\u673a\u4e86'],
    ['\u6401\u8fd9\u5462', '\u6401\u8fd9\u6401\u8fd9\u5462'],
    ['\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9', '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba'],
    ['\u7cbe\u795e\u7537', '\u7cbe\u795e\u7537\u4eba'],
    ['\u6485\u9192', '\u6485\u9192\u4eba'],
    ['\u6485\u9192', '\u6485\u9192\u8005'],
    ['\u79d1\u6280\u4e0e\u72e0\u6d3b', '\u79d1\u6280\u4e0e\u72e0\u6d3b\u554a'],
    ['\u523b\u8fdbdna', '\u523b\u8fdbdna\u7684'],
    ['\u4eae\u8840\u6761', '\u4eae\u8840\u6761\u4e86'],
    ['\u8001\u62a0', '\u8001\u62a0\u6bd4'],
  ];
  for (const [short, long] of pairs) {
    if (clean === short) return [long];
    if (clean === long) return [short];
  }
  return [];
}

function evidenceNeedlesForTerm(term) {
  return unique([
    term,
    ...evidenceAliasesForTerm(term),
    ...generatedEvidenceAliasesForTerm(term),
  ].map(cleanEvidenceText)).filter(Boolean);
}

function countOccurrences(haystack, needle) {
  if (!haystack || !needle) return 0;
  let count = 0;
  let index = 0;
  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }
  return count;
}

function countNonOverlappingNeedleOccurrences(haystack, needles = []) {
  let remaining = String(haystack || '');
  let count = 0;
  for (const needle of [...needles].sort((a, b) => b.length - a.length)) {
    let index = 0;
    while (index <= remaining.length) {
      const found = remaining.indexOf(needle, index);
      if (found === -1) break;
      count += 1;
      remaining = `${remaining.slice(0, found)}${' '.repeat(needle.length)}${remaining.slice(found + needle.length)}`;
      index = found + needle.length;
    }
  }
  return count;
}

function isShortNegatedAttackMention(term, sample) {
  const cleanSample = cleanEvidenceText(sample);
  if (!cleanSample || cleanSample.length > Math.max(cleanKeywordTerm(term).length + 4, 12)) return false;
  if (/^(?:\u6ca1|\u6ca1\u6709|\u65e0|\u4e0d\u662f)/u.test(cleanKeywordTerm(term))) return false;
  const softTails = /^(?:\u554a|\u5440|\u5427|\u5462|\u54e6|\u54c8|\u4e86|\u5417|\u554a\u554a|\u54c8\u54c8)?$/u;
  return evidenceNeedlesForTerm(term).some((needle) => {
    if (!needle || needle.length < 2) return false;
    return ['\u6ca1\u6709', '\u6ca1', '\u65e0', '\u4e0d\u662f'].some((prefix) => {
      if (!cleanSample.startsWith(`${prefix}${needle}`)) return false;
      return softTails.test(cleanSample.slice(prefix.length + needle.length));
    });
  });
}

function isAmbiguousBenignEvidenceSample(term, family, sample) {
  const cleanSample = cleanEvidenceText(sample);
  const rawContextSample = String(sample || '');
  const contextSample = `${cleanSample}\n${rawContextSample}`;
  if (family === 'attack') {
    if (isShortNegatedAttackMention(term, sample)) return true;
    const glossaryQuestionContext = /(?:\u4e0d\u61c2\u5c31\u95ee|\u90fd(?:\u662f)?\u4ec0\u4e48(?:\u610f\u601d|\u6897)|\u662f\u4ec0\u4e48\u610f\u601d|\u662f\u4ec0\u4e48\u6897|\u4ece\u6765\u4e0d\u770b)/u.test(contextSample)
      && /[\u3001\uff0c,].*[\u3001\uff0c,]/u.test(contextSample);
    const hostileExplanationContext = /(?:\u9ed1\u79f0|\u9a82\u4eba|\u653b\u51fb|\u522b\u62ff|\u522b\u590d\u8bfb|\u522b\u4e71\u7528)/u.test(contextSample);
    if (glossaryQuestionContext && !hostileExplanationContext) return true;
  }
  if (term === '\u5e76\u975e\u5076\u9047' && family === 'attack') {
    const bareLabelContext = cleanSample === '\u5e76\u975e\u5076\u9047' || /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\[\]\w_-]*\u5e76\u975e\u5076\u9047[\s\p{Emoji_Presentation}\p{Extended_Pictographic}\[\]\w_-]*$/u.test(rawContextSample);
    const targetedCoincidenceContext = /(?:\u7ec8\u4e8e|\u771f\u6b63|\u4e00\u770b|\u8fd9|ta|TA|\u4ed6|\u5979|\u4f60|\u4e0d\u662f|\u7edd\u5bf9|\u523b\u610f).{0,18}\u5e76\u975e\u5076\u9047|\u5e76\u975e\u5076\u9047.{0,18}(?:\u4e86|\u5427|\u554a|\u5b9e\u9524|\u523b\u610f|\u5b89\u6392|\u771f\u6b63|\u5076\u9047)/iu.test(cleanSample);
    if (bareLabelContext && !targetedCoincidenceContext) return true;
  }
  if (term === '\u53c2\u8003\u6587\u732e' && family === 'attack') {
    const literalCitationContext = /(?:\u53c2\u8003\u6587\u732e).{0,24}(?:\u4e66\u5199|\u683c\u5f0f|\u987a\u5e8f\u7f16\u7801|\u5f15\u7528|\u7f16\u6392|\u8bba\u6587|\u56fd\u5bb6\u6807\u51c6|pdf|grok|\u6587\u732e|sci|\u67e5\u627e|\u641c|\u627e|\u5e93|\u771f\u7684)|(?:\u4e66\u5199|\u683c\u5f0f|\u987a\u5e8f\u7f16\u7801|\u5f15\u7528|\u7f16\u6392|\u8bba\u6587|\u56fd\u5bb6\u6807\u51c6|pdf|grok|\u6587\u732e|sci|\u67e5\u627e|\u641c|\u627e|\u5e93|\u771f\u7684).{0,24}\u53c2\u8003\u6587\u732e/iu.test(cleanSample);
    const plagiarismJokeContext = /(?:\u6284|\u642c|\u6d17\u7a3f|\u81f4\u656c|\u539f\u4f5c|\u6765\u6e90|\u51fa\u5904|\u539f\u6587).{0,18}\u53c2\u8003\u6587\u732e|\u53c2\u8003\u6587\u732e.{0,18}(?:\u6284|\u642c|\u6d17\u7a3f|\u81f4\u656c|\u539f\u4f5c|\u6765\u6e90|\u51fa\u5904|\u539f\u6587|\u90fd?\u4e0d\u653e|\u6ca1\u653e|\u4e0d\u5217|\u4e0d\u7ed9)/u.test(cleanSample);
    if ((cleanSample === '\u53c2\u8003\u6587\u732e' || literalCitationContext) && !plagiarismJokeContext) return true;
  }
  if (term === '\u5e03\u4ec0\u6208\u95e8' && family === 'attack') {
    const literalTheoryContext = /(?:bush-gorman|\u5e03\u4ec0[-\u2010-\u2015]?\u6208\u95e8).{0,32}(?:theory|function|curse|\u7406\u8bba|\u51fd\u6570|\u6570\u5b66\u5bb6|\u975e\u7ebf\u6027|\u7ebf\u6027\u95ee\u9898)|(?:theory|function|curse|\u7406\u8bba|\u51fd\u6570|\u6570\u5b66\u5bb6|\u975e\u7ebf\u6027|\u7ebf\u6027\u95ee\u9898).{0,32}(?:bush-gorman|\u5e03\u4ec0[-\u2010-\u2015]?\u6208\u95e8)/iu.test(cleanSample);
    const colloquialHomophoneContext = /(?:\u4e0d\u662f\u54e5\u4eec|\u54e5\u4eec|\u554a|\u4e0d\u662f|\u79bb\u8c31|\u4ec0\u4e48).{0,18}\u5e03\u4ec0\u6208\u95e8|\u5e03\u4ec0\u6208\u95e8.{0,18}(?:\u554a|\u54e5\u4eec|\u4e0d\u662f|\u79bb\u8c31|\u4ec0\u4e48)/u.test(cleanSample);
    if ((cleanSample === '\u5e03\u4ec0\u6208\u95e8' || literalTheoryContext) && !colloquialHomophoneContext) return true;
  }
  if (term === '\u732a\u9f3b' && family === 'attack') {
    const literalAnimalContext = /(?:\u732a\u9f3b(?:\u9f9f|\u86c7)|(?:\u517b|\u80b2|\u722c\u5ba0|\u6c34\u65cf|\u7f38|\u9972\u6599|\u96be\u517b|\u4e3a\u4ec0\u4e48\u96be\u517b).{0,18}\u732a\u9f3b|\u732a\u9f3b.{0,18}(?:\u9f9f|\u86c7|\u722c\u5ba0|\u6c34\u65cf|\u7f38|\u9972\u6599|\u96be\u517b|\u80b2\u5f52))/u.test(cleanSample);
    const hostilePigNoseContext = /(?:\u4f60|\u4ed6|\u5979|\u8fd9\u4eba|\u7c89\u4e1d|\u64cd\u4f5c|\u53d1\u8a00|\u73a9\u6cd5|\u8b66|\u961f\u53cb).{0,18}\u732a\u9f3b|\u732a\u9f3b.{0,18}(?:\u64cd\u4f5c|\u53d1\u8a00|\u73a9\u6cd5|\u771f\u6076\u5fc3|\u592a\u8822|\u50cf\u4e2a|\u8b66|\u961f\u53cb|\u7c89\u4e1d)/u.test(cleanSample);
    if (literalAnimalContext && !hostilePigNoseContext) return true;
  }
  if (term === '\u75c5\u5f2f\u94a9' && family === 'attack') {
    const properNameRosterContext = /(?:\u5929\u6deb\u661f\s*)?\u75c5\u5f2f\u94a9\s*[\u4e00-\u9fff]{2,4}$|\u75c5\u5f2f\u94a9[\u4e00-\u9fff]{2,4}$/u.test(cleanSample);
    const hostileNicknameContext = /(?:\u9ed1\u79f0|\u9a82|\u4fae\u8fb1|\u8fd9\u4eba|\u4ed6|\u5979|\u4f60).{0,18}\u75c5\u5f2f\u94a9|\u75c5\u5f2f\u94a9.{0,18}(?:\u9ed1\u79f0|\u9a82|\u4fae\u8fb1|\u771f\u6076\u5fc3|\u4ec0\u4e48\u73a9\u610f)/u.test(cleanSample);
    if (properNameRosterContext && !hostileNicknameContext) return true;
  }
  if (term === '\u60e8\u6848' && family === 'attack') {
    const bareLabelContext = cleanSample === '\u60e8\u6848';
    const literalTragedyContext = /(?:\u516c\u76ca\u5e7f\u544a|\u4e00\u6839\u70df|\u5bbf\u820d|\u667a\u529b\u6709\u95ee\u9898|\u917f\u6210|\u4e8b\u6545|\u8f66\u7978|\u707e\u96be|\u547d\u6848|\u706b\u707e|\u5730\u9707|\u8db3\u575b|\u62dc\u4ec1|\u5fb7\u56fd|\u6bd4\u5206|\u60e8\u8d25|\u6253\u7834).{0,24}\u60e8\u6848|\u60e8\u6848.{0,24}(?:\u516c\u76ca\u5e7f\u544a|\u4e00\u6839\u70df|\u5bbf\u820d|\u667a\u529b\u6709\u95ee\u9898|\u917f\u6210|\u4e8b\u6545|\u8f66\u7978|\u707e\u96be|\u547d\u6848|\u706b\u707e|\u5730\u9707|\u8db3\u575b|\u62dc\u4ec1|\u5fb7\u56fd|\u6bd4\u5206|\u60e8\u8d25|\u6253\u7834)/u.test(cleanSample);
    const mockingBadOutcomeContext = /(?:\u64ad\u653e\u91cf|\u8bc4\u8bba\u533a|\u6570\u636e|\u70ed\u5ea6|\u6807\u9898\u515a|\u8fd9\u6ce2|\u8282\u76ee\u6548\u679c|\u770b\u7b11|\u7ffb\u8f66|\u62bd\u5361|\u6218\u7ee9|\u7968\u623f|\u9500\u91cf).{0,18}\u60e8\u6848|\u60e8\u6848(?:\u4e86|\u73b0\u573a|\u7ea7)|\u60e8\u6848.{0,18}(?:\u7b11|\u64ad\u653e\u91cf|\u6570\u636e|\u70ed\u5ea6|\u8bc4\u8bba\u533a|\u7ffb\u8f66)/u.test(cleanSample);
    if ((bareLabelContext || literalTragedyContext) && !mockingBadOutcomeContext) return true;
  }
  if (term === '\u5178\u4e2d\u5178' && family === 'attack') {
    const bareOrMetaClassicContext = cleanSample === '\u5178\u4e2d\u5178' || /(?:\u4f18\u79c0|\u5408\u8ba2\u672c|\u5408\u96c6|\u8865\u5168|\u7ea2\u697c\u68a6|\u89e3\u6897|\u4ec0\u4e48\u60c5\u51b5|\u89c6\u9891\u6807\u9898|\u7eb8\u624e\u798f|\u620f\u5b8c\u5e74).{0,24}\u5178\u4e2d\u5178|\u5178\u4e2d\u5178.{0,24}(?:\u5408\u8ba2\u672c|\u5408\u96c6|\u8865\u5168|\u89e3\u6897|\u4ec0\u4e48\u60c5\u51b5|\u4e4b|\u7eb8\u624e\u798f|\u90a3\u548b\u4e86)/u.test(cleanSample);
    const mockingPatternContext = /(?:\u8d77\u624b|\u8001\u5957\u8def|\u53c8\u6765|\u719f\u6089|\u7ecf\u5178|\u5faa\u73af|\u590d\u8bfb|\u9ed1|\u5c0f\u4e11|\u53c8\u662f).{0,18}\u5178\u4e2d\u5178|\u5178\u4e2d\u5178.{0,18}(?:\u8d77\u624b|\u8001\u5957\u8def|\u53c8\u6765|\u719f\u6089|\u5faa\u73af|\u590d\u8bfb|\u6253\u6c49\u5b57|\u5c0f\u4e11|\u9ed1)/u.test(cleanSample);
    if (bareOrMetaClassicContext && !mockingPatternContext) return true;
  }
  if (term === '\u4f20\u5bb6\u5b9d\u4e86' && family === 'absolutes') {
    const literalGameHeirloomContext = /(?:apex|Apex|\u91cd\u751f|\u73a9\u5bb6|\u901a\u4f20|\u4e13\u4f20|\u5200\u76ae|\u722a\u5200|\u68c0\u89c6|\u82f1\u96c4|\u8d5b\u5b63|\u67aa|\u989c\u8272|\u534a\u4ef7\u81ea\u9009|\u5708\u94b1|\u6d88\u8d39\u9677\u9631|\u76ae\u80a4|\u89d2\u8272|\u4f20\u5bb6\u5b9d.{0,16}(?:\u4ea7\u91cf|\u8bbe\u8ba1|\u5267\u60c5|\u52a8\u4f5c|\u68c0\u89c6|\u8d28\u611f|\u989c\u8272|\u81ea\u9009)|(?:\u4ea7\u91cf|\u8bbe\u8ba1|\u5267\u60c5|\u52a8\u4f5c|\u68c0\u89c6|\u8d28\u611f|\u989c\u8272|\u81ea\u9009).{0,16}\u4f20\u5bb6\u5b9d)/iu.test(cleanSample);
    const misreadOrProperNounContext = /(?:\u770b\u6210|\u770b\u9519|\u8ba4\u6210).{0,18}\u4f20\u5bb6\u5b9d|\u9ad8\u96c4\u4f20\u5bb6\u5b9d/u.test(cleanSample);
    const metaphorContext = /(?:\u5f53|\u7559\u7740|\u85cf\u7740|\u7956\u4f20|\u6c38\u4e45|\u5341\u5e74|\u4e00\u8f88\u5b50|\u4e0d\u6539|\u4e0d\u7528).{0,12}\u4f20\u5bb6\u5b9d\u4e86|\u4f20\u5bb6\u5b9d\u4e86.{0,12}(?:\u662f\u5427|\u4e0d\u6539|\u4e0d\u7528|\u7559\u7740)/u.test(cleanSample);
    if ((cleanSample === '\u4f20\u5bb6\u5b9d\u4e86' || literalGameHeirloomContext || misreadOrProperNounContext) && !metaphorContext) return true;
  }
  if (term === '\u4e3a\u53d1\u70e7\u800c\u751f' && family === 'cooperation') {
    const bareSloganContext = cleanSample === '\u4e3a\u53d1\u70e7\u800c\u751f';
    const usefulDesignContext = /\u4e3a\u53d1\u70e7\u800c\u751f.{0,24}(?:\u8bbe\u8ba1|\u601d\u8def|\u8bb2\u5f97|\u5206\u6790|\u4f18\u5316)|(?:\u8bbe\u8ba1|\u601d\u8def|\u8bb2\u5f97|\u5206\u6790|\u4f18\u5316).{0,24}\u4e3a\u53d1\u70e7\u800c\u751f/u.test(cleanSample);
    if (bareSloganContext && !usefulDesignContext) return true;
  }
  if (term === '\u5f73\u4e8e' && family === 'cooperation') {
    const titleOrCourseContext = /(?:\u300a|\u300c|\u201c)?\u5f73\u4e8e\u6cd5.{0,18}(?:\u6559\u5b66|\u6559\u7a0b|\u5df2\u7ecf\u88ab\u6dd8\u6c70|\u61c2\u7684\u5144\u5f1f)|(?:\u6559\u5b66|\u6559\u7a0b).{0,12}\u5f73\u4e8e\u6cd5/u.test(cleanSample);
    const approvalContext = /^(?:\u5f73\u4e8e|[\u5f73\u4e8e\s]+)$/u.test(cleanSample) || /\u5f73\u4e8e.{0,8}(?:\u5427|\u53ef\u4ee5|\u884c|\u90a3\u5c31)|(?:\u53ef\u4ee5|\u884c|\u90a3\u5c31).{0,8}\u5f73\u4e8e/u.test(cleanSample);
    if (titleOrCourseContext && !approvalContext) return true;
  }
  if (term === '\u6a21\u68f1\u4e24\u53ef' && family === 'evasion') {
    const relationshipAmbiguityContext = /(?:\u64c5\u957f\u7528)?\u6a21\u68f1\u4e24\u53ef.{0,16}(?:\u6001\u5ea6|\u56f0\u4f4f\u6211|\u559c\u6b22|\u611f\u60c5|\u7231)|(?:\u6001\u5ea6|\u56f0\u4f4f\u6211|\u559c\u6b22|\u611f\u60c5|\u7231).{0,16}\u6a21\u68f1\u4e24\u53ef/u.test(cleanSample);
    const discussionEvasionContext = /(?:\u56de\u7b54|\u56de\u590d|\u8bf4\u6cd5|\u8868\u6001|\u7acb\u573a|\u8bc1\u636e|\u89c2\u70b9|\u95ee\u9898|\u522b).{0,18}\u6a21\u68f1\u4e24\u53ef|\u6a21\u68f1\u4e24\u53ef.{0,18}(?:\u56de\u7b54|\u56de\u590d|\u8bf4\u6cd5|\u8868\u6001|\u7acb\u573a|\u8bc1\u636e|\u89c2\u70b9|\u95ee\u9898|\u542b\u7cca|\u56de\u907f|\u6253\u592a\u6781)/u.test(cleanSample);
    if (relationshipAmbiguityContext && !discussionEvasionContext) return true;
  }
  if (['\u5976\u51f6', '\u5976\u51f6\u5976\u51f6'].includes(term) && family === 'cooperation') {
    const resourceOrLiteralCuteContext = /(?:\u79c1\u62cd|\u6027\u7231|sm|\u8c03\u6559|mp4|\u8001\u5e08|\u4f5c\u54c1|\u627e\u4e0d\u5230|\u89c6\u9891|\u7535\u52a8\u8f66|\u5934\u76d4|\u505c\u8f66|\u6cd5\u5916\u72c2\u5f92|\u5c0f\u8c61|\u5927\u8c61|\u8f66\u5b50|\u5a01\u6151\u529b).{0,24}\u5976\u51f6|\u5976\u51f6.{0,24}(?:\u79c1\u62cd|\u6027\u7231|sm|\u8c03\u6559|mp4|\u8001\u5e08|\u4f5c\u54c1|\u627e\u4e0d\u5230|\u89c6\u9891|\u7535\u52a8\u8f66|\u5934\u76d4|\u505c\u8f66|\u6cd5\u5916\u72c2\u5f92|\u5c0f\u8c61|\u5927\u8c61|\u8f66\u5b50|\u5a01\u6151\u529b)/iu.test(cleanSample);
    const softDiscussionContext = /(?:\u56de\u590d|\u8bed\u6c14|\u8bc4\u8bba|\u8bf4\u8bdd|\u5f39\u5e55|\u4e92\u52a8|\u6c14\u6c1b|\u7f13\u548c).{0,18}\u5976\u51f6|\u5976\u51f6.{0,18}(?:\u56de\u590d|\u8bed\u6c14|\u8bc4\u8bba|\u8bf4\u8bdd|\u5f39\u5e55|\u4e92\u52a8|\u6c14\u6c1b|\u7f13\u548c)/u.test(cleanSample);
    if (resourceOrLiteralCuteContext && !softDiscussionContext) return true;
  }
  if (term === '\u634f\u5ac2' && family === 'cooperation') {
    const fandomDramaContext = /(?:\u7c89\u4e1d|\u9ed1\u5b50|\u62db\u9b42|\u4e0d\u662f\u7ed9|\u4e0d\u662f\u634f\u5ac2|\u6d17|\u5356\u8150|\u62cd\u6742\u5fd7|\u6240\u6709\u74dc|\u7d20\u6750\u4e00\u628a|\u6843\u665a\u5b89|\u6cd5\u7f57|\u9003\u8131\u5927\u5e08|\u7eb3\u897f\u59b2|\u539f\u795e).{0,28}\u634f\u5ac2|\u634f\u5ac2.{0,28}(?:\u7c89\u4e1d|\u9ed1\u5b50|\u62db\u9b42|\u4e0d\u662f\u7ed9|\u4e0d\u662f\u634f\u5ac2|\u6d17|\u5356\u8150|\u62cd\u6742\u5fd7|\u6240\u6709\u74dc|\u7d20\u6750\u4e00\u628a|\u6843\u665a\u5b89|\u6cd5\u7f57|\u9003\u8131\u5927\u5e08|\u7eb3\u897f\u59b2|\u539f\u795e)/u.test(cleanSample);
    const collaborativeContext = /(?:\u8865\u5145|\u6307\u8def|\u7ed9\u4e2a\u8bf4\u6cd5|\u89e3\u91ca|\u8ba8\u8bba|\u8bf4\u660e|\u4e00\u8d77).{0,18}\u634f\u5ac2|\u634f\u5ac2.{0,18}(?:\u8865\u5145|\u6307\u8def|\u7ed9\u4e2a\u8bf4\u6cd5|\u89e3\u91ca|\u8ba8\u8bba|\u8bf4\u660e|\u4e00\u8d77)/u.test(cleanSample);
    if (fandomDramaContext && !collaborativeContext) return true;
  }
  if (['\u7701\u6d41', '\u7701\u6d41\u4fa0'].includes(term) && family === 'cooperation') {
    const rawSample = String(sample || '').trim();
    const terseMarkerContext = /^(?:\u7701\u6d41|\u7701\u6d41\u4fa0)(?:[\s:：,，.。!！?？~\-_\u00d7xX√✓]*)$/u.test(rawSample);
    const summaryContext = /(?:\u7701\u6d41(?:\u4fa0)?(?:\u6765\u4e86)?[:：]\S{6,}|\u76f4\u63a5\u770b|\u7ed3\u8bba\u662f|\u603b\u7ed3|tl;?dr)/iu.test(rawSample);
    return terseMarkerContext && !summaryContext;
  }
  if (term === 'doge\u91d1\u7b8d' && family === 'cooperation') {
    const rawSample = String(sample || '').trim();
    const textOutsideEmotes = rawSample.replace(/\[[^\]]+\]/g, '');
    if (/\[doge[_-]\u91d1\u7b8d\]/iu.test(rawSample) && !/doge\u91d1\u7b8d/iu.test(textOutsideEmotes)) return true;
  }
  if (term === '\u5854\u83f2' && family === 'cooperation') {
    const rawSample = String(sample || '').trim();
    const textOutsideEmotesAndMentions = rawSample
      .replace(/\[[^\]]+\]/g, '')
      .replace(/@\S+/g, '')
      .trim();
    const emoteOnlyContext = (/\[[^\]]*\u5854\u83f2[^\]]*\]/u.test(rawSample) && !textOutsideEmotesAndMentions.includes('\u5854\u83f2'))
      || (/\[[^\]\s]*\u5854\u83f2[^\]\s]*(?:\.\.\.)?$/u.test(rawSample) && !rawSample.replace(/\[[^\[]*$/g, '').includes('\u5854\u83f2'));
    if (emoteOnlyContext) return true;
  }
  if (['\u88c5\u4ec0\u4e48', '\u4f60\u88c5\u4ec0\u4e48'].includes(term) && family === 'attack') {
    const installSubstringContext = /(?:\u5b89\u88c5|\u624b\u52a8\u5b89\u88c5|\u88c5\u5931\u8d25|\u683c\u5f0f|vix|cad).{0,18}(?:\u88c5\u5565|\u88c5\u4ec0\u4e48|\u600e\u4e48\u5b89)|(?:\u88c5\u5565|\u88c5\u4ec0\u4e48).{0,18}(?:\u5b89\u88c5|\u600e\u4e48\u5b89|cad|vix)/iu.test(cleanSample);
    const posturingContext = /(?:\u4f60|\u4f60\u4eec|\u8425\u9500\u53f7|\u7c89\u4e1d|\u88c5\u5565|\u88c5\u4ec0\u4e48).{0,24}(?:\u914d|\u7c89\u4e1d|\u53ef\u601c|\u94b1\u6536\u591f|\u54c1\u5473|\u5ba1\u7f8e)|(?:\u88c5\u5565|\u88c5\u4ec0\u4e48).{0,24}(?:\u5462|\u5728\u8fd9|\u7c89\u4e1d|\u53ef\u601c)/u.test(cleanSample);
    if (installSubstringContext && !posturingContext) return true;
  }
  if (term === '\u963f\u9ed1\u989c' && family === 'attack') {
    const literalExpressionContext = /(?:\u8868\u60c5|\u7ffb\u767d\u773c|\u5410\u820c|\u6597\u9e21\u773c|\u8138|\u9b3c\u8138|\u6027\u5feb\u611f|\u676f|\u5b9a\u5236|\u5565\u610f\u601d|\u4ec0\u4e48\u610f\u601d).{0,24}\u963f\u9ed1\u989c|\u963f\u9ed1\u989c.{0,24}(?:\u8868\u60c5|\u7ffb\u767d\u773c|\u5410\u820c|\u6597\u9e21\u773c|\u8138|\u9b3c\u8138|\u6027\u5feb\u611f|\u676f|\u5b9a\u5236|\u5565\u610f\u601d|\u4ec0\u4e48\u610f\u601d)/u.test(cleanSample);
    const hostileComparisonContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u522b\u628a|\u8bf4\u6210|\u9a82|\u4fae\u8fb1|\u4e0d\u5c0a\u91cd).{0,24}\u963f\u9ed1\u989c|\u963f\u9ed1\u989c.{0,24}(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8bf4\u6210|\u9a82|\u4fae\u8fb1|\u4e0d\u5c0a\u91cd)/u.test(cleanSample);
    if (literalExpressionContext && !hostileComparisonContext) return true;
  }
  if (term === '\u53d7\u6559' && (family === 'cooperation' || family === 'correction')) {
    const negatedTitleContext = /\u4e0d\u53d7\u6559/u.test(cleanSample);
    const learnedContext = /(?:\u53d7\u6559\u4e86|\u771f(?:\u7684)?\u53d7\u6559|\u5341\u5206\u53d7\u6559|\u611f\u8c22.*\u53d7\u6559|\u53d7\u6559.*(?:\u611f\u8c22|\u8c22\u8c22|\u5b66\u5230))/u.test(cleanSample);
    if (negatedTitleContext && !learnedContext) return true;
  }
  if (term === '\u4f18\u96c5' && family === 'cooperation') {
    const rawSample = String(sample || '').trim();
    const textOutsideEmotes = rawSample.replace(/\[[^\]]+\]/g, '').trim();
    const standaloneContext = cleanSample === '\u4f18\u96c5';
    const emoteOnlyContext = /\[\u70ed\u8bcd\u7cfb\u5217[_-]\u4f18\u96c5\]/u.test(rawSample) && !textOutsideEmotes.includes('\u4f18\u96c5');
    const hollowPraiseContext = /^\u4f18\u96c5(?:[\uff0c,]\s*)?(?:\u771f\u662f)?\u4f18\u96c5(?:\u54c8+)?$/u.test(cleanSample);
    const literalMotionContext = /(?:\u978b|\u9ed1\u767d\u8272|\u732b\u722c\u67b6|\u8e31\u6b65).{0,16}\u4f18\u96c5|\u4f18\u96c5.{0,16}(?:\u978b|\u9ed1\u767d\u8272|\u732b\u722c\u67b6|\u8e31\u6b65)/u.test(cleanSample);
    const literalFoodPraiseContext = /(?:\u8364\u7d20\u642d\u914d|\u6709\u6c64|\u8089\u6c64|\u6ce1\u996d|\u996d).{0,16}\u4f18\u96c5|\u4f18\u96c5.{0,16}(?:\u8364\u7d20|\u6709\u6c64|\u6ce1\u996d|\u996d)/u.test(cleanSample);
    const praiseContext = /(?:\u786e\u5b9e|\u771f|\u5f88|\u592a|\u975e\u5e38).{0,8}\u4f18\u96c5|\u4f18\u96c5.{0,12}(?:\u53ef\u7231|\u5e05\u6c14|\u6c14\u8d28|\u8868\u8fbe|\u8bf4\u6cd5)/u.test(cleanSample);
    if ((standaloneContext || emoteOnlyContext || hollowPraiseContext || literalMotionContext || literalFoodPraiseContext) && (!praiseContext || hollowPraiseContext || literalFoodPraiseContext)) return true;
  }
  if (term === '\u5237\u597d\u611f' && family === 'attack') {
    const gameAffinityContext = /(?:\u597d\u611f\u5ea6|\u901f\u5237|\u4f4e\u8017\u6cb9|\u4e3b\u7ebf|1-1|\u6469\u62c9|\u653b\u7565|\u840c\u65b0\u6307\u5357|\u65b0\u4eba\u6307\u5f15|\u539f\u795e|\u78a7\u84dd\u822a\u7ebf|\u5f02\u5ea6\u795e\u5251|\u5267\u900f).{0,24}\u5237\u597d\u611f|\u5237\u597d\u611f.{0,24}(?:\u597d\u611f\u5ea6|\u901f\u5237|\u4f4e\u8017\u6cb9|\u4e3b\u7ebf|1-1|\u6469\u62c9|\u653b\u7565|\u840c\u65b0\u6307\u5357|\u65b0\u4eba\u6307\u5f15|\u539f\u795e|\u78a7\u84dd\u822a\u7ebf|\u5f02\u5ea6\u795e\u5251|\u5267\u900f)/iu.test(cleanSample);
    const curryingFavorContext = /(?:\u611f\u89c9|\u8fd9\u662f|\u4e00\u770b|\u6545\u610f|\u88c5|\u8214|\u8ba8\u597d|\u4eba\u8bbe|\u7c89\u4e1d|\u8def\u4eba).{0,24}\u5237\u597d\u611f|\u5237\u597d\u611f.{0,24}(?:\u5427|\u5462|\u5403\u74dc|\u8214|\u8ba8\u597d|\u4eba\u8bbe|\u7c89\u4e1d|\u8def\u4eba)/u.test(cleanSample);
    if (gameAffinityContext && !curryingFavorContext) return true;
  }
  if (term === '\u786c\u64e6' && family === 'attack') {
    const literalLacquerContext = /(?:\u786c\u64e6\u6f06|\u63a8\u5149\u6f06|\u6f06\u8272|\u6f06\u9762|\u53e4\u7434|\u5f26\u8def|\u54d1\u5149|\u955c\u9762|\u8010\u78e8|\u5212\u75d5).{0,24}\u786c\u64e6|\u786c\u64e6.{0,24}(?:\u6f06|\u63a8\u5149|\u6f06\u8272|\u6f06\u9762|\u53e4\u7434|\u5f26\u8def|\u54d1\u5149|\u955c\u9762|\u8010\u78e8|\u5212\u75d5)/u.test(cleanSample);
    const forcedRhetoricContext = /(?:\u4e0d\u4f1a|\u6ca1\u6d3b|\u6ca1\u7406|\u8f93\u4e86|\u6d17|\u5706|\u5c2c).{0,12}\u786c\u64e6|\u786c\u64e6.{0,12}(?:\u54c8|\u5c2c|\u6d17|\u5706|\u7406\u7531|\u903b\u8f91|\u8bf4\u6cd5)/u.test(cleanSample);
    if (literalLacquerContext && !forcedRhetoricContext) return true;
  }
  if (term === '3pp\u5927\u795e' && family === 'attack') {
    const literalGameSettingContext = /(?:\u6697\u9ed12|\u6697\u9ed1\u7834\u574f\u795e|\u56fd\u670d|\u6389\u843d|\u7b26\u6587|\u8d85\u5e02|1pp|3pp|5pp|8pp).{0,24}3pp|3pp.{0,24}(?:\u6697\u9ed12|\u6697\u9ed1\u7834\u574f\u795e|\u56fd\u670d|\u6389\u843d|\u7b26\u6587|\u8d85\u5e02|1pp|5pp|8pp|\u6548\u7387)/iu.test(cleanSample);
    const fanPraiseContext = /3pp\u5927\u795e.{0,12}(?:\u90fd\u6765\u4e86|\u6765\u4e86|\u661f\u661f\u773c|\u725b|\u592a\u5f3a|\u5389\u5bb3)|(?:\u661f\u661f\u773c|\u725b|\u592a\u5f3a|\u5389\u5bb3).{0,12}3pp\u5927\u795e/iu.test(cleanSample);
    const hostileContext = /(?:\u5c0f\u4e11|\u4e0d\u914d|\u83dc|\u5c2c|\u9ed1|\u522b\u5439|\u6eda).{0,16}3pp\u5927\u795e|3pp\u5927\u795e.{0,16}(?:\u5c0f\u4e11|\u4e0d\u914d|\u83dc|\u5c2c|\u9ed1|\u522b\u5439|\u6eda)/u.test(cleanSample);
    if ((literalGameSettingContext || fanPraiseContext) && !hostileContext) return true;
  }
  if (term === '\u6ca1\u6551\u4e86' && family === 'correction') {
    const despairContext = /(?:\u6211\u4eec|\u6211|\u8fd9\u6ce2|\u961f\u53cb|\u793e\u6050|\u5e02\u573a|a\u80a1|\u63d0\u524d|\u56fd\u5bb6\u961f|\u6389\u5230|\u6765\u4e86).{0,24}\u6ca1\u6551\u4e86|\u6ca1\u6551\u4e86.{0,24}(?:\u54ed|\u1f62d|\u7b11|\u5d29|\u66b4\u8dcc|\u80a1\u707e|\u6599\u7406\u8282\u76ee|\u6b4c|\u672c\u5bb6|\u6295\u7a3f|\u63d0\u524d|\u6e38\u620f|\u961f\u53cb)/u.test(cleanSample);
    const correctionContext = /(?:\u8bf4\u9519|\u770b\u9519|\u641e\u9519|\u6539|\u4fee\u6b63|\u66f4\u6b63|\u6536\u56de|\u9053\u6b49|\u627f\u8ba4|\u6307\u6b63).{0,24}\u6ca1\u6551\u4e86|\u6ca1\u6551\u4e86.{0,24}(?:\u8bf4\u9519|\u770b\u9519|\u641e\u9519|\u6539|\u4fee\u6b63|\u66f4\u6b63|\u6536\u56de|\u9053\u6b49|\u627f\u8ba4|\u6307\u6b63)/u.test(cleanSample);
    if (despairContext && !correctionContext) return true;
  }
  if (term === '\u6307\u8def' && family === 'cooperation') {
    const emptySignpostContext = /\u6307\u8def[:\uff1a]?\s*$/u.test(cleanSample);
    const literalNavigationContext = /(?:\u5317\u65b9\u4eba|\u5317\u4eac|\u8def\u4e0a|\u6307\u8def\u724c|\u4e1c\u5357\u897f\u5317|\u8def\u724c).{0,24}\u6307\u8def|\u6307\u8def.{0,24}(?:\u4e1c\u5357\u897f\u5317|\u6307\u8def\u724c|\u8001\u4e00\u8f88|\u8def\u4e0a|\u5317\u4eac)/u.test(cleanSample);
    const hasTargetContext = /\u6307\u8def.{0,24}(?:https?:\/\/|BV[0-9A-Za-z]+|av\d+|\u94fe\u63a5|\u8fd9\u91cc|\u4e0a\u9762|\u4e0b\u9762)|(?:https?:\/\/|BV[0-9A-Za-z]+|av\d+|\u94fe\u63a5).{0,24}\u6307\u8def/iu.test(cleanSample);
    if ((emptySignpostContext || literalNavigationContext) && !hasTargetContext) return true;
  }
  if (term === '\u6cb9\u7ba1' && family === 'evidence') {
    const platformComplaintContext = /(?:\u6cb9\u7ba1|\u63a8\u7279).{0,24}(?:\u5783\u573e|\u53cd\u4eba\u7c7b|\u793e\u4ea4\u8f6f\u4ef6)|(?:\u5783\u573e|\u53cd\u4eba\u7c7b|\u793e\u4ea4\u8f6f\u4ef6).{0,24}(?:\u6cb9\u7ba1|\u63a8\u7279)/u.test(cleanSample);
    const sourceContext = /\u6cb9\u7ba1.{0,18}(?:\u5b98\u7f51|\u89c6\u9891|\u94fe\u63a5|\u539f\u7247|\u6765\u6e90|\u4e0b\u5230|\u641c)|(?:\u5b98\u7f51|\u89c6\u9891|\u94fe\u63a5|\u539f\u7247|\u6765\u6e90|\u4e0b\u5230|\u641c).{0,18}\u6cb9\u7ba1/u.test(cleanSample);
    if (platformComplaintContext && !sourceContext) return true;
  }
  if (term === '\u8001\u53ae' && family === 'evidence') {
    const properNamePraiseContext = /\u8463\u8001\u53ae.{0,24}(?:\u903b\u8f91|\u53e3\u624d|\u8868\u8fbe|\u771f\u5f3a|\u4e0d\u9519|\u633a\u4e0d\u9519)|(?:\u903b\u8f91|\u53e3\u624d|\u8868\u8fbe|\u771f\u5f3a|\u4e0d\u9519|\u633a\u4e0d\u9519).{0,24}\u8463\u8001\u53ae/u.test(cleanSample);
    const sourceContext = /\u8001\u53ae.{0,18}(?:\u8bc1\u636e|\u6765\u6e90|\u539f\u6587|\u94fe\u63a5|\u51fa\u5904|\u6570\u636e)|(?:\u8bc1\u636e|\u6765\u6e90|\u539f\u6587|\u94fe\u63a5|\u51fa\u5904|\u6570\u636e).{0,18}\u8001\u53ae/u.test(cleanSample);
    if (properNamePraiseContext && !sourceContext) return true;
  }
  if (term === '\u826f\u4f5c\u65e0\u4eba' && family === 'cooperation') {
    const standaloneLabelContext = cleanSample === '\u826f\u4f5c\u65e0\u4eba';
    const recommendationContext = /(?:\u826f\u4f5c\u65e0\u4eba.*(?:\u770b|\u63a8|\u5b89\u5229|\u53ef\u60dc|\u503c\u5f97)|(?:\u8fd9\u7247|\u8fd9\u4e2a|\u771f\u662f).*\u826f\u4f5c\u65e0\u4eba)/u.test(cleanSample);
    if (standaloneLabelContext && !recommendationContext) return true;
  }
  if (term === '\u516d\u516d\u516d' && family === 'attack') {
    const neutralPraiseContext = /^(?:\u54c8+[\s\uff0c,]*)?\u516d\u516d\u516d(?:[!！。~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const sarcasticContext = /(?:\u8fd9\u64cd\u4f5c|\u8fd9\u903b\u8f91|\u4f60|\u4f60\u4eec).*(?:\u516d\u516d\u516d|666).*?(?:\u8bc1\u636e|\u79bb\u8c31|\u4e0d\u770b|\u65e0\u8bed)|(?:\u516d\u516d\u516d|666).*?(?:\u8bc1\u636e|\u79bb\u8c31|\u4e0d\u770b|\u65e0\u8bed)/u.test(cleanSample);
    if (neutralPraiseContext && !sarcasticContext) return true;
  }
  if (term === '\u5bf9\u4e0d\u8d77' && family === 'correction') {
    const negatedApologyContext = /(?:\u4ece\u6ca1\u6709|\u6ca1\u6709|\u6ca1)\u5bf9\u4e0d\u8d77/u.test(cleanSample);
    const correctionApologyContext = /\u5bf9\u4e0d\u8d77.*(?:\u8bf4\u9519|\u641e\u9519|\u770b\u9519|\u8bb0\u9519|\u6536\u56de|\u662f\u6211)/u.test(cleanSample);
    if (negatedApologyContext && !correctionApologyContext) return true;
  }
  if (term === '\u6211\u9519\u4e86' && family === 'correction') {
    const refusalContext = /(?:\u6211\u9519\u4e86\u53c8\u80fd\u600e\u4e48\u6837|\u4e0d\u53ef\u80fd\u7ed9\u4f60\u9053\u6b49|\u4e0d\u627f\u8ba4\u6211\u6709\u9519)/u.test(cleanSample);
    const correctionContext = /(?:\u6211\u9519\u4e86|\u662f\u6211\u9519\u4e86).{0,18}(?:\u6536\u56de|\u6539|\u66f4\u6b63|\u770b\u9519|\u641e\u9519|\u8bb0\u9519)/u.test(cleanSample)
      || (/(?:\u6211\u9519\u4e86|\u662f\u6211\u9519\u4e86).{0,18}\u9053\u6b49/u.test(cleanSample) && !/\u4e0d\u53ef\u80fd.{0,8}\u9053\u6b49/u.test(cleanSample));
    if (refusalContext && !correctionContext) return true;
  }
  if (term === '\u622a\u56fe' && family === 'evidence') {
    const collectionOnlyContext = /(?:\u8868\u60c5\u5305|\u58c1\u7eb8|\u5934\u50cf|\u53ef\u7231).*\u622a\u56fe(?:\u62ff\u8d70|\u4fdd\u5b58|\u7559\u5ff5)|\u622a\u56fe(?:\u62ff\u8d70|\u4fdd\u5b58|\u7559\u5ff5)/u.test(cleanSample);
    const toolOnlyContext = /(?:\u622a\u56fe\+OCR|\u622a\u56fe\u7ffb\u8bd1|\u533a\u57df\u622a\u56fe|\u622a\u957f\u56fe|\u5c4f\u5e55\u622a\u56fe|\u622a\u56fe\u4fdd\u5b58|\u622a\u56fe\u6559\u7a0b|screenshots|\u5de5\u5177.{0,12}\u622a\u56fe|\u642d\u914d.{0,12}\u4e5f\u80fd\u622a\u56fe)/iu.test(cleanSample);
    const evidenceContext = /\u622a\u56fe.*(?:\u8bc1\u636e|\u8d34\u51fa\u6765|\u53d1\u51fa\u6765|\u6765\u6e90|\u5bf9\u7167)|(?:\u8bc1\u636e|\u6765\u6e90).*\u622a\u56fe/u.test(cleanSample);
    if ((collectionOnlyContext || toolOnlyContext) && !evidenceContext) return true;
  }
  if (term === '\u6d4f\u89c8\u5668\u641c' && family === 'evidence') {
    const genericSearchToolContext = /(?:\u6d4f\u89c8\u5668\u641c\u7d22(?:Ttime|\u5de5\u5177|\u63d2\u4ef6|\u8f6f\u4ef6|\u514d\u8d39\u83b7\u53d6|\u4e0d\u82b1\u94b1)|(?:\u514d\u8d39\u83b7\u53d6|\u4e0d\u82b1\u94b1).{0,12}\u6d4f\u89c8\u5668\u641c)/iu.test(cleanSample);
    const evidenceSearchContext = /(?:\u539f\u6587|\u6765\u6e90|\u8bc1\u636e|\u8d44\u6599|\u6570\u636e|\u51fa\u5904|\u4fe1\u6e90|\u94fe\u63a5).{0,12}\u6d4f\u89c8\u5668\u641c|\u6d4f\u89c8\u5668\u641c.{0,12}(?:\u539f\u6587|\u6765\u6e90|\u8bc1\u636e|\u8d44\u6599|\u6570\u636e|\u51fa\u5904|\u4fe1\u6e90|\u94fe\u63a5)/u.test(cleanSample);
    if (genericSearchToolContext && !evidenceSearchContext) return true;
  }
  if (term === '\u79d1\u5b66\u4e0a\u7f51' && family === 'evasion') {
    const toolHelpContext = /(?:\u56fd\u5185\u6709\u4e00\u4e9b\u4e86|\u53ef\u4ee5\u7528app|\u5de5\u5177|\u8f6f\u4ef6|\u6559\u7a0b).{0,18}\u79d1\u5b66\u4e0a\u7f51|\u79d1\u5b66\u4e0a\u7f51.{0,18}(?:\u53ef\u4ee5\u7528app|\u5de5\u5177|\u8f6f\u4ef6|\u6559\u7a0b)/iu.test(cleanSample);
    const evidenceEvasionContext = /(?:\u522b|\u522b\u53ea|\u53ea\u8bf4|\u8bc1\u636e|\u94fe\u63a5|\u6765\u6e90).{0,18}\u79d1\u5b66\u4e0a\u7f51|\u79d1\u5b66\u4e0a\u7f51.{0,18}(?:\u81ea\u5df1\u641c|\u8bc1\u636e|\u94fe\u63a5|\u6765\u6e90)/u.test(cleanSample);
    if (toolHelpContext && !evidenceEvasionContext) return true;
  }
  if (term === '\u53ef\u4ee5\u8d34' && family === 'cooperation') {
    const hostileDareContext = /(?:\u8001\u50bb\u5b50|\u6709\u672c\u4e8b).*(?:\u53d1\u51fa\u6765|\u8d34\u51fa\u6765|\u628a.*\u56fe\u7247\u53d1)/u.test(cleanSample);
    const genericDiscoveryContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u53ef\u4ee5\u53d1\u73b0|\u5c31\u53ef\u4ee5\u53d1\u73b0|\u53ef\u4ee5\u770b\u51fa|\u53ef\u4ee5\u770b\u5230)/u.test(cleanSample);
    const genericAdviceContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u5efa\u8bae\u5927\u5bb6|\u706b\u9505\u5e95\u6599|\u5148\u7092\u5316\u5f00|\u518d\u52a0\u70ed\u6c34)/u.test(cleanSample);
    const loosePublishContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u83ab\u540d\u5176\u5999\u53d1\u51fa\u6765\u4e86|\u73b0\u5728\u624d\u662f\u5b8c\u6574\u7248|\u8fd9\u80fd\u53d1\u51fa\u6765\u5417|\u8c03\u8bd5.{0,18}\u53d1\u51fa\u6765)/u.test(cleanSample);
    const looseCapabilityContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /\u53ef\u4ee5\u53d1\u6325/u.test(cleanSample);
    const guruMonologueContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u6293\u4f4f\u8fd9\u4e2a\u98ce\u53e3|\u63d0\u5347\u8ba4\u77e5|\u7b2c\u4e00\u6027\u539f\u7406|\u5e95\u5c42\u903b\u8f91)/u.test(cleanSample);
    const resourceShareContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u65b9\u4fbf\u5927\u4f19\u5b58|\u53ef\u4ee5\u81ea\u53d6|\u770b\u5230\u7684\u5c31\u53ef\u4ee5\u81ea\u53d6|\u53d1\u5230\u4f60\u7684\u52a8\u6001)/u.test(cleanSample);
    const labelAttachmentContext = /\u53ef\u4ee5\u8d34\u4e0a.{0,12}(?:\u5934\u8854|\u6807\u7b7e|\u5e3d\u5b50|\u540d\u53f7)|(?:\u5934\u8854|\u6807\u7b7e|\u5e3d\u5b50|\u540d\u53f7).{0,12}\u53ef\u4ee5\u8d34\u4e0a/u.test(cleanSample);
    const cooperativeSourceContext = /(?:\u53ef\u4ee5\u8d34|\u5efa\u8bae\u8d34|\u9ebb\u70e6\u8d34).*(?:\u6765\u6e90|\u8bc1\u636e|\u622a\u56fe|\u94fe\u63a5|\u5bf9\u7167)/u.test(cleanSample);
    if ((hostileDareContext || genericDiscoveryContext || genericAdviceContext || loosePublishContext || looseCapabilityContext || guruMonologueContext || resourceShareContext || labelAttachmentContext) && !cooperativeSourceContext) return true;
  }
  if (term === '\u7b11\u70b9\u89e3\u6790' && family === 'cooperation') {
    const weakJokeLabelContext = /^\u7b11\u70b9\u89e3\u6790[:\uff1a]?\s*[a-z0-9!！\s]+$/iu.test(cleanSample)
      || /^\u7b11\u70b9\u89e3\u6790(?:\u4e4b)?/u.test(cleanSample);
    const explanationContext = /\u7b11\u70b9\u89e3\u6790.{0,48}(?:\u56e0\u4e3a|\u6240\u4ee5|\u53cd\u8bdd|\u81ea\u5632|\u524d\u9762|\u8fd9\u91cc|\u6897|\u610f\u601d|\u7b11\u70b9)/u.test(cleanSample);
    if (weakJokeLabelContext && !explanationContext) return true;
  }
  if (term === '\u7cbe\u9009' && family === 'evasion') {
    const platformModerationContext = /(?:\u8bc4\u8bba\u53d1\u4e0d\u51fa\u53bb|up\u7cbe\u9009|\u5f00\u4e86\u7cbe\u9009|\u5f00\u7cbe\u9009.{0,12}(?:\u5c01|\u88ab\u5c01)|\u7cbe\u9009.{0,12}(?:\u89c6\u9891\u4f1a\u88ab\u5c01|\u88ab\u5c01)|\u8bc4\u8bba\u533a.{0,12}\u7cbe\u9009|\u8bc4\u8bba.{0,12}\u662f\u4e0d\u662f\u7cbe\u9009|\u8981.{0,4}\u7cbe\u9009)/iu.test(cleanSample);
    const selectiveEvidenceContext = /\u7cbe\u9009.{0,18}(?:\u8bc1\u636e|\u6709\u5229|\u53cd\u4f8b)|(?:\u53ea\u653e|\u53ea\u9009|\u53ea\u6311|\u53cd\u4f8b).{0,18}\u7cbe\u9009/u.test(cleanSample);
    if (platformModerationContext && !selectiveEvidenceContext) return true;
  }
  if (term === '\u7edd\u5bf9\u4e0d\u591f\u7684' && family === 'absolutes') {
    const foodAmountContext = /(?:\u4e00\u7897\u996d|\u4e0d\u591f\u9971|\u996d).{0,18}\u7edd\u5bf9\u4e0d\u591f|\u7edd\u5bf9\u4e0d\u591f.{0,18}(?:\u9971|\u996d)/u.test(cleanSample);
    const argumentativeContext = /(?:\u4f60|\u8010\u529b|\u8bc1\u636e|\u6839\u636e|\u4e0d\u591f).{0,18}\u7edd\u5bf9\u4e0d\u591f|\u7edd\u5bf9\u4e0d\u591f.{0,18}(?:\u8bc1\u636e|\u7406\u7531|\u6570\u636e|\u8010\u529b)/u.test(cleanSample);
    if (foodAmountContext && !argumentativeContext) return true;
  }
  if (['\u753b\u997c', '\u7537\u7684\u90fd\u7231\u753b\u997c'].includes(term) && family === 'attack') {
    const rawSample = String(sample || '').trim();
    const textWithoutMentions = rawSample.replace(/@\S+/gu, '').trim();
    if (rawSample.includes('@') && !textWithoutMentions.includes('\u753b\u997c')) return true;
    const literalFoodContext = /(?:\u753b\u997c\u5145\u9965|\u753b\u997c\u5f62\u5403\u64ad|\u5403\u64ad).{0,16}|\u753b\u997c.{0,12}(?:\u5145\u9965|\u5403\u64ad|\u8fd9\u4e00\u5757)/u.test(cleanSample);
    const emptyPromiseContext = /(?:\u5229\u7528|\u627f\u8bfa|\u5ffd\u60a0|\u9a97|\u540a\u7740|\u57fa\u56e0|\u753b\u997c).{0,18}\u753b\u997c|\u753b\u997c.{0,18}(?:\u5229\u7528|\u627f\u8bfa|\u5ffd\u60a0|\u9a97|\u540a\u7740|\u57fa\u56e0)/u.test(cleanSample);
    if (literalFoodContext && !emptyPromiseContext) return true;
  }
  if (term === 'tv\u5455\u5410' && family === 'attack') {
    const rawSample = String(sample || '').trim();
    const textOutsideEmotes = rawSample.replace(/\[[^\]]+\]/g, '').trim();
    if (/\[[^\]]*tv[_-]?\u5455\u5410[^\]]*\]/iu.test(rawSample) && !textOutsideEmotes) return true;
  }
  if (term === '\u5df2\u8d5e10\u8bf7\u56de\u4e0b' && family === 'cooperation') {
    const bareEngagementContext = /^\u5df2\u8d5e\d+[\uff0c,]?\s*\u8bf7\u56de\u4e0b[.!！。]*$/u.test(cleanSample);
    const discussionRequestContext = /(?:\u8bc1\u636e|\u6765\u6e90|\u8865\u5145|\u65f6\u95f4\u7ebf|\u8bf4\u6e05\u695a|\u94fe\u63a5)/u.test(cleanSample);
    if (bareEngagementContext && !discussionRequestContext) return true;
  }
  if (term === '\u4e0a\u7535\u89c6' && family === 'cooperation') {
    const bareReactionContext = /^(?:\u5367\u69fd|\u6211|\u5367\u69fd\u6211)?\u4e0a\u7535\u89c6\u4e86[!！。]*$/u.test(cleanSample);
    const discussionContext = /(?:\u8bc1\u636e|\u94fe\u63a5|\u8865\u4e0a|\u6765\u6e90|\u8fd9\u6761)/u.test(cleanSample);
    if (bareReactionContext && !discussionContext) return true;
  }
  if (term === '\u5b9e\u540d\u5236' && family === 'cooperation') {
    const literalSystemContext = /^\u5b9e\u540d\u5236\u7684\u91cd\u8981\u6027[.!！。]*$/u.test(cleanSample)
      || /(?:\u83dc\u5200|\u8eab\u4efd\u8bc1|\u6ce8\u518c|\u8d26\u53f7|\u5e73\u53f0|\u5b66\u6821|\u4e2d\u5b66|\u77ff\u533a).{0,12}\u5b9e\u540d\u5236|\u5b9e\u540d\u5236.{0,12}(?:\u83dc\u5200|\u8eab\u4efd\u8bc1|\u6ce8\u518c|\u8d26\u53f7|\u5e73\u53f0|\u5730\u533a|\u89c2\u770b)/u.test(cleanSample);
    const stanceContext = /\u5b9e\u540d\u5236.{0,12}(?:\u652f\u6301|\u53cd\u5bf9|\u8d5e\u540c|\u5206\u6790)|(?:\u652f\u6301|\u53cd\u5bf9|\u8d5e\u540c).{0,12}\u5b9e\u540d\u5236/u.test(cleanSample);
    if (literalSystemContext && !stanceContext) return true;
  }
  if (term === '\u5237\u597d\u611f' && family === 'attack') {
    const gameAffectionContext = /(?:\u4e91\u9732|\u8001\u5a46|\u53ea\u9632\u5fa1|\u6253\u6b7b|\u8214\u72d7).{0,18}\u5237\u597d\u611f|\u5237\u597d\u611f.{0,18}(?:\u4e91\u9732|\u8001\u5a46|\u9632\u5fa1|\u6253\u6b7b|\u8214\u72d7)/u.test(cleanSample);
    const performativeFavorContext = /(?:\u611f\u89c9|\u4ed6|\u5979|\u4e3b\u64ad|up|\u7c89\u4e1d|\u89c2\u4f17|\u8def\u4eba|\u4eba\u8bbe).{0,18}\u5237\u597d\u611f|\u5237\u597d\u611f.{0,18}(?:\u89c2\u4f17|\u8def\u4eba|\u7c89\u4e1d|\u4eba\u8bbe|\u5356\u60e8|\u535a\u597d\u611f)/iu.test(cleanSample);
    if (gameAffectionContext && !performativeFavorContext) return true;
  }
  if (term === '\u6211\u7684\u95ee\u9898' && family === 'correction') {
    const gameDeathContext = /(?:\u661f\u7403\u8f70\u70b8|cs\u8f68\u9053|\u98de\u9e70\u98ce\u66b4|\u6253\u6b7b\u6211|\u7838\u6b7b\u6211).{0,36}\u6211\u7684\u95ee\u9898|\u6211\u7684\u95ee\u9898.{0,36}(?:\u661f\u7403\u8f70\u70b8|cs\u8f68\u9053|\u98de\u9e70\u98ce\u66b4|\u6253\u6b7b\u6211|\u7838\u6b7b\u6211)/iu.test(cleanSample);
    const gameExplorationContext = /(?:\u63a2\u7d22\u5bc6\u5ba4|\u70b9\u8721\u70db|\u6328\u4e2a\u70b9).{0,36}\u6211\u7684\u95ee\u9898|\u6211\u7684\u95ee\u9898.{0,36}(?:\u63a2\u7d22\u5bc6\u5ba4|\u70b9\u8721\u70db|\u6328\u4e2a\u70b9)/u.test(cleanSample);
    const negatedSelfFaultContext = /(?:\u4e0d\u662f|\u4e0d\u7b97|\u6ca1\u7b97)\u6211\u7684\u95ee\u9898|\u539f\u6765\u4e0d\u662f\u6211\u7684\u95ee\u9898/u.test(cleanSample);
    const correctionContext = /(?:\u53ef\u80fd\u662f|\u786e\u5b9e\u662f|\u524d\u9762|\u6536\u56de|\u8bf4\u9519|\u6539|\u66f4\u6b63|\u9053\u6b49).{0,18}\u6211\u7684\u95ee\u9898|\u6211\u7684\u95ee\u9898.{0,18}(?:\u6536\u56de|\u66f4\u6b63|\u9053\u6b49|\u6539)/u.test(cleanSample);
    if (negatedSelfFaultContext && !correctionContext) return true;
    if ((gameDeathContext || gameExplorationContext) && !correctionContext) return true;
  }
  if (term === '\u626d\u77e9\u4e0d\u8be6\u9047\u5f3a\u5219\u5f3a' && family === 'cooperation') {
    const standaloneMemeContext = /^\u626d\u77e9\u4e0d\u8be6[\uff0c,]?\s*\u9047\u5f3a\u5219\u5f3a[.!！。]*$/u.test(cleanSample);
    const usefulVehicleContext = /(?:\u8f66|\u5b9e\u6d4b|\u6570\u636e|\u53c2\u8003|\u6027\u80fd|\u5bf9\u6bd4).{0,24}(?:\u626d\u77e9\u4e0d\u8be6|\u9047\u5f3a\u5219\u5f3a)|(?:\u626d\u77e9\u4e0d\u8be6|\u9047\u5f3a\u5219\u5f3a).{0,24}(?:\u8f66|\u5b9e\u6d4b|\u6570\u636e|\u53c2\u8003|\u6027\u80fd|\u5bf9\u6bd4)/u.test(cleanSample);
    if (standaloneMemeContext && !usefulVehicleContext) return true;
  }
  if (['\u6548\u679c\u62d4\u7fa4', '\u62d4\u7fa4'].includes(cleanTerm(term)) && family === 'cooperation') {
    const titleOrEmoteContext = /(?:\u56de\u5fc6\u8d77|\u7cfb\u5217\u89c6\u9891|\u54ea\u4f4dUP\u4e3b).{0,32}\u6548\u679c\u62d4\u7fa4|\u6548\u679c\u62d4\u7fa4.{0,32}(?:\u7cfb\u5217\u89c6\u9891|\u70ed\u8bcd\u7cfb\u5217|\u5999\u554a)/iu.test(contextSample);
    const usefulEffectContext = /(?:\u89e3\u6cd5|\u65b9\u6cd5|\u5efa\u8bae|\u7f6e\u9876|\u5b9e\u6d4b|\u6709\u7528).{0,24}\u62d4\u7fa4|\u62d4\u7fa4.{0,24}(?:\u89e3\u6cd5|\u65b9\u6cd5|\u5efa\u8bae|\u7f6e\u9876|\u5b9e\u6d4b|\u6709\u7528)/u.test(cleanSample);
    if (titleOrEmoteContext && !usefulEffectContext) return true;
  }
  if (term === '\u5c0f\u67d0\u4e66' && family === 'evasion') {
    const platformAdOrTipContext = /(?:\u53bb\u5c0f\u67d0\u4e66\u641c|\u5c0f\u67d0\u4e66\u641c).{0,24}(?:\u798f\u5229|\u8bbe\u7f6e|\u53c2\u8003|\u6559\u7a0b|\u540c\u6b3e|\u5b98\u65b9)/u.test(cleanSample);
    const evidenceEvasionContext = /(?:\u522b|\u4e0d\u8981|\u53ea).{0,16}\u5c0f\u67d0\u4e66.{0,24}(?:\u8bc1\u636e|\u6765\u6e90|\u8bf4\u6e05\u695a)|\u5c0f\u67d0\u4e66.{0,24}(?:\u5f53\u8bc1\u636e|\u4e0d\u7b97\u8bc1\u636e|\u8bc1\u636e\u5728\u54ea)/u.test(cleanSample);
    if (platformAdOrTipContext && !evidenceEvasionContext) return true;
  }
  if (term === '\u4eca\u65e5\u9996\u7ef7\u4e86' && family === 'cooperation') {
    const bareReactionContext = /^\u4eca\u65e5\u9996\u7ef7(?:\u4e86|\u7ed9\u4f60\u4e86)?[!！\s]*$/u.test(cleanSample);
    const discussionContext = /(?:\u4f46|\u4e0d\u8fc7|\u786e\u5b9e|\u524d\u9762|\u8bb2\u6e05\u695a|\u8bf4\u5bf9|\u6709\u9053\u7406|\u8865\u5145|\u8bc1\u636e|\u6765\u6e90)/u.test(cleanSample);
    if (bareReactionContext && !discussionContext) return true;
  }
  if (term === '\u6ca1\u6551\u4e86' && family === 'correction') {
    const selfStateContext = /(?:\u7126\u8651|\u9ad8\u654f\u611f|\u6cea\u5931\u7981|\u7ae5\u5e74\u521b\u4f24|\u8ba8\u597d\u578b\u4eba\u683c).{0,36}\u6211\u6ca1\u6551\u4e86|\u6211\u6ca1\u6551\u4e86.{0,36}(?:\u7126\u8651|\u9ad8\u654f\u611f|\u6cea\u5931\u7981|\u7ae5\u5e74\u521b\u4f24|\u8ba8\u597d\u578b\u4eba\u683c)/u.test(cleanSample);
    const correctionContext = /(?:\u524d\u9762|\u8bf4\u6cd5|\u6536\u56de|\u91cd\u8bf4|\u66f4\u6b63|\u6539).{0,24}\u6ca1\u6551\u4e86|\u6ca1\u6551\u4e86.{0,24}(?:\u6536\u56de|\u91cd\u8bf4|\u66f4\u6b63|\u6539)/u.test(cleanSample);
    if (selfStateContext && !correctionContext) return true;
  }
  if (term === 'ai\u8bc6\u7247\u9171' && family === 'cooperation') {
    const bareBotMentionContext = /^@?AI\u8bc6\u7247\u9171$/iu.test(String(sample || '').trim());
    const requestContext = /(?:\u8bf7|\u5e2e\u5fd9|\u8bc6\u522b|\u6765\u6e90|\u7247\u6bb5|\u8fd9\u6bb5|\u8fd9\u4e2a)/u.test(cleanSample);
    if (bareBotMentionContext && !requestContext) return true;
  }
  if (term === 'tv\u70b9\u8d5e' && family === 'cooperation') {
    const weakPraiseEmoteContext = /\[tv[_-]\u70b9\u8d5e\]/iu.test(String(sample || '')) && /(?:\u6709\u751f\u6d3b|\u5389\u5bb3|\u4e0d\u9519|nice|\u6210\u529f\u4eba\u58eb|\u949b\u5408\u91d1\u624b\u673a)/iu.test(cleanSample);
    const usefulSupportContext = /(?:\u8865\u5145|\u6709\u7528|\u5efa\u8bae|\u7f6e\u9876|\u8bc1\u636e|\u6765\u6e90|\u8d44\u6599)/u.test(cleanSample);
    if (weakPraiseEmoteContext && !usefulSupportContext) return true;
  }
  if (term === '\u91ce\u6392' && family === 'cooperation') {
    const literalQueueContext = /(?:\u4e0d\u662f\u91ce\u6392|\u4ece\u4e0d\u91ce\u6392|\u670b\u53cb\u4e0d\u662f\u91ce\u6392|\u597d\u53cb|\u5355\u4e09|\u4e09\u6392|\u533b\u751f|\u96f7\u65af|\u76d2\u5b50|\u51fa\u5fc3|\u8001\u677f|\u8d77\u67aa|\u5e26\u5305|\u6253\u67b6|\u81ea\u5df1\u91ce\u6392|\u7a7f55\u7532|\u5e26\u91d1\u86cb|\u8fd9\u4e0d\u5c31\u662f).{0,36}\u91ce\u6392|\u91ce\u6392.{0,36}(?:\u4e0d\u662f|\u4ece\u4e0d|\u597d\u53cb|\u5355\u4e09|\u4e09\u6392|\u670b\u53cb|\u533b\u751f|\u96f7\u65af|\u76d2\u5b50|\u51fa\u5fc3|\u6709\u4ec0\u4e48\u533a\u522b|\u4ec0\u4e48\u533a\u522b|\u5417|\u6211\u81ea\u5df1|\u7a7f55\u7532|\u5e26\u91d1\u86cb)/u.test(cleanSample);
    const coordinationContext = /\u91ce\u6392.{0,24}(?:\u914d\u5408|\u6c9f\u901a|\u6307\u6325|\u961f\u53cb\u613f\u610f)|(?:\u961f\u53cb|\u4e00\u8d77).{0,24}(?:\u914d\u5408|\u6c9f\u901a|\u6307\u6325).{0,12}\u91ce\u6392/u.test(cleanSample);
    if (literalQueueContext && !coordinationContext) return true;
  }
  if (term === '\u627e\u4e2a\u73ed\u4e0a' && family === 'attack') {
    const genericEmploymentContext = /(?:\u627e\d+\u7684|\u524d\u53f0\u88ab\u62d2|\u8fdb\u5382|\u670d\u52a1\u5458|\u6447\u5976\u8336|\u5361\u5e74\u9f84|\u8981\u7ecf\u9a8c|\u968f\u4fbf\u627e\u4e2a\u73ed\u4e0a.*\u8fd9\u4e2a\u8bcd)/u.test(cleanSample);
    const dismissiveEmploymentContext = /(?:\u6ca1\u6d3b|\u5bc2\u5bde|\u592a\u95f2|\u95f2\u7684|\u53d1\u766b|\u522b).{0,12}\u627e\u4e2a\u73ed\u4e0a|\u627e\u4e2a\u73ed\u4e0a.{0,12}(?:\u522b|\u6ca1\u6d3b|\u5bc2\u5bde|\u53d1\u766b|\u8bc4\u8bba\u533a|\u95ed\u5634|\u5c11\u8bf4)/u.test(cleanSample);
    if (genericEmploymentContext && !dismissiveEmploymentContext) return true;
  }
  if (term === '\u76ae\u5957' && family === 'cooperation') {
    const literalCostumeContext = /(?:\u5965\u7279|\u827e\u65af|\u96f7\u6b27|\u5965\u5144|\u5267\u60c5|\u6574\u5957|\u597d\u65b0|\u6253\u78e8|\u5b66\u6821|\u5973\u4e3b\u64ad|\u8d5a\u94b1|\u76ae\u5957\u4eba|\u6643\u60a0|\u76d1\u89c6).{0,18}\u76ae\u5957|\u76ae\u5957.{0,18}(?:\u5965\u7279|\u827e\u65af|\u96f7\u6b27|\u5965\u5144|\u5267\u60c5|\u6574\u5957|\u597d\u65b0|\u6253\u78e8|\u5b66\u6821|\u5973\u4e3b\u64ad|\u8d5a\u94b1|\u76ae\u5957\u4eba|\u6643\u60a0|\u76d1\u89c6)/u.test(cleanSample);
    const cooperativeAssetContext = /\u76ae\u5957.{0,18}(?:\u7d20\u6750|\u94fe\u63a5|\u53ef\u4ee5\u8d34|\u53d1\u51fa\u6765|\u5206\u4eab|\u53c2\u8003)|(?:\u7d20\u6750|\u94fe\u63a5|\u53ef\u4ee5\u8d34|\u53d1\u51fa\u6765|\u5206\u4eab|\u53c2\u8003).{0,18}\u76ae\u5957/u.test(cleanSample);
    if (literalCostumeContext && !cooperativeAssetContext) return true;
  }
  if (term === '\u6a21\u7ec4' && family === 'cooperation') {
    const literalGameModContext = /(?:\u6709\u589e\u5f3a\u6a21\u7ec4|\u589e\u5f3a\u6a21\u7ec4)|(?:\u70e6\u6751|\u51fb\u6740\u8ba1\u5206|\u4efb\u52a1|\u7834\u574f|\u60ca\u53d8100\u5929|\u642c\u8fd0|\u91cd\u4e86|\u4e3b\u64ad|\u6211\u8981|\u4e00\u952e\u4e09\u8fde|\u9001\u7ed9\u6211|\u4e09\u4e2a\u6a21\u7ec4).{0,18}\u6a21\u7ec4|\u6a21\u7ec4.{0,18}(?:\u70e6\u6751|\u51fb\u6740\u8ba1\u5206|\u4efb\u52a1|\u7834\u574f|\u60ca\u53d8100\u5929|\u642c\u8fd0|\u91cd\u4e86|\u4e3b\u64ad|\u6211\u8981|\u4e00\u952e\u4e09\u8fde|\u9001\u7ed9\u6211|\u4e09\u4e2a|\u589e\u5f3a)/u.test(cleanSample);
    const latestLiteralModContext = /(?:\u52a8\u4f5c|\u6218\u6597|\u5750\u4e0b|\u89d2\u8272|adobe|maximo|\u594e\u6258\u65af|\u5e93\u6d1b|\u6570\u503c|\u878d\u5316|\u8d85\u5bfc).{0,18}\u6a21\u7ec4|\u6a21\u7ec4.{0,18}(?:\u52a8\u4f5c|\u6218\u6597|\u5750\u4e0b|\u89d2\u8272|adobe|maximo|\u594e\u6258\u65af|\u5e93\u6d1b|\u6570\u503c|\u878d\u5316|\u8d85\u5bfc)/iu.test(cleanSample);
    const cooperativeModContext = /\u6a21\u7ec4.{0,18}(?:\u94fe\u63a5|\u5206\u4eab|\u53d1\u4e00\u4e0b|\u53ef\u4ee5\u8d34|\u590d\u73b0|\u600e\u4e48\u88c5)|(?:\u94fe\u63a5|\u5206\u4eab|\u53d1\u4e00\u4e0b|\u53ef\u4ee5\u8d34|\u590d\u73b0|\u600e\u4e48\u88c5).{0,18}\u6a21\u7ec4/u.test(cleanSample);
    if ((literalGameModContext || latestLiteralModContext) && !cooperativeModContext) return true;
  }
  if (term === '\u89c6\u9891\u540c\u6b3e' && family === 'cooperation') {
    const ecommerceContext = /\u89c6\u9891\u540c\u6b3e[\uff0c,]?\s*(?:\u7acb\u5373)?\u8d2d\u4e70/u.test(cleanSample);
    const requestContext = /(?:\u6c42|\u94fe\u63a5|\u5bf9\u7167|\u53c2\u8003|\u54ea\u91cc).{0,18}\u89c6\u9891\u540c\u6b3e|\u89c6\u9891\u540c\u6b3e.{0,18}(?:\u6c42|\u94fe\u63a5|\u5bf9\u7167|\u53c2\u8003|\u54ea\u91cc)/u.test(cleanSample);
    if (ecommerceContext && !requestContext) return true;
  }
  if (term === '\u5982\u679c\u6709' && family === 'cooperation') {
    const genericWishContext = /\u5982\u679c\u6709/u.test(cleanSample);
    const evidenceOpennessContext = /\u5982\u679c\u6709.{0,18}(?:\u8bc1\u636e|\u6570\u636e|\u6765\u6e90|\u539f\u6587|\u622a\u56fe|\u53cd\u4f8b).{0,18}(?:\u6539|\u6536\u56de|\u8ba4|\u770b)|\u5982\u679c\u6709.{0,18}(?:\u6211\u613f\u610f\u6539|\u53ef\u4ee5\u6539\u7ed3\u8bba)/u.test(cleanSample);
    if (genericWishContext && !evidenceOpennessContext) return true;
  }
  if (term === '\u8c01\u61c2' && family === 'evasion') {
    const audienceCountContext = /^[0-9\uff10-\uff19]+\u4eba\u6b63\u5728\u89c2\u770b[\uff0c,]?\u8c01\u61c2$/u.test(cleanSample);
    const selfEmotionContext = /(?:\u8c01\u61c2\u554a|\u8c01\u61c2).{0,18}(?:\u6211\u54ed\u6b7b|\u6211\u7684\u7b11\u70b9|\u597d\u597d\u7b11|\u592a\u597d\u54ed|\u554a{2,}|\u4e00\u70b9\u8fdb\u6765|\u51c6\u5907\u5f00\u59cb|\u9009\u724c)|(?:\u554a{2,}).{0,8}\u8c01\u61c2/u.test(cleanSample);
    const evasionContext = /(?:\u522b\u53ea\u8bf4\u8c01\u61c2|\u8c01\u61c2.*(?:\u4e0d\u89e3\u91ca|\u61c2\u7684\u90fd\u61c2|\u8bc1\u636e\u8d34\u51fa\u6765|\u81ea\u5df1\u641c))/u.test(cleanSample);
    if ((audienceCountContext || selfEmotionContext) && !evasionContext) return true;
  }
  if (term === '\u963f\u9ed1\u989c' && family === 'attack') {
    const literalExpressionContext = /(?:\u963f\u9ed1\u989c.*(?:\u4e0d\u662f|\u662f|\u6ca1\u90a3\u4e48\u660e\u663e|\u7ffb\u767d\u773c|\u5410\u820c\u5934|\u6bd4\u8036|\u7528\u529b)|(?:\u6597\u9e21\u773c|\u7ffb\u767d\u773c|\u5410\u820c\u5934|\u6bd4\u8036).*\u963f\u9ed1\u989c)/u.test(cleanSample);
    const degradingContext = /(?:\u4f60|\u4ed6|\u5979|\u522b|[^\s]{1,8}).*(?:\u8bf4\u6210|\u9a82\u6210|\u5f53\u6210).*\u963f\u9ed1\u989c|\u963f\u9ed1\u989c.*(?:\u4e0d\u5c0a\u91cd|\u4fae\u8fb1|\u6076\u5fc3|\u522b\u8fd9\u4e48\u8bf4)/u.test(cleanSample);
    if (literalExpressionContext && !degradingContext) return true;
  }
  if (term === '\u94fe\u63a5' && family === 'evidence') {
    const shoppingLinkContext = /(?:\u88e4\u5b50|\u8863\u670d|\u978b|\u5e97|\u5546\u54c1|\u597d\u597d\u770b|\u6709\u65e0|\u6c42).{0,8}\u94fe\u63a5|\u94fe\u63a5.{0,8}(?:\u6709\u65e0|\u6c42|\u4e70|\u5e97|\u5546\u54c1)/u.test(cleanSample);
    const evidenceLinkContext = /(?:\u8bc1\u636e|\u6765\u6e90|\u539f\u6587|\u8d44\u6599|\u6570\u636e).*\u94fe\u63a5|\u94fe\u63a5.*(?:\u8bc1\u636e|\u6765\u6e90|\u539f\u6587|\u8d44\u6599|\u6570\u636e|\u8d34\u51fa\u6765)/u.test(cleanSample);
    if (shoppingLinkContext && !evidenceLinkContext) return true;
  }
  if (term === '\u77e5\u8bc6\u589e\u52a0' && family === 'cooperation') {
    const emoteWrapperContext = /\[\u70ed\u8bcd\u7cfb\u5217[_-]\u77e5\u8bc6\u589e\u52a0\]/u.test(String(sample || ''));
    const textOutsideEmotes = String(sample || '').replace(/\[[^\]]+\]/g, '');
    const learningContext = /(?:\u77e5\u8bc6\u589e\u52a0\u4e86|\u5b66\u5230|\u79d1\u666e|\u539f\u6765).*\u77e5\u8bc6|\u77e5\u8bc6\u589e\u52a0.*(?:\u5b66\u5230|\u79d1\u666e)/u.test(cleanSample);
    if (emoteWrapperContext && !textOutsideEmotes.includes('\u77e5\u8bc6\u589e\u52a0') && !learningContext) return true;
  }
  if (term === '\u95ee\u8001\u9a6c\u672c\u4eba' && family === 'evasion') {
    const unrelatedMemeTitleContext = /all\s+your\s+base\s+are\s+belong\s+to\s+us|1998/i.test(rawContextSample) && !cleanSample.includes('\u95ee\u8001\u9a6c');
    const dismissiveAskContext = /(?:\u522b\u95ee\u6211|\u6211\u54ea\u77e5\u9053|\u6709\u95ee\u9898).{0,18}\u95ee\u8001\u9a6c\u672c\u4eba|\u95ee\u8001\u9a6c\u672c\u4eba.{0,18}(?:\u53bb|\u522b\u95ee\u6211|\u6211\u54ea\u77e5\u9053)/u.test(cleanSample);
    if (unrelatedMemeTitleContext && !dismissiveAskContext) return true;
  }
  if (term === '\u5168\u90fd\u662f\u5bf9' && family === 'absolutes') {
    const genericPraiseContext = /(?:\u54c8+|\u592a\u9002\u5408|\u8d34\u5408|\u6f14\u6280|\u6b23\u8d4f|\u8bedc|\u52a0\u6cb9|\u4e2d\u8003|\u5b9e\u9a8c|\u7ec3\u4e60).{0,18}(?:\u5168\u90fd\u662f\u5bf9|\u5b8c\u5168\u662f\u5bf9)|(?:\u5168\u90fd\u662f\u5bf9|\u5b8c\u5168\u662f\u5bf9).{0,18}(?:\u8d34\u5408|\u6f14\u6280|\u6b23\u8d4f|\u592a\u9002\u5408|\u52a0\u6cb9|\u4e2d\u8003|\u5b9e\u9a8c|\u7ec3\u4e60|\u6709\u5e2e\u52a9)/u.test(cleanSample);
    const gameTargetContext = /(?:\u884c\u661f\u62a4\u536b|\u53d7\u5230\u4f24\u5bb3|\u4f24\u5bb3|\u5bf9\u9762).{0,18}(?:\u5168\u662f\u5bf9\u9762|\u5168\u90fd\u662f\u5bf9\u9762)|(?:\u5168\u662f\u5bf9\u9762|\u5168\u90fd\u662f\u5bf9\u9762).{0,18}(?:\u4f24\u5bb3|\u884c\u661f\u62a4\u536b)/u.test(cleanSample);
    const closedJudgmentContext = /(?:\u4f60|\u4ed6|\u5979|\u7c89\u4e1d|\u89c9\u5f97|\u6ca1\u6709\u53cd\u4f8b|\u4e0d\u63a5\u53d7|\u4ec0\u4e48\u90fd).{0,18}\u5168\u90fd\u662f\u5bf9|\u5168\u90fd\u662f\u5bf9.{0,18}(?:\u53cd\u4f8b|\u8bc1\u636e|\u4e0d\u63a5\u53d7|\u81ea\u5df1|\u522b\u4eba\u90fd\u9519)/u.test(cleanSample);
    if ((genericPraiseContext || gameTargetContext) && !closedJudgmentContext) return true;
  }
  if (term === '\u61c2\u4e86\u5427' && family === 'evasion') {
    const explanatoryVideoContext = /(?:\u6e38\u620f|\u653b\u7565|\u89c6\u9891|\u505a\u597d|\u505a\u4e0d\u597d|\u6d41\u91cf|\u4e00\u5806\u4eba\u55b7).{0,24}\u61c2\u4e86\u5427|\u61c2\u4e86\u5427.{0,24}(?:doge|\u6e38\u620f|\u653b\u7565|\u89c6\u9891|\u505a\u597d|\u505a\u4e0d\u597d|\u6d41\u91cf|\u4e00\u5806\u4eba\u55b7)/u.test(cleanSample);
    const dismissiveEvasionContext = /(?:\u522b\u95ee|\u81ea\u5df1\u60f3|\u8bc1\u636e\u4e0d\u7ed9|\u4e0d\u89e3\u91ca|\u90fd\u8bf4\u5230\u8fd9).{0,18}\u61c2\u4e86\u5427|\u61c2\u4e86\u5427.{0,18}(?:\u522b\u95ee|\u81ea\u5df1\u60f3|\u4e0d\u89e3\u91ca|\u8bc1\u636e\u4e0d\u7ed9)/u.test(cleanSample);
    const shortReactionContext = /^(?:\u4f60\u770b[\uff0c,]?)?\u61c2\u4e86\u5427(?:\[doge\])?$/u.test(cleanSample);
    if ((explanatoryVideoContext || shortReactionContext) && !dismissiveEvasionContext) return true;
  }
  if (term === '\u8d34\u5427' && family === 'evasion') {
    const genericPlatformContext = /\u8d34\u5427/u.test(cleanSample);
    const evasionPlatformContext = /(?:\u8d34\u5427\u89c1|\u53bb\u8d34\u5427|\u8d34\u5427\u6302|\u88ab\u8d34\u5427\u6302|\u8d34\u5427.*(?:\u8bc1\u636e|\u81ea\u5df1\u770b|\u522b\u95ee))/u.test(cleanSample);
    if (genericPlatformContext && !evasionPlatformContext) return true;
  }
  if (term === '\u81ea\u5df1\u770b' && family === 'evasion') {
    const narrationContext = /(?:\u8fc7\u7a0b\u4e2d|\u65bd\u5de5|\u8282\u76ee|\u62ff\u7740\u81ea\u5df1|\u81ea\u5df1\u770b\u7740|\u81ea\u5df1\u770b\u5230)/u.test(cleanSample);
    const dismissiveContext = /(?:\u522b\u95ee\u6211|\u8bc1\u636e|\u56fe\u91cc|\u81ea\u5df1\u53bb|\u81ea\u5df1\u770b\u5427|\u4f60\u81ea\u5df1\u770b)/u.test(cleanSample);
    if (narrationContext && !dismissiveContext) return true;
  }
  if (term === '\u6ca1\u60f3\u5230\u5427' && family === 'attack') {
    const playfulRevealContext = /(?:\u54c8+.*\u6ca1\u60f3\u5230\u5427.*(?:\u6211\u62ff|\u6211\u4e5f|\u8df3\u4e86|\u5f88\u5408\u7406)|\u6ca1\u60f3\u5230\u5427.*(?:\u821e\u8e48|\u8868\u6f14|\u62ff\u5251))/u.test(cleanSample);
    const rebuttalRevealContext = /(?:\u8bc1\u636e|\u8d34\u51fa\u6765|\u6253\u8138|\u8bf4\u6211\u9020\u8c23|\u53cd\u8f6c).*\u6ca1\u60f3\u5230\u5427|\u6ca1\u60f3\u5230\u5427.*(?:\u8bc1\u636e|\u6253\u8138|\u9020\u8c23|\u53cd\u8f6c)/u.test(cleanSample);
    if (playfulRevealContext && !rebuttalRevealContext) return true;
  }
  if (term === '\u8131\u5355' && family === 'cooperation') {
    const emoteSuffixContext = /\[\u8131\u5355(?:doge)?\]/u.test(String(sample || '')) || /(?:\u8131\u5355doge|\u8131\u5355\s*doge)/u.test(cleanSample);
    const relationshipContext = /(?:\u795d|\u65e9\u65e5|\u5e0c\u671b|\u60f3).{0,8}\u8131\u5355|\u8131\u5355.*(?:\u795d|\u65e9\u65e5|\u6210\u529f|\u5bf9\u8c61|\u604b\u7231)/u.test(cleanSample);
    if (emoteSuffixContext && !relationshipContext) return true;
  }
  if (term === '\u516d\u6247\u95e8' && family === 'cooperation') {
    const literalOfficeContext = /(?:\u62a5\u516d\u6247\u95e8|\u516d\u6247\u95e8).*(?:\u53fc\u4e0a|\u5dee\u70b9|\u5f53\u65f6)|(?:\u53fc\u4e0a|\u5dee\u70b9|\u5f53\u65f6).*\u516d\u6247\u95e8/u.test(cleanSample);
    const cooperativeReportContext = /(?:bug|\u95ee\u9898|\u5efa\u8bae|\u4fee).{0,8}(?:\u62a5\u516d\u6247\u95e8|\u516d\u6247\u95e8)|(?:\u62a5\u516d\u6247\u95e8|\u516d\u6247\u95e8).{0,8}(?:bug|\u95ee\u9898|\u5efa\u8bae|\u4fee)/iu.test(cleanSample);
    if (literalOfficeContext && !cooperativeReportContext) return true;
  }
  if (term === '\u5bf9\u4e0d\u8d77' && family === 'correction') {
    const reactionApologyContext = /^\u5bf9\u4e0d\u8d77(?:\u6211)?(?:\u6ca1\u7ef7\u4f4f|\u7b11\u4e86|\u7b11\u51fa\u58f0|[\uff0c,]?\u6211\u6ca1\u7ef7\u4f4f)/u.test(cleanSample);
    const correctionApologyContext = /\u5bf9\u4e0d\u8d77.*(?:\u8bf4\u9519|\u641e\u9519|\u770b\u9519|\u8bb0\u9519|\u6536\u56de|\u662f\u6211)/u.test(cleanSample);
    if (reactionApologyContext && !correctionApologyContext) return true;
  }
  if (term === '\u602a\u6211\u54af' && family === 'correction') {
    const reactionOnlyContext = /\[\u602a/u.test(String(sample || ''))
      || /(?:\u65e0\u80fd\u72c2\u6012|\u63a5\u53d7\u4e0d\u4e86\u73b0\u5b9e|\u8fd9\u4e5f\u602a\u6211\u54af|\u53c8\u602a\u6211\u54af)/u.test(cleanSample);
    const correctionContext = /\u602a\u6211\u54af.{0,12}(?:\u770b\u9519|\u8bf4\u9519|\u641e\u9519|\u6536\u56de|\u66f4\u6b63|\u524d\u9762)|(?:\u770b\u9519|\u8bf4\u9519|\u641e\u9519|\u6536\u56de|\u66f4\u6b63).{0,12}\u602a\u6211\u54af/u.test(cleanSample);
    if (reactionOnlyContext && !correctionContext) return true;
  }
  if (['\u5999\u554a', '\u65e0\u8bed'].includes(term) && family === 'cooperation') {
    const rawSample = String(sample || '').trim();
    const emoteOnlyContext = new RegExp(`\\[(?:\\u70ed\\u8bcd\\u7cfb\\u5217[_-])?${term}\\]`, 'u').test(rawSample)
      && !rawSample.replace(/\[[^\]]+\]/g, '').includes(term);
    const discourseContext =
      term === '\u5999\u554a'
        ? /(?:\u5999\u554a).*(?:\u8bc1\u636e|\u601d\u8def|\u8865\u5145|\u5206\u6790|\u8bf4\u6e05\u695a)/u.test(cleanSample)
        : /(?:\u65e0\u8bed).*(?:\u4f46|\u8fd8\u662f|\u8bc1\u636e|\u8bf4\u6e05\u695a|\u522b\u5435)/u.test(cleanSample);
    if (emoteOnlyContext && !discourseContext) return true;
  }
  if (term === '\u5361bug' && family === 'evidence') {
    const bareBugLabelContext = /^(\u5361bug|bug)$/iu.test(cleanSample);
    const evidenceBugContext = /\u5361bug.*(?:\u8bc1\u636e|\u4e0d\u662f\u6b63\u5e38|\u6f0f\u6d1e|\u5f55\u5c4f|\u89c6\u9891)|(?:\u8bc1\u636e|\u5f55\u5c4f|\u89c6\u9891).*\u5361bug/iu.test(cleanSample);
    if (bareBugLabelContext && !evidenceBugContext) return true;
  }
  if (term === '\u652f\u6301\u529b' && family === 'cooperation') {
    return !cleanSample.includes('\u652f\u6301\u529b');
  }
  if (term === '\u652f\u6301\u4e00\u4e0bup' && family === 'cooperation') {
    const supportUpContext = /\u652f\u6301\u4e00\u4e0bup|\u652f\u6301\u4e00\u4e0bup\u4e3b|\u652f\u6301up|\u652f\u6301up\u4e3b/u.test(cleanSample);
    return !supportUpContext;
  }
  if (term === '\u5b66\u4e60\u4e86' && family === 'cooperation') {
    const futureStudyContext = /(?:\u6211\u8981|\u8981\u5f00\u59cb|\u51c6\u5907|\u8be5)\u5b66\u4e60\u4e86/u.test(cleanSample);
    const learnedFromContext = /(?:\u8bb2\u6e05\u695a|\u5b66\u5230|\u53d7\u6559|\u8c22\u8c22|\u611f\u8c22|\u65f6\u95f4\u7ebf|\u5206\u6790).{0,18}\u5b66\u4e60\u4e86|\u5b66\u4e60\u4e86.{0,18}(?:\u8c22\u8c22|\u53d7\u6559|\u5b66\u5230|\u8bb2\u6e05\u695a)/u.test(cleanSample);
    if (futureStudyContext && !learnedFromContext) return true;
  }
  if (term === '\u7ca5\u6279' && family === 'attack') {
    const usernameOnlyContext = /@\S*\u7ca5\u6279\S*/u.test(String(sample || '')) && !String(sample || '').replace(/@\S+/gu, '').includes('\u7ca5\u6279');
    if (usernameOnlyContext) return true;
  }
  if (term === '\u6697\u95e8\u5b50' && family === 'attack') {
    if (isVideoContextSample(sample)) return true;
  }
  if (term === '\u6897out\u4e86' && family === 'absolutes') {
    if (isVideoContextSample(sample)) return true;
  }
  if (term === '\u641e\u9519\u4e86' && family === 'correction') {
    const rhetoricalAccusationContext = /(?:\u662f\u4e0d\u662f|\u4e0d\u662f).{0,8}\u641e\u9519\u4e86(?:\u4ec0\u4e48|\u5427|\u554a)?|\u641e\u9519\u4e86\u4ec0\u4e48/u.test(cleanSample);
    const selfCorrectionContext = /(?:\u6211|\u524d\u9762|\u521a\u624d|\u4e0a\u9762).{0,12}\u641e\u9519\u4e86.{0,12}(?:\u66f4\u6b63|\u6539|\u6536\u56de|\u91cd\u8bf4|\u62b1\u6b49)|\u641e\u9519\u4e86.{0,12}(?:\u66f4\u6b63|\u6539|\u6536\u56de|\u91cd\u8bf4|\u62b1\u6b49)/u.test(cleanSample);
    if (rhetoricalAccusationContext && !selfCorrectionContext) return true;
  }
  if (term === '\u907f\u91cd\u5c31\u8f7b' && family === 'evasion') {
    const metaQuestionContext = /^(?:\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u4ec0\u4e48)(?:\u53eb|\u7b97|\u662f).{0,8}\u907f\u91cd\u5c31\u8f7b/u.test(cleanSample);
    const evasionAccusationContext = /(?:\u4ed6|\u4f60|\u4ed6\u4eec|\u4f60\u4eec|\u6c34\u519b|\u56de\u7b54|\u8bf4\u6cd5|\u95ee\u9898).{0,18}\u907f\u91cd\u5c31\u8f7b|\u907f\u91cd\u5c31\u8f7b.{0,18}(?:\u95ee\u9898|\u4e0d\u8c08|\u4e0d\u56de\u7b54|\u8f6c\u79fb|\u91cd\u70b9)/u.test(cleanSample);
    if (metaQuestionContext && !evasionAccusationContext) return true;
  }
  if (['\u89c4\u8bad\u987e\u5ba2', '\u597d\u5609\u4f19'].includes(term) && family === 'attack') {
    if (isVideoContextSample(sample)) return true;
  }
  if (['\u6beb\u65e0\u540a\u7528', '\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c'].includes(term) && (family === 'absolutes' || family === 'attack')) {
    if (isVideoContextSample(sample)) return true;
  }
  if (term === '\u597d\u65f6\u4ee3\u6765\u4e34\u529b' && family === 'cooperation') {
    if (isVideoContextSample(sample)) return true;
  }
  if (term === '\u8352\u91ce\u5927\u8fea\u5ba2' && family === 'attack') {
    const standalonePunContext = /^\u8352\u91ce\u5927\u8fea\u5ba2(?:[\s!！。,.，]*|\[[^\]]+\])*$/u.test(String(sample || '').trim());
    const targetedCriticismContext = /(?:\u4f60|\u8fd9|up|\u8d77\u540d|\u53d6\u540d|\u6076\u4fd7|\u4e0b\u5934|\u522b).{0,18}\u8352\u91ce\u5927\u8fea\u5ba2|\u8352\u91ce\u5927\u8fea\u5ba2.{0,18}(?:\u6076\u4fd7|\u4e0b\u5934|\u522b|\u592a)/u.test(cleanSample);
    if (standalonePunContext && !targetedCriticismContext) return true;
  }
  if (term === '\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5' && family === 'attack') {
    const standaloneReferenceContext = /^(?:\u5077\u5077\u544a\u8bc9\u4f60\u4eec)?\u56de\u5b57\u6709\u56db\u79cd\u5199\u6cd5$/u.test(cleanSample);
    if (standaloneReferenceContext) return true;
  }
  if (term === '\u7ef7\u4e0d\u4f4f\u4e86' && family === 'attack') {
    const looseReactionContext = /(?:\u6ca1\u7ef7\u4f4f|\u7ef7\u4e0d\u4f4f\u4e86)/u.test(cleanSample)
      && /(?:\u54c8+|\u7b11|\u8001\u5a46|\u5144\u5f1f\u8dd1|\u534a\u4eba\u9a6c|\u7b2c\u4e00\u53e5\u8bdd|\u8bed\u6c14|\u8fd9\u4e2a\u6ca1\u7ef7\u4f4f)/u.test(cleanSample);
    const targetedMockContext = /(?:\u4f60|\u4f60\u8fd9|\u4ed6|\u5979|\u56de\u5e94|\u4ed6\u8bf4|\u6ca1\u7528|\u540e\u8def|\u60f9\u4e86\u4e00\u8eab\u9a9a|\u8fd9\u5f20\u56fe).{0,30}(?:\u6ca1\u7ef7\u4f4f|\u7ef7\u4e0d\u4f4f)|(?:\u6ca1\u7ef7\u4f4f|\u7ef7\u4e0d\u4f4f).{0,30}(?:\u4f60|\u4f60\u8fd9|\u4ed6|\u5979|\u56de\u5e94|\u4ed6\u8bf4|\u6ca1\u7528|\u540e\u8def|\u60f9\u4e86\u4e00\u8eab\u9a9a|\u8fd9\u5f20\u56fe)/iu.test(cleanSample);
    if (looseReactionContext && !targetedMockContext) return true;
  }
  if (term === '\u5ddd\u5efa\u56fd' && family === 'attack') {
    const rawSample = String(sample || '');
    const usernameMentionOnlyContext = /@\S*(?:\u5ddd\u666e|\u5ddd\u5efa\u56fd)\S*/u.test(rawSample)
      && !rawSample.replace(/@\S+/gu, '').includes('\u5ddd\u5efa\u56fd')
      && !rawSample.replace(/@\S+/gu, '').includes('\u5ddd\u666e');
    const metaNameDiscussionContext = /(?:\u5efa\u8bbe\u56fd\u5bb6\u7684\u610f\u601d|\u4ec0\u4e48\u610f\u601d|\u4e3a\u6570\u4e0d\u591a\u7684\u641c\u5230|\u641c\u5230\u5ddd\u5efa\u56fd|\u53eb\u5ddd\u5efa\u56fd)/u.test(cleanSample);
    const creatorTrafficContext = /(?:up\u4e3b|\bup\b|\u6da8\u4e86|\u6da8\u7c89|\u7c89).{0,18}(?:\u5ddd\u666e|\u5ddd\u5efa\u56fd)|(?:\u5ddd\u666e|\u5ddd\u5efa\u56fd).{0,18}(?:up\u4e3b|\bup\b|\u5fc3\u5c16\u5ba0|\u6da8\u4e86|\u6da8\u7c89|\u7c89)/iu.test(cleanSample);
    const neutralTrumpAliasContext = cleanSample.includes('\u5ddd\u666e')
      && !cleanSample.includes('\u5ddd\u5efa\u56fd')
      && /(?:\u4fdd\u62a4\u6211\u65b9|\u6210\u529f|\u81ea\u4fe1|\u4ece\u5c0f\u5230\u5927)/u.test(cleanSample);
    const neutralTrumpQuestionContext = /(?:\u90a3\u662f|\u8fd9\u662f).{0,4}\u7279\u6717\u666e(?:[\uff1f?]|\u54e6\u547c)?/u.test(contextSample);
    const dialectChuanpuContext = /\u5ddd\u666e/u.test(cleanSample)
      && /(?:\u5ddd\u6e1d|\u56db\u5ddd|\u65b9\u8a00|\u5730\u533a|\u53e3\u97f3|\u5bb9\u6613\u542c\u61c2|\u542c\u61c2)/u.test(cleanSample);
    const satireContext = /(?:\u62a5\u544a\u7ec4\u7ec7|\u6253\u51fb\u5b8c\u6bd5|\u5fc3\u91cc\u6ca1\u70b9b\u6570|\u6cbb\u4e0d\u4e86|\u602a\u6e38\u620f|\u9b3c\u755c\u4e4b\u738b|\u7279\u6717\u666e).{0,24}(?:\u5ddd\u5efa\u56fd|\u5ddd\u666e)|(?:\u5ddd\u5efa\u56fd|\u5ddd\u666e).{0,24}(?:\u62a5\u544a\u7ec4\u7ec7|\u6253\u51fb\u5b8c\u6bd5|\u5fc3\u91cc\u6ca1\u70b9b\u6570|\u6cbb\u4e0d\u4e86|\u602a\u6e38\u620f|\u9b3c\u755c\u4e4b\u738b|\u7279\u6717\u666e)/iu.test(cleanSample);
    if ((usernameMentionOnlyContext || metaNameDiscussionContext || creatorTrafficContext || neutralTrumpAliasContext || neutralTrumpQuestionContext || dialectChuanpuContext) && !satireContext) return true;
  }
  if (term === '\u5ddd\u666e' && family === 'attack') {
    const creatorTrafficContext = /(?:up\u4e3b|\bup\b|\u6da8\u4e86|\u6da8\u7c89|\u7c89).{0,18}\u5ddd\u666e|\u5ddd\u666e.{0,18}(?:up\u4e3b|\bup\b|\u5fc3\u5c16\u5ba0|\u6da8\u4e86|\u6da8\u7c89|\u7c89)/iu.test(cleanSample);
    const neutralTrumpAliasContext = /\u5ddd\u666e/u.test(cleanSample)
      && /(?:\u4fdd\u62a4\u6211\u65b9|\u6210\u529f|\u81ea\u4fe1|\u4ece\u5c0f\u5230\u5927)/u.test(cleanSample);
    const neutralTrumpQuestionContext = /(?:\u90a3\u662f|\u8fd9\u662f).{0,4}\u7279\u6717\u666e(?:[\uff1f?]|\u54e6\u547c)?/u.test(contextSample);
    const dialectChuanpuContext = /\u5ddd\u666e/u.test(cleanSample)
      && /(?:\u5ddd\u6e1d|\u56db\u5ddd|\u65b9\u8a00|\u5730\u533a|\u53e3\u97f3|\u5bb9\u6613\u542c\u61c2|\u542c\u61c2)/u.test(cleanSample);
    const criticalTrumpContext = /\u5ddd\u666e.{0,24}(?:\u5fc3\u91cc\u6ca1\u70b9b\u6570|\u6cbb\u4e0d\u4e86|\u602a\u6e38\u620f|\u79bb\u8c31|\u8352\u8c2c)|(?:\u5fc3\u91cc\u6ca1\u70b9b\u6570|\u6cbb\u4e0d\u4e86|\u602a\u6e38\u620f|\u79bb\u8c31|\u8352\u8c2c).{0,24}\u5ddd\u666e/iu.test(cleanSample);
    if ((creatorTrafficContext || neutralTrumpAliasContext || neutralTrumpQuestionContext || dialectChuanpuContext) && !criticalTrumpContext) return true;
  }
  if (term === '\u963f\u7f8e\u8389\u5361' && family === 'attack') {
    const literalNameContext = /(?:\u963f\u7f8e\u8389\u5361|\u7f8e\u5229\u575a).{0,24}(?:\u7ffb\u8bd1|\u8da3\u95fb|\u4e00\u671f\u4e0d\u843d|\u795d\u798f|\u771f\u5fc3)|(?:\u7ffb\u8bd1|\u8da3\u95fb|\u4e00\u671f\u4e0d\u843d|\u795d\u798f|\u771f\u5fc3).{0,24}(?:\u963f\u7f8e\u8389\u5361|\u7f8e\u5229\u575a)/u.test(cleanSample);
    const americaMockContext = /(?:\u963f\u7f8e|\u963f\u7f8e\u8389\u5361|\u7f8e\u5229\u575a).{0,20}(?:\u592a\u8352\u8c2c|\u8352\u8c2c|\u7b11\u8bdd|\u592a\u5e74\u8f7b)|(?:\u592a\u8352\u8c2c|\u8352\u8c2c|\u7b11\u8bdd|\u592a\u5e74\u8f7b).{0,20}(?:\u963f\u7f8e|\u963f\u7f8e\u8389\u5361|\u7f8e\u5229\u575a)/u.test(cleanSample);
    if (literalNameContext && !americaMockContext) return true;
  }
  if (term === 'tv\u574f\u7b11' && family === 'attack') {
    const rawSample = String(sample || '');
    const emoteContext = /\[(?:tv_|[^\]]*_)?\u574f\u7b11\]/u.test(rawSample);
    const expressionContext = /(?:\u6211\u7684\u574f\u7b11|\u574f\u7b11(?:\u602a\u602a\u7684|\u4e5f\u5f88\u602a)|\u6539\u5b8c\u4e4b\u540e\u7684\u574f\u7b11)/u.test(cleanSample);
    const looseBadContext = !cleanSample.includes('tv\u574f\u7b11') && !cleanSample.includes('tv_\u574f\u7b11') && /\u975e\u8822\u65e2\u574f|\u574f\[\u7b11/u.test(cleanSample);
    const attackEmoteContext = /(?:\u4f60|\u4f60\u8fd9|\u4ed6|\u5979).{0,20}(?:tv_?\u574f\u7b11|\u574f\u7b11).{0,20}(?:\u9634\u9633|\u5632\u8bbd|\u6076\u610f)|(?:tv_?\u574f\u7b11|\u574f\u7b11).{0,20}(?:\u9634\u9633|\u5632\u8bbd|\u6076\u610f)/iu.test(cleanSample);
    if ((emoteContext || expressionContext || looseBadContext) && !attackEmoteContext) return true;
  }
  if (term === '\u903b\u8f91\u9b3c\u624d' && family === 'attack') {
    const standaloneLabelContext = /^(?:\u903b\u8f91\u9b3c\u624d|[\u300a\u201c"]?\u903b\u8f91\u9b3c\u624d[\u300b\u201d"]?)$/u.test(cleanSample);
    const targetedLogicMockContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8fd9|\u8fd9\u8bdd|\u8fd9\u903b\u8f91|\u524d\u540e\u77db\u76fe|\u8bc1\u636e).{0,16}\u903b\u8f91\u9b3c\u624d|\u903b\u8f91\u9b3c\u624d.{0,16}(?:\u4f60|\u4f60\u4eec|\u8bc1\u636e|\u524d\u540e\u77db\u76fe|\u6ca1\u65b0\u8863\u670d|\u96be\u9053|\u5c31\u8fd9)/u.test(cleanSample);
    return standaloneLabelContext && !targetedLogicMockContext;
  }
  if (term === '\u6211\u6d3b\u5230\u5934\u4e86' && family === 'cooperation') {
    const gameReactionContext = /(?:\u6d1b\u514b\u738b\u56fd|\u51fa\u5927\u53d8|\u770b\u89c1|\u9e2d\u795e|\u611f\u89c9).{0,30}\u6211\u6d3b\u5230\u5934\u4e86|\u6211\u6d3b\u5230\u5934\u4e86.{0,20}(?:\u7b11\u54ed|\u5927\u53d8|\u9e2d\u795e)/u.test(cleanSample);
    const cooperativeContext = /\u6211\u6d3b\u5230\u5934\u4e86.{0,24}(?:\u8c22\u8c22|\u8bb2\u6e05\u695a|\u660e\u767d|\u7ec8\u4e8e\u61c2)|(?:\u8c22\u8c22|\u8bb2\u6e05\u695a|\u660e\u767d).{0,24}\u6211\u6d3b\u5230\u5934\u4e86/u.test(cleanSample);
    if (gameReactionContext && !cooperativeContext) return true;
  }
  if (term === '\u5168\u662f\u7c89\u4e1d' && family === 'attack') {
    const standaloneLabelContext = cleanSample === '\u5168\u662f\u7c89\u4e1d';
    const factionAccusationContext = /\u5168\u662f\u7c89\u4e1d.{0,16}(?:\u63a7\u8bc4|\u6d17|\u4e0d\u770b\u8bc1\u636e|\u56f4\u653b|\u62a4\u4e3b)|(?:\u8bc4\u8bba\u533a|\u5f39\u5e55|\u8fd9\u91cc).{0,10}\u5168\u662f\u7c89\u4e1d/u.test(cleanSample);
    if (standaloneLabelContext && !factionAccusationContext) return true;
  }
  if (term === '\u5730\u56fe\u70ae' && family === 'attack') {
    const standaloneLabelContext = /^\u5730\u56fe\u70ae[\s\uff0c,。.!！?？]*$/u.test(cleanSample);
    const gameMechanicContext = /(?:\u4f24\u5bb3|\u6e05\u602a|\u602a|\u6280\u80fd|\u91d1\u8272|\u9ad8\u65af|\u8fc7\u767e\u4e07|\u73a9\u6cd5|\u8fdc\u7a0b|\u653b\u901f).{0,18}\u5730\u56fe\u70ae|\u5730\u56fe\u70ae.{0,24}(?:\u4f24\u5bb3|\u6e05\u602a|\u602a|\u6280\u80fd|\u73a9\u6cd5|\u723d|\u7d2f|\u91cc\u4e0d\u662f\u6700\u9ad8)/u.test(cleanSample);
    const groupAttackContext = /(?:\u522b\u5f00|\u4e0d\u8981\u5f00|\u6015\u88ab|\u9a82).{0,8}\u5730\u56fe\u70ae|\u5730\u56fe\u70ae.{0,18}(?:\u5730\u57df\u9ed1|\u79cd\u65cf|\u7fa4\u4f53|\u5168\u90fd|\u4e00\u68cd\u5b50)/u.test(cleanSample);
    if ((standaloneLabelContext || gameMechanicContext) && !groupAttackContext) return true;
  }
  if (term === '\u884c\u5584\u79ef\u5fb7' && family === 'attack') {
    const utilityQuestionContext = /\u884c\u5584\u79ef\u5fb7.{0,8}(?:\u6709\u4ec0\u4e48\u7528|\u6709\u5565\u7528|\u6ca1\u7528)/u.test(cleanSample);
    const genericMoralContext = /^(?:\u884c\u5584\u79ef\u5fb7(?:\u662f)?(?:\u4e49\u52a1|\u7f8e\u5fb7|\u597d\u4e8b)|\u4eba\u8981\u884c\u5584\u79ef\u5fb7)$/u.test(cleanSample)
      || utilityQuestionContext;
    const directedMoralAttackContext = /(?:\u4f60|\u4f60\u4eec|\u5634\u6bd2|\u7f3a\u5fb7|\u62a5\u5e94|\u5bb3\u4eba|\u5148\u53bb).{0,18}\u884c\u5584\u79ef\u5fb7|\u884c\u5584\u79ef\u5fb7.{0,18}(?:\u522b\u518d|\u62a5\u5e94|\u5bb3\u4eba|\u7f3a\u5fb7)/u.test(cleanSample);
    if (utilityQuestionContext || (genericMoralContext && !directedMoralAttackContext)) return true;
  }
  if (term === '\u795e\u4ed9\u4e0b\u51e1' && family === 'absolutes') {
    const negatedDelusionContext = /(?:\u4e0d\u8981\u5984\u60f3|\u5984\u60f3|\u6015\u662f\u5f53\u771f|\u4e00\u4ecb\u51e1\u592b|\u795e\u7ecf\u75c5|\u5f00\u836f|\u75c5\u60c5).{0,24}\u795e\u4ed9\u4e0b\u51e1|\u795e\u4ed9\u4e0b\u51e1.{0,48}(?:\u4e0d\u8981\u5984\u60f3|\u5984\u60f3|\u6015\u662f\u5f53\u771f|\u4e00\u4ecb\u51e1\u592b|\u795e\u7ecf\u75c5|\u5f00\u836f|\u75c5\u60c5)/u.test(cleanSample);
    const standaloneQuestionContext = /^(?:\u4ec0\u4e48|\u54ea\u91cc|\u600e\u4e48)\u795e\u4ed9\u4e0b\u51e1[?？!！。]*$/u.test(cleanSample);
    const praiseContext = /(?:\u771f\u662f|\u7b80\u76f4|\u64cd\u4f5c|\u8868\u73b0|\u592a|\u5b8c\u7f8e).{0,12}\u795e\u4ed9\u4e0b\u51e1|\u795e\u4ed9\u4e0b\u51e1.{0,18}(?:\u6ca1\u6709\u5931\u8bef|\u592a\u5f3a|\u5b8c\u7f8e|\u5929\u79c0)/u.test(cleanSample);
    if ((negatedDelusionContext || standaloneQuestionContext) && !praiseContext) return true;
  }
  if (term === '\u8c01\u61c2' && family === 'evasion') {
    const evidenceAvoidanceContext = /(?:\u522b\u95ee|\u8bc1\u636e|\u4e0d\u89e3\u91ca|\u4e0d\u591a\u8bf4|\u81ea\u5df1\u60f3).{0,16}\u8c01\u61c2|\u8c01\u61c2.{0,16}(?:\u90fd\u61c2|\u522b\u95ee|\u8bc1\u636e|\u4e0d\u89e3\u91ca|\u4e0d\u591a\u8bf4|\u81ea\u5df1\u60f3)/u.test(cleanSample);
    const empathyContext = /(?:\u5bb6\u4eba\u4eec|\u8c01\u61c2\u554a|up\u4e3b|\u957f\u7684|\u597d\u5374|\u8c01\u61c2\u90a3\u79cd|\u89c4\u5219\u79e9\u5e8f\u611f|\u5e0c\u671b\u5f97\u5230|\u786e\u5207\u7b54\u590d|\u611f\u89c9|\u771f\u4f1a)/u.test(cleanSample);
    if (empathyContext && !evidenceAvoidanceContext) return true;
    return !evidenceAvoidanceContext;
  }
  if (term === '\u61c2\u7684\u90fd\u61c2' && family === 'evasion') {
    const exactOrShortFormContext = /\u61c2\u7684\u90fd\u61c2/u.test(cleanSample) || /\bdddd\b/iu.test(cleanSample);
    const exactEvasionContext = exactOrShortFormContext
      && /(?:\u522b\u95ee|\u8bc1\u636e|\u4e0d\u653e|\u4e0d\u89e3\u91ca|\u61d2\u5f97\u89e3\u91ca|\u4e0d\u591a\u8bf4|\u81ea\u5df1\u60f3|\u53ea\u80fd\u8bf4|\u53cd\u6b63|\u4e0d\u597d\u8bf4)/u.test(cleanSample);
    const broadUnderstandSubstringContext = /(?:\u6709\u6ca1\u6709\u61c2\u7684|\u770b\u4e0d\u61c2\u7684|\u4e00\u770b\u5c31\u61c2\u7684|\u770b\u61c2\u7684|\u94fe\u63a5.*\u61c2\u7684|\u61c2\u7684\uff08|\u61c2\u7684\(\))/u.test(cleanSample);
    if (broadUnderstandSubstringContext && !exactEvasionContext) return true;
    return !exactEvasionContext;
  }
  if (term === '\u55d1\u74dc\u5b50' && family === 'evasion') {
    const rawSample = String(sample || '').trim();
    const emoteSuffixContext = /\[\u55d1\u74dc\u5b50\]/u.test(rawSample) && !rawSample.replace(/\[[^\]]+\]/g, '').includes('\u55d1\u74dc\u5b50');
    const spectatorContext = /\u55d1\u74dc\u5b50.*(?:\u8bc1\u636e|\u53cd\u9a73|\u522b\u53ea|\u65c1\u8fb9)|(?:\u522b\u53ea|\u65c1\u8fb9).*\u55d1\u74dc\u5b50/u.test(cleanSample);
    if (emoteSuffixContext && !spectatorContext) return true;
  }
  if (term === '\u516d\u516d\u516d' && family === 'attack') {
    const standaloneReplyContext =
      /^(?:\u56de\u590d[\p{Script=Han}\p{Letter}\p{Number}]{1,32})?\u516d\u516d\u516d$/u.test(cleanSample);
    const sarcasticContext = /(?:\u8fd9\u64cd\u4f5c|\u8fd9\u903b\u8f91|\u4f60|\u4f60\u4eec).*(?:\u516d\u516d\u516d|666).*?(?:\u8bc1\u636e|\u79bb\u8c31|\u4e0d\u770b|\u65e0\u8bed)|(?:\u516d\u516d\u516d|666).*?(?:\u8bc1\u636e|\u79bb\u8c31|\u4e0d\u770b|\u65e0\u8bed)/u.test(cleanSample);
    if (standaloneReplyContext && !sarcasticContext) return true;
  }
  if (term === '\u540a\u6253' && family === 'attack') {
    const looseSynonymContext = !cleanSample.includes('\u540a\u6253') && /(?:\u6253\u7206|\u6253\u7a7f|\u7206\u6740)/u.test(cleanSample);
    const comparisonContext = /\u540a\u6253.*(?:\u6570\u636e|\u5bf9\u6bd4|\u8bc1\u636e|\u522b\u52a8\u4e0d\u52a8)|(?:\u6570\u636e|\u5bf9\u6bd4|\u8bc1\u636e|\u522b\u52a8\u4e0d\u52a8).*\u540a\u6253|(?:\u5b8c\u7206|\u78be\u538b).*(?:\u5bf9\u9762|\u5bf9\u624b|\u540c\u7c7b)|(?:\u5bf9\u9762|\u5bf9\u624b|\u540c\u7c7b).*(?:\u5b8c\u7206|\u78be\u538b)/u.test(cleanSample);
    if (looseSynonymContext && !comparisonContext) return true;
  }
  if (term === '\u5f02\u8bae' && family === 'attack') {
    const strippedObjection = cleanSample
      .replace(/\[doge\]/giu, '')
      .replace(/\uff08\u5e7b\u542c\uff09/gu, '')
      .replace(/[!！。\s]/gu, '');
    const looseStandaloneObjectionContext = /^\u5f02\u8bae(?:[\u0021\uff01\u3002\s]|\[doge\]|\uff08\u5e7b\u542c\uff09)*$/u.test(cleanSample);
    const standaloneOrConsentContext = strippedObjection === '\u5f02\u8bae'
      || looseStandaloneObjectionContext
      || /\u6ca1\u5f02\u8bae\u5427/u.test(cleanSample);
    const disputeContext = /\u5f02\u8bae.{0,18}(?:\u8bc1\u636e|\u8bf4\u6cd5|\u53cd\u5bf9|\u95ee\u9898)|(?:\u8bc1\u636e|\u8bf4\u6cd5|\u53cd\u5bf9|\u6211\u6709).{0,18}\u5f02\u8bae/u.test(cleanSample);
    if (standaloneOrConsentContext && !disputeContext) return true;
  }
  if (term === '\u5fcf\u6094' && family === 'correction') {
    const narrativeConfessionContext = /(?:\u795e\u7236|\u6740\u4eba\u72c2|\u542c\u5230).{0,24}\u5fcf\u6094|\u5fcf\u6094.{0,24}(?:\u795e\u7236|\u6740\u4eba\u72c2)/u.test(cleanSample);
    const selfCorrectionContext = /(?:\u6211|\u672c\u4eba|\u516c\u5f00|\u9053\u6b49).{0,12}\u5fcf\u6094|\u5fcf\u6094.{0,12}(?:\u9053\u6b49|\u6539\u6b63|\u627f\u8ba4)/u.test(cleanSample);
    if (narrativeConfessionContext && !selfCorrectionContext) return true;
  }
  if (term === '\u5764\u5df4' && family === 'attack') {
    const mentionQuestionContext = /\u8fd9\u662f\u5764\u5df4\u561b/u.test(cleanSample);
    const insultContext = /(?:\u7d20\u8d28|\u4eba|\u4f60|\u4ed6|\u5979).{0,12}\u5764\u5df4|\u5764\u5df4.{0,12}(?:\u5dee|\u70c2|\u6076\u5fc3|\u79bb\u8c31)/u.test(cleanSample);
    if (mentionQuestionContext && !insultContext) return true;
  }
  if (term === '\u65e0\u8bed' && family === 'cooperation') {
    const hotWordWrapperContext = /\[\u70ed\u8bcd\u7cfb\u5217[_-]\u516d\u5230\u65e0\u8bed\]/u.test(String(sample || ''));
    const textOutsideEmotes = String(sample || '').replace(/\[[^\]]+\]/g, '');
    const discourseContext = /(?:\u65e0\u8bed).*(?:\u4f46|\u8fd8\u662f|\u8bc1\u636e|\u8bf4\u6e05\u695a|\u522b\u5435)/u.test(cleanSample);
    if (hotWordWrapperContext && !textOutsideEmotes.includes('\u65e0\u8bed') && !discourseContext) return true;
  }
  if (term === '0\u4eba' && family === 'attack') {
    const numericAudienceContext = /(?:\d+\+?\u4eba|[一二三四五六七八九十百千万]+(?:\u4e2a)?\u4eba|\u51cc\u6668|\u5728\u7ebf|\u89c2\u770b|\u76f4\u64ad\u95f4|\u6392\u961f)/u.test(cleanSample);
    const zeroPersonMockContext = /(?:0\u4eba\u652f\u6301|0\u4eba\u7406\u4f60|0\u4eba\u5728\u4e4e|0\u4eba\u8ba4\u540c|\u6ca1\u4eba\u652f\u6301|\u6ca1\u4eba\u7406)/u.test(cleanSample);
    return numericAudienceContext && !zeroPersonMockContext;
  }
  if (term === '0\u63d0\u5347' && family === 'cooperation') {
    const rawSample = String(sample || '').normalize('NFKC');
    if (/(?:\u6211\u627f\u8ba4|\u786e\u5b9e|\u4f60\u8bf4\u5f97\u5bf9|\u8fd9\u70b9).*(?:0\u63d0\u5347|\u96f6\u63d0\u5347|\u6ca1\u6709\u63d0\u5347|\u4e00\u70b9\u63d0\u5347\u6ca1\u6709|\u6beb\u65e0\u63d0\u5347)/u.test(rawSample)) return false;
    const zeroBoost = '(?:0|\u96f6|\u6ca1\u6709|\u4e00\u70b9)?\u63d0\u5347|\u6beb\u65e0\u63d0\u5347';
    const gameStatContext = new RegExp(`(?:\\u7b49\\u7ea7|\\u8d85\\u9650|\\u7a81\\u7834|\\u62c9\\u9ad8\\u7b49\\u7ea7|\\u751f\\u5b58|\\u7cbe\\u901a|\\u9632\\u5fa1|\\u53cd\\u5e94|\\u76f4\\u4f24|\\u88c5\\u5907|\\u6570\\u503c).*${zeroBoost}|${zeroBoost}.*(?:\\u7b49\\u7ea7|\\u88c5\\u5907|\\u6570\\u503c|\\u4f24\\u5bb3)`, 'u').test(cleanSample);
    const concessionContext = new RegExp(`(?:\\u6211\\u627f\\u8ba4|\\u786e\\u5b9e|\\u4f60\\u8bf4\\u5f97\\u5bf9|\\u8fd9\\u70b9).*${zeroBoost}`, 'u').test(cleanSample)
      || /(?:\u6211\u627f\u8ba4|\u786e\u5b9e|\u4f60\u8bf4\u5f97\u5bf9|\u8fd9\u70b9).*\u63d0\u5347/u.test(cleanSample);
    return !concessionContext || gameStatContext;
  }
  if (term === '\u4fe1\u4ef0' && family === 'attack') {
    const literalBeliefContext = /(?:^\u4fe1\u4ef0$|\u4fe1\u4ef0(?:\u82b1\u795e|\u795e|\u5b97\u6559|\u4f5b|\u4e0a\u5e1d|\u4e3b|\u9644\u8eab|\u4e86\u539f\u59cb\u6708\u4eae)|(?:\u82b1\u795e|\u795e\u4f7f|\u5b97\u6559|\u9644\u8eab|\u795e\u8bdd|\u795e\u5316|\u539f\u59cb\u6708\u4eae|\u5de5\u5320\u590f\u5c14\u592b).*\u4fe1\u4ef0|\u6211\u4eec\u7684\u4fe1\u4ef0.*\u6211\u4eec\u81ea\u5df1|\u79cd\u4fe1\u4ef0\u5427.{0,18}\u73a9\u7684\u771f\u7684\u5f88\u5f00\u5fc3)/u.test(cleanSample);
    const shieldContext = /(?:\u62ff\u4fe1\u4ef0\u5f53|\u4fe1\u4ef0.*(?:\u514d\u6b7b\u91d1\u724c|\u62a4\u8eab\u7b26|\u4e0d\u56de\u5e94|\u4e0d\u8bb2\u7406)|\u522b\u62ff\u4fe1\u4ef0)/u.test(cleanSample);
    return literalBeliefContext && !shieldContext;
  }
  if (term === '\u65b0\u95fb\u5b66\u554a' && family === 'attack') {
    const courseScoreContext = /\u65b0\u95fb\u5b66(?:\u6982\u8bba)?\d+\+*|\u65b0\u95fb\u5b66(?:\u6982\u8bba)?(?:\u8003\u8bd5|\u5206\u6570|\u4e13\u4e1a)/u.test(cleanSample);
    const mediaSarcasmContext = /\u65b0\u95fb\u5b66\u554a.{0,18}(?:\u6807\u9898\u515a|\u7acb\u573a|\u8bc1\u636e|\u6625\u79cb\u7b14\u6cd5)|(?:\u6807\u9898\u515a|\u7acb\u573a|\u8bc1\u636e|\u6625\u79cb\u7b14\u6cd5).{0,18}\u65b0\u95fb\u5b66/u.test(cleanSample);
    if (courseScoreContext && !mediaSarcasmContext) return true;
  }
  if (['\u5c0f\u7c89\u7ea2', 'pink'].includes(term) && family === 'attack') {
    const selfNegatedLabelContext = /(?:\u4e0d\u80fd\u8bf4\u6211\u662f\u7c89\u7ea2|\u522b\u8bf4\u6211\u662f\u7c89\u7ea2|\u6211\u4e0d\u662f\u7c89\u7ea2)/u.test(cleanSample);
    const literalColorContext = /\u7c89\u7ea2\u84dd|\u524d\u4efb\u7c89\u7ea2\u84dd|\u7ea2\u706f\u533a.*\u7c89\u7ea2.*\u6253\u5149|\u7c89\u7ea2\u6253\u5149|\u7c89\u7ea2(?:\u8272|\u5154\u5b50).*(?:\u5973\u751f|\u8349\u8393|\u725b\u5976|\u53e3\u5473|\u8868\u60c5\u5305|\u6551\u547d|\u6253\u5149)|(?:\u80f6\u56ca|\u8863\u670d|\u8272\u53f7|\u53e3\u7ea2|\u8868\u60c5\u5305|\u706f\u5149|\u6253\u5149).*\u7c89\u7ea2(?:\u8272|\u5154\u5b50)?/u.test(cleanSample);
    const replyMention = cleanSample.match(/^\u56de\u590d\s*@(.{1,40}?)\s*[:\uff1a]\s*(.*)$/u)
      || rawContextSample.match(/^\u56de\u590d\s*@(.{1,40}?)\s*[:\uff1a]\s*(.*)$/u);
    const usernameOnlyContext = (term === 'pink' && /^回复pink[a-z0-9]+/iu.test(cleanSample))
      || (replyMention && /(?:\u5c0f\u7c89\u7ea2|\u7c89\u7ea2|pink)/iu.test(replyMention[1]) && !/(?:\u5c0f\u7c89\u7ea2|\u7c89\u7ea2|pink)/iu.test(replyMention[2]));
    const hostileLabelContext = /(?:\u5c0f\u7c89\u7ea2|\u7c89\u7ea2|pink).*(?:\u8bdd\u672f|\u590d\u8bfb|\u5728\u6821\u5b66\u751f|\u8001\u5b9e|\u65e2\u5f97\u5229|\u53c8\u6765)|(?:\u4f60|\u4f60\u4eec|\u90fd\u662f).*(?:\u5c0f\u7c89\u7ea2|\u7c89\u7ea2|pink)/iu.test(cleanSample);
    return (selfNegatedLabelContext || literalColorContext || usernameOnlyContext) && !hostileLabelContext;
  }
  if (term === '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427' && family === 'attack') {
    const exactEvidenceMockContext = cleanSample.includes('\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u8fd9\u53eb\u8bc1\u636e\u5427')
      || /(?:\u8fd9(?:\u4e5f)?\u53eb\u8bc1\u636e|\u8bc1\u636e\u5728\u54ea|\u4ec0\u4e48\u8bc1\u636e|\u62ff.*\u5f53\u8bc1\u636e)/u.test(cleanSample);
    return !exactEvidenceMockContext;
  }
  if (term === '\u5c0f\u53d7' && family === 'attack') {
    const substringEducationContext = /(?:\u4ece\u5c0f\u53d7\u5230|\u5c0f\u53d7\u5230\u7684\u6559\u80b2|\u4ece\u5c0f\u53d7\u6559\u80b2)/u.test(cleanSample);
    const derogatoryLabelContext = /\u5c0f\u53d7.{0,12}(?:\u8fd9\u79cd\u8bcd|\u9a82\u4eba|\u6807\u7b7e|\u6076\u5fc3|\u522b\u62ff)|(?:\u522b\u62ff|\u522b\u7528|\u9a82).{0,12}\u5c0f\u53d7/u.test(cleanSample);
    if (substringEducationContext && !derogatoryLabelContext) return true;
  }
  if (term === '\u5c0f\u5b69\u5c04' && family === 'attack') {
    const explanationListContext = /(?:\u4e0d\u61c2\u5c31\u95ee|\u4ec0\u4e48\u610f\u601d|\u662f\u4ec0\u4e48\u6897|\u4f60\u4eec\u8bf4\u7684).{0,80}\u5c0f\u5b69\u5c04|\u5c0f\u5b69\u5c04.{0,30}(?:\u4ec0\u4e48\u610f\u601d|\u662f\u4ec0\u4e48\u6897)/u.test(cleanSample);
    const attackContext = /\u5c0f\u5b69\u5c04.{0,12}(?:\u9a82\u4eba|\u653b\u51fb|\u522b|\u6076\u5fc3)|(?:\u9a82\u4eba|\u653b\u51fb).{0,12}\u5c0f\u5b69\u5c04/u.test(cleanSample);
    if (explanationListContext && !attackContext) return true;
  }
  if (['\u5b9e\u540d\u5236', '\u5b9e\u540d\u5236\u89c2\u770b'].includes(term) && family === 'cooperation') {
    const literalIdentityContext = /^\u5b9e\u540d\u5236\u7684\u91cd\u8981\u6027[.!！。]*$/u.test(cleanSample)
      || /(?:\u82b1\u94b1)?\u5b9e\u540d\u5236.{0,12}(?:\u8ba4(?:\u8dcc|\u7239)|\u8ba4\u8bc1|\u767b\u8bb0|\u767b\u5f55|\u4fe1\u606f|\u624b\u673a\u53f7|\u8eab\u4efd|\u83dc\u5200|\u5200|\u5730\u533a|\u7ba1\u5236|\u89c2\u770b)|(?:\u5e73\u5e84\u77ff\u533a|\u5b66\u6821|\u4e2d\u5b66|\u77ff\u533a|\u8eab\u4efd|\u8ba4\u8bc1|\u767b\u8bb0|\u767b\u5f55|\u624b\u673a\u53f7|\u83dc\u5200|\u5200|\u5730\u533a|\u7ba1\u5236).{0,12}\u5b9e\u540d\u5236/u.test(cleanSample);
    const supportContext = /(?:\u6211|\u672c\u4eba).{0,8}\u5b9e\u540d\u5236(?:\u89c2\u770b|\u652f\u6301|\u4e09\u8fde|\u5938|\u63a8\u8350)|\u5b9e\u540d\u5236\u89c2\u770b.{0,12}(?:\u4e09\u8fde|\u652f\u6301|\u63a8\u8350)/u.test(cleanSample);
    if (literalIdentityContext && !supportContext) return true;
  }
  if (term === '\u9633\u75ff' && family === 'attack') {
    const literalMedicalContext = /(?:ed\u4e0d\u662f\u9633\u75ff\u5417|ED\u4e0d\u662f\u9633\u75ff\u5417|\u6ca1\u6709\u9633\u75ff|\u81ea\u5df1\u9633\u75ff|\u9633\u75ff\u5c31\u662f\u9633\u75ff)|(?:\u533b\u751f|\u53d1\u73b0\u81ea\u5df1|\u611f\u8c22\u533b\u751f|\u5e74\u7eaa|\u73ed|\u7206\u51fa\u6765|\u804a\u5929\u8bb0\u5f55|\u524d\u5973\u53cb|\u8f9f\u8c23|\u6562\u4f5c\u6562\u5f53).{0,48}\u9633\u75ff|\u9633\u75ff.{0,36}(?:\u533b\u751f|\u53d1\u73b0\u81ea\u5df1|\u81ea\u5df1|\u6ca1\u6709|\u5e74\u7eaa|\u73ed|\u7206\u51fa\u6765|\u804a\u5929\u8bb0\u5f55|\u8f9f\u8c23|\u6562\u4f5c\u6562\u5f53)/iu.test(cleanSample);
    const hostileSexualInsultContext = /(?:\u4f60|\u4f60\u4eec|\u53d1\u8a00|\u522b\u88c5|\u5e9f\u7269|\u5634\u786c).{0,18}\u9633\u75ff|\u9633\u75ff.{0,18}(?:\u4f60|\u4f60\u4eec|\u53d1\u8a00|\u522b\u88c5|\u5e9f\u7269|\u5634\u786c)/u.test(cleanSample);
    return literalMedicalContext && !hostileSexualInsultContext;
  }
  if (term === '\u5bab\u9888\u7cdc\u70c2' && family === 'correction') {
    const literalMedicalContext = /(?:\u533b\u751f|\u4f53\u68c0|\u5bab\u9888|\u764c\u53d8|\u624b\u672f|\u51b7\u51bb|\u5207\u6389|\u7532\u72b6\u817a|\u5916\u79d1|\u5987\u79d1|\u68c0\u67e5|\u4ea4\u94b1|\u6cbb|\u75c5|\u764c|\u533b\u9662).{0,48}\u5bab\u9888\u7cdc\u70c2|\u5bab\u9888\u7cdc\u70c2.{0,48}(?:\u533b\u751f|\u4f53\u68c0|\u5bab\u9888|\u764c\u53d8|\u624b\u672f|\u51b7\u51bb|\u5207\u6389|\u7532\u72b6\u817a|\u5916\u79d1|\u5987\u79d1|\u68c0\u67e5|\u4ea4\u94b1|\u6cbb|\u75c5|\u764c|\u533b\u9662)/u.test(cleanSample);
    const correctionContext = /(?:\u4e0d\u662f|\u5df2\u7ecf\u4e0d\u53eb|\u5b98\u65b9|\u89c4\u8303|\u672f\u8bed|\u8bef\u8bca|\u8c23\u8a00|\u8f9f\u8c23|\u79d1\u666e|\u8bf4\u6cd5|\u6539\u53eb|\u66f4\u6b63|\u7ea0\u6b63).{0,48}\u5bab\u9888\u7cdc\u70c2|\u5bab\u9888\u7cdc\u70c2.{0,48}(?:\u4e0d\u662f|\u5df2\u7ecf\u4e0d\u53eb|\u5b98\u65b9|\u89c4\u8303|\u672f\u8bed|\u8bef\u8bca|\u8c23\u8a00|\u8f9f\u8c23|\u79d1\u666e|\u8bf4\u6cd5|\u6539\u53eb|\u66f4\u6b63|\u7ea0\u6b63)/u.test(cleanSample);
    return literalMedicalContext && !correctionContext;
  }
  if (['\u53f7\u88ab\u76d7', '\u53f7\u88ab\u76d7\u4e86'].includes(term) && family === 'correction') {
    const literalAccountRecoveryContext = /(?:\u738b\u8005|\u6e38\u620f|\u8d26\u53f7|\u8d26\u53f7|\u8d26\u6237|\u4e70\u7684\u53f7|\u4efb\u53f7\u4e3b|\u7533\u8bc9|\u5ba2\u670d|\u5145\u503c\u8bb0\u5f55|imei|\u624b\u673a|\u627e\u56de|\u5bc6\u7801|\u767b\u5f55|\u7ed1\u5b9a|\u5b89\u5168|\u6539\u5bc6|\u76d7\u53f7).{0,56}(?:\u53f7\u88ab\u76d7|\u53f7\u88ab\u76d7\u4e86)|(?:\u53f7\u88ab\u76d7|\u53f7\u88ab\u76d7\u4e86).{0,56}(?:\u738b\u8005|\u6e38\u620f|\u8d26\u53f7|\u8d26\u6237|\u4e70\u7684\u53f7|\u4efb\u53f7\u4e3b|\u7533\u8bc9|\u5ba2\u670d|\u5145\u503c\u8bb0\u5f55|imei|\u624b\u673a|\u627e\u56de|\u5bc6\u7801|\u767b\u5f55|\u7ed1\u5b9a|\u5b89\u5168|\u6539\u5bc6|\u600e\u4e48\u529e|\u61c2\u600e\u4e48\u529e|\u76d7\u53f7)/iu.test(cleanSample);
    const blameDeflectionContext = /(?:\u522b\u62ff|\u53c8\u62ff|\u522b\u7528|\u5c11\u62ff|\u501f\u53e3|\u7529\u9505|\u72e1\u8fa9|\u88c5\u4ec0\u4e48).{0,24}(?:\u53f7\u88ab\u76d7|\u53f7\u88ab\u76d7\u4e86)|(?:\u53f7\u88ab\u76d7|\u53f7\u88ab\u76d7\u4e86).{0,24}(?:\u501f\u53e3|\u7529\u9505|\u72e1\u8fa9|\u4e0d\u80cc\u9505|\u4e0d\u8ba4|\u6d17)/u.test(cleanSample);
    return literalAccountRecoveryContext && !blameDeflectionContext;
  }
  if (term === '\u6b65\u5175' && family === 'evasion') {
    const gameUnitContext = /(?:\u6c22\u6b65\u5175|(?:\u73a9|\u6302|\u5929\u57fa\u70ae|\u6253\u4e0b\u6765|\u62b5\u6297\u80fd\u529b|\u7b2c\u4e8c\u5f62\u6001|\u6280\u80fd|\u5355\u4f4d|\u5175\u79cd|\u666e\u9c81\u58eb|\d+\u53f7\u6b65\u5175|\u79bb\u5f00\u4e86\u6211\u4eec).{0,24}\u6b65\u5175|\u6b65\u5175.{0,24}(?:\u73a9|\u6302|\u5929\u57fa\u70ae|\u6253\u4e0b\u6765|\u62b5\u6297\u80fd\u529b|\u7b2c\u4e8c\u5f62\u6001|\u6280\u80fd|\u5355\u4f4d|\u5175\u79cd|\u666e\u9c81\u58eb|\u79bb\u5f00\u4e86\u6211\u4eec))/u.test(cleanSample);
    const evasionContext = /(?:\u522b\u62ff|\u501f\u53e3|\u8bc1\u636e|\u8bf4\u6e05\u695a).{0,18}\u6b65\u5175|\u6b65\u5175.{0,18}(?:\u522b\u62ff|\u501f\u53e3|\u8bc1\u636e|\u8bf4\u6e05\u695a)/u.test(cleanSample);
    return gameUnitContext && !evasionContext;
  }
  if (term === '\u4e25\u7236' && family === 'attack') {
    const gameEntityContext = /\u71c3\u85aa\u866b\u4e25\u7236|(?:\u602a|boss|\u6e38\u620f|\u89d2\u8272|\u71c3\u85aa\u866b).{0,16}\u4e25\u7236|\u4e25\u7236.{0,16}(?:\u602a|boss|\u6e38\u620f|\u89d2\u8272|\u71c3\u85aa\u866b)/iu.test(cleanSample);
    const counterContext = /(?:\u540c\u4ef7\u4f4d|\u673a\u5b50|\u5bf9\u624b|\u6253\u7206|\u78be\u538b|\u6027\u4ef7\u6bd4).{0,18}\u4e25\u7236|\u4e25\u7236.{0,18}(?:\u540c\u4ef7\u4f4d|\u673a\u5b50|\u5bf9\u624b|\u6253\u7206|\u78be\u538b|\u6027\u4ef7\u6bd4)/u.test(cleanSample);
    return gameEntityContext && !counterContext;
  }
  if (term === 'bgm\u5473' && family === 'cooperation') {
    const complaintContext = /bgm\u5473.{0,8}(?:\u592a\u51b2|\u592a\u602a|\u96be\u53d7)|(?:\u592a\u51b2|\u523a\u8033).{0,8}bgm\u5473/iu.test(cleanSample);
    const constructiveContext = /bgm\u5473.{0,12}(?:\u5f88\u5bf9|\u6c42\u6b4c\u540d|\u8d44\u6599|\u94fe\u63a5)|(?:\u6c42\u6b4c\u540d).{0,12}bgm\u5473/iu.test(cleanSample);
    return complaintContext && !constructiveContext;
  }
  if (['\u6ca1\u6bdb\u75c5', '\u6ca1\u6bdb\u75c5\u554a'].includes(term) && family === 'cooperation') {
    const bareAgreementContext = /^(?:\u4e5f)?\u6ca1\u6bdb\u75c5(?:\u554a)?[!！。.\s]*$/u.test(cleanSample);
    const sarcasticAttackContext = /\u6ca1\u6bdb\u75c5.{0,12}(?:\u8111\u5b50|\u6cbb\u7597|\u53bb\u6cbb|\u53d1\u5200)|(?:\u8111\u5b50|\u6cbb\u7597).{0,12}\u6ca1\u6bdb\u75c5/u.test(cleanSample);
    const agreementContext = /\u6ca1\u6bdb\u75c5.{0,12}(?:\u6211\u540c\u610f|\u8bb2\u5f97\u5bf9|\u89e3\u91ca)|(?:\u89e3\u91ca|\u8bf4\u6cd5|\u8bf4\u7684|\u8bdd).{0,12}\u6ca1\u6bdb\u75c5/u.test(cleanSample);
    return (sarcasticAttackContext || bareAgreementContext) && !agreementContext;
  }
  if (['\u4e0d\u662f\u4eba\u4e86', '\u4e0d\u662f\u4eba\u4e86\u5457'].includes(term) && family === 'attack') {
    const bodyStateNarrativeContext = /(?:\u8eab\u4f53|\u8089\u8eab|\u673a\u4f53|\u5f62\u6001|\u8eaf\u4f53).{0,12}(?:\u4e0d\u5f53\u4eba|\u4e0d\u662f\u4eba)|(?:\u4e0d\u5f53\u4eba|\u4e0d\u662f\u4eba).{0,12}(?:\u8eab\u4f53|\u8089\u8eab|\u673a\u4f53|\u5f62\u6001|\u8eaf\u4f53)/u.test(cleanSample);
    const standaloneNotHumanContext = /^(?:\u4e0d\u5f53\u4eba\u4e86|\u4e0d\u662f\u4eba\u4e86|\u771f\u4e0d\u662f\u4eba)$/u.test(cleanSample);
    const hostileNotHumanContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u7b56\u5212|up|\u7c89|\u5c0f\u56e2\u4f53|\u5e26\u8282\u594f|\u8f6c\u79fb\u4f24\u5bb3|\u771f).{0,18}(?:\u4e0d\u662f\u4eba|\u4e0d\u5f53\u4eba)|(?:\u4e0d\u662f\u4eba|\u4e0d\u5f53\u4eba).{0,18}(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u7b56\u5212|up|\u7c89|\u5c0f\u56e2\u4f53|\u5e26\u8282\u594f|\u79bb\u8c31|\u771f)/iu.test(cleanSample);
    if ((bodyStateNarrativeContext || standaloneNotHumanContext) && !hostileNotHumanContext) return true;
  }
  if (term === '\u60f3\u5200\u4eba' && family === 'attack') {
    const selfCrisisContext = /(?:\u4e0d\u77e5\u9053\u6211\u8be5\u600e\u4e48\u529e|\u771f\u4e0d\u77e5\u9053\u6211\u8be5\u600e\u4e48\u529e|\u7126\u8651).{0,48}\u60f3\u5200\u4eba|\u60f3\u5200\u4eba.{0,48}(?:\u7126\u8651|\u4e0d\u77e5\u9053\u6211\u8be5\u600e\u4e48\u529e)/u.test(cleanSample);
    const targetedFrustrationContext = /(?:\u4f60|\u4ed6|\u5979|\u8fd9\u4eba|\u8fd9\u64cd\u4f5c|\u641e\u7b11).{0,18}\u60f3\u5200\u4eba|\u60f3\u5200\u4eba.{0,18}(?:\u4e0d\u6ee1|\u641e\u7b11|\u6c14\u6b7b|\u65e0\u8bed)/u.test(cleanSample);
    if (selfCrisisContext && !targetedFrustrationContext) return true;
  }
  if (term === '\u4e00\u6761\u9f99' && family === 'cooperation') {
    const literalPersonOrServiceContext = /\u4e00\u6761\u9f99\u7684\u8fd8\u662f\u4e2a|(?:\u7ef4\u65cf\u5927\u53d4|\u6d17\u526a\u5439|\u5957\u9910|\u4ea7\u4e1a\u94fe).{0,12}\u4e00\u6761\u9f99|\u4e00\u6761\u9f99.{0,12}(?:\u7ef4\u65cf\u5927\u53d4|\u6d17\u526a\u5439|\u5957\u9910|\u4ea7\u4e1a\u94fe)/u.test(cleanSample);
    const cooperativeWorkflowContext = /(?:\u8bc1\u636e|\u94fe\u63a5|\u6574\u7406|\u6559\u7a0b|\u6d41\u7a0b|\u8d44\u6599).{0,12}\u4e00\u6761\u9f99|\u4e00\u6761\u9f99.{0,12}(?:\u8d34|\u6574\u7406|\u6559\u7a0b|\u6d41\u7a0b|\u5e2e|\u53c2\u8003)/u.test(cleanSample);
    if (literalPersonOrServiceContext && !cooperativeWorkflowContext) return true;
  }
  if (term === '\u4e3b\u5305' && family === 'cooperation') {
    const teasingAddressContext = /(?:^\u4e3b\u5305(?:\u662f\u4e0d|\u662f\u4e0d\u662f|\u4e0d\u662f|\u6709\u70b9)|\u4e3b\u5305\u662f\u4e0d\u6709\u70b9|\u4e3b\u5305\u6700\u5f00\u59cb\u8bf4|\u8fd9\u4e0d\u662f\u9001\u5206\u5417)/u.test(cleanSample);
    const requestContext = /\u4e3b\u5305.{0,18}(?:\u80fd\u4e0d\u80fd|\u53ef\u4ee5|\u6c42|\u94fe\u63a5|\u6765\u6e90|\u8bb2\u4e00\u4e0b|\u89e3\u91ca|\u8c22\u8c22|\u8f9b\u82e6|\u9650\u8d2d|\u5237\u65b0|\u4e70)/u.test(cleanSample);
    if (teasingAddressContext && !requestContext) return true;
  }
  if (term === '\u8bb0\u9519\u4e86' && family === 'correction') {
    const selfCorrectionContext = /(?:\u6211|\u662f\u6211|\u81ea\u5df1|\u524d\u9762|\u521a\u624d|\u4e4b\u524d).{0,8}\u8bb0\u9519\u4e86|\u8bb0\u9519\u4e86.{0,8}(?:\u6536\u56de|\u66f4\u6b63|\u6539)/u.test(cleanSample);
    if (cleanSample.includes('\u8bb0\u9519\u4e86') && !selfCorrectionContext) return true;
  }
  if (term === '\u732a\u9f3b' && family === 'attack') {
    const literalObjectContext = /^(?:\u732a\u9f3b|\u732a\u9f3b\u5b50)$/u.test(cleanSample)
      || /(?:\u732a\u9f3b\u5b50.*(?:\u5e72\u4ec0\u4e48\u7528|\u6709\u4ec0\u4e48\u7528|\u7528\u5b83|\u4e0d\u7528\u5b83)|(?:\u5c31\u662f\u4e2a|\u662f\u4e2a|\u50cf\u4e2a|\u8fd9\u662f).{0,6}\u732a\u9f3b(?:\u5b50)?|(?:\u53cc\u7f1d\u5e72\u6d89|\u9053\u5177|\u6a21\u578b|\u88c5\u9970|\u5934\u5957|\u9762\u5177|\u9f3b\u5b50).{0,12}\u732a\u9f3b(?:\u5b50)?|\u732a\u9f3b(?:\u5b50)?.{0,12}(?:\u9053\u5177|\u6a21\u578b|\u88c5\u9970|\u5934\u5957|\u9762\u5177|\u9f3b\u5b50|\u6027\u7656))/u.test(cleanSample);
    const directedCriticismContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8fd9\u4eba|\u522b|\u8fd9\u6ce2|\u8fd9\u4e00\u624b|\u8fd9\u64cd\u4f5c|\u521a\u624d).{0,8}\u732a\u9f3b|\u732a\u9f3b.{0,8}(?:\u4e00\u6837|\u786c\u62ac|\u5634\u786c|\u88c5|\u8822|\u7b28|\u5446|\u522b|\u64cd\u4f5c)/u.test(cleanSample);
    return literalObjectContext && !directedCriticismContext;
  }
  if (term === '\u70bc\u94dc' && family === 'attack') {
    const literalMetallurgyContext = /(?:\u8f6c\u7089|\u51b6\u91d1|\u94dc\u77ff|\u91d1\u5c5e|\u5de5\u827a|\u7cfb\u7edf).{0,10}\u70bc\u94dc|\u70bc\u94dc.{0,10}(?:\u8f6c\u7089|\u51b6\u91d1|\u94dc\u77ff|\u91d1\u5c5e|\u5de5\u827a|\u7cfb\u7edf|\u4f1a\u4e86)/u.test(cleanSample);
    const predatorySlangContext = /(?:\u5c0f\u5b69|\u5c0f\u5b69\u5b50|\u513f\u7ae5|\u672a\u6210\u5e74|\u604b\u7ae5|\u7325\u4eb5|x\u6697\u793a|\u523b\u8138\u4e0a|\u81ea\u9009\u5957\u9910|\u5b50\u5f39).{0,18}\u70bc\u94dc|\u70bc\u94dc.{0,18}(?:\u5c0f\u5b69|\u5c0f\u5b69\u5b50|\u513f\u7ae5|\u672a\u6210\u5e74|\u604b\u7ae5|\u7325\u4eb5|x\u6697\u793a|\u523b\u8138\u4e0a|\u81ea\u9009\u5957\u9910|\u5b50\u5f39)/u.test(cleanSample);
    if (literalMetallurgyContext && !predatorySlangContext) return true;
  }
  if (term === '\u5389\u4e0d\u5389\u5bb3' && family === 'attack') {
    const rawSample = String(sample || '');
    const sampleWithoutReplyMention = rawSample.replace(/^\s*\u56de\u590d\s*@[^:：]+[:：]\s*/u, '');
    const usernameOnlyMentionContext = rawSample !== sampleWithoutReplyMention && !sampleWithoutReplyMention.includes('\u5389\u4e0d\u5389\u5bb3');
    if (usernameOnlyMentionContext) return true;
  }
  if (['\u70ed\u4e4e', '\u70ed\u4e4e\u7684'].includes(term) && family === 'cooperation') {
    const negatedFreshnessContext = /(?:\u5e76\u975e|\u4e0d\u662f|\u4e0d\u7b97|\u6ca1\u6709|\u6ca1\u90a3\u4e48|\u5df2\u7ecf\u4e0d)\u70ed\u4e4e(?:\u7684)?/u.test(cleanSample);
    const cooperativeFreshContext = /\u70ed\u4e4e(?:\u7684)?.{0,12}(?:\u8d44\u6599|\u6d88\u606f|\u521a|\u53d1\u51fa\u6765|\u53c2\u8003|\u70ed\u8bc4)|(?:\u8d44\u6599|\u6d88\u606f|\u521a|\u53d1\u51fa\u6765|\u53c2\u8003|\u70ed\u8bc4).{0,12}\u70ed\u4e4e(?:\u7684)?/u.test(cleanSample);
    if (negatedFreshnessContext && !cooperativeFreshContext) return true;
  }
  if (['\u5ddd\u5efa\u56fd', '\u5ddd\u666e'].includes(term) && family === 'attack') {
    const literalTrumpContext = /(?:\u7279\u6717\u666e|\u5ddd\u666e).*(?:\u5934\u50cf|\u56fd\u65d7|\u5370\u4e0a|\u7f8e\u56fd\u56fd\u65d7)|(?:\u5934\u50cf|\u56fd\u65d7|\u5370\u4e0a).*(?:\u7279\u6717\u666e|\u5ddd\u666e)/u.test(cleanSample);
    const ordinaryNameContext = term === '\u5ddd\u5efa\u56fd' && /(?:\u738b\u5efa\u56fd|\u5efa\u56fd\u540c\u5fd7|\u53eb\u5efa\u56fd|\u7684\u662f\u5efa\u56fd|\u662f\u6253\u7535\u8bdd\u7684\u662f\u738b\u5efa\u56fd)/u.test(cleanSample);
    const dialectChuanpuContext = /\u5ddd\u666e/u.test(cleanSample)
      && /(?:\u5ddd\u6e1d|\u56db\u5ddd|\u65b9\u8a00|\u5730\u533a|\u53e3\u97f3|\u5bb9\u6613\u542c\u61c2|\u542c\u61c2)/u.test(cleanSample);
    const hostilePoliticalContext = /(?:\u5ddd\u5efa\u56fd|\u5ddd\u666e|\u5ddd\u666e|\u7279\u6717\u666e|Trump|MAGA|maga|\u7f8e\u56fd).*(?:\u8bdd\u672f|\u7c89\u4e1d|\u590d\u8bfb|\u53c8\u6765|\u5c0f\u4e11|\u6076\u5fc3)|(?:\u8bdd\u672f|\u7c89\u4e1d|\u590d\u8bfb).*(?:\u5ddd\u5efa\u56fd|\u5ddd\u666e|\u7279\u6717\u666e|Trump|MAGA|maga)/u.test(cleanSample);
    return (literalTrumpContext || ordinaryNameContext || dialectChuanpuContext) && !hostilePoliticalContext;
  }
  if (['\u53ea\u53ef\u610f\u4f1a', '\u53ea\u53ef\u610f\u4f1a\u4e0d\u53ef\u8a00\u4f20'].includes(term) && family === 'evasion') {
    const aestheticDescriptionContext = /(?:\u773c\u5f71|\u7c89\u8272|\u8bd5\u8272|\u5986\u6548|tf30|tf42|\u4e0a\u773c|\u8272\u53f7|\u53e3\u7ea2|\u6a58\u7c89|\u6253\u5e95|\u6548\u679c).{0,24}\u53ea\u53ef\u610f\u4f1a|\u53ea\u53ef\u610f\u4f1a.{0,24}(?:\u773c\u5f71|\u7c89\u8272|\u8bd5\u8272|\u5986\u6548|tf30|tf42|\u4e0a\u773c|\u8272\u53f7|\u53e3\u7ea2|\u6a58\u7c89|\u6253\u5e95|\u6548\u679c)/iu.test(cleanSample);
    const evasionContext = /(?:\u522b\u53ea\u8bf4|\u522b\u62ff|\u4e0d\u89e3\u91ca|\u8bc1\u636e|\u903b\u8f91|\u8bf4\u6e05\u695a|\u61c2\u7684\u90fd\u61c2).{0,18}\u53ea\u53ef\u610f\u4f1a|\u53ea\u53ef\u610f\u4f1a.{0,18}(?:\u8bc1\u636e|\u903b\u8f91|\u4e0d\u89e3\u91ca|\u8bf4\u6e05\u695a|\u522b\u95ee|\u81ea\u5df1\u61c2)/u.test(cleanSample);
    return aestheticDescriptionContext && !evasionContext;
  }
  if (term === '\u53bb\u641c' && family === 'evasion') {
    const searchToUnderstandContext = /(?:\u6211\u4eec|\u6211|\u5927\u5bb6).{0,12}\u8981\u53bb\u641c\u7d22.{0,12}(?:\u660e\u767d|\u7406\u89e3)|\u53bb\u641c\u7d22.{0,12}(?:\u624d\u80fd|\u5c31\u80fd).{0,8}(?:\u660e\u767d|\u7406\u89e3)/u.test(cleanSample);
    const dismissiveSearchContext = /(?:\u4f60|\u4f60\u4eec).{0,8}(?:\u81ea\u5df1)?\u53bb\u641c|\u4e0d\u4f1a\u81ea\u5df1\u53bb\u641c|\u53bb\u641c.{0,8}(?:\u522b\u95ee\u6211|\u522b\u95ee|\u61d2\u5f97\u89e3\u91ca|\u81ea\u5df1\u770b)/u.test(cleanSample);
    return searchToUnderstandContext && !dismissiveSearchContext;
  }
  if (term === '\u9633\u5bff' && family === 'cooperation') {
    const selfLuckCostContext = /(?:\u7528\u81ea\u5df1\u9633\u5bff\u62bd|\u6211\u7528\u4f60\u4eec\u7684doge|(?:\u6d6a\u8d39|\u8017|\u635f).{0,8}(?:\u4f60|\u6211|\u81ea\u5df1)?.{0,4}\u9633\u5bff|\u9633\u5bff.{0,8}(?:\u62bd\u5361|\u62bd\u5c31\u884c|\u6b6a\u4e86|\u51fa\u8d27|\u88ab\u6d6a\u8d39))/u.test(cleanSample);
    const helpfulExperienceContext = /(?:\u8c22\u8c22|\u611f\u8c22|\u660e\u767d|\u7ecf\u9a8c|\u53c2\u8003|\u5b66\u5230).{0,18}\u9633\u5bff|\u9633\u5bff.{0,18}(?:\u7ecf\u9a8c|\u53c2\u8003|\u660e\u767d|\u5b66\u5230|\u6362\u6765)/u.test(cleanSample);
    return selfLuckCostContext && !helpfulExperienceContext;
  }
  if (term === '\u4fe1\u606f\u8327\u623f' && family === 'attack') {
    const selfCurationContext = /(?:\u4e3a\u81ea\u5df1\u5236\u9020\u4fe1\u606f\u8327\u623f|\u81ea\u5df1\u5236\u9020\u4fe1\u606f\u8327\u623f|\u5f00\u4e2a\u5c0f\u53f7.*\u4fe1\u606f\u8327\u623f|\u4fe1\u606f\u8327\u623f.*\u4f1a\u6e05\u51c0|\u5927\u6570\u636e.*\u8282\u594f)/u.test(cleanSample);
    const platformPhenomenonContext = /(?:\u7537\u5973\u770b\u5230\u7684\u8bc4\u8bba\u533a|\u8bc4\u8bba\u533a.*\u4e0d\u4e00\u6837|\u4fe1\u606f\u8327\u623f\u6b63\u5728\u64cd\u7eb5\u7740\u6211\u4eec|\u5e73\u53f0|\u7b97\u6cd5|\u5927\u6570\u636e).*\u4fe1\u606f\u8327\u623f|\u4fe1\u606f\u8327\u623f.*(?:\u64cd\u7eb5\u7740\u6211\u4eec|\u5e73\u53f0|\u7b97\u6cd5|\u5927\u6570\u636e)/u.test(cleanSample);
    const accusationContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6\u4eec|\u5bf9\u9762|\u8fd9\u5c31\u662f).*\u4fe1\u606f\u8327\u623f|\u4fe1\u606f\u8327\u623f.*(?:\u53ea\u770b|\u4e0d\u770b|\u8bc1\u636e|\u81ea\u55e8|\u6d17\u8111)/u.test(cleanSample);
    return (selfCurationContext || platformPhenomenonContext) && !accusationContext;
  }
  if (term === '\u88c5\u5230' && family === 'attack') {
    const substringClothingContext = /(?:\u65f6\u88c5\u5230|\u670d\u88c5\u5230|\u88c5\u5907\u5230|\u88c5\u5230\u56fd\u670d|\u88c5\u5230\d+\u5929)/u.test(cleanSample);
    const posturingContext = /(?:\u522b\u88c5|\u88c5\u5230\u81ea\u5df1|\u88c5\u5230\u5f88|\u88c5\u5230\u4ec0\u4e48\u7a0b\u5ea6|\u592a\u80fd\u88c5)/u.test(cleanSample);
    return substringClothingContext && !posturingContext;
  }
  if (term === '\u516d\u516d\u516d' && family === 'attack') {
    const standalonePraiseContext = /^(?:\u516d\u516d\u516d|666|6{3,})$/iu.test(cleanSample);
    const literalNumberContext = /(?:\u82f1\u8bed\u8001\u5e08|\u6570\u5b66|\u5b66\u8fc7|\u5c0f\u65f6|\u5206\u949f|\u79d2|\u7b2c?\u516d).*(?:\u516d\u516d\u516d|666)|(?:\u516d\u516d\u516d|666).*(?:\u82f1\u8bed\u8001\u5e08|\u6570\u5b66|\u5b66\u8fc7|\u5c0f\u65f6|\u5206\u949f|\u79d2)/iu.test(cleanSample);
    const sarcasticContext = /(?:\u771f\u516d\u516d\u516d|\u8fd9\u64cd\u4f5c.*(?:\u516d\u516d\u516d|666)|(?:\u516d\u516d\u516d|666).*(?:\u65e0\u8bed|\u79bb\u8c31|\u4e0d\u4f1a\u5427))/iu.test(cleanSample);
    return (standalonePraiseContext || literalNumberContext) && !sarcasticContext;
  }
  if (term === '\u6ca1\u60f3\u5230\u5427' && family === 'attack') {
    const hasExactRevealPhrase = cleanSample.includes('\u6ca1\u60f3\u5230\u5427');
    const neutralSurpriseContext = /(?:\u6211\u4ee5\u4e3a|\u6211\u662f\u6ca1\u60f3\u5230|\u771f\u6ca1\u60f3\u5230|\u53ef\u80fd\u6ca1\u60f3\u5230|\u6ca1\u60f3\u5230(?:\u4e0d\u662f|\u662f|\d|\u5e74|\u53c8|\u8fd8|\u80fd|\u5927\u5bb6|\u4f1a\u6709)|\u6ca1\u60f3\u5230\u5427(?:doge)?[\u3002\uff01!]*$)/iu.test(cleanSample);
    const sarcasticRevealContext = /(?:\u6ca1\u60f3\u5230\u5427.*(?:\u4f60|\u6253\u8138|\u7ffb\u8f66|\u8bc1\u636e|\u53cd\u9a73)|(?:\u6253\u8138|\u7ffb\u8f66|\u53cd\u9a73).*\u6ca1\u60f3\u5230\u5427)/u.test(cleanSample);
    return (!hasExactRevealPhrase && !sarcasticRevealContext) || (neutralSurpriseContext && !sarcasticRevealContext);
  }
  if (term === '\u6ca1\u4eba\u5728\u4e4e' && family === 'cooperation') {
    const dismissiveContext = /(?:\u6ca1\u4eba\u5728\u4e4e\u4f60|\u722c\u5427\u6ca1\u4eba\u5728\u4e4e|\u6ca1\u4eba\u5728\u4e4e\u7684|^\u6ca1\u4eba\u5728\u4e4e$)/u.test(cleanSample);
    const lowStakesContext = /(?:\u5176\u5b9e\u6ca1\u4eba\u5728\u4e4e|\u522b\u5435\u4e86.*\u6ca1\u4eba\u5728\u4e4e|\u8fd9\u4e8b\u6ca1\u4eba\u5728\u4e4e.*(?:\u597d\u597d\u8ba8\u8bba|\u56de\u5230\u95ee\u9898))/u.test(cleanSample);
    return dismissiveContext && !lowStakesContext;
  }
  if (['\u5154\u5154\u5c9b', '\u5154\u5154\u5c9b\u7761\u89c9'].includes(term) && family === 'cooperation') {
    const emoteWrapperContext = /\[\u5154\u5154\u5c9b[_-]?\u7761\u89c9\]/u.test(rawContextSample) || /\[\u5154\u5154\u5c9b[^\]]*\]/u.test(rawContextSample);
    const textOutsideEmotes = rawContextSample.replace(/\[[^\]]+\]/g, '');
    const titleOrCreatorContext = /(?:\u5154\u5154\u5c9b\u662f\u54ea\u4e2a\u65b0up\u4e3b|\u5c01\u9762|\u65b0up\u4e3b|\u54ea\u4e2aup|\u89c6\u9891|\u6807\u9898)/iu.test(cleanSample);
    const cooperativeContext = /(?:\u5154\u5154\u5c9b(?:\u7761\u89c9)?).{0,18}(?:\u8d44\u6599|\u6765\u6e90|\u53ef\u4ee5\u8d34|\u8865\u5145|\u53c2\u8003)|(?:\u8d44\u6599|\u6765\u6e90|\u53ef\u4ee5\u8d34|\u8865\u5145|\u53c2\u8003).{0,18}\u5154\u5154\u5c9b/u.test(cleanSample);
    return (titleOrCreatorContext || (emoteWrapperContext && !textOutsideEmotes.includes('\u5154\u5154\u5c9b'))) && !cooperativeContext;
  }
  if (term === '\u63d2\u4e2a\u773c' && family === 'cooperation') {
    const bookmarkOnlyContext = /\u63d2\u4e2a\u773c.{0,24}(?:\u540e\u7eed|\u4e24\u5468|\u6bcf\u5929|\u6d3b\u7740|\u7ee7\u7eed)|^\u63d2\u4e2a\u773c(?:[\s\uff0c,].*)?$/u.test(cleanSample);
    const followupEvidenceContext = /\u63d2\u4e2a\u773c.{0,24}(?:\u8bc1\u636e|\u94fe\u63a5|\u6765\u6e90|\u8865\u4e0a|\u540e\u7eed\u66f4\u65b0|\u8d44\u6599)/u.test(cleanSample);
    if (bookmarkOnlyContext && !followupEvidenceContext) return true;
  }
  if (term === '\u7b11\u563b\u4e86' && family === 'cooperation') {
    const scoreReactionContext = /(?:\d+\u6bd4\d+|\u8138\u8272|\u63ea\u5fc3|\u4e0d\u8bf4\u8bdd|\u770b\w{2,8}).{0,30}\u7b11\u563b\u4e86|\u7b11\u563b\u4e86.{0,30}(?:\d+\u6bd4\d+|\u8138\u8272|\u63ea\u5fc3|\u4e0d\u8bf4\u8bdd)/iu.test(cleanSample);
    const selfSabotageMockingContext = /(?:\u6ee1\u5206|\u7b54\u6848|\u5b66\u9738|\u81ea\u5df1).{0,24}(?:\u6539\u6210\u4e86?\u96f6\u5206|\u96f6\u5206|\u6539\u9519|\u7ffb\u8f66).{0,18}\u7b11\u563b\u4e86|\u7b11\u563b\u4e86.{0,24}(?:\u96f6\u5206|\u6539\u9519|\u7ffb\u8f66)/u.test(cleanSample);
    const standaloneContext = /^\u7b11\u563b\u4e86[.!！。\s]*$/u.test(cleanSample);
    const positiveDiscussionContext = /(?:\u89e3\u91ca|\u8865\u5145|\u5206\u6790|\u8bf4\u6e05\u695a|\u8bc1\u636e).{0,18}\u7b11\u563b\u4e86|\u7b11\u563b\u4e86.{0,18}(?:\u8bf4\u660e\u767d|\u8c22\u8c22|\u5b66\u5230)/u.test(cleanSample);
    if ((scoreReactionContext || selfSabotageMockingContext || standaloneContext) && !positiveDiscussionContext) return true;
  }
  if (term === '\u5f00\u667a\u4e86' && family === 'attack') {
    const neutralAwakeningContext = /(?:\u7a81\u7136\u5f00\u667a\u4e86|\u4ed6\u5c31\u5df2\u7ecf\u5f00\u667a\u4e86|\u5973\u6027\u5bf9\u6297\u7684\u58f0\u97f3|\u6211\u6ca1\u5f00\u667a|\u627f\u8ba4\u81ea\u5df1).{0,40}/u.test(cleanSample);
    const directedMockContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u903b\u8f91|\u5f53\u4e8b\u4eba|\u90a3b|\u8fd9b|\u7ec8\u4e8e).{0,18}\u5f00\u667a\u4e86|\u5f00\u667a\u4e86.{0,18}(?:\u4f1a\u81ea\u5df1\u5220|\u5220|[\uff1f?]|\u8fd9\u903b\u8f91)/u.test(cleanSample);
    if (neutralAwakeningContext && !directedMockContext) return true;
  }
  if (term === '\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50' && family === 'attack') {
    const literalCountContext = /(?:\u95ee[:\uff1a]?|\u88ab)\S{0,10}\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50|\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50[\uff1f?]|(?:\u5976\u916a|\u7070\u7070).{0,8}\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50/u.test(cleanSample);
    const labelingContext = /(?:\u4f60|\u4f60\u4eec|\u5bf9\u65b9|\u7ed9|\u6263\u5e3d\u5b50|\u4e0d\u662f\u8ba8\u8bba).{0,24}\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50|\u6263\u4e86\u51e0\u6b21\u5e3d\u5b50.{0,24}(?:\u8bc1\u636e|\u4e0d\u662f\u8ba8\u8bba|\u6263\u5e3d\u5b50)/u.test(cleanSample);
    if (literalCountContext && !labelingContext) return true;
  }
  if (term === '\u5999\u554a\u5999\u554a' && family === 'attack') {
    const rawSample = String(sample || '').trim();
    const emoteWrapperContext = /\[\u5999\u554a\]\s*\[\u5999\u554a\]/u.test(rawSample);
    const textOutsideEmotes = rawSample.replace(/\[[^\]]+\]/g, '');
    const playfulFictionContext = /(?:\u638c\u95e8|\u6309\u5728\u5730\u4e0a\u63cd|\u914d\u53d7|\u6f5c\u529b|doge).{0,30}\u5999\u554a\u5999\u554a|\u5999\u554a\u5999\u554a.{0,30}(?:\u638c\u95e8|\u6309\u5728\u5730\u4e0a\u63cd|\u914d\u53d7|\u6f5c\u529b|doge)/u.test(contextSample);
    const sarcasticContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u903b\u8f91|\u8fd9\u8bf4\u6cd5|\u8fd9\u64cd\u4f5c|\u8bc1\u636e).{0,18}\u5999\u554a\u5999\u554a|\u5999\u554a\u5999\u554a.{0,18}(?:\u8bc1\u636e|\u903b\u8f91|\u79bb\u8c31|\u771f\u662f)/u.test(cleanSample);
    if (playfulFictionContext && !/(?:\u8bc1\u636e|\u903b\u8f91|\u8bf4\u6cd5|\u64cd\u4f5c|\u79bb\u8c31)/u.test(cleanSample)) return true;
    if (((emoteWrapperContext && !textOutsideEmotes.includes('\u5999\u554a\u5999\u554a')) || playfulFictionContext) && !sarcasticContext) return true;
  }
  if (term === '\u6e05\u4e00\u8272' && family === 'absolutes') {
    const properNameContext = /\u6e05\u4e00\u8272\u662f\u5973\u8131\u53e3\u79c0\u6f14\u5458|\u6e05\u4e00\u8272\u662f.{0,12}(?:\u6f14\u5458|\u4e3b\u64ad|up\u4e3b|UP\u4e3b|\u4f5c\u8005)/u.test(cleanSample);
    const absoluteContext = /\u6e05\u4e00\u8272.{0,18}(?:\u90fd|\u5168|\u9a82|\u52a0\u6cb9|\u4e0b\u67b6|\u5e26\u8282\u594f)|(?:\u8bc4\u8bba\u533a|\u5f39\u5e55|\u5386\u53f2\u8bb0\u5f55).{0,18}\u6e05\u4e00\u8272/u.test(cleanSample);
    if (properNameContext && !absoluteContext) return true;
  }
  if (term === '\u5708\u7c73\u4e0d\u8d56' && family === 'attack') {
    const lacksExactTerm = !cleanSample.includes('\u5708\u7c73\u4e0d\u8d56');
    const looseMonetizationContext = /\u5708\u7c73\u6d3b\u52a8|\u5404\u79cd\u5708\u7c73|\u5708\u7c73.{0,8}(?:\u6d3b\u52a8|\u8fd0\u8425)/u.test(cleanSample);
    const standaloneContext = cleanSample === '\u5708\u7c73\u4e0d\u8d56';
    const sarcasticContext = /\u5708\u7c73\u4e0d\u8d56.{0,18}(?:\u88ab\u5272|\u8001\u73a9\u5bb6|\u53c8|\u8fd9\u6ce2|\u538b\u69a8)|(?:\u88ab\u5272|\u8001\u73a9\u5bb6|\u53c8|\u8fd9\u6ce2|\u538b\u69a8).{0,18}\u5708\u7c73\u4e0d\u8d56/u.test(cleanSample);
    if ((lacksExactTerm && looseMonetizationContext) || (standaloneContext && !sarcasticContext)) return true;
  }
  if (term === '\u9f99\u54e5\u7684\u5144\u5f1f' && family === 'attack') {
    const listOrExplanationContext = /(?:\u7f57\u54e5\u7684\u4e0d\u662f\u554a|\u8f69\u59b9|\u5575|\u9017\u53f7|\u5192\u53f7).{0,24}\u9f99\u54e5\u7684\u5144\u5f1f|\u9f99\u54e5\u7684\u5144\u5f1f.{0,24}(?:\u7f57\u54e5\u7684\u4e0d\u662f\u554a|\u8f69\u59b9|\u5575|\u9017\u53f7|\u5192\u53f7)/u.test(cleanSample);
    const hostileNicknameContext = /(?:\u9ed1\u79f0|\u522b\u518d|\u590d\u8bfb|\u5e26\u8282\u594f|\u653b\u51fb).{0,18}\u9f99\u54e5\u7684\u5144\u5f1f|\u9f99\u54e5\u7684\u5144\u5f1f.{0,18}(?:\u9ed1\u79f0|\u522b\u518d|\u590d\u8bfb|\u5e26\u8282\u594f|\u653b\u51fb)/u.test(cleanSample);
    if (listOrExplanationContext && !hostileNicknameContext) return true;
  }
  if (term === '\u7f57\u4e0d\u6cfc' && family === 'attack') {
    const explanationOrOriginContext = /\u7f57\u4e0d\u6cfc.{0,24}(?:\u6307\u7684\u662f|\u50cf\u6cfc\u51fa\u53bb|\u80fd\u60f3\u51fa|\u8bf7\u4e2a\u9ad8\u4eba)|(?:\u6307\u7684\u662f|\u50cf\u6cfc\u51fa\u53bb|\u80fd\u60f3\u51fa|\u8bf7\u4e2a\u9ad8\u4eba).{0,24}\u7f57\u4e0d\u6cfc/u.test(cleanSample);
    const hostileNicknameContext = /(?:\u9ed1\u79f0|\u522b\u518d|\u590d\u8bfb|\u5e26\u8282\u594f|\u653b\u51fb).{0,18}\u7f57\u4e0d\u6cfc|\u7f57\u4e0d\u6cfc.{0,18}(?:\u9ed1\u79f0|\u522b\u518d|\u590d\u8bfb|\u5e26\u8282\u594f|\u653b\u51fb)/u.test(cleanSample);
    if (explanationOrOriginContext && !hostileNicknameContext) return true;
  }
  if (['\u523b\u8fdbdna', '\u523b\u8fdbdna\u7684'].includes(term) && family === 'attack') {
    const skillOrMemoryContext = /(?:\u523b\u8fdbdna(?:\u7684)?(?:\u6280\u80fd|\u8bb0\u5fc6|\u808c\u8089\u8bb0\u5fc6)|\u771f\u523b\u8fdbdna|\u523b\u8fdbdna\u91cc)/iu.test(cleanSample);
    const badHabitContext = /(?:\u523b\u8fdbdna.*(?:\u574f\u6bdb\u75c5|\u6076\u4e60|\u8bdd\u672f|\u6298\u817e|\u8f93\u4e86\u5c31)|(?:\u6076\u4e60|\u8bdd\u672f|\u6bdb\u75c5).*\u523b\u8fdbdna)/iu.test(cleanSample);
    return skillOrMemoryContext && !badHabitContext;
  }
  if (term === '\u5168\u662f\u4e2d\u56fd' && family === 'attack') {
    const substringNegationContext = /(?:\u4e0d\u5168\u662f\uff0c?\u4e2d\u56fd|\u4e0d\u5168\u662f\u4e2d\u56fd|\u4e5f\u4e0d\u5168\u662f.*\u4e2d\u56fd)/u.test(cleanSample);
    const overbroadClaimContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6\u4eec).*\u5168\u662f\u4e2d\u56fd|\u5168\u662f\u4e2d\u56fd.*(?:\u8fd9\u79cd\u8bdd|\u8a00\u8bba|\u79bb\u8c31)/u.test(cleanSample);
    return substringNegationContext && !overbroadClaimContext;
  }
  if (term === '\u6b7b\u62ff' && family === 'absolutes') {
    const literalOrInvestmentContext = /(?:\u4f5c\u6b7b\u62ff\u5200|\u6b7b\u62ff\u5200|\u4e00\u76f4\u6b7b\u62ff(?:cpo|\u534a\u5bfc\u4f53|\u80a1|\u57fa\u91d1)|\u6b7b\u62ff(?:cpo|\u534a\u5bfc\u4f53|\u80a1|\u57fa\u91d1))/iu.test(cleanSample);
    const rigidArgumentContext = /(?:\u522b|\u4f60|\u4f60\u4eec).{0,8}\u6b7b\u62ff.{0,12}(?:\u8bc1\u636e|\u4f8b\u5b50|\u89c2\u70b9|\u6807\u51c6|\u4e0d\u653e|\u7edd\u5bf9)|\u6b7b\u62ff.{0,12}(?:\u8bc1\u636e|\u4f8b\u5b50|\u89c2\u70b9|\u6807\u51c6|\u4e0d\u653e|\u7edd\u5bf9)/u.test(cleanSample);
    return literalOrInvestmentContext && !rigidArgumentContext;
  }
  if (term === '\u90fd\u662f\u5bb6\u4eba' && family === 'cooperation') {
    const genericAddressContext = /(?:\u5bb6\u4eba\u4eec|\u5bb6\u4eba).*(?:\u7206\u7b11|\u8c01\u61c2|\u6211\u542c|\u53d1\u70b9\u5f39\u5e55|\u53d1\u5f39\u5e55|\u6c42\u5f39\u5e55|\u6c42\u6c42|\u63a8\u8350|\u5e2e\u5fd9|\u770b\u770b|\u8c01\u77e5\u9053|\u5c5e\u5b9e|\u65e0\u8bed|\u5e26\u504f|\u9700\u8981|\u7eaa\u5ff5\u610f\u4e49|\u5b5d\u4e0d\u6d3b|\u70b9\u70b9\u5c0f\u7ea2\u5fc3|\u5c0f\u7ea2\u5fc3|\u652f\u6301\u4e0b)|(?:\u7206\u7b11\u4e86\u5bb6\u4eba\u4eec|\u5b5d\u4e0d\u6d3b.*\u5bb6\u4eba\u4eec|\u4e00\u53e3\u4e00\u4e2a\u5bb6\u4eba\u4eec|\u4e0d\u662f\u4f60\u4e00\u4e2a\u4eba.*\u4f60\u4e00\u5bb6\u4eba|\u5168\u5bb6\u4eba.*\u5408\u5f71|\u8ddf\u5bb6\u4eba.*\u5173\u7cfb|\u5bb6\u4eba\u7684\u671f\u5f85)|(?:\u53ef\u4e50|\u6c34|\u4e00\u676f|\u97f3\u4e50\u8282|\u5c0f\u6768\u54e5|\d+\u5143?).{0,24}\u90fd\u662f\u5bb6\u4eba/u.test(cleanSample);
    const solidarityContext = /(?:\u90fd\u662f\u5bb6\u4eba|\u5927\u5bb6\u90fd\u662f\u5bb6\u4eba).*(?:\u522b\u5435|\u597d\u597d\u8bf4|\u4e92\u76f8|\u8ba8\u8bba)/u.test(cleanSample);
    return genericAddressContext && !solidarityContext;
  }
  if (term === '\u4e0d\u5c2c' && family === 'cooperation') {
    const standaloneContext = cleanSample === '\u4e0d\u5c2c';
    const negatedAttackContext = /\u4e0d\u5c2c\u9ed1/u.test(cleanSample);
    const reassuranceContext = /(?:\u4e0d\u5c2c).*(?:\u8bb2\u5f97|\u56de\u5e94|\u8fd9\u6bb5|\u53ef\u4ee5|\u633a\u597d|\u6e05\u695a)/u.test(cleanSample);
    const embarrassmentContrastContext = /\u4e0d\u5c2c.*(?:\u6211\u90fd\u89c9\u5f97\u5c2c|\u89c9\u5f97\u5c2c)|\u4e0d\u5c2c.*\u5c2c/u.test(cleanSample);
    const antiHypeContext = /\u4e0d\u5c2c\u5439|\u6ca1.{0,8}\u4e0d\u5c2c\u5439/u.test(cleanSample);
    return (standaloneContext || negatedAttackContext || embarrassmentContrastContext || antiHypeContext) && !reassuranceContext;
  }
  if (term === '\u5c01\u795e' && family === 'cooperation') {
    const literalTitleContext = /(?:\u5c01\u795e\u6f14\u4e49|\u300a\u5c01\u795e|\u5c01\u795e\u699c|\u770b\u5230\u5c01\u795e|\u7535\u5f71\u5c01\u795e)/u.test(cleanSample);
    const praiseContext = /(?:\u8fd9\u4e00\u53e5|\u8fd9\u6761|\u8865\u5145|\u5206\u6790|\u8bc1\u636e|\u65f6\u95f4\u7ebf|\u8bf4\u6e05\u695a|\u771f).*?\u5c01\u795e|\u5c01\u795e.*(?:\u5206\u6790|\u8bc1\u636e|\u8865\u5145|\u8bf4\u6e05\u695a)/u.test(cleanSample);
    return literalTitleContext && !praiseContext;
  }
  if (term === '\u795e\u4ed6\u5988' && family === 'attack') {
    const fandomJokeContext = /(?:\u54c8\u54c8.*\u795e\u4ed6\u5988|\u795e\u4ed6\u5988.*(?:\u50cf|\u642d|\u5f20\u7ff0|\u89d2\u8272|\u9020\u578b|\u8dd1\u6b65))/u.test(cleanSample);
    const directedMockContext = /(?:\u795e\u4ed6\u5988.*(?:\u903b\u8f91|\u8bc1\u636e|\u89c2\u70b9|\u8bf4\u6cd5|\u4f60)|(?:\u4f60|\u8fd9\u903b\u8f91|\u8fd9\u8bf4\u6cd5).*\u795e\u4ed6\u5988)/u.test(cleanSample);
    return fandomJokeContext && !directedMockContext;
  }
  if (term === '\u4e2d\u7cfb' && family === 'cooperation') {
    const fandomClassificationContext = /(?:\u611f\u89c9.*\u4e2d\u7cfb|kangta\u7cfb|\u53f8\u9a6c\u7537|\u4e24\u5927\u5206\u7c7b|\u6cf0\u5bb9|\u5728\u73b9)/iu.test(cleanSample);
    return fandomClassificationContext;
  }
  if (term === '\u8c01\u61c2' && family === 'evasion') {
    const fandomEmpathyContext = /(?:\u6709\u8c01\u61c2|\u8c01\u61c2\u554a).*(?:\u6211\u54ed\u6b7b|\u6211\u7684\u7b11\u70b9|\u597d\u597d\u7b11|\u8dd1\u6b65|\u5f39\u5e55|\u66f4\u50cf|\u89d2\u5ea6|\u82e5\u9690\u82e5\u73b0|\u90d1\u723d|\u50cf\u4e86|\u4e00\u70b9\u8fdb\u6765|\u51c6\u5907\u5f00\u59cb|\u9009\u724c)|(?:\u554a{2,}).{0,8}\u8c01\u61c2/u.test(cleanSample);
    const evasionContext = /(?:\u522b\u53ea\u8bf4\u8c01\u61c2|\u8c01\u61c2.*(?:\u4e0d\u89e3\u91ca|\u61c2\u7684\u90fd\u61c2|\u8bc1\u636e\u8d34\u51fa\u6765|\u81ea\u5df1\u641c))/u.test(cleanSample);
    return fandomEmpathyContext && !evasionContext;
  }
  if (term === '\u767e\u53d8\u9a6c\u4e01' && family === 'cooperation') {
    const nameOnlyContext = !cleanSample.includes('\u767e\u53d8\u9a6c\u4e01') && cleanSample.includes('\u9a6c\u4e01');
    const memeContext = /(?:\u767e\u53d8\u9a6c\u4e01|\u9a6c\u4e01).*(?:\u68d7|\u540d\u573a\u9762|\u7b11|\u592a\u5999|\u597d\u6d3b)/u.test(cleanSample);
    return nameOnlyContext && !memeContext;
  }
  if (['\u6211\u547d\u7531\u6211', '\u6211\u547d\u7531\u6211\u4e0d\u7531\u5929'].includes(term) && family === 'attack') {
    const standaloneSloganContext = /^\u6211\u547d\u7531\u6211(?:\u4e0d\u7531\u5929)?(?:doge)?$/iu.test(cleanSample);
    const hostileSloganContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u79cd|\u9634\u8c0b\u8bba|\u786c\u72b6|\u5634\u786c|\u63a5\u76d8).*\u6211\u547d\u7531\u6211|\u6211\u547d\u7531\u6211.*(?:\u5f0f|\u786c\u72b6|\u5634\u786c|\u9634\u8c0b\u8bba|\u63a5\u76d8|\u72c2\u5984)/u.test(cleanSample);
    return standaloneSloganContext && !hostileSloganContext;
  }
  if (['\u751f\u8349', '\u592a\u751f\u8349\u4e86'].includes(term) && family === 'attack') {
    const standaloneLaughContext = /^(?:\u592a)?\u751f\u8349\u4e86?(?:[!！。~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const looseLaughContext = /^(?:\u54c8)+[\uff0c,]?(?:\u8fc7\u4e8e|\u592a)?\u751f\u8349\u4e86?(?:[!！。~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const hostileLaughContext = /(?:\u4f60|\u4f60\u4eec|\u903b\u8f91|\u89c2\u70b9|\u8bf4\u6cd5|\u8fd9\u4e2a|\u8fd9\u79cd).*\u751f\u8349|\u751f\u8349.*(?:\u4e0d\u770b\u8bc1\u636e|\u79bb\u8c31|\u903b\u8f91|\u8bc1\u636e)/u.test(cleanSample);
    const playfulMediaContext = /(?:\u6f14\u5f97\u4e0d\u9519|\u738b\u8005\u8363\u8000\u4e16\u754c|\u5f39\u5e55\u90fd\u7b11|\u6280\u672f\u529b\u8fc7\u9ad8).{0,24}\u751f\u8349|\u751f\u8349.{0,24}(?:\u6f14\u5f97\u4e0d\u9519|\u7b11\u75af|\u6280\u672f\u529b)/u.test(cleanSample);
    return (standaloneLaughContext || looseLaughContext || playfulMediaContext) && !hostileLaughContext;
  }
  if (term === '\u65e0\u63a9\u4f53\u5e72\u62c9' && family === 'attack') {
    const literalGameContext = /^(?:\u65e0\u63a9\u4f53\u5e72\u62c9|.*(?:\u73a9\u6e38\u620f|\u4ec0\u4e48\u64cd\u4f5c|\u63a9\u4f53|\u5f00\u706b|\u67aa|fps).*\u65e0\u63a9\u4f53\u5e72\u62c9|.*\u65e0\u63a9\u4f53\u5e72\u62c9.*(?:\u73a9\u6e38\u620f|\u4ec0\u4e48\u64cd\u4f5c|\u63a9\u4f53|\u5f00\u706b|\u67aa|fps))/iu.test(cleanSample);
    const recklessMockContext = /(?:\u4f60|\u800c\u4f60|\u53ea\u77e5\u9053|\u6839\u672c\u4e0d\u770b|\u9c81\u83bd|\u65e0\u8111|\u5bf9\u9762\u8bf4).*\u65e0\u63a9\u4f53\u5e72\u62c9|\u65e0\u63a9\u4f53\u5e72\u62c9.*(?:\u6839\u672c\u4e0d\u770b|\u9c81\u83bd|\u65e0\u8111|\u5bf9\u9762\u8bf4)/u.test(cleanSample);
    return literalGameContext && !recklessMockContext;
  }
  if (term === '\u96c6\u7f8e' && family === 'cooperation') {
    const homophonePetMemeContext = /\u54c8\u96c6\u7f8e/u.test(cleanSample);
    const friendlyAddressContext = /\u96c6\u7f8e(?:\u4eec)?(?:\u522b\u5435|\u5148|\u4e00\u8d77|\u5e2e|[\uff0c,])/u.test(cleanSample);
    return homophonePetMemeContext && !friendlyAddressContext;
  }
  if (['\u4e0d\u674e\u59d0', '\u6211\u4e0d\u674e\u59d0'].includes(term) && family === 'attack') {
    const literalUnderstandingContext = /(?:\u4e0d\u7406\u89e3|\u6211\u4e0d\u7406\u89e3|\u4e0d\u662f\u4e0d\u7406\u89e3)/u.test(cleanSample);
    const mockContext = /(?:\u4e0d\u7406\u89e3|\u6211\u4e0d\u7406\u89e3).*(?:\u8fd9\u4e5f\u80fd\u6d17|\u8fd9\u4e5f\u80fd|\u79bb\u8c31|\u8352\u5510|\u8fd9\u79cd\u8bf4\u6cd5|\u4ec0\u4e48\u903b\u8f91|\uff1f)|(?:\u771f\u7684\u597d\u7b11|\u8fd9\u5c31).*?(?:\u4e0d\u7406\u89e3|\u6211\u4e0d\u7406\u89e3)/u.test(cleanSample);
    return literalUnderstandingContext && !mockContext;
  }
  if (['\u5355\u8d706', '\u5355\u8d70\u4e00\u4e2a6', '\u8d70\u4e00\u4e2a6'].includes(term)) {
    const suffixedTokenContext = /(?:\u5355\u8d70(?:\u4e00\u4e2a)?6|\u8d70\u4e00\u4e2a6)[a-z]+/iu.test(cleanSample);
    return suffixedTokenContext;
  }
  if (term === '\u9633\u5bff' && family === 'cooperation') {
    const hostileWasteContext = /(?:\u6d6a\u8d39|\u8017\u8d39|\u8981\u4f60\u547d|\u70e6\u4f60).{0,6}\u9633\u5bff|\u9633\u5bff.{0,6}(?:\u6d6a\u8d39|\u6ca1\u4e86)/u.test(cleanSample);
    const luckMemeContext = /(?:\u9700\u8981|\u4ebf\u70b9\u70b9|\u960e\u738b|\u8fd0\u6c14|\u6b27\u6c14|\u51fa\u8d27).*\u9633\u5bff|\u9633\u5bff.*(?:\u8fc7\u671f|\u6362|\u6c42|\u8fd0\u6c14|\u6b27\u6c14)/u.test(cleanSample);
    return hostileWasteContext && !luckMemeContext;
  }
  if (term === '\u81ea\u5df1\u5b66' && family === 'evasion') {
    const embeddedLearningContext = /(?:\u81ea\u5df1\u5b66(?:\u4e0d\u597d|\u4f1a|\u4e60|\u5de5\u6574)|\u5f3a\u8feb\u81ea\u5df1\u5b66|\u8ba9\u81ea\u5df1\u5b66)/u.test(cleanSample);
    const burdenShiftContext = /(?:\u4f60(?:\u81ea\u5df1\u5b66|\u81ea\u5df1\u641c|\u81ea\u5df1\u53bb\u5b66)|(?:\u522b\u95ee\u6211|\u61d2\u5f97\u6559).*\u81ea\u5df1\u5b66)/u.test(cleanSample);
    return embeddedLearningContext && !burdenShiftContext;
  }
  if (term === 'lsp' && family === 'attack') {
    const usernameOnlyContext = /^(?:\u56de\u590d)?lsp(?:\u7684|[a-z0-9]+).*?(?:\u55f7\u55f7|\u597d\u7684|\u8c22\u8c22|\u6536\u5230)?$/iu.test(cleanSample);
    const directedInsultContext = /(?:\u4f60|\u8fd9\u4e2a|\u522b|lsp.*(?:\u522b|\u6076\u5fc3|\u5237))/iu.test(cleanSample);
    return usernameOnlyContext && !directedInsultContext;
  }
  if (term === '\u963f\u7f8e\u8389\u5361' && family === 'attack') {
    const personalNameContext = /\u963f\u7f8e(?:\u5a5a\u540e|\u751f\u6d3b|\u8001\u5e08|\u540c\u5b66|\u59d0|\u54e5)/u.test(cleanSample);
    const americaContext = /(?:\u963f\u7f8e\u8389\u5361|\u7f8e\u56fd|\u7f8e\u5229\u575a|\u7f8e\u8054\u90a6|\u8d44\u672c\u4e3b\u4e49|\u6b27\u7f57\u5df4)/u.test(cleanSample);
    return personalNameContext && !americaContext;
  }
  if (term === '\u8c01\u5bb6\u5c0f\u5b69' && family === 'attack') {
    const childDefenseContext = /(?:\u8bf4\u5b69\u5b50.*\u592a\u8fc7\u5206|\u8c01\u5bb6\u5c0f\u5b69\u4e0d\u662f\u5b9d|\u5c0f\u5b69\u4e0d\u662f\u5b9d)/u.test(cleanSample);
    const mockChildishContext = /(?:\u8fd9|\u4f60|\u53c9\u51fa\u53bb|\u5e7c\u7a1a|\u5c0f\u5b66\u751f).*\u8c01\u5bb6\u5c0f\u5b69|\u8c01\u5bb6\u5c0f\u5b69.*(?:\u53c9\u51fa\u53bb|\u5e7c\u7a1a|\u5c0f\u5b66\u751f)/u.test(cleanSample);
    return childDefenseContext && !mockChildishContext;
  }
  if (term === '\u7ec6\u8282\u53e5\u53f7' && family === 'attack') {
    const levelTitleContext = /^(?:\u7b2c[一二三四五六七八九十\d]+\u5173|\u5173\u5361|\u6807\u9898).*\u7ec6\u8282\u53e5\u53f7/u.test(cleanSample);
    const nitpickContext = /(?:\u56de\u590d|@|\u4f60|\u7ec6\u8282\u5934\u50cf|\u7ec6\u8282).*\u7ec6\u8282\u53e5\u53f7|\u7ec6\u8282\u53e5\u53f7.*(?:\u5934\u50cf|\u86cb\u4ed4|\u6293\u7ec6\u8282)/u.test(cleanSample);
    return levelTitleContext && !nitpickContext;
  }
  if (term === '\u6211\u6d3b\u5230\u5934\u4e86' && family === 'cooperation') {
    const standaloneReactionContext = /^(?:\uff1f)?\u6211\u6d3b\u5230\u5934\u4e86(?:\uff1f)?$/u.test(cleanSample);
    const concessionContext = /(?:\u4f60\u8bf4\u5f97\u5bf9|\u6211\u6536\u56de|\u8fd9\u70b9|\u627f\u8ba4|\u9519\u4e86).*\u6211\u6d3b\u5230\u5934\u4e86|\u6211\u6d3b\u5230\u5934\u4e86.*(?:\u6211\u6536\u56de|\u627f\u8ba4|\u9519\u4e86|\u8fd9\u70b9)/u.test(cleanSample);
    return standaloneReactionContext && !concessionContext;
  }
  if (term === '\u6211\u771f\u7ef7\u4e0d\u4f4f' && family === 'attack') {
    const standaloneLaughContext = /^(?:\u54c8)+\u6211\u771f\u7ef7\u4e0d\u4f4f\u4e86?$/u.test(cleanSample) || /^\u6211\u771f\u7ef7\u4e0d\u4f4f\u4e86?$/u.test(cleanSample);
    const targetedMockContext = /(?:\u4f60|\u8fd9\u4e2a|\u903b\u8f91|\u8bc1\u636e|\u4f55\u610f\u5473|\u544a\u8bc9\u6211).*\u6211\u771f\u7ef7\u4e0d\u4f4f|\u6211\u771f\u7ef7\u4e0d\u4f4f.*(?:\u8bc1\u636e|\u903b\u8f91|\u4f55\u610f\u5473|\u544a\u8bc9\u6211|\u53eb\u53e3\u6c34\u6b4c)/u.test(cleanSample);
    return standaloneLaughContext && !targetedMockContext;
  }
  if (family === 'attack' && /(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f)/u.test(cleanSample)) {
    const videoTitleContext = isVideoContextSample(sample);
    const looseReactionContext = /^(?:(?:[\p{Script=Han}]{0,4})|(?:6{2,}|hhh|www))?[\s\uff0c,]*(?:\u6ca1\u7ef7\u4f4f|\u7ef7\u4e0d\u4f4f\u4e86?)$/iu.test(cleanSample);
    const mediaOrMathReactionContext = /(?:\u7b11\u8bdd|\u8f7b\u677e|\u52a8\u4f5c|\u5fae\u5206|\u7b26\u53f7).*(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f)|(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f).*(?:\u7b11\u8bdd|\u8f7b\u677e|\u52a8\u4f5c|\u5fae\u5206|\u7b26\u53f7|\u559c\u6b22)/u.test(cleanSample);
    const expressionReactionContext = videoTitleContext || looseReactionContext || mediaOrMathReactionContext || /(?:\u6211|\u5bf9\u4e0d\u8d77|\u8868\u60c5|\u7b11|\u54ed|\u597d\u61a8|\u6ca1\u7ef7\u4f4f|\u53d1\u4e2a\u5206p\u89c6\u9891|\u7c89\u624d\u914d).*(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f)|(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f).*(?:\u6211|\u8868\u60c5|\u7b11|\u54ed|\u597d\u61a8|\u53d1\u4e2a\u5206p\u89c6\u9891|\u7c89\u624d\u914d)/u.test(cleanSample);
    const targetedMockContext = /(?:\u4f60|\u8fd9\u903b\u8f91|\u8bc1\u636e|\u8fd9\u8bdd|\u8fd9\u64cd\u4f5c).*(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f)|(?:\u7ef7\u4e0d\u4f4f|\u6ca1\u7ef7\u4f4f).*(?:\u8bc1\u636e|\u903b\u8f91|\u79bb\u8c31)/u.test(cleanSample);
    return expressionReactionContext && !targetedMockContext;
  }
  if (term === '800\u4e07' && family === 'evidence') {
    const audienceCountContext = /(?:\u8d85|\u8d85\u8fc7|\u7a81\u7834)?800\u4e07(?:\u4eba|\u7528\u6237|\u89c2\u4f17|\u7c89\u4e1d|\u64ad\u653e)|(?:\u8d85|\u8d85\u8fc7|\u7a81\u7834)800\u4e07/u.test(cleanSample);
    const gameValueContext = /(?:800\u4e07.*(?:\u6e38\u620f|\u522b\u5885|\u4f4f\u5b85|\u6bd5\u4e1a|\u623f\u4ea7|\u6e38\u620f\u5e01|\u739b\u95e8)|(?:\u6e38\u620f|\u522b\u5885|\u4f4f\u5b85|\u6bd5\u4e1a|\u623f\u4ea7|\u6e38\u620f\u5e01|\u739b\u95e8).*800\u4e07)/u.test(cleanSample);
    return audienceCountContext && !gameValueContext;
  }
  if (term === '\u8349\u751f' && family === 'cooperation') {
    const literalGrassContext = /(?:\u62cd|\u5272|\u79cd|\u957f|\u8e29|\u770b|\u90a3\u4e2a).{0,6}\u8349(?:\u554a|\u5730|\u576a|\u4e1b|\u539f)?/u.test(cleanSample);
    const hostileComplaintContext = /(?:\u4e0d\u770bVAR|\u5fc5\u987b\u5f97\u770b|\u771f\u8349\u4e86|\u6211\u8349\u4e86|\u7ed9\u6211\u5c01\u4e86|\u4e0d\u957f\u8111\u5b50)/iu.test(cleanSample);
    const playfulLaughContext = /(?:\u8349\u751f|\u592a\u8349\u751f|\u8f6c\u573a|\u70ed\u8bcd|\u54c8\u54c8|\u7b11)/u.test(cleanSample);
    const standaloneContext = cleanSample === '\u8349\u751f' || cleanSample === '\u8349\u4e86';
    const looseAliasContext = /(?:\u6f14\u5f97\u4e0d\u9519|\u738b\u8005\u8363\u8000\u4e16\u754c).{0,24}\u751f\u8349|\u63e1\u8349/u.test(cleanSample);
    const usefulPlayfulContext = /\u8f6c\u573a.{0,12}\u8349\u751f|\u8349\u751f.{0,12}\u8f6c\u573a/u.test(cleanSample);
    return ((literalGrassContext || hostileComplaintContext) && !playfulLaughContext)
      || ((standaloneContext || looseAliasContext) && !usefulPlayfulContext);
  }
  if (term === 'up\u597d\u725b' && family === 'cooperation') {
    const genericPraiseContext = /^\u54c7\s*up\u597d\u725b(?:\s*\u52a0\u6cb9\u52a0\u6cb9)?$/iu.test(cleanSample);
    const usefulCreatorContext = /(?:\u8d44\u6599|\u6574\u7406|\u6559\u7a0b|\u5206\u4eab|\u8bc1\u636e|\u6765\u6e90|\u5206\u6790).{0,18}up\u597d\u725b|up\u597d\u725b.{0,18}(?:\u8d44\u6599|\u6574\u7406|\u6559\u7a0b|\u5206\u4eab|\u8bc1\u636e|\u6765\u6e90|\u5206\u6790)/iu.test(cleanSample);
    if (genericPraiseContext && !usefulCreatorContext) return true;
  }
  if (term === '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708' && family === 'attack') {
    const videoTitleContext = isVideoContextSample(sample);
    const titleOnlyContext = /^(?:\u300a)?(?:\u6ca1\u6d3b\u8fc7|\u6d3b\u4e0d\u8fc7|\u6491\u4e0d\u8fc7)(?:\u4e24\u4e2a\u6708|\u4fe9\u6708)(?:\u300b)?$/u.test(cleanSample);
    const lifespanMockContext = /(?:\u70ed\u5ea6|\u8d26\u53f7|\u8fd9\u6d3b|\u957f\u7ea2|\u9879\u76ee|\u724c\u5b50).*(?:\u6ca1\u6d3b\u8fc7|\u6d3b\u4e0d\u8fc7)(?:\u4e24\u4e2a\u6708|\u4fe9\u6708)|(?:\u6ca1\u6d3b\u8fc7|\u6d3b\u4e0d\u8fc7)(?:\u4e24\u4e2a\u6708|\u4fe9\u6708).*(?:\u8fd8\u88c5|\u51c9\u4e86|\u70ed\u5ea6|\u957f\u7ea2)/u.test(cleanSample);
    return (videoTitleContext || titleOnlyContext) && !lifespanMockContext;
  }
  if (term === '\u6807\u51c6\u7ed3\u5c40' && family === 'cooperation') {
    const hotWordWrapperContext = /\[\u70ed\u8bcd\u7cfb\u5217[_-]\u6807\u51c6\u7ed3\u5c40\]/u.test(String(sample || ''));
    const textOutsideEmotes = String(sample || '').replace(/\[[^\]]+\]/g, '');
    const standaloneContext = cleanSample === '\u6807\u51c6\u7ed3\u5c40';
    const sourceExplanationContext = /\u6807\u51c6\u7ed3\u5c40.*(?:\u662f.*\u6897|\u4e0d\u77e5\u9053|\u51fa\u81ea|\u6765\u6e90|JOJO)/iu.test(cleanSample);
    const summaryContext = /(?:\u8fd9(?:\u624d|\u5c31)\u662f|\u7b97\u662f|\u6700\u540e|\u5148.*\u518d).*\u6807\u51c6\u7ed3\u5c40|\u6807\u51c6\u7ed3\u5c40.*(?:\u6ca1\u6bdb\u75c5|\u603b\u7ed3|\u8def\u7ebf)/u.test(cleanSample);
    return (standaloneContext || sourceExplanationContext || (hotWordWrapperContext && !textOutsideEmotes.includes('\u6807\u51c6\u7ed3\u5c40'))) && !summaryContext;
  }
  if (term === '\u5c4f\u853d' && family === 'cooperation') {
    const literalTechnicalContext = /(?:\u96f7\u8fbe|\u6742\u6ce2|\u53cd\u5c04\u9762|\u4fe1\u53f7|\u566a\u58f0|\u7535\u78c1).*\u5c4f\u853d|\u5c4f\u853d.*(?:\u96f7\u8fbe|\u6742\u6ce2|\u4fe1\u53f7|\u566a\u58f0)/u.test(cleanSample);
    const platformModerationContext = /(?:\u8bc4\u8bba\u533a\u5c4f\u853d|\u5c4f\u853d\u8bcd|\u5c4f\u853d\u5173\u952e\u5b57|\u5c4f\u853d\u811a\u672c|\u81ea\u52a8\u5316\u5c4f\u853d|\u5c4f\u853d\u8bc4\u8bba|\u5c4f\u853d\u7528\u6237|\u5c4f\u853d\u5217\u8868|\u5c4f\u853d\u90a3\u51e0\u4e2a|\u5c4f\u853d.*up|\u5c4f\u853d\u5668|\u5c4f\u853d\u6309\u952e|\u5c4f\u853d\u4e86|\u88ab\u5c4f\u853d\u6389|\u628a\u4eba\u7ed9\u5c4f\u853d|\u770b\u4e0d\u5230\u4ed6\u7684\u4fe1\u606f)/iu.test(cleanSample);
    const constructiveBlockContext = /(?:\u5148\u5c4f\u853d|\u5c4f\u853d).*(?:\u4eba\u8eab\u653b\u51fb|\u9a82\u4eba|\u5e7f\u544a|\u5f39\u5e55|\u518d\u8ba8\u8bba|\u597d\u597d\u8ba8\u8bba)/u.test(cleanSample);
    return (literalTechnicalContext || platformModerationContext) && !constructiveBlockContext;
  }
  if (term === '\u524d\u9762\u8bf4\u91cd\u4e86' && family === 'correction') {
    const thirdPartyWrongContext = /(?:up\u4e3b\u8bf4\u9519\u4e86|\u4f60\u5f97\u8bf4\u900f\u660e\u70b9.{0,24}\u8bf4\u9519\u4e86\u4f60\u4e0d\u9ad8\u5174|\u4f60\u8fd9\u53e5\u8bdd\u5c31\u8bf4\u9519\u4e86\u5417|\u8bf4\u9519(?:\u4e86|\u8bdd\u4e86|\u8bdd).*(?:\u662f|\u6362\u4e2a\u53f7|\u4f60\u77e5\u9053\u4ed6\u662f\u8c01|\u82f1\u7f8e\u6218\u4e89|\u5766\u514b|\u4e0d\u662f|\u6ca1\u6709\u6279\u8bc4|\u6d3b\u6b7b\u4eba|\u540e\u679c)|\u4ee5\u4e3a\u6211\u8bf4\u9519\u8bdd\u4e86|\u4e00\u7d27\u5f20.*\u8bf4\u9519\u8bdd|\u4e2d\u95f4.*\u8bf4\u9519\u4e86|\u6709\u4e00\u53e5\u8bdd\u8bf4\u9519\u4e86|\u786e\u5b9e\u8bf4\u9519\u4e86|\u56de\u590d.*\u8bf4\u9519\u4e86|\u5982\u679c\u8bf4\u9519\u4e86|\u54ea\u8bf4\u9519\u4e86|\u8c01\u8bf4\u9519\u4e86|\u6ca1\u8bf4\u9519|\u6ca1\u6709\u4e00\u4e2a\u5b57\u8bf4\u9519|\u4e0d\u6562\u8bf4\u91cd\u4e86)/iu.test(cleanSample);
    const selfCorrectionContext = /(?:\u524d\u9762\u8bf4\u91cd\u4e86|\u6211\u8bf4\u91cd\u4e86|\u521a\u624d\u8bf4\u91cd\u4e86|\u6211\u6536\u56de|\u6211\u8bf4\u9519\u4e86).*(?:\u6211\u6536\u56de|\u6539\u4e00\u4e0b|\u66f4\u6b63|\u4fee\u6b63)/u.test(cleanSample);
    return thirdPartyWrongContext && !selfCorrectionContext;
  }
  if (['\u8bf4\u9519', '\u8bf4\u9519\u4e86'].includes(term) && family === 'correction') {
    const negatedWrongContext = /(?:\u6ca1\u8bf4\u9519|\u6ca1\u6709\u8bf4\u9519|\u6ca1\u6709\u4e00\u4e2a\u5b57\u8bf4\u9519|\u4e0d\u7b97\u8bf4\u9519)/u.test(cleanSample);
    const thirdPartyWrongSpeechContext = /(?:\u77e5\u9053\u8bf4\u9519\u8bdd|\u8bf4\u9519\u8bdd\u7684\u540e\u679c|\u7d27\u5f20.{0,12}\u8bf4\u9519\u8bdd|\u8ba4\u9519\u4eba.{0,12}\u8bf4\u9519\u8bdd)/u.test(cleanSample);
    const selfCorrectionContext = /(?:\u6211(?:\u521a\u624d|\u524d\u9762|\u8fd9\u91cc)?|\u524d\u9762|\u521a\u624d).{0,4}\u8bf4\u9519(?:\u4e86)?|\u8bf4\u9519(?:\u4e86)?.{0,12}(?:\u6211\u6536\u56de|\u6539\u4e00\u4e0b|\u66f4\u6b63|\u4fee\u6b63)/u.test(cleanSample);
    return (negatedWrongContext || thirdPartyWrongSpeechContext) && !selfCorrectionContext;
  }
  if (term === '\u6211\u7684\u95ee\u9898' && family === 'correction') {
    const questionSubstringContext = !cleanSample.includes('\u6211\u7684\u95ee\u9898') && /(?:\u95ee\u4e86\u4e00\u4e0b|\u6211.{0,8}\u95ee|(?:\u95ee\u9898|\u611f\u53d7).{0,8}\u6211)/u.test(cleanSample);
    const selfFaultContext = /(?:\u6211\u7684\u95ee\u9898|\u662f\u6211.{0,8}(?:\u95ee\u9898|\u9519|\u758f\u5ffd)|\u6211.{0,8}(?:\u770b\u9519|\u641e\u9519|\u8bb0\u9519|\u5f04\u9519|\u9519\u4e86))/u.test(cleanSample);
    return questionSubstringContext && !selfFaultContext;
  }
  if (term === '\u6b63\u9053\u7684\u5149' && family === 'attack') {
    const praiseOrStandaloneContext = /^(?:\u6b63\u9053\u7684\u5149[\u3002.!\uff01\s]*)$/u.test(cleanSample)
      || /(?:\u6211\u76f4\u547c\u4f60\u662f\u6b63\u9053\u7684\u5149|\u4f60\u662f\u6b63\u9053\u7684\u5149|\u597d\u5bb6\u4f19.*\u6b63\u9053\u7684\u5149)/u.test(cleanSample);
    const mockSelfRighteousContext = /(?:\u5305\u88c5\u6210|\u81ea\u8be9|\u88c5\u6210|\u522b\u628a\u81ea\u5df1).{0,12}\u6b63\u9053\u7684\u5149|\u6b63\u9053\u7684\u5149.{0,12}(?:\u6263\u5e3d\u5b50|\u8bdd\u672f|\u6d17\u5730|\u88c5)/u.test(cleanSample);
    return praiseOrStandaloneContext && !mockSelfRighteousContext;
  }
  if (term === '\u56e2\u706d\u590d\u4ec7\u8005\u8054\u76df' && family === 'cooperation') {
    const plotSummaryContext = /(?:\u590d\u4ec7\u8005|\u7f8e\u961f|\u5b9d\u77f3|\u6b63\u7247|\u5267\u60c5|\u4e3b\u8981\u539f\u56e0|\u8d2a\u4e8e\u4eab\u4e50|\u77e5\u9053\u81ea\u5df1\u8fd9\u8fb9\u7684\u60c5\u51b5)/u.test(cleanSample);
    return plotSummaryContext;
  }
  if (term === 'xswl' && family === 'attack') {
    const mediaReactionContext = /(?:xswl(?:\u5b9d\u77f3|\u7f8e\u961f|\u4e3a\u4ec0\u4e48|\u6d88\u5931)|(?:\u5b9d\u77f3|\u7f8e\u961f|\u590d\u4ec7\u8005|剧情|正片).*xswl)/iu.test(cleanSample);
    const directedMockContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u903b\u8f91|\u8fd9\u8bdd|\u8bc1\u636e|\u53cd\u9a73|\u786c\u62ac|xswl.*(?:\u4f60|\u903b\u8f91|\u8bc1\u636e))/iu.test(cleanSample);
    return !directedMockContext || mediaReactionContext;
  }
  if (term === '\u6cea\u76ee' && family === 'cooperation') {
    const mediaReactionContext = cleanSample === '\u6cea\u76ee' || /(?:\u6cea\u76ee.*(?:\u6b63\u7247|\u8fd9\u6bb5|\u5267\u60c5|\u7247\u6bb5|\u89c6\u9891|\u7535\u5f71|\u89d2\u8272)|(?:\u6b63\u7247|\u8fd9\u6bb5|\u5267\u60c5|\u7247\u6bb5|\u89c6\u9891|\u7535\u5f71|\u89d2\u8272).*\u6cea\u76ee)/u.test(cleanSample);
    const supportiveContext = /(?:\u613f\u610f|\u8865\u5145|\u6570\u636e|\u8bc1\u636e|\u6539\u7ed3\u8bba|\u8ba4\u9519|\u4fee\u6b63|\u8c22\u8c22|\u7406\u6027).*?\u6cea\u76ee|\u6cea\u76ee.*(?:\u613f\u610f|\u8865\u5145|\u6570\u636e|\u8bc1\u636e|\u6539\u7ed3\u8bba|\u8ba4\u9519|\u4fee\u6b63|\u8c22\u8c22|\u7406\u6027)/u.test(cleanSample);
    return mediaReactionContext && !supportiveContext;
  }
  if (term === '\u57c3\u53ca\u5427' && family === 'evasion') {
    const literalEgyptContext = /(?:\u57c3\u53ca\u5427(?:\u56de\u4e0d\u56de\u5f52|\u56de\u5f52)|\u57c3\u53ca\u5427.*\u6709\u9aa8\u6c14|\u57c3\u53ca|\u56de\u5f52)/u.test(cleanSample);
    const dismissiveSearchContext = /(?:\u81ea\u5df1\u53bb\u57c3\u53ca\u5427|\u95ee\u57c3\u53ca\u5427|\u53bb\u57c3\u53ca\u5427\u627e|\u4e0d\u89e3\u91ca.*\u57c3\u53ca\u5427)/u.test(cleanSample);
    return literalEgyptContext && !dismissiveSearchContext;
  }
  if (term === '\u522e\u75e7' && family === 'attack') {
    const therapyContext = /(?:\u6881\u5bb6\u8f89|\u513f\u5b50|\u5916\u56fd\u4eba|\u8650\u5f85\u513f\u7ae5|\u6cd5\u5b98|\u4e2d\u56fd\u7597\u6cd5|\u7597\u6cd5|\u4e2d\u533b|\u7406\u7597|\u517b\u751f|\u8212\u670d|\u522e\u75e7\u677f|\u62d4\u7f50|\u7ecf\u7edc|\u53bb\u6e7f|\u80a9\u9888|\u63a8\u62ff)/u.test(cleanSample);
    const attackContext = /(?:\u6253\u7684|\u6253\u5f97|\u4f24\u5bb3|\u8f93\u51fa|\u7834\u9632|\u6389\u8840|\u8840\u6761|\u4f4e\u4f24|\u96be\u6253|\u6253\u4e0d\u52a8|\u5e08\u5085\u522b\u522e|\u8ddf\u522e\u75e7\u4e00\u6837|\u50cf\u522e\u75e7|\u6307\u4f24\u5bb3)/u.test(cleanSample);
    return therapyContext && !attackContext;
  }
  if (term === '\u9ec4\u9cdd' && family === 'attack') {
    const literalFoodOrBiologyContext = /(?:\u600e\u4e48\u505a|\u505a\u597d\u5403|\u597d\u5403|\u751f\u7269\u79d1\u666e|\u79d1\u666e|\u98df\u6750|\u6c34\u4ea7|\u517b\u6b96|\u70f9\u996a|\u7ea2\u70e7|\u7206\u7092|\u9910\u684c|\u83dc\u5e02\u573a|\u6ce5\u9cc5)/u.test(cleanSample);
    const controversyContext = /(?:\u9ec4\u9cdd\u95e8|\u5b50\u5bab|\u9634\u9053|\u585e|\u7a7f\u6765\u7a7f\u53bb|\u65e0\u8f9c|\u4e8b\u4ef6|\u74dc)/u.test(cleanSample);
    return literalFoodOrBiologyContext && !controversyContext;
  }
  if (term === '\u6840\u6840\u6840' && family === 'attack') {
    const sourceDiscussionContext = /(?:\u6700\u65e9|\u89c1\u8fc7|\u51fa\u81ea|\u6765\u6e90|\u539f\u6587|\u539f\u8457|\u5c0f\u8bf4|\u767d\u9a6c\u5578\u897f\u98ce|\u8fd9\u4e2a\u8bcd|\u8fd9\u4e2a\u6840\u6840\u6840)/u.test(cleanSample);
    const attackContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6\u4eec|\u7ee7\u7eed|\u6025|\u7834\u9632|\u5c31\u8fd9|\u4e0d\u4f1a\u5427|\u7b11\u6b7b|\u8e66\u8df6)/u.test(cleanSample);
    return sourceDiscussionContext && !attackContext;
  }
  if (term === '\u8001\u516d' && family === 'attack') {
    const benignTitleOrPraiseContext = /(?:top\d+|\u5927\u660e\u8001\u516d|\u4e94\u5237|\u597d\u770b|\u592a\u597d\u770b|\u5b9e\u5728\u662f|\u89d2\u8272|\u4e3b\u89d2|\u7247\u540d|\u5267\u540d|\u8fd9\u90e8|\u8fd9\u96c6|\u8865\u756a)/iu.test(cleanSample);
    const attackContext = /(?:\u771f\u8001\u516d|\u53c8\u8001\u516d|\u9634\u4eba|\u5077\u88ad|\u8e72\u8349|\u8e72\u5751|\u5751\u4eba|\u641e\u5077\u88ad|\u80cc\u523a|\u6076\u5fc3|\u6025|\u7834\u9632|\u641e\u5fc3\u6001)/u.test(cleanSample);
    return benignTitleOrPraiseContext && !attackContext;
  }
  if (term === '\u8d4c\u5f92\u5fc3\u7406' && family === 'attack') {
    const selfGachaContext = /(?:\u6211|\u81ea\u5df1).{0,12}(?:\u62bd\u5361|\u62bd|card|gacha)|(?:\u62bd\u5361|\u4e0b\u4e00\u53d1|\u5fc5\u51fa|\u51fa\u8d27|\u4fdd\u5e95)/iu.test(cleanSample);
    const hostileReasoningContext = /(?:\u5178\u578b|\u8fd9\u5c31\u662f|\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u4ed6\u4eec|\u5979\u4eec|\u6d17\u5730|\u903b\u8f91|\u5f3a\u76d7|\u72e1\u8fa9|\u8fa9\u62a4|\u53cd\u566c|\u5c48\u670d|\u8f93\u4e86|\u8d62\u4e86).{0,16}\u8d4c\u5f92\u5fc3\u7406|\u8d4c\u5f92\u5fc3\u7406.{0,20}(?:\u6d17\u5730|\u903b\u8f91|\u5f3a\u76d7|\u72e1\u8fa9|\u8fa9\u62a4|\u53cd\u566c|\u5c48\u670d|\u8f93\u4e86|\u8d62\u4e86)/u.test(cleanSample);
    return selfGachaContext && !hostileReasoningContext;
  }
  if (['\u5927\u610f\u4e86', '\u5927\u610f\u4e86\u6ca1\u6709\u95ea'].includes(term) && family === 'attack') {
    const selfQuoteMemeContext = /(?:\u6211\u5f53\u65f6|\u6211\u90a3\u65f6|\u5f53\u65f6\u6211).{0,8}\u5927\u610f\u4e86.{0,8}(?:\u6ca1\u6709|\u6ca1|\u6ca1\u5e26)?\u95ea|(?:\u6ca1\u5e26\u95ea|\u6ca1\u6709\u95ea).{0,8}(?:doge|\u6253call|\u7b11\u54ed|\u5403\u74dc)/iu.test(cleanSample);
    const hostileCarelessContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u4ed6\u4eec|\u5979\u4eec|\u8fd9\u6ce2|\u5c31\u662f).{0,12}\u5927\u610f\u4e86|\u5927\u610f\u4e86.{0,18}(?:\u6253\u7206|\u786c\u6d17|\u7ffb\u8f66|\u88ab\u4eba|\u8f93\u4e86|\u522b\u6d17)/u.test(cleanSample);
    return selfQuoteMemeContext && !hostileCarelessContext;
  }
  if (term === '\u5f3a\u56fd' && family === 'attack') {
    const literalPowerhouseContext = /(?:\u9009\u7f8e\u5f3a\u56fd|\u4f53\u80b2\u5f3a\u56fd|\u79d1\u6280\u5f3a\u56fd|\u5236\u9020\u5f3a\u56fd|\u5de5\u4e1a\u5f3a\u56fd|\u519b\u4e8b\u5f3a\u56fd|\u88ab\u89c6\u4e3a|\u66fe\u56db\u6b21|\u51a0\u519b|\u73af\u7403\u5c0f\u59d0)/u.test(cleanSample);
    const attackContext = /(?:\u68d2\u5b50|\u4e16\u754c\u7b2c\u4e00|\u8df3\u51fa\u6765|\u4f60\u4eec|\u5439|\u6025|\u7834\u9632|\u5c31\u8fd9|\u4e0d\u4f1a\u5427|\u7b11\u6b7b|\u8d62\u9ebb)/u.test(cleanSample);
    return literalPowerhouseContext && !attackContext;
  }
  if (term === '\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57' && family === 'attack') {
    const literalTextContext = /(?:\u533b\u53e4\u6587|\u6559\u6750|\u5e8f\u8a00|\u6f2b\u753b|\u4e66|\u539f\u6587|\u6587\u732e|\u5b57\u5e55|\u53f0\u7248|\u6e2f\u7248).{0,16}\u5168\u662f\u7e41\u4f53\u5b57|\u5168\u662f\u7e41\u4f53\u5b57.{0,16}(?:\u6559\u6750|\u6f2b\u753b|\u4e66|\u539f\u6587|\u6587\u732e|\u5b57\u5e55|\u53f0\u7248|\u6e2f\u7248)/u.test(cleanSample);
    const uploaderAttackContext = /(?:up|\u89c6\u9891|\u53d1|b\u7ad9|\u963fb|\u9999\u6e2f\u4eba|\u9a97|\u77ed\u89c6\u9891).{0,20}\u7e41\u4f53\u5b57|\u53d1\u7684\u89c6\u9891\u5168\u662f\u7e41\u4f53\u5b57/u.test(cleanSample);
    return literalTextContext && !uploaderAttackContext;
  }
  if (term === '\u9885\u5185\u9ad8\u6f6e' && family === 'attack') {
    const literalAsmrContext = /(?:asmr|\u52a9\u7720|\u542c|\u6ca1\u9885\u5185\u9ad8\u6f6e\u8fc7|\u8fd8\u80fd\u5e72\u8fd9\u4e2a|\u751f\u7406|\u611f\u53d7|\u8033\u6735|\u8033\u673a)/iu.test(cleanSample);
    const attackContext = /(?:\u81ea\u6211\u611f\u52a8|\u8f93\u51fa|\u4ed6\u4eec|\u4f60\u4eec|\u53c8|\u771f\u662f|\u770b\u8fd9\u6bb5|\u6025|\u7834\u9632|\u5439|\u8d62\u9ebb)/u.test(cleanSample);
    return literalAsmrContext && !attackContext;
  }
  if (term === '\u514d\u6b7b\u91d1\u724c' && family === 'evasion') {
    const literalGameItemContext = /(?:\u65b0\u602a|\u602a|\u89e6\u53d1|\u672c\u4f53|\u5206\u88c2|\u653b\u51fb|\u4f24\u5bb3|\u4e00\u6ef4\u8840|\u4e0d\u4f1a\u4f4e\u4e8e|\u81f4\u547d\u4f24\u5bb3|\u6280\u80fd|\u9053\u5177|\u6e38\u620f)/u.test(cleanSample);
    const evasionContext = /(?:\u5f53\u514d\u6b7b\u91d1\u724c|\u62ff.*\u514d\u6b7b\u91d1\u724c|\u8001\u7c89|\u8eab\u4efd|\u7279\u6743|\u8be5\u9a82|\u4e0d\u80fd\u9a82|\u62a4\u8eab\u7b26|\u7f6a\u4e0d\u81f3\u6b64)/u.test(cleanSample);
    return literalGameItemContext && !evasionContext;
  }
  if (term === '\u4e5e\u4e10' && family === 'attack') {
    const literalBeggarContext = /(?:\u771f\u4e5e\u4e10|\u4e5e\u8ba8|\u4e8c\u7ef4\u7801|\u540c\u60c5|\u96f6\u94b1|\u5e2e\u52a9|\u7ed9\u4e5e\u4e10|\u8def\u8fb9|\u626b\u7801|\u624b\u673a\u652f\u4ed8)/u.test(cleanSample);
    const attackContext = /(?:\u50cf\u4e5e\u4e10|\u4e5e\u4e10\u4e00\u6837|\u8ba8\u798f\u5229|\u8981\u996d|\u5230\u5904\u8981|\u4f38\u624b\u8981|\u522b\u518d|\u53c8\u6765\u8981)/u.test(cleanSample);
    return literalBeggarContext && !attackContext;
  }
  if (term === '\u9a97\u70ae' && family === 'evasion') {
    const literalGameShotContext = /(?:\u4fa7\u540e|\u8c22\u91cc\u767b|\u70ae\u7ebf|\u70ae\u5f39|\u5f00\u70ae|\u5766\u514b|\u6218\u8f66|\u4e09\u79cd\u9a97\u70ae|\u9a97\u70ae\u65b9\u5f0f|\u5356\u5934|\u5356\u4fa7)/u.test(cleanSample);
    const sexualDeceptionContext = /(?:\u81ea\u613f|\u7ea6|\u604b\u7231|\u611f\u60c5|\u7761|\u4e0a\u5e8a|\u6e23\u7537|\u6e23\u5973|\u9a97\u611f\u60c5|\u70ae\u53cb)/u.test(cleanSample);
    return literalGameShotContext && !sexualDeceptionContext;
  }
  if (term === '\u5165\u5173' && family === 'attack') {
    const literalCustomsContext = /(?:\u8fb9\u68c0|\u6d77\u5173|\u901a\u5173|\u5165\u5883|\u51fa\u5883|\u62a4\u7167|\u7b7e\u8bc1|\u65c5\u6e38|\u673a\u573a|\u8bfb\u5fc3\u672f|\u624d\u66b4\u9732)/u.test(cleanSample);
    const memeContext = /(?:\u5165\u5173\u5b66|\u7ea2\u79cb\u88e4|\u8d62\u5b66|\u5e3d\u5b50\u59d0|\u641e\u6b7b|\u4eba\u4eba\u6709\u5173\u5165|\u5efa\u5dde|\u5927\u6e05|\u6ee1\u6e05|\u5173\u5916)/u.test(cleanSample);
    return literalCustomsContext && !memeContext;
  }
  if (term === '\u5165\u53e3\u5373\u5316' && family === 'attack') {
    const literalFoodContext = /(?:\u723d\u6ed1|\u5f39\u7259|\u7f8e\u98df|\u597d\u5403|\u53e3\u611f|\u7ec6\u817b|\u9165|\u725b\u8089|\u9a74\u8089|\u6994\u83b2|\u70b8\u7cd5|\u73ed\u621f|\u83dc|\u70e7|\u996d|\u751c\u54c1|\u5976\u6cb9)/u.test(cleanSample);
    const mockeryContext = /(?:\u5927\u4fbf|\u5fc3\u75bc\u5979\u8001\u516c|\u53cd\u6b63\u90fd\u5df2\u7ecf\u7f5a\u4e86|\u7279\u70e6|\u53ea\u6709\u4e00\u4e2a\u8bcd|\u6ee5\u7528|\u9634\u9633)/u.test(cleanSample);
    return literalFoodContext && !mockeryContext;
  }
  if (term === '\u745e\u601d\u62dc' && family === 'cooperation') {
    const wordExplanationContext = /(?:\u6211\u4ee5\u4e3a.*\u53eb\u745e\u601d\u62dc|\u6709\u4eba\u59d3\u745e|\u6768\u601d\u745e|\u73b0\u5728\u624d\u77e5\u9053\u8fd9\u4e2a\u6897|\u8fd9\u4e2a\u6897|\u5199\u745e\u601d\u62dc)/u.test(cleanSample);
    const praiseContext = /(?:\u5320\u4eba\u7cbe\u795e|\u9760\u81ea\u5df1\u52aa\u529b|\u5f97\u5230\u4e86\u745e\u601d\u62dc|\u771f\u745e\u601d\u62dc|\u503c\u5f97\u745e\u601d\u62dc|\u592a\u5f3a\u4e86|\u4f69\u670d|\u5c0a\u91cd|respect)/iu.test(cleanSample);
    return wordExplanationContext && !praiseContext;
  }
  if (term === '\u5173\u6ce8\u529b' && family === 'cooperation') {
    const nameSubstringContext = /\u5173\u6ce8\u529b\u5143\u541b/u.test(cleanSample);
    const supportContext = /\u5173\u6ce8\u529b(?:$|[\s\[\uff0c,。！？!?:：])/u.test(cleanSample);
    return nameSubstringContext && !supportContext;
  }
  if (term === '\u4e0a\u6811' && family === 'cooperation') {
    const literalTreeContext = /(?:\u5154\u5b50\u4e0a\u6811|\u7f8a\u4e3a\u4ec0\u4e48\u4f1a\u4e0a\u6811|\u88ab.*\u521b\u4e0a\u6811|\u722c\u4e0a\u6811|\u5728\u6811\u4e0a|\u6751\u957f\u4e0a\u6811\d*)/u.test(cleanSample);
    const transferOrWaitContext = /(?:\u8f6c\u4f1a|\u5b98\u5ba3|\u7403\u8ff7|\u7b49\u6d88\u606f|\u7b49\u4fe1|\u7b49\u5b98\u65b9|\u4e0b\u6811|\u6811\u4e0a\u7684\u5144\u5f1f|\u8e72\u6d88\u606f)/u.test(cleanSample);
    return literalTreeContext && !transferOrWaitContext;
  }
  if (term === '\u5931\u8e2a\u4eba\u53e3' && family === 'attack') {
    const literalMissingPersonContext = /(?:\u80fd\u627e\u5931\u8e2a\u4eba\u53e3|\u627e\u5931\u8e2a\u4eba\u53e3|\u88ab\u627e\u56de|\u79bb\u5bb6\u51fa\u8d70|\u5931\u8e2a\u4eba\u53e3\u56fe\u7247|\u5931\u8e2a\u4eba\u53e3\u8d85\u8fc7|\u62a5\u8b66|\u5bfb\u4eba)/u.test(cleanSample);
    const comebackContext = /(?:\u5931\u8e2a\u4eba\u53e3\u56de\u5f52|\u5931\u8e2a\u4eba\u53e3\u56de\u6765|\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86|\u7ec8\u4e8e\u56de\u6765\u4e86\u5931\u8e2a\u4eba\u53e3|\u7ec8\u4e8e\u66f4\u65b0|\u597d\u4e45\u4e0d\u89c1|\u4f60\u8fd8\u77e5\u9053\u56de\u6765)/u.test(cleanSample);
    return (literalMissingPersonContext || comebackContext) && !/(?:\u88c5\u5931\u8e2a\u4eba\u53e3|\u5f53\u5931\u8e2a\u4eba\u53e3|\u4e00\u88ab\u8981\u6c42.*\u5931\u8e2a\u4eba\u53e3)/u.test(cleanSample);
  }
  if (['\u5931\u8e2a\u4eba\u53e3\u56de\u5f52', '\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86'].includes(term) && family === 'cooperation') {
    const bareComebackContext = /^\u5931\u8e2a\u4eba\u53e3\u56de\u5f52(?:\u4e86)?$/u.test(cleanSample);
    const warmComebackContext = /(?:\u6b22\u8fce|\u7ec8\u4e8e|\u60f3\u4f60|\u597d\u4e45\u4e0d\u89c1|\u56de\u6765\u4e86).{0,18}\u5931\u8e2a\u4eba\u53e3|\u5931\u8e2a\u4eba\u53e3.{0,18}(?:\u6b22\u8fce|\u7ec8\u4e8e|\u60f3\u4f60|\u597d\u4e45\u4e0d\u89c1|\u56de\u6765\u4e86)/u.test(cleanSample);
    if (bareComebackContext && !warmComebackContext) return true;
  }
  if (term === '\u76f4\u8a00\u4e0d\u8bb3' && family === 'attack') {
    const standaloneOrQuotedContext = cleanSample === '\u76f4\u8a00\u4e0d\u8bb3' || /(?:^\u300a?\u76f4\u8a00\u4e0d\u8bb3\u300b?$|\u300a\u76f4\u8a00\u4e0d\u8bb3\u300b|\u201c\u76f4\u8a00\u4e0d\u8bb3\u201d|\u76f4\u8a00\u4e0d\u8bb3\u7684(?:\u79c0\u54e5|\S{1,4}\u54e5))/u.test(cleanSample);
    const sarcasticExcuseContext = /(?:\u522b\u62ff\u76f4\u8a00\u4e0d\u8bb3|\u6253\u7740\u76f4\u8a00\u4e0d\u8bb3|\u76f4\u8a00\u4e0d\u8bb3.*(?:\u501f\u53e3|\u4eba\u8eab\u653b\u51fb|\u5634\u81ed|\u5192\u72af))/u.test(cleanSample);
    return standaloneOrQuotedContext && !sarcasticExcuseContext;
  }
  if (term === '\u751c\u83dc' && family === 'cooperation') {
    const literalFoodOrUsernameContext = cleanSample === '\u751c\u83dc' || /(?:\u8fb2\u6c11.*\u751c\u83dc|\u8fd9\u5c31\u662f\u751c\u83dc|\u9019\u5c31\u662f\u751c\u83dc|\u56de\u590d\s*@?\u514d\u8d39\u751c\u83dc\u997c|@[^\s]*\u751c\u83dc[^\s]*)/u.test(cleanSample);
    const friendlyContext = /(?:\u751c\u83dc.*(?:\u592a\u6696|\u53ef\u7231|\u5584\u610f|\u597d\u4eba)|(?:\u4f60|\u4f60\u4eec|\u5927\u5bb6).*\u751c\u83dc)/u.test(cleanSample);
    return literalFoodOrUsernameContext && !friendlyContext;
  }
  if (term === '\u795e\u795e' && family === 'attack') {
    const splitNameContext = /(?:\u539f\u795e[\u3001\uff0c,]\u795e\u5948|\u539f\u795e.*\u795e\u5948|shimeji|\u684c\u5ba0\u6846\u67b6|\u795e\u4e2d\u795e|\u6700\u5f3a\u7684\u4e00\u4e2a|\u795e\u795e\u53e8\u53e8|\u80a5\u795e\u795e|^\u795e{3,}$)/iu.test(cleanSample);
    const attackContext = /(?:\u8fd9\u7fa4\u795e\u795e|\u795e\u795e\u53c8|\u795e\u795e\u4eec|\u80a5\u795e\u795e|\u8df3|\u6025|\u7834\u9632|\u5c0f\u9b3c|\u62bd\u8c61)/u.test(cleanSample);
    const praiseNicknameContext = /\u80a5\u795e\u795e.*(?:\u661f\u661f\u773c|\u53ef\u7231|\u597d\u559c\u6b22)/u.test(cleanSample);
    const praiseNameContext = /(?:^|[A-Za-z0-9])\u795e\u795e\u4e86$/u.test(cleanSample) || /(?:^|[A-Za-z0-9])\u795e\u795e\u4e86/u.test(cleanSample);
    const hostileLabelContext = /(?:\u522b|\u4f60|\u4f60\u4eec|\u90a3\u5957|\u8bdd\u672f|\u6263\u5e3d\u5b50|\u7acb\u573a).{0,18}\u795e\u795e|\u795e\u795e.{0,18}(?:\u8bdd\u672f|\u6263\u5e3d\u5b50|\u7acb\u573a|\u522b)/u.test(cleanSample);
    return (splitNameContext && (!attackContext || praiseNicknameContext)) || (praiseNameContext && !hostileLabelContext);
  }
  if (term === '\u53ef\u4ee5\u8d34' && family === 'cooperation') {
    const passivePublishContext = /(?:\u5ba1\u6838|\u5e7f\u544a\u5546|\u53d1\u51fa\u6765\u7684\u8bc4\u8bba|\u53d1\u51fa\u6765\u7684\u89c6\u9891|\u80fd\u53d1\u51fa\u6765\u624d|\u624d\u80fd\u53d1\u51fa\u6765|\u53d1\u51fa\u6765\u5c31\u662f)/u.test(cleanSample);
    const genericPublishContext = /(?:\u53ef\u4ee5\u53d1\u5956|\u53ef\u4ee5\u53d1\u8bed\u97f3|\u53ef\u4ee5\u53d1(?:\u7bc7|\u4e00\u7bc7|\u4e2a)?(?:\u6b63\u5f53\u7684)?(?:\u6587\u7ae0|\u5fae\u535a|\u5e16\u5b50|\u89c6\u9891)|\u8ba9\u4ed6.*(?:\u6b4c|\u89c6\u9891|\u8bed\u97f3).*\u53d1\u51fa\u6765|\u53ef\u4ee5\u53d1\u5fae\u535a|\u53ef\u4ee5\u53d1\u5f39\u5e55\u53d1\u8bc4\u8bba|\u53ef\u4ee5\u53d1\u660e|\u4e00\u53d1\u51fa\u6765|\u53d1\u6b63\u7ecf.*\u79d1\u666e|\u76f4\u63a5\u8d34\u51fa\u6765\u5ba3\u4f20|\u52a8\u9759.*\u53d1\u51fa\u6765|\u58f0\u97f3.*\u53d1\u51fa\u6765|\u9e1f\u53d1\u51fa\u6765|\u53d1\u51fa\u6765\u6559\u5506|\u7206\u53d1\u51fa\u6765|\u6ca1\u6709\u53d1\u51fa\u6765)/u.test(cleanSample);
    const latestPublishOnlyContext = /(?:\u52a8\u6001\u6709\u53d1\u51fa\u6765\u8fc7|\u8fd8\u6709\u8138\u81ea\u5df1\u53d1\u51fa\u6765|\u81ea\u5df1\u53d1\u51fa\u6765|\u53ef\u4ee5\u53d1\u8d22)/u.test(cleanSample);
    const shamingPublishContext = /(?:\u597d\u610f\u601d\u53d1\u51fa\u6765|\u8fd8\u6562\u53d1\u51fa\u6765|\u8fd9\u4e5f\u53d1\u51fa\u6765|\u600e\u4e48\u597d\u610f\u601d\u53d1)/u.test(cleanSample);
    const alreadyPublishedContext = /(?:(?:\u8001\u5e08|\u4f60|\u81ea\u5df1).{0,8}(?:\u53d1\u51fa\u6765\u4e86|\u8d34\u51fa\u6765\u4e86|\u53d1\u4e86|\u8d34\u4e86)|\u6c14\u4e0a\u6765.*\u53d1\u51fa\u6765\u4e86)/u.test(cleanSample);
    const requestToPostContext = /(?:\u4f60|\u4f60\u4eec|\u8c01|\u6562|\u9ebb\u70e6|\u6c42|\u53d1\u4e00\u4e0b|\u8d34\u4e00\u4e0b|\u8d34\u51fa\u6765|\u53ef\u4ee5(?:\u8d34|\u53d1)|\u53d1\u51fa\u6765.*(?:\u5417|\u4e48|\uff1f|\?|\u770b\u770b)|\u8bc1\u636e|\u622a\u56fe|\u539f\u56fe|\u94fe\u63a5)/u.test(cleanSample);
    const wealthPredictionContext = /\u53ef\u4ee5\u53d1\u8d22/u.test(cleanSample);
    return genericPublishContext || shamingPublishContext || alreadyPublishedContext || (latestPublishOnlyContext && (!requestToPostContext || wealthPredictionContext)) || (passivePublishContext && !requestToPostContext);
  }
  if (term === '\u6389\u5c0f\u73cd\u73e0' && family === 'attack') {
    const bareCryContext = /^(?:\u6389\u5c0f\u73cd\u73e0\u4e86?|\u6389\u5c0f\u73cd\u73e0\u4e86?[\uff0c,]\s*\u545c\u545c)(?:[.!！。~\s]|\[[^\]]+\])*$/u.test(cleanSample);
    const latestBareCryContext = cleanSample === '\u6389\u5c0f\u73cd\u73e0\u4e86\uff0c\u545c\u545c';
    const outfitCryContext = /(?:\u7a7f\u51fa\u6765|\u8fd9\u4e2a\u4e0d\u884c).{0,18}\u6389\u5c0f\u73cd\u73e0|\u6389\u5c0f\u73cd\u73e0.{0,18}(?:tv_\u96be\u8fc7|\u7a7f)/u.test(cleanSample);
    const targetedMockContext = /(?:\u4f60|\u4ed6|\u5979|\u8fd9\u5c31|\u8fd9\u70b9|\u8bc1\u636e).{0,12}\u6389\u5c0f\u73cd\u73e0|\u6389\u5c0f\u73cd\u73e0.{0,12}(?:\u8bc1\u636e|\u522b\u54ed|\u88c5\u53ef\u601c)/u.test(cleanSample);
    if ((bareCryContext || latestBareCryContext || outfitCryContext) && !targetedMockContext) return true;
  }
  if (term === '\u5927\u9b54\u6cd5\u5e08' && family === 'attack') {
    const literalMageContext = /(?:\u9ed1\u9b54\u6cd5\u5e08|\u897f\u5e7b|\u5f02\u754c|\u9ab7\u9ac5|\u8868\u9762\u4e0a\u662f\u9b54\u6cd5\u5e08|\u9b54\u6cd5\u5e08\u6218\u888d|\u5927\u9b54\u6cd5\u5e08\u8bf4\u7684\u5bf9|\u5927\u9b54\u6cd5\u5e08\u662f\u4ec0\u4e48|\u8fd8\u5dee\d*\u4e2a?\u6708\u5c31\u5927\u9b54\u6cd5\u5e08|\u6211\u5df2\u7ecf\u5927\u9b54\u6cd5\u5e08)/u.test(cleanSample);
    const hostileLabelContext = /(?:\u4f60|\u4ed6|\u5979|\u81ea\u79f0).{0,16}\u5927\u9b54\u6cd5\u5e08|\u5927\u9b54\u6cd5\u5e08.{0,16}(?:\u88c5|\u81ea\u79f0|\u6076\u5fc3)/u.test(cleanSample);
    if (literalMageContext && !hostileLabelContext) return true;
  }
  if (['\u5976\u51f6', '\u5976\u51f6\u5976\u51f6'].includes(term) && family === 'cooperation') {
    const noisyPhraseContext = /\u57fa\u672c\u4fe1\u606f\u5976\u51f6\u5976\u51f6.{0,24}\u6469\u767b\u5e74\u4ee3/u.test(cleanSample);
    const friendlyToneContext = /(?:\u56de\u590d|\u8bed\u6c14|\u8fd9\u53e5|\u6c14\u6c1b|\u53ef\u7231).{0,18}\u5976\u51f6|\u5976\u51f6.{0,18}(?:\u6c14\u6c1b|\u53ef\u7231|\u7f13\u548c)/u.test(cleanSample);
    if (noisyPhraseContext && !friendlyToneContext) return true;
  }
  if (term === '\u4e0d\u53ef\u62b5\u6297\u529b' && family === 'attack') {
    const literalForceMajeureContext = /(?:\u4e0d\u53ef\u6297\u529b\u56e0\u7d20|\u62b5\u6297\u4e0d\u4e86\u5927\u8c61|\u4e0d\u53ef\u62b5\u6297\u529b(?:\u3002|$))/u.test(cleanSample);
    const excuseMockContext = /(?:\u522b|\u4f60|\u4f60\u4eec|\u6240\u6709\u5931\u8bef).{0,18}(?:\u4e0d\u53ef\u62b5\u6297\u529b|\u4e0d\u53ef\u6297\u529b)|(?:\u4e0d\u53ef\u62b5\u6297\u529b|\u4e0d\u53ef\u6297\u529b).{0,18}(?:\u501f\u53e3|\u5931\u8bef|\u522b)/u.test(cleanSample);
    if (literalForceMajeureContext && !excuseMockContext) return true;
  }
  if (term === '\u7b11\u9ebb\u4e86' && family === 'attack') {
    const bareLaughContext = /^\u7b11\u9ebb\u4e86(?:[.!！。~\s]|\[[^\]]+\])*$/u.test(cleanSample);
    const targetedMockContext = /\u7b11\u9ebb\u4e86.{0,24}(?:\u5c31\u8fd9|\u64cd\u4f5c|\u8bc1\u636e|\u610f\u8bc6|\u5439)|(?:\u5c31\u8fd9|\u64cd\u4f5c|\u8bc1\u636e|\u610f\u8bc6|\u5439).{0,24}\u7b11\u9ebb\u4e86/u.test(cleanSample);
    if (bareLaughContext && !targetedMockContext) return true;
  }
  if (term === '\u5e72\u8d27up' && family === 'cooperation') {
    const negativeSubstanceContext = /(?:\u6ca1(?:\u5565|\u6709)?\u5e72\u8d27|\u4e0d\u662f\u5e72\u8d27|\u90a3\u7b97\u5e72\u8d27|\u7b97\u5e72\u8d27[?？]|\u5e72\u8d27\u6162\u6162|\u5e72\u8d27\u518d\u8bf4|\u662f\u4e0d\u662f\u5e72\u8d27\u518d\u8bf4|(?:\u8d28\u7591|\u66f2\u89e3).*\u5e72\u8d27|\u5e72\u8d27.*(?:\u6ca1(?:\u5565|\u6709)?|\u518d\u8bf4|\u8d28\u7591|\u66f2\u89e3))/u.test(cleanSample);
    const creatorPraiseContext = /(?:\u5e72\u8d27up|\u8fd9\u79cd\u5e72\u8d27up|\u5e72\u8d27.*(?:up|\u8d44\u6599|\u94fe\u63a5|\u66f4\u591a|\u786c\u6838|\u6709\u7528)|(?:up|\u535a\u4e3b|\u8001\u5e08).*\u5e72\u8d27)/iu.test(cleanSample);
    return negativeSubstanceContext && !creatorPraiseContext;
  }
  if (term === '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb' && family === 'cooperation') {
    const genericTopContext = !cleanSample.includes('\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb') && /(?:\u9876\u4e0a\u53bb|\u9001\u4e0a\u53bb)/u.test(cleanSample);
    const supportBoostContext = /(?:\u8bc1\u636e|\u8fd9\u6761|\u70ed\u8bc4|\u7ed9\u4f60|\u5927\u5bb6\u770b\u770b).*(?:\u9ad8\u4f4e|\u9001\u4e0a\u53bb|\u9876\u4e0a\u53bb)|(?:\u9ad8\u4f4e|\u9001\u4e0a\u53bb|\u9876\u4e0a\u53bb).*(?:\u8bc1\u636e|\u8fd9\u6761|\u70ed\u8bc4|\u7ed9\u4f60|\u5927\u5bb6\u770b\u770b)/u.test(cleanSample);
    return genericTopContext && !supportBoostContext;
  }
  if (term === '\u6700\u540e\u4e00\u821e' && family === 'evasion') {
    const performanceContext = /(?:\u9ad8\u97f3|\u6f14\u5531\u4f1a|\u821e\u53f0|\u8868\u6f14|\u5531|\u6b4c|\u7403\u5458|\u9000\u5f79|\u6c34\u51c6|\u7a76\u6781\u4e00\u821e|\u6700\u540e\u4e00\u6b66|\u4ec0\u4e48\u53eb\u505a).*\u6700\u540e\u4e00\u821e|\u6700\u540e\u4e00\u821e.*(?:\u9ad8\u97f3|\u6f14\u5531\u4f1a|\u821e\u53f0|\u8868\u6f14|\u5531|\u6b4c|\u7403\u5458|\u9000\u5f79|\u6c34\u51c6|\u7a76\u6781\u4e00\u821e|\u6700\u540e\u4e00\u6b66)/u.test(cleanSample);
    const gambleContext = /(?:\u522b\u6212|\u6212|\u8d4c|\u7ffb\u8eab|\u6700\u540e\u4e00\u6b21|\u518d\u6765\u4e00\u628a|\u56de\u672c).*\u6700\u540e\u4e00\u821e|\u6700\u540e\u4e00\u821e.*(?:\u7ffb\u8eab|\u56de\u672c|\u8d4c|\u518d\u6765)/u.test(cleanSample);
    return performanceContext && !gambleContext;
  }
  if (term === '\u5fae\u8868\u60c5' && family === 'attack') {
    const narrativeExpressionContext = /(?:\u5267\u60c5|\u89d2\u8272|\u8868\u6f14|\u8868\u60c5|\u538b\u6291\u611f|\u63d0\u73b0).*\u5fae\u8868\u60c5|\u5fae\u8868\u60c5.*(?:\u5267\u60c5|\u89d2\u8272|\u8868\u6f14|\u8868\u60c5|\u538b\u6291\u611f|\u63d0\u73b0)/u.test(cleanSample);
    const accusationContext = /(?:\u522b\u62ff|\u62ff).*\u5fae\u8868\u60c5.*(?:\u6263\u5e3d\u5b50|\u5f53\u8bc1\u636e|\u9020\u8c23)|\u5fae\u8868\u60c5.*(?:\u6263\u5e3d\u5b50|\u8bc1\u636e|\u9020\u8c23)/u.test(cleanSample);
    return narrativeExpressionContext && !accusationContext;
  }
  if (term === '\u5f00\u5408' && family === 'attack') {
    const mechanicalContext = /(?:\u81ea\u52a8\u5f00\u5408|\u5f00\u5408(?:\u95e8|\u673a\u6784|\u89d2\u5ea6|\u88c5\u7f6e|\u9f3b\u5b54)|(?:\u95e8|\u673a\u6784|\u88c5\u7f6e|\u9f3b\u5b54).*\u5f00\u5408|\u63a7\u5236\u9f3b\u5b54\u5f00\u5408|\u8ddf\u7740\u5f00\u5408\u9f3b\u5b54)/u.test(cleanSample);
    const doxxingContext = /(?:\u5f00\u5408|\u5f00\u76d2).*(?:\u7f51\u66b4|\u9690\u79c1|\u843d\u7f51|\u4eba\u8089|\u66dd)/u.test(cleanSample);
    return mechanicalContext && !doxxingContext;
  }
  if (['\u8f7b\u5feb\u7ef7\u4f4f', '\u8f7b\u677e\u7ef7\u4f4f'].includes(term) && family === 'cooperation') {
    const synonymListContext = /(?:\u8f7b\u5feb\u7ef7\u4f4f|\u8f7b\u677e\u7ef7\u4f4f).{0,60}(?:\u677e\u5f1b\u7ef7\u4f4f|\u8212\u7f13\u7ef7\u4f4f|\u5b89\u9038\u7ef7\u4f4f|\u81ea\u5728\u7ef7\u4f4f)/u.test(cleanSample);
    const standaloneContext = cleanSample === term;
    const cooperativeContext = /(?:\u89e3\u91ca|\u8ba8\u8bba|\u60c5\u7eea|\u7ee7\u7eed|\u522b\u5435).{0,18}(?:\u8f7b\u5feb\u7ef7\u4f4f|\u8f7b\u677e\u7ef7\u4f4f)|(?:\u8f7b\u5feb\u7ef7\u4f4f|\u8f7b\u677e\u7ef7\u4f4f).{0,18}(?:\u60c5\u7eea|\u7ee7\u7eed\u8ba8\u8bba|\u522b\u5435)/u.test(cleanSample);
    if ((synonymListContext || standaloneContext) && !cooperativeContext) return true;
  }
  if (term === '\u610f\u6ee1\u79bb' && family === 'cooperation') {
    const standaloneContext = cleanSample === '\u610f\u6ee1\u79bb';
    const appreciationContext = /\u610f\u6ee1\u79bb.{0,18}(?:\u611f\u8c22|\u8d44\u6599|\u6574\u7406|\u5b66\u5230)|(?:\u611f\u8c22|\u8d44\u6599|\u6574\u7406|\u5b66\u5230).{0,18}\u610f\u6ee1\u79bb/u.test(cleanSample);
    if (standaloneContext && !appreciationContext) return true;
  }
  if (term === '\u4e0b\u996d' && family === 'cooperation') {
    const standaloneContext = /^(?:\u771f)?\u4e0b\u996d(?:\u5c31\u5b8c\u4e8b\u4e86)?[.!！。\s]*$/u.test(cleanSample);
    const literalFoodContext = /(?:\u5c0f\u7c73\u6912|\u5c0f\u7c73\u8fa3|\u751f\u5403|\u4e00\u9910|\u80c3|\u83ca\u82b1|\u996d|\u83dc|\u597d\u5403).{0,18}\u4e0b\u996d|\u4e0b\u996d.{0,18}(?:\u5c0f\u7c73\u6912|\u5c0f\u7c73\u8fa3|\u751f\u5403|\u4e00\u9910|\u80c3|\u83ca\u82b1|\u996d|\u83dc|\u597d\u5403)/u.test(cleanSample);
    const mediaContext = /(?:\u89c6\u9891|\u64cd\u4f5c|\u6bd4\u8d5b|\u8282\u76ee|\u5f39\u5e55).{0,18}\u4e0b\u996d|\u4e0b\u996d.{0,18}(?:\u89c6\u9891|\u64cd\u4f5c|\u6bd4\u8d5b|\u8282\u76ee|\u5f39\u5e55)/u.test(cleanSample);
    if ((literalFoodContext || standaloneContext) && !mediaContext) return true;
  }
  if (term === '\u60c5\u7eea\u4ef7\u503c' && family === 'cooperation') {
    const hostileWorkValueContext = /(?:\u62a4\u822a|\u8001\u677f|\u5165\u804c|\u8981\u6280\u672f\u6ca1\u6280\u672f|\u6ca1\u60c5\u7eea\u4ef7\u503c|\u653e\u5728\u8138\u4e0a|\u653e\u5c41\u80a1\u4e0a).{0,32}\u60c5\u7eea\u4ef7\u503c|\u60c5\u7eea\u4ef7\u503c.{0,32}(?:\u8001\u677f|\u5165\u804c|\u8981\u6c42|\u6ca1\u60c5\u7eea\u4ef7\u503c|\u653e\u5728\u8138\u4e0a|\u653e\u5c41\u80a1\u4e0a)/u.test(cleanSample);
    const supportiveContext = /(?:\u8c22\u8c22|\u611f\u8c22|\u56de\u590d|\u5b89\u6170|\u786e\u5b9e|\u7ed9\u4e86|\u63d0\u4f9b).{0,18}\u60c5\u7eea\u4ef7\u503c|\u60c5\u7eea\u4ef7\u503c.{0,18}(?:\u5e2e\u52a9|\u652f\u6301|\u5b89\u6170)/u.test(cleanSample);
    if (hostileWorkValueContext && !supportiveContext) return true;
  }
  if (term === '\u53ef\u4ee5\u8d34' && family === 'cooperation') {
    const publishOnlyContext = !cleanSample.includes('\u53ef\u4ee5\u8d34') && /(?:\u52a8\u6001\u6709\u53d1\u51fa\u6765\u8fc7|\u8fd8\u6709\u8138\u81ea\u5df1\u53d1\u51fa\u6765|\u81ea\u5df1\u53d1\u51fa\u6765|\u53ef\u4ee5\u53d1\u8d22)/u.test(cleanSample);
    const evidenceRequestContext = /(?:\u53ef\u4ee5\u8d34|\u8d34\u4e00\u4e0b|\u8d34\u51fa\u6765).{0,18}(?:\u8bc1\u636e|\u622a\u56fe|\u94fe\u63a5|\u6765\u6e90|\u8d44\u6599)|(?:\u8bc1\u636e|\u622a\u56fe|\u94fe\u63a5|\u6765\u6e90|\u8d44\u6599).{0,18}(?:\u53ef\u4ee5\u8d34|\u8d34\u4e00\u4e0b|\u8d34\u51fa\u6765)/u.test(cleanSample);
    if (publishOnlyContext && !evidenceRequestContext) return true;
  }
  if (term === '\u795e\u795e' && family === 'attack') {
    const praiseNameContext = /(?:^|[A-Za-z0-9])\u795e\u795e\u4e86$/u.test(cleanSample) || /(?:^|[A-Za-z0-9])\u795e\u795e\u4e86/u.test(cleanSample);
    const hostileLabelContext = /(?:\u522b|\u4f60|\u4f60\u4eec|\u90a3\u5957|\u8bdd\u672f|\u6263\u5e3d\u5b50|\u7acb\u573a).{0,18}\u795e\u795e|\u795e\u795e.{0,18}(?:\u8bdd\u672f|\u6263\u5e3d\u5b50|\u7acb\u573a|\u522b)/u.test(cleanSample);
    if (praiseNameContext && !hostileLabelContext) return true;
  }
  if (term === '\u5854\u83f2' && family === 'cooperation') {
    const properNameDramaContext = /(?:\u5854\u83f2).{0,48}(?:\u804a\u5929\u8bb0\u5f55|\u672c\u4eba|\u8fd0\u8425|\u9020\u8c23|\u6362\u76ae\u8f6c\u751f|\u524d\u5973\u53cb|\u6367\u6210\u5723\u4eba|\u53cd\u611f|\u538c\u6076|\u65e7\u4e8b|\u8eab\u4efd\u8bc1|\u5973\u4e3b\u64ad|vtb)|(?:\u804a\u5929\u8bb0\u5f55|\u672c\u4eba|\u8fd0\u8425|\u9020\u8c23|\u6362\u76ae\u8f6c\u751f|\u524d\u5973\u53cb|\u6367\u6210\u5723\u4eba|\u53cd\u611f|\u538c\u6076|\u65e7\u4e8b|\u8eab\u4efd\u8bc1|\u5973\u4e3b\u64ad|vtb).{0,48}\u5854\u83f2/iu.test(cleanSample);
    const cooperativeContext = /\u5854\u83f2.{0,18}(?:\u8d44\u6599|\u6765\u6e90|\u53ef\u4ee5\u8d34|\u8865\u5145|\u53c2\u8003)|(?:\u8d44\u6599|\u6765\u6e90|\u53ef\u4ee5\u8d34|\u8865\u5145|\u53c2\u8003).{0,18}\u5854\u83f2/u.test(cleanSample);
    if (properNameDramaContext && !cooperativeContext) return true;
  }
  if (term === '\u5468\u5904' && family === 'attack') {
    const historicalOrMovieContext = /(?:\u5468\u5904\u9664\u4e09\u5bb3|\u6076\u9738\u53eb\u5468\u5904|\u5468\u5904\u7ed3\u5c40|\u53c2\u519b|\u5c06\u519b|\u8d2a\u55d4\u75f4\u4e2d\u5468\u5904|\u9999\u6e2f\u4ed4|\u90aa\u6559\u5934\u5b50|\u7eb9\u8eab).{0,48}|(?:\u6076\u9738|\u731b\u864e|\u87d2\u86c7|\u4e09\u5bb3|\u53c2\u519b|\u5c06\u519b|\u4f5b\u6559|\u8d2a\u55d4\u75f4|\u9999\u6e2f\u4ed4|\u90aa\u6559\u5934\u5b50|\u7eb9\u8eab).{0,48}\u5468\u5904/u.test(cleanSample);
    const hostileMemeContext = /(?:\u9006\u5929|\u7f8e\u56fd\u5206\u5904|\u5206\u5904|\u539f|\u73a9\u5bb6|\u7fa4\u4f53|\u8282\u594f).{0,18}\u5468\u5904|\u5468\u5904.{0,18}(?:\u591a\u7684\u662f|\u5206\u5904|\u9006\u5929|\u73a9\u5bb6|\u7fa4\u4f53|\u8282\u594f)/u.test(cleanSample);
    if (historicalOrMovieContext && !hostileMemeContext) return true;
  }
  if (term === '\u6731\u4e00\u9f99' && family === 'attack') {
    const defenseOrPraiseContext = /(?:\u6731\u4e00\u9f99).{0,36}(?:\u8fd8\u4e11|\u90fd\u5e05|\u7f8e\u51fa\u5708|\u5c0f\u516c\u7237|\u4f60\u8bf4\u4ed6\u4e11|\u5ba1\u7f8e|\u4e0d\u641e\u7b11|\u5f88\u597d\u7b11|\u4e0d\u51b2\u7a81)|(?:\u8fd8\u4e11|\u90fd\u5e05|\u7f8e\u51fa\u5708|\u5c0f\u516c\u7237|\u4f60\u8bf4\u4ed6\u4e11|\u5ba1\u7f8e|\u90a3\u96be\u602a\u89c9\u5f97|\u4e0d\u641e\u7b11|\u5f88\u597d\u7b11|\u4e0d\u51b2\u7a81).{0,36}\u6731\u4e00\u9f99/u.test(cleanSample);
    const fanWarAttackContext = /(?:\u6731\u4e00\u9f99\u7c89\u4e1d|\u4f60\u5bb6|\u7fa4\u5632|\u81ea\u4f5c\u81ea\u53d7|\u5e26\u5927\u540d|\u8fb1\u9a82).{0,36}(?:\u6731\u4e00\u9f99|\u7c89\u4e1d|\u4f60\u5bb6)|(?:\u6731\u4e00\u9f99).{0,36}(?:\u7c89\u4e1d|\u7fa4\u5632|\u81ea\u4f5c\u81ea\u53d7|\u8fb1\u9a82)/u.test(cleanSample);
    if (defenseOrPraiseContext && !fanWarAttackContext) return true;
  }
  if (term === 'get\u5230' && family === 'cooperation') {
    const negatedGetContext = /get\u4e0d\u5230|(?:\u6ca1|\u6ca1\u6709|\u4e0d).{0,4}get\u5230/iu.test(cleanSample);
    const positiveGetContext = /get\u5230(?:\u4e86)?[\uff0c,]?.{0,12}(?:\u8c22\u8c22|\u660e\u767d|\u89e3\u91ca|\u9999|\u61c2)|(?:\u6211|\u7ec8\u4e8e).{0,8}get\u5230(?:\u4e86)?/iu.test(cleanSample);
    if (negatedGetContext && !positiveGetContext) return true;
  }
  if (term === '\u8054\u540d\u6b3e' && family === 'cooperation') {
    const productContext = /(?:up\u4e3b|\u8f66|\u673a\u68b0\u5e08|Mmax2|\u660e\u65e5\u9999|\u7535\u81ea|\u5546\u54c1|\u624b\u529e|\u8863\u670d).{0,18}\u8054\u540d\u6b3e|\u8054\u540d\u6b3e.{0,18}(?:up\u4e3b|\u8f66|\u673a\u68b0\u5e08|Mmax2|\u660e\u65e5\u9999|\u7535\u81ea|\u5546\u54c1|\u624b\u529e|\u8863\u670d)/iu.test(cleanSample);
    const cooperationContext = /\u8054\u540d\u6b3e.{0,18}(?:\u8d44\u6599|\u8bc1\u636e|\u53ef\u4ee5\u8d34|\u6765\u6e90|\u6574\u7406)|(?:\u8d44\u6599|\u8bc1\u636e|\u53ef\u4ee5\u8d34|\u6765\u6e90|\u6574\u7406).{0,18}\u8054\u540d\u6b3e/u.test(cleanSample);
    if (productContext && !cooperationContext) return true;
  }
  if (term === '\u6e7f\u6e7f' && family === 'attack') {
    const literalWetContext = /(?:\u6211\u559c\u6b22|\u597d\u5403|\u9c8d\u9c7c|\u66f4\u597d\u5403|\u6e7f\u6e7f\u7684|\u6e7f\u6e7f\u4e86)/u.test(cleanSample);
    const hostileHomophoneContext = /(?:\u5218\u8bd7\u8bd7|\u8c10\u97f3|\u6076\u610f|\u8c03\u4f83|\u8c03\u4f83).{0,24}\u6e7f\u6e7f|\u6e7f\u6e7f.{0,24}(?:\u5218\u8bd7\u8bd7|\u8c10\u97f3|\u6076\u610f|\u8c03\u4f83|\u8c03\u4f83)/u.test(cleanSample);
    if (literalWetContext && !hostileHomophoneContext) return true;
  }
  if (term === '\u96f7\u666e' && family === 'attack') {
    const properNameContext = /(?:\u96f7\u666e\u5bfa|\u5927\u96f7\u666e|\u666e\u5bfa)/u.test(cleanSample);
    const memeAttackContext = /(?:\u96f7\u666e).*(?:\u5927\u4f17|\u4eba|\u5f3a\u884c|homo|\u6076\u5fc3)|(?:homo|\u5f3a\u884c).*\u96f7\u666e/iu.test(cleanSample);
    return properNameContext && !memeAttackContext;
  }
  if (term === '\u94f8\u5e01' && family === 'attack') {
    const literalCoinContext = /(?:\u5218\u5df4|\u94f8\u5e01\u5e73\u5e02|\u767e\u8d27\u53ef\u5c45|\u5947\u8d27\u53ef\u5c45|\u8d27\u5e01|\u94dc\u94b1|\u94f8\u9020).*\u94f8\u5e01|\u94f8\u5e01.*(?:\u5218\u5df4|\u5e73\u5e02|\u767e\u8d27\u53ef\u5c45|\u5947\u8d27\u53ef\u5c45|\u8d27\u5e01|\u94dc\u94b1|\u94f8\u9020)/u.test(cleanSample);
    const insultContext = /(?:\u771f\u94f8\u5e01|\u4f60.*\u94f8\u5e01|\u94f8\u5e01.*(?:\u8bc1\u636e|\u903b\u8f91|\u4e0d\u770b|\u64cd\u4f5c|\u8111\u5b50))/u.test(cleanSample);
    return literalCoinContext && !insultContext;
  }
  if (term === '\u540a\u6253' && family === 'attack') {
    const gameKillContext = /(?:\u4ea1\u8bed|\u79d2\u6740|\u6253\u6b7b|\u6253\u7206|\u4e00\u62f3|\u89e6\u624b|\u5267\u60c5\u6740|\u4f24\u5bb3|\u8840|\u4ed9\u5e1d|\u7ec3\u6c14|\u4e07\u4eba\u961f|\u4e00\u56de\u5408).*(?:\u79d2\u6740|\u6253\u6b7b|\u6253\u7206|\u540a\u6253|\u5934)|(?:\u79d2\u6740|\u6253\u6b7b|\u6253\u7206).*(?:\u73a9\u610f\u513f|\u6e38\u620f|\u4f24\u5bb3|\u8840|\u5934|\u4ed9\u5e1d|\u7ec3\u6c14|\u4e07\u4eba\u961f|\u4e00\u56de\u5408)/u.test(cleanSample);
    const lifestyleMetricContext = /(?:\u751f\u6d3b|\u5de5\u8d44|\u8eab\u9ad8|\u901f\u5ea6|\u6570\u636e).*(?:\u79d2\u6740|\u5b8c\u7206|\u78be\u538b).*(?:\u5168\u56fd|\u4e5d\u6210|9\u6210|\d+%|\u4eba\u6c11)|(?:\u79d2\u6740|\u5b8c\u7206|\u78be\u538b).*(?:\u5168\u56fd|\u4e5d\u6210|9\u6210|\d+%|\u4eba\u6c11)/u.test(cleanSample);
    const comparisonAttackContext = /(?:\u540a\u6253).*(?:\u6d41\u91cf|\u5bf9\u624b|\u6f14\u6280|\u540c\u884c|\u8fd9\u7fa4)|(?:\u6f14\u6280|\u5b9e\u529b|\u53e3\u7891).*\u540a\u6253/u.test(cleanSample);
    return (gameKillContext || lifestyleMetricContext) && !comparisonAttackContext;
  }
  if (term === '\u5730\u72f1\u7b11\u8bdd' && family === 'attack') {
    const genrePreferenceContext = /^(?:\u5730\u72f1\u7b11\u8bdd[\u554a\uff01!。]*)$|(?:\u5730\u72f1\u7b11\u8bdd).*(?:\u597d\u7b11|\u559c\u6b22|\u5427\u91cc|\u672c\u6765\u5c31\u662f|\u70b9\u8bc4)|(?:\u597d\u7b11|\u559c\u6b22|\u5427\u91cc|\u672c\u6765\u5c31\u662f|\u70b9\u8bc4).*\u5730\u72f1\u7b11\u8bdd/u.test(cleanSample);
    const hostileDarkHumorContext = /(?:\u62ff|\u5bf9|@\S*).*(?:\u53d7\u5bb3\u8005|\u6b7b\u8005|\u707e\u96be|\u60b2\u5267).*\u5730\u72f1\u7b11\u8bdd|\u5730\u72f1\u7b11\u8bdd.*(?:\u6076\u5fc3|\u653b\u51fb|\u53d7\u5bb3\u8005|\u6b7b\u8005|\u707e\u96be)/u.test(cleanSample);
    return genrePreferenceContext && !hostileDarkHumorContext;
  }
  if (term === '\u53d1\u56fe' && family === 'evidence') {
    const existingImageReferenceContext = /(?:\u4e0a\u56fe|\u4e0b\u56fe|\u56fe\u4e2d|\u5982\u56fe|\u770b\u56fe).*(?:\u54ea\u4e2a|\u8fd9\u4e2a|\u662f|显示)/u.test(cleanSample);
    const requestImageContext = /(?:\u4f60|\u9ebb\u70e6|\u6c42|\u628a|\u622a\u56fe).*(?:\u53d1\u56fe|\u53d1\u4e2a\u56fe|\u53d1\u56fe\u770b\u770b|\u53d1\u51fa\u6765)|\u53d1\u56fe.*(?:\u770b\u770b|\u8bc1\u636e|\u622a\u56fe|\u94fe\u63a5)/u.test(cleanSample);
    const genericAnticipationContext = /(?:\u671f\u5f85|\u8001\u5e08|\u8bc4\u8bba).{0,18}\u53d1\u56fe|\u53d1\u56fe.{0,18}(?:\u671f\u5f85|\u8001\u5e08|\u8bc4\u8bba)/u.test(cleanSample);
    return (existingImageReferenceContext || genericAnticipationContext) && !requestImageContext;
  }
  if (term === '\u798f\u745e\u63a7' && family === 'cooperation') {
    const antiFurryContext = /(?:\u626b\u798f\u745e|\u53cd\u798f\u745e|\u4e0d\u7406\u667a\u53cd\u798f\u745e|\u9a9a\u798f\u745e|\u798f\u745e.*(?:\u9ebb\u75f9|\u4e71|\u523b\u677f))/u.test(cleanSample);
    const weakMentionContext = /(?:\u8981\u6c42\u4e0d\u8ba9\u8bf4\u798f\u745e|\u5fc5\u987b\u8bf4\u798f\u745e|^\u798f\u745e$|\u798f.{0,4}\u798f\u745e\u63a7[\uff1f?]?)/u.test(cleanSample);
    const neutralMentionContext = /(?:\u90a3\u4e2a)?\u798f\u745e\u63a7\u554a.{0,18}(?:\u540c\u5b66|\u53d1\u7ed9|\u597d\u50cf)|(?:\u4ec0\u4e48|\u5565).{0,10}\u8ddf\u798f\u745e.{0,10}\u6709\u4ec0\u4e48\u5173\u7cfb/u.test(cleanSample);
    const furryFanContext = /(?:\u798f\u745e\u63a7).*(?:\u770b\u5f97\u5f88\u723d|\u559c\u6b22|\u5236\u4f5c|\u7231\u770b)|(?:\u559c\u6b22|\u7231\u770b).*\u798f\u745e/u.test(cleanSample);
    return (antiFurryContext || weakMentionContext || neutralMentionContext) && !furryFanContext;
  }
  if (term === '\u7a7a\u8033' && family === 'cooperation') {
    const weakNoteContext = /(?:\u6307\u7a7a\u8033|\uff08\u7a7a\u8033\uff09|\(\u7a7a\u8033\)|\S{1,12}.{0,2}\u7a7a\u8033[\uff09)]?$)/u.test(contextSample)
      || /^\u7a7a\u8033[\uff1a:].{1,40}$/u.test(rawContextSample.trim());
    const clarificationRequestContext = /(?:\u5b57\u5e55|\u542c\u4e0d\u6e05|\u53e3\u9f7f\u4e0d\u6e05|\u6c42\u539f\u53e5|\u539f\u8bcd|\u7a7a\u8033).{0,18}(?:\u5427|\u6c42|\u8bf7|\u539f\u53e5|\u5b57\u5e55)|(?:\u5b57\u5e55|\u542c\u4e0d\u6e05|\u53e3\u9f7f\u4e0d\u6e05).{0,18}\u7a7a\u8033/u.test(cleanSample);
    if (weakNoteContext && !clarificationRequestContext) return true;
  }
  if (term === 'cos\u8def\u6613\u5341\u516d' && family === 'cooperation') {
    const directCosContext = /(?:cos|cosp?lay|仿|妆造|扮).{0,12}(?:\u8def\u6613\u5341\u516d|\u56fd\u738b)|(?:\u8def\u6613\u5341\u516d|\u56fd\u738b).{0,12}(?:cos|cosp?lay|仿|妆造|扮)/iu.test(cleanSample);
    if (!directCosContext) return true;
  }
  if (term === '\u7cef\u4e86' && family === 'correction') {
    const cowardiceContext = /\u7cef\u4e86.{0,12}(?:\u4e0d\u6562|\u627epp|\u6709\u611f\u89c9)|(?:\u4e0d\u6562|\u627epp|\u9ed1\u55d3).{0,18}\u7cef\u4e86/u.test(cleanSample);
    const correctionContext = /(?:\u524d\u9762|\u521a\u624d|\u8bf4\u91cd|\u6536\u56de|\u6539\u53e3).{0,18}\u7cef\u4e86|\u7cef\u4e86.{0,18}(?:\u6536\u56de|\u6539\u53e3|\u4fee\u6b63|\u91cd\u8bf4)/u.test(cleanSample);
    if (cowardiceContext && !correctionContext) return true;
  }
  if (term === '\u624b\u6b8b' && family === 'attack') {
    const usernameOnlyContext = /(?:^|\s|[:：]|\u56de\u590d)@?\u624b\u6b8b[\u4e00-\u9fa5a-z0-9_]*(?:[:：]|\u4f60\u591f\u4e86|$)/iu.test(cleanSample);
    const abilityContext = /(?:\u624b\u6b8b\u73a9\u5bb6|\u52a0\u624b\u6b8b|\u6211\u771f\u8fc7\u4e0d\u53bb\u554a\u624b\u6b8b|\u64cd\u4f5c|\u8fc7\u4e0d\u53bb|\u4e0d\u9002\u5408\u624b\u6b8b|\u624b\u7b28)/u.test(cleanSample);
    return usernameOnlyContext && !abilityContext;
  }
  if (term === '\u5c4e\u5c71\u4ee3\u7801' && family === 'attack') {
    const sourceDiscussionContext = /(?:\u5c4e\u5c71\u4ee3\u7801\u7684\u6765\u6e90|\u6765\u6e90|\u8fd9\u4e2a\u8bcd|\u4ec0\u4e48\u610f\u601d|\u600e\u4e48\u6765\u7684)/u.test(cleanSample);
    const codeComplaintContext = /(?:bug|\u4fee|\u7ef4\u62a4|\u8dd1\u4ee3\u7801|\u66f4\u65b0|\u98ce\u9669|\u8d23\u4efb|\u8001\u677f|\u641e\u4e0d\u5b9a|\u8fd0\u884c)/iu.test(cleanSample);
    return sourceDiscussionContext && !codeComplaintContext;
  }
  if (term === '\u68ad\u54c8' && family === 'absolutes') {
    const standaloneContext = cleanSample === '\u68ad\u54c8';
    const commitmentContext = /(?:\u53c8\u68ad\u54c8|\u91cc\u68ad\u54c8|\u5168\u662f.*\u68ad\u54c8|\u5168\u90e8\u68ad\u54c8|\u5168\u4ed3|\u538b\u4e0a|\u62bc\u4e0a|\u8d4c|\u6295\u5165)/u.test(cleanSample);
    return standaloneContext && !commitmentContext;
  }
  if (term === '\u62ac\u6760' && family === 'attack') {
    const disclaimerContext = /(?:\u4e0d\u662f\u62ac\u6760|\u6ca1\u6709\u62ac\u6760\u7684\u610f\u601d|\u65e0\u610f\u62ac\u6760|\u4e0d\u60f3\u62ac\u6760)/u.test(cleanSample);
    const accusationContext = /(?:\u9047\u5230\u62ac\u6760|\u62ac\u6760\u7684|\u6765\u62ac\u6760|\u6545\u610f\u62ac\u6760|\u907f\u91cd\u5c31\u8f7b\u62ac\u6760|\u771f\u6760|\u6760\u7cbe|\u6076\u5fc3)/u.test(cleanSample);
    return disclaimerContext && !accusationContext;
  }
  if (term === '\u6295\u5c04' && family === 'attack') {
    const literalProjectileOrSportsContext = /(?:\u6295\u5c04\u7269|\u6295\u5c04\u80fd\u529b|\u6295\u5c04\u5492\u6cd5|\u4f2f\u5fb7\u6295\u5c04|\u7bee\u7403|\u675c\u5170\u7279|\u5fb7\u514b|projectile|increase projectile damage|\u98de\u5251|\u82f1\u7075|\u971e\u5f39)/iu.test(cleanSample);
    const psychologyContext = /(?:\u5fc3\u7406\u5b66|\u810f\u4e1c\u897f|\u62cd\u5230\u522b\u4eba\u8eab\u4e0a|\u81ea\u5df1\u7684|\u8d1f\u9762|\u5ba2\u4f53|\u95ed\u73af|\u63a8\u5230\u522b\u4eba)/u.test(cleanSample);
    return literalProjectileOrSportsContext && !psychologyContext;
  }
  if (term === '\u73a9\u4e0d\u8d77' && family === 'attack') {
    const affordabilityContext = /(?:\u4e70\u4e0d\u8d77|\u76d7\u7248|\u6b63\u7248|\u4fbf\u5b9c|\u592a\u8d35|\u6ca1\u94b1|\u8d35\u6240\u4ee5|\u4ef7\u683c|\u4e0d\u73a9\u4e86)/u.test(cleanSample);
    const soreLoserContext = /(?:\u957f\u5c06|\u8f93\u4e0d\u8d77|\u800d\u8d56|\u8fd9\u68cb|\u7834\u9632|\u6025|\u5f00\u4e0d\u8d77\u73a9\u7b11|\u73a9\u4e0d\u8d77\u5c31)/u.test(cleanSample);
    return affordabilityContext && !soreLoserContext;
  }
  if (term === '\u4e38\u4e86' && family === 'cooperation') {
    const substringContext = /(?:\u7cd6\u4e38\u4e86|\u836f\u4e38\u4e86|\u5f39\u4e38\u4e86|\u9b54\u4e38\u4e86|\u5510\u4e38\u4e86)/u.test(cleanSample);
    const selfDeprecatingContext = /(?:\u54c8\u54c8.*\u4e38\u4e86|\u5b8c\u4e86|\u8981\u4e38|\u8fd9\u4e0b\u4e38\u4e86|\u65e0\u4e86)/u.test(cleanSample) || /(?:^|[，。！？!?\\s])\u4e38\u4e86$/u.test(cleanSample);
    return substringContext && !selfDeprecatingContext;
  }
  if (term === '\u9488\u4e0d\u6233' && family === 'attack') {
    const rawSample = String(sample || '');
    const emoteWrapperContext = /\[[^\]]*_\u9488\u4e0d\u6233\]/u.test(rawSample);
    const praiseContext = /(?:\u771f\u4e0d[\u9519\u932f]|\u5f88\u4e0d[\u9519\u932f]|\u8003\u8bd5|\u660e\u5929|\u8001\u5e08|\u4f5c\u54c1|\u89c6\u9891|\u771f|\u597d|\u8fd8).{0,24}\u9488\u4e0d\u6233|\u9488\u4e0d\u6233(?:[\uff0c,]?\u52a0\u6cb9|\u771f\u4e0d\u9519|\u597d\u8036)?$/u.test(cleanSample) || emoteWrapperContext;
    const sarcasticContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u903b\u8f91|\u8fd9\u8bdd|\u8fd9\u64cd\u4f5c|\u9634\u9633\u602a\u6c14|\u8bc1\u636e|\u53cd\u8bbd).{0,16}\u9488\u4e0d\u6233|\u9488\u4e0d\u6233.{0,16}(?:\u8bc1\u636e|\u9634\u9633|\u53cd\u8bbd|\u79bb\u8c31)/u.test(cleanSample);
    return praiseContext && !sarcasticContext;
  }
  if (term === '\u4e0a\u7535\u89c6' && family === 'cooperation') {
    const literalVisibilityContext = /^(?:\u300a?\u4e0a\u7535\u89c6\u4e86?\u300b?|\u6211\u4e5f\u4e0a\u7535\u89c6\u4e86?)$/u.test(cleanSample);
    const requestVisibilityContext = /(?:\u80fd\u4e0d\u80fd|\u53ef\u4ee5|\u6c42|\u5e2e|\u628a|up|\u4e3b\u5305).{0,18}\u4e0a\u7535\u89c6|\u4e0a\u7535\u89c6.{0,18}(?:\u8bc1\u636e|\u8d44\u6599|\u5e16|\u6574\u7406|\u8bf4\u6e05\u695a)/u.test(cleanSample);
    return literalVisibilityContext && !requestVisibilityContext;
  }
  if (term === '\u6211\u6545\u610f\u7684' && family === 'cooperation') {
    const hotWordSpamContext = /(?:\u70ed\u8bcd\u7cfb\u5217_?\u6211\u6545\u610f\u7684.*\u70ed\u8bcd\u7cfb\u5217_?\u6211\u6545\u610f\u7684|\[\u70ed\u8bcd\u7cfb\u5217_|\u70ed\u8bcd\u7cfb\u5217\u6211\u6545\u610f\u7684)/u.test(cleanSample);
    const conversationalContext = /(?:\u5bf9\u554a|\u5c31\u662f|\u6ca1\u9519|\u6211\u6545\u610f\u7684[\u5472\u7259\u72d7\u5934\[]|\u6211\u5c31\u6545\u610f)/u.test(cleanSample);
    return hotWordSpamContext && !conversationalContext;
  }
  if (term === '\u65e0\u6148\u60b2' && family === 'attack') {
    const titleOrRequestContext = /(?:\u7ec8\u4e8e\u6709\u4eba\u505a\u4e86|\u7ec8\u4e8e\u6709\u89c6\u9891\u4e86|\u6c42\u65e0\u6148\u60b2|\u65e0\u6148\u60b2\u89c6\u9891|\u89c6\u9891\u4e86)/u.test(cleanSample);
    const ruthlessContext = /(?:\u5e72\u6389|\u6485|\u529b|\u5904\u51b3|\u6740|\u8d76\u5c3d\u6740\u7edd|\u88c5\u840c\u65b0|\u51b7\u9177|\u4e0d\u7559\u60c5)/u.test(cleanSample);
    return titleOrRequestContext && !ruthlessContext;
  }
  if ((term === '\u543e\u547d\u4f11\u77e3' || term === '\u65e0\u547d\u4fee\u77e3') && family === 'attack') {
    const gameLocationContext = /(?:\u8681\u7a74|\u51b0\u5c01\u738b\u5ea7|\u7f8e\u4eba\u9c7c\u5c9b|\u7814\u7a76\u6240|\u516b\u89d2\u7b3c|\u5237\u65e0\u547d\u4fee\u77e3|\u4e0d\u52a0)/u.test(cleanSample);
    const despairContext = /(?:\u88ab\u56f4|\u771f\u7684\u543e\u547d\u4f11\u77e3|\u5b8c\u4e86|\u8981\u6b7b|\u6253\u4e0d\u8fc7|\u6551\u547d|\u4f11\u77e3[\u7b11\u54ed\[])/u.test(cleanSample);
    return gameLocationContext && !despairContext;
  }
  if (term === '\u6342\u5634' && family === 'attack') {
    const literalGestureContext = /(?:\u6234\u7740|\u6bdb\u7ebf\u5e3d|\u6342\u5634\u90a3\u4e00\u5e55|\u5267\u91cc|\u54ea\u4e2a\u6765\u7740|\u753b\u9762|\u955c\u5934|\u624b\u6342\u5634|\u7b11\u5230\u6342\u5634)/u.test(cleanSample);
    const censorshipContext = /(?:\u73a9\u5bb6|\u706b\u6c14|\u516c\u5173|\u4e0d\u8ba9\u8bf4|\u5220\u8bc4|\u7981\u8a00|\u538b\u8bc4|\u58f0\u660e|\u8a00\u8bba|\u6279\u8bc4|\u9a82\u591f)/u.test(cleanSample);
    return literalGestureContext && !censorshipContext;
  }
  if (term === '\u897f\u683c\u739b' && family === 'cooperation') {
    const properNameOrCharacterContext = /(?:\u59cb\u7687\u5e1d|\u4f0a\u4ec0\u5854\u5c14|\u7528.*\u5f29|\u5c04\u4e0b\u6765|\u89d2\u8272|\u540e\u9762\u7528)/u.test(cleanSample);
    const sigmaPraiseContext = /(?:\u4f9d\u65e7\u897f\u683c\u739b|\u771f\u897f\u683c\u739b|\u5f88\u897f\u683c\u739b|\u72ec\u7acb|\u4e0d\u8fce\u5408|\u7537\u4eba|\u5f3a\u8005|\u54e5)/u.test(cleanSample);
    return properNameOrCharacterContext && !sigmaPraiseContext;
  }
  if (term === '\u5c0f\u998b\u732b' && family === 'attack') {
    const merchantOrQuotedContext = cleanSample === '\u5c0f\u998b\u732b' || /^[0-9\uff10-\uff19]+\u4f4d\u5c0f\u998b\u732b[.!！。\s]*$/u.test(cleanSample) || /(?:\u5c0f\u998b\u732b\u548c\u8c22\u5b9d\u6797|\u76f4\u64ad\u95f4\u5237\u793c\u7269|\u5e2e\u7740\u5ba3\u4f20|\u5c0f\u998b\u732b\u7b2c\u4e00|\u201c\u5c0f\u998b\u732b\u201d|"\u5c0f\u998b\u732b"|\u5916\u5356|\u70e4\u80a0)/u.test(cleanSample);
    const greedyTeaseContext = /(?:\u4ec0\u4e48\u90fd\u60f3\u5403|\u5168\u90fd\u7ed9\u4f60|\u60f3\u5403|\u8d2a\u5fc3|\u4e0d\u8fc7\u5ba1)/u.test(cleanSample);
    return merchantOrQuotedContext && !greedyTeaseContext;
  }
  if (term === '\u9633\u6c14\u4e0d\u8db3' && family === 'attack') {
    const literalHealthContext = /(?:\u4e2d\u533b|\u5065\u5eb7|\u79d1\u666e|\u8868\u73b0|\u5e38\u89c1|\u81ea\u6211\u8bca\u65ad|\u9633\u865a|\u624b\u811a\u51b0\u51c9|\u6015\u51b7|\u6015\u98ce|\u611f\u5192|\u54b3\u55fd|\u8fc7\u654f\u6027\u9f3b\u708e|\u80c3\u5bd2|\u8179\u6cfb|\u813e\u9633\u4e0d\u8db3|\u591c\u5c3f|\u80be\u9633\u865a|\u517b\u6210\u597d\u4e60\u60ef|\u9632\u9633\u865a|\u6478\u809a\u8110|\u6e29\u5dee)/u.test(cleanSample);
    const insultContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u9a82\u4eba|\u522b\u592a\u865a|\u592a\u865a|\u865a\u4e86|\u5632\u8bbd|\u9634\u9633|\u6025|\u7834\u9632|\u5634\u786c|\u4e0d\u884c)/u.test(cleanSample);
    return literalHealthContext && !insultContext;
  }
  if (term === '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16' && family === 'evasion') {
    const sourceDiscussionContext = /(?:\u5f53\u521d\u770b\u5230|\u53d8\u6210|\u8fd9\u6897|\u6897\u672c\u571f\u5316|\u6897\u77e5\u8bc6|\u662f\u4ec0\u4e48\u6897|\u4ec0\u4e48\u610f\u601d|\u51fa\u81ea|\u6765\u6e90|\u8c10\u97f3)/u.test(cleanSample);
    const directMemeUseContext = /(?:\u61c2\u4e86\u5427|\u7f62\u4e00\u9f84|\u7f62\u5df2\u96f6|\u9038\u4e45\u5fc6\u65e7|114514.*\u61c2|\u96f7\u666e)/u.test(cleanSample);
    return sourceDiscussionContext && !directMemeUseContext;
  }
  if (term === '\u610f\u6deb' && family === 'attack') {
    const literalSexualFantasyContext = /(?:\u6027\u5e7b\u60f3|\u4e24\u6027|\u79c1\u5bc6|\u53d8\u6001|\u5077\u62cd|\u88ab\u4eba\u610f\u6deb|\u4f9b\u5176\u610f\u6deb|\u8ba8\u538c\u610f\u6deb|\u5f88\u6076\u5fc3|\u6211\u7684\u8138|\u7248\u6743|\u81ea\u604b|\u4e3a\u7231\u75eb\u72c2)/u.test(cleanSample);
    const unrealisticClaimContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5bf9\u65b9|\u4f1a\u9053\u6b49|\u522b\u505a\u68a6|\u505a\u68a6|\u81ea\u5df1\u8111\u8865|\u7a7a\u60f3|\u4e0d\u5207\u5b9e\u9645|\u81c6\u60f3|\u8fd8\u60f3|\u771f\u4ee5\u4e3a)/u.test(cleanSample);
    return literalSexualFantasyContext && !unrealisticClaimContext;
  }
  if (term === '\u5e94\u6fc0' && family === 'attack') {
    const literalBiologicalStressContext = /(?:\u514d\u75ab\u529b|\u65b0\u4eba\u597d\u5947|\u706b\u7130|\u62ff\u56de\u5bb6|\u5e94\u6fc0\u6b7b|\u50f5\u76f4|\u4e4c\u9f9f|\u9f9f|\u732b|\u5ba0|\u5ba0\u7269|\u6c34\u9f9f|\u5e38\u89c1\u75c7\u72b6|\u5e72\u9884|\u6062\u590d|\u9884\u9632|\u533b|\u751f\u7406|\u75c7\u72b6)/u.test(cleanSample);
    const overreactionContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6\u4eec|\u770b\u89c1|\u7c73\u54c8\u6e38|\u522b\u592a\u6025|\u592a\u6025|\u7834\u9632|\u6025\u4e86|\u62bd\u5361|\u8282\u594f|\u9ed1|\u7c89\u4e1d|\u5c31\u5e94\u6fc0)/u.test(cleanSample);
    return literalBiologicalStressContext && !overreactionContext;
  }
  if (term === '\u8f6c\u884c' && family === 'attack') {
    const literalCareerContext = /(?:\u540e\u671f\u8f6c\u884c|\u8f6c\u884c\u7684\u5efa\u8bae|0\u57fa\u7840\u8f6c\u884c|30\\+40\\+.*\u8f6c\u884c|\u8f6c\u884c\u5356\u753b.*\u4e00\u76f4\u90fd\u662f\u753b\u753b|\u6211\u8bb0\u5f97\u4ed6\u4e00\u76f4\u90fd\u662f\u753b\u753b|\u6570\u636e\u5206\u6790|\u5c97\u4f4d|\u5b66\u4f4d|\u4e13\u4e1a\u79d1\u73ed|\u534a\u8def\u51fa\u5bb6|\u804c\u573a|\u5e02\u573a\u9500\u552e|\u627e\u5176\u4ed6\u5de5\u4f5c)/u.test(cleanSample);
    const mockCareerContext = /(?:\u4e0d\u5982\u8f6c\u884c|\u8f6c\u884c\u5356\u8bfe|\u8f6c\u884c\u5f53\u5c0f\u4e11|\u522b\u5e72\u4e86|\u8fd8\u662f\u8f6c\u884c|\u8d5b\u9053|\u535a\u4e3b|\u8fd9up|\u7b97\u4e86|\u5632\u8bbd|\u9634\u9633)/u.test(cleanSample);
    return literalCareerContext && !mockCareerContext;
  }
  if (term === '\u5634\u66ff' && family === 'cooperation') {
    const negatedContext = /(?:\u4e0d\u662f.*\u5634\u66ff|\u522b\u5634\u66ff|\u7b97\u4ec0\u4e48\u5634\u66ff)/u.test(cleanSample);
    if (negatedContext) return true;
    const dismissiveContext = /(?:\u5634\u66ff\u6709\u5c41\u7528|\u5634\u66ff\u6ca1\u7528|\u65e0\u80fd\u72c2\u6012)/u.test(cleanSample);
    const agreementContext = /(?:\u5fc3\u91cc\u7684\u8bdd|\u5634\u66ff\u51fa\u6765|\u6700\u5f3a\u5634\u66ff|\u6211\u7684\u5634\u66ff|\u8bf4\u51fa\u4e86|\u66ff\u6211\u8bf4|\u89c2\u4f17\u5634\u66ff|\u6253\u5de5\u4eba\u5634\u66ff)/u.test(cleanSample);
    return dismissiveContext && !agreementContext;
  }
  if (term === '\u6700\u540e\u4e00\u821e' && family === 'evasion') {
    const retirementOrPerformanceContext = /(?:\u6700\u540e\u4e00\u6b66|\u6700\u540e\u4e00\u821e.*\u6700\u540e\u4e00\u6b66|\u6709\u6c34\u51c6|\u7a76\u6781\u4e00\u821e|\u53d1\u72c2\u4e00\u821e|\u5f15\u9000|\u4e0d\u820d|\u514b\u7f57\u65af|\u7403\u8ff7|\u4f53\u80b2|\u8db3\u7403|\u8d5b\u573a|\u8df3\u821e|\u8868\u6f14)/u.test(cleanSample);
    const lastBetContext = /(?:\u5168\u538b|\u68ad\u54c8|\u8d62\u4e86|\u8f93\u4e86|\u4e0a\u5cb8|\u8d4c|\u6700\u540e\u4e00\u628a|\u5192\u9669|\u56de\u672c|\u7b97\u4e86)/u.test(cleanSample);
    return retirementOrPerformanceContext && !lastBetContext;
  }
  if (term === 'doge\u5723\u8bde' && family === 'cooperation') {
    const standaloneLaughEmoteContext = /^(?:\u54c8)+(?:doge\u5723\u8bde)+$/u.test(cleanSample);
    const jokeContext = /(?:\u6beb\u65e0\u8fdd\u548c|\u5973\u88c5|\u624b\u52a8doge|\u53cd\u8bbd|\u73a9\u7b11|\u4fdd\u547d|\u4e0d\u8981\u9a82|doge)/iu.test(cleanSample) && !standaloneLaughEmoteContext;
    return standaloneLaughEmoteContext && !jokeContext;
  }
  if (term === '腐乳' && family === 'attack') {
    return /(?:潮汕|大排档|豆酱|通菜|炒|好吃|美味|蘸料|调味|下饭|白粥|酱|菜)/u.test(cleanSample) && !/(?:叛徒|出列|黑|喷|骂|攻击|孝|急|破防)/u.test(cleanSample);
  }
  if (term === '\u997a\u5b50\u8001\u516b' && family === 'attack') {
    const standaloneEmoteContext = /^(?:\u997a\u5b50\u8001\u516b)(?:doge|\u6ed1\u7a3d|\u7b11\u54ed|\u5403\u74dc)*$/iu.test(cleanSample);
    const directedAttackContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8fd9\u79cd|\u6d17\u767d|\u522b\u88c5|\u9a82|\u4fae\u8fb1|\u738b\u516b|\u8001\u516b)/u.test(cleanSample) && !standaloneEmoteContext;
    return standaloneEmoteContext && !directedAttackContext;
  }
  if (term === '\u997a\u5b50\u738b\u516b' && family === 'attack') {
    const standaloneEmoteContext = /^(?:\u997a\u5b50\u738b\u516b)(?:doge|\u6ed1\u7a3d|\u7b11\u54ed|\u5403\u74dc)*$/iu.test(cleanSample);
    const directedAttackContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8fd9\u79cd|\u6d17\u767d|\u522b\u88c5|\u8bdd\u672f|\u9a82|\u4fae\u8fb1|\u738b\u516b)/u.test(cleanSample) && !standaloneEmoteContext;
    return standaloneEmoteContext && !directedAttackContext;
  }
  if (term === '\u53eb\u8fd9\u4e48\u723d' && family === 'attack') {
    const standalonePhraseContext = cleanSample === '\u53eb\u8fd9\u4e48\u723d';
    const directedMockContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u88ab\u53cd\u9a73|\u6025\u4e86|\u7834\u9632|\u521a.*\u5c31|\u53eb\u8fd9\u4e48\u723d.*\u5417)/u.test(cleanSample) && !standalonePhraseContext;
    return standalonePhraseContext && !directedMockContext;
  }
  if (term === '\u4ecb\u53f8\u9ebb\u82bd' && family === 'attack') {
    const standaloneDialectContext = cleanSample === '\u4ecb\u53f8\u9ebb\u82bd';
    const directedMockContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u8fd9\u6ce2|\u6d17\u767d|\u8bf4\u4e0d\u901a|\u4ec0\u4e48\u4e1c\u897f|\u5c31\u8fd9)/u.test(cleanSample) && !standaloneDialectContext;
    return standaloneDialectContext && !directedMockContext;
  }
  if (term === '\u91d1\u5777\u5783' && family === 'absolutes') {
    const literalMemeContext = /(?:\u9b3c\u755c|up\u4e3b|\u914d\u65b9|\u80a5\u6599|\u5e7f\u544a|\u91d1\u7ebf|\u7f8e\u56fd|\u65e5\u672c|\u975e\u6d32|\u6295\u5e01|\u786c\u5e01|\u73cd\u60dc|\u53ef\u6015|\u53ef\u60b2|\u53ef\u803b)/u.test(cleanSample);
    const absoluteStandardContext = /(?:\u552f\u4e00\u6807\u51c6|\u53ea\u770b|\u68c0\u9a8c\u795e\u66f2|\u6807\u51c6|\u5fc5\u987b|\u4e00\u5b9a|\u7edd\u5bf9)/u.test(cleanSample);
    return literalMemeContext && !absoluteStandardContext;
  }
  if (term === '\u91d1\u624b\u6307' && family === 'attack') {
    const literalCheatCodeContext = /(?:\u5341\u516d\u8fdb\u5236|\u6539\u51fa|\u5b9d\u53ef\u68a6|\u5168\u56fd\u56fe\u9274|\u7f16\u53f7|cheat|switch|\u4fee\u6539\u5668|\u4ee3\u7801|\u5b58\u6863|\u6708\u6842\u53f6)/iu.test(cleanSample);
    const plotCriticismContext = /(?:\u4e3b\u89d2|\u5267\u60c5|\u770b\u5565\u609f\u5565|\u79bb\u8c31|\u4e3b\u89d2\u5149\u73af|\u4e0d\u5408\u7406|\u4ec0\u4e48\u90fd\u9760|\u63a8\u8fc7\u53bb|\u8bbe\u5b9a)/u.test(cleanSample);
    return literalCheatCodeContext && !plotCriticismContext;
  }
  if (term === '\u7ecf\u5178\u52a0\u94b1' && family === 'attack') {
    const standaloneMemeContext = cleanSample === '\u7ecf\u5178\u52a0\u94b1';
    const budgetDismissalContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u5957|\u63a8\u8350|\u914d\u7f6e|\u4e0d\u770b|\u9884\u7b97|\u6d88\u8d39|\u5347\u7ea7|\u53c8\u662f)/u.test(cleanSample) && !standaloneMemeContext;
    return standaloneMemeContext && !budgetDismissalContext;
  }
  if (term === '\u5173\u4e86\u5427\u6ca1\u610f\u601d' && family === 'attack') {
    const embeddedLeBaContext = /\u9ed1\u516c\u5173\u4e86\u5427|\u4ec0\u4e48\u53eb.*\u4e86\u5427/u.test(cleanSample);
    const exactDismissalContext = cleanSample.includes('\u5173\u4e86\u5427\u6ca1\u610f\u601d')
      || /(?:\u5173\u4e86\u5427|\u522b\u64ad\u4e86).*(?:\u6ca1\u610f\u601d|\u6ca1\u6d3b|\u65e0\u804a)|(?:\u6ca1\u610f\u601d|\u6ca1\u6d3b|\u65e0\u804a).*(?:\u5173\u4e86\u5427|\u522b\u64ad\u4e86)/u.test(cleanSample);
    return !exactDismissalContext || embeddedLeBaContext;
  }
  if (term === '\u592a\u61c2\u4e86' && family === 'attack') {
    const selfReactionContext = /^(?:\u592a\u61c2\u4e86|\u6211\u592a\u61c2\u4e86|\u6211\u61c2\u4e86\uff0c?\u592a\u61c2\u4e86)(?:[!！。~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const sarcasticContext = /(?:\u4f60|\u4f60\u4eec|\u53c8|\u8fd9\u79cd|\u8fd9\u5957|\u61c2\u54e5|\u6559\u5927\u5bb6).*\u592a\u61c2\u4e86|\u592a\u61c2\u4e86.*(?:\u61c2\u54e5|\u6559\u5927\u5bb6|\u53c8\u6765|\u88c5)/u.test(cleanSample);
    return selfReactionContext && !sarcasticContext;
  }
  if (term === '\u5403\u4e8f\u662f\u798f' && family === 'attack') {
    const proverbWishContext = /(?:\u4eba\u4eec\u8bf4|\u4fd7\u8bdd\u8bf4|\u8001\u8bdd\u8bf4).*\u5403\u4e8f\u662f\u798f.*(?:\u6211\u60f3|\u60f3\u5403\u5403\u4e8f)|^\u5403\u4e8f\u662f\u798f(?:[\u3002!！~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const exploitContext = /(?:\u522b|\u4f60|\u4f60\u4eec|\u753b\u997c|\u8ba9\u522b\u4eba|\u9053\u5fb7\u7ed1\u67b6|\u9a97).*\u5403\u4e8f\u662f\u798f|\u5403\u4e8f\u662f\u798f.*(?:\u753b\u997c|\u9053\u5fb7\u7ed1\u67b6|\u9a97|\u8ba9\u522b\u4eba)/u.test(cleanSample);
    return proverbWishContext && !exploitContext;
  }
  if (term === '\u7cbe\u795e\u7537\u4eba' && family === 'attack') {
    const metaContrastContext = /(?:\u53ef\u4ece\u6ca1\u8bf4\u8fc7|\u6ca1\u8fb1\u9a82|\u2260\u6211\u5c31\u662f\u7537\u4eba|\u5979\u610f\u601d\u660e\u663e|\u8ddf\u7cbe\u795e\u7537\u4eba\u6700\u4e0d\u4e00\u6837|\u4e0d\u7528\u523b\u610f\u8ba9\u7740\u6211)/u.test(cleanSample);
    const labelAttackContext = /(?:\u8fd9\u79cd\u8a00\u8bba|\u5f53\u8363\u8a89|\u8e29\u81ea\u5df1\u4eba|\u53cd\u8fc7\u6765|\u8d2c\u4f4e|\u522b\u5f53)/u.test(cleanSample);
    return metaContrastContext && !labelAttackContext;
  }
  if (term === '\u8b66\u60d5\u901f\u80dc\u8bba' && family === 'attack') {
    const titleTrafficAdviceContext = /(?:\u5efa\u8baeup|\u89c6\u9891\u540d\u5b57|\u6807\u9898|\u5c31\u52a0\u4e0a|\u70b9\u8fdb\u6765|\u4f1a\u66f4\u591a|\u5f15\u6d41)/u.test(cleanSample);
    const dismissiveArgumentContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6\u4eec|\u8fd8\u5728|\u8fde.*\u90fd\u6ca1|\u57fa\u672c\u6750\u6599|\u6ca1\u770b\u5b8c|\u522b|\u6025|\u6025\u4e8e)/u.test(cleanSample);
    return titleTrafficAdviceContext && !dismissiveArgumentContext;
  }
  if (term === '\u7ea0\u6b63\u54e5' && family === 'attack') {
    const nicknameOrNameQualityContext = /(?:\u73b0\u5728\u5728\u6296\u97f3|\u53eb\u54e5\u5c31\u884c|\u6709\u70b9\u4e0d\u548b\u597d\u542c|\u540d\u5b57|\u7f51\u540d|\u8d26\u53f7|\u4e3b\u9875|\u6296\u97f3|\u5feb\u624b)/u.test(cleanSample);
    const correctionAttackContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u79cd|\u9022\u5b57\u5c31\u6539|\u4e0d\u662f\u8ba8\u8bba|\u6760|\u6311\u9519|\u54ac\u6587\u56bc\u5b57|\u627e\u832c)/u.test(cleanSample);
    return nicknameOrNameQualityContext && !correctionAttackContext;
  }
  if (['\u6485\u9192', '\u6485\u9192\u4eba', '\u6485\u9192\u8005'].includes(term) && family === 'attack') {
    const standaloneChantContext = cleanSample === '\u6485\u9192' || cleanSample === '\u6485\u9192\u4eba' || cleanSample === '\u6485\u9192\u8005';
    const neutralDistinctionContext = /(?:\u6485\u9192\u8005\u548c\u89c9\u9192\u8005|\u6485\u9192\u4eba\u548c\u89c9\u9192\u4eba|\u5f88\u5bb9\u6613\u533a\u5206|\u600e\u4e48\u533a\u5206|\u533a\u522b\u5728\u54ea)/u.test(cleanSample);
    const directedLabelContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u7fa4|\u8fd9\u5957|\u8bdd\u672f|\u6253\u6210|\u53cd\u52a8|\u7acb\u573a\u95ee\u9898|\u53c8\u5f00\u59cb|\u6263\u5e3d\u5b50|\u4e0d\u662f\u8ba8\u8bba)/u.test(cleanSample);
    return (standaloneChantContext || neutralDistinctionContext) && !directedLabelContext;
  }
  if (term === 'wdnmd' && family === 'attack') {
    const sourceOrStandaloneMemeContext = /(?:wdnmd\u8fd9\u4e2a\u90fd\u4e0d\u706b|\u70ed\u8bcd\u7cfb\u5217|\u4ec0\u4e48\u6897|\u6897\u6307\u5357|\u662f\u4ec0\u4e48\u6897|^wdnmd$|^\u56de\u590d[a-z0-9_]*wdnmd[a-z0-9_]*\b)/iu.test(cleanSample);
    const directedInsultContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u64cd\u4f5c|\u522b\u9a82|\u9a82\u4eba|\u771f\u83dc|\u5f00\u53e3|wdnmd.*\u4f60)/iu.test(cleanSample);
    return sourceOrStandaloneMemeContext && !directedInsultContext;
  }
  if (term === '\u5de5\u4fe1\u90e8\u6295\u8bc9' && family === 'evidence') {
    const literalConsumerRightsContext = /(?:\u6211\u5de5\u4fe1\u90e8\u6295\u8bc9\u4e86|\u627e\u5de5\u4fe1\u90e8\u6295\u8bc9|\u5305\u6709\u7528|\u4e2d\u56fd\u79fb\u52a8|\u4e2d\u56fd\u7535\u4fe1|\u5957\u9910|\u6d41\u91cf|\u8d44\u8d39|\u5ba2\u670d|\u8fd0\u8425\u5546|\u8865\u507f|\u8d54\u507f|\u4fdd\u53f7\u5957\u9910|\u643a\u8f6c|\u9000\u8d39|\u12315)/u.test(cleanSample);
    const threatContext = /(?:\u4f60|\u4f60\u4eec|\u518d\u4e0d|\u4e0d\u6539|\u865a\u5047\u5ba3\u4f20|\u6211\u5c31|\u7acb\u9a6c|\u76f4\u63a5|\u7b49\u7740|\u53bb\u6295\u8bc9\u4f60)/u.test(cleanSample);
    return literalConsumerRightsContext && !threatContext;
  }
  if (term === '\u5b64\u52c7\u8005' && family === 'cooperation') {
    const songOrPerformanceContext = /(?:\u6b4c\u8bcd|\u5347\u8c03|\u9648\u5955\u8fc5|\u6f14\u5531|\u7ffb\u5531|\u539f\u5531|\u4f34\u594f|\u7248\u672c|\u914d.*\u6b4c|\u914d\u751c\u871c\u871c|\u771f\u8fd8\u884c|\u597d\u542c|\u96be\u542c|\u8dd1\u8c03|\u7834\u97f3|\u821e\u53f0|\u6f14\u51fa)/u.test(cleanSample);
    const praiseCourageContext = /(?:\u7f51\u66b4|\u53d1\u58f0|\u6562\u4e8e|\u7ad9\u51fa\u6765|\u5bf9\u6297|\u6b63\u4e49|\u4e0d\u6015|\u771f\u6b63\u7684\u5b64\u52c7\u8005|\u4ed6\u624d\u662f|\u5979\u624d\u662f)/u.test(cleanSample);
    return songOrPerformanceContext && !praiseCourageContext;
  }
  if (term === '\u5c81\u6708\u795e\u5077' && family === 'attack') {
    const songOrTitleContext = cleanSample === '\u5c81\u6708\u795e\u5077' || /(?:\u300a\u5c81\u6708\u795e\u5077\u300b|\u65e0\u635f|\u91d1\u73df\u5c90|\u4e0b\u8f7d\u94fe\u63a5|b23tv|\u54d4\u54e9\u54d4\u54e9|\u80fd\u591f\u63e1\u7d27\u7684\u5c31\u522b\u653e\u4e86|\u80fd\u591f\u62e5\u62b1\u7684\u5c31\u522b\u62c9\u626f|\u65f6\u95f4\u7740\u6025\u7684\u51b2\u5237|\u6b4c\u8bcd|\u7ffb\u5531|\u539f\u5531|\u6f14\u5531)/u.test(cleanSample);
    const theftMetaphorContext = /(?:\u62a2\u8d70|\u7a83\u53d6|\u522b\u4eba\u7684\u673a\u4f1a|\u522b\u4eba\u7684\u6210\u5c31|\u4e0d\u6b63\u5f53|\u88ab\u62a2|\u62a2\u529f)/u.test(cleanSample);
    return songOrTitleContext && !theftMetaphorContext;
  }
  if (term === '\u9e21\u8d3c' && family === 'attack') {
    const pvzChickenZombieContext = /(?:\u5927\u55b7\u83c7|\u5730\u523a|\u51b0\u897f\u74dc|\u50f5\u5c38|\u690d\u7269|\u897f\u74dc\u5b50\u5f39|\u4e8c\u4ee3\u8bbe\u8ba1|\u9e21\u591a|\u9e21\u8d3c\u4e00\u51fa)/u.test(cleanSample);
    const slyPersonContext = /(?:\u5403\u76f8|\u5360\u4fbf\u5b9c|\u800d\u5c0f\u806a\u660e|\u7b97\u8ba1|\u5957\u8def|\u5fc3\u773c|\u9634|\u574f|\u4fbf\u5b9c)/u.test(cleanSample);
    return pvzChickenZombieContext && !slyPersonContext;
  }
  if (term === '\u6781\u9650\u6a21\u5f0f' && family === 'cooperation') {
    const literalGameModeContext = /(?:\u5907\u4efd|\u5b58\u6863|\u73a9\u6781\u9650\u6a21\u5f0f|\u4e0d\u662f\u6781\u9650\u6a21\u5f0f\u5417|\u6e38\u620f|\u901a\u5173|\u5f00\u6863|\u96be\u5ea6|\u5b58\u6863\u7684\u8bdd|\u5ca9\u6d46|\u65b9\u5757|\u76f4\u63a5\u6b7b\u4e86|\u6b63\u5e38\u4eba\u5f00\u7684)/u.test(cleanSample);
    const metaphorHardModeContext = /(?:\u9879\u76ee|\u5de5\u671f|\u751f\u6d3b|\u4eba\u751f|\u5de5\u4f5c|\u88ab\u538b\u5230|\u5f88\u96be\u9876|\u73b0\u5b9e|\u72b6\u6001)/u.test(cleanSample);
    return literalGameModeContext && !metaphorHardModeContext;
  }
  if (term === '\u6025\u6b7b\u4e86' && family === 'attack') {
    const selfEmotionContext = /(?:\u521a\u4e70|\u809d\u4e86|\u6211\u771f|\u6211\u90fd|\u771f\u7684\u6025\u6b7b\u4e86|\u7b49\u4e0d\u5230|\u597d\u7740\u6025|\u6211\u5feb)/u.test(cleanSample);
    const mockOtherContext = /(?:\u5546\u4eba|\u7b56\u5212|\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u9ed1\u5b50|\u7c89\u4e1d|\u6025\u6b7b\u4ed6|\u6025\u6b7b\u4f60|\u6025\u4e86)/u.test(cleanSample);
    return selfEmotionContext && !mockOtherContext;
  }
  if (term === '\u96c6\u7f8e' && family === 'cooperation') {
    const adLikeBestieContext = /(?:\u95fa\u871c\u7ed9\u6211\u63a8\u8350|\u51fa\u5dee.*\u63a8\u8350\u4e86\u8fd9\u4e00\u6b3e\u6e38\u620f|\u524d\u51e0\u5929\u53bb.*\u51fa\u5dee)/u.test(cleanSample);
    const directSisterAddressContext = /(?:\u96c6\u7f8e|\u59d0\u59b9|\u59d0\u4eec|\u96c6\u7f8e\u4eec)/u.test(cleanSample);
    return adLikeBestieContext && !directSisterAddressContext;
  }
  if (term === '\u4ea4\u4ee3\u6e05\u695a' && family === 'cooperation') {
    const coerciveThreatContext = /(?:\u8111\u888b\u5f00\u82b1|\u4e0d\u5f00\u82b1|\u7b49\u7740|\u4e0d\u4ea4\u4ee3|\u6328\u6253|\u62b1\u5934|\u6b20\u6253|\u5f00\u76d2|\u5a01\u80c1)/u.test(cleanSample);
    const rationalClarificationContext = /(?:\u65f6\u95f4\u7ebf|\u8bf4\u660e|\u8bc1\u636e|\u89e3\u91ca|\u5927\u5bb6\u518d\u8ba8\u8bba|\u6765\u9f99\u53bb\u8109|\u8be6\u7ec6|\u8865\u5145|\u539f\u56e0)/u.test(cleanSample);
    return coerciveThreatContext && !rationalClarificationContext;
  }
  if (term === '\u624b\u6495' && family === 'attack') {
    const literalFoodContext = /(?:\u624b\u6495\u5305\u83dc|\u624b\u6495\u9e21|\u624b\u6495\u725b\u8089|\u624b\u6495\u996d|\u4e0d\u9700\u8981\u5207\u83dc|\u6392\u9aa8|\u505a\u83dc|\u83dc)/u.test(cleanSample);
    const rhetoricalAttackContext = /(?:\u88ab\u5f53\u573a\u624b\u6495|\u624b\u6495.*(?:\u8bdd\u672f|\u8c0e\u8a00|\u8c23\u8a00|\u9ed1\u6599|\u5047\u8bdd)|(?:\u8bdd\u672f|\u8c0e\u8a00|\u8c23\u8a00|\u9ed1\u6599|\u5047\u8bdd).*\u624b\u6495|\u624b\u6495\u5bf9\u65b9|\u624b\u6495\u4f60)/u.test(cleanSample);
    return literalFoodContext && !rhetoricalAttackContext;
  }
  if (term === '\u597d\u6b7b' && family === 'attack') {
    const idiomContext = /\u597d\u6b7b\u4e0d\u5982\u8d56\u6d3b\u7740/u.test(cleanSample);
    const celebratoryContext = /(?:\u597d\u6b7b[\uff01!]|(?:\u4ed6|\u5979|\u8fd9\u4eba|\u8fd9\u79cd\u4eba).*\u597d\u6b7b|\u6b7b\u5f97\u597d|\u5f00\u9999\u69df)/u.test(cleanSample);
    return idiomContext && !celebratoryContext;
  }
  if (['\u4e09\u963f\u54e5', '\u7687\u4e0a', '\u8001\u56db'].includes(term) && family === 'attack') {
    const palaceDramaContext = /(?:\u96cd\u6b63|\u5eb7\u7199|\u4e7e\u9686|\u5f18\u65f6|\u5f18\u5386|\u80e4\u7965|\u80e4\u793d|\u963f\u54e5|\u7687\u4e0a|\u526a\u79cb|\u7504\u5b1b\u4f20|\u5bab\u6597|\u7acb\u50a8|\u4f20\u4f4d|\u7ee7\u627f\u4eba|\u5e9f\u592a\u5b50)/u.test(cleanSample);
    const sarcasticAuthorityContext = /(?:\u60a8\u662f\u7687\u4e0a|\u4f60\u5f53\u81ea\u5df1\u662f\u7687\u4e0a|\u8001\u56db.*(?:\u6025|\u6d17|\u5439)|\u4e09\u963f\u54e5.*(?:\u7c89|\u6d17|\u62a4))/u.test(cleanSample);
    return palaceDramaContext && !sarcasticAuthorityContext;
  }
  if (term === '\u6211\u9519\u4e86' && family === 'correction') {
    const hypotheticalOrAggressiveContext = /(?:\u5982\u679c\u6211\u9519\u4e86|\u8981\u662f\u6211\u9519\u4e86|\u4f60\u6765\u6253\u6211|\u4f60\u6765\u9a82\u6211|\u5973\u6743|\u62e5\u8d38\u8005|\u755c\u7272|\u5783\u573e|\u86c0\u866b|\u4e3a\u864e\u4f5c\u4f25|\u98a0\u5012\u9ed1\u767d)/u.test(cleanSample);
    const explicitCorrectionContext = /(?:\u770b\u9519|\u8bf4\u9519|\u641e\u9519|\u5f04\u9519|\u8bb0\u9519|\u6211\u9519\u4e86.*(?:\u6539\u7ed3\u8bba|\u6536\u56de|\u4fee\u6b63|\u66f4\u6b63|\u8865\u5145)|(?:\u6539\u7ed3\u8bba|\u6536\u56de|\u4fee\u6b63|\u66f4\u6b63|\u8865\u5145).*\u6211\u9519\u4e86)/u.test(cleanSample);
    return hypotheticalOrAggressiveContext && !explicitCorrectionContext;
  }
  if (term === '\u6539\u90aa\u5f52\u6b63' && family === 'cooperation') {
    const negatedContext = /(?:\u5e76\u975e|\u4e0d\u662f|\u6ca1\u6709|\u8fd8\u6ca1|\u672a)\u6539\u90aa\u5f52\u6b63/u.test(cleanSample);
    const positiveContext = /(?:\u73b0\u5df2|\u5df2\u7ecf|\u7ec8\u4e8e|\u603b\u7b97|\u5f00\u59cb)\u6539\u90aa\u5f52\u6b63|\u6539\u90aa\u5f52\u6b63\u4e86/u.test(cleanSample);
    return negatedContext && !positiveContext;
  }
  if (term === '\u5c4f\u853d' && family === 'cooperation') {
    const platformModerationContext = /(?:\u8bc4\u8bba\u533a\u5c4f\u853d|\u5c4f\u853d\u8bcd|\u5c4f\u853d\u5173\u952e\u5b57|\u5c4f\u853d\u811a\u672c|\u81ea\u52a8\u5316\u5c4f\u853d|\u5c4f\u853d\u8bc4\u8bba|\u5c4f\u853d\u7528\u6237|\u5c4f\u853d\u5217\u8868|\u5c4f\u853d\u90a3\u51e0\u4e2a|\u5c4f\u853d.*up|\u5c4f\u853d\u5668|\u5c4f\u853d\u6309\u952e|\u5c4f\u853d\u4e86|\u628a\u4eba\u7ed9\u5c4f\u853d|\u770b\u4e0d\u5230\u4ed6\u7684\u4fe1\u606f)/iu.test(cleanSample);
    const discussionDeescalationContext = /(?:\u5148\u5c4f\u853d.*(?:\u8c29\u9a82|\u4eba\u8eab\u653b\u51fb|\u5783\u573e\u4fe1\u606f|\u5e7f\u544a).*(?:\u518d\u8ba8\u8bba|\u597d\u597d\u8ba8\u8bba|\u7406\u6027\u8ba8\u8bba)|\u5c4f\u853d.*(?:\u964d\u4f4e\u5bf9\u7acb|\u907f\u514d\u5435\u67b6|\u51cf\u5c11\u5e72\u6270))/u.test(cleanSample);
    return platformModerationContext && !discussionDeescalationContext;
  }
  if (term === '\u4e09\u89d2\u8d38\u6613' && family === 'cooperation') {
    const cyberOrLiteralMemeContext = /(?:\u8d5b\u535a\u4e09\u89d2\u8d38\u6613|\u4ec0\u4e48.*\u4e09\u89d2\u8d38\u6613|\u4e09\u89d2\u8d38\u6613[\u7b11\u54eddoge]*$|\u5386\u53f2|\u8d38\u6613\u8def\u7ebf|\u4e70\u5356|\u5012\u5356)/u.test(cleanSample);
    const cooperativeExchangeContext = /(?:\u4e92\u6362|\u4ea4\u6362\u8d44\u6599|\u4f60\u7ed9\u6211|\u6211\u7ed9\u4f60|\u5408\u4f5c|\u4e92\u76f8\u63d0\u4f9b)/u.test(cleanSample);
    return cyberOrLiteralMemeContext && !cooperativeExchangeContext;
  }
  if (term === '\u4e09\u8fde\u9001\u4e0a' && family === 'cooperation') {
    const engagementOnlyContext = /(?:^\u4e09\u8fde\u9001\u4e0a[~\uff5e!！]*$|\u4e09\u8fde\u9001\u4e0a[\u7b11\u54eddoge]*$|\u5df2\u4e09\u8fde|\u6c42\u4e09\u8fde|\u4e00\u952e\u4e09\u8fde)/iu.test(cleanSample);
    const discussionSupportContext = /(?:\u8bf4\u5f97\u6709\u7406|\u8865\u5145|\u8bc1\u636e|\u5206\u6790|\u8ba8\u8bba|\u5b66\u5230).*\u4e09\u8fde\u9001\u4e0a/u.test(cleanSample);
    return engagementOnlyContext && !discussionSupportContext;
  }
  if (term === '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50' && family === 'correction') {
    const standaloneImperativeContext = cleanSample === '\u7981\u6b62\u81ea\u5a31\u81ea\u4e50' || /(?:^\u7981\u6b62\u81ea\u5a31\u81ea\u4e50[!！。]*$|\u7981\u6b62\u81ea\u5a31\u81ea\u4e50[\u7b11\u54eddoge]*$)/iu.test(cleanSample);
    const selfCorrectionContext = /(?:\u6211|\u6211\u4eec).*(?:\u7981\u6b62\u81ea\u5a31\u81ea\u4e50|\u522b\u81ea\u5a31\u81ea\u4e50).*(?:\u56de\u5230|\u6539|\u4fee\u6b63|\u8865\u5145|\u8ba8\u8bba)/u.test(cleanSample);
    return standaloneImperativeContext && !selfCorrectionContext;
  }
  if (term === '\u7231\u548b\u548b\u5730' && family === 'evasion') {
    const selfHelpContext = /(?:\u8001\u5e08|\u544a\u8bc9\u81ea\u5df1|\u4e0d\u8981\u6015|\u5bb3\u6015|\u505a\u4e0d\u5230|\u8ddf\u81ea\u5df1\u6ca1\u5173\u7cfb|\u6211\u5565\u4e8b\u90fd\u6ca1\u6709|\u88ab\u4eba\u770b\u4e0d\u8d77|\u53d7\u6b3a\u8d1f|\u88ab\u5931\u4e1a|\u6ca1\u4eba\u80fd\u505a\u5230).*\u7231\u548b\u548b\u5730|\u7231\u548b\u548b\u5730.*(?:\u6211\u5f88\u5065\u5eb7|\u505a\u5230|\u6ca1\u4eba\u80fd\u505a\u5230|\u4e0d\u4f1a\u5c11\u4e24\u5757\u8089)/u.test(cleanSample);
    const dismissiveContext = /(?:\u8bc1\u636e|\u8d44\u6599|\u6765\u6e90|\u89e3\u91ca|\u56de\u590d|\u6211\u4e0d\u7ba1|\u968f\u4fbf|\u522b\u95ee|\u61d2\u5f97|\u4e0d\u8d34).*\u7231\u548b\u548b\u5730|\u7231\u548b\u548b\u5730.*(?:\u522b\u95ee|\u4e0d\u89e3\u91ca|\u61d2\u5f97|\u4e0d\u8d34|\u4e0d\u7ba1)/u.test(cleanSample);
    return selfHelpContext && !dismissiveContext;
  }
  if (term === '\u53cd\u6b63\u6211\u4eec\u8d62\u9ebb\u4e86' && family === 'attack') {
    const liveEnjoymentContext = /(?:\u6c88\u9633|\u5317\u4eac|\u4e0a\u6d77|\u6f14\u5531\u4f1a|\u73b0\u573a|\u770b\u4e86\u73b0\u573a).{0,8}\u8d62\u9ebb(?:\u4e86)?|\u8d62\u9ebb(?:\u4e86)?.{0,8}(?:\u73b0\u573a|\u6f14\u5531\u4f1a|\u7968)/u.test(cleanSample);
    const factionBragContext = /(?:\u53cd\u6b63|\u6211\u4eec|\u4f60\u4eec|\u627e\u8bc1\u636e|\u8fd8\u5728|\u5df2\u7ecf).*\u8d62\u9ebb(?:\u4e86)?|\u8d62\u9ebb(?:\u4e86)?.*(?:\u8fd8\u5634\u786c|\u522b\u6d17|\u4f60\u4eec|\u5bf9\u9762)/u.test(cleanSample);
    return liveEnjoymentContext && !factionBragContext;
  }
  if (term === '\u6ca1\u7075\u9b42' && family === 'attack') {
    const negatedDefenseContext = /(?:\u4e0d\u662f\u6ca1\u7075\u9b42|\u4e0d\u662f.*\u6ca1\u7075\u9b42.*\u662f|\u8bf4\u7075\u9b42\u7684.*\u8bef\u5bfc)/u.test(cleanSample);
    const critiqueContext = /(?:\u6ca1\u7075\u9b42).*(?:\u6d17\u7a3f|\u673a\u68b0|\u4e3a\u4e86\u79c0|\u50cfai|\u50cf\u673a\u5668)|(?:\u56de\u7b54|\u5531|\u4f5c\u54c1|\u8868\u6f14).*\u6ca1\u7075\u9b42/u.test(cleanSample);
    return negatedDefenseContext && !critiqueContext;
  }
  if (term === '\u771fcs' && family === 'attack') {
    const gameOrStandaloneContext = /^(?:\u8fd9\u662f)?\u771fcs$/iu.test(cleanSample) || /(?:counter-strike|\bcs\b|\u53cd\u6050\u7cbe\u82f1|\u6e38\u620f|fps)/iu.test(cleanSample);
    const insultContext = /(?:\u4f60|\u4f60\u4eec|\u4ed6|\u5979|\u522b\u88c5|\u9a82|\u771fcs\uff0c|\u771fcs,)/iu.test(cleanSample);
    return gameOrStandaloneContext && !insultContext;
  }
  if (term === '\u53ef\u4ee5\u8d34' && family === 'cooperation') {
    const alreadyPublishedContext = /(?:\u8001\u5e08|\u4f60|\u81ea\u5df1).{0,8}(?:\u53d1\u51fa\u6765\u4e86|\u8d34\u51fa\u6765\u4e86|\u53d1\u4e86|\u8d34\u4e86)/u.test(cleanSample);
    const requestContext = /(?:\u53ef\u4ee5|\u80fd|\u9ebb\u70e6|\u6c42).{0,6}(?:\u8d34|\u53d1).{0,8}(?:\u8bc1\u636e|\u539f\u56fe|\u56fe|\u94fe\u63a5|\u6765\u6e90)|(?:\u8bc1\u636e|\u539f\u56fe|\u56fe|\u94fe\u63a5|\u6765\u6e90).{0,8}(?:\u8d34|\u53d1)/u.test(cleanSample);
    return alreadyPublishedContext && !requestContext;
  }
  if (term === '\u4f60\u4eec\u61c2\u5427' && family === 'evasion') {
    const insultContext = /\u4f60\u4eec\u61c2\u4e2a\u540a|\u4f60\u4eec\u61c2\u4e2a\u9524|\u4f60\u4eec\u61c2\u4ec0\u4e48/u.test(cleanSample);
    const literalUnderstandQuestionContext = /\u4f60\u4eec\u61c2.{0,16}(?:\u662f\u4ec0\u4e48\u6982\u5ff5|\u4ec0\u4e48\u6982\u5ff5|\u5417|\uff1f|\?)/u.test(cleanSample) && !cleanSample.includes('\u4f60\u4eec\u61c2\u5427');
    const hintContext = /(?:\u7ec6\u8282|\u539f\u56e0|\u540d\u5b57|\u4e0d\u80fd\u8bf4|\u4e0d\u65b9\u4fbf\u8bf4|\u90fd\u77e5\u9053).*\u4f60\u4eec\u61c2\u5427|\u4f60\u4eec\u61c2\u5427.*(?:\u4e0d\u591a\u8bf4|\u4e0d\u80fd\u8bf4|\u90fd\u77e5\u9053)/u.test(cleanSample);
    return (insultContext || literalUnderstandQuestionContext) && !hintContext;
  }
  if (term === '\u8e6d\u6982\u5ff5' && family === 'attack') {
    const plainHeatContext = /\u8e6d\u70ed\u5ea6/u.test(cleanSample);
    const conceptHijackContext = /(?:\u8e6d\u6982\u5ff5|\u786c\u8e6d.*(?:AI|\u6982\u5ff5)|(?:AI|\u6982\u5ff5).*\u786c\u8e6d)/iu.test(cleanSample);
    return plainHeatContext && !conceptHijackContext;
  }
  if (['\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11', '\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11'].includes(term) && family === 'attack') {
    const standaloneReactionContext = cleanSample === '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11' || cleanSample === '\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11';
    const targetedMockContext = /(?:\u4f60|\u4f60\u4eec|\u8fd9\u6bb5\u8bdd|\u8fd9\u53e5|\u8fd9\u4e2a|\u79bb\u8c31|\u903b\u8f91|\u53d1\u8a00).*(?:\u4eba\u5728)?\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11/u.test(cleanSample);
    return standaloneReactionContext && !targetedMockContext;
  }
  if (term === '\u5b66\u4f1a\u4e86\u5feb\u5220' && family === 'attack') {
    const standaloneMemeContext = /^(?:\u771f)?\u5b66\u4f1a\u4e86\u5feb\u5220(?:[!！。~\s]|(?:\[doge\]))*$/u.test(cleanSample);
    const harmfulInstructionContext = /(?:\u5f00\u76d2|\u6559\u7a0b|\u5bb3\u4eba|\u8fdd\u89c4|\u522b\u6559|\u8fd9\u79cd\u65b9\u6cd5).*\u5b66\u4f1a\u4e86\u5feb\u5220|\u5b66\u4f1a\u4e86\u5feb\u5220.*(?:\u522b\u5bb3\u4eba|\u522b\u6559|\u8fdd\u89c4|\u6559\u7a0b|\u5f00\u76d2)/u.test(cleanSample);
    return standaloneMemeContext && !harmfulInstructionContext;
  }
  return false;
}

function evidenceForTerm(term, text, options = {}) {
  const needles = evidenceNeedlesForTerm(term);
  const family = String(options.family || '').trim();
  let evidenceCount = 0;
  const evidenceSamples = [];
  const evidenceSources = [];
  const source = String(options.source || '').trim();
  const uid = String(options.uid || '').trim();

  for (const line of String(text || '').split(/\r?\n/)) {
    const cleanLine = cleanEvidenceText(line);
    if (!needles.some((needle) => cleanLine.includes(needle))) continue;
    const sample = line.replace(/\s+/g, ' ').trim();
    if (!sample || isAmbiguousBenignEvidenceSample(term, family, sample)) continue;
    evidenceCount += needles.length === 1 ? countOccurrences(cleanLine, needles[0]) : countNonOverlappingNeedleOccurrences(cleanLine, needles);
    if (evidenceSamples.length < 3) {
      const clippedSample = sample.length > 120 ? `${sample.slice(0, 120)}...` : sample;
      evidenceSamples.push(clippedSample);
      if (source || uid) {
        evidenceSources.push({ source, uid, sample: clippedSample });
      }
    }
  }
  return {
    evidenceCount,
    evidenceSamples: unique(evidenceSamples).slice(0, 3),
    evidenceSources: normalizeEvidenceSources(evidenceSources).slice(0, 3),
  };
}

export function filterKeywordEntriesByEvidence(entries = [], text = '', options = {}) {
  const evidenceText = cleanEvidenceText(text);
  if (!evidenceText) return [];
  return normalizeKeywordEntries(entries)
    .map((entry) => ({ ...entry, ...evidenceForTerm(entry.term, text, { ...options, family: entry.family }) }))
    .filter((entry) => entry.evidenceCount > 0);
}

export function findDictionaryEntriesWithTextEvidence(dictionary, text = '', options = {}) {
  const evidenceText = cleanEvidenceText(text);
  if (!evidenceText) return [];
  const excludeTerms = new Set(Array.from(options.excludeTerms || []).map(cleanTerm).filter(Boolean));
  return normalizeKeywordEntries(Array.isArray(dictionary?.entries) ? dictionary.entries : [])
    .filter((entry) => !excludeTerms.has(entry.term))
    .map((entry) => ({ ...entry, ...evidenceForTerm(entry.term, text, { ...options, family: entry.family }) }))
    .filter((entry) => entry.evidenceCount > 0);
}

async function readDictionary(dictionaryPath) {
  try {
    const raw = await readFile(dictionaryPath, 'utf8');
    const current = JSON.parse(raw);
    return {
      version: current.version || 1,
      updatedAt: current.updatedAt || null,
      entries: Array.isArray(current.entries) ? current.entries : [],
      families: current.families || {},
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`Could not read keyword dictionary ${dictionaryPath}: ${error.message}`);
    }
    return { version: 1, updatedAt: null, entries: [], families: {} };
  }
}

export async function writeJsonFileAtomic(filePath, value) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function buildCanonicalDictionarySnapshot(current, now = current?.updatedAt || new Date().toISOString()) {
  const normalizedCurrentEntries = normalizeKeywordEntries(
    (Array.isArray(current?.entries) ? current.entries : []).map(({ variants: _variants, ...entry }) => entry),
  );
  const entryMap = new Map();
  for (const entry of normalizedCurrentEntries) {
    const existing = (Array.isArray(current?.entries) ? current.entries : []).find((item) => cleanKeywordTerm(item.term) === entry.term);
    entryMap.set(entry.term, {
      ...entry,
      updatedAt: existing?.updatedAt || current?.updatedAt || null,
    });
  }
  propagateAliasEvidence(entryMap, now);
  const allEntries = pruneSuffixOnlyFragments([...entryMap.values()]).sort((a, b) => a.family.localeCompare(b.family) || a.term.localeCompare(b.term));
  const families = Object.fromEntries(SUPPORTED_FAMILIES.map((family) => [family, []]));
  for (const entry of allEntries) {
    if (!families[entry.family]) families[entry.family] = [];
    families[entry.family].push(entry.term);
  }
  for (const family of Object.keys(families)) families[family] = unique(families[family]).sort();
  return {
    version: current?.version || 1,
    updatedAt: current?.updatedAt || null,
    entries: allEntries,
    families,
  };
}

export async function mergeEntriesIntoDictionary(entries, options = {}) {
  const dictionaryPath = options.dictionaryPath || DEFAULT_DICTIONARY_PATH;
  const lockPath = options.dictionaryLockPath || `${dictionaryPath}.lock`;
  return withFileLock(lockPath, async () => {
    const current = await readDictionary(dictionaryPath);
    const normalizedEntries = normalizeKeywordEntries(entries);
    const canonicalCurrent = buildCanonicalDictionarySnapshot(current);
    const currentTerms = new Set(canonicalCurrent.entries.map((entry) => entry.term));
    const mergeableEntries = options.existingTermsOnly === true ? normalizedEntries.filter((entry) => currentTerms.has(entry.term)) : normalizedEntries;
    const now = new Date().toISOString();
    const entryMap = new Map();
    for (const entry of canonicalCurrent.entries) {
      entryMap.set(entry.term, { ...entry });
    }
    for (const entry of mergeableEntries) {
      entryMap.set(entry.term, mergeKeywordEntry(entryMap.get(entry.term), entry, now));
    }
    propagateAliasEvidence(entryMap, now);

    const allEntries = pruneSuffixOnlyFragments([...entryMap.values()]).sort((a, b) => a.family.localeCompare(b.family) || a.term.localeCompare(b.term));
    const families = Object.fromEntries(SUPPORTED_FAMILIES.map((family) => [family, []]));
    for (const entry of allEntries) {
      if (!families[entry.family]) families[entry.family] = [];
      families[entry.family].push(entry.term);
    }
    for (const family of Object.keys(families)) families[family] = unique(families[family]).sort();

    const next = {
      version: 1,
      updatedAt: now,
      entries: allEntries,
      families,
    };
    await writeJsonFileAtomic(dictionaryPath, next);
    return next;
  });
}

export async function getDeepSeekConfig(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const baseUrl = String(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const configuredModel = env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
  const configuredEffort = String(env.DEEPSEEK_REASONING_EFFORT || 'medium').trim().toLowerCase();
  const reasoningEffort = REASONING_EFFORTS.has(configuredEffort) ? configuredEffort : 'medium';
  const apiKey = env.DEEPSEEK_API_KEY || '';

  if (!apiKey) {
    return {
      ok: false,
      provider: 'deepseek',
      baseUrl,
      model: configuredModel,
      reasoningEffort,
      available: false,
      keyConfigured: false,
      models: DEEPSEEK_V4_MODELS,
      error: 'DEEPSEEK_API_KEY is not configured.',
    };
  }

  try {
    const response = await fetchImpl(`${baseUrl}/models`, { headers: authHeaders(apiKey) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.data || []).map((model) => model.id).filter(Boolean);
    const model = models.includes(configuredModel)
      ? configuredModel
      : models.find((item) => item === 'deepseek-v4-flash') || models.find((item) => item === 'deepseek-v4-pro') || configuredModel;
    return {
      ok: true,
      provider: 'deepseek',
      baseUrl,
      model,
      configuredModel,
      reasoningEffort,
      available: Boolean(model),
      keyConfigured: true,
      models,
    };
  } catch (error) {
    return {
      ok: true,
      provider: 'deepseek',
      baseUrl,
      model: configuredModel,
      configuredModel,
      reasoningEffort,
      available: true,
      keyConfigured: true,
      models: DEEPSEEK_V4_MODELS,
      warning: `Could not list models: ${error.message}`,
    };
  }
}

function buildKeywordMessages({ text, uid }) {
  const candidates = buildCandidateTerms(text);
  return [
    {
      role: 'system',
      content:
        '你是中文互联网发言关键词抽取器。只输出合法 JSON，不要输出 markdown。你要从 B 站发言样本里抽取真实出现的网络表达、梗、缩写、谐音或固定话术，并归入语义族。',
    },
    {
      role: 'user',
      content: `任务：从发言样本中找出适合加入本地语库的关键词、梗、缩写、谐音或固定话术，并分类。

硬性规则：
1. term 必须是发言样本中连续出现的原文片段，或候选表达中的一项。
2. 禁止输出类别词或普通说明词，例如：攻击、规避、证据、关键词、普通名词。
3. 优先输出 2 到 12 字的中文互联网表达。
4. Read the full comment sentence and its local context before deciding meaning; do not classify by isolated keyword hits, homophones, or meme words alone.
4a. A keyword may appear as a meme, quote, copypasta, title, self-reference, or playful marker. Do not label it attack unless the full sentence uses it to target a person, group, motive, or proposition with hostile function.
5. 如果候选表达不为“无”，必须从候选或样本原文中选择 1 到 8 个最有语用价值的关键词；只有候选表达为“无”且样本没有网络表达时才输出 {"keywords":[]}。
6. 输出 JSON，结构必须是：
{"keywords":[{"term":"词或短语","family":"attack|absolutes|evidence|evasion|cooperation|correction","meaning":"中文含义和语用功能","variants":["变体"],"risk":"high|medium|positive|neutral","confidence":0.0}]}

分类规则：
- attack: 讽刺、阴阳怪气、资格审查、阵营/动机攻击、侮辱性梗。
- absolutes: 绝对化、全称化、没有例外的强断言。
- evidence: 来源、数据、证据、可核验材料相关词。
- evasion: 懂的都懂、自己搜、拒绝解释、转移举证责任。
- cooperation: 可能、限定、澄清、愿意看来源、合作讨论。
- correction: 我错了、说重了、更正、修正、降低结论强度。

候选表达（可选，但不要被候选限制；也可以从样本中发现候选之外的真实连续短语）：
${candidates.length ? candidates.join('、') : '无'}

示例 JSON：
{"keywords":[{"term":"懂的都懂","family":"evasion","meaning":"用圈内默契暗示代替举证","variants":[],"risk":"medium","confidence":0.82}]}

UID: ${uid || 'unknown'}
发言样本：
${String(text || '').slice(0, 6000)}`,
    },
  ];
}

function buildExistingEvidenceMessages(dictionary, { text, uid }) {
  const candidates = normalizeKeywordEntries(Array.isArray(dictionary?.entries) ? dictionary.entries : [])
    .slice(0, 120)
    .map((entry) => ({
      term: entry.term,
      family: entry.family,
      meaning: entry.meaning,
    }));
  return [
    {
      role: 'system',
      content:
        'You map Bilibili source text to an existing local Chinese internet-language dictionary. Output only valid JSON. Never invent new dictionary terms.',
    },
    {
      role: 'user',
      content: `Task: choose zero or more terms from EXISTING_TERMS only when the source text contains an exact evidence phrase that supports that term semantically.
Rules:
1. term must exactly equal one term from EXISTING_TERMS.
2. evidence must be an exact contiguous substring from SOURCE_TEXT.
3. Read the full comment sentence and nearby context before deciding meaning; decide by semantic function, not just isolated keyword hits, spelling, or homophones.
4. Do not output a term if the full sentence does not semantically support the dictionary meaning, even when the term text appears.
4a. If the evidence phrase is only a meme, quote, copypasta, title, self-reference, or playful marker, map it only when that usage matches the dictionary meaning; do not treat it as attack by word surface alone.
5. Do not output a term if you cannot quote exact source evidence.
6. Do not output new terms, variants, explanations, or categories outside the existing dictionary.
7. Output JSON only: {"matches":[{"term":"existing term","evidence":"exact source substring","confidence":0.0}]}

EXISTING_TERMS:
${JSON.stringify(candidates)}

UID: ${uid || 'unknown'}
SOURCE_TEXT:
${String(text || '').slice(0, 6000)}`,
    },
  ];
}

function buildCandidateTerms(text) {
  const value = String(text || '');
  const fromHeuristics = heuristicKeywordEntries(value).map((entry) => entry.term);
  const signalPatterns = [
    /不会真有人[\u4e00-\u9fa5]{0,8}/g,
    /单走(?:一个)?[0-9A-Za-z]+/g,
    /[\u4e00-\u9fa5]{0,4}(?:典中典|赢麻了|绷不住|急了|阴阳怪气|蹭概念|懂哥|小丑|车家军|doge|滑稽)[\u4e00-\u9fa5]{0,4}/gi,
    /[\u4e00-\u9fa5]{0,6}(?:懂的都懂|自己查|不会百度|问百度|懒得解释)[\u4e00-\u9fa5]{0,6}/g,
    /[\u4e00-\u9fa5]{0,6}(?:全是|全都|根本没有|没有一个|必然|绝对|肯定是)[\u4e00-\u9fa5]{0,6}/g,
    /[A-Za-z0-9]{2,12}/g,
  ];
  const matches = [];
  for (const pattern of signalPatterns) {
    for (const match of value.matchAll(pattern)) matches.push(match[0]);
  }
  return unique([...fromHeuristics, ...matches].map(cleanTerm))
    .filter((term) => term.length >= 2 && term.length <= 12 && !STOP_TERMS.has(term) && !/^\d+$/.test(term))
    .slice(0, 80);
}

function heuristicKeywordEntries(text) {
  const patterns = [
    { pattern: /(不会真有人(?:觉得|以为)?)/g, family: 'attack', meaning: '用反问包装资格审查或嘲讽' },
    { pattern: /(典中典|典|孝|急了|绷不住|赢麻了|乐|yygq|阴阳怪气|懂哥|小丑|逆天|闹麻了|唐|猪鼻|破防|急成这样|这就破防)/gi, family: 'attack', meaning: '中文互联网嘲讽或贬低性梗；猪鼻用于批评某人当下行为犯蠢' },
    { pattern: /(单走(?:一个)?[0-9A-Za-z]+|蹭概念|车家军|doge|滑稽|粉红|小粉红|精外|洋奴|殖人|水军|五毛|美分|1450|来电了|你国|贵国|神神|兔兔)/gi, family: 'attack', meaning: '中文互联网弹幕式嘲讽、阵营指称或戏谑表达' },
    { pattern: /(懂的都懂|你自己搜|自己查|不会百度|这还用问|懒得解释|问百度|去百度|百度一下|自己去找|不会搜|这都不知道|常识|不用我教|自己学|去看书|多读书|这还用说|这都不懂)/g, family: 'evasion', meaning: '把举证责任转移给对方' },
    { pattern: /(问百度|去问[^，。！？\s]{1,8})/g, family: 'evasion', meaning: '把解释责任转移到搜索或第三方身上' },
    { pattern: /(全是|全都|根本没有|没有一个|必然|绝对|肯定是|毫无疑问|毋庸置疑|众所周知|谁都|没人|百分百|一律|从古至今)/g, family: 'absolutes', meaning: '缺少限定条件的强断言' },
    { pattern: /(数据|来源|报告|论文|链接|证据|出处|原文|截图|引用|参考文献|有数据吗|来源呢|出处在哪|发链接|上链接|有证据吗|张口就来|查查资料|引用的什么|贴原文|无图无真相|信源|原文在哪|数据来源)/g, family: 'evidence', meaning: '要求或提供可核验证据' },
    { pattern: /(可能|不一定|如果有|可以贴|我理解|补充一下|据我所知|就我所见|目前看来|仅供参考|个人看法|在我看来|有一说一|确实|我是觉得|我认为|我觉得|应该|也许|大概|或许|有可能是|让我补充|提供一下)/g, family: 'cooperation', meaning: '合作讨论或条件化表达' },
    { pattern: /(我错了|我说重了|前面说重了|更正|修正|改结论|说错了|搞错了|弄错了|记错了|确实如此|你说得对|受教|学习了|感谢指正|谢谢指正|有道理|你说的有道理|这倒也是|那倒也对|收回前面|前面说错|之前说错|是我搞混|我记混了|我的问题|是我疏忽)/g, family: 'correction', meaning: '自我修正或结论降级' },
  ];
  const entries = [];
  for (const item of patterns) {
    for (const match of String(text || '').matchAll(item.pattern)) {
      entries.push({
        term: match[1] || match[0],
        family: item.family,
        meaning: item.meaning,
        confidence: 0.5,
      });
    }
  }
  return normalizeKeywordEntries(entries);
}

async function generateKeywordEntries(payload, config, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const heuristicEntries = heuristicKeywordEntries(payload.text);
  const evidenceOptions = { source: payload.source, uid: payload.uid };
  if (!config.available || !config.keyConfigured || !config.model) {
    return { entries: filterKeywordEntriesByEvidence(heuristicEntries, payload.text, evidenceOptions), usedFallback: true, evidenceRejected: 0, raw: '' };
  }

  const requestBody = {
    model: config.model,
    messages: buildKeywordMessages(payload),
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoningEffort || 'medium',
    stream: false,
    max_tokens: 900,
  };
  let raw = await requestDeepSeekKeywords(config, fetchImpl, options, requestBody);
  if (!raw.trim()) {
    const retryBody = {
      ...requestBody,
      response_format: undefined,
      max_tokens: 3200,
      messages: [
        ...requestBody.messages,
        {
          role: 'user',
          content: '如果 JSON 模式导致 content 为空，现在请只输出一个完整 JSON 对象，不要解释、不要 markdown。',
        },
      ],
    };
    raw = await requestDeepSeekKeywords(config, fetchImpl, options, retryBody);
  }

  try {
    const parsed = extractJsonObject(raw);
    const deepseekEntries = normalizeKeywordEntries(parsed.keywords || parsed.terms || []);
    const evidenceBackedDeepseekEntries = filterKeywordEntriesByEvidence(deepseekEntries, payload.text, evidenceOptions);
    const evidenceBackedHeuristicEntries = filterKeywordEntriesByEvidence(heuristicEntries, payload.text, evidenceOptions);
    const entries = normalizeKeywordEntries([...evidenceBackedDeepseekEntries, ...evidenceBackedHeuristicEntries]);
    return {
      entries,
      usedFallback: evidenceBackedDeepseekEntries.length === 0,
      evidenceRejected: Math.max(0, deepseekEntries.length - evidenceBackedDeepseekEntries.length),
      raw,
    };
  } catch {
    return { entries: filterKeywordEntriesByEvidence(heuristicEntries, payload.text, evidenceOptions), usedFallback: true, evidenceRejected: 0, raw };
  }
}

function evidenceFromExactSourcePhrase(entry, evidencePhrase, text, options = {}) {
  const cleanPhrase = cleanEvidenceText(evidencePhrase);
  const evidenceText = cleanEvidenceText(text);
  if (!cleanPhrase || !evidenceText.includes(cleanPhrase)) return null;
  if (isAmbiguousBenignEvidenceSample(entry.term, entry.family, evidencePhrase)) return null;
  const evidenceCount = countOccurrences(evidenceText, cleanPhrase);
  const evidenceSamples = [];
  const evidenceSources = [];
  const source = String(options.source || '').trim();
  const uid = String(options.uid || '').trim();
  for (const line of String(text || '').split(/\r?\n/)) {
    const cleanLine = cleanEvidenceText(line);
    if (!cleanLine.includes(cleanPhrase)) continue;
    const sample = line.replace(/\s+/g, ' ').trim();
    if (!sample) continue;
    const clippedSample = sample.length > 120 ? `${sample.slice(0, 120)}...` : sample;
    evidenceSamples.push(clippedSample);
    if (source || uid) evidenceSources.push({ source, uid, sample: clippedSample });
    if (evidenceSamples.length >= 3) break;
  }
  return {
    ...entry,
    evidenceCount,
    evidenceSamples: unique(evidenceSamples).slice(0, 3),
    evidenceSources: normalizeEvidenceSources(evidenceSources).slice(0, 3),
  };
}

async function generateExistingDictionaryEvidenceEntries(dictionary, payload, config, options = {}) {
  if (!config.available || !config.keyConfigured || !config.model) {
    return { entries: [], usedFallback: true, evidenceRejected: 0, raw: '' };
  }
  const fetchImpl = options.fetch || fetch;
  const excludeTerms = new Set(Array.from(options.excludeTerms || []).map(cleanTerm).filter(Boolean));
  const targetTerms = parseTargetTerms(
    options.targetExistingTerms,
    options.targetExistingTerm,
    options.targetTerms,
    options.targetTerm,
    payload.targetExistingTerms,
    payload.targetExistingTerm,
    payload.targetTerms,
    payload.targetTerm,
  );
  const scopedDictionary = dictionaryScopedToTerms(dictionary, targetTerms);
  const currentEntries = normalizeKeywordEntries(Array.isArray(scopedDictionary?.entries) ? scopedDictionary.entries : []);
  const entryMap = new Map(currentEntries.filter((entry) => !excludeTerms.has(entry.term)).map((entry) => [entry.term, entry]));
  if (entryMap.size === 0) return { entries: [], usedFallback: true, evidenceRejected: 0, raw: '' };

  const requestBody = {
    model: config.model,
    messages: buildExistingEvidenceMessages({ entries: [...entryMap.values()] }, payload),
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoningEffort || 'medium',
    stream: false,
    max_tokens: 1200,
  };
  try {
    const raw = await requestDeepSeekKeywords(config, fetchImpl, options, requestBody);
    const parsed = extractJsonObject(raw);
    const rawMatches = Array.isArray(parsed.matches) ? parsed.matches : Array.isArray(parsed.keywords) ? parsed.keywords : [];
    const accepted = [];
    let rejected = 0;
    for (const match of rawMatches) {
      const term = cleanKeywordTerm(match?.term);
      const evidence = String(match?.evidence || match?.evidencePhrase || match?.sample || '').trim();
      const entry = entryMap.get(term);
      const evidenceEntry = entry ? evidenceFromExactSourcePhrase(entry, evidence, payload.text, { source: payload.source, uid: payload.uid }) : null;
      if (evidenceEntry) {
        accepted.push(evidenceEntry);
      } else {
        rejected += 1;
      }
    }
    const now = new Date().toISOString();
    const merged = new Map();
    for (const entry of accepted) {
      merged.set(entry.term, mergeKeywordEntry(merged.get(entry.term), entry, now));
    }
    return {
      entries: [...merged.values()],
      usedFallback: accepted.length === 0,
      evidenceRejected: rejected,
      raw,
    };
  } catch {
    return { entries: [], usedFallback: true, evidenceRejected: 0, raw: '' };
  }
}

async function requestDeepSeekKeywords(config, fetchImpl, options, body) {
  const cleanBody = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders((options.env || process.env).DEEPSEEK_API_KEY),
    body: JSON.stringify(cleanBody),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw new Error(`DeepSeek generate failed with HTTP ${response.status}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function trainKeywordDictionary(payload, options = {}) {
  const currentDictionary = await readDictionary(options.dictionaryPath || DEFAULT_DICTIONARY_PATH);
  const existingTermsOnly = options.existingTermsOnly === true || payload.existingTermsOnly === true;
  const targetTerms = parseTargetTerms(
    options.targetExistingTerms,
    options.targetExistingTerm,
    options.targetTerms,
    options.targetTerm,
    payload.targetExistingTerms,
    payload.targetExistingTerm,
    payload.targetTerms,
    payload.targetTerm,
  );
  const evidenceDictionary = dictionaryScopedToTerms(currentDictionary, targetTerms);
  const config = await getDeepSeekConfig(options);
  const generated = existingTermsOnly
    ? { entries: [], usedFallback: true, evidenceRejected: 0, raw: '' }
    : await generateKeywordEntries(payload, config, options);
  const currentTermSet = new Set(
    normalizeKeywordEntries(currentDictionary.entries.map(({ variants: _variants, ...entry }) => entry)).map((entry) => entry.term),
  );
  const generatedTerms = new Set(generated.entries.map((entry) => entry.term));
  const exactDictionaryEvidenceEntries = findDictionaryEntriesWithTextEvidence(evidenceDictionary, payload.text, {
    excludeTerms: generatedTerms,
    source: payload.source,
    uid: payload.uid,
  });
  const modelDictionaryEvidence = existingTermsOnly
    ? await generateExistingDictionaryEvidenceEntries(evidenceDictionary, payload, config, {
        ...options,
        excludeTerms: new Set([...generatedTerms, ...exactDictionaryEvidenceEntries.map((entry) => entry.term)]),
      })
    : { entries: [], usedFallback: true, evidenceRejected: 0, raw: '' };
  const dictionaryEvidenceEntries = normalizeKeywordEntries([...exactDictionaryEvidenceEntries, ...modelDictionaryEvidence.entries]);
  const acceptedEntries = normalizeKeywordEntries([...generated.entries, ...dictionaryEvidenceEntries]).filter(
    (entry) => !existingTermsOnly || currentTermSet.has(entry.term),
  );
  const dictionary =
    acceptedEntries.length > 0
      ? await mergeEntriesIntoDictionary(acceptedEntries, options)
      : currentDictionary;
  return {
    ok: true,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model || '',
    reasoningEffort: config.reasoningEffort || 'medium',
    available: config.available,
    keyConfigured: config.keyConfigured,
    usedFallback: existingTermsOnly ? modelDictionaryEvidence.usedFallback : generated.usedFallback,
    evidenceRejected: (generated.evidenceRejected || 0) + (modelDictionaryEvidence.evidenceRejected || 0),
    entries: acceptedEntries,
    generatedEntries: generated.entries,
    dictionaryEvidenceEntries,
    dictionary,
    warning: config.warning,
  };
}

export async function readKeywordDictionary(options = {}) {
  return buildCanonicalDictionarySnapshot(await readDictionary(options.dictionaryPath || DEFAULT_DICTIONARY_PATH));
}

function buildAnalysisMessages({ text, uid, name }) {
  return [
    {
      role: 'system',
      content:
        '你是中文互联网论辩行为分析器。分析 B 站用户的公开评论，从话语行为角度评估其在论辩中的风险倾向。只输出合法 JSON，不要 markdown。',
    },
    {
      role: 'user',
      content: `分析以下 B 站用户的公开评论，从 6 个维度评估其论辩行为风险。每个维度输出 0-100 的分数和判断依据。

维度说明：
1. 对抗性动机 (attack)：是否从讨论观点转向攻击人身、资格、阵营或动机。高分=频繁人身攻击或阵营指认。
2. 认知闭合 (closure)：是否使用全称判断、绝对化断言、拒绝歧义。高分=思维闭合、拒绝 nuance。
3. 证据敏感 (evidence)：是否提供或要求可核验证据、来源、数据。低分=不关心证据、转移举证责任。
4. 逻辑一致 (logic)：论证是否出现稻草人、偷换概念、以偏概全、因果跳跃等谬误。低分=逻辑漏洞多。
5. 合作讨论 (cooperation)：是否使用条件化表达、澄清、复述对方观点、让步。低分=拒绝合作讨论。
6. 修正意愿 (correction)：被指出错误时是否承认、修正、降低结论强度。低分=拒绝修正。

重要规则：
- 评估的是话语行为模式，不是观点对错
- 每轴必须引用至少 1 条原文作为证据
- 如果某轴的证据不足（评论中缺少相关语言），给出中性分数（40-60）并说明"证据不足"
- 注意区分反讽、玩梗和真诚表达
- 如果评论数很少或样本不具代表性，在 overall 中注明
- 逐句分析每条完整发言：先看整句的命题、攻击对象、语气、证据关系和前后让步，再判断风险
- 不要只按单个关键词或梗词定性；例如“不是我杠”可能是证据边界提醒，也可能是攻击开场，必须结合完整句子判断
- sentenceAnalyses 必须保留原句 quote，并说明 speechAct、target、stance、contextRole、risk、axisImpacts 和 reasoning
- axisImpacts 用来把完整句子标到 radar 轴上；每句 1-3 个，axis 只能是六个维度之一，direction 为 risk 或 positive，strength 为 0-1。不要只按词面命中给 axisImpacts，必须解释整句为什么影响该轴。
- If an attack-looking keyword is used as a meme, quote, copypasta, title, self-reference, or playful marker, do not assign attack axis unless the complete sentence attacks a concrete target. Explain the meme/quote function in reasoning and keep risk neutral/low when appropriate.

输出 JSON 结构：
{
  "axes": [
    {"axis": "对抗性动机", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."},
    {"axis": "认知闭合", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."},
    {"axis": "证据敏感", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."},
    {"axis": "逻辑一致", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."},
    {"axis": "合作讨论", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."},
    {"axis": "修正意愿", "score": 0-100, "evidence": ["原文引用..."], "reasoning": "判断依据..."}
  ],
  "sentenceAnalyses": [
    {"quote": "完整原句...", "speechAct": "话语行为", "target": "命题/对象", "stance": "立场和语气", "contextRole": "这句话在上下文中的作用", "risk": "high|medium|low|positive|neutral", "axisImpacts": [{"axis": "对抗性动机|认知闭合|证据敏感|逻辑一致|合作讨论|修正意愿", "direction": "risk|positive", "strength": 0.0, "reasoning": "这句完整话如何影响该 radar 轴..."}], "reasoning": "为什么不能只按关键词判断..."}
  ],
  "overall": {"riskBand": "高风险对抗型|混合争辩型|低风险讨论型", "summary": "一句话总结..."},
  "confidence": 0.0
}

UID: ${uid || 'unknown'}
用户名: ${name || '未知'}
评论样本：
${String(text || '').slice(0, 8000)}`,
    },
  ];
}

function buildCompactAnalysisMessages({ text, uid, name }) {
  const comments = splitAnalysisSourceSentences(text).slice(0, 40);
  return [
    {
      role: 'system',
      content:
        'You analyze Chinese Bilibili comments. Return valid JSON only. Preserve every Chinese quote exactly from the input comments.',
    },
    {
      role: 'user',
      content: `Analyze the Bilibili comments below by full-sentence speech act, not by isolated keywords.

Input JSON:
${JSON.stringify({ uid: uid || 'unknown', name: name || 'unknown', comments }, null, 2)}

Return this exact JSON shape:
{
  "axes": [
    {"axis": "对抗性动机", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"},
    {"axis": "认知闭合", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"},
    {"axis": "证据敏感", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"},
    {"axis": "逻辑一致", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"},
    {"axis": "合作讨论", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"},
    {"axis": "修正意愿", "score": 0, "evidence": ["原文 quote"], "reasoning": "why"}
  ],
  "sentenceAnalyses": [
    {"quote": "完整原句", "speechAct": "话语行为", "target": "对象/命题", "stance": "立场语气", "contextRole": "上下文作用", "risk": "high|medium|low|positive|neutral", "axisImpacts": [{"axis": "对抗性动机|认知闭合|证据敏感|逻辑一致|合作讨论|修正意愿", "direction": "risk|positive", "strength": 0.0, "reasoning": "full sentence reason"}], "reasoning": "why keyword-only judgment would be wrong"}
  ],
  "overall": {"riskBand": "高风险对抗型|混合争辩型|低风险讨论型", "summary": "summary"},
  "confidence": 0.0
}

Rules:
- If a hostile-looking word is only a meme, quote, copypasta, title, self-reference, or playful marker, keep risk neutral/low unless the complete sentence attacks a concrete target.
- If evidence is insufficient for an axis, use a neutral 40-60 score and say evidence is insufficient.
- Evidence and sentenceAnalyses.quote must be copied from the input comments, not paraphrased and not replaced with question marks.`,
    },
  ];
}

function sourceHasChinese(text) {
  return /[\p{Script=Han}]/u.test(String(text || ''));
}

function hasQuestionMarkMojibake(value) {
  return /\?{4,}/.test(String(value || ''));
}

function normalizeAnalysisAxisLabel(axis) {
  const text = String(axis || '').trim();
  if (!text) return '';
  if (text.includes('|')) return '';
  if (ANALYSIS_AXIS_LABELS.includes(text)) return text;
  if (ANALYSIS_AXIS_ALIASES.has(text)) return ANALYSIS_AXIS_ALIASES.get(text);
  const lower = text.toLowerCase();
  if (ANALYSIS_AXIS_ALIASES.has(lower)) return ANALYSIS_AXIS_ALIASES.get(lower);
  for (const label of ANALYSIS_AXIS_LABELS) {
    if (text.includes(label)) return label;
  }
  for (const [alias, label] of ANALYSIS_AXIS_ALIASES) {
    if (alias && text.includes(alias)) return label;
  }
  return '';
}

function parsedAnalysisLooksGarbled(parsed, raw, sourceText) {
  if (!sourceHasChinese(sourceText)) return false;
  if (/乱码|不可解读|无法识别/.test(String(raw || '')) && hasQuestionMarkMojibake(raw)) return true;
  const axes = Array.isArray(parsed?.axes) ? parsed.axes : [];
  const sentences = Array.isArray(parsed?.sentenceAnalyses) ? parsed.sentenceAnalyses : [];
  if (
    splitAnalysisSourceSentences(sourceText).length > 0 &&
    sentences.length === 0 &&
    (axes.length === 0 || axes.every((axis) => !(Array.isArray(axis?.evidence) && axis.evidence.length > 0) && !String(axis?.reasoning || '').trim()))
  ) {
    return true;
  }
  const evidenceText = axes.flatMap((axis) => (Array.isArray(axis.evidence) ? axis.evidence : [])).join('\n');
  const quoteText = sentences.map((sentence) => sentence?.quote || '').join('\n');
  if (hasQuestionMarkMojibake(evidenceText) || hasQuestionMarkMojibake(quoteText)) return true;
  return sentences.length === 0 && axes.some((axis) => hasQuestionMarkMojibake(axis?.reasoning) || hasQuestionMarkMojibake(axis?.evidence?.join?.('\n')));
}

function removeDuplicateEmptySentenceAnalyses(sentenceAnalyses = []) {
  const substantiveQuotes = new Set(
    sentenceAnalyses
      .filter((item) => Array.isArray(item.axisImpacts) && item.axisImpacts.length > 0)
      .map((item) => item.quote),
  );
  const seenEmptyQuotes = new Set();
  return sentenceAnalyses.filter((item) => {
    const hasImpacts = Array.isArray(item.axisImpacts) && item.axisImpacts.length > 0;
    if (hasImpacts) return true;
    if (substantiveQuotes.has(item.quote)) return false;
    if (seenEmptyQuotes.has(item.quote)) return false;
    seenEmptyQuotes.add(item.quote);
    return true;
  });
}

function hasExplicitCorrectionEvidence(text) {
  text = String(text || '').replace(/\u4fee\u6b63\u610f\u613f|\u4fee\u6b63\u8f74|\u4fee\u6b63\u5206/gu, '');
  const negatedCorrection = /(?:\u6ca1\u6709|\u672a|\u65e0|\u4e0d)(?:.{0,8})(?:\u627f\u8ba4|\u8ba4\u9519|\u4fee\u6b63|\u66f4\u6b63|\u6539\u7ed3\u8bba|\u63a5\u53d7\u7ea0\u6b63|\u613f\u610f\u6539)/.test(text);
  if (negatedCorrection) return false;
  return /(?:\u627f\u8ba4(?:\u9519\u8bef|\u95ee\u9898|\u8bf4\u9519)?|\u8ba4\u9519|\u9519\u4e86|\u8bf4\u9519|\u8bf4\u91cd|\u6211\u6536\u56de|\u6536\u56de|\u4fee\u6b63|\u66f4\u6b63|\u6539\u7ed3\u8bba|\u6539\u53e3|\u6539\u89c2\u70b9|\u964d\u4f4e\u7ed3\u8bba|\u8865\u5145\u4e00\u4e0b|\u8c22\u8c22\u6307\u6b63|\u611f\u8c22\u6307\u6b63|\u613f\u610f\u6539|\u53ef\u4ee5\u6539|\u63a5\u53d7\u7ea0\u6b63|\u88ab\u6307\u51fa)|\b(?:admit|admitted|mistake|wrong|correct(?:ed|ion)?|revise|revision|update conclusion|change my mind|thanks for correcting)\b/i.test(text);
}

function axisHasUsableEvidence(axis, sourceText) {
  const evidence = Array.isArray(axis?.evidence) ? axis.evidence : [];
  const evidenceText = [axis?.reasoning, ...evidence].map((item) => String(item || '')).join('\n');
  if (String(axis?.axis || '').trim() === '\u4fee\u6b63\u610f\u613f') {
    return evidence.some((item) => String(item || '').trim()) && hasExplicitCorrectionEvidence(`${evidenceText}\n${sourceText || ''}`);
  }
  return evidence.some((item) => String(item || '').trim());
}

async function requestDeepSeekAnalysis({ config, fetchImpl, payload, options, compact = false }) {
  const requestBody = {
    model: config.model,
    messages: compact ? buildCompactAnalysisMessages(payload) : buildAnalysisMessages(payload),
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoningEffort || 'medium',
    stream: false,
    max_tokens: compact ? 6000 : 2000,
  };

  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders((options.env || process.env).DEEPSEEK_API_KEY),
    body: JSON.stringify(requestBody),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`DeepSeek analyze failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';
  return { raw, parsed: extractJsonObject(raw) };
}

export async function analyzeCommentsWithDeepSeek(payload, options = {}) {
  const config = await getDeepSeekConfig(options);
  const fetchImpl = options.fetch || fetch;

  if (!config.available || !config.keyConfigured || !config.model) {
    return {
      ok: false,
      error: 'DeepSeek API is not configured. Set DEEPSEEK_API_KEY to enable direct analysis.',
      available: false,
    };
  }

  try {
    let retriedCompactPrompt = false;
    let raw = '';
    let parsed = null;
    try {
      ({ raw, parsed } = await requestDeepSeekAnalysis({ config, fetchImpl, payload, options }));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      ({ raw, parsed } = await requestDeepSeekAnalysis({ config, fetchImpl, payload, options, compact: true }));
      retriedCompactPrompt = true;
    }
    if (parsedAnalysisLooksGarbled(parsed, raw, payload?.text)) {
      ({ raw, parsed } = await requestDeepSeekAnalysis({ config, fetchImpl, payload, options, compact: true }));
      retriedCompactPrompt = true;
    }
    if (parsedAnalysisLooksGarbled(parsed, raw, payload?.text)) {
      throw new Error('DeepSeek returned garbled Chinese analysis after compact retry.');
    }

    const axes = (Array.isArray(parsed.axes) ? parsed.axes : []).map((axis) => {
      const evidence = Array.isArray(axis.evidence) ? axis.evidence.slice(0, 5) : [];
      const normalizedAxis = normalizeAnalysisAxisLabel(axis.axis);
      if (!normalizedAxis) return null;
      const hasEvidence = axisHasUsableEvidence({ ...axis, axis: normalizedAxis, evidence }, payload?.text);
      const score = Math.max(0, Math.min(100, Number(axis.score) || 50));
      const reasoning = String(axis.reasoning || '').slice(0, 500);
      return {
        axis: normalizedAxis,
        score: hasEvidence ? score : 50,
        evidence,
        reasoning: hasEvidence || /证据不足/.test(reasoning) ? reasoning : `${reasoning}${reasoning ? ' ' : ''}证据不足，按中性分处理。`,
      };
    }).filter(Boolean);

    const validAxes = [
      { axis: '对抗性动机', score: 50, evidence: [], reasoning: '' },
      { axis: '认知闭合', score: 50, evidence: [], reasoning: '' },
      { axis: '证据敏感', score: 50, evidence: [], reasoning: '' },
      { axis: '逻辑一致', score: 50, evidence: [], reasoning: '' },
      { axis: '合作讨论', score: 50, evidence: [], reasoning: '' },
      { axis: '修正意愿', score: 50, evidence: [], reasoning: '' },
    ];

    for (const item of validAxes) {
      const found = axes.find((axis) => axis.axis === item.axis);
      if (found) Object.assign(item, found);
    }

    const sourceSentences = splitAnalysisSourceSentences(payload?.text);
    const sentenceAnalyses = removeDuplicateEmptySentenceAnalyses((Array.isArray(parsed.sentenceAnalyses) ? parsed.sentenceAnalyses : [])
      .map((item) => ({
        quote: groundSentenceQuote(item.quote, sourceSentences).slice(0, 300),
        speechAct: String(item.speechAct || '').trim().slice(0, 80),
        target: String(item.target || '').trim().slice(0, 120),
        stance: String(item.stance || '').trim().slice(0, 120),
        contextRole: String(item.contextRole || '').trim().slice(0, 180),
        risk: String(item.risk || 'neutral').trim().slice(0, 20),
        axisImpacts: (Array.isArray(item.axisImpacts) ? item.axisImpacts : [])
          .map((impact) => {
            const strength = Number(impact.strength);
            const normalizedAxis = normalizeAnalysisAxisLabel(impact.axis);
            return {
              axis: normalizedAxis,
              direction: String(impact.direction || '').trim().slice(0, 20),
              strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.5,
              reasoning: String(impact.reasoning || '').trim().slice(0, 240),
            };
          })
          .filter((impact) => impact.axis)
          .slice(0, 3),
        reasoning: String(item.reasoning || '').trim().slice(0, 500),
      }))
      .filter((item) => item.quote));

    const overall = {
      riskBand: String(parsed.overall?.riskBand || '混合争辩型').trim(),
      summary: String(parsed.overall?.summary || '').trim(),
    };

    return {
      ok: true,
      provider: config.provider,
      model: config.model || '',
      reasoningEffort: config.reasoningEffort || 'medium',
      retriedCompactPrompt,
      axes: validAxes,
      sentenceAnalyses,
      overall,
      confidence: Math.max(0.45, Math.min(0.92, Number(parsed.confidence) || 0.7)),
      raw,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
      available: true,
    };
  }
}
