import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCoverageActions,
  buildKeywordHarvestQueries,
  buildKeywordHarvestQueryPlan,
  harvestKeywordDictionary,
  harvestKeywordDictionaryRounds,
  readKeywordHarvestState,
  summarizeDictionaryGrowth,
  summarizeEvidenceCoverage,
  summarizeTermAttempts,
} from './keywordHarvest.js';

test('buildKeywordHarvestQueries prioritizes weak-evidence dictionary terms by family', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 8 },
        { term: 'yygq', family: 'attack', evidenceCount: 5 },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 1 },
      ],
    },
    {
      seedQueries: ['seed topic'],
      maxQueries: 8,
      termsPerFamily: 2,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(queries, [
    'seed topic',
    '典中典 Bilibili comment meme',
    '典中典 Bilibili comments',
    '懂的都懂 Bilibili reply argument comments',
    '懂的都懂 Bilibili comments',
    'yygq Bilibili comment meme',
    'yygq Bilibili comments',
    'doge Bilibili discussion comments',
  ]);
});

test('buildKeywordHarvestQueries can generate several Bilibili-oriented variants per weak term', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      maxQueries: 4,
      termsPerFamily: 1,
      queryVariantsPerTerm: 4,
    },
  );

  assert.deepEqual(queries, [
    'doge Bilibili discussion comments',
    'doge Bilibili comments',
    'doge B站 评论区',
    'doge 哔哩哔哩 弹幕',
  ]);
});

test('buildKeywordHarvestQueries all-weak mode targets every weak term before broad seeds', () => {
  const queries = buildKeywordHarvestQueries(
    {
      entries: [
        { term: 'strong', family: 'attack', evidenceCount: 4 },
        { term: 'weakA', family: 'attack', evidenceCount: 0 },
        { term: 'weakB', family: 'attack', evidenceCount: 1 },
        { term: 'weakC', family: 'evasion', evidenceCount: 2 },
      ],
    },
    {
      seedQueries: ['seed topic'],
      coverageMode: 'all-weak',
      targetEvidence: 3,
      maxQueries: 8,
      termsPerFamily: 1,
      queryVariantsPerTerm: 1,
    },
  );

  assert.deepEqual(queries, [
    'weakA Bilibili comment meme',
    'weakB Bilibili comment meme',
    'weakC Bilibili reply argument comments',
    'seed topic',
  ]);
});

test('buildKeywordHarvestQueryPlan keeps dictionary term metadata for state tracking', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: ['seed topic'],
      coverageMode: 'all-weak',
      maxQueries: 3,
      queryVariantsPerTerm: 2,
    },
  );

  assert.deepEqual(plan, [
    {
      query: 'doge Bilibili discussion comments',
      source: 'dictionary',
      term: 'doge',
      family: 'cooperation',
      evidenceCount: 0,
      priorAttempts: 0,
      priorSuccessfulAttempts: 0,
      variantIndex: 0,
      builtInVariant: true,
      previouslyTried: false,
    },
    {
      query: 'doge Bilibili comments',
      source: 'dictionary',
      term: 'doge',
      family: 'cooperation',
      evidenceCount: 0,
      priorAttempts: 0,
      priorSuccessfulAttempts: 0,
      variantIndex: 1,
      builtInVariant: true,
      previouslyTried: false,
    },
    { query: 'seed topic', source: 'seed' },
  ]);
});

test('buildKeywordHarvestQueryPlan expands to untried variants for repeatedly missed terms', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 4,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: 2,
          successfulAttempts: 0,
          queries: [{ query: 'doge Bilibili discussion comments' }, { query: 'doge Bilibili comments' }],
        },
      },
    },
  );

  assert.deepEqual(
    plan.map((item) => [item.query, item.variantIndex, item.previouslyTried]),
    [
      ['doge B站 评论区', 2, false],
      ['doge 哔哩哔哩 弹幕', 3, false],
      ['doge Bilibili discussion comments', 0, true],
      ['doge Bilibili comments', 1, true],
    ],
  );
});

test('buildKeywordHarvestQueryPlan prioritizes retry actions before fresh harvest actions', () => {
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'fresh', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      termAttempts: {
        missed: {
          term: 'missed',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'missed Bilibili comment meme' }],
        },
      },
    },
  );

  assert.equal(plan[0].term, 'missed');
  assert.equal(plan[0].query, 'missed Bilibili comments');
  assert.equal(plan[0].previouslyTried, false);
  assert.equal(plan[1].term, 'missed');
});


