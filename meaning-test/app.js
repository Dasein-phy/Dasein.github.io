/* =========================================================
   意义姿态测试 app.js — baseline 纯净版（仅基线，不含支线/CORE）
   - 题库（v2/v1）统一解析 weights
   - Progressive 渐进出题 + 可控打散
   - MBTI 右侧卡片式菜单
   - 计分：多维加权 + M_func/M_aff + L 的矛盾惩罚
   - 15类宏姿态判读（你最新的命名）
   ========================================================= */

/* ---------- 资源路径 ---------- */
const cfgPath        = './app.config.json';
const mbtiPriorPath  = './mbti.prior.config.json';
const itemsPathV2    = './items.baseline.v2.json';
const itemsPathV1    = './items.baseline.json';

/* ---------- 全局状态 ---------- */
let CFG  = null;
let MBTI = null;
let ITEMS = [];                        // 统一后的题库
const ANSWERS = new Map();             // 用“索引键”q_0, q_1 存
let currentIndex = 0;

/* ---------- DOM 快捷 ---------- */
const $  = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

/* ---------- 工具 ---------- */
function mapLikertToFive(raw){ return 1 + (raw - 1) * (4/6); }
function clip(x, lo=1, hi=5){ return Math.max(lo, Math.min(hi, x)); }
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
async function tryFetchJSON(path){
  try{ const r = await fetch(path); if(!r.ok) throw 0; return await r.json(); }
  catch{ return null; }
}

/* ====================== 加载题库（v2 优先） ====================== */
async function loadAll(){
  const [cfg, prior] = await Promise.all([ tryFetchJSON(cfgPath), tryFetchJSON(mbtiPriorPath) ]);
  CFG  = cfg || {};
  MBTI = prior || {};

  const v2 = await tryFetchJSON(itemsPathV2);
  if (Array.isArray(v2) && v2.length){
    ITEMS = v2.map(n=>{
      const w = n.weights || {};
      return {
        id: n.id,
        text: n.text || n.stem || ('Q'+n.id),
        w: (typeof n.w==='number' ? n.w : 1.0),
        A:+w.A||0, C:+w.C||0, D:+w.D||0, S:+w.S||0, L:+w.L||0,
        M_func:+w.M_func||0, M_aff:+w.M_aff||0,
        meta:{ is_attention: !!n.is_attention, duplicate_of: n.duplicate_of || null }
      };
    });

    // —— 主维分桶 → 可复现打散 → 轮盘交错 —— //
    const buckets = {A:[],C:[],D:[],M:[],S:[],L:[]};
    ITEMS.forEach(it=>{
      const absMap = {
        A:Math.abs(it.A), C:Math.abs(it.C), D:Math.abs(it.D),
        M:Math.max(Math.abs(it.M_func||0), Math.abs(it.M_aff||0)),
        S:Math.abs(it.S), L:Math.abs(it.L)
      };
      let dom='A', mx=absMap.A;
      for(const k of ['C','D','M','S','L']){ if(absMap[k]>mx){ dom=k; mx=absMap[k]; } }
      buckets[dom].push(it);
    });
    const seed = (new URL(location.href)).searchParams.get('seed') || 'mt-seed';
    function seededShuffle(arr, s){
      let h=2166136261; for(const ch of s){ h ^= ch.charCodeAt(0); h=Math.imul(h,16777619); }
      const out = arr.slice();
      for(let i=out.length-1;i>0;i--){
        h^=(h<<13); h^=(h>>>7); h^=(h<<17);
        const j = Math.abs(h)%(i+1);
        [out[i],out[j]]=[out[j],out[i]];
      }
      return out;
    }
    for(const k in buckets){ buckets[k]=seededShuffle(buckets[k], seed+'-'+k); }
    const order=[], keys=['A','C','D','M','S','L']; let has=true, p=0;
    while(has){
      has=false;
      for(let s=0;s<keys.length;s++){
        const k=keys[(p+s)%keys.length];
        if(buckets[k].length){ order.push(buckets[k].shift()); has=true; }
      }
      p++;
    }
    ITEMS = order;
  }else{
    const v1 = await tryFetchJSON(itemsPathV1);
    if(!Array.isArray(v1) || !v1.length) throw new Error('题库加载失败');
    ITEMS = v1.map(n=>({ id:n.id, text:n.text||n.stem||('Q'+n.id), w:(typeof n.w==='number'?n.w:1.0),
      A:0,C:0,D:0,S:0,L:0,M_func:0,M_aff:0 }));
  }
}

