import fs from "node:fs/promises";
import path from "node:path";

const DATA = path.join(process.cwd(), "public", "data");
const LIVE = path.join(DATA, "live.json");
const HISTORY = path.join(DATA, "history.json");

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const now = new Date();
const endDate = now.toISOString().slice(0,10);
const startDate = new Date(now.getTime()-120*86400000).toISOString().slice(0,10);

const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function readJson(file, fallback){ try{return JSON.parse(await fs.readFile(file,"utf8"))}catch{return fallback} }
async function fetchText(url, {accept="*/*"}={}) {
  let last;
  for (let attempt=0; attempt<4; attempt++) {
    const ctl=new AbortController(); const timer=setTimeout(()=>ctl.abort(),25000);
    try {
      const r=await fetch(url,{
        signal:ctl.signal,
        redirect:"follow",
        headers:{
          "user-agent":UA,
          "accept":accept,
          "accept-language":"zh-CN,zh;q=0.9,en;q=0.7",
          "referer":"https://www.chinamoney.com.cn/",
          "cache-control":"no-cache"
        }
      });
      if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const txt=await r.text();
      if(!txt || txt.length<3) throw new Error("empty response");
      return txt;
    } catch(e){ last=e; await sleep(700*(attempt+1)); }
    finally{ clearTimeout(timer); }
  }
  throw last;
}
async function fetchJson(url){
  const t=await fetchText(url,{accept:"application/json,text/plain,*/*"});
  return JSON.parse(t);
}
function n(v){ if(v==null||v==="")return null; const x=Number(String(v).replace(/,/g,"").replace("%","").trim()); return Number.isFinite(x)?x:null; }
function d(v){ const m=String(v||"").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/); return m?`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`:null; }
function csvRows(text){ return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>line.split(",").map(x=>x.trim().replace(/^"|"$/g,""))); }
function metric(value,date,sourceId,status="official"){ const x=n(value); return x==null?null:{value:x,date:date||null,unit:"%",sourceId,status}; }
function merge(next,prev){ return next ?? (prev?{...prev,status:"fallback-last-verified"}:null); }

async function cfetsCsvCode(code){
  const q=new URLSearchParams({startDate,endDate}).toString();
  const url=`https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/${code}?${q}`;
  const j=await fetchJson(url);
  const text=j?.data?.csv;
  if(typeof text!=="string" || !text.includes(",")) throw new Error(`${code}: data.csv missing`);
  return text;
}

async function getLpr(){
  const rows=csvRows(await cfetsCsvCode("LprChrtCSV"))
    .map(r=>({r,date:d(r[0])})).filter(x=>x.date).sort((a,b)=>b.date.localeCompare(a.date));
  const row=rows.find(x=>n(x.r[6])!=null || n(x.r[7])!=null);
  if(!row) throw new Error("LPR: no usable row");
  return {
    lpr1y: metric(row.r[6],row.date,"CFETS_LPR"),
    lpr5y: metric(row.r[7],row.date,"CFETS_LPR")
  };
}

async function getShibor(){
  const text=await cfetsCsvCode("ShiborPriHis");
  const rows=csvRows(text).map(r=>({r,date:d(r[0])})).filter(x=>x.date).sort((a,b)=>b.date.localeCompare(a.date));
  const row=rows.find(x=>x.r.slice(1).filter(v=>n(v)!=null).length>=3);
  if(!row) throw new Error("Shibor: no usable row");
  // CFETS ShiborPriHis order is date, O/N, 1W, 2W, 1M, 3M, 6M, 9M, 1Y
  return {
    shiborON:metric(row.r[1],row.date,"CFETS_SHIBOR"),
    shibor1W:metric(row.r[2],row.date,"CFETS_SHIBOR"),
    shibor1M:metric(row.r[4],row.date,"CFETS_SHIBOR")
  };
}

async function getRepo(){
  const one=async (url,prefix)=>{
    const rows=csvRows(await fetchText(url,{accept:"text/csv,text/plain,*/*"}))
      .map(r=>({r,date:d(r[0])})).filter(x=>x.date).sort((a,b)=>b.date.localeCompare(a.date));
    const row=rows.find(x=>n(x.r[1])!=null && n(x.r[2])!=null);
    if(!row) throw new Error(`${prefix}: no usable row`);
    return {
      [`${prefix}001`]:metric(row.r[1],row.date,"CFETS_REPO"),
      [`${prefix}007`]:metric(row.r[2],row.date,"CFETS_REPO")
    };
  };
  const [fr,fdr]=await Promise.all([
    one("https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/frr-chrt.csv","fr"),
    one("https://www.chinamoney.com.cn/r/cms/www/chinamoney/data/currency/fdr-chrt.csv","fdr")
  ]);
  return {...fr,...fdr};
}
function stripHtml(s){ return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim(); }
function abs(base,href){ try{return new URL(href,base).href}catch{return null} }
async function getOmo(){
  const hubs=[
    "https://www.chinamoney.com.cn/chinese/scggyhywgggksccz/",
    "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html"
  ];
  let links=[];
  for(const hub of hubs){
    try{
      const html=await fetchText(hub,{accept:"text/html,*/*"});
      links.push(...[...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map(m=>({url:abs(hub,m[1]),text:stripHtml(m[2])}))
        .filter(x=>x.url && /公开市场|逆回购|操作公告/.test(x.text+x.url)));
      if(links.length) break;
    }catch{}
  }
  links=links.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,25);
  if(!links.length) throw new Error("OMO: no announcement links");
  const ops=[];
  for(const l of links.slice(0,15)){
    try{
      const h=await fetchText(l.url,{accept:"text/html,*/*"}); const t=stripHtml(h);
      const date=d(t)||d(l.url);
      const amt=(t.match(/(?:开展|操作量|中标量)[^\d]{0,30}([\d,.]+)\s*亿元/)||t.match(/([\d,.]+)\s*亿元[\s\S]{0,50}?7\s*天/))?.[1];
      const rate=(t.match(/7\s*天[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*%/)||t.match(/中标利率[^\d]{0,15}(\d+(?:\.\d+)?)\s*%/))?.[1];
      if(date && n(amt)!=null) ops.push({date,maturityDays:7,amountCnyBn:+(n(amt)/10).toFixed(1),ratePct:n(rate),sourceUrl:l.url,sourceId:"PBOC_OMO",status:"official-public-release"});
    }catch{}
  }
  ops.sort((a,b)=>b.date.localeCompare(a.date));
  if(!ops.length) throw new Error("OMO: announcements found but no operation normalized");
  return ops;
}

const previous=await readJson(LIVE,{});
const out=structuredClone(previous||{});
out.schema=2; out.generatedAt=now.toISOString();
out.beijingTime=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"medium",hour12:false}).format(now).replace(" ","T")+"+08:00";
out.sourceHealth={}; out.warnings=[];

