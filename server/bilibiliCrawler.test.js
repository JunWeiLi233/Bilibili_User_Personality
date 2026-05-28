import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeUid,
  collectReplyForUid,
  dedupePublicObjects,
  discoverVideosByKeyword,
  discoverPopularVideos,
  extractBvid,
  extractDynamicRecords,
  fetchJson,
  fetchReplyThread,
  fetchRepliesForVideo,
  isBilibiliBlockResponse,
  parseDanmakuXml,
  parseBvidPool,
  resetBilibiliRequestState,
} from './bilibiliCrawler.js';

test('fetchReplyThread collects nested replies for a root comment across pages', async () => {
  const seen = [];
  const video = { bvid: 'BVx', oid: '123', replyType: 1, title: 't', sourceUrl: 'https://www.bilibili.com/video/BVx/' };
  const thread = await fetchReplyThread(video, '999', { pages: 2 }, {
    fetchJson: async (url) => {
      seen.push(String(url));
      if (String(url).includes('pn=1')) {
        return { code: 0, data: { replies: [{ rpid: 1, mid: 5, member: { mid: '5', uname: 'a' }, content: { message: '网盘见 +1' } }], page: { count: 40, size: 20, num: 1 } } };
      }
      return { code: 0, data: { replies: [{ rpid: 2, mid: 6, member: { mid: '6', uname: 'b' }, content: { message: '对，网盘见' } }], page: { count: 40, size: 20, num: 2 } } };
    },
  });
  assert.equal(thread.length, 2);
  assert.equal(thread.every((c) => c.message.includes('网盘见')), true);
  assert.equal(seen.some((u) => u.includes('/x/v2/reply/reply') && u.includes('root=999')), true);
});

test('fetchRepliesForVideo deepens reply threads only for term-bearing root comments', async () => {
  const calls = [];
  const result = await fetchRepliesForVideo(
    'BV1xx411c7mD',
    { pages: 1, deepenMatch: (msg) => /网盘见/.test(msg), deepenRootLimit: 3, deepenPages: 1 },
    {
      fetchJson: async (url) => {
        calls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return { code: 0, data: { aid: 123, title: 'v', owner: { mid: 9 }, stat: { reply: 5 } } };
        }
        if (String(url).includes('/x/v2/reply/main')) {
          return {
            code: 0,
            data: {
              replies: [
                { rpid: 100, mid: 1, member: { mid: '1', uname: 'root' }, content: { message: '网盘见' }, rcount: 5, replies: [] },
                { rpid: 200, mid: 2, member: { mid: '2', uname: 'other' }, content: { message: '无关评论' }, rcount: 0, replies: [] },
              ],
              cursor: { is_end: true, next: 0 },
            },
          };
        }
        if (String(url).includes('/x/v2/reply/reply')) {
          return {
            code: 0,
            data: {
              replies: [
                { rpid: 101, mid: 3, member: { mid: '3', uname: 'r1' }, content: { message: '真的网盘见' } },
                { rpid: 102, mid: 4, member: { mid: '4', uname: 'r2' }, content: { message: '网盘见+1' } },
              ],
              page: { count: 2, size: 20, num: 1 },
            },
          };
        }
        return { code: 0, data: {} };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some((u) => u.includes('/x/v2/reply/reply') && u.includes('root=100')), true);
  assert.equal(calls.some((u) => u.includes('root=200')), false);
  const messages = result.comments.map((c) => c.message);
  assert.equal(messages.includes('真的网盘见'), true);
  assert.equal(messages.includes('网盘见+1'), true);
  assert.equal(result.comments.length, 4);
});

test('fetchRepliesForVideo skips deepening when no deepenMatch is provided', async () => {
  const calls = [];
  const result = await fetchRepliesForVideo(
    'BV1xx411c7mD',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        calls.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return { code: 0, data: { aid: 123, title: 'v', owner: { mid: 9 }, stat: { reply: 5 } } };
        }
        if (String(url).includes('/x/v2/reply/main')) {
          return {
            code: 0,
            data: { replies: [{ rpid: 100, mid: 1, member: { mid: '1', uname: 'root' }, content: { message: '网盘见' }, rcount: 5, replies: [] }], cursor: { is_end: true, next: 0 } },
          };
        }
        return { code: 0, data: {} };
      },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.some((u) => u.includes('/x/v2/reply/reply')), false);
  assert.equal(result.comments.length, 1);
});

