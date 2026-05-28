import { depsWithBilibiliCookie, discoverPopularVideos, discoverVideosByKeyword, extractBvid, fetchJson, fetchRepliesForVideo, fetchText } from './bilibiliCrawler.js';
import {
  findDictionaryEntriesWithTextEvidence as defaultFindDictionaryEntriesWithTextEvidence,
  readKeywordDictionary as defaultReadKeywordDictionary,
  trainKeywordDictionary as defaultTrainKeywordDictionary,
} from './deepseekKeywordTrainer.js';

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
    '\u56fd\u9645\u5173\u7cfb \u4e2d\u7f8e \u70ed\u8bc4',
    '\u6e38\u620f \u8282\u594f \u70ed\u8bc4',
    '\u6e38\u620f\u5382\u5546 \u8282\u594f \u70ed\u8bc4',
    '\u793e\u4f1a\u4e8b\u4ef6 \u4e89\u8bae \u70ed\u8bc4',
    '\u539f\u795e \u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u539f\u795e \u8282\u594f \u70ed\u8bc4',
    '\u7c73\u54c8\u6e38 \u8282\u594f \u70ed\u8bc4',
    '\u9ed1\u795e\u8bdd \u4e89\u8bae',
    'KPL \u738b\u8005\u8363\u8000 \u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u738b\u8005\u8363\u8000 \u8282\u594f',
    '\u660e\u65e5\u65b9\u821f \u8282\u594f',
    '\u7537\u5973\u5bf9\u7acb \u8bc4\u8bba\u533a',
    '\u5973\u6743 \u8bc4\u8bba\u533a',
    '\u5973\u6743 \u4e89\u8bae \u70ed\u8bc4',
    '\u5f69\u793c \u8bc4\u8bba\u533a',
    '\u5c31\u4e1a \u5b66\u5386 \u4e89\u8bae',
    '\u996d\u5708 \u4e89\u8bae',
    '\u5f71\u89c6 \u4e89\u8bae \u70ed\u8bc4',
    '\u5386\u53f2\u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u79d1\u6280\u516c\u53f8 \u4e89\u8bae',
    '\u65b0\u80fd\u6e90\u8f66 \u4e89\u8bae \u70ed\u8bc4',
    '\u5c0f\u7c73\u6c7d\u8f66 \u7279\u65af\u62c9 \u8bc4\u8bba\u533a',
    'SpaceX \u4e89\u8bae \u8bc4\u8bba\u533a',
    'SpaceX \u661f\u8230 \u8bc4\u8bba\u533a',
    'AI \u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u8f9f\u8c23 \u6570\u636e \u8bc1\u636e \u8bc4\u8bba\u533a',
    '\u79d1\u666e \u8bc1\u636e \u6765\u6e90 \u70ed\u8bc4',
    '\u4fc4\u4e4c \u8bc4\u8bba\u533a',
    '\u4fc4\u4e4c \u4e89\u8bae \u70ed\u8bc4',
    '\u65fa\u5ea7 \u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u5f20\u96ea\u5cf0 \u4e89\u8bae \u8bc4\u8bba\u533a',
    '\u76d8\u76d8 \u8bc4\u8bba\u533a',
    '\u5317\u6b27tv \u8bc4\u8bba\u533a',
    '\u8001\u5e7ftv \u8bc4\u8bba\u533a',
    '485 \u8bc4\u8bba\u533a',
    '\u6570\u636e \u771f\u5047 \u4e89\u8bae \u8bc4\u8bba',
    '\u8bba\u8bc1 \u53cd\u9a73 \u8bc4\u8bba\u533a',
    '\u4fee\u6b63 \u9053\u6b49 \u66f4\u6b63 \u8bc4\u8bba',
    '\u53d1\u94fe\u63a5 \u8d34\u539f\u6587 \u8bc4\u8bba',
    '\u7edd\u5bf9\u5316 \u5168\u79f0\u5224\u65ad \u8bc4\u8bba',
    '\u4e0d\u4f1a\u767e\u5ea6 \u81ea\u5df1\u641c \u8bc4\u8bba\u533a',
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

function depsWithAbortSignal(deps = {}, signal = null) {
  if (!signal) return deps;
  const requestJson = deps.fetchJson || fetchJson;
  const requestText = deps.fetchText || fetchText;
  return {
    ...deps,
    fetchJson: (url, referer, options = {}) => requestJson(url, referer, { ...options, signal }),
    fetchText: (url, referer, options = {}) => requestText(url, referer, { ...options, signal }),
  };
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw new Error('Bilibili video keyword search aborted.');
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

function cleanSearchText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, '')
    .toLowerCase();
}

function videoSearchText(video) {
  return cleanSearchText([video?.title, video?.desc, video?.description, video?.dynamic].filter(Boolean).join(' '));
}

function searchQueryNeedles(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  return [raw, ...raw.split(/\s+/)].map(cleanSearchText).filter((item) => item.length >= 2);
}

function mixedScriptAsciiAnchors(value) {
  const text = cleanSearchText(value);
  if (!/[\p{Script=Han}]/u.test(text)) return [];
  return Array.from(text.matchAll(/[a-z0-9]{2,}/giu), (match) => match[0].toLowerCase());
}

function requiredAsciiAnchorsForSearch(searchQueries = []) {
  return uniqueByKey(
    searchQueries
      .flatMap((query) => parseList(query).flatMap((item) => String(item || '').split(/\s+/)))
      .filter((item) => item && !isGenericTargetSearchNeedle(item))
      .flatMap(mixedScriptAsciiAnchors),
    (item) => item,
  );
}

const GENERIC_TARGET_SEARCH_NEEDLES = new Set(
  [
    'b站',
    'bilibili',
    '视频',
    '投稿',
    '合集',
    '全集',
    '完整版',
    '免费观看',
    '评论',
    '评论区',
    '弹幕',
    '热评',
    '回复',
    '互动',
    '讨论',
    '争议',
    '热点',
    '热门',
    '梗图',
    '名场面',
    '切片',
    '盘点',
    '复盘',
    '链接',
    '自取',
    '出处',
    '来源',
    '是什么梗',
    '什么意思',
  ].map(cleanSearchText),
);

