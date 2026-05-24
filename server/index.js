import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { URL } from 'node:url';

import { analyzeUid } from './bilibiliCrawler.js';
import { getDeepSeekConfig, readKeywordDictionary, trainKeywordDictionary } from './deepseekKeywordTrainer.js';
import { searchVideoKeywords } from './videoKeywordSearch.js';

const PORT = Number(process.env.PORT || 8787);
const VITE_PORT = Number(process.env.VITE_PORT || 5191);

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

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return writeJson(response, 204, {});
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === '/api/health') {
    return writeJson(response, 200, { ok: true });
  }

  if (url.pathname === '/api/deepseek/config') {
    return writeJson(response, 200, await getDeepSeekConfig());
  }

  if (url.pathname === '/api/deepseek/dictionary') {
    return writeJson(response, 200, { ok: true, dictionary: await readKeywordDictionary() });
  }

  if (url.pathname === '/api/deepseek/train-keywords' && request.method === 'POST') {
    try {
      const payload = JSON.parse((await readBody(request)) || '{}');
      return writeJson(response, 200, await trainKeywordDictionary(payload));
    } catch (error) {
      return writeJson(response, 500, { ok: false, error: error.message });
    }
  }

  if (url.pathname === '/api/bilibili/analyze-uid' && request.method === 'POST') {
    try {
      const payload = JSON.parse((await readBody(request)) || '{}');
      return writeJson(response, 200, await analyzeUid(payload));
    } catch (error) {
      return writeJson(response, 500, { ok: false, error: error.message });
    }
  }

  if (url.pathname === '/api/bilibili/video-keywords' && request.method === 'POST') {
    try {
      const payload = JSON.parse((await readBody(request)) || '{}');
      return writeJson(response, 200, await searchVideoKeywords(payload));
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
