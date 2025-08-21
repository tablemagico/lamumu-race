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
function normHandle(h) {
  const s = String(h || "guest").trim().replace(/^@/, "").toLowerCase();
  const safe = s.replace(/[^a-z0-9_.-]/g, "");
  return safe.slice(0, 32) || "guest";
}
function makeRankScore(score, timeMs) {
  const S = Number(score) | 0;
  const T = Math.max(0, Number(timeMs) | 0);
  // yüksek skor öne; eşit skorda düşük süre öne
  return S * 1_000_000_000 - T;
}

async function call(...parts) {
  if (!BASE || !TOKEN) throw new Error("Missing Upstash env vars");
  const u = [BASE, ...parts.map(encodeURIComponent)].join("/");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await r.json();
  if (!r.ok || data?.error) throw new Error(data?.error || r.statusText);
  return data.result;
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const handle = normHandle(body.handle);
  const score = Number(body.score) | 0;
  const timeMs = Math.max(0, Number(body.timeMs) | 0);

  if (!Number.isFinite(score) || score < 0)   return json({ error: "invalid score" }, 400);
  if (!Number.isFinite(timeMs))               return json({ error: "invalid timeMs" }, 400);

  const userKey = `${NS}:user:${handle}`;

  // HMGET (BÜYÜK HARF)
  const res = await call("HMGET", userKey, "score", "timeMs");
  const prevScore = res?.[0] != null ? Number(res[0]) : null;
  const prevTime  = res?.[1] != null ? Number(res[1]) : null;

  const improved =
    prevScore == null ||
    score > prevScore ||
    (score === prevScore && (prevTime == null || timeMs < prevTime));

  if (!improved) {
    return json({ ok: true, improved: false, handle, score: prevScore ?? 0, timeMs: prevTime ?? 0 });
  }

  const now = Date.now();
  const rankScore = makeRankScore(score, timeMs);

  // HSET ve ZADD ayrı ayrı (pipeline yok)
  await call("HSET", userKey, "score", String(score), "timeMs", String(timeMs), "updatedAt", String(now));
  await call("ZADD", RANK_KEY, String(rankScore), handle);

  return json({ ok: true, improved: true, handle, score, timeMs });
}
