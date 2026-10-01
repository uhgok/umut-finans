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


// === Interactive chart hover tooltip ===
(function(){
  if (window.__ufChartHoverInstalled) return;
  window.__ufChartHoverInstalled = true;

  var style = document.createElement("style");
  style.id = "uf-chart-tooltip-style";
  style.textContent = [
    ".uf-chart-tooltip{position:fixed;display:none;z-index:10000;pointer-events:none;min-width:190px;max-width:280px;max-height:390px;overflow:auto;padding:10px 12px;border:1px solid #315372;border-radius:11px;background:rgba(7,17,28,.97);box-shadow:0 12px 35px rgba(0,0,0,.38);color:#edf4fc;font:12px/1.5 Segoe UI,Arial,sans-serif}",
    ".uf-chart-tooltip .tt-date{color:#8fa6bd;font-size:10px;margin-bottom:5px}",
    ".uf-chart-tooltip .tt-row{display:flex;justify-content:space-between;gap:16px}",
    ".uf-chart-tooltip .tt-label{color:#8fa6bd}",
    ".uf-chart-tooltip .tt-value{font-weight:800;color:#fff}",
    ".uf-chart-tooltip .tt-up{color:#2ad77e}",
    ".uf-chart-tooltip .tt-down{color:#ff7180}",
    ".uf-chart-tooltip .tt-stock-list{margin-top:7px;padding-top:7px;border-top:1px solid #213b55}",
    ".uf-chart-tooltip .tt-stock{display:flex;justify-content:space-between;gap:18px;padding:2px 0;font-size:10px}",
    ".uf-chart-tooltip .tt-stock .s-name{color:#9bb0c4}",
    ".uf-chart-tooltip .tt-stock .s-price{color:#edf4fc;font-weight:700}"
    "canvas.uf-hover-chart{cursor:crosshair}"
  ].join("");
  document.head.appendChild(style);

  function tooltip(){
    var el=document.getElementById("ufChartTooltip");
    if(!el){
      el=document.createElement("div");
      el.id="ufChartTooltip";
      el.className="uf-chart-tooltip";
      document.body.appendChild(el);
    }
    return el;
  }

  function formatDate(d){
    try{return new Date(d+"T12:00:00").toLocaleDateString("tr-TR",{day:"2-digit",month:"2-digit",year:"numeric"});}
    catch(e){return d;}
  }

  function signedMoney(v){
    var s=money(Math.abs(v));
    return (v>0?"+":v<0?"-":"")+s;
  }

  window.lineChart=function(c,labels,vals){
    if(!c) return;
    var ctx=c.getContext("2d"), dpr=window.devicePixelRatio||1;
    var w=c.clientWidth || (c.parentElement&&c.parentElement.clientWidth) || 600;
    var h=c.clientHeight || 290;

    c.width=w*dpr;
    c.height=h*dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    c.classList.add("uf-hover-chart");

    var data={
      labels:(labels||[]).slice(),
      vals:(vals||[]).map(Number)
    };
    c.__ufChartData=data;

    function draw(){
      ctx.clearRect(0,0,w,h);
      if(!data.vals.length) return;

      var pad=32, bottom=36;
      var min=Math.min.apply(Math,data.vals), max=Math.max.apply(Math,data.vals);
      var rng=max-min||1;
      var usableW=w-pad-14, usableH=h-60;

      ctx.strokeStyle="#1d344c";
      ctx.lineWidth=1;
      for(var i=0;i<5;i++){
        var gy=25+usableH*i/4;
        ctx.beginPath();
        ctx.moveTo(pad,gy);
        ctx.lineTo(w-10,gy);
        ctx.stroke();
      }

      ctx.strokeStyle="#5ca8ff";
      ctx.lineWidth=2.5;
      ctx.lineJoin="round";
      ctx.lineCap="round";
      ctx.beginPath();
      data.vals.forEach(function(v,i){
        var x=pad+usableW*i/(data.vals.length-1||1);
        var y=25+usableH*(1-(v-min)/rng);
        i?ctx.lineTo(x,y):ctx.moveTo(x,y);
      });
      ctx.stroke();

      if(c.__ufHoverIndex!=null && c.__ufHoverIndex>=0 && c.__ufHoverIndex<data.vals.length){
        var hi=c.__ufHoverIndex;
        var hx=pad+usableW*hi/(data.vals.length-1||1);
        var hy=25+usableH*(1-(data.vals[hi]-min)/rng);

        ctx.strokeStyle="rgba(143,196,255,.42)";
        ctx.lineWidth=1;
        ctx.beginPath();
        ctx.moveTo(hx,25);
        ctx.lineTo(hx,h-36);
        ctx.stroke();

        ctx.fillStyle="#0b1828";
        ctx.beginPath();
        ctx.arc(hx,hy,5,0,Math.PI*2);
        ctx.fill();
        ctx.strokeStyle="#8fc7ff";
        ctx.lineWidth=2;
        ctx.stroke();
      }

      ctx.fillStyle="#8fa6bd";
      ctx.font="10px Segoe UI";
      ctx.textAlign="left";
      if(data.labels.length){
        ctx.fillText(data.labels[0],pad,h-8);
        ctx.textAlign="right";
        ctx.fillText(data.labels[data.labels.length-1],w-10,h-8);
        ctx.textAlign="left";
      }
    }

    c.__ufDrawChart=draw;
    draw();

    if(!c.__ufHoverBound){
      c.__ufHoverBound=true;

      c.addEventListener("mousemove",function(e){
        var rect=c.getBoundingClientRect();
        if(!rect.width||!rect.height||!data.vals.length) return;

        var x=e.clientX-rect.left;
        var pad=32, usableW=rect.width-pad-14;
        var ratio=(x-pad)/usableW;
        var idx=Math.round(ratio*(data.vals.length-1));
        idx=Math.max(0,Math.min(data.vals.length-1,idx));
        c.__ufHoverIndex=idx;
        draw();

        var cur=data.vals[idx], prev=idx>0?data.vals[idx-1]:null;
        var delta=prev==null?null:cur-prev;
        var isDetail=c.id==="ufDetailChart";
        var title=isDetail?"Fiyat":"Portföy Değeri";
        var deltaLabel=isDetail?"Günlük değişim":"Günlük K/Z";

        var tip=tooltip();
        var html='<div class="tt-date">'+formatDate(data.labels[idx])+'</div>'+
          '<div class="tt-row"><span class="tt-label">'+title+'</span><span class="tt-value">'+money(cur)+'</span></div>'+
          (delta==null?"":'<div class="tt-row"><span class="tt-label">'+deltaLabel+'</span><span class="tt-value '+(delta>=0?"tt-up":"tt-down")+'">'+signedMoney(delta)+'</span></div>');

        if(!isDetail){
          var d=data.labels[idx];
          var stocks=[];
          (state.positions||[]).forEach(function(p){
            var rows=(state.priceHistory&&state.priceHistory[p.ticker])||[];
            var row=rows.find(function(r){return r.date===d});
            if(row) stocks.push([p.ticker,Number(row.close)||0]);
          });
          if(stocks.length){
            html+='<div class="tt-stock-list">'+
              stocks.map(function(x){
                return '<div class="tt-stock"><span class="s-name">'+x[0]+'</span><span class="s-price">'+n(x[1])+' TL</span></div>';
              }).join('')+
              '</div>';
          }
        }
        tip.innerHTML=html;

        tip.style.display="block";

        var left=e.clientX+14, top=e.clientY-12;
        var tw=tip.offsetWidth, th=tip.offsetHeight;
        if(left+tw>window.innerWidth-8) left=e.clientX-tw-14;
        if(top+th>window.innerHeight-8) top=window.innerHeight-th-8;
        if(top<8) top=8;
        tip.style.left=left+"px";
        tip.style.top=top+"px";
      });

      c.addEventListener("mouseleave",function(){
        c.__ufHoverIndex=null;
        draw();
        var tip=document.getElementById("ufChartTooltip");
        if(tip) tip.style.display="none";
      });
    }
  };
})();


