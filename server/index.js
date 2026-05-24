import { createServer } from 'node:http';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT || 8787);
const VITE_PORT = Number(process.env.VITE_PORT || 5191);
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, referer = 'https://www.bilibili.com') {
  const response = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      referer,
      accept: 'application/json,text/plain,*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }
  return response.json();
}

async function resolveBvid(bvid) {
  const data = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
  if (data.code !== 0) throw new Error(data.message || `Cannot resolve ${bvid}`);
  return {
    bvid,
    aid: data.data.aid,
    title: data.data.title,
    owner: data.data.owner?.name || '',
    replyCount: data.data.stat?.reply || 0,
  };
}

async function discoverVideosByUid(uid, limit) {
  const url = `https://api.bilibili.com/x/space/arc/search?mid=${encodeURIComponent(uid)}&pn=1&ps=${limit}&order=pubdate`;
  const data = await fetchJson(url, `https://space.bilibili.com/${uid}`);
  if (data.code !== 0) {
    throw new Error(data.message || `space video discovery failed with code ${data.code}`);
  }
  const list = data.data?.list?.vlist || [];
  return list.slice(0, limit).map((item) => ({
    bvid: item.bvid,
    aid: item.aid,
    title: item.title,
    owner: item.author || '',
    replyCount: item.comment || 0,
  }));
}

function collectReply(reply, targetUid, video, bucket) {
  if (!reply?.content || !reply?.member) return;
  const mid = String(reply.mid || reply.member.mid || '');
  if (mid === String(targetUid)) {
    bucket.push({
      bvid: video.bvid,
      aid: video.aid,
      videoTitle: video.title,
      rpid: String(reply.rpid || ''),
      like: Number(reply.like || 0),
      ctime: Number(reply.ctime || 0),
      uname: reply.member.uname || '',
      mid,
      message: reply.content.message || '',
    });
  }
  for (const child of reply.replies || []) {
    collectReply(child, targetUid, video, bucket);
  }
}

async function fetchCommentsForUid(video, uid, pages) {
  const found = [];
  let next = 0;
  for (let index = 0; index < pages; index += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${video.aid}&mode=3&next=${next}&ps=20`;
    const data = await fetchJson(url, `https://www.bilibili.com/video/${video.bvid}/`);
    if (data.code !== 0) break;
    for (const reply of data.data?.replies || []) {
      collectReply(reply, uid, video, found);
    }
    const cursor = data.data?.cursor;
    if (!cursor || cursor.is_end || cursor.next == null) break;
    next = cursor.next;
    await wait(240);
  }
  return found;
}

function parseBvidPool(raw) {
  return String(raw || '')
    .split(/[\s,，]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => /^BV[0-9A-Za-z]+$/.test(item));
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  response.end(JSON.stringify(payload));
}

async function analyzeUid(payload) {
  const uid = String(payload.uid || '').trim();
  if (!/^\d+$/.test(uid)) {
    return { ok: false, error: 'UID must be a numeric Bilibili mid.' };
  }

  const limit = Math.max(1, Math.min(Number(payload.videoLimit || 5), 12));
  const pagesPerVideo = Math.max(1, Math.min(Number(payload.pagesPerVideo || 3), 8));
  const warnings = [];
  let videos = [];

  const bvidPool = parseBvidPool(payload.bvidPool);
  if (bvidPool.length > 0) {
    for (const bvid of bvidPool.slice(0, limit)) {
      try {
        videos.push(await resolveBvid(bvid));
        await wait(180);
      } catch (error) {
        warnings.push(`${bvid}: ${error.message}`);
      }
    }
  } else {
    try {
      videos = await discoverVideosByUid(uid, limit);
    } catch (error) {
      return {
        ok: false,
        error: 'Bilibili space video discovery is blocked or unavailable. Provide a BV pool as public-object input.',
        details: error.message,
        needsBvidPool: true,
      };
    }
  }

  const comments = [];
  for (const video of videos) {
    try {
      comments.push(...(await fetchCommentsForUid(video, uid, pagesPerVideo)));
    } catch (error) {
      warnings.push(`${video.bvid}: ${error.message}`);
    }
  }

  const unique = [...new Map(comments.map((comment) => [comment.rpid, comment])).values()];
  const uname = unique.find((comment) => comment.uname)?.uname || `UID ${uid}`;
  return {
    ok: true,
    uid,
    uname,
    videos,
    comments: unique,
    commentText: unique.map((comment) => comment.message).join('\n'),
    source: bvidPool.length > 0 ? 'BV pool public comment filter' : 'UID public-upload comment filter',
    warnings,
    confidenceHint: unique.length >= 8 ? 'sample sufficient' : unique.length >= 3 ? 'low-medium confidence' : 'sample insufficient',
  };
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return writeJson(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/api/health') {
    return writeJson(response, 200, { ok: true });
  }

  if (url.pathname === '/api/bilibili/analyze-uid' && request.method === 'POST') {
    try {
      const payload = JSON.parse((await readBody(request)) || '{}');
      return writeJson(response, 200, await analyzeUid(payload));
    } catch (error) {
      return writeJson(response, 500, { ok: false, error: error.message });
    }
  }

  return writeJson(response, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`API server listening on http://127.0.0.1:${PORT}`);
});

if (process.env.START_VITE !== '0') {
  const vite = spawn('npm', ['run', 'dev', '--', '--port', String(VITE_PORT)], {
    shell: true,
    stdio: 'inherit',
  });
  process.on('exit', () => vite.kill());
}