test('discoverVideosByKeyword searches Bilibili and normalizes video objects', async () => {
  const seenUrls = [];
  const videos = await discoverVideosByKeyword('阴阳怪气', 2, {
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return {
        code: 0,
        data: {
          result: [
            {
              aid: 123,
              bvid: 'BV19yGa61Ee6',
              title: '<em class="keyword">阴阳怪气</em> sample',
              mid: 9,
              arcurl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
              review: 12,
            },
          ],
        },
      };
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].bvid, 'BV19yGa61Ee6');
  assert.equal(videos[0].title, '阴阳怪气 sample');
  assert.equal(videos[0].replyCount, 12);
  assert.equal(seenUrls[0].url.includes('/x/web-interface/search/type'), true);
  assert.equal(seenUrls[0].url.includes('search_type=video'), true);
  assert.equal(seenUrls[0].referer.includes('search.bilibili.com'), true);
});

test('discoverVideosByKeyword can request a search order for popular controversial seeds', async () => {
  const seenUrls = [];
  await discoverVideosByKeyword('游戏 节奏 评论区', 2, {
    searchOrder: 'click',
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return { code: 0, data: { result: [] } };
    },
  });

  const parsed = new URL(seenUrls[0].url);
  assert.equal(parsed.searchParams.get('keyword'), '游戏 节奏 评论区');
  assert.equal(parsed.searchParams.get('order'), 'click');
});

test('discoverVideosByKeyword can scan multiple search result pages', async () => {
  const seenPages = [];
  const videos = await discoverVideosByKeyword('hard term', 2, {
    searchPages: 2,
    fetchJson: async (url) => {
      const parsed = new URL(String(url));
      const page = parsed.searchParams.get('page');
      seenPages.push(page);
      if (page === '1') return { code: 0, data: { result: [] } };
      return {
        code: 0,
        data: {
          result: [
            {
              aid: 456,
              bvid: 'BV1pageTwo',
              title: 'page two result',
              mid: 9,
              arcurl: 'https://www.bilibili.com/video/BV1pageTwo/',
              review: 3,
            },
          ],
        },
      };
    },
  });

  assert.deepEqual(seenPages, ['1', '2']);
  assert.deepEqual(videos.map((video) => video.bvid), ['BV1pageTwo']);
});

test('discoverPopularVideos reads public popular videos and normalizes video objects', async () => {
  const seenUrls = [];
  const videos = await discoverPopularVideos(2, {
    fetchJson: async (url, referer) => {
      seenUrls.push({ url: String(url), referer });
      return {
        code: 0,
        data: {
          list: [
            {
              aid: 456,
              bvid: 'BV1xx411c7mD',
              title: 'popular sample',
              owner: { mid: 8 },
              stat: { reply: 22 },
            },
          ],
        },
      };
    },
  });

  assert.equal(videos.length, 1);
  assert.equal(videos[0].bvid, 'BV1xx411c7mD');
  assert.equal(videos[0].title, 'popular sample');
  assert.equal(videos[0].replyCount, 22);
  assert.equal(seenUrls[0].url.includes('/x/web-interface/popular'), true);
  assert.equal(seenUrls[0].referer, 'https://www.bilibili.com/v/popular/all');
});

