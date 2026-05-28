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
  - Uses the DeepSeek API for dictionary extraction.
  - The auto-coverage loop now forces `deepseek-v4-flash` with `DEEPSEEK_REASONING_EFFORT=max` for faster repeated Bilibili evidence harvesting.
  - Direct analysis and delegated complex implementation work can still use `deepseek-v4-pro` when explicitly configured.
  - Current config reads `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`, and `DEEPSEEK_BASE_URL`.
  - Extracts Chinese internet terms, meanings, variants, and semantic families from crawled comments.
  - Writes learned terms to `server/deepseekKeywordDictionary.json` and merges them into the local analyzer.
  - Marks dictionary hits inside analyzed comments, maps each semantic family to a radar axis, and shows the vocabulary markers under the radar chart.
  - In direct analysis mode, asks DeepSeek to analyze complete sentences and return `axisImpacts`, then shows sentence-level radar markers under the chart so each score has a traceable sentence target.

## Current Dictionary Status

Latest verified update: current `main` HEAD after this update.

Current audited dictionary state:

- Dictionary terms: `2080`
- Target evidence per term: `3`
- Coverage ratio: `58.89%`
- Weak terms below target: `855`
- Zero-evidence terms: `198`
- Evidence deficit: `1802`
- Source-backed terms: `1882`
- Unsourced evidence terms: `0`
- Attempted terms: `346`
- Successful terms: `98`

The dictionary coverage target is not complete yet. Continue running `.\run-bilibili-auto-coverage.ps1` or `npm run dictionary:auto` until weak and zero-evidence terms are eliminated, then re-run `npm run dictionary:coverage`.

Current quality rules:

- Coverage evidence must come from Bilibili public comments, replies, or public danmaku unless an explicit relaxed mode is chosen.
- The crawler does not use AICU or third-party comment indexes as a substitute for local collection.
- Search-result titles and glossary videos can help discovery, but strict coverage does not treat them as completed comment evidence.
- DeepSeek is used as a dictionary extractor and sentence-context judge; it does not fine-tune a local model.
- The auto-coverage script uses `deepseek-v4-flash` with `DEEPSEEK_REASONING_EFFORT=max`; use `deepseek-v4-pro` only when a separate direct analysis or delegated implementation job explicitly needs it.

Recent dictionary-cleaning updates:

