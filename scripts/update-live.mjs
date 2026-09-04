import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "public", "data");
const LIVE = path.join(DATA, "live.json");
const HISTORY = path.join(DATA, "history.json");

const UA = "BondStats-China-Liquidity-Monitor/1.0 (+https://www.bondstats.org)";
const now = new Date();
const fmtDate = d => d.toISOString().slice(0,10);
const start = new Date(now.getTime() - 45*86400000);
const startDate = fmtDate(start), endDate = fmtDate(now);

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}
async function fetchText(url, opts={}) {
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), 20000);
  try {
    const r = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: {
        "user-agent": UA,
        "accept-language":"zh-CN,zh;q=0.9,en;q=0.7",
        "accept": opts.accept || "*/*",
        ...(opts.headers||{})
      }
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return await r.text();
  } finally { clearTimeout(t); }
}
async function fetchJson(url) {
  const txt = await fetchText(url, {accept:"application/json,text/plain,*/*"});
  return JSON.parse(txt);
}

function num(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function dateish(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
}
function flatten(x, out=[]) {
  if (Array.isArray(x)) for (const v of x) flatten(v,out);
  else if (x && typeof x==="object") { out.push(x); for (const v of Object.values(x)) if (v && typeof v==="object") flatten(v,out); }
  return out;
}
function pickRecord(records, predicate) {
  return records.filter(predicate).sort((a,b)=>String(dateish(b.date||b.showDate||b.tradeDate||b.dateValue||"")||"").localeCompare(String(dateish(a.date||a.showDate||a.tradeDate||a.dateValue||"")||"")))[0] || null;
}
function getByKeys(obj, keys) {
  for (const k of keys) if (obj && obj[k] != null && obj[k] !== "") return obj[k];
  const entries = Object.entries(obj||{});
  for (const [k,v] of entries) {
    const lk = k.toLowerCase();
    if (keys.some(x=>lk===x.toLowerCase() || lk.includes(x.toLowerCase()))) return v;
  }
  return null;
}
function metric(value, date, sourceId, status="official") {
  const n = num(value);
  if (n == null) return null;
  return {value:n, date:date||null, unit:"%", sourceId, status};
}

async function getShibor() {
  const url = `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-shibor/ShiborHis?lang=CN&startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=200`;
  const j = await fetchJson(url);
  const recs = flatten(j);
  const dated = recs.map(r=>({...r,__d:dateish(getByKeys(r,["date","showDate","tradeDate","dateValue","showDateCN"]))})).filter(r=>r.__d);
  dated.sort((a,b)=>b.__d.localeCompare(a.__d));
  const latest = dated[0];
  if (!latest) throw new Error("No dated Shibor record found");
  const mapping = {
    shiborON:["ON","O/N","shiborON","on","overnight"],
    shibor1W:["1W","1w","shibor1W","oneWeek"],
    shibor1M:["1M","1m","shibor1M","oneMonth"]
  };
  const out={};
  for (const [name,keys] of Object.entries(mapping)) {
    const val=getByKeys(latest,keys);
    if (num(val)!=null) out[name]=metric(val,latest.__d,"CFETS_SHIBOR");
  }
  // Some API shapes are row-per-tenor rather than wide.
  if (Object.keys(out).length < 2) {
    for (const r of dated) {
      if (r.__d !== dated[0].__d) continue;
      const tenor=String(getByKeys(r,["term","tenor","shiborTerm","termName","name"])||"").toUpperCase();
      const val=getByKeys(r,["rate","shibor","value","interestRate"]);
      if (/^(O\/?N|ON|OVERNIGHT)$/.test(tenor) && num(val)!=null) out.shiborON=metric(val,r.__d,"CFETS_SHIBOR");
      if (/^(1W|1 WEEK)/.test(tenor) && num(val)!=null) out.shibor1W=metric(val,r.__d,"CFETS_SHIBOR");
      if (/^(1M|1 MONTH)/.test(tenor) && num(val)!=null) out.shibor1M=metric(val,r.__d,"CFETS_SHIBOR");
    }
  }
  if (!out.shiborON && !out.shibor1W && !out.shibor1M) throw new Error("Could not normalize Shibor API response");
  return out;
}

async function getLpr() {
  const urls = [
    `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis?lang=CN&startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=100`,
    "https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/LprHis?lang=CN"
  ];
  let lastErr;
  for (const url of urls) {
    try {
      const j=await fetchJson(url);
      const recs=flatten(j).map(r=>({...r,__d:dateish(getByKeys(r,["date","showDate","tradeDate","releaseDate"]))})).filter(r=>r.__d);
      recs.sort((a,b)=>b.__d.localeCompare(a.__d));
      for (const r of recs) {
        const v1=getByKeys(r,["1Y","1y","lpr1y","oneYear","loanPrimeRate1Y"]);
        const v5=getByKeys(r,["5Y","5y","lpr5y","fiveYear","loanPrimeRate5Y","5YAbove"]);
        if (num(v1)!=null || num(v5)!=null) return {
          lpr1y: num(v1)!=null ? metric(v1,r.__d,"CFETS_LPR") : null,
          lpr5y: num(v5)!=null ? metric(v5,r.__d,"CFETS_LPR") : null
        };
      }
      // row-per-tenor fallback
      const byDate={};
      for (const r of recs) {
        byDate[r.__d] ||= {};
        const tenor=String(getByKeys(r,["term","tenor","name","rateType"])||"").toUpperCase();
        const val=getByKeys(r,["rate","value","lpr"]);
        if (/1Y|1 YEAR/.test(tenor) && num(val)!=null) byDate[r.__d].lpr1y=metric(val,r.__d,"CFETS_LPR");
        if (/5Y|5 YEAR/.test(tenor) && num(val)!=null) byDate[r.__d].lpr5y=metric(val,r.__d,"CFETS_LPR");
      }
      for (const d of Object.keys(byDate).sort().reverse()) if (byDate[d].lpr1y || byDate[d].lpr5y) return byDate[d];
    } catch(e){ lastErr=e; }
  }
  throw lastErr || new Error("LPR unavailable");
}

function parseCsv(text) {
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>line.split(",").map(x=>x.trim().replace(/^"|"$/g,"")));
}
async function getRepo() {
  const [frrTxt,fdrTxt]=await Promise.all([
    fetchText("https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/frr-chrt.csv"),
    fetchText("https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/fdr-chrt.csv")
  ]);
  const latestRow = txt => {
    const rows=parseCsv(txt).filter(r=>dateish(r[0]));
    rows.sort((a,b)=>(dateish(b[0])||"").localeCompare(dateish(a[0])||""));
    return rows[0];
  };
  const f=latestRow(frrTxt), d=latestRow(fdrTxt);
  if (!f && !d) throw new Error("No repo fixing observations");
  return {
    fr001: f ? metric(f[1],dateish(f[0]),"CFETS_REPO") : null,
    fr007: f ? metric(f[2],dateish(f[0]),"CFETS_REPO") : null,
    fdr001:d ? metric(d[1],dateish(d[0]),"CFETS_REPO") : null,
    fdr007:d ? metric(d[2],dateish(d[0]),"CFETS_REPO") : null
  };
}