const CANONICAL_GENERIC_TARGET_SEARCH_NEEDLES = new Set(
  [
    'b\u7ad9',
    'bilibili',
    '\u89c6\u9891',
    '\u6295\u7a3f',
    '\u5408\u96c6',
    '\u5168\u96c6',
    '\u5b8c\u6574\u7248',
    '\u514d\u8d39\u89c2\u770b',
    '\u8bc4\u8bba',
    '\u8bc4\u8bba\u533a',
    '\u5f39\u5e55',
    '\u70ed\u8bc4',
    '\u56de\u590d',
    '\u4e92\u52a8',
    '\u8ba8\u8bba',
    '\u4e89\u8bae',
    '\u70ed\u70b9',
    '\u70ed\u95e8',
    '\u6897\u56fe',
    '\u540d\u573a\u9762',
    '\u5207\u7247',
    '\u76d8\u70b9',
    '\u590d\u76d8',
    '\u94fe\u63a5',
    '\u81ea\u53d6',
    '\u51fa\u5904',
    '\u6765\u6e90',
    '\u662f\u4ec0\u4e48\u6897',
    '\u4ec0\u4e48\u610f\u601d',
  ].map(cleanSearchText),
);

function isGenericTargetSearchNeedle(needle) {
  const normalized = cleanSearchText(needle);
  return GENERIC_TARGET_SEARCH_NEEDLES.has(normalized) || CANONICAL_GENERIC_TARGET_SEARCH_NEEDLES.has(normalized);
}

const AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES = new Set(
  [
    '\u95ee\u767e\u5ea6',
    '\u95ee\u767e\u5ea6\u6709\u4ec0\u4e48\u7528',
  ].map(cleanSearchText),
);

const STRICT_TARGET_RELEVANCE_NEEDLES = new Set(
  [
    '\u56fd\u9645\u5b85\u7537\u8054\u76df',
    '\u5b85\u7537\u8054\u76df',
    '\u679c\u8747play',
    '\u4e0d\u4e00\u4e00',
    '\u4e0d\u4e00\u4e00\u8bc4\u4ef7',
    '\u5c31\u4e0d\u4e00\u4e00\u8bc4\u4ef7\u4e86',
    '\u6015\u88ab\u5220\u8bc4',
    '\u6015\u88ab\u5220\u8bc4\u6545\u53d1\u56fe',
    '\u5355\u8f66\u53d8\u6469\u6258',
    '\u7b2c\u4e00\u6b21\u5c31\u770b\u61c2\u4e86',
    '\u9f3b\u5b50\u5360\u9886\u5927\u8111',
    '\u5e76\u975e\u5076\u9047',
  ].map(cleanSearchText),
);

const ASK_BAIDU_PRODUCT_NOISE_NEEDLES = [
  '\u767e\u5ea6\u6587\u5e93',
  '\u767e\u5ea6\u7f51\u76d8',
  '\u767e\u5ea6\u4e91',
  '\u767e\u5ea6APP',
  '\u767e\u5ea6\u5730\u56fe',
  '\u767e\u5ea6\u767e\u79d1',
  '\u767e\u5ea6\u8d34\u5427',
  '\u767e\u5ea6\u7ffb\u8bd1',
  '\u767e\u5ea6\u8f93\u5165\u6cd5',
  '\u767e\u5ea6\u516c\u5173',
  '\u516c\u5173\u4e00\u53f7\u4f4d',
  '\u95ee\u767e\u5ea6\u9648\u745e',
  '\u9648\u745e\u6f14\u5531',
].map(cleanSearchText);

function targetsAskBaiduTerm(targetExistingTerms = []) {
  return targetExistingTerms.map(cleanSearchText).some((needle) => AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES.has(needle));
}

function targetsRequireStrictRelevance(targetExistingTerms = []) {
  return targetExistingTerms.map(cleanSearchText).some((needle) => STRICT_TARGET_RELEVANCE_NEEDLES.has(needle));
}

function isAskBaiduProductNoiseVideo(video) {
  const text = videoSearchText(video);
  return text && ASK_BAIDU_PRODUCT_NOISE_NEEDLES.some((needle) => needle && text.includes(needle));
}

function isBlockedDiscoveryWarning(warning) {
  return /\bHTTP\s+(?:403|412|429)\b/iu.test(String(warning || ''));
}

function searchNeedlesForRelevance(searchQueries = [], targetExistingTerms = []) {
  const targetNeedles = uniqueByKey(
    targetExistingTerms.map(cleanSearchText).filter((item) => item.length >= 2),
    (item) => item,
  );
  const queryNeedles = searchQueries
    .flatMap((query) => parseList(query).flatMap(searchQueryNeedles))
    .filter((item) => targetNeedles.length === 0 || !isGenericTargetSearchNeedle(item));
  const uniqueQueryNeedles = uniqueByKey(queryNeedles.map(cleanSearchText).filter((item) => item.length >= 2), (item) => item);
  if (targetNeedles.length === 0) return uniqueQueryNeedles;
  const queryNeedleSet = new Set(uniqueQueryNeedles);
  const targetInQuery = targetNeedles.some((needle) => queryNeedleSet.has(needle));
  const aliasQueryNeedles = uniqueQueryNeedles.filter((needle) => !targetNeedles.includes(needle));
  if (aliasQueryNeedles.length > 0 && !targetInQuery) {
    if (targetNeedles.some((needle) => AMBIGUOUS_ALIAS_ONLY_TARGET_NEEDLES.has(needle))) {
      return [...aliasQueryNeedles, ...aliasQueryNeedles, ...uniqueQueryNeedles];
    }
    return [...aliasQueryNeedles, ...aliasQueryNeedles, ...targetNeedles, ...uniqueQueryNeedles];
  }
  return [...targetNeedles, ...targetNeedles, ...uniqueQueryNeedles];
}

