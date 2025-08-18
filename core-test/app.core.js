/* ===== Core 三轴量表（R/J/E′）——与基线 UI/ID 完全一致 ===== */

/* ---------- 路径（相对 core-test/ 自身） ---------- */
const CORE_CFG_PATH   = './app.core.config.json';
const CORE_ITEMS_PATH = './items.core.v1.json';

/* ---------- 状态 ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];                 // [{id,text,dim,dir,domain,w}]
const CORE_ANS = new Map();

/* ---------- DOM 工具 ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const SEC = {
  intro:  () => $('#intro')  || $('#coreIntro'),
  survey: () => $('#survey') || $('#coreSurvey'),
  report: () => $('#report') || $('#coreReport'),
};
const escapeHTML = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------- 评分工具 ---------- */
const mapLikertToFive = v => 1 + (v - 1) * (4/6);
const clip = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));

/* ---------- 加载 ---------- */
async function loadCore(){
  const cfg = await fetch(CORE_CFG_PATH, {cache:'no-store'}).then(r=>r.json());
  CORE_CFG = cfg;

  const dat = await fetch(CORE_ITEMS_PATH, {cache:'no-store'}).then(r=>r.json());
  const arr = Array.isArray(dat) ? dat : (Array.isArray(dat.items) ? dat.items : []);
  CORE_ITEMS = arr.map((n, i)=>({
    id: n.id ?? (i+1),
    text: n.text || `Q${i+1}`,
    dim: (n.dim || n.axis || 'R').toUpperCase(), // 兼容 axis 字段
    dir: (typeof n.dir === 'number' ? (n.dir >= 0 ? 1 : -1) : (n.polarity === -1 ? -1 : 1)),
    domain: n.domain || null,
    w: (typeof n.w === 'number' ? n.w : 1.0)
  }));
}

/* ---------- 初始化（沿用基线 ID） ---------- */
function initCore(){
  const btnStart    = $('#startBtn');
  const btnSubmit   = $('#submitSurvey');
  const btnDownload = $('#download');   // 基线里有；core 页里可能无，容错

  btnStart?.addEventListener('click', ()=>{
    SEC.intro()?.classList.add('hidden');
    SEC.survey()?.classList.remove('hidden');
    startSurveyCore();
  });

  btnSubmit?.addEventListener('click', ()=>{
    const got = readSurveyCore();
    if(!got.ok){ alert('还有题未作答。'); return; }
    const est = estimateTheta(got.answers);
    const cls = classify(est);
    renderReportCore(est, cls);
  });

  btnDownload?.addEventListener('click', ()=>{
    const data = window.__coreResult || {};
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'core-test-result.json';
    a.click(); URL.revokeObjectURL(url);
  });
}

/* ---------- 逐题模式（单题卡片 & 自动进入下一题） ---------- */
function buildLikert7(name, onPick){
  const wrap = document.createElement('div'); wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt  = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center' : '');
    const input= document.createElement('input');
    input.type='radio'; input.name=name; input.value=String(v);
    const dot  = document.createElement('span'); dot.className='likert-dot';
    opt.appendChild(input); opt.appendChild(dot);
    input.addEventListener('change',()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped'); setTimeout(()=>opt.classList.remove('tapped'),120);
      onPick(parseInt(input.value,10));
    });
    wrap.appendChild(opt);
  }
  return wrap;
}