async function source(id,fn){
  try{ const v=await fn(); out.sourceHealth[id]={state:"ok",checkedAt:now.toISOString()}; return v; }
  catch(e){ out.sourceHealth[id]={state:"fallback",checkedAt:now.toISOString(),message:String(e?.message||e).slice(0,220)}; out.warnings.push(`${id}: ${String(e?.message||e).slice(0,140)}`); return null; }
}

const [lpr,shibor,repo,omo]=await Promise.all([
  source("CFETS_LPR",getLpr),
  source("CFETS_SHIBOR",getShibor),
  source("CFETS_REPO",getRepo),
  source("PBOC_OMO",getOmo)
]);

out.policy ||= {};
for(const k of ["lpr1y","lpr5y"]) out.policy[k]=merge(lpr?.[k],previous?.policy?.[k]);
out.moneyMarket ||= {};
for(const k of ["shiborON","shibor1W","shibor1M"]) out.moneyMarket[k]=merge(shibor?.[k],previous?.moneyMarket?.[k]);
for(const k of ["fr001","fr007","fdr001","fdr007"]) out.moneyMarket[k]=merge(repo?.[k],previous?.moneyMarket?.[k]);

out.omo ||= {recent:[]};
if(omo?.length){ out.omo.latest=omo[0]; out.omo.recent=omo.slice(0,20); }
else { out.omo.latest=previous?.omo?.latest??null; out.omo.recent=previous?.omo?.recent??[]; }

const today=out.omo?.latest?.date;
if(today){
  const x=new Date(today+"T00:00:00Z"); x.setUTCDate(x.getUTCDate()-7); const expiry=x.toISOString().slice(0,10);
  const matured=(out.omo.recent||[]).find(o=>o.date===expiry);
  out.omo.sevenDayNetFlowCnyBn=matured && Number.isFinite(out.omo.latest.amountCnyBn) ? +(out.omo.latest.amountCnyBn-matured.amountCnyBn).toFixed(1) : (previous?.omo?.sevenDayNetFlowCnyBn??null);
}else out.omo.sevenDayNetFlowCnyBn=previous?.omo?.sevenDayNetFlowCnyBn??null;

let score=0,parts=0;
const net=out.omo?.sevenDayNetFlowCnyBn;
if(Number.isFinite(net)){ score+=Math.max(-2,Math.min(2,net/60)); parts++; }
const on=out.moneyMarket?.shiborON?.value, fdr7=out.moneyMarket?.fdr007?.value;
if(Number.isFinite(on)&&Number.isFinite(fdr7)){ score+=Math.max(-1.5,Math.min(1.5,(fdr7-on)*3)); parts++; }
let label="INSUFFICIENT DATA";
if(parts){ score=+score.toFixed(2); label=score>.55?"INJECTING":score<-.55?"DRAINING":"NEUTRAL"; } else score=null;
out.liquidityRegime={label,score,method:"BondStats composite from official PBoC OMO flow and CFETS money-market benchmarks; not an official PBoC classification."};

const health=Object.values(out.sourceHealth);
out.status=health.every(x=>x.state==="ok")?"current":health.some(x=>x.state==="ok")?"current-with-fallbacks":"fallback-only";
out.freshness={state:out.status,ageMinutes:0};

const hist=await readJson(HISTORY,[]);
hist.push({generatedAt:out.generatedAt,policy:out.policy,moneyMarket:out.moneyMarket,omo:{latest:out.omo.latest,sevenDayNetFlowCnyBn:out.omo.sevenDayNetFlowCnyBn},liquidityRegime:out.liquidityRegime});
await fs.writeFile(LIVE,JSON.stringify(out,null,2)+"\n");
await fs.writeFile(HISTORY,JSON.stringify(hist.slice(-3000),null,2)+"\n");
console.log(JSON.stringify({status:out.status,sourceHealth:out.sourceHealth},null,2));
