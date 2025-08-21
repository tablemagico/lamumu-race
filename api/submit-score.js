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

// Büyük skor ↑, eşitlikte hızlı olan ↑ (daha kısa süre)
const composite = (score, timeMs) => score * 1_000_000_000 - timeMs;

export default async (req, res) => {
  if (req.method === 'OPTIONS') { // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end(); return;
  }
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  try {
    const { handle, score, timeMs } = req.body || {};
    if (!handle || typeof score !== 'number' || typeof timeMs !== 'number') {
      res.status(400).json({ error: 'Invalid payload' }); return;
    }
    const h = String(handle).toLowerCase().replace(/^@/, '').trim();
    const s = Math.max(0, Math.floor(score));
    const t = Math.max(0, Math.min(3_600_000, Math.floor(timeMs))); // ≤ 1h

    const r = getRedis();
    const cur = await r.zscore('lamumu:board', h);
    const curNum = cur == null ? null : Number(cur);
    const nextScore = composite(s, t);

    let updated = false;
    if (curNum == null || nextScore > curNum) {
      const multi = r.multi();
      multi.zadd('lamumu:board', nextScore, h);
      multi.hset(`lamumu:detail:${h}`, 'score', String(s),
                 'timeMs', String(t), 'updatedAt', String(Date.now()));
      await multi.exec();
      updated = true;
    }
    res.status(200).json({ updated });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};
