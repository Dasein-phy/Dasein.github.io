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
function estimateTheta(ans){
  const pool = {R:[],J:[],E:[]};
  ans.forEach(a=>{ pool[a.dim==='D'?'E':a.dim].push(a.v); });
  const mean = xs => xs.reduce((s,x)=>s+x,0)/xs.length;
  let R = clip(mean(pool.R)), J = clip(mean(pool.J)), E_raw = clip(mean(pool.E));
  const beta = CORE_CFG?.orth_beta_R2E ?? 0.6;
  const E_p  = clip(E_raw - beta*(R-3));
  return { R:+R.toFixed(2), J:+J.toFixed(2), E_p:+E_p.toFixed(2), E_raw:+E_raw.toFixed(2) };
}

function classify(th){
  const P = (CORE_CFG?.prototypes || []).map(p=>({
    macro:p.id, label:p.label || p.name, R:p.R, J:p.J, E:p.E
  }));
  const d2 = p => (th.R-p.R)**2 + (th.J-p.J)**2 + (th.E_p-p.E)**2;
  const scored = P.map(p=>({ ...p, d:Math.sqrt(d2(p)) }))
                  .sort((a,b)=>a.d-b.d)
                  .map((p)=>({ macro:p.macro, sim:+(1/(1+p.d)).toFixed(4), d:+p.d.toFixed(3) }));
  return { top: scored.slice(0,2), all: scored };
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
function renderReportCore(est, cls){
  SEC.survey()?.classList.add('hidden');
  const wrap = $('#reportContent') || $('#coreReportContent'); if(!wrap) return;

  const [t1,t2] = cls.top;
  const hint = branchHint(est, cls);

  wrap.innerHTML = `
    <p><strong>核心三轴（1–5）</strong> <span class="badge">核心模型</span></p>
    <ul>
      <li>反身/觉察 R：${est.R}</li>
      <li>外部正当化 J：${est.J}</li>
      <li>去魅残差 E′：${est.E_p} <span class="muted">(原始 E=${est.E_raw})</span></li>
    </ul>

    <p class="muted">说明：R=对自我/叙事/偏差的检视；J=以规则/共同体/传统给出正当化；E′=去魅强度去除了“R 的线性影响”的残差。</p>

    <p><strong>宏姿态候选</strong></p>
    <ul>
      <li>Top1：${t1.macro}（相似度 ${t1.sim}，距离 ${t1.d}）</li>
      <li>Top2：${t2?.macro || '—'}${t2?`（相似度 ${t2.sim}，距离 ${t2.d}）`:''}</li>
    </ul>

    <p class="muted">隐私：本核心测试默认<strong>仅在本地计算</strong>；未来若征集样本，会提供<strong>匿名上传（自愿）</strong>开关，且在上传前再次确认。</p>

    <p class="muted">推荐判别支线：<strong>${hint.label}</strong>。这是基于 R/J/E′ 的软路由提示，不会覆盖 Top1/Top2。</p>
  `;

  // 显示报告区
  SEC.report()?.classList.remove('hidden');

  // 在“导出/重新开始”按钮下方，补一个“进入判别支线”按钮
  const reportSec = SEC.report();
  if(reportSec){
    // 避免重复添加
    if(!reportSec.querySelector('#coreGoBranch')){
      const actions2 = document.createElement('div');
      actions2.className = 'actions';
      actions2.innerHTML = `
        <button id="coreGoBranch" class="btn primary">进入判别支线</button>
        <span class="muted" id="coreBranchHintText" style="margin-left:8px;"></span>
      `;
      reportSec.appendChild(actions2);
      $('#coreBranchHintText')?.insertAdjacentText('beforeend', `（推荐：${hint.label}）`);
      $('#coreGoBranch')?.addEventListener('click', ()=>{
        // 先占位：等你放入判别题库后在这里路由。现在只做友好提示，不做跳转。
        alert(`判别支线暂未接入题库。\n推荐：${hint.label}（理由：${hint.reason}）。\n完成题库后，这里将自动进入相应支线。`);
      });
    }
  }

  // 暴露结果
  window.__coreResult = { est, cls, route_hint: hint };
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{ await loadCore(); initCore(); }
  catch(e){ alert('Core 加载失败：'+e.message); console.error(e); }
});
