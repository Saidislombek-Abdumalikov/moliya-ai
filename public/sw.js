const CACHE_NAME = 'moliya-ai-cache-v3';
const ASSETS_TO_CACHE = ['/', '/index.html', '/logo.png', '/manifest.json', '/robots.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(names.filter(name => name.startsWith('moliya-ai-cache-') && name !== CACHE_NAME).map(name => caches.delete(name)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'CLEAR_USER_CACHE') event.waitUntil(caches.delete(CACHE_NAME));
});
self.addEventListener('fetch', event => {
  const request=event.request;
  const url=new URL(request.url);
  // External SDKs use the browser's script policy, not a worker fetch/connect policy.
  // APIs, session URLs and private data must never enter the offline cache.
  if(request.method!=='GET' || url.origin!==self.location.origin || url.pathname.startsWith('/api/'))return;
  if(request.mode==='navigate') {
    event.respondWith(fetch(request).catch(async()=>
      await caches.match('/index.html') || new Response('Internetga ulaning va qayta urinib ko‘ring.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
    return;
  }
  if(url.search || !(url.pathname.startsWith('/assets/') || ASSETS_TO_CACHE.includes(url.pathname)))return;
  event.respondWith((async()=>{
    const cached=await caches.match(request);
    const refresh=fetch(request).then(async response=>{
      if(response.ok && response.type==='basic') {
        try {const cache=await caches.open(CACHE_NAME);await cache.put(request,response.clone());} catch {}
      }
      return response;
    }).catch(()=>cached || Response.error());
    event.waitUntil(refresh.then(()=>{}));
    return cached || await refresh;
  })());
});
