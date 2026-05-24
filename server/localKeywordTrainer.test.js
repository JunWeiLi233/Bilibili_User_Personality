import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  extractJsonObject,
  getLocalLlmConfig,
  mergeEntriesIntoDictionary,
  normalizeKeywordEntries,
  trainKeywordDictionary,
} from './localKeywordTrainer.js';

test('selects the configured Ollama model when available', async () => {
  const config = await getLocalLlmConfig({
    env: { OLLAMA_HOST: 'http://127.0.0.1:11434', LOCAL_LLM_MODEL: 'qwen2.5:7b' },
    fetch: async () => ({
      ok: true,
      json: async () => ({ models: [{ name: 'llama3.2:1b' }, { name: 'qwen2.5:7b' }] }),
    }),
  });

  assert.equal(config.provider, 'ollama');
  assert.equal(config.model, 'qwen2.5:7b');
  assert.equal(config.available, true);
});

test('normalizes local LLM keyword output into supported dictionary families', () => {
  const entries = normalizeKeywordEntries([
    { term: '不会真有人', family: 'sarcasm', meaning: '反讽式资格审查', variants: ['不会真有人觉得'] },
    { term: '懂的都懂', family: 'evidenceShift', meaning: '拒绝解释，把举证责任推给对方' },
    { term: '我说重了', family: 'correction', meaning: '自我降级修正' },
    { term: '变体1', family: 'attack', meaning: '中文含义和语用功能' },
  ]);

  assert.deepEqual(entries.map((entry) => [entry.term, entry.family]), [
    ['不会真有人', 'attack'],
    ['不会真有人觉得', 'attack'],
    ['懂的都懂', 'evasion'],
    ['我说重了', 'correction'],
  ]);
});

test('extracts JSON object from verbose local model responses', () => {
  const parsed = extractJsonObject('好的，结果如下：\n```json\n{"keywords":[{"term":"典中典","family":"attack"}]}\n```');
  assert.deepEqual(parsed, { keywords: [{ term: '典中典', family: 'attack' }] });
});

test('merges learned keyword entries into a persistent local dictionary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-keywords-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const dictionary = await mergeEntriesIntoDictionary(
      [
        { term: '典中典', family: 'attack', meaning: '套娃式嘲讽' },
        { term: '自己查', family: 'evasion', meaning: '转移举证责任' },
      ],
      { dictionaryPath },
    );

    assert.deepEqual(dictionary.families.attack, ['典中典']);
    assert.deepEqual(dictionary.families.evasion, ['自己查']);
    const persisted = JSON.parse(await readFile(dictionaryPath, 'utf8'));
    assert.equal(persisted.entries.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('trains dictionary through Ollama JSON output and persists learned terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-train-'));
  const dictionaryPath = join(dir, 'dictionary.json');
  try {
    const result = await trainKeywordDictionary(
      {
        text: '不会真有人觉得这叫证据吧，懂的都懂。',
        uid: '453244911',
      },
      {
        dictionaryPath,
        env: { LOCAL_LLM_MODEL: 'llama3.2:1b' },
        fetch: async (url) => {
          if (String(url).endsWith('/api/tags')) {
            return { ok: true, json: async () => ({ models: [{ name: 'llama3.2:1b' }] }) };
          }
          return {
            ok: true,
            json: async () => ({
              response: JSON.stringify({
                keywords: [
                  { term: '不会真有人', family: 'sarcasm', meaning: '用反问包装资格审查' },
                  { term: '懂的都懂', family: 'evidenceShift', meaning: '暗示无需证明' },
                ],
              }),
            }),
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.model, 'llama3.2:1b');
    assert.equal(result.entries.length >= 2, true);
    assert.equal(result.dictionary.families.attack.includes('不会真有人'), true);
    assert.equal(result.dictionary.families.evasion.includes('懂的都懂'), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
