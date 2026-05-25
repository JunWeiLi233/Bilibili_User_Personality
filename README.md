# Bilibili User Personality

Research-driven prototype for evaluating whether a selected Bilibili user's public comments show a high argumentative-trolling tendency.

## What It Shows

- A radar chart tailored to adversarial-comment behavior rather than generic personality labels.
- A data-led "杠精指数" derived from six interpretable dimensions:
  - 对抗性动机
  - 认知闭合
  - 证据敏感
  - 逻辑一致
  - 合作讨论
  - 修正意愿
- Three analysis modes:
  - Hybrid mode: semantic speech-act judging with adaptive lexicon evidence.
  - Semantic judge mode: evaluates target, evidence burden, proposition response, and correction behavior.
  - Lexicon mode: transparent semantic-family matching for auditability.
- UID-based automatic sampling:
  - Reads Bilibili public profile/card data for the UID.
  - Discovers public submissions and dynamic posts from Bilibili public endpoints.
  - Scans comments around those public objects and filters interactions by `mid`.
  - Does not call AICU, third-party indexes, or external websites as a substitute for UID comment crawling.
- Video keyword search:
  - Accepts a Bilibili video URL or `BV` id in the same search box.
  - If no video link is provided, backend code searches Bilibili by configured search terms, discovers videos, scans their public comments, and trains keywords from that sample.
  - Still supports backend-owned explicit video links through `BILIBILI_DEFAULT_VIDEO_LINKS` or `BILIBILI_DEFAULT_VIDEO_LINK` when you want a fixed video set.
  - Shows the learned keywords in the UI and folds them into the local analyzer dictionary.
- DeepSeek V4 Chinese keyword training:
  - Uses the DeepSeek API for dictionary extraction, defaulting to `deepseek-v4-flash`.
  - Current config reads `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`, and `DEEPSEEK_BASE_URL`.
  - Extracts Chinese internet terms, meanings, variants, and semantic families from crawled comments.
  - Writes learned terms to `server/deepseekKeywordDictionary.json` and merges them into the local analyzer.
  - Marks dictionary hits inside analyzed comments, maps each semantic family to a radar axis, and shows the vocabulary markers under the radar chart.

## Run Locally

From PowerShell:

```powershell
cd D:\Bilibili_User_Personality
npm install
.\set-deepseek-env.ps1
npm run server
```

To run backend-owned Bilibili keyword harvesting directly:

```powershell
cd D:\Bilibili_User_Personality
.\run-bilibili-video.ps1
```

The script does not require video links. By default it uses backend `controversial` discovery: debate-heavy Bilibili search seeds such as politics/current affairs, games, social issues, fandom disputes, and tech-company disputes are searched first with a popularity-oriented Bilibili search order, then mixed with dictionary-generated queries. Generic public popular videos are not included in `controversial` mode by default, because the goal is controversial popular videos, not ordinary popular videos. Add `-IncludeGenericPopular` only when you intentionally want to mix in the public popular feed. It then scans public comments, trains the keyword dictionary, and prints a coverage/growth report.

It also persists harvest state in `server/keywordHarvestState.json` and writes the latest report to `server/keywordHarvestReport.json`. These local files are ignored by Git because they are run-specific data.

For the full dictionary coverage loop, use:

```powershell
.\run-bilibili-auto-coverage.ps1 -MaxCycles 5 -RoundsPerCycle 2 -MaxQueries 20 -DiscoveryLimit 8 -CommentPages 3
```

That command audits the current dictionary, exports the next weak-term priority queries, harvests Bilibili comments and public danmaku from controversial popular topics plus dictionary queries, then repeats until the coverage gate passes or the cycle limit is reached. It does not use the generic popular feed unless you pass `-IncludeGenericPopular`. It requires source-backed Bilibili comment evidence and refreshes existing dictionary terms only by default, so coverage work does not keep lowering the pass ratio by adding fresh terms mid-loop or treating search-result titles as completed comment evidence. Public danmaku is enabled by default in the auto-coverage script because many short meme phrases appear in弹幕 more often than replies; pass `-NoDanmaku` when you only want reply comments. Add `-AllowNewTerms` when you want the same loop to expand the dictionary, add `-AllowContextOnlyEvidence` when video title/description context is enough for your run, and add `-AllowUnsourcedEvidence` only when you want a faster but less auditable run.

To change what videos are discovered:

```powershell
.\run-bilibili-video.ps1 -ControversyQuery "时政 评论区","游戏 节奏 评论区","社会事件 评论区" -MaxQueries 20 -Rounds 3 -DiscoveryLimit 8 -CommentPages 3
```

