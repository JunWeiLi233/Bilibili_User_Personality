import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

function isNoisyTerm(term) {
  if (URL_HOST_FRAGMENT_TERMS.has(String(term).toLowerCase())) return true;
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

function mergeKeywordEntry(existing, incoming, now) {
  if (!existing) return { ...incoming, updatedAt: incoming.updatedAt || now };

  const existingConfidence = Number(existing.confidence) || 0;
  const incomingConfidence = Number(incoming.confidence) || 0;
  const shouldReplaceFamily = existing.family !== incoming.family && incomingConfidence >= existingConfidence + 0.15;
  const shouldReplaceDetails = shouldReplaceFamily || existing.family === incoming.family || !existing.meaning;
  const base = shouldReplaceFamily ? incoming : existing;
  const details = shouldReplaceDetails ? incoming : {};
  const evidenceSamples = unique([...(existing.evidenceSamples || []), ...(incoming.evidenceSamples || [])])
    .sort((a, b) => evidenceSampleSortKey(a) - evidenceSampleSortKey(b))
    .slice(0, 5);
  const evidenceSources = uniqueBy(
    [...(existing.evidenceSources || []), ...(incoming.evidenceSources || [])].sort(
      (a, b) => evidenceSourceSortKey(a) - evidenceSourceSortKey(b),
    ),
    (item) => `${item.source || ''}\n${item.uid || ''}\n${item.sample || ''}`,
  ).slice(0, 8);
  const existingEvidenceCount = Math.max(0, Number(existing.evidenceCount) || 0);
  const incomingEvidenceCount = Math.max(0, Number(incoming.evidenceCount) || 0);

  return {
    ...base,
    ...details,
    term: incoming.term,
    family: shouldReplaceFamily ? incoming.family : existing.family,
    meaning: details.meaning || existing.meaning || incoming.meaning,
    risk: details.risk || existing.risk || incoming.risk,
    confidence: Math.max(existingConfidence, incomingConfidence),
    evidenceCount:
      evidenceSamples.length > 0 && evidenceSamples.length < existingEvidenceCount + incomingEvidenceCount
        ? Math.max(existingEvidenceCount, incomingEvidenceCount)
        : existingEvidenceCount + incomingEvidenceCount,
    evidenceSamples,
    evidenceSources,
    updatedAt: now,
  };
}

function aliasEvidenceEntriesForEntry(entryMap, entry) {
  const aliases = TERM_EVIDENCE_ALIASES[cleanTerm(entry?.term).toLowerCase()] || [];
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

export function normalizeKeywordEntries(rawEntries = []) {
  const entries = [];
  for (const item of rawEntries) {
    const family = normalizeFamily(item.family);
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const cleanedTerms = unique([item.term, ...variants].map(cleanKeywordTerm)).filter((term) => term.length >= 2 && term.length <= 12);
    const terms = cleanedTerms.filter((term) => !cleanedTerms.some((candidate) => candidate !== term && isAsciiSuffixFragmentOf(term, candidate)));
    const meaning = String(item.meaning || item.reason || '').trim();
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
      const evidenceCount =
        rawEvidenceCount > 0 && (termEvidenceSamples.length !== evidenceSamples.length || termEvidenceSources.length !== evidenceSources.length)
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
  const clean = cleanTerm(term);
  const aliases = [];
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
    ...(TERM_EVIDENCE_ALIASES[cleanTerm(term).toLowerCase()] || []),
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

function isAmbiguousBenignEvidenceSample(term, family, sample) {
  const cleanSample = cleanEvidenceText(sample);
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
  if (term === '\u5f3a\u56fd' && family === 'attack') {
    const literalPowerhouseContext = /(?:\u9009\u7f8e\u5f3a\u56fd|\u4f53\u80b2\u5f3a\u56fd|\u79d1\u6280\u5f3a\u56fd|\u5236\u9020\u5f3a\u56fd|\u5de5\u4e1a\u5f3a\u56fd|\u519b\u4e8b\u5f3a\u56fd|\u88ab\u89c6\u4e3a|\u66fe\u56db\u6b21|\u51a0\u519b|\u73af\u7403\u5c0f\u59d0)/u.test(cleanSample);
    const attackContext = /(?:\u68d2\u5b50|\u4e16\u754c\u7b2c\u4e00|\u8df3\u51fa\u6765|\u4f60\u4eec|\u5439|\u6025|\u7834\u9632|\u5c31\u8fd9|\u4e0d\u4f1a\u5427|\u7b11\u6b7b|\u8d62\u9ebb)/u.test(cleanSample);
    return literalPowerhouseContext && !attackContext;
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
  if (term === '\u4e0a\u6811' && family === 'cooperation') {
    const literalTreeContext = /(?:\u5154\u5b50\u4e0a\u6811|\u7f8a\u4e3a\u4ec0\u4e48\u4f1a\u4e0a\u6811|\u88ab.*\u521b\u4e0a\u6811|\u722c\u4e0a\u6811|\u5728\u6811\u4e0a|\u6751\u957f\u4e0a\u6811\d*)/u.test(cleanSample);
    const transferOrWaitContext = /(?:\u8f6c\u4f1a|\u5b98\u5ba3|\u7403\u8ff7|\u7b49\u6d88\u606f|\u7b49\u4fe1|\u7b49\u5b98\u65b9|\u4e0b\u6811|\u6811\u4e0a\u7684\u5144\u5f1f|\u8e72\u6d88\u606f)/u.test(cleanSample);
    return literalTreeContext && !transferOrWaitContext;
  }
  if (term === '\u5931\u8e2a\u4eba\u53e3' && family === 'attack') {
    const literalMissingPersonContext = /(?:\u80fd\u627e\u5931\u8e2a\u4eba\u53e3|\u627e\u5931\u8e2a\u4eba\u53e3|\u88ab\u627e\u56de|\u79bb\u5bb6\u51fa\u8d70|\u5931\u8e2a\u4eba\u53e3\u56fe\u7247|\u5931\u8e2a\u4eba\u53e3\u8d85\u8fc7|\u62a5\u8b66|\u5bfb\u4eba)/u.test(cleanSample);
    const comebackContext = /(?:\u5931\u8e2a\u4eba\u53e3\u56de\u5f52|\u5931\u8e2a\u4eba\u53e3\u56de\u6765|\u5931\u8e2a\u4eba\u53e3\u56de\u5f52\u4e86|\u7ec8\u4e8e\u66f4\u65b0|\u597d\u4e45\u4e0d\u89c1|\u4f60\u8fd8\u77e5\u9053\u56de\u6765)/u.test(cleanSample);
    return literalMissingPersonContext && !comebackContext;
  }
  if (term === '\u795e\u795e' && family === 'attack') {
    const splitNameContext = /(?:\u539f\u795e[\u3001\uff0c,]\u795e\u5948|\u539f\u795e.*\u795e\u5948|shimeji|\u684c\u5ba0\u6846\u67b6)/iu.test(cleanSample);
    const attackContext = /(?:\u8fd9\u7fa4\u795e\u795e|\u795e\u795e\u53c8|\u795e\u795e\u4eec|\u80a5\u795e\u795e|\u8df3|\u6025|\u7834\u9632|\u5c0f\u9b3c|\u62bd\u8c61)/u.test(cleanSample);
    return splitNameContext && !attackContext;
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
    const literalProjectileOrSportsContext = /(?:\u6295\u5c04\u7269|\u6295\u5c04\u80fd\u529b|\u4f2f\u5fb7\u6295\u5c04|\u7bee\u7403|\u675c\u5170\u7279|\u5fb7\u514b|projectile|increase projectile damage|\u98de\u5251|\u82f1\u7075|\u971e\u5f39)/iu.test(cleanSample);
    const psychologyContext = /(?:\u5fc3\u7406\u5b66|\u810f\u4e1c\u897f|\u62cd\u5230\u522b\u4eba\u8eab\u4e0a|\u81ea\u5df1\u7684|\u8d1f\u9762|\u5ba2\u4f53|\u95ed\u73af|\u63a8\u5230\u522b\u4eba)/u.test(cleanSample);
    return literalProjectileOrSportsContext && !psychologyContext;
  }
  if (term === '\u73a9\u4e0d\u8d77' && family === 'attack') {
    const affordabilityContext = /(?:\u4e70\u4e0d\u8d77|\u76d7\u7248|\u6b63\u7248|\u4fbf\u5b9c|\u592a\u8d35|\u6ca1\u94b1|\u8d35\u6240\u4ee5|\u4ef7\u683c|\u4e0d\u73a9\u4e86)/u.test(cleanSample);
    const soreLoserContext = /(?:\u957f\u5c06|\u8f93\u4e0d\u8d77|\u800d\u8d56|\u8fd9\u68cb|\u7834\u9632|\u6025|\u5f00\u4e0d\u8d77\u73a9\u7b11|\u73a9\u4e0d\u8d77\u5c31)/u.test(cleanSample);
    return affordabilityContext && !soreLoserContext;
  }
  if (term === '\u4e38\u4e86' && family === 'cooperation') {
    const substringContext = /(?:\u7cd6\u4e38\u4e86|\u836f\u4e38\u4e86|\u5f39\u4e38\u4e86)/u.test(cleanSample);
    const selfDeprecatingContext = /(?:\u54c8\u54c8.*\u4e38\u4e86|\u5b8c\u4e86|\u8981\u4e38|\u8fd9\u4e0b\u4e38\u4e86|\u65e0\u4e86)/u.test(cleanSample) || /(?:^|[，。！？!?\\s])\u4e38\u4e86$/u.test(cleanSample);
    return substringContext && !selfDeprecatingContext;
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
  if (term === '\u543e\u547d\u4f11\u77e3' && family === 'attack') {
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
    const merchantOrQuotedContext = cleanSample === '\u5c0f\u998b\u732b' || /(?:\u5c0f\u998b\u732b\u548c\u8c22\u5b9d\u6797|\u76f4\u64ad\u95f4\u5237\u793c\u7269|\u5e2e\u7740\u5ba3\u4f20|\u5c0f\u998b\u732b\u7b2c\u4e00|\u201c\u5c0f\u998b\u732b\u201d|"\u5c0f\u998b\u732b"|\u5916\u5356|\u70e4\u80a0)/u.test(cleanSample);
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
  if (term === '腐乳' && family === 'attack') {
    return /(?:潮汕|大排档|豆酱|通菜|炒|好吃|美味|蘸料|调味|下饭|白粥|酱|菜)/u.test(cleanSample) && !/(?:叛徒|出列|黑|喷|骂|攻击|孝|急|破防)/u.test(cleanSample);
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
    const current = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    return {
      version: current.version || 1,
      updatedAt: current.updatedAt || null,
      entries: Array.isArray(current.entries) ? current.entries : [],
      families: current.families || {},
    };
  } catch {
    return { version: 1, updatedAt: null, entries: [], families: {} };
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
    await mkdir(dirname(dictionaryPath), { recursive: true });
    await writeFile(dictionaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
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
    { pattern: /(典中典|典|孝|急了|绷不住|赢麻了|乐|yygq|阴阳怪气|懂哥|小丑|逆天|闹麻了|唐|破防|急成这样|这就破防)/gi, family: 'attack', meaning: '中文互联网嘲讽或贬低性梗' },
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

    const axes = (Array.isArray(parsed.axes) ? parsed.axes : []).map((axis) => {
      const evidence = Array.isArray(axis.evidence) ? axis.evidence.slice(0, 5) : [];
      const hasEvidence = evidence.some((item) => String(item || '').trim());
      const score = Math.max(0, Math.min(100, Number(axis.score) || 50));
      const reasoning = String(axis.reasoning || '').slice(0, 500);
      return {
        axis: String(axis.axis || ''),
        score: hasEvidence ? score : 50,
        evidence,
        reasoning: hasEvidence || /证据不足/.test(reasoning) ? reasoning : `${reasoning}${reasoning ? ' ' : ''}证据不足，按中性分处理。`,
      };
    });

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
            return {
              axis: String(impact.axis || '').trim().slice(0, 20),
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
