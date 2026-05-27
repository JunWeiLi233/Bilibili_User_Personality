import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { readKeywordDictionary as defaultReadKeywordDictionary } from './deepseekKeywordTrainer.js';
import { searchVideoKeywords as defaultSearchVideoKeywords } from './videoKeywordSearch.js';

const HARVEST_STRATEGY_VERSION = 6;
const DEFAULT_SEED_QUERIES = [
  '\u4e2d\u6587\u4e92\u8054\u7f51 \u6897 \u8bc4\u8bba\u533a',
  '\u8bc4\u8bba\u533a \u70ed\u8bc4 \u6897',
  '\u4e89\u8bae \u70ed\u8bc4 \u8bc4\u8bba\u533a',
  '\u8f9f\u8c23 \u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
  '\u79d1\u666e \u6570\u636e \u5f15\u7528 \u8bc4\u8bba',
  '\u53d1\u94fe\u63a5 \u8d34\u539f\u6587 \u51fa\u5904 \u8bc4\u8bba',
  '\u4fee\u6b63 \u66f4\u6b63 \u9053\u6b49 \u8bc4\u8bba',
  '\u4e0d\u4f1a\u767e\u5ea6 \u81ea\u5df1\u67e5 \u81ea\u5df1\u641c \u8bc4\u8bba',
  '\u7edd\u5bf9 \u5168\u662f \u6839\u672c\u6ca1\u6709 \u8bc4\u8bba',
  '\u6c34\u519b \u6d17\u5730 \u7ad9\u961f \u8bc4\u8bba\u533a',
];
const FAMILY_CONTEXT = {
  attack: '\u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
  absolutes: '\u7edd\u5bf9\u5316 \u8bc4\u8bba \u70ed\u8bc4',
  evidence: '\u8bc1\u636e \u6765\u6e90 \u8bc4\u8bba\u533a',
  evasion: '\u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
  cooperation: '\u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
  correction: '\u66f4\u6b63 \u8bc4\u8bba\u533a',
};
const TERM_QUERY_TEMPLATES = [
  (term, family) => `${term} ${FAMILY_CONTEXT[family] || '\u8bc4\u8bba\u533a \u70ed\u8bc4'}`,
  (term) => `${term} \u8bc4\u8bba\u533a`,
  (term) => `${term} \u70ed\u8bc4`,
  (term) => `${term} \u5f39\u5e55`,
  (term) => `${term} \u4e89\u8bae \u8bc4\u8bba\u533a`,
  (term) => `${term} \u662f\u4ec0\u4e48\u6897`,
  (term) => `${term} \u4ec0\u4e48\u610f\u601d`,
  (term) => `${term} \u51fa\u5904`,
  (term) => `${term} \u540d\u6897`,
  (term) => `${term} \u540d\u573a\u9762 \u8bc4\u8bba\u533a`,
  (term) => `${term} \u5207\u7247 \u8bc4\u8bba`,
  (term) => `${term} \u8bc4\u8bba \u6897`,
  (term) => `${term} B\u7ad9`,
  (term) => term,
];
const DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES = [
  '{term} \u70ed\u8bc4',
  '{term} \u56de\u590d',
  '{term} \u4e92\u52a8',
  '{term} \u540d\u573a\u9762 \u8bc4\u8bba\u533a',
  '{term} \u5207\u7247 \u8bc4\u8bba',
  '{family} {term} \u8bc4\u8bba',
  '{term} \u8bc4\u8bba\u56de\u590d',
  '{term} \u56de\u590d\u533a',
  '{term} \u8282\u594f',
  '{term} \u7c89\u4e1d',
  '{term} \u76f4\u64ad\u5207\u7247',
  '{term} B\u7ad9\u8bc4\u8bba',
];
const VAGUE_ABSOLUTE_TAIL_ALIASES = new Set(['\u4e5f\u662f', '\u5e05\u54e5']);
const TERM_CONTROVERSY_QUERY_TEMPLATES = [
  '{term} \u4e89\u8bae \u70ed\u8bc4',
  '{term} \u8282\u594f \u8bc4\u8bba\u533a',
  '{term} \u6e38\u620f \u8282\u594f \u70ed\u8bc4',
  '{term} \u65f6\u653f \u4e89\u8bae \u8bc4\u8bba\u533a',
];
const TERM_SEARCH_ALIASES = {
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
    '\u62ff\u8fd9\u4e2a\u5f53\u8bc1\u636e',
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
  '\u9ad8\u4f4e\u5f97\u7ed9\u4f60\u9001\u4e0a\u53bb': ['\u9ad8\u4f4e\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u7ed9\u4f60\u9001\u4e0a\u53bb', '\u9001\u4e0a\u53bb', '\u9876\u4e0a\u53bb'],
  '\u6ca1\u6d3b\u8fc7\u4e24\u4e2a\u6708': ['\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708', '\u6d3b\u4e0d\u8fc7\u4fe9\u6708', '\u6ca1\u6d3b\u8fc7\u4fe9\u6708'],
  '\u54ea\u90fd\u6709\u4f60': ['\u54ea\u513f\u90fd\u6709\u4f60', '\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u5230\u54ea\u90fd\u6709\u4f60'],
  '\u600e\u4e48\u54ea\u54ea\u90fd\u6709\u4f60': ['\u600e\u4e48\u54ea\u90fd\u6709\u4f60', '\u54ea\u54ea\u90fd\u6709\u4f60', '\u54ea\u513f\u90fd\u6709\u4f60'],
  'tv\u574f\u7b11': ['\u574f\u7b11', 'tv\u574f\u7b11\u8868\u60c5'],
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
  '\u7092\u9e21\u597d\u7528': ['\u8d85\u7ea7\u597d\u7528 \u8f6f\u4ef6', '\u8d85\u7ea7\u597d\u7528 \u5de5\u5177', '\u8d85\u597d\u7528 \u63d2\u4ef6', '\u8d85\u7ea7\u597d\u7528', '\u8d85\u597d\u7528', '\u7092\u9e21\u597d\u4f7f'],
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
  '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302': ['\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302', '\u7edd\u5bc6\u5168\u662f\u6302', '\u673a\u5bc6\u5168\u662f\u6302', '\u5168\u662f\u6302'],
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
  '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929': ['\u952e\u76d8\u4fa0\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u7ed9\u4f60\u4e00\u6839\u7f51\u7ebf\u4ed6\u80fd\u4e0a\u5929', '\u7ed9\u4f60\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929', '\u952e\u76d8\u8bbe\u8ba1\u5e08\u7ed9\u6839\u7f51\u7ebf'],
  '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5': ['\u6211\u4eec\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', '\u704c\u94c5\u7b5b\u5b50', '\u7ed9\u7b5b\u5b50\u91cc\u704c\u94c5', '\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5', '\u7b5b\u5b50\u704c\u94c5'],
  '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5': ['\u6211\u4eec\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5', '\u704c\u94c5\u9ab0\u5b50', '\u7ed9\u9ab0\u5b50\u704c\u94c5', '\u9ab0\u5b50\u704c\u4e86\u94c5', '\u9ab0\u5b50\u704c\u94c5'],
  '\u7ed9\u7237\u722c': ['\u7ed9\u7237\u722c', '\u7ed9\u7237\u722c\u5427', '\u60a8\u914d\u5417\u7ed9\u7237\u722c'],
  '\u7ed9\u7237\u6574\u5b5d\u4e86': ['\u7ed9\u7237\u6574\u5b5d\u4e86', '\u7ed9\u7237\u6574\u7b11\u4e86', '\u771f\u7ed9\u7237\u6574\u5b5d\u4e86'],
  '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c': ['\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440', '\u6ca1\u6709\u53c2\u8003\u4ef7\u503c', '\u6839\u672c\u6ca1\u53c2\u8003\u4ef7\u503c'],
  '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8': ['\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8', '\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8', '\u6839\u672c\u6ca1\u8bf4\u4e0d\u5141\u8bb8'],
  '\u5de5\u91cdhao': ['\u5de5\u91cd\u53f7', '\u516c\u91cd\u53f7', '\u516c\u7cbd\u53f7'],
  '\u516c\u5f0f\u5957\u53cd\u4e86': ['\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86', '\u4f60\u516c\u5f0f\u7528\u53cd\u4e86', '\u516c\u5f0f\u5957\u9519\u4e86', '\u516c\u5f0f\u7528\u53cd\u4e86'],
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
const ALIAS_FIRST_SEARCH_TERMS = new Set([
  '0\u63d0\u5347',
  '10\u5e74\u8001\u7c89',
  '12300\u5de5\u4fe1\u90e8\u6295\u8bc9',
  '2026\u6253\u5361',
  '\u57c3\u53ca\u5427',
  '\u7231\u548b\u548b\u5730',
  '\u7231\u548b\u548b\u7684',
  '\u767e\u5ea6\u767e\u79d1',
  '\u767e\u79d1',
  '\u5403\u4e8f\u662f\u798f',
  '\u51fa\u5904',
  '\u963f\u7f8e\u8389\u5361',
  '\u4e0d\u4e00\u4e00',
  '\u5927\u9b54\u6cd5\u5e08',
  '\u7092\u9e21\u597d\u7528',
  '\u522b\u55b7',
  '\u4e0d\u9ed1\u4e0d\u5439',
  '\u4e0d\u674e\u59d0',
  '\u6211\u4e0d\u674e\u59d0',
  '\u4e0d\u662f\u4eba\u4e86',
  '\u4e0d\u662f\u4eba\u4e86\u5457',
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23',
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd',
  '\u5f20\u5634\u903c\u903c\u53e8\u53e8',
  '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11',
  '\u8fb9\u70b8\u8fb9\u79ef\u5fb7',
  '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d',
  '\u8f66\u8f71\u8f98',
  '\u5b58\u7591\u7f57\u9a6c\u4eba',
  '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
  '\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86',
  '\u4e0d\u8981\u80e1\u8bf4',
  '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302',
  '\u51fa\u751f',
  '\u5927\u53f7\u6ca1\u4e86',
  '\u902e\u6355',
  '\u9053\u5fc3\u7834\u788e',
  '\u4f4e\u60c5\u5546',
  '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86',
  '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684',
  '\u7c89\u4e1d\u7206\u7834',
  '\u5c01100\u5e74',
  '\u5c01\u53f7100\u5e74',
  '\u4e0d\u662f\u6760',
  '\u5927\u8dcc\u763e',
  '\u8d1f\u5206\u6eda\u7c97',
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
  '\u6401\u8fd9\u5462',
  '\u4e2a\u7b7e',
  '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929',
  '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5',
  '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5',
  '\u7ed9\u7237\u722c',
  '\u7ed9\u7237\u6574\u5b5d\u4e86',
  '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c',
  '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8',
  '\u5de5\u91cdhao',
  '\u516c\u5f0f\u5957\u53cd\u4e86',
  '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af',
  '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728',
  '\u72d7\u5c4e\u673a\u5236',
  '\u82df\u76841b',
  '\u53e4\u5c38\u7ea7',
  '\u4fdd\u62a4\u6211\u65b9',
  '\u88ab\u62e7\u75bc\u4e86',
  '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c',
  '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f',
  '\u6e2f\u6ef4\u5bf9',
  '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5',
  '\u95ee\u767e\u5ea6',
  '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528',
  '\u62d0\u53cb\u5546',
  '\u5173\u4e86\u5427',
  '\u5173\u4e86\u5427\u6ca1\u610f\u601d',
  '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19',
  '\u8d35\u5bbe\u5f52\u96f6',
  '\u56fd\u9645\u5b85\u7537\u8054\u76df',
  '\u5b85\u7537\u8054\u76df',
]);
const TERM_PRIORITY_QUERIES = {
  '\u5403\u4e8f\u662f\u798f': ['\u5403\u4e8f\u662f\u798f \u70ed\u8bc4', '\u8fd9\u798f\u7ed9\u4f60 \u56de\u590d', '\u4f60\u53bb\u5403\u4e8f \u8bc4\u8bba\u533a', '\u8c01\u5403\u4e8f\u8c01\u6709\u798f \u70ed\u8bc4'],
  '\u51fa\u5904': ['\u6c42\u51fa\u5904 \u8bc4\u8bba\u533a', '\u6709\u51fa\u5904\u5417 \u70ed\u8bc4', '\u51fa\u5904\u5462 \u56de\u590d', '\u539f\u6587\u51fa\u5904 \u8bc4\u8bba'],
  '\u963f\u7f8e\u8389\u5361': ['\u963f\u7f8e\u5229\u5361 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba', '\u7f8e\u5229\u575a \u4e2d\u7f8e \u70ed\u8bc4', '\u6f02\u4eae\u56fd \u65f6\u653f \u8bc4\u8bba\u533a'],
  '\u4e0d\u4e00\u4e00': ['\u4e0d\u4e00\u4e00\u5217\u4e3e \u56de\u590d', '\u4e0d\u4e00\u4e00\u8bc4\u4ef7 \u8bc4\u8bba\u533a', '\u5c31\u4e0d\u4e00\u4e00\u8bc4\u4ef7\u4e86 \u70ed\u8bc4'],
  '\u5927\u9b54\u6cd5\u5e08': ['\u5927\u9b54\u6cd5\u5e08 \u70ed\u8bc4', '\u4e09\u5341\u5c81\u9b54\u6cd5\u5e08 \u6897', '30\u5c81\u9b54\u6cd5\u5e08 \u8bc4\u8bba', '\u9b54\u6cd5\u5e08 \u4e8c\u6b21\u5143 \u70ed\u8bc4'],
  '\u5730\u56fe\u70ae': ['\u5f00\u5730\u56fe\u70ae \u8bc4\u8bba', '\u5730\u57df\u9ed1 \u70ed\u8bc4', '\u5730\u57df\u70ae \u8bc4\u8bba\u533a'],
  '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684': ['\u4eba\u673a\u81ea\u52a8\u53d1 \u8bc4\u8bba', '\u90fd\u662f\u673a\u5668\u4eba \u70ed\u8bc4', '\u673a\u5668\u4eba\u53d1\u7684 \u6c34\u519b'],
  '\u7092\u9e21\u597d\u7528': ['\u8d85\u7ea7\u597d\u7528 \u8f6f\u4ef6 \u8bc4\u8bba', '\u8d85\u7ea7\u597d\u7528 \u5de5\u5177 \u70ed\u8bc4', '\u8d85\u597d\u7528 \u63d2\u4ef6 \u8bc4\u8bba\u533a'],
  '\u522b\u55b7': ['\u522b\u55b7\u6211 \u8bc4\u8bba', '\u8f7b\u70b9\u55b7 \u70ed\u8bc4', '\u4e0d\u559c\u52ff\u55b7 \u8bc4\u8bba\u533a'],
  '\u4e0d\u9ed1\u4e0d\u5439': ['\u4e0d\u5439\u4e0d\u9ed1 \u8bc4\u8bba', '\u6709\u4e00\u8bf4\u4e00 \u70ed\u8bc4', '\u5ba2\u89c2\u8bc4\u4ef7 \u8bc4\u8bba\u533a'],
  '\u4e0d\u674e\u59d0': ['\u4e0d\u7406\u89e3 \u8bc4\u8bba', '\u6211\u4e0d\u7406\u89e3 \u70ed\u8bc4', '\u6211\u4e0d\u674e\u59d0 \u8bc4\u8bba\u533a'],
  '\u6211\u4e0d\u674e\u59d0': ['\u6211\u4e0d\u7406\u89e3 \u8bc4\u8bba', '\u6211\u4e0d\u674e\u59d0 \u5f39\u5e55', '\u4e0d\u7406\u89e3 \u70ed\u8bc4'],
  '\u4e0d\u662f\u4eba\u4e86': ['\u4f60\u4e0d\u662f\u4eba \u8bc4\u8bba', '\u771f\u4e0d\u662f\u4eba \u70ed\u8bc4', '\u4e0d\u5f53\u4eba \u8bc4\u8bba\u533a'],
  '\u4e0d\u662f\u4eba\u4e86\u5457': ['\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457 \u8bc4\u8bba', '\u4e0d\u662f\u4eba\u4e86\u5457 \u5f39\u5e55', '\u4e0d\u662f\u4eba\u4e86 \u70ed\u8bc4'],
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23': ['\u4e09\u4e0d\u539f\u5219 \u8bc4\u8bba', '\u4e0d\u4e3b\u52a8 \u4e0d\u62d2\u7edd \u4e0d\u8d1f\u8d23 \u70ed\u8bc4', '\u4e0d\u4e3b\u52a8\u4e0d\u6297\u62d2\u4e0d\u8d1f\u8d23 \u8bc4\u8bba'],
  '\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd': ['\u4e0d\u4e3b\u52a8\u4e0d\u62d2\u7edd\u4e0d\u8d1f\u8d23 \u8bc4\u8bba', '\u4e09\u4e0d\u539f\u5219 \u70ed\u8bc4', '\u4e0d\u4e3b\u52a8 \u4e0d\u62d2\u7edd \u5f39\u5e55'],
  '\u5f20\u5634\u903c\u903c\u53e8\u53e8': ['\u903c\u903c\u53e8\u53e8 \u8bc4\u8bba', '\u903c\u903c\u53e8 \u5f39\u5e55', '\u778e\u903c\u903c \u70ed\u8bc4'],
  '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11': ['\u4e0d\u7edd\u5bf9\u4f46\u4e0d\u5c11 \u8bc4\u8bba', '\u97e9\u56fd\u4e0d\u5c11 \u70ed\u8bc4', '\u4e0d\u7edd\u5bf9 \u97e9\u56fd \u4e0d\u5c11 \u5f39\u5e55'],
  '\u8fb9\u70b8\u8fb9\u79ef\u5fb7': ['\u6c22\u5f39 \u8fb9\u70b8\u8fb9\u79ef\u5fb7 \u8bc4\u8bba', '\u6838\u7206 \u79ef\u5fb7 \u70ed\u8bc4', '\u6838\u5f39 \u79ef\u5fb7 \u5f39\u5e55'],
  '\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d': ['\u5dee\u8bc4\u591a\u7684\u4e1c\u897f\u4e00\u5b9a\u4e0d\u597d \u70ed\u8bc4', '\u5dee\u8bc4\u591a\u4e00\u5b9a\u4e0d\u597d \u8bc4\u8bba', '\u5dee\u8bc4\u591a\u5c31\u4e00\u5b9a\u4e0d\u597d \u70ed\u8bc4', '\u5dee\u8bc4\u591a\u4e0d\u597d \u8bc4\u8bba\u533a'],
  '\u8f66\u8f71\u8f98': ['\u8f66\u8f71\u8f98\u8bdd \u8bc4\u8bba', '\u8f66\u8f71\u8f98 \u56de\u590d', '\u8f66\u8f71\u8f98\u6765\u56de\u8bf4 \u5f39\u5e55'],
  '\u5b58\u7591\u7f57\u9a6c\u4eba': ['\u7f57\u9a6c\u4eba\u5b58\u7591 \u8bc4\u8bba', '\u7f57\u9a6c\u8eab\u4efd\u5b58\u7591 \u70ed\u8bc4', '\u5b58\u7591\u7684\u7f57\u9a6c\u4eba \u5f39\u5e55'],
  '\u4e0d\u8981\u80e1\u8bf4': ['\u4e0d\u8981\u80e1\u8bf4 \u56de\u590d', '\u522b\u80e1\u8bf4 \u8bc4\u8bba', '\u4e0d\u8981\u4e71\u8bf4 \u70ed\u8bc4'],
  '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302': ['\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302 \u8bc4\u8bba', '\u673a\u5bc6\u5168\u662f\u6302 \u70ed\u8bc4', '\u6697\u533a\u7a81\u56f4 \u5168\u662f\u6302 \u8bc4\u8bba'],
  '\u51fa\u751f': ['\u51fa\u751f \u6e38\u620f \u8bc4\u8bba', '\u7eaf\u51fa\u751f \u70ed\u8bc4', '\u51fa\u751f\u6253\u6cd5 \u5f39\u5e55'],
  '\u5927\u53f7\u6ca1\u4e86': ['\u5927\u53f7\u6ca1\u4e86 \u70ed\u8bc4', '\u5927\u53f7\u6ca1\u4e86 \u8bc4\u8bba', '\u53f7\u6ca1\u4e86 \u70ed\u8bc4', '\u8d26\u53f7\u6ca1\u4e86 \u56de\u590d'],
  '\u902e\u6355': ['\u88ab\u902e\u6355 \u8bc4\u8bba', '\u5f53\u573a\u902e\u6355 \u70ed\u8bc4', '\u6b27\u6d32\u902e\u6355 \u6bd4\u8d5b \u8bc4\u8bba'],
  '\u9053\u5fc3\u7834\u788e': ['\u9053\u5fc3\u7834\u788e \u8bc4\u8bba', '\u9053\u5fc3\u788e\u4e86 \u70ed\u8bc4', '\u9053\u5fc3\u5d29\u4e86 \u8bc4\u8bba\u533a'],
  '\u4f4e\u60c5\u5546': ['\u4f4e\u60c5\u5546 \u8bc4\u8bba', '\u4f4e\u60c5\u5546\uff1a \u70ed\u8bc4', '\u9ad8\u60c5\u5546 \u4f4e\u60c5\u5546 \u8bc4\u8bba'],
  '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86': ['\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86 \u8bc4\u8bba', '\u574f\u4e86\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86 \u70ed\u8bc4', '\u7b2c\u4e00\u904d\u5c31\u770b\u61c2\u4e86 \u5f39\u5e55'],
  '\u88ab\u62e7\u75bc\u4e86': ['\u88ab\u62e7\u75bc\u4e86 \u70ed\u8bc4', '\u88ab\u62e7\u75bc\u4e86\u6025\u4e86 \u70ed\u8bc4', '\u62e7\u75bc\u4e86\u6025\u4e86 \u8bc4\u8bba'],
  '\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c': ['\u611f\u89c9\u81ea\u5df1\u5f88\u5c4c \u8bc4\u8bba\u533a', '\u89c9\u5f97\u81ea\u5df1\u5f88\u725b\u903c \u8bc4\u8bba', '\u611f\u89c9\u81ea\u5df1\u5f88\u725b \u70ed\u8bc4'],
  '\u5e72\u5d29\u963f': ['\u5e72\u5d29\u963fB \u8bc4\u8bba\u533a', '\u76f8\u7ea6613\u5e72\u5d29\u963fB \u8bc4\u8bba', '\u5e72\u5d29B\u7ad9 \u70ed\u8bc4'],
  '\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f': ['\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f \u8bc4\u8bba\u533a', '\u54df\u94a2\u94c1\u516c\u53f8\u8463\u4e8b\u957f \u8bc4\u8bba', '\u94a2\u94c1\u8463\u4e8b\u957f \u70ed\u8bc4'],
  '\u6e2f\u6ef4\u5bf9': ['\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5 \u8bc4\u8bba\u533a', '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1 \u8bc4\u8bba', '\u6e2f\u6ef4\u5bf9 \u8bc4\u8bba\u533a'],
  '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5': ['\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5\u554a\u8001\u94c1 \u8bc4\u8bba', '\u6e2f\u6ef4\u5bf9\u6ca1\u6bdb\u75c5 \u8bc4\u8bba\u533a', '\u6e2f\u6ef4\u5bf9 \u8bc4\u8bba\u533a'],
  '\u62d0\u53cb\u5546': ['\u62ffDNF\u6765\u62d0 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53cb\u5546\u56f4\u730e \u56de\u590d \u8bc4\u8bba', '\u62ff\u53cb\u5546\u6765\u62d0 \u70ed\u8bc4'],
  '\u5173\u4e86\u5427': ['\u8fd9\u6d3b\u5173\u4e86\u5427 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6ca1\u6d3b\u5173\u4e86\u5427 \u8bc4\u8bba', '\u522b\u64ad\u4e86\u5173\u4e86\u5427 \u70ed\u8bc4'],
  '\u5173\u4e86\u5427\u6ca1\u610f\u601d': ['\u8fd9\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u5173\u4e86\u5427\u771f\u6ca1\u610f\u601d \u8bc4\u8bba', '\u6ca1\u6d3b\u5173\u4e86\u5427\u6ca1\u610f\u601d \u70ed\u8bc4'],
  '\u5e7f\u897f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19': ['\u5e7f\u897f\u7cbe\u795e\u5c0f\u4f19\u523b\u677f\u5370\u8c61 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e7f\u897f\u4eba\u4e5f\u4e0d\u5168\u662f\u7cbe\u795e\u5c0f\u4f19 \u8bc4\u8bba', '\u522b\u523b\u677f\u5370\u8c61\u5e7f\u897f\u7cbe\u795e\u5c0f\u4f19 \u70ed\u8bc4'],
  '\u8d35\u5bbe\u5f52\u96f6': ['\u798f\u888b\u4e00\u505c\u8d35\u5bbe\u5f52\u96f6 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u76f4\u64ad\u95f4\u8d35\u5bbe\u5f52\u96f6 \u8bc4\u8bba', '\u4e3b\u64ad\u8d35\u5bbe\u5f52\u96f6 \u70ed\u8bc4'],
  '\u56fd\u9645\u5b85\u7537\u8054\u76df': ['\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u5b85\u7537\u8054\u76df\u51fa\u5175 \u8bc4\u8bba', '\u51fa\u5175\u5f81\u670d\u7f8e\u56fd \u5b85\u7537\u8054\u76df'],
  '\u5b85\u7537\u8054\u76df': ['\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u5b85\u7537\u8054\u76df\u51fa\u5175 \u8bc4\u8bba', '\u51fa\u5175\u5f81\u670d\u7f8e\u56fd \u5b85\u7537\u8054\u76df'],
  '\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047': ['\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047 \u8bc4\u8bba', '\u8fd9\u5c31\u662f\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047 \u5f39\u5e55', '\u8fd9\u5c31\u662f\u9ad8\u5983\u5e94\u5f97\u7684\u5f85\u9047 \u70ed\u8bc4', '\u9ad8\u5983\u5f85\u9047 \u8bc4\u8bba\u533a'],
  '\u9ad8\u7ea7jn': ['\u660e\u661f \u9ad8\u7ea7JN \u8bc4\u8bba', '\u9ad8\u7ea7jn \u5f39\u5e55', '\u9ad8\u7ea7jn \u8bc4\u8bba', '\u9ad8\u7ea7JN \u70ed\u8bc4'],
  '\u6401\u8fd9\u6401\u8fd9': ['\u4f60\u6401\u8fd9\u6401\u8fd9\u5462 \u8bc4\u8bba', '\u6401\u8fd9\u6401\u8fd9\u5462 \u5f39\u5e55', '\u6401\u8fd9\u6401\u8fd9\u5462 \u70ed\u8bc4', '\u6401\u8fd9\u5957\u5a03 \u8bc4\u8bba\u533a'],
  '\u6401\u8fd9\u5462': ['\u4f60\u6401\u8fd9\u6401\u8fd9\u5462 \u8bc4\u8bba', '\u6401\u8fd9\u5462 \u5f39\u5e55', '\u6401\u8fd9\u5462\u662f\u5427 \u70ed\u8bc4', '\u6401\u8fd9\u5957\u5a03 \u8bc4\u8bba\u533a'],
  '\u4e2a\u7b7e': ['\u6211\u7684\u4e2a\u7b7e\u4e5f\u662f \u8bc4\u8bba', '\u4e2a\u7b7e\u662f\u8fd9\u9996\u6b4c \u8bc4\u8bba', '\u4e2a\u6027\u7b7e\u540d \u70ed\u8bc4'],
  '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929': ['\u952e\u76d8\u4fa0 \u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929 \u70ed\u8bc4', '\u7ed9\u4f60\u4e00\u6839\u7f51\u7ebf\u4ed6\u80fd\u4e0a\u5929 \u8bc4\u8bba', '\u7ed9\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929 \u8bc4\u8bba', '\u952e\u76d8\u8bbe\u8ba1\u5e08 \u7ed9\u6839\u7f51\u7ebf \u70ed\u8bc4', '\u7ed9\u4f60\u6839\u7f51\u7ebf\u5c31\u4e0a\u5929 \u8bc4\u8bba'],
  '\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5': ['\u704c\u94c5\u7b5b\u5b50 \u70ed\u8bc4', '\u704c\u94c5\u7b5b\u5b50 \u6e38\u620f \u8bc4\u8bba', '\u6211\u4eec\u7ed9\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5 \u8bc4\u8bba', '\u7ed9\u7b5b\u5b50\u91cc\u704c\u94c5 \u70ed\u8bc4', '\u7b5b\u5b50\u91cc\u704c\u4e86\u94c5 \u8bc4\u8bba'],
  '\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5': ['\u704c\u94c5\u9ab0\u5b50 \u70ed\u8bc4', '\u704c\u94c5\u9ab0\u5b50 \u6e38\u620f \u8bc4\u8bba', '\u6211\u4eec\u7ed9\u9ab0\u5b50\u704c\u4e86\u94c5 \u8bc4\u8bba', '\u7ed9\u9ab0\u5b50\u704c\u94c5 \u70ed\u8bc4', '\u9ab0\u5b50\u704c\u4e86\u94c5 \u8bc4\u8bba'],
  '\u7ed9\u7237\u722c': ['\u7ed9\u7237\u722c \u8bc4\u8bba', '\u7ed9\u7237\u722c\u5427 \u70ed\u8bc4', '\u60a8\u914d\u5417 \u7ed9\u7237\u722c \u8bc4\u8bba'],
  '\u7ed9\u7237\u6574\u5b5d\u4e86': ['\u7ed9\u7237\u6574\u5b5d\u4e86 \u8bc4\u8bba', '\u771f\u7ed9\u7237\u6574\u5b5d\u4e86 \u70ed\u8bc4', '\u7ed9\u7237\u6574\u7b11\u4e86 \u8bc4\u8bba'],
  '\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c': ['\u6839\u672c\u6ca1\u6709\u53c2\u8003\u4ef7\u503c\u5440 \u8bc4\u8bba', '\u6ca1\u6709\u53c2\u8003\u4ef7\u503c \u70ed\u8bc4', '\u6839\u672c\u6ca1\u53c2\u8003\u4ef7\u503c \u8bc4\u8bba'],
  '\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8': ['\u6839\u672c\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8 \u8bc4\u8bba', '\u6ca1\u6709\u8bf4\u4e0d\u5141\u8bb8 \u70ed\u8bc4', '\u6839\u672c\u6ca1\u8bf4\u4e0d\u5141\u8bb8 \u8bc4\u8bba'],
  '\u8ddf\u98ce\u55b7': ['\u522b\u8ddf\u98ce\u55b7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8ddf\u98ce\u55b7 \u8282\u594f \u8bc4\u8bba', '\u8ddf\u98ce\u55b7 \u70ed\u8bc4'],
  '\u6897\u767e\u79d1': ['\u6897\u767e\u79d1 \u6c42\u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u4e2a\u6897\u767e\u79d1 \u8bc4\u8bba', '\u6897\u767e\u79d1 \u70ed\u8bc4'],
  '\u6897out\u4e86': ['\u8fd9\u6897out\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6897out\u4e86 \u8bc4\u8bba', '\u8fd9\u6897\u8fc7\u65f6\u4e86 \u70ed\u8bc4'],
  '\u516c\u77e5\u8bdd\u672f': ['\u516c\u77e5\u8bdd\u672f \u522b\u6d17 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53c8\u662f\u516c\u77e5\u8bdd\u672f \u8bc4\u8bba', '\u516c\u77e5\u8bdd\u672f \u70ed\u8bc4'],
  '\u5171\u6c89\u6ca6': ['\u4e00\u8d77\u5171\u6c89\u6ca6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u62c9\u7740\u5171\u6c89\u6ca6 \u8bc4\u8bba', '\u5171\u6c89\u6ca6 \u70ed\u8bc4'],
  '\u72d7\u6258': ['\u62bd\u5361\u72d7\u6258 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u4e5f\u592a\u72d7\u6258\u4e86 \u8bc4\u8bba', '\u72d7\u6258 \u70ed\u8bc4'],
  '\u6302\u8def\u706f': ['\u8d44\u672c\u5bb6\u6302\u8def\u706f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8be5\u6302\u8def\u706f \u8bc4\u8bba', '\u6302\u8def\u706f \u70ed\u8bc4'],
  '\u5173\u6ce8\u529b': ['\u4f60\u8fd9\u5173\u6ce8\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6c42\u4e00\u4e2a\u5173\u6ce8\u529b \u8bc4\u8bba', '\u5173\u6ce8\u529b \u70ed\u8bc4'],
  '\u68fa\u6750\u677f\u7ed9\u4f60\u5907\u597d\u4e86': ['\u68fa\u6750\u677f\u7ed9\u4f60\u5907\u597d\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u68fa\u6750\u677f\u5907\u597d\u4e86 \u8bc4\u8bba', '\u68fa\u6750\u677f \u7ed9\u4f60\u5907\u597d\u4e86'],
  '\u5e7f\u4e1c\u7684': ['IP\u5e7f\u4e1c\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u770bIP\u5e7f\u4e1c \u8bc4\u8bba', '\u5e7f\u4e1c\u7684 \u70ed\u8bc4'],
  '\u89c4\u8bad\u987e\u5ba2': ['\u5e97\u5bb6\u89c4\u8bad\u987e\u5ba2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u89c4\u8bad\u987e\u5ba2 \u5546\u5bb6 \u8bc4\u8bba', '\u88ab\u89c4\u8bad\u7684\u987e\u5ba2 \u70ed\u8bc4'],
  '\u8be1\u8ba1\u591a\u7aef\u76841': ['\u8be1\u8ba1\u591a\u7aef\u76841 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8be1\u8ba1\u591a\u7aef\u76841 \u8bc4\u8bba', '\u8be1\u8ba1\u591a\u7aef\u76841 \u5f39\u5e55'],
  '\u9b3c\u56fe\u6253\u7801': ['\u9b3c\u56fe\u6253\u7801 \u6c42\u539f\u56fe \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9b3c\u56fe\u6253\u7801 \u8bc4\u8bba', '\u6c42\u9b3c\u56fe\u6253\u7801\u7248 \u70ed\u8bc4'],
  '\u90ed\u8299\u84c9\u540c\u6b3e': ['\u90ed\u8299\u84c9\u540c\u6b3e \u6392\u5c71\u5012\u6d77 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u90ed\u8299\u84c9\u540c\u6b3e \u8bc4\u8bba', '\u6392\u5c71\u5012\u6d77 \u90ed\u8299\u84c9 \u70ed\u8bc4'],
  '\u679c\u8747play': ['\u679c\u8747play \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u679c\u8747play \u8bc4\u8bba', '\u679c\u8747play \u5f39\u5e55'],
  '\u6d77\u738b': ['\u6d77\u738b \u517b\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u662f\u6d77\u738b\u5427 \u8bc4\u8bba', '\u6d77\u738b \u70ed\u8bc4'],
  '\u542b\u7b11\u534a\u6b65\u98a0': ['\u542b\u7b11\u534a\u6b65\u98a0 \u5510\u4f2f\u864e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u542b\u7b11\u534a\u6b65\u98a0 \u8bc4\u8bba', '\u5510\u4f2f\u864e \u542b\u7b11\u534a\u6b65\u98a0'],
  '\u7f55\u89c1ip': ['\u7f55\u89c1ip \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7f55\u89c1IP \u8bc4\u8bba', '\u770bIP\u5c31\u7f55\u89c1 \u70ed\u8bc4'],
  '\u6c49\u5b50\u8336': ['\u6c49\u5b50\u8336 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6c49\u5b50\u8336 \u8bc4\u8bba', '\u53c8\u662f\u6c49\u5b50\u8336 \u70ed\u8bc4'],
  '\u597d\u5609\u4f19': ['\u597d\u5609\u4f19 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u597d\u5609\u4f19 \u8bc4\u8bba', '\u597d\u5bb6\u4f19 \u597d\u5609\u4f19'],
  '\u597d\u78d5\u7684\u5f88': ['\u597d\u78d5\u7684\u5f88 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u5bf9\u597d\u78d5\u7684\u5f88 \u8bc4\u8bba', '\u597d\u78d5\u7684\u5f88 \u70ed\u8bc4'],
  '\u597d\u62fc\u622a\u56fe': ['\u597d\u62fc\u622a\u56fe \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u597d\u62fc\u622a\u56fe \u8bc4\u8bba', '\u622a\u56fe\u597d\u62fc \u70ed\u8bc4'],
  '\u5de5\u91cdhao': ['\u5de5\u91cd\u53f7 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u516c\u91cd\u53f7 \u5f15\u6d41 \u8bc4\u8bba', '\u516c\u7cbd\u53f7 \u8bc4\u8bba\u533a'],
  '\u516c\u5f0f\u5957\u53cd\u4e86': ['\u8fd9\u516c\u5f0f\u7528\u53cd\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a', '\u4f60\u516c\u5f0f\u7528\u53cd\u4e86 \u66f4\u6b63 \u70ed\u8bc4', '\u516c\u5f0f\u5957\u9519\u4e86 \u66f4\u6b63 \u70ed\u8bc4'],
  '\u516c\u5b50\u4eec\u53ef\u4ee5\u5f00\u59cb\u63d2\u79e7\u54af': ['\u6211\u5bb6\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u516c\u5b50\u4f1a\u63d2\u79e7\u4e86 \u8bc4\u8bba', '\u5f00\u59cb\u63d2\u79e7\u4e86 \u70ed\u8bc4'],
  '\u9ed1\u5316\u53cc\u9c7c': ['\u9ed1\u5316\u53cc\u9c7c \u70ed\u8bc4', '\u9ed1\u5316\u53cc\u9c7c \u5f39\u5e55', '\u9ed1\u5316\u53cc\u9c7c \u8bc4\u8bba \u6897'],
  '\u5f88\u84dd\u7684\u62c9': ['\u5f88\u84dd\u7684\u5566 \u70ed\u8bc4', '\u96be\u7ef7 \u5f88\u84dd\u7684\u62c9 \u8bc4\u8bba', '\u592a\u96be\u4e86 \u5f88\u84dd\u7684\u62c9 \u5f39\u5e55'],
  '\u753b\u997c': ['\u753b\u997c \u70ed\u8bc4', '\u522b\u753b\u997c \u8bc4\u8bba', '\u53c8\u5728\u753b\u997c \u56de\u590d'],
  '\u8bb0\u9519\u4e86': ['\u8bb0\u9519\u4e86 \u66f4\u6b63 \u8bc4\u8bba\u533a', '\u6211\u8bb0\u9519\u4e86 \u70ed\u8bc4', '\u521a\u624d\u8bb0\u9519\u4e86 \u56de\u590d'],
  '\u8282\u594f\u72d7': ['\u8282\u594f\u72d7 \u70ed\u8bc4', '\u5e26\u8282\u594f\u7684\u72d7 \u8bc4\u8bba', '\u522b\u5e26\u8282\u594f \u8bc4\u8bba\u533a'],
  '\u6840\u6840\u6840': ['\u6840\u6840\u6840 \u70ed\u8bc4', '\u6840\u6840\u6840 \u5f39\u5e55', '\u6840\u6840\u6840 \u53cd\u6d3e \u8bc4\u8bba'],
  '\u7d27\u548c': ['\u7d27\u548c \u70ed\u8bc4', '\u7d27\u548c \u8bc4\u8bba \u6897', '\u7d27\u548c \u5f39\u5e55'],
  '\u8b66\u60d5\u901f\u80dc\u8bba': ['\u8b66\u60d5\u901f\u80dc\u8bba \u70ed\u8bc4', '\u4e0d\u8981\u901f\u80dc\u8bba \u8bc4\u8bba', '\u901f\u80dc\u8bba \u4e89\u8bae \u8bc4\u8bba'],
  '\u65e7\u65f6\u4ee3\u7684\u4ea7\u7269': ['\u65e7\u65f6\u4ee3\u7684\u4ea7\u7269 \u70ed\u8bc4', '\u8001\u4e1c\u897f \u65e7\u65f6\u4ee3\u7684\u4ea7\u7269 \u8bc4\u8bba', '\u65e7\u65f6\u4ee3\u7684\u4ea7\u7269 \u56de\u590d'],
  '\u6485\u9192': ['\u6485\u9192\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6485\u9192 \u70ed\u8bc4', '\u6485\u9192\u4e86 \u5f39\u5e55'],
  '\u7edd\u5bf9\u5316': ['\u522b\u7edd\u5bf9\u5316 \u8bc4\u8bba', '\u7edd\u5bf9\u5316\u53d1\u8a00 \u70ed\u8bc4', '\u8bf4\u7684\u592a\u7edd\u5bf9 \u8bc4\u8bba'],
  '\u7edd\u5bf9\u80fd': ['\u7edd\u5bf9\u80fd \u70ed\u8bc4', '\u4f60\u7edd\u5bf9\u80fd \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u80fd \u56de\u590d'],
  '\u7edd\u5bf9\u6b63\u786e': ['\u7edd\u5bf9\u6b63\u786e \u70ed\u8bc4', '\u6ca1\u6709\u7edd\u5bf9\u6b63\u786e \u8bc4\u8bba', '\u8c01\u7edd\u5bf9\u6b63\u786e \u56de\u590d'],
  '\u5f00\u9664\u91ce\u6838': ['\u5f00\u9664\u91ce\u6838 \u70ed\u8bc4', '\u738b\u8005\u8363\u8000 \u5f00\u9664\u91ce\u6838 \u8bc4\u8bba', 'KPL \u5f00\u9664\u91ce\u6838 \u56de\u590d'],
  '\u5f00\u667a\u4e86': ['\u5f00\u667a\u4e86 \u70ed\u8bc4', '\u7a81\u7136\u5f00\u667a\u4e86 \u8bc4\u8bba', '\u8fd9\u662f\u5f00\u667a\u4e86 \u56de\u590d'],
  '\u523b\u8fdbdna': ['\u523b\u8fdbdna\u7684 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u523b\u8fdbDNA \u70ed\u8bc4', '\u523b\u8fdbDNA\u4e86 \u5f39\u5e55'],
  '\u7a7a\u8033': ['\u7a7a\u8033 \u5f39\u5e55', '\u7a7a\u8033 \u70ed\u8bc4', '\u542c\u9519\u6b4c\u8bcd \u7a7a\u8033 \u8bc4\u8bba'],
  '\u8001\u56db': ['\u52d2\u8001\u56db \u70ed\u8bc4', 'F1 \u52d2\u8001\u56db \u8bc4\u8bba', '\u52d2\u514b\u83b1\u5c14 \u8001\u56db \u56de\u590d'],
  '\u8001\u786c\u5e01': ['\u8001\u786c\u5e01 \u70ed\u8bc4', '\u8001\u9634\u6bd4 \u8bc4\u8bba', '\u592a\u9634\u4e86 \u8001\u786c\u5e01 \u56de\u590d'],
  '\u8001\u5b50\u53c8\u4e0d\u778e': ['\u8001\u5b50\u53c8\u4e0d\u778e \u70ed\u8bc4', '\u732b \u8001\u5b50\u53c8\u4e0d\u778e \u8bc4\u8bba', '\u6211\u53c8\u4e0d\u778e \u56de\u590d'],
  '\u8138\u76ae\u591f\u539a': ['\u8138\u76ae\u591f\u539a \u70ed\u8bc4', '\u4e0d\u8981\u8138 \u8138\u76ae\u591f\u539a \u8bc4\u8bba', '\u4e92\u8054\u7f51\u63d0\u6b3e\u673a \u8138\u76ae\u591f\u539a'],
  '\u826f\u5fc3\u8fa3': ['\u592a\u826f\u5fc3\u8fa3 \u70ed\u8bc4', '\u6e38\u620f \u826f\u5fc3\u8fa3 \u8bc4\u8bba', '\u53ef\u592a\u826f\u5fc3\u8fa3 \u56de\u590d'],
  '\u4eae\u8840\u6761': ['\u4eae\u8840\u6761\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u4eae\u8840\u6761 \u5f00\u51b2 \u8bc4\u8bba', '\u70b9\u4e86\u5bf9\u7acbtag \u4eae\u8840\u6761'],
  '\u9f99\u50b2\u5929': ['\u9f99\u50b2\u5929\u5267\u672c \u70ed\u8bc4', '\u4e0d\u662f\u9f99\u50b2\u5929 \u8bc4\u8bba', '\u9f99\u50b2\u5929 \u5410\u69fd \u56de\u590d'],
  '\u9885\u5185\u9ad8\u6f6e': ['\u9885\u5185\u9ad8\u6f6e \u70ed\u8bc4', '\u9885\u5185\u9ad8\u6f6e\u5230\u65e0\u6cd5\u81ea\u62d4 \u8bc4\u8bba', '\u522b\u9885\u5185\u9ad8\u6f6e \u56de\u590d'],
  '\u9a74\u9a6c': ['\u9a82\u9a74\u9a6c \u70ed\u8bc4', '\u4ec0\u4e48\u9a74\u9a6c\u70c2\u5b50 \u8bc4\u8bba', '\u9a74\u9a6c\u70c2\u5b50 \u56de\u590d'],
  '\u5988\u5988\u751f\u7684': ['\u5988\u5988\u751f\u7684 \u70ed\u8bc4', '\u516c\u5f00\u53d1\u60c5 \u5988\u5988\u751f\u7684 \u8bc4\u8bba', '\u6211\u53ea\u4f1a\u5988\u5988\u751f\u7684 \u56de\u590d'],
  '\u9a6c\u540e\u70ae': ['\u7eaf\u7eaf\u9a6c\u540e\u70ae \u70ed\u8bc4', '\u9a6c\u540e\u70ae\u522b\u53eb\u4e86 \u8bc4\u8bba', '\u8fd9\u4e0d\u9a6c\u540e\u70ae\u5417 \u56de\u590d'],
  '\u9a6c\u524d\u5352': ['\u9a6c\u524d\u5352 \u70ed\u8bc4', '\u9a6c\u524d\u5352\u8fd9\u4e2a\u903c \u8bc4\u8bba', '\u601d\u60f3\u9635\u7ebf\u7684\u9a6c\u524d\u5352 \u56de\u590d'],
  '\u739b\u4e3d\u82cf': ['\u739b\u4e3d\u82cf\u53e4\u5076\u5267 \u70ed\u8bc4', '\u9f99\u50b2\u5929\u5267\u672c \u739b\u4e3d\u82cf \u8bc4\u8bba', '\u739b\u4e3d\u82cf \u5410\u69fd \u56de\u590d'],
  '\u5a9a\u5bcc': ['\u53c8\u5a9a\u5bcc\u4e86 \u70ed\u8bc4', 'lets \u5a9a\u5bcc \u8bc4\u8bba', '\u5a9a\u5bcc \u62dc\u91d1 \u56de\u590d'],
  '\u7537\u7684\u90fd\u7231\u753b\u997c': ['\u7537\u7684\u90fd\u7231\u753b\u997c \u70ed\u8bc4', '\u7ed9\u7537\u7684\u753b\u997c \u8bc4\u8bba', '\u7ffb\u8138\u4e0d\u8ba4\u4eba \u753b\u997c \u56de\u590d'],
  '\u4e5e\u4e10': ['\u8fd9\u79cd\u4e5e\u4e10 \u70ed\u8bc4', '\u50cf\u4e5e\u4e10\u4e00\u6837 \u8bc4\u8bba', '\u8ba8\u798f\u5229 \u4e5e\u4e10 \u56de\u590d'],
  '\u6c42\u9524\u5f97\u9524': ['\u6c42\u9524\u5f97\u9524 \u70ed\u8bc4', '\u7c89\u4e1d \u6c42\u9524\u5f97\u9524 \u8bc4\u8bba', '\u7b49\u56de\u65cb\u9556 \u6c42\u9524\u5f97\u9524'],
  '\u5168\u662f\u6c34\u519b': ['\u8bc4\u8bba\u533a\u5168\u662f\u6c34\u519b \u70ed\u8bc4', '\u5168\u662f\u6c34\u519b \u53d8\u7740\u6cd5 \u8bc4\u8bba', '\u522b\u6d17\u4e86 \u5168\u662f\u6c34\u519b'],
  '\u5168\u662f\u4e2d\u56fd': ['\u7b54 \u5168\u662f\u4e2d\u56fd \u70ed\u8bc4', '\u7ecf\u5178 \u5168\u662f\u4e2d\u56fd \u8bc4\u8bba', '\u5168\u662f\u4e2d\u56fd\u961f \u6328\u6253'],
  '\u62f3\u6b96\u4e00\u4f53': ['\u62f3\u6b96\u4e00\u4f53 \u70ed\u8bc4', '\u62f3\u6b96\u4e00\u4f53\u4e0d\u662f\u8bf4\u7740\u73a9\u7684 \u8bc4\u8bba', '\u6e05\u72b9\u62f3\u6b96\u4e00\u4f53\u5316'],
  '\u4e73\u8ffd': ['\u4e73\u8ffd\u7684\u4eba \u70ed\u8bc4', '\u53ea\u4e73\u4e0d\u8ffd \u8bc4\u8bba', '\u8fb1\u8ffd\u4eba\u58eb \u996d\u5708 \u56de\u590d'],
  '\u962e\u962e': ['\u962e\u962e\u8fdd\u7ea6 \u70ed\u8bc4', '\u962e\u962e \u8001\u8c22 \u8bc4\u8bba', '\u962e\u962e \u540c\u4e00\u4e2a\u4eba \u56de\u590d'],
  '\u745e\u601d\u62dc': ['\u745e\u601d\u62dc \u70ed\u8bc4', '\u5320\u4eba\u7cbe\u795e \u745e\u601d\u62dc \u8bc4\u8bba', '\u771f\u745e\u601d\u62dc \u56de\u590d'],
  '\u8d5b\u5bc4': ['\u8d5b\u5bc4 \u9000\u94b1 \u70ed\u8bc4', '\u8d5b\u5bc4 \u5dee\u8bc4\u53cd\u9988 \u8bc4\u8bba', '\u8d5b\u5bc4 \u8d8a\u6765\u8d8a\u96be\u73a9'],
  '\u4e09\u8fde\u9001\u4e0a': ['\u4e09\u8fde\u9001\u4e0a \u70ed\u8bc4', '\u89c6\u9891\u653e\u5b8c\u7ed9\u4e09\u8fde \u8bc4\u8bba', '\u5173\u6ce8\u4e09\u8fde \u5e08\u5085 \u56de\u590d'],
  '\u4e0a\u5634\u8138': ['\u4e0a\u5634\u8138 \u70ed\u8bc4', '\u8df3\u51fa\u6765\u4e0a\u5634\u8138 \u8bc4\u8bba', '\u5c31\u4e0a\u5634\u8138\u554a \u56de\u590d'],
  '\u795e\u70e6': ['\u795e\u70e6\u5979 \u70ed\u8bc4', '\u770b\u4e2a\u5f39\u5e55\u90fd\u795e\u70e6 \u8bc4\u8bba', '\u73b0\u5728\u795e\u70e6 \u56de\u590d'],
  '\u6e7f\u6e7f': ['\u5218\u8bd7\u8bd7 \u6e7f\u6e7f \u70ed\u8bc4', '\u8c03\u4f83\u5218\u8bd7\u8bd7 \u6e7f\u6e7f \u8bc4\u8bba', '\u8bd7\u8bd7 \u6e7f\u6e7f \u9ed1\u79f0'],
  '\u5c4e\u5c71\u4ee3\u7801': ['\u5c4e\u5c71\u4ee3\u7801 \u70ed\u8bc4', '\u5c4e\u5c71\u4ee3\u7801 bug \u8bc4\u8bba', '\u767d\u5ad6\u6211\u4fee \u5c4e\u5c71\u4ee3\u7801'],
  '\u6311\u62e8\u79bb\u95f4': ['\u6311\u62e8\u79bb\u95f4 \u70ed\u8bc4', '\u4f60\u4eec\u5c31\u5728\u8fd9\u91cc\u6311\u62e8\u79bb\u95f4 \u8bc4\u8bba', '\u79c1\u5e95\u4e0b\u597d\u7740\u5462 \u6311\u62e8\u79bb\u95f4'],
  '\u6211\u6562\u8bf4': ['\u6211\u6562\u8bf4 \u70ed\u8bc4', '\u6211\u6562\u8bf4\u7edd\u5bf9 \u8bc4\u8bba', '\u6211\u6562\u8bf4\u80af\u5b9a \u56de\u590d'],
  '\u6211\u6709\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e': ['\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e \u70ed\u8bc4', '\u6211\u6709\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e \u8bc4\u8bba', '\u4f60\u6709\u5341\u4e2a\u4ebf\u7f8e\u5143\u7684\u5b58\u6b3e'],
  '\u65e0\u5f62\u7684\u5927\u624b': ['\u65e0\u5f62\u7684\u5927\u624b \u70ed\u8bc4', '\u80cc\u540e\u65e0\u5f62\u7684\u5927\u624b \u8bc4\u8bba', '\u6709\u65e0\u5f62\u7684\u5927\u624b \u56de\u590d'],
  '\u7ec6\u8282\u53e5\u53f7': ['\u7ec6\u8282\u53e5\u53f7 \u70ed\u8bc4', '\u6587\u6848 \u7ec6\u8282\u53e5\u53f7 \u8bc4\u8bba', '\u8fd9\u4e2a\u53e5\u53f7\u662f\u7ec6\u8282 \u56de\u590d'],
  '\u663e\u5fae\u955c\u90fd\u4e0d\u4f1a\u7528': ['\u663e\u5fae\u955c\u90fd\u4e0d\u4f1a\u7528 \u70ed\u8bc4', '\u7f51\u53cb\u62ff\u663e\u5fae\u955c\u770b \u8bc4\u8bba', '\u663e\u5fae\u955c\u770b\u90fd\u770b\u4e0d\u51fa\u6765'],
  '\u60f3\u5200\u4eba': ['\u60f3\u5200\u4eba\u7684\u773c\u795e\u85cf\u4e0d\u4f4f \u70ed\u8bc4', '\u60f3\u5200\u4eba \u8bc4\u8bba', '\u773c\u795e\u85cf\u4e0d\u4f4f \u60f3\u5200\u4eba'],
  '\u60f3\u4e00\u51fa\u662f\u4e00\u51fa': ['\u60f3\u4e00\u51fa\u662f\u4e00\u51fa \u70ed\u8bc4', '\u7b56\u5212\u60f3\u4e00\u51fa\u662f\u4e00\u51fa \u8bc4\u8bba', '\u522b\u60f3\u4e00\u51fa\u662f\u4e00\u51fa'],
  '\u5c0f\u5b69\u59d0': ['\u5c0f\u5b69\u59d0 \u70ed\u8bc4', '\u5c0f\u5b69\u59d0\u6765\u4e86 \u8bc4\u8bba', '\u5929\u624d\u5c0f\u5b69\u59d0 \u56de\u590d'],
  '\u5c0f\u4ed9\u7537': ['\u5c0f\u4ed9\u7537 \u70ed\u8bc4', '\u96c6\u7f8e\u5c0f\u4ed9\u7537 \u8bc4\u8bba', '\u5c0f\u4ed9\u7537\u7834\u9632 \u56de\u590d'],
  '\u7b11\u4e96': ['\u7b11\u4e96 \u70ed\u8bc4', '\u771f\u7684\u7b11\u4e96 \u8bc4\u8bba', '\u7b11\u4e96\u6211\u4e86 \u56de\u590d'],
  '\u659c\u773c\u7b11': ['\u659c\u773c\u7b11 \u8868\u60c5 \u70ed\u8bc4', '\u659c\u773c\u7b11 \u8bc4\u8bba', '\u53d1\u4e2a\u659c\u773c\u7b11 \u56de\u590d'],
  '\u5b66\u65b0\u95fb\u5b66': ['\u5b66\u65b0\u95fb\u5b66 \u70ed\u8bc4', '\u4f60\u662f\u5b66\u65b0\u95fb\u5b66\u7684 \u8bc4\u8bba', '\u4f60\u8fd9\u65b0\u95fb\u5b66\u5b66\u7684'],
  '\u8840\u4e66': ['\u4e07\u4eba\u8840\u4e66 \u70ed\u8bc4', '\u8840\u4e66\u6c42\u66f4 \u8bc4\u8bba', '\u8840\u4e66\u6c42\u51fa \u56de\u590d'],
  '\u4e25\u7236': ['\u7535\u5b50\u4e25\u7236 \u70ed\u8bc4', '\u7c89\u5708\u4e25\u7236 \u8bc4\u8bba', '\u4e25\u7236\u5f0f\u53d1\u8a00 \u56de\u590d'],
  '\u4e00\u65b9\u901a\u884c': ['\u5355\u5411\u8f93\u51fa \u4e00\u65b9\u901a\u884c \u70ed\u8bc4', '\u8bc4\u8bba\u533a\u4e00\u65b9\u901a\u884c \u8bc4\u8bba', '\u53ea\u51c6\u4ed6\u8bf4 \u4e00\u65b9\u901a\u884c'],
  '\u4e00\u6761\u9f99': ['\u7f51\u66b4\u4e00\u6761\u9f99 \u70ed\u8bc4', '\u4e3e\u62a5\u62c9\u9ed1\u4e00\u6761\u9f99 \u8bc4\u8bba', '\u7c89\u4e1d\u4e00\u6761\u9f99\u670d\u52a1'],
  '0\u63d0\u5347': ['\u96f6\u63d0\u5347 \u70ed\u8bc4', '\u4e00\u70b9\u63d0\u5347\u6ca1\u6709 \u8bc4\u8bba', '\u6beb\u65e0\u63d0\u5347 \u56de\u590d'],
  '10\u5e74\u8001\u7c89': ['\u5341\u5e74\u8001\u7c89 \u70ed\u8bc4', '\u8001\u7c89\u5341\u5e74 \u8bc4\u8bba', '\u5341\u5e74\u8001\u7c89\u4e0d\u8bf7\u81ea\u6765'],
  '12300\u5de5\u4fe1\u90e8\u6295\u8bc9': ['\u5de5\u4fe1\u90e8\u6295\u8bc9 \u70ed\u8bc4', '12300\u6295\u8bc9 \u8bc4\u8bba', '\u625312300\u6295\u8bc9 \u56de\u590d'],
  '2026\u6253\u5361': ['2026\u6253\u5361 \u70ed\u8bc4', '\u6253\u53612026 \u8bc4\u8bba', '2026\u5e74\u6253\u5361 \u56de\u590d'],
  '\u57c3\u53ca\u5427': ['\u57c3\u53ca\u5427\u8001\u54e5 \u70ed\u8bc4', '\u57c3\u53ca\u5427\u5427\u53cb \u8bc4\u8bba', '\u57c3\u53ca\u5427\u6765\u4e86 \u56de\u590d'],
  '\u827e\u6ecb\u5200': ['\u827e\u6ecb\u5200 \u70ed\u8bc4', '\u827e\u6ecb\u5200\u9a82\u6218 \u8bc4\u8bba', '\u7528\u827e\u6ecb\u5200\u8fd9\u4e2a\u8bcd'],
  '\u827e\u6ecb\u91ce': ['\u827e\u6ecb\u91ce \u70ed\u8bc4', '\u827e\u6ecb\u91ce\u9a82\u6218 \u8bc4\u8bba', '\u7528\u827e\u6ecb\u91ce\u8fd9\u4e2a\u8bcd'],
  '\u7231\u548b\u548b\u5730': ['\u7231\u548b\u548b\u5730 \u70ed\u8bc4', '\u968f\u4fbf\u4f60\u7231\u548b\u548b\u5730 \u8bc4\u8bba', '\u7231\u600e\u4e48\u7740\u600e\u4e48\u7740 \u56de\u590d'],
  '\u7231\u548b\u548b\u7684': ['\u7231\u548b\u548b\u7684 \u70ed\u8bc4', '\u968f\u4fbf\u4f60\u7231\u548b\u548b\u7684 \u8bc4\u8bba', '\u7231\u600e\u4e48\u7740\u600e\u4e48\u7740 \u56de\u590d'],
  '\u62d4\u7fa4': ['\u6548\u679c\u62d4\u7fa4 \u70ed\u8bc4', '\u62d4\u7fa4 \u70ed\u8bc4', '\u6548\u679c\u62d4\u7fa4 \u8bc4\u8bba', '\u6548\u679c\u62d4\u7fa4 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4'],
  '\u4e00\u8f6c\u653b\u52bf': ['\u4e00\u8f6c\u653b\u52bf \u70ed\u8bc4', '\u8bdd\u950b\u4e00\u8f6c\u653b\u52bf \u8bc4\u8bba', '\u76f4\u63a5\u4e00\u8f6c\u653b\u52bf'],
  '\u4f0a\u5229\u4e9a\u6211\u8f6f\u811a\u4e86': ['\u4f0a\u5229\u4e9a\u6211\u8f6f\u811a\u4e86 \u70ed\u8bc4', '\u4f0a\u5229\u4e9a \u8f6f\u811a\u4e86 \u8bc4\u8bba', '\u4f0a\u5229\u4e9a\u6211\u817f\u8f6f\u4e86'],
  '\u4f18\u5316\u51fa\u53bb': ['\u4f18\u5316\u51fa\u53bb \u70ed\u8bc4', '\u88ab\u516c\u53f8\u4f18\u5316\u51fa\u53bb \u8bc4\u8bba', '\u628a\u4eba\u4f18\u5316\u51fa\u53bb'],
  '\u6709\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb': ['\u6709\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb \u70ed\u8bc4', '\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb \u8bc4\u8bba', '\u5957\u516c\u5f0f\u505a\u9898\u5c31\u662f\u5feb'],
  '\u6709\u4eba\u6025\u4e86': ['\u6709\u4eba\u6025\u4e86 \u70ed\u8bc4', '\u8c01\u6025\u4e86\u6211\u4e0d\u8bf4 \u8bc4\u8bba', '\u6025\u4e86\u6025\u4e86 \u56de\u590d'],
  '\u5728\u6211\u770b\u6765': ['\u5728\u6211\u770b\u6765 \u70ed\u8bc4', '\u5728\u6211\u770b\u6765\u5c31\u662f \u8bc4\u8bba', '\u5728\u6211\u770b\u6765\u8fd9\u5c31\u662f'],
  '\u627e\u4e2a\u73ed\u4e0a': ['\u627e\u4e2a\u73ed\u4e0a \u70ed\u8bc4', '\u5efa\u8bae\u627e\u4e2a\u73ed\u4e0a \u8bc4\u8bba', '\u522b\u5728\u7f51\u4e0a\u627e\u4e2a\u73ed\u4e0a'],
  '\u8fd9\u90fd\u4e0d\u77e5\u9053': ['\u8fd9\u90fd\u4e0d\u77e5\u9053 \u70ed\u8bc4', '\u8fd9\u4f60\u90fd\u4e0d\u77e5\u9053 \u8bc4\u8bba', '\u8fd9\u90fd\u4e0d\u77e5\u9053\u8fd8\u8bf4'],
  '\u771f\u5c0f\u4e11': ['\u771f\u5c0f\u4e11 \u70ed\u8bc4', '\u5c0f\u4e11\u7adf\u662f\u6211\u81ea\u5df1 \u8bc4\u8bba', '\u4f60\u771f\u662f\u5c0f\u4e11'],
  '\u6b63\u4e49\u5f00\u76d2': ['\u6b63\u4e49\u5f00\u76d2 \u70ed\u8bc4', '\u6253\u7740\u6b63\u4e49\u65d7\u53f7\u5f00\u76d2 \u8bc4\u8bba', '\u522b\u6b63\u4e49\u5f00\u76d2'],
  '\u6307\u8def': ['\u6307\u8def \u70ed\u8bc4', '\u8bc4\u8bba\u533a\u6307\u8def \u8bc4\u8bba', '\u6307\u8def\u4e00\u4e0b \u56de\u590d'],
  '\u4f17\u6240\u5468\u77e5': ['\u4f17\u6240\u5468\u77e5 \u70ed\u8bc4', '\u4f17\u6240\u5468\u77e5\u4e86 \u8bc4\u8bba', '\u4f17\u6240\u5468\u77e5\u8fd9\u5c31\u662f'],
  '\u5468\u5904': ['\u5468\u5904\u9664\u4e09\u5bb3 \u70ed\u8bc4', '\u4f60\u5c31\u662f\u5468\u5904 \u8bc4\u8bba', '\u73b0\u4ee3\u5468\u5904 \u56de\u590d'],
  '\u8f6c\u884c': ['\u8fd8\u662f\u8f6c\u884c\u5427 \u70ed\u8bc4', '\u5efa\u8bae\u8f6c\u884c \u8bc4\u8bba', '\u4e0d\u884c\u5c31\u8f6c\u884c'],
  '\u5c0a\u91cd\u795d\u798f': ['\u5c0a\u91cd\u795d\u798f \u70ed\u8bc4', '\u6211\u5c0a\u91cd\u795d\u798f \u8bc4\u8bba', '\u5c0a\u91cd\u795d\u798f\u9501\u6b7b'],
  '\u597d\u65f6\u4ee3\u6765\u4e34\u529b': ['\u597d\u65f6\u4ee3\u6765\u4e34\u529b \u70ed\u8bc4', '\u597d\u65f6\u4ee3\u6765\u4e34\u529b \u8bc4\u8bba', '\u597d\u65f6\u4ee3\u6765\u4e34\u529b \u8bc4\u8bba\u533a'],
  '\u597d\u50cf\u5927\u6982\u53ef\u80fd\u5e94\u8be5\u6216\u8bb8': ['\u597d\u50cf\u5927\u6982\u53ef\u80fd\u5e94\u8be5\u6216\u8bb8 \u70ed\u8bc4', '\u597d\u50cf\u5927\u6982\u53ef\u80fd\u5e94\u8be5\u6216\u8bb8 \u8bc4\u8bba', '\u597d\u50cf\u5927\u6982\u53ef\u80fd \u8bc4\u8bba'],
  '\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c': ['\u597d\u8a00\u96be\u529d\u8be5\u6b7b\u7684\u9b3c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u597d\u8a00\u96be\u529d\u60f3\u6b7b\u7684\u9b3c \u8bc4\u8bba', '\u597d\u8a00\u96be\u529d \u60f3\u6b7b\u7684\u9b3c'],
  '\u597d\u81ea\u4e3a\u4e4b\u5427': ['\u597d\u81ea\u4e3a\u4e4b\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u597d\u81ea\u4e3a\u4e4b\u5427 \u8bc4\u8bba', '\u4f60\u597d\u81ea\u4e3a\u4e4b\u5427'],
  '\u6838\u6b66\u5668\u51fd\u6570\u4e50': ['\u6838\u6b66\u5668\u51fd\u6570\u4e50 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6838\u6b66\u5668\u51fd\u6570\u4e50 \u8bc4\u8bba', '\u6838\u6b66\u5668\u51fd\u6570\u4e50 \u5f39\u5e55'],
  '\u9ed1\u5386\u53f2\u5236\u9020\u673a': ['\u9ed1\u5386\u53f2\u5236\u9020\u673a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u662f\u9ed1\u5386\u53f2\u5236\u9020\u673a \u8bc4\u8bba', '\u9ed1\u5386\u53f2\u5236\u9020\u673a \u70ed\u8bc4'],
  '\u9ed1\u9676\u6e0a\u660e': ['\u9ed1\u9676\u6e0a\u660e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9ed1\u9676\u6e0a\u660e \u8bc4\u8bba', '\u9ed1\u9676\u6e0a\u660e \u70ed\u8bc4'],
  '\u5f88\u68d2\u5148\u751f': ['\u5f88\u68d2\u5148\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f88\u68d2\u5148\u751f \u8bc4\u8bba', '\u8fd9\u4e0b\u5f88\u68d2\u5148\u751f'],
  '\u5f88\u7239\u5473': ['\u8fd9\u53d1\u8a00\u5f88\u7239\u5473 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f88\u7239\u5473 \u8bc4\u8bba', '\u7239\u5473\u592a\u91cd \u70ed\u8bc4'],
  '\u5f88\u61c2\u561b\u8001\u94c1': ['\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba', '\u5f88\u61c2\u561b\u8001\u94c1 \u70ed\u8bc4'],
  '\u6d3b\u7684\u50cf\u4e2a\u5c0f\u4e11': ['\u6d3b\u5f97\u50cf\u4e2a\u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d3b\u7684\u50cf\u4e2a\u5c0f\u4e11 \u8bc4\u8bba', '\u50cf\u4e2a\u5c0f\u4e11 \u70ed\u8bc4'],
  '\u8bb0\u5fc6\u4fee\u6b63': ['\u8bb0\u5fc6\u4fee\u6b63 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53c8\u5f00\u59cb\u8bb0\u5fc6\u4fee\u6b63 \u8bc4\u8bba', '\u7f51\u53cb\u8bb0\u5fc6\u4fee\u6b63'],
  '\u76d1\u72f1\u6765\u7684\u5988\u5988': ['\u76d1\u72f1\u6765\u7684\u5988\u5988 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u76d1\u72f1\u6765\u7684\u5988\u5988 \u8bc4\u8bba', '\u76d1\u72f1\u6765\u7684\u5988\u5988 \u70ed\u8bc4'],
  '\u5efa\u5c0f\u7fa4': ['\u62c9\u7fa4\u5efa\u5c0f\u7fa4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5efa\u5c0f\u7fa4 \u8bc4\u8bba', '\u53c8\u5efa\u5c0f\u7fa4\u4e86'],
  '\u9274\u5b9a\u4e3a\u5c4e': ['\u9274\u5b9a\u4e3a\u5c4e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9274\u5b9a\u4e3a\u5c4e \u8bc4\u8bba', '\u9274\u5b9a\u4e3a\u7eaf\u5c4e'],
  '\u952e\u76d8\u8bbe\u8ba1\u5e08': ['\u952e\u76d8\u8bbe\u8ba1\u5e08 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u952e\u76d8\u8bbe\u8ba1\u5e08 \u8bc4\u8bba', '\u4e91\u8bbe\u8ba1\u5e08 \u952e\u76d8'],
  '\u5956\u538b\u6291': ['\u5956\u538b\u6291 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5956\u538b\u6291 \u8bc4\u8bba', '\u8fd9\u6ce2\u5956\u538b\u6291'],
  '\u4ea4\u4ee3\u6e05\u695a': ['\u4ea4\u4ee3\u6e05\u695a \u56de\u590d \u70ed\u8bc4', '\u4ea4\u4ee3\u6e05\u695a \u8bc4\u8bba', '\u8bf7\u4ea4\u4ee3\u6e05\u695a'],
  '\u8857\u8fb9\u9ec4\u6bdb': ['\u8857\u8fb9\u9ec4\u6bdb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8857\u8fb9\u9ec4\u6bdb \u8bc4\u8bba', '\u50cf\u8857\u8fb9\u9ec4\u6bdb'],
  '\u8857\u5a03\u513f\u98de\u5347': ['\u8857\u5a03\u513f\u98de\u5347 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8857\u5a03\u513f\u98de\u5347 \u8bc4\u8bba', '\u8857\u5a03\u513f\u98de\u5347 \u70ed\u8bc4'],
  '\u4eca\u5929\u88ab\u6253\u4e86\u6ca1\u6709': ['\u4eca\u5929\u88ab\u6253\u4e86\u6ca1\u6709 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eca\u5929\u88ab\u6253\u4e86\u6ca1\u6709 \u8bc4\u8bba', '\u4eca\u5929\u88ab\u6253\u4e86\u5417'],
  '\u91d1\u5777\u5783': ['\u91d1\u5777\u5783 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u91d1\u5777\u5783 \u8bc4\u8bba', '\u91d1\u5777\u5783 \u70ed\u8bc4'],
  '\u7cbe\u795e\u7f8e\u56fd\u4eba': ['\u7cbe\u795e\u7f8e\u56fd\u4eba \u65f6\u653f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7cbe\u795e\u7f8e\u56fd\u4eba \u8bc4\u8bba', '\u53c8\u662f\u7cbe\u795e\u7f8e\u56fd\u4eba'],
  '\u7ea0\u6b63\u54e5': ['\u7ea0\u6b63\u54e5 \u56de\u590d \u70ed\u8bc4', '\u7ea0\u6b63\u54e5 \u8bc4\u8bba', '\u53c8\u6765\u7ea0\u6b63\u4e86'],
  '\u9152\u5e9f\u4e86': ['\u9152\u5e9f\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9152\u5e9f\u4e86 \u8bc4\u8bba', '\u8fd9\u9152\u5e9f\u4e86'],
  '\u9152\u6cb8\u4e86': ['\u9152\u6cb8\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9152\u6cb8\u4e86 \u8bc4\u8bba', '\u8fd9\u9152\u6cb8\u4e86'],
  '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d': ['\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d \u6570\u636e\u53ef\u89c6\u5316 \u8bc4\u8bba', '\u7edd\u5bf9\u6bd4\u6761\u5f62\u66f4\u597d \u8bc4\u8bba', '\u6bd4\u6761\u5f62\u66f4\u597d \u56fe\u8868 \u8bc4\u8bba'],
  '\u7edd\u5bf9\u4e0d\u591f\u7684': ['\u7edd\u5bf9\u4e0d\u591f\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u4e0d\u591f\u7684 \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u4e0d\u591f'],
  '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b': ['\u7edd\u5bf9\u7684\u751f\u4ea7\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u7684\u751f\u4ea7\u529b \u8bc4\u8bba', '\u8fd9\u662f\u7edd\u5bf9\u7684\u751f\u4ea7\u529b'],
  '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c': ['\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c \u6c7d\u8f66 \u8bc4\u8bba', '\u7edd\u5bf9\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c \u8bc4\u8bba', '\u9ad8\u4e8e\u5170\u535a\u57fa\u5c3c \u70ed\u8bc4'],
  '\u7edd\u5bf9\u53ef\u4ee5\u723d': ['\u7edd\u5bf9\u53ef\u4ee5\u723d \u6e38\u620f \u8bc4\u8bba\u533a', '\u7edd\u5bf9\u53ef\u4ee5\u723d \u8bc4\u8bba', '\u7edd\u5bf9\u53ef\u4ee5\u723d\u4e00\u4e0b'],
  '\u7edd\u5bf9\u4e70\u7684\u5230': ['\u7edd\u5bf9\u4e70\u7684\u5230 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u4e70\u5f97\u5230 \u8bc4\u8bba', '\u80af\u5b9a\u4e70\u7684\u5230'],
  '\u7edd\u5bf9\u6ca1\u6709\u5077\u5403': ['\u7edd\u5bf9\u6ca1\u6709\u5077\u5403 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u6ca1\u6709\u5077\u5403 \u8bc4\u8bba', '\u771f\u6ca1\u6709\u5077\u5403'],
  '\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898': ['\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898 \u6d88\u8d39 \u8bc4\u8bba', '\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898 \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u662f\u8d28\u91cf\u95ee\u9898'],
  '\u7edd\u5bf9\u5e05\u54e5': ['\u7edd\u5bf9\u5e05\u54e5 \u989c\u503c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u5e05\u54e5 \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u5e05\u54e5'],
  '\u7edd\u5bf9\u4e5f\u662f': ['\u7edd\u5bf9\u4e5f\u662f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u4e5f\u662f \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u4e5f\u662f'],
  '\u7edd\u5bf9\u6709\u95ee\u9898\u7684': ['\u7edd\u5bf9\u6709\u95ee\u9898\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u5bf9\u6709\u95ee\u9898\u7684 \u8bc4\u8bba', '\u8fd9\u7edd\u5bf9\u6709\u95ee\u9898'],
  '\u7edd\u5bf9\u4e3b\u7ebf': ['\u7edd\u5bf9\u4e3b\u7ebf \u6e38\u620f \u5267\u60c5 \u8bc4\u8bba', '\u7edd\u5bf9\u4e3b\u7ebf \u8bc4\u8bba', '\u8fd9\u662f\u7edd\u5bf9\u4e3b\u7ebf'],
  '\u7edd\u6d3b\u5f3a\u5ea6': ['\u7edd\u6d3b\u5f3a\u5ea6 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7edd\u6d3b\u5f3a\u5ea6 \u8bc4\u8bba', '\u7edd\u6d3b\u54e5 \u5f3a\u5ea6'],
  '\u5f00\u9664\u51e1\u51e1': ['\u5f00\u9664\u51e1\u51e1 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f00\u9664\u51e1\u51e1 \u8bc4\u8bba', '\u51e1\u51e1\u5f00\u9664'],
  '\u5f00\u56fd\u7684\u65f6\u5019': ['\u5f00\u56fd\u7684\u65f6\u5019 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f00\u56fd\u7684\u65f6\u5019 \u8bc4\u8bba', '\u5f00\u56fd\u65f6\u5019'],
  '\u5f00\u723d\u54af': ['\u5f00\u723d\u54af \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f00\u723d\u54af \u8bc4\u8bba', '\u8fd9\u4e0b\u5f00\u723d\u54af'],
  '\u770b\u8fc7\u53bb\u5168\u662f\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684': ['\u770b\u8fc7\u53bb\u5168\u662f\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684 \u65f6\u653f \u8bc4\u8bba\u533a', '\u5168\u662f\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684 \u8bc4\u8bba', '\u7f8e\u56fd\u81ea\u5df1\u5e72\u7684 \u70ed\u8bc4'],
  '\u770b\u6ee1\u79bb': ['\u770b\u6ee1\u79bb \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u770b\u6ee1\u79bb \u8bc4\u8bba', '\u6ee1\u79bb\u515a \u8bc4\u8bba'],
  '\u770b\u95e8\u5c0f\u4e11': ['\u770b\u95e8\u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u770b\u95e8\u5c0f\u4e11 \u8bc4\u8bba', '\u8fd9\u4e0b\u770b\u95e8\u5c0f\u4e11'],
  '\u770b\u4e0b\u7075\u6839': ['\u770b\u4e0b\u7075\u6839 \u4fee\u4ed9 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u770b\u4e0b\u7075\u6839 \u8bc4\u8bba', '\u67e5\u4e00\u4e0b\u7075\u6839'],
  '\u8003\u5f97\u50cf\u53f2': ['\u8003\u5f97\u50cf\u53f2 \u8003\u8bd5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8003\u5f97\u50cf\u53f2 \u8bc4\u8bba', '\u8003\u8bd5\u50cf\u53f2'],
  '\u55d1\u836f\u63a8\u5e7f\u5e7f\u544a': ['\u55d1\u836f\u63a8\u5e7f\u5e7f\u544a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u55d1\u836f\u63a8\u5e7f\u5e7f\u544a \u8bc4\u8bba', '\u63a8\u5e7f\u5e7f\u544a\u50cf\u55d1\u836f'],
  '\u53ef\u4e0d\u662f\u5c31\u6025\u4e86\u561b': ['\u53ef\u4e0d\u662f\u5c31\u6025\u4e86\u561b \u56de\u590d \u70ed\u8bc4', '\u53ef\u4e0d\u662f\u5c31\u6025\u4e86\u561b \u8bc4\u8bba', '\u8fd9\u4e0b\u6025\u4e86\u561b'],
  '\u53ef\u80fd\u5012\u95ed\u4f46\u7edd\u4e0d\u53ef\u80fd\u53d8\u8d28': ['\u53ef\u80fd\u5012\u95ed\u4f46\u7edd\u4e0d\u53ef\u80fd\u53d8\u8d28 \u54c1\u724c \u8bc4\u8bba', '\u53ef\u80fd\u5012\u95ed\u4f46\u7edd\u4e0d\u53ef\u80fd\u53d8\u8d28 \u8bc4\u8bba', '\u5012\u95ed\u4f46\u4e0d\u53ef\u80fd\u53d8\u8d28'],
  '\u80af\u5b9a\u780d\u4e86': ['\u80af\u5b9a\u780d\u4e86 \u6e38\u620f \u6539\u52a8 \u8bc4\u8bba', '\u80af\u5b9a\u780d\u4e86 \u8bc4\u8bba', '\u8fd9\u80af\u5b9a\u780d\u4e86'],
  '\u80af\u5b9a\u662f\u53ef\u4ee5\u7684': ['\u80af\u5b9a\u662f\u53ef\u4ee5\u7684 \u56de\u590d \u70ed\u8bc4', '\u80af\u5b9a\u662f\u53ef\u4ee5\u7684 \u8bc4\u8bba', '\u8fd9\u80af\u5b9a\u53ef\u4ee5'],
  '\u80af\u5b9a\u662f\u82e6\u8089\u8ba1': ['\u80af\u5b9a\u662f\u82e6\u8089\u8ba1 \u65f6\u653f \u8bc4\u8bba\u533a', '\u80af\u5b9a\u662f\u82e6\u8089\u8ba1 \u8bc4\u8bba', '\u82e6\u8089\u8ba1 \u70ed\u8bc4'],
  '\u80af\u5b9a\u662f\u4eba\u7684\u9519': ['\u80af\u5b9a\u662f\u4eba\u7684\u9519 \u6e38\u620f \u8bc4\u8bba\u533a', '\u80af\u5b9a\u662f\u4eba\u7684\u9519 \u8bc4\u8bba', '\u53c8\u662f\u4eba\u7684\u9519'],
  '\u80af\u5b9a\u662f\u60f3\u91d1\u8749\u8131\u58f3': ['\u80af\u5b9a\u662f\u60f3\u91d1\u8749\u8131\u58f3 \u65f6\u653f \u8bc4\u8bba', '\u80af\u5b9a\u662f\u60f3\u91d1\u8749\u8131\u58f3 \u8bc4\u8bba', '\u91d1\u8749\u8131\u58f3 \u70ed\u8bc4'],
  '\u80af\u5b9a\u662f\u60f3\u754f\u7f6a\u81ea\u6740': ['\u80af\u5b9a\u662f\u60f3\u754f\u7f6a\u81ea\u6740 \u65f6\u653f \u8bc4\u8bba', '\u80af\u5b9a\u662f\u60f3\u754f\u7f6a\u81ea\u6740 \u8bc4\u8bba', '\u754f\u7f6a\u81ea\u6740 \u70ed\u8bc4'],
  '\u6050\u6016\u7ae5\u8c23\u7edd\u5bf9\u7b2c\u4e00': ['\u6050\u6016\u7ae5\u8c23\u7edd\u5bf9\u7b2c\u4e00 \u660e\u661f\u5927\u4fa6\u63a2 \u8bc4\u8bba', '\u6050\u6016\u7ae5\u8c23\u7edd\u5bf9\u7b2c\u4e00 \u8bc4\u8bba', '\u660e\u4fa6\u6050\u6016\u7ae5\u8c23 \u70ed\u8bc4'],
  '\u63a7\u80c3\u4e4b\u795e': ['\u63a7\u80c3\u4e4b\u795e \u996e\u98df \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u63a7\u80c3\u4e4b\u795e \u8bc4\u8bba', '\u996e\u98df\u63a7\u80c3'],
  '\u80ef\u7fa4\u6267\u6cd5': ['\u8de8\u7fa4\u6267\u6cd5 \u7fa4\u804a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u80ef\u7fa4\u6267\u6cd5 \u8bc4\u8bba', '\u8de8\u7fa4\u6267\u6cd5 \u70ed\u8bc4'],
  '\u8de8\u670d\u6267\u6cd5': ['\u8de8\u670d\u6267\u6cd5 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8de8\u670d\u6267\u6cd5 \u8bc4\u8bba', '\u8de8\u670d\u6267\u6cd5 \u70ed\u8bc4'],
  '\u5feb\u4e50\u4e00\u8d5b\u5b63\u96be\u8fc7\u603b\u51b3\u8d5b': ['\u5feb\u4e50\u4e00\u8d5b\u5b63\u96be\u8fc7\u603b\u51b3\u8d5b \u4f53\u80b2 \u8bc4\u8bba', '\u5feb\u4e50\u4e00\u8d5b\u5b63\u96be\u8fc7\u603b\u51b3\u8d5b \u8bc4\u8bba', '\u96be\u8fc7\u603b\u51b3\u8d5b \u70ed\u8bc4'],
  '\u5feb\u901f\u5e73\u6574': ['\u5feb\u901f\u5e73\u6574 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5feb\u901f\u5e73\u6574 \u8bc4\u8bba', '\u5feb\u901f\u5e73\u6574\u4e00\u4e0b'],
  '\u5764\u5df4': ['\u5764\u5df4 \u8521\u5f90\u5764 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5764\u5df4 \u8bc4\u8bba', '\u9e21\u4f60\u592a\u7f8e \u5764\u5df4'],
  '\u62c9\u5c0f\u7fa4': ['\u62c9\u5c0f\u7fa4 \u7fa4\u804a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u62c9\u5c0f\u7fa4 \u8bc4\u8bba', '\u53c8\u62c9\u5c0f\u7fa4'],
  '\u62c9\u6905\u5b50': ['\u62c9\u6905\u5b50 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u62c9\u6905\u5b50 \u8bc4\u8bba', '\u6905\u5b50\u62c9\u8fc7\u6765'],
  '\u62c9jb\u5012': ['\u62c9jb\u5012 \u56de\u590d \u70ed\u8bc4', '\u62c9jb\u5012 \u8bc4\u8bba', '\u62c9\u5012\u5427'],
  '\u84dd\u516c\u4e3b': ['\u84dd\u516c\u4e3b \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u84dd\u516c\u4e3b \u8bc4\u8bba', '\u539f\u795e\u84dd\u516c\u4e3b'],
  '\u84dd\u7626\u9999\u83c7': ['\u84dd\u7626\u9999\u83c7 \u8001\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u84dd\u7626\u9999\u83c7 \u8bc4\u8bba', '\u96be\u53d7\u60f3\u54ed \u84dd\u7626\u9999\u83c7'],
  '\u70c2\u6897\u738b': ['\u70c2\u6897\u738b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u70c2\u6897\u738b \u8bc4\u8bba', '\u53c8\u662f\u70c2\u6897\u738b'],
  '\u635e\u7684\u4e00\u6279': ['\u635e\u7684\u4e00\u6279 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u635e\u7684\u4e00\u6279 \u8bc4\u8bba', '\u771f\u635e\u7684\u4e00\u6279'],
  '\u7262\u7334': ['\u7262\u7334 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7262\u7334 \u8bc4\u8bba', '\u7262\u7334\u6765\u4e86'],
  '\u7262\u5c06': ['\u7262\u5c06 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7262\u5c06 \u8bc4\u8bba', '\u8fd9\u4e0b\u7262\u5c06'],
  '\u7262\u4f1f': ['\u7262\u4f1f \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7262\u4f1f \u8bc4\u8bba', '\u7262\u4f1f\u6765\u4e86'],
  '\u7262\u7956\u51b2\u4e4b': ['\u7262\u7956\u51b2\u4e4b \u6570\u5b66 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7262\u7956\u51b2\u4e4b \u8bc4\u8bba', '\u7956\u51b2\u4e4b \u70ed\u8bc4'],
  '\u8001\u868c\u542b\u73e0': ['\u8001\u868c\u542b\u73e0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8001\u868c\u542b\u73e0 \u8bc4\u8bba', '\u8001\u868c\u542b\u73e0\u4e86'],
  '\u8001\u5904\u7537': ['\u8001\u5904\u7537 \u604b\u7231 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8001\u5904\u7537 \u8bc4\u8bba', '\u4e00\u770b\u5c31\u662f\u8001\u5904\u7537'],
  '\u8001\u9ad8\u9ad8\u9b54\u52a8\u7684': ['\u8001\u9ad8\u9ad8\u9b54\u52a8\u7684 \u8001\u9ad8\u4e0e\u5c0f\u8309 \u8bc4\u8bba', '\u8001\u9ad8\u9ad8\u9b54\u52a8\u7684 \u8bc4\u8bba', '\u8001\u9ad8 \u9ad8\u9b54\u52a8'],
  '\u8001\u5e08\u56fe\u7247\u53ef\u4ee5\u62ff\u5417': ['\u8001\u5e08\u56fe\u7247\u53ef\u4ee5\u62ff\u5417 \u6c42\u56fe \u8bc4\u8bba\u533a', '\u8001\u5e08\u56fe\u7247\u53ef\u4ee5\u62ff\u5417 \u8bc4\u8bba', '\u8001\u5e08\u56fe\u7247\u80fd\u62ff\u5417'],
  '\u8001\u5934\u662f\u8fd9\u6837\u7684': ['\u8001\u5934\u662f\u8fd9\u6837\u7684 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8001\u5934\u662f\u8fd9\u6837\u7684 \u8bc4\u8bba', '\u8001\u5934\u90fd\u662f\u8fd9\u6837'],
  '\u8001ass': ['\u8001ass \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8001ass \u8bc4\u8bba', '\u8001ass\u6765\u4e86'],
  '\u8001sp': ['\u8001sp \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8001sp \u8bc4\u8bba', '\u8001sp\u6765\u4e86'],
  '\u51b7\u677f\u51f3': ['\u5750\u51b7\u677f\u51f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u51b7\u677f\u51f3 \u8bc4\u8bba', '\u5750\u4e0a\u51b7\u677f\u51f3'],
  '\u674e\u59d0\u4e07\u5c81': ['\u674e\u59d0\u4e07\u5c81 \u56de\u590d \u70ed\u8bc4', '\u674e\u59d0\u4e07\u5c81 \u8bc4\u8bba', '\u674e\u59d0\u4e07\u5c81\u4e86'],
  '\u674e\u6c0f\u7236\u5b50': ['\u674e\u6c0f\u7236\u5b50 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u674e\u6c0f\u7236\u5b50 \u8bc4\u8bba', '\u674e\u6c0f\u7236\u5b50\u6765\u4e86'],
  '\u91cc\u9762\u5168\u662f\u9502\u7535\u6c60': ['\u91cc\u9762\u5168\u662f\u9502\u7535\u6c60 \u7535\u52a8\u8f66 \u8bc4\u8bba', '\u91cc\u9762\u5168\u662f\u9502\u7535\u6c60 \u8bc4\u8bba', '\u5168\u662f\u9502\u7535\u6c60'],
  '\u5386\u53f2\u7b2c\u4e00\u63a7\u80c3': ['\u5386\u53f2\u7b2c\u4e00\u63a7\u80c3 \u996e\u98df \u8bc4\u8bba\u533a', '\u5386\u53f2\u7b2c\u4e00\u63a7\u80c3 \u8bc4\u8bba', '\u63a7\u80c3\u5386\u53f2\u7b2c\u4e00'],
  '\u4fe9\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86\u5c5e\u4e8e\u662f': ['\u4fe9\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86\u5c5e\u4e8e\u662f \u4ea4\u901a \u8bc4\u8bba', '\u4fe9\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86\u5c5e\u4e8e\u662f \u8bc4\u8bba', '\u5783\u573e\u8f66\u9760\u4e00\u8d77\u4e86'],
  '\u8054\u52a8\u676f': ['\u8054\u52a8\u676f \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8054\u52a8\u676f \u8bc4\u8bba', '\u8fd9\u6ce2\u8054\u52a8\u676f'],
  '\u604b\u4e11\u7656': ['\u604b\u4e11\u7656 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u604b\u4e11\u7656 \u8bc4\u8bba', '\u4f60\u6709\u604b\u4e11\u7656'],
  '\u826f\u4f5c\u65e0\u4eba': ['\u826f\u4f5c\u65e0\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u826f\u4f5c\u65e0\u4eba \u8bc4\u8bba', '\u826f\u4f5c\u65e0\u4eba\u77e5'],
  '\u4e24\u516c\u6bcd': ['\u4e24\u516c\u6bcd \u60c5\u4fa3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e24\u516c\u6bcd \u8bc4\u8bba', '\u8fd9\u4e24\u516c\u6bcd'],
  '\u4e24\u60c5\u76f8\u60a6': ['\u4e24\u60c5\u76f8\u60a6 \u56de\u590d \u70ed\u8bc4', '\u4e24\u60c5\u76f8\u60a6 \u8bc4\u8bba', '\u4ed6\u4eec\u4e24\u60c5\u76f8\u60a6'],
  '\u4e24\u5143\u5e97': ['\u4e24\u5143\u5e97 \u5ec9\u4ef7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e24\u5143\u5e97 \u8bc4\u8bba', '\u50cf\u4e24\u5143\u5e97'],
  '\u91cf\u5b50\u76d1\u63a7\u6444\u50cf\u5934': ['\u91cf\u5b50\u76d1\u63a7\u6444\u50cf\u5934 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u91cf\u5b50\u76d1\u63a7\u6444\u50cf\u5934 \u8bc4\u8bba', '\u76d1\u63a7\u6444\u50cf\u5934 \u91cf\u5b50'],
  '\u96f6\u63d0\u5347': ['\u96f6\u63d0\u5347 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u96f6\u63d0\u5347 \u8bc4\u8bba', '\u4e00\u70b9\u63d0\u5347\u6ca1\u6709'],
  '\u6d41\u6c13\u53ea\u662f\u6d17\u767d\u4e86': ['\u6d41\u6c13\u53ea\u662f\u6d17\u767d\u4e86 \u5267\u60c5 \u8bc4\u8bba', '\u6d41\u6c13\u53ea\u662f\u6d17\u767d\u4e86 \u8bc4\u8bba', '\u6d17\u767d\u6d41\u6c13'],
  '\u516d\u6247\u95e8': ['\u516d\u6247\u95e8 \u6b66\u4fa0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u516d\u6247\u95e8 \u8bc4\u8bba', '\u516d\u6247\u95e8\u6765\u4e86'],
  '\u905b\u9e1f\u54e5': ['\u905b\u9e1f\u54e5 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u905b\u9e1f\u54e5 \u8bc4\u8bba', '\u905b\u9e1f\u54e5\u6765\u4e86'],
  '\u9f99\u764c': ['\u9f99\u764c \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9f99\u764c \u8bc4\u8bba', '\u9f99\u764c\u7c89'],
  '\u8def\u4eba\u76d8': ['\u8def\u4eba\u76d8 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8def\u4eba\u76d8 \u8bc4\u8bba', '\u6ca1\u6709\u8def\u4eba\u76d8'],
  '\u8def\u8f6c\u9ed1': ['\u8def\u8f6c\u9ed1 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8def\u8f6c\u9ed1 \u8bc4\u8bba', '\u771f\u7684\u8def\u8f6c\u9ed1'],
  '\u9a74\u5e08': ['\u9a74\u5e08 \u5f8b\u5e08 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9a74\u5e08 \u8bc4\u8bba', '\u5f8b\u5e08\u53d8\u9a74\u5e08'],
  '\u7eff\u6f14': ['\u7eff\u6f14 \u6f14\u5531\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7eff\u6f14 \u8bc4\u8bba', '\u6f14\u5531\u4f1a\u7eff\u6f14'],
  '\u8f6e\u6905\u8f74': ['\u8f6e\u6905\u8f74 \u952e\u76d8 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8f6e\u6905\u8f74 \u8bc4\u8bba', '\u952e\u76d8\u8f6e\u6905\u8f74'],
  '\u7f57\u8f91\u515c\u5e95': ['\u7f57\u8f91\u515c\u5e95 \u4e09\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7f57\u8f91\u515c\u5e95 \u8bc4\u8bba', '\u4e09\u4f53 \u7f57\u8f91\u515c\u5e95'],
  '\u7f57\u795e\u4f1f\u5927': ['\u7f57\u795e\u4f1f\u5927 \u4e09\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7f57\u795e\u4f1f\u5927 \u8bc4\u8bba', '\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00'],
  '\u903b\u8f91\u9b3c\u624d': ['\u903b\u8f91\u9b3c\u624d \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u903b\u8f91\u9b3c\u624d \u8bc4\u8bba', '\u4f60\u53ef\u771f\u662f\u903b\u8f91\u9b3c\u624d'],
  '\u9ebble\u4f6c': ['\u9ebble\u4f6c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9ebble\u4f6c \u8bc4\u8bba', '\u9ebble\u4f6c\u6765\u4e86'],
  '\u9a82\u4eba\u4ed9\u4eba': ['\u9a82\u4eba\u4ed9\u4eba \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9a82\u4eba\u4ed9\u4eba \u8bc4\u8bba', '\u771f\u662f\u9a82\u4eba\u4ed9\u4eba'],
  '\u8fc8\u5361\u8d70\u4e86\u4e4b\u540e': ['\u8fc8\u5361\u8d70\u4e86\u4e4b\u540e \u8352\u91ce\u5927\u9556\u5ba2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fc8\u5361\u8d70\u4e86\u4e4b\u540e \u8bc4\u8bba', '\u8352\u91ce\u5927\u9556\u5ba2 \u8fc8\u5361\u8d70\u4e86\u4e4b\u540e'],
  '\u5356\u7968': ['\u5356\u7968 \u6f14\u5531\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5356\u7968 \u8bc4\u8bba', '\u8fd9\u7968\u5356\u7684'],
  '\u5e3d\u5b50\u53d4': ['\u5e3d\u5b50\u53d4 \u8b66\u5bdf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e3d\u5b50\u53d4 \u8bc4\u8bba', '\u5e3d\u5b50\u53d4\u6765\u4e86'],
  '\u5e3d\u5b50\u53d4\u53d4': ['\u5e3d\u5b50\u53d4\u53d4 \u8b66\u5bdf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e3d\u5b50\u53d4\u53d4 \u8bc4\u8bba', '\u5e3d\u5b50\u53d4\u53d4\u6765\u4e86'],
  '\u6ca1\u4eba\u5417': ['\u6ca1\u4eba\u5417 \u76f4\u64ad \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u4eba\u5417 \u8bc4\u8bba', '\u76f4\u64ad\u95f4\u6ca1\u4eba\u5417'],
  '\u6ca1\u4e00\u70b9\u5e38\u8bc6': ['\u6ca1\u4e00\u70b9\u5e38\u8bc6 \u79d1\u666e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u4e00\u70b9\u5e38\u8bc6 \u8bc4\u8bba', '\u8fd9\u4e5f\u592a\u6ca1\u5e38\u8bc6\u4e86'],
  '\u6ca1\u6709\u6587\u5316': ['\u6ca1\u6709\u6587\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u6709\u6587\u5316 \u8bc4\u8bba', '\u6ca1\u6587\u5316\u771f\u53ef\u6015'],
  '\u6ca1\u6709\u4e00\u4e2a\u9732\u8138': ['\u6ca1\u6709\u4e00\u4e2a\u9732\u8138 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u6709\u4e00\u4e2a\u9732\u8138 \u8bc4\u8bba', '\u4e00\u4e2a\u9732\u8138\u7684\u90fd\u6ca1\u6709'],
  '\u6ca1\u6709\u4e00\u4e2a\u4eba\u771f\u6b63\u73a9\u5230\u4e86': ['\u6ca1\u6709\u4e00\u4e2a\u4eba\u771f\u6b63\u73a9\u5230\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u6709\u4e00\u4e2a\u4eba\u771f\u6b63\u73a9\u5230\u4e86 \u8bc4\u8bba', '\u771f\u6b63\u73a9\u5230\u4e86'],
  '\u6ca1\u6709\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b': ['\u6ca1\u6709\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u6709\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b \u8bc4\u8bba', '\u4e00\u4e2a\u6709\u72ec\u7acb\u80fd\u529b\u7684\u90fd\u6ca1\u6709'],
  '\u6ca1\u6709\u4e00\u4e2aup\u6562\u8bb2': ['\u6ca1\u6709\u4e00\u4e2aup\u6562\u8bb2 \u4e89\u8bae \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6ca1\u6709\u4e00\u4e2aUP\u6562\u8bb2 \u8bc4\u8bba', '\u6ca1\u6709up\u6562\u8bb2'],
  '\u7164\u6c14\u6cc4\u9732': ['\u7164\u6c14\u6cc4\u9732 \u5b89\u5168\u4e8b\u6545 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7164\u6c14\u6cc4\u9732 \u8bc4\u8bba', '\u662f\u4e0d\u662f\u7164\u6c14\u6cc4\u9732'],
  '\u7f8e\u6b66\u5e1d': ['\u7f8e\u6b66\u5e1d \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7f8e\u6b66\u5e1d \u8bc4\u8bba', '\u7f8e\u5e1d\u6b66\u88c5'],
  '\u7f8e\u54c9': ['\u7f8e\u54c9 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7f8e\u54c9 \u8bc4\u8bba', '\u7f8e\u54c9\u7f8e\u54c9'],
  '\u68a6\u7537': ['\u68a6\u7537 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u68a6\u7537 \u8bc4\u8bba', '\u68a6\u7537\u6765\u4e86'],
  '\u5999\u554a': ['\u5999\u554a \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5999\u554a \u8bc4\u8bba', '\u771f\u662f\u5999\u554a'],
  '\u660e\u660e\u5c31\u6709': ['\u660e\u660e\u5c31\u6709 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u660e\u660e\u5c31\u6709 \u8bc4\u8bba', '\u8fd9\u4e0d\u660e\u660e\u5c31\u6709'],
  '\u6a21\u7ec4': ['\u6a21\u7ec4 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6a21\u7ec4 \u8bc4\u8bba', '\u6e38\u620f\u6a21\u7ec4'],
  '\u9b54\u6014\u7c89\u4e1d': ['\u9b54\u6014\u7c89\u4e1d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9b54\u6014\u7c89\u4e1d \u8bc4\u8bba', '\u7c89\u4e1d\u592a\u9b54\u6014'],
  '\u9ed8\u5951\u5927\u8d5b': ['\u9ed8\u5951\u5927\u8d5b \u7efc\u827a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9ed8\u5951\u5927\u8d5b \u8bc4\u8bba', '\u8fd9\u6ce2\u9ed8\u5951\u5927\u8d5b'],
  '\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047': ['\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047 \u5185\u5a31 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047 \u8bc4\u8bba', '\u8fd9\u5c31\u662f\u67d0\u4eba\u5e94\u5f97\u7684\u5f85\u9047'],
  '\u54ea\u6839\u8471': ['\u54ea\u6839\u8471 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u54ea\u6839\u8471 \u8bc4\u8bba', '\u4f60\u7b97\u54ea\u6839\u8471'],
  '\u7537\u76d7\u5973\u5a3c': ['\u7537\u76d7\u5973\u5a3c \u5a31\u4e50\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7537\u76d7\u5973\u5a3c \u8bc4\u8bba', '\u53c8\u662f\u7537\u76d7\u5973\u5a3c'],
  '\u7537\u51dd\u5ba1\u7f8e': ['\u7537\u51dd\u5ba1\u7f8e \u6027\u522b\u8bae\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7537\u51dd\u5ba1\u7f8e \u8bc4\u8bba', '\u8fd9\u79cd\u7537\u51dd\u5ba1\u7f8e'],
  '\u5357\u6850': ['\u5357\u6850 \u4e8c\u6b21\u5143 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5357\u6850 \u8bc4\u8bba', '\u5357\u6850\u6765\u4e86'],
  '\u6320\u644a': ['\u6320\u644a \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6320\u644a \u8bc4\u8bba', '\u6320\u644a\u6765\u4e86'],
  '\u5185\u5a31\u7684\u5e95\u7ebf': ['\u5185\u5a31\u7684\u5e95\u7ebf \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5185\u5a31\u7684\u5e95\u7ebf \u8bc4\u8bba', '\u5185\u5a31\u5e95\u7ebf'],
  '\u5185\u5a31\u53ea\u6709\u8fea\u4e3d\u70ed\u5df4': ['\u5185\u5a31\u53ea\u6709\u8fea\u4e3d\u70ed\u5df4 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5185\u5a31\u53ea\u6709\u8fea\u4e3d\u70ed\u5df4 \u8bc4\u8bba', '\u5185\u5a31\u53ea\u6709\u70ed\u5df4'],
  '\u80fd\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86': ['\u80fd\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u80fd\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86 \u8bc4\u8bba', '\u4e00\u773c\u770b\u61c2\u53ef\u4ee5\u91cd\u5f00\u4e86'],
  '\u4f60\u4e0d\u5bf9\u52b2': ['\u4f60\u4e0d\u5bf9\u52b2 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u4e0d\u5bf9\u52b2 \u8bc4\u8bba', '\u4f60\u5f88\u4e0d\u5bf9\u52b2'],
  '\u4f60\u731c\u6211\u4e3a\u4ec0\u4e48\u4e0d\u7b11': ['\u4f60\u731c\u6211\u4e3a\u4ec0\u4e48\u4e0d\u7b11 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u731c\u6211\u4e3a\u4ec0\u4e48\u4e0d\u7b11 \u8bc4\u8bba', '\u4f60\u731c\u4e3a\u4ec0\u4e48\u4e0d\u7b11'],
  '\u4f60\u8d85\u7231': ['\u4f60\u8d85\u7231 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u8d85\u7231 \u8bc4\u8bba', '\u4f60\u771f\u7684\u8d85\u7231'],
  '\u4f60\u7684\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86': ['\u4f60\u7684\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u7684\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86 \u8bc4\u8bba', '\u8bf4\u6cd5\u592a\u7edd\u5bf9\u4e86'],
  '\u4f60\u597d\u6025': ['\u4f60\u597d\u6025 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u597d\u6025 \u8bc4\u8bba', '\u4f60\u600e\u4e48\u8fd9\u4e48\u6025'],
  '\u4f60\u597d\u6025\u554a': ['\u4f60\u597d\u6025\u554a \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u597d\u6025\u554a \u8bc4\u8bba', '\u4f60\u771f\u7684\u597d\u6025\u554a'],
  '\u4f60\u51e0\u5e74\u7ea7': ['\u4f60\u51e0\u5e74\u7ea7 \u5c0f\u5b66\u751f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u51e0\u5e74\u7ea7 \u8bc4\u8bba', '\u5c0f\u5b66\u751f\u51e0\u5e74\u7ea7'],
  '\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b': ['\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u4eec\u597d\u81ea\u4e3a\u4e4b \u8bc4\u8bba', '\u597d\u81ea\u4e3a\u4e4b\u5427'],
  '\u4f60\u8bf4\u7684\u6709\u9053\u7406': ['\u4f60\u8bf4\u7684\u6709\u9053\u7406 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u8bf4\u7684\u6709\u9053\u7406 \u8bc4\u8bba', '\u4f60\u8bf4\u7684\u786e\u5b9e\u6709\u9053\u7406'],
  '\u4f60\u7279me': ['\u4f60\u7279me \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u7279me \u8bc4\u8bba', '\u4f60\u7279\u4e48'],
  '\u4f60\u7ec6\u54c1': ['\u4f60\u7ec6\u54c1 \u61c2\u7684\u90fd\u61c2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u7ec6\u54c1 \u8bc4\u8bba', '\u4f60\u7ec6\u7ec6\u54c1'],
  '\u4f60\u6709\u836f\u554a': ['\u4f60\u6709\u836f\u554a \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f60\u6709\u836f\u554a \u8bc4\u8bba', '\u4f60\u662f\u4e0d\u662f\u6709\u836f'],
  '\u9006\u98ce\u5c40': ['\u9006\u98ce\u5c40 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9006\u98ce\u5c40 \u8bc4\u8bba', '\u8fd9\u628a\u9006\u98ce\u5c40'],
  '\u9006\u98ce\u8f93\u51fa': ['\u9006\u98ce\u8f93\u51fa \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9006\u98ce\u8f93\u51fa \u8bc4\u8bba', '\u9006\u98ce\u8fd8\u5728\u8f93\u51fa'],
  '\u9006\u5929\u5c0f\u9ed1\u5b50': ['\u9006\u5929\u5c0f\u9ed1\u5b50 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9006\u5929\u5c0f\u9ed1\u5b50 \u8bc4\u8bba', '\u5c0f\u9ed1\u5b50\u771f\u9006\u5929'],
  '\u5a18\u897f\u76ae': ['\u5a18\u897f\u76ae \u65b9\u8a00 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5a18\u897f\u76ae \u8bc4\u8bba', '\u4e00\u53e5\u5a18\u897f\u76ae'],
  '\u6d85\u69c3\u6253\u91ce': ['\u6d85\u69c3\u6253\u91ce \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d85\u69c3\u6253\u91ce \u8bc4\u8bba', '\u8fd9\u628a\u6d85\u69c3\u6253\u91ce'],
  '\u60a8\u914d\u5417': ['\u60a8\u914d\u5417 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u60a8\u914d\u5417 \u8bc4\u8bba', '\u4f60\u914d\u5417'],
  '\u519c\u6797\u535a\u4e3b': ['\u519c\u6797\u535a\u4e3b \u4e09\u519c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u519c\u6797\u535a\u4e3b \u8bc4\u8bba', '\u4e09\u519c\u535a\u4e3b'],
  '\u6d53\u7709\u5927\u773c\u7684\u4e5f\u53db\u53d8\u4e86': ['\u6d53\u7709\u5927\u773c\u7684\u4e5f\u53db\u53d8\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d53\u7709\u5927\u773c\u7684\u4e5f\u53db\u53d8\u4e86 \u8bc4\u8bba', '\u6d53\u7709\u5927\u773c\u4e5f\u53db\u53d8'],
  '\u6012\u4e86\u4e00\u4e0b': ['\u6012\u4e86\u4e00\u4e0b \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6012\u4e86\u4e00\u4e0b \u8bc4\u8bba', '\u7a81\u7136\u6012\u4e86\u4e00\u4e0b'],
  '\u6b27\u9752\u54c8\u62c9\u5c11': ['\u6b27\u9752\u54c8\u62c9\u5c11 \u4fc4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6b27\u9752\u54c8\u62c9\u5c11 \u8bc4\u8bba', '\u54c8\u62c9\u5c11 \u4fc4\u8bed'],
  '\u6392\u6c14\u53e3\u5439\u51fa\u6765\u5168\u662f\u81ed\u6c14': ['\u6392\u6c14\u53e3\u5439\u51fa\u6765\u5168\u662f\u81ed\u6c14 \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6392\u6c14\u53e3\u5439\u51fa\u6765\u5168\u662f\u81ed\u6c14 \u8bc4\u8bba', '\u6392\u6c14\u53e3\u5168\u662f\u81ed\u6c14'],
  '\u5224\u51b3\u4e66': ['\u5224\u51b3\u4e66 \u6cd5\u5f8b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5224\u51b3\u4e66 \u8bc4\u8bba', '\u6cd5\u9662\u5224\u51b3\u4e66'],
  '\u80d6\u732b': ['\u80d6\u732b \u793e\u4f1a\u4e8b\u4ef6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u80d6\u732b \u8bc4\u8bba', '\u80d6\u732b\u4e8b\u4ef6'],
  '\u55b7\u6c14\u80cc\u5305\u6545\u969c': ['\u55b7\u6c14\u80cc\u5305\u6545\u969c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u55b7\u6c14\u80cc\u5305\u6545\u969c \u8bc4\u8bba', '\u55b7\u6c14\u80cc\u5305\u51fa\u6545\u969c'],
  '\u9a97\u4eba\u8fdb\u6765': ['\u9a97\u4eba\u8fdb\u6765 \u6807\u9898\u515a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9a97\u4eba\u8fdb\u6765 \u8bc4\u8bba', '\u6807\u9898\u515a\u9a97\u4eba\u8fdb\u6765'],
  '\u8d2b\u7a77\u62ef\u6551\u4e86\u4ed6': ['\u8d2b\u7a77\u62ef\u6551\u4e86\u4ed6 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d2b\u7a77\u62ef\u6551\u4e86\u4ed6 \u8bc4\u8bba', '\u8d2b\u7a77\u62ef\u6551\u4e86\u6211'],
  '\u5e73\u6574\u5668': ['\u5e73\u6574\u5668 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e73\u6574\u5668 \u8bc4\u8bba', '\u5730\u5f62\u5e73\u6574\u5668'],
  '\u8bc4\u8bba\u533a\u4e0d\u6562\u60f3': ['\u8bc4\u8bba\u533a\u4e0d\u6562\u60f3 \u56de\u590d \u70ed\u8bc4', '\u8bc4\u8bba\u533a\u4e0d\u6562\u60f3 \u8bc4\u8bba', '\u4e0d\u6562\u60f3\u8bc4\u8bba\u533a'],
  '\u8bc4\u8bba\u533a\u6218\u795e': ['\u8bc4\u8bba\u533a\u6218\u795e \u56de\u590d \u70ed\u8bc4', '\u8bc4\u8bba\u533a\u6218\u795e \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u91cc\u7684\u6218\u795e'],
  '\u8bc4\u8bba\u738b\u5427': ['\u8bc4\u8bba\u738b\u5427 \u8d34\u5427 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8bc4\u8bba\u738b\u5427 \u8bc4\u8bba', '\u8bc4\u8bba\u738b\u5427\u6765\u4e86'],
  '\u6d66\u50cf\u5973': ['\u6d66\u50cf\u5973 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d66\u50cf\u5973 \u8bc4\u8bba', '\u53c8\u662f\u6d66\u50cf\u5973'],
  '\u5343\u5e74\u662f\u54ee\u5929\u72ac': ['\u5343\u5e74\u662f\u54ee\u5929\u72ac \u4e8c\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5343\u5e74\u662f\u54ee\u5929\u72ac \u8bc4\u8bba', '\u54ee\u5929\u72ac\u5343\u5e74'],
  '\u524d\u9762\u8bf4\u91cd\u4e86': ['\u524d\u9762\u8bf4\u91cd\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u524d\u9762\u8bf4\u91cd\u4e86 \u8bc4\u8bba', '\u521a\u624d\u524d\u9762\u8bf4\u91cd\u4e86'],
  '\u4e7e\u9686\u8001\u513f': ['\u4e7e\u9686\u8001\u513f \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e7e\u9686\u8001\u513f \u8bc4\u8bba', '\u4e7e\u9686\u8001\u513f\u6765\u4e86'],
  '\u743c\u5965\u65af\u5361\u5956': ['\u743c\u5965\u65af\u5361\u5956 \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u743c\u5965\u65af\u5361\u5956 \u8bc4\u8bba', '\u743c\u5965\u65af\u5361'],
  '\u90b1\u83b9\u83b9plus\u7248': ['\u90b1\u83b9\u83b9plus\u7248 \u6b22\u4e50\u9882 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u90b1\u83b9\u83b9plus\u7248 \u8bc4\u8bba', '\u6b22\u4e50\u9882 \u90b1\u83b9\u83b9plus'],
  '\u5708\u5b50\u8d8a\u5927\u795e\u4eba\u8d8a\u591a': ['\u5708\u5b50\u8d8a\u5927\u795e\u4eba\u8d8a\u591a \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5708\u5b50\u8d8a\u5927\u795e\u4eba\u8d8a\u591a \u8bc4\u8bba', '\u5708\u5b50\u8d8a\u5927\u4ec0\u4e48\u4eba\u90fd\u6709'],
  '\u5168\u90fd\u8fd8\u5728': ['\u5168\u90fd\u8fd8\u5728 \u8001\u7c89 \u56de\u5fc6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u90fd\u8fd8\u5728 \u8bc4\u8bba', '\u4eba\u90fd\u8fd8\u5728'],
  '\u5168\u90fd\u662f\u5708\u94b1\u518d\u5708\u94b1': ['\u5168\u90fd\u662f\u5708\u94b1\u518d\u5708\u94b1 \u5546\u4e1a\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5708\u94b1\u518d\u5708\u94b1 \u8bc4\u8bba', '\u53c8\u662f\u5708\u94b1'],
  '\u5168\u607c': ['\u5168\u607c \u7834\u9632 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u607c \u8bc4\u8bba', '\u5168\u4f53\u7834\u9632'],
  '\u5168\u662f\u642c\u8fd0': ['\u5168\u662f\u642c\u8fd0 \u539f\u521b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u642c\u8fd0 \u8bc4\u8bba', '\u53c8\u662f\u642c\u8fd0'],
  '\u5168\u662f\u8fd4\u4fee\u8d27\u548c\u5e93\u5b58': ['\u5168\u662f\u8fd4\u4fee\u8d27\u548c\u5e93\u5b58 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd4\u4fee\u8d27 \u5e93\u5b58 \u8bc4\u8bba', '\u5168\u662f\u5e93\u5b58\u8fd4\u4fee'],
  '\u5168\u662f\u7c89\u4e1d': ['\u5168\u662f\u7c89\u4e1d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u7c89\u4e1d \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u5168\u662f\u7c89\u4e1d'],
  '\u5168\u662f\u5047\u7684': ['\u5168\u662f\u5047\u7684 \u8f9f\u8c23 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u5047\u7684 \u8bc4\u8bba', '\u8fd9\u5168\u662f\u5047\u7684'],
  '\u5168\u662f\u5938\u7684': ['\u5168\u662f\u5938\u7684 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u5938\u7684 \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u5168\u662f\u5938\u7684'],
  '\u5168\u662f\u4eba\u60c5\u4e16\u6545': ['\u5168\u662f\u4eba\u60c5\u4e16\u6545 \u804c\u573a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u4eba\u60c5\u4e16\u6545 \u8bc4\u8bba', '\u8fd9\u5c31\u662f\u4eba\u60c5\u4e16\u6545'],
  '\u5168\u662f\u4e09\u89d2\u65a9': ['\u5168\u662f\u4e09\u89d2\u65a9 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e09\u89d2\u65a9 \u8bc4\u8bba', '\u53c8\u662f\u4e09\u89d2\u65a9'],
  '\u5168\u662f\u6570\u636e\u8bbe\u5b9a\u5bf9\u6bd4': ['\u5168\u662f\u6570\u636e\u8bbe\u5b9a\u5bf9\u6bd4 \u6218\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6570\u636e\u8bbe\u5b9a\u5bf9\u6bd4 \u8bc4\u8bba', '\u8bbe\u5b9a\u5bf9\u6bd4'],
  '\u5168\u662f\u6211\u4eec\u9a6c\u54e5': ['\u5168\u662f\u6211\u4eec\u9a6c\u54e5 \u9a6c\u4fdd\u56fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u4eec\u9a6c\u54e5 \u8bc4\u8bba', '\u9a6c\u54e5\u6765\u4e86'],
  '\u5168\u662f\u65b0\u53f7': ['\u5168\u662f\u65b0\u53f7 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u65b0\u53f7 \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u65b0\u53f7'],
  '\u5168\u662f\u946b\u4ed8': ['\u5168\u662f\u946b\u4ed8 \u652f\u4ed8 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u946b\u4ed8 \u8bc4\u8bba\u533a', '\u946b\u4ed8\u662f\u4ec0\u4e48'],
  '\u5168\u662f\u7384\u5b66': ['\u5168\u662f\u7384\u5b66 \u6d4b\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u7384\u5b66 \u8bc4\u8bba', '\u8fd9\u4e5f\u592a\u7384\u5b66'],
  '\u5168\u662f\u5e94\u8bd5': ['\u5168\u662f\u5e94\u8bd5 \u6559\u80b2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u662f\u5e94\u8bd5 \u8bc4\u8bba', '\u5e94\u8bd5\u6559\u80b2'],
  '\u5168\u662f\u5e7c\u6001\u5ba1\u7f8e': ['\u5168\u662f\u5e7c\u6001\u5ba1\u7f8e \u5ba1\u7f8e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e7c\u6001\u5ba1\u7f8e \u8bc4\u8bba', '\u73b0\u5728\u5168\u662f\u5e7c\u6001\u5ba1\u7f8e'],
  '\u5168\u635f\u97f3\u54c1\u8d28': ['\u5168\u635f\u97f3\u54c1\u8d28 \u97f3\u8d28 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u635f\u97f3\u8d28 \u8bc4\u8bba', '\u97f3\u8d28\u5168\u635f'],
  '\u5168\u7cfb\u5217\u901a\u75c5': ['\u5168\u7cfb\u5217\u901a\u75c5 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u7cfb\u5217\u901a\u75c5 \u8bc4\u8bba', '\u8fd9\u7cfb\u5217\u901a\u75c5'],
  '\u5168\u4ed9\u4eba': ['\u5168\u4ed9\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u4ed9\u4eba \u8bc4\u8bba', '\u8fd9\u5c40\u5168\u4ed9\u4eba'],
  '\u5168\u5458be': ['\u5168\u5458be \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5168\u5458be \u8bc4\u8bba', '\u5168\u5458BE'],
  '\u5168\u4e2d\u56fd\u4eba\u90fd\u65e0\u6cd5\u53cd\u9a73': ['\u5168\u4e2d\u56fd\u4eba\u90fd\u65e0\u6cd5\u53cd\u9a73 \u6c11\u65cf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u6cd5\u53cd\u9a73 \u8bc4\u8bba', '\u4e2d\u56fd\u4eba\u65e0\u6cd5\u53cd\u9a73'],
  '\u786e\u5b9e\u5982\u6b64': ['\u786e\u5b9e\u5982\u6b64 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u786e\u5b9e\u5982\u6b64 \u8bc4\u8bba', '\u786e\u5b9e\u662f\u8fd9\u6837'],
  '\u8ba9\u4e09\u8ffd\u56db': ['\u8ba9\u4e09\u8ffd\u56db \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8ba9\u4e09\u8ffd\u56db \u8bc4\u8bba', '\u8ba9\u4e09\u8ffd\u56db\u7ffb\u76d8'],
  '\u4eba\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c': ['\u4eba\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c \u9053\u5fb7\u6279\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eba\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c \u8bc4\u8bba', '\u4e0d\u8981\u8138\u5929\u4e0b\u65e0\u654c'],
  '\u4eba\u592b\u611f': ['\u4eba\u592b\u611f \u5f71\u89c6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eba\u592b\u611f \u8bc4\u8bba', '\u5f88\u6709\u4eba\u592b\u611f'],
  '\u4eba\u5747\u8fc8\u5df4\u8d6b': ['\u4eba\u5747\u8fc8\u5df4\u8d6b \u70ab\u5bcc \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eba\u5747\u8fc8\u5df4\u8d6b \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u4eba\u5747\u8fc8\u5df4\u8d6b'],
  '\u4eba\u8089tas': ['\u4eba\u8089tas \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eba\u8089tas \u8bc4\u8bba', '\u4eba\u8089TAS'],
  '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11': ['\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4eba\u5728\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11 \u8bc4\u8bba', '\u65e0\u8bed\u7684\u65f6\u5019\u771f\u7684\u4f1a\u7b11'],
  '\u8ba4\u77e5\u7684\u53c2\u5dee': ['\u8ba4\u77e5\u7684\u53c2\u5dee \u8ba4\u77e5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8ba4\u77e5\u7684\u53c2\u5dee \u8bc4\u8bba', '\u8ba4\u77e5\u5dee\u8ddd'],
  '\u65e5\u672c\u7701': ['\u65e5\u672c\u7701 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e5\u672c\u7701 \u8bc4\u8bba', '\u65e5\u672c\u7701\u6765\u4e86'],
  '\u65e5\u884c\u4e00\u9274': ['\u65e5\u884c\u4e00\u9274 \u9274\u8d4f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e5\u884c\u4e00\u9274 \u8bc4\u8bba', '\u6bcf\u65e5\u4e00\u9274'],
  '\u8089\u5c0f\u4e11': ['\u8089\u5c0f\u4e11 \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8089\u5c0f\u4e11 \u8bc4\u8bba', '\u771f\u8089\u5c0f\u4e11'],
  '\u5982\u98df\u5219\u5410': ['\u5982\u98df\u5219\u5410 \u70c2\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5982\u98df\u5219\u5410 \u8bc4\u8bba', '\u5982\u98df\u5219\u5455'],
  '\u5982\u53f2\u6076\u7269': ['\u5982\u53f2\u6076\u7269 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5982\u53f2\u6076\u7269 \u8bc4\u8bba', '\u5982\u5c4e\u6076\u7269'],
  '\u4e73\u5f02\u73af': ['\u4e73\u5f02\u73af \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e73\u5f02\u73af \u8bc4\u8bba', '\u539f\u795e\u4e73\u5f02\u73af'],
  '\u8f6f\u811a\u8bd7\u4eba': ['\u8f6f\u811a\u8bd7\u4eba \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8f6f\u811a\u8bd7\u4eba \u8bc4\u8bba', '\u8f6f\u811a\u867e\u8bd7\u4eba'],
  '\u585e\u6bd2': ['\u585e\u6bd2 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u585e\u6bd2 \u8bc4\u8bba', '\u5f80\u91cc\u585e\u6bd2'],
  '\u8d5b\u535agirls': ['\u8d5b\u535agirls \u8d5b\u535a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d5b\u535agirls \u8bc4\u8bba', '\u8d5b\u535a\u5973\u5b69'],
  '\u8d5b\u8ba1': ['\u8d5b\u8ba1 \u8d5b\u4e8b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d5b\u8ba1 \u8bc4\u8bba', '\u6bd4\u8d5b\u8d5b\u8ba1'],
  '\u8d5b\u5b63\u86cb': ['\u8d5b\u5b63\u86cb \u8d5b\u5b63 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d5b\u5b63\u86cb \u8bc4\u8bba', '\u8d5b\u5b63\u5f69\u86cb'],
  '\u4e09\u89c2\u8b66\u5bdf': ['\u4e09\u89c2\u8b66\u5bdf \u4ef7\u503c\u89c2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e09\u89c2\u8b66\u5bdf \u8bc4\u8bba', '\u8bc4\u8bba\u533a\u4e09\u89c2\u8b66\u5bdf'],
  '\u4e09\u548c\u5927\u795e': ['\u4e09\u548c\u5927\u795e \u793e\u4f1a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e09\u548c\u5927\u795e \u8bc4\u8bba', '\u6df1\u5733\u4e09\u548c\u5927\u795e'],
  '\u4e09\u8054': ['\u4e09\u8054 \u70b9\u8d5e\u6295\u5e01\u6536\u85cf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e09\u8054 \u8bc4\u8bba', '\u4e00\u952e\u4e09\u8054'],
  '\u4e09\u5e74\u5c31\u8d70\u4e86': ['\u4e09\u5e74\u5c31\u8d70\u4e86 \u52b3\u52a8\u6cd5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e09\u5e74\u5c31\u8d70\u4e86 \u8bc4\u8bba', '\u5e72\u4e09\u5e74\u5c31\u8d70\u4e86'],
  '\u9a9a\u64cd': ['\u9a9a\u64cd \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9a9a\u64cd \u8bc4\u8bba', '\u8fd9\u6ce2\u9a9a\u64cd'],
  '\u9a9a\u64cd\u4f5c': ['\u9a9a\u64cd\u4f5c \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9a9a\u64cd\u4f5c \u8bc4\u8bba', '\u8fd9\u6ce2\u9a9a\u64cd\u4f5c'],
  '\u626b\u96f7\u9886\u57df\u5927\u795e': ['\u626b\u96f7\u9886\u57df\u5927\u795e \u626b\u96f7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u626b\u96f7\u9886\u57df\u5927\u795e \u8bc4\u8bba', '\u626b\u96f7\u5927\u795e'],
  '\u5239\u8f66\u70eb\u811a': ['\u5239\u8f66\u70eb\u811a \u6c7d\u8f66 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5239\u8f66\u70eb\u811a \u8bc4\u8bba', '\u6cb9\u95e8\u5f53\u5239\u8f66'],
  '\u5565\u7bee\u5b50': ['\u5565\u7bee\u5b50 \u4e1c\u5317\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5565\u7bee\u5b50 \u8bc4\u8bba', '\u8fd9\u662f\u5565\u7bee\u5b50'],
  '\u5c71\u5730\u4f6c': ['\u5c71\u5730\u4f6c \u9a91\u884c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c71\u5730\u4f6c \u8bc4\u8bba', '\u5c71\u5730\u8f66\u4f6c'],
  '\u5220\u4e86\u8ba9\u6211\u53d1': ['\u5220\u4e86\u8ba9\u6211\u53d1 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5220\u4e86\u8ba9\u6211\u53d1 \u8bc4\u8bba', '\u4f60\u5220\u4e86\u8ba9\u6211\u53d1'],
  '\u4e0a\u5927\u53f7\u8bf4\u8bdd': ['\u4e0a\u5927\u53f7\u8bf4\u8bdd \u5c0f\u53f7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e0a\u5927\u53f7\u8bf4\u8bdd \u8bc4\u8bba', '\u5f00\u5927\u53f7\u8bf4\u8bdd'],
  '\u5c04\u5fc5\u7a00': ['\u5c04\u5fc5\u7a00 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c04\u5fc5\u7a00 \u8bc4\u8bba', '\u5c4e\u5fc5\u7a00'],
  '\u8c01tm\u53d1\u4f60\u5de5\u8d44': ['\u8c01tm\u53d1\u4f60\u5de5\u8d44 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8c01tm\u53d1\u4f60\u5de5\u8d44 \u8bc4\u8bba', '\u8c01\u53d1\u4f60\u5de5\u8d44'],
  '\u8eab\u8fb9\u5168\u662f\u6367\u7684': ['\u8eab\u8fb9\u5168\u662f\u6367\u7684 \u63a7\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8eab\u8fb9\u5168\u662f\u6367\u7684 \u8bc4\u8bba', '\u8eab\u8fb9\u90fd\u662f\u6367\u7684'],
  '\u795e\u91d1\u8282\u594f': ['\u795e\u91d1\u8282\u594f \u8282\u594f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u795e\u91d1\u8282\u594f \u8bc4\u8bba', '\u795e\u7ecf\u8282\u594f'],
  '\u795e\u79d8\u7684\u5927\u624b': ['\u795e\u79d8\u7684\u5927\u624b \u8d44\u672c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u795e\u79d8\u7684\u5927\u624b \u8bc4\u8bba', '\u80cc\u540e\u795e\u79d8\u5927\u624b'],
  '\u795e\u4ed9\u4e0b\u51e1': ['\u795e\u4ed9\u4e0b\u51e1 \u5938\u5f20 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u795e\u4ed9\u4e0b\u51e1 \u8bc4\u8bba', '\u771f\u662f\u795e\u4ed9\u4e0b\u51e1'],
  '\u77f3\u9524': ['\u77f3\u9524 \u8bc1\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u77f3\u9524 \u8bc4\u8bba', '\u5b9e\u9524\u8bc1\u636e'],
  '\u8bc6\u6761\u649a': ['\u8bc6\u6761\u649a \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8bc6\u6761\u649a \u8bc4\u8bba', '\u4f60\u8bc6\u6761\u649a'],
  '\u8bc6\u6761\u94c1': ['\u8bc6\u6761\u94c1 \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8bc6\u6761\u94c1 \u8bc4\u8bba', '\u4f60\u8bc6\u6761\u94c1'],
  '\u8bc6\u6761\u94c1\u54a9': ['\u8bc6\u6761\u94c1\u54a9 \u7ca4\u8bed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8bc6\u6761\u94c1\u54a9 \u8bc4\u8bba', '\u4f60\u8bc6\u6761\u94c1\u54a9'],
  '\u4e8b\u540e\u8865\u62cd\u7279\u5199': ['\u4e8b\u540e\u8865\u62cd\u7279\u5199 \u6446\u62cd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e8b\u540e\u8865\u62cd\u7279\u5199 \u8bc4\u8bba', '\u8865\u62cd\u7279\u5199'],
  '\u662f\u4eba\u662f\u9b3c\u90fd\u5728\u79c0': ['\u662f\u4eba\u662f\u9b3c\u90fd\u5728\u79c0 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u662f\u4eba\u662f\u9b3c\u90fd\u5728\u79c0 \u8bc4\u8bba', '\u90fd\u5728\u79c0'],
  '\u624b\u956f': ['\u624b\u956f \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u624b\u956f \u8bc4\u8bba', '\u7535\u5b50\u624b\u956f'],
  '\u53d7\u6559\u4e86': ['\u53d7\u6559\u4e86 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53d7\u6559\u4e86 \u8bc4\u8bba', '\u771f\u662f\u53d7\u6559\u4e86'],
  '\u4e66\u65e0\u7838': ['\u4e66\u65e0\u7838 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e66\u65e0\u7838 \u8bc4\u8bba', '\u6b8a\u4e0d\u77e5'],
  '\u4e66\u65e0\u7838\u61c2': ['\u4e66\u65e0\u7838\u61c2 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e66\u65e0\u7838\u61c2 \u8bc4\u8bba', '\u6b8a\u4e0d\u77e5\u61c2'],
  '\u8700\u9ecd': ['\u8700\u9ecd \u53d4\u53d4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8700\u9ecd \u8bc4\u8bba', '\u8b66\u5bdf\u8700\u9ecd'],
  '\u5237\u597d\u611f': ['\u5237\u597d\u611f \u4eba\u8bbe \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5237\u597d\u611f \u8bc4\u8bba', '\u5237\u8def\u4eba\u597d\u611f'],
  '\u5237\u9898\u5bb6': ['\u5237\u9898\u5bb6 \u6559\u80b2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5237\u9898\u5bb6 \u8bc4\u8bba', '\u5c0f\u9547\u505a\u9898\u5bb6'],
  '\u53cc\u8d62\u4e86': ['\u53cc\u8d62\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53cc\u8d62\u4e86 \u8bc4\u8bba', '\u8d62\u4e24\u6b21'],
  '\u53f8\u9a6c\u8138': ['\u53f8\u9a6c\u8138 \u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53f8\u9a6c\u8138 \u8bc4\u8bba', '\u6446\u4e2a\u53f8\u9a6c\u8138'],
  '\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0': ['\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0 \u8bc4\u8bba', '\u8fd9\u5c31\u662f\u7d20\u8d28\u6700\u9ad8\u7684\u5e73\u53f0'],
  '\u849c\u8304\u8111\u888b': ['\u849c\u8304\u8111\u888b \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u849c\u8304\u8111\u888b \u8bc4\u8bba', '\u9178\u9e21\u8111\u888b'],
  '\u849c\u8304\u8111\u74dc': ['\u849c\u8304\u8111\u74dc \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u849c\u8304\u8111\u74dc \u8bc4\u8bba', '\u9178\u9e21\u8111\u74dc'],
  '\u5c81\u6708\u795e\u5077': ['\u5c81\u6708\u795e\u5077 \u8001\u4e86 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c81\u6708\u795e\u5077 \u8bc4\u8bba', '\u88ab\u5c81\u6708\u795e\u5077\u5077\u8d70'],
  '\u788e\u4e09\u89c2': ['\u788e\u4e09\u89c2 \u4e09\u89c2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u788e\u4e09\u89c2 \u8bc4\u8bba', '\u770b\u5f97\u788e\u4e09\u89c2'],
  '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528': ['\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528 \u7edd\u5bf9\u5316 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6240\u6709\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528 \u8bc4\u8bba', '\u94b1\u5168\u662f\u4ed6\u4e2a\u4eba\u4f7f\u7528'],
  '\u4ed6\u8d85\u7231': ['\u4ed6\u8d85\u7231 \u78d5cp \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4ed6\u8d85\u7231 \u8bc4\u8bba', '\u4ed6\u771f\u7684\u8d85\u7231'],
  '\u4ed6\u7edd\u5bf9\u662f\u6700\u8fd1\u624d\u6da8\u4ef7\u7684': ['\u4ed6\u7edd\u5bf9\u662f\u6700\u8fd1\u624d\u6da8\u4ef7\u7684 \u6da8\u4ef7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4ed6\u7edd\u5bf9\u662f\u6700\u8fd1\u624d\u6da8\u4ef7\u7684 \u8bc4\u8bba', '\u6700\u8fd1\u624d\u6da8\u4ef7\u7684'],
  '\u4ed6\u5168\u662f\u5bf9\u7684': ['\u4ed6\u5168\u662f\u5bf9\u7684 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4ed6\u5168\u662f\u5bf9\u7684 \u8bc4\u8bba', '\u4f60\u5168\u662f\u5bf9\u7684'],
  '\u5b83m\u7684': ['\u5b83m\u7684 \u8c10\u97f3 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5b83m\u7684 \u8bc4\u8bba', '\u4ed6m\u7684'],
  '\u53f0\u6e7e\u7f51\u519b\u673a\u5668\u4eba': ['\u53f0\u6e7e\u7f51\u519b\u673a\u5668\u4eba \u653f\u6cbb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u53f0\u6e7e\u7f51\u519b\u673a\u5668\u4eba \u8bc4\u8bba', '\u53f0\u6e7e\u7f51\u519b'],
  '\u592a\u9633\u66b4\u6652\u7edd\u5bf9\u6709\u7528': ['\u592a\u9633\u66b4\u6652\u7edd\u5bf9\u6709\u7528 \u504f\u65b9 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u592a\u9633\u66b4\u6652\u7edd\u5bf9\u6709\u7528 \u8bc4\u8bba', '\u66b4\u6652\u7edd\u5bf9\u6709\u7528'],
  '\u592a\u88c5\u4e86': ['\u592a\u88c5\u4e86 \u4eba\u8bbe \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u592a\u88c5\u4e86 \u8bc4\u8bba', '\u6709\u70b9\u592a\u88c5\u4e86'],
  '\u7cd6\u6210\u8fd9\u6837': ['\u7cd6\u6210\u8fd9\u6837 \u78d5cp \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7cd6\u6210\u8fd9\u6837 \u8bc4\u8bba', '\u90fd\u7cd6\u6210\u8fd9\u6837\u4e86'],
  '\u5957\u5305\u4ed9\u4eba': ['\u5957\u5305\u4ed9\u4eba \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5957\u5305\u4ed9\u4eba \u8bc4\u8bba', '\u6a21\u7ec4\u5957\u5305'],
  '\u8e22\u5230\u68c9\u82b1\u4e86': ['\u8e22\u5230\u68c9\u82b1\u4e86 \u6c9f\u901a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8e22\u5230\u68c9\u82b1\u4e86 \u8bc4\u8bba', '\u4e00\u811a\u8e22\u5230\u68c9\u82b1'],
  '\u751c\u83dc': ['\u751c\u83dc \u5929\u624d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u751c\u83dc \u8bc4\u8bba', '\u751c\u83dc\u5929\u624d'],
  '\u6761\u5f62\u7801': ['\u6761\u5f62\u7801 \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6761\u5f62\u7801 \u8bc4\u8bba', '\u50cf\u6761\u5f62\u7801'],
  '\u8d34\u724c\u8d27': ['\u8d34\u724c\u8d27 \u4ea7\u54c1 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d34\u724c\u8d27 \u8bc4\u8bba', '\u5c31\u662f\u8d34\u724c\u8d27'],
  '\u901a\u5bb5\u6253\u87ba\u4e1d': ['\u901a\u5bb5\u6253\u87ba\u4e1d \u6253\u5de5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u901a\u5bb5\u6253\u87ba\u4e1d \u8bc4\u8bba', '\u6253\u87ba\u4e1d'],
  '\u540c\u6c42': ['\u540c\u6c42 \u8d44\u6e90 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u540c\u6c42 \u8bc4\u8bba', '\u8e72\u4e00\u4e2a\u540c\u6c42'],
  '\u9ab0\u5b50\u5988': ['\u9ab0\u5b50\u5988 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9ab0\u5b50\u5988 \u8bc4\u8bba', '\u8d5b\u9a6c\u5a18\u9ab0\u5b50\u5988'],
  '\u571f\u72d7\u653e\u6d0b\u5c41': ['\u571f\u72d7\u653e\u6d0b\u5c41 \u5d07\u6d0b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u571f\u72d7\u653e\u6d0b\u5c41 \u8bc4\u8bba', '\u653e\u6d0b\u5c41'],
  '\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86': ['\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86 \u8bc4\u8bba', '\u8fd8\u63a8\u52a8\u6587\u660e\u53d1\u5c55\u4e86'],
  '\u6258\u5b50': ['\u6258\u5b50 \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6258\u5b50 \u8bc4\u8bba', '\u5168\u662f\u6258\u5b50'],
  '\u6258\u5b50\u6ee1\u5929\u98de': ['\u6258\u5b50\u6ee1\u5929\u98de \u6c34\u519b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6258\u5b50\u6ee1\u5929\u98de \u8bc4\u8bba', '\u6258\u5b50\u5230\u5904\u98de'],
  '\u8131\u5b50': ['\u8131\u5b50 \u6258\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8131\u5b50 \u8bc4\u8bba', '\u6258\u5b50\u8131\u5b50'],
  '\u6b6a\u5634\u5e73\u677f': ['\u6b6a\u5634\u5e73\u677f \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6b6a\u5634\u5e73\u677f \u8bc4\u8bba', '\u5e73\u677f\u6b6a\u5634'],
  '\u6c6a\u6c6a\u961f\u52c7\u95ef\u732b\u7a9d': ['\u6c6a\u6c6a\u961f\u52c7\u95ef\u732b\u7a9d \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6c6a\u6c6a\u961f\u52c7\u95ef\u732b\u7a9d \u8bc4\u8bba', '\u52c7\u95ef\u732b\u7a9d'],
  '\u4ea1\u7075\u6cd5\u5e08': ['\u4ea1\u7075\u6cd5\u5e08 \u8003\u53e4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4ea1\u7075\u6cd5\u5e08 \u8bc4\u8bba', '\u53c8\u5728\u62db\u9b42'],
  '\u738b\u5927\u9a74': ['\u738b\u5927\u9a74 \u9ed1\u79f0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u738b\u5927\u9a74 \u8bc4\u8bba', '\u738b\u5927\u9a74\u5e08'],
  '\u4f2a5g': ['\u4f2a5g \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f2a5g \u8bc4\u8bba', '\u50475g'],
  '\u6211\u4e0d\u5165\u5730\u72f1\u8c01\u5165\u5730\u72f1': ['\u6211\u4e0d\u5165\u5730\u72f1\u8c01\u5165\u5730\u72f1 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u4e0d\u5165\u5730\u72f1\u8c01\u5165\u5730\u72f1 \u8bc4\u8bba', '\u8c01\u5165\u5730\u72f1'],
  '\u6211\u5e38\u7b11': ['\u6211\u5e38\u7b11 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u5e38\u7b11 \u8bc4\u8bba', '\u6211\u5e38\u5e38\u56e0\u4e3a'],
  '\u6211\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u90fd\u591a': ['\u6211\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u90fd\u591a \u8d44\u5386 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u90fd\u591a \u8bc4\u8bba', '\u5403\u7684\u76d0\u6bd4\u4f60\u5403\u7684\u996d\u591a'],
  '\u6211\u7684\u95ee\u9898': ['\u6211\u7684\u95ee\u9898 \u8ba4\u9519 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u7684\u95ee\u9898 \u8bc4\u8bba', '\u662f\u6211\u7684\u95ee\u9898'],
  '\u6211\u6545\u610f\u7684': ['\u6211\u6545\u610f\u7684 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u6545\u610f\u7684 \u8bc4\u8bba', '\u5c31\u662f\u6211\u6545\u610f\u7684'],
  '\u6211\u53ef\u4ee5\u4e0d\u7528\u4f46\u662f\u4f60\u4e0d\u80fd\u6ca1\u6709': ['\u6211\u53ef\u4ee5\u4e0d\u7528\u4f46\u662f\u4f60\u4e0d\u80fd\u6ca1\u6709 \u6570\u7801 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u53ef\u4ee5\u4e0d\u7528\u4f46\u662f\u4f60\u4e0d\u80fd\u6ca1\u6709 \u8bc4\u8bba', '\u6211\u53ef\u4ee5\u4e0d\u7528\u4f60\u4e0d\u80fd\u6ca1\u6709'],
  '\u6211\u561e\u4e2a\u4e56\u4e56': ['\u6211\u561e\u4e2a\u4e56\u4e56 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u561e\u4e2a\u4e56\u4e56 \u8bc4\u8bba', '\u6211\u7684\u4e2a\u4e56\u4e56'],
  '\u6211\u7406\u89e3': ['\u6211\u7406\u89e3 \u5171\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u7406\u89e3 \u8bc4\u8bba', '\u80fd\u7406\u89e3'],
  '\u6211\u7406\u89e3\u4f60\u7684\u5fc3\u60c5': ['\u6211\u7406\u89e3\u4f60\u7684\u5fc3\u60c5 \u5171\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u7406\u89e3\u4f60\u7684\u5fc3\u60c5 \u8bc4\u8bba', '\u7406\u89e3\u4f60\u7684\u5fc3\u60c5'],
  '\u6211\u7834\u9632': ['\u6211\u7834\u9632 \u81ea\u5632 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u7834\u9632 \u8bc4\u8bba', '\u770b\u7834\u9632\u4e86'],
  '\u6211\u4e0a\u6211\u4e5f\u884c': ['\u6211\u4e0a\u6211\u4e5f\u884c \u8d28\u7591 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u4e0a\u6211\u4e5f\u884c \u8bc4\u8bba', '\u8fd9\u6211\u4e0a\u6211\u4e5f\u884c'],
  '\u6211\u662f\u89c9\u5f97': ['\u6211\u662f\u89c9\u5f97 \u8868\u6001 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u662f\u89c9\u5f97 \u8bc4\u8bba', '\u4e2a\u4eba\u89c9\u5f97'],
  '\u6211\u662f\u5c0f\u4e11': ['\u6211\u662f\u5c0f\u4e11 \u81ea\u5632 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u662f\u5c0f\u4e11 \u8bc4\u8bba', '\u539f\u6765\u6211\u662f\u5c0f\u4e11'],
  '\u6211\u6709\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e': ['\u6211\u6709\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6211\u6709\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e \u8bc4\u8bba', '\u5341\u4ebf\u82f1\u9551\u5b58\u6b3e'],
  '\u65e0\u8fb9\u6c2a\u6d77': ['\u65e0\u8fb9\u6c2a\u6d77 \u6c2a\u91d1 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u8fb9\u6c2a\u6d77 \u8bc4\u8bba', '\u65e0\u8fb9\u6c2a\u6d77\u6e38\u620f'],
  '\u65e0\u654c\u4e4b\u4eba': ['\u65e0\u654c\u4e4b\u4eba \u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u654c\u4e4b\u4eba \u8bc4\u8bba', '\u5b89\u500d\u65e0\u654c\u4e4b\u4eba'],
  '\u65e0\u8111\u653e\u5927': ['\u65e0\u8111\u653e\u5927 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u8111\u653e\u5927 \u8bc4\u8bba', '\u5f00\u5927\u62db\u65e0\u8111\u653e'],
  '\u65e0\u8111\u55b7': ['\u65e0\u8111\u55b7 \u9ed1\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u8111\u55b7 \u8bc4\u8bba', '\u522b\u65e0\u8111\u55b7'],
  '\u65e0\u75db\u547b\u541f': ['\u65e0\u75db\u547b\u541f \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u75db\u547b\u541f \u8bc4\u8bba', '\u65e0\u75c5\u547b\u541f'],
  '\u65e0\u9700\u591a\u8a00': ['\u65e0\u9700\u591a\u8a00 \u7ed3\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u9700\u591a\u8a00 \u8bc4\u8bba', '\u65e0\u9700\u591a\u8a00\u4e86'],
  '\u65e0\u63a9\u4f53\u5e72\u62c9': ['\u65e0\u63a9\u4f53\u5e72\u62c9 \u5c04\u51fb\u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0\u63a9\u4f53\u5e72\u62c9 \u8bc4\u8bba', '\u6ca1\u6709\u63a9\u4f53\u5e72\u62c9'],
  '\u65e0cp': ['\u65e0cp \u89d2\u8272 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65e0cp \u8bc4\u8bba', '\u65e0CP\u5411'],
  '\u4e94\u6bd2\u4ff1\u5168': ['\u4e94\u6bd2\u4ff1\u5168 \u5410\u69fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e94\u6bd2\u4ff1\u5168 \u8bc4\u8bba', '\u771f\u662f\u4e94\u6bd2\u4ff1\u5168'],
  '\u4e94\u51a0\u738b\u8b66\u544a': ['\u4e94\u51a0\u738b\u8b66\u544a \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e94\u51a0\u738b\u8b66\u544a \u8bc4\u8bba', '\u51a0\u738b\u8b66\u544a'],
  '\u4e94\u7ef4\u56fe\u5168\u90fd\u4f4e\u7684\u53ef\u601c': ['\u4e94\u7ef4\u56fe\u5168\u90fd\u4f4e\u7684\u53ef\u601c \u6570\u636e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e94\u7ef4\u56fe\u5168\u90fd\u4f4e\u7684\u53ef\u601c \u8bc4\u8bba', '\u4e94\u7ef4\u56fe\u4f4e\u7684\u53ef\u601c'],
  '\u5438\u7279\u4e50': ['\u5438\u7279\u4e50 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5438\u7279\u4e50 \u8bc4\u8bba', '\u5e0c\u7279\u52d2'],
  '\u897f\u65b9\u4f2a\u53f2': ['\u897f\u65b9\u4f2a\u53f2 \u5386\u53f2 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u897f\u65b9\u4f2a\u53f2 \u8bc4\u8bba', '\u4f2a\u53f2\u8bba'],
  '\u6d17\u767d\u5f31\u4e09\u5206': ['\u6d17\u767d\u5f31\u4e09\u5206 \u6d17\u767d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d17\u767d\u5f31\u4e09\u5206 \u8bc4\u8bba', '\u6d17\u767d\u5f31\u4e09\u5206\u4e86'],
  '\u6d17\u4e0d\u4e86\u4e00\u70b9': ['\u6d17\u4e0d\u4e86\u4e00\u70b9 \u6d17\u767d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d17\u4e0d\u4e86\u4e00\u70b9 \u8bc4\u8bba', '\u8fd9\u6d17\u4e0d\u4e86'],
  '\u6d17\u8111\u5931\u8d25': ['\u6d17\u8111\u5931\u8d25 \u53cd\u9a73 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d17\u8111\u5931\u8d25 \u8bc4\u8bba', '\u6d17\u8111\u6ca1\u6210\u529f'],
  '\u6d17\u94b1\u7247': ['\u6d17\u94b1\u7247 \u7535\u5f71 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6d17\u94b1\u7247 \u8bc4\u8bba', '\u8fd9\u7247\u6d17\u94b1'],
  '\u7ec6\u8bf4\u4f60\u7684\u7ecf\u5386': ['\u7ec6\u8bf4\u4f60\u7684\u7ecf\u5386 \u8ffd\u95ee \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7ec6\u8bf4\u4f60\u7684\u7ecf\u5386 \u8bc4\u8bba', '\u7ec6\u8bf4'],
  '\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd': ['\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd \u8bc4\u8bba', '\u4f60\u778e\u8bf4\u4ec0\u4e48\u5b9e\u8bdd'],
  '\u4e0b\u996d': ['\u4e0b\u996d \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e0b\u996d \u8bc4\u8bba', '\u64cd\u4f5c\u4e0b\u996d'],
  '\u663e\u5f97\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11': ['\u663e\u5f97\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11 \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u663e\u5f97\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11 \u8bc4\u8bba', '\u8fd9\u4e2a\u4eba\u5f88\u5c0f\u4e11'],
  '\u5411\u5ba1\u6838\u7ad6\u8d77\u4e2d\u6307\u5427': ['\u5411\u5ba1\u6838\u7ad6\u8d77\u4e2d\u6307\u5427 \u5ba1\u6838 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5411\u5ba1\u6838\u7ad6\u8d77\u4e2d\u6307\u5427 \u8bc4\u8bba', '\u5ba1\u6838\u7ad6\u4e2d\u6307'],
  '\u5c0f\u4e11\u65b9': ['\u5c0f\u4e11\u65b9 \u7acb\u573a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u4e11\u65b9 \u8bc4\u8bba', '\u5c0f\u4e11\u90a3\u65b9'],
  '\u5c0f\u4e11\u53ef\u4ee5\u5e26\u4e2a': ['\u5c0f\u4e11\u53ef\u4ee5\u5e26\u4e2a \u5c0f\u4e11 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u4e11\u53ef\u4ee5\u5e26\u4e2a \u8bc4\u8bba', '\u5c0f\u4e11\u5e26\u4e2a'],
  '\u5c0f\u4e11\u638f\u51fa\u4e86\u7236\u6bcd\u8d2d\u4e70\u5238': ['\u5c0f\u4e11\u638f\u51fa\u4e86\u7236\u6bcd\u8d2d\u4e70\u5238 AI\u5267\u672c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u4e11\u638f\u51fa\u4e86\u7236\u6bcd\u8d2d\u4e70\u5238 \u8bc4\u8bba', '\u7236\u6bcd\u8d2d\u4e70\u5238'],
  '\u5c0f\u5b69\u54e5': ['\u5c0f\u5b69\u54e5 \u6f14\u6280 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u5b69\u54e5 \u8bc4\u8bba', '\u5c0f\u5b69\u54e5\u6f14\u6280'],
  '\u5c0f\u5b69\u5c04': ['\u5c0f\u5b69\u5c04 \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u5b69\u5c04 \u8bc4\u8bba', '\u5996\u5200\u5c0f\u5b69\u5c04'],
  '\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u8001\u591a\u4e86': ['\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u8001\u591a\u4e86 \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u8001\u591a\u4e86 \u8bc4\u8bba', '\u5c0f\u6ee1\u73a9\u5bb6\u5fc3\u773c\u591a'],
  '\u5c0f\u9e1f\u4f0f\u7279\u52a0': ['\u5c0f\u9e1f\u4f0f\u7279\u52a0 \u9b3c\u755c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u9e1f\u4f0f\u7279\u52a0 \u8bc4\u8bba', '\u5c0f\u9e1f\u4f0f\u7279\u52a0\u6897'],
  '\u5c0f\u7834\u7ad9': ['\u5c0f\u7834\u7ad9 B\u7ad9 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u7834\u7ad9 \u8bc4\u8bba', 'B\u7ad9\u5c0f\u7834\u7ad9'],
  '\u5c0f\u4eba\u56fd\u56fd\u738b': ['\u5c0f\u4eba\u56fd\u56fd\u738b \u7535\u7ade \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u4eba\u56fd\u56fd\u738b \u8bc4\u8bba', 'BLG \u5c0f\u4eba\u56fd\u56fd\u738b'],
  '\u5c0f\u4eba\u9000\u6563': ['\u5c0f\u4eba\u9000\u6563 \u80cc\u523a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0f\u4eba\u9000\u6563 \u8bc4\u8bba', '\u5c0f\u4eba\u9000\u6563\u80cc\u523a'],
  '\u5c0ftip': ['\u5c0ftip \u6559\u7a0b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5c0ftip \u8bc4\u8bba', '\u5c0ftips \u6559\u7a0b'],
  '\u7b11\u9ebb\u4e86': ['\u7b11\u9ebb\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7b11\u9ebb\u4e86 \u8bc4\u8bba', '\u7b11\u9ebb\u4e86\u6e38\u620f'],
  '\u7b11\u5760\u673a': ['\u7b11\u5760\u673a \u7b11\u54ed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7b11\u5760\u673a \u8bc4\u8bba', '\u7b11\u5760\u673a\u4e86'],
  '\u7b11\u5760\u673a\u4e86': ['\u7b11\u5760\u673a\u4e86 \u7b11\u54ed \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7b11\u5760\u673a\u4e86 \u8bc4\u8bba', '\u7b11\u5760\u673a'],
  '\u68b0\u9501\u4ece\u91cc\u4ece\u5916\u5168\u90fd\u6253\u4e0d\u5f00': ['\u68b0\u9501\u4ece\u91cc\u4ece\u5916\u5168\u90fd\u6253\u4e0d\u5f00 \u6c7d\u8f66 \u8f66\u95e8 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u68b0\u9501\u4ece\u91cc\u4ece\u5916\u5168\u90fd\u6253\u4e0d\u5f00 \u8bc4\u8bba', '\u673a\u68b0\u9501\u8f66\u95e8\u6253\u4e0d\u5f00'],
  '\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6': ['\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6 \u7269\u7406 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6 \u8bc4\u8bba', '\u8c22\u8c22\u4f60\u7269\u7406\u5b66\u5bb6\u6897'],
  '\u5fc3\u91cc\u6ca1\u70b9b\u6570': ['\u5fc3\u91cc\u6ca1\u70b9b\u6570 \u5ddd\u666e \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5fc3\u91cc\u6ca1\u70b9b\u6570 \u8bc4\u8bba', '\u6ca1\u70b9b\u6570'],
  '\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b': ['\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b \u5ddd\u666e \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5fc3\u91cc\u6ca1\u70b9b\u6570\u561b \u8bc4\u8bba', '\u5fc3\u91cc\u6ca1\u70b9b\u6570'],
  '\u65b0\u5170\u515a': ['\u65b0\u5170\u515a \u67ef\u5357 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65b0\u5170\u515a \u8bc4\u8bba', '\u67ef\u54c0\u515a \u65b0\u5170\u515a'],
  '\u65b0\u95fb\u5b66\u7684\u9b45\u529b': ['\u65b0\u95fb\u5b66\u7684\u9b45\u529b \u5a92\u4f53 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u65b0\u95fb\u5b66\u7684\u9b45\u529b \u8bc4\u8bba', '\u8fd9\u5c31\u662f\u65b0\u95fb\u5b66\u7684\u9b45\u529b'],
  '\u661f\u661f\u773c': ['\u661f\u661f\u773c \u8868\u60c5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u661f\u661f\u773c \u8bc4\u8bba', '\u53d1\u661f\u661f\u773c'],
  '\u884c\u5584\u79ef\u5fb7': ['\u884c\u5584\u79ef\u5fb7 \u56e0\u679c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u884c\u5584\u79ef\u5fb7 \u8bc4\u8bba', '\u61c2\u5f97\u884c\u5584\u79ef\u5fb7'],
  '\u865a\u7a7a\u5efa\u4e00\u4e2a\u9776\u5b50': ['\u865a\u7a7a\u5efa\u4e00\u4e2a\u9776\u5b50 \u865a\u7a7a\u6253\u9776 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u865a\u7a7a\u5efa\u4e00\u4e2a\u9776\u5b50 \u8bc4\u8bba', '\u865a\u7a7a\u7acb\u9776'],
  '\u865a\u7a7a\u8feb\u5bb3': ['\u865a\u7a7a\u8feb\u5bb3 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u865a\u7a7a\u8feb\u5bb3 \u8bc4\u8bba', '\u53c8\u5728\u865a\u7a7a\u8feb\u5bb3'],
  '\u865a\u8363\u5c60\u592b': ['\u865a\u8363\u5c60\u592b \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u865a\u8363\u5c60\u592b \u8bc4\u8bba', '\u865a\u8363\u5c60\u592b\u6ca1\u6709\u7f6a'],
  '\u8f69\u59b9\u7684\u5567': ['\u8f69\u59b9\u7684\u5567 \u9f99\u54e5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8f69\u59b9\u7684\u5567 \u8bc4\u8bba', '\u9f99\u54e5\u7684\u5144\u5f1f \u8f69\u59b9\u7684\u5567'],
  '\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u4f3c\u4e86': ['\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u4f3c\u4e86 \u732b\u732b \u661f\u661f\u773c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u4f3c\u4e86 \u8bc4\u8bba', '\u60ac\u7740\u7684\u5fc3\u7ec8\u4e8e\u6b7b\u4e86'],
  '\u4e9a\u519bfmvp': ['\u4e9a\u519bfmvp \u738b\u8005\u8363\u8000 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e9a\u519bfmvp \u8bc4\u8bba', '\u4e9a\u519bFMVP'],
  '\u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684': ['\u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684 \u53cd\u8bbd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684 \u8bc4\u8bba', '\u4e0d\u7528\u6015 \u6df9\u6b7b\u7684\u90fd\u662f\u4f1a\u6c34\u7684'],
  '\u4e25\u67e5\u80cc\u666f': ['\u4e25\u67e5\u80cc\u666f \u7f51\u53cb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e25\u67e5\u80cc\u666f \u8bc4\u8bba', '\u5efa\u8bae\u4e25\u67e5\u80cc\u666f'],
  '\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f': ['\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f \u7f8e\u5973 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f \u8bc4\u8bba', '\u8fd9\u59d0\u989c\u503c\u8eab\u6750\u6ca1\u6709\u77ed\u677f'],
  '\u9633\u75ff': ['\u9633\u75ff \u4e0b\u8f88\u5b50 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9633\u75ff \u8bc4\u8bba', '\u8fd9\u8f88\u5b50\u9633\u75ff'],
  '\u4e5f\u4e0d\u5b8c\u5168\u662f': ['\u4e5f\u4e0d\u5b8c\u5168\u662f \u89e3\u91ca \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e5f\u4e0d\u5b8c\u5168\u662f \u8bc4\u8bba', '\u4e5f\u4e0d\u5b8c\u5168\u662f\u5427'],
  '\u4e5f\u662f\u5f88\u6709\u751f\u6d3b\u4e86': ['\u4e5f\u662f\u5f88\u6709\u751f\u6d3b\u4e86 \u751f\u6d3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e5f\u662f\u5f88\u6709\u751f\u6d3b\u4e86 \u8bc4\u8bba', '\u5f88\u6709\u751f\u6d3b\u4e86'],
  '\u4e00\u5531\u4e00\u4e2a\u4e0d\u5431\u58f0': ['\u4e00\u5531\u4e00\u4e2a\u4e0d\u5431\u58f0 \u5531\u6b4c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u5531\u4e00\u4e2a\u4e0d\u5431\u58f0 \u8bc4\u8bba', '\u4e00\u5531\u4e00\u4e2a\u4e0d\u652f\u58f0'],
  '\u4e00\u9493\u5f00\u5929\u95e8': ['\u4e00\u9493\u5f00\u5929\u95e8 \u9493\u9c7c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u9493\u5f00\u5929\u95e8 \u8bc4\u8bba', '\u4e00\u9493\u5f00\u5929\u95e8\u9493\u9c7c'],
  '\u4e00\u5768\u52fe\u77f3': ['\u4e00\u5768\u52fe\u77f3 \u5e26\u8d27 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u5768\u52fe\u77f3 \u8bc4\u8bba', '\u5356\u7684\u4e1c\u897f\u4e00\u5768\u52fe\u77f3'],
  '\u4e00\u773c\u5230\u5934': ['\u4e00\u773c\u5230\u5934 \u4e09\u548c\u5927\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u773c\u5230\u5934 \u8bc4\u8bba', '\u4e00\u773c\u5230\u5934\u8003\u8651\u4e2a\u51e0\u628a'],
  '\u4e00\u773c\u79d1\u6280': ['\u4e00\u773c\u79d1\u6280 \u5403\u74dc \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e00\u773c\u79d1\u6280 \u8bc4\u8bba', '\u4e00\u773c\u79d1\u6280\u5403\u74dc'],
  '\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86': ['\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86 Fate \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86 \u8bc4\u8bba', '\u4f0a\u8389\u96c5\u6211\u8f6f\u811a\u4e86\u5feb\u6276\u6211\u8d77\u6765'],
  '\u4f9d\u6258\u5b9e': ['\u4f9d\u6258\u5b9e \u9760\u5b9e\u529b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f9d\u6258\u5b9e \u8bc4\u8bba', '\u9760\u5b9e\u529b\u5c31\u662f\u4f9d\u6258\u5b9e'],
  '\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c': ['\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c \u864e\u6251 \u8bc4\u5206 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c \u8bc4\u8bba', '\u611f\u89c9\u4e49\u52a1\u6559\u80b2\u6ca1\u4e0a\u5b8c'],
  '\u4ebf\u70b9\u70b9': ['\u4ebf\u70b9\u70b9 \u840c\u65b0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4ebf\u70b9\u70b9 \u8bc4\u8bba', '\u6211\u53ea\u4f1a\u4ebf\u70b9\u70b9'],
  '\u5f02\u98df\u7656': ['\u5f02\u98df\u7656 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f02\u98df\u7656 \u8bc4\u8bba', 'up\u4e3b\u6709\u5f02\u98df\u7656'],
  '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16': ['\u9038\u4e00\u65f6\u8bef\u4e00\u4e16 \u9003\u907f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9038\u4e00\u65f6\u8bef\u4e00\u4e16 \u8bc4\u8bba', '\u9003\u907f\u4e00\u65f6\u8bef\u4e00\u4e16'],
  '\u61ff\u7c89': ['\u61ff\u7c89 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u61ff\u7c89 \u8bc4\u8bba', '\u61ff\u7c89\u60f9\u5230up\u4e3b'],
  '\u9634\u6210\u5565\u4e86': ['\u9634\u6210\u5565\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9634\u6210\u5565\u4e86 \u8bc4\u8bba', '\u8fd9\u9634\u6210\u5565\u4e86'],
  '\u94f6\u624b\u956f': ['\u94f6\u624b\u956f \u56e2\u4f19 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u94f6\u624b\u956f \u8bc4\u8bba', '\u559c\u63d0\u94f6\u624b\u956f'],
  '\u5f15\u86c7\u51fa\u6d1e': ['\u5f15\u86c7\u51fa\u6d1e \u4e13\u5bb6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f15\u86c7\u51fa\u6d1e \u8bc4\u8bba', '\u771f\u6b63\u7684\u4e13\u5bb6\u88ab\u5f15\u86c7\u51fa\u6d1e'],
  '\u9e70\u89d2\u8981\u5012\u4e86': ['\u9e70\u89d2\u8981\u5012\u4e86 \u660e\u65e5\u65b9\u821f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9e70\u89d2\u8981\u5012\u4e86 \u8bc4\u8bba', '\u660e\u65e5\u65b9\u821f \u9e70\u89d2\u8981\u5012\u4e86'],
  '\u8d62\u4e00\u573a\u5439\u4e00\u573a': ['\u8d62\u4e00\u573a\u5439\u4e00\u573a \u7403\u8ff7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d62\u4e00\u573a\u5439\u4e00\u573a \u8bc4\u8bba', '\u8d62\u4e00\u573a\u5c31\u5439\u4e00\u573a'],
  '\u8d62\u8005\u504f\u5dee': ['\u8d62\u8005\u504f\u5dee \u6295\u8d44 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d62\u8005\u504f\u5dee \u8bc4\u8bba', '\u5e78\u5b58\u8005\u504f\u5dee \u8d62\u8005'],
  '\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427': ['\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427 \u5e26\u8d27 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427 \u8bc4\u8bba', '\u600e\u4e48\u5f71\u54cd\u5230\u5356\u4e86\u662f\u5427'],
  '\u786c\u64e6': ['\u786c\u64e6 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u786c\u64e6 \u8bc4\u8bba', '\u8fd9\u4e5f\u80fd\u786c\u64e6'],
  '\u6c38\u4e0d\u53d6\u5173': ['\u6c38\u4e0d\u53d6\u5173 up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6c38\u4e0d\u53d6\u5173 \u8bc4\u8bba', '\u6c38\u4e0d\u53d6\u5173\u4e86'],
  '\u6c38\u4e0d\u8da3\u5173': ['\u6c38\u4e0d\u8da3\u5173 \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6c38\u4e0d\u8da3\u5173 \u8bc4\u8bba', '\u6c38\u4e0d\u8da3\u5173\u4e86'],
  '\u7528\u6237\u81ea\u9002\u5e94': ['\u7528\u6237\u81ea\u9002\u5e94 \u6e38\u620f\u7b56\u5212 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7528\u6237\u81ea\u9002\u5e94 \u8bc4\u8bba', '\u4e0d\u662f\u95ee\u9898\u662f\u7528\u6237\u81ea\u9002\u5e94'],
  '\u4f18\u96c5': ['\u4f18\u96c5 \u64cd\u4f5c \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u4f18\u96c5 \u8bc4\u8bba', '\u4f18\u96c5\u6c38\u4e0d\u8fc7\u65f6'],
  '\u5e7d\u9ed8\u4f18\u5316': ['\u5e7d\u9ed8\u4f18\u5316 \u6e38\u620f\u66f4\u65b0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5e7d\u9ed8\u4f18\u5316 \u8bc4\u8bba', '\u8fd9\u6ce2\u5e7d\u9ed8\u4f18\u5316'],
  '\u6cb9\u7ba1': ['\u6cb9\u7ba1 \u642c\u8fd0 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6cb9\u7ba1 \u8bc4\u8bba', '\u6cb9\u7ba1\u539f\u89c6\u9891'],
  '\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb': ['\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb \u89e3\u9898 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb \u8bc4\u8bba', '\u679c\u7136\u6709\u516c\u5f0f\u5957\u5c31\u662f\u5feb'],
  '\u6709\u4f55\u8bf4\u6cd5': ['\u6709\u4f55\u8bf4\u6cd5 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u4f55\u8bf4\u6cd5 \u8bc4\u8bba', '\u5404\u4f4d\u6709\u4f55\u8bf4\u6cd5'],
  '\u6709\u6ca1\u53ef\u80fd': ['\u6709\u6ca1\u53ef\u80fd \u6709\u6ca1\u6709\u53ef\u80fd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u6ca1\u53ef\u80fd \u8bc4\u8bba', '\u6709\u6ca1\u6709\u53ef\u80fd\u662f\u4f60\u7684\u95ee\u9898'],
  '\u6709\u8111\u5b50\u4f46\u4e0d\u591a': ['\u6709\u8111\u5b50\u4f46\u4e0d\u591a \u7f51\u53cb \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u8111\u5b50\u4f46\u4e0d\u591a \u8bc4\u8bba', '\u770b\u7740\u6709\u8111\u5b50\u4f46\u4e0d\u591a'],
  '\u6709\u4e00\u70b9\u75d4\u75ae': ['\u6709\u4e00\u70b9\u75d4\u75ae \u8fd9\u8bdd \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u4e00\u70b9\u75d4\u75ae \u8bc4\u8bba', '\u611f\u89c9\u6709\u4e00\u70b9\u75d4\u75ae'],
  '\u6709\u8bc1\u636e\u5417': ['\u6709\u8bc1\u636e\u5417 \u5bf9\u7ebf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6709\u8bc1\u636e\u5417 \u8bc4\u8bba', '\u8bf7\u95ee\u6709\u8bc1\u636e\u5417'],
  '\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a': ['\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a \u8bc4\u8bba', '\u9c7c\u9c7c\u4fdd\u62a4\u534f\u4f1a\u51fa\u52a8'],
  '\u5143\u7d20\u670b\u53cb': ['\u5143\u7d20\u670b\u53cb \u539f\u795e \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5143\u7d20\u670b\u53cb \u8bc4\u8bba', '\u539f\u795e\u5143\u7d20\u670b\u53cb'],
  '\u8fd0\u6c14\u771f\u597d': ['\u8fd0\u6c14\u771f\u597d \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd0\u6c14\u771f\u597d \u8bc4\u8bba', '\u4f60\u8fd0\u6c14\u771f\u597d'],
  '\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba': ['\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba \u97f3\u4e50 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba \u8bc4\u8bba', '\u521d\u542c\u4e0d\u8bc6\u66f2\u4e2d\u610f \u518d\u542c\u5df2\u662f\u66f2\u4e2d\u4eba'],
  '\u518d\u95ee\u5220\u4e86': ['\u518d\u95ee\u5220\u4e86 \u5220\u8bc4 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u518d\u95ee\u5220\u4e86 \u8bc4\u8bba', '\u522b\u95ee\u4e86\u518d\u95ee\u5220\u4e86'],
  '\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e': ['\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e \u8bc4\u8bba', '\u8db3\u7403\u8d5e\u52a9\u5546\u5357\u7f8e\u9ed1\u5e2e'],
  '\u6e23\u6d6a': ['\u6e23\u6d6a \u5fae\u535a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6e23\u6d6a \u8bc4\u8bba', '\u6e23\u6d6a\u5fae\u535a'],
  '\u6218\u7ee9\u6e05\u96f6\u5361': ['\u6218\u7ee9\u6e05\u96f6\u5361 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6218\u7ee9\u6e05\u96f6\u5361 \u8bc4\u8bba', '\u4f7f\u7528\u6218\u7ee9\u6e05\u96f6\u5361'],
  '\u957f\u6b8b\u7bc7': ['\u957f\u6b8b\u7bc7 \u7ae5\u661f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u957f\u6b8b\u7bc7 \u8bc4\u8bba', '\u957f\u6b8b\u4e86\u7ae5\u661f'],
  '\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86': ['\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86 \u9634\u9633\u602a\u6c14 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86 \u8bc4\u8bba', '\u8fd9\u4e0b\u8fd9\u8f88\u5b50\u7b97\u662f\u6709\u4e86'],
  '\u8fd9\u4e2a\u88c1\u5224\u80af\u5b9a\u662f\u6709\u95ee\u9898\u7684': ['\u8fd9\u4e2a\u88c1\u5224\u80af\u5b9a\u662f\u6709\u95ee\u9898\u7684 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u4e2a\u88c1\u5224\u80af\u5b9a\u662f\u6709\u95ee\u9898\u7684 \u8bc4\u8bba', '\u88c1\u5224\u80af\u5b9a\u6709\u95ee\u9898'],
  '\u8fd9\u4e2a\u5708\u5b50\u5c31\u662f\u70c2': ['\u8fd9\u4e2a\u5708\u5b50\u5c31\u662f\u70c2 \u996d\u5708 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u4e2a\u5708\u5b50\u5c31\u662f\u70c2 \u8bc4\u8bba', '\u6574\u4e2a\u5708\u5b50\u5c31\u662f\u70c2'],
  '\u8fd9\u724c\u5b50\u6211\u8fd9\u8f88\u5b50\u90fd\u4e0d\u4f1a\u78b0\u4e86': ['\u8fd9\u724c\u5b50\u6211\u8fd9\u8f88\u5b50\u90fd\u4e0d\u4f1a\u78b0\u4e86 \u907f\u96f7 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u724c\u5b50\u6211\u8fd9\u8f88\u5b50\u90fd\u4e0d\u4f1a\u78b0\u4e86 \u8bc4\u8bba', '\u8fd9\u724c\u5b50\u518d\u4e5f\u4e0d\u78b0\u4e86'],
  '\u8fd9\u5b8c\u5168\u662f\u65e0\u79c1\u7684': ['\u8fd9\u5b8c\u5168\u662f\u65e0\u79c1\u7684 \u8bbd\u523a \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8fd9\u5b8c\u5168\u662f\u65e0\u79c1\u7684 \u8bc4\u8bba', '\u4ed6\u771f\u7684\u592a\u65e0\u79c1\u4e86'],
  '\u771f\u90fd\u5047\u90fd': ['\u771f\u90fd\u5047\u90fd \u5206\u4e0d\u6e05 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u771f\u90fd\u5047\u90fd \u8bc4\u8bba', '\u771f\u7684\u5047\u90fd\u5206\u4e0d\u6e05'],
  '\u771f\u5c31\u4e71\u55b7': ['\u771f\u5c31\u4e71\u55b7 \u5bf9\u7ebf \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u771f\u5c31\u4e71\u55b7 \u8bc4\u8bba', '\u522b\u771f\u5c31\u4e71\u55b7'],
  '\u771f\u4ebabot': ['\u771f\u4ebabot \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u771f\u4ebabot \u8bc4\u8bba', '\u50cf\u771f\u4ebabot\u4e00\u6837'],
  '\u771ftm\u4e0d\u8981\u8138': ['\u771ftm\u4e0d\u8981\u8138 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u771ftm\u4e0d\u8981\u8138 \u8bc4\u8bba', '\u771f\u7684tm\u4e0d\u8981\u8138'],
  '\u7741\u7740\u773c\u775b\u585e\u76f2\u76d2': ['\u7741\u7740\u773c\u775b\u585e\u76f2\u76d2 \u6d88\u8d39\u8005 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7741\u7740\u773c\u775b\u585e\u76f2\u76d2 \u8bc4\u8bba', '\u7741\u773c\u585e\u76f2\u76d2'],
  '\u6b63\u9053\u7684\u5149': ['\u6b63\u9053\u7684\u5149 \u70ed\u6897 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6b63\u9053\u7684\u5149 \u8bc4\u8bba', '\u6b63\u9053\u7684\u5149\u7167\u5728\u4e86\u5927\u5730\u4e0a'],
  '\u6b63\u786e\u4e2a\u53fc': ['\u6b63\u786e\u4e2a\u53fc \u65b9\u8a00 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6b63\u786e\u4e2a\u53fc \u8bc4\u8bba', '\u6b63\u786e\u4e2a\u5c41'],
  '\u6b63\u4e49\u4e4b\u58eb': ['\u6b63\u4e49\u4e4b\u58eb \u9053\u5fb7\u7ed1\u67b6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6b63\u4e49\u4e4b\u58eb \u8bc4\u8bba', '\u6b63\u4e49\u4eba\u58eb\u9053\u5fb7\u7ed1\u67b6'],
  '\u652f\u6301\u4e00\u4e0bup': ['\u652f\u6301\u4e00\u4e0bup up\u4e3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u652f\u6301\u4e00\u4e0bup \u8bc4\u8bba', '\u5927\u5bb6\u652f\u6301\u4e00\u4e0bup\u4e3b'],
  '\u77e5\u5c0f\u793c\u800c\u65e0\u5927\u4e49': ['\u77e5\u5c0f\u793c\u800c\u65e0\u5927\u4e49 \u5178\u6545 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u77e5\u5c0f\u793c\u800c\u65e0\u5927\u4e49 \u8bc4\u8bba', '\u77e5\u5c0f\u793c\u65e0\u5927\u4e49'],
  '\u503c\u4eba': ['\u503c\u4eba \u7c73\u54c8\u6e38 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u503c\u4eba \u8bc4\u8bba', '\u7c73\u54c8\u6e38\u503c\u4eba'],
  '\u804c\u4e1a\u6f14\u5458': ['\u804c\u4e1a\u6f14\u5458 \u8db3\u7403 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u804c\u4e1a\u6f14\u5458 \u8bc4\u8bba', '\u8fd9\u4eba\u804c\u4e1a\u6f14\u5458\u5427'],
  '\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf\u53d1\u529b\u4e86': ['\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf\u53d1\u529b\u4e86 \u6e38\u620f \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf\u53d1\u529b\u4e86 \u8bc4\u8bba', '\u7ec8\u8f93\u795e\u7ecf\u7cfb\u7edf'],
  '\u8098\u904d\u5168\u7f51': ['\u8098\u904d\u5168\u7f51 \u5468\u6770\u4f26 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u8098\u904d\u5168\u7f51 \u8bc4\u8bba', '\u5468\u6770\u4f26\u8098\u904d\u5168\u7f51'],
  '\u6731\u4e00\u9f99': ['\u6731\u4e00\u9f99 \u7c89\u4e1d \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6731\u4e00\u9f99 \u8bc4\u8bba', '\u6731\u4e00\u9f99\u7c89\u4e1d'],
  '\u732a\u9f3b': ['\u732a\u9f3b \u4f60\u600e\u4e48\u8fd9\u4e48\u732a\u9f3b \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u732a\u9f3b \u8bc4\u8bba', '\u4f60\u600e\u4e48\u8fd9\u4e48\u732a\u9f3b'],
  '\u732a\u8840\u9992\u5934': ['\u732a\u8840\u9992\u5934 \u5403\u4eba\u8840\u9992\u5934 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u732a\u8840\u9992\u5934 \u8bc4\u8bba', '\u5403\u4eba\u8840\u9992\u5934'],
  '\u6293\u5230\u4e00\u4e2a\u8001\u5b9e\u4eba': ['\u6293\u5230\u4e00\u4e2a\u8001\u5b9e\u4eba \u5f39\u5e55 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u6293\u5230\u4e00\u4e2a\u8001\u5b9e\u4eba \u8bc4\u8bba', '\u6293\u8001\u5b9e\u4eba'],
  '\u505a\u7968': ['\u6295\u7968\u505a\u7968 \u70ed\u8bc4', '\u4e3b\u529e\u65b9\u505a\u7968 \u8bc4\u8bba', '\u699c\u5355\u505a\u7968 \u56de\u590d'],
  'ex\u4eba': ['ex\u4eba \u70ed\u8bc4', '\u771fex\u4eba \u8bc4\u8bba', '\u8fd9\u4e5f\u592aex\u4eba\u4e86'],
  'gai\u5df2\u6025\u54ed': ['gai\u5df2\u6025\u54ed \u70ed\u8bc4', 'GAI\u5df2\u6025\u54ed \u8bc4\u8bba', 'gai\u6025\u4e86 \u56de\u590d'],
  'get\u5230': ['get\u5230 \u70ed\u8bc4', '\u6211get\u5230\u4e86 \u8bc4\u8bba', '\u5b8c\u5168get\u5230 \u56de\u590d'],
  'nocap': ['nocap \u70ed\u8bc4', 'no cap \u8bc4\u8bba', '\u771f\u7684nocap \u56de\u590d'],
  'tv\u5455\u5410': ['tv\u5455\u5410 \u8868\u60c5 \u70ed\u8bc4', '\u5455\u5410\u8868\u60c5 \u8bc4\u8bba', '\u53d1tv\u5455\u5410 \u56de\u590d'],
  '3a\u53d83o': ['3a\u53d83o \u70ed\u8bc4', '3A\u53d83O \u8bc4\u8bba', '3a\u5927\u4f5c\u53d83o'],
  '3pp\u5927\u795e': ['3pp\u5927\u795e \u70ed\u8bc4', '3PP\u5927\u795e \u8bc4\u8bba', '3pp\u5927\u795e\u6765\u4e86'],
  '58\u5206\u5148\u751f': ['58\u5206\u5148\u751f \u70ed\u8bc4', '\u7f57\u6c38\u6d6958\u5206 \u8bc4\u8bba', '58\u5206\u5148\u751f\u7f57\u6c38\u6d69'],
  '7\u79d2\u7126\u8651': ['7\u79d2\u7126\u8651 \u70ed\u8bc4', '\u4e03\u79d2\u7126\u8651 \u8bc4\u8bba', '\u89c6\u98917\u79d2\u7126\u8651'],
  '985\u5f53\u7136\u4e0d\u662f\u767d\u4e0a\u7684': ['985\u5f53\u7136\u4e0d\u662f\u767d\u4e0a\u7684 \u70ed\u8bc4', '985\u4e0d\u662f\u767d\u4e0a\u7684 \u8bc4\u8bba', '\u4f60\u8fd99985\u5f53\u7136\u4e0d\u662f\u767d\u4e0a\u7684'],
  '\u963f\u9ed1\u989c': ['\u963f\u9ed1\u989c \u70ed\u8bc4', '\u963f\u9ed1\u989c\u8868\u60c5 \u8bc4\u8bba', '\u522b\u53d1\u963f\u9ed1\u989c'],
  '\u7231\u6765\u81ea': ['\u7231\u6765\u81ea \u70ed\u8bc4', '\u7231\u6765\u81ea\u4e2d\u56fd \u8bc4\u8bba', '\u7231\u6765\u81ea\u54ea\u91cc \u56de\u590d'],
  '\u7231\u6765\u81ea\u997a\u5b50': ['\u7231\u6765\u81ea\u997a\u5b50 \u70ed\u8bc4', '\u997a\u5b50\u7231\u6765\u81ea \u8bc4\u8bba', '\u7231\u6765\u81ea\u997a\u5b50\u5bfc\u6f14'],
  '\u6697\u95e8\u5b50': ['\u6697\u95e8\u5b50 \u70ed\u8bc4', '\u8fd9\u5c31\u662f\u6697\u95e8\u5b50 \u8bc4\u8bba', '\u6709\u6697\u95e8\u5b50 \u56de\u590d'],
  '\u653b\u51fb\u4ed6\u4eba\u6d6e\u6728': ['\u6d6e\u6728\u4fa0 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6d6e\u6728\u6253\u65ad \u8bc4\u8bba', '\u62ff\u8d77\u8f6e\u6905 \u70ed\u8bc4'],
  '\u72d7\u5c4e\u673a\u5236': ['\u72d7\u5c4e\u5339\u914d\u673a\u5236 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u72d7\u5c4e\u673a\u5236\u771f\u5e26\u4e0d\u52a8 \u8bc4\u8bba', '\u5339\u914d\u673a\u5236\u72d7\u5c4e \u70ed\u8bc4'],
  '\u82df\u76841b': ['\u592a\u82df\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u82df\u52301b \u8bc4\u8bba', '\u82df\u7684\u4e00\u6279 \u70ed\u8bc4'],
  '\u53e4\u5c38\u7ea7': ['\u9aa8\u7070\u7ea7 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u9aa8\u7070\u7ea7\u8001\u73a9\u5bb6 \u8bc4\u8bba', '\u8001\u53e4\u8463\u7ea7 \u70ed\u8bc4'],
  '\u626e\u6f14\u5c0f\u4e11': ['\u626e\u6f14\u5c0f\u4e11 \u70ed\u8bc4', '\u4f60\u5728\u626e\u6f14\u5c0f\u4e11 \u8bc4\u8bba', '\u626e\u6f14\u5c0f\u4e11\u7684\u4eba \u56de\u590d'],
  '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86': ['\u628a\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u70ed\u8bc4', '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u8bc4\u8bba', '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb \u56de\u590d'],
  '\u7206\u7834\u4f60': ['\u7206\u7834\u4f60 \u70ed\u8bc4', '\u7c89\u4e1d\u7206\u7834\u4f60 \u8bc4\u8bba', '\u5c0f\u5fc3\u88ab\u7206\u7834 \u56de\u590d'],
  '\u5954\u4e0d\u4f4f': ['\u5954\u4e0d\u4f4f \u70ed\u8bc4', '\u771f\u5954\u4e0d\u4f4f \u8bc4\u8bba', '\u7ef7\u4e0d\u4f4f \u5954\u4e0d\u4f4f'],
  '\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4': ['\u903c\u6211\u5403\u4e86\u4e09\u5768\u7fd4 \u70ed\u8bc4', '\u5403\u4e86\u4e09\u5768\u7fd4 \u8bc4\u8bba', '\u903c\u6211\u5403\u7fd4 \u56de\u590d'],
  '\u95ed\u7740\u773c\u775b\u4ed8\u94b1': ['\u95ed\u7740\u773c\u775b\u4ed8\u94b1 \u70ed\u8bc4', '\u95ed\u773c\u4ed8\u94b1 \u8bc4\u8bba', '\u8fd9\u90fd\u95ed\u7740\u773c\u775b\u4ed8\u94b1'],
  '\u907f\u91cd\u5c31\u8f7b': ['\u907f\u91cd\u5c31\u8f7b \u70ed\u8bc4', '\u522b\u907f\u91cd\u5c31\u8f7b \u8bc4\u8bba', '\u53c8\u5728\u907f\u91cd\u5c31\u8f7b \u56de\u590d'],
  '\u51b0\u6cb3\u65f6\u4ee3': ['\u51b0\u6cb3\u65f6\u4ee3 \u70ed\u8bc4', '\u8fdb\u5165\u51b0\u6cb3\u65f6\u4ee3 \u8bc4\u8bba', '\u7248\u672c\u51b0\u6cb3\u65f6\u4ee3 \u6e38\u620f'],
  '\u75c5\u5927\u90ce': ['\u75c5\u5927\u90ce \u70ed\u8bc4', '\u75c5\u5927\u90ce\u5403\u836f \u8bc4\u8bba', '\u4f60\u662f\u75c5\u5927\u90ce \u56de\u590d'],
  '\u8865\u836f\u554a': ['\u8865\u836f\u554a \u70ed\u8bc4', '\u8865\u836f\u554a\u5144\u5f1f \u8bc4\u8bba', '\u771f\u7684\u8865\u836f\u554a \u5f39\u5e55'],
  '\u4e0d\u5e26\u8111\u5b50': ['\u4e0d\u5e26\u8111\u5b50 \u70ed\u8bc4', '\u8bf4\u8bdd\u4e0d\u5e26\u8111\u5b50 \u8bc4\u8bba', '\u73a9\u6e38\u620f\u4e0d\u5e26\u8111\u5b50'],
  '\u4e0d\u5f97\u4e0d\u5c1d': ['\u4e0d\u5f97\u4e0d\u5c1d \u70ed\u8bc4', '\u8fd9\u4e0d\u5f97\u4e0d\u5c1d \u8bc4\u8bba', '\u4e0d\u5f97\u4e0d\u5c1d\u4e00\u4e0b \u56de\u590d'],
  '\u4e0d\u548c\u5356\u7684\u73a9': ['\u4e0d\u548c\u5356\u7684\u73a9 \u70ed\u8bc4', '\u4e0d\u8ddf\u5356\u7684\u73a9 \u8bc4\u8bba', '\u522b\u548c\u5356\u7684\u73a9 \u56de\u590d'],
  '\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11': ['\u4e0d\u7edd\u5bf9\u4f46\u97e9\u56fd\u4e0d\u5c11 \u70ed\u8bc4', '\u97e9\u56fd\u4e0d\u5c11 \u8bc4\u8bba', '\u4e0d\u7edd\u5bf9 \u97e9\u56fd \u4e0d\u5c11'],
  '\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba': ['\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u70ed\u8bc4', '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u7ecf\u5178\u4e0d\u770b\u5185\u5bb9\u8bc4\u8bba \u8bc4\u8bba', '\u4e0d\u770b\u5185\u5bb9\u5c31\u8bc4\u8bba'],
  '\u4e0d\u5982ravenfiled': ['\u4e0d\u5982ravenfiled \u70ed\u8bc4', '\u4e0d\u5982ravenfield \u8bc4\u8bba', 'ravenfield \u4e0d\u5982 \u70ed\u8bc4'],
  '\u4e0d\u8bd7\u4eba': ['\u4e0d\u8bd7\u4eba \u70ed\u8bc4', '\u4f60\u4e0d\u8bd7\u4eba \u8bc4\u8bba', '\u771f\u4e0d\u8bd7\u4eba \u56de\u590d'],
  '\u4e0d\u662f\u5f88\u8ba4\u53ef': ['\u4e0d\u662f\u5f88\u8ba4\u53ef \u70ed\u8bc4', '\u6211\u4e0d\u662f\u5f88\u8ba4\u53ef \u8bc4\u8bba', '\u4e0d\u592a\u8ba4\u53ef \u56de\u590d'],
  '\u4e0d\u662f\u4f60\u649e\u7684\u4f60\u4e3a\u5565\u8981\u6276': ['\u4e0d\u662f\u4f60\u649e\u7684\u4f60\u4e3a\u5565\u8981\u6276 \u70ed\u8bc4', '\u4e0d\u662f\u4f60\u649e\u7684\u4f60\u4e3a\u4ec0\u4e48\u8981\u6276 \u8bc4\u8bba', '\u4e0d\u662f\u4f60\u649e\u7684 \u4e3a\u5565\u8981\u6276'],
  '\u4e0d\u5b8c\u5168\u662f': ['\u4e0d\u5b8c\u5168\u662f \u70ed\u8bc4', '\u4e5f\u4e0d\u5b8c\u5168\u662f \u8bc4\u8bba', '\u4e0d\u5b8c\u5168\u662f\u8fd9\u6837 \u56de\u590d'],
  '\u4e0d\u5b66\u6570\u7406\u5316\u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd': ['\u4e0d\u5b66\u6570\u7406\u5316\u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd \u70ed\u8bc4', '\u4e0d\u5b66\u6570\u7406\u5316 \u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd', '\u751f\u6d3b\u5904\u5904\u662f\u795e\u8bdd \u8bc4\u8bba'],
  '\u4e0d\u4e89\u4e0d\u62a2\u5ab3\u5987\u513f\u5c31\u98de\u4e86': ['\u4e0d\u4e89\u4e0d\u62a2\u5ab3\u5987\u513f\u5c31\u98de\u4e86 \u70ed\u8bc4', '\u4e0d\u4e89\u4e0d\u62a2\u5ab3\u5987\u5c31\u98de\u4e86 \u8bc4\u8bba', '\u5ab3\u5987\u513f\u5c31\u98de\u4e86 \u56de\u590d'],
  '\u4e0d\u77e5\u9053ai\u5ba1\u6838': ['\u4e0d\u77e5\u9053ai\u5ba1\u6838 \u70ed\u8bc4', '\u4e0d\u77e5\u9053AI\u5ba1\u6838 \u8bc4\u8bba', 'ai\u5ba1\u6838 \u4e0d\u77e5\u9053'],
  '\u6b65\u5175': ['\u6b65\u5175 \u70ed\u8bc4', '\u6b65\u5175\u4e0d\u5982\u9a91\u5175 \u8bc4\u8bba', '\u4f60\u8fd9\u6b65\u5175 \u56de\u590d'],
  '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7': ['\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7 \u70ed\u8bc4', '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86 \u8bc4\u8bba', '\u8e29\u5230\u4f60\u5bb6\u5730\u96f7 \u56de\u590d'],
  '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86': ['\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86 \u70ed\u8bc4', '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u8e29\u4e2d\u4f60\u5bb6\u5730\u96f7 \u70ed\u8bc4'],
  '\u7b56\u5212\u4f60\u6765\u5f53': ['\u7b56\u5212\u4f60\u6765\u5f53 \u70ed\u8bc4', '\u8981\u4e0d\u7b56\u5212\u4f60\u6765\u5f53 \u8bc4\u8bba', '\u4f60\u6765\u5f53\u7b56\u5212 \u56de\u590d'],
  '\u8e6d\u6982\u5ff5': ['\u8e6d\u6982\u5ff5 \u70ed\u8bc4', '\u786c\u8e6d\u6982\u5ff5 \u8bc4\u8bba', 'AI\u6982\u5ff5 \u8e6d\u70ed\u5ea6'],
  '\u5dee\u8bc4\u8fde\u5929': ['\u5dee\u8bc4\u8fde\u5929 \u70ed\u8bc4', '\u5dee\u8bc4\u8fde\u5929 \u8bc4\u8bba', '\u4e00\u5806\u5dee\u8bc4 \u56de\u590d'],
  '\u4ea7\u51fa\u4e0d\u6613': ['\u4ea7\u51fa\u4e0d\u6613 \u70ed\u8bc4', '\u539f\u521b\u4ea7\u51fa\u4e0d\u6613 \u8bc4\u8bba', '\u4ea7\u51fa\u4e0d\u6613\u522b\u9a82 \u56de\u590d'],
  '\u7a0b\u6577\u884d': ['\u7a0b\u6577\u884d \u70ed\u8bc4', '\u7a0b\u6577\u884d\u771f\u6577\u884d \u8bc4\u8bba', '\u8fd9\u4e0d\u7a0b\u6577\u884d \u56de\u590d'],
  '\u5403\u4e0d\u5230\u8461\u8404\u8bf4\u8461\u8404\u9178': ['\u5403\u4e0d\u5230\u8461\u8404\u8bf4\u8461\u8404\u9178 \u70ed\u8bc4', '\u5403\u4e0d\u5230\u8461\u8404\u5c31\u8bf4\u8461\u8404\u9178 \u8bc4\u8bba', '\u8461\u8404\u9178 \u56de\u590d'],
  '\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86': ['\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86 \u70ed\u8bc4', '\u5403\u76f8\u4e5f\u592a\u96be\u770b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u5403\u76f8\u96be\u770b \u56de\u590d'],
  '\u4e11\u6bd4': ['\u4e11\u6bd4 \u70ed\u8bc4', '\u4e11\u6bd4 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u771f\u4e11\u6bd4 \u56de\u590d'],
  '\u81ed\u5973\u4e0d\u884c\u81ed\u7537\u53ef\u4ee5': ['\u81ed\u5973\u4e0d\u884c\u81ed\u7537\u53ef\u4ee5 \u70ed\u8bc4', '\u81ed\u5973\u4e0d\u884c\u81ed\u7537\u53ef\u4ee5 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u81ed\u7537\u53ef\u4ee5\u81ed\u5973\u4e0d\u884c \u56de\u590d'],
  '\u7eaf\u594b\u5173': ['\u7eaf\u594b\u5173 \u70ed\u8bc4', '\u7eaf\u594b\u5173 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u8fd9\u5173\u771f\u7eaf\u594b \u56de\u590d'],
  '\u7eaf\u504f\u89c1': ['\u7eaf\u504f\u89c1 \u70ed\u8bc4', '\u7eaf\u504f\u89c1 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u4f60\u8fd9\u7eaf\u504f\u89c1 \u56de\u590d'],
  '\u7eaf\u94c1\u8111\u762b': ['\u7eaf\u94c1\u8111\u762b \u70ed\u8bc4', '\u7eaf\u94c1\u8111\u762b \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u8fd9\u4e0d\u7eaf\u94c1\u8111\u762b \u56de\u590d'],
  '\u7eaf\u5c0f\u4eba': ['\u7eaf\u5c0f\u4eba \u70ed\u8bc4', '\u7eaf\u5c0f\u4eba \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u4f60\u8fd9\u7eaf\u5c0f\u4eba \u56de\u590d'],
  '\u7eaf\u763e\u5927\u7684\u6765\u4e86': ['\u7eaf\u763e\u5927\u7684\u6765\u4e86 \u70ed\u8bc4', '\u7eaf\u763e\u5927\u7684\u6765\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u763e\u5927\u7684\u6765\u4e86 \u56de\u590d'],
  '\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981': ['\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981 \u70ed\u8bc4', '\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981 \u8bc4\u8bba', '\u5982\u6b64\u91cd\u8981 \u56de\u590d'],
  '\u4ece\u5c0f\u4e11\u5230\u5927': ['\u4ece\u5c0f\u4e11\u5230\u5927 \u70ed\u8bc4', '\u4ece\u5c0f\u4e11\u5230\u5927 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u5c0f\u4e11\u5230\u5927 \u56de\u590d'],
  '\u6751\u53e3\u96c6\u5408\u6c34\u6ce5\u81ea\u5e26': ['\u6751\u53e3\u96c6\u5408\u6c34\u6ce5\u81ea\u5e26 \u70ed\u8bc4', '\u6751\u53e3\u96c6\u5408 \u6c34\u6ce5\u81ea\u5e26 \u8bc4\u8bba', '\u6c34\u6ce5\u81ea\u5e26 \u56de\u590d'],
  '\u8fbe\u7edd\u5bc6\u5168\u662f\u6302': ['\u8fbe\u7edd\u5bc6\u5168\u662f\u6302 \u70ed\u8bc4', '\u8fbe\u7edd\u5bc6 \u5168\u662f\u6302 \u8bc4\u8bba', '\u6697\u533a\u7a81\u56f4 \u5168\u662f\u6302 \u8bc4\u8bba'],
  '\u6253\u4e86\u81ea\u5df1\u7535\u8bdd': ['\u6253\u4e86\u81ea\u5df1\u7535\u8bdd \u70ed\u8bc4', '\u6253\u4e86\u81ea\u5df1\u7535\u8bdd \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u7ed9\u81ea\u5df1\u6253\u7535\u8bdd \u56de\u590d'],
  '\u6253\u6458\u6843\u5b50\u70df\u96fe\u5f39': ['\u6253\u6458\u6843\u5b50\u70df\u96fe\u5f39 \u70ed\u8bc4', '\u6253\u6458\u6843\u5b50\u70df\u96fe\u5f39 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6458\u6843\u5b50\u70df\u96fe\u5f39 \u56de\u590d'],
  '\u5927\u5927\u9634': ['\u5927\u5927\u9634 \u70ed\u8bc4', '\u5927\u5927\u9634 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u592a\u9634\u4e86 \u56de\u590d'],
  '\u5927\u8dcc\u763e': ['\u5927\u8dcc\u763e \u70ed\u8bc4', '\u5927\u7239\u763e \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u8bad\u7c89 \u51fa\u6765\u8bad\u7c89'],
  '\u5927\u529b\u91d1\u521a\u6307': ['\u5927\u529b\u91d1\u521a\u6307 \u70ed\u8bc4', '\u5927\u529b\u91d1\u521a\u6307 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u91d1\u521a\u6307 \u56de\u590d'],
  '\u5927\u540d\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053': ['\u5927\u540d\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053 \u70ed\u8bc4', '\u5927\u540d\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6ca1\u6709\u4e00\u4e2a\u4eba\u77e5\u9053 \u56de\u590d'],
  '\u5927\u610f\u4e86': ['\u5927\u610f\u4e86 \u70ed\u8bc4', '\u5927\u610f\u4e86 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u8fd9\u6ce2\u5927\u610f\u4e86 \u56de\u590d'],
  '\u5927\u610f\u4e86\u6ca1\u6709\u95ea': ['\u5927\u610f\u4e86\u6ca1\u6709\u95ea \u70ed\u8bc4', '\u5927\u610f\u4e86\u6ca1\u6709\u95ea \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u6ca1\u6709\u95ea \u56de\u590d'],
  '\u5e26\u6c9f': ['\u5e26\u6c9f \u70ed\u8bc4', '\u5e26\u6c9f \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4', '\u771f\u5e26\u6c9f \u56de\u590d'],
  '\u5355\u8d706': ['\u5355\u8d70\u4e00\u4e2a6 \u70ed\u8bc4', '\u5355\u8d706 \u70ed\u8bc4', '\u8d70\u4e00\u4e2a6 \u56de\u590d'],
  '\u5355\u8d70\u4e00\u4e2a6': ['\u5355\u8d70\u4e00\u4e2a6 \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u5355\u8d70\u4e00\u4e2a6 \u70ed\u8bc4', '\u8d70\u4e00\u4e2a6 \u56de\u590d'],
  '\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236': ['\u5f39\u5e55\u5168\u662f\u8282\u594f\u590d\u5236 \u70ed\u8bc4', '\u5e26\u8282\u594f\u5f39\u5e55 \u8bc4\u8bba\u533a', '\u5168\u662f\u590d\u5236\u5f39\u5e55 \u56de\u590d'],
  '\u5f39\u6027\u56de\u5e94': ['\u5f39\u6027\u56de\u5e94 \u70ed\u8bc4', '\u9009\u62e9\u6027\u56de\u5e94 \u8bc4\u8bba\u533a', '\u53ea\u56de\u5e94\u8fd9\u4e2a \u56de\u590d'],
  '\u86cb\u4ed4\u6d3e\u5bf9\u5168\u662f\u5c0f\u5b69\u4f60\u641e\u8fd9\u4e2a': ['\u86cb\u4ed4\u6d3e\u5bf9\u5168\u662f\u5c0f\u5b69\u4f60\u641e\u8fd9\u4e2a \u70ed\u8bc4', '\u86cb\u4ed4\u6d3e\u5bf9 \u5168\u662f\u5c0f\u5b69 \u8bc4\u8bba', '\u86cb\u4ed4\u6d3e\u5bf9 \u4f60\u641e\u8fd9\u4e2a \u56de\u590d'],
  '\u5c9b\u4e0a\u5b8c\u5168\u662f\u5e7b\u5883': ['\u5c9b\u4e0a\u5b8c\u5168\u662f\u5e7b\u5883 \u70ed\u8bc4', '\u5b8c\u5168\u662f\u5e7b\u5883 \u8bc4\u8bba\u533a', '\u7981\u95ed\u5c9b \u5e7b\u5883 \u8bc4\u8bba'],
  '\u767b\u9f3b\u5b50\u4e0a\u8138': ['\u767b\u9f3b\u5b50\u4e0a\u8138 \u70ed\u8bc4', '\u8e6c\u9f3b\u5b50\u4e0a\u8138 \u70ed\u8bc4', '\u9f3b\u5b50\u4e0a\u8138 \u56de\u590d'],
  '\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211': ['\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211 \u70ed\u8bc4', '\u7b2c\u4e00\u4e2a\u6295\u5e01 \u8bc4\u8bba\u533a', '\u6211\u7b2c\u4e00\u4e2a\u6295\u5e01 \u56de\u590d'],
  '\u7535\u952fpro': ['\u7535\u952fpro max \u70ed\u8bc4', '\u7535\u952fpro \u70ed\u8bc4', '\u7535\u952fpro max \u8bc4\u8bba'],
  '\u9876\u4f60\u7684\u80ba': ['\u9876\u4f60\u7684\u80ba \u70ed\u8bc4', '\u9876\u4f60\u7684\u80ba \u56de\u590d', '\u6211\u9876\u4f60\u7684\u80ba \u8bc4\u8bba'],
  '\u5b9a\u53eb\u4f60\u597d\u8bc4\u5982\u6f6e': ['\u5b9a\u53eb\u4f60\u597d\u8bc4\u5982\u6f6e \u70ed\u8bc4', '\u597d\u8bc4\u5982\u6f6e \u56de\u590d', '\u5b9a\u53eb\u4f60 \u597d\u8bc4\u5982\u6f6e'],
  '\u4e1c\u6d77\u6bcf\u6b21\u540c\u6846\u7edd\u5bf9\u6709\u7b11\u70b9': ['\u590f\u4e1c\u6d77 \u540c\u6846 \u7b11\u70b9 \u70ed\u8bc4', '\u4e1c\u6d77\u6bcf\u6b21\u540c\u6846\u7edd\u5bf9\u6709\u7b11\u70b9 \u70ed\u8bc4', '\u80e1\u4e00\u7edf \u590f\u4e1c\u6d77 \u70ed\u8bc4'],
  '\u4e1c\u6237\u897f\u751c': ['\u4e1c\u6237\u897f\u751c \u70ed\u8bc4', '\u6237\u6668\u98ce \u4e1c\u6237\u897f\u751c \u8bc4\u8bba', '\u4e1c\u6237\u897f\u751c \u56de\u590d'],
  '\u61c2\u7684\u90fd\u61c2': ['\u61c2\u7684\u90fd\u61c2 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4'],
  '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86': ['\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86 \u70ed\u8bc4', '\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86 \u56de\u590d', '\u8ba9\u4f60\u9ad8\u5b8c\u4e86 \u8bc4\u8bba'],
  '\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684': ['\u90fd\u662f\u4eba\u673a\u81ea\u52a8\u53d1\u7684 \u70ed\u8bc4', '\u4eba\u673a\u81ea\u52a8\u53d1 \u8bc4\u8bba', '\u90fd\u662f\u673a\u5668\u4eba \u70ed\u8bc4'],
  '\u5bf9\u51b2\u5947\u624d': ['\u5bf9\u51b2\u5947\u624d \u70ed\u8bc4', '\u5bf9\u51b2\u5947\u624d \u56de\u590d', '\u5bf9\u51b2\u5947\u624d \u8bc4\u8bba'],
  '\u591a\u5c11\u6709\u70b9\u5c0f\u4e11': ['\u591a\u5c11\u6709\u70b9\u5c0f\u4e11 \u70ed\u8bc4', '\u6709\u70b9\u5c0f\u4e11 \u56de\u590d', '\u591a\u5c11\u6709\u70b9\u5c0f\u4e11 \u8bc4\u8bba'],
  '\u6076\u81ed\u6897': ['\u6076\u81ed\u6897 \u70ed\u8bc4', '\u73a9\u6076\u81ed\u6897 \u8bc4\u8bba', '\u6076\u81ed\u6897 \u56de\u590d'],
  '\u53d1\u56fe': ['\u53d1\u56fe \u622a\u56fe \u56de\u590d', '\u53d1\u56fe \u70ed\u8bc4', '\u622a\u56fe\u5462 \u56de\u590d'],
  '\u53d1\u73b0\u5168\u662f\u7f3a': ['\u53d1\u73b0\u5168\u662f\u7f3a \u70ed\u8bc4', '\u67e5\u6f0f \u5168\u662f\u7f3a \u8bc4\u8bba', '\u5168\u662f\u7f3a \u56de\u590d'],
  '\u9632\u6760\u6211\u5148\u8bf4': ['\u9632\u6760\u6211\u5148\u8bf4 \u70ed\u8bc4', '\u9632\u6760\u6211\u5148\u8bf4 \u8bc4\u8bba', '\u9632\u6760 \u6211\u5148\u8bf4'],
  '\u653eppt': ['\u653ePPT\u4e00\u6837 \u70ed\u8bc4', '\u653ePPT \u8bc4\u8bba', '\u8ddf\u653ePPT\u4e00\u6837'],
  '\u975e\u5e38\u70c2': ['\u975e\u5e38\u70c2 \u70ed\u8bc4', '\u771f\u7684\u975e\u5e38\u70c2 \u8bc4\u8bba', '\u975e\u5e38\u70c2 \u56de\u590d'],
  '\u80a5\u7f8e\u5976\u9f99': ['\u80a5\u7f8e\u5976\u9f99 \u70ed\u8bc4', '\u80a5\u7f8e\u5976\u9f99 \u8bc4\u8bba', '\u5976\u9f99 \u80a5\u7f8e'],
  '\u80ba\u7269': ['\u592a\u80ba\u7269\u4e86 \u70ed\u8bc4', '\u80ba\u7269 \u70ed\u8bc4', '\u80ba\u7269 \u8bc4\u8bba'],
  '\u5206\u8d43\u4e0d\u5747': ['\u5206\u8d43\u4e0d\u5747 \u70ed\u8bc4', '\u5206\u8d43\u4e0d\u5747 \u8bc4\u8bba', '\u8bf4\u6210\u5206\u8d43\u4e0d\u5747'],
  '\u798f\u745e\u63a7': ['furry\u63a7 \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4', '\u798f\u745e\u63a7 \u70ed\u8bc4', 'furry\u63a7 \u8bc4\u8bba', '\u798f\u745e\u63a7 \u8bc4\u8bba'],
};
const TERM_TOPIC_CONTEXTS = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u8bc1\u636e', '\u79d1\u666e', '\u6d4b\u8bc4'],
  '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97': ['\u8bc1\u636e', '\u79d1\u666e', '\u6d4b\u8bc4'],
  '\u8fd9\u4e5f\u53eb\u8bc1\u636e': ['\u8bc1\u636e', '\u8f9f\u8c23', '\u8bc4\u8bba\u533a'],
  '\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', '\u7279\u65af\u62c9', '\u65b0\u80fd\u6e90\u8f66', '\u96f7\u519b', 'SU7', '\u8f66\u5708'],
  '\u96f7\u519b\u7c89\u4e1d': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u8f66\u5708'],
  '\u7c73\u7c89\u63a7\u8bc4': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u5c0f\u7c73\u6c34\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u6ca1\u6709\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', '\u7279\u65af\u62c9', '\u65b0\u80fd\u6e90\u8f66', '\u96f7\u519b', 'SU7'],
  '\u54ea\u6709\u4ec0\u4e48\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66', 'SU7', '\u96f7\u519b'],
  '\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8', '\u5143\u5b87\u5b99', '\u533a\u5757\u94fe'],
  'AI\u6982\u5ff5': ['AI', '\u79d1\u6280\u516c\u53f8', '\u4eba\u5de5\u667a\u80fd'],
  '\u8c01\u662f\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8', '\u5143\u5b87\u5b99'],
  '\u8c01\u5728\u8e6d\u6982\u5ff5': ['AI', '\u6e38\u620f', '\u79d1\u6280\u516c\u53f8'],
  '\u8c01\u5728\u8e6dAI': ['AI', '\u79d1\u6280\u516c\u53f8', '\u4eba\u5de5\u667a\u80fd'],
  '\u7cbe\u795e\u5916\u56fd\u4eba': ['\u56fd\u9645\u653f\u6cbb', '\u65f6\u653f', '\u7559\u5b66', '\u4e2d\u7f8e', '\u56fd\u5916'],
  '\u7cbe\u5916': ['\u56fd\u9645\u653f\u6cbb', '\u65f6\u653f', '\u4e2d\u7f8e'],
  '\u6211\u8bf4\u91cd\u4e86': ['\u76f4\u64ad\u5207\u7247', '\u66f4\u6b63', '\u9053\u6b49'],
  '\u8bf4\u9519\u4e86': ['\u66f4\u6b63', '\u76f4\u64ad\u5207\u7247', '\u6536\u56de'],
  '\u95ee\u9a6c\u65af\u514b\u672c\u4eba': ['\u7279\u65af\u62c9', '\u5c0f\u7c73\u6c7d\u8f66', '\u8bbf\u8c08'],
  '\u95ee\u9a6c\u65af\u514b': ['\u7279\u65af\u62c9', '\u8bbf\u8c08', '\u9a6c\u65af\u514b\u91c7\u8bbf'],
  '\u9001\u4e0a\u53bb': ['\u8bc4\u8bba\u533a', '\u56de\u590d', '\u7f6e\u9876'],
  '\u9876\u4e0a\u53bb': ['\u8bc4\u8bba\u533a', '\u56de\u590d', '\u7f6e\u9876'],
  '\u6d3b\u4e0d\u8fc7\u4e24\u4e2a\u6708': ['\u8282\u594f', '\u70ed\u8bc4', '\u56de\u590d\u533a'],
  '\u54ea\u513f\u90fd\u6709\u4f60': ['\u70ed\u8bc4', '\u56de\u590d\u533a', '\u8bc4\u8bba\u533a'],
  '\u574f\u7b11': ['\u5f39\u5e55', '\u8868\u60c5', '\u70ed\u8bc4'],
  '\u8d85\u7ea7\u597d\u7528': ['\u8f6f\u4ef6', '\u5de5\u5177', '\u63d2\u4ef6', 'APP'],
  '\u8d85\u597d\u7528': ['\u8f6f\u4ef6', '\u5de5\u5177', '\u63d2\u4ef6', 'APP'],
  '\u51fa\u5904': ['\u6c42\u51fa\u5904', '\u539f\u6587', '\u94fe\u63a5', '\u8bc1\u636e'],
  '\u6c42\u51fa\u5904': ['\u539f\u6587', '\u94fe\u63a5', '\u8bc1\u636e', '\u8bc4\u8bba'],
  '\u963f\u7f8e\u8389\u5361': ['\u56fd\u9645\u653f\u6cbb', '\u4e2d\u7f8e', '\u7f8e\u56fd', '\u65f6\u653f'],
  '\u963f\u7f8e\u5229\u5361': ['\u56fd\u9645\u653f\u6cbb', '\u4e2d\u7f8e', '\u7f8e\u56fd', '\u65f6\u653f'],
  '\u7f8e\u5229\u575a': ['\u56fd\u9645\u653f\u6cbb', '\u4e2d\u7f8e', '\u7f8e\u56fd', '\u65f6\u653f'],
  '\u4e0d\u4e00\u4e00': ['\u56de\u590d\u533a', '\u8bc4\u8bba\u533a', '\u76f4\u64ad\u5207\u7247'],
  '\u4e0d\u4e00\u4e00\u8bc4\u4ef7': ['\u56de\u590d\u533a', '\u8bc4\u8bba\u533a', '\u76f4\u64ad\u5207\u7247'],
  '\u5927\u9b54\u6cd5\u5e08': ['\u4e8c\u6b21\u5143', '\u5b85\u7537', '\u6897', '\u8bc4\u8bba\u533a'],
  '\u9b54\u6cd5\u5e08': ['\u4e8c\u6b21\u5143', '\u5b85\u7537', '\u6897', '\u8bc4\u8bba\u533a'],
  '\u5730\u56fe\u70ae': ['\u5730\u57df\u9ed1', '\u7fa4\u4f53\u653b\u51fb', '\u6e38\u620f\u8282\u594f', '\u8bc4\u8bba\u533a'],
  '\u5f00\u5730\u56fe\u70ae': ['\u5730\u57df\u9ed1', '\u7fa4\u4f53\u653b\u51fb', '\u6e38\u620f\u8282\u594f', '\u8bc4\u8bba\u533a'],
  '\u4eba\u673a\u81ea\u52a8\u53d1': ['\u6c34\u519b', '\u63a7\u8bc4', '\u673a\u5668\u4eba', '\u8bc4\u8bba\u533a'],
  '\u90fd\u662f\u673a\u5668\u4eba': ['\u6c34\u519b', '\u63a7\u8bc4', '\u673a\u5668\u4eba', '\u8bc4\u8bba\u533a'],
};
const TERM_PRECISION_QUERIES = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u4e0d\u4f1a\u771f\u6709\u4eba \u8bc1\u636e \u56de\u590d', '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97 \u8bc1\u636e', '\u8fd9\u4e5f\u53eb\u8bc1\u636e \u8bc4\u8bba'],
  '\u8f66\u5bb6\u519b': ['\u5c0f\u7c73\u6c7d\u8f66 \u8f66\u5bb6\u519b \u63a7\u8bc4', '\u96f7\u519b \u8f66\u5bb6\u519b \u70ed\u8bc4', '\u7c73\u7c89\u63a7\u8bc4 SU7', '\u5c0f\u7c73\u6c34\u519b \u63a7\u8bc4'],
  '\u8e6d\u6982\u5ff5': ['\u8e6d\u6982\u5ff5\u662f\u8c01 AI', '\u8c01\u5728\u8e6d\u6982\u5ff5 AI', '\u786c\u8e6dAI\u6982\u5ff5', '\u8e6d\u6982\u5ff5 \u6e38\u620f\u516c\u53f8'],
  '\u51fa\u5904': ['\u6c42\u51fa\u5904 \u8bc4\u8bba\u533a', '\u6709\u51fa\u5904\u5417 \u70ed\u8bc4', '\u539f\u6587\u51fa\u5904 \u94fe\u63a5 \u8bc4\u8bba'],
  '\u963f\u7f8e\u8389\u5361': ['\u963f\u7f8e\u5229\u5361 \u56fd\u9645\u653f\u6cbb \u8bc4\u8bba', '\u7f8e\u5229\u575a \u4e2d\u7f8e \u70ed\u8bc4', '\u6f02\u4eae\u56fd \u65f6\u653f \u8bc4\u8bba\u533a'],
  '\u5730\u56fe\u70ae': ['\u5f00\u5730\u56fe\u70ae \u8bc4\u8bba', '\u5730\u57df\u9ed1 \u70ed\u8bc4', '\u5730\u57df\u70ae \u8bc4\u8bba\u533a'],
};
const TERM_NEGATIVE_FEEDBACK_QUERIES = {
  '\u4e0d\u4f1a\u771f\u6709\u4eba': ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u539f\u8bdd', '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97\u5427 \u8bc4\u8bba', '\u8fd9\u53eb\u8bc1\u636e\u5427 \u4e0d\u4f1a\u771f\u6709\u4eba'],
  '\u8f66\u5bb6\u519b': ['\u8f66\u5bb6\u519b \u5c0f\u7c73SU7 \u8bc4\u8bba\u533a', '\u6ca1\u6709\u8f66\u5bb6\u519b \u5c0f\u7c73SU7', '\u8f66\u5bb6\u519b \u96f7\u519b \u539f\u8bdd'],
  '\u8e6d\u6982\u5ff5': ['\u8c01\u662f\u8e6d\u6982\u5ff5 \u539f\u8bdd', '\u8c01\u662f\u8e6d\u6982\u5ff5 \u8bc4\u8bba', '\u8e6d\u6982\u5ff5\u662f\u8c01 \u539f\u8bdd'],
};

function asPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function unique(items) {
  return [...new Set(items.map((item) => String(item || '').trim()).filter(Boolean))];
}

function escapeJsonUnicode(json) {
  return json.replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function evidenceCount(entry) {
  return Math.max(0, Number(entry?.evidenceCount) || 0);
}

function hasEvidenceSource(entry) {
  return evidenceCount(entry) > 0 && Array.isArray(entry?.evidenceSources) && entry.evidenceSources.length > 0;
}

function isVideoContextEvidenceSource(source = {}) {
  const sample = String(source?.sample || '').trim();
  const sourceText = String(source?.source || '').trim();
  return sample.startsWith('Bilibili video context:') || sample.startsWith('Bilibili public video title:') || sourceText.includes('search-discovered video context');
}

function hasNonContextEvidenceSample(entry) {
  return (entry?.evidenceSamples || []).some((sample) => {
    const sampleText = String(sample || '').trim();
    return sampleText && !sampleText.startsWith('Bilibili video context:') && !sampleText.startsWith('Bilibili public video title:');
  });
}

function hasBilibiliCommentScanSource(entry) {
  return (entry?.evidenceSources || []).some((source) => {
    const sourceText = String(source?.source || '').trim();
    return sourceText.startsWith('Bilibili public ') && sourceText.includes('comment scan');
  });
}

function isCommentBackedSampleText(sample) {
  const sampleText = String(sample || '').trim();
  return sampleText && !sampleText.startsWith('Bilibili video context:') && !sampleText.startsWith('Bilibili public video title:');
}

function hasCoverageEvidenceSource(entry, options = {}) {
  if (!hasEvidenceSource(entry)) return false;
  if (options.requireCommentBackedEvidence !== true) return true;
  return (
    (entry.evidenceSources || []).some((source) => !isVideoContextEvidenceSource(source)) ||
    (hasNonContextEvidenceSample(entry) && hasBilibiliCommentScanSource(entry))
  );
}

function commentBackedEvidenceCount(entry) {
  const rawCount = evidenceCount(entry);
  if (rawCount === 0) return 0;
  const commentSamples = new Set();
  for (const source of entry?.evidenceSources || []) {
    const sample = String(source?.sample || '').trim();
    if (sample && !isVideoContextEvidenceSource(source) && isCommentBackedSampleText(sample)) commentSamples.add(sample);
  }
  if (hasBilibiliCommentScanSource(entry)) {
    for (const sample of entry?.evidenceSamples || []) {
      const sampleText = String(sample || '').trim();
      if (isCommentBackedSampleText(sampleText)) commentSamples.add(sampleText);
    }
  }
  return Math.min(rawCount, commentSamples.size);
}

function coverageEvidenceCount(entry, options = {}) {
  if (options.requireCommentBackedEvidence === true) return commentBackedEvidenceCount(entry);
  return evidenceCount(entry);
}

function requiresCoverageEvidenceSource(options = {}) {
  return options.requireSourceBackedEvidence === true || options.requireCommentBackedEvidence === true;
}

function termAttemptKey(term) {
  return Buffer.from(String(term || ''), 'utf8').toString('base64url');
}

function getTermAttempt(termAttempts, term) {
  if (!termAttempts || typeof termAttempts !== 'object') return null;
  return termAttempts[termAttemptKey(term)] || termAttempts[term] || null;
}

function parseTemplateList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeQueryText(query) {
  const seen = new Set();
  return String(query || '')
    .trim()
    .split(/\s+/)
    .filter((token) => {
      if (!token || seen.has(token)) return false;
      seen.add(token);
      return true;
    })
    .join(' ');
}

function renderQueryTemplate(template, term, family) {
  return normalizeQueryText(String(template || '').replaceAll('{term}', term).replaceAll('{family}', family));
}

function queryTemplatesFromOptions(options = {}) {
  const extraTemplates = parseTemplateList(options.extraQueryTemplates);
  const exhaustedTemplates =
    options.includeExhaustedFallbackTemplates === false ? [] : parseTemplateList(options.exhaustedSuggestionTemplates || DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES);
  return [
    ...TERM_QUERY_TEMPLATES.map((template) => ({ template, builtIn: true })),
    ...extraTemplates.map((template) => ({ template: (term, family) => renderQueryTemplate(template, term, family), builtIn: false })),
    ...exhaustedTemplates.map((template) => ({ template: (term, family) => renderQueryTemplate(template, term, family), builtIn: false })),
  ];
}

function controversyQueriesForPlanItem(planItem = {}, options = {}) {
  const term = String(planItem?.term || '').trim();
  if (!term || String(options.discoveryMode || '').trim().toLowerCase() !== 'controversial') return options.controversyQueries;
  const baseQueries = parseTemplateList(options.controversyQueries);
  const family = String(planItem?.family || '').trim();
  const termQueries = TERM_CONTROVERSY_QUERY_TEMPLATES.map((template) => renderQueryTemplate(template, term, family));
  return unique([...termQueries, ...baseQueries]);
}

function searchTermsForTerm(term) {
  const cleanTerm = String(term || '').trim();
  const configuredAliases = TERM_SEARCH_ALIASES[cleanTerm] || [];
  const generatedAliases = generatedSearchAliasesForTerm(cleanTerm, { suppressColloquial: configuredAliases.length > 0 });
  const aliases = unique([...configuredAliases, ...generatedAliases]);
  return ALIAS_FIRST_SEARCH_TERMS.has(cleanTerm) || generatedAliases.length > 0 ? unique([...aliases, cleanTerm]) : unique([cleanTerm, ...aliases]);
}

function generatedSearchAliasesForTerm(term, options = {}) {
  const clean = String(term || '').trim();
  const aliases = [];
  const percentMatch = clean.match(/^(100|100%|\u767e\u5206\u767e|\u767e\u5206\u4e4b\u767e)(.+)$/);
  if (percentMatch) {
    const tail = percentMatch[2];
    aliases.push(`100%${tail}`, `\u767e\u5206\u767e${tail}`, `\u767e\u5206\u4e4b\u767e${tail}`);
    if (tail.endsWith('\u7387')) aliases.push(`100%${tail.slice(0, -1)}`, `\u767e\u5206\u767e${tail.slice(0, -1)}`);
    else aliases.push(`100%${tail}\u7387`, `\u767e\u5206\u767e${tail}\u7387`);
  }
  if (/^\u7b2c\u4e00\u4e2a\u6295\u5e01\u80af\u5b9a\u662f\u6211\u7684?$/.test(clean)) {
    aliases.push('\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u9996\u4e2a\u6295\u5e01', '\u6211\u7b2c\u4e00\u4e2a\u6295\u5e01', '\u6295\u5e01\u80af\u5b9a\u662f\u6211');
  }
  aliases.push(...generatedUniversalQuantifierSearchAliases(clean));
  if (/^\u7edd\u5bf9(?!\u53ef\u4ee5)/u.test(clean)) {
    const tail = clean.replace(/^\u7edd\u5bf9(?:\u7684)?/u, '');
    if (tail && tail.length >= 2 && !VAGUE_ABSOLUTE_TAIL_ALIASES.has(tail)) aliases.push(tail);
  }
  if (/^(\u6839\u672c\u6ca1\u6709|\u7edd\u5bf9|\u80af\u5b9a|\u5168\u662f|\u5168\u90fd|\u5168\u90fd\u662f|\u6beb\u65e0|\u6ca1\u6709\u4e00\u4e2a|\u6ca1\u540a|\u6ca1\u5185\u5473)/.test(clean)) {
    aliases.push(...generatedChineseTailSearchAliases(clean));
  }
  if (clean.startsWith('\u6beb\u65e0')) {
    const tail = clean.slice(2);
    aliases.push(`\u6ca1${tail}`, `\u6ca1\u6709${tail}`);
  }
  if (clean.startsWith('\u6ca1\u540a\u7528')) aliases.push('\u6beb\u65e0\u540a\u7528');
  if (clean.startsWith('\u7f57\u795e\u4f1f\u5927')) aliases.push('\u7f57\u795e\u4f1f\u5927\u65e0\u9700\u591a\u8a00', '\u7f57\u795e\u4f1f\u5927 \u65e0\u9700\u591a\u8a00');
  if (!options.suppressColloquial && isChineseColloquialSearchAliasCandidate(clean)) aliases.push(...generatedColloquialSearchAliases(clean));
  aliases.push(...generatedFixedCommentSuffixSearchAliases(clean));
  return unique(aliases.filter((alias) => alias && alias !== clean));
}

function isChineseColloquialSearchAliasCandidate(clean) {
  return /^[\u4e00-\u9fa5]+$/.test(clean) && /^(?:\u8e29\u4e2d|\u9f3b\u5c4e|\u5403\u4e86|\u5403\u76f8|\u6401\u8fd9|\u9ad8\u5b8c)/.test(clean);
}

function generatedChineseTailSearchAliases(clean) {
  const aliases = [];
  const shortTails = ['\u5440', '\u554a', '\u5427', '\u5462', '\u561b'];
  for (const suffix of shortTails) {
    if (clean.endsWith(suffix) && clean.length > suffix.length + 2) aliases.push(clean.slice(0, -suffix.length));
  }
  if (clean.endsWith('\u7684') && clean.length > 3) aliases.push(clean.slice(0, -1));
  if (clean.endsWith('\u4e86') && clean.length > 3) aliases.push(clean.slice(0, -1));
  if (clean.endsWith('\u4e00\u4e0b') && clean.length > 4) aliases.push(clean.slice(0, -2));
  else if (clean.startsWith('\u7edd\u5bf9\u53ef\u4ee5')) aliases.push(`${clean}\u4e00\u4e0b`);
  return aliases;
}

function generatedUniversalQuantifierSearchAliases(clean) {
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

function generatedColloquialSearchAliases(clean) {
  const aliases = [];
  if (clean.startsWith('\u9f3b\u5c4e')) aliases.push(`\u628a${clean}`);
  if (clean.startsWith('\u5403\u4e86')) aliases.push(`\u903c\u6211${clean}`, `\u8ba9\u6211${clean}`);
  if (clean === '\u5403\u76f8\u592a\u96be\u770b') aliases.push('\u5403\u76f8\u4e5f\u592a\u96be\u770b\u4e86', '\u5403\u76f8\u96be\u770b');
  if (clean === '\u6401\u8fd9\u5462') aliases.push('\u6401\u8fd9\u6401\u8fd9\u5462', '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462');
  if (clean === '\u9ad8\u5b8c\u4e86') aliases.push('\u90fd\u8ba9\u4f60\u9ad8\u5b8c\u4e86');
  if (clean.length >= 4) {
    for (const suffix of ['\u554a', '\u5427', '\u5462', '\u561b', '\u5457']) {
      if (clean.endsWith(suffix)) aliases.push(clean.slice(0, -suffix.length));
    }
    if (clean.endsWith('\u4e86') && clean.length > 4) aliases.push(clean.slice(0, -1));
    else aliases.push(`${clean}\u4e86`);
  }
  return aliases;
}

function generatedFixedCommentSuffixSearchAliases(clean) {
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

function isCompactMetricSearchTerm(term) {
  return /^[0-9]+(?:\.[0-9]+)?(?:[wW\u4e07kK\u79d2sSrR][0-9]*(?:\.[0-9]+)?)?$/.test(String(term || '').trim());
}

function coveragePriorityPenalty(item = {}) {
  const term = String(item.term || '').trim();
  if (!term) return 0;
  if (isCompactMetricSearchTerm(term)) return 3;
  if (/^[A-Za-z0-9]+$/.test(term) && /\d/.test(term)) return 2;
  return 0;
}

function contextualQueriesForTerm(term) {
  return unique(
    searchTermsForTerm(term).flatMap((searchTerm) => {
      const contexts = TERM_TOPIC_CONTEXTS[searchTerm] || [];
      return contexts.flatMap((context) => [
        normalizeQueryText(`${searchTerm} ${context} \u8bc4\u8bba\u533a`),
        normalizeQueryText(`${context} ${searchTerm} \u70ed\u8bc4`),
      ]);
    }),
  );
}

function hasSharedSearchAlias(termA, termB) {
  const aliasesA = new Set(searchTermsForTerm(termA));
  return searchTermsForTerm(termB).some((term) => aliasesA.has(term));
}

function isRelatedContainedPhrase(entry, term, family, meaning = '') {
  const entryTerm = String(entry?.term || '').trim();
  const entryMeaning = String(entry?.meaning || '').trim();
  return (
    entryTerm &&
    entryTerm !== term &&
    String(entry?.family || '').trim() === family &&
    meaning &&
    entryMeaning === meaning &&
    /\p{Script=Han}/u.test(entryTerm) &&
    /\p{Script=Han}/u.test(term) &&
    (entryTerm.includes(term) || term.includes(entryTerm))
  );
}

function relatedTargetExistingTerms(dictionary, planItem, options = {}) {
  const term = String(planItem?.term || '').trim();
  if (!term) return [];
  const family = String(planItem?.family || '').trim();
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 100);
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const meaning = String(planItem?.meaning || entries.find((entry) => String(entry?.term || '').trim() === term)?.meaning || '').trim();
  return unique(
    entries
      .filter((entry) => {
        const entryTerm = String(entry?.term || '').trim();
        if (!entryTerm) return false;
        if (family && String(entry?.family || '').trim() !== family) return false;
        if (
          coverageEvidenceCount(entry, options) >= targetEvidence &&
          !(requiresCoverageEvidenceSource(options) && evidenceCount(entry) > 0 && !hasCoverageEvidenceSource(entry, options))
        ) {
          return false;
        }
        return entryTerm === term || hasSharedSearchAlias(term, entryTerm) || isRelatedContainedPhrase(entry, term, family, meaning);
      })
      .map((entry) => entry.term),
  ).slice(0, 8);
}

function queryVariantCountForTerm(term, options = {}) {
  return queryTemplatesFromOptions(options).length * searchTermsForTerm(term).length + contextualQueriesForTerm(term).length + (TERM_PRIORITY_QUERIES[String(term || '').trim()] || []).length;
}

function queryVariantsForTerm(term, family, limit = TERM_QUERY_TEMPLATES.length, options = {}) {
  const variants = [];
  const templateItems = queryTemplatesFromOptions(options);
  const baseSearchTerms = searchTermsForTerm(term);
  const extraSearchTerms = Array.isArray(options.searchTerms) ? options.searchTerms : [];
  const searchTerms =
    options.onlySearchTerms === true
      ? unique(extraSearchTerms)
      : options.preferSearchTerms === true
        ? unique([...extraSearchTerms, ...baseSearchTerms])
        : unique([...baseSearchTerms, ...extraSearchTerms]);
  const pushManualVariant = (query, builtIn = true) => {
    variants.push({
      query: normalizeQueryText(query),
      variantIndex: variants.length,
      builtIn,
    });
  };
  const pushTemplateVariant = (item, searchTerm) => {
    variants.push({
      query: normalizeQueryText(item.template(searchTerm, family)),
      variantIndex: variants.length,
      builtIn: item.builtIn,
    });
  };
  for (const query of TERM_PRIORITY_QUERIES[String(term || '').trim()] || []) {
    pushManualVariant(query);
  }
  if (options.preferShortCommentVariants === true && String(term || '').trim()) {
    const cleanTerm = String(term).trim();
    pushManualVariant(`${cleanTerm} \u8bc4\u8bba\u533a`);
    pushManualVariant(`${cleanTerm} \u70ed\u8bc4`);
  }
  for (const searchTerm of searchTerms.filter(isCompactMetricSearchTerm)) {
    pushManualVariant(searchTerm);
    pushManualVariant(`${searchTerm} \u70ed\u8bc4`);
    pushManualVariant(`${searchTerm} \u8bc4\u8bba\u533a`);
  }
  const [primaryTemplate, commentTemplate, ...laterTemplates] = templateItems;
  const shouldInterleaveCommentTemplate = Boolean(
    primaryTemplate && commentTemplate && options.interleaveAliasCommentVariants === true && ALIAS_FIRST_SEARCH_TERMS.has(String(term || '').trim()),
  );
  if (primaryTemplate) {
    for (const searchTerm of searchTerms) {
      pushTemplateVariant(primaryTemplate, searchTerm);
      if (shouldInterleaveCommentTemplate) pushTemplateVariant(commentTemplate, searchTerm);
    }
  }
  for (const query of contextualQueriesForTerm(term)) {
    variants.push({
      query,
      variantIndex: variants.length,
      builtIn: true,
    });
  }
  const remainingTemplates = shouldInterleaveCommentTemplate ? laterTemplates : [commentTemplate, ...laterTemplates].filter(Boolean);
  for (const item of remainingTemplates) {
    for (const searchTerm of searchTerms) {
      variants.push({
        query: item.template(searchTerm, family),
        variantIndex: variants.length,
        builtIn: item.builtIn,
      });
    }
  }
  return unique(variants.map((item) => item.query))
    .map((query) => variants.find((item) => item.query === query))
    .slice(0, limit);
}

function isCommentEvidenceQuery(query) {
  return /评论|热评|回复|互动|控评|节奏|粉丝|弹幕/.test(String(query || ''));
}

function relatedContainedSearchTerms(entries, entry) {
  const term = String(entry?.term || '').trim();
  const family = String(entry?.family || '').trim();
  const meaning = String(entry?.meaning || '').trim();
  if (!term || !meaning || !/\p{Script=Han}/u.test(term)) return [];
  const allowLongerAnchor = term.length <= 3;
  return unique(
    entries
      .filter((candidate) => {
        const candidateTerm = String(candidate?.term || '').trim();
        const isShorterAnchor = candidateTerm.length < term.length && term.includes(candidateTerm);
        const isLongerAnchor = allowLongerAnchor && candidateTerm.length > term.length && candidateTerm.includes(term);
        return (
          candidateTerm &&
          candidateTerm !== term &&
          /\p{Script=Han}/u.test(candidateTerm) &&
          (isShorterAnchor || isLongerAnchor) &&
          String(candidate?.family || '').trim() === family &&
          String(candidate?.meaning || '').trim() === meaning
        );
      })
      .sort((a, b) => String(a.term || '').length - String(b.term || '').length)
      .map((candidate) => candidate.term),
  ).slice(0, 4);
}

function recommendationGroupForEntry(entries, entry) {
  const relatedTerms = relatedContainedSearchTerms(entries, entry);
  return recommendationGroupForTerm(relatedTerms[0] || entry?.term);
}

function attemptedVariantQueries(attempt, options = {}) {
  const requireCurrentStrategyVersion = options.requireCurrentStrategyVersion === true;
  const assumeLegacyQueriesCurrent = options.assumeLegacyQueriesCurrent === true;
  return new Set(
    (attempt?.queries || [])
      .filter(
        (item) =>
          !requireCurrentStrategyVersion ||
          item.hit === true ||
          Number(item.strategyVersion || 0) >= HARVEST_STRATEGY_VERSION ||
          (assumeLegacyQueriesCurrent && !Number(item.strategyVersion || 0)),
      )
      .map((item) => item.query)
      .filter(Boolean),
  );
}

function isTermAttemptExhausted(term, family, attempt, options = {}) {
  if (!attempt || effectiveSuccessfulAttempts(attempt) > 0) return false;
  const triedQueries = attemptedVariantQueries(attempt);
  if (triedQueries.size === 0) return false;
  return queryVariantsForTerm(term, family, queryVariantCountForTerm(term, options), options).every((item) => triedQueries.has(item.query));
}

function effectiveSuccessfulAttempts(attempt) {
  const successfulAttempts = Math.max(0, Number(attempt?.successfulAttempts) || 0);
  if (successfulAttempts === 0) return 0;
  const hasLastEvidenceCount = Object.prototype.hasOwnProperty.call(attempt || {}, 'lastEvidenceCount');
  if (!hasLastEvidenceCount) return successfulAttempts;
  const evidenceAtPlanTime = Math.max(0, Number(attempt?.evidenceAtPlanTime) || 0);
  const lastEvidenceCount = Math.max(0, Number(attempt?.lastEvidenceCount) || 0);
  if (lastEvidenceCount === evidenceAtPlanTime) return 0;
  return successfulAttempts;
}

function isRepeatedlyMissedAttempt(attempt, threshold = 3) {
  return (
    attempt &&
    Math.max(0, Number(attempt.attempts) || 0) >= Math.max(1, Number(threshold) || 1) &&
    effectiveSuccessfulAttempts(attempt) === 0
  );
}

function isHardMissedZeroEvidenceAttempt(attempt, threshold = 3) {
  const retryThreshold = Math.max(1, Number(threshold) || 1);
  const evidenceAtPlanTime = Math.max(0, Number(attempt?.evidenceAtPlanTime) || 0);
  const lastEvidenceCount = Math.max(0, Number(attempt?.lastEvidenceCount) || 0);
  return isRepeatedlyMissedAttempt(attempt, retryThreshold) && Math.max(0, Number(attempt?.attempts) || 0) >= retryThreshold * 2 && evidenceAtPlanTime === 0 && lastEvidenceCount === 0;
}

function isHardMissedPlanItem(planItem, termAttempts, retryBeforeUnattemptedLimit) {
  if (!planItem?.term) return false;
  return isHardMissedZeroEvidenceAttempt(getTermAttempt(termAttempts, planItem.term), retryBeforeUnattemptedLimit);
}

function selectHarvestPlan(candidatePlan, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const defaultHardMissedQueries = Math.max(2, Math.ceil(maxQueries / 2));
  const maxHardMissedQueries = Math.max(0, Number(options.maxHardMissedQueries ?? defaultHardMissedQueries) || 0);
  const termAttempts = options.termAttempts && typeof options.termAttempts === 'object' ? options.termAttempts : {};
  const searchedQuerySet = options.searchedQuerySet instanceof Set ? options.searchedQuerySet : new Set();
  const skipSeen = options.skipSeen !== false;
  const selected = [];
  const selectedHardMissedTerms = new Set();
  const selectedGroups = new Set();
  const selectedQueries = new Set();
  const trySelect = (item, enforceNewGroup) => {
    if (selected.length >= maxQueries) return;
    const query = String(item?.query || '').trim();
    const term = String(item?.term || '').trim();
    const group = String(item?.recommendationGroup || (term ? recommendationGroupForTerm(term) : '')).trim();
    const hardMissed = isHardMissedPlanItem(item, termAttempts, options.retryBeforeUnattemptedLimit);
    const canRetrySeenPriority = hardMissed && item?.source === 'priority';
    if (!query || selectedQueries.has(query) || (skipSeen && searchedQuerySet.has(query) && !canRetrySeenPriority)) return;
    if (enforceNewGroup && group && selectedGroups.has(group)) return;
    const hardMissedTerm = term;
    if (hardMissed && !selectedHardMissedTerms.has(hardMissedTerm) && selectedHardMissedTerms.size >= maxHardMissedQueries) return;
    if (hardMissed && selectedHardMissedTerms.has(hardMissedTerm)) return;
    selected.push(item);
    selectedQueries.add(query);
    if (group) selectedGroups.add(group);
    if (hardMissed && hardMissedTerm) selectedHardMissedTerms.add(hardMissedTerm);
  };
  for (const item of candidatePlan) {
    trySelect(item, true);
    if (selected.length >= maxQueries) break;
  }
  for (const item of candidatePlan) {
    trySelect(item, false);
    if (selected.length >= maxQueries) break;
  }
  return selected;
}

function sortEntriesForCoverage(entries) {
  return [...entries].sort(
    (a, b) =>
      coveragePriorityPenalty(a) - coveragePriorityPenalty(b) ||
      evidenceCount(a) - evidenceCount(b) ||
      String(a.term || '').localeCompare(String(b.term || '')),
  );
}

function coverageActionRank(action) {
  return (
    {
      retry_with_new_variant: 0,
      harvest: 1,
      refresh_source_metadata: 2,
      harvest_more_evidence: 3,
      add_query_template: 4,
      none: 9,
    }[action] ?? 8
  );
}

function actionSortRank(action, options = {}) {
  const baseRank = coverageActionRank(action?.action);
  const priorityPenalty = coveragePriorityPenalty(action);
  const retryLimit = Math.max(0, Number(options.retryBeforeUnattemptedLimit ?? 3) || 0);
  const attempts = Math.max(0, Number(action?.attempts) || 0);
  const successfulAttempts = Math.max(0, Number(action?.successfulAttempts) || 0);
  const evidence = Math.max(0, Number(action?.evidenceCount) || 0);
  const currentCommentMisses = Math.max(0, Number(action?.currentCommentMisses) || 0);
  const noVideoDiscoveryMiss =
    action?.action === 'retry_with_new_variant' &&
    attempts > 0 &&
    successfulAttempts === 0 &&
    currentCommentMisses === 0 &&
    /No Bilibili videos were discovered/u.test(String(action?.lastError || ''));
  const timeoutDiscoveryMiss =
    action?.action === 'retry_with_new_variant' &&
    attempts > 0 &&
    successfulAttempts === 0 &&
    /(?:timed out after|Operation timed out)/iu.test(String(action?.lastError || ''));
  if (noVideoDiscoveryMiss && retryLimit > 0 && attempts >= retryLimit) {
    return coverageActionRank('harvest') + 0.5 + priorityPenalty;
  }
  if (timeoutDiscoveryMiss && retryLimit > 0 && attempts >= retryLimit) {
    return coverageActionRank('harvest_more_evidence') + 0.5 + priorityPenalty;
  }
  if (
    options.prioritizeHardZeroEvidence === true &&
    action?.action === 'retry_with_new_variant' &&
    retryLimit > 0 &&
    attempts >= retryLimit * 2 &&
    successfulAttempts === 0 &&
    evidence === 0 &&
    currentCommentMisses === 0
  ) {
    return coverageActionRank('harvest') - 0.5 + priorityPenalty;
  }
  if (options.prioritizeSourceGaps === true && action?.action === 'refresh_source_metadata') {
    if (currentCommentMisses > 0) {
      return (
        (successfulAttempts > 0 ? coverageActionRank('harvest') + 0.75 : coverageActionRank('retry_with_new_variant') + 0.75) +
        priorityPenalty
      );
    }
    return coverageActionRank('retry_with_new_variant') - 0.25 + priorityPenalty;
  }
  if (noVideoDiscoveryMiss) {
    return coverageActionRank('harvest') - 0.25 + priorityPenalty;
  }
  if (action?.action === 'retry_with_new_variant' && retryLimit > 0 && attempts >= retryLimit) {
    return coverageActionRank('harvest') + 0.5 + priorityPenalty;
  }
  return baseRank + priorityPenalty;
}

function sameRecommendationGroupSort(actionA = {}, actionB = {}) {
  const groupA = String(actionA?.recommendationGroup || '').trim();
  const groupB = String(actionB?.recommendationGroup || '').trim();
  if (!groupA || groupA !== groupB) return 0;
  const termA = String(actionA?.term || '').trim();
  const termB = String(actionB?.term || '').trim();
  const aIsGroup = termA === groupA ? 0 : 1;
  const bIsGroup = termB === groupB ? 0 : 1;
  return aIsGroup - bIsGroup || termA.length - termB.length;
}

function recommendationGroupForTerm(term) {
  const clean = String(term || '').trim();
  if (clean.startsWith('\u4e0d\u4f1a\u771f\u6709\u4eba')) return '\u4e0d\u4f1a\u771f\u6709\u4eba';
  if (clean.includes('\u4ece\u826f')) return '\u4ece\u826f';
  if (clean.startsWith('\u7231\u548b\u548b')) return '\u7231\u548b\u548b\u5730';
  if (clean.includes('\u4eae\u8840\u6761')) return '\u4eae\u8840\u6761';
  if (clean.includes('\u6485\u9192')) return '\u6485\u9192';
  if (clean.includes('\u8f66\u8f71\u8f98')) return '\u8f66\u8f71\u8f98';
  if (clean.includes('\u8f66\u5bb6\u519b')) return '\u8f66\u5bb6\u519b';
  if (clean.includes('\u8e6d\u6982\u5ff5')) return '\u8e6d\u6982\u5ff5';
  if (clean.includes('\u5927\u8c61\u611f\u5192\u4e86')) return '\u5927\u8c61\u611f\u5192\u4e86';
  if (clean === '\u7cbe\u795e\u5916\u56fd\u4eba' || clean === '\u7cbe\u5916') return '\u7cbe\u795e\u5916\u56fd\u4eba';
  return clean;
}

function precisionQueriesForTerm(term) {
  return TERM_PRECISION_QUERIES[recommendationGroupForTerm(term)] || [];
}

function negativeFeedbackQueriesForTerm(term) {
  return TERM_NEGATIVE_FEEDBACK_QUERIES[recommendationGroupForTerm(term)] || [];
}

function exactFeedbackQueriesForTerm(term) {
  const cleanTerm = String(term || '').trim();
  return unique(
    [
      ...(TERM_PRIORITY_QUERIES[cleanTerm] || []),
      ...searchTermsForTerm(cleanTerm).flatMap((searchTerm) => [
        `${searchTerm} \u8bc4\u8bba\u533a`,
        `${searchTerm} \u70ed\u8bc4`,
        `${searchTerm} \u56de\u590d`,
        `${searchTerm} \u5f39\u5e55`,
        searchTerm,
      ]),
    ],
  ).slice(0, 16);
}

function sourceRefreshQueriesForTerm(term) {
  const cleanTerm = String(term || '').trim();
  return unique([
    `${cleanTerm} \u8bc4\u8bba\u533a`,
    `${cleanTerm} \u70ed\u8bc4`,
    `${cleanTerm} \u56de\u590d`,
    `${cleanTerm} \u5f39\u5e55`,
    ...exactFeedbackQueriesForTerm(cleanTerm),
  ]).slice(0, 16);
}

function bareFeedbackQueriesForTerm(term) {
  return unique(searchTermsForTerm(term)).slice(0, 16);
}

function usesTriedBareSearchQuery(query, term, triedQueries = new Set()) {
  const cleanQuery = normalizeQueryText(query);
  return searchTermsForTerm(term).some((searchTerm) => cleanQuery !== searchTerm && cleanQuery.startsWith(`${searchTerm} `) && triedQueries.has(searchTerm));
}

function flattenQueryDiagnostics(runs = []) {
  return runs.flatMap((run) => (Array.isArray(run?.queryDiagnostics) ? run.queryDiagnostics.flat() : []));
}

function isFilteredSearchContextMiss(item = {}) {
  const accepted = Array.isArray(item?.acceptedTerms) ? item.acceptedTerms.map((target) => String(target || '').trim()).filter(Boolean) : [];
  const discoveredVideos = Math.max(0, Number(item?.discoveredVideos) || 0);
  const discoveryContextVideos = Math.max(0, Number(item?.discoveryContextVideos) || 0);
  return accepted.length === 0 && discoveredVideos === 0 && discoveryContextVideos > 0;
}

function hasFilteredSearchContextFeedback(state = {}, term) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return false;
  return flattenQueryDiagnostics(state.runs || []).some((item) => {
    const targets = Array.isArray(item?.targetExistingTerms) ? item.targetExistingTerms.map((target) => String(target || '').trim()) : [];
    return targets.includes(cleanTerm) && isFilteredSearchContextMiss(item);
  });
}

function hasIrrelevantQueryFeedback(state = {}, term) {
  const cleanTerm = String(term || '').trim();
  if (!cleanTerm) return false;
  return flattenQueryDiagnostics(state.runs || []).some((item) => {
    const targets = Array.isArray(item?.targetExistingTerms) ? item.targetExistingTerms.map((target) => String(target || '').trim()) : [];
    const accepted = Array.isArray(item?.acceptedTerms) ? item.acceptedTerms.map((target) => String(target || '').trim()).filter(Boolean) : [];
    const commentsCollected = Math.max(0, Number(item?.commentsCollected) || 0);
    const trainingTextChars = Math.max(0, Number(item?.trainingTextChars) || 0);
    return (
      targets.includes(cleanTerm) &&
      !accepted.includes(cleanTerm) &&
      (commentsCollected > 0 || trainingTextChars > 0 || isFilteredSearchContextMiss(item))
    );
  });
}

function currentStrategyCommentMisses(attempt) {
  return (attempt?.queries || []).filter(
    (query) =>
      Number(query?.strategyVersion || 0) >= HARVEST_STRATEGY_VERSION &&
      query?.ok !== false &&
      Boolean(query?.hit) === false &&
      (Math.max(0, Number(query?.comments) || 0) > 0 || Math.max(0, Number(query?.videos) || 0) > 0),
  ).length;
}

function diversifyCoverageActions(actions, limit) {
  const selected = [];
  const selectedGroups = new Set();
  const push = (item, enforceNewGroup) => {
    if (!item || selected.length >= limit || selected.includes(item)) return;
    const group = item.recommendationGroup || recommendationGroupForTerm(item.term);
    if (enforceNewGroup && group && selectedGroups.has(group)) return;
    selected.push(item);
    if (group) selectedGroups.add(group);
  };
  for (const item of actions) push(item, true);
  for (const item of actions) push(item, false);
  return selected;
}

function priorityPlanFromCoverageActions(priorityQueries, actionMap) {
  const actions = [...actionMap.values()];
  const providedTargetsByQuery = new Map();
  for (const priorityItem of priorityQueries) {
    if (!priorityItem || typeof priorityItem !== 'object' || Array.isArray(priorityItem)) continue;
    const query = String(priorityItem.nextQuery || priorityItem.query || '').trim();
    const term = String(priorityItem.term || '').trim();
    if (!query || !term) continue;
    providedTargetsByQuery.set(query, unique([...(providedTargetsByQuery.get(query) || []), term]));
  }
  return priorityQueries.map((priorityItem) => {
    const providedAction = priorityItem && typeof priorityItem === 'object' && !Array.isArray(priorityItem) ? priorityItem : null;
    const cleanQuery = String(providedAction?.nextQuery || providedAction?.query || priorityItem || '').trim();
    const matchedActions = actions.filter(
      (action) =>
        action.nextQuery === cleanQuery ||
        (Array.isArray(action.suggestedQueries) && action.suggestedQueries.includes(cleanQuery)) ||
        queryVariantsForTerm(action.term, action.family, queryVariantCountForTerm(action.term), {}).some((variant) => variant.query === cleanQuery) ||
        exactFeedbackQueriesForTerm(action.term).includes(cleanQuery) ||
        precisionQueriesForTerm(action.term).includes(cleanQuery) ||
        negativeFeedbackQueriesForTerm(action.term).includes(cleanQuery),
    );
    const matchedAction = matchedActions[0] || null;
    const action = providedAction ? { ...(matchedAction || {}), ...providedAction } : matchedAction;
    if (!action) return { query: cleanQuery, source: 'priority' };
    const targetExistingTerms = unique([
      ...matchedActions.map((item) => item.term),
      ...(providedTargetsByQuery.get(cleanQuery) || []),
      action.term,
    ]);
    return {
      query: cleanQuery,
      source: 'priority',
      term: action.term,
      family: action.family,
      evidenceCount: action.evidenceCount,
      sourcedEvidence: action.sourcedEvidence,
      recommendationGroup: action.recommendationGroup,
      priorAttempts: action.attempts,
      priorSuccessfulAttempts: action.successfulAttempts,
      ...(targetExistingTerms.length > 1 ? { targetExistingTerms } : {}),
      variantIndex: null,
      builtInVariant: true,
      previouslyTried: false,
    };
  });
}

export function buildKeywordHarvestQueryPlan(dictionary, options = {}) {
  const maxQueries = asPositiveInt(options.maxQueries, 12, 10000);
  const priorityQueries = Array.isArray(options.priorityQueries) ? options.priorityQueries : parseTemplateList(options.priorityQueries);
  const seedQueries = unique(options.seedQueries || DEFAULT_SEED_QUERIES);
  const coverageMode = String(options.coverageMode || 'balanced').trim().toLowerCase();
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const requireSourceBackedEvidence = requiresCoverageEvidenceSource(options);
  const allEntries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const termAttempts = options.termAttempts && typeof options.termAttempts === 'object' ? options.termAttempts : {};
  const actionMap = new Map(
    buildCoverageActions(dictionary, { ...options.state, termAttempts }, { ...options, targetEvidence }).map((item) => [item.term, item]),
  );
  const entries =
    coverageMode === 'all-weak'
      ? allEntries
          .filter((entry) => coverageEvidenceCount(entry, options) < targetEvidence || (requireSourceBackedEvidence && evidenceCount(entry) > 0 && !hasCoverageEvidenceSource(entry, options)))
          .sort((a, b) => {
            const actionA = actionMap.get(String(a.term || '').trim());
            const actionB = actionMap.get(String(b.term || '').trim());
            return (
              actionSortRank(actionA, options) - actionSortRank(actionB, options) ||
              Math.max(0, targetEvidence - coverageEvidenceCount(a, options)) - Math.max(0, targetEvidence - coverageEvidenceCount(b, options)) ||
              sameRecommendationGroupSort(actionA, actionB) ||
              String(a.term || '').localeCompare(String(b.term || ''))
            );
          })
      : allEntries;
  const familyCounts = new Map();
  const dictionaryPlan = [];
  const variantsPerTerm = asPositiveInt(options.queryVariantsPerTerm, 2, Number.MAX_SAFE_INTEGER);

  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const count = familyCounts.get(family) || 0;
    if (coverageMode !== 'all-weak' && count >= asPositiveInt(options.termsPerFamily, 4, 20)) continue;
    familyCounts.set(family, count + 1);
    const attempt = getTermAttempt(termAttempts, term);
    const attempts = Math.max(0, Number(attempt?.attempts) || 0);
    const successfulAttempts = effectiveSuccessfulAttempts(attempt);
    if (coverageMode === 'all-weak' && isTermAttemptExhausted(term, family, attempt, options)) continue;
    const triedQueries = attemptedVariantQueries(attempt);
    const adaptiveVariantsPerTerm =
      coverageMode === 'all-weak' && attempts > 0 && successfulAttempts === 0
        ? Math.min(queryVariantCountForTerm(term, options), Math.max(variantsPerTerm, attempts + variantsPerTerm))
        : variantsPerTerm;
    const variants = queryVariantsForTerm(term, family, adaptiveVariantsPerTerm, options);
    const orderedVariants = coverageMode === 'all-weak' ? [...variants.filter((item) => !triedQueries.has(item.query)), ...variants.filter((item) => triedQueries.has(item.query))] : variants;
    for (const variant of orderedVariants) {
      dictionaryPlan.push({
        query: variant.query,
        source: 'dictionary',
        term,
        family,
        evidenceCount: evidenceCount(entry),
        sourcedEvidence: hasCoverageEvidenceSource(entry, options),
        recommendationGroup: actionMap.get(term)?.recommendationGroup || recommendationGroupForEntry(allEntries, entry),
        priorAttempts: attempts,
        priorSuccessfulAttempts: successfulAttempts,
        variantIndex: variant.variantIndex,
        builtInVariant: variant.builtIn,
        previouslyTried: triedQueries.has(variant.query),
      });
    }
  }

  const seedPlan = seedQueries.map((query) => ({ query, source: 'seed' }));
  const priorityPlan = priorityPlanFromCoverageActions(priorityQueries, actionMap);
  const orderedPlan =
    coverageMode === 'all-weak'
      ? [...priorityPlan, ...dictionaryPlan, ...seedPlan]
      : [...priorityPlan, ...seedPlan, ...dictionaryPlan];
  const seenQueries = new Set();
  const plan = [];
  for (const item of orderedPlan) {
    const query = String(item.query || '').trim();
    if (!query || seenQueries.has(query)) continue;
    seenQueries.add(query);
    plan.push({ ...item, query });
    if (plan.length >= maxQueries) break;
  }
  return plan;
}

