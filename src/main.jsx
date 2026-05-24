import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Brain,
  ChartPolar,
  CheckCircle,
  ClipboardText,
  Detective,
  Faders,
  FlagBanner,
  Gauge,
  Lightning,
  MagnifyingGlass,
  Scales,
  ShieldWarning,
  WarningCircle,
} from '@phosphor-icons/react';
import './styles.css';

const AXES = ['对抗性动机', '认知闭合', '证据敏感', '逻辑一致', '合作讨论', '修正意愿'];
const INVERSE_AXES = new Set(['证据敏感', '逻辑一致', '合作讨论', '修正意愿']);

const axisDescriptions = {
  对抗性动机: '从否定式开场、挑衅动词、二人称攻击、讥讽和冲突升级词估计。',
  认知闭合: '从绝对化副词、单因归因、拒绝歧义与快速定论模式估计。',
  证据敏感: '从来源引用、反证回应、数据修正和“你自己搜”回避率估计，数值越低风险越高。',
  逻辑一致: '从谬误标签、概念稳定性、前后矛盾和论证链完整度估计，数值越低风险越高。',
  合作讨论: '从澄清问题、让步、复述对方观点和主题保持率估计，数值越低风险越高。',
  修正意愿: '从被纠错后的承认、补充、沉默、转移话题和反击比例估计，数值越低风险越高。',
};

const researchFrames = [
  {
    label: '线上去抑制',
    source: 'Suler, 2004',
    claim: '匿名性、不可见性与异步反馈会降低自我约束，使挑衅和羞辱性表达更容易出现。',
  },
  {
    label: '动机性推理',
    source: 'Kunda, 1990',
    claim: '人会选择性寻找支持自身立场的信息，并对反证采用更高的怀疑门槛。',
  },
  {
    label: '认知闭合需求',
    source: 'Webster & Kruglanski, 1994',
    claim: '高闭合需求者倾向快速定论，回避歧义、条件限定和多因解释。',
  },
  {
    label: '语用论辩',
    source: 'van Eemeren & Grootendorst',
    claim: '谬误可视为破坏批判性讨论规则的语言行动，而不是单纯“说话难听”。',
  },
];

const sampleTextA = `你连这个都不懂还谈产业？国产替代就是骗补，哪个不是 PPT 项目？
B 站早就没有长视频创作者了，都是切片号。
你说要看数据，其实就是给资本洗地。
笑死，这种观点也有人信，真是被营销洗傻了。
别扯什么来源，你自己搜一下不就知道了。
所有支持这个观点的人都一个样，根本不是讨论问题。`;

const sampleTextB = `这个优化像上次那款一样翻车，所以估计也撑不了多久。
厂家肯定偷偷降规格了，不然不会这样。
我看了一下评测数据，可能是固件版本不同，前面那句我说重了。
如果有更完整的来源可以贴一下，我愿意改结论。
这个类比不一定准确，但目前样本里确实有两个相似案例。`;

const lexicons = {
  attack: ['你懂', '洗傻', '笑死', '智商', '脑子', '蠢', '跪', '急了', '别扯', '装', '洗地', '你连'],
  absolutes: ['所有', '全部', '都是', '从来', '永远', '肯定', '必然', '早就没有', '哪个不是', '根本'],
  evidence: ['数据', '来源', '论文', '报告', '统计', '样本', '链接', '证据', '评测', '引用'],
  evasion: ['你自己搜', '这还用说', '懂的都懂', '懒得解释', '不解释', '自己查'],
  cooperation: ['如果', '可能', '不一定', '我理解', '你是说', '能否', '可以贴', '我愿意', '补充', '限定'],
  correction: ['我错了', '我说重了', '更正', '修正', '前面那句', '改结论', '承认', '确实'],
  fallacy: ['所以你就是', '其实就是', '哪个不是', '都一个样', '不然不会', '还谈', '根本不是'],
};