function startSurveyCore(){
  CORE_ANS.clear();
  const form = $('#surveyForm'); if(form) form.innerHTML = '';
  const actions = $('#submitSurvey')?.closest('.actions'); if(actions) actions.style.display = 'none';
  renderOneCore(0);
}
function renderOneCore(idx){
  const form = $('#surveyForm'); if(!form) return;
  if(idx >= CORE_ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions'); if(actions) actions.style.display = 'flex';
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('section');
  node.className = 'card item slide-in';
  node.setAttribute('data-q-idx', idx);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="q-options"></div>
  `;
  const likert = buildLikert7('q_'+it.id, (raw)=>{
    CORE_ANS.set(it.id, raw);
    // 自动渲染下一题，并滚动到视口内
    renderOneCore(idx+1);
    const next = form.querySelector(`[data-q-idx="${idx+1}"]`);
    next?.scrollIntoView({behavior:'smooth', block:'start'});
  });
  node.querySelector('.q-options').appendChild(likert);
  form.appendChild(node);
}
function readSurveyCore(){
  if(CORE_ANS.size < CORE_ITEMS.length) return { ok:false, answers:null };
  const answers = CORE_ITEMS.map(it=>{
    const raw  = CORE_ANS.get(it.id);
    const val5 = mapLikertToFive(raw);
    const score = it.dir === -1 ? 6 - val5 : val5;
    return { id:it.id, dim:it.dim, v:score, raw };
  });
  return { ok:true, answers };
}

/* ---------- 估计 & 分类 ---------- */
/* ---------- 估计：固定正交 + 原始分数 ---------- */
function estimateTheta(ans){
  // 平均分（1–5），E 与 R 作固定正交
  const pool = {R:[], J:[], E:[]};
  ans.forEach(a=>{
    const key = (a.dim === 'D') ? 'E' : a.dim; // 兼容 D→E
    if(pool[key]) pool[key].push(a.v);
  });
  const mean = xs => xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : 3;
  const R = clip(mean(pool.R));
  const J = clip(mean(pool.J));
  const E_raw = clip(mean(pool.E));

  // 固定 beta（来自配置，多处 key 兼容）
  const beta =
    (CORE_CFG?.theta?.beta_RE) ??
    (CORE_CFG?.core?.theta?.beta_RE) ??
    (CORE_CFG?.orth_beta_R2E) ?? 0.55;

  const E_p = clip(E_raw - beta * (R - 3));

  return {
    R: +R.toFixed(2),
    J: +J.toFixed(2),
    E_p: +E_p.toFixed(2),
    E_raw: +E_raw.toFixed(2)
  };
}

/* ---------- 分类：标准化 + 高斯核 + 置信边界 ---------- */
function classify(th){
  // 读取常模
  const norm = CORE_CFG?.norm || CORE_CFG?.core?.norm || {
    R:{mean:3,sd:1}, J:{mean:3,sd:1}, E:{mean:3,sd:1}
  };
  const toZ = (x, m) => (x - (m.mean ?? 3)) / (m.sd ?? 1);

  // 被试点 → z 空间
  const zUser = {
    R: toZ(th.R, norm.R),
    J: toZ(th.J, norm.J),
    E: toZ(th.E_p, norm.E)
  };

  // 原型（支持新旧两种位置）
  const P = (CORE_CFG?.classify?.prototypes) ||
            (CORE_CFG?.core?.classify?.prototypes) ||
            (CORE_CFG?.prototypes) || [];

  const sigma = CORE_CFG?.classify?.sigma ??
                CORE_CFG?.core?.classify?.sigma ?? 1.0;

  // 置信阈值
  const conf = (CORE_CFG?.classify?.confidence) ||
               (CORE_CFG?.core?.classify?.confidence) ||
               { margin_min:0.25, sim1_min:0.55, d1_max:1.5 };

  // 距离（优先“伪马氏”=对角协方差；否则单位方差欧氏）
  const scored = P.map(p=>{
    const mu = { R: p.R, J: p.J, E: p.E };
    const zMu = {
      R: toZ(mu.R, norm.R),
      J: toZ(mu.J, norm.J),
      E: toZ(mu.E, norm.E)
    };
    const varDiag = (p.covDiag || {R:1,J:1,E:1});
    const d2 =
      ((zUser.R - zMu.R)**2) / (varDiag.R || 1) +
      ((zUser.J - zMu.J)**2) / (varDiag.J || 1) +
      ((zUser.E - zMu.E)**2) / (varDiag.E || 1);

    const sim = Math.exp( - d2 / (2 * sigma * sigma) );
    return {
      macro: p.id || p.macro,
      label: p.name || p.label || (p.id || ''),
      d: Math.sqrt(d2),
      sim
    };
  })
  .sort((a,b)=> b.sim - a.sim);

  const top1 = scored[0];
  const top2 = scored[1];
  const margin = top1 && top2 ? (top1.sim - top2.sim) / (top1.sim || 1) : 1;

  // 软路由提示（不覆盖结论）
  const hint = [];
  const route = CORE_CFG?.classify?.route || CORE_CFG?.core?.classify?.route || {};
  if ( (th.R >= (route?.C1vC2_hint?.R_min ?? 4.6)) &&
       (th.J <= (route?.C1vC2_hint?.J_max ?? 2.6)) ) {
    hint.push('C1 与 C2 可能混淆，建议判别支线（C1↔C2）。');
  }
  if ( (th.J >= (route?.B0vB3_hint?.J_min ?? 4.2)) &&
       (th.R >= (route?.B0vB3_hint?.R_lo ?? 3.0)) &&
       (th.R <= (route?.B0vB3_hint?.R_hi ?? 4.0)) ) {
    hint.push('B0 与 B3 可能混淆，建议判别支线（B0↔B3）。');
  }

  // 置信标记
  const flags = {
    low_sim: (top1?.sim ?? 0) < conf.sim1_min,
    far_dist: (top1?.d ?? Infinity) > conf.d1_max,
    low_margin: margin < conf.margin_min
  };

  return {
    all: scored.map(s=>({
      macro: s.macro, label: s.label,
      sim: +s.sim.toFixed(4), d: +s.d.toFixed(3)
    })),
    top: scored.slice(0,2).map(s=>({
      macro: s.macro, label: s.label,
      sim: +s.sim.toFixed(4), d: +s.d.toFixed(3)
    })),
    margin: +margin.toFixed(4),
    flags,
    hint
  };
}

/* ---------- 报告渲染（补充边际与提示，不改 UI 结构） ---------- */
function renderReportCore(est, cls){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent'); if(!wrap) return;

  const [t1, t2] = cls.top;
  const tips = [];
  if (cls.flags.low_sim) tips.push('Top1 相似度较低，建议补测或进入判别支线。');
  if (cls.flags.far_dist) tips.push('与任何原型的距离偏大，可能存在量纲/题项不适配；建议后续校准。');
  if (cls.flags.low_margin) tips.push('Top1 与 Top2 边际较小，判别不稳。');
  (cls.hint || []).forEach(h => tips.push(h));

  wrap.innerHTML = `
    <p><strong>核心三轴（1–5）</strong> <span class="core-badge">核心模型</span></p>
    <ul>
      <li>反身/觉察 R：${est.R}</li>
      <li>外部正当化 J：${est.J}</li>
      <li>去魅残差 E′：${est.E_p} <span class="small-muted">(原始E=${est.E_raw})</span></li>
    </ul>
    <p><strong>宏姿态候选</strong>（高斯核相似度）</p>
    <ul>
      <li>Top1：${t1.macro}（相似度 ${t1.sim}，距离 ${t1.d}）</li>
      <li>Top2：${t2?.macro || '—'}${t2?`（相似度 ${t2.sim}，距离 ${t2.d}）`:''}</li>
      <li>边际：${cls.margin}</li>
    </ul>
    ${tips.length ? `<p class="small-muted">提示：${tips.join('；')}</p>` : ''}
    <p class="small-muted">说明：三轴已做标准化；E′ 使用固定正交系数（β）；相似度为 exp(−d²/2σ²)。</p>
  `;

  $('#report')?.classList.remove('hidden');

  // 把结果挂到全局，供导出
  window.__coreResult = { est, cls };
}

/* ---------- 软路由提示：推荐哪一组判别（不覆盖 Top1/Top2） ---------- */
function branchHint(th, cls){
  const rt = CORE_CFG?.routing || {};
  const inRange = (x, min=null, max=null) =>
    (min==null || x>=min) && (max==null || x<=max);

  // 规则 1：高 R、低 J → C1 vs C2
  if(rt.C1C2 && inRange(th.R, rt.C1C2.R_min, rt.C1C2.R_max) && inRange(th.J, null, rt.C1C2.J_max)){
    return { key:'C1vsC2', label:'C1 反身介入 vs C2 停滞冻结', reason:'R 高且 J 低' };
  }
  // 规则 2：高 J、中 R → B0 vs B3
  if(rt.B0B3 && inRange(th.J, rt.B0B3.J_min, rt.B0B3.J_max) && inRange(th.R, rt.B0B3.R_min, rt.B0B3.R_max)){
    return { key:'B0vsB3', label:'B0 高建构依赖 vs B3 功能主义', reason:'J 高且 R 居中' };
  }
  // 兜底：若 Top1/Top2 含任一目标对，则优先那一对
  const tops = (cls?.top || []).map(t=>t.macro);
  if(tops.some(x=>x==='C1' || x==='C2')) return { key:'C1vsC2', label:'C1 反身介入 vs C2 停滞冻结', reason:'Top 候选包含 C1/C2' };
  if(tops.some(x=>x==='B0' || x==='B3')) return { key:'B0vsB3', label:'B0 高建构依赖 vs B3 功能主义', reason:'Top 候选包含 B0/B3' };
  return { key:null, label:'（按 Top1/Top2 判别）', reason:'无明确路由命中' };
}

/* ---------- 报告渲染（补说明 + 判别入口按钮） ---------- */

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{ await loadCore(); initCore(); }
  catch(e){ alert('Core 加载失败：'+e.message); console.error(e); }
});
