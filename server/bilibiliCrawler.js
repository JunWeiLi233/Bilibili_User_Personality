const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7';
const SEC_CH_UA = '"Chromium";v="124", "Google Chrome";v="124", "Not.A/Brand";v="99"';
const BLOCK_CODES = new Set([-101, -111, -352, -412, -509, -799]);
const MAX_COOLDOWN_MULTIPLIER = 8;
const responseCache = new Map();
const cookieJar = new Map();
let nextRequestAt = 0;
let cooldownUntil = 0;
let consecutiveBlocks = 0;
let sessionUaPicked = false;
let sessionUserAgent = USER_AGENTS[0];
let sessionPlatform = 'Windows';
let cookiesInitialized = false;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readCrawlerConfig(env = process.env) {
  return {
    minDelayMs: Math.max(0, Number(env.BILIBILI_CRAWLER_MIN_DELAY_MS || 1600)),
    jitterMs: Math.max(0, Number(env.BILIBILI_CRAWLER_JITTER_MS || 1400)),
    blockCooldownMs: Math.max(0, Number(env.BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS || 60000)),
    cacheTtlMs: Math.max(0, Number(env.BILIBILI_CRAWLER_CACHE_TTL_MS || 120000)),
    longPauseProbability: Math.min(
      1,
      Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_PROBABILITY ?? 0.08)),
    ),
    longPauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_MIN_MS || 2200)),
    longPauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_LONG_PAUSE_MAX_MS || 6500)),
    pagePauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_PAGE_PAUSE_MIN_MS || 600)),
    pagePauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_PAGE_PAUSE_MAX_MS || 1600)),
    objectPauseMinMs: Math.max(0, Number(env.BILIBILI_CRAWLER_OBJECT_PAUSE_MIN_MS || 1400)),
    objectPauseMaxMs: Math.max(0, Number(env.BILIBILI_CRAWLER_OBJECT_PAUSE_MAX_MS || 3600)),
    requestTimeoutMs: Math.max(0, Number(env.BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS || 20000)),
  };
}

export function isBilibiliBlockResponse(payload) {
  return BLOCK_CODES.has(Number(payload?.code));
}

export function resetBilibiliRequestState() {
  responseCache.clear();
  cookieJar.clear();
  nextRequestAt = 0;
  cooldownUntil = 0;
  consecutiveBlocks = 0;
  sessionUaPicked = false;
  cookiesInitialized = false;
}

function cacheKey(url, referer) {
  return `${referer || ''} ${String(url)}`;
}

function randomHex(len, randomFn) {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += Math.floor(randomFn() * 16).toString(16);
  }
  return out.toUpperCase();
}

function ensureSessionUserAgent(randomFn) {
  if (sessionUaPicked) return;
  sessionUaPicked = true;
  const pick = Math.floor(randomFn() * USER_AGENTS.length);
  const idx = ((pick % USER_AGENTS.length) + USER_AGENTS.length) % USER_AGENTS.length;
  sessionUserAgent = USER_AGENTS[idx] || USER_AGENTS[0];
  sessionPlatform = sessionUserAgent.includes('Macintosh') ? 'macOS' : 'Windows';
}

function ensureCookies(randomFn, nowFn) {
  if (cookiesInitialized) return;
  cookiesInitialized = true;

  const envCookie = (process.env.BILIBILI_COOKIE || '').trim();
  if (envCookie) {
    for (const part of envCookie.split(/;\s*/)) {
      const eq = part.indexOf('=');
      if (eq > 0) {
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name && value) cookieJar.set(name, value);
      }
    }
    return;
  }

  const r = randomFn || Math.random;
  const epochSec = Math.floor((nowFn ? nowFn() : Date.now()) / 1000);
  cookieJar.set(
    'buvid3',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(13, r)}infoc`,
  );
  cookieJar.set(
    'buvid4',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(12, r)}-${epochSec}-1`,
  );
  cookieJar.set('b_nut', String(epochSec));
  cookieJar.set(
    '_uuid',
    `${randomHex(8, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(4, r)}-${randomHex(15, r)}infoc`,
  );
  cookieJar.set('b_lsid', `${randomHex(8, r)}_${randomHex(10, r)}`);
  cookieJar.set('bsource', 'search_bing');
  cookieJar.set('home_feed', 'recommend');
}

