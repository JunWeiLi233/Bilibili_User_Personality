import assert from 'node:assert/strict';
import test from 'node:test';

import { searchVideoKeywords } from './videoKeywordSearch.js';

test('searchVideoKeywords rejects input without a BV id', async () => {
  const result = await searchVideoKeywords({ videoLink: 'not a bilibili video' });

  assert.equal(result.ok, false);
  assert.match(result.error, /BV/);
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
