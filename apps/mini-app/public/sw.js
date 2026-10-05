const PREFIX = "ealzy-shell-";
const FETCH_MS = 4000;

function isShellCache(name) {
  return name.startsWith(PREFIX);
}

async function openShellCache() {
  const names = (await caches.keys()).filter(isShellCache);
  return names.length ? caches.open(names[0]) : null;
}

function fileKey(request) {
  const url = new URL(request instanceof Request ? request.url : request, self.location.origin);
  url.search = "";
  url.hash = "";
  if (url.origin !== self.location.origin) return null;
  if (url.pathname === "/") return "/index.html";
  return url.pathname;
}

function shouldCache(response) {
  if (!response || !response.ok) return false;
  const control = response.headers.get("Cache-Control") || "";
  return !/\bno-store\b/i.test(control);
}

async function putInShell(request, response) {
  if (!shouldCache(response)) return;
  const cache = await openShellCache();
  const key = fileKey(request);
  if (!cache || !key) return;
  await cache.put(key, response.clone());
}

async function matchShell(request) {
  const cache = await openShellCache();
  const key = fileKey(request);
  if (!cache || !key) return undefined;
  return (await cache.match(key)) || (await cache.match(request));
}

// ms = 0 означает «без обрыва». Таймаут нужен там, где медленная сеть не
// должна задерживать запуск (precache и навигация — у них есть запасной
// вариант в кэше). Для ленивых чанков маршрутов он вреден: оборванный
// динамический импорт React.lazy запоминает как отклонённый, экран уходит в
// «Что-то пошло не так», и кнопка «Повторить» повторяет уже провалившийся
// импорт — помогает только полная перезагрузка страницы.
function fetchFresh(request, ms = 0) {
  const init = { cache: "reload" };
  let timer = null;
  if (ms > 0) {
    const controller = new AbortController();
    init.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), ms);
  }
  let req;
  if (request instanceof Request && request.mode === "navigate") {
    req = new Request(request.url, init);
  } else {
    req = request instanceof Request ? new Request(request, init) : new Request(request, init);
  }
  return fetch(req).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function addFiles(cache, files) {
  await Promise.all(
    files.map(async (file) => {
      try {
        const response = await fetchFresh(file, FETCH_MS);
        if (shouldCache(response)) await cache.put(file === "/" ? "/index.html" : file, response);
      } catch {
        // A missing icon must not block the rest of the shell.
      }
    }),
  );
}

let installedCache = "";
let installedFiles = [];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const precache = await (await fetchFresh("/precache.json", FETCH_MS)).json();
        installedCache = PREFIX + precache.v;
        installedFiles = precache.files || [];
        const cache = await caches.open(installedCache);
        await addFiles(cache, installedFiles);
      } catch {
        // Home-screen launches must not wait on a hung precache.
      }
      await self.skipWaiting();
    })(),
  );
});

// Чистим не только лишние кэши, но и устаревшие записи внутри оставленного.
// Раньше при неудачном precache имя кэша не менялось, файлы только
// добавлялись, и в шелле копились по два поколения каждого чанка
// (ProfilePage-<старый>.js рядом с ProfilePage-<новый>.js).
async function pruneShell(cacheName) {
  if (!cacheName || !installedFiles.length) return;
  const cache = await caches.open(cacheName);
  const wanted = new Set(installedFiles.map((file) => (file === "/" ? "/index.html" : file)));
  for (const request of await cache.keys()) {
    const key = fileKey(request);
    if (key && key.startsWith("/assets/") && !wanted.has(key)) await cache.delete(request);
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      const keep = installedCache || names.find(isShellCache) || "";
      await Promise.all(names.filter((name) => name !== keep).map((name) => caches.delete(name)));
      await pruneShell(keep);
      await self.clients.claim();
    })(),
  );
});

function isApi(url) {
  return url.pathname.startsWith("/api/") || url.pathname.startsWith("/webhooks/");
}

function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/") && /\.(js|css)$/.test(url.pathname);
}

function isNavigate(request) {
  return request.mode === "navigate" || request.destination === "document";
}

async function networkFirst(request, fallbackKey, ms = 0) {
  try {
    const fresh = await fetchFresh(request, ms);
    await putInShell(fallbackKey || request, fresh);
    return fresh;
  } catch {
    return (
      (await matchShell(fallbackKey || request)) ||
      (await matchShell("/index.html")) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cached = await matchShell(request);
  if (cached) return cached;
  try {
    const fresh = await fetchFresh(request);
    await putInShell(request, fresh);
    return fresh;
  } catch {
    // Пусть запрос доживёт обычным путём, чем страница получит сетевую ошибку.
    return fetch(request);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;
  if (url.pathname === "/sw.js") return;

  if (isNavigate(request)) {
    event.respondWith(networkFirst(request, "/index.html", FETCH_MS));
    return;
  }
  if (isHashedAsset(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (
    url.pathname === "/version.json" ||
    url.pathname === "/precache.json" ||
    url.pathname === "/boot-fallback.js" ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/index.html"
  ) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(
    (async () => {
      try {
        const fresh = await fetchFresh(request);
        await putInShell(request, fresh);
        return fresh;
      } catch {
        return (await matchShell(request)) || fetch(request);
      }
    })(),
  );
});