export function normalizeBilibiliCookie(value) {
  return String(value || '')
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter((part) => {
      const eq = part.indexOf('=');
      if (eq <= 0) return false;
      const name = part.slice(0, eq).trim();
      const cookieValue = part.slice(eq + 1).trim();
      return Boolean(name && cookieValue) && !/[\r\n:]/.test(name) && !/[\r\n]/.test(cookieValue);
    })
    .join('; ');
}

function cookieHeader(requestCookie = '') {
  const merged = new Map(cookieJar);
  for (const part of normalizeBilibiliCookie(requestCookie).split(/;\s*/).filter(Boolean)) {
    const eq = part.indexOf('=');
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name && value) merged.set(name, value);
  }
  if (!merged.size) return '';
  return [...merged.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

export function depsWithBilibiliCookie(deps = {}, cookie = '') {
  const bilibiliCookie = normalizeBilibiliCookie(cookie);
  if (!bilibiliCookie) return deps;
  const requestJson = deps.fetchJson || fetchJson;
  const requestText = deps.fetchText || fetchText;
  return {
    ...deps,
    fetchJson: (url, referer, options = {}) => requestJson(url, referer, { ...options, bilibiliCookie }),
    fetchText: (url, referer, options = {}) => requestText(url, referer, { ...options, bilibiliCookie }),
  };
}

function captureSetCookies(response) {
  const headers = response?.headers;
  if (!headers) return;
  let raw;
  if (typeof headers.getSetCookie === 'function') {
    try { raw = headers.getSetCookie(); } catch { raw = undefined; }
  }
  if (!raw && typeof headers.raw === 'function') {
    try { raw = headers.raw()?.['set-cookie']; } catch { raw = undefined; }
  }
  if (!raw && typeof headers.get === 'function') {
    const v = headers.get('set-cookie');
    if (v) raw = [v];
  }
  if (!raw) return;
  for (const line of raw) {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name && value) cookieJar.set(name, value);
  }
}

function siteRelation(url, referer) {
  try {
    const A = new URL(url);
    const B = new URL(referer);
    if (A.host === B.host) return 'same-origin';
    const baseA = A.hostname.split('.').slice(-2).join('.');
    const baseB = B.hostname.split('.').slice(-2).join('.');
    return baseA === baseB ? 'same-site' : 'cross-site';
  } catch {
    return 'cross-site';
  }
}

