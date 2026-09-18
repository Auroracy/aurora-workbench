/* Aurora 工作台 Service Worker
 * 策略：
 *   - 页面（导航请求）：网络优先，离线时回退到缓存副本 → 保证永远是最新代码，断网也能开
 *   - 图标 / manifest 等静态资源：缓存优先
 *   - /api/* 数据接口：完全不拦截，永远走网络（避免缓存脏数据）
 *   - 跨域资源（CDN 等）：不拦截
 * 注意：Service Worker 只在安全上下文（https 或 localhost）下注册，
 *       http://IP:端口 访问时浏览器会自动跳过，不影响页面功能。
 */
var CACHE = 'aurora-shell-v1';
var SHELL = [
  './',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return c.addAll(SHELL).catch(function () { /* 单个资源失败不阻断安装 */ });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          // 跨域（CDN 等）放行
  if (url.pathname.indexOf('/api/') !== -1) return;          // 数据接口永远走网络，不缓存

  // 页面导航：网络优先 + 离线兜底
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put('./', copy); }).catch(function () {});
        }
        return res;
      }).catch(function () {
        return caches.match('./').then(function (hit) {
          return hit || caches.match('aurora-workbench.html');
        });
      })
    );
    return;
  }

  // 其它同源静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
        }
        return res;
      });
    })
  );
});