export function buildKeywordHarvestQueries(dictionary, options = {}) {
  return buildKeywordHarvestQueryPlan(dictionary, options).map((item) => item.query);
}

export const DEFAULT_HARVEST_STATE_PATH = join(process.cwd(), 'server', 'keywordHarvestState.json');

export async function readKeywordHarvestState(statePath = DEFAULT_HARVEST_STATE_PATH) {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return {
      version: state.version || 1,
      harvestStrategyVersion: Math.max(0, Number(state.harvestStrategyVersion) || 0),
      updatedAt: state.updatedAt || null,
      searchedQueries: Array.isArray(state.searchedQueries) ? state.searchedQueries : [],
      scannedBvids: Array.isArray(state.scannedBvids) ? state.scannedBvids : [],
      termAttempts: state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {},
      runs: Array.isArray(state.runs) ? state.runs : [],
    };
  } catch {
    return { version: 1, harvestStrategyVersion: 0, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] };
  }
}

async function writeKeywordHarvestState(state, statePath = DEFAULT_HARVEST_STATE_PATH) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${escapeJsonUnicode(JSON.stringify(state, null, 2))}\n`, 'utf8');
}

export function summarizeDictionaryGrowth(before, after) {
  const beforeEntries = Array.isArray(before?.entries) ? before.entries : [];
  const afterEntries = Array.isArray(after?.entries) ? after.entries : [];
  const beforeTerms = new Set(beforeEntries.map((entry) => entry.term).filter(Boolean));
  const afterTerms = new Set(afterEntries.map((entry) => entry.term).filter(Boolean));
  const newTerms = afterEntries.filter((entry) => entry.term && !beforeTerms.has(entry.term));
  const families = {};
  for (const entry of afterEntries) {
    const family = entry.family || 'unknown';
    families[family] = (families[family] || 0) + 1;
  }
  return {
    before: beforeTerms.size,
    after: afterTerms.size,
    added: Math.max(0, afterTerms.size - beforeTerms.size),
    newTerms,
    families,
    duplicates: afterEntries.length - afterTerms.size,
  };
}

function dictionaryRestrictedToTerms(dictionary = {}, allowedTerms = new Set()) {
  if (!(allowedTerms instanceof Set) || allowedTerms.size === 0) return dictionary;
  return {
    ...dictionary,
    entries: (Array.isArray(dictionary?.entries) ? dictionary.entries : []).filter((entry) => allowedTerms.has(String(entry?.term || '').trim())),
  };
}

export function summarizeEvidenceCoverage(dictionary, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const totalEvidence = entries.reduce((sum, entry) => sum + coverageEvidenceCount(entry, options), 0);
  const weakEntries = entries.filter((entry) => coverageEvidenceCount(entry, options) < targetEvidence);
  const zeroEvidence = entries.filter((entry) => coverageEvidenceCount(entry, options) === 0);
  const sourcedEvidence = entries.filter((entry) => hasCoverageEvidenceSource(entry, options));
  const unsourcedEvidence = entries.filter((entry) => evidenceCount(entry) > 0 && !hasCoverageEvidenceSource(entry, options));
  const evidenceDeficit = weakEntries.reduce((sum, entry) => sum + Math.max(0, targetEvidence - coverageEvidenceCount(entry, options)), 0);
  const byFamily = {};
  for (const entry of entries) {
    const family = entry.family || 'unknown';
    const count = coverageEvidenceCount(entry, options);
    if (!byFamily[family]) byFamily[family] = { terms: 0, evidence: 0, weak: 0, zero: 0, sourced: 0 };
    byFamily[family].terms += 1;
    byFamily[family].evidence += count;
    if (count < targetEvidence) byFamily[family].weak += 1;
    if (count === 0) byFamily[family].zero += 1;
    if (hasCoverageEvidenceSource(entry, options)) byFamily[family].sourced += 1;
  }
  return {
    complete: weakEntries.length === 0,
    targetEvidence,
    terms: entries.length,
    totalEvidence,
    averageEvidence: entries.length ? Number((totalEvidence / entries.length).toFixed(2)) : 0,
    coverageRatio: entries.length ? Number(((entries.length - weakEntries.length) / entries.length).toFixed(4)) : 1,
    evidenceDeficit,
    sourcedEvidenceTerms: sourcedEvidence.length,
    sourceCoverageRatio: entries.length ? Number((sourcedEvidence.length / entries.length).toFixed(4)) : 1,
    unsourcedEvidenceTerms: unsourcedEvidence.length,
    weakTerms: weakEntries.length,
    zeroEvidenceTerms: zeroEvidence.length,
    weakSamples: sortEntriesForCoverage(weakEntries).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
      coverageEvidenceCount: coverageEvidenceCount(entry, options),
    })),
    zeroEvidenceSamples: sortEntriesForCoverage(zeroEvidence).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
    })),
    unsourcedEvidenceSamples: sortEntriesForCoverage(unsourcedEvidence).slice(0, 20).map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
      coverageEvidenceCount: coverageEvidenceCount(entry, options),
    })),
    byFamily,
  };
}

function suggestedQueriesForExhaustedTerm(term, family, attempt, options = {}) {
  const triedQueries = attemptedVariantQueries(attempt);
  const templates = parseTemplateList(options.exhaustedSuggestionTemplates || DEFAULT_EXHAUSTED_SUGGESTION_TEMPLATES);
  return unique(templates.map((template) => renderQueryTemplate(template, term, family)))
    .filter((query) => query && !triedQueries.has(query))
    .slice(0, 8);
}

function hasCurrentHarvestStrategyState(state = {}) {
  return (
    !Object.prototype.hasOwnProperty.call(state, 'harvestStrategyVersion') ||
    Number(state.harvestStrategyVersion || 0) >= HARVEST_STRATEGY_VERSION
  );
}

export function summarizeTermAttempts(state = {}, dictionary = {}, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const attempts = hasCurrentHarvestStrategyState(state) && state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {};
  const attemptedTerms = Object.values(attempts).filter((item) => Number(item?.attempts) > 0);
  const successfulTerms = attemptedTerms.filter((item) => effectiveSuccessfulAttempts(item) > 0);
  const entryTerms = new Set(entries.map((entry) => String(entry.term || '').trim()).filter(Boolean));
  const unattemptedTerms = entries
    .filter((entry) => entry.term && !getTermAttempt(attempts, entry.term))
    .map((entry) => ({
      term: entry.term,
      family: entry.family,
      evidenceCount: evidenceCount(entry),
    }));
  const repeatedlyMissedTerms = attemptedTerms
    .filter((item) => effectiveSuccessfulAttempts(item) === 0)
    .sort((a, b) => Number(b.attempts) - Number(a.attempts) || String(a.term || '').localeCompare(String(b.term || '')))
    .slice(0, 20)
    .map((item) => ({
      term: item.term,
      family: item.family,
      attempts: Number(item.attempts) || 0,
      lastQuery: item.lastQuery || '',
      lastError: item.lastError || '',
    }));
  const exhaustedTerms = entries
    .map((entry) => {
      const term = String(entry.term || '').trim();
      const family = entry.family || 'attack';
      const attempt = getTermAttempt(attempts, term);
      return { entry, attempt, term, family };
    })
    .filter((item) => item.term && isTermAttemptExhausted(item.term, item.family, item.attempt, options))
    .sort((a, b) => evidenceCount(a.entry) - evidenceCount(b.entry) || String(a.term).localeCompare(String(b.term)))
    .slice(0, 20)
    .map((item) => ({
      term: item.term,
      family: item.family,
      evidenceCount: evidenceCount(item.entry),
      attempts: Number(item.attempt?.attempts) || 0,
      variantsTried: queryTemplatesFromOptions(options).length,
      lastQuery: item.attempt?.lastQuery || '',
      lastError: item.attempt?.lastError || '',
      suggestedQueries: suggestedQueriesForExhaustedTerm(item.term, item.family, item.attempt, options),
    }));
  return {
    attemptedTerms: attemptedTerms.filter((item) => entryTerms.has(item.term)).length,
    successfulTerms: successfulTerms.filter((item) => entryTerms.has(item.term)).length,
    unattemptedTerms: unattemptedTerms.length,
    unattemptedSamples: sortEntriesForCoverage(unattemptedTerms).slice(0, 20),
    repeatedlyMissedTerms,
    exhaustedTerms: exhaustedTerms.length,
    exhaustedSamples: exhaustedTerms,
  };
}

export function buildCoverageActions(dictionary = {}, state = {}, options = {}) {
  const entries = sortEntriesForCoverage(Array.isArray(dictionary?.entries) ? dictionary.entries : []);
  const stateStrategyIsCurrent = hasCurrentHarvestStrategyState(state);
  const attempts = stateStrategyIsCurrent && state.termAttempts && typeof state.termAttempts === 'object' ? state.termAttempts : {};
  const searchedQueries = new Set(stateStrategyIsCurrent && Array.isArray(state.searchedQueries) ? state.searchedQueries : []);
  const assumeLegacyQueriesCurrent = stateStrategyIsCurrent;
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  return entries.map((entry) => {
    const term = String(entry.term || '').trim();
    const family = entry.family || 'attack';
    const attempt = getTermAttempt(attempts, term);
    const count = evidenceCount(entry);
    const coverageCount = coverageEvidenceCount(entry, options);
    const exhausted = isTermAttemptExhausted(term, family, attempt, options);
    const successfulAttempts = effectiveSuccessfulAttempts(attempt);
    const attemptsCount = Number(attempt?.attempts) || 0;
    const currentStrategyTriedQueries = attemptedVariantQueries(attempt, {
      requireCurrentStrategyVersion: true,
      assumeLegacyQueriesCurrent,
    });
    const triedQueries = new Set([...attemptedVariantQueries(attempt), ...searchedQueries]);
    const templateLimit = queryTemplatesFromOptions(options).length;
    const ownVariants = queryVariantsForTerm(term, family, templateLimit, {
      ...options,
      interleaveAliasCommentVariants: attemptsCount > 0 && successfulAttempts === 0,
      preferShortCommentVariants: options.requireCommentBackedEvidence === true && attemptsCount === 0,
    });
    const relatedSearchTerms = relatedContainedSearchTerms(entries, entry).filter((relatedTerm) => {
      const cleanRelatedTerm = String(relatedTerm || '').trim();
      const relatedAttempt = getTermAttempt(attempts, cleanRelatedTerm);
      const relatedMissed =
        relatedAttempt &&
        Math.max(0, Number(relatedAttempt.attempts) || 0) > 0 &&
        effectiveSuccessfulAttempts(relatedAttempt) === 0;
      return !(cleanRelatedTerm.length < term.length && (relatedMissed || hasIrrelevantQueryFeedback(state, cleanRelatedTerm)));
    });
    const hasUntriedOwnVariant = ownVariants.some((variant) => !triedQueries.has(variant.query));
    const relatedAnchorAlreadyTried = relatedSearchTerms.some((relatedTerm) => {
      const [firstRelatedVariant] = queryVariantsForTerm(relatedTerm, family, 1, options);
      return firstRelatedVariant && triedQueries.has(firstRelatedVariant.query);
    });
    const preferRelatedSearchTerms =
      attemptsCount > 0 && successfulAttempts === 0 && relatedSearchTerms.length > 0 && !(hasUntriedOwnVariant && relatedAnchorAlreadyTried);
    const availableVariants = preferRelatedSearchTerms ? queryVariantsForTerm(term, family, templateLimit, {
      ...options,
      interleaveAliasCommentVariants: attemptsCount > 0 && successfulAttempts === 0,
      searchTerms: relatedSearchTerms,
      preferSearchTerms: preferRelatedSearchTerms,
      onlySearchTerms: preferRelatedSearchTerms,
    }) : ownVariants;
    const hardMissedZeroEvidence = isHardMissedZeroEvidenceAttempt(attempt, options.retryBeforeUnattemptedLimit);
    const irrelevantFeedback = hasIrrelevantQueryFeedback(state, term);
    const filteredSearchContextFeedback = hasFilteredSearchContextFeedback(state, term);
    const missedWithIrrelevantFeedback = attemptsCount > 0 && successfulAttempts === 0 && irrelevantFeedback;
    const needsSourceRefresh =
      requiresCoverageEvidenceSource(options) && count > 0 && !hasCoverageEvidenceSource(entry, options);
    const feedbackQuery =
      !needsSourceRefresh && hardMissedZeroEvidence && irrelevantFeedback
        ? negativeFeedbackQueriesForTerm(term).find((query) => !triedQueries.has(query))
        : '';
    const exactFeedbackQuery =
      !needsSourceRefresh && missedWithIrrelevantFeedback
        ? (filteredSearchContextFeedback ? bareFeedbackQueriesForTerm(term) : exactFeedbackQueriesForTerm(term)).find(
            (query) => !currentStrategyTriedQueries.has(query) && !usesTriedBareSearchQuery(query, term, currentStrategyTriedQueries),
          )
        : '';
    const precisionQuery = !needsSourceRefresh && hardMissedZeroEvidence ? precisionQueriesForTerm(term).find((query) => !triedQueries.has(query)) : '';
    const relatedRetryVariant = preferRelatedSearchTerms ? availableVariants.find((variant) => !triedQueries.has(variant.query)) : null;
    const sourceRefreshExactQuery =
      needsSourceRefresh && options.requireCommentBackedEvidence === true
        ? sourceRefreshQueriesForTerm(term).find(
            (query) => !triedQueries.has(query) && !usesTriedBareSearchQuery(query, term, triedQueries) && isCommentEvidenceQuery(query),
          )
        : '';
    const sourceRefreshVariant =
      needsSourceRefresh && options.requireCommentBackedEvidence === true
        ? availableVariants.find((variant) => !triedQueries.has(variant.query) && isCommentEvidenceQuery(variant.query))
        : null;
    const nextVariant =
      (sourceRefreshExactQuery ? { query: sourceRefreshExactQuery, variantIndex: null, builtIn: false } : null) ||
      sourceRefreshVariant ||
      (feedbackQuery ? { query: feedbackQuery, variantIndex: null, builtIn: false } : null) ||
      relatedRetryVariant ||
      (exactFeedbackQuery ? { query: exactFeedbackQuery, variantIndex: null, builtIn: false } : null) ||
      (precisionQuery ? { query: precisionQuery, variantIndex: null, builtIn: false } : null) ||
      (needsSourceRefresh && options.requireCommentBackedEvidence === true
        ? null
        : availableVariants.find((variant) => !triedQueries.has(variant.query))) ||
      null;
    let status = 'covered';
    let action = 'none';
    if (needsSourceRefresh) {
      status = 'source_gap';
      action = nextVariant ? 'refresh_source_metadata' : 'add_query_template';
    } else if (coverageCount < targetEvidence && exhausted) {
      status = 'exhausted';
      action = 'add_query_template';
    } else if (coverageCount < targetEvidence && attemptsCount === 0) {
      status = 'weak_unattempted';
      action = 'harvest';
    } else if (coverageCount < targetEvidence && successfulAttempts === 0) {
      status = 'weak_missed';
      action = nextVariant ? 'retry_with_new_variant' : 'add_query_template';
    } else if (coverageCount < targetEvidence) {
      status = 'weak_partial';
      action = 'harvest_more_evidence';
    }
    return {
      term,
      family,
      status,
      action,
      evidenceCount: count,
      coverageEvidenceCount: coverageCount,
      sourcedEvidence: hasCoverageEvidenceSource(entry, options),
      recommendationGroup: recommendationGroupForEntry(entries, entry),
      targetEvidence,
      evidenceNeeded: Math.max(0, targetEvidence - coverageCount),
      attempts: attemptsCount,
      successfulAttempts,
      currentCommentMisses: currentStrategyCommentMisses(attempt),
      exhausted,
      nextQuery: nextVariant?.query || '',
      suggestedQueries: exhausted ? suggestedQueriesForExhaustedTerm(term, family, attempt, options) : [],
      lastQuery: attempt?.lastQuery || '',
      lastError: attempt?.lastError || '',
    };
  });
}

export function buildDictionaryCoverageAudit(dictionary = {}, state = {}, options = {}) {
  const targetEvidence = asPositiveInt(options.targetEvidence, 3, 1000);
  const maxActions = asPositiveInt(options.maxActions, 20, 1000);
  const minCoverageRatio = Math.min(1, Math.max(0, Number(options.minCoverageRatio ?? 1)));
  const requireComplete = options.requireComplete !== false;
  const requireSourceBackedEvidence = requiresCoverageEvidenceSource(options);
  const coverage = summarizeEvidenceCoverage(dictionary, {
    targetEvidence,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence === true,
  });
  const termAttemptSummary = summarizeTermAttempts(state, dictionary, options);
  const coverageActions = buildCoverageActions(dictionary, state, options);
  const actionSummary = coverageActions.reduce((summary, item) => {
    summary[item.action] = (summary[item.action] || 0) + 1;
    return summary;
  }, {});
  const sortedActions = coverageActions
    .filter((item) => item.action !== 'none')
    .sort(
      (a, b) =>
        actionSortRank(a, { ...options, prioritizeHardZeroEvidence: true, prioritizeSourceGaps: true }) -
          actionSortRank(b, { ...options, prioritizeHardZeroEvidence: true, prioritizeSourceGaps: true }) ||
        a.evidenceNeeded - b.evidenceNeeded ||
        sameRecommendationGroupSort(a, b) ||
        String(a.term || '').localeCompare(String(b.term || '')),
    );
  const nextActions = diversifyCoverageActions(sortedActions, maxActions);
  const recommendedQueries = unique(
    nextActions.flatMap((item) => [item.nextQuery, ...(Array.isArray(item.suggestedQueries) ? item.suggestedQueries : [])]),
  ).slice(0, maxActions);
  const familyGaps = Object.entries(coverage.byFamily || {})
    .map(([family, item]) => ({
      family,
      terms: item.terms,
      weak: item.weak,
      zero: item.zero,
      evidence: item.evidence,
      coverageRatio: item.terms ? Number(((item.terms - item.weak) / item.terms).toFixed(4)) : 1,
    }))
    .sort((a, b) => b.weak - a.weak || b.zero - a.zero || a.family.localeCompare(b.family));
  const failureReasons = [];
  if (coverage.coverageRatio < minCoverageRatio) {
    failureReasons.push(`coverage ratio ${coverage.coverageRatio} is below ${minCoverageRatio}`);
  }
  if (requireComplete && !coverage.complete) {
    failureReasons.push(`${coverage.weakTerms} term(s) are below ${targetEvidence} evidence hit(s)`);
  }
  if (requireSourceBackedEvidence && coverage.unsourcedEvidenceTerms > 0) {
    failureReasons.push(
      options.requireCommentBackedEvidence === true
        ? `${coverage.unsourcedEvidenceTerms} evidence-backed term(s) are missing Bilibili comment evidence`
        : `${coverage.unsourcedEvidenceTerms} evidence-backed term(s) are missing Bilibili source metadata`,
    );
  }
  if (termAttemptSummary.exhaustedTerms > 0) {
    failureReasons.push(`${termAttemptSummary.exhaustedTerms} exhausted term(s) need extra query templates`);
  }
  return {
    ok: failureReasons.length === 0,
    generatedAt: new Date().toISOString(),
    targetEvidence,
    minCoverageRatio,
    requireComplete,
    requireSourceBackedEvidence,
    coverage,
    termAttemptSummary,
    actionSummary,
    familyGaps,
    nextActions,
    recommendedQueries,
    failureReasons,
  };
}

function summarizeCoverageProgress(beforeCoverage, afterCoverage) {
  return {
    weakTermsResolved: Math.max(0, (beforeCoverage?.weakTerms || 0) - (afterCoverage?.weakTerms || 0)),
    zeroEvidenceResolved: Math.max(0, (beforeCoverage?.zeroEvidenceTerms || 0) - (afterCoverage?.zeroEvidenceTerms || 0)),
    evidenceGained: Math.max(0, (afterCoverage?.totalEvidence || 0) - (beforeCoverage?.totalEvidence || 0)),
    evidenceDeficitReduced: Math.max(0, (beforeCoverage?.evidenceDeficit || 0) - (afterCoverage?.evidenceDeficit || 0)),
  };
}

function zeroCoverageProgress() {
  return {
    weakTermsResolved: 0,
    zeroEvidenceResolved: 0,
    evidenceGained: 0,
    evidenceDeficitReduced: 0,
  };
}

function findResultDictionaryEntry(result, term) {
  return (Array.isArray(result?.dictionary?.entries) ? result.dictionary.entries : []).find((entry) => String(entry?.term || '').trim() === term);
}

function hasHarvestEvidenceProgress(results = [], beforeDictionary = {}, options = {}) {
  const beforeEntries = new Map((Array.isArray(beforeDictionary?.entries) ? beforeDictionary.entries : []).map((entry) => [String(entry?.term || '').trim(), entry]));
  return results.some((item) => {
    const result = item?.result || {};
    if (!result.ok) return false;
    if (countAcceptedEvidenceHits(result.entries || []) > 0) return true;
    if (countAcceptedEvidenceHits(result.keywordTraining?.dictionaryEvidenceEntries || []) > 0) return true;
    const targets = Array.isArray(result.collectionDiagnostics?.targetExistingTerms) ? result.collectionDiagnostics.targetExistingTerms : [];
    return targets.some((target) => {
      const term = String(target || '').trim();
      if (!term) return false;
      const beforeEntry = beforeEntries.get(term);
      const afterEntry = findResultDictionaryEntry(result, term);
      return coverageEvidenceCount(afterEntry, options) > coverageEvidenceCount(beforeEntry, options);
    });
  });
}

async function withTimeout(promise, timeoutMs, message, controller = null) {
  const ms = Math.max(0, Number(timeoutMs) || 0);
  if (!ms) return promise;
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          if (controller && !controller.signal.aborted) controller.abort();
          reject(new Error(message || `Operation timed out after ${ms}ms`));
        }, ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function countAcceptedEvidenceHits(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((sum, entry) => {
    const samples = new Set();
    for (const sample of entry?.evidenceSamples || []) {
      const clean = String(sample || '').trim();
      if (clean) samples.add(clean);
    }
    for (const source of entry?.evidenceSources || []) {
      const clean = String(source?.sample || '').trim();
      if (clean) samples.add(clean);
    }
    return sum + (samples.size || Math.max(0, Number(entry?.evidenceCount) || 0));
  }, 0);
}

function summarizeTrainingDiagnostics(results = []) {
  const diagnostics = {
    deepseekCalls: 0,
    fallbackCalls: 0,
    evidenceRejected: 0,
    dictionaryEvidenceTerms: 0,
    dictionaryEvidenceCount: 0,
    generatedTerms: 0,
  };
  for (const item of results) {
    const training = item?.result?.keywordTraining;
    if (!training) continue;
    if (training.available && training.keyConfigured) diagnostics.deepseekCalls += 1;
    if (training.usedFallback) diagnostics.fallbackCalls += 1;
    diagnostics.evidenceRejected += Math.max(0, Number(training.evidenceRejected) || 0);
    const dictionaryEvidenceEntries = Array.isArray(training.dictionaryEvidenceEntries) ? training.dictionaryEvidenceEntries : [];
    diagnostics.dictionaryEvidenceTerms += dictionaryEvidenceEntries.length;
    diagnostics.dictionaryEvidenceCount += countAcceptedEvidenceHits(dictionaryEvidenceEntries);
    diagnostics.generatedTerms += Array.isArray(training.generatedEntries)
      ? training.generatedEntries.length
      : Array.isArray(item?.result?.entries)
        ? item.result.entries.length
        : 0;
  }
  return diagnostics;
}

function summarizeQueryDiagnostics(results = []) {
  return results.map((item) => {
    const diagnostics = item?.result?.collectionDiagnostics || {};
    return {
      query: item.query,
      ok: Boolean(item?.result?.ok),
      error: item?.result?.error || '',
      discoveredVideos: Math.max(0, Number(diagnostics.discoveredVideos) || 0),
      discoveryContextVideos: Math.max(0, Number(diagnostics.discoveryContextVideos) || 0),
      scannedVideos: Math.max(0, Number(diagnostics.scannedVideos) || 0),
      commentsCollected: Math.max(0, Number(diagnostics.commentsCollected) || 0),
      trainingTextChars: Math.max(0, Number(diagnostics.trainingTextChars) || 0),
      targetExistingTerms: Array.isArray(diagnostics.targetExistingTerms) ? diagnostics.targetExistingTerms : [],
      acceptedTerms: Array.isArray(diagnostics.acceptedTerms) ? diagnostics.acceptedTerms : [],
      evidenceRejected: Math.max(0, Number(diagnostics.evidenceRejected) || 0),
      sampleVideos: Array.isArray(diagnostics.sampleVideos) ? diagnostics.sampleVideos.slice(0, 5) : [],
    };
  });
}

function updateTermAttempt(termAttempts, planItem, result, finishedAt, options = {}) {
  if (!planItem?.term) return;
  const term = String(planItem.term).trim();
  const key = termAttemptKey(term);
  const current = getTermAttempt(termAttempts, term) || {};
  const evidenceEntry = [...(result?.entries || []), ...(result?.keywordTraining?.dictionaryEvidenceEntries || [])].find((entry) => entry?.term === term);
  const dictionaryEntry = findResultDictionaryEntry(result, term);
  const plannedEvidenceCount = Number(planItem.coverageEvidenceCount ?? planItem.evidenceCount ?? current.evidenceAtPlanTime ?? 0) || 0;
  const evidenceEntryCoverageCount = coverageEvidenceCount(evidenceEntry, options);
  const dictionaryEvidenceCount = coverageEvidenceCount(dictionaryEntry, options);
  const evidenceEntryGained = Boolean(result?.ok) && evidenceEntryCoverageCount > plannedEvidenceCount;
  const dictionaryEvidenceGained = Boolean(result?.ok) && dictionaryEvidenceCount > plannedEvidenceCount;
  const hit = evidenceEntryGained || dictionaryEvidenceGained;
  const hitEvidenceCount = Math.max(evidenceEntryCoverageCount, dictionaryEvidenceCount);
  const priorSuccessfulAttempts = Math.max(0, Number(current.successfulAttempts) || 0);
  const evidenceAtPlanTime =
    !hit && priorSuccessfulAttempts > 0 && Object.prototype.hasOwnProperty.call(current, 'evidenceAtPlanTime')
      ? current.evidenceAtPlanTime
      : planItem.evidenceCount ?? current.evidenceAtPlanTime ?? 0;
  const queryRecord = {
    at: finishedAt,
    query: planItem.query,
    strategyVersion: HARVEST_STRATEGY_VERSION,
    ok: Boolean(result?.ok),
    hit,
    videos: result?.videos?.length || 0,
    comments: result?.comments?.length || 0,
    error: result?.error || '',
  };
  termAttempts[key] = {
    key,
    term,
    family: planItem.family || current.family || 'unknown',
    evidenceAtPlanTime,
    lastVariantIndex: planItem.variantIndex ?? current.lastVariantIndex ?? null,
    attempts: Math.max(0, Number(current.attempts) || 0) + 1,
    successfulAttempts: priorSuccessfulAttempts + (hit ? 1 : 0),
    lastAttemptAt: finishedAt,
    lastSuccessfulAt: hit ? finishedAt : current.lastSuccessfulAt || null,
    lastQuery: planItem.query,
    lastError: result?.ok ? '' : result?.error || '',
    lastEvidenceCount: hit ? hitEvidenceCount : Number(current.lastEvidenceCount) || 0,
    queries: [...(Array.isArray(current.queries) ? current.queries : []), queryRecord].slice(-20),
  };
}

function acceptedResultTerms(result = {}) {
  return new Set(
    [
      ...(Array.isArray(result?.collectionDiagnostics?.acceptedTerms) ? result.collectionDiagnostics.acceptedTerms : []),
      ...(Array.isArray(result?.entries) ? result.entries.map((entry) => entry?.term) : []),
      ...(Array.isArray(result?.keywordTraining?.dictionaryEvidenceEntries) ? result.keywordTraining.dictionaryEvidenceEntries.map((entry) => entry?.term) : []),
    ]
      .map((term) => String(term || '').trim())
      .filter(Boolean),
  );
}

function updateRelatedTargetTermAttempts(termAttempts, dictionary, planItem, result, finishedAt, options = {}) {
  if (!planItem?.term) return;
  const diagnostics = result?.collectionDiagnostics || {};
  const targets = Array.isArray(diagnostics.targetExistingTerms) ? diagnostics.targetExistingTerms : [];
  if (targets.length === 0) return;
  const entries = new Map((Array.isArray(dictionary?.entries) ? dictionary.entries : []).map((entry) => [String(entry?.term || '').trim(), entry]));
  const primaryTerm = String(planItem.term || '').trim();
  const relatedAttemptTerms = new Set((Array.isArray(options.relatedAttemptTerms) ? options.relatedAttemptTerms : []).map((term) => String(term || '').trim()).filter(Boolean));
  const acceptedTerms = acceptedResultTerms(result);
  for (const target of targets) {
    const term = String(target || '').trim();
    if (!term || term === primaryTerm) continue;
    if (relatedAttemptTerms.size > 0 && !relatedAttemptTerms.has(term) && !acceptedTerms.has(term)) continue;
    const entry = entries.get(term);
    updateTermAttempt(
      termAttempts,
      {
        ...planItem,
        term,
        family: entry?.family || planItem.family,
        evidenceCount: entry ? evidenceCount(entry) : planItem.evidenceCount,
      },
      result,
      finishedAt,
      options,
    );
  }
}

function backfillTermAttemptsFromSearchedQueries(termAttempts, dictionary, searchedQueries, options = {}) {
  const entries = Array.isArray(dictionary?.entries) ? dictionary.entries : [];
  const searchedQuerySet = new Set(searchedQueries);
  const templateCount = queryTemplatesFromOptions(options).length;
  const backfilledAt = options.backfilledAt || new Date().toISOString();
  let backfilled = 0;
  for (const entry of entries) {
    const term = String(entry.term || '').trim();
    if (!term) continue;
    const family = String(entry.family || 'attack').trim();
    const key = termAttemptKey(term);
    const current = getTermAttempt(termAttempts, term) || {};
    const triedQueries = attemptedVariantQueries(current);
    for (const variant of queryVariantsForTerm(term, family, templateCount, {
      ...options,
      searchTerms: relatedContainedSearchTerms(entries, entry),
      preferSearchTerms: true,
    })) {
      if (!searchedQuerySet.has(variant.query) || triedQueries.has(variant.query)) continue;
      const queryRecord = {
        at: current.lastAttemptAt || backfilledAt,
        query: variant.query,
        strategyVersion: Math.max(0, Number(options.harvestStrategyVersion) || 0),
        ok: true,
        hit: false,
        videos: 0,
        comments: 0,
        error: 'backfilled from searched query history',
      };
      const previousQueries = Array.isArray(current.queries) ? current.queries : [];
      const nextQueries = [...previousQueries, queryRecord].slice(-20);
      termAttempts[key] = {
        key,
        term,
        family: current.family || family,
        evidenceAtPlanTime: current.evidenceAtPlanTime ?? evidenceCount(entry),
        lastVariantIndex: variant.variantIndex,
        attempts: Math.max(0, Number(current.attempts) || 0) + 1,
        successfulAttempts: Math.max(0, Number(current.successfulAttempts) || 0),
        lastAttemptAt: current.lastAttemptAt || backfilledAt,
        lastSuccessfulAt: current.lastSuccessfulAt || null,
        lastQuery: variant.query,
        lastError: current.lastError || '',
        lastEvidenceCount: Number(current.lastEvidenceCount) || 0,
        queries: nextQueries,
      };
      Object.assign(current, termAttempts[key]);
      triedQueries.add(variant.query);
      backfilled += 1;
    }
  }
  return backfilled;
}

export async function harvestKeywordDictionary(options = {}, deps = {}) {
  const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
  const searchVideoKeywords = deps.searchVideoKeywords || defaultSearchVideoKeywords;
  const statePath = options.statePath || DEFAULT_HARVEST_STATE_PATH;
  const skipSeen = options.skipSeen !== false;
  const state = options.resetState
    ? { version: 1, harvestStrategyVersion: 0, updatedAt: null, searchedQueries: [], scannedBvids: [], termAttempts: {}, runs: [] }
    : await readKeywordHarvestState(statePath);
  const before = await readKeywordDictionary();
  const coverageOptions = {
    targetEvidence: options.targetEvidence,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence === true,
  };
  const beforeCoverage = summarizeEvidenceCoverage(before, coverageOptions);
  const stateStrategyIsCurrent = hasCurrentHarvestStrategyState(state);
  const searchedQuerySet = new Set(stateStrategyIsCurrent && Array.isArray(state.searchedQueries) ? state.searchedQueries : []);
  const skipSearchedQuerySet = new Set(searchedQuerySet);
  const scannedBvidSet = new Set(state.scannedBvids);
  const maxQueries = asPositiveInt(options.maxQueries, 12, 100);
  const termAttempts = stateStrategyIsCurrent ? { ...state.termAttempts } : {};
  const backfilledAttempts = backfillTermAttemptsFromSearchedQueries(termAttempts, before, searchedQuerySet, {
    ...options,
    harvestStrategyVersion: state.harvestStrategyVersion,
    backfilledAt: state.updatedAt || new Date().toISOString(),
  });
  const candidatePlan = buildKeywordHarvestQueryPlan(before, {
    state,
    priorityQueries: options.priorityQueries,
    seedQueries: options.seedQueries,
    maxQueries: skipSeen ? Math.min(10000, maxQueries + searchedQuerySet.size + 100) : Math.min(10000, maxQueries + 100),
    termsPerFamily: options.termsPerFamily,
    queryVariantsPerTerm: options.queryVariantsPerTerm,
    targetEvidence: options.targetEvidence,
    coverageMode: options.coverageMode,
    requireSourceBackedEvidence: options.requireSourceBackedEvidence,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence,
    prioritizeSourceGaps: options.prioritizeSourceGaps,
    termAttempts,
    extraQueryTemplates: options.extraQueryTemplates,
  });
  const plan = selectHarvestPlan(candidatePlan, {
    maxQueries,
    maxHardMissedQueries: options.maxHardMissedQueries,
    termAttempts,
    retryBeforeUnattemptedLimit: options.retryBeforeUnattemptedLimit,
    searchedQuerySet: skipSearchedQuerySet,
    skipSeen,
  });
  const candidateQueries = candidatePlan.map((item) => item.query);
  const queries = plan.map((item) => item.query);
  const commentPoolTargetTerms =
    options.requireCommentBackedEvidence === true && options.existingTermsOnly === true
      ? unique(candidatePlan.map((item) => item.term).filter(Boolean)).slice(0, asPositiveInt(options.commentPoolTargetTermsLimit, 24, 200))
      : [];
  const results = [];
  const warnings = [];

  for (const planItem of plan) {
    const query = planItem.query;
    const attemptFinishedAt = new Date().toISOString();
    const priorAttempt = planItem.term ? getTermAttempt(termAttempts, planItem.term) : null;
    const timeoutMs = Math.max(0, Number(options.perQueryTimeoutMs) || 0);
    const timeoutController = timeoutMs > 0 && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const commentMisses = currentStrategyCommentMisses(priorAttempt);
    const deepenScan = isRepeatedlyMissedAttempt(priorAttempt, options.retryBeforeUnattemptedLimit) || commentMisses > 0;
    const hardMissedZeroEvidence = isHardMissedZeroEvidenceAttempt(priorAttempt, options.retryBeforeUnattemptedLimit);
    const hardMissedDiscoveryLimit =
      options.hardMissedDiscoveryLimit ?? Math.max(Number(options.staleMissedDiscoveryLimit) || 1, (Number(options.discoveryLimit) || 1) * 4);
    const hardMissedDiscoveryPages = options.hardMissedDiscoveryPages ?? Math.max(3, Number(options.discoveryPages) || 1);
    const hardMissedPages = options.hardMissedPages ?? Math.max(Number(options.staleMissedPages) || 1, (Number(options.pages) || 1) + 4);
    const effectiveDiscoveryLimit =
      hardMissedZeroEvidence
        ? Math.max(Number(options.discoveryLimit) || 1, Number(hardMissedDiscoveryLimit) || 1)
        : deepenScan && options.staleMissedDiscoveryLimit
        ? Math.max(Number(options.discoveryLimit) || 1, Number(options.staleMissedDiscoveryLimit) || 1)
        : options.discoveryLimit;
    const effectivePages =
      hardMissedZeroEvidence
        ? Math.max(Number(options.pages) || 1, Number(hardMissedPages) || 1)
        : deepenScan && options.staleMissedPages
        ? Math.max(Number(options.pages) || 1, Number(options.staleMissedPages) || 1)
        : options.pages;
    try {
      const searchPayload = {
        searchQueries: [query],
        controversyQueries: controversyQueriesForPlanItem(planItem, options),
        discoveryMode: options.discoveryMode,
        discoveryLimit: effectiveDiscoveryLimit,
        pages: effectivePages,
        excludeBvids: skipSeen && !deepenScan ? [...scannedBvidSet] : [],
      };
      if (timeoutController) {
        searchPayload.abortSignal = timeoutController.signal;
      }
      if (hardMissedZeroEvidence || options.discoveryPages !== undefined) {
        searchPayload.discoveryPages = hardMissedZeroEvidence ? hardMissedDiscoveryPages : options.discoveryPages;
      }
      if (options.existingTermsOnly !== undefined) {
        searchPayload.existingTermsOnly = options.existingTermsOnly;
      }
      if (options.existingTermsOnly === true && planItem.term) {
        const directTargetExistingTerms = unique([
          ...(Array.isArray(planItem.targetExistingTerms) ? planItem.targetExistingTerms : []),
          planItem.term,
          ...relatedTargetExistingTerms(before, planItem, options),
        ]);
        searchPayload.targetExistingTerms = unique([
          ...directTargetExistingTerms,
          ...commentPoolTargetTerms,
        ]);
        searchPayload.directTargetExistingTerms = directTargetExistingTerms;
      }
      if (options.requireCommentBackedEvidence === true) {
        searchPayload.includeVideoContext = false;
        searchPayload.includeVideoObjectEvidence = false;
        searchPayload.evidenceSourceVideoFallback = options.existingTermsOnly === true;
        searchPayload.allowFilteredDiscoveryFallback = options.allowFilteredDiscoveryFallback !== false;
        searchPayload.preferFilteredDiscoveryFallback = options.preferFilteredDiscoveryFallback !== false;
        searchPayload.expandTargetsFromComments = options.expandTargetsFromComments === true;
        if (options.existingTermsOnly === true && options.prioritizeSearchQueries !== false) {
          searchPayload.prioritizeSearchQueries = true;
          searchPayload.targetSearchOnly = options.targetSearchOnly !== false;
        }
      }
      if (options.controversialPopularQueryLimit !== undefined) {
        searchPayload.controversialPopularQueryLimit = options.controversialPopularQueryLimit;
      }
      if (options.controversialPopularSearchOrder !== undefined) {
        searchPayload.controversialPopularSearchOrder = options.controversialPopularSearchOrder;
      }
      if (options.includeGenericPopular !== undefined) {
        searchPayload.includeGenericPopular = options.includeGenericPopular;
      }
      if (/\u5f39\u5e55/.test(query)) {
        searchPayload.includeDanmaku = true;
        searchPayload.allowNetworkDanmaku = true;
      } else if (options.existingTermsOnly === true && commentMisses > 0) {
        searchPayload.includeDanmaku = true;
        searchPayload.allowNetworkDanmaku = true;
      } else if (options.includeDanmaku !== undefined) {
        searchPayload.includeDanmaku = options.includeDanmaku;
        searchPayload.allowNetworkDanmaku = options.includeDanmaku === true;
      }
      const result = await withTimeout(
        searchVideoKeywords(searchPayload),
        timeoutMs,
        `Bilibili harvest query "${query}" timed out after ${timeoutMs}ms`,
        timeoutController,
      );
      results.push({ query, result });
      if (!result.ok) warnings.push(`${query}: ${result.error}`);
      for (const warning of result.warnings || []) warnings.push(`${query}: ${warning}`);
      searchedQuerySet.add(query);
      updateTermAttempt(termAttempts, planItem, result, attemptFinishedAt, options);
      updateRelatedTargetTermAttempts(termAttempts, before, planItem, result, attemptFinishedAt, {
        ...options,
        relatedAttemptTerms: searchPayload.directTargetExistingTerms,
      });
      for (const video of result.videos || []) {
        if (video.bvid) scannedBvidSet.add(video.bvid);
      }
    } catch (error) {
      warnings.push(`${query}: ${error.message}`);
      const targetExistingTerms = planItem.term
        ? unique([
            ...(Array.isArray(planItem.targetExistingTerms) ? planItem.targetExistingTerms : []),
            planItem.term,
            ...relatedTargetExistingTerms(before, planItem, options),
          ])
        : [];
      const result = {
        ok: false,
        error: error.message,
        collectionDiagnostics: {
          targetExistingTerms,
          acceptedTerms: [],
        },
      };
      results.push({ query, result });
      searchedQuerySet.add(query);
      updateTermAttempt(termAttempts, planItem, result, attemptFinishedAt, options);
    }
  }

  const rawAfter = await readKeywordDictionary();
  const beforeTermSet = new Set((Array.isArray(before?.entries) ? before.entries : []).map((entry) => String(entry?.term || '').trim()).filter(Boolean));
  const existingOnlyNewTerms =
    options.existingTermsOnly === true
      ? (Array.isArray(rawAfter?.entries) ? rawAfter.entries : []).filter((entry) => {
          const term = String(entry?.term || '').trim();
          return term && !beforeTermSet.has(term);
        })
      : [];
  if (existingOnlyNewTerms.length > 0) {
    warnings.push(`existing-only harvest ignored ${existingOnlyNewTerms.length} new dictionary term(s): ${existingOnlyNewTerms.map((entry) => entry.term).slice(0, 5).join(', ')}`);
  }
  const after = options.existingTermsOnly === true ? dictionaryRestrictedToTerms(rawAfter, beforeTermSet) : rawAfter;
  const growth = summarizeDictionaryGrowth(before, after);
  const coverage = summarizeEvidenceCoverage(after, coverageOptions);
  const rawCoverageProgress = summarizeCoverageProgress(beforeCoverage, coverage);
  const coverageProgress = hasHarvestEvidenceProgress(results, before, coverageOptions) ? rawCoverageProgress : zeroCoverageProgress();
  const termAttemptSummary = summarizeTermAttempts({ termAttempts }, after, {
    extraQueryTemplates: options.extraQueryTemplates,
    exhaustedSuggestionTemplates: options.exhaustedSuggestionTemplates,
  });
  const coverageActions = buildCoverageActions(after, { termAttempts }, {
    targetEvidence: options.targetEvidence,
    requireSourceBackedEvidence: options.requireSourceBackedEvidence,
    requireCommentBackedEvidence: options.requireCommentBackedEvidence,
    retryBeforeUnattemptedLimit: options.retryBeforeUnattemptedLimit,
    prioritizeSourceGaps: options.prioritizeSourceGaps,
    extraQueryTemplates: options.extraQueryTemplates,
    exhaustedSuggestionTemplates: options.exhaustedSuggestionTemplates,
  });
  const trainingDiagnostics = summarizeTrainingDiagnostics(results);
  const queryDiagnostics = summarizeQueryDiagnostics(results);
  const finishedAt = new Date().toISOString();
  const nextState = {
    version: 1,
    harvestStrategyVersion: HARVEST_STRATEGY_VERSION,
    updatedAt: finishedAt,
    searchedQueries: [...searchedQuerySet].sort(),
    scannedBvids: [...scannedBvidSet].sort(),
    termAttempts,
    runs: [
      ...state.runs.slice(-49),
      {
        at: finishedAt,
        queries: queries.length,
        successfulQueries: results.filter((item) => item.result?.ok).length,
        videosScanned: results.reduce((sum, item) => sum + (item.result?.videos?.length || 0), 0),
        commentsCollected: results.reduce((sum, item) => sum + (item.result?.comments?.length || 0), 0),
        evidenceRejected: trainingDiagnostics.evidenceRejected,
        trainingDiagnostics,
        queryDiagnostics,
        acceptedEvidenceCount: results.reduce((sum, item) => sum + countAcceptedEvidenceHits(item.result?.entries || []), 0),
        dictionaryBefore: growth.before,
        dictionaryAfter: growth.after,
        dictionaryAdded: growth.added,
        weakTermsResolved: coverageProgress.weakTermsResolved,
        zeroEvidenceResolved: coverageProgress.zeroEvidenceResolved,
        evidenceGained: coverageProgress.evidenceGained,
        evidenceDeficitReduced: coverageProgress.evidenceDeficitReduced,
        attemptedTerms: termAttemptSummary.attemptedTerms,
        successfulTerms: termAttemptSummary.successfulTerms,
        unattemptedTerms: termAttemptSummary.unattemptedTerms,
        exhaustedTerms: termAttemptSummary.exhaustedTerms,
        backfilledAttempts,
        weakTerms: coverage.weakTerms,
        zeroEvidenceTerms: coverage.zeroEvidenceTerms,
        warnings: warnings.length,
      },
    ],
  };
  await writeKeywordHarvestState(nextState, statePath);

  return {
    ok: results.some((item) => item.result?.ok),
    backfilledAttempts,
    state: nextState,
    candidateQueries,
    queries,
    plan,
    results,
    warnings,
    growth,
    coverage,
    coverageProgress,
    trainingDiagnostics,
    queryDiagnostics,
    termAttemptSummary,
    coverageActions,
    dictionary: after,
  };
}

export async function harvestKeywordDictionaryRounds(options = {}, deps = {}) {
  const rounds = asPositiveInt(options.rounds, 1, 100);
  const results = [];
  for (let index = 0; index < rounds; index += 1) {
    const result = await harvestKeywordDictionary(
      {
        ...options,
        resetState: index === 0 ? options.resetState : false,
      },
      deps,
    );
    results.push(result);
    if ((result.coverage?.terms || 0) > 0 && result.coverage?.complete) break;
    if (result.queries.length === 0) break;
  }
  const last = results.at(-1) || null;
  return {
    ok: results.some((result) => result.ok),
    requestedRounds: rounds,
    rounds: results,
    state: last?.state || null,
    growth: last?.growth || null,
    coverage: last?.coverage || null,
    termAttemptSummary: last?.termAttemptSummary || null,
    coverageActions: last?.coverageActions || null,
    dictionary: last?.dictionary || null,
  };
}
