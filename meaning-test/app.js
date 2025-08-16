/* meaning-test/app.js — clean MBTI + progressive survey + signed weights (2025-08-16) */

/* ---------- 配置与题库路径 ---------- */
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPathV2 = './items.baseline.v2.json';
const itemsPathV1 = './items.baseline.json';

/* ---------- 全局状态 ---------- */
let CFG = null;
let MBTI = null;
let ITEMS = [];                 // {id, text, w, A,C,D,M,S,L}
let ANSWERS = new Map();        // id -> raw(1..7)
let currentIndex = 0;           // 当前显示到的题目索引（0-based）

/* ---------- DOM helpers ---------- */
const $  = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const on = (el, ev, fn, opt) => el && el.addEventListener(ev, fn, opt);

/* ---------- 小工具 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(String(r.status));
    return await r.json();
  }catch(_){ return null; }
}

/* ---------- 加载 ---------- */
async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior;

  let v2 = await tryFetchJSON(itemsPathV2);
  if(v2 && Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.w === 'number' ? n.w : 1.0),
      A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0
    }));
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!v1) throw new Error('题库加载失败');
    ITEMS = v1.map(n => ({
      id: n.id,
      text: n.text || n.stem || ('Q'+n.id),
      w: (typeof n.weight === 'number' ? n.weight : 1.0),
      A: 0, C: 0, D: 0, M: 0, S: 0, L: 0
    }));
  }
}

/* ---------- 初始化入口 ---------- */
function init(){
  // 起始页 → MBTI
  on($('#startBtn'), 'click', ()=>{
    $('#intro').classList.add('hidden');
    $('#mbti').classList.remove('hidden');
    initMBTIDropdowns();    // 绑定悬停/点击等
  });

  // MBTI → 问卷
  on($('#toSurvey'), 'click', ()=>{
    $('#mbti').classList.add('hidden');
    $('#survey').classList.remove('hidden');
    startProgressiveSurvey();
  });

  // 提交
  on($('#submitSurvey'), 'click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert('还有题未作答。'); return; }
    const res = scoreAll(read);
    renderReport(res);
  });

  // 下载与重启
  on($('#download'), 'click', downloadJSON);
  on($('#restart'),  'click', ()=>location.reload());
}

/* ---------- MBTI 右滑下拉：悬停150ms + 点击选择 + “未测”开关 ---------- */
function initMBTIDropdowns(){
  const rail = $('#mbti .mbti-rail');           // 4 个轴的容器
  const none = $('#mbti-none');                  // “我没有做过 MBTI 测试”
  if(!rail) return;

  // 1) 为每个 .mbti-select 建立隐藏 input 与默认文案
  rail.querySelectorAll('.mbti-select[data-axis]').forEach(sel=>{
    const axis = sel.getAttribute('data-axis'); if(!axis) return;
    let hid = sel.querySelector('input[type="hidden"]');
    if(!hid){
      hid = document.createElement('input');
      hid.type = 'hidden';
      hid.id   = `mbti-${axis}`;    // #mbti-ei / #mbti-ns / #mbti-ft / #mbti-pj
      sel.appendChild(hid);
    }
    const cur = sel.querySelector('.mbti-current');
    if(cur && !cur.textContent.trim()) cur.textContent = '未填';
  });

  // 2) 悬停 150ms 打开、移出 180ms 关闭（不影响点击手动开合）
  const openTimer  = new WeakMap();
  const closeTimer = new WeakMap();
  rail.querySelectorAll('.mbti-select').forEach(sel=>{
    sel.addEventListener('mouseenter', ()=>{
      if(sel.classList.contains('is-disabled')) return;
      clearTimeout(closeTimer.get(sel));
      const t = setTimeout(()=> sel.classList.add('mt-open'), 150);
      openTimer.set(sel, t);
    });
    sel.addEventListener('mouseleave', ()=>{
      clearTimeout(openTimer.get(sel));
      const t = setTimeout(()=> sel.classList.remove('mt-open'), 180);
      closeTimer.set(sel, t);
    });
  });

  // 3) 点击当前项 → 开/收；点击菜单 li → 赋值
  rail.addEventListener('click', (e)=>{
    const cur = e.target.closest('.mbti-current');
    const li  = e.target.closest('.mbti-menu li');
    if(cur){
      const sel = cur.closest('.mbti-select');
      if(!sel || sel.classList.contains('is-disabled')) return;
      sel.classList.toggle('mt-open');
      return;
    }
    if(li){
      const sel   = li.closest('.mbti-select');
      if(!sel || sel.classList.contains('is-disabled')) return;
      const axis  = sel.getAttribute('data-axis');
      const curEl = sel.querySelector('.mbti-current');
      const hid   = sel.querySelector('input[type="hidden"]');
      if(!axis || !curEl || !hid) return;

      const v = normalizeMBTIValue(axis, li.getAttribute('data-v'), li.textContent);
      hid.value = v;
      curEl.textContent = (v==='' ? '未填' : v);

      sel.querySelectorAll('.mbti-menu li').forEach(n=>n.classList.remove('is-active'));
      li.classList.add('is-active');
      sel.classList.remove('mt-open');
    }
  });

  // 4) 点击外部关闭所有
  const outside = (e)=>{
    if(!rail.contains(e.target)){
      rail.querySelectorAll('.mbti-select.mt-open').forEach(s=>s.classList.remove('mt-open'));
    }
  };
  document.removeEventListener('click', outside); // 防止重复绑定
  document.addEventListener('click', outside);

  // 5) “未测”切换：只禁用 .mbti-select（不再禁用整条 rail，避免复选框也失效）
  if(none){
    none.addEventListener('change', ()=>{
      const disabled = !!none.checked;
      rail.querySelectorAll('.mbti-select').forEach(sel=>{
        sel.classList.toggle('is-disabled', disabled);
        if(disabled){
          const hid = sel.querySelector('input[type="hidden"]');
          const cur = sel.querySelector('.mbti-current');
          sel.classList.remove('mt-open');
          if(hid) hid.value = '';
          if(cur) cur.textContent = '未填';
          sel.querySelectorAll('.mbti-menu li').forEach(n=>n.classList.remove('is-active'));
        }
      });
      // 仅视觉弱化容器，不做 pointer-events:none
      rail.classList.toggle('disabled', disabled);
    });
  }
}

