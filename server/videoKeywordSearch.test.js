import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONTROVERSY_SEARCH_QUERIES, DEFAULT_VIDEO_LINK, DEFAULT_VIDEO_SEARCH_QUERY, searchVideoKeywords } from './videoKeywordSearch.js';

test('searchVideoKeywords discovers backend videos when no video link is provided', async () => {
  const requestedUrls = [];
  const result = await searchVideoKeywords(
    { pages: 1, discoveryLimit: 1, discoveryMode: 'search' },
    {
      discoverVideosByKeyword: async (query, limit) => {
        assert.equal(query, DEFAULT_VIDEO_SEARCH_QUERY);
        assert.equal(limit, 1);
        return [{ bvid: 'BV19yGa61Ee6', sourceUrl: 'http://www.bilibili.com/video/av123' }];
      },
      fetchJson: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'backend default video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(DEFAULT_VIDEO_LINK, '');
  assert.equal(result.ok, true);
  assert.equal(result.video.bvid, 'BV19yGa61Ee6');
  assert.deepEqual(result.searchQueries, [DEFAULT_VIDEO_SEARCH_QUERY]);
  assert.equal(result.discoveredVideos.length, 1);
  assert.equal(requestedUrls.some((url) => url.includes('bvid=BV19yGa61Ee6')), true);
});

test('searchVideoKeywords rejects an explicitly invalid video link', async () => {
  const result = await searchVideoKeywords({ videoLink: 'not a bilibili video' });

  assert.equal(result.ok, false);
  assert.match(result.error, /BV/);
});

test('searchVideoKeywords reports target diagnostics when no backend videos are discovered', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86'],
    },
    {
      discoverVideosByKeyword: async () => [],
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.collectionDiagnostics.targetExistingTerms, ['\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86']);
  assert.equal(result.collectionDiagnostics.discoveredVideos, 0);
  assert.equal(result.collectionDiagnostics.scannedVideos, 0);
  assert.deepEqual(result.searchQueries, ['\u9f3b\u5c4e\u4e5f\u559d\u8fdb\u53bb\u4e86 \u70ed\u8bc4']);
});

test('searchVideoKeywords scans existing evidence source videos when discovery finds no videos', async () => {
  const scannedBvids = [];
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5f88\u61c2\u561b\u8001\u94c1 \u8bc4\u8bba\u533a',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      evidenceSourceVideoFallback: true,
      includeVideoContext: false,
      includeVideoObjectEvidence: false,
      targetExistingTerms: ['\u5f88\u61c2\u561b'],
    },
    {
      discoverVideosByKeyword: async () => [],
      readKeywordDictionary: async () => ({
        entries: [
          {
            term: '\u5f88\u61c2\u561b',
            family: 'attack',
            evidenceSources: [
              {
                source:
                  'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVsource001/, https://www.bilibili.com/video/BVsource002/',
                uid: 'BVsource001,BVsource002',
                sample: '\u5f88\u61c2\u561b\u8001\u94c1[doge]',
              },
            ],
          },
        ],
      }),
      fetchJson: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/x/web-interface/view')) {
          const bvid = new URL(textUrl).searchParams.get('bvid');
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid === 'BVsource001' ? 101 : 102,
              bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: new URL(textUrl).searchParams.get('oid'),
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '\u5f88\u61c2\u561b\u8001\u94c1[doge]' },
                like: 1,
                ctime: 1710000000,
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return {
          ok: true,
          entries: [],
          dictionaryEvidenceEntries: [{ term: '\u5f88\u61c2\u561b', family: 'attack' }],
          dictionary: { entries: [] },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(scannedBvids, ['BVsource001', 'BVsource002']);
  assert.equal(result.source, 'Bilibili public existing evidence-source video comment scan');
  assert.equal(result.collectionDiagnostics.scannedVideos, 2);
  assert.deepEqual(result.collectionDiagnostics.acceptedTerms, ['\u5f88\u61c2\u561b']);
  assert.equal(trainedPayloads[0].text.includes('\u5f88\u61c2\u561b\u8001\u94c1'), true);
  assert.deepEqual(trainedPayloads[0].targetExistingTerms, ['\u5f88\u61c2\u561b']);
});

test('searchVideoKeywords broadens existing evidence source fallback beyond discovery limit', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5927\u8c61\u611f\u5192\u4e86 \u5f39\u5e55',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      evidenceSourceVideoFallback: true,
      includeVideoContext: false,
      includeVideoObjectEvidence: false,
      targetExistingTerms: ['\u5927\u8c61\u611f\u5192\u4e86'],
    },
    {
      discoverVideosByKeyword: async () => [],
      readKeywordDictionary: async () => ({
        entries: [
          {
            term: '\u5927\u8c61\u611f\u5192\u4e86',
            family: 'evasion',
            evidenceSources: [
              {
                source:
                  'Bilibili public search-discovered video comment scan: https://www.bilibili.com/video/BVsource001/, https://www.bilibili.com/video/BVsource002/, https://www.bilibili.com/video/BVsource003/, https://www.bilibili.com/video/BVsource004/, https://www.bilibili.com/video/BVsource005/',
                uid: 'BVsource001,BVsource002,BVsource003,BVsource004,BVsource005',
                sample: '\u5927\u8c61\u611f\u5192\u4e86\uff0c\u957f\u9888\u9e7f\u5728\u51b0\u7bb1\u91cc',
              },
            ],
          },
        ],
      }),
      fetchJson: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/x/web-interface/view')) {
          const bvid = new URL(textUrl).searchParams.get('bvid');
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: scannedBvids.length,
              bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionaryEvidenceEntries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(scannedBvids, ['BVsource001', 'BVsource002', 'BVsource003', 'BVsource004', 'BVsource005']);
  assert.equal(result.collectionDiagnostics.scannedVideos, 5);
});

test('searchVideoKeywords reports target diagnostics when discovered video scans fail', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u75c5\u5927\u90ce \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u75c5\u5927\u90ce'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVfailscan01',
          title: '\u75c5\u5927\u90ce \u70ed\u8bc4\u590d\u76d8',
          sourceUrl: 'https://www.bilibili.com/video/BVfailscan01/',
        },
      ],
      fetchJson: async () => ({ code: -404, message: 'not found' }),
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.collectionDiagnostics.targetExistingTerms, ['\u75c5\u5927\u90ce']);
  assert.equal(result.collectionDiagnostics.discoveredVideos, 1);
  assert.equal(result.collectionDiagnostics.scannedVideos, 0);
  assert.equal(result.warnings.length > 0, true);
});

