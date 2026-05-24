import { fetchRepliesForVideo } from './bilibiliCrawler.js';
import { trainKeywordDictionary as defaultTrainKeywordDictionary } from './deepseekKeywordTrainer.js';

export async function searchVideoKeywords(payload = {}, deps = {}) {
  const videoLink = String(payload.videoLink || payload.url || payload.bvid || '').trim();
  const scan = await fetchRepliesForVideo(videoLink, { pages: payload.pages }, deps);

  if (!scan.ok) {
    return scan;
  }

  if (!scan.commentText.trim()) {
    return {
      ...scan,
      entries: [],
      keywordTraining: null,
      dictionary: null,
    };
  }

  const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
  const keywordTraining = await trainKeywordDictionary({
    uid: scan.video.bvid,
    text: scan.commentText,
    source: `${scan.source}: ${scan.video.sourceUrl}`,
  });

  return {
    ...scan,
    entries: keywordTraining.entries || [],
    keywordTraining,
    dictionary: keywordTraining.dictionary || null,
  };
}
