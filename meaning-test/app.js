/* meaning-test/app.js — v2 progressive + signed weights */

// ---------- 路径 ----------
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
// 新版题库（含带符号多维加权）
const itemsPathV2 = './items.baseline.v2.json';
// 兼容旧版（如果上面文件不存在，会 fallback）
const itemsPathV1 = './items.baseline.json';

// ---------- 全局状态 ----------
let CFG = null;
let MBTI = null;
let ITEMS = [];       // 统一为 {id, text, w, A,C,D,M,S,L}
let ANSWERS = new Map(); // id -> raw(1..7)
let currentIndex = 0;    // 正在作答的题号索引（0-based）

// ---------- DOM 快捷 ----------
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

// ---------- 工具 ----------
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

// ---------- 加载 ----------
async function tryFetchJSON(path){
  try{
    const r = await fetch(path);
    if(!r.ok) throw new Error(path+' not ok');
    return await r.json();
  }catch(e){
    return null;
  }
}

async function loadAll(){
  const [cfg, prior] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior;

  // 题库优先加载 v2；失败就退回 v1 并做转换
  let v2 = await tryFetchJSON(itemsPathV2);
  if(v2 && Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n=>{
      return {
        id: n.id,
        text: n.text || n.stem || ('Q' + n.id),
        w:   (typeof n.w === 'number' ? n.w : 1.0),
        A: n.A||0, C: n.C||0, D: n.D||0, M: n.M||0, S: n.S||0, L: n.L||0
      };
    });
  }else{
    // fallback：老版结构 items.baseline.json（需有 text/维度标记等）
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!v1) throw new Error('题库加载失败');
    ITEMS = v1.map(n=>{
      // 尽力兼容；没有多维权重时，全部置 0（你也可以在这里临时映射）
      return {
        id: n.id,
        text: n.text || n.stem || ('Q' + n.id),
        w: (typeof n.weight === 'number' ? n.weight : 1.0),
        A: 0, C: 0, D: 0, M: 0, S: 0, L: 0
      };
    });
  }
}

// ---------- 初始化 ----------
function init(){
  // Intro -> MBTI
  $('#startBtn').addEventListener('click', ()=>{
    $('#intro').classList.add('hidden');
    $('#mbti').classList.remove('hidden');
    // MBTI UI 初始化（hover 展开已在 CSS 完成）
    initMBTIUX();
  });

  // MBTI -> Survey
  $('#toSurvey').addEventListener('click', ()=>{
    $('#mbti').classList.add('hidden');
    $('#survey').classList.remove('hidden');
    startProgressiveSurvey();
  });

  // 提交
  $('#submitSurvey').addEventListener('click', ()=>{
    const answers = readSurvey(); // 从 ANSWERS 读
    if(!answers.ok){ alert('还有题未作答。'); return; }
    const result = scoreAll(answers);
    renderReport(result);
  });

  // 下载/重启
  $('#download').addEventListener('click', downloadJSON);
  $('#restart').addEventListener('click', ()=>location.reload());
}

// ---------- MBTI（分离“未测”开关 & 悬停展开保持可点） ----------
function initMBTIUX(){
  // 分离“未测”选择：勾上就禁用四轴；取消就恢复
  const untested = $('#mbti-untested');
  const axisWrap = $('#mbti-axes');
  const inputs = axisWrap ? axisWrap.querySelectorAll('select') : [];
  if(untested){
    untested.addEventListener('change', ()=>{
      inputs.forEach(s=>{
        s.disabled = untested.checked;
        if(untested.checked) s.value = '';
      });
    });
  }

  // 为了“悬停展开后鼠标移走仍可点”：通过 focus-within + 延迟收起实现
  // 这里我们只需给容器加个 data- 属性，CSS 用 :focus-within 控制展开
  // 若你已加对应 CSS，这里不必做更多 JS。
}

