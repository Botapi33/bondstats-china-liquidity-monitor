import fs from "node:fs/promises";
import path from "node:path";

const DATA = path.join(process.cwd(), "public", "data");
const LIVE = path.join(DATA, "live.json");
const HISTORY = path.join(DATA, "history.json");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
const now = new Date();
const ymd = d => d.toISOString().slice(0,10);
const endDate = ymd(now);
const startDate = ymd(new Date(now.getTime()-45*86400000));

async function readJson(file, fallback){ try{return JSON.parse(await fs.readFile(file,"utf8"))}catch{return fallback} }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

async function fetchText(url,{accept="*/*",method="GET",body=null,headers={}}={}){
  let err;
  for(let i=0;i<4;i++){
    const c=new AbortController(); const t=setTimeout(()=>c.abort(),25000);
    try{
      const r=await fetch(url,{
        method,body,signal:c.signal,redirect:"follow",
        headers:{
          "user-agent":UA,
          "accept":accept,
          "accept-language":"zh-CN,zh;q=0.9,en;q=0.7",
          "referer":"https://www.chinamoney.com.cn/",
          "x-requested-with":"XMLHttpRequest",
          "cache-control":"no-cache",
          ...headers
        }
      });
      if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const x=await r.text();
      if(!x || x.length<3) throw new Error("empty response");
      return x;
    }catch(e){err=e;await sleep(600*(i+1))}
    finally{clearTimeout(t)}
  }
  throw err;
}
async function fetchJson(url,opts){ return JSON.parse(await fetchText(url,{accept:"application/json,text/plain,*/*",...(opts||{})})) }

function n(v){
  if(v==null||v==="") return null;
  const m=String(v).replace(/,/g,"").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
function dateOf(v){
  const m=String(v||"").match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
  return m?`${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`:null;
}
function metric(value,date,sourceId,status="official-last-published"){
  const x=n(value); return x==null?null:{value:x,date,unit:"%",sourceId,status};
}
function flatten(x,out=[]){
  if(Array.isArray(x)) for(const v of x) flatten(v,out);
  else if(x&&typeof x==="object"){out.push(x);for(const v of Object.values(x)) if(v&&typeof v==="object") flatten(v,out)}
  return out;
}
function valueByKey(obj,names){
  const ent=Object.entries(obj||{});
  for(const name of names){
    const hit=ent.find(([k])=>k.toLowerCase()===name.toLowerCase());
    if(hit && hit[1]!==null && hit[1]!=="") return hit[1];
  }
  for(const name of names){
    const hit=ent.find(([k])=>k.toLowerCase().includes(name.toLowerCase()));
    if(hit && hit[1]!==null && hit[1]!=="") return hit[1];
  }
  return null;
}
function rowDate(o){
  for(const k of ["date","showDate","tradeDate","dateValue","showDateCN","releaseDate","newDateValue"]){
    const d=dateOf(o?.[k]); if(d) return d;
  }
  for(const v of Object.values(o||{})){ const d=dateOf(v); if(d)return d }
  return null;
}
function merge(next,prev){
  return next ?? (prev?{...prev,status:"fallback-last-verified"}:null);
}
function csv(text){
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>line.split(",").map(v=>v.trim().replace(/^"|"$/g,"")));
}

/* ---------------- SHIBOR ---------------- */

