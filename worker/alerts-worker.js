// Cloudflare Worker: прокси повітряних тривог для сайту класу.
// Бере публічні дані з ubilling.net.ua/aerialalerts (без токена), кешує на 30 с,
// переводить час із київського в UTC і віддає з CORS, щоб сайт міг їх читати.
//
// Відповідь: { at: <ms UTC>, regions: { "м. Київ": { a: true|false, t: <ms UTC початку/відбою> }, ... } }

const SOURCE = 'https://ubilling.net.ua/aerialalerts/';
const TTL = 30; // секунд

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

// "2026-11-23 14:08:05" (Europe/Kyiv) -> мс UTC
function kyivToUtc(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const off = (ms) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'Europe/Kyiv', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])
    );
    return Date.UTC(+p.year, p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let t = asUtc - off(asUtc);
  t = asUtc - off(t); // уточнення біля переходу на літній/зимовий час
  return t;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? `public, max-age=${TTL}` : 'no-store',
    },
  });
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET') return json({ error: 'method' }, 405);

    const cache = caches.default;
    const key = new Request(new URL('/__alerts', req.url).href);
    const hit = await cache.match(key);
    if (hit) return hit;

    try {
      const r = await fetch(SOURCE, { headers: { Accept: 'application/json' }, cf: { cacheTtl: TTL } });
      if (!r.ok) throw new Error('source ' + r.status);
      const src = await r.json();
      const regions = {};
      for (const [name, v] of Object.entries(src.states || {})) {
        regions[name] = { a: !!v.alertnow, t: kyivToUtc(v.changed) };
      }
      const res = json({ at: Date.now(), regions });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (e) {
      return json({ error: 'unavailable' }, 502);
    }
  },
};
