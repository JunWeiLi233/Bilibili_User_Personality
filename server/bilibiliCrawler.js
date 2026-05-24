const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const BLOCK_CODES = new Set([-352, -412, -509, -799]);
const responseCache = new Map();
let nextRequestAt = 0;
let cooldownUntil = 0;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readCrawlerConfig(env = process.env) {
  return {
    minDelayMs: Math.max(0, Number(env.BILIBILI_CRAWLER_MIN_DELAY_MS || 900)),
    jitterMs: Math.max(0, Number(env.BILIBILI_CRAWLER_JITTER_MS || 700)),
    blockCooldownMs: Math.max(0, Number(env.BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS || 45000)),
    cacheTtlMs: Math.max(0, Number(env.BILIBILI_CRAWLER_CACHE_TTL_MS || 120000)),
  };
}

export function isBilibiliBlockResponse(payload) {
  return BLOCK_CODES.has(Number(payload?.code));
}

export function resetBilibiliRequestState() {
  responseCache.clear();
  nextRequestAt = 0;
  cooldownUntil = 0;
}

function cacheKey(url, referer) {
  return `${referer || ''} ${String(url)}`;
}

async function scheduleBilibiliRequest(options = {}) {
  const config = { ...readCrawlerConfig(options.env), ...(options.config || {}) };
  const nowFn = options.nowFn || Date.now;
  const waitFn = options.waitFn || wait;
  const randomFn = options.randomFn || Math.random;
  const now = nowFn();
  const waitUntil = Math.max(cooldownUntil, nextRequestAt);
  if (waitUntil > now) {
    await waitFn(waitUntil - now);
  }
  const jitter = Math.floor(randomFn() * config.jitterMs);
  nextRequestAt = nowFn() + config.minDelayMs + jitter;
  return config;
}

export async function fetchJson(url, referer = 'https://www.bilibili.com', options = {}) {
  const config = { ...readCrawlerConfig(options.env), ...(options.config || {}) };
  const key = cacheKey(url, referer);
  const nowFn = options.nowFn || Date.now;
  const cached = responseCache.get(key);
  if (cached && config.cacheTtlMs > 0 && cached.expiresAt > nowFn()) {
    return cached.payload;
  }

  await scheduleBilibiliRequest({ ...options, config });
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': USER_AGENT,
      referer,
      accept: 'application/json,text/plain,*/*',
    },
  });
  if (!response.ok) {
    if ([403, 429, 503].includes(Number(response.status))) {
      cooldownUntil = nowFn() + config.blockCooldownMs;
    }
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  const payload = await response.json();
  if (isBilibiliBlockResponse(payload)) {
    cooldownUntil = nowFn() + config.blockCooldownMs;
  } else if (payload?.code === 0 && config.cacheTtlMs > 0) {
    responseCache.set(key, {
      expiresAt: nowFn() + config.cacheTtlMs,
      payload,
    });
  }
  return payload;
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

export async function resolveBvid(bvid, deps = {}) {
  const requestJson = deps.fetchJson || fetchJson;
  const data = await requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0) throw new Error(data.message || `Cannot resolve ${bvid}`);
  return videoObjectFromView(bvid, data.data);
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
    await wait(180);
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
      await wait(220);
      continue;
    }
    for (const reply of data.data?.replies || []) {
      collectReplyForUid(reply, uid, object, found);
    }
    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end || cursor.next == null) break;
    next = cursor.next;
    await wait(220);
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

export async function fetchRepliesForVideo(input, options = {}, deps = {}) {
  const bvid = extractBvid(input);
  if (!bvid) {
    return { ok: false, error: 'Video link must contain a valid BV id.' };
  }

  const requestJson = deps.fetchJson || fetchJson;
  const pages = Math.max(1, Math.min(Number(options.pages || 2), 5));
  const video = await resolveBvid(bvid, deps);
  const comments = [];
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
      }
      const page = data.data?.page;
      if (!page || index + 1 >= Math.ceil(Number(page.count || 0) / Math.max(Number(page.size || 20), 1))) break;
      await wait(220);
      continue;
    }
    for (const reply of data.data?.replies || []) {
      collectPublicReply(reply, video, comments);
    }
    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end || cursor.next == null) break;
    next = cursor.next;
    await wait(220);
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

  try {
    discoveredObjects.push(...(await discoverVideosByUid(uid, objectLimit, deps)));
  } catch (error) {
    warnings.push(`uploads: ${error.message}`);
  }

  if (dynamicLimit > 0) {
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
      await wait(120);
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
  for (const object of objects) {
    try {
      comments.push(...(await fetchRepliesForObject(object, uid, pagesPerObject, deps)));
    } catch (error) {
      warnings.push(`${object.title || object.oid}: ${error.message}`);
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
