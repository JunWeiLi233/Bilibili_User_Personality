import { discoverPopularVideos, discoverVideosByKeyword, fetchRepliesForVideo } from './bilibiliCrawler.js';
import { trainKeywordDictionary as defaultTrainKeywordDictionary } from './deepseekKeywordTrainer.js';

export const DEFAULT_VIDEO_LINK =
  process.env.BILIBILI_DEFAULT_VIDEO_LINKS ||
  process.env.BILIBILI_DEFAULT_VIDEO_LINK ||
  '';
export const DEFAULT_VIDEO_SEARCH_QUERY =
  process.env.BILIBILI_VIDEO_SEARCH_QUERIES ||
  process.env.BILIBILI_VIDEO_SEARCH_QUERY ||
  '\u4e2d\u6587\u4e92\u8054\u7f51 \u9634\u9633\u602a\u6c14';
export const DEFAULT_CONTROVERSY_SEARCH_QUERIES =
  process.env.BILIBILI_CONTROVERSY_SEARCH_QUERIES ||
  [
    '\u65f6\u653f \u70ed\u8bc4 \u8bc4\u8bba\u533a',
    '\u56fd\u9645\u653f\u6cbb \u70ed\u8bc4 \u8bc4\u8bba\u533a',
    '\u6e38\u620f \u8282\u594f \u70ed\u8bc4',
    '\u793e\u4f1a\u4e8b\u4ef6 \u4e89\u8bae \u70ed\u8bc4',
    '\u539f\u795e \u8282\u594f \u70ed\u8bc4',
    '\u9ed1\u795e\u8bdd \u4e89\u8bae',
    '\u738b\u8005\u8363\u8000 \u8282\u594f',
    '\u660e\u65e5\u65b9\u821f \u8282\u594f',
    '\u7537\u5973\u5bf9\u7acb \u8bc4\u8bba\u533a',
    '\u5f69\u793c \u8bc4\u8bba\u533a',
    '\u5c31\u4e1a \u5b66\u5386 \u4e89\u8bae',
    '\u996d\u5708 \u4e89\u8bae',
    '\u5f71\u89c6 \u4e89\u8bae \u70ed\u8bc4',
    '\u5386\u53f2\u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u79d1\u6280\u516c\u53f8 \u4e89\u8bae',
  ].join('\n');
export const DEFAULT_CONTROVERSIAL_POPULAR_SEARCH_ORDER =
  process.env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER || 'click';