test('searchVideoKeywords skips already harvested discovered videos', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: 'seed topic',
      discoveryMode: 'search',
      discoveryLimit: 2,
      excludeBvids: ['BV19yGa61Ee6'],
      pages: 1,
    },
    {
      discoverVideosByKeyword: async () => [
        { bvid: 'BV19yGa61Ee6', sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/' },
        { bvid: 'BV1xx411c7mD', sourceUrl: 'https://www.bilibili.com/video/BV1xx411c7mD/' },
      ],
      fetchJson: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/x/web-interface/view')) {
          const bvid = new URL(textUrl).searchParams.get('bvid');
          return {
            code: 0,
            data: {
              aid: 456,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.video.bvid, 'BV1xx411c7mD');
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BV1xx411c7mD']);
});

test('searchVideoKeywords prioritizes target-relevant discovered videos during existing-only coverage', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u7c73\u7c89\u63a7\u8bc4 SU7',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8f66\u5bb6\u519b', '\u6ca1\u6709\u8f66\u5bb6\u519b'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '\u65b0SU7\u5f00\u4e86186\u516c\u91cc \u4f18\u70b9\u7f3a\u70b9',
          desc: '\u666e\u901a\u8bd5\u9a7e\u4f53\u9a8c',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVtarget1',
          title: '\u5c0f\u7c73SU7\u8bc4\u8bba\u533a\u8f66\u5bb6\u519b\u548c\u7c73\u7c89\u63a7\u8bc4\u4e89\u8bae',
          desc: '\u8ba8\u8bba\u6ca1\u6709\u8f66\u5bb6\u519b\u8fd9\u79cd\u8bf4\u6cd5',
          sourceUrl: 'https://www.bilibili.com/video/BVtarget1/',
        },
        {
          bvid: 'BVgeneric2',
          title: 'SU7 \u7eed\u822a\u6d4b\u8bd5',
          desc: '\u80fd\u8017\u6570\u636e',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric2/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVtarget1', 'BVgeneric1']);
  assert.deepEqual(scannedBvids.slice(0, 2), ['BVtarget1', 'BVgeneric1']);
});

test('searchVideoKeywords expands candidate discovery before selecting target-relevant videos', async () => {
  const requestedLimits = [];
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u8f66\u5bb6\u519b',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8f66\u5bb6\u519b'],
    },
    {
      discoverVideosByKeyword: async (_query, limit) => {
        requestedLimits.push(limit);
        return [
          {
            bvid: 'BVgeneric1',
            title: '\u8001\u8f66\u5bb6\u4e2a\u4e2a\u90fd\u662f\u597d\u6837\u7684',
            sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
          },
          {
            bvid: 'BVgeneric2',
            title: '\u65b0\u80fd\u6e90\u8f66\u4e89\u8bae\u70ed\u8bc4',
            sourceUrl: 'https://www.bilibili.com/video/BVgeneric2/',
          },
          {
            bvid: 'BVtarget1',
            title: '\u822a\u5929\u8f66\u5bb6\u519b\u4e89\u8bae\u590d\u76d8',
            sourceUrl: 'https://www.bilibili.com/video/BVtarget1/',
          },
        ];
      },
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, true);
  assert.equal(requestedLimits[0] > 1, true);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVtarget1']);
  assert.deepEqual(scannedBvids, ['BVtarget1']);
});

test('searchVideoKeywords scores whitespace query tokens when ranking target videos', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: 'SU7 \u8f66\u5bb6\u519b \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8f66\u5bb6\u519b'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '\u65b0SU7\u5165\u95e8VS\u9876\u914d',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVtarget1',
          title: '\u822a\u5929\u8f66\u5bb6\u519b\u70ed\u8bc4\u590d\u76d8',
          sourceUrl: 'https://www.bilibili.com/video/BVtarget1/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVtarget1']);
});

test('searchVideoKeywords ranks query-token matches even when the target term spelling differs', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97 \u79d1\u666e \u8bc4\u8bba\u533a',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '\u533b\u5b66\u79d1\u666e\u8bc4\u8bba\u533a\u95ee\u7b54',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVtarget1',
          title: '\u4e0d\u4f1a\u6709\u4eba\u771f\u89c9\u5f97\u8fd9\u662f\u79d1\u666e\u5427',
          sourceUrl: 'https://www.bilibili.com/video/BVtarget1/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVtarget1']);
});

test('searchVideoKeywords prefers comment-use aliases over ambiguous exact title matches', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVsong1',
          title: '\u9648\u745e\u6f14\u5531\u300a\u95ee\u767e\u5ea6\u300b\u592a\u597d\u542c\u4e86',
          desc: '\u97f3\u4e50MV',
          sourceUrl: 'https://www.bilibili.com/video/BVsong1/',
        },
        {
          bvid: 'BValias1',
          title: '\u8bc4\u8bba\u533a\u56de\u590d\uff1a\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417',
          desc: '\u70ed\u8bc4\u4e89\u8bae\u590d\u76d8',
          sourceUrl: 'https://www.bilibili.com/video/BValias1/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BValias1']);
});

test('searchVideoKeywords filters ambiguous exact title matches when alias queries miss', async () => {
  let fetchCalls = 0;
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVsong1',
          title: '\u9648\u745e\u6f14\u5531\u300a\u95ee\u767e\u5ea6\u300b\u592a\u597d\u542c\u4e86',
          desc: '\u97f3\u4e50MV',
          sourceUrl: 'https://www.bilibili.com/video/BVsong1/',
        },
        {
          bvid: 'BVask1',
          title: '\u3010\u767e\u5ea6\u95ee\u4e00\u95ee\u3011\u7b54\u9898\u6559\u7a0b',
          desc: '\u5de5\u5177\u6d4b\u8bd5',
          sourceUrl: 'https://www.bilibili.com/video/BVask1/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan ambiguous non-comment videos');
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
  assert.equal(trainedPayloads.length, 0);
});

