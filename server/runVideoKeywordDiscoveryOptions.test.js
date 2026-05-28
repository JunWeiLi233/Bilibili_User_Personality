import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVideoKeywordDiscoveryOptions, parsePriorityQueryContent } from './runVideoKeywordDiscoveryOptions.js';

test('buildVideoKeywordDiscoveryOptions forwards strict comment-backed coverage flags', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_HARVEST_REQUIRE_SOURCES: '1',
      BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
      BILIBILI_HARVEST_EXISTING_TERMS_ONLY: '1',
      BILIBILI_HARVEST_PRIORITY_QUERY_FILE: 'server/keywordCoverageQueries.txt',
    },
    priorityQueries: ['contextOnly 评论区'],
    seedQueries: [],
  });

  assert.equal(options.requireSourceBackedEvidence, true);
  assert.equal(options.requireCommentBackedEvidence, true);
  assert.equal(options.prioritizeSourceGaps, true);
  assert.equal(options.existingTermsOnly, true);
  assert.deepEqual(options.priorityQueries, ['contextOnly 评论区']);
});

test('buildVideoKeywordDiscoveryOptions treats comment evidence as source-backed evidence', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
    },
  });

  assert.equal(options.requireCommentBackedEvidence, true);
  assert.equal(options.requireSourceBackedEvidence, true);
  assert.equal(options.prioritizeSourceGaps, true);
});

test('buildVideoKeywordDiscoveryOptions moves to unattempted terms sooner in strict comment mode', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
    },
  });

  assert.equal(options.retryBeforeUnattemptedLimit, 1);
});

test('buildVideoKeywordDiscoveryOptions lets direct harvest retry override strict comment default', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS: '1',
      BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT: '4',
    },
  });

  assert.equal(options.retryBeforeUnattemptedLimit, 4);
});

test('buildVideoKeywordDiscoveryOptions forwards per-query harvest timeout', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_HARVEST_QUERY_TIMEOUT_MS: '45000',
    },
  });

  assert.equal(options.perQueryTimeoutMs, 45000);
});

test('buildVideoKeywordDiscoveryOptions can enable comment target expansion', () => {
  const options = buildVideoKeywordDiscoveryOptions({
    env: {
      BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS: '1',
    },
  });

  assert.equal(options.expandTargetsFromComments, true);
});

test('parsePriorityQueryContent preserves structured audit action targets', () => {
  const priorityQueries = parsePriorityQueryContent(
    JSON.stringify([
      {
        term: '车家军',
        family: 'attack',
        query: '车圈 车家军 热评',
        nextQuery: '车圈 车家军 热评',
        suggestedQueries: ['小米汽车 车家军 控评'],
      },
      {
        term: '没有车家军',
        family: 'attack',
        query: '车圈 车家军 热评',
        nextQuery: '车圈 车家军 热评',
      },
    ]),
  );

  assert.equal(priorityQueries.length, 2);
  assert.deepEqual(
    priorityQueries.map((item) => ({ term: item.term, query: item.query, nextQuery: item.nextQuery })),
    [
      { term: '车家军', query: '车圈 车家军 热评', nextQuery: '车圈 车家军 热评' },
      { term: '没有车家军', query: '车圈 车家军 热评', nextQuery: '车圈 车家军 热评' },
    ],
  );
});

test('parsePriorityQueryContent keeps legacy text query files working', () => {
  assert.deepEqual(parsePriorityQueryContent('车圈 车家军 热评\n不会百度 回复 评论区 热评\n'), [
    '车圈 车家军 热评',
    '不会百度 回复 评论区 热评',
  ]);
});

test('parsePriorityQueryContent supports JSON lines without splitting object commas', () => {
  const priorityQueries = parsePriorityQueryContent(
    [
      JSON.stringify({ term: '问百度', family: 'evasion', nextQuery: '不会百度 回复 评论区 热评' }),
      JSON.stringify({ term: '问百度有什么用', family: 'evasion', nextQuery: '不会百度 回复 评论区 热评' }),
    ].join('\n'),
  );

  assert.deepEqual(priorityQueries.map((item) => item.term), ['问百度', '问百度有什么用']);
  assert.deepEqual(priorityQueries.map((item) => item.nextQuery), ['不会百度 回复 评论区 热评', '不会百度 回复 评论区 热评']);
});