function buildHeaders(url, referer, randomFn, nowFn, requestCookie = '') {
  ensureSessionUserAgent(randomFn);
  ensureCookies(randomFn, nowFn);
  let origin = 'https://www.bilibili.com';
  try { origin = new URL(referer).origin; } catch {}
  const headers = {
    'user-agent': sessionUserAgent,
    referer,
    origin,
    accept: 'application/json, text/plain, */*',
    'accept-language': ACCEPT_LANGUAGE,
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'sec-ch-ua': SEC_CH_UA,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${sessionPlatform}"`,
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': siteRelation(url, referer),
  };
  const cookies = cookieHeader(requestCookie);
  if (cookies) headers.cookie = cookies;
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, init, config) {
  const timeoutMs = Math.max(0, Number(config?.requestTimeoutMs) || 0);
  if (!timeoutMs || typeof AbortController === 'undefined') {
    return fetchImpl(url, init);
  }

  const controller = new AbortController();
  const callerSignal = init?.signal;
  const signal =
    callerSignal && typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([callerSignal, controller.signal])
      : callerSignal || controller.signal;
  if (callerSignal && typeof callerSignal.addEventListener === 'function' && signal === controller.signal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    return await fetchImpl(url, { ...init, signal });
  } catch (error) {
    if (controller.signal.aborted && !(callerSignal?.aborted)) {
      throw new Error(`Bilibili request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function fetchConfigWithSignal(config, signal) {
  if (!signal) return config;
  return { ...config, signal };
}

function pickRange(randomFn, minMs, maxMs) {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor((randomFn ? randomFn() : Math.random()) * (maxMs - minMs));
}

export function humanPause(minMs, maxMs, options = {}) {
  if (maxMs <= 0) return Promise.resolve();
  const waitFn = options.waitFn || wait;
  return waitFn(pickRange(options.randomFn || Math.random, minMs, maxMs));
}

async function scheduleBilibiliRequest(options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const nowFn = options.nowFn || Date.now;
  const waitFn = options.waitFn || wait;
  const randomFn = options.randomFn || Math.random;
  const now = nowFn();
  const waitUntil = Math.max(cooldownUntil, nextRequestAt);
  if (waitUntil > now) {
    await waitFn(waitUntil - now);
  }
  // Occasional "user reading content" pause on top of the normal rate cap.
  // Condition is inverted (> 1 - p) so a randomFn returning 0 never triggers it,
  // keeping deterministic test pacing stable.
  if (
    config.longPauseProbability > 0 &&
    config.longPauseMaxMs > config.longPauseMinMs &&
    randomFn() > 1 - config.longPauseProbability
  ) {
    const pause =
      config.longPauseMinMs + Math.floor(randomFn() * (config.longPauseMaxMs - config.longPauseMinMs));
    await waitFn(pause);
  }
  const jitter = Math.floor(randomFn() * config.jitterMs);
  nextRequestAt = nowFn() + config.minDelayMs + jitter;
  return config;
}

function applyBlockCooldown(config, nowFn) {
  consecutiveBlocks += 1;
  const multiplier = Math.min(2 ** (consecutiveBlocks - 1), MAX_COOLDOWN_MULTIPLIER);
  cooldownUntil = nowFn() + config.blockCooldownMs * multiplier;
}

export async function fetchJson(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const requestCookie = normalizeBilibiliCookie(options.bilibiliCookie || options.cookie);
  const key = requestCookie ? '' : cacheKey(url, referer);
  const nowFn = options.nowFn || Date.now;
  const randomFn = options.randomFn || Math.random;
  const cached = key ? responseCache.get(key) : null;
  if (cached && config.cacheTtlMs > 0 && cached.expiresAt > nowFn()) {
    return cached.payload;
  }

  await scheduleBilibiliRequest({ ...options, config });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      headers: buildHeaders(url, referer, randomFn, nowFn, requestCookie),
      ...(config.signal ? { signal: config.signal } : {}),
    },
    config,
  );
  if (!response.ok) {
    if ([403, 429, 503].includes(Number(response.status))) {
      applyBlockCooldown(config, nowFn);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  captureSetCookies(response);
  const payload = await response.json();
  if (isBilibiliBlockResponse(payload)) {
    applyBlockCooldown(config, nowFn);
  } else if (payload?.code === 0) {
    consecutiveBlocks = 0;
    if (key && config.cacheTtlMs > 0) {
      responseCache.set(key, {
        expiresAt: nowFn() + config.cacheTtlMs,
        payload,
      });
    }
  }
  return payload;
}

export async function fetchText(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = fetchConfigWithSignal({ ...readCrawlerConfig(options.env), ...(options.config || {}) }, options.signal);
  const nowFn = options.nowFn || Date.now;
  const randomFn = options.randomFn || Math.random;
  const requestCookie = normalizeBilibiliCookie(options.bilibiliCookie || options.cookie);
  await scheduleBilibiliRequest({ ...options, config });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      headers: buildHeaders(url, referer, randomFn, nowFn, requestCookie),
      ...(config.signal ? { signal: config.signal } : {}),
    },
    config,
  );
  if (!response.ok) {
    if ([403, 429, 503].includes(Number(response.status))) {
      applyBlockCooldown(config, nowFn);
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  captureSetCookies(response);
  consecutiveBlocks = 0;
  return response.text();
}

export function parseBvidPool(raw) {
  return String(raw || '')
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => /^BV[0-9A-Za-z]+$/.test(item));
}

export function extractBvid(input) {
  const text = String(input || '').trim();
  const match = text.match(/BV[0-9A-Za-z]+/);
  return match?.[0] || '';
}

function textSnippet(text, fallback) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > 48 ? `${clean.slice(0, 48)}...` : clean;
}

function videoObjectFromView(bvid, data) {
  return {
    id: `video-1-${data.aid}`,
    kind: 'video',
    bvid,
    oid: String(data.aid),
    replyType: 1,
    title: data.title || bvid,
    authorMid: String(data.owner?.mid || ''),
    sourceUrl: `https://www.bilibili.com/video/${bvid}/`,
    replyCount: Number(data.stat?.reply || 0),
    cid: String(data.cid || data.pages?.[0]?.cid || ''),
  };
}

function videoObjectFromSpaceItem(item, uid) {
  return {
    id: `video-1-${item.aid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid),
    replyType: 1,
    title: item.title || item.bvid,
    authorMid: String(item.mid || uid || ''),
    sourceUrl: `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.comment || 0),
  };
}

function cleanSearchTitle(title, fallback) {
  const clean = String(title || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback;
}

function videoObjectFromSearchItem(item) {
  return {
    id: `video-1-${item.aid || item.id || item.bvid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid || item.id || ''),
    replyType: 1,
    title: cleanSearchTitle(item.title, item.bvid),
    authorMid: String(item.mid || item.author_mid || ''),
    sourceUrl: item.arcurl || `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.review || item.comment || 0),
  };
}

function videoObjectFromPopularItem(item) {
  return {
    id: `video-1-${item.aid || item.bvid}`,
    kind: 'video',
    bvid: item.bvid,
    oid: String(item.aid || ''),
    replyType: 1,
    title: item.title || item.bvid,
    authorMid: String(item.owner?.mid || item.mid || ''),
    sourceUrl: item.short_link_v2 || `https://www.bilibili.com/video/${item.bvid}/`,
    replyCount: Number(item.stat?.reply || item.stat?.danmaku || 0),
  };
}

export async function resolveBvid(bvid, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const data = await requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0) throw new Error(data.message || `Cannot resolve ${bvid}`);
  return videoObjectFromView(bvid, data.data);
}

