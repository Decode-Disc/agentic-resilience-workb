import {readFileSync,writeFileSync} from 'node:fs';
import {api} from '../../../convex/_generated/api.js';
import {openQualificationSession,prepareQualificationModel} from '../../../scripts/evaluations/workbench-browser/model-preparation.ts';
const invitations=JSON.parse(readFileSync('invitation-otp-codes.local','utf8'));
const entry=invitations.invitations.find(x=>x.slotKey==='admin');
if(!entry)throw new Error('Local administrator invitation unavailable');
const session=await openQualificationSession('http://127.0.0.1:3210',entry.code);
try {
 const before=await session.client.query(api.modelConfiguration.list,{});
 const model=before.models.find(m=>m.model==='z-ai/glm-5.3-flash' && !m.provider);
 if(!model)throw new Error('Expected model not present');
 if(!model.enabled || !model.workbenchSelectable) await session.client.mutation(api.modelConfiguration.updateAvailability,{catalogId:model._id,expectedRevision:model.revision,enabled:true,workbenchSelectable:true,requestKey:'native-task-methods-20261119-restore-availability'});
 const prepared=await prepareQualificationModel(session.client,{model:model.model});
 const after=await session.client.query(api.modelConfiguration.list,{});
 const current=after.models.find(m=>m._id===model._id);
 if(JSON.stringify(before.assignments)!==JSON.stringify(after.assignments))throw new Error('Assignments changed');
 writeFileSync('.agents/artifacts/sources-frozen-qualification/model-readiness.json',JSON.stringify({checkedAt:new Date().toISOString(),prepared,reasoning:current.reasoning,status:current.status,compatible:current.compatible,assignmentsUnchanged:true},null,2)+'\n');
 console.log(JSON.stringify({ready:current.status,compatible:current.compatible,reasoning:current.reasoning}));
}finally{await session.close();}
