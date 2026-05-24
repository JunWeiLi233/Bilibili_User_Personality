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
  - Tries public UID video discovery.
  - Falls back to a user-provided BV pool.
  - Filters public comments by `mid`.
- Optional AICU-compatible history import:
  - Calls AICU's public history-comment endpoint shape from the local API server.
  - Imports pages of historical comments into the local semantic analyzer.
  - Treats AICU as an external data source, not as the judgment model.
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

The automatic collector uses public Bilibili endpoints. Some UID space APIs may be rate-limited or blocked by Bilibili risk control; in that case, provide a BV video pool and the tool will search those public comment areas for the target `mid`.

The AICU option imports a historical comment index from `https://api.aicu.cc` through the local server. It is useful for comparison because AICU has broader historical coverage than real-time public-object scanning, but the local tool still performs its own speech-act analysis.

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.