test('parseBvidPool accepts whitespace, comma, and Chinese comma separators', () => {
  assert.deepEqual(parseBvidPool('BV19yGa61Ee6, BV1xx411c7mD，BVabc1234567  bad-id'), [
    'BV19yGa61Ee6',
    'BV1xx411c7mD',
    'BVabc1234567',
  ]);
});

test('extractBvid accepts BV ids and Bilibili video links', () => {
  assert.equal(extractBvid('BV19yGa61Ee6'), 'BV19yGa61Ee6');
  assert.equal(extractBvid('https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=abc'), 'BV19yGa61Ee6');
  assert.equal(extractBvid('https://b23.tv/BV1xx411c7mD'), 'BV1xx411c7mD');
  assert.equal(extractBvid('not-a-video'), '');
});

test('isBilibiliBlockResponse detects Bilibili block and rate-limit payloads', () => {
  assert.equal(isBilibiliBlockResponse({ code: -352 }), true);
  assert.equal(isBilibiliBlockResponse({ code: -412 }), true);
  assert.equal(isBilibiliBlockResponse({ code: 0 }), false);
});

test('fetchJson spaces requests and cools down after Bilibili block responses', async () => {
  resetBilibiliRequestState();
  let now = 1000;
  const waits = [];
  const responses = [{ code: 0, data: { ok: 1 } }, { code: -352, message: '-352' }, { code: 0, data: { ok: 2 } }];

  const options = {
    env: {},
    config: {
      minDelayMs: 100,
      jitterMs: 0,
      blockCooldownMs: 1000,
      cacheTtlMs: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => responses.shift(),
    }),
  };

  await fetchJson('https://api.bilibili.com/one', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/two', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/three', 'https://www.bilibili.com', options);

  assert.deepEqual(waits, [100, 1000]);
  resetBilibiliRequestState();
});

test('fetchJson backs off exponentially when consecutive Bilibili block responses occur', async () => {
  resetBilibiliRequestState();
  let now = 0;
  const waits = [];
  const responses = [
    { code: -352, message: '-352' },
    { code: -352, message: '-352' },
    { code: 0, data: {} },
  ];
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 100,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => now,
    randomFn: () => 0,
    waitFn: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    fetchImpl: async () => ({ ok: true, json: async () => responses.shift() }),
  };

  await fetchJson('https://api.bilibili.com/a', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/b', 'https://www.bilibili.com', options);
  await fetchJson('https://api.bilibili.com/c', 'https://www.bilibili.com', options);

  // First block: cooldown = 100. Second block: cooldown grows to 200 (2x). Third call waits 200ms.
  assert.deepEqual(waits, [100, 200]);
  resetBilibiliRequestState();
});

test('fetchJson sends a session-sticky user agent with Chrome client-hint headers and Bilibili cookies', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
    },
    nowFn: () => 1700000000000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (url, init) => {
      seenHeaders.push(init.headers);
      return { ok: true, json: async () => ({ code: 0, data: {} }) };
    },
  };

  await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', options);
  await fetchJson('https://api.bilibili.com/y', 'https://space.bilibili.com/123', options);

  assert.equal(seenHeaders.length, 2);
  assert.equal(seenHeaders[0]['user-agent'], seenHeaders[1]['user-agent']);
  assert.match(seenHeaders[0]['user-agent'], /Chrome\/\d+/);
  assert.equal(seenHeaders[0]['accept-language'], 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7');
  assert.ok(seenHeaders[0]['sec-ch-ua']);
  assert.equal(seenHeaders[0]['sec-ch-ua-mobile'], '?0');
  assert.match(seenHeaders[0]['sec-ch-ua-platform'], /"\w+"/);
  assert.equal(seenHeaders[0]['sec-fetch-mode'], 'cors');
  assert.equal(seenHeaders[0]['sec-fetch-dest'], 'empty');
  assert.equal(seenHeaders[0]['sec-fetch-site'], 'same-site');
  assert.equal(seenHeaders[0].origin, 'https://www.bilibili.com');
  assert.ok(seenHeaders[0].cookie.includes('buvid3='));
  assert.ok(seenHeaders[0].cookie.includes('b_nut='));
  assert.ok(seenHeaders[0].cookie.includes('_uuid='));
  resetBilibiliRequestState();
});