function parseList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  return String(value || '')
    .split(/[\r\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

export const DEFAULT_CONTROVERSIAL_POPULAR_QUERY_LIMIT = boundedInt(
  process.env.BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT ?? 4,
  4,
  0,
  20,
);

function uniqueByKey(items, keyFn) {
  return [...new Map(items.filter(Boolean).map((item) => [keyFn(item), item])).values()];
}

function roundRobinUnique(groups, limit, keyFn) {
  const seen = new Set();
  const results = [];
  const buckets = groups.map((group) => group.filter(Boolean));
  const maxLength = Math.max(0, ...buckets.map((group) => group.length));
  for (let index = 0; index < maxLength && results.length < limit; index += 1) {
    for (const group of buckets) {
      const item = group[index];
      if (!item) continue;
      const key = keyFn(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      results.push(item);
      if (results.length >= limit) break;
    }
  }
  return results;
}

function parseSet(value) {
  return new Set(parseList(value));
}

function envFlag(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function buildVideoContextText(videos = []) {
  return uniqueByKey(
    videos
      .flatMap((video) => [video.title, video.desc, video.description])
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
    (item) => item,
  )
    .map((item) => `Bilibili video context: ${item}`)
    .join('\n');
}

function videoContextSources(videos = [], discoveredVideos = []) {
  return uniqueByKey(
    [...videos, ...discoveredVideos].filter(Boolean),
    (video) => `${video.bvid || ''}\n${video.sourceUrl || ''}\n${video.title || ''}`,
  );
}

function videoContextSourceUrls(videos = [], discoveredVideos = []) {
  return uniqueByKey(
    [...videos, ...discoveredVideos]
      .map((video) => String(video?.sourceUrl || '').trim())
      .filter(Boolean),
    (item) => item,
  );
}

export async function searchVideoKeywords(payload = {}, deps = {}) {
  const videoLinks = parseList(
    payload.videoLinks ||
      payload.videoLink ||
      payload.urls ||
      payload.url ||
      payload.bvids ||
      payload.bvid ||
      deps.defaultVideoLinks ||
      deps.defaultVideoLink ||
      DEFAULT_VIDEO_LINK,
  );
  const searchQueries = parseList(
    payload.searchQueries ||
      payload.searchQuery ||
      payload.query ||
      deps.defaultSearchQueries ||
      deps.defaultSearchQuery ||
      DEFAULT_VIDEO_SEARCH_QUERY,
  );
  const controversyQueries = parseList(
    payload.controversyQueries ||
      payload.controversyQuery ||
      deps.defaultControversyQueries ||
      deps.defaultControversyQuery ||
      DEFAULT_CONTROVERSY_SEARCH_QUERIES,
  );
  const discoveryLimit = Math.max(
    1,
    Math.min(Number(payload.discoveryLimit || deps.discoveryLimit || process.env.BILIBILI_VIDEO_DISCOVERY_LIMIT || 6), 20),
  );
  const controversialPopularQueryLimit = boundedInt(
    payload.controversialPopularQueryLimit ??
      deps.controversialPopularQueryLimit ??
      process.env.BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT ??
      DEFAULT_CONTROVERSIAL_POPULAR_QUERY_LIMIT,
    DEFAULT_CONTROVERSIAL_POPULAR_QUERY_LIMIT,
    0,
    20,
  );
  const controversialPopularSearchOrder = String(
    payload.controversialPopularSearchOrder ||
      deps.controversialPopularSearchOrder ||
      process.env.BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER ||
      DEFAULT_CONTROVERSIAL_POPULAR_SEARCH_ORDER,
  )
    .trim()
    .toLowerCase();
  const existingTermsOnly =
    payload.existingTermsOnly === true ||
    payload.existingDictionaryTermsOnly === true ||
    deps.existingTermsOnly === true ||
    process.env.BILIBILI_HARVEST_EXISTING_TERMS_ONLY === '1';
  const includeVideoContext =
    payload.includeVideoContext === true ||
    deps.includeVideoContext === true ||
    process.env.BILIBILI_HARVEST_INCLUDE_VIDEO_CONTEXT === '1' ||
    existingTermsOnly;
  const prioritizeSearchQueries =
    payload.prioritizeSearchQueries === true ||
    deps.prioritizeSearchQueries === true ||
    process.env.BILIBILI_HARVEST_PRIORITIZE_SEARCH_QUERIES === '1' ||
    existingTermsOnly;
  const includeGenericPopular =
    payload.includeGenericPopular === true ||
    deps.includeGenericPopular === true ||
    envFlag(process.env.BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR, false);
  const discoveryWarnings = [];
  let discoveredVideos = [];
  let discoveryContextVideos = [];
  const excludeBvids = parseSet(payload.excludeBvids || deps.excludeBvids);
  const discoveryMode = String(payload.discoveryMode || deps.discoveryMode || process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial')
    .trim()
    .toLowerCase();

  if (videoLinks.length === 0) {
    const discoveryGroups = [];
    if (discoveryMode === 'search' || discoveryMode === 'mixed') {
      const discoverVideos = deps.discoverVideosByKeyword || discoverVideosByKeyword;
      const group = [];
      for (const query of searchQueries) {
        try {
          group.push(...(await discoverVideos(query, discoveryLimit, deps)));
        } catch (error) {
          discoveryWarnings.push(`${query}: ${error.message}`);
        }
      }
      discoveryGroups.push(group);
    }
    if (discoveryMode === 'controversial') {
      const discoverVideos = deps.discoverVideosByKeyword || discoverVideosByKeyword;
      const controversialPopularGroup = [];
      const controversyGroup = [];
      const searchGroup = [];
      for (const query of controversyQueries.slice(0, controversialPopularQueryLimit)) {
        try {
          controversialPopularGroup.push(
            ...(await discoverVideos(query, discoveryLimit, { ...deps, searchOrder: controversialPopularSearchOrder })),
          );
        } catch (error) {
          discoveryWarnings.push(`${query} (${controversialPopularSearchOrder || 'popular'}): ${error.message}`);
        }
      }
      for (const query of controversyQueries) {
        try {
          controversyGroup.push(...(await discoverVideos(query, discoveryLimit, deps)));
        } catch (error) {
          discoveryWarnings.push(`${query}: ${error.message}`);
        }
      }
      for (const query of searchQueries) {
        try {
          searchGroup.push(...(await discoverVideos(query, discoveryLimit, deps)));
        } catch (error) {
          discoveryWarnings.push(`${query}: ${error.message}`);
        }
      }
      discoveryGroups.push(
        ...(prioritizeSearchQueries
          ? [searchGroup, controversialPopularGroup, controversyGroup]
          : [controversialPopularGroup, controversyGroup, searchGroup]),
      );
    }
    if (discoveryMode === 'popular' || discoveryMode === 'mixed' || (discoveryMode === 'controversial' && includeGenericPopular)) {
      const discoverPopular = deps.discoverPopularVideos || discoverPopularVideos;
      try {
        discoveryGroups.push(await discoverPopular(discoveryLimit, deps));
      } catch (error) {
        discoveryWarnings.push(`popular: ${error.message}`);
      }
    }
    discoveryContextVideos = uniqueByKey(
      discoveryGroups.flatMap((group) => group),
      (video) => video.bvid || video.sourceUrl || video.title,
    );
    discoveredVideos = roundRobinUnique(
      discoveryGroups.map((group) => group.filter((video) => !excludeBvids.has(video.bvid))),
      discoveryLimit,
      (video) => video.bvid,
    );
    if (discoveredVideos.length === 0) {
      return {
        ok: false,
        error: discoveryWarnings[0] || 'No Bilibili videos were discovered from the backend discovery mode.',
        warnings: discoveryWarnings,
      };
    }
  }

  const scans = [];
  const warnings = [...discoveryWarnings];
  const scanTargets = videoLinks.length > 0 ? videoLinks : discoveredVideos.map((video) => video.bvid || video.sourceUrl);
  for (const videoLink of scanTargets) {
    const scan = await fetchRepliesForVideo(videoLink, { pages: payload.pages }, deps);
    if (scan.ok) {
      scans.push(scan);
    } else {
      warnings.push(`${videoLink}: ${scan.error}`);
    }
  }

  if (scans.length === 0) {
    return { ok: false, error: warnings[0] || 'No valid Bilibili videos were found.', warnings };
  }

  const comments = uniqueByKey(
    scans.flatMap((scan) => scan.comments || []),
    (comment) => `${comment.bvid || comment.sourceUrl}:${comment.rpid}`,
  );
  const videos = scans.map((scan) => scan.video);
  const commentText = comments.map((comment) => comment.message).filter(Boolean).join('\n');
  const contextVideos = videoContextSources(videos, discoveryContextVideos.length ? discoveryContextVideos : discoveredVideos);
  const videoContextText = includeVideoContext ? buildVideoContextText(contextVideos) : '';
  const trainingText = [commentText, videoContextText].filter((item) => item.trim()).join('\n');
  const primaryVideo = videos[0];
  const mergedScan = {
    ok: true,
    video: primaryVideo,
    videos,
    discoveredVideos,
    discoveryContextVideos,
    searchQueries: videoLinks.length === 0 ? searchQueries : [],
    controversyQueries: videoLinks.length === 0 && discoveryMode === 'controversial' ? controversyQueries : [],
    controversialPopularQueries:
      videoLinks.length === 0 && discoveryMode === 'controversial'
        ? controversyQueries.slice(0, controversialPopularQueryLimit)
        : [],
    controversialPopularSearchOrder:
      videoLinks.length === 0 && discoveryMode === 'controversial' ? controversialPopularSearchOrder : null,
    discoveryMode: videoLinks.length === 0 ? discoveryMode : 'explicit',
    comments,
    commentText,
    videoContextText,
    source:
      videoLinks.length === 0
        ? 'Bilibili public search-discovered video comment scan'
        : scans.length > 1
          ? 'Bilibili public multi-video comment scan'
          : scans[0].source,
    confidenceHint:
      comments.length >= 80 ? 'large video comment sample' : comments.length >= 20 ? 'medium video comment sample' : 'small video comment sample',
    warnings,
  };

  if (!trainingText.trim()) {
    return {
      ...mergedScan,
      entries: [],
      keywordTraining: null,
      dictionary: null,
    };
  }

  const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
  const contextSourceUrls = videoContextSourceUrls(contextVideos);
  const keywordTraining = await trainKeywordDictionary({
    uid: videos.map((video) => video.bvid).join(','),
    text: trainingText,
    source: `${mergedScan.source}${videoContextText ? ' plus video context' : ''}: ${contextSourceUrls.join(', ')}`,
    existingTermsOnly,
  });

  return {
    ...mergedScan,
    entries: keywordTraining.entries || [],
    keywordTraining,
    dictionary: keywordTraining.dictionary || null,
  };
}