export async function discoverVideosByKeyword(query, limit = 6, deps = {}) {
  const keyword = String(query || '').trim();
  if (!keyword) return [];
  const requestJson = deps.fetchJson || fetchJson;
  const pageSize = Math.max(1, Math.min(Number(limit || 6), 20));
  const order = String(deps.searchOrder || '').trim();
  const searchPages = Math.max(1, Math.min(Number(deps.searchPages || deps.discoveryPages || 1), 5));
  const videos = [];
  const seen = new Set();
  for (let page = 1; page <= searchPages && videos.length < pageSize; page += 1) {
    const url = new URL('https://api.bilibili.com/x/web-interface/search/type');
    url.searchParams.set('search_type', 'video');
    url.searchParams.set('keyword', keyword);
    url.searchParams.set('page', String(page));
    url.searchParams.set('page_size', String(pageSize));
    if (order) url.searchParams.set('order', order);
    const data = await requestJson(url.toString(), `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`);
    if (data.code !== 0) {
      throw new Error(data.message || `video search failed with code ${data.code}`);
    }
    for (const item of data.data?.result || []) {
      if (!item?.bvid || seen.has(item.bvid)) continue;
      seen.add(item.bvid);
      videos.push(videoObjectFromSearchItem(item));
      if (videos.length >= pageSize) break;
    }
  }
  return videos;
}

export async function discoverPopularVideos(limit = 6, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const pageSize = Math.max(1, Math.min(Number(limit || 6), 20));
  const url = `https://api.bilibili.com/x/web-interface/popular?pn=1&ps=${pageSize}`;
  const data = await requestJson(url, 'https://www.bilibili.com/v/popular/all');
  if (data.code !== 0) {
    throw new Error(data.message || `popular video discovery failed with code ${data.code}`);
  }
  return (data.data?.list || [])
    .filter((item) => item?.bvid)
    .slice(0, pageSize)
    .map(videoObjectFromPopularItem);
}

export async function fetchUserCard(uid, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const data = await requestJson(
    `https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(uid)}&photo=false`,
    `https://space.bilibili.com/${uid}`,
  );
  if (data.code !== 0) throw new Error(data.message || `user card failed with code ${data.code}`);
  return {
    mid: String(data.card?.mid || uid),
    name: data.card?.name || `UID ${uid}`,
    sign: data.card?.sign || '',
  };
}

