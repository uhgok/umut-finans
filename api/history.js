export default async function handler(req, res) {
  try {
    const raw = String(req.query?.symbols || "");
    const symbols = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 50);
    if (!symbols.length) return res.status(400).json({ error: "symbols gerekli" });

    const now = Math.floor(Date.now() / 1000);
    const start = now - 365 * 24 * 60 * 60;
    const data = {};

    for (const symbol of symbols) {
      try {
        const url = new URL("https://query2.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol));
        url.searchParams.set("period1", String(start));
        url.searchParams.set("period2", String(now + 86400));
        url.searchParams.set("interval", "1d");
        url.searchParams.set("includePrePost", "false");
        url.searchParams.set("events", "div,splits");

        const r = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
          }
        });

        if (!r.ok) {
          data[symbol] = { error: "upstream_" + r.status };
          continue;
        }

        const j = await r.json();
        const result = j?.chart?.result?.[0];
        const ts = result?.timestamp || [];
        const close = result?.indicators?.quote?.[0]?.close || [];

        const rows = [];
        for (let i = 0; i < ts.length; i++) {
          if (close[i] == null) continue;
          rows.push({
            date: new Date(ts[i] * 1000).toISOString().slice(0, 10),
            close: Number(close[i])
          });
        }
        data[symbol] = { rows };
      } catch (e) {
        data[symbol] = { error: String(e?.message || e) };
      }
    }

    return res.status(200).json({
      provider: "Yahoo Finance Chart",
      updatedAt: new Date().toISOString(),
      data
    });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
