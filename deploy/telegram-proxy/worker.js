// Прокси к Telegram Bot API для сервера, с которого api.telegram.org недоступен.
// Cloudflare Worker: пересылает запросы вида
//   https://<worker>/<PROXY_SECRET>/bot<token>/<method>
//   https://<worker>/<PROXY_SECRET>/file/bot<token>/<path>
// в https://api.telegram.org/... и возвращает ответ как есть.
//
// PROXY_SECRET — переменная (Secret) воркера. Без неё в пути воркер отвечает 404,
// чтобы адрес нельзя было использовать как открытый прокси для чужих ботов.
// В .env приложения: TELEGRAM_API_BASE_URL=https://<worker>/<PROXY_SECRET>
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const secret = env.PROXY_SECRET;
    const prefix = `/${secret}/`;
    if (!secret || !url.pathname.startsWith(prefix)) {
      return new Response("Not found", { status: 404 });
    }
    const rest = url.pathname.slice(prefix.length);
    if (!/^(bot|file\/bot)\d+:[\w-]+\//.test(rest)) {
      return new Response("Not found", { status: 404 });
    }
    const target = `https://api.telegram.org/${rest}${url.search}`;
    return fetch(target, {
      method: request.method,
      headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    });
  },
};
