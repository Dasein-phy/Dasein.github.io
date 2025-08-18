/* ===== Core 三轴量表（R/J/E′）——与基线 UI/ID 完全一致 ===== */

/* ---------- 路径（相对 core-test/） ---------- */
const CORE_CFG_PATH   = './app.core.config.json';
const CORE_ITEMS_PATH = './items.core.v1.json';

/* ---------- 状态 ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];      // [{id,text,dim:'R'|'J'|'E', dir:+1|-1, domain?, w?}]
const CORE_ANS = new Map();

/* ---------- DOM 工具 ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- 小工具 ---------- */
const mapLikertToFive = v => 1 + (v - 1) * (4/6);    // 7 点映射到 1–5
const clip = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const esc  = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------- 加载配置/题库 ---------- */
async function loadCore(){
  const cfg = await fetch(CORE_CFG_PATH, {cache:'no-store'}).then(r=>r.json());
  CORE_CFG = cfg;

  const dat = await fetch(CORE_ITEMS_PATH, {cache:'no-store'}).then(r=>r.json());
  const arr = Array.isArray(dat) ? dat : (Array.isArray(dat.items) ? dat.items : []);
  CORE_ITEMS = arr.map((n, i)=>({
    id: n.id ?? (i+1),
    text: n.text || `Q${i+1}`,
    dim: (n.dim || n.axis || 'R').toUpperCase().replace('D','E'),
    dir: (typeof n.dir === 'number' ? (n.dir >= 0 ? 1 : -1) : (n.polarity === -1 || n.polarity === 'neg' ? -1 : 1)),
    domain: n.domain || null,
    w: typeof n.w === 'number' ? n.w : 1
  }));
}

/* ---------- 初始化：与基线一样的钩子 ---------- */
function initCore(){
  const btnStart    = $('#startBtn');
  const btnSubmit   = $('#submitSurvey');
  const btnDownload = $('#download');

  btnStart?.addEventListener('click', ()=>{
    $('#intro')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
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
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'core-test-result.json'; a.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------- 逐题渲染：与基线一致的“一大卡片里逐题追加” ---------- */
function buildLikert7(name, onPick){
  const wrap = document.createElement('div'); wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt   = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center' : '');
    const input = document.createElement('input');
    input.type='radio'; input.name=name; input.value=String(v);
    const dot  = document.createElement('span'); dot.className='likert-dot';
    opt.appendChild(input); opt.appendChild(dot);

    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped');
      setTimeout(()=>opt.classList.remove('tapped'),120);
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
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }

  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('div');
  // 关键：给每道题加上 card，使之成为“小卡片”
  node.className = 'item card slide-in';
  node.setAttribute('data-q-idx', idx);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${esc(it.text)}</h3>
    <div class="q-options"></div>
  `;

  const likert = buildLikert7('q_'+it.id, (raw)=>{
    CORE_ANS.set(it.id, raw);
    renderOneCore(idx+1);
    setTimeout(()=>{
      document.querySelector(`[data-q-idx="${idx+1}"]`)
        ?.scrollIntoView({ behavior:'smooth', block:'center' });
    }, 20);
  });

  node.querySelector('.q-options').appendChild(likert);
  form.appendChild(node);
}


function readSurveyCore(){
  if(CORE_ANS.size < CORE_ITEMS.length) return { ok:false, answers:null };
  const answers = CORE_ITEMS.map(it=>{
    const raw   = CORE_ANS.get(it.id);
    const v5    = mapLikertToFive(raw);
    const score = it.dir === -1 ? (6 - v5) : v5;  // 反向题
    return { id:it.id, dim:it.dim, v:score, raw };
  });
  return { ok:true, answers };
}

/* ---------- 参数估计与分类 ---------- */
function estimateTheta(ans){
  const pool = {R:[],J:[],E:[]};
  ans.forEach(a=>{ pool[a.dim].push(a.v); });
  const mean = xs => xs.reduce((s,x)=>s+x,0) / (xs.length || 1);
  let R = clip(mean(pool.R)), J = clip(mean(pool.J)), E_raw = clip(mean(pool.E));

  // 与配置对齐：优先用 app.core.config.json 的 orth_beta_R2E
  const beta = (CORE_CFG && (CORE_CFG.orth_beta_R2E ?? CORE_CFG.beta_R2E)) ?? 0.6;
  const E_p  = clip(E_raw - beta * (R - 3));

  return { R:+R.toFixed(2), J:+J.toFixed(2), E_p:+E_p.toFixed(2), E_raw:+E_raw.toFixed(2) };
}

function classify(th){
  const P = (CORE_CFG?.prototypes || []).map(p=>({
    macro: p.id, label: p.label || p.name || p.id, R:p.R, J:p.J, E:p.E
  }));
  const d2 = p => (th.R-p.R)**2 + (th.J-p.J)**2 + (th.E_p-p.E)**2;
  const ranked = P.map(p=>({ ...p, d:Math.sqrt(d2(p)) }))
                  .sort((a,b)=>a.d-b.d)
                  .map(p=>({ macro:p.macro, sim:+(1/(1+p.d)).toFixed(4), d:+p.d.toFixed(3) }));
  return { top: ranked.slice(0,2), all: ranked };
}

function renderReportCore(est, cls){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent'); if(!wrap) return;
  const [t1,t2] = cls.top;

  wrap.innerHTML = `
    <p><strong>核心三轴（1–5）</strong> <span class="badge">核心模型</span></p>
    <ul>
      <li>反身/觉察 R：${est.R}</li>
      <li>外部正当化 J：${est.J}</li>
      <li>去魅残差 E′：${est.E_p} <span class="small-muted">(原始E=${est.E_raw})</span></li>
    </ul>
    <p><strong>宏姿态候选</strong></p>
    <ul>
      <li>Top1：${t1?.macro ?? '—'}（相似度 ${t1?.sim ?? '—'}，距离 ${t1?.d ?? '—'}）</li>
      <li>Top2：${t2?.macro ?? '—'}${t2?`（相似度 ${t2.sim}，距离 ${t2.d}）`:''}</li>
    </ul>
    <p class="small-muted">提示：本核心版本仅依据 R/J/E′ 做粗分；完整 15 类需要扩展量表与数据校准。</p>
  `;
  $('#report')?.classList.remove('hidden');
  window.__coreResult = { est, cls };
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadCore();
    initCore();
  }catch(e){
    alert('Core 加载失败：' + e.message);
    console.error(e);
  }
});