test('fetchJson uses configured Bilibili cookie when provided', async () => {
  resetBilibiliRequestState();
  const previousCookie = process.env.BILIBILI_COOKIE;
  process.env.BILIBILI_COOKIE = 'SESSDATA=session-value; bili_jct=csrf-value';
  try {
    const seenHeaders = [];
    await fetchJson('https://api.bilibili.com/x', 'https://www.bilibili.com/video/BVxxx/', {
      env: {},
      config: {
        minDelayMs: 0,
        jitterMs: 0,
        blockCooldownMs: 0,
        cacheTtlMs: 0,
        longPauseProbability: 0,
      },
      nowFn: () => 1700000000000,
      randomFn: () => 0,
      waitFn: async () => {},
      fetchImpl: async (_url, init) => {
        seenHeaders.push(init.headers);
        return { ok: true, json: async () => ({ code: 0, data: {} }) };
      },
    });

    assert.equal(seenHeaders[0].cookie, 'SESSDATA=session-value; bili_jct=csrf-value');
  } finally {
    if (previousCookie === undefined) {
      delete process.env.BILIBILI_COOKIE;
    } else {
      process.env.BILIBILI_COOKIE = previousCookie;
    }
    resetBilibiliRequestState();
  }
});

test('fetchJson can use a per-request Bilibili login cookie without caching it', async () => {
  resetBilibiliRequestState();
  const seenHeaders = [];
  let calls = 0;
  const options = {
    bilibiliCookie: 'SESSDATA=session-value; bili_jct=csrf-value; invalid; bad\r\nname=x',
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 60000,
      longPauseProbability: 0,
    },
    nowFn: () => 1700000000000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      calls += 1;
      seenHeaders.push(init.headers);
      return { ok: true, json: async () => ({ code: 0, data: { calls } }) };
    },
  };

  await fetchJson('https://api.bilibili.com/login-only', 'https://www.bilibili.com/video/BVxxx/', options);
  await fetchJson('https://api.bilibili.com/login-only', 'https://www.bilibili.com/video/BVxxx/', options);

  assert.equal(calls, 2);
  assert.match(seenHeaders[0].cookie, /SESSDATA=session-value/);
  assert.match(seenHeaders[0].cookie, /bili_jct=csrf-value/);
  assert.doesNotMatch(seenHeaders[0].cookie, /bad/);
  resetBilibiliRequestState();
});

test('analyzeUid forwards user Bilibili cookie through UID object scans', async () => {
  const seenCookies = [];
  const result = await analyzeUid(
    {
      uid: '453244911',
      objectLimit: 1,
      dynamicLimit: 0,
      pagesPerObject: 1,
      bilibiliCookie: 'SESSDATA=session-value; bili_jct=csrf-value',
    },
    {
      fetchJson: async (url, _referer, options = {}) => {
        seenCookies.push(options.bilibiliCookie || '');
        if (String(url).includes('/x/web-interface/card')) {
          return { code: 0, card: { mid: '453244911', name: 'target user', sign: '' } };
        }
        if (String(url).includes('/x/space/arc/search')) {
          return {
            code: 0,
            data: {
              list: {
                vlist: [
                  {
                    aid: 123,
                    bvid: 'BV19yGa61Ee6',
                    title: 'user upload',
                    author: 'target user',
                  },
                ],
              },
            },
          };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 1,
                mid: '453244911',
                member: { mid: '453244911', uname: 'target user' },
                content: { message: '\u767b\u5f55 cookie \u626b\u5230 UID \u4e92\u52a8' },
              },
            ],
            cursor: { is_end: true, next: 0 },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(seenCookies.every((cookie) => cookie === 'SESSDATA=session-value; bili_jct=csrf-value'), true);
});

test('fetchJson caches successful Bilibili JSON responses for repeated reads', async () => {
  resetBilibiliRequestState();
  let calls = 0;
  const options = {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 1000,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        json: async () => ({ code: 0, data: { calls } }),
      };
    },
  };

  const first = await fetchJson('https://api.bilibili.com/cache', 'https://www.bilibili.com', options);
  const second = await fetchJson('https://api.bilibili.com/cache', 'https://www.bilibili.com', options);

  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  resetBilibiliRequestState();
});