test('searchVideoKeywords filters Baidu product and publicity videos for ask-baidu aliases', async () => {
  let fetchCalls = 0;
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVwenku1',
          title: '\u8bc4\u5ba1\u5c0f\u7ec4\u4eba\u540d\u6765\u81ea\u767e\u5ea6\u6587\u5e93\uff1f\u91c7\u8d2d\u4e2d\u6807\u7ed3\u679c\u5f15\u4e89\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVwenku1/',
        },
        {
          bvid: 'BVpr1',
          title: '\u767e\u5ea6\u201c\u516c\u5173\u4e00\u53f7\u4f4d\u201d \u7490\u9759\u5df2\u79bb\u804c \u6b64\u524d\u56e0\u53d1\u5e03\u4e89\u8bae\u8a00\u8bba\u5f15\u70ed\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVpr1/',
        },
        {
          bvid: 'BVsong1',
          title: '\u8fd9\u6bb5\u65f6\u95f4\u8fd9\u9996\u6b4c\u53c8\u706b\u4e86\uff0c\u300a\u95ee\u767e\u5ea6\u300b\u9648\u745e\u6f14\u5531',
          sourceUrl: 'https://www.bilibili.com/video/BVsong1/',
        },
        {
          bvid: 'BVreply1',
          title: '\u3010\u4e92\u5173\u4e00\u4e0b\u8bc4\u8bba\u4e00\u5b9a\u56de\u590d\u3011\u6700\u65b0\u89c6\u9891\u4e0a\u7ebf',
          sourceUrl: 'https://www.bilibili.com/video/BVreply1/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan Baidu product, publicity, song, or generic reply videos');
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
  assert.equal(trainedPayloads.length, 0);
});

test('searchVideoKeywords filters Baidu product videos for conversational ask-baidu aliases', async () => {
  let fetchCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 3,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVwenku1',
          title: '\u8bc4\u5ba1\u5c0f\u7ec4\u4eba\u540d\u6765\u81ea\u767e\u5ea6\u6587\u5e93\uff1f\u91c7\u8d2d\u4e2d\u6807\u7ed3\u679c\u5f15\u4e89\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVwenku1/',
        },
        {
          bvid: 'BVpan1',
          title: '\u4fc4\u5267\u300a\u7231\u4e0d\u4f1a\u91cd\u6765\u300b\u8d85\u6e05\u4e2d\u5b57\u767e\u5ea6\u7f51\u76d8\u5168\u96c6\u5df2\u6574\u7406',
          sourceUrl: 'https://www.bilibili.com/video/BVpan1/',
        },
        {
          bvid: 'BVpr1',
          title: '\u767e\u5ea6\u201c\u516c\u5173\u4e00\u53f7\u4f4d\u201d \u7490\u9759\u5df2\u79bb\u804c \u6b64\u524d\u56e0\u53d1\u5e03\u4e89\u8bae\u8a00\u8bba\u5f15\u70ed\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVpr1/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan Baidu product, netdisk, or publicity videos');
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
});

test('searchVideoKeywords rejects exact ask-baidu alias matches inside Baidu product titles', async () => {
  let fetchCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u4e0d\u4f1a\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVproduct1',
          title: '\u4e0d\u4f1a\u767e\u5ea6\u7f51\u76d8\u9650\u901f\u600e\u4e48\u529e\uff1f\u5b98\u65b9APP\u6559\u7a0b',
          sourceUrl: 'https://www.bilibili.com/video/BVproduct1/',
        },
        {
          bvid: 'BVproduct2',
          title: '\u4e0d\u4f1a\u767e\u5ea6\u6587\u5e93\u4e0b\u8f7d\uff1f\u8fd9\u4e2a\u529e\u6cd5\u89e3\u51b3',
          sourceUrl: 'https://www.bilibili.com/video/BVproduct2/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan exact alias matches inside Baidu product titles');
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
});

test('searchVideoKeywords does not treat reply and hot-comment scaffolding as target relevance', async () => {
  let fetchCalls = 0;
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u81ea\u5df1\u767e\u5ea6 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVreply1',
          title: '\u4e92\u5173\u4e00\u4e0b\u8bc4\u8bba\u4e00\u5b9a\u56de\u590d',
          sourceUrl: 'https://www.bilibili.com/video/BVreply1/',
        },
        {
          bvid: 'BVhot1',
          title: 'B\u7ad9\u8bc4\u8bba\u533a\u6309\u70ed\u5ea6\u6392\u5e8f\u4e22\u70ed\u8bc4',
          sourceUrl: 'https://www.bilibili.com/video/BVhot1/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan generic reply/comment videos');
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
  assert.equal(trainedPayloads.length, 0);
});

test('searchVideoKeywords avoids scanning zero-relevance videos for target coverage', async () => {
  let fetchCalls = 0;
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u8c01\u662f\u8e6d\u6982\u5ff5',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8e6d\u6982\u5ff5', '\u8c01\u662f\u8e6d\u6982\u5ff5'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '\u94de\u548c\u52a0\u6025\u662f\u4e0d\u540c\u7684\u6982\u5ff5',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVgeneric2',
          title: '\u8fd9\u4e2a\u6982\u5ff5\u5230\u5e95\u662f\u4ec0\u4e48',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric2/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan unrelated videos');
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionaryEvidenceEntries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
  assert.equal(trainedPayloads.length, 0);
});

test('searchVideoKeywords does not direct-probe filtered ask-baidu search noise', async () => {
  let fetchCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u4f60\u4e0d\u4f1a\u767e\u5ea6\u5417 \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgenericReply',
          title: '\u81ea\u52a8\u56de\u590d\u8bc4\u8bba',
          sourceUrl: 'https://www.bilibili.com/video/BVgenericReply/',
        },
        {
          bvid: 'BVpan',
          title: '\u4fc4\u5267\u300a\u7231\u4e0d\u4f1a\u91cd\u6765\u300b\u8d85\u6e05\u4e2d\u5b57\u767e\u5ea6\u7f51\u76d8\u5168\u96c6\u5df2\u6574\u7406',
          sourceUrl: 'https://www.bilibili.com/video/BVpan/',
        },
        {
          bvid: 'BVnews',
          title: '\u767e\u5ea6\u201c\u516c\u5173\u4e00\u53f7\u4f4d\u201d \u7490\u9759\u5df2\u79bb\u804c \u6b64\u524d\u56e0\u53d1\u5e03\u4e89\u8bae\u8a00\u8bba\u5f15\u70ed\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVnews/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan filtered ask-baidu noise as a direct probe');
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
});