- Removed mojibake and non-Chinese-looking terms such as `瀵规姉`, `鐢风洍濂冲`, and `鐑瘎` from accepted dictionary output.
- Added stricter checks so a term must be a real Chinese/internet term with direct evidence in the crawled text.
- Tightened filters for literal or neutral contexts, including real coins for `老硬币`, school-study narratives for `学习了`, celebrity-name mentions such as `欧阳娜娜`, and generic praise such as `伟大无需多言`.
- Filtered glossary/explanation contexts so videos explaining a meme, a title, or a famous scene do not count as live usage evidence.
- Pruned the latest harvested context-only false positives: video-title-only `赛寄`, literal-history `三角贸易`, and generic `实名制` policy discussion copied onto `实名制观看`.
- Pruned the latest harvested bare/literal false positives: standalone `岂不美哉`, game/source uses of `亡灵法师`, censorship-workaround `怕被删评，故发图`, and positive/explainer uses of `无敌之人`.
- Pruned the latest harvested product/game false positives: game-mechanic `五毒俱全`, literal product-review `100好评` / `百分百好评率`, and commerce-only `差评连天`.
- Pruned the latest loose comment false positives: generic `发出来` publish contexts for `可以贴`, affection-only `小馋猫[doge]`, nickname-list explanations for `小孩射`, and literal dating-app / emote-only `脱单` samples.
- Pruned the latest flash-harvest noise: proper-name `战乙女` and over-specific sentence fragments `弹幕全是节奏复制` / `那段时间弹幕全是节奏复制`, while keeping valid `正义开盒` attack evidence.
- Pruned current flash-harvest bot/name and plot-fragment noise: `ai识片酱`, `岛上完全是幻境`, and loose non-evidence `出来` / `发出来干什么` samples under `可以贴`.
- Pruned current flash-harvest medical-anxiety and negated-context noise: removed evidence-family `恐艾` / `恐艾症` and rejected comfort-context `没有7秒焦虑` samples while keeping explicit anxiety-manufacturing criticism.
- Pruned current flash-harvest slogan/game/body-state noise: removed `零提升` / `0提升`, bare `态度决定一切`, body-state `奖励的有点多`, and one-off `核武器函数乐`, while keeping real accusation evidence such as `资敌`.
- Pruned current flash-harvest negated/platform/meta-label noise: removed typo `爱咋咋的`, mutual-follow `偷偷取关`, generic platform `贴吧`, and meta-question `脱子` samples; kept directed `爆破你`, `恋丑癖`, and valid `紧和` evidence.
- Pruned current flash-harvest game-skill, game-economy, and roster-name noise: removed game-skill `不动如山`, game-economy `血赚`, and thin roster nicknames `病大郎` / `病弯钩`, while keeping valid `自慰队` attack evidence.
- Pruned latest flash-harvest genre/platform/reaction noise: removed generic embarrassment `尬到抠脚`, broad celebrity-industry hedge `不绝对但韩国不少`, game item `赛季蛋`, fiction praise `睡前小甜饼` / `小甜饼`, romance fragment `直男不管对方叫老婆`, platform complaint `不知道ai审核`, and bare meme handoff `压力来到了小猴这边`; kept directed belittling evidence such as `哪根葱`.
- Pruned current coverage-harvest praise/media/literal-state noise: removed typo-praise `不诗人`, appearance praise `颜值身材没有短板`, audio/body-state fragments `全损音品质` / `有一点痔疮`, generic approval `明天来上班`, engagement bait `没人吗`, isolated hot-word label `知识盲区`, creator-support `产出不易`, quote-only `成见是一座大山`, fiction-name pun `程敷衍`, and media rewatch marker `n刷`; kept direct sarcasm `策划你来当` and self-correction `记错了`.
- Pruned latest coverage-harvest vague/proper-name/game-state noise: removed vague reaction `吞之`, proper-name question `开除凡凡`, generic quantifier `亿点点`, and game-stat typo `拉夸`; kept valid hostile evidence such as `吃相太难看` and `纯铁脑瘫`.
- Pruned current auto-coverage praise/platform/identity noise after the `deepseek-v4-flash` max-effort run: removed generic praise `很棒先生` / `这很棒先生` / `up好牛`, payment fragment `我将支付您画画的费用`, neutral `直言不讳`, reaction-only `草生`, identity/platform terms `福瑞控` / `帽子叔` / `帽子叔叔` / `小黄鱼`, game-stat sentence `五维图全都低的可怜`, video-participation reaction `打了自己电话`, and bare meme label `肘遍全网`; kept contextual attack terms such as `饭圈味` and `纯小人`.
- Pruned latest auto-coverage fan/profile/check-in noise after the `deepseek-v4-flash` max-effort run: removed fandom reaction phrases `伊利亚我软脚了` / `伊莉雅我软脚了`, profile-signature shorthand `个签`, and coin/check-in absolutes `第一个投币肯定是我` / `第一个投币肯定是我的`; kept contextual discourse evidence such as `弹性回应` and `你喷我就是你对`.
- Pruned no-progress auto-coverage noise after another `deepseek-v4-flash` max-effort run: removed product/equipment terms `电锯pro` / `电锯promax`, title-only `定叫你好评如潮`, entertainment absolute `东海每次同框绝对有笑点`, literal TV phrase `上电视`, and emote labels `doge圣诞` / `tv点赞`; kept target-context `东户西甜` and sarcastic `良心辣`.
- Kept valid hostile or argumentative uses, for example direct `您配吗` challenges, targeted `梦男` mockery, and attack-context `猪鼻` usage.

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

The script does not require video links. By default it uses backend `controversial` discovery: debate-heavy Bilibili search seeds such as politics/current affairs, games, social issues, fandom disputes, and tech-company disputes are searched first with a popularity-oriented Bilibili search order, then mixed with dictionary-generated queries. Generic public popular videos are not included in `controversial` mode by default, because the goal is controversial popular videos, not ordinary popular videos. Add `-IncludeGenericPopular` only when you intentionally want to mix in the public popular feed. It then scans public comments plus public danmaku, trains the keyword dictionary, and prints a coverage/growth report. Pass `-NoDanmaku` when you intentionally want replies only.

It also persists harvest state in `server/keywordHarvestState.json` and writes the latest report to `server/keywordHarvestReport.json`. These local files are ignored by Git because they are run-specific data.
Harvest commands also take an exclusive local lock at `server/.keyword-harvest.lock`, and dictionary writes use a per-file lock such as `server/deepseekKeywordDictionary.json.lock`, so two dictionary jobs do not write the same local dictionary at the same time. If a command was killed and left a stale lock, the next run removes it automatically when the recorded process is gone or older than `BILIBILI_HARVEST_LOCK_STALE_MS`.