/* ====================== 导航/按钮 ====================== */
function init(){
  $('#startBtn')?.addEventListener('click', ()=>{
    $('#intro')?.classList.add('hidden');
    $('#mbti')?.classList.remove('hidden');
    initMBTIDropdowns();
  });
  $('#toSurvey')?.addEventListener('click', ()=>{
    $('#mbti')?.classList.add('hidden');
    $('#survey')?.classList.remove('hidden');
    startProgressiveSurvey();
  });
  $('#submitSurvey')?.addEventListener('click', ()=>{
    const read = readSurvey();
    if(!read.ok){ alert(read.reason || '还有题未作答。'); return; }
    const result = scoreAll(read);
    renderReport(result);
  });
  $('#download')?.addEventListener('click', downloadJSON);
  $('#restart')?.addEventListener('click', ()=>location.reload());
}

/* ====================== MBTI 交互 ====================== */
function initMBTIDropdowns(){
  const rail = $('.mbti-rail'); if(!rail) return;
  const selects = $$('.mbti-select', rail);
  selects.forEach(sel=>{
    let openTimer=null, closeTimer=null;
    const cur=$('.mbti-current', sel), menu=$('.mbti-menu', sel);
    sel.addEventListener('mouseenter', ()=>{ clearTimeout(closeTimer); openTimer=setTimeout(()=>sel.classList.add('mt-open'),150); });
    sel.addEventListener('mouseleave', ()=>{ clearTimeout(openTimer);  closeTimer=setTimeout(()=>sel.classList.remove('mt-open'),160); });
    cur?.addEventListener('click', ()=>{ clearTimeout(closeTimer); sel.classList.add('mt-open'); });
    menu?.addEventListener('click', e=>{
      const li = e.target.closest('li[data-v]'); if(!li) return;
      const v = li.getAttribute('data-v') || ''; sel.dataset.value=v;
      $$('.mbti-menu li', sel).forEach(x=>x.classList.remove('is-active')); li.classList.add('is-active');
      if(cur) cur.textContent = (v===''?'未填':v); sel.classList.remove('mt-open');
    });
  });
  $('#mbti-none')?.addEventListener('change', e=>{
    const dis = e.target.checked;
    selects.forEach(sel=>{
      sel.classList.toggle('is-disabled', dis);
      if(dis){ sel.dataset.value=''; const cur=$('.mbti-current', sel); if(cur) cur.textContent='未填';
        $$('.mbti-menu li', sel).forEach(x=>x.classList.remove('is-active')); }
    });
  });
}
function readMBTIProbs(){
  const untested=$('#mbti-none'); if(untested && untested.checked) return null;
  const get=a=>($(`.mbti-select[data-target="${a}"]`)?.dataset.value || '');
  const ei=get('ei'), ns=get('ns'), ft=get('ft'), pj=get('pj');
  if(ei===''&&ns===''&&ft===''&&pj==='') return null;
  const pair=(v,a,b)=> v===''?null : (v==='X'?{[a]:.5,[b]:.5} : (v===a?{[a]:1,[b]:0}:{[a]:0,[b]:1}));
  const eiP=pair(ei,'I','E')||{I:.5,E:.5}, nsP=pair(ns,'N','S')||{N:.5,S:.5},
        ftP=pair(ft,'F','T')||{F:.5,T:.5}, pjP=pair(pj,'P','J')||{P:.5,J:.5};
  const xCount=[ei,ns,ft,pj].filter(v=>v==='X').length, unset=[ei,ns,ft,pj].filter(v=>v==='').length;
  return { prob:{...eiP,...nsP,...ftP,...pjP}, meta:{xCount, unset} };
}