test('searchVideoKeywords probes direct search results when comment-backed target coverage has only filtered context', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457 \u8bc4\u8bba',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      allowFilteredDiscoveryFallback: true,
      targetExistingTerms: ['\u4e0d\u662f\u4eba\u4e86\u5457'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVdirectSearch1',
          title: '\u70ed\u95e8\u4e89\u8bae\u8bdd\u9898\u8ba8\u8bba',
          sourceUrl: 'https://www.bilibili.com/video/BVdirectSearch1/',
        },
        {
          bvid: 'BVdirectSearch2',
          title: '\u53e6\u4e00\u4e2a\u8bc4\u8bba\u533a\u8ba8\u8bba',
          sourceUrl: 'https://www.bilibili.com/video/BVdirectSearch2/',
        },
      ],
      fetchJson: async (url) => {
        const parsed = new URL(String(url));
        const bvid = parsed.searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid === 'BVdirectSearch1' ? 101 : 102,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: `${bvid}-1`,
                mid: 1,
                member: { uname: 'commenter' },
                content: { message: '\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457' },
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => ({
        ok: true,
        entries: [],
        dictionaryEvidenceEntries: [
          {
            term: '\u4e0d\u662f\u4eba\u4e86\u5457',
            family: 'attack',
            evidenceCount: payload.text.includes('\u5176\u4ed6\u4eba\u4e0d\u662f\u4eba\u4e86\u5457') ? 1 : 0,
          },
        ],
        dictionary: { entries: [] },
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(scannedBvids, ['BVdirectSearch1', 'BVdirectSearch2']);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVdirectSearch1', 'BVdirectSearch2']);
  assert.deepEqual(result.collectionDiagnostics.acceptedTerms, ['\u4e0d\u662f\u4eba\u4e86\u5457']);
});

test('searchVideoKeywords does not scan zero-relevance filtered results by default', async () => {
  let fetchCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5f88\u68d2\u5148\u751f \u8ba8\u8bba \u8bc4\u8bba\u533a \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u5f88\u68d2\u5148\u751f'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '\u86cb\u5148\u751f\u56e0\u4e3a\u6ca1\u8d34\u7eb8\u7834\u9632\uff0c\u8868\u793a\u81ea\u5df1\u5df2\u7ecf\u5f88\u68d2\u4e86',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVgeneric2',
          title: '\u91ce\u4eba\u5148\u751f\u51ed\u4ec0\u4e48\u8ba9\u5e74\u8f7b\u4eba\u75af\u72c2',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric2/',
        },
      ],
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan zero-relevance filtered search results');
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
});

test('searchVideoKeywords ignores generic query scaffolding when filtering target videos', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5982\u6b64\u91cd\u8981 \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVgeneric1',
          title: '#\u84b8\u6c7d\u8fb9\u57ce\u3010\u706b\u7206\u6f2b\u5267\u91cd\u78c5\u6765\u88ad\uff0c\u514d\u8d39\u89c2\u770b\u5168\u96c6\uff0c\u8bc4\u8bba\u533a\u94fe\u63a5\u81ea\u53d6\u3011',
          sourceUrl: 'https://www.bilibili.com/video/BVgeneric1/',
        },
        {
          bvid: 'BVtarget1',
          title: '\u8fd9\u4e00\u523b\u4ece\u672a\u611f\u89c9\u81ea\u5df1\u5982\u6b64\u91cd\u8981',
          sourceUrl: 'https://www.bilibili.com/video/BVtarget1/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionaryEvidenceEntries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BVtarget1']);
  assert.deepEqual(scannedBvids, ['BVtarget1']);
});

test('searchVideoKeywords rejects partial suffix matches for compact weak target terms', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u76f4\u64ad\u95f4\u8d35\u5bbe\u5f52\u96f6 \u8bc4\u8bba',
      discoveryMode: 'controversial',
      controversyQueries: ['\u76f4\u64ad \u4e89\u8bae'],
      controversialPopularQueryLimit: 0,
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8d35\u5bbe\u5f52\u96f6'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVbtc',
          title: 'Bitcoin will be ZERO \uff01\u672a\u6765\u5341\u5e74\u6570\u5b57\u8d27\u5e01\u90fd\u5c06\u5f52\u96f6',
          sourceUrl: 'https://www.bilibili.com/video/BVbtc/',
        },
        {
          bvid: 'BVnoble',
          title: '\u8d35\u65cf\u54e55\u5e74\u7684\u5fc3\u8840\u4e00\u591c\u5f52\u96f6',
          sourceUrl: 'https://www.bilibili.com/video/BVnoble/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), []);
  assert.deepEqual(scannedBvids, []);
});

test('searchVideoKeywords rejects generic head-word matches for alias-only weak targets', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5b85\u7537\u8054\u76df \u8bc4\u8bba\u533a',
      discoveryMode: 'controversial',
      controversyQueries: ['\u5b85\u7537 \u4e89\u8bae'],
      controversialPopularQueryLimit: 0,
      discoveryLimit: 2,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u5b85\u7537\u8054\u76df'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVprime',
          title: '\u8106\u5f31\u7684\u5b85\u7537\u9996\u76f8\u4e89\u8bae',
          sourceUrl: 'https://www.bilibili.com/video/BVprime/',
        },
        {
          bvid: 'BVstory',
          title: '\u5b85\u7537\u88ab\u9ed1\u7c89\u8bc8\u9a97\u7684\u6545\u4e8b',
          sourceUrl: 'https://www.bilibili.com/video/BVstory/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), []);
  assert.deepEqual(scannedBvids, []);
});

