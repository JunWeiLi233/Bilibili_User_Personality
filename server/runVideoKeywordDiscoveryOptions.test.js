import test from 'node:test';
import assert from 'node:assert/strict';

import { buildVideoKeywordDiscoveryOptions } from './runVideoKeywordDiscoveryOptions.js';

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

