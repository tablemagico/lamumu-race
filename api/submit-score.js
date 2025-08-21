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
  return S * 1_000_000_000 - T; // büyük daha iyi; ZREVRANGE ile okunur
}

// Tek komut: REST_URL/command/arg1/arg2...
async function call(...parts) {
  const u = [BASE, ...parts.map(encodeURIComponent)].join("/");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
  const data = await r.json();
  if (!r.ok || data?.error) throw new Error(data?.error || r.statusText);
  return data.result;
}

// Pipeline: tek istekte birden çok komut
async function pipeline(cmds) {
  const r = await fetch(`${BASE}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(cmds),
  });
  const arr = await r.json(); // [{result:...}|{error:...}, ...]
  if (!r.ok) throw new Error(`Pipeline HTTP ${r.status}`);
  for (const it of arr) if (it?.error) throw new Error(it.error);
  return arr.map((x) => x.result);
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const handle = normHandle(body.handle);
  const score = Number(body.score) | 0;
  const timeMs = Math.max(0, Number(body.timeMs) | 0);
  if (!Number.isFinite(score) || score < 0) return json({ error: "invalid score" }, 400);
  if (!Number.isFinite(timeMs)) return json({ error: "invalid timeMs" }, 400);

  const userKey = `${NS}:user:${handle}`;

  // Mevcut değerleri al (HMGET => [score, timeMs])
  const [prevScore, prevTime] = await call("hmget", userKey, "score", "timeMs");
  const pS = prevScore != null ? Number(prevScore) : null;
  const pT = prevTime != null ? Number(prevTime) : null;

  const improved =
    pS == null || score > pS || (score === pS && (pT == null || timeMs < pT));

  if (!improved) {
    return json({ ok: true, improved: false, handle, score: pS ?? 0, timeMs: pT ?? 0 });
  }

  const now = Date.now();
  const rankScore = makeRankScore(score, timeMs);

  // HSET + ZADD tek istekte (pipeline)
  await pipeline([
    ["HSET", userKey, "score", String(score), "timeMs", String(timeMs), "updatedAt", String(now)],
    ["ZADD", RANK_KEY, rankScore, handle],
  ]);

  return json({ ok: true, improved: true, handle, score, timeMs });
}
