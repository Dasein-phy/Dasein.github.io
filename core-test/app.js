/* ===== 核心测验 app.js —— R/J/E′ 三轴引擎（保持 UI 不变） ===== */

/* ---------- 资源路径 ---------- */
const cfgPath   = './app.config.json';
const itemsPath = './items.core.v1.json';

/* ---------- 全局状态 ---------- */
let CFG = null;
/** 题库：{id,text,domain,axis,polarity,w,weights{R/J/E}} */
let ITEMS = [];
/** 答案：Map<id, raw(1..7)> */
const ANSWERS = new Map();
let DATA_READY = false;

/* ---------- DOM 快捷 ---------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- 工具 ---------- */
const mapLikertToFive = raw => 1 + (raw - 1) * (4/6);
const clip = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const escapeHTML = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

/* ---------- 加载 ---------- */
async function fetchJSON(path){
  const r = await fetch(path, { cache: 'no-store' });
  if(!r.ok){
    throw new Error(`加载失败：${path} [${r.status}]`);
  }
  return r.json();
}

async function loadAll(){
  try{
    const [cfg, items] = await Promise.all([
      fetchJSON(cfgPath),
      fetchJSON(itemsPath)
    ]);
    CFG = cfg; ITEMS = Array.isArray(items) ? items : [];
    if(!ITEMS.length) throw new Error('题库为空');
    DATA_READY = true;
    // 启用“进入问卷”按钮
    const btnToSurvey = $('#toSurvey');
    if(btnToSurvey) btnToSurvey.disabled = false;
  }catch(err){
    console.error(err);
    alert('题库加载失败：请确认 /core-test/app.config.json 与 /core-test/items.core.v1.json 存在且可被访问。\n\n控制台有详细错误信息。');
    DATA_READY = false;
  }
}

/* ---------- 初始化入口 ---------- */
function init(){
  const btnStart   = $('#startBtn');
  const btnToSurvey= $('#toSurvey');
  const btnSubmit  = $('#submitSurvey');
  const btnDownload= $('#download');
  const btnRestart = $('#restart');

  // 进入问卷按钮先禁用，待题库加载后启用
  if(btnToSurvey) btnToSurvey.disabled = true;

  if(btnStart){
    btnStart.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#mbti')?.classList.remove('hidden');
      initMBTIDropdowns(); // 仅保留UI动效，不参与计分
    });
  }

  if(btnToSurvey){
    btnToSurvey.addEventListener('click', ()=>{
      if(!DATA_READY){
        alert('题库尚未加载完成，请稍候片刻再进入。');
        return;
      }
      $('#mbti')?.classList.add('hidden');
      $('#survey')?.classList.remove('hidden');
      startProgressiveSurvey();
    });
  }

  if(btnSubmit){
    btnSubmit.addEventListener('click', ()=>{
      const read = readSurvey();
      if(!read.ok){ alert('还有题未作答。'); return; }
      const result = scoreCore(read.answers);
      renderReport(result);
    });
  }

  if(btnDownload) btnDownload.addEventListener('click', downloadJSON);
  if(btnRestart)  btnRestart.addEventListener('click', ()=>location.reload());
}

/* ---------- MBTI 交互（仅保留UI） ---------- */
function initMBTIDropdowns(){
  const rail     = document.querySelector('.mbti-rail');
  if(!rail) return;
  const selects = Array.from(rail.querySelectorAll('.mbti-select'));
  selects.forEach(sel=>{
    let openTimer=null, closeTimer=null;
    const cur  = sel.querySelector('.mbti-current');
    const menu = sel.querySelector('.mbti-menu');
    sel.addEventListener('mouseenter', ()=>{
      clearTimeout(closeTimer);
      openTimer = setTimeout(()=> sel.classList.add('mt-open'), 150);
    });
    sel.addEventListener('mouseleave', ()=>{
      clearTimeout(openTimer);
      closeTimer = setTimeout(()=> sel.classList.remove('mt-open'), 160);
    });
    cur && cur.addEventListener('click', ()=>{
      clearTimeout(closeTimer);
      sel.classList.add('mt-open');
    });
    if(menu){
      menu.addEventListener('click', e=>{
        const li = e.target.closest('li[data-v]');
        if(!li) return;
        const v = li.getAttribute('data-v') || '';
        sel.dataset.value = v;
        menu.querySelectorAll('li').forEach(x=>x.classList.remove('is-active'));
        li.classList.add('is-active');
        if(cur) cur.textContent = (v==='' ? '未填' : v);
        sel.classList.remove('mt-open');
      });
    }
  });
}

/* ---------- Progressive 问卷 ---------- */
function startProgressiveSurvey(){
  if(!DATA_READY || !ITEMS.length){
    alert('题库未就绪，无法开始问卷。');
    return;
  }
  ANSWERS.clear();
  const form = $('#surveyForm');
  if(form) form.innerHTML = '';
  const actions = $('#submitSurvey')?.closest('.actions');
  if(actions) actions.style.display = 'none';
  renderOneItem(0);
}

