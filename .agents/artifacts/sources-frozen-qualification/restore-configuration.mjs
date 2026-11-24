import {readFileSync,writeFileSync} from 'node:fs';
import {api} from '../../../convex/_generated/api.js';
import {openQualificationSession,prepareQualificationModel} from '../../../scripts/evaluations/workbench-browser/model-preparation.ts';
import {restoreCampaignConfiguration} from '../../../scripts/evaluations/workbench-browser/campaign-configuration.ts';
const root='/home/abdwhb/.cache/workbench-evaluations/native-task-methods-20261119-ready/lots/lot-1';
const codes=JSON.parse(readFileSync('invitation-otp-codes.local','utf8'));
const session=await openQualificationSession('http://127.0.0.1:3210',codes.invitations.find(x=>x.slotKey==='admin').code);
try{
 const before=await session.client.query(api.modelConfiguration.list,{});
 const saved=JSON.parse(readFileSync(root+'/configuration.json','utf8'));
 const owned=saved.changes.map(change=>({change,current:change.kind==='reasoning'?before.models.filter(m=>m._id===change.key).map(m=>({revision:m.revision,enabled:m.enabled,status:m.status,reasoning:m.reasoning})):change.kind==='assignment'?before.assignments.filter(a=>a.agent===change.key):before.responseControl}));
 writeFileSync('.agents/artifacts/sources-frozen-qualification/restore-before.json',JSON.stringify(owned,null,2)+'\n');
 const originalAssignment=saved.original.assignments.find(a=>a.agent==='sources');
 const originalModel=before.models.find(m=>m._id===originalAssignment.catalogId);
 if(originalModel?.enabled && originalModel.status==='ready' && !originalModel.compatible){
  const refreshed=await prepareQualificationModel(session.client,{model:originalModel.model,provider:originalModel.provider});
  writeFileSync('.agents/artifacts/sources-frozen-qualification/restored-source-profile.json',JSON.stringify(refreshed,null,2)+'\n');
 }
 try{await restoreCampaignConfiguration(session.client,root);console.log('Configuration restored through the campaign owner.');}catch(e){console.error(e.message);process.exitCode=1;}
}finally{await session.close();}
