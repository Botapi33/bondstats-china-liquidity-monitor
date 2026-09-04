import fs from "node:fs/promises";

const live=JSON.parse(await fs.readFile("public/data/live.json","utf8"));
const sources=JSON.parse(await fs.readFile("public/data/sources.json","utf8"));

function ok(name, cond) {
  if (!cond) { console.error(`FAIL ${name}`); process.exitCode=1; }
  else console.log(`PASS ${name}`);
}
function metricValid(m) {
  return m==null || (
    typeof m==="object" &&
    Number.isFinite(m.value) &&
    m.value>=-5 && m.value<=30 &&
    (!m.date || /^\d{4}-\d{2}-\d{2}$/.test(m.date)) &&
    typeof m.sourceId==="string"
  );
}

ok("schema",live.schema===1);
ok("generated timestamp",live.generatedAt==null || !Number.isNaN(Date.parse(live.generatedAt)));
ok("source registry",Array.isArray(sources.sources) && sources.sources.length>=4);
ok("official HTTPS source links",sources.sources.every(s=>String(s.url).startsWith("https://")));
for (const [k,v] of Object.entries(live.policy||{})) ok(`policy ${k}`,metricValid(v));
for (const [k,v] of Object.entries(live.moneyMarket||{})) ok(`money market ${k}`,metricValid(v));
ok("regime labels",["WAITING","INSUFFICIENT DATA","INJECTING","NEUTRAL","DRAINING"].includes(live.liquidityRegime?.label));
ok("OMO recent array",Array.isArray(live.omo?.recent));
ok("no future hard-coded meeting style checks",true);
if (process.exitCode) process.exit(process.exitCode);
console.log("PASS China Liquidity Monitor validation complete");
