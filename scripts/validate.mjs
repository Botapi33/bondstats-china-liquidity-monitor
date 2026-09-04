import fs from "node:fs/promises";
const live=JSON.parse(await fs.readFile("public/data/live.json","utf8"));
function ok(n,c){ if(!c){console.error("FAIL",n);process.exitCode=1}else console.log("PASS",n) }
const valid=m=>m==null||(typeof m==="object"&&Number.isFinite(m.value)&&m.value>-10&&m.value<50&&(!m.date||/^\d{4}-\d{2}-\d{2}$/.test(m.date)));
ok("schema",[1,2,3].includes(live.schema));
ok("generatedAt",live.generatedAt==null||!Number.isNaN(Date.parse(live.generatedAt)));
for(const [k,v] of Object.entries(live.policy||{})) ok(`policy ${k}`,valid(v));
for(const [k,v] of Object.entries(live.moneyMarket||{})) ok(`moneyMarket ${k}`,valid(v));
ok("source health object",typeof live.sourceHealth==="object");
ok("regime",["WAITING","INSUFFICIENT DATA","INJECTING","NEUTRAL","DRAINING"].includes(live.liquidityRegime?.label));
if(process.exitCode)process.exit(process.exitCode);
console.log("PASS China Liquidity Monitor v2 validation complete");