You can also combine your own dictionary-oriented search queries with the controversy seeds:

```powershell
.\run-bilibili-video.ps1 -SearchQuery "阴阳怪气 评论区","杠精 评论区" -ControversyQuery "国际政治 评论区","原神 节奏","黑神话 争议" -DiscoveryMode controversial
```

The script defaults to `-CoverageMode all-weak`, which means weak dictionary entries are searched term by term before broad seed topics. Use `-CoverageMode balanced` when you want a smaller mixed sample across families instead of chasing every under-evidenced term.

Legacy `mixed` mode is still available when you only want dictionary/seed search plus public popular videos:

```powershell
.\run-bilibili-video.ps1 -SearchQuery "A圣 评论区","中文互联网 梗" -DiscoveryMode mixed -MaxQueries 20 -Rounds 3 -DiscoveryLimit 8 -CommentPages 3
```

If you explicitly want the old `controversial` plus generic popular feed behavior:

```powershell
.\run-bilibili-video.ps1 -IncludeGenericPopular
.\run-bilibili-auto-coverage.ps1 -IncludeGenericPopular
```

To revisit previously searched queries and videos:

```powershell
.\run-bilibili-video.ps1 -ResetHarvestState
```

You can also run the same backend task through npm:

```powershell
$env:BILIBILI_VIDEO_SEARCH_QUERIES="中文互联网 阴阳怪气`n杠精 评论区"
$env:BILIBILI_CONTROVERSY_SEARCH_QUERIES="时政 评论区`n游戏 节奏 评论区`n社会事件 评论区"
$env:BILIBILI_VIDEO_DISCOVERY_MODE="controversial"
$env:BILIBILI_HARVEST_MAX_QUERIES="12"
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY="4"
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM="2"
$env:BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES="{term} 热评`n{term} 名场面 评论区"
$env:BILIBILI_HARVEST_TARGET_EVIDENCE="3"
$env:BILIBILI_HARVEST_ROUNDS="3"
$env:BILIBILI_HARVEST_COVERAGE_MODE="all-weak"
$env:BILIBILI_HARVEST_RESET="0"
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT="6"
$env:BILIBILI_VIDEO_DISCOVERY_PAGES="1"
$env:BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT="4"
$env:BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER="click"
$env:BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR="0"
$env:BILIBILI_VIDEO_COMMENT_PAGES="2"
npm run dictionary:harvest
```

After a harvest, run a read-only coverage audit to see exactly which dictionary terms still need Bilibili evidence:

```powershell
npm run dictionary:coverage
```

The audit writes `server/keywordCoverageAudit.json`, exports recommended queries to `server/keywordCoverageQueries.txt`, and prints weak terms, exhausted terms, family gaps, source-backed evidence counts, unsourced evidence terms to refresh, next coverage actions, and recommended next queries/templates. For a local or CI gate, set `BILIBILI_COVERAGE_AUDIT_STRICT=1`; the command exits non-zero until the configured coverage target is met. Tune the gate with `BILIBILI_COVERAGE_AUDIT_MIN_RATIO`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE=0`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES=1`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS=1`, `BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS`, and `BILIBILI_HARVEST_TARGET_EVIDENCE`. `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS=1` is stricter: search-result video titles/descriptions can help discovery, but they do not satisfy the coverage gate until the term has non-context Bilibili comment evidence.

If older DeepSeek harvest runs added generic ASCII fragments such as `API`, `BUG`, `MVP`, short ids, or uploader tags, compact the local generated dictionary through the current backend normalizer:

```powershell
npm run dictionary:prune
```

To run the next audit-recommended queries first:

```powershell
.\run-bilibili-video.ps1 -PriorityQueryFile server\keywordCoverageQueries.txt -RequireEvidenceSources
```

To run a bounded audit-harvest loop without manually copying query files:

```powershell
$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES="3"
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE="1"
npm run dictionary:auto
```

The loop audits coverage, runs the recommended queries as priority harvest queries, audits again, and stops when the coverage gate passes, there are no recommended queries, or the cycle limit is reached. It writes `server/keywordCoverageLoopReport.json` with per-cycle coverage deltas for evidence deficit, zero-evidence terms, source-backed terms, total evidence, and coverage ratio.
Set `BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS=1` when you want the loop to stop early if a cycle runs queries but does not reduce the evidence deficit, clear a zero-evidence term, or add source-backed evidence.

`npm run server` starts both services:

- API backend: `http://127.0.0.1:8787`
- Vite frontend: usually `http://127.0.0.1:5191`

If `5191` is already in use, Vite prints the next available local URL, for example `http://127.0.0.1:5197/`. Open the printed Vite URL in your browser.

