# Bilibili User Personality / 哔哩哔哩用户画像分析

研究驱动原型：评估选定B站用户的公开评论是否表现出高杠精/引战倾向。

Research-driven prototype for evaluating whether a selected Bilibili user's public comments show a high argumentative-trolling tendency.

---

## 目录 / Table of Contents

- [项目简介 / Overview](#项目简介--overview)
- [当前词典状态 / Current Dictionary Status](#当前词典状态--current-dictionary-status)
- [本地运行 / Run Locally](#本地运行--run-locally)
- [配置与脚本 / Configuration & Scripts](#配置与脚本--configuration--scripts)
- [自动覆盖循环 / Auto-Coverage Loop](#自动覆盖循环--auto-coverage-loop)
- [构建 / Build](#构建--build)
- [备注 / Notes](#备注--notes)

---

## 项目简介 / Overview

### 功能 / What It Shows

- 针对杠精行为定制的雷达图，而非通用的性格标签。
  A radar chart tailored to adversarial-comment behavior rather than generic personality labels.
- 数据驱动的"杠精指数"，从六个可解释维度得出：
  A data-led trolling index derived from six interpretable dimensions:
  - 对抗性动机 / Adversarial Motivation
  - 认知闭合 / Cognitive Closure
  - 证据敏感 / Evidence Sensitivity
  - 逻辑一致 / Logical Consistency
  - 合作讨论 / Cooperative Discussion
  - 修正意愿 / Correction Willingness
- 三种分析模式 / Three analysis modes:
  - **混合模式 / Hybrid**: 语义行为判断 + 自适应词典证据
  - **语义判断模式 / Semantic Judge**: 评估目标、证据负担、命题回应和修正行为
  - **词典模式 / Lexicon**: 透明的语义族匹配，可审计
- **基于UID的自动采样 / UID-based automatic sampling**:
  - 读取B站公开资料/卡片数据
  - 从B站公开端点发现投稿和动态
  - 扫描评论并按 `mid` 过滤互动
  - 不使用AICU、第三方索引或外部网站替代UID评论爬取
- **视频关键词搜索 / Video keyword search**:
  - 在同一搜索框中接受B站视频URL或BV号
  - 后端搜索B站视频、扫描公开评论并训练关键词
  - UI中显示学到的关键词，并合并到本地分析器词典中
- **DeepSeek V4 中文关键词训练 / DeepSeek V4 Chinese keyword training**:
  - 使用DeepSeek API进行词典提取
  - 自动覆盖循环强制使用 `deepseek-v4-flash`（推理力度max）
  - 直接分析和复杂实现工作仍可使用 `deepseek-v4-pro`
  - 从爬取的评论中提取中文网络用语、含义、变体和语义族

### 质量规则 / Quality Rules

- 覆盖证据必须来自B站公开评论、回复或弹幕（除非明确选择宽松模式）。
  Coverage evidence must come from Bilibili public comments, replies, or danmaku.
- 爬虫不使用AICU或第三方评论索引替代本地收集。
  The crawler does not use AICU or third-party comment indexes.
- 搜索结果标题可用于辅助发现，但严格模式不将其视为完成的评论证据。
  Search-result titles aid discovery but strict mode does not count them as comment evidence.
- DeepSeek用作词典提取器和句子上下文判断器，不微调本地模型。
  DeepSeek extracts dictionaries and judges sentence context; it does not fine-tune a local model.

---

## 当前词典状态 / Current Dictionary Status

| 指标 / Metric | 值 / Value |
|---|---|
| 词典术语数 / Dictionary Terms | 1589 |
| 每条术语目标证据数 / Target Evidence per Term | 3 |
| 覆盖率 / Coverage Ratio | **88.74%** |
| 弱证据术语（低于目标）/ Weak Terms | 179 |
| 零证据术语 / Zero-Evidence Terms | 14 |
| 证据缺口 / Evidence Deficit | 363 |
| 有来源证据术语 / Source-Backed Terms | 1575 |
| 无来源证据术语 / Unsourced Terms | 0 |

词典覆盖目标尚未完成。继续运行 `.\run-bilibili-auto-coverage.ps1` 直至消除弱证据和零证据术语，然后重新运行 `npm run dictionary:coverage`。

The dictionary coverage target is not yet complete. Continue running the auto-coverage loop until weak and zero-evidence terms are eliminated.

---

## 本地运行 / Run Locally

### 启动服务 / Start Server

```powershell
cd D:\Bilibili_User_Personality
npm install
.\set-deepseek-env.ps1
npm run server
```

- API 后端 / Backend: `http://127.0.0.1:8787`
- Vite 前端 / Frontend: 通常 `http://127.0.0.1:5191`

### 关键词采集 / Keyword Harvesting

```powershell
# 后端关键词采集 / Backend keyword harvesting
.\run-bilibili-video.ps1

# 完整词典覆盖循环 / Full dictionary coverage loop
.\run-bilibili-auto-coverage.ps1 -MaxCycles 5 -RoundsPerCycle 2 -MaxQueries 20 -DiscoveryLimit 8 -CommentPages 3
```

### 覆盖审计 / Coverage Audit

```powershell
npm run dictionary:coverage
```

审计写入 `server/keywordCoverageAudit.json`、导出可读查询到 `server/keywordCoverageQueries.txt`、结构化动作到 `server/keywordCoverageActions.json`，并打印弱术语、零证据术语、家族缺口和推荐的下一步查询。

### 词典清理 / Dictionary Pruning

```powershell
# 普通清理 / General cleanup
npm run dictionary:prune

# 精简用尽术语 / Prune exhausted terms
npm run dictionary:prune-exhausted
```

### DeepSeek 任务委托 / Delegate to DeepSeek

```powershell
.\run-deepseek-job.ps1 -Task "修复词典覆盖合并逻辑" -Mode complex -Commit -Push
```

- `-Mode light` / `-Mode flash` → `deepseek-v4-flash`
- `-Mode complex` / `-Mode pro` → `deepseek-v4-pro`
- `-Mode auto` → 根据任务关键词自动选择

---

## 配置与脚本 / Configuration & Scripts

### 视频发现 / Video Discovery

```powershell
# 自定义争议查询 / Custom controversy queries
.\run-bilibili-video.ps1 -ControversyQuery "时政 评论区","游戏 节奏 评论区" -MaxQueries 20

# 混合搜索和争议 / Combine search and controversy
.\run-bilibili-video.ps1 -SearchQuery "阴阳怪气 评论区","杠精 评论区" -ControversyQuery "国际政治 评论区" -DiscoveryMode controversial
```

### 发现模式 / Discovery Modes

| 模式 / Mode | 说明 / Description |
|---|---|
| `search` | 使用词典/种子查询搜索 |
| `controversial` | 轮换争议话题搜索（默认） |
| `popular` | 扫描B站热门视频 |
| `mixed` | 组合 search + popular |

### 并行解析器 / Parallel Resolver

```powershell
# 在3个工作树中并行运行近目标解析器
# Run near-target resolver in parallel across 3 worktrees
node server/resolveNearTargetTerms.js
# 使用 RESOLVE_OVERRIDE_TERMS 指定目标术语
$env:RESOLVE_OVERRIDE_TERMS="术语1,术语2,术语3"
$env:RESOLVE_VIDEOS_PER_TERM="5"
$env:RESOLVE_PAGES="3"
$env:RESOLVE_BATCH="80"
node server/resolveNearTargetTerms.js
```

### 爬虫调速 / Crawler Pacing

```powershell
$env:BILIBILI_CRAWLER_MIN_DELAY_MS="900"
$env:BILIBILI_CRAWLER_JITTER_MS="700"
$env:BILIBILI_CRAWLER_BLOCK_COOLDOWN_MS="45000"
$env:BILIBILI_CRAWLER_CACHE_TTL_MS="120000"
```

---

## 自动覆盖循环 / Auto-Coverage Loop

### 工作原理 / How It Works

1. **审计** / **Audit**: 检查每个词典术语的B站评论证据数
2. **查询生成** / **Query Generation**: 为弱证据术语生成B站搜索查询
3. **采集** / **Harvest**: 搜索视频并扫描评论/弹幕
4. **验证** / **Validate**: 通过DeepSeek验证评论是否包含术语
5. **精简** / **Prune**: 移除多次尝试后仍无法证实的术语
6. **重复** / **Repeat**: 循环直至达到覆盖目标

### 关键环境变量 / Key Env Vars

| 变量 / Variable | 说明 / Description | 默认 / Default |
|---|---|---|
| `BILIBILI_COVERAGE_LOOP_MAX_CYCLES` | 最大周期数 / Max cycles | `3` |
| `BILIBILI_HARVEST_MAX_QUERIES` | 每周期查询数 / Queries per cycle | `12` |
| `BILIBILI_VIDEO_DISCOVERY_MODE` | 发现模式 / Discovery mode | `search` |
| `BILIBILI_HARVEST_QUERY_TIMEOUT_MS` | 每查询超时(ms) / Per-query timeout | `180000` |
| `BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER` | 精简阈值 / Prune threshold | `0`（关闭/off） |
| `BILIBILI_HARVEST_TARGET_EVIDENCE` | 目标证据数 / Target evidence | `3` |
| `BILIBILI_HARVEST_PREFILTER_COMMENTS` | 评论预过滤 / Pre-filter comments | `1` |
| `BILIBILI_HARVEST_DEEPEN_REPLIES` | 回复树深化 / Deepen replies | `1` |
| `BILIBILI_HARVEST_INCLUDE_DANMAKU` | 包含弹幕 / Include danmaku | `1` |
| `BILIBILI_HARVEST_EXISTING_TERMS_ONLY` | 仅现有术语 / Existing terms only | `1` |
| `DEEPSEEK_MODEL` | DeepSeek模型 | `deepseek-v4-flash` |

### 收敛路径 / Convergence Path

收敛到~100%覆盖率需要：
1. **持续采集**: 重复运行自动覆盖循环
2. **用尽术语精简**: 设置 `BILIBILI_HARVEST_PRUNE_EXHAUSTED_AFTER=3` 以在多次尝试后移除无法证实的术语
3. **平行化**: 将弱术语分批，在独立工作树中并行运行近目标解析器
4. **合并结果**: 使用 `node server/mergeAgentDictionaries.js` 合并并行agent的输出

Convergence to ~100% coverage requires sustained harvesting, term pruning, and parallel execution for efficiency.

---

## 构建 / Build

```bash
npm run build
```

---

## 备注 / Notes

### 爬虫设计 / Crawler Design
爬虫有意保守：请求是顺序的、成功响应会短暂缓存、页面限制有上限、遇到限流会冷却而非快速重试。爬虫直接使用B站公开端点，不使用AICU、第三方评论索引或外部网站。

The crawler is intentionally conservative: sequential requests, brief caching, capped pages, cooldown on rate limits. Uses Bilibili public endpoints directly.

### 评分框架 / Scoring Framework
评分语言被构建为基于有限公开评论样本的行为风险分析，而非临床诊断或确定性的个性判断。

The scoring language is framed as behavior-risk analysis over a bounded public comment sample, not as a clinical diagnosis or definitive personality judgment.

### 词典迭代 / Dictionary Iteration
词典采集是迭代的：重复运行以获得更广泛的覆盖。模型生成的关键词只有在清理后的术语能在爬取的评论文本中找到时才会被接受。每条术语包含 `evidenceCount`、`evidenceSamples` 和 `evidenceSources` 以便审计。

The dictionary harvester is iterative: run repeatedly for broader coverage. Model-generated keywords are accepted only when the cleaned term appears in crawled comments. Each entry includes evidence metadata for auditability.

### 并行解析器合并 / Parallel Resolver Merge
并行执行后，使用合并脚本收集所有工作树的证据：

After parallel execution, merge evidence from all worktrees:

```powershell
node server/mergeAgentDictionaries.js .claude/worktrees/resolver-1 .claude/worktrees/resolver-2 .claude/worktrees/resolver-3
```

然后运行覆盖审计测量改进：

Then run a coverage audit to measure improvement:

```powershell
npm run dictionary:coverage
```
