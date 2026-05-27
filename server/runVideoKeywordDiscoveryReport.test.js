import test from 'node:test';
import assert from 'node:assert/strict';

import {
  priorityActionItemsFromCoverageActions,
  priorityActionItemsFromHarvestResult,
  serializeVideoKeywordDiscoveryReport,
} from './runVideoKeywordDiscoveryReport.js';

test('serializeVideoKeywordDiscoveryReport keeps per-query diagnostics for harvest triage', () => {
  const report = serializeVideoKeywordDiscoveryReport(
    {
      requestedRounds: 1,
      growth: { before: 1, after: 1 },
      coverage: { coverageRatio: 0.5 },
      coverageActions: [],
      state: { searchedQueries: ['target 评论区'] },
      rounds: [
        {
          queries: ['target 评论区'],
          candidateQueries: ['target 评论区'],
          growth: { before: 1, after: 1 },
          coverage: { evidenceDeficit: 2 },
          coverageProgress: { evidenceGained: 0, evidenceDeficitReduced: 0 },
          termAttemptSummary: { attemptedTerms: 1 },
          warnings: [],
          trainingDiagnostics: { deepseekCalls: 1, evidenceRejected: 2, dictionaryEvidenceTerms: 0 },
          queryDiagnostics: [
            {
              query: 'target 评论区',
              commentsCollected: 240,
              trainingTextChars: 4096,
              targetExistingTerms: ['target'],
              acceptedTerms: [],
              evidenceRejected: 2,
            },
          ],
          results: [
            {
              query: 'target 评论区',
              result: {
                ok: true,
                videos: [{ bvid: 'BV1target', title: 'target title', sourceUrl: 'https://www.bilibili.com/video/BV1target/' }],
                comments: [{ rpid: 1 }],
                keywordTraining: { evidenceRejected: 2, dictionaryEvidenceEntries: [] },
                entries: [],
              },
            },
          ],
        },
      ],
    },
    'state.json',
    'report.json',
  );

  assert.deepEqual(report.rounds[0].trainingDiagnostics, { deepseekCalls: 1, evidenceRejected: 2, dictionaryEvidenceTerms: 0 });
  assert.deepEqual(report.rounds[0].queryDiagnostics, [
    {
      query: 'target 评论区',
      commentsCollected: 240,
      trainingTextChars: 4096,
      targetExistingTerms: ['target'],
      acceptedTerms: [],
      evidenceRejected: 2,
    },
  ]);
});

test('serializeVideoKeywordDiscoveryReport counts accepted evidence by unique comment samples', () => {
  const report = serializeVideoKeywordDiscoveryReport(
    {
      requestedRounds: 1,
      growth: { before: 1, after: 1 },
      coverage: { coverageRatio: 0.5 },
      coverageActions: [],
      state: {},
      rounds: [
        {
          queries: ['sampleTerm comment'],
          candidateQueries: ['sampleTerm comment'],
          growth: { before: 1, after: 1 },
          coverage: { evidenceDeficit: 1 },
          coverageProgress: { evidenceGained: 1 },
          acceptedEvidenceCount: 2,
          coverageIncreasingAcceptedEvidenceCount: 1,
          termAttemptSummary: {},
          warnings: [],
          trainingDiagnostics: {},
          queryDiagnostics: [],
          results: [
            {
              query: 'sampleTerm comment',
              result: {
                ok: true,
                videos: [],
                comments: [{ rpid: 1 }, { rpid: 2 }],
                keywordTraining: { dictionaryEvidenceEntries: [] },
                entries: [
                  {
                    term: 'sampleTerm',
                    family: 'attack',
                    evidenceCount: 4,
                    evidenceSamples: ['sampleTerm first comment', 'sampleTerm second comment'],
                    evidenceSources: [
                      { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1111111111/', uid: 'BV1111111111', sample: 'sampleTerm first comment' },
                      { source: 'Bilibili public video comment scan: https://www.bilibili.com/video/BV1111111111/', uid: 'BV1111111111', sample: 'sampleTerm second comment' },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    'state.json',
    'report.json',
  );

  assert.equal(report.rounds[0].results[0].acceptedEvidenceCount, 2);
  assert.equal(report.rounds[0].acceptedEvidenceCount, 2);
  assert.equal(report.rounds[0].coverageIncreasingAcceptedEvidenceCount, 1);
});

test('priorityActionItemsFromCoverageActions serializes current non-empty next queries', () => {
  const items = priorityActionItemsFromCoverageActions([
    {
      term: 'old term',
      family: 'attack',
      action: 'none',
      status: 'covered',
      nextQuery: 'old term',
      suggestedQueries: ['old term alt'],
    },
    {
      term: 'next term',
      family: 'evidence',
      action: 'retry_with_new_variant',
      status: 'weak_missed',
      nextQuery: 'next term 评论区',
      suggestedQueries: ['next term 弹幕', ''],
    },
  ]);

  assert.deepEqual(
    items.map((item) => ({ term: item.term, query: item.query, nextQuery: item.nextQuery })),
    [
      { term: 'next term', query: 'next term 评论区', nextQuery: 'next term 评论区' },
      { term: 'next term', query: 'next term 弹幕', nextQuery: 'next term 弹幕' },
    ],
  );
});

test('priorityActionItemsFromHarvestResult prefers sorted audit next actions over raw coverage actions', () => {
  const items = priorityActionItemsFromHarvestResult({
    coverageActions: [
      { term: 'timeoutHeavy', family: 'cooperation', action: 'harvest_more_evidence', status: 'weak_partial', nextQuery: 'timeoutHeavy 评论区' },
      { term: 'betterNext', family: 'attack', action: 'retry_with_new_variant', status: 'weak_missed', nextQuery: 'betterNext 评论区' },
    ],
    priorityCoverageActions: [
      { term: 'betterNext', family: 'attack', action: 'retry_with_new_variant', status: 'weak_missed', nextQuery: 'betterNext 评论区' },
      { term: 'timeoutHeavy', family: 'cooperation', action: 'harvest_more_evidence', status: 'weak_partial', nextQuery: 'timeoutHeavy 评论区' },
    ],
  });

  assert.deepEqual(items.map((item) => item.term), ['betterNext', 'timeoutHeavy']);
});