In the app:

- Click `后端默认视频` to run backend video discovery or the configured backend video links.
- Or paste a UID, Bilibili video URL, or `BV` id into the `B 站 UID / 视频链接` search box.
- If no explicit backend video link is configured, default video discovery uses `controversial` mode. It reads `BILIBILI_CONTROVERSY_SEARCH_QUERIES` for debate-heavy topics and `BILIBILI_VIDEO_SEARCH_QUERY` / `BILIBILI_VIDEO_SEARCH_QUERIES` for extra dictionary-oriented queries.

For DeepSeek V4 keyword training, configure an API key before starting the server:

```powershell
$env:DEEPSEEK_API_KEY="your_api_key"
```

This repo also supports a local helper file named `set-deepseek-env.ps1`. Keep that file uncommitted because it contains your private key.

Optional model and discovery configuration:

```powershell
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
$env:DEEPSEEK_REASONING_EFFORT="medium"
$env:BILIBILI_VIDEO_SEARCH_QUERIES="中文互联网 阴阳怪气`n杠精 评论区"
$env:BILIBILI_CONTROVERSY_SEARCH_QUERIES="时政 评论区`n游戏 节奏 评论区`n社会事件 评论区"
$env:BILIBILI_VIDEO_DISCOVERY_MODE="controversial"
$env:BILIBILI_HARVEST_MAX_QUERIES="12"
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY="4"
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM="2"
$env:BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES="{term} 热评`n{term} 名场面 评论区"
$env:BILIBILI_HARVEST_TARGET_EVIDENCE="3"
$env:BILIBILI_HARVEST_ROUNDS="3"
$env:BILIBILI_HARVEST_COVERAGE_MODE="all-weak"
$env:BILIBILI_HARVEST_STATE_PATH="server/keywordHarvestState.json"
$env:BILIBILI_HARVEST_REPORT_PATH="server/keywordHarvestReport.json"
$env:BILIBILI_HARVEST_SKIP_SEEN="1"
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT="6"
$env:BILIBILI_VIDEO_DISCOVERY_PAGES="1"
$env:BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT="4"
$env:BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER="click"
$env:BILIBILI_VIDEO_COMMENT_PAGES="2"
$env:DEEPSEEK_KEYWORD_DICTIONARY_PATH="server/deepseekKeywordDictionary.json"
```

`DEEPSEEK_MODEL=deepseek-v4-pro` can be used when you want the stronger V4 model for dictionary extraction.
DeepSeek's API accepts `medium` as a compatibility reasoning-effort value and maps it to its supported V4 thinking effort internally.

## Build

```bash
npm run build
```

## Notes

The automatic collector uses Bilibili public endpoints directly. It does not use AICU, third-party comment indexes, scraping libraries, or external websites to replace UID or video-comment crawling.

The crawler is intentionally conservative: requests are sequential, successful API responses are cached briefly, page limits are capped, and Bilibili block/rate-limit responses trigger a cooldown instead of rapid retries. You can tune the pacing with:

```powershell
$env:BILIBILI_CRAWLER_MIN_DELAY_MS="900"
$env:BILIBILI_CRAWLER_JITTER_MS="700"
$env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS="45000"
$env:BILIBILI_CRAWLER_CACHE_TTL_MS="120000"
```

The DeepSeek keyword trainer does not fine-tune model weights. It uses DeepSeek V4 as a dictionary extractor, then persists learned Chinese terms into the local dictionary used by the rule/semantic analyzer. If `DEEPSEEK_API_KEY` is missing or the API call fails, the app keeps running with the local rule fallback and reports that in the UI.

The dictionary harvester is iterative. Run it repeatedly with different seed queries, larger `BILIBILI_HARVEST_MAX_QUERIES` values, or `BILIBILI_HARVEST_ROUNDS` greater than `1` to expand coverage in one command. Multi-round runs stop early once every existing dictionary term reaches `BILIBILI_HARVEST_TARGET_EVIDENCE`. By default it skips queries and BV ids already recorded in the harvest state. Use `BILIBILI_HARVEST_EXISTING_TERMS_ONLY=1` or PowerShell `-ExistingTermsOnly` / the auto-loop default when the job is to add Bilibili evidence to the current dictionary without adding new DeepSeek-discovered terms. Set `BILIBILI_HARVEST_INCLUDE_DANMAKU=1` or use the auto-loop default to add public video danmaku to the same training text as comments; this helps recover short meme phrases that are common in弹幕 but sparse in replies. The state file also tracks attempts per dictionary term, including the last query, whether that query found direct evidence, and repeatedly missed terms that need different search wording. Terms that have tried every built-in query variant without direct evidence are marked exhausted and skipped by normal `all-weak` planning until you add new templates or reset the harvest state. State and report JSON are written in ASCII-safe escaped form so PowerShell and Node can parse Chinese keyword data consistently. No crawler can prove it has gathered every possible Bilibili slang term, so the practical target is continued growth with zero duplicate dictionary terms and broader family coverage.

To protect dictionary quality, model-generated keywords are accepted only when the cleaned term can be found in the crawled Bilibili comment text. Accepted entries include `evidenceCount`, `evidenceSamples`, and `evidenceSources` so each term can be audited against source comments and the Bilibili object that produced them. Terms without direct text evidence are counted as `evidenceRejected` in the harvest report and are not merged into the dictionary. Each harvest also scans the crawled comments against the existing dictionary and refreshes evidence for any already-known term that appears, even if the model does not re-output that term.

Harvest query generation prioritizes weak-evidence dictionary entries first and can generate multiple Chinese Bilibili-oriented query variants per term through `BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM`, such as `评论区 梗 热评`, `评论区`, `热评`, `弹幕`, `争议 评论区`, `是什么梗`, `什么意思`, `出处`, `名梗`, `名场面 评论区`, `切片 评论`, and family-specific contexts. For hard-to-find dictionary terms, the planner also searches stable short-form aliases such as `不会真有人`, `dddd`, `赢麻了`, `单走一个6`, and `自己搜`, while the evidence matcher counts those aliases back onto the original dictionary entries with Bilibili source metadata. Plain `B站` is kept as a later fallback instead of the first search shape because Bilibili site search performs better when the query describes the comment context. `BILIBILI_HARVEST_COVERAGE_MODE=all-weak` targets every term below `BILIBILI_HARVEST_TARGET_EVIDENCE` before broad seed topics, while `balanced` keeps the older per-family sampling cap. When `BILIBILI_HARVEST_REQUIRE_SOURCES=1`, the planner also revisits terms that already have evidence counts but no `evidenceSources`, so older dictionary evidence can be refreshed with auditable Bilibili source metadata. `dictionary:coverage` also honors this same source requirement, so the exported query file targets source gaps when source-backed evidence is required. When a term has been tried without direct evidence, later runs automatically expand beyond the initial variant count and place untried variants first. After `BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT` misses for one term (`3` by default), the planner rotates that stale retry behind unattempted weak terms so small runs keep broadening coverage; stale missed terms also scan deeper using `BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT` (`4` by default) and `BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES` (`3` by default). Hard zero-evidence misses search deeper Bilibili result pages through `BILIBILI_VIDEO_DISCOVERY_PAGES` / `-DiscoveryPages`, capped at 5, so repeated runs are not stuck on only page 1. The next query plan is ordered by `coverageActions`, so retryable missed terms are attempted before untouched weak terms until that retry limit is reached. In existing-only mode, video titles/descriptions from discovered public Bilibili videos are included as auditable context evidence by default, including search-result video metadata from already-seen videos that are skipped for comment rescans; set `BILIBILI_HARVEST_INCLUDE_VIDEO_CONTEXT=1` to force the same behavior outside existing-only runs. Add runtime templates with `BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES`, using `{term}` and `{family}` placeholders, to reopen exhausted terms without editing source code. The report includes `coverage.complete`, `coverage.coverageRatio`, `coverage.evidenceDeficit`, `coverage.weakTerms`, `coverage.zeroEvidenceTerms`, per-round `coverageProgress`, `termAttemptSummary`, and `coverageActions`. `coverageActions` is a machine-readable per-term action list: `harvest`, `retry_with_new_variant`, `refresh_source_metadata`, `harvest_more_evidence`, `add_query_template`, or `none`.

`BILIBILI_VIDEO_DISCOVERY_MODE` controls where videos come from: `search` uses dictionary/seed queries, `popular` scans Bilibili public popular videos, `mixed` combines both, and `controversial` rotates across controversy-topic searches and dictionary/seed queries. `controversial` is the script default because it is better for finding fast-changing argument language from politics/current affairs, games, social issues, fandom disputes, and other debate-heavy areas. In `controversial` mode, the first `BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT` controversy seeds are also searched with `BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER` (`click` by default) so the run looks for popular videos inside controversial topics, not generic popular videos. Set `BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR=1` or pass `-IncludeGenericPopular` only when you also want the public popular feed. Override the default seeds with `BILIBILI_CONTROVERSY_SEARCH_QUERIES` or the PowerShell `-ControversyQuery` parameter.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
