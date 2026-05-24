# Bilibili User Personality

Research-driven frontend prototype for evaluating whether a selected Bilibili user's comments show a high "argumentative trolling" tendency.

## What It Shows

- A radar chart tailored to adversarial-comment behavior rather than generic personality labels.
- A data-led "杠精指数" derived from six interpretable dimensions:
  - 对抗性动机
  - 认知闭合
  - 证据敏感
  - 逻辑一致
  - 合作讨论
  - 修正意愿
- A dedicated comment-error highlight area for logic errors, factual errors, semantic substitution, emotional framing, and unsupported assertions.
- A research-first interface connecting online disinhibition, motivated reasoning, need for cognitive closure, and pragma-dialectical fallacy analysis to UI evidence.
- A local sample intake area: paste one Bilibili comment per line, enter a UID or label, and generate a new radar profile with evidence-backed error highlights.
- An adaptive lexicon panel that groups terms by semantic families and mines suspicious new slang or meme variants from the current sample.

## Run Locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Notes

This prototype ships with mock Bilibili comment samples and also supports pasted local samples. The adaptive lexicon is stored locally in the browser so newly added slang variants can influence the next generated profile. The scoring language is intentionally framed as behavior-risk analysis over a bounded comment sample, not as a clinical diagnosis or definitive personality judgment.
