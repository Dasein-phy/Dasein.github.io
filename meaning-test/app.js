
const cfgPath = './app.config.json';
const mbtiPriorPath = './mbti.prior.config.json';
const itemsPath = './items.baseline.json';

let CFG = null;
let MBTI = null;
let ITEMS = [];

const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function mapLikertToFive(raw){
  // raw in 1..7 -> 1..5
  return 1 + (raw - 1) * (4/6);
}
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }

async function loadAll(){
  const [cfg, prior, items] = await Promise.all([
    fetch(cfgPath).then(r=>r.json()),
    fetch(mbtiPriorPath).then(r=>r.json()),
    fetch(itemsPath).then(r=>r.json())
  ]);
  CFG = cfg; MBTI = prior; ITEMS = items;
}

function init(){
  $('#startBtn').addEventListener('click', ()=>{
    $('#intro').classList.add('hidden');
    $('#mbti').classList.remove('hidden');
  });

  $('#toSurvey').addEventListener('click', ()=>{
    $('#mbti').classList.add('hidden');
    $('#survey').classList.remove('hidden');
    renderSurvey();
  });

  $('#submitSurvey').addEventListener('click', ()=>{
    const answers = readSurvey();
    if(!answers.ok){ alert('有题未作答。'); return; }
    const result = scoreAll(answers);
    renderReport(result);
  });

  $('#download').addEventListener('click', downloadJSON);
  $('#restart').addEventListener('click', ()=>location.reload());
}

function readMBTIProbs(){
  // E/I radio
  const ei = [...$$('input[name="ei"]')].find(x=>x.checked)?.value ?? '';
  const ns = $('#ns').value || '';
  const ft = $('#ft').value || '';
  const pj = $('#pj').value || '';

  if(ei==='' && ns==='' && ft==='' && pj===''){
    return null; // untested => no prior
  }
  function pairProb(v, a, b){
    if(v==='') return null; // unknown axis
    if(v==='X') return {[a]:0.5, [b]:0.5};
    if(v===a) return {[a]:1.0, [b]:0.0};
    if(v===b) return {[a]:0.0, [b]:1.0};
    return null;
  }
  const eiP = pairProb(ei,'I','E') || {I:0.5,E:0.5};
  const nsP = pairProb(ns,'N','S') || {N:0.5,S:0.5};
  const ftP = pairProb(ft,'F','T') || {F:0.5,T:0.5};
  const pjP = pairProb(pj,'P','J') || {P:0.5,J:0.5};

  // count X
  const xCount = [ei,ns,ft,pj].filter(v=>v==='X').length;
  const unset = [ei,ns,ft,pj].filter(v=>v==='').length;

  return {prob:{...eiP, ...nsP, ...ftP, ...pjP}, meta:{xCount, unset}};
}

function renderSurvey(){
  const form = $('#surveyForm');
  form.innerHTML = '';
  ITEMS.forEach(item => {
    const node = document.createElement('div');
    node.className = 'item';
    node.innerHTML = `
      <h3>${item.text}</h3>
      <div class="scale">
        <label>非常不同意（1）</label>
        <input type="range" min="1" max="7" step="1" value="4" data-id="${item.id}" />
        <label>非常同意（7）</label>
      </div>
      <div class="badge">维度：${item.dim}${item.reverse?' · 反向':''}</div>
    `;
    form.appendChild(node);
  });
}

function readSurvey(){
  const ranges = $$('input[type="range"][data-id]');
  const answers = {};
  for(const r of ranges){
    const id = r.getAttribute('data-id');
    const raw = parseInt(r.value,10);
    if(isNaN(raw)) return {ok:false};
    answers[id]=raw;
  }
  return {ok:true, answers};
}

function average(arr){ return arr.reduce((a,b)=>a+b,0)/arr.length; }

function computeSurveyDims(answers){
  // map to 1..5 and average per dim
  const dims = {A:[],C:[],D:[]};
  for(const it of ITEMS){
    const raw = answers[it.id];
    let score = mapLikertToFive(raw);
    if(it.reverse) score = mapLikertToFive(8 - raw); // reverse before mapping also works; here compliant with text
    dims[it.dim].push(score * (it.weight||1.0));
  }
  return {
    A_s: average(dims.A),
    C_s: average(dims.C),
    D_s: average(dims.D)
  };
}

