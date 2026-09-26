const SUPABASE_URL = "https://hrnstfymyuutbkjzemfo.supabase.co";
const SUPABASE_KEY = "sb_publishable_2LGCjz5fevG8SkwA3FqZVw_pl8BhIWk";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function authScreen(message = "") {
  let el = document.getElementById("authScreen");
  if (!el) {
    el = document.createElement("div");
    el.id = "authScreen";
    el.style.cssText = "position:fixed;inset:0;z-index:9999;background:#050b12;display:flex;align-items:center;justify-content:center;padding:20px;font-family:Inter,Segoe UI,Arial,sans-serif";
    el.innerHTML = `
      <div style="width:min(430px,100%);background:#0c1b2c;border:1px solid #284663;border-radius:20px;padding:24px;box-shadow:0 24px 80px rgba(0,0,0,.45)">
        <div style="color:#75b7ff;font-size:10px;letter-spacing:.16em;font-weight:800">UMUT FİNANS</div>
        <h1 style="margin:7px 0 4px;color:#edf4fc;font-size:28px">Portföyüne giriş yap</h1>
        <p style="margin:0 0 18px;color:#8fa6bd;font-size:12px">Verilerin hesabına özel ve Supabase veritabanında tutulur.</p>
        <div id="authMsg" style="min-height:18px;color:#ff7180;font-size:12px;margin-bottom:8px"></div>
        <input id="authEmail" type="email" placeholder="E-posta" style="width:100%;box-sizing:border-box;padding:12px;border-radius:11px;border:1px solid #294865;background:#081524;color:#fff;margin-bottom:9px">
        <input id="authPass" type="password" placeholder="Şifre (en az 6 karakter)" style="width:100%;box-sizing:border-box;padding:12px;border-radius:11px;border:1px solid #294865;background:#081524;color:#fff;margin-bottom:12px">
        <div style="display:flex;gap:8px">
          <button id="loginBtn" style="flex:1;padding:11px;border-radius:11px;border:1px solid #2a87cf;background:#176bb0;color:#fff">Giriş yap</button>
          <button id="signupBtn" style="flex:1;padding:11px;border-radius:11px;border:1px solid #1a9b69;background:#0e6040;color:#fff">Hesap oluştur</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    const msg = () => document.getElementById("authMsg");
    document.getElementById("loginBtn").onclick = async () => {
      msg().textContent = "Giriş yapılıyor…";
      const {error} = await sb.auth.signInWithPassword({email:document.getElementById("authEmail").value.trim(),password:document.getElementById("authPass").value});
      msg().textContent = error ? error.message : "";
    };
    document.getElementById("signupBtn").onclick = async () => {
      msg().textContent = "Hesap oluşturuluyor…";
      const {data,error} = await sb.auth.signUp({email:document.getElementById("authEmail").value.trim(),password:document.getElementById("authPass").value});
      if (error) msg().textContent = error.message;
      else msg().textContent = data.session ? "" : "E-postanı doğruladıktan sonra giriş yap.";
    };
  }
  el.style.display = "flex";
  document.getElementById("authMsg").textContent = message;
}

async function getSession() {
  const {data} = await sb.auth.getSession();
  return data.session;
}

async function seedUser(userId) {
  const {data:existing} = await sb.from("portfolio_positions").select("ticker").eq("user_id",userId).limit(1);
  if (existing && existing.length) return;
  const rows = state.positions.map(p => ({user_id:userId,ticker:p.ticker,qty:p.qty,avg_cost:p.avgCost}));
  await sb.from("portfolio_positions").insert(rows);
  await sb.from("user_settings").upsert({user_id:userId,portfolio_name:"Umut Finans",cash:Number(state.cash)||0,currency:"TRY"});
}

async function loadFromDB(userId) {
  const [p,t,s] = await Promise.all([
    sb.from("portfolio_positions").select("ticker,qty,avg_cost").eq("user_id",userId),
    sb.from("transactions").select("trade_date,ticker,side,qty,price,fee,realized_pnl,note").eq("user_id",userId).order("trade_date",{ascending:false}),
    sb.from("user_settings").select("cash,portfolio_name,currency").eq("user_id",userId).maybeSingle()
  ]);

  if (p.error) throw p.error;
  if (t.error) throw t.error;

  if (p.data?.length) {
    for (const row of p.data) {
      const local = state.positions.find(x => x.ticker === row.ticker);
      if (local) {
        local.qty = Number(row.qty);
        local.avgCost = Number(row.avg_cost);
      } else {
        state.positions.push({ticker:row.ticker,qty:Number(row.qty),avgCost:Number(row.avg_cost),price:0,prev:0,weekAgo:0});
      }
    }
  }
  state.transactions = (t.data || []).map(x => ({
    date:x.trade_date,ticker:x.ticker,side:x.side,qty:Number(x.qty),price:Number(x.price),fee:Number(x.fee||0),realized:Number(x.realized_pnl||0),note:x.note||""
  }));
  if (s.data) state.cash = Number(s.data.cash||0);
}

async function syncPositions(userId) {
  const rows = state.positions.map(p => ({
    user_id:userId,ticker:p.ticker,qty:Number(p.qty)||0,avg_cost:Number(p.avgCost)||0
  }));
  const {error} = await sb.from("portfolio_positions").upsert(rows,{onConflict:"user_id,ticker"});
  if (error) console.error("positions sync",error);
  const {error:settingsError}=await sb.from("user_settings").upsert({user_id:userId,portfolio_name:"Umut Finans",cash:Number(state.cash)||0,currency:"TRY"},{onConflict:"user_id"});
  if (settingsError) console.error("settings sync",settingsError);
}

async function syncTransactions(userId) {
  const {data:existing,error} = await sb.from("transactions").select("trade_date,ticker,side,qty,price,fee,note").eq("user_id",userId);
  if (error) return console.error(error);
  const localKey = x => [x.date||x.trade_date,x.ticker,x.side,x.qty,x.price,x.fee||0,x.note||""].join("|");
  const known = new Set((existing||[]).map(localKey));
  const adds = (state.transactions||[]).filter(x=>!known.has(localKey(x))).map(x=>({
    user_id:userId,trade_date:x.date,ticker:x.ticker,side:x.side,qty:Number(x.qty),price:Number(x.price),fee:Number(x.fee||0),realized_pnl:Number(x.realized||0),note:x.note||""
  }));
  if (adds.length) {
    const {error:insErr}=await sb.from("transactions").insert(adds);
    if (insErr) console.error("transaction sync",insErr);
  }
}

async function syncPricesAndSnapshot(userId) {
  const all=[];
  for (const [ticker,rows] of Object.entries(state.priceHistory||{})) {
    for (const row of rows) all.push({trade_date:row.date,ticker,close:Number(row.close),source:"Yahoo Finance Chart"});
  }
  if (all.length) {
    const {error}=await sb.from("daily_prices").upsert(all,{onConflict:"trade_date,ticker"});
    if (error) console.error("price sync",error);
  }
  const today = state.updatedAt || new Date().toISOString().slice(0,10);
  const snapshot = {
    snapshot_date:today,user_id:userId,portfolio_value:Number(totalValue())||0,
    cash:Number(state.cash)||0,daily_pnl:Number(dailyPnL())||0,total_pnl:Number(totalPnL())||0
  };
  const {error:sErr}=await sb.from("portfolio_snapshots").upsert(snapshot,{onConflict:"snapshot_date,user_id"});
  if (sErr) console.error("snapshot sync",sErr);
}

let lastSynced = "";
async function autoSync() {
  const session = await getSession();
  if (!session) return;
  const fingerprint = JSON.stringify({positions:state.positions,transactions:state.transactions,cash:state.cash,updatedAt:state.updatedAt});
  if (fingerprint === lastSynced) return;
  await syncPositions(session.user.id);
  await syncTransactions(session.user.id);
  await syncPricesAndSnapshot(session.user.id);
  lastSynced = fingerprint;
}

async function appInit() {
  const session = await getSession();
  if (!session) {
    authScreen();
    return;
  }
  document.getElementById("authScreen")?.remove();
  try {
    await seedUser(session.user.id);
    await loadFromDB(session.user.id);
    renderAll();
    if (typeof refreshMarket === "function") refreshMarket();
    lastSynced = "";
    autoSync();
  } catch (e) {
    console.error(e);
    authScreen("Veriler yüklenirken hata oluştu: " + (e.message || e));
  }
}

sb.auth.onAuthStateChange((_event, session) => {
  if (session) appInit();
  else authScreen();
});

window.UmutFinans = {
  supabase: sb,
  signOut: () => sb.auth.signOut()
};

document.addEventListener("DOMContentLoaded", appInit);
setInterval(autoSync, 3000);