export async function discoverVideosByUid(uid, limit, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const url = `https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(uid)}&pn=1&ps=${limit}&order=pubdate`;
  const data = await requestJson(url, `https://space.bilibili.com/${uid}`);
  if (data.code !== 0) {
    throw new Error(data.message || `space video discovery failed with code ${data.code}`);
  }
  const list = data.data?.list?.vlist || [];
  return list.slice(0, limit).map((item) => videoObjectFromSpaceItem(item, uid));
}

function getDynamicText(item) {
  const dynamic = item?.modules?.module_dynamic || {};
  const descText = dynamic.desc?.text;
  const major = dynamic.major || {};
  const opusText = major.opus?.summary?.text || major.opus?.title;
  const archiveText = major.archive?.desc || major.archive?.title;
  const articleText = major.article?.desc || major.article?.title;
  return String(descText || opusText || archiveText || articleText || '').trim();
}

function getDynamicTitle(item, text) {
  const dynamic = item?.modules?.module_dynamic || {};
  const major = dynamic.major || {};
  return (
    major.archive?.title ||
    major.article?.title ||
    major.opus?.title ||
    textSnippet(text, `动态 ${item.id_str || item.id || ''}`)
  );
}

export function extractDynamicRecords(items, uid) {
  const objects = [];
  const authoredPosts = [];

  for (const item of items || []) {
    const dynamicId = String(item.id_str || item.id || '');
    const commentType = Number(item.basic?.comment_type || 0);
    const commentOid = String(item.basic?.comment_id_str || item.basic?.comment_id || '');
    const text = getDynamicText(item);
    const title = getDynamicTitle(item, text);
    const sourceUrl = dynamicId ? `https://t.bilibili.com/${dynamicId}` : `https://space.bilibili.com/${uid}/dynamic`;

    if (text) {
      authoredPosts.push({
        sourceKind: 'dynamic-post',
        oid: commentOid || dynamicId,
        replyType: commentType || 17,
        sourceTitle: title,
        sourceUrl,
        rpid: `dynamic-${dynamicId || commentOid}`,
        like: 0,
        ctime: Number(item.modules?.module_author?.pub_ts || 0),
        uname: item.modules?.module_author?.name || '',
        mid: String(uid),
        message: text,
      });
    }

    if (commentType > 0 && commentOid) {
      objects.push({
        id: `dynamic-${commentType}-${commentOid}`,
        kind: 'dynamic',
        oid: commentOid,
        replyType: commentType,
        title: `动态：${textSnippet(title, commentOid)}`,
        authorMid: String(uid),
        sourceUrl,
        replyCount: Number(item.modules?.module_stat?.comment?.count || 0),
      });
    }
  }

  return { objects, authoredPosts };
}

export async function discoverDynamicsByUid(uid, limit, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const pageLimit = Math.max(1, Math.ceil(limit / 12));
  let offset = '';
  const objects = [];
  const authoredPosts = [];

  for (let page = 0; page < pageLimit && objects.length < limit; page += 1) {
    const url = new URL('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space');
    url.searchParams.set('host_mid', uid);
    url.searchParams.set('features', 'itemOpusStyle,listOnlyfans,opusBigCover,onlyfansVote,decorationCard');
    if (offset) url.searchParams.set('offset', offset);

    const data = await requestJson(url.toString(), `https://space.bilibili.com/${uid}/dynamic`);
    if (data.code !== 0) throw new Error(data.message || `dynamic discovery failed with code ${data.code}`);
    const records = extractDynamicRecords(data.data?.items || [], uid);
    objects.push(...records.objects);
    authoredPosts.push(...records.authoredPosts);
    if (!data.data?.has_more || !data.data?.offset) break;
    offset = data.data.offset;
    await humanPause(700, 1700);
  }

  return {
    objects: objects.slice(0, limit),
    authoredPosts: authoredPosts.slice(0, limit),
  };
}

export function collectReplyForUid(reply, targetUid, object, bucket) {
  if (!reply?.content || !reply?.member) return;
  const mid = String(reply.mid || reply.member.mid || '');
  if (mid === String(targetUid)) {
    bucket.push({
      sourceKind: object.kind,
      bvid: object.bvid,
      oid: String(object.oid || ''),
      replyType: Number(object.replyType || 1),
      sourceTitle: object.title || '',
      sourceUrl: object.sourceUrl || '',
      rpid: String(reply.rpid || ''),
      like: Number(reply.like || 0),
      ctime: Number(reply.ctime || 0),
      uname: reply.member.uname || '',
      mid,
      message: reply.content.message || '',
    });
  }
  for (const child of reply.replies || []) {
    collectReplyForUid(child, targetUid, object, bucket);
  }
}

