(async function(){
  const $ = s => document.querySelector(s);
  const list = $('#testList');
  const meta = $('#meta');
  const viewer = $('#viewer');
  const frame = $('#testFrame');

  // 拉清单
  let m;
  try{
    const r = await fetch('./manifest.json');
    m = await r.json();
  }catch(e){
    meta.textContent = '清单加载失败：' + e.message;
    return;
  }

  meta.textContent = m.title || '可用测试';
  const params = new URLSearchParams(location.search);
  const want = params.get('id');

  // 渲染卡片
  (m.tests||[]).forEach(t=>{
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <h3>${t.name} ${t.supports_mbti ? '<span class="badge">MBTI</span>' : ''}</h3>
      <p class="small">${t.desc||''}</p>
      <div class="actions"><button class="btn btn-primary">进入测试</button></div>
    `;
    card.querySelector('button').addEventListener('click', ()=>{
      openTest(t.id, t.page);
    });
    list.appendChild(card);
  });

  function openTest(id, url){
    // 同页打开，被测页面在 iframe 内；URL 写上 ?id=xxx
    frame.src = url;
    viewer.classList.remove('hidden');
    const p = new URLSearchParams(location.search);
    p.set('id', id);
    history.replaceState(null,'','?'+p.toString());
    // 滚到 iframe
    setTimeout(()=>viewer.scrollIntoView({behavior:'smooth', block:'start'}), 50);
  }

  // 直达
  if(want){
    const t = (m.tests||[]).find(x=>x.id===want);
    if(t){ openTest(t.id, t.page); }
  }
})();