/* ====================== 问卷出题 ====================== */
function startProgressiveSurvey(){
  ANSWERS.clear(); currentIndex=0;
  const form=$('#surveyForm'); if(form) form.innerHTML='';
  const actions = $('#submitSurvey')?.closest('.actions'); if(actions) actions.style.display='none';
  renderOneItem(0);
}
function buildLikert7(name, onPick){
  const wrap=document.createElement('div'); wrap.className='likert7';
  for(let v=1; v<=7; v++){
    const opt=document.createElement('label'); opt.className='likert-option'+(v===4?' is-center':'');
    const input=document.createElement('input'); input.type='radio'; input.name=name; input.value=String(v);
    const dot=document.createElement('span'); dot.className='likert-dot';
    opt.appendChild(input); opt.appendChild(dot);
    input.addEventListener('change', ()=>{
      wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
      opt.classList.add('is-selected','tapped'); setTimeout(()=>opt.classList.remove('tapped'),130);
      onPick(parseInt(input.value,10));
    });
    wrap.appendChild(opt);
  }
  return wrap;
}
function renderOneItem(idx){
  const form=$('#surveyForm'); if(!form) return;
  if(idx>=ITEMS.length){ const actions=$('#submitSurvey')?.closest('.actions'); if(actions) actions.style.display='flex'; return; }
  if(form.querySelector(`[data-q-idx="${idx}"]`)) return;

  const it=ITEMS[idx];
  const node=document.createElement('div');
  node.className='item card slide-in'; node.setAttribute('data-qid', it.id); node.setAttribute('data-q-idx', idx);
  node.innerHTML=`<h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
                  <div class="scale-hint"><span>非常不同意</span><span>非常同意</span></div>`;
  const scale=buildLikert7('q'+it.id, raw=>{
    ANSWERS.set(`q_${idx}`, raw);
    if(node.getAttribute('data-next-spawned')!=='1'){
      node.setAttribute('data-next-spawned','1');
      const nextIdx=idx+1; renderOneItem(nextIdx);
      const nextEl=form.querySelector(`[data-q-idx="${nextIdx}"]`); if(nextEl){ setTimeout(()=>nextEl.scrollIntoView({behavior:'smooth',block:'center'}),60); }
    }
  });
  node.appendChild(scale); form.appendChild(node);
}
function readSurvey(){
  if(ANSWERS.size<ITEMS.length) return {ok:false, reason:`未答数量 ≈ ${ITEMS.length-ANSWERS.size}`};
  const arr=new Array(ITEMS.length);
  for(let i=0;i<ITEMS.length;i++){
    const v=ANSWERS.get(`q_${i}`); if(typeof v!=='number') return {ok:false, reason:`第 ${i+1} 题缺失`};
    arr[i]=v;
  }
  return {ok:true, answers:arr};
}

