export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method === "POST" && path === "/api/pageview") {
        return handlePageview(env, corsHeaders);
      }

      if (request.method === "POST" && path.startsWith("/api/course/")) {
        const idx = path.split("/").pop();
        return handleCourseClick(env, idx, corsHeaders);
      }

      if (request.method === "GET" && path === "/api/stats") {
        return handleGetStats(env, corsHeaders);
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

function getISOWeek() {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

async function increment(kv, key) {
  const val = parseInt(await kv.get(key)) || 0;
  const newVal = val + 1;
  await kv.put(key, String(newVal));
  return newVal;
}

async function handlePageview(env, corsHeaders) {
  const weekKey = `pv:week:${getISOWeek()}`;

  const [total, week] = await Promise.all([
    increment(env.COUNTER, "pv:total"),
    increment(env.COUNTER, weekKey),
  ]);

  return new Response(JSON.stringify({ total, week }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleCourseClick(env, idx, corsHeaders) {
  const key = `course:${idx}`;
  const count = await increment(env.COUNTER, key);

  return new Response(JSON.stringify({ idx: Number(idx), count }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function handleGetStats(env, corsHeaders) {
  const weekKey = `pv:week:${getISOWeek()}`;

  const [total, week] = await Promise.all([
    env.COUNTER.get("pv:total"),
    env.COUNTER.get(weekKey),
  ]);

  const courseList = await env.COUNTER.list({ prefix: "course:" });
  const courses = {};
  for (const key of courseList.keys) {
    const idx = key.name.replace("course:", "");
    courses[idx] = parseInt(await env.COUNTER.get(key.name)) || 0;
  }

  return new Response(
    JSON.stringify({
      pageTotal: parseInt(total) || 0,
      pageWeek: parseInt(week) || 0,
      courses,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
