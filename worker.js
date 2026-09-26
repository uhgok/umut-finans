export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/history") {
      return handleHistory(url);
    }

    // Serve index.html and all static assets.
    return env.ASSETS.fetch(request);
  }
};

async function handleHistory(url) {
  try {
    const raw = url.searchParams.get("symbols") || "";
    const symbols = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);

    if (!symbols.length) {
      return json({ error: "symbols gerekli" }, 400);
    }

    const now = Math.floor(Date.now() / 1000);
    const start = now - 365 * 24 * 60 * 60;
    const data = {};

    // Fetch in parallel so all portfolio symbols update quickly.
    await Promise.all(symbols.map(async (symbol) => {
      try {
        const yahoo = new URL(
          "https://query2.finance.yahoo.com/v8/finance/chart/" +
          encodeURIComponent(symbol)
        );

        yahoo.searchParams.set("period1", String(start));
        yahoo.searchParams.set("period2", String(now + 86400));
        yahoo.searchParams.set("interval", "1d");
        yahoo.searchParams.set("includePrePost", "false");
        yahoo.searchParams.set("events", "div,splits");

        const response = await fetch(yahoo, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
          }
        });

        if (!response.ok) {
          data[symbol] = { error: "upstream_" + response.status };
          return;
        }

        const payload = await response.json();
        const result = payload?.chart?.result?.[0];
        const timestamps = result?.timestamp || [];
        const closes = result?.indicators?.quote?.[0]?.close || [];

        const rows = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] == null) continue;

          rows.push({
            date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
            close: Number(closes[i])
          });
        }

        data[symbol] = { rows };
      } catch (error) {
        data[symbol] = {
          error: String(error?.message || error)
        };
      }
    }));

    return json({
      provider: "Yahoo Finance Chart",
      updatedAt: new Date().toISOString(),
      data
    });
  } catch (error) {
    return json(
      { error: String(error?.message || error) },
      500
    );
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}