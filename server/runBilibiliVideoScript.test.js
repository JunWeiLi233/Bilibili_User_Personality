import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runScript(args = [], script = '.\\run-bilibili-video.ps1') {
  const tempDir = mkdtempSync(join(tmpdir(), 'bilibili-video-script-'));
  try {
    writeFileSync(
      join(tempDir, 'node.cmd'),
      [
        '@echo off',
        'echo REQUIRE_COMMENTS=%BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS%',
        'echo RETRY_BEFORE_UNATTEMPTED=%BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT%',
        'echo BLOCK_COOLDOWN=%BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS%',
        'echo REQUEST_TIMEOUT=%BILIBILI_CRAWLER_REQUEST_TIMEOUT_MS%',
        'echo MIN_DELAY=%BILIBILI_CRAWLER_MIN_DELAY_MS%',
        'echo JITTER=%BILIBILI_CRAWLER_JITTER_MS%',
        'echo HARVEST_QUERY_TIMEOUT=%BILIBILI_HARVEST_QUERY_TIMEOUT_MS%',
        'echo EXPAND_TARGETS=%BILIBILI_HARVEST_EXPAND_TARGETS_FROM_COMMENTS%',
      ].join('\r\n'),
    );
    const result = spawnSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
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

test('run-bilibili-video.ps1 caps crawler block cooldown for quick strict comment harvests', (t) => {
  const result = runScript(['-RequireCommentEvidence', '-ExistingTermsOnly', '-QueryTimeoutMs', '25000']);
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /BLOCK_COOLDOWN=2500/);
  assert.match(result.stdout, /REQUEST_TIMEOUT=12500/);
});

test('run-bilibili-video.ps1 uses fast crawler pacing for strict comment harvests', (t) => {
  const result = runScript(['-RequireCommentEvidence', '-ExistingTermsOnly', '-QueryTimeoutMs', '25000']);
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /MIN_DELAY=250/);
  assert.match(result.stdout, /JITTER=125/);
});

test('run-bilibili-auto-coverage.ps1 forwards per-query timeout seconds', (t) => {
  const result = runScript(['-MaxCycles', '1', '-MaxQueries', '1', '-QueryTimeoutSeconds', '45'], '.\\run-bilibili-auto-coverage.ps1');
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HARVEST_QUERY_TIMEOUT=45000/);
  assert.match(result.stdout, /Per-query timeout: 45s/);
});

test('run-bilibili-auto-coverage.ps1 caps crawler pacing from timeout seconds', (t) => {
  const result = runScript(['-MaxCycles', '1', '-MaxQueries', '1', '-QueryTimeoutSeconds', '20'], '.\\run-bilibili-auto-coverage.ps1');
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HARVEST_QUERY_TIMEOUT=20000/);
  assert.match(result.stdout, /BLOCK_COOLDOWN=2000/);
  assert.match(result.stdout, /REQUEST_TIMEOUT=10000/);
  assert.match(result.stdout, /MIN_DELAY=200/);
  assert.match(result.stdout, /JITTER=100/);
});

test('run-bilibili-auto-coverage.ps1 expands weak targets from collected comments by default', (t) => {
  const result = runScript(['-MaxCycles', '1', '-MaxQueries', '1'], '.\\run-bilibili-auto-coverage.ps1');
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EXPAND_TARGETS=1/);
  assert.match(result.stdout, /Expand weak targets from collected comments: True/);
});

test('run-bilibili-auto-coverage.ps1 can disable comment target expansion', (t) => {
  const result = runScript(['-MaxCycles', '1', '-MaxQueries', '1', '-NoCommentTargetExpansion'], '.\\run-bilibili-auto-coverage.ps1');
  if (!result) {
    t.skip('PowerShell is unavailable in this environment');
    return;
  }

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /EXPAND_TARGETS=/);
  assert.match(result.stdout, /Expand weak targets from collected comments: False/);
});