For the full dictionary coverage loop, use:

```powershell
.\run-bilibili-auto-coverage.ps1 -MaxCycles 5 -RoundsPerCycle 2 -MaxQueries 20 -DiscoveryLimit 8 -CommentPages 3
```

That command audits the current dictionary, exports the next weak-term priority queries, harvests Bilibili comments and public danmaku from controversial popular topics plus dictionary queries, then repeats until the coverage gate passes or the cycle limit is reached. It forces `DEEPSEEK_MODEL=deepseek-v4-flash` and `DEEPSEEK_REASONING_EFFORT=max` after loading your local API-key script, so repeated coverage harvesting does not accidentally fall back to the slower pro model. It does not use the generic popular feed unless you pass `-IncludeGenericPopular`. It requires source-backed Bilibili comment evidence and refreshes existing dictionary terms only by default, so coverage work does not keep lowering the pass ratio by adding fresh terms mid-loop or treating search-result titles as completed comment evidence. Public danmaku is enabled by default in the auto-coverage script because many short meme phrases appear in弹幕 more often than replies; pass `-NoDanmaku` when you only want reply comments. The auto-coverage script also expands weak targets from collected comment hits by default, so one scanned comment pool can refresh other under-evidenced dictionary terms it contains; pass `-NoCommentTargetExpansion` when you need a single-target debug run. Add `-AllowNewTerms` when you want the same loop to expand the dictionary, add `-AllowContextOnlyEvidence` when video title/description context is enough for your run, and add `-AllowUnsourcedEvidence` only when you want a faster but less auditable run.

To delegate implementation work to DeepSeek from this repo, use:

```powershell
.\run-deepseek-job.ps1 -Task "fix dictionary coverage merge logic" -Mode complex -Commit -Push -CommitMessage "Fix dictionary coverage merge logic"
```

`-Mode light` or `-Mode flash` uses `deepseek-v4-flash`; `-Mode complex` or `-Mode pro` uses `deepseek-v4-pro`. `-Mode auto` chooses pro when the task mentions language, dictionary, crawler, coverage, backend, semantic, accuracy, or model work. The script always sets `DEEPSEEK_REASONING_EFFORT=max`, runs the DeepSeek executor with auto-apply, then runs `npm test`, `npm run build`, and `git diff --check` before optional commit/push.

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
$env:BILIBILI_HARVEST_QUERY_TIMEOUT_MS="180000"
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

The audit writes `server/keywordCoverageAudit.json`, exports human-readable recommended queries to `server/keywordCoverageQueries.txt`, exports structured action objects to `server/keywordCoverageActions.json`, and prints weak terms, exhausted terms, family gaps, source-backed evidence counts, unsourced evidence terms to refresh, next coverage actions, and recommended next queries/templates. The structured action file preserves the target dictionary term behind each query, so duplicate queries such as one comment search that can refresh several related weak terms are not collapsed into a single unscoped search. For a local or CI gate, set `BILIBILI_COVERAGE_AUDIT_STRICT=1`; the command exits non-zero until the configured coverage target is met. Tune the gate with `BILIBILI_COVERAGE_AUDIT_MIN_RATIO`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMPLETE=0`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_SOURCES=1`, `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS=1`, `BILIBILI_COVERAGE_AUDIT_MAX_ACTIONS`, and `BILIBILI_HARVEST_TARGET_EVIDENCE`. `BILIBILI_COVERAGE_AUDIT_REQUIRE_COMMENTS=1` is stricter: search-result video titles/descriptions can help discovery, but they do not satisfy the coverage gate until the term has non-context Bilibili comment evidence.

If older DeepSeek harvest runs added generic ASCII fragments such as `API`, `BUG`, `MVP`, short ids, or uploader tags, compact the local generated dictionary through the current backend normalizer:

```powershell
npm run dictionary:prune
```

To run the next audit-recommended queries first:

```powershell
.\run-bilibili-video.ps1 -PriorityActionFile server\keywordCoverageActions.json -RequireCommentEvidence -ExistingTermsOnly
```

When `-PriorityActionFile` is used, the script refreshes that file from the current backend coverage audit immediately before harvesting. This prevents stale action files from repeatedly targeting old no-hit queries after the harvest state has moved on. Use `-SkipPriorityActionRefresh` only when you intentionally want to replay the exact structured action file already on disk.