test('buildKeywordHarvestQueryPlan skips terms that exhausted every built-in query variant', () => {
  const allQueries = [
    'doge Bilibili discussion comments',
    'doge Bilibili comments',
    'doge B站 评论区',
    'doge 哔哩哔哩 弹幕',
    'doge 评论 梗',
    'doge 评论区',
    'doge 梗',
    'doge 发言',
    'doge 争议',
    'doge',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 0 },
        { term: 'yygq', family: 'attack', evidenceCount: 0 },
      ],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 2,
      queryVariantsPerTerm: 2,
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.deepEqual(plan.map((item) => item.term), ['yygq', 'yygq']);
});

test('buildKeywordHarvestQueryPlan can reopen exhausted terms with extra runtime templates', () => {
  const allQueries = [
    'doge Bilibili discussion comments',
    'doge Bilibili comments',
    'doge B站 评论区',
    'doge 哔哩哔哩 弹幕',
    'doge 评论 梗',
    'doge 评论区',
    'doge 梗',
    'doge 发言',
    'doge 争议',
    'doge',
  ];
  const plan = buildKeywordHarvestQueryPlan(
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
    {
      seedQueries: [],
      coverageMode: 'all-weak',
      maxQueries: 1,
      queryVariantsPerTerm: 2,
      extraQueryTemplates: ['{term} 热评'],
      termAttempts: {
        doge: {
          term: 'doge',
          attempts: allQueries.length,
          successfulAttempts: 0,
          queries: allQueries.map((query) => ({ query })),
        },
      },
    },
  );

  assert.equal(plan[0].query, 'doge 热评');
  assert.equal(plan[0].builtInVariant, false);
  assert.equal(plan[0].previouslyTried, false);
});



test('summarizeDictionaryGrowth reports new terms, families, and duplicates', () => {
  const summary = summarizeDictionaryGrowth(
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  );

  assert.equal(summary.before, 1);
  assert.equal(summary.after, 2);
  assert.equal(summary.added, 1);
  assert.equal(summary.duplicates, 1);
  assert.deepEqual(summary.families, { cooperation: 1, attack: 2 });
  assert.deepEqual(summary.newTerms.map((entry) => entry.term), ['yygq', 'yygq']);
});

test('summarizeEvidenceCoverage reports weak terms and family coverage', () => {
  const coverage = summarizeEvidenceCoverage(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 4 },
        { term: '典中典', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 2 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.equal(coverage.terms, 3);
  assert.equal(coverage.complete, false);
  assert.equal(coverage.totalEvidence, 6);
  assert.equal(coverage.averageEvidence, 2);
  assert.equal(coverage.coverageRatio, 0.3333);
  assert.equal(coverage.evidenceDeficit, 4);
  assert.equal(coverage.weakTerms, 2);
  assert.equal(coverage.zeroEvidenceTerms, 1);
  assert.deepEqual(coverage.weakSamples.map((entry) => entry.term), ['典中典', '懂的都懂']);
  assert.deepEqual(coverage.zeroEvidenceSamples.map((entry) => entry.term), ['典中典']);
  assert.deepEqual(coverage.byFamily.attack, { terms: 1, evidence: 0, weak: 1, zero: 1 });
});

test('summarizeEvidenceCoverage marks coverage complete when every term reaches target evidence', () => {
  const coverage = summarizeEvidenceCoverage(
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 3 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 5 },
      ],
    },
    { targetEvidence: 3 },
  );

  assert.equal(coverage.complete, true);
  assert.equal(coverage.coverageRatio, 1);
  assert.equal(coverage.evidenceDeficit, 0);
  assert.equal(coverage.weakTerms, 0);
});

test('summarizeTermAttempts reports attempted, successful, unattempted, and missed terms', () => {
  const summary = summarizeTermAttempts(
    {
      termAttempts: {
        doge: { term: 'doge', family: 'cooperation', attempts: 2, successfulAttempts: 1 },
        yygq: { term: 'yygq', family: 'attack', attempts: 3, successfulAttempts: 0, lastQuery: 'yygq 评论区' },
      },
    },
    {
      entries: [
        { term: 'doge', family: 'cooperation', evidenceCount: 2 },
        { term: 'yygq', family: 'attack', evidenceCount: 0 },
        { term: '懂的都懂', family: 'evasion', evidenceCount: 0 },
      ],
    },
  );

  assert.equal(summary.attemptedTerms, 2);
  assert.equal(summary.successfulTerms, 1);
  assert.equal(summary.unattemptedTerms, 1);
  assert.deepEqual(summary.unattemptedSamples.map((entry) => entry.term), ['懂的都懂']);
  assert.deepEqual(summary.repeatedlyMissedTerms.map((entry) => entry.term), ['yygq']);
  assert.equal(summary.exhaustedTerms, 0);
});