function parseShiborObjects(j){
  const objs=flatten(j).filter(o=>rowDate(o));
  objs.sort((a,b)=>(rowDate(b)||"").localeCompare(rowDate(a)||""));
  for(const o of objs){
    const d=rowDate(o);
    const on=valueByKey(o,["on","o/n","shiborON","shiborO/N","overnight"]);
    const w1=valueByKey(o,["1w","shibor1W","oneWeek"]);
    const m1=valueByKey(o,["1m","shibor1M","oneMonth"]);
    if([on,w1,m1].filter(x=>n(x)!=null).length>=2){
      return {shiborON:metric(on,d,"CFETS_SHIBOR"),shibor1W:metric(w1,d,"CFETS_SHIBOR"),shibor1M:metric(m1,d,"CFETS_SHIBOR")};
    }
  }
  return null;
}
function parseShiborHtml(html){
  const text=html.replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ");
  const dates=[...text.matchAll(/20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g)].map(m=>dateOf(m[0])).filter(Boolean);
  const d=dates.sort().reverse()[0];
  if(!d) return null;
  const start=text.indexOf(d.replaceAll("-","/"))>=0?text.indexOf(d.replaceAll("-","/")):text.indexOf(d);
  const block=text.slice(Math.max(0,start),Math.max(0,start)+2500);
  const patterns={
    shiborON:/(?:O\/N|隔夜)\D{0,60}(\d+\.\d+)/i,
    shibor1W:/(?:1W|1周|7天)\D{0,60}(\d+\.\d+)/i,
    shibor1M:/(?:1M|1个月|1月)\D{0,60}(\d+\.\d+)/i
  };
  const out={}; for(const [k,re] of Object.entries(patterns)){const m=block.match(re);if(m)out[k]=metric(m[1],d,"CFETS_SHIBOR")}
  return Object.keys(out).length>=2?out:null;
}
async function getShibor(){
  const urls=[
    `https://www.chinamoney.com.cn/ags/ms/cm-u-bk-currency/ShiborPriHis?lang=CN&startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=100`,
    `https://www.chinamoney.org.cn/ags/ms/cm-u-bk-currency/ShiborPriHis?lang=CN&startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=100`
  ];
  for(const url of urls){
    try{const x=parseShiborObjects(await fetchJson(url)); if(x)return x}catch{}
  }
  const pages=[
    "https://www.shibor.org/r/cms/chinese/chinamoney/html/shiborOrg/shibor-tendays-show.html",
    "https://www.shibor.org/r/cms/chinese/chinamoney/html/shiborOrg/shibor-tendays-show-e.html",
    "https://www.chinamoney.com.cn/chinese/llshibor/"
  ];
  for(const url of pages){
    try{const x=parseShiborHtml(await fetchText(url,{accept:"text/html,*/*"}));if(x)return x}catch{}
  }
  throw new Error("No official SHIBOR source could be normalized");
}

/* ---------------- LPR ---------------- */

function parseLprObjects(j){
  const objs=flatten(j).filter(o=>rowDate(o));
  objs.sort((a,b)=>(rowDate(b)||"").localeCompare(rowDate(a)||""));
  for(const o of objs){
    const d=rowDate(o);
    const y1=valueByKey(o,["1Y","lpr1y","oneYear","loanPrimeRate1Y"]);
    const y5=valueByKey(o,["5Y","5YAbove","lpr5y","fiveYear","loanPrimeRate5Y"]);
    if(n(y1)!=null||n(y5)!=null) return {lpr1y:metric(y1,d,"CFETS_LPR"),lpr5y:metric(y5,d,"CFETS_LPR")};
  }
  return null;
}
async function getLpr(){
  for(const host of ["www.chinamoney.com.cn","www.chinamoney.org.cn"]){
    const url=`https://${host}/ags/ms/cm-u-bk-currency/LprChrtCSV?lang=CN&startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=100`;
    try{
      const j=await fetchJson(url);
      const direct=parseLprObjects(j); if(direct)return direct;
      const csvText=j?.data?.csv || j?.csv;
      if(typeof csvText==="string"){
        const rows=csv(csvText).map(r=>({r,d:dateOf(r[0])})).filter(x=>x.d).sort((a,b)=>b.d.localeCompare(a.d));
        for(const x of rows){
          const nums=x.r.slice(1).map(n).filter(v=>v!=null);
          if(nums.length>=2) return {lpr1y:metric(nums[0],x.d,"CFETS_LPR"),lpr5y:metric(nums[1],x.d,"CFETS_LPR")};
        }
      }
    }catch{}
  }
  throw new Error("No official LPR source could be normalized");
}

/* ---------------- FR / FDR ---------------- */

