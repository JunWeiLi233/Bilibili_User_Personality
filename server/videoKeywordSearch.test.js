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
      discoveryLimit: 3,
      pages: 1,
    },
    {
      discoverVideosByKeyword: async (query) => {
        queried.push(query);
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
  assert.deepEqual(queried, ['politics debate', 'game drama', 'dictionary term comments']);
  assert.deepEqual(result.controversyQueries, ['politics debate', 'game drama']);
  assert.deepEqual(result.videos.map((video) => video.bvid), ['BV1politics1', 'BV1dictionary', 'BV1popular01']);
});

test('default controversy seed list includes debate-heavy Bilibili topics', () => {
  const seeds = DEFAULT_CONTROVERSY_SEARCH_QUERIES.split('\n');
  assert.equal(seeds.some((seed) => seed.includes('\u65f6\u653f')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u6e38\u620f')), true);
  assert.equal(seeds.some((seed) => seed.includes('\u4e89\u8bae') || seed.includes('\u8282\u594f')), true);
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
