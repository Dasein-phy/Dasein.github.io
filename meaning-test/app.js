/* meaning-test/app.js — 稳健版
 * - 修复：开始按钮不响应、MBTI 无法选择（data-属性不一致）、“未测”开关 id 不一致
 * - 恢复：MBTI 菜单悬停 150ms 开合，点击稳定
 * - 题目：逐题出现 + 自动滚动聚焦
 * - 计分：带符号多维加权（A/C/D/M/S/L），MBTI 弱先验融合
 * - 主题色注入：#718771、#FFD9A3、#73AE52
 */

/* ---------- 路径 ---------- */
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

/* ---------- 全局 ---------- */
let CFG = null, MBTI = null, ITEMS = [];
let ANSWERS = new Map();
let currentIndex = 0;

/* ---------- DOM 工具 ---------- */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

/* ---------- 杂项 ---------- */
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const clip  = (x, lo=1, hi=5) => Math.max(lo, Math.min(hi, x));
const mapLikertToFive = raw => 1 + (raw - 1) * (4/6);
const esc = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
async function tryFetchJSON(path){ try{ const r=await fetch(path); if(!r.ok) throw 0; return await r.json(); }catch{ return null; } }

/* ---------- 主题色注入（全站可复用） ---------- */
function injectThemeColors(){
  const root = document.documentElement;
  root.style.setProperty('--mt-brand',   '#718771');
  root.style.setProperty('--mt-accent',  '#FFD9A3');
  root.style.setProperty('--mt-success', '#73AE52');
  // 兼容旧变量名
  root.style.setProperty('--brand',  '#718771');
  root.style.setProperty('--accent', '#FFD9A3');
}

