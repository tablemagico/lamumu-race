export const config = { runtime: "edge" };

// --- Upstash REST config ---
const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const NS = process.env.LAMUMU_NS || "lamumu:run";
const RANK_KEY = `${NS}:rank`;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function call(...parts) {
  const u = [BASE, ...parts.map(encodeURIComponent)].join("/");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await r.json();
  if (!r.ok || data?.error) throw new Error(data?.error || r.statusText);
  return data.result;
}
async function pipeline(cmds) {
  const r = await fetch(`${BASE}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmds),
  });
  const arr = await r.json();
  if (!r.ok) throw new Error(`Pipeline HTTP ${r.status}`);
  for (const it of arr) if (it?.error) throw new Error(it.error);
  return arr.map((x) => x.result);
}

export default async function handler(req) {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const { searchParams } = new URL(req.url);
  const start = Math.max(0, Number(searchParams.get("start") ?? 0) | 0);
  const count = Math.min(200, Math.max(1, Number(searchParams.get("count") ?? 50) | 0));
  const rankFor = (searchParams.get("rankFor") || "").trim().toLowerCase();
  const stop = start + count - 1;

  // Toplam
  const total = await call("zcard", RANK_KEY);

  // Üyeleri al (büyükten küçüğe)
  const members = await call("zrevrange", RANK_KEY, String(start), String(stop)); // ["h1","h2",...]

  let items = [];
  if (Array.isArray(members) && members.length) {
    // Her üye için HMGET'leri tek pipeline'da gönder
    const cmds = members.map((m) => ["HMGET", `${NS}:user:${m}`, "score", "timeMs"]);
    const results = await pipeline(cmds); // [[score, timeMs], ...]
    items = results.map((row, i) => ({
      handle: members[i],
      score: Number(row?.[0] ?? 0),
      timeMs: Number(row?.[1] ?? 0),
    }));
  }

  // Belirli bir kullanıcı için sıra (opsiyonel)
  let rank = null;
  if (rankFor) {
    const r = await call("zrevrank", RANK_KEY, rankFor);
    rank = r == null ? null : Number(r) + 1; // 1-based
  }

  return json({ items, total, rank });
}