const fallacyRules = [
  {
    type: '逻辑错误',
    severity: '高',
    pattern: /(哪个不是|所有|全部|都一个样|都是).{0,18}/,
    label: '以偏概全',
    diagnosis: '把有限观察扩展成全称判断，未说明样本边界和例外条件。',
  },
  {
    type: '语义偷换',
    severity: '高',
    pattern: /(其实就是|所以你就是).{0,18}/,
    label: '立场归因',
    diagnosis: '把方法论要求或局部观点改写成阵营身份，降低命题本身的可讨论性。',
  },
  {
    type: '事实错误',
    severity: '中',
    pattern: /(早就没有|从来没有|不可能|必然).{0,18}/,
    label: '绝对化事实断言',
    diagnosis: '使用强事实断言但未给出处，容易与可观察反例冲突。',
  },
  {
    type: '缺证断言',
    severity: '中',
    pattern: /(肯定|不然不会|懂的都懂|你自己搜).{0,18}/,
    label: '证据转移',
    diagnosis: '把举证责任推给对方，或把猜测包装成确定结论。',
  },
  {
    type: '情绪化表达',
    severity: '中',
    pattern: /(笑死|洗傻|智商|脑子|蠢|急了).{0,18}/,
    label: '羞辱性标签',
    diagnosis: '用贬损标签替代论证，提高冲突收益但降低讨论推进性。',
  },
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

function countMatches(text, terms) {
  return terms.reduce((sum, term) => sum + (text.split(term).length - 1), 0);
}

function splitComments(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function classifyError(comment, index, totalComments) {
  for (const rule of fallacyRules) {
    const match = comment.match(rule.pattern);
    if (match) {
      const highlight = match[0].trim();
      return {
        id: `generated-${index}`,
        type: rule.type,
        severity: rule.severity,
        comment,
        highlight,
        diagnosis: `${rule.label}。${rule.diagnosis}`,
        evidence: `该片段来自第 ${index + 1}/${totalComments} 条评论；同类规则命中表示需要人工复核原语境。`,
        confidence: rule.severity === '高' ? 0.84 : 0.72,
      };
    }
  }
  return null;
}

function normalizeForRisk(score) {
  return INVERSE_AXES.has(score.axis) ? 100 - score.value : score.value;
}

function getRiskBand(index) {
  if (index >= 70) return '高风险对抗型';
  if (index >= 45) return '混合争辩型';
  return '低风险讨论型';
}

function getTrollIndex(user) {
  const weights = {
    对抗性动机: 0.2,
    认知闭合: 0.16,
    证据敏感: 0.18,
    逻辑一致: 0.18,
    合作讨论: 0.16,
    修正意愿: 0.12,
  };
  return Math.round(
    user.scores.reduce((sum, score) => sum + normalizeForRisk(score) * weights[score.axis], 0),
  );
}

function scoreComments({ name, uid, text }) {
  const comments = splitComments(text);
  const joined = comments.join('\n');
  const total = Math.max(comments.length, 1);
  const chars = Math.max(joined.length, 1);
  const density = (terms) => countMatches(joined, terms) / total;
  const perThousand = (terms) => (countMatches(joined, terms) / chars) * 1000;

  const attack = density(lexicons.attack);
  const closure = density(lexicons.absolutes);
  const evidence = density(lexicons.evidence);
  const evasion = density(lexicons.evasion);
  const cooperation = density(lexicons.cooperation);
  const correction = density(lexicons.correction);
  const fallacyCount = comments.reduce((sum, comment) => {
    return sum + fallacyRules.filter((rule) => rule.pattern.test(comment)).length;
  }, 0);

  const errors = comments.map((comment, index) => classifyError(comment, index, total)).filter(Boolean);
  const fallbackErrors =
    errors.length > 0
      ? errors
      : [
          {
            id: 'generated-empty',
            type: '未检出高风险错误',
            severity: '低',
            comment: comments[0] || '当前样本为空或缺少可分析评论。',
            highlight: comments[0] || '当前样本为空或缺少可分析评论。',
            diagnosis: '当前规则没有检出典型谬误。低风险不等于观点正确，只表示此样本缺少高冲突语言证据。',
            evidence: `已检查 ${comments.length} 条评论，未命中高风险错误规则。`,
            confidence: 0.58,
          },
        ];

  const scores = [
    {
      axis: '对抗性动机',
      value: clamp(28 + attack * 24 + perThousand(lexicons.attack) * 2.8),
      benchmark: 52,
      note: `攻击/讥讽词密度 ${perThousand(lexicons.attack).toFixed(1)} / 千字。`,
    },
    {
      axis: '认知闭合',
      value: clamp(30 + closure * 18 + perThousand(lexicons.absolutes) * 2.2),
      benchmark: 49,
      note: `绝对化表达密度 ${perThousand(lexicons.absolutes).toFixed(1)} / 千字。`,
    },
    {
      axis: '证据敏感',
      value: clamp(55 + evidence * 16 - evasion * 22),
      benchmark: 58,
      note: `证据词 ${countMatches(joined, lexicons.evidence)} 次，举证回避 ${countMatches(joined, lexicons.evasion)} 次。`,
    },
    {
      axis: '逻辑一致',
      value: clamp(68 - (fallacyCount / total) * 42 - perThousand(lexicons.fallacy) * 1.5),
      benchmark: 61,
      note: `谬误规则命中 ${fallacyCount} 次，需结合上下文人工复核。`,
    },
    {
      axis: '合作讨论',
      value: clamp(46 + cooperation * 18 - attack * 16 - evasion * 12),
      benchmark: 55,
      note: `澄清、让步或条件化表达 ${countMatches(joined, lexicons.cooperation)} 次。`,
    },
    {
      axis: '修正意愿',
      value: clamp(36 + correction * 28 + cooperation * 8 - evasion * 12),
      benchmark: 46,
      note: `修正或承认表达 ${countMatches(joined, lexicons.correction)} 次。`,
    },
  ].map((score) => ({ ...score, value: Math.round(score.value) }));

  const disagreementProxy = clamp((attack + closure + fallacyCount / total) / 3, 0, 1);
  const confidence = clamp(0.48 + Math.min(total, 30) / 100 + Math.min(errors.length, 10) / 80, 0.45, 0.9);

  return {
    id: `generated-${Date.now()}`,
    uid: uid || '自定义样本',
    name: name || '自定义 B 站用户',
    bio: '由粘贴评论样本即时生成',
    sampleSize: comments.length,
    analyzed: comments.length,
    confidence,
    stanceSwitchRate: clamp((correction + cooperation * 0.35) / Math.max(total, 1), 0, 1),
    disagreementRate: disagreementProxy,
    scores,
    errors: fallbackErrors,
  };
}

const users = [
  scoreComments({ name: '山前反证员', uid: 'UID 349872641', text: sampleTextA }),
  scoreComments({ name: '冷启动观测站', uid: 'UID 68190422', text: sampleTextB }),
];

function RadarChart({ scores }) {
  const size = 360;
  const center = size / 2;
  const radius = 128;
  const levels = [0.25, 0.5, 0.75, 1];
  const angleStep = (Math.PI * 2) / scores.length;
  const point = (index, value) => {
    const angle = -Math.PI / 2 + index * angleStep;
    const distance = radius * (value / 100);
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  };
  const polygon = scores.map((score, index) => point(index, normalizeForRisk(score)).join(',')).join(' ');
  const baseline = scores
    .map((score, index) => point(index, normalizeForRisk({ ...score, value: score.benchmark })).join(','))
    .join(' ');

  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} role="img" aria-label="杠精倾向雷达图">
      {levels.map((level) => {
        const ring = scores.map((_, index) => point(index, level * 100).join(',')).join(' ');
        return <polygon key={level} points={ring} className="radar-ring" />;
      })}
      {scores.map((score, index) => {
        const [x, y] = point(index, 100);
        const [labelX, labelY] = point(index, 116);
        return (
          <g key={score.axis}>
            <line x1={center} y1={center} x2={x} y2={y} className="radar-axis" />
            <text x={labelX} y={labelY} textAnchor="middle" dominantBaseline="middle" className="radar-label">
              {score.axis}
            </text>
          </g>
        );
      })}
      <polygon points={baseline} className="radar-baseline" />
      <polygon points={polygon} className="radar-shape" />
      {scores.map((score, index) => {
        const [x, y] = point(index, normalizeForRisk(score));
        return <circle key={score.axis} cx={x} cy={y} r="4.5" className="radar-dot" />;
      })}
    </svg>
  );
}