Each priority query has a per-query timeout so one slow Bilibili or DeepSeek call cannot hold the harvest lock forever. For `run-bilibili-video.ps1`, the default is `-QueryTimeoutMs 180000`; lower it for quick triage runs, for example `-QueryTimeoutMs 60000`. For `run-bilibili-auto-coverage.ps1`, use seconds: the default is `-QueryTimeoutSeconds 180`, and a quick triage run can use `-QueryTimeoutSeconds 60`.

`-PriorityQueryFile server\keywordCoverageQueries.txt` still works for plain one-query-per-line runs, but `-PriorityActionFile` is better for coverage work because it keeps the backend target-term metadata from the audit.
The direct harvest script includes public danmaku by default because many short meme phrases appear in弹幕 before they appear in replies. Pass `-NoDanmaku` when you intentionally want reply comments only:

```powershell
.\run-bilibili-video.ps1 -PriorityActionFile server\keywordCoverageActions.json -RequireCommentEvidence -ExistingTermsOnly -NoDanmaku
```

To run a bounded audit-harvest loop without manually copying query files:

```powershell
$env:BILIBILI_COVERAGE_LOOP_MAX_CYCLES="3"
$env:BILIBILI_COVERAGE_LOOP_ROUNDS_PER_CYCLE="1"
npm run dictionary:auto
```

The loop audits coverage, runs the recommended queries as priority harvest queries, audits again, and stops when the coverage gate passes, there are no recommended queries, or the cycle limit is reached. It writes `server/keywordCoverageLoopReport.json` with per-cycle coverage deltas for evidence deficit, zero-evidence terms, source-backed terms, total evidence, and coverage ratio.
Set `BILIBILI_COVERAGE_LOOP_STOP_ON_NO_PROGRESS=1` when you want the loop to stop early if a cycle runs queries but does not reduce the evidence deficit, clear a zero-evidence term, or add source-backed evidence.
Set `BILIBILI_HARVEST_QUERY_TIMEOUT_MS` for the npm loop when you need a tighter per-query cap, for example `60000` for 60 seconds.

`npm run server` starts both services:

- API backend: `http://127.0.0.1:8787`
- Vite frontend: usually `http://127.0.0.1:5191`

If `5191` is already in use, Vite prints the next available local URL, for example `http://127.0.0.1:5197/`. Open the printed Vite URL in your browser.

In the app:

