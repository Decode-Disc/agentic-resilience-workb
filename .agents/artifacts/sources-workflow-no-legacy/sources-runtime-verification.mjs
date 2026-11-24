import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(process.env.SOURCES_RUNTIME_ROOT??'/tmp/workbench-sources-runtime');
assert.equal(root,'/tmp/workbench-sources-runtime','Probe only targets its disposable checkout');
const config=JSON.parse(readFileSync(`${root}/.convex/local/default/config.json`,'utf8'));
assert.equal(config.deploymentName,'anonymous-agent');assert.equal(config.ports.cloud,35120);
const origin='http://127.0.0.1:35120';
async function admin(path,args,environment=false){
 const response=await fetch(`${origin}${environment?'/api/update_environment_variables':'/api/function'}`,{method:'POST',headers:{Authorization:`Convex ${config.adminKey}`,'Content-Type':'application/json'},body:JSON.stringify(environment?{changes:args}:{path,format:'json',args})});
 if(environment){assert(response.ok,"Local environment update failed");return null;}
 const result=await response.json();
 if(!response.ok||(!environment&&result.status!=='success'))throw Error(`Local probe call failed: ${path}: ${result.errorMessage??response.status}`);
 return result.value;
}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const mode=process.env.SOURCES_RUNTIME_PROBE??'durable';assert(['durable','readiness','cancel'].includes(mode));
const output=mode==='readiness'?'sources-runtime-readiness.json':mode==='cancel'?'sources-runtime-cancellation.json':'sources-runtime-verification.json';
const records=[];let gateOpen=false,gateCalls=0;const pending=new Set();
const server=createServer((req,res)=>{assert.equal(req.url,'/gate');gateCalls++;res.writeHead(200,{'content-type':'text/plain'});res.flushHeaders();if(gateOpen)res.end('released');else {pending.add(res);const heartbeat=setInterval(()=>res.write(' '),1000);res.once('close',()=>{pending.delete(res);clearInterval(heartbeat);});}});
await new Promise(r=>server.listen(35125,'127.0.0.1',r));
function release(){gateOpen=true;for(const res of pending)res.end('released');pending.clear();}
let fixture;
async function inspect(){return admin('sourcesRuntimeProbe:inspect',{runId:fixture.runId,missionId:fixture.missionId});}
async function until(predicate,label,timeout=60_000){const end=Date.now()+timeout;while(Date.now()<end){const state=await inspect();if(predicate(state))return state;await delay(500);}throw Error(`Runtime condition not observed: ${label}`);}
try {
 await admin('',[{name:'E2E_FIXTURES_ENABLED',value:'true'},{name:'SOURCES_MISSION_ENABLED',value:'true'},{name:'SOURCES_PREPARATION_WINDOW_MINUTES',value:'15'},{name:'SOURCES_MISSION_ENVELOPE',value:JSON.stringify({version:1,maxNeeds:12,initialSearches:4,complementSearches:3,acquisitions:10,controls:20})}],true);
 fixture=await admin('sourcesRuntimeProbe:seed',{key:mode==='readiness'?'sources-runtime-readiness':mode==='cancel'?'sources-runtime-cancellation':'sources-durable-runtime-authorized'});
 const waiting=await until(s=>gateCalls===1&&s.requests.some(r=>r.status==='waiting'&&r.scheduledStartedAt)&&!s.mission.piActiveWriter&&s.sessions.every(x=>x.leaseUntil<=Date.now()),'Sources I/O waiting while Pi writer released');
 const request=waiting.requests.find(r=>r.status==='waiting');
 const start=Date.now();records.push({event:'waiting_worker_released',at:start,requestId:request._id,scheduledJobId:request.scheduledJobId});
 assert.equal(await admin('sourcesMissionActions:execute',{requestId:request._id,expectedGeneration:4}),null);
 if(mode==='cancel'){
  await admin('sourcesRuntimeProbe:cancel',{runId:fixture.runId,visitorId:fixture.visitorId});
  release();
  const cancelled=await until(s=>s.run.executionStatus==='cancelled'&&s.requests.find(r=>r._id===request._id)?.status==='observed'&&s.requests.find(r=>r._id===request._id)?.outcome?.code==='stale_execution','late result retained without adoption after cancellation');
  const effect=cancelled.requests.find(r=>r._id===request._id);assert(!effect.adoptedAt);assert.notEqual(effect.outcome?.kind,'success');assert.equal(gateCalls,1);assert.equal(cancelled.receipts.length,0);
  records.push({event:'cancelled_without_adoption',generation:cancelled.run.executionGeneration,outcome:effect.outcome});
  writeFileSync(new URL(output,import.meta.url),JSON.stringify({status:'passed',mode,target:origin,gateCalls,records},null,2)+'\n');
 } else {
 // This crosses the former five-minute synchronous dispatcher failure while real Node I/O is held.
 while(Date.now()-start<(mode==='readiness'?90_000:315_000)){await delay(15_000);const state=await inspect();assert.equal(state.requests.find(r=>r._id===request._id)?.status,'waiting');assert.equal(gateCalls,1);records.push({event:'still_waiting',elapsedMs:Date.now()-start,workerActive:!!state.mission.piActiveWriter,writerEpoch:state.sessions[0]?.epoch,logSequence:state.sessions[0]?.sequence});console.log(JSON.stringify(records.at(-1)));}
 if(mode==='readiness'){const epochs=records.filter(r=>r.event==='still_waiting').map(r=>r.writerEpoch);assert(epochs.length>=4);assert.equal(new Set(epochs).size,1,'Unchanged fallbacks must not claim/hydrate another writer');}
 release();
 const resumed=await until(s=>s.requests.some(r=>r._id===request._id&&r.adoptedAt&&r.outcome?.kind==='success'),'Pi adopted retained Sources result');
 assert.equal(gateCalls,1);assert.equal(resumed.receipts.length,0);
 records.push({event:'result_adopted',elapsedMs:Date.now()-start,outcome:resumed.requests.find(r=>r._id===request._id).outcome.kind,providerCalls:resumed.receipts.length});
 const logs=await admin('sourcesRuntimeProbe:logs',{missionId:fixture.missionId});writeFileSync('/tmp/sources-retained-runtime-pi-log.json',JSON.stringify(logs));
 await admin('sourcesRuntimeProbe:cancel',{runId:fixture.runId,visitorId:fixture.visitorId});
 const result={status:'passed',node:process.version,target:origin,mode,heldIoMs:Date.now()-start,gateCalls,records,instrumentation:{checkout:root,model:'native Pi faux provider',io:'loopback gate after real Sources reservation',nextTurn:'fixture stops after first success',sourceActionSha256:createHash('sha256').update(readFileSync(`${root}/convex/sourcesMissionActions.ts`)).digest('hex')},limitations:['Deterministic external I/O; no real provider or analytical quality claim','Cancellation with late result has its own isolated runtime mode']};
 writeFileSync(new URL(output,import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({status:result.status,heldIoMs:result.heldIoMs}));
}
} catch(error){writeFileSync(new URL(output,import.meta.url),JSON.stringify({status:'failed',error:error.message,records},null,2)+'\n');throw error;}
finally {release();if(fixture)await admin('sourcesRuntimeProbe:cancel',{runId:fixture.runId,visitorId:fixture.visitorId});await admin('',[{name:'E2E_FIXTURES_ENABLED',value:null},{name:'SOURCES_MISSION_ENABLED',value:null},{name:'SOURCES_PREPARATION_WINDOW_MINUTES',value:null},{name:'SOURCES_MISSION_ENVELOPE',value:null}],true);await new Promise(r=>server.close(r));}