test('fetchJson passes an abort signal so stalled Bilibili requests can time out', async () => {
  resetBilibiliRequestState();
  await fetchJson('https://api.bilibili.com/timeout', 'https://www.bilibili.com', {
    env: {},
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 500,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.ok(init.signal);
      assert.equal(init.signal.aborted, false);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
});

test('fetchJson forwards caller abort signal to Bilibili requests', async () => {
  resetBilibiliRequestState();
  const controller = new AbortController();
  await fetchJson('https://api.bilibili.com/external-abort', 'https://www.bilibili.com', {
    env: {},
    signal: controller.signal,
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 0,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
});

test('fetchJson preserves caller abort state when request timeout is also enabled', async () => {
  resetBilibiliRequestState();
  const controller = new AbortController();
  controller.abort();
  await fetchJson('https://api.bilibili.com/external-and-timeout-abort', 'https://www.bilibili.com', {
    env: {},
    signal: controller.signal,
    config: {
      minDelayMs: 0,
      jitterMs: 0,
      blockCooldownMs: 0,
      cacheTtlMs: 0,
      longPauseProbability: 0,
      requestTimeoutMs: 500,
    },
    nowFn: () => 1000,
    randomFn: () => 0,
    waitFn: async () => {},
    fetchImpl: async (_url, init) => {
      assert.equal(init.signal.aborted, true);
      return {
        ok: true,
        json: async () => ({ code: 0, data: { ok: true } }),
      };
    },
  });
  resetBilibiliRequestState();
});

test('extractDynamicRecords returns commentable dynamic objects and authored text', () => {
  const records = extractDynamicRecords(
    [
      {
        id_str: '111222333',
        basic: {
          comment_type: 17,
          comment_id_str: '998877',
        },
        modules: {
          module_dynamic: {
            desc: {
              text: '这个观点你先别急着扣帽子，证据链还没给全。',
            },
          },
        },
        type: 'DYNAMIC_TYPE_WORD',
      },
    ],
    '453244911',
  );

  assert.equal(records.objects.length, 1);
  assert.deepEqual(records.objects[0], {
    id: 'dynamic-17-998877',
    kind: 'dynamic',
    oid: '998877',
    replyType: 17,
    title: '动态：这个观点你先别急着扣帽子，证据链还没给全。',
    authorMid: '453244911',
    sourceUrl: 'https://t.bilibili.com/111222333',
    replyCount: 0,
  });
  assert.equal(records.authoredPosts.length, 1);
  assert.equal(records.authoredPosts[0].message, '这个观点你先别急着扣帽子，证据链还没给全。');
});

test('collectReplyForUid captures nested replies by target UID with source metadata', () => {
  const bucket = [];
  collectReplyForUid(
    {
      rpid: 1,
      mid: 100,
      member: { mid: '100', uname: 'other' },
      content: { message: 'root' },
      replies: [
        {
          rpid: 2,
          mid: 453244911,
          member: { mid: '453244911', uname: 'target' },
          content: { message: '你这个结论少了关键前提。' },
          like: 6,
          ctime: 1710000000,
        },
      ],
    },
    '453244911',
    {
      kind: 'video',
      bvid: 'BV19yGa61Ee6',
      oid: 123,
      replyType: 1,
      title: '测试视频',
      sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
    },
    bucket,
  );

  assert.equal(bucket.length, 1);
  assert.deepEqual(bucket[0], {
    sourceKind: 'video',
    bvid: 'BV19yGa61Ee6',
    oid: '123',
    replyType: 1,
    sourceTitle: '测试视频',
    sourceUrl: 'https://www.bilibili.com/video/BV19yGa61Ee6/',
    rpid: '2',
    like: 6,
    ctime: 1710000000,
    uname: 'target',
    mid: '453244911',
    message: '你这个结论少了关键前提。',
  });
});

test('dedupePublicObjects keeps unique reply targets across discovery sources', () => {
  const objects = dedupePublicObjects([
    { kind: 'video', oid: 123, replyType: 1, title: 'A' },
    { kind: 'video', oid: '123', replyType: 1, title: 'A duplicate' },
    { kind: 'dynamic', oid: '123', replyType: 17, title: 'different comment target' },
  ]);

  assert.equal(objects.length, 2);
  assert.equal(objects[0].title, 'A');
  assert.equal(objects[1].kind, 'dynamic');
});

test('fetchRepliesForVideo collects public top-level and nested video comments', async () => {
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: '测试视频',
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
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.video.bvid, 'BV19yGa61Ee6');
  assert.equal(result.comments.length, 2);
  assert.equal(result.commentText.includes('不会真有人'), true);
  assert.equal(result.commentText.includes('懂的都懂'), true);
});

test('parseDanmakuXml extracts public danmaku messages', () => {
  const items = parseDanmakuXml(
    '<i><d p="1,1,25,16777215,1710000000,0,12345,0">别喷我 &amp; 不吹不黑</d></i>',
    {
      bvid: 'BV1danmaku',
      oid: '123',
      replyType: 1,
      title: 'danmaku video',
      sourceUrl: 'https://www.bilibili.com/video/BV1danmaku/',
      cid: '456',
    },
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].message, '别喷我 & 不吹不黑');
  assert.equal(items[0].kind, 'danmaku');
  assert.equal(items[0].rpid, 'danmaku-456-0');
});

test('fetchRepliesForVideo can include public danmaku as interaction text', async () => {
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1, includeDanmaku: true },
    {
      fetchJson: async (url) => {
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              cid: 456,
              title: 'danmaku source',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 0 },
            },
          };
        }
        return { code: 0, data: { replies: [], cursor: { is_end: true, next: 0 } } };
      },
      fetchText: async (url) => {
        assert.equal(String(url), 'https://api.bilibili.com/x/v1/dm/list.so?oid=456');
        return '<i><d p="1,1,25,16777215,1710000000,0,12345,0">轻点喷</d></i>';
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.comments[0].kind, 'danmaku');
  assert.equal(result.commentText.includes('轻点喷'), true);
});

test('fetchRepliesForVideo falls back to legacy reply pages when main cursor API is blocked', async () => {
  const seen = [];
  const result = await fetchRepliesForVideo(
    'BV19yGa61Ee6',
    { pages: 1 },
    {
      fetchJson: async (url) => {
        seen.push(String(url));
        if (String(url).includes('/x/web-interface/view')) {
          return {
            code: 0,
            data: {
              aid: 123,
              title: 'fallback video',
              owner: { mid: 9, name: 'up' },
              stat: { reply: 1 },
            },
          };
        }
        if (String(url).includes('/x/v2/reply/main')) {
          return { code: -352, message: '-352' };
        }
        return {
          code: 0,
          data: {
            replies: [
              {
                rpid: 10,
                mid: 100,
                member: { mid: '100', uname: 'alice' },
                content: { message: '典中典，自己查' },
                like: 2,
                ctime: 1710000000,
              },
            ],
            page: { count: 1, size: 20, num: 1 },
          },
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.comments.length, 1);
  assert.equal(result.commentText.includes('典中典'), true);
  assert.equal(seen.some((url) => url.includes('/x/v2/reply?')), true);
});