test('searchVideoKeywords rejects noisy search results when anchored weak alias query only returns head-word videos', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u7ec4\u5efa\u4e00\u53ea\u56fd\u9645\u5b85\u7537\u8054\u76df \u8bc4\u8bba\u533a \u6897 \u70ed\u8bc4',
      discoveryMode: 'controversial',
      controversyQueries: ['\u5b85\u7537 \u4e89\u8bae'],
      controversialPopularQueryLimit: 0,
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u56fd\u9645\u5b85\u7537\u8054\u76df', '\u5b85\u7537\u8054\u76df'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVprime',
          title: '\u8106\u6c14\u53e4\u602a\u4f46\u662f\u52a1\u5b9e\u7684\u201c\u5b85\u7537\u9996\u76f8\u201d',
          sourceUrl: 'https://www.bilibili.com/video/BVprime/',
        },
        {
          bvid: 'BVgoddess',
          title: '\u8425\u9500\u6ee1\u5929\u98de\uff0c\u8fd9\u56de\u6210\u4e3a\u5b85\u7537\u5973\u795e\u4e86\uff1f',
          sourceUrl: 'https://www.bilibili.com/video/BVgoddess/',
        },
        {
          bvid: 'BVkini',
          title: '\u65e5\u672c\u5b85\u7537Kini\u7684\u771f\u5b9e\u770b\u6cd5\u5927\u63ed\u79d8',
          sourceUrl: 'https://www.bilibili.com/video/BVkini/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), []);
  assert.deepEqual(scannedBvids, []);
});

test('searchVideoKeywords rejects noisy direct probes for compact mixed-script weak terms', async () => {
  const scannedBvids = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u679c\u8747play \u8bc4\u8bba\u533a',
      discoveryMode: 'search',
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u679c\u8747play'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVfruit',
          title: '\u6b8b\u7fc5\u679c\u8747\u306e\u5582\u98df\u9972\u517b\u548c\u7e41\u6b96',
          sourceUrl: 'https://www.bilibili.com/video/BVfruit/',
        },
        {
          bvid: 'BVcosplay',
          title: '\u5fa1\u82b1\u56ed\u91cc\u518d\u76f8\u89c1\uff0c\u8001\u767b\u7504\u5b1bcosplay\u73a9\u4e0d\u505c',
          sourceUrl: 'https://www.bilibili.com/video/BVcosplay/',
        },
      ],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          scannedBvids.push(bvid);
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), []);
  assert.deepEqual(scannedBvids, []);
});

