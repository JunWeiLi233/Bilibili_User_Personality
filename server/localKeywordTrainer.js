import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SUPPORTED_FAMILIES = ['attack', 'absolutes', 'evidence', 'evasion', 'cooperation', 'correction'];
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

export const DEFAULT_DICTIONARY_PATH = join(process.cwd(), 'server', 'localKeywordDictionary.json');

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function cleanTerm(term) {
  return String(term || '')
    .replace(/[，。！？、；：,.!?;:"'“”‘’`~()[\]{}<>]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function normalizeFamily(family) {
  const raw = String(family || '').trim();
  return SUPPORTED_FAMILIES.includes(raw) ? raw : FAMILY_ALIASES[raw] || 'attack';
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
    const terms = unique([item.term, ...variants].map(cleanTerm)).filter((term) => term.length >= 2 && term.length <= 12);
    const meaning = String(item.meaning || item.reason || '').trim();
    if (!meaning || /中文含义|语用功能|^含义$|^解释$/.test(meaning)) continue;
    for (const term of terms) {
      if (STOP_TERMS.has(term) || /^变体\d+$/.test(term)) continue;
      entries.push({
        term,
        family,
        meaning,
        risk: String(item.risk || '').trim() || (family === 'cooperation' || family === 'correction' ? 'positive' : 'medium'),
        confidence: Number.isFinite(Number(item.confidence)) ? Math.max(0, Math.min(1, Number(item.confidence))) : 0.62,
      });
    }
  }
  return [...new Map(entries.map((entry) => [`${entry.family}:${entry.term}`, entry])).values()];
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

export async function mergeEntriesIntoDictionary(entries, options = {}) {
  const dictionaryPath = options.dictionaryPath || DEFAULT_DICTIONARY_PATH;
  const current = await readDictionary(dictionaryPath);
  const normalizedEntries = normalizeKeywordEntries(entries);
  const entryMap = new Map(current.entries.map((entry) => [`${entry.family}:${entry.term}`, entry]));
  for (const entry of normalizedEntries) {
    entryMap.set(`${entry.family}:${entry.term}`, {
      ...entryMap.get(`${entry.family}:${entry.term}`),
      ...entry,
      updatedAt: new Date().toISOString(),
    });
  }

  const allEntries = [...entryMap.values()].sort((a, b) => a.family.localeCompare(b.family) || a.term.localeCompare(b.term));
  const families = Object.fromEntries(SUPPORTED_FAMILIES.map((family) => [family, []]));
  for (const entry of allEntries) {
    if (!families[entry.family]) families[entry.family] = [];
    families[entry.family].push(entry.term);
  }
  for (const family of Object.keys(families)) families[family] = unique(families[family]).sort();

  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: allEntries,
    families,
  };
  await mkdir(dirname(dictionaryPath), { recursive: true });
  await writeFile(dictionaryPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export async function getLocalLlmConfig(options = {}) {
  const env = options.env || process.env;
  const fetchImpl = options.fetch || fetch;
  const host = String(env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/$/, '');
  const configuredModel = env.LOCAL_LLM_MODEL || env.OLLAMA_MODEL || '';
  try {
    const response = await fetchImpl(`${host}/api/tags`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = (payload.models || []).map((model) => model.name || model.model).filter(Boolean);
    const preferred =
      configuredModel && models.includes(configuredModel)
        ? configuredModel
        : models.find((model) => /qwen|deepseek|yi|glm/i.test(model)) || models.find((model) => /llama/i.test(model)) || models[0] || configuredModel;
    return {
      ok: true,
      provider: 'ollama',
      host,
      model: preferred || '',
      configuredModel,
      models,
      available: Boolean(preferred),
    };
  } catch (error) {
    return {
      ok: false,
      provider: 'ollama',
      host,
      model: configuredModel,
      configuredModel,
      models: [],
      available: false,
      error: error.message,
    };
  }
}

function buildKeywordPrompt({ text, uid }) {
  return `你是一个只在本机运行的中文互联网术语词典训练器。你的任务是从 B 站用户发言中发现值得加入本地词典的新词、梗、缩写、谐音或固定话术。

只输出 JSON，不要解释。JSON 结构：
{"keywords":[{"term":"词或短语","family":"attack|absolutes|evidence|evasion|cooperation|correction","meaning":"中文含义和语用功能","variants":["变体1"],"risk":"high|medium|positive|neutral","confidence":0.0}]}

分类规则：
- attack: 讽刺、阴阳怪气、资格审查、阵营/动机攻击、侮辱性梗。
- absolutes: 绝对化、全称化、没有例外的强断言。
- evidence: 来源、数据、证据、可核验材料相关词。
- evasion: 懂的都懂、自己搜、拒绝解释、转移举证责任。
- cooperation: 可能、限定、澄清、愿意看来源、合作讨论。
- correction: 我错了、说重了、更正、修正、降低结论强度。

不要加入普通名词、视频标题、用户名、纯数字。优先选择 2 到 12 字的中文互联网表达。

UID: ${uid || 'unknown'}
发言样本：
${String(text || '').slice(0, 5000)}`;
}

function heuristicKeywordEntries(text) {
  const patterns = [
    { pattern: /(不会真有人(?:觉得|以为)?)/g, family: 'attack', meaning: '用反问包装资格审查或嘲讽' },
    { pattern: /(典中典|典|孝|急了|绷不住|赢麻了|乐|yygq|阴阳怪气|懂哥|小丑)/gi, family: 'attack', meaning: '中文互联网嘲讽或贬低性梗' },
    { pattern: /(懂的都懂|你自己搜|自己查|不会百度|这还用问|懒得解释)/g, family: 'evasion', meaning: '把举证责任转移给对方' },
    { pattern: /(全是|全都|根本没有|没有一个|必然|绝对|肯定是)/g, family: 'absolutes', meaning: '缺少限定条件的强断言' },
    { pattern: /(数据|来源|报告|论文|链接|证据|出处)/g, family: 'evidence', meaning: '要求或提供可核验证据' },
    { pattern: /(可能|不一定|如果有|可以贴|我理解|补充一下)/g, family: 'cooperation', meaning: '合作讨论或条件化表达' },
    { pattern: /(我错了|我说重了|前面说重了|更正|修正|改结论)/g, family: 'correction', meaning: '自我修正或结论降级' },
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
  if (!config.available || !config.model) {
    return { entries: heuristicKeywordEntries(payload.text), usedFallback: true, raw: '' };
  }
  const prompt = buildKeywordPrompt(payload);
  const response = await fetchImpl(`${config.host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt,
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 700,
      },
    }),
  });
  if (!response.ok) throw new Error(`Ollama generate failed with HTTP ${response.status}`);
  const data = await response.json();
  const raw = data.response || '';
  try {
    const parsed = extractJsonObject(raw);
    const llmEntries = normalizeKeywordEntries(parsed.keywords || parsed.terms || []);
    const heuristicEntries = heuristicKeywordEntries(payload.text);
    const entries = normalizeKeywordEntries([...llmEntries, ...heuristicEntries]);
    return {
      entries,
      usedFallback: llmEntries.length === 0,
      raw,
    };
  } catch {
    return { entries: heuristicKeywordEntries(payload.text), usedFallback: true, raw };
  }
}

export async function trainKeywordDictionary(payload, options = {}) {
  const config = await getLocalLlmConfig(options);
  const generated = await generateKeywordEntries(payload, config, options);
  const dictionary = await mergeEntriesIntoDictionary(generated.entries, options);
  return {
    ok: true,
    provider: config.provider,
    host: config.host,
    model: config.model || '',
    available: config.available,
    usedFallback: generated.usedFallback,
    entries: generated.entries,
    dictionary,
  };
}

export async function readKeywordDictionary(options = {}) {
  return readDictionary(options.dictionaryPath || DEFAULT_DICTIONARY_PATH);
}
