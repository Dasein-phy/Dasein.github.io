/* ====== shared/mt-ui.js —— 统一交互工具 ====== */
window.MT = (() => {
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

  /** 7 点李克特构件：返回 DOM 节点 */
  function buildLikert7(name, onPick){
    const wrap = document.createElement('div'); wrap.className='likert7';
    for(let v=1; v<=7; v++){
      const opt  = document.createElement('label');
      opt.className = 'likert-option' + (v===4?' is-center':'');
      const input= document.createElement('input');
      input.type='radio'; input.name=name; input.value=String(v);
      const dot  = document.createElement('span'); dot.className='likert-dot';
      opt.appendChild(input); opt.appendChild(dot);
      input.addEventListener('change',()=>{
        wrap.querySelectorAll('.likert-option').forEach(k=>k.classList.remove('is-selected','tapped'));
        opt.classList.add('is-selected','tapped'); setTimeout(()=>opt.classList.remove('tapped'),120);
        onPick?.(parseInt(input.value,10));
      });
      wrap.appendChild(opt);
    }
    return wrap;
  }

  /** 渲染单题卡片（逐题追加） */
  function renderQuestionCard(formEl, idx, text, name, onPick){
    const node = document.createElement('div');
    node.className = 'item card slide-in';
    node.setAttribute('data-q-idx', idx);
    node.innerHTML = `<h3 class="q-title">Q${idx+1}. ${esc(text)}</h3><div class="q-options"></div>`;
    const lk = buildLikert7(name, onPick);
    node.querySelector('.q-options').appendChild(lk);
    formEl.appendChild(node);
    return node;
  }

  /** 小工具 */
  const show = id => $('#'+id)?.classList.remove('hidden');
  const hide = id => $('#'+id)?.classList.add('hidden');
  const updateProgress = (el, done, total) => { if(el) el.textContent = `${done} / ${total}`; };
  const scrollTo = (node) => node?.scrollIntoView({ behavior:'smooth', block:'center' });
  function downloadJSON(obj, filename='result.json'){
    const blob = new Blob([JSON.stringify(obj,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download=filename; a.click();
    URL.revokeObjectURL(url);
  }

  /** 可选：MBTI 右展开初始化 */
  function initMbtiRail(root=document){
    $$('.mbti-select', root).forEach(sel=>{
      const cur = $('.mbti-current', sel);
      const menu= $('.mbti-menu', sel);
      let t;
      cur?.addEventListener('click', ()=>{ sel.classList.add('mt-open'); clearTimeout(t); t=setTimeout(()=>sel.classList.remove('mt-open'),1500); });
      menu?.addEventListener('mouseenter', ()=>clearTimeout(t));
      menu?.addEventListener('mouseleave', ()=>sel.classList.remove('mt-open'));
      menu?.querySelectorAll('li[data-v]').forEach(li=>{
        li.addEventListener('click', ()=>{
          menu.querySelectorAll('li').forEach(x=>x.classList.remove('is-active'));
          li.classList.add('is-active');
          cur.textContent = li.getAttribute('data-v')||'未填';
          sel.classList.remove('mt-open');
        });
      });
    });
  }

  return { $, $$, esc, buildLikert7, renderQuestionCard, show, hide, updateProgress, scrollTo, downloadJSON, initMbtiRail };
})();
