const API_BASE = 'http://120.53.242.129:9090';
const TOKEN = 'KP1WxEZm_ZMgD4fwpKCGppk-wSB_b1k3-BQEUnVlLK4';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, ...params } = req.query;
  if (!endpoint) return res.status(400).json({ error: 'missing endpoint param' });

  const allowed = ['/api/jobs', '/api/stats', '/api/trends', '/api/policies'];
  if (!allowed.includes(endpoint)) return res.status(403).json({ error: 'endpoint not allowed' });

  const url = new URL(API_BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => { if (v) url.searchParams.set(k, v); });

  try {
    const upstream = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${TOKEN}` }
    });
    const data = await upstream.json();
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}
