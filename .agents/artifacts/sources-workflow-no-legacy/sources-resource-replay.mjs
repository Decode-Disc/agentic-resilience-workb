import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {createServer} from 'vite';
import {convexTest} from 'convex-test';
import {z} from 'zod';
import {execFileSync} from 'node:child_process';
import {BACKGROUND_CONTEXT} from '@earendil-works/chord/context';
import {ROOT_CONVERSATION_ID} from '@earendil-works/pi-durable';
import {streamText,Output} from 'ai';
import {createOpenRouter} from '@openrouter/ai-sdk-provider';
const task=new URL('./',import.meta.url);
const evidence=JSON.parse(readFileSync(new URL('retained-control-comparison.json',task),'utf8'));
const path=process.env.SOURCES_REPLAY_INPUT??evidence[0].source;
assert(existsSync(path),'Retained real response required');
const archive=JSON.parse(readFileSync(path,'utf8'));
const retained=archive.payloads.find(p=>p.part==='reply'&&p.state==='complete'&&p.json);
assert(retained,'Complete retained reply required');
const original=JSON.parse(retained.json).content.filter(c=>c.type==='text').map(c=>c.text).join('');
assert(original.length>0);const real=JSON.parse(original);
const hash=s=>createHash('sha256').update(s).digest('hex');
const result={node:process.version,input:{path,invocationId:retained.invocationId,hash:hash(retained.json),visibleHash:hash(original),visibleBytes:Buffer.byteLength(original)},samples:[],limitations:['Replay uses the installed real SDK and Convex-test storage, not network/provider or production database timings','Peak heap is sampled at stream/mutation boundaries; native process RSS includes Vite loader overhead','The expanded workload repeats retained material inside valid JSON; it is an admitted-large fixture, not another observed generation']};
const loader=await createServer({configFile:false,resolve:{tsconfigPaths:true},server:{middlewareMode:true,watch:null},appType:'custom',plugins:[{name:'measure-native-and-packed-events',enforce:'pre',transform(code,id){if(!id.endsWith('/convex/integrations/modelTransport.ts'))return;return code.replace(/if\s*\(part.type\s*===\s*"text-delta"\)\s*await state.visibleWriter\?\.write\(\s*part.delta,?\s*\);/,'if (part.type === "text-delta") {globalThis.__sourceReplay.native++; globalThis.__sourceReplay.sample(); await state.visibleWriter?.write(part.delta);}').replace('output: Output.object({','output: globalThis.__sourceReplay.track(Output.object({').replace(/name:\s*args.schemaName,\s*}\),/,'name: args.schemaName, })),') .replace('if (head) controller.enqueue({ ...head, text });','if (head) {globalThis.__sourceReplay.packed++;controller.enqueue({ ...head, text });}');}}]});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
try{
 const {default:schema}=await loader.ssrLoadModule('/convex/schema.ts');
 const {appendRetainedText,sealRetainedText,readRetainedText}=await loader.ssrLoadModule('/convex/execution/retainedText.ts');
 const {invokeOneShot}=await loader.ssrLoadModule('/convex/integrations/modelTransport.ts');
 const {TEXT_FRAGMENT_CHARACTERS,RESOURCE_POLICY_VERSION}=await loader.ssrLoadModule('/convex/resourcePolicy.ts');
 for(const workload of ['retained','expanded'])for(const cadence of ['burst','slow'])for(const mode of ['unbatched-sdk','production']){
  const text=workload==='retained'?original:JSON.stringify({retained:real,expandedDiagnostic:original.repeat(32)});
  globalThis.gc?.();
  let peak=process.memoryUsage().heapUsed;const sample=()=>{peak=Math.max(peak,process.memoryUsage().heapUsed)};
  const metric={workload,cadence,mode,visibleBytes:Buffer.byteLength(text),nativeEvents:0,enrichedEvents:0,enrichedSnapshotBytes:0,appendMutations:0,packedFragments:0,headerBytesWritten:0,maxTailCharacters:0,maxAppendsInFlight:0,parseCalls:0,partialSnapshotBytes:0};
  const chunks=[];for(let i=0;i<text.length;i+=256)chunks.push(text.slice(i,i+256));
  const fetchFixture=async()=>{let at=0;return new Response(new ReadableStream({async pull(c){sample();if(cadence==='slow')await delay(2);if(at<chunks.length){const content=chunks[at++];if(mode==='unbatched-sdk')metric.nativeEvents++;c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({id:'retained-replay',choices:[{index:0,delta:{content},finish_reason:null}]})}\n\n`));}else if(at++===chunks.length)c.enqueue(new TextEncoder().encode('data: {"id":"retained-replay","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30,"cost":0.000001}}\n\ndata: [DONE]\n\n'));else c.close();}},{highWaterMark:0}),{headers:{'content-type':'text/event-stream'}})};
  globalThis.__sourceReplay={native:0,packed:0,sample,track(output){return {...output,async parsePartialOutput(args){metric.parseCalls++;const parsed=await output.parsePartialOutput(args);if(parsed)metric.partialSnapshotBytes+=Buffer.byteLength(JSON.stringify(parsed));return parsed;}};}};
  const before=process.memoryUsage().heapUsed,cpu=process.cpuUsage(),start=performance.now();
  if(mode==='unbatched-sdk'){
   const provider=createOpenRouter({apiKey:'offline',fetch:fetchFixture});
   const stream=streamText({model:provider.chat('offline/replay'),prompt:'Replay retained visible bytes',output:globalThis.__sourceReplay.track(Output.object({schema:z.record(z.string(),z.unknown())})),maxRetries:0});
   const completed=Promise.all([Promise.resolve(stream.output),stream.text]);void completed.catch(()=>{});
   for await(const part of stream.fullStream){sample();metric.enrichedEvents++;if(part.type==='text-delta')metric.enrichedSnapshotBytes+=JSON.stringify(part).length;}
   const [,value]=await completed;assert.equal(value,text);
  }else{
   const t=convexTest(schema,{"./_generated/server.ts":()=>loader.ssrLoadModule("/convex/_generated/server.ts")});let id;let inflight=0;
   const value=await invokeOneShot({route:{model:'offline/replay',executionPlanVersion:'source_actions_v4',descriptor:{contextWindow:1_000_000,maxTokens:131072,reasoning:false,inputPrice:0,outputPrice:0,cacheReadPrice:0,structuredOutputs:true}},instructions:'Replay retained bytes',prompt:'offline',schema:z.record(z.string(),z.unknown()),schemaName:'RetainedReplay',dependencies:{apiKey:'offline',authority:{resourcePolicy:RESOURCE_POLICY_VERSION,deadlineAt:Date.now()+60_000},fetch:fetchFixture,onVisibleText:async(content,sequence)=>{inflight++;metric.maxAppendsInFlight=Math.max(metric.maxAppendsInFlight,inflight);try{id=await t.run(ctx=>appendRetainedText(ctx,'replay',sequence,content));metric.appendMutations++;metric.firstCaptureLatencyMs??=performance.now()-start;const doc=await t.run(ctx=>ctx.db.get(id));metric.headerBytesWritten+=Buffer.byteLength(JSON.stringify(doc));metric.maxTailCharacters=Math.max(metric.maxTailCharacters,doc.stream.tail.length);sample();}finally{inflight--;}} ,finishVisibleOutput:async()=>{assert(id);const doc=await t.run(ctx=>sealRetainedText(ctx,id));metric.packedFragments=doc.received;metric.headerBytesWritten+=Buffer.byteLength(JSON.stringify(doc));}}});
   assert.equal(value.status,'succeeded');assert(id);assert.equal(await t.run(ctx=>readRetainedText(ctx,id)),text);assert(metric.maxTailCharacters<TEXT_FRAGMENT_CHARACTERS);assert.equal(metric.maxAppendsInFlight,1);
   metric.nativeEvents=globalThis.__sourceReplay.native;metric.enrichedEvents=globalThis.__sourceReplay.packed;assert.equal(metric.nativeEvents,chunks.length);assert(metric.enrichedEvents>0);
  }
  metric.elapsedMs=performance.now()-start;metric.cpuMicros=process.cpuUsage(cpu);metric.peakHeapBytes=peak;metric.sampledHeapGrowthBytes=Math.max(0,peak-before);result.samples.push(metric);
 }

 const piLogPath=process.env.SOURCES_PI_LOG_INPUT??'/home/abdwhb/.cache/workbench-evaluations/sources-workflow-no-legacy/retained-runtime-pi-log.json';
 assert(existsSync(piLogPath),'Actual retained Pi log required');
 result.piLogInputPath=piLogPath;
 const actual=JSON.parse(readFileSync(piLogPath,'utf8'));
 const large=Array.from({length:1024},(_,i)=>({sequence:i+1,key:`large-${i}`,payload:JSON.stringify(i===0?[{type:'conversation',value:{id:ROOT_CONVERSATION_ID}}]:[{type:'entry',value:{id:i+1,conversationId:ROOT_CONVERSATION_ID,kind:'workbench.original',data:{text:'x'.repeat(32500)}}}])}));
 const {PiConvexStorage}=await loader.ssrLoadModule('/convex/integrations/piStorage.ts');
 const {PI_REPLAY_PAGE_SIZE,PI_REPLAY_PAGE_MAX_BYTES,PI_SESSION_MAX_BYTES}=await loader.ssrLoadModule('/convex/resourcePolicy.ts');
 result.piLogReplay=[];
 for(const [workload,log] of [['actual-retained',actual],['admitted-large',large]]){
  const bytes=log.reduce((n,c)=>n+Buffer.byteLength(c.payload),0);assert(bytes<=PI_SESSION_MAX_BYTES);
  const samples=[];
  for(let i=0;i<3;i++){
   globalThis.gc?.();const start=performance.now(),cpu=process.cpuUsage();let pages=0;
   const storage=await PiConvexStorage.open({async scan(cursor){pages++;let end=Number(cursor??0),size=0;const start=end;while(end<log.length&&end-start<PI_REPLAY_PAGE_SIZE){const next=Buffer.byteLength(log[end].payload);if(end>start&&size+next>PI_REPLAY_PAGE_MAX_BYTES)break;size+=next;end++;}return {commits:log.slice(start,end),cursor:end<log.length?String(end):null};},async append(){throw Error('replay is read only')},async find(){return null},async mintId(){throw Error('replay is read only')}},BACKGROUND_CONTEXT);
   assert.equal(storage.committedSequence,log.length);samples.push({elapsedMs:performance.now()-start,cpuMicros:process.cpuUsage(cpu),scanPages:pages,heapBytes:process.memoryUsage().heapUsed});
  }
  result.piLogReplay.push({workload,logHash:hash(JSON.stringify(log)),commits:log.length,bytes,twentyFallbackReadsBytes:bytes*20,samples});
 }
 execFileSync(process.execPath,['--experimental-strip-types','--test','--test-name-pattern=first dispatched Sources','src/__tests__/config/qualification-v2.test.mjs'],{env:{...process.env,SOURCES_REPLAY_INPUT:path,SOURCES_REPLAY_METRICS:'/tmp/sources-milestone-polling-metrics.json'},stdio:'pipe'});
 result.polling=JSON.parse(readFileSync('/tmp/sources-milestone-polling-metrics.json','utf8'));
 writeFileSync(new URL('sources-resource-replay.json',task),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{await loader.close();delete globalThis.__sourceReplay;}