function parseRepoCsv(text,prefix){
  const rows=csv(text).map(r=>({r,d:dateOf(r[0])})).filter(x=>x.d).sort((a,b)=>b.d.localeCompare(a.d));
  const row=rows.find(x=>x.r.slice(1).filter(v=>n(v)!=null).length>=2);
  if(!row) return null;
  const vals=row.r.slice(1).map(n).filter(v=>v!=null);
  return {
    [`${prefix}001`]:metric(vals[0],row.d,"CFETS_REPO"),
    [`${prefix}007`]:metric(vals[1],row.d,"CFETS_REPO")
  };
}
async function oneRepo(kind,prefix){
  const file=kind==="FR"?"frr-chrt.csv":"fdr-chrt.csv";
  for(const host of ["www.chinamoney.com.cn","www.chinamoney.org.cn"]){
    try{
      const x=parseRepoCsv(await fetchText(`https://${host}/r/cms/www/chinamoney/data/currency/${file}`,{accept:"text/csv,text/plain,*/*"}),prefix);
      if(x)return x;
    }catch{}
  }
  const endpoint=kind==="FR"?"FrrHis":"FdrHis";
  for(const host of ["www.chinamoney.com.cn","www.chinamoney.org.cn"]){
    try{
      const j=await fetchJson(`https://${host}/ags/ms/cm-u-bk-currency/${endpoint}?startDate=${startDate}&endDate=${endDate}&pageNum=1&pageSize=100&lang=CN`);
      const objs=flatten(j).filter(o=>rowDate(o)).sort((a,b)=>(rowDate(b)||"").localeCompare(rowDate(a)||""));
      for(const o of objs){
        const dd=rowDate(o);
        const v1=valueByKey(o,[`${kind}001`,`${prefix}001`,"001"]);
        const v7=valueByKey(o,[`${kind}007`,`${prefix}007`,"007"]);
        if(n(v1)!=null&&n(v7)!=null) return {[`${prefix}001`]:metric(v1,dd,"CFETS_REPO"),[`${prefix}007`]:metric(v7,dd,"CFETS_REPO")};
      }
    }catch{}
  }
  throw new Error(`${kind} unavailable`);
}
async function getRepo(){
  const [fr,fdr]=await Promise.all([oneRepo("FR","fr"),oneRepo("FDR","fdr")]);
  return {...fr,...fdr};
}

/* ---------------- PBoC OMO ---------------- */