function absolute(base, href) { try { return new URL(href,base).href; } catch { return null; } }
function stripHtml(s) { return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim(); }

async function getOmoRecent() {
  const hub="https://www.chinamoney.com.cn/chinese/scggyhywgggksccz/";
  const html=await fetchText(hub,{accept:"text/html,*/*"});
  const links=[...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(m=>({url:absolute(hub,m[1]),text:stripHtml(m[2])}))
    .filter(x=>x.url && /公开市场业务交易公告|公开市场操作/.test(x.text+x.url))
    .filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i)
    .slice(0,20);
  if (!links.length) throw new Error("OMO hub returned no announcement links");

  const ops=[];
  for (const l of links.slice(0,12)) {
    try {
      const h=await fetchText(l.url,{accept:"text/html,*/*"});
      const t=stripHtml(h);
      const dt=dateish(t) || dateish(l.url);
      if (!dt) continue;
      const rateM=t.match(/7\s*天[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*%/);
      const amtM=t.match(/(?:开展了|中标量|操作量)[^\d]{0,20}([\d,.]+)\s*亿元/) || t.match(/7\s*天[\s\S]{0,150}?([\d,.]+)\s*亿元/);
      const amount=num(amtM?.[1]);
      const rate=num(rateM?.[1]);
      if (amount!=null) ops.push({date:dt,maturityDays:7,amountCnyBn:amount/10,ratePct:rate,sourceUrl:l.url,sourceId:"PBOC_OMO",status:"official-public-release"});
    } catch {}
  }
  ops.sort((a,b)=>b.date.localeCompare(a.date));
  if (!ops.length) throw new Error("No normalized 7D OMO announcements");
  return ops;
}

function lastGood(current, pathArr) {
  let x=current;
  for (const k of pathArr) x=x?.[k];
  return x ?? null;
}
function mergeMetric(next, prev) { return next ?? (prev ? {...prev,status:"fallback-last-verified"} : null); }

const previous=await readJson(LIVE,{});
const out=structuredClone(previous);
out.schema=1;
out.generatedAt=now.toISOString();
out.beijingTime=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"medium",hour12:false}).format(now).replace(" ","T")+"+08:00";
out.sourceHealth={};
out.warnings=[];

