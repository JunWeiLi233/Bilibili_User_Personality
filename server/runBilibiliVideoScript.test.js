import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runScript(args = []) {
  const tempDir = mkdtempSync(join(tmpdir(), 'bilibili-video-script-'));
  try {
    writeFileSync(
      join(tempDir, 'node.cmd'),
      [
        '@echo off',
        'echo REQUIRE_COMMENTS=%BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS%',
        'echo RETRY_BEFORE_UNATTEMPTED=%BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT%',
      ].join('\r\n'),
    );
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '.\\run-bilibili-video.ps1', ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          Path: `${tempDir};${process.env.Path || ''}`,
          PATH: `${tempDir};${process.env.PATH || ''}`,
        },
        encoding: 'utf8',
      },
    );
    if (result.error?.code === 'ENOENT') return null;
    return result;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

test('run-bilibili-video.ps1 defaults strict comment harvest retries to one', (t) => {
  const result = runScript(['-RequireCommentEvidence']);
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REQUIRE_COMMENTS=1/);
  assert.match(result.stdout, /RETRY_BEFORE_UNATTEMPTED=1/);
});

test('run-bilibili-video.ps1 keeps explicit strict comment retry override', (t) => {
  const result = runScript(['-RequireCommentEvidence', '-RetryBeforeUnattemptedLimit', '4']);
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /REQUIRE_COMMENTS=1/);
  assert.match(result.stdout, /RETRY_BEFORE_UNATTEMPTED=4/);
});