// === Historical date snapshot on chart click ===
(function(){
  if(window.__ufHistoricalSnapshotInstalled) return;
  window.__ufHistoricalSnapshotInstalled=true;

  function ensureSnapshotUI(){
    if(document.getElementById("ufHistoryModal")) return;
    var st=document.createElement("style");
    st.textContent=[
      ".uf-history-modal{position:fixed;inset:0;z-index:11000;background:rgba(1,7,13,.82);display:none;align-items:center;justify-content:center;padding:18px}",
      ".uf-history-box{width:min(1180px,96vw);max-height:92vh;overflow:auto;background:#0b1828;border:1px solid #2b4864;border-radius:20px;padding:20px;box-shadow:0 25px 90px rgba(0,0,0,.55)}",
      ".uf-history-head{display:flex;justify-content:space-between;align-items:flex-start;gap:15px;margin-bottom:15px}",
      ".uf-history-title{font-size:24px;font-weight:850}.uf-history-sub{font-size:11px;color:#8fa6bd;margin-top:4px}",
      ".uf-history-close{border:1px solid #294865;background:#10233a;color:#fff;border-radius:9px;padding:7px 10px;cursor:pointer}",
      ".uf-history-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin-bottom:15px}",
      ".uf-history-kpi{background:#0d2034;border:1px solid #213f5d;border-radius:12px;padding:12px}",
      ".uf-history-kpi .l{font-size:10px;color:#8fa6bd}.uf-history-kpi .v{font-size:17px;font-weight:850;margin-top:5px}",
      ".uf-history-table{border-collapse:collapse;width:100%;font-size:11px}.uf-history-table th,.uf-history-table td{padding:9px 10px;border-bottom:1px solid #193149;white-space:nowrap;text-align:right}",
      ".uf-history-table th{background:#0c1b2c;color:#93abc2;position:sticky;top:0}.uf-history-table th:first-child,.uf-history-table td:first-child{text-align:left}",
      ".uf-history-table tr:hover td{background:rgba(34,81,126,.14)}",
      "@media(max-width:900px){.uf-history-kpis{grid-template-columns:repeat(2,1fr)}.uf-history-table{font-size:10px}.uf-history-table th,.uf-history-table td{padding:7px 8px}}"
    ].join("");
    document.head.appendChild(st);

    var m=document.createElement("div");
    m.id="ufHistoryModal";
    m.className="uf-history-modal";
    m.innerHTML='<div class="uf-history-box">'+
      '<div class="uf-history-head"><div><div class="uf-history-title" id="ufHistoryTitle">Tarih</div><div class="uf-history-sub" id="ufHistorySub"></div></div><button class="uf-history-close" id="ufHistoryClose">Kapat</button></div>'+
      '<div class="uf-history-kpis" id="ufHistoryKpis"></div>'+
      '<div class="tablewrap"><table class="uf-history-table"><thead><tr>'+
      '<th>Hisse</th><th>Adet</th><th>Fiyat</th><th>Değer</th><th>Maliyet</th><th>K/Z</th><th>Günlük K/Z</th><th>Günlük %</th><th>Ağırlık</th>'+
      '</tr></thead><tbody id="ufHistoryBody"></tbody></table></div>'+
      '</div>';
    document.body.appendChild(m);
    document.getElementById("ufHistoryClose").onclick=function(){m.style.display="none"};
    m.onclick=function(e){if(e.target===m)m.style.display="none"};
  }

  function txsForTicker(ticker){
    return (state.transactions||[]).filter(function(t){return t.ticker===ticker}).sort(function(a,b){return a.date.localeCompare(b.date)});
  }

  // Reconstructs quantity and average cost on a historical date using the
  // same moving-average logic used when transactions are recorded.
  function historicalPosition(p,date){
    var txs=txsForTicker(p.ticker);
    if(!txs.length) return {qty:Number(p.qty)||0,avgCost:Number(p.avgCost)||0};

    var qty=Number(p.qty)||0;
    var cost=qty*(Number(p.avgCost)||0);

    for(var i=txs.length-1;i>=0;i--){
      var t=txs[i], q=Number(t.qty)||0;
      if(t.date<=date) break;

      if(t.side==="ALIŞ"){
        qty-=q;
        cost-=q*(Number(t.price)||0)+(Number(t.fee)||0);
      }else{
        var avgAfter=qty>0?cost/qty:0;
        if(qty<=0 && q>0){
          avgAfter=(Number(t.price)||0)-((Number(t.realized)||0)+(Number(t.fee)||0))/q;
        }
        qty+=q;
        cost=qty*avgAfter;
      }
    }
    if(qty<0 && Math.abs(qty)<1e-9) qty=0;
    return {qty:Math.max(0,qty),avgCost:qty>0?cost/qty:0};
  }

  function historicalCash(date){
    var cash=Number(state.cash)||0;
    var txs=(state.transactions||[]).slice().sort(function(a,b){return a.date.localeCompare(b.date)});
    for(var i=txs.length-1;i>=0;i--){
      var t=txs[i];
      if(t.date<=date) break;
      var q=Number(t.qty)||0,p=Number(t.price)||0,fee=Number(t.fee)||0;
      var effect=t.side==="ALIŞ"?-(q*p+fee):(q*p-fee);
      cash-=effect;
    }
    return cash;
  }

  function rowForDate(ticker,date){
    var rows=(state.priceHistory&&state.priceHistory[ticker])||[];
    if(!rows.length) return null;
    var exact=rows.find(function(r){return r.date===date});
    if(exact) return exact;
    // For a non-trading date, use the latest available close before it.
    var prior=rows.filter(function(r){return r.date<date}).at(-1);
    return prior||null;
  }

  function previousRow(ticker,date){
    var rows=(state.priceHistory&&state.priceHistory[ticker])||[];
    var idx=-1;
    for(var i=0;i<rows.length;i++){if(rows[i].date===date){idx=i;break}}
    if(idx>0) return rows[idx-1];
    if(idx===-1){
      var prior=rows.filter(function(r){return r.date<date});
      return prior.length?prior.at(-1):null;
    }
    return null;
  }

  function showHistoricalSnapshot(date){
    ensureSnapshotUI();
    var rows=[];
    var totalValue=0,totalCost=0,totalDaily=0;
    state.positions.forEach(function(p){
      var hp=historicalPosition(p,date);
      if(hp.qty<=0) return;
      var pr=rowForDate(p.ticker,date);
      if(!pr) return;
      var price=Number(pr.close)||0;
      var value=hp.qty*price;
      var cost=hp.qty*hp.avgCost;
      var prev=previousRow(p.ticker,pr.date);
      var daily=prev?hp.qty*(price-Number(prev.close)):0;
      var dp=prev&&Number(prev.close)?price/Number(prev.close)-1:0;
      rows.push({ticker:p.ticker,qty:hp.qty,price:price,value:value,cost:cost,pnl:value-cost,daily:daily,dp:dp});
      totalValue+=value;totalCost+=cost;totalDaily+=daily;
    });

    rows.sort(function(a,b){return b.value-a.value});
    var cash=historicalCash(date);
    var net=totalValue+cash;
    var totalPnL=totalValue-totalCost;
    var ret=totalCost?totalPnL/totalCost:0;
    var biggestGain=rows.length?rows.slice().sort(function(a,b){return b.pnl-a.pnl})[0]:null;
    var biggestLoss=rows.length?rows.slice().sort(function(a,b){return a.pnl-b.pnl})[0]:null;

    document.getElementById("ufHistoryTitle").textContent=fmt(date);
    document.getElementById("ufHistorySub").textContent=rows.length+" pozisyon • o güne ait kapanış fiyatları ve portföy dağılımı";

    var k=[
      ["PORTFÖY DEĞERİ",money(totalValue),"up"],
      ["NAKİT",money(cash),cash>=0?"up":"down"],
      ["TOPLAM VARLIK",money(net),net>=0?"up":""],
      ["TOPLAM K/Z",money(totalPnL),totalPnL>=0?"up":"down"],
      ["GÜNLÜK K/Z",money(totalDaily),totalDaily>=0?"up":"down"],
      ["GETİRİ",pc(ret),ret>=0?"up":"down"],
      ["POZİSYON",String(rows.length),""] ,
      ["EN BÜYÜK KAZANÇ",biggestGain?biggestGain.ticker+" • "+money(biggestGain.pnl):"-","up"],
      ["EN BÜYÜK ZARAR",biggestLoss?biggestLoss.ticker+" • "+money(biggestLoss.pnl):"-","down"],
      ["AĞIRLIKLI K/Z",money(totalPnL),"up"]
    ];
    document.getElementById("ufHistoryKpis").innerHTML=k.map(function(x){
      return '<div class="uf-history-kpi"><div class="l">'+x[0]+'</div><div class="v '+x[2]+'">'+x[1]+'</div></div>';
    }).join("");

    document.getElementById("ufHistoryBody").innerHTML=rows.map(function(x){
      var w=totalValue?x.value/totalValue:0;
      return '<tr>'+
        '<td><b>'+x.ticker+'</b></td>'+
        '<td>'+n(x.qty)+'</td>'+
        '<td>'+n(x.price)+' TL</td>'+
        '<td>'+money(x.value)+'</td>'+
        '<td>'+money(x.cost)+'</td>'+
        '<td class="'+(x.pnl>=0?"up":"down")+'">'+money(x.pnl)+'</td>'+
        '<td class="'+(x.daily>=0?"up":"down")+'">'+signedMoney(x.daily)+'</td>'+
        '<td class="'+(x.dp>=0?"up":"down")+'">'+pc(x.dp)+'</td>'+
        '<td>'+pc(w)+'</td>'+
      '</tr>';
    }).join("") || '<tr><td colspan="9" class="muted">Bu tarih için fiyat geçmişinde veri bulunamadı.</td></tr>';

    document.getElementById("ufHistoryModal").style.display="flex";
  }

    window.showHistoricalSnapshot=showHistoricalSnapshot;
  function chartDataForCanvas(c){
    if(c.__ufChartData && c.__ufChartData.labels && c.__ufChartData.labels.length) return c.__ufChartData;
    var days=30;
    var active=document.querySelector("#ufPeriods button.active");
    if(active && active.dataset && active.dataset.d) days=Number(active.dataset.d)||30;
    var dates=new Set();
    Object.values(state.priceHistory||{}).forEach(function(rows){
      (rows||[]).forEach(function(r){if(r && r.date)dates.add(r.date);});
    });
    var ds=Array.from(dates).sort().slice(-days);
    var vals=ds.map(function(d){
      var total=0,has=false;
      (state.positions||[]).forEach(function(p){
        var rows=(state.priceHistory&&state.priceHistory[p.ticker])||[];
        var row=rows.find(function(r){return r.date===d});
        if(row){total+=(Number(p.qty)||0)*(Number(row.close)||0);has=true;}
      });
      return has?total:null;
    });
    var labels=[],out=[];
    ds.forEach(function(d,i){if(vals[i]!=null){labels.push(d);out.push(vals[i]);}});
    var data={labels:labels,vals:out};
    c.__ufChartData=data;
    return data;
  }

  function bindChartClick(c){
    if(!c || c.__ufHistoryClickBound) return;
    c.__ufHistoryClickBound=true;
    c.addEventListener("click",function(e){
      var data=chartDataForCanvas(c);
      if(!data || !data.labels.length) return;
      var rect=c.getBoundingClientRect();
      var pad=32,usableW=rect.width-pad-14;
      var x=e.clientX-rect.left;
      var ratio=(x-pad)/usableW;
      var idx=Math.round(ratio*(data.labels.length-1));
      idx=Math.max(0,Math.min(data.labels.length-1,idx));
      var date=data.labels[idx];
      if(date && typeof window.showHistoricalSnapshot==="function") window.showHistoricalSnapshot(date);
    });
  }

  var oldLine=window.lineChart;
  window.lineChart=function(c,labels,vals){
    oldLine(c,labels,vals);
    bindChartClick(c);
  };

  // Extra robust click handling: use one document-level listener so clicks keep
  // working even when the chart is re-rendered or its event handlers are replaced.
  if(!window.__ufHistoryDocumentClickBound){
    window.__ufHistoryDocumentClickBound=true;
    document.addEventListener("click",function(e){
      var canvas=e.target && e.target.closest ? e.target.closest("#valueChart,#perfChart") : null;
      if(!canvas || !document.body.contains(canvas)) return;

      var data=chartDataForCanvas(canvas);
      if(!data || !data.labels || !data.labels.length) return;

      var rect=canvas.getBoundingClientRect();
      if(!rect.width) return;

      var pad=32, usableW=Math.max(1,rect.width-pad-14);
      var x=e.clientX-rect.left;
      var ratio=(x-pad)/usableW;
      ratio=Math.max(0,Math.min(1,ratio));
      var idx=Math.round(ratio*(data.labels.length-1));
      idx=Math.max(0,Math.min(data.labels.length-1,idx));
      var date=data.labels[idx];

      if(date && typeof window.showHistoricalSnapshot==="function"){
        window.showHistoricalSnapshot(date);
      }
    },true);
  }

  ensureSnapshotUI();
  setTimeout(function(){
    document.querySelectorAll("canvas").forEach(bindChartClick);
  },500);
})();
