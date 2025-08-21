// Node.js Serverless Function (ioredis)
export const config = { runtime: 'nodejs' };
import Redis from 'ioredis';

let client;
function getRedis() {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  const opts = {};
  try { const u = new URL(url); if (u.protocol === 'rediss:') opts.tls = {}; } catch {}
  client = new Redis(url, opts);
  return client;
}

export default async (req, res) => {
  if (req.method !== 'GET') { res.status(405).send('Method Not Allowed'); return; }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const r = getRedis();
    const url = new URL(req.url, 'http://localhost');
    const start = Math.max(0, parseInt(url.searchParams.get('start') ?? '0', 10));
    const count = Math.max(1, Math.min(200, parseInt(url.searchParams.get('count') ?? '50', 10)));
    const total = await r.zcard('lamumu:board');
    const handles = await r.zrevrange('lamumu:board', start, start + count - 1);

    let items = [];
    if (handles.length) {
      const pipe = r.pipeline();
      for (const h of handles) pipe.hmget(`lamumu:detail:${h}`, 'score', 'timeMs', 'updatedAt');
      const rows = await pipe.exec();
      items = handles.map((h, i) => {
        const arr = rows[i]?.[1] || [];
        return { handle: h, score: parseInt(arr?.[0] ?? '0', 10),
                 timeMs: parseInt(arr?.[1] ?? '0', 10),
                 updatedAt: parseInt(arr?.[2] ?? '0', 10) };
      });
    }

    res.status(200).json({ items, start, count, total });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