/* ====================== 计分与判读（基线） ====================== */
function computeSurveyDims(answers){
  const acc={A:{num:0,den:0},C:{num:0,den:0},D:{num:0,den:0},S:{num:0,den:0},L:{num:0,den:0},M_func:{num:0,den:0},M_aff:{num:0,den:0}};
  for(let i=0;i<ITEMS.length;i++){
    const it=ITEMS[i], raw=answers[i], score=mapLikertToFive(raw), baseW=(typeof it.w==='number'?it.w:1);
    const accOne=(k,c)=>{ c=+c||0; if(!c) return; const w=Math.abs(baseW*c); const s=(c>=0)?score:(6-score); acc[k].num+=w*s; acc[k].den+=w; };
    accOne('A',it.A); accOne('C',it.C); accOne('D',it.D); accOne('S',it.S); accOne('L',it.L); accOne('M_func',it.M_func); accOne('M_aff',it.M_aff);
  }
  const avg=x=>x.den>0?(x.num/x.den):3.0;
  const m_func=clip(avg(acc.M_func)), m_aff=clip(avg(acc.M_aff)), M_s=Math.max(m_func,m_aff);
  return { A_s:clip(avg(acc.A)), C_s:clip(avg(acc.C)), D_s:clip(avg(acc.D)), S_s:clip(avg(acc.S)), L_s:clip(avg(acc.L)),
           M_s, M_detail:{m_func, m_aff} };
}
function computeAmbivalenceFromAnswers(answers){
  const dims=['A','C','D'], agg={}; dims.forEach(k=>agg[k]={pos:{num:0,den:0},neg:{num:0,den:0}});
  for(let i=0;i<ITEMS.length;i++){
    const it=ITEMS[i], raw=answers[i], score=mapLikertToFive(raw), w=(typeof it.w==='number'?it.w:1);
    for(const k of dims){
      const c=+it[k]||0; if(!c) continue; const W=Math.abs(w*c); const s=(c>=0)?score:(6-score);
      if(c>=0){ agg[k].pos.num+=W*s; agg[k].pos.den+=W; } else { agg[k].neg.num+=W*s; agg[k].neg.den+=W; }
    }
  }
  const res={}, list=[];
  dims.forEach(k=>{
    const pos=agg[k].pos.den>0?(agg[k].pos.num/agg[k].pos.den):3, neg=agg[k].neg.den>0?(agg[k].neg.num/agg[k].neg.den):3;
    const amb=Math.min(Math.max(0,(pos-3)/2),1) * Math.min(Math.max(0,(neg-3)/2),1);
    res[k]={pos:+pos.toFixed(2),neg:+neg.toFixed(2),amb:+amb.toFixed(3)}; list.push(amb);
  });
  const ci=list.length?(list.reduce((a,b)=>a+b,0)/list.length):0;
  return { byDim:res, ci:+ci.toFixed(3) };
}
/* --- MBTI 先验 --- */
function alphaFromMBTI(meta){ if(!meta) return 0.0; const x=meta.xCount||0; const base=(x>=1)?0.20:0.30; const cert=x===1?0.67:(x===2?0.50:(x>=3?0.40:1)); return base*cert; }
function priorsFromProbs(p){
  if(!MBTI||!MBTI.baseline||!MBTI.coeff) return {A_p:3,C_p:3,D_p:3};
  const {A0,C0,D0}=MBTI.baseline, cA=MBTI.coeff.A||{}, cC=MBTI.coeff.C||{}, cD=MBTI.coeff.D||{}, g=(o,k)=>Number(o?.[k]??0);
  const dNS=(p.N-p.S), dIE=(p.I-p.E), dPJ=(p.P-p.J), dTF=(p.T-p.F);
  let A=A0 + g(cA,"N-S")*dNS + g(cA,"I-E")*dIE + g(cA,"P-J")*dPJ + g(cA,"N*T")*(p.N*p.T) + g(cA,"S*J")*(p.S*p.J);
  let C=C0 + g(cC,"J-P")*(p.J-p.P) + g(cC,"F-T")*(p.F-p.T) + g(cC,"S-N")*(p.S-p.N) + g(cC,"I-E")*dIE + g(cC,"S*J")*(p.S*p.J);
  let D=D0 + 0.5*( g(cD,"N-S")*dNS + g(cD,"T-F")*dTF + g(cD,"P-J")*dPJ + g(cD,"F*J")*(p.F*p.J) + g(cD,"N*P")*(p.N*p.P) );
  return {A_p:clip(A), C_p:clip(C), D_p:clip(D)};
}
function checkAttention(ansMapByIndex){
  const byId = new Map();  // 将索引→id 再映射不现实；直接宽松检测：若存在 id=81/82 且作答，验证
  // 放宽处理：只要问卷里确实包含81/82并作答就校验；否则跳过
  let ok=true, reason=[];
  // 这里无法索引到具体 id，保留“通过/未知”语义
  return { ok, reason };
}
function classifyMacro(r){
  const A=r.A, C=r.C, D=r.D, S=r.S, L=r.L, M=r.M, Mf=r.M_func, Ma=r.M_aff;
  if (A>=3.5 && D>=3.8 && S<=2.8 && M<=3.0) return {macro:"C2 停滞冻结姿态", reason:"A高D高S低M低"};
  if (A>=3.6 && D>=3.4 && C<=3.2 && S>=3.0) return {macro:"C1 反身介入姿态", reason:"高反身低依附"};
  if (D>=3.5 && C<=2.7 && Math.max(Mf,Ma)<=3.2) return {macro:"C0 去建构姿态", reason:"高去魅低建构"};
  if (A>=2.5 && A<3.0 && D>=3.6 && C<=3.0)  return {macro:"C3 去魅萌发姿态", reason:"A过渡带且D高C低"};
  if (Mf>=3.8 && D<=3.4 && C>=3.0)          return {macro:"B3 功能主义姿态", reason:"功能驱动高"};
  if (Mf>=3.8 && C>=3.5 && S>=3.5 && D<=3.2)return {macro:"E0 义务契约姿态", reason:"责任/契约信号"};
  if (Ma>=3.8 && C<=3.2 && D<=3.4)          return {macro:"E1 享乐幸福姿态", reason:"情感/幸福驱动"};
  if (D>=3.8 && C<=3.2 && A>=3.2)           return {macro:"D1 荒诞反抗姿态", reason:"高去魅+能动"};
  if (Ma>=3.8 && D>=3.2 && D<=3.8 && C>=2.6 && C<=3.6) return {macro:"D0 审美姿态", reason:"高感受+中度去魅"};
  if (C>=4.0 || (C>=3.8 && S>=3.5 && D<=3.2)) return {macro:"B0 高建构依赖姿态", reason:"建构依赖高"};
  if (C>=3.2 && L<=3.0)                       return {macro:"B1 局部建构姿态", reason:"建构依赖且跨域不一致"};
  if (A>=3.0 && C>=3.0 && D>=3.0)             return {macro:"B2 透明虚构姿态", reason:"自知其构而仍用"};
  if (A<2.5 && C>=3.5)                        return {macro:"A1 外部建构依赖姿态", reason:"低觉察+高依附"};
  if (A<2.5)                                   return {macro:"A0 低觉察沉浸姿态",   reason:"低觉察"};
  if (S<=2.6 && L<=2.8)                       return {macro:"F0 动态混合姿态", reason:"低稳定且低一致"};
  return {macro:"F0 动态混合姿态", reason:"多信号并存/边界"};
}
function scoreAll(read){
  const mbti = readMBTIProbs();
  const dims = computeSurveyDims(read.answers);
  const amb = computeAmbivalenceFromAnswers(read.answers);
  const L_adj = clip(dims.L_s - 1.2*(amb.ci||0), 1, 5);

  // 先验融合
  let A_final=dims.A_s, C_final=dims.C_s, D_final=dims.D_s;
  let A_p=null, C_p=null, D_p=null, alpha=0.0;
  if(mbti && MBTI?.baseline){
    const pri = priorsFromProbs(mbti.prob);
    A_p=pri.A_p; C_p=pri.C_p; D_p=pri.D_p;
    // 更保守：依据填写完整度/X数量/稳定一致性/矛盾噪声
    const fill=(4-Math.min(4, mbti.meta?.unset||0))/4;
    const xpen=[1,0.67,0.50,0.40][Math.min(3, mbti.meta?.xCount||0)];
    const reliability=Math.max(0, Math.min(1, (dims.S_s+L_adj)/10 ));
    const noisiness=0.5 + 0.5*Math.max(0,Math.min(1, amb.ci||0));
    alpha=Math.min(0.25, 0.25*fill*xpen*(1-0.6*reliability)*noisiness);
    A_final = alpha*A_p + (1-alpha)*dims.A_s;
    C_final = alpha*C_p + (1-alpha)*dims.C_s;
    D_final = alpha*D_p + (1-alpha)*dims.D_s; // D 的先验已半幅收敛
  }

  const M_func = dims.M_detail?.m_func ?? dims.M_s;
  const M_aff  = dims.M_detail?.m_aff  ?? dims.M_s;
  const M_show = Math.max(M_func, M_aff);

  const report = {
    A:+A_final.toFixed(2), C:+C_final.toFixed(2), D:+D_final.toFixed(2),
    M:+M_show.toFixed(2), M_func:+M_func.toFixed(2), M_aff:+M_aff.toFixed(2),
    S:+dims.S_s.toFixed(2), L:+L_adj.toFixed(2),
    prior: mbti ? {A_p, C_p, D_p, alpha:+alpha.toFixed(3)} : null,
    ambivalence: amb,
    survey_raw: {...dims, L_s_raw:dims.L_s}
  };
  const pick = classifyMacro(report);
  report.macro_hint = pick.macro; report.macro_reason = pick.reason;
  return report;
}

