import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acquireFileLock, withFileLock } from './fileLock.js';

test('acquireFileLock prevents concurrent holders for the same path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-file-lock-'));
  const lockPath = join(dir, 'harvest.lock');
  try {
    const release = await acquireFileLock(lockPath, { staleMs: 60_000 });
    await assert.rejects(
      () => acquireFileLock(lockPath, { staleMs: 60_000 }),
      /Another Bilibili dictionary job is already running/,
    );
    await release();
    const secondRelease = await acquireFileLock(lockPath, { staleMs: 60_000 });
    await secondRelease();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('withFileLock releases the lock after the protected job finishes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bili-file-lock-release-'));
  const lockPath = join(dir, 'harvest.lock');
  try {
    const value = await withFileLock(lockPath, () => 'done', { staleMs: 60_000 });
    assert.equal(value, 'done');
    const release = await acquireFileLock(lockPath, { staleMs: 60_000 });
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