function buildLikert7(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'likert7';
  for(let v=1; v<=7; v++){
    const opt = document.createElement('label');
    opt.className = 'likert-option' + (v===4 ? ' is-center':'');

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(v);

    const dot = document.createElement('span');
    dot.className = 'likert-dot';

    opt.appendChild(input);
    opt.appendChild(dot);

    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped');
      setTimeout(()=>opt.classList.remove('tapped'), 130);
      const raw = parseInt(input.value,10);
      onPick(raw);
    });

    wrap.appendChild(opt);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(!form) return;

  if(idx >= ITEMS.length){
    const actions = $('#submitSurvey')?.closest('.actions');
    if(actions) actions.style.display = 'flex';
    return;
  }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it = ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.setAttribute('data-q-idx', idx);

  const axisLabel = (it.axis==='R'?'反身/觉察R':it.axis==='J'?'外部正当化J':'去魅E');
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}
      <span class="small-muted">（${axisLabel} · ${it.domain}）</span>
    </h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildLikert7('q' + it.id, (raw)=>{
    ANSWERS.set(it.id, raw);
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

function readSurvey(){
  if(ANSWERS.size < ITEMS.length) return {ok:false};
  const out = {};
  for(const it of ITEMS){
    const raw = ANSWERS.get(it.id);
    if(typeof raw !== 'number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}

/* ---------- 核心：估计 θ 与分类 ---------- */
function estimate_theta(answers){
  const acc = {
    R:{num:0, den:0}, J:{num:0, den:0}, E:{num:0, den:0}
  };
  const byDomain = {work:{}, family:{}, public:{}, self:{}};

  for(const it of ITEMS){
    const raw = answers[it.id]; if(typeof raw!=='number') continue;
    const s = mapLikertToFive(raw);
    const w = (typeof it.w==='number'? it.w : 1.0);
    const axis = it.axis;
    const coef = Number(it.weights?.[axis] || 0);
    if(coef===0) continue;

    const signed = (coef >= 0) ? s : (6 - s);
    const wt = Math.abs(w * coef);
    acc[axis].num += wt * signed;
    acc[axis].den += wt;

    const dm = it.domain || 'self';
    byDomain[dm][axis] = byDomain[dm][axis] || {num:0,den:0};
    byDomain[dm][axis].num += wt * signed;
    byDomain[dm][axis].den += wt;
  }

  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  const R = clip(avg(acc.R)), J = clip(avg(acc.J));
  const E_raw = clip(avg(acc.E));

  const beta = (CFG?.core?.beta_RE ?? 0.5);
  const E_p = clip( 3 + ((E_raw-3) - beta*(R-3)) );

  return {
    R:+R.toFixed(2), J:+J.toFixed(2), E_raw:+E_raw.toFixed(2), E_p:+E_p.toFixed(2),
    diag:{ byDomain }
  };
}

function classify(theta){
  const proto = CFG?.core?.proto || {};
  const p = CFG?.core?.distance_pow ?? 2;
  const v = [theta.R, theta.J, theta.E_p];

  const dist = (a,b)=> Math.pow(
    Math.pow(a[0]-b[0], p) + Math.pow(a[1]-b[1], p) + Math.pow(a[2]-b[2], p)
  , 1/p);

  const scores = [];
  for(const k of Object.keys(proto)){
    const d = dist(v, proto[k]);
    const sim = 1/(1+d);
    scores.push({macro:k, proto:proto[k], d:+d.toFixed(3), sim:+sim.toFixed(4)});
  }
  scores.sort((a,b)=> b.sim - a.sim);
  const topk = (CFG?.core?.topk ?? 2);
  return { top: scores.slice(0, topk), all: scores };
}

function scoreCore(answers){
  const th = estimate_theta(answers);
  const cls = classify(th);
  const report = {
    A: th.R, C: th.J, D: th.E_p,
    M: null, S: null, L: null,
    core: { R:th.R, J:th.J, E_prime:th.E_p, E_raw:th.E_raw },
    classify: cls,
    survey_raw: th.diag
  };
  return report;
}

/* ---------- 报告 ---------- */
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  if(!wrap) return;

  const t1 = res.classify.top[0];
  const t2 = res.classify.top[1];

  const lines = [];
  lines.push(`<p><strong>核心三轴（1–5）</strong> <span class="core-badge">核心模型</span></p>`);
  lines.push(`<ul>
    <li>反身/觉察 R：${res.core.R}</li>
    <li>外部正当化 J：${res.core.J}</li>
    <li>去魅残差 E′：${res.core.E_prime} <span class="small-muted">(原始E=${res.core.E_raw})</span></li>
  </ul>`);

  lines.push(`<p><strong>宏姿态候选</strong></p>`);
  lines.push(`<ul>
    <li>Top1：${t1.macro}（相似度 ${t1.sim}，距离 ${t1.d}）</li>
    <li>Top2：${t2?.macro || '—'}${t2?`（相似度 ${t2.sim}，距离 ${t2.d}）`:''}</li>
  </ul>`);

  lines.push(`<p class="small-muted">提示：本核心版本仅依据 R/J/E′ 做粗分；完整 15 类需要扩展量表与数据校准。</p>`);

  wrap.innerHTML = lines.join('\n');
  $('#report')?.classList.remove('hidden');
  window.__meaningReport = res;
}

/* ---------- 下载 ---------- */
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'core-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', ()=>{
  // 先绑事件，保证“开始测试”一定可用
  init();
  // 再异步加载配置与题库
  loadAll();
});
