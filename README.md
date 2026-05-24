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
- Built-in public test samples from Bilibili video `BV19yGa61Ee6`.

## Run Locally

```bash
npm install
npm run server
```

`npm run server` starts the API server and Vite dev server. The API listens on `http://127.0.0.1:8787`; Vite proxies `/api` to it in development.

## Build

```bash
npm run build
```

## Notes

The automatic collector uses Bilibili public endpoints directly. It does not use AICU, third-party comment indexes, scraping libraries, or external websites to replace UID crawling.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