function alphaFromMBTI(meta){
  if(!meta) return 0.0;
  const x = meta.xCount + meta.unset; // treat unset as weaker than X? Here merge for simplicity
  let alpha_base = 0.0;
  if(meta.unset===4) return 0.0;
  if(x===0) alpha_base = CFG.alpha_caps.full;
  else alpha_base = CFG.alpha_caps.x;
  // certainty
  let certainty = 1.0;
  if(x===1) certainty = CFG.x_certainty["1"];
  else if(x===2) certainty = CFG.x_certainty["2"];
  else if(x>=3) certainty = CFG.x_certainty["3plus"];
  return alpha_base * certainty;
}

function priorsFromProbs(p){
  const {A0,C0,D0} = MBTI.baseline;
  const cA = MBTI.coeff.A, cC = MBTI.coeff.C, cD = MBTI.coeff.D;
  // helpers
  const dNS = (p.N - p.S), dIE = (p.I - p.E), dPJ = (p.P - p.J), dTF = (p.T - p.F);
  // A
  let A = A0 + cA["N-S"]*dNS + cA["I-E"]*dIE + cA["P-J"]*dPJ + cA["N*T"]*(p.N*p.T) + cA["S*J"]*(p.S*p.J);
  // C
  let C = C0 + cC["J-P"]*(p.J - p.P) + cC["F-T"]*(p.F - p.T) + cC["S-N"]*(p.S - p.N) + cC["I-E"]*dIE + cC["S*J"]*(p.S*p.J);
  // D
  let D = D0 + cD["N-S"]*dNS + cD["T-F"]*dTF + cD["P-J"]*dPJ + cD["F*J"]*(p.F*p.J) + cD["N*P"]*(p.N*p.P);
  return {A_p:clip(A), C_p:clip(C), D_p:clip(D)};
}

function fuse(prior, survey, alpha){
  return alpha*prior + (1-alpha)*survey;
}

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
  // 简化：此原型不含 S/L/M 分量，后续分支题库接入时再扩展
  const report = {
    A: +A_final.toFixed(2),
    C: +C_final.toFixed(2),
    D: +D_final.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha: +alpha.toFixed(3)} : null,
    survey_raw: dims
  };
  // 粗略宏类型判定（示例）
  const tLow = CFG.thresholds.low, tMid = CFG.thresholds.mid;
  let macro = null;
  if(report.A < tLow){
    macro = (report.C >= tMid) ? "A1 未触及—高依赖外部建构" : "A0 未触及—低觉察沉浸";
  }else if(report.A >= tMid && report.D >= tMid){
    macro = (report.C <= tLow) ? "C0 去魅—“解”候选" : "C1/C2 去魅—待细分";
  }else if(report.A >= 3.0 && report.D <= tMid){
    if(report.C >= 4.0) macro = "B0 建构—高建构依赖";
    else if(report.C >= 3.0) macro = "B1 建构—局部建构（候选）";
    else macro = "B3 建构—功能主义姿态（候选）";
  }else{
    macro = "B2 建构—透明虚构（候选）";
  }
  report.macro_hint = macro;
  return report;
}

function renderReport(res){
  $('#survey').classList.add('hidden');
  const wrap = $('#reportContent');
  const lines = [];
  lines.push(`<p><strong>六维（当前原型仅三维）</strong></p>`);
  lines.push(`<ul>
    <li>觉察 A：${res.A}</li>
    <li>建构依赖 C：${res.C}</li>
    <li>去魅 D：${res.D}</li>
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
  // store
  window.__meaningReport = res;
}

function downloadJSON(){
  const data = window.__meaningReport || {};
  const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'meaning-test-result.json';
  a.click();
  URL.revokeObjectURL(url);
}

window.addEventListener('DOMContentLoaded', async ()=>{
  await loadAll();
  init();
});