// 读取 MBTI 概率（新版来自四个下拉；若“未测”打勾，返回 null）
function readMBTIProbs(){
  const untested = $('#mbti-untested');
  if(untested && untested.checked) return null;

  function val(id){ const el = $(id); return el ? (el.value || '') : ''; }
  const ei = val('#mbti-ei'); // 'E'/'I'/'X'/''
  const ns = val('#mbti-ns');
  const ft = val('#mbti-ft');
  const pj = val('#mbti-pj');

  if(ei==='' && ns==='' && ft==='' && pj==='') return null;

  function pairProb(v, a, b){
    if(v==='') return null;
    if(v==='X') return {[a]:0.5, [b]:0.5};
    if(v===a)  return {[a]:1.0, [b]:0.0};
    if(v===b)  return {[a]:0.0, [b]:1.0};
    return null;
  }
  const eiP = pairProb(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pairProb(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pairProb(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pairProb(pj,'P','J') || {P:0.5,J:0.5};

  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset  = [ei,ns,ft,pj].filter(v=>v==='').length;

  return {prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset}};
}

// ---------- Progressive Survey 渲染 ----------
function startProgressiveSurvey(){
  ANSWERS.clear();
  currentIndex = 0;
  const form = $('#surveyForm');
  form.innerHTML = '';

  // 首题
  renderOneItem(currentIndex);

  // 提交按钮先隐藏
  $('#submitSurvey').closest('.actions').style.display = 'none';
}

// 7点小圆控件（中点略大）
function buildDotScale(name, onPick){
  const wrap = document.createElement('div');
  wrap.className = 'dot-scale';
  for(let v=1; v<=7; v++){
    const id = `${name}-${v}-${Math.random().toString(36).slice(2,6)}`;
    const label = document.createElement('label');
    label.className = 'dot';
    if(v===4) label.classList.add('dot-center');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = String(v);
    input.id = id;
    const span = document.createElement('span'); // 可用于视觉的圆
    label.appendChild(input);
    label.appendChild(span);

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
    // 没题了 → 打开提交
    $('#submitSurvey').closest('.actions').style.display = 'flex';
    return;
  }
  const it = ITEMS[idx];

  const node = document.createElement('div');
  node.className = 'item card slide-in';
  node.setAttribute('data-qid', it.id);

  node.innerHTML = `
    <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
    <div class="scale-hint">
      <span>非常不同意</span>
      <span>非常同意</span>
    </div>
  `;
  const scale = buildDotScale('q'+it.id, raw=>{
    // 锁定本题
    ANSWERS.set(it.id, raw);
    // 禁用本题单选，避免误触
    node.querySelectorAll('input[type="radio"]').forEach(r=>r.disabled = true);
    // 稍作延迟与滑出动画
    requestAnimationFrame(async ()=>{
      await sleep(120);
      currentIndex += 1;
      renderOneItem(currentIndex);
      // 强力滚动：优先滚到新题元素中部；若容器不滚，就用 window.scroll
      const last = form.lastElementChild;
      if(last){
        // 先尝试滚动到中央
        last.scrollIntoView({behavior:'smooth', block:'center'});
        // 保险：再用 window.scrollBy 助推（考虑头图高度）
        setTimeout(()=>{
          const rect = last.getBoundingClientRect();
          const y = window.scrollY + rect.top - Math.min(120, window.innerHeight*0.15);
          window.scrollTo({top: y, behavior: 'smooth'});
  }, 60);
}

    });
  });
  node.appendChild(scale);

  // 挂载
  form.appendChild(node);
}

// ---------- 读取答案 ----------
function readSurvey(){
  if(ANSWERS.size < ITEMS.length){
    return {ok:false};
  }
  // 把 map 转成 {id: raw}
  const out = {};
  for(const it of ITEMS){
    const raw = ANSWERS.get(it.id);
    if(typeof raw !== 'number') return {ok:false};
    out[it.id] = raw;
  }
  return {ok:true, answers: out};
}

// ---------- 计算问卷 6 维（带符号多维加权的加权平均） ----------
function computeSurveyDims(answers){
  const acc = {
    A:{num:0, den:0}, C:{num:0, den:0}, D:{num:0, den:0},
    M:{num:0, den:0}, S:{num:0, den:0}, L:{num:0, den:0}
  };
  for(const it of ITEMS){
    const raw = answers[it.id];
    const score = mapLikertToFive(raw); // 1..5
    const w = (typeof it.w === 'number' ? it.w : 1.0);

    // 对每个维度分别累计（注意：符号只决定“方向”，我们用 abs 进分母以做加权平均）
    [
      ['A',it.A], ['C',it.C], ['D',it.D],
      ['M',it.M], ['S',it.S], ['L',it.L]
    ].forEach(([k,coef])=>{
      const c = Number(coef)||0;
      if(c === 0) return;
      const weightAbs = Math.abs(w * c);
      const signed = (c >= 0) ? score : (6 - score); // 等价于反向：1->5, 5->1（因为范围 1..5）
      acc[k].num += weightAbs * signed;
      acc[k].den += weightAbs;
    });
  }
  function avg(x){ return x.den > 0 ? (x.num / x.den) : 3.0; }
  return {
    A_s: clip(avg(acc.A)), C_s: clip(avg(acc.C)), D_s: clip(avg(acc.D)),
    M_s: clip(avg(acc.M)), S_s: clip(avg(acc.S)), L_s: clip(avg(acc.L))
  };
}

// ---------- MBTI 先验 ----------
function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount; // 未测已过滤
  // 基础上限
  let base = 0.30; // 四轴全定
  if(x >= 1) base = 0.20;
  // 确定性稀释
  let cert = 1.0;
  if(x===1) cert = 0.67;
  else if(x===2) cert = 0.50;
  else if(x>=3) cert = 0.40;
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

// ---------- 融合与判读 ----------
function fuse(prior, survey, alpha){ return alpha*prior + (1-alpha)*survey; }

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
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    M: +dims.M_s.toFixed(2),
    S: +dims.S_s.toFixed(2),
    L: +dims.L_s.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha: +alpha.toFixed(3)} : null,
    survey_raw: dims
  };

  // —— 宏类型初判（遵循你给的优先级）——
  const tLow = 2.5, tMid = 3.5;
  let macro = null;

  if(report.A < tLow){
    macro = (report.C >= 3.5) ? "A1 未触及—高依赖外部建构" : "A0 未触及—低觉察沉浸";
  }else if(report.A >= tMid && report.D >= tMid){
    if(report.S >= 4.0 /* + 行动量题核验：留给后续 */){
      macro = "C2 去魅—彻底停滞/冻结（候选）";
    }else if(report.C <= 3.0 && report.L <= 3.0){
      macro = "C1 去魅—理想自由人（候选）";
    }else{
      macro = (report.C <= 2.5) ? "C0 去魅—“解”候选" : "C1/C2 去魅—待细分";
    }
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

// ---------- 报告 ----------
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

// ---------- 下载 ----------
function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- 启动 ----------
window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();
  init();
});

// ---------- 小工具 ----------
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
}