test('searchVideoKeywords can discover popular videos without a search query', async () => {
  const requestedUrls = [];
  const result = await searchVideoKeywords(
    {
      searchQueries: [],
      discoveryMode: 'popular',
      discoveryLimit: 1,
      pages: 1,
    },
    {
      discoverPopularVideos: async (limit) => {
        assert.equal(limit, 1);
        return [{ bvid: 'BV1popular01', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }];
      },
      fetchJson: async (url) => {
        requestedUrls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 789,
              title: 'popular video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.discoveryMode, 'popular');
  assert.equal(result.video.bvid, 'BV1popular01');
  assert.equal(requestedUrls.some((url) => url.includes('bvid=BV1popular01')), true);
});

test('searchVideoKeywords mixed discovery combines search and popular sources', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: 'seed topic',
      discoveryMode: 'mixed',
      discoveryLimit: 2,
      pages: 1,
    },
    {
      discoverVideosByKeyword: async () => [{ bvid: 'BV1search001', sourceUrl: 'https://www.bilibili.com/video/BV1search001/' }],
      discoverPopularVideos: async () => [{ bvid: 'BV1popular01', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid === 'BV1search001' ? 111 : 222,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.discoveryMode, 'mixed');
  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1search001', 'BV1popular01']);
});

test('searchVideoKeywords controversial discovery mixes controversy seeds, search, and popular videos', async () => {
  const queried = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: 'dictionary term comments',
      controversyQueries: ['politics debate', 'game drama'],
      discoveryMode: 'controversial',
      discoveryLimit: 4,
      includeGenericPopular: true,
      pages: 1,
    },
    {
      discoverVideosByKeyword: async (query, _limit, options = {}) => {
        queried.push({ query, order: options.searchOrder || '' });
        if (options.searchOrder === 'click' && query === 'politics debate') {
          return [{ bvid: 'BV1hotPolitics', sourceUrl: 'https://www.bilibili.com/video/BV1hotPolitics/' }];
        }
        if (options.searchOrder === 'click' && query === 'game drama') {
          return [{ bvid: 'BV1hotGames1', sourceUrl: 'https://www.bilibili.com/video/BV1hotGames1/' }];
        }
        if (query === 'politics debate') return [{ bvid: 'BV1politics1', sourceUrl: 'https://www.bilibili.com/video/BV1politics1/' }];
        if (query === 'game drama') return [{ bvid: 'BV1gameDrama', sourceUrl: 'https://www.bilibili.com/video/BV1gameDrama/' }];
        return [{ bvid: 'BV1dictionary', sourceUrl: 'https://www.bilibili.com/video/BV1dictionary/' }];
      },
      discoverPopularVideos: async () => [{ bvid: 'BV1popular01', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.discoveryMode, 'controversial');
  assert.deepEqual(queried, [
    { query: 'politics debate', order: 'click' },
    { query: 'game drama', order: 'click' },
    { query: 'politics debate', order: '' },
    { query: 'game drama', order: '' },
    { query: 'dictionary term comments', order: '' },
  ]);
  assert.deepEqual(result.controversyQueries, ['politics debate', 'game drama']);
  assert.deepEqual(result.controversialPopularQueries, ['politics debate', 'game drama']);
  assert.equal(result.controversialPopularSearchOrder, 'click');
  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1hotPolitics', 'BV1politics1', 'BV1dictionary', 'BV1popular01']);
});

test('searchVideoKeywords controversial discovery skips generic popular feed by default', async () => {
  let popularCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: 'dictionary term comments',
      controversyQueries: ['politics debate'],
      discoveryMode: 'controversial',
      discoveryLimit: 3,
      pages: 1,
    },
    {
      discoverVideosByKeyword: async (query, _limit, options = {}) => {
        if (options.searchOrder === 'click') {
          return [{ bvid: 'BV1hotPolitics', sourceUrl: 'https://www.bilibili.com/video/BV1hotPolitics/' }];
        }
        if (query === 'politics debate') {
          return [{ bvid: 'BV1politics1', sourceUrl: 'https://www.bilibili.com/video/BV1politics1/' }];
        }
        return [{ bvid: 'BV1dictionary', sourceUrl: 'https://www.bilibili.com/video/BV1dictionary/' }];
      },
      discoverPopularVideos: async () => {
        popularCalls += 1;
        return [{ bvid: 'BV1popular01', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }];
      },
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(popularCalls, 0);
  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1hotPolitics', 'BV1politics1', 'BV1dictionary']);
});

test('searchVideoKeywords filters generic controversial videos for ambiguous alias-only targets', async () => {
  let fetchCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u767e\u5ea6\u4e00\u4e0b \u56de\u590d \u8bc4\u8bba\u533a \u70ed\u8bc4',
      controversyQueries: ['\u65f6\u653f \u70ed\u8bc4 \u8bc4\u8bba\u533a'],
      discoveryMode: 'controversial',
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u95ee\u767e\u5ea6', '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528'],
    },
    {
      discoverVideosByKeyword: async (query, _limit, options = {}) => {
        if (options.searchOrder === 'click') {
          return [
            {
              bvid: 'BVhot1',
              title: '\u5916\u7f51\u70ed\u8bc4 \u6700\u65b0\u6d88\u606f \u56fd\u9645\u793e\u4f1a\u65f6\u653f',
              sourceUrl: 'https://www.bilibili.com/video/BVhot1/',
            },
          ];
        }
        if (query.includes('\u65f6\u653f')) {
          return [
            {
              bvid: 'BVpolitics1',
              title: '2026\u4e00\u5468\u65f6\u653f \u8bc4\u8bba\u533a\u70ed\u8bae',
              sourceUrl: 'https://www.bilibili.com/video/BVpolitics1/',
            },
          ];
        }
        return [
          {
            bvid: 'BVwenku1',
            title: '\u8bc4\u5ba1\u5c0f\u7ec4\u4eba\u540d\u6765\u81ea\u767e\u5ea6\u6587\u5e93\uff1f\u91c7\u8d2d\u4e2d\u6807\u7ed3\u679c\u5f15\u4e89\u8bae',
            sourceUrl: 'https://www.bilibili.com/video/BVwenku1/',
          },
        ];
      },
      fetchJson: async () => {
        fetchCalls += 1;
        throw new Error('should not scan generic controversial or Baidu product videos');
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.equal(result.ok, false);
  assert.equal(fetchCalls, 0);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 0);
});

test('searchVideoKeywords can explicitly include generic popular videos in controversial discovery', async () => {
  let popularCalls = 0;
  const result = await searchVideoKeywords(
    {
      searchQuery: 'dictionary term comments',
      controversyQueries: ['politics debate'],
      discoveryMode: 'controversial',
      discoveryLimit: 4,
      includeGenericPopular: true,
      pages: 1,
    },
    {
      discoverVideosByKeyword: async (query, _limit, options = {}) => {
        if (options.searchOrder === 'click') {
          return [{ bvid: 'BV1hotPolitics', sourceUrl: 'https://www.bilibili.com/video/BV1hotPolitics/' }];
        }
        if (query === 'politics debate') {
          return [{ bvid: 'BV1politics1', sourceUrl: 'https://www.bilibili.com/video/BV1politics1/' }];
        }
        return [{ bvid: 'BV1dictionary', sourceUrl: 'https://www.bilibili.com/video/BV1dictionary/' }];
      },
      discoverPopularVideos: async () => {
        popularCalls += 1;
        return [{ bvid: 'BV1popular01', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }];
      },
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(popularCalls, 1);
  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1hotPolitics', 'BV1politics1', 'BV1dictionary', 'BV1popular01']);
});

test('searchVideoKeywords keeps controversial popular videos first during existing-only coverage', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: 'dictionary term comments',
      controversyQueries: ['politics debate'],
      discoveryMode: 'controversial',
      discoveryLimit: 4,
      pages: 1,
      existingTermsOnly: true,
    },
    {
      discoverVideosByKeyword: async (query, _limit, options = {}) => {
        if (query === 'dictionary term comments') {
          return [{ bvid: 'BV1dictionary', title: 'dictionary term comments', sourceUrl: 'https://www.bilibili.com/video/BV1dictionary/' }];
        }
        if (options.searchOrder === 'click') {
          return [{ bvid: 'BV1hotPolitics', title: 'hot politics', sourceUrl: 'https://www.bilibili.com/video/BV1hotPolitics/' }];
        }
        return [{ bvid: 'BV1politics1', title: 'politics', sourceUrl: 'https://www.bilibili.com/video/BV1politics1/' }];
      },
      discoverPopularVideos: async () => [{ bvid: 'BV1popular01', title: 'popular', sourceUrl: 'https://www.bilibili.com/video/BV1popular01/' }],
      fetchJson: async (url) => {
        const bvid = new URL(String(url)).searchParams.get('bvid');
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: bvid,
              title: bvid,
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async () => ({ ok: true, entries: [], dictionary: { entries: [] } }),
    },
  );

  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1hotPolitics', 'BV1politics1', 'BV1dictionary']);
});

test('default controversy seed list includes debate-heavy Bilibili topics', () => {
  const seeds = DEFAULT_CONTROVERSY_SEARCH_QUERIES.split('\n');
  assert.equal(seeds.some((seed) => seed.includes('\u65f6\u653f')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u6e38\u620f')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u738b\u8005\u8363\u8000') || seed.includes('\u539f\u795e')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u793e\u4f1a\u4e8b\u4ef6') || seed.includes('\u5f69\u793c')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u70ed\u8bc4')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u4e89\u8bae') || seed.includes('\u8282\u594f')), true);
});

test('default controversy seed list targets popular controversial verticals beyond generic hot videos', () => {
  const seeds = DEFAULT_CONTROVERSY_SEARCH_QUERIES.split('\n');
  assert.equal(seeds.some((seed) => seed.includes('\u56fd\u9645\u5173\u7cfb') || seed.includes('\u4e2d\u7f8e')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u6e38\u620f\u5382\u5546') || seed.includes('\u7c73\u54c8\u6e38')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u65b0\u80fd\u6e90\u8f66') || seed.includes('\u5c0f\u7c73\u6c7d\u8f66')), true);
  assert.equal(seeds.some((seed) => seed.includes('AI') && seed.includes('\u4e89\u8bae')), true);
  assert.equal(seeds.every((seed) => !/^\s*\u70ed\u95e8\s*$|^\s*\u70ed\u699c\s*$/.test(seed)), true);
});

test('searchVideoKeywords scans video comments and trains keyword dictionary', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=test',
      pages: 1,
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'sample video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 2 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '不会真有人觉得这叫证据吧' },
                like: 3,
                ctime: 1710000000,
                replies: [
                  {
                    rpid: 2,
                    mid: 101,
                    member: { mid: '101', uname: 'bob' },
                    content: { message: '懂的都懂，自己查' },
                    like: 1,
                    ctime: 1710000001,
                  },
                ],
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return {
          ok: true,
          available: true,
          model: 'deepseek-v4-flash',
          reasoningEffort: 'medium',
          usedFallback: false,
          entries: [
            { term: '不会真有人', family: 'attack', meaning: '反问式资格审查', variants: [] },
            { term: '懂的都懂', family: 'evasion', meaning: '拒绝举证并转移责任', variants: [] },
          ],
          dictionary: {
            families: {
              attack: ['不会真有人'],
              evasion: ['懂的都懂'],
            },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.video.bvid, 'BV19yGa61Ee6');
  assert.equal(result.comments.length, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(result.keywordTraining.model, 'deepseek-v4-flash');
  assert.equal(result.keywordTraining.reasoningEffort, 'medium');
  assert.equal(trainedPayloads.length, 1);
  assert.equal(trainedPayloads[0].uid, 'BV19yGa61Ee6');
  assert.equal(trainedPayloads[0].text.includes('不会真有人'), true);
});

test('searchVideoKeywords can include public danmaku in keyword training text', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      includeDanmaku: true,
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              cid: 456,
              title: 'sample video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      fetchText: async () => '<i><d p="1,1,25,16777215,1710000000,0,12345,0">别喷我</d></i>',
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return {
          ok: true,
          available: true,
          entries: [{ term: '\u522b\u55b7', family: 'attack', meaning: 'ask not to flame', variants: [] }],
          dictionary: { families: { attack: ['\u522b\u55b7'] } },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].kind, 'danmaku');
  assert.equal(trainedPayloads.length, 1);
  assert.equal(trainedPayloads[0].text.includes('\u522b\u55b7\u6211'), true);
});

test('searchVideoKeywords forwards existing-only training mode', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'sample video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: 'freshterm appears here' },
                like: 1,
                ctime: 1710000000,
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(trainedPayloads[0].existingTermsOnly, true);
  assert.equal(trainedPayloads[0].text.includes('Bilibili video context: sample video'), true);
  assert.equal(trainedPayloads[0].source.includes('plus video context'), true);
});

test('searchVideoKeywords forwards target existing terms to dictionary training', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u76ee\u6807\u5f31\u8bcd'],
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'target video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '\u76ee\u6807\u5f31\u8bcd appears here' },
                like: 1,
                ctime: 1710000000,
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(trainedPayloads[0].targetExistingTerms, ['\u76ee\u6807\u5f31\u8bcd']);
});