export async function fetchRepliesForObject(object, uid, pages, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const found = [];
  let next = 0;
  const pageCount = Math.max(1, pages);
  for (let index = 0; index < pageCount; index += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/main?type=${encodeURIComponent(object.replyType || 1)}&oid=${encodeURIComponent(object.oid)}&mode=3&next=${next}&ps=20`;
    let data = await requestJson(url, object.sourceUrl || 'https://www.bilibili.com');
    if (data.code !== 0) {
      const legacyUrl = `https://api.bilibili.com/x/v2/reply?type=${encodeURIComponent(object.replyType || 1)}&oid=${encodeURIComponent(object.oid)}&pn=${index + 1}&ps=20&sort=2`;
      data = await requestJson(legacyUrl, object.sourceUrl || 'https://www.bilibili.com');
      if (data.code !== 0) break;
      for (const reply of data.data?.replies || []) {
        collectReplyForUid(reply, uid, object, found);
      }
      const page = data.data?.page;
      if (!page || index + 1 >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
      await humanPause(600, 1600);
      continue;
    }
    for (const reply of data.data?.replies || []) {
      collectReplyForUid(reply, uid, object, found);
    }
    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end || cursor.next == null) break;
    next = cursor.next;
    await humanPause(600, 1600);
  }
  return found;
}

function collectPublicReply(reply, object, bucket) {
  if (!reply?.content || !reply?.member) return;
  bucket.push({
    sourceKind: object.kind,
    bvid: object.bvid,
    oid: String(object.oid || ''),
    replyType: Number(object.replyType || 1),
    sourceTitle: object.title || '',
    sourceUrl: object.sourceUrl || '',
    rpid: String(reply.rpid || ''),
    like: Number(reply.like || 0),
    ctime: Number(reply.ctime || 0),
    uname: reply.member.uname || '',
    mid: String(reply.mid || reply.member.mid || ''),
    message: reply.content.message || '',
  });
  for (const child of reply.replies || []) {
    collectPublicReply(child, object, bucket);
  }
}

function decodeXmlText(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16) || 0));
}

export function parseDanmakuXml(xml, video) {
  const items = [];
  const text = String(xml || '');
  const pattern = /<d\b[^>]*p="([^"]*)"[^>]*>([\s\S]*?)<\/d>/gi;
  let match;
  let index = 0;
  while ((match = pattern.exec(text))) {
    const message = decodeXmlText(match[2]).replace(/\s+/g, ' ').trim();
    if (!message) continue;
    const meta = String(match[1] || '').split(',');
    items.push({
      bvid: video.bvid,
      oid: String(video.oid || ''),
      replyType: Number(video.replyType || 1),
      sourceTitle: video.title || '',
      sourceUrl: video.sourceUrl || '',
      rpid: `danmaku-${video.cid || video.oid || video.bvid}-${index}`,
      like: 0,
      ctime: Number(meta[4] || 0),
      uname: '',
      mid: String(meta[6] || ''),
      message,
      kind: 'danmaku',
    });
    index += 1;
  }
  return items;
}

async function fetchDanmakuForVideo(video, deps = {}) {
  const cid = String(video?.cid || '').trim();
  if (!cid) return [];
  const requestText = deps.fetchText || fetchText;
  const xml = await requestText(`https://api.bilibili.com/x/v1/dm/list.so?oid=${encodeURIComponent(cid)}`, video.sourceUrl);
  return parseDanmakuXml(xml, video);
}

function replySubtreeMatches(reply, deepenMatch) {
  if (deepenMatch(reply?.content?.message || '')) return true;
  for (const child of reply?.replies || []) {
    if (replySubtreeMatches(child, deepenMatch)) return true;
  }
  return false;
}