async function runSource(id, fn) {
  try {
    const value=await fn();
    out.sourceHealth[id]={state:"ok",checkedAt:now.toISOString()};
    return value;
  } catch(e) {
    out.sourceHealth[id]={state:"fallback",checkedAt:now.toISOString(),message:String(e?.message||e).slice(0,240)};
    out.warnings.push(`${id}: using last verified data because current fetch/normalization failed.`);
    return null;
  }
}

const [shibor,lpr,repo,omo]=await Promise.all([
  runSource("CFETS_SHIBOR",getShibor),
  runSource("CFETS_LPR",getLpr),
  runSource("CFETS_REPO",getRepo),
  runSource("PBOC_OMO",getOmoRecent)
]);

out.moneyMarket ||= {};
for (const k of ["shiborON","shibor1W","shibor1M"]) out.moneyMarket[k]=mergeMetric(shibor?.[k],lastGood(previous,["moneyMarket",k]));
for (const k of ["fr001","fr007","fdr001","fdr007"]) out.moneyMarket[k]=mergeMetric(repo?.[k],lastGood(previous,["moneyMarket",k]));

out.policy ||= {};
for (const k of ["lpr1y","lpr5y"]) out.policy[k]=mergeMetric(lpr?.[k],lastGood(previous,["policy",k]));

out.omo ||= {recent:[]};
if (omo?.length) {
  out.omo.latest=omo[0];
  out.omo.recent=omo.slice(0,14);
  const latestDate=omo[0].date;
  const todayOp=omo.find(x=>x.date===latestDate);
  const expiryDate=new Date(latestDate+"T00:00:00Z");
  expiryDate.setUTCDate(expiryDate.getUTCDate()-7);
  const prior=omo.find(x=>x.date===fmtDate(expiryDate));
  out.omo.sevenDayNetFlowCnyBn=(todayOp && prior) ? +(todayOp.amountCnyBn-prior.amountCnyBn).toFixed(1) : null;
} else {
  out.omo.latest=previous?.omo?.latest ?? null;
  out.omo.recent=previous?.omo?.recent ?? [];
  out.omo.sevenDayNetFlowCnyBn=previous?.omo?.sevenDayNetFlowCnyBn ?? null;
}

const vals=[
  out.moneyMarket?.shiborON?.value,
  out.moneyMarket?.fr007?.value,
  out.moneyMarket?.fdr007?.value
].filter(Number.isFinite);
const net=out.omo?.sevenDayNetFlowCnyBn;
let score=null,label="INSUFFICIENT DATA";
if (Number.isFinite(net) || vals.length>=2) {
  score=0;
  if (Number.isFinite(net)) score += Math.max(-2,Math.min(2,net/50));
  if (Number.isFinite(out.moneyMarket?.shiborON?.value) && Number.isFinite(out.moneyMarket?.fdr007?.value)) {
    score += Math.max(-1.5,Math.min(1.5,(out.moneyMarket.fdr007.value-out.moneyMarket.shiborON.value)*3));
  }
  score=+score.toFixed(2);
  label=score>0.55?"INJECTING":score<-0.55?"DRAINING":"NEUTRAL";
}
out.liquidityRegime={
  label,score,
  method:"BondStats composite based on official 7D OMO flow plus observable money-market conditions. It is an analytical indicator, not a PBoC classification."
};

const health=Object.values(out.sourceHealth);
out.status=health.some(x=>x.state==="fallback") ? "degraded-with-fallbacks" : "current";
out.freshness={state:out.status==="current"?"current":"mixed",ageMinutes:0};

const hist=await readJson(HISTORY,[]);
const snap={
  generatedAt:out.generatedAt,
  policy:out.policy,
  moneyMarket:out.moneyMarket,
  omo:{latest:out.omo.latest,sevenDayNetFlowCnyBn:out.omo.sevenDayNetFlowCnyBn},
  liquidityRegime:out.liquidityRegime
};
hist.push(snap);
const cutoff=Date.now()-400*86400000;
const compact=hist.filter(x=>Date.parse(x.generatedAt||0)>=cutoff).slice(-2500);

await fs.writeFile(LIVE,JSON.stringify(out,null,2)+"\n");
await fs.writeFile(HISTORY,JSON.stringify(compact,null,2)+"\n");
console.log(`Updated live.json: ${out.status}; regime=${label}; history=${compact.length}`);