function stripHtml(s){return String(s).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/g," ").replace(/\s+/g," ").trim()}
function abs(base,href){try{return new URL(href,base).href}catch{return null}}
async function getOmo(){
  const hubs=[
    "https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/125475/index.html",
    "https://www.chinamoney.com.cn/chinese/scggyhywgggksccz/"
  ];
  let links=[];
  for(const hub of hubs){
    try{
      const html=await fetchText(hub,{accept:"text/html,*/*"});
      links.push(...[...html.matchAll(/href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map(m=>({url:abs(hub,m[1]),text:stripHtml(m[2])}))
        .filter(x=>x.url && /公开市场|逆回购|交易公告/.test(x.text+x.url)));
      if(links.length)break;
    }catch{}
  }
  links=links.filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i).slice(0,30);
  const ops=[];
  for(const l of links.slice(0,18)){
    try{
      const t=stripHtml(await fetchText(l.url,{accept:"text/html,*/*"}));
      const dd=dateOf(t)||dateOf(l.url); if(!dd)continue;
      const noOp=/不开展|未开展|零投放|操作量为零/.test(t);
      const amt=(t.match(/(?:开展了|开展|中标量|操作量)[^\d]{0,30}([\d,.]+)\s*亿元/)||[])[1];
      const rate=(t.match(/(?:7\s*天|七天)[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*%/)||[])[1];
      const maturity=(t.match(/(?:到期|逆回购到期)[^\d]{0,20}([\d,.]+)\s*亿元/)||[])[1];
      if(noOp || n(amt)!=null){
        const amountCnyBn=noOp?0:+(n(amt)/10).toFixed(1);
        const maturedCnyBn=n(maturity)!=null?+(n(maturity)/10).toFixed(1):null;
        ops.push({date:dd,maturityDays:7,amountCnyBn,ratePct:n(rate),maturedCnyBn,netFlowCnyBn:maturedCnyBn==null?null:+(amountCnyBn-maturedCnyBn).toFixed(1),event:noOp?"No new 7-day reverse-repo operation":"7-day reverse-repo operation",sourceUrl:l.url,sourceId:"PBOC_OMO",status:"official-public-release"});
      }
    }catch{}
  }
  ops.sort((a,b)=>b.date.localeCompare(a.date));
  if(!ops.length) throw new Error("No PBoC OMO release normalized");
  return ops;
}

/* ---------------- PIPELINE ---------------- */

const prev=await readJson(LIVE,{});
const out=structuredClone(prev||{});
out.schema=3; out.generatedAt=now.toISOString();
out.beijingTime=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",dateStyle:"short",timeStyle:"medium",hour12:false}).format(now).replace(" ","T")+"+08:00";
out.sourceHealth={};out.warnings=[];

async function run(id,fn){
  try{const v=await fn();out.sourceHealth[id]={state:"ok",checkedAt:now.toISOString(),mode:"official-public-source"};return v}
  catch(e){out.sourceHealth[id]={state:"fallback",checkedAt:now.toISOString(),mode:"last-verified",message:String(e?.message||e).slice(0,180)};out.warnings.push(`${id}: ${String(e?.message||e).slice(0,120)}`);return null}
}
const [sh,lpr,repo,omo]=await Promise.all([run("CFETS_SHIBOR",getShibor),run("CFETS_LPR",getLpr),run("CFETS_REPO",getRepo),run("PBOC_OMO",getOmo)]);

out.policy ||= {};
for(const k of ["lpr1y","lpr5y"]) out.policy[k]=merge(lpr?.[k],prev?.policy?.[k]);
out.moneyMarket ||= {};
for(const k of ["shiborON","shibor1W","shibor1M"]) out.moneyMarket[k]=merge(sh?.[k],prev?.moneyMarket?.[k]);
for(const k of ["fr001","fr007","fdr001","fdr007"]) out.moneyMarket[k]=merge(repo?.[k],prev?.moneyMarket?.[k]);

out.omo ||= {recent:[]};
if(omo?.length){
  out.omo.latest=omo[0];
  out.omo.recent=omo.slice(0,20);
  if(Number.isFinite(omo[0].netFlowCnyBn)) out.omo.sevenDayNetFlowCnyBn=omo[0].netFlowCnyBn;
}else{
  out.omo.latest=prev?.omo?.latest??null;
  out.omo.recent=prev?.omo?.recent??[];
  out.omo.sevenDayNetFlowCnyBn=prev?.omo?.sevenDayNetFlowCnyBn??null;
}

const obs=[
  out.moneyMarket?.shiborON?.date,out.moneyMarket?.shibor1W?.date,out.moneyMarket?.shibor1M?.date,
  out.moneyMarket?.fr007?.date,out.moneyMarket?.fdr007?.date,out.omo?.latest?.date
].filter(Boolean).sort().reverse();
const latestObservationDate=obs[0]||null;
out.freshness={state:"latest-published",latestObservationDate};

let score=0,parts=0;
if(Number.isFinite(out.omo?.sevenDayNetFlowCnyBn)){score+=Math.max(-2,Math.min(2,out.omo.sevenDayNetFlowCnyBn/60));parts++}
if(Number.isFinite(out.moneyMarket?.shiborON?.value)&&Number.isFinite(out.moneyMarket?.fdr007?.value)){score+=Math.max(-1.5,Math.min(1.5,(out.moneyMarket.fdr007.value-out.moneyMarket.shiborON.value)*3));parts++}
let label="INSUFFICIENT DATA";
if(parts>=2){score=+score.toFixed(2);label=score>.55?"INJECTING":score<-.55?"DRAINING":"NEUTRAL"}else score=null;
out.liquidityRegime={label,score,method:"BondStats composite from latest published PBoC OMO flow and CFETS money-market fixings; not an official PBoC classification."};

const states=Object.values(out.sourceHealth).map(x=>x.state);
out.status=states.every(x=>x==="ok")?"current":states.some(x=>x==="ok")?"current-with-fallbacks":"fallback-only";

const hist=await readJson(HISTORY,[]);
hist.push({generatedAt:out.generatedAt,latestObservationDate,policy:out.policy,moneyMarket:out.moneyMarket,omo:{latest:out.omo.latest,sevenDayNetFlowCnyBn:out.omo.sevenDayNetFlowCnyBn},liquidityRegime:out.liquidityRegime});
await fs.writeFile(LIVE,JSON.stringify(out,null,2)+"\n");
await fs.writeFile(HISTORY,JSON.stringify(hist.slice(-3000),null,2)+"\n");
console.log(JSON.stringify({status:out.status,latestObservationDate,sourceHealth:out.sourceHealth},null,2));