test('searchVideoKeywords can train existing terms from video context when comments are empty', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '典中典 是什么梗',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [{ term: '典中典', family: 'attack' }], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 0);
  assert.equal(result.videoContextText, 'Bilibili video context: 典中典 是什么梗');
  assert.equal(trainedPayloads[0].text, 'Bilibili video context: 典中典 是什么梗');
  assert.equal(result.entries[0].term, '典中典');
});

test('searchVideoKeywords can disable video context during existing-only comment refresh', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u5178\u4e2d\u5178'],
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '\u65e0\u5173\u641c\u7d22\u7ed3\u679c\u6807\u9898',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '\u53ea\u626b\u8bc4\u8bba\u5185\u5bb9' },
                like: 1,
                ctime: 1710000000,
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.videoContextText, '');
  assert.equal(trainedPayloads[0].text, '\u53ea\u626b\u8bc4\u8bba\u5185\u5bb9');
  assert.equal(trainedPayloads[0].text.includes('\u5178\u4e2d\u5178'), false);
  assert.deepEqual(trainedPayloads[0].targetExistingTerms, ['\u5178\u4e2d\u5178']);
});

test('searchVideoKeywords uses matching public video titles as existing-term object evidence', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      targetExistingTerms: ['\u6401\u8fd9\u6401\u8fd9'],
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462\uff1f\u3010\u54d4\u54e9\u70ed\u8bc4003\u3011',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [{ term: '\u6401\u8fd9\u6401\u8fd9', family: 'attack' }], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.videoContextText, '');
  assert.equal(result.videoObjectEvidenceText, 'Bilibili public video title: \u4f60\u6401\u8fd9\u6401\u8fd9\u5462\uff1f\u3010\u54d4\u54e9\u70ed\u8bc4003\u3011');
  assert.equal(trainedPayloads[0].text, result.videoObjectEvidenceText);
  assert.equal(trainedPayloads[0].source.includes('plus video object evidence'), true);
});

test('searchVideoKeywords can disable public video titles as existing-term object evidence', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLink: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
      pages: 1,
      existingTermsOnly: true,
      includeVideoContext: false,
      includeVideoObjectEvidence: false,
      targetExistingTerms: ['\u6401\u8fd9\u6401\u8fd9'],
    },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '\u4f60\u6401\u8fd9\u6401\u8fd9\u5462\uff1f\u3010\u54d4\u54e9\u70ed\u8bc4003\u3011',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.videoContextText, '');
  assert.equal(result.videoObjectEvidenceText, '');
  assert.equal(trainedPayloads.length, 0);
});

test('searchVideoKeywords includes discovered search-result video context for existing terms', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: 'hard term',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BV1searchTitle',
          title: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u641c\u7d22\u7ed3\u679c\u6807\u9898',
          sourceUrl: 'https://www.bilibili.com/video/BV1searchTitle/',
        },
      ],
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'resolved title without keyword',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [{ term: '\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97', family: 'attack' }], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.videoContextText.includes('Bilibili video context: resolved title without keyword'), true);
  assert.equal(result.videoContextText.includes('Bilibili video context: \u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97 \u641c\u7d22\u7ed3\u679c\u6807\u9898'), true);
  assert.equal(trainedPayloads[0].text.includes('\u4e0d\u4f1a\u771f\u6709\u4eba\u89c9\u5f97'), true);
});

