/* ===== Core Test — 复用旧版 UI 的实现 ===== */

/* ---------- 路径 ---------- */
const CORE_CFG_PATH   = './app.core.config.json';
const CORE_ITEMS_PATH = './items.core.v1.json';

/* ---------- 全局状态 ---------- */
let CORE_CFG = null;
let CORE_ITEMS = [];              // [{id,text,w,weights:{R,J,E}, domain?}]
const CORE_ANS = new Map();       // Map<id, raw 1..7>

/* ---------- DOM 快捷 ---------- */
const $  = (sel, root=document) => root.querySelector(sel);

/* ---------- 小工具 ---------- */
function likertMap7to5(raw){ return 1 + (raw - 1) * (4/6); } // 1..7 -> 1..5
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

/* ---------- 数据加载 ---------- */
async function fetchJSON(path){
  const r = await fetch(path);
  if(!r.ok) throw new Error(`load fail: ${path}`);
  return await r.json();
}
async function coreLoadAll(){
  CORE_CFG   = await fetchJSON(CORE_CFG_PATH);
  const data = await fetchJSON(CORE_ITEMS_PATH);
  CORE_ITEMS = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  if(!CORE_ITEMS.length) throw new Error('Core 题库为空');
  // 按 id 升序，保证稳定呈现（你也可以改成随机/seed）
  CORE_ITEMS.sort((a,b)=>(a.id||0)-(b.id||0));
}

/* ---------- 旧版 UI：逐题渲染组件 ---------- */
function buildLikert7(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center':'');

    const input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = String(v);

    const dot = document.createElement('span'); dot.className = 'likert-dot';
    opt.appendChild(input); opt.appendChild(dot);

    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped');
      setTimeout(()=>opt.classList.remove('tapped'), 130);
      onPick(parseInt(input.value,10));
    });

    wrap.appendChild(opt);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= CORE_ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = CORE_ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.setAttribute('data-q-idx', idx);

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildLikert7('q' + it.id, (raw)=>{
    CORE_ANS.set(it.id, raw);
    if(node.getAttribute('data-next-spawned') !== '1'){
      node.setAttribute('data-next-spawned', '1');
      const nextIdx = idx + 1;
      renderOneItem(nextIdx);
      const nextEl = form.querySelector(`[data-q-idx="${nextIdx}"]`);
      if(nextEl){
        setTimeout(()=>{ nextEl.scrollIntoView({ behavior:'smooth', block:'center' }); }, 60);
      }
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

function startCoreSurvey(){
  CORE_ANS.clear();
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  renderOneItem(0);
}

/* ---------- 计分：R/J/E 与 E′ ---------- */
function scoreCoreRJEr(answersObj){
  // 结构：对 weights.R/J/E 做带符号平均（与旧版一致）
  const acc = { R:{num:0,den:0}, J:{num:0,den:0}, E:{num:0,den:0} };

  for(const it of CORE_ITEMS){
    const raw = answersObj[it.id];
    const score = likertMap7to5(raw);  // 1..5
    const w0 = (typeof it.w==='number') ? it.w : 1.0;
    const W  = it.weights || {};

    [['R',W.R],['J',W.J],['E',W.E]].forEach(([k,coef])=>{
      const c = Number(coef)||0; if(c===0) return;
      const w = Math.abs(w0 * c);
      const signed = (c>=0) ? score : (6 - score);
      acc[k].num += w * signed;
      acc[k].den += w;
    });
  }

  const avg = (x)=> x.den>0 ? (x.num/x.den) : 3.0;
  let R = clip(avg(acc.R)), J = clip(avg(acc.J)), E = clip(avg(acc.E));

  // 残差 E′ = E - beta*R，再归一到 [1,5]
  const beta = (CORE_CFG?.model?.beta_RE ?? 0.45);
  let Eprime = E - beta * (R - 3); // 可选中心化
  // 线性拉回 [1,5]
  const k = (CORE_CFG?.model?.Eprime_k ?? 1.0);
  Eprime = clip(3 + k * (Eprime - 3));

  return { R:+R.toFixed(2), J:+J.toFixed(2), E:+E.toFixed(2), Eprime:+Eprime.toFixed(2) };
}

/* ---------- 判别：Top1/Top2 ---------- */
function classifyCore({R,J,Eprime}){
  const protos = CORE_CFG?.prototypes || [];
  if(!Array.isArray(protos) || !protos.length){
    return { top1:null, top2:null, all:[] };
  }
  const rows = protos.map(p=>{
    const d2 = (R - p.R)**2 + (J - p.J)**2 + (Eprime - p.Eprime)**2;
    const d  = Math.sqrt(d2);
    const sim = 1/(1 + d); // 简单相似度
    return { key:p.key, label:p.label, R:p.R, J:p.J, Eprime:p.Eprime, d:+d.toFixed(3), sim:+sim.toFixed(4) };
  }).sort((a,b)=> b.sim - a.sim);

  return { top1:rows[0]||null, top2:rows[1]||null, all:rows };
}

/* ---------- 报告渲染（沿用旧版风格） ---------- */
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent'); if(!wrap) return;

  const lines = [];
  lines.push(`<h2>结果</h2>`);
  lines.push(`<p><strong>核心三轴（1–5）</strong></p>`);
  lines.push(`<ul>
    <li>反身/觉察 R：${res.core.R}</li>
    <li>外部正当化 J：${res.core.J}</li>
    <li>去魅残差 E′：${res.core.Eprime} <span style="color:#888">(原始E=${res.core.E})</span></li>
  </ul>`);

  if(res.cls?.top1){
    const t1 = res.cls.top1, t2 = res.cls.top2;
    lines.push(`<p><strong>宏姿态候选</strong></p>`);
    lines.push(`<ul>
      <li>Top1：<span class="badge">${t1.label || t1.key}</span>（相似度 ${t1.sim}，距离 ${t1.d}）</li>
      <li>Top2：<span class="badge ghost">${t2?.label || t2?.key || '-'}</span>（相似度 ${t2?.sim ?? '-'}，距离 ${t2?.d ?? '-' }）</li>
    </ul>`);
  }else{
    lines.push(`<p>未能匹配宏姿态原型（配置为空）。</p>`);
  }

  wrap.innerHTML = `<div class="card">${lines.join('\n')}</div>`;
  $('#report')?.classList.remove('hidden');
}

/* ---------- 读取答案 ---------- */
function readCoreAnswers(){
  if(CORE_ANS.size < CORE_ITEMS.length) return {ok:false};
  const out = {};
  for(const it of CORE_ITEMS){
    const raw = CORE_ANS.get(it.id);
    if(typeof raw !== 'number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}

/* ---------- 入口初始化（绑定旧的按钮/卡片切换） ---------- */
function coreInitUI(){
  const btnStart  = $('#startBtn');
  const btnSubmit = $('#submitSurvey');

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startCoreSurvey();
    });
  }
  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const read = readCoreAnswers();
      if(!read.ok){ alert('还有题未作答。'); return; }
      const core = scoreCoreRJEr(read.answers);
      const cls  = classifyCore(core);
      renderReport({ core, cls });
    });
  }
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await coreLoadAll();
    coreInitUI();
  }catch(e){
    alert('Core 加载失败：' + e.message);
    // 控制台细节
    console.error(e);
  }
});