- Click `后端默认视频` to run backend video discovery or the configured backend video links.
- Or paste a UID, Bilibili video URL, or `BV` id into the `B 站 UID / 视频链接` search box.
- Optional: paste your Bilibili browser cookie into `Bilibili Cookie (optional)` before scanning. The frontend sends it only in that backend request body; the backend forwards it to Bilibili API calls for UID discovery, video discovery, comments, and danmaku so logged-in scans can see more accessible public comments. Cookie-backed scans also raise the UI request size from 2 comment pages to 5, and UID scans expand from 8 to 12 public objects. Do not paste cookies from accounts you do not control.
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
$env:DEEPSEEK_REASONING_EFFORT="max"
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
$env:BILIBILI_COOKIE="SESSDATA=...; bili_jct=...; DedeUserID=..."
$env:DEEPSEEK_KEYWORD_DICTIONARY_PATH="server/deepseekKeywordDictionary.json"
```

`BILIBILI_COOKIE` is the CLI/server equivalent of the optional website cookie field. Keep it out of committed files and terminal screenshots. The crawler disables response caching for per-request cookies so one login cookie cannot poison another scan's cached response.

The auto-coverage PowerShell loop overrides `DEEPSEEK_MODEL` to `deepseek-v4-flash` and keeps `DEEPSEEK_REASONING_EFFORT=max`. For direct analysis or one-off complex language jobs outside that loop, set `DEEPSEEK_MODEL=deepseek-v4-pro` when you need slower, stronger reasoning. Keep `DEEPSEEK_REASONING_EFFORT=max` unless you intentionally want a cheaper, lower-effort run.

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

Harvest query generation prioritizes weak-evidence dictionary entries first and can generate multiple Chinese Bilibili-oriented query variants per term through `BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM`, such as `评论区 梗 热评`, `评论区`, `热评`, `弹幕`, `争议 评论区`, `是什么梗`, `什么意思`, `出处`, `名梗`, `名场面 评论区`, `切片 评论`, and family-specific contexts. For hard-to-find dictionary terms, the planner also searches stable short-form aliases such as `不会真有人`, `dddd`, `赢麻了`, `单走一个6`, and `自己搜`, while the evidence matcher counts those aliases back onto the original dictionary entries with Bilibili source metadata. Plain `B站` is kept as a later fallback instead of the first search shape because Bilibili site search performs better when the query describes the comment context. `BILIBILI_HARVEST_COVERAGE_MODE=all-weak` targets every term below `BILIBILI_HARVEST_TARGET_EVIDENCE` before broad seed topics, while `balanced` keeps the older per-family sampling cap. When `BILIBILI_HARVEST_REQUIRE_SOURCES=1`, the planner also revisits terms that already have evidence counts but no `evidenceSources`, so older dictionary evidence can be refreshed with auditable Bilibili source metadata. `dictionary:coverage` also honors this same source requirement, so the exported query file targets source gaps when source-backed evidence is required. When a term has been tried without direct evidence, later runs automatically expand beyond the initial variant count and place untried variants first. After `BILIBILI_HARVEST_RETRY_BEFORE_UNATTEMPTED_LIMIT` misses for one term (`3` by default), the planner rotates that stale retry behind unattempted weak terms so small runs keep broadening coverage; stale missed terms also scan deeper using `BILIBILI_HARVEST_STALE_MISSED_DISCOVERY_LIMIT` (`4` by default) and `BILIBILI_HARVEST_STALE_MISSED_COMMENT_PAGES` (`3` by default). Hard zero-evidence misses search deeper Bilibili result pages through `BILIBILI_VIDEO_DISCOVERY_PAGES` / `-DiscoveryPages`, capped at 5, so repeated runs are not stuck on only page 1. The next query plan is ordered by `coverageActions`, so retryable missed terms are attempted before untouched weak terms until that retry limit is reached. In existing-only mode, video titles/descriptions from discovered public Bilibili videos are included as auditable context evidence by default, including search-result video metadata from already-seen videos that are skipped for comment rescans; set `BILIBILI_HARVEST_INCLUDE_VIDEO_CONTEXT=1` to force the same behavior outside existing-only runs. Add runtime templates with `BILIBILI_HARVEST_EXTRA_QUERY_TEMPLATES`, using `{term}` and `{family}` placeholders, to reopen exhausted terms without editing source code. The report includes `coverage.complete`, `coverage.coverageRatio`, `coverage.evidenceDeficit`, `coverage.weakTerms`, `coverage.zeroEvidenceTerms`, per-round `coverageProgress`, `termAttemptSummary`, and `coverageActions`. Harvest state runs also separate `acceptedEvidenceCount` from `coverageIncreasingAcceptedEvidenceCount`, so duplicate accepted comments are visible without being mistaken for real coverage gains. `coverageActions` is a machine-readable per-term action list: `harvest`, `retry_with_new_variant`, `refresh_source_metadata`, `harvest_more_evidence`, `add_query_template`, or `none`.

`BILIBILI_VIDEO_DISCOVERY_MODE` controls where videos come from: `search` uses dictionary/seed queries, `popular` scans Bilibili public popular videos, `mixed` combines both, and `controversial` rotates across controversy-topic searches and dictionary/seed queries. `controversial` is the script default because it is better for finding fast-changing argument language from politics/current affairs, games, social issues, fandom disputes, and other debate-heavy areas. In `controversial` mode, the first `BILIBILI_CONTROVERSIAL_POPULAR_QUERY_LIMIT` controversy seeds are also searched with `BILIBILI_CONTROVERSIAL_POPULAR_SEARCH_ORDER` (`click` by default) so the run looks for popular videos inside controversial topics, not generic popular videos. Set `BILIBILI_CONTROVERSIAL_INCLUDE_GENERIC_POPULAR=1` or pass `-IncludeGenericPopular` only when you also want the public popular feed. Override the default seeds with `BILIBILI_CONTROVERSY_SEARCH_QUERIES` or the PowerShell `-ControversyQuery` parameter.

When strict comment-backed evidence is enabled (`BILIBILI_HARVEST_REQUIRE_COMMENT_EVIDENCE=1` or `-RequireCommentEvidence`), built-in dictionary retry planning skips definition-only and generic search shapes such as "what does this meme mean", "meaning", "source", plain `Bilibili`, and bare-term probes. Strict runs keep searches anchored to comments, hot comments, replies, danmaku, controversy threads, or other comment-bearing contexts so dictionary coverage is based on real public interaction text instead of glossary-style videos.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