test('searchVideoKeywords keeps excluded search-result metadata as video context', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: 'hard term',
      discoveryMode: 'search',
      discoveryLimit: 1,
      excludeBvids: ['BV1excluded'],
      pages: 1,
      existingTermsOnly: true,
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BV1excluded',
          title: '\u8e6d\u6982\u5ff5 \u641c\u7d22\u7ed3\u679c\u6807\u9898',
          sourceUrl: 'https://www.bilibili.com/video/BV1excluded/',
        },
        {
          bvid: 'BV1freshVideo',
          title: 'fresh search result',
          sourceUrl: 'https://www.bilibili.com/video/BV1freshVideo/',
        },
      ],
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 456,
              title: 'fresh resolved title',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [{ term: '\u8e6d\u6982\u5ff5', family: 'attack' }], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.discoveredVideos.map((video) => video.bvid), ['BV1freshVideo']);
  assert.equal(result.videoContextText.includes('Bilibili video context: \u8e6d\u6982\u5ff5 \u641c\u7d22\u7ed3\u679c\u6807\u9898'), true);
  assert.equal(trainedPayloads[0].source.includes('BV1excluded'), true);
});

test('searchVideoKeywords can train from excluded search-result context when no fresh videos remain', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      searchQuery: 'hard term',
      discoveryMode: 'search',
      discoveryLimit: 1,
      excludeBvids: ['BV1excluded'],
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8e6d\u6982\u5ff5'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BV1excluded',
          title: '\u8e6d\u6982\u5ff5 \u641c\u7d22\u7ed3\u679c\u6807\u9898',
          sourceUrl: 'https://www.bilibili.com/video/BV1excluded/',
        },
      ],
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return { ok: true, entries: [{ term: '\u8e6d\u6982\u5ff5', family: 'attack' }], dictionary: { entries: [] } };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.discoveredVideos, []);
  assert.equal(result.discoveryContextVideos.length, 1);
  assert.equal(result.videoContextText.includes('\u8e6d\u6982\u5ff5 \u641c\u7d22\u7ed3\u679c\u6807\u9898'), true);
  assert.equal(trainedPayloads.length, 1);
  assert.deepEqual(trainedPayloads[0].targetExistingTerms, ['\u8e6d\u6982\u5ff5']);
  assert.equal(trainedPayloads[0].source.includes('BV1excluded'), true);
});

test('searchVideoKeywords reports per-query collection diagnostics', async () => {
  const result = await searchVideoKeywords(
    {
      searchQuery: '\u5c0f\u7c73\u6c7d\u8f66 \u8f66\u5bb6\u519b \u63a7\u8bc4',
      discoveryMode: 'search',
      discoveryLimit: 1,
      pages: 1,
      existingTermsOnly: true,
      targetExistingTerms: ['\u8f66\u5bb6\u519b'],
    },
    {
      discoverVideosByKeyword: async () => [
        {
          bvid: 'BVdiagnostic',
          title: '\u5c0f\u7c73\u6c7d\u8f66 \u63a7\u8bc4 \u70ed\u8bae',
          desc: '\u8bc4\u8bba\u533a\u5728\u8ba8\u8bba\u8f66\u5bb6\u519b',
          sourceUrl: 'https://www.bilibili.com/video/BVdiagnostic/',
        },
      ],
      fetchJson: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 456,
              title: '\u5c0f\u7c73\u6c7d\u8f66 \u63a7\u8bc4 \u70ed\u8bae',
              desc: '\u8bc4\u8bba\u533a\u5728\u8ba8\u8bba\u8f66\u5bb6\u519b',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: 100,
                member: { uname: 'viewer' },
                content: { message: '\u8fd9\u91cc\u6ca1\u770b\u5230\u8bcd\u5178\u8bcd' },
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async () => ({
        ok: true,
        entries: [],
        evidenceRejected: 1,
        dictionaryEvidenceEntries: [],
        dictionary: { entries: [] },
      }),
    },
  );

  assert.equal(result.collectionDiagnostics.discoveredVideos, 1);
  assert.equal(result.collectionDiagnostics.scannedVideos, 1);
  assert.equal(result.collectionDiagnostics.commentsCollected, 1);
  assert.equal(result.collectionDiagnostics.trainingTextChars > 0, true);
  assert.deepEqual(result.collectionDiagnostics.targetExistingTerms, ['\u8f66\u5bb6\u519b']);
  assert.deepEqual(result.collectionDiagnostics.acceptedTerms, []);
  assert.equal(result.collectionDiagnostics.evidenceRejected, 1);
  assert.equal(result.collectionDiagnostics.sampleVideos[0].bvid, 'BVdiagnostic');
});

test('searchVideoKeywords scans multiple backend video links and trains one merged dictionary pass', async () => {
  const trainedPayloads = [];
  const result = await searchVideoKeywords(
    {
      videoLinks: ['https://www.bilibili.com/video/BV19yGa61Ee6/', 'https://www.bilibili.com/video/BV1xx411c7mD/'],
      pages: 1,
    },
    {
      fetchJson: async (url) => {
        const textUrl = String(url);
        if (textUrl.includes('/x/web-interface/view')) {
          const bvid = new URL(textUrl).searchParams.get('bvid');
          return {
            code: 0,
            data: {
              aid: bvid === 'BV19yGa61Ee6' ? 123 : 456,
              title: bvid === 'BV19yGa61Ee6' ? 'first video' : 'second video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        const oid = new URL(textUrl).searchParams.get('oid');
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: oid,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: oid === '123' ? '单走一个6' : '问百度有什么用' },
                like: 3,
                ctime: 1710000000,
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
      trainKeywordDictionary: async (payload) => {
        trainedPayloads.push(payload);
        return {
          ok: true,
          available: true,
          model: 'deepseek-v4-flash',
          reasoningEffort: 'medium',
          usedFallback: false,
          entries: [
            { term: '单走一个6', family: 'attack', meaning: '弹幕式嘲讽', variants: [] },
            { term: '问百度', family: 'evasion', meaning: '转移解释责任', variants: [] },
          ],
          dictionary: {
            families: {
              attack: ['单走一个6'],
              evasion: ['问百度'],
            },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.videos.length, 2);
  assert.equal(result.comments.length, 2);
  assert.equal(result.entries.length, 2);
  assert.equal(trainedPayloads.length, 1);
  assert.equal(trainedPayloads[0].uid, 'BV19yGa61Ee6,BV1xx411c7mD');
  assert.equal(trainedPayloads[0].text.includes('单走一个6'), true);
  assert.equal(trainedPayloads[0].text.includes('问百度'), true);
});