function normalizeMBTIValue(axis, dataV, text){
  // 允许 data-v 或 文本作为值；只接受 "", "I/E/X", "N/S/X", "F/T/X", "P/J/X"
  const v = (dataV || (text||'').trim()).toUpperCase();
  const ok = {
    ei: ['','I','E','X'],
    ns: ['','N','S','X'],
    ft: ['','F','T','X'],
    pj: ['','P','J','X']
  }[axis] || [];
  return ok.includes(v) ? v : '';
}

/* ---------- 读取 MBTI 先验 ---------- */
function readMBTIProbs(){
  const none = $('#mbti-none');
  if(none && none.checked) return null;

  const ei = ($('#mbti-ei')?.value || '').toUpperCase();
  const ns = ($('#mbti-ns')?.value || '').toUpperCase();
  const ft = ($('#mbti-ft')?.value || '').toUpperCase();
  const pj = ($('#mbti-pj')?.value || '').toUpperCase();

  if(ei==='' && ns==='' && ft==='' && pj==='') return null;

  const pairProb = (v, a, b)=>{
    if(v==='') return null;
    if(v==='X') return {[a]:0.5, [b]:0.5};
    if(v===a)  return {[a]:1.0, [b]:0.0};
    if(v===b)  return {[a]:0.0, [b]:1.0};
    return null;
  };
  const eiP = pairProb(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pairProb(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pairProb(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pairProb(pj,'P','J') || {P:0.5,J:0.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return {prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset}};
}

/* ---------- Progressive Survey（逐题出现 + 可反悔再选 + 自动滚动） ---------- */
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  form.innerHTML = '';
  // 第一道
  renderOneItem(currentIndex);
  // 提交按钮待全部作完再显示
  const act = $('#submitSurvey')?.closest('.actions');
  if(act) act.style.display = 'none';
}

// 构建 7 点圆点量表（用 .dot-scale，和你 CSS 对上）
function buildDotScale(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'dot-scale';
  for(let v=1; v<=7; v++){
    const id = `${name}-${v}-${Math.random().toString(36).slice(2,7)}`;
    const label = document.createElement('label');
    label.className = 'dot' + (v===4 ? ' dot-center' : '');
    const input = document.createElement('input');
    input.type = 'radio'; input.name = name; input.value = String(v); input.id = id;
    const span  = document.createElement('span');
    label.appendChild(input); label.appendChild(span);

    input.addEventListener('change', ()=>{
      const raw = parseInt(input.value,10);
      onPick(raw);
    });
    wrap.appendChild(label);
  }
  return wrap;
}

function renderOneItem(idx){
  const form = $('#surveyForm');
  if(idx >= ITEMS.length){
    const act = $('#submitSurvey')?.closest('.actions');
    if(act) act.style.display = 'flex';
    return;
  }
  const it = ITEMS[idx];

  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.dataset.qid = it.id;

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>
  `;

  const scale = buildDotScale('q'+it.id, async (raw)=>{
    const firstTime = !ANSWERS.has(it.id);
    ANSWERS.set(it.id, raw);

    // 如果是第一次作答本题 → 弹出下一题并滚动过去
    if(firstTime){
      currentIndex += 1;
      renderOneItem(currentIndex);
      await sleep(40);
      const last = form.lastElementChild;
      if(last){
        last.scrollIntoView({behavior:'smooth', block:'center'});
        setTimeout(()=>{
          const rect = last.getBoundingClientRect();
          const y = window.scrollY + rect.top - Math.min(120, window.innerHeight*0.15);
          window.scrollTo({top:y, behavior:'smooth'});
        }, 60);
      }
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

/* ---------- 计算 6 维（带符号多维加权） ---------- */
function computeSurveyDims(answers){
  const acc = { A:{num:0,den:0}, C:{num:0,den:0}, D:{num:0,den:0}, M:{num:0,den:0}, S:{num:0,den:0}, L:{num:0,den:0} };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw);      // 1..5
    const w = (typeof it.w === 'number' ? it.w : 1.0);

    [['A',it.A],['C',it.C],['D',it.D],['M',it.M],['S',it.S],['L',it.L]].forEach(([k,coef])=>{
      const c = Number(coef)||0; if(c===0) return;
      const weightAbs = Math.abs(w * c);
      const signed = (c >= 0) ? score : (6 - score);  // 反向
      acc[k].num += weightAbs * signed;
      acc[k].den += weightAbs;
    });
  }
  const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
  return {
    A_s: clip(avg(acc.A)), C_s: clip(avg(acc.C)), D_s: clip(avg(acc.D)),
    M_s: clip(avg(acc.M)), S_s: clip(avg(acc.S)), L_s: clip(avg(acc.L))
  };
}

/* ---------- MBTI 先验 ---------- */
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount;
  let base = (x>=1) ? 0.20 : 0.30;
  let cert = 1.0;
  if(x===1) cert=0.67; else if(x===2) cert=0.50; else if(x>=3) cert=0.40;
  return base * cert;
}
function priorsFromProbs(p){
  const {A0,C0,D0} = MBTI.baseline;
  const cA = MBTI.coeff.A, cC = MBTI.coeff.C, cD = MBTI.coeff.D;
  const dNS = (p.N - p.S), dIE = (p.I - p.E), dPJ = (p.P - p.J), dTF = (p.T - p.F);
  let A = A0 + cA["N-S"]*dNS + cA["I-E"]*dIE + cA["P-J"]*dPJ + cA["N*T"]*(p.N*p.T) + cA["S*J"]*(p.S*p.J);
  let C = C0 + cC["J-P"]*(p.J - p.P) + cC["F-T"]*(p.F - p.T) + cC["S-N"]*(p.S - p.N) + cC["I-E"]*dIE + cC["S*J"]*(p.S*p.J);
  let D = D0 + cD["N-S"]*dNS + cD["T-F"]*dTF + cD["P-J"]*dPJ + cD["F*J"]*(p.F*p.J) + cD["N*P"]*(p.N*p.P);
  return {A_p:clip(A), C_p:clip(C), D_p:clip(D)};
}
function fuse(prior, survey, alpha){ return alpha*prior + (1-alpha)*survey; }

/* ---------- 综合评分 + 宏类型提示 ---------- */
function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);

  let A_final=dims.A_s, C_final=dims.C_s, D_final=dims.D_s, A_p=null, C_p=null, D_p=null, alpha=0.0;
  if(mbti){
    const pri = priorsFromProbs(mbti.prob);
    A_p=pri.A_p; C_p=pri.C_p; D_p=pri.D_p;
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

  // 初版规则（和你之前一致）
  const tLow=2.5, tMid=3.5;
  let macro=null;
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
  $('#survey').classList.add('hidden');
  const wrap = $('#reportContent');
  const lines = [];
  lines.push(`<p><strong>六维得分</strong></p>`);
  lines.push(`<ul>
    <li>觉察 A：${res.A}</li>
    <li>建构依赖 C：${res.C}</li>
    <li>去魅 D：${res.D}</li>
    <li>动因模式 M：${res.M}</li>
    <li>姿态稳定 S：${res.S}</li>
    <li>领域一致 L：${res.L}</li>
  </ul>`);
  if(res.prior){
    const dA = Math.abs(res.prior.A_p - res.survey_raw.A_s).toFixed(2);
    const dC = Math.abs(res.prior.C_p - res.survey_raw.C_s).toFixed(2);
    const dD = Math.abs(res.prior.D_p - res.survey_raw.D_s).toFixed(2);
    lines.push(`<p>先验影响系数 α=${res.prior.alpha}；先验-问卷差值 |ΔA|=${dA} |ΔC|=${dC} |ΔD|=${dD}</p>`);
  }else{
    lines.push(`<p>未使用 MBTI 先验。</p>`);
  }
  lines.push(`<p>宏类型初判：<span class="badge">${res.macro_hint}</span></p>`);
  wrap.innerHTML = lines.join('\n');
  $('#report').classList.remove('hidden');
  window.__meaningReport = res;
}

/* ---------- 下载 ---------- */
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json'; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- 启动 ---------- */
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();
  init();
});