function discoveryQueriesForSearch(searchQueries = [], targetExistingTerms = []) {
  if (!targetExistingTerms.length) return searchQueries;
  return uniqueByKey(
    searchQueries
      .map((query) => {
        const cleanQuery = String(query || '').trim();
        const focused = cleanQuery
          .split(/\s+/)
          .map((token) => token.trim())
          .filter((token) => token && !isGenericTargetSearchNeedle(token))
          .join(' ')
          .trim();
        return focused || cleanQuery;
      })
      .filter(Boolean),
    (item) => item,
  );
}

function relevanceScoreForVideo(video, needles = []) {
  const text = videoSearchText(video);
  if (!text) return 0;
  return needles.reduce((score, needle) => {
    if (!needle || !text.includes(needle)) return score;
    return score + Math.min(12, Math.max(1, needle.length));
  }, 0);
}

function strictTargetRelevanceScoreForVideo(video, targetExistingTerms = []) {
  const targetNeedles = uniqueByKey(targetExistingTerms.map(cleanSearchText).filter((item) => item.length >= 2), (item) => item);
  return relevanceScoreForVideo(video, targetNeedles);
}

function sortVideosByRelevance(videos = [], searchQueries = [], targetExistingTerms = []) {
  const needles = searchNeedlesForRelevance(searchQueries, targetExistingTerms);
  if (needles.length === 0) return videos;
  return videos
    .map((video, index) => ({ video, index, score: relevanceScoreForVideo(video, needles) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.video);
}

function filterRelevantVideos(videos = [], searchQueries = [], targetExistingTerms = []) {
  const needles = searchNeedlesForRelevance(searchQueries, targetExistingTerms);
  if (needles.length === 0) return videos;
  const rejectAskBaiduProductNoise = targetsAskBaiduTerm(targetExistingTerms);
  const requireStrictTargetRelevance = targetsRequireStrictRelevance(targetExistingTerms);
  const requiredAsciiAnchors = requiredAsciiAnchorsForSearch(searchQueries);
  return videos.filter((video) => {
    if (rejectAskBaiduProductNoise && isAskBaiduProductNoiseVideo(video)) return false;
    const text = videoSearchText(video);
    if (requiredAsciiAnchors.length > 0 && !requiredAsciiAnchors.some((anchor) => text.includes(anchor))) return false;
    if (requireStrictTargetRelevance) return strictTargetRelevanceScoreForVideo(video, targetExistingTerms) > 0;
    return relevanceScoreForVideo(video, needles) > 0;
  });
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

function buildTargetVideoObjectEvidenceText(videos = [], searchQueries = [], targetExistingTerms = []) {
  if (targetExistingTerms.length === 0) return '';
  const needles = searchNeedlesForRelevance(searchQueries, targetExistingTerms);
  if (needles.length === 0) return '';
  return uniqueByKey(
    videos
      .flatMap((video) => [video.title, video.desc, video.description])
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter((item) => item && needles.some((needle) => item.includes(needle))),
    (item) => item,
  )
    .map((item) => `Bilibili public video title: ${item}`)
    .join('\n');
}

function targetEvidenceCount(entry = {}) {
  const numeric = Number(entry.evidenceCount ?? entry.coverageEvidenceCount ?? entry.evidence?.length ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function dictionaryEntryNeedles(entry = {}) {
  return uniqueByKey(
    [
      entry.term,
      ...(Array.isArray(entry.aliases) ? entry.aliases : []),
      ...(Array.isArray(entry.examples) ? entry.examples : []),
    ]
      .map(cleanSearchText)
      .filter((item) => item.length >= 2),
    (item) => item,
  );
}

export function commentMatchesNeedleSet(message, needleSet) {
  if (!needleSet || needleSet.size === 0) return false;
  const clean = cleanSearchText(message);
  if (!clean) return false;
  for (const needle of needleSet) {
    if (needle.length >= 2 && clean.includes(needle)) return true;
  }
  return false;
}

// Local weak-term pre-filter: keep only comments whose text literally contains a
// dictionary term (or alias/example) before routing to DeepSeek. Comment-backed
// evidence requires the term to be present anyway, so dropping non-matching comments
// loses nothing for existing-terms harvesting while cutting model tokens 10-50x,
// which lets us scan far deeper comment sections per run. Falls back to the full set
// if the filter would empty the pool or the dictionary cannot be read.
export function filterCommentsByDictionaryNeedles(comments = [], needleSet, extraNeedles = []) {
  const set = needleSet instanceof Set ? new Set(needleSet) : new Set(needleSet || []);
  for (const extra of extraNeedles) {
    const clean = cleanSearchText(extra);
    if (clean.length >= 2) set.add(clean);
  }
  if (set.size === 0) return { comments, needleCount: 0, matched: comments.length, applied: false };
  const matched = comments.filter((comment) => commentMatchesNeedleSet(comment?.message, set));
  if (matched.length === 0) return { comments, needleCount: set.size, matched: 0, applied: false };
  return { comments: matched, needleCount: set.size, matched: matched.length, applied: true };
}

function dictionaryNeedleSet(dictionary = {}) {
  const set = new Set();
  for (const entry of dictionary.entries || []) {
    for (const needle of dictionaryEntryNeedles(entry)) set.add(needle);
  }
  return set;
}

async function preFilterCommentsToDictionary({ comments = [], existingTermsOnly = false, targetExistingTerms = [], deps = {}, warnings = [] }) {
  if (!existingTermsOnly || comments.length === 0) {
    return { comments, applied: false, needleCount: 0, before: comments.length, after: comments.length };
  }
  try {
    const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
    const dictionary = await readKeywordDictionary();
    const needleSet = dictionaryNeedleSet(dictionary);
    const result = filterCommentsByDictionaryNeedles(comments, needleSet, targetExistingTerms);
    return { comments: result.comments, applied: result.applied, needleCount: result.needleCount, before: comments.length, after: result.comments.length };
  } catch (error) {
    warnings.push(`comment pre-filter: ${error.message}`);
    return { comments, applied: false, needleCount: 0, before: comments.length, after: comments.length };
  }
}

async function expandTargetTermsFromCommentHits({
  commentText = '',
  existingTermsOnly = false,
  targetExistingTerms = [],
  targetEvidence = 3,
  limit = 48,
  deps = {},
  warnings = [],
}) {
  const targets = uniqueByKey(targetExistingTerms.map((term) => String(term || '').trim()).filter(Boolean), (term) => term);
  if (!existingTermsOnly || !commentText.trim() || limit <= targets.length) return targets;
  const normalizedCommentText = cleanSearchText(commentText);
  if (!normalizedCommentText) return targets;
  const targetSet = new Set(targets);
  try {
    const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
    const dictionary = await readKeywordDictionary();
    const findDictionaryEntriesWithTextEvidence =
      deps.findDictionaryEntriesWithTextEvidence || defaultFindDictionaryEntriesWithTextEvidence;
    const evidenceEntries = findDictionaryEntriesWithTextEvidence(dictionary, commentText, { source: 'Bilibili public comment target expansion' });
    const manualAliasEntries = (dictionary.entries || []).filter((entry) => {
      const needles = dictionaryEntryNeedles(entry);
      return needles.some((needle) => normalizedCommentText.includes(needle));
    });
    for (const entry of uniqueByKey([...evidenceEntries, ...manualAliasEntries], (item) => String(item?.term || '').trim())) {
      const term = String(entry?.term || '').trim();
      if (!term || targetSet.has(term) || targetEvidenceCount(entry) >= targetEvidence) continue;
      targetSet.add(term);
      targets.push(term);
      if (targets.length >= limit) break;
    }
  } catch (error) {
    warnings.push(`comment target expansion: ${error.message}`);
  }
  return targets;
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

function sampleVideosForDiagnostics(videos = []) {
  return videos.slice(0, 5).map((video) => ({
    bvid: String(video?.bvid || '').trim(),
    title: String(video?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    sourceUrl: String(video?.sourceUrl || '').trim(),
  }));
}

function targetTextHitsForDiagnostics(trainingText = '', targetExistingTerms = []) {
  const haystack = cleanSearchText(trainingText);
  if (!haystack) return [];
  return uniqueByKey(targetExistingTerms.map((term) => String(term || '').trim()).filter(Boolean), (term) => term)
    .map((term) => {
      const needle = cleanSearchText(term);
      if (!needle || needle.length < 2) return null;
      const count = haystack.split(needle).length - 1;
      return count > 0 ? { term, count } : null;
    })
    .filter(Boolean);
}

function buildCollectionDiagnostics({
  discoveredVideos = [],
  discoveryContextVideos = [],
  videos = [],
  comments = [],
  trainingText = '',
  targetExistingTerms = [],
  keywordTraining = null,
}) {
  return {
    discoveredVideos: discoveredVideos.length,
    discoveryContextVideos: discoveryContextVideos.length,
    scannedVideos: videos.length,
    commentsCollected: comments.length,
    trainingTextChars: String(trainingText || '').length,
    targetExistingTerms,
    targetTextHits: targetTextHitsForDiagnostics(trainingText, targetExistingTerms),
    acceptedTerms: uniqueByKey(
      [...(keywordTraining?.entries || []), ...(keywordTraining?.dictionaryEvidenceEntries || [])]
        .map((entry) => String(entry?.term || '').trim())
        .filter(Boolean),
      (term) => term,
    ),
    evidenceRejected: Math.max(0, Number(keywordTraining?.evidenceRejected) || 0),
    sampleVideos: sampleVideosForDiagnostics(videos.length ? videos : discoveryContextVideos.length ? discoveryContextVideos : discoveredVideos),
  };
}

function evidenceSourceText(entry = {}) {
  return (entry.evidenceSources || [])
    .flatMap((source) => [source?.source, source?.uid])
    .map((item) => String(item || ''))
    .join('\n');
}

function evidenceSourceVideosForTerms(dictionary = {}, targetExistingTerms = [], limit = 6, excludeBvids = new Set()) {
  const targetSet = new Set(targetExistingTerms.map((term) => String(term || '').trim()).filter(Boolean));
  if (targetSet.size === 0) return [];
  const videos = [];
  const seen = new Set();
  for (const entry of dictionary.entries || []) {
    if (!targetSet.has(String(entry?.term || '').trim())) continue;
    const text = evidenceSourceText(entry);
    const candidates = [
      ...text.matchAll(/https?:\/\/(?:www\.)?bilibili\.com\/video\/(BV[0-9A-Za-z]+)/g),
      ...text.matchAll(/\b(BV[0-9A-Za-z]{8,})\b/g),
    ];
    for (const match of candidates) {
      const bvid = extractBvid(match[0] || match[1]);
      if (!bvid || excludeBvids.has(bvid) || seen.has(bvid)) continue;
      seen.add(bvid);
      videos.push({ bvid, sourceUrl: `https://www.bilibili.com/video/${bvid}/`, source: 'existing dictionary evidence source' });
      if (videos.length >= limit) return videos;
    }
  }
  return videos;
}

export async function searchVideoKeywords(payload = {}, deps = {}) {
  deps = depsWithBilibiliCookie(deps, payload.bilibiliCookie || payload.bilibiliCookieHeader || payload.cookie);
  deps = depsWithAbortSignal(deps, payload.abortSignal);
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
  const targetExistingTerms = parseList(
    payload.targetExistingTerms ||
      payload.targetExistingTerm ||
      payload.targetTerms ||
      payload.targetTerm ||
      deps.targetExistingTerms ||
      deps.targetExistingTerm ||
      deps.targetTerms ||
      deps.targetTerm,
  );
  const discoverySearchQueries = discoveryQueriesForSearch(searchQueries, targetExistingTerms);
  const discoveryLimit = Math.max(
    1,
    Math.min(Number(payload.discoveryLimit || deps.discoveryLimit || process.env.BILIBILI_VIDEO_DISCOVERY_LIMIT || 6), 20),
  );
  const discoveryPages = Math.max(
    1,
    Math.min(Number(payload.discoveryPages || deps.discoveryPages || process.env.BILIBILI_VIDEO_DISCOVERY_PAGES || 1), 5),
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
  const discoveryCandidateLimit =
    existingTermsOnly || targetExistingTerms.length > 0
      ? boundedInt(
          payload.discoveryCandidateLimit ?? deps.discoveryCandidateLimit ?? process.env.BILIBILI_VIDEO_DISCOVERY_CANDIDATE_LIMIT ?? 10,
          10,
          discoveryLimit,
          50,
        )
      : discoveryLimit;
  const includeVideoContext =
    payload.includeVideoContext === false
      ? false
      : payload.includeVideoContext === true ||
        deps.includeVideoContext === true ||
        process.env.BILIBILI_HARVEST_INCLUDE_VIDEO_CONTEXT === '1' ||
        existingTermsOnly;
  const includeVideoObjectEvidence = payload.includeVideoObjectEvidence !== false && deps.includeVideoObjectEvidence !== false;
  const includeDanmaku =
    payload.includeDanmaku === false
      ? false
      : payload.includeDanmaku === true ||
        deps.includeDanmaku === true ||
        (process.env.BILIBILI_HARVEST_INCLUDE_DANMAKU === '1' &&
          (Boolean(deps.fetchText) || payload.allowNetworkDanmaku === true || deps.allowNetworkDanmaku === true));
  const discoveryMode = String(payload.discoveryMode || deps.discoveryMode || process.env.BILIBILI_VIDEO_DISCOVERY_MODE || 'controversial')
    .trim()
    .toLowerCase();
  const prioritizeSearchQueries =
    payload.prioritizeSearchQueries === true ||
    deps.prioritizeSearchQueries === true ||
    process.env.BILIBILI_HARVEST_PRIORITIZE_SEARCH_QUERIES === '1' ||
    (existingTermsOnly && discoveryMode !== 'controversial');
  const includeGenericPopular =
    payload.includeGenericPopular === true ||
    deps.includeGenericPopular === true ||
    envFlag(process.env.BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR, false);
  const targetSearchOnly = payload.targetSearchOnly === true || deps.targetSearchOnly === true;
  const allowFilteredDiscoveryFallback = payload.allowFilteredDiscoveryFallback === true || deps.allowFilteredDiscoveryFallback === true;
  const preferFilteredDiscoveryFallback = payload.preferFilteredDiscoveryFallback === true || deps.preferFilteredDiscoveryFallback === true;
  const allowPopularDiscoveryOnSearchBlock = payload.allowPopularDiscoveryOnSearchBlock === true || deps.allowPopularDiscoveryOnSearchBlock === true;
  const evidenceSourceVideoFallback =
    payload.evidenceSourceVideoFallback === true ||
    payload.allowEvidenceSourceVideoFallback === true ||
    deps.evidenceSourceVideoFallback === true ||
    deps.allowEvidenceSourceVideoFallback === true;
  const evidenceSourceFallbackLimit = boundedInt(
    payload.evidenceSourceFallbackLimit ?? deps.evidenceSourceFallbackLimit ?? process.env.BILIBILI_EVIDENCE_SOURCE_FALLBACK_LIMIT ?? Math.max(12, discoveryLimit),
    Math.max(12, discoveryLimit),
    discoveryLimit,
    50,
  );
  const evidenceSourceFallbackPages = boundedInt(
    payload.evidenceSourceFallbackPages ?? deps.evidenceSourceFallbackPages ?? process.env.BILIBILI_EVIDENCE_SOURCE_FALLBACK_PAGES ?? 3,
    3,
    1,
    5,
  );
  const discoveryWarnings = [];
  let discoveredVideos = [];
  let discoveryContextVideos = [];
  let usedEvidenceSourceFallback = false;
  let usedPopularDiscoveryFallback = false;
  const excludeBvids = parseSet(payload.excludeBvids || deps.excludeBvids);
  const popularFallbackExcludeBvids = parseSet(payload.popularFallbackExcludeBvids || deps.popularFallbackExcludeBvids);
  const loadEvidenceSourceFallbackVideos = async () => {
    if (!evidenceSourceVideoFallback || !existingTermsOnly || targetExistingTerms.length === 0) return [];
    try {
      const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
      return evidenceSourceVideosForTerms(await readKeywordDictionary(), targetExistingTerms, evidenceSourceFallbackLimit, excludeBvids);
    } catch (error) {
      discoveryWarnings.push(`existing evidence-source fallback: ${error.message}`);
      return [];
    }
  };
  if (videoLinks.length === 0) {
    const discoveryGroups = [];
    if (discoveryMode === 'search' || discoveryMode === 'mixed') {
      const discoverVideos = deps.discoverVideosByKeyword || discoverVideosByKeyword;
      const group = [];
      for (const query of discoverySearchQueries) {
        try {
          throwIfAborted(payload.abortSignal);
          group.push(...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages })));
          throwIfAborted(payload.abortSignal);
        } catch (error) {
          discoveryWarnings.push(`${query}: ${error.message}`);
          if (payload.abortSignal?.aborted) break;
        }
      }
      discoveryGroups.push(group);
    }
    if (discoveryMode === 'controversial') {
      const discoverVideos = deps.discoverVideosByKeyword || discoverVideosByKeyword;
      const controversialPopularGroup = [];
      const controversyGroup = [];
      const searchGroup = [];
      if (targetSearchOnly) {
        for (const query of discoverySearchQueries) {
          try {
            throwIfAborted(payload.abortSignal);
            searchGroup.push(...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages })));
            throwIfAborted(payload.abortSignal);
          } catch (error) {
            discoveryWarnings.push(`${query}: ${error.message}`);
            if (payload.abortSignal?.aborted) break;
          }
        }
        if (searchGroup.length === 0 && allowFilteredDiscoveryFallback && !payload.abortSignal?.aborted) {
          for (const query of controversyQueries.slice(0, controversialPopularQueryLimit)) {
            try {
              throwIfAborted(payload.abortSignal);
              controversialPopularGroup.push(
                ...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages, searchOrder: controversialPopularSearchOrder })),
              );
              throwIfAborted(payload.abortSignal);
            } catch (error) {
              discoveryWarnings.push(`${query} (${controversialPopularSearchOrder || 'popular'}): ${error.message}`);
              if (payload.abortSignal?.aborted) break;
            }
          }
          for (const query of controversyQueries) {
            try {
              throwIfAborted(payload.abortSignal);
              controversyGroup.push(...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages })));
              throwIfAborted(payload.abortSignal);
            } catch (error) {
              discoveryWarnings.push(`${query}: ${error.message}`);
              if (payload.abortSignal?.aborted) break;
            }
          }
        }
        discoveryGroups.push(searchGroup, controversialPopularGroup, controversyGroup);
      } else {
        for (const query of controversyQueries.slice(0, controversialPopularQueryLimit)) {
          try {
            throwIfAborted(payload.abortSignal);
            controversialPopularGroup.push(
              ...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages, searchOrder: controversialPopularSearchOrder })),
            );
            throwIfAborted(payload.abortSignal);
          } catch (error) {
            discoveryWarnings.push(`${query} (${controversialPopularSearchOrder || 'popular'}): ${error.message}`);
            if (payload.abortSignal?.aborted) break;
          }
        }
        for (const query of controversyQueries) {
          try {
            throwIfAborted(payload.abortSignal);
            controversyGroup.push(...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages })));
            throwIfAborted(payload.abortSignal);
          } catch (error) {
            discoveryWarnings.push(`${query}: ${error.message}`);
            if (payload.abortSignal?.aborted) break;
          }
        }
        for (const query of discoverySearchQueries) {
          try {
            throwIfAborted(payload.abortSignal);
            searchGroup.push(...(await discoverVideos(query, discoveryCandidateLimit, { ...deps, discoveryPages })));
            throwIfAborted(payload.abortSignal);
          } catch (error) {
            discoveryWarnings.push(`${query}: ${error.message}`);
            if (payload.abortSignal?.aborted) break;
          }
        }
        discoveryGroups.push(
          ...(prioritizeSearchQueries
            ? [searchGroup, controversialPopularGroup, controversyGroup]
            : [controversialPopularGroup, controversyGroup, searchGroup]),
        );
      }
    }
    if (discoveryMode === 'popular' || discoveryMode === 'mixed' || (discoveryMode === 'controversial' && includeGenericPopular)) {
      const discoverPopular = deps.discoverPopularVideos || discoverPopularVideos;
      try {
        throwIfAborted(payload.abortSignal);
        discoveryGroups.push(await discoverPopular(discoveryLimit, deps));
        throwIfAborted(payload.abortSignal);
      } catch (error) {
        discoveryWarnings.push(`popular: ${error.message}`);
      }
    }
    if (
      allowPopularDiscoveryOnSearchBlock &&
      discoveryGroups.every((group) => group.length === 0) &&
      discoveryWarnings.some(isBlockedDiscoveryWarning) &&
      !payload.abortSignal?.aborted
    ) {
      const discoverPopular = deps.discoverPopularVideos || discoverPopularVideos;
      try {
        throwIfAborted(payload.abortSignal);
        const popularFallbackLimit = Math.min(50, Math.max(discoveryLimit, discoveryLimit + popularFallbackExcludeBvids.size));
        discoveryGroups.push(
          (await discoverPopular(popularFallbackLimit, deps))
            .filter((video) => !popularFallbackExcludeBvids.has(video.bvid))
            .slice(0, discoveryLimit),
        );
        usedPopularDiscoveryFallback = true;
        throwIfAborted(payload.abortSignal);
      } catch (error) {
        discoveryWarnings.push(`popular after search block: ${error.message}`);
      }
    }
    discoveryContextVideos = uniqueByKey(
      discoveryGroups.flatMap((group) => group),
      (video) => video.bvid || video.sourceUrl || video.title,
    );
    if (targetExistingTerms.length > 0) {
      discoveryContextVideos = filterRelevantVideos(discoveryContextVideos, searchQueries, targetExistingTerms);
    }
    const rankedDiscoveryGroups =
      existingTermsOnly || targetExistingTerms.length > 0
        ? discoveryGroups.map((group) => sortVideosByRelevance(group, searchQueries, targetExistingTerms))
        : discoveryGroups;
    let eligibleDiscoveryGroups =
      targetExistingTerms.length > 0
        ? rankedDiscoveryGroups.map((group) => filterRelevantVideos(group, searchQueries, targetExistingTerms))
        : rankedDiscoveryGroups;
    if (targetExistingTerms.length > 0 && eligibleDiscoveryGroups.every((group) => group.length === 0)) {
      const evidenceSourceVideos = await loadEvidenceSourceFallbackVideos();
      if (evidenceSourceVideos.length > 0) {
        eligibleDiscoveryGroups = [evidenceSourceVideos];
        usedEvidenceSourceFallback = true;
      }
    }
    if (
      targetExistingTerms.length > 0 &&
      includeVideoContext === false &&
      allowFilteredDiscoveryFallback &&
      preferFilteredDiscoveryFallback &&
      !usedEvidenceSourceFallback &&
      !targetsAskBaiduTerm(targetExistingTerms) &&
      !targetsRequireStrictRelevance(targetExistingTerms)
    ) {
      eligibleDiscoveryGroups = rankedDiscoveryGroups.map((group) => group.slice(0, discoveryLimit));
    }
    if (
      targetExistingTerms.length > 0 &&
      includeVideoContext === false &&
      allowFilteredDiscoveryFallback &&
      !usedEvidenceSourceFallback &&
      !targetsAskBaiduTerm(targetExistingTerms) &&
      !targetsRequireStrictRelevance(targetExistingTerms) &&
      eligibleDiscoveryGroups.every((group) => group.length === 0)
    ) {
      eligibleDiscoveryGroups = rankedDiscoveryGroups.map((group) => group.slice(0, discoveryLimit));
    }
    discoveredVideos = usedEvidenceSourceFallback
      ? uniqueByKey(
          eligibleDiscoveryGroups.flatMap((group) => group).filter((video) => !excludeBvids.has(video.bvid)),
          (video) => video.bvid || video.sourceUrl || video.title,
        )
      : roundRobinUnique(
          eligibleDiscoveryGroups.map((group) => group.filter((video) => !excludeBvids.has(video.bvid))),
          discoveryLimit,
          (video) => video.bvid,
        );
    if ((existingTermsOnly || targetExistingTerms.length > 0) && (discoveryMode !== 'controversial' || prioritizeSearchQueries)) {
      discoveredVideos = sortVideosByRelevance(discoveredVideos, searchQueries, targetExistingTerms);
    }
    if (discoveredVideos.length === 0 && evidenceSourceVideoFallback && existingTermsOnly && targetExistingTerms.length > 0) {
      discoveredVideos = await loadEvidenceSourceFallbackVideos();
      usedEvidenceSourceFallback = discoveredVideos.length > 0;
    }
    if (discoveredVideos.length === 0) {
      const videoContextText = includeVideoContext ? buildVideoContextText(discoveryContextVideos) : '';
      const videoObjectEvidenceText =
        includeVideoContext || !existingTermsOnly || !includeVideoObjectEvidence
          ? ''
          : buildTargetVideoObjectEvidenceText(discoveryContextVideos, searchQueries, targetExistingTerms);
      const trainingText = [videoObjectEvidenceText, videoContextText].filter((item) => item.trim()).join('\n');
      if (trainingText) {
        const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
        const contextSourceUrls = videoContextSourceUrls(discoveryContextVideos);
        const keywordTraining = await trainKeywordDictionary({
          uid: discoveryContextVideos.map((video) => video.bvid).filter(Boolean).join(','),
          text: trainingText,
          source: `Bilibili public search-discovered video${videoObjectEvidenceText ? ' object evidence' : ' context'}: ${contextSourceUrls.join(', ')}`,
          existingTermsOnly,
          ...(targetExistingTerms.length ? { targetExistingTerms } : {}),
        });
        return {
          ok: true,
          video: null,
          videos: [],
          discoveredVideos,
          discoveryContextVideos,
          searchQueries,
          controversyQueries: discoveryMode === 'controversial' ? controversyQueries : [],
          controversialPopularQueries: discoveryMode === 'controversial' ? controversyQueries.slice(0, controversialPopularQueryLimit) : [],
          controversialPopularSearchOrder: discoveryMode === 'controversial' ? controversialPopularSearchOrder : null,
          discoveryMode,
          comments: [],
          commentText: '',
          videoContextText,
          videoObjectEvidenceText,
          source: 'Bilibili public search-discovered video context',
          confidenceHint: 'search result video context only',
          warnings: discoveryWarnings,
          entries: keywordTraining.entries || [],
          keywordTraining,
          dictionary: keywordTraining.dictionary || null,
          collectionDiagnostics: buildCollectionDiagnostics({
            discoveredVideos,
            discoveryContextVideos,
            videos: [],
            comments: [],
            trainingText,
            targetExistingTerms,
            keywordTraining,
          }),
        };
      }
      return {
        ok: false,
        error: discoveryWarnings[0] || 'No Bilibili videos were discovered from the backend discovery mode.',
        warnings: discoveryWarnings,
        discoveredVideos,
        discoveryContextVideos,
        searchQueries,
        controversyQueries: discoveryMode === 'controversial' ? controversyQueries : [],
        controversialPopularQueries: discoveryMode === 'controversial' ? controversyQueries.slice(0, controversialPopularQueryLimit) : [],
        controversialPopularSearchOrder: discoveryMode === 'controversial' ? controversialPopularSearchOrder : null,
        discoveryMode,
        videos: [],
        comments: [],
        commentText: '',
        videoContextText: '',
        entries: [],
        keywordTraining: null,
        dictionary: null,
        collectionDiagnostics: buildCollectionDiagnostics({
          discoveredVideos,
          discoveryContextVideos,
          videos: [],
          comments: [],
          trainingText: '',
          targetExistingTerms,
        }),
      };
    }
  }

  const scans = [];
  const warnings = [...discoveryWarnings];
  const scanTargets = videoLinks.length > 0 ? videoLinks : discoveredVideos.map((video) => video.bvid || video.sourceUrl);
  const scanPages =
    usedEvidenceSourceFallback && videoLinks.length === 0
      ? Math.max(1, Math.min(Math.max(Number(payload.pages) || 1, evidenceSourceFallbackPages), 5))
      : payload.pages;
  const deepenReplyThreadsEnabled =
    (payload.deepenReplyThreads === true || deps.deepenReplyThreads === true) && existingTermsOnly;
  let deepenMatch = null;
  if (deepenReplyThreadsEnabled) {
    try {
      const readKeywordDictionary = deps.readKeywordDictionary || defaultReadKeywordDictionary;
      const dictionary = await readKeywordDictionary();
      const deepenNeedles = dictionaryNeedleSet(dictionary);
      for (const term of targetExistingTerms) {
        const clean = cleanSearchText(term);
        if (clean.length >= 2) deepenNeedles.add(clean);
      }
      if (deepenNeedles.size > 0) deepenMatch = (message) => commentMatchesNeedleSet(message, deepenNeedles);
    } catch (error) {
      warnings.push(`reply deepening: ${error.message}`);
    }
  }
  const deepenScanOptions = deepenMatch
    ? {
        deepenMatch,
        deepenRootLimit: boundedInt(payload.deepenRootLimit ?? deps.deepenRootLimit ?? process.env.BILIBILI_HARVEST_DEEPEN_ROOT_LIMIT ?? 6, 6, 0, 30),
        deepenPages: boundedInt(payload.deepenPages ?? deps.deepenPages ?? process.env.BILIBILI_HARVEST_DEEPEN_PAGES ?? 2, 2, 1, 5),
      }
    : {};
  for (const videoLink of scanTargets) {
    try {
      const scan = await fetchRepliesForVideo(videoLink, { pages: scanPages, includeDanmaku, ...deepenScanOptions }, deps);
      if (scan.ok) {
        scans.push(scan);
      } else {
        warnings.push(`${videoLink}: ${scan.error}`);
      }
    } catch (error) {
      warnings.push(`${videoLink}: ${error.message}`);
    }
  }

  if (scans.length === 0) {
    return {
      ok: false,
      error: warnings[0] || 'No valid Bilibili videos were found.',
      warnings,
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
      videos: [],
      comments: [],
      commentText: '',
      videoContextText: '',
      entries: [],
      keywordTraining: null,
      dictionary: null,
      collectionDiagnostics: buildCollectionDiagnostics({
        discoveredVideos,
        discoveryContextVideos,
        videos: [],
        comments: [],
        trainingText: '',
        targetExistingTerms,
      }),
    };
  }

  const comments = uniqueByKey(
    scans.flatMap((scan) => scan.comments || []),
    (comment) => `${comment.bvid || comment.sourceUrl}:${comment.rpid}`,
  );
  const videos = scans.map((scan) => scan.video);
  const preFilterCommentsEnabled =
    (payload.preFilterCommentsToTargets === true || deps.preFilterCommentsToTargets === true) && existingTermsOnly;
  const commentPreFilter = preFilterCommentsEnabled
    ? await preFilterCommentsToDictionary({ comments, existingTermsOnly, targetExistingTerms, deps, warnings })
    : { comments, applied: false, needleCount: 0, before: comments.length, after: comments.length };
  const trainingComments = commentPreFilter.comments;
  const commentText = trainingComments.map((comment) => comment.message).filter(Boolean).join('\n');
  const contextVideos = videoContextSources(videos, discoveryContextVideos.length ? discoveryContextVideos : discoveredVideos);
  const videoContextText = includeVideoContext ? buildVideoContextText(contextVideos) : '';
  const videoObjectEvidenceText =
    includeVideoContext || !existingTermsOnly || !includeVideoObjectEvidence
      ? ''
      : buildTargetVideoObjectEvidenceText(contextVideos, searchQueries, targetExistingTerms);
  const trainingText = [commentText, videoObjectEvidenceText, videoContextText].filter((item) => item.trim()).join('\n');
  const effectiveTargetExistingTerms =
    payload.expandTargetsFromComments === true ||
    deps.expandTargetsFromComments === true ||
    (usedPopularDiscoveryFallback && payload.expandTargetsFromSearchBlockComments !== false && deps.expandTargetsFromSearchBlockComments !== false)
      ? await expandTargetTermsFromCommentHits({
          commentText,
          existingTermsOnly,
          targetExistingTerms,
          targetEvidence: boundedInt(payload.targetEvidence ?? deps.targetEvidence ?? process.env.BILIBILI_COVERAGE_TARGET_EVIDENCE ?? 3, 3, 1, 20),
          limit: boundedInt(payload.commentHitTargetLimit ?? deps.commentHitTargetLimit ?? process.env.BILIBILI_COMMENT_HIT_TARGET_LIMIT ?? 48, 48, 1, 200),
          deps,
          warnings,
        })
      : targetExistingTerms;
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
    videoObjectEvidenceText,
    videoContextText,
    source:
      videoLinks.length === 0
        ? usedEvidenceSourceFallback
          ? 'Bilibili public existing evidence-source video comment scan'
          : 'Bilibili public search-discovered video comment scan'
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
      collectionDiagnostics: buildCollectionDiagnostics({
        discoveredVideos,
        discoveryContextVideos,
        videos,
        comments,
        trainingText,
        targetExistingTerms: effectiveTargetExistingTerms,
      }),
    };
  }

  const trainKeywordDictionary = deps.trainKeywordDictionary || defaultTrainKeywordDictionary;
  const contextSourceUrls = videoContextSourceUrls(contextVideos);
  const keywordTraining = await trainKeywordDictionary(
    {
      uid: videos.map((video) => video.bvid).join(','),
      text: trainingText,
      source: `${mergedScan.source}${videoObjectEvidenceText ? ' plus video object evidence' : ''}${videoContextText ? ' plus video context' : ''}: ${contextSourceUrls.join(', ')}`,
      existingTermsOnly,
      ...(effectiveTargetExistingTerms.length ? { targetExistingTerms: effectiveTargetExistingTerms } : {}),
    },
    payload.abortSignal ? { signal: payload.abortSignal } : {},
  );

  return {
    ...mergedScan,
    entries: keywordTraining.entries || [],
    keywordTraining,
    dictionary: keywordTraining.dictionary || null,
    collectionDiagnostics: {
      ...buildCollectionDiagnostics({
        discoveredVideos,
        discoveryContextVideos,
        videos,
        comments,
        trainingText,
        targetExistingTerms: effectiveTargetExistingTerms,
        keywordTraining,
      }),
      commentPreFilter: {
        applied: commentPreFilter.applied,
        needleCount: commentPreFilter.needleCount,
        commentsBefore: commentPreFilter.before,
        commentsRouted: commentPreFilter.after,
      },
    },
  };
}
