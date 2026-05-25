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
  meme: 'attack',
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
  return String(sample || '').trim().startsWith('Bilibili video context:');
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
      if (isTitleSplicedVideoContextOnlyTerm(term, evidenceSamples, evidenceSources)) continue;
      if (isAskBaiduSongVideoContextOnlyTerm(term, evidenceSamples, evidenceSources)) continue;
      if (isMisleadingCarArmyVideoContextOnlyTerm(term, evidenceSamples, evidenceSources)) continue;
      entries.push({
        term,
        family,
        meaning,
        risk: String(item.risk || '').trim() || (family === 'cooperation' || family === 'correction' ? 'positive' : 'medium'),
        confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.68,
        evidenceCount: rawEvidenceCount,
        evidenceSamples,
        evidenceSources,
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

function evidenceForTerm(term, text, options = {}) {
  const needles = unique([term, ...(TERM_EVIDENCE_ALIASES[cleanTerm(term).toLowerCase()] || [])].map(cleanEvidenceText)).filter(Boolean);
  const evidenceText = cleanEvidenceText(text);
  const evidenceCount =
    needles.length === 1
      ? countOccurrences(evidenceText, needles[0])
      : countNonOverlappingNeedleOccurrences(evidenceText, needles);
  const evidenceSamples = [];
  const evidenceSources = [];
  const source = String(options.source || '').trim();
  const uid = String(options.uid || '').trim();
  if (evidenceCount > 0) {
    for (const line of String(text || '').split(/\r?\n/)) {
      const cleanLine = cleanEvidenceText(line);
      if (needles.some((needle) => cleanLine.includes(needle))) {
        const sample = line.replace(/\s+/g, ' ').trim();
        if (sample) {
          const clippedSample = sample.length > 120 ? `${sample.slice(0, 120)}...` : sample;
          evidenceSamples.push(clippedSample);
          if (source || uid) evidenceSources.push({ source, uid, sample: clippedSample });
        }
      }
      if (evidenceSamples.length >= 3) break;
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
    .map((entry) => ({ ...entry, ...evidenceForTerm(entry.term, text, options) }))
    .filter((entry) => entry.evidenceCount > 0);
}

export function findDictionaryEntriesWithTextEvidence(dictionary, text = '', options = {}) {
  const evidenceText = cleanEvidenceText(text);
  if (!evidenceText) return [];
  const excludeTerms = new Set(Array.from(options.excludeTerms || []).map(cleanTerm).filter(Boolean));
  return normalizeKeywordEntries(Array.isArray(dictionary?.entries) ? dictionary.entries : [])
    .filter((entry) => !excludeTerms.has(entry.term))
    .map((entry) => ({ ...entry, ...evidenceForTerm(entry.term, text, options) }))
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

  const requestBody = {
    model: config.model,
    messages: buildAnalysisMessages(payload),
    response_format: { type: 'json_object' },
    thinking: { type: 'enabled' },
    reasoning_effort: config.reasoningEffort || 'medium',
    stream: false,
    max_tokens: 2000,
  };

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: authHeaders((options.env || process.env).DEEPSEEK_API_KEY),
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      throw new Error(`DeepSeek analyze failed with HTTP ${response.status}`);
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObject(raw);

    const axes = (Array.isArray(parsed.axes) ? parsed.axes : []).map((axis) => ({
      axis: String(axis.axis || ''),
      score: Math.max(0, Math.min(100, Number(axis.score) || 50)),
      evidence: Array.isArray(axis.evidence) ? axis.evidence.slice(0, 5) : [],
      reasoning: String(axis.reasoning || '').slice(0, 500),
    }));

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
    const sentenceAnalyses = (Array.isArray(parsed.sentenceAnalyses) ? parsed.sentenceAnalyses : [])
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
      .filter((item) => item.quote);

    const overall = {
      riskBand: String(parsed.overall?.riskBand || '混合争辩型').trim(),
      summary: String(parsed.overall?.summary || '').trim(),
    };

    return {
      ok: true,
      provider: config.provider,
      model: config.model || '',
      reasoningEffort: config.reasoningEffort || 'medium',
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