/* ====================== 报告渲染 & 下载 ====================== */
function renderReport(res){
  $('#survey')?.classList.add('hidden');
  const wrap=$('#reportContent'); if(!wrap) return;
  const lines=[];
  lines.push(`<p><strong>六维得分</strong></p>`);
  lines.push(`<ul>
    <li>觉察 A：${res.A}</li>
    <li>建构依赖 C：${res.C}</li>
    <li>去魅 D：${res.D}</li>
    <li>动因模式 M：${res.M} <span style="color:#888">(功能 ${res.M_func} / 情感 ${res.M_aff})</span></li>
    <li>姿态稳定 S：${res.S}</li>
    <li>领域一致 L：${res.L}</li>
  </ul>`);
  if(res.prior){
    const dA=Math.abs(res.prior.A_p-(res.survey_raw?.A_s??res.A)).toFixed(2);
    const dC=Math.abs(res.prior.C_p-(res.survey_raw?.C_s??res.C)).toFixed(2);
    const dD=Math.abs(res.prior.D_p-(res.survey_raw?.D_s??res.D)).toFixed(2);
    lines.push(`<p>先验影响系数 α=${res.prior.alpha}；先验-问卷差值 |ΔA|=${dA} |ΔC|=${dC} |ΔD|=${dD}</p>`);
    const ci=(res.ambivalence && typeof res.ambivalence.ci==='number')?res.ambivalence.ci.toFixed(3):'—';
    lines.push(`<p style="color:#6b7280">透明说明：矛盾指数 ci=${ci}。<br><small>注：为避免过度拉动，“去魅 D”的 MBTI 先验以 0.5× 力度参与融合。</small></p>`);
  }else{
    lines.push(`<p>未使用 MBTI 先验。</p>`);
  }
  lines.push(`<p>宏类型初判：<span class="badge">${res.macro_hint}</span>${
    res.macro_reason?` <span style="color:#888">（依据：${res.macro_reason}）</span>`:''}</p>`);
  wrap.innerHTML=lines.join('\n'); $('#report')?.classList.remove('hidden');
  window.__meaningReport=res;
}
function downloadJSON(){
  const data=window.__meaningReport||{}; const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='meaning-test-result.json'; a.click(); URL.revokeObjectURL(url);
}

/* ====================== 启动 ====================== */
window.addEventListener('DOMContentLoaded', async ()=>{ await loadAll(); init(); });