test('summarizeTermAttempts reports exhausted terms after every built-in variant misses', () => {
  const variants = [
    'doge Bilibili discussion comments',
    'doge Bilibili comments',
    'doge B站 评论区',
    'doge 哔哩哔哩 弹幕',
    'doge 评论 梗',
    'doge 评论区',
    'doge 梗',
    'doge 发言',
    'doge 争议',
    'doge',
  ];
  const summary = summarizeTermAttempts(
    {
      termAttempts: {
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: variants.length,
          successfulAttempts: 0,
          lastQuery: 'doge',
          queries: variants.map((query) => ({ query })),
        },
      },
    },
    {
      entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }],
    },
  );

  assert.equal(summary.exhaustedTerms, 1);
  assert.deepEqual(summary.exhaustedSamples.map((entry) => entry.term), ['doge']);
  assert.equal(summary.exhaustedSamples[0].variantsTried, 10);
  assert.equal(summary.exhaustedSamples[0].suggestedQueries.includes('doge 热评'), true);
});

test('buildCoverageActions classifies covered, unattempted, missed, partial, and exhausted terms', () => {
  const variants = [
    'doge Bilibili discussion comments',
    'doge Bilibili comments',
    'doge B站 评论区',
    'doge 哔哩哔哩 弹幕',
    'doge 评论 梗',
    'doge 评论区',
    'doge 梗',
    'doge 发言',
    'doge 争议',
    'doge',
  ];
  const actions = buildCoverageActions(
    {
      entries: [
        { term: 'covered', family: 'attack', evidenceCount: 3 },
        { term: 'newbie', family: 'attack', evidenceCount: 0 },
        { term: 'missed', family: 'attack', evidenceCount: 0 },
        { term: 'partial', family: 'attack', evidenceCount: 1 },
        { term: 'doge', family: 'cooperation', evidenceCount: 0 },
      ],
    },
    {
      termAttempts: {
        missed: {
          term: 'missed',
          attempts: 1,
          successfulAttempts: 0,
          queries: [{ query: 'missed Bilibili comment meme' }],
          lastQuery: 'missed Bilibili comment meme',
        },
        partial: {
          term: 'partial',
          attempts: 1,
          successfulAttempts: 1,
          queries: [{ query: 'partial Bilibili comment meme', hit: true }],
        },
        doge: {
          term: 'doge',
          family: 'cooperation',
          attempts: variants.length,
          successfulAttempts: 0,
          queries: variants.map((query) => ({ query })),
        },
      },
    },
    { targetEvidence: 3 },
  );
  const byTerm = Object.fromEntries(actions.map((item) => [item.term, item]));

  assert.equal(byTerm.covered.action, 'none');
  assert.equal(byTerm.newbie.action, 'harvest');
  assert.equal(byTerm.missed.action, 'retry_with_new_variant');
  assert.equal(byTerm.missed.nextQuery, 'missed Bilibili comments');
  assert.equal(byTerm.partial.action, 'harvest_more_evidence');
  assert.equal(byTerm.doge.status, 'exhausted');
  assert.equal(byTerm.doge.action, 'add_query_template');
  assert.equal(byTerm.doge.suggestedQueries.includes('doge 热评'), true);
});