// Reply-tree deepening: a comment that uses a rare term is often answered by replies
// that quote/echo the same term, so drilling the full sub-thread of a term-bearing
// root comment is the fastest way to reach the 3-evidence target for that term —
// far more reliable than hoping three separate videos each surface it verbatim.
export async function fetchReplyThread(video, rootRpid, options = {}, deps = {}) {
  const root = String(rootRpid || '').trim();
  if (!root) return [];
  const requestJson = deps.fetchJson || fetchJson;
  const pages = Math.max(1, Math.min(Number(options.pages || 2), 5));
  const collected = [];
  for (let pn = 1; pn <= pages; pn += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/reply?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&root=${encodeURIComponent(root)}&pn=${pn}&ps=20`;
    let data;
    try {
      data = await requestJson(url, video.sourceUrl);
    } catch {
      break;
    }
    if (!data || data.code !== 0) break;
    for (const reply of data.data?.replies || []) {
      collectPublicReply(reply, video, collected);
    }
    const page = data.data?.page;
    if (!page || pn >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
    await humanPause(600, 1600);
  }
  return collected;
}

export async function fetchRepliesForVideo(input, options = {}, deps = {}) {
  const bvid = extractBvid(input);
  if (!bvid) {
    return { ok: false, error: 'Video link must contain a valid BV id.' };
  }

  const requestJson = deps.fetchJson || fetchJson;
  const pages = Math.max(1, Math.min(Number(options.pages || 2), 5));
  const video = await resolveBvid(bvid, deps);
  const comments = [];
  const deepenMatch = typeof options.deepenMatch === 'function' ? options.deepenMatch : null;
  const deepenRootLimit = deepenMatch ? Math.max(0, Math.min(Number(options.deepenRootLimit ?? 6), 30)) : 0;
  const deepenPages = Math.max(1, Math.min(Number(options.deepenPages ?? 2), 5));
  const deepenRoots = new Set();
  const queueDeepenRoot = (reply) => {
    if (!deepenMatch || deepenRoots.size >= deepenRootLimit) return;
    const rpid = String(reply?.rpid || '').trim();
    if (!rpid || deepenRoots.has(rpid)) return;
    const shown = Array.isArray(reply?.replies) ? reply.replies.length : 0;
    const total = Number(reply?.rcount || 0);
    if (total > shown && replySubtreeMatches(reply, deepenMatch)) deepenRoots.add(rpid);
  };
  let next = 0;
  for (let index = 0; index < pages; index += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/main?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&mode=3&next=${next}&ps=20`;
    let data = await requestJson(url, video.sourceUrl);
    if (data.code !== 0) {
      const legacyUrl = `https://api.bilibili.com/x/v2/reply?type=${encodeURIComponent(video.replyType || 1)}&oid=${encodeURIComponent(video.oid)}&pn=${index + 1}&ps=20&sort=2`;
      data = await requestJson(legacyUrl, video.sourceUrl);
      if (data.code !== 0) break;
      for (const reply of data.data?.replies || []) {
        collectPublicReply(reply, video, comments);
        queueDeepenRoot(reply);
      }
      const page = data.data?.page;
      if (!page || index + 1 >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
      await humanPause(600, 1600);
      continue;
    }
    for (const reply of data.data?.replies || []) {
      collectPublicReply(reply, video, comments);
      queueDeepenRoot(reply);
    }
    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end || cursor.next == null) break;
    next = cursor.next;
    await humanPause(600, 1600);
  }

  if (deepenMatch && deepenRoots.size > 0) {
    for (const rootRpid of deepenRoots) {
      try {
        comments.push(...(await fetchReplyThread(video, rootRpid, { pages: deepenPages }, deps)));
      } catch {
        // Thread deepening is supplemental; keep the base comment scan usable on failure.
      }
      await humanPause(600, 1600);
    }
  }

  if (options.includeDanmaku === true) {
    try {
      comments.push(...(await fetchDanmakuForVideo(video, deps)));
    } catch {
      // Danmaku is supplemental; keep comment crawling usable when the XML endpoint blocks.
    }
  }

  const uniqueComments = uniqueByRpid(comments);
  return {
    ok: true,
    video,
    comments: uniqueComments,
    commentText: uniqueComments.map((comment) => comment.message).filter(Boolean).join('\n'),
    source: 'Bilibili public video comment scan',
    confidenceHint:
      uniqueComments.length >= 80 ? 'large video comment sample' : uniqueComments.length >= 20 ? 'medium video comment sample' : 'small video comment sample',
  };
}

