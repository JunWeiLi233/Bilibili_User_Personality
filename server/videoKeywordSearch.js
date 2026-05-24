import { fetchRepliesForVideo } from './bilibiliCrawler.js';
import { trainKeywordDictionary as defaultTrainKeywordDictionary } from './deepseekKeywordTrainer.js';

export const DEFAULT_VIDEO_LINK =
  process.env.BILIBILI_DEFAULT_VIDEO_LINK ||
  process.env.BILIBILI_DEFAULT_VIDEO_LINKS ||
  'https://www.bilibili.com/video/BV19yGa61Ee6/?vd_source=d3f6474bdf9e6de8d027785f1120afd4';

function parseVideoLinks(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n,，]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueByKey(items, keyFn) {
  return [...new Map(items.filter(Boolean).map((item) => [keyFn(item), item])).values()];
}

export async function searchVideoKeywords(payload = {}, deps = {}) {
  const videoLinks = parseVideoLinks(
    payload.videoLinks || payload.videoLink || payload.urls || payload.url || payload.bvids || payload.bvid || deps.defaultVideoLinks || deps.defaultVideoLink || DEFAULT_VIDEO_LINK,
  );
  if (videoLinks.length === 0) {
    return { ok: false, error: 'Video link must contain a valid BV id.' };
  }

  const scans = [];
  const warnings = [];
  for (const videoLink of videoLinks) {
    const scan = await fetchRepliesForVideo(videoLink, { pages: payload.pages }, deps);
    if (scan.ok) {
      scans.push(scan);
    } else {
      warnings.push(`${videoLink}: ${scan.error}`);
    }
  }

  if (scans.length === 0) {
    return { ok: false, error: warnings[0] || 'No valid Bilibili video links were found.', warnings };
  }

  const comments = uniqueByKey(
    scans.flatMap((scan) => scan.comments || []),
    (comment) => `${comment.bvid || comment.sourceUrl}:${comment.rpid}`,
  );
  const videos = scans.map((scan) => scan.video);
  const commentText = comments.map((comment) => comment.message).filter(Boolean).join('\n');
  const primaryVideo = videos[0];
  const mergedScan = {
    ok: true,
    video: primaryVideo,
    videos,
    comments,
    commentText,
    source: scans.length > 1 ? 'Bilibili public multi-video comment scan' : scans[0].source,
    confidenceHint:
      comments.length >= 80 ? 'large video comment sample' : comments.length >= 20 ? 'medium video comment sample' : 'small video comment sample',
    warnings,
  };

  if (!commentText.trim()) {
    return {
      ...mergedScan,
      entries: [],
      keywordTraining: null,
      dictionary: null,
    };
  }

  const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
  const keywordTraining = await trainKeywordDictionary({
    uid: videos.map((video) => video.bvid).join(','),
    text: commentText,
    source: `${mergedScan.source}: ${videos.map((video) => video.sourceUrl).join(', ')}`,
  });

  return {
    ...mergedScan,
    entries: keywordTraining.entries || [],
    keywordTraining,
    dictionary: keywordTraining.dictionary || null,
  };
}
