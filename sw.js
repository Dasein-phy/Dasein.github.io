/* ===========================================================
 * sw.js  (Dasein Blog / GitHub Pages)
 * ===========================================================
 * 基于原主题脚本改写：适配本站域名与路径；加入 /meaning-test/ 资源离线缓存。
 * 模式：precache-then-runtime（静态预缓存 + 运行时更新）
 * ========================================================== */

// ------------ 基本配置 ------------
const VERSION = 'v2025-08-15-01';
const CACHE_NAMESPACE = 'dasein-';
const CACHE = `${CACHE_NAMESPACE}precache-then-runtime-${VERSION}`;

// 预缓存的静态资源（根站点 + 意义测试）
const PRECACHE_LIST = [
  // 根站点关键页
  './',
  './offline.html',

  // 样式与脚本（根据你的仓库保持一致）
  './js/jquery.min.js',
  './js/bootstrap.min.js',
  './js/hux-blog.min.js',
  './js/snackbar.js',
  './css/hux-blog.min.css',
  './css/bootstrap.min.css',

  // 常用图片（可按需增删）
  './img/home-bg.jpg',
  './img/404-bg.jpg',
  './img/icon_wechat.png',

  // —— 意义测试子应用（/meaning-test/）——
  './meaning-test/',
  './meaning-test/index.html',
  './meaning-test/styles.css',
  './meaning-test/app.js',
  './meaning-test/app.config.json',
  './meaning-test/mbti.prior.config.json',
  './meaning-test/items.baseline.json',
];

// 允许使用运行时缓存的主机名白名单
const HOSTNAME_WHITELIST = [
  self.location.hostname,          // 你的 GitHub Pages 域（含项目路径）
  'dasein-phy.github.io',          // 明确列出你的域
  'cdnjs.cloudflare.com'           // 主题里使用的 CDN
];

// 需要清理的旧缓存名（只保留当前 VERSION）
const DEPRECATED_CACHES = [
  'precache-v1', 'runtime', 'main-precache-v1', 'main-runtime'
];

// ------------ 工具函数 ------------

// 为请求添加 cache-busting（解决 GP 的 max-age 对 SW 的干扰）
const getCacheBustingUrl = (req) => {
  const now = Date.now();
  const url = new URL(req.url);

  // 与当前协议保持一致，避免 http/https 混用
  url.protocol = self.location.protocol;

  // 为避免服务端缓存，增加查询参数
  url.search += (url.search ? '&' : '?') + 'cache-bust=' + now;
  return url.href;
};

// 检测是否是 HTML 导航请求（老 Chrome 兼容）
const isNavigationReq = (req) =>
  req.mode === 'navigate' ||
  (req.method === 'GET' && (req.headers.get('accept') || '').includes('text/html'));

// 检测 URL 是否以扩展名结尾（.js/.css/.png 等）
const endWithExtension = (req) => /\.\w+$/.test(new URL(req.url).pathname);

// 是否需要对导航追加结尾斜杠（修复 GH Pages 对目录的 404）
const shouldRedirect = (req) =>
  isNavigationReq(req) &&
  !new URL(req.url).pathname.endsWith('/') &&
  !endWithExtension(req);

// 计算重定向后的 URL（目录形式）
const getRedirectUrl = (req) => {
  const url = new URL(req.url);
  url.pathname += '/';
  return url.href;
};

// ------------ Service Worker 生命周期 ------------

// 安装：预缓存静态资源
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE_LIST))
      .then(() => self.skipWaiting())
      .catch((err) => console.log('[SW install] precache error:', err))
  );
});

// 激活：清理旧缓存并接管控制权
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((n) => n !== CACHE || DEPRECATED_CACHES.includes(n))
          .map((n) => caches.delete(n))
      )
    ).then(() => self.clients.claim())
  );
  console.log('[SW] activated:', VERSION);
});

// ------------ 运行时缓存策略 ------------

const fetchHelper = {
  // 取网并写入缓存（成功 200 才写）
  fetchThenCache(request) {
    const init = { mode: 'cors', credentials: 'omit' };
    const fetched = fetch(request, init);
    const fetchedCopy = fetched.then((resp) => resp.clone());

    Promise.all([fetchedCopy, caches.open(CACHE)])
      .then(([response, cache]) => {
        if (response && response.ok) cache.put(request, response);
      })
      .catch(() => { /* ignore */ });

    return fetched;
  },

  // 先缓存，后网络（缓存不存在再走网）
  cacheFirst(url) {
    return caches.match(url)
      .then((resp) => resp || this.fetchThenCache(url))
      .catch(() => { /* ignore */ });
  }
};

// ------------ 拦截请求 ------------

self.addEventListener('fetch', (event) => {
  const urlObj = new URL(event.request.url);
  const hostOk = HOSTNAME_WHITELIST.includes(urlObj.hostname);

  if (!hostOk) return; // 跨域（如 GA）不处理

  // 目录导航 404 修复：补斜杠重定向
  if (shouldRedirect(event.request)) {
    event.respondWith(Response.redirect(getRedirectUrl(event.request)));
    return;
  }

  // 对特定静态域名可采用 cache-first（如果有的话）
  if (event.request.url.indexOf('ys.static') > -1) {
    event.respondWith(fetchHelper.cacheFirst(event.request.url));
    return;
  }

  // 其余：stale-while-revalidate
  const cached = caches.match(event.request);
  const fetched = fetch(getCacheBustingUrl(event.request), { cache: 'no-store' })
    .catch(() => null); // 离线时抓不到

  const fetchedCopy = fetched.then((resp) => (resp ? resp.clone() : null));

  event.respondWith(
    Promise.race([fetched.then((r) => r || Promise.reject()), cached])
      .then((resp) => resp || fetched || cached)
      .catch(() => caches.match('./offline.html'))
  );

  // 后台更新缓存（仅 200 写）
  event.waitUntil(
    Promise.all([fetchedCopy, caches.open(CACHE)])
      .then(([response, cache]) => {
        if (response && response.ok) cache.put(event.request, response);
      })
      .catch(() => { /* ignore */ })
  );

  // 若为 HTML 导航，尝试对比 last-modified 并通知客户端
  if (isNavigationReq(event.request)) {
    event.waitUntil(revalidateContent(cached, fetchedCopy));
  }
});

// ------------ 客户端通信与内容校验 ------------

function sendMessageToAllClients(msg) {
  self.clients.matchAll().then((clients) => {
    clients.forEach((client) => client.postMessage(msg));
  });
}

function sendMessageToClientsAsync(msg) {
  setTimeout(() => sendMessageToAllClients(msg), 1000);
}

// 若响应头的 last-modified 变化，通知客户端可更新
function revalidateContent(cachedResp, fetchedResp) {
  return Promise.all([cachedResp, fetchedResp])
    .then(([cached, fetched]) => {
      if (!cached || !fetched) return;
      const cachedVer = cached.headers.get('last-modified');
      const fetchedVer = fetched.headers.get('last-modified');
      if (cachedVer !== fetchedVer) {
        sendMessageToClientsAsync({ command: 'UPDATE_FOUND', url: fetched.url });
      }
    })
    .catch(() => { /* ignore */ });
}
