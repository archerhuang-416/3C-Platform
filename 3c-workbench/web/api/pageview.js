import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_KV_REST_API_TOKEN,
});

function getWeekKey() {
  const now = new Date();
  const oneJan = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - oneJan) / 86400000 + oneJan.getDay() + 1) / 7);
  return `pv:week:${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'POST') {
      const total = await redis.incr('pv:total');
      const weekKey = getWeekKey();
      const week = await redis.incr(weekKey);
      await redis.expire(weekKey, 60 * 60 * 24 * 8);
      return res.status(200).json({ total, week });
    }

    // GET
    const total = (await redis.get('pv:total')) || 0;
    const weekKey = getWeekKey();
    const week = (await redis.get(weekKey)) || 0;
    return res.status(200).json({ total, week });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
