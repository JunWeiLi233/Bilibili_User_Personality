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

The script does not require video links. It reads the current local dictionary, turns existing terms into Bilibili search queries, discovers videos, scans public comments, trains the keyword dictionary, and prints a coverage/growth report.

It also persists harvest state in `server/keywordHarvestState.json` and writes the latest report to `server/keywordHarvestReport.json`. These local files are ignored by Git because they are run-specific data.

To change what videos are discovered:

```powershell
.\run-bilibili-video.ps1 -SearchQuery "A圣 评论区","中文互联网 梗" -MaxQueries 20 -Rounds 3 -DiscoveryLimit 8 -CommentPages 3
```

To revisit previously searched queries and videos:

```powershell
.\run-bilibili-video.ps1 -ResetHarvestState
```

You can also run the same backend task through npm:

```powershell
$env:BILIBILI_VIDEO_SEARCH_QUERIES="中文互联网 阴阳怪气`n杠精 评论区"
$env:BILIBILI_HARVEST_MAX_QUERIES="12"
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY="4"
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM="2"
$env:BILIBILI_HARVEST_TARGET_EVIDENCE="3"
$env:BILIBILI_HARVEST_ROUNDS="3"
$env:BILIBILI_HARVEST_RESET="0"
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT="6"
$env:BILIBILI_VIDEO_COMMENT_PAGES="2"
npm run dictionary:harvest
```

`npm run server` starts both services:

- API backend: `http://127.0.0.1:8787`
- Vite frontend: usually `http://127.0.0.1:5191`

If `5191` is already in use, Vite prints the next available local URL, for example `http://127.0.0.1:5197/`. Open the printed Vite URL in your browser.

In the app:

- Click `后端默认视频` to run backend video discovery or the configured backend video links.
- Or paste a UID, Bilibili video URL, or `BV` id into the `B 站 UID / 视频链接` search box.
- If no explicit backend video link is configured, default video discovery uses `BILIBILI_VIDEO_SEARCH_QUERY` or `BILIBILI_VIDEO_SEARCH_QUERIES`.

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
$env:BILIBILI_HARVEST_MAX_QUERIES="12"
$env:BILIBILI_HARVEST_TERMS_PER_FAMILY="4"
$env:BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM="2"
$env:BILIBILI_HARVEST_TARGET_EVIDENCE="3"
$env:BILIBILI_HARVEST_ROUNDS="3"
$env:BILIBILI_HARVEST_STATE_PATH="server/keywordHarvestState.json"
$env:BILIBILI_HARVEST_REPORT_PATH="server/keywordHarvestReport.json"
$env:BILIBILI_HARVEST_SKIP_SEEN="1"
$env:BILIBILI_VIDEO_DISCOVERY_LIMIT="6"
$env:BILIBILI_VIDEO_COMMENT_PAGES="2"
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

The dictionary harvester is iterative. Run it repeatedly with different seed queries, larger `BILIBILI_HARVEST_MAX_QUERIES` values, or `BILIBILI_HARVEST_ROUNDS` greater than `1` to expand coverage in one command. By default it skips queries and BV ids already recorded in the harvest state. No crawler can prove it has gathered every possible Bilibili slang term, so the practical target is continued growth with zero duplicate dictionary terms and broader family coverage.

To protect dictionary quality, model-generated keywords are accepted only when the cleaned term can be found in the crawled Bilibili comment text. Accepted entries include `evidenceCount` and `evidenceSamples` so each term can be audited against source comments. Terms without direct text evidence are counted as `evidenceRejected` in the harvest report and are not merged into the dictionary.

Harvest query generation prioritizes weak-evidence dictionary entries first and can generate multiple Bilibili-oriented query variants per term through `BILIBILI_HARVEST_QUERY_VARIANTS_PER_TERM`. The report includes `coverage.weakTerms`, `coverage.zeroEvidenceTerms`, and `coverage.averageEvidence`, which helps choose whether to keep harvesting broad seed queries or focus on under-supported terms.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
