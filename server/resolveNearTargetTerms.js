import { readKeywordDictionary } from './deepseekKeywordTrainer.js';
import { buildDictionaryCoverageAudit, readKeywordHarvestState } from './keywordHarvest.js';
import { searchVideoKeywords } from './videoKeywordSearch.js';

// Targeted resolver: a term that is one or two evidences short already appeared in
// specific videos. Re-scanning those exact videos with reply-tree deepening is the
// highest-yield way to reach the 3-evidence target, since the term is known to occur
// there. Processes a batch of near-target terms per run (bounded for sandbox limits).

const targetEvidence = 3;
const maxNeed = Math.max(1, Number(process.env.RESOLVE_MAX_NEED || 1));
const batch = Math.max(1, Number(process.env.RESOLVE_BATCH || 12));
const videosPerTerm = Math.max(1, Number(process.env.RESOLVE_VIDEOS_PER_TERM || 3));
const pages = Math.max(1, Number(process.env.RESOLVE_PAGES || 3));

const bvidRe = /(BV[0-9A-Za-z]{8,})/g;
const dict = await readKeywordDictionary();
const state = await readKeywordHarvestState();
const audit = buildDictionaryCoverageAudit(dict, state, {
  targetEvidence,
  maxActions: 5000,
  requireSourceBackedEvidence: true,
  requireCommentBackedEvidence: true,
  minCoverageRatio: 1,
  requireComplete: true,
});
const byTerm = new Map((dict.entries || []).map((e) => [String(e.term || ''), e]));
const targets = (audit.nextActions || [])
  .filter((a) => a.evidenceNeeded >= 1 && a.evidenceNeeded <= maxNeed)
  .map((a) => String(a.term || ''))
  .filter((t) => byTerm.has(t));

const poolNeedles = targets.slice(0, 200);
let processed = 0;
let scanned = 0;
const startTerms = targets.slice(0, batch);
console.log(`Near-target resolver: ${targets.length} candidate terms (need<=${maxNeed}); processing ${startTerms.length}`);

for (const term of startTerms) {
  const entry = byTerm.get(term);
  const txt = JSON.stringify(entry.evidenceSources || []);
  const bvids = [...new Set([...txt.matchAll(bvidRe)].map((m) => m[1]))].slice(0, videosPerTerm);
  if (bvids.length === 0) {
    console.log(`  [skip] ${term}: no source BVIDs`);
    continue;
  }
  try {
    const result = await searchVideoKeywords({
      videoLinks: bvids,
      pages,
      existingTermsOnly: true,
      preFilterCommentsToTargets: true,
      deepenReplyThreads: true,
      deepenRootLimit: 10,
      deepenPages: 3,
      includeDanmaku: true,
      expandTargetsFromComments: true,
      targetExistingTerms: [term, ...poolNeedles],
    });
    const d = result.collectionDiagnostics || {};
    const accepted = Array.isArray(d.acceptedTerms) ? d.acceptedTerms.length : 0;
    scanned += bvids.length;
    processed += 1;
    console.log(`  [${processed}/${startTerms.length}] ${term}: videos=${bvids.length} comments=${d.commentsCollected || 0} accepted=${accepted}`);
  } catch (error) {
    console.log(`  [err] ${term}: ${error.message}`);
  }
}
console.log(`Done. processed=${processed} videos-scanned=${scanned}`);
