import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectReplyForUid,
  dedupePublicObjects,
  extractBvid,
  extractDynamicRecords,
  fetchRepliesForVideo,
  parseBvidPool,
} from './bilibiliCrawler.js';

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
