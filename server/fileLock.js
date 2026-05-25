import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function isProcessAlive(pid) {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(`${lockPath}/owner.json`, 'utf8'));
  } catch {
    return null;
  }
}

async function removeStaleLock(lockPath, owner, staleMs) {
  const startedAt = Date.parse(owner?.startedAt || '');
  const staleByAge = Number.isFinite(startedAt) && Date.now() - startedAt > staleMs;
  const staleByPid = owner?.pid && !isProcessAlive(owner.pid);
  if (!staleByAge && !staleByPid) return false;
  await rm(lockPath, { recursive: true, force: true });
  return true;
}

export async function acquireFileLock(lockPath, options = {}) {
  const staleMs = Number(options.staleMs) > 0 ? Number(options.staleMs) : 6 * 60 * 60 * 1000;
  await mkdir(dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(lockPath);
      const owner = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        command: process.argv.join(' '),
      };
      await writeFile(`${lockPath}/owner.json`, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
      return async () => {
        await rm(lockPath, { recursive: true, force: true });
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const owner = await readLockOwner(lockPath);
      if (attempt === 0 && (await removeStaleLock(lockPath, owner, staleMs))) continue;
      const details = owner?.pid ? ` pid ${owner.pid}, started ${owner.startedAt || 'unknown time'}` : '';
      throw new Error(`Another Bilibili dictionary job is already running${details}. Remove ${lockPath} only if that job is no longer active.`);
    }
  }

  throw new Error(`Could not acquire lock ${lockPath}`);
}

export async function withFileLock(lockPath, task, options = {}) {
  const release = await acquireFileLock(lockPath, options);
  try {
    return await task();
  } finally {
    await release();
  }
}