/* ---------- 安全加载（不阻塞 UI） ---------- */
async function loadAllSafe(){
  try{
    const [cfg, prior] = await Promise.all([
      fetch(cfgPath).then(r=>r.json()),
      fetch(mbtiPriorPath).then(r=>r.json())
    ]);
    CFG = cfg; MBTI = prior;
  }catch(e){
    console.warn('[meaning-test] 配置加载失败：', e);
  }

  // 题库：v2 优先，失败用 v1
  let v2 = await tryFetchJSON(itemsPathV2);
  if(v2 && v2.length){
    ITEMS = v2.map(n=>({
      id:n.id, text:n.text||n.stem||('Q'+n.id), w:(+n.w||1),
      A:+n.A||0, C:+n.C||0, D:+n.D||0, M:+n.M||0, S:+n.S||0, L:+n.L||0
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(v1 && v1.length){
      ITEMS = v1.map(n=>({ id:n.id, text:n.text||n.stem||('Q'+n.id), w:(+n.weight||1), A:0,C:0,D:0,M:0,S:0,L:0 }));
    }else{
      console.warn('[meaning-test] 题库未加载成功。');
      ITEMS = [];
    }
  }
}

/* ---------- 初始化：先绑定事件，再后台加载 ---------- */
function init(){
  injectThemeColors();

  // Start
  const start = $('#startBtn');
  if(start){
    start.addEventListener('click', ()=>{
      $('#intro')?.classList.add('hidden');
      $('#mbti')?.classList.remove('hidden');
      initMBTIDropdowns(); // 每次进入确保事件就绪
    });
  }

  // To Survey
  $('#toSurvey')?.addEventListener('click', ()=>{
    $('#mbti')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
    startProgressiveSurvey();
  });

  // 提交
  $('#submitSurvey')?.addEventListener('click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert('还有题未作答，或题库未加载。'); return; }
    const result = scoreAll(read);
    renderReport(result);
  });

  // 下载/重启
  $('#download')?.addEventListener('click', downloadJSON);
  $('#restart')?.addEventListener('click', ()=>location.reload());

  // 后台加载数据
  loadAllSafe();
}

/* ---------- MBTI：右侧展开（悬停150ms/点击稳定） ---------- */
function initMBTIDropdowns(){
  const rail = $('.mbti-rail');
  if(!rail) return;

  // 兼容外层/内层两种写法：.mbti-item[data-axis] 与 .mbti-select[data-target]
  rail.querySelectorAll('.mbti-item').forEach(item=>{
    const axis = item.getAttribute('data-axis');  // ei/ns/ft/pj
    const sel  = item.querySelector('.mbti-select');
    if(!sel || !axis) return;
    // 给选择器挂 axis，兼容之前只写了 data-target 的情况
    sel.dataset.axis = axis;
    // 准备隐藏 input 与默认文案
    let hid = sel.querySelector('input[type="hidden"]');
    if(!hid){ hid = document.createElement('input'); hid.type='hidden'; hid.id = `mbti-${axis}`; sel.appendChild(hid); }
    const cur = sel.querySelector('.mbti-current');
    if(cur && !cur.textContent.trim()) cur.textContent = '未填';
  });

  // 悬停 150ms 开/合
  const openTimer = new WeakMap(), closeTimer = new WeakMap();
  rail.querySelectorAll('.mbti-select').forEach(sel=>{
    sel.addEventListener('mouseenter', ()=>{
      clearTimeout(closeTimer.get(sel));
      openTimer.set(sel, setTimeout(()=> sel.classList.add('mt-open'), 150));
    });
    sel.addEventListener('mouseleave', ()=>{
      clearTimeout(openTimer.get(sel));
      closeTimer.set(sel, setTimeout(()=> sel.classList.remove('mt-open'), 150));
    });
  });

  // 点击：current 切换开合；点 li 赋值
  rail.addEventListener('click', e=>{
    const cur = e.target.closest('.mbti-current');
    if(cur && rail.contains(cur)){
      const sel = cur.closest('.mbti-select');
      if(sel){
        rail.querySelectorAll('.mbti-select.mt-open').forEach(x=>{ if(x!==sel) x.classList.remove('mt-open'); });
        sel.classList.toggle('mt-open');
      }
      return;
    }
    const li = e.target.closest('.mbti-menu li');
    if(li && rail.contains(li)){
      const sel   = li.closest('.mbti-select');
      const axis  = sel?.dataset.axis || sel?.getAttribute('data-axis') || sel?.getAttribute('data-target');
      const curEl = sel?.querySelector('.mbti-current');
      const hid   = sel?.querySelector('input[type="hidden"]');
      if(!axis || !curEl || !hid) return;
      const v = normalizeMBTIValue(axis, li.getAttribute('data-v'), li.textContent);
      hid.value = v;
      curEl.textContent = (v==='' ? '未填' : v);
      sel.querySelectorAll('.mbti-menu li').forEach(n=>n.classList.remove('is-active'));
      li.classList.add('is-active');
      sel.classList.remove('mt-open');
    }
  });

  // 外部点击收起
  const outside = e=>{ if(!rail.contains(e.target)){ rail.querySelectorAll('.mbti-select.mt-open').forEach(s=>s.classList.remove('mt-open')); } };
  document.removeEventListener('click', outside);
  document.addEventListener('click', outside);

  // “未测”开关：id=mbti-none（修正）
  const untested = $('#mbti-none');
  if(untested){
    untested.addEventListener('change', ()=>{
      const disabled = untested.checked;
      rail.classList.toggle('disabled', disabled);
      rail.querySelectorAll('.mbti-select').forEach(sel=>{
        const curEl = sel.querySelector('.mbti-current');
        const hid   = sel.querySelector('input[type="hidden"]');
        if(disabled){ if(hid) hid.value=''; if(curEl) curEl.textContent='未填'; sel.classList.remove('mt-open'); }
      });
    });
  }
}

// data-v 容错：用文本兜底
function normalizeMBTIValue(axis, dataV, text){
  const v = (dataV||'').trim().toUpperCase();
  if(v) return v;
  const t = (text||'').trim().toUpperCase();
  if(t==='未填' || t==='未選' || t==='未选') return '';
  const allow = { ei:['E','I','X'], ns:['N','S','X'], ft:['F','T','X'], pj:['P','J','X'] }[axis] || [];
  return allow.includes(t) ? t : '';
}

/* ---------- Progressive 问卷 ---------- */
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  form.innerHTML = '';
  $('#submitSurvey')?.closest('.actions')?.style && ($('#submitSurvey').closest('.actions').style.display = 'none');
  renderOneItem(currentIndex);
}

function buildDotScale(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'dot-scale';
  for(let v=1; v<=7; v++){
    const id = `${name}-${v}-${Math.random().toString(36).slice(2,6)}`;
    const label = document.createElement('label'); label.className = 'dot' + (v===4 ? ' dot-center' : '');
    const input = document.createElement('input'); input.type='radio'; input.name=name; input.value=String(v); input.id=id;
    const span  = document.createElement('span');
    label.appendChild(input); label.appendChild(span);
    input.addEventListener('change', ()=> onPick(parseInt(input.value,10)));
    wrap.appendChild(label);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(idx >= ITEMS.length){
    $('#submitSurvey')?.closest('.actions')?.style && ($('#submitSurvey').closest('.actions').style.display = 'flex');
    return;
  }
  const it = ITEMS[idx];
  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);
  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${esc(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;
  const scale = buildDotScale('q'+it.id, async raw=>{
    ANSWERS.set(it.id, raw);
    // 允许改选：不禁用，直接跳到下一题
    await sleep(80);
    currentIndex += 1;
    renderOneItem(currentIndex);
    const last = form.lastElementChild;
    if(last){
      last.scrollIntoView({behavior:'smooth', block:'center'});
      setTimeout(()=>{
        const rect = last.getBoundingClientRect();
        const y = window.scrollY + rect.top - Math.min(120, window.innerHeight*0.15);
        window.scrollTo({top: y, behavior:'smooth'});
      }, 60);
    }
  });
  node.appendChild(scale);
  form.appendChild(node);
}

/* ---------- 读取答案 ---------- */
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

/* ---------- 带符号多维加权（A/C/D/M/S/L） ---------- */
function computeSurveyDims(answers){
  const acc = {A:{num:0,den:0}, C:{num:0,den:0}, D:{num:0,den:0}, M:{num:0,den:0}, S:{num:0,den:0}, L:{num:0,den:0}};
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const w = (typeof it.w === 'number' ? it.w : 1.0);
    [['A',it.A],['C',it.C],['D',it.D],['M',it.M],['S',it.S],['L',it.L]].forEach(([k,coef])=>{
      const c = Number(coef)||0; if(c===0) return;
      const absW = Math.abs(w*c);
      const signed = (c>=0) ? score : (6 - score); // 反向
      acc[k].num += absW * signed; acc[k].den += absW;
    });
  }
  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  return { A_s:clip(avg(acc.A)), C_s:clip(avg(acc.C)), D_s:clip(avg(acc.D)), M_s:clip(avg(acc.M)), S_s:clip(avg(acc.S)), L_s:clip(avg(acc.L)) };
}

/* ---------- MBTI 先验 ---------- */
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = 0.30; if(x>=1) base = 0.20;
  let cert = 1.0; if(x===1) cert=0.67; else if(x===2) cert=0.50; else if(x>=3) cert=0.40;
  return base * cert;
}
function priorsFromProbs(p){
  const {A0,C0,D0} = MBTI.baseline;
  const cA = MBTI.coeff.A, cC = MBTI.coeff.C, cD = MBTI.coeff.D;
  const dNS = (p.N-p.S), dIE=(p.I-p.E), dPJ=(p.P-p.J), dTF=(p.T-p.F);
  let A = A0 + cA["N-S"]*dNS + cA["I-E"]*dIE + cA["P-J"]*dPJ + cA["N*T"]*(p.N*p.T) + cA["S*J"]*(p.S*p.J);
  let C = C0 + cC["J-P"]*(p.J-p.P) + cC["F-T"]*(p.F-p.T) + cC["S-N"]*(p.S-p.N) + cC["I-E"]*dIE + cC["S*J"]*(p.S*p.J);
  let D = D0 + cD["N-S"]*dNS + cD["T-F"]*dTF + cD["P-J"]*dPJ + cD["F*J"]*(p.F*p.J) + cD["N*P"]*(p.N*p.P);
  return {A_p:clip(A), C_p:clip(C), D_p:clip(D)};
}
function readMBTIProbs(){
  // “未测”开关（修正为 #mbti-none）
  if($('#mbti-none')?.checked) return null;

  const readAxis = axis=>{
    const hid = $(`#mbti-${axis}`);
    if(hid) return hid.value || '';
    const cur = $(`.mbti-item[data-axis="${axis}"] .mbti-current`);
    return normalizeMBTIValue(axis, '', cur?.textContent||'');
  };
  const ei = readAxis('ei'), ns = readAxis('ns'), ft = readAxis('ft'), pj = readAxis('pj');
  if(!ei && !ns && !ft && !pj) return null;

  const pairProb = (v,a,b) => v===''?null : (v==='X'?{[a]:.5,[b]:.5} : v===a?{[a]:1,[b]:0} : v===b?{[a]:0,[b]:1}:null);
  const eiP = pairProb(ei,'I','E') || {I:.5,E:.5};
  const nsP = pairProb(ns,'N','S') || {N:.5,S:.5};
  const ftP = pairProb(ft,'F','T') || {F:.5,T:.5};
  const pjP = pairProb(pj,'P','J') || {P:.5,J:.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;
  return {prob:{...eiP,...nsP,...ftP,...pjP}, meta:{xCount, unset}};
}

/* ---------- 融合与判读 ---------- */
const fuse = (p,s,a)=> a*p + (1-a)*s;

function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

  let A_final = dims.A_s, C_final = dims.C_s, D_final = dims.D_s;
  let A_p=null,C_p=null,D_p=null,alpha=0.0;
  if(mbti){
    const pri = priorsFromProbs(mbti.prob);
    A_p = pri.A_p; C_p = pri.C_p; D_p = pri.D_p;
    alpha = alphaFromMBTI(mbti.meta);
    A_final = fuse(A_p, dims.A_s, alpha);
    C_final = fuse(C_p, dims.C_s, alpha);
    D_final = fuse(D_p, dims.D_s, alpha);
  }

  const report = {
    A:+A_final.toFixed(2), C:+C_final.toFixed(2), D:+D_final.toFixed(2),
    M:+dims.M_s.toFixed(2), S:+dims.S_s.toFixed(2), L:+dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  const tLow = 2.5, tMid = 3.5;
  let macro = null;
  if(report.A < tLow){
    macro = (report.C >= 3.5) ? "A1 未触及—高依赖外部建构" : "A0 未触及—低觉察沉浸";
  }else if(report.A >= tMid && report.D >= tMid){
    if(report.S >= 4.0){ macro = "C2 去魅—彻底停滞/冻结（候选）"; }
    else if(report.C <= 3.0 && report.L <= 3.0){ macro = "C1 去魅—理想自由人（候选）"; }
    else{ macro = (report.C <= 2.5) ? "C0 去魅—“解”候选" : "C1/C2 去魅—待细分"; }
  }else if(report.A >= 3.0 && report.D <= tMid){
    if(report.C >= 4.0) macro = "B0 建构—高建构依赖";
    else if(report.C >= 3.0 && report.L <= 3.0) macro = "B1 建构—局部建构（候选）";
    else if(report.C < 2.5 && report.M >= 3.5) macro = "B3 建构—功能主义姿态（候选）";
    else macro = "B2 建构—透明虚构（候选）";
  }else{
    macro = "B2 建构—透明虚构（候选）";
  }
  report.macro_hint = macro;
  return report;
}

/* ---------- 报告 ---------- */
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap = $('#reportContent');
  wrap.innerHTML = `
    <p><strong>六维得分</strong></p>
    <ul>
      <li>觉察 A：${res.A}</li>
      <li>建构依赖 C：${res.C}</li>
      <li>去魅 D：${res.D}</li>
      <li>动因模式 M：${res.M}</li>
      <li>姿态稳定 S：${res.S}</li>
      <li>领域一致 L：${res.L}</li>
    </ul>
    ${res.prior
      ? (()=>{ const dA=Math.abs(res.prior.A_p-res.survey_raw.A_s).toFixed(2);
               const dC=Math.abs(res.prior.C_p-res.survey_raw.C_s).toFixed(2);
               const dD=Math.abs(res.prior.D_p-res.survey_raw.D_s).toFixed(2);
               return `<p>先验影响系数 α=${res.prior.alpha}；先验-问卷差值 |ΔA|=${dA} |ΔC|=${dC} |ΔD|=${dD}</p>` })()
      : `<p>未使用 MBTI 先验。</p>`}
    <p>宏类型初判：<span class="badge">${res.macro_hint}</span></p>
  `;
  $('#report')?.classList.remove('hidden');
  window.__meaningReport = res;
}

/* ---------- 下载 ---------- */
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', ()=>{ init(); });