function ErrorComment({ item }) {
  const hasHighlight = item.highlight && item.comment.includes(item.highlight);
  const parts = hasHighlight ? item.comment.split(item.highlight) : [item.comment];
  return (
    <article className="error-item">
      <div className="error-head">
        <span className={`severity severity-${item.severity}`}>{item.severity}风险</span>
        <span>{item.type}</span>
      </div>
      <p className="comment-text">
        {hasHighlight ? (
          <>
            {parts[0]}
            <mark>{item.highlight}</mark>
            {parts.slice(1).join(item.highlight)}
          </>
        ) : (
          item.comment
        )}
      </p>
      <div className="diagnosis-grid">
        <div>
          <span>诊断</span>
          <p>{item.diagnosis}</p>
        </div>
        <div>
          <span>数据证据</span>
          <p>{item.evidence}</p>
        </div>
      </div>
      <div className="confidence-line">
        <span>置信度</span>
        <div>
          <i style={{ width: `${item.confidence * 100}%` }} />
        </div>
        <b>{Math.round(item.confidence * 100)}%</b>
      </div>
    </article>
  );
}

function App() {
  const [profiles, setProfiles] = React.useState(users);
  const [selectedId, setSelectedId] = React.useState(users[0].id);
  const [activeError, setActiveError] = React.useState('全部');
  const [query, setQuery] = React.useState('山前反证员');
  const [uid, setUid] = React.useState('UID 349872641');
  const [commentText, setCommentText] = React.useState(sampleTextA);
  const [analysisState, setAnalysisState] = React.useState('ready');

  const selectedUser = profiles.find((user) => user.id === selectedId) || profiles[0];
  const trollIndex = getTrollIndex(selectedUser);
  const errorTypes = ['全部', ...new Set(selectedUser.errors.map((error) => error.type))];
  const visibleErrors =
    activeError === '全部'
      ? selectedUser.errors
      : selectedUser.errors.filter((error) => error.type === activeError);

  const runAnalysis = () => {
    setAnalysisState('loading');
    window.setTimeout(() => {
      const generated = scoreComments({ name: query, uid, text: commentText });
      setProfiles((current) => [generated, ...current.filter((item) => !item.id.startsWith('generated-'))]);
      setSelectedId(generated.id);
      setActiveError('全部');
      setAnalysisState('ready');
    }, 360);
  };

  const loadSample = (sample, profile) => {
    setQuery(profile.name);
    setUid(profile.uid);
    setCommentText(sample);
  };

  return (
    <main>
      <section className="hero-shell">
        <nav className="topbar" aria-label="分析工作台导航">
          <div className="brand">
            <span><Detective size={18} weight="duotone" /></span>
            <strong>BiliArgument Lab</strong>
          </div>
          <div className="nav-metrics">
            <span>评论样本 {selectedUser.sampleSize}</span>
            <span>模型版本 PDI-0.5</span>
            <span>中文社区语境</span>
          </div>
        </nav>

        <div className="hero-grid">
          <section className="intro-panel">
            <div className="eyebrow"><MagnifyingGlass size={16} /> research first</div>
            <h1>用论证行为数据识别 B 站评论里的“杠精倾向”。</h1>
            <p>
              这个原型不把“不同意”直接等同于“杠”。它把评论拆成动机、证据、逻辑、合作性和修正行为，
              再用可追溯的错误片段解释每一项评分。
            </p>
            <div className="search-row">
              <label htmlFor="user-query">目标用户</label>
              <div>
                <input
                  id="user-query"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="输入 UID、昵称或样本标签"
                />
                <button type="button" onClick={runAnalysis}>
                  <Lightning size={17} weight="fill" />
                  {analysisState === 'loading' ? '分析中' : '生成画像'}
                </button>
              </div>
            </div>
          </section>

          <aside className="research-panel" aria-label="研究框架">
            <div className="section-title">
              <Brain size={20} weight="duotone" />
              <span>心理学与论辩学框架</span>
            </div>
            {researchFrames.map((frame) => (
              <div className="research-row" key={frame.label}>
                <strong>{frame.label}</strong>
                <p>{frame.claim}</p>
                <small>{frame.source}</small>
              </div>
            ))}
          </aside>
        </div>
      </section>

      <section className="input-section">
        <div className="input-grid">
          <div>
            <span className="eyebrow"><ClipboardText size={16} /> sample intake</span>
            <h2>粘贴目标用户的 B 站评论样本</h2>
            <p>每行一条评论。评分引擎会统计冲突词、绝对化表达、证据词、回避举证、合作性和修正表达，并把高风险片段回放到错误高亮区。</p>
          </div>
          <div className="comment-form">
            <label htmlFor="uid-input">UID 或来源说明</label>
            <input id="uid-input" value={uid} onChange={(event) => setUid(event.target.value)} />
            <label htmlFor="comment-input">评论样本</label>
            <textarea id="comment-input" value={commentText} onChange={(event) => setCommentText(event.target.value)} />
            <div className="sample-actions">
              <button type="button" onClick={() => loadSample(sampleTextA, { name: '山前反证员', uid: 'UID 349872641' })}>
                载入高风险样本
              </button>
              <button type="button" onClick={() => loadSample(sampleTextB, { name: '冷启动观测站', uid: 'UID 68190422' })}>
                载入混合样本
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="workspace">
        <aside className="user-rail">
          <div className="rail-title">
            <ClipboardText size={18} />
            <span>用户样本</span>
          </div>
          {profiles.map((user) => (
            <button
              className={`user-card ${user.id === selectedId ? 'active' : ''}`}
              key={user.id}
              type="button"
              onClick={() => {
                setSelectedId(user.id);
                setActiveError('全部');
                setQuery(user.name);
                setUid(user.uid);
              }}
            >
              <strong>{user.name}</strong>
              <span>{user.uid}</span>
              <i>{user.bio}</i>
            </button>
          ))}
          <div className="method-note">
            <Scales size={18} />
            <p>评分不是人格诊断，只表示在给定评论样本中的论辩行为风险。</p>
          </div>
        </aside>

        <section className="analysis-core">
          <div className="profile-header">
            <div>
              <span className="eyebrow"><Gauge size={16} /> profile output</span>
              <h2>{selectedUser.name}</h2>
              <p>{selectedUser.uid} · {selectedUser.bio}</p>
            </div>
            <div className="score-block">
              <span>杠精指数</span>
              <strong>{trollIndex}</strong>
              <small>{getRiskBand(trollIndex)}</small>
            </div>
          </div>

          <div className={`radar-card ${analysisState === 'loading' ? 'is-loading' : ''}`}>
            <div className="chart-area">
              <RadarChart scores={selectedUser.scores} />
            </div>
            <div className="score-list">
              {selectedUser.scores.map((score) => (
                <div className="score-row" key={score.axis}>
                  <div>
                    <strong>{score.axis}</strong>
                    <span>{axisDescriptions[score.axis]}</span>
                    <em>{score.note}</em>
                  </div>
                  <b>{normalizeForRisk(score)}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="metric-strip">
            <div>
              <span>有效评论</span>
              <strong>{selectedUser.analyzed}</strong>
            </div>
            <div>
              <span>反对立场率</span>
              <strong>{Math.round(selectedUser.disagreementRate * 100)}%</strong>
            </div>
            <div>
              <span>立场修正率</span>
              <strong>{Math.round(selectedUser.stanceSwitchRate * 100)}%</strong>
            </div>
            <div>
              <span>模型置信度</span>
              <strong>{Math.round(selectedUser.confidence * 100)}%</strong>
            </div>
          </div>
        </section>

        <aside className="error-panel">
          <div className="section-title">
            <ShieldWarning size={20} weight="duotone" />
            <span>评论错误高亮</span>
          </div>
          <div className="filter-row" role="tablist" aria-label="错误类型筛选">
            {errorTypes.map((type) => (
              <button
                key={type}
                type="button"
                className={activeError === type ? 'active' : ''}
                onClick={() => setActiveError(type)}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="error-list">
            {visibleErrors.map((error) => (
              <ErrorComment item={error} key={error.id} />
            ))}
          </div>
        </aside>
      </section>

      <section className="model-section">
        <div className="model-header">
          <span className="eyebrow"><Faders size={16} /> scoring protocol</span>
          <h2>从评论到雷达图的计算路径</h2>
        </div>
        <div className="protocol-grid">
          <article>
            <FlagBanner size={24} />
            <strong>1. 语料清洗</strong>
            <p>按行切分评论，去除空白和重复噪声，只保留带有主张、评价或反驳的文本片段。</p>
          </article>
          <article>
            <WarningCircle size={24} />
            <strong>2. 谬误标注</strong>
            <p>识别稻草人、偷换概念、诉诸人身、缺证断言、虚假两难和过度概括。</p>
          </article>
          <article>
            <ChartPolar size={24} />
            <strong>3. 心理指标映射</strong>
            <p>把语言特征映射到闭合需求、动机性推理、合作性和修正意愿。</p>
          </article>
          <article>
            <CheckCircle size={24} />
            <strong>4. 证据回放</strong>
            <p>每个评分都保留可追溯评论片段，避免只给抽象标签或主观印象。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
