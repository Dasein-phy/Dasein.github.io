/* ===== Core 三轴量表（R/J/E′）——与基线 UI/ID 完全一致（core-*） ===== */

/* ---------- 路径（相对 core-test/ 自身） ---------- */
const CORE_CFG_PATH   = './app.core.config.json';
const CORE_ITEMS_PATH = './items.core.v1.json';

/* ---------- 状态 ---------- */
let CORE_CFG   = null;
let CORE_ITEMS = [];             // [{id,text,dim:'R'|'J'|'E', dir: +1|-1, domain?, w?}]
const CORE_ANS = new Map();

/* ---------- DOM ---------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

/* ---------- 工具 ---------- */
const mapLikertToFive = v => 1 + (v - 1) * (4/6);
const clip = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const esc  = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------- 安全加载 ---------- */
async function loadJSON(url){
  const res = await fetch(url, { cache:'no-store' });
  if(!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  const txt = await res.text();
  try{ return JSON.parse(txt); }
  catch(e){ console.error('[JSON parse error]', url, txt); throw e; }
}

/* ---------- 加载配置与题库 ---------- */
async function loadCore(){
  CORE_CFG = await loadJSON(CORE_CFG_PATH);

  const dat = await loadJSON(CORE_ITEMS_PATH);
  const arr = Array.isArray(dat) ? dat : (Array.isArray(dat.items) ? dat.items : []);

  CORE_ITEMS = arr.map((n, i)=>{
    // 维度：兼容 axis / dim，且 D 自动映射到 E
    const dim0 = (n.dim || n.axis || 'R').toString().toUpperCase();
    const dim  = (dim0 === 'D') ? 'E' : dim0;

    // 方向：兼容 dir(±1) / polarity('pos'|'neg'|±1)
    let dir = 1;
    if (typeof n.dir === 'number') {
      dir = n.dir >= 0 ? 1 : -1;
    } else if (typeof n.polarity === 'string') {
      dir = (n.polarity.toLowerCase() === 'neg') ? -1 : 1;
    } else if (typeof n.polarity === 'number') {
      dir = n.polarity >= 0 ? 1 : -1;
    }

    return {
      id: n.id ?? (i+1),
      text: n.text || `Q${i+1}`,
      dim,
      dir,
      domain: n.domain || null,
      w: (typeof n.w === 'number' ? n.w : 1.0)
    };
  });
}

/* ---------- 初始化（全部用 core-* 的 ID） ---------- */
function initCore(){
  const btnStart    = $('#coreStartBtn');
  const btnSubmit   = $('#coreSubmit');
  const btnDownload = $('#coreDownload');
  const btnRestart  = $('#coreRestart');

  btnStart?.addEventListener('click', ()=>{
    $('#coreIntro')?.classList.add('hidden');
    $('#coreSurvey')?.classList.remove('hidden');
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
    a.href = url; a.download = 'core-test-result.json';
    a.click(); URL.revokeObjectURL(url);
  });

  btnRestart?.addEventListener('click', ()=>{
    CORE_ANS.clear();
    $('#coreReport')?.classList.add('hidden');
    $('#coreIntro')?.classList.remove('hidden');
    $('#coreForm')?.replaceChildren();
    $('#coreProg') && ($('#coreProg').textContent = `0 / ${CORE_ITEMS.length}`);
  });
}

/* ---------- 逐题模式（与基线交互一致） ---------- */
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
  const form = $('#coreForm'); if(form) form.innerHTML = '';
  $('#coreProg') && ($('#coreProg').textContent = `0 / ${CORE_ITEMS.length}`);
  renderOneCore(0);
}

function renderOneCore(idx){
  const form = $('#coreForm'); if(!form) return;
  if(idx >= CORE_ITEMS.length){
    // 显示提交按钮
    $('#coreSurvey .actions')?.removeAttribute('style');
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-q-idx', idx);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${esc(it.text)}</h3>
    <div class="q-options"></div>
  `;
  const likert = buildLikert7('q_'+it.id, (raw)=>{
    CORE_ANS.set(it.id, raw);
    const done = CORE_ANS.size;
    $('#coreProg') && ($('#coreProg').textContent = `${done} / ${CORE_ITEMS.length}`);
    renderOneCore(idx+1);
  });
  node.querySelector('.q-options').appendChild(likert);
  form.appendChild(node);
}

function readSurveyCore(){
  if(CORE_ANS.size < CORE_ITEMS.length) return { ok:false, answers:null };
  const answers = CORE_ITEMS.map(it=>{
    const raw   = CORE_ANS.get(it.id);
    const val5  = mapLikertToFive(raw);
    const score = it.dir === -1 ? (6 - val5) : val5;
    return { id:it.id, dim:it.dim, v:score, raw };
  });
  return { ok:true, answers };
}

/* ---------- 估计 & 分类（R/J/E′） ---------- */
function estimateTheta(ans){
  const pool = {R:[],J:[],E:[]};
  ans.forEach(a=>{ pool[a.dim].push(a.v); });

  const mean = xs => xs.length ? xs.reduce((s,x)=>s+x,0)/xs.length : 3;
  let R = clip(mean(pool.R)), J = clip(mean(pool.J)), E_raw = clip(mean(pool.E));

  // 与 config 对齐：app.core.config.json 使用 orth_beta_R2E
  const beta = (typeof CORE_CFG?.orth_beta_R2E === 'number') ? CORE_CFG.orth_beta_R2E : 0.6;
  const E_p  = clip(E_raw - beta*(R-3));

  return {
    R:+R.toFixed(2),
    J:+J.toFixed(2),
    E_p:+E_p.toFixed(2),
    E_raw:+E_raw.toFixed(2)
  };
}

function classify(th){
  // 原型在顶层 prototypes（字段 label 已兼容）
  const P = Array.isArray(CORE_CFG?.prototypes) ? CORE_CFG.prototypes : [];
  if(!P.length) return { top:[], all:[] };

  const d2 = p => (th.R-(+p.R))**2 + (th.J-(+p.J))**2 + (th.E_p-(+p.E))**2;

  const scored = P.map(p=>({
                    macro: p.id,
                    label: p.label || p.name || p.id,
                    d: Math.sqrt(d2(p))
                 }))
                 .sort((a,b)=>a.d-b.d)
                 .map(p=>({ macro:p.macro, label:p.label, sim:+(1/(1+p.d)).toFixed(4), d:+p.d.toFixed(3) }));

  return { top: scored.slice(0,2), all: scored };
}

function renderReportCore(est, cls){
  $('#coreSurvey')?.classList.add('hidden');
  const wrap = $('#coreReportContent'); if(!wrap) return;

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
      ${t1 ? `<li>Top1：${esc(t1.macro)}（相似度 ${t1.sim}，距离 ${t1.d}）</li>` : '<li>Top1：—</li>'}
      ${t2 ? `<li>Top2：${esc(t2.macro)}（相似度 ${t2.sim}，距离 ${t2.d}）</li>` : '<li>Top2：—</li>'}
    </ul>
    <p class="small-muted">提示：本核心版本仅依据 R/J/E′ 做粗分；完整 15 类需扩展量表与数据校准。</p>
  `;
  $('#coreReport')?.classList.remove('hidden');
  window.__coreResult = { est, cls };
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await loadCore();
    initCore();
  }catch(e){
    alert('Core 加载失败：'+ e.message);
    console.error(e);
  }
});


