/* Core model JS（逐题推进，一题作答→出现下一题） */
(async function(){
  const cfgURL   = './app.core.config.json';
  const itemsURL = './items.core.v1.json';

  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const mapLikertToFive = raw => 1 + (raw - 1) * (4/6);
  const clip = (x, lo=1, hi=5)=> Math.max(lo, Math.min(hi, x));

  let CFG=null, ITEMS=[];

  async function loadJSON(url){
    const r = await fetch(url);
    if(!r.ok) throw new Error('load fail: ' + url);
    return await r.json();
  }

  async function boot(){
    try{
      [CFG, ITEMS] = await Promise.all([loadJSON(cfgURL), loadJSON(itemsURL)]);
      initUI();
    }catch(err){
      alert('Core 加载失败：' + err.message);
      console.error(err);
    }
  }

  function initUI(){
    const btnStart   = $('#coreStartBtn');
    const btnSubmit  = $('#coreSubmitBtn');
    const btnRestart = $('#coreRestartBtn');

    btnStart?.addEventListener('click', ()=>{
      $('#coreIntro').classList.add('hidden');
      $('#coreSurvey').classList.remove('hidden');
      startSurvey();
    });
    btnRestart?.addEventListener('click', ()=> location.reload());
    btnSubmit?.addEventListener('click', onSubmit);
  }

  const ANSWERS = new Map();
  let ordered = [];

  function startSurvey(){
    // 交错 R/J/E，保证分布均衡
    const buckets = {R:[],J:[],E:[]};
    ITEMS.forEach(it=>{
      const w = it.weights || {};
      const abs = {R:Math.abs(w.R||0), J:Math.abs(w.J||0), E:Math.abs(w.E||0)};
      let k='R', m=abs.R;
      for(const kk of ['J','E']){ if(abs[kk] > m){ k=kk; m=abs[kk]; } }
      buckets[k].push(it);
    });

    const seed = 'core-seed';
    function shuffle(arr, s){
      let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
      const out=arr.slice();
      for(let i=out.length-1;i>0;i--){
        h ^= (h<<13); h ^= (h>>>7); h ^= (h<<17);
        const j = Math.abs(h) % (i+1);
        [out[i],out[j]]=[out[j],out[i]];
      }
      return out;
    }
    for(const k in buckets) buckets[k] = shuffle(buckets[k], seed + '-' + k);

    const keys=['R','J','E'];
    let p=0, has=true; ordered=[];
    while(has){
      has=false;
      for(let step=0;step<keys.length;step++){
        const k=keys[(p+step)%keys.length];
        if(buckets[k].length){
          ordered.push(buckets[k].shift());
          has=true;
        }
      }
      p++;
    }

    $('#coreProgress').textContent = `0 / ${ordered.length}`;
    $('#coreForm').innerHTML = '';
    renderItem(0);
  }

  function buildLikert7(name, onPick){
    const wrap = document.createElement('div');
    wrap.className = 'likert7';
    for(let v=1; v<=7; v++){
      const opt = document.createElement('label');
      opt.className = 'likert-option' + (v===4 ? ' is-center':'');
      const input = document.createElement('input');
      input.type='radio'; input.name=name; input.value=String(v);
      input.style.display='none';
      const dot = document.createElement('span'); dot.className='likert-dot';
      opt.appendChild(input); opt.appendChild(dot);
      input.addEventListener('change', ()=>{
        wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected'));
        opt.classList.add('is-selected');
        onPick(parseInt(input.value,10));
      });
      wrap.appendChild(opt);
    }
    return wrap;
  }

  function renderItem(idx){
    const form = $('#coreForm');
    if(!form) return;
    const total = ordered.length;
    if(idx >= total){
      $('#coreActions').classList.remove('hidden');
      return;
    }
    if(form.querySelector(`[data-idx="${idx}"]`)) return;

    const it = ordered[idx];
    const node = document.createElement('div');
    node.className = 'item card';
    node.setAttribute('data-idx', idx);
    node.innerHTML = `
      <h3 class="q-title">Q${idx+1}. ${escapeHTML(it.text)}</h3>
      <div class="scale-hint"><span>${CFG.ui.leftLabel}</span><span>${CFG.ui.rightLabel}</span></div>
    `;
    const scale = buildLikert7('q'+it.id, raw=>{
      ANSWERS.set(it.id, raw);
      $('#coreProgress').textContent = `${ANSWERS.size} / ${total}`;
      if(node.getAttribute('data-next')!=='1'){
        node.setAttribute('data-next','1');
        renderItem(idx+1);
        node.scrollIntoView({behavior:'smooth', block:'center'});
      }
    });
    node.appendChild(scale);
    form.appendChild(node);
  }

  function onSubmit(e){
    e.preventDefault();
    if(ANSWERS.size < ordered.length){
      alert('还有题未作答。'); return;
    }
    const res = estimate_theta_core(collectAnswers());
    const cls = classify_core(res);
    renderReport(res, cls);
  }

  function collectAnswers(){
    const out={};
    for(const it of ordered){ out[it.id] = ANSWERS.get(it.id); }
    return out;
  }

  function estimate_theta_core(answers){
    const acc = {R:{num:0,den:0}, J:{num:0,den:0}, E:{num:0,den:0}};
    for(const it of ITEMS){
      const raw = answers[it.id];
      if(typeof raw!=='number') continue;
      const score = mapLikertToFive(raw);
      const w = (typeof it.w==='number') ? it.w : 1.0;
      const ws = it.weights || {};
      for(const k of ['R','J','E']){
        const c = Number(ws[k]||0);
        if(!c) continue;
        const weight = Math.abs(w*c);
        const signed = (c>=0) ? score : (6 - score);
        acc[k].num += weight * signed;
        acc[k].den += weight;
      }
    }
    const avg = x => x.den>0 ? (x.num/x.den) : 3.0;
    const R = clip(avg(acc.R)), J = clip(avg(acc.J)), E = clip(avg(acc.E));
    const beta = (CFG.scoring && typeof CFG.scoring.beta_RE==='number') ? CFG.scoring.beta_RE : 0.65;
    const Eprime = clip(E - beta*R);
    return { R, J, E, Eprime };
  }

  function classify_core(theta){
    const z = {
      R: (theta.R - 1)/4,
      J: (theta.J - 1)/4,
      E: (theta.Eprime - 1)/4
    };
    const W = CFG.distanceWeights || {R:0.5,J:1.0,E:0.8};
    const P = CFG.prototypes || {};
    const arr=[];
    for(const k in P){
      const c = P[k];
      const d2 = W.R*Math.pow(z.R - c.R,2) + W.J*Math.pow(z.J - c.J,2) + W.E*Math.pow(z.E - c.E,2);
      const d = Math.sqrt(d2);
      const sim = 1/(1+d);
      arr.push({code:k, distance:+d.toFixed(3), similarity:+sim.toFixed(4)});
    }
    arr.sort((a,b)=> a.distance - b.distance);
    return { ranking: arr, top1: arr[0], top2: arr[1] };
  }

  function renderReport(theta, cls){
    $('#coreSurvey').classList.add('hidden');
    const box = $('#coreReportContent');
    const lines=[];
    lines.push(`<p><strong>核心三轴（1–5）</strong></p>`);
    lines.push(`<ul>
      <li>反身/觉察 R：${theta.R.toFixed(2)}</li>
      <li>外部正当化 J：${theta.J.toFixed(2)}</li>
      <li>去魅残差 E′：${theta.Eprime.toFixed(2)} <span style="color:#8a8a8a">(原始E=${theta.E.toFixed(2)})</span></li>
    </ul>`);
    const t1 = cls.top1, t2 = cls.top2;
    lines.push(`<p><strong>宏姿态候选</strong></p>`);
    lines.push(`<p>Top1：<span class="badge">${t1.code}</span>（相似度 ${t1.similarity}，距离 ${t1.distance}）</p>`);
    lines.push(`<p>Top2：<span class="badge">${t2.code}</span>（相似度 ${t2.similarity}，距离 ${t2.distance}）</p>`);
    lines.push(`<p style="color:#6b7280">说明：采用 R/J/E′ 三轴，在单位区间计算带权欧氏距离得到相似度；E′ 为 E 去除与 R 的线性重合后的近似残差（β=${(CFG.scoring?.beta_RE??0.65)}）。</p>`);
    box.innerHTML = lines.join('\n');
    $('#coreReport').classList.remove('hidden');
    window.__coreResult = {theta, cls};
  }

  function escapeHTML(s){
    return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
