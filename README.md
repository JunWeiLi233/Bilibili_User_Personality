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
- Video-link keyword search:
  - Accepts a Bilibili video URL or `BV` id in the same search box.
  - Resolves the video through Bilibili public metadata, scans public top-level and nested comments, and sends the sampled text to the DeepSeek keyword trainer.
  - Shows the learned keywords in the UI and folds them into the local analyzer dictionary.
- DeepSeek V4 Chinese keyword training:
  - Uses the DeepSeek API for dictionary extraction, defaulting to `deepseek-v4-flash`.
  - Current config reads `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL`, `DEEPSEEK_REASONING_EFFORT`, and `DEEPSEEK_BASE_URL`.
  - Extracts Chinese internet terms, meanings, variants, and semantic families from crawled comments.
  - Writes learned terms to `server/deepseekKeywordDictionary.json` and merges them into the local analyzer.
  - Marks dictionary hits inside analyzed comments, maps each semantic family to a radar axis, and shows the vocabulary markers under the radar chart.
- Built-in public test samples from Bilibili video `BV19yGa61Ee6`.

## Run Locally

```bash
npm install
npm run server
```

`npm run server` starts the API server and Vite dev server. The API listens on `http://127.0.0.1:8787`; Vite proxies `/api` to it in development.

For DeepSeek V4 keyword training, configure an API key before starting the server:

```bash
set DEEPSEEK_API_KEY=your_api_key
```

Optional model configuration:

```bash
set DEEPSEEK_BASE_URL=https://api.deepseek.com
set DEEPSEEK_MODEL=deepseek-v4-flash
set DEEPSEEK_REASONING_EFFORT=medium
```

`DEEPSEEK_MODEL=deepseek-v4-pro` can be used when you want the stronger V4 model for dictionary extraction.
DeepSeek's API accepts `medium` as a compatibility reasoning-effort value and maps it to its supported V4 thinking effort internally.

## Build

```bash
npm run build
```

## Notes

The automatic collector uses Bilibili public endpoints directly. It does not use AICU, third-party comment indexes, scraping libraries, or external websites to replace UID or video-comment crawling.

The DeepSeek keyword trainer does not fine-tune model weights. It uses DeepSeek V4 as a dictionary extractor, then persists learned Chinese terms into the local dictionary used by the rule/semantic analyzer. If `DEEPSEEK_API_KEY` is missing or the API call fails, the app keeps running with the local rule fallback and reports that in the UI.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