test('harvestKeywordDictionary runs dictionary-seeded searches and reports growth', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-'));
  const statePath = join(dir, 'state.json');
  const dictionaries = [
    { entries: [{ term: 'doge', family: 'cooperation' }] },
    {
      entries: [
        { term: 'doge', family: 'cooperation' },
        { term: 'yygq', family: 'attack' },
      ],
    },
  ];
  try {
    const searched = [];
    const result = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => dictionaries.shift() || dictionaries.at(-1),
        searchVideoKeywords: async (payload) => {
          searched.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: payload.searchQueries[0] === 'seed topic' ? 'BV1111111111' : 'BV2222222222' }],
            comments: [{ rpid: payload.searchQueries[0], message: 'comment' }],
            entries: [{ term: 'yygq', family: 'attack' }],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.queries, ['seed topic', 'doge Bilibili discussion comments']);
    assert.equal(searched.length, 2);
    assert.deepEqual(searched[0], {
      searchQueries: ['seed topic'],
      controversyQueries: undefined,
      discoveryMode: undefined,
      discoveryLimit: 1,
      pages: 1,
      excludeBvids: [],
    });
    assert.equal(result.growth.added, 1);
    assert.equal(result.coverage.weakTerms, 2);
    assert.equal(result.coverageProgress.evidenceGained, 0);
    assert.equal(result.termAttemptSummary.attemptedTerms, 1);
    assert.equal(result.coverageActions.some((item) => item.action !== 'none'), true);
    assert.deepEqual(result.state.scannedBvids, ['BV1111111111', 'BV2222222222']);
    const dogeAttempt = Object.values(result.state.termAttempts).find((item) => item.term === 'doge');
    assert.equal(dogeAttempt.attempts, 1);
    assert.equal(dogeAttempt.successfulAttempts, 0);
    assert.equal(dogeAttempt.lastVariantIndex, 0);
    const persisted = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(persisted.runs.length, 1);
    assert.equal(persisted.runs[0].videosScanned, 2);
    assert.equal(persisted.runs[0].attemptedTerms, 1);
    assert.equal(persisted.runs[0].exhaustedTerms, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary uses untried query variants after prior missed attempts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-retry-variant-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const second = await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'doge', family: 'cooperation', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV2222222222' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.deepEqual(second.queries, ['doge Bilibili comments']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary writes ASCII-safe term attempt state for Chinese terms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-ascii-state-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        maxQueries: 1,
        coverageMode: 'all-weak',
        queryVariantsPerTerm: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: '典中典', family: 'attack', evidenceCount: 0 }] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const raw = await readFile(statePath, 'utf8');
    assert.equal(/[^\x00-\x7F]/.test(raw), false);
    const state = JSON.parse(raw);
    const attempt = Object.values(state.termAttempts).find((item) => item.term === '典中典');
    assert.equal(attempt.attempts, 1);
    assert.equal(attempt.query, undefined);
    assert.equal(attempt.lastQuery, '典中典 Bilibili comment meme');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary skips seen queries and videos from persistent state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-seen-'));
  const statePath = join(dir, 'state.json');
  try {
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async () => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV1111111111' }],
          comments: [],
          entries: [],
        }),
      },
    );

    const second = await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic', 'new seed'],
        maxQueries: 2,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: 'BV2222222222' }],
          comments: [],
          entries: [],
          excludeBvidsEcho: payload.excludeBvids,
        }),
      },
    );

    assert.deepEqual(second.queries, ['new seed']);
    assert.deepEqual(second.results[0].result.excludeBvidsEcho, ['BV1111111111']);
    const state = await readKeywordHarvestState(statePath);
    assert.deepEqual(state.searchedQueries, ['new seed', 'seed topic']);
    assert.deepEqual(state.scannedBvids, ['BV1111111111', 'BV2222222222']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards discovery mode to video search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-mode-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        maxQueries: 1,
        discoveryMode: 'mixed',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(payloads[0].discoveryMode, 'mixed');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionary forwards controversy queries to video search', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-controversy-'));
  const statePath = join(dir, 'state.json');
  try {
    const payloads = [];
    await harvestKeywordDictionary(
      {
        seedQueries: ['seed topic'],
        controversyQueries: ['politics debate', 'game drama'],
        maxQueries: 1,
        discoveryMode: 'controversial',
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          payloads.push(payload);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: 'BV1111111111' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.deepEqual(payloads[0].controversyQueries, ['politics debate', 'game drama']);
    assert.equal(payloads[0].discoveryMode, 'controversial');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionaryRounds keeps running new unseen queries across rounds', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-rounds-'));
  const statePath = join(dir, 'state.json');
  try {
    const searched = [];
    const result = await harvestKeywordDictionaryRounds(
      {
        seedQueries: ['seed one', 'seed two'],
        maxQueries: 1,
        rounds: 3,
        discoveryLimit: 1,
        pages: 1,
        statePath,
      },
      {
        readKeywordDictionary: async () => ({ entries: [] }),
        searchVideoKeywords: async (payload) => {
          searched.push(payload.searchQueries[0]);
          return {
            ok: true,
            warnings: [],
            videos: [{ bvid: payload.searchQueries[0] === 'seed one' ? 'BV1111111111' : 'BV2222222222' }],
            comments: [],
            entries: [],
          };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.requestedRounds, 3);
    assert.equal(result.rounds.length, 3);
    assert.deepEqual(result.rounds.map((round) => round.queries), [['seed one'], ['seed two'], []]);
    assert.deepEqual(searched, ['seed one', 'seed two']);
    const state = await readKeywordHarvestState(statePath);
    assert.deepEqual(state.searchedQueries, ['seed one', 'seed two']);
    assert.deepEqual(state.scannedBvids, ['BV1111111111', 'BV2222222222']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('harvestKeywordDictionaryRounds stops early when evidence coverage is complete', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-harvest-covered-'));
  const statePath = join(dir, 'state.json');
  try {
    const result = await harvestKeywordDictionaryRounds(
      {
        seedQueries: ['seed one', 'seed two'],
        maxQueries: 1,
        rounds: 5,
        discoveryLimit: 1,
        pages: 1,
        statePath,
        targetEvidence: 3,
      },
      {
        readKeywordDictionary: async () => ({ entries: [{ term: 'done', family: 'attack', evidenceCount: 3 }] }),
        searchVideoKeywords: async (payload) => ({
          ok: true,
          warnings: [],
          videos: [{ bvid: payload.searchQueries[0] === 'seed one' ? 'BV1111111111' : 'BV2222222222' }],
          comments: [],
          entries: [],
        }),
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.rounds.length, 1);
    assert.equal(result.coverage.complete, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