export function dedupePublicObjects(objects) {
  const seen = new Set();
  const unique = [];
  for (const object of objects || []) {
    const key = `${Number(object.replyType || 1)}:${String(object.oid || '')}`;
    if (!object.oid || seen.has(key)) continue;
    seen.add(key);
    unique.push({
      ...object,
      oid: String(object.oid),
      replyType: Number(object.replyType || 1),
    });
  }
  return unique;
}

function uniqueByRpid(items) {
  return [...new Map(items.filter((item) => item.rpid).map((item) => [item.rpid, item])).values()];
}

export async function analyzeUid(payload, deps = {}) {
  deps = depsWithBilibiliCookie(deps, payload.bilibiliCookie || payload.bilibiliCookieHeader || payload.cookie);
  const uid = String(payload.uid || '').trim();
  if (!/^\d+$/.test(uid)) {
    return { ok: false, error: 'UID must be a numeric Bilibili mid.' };
  }

  const objectLimit = Math.max(1, Math.min(Number(payload.objectLimit || payload.videoLimit || 8), 12));
  const dynamicLimit = Math.max(0, Math.min(Number(payload.dynamicLimit ?? 8), 12));
  const pagesPerObject = Math.max(1, Math.min(Number(payload.pagesPerObject || payload.pagesPerVideo || 2), 5));
  const warnings = [];
  const discoveredObjects = [];
  const authoredPosts = [];
  let user = { mid: uid, name: `UID ${uid}`, sign: '' };

  try {
    user = await fetchUserCard(uid, deps);
  } catch (error) {
    warnings.push(`profile: ${error.message}`);
  }

  await humanPause(800, 2000);

  try {
    discoveredObjects.push(...(await discoverVideosByUid(uid, objectLimit, deps)));
  } catch (error) {
    warnings.push(`uploads: ${error.message}`);
  }

  if (dynamicLimit > 0) {
    await humanPause(900, 2100);
    try {
      const dynamicRecords = await discoverDynamicsByUid(uid, dynamicLimit, deps);
      discoveredObjects.push(...dynamicRecords.objects);
      authoredPosts.push(...dynamicRecords.authoredPosts);
    } catch (error) {
      warnings.push(`dynamics: ${error.message}`);
    }
  }

  const bvidPool = parseBvidPool(payload.bvidPool);
  for (const bvid of bvidPool.slice(0, objectLimit)) {
    try {
      discoveredObjects.push(await resolveBvid(bvid, deps));
      await humanPause(900, 2200);
    } catch (error) {
      warnings.push(`${bvid}: ${error.message}`);
    }
  }

  const objects = dedupePublicObjects(discoveredObjects).slice(0, objectLimit + bvidPool.length);
  if (objects.length === 0 && authoredPosts.length === 0) {
    return {
      ok: false,
      error: 'No public Bilibili objects were discoverable for this UID.',
      details: warnings.join('; '),
      warnings,
      needsPublicObjects: true,
    };
  }

  const comments = [];
  for (let i = 0; i < objects.length; i += 1) {
    const object = objects[i];
    try {
      comments.push(...(await fetchRepliesForObject(object, uid, pagesPerObject, deps)));
    } catch (error) {
      warnings.push(`${object.title || object.oid}: ${error.message}`);
    }
    if (i < objects.length - 1) {
      await humanPause(1400, 3600);
    }
  }

  const uniqueComments = uniqueByRpid(comments);
  const uniquePosts = uniqueByRpid(authoredPosts);
  const statements = [...uniquePosts, ...uniqueComments];
  return {
    ok: true,
    uid,
    uname: uniqueComments.find((comment) => comment.uname)?.uname || user.name,
    user,
    objects,
    videos: objects.filter((object) => object.kind === 'video'),
    dynamics: objects.filter((object) => object.kind === 'dynamic'),
    authoredPosts: uniquePosts,
    comments: uniqueComments,
    statements,
    commentText: statements.map((item) => item.message).filter(Boolean).join('\n'),
    source: 'Bilibili public UID object scan',
    warnings,
    confidenceHint:
      statements.length >= 12 ? 'sample sufficient' : statements.length >= 5 ? 'low-medium confidence' : 'sample insufficient',
  };
}
