function parseCliArgs(argv = []) {
  const flags = new Map();
  const args = Array.isArray(argv) ? argv : [];
  for (let index = 0; index < args.length; index += 1) {
    const raw = String(args[index] || '').trim();
    if (!raw.startsWith('--')) continue;
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf('=');
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    const next = String(args[index + 1] || '').trim();
    if (next && !next.startsWith('--')) {
      flags.set(withoutPrefix, next);
      index += 1;
    } else {
      flags.set(withoutPrefix, '1');
    }
  }
  return flags;
}

function positiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(Math.floor(number), max) : fallback;
}

function nonNegativeInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.min(Math.floor(number), max) : fallback;
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function flagValue(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function optionValue(flags, env, cliName, envName, fallback) {
  if (flags.has(cliName)) return flags.get(cliName);
  return env[envName] ?? fallback;
}

export function buildCoverageRuntimeOptions({ argv = process.argv.slice(2), env = process.env, maxActionsFallback = 20 } = {}) {
  const flags = parseCliArgs(argv);
  const requireCommentBackedEvidence =
    flagValue(flags.get('strict-comment-backed'), false) ||
    flagValue(flags.get('require-comments'), false) ||
    env.BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS === '1';
  const requireSourceBackedEvidence =
    requireCommentBackedEvidence ||
    flagValue(flags.get('require-sources'), false) ||
    env.BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES === '1' ||
    env.BILIBILI_HARVEST_REQUIRE_SOURCES === '1';

  return {
    targetEvidence: positiveInt(optionValue(flags, env, 'target-evidence', 'BILIBILI_HARVEST_TARGET_EVIDENCE', 3), 3, 1000),
    maxActions: positiveInt(optionValue(flags, env, 'max-actions', 'BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS', maxActionsFallback), maxActionsFallback, 1000),
    minCoverageRatio: numberValue(optionValue(flags, env, 'min-ratio', 'BILIBILI_COVERAGE_AUDIT_MIN_RATIO', 1), 1),
    requireComplete: flags.has('no-require-complete') ? false : env.BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE !== '0',
    requireSourceBackedEvidence,
    requireCommentBackedEvidence,
    prioritizeSourceGaps: requireCommentBackedEvidence,
    retryBeforeUnattemptedLimit: nonNegativeInt(
      optionValue(flags, env, 'retry-before-unattempted', 'BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT', 3),
      3,
      20,
    ),
    strict: flagValue(flags.get('strict'), false) || env.BILIBILI_COVERAGE_AUDIT_STRICT === '1' || env.BILIBILI_COVERAGE_LOOP_STRICT === '1',
  };
}
