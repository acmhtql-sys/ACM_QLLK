/** Stage4C Writer port mock-contract tests.
 * No real DB, Prisma, filesystem, app route or cloud. A fake transaction
 * discards draft state on failure; that is NOT PostgreSQL rollback evidence.
 * Usage: node --experimental-strip-types --test scripts/stage4c-return-writer.offline.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStage4CWriter } from '../apps/api/src/modules/borrow/borrow.return-writer.contract.ts';

const tech='tech-1', manager='manager-2', admin='admin-3', student='student-4';
const roles = { [tech]:'TECHNICIAN', [manager]:'LAB_MANAGER', [admin]:'ADMIN', [student]:'STUDENT' };
const input = (action, key, extra={}) => ({
  action, borrowRequestId:'borrow-1', operationId:'return-op-1', requestKey:key, ...extra,
});
const cancelledProof = {
  kind:'REVERSE_HANDOVER', evidenceRef:'RH-20261030-01',
  custodyReceiverId:tech, approvedById:manager, approved:true,
};
function fakeWriter() {
  let state = {
    operation: {
      status:'PREPARED', receiverId:null, verifierId:null,
      physicallyReceived:false, independentlyVerified:false,
      lines:[
        { borrowDetailId:'line-good', quantity:2, condition:'GOOD', qualityReleased:false },
        { borrowDetailId:'line-damage', quantity:1, condition:'DAMAGED', qualityReleased:false },
      ],
    },
    borrowDetails:[
      { id:'line-good', quantity:2, returnedQuantity:0 },
      { id:'line-damage', quantity:1, returnedQuantity:0 },
    ],
    replays:{}, postings:{}, audit:[], totals:{borrowed:3,quarantined:0,available:0},
  };
  let failAfterStaging = false;
  const proofs = new Map([['resolution-1',cancelledProof]]);
  let deniedScope = false;
  const trace = [];
  const port = {
    serializable: async callback => {
      trace.push('SERIALIZABLE_START');
      const draft = structuredClone(state);
      let locked=false;
      const tx={
        authenticateBorrowScope: async (principal,borrowId)=>{
          trace.push('AUTH');
          if(deniedScope||borrowId!=='borrow-1'||!roles[principal])return null;
          return {id:principal,role:roles[principal]};
        },
        lockBorrowRequest:async borrowId=>{
          trace.push('BORROW_LOCK');
          assert.equal(borrowId,'borrow-1');locked=true;
        },
        findReplayForUpdate:async (_borrowId,key)=>{
          assert.ok(locked);trace.push('REPLAY_LOOKUP');
          return draft.replays[key]??null;
        },
        loadOperationForUpdate:async (_borrowId,opId)=>{
          assert.ok(locked);trace.push('OP_LOCK');
          return opId==='return-op-1'?structuredClone(draft.operation):null;
        },
        loadBorrowDetailsForUpdate:async ()=>{
          assert.ok(locked);trace.push('DETAILS_LOCK');
          return structuredClone(draft.borrowDetails);
        },
        loadApprovedCustodyResolutionForUpdate:async (_,opId,id)=>{
          assert.ok(locked);trace.push('CUSTODY_LOCK');
          return opId==='return-op-1'?structuredClone(proofs.get(id)??null):null;
        },
        persistAtomically:async write=>{
          assert.ok(locked);trace.push('PERSIST_ATOMIC');
          assert.equal(write.borrowRequestId,'borrow-1');
          assert.equal(write.operationId,'return-op-1');
          assert.equal(write.idempotencyRetentionDays,365);
          assert.ok(write.payloadSha256.match(/^[0-9a-f]{64}$/));
          const result={
            borrowRequestId:write.borrowRequestId,operationId:write.operationId,
            state:write.plan.next.status,event:write.plan.event,
          };
          draft.operation=structuredClone(write.plan.next);
          for(const posting of write.postings){
            assert.ok(!draft.postings[posting.dedupKey], 'duplicate posting');
            draft.postings[posting.dedupKey]=structuredClone(posting);
            draft.totals.borrowed += posting.borrowedDelta;
            draft.totals.quarantined += posting.quarantinedDelta;
            draft.totals.available += posting.availableDelta;
          }
          draft.audit.push({actorId:write.actor.id,event:write.auditEvent});
          draft.replays[write.requestKey]={
            borrowRequestId:write.borrowRequestId,operationId:write.operationId,
            requestKey:write.requestKey,payloadSha256:write.payloadSha256,
            actorId:write.actor.id,result,
          };
          if(failAfterStaging)throw new Error('INJECTED_FAULT_AFTER_STAGING');
          return result;
        },
      };
      const response=await callback(tx);
      state=draft;
      trace.push('COMMIT_FAKE');
      return response;
    },
  };
  return {
    port,trace,
    get state(){return structuredClone(state);},
    get proofs(){return proofs;},
    setFail(v){failAfterStaging=v;},
    denyScope(v){deniedScope=v;},
    replaceBorrowDetails(details){state.borrowDetails=structuredClone(details);},
    replaceSnapshot(snapshot){state.operation=structuredClone(snapshot);},
  };
}
async function fails(code,fn){
  await assert.rejects(fn,e=>e?.code===code);
}
const run=(f,principal,action,key,extra={})=>
  executeStage4CWriter(f.port,principal,input(action,key,extra));
const receive=f=>run(f,tech,'RECEIVE','rcv-1');
const verify=f=>run(f,manager,'VERIFY','verify-1');
const commit=f=>run(f,admin,'COMMIT','commit-1');
const ready=async f=>{await receive(f);await verify(f);};

test('PORT-01 RECEIVE stores custody/audit and never credits stock',async()=>{
  const f=fakeWriter(),r=await receive(f);
  assert.equal(r.replayed,false);
  assert.equal(r.event,'PHYSICAL_RECEIPT_CONFIRMED');
  assert.equal(f.state.operation.custody.receivedById,tech);
  assert.equal(f.state.audit.length,1);
  assert.deepEqual(f.state.totals,{borrowed:3,quarantined:0,available:0});
  assert.deepEqual(f.trace.slice(0,5),['SERIALIZABLE_START','AUTH','BORROW_LOCK','REPLAY_LOOKUP','OP_LOCK']);
});
test('PORT-02 independent verifier, COMMIT writes quarantine postings exactly once',async()=>{
  const f=fakeWriter();await ready(f);
  const result=await commit(f);
  assert.equal(result.state,'COMPLETED');
  assert.deepEqual(f.state.totals,{borrowed:0,quarantined:3,available:0});
  assert.equal(Object.keys(f.state.postings).length,2);
  assert.deepEqual(Object.values(f.state.postings).map(p=>p.kind),[
    'PHYSICAL_RETURN_TO_QUARANTINE','PHYSICAL_RETURN_TO_QUARANTINE']);
  assert.deepEqual(f.state.audit.map(x=>x.event),[
    'PHYSICAL_RECEIPT_CONFIRMED','INDEPENDENTLY_VERIFIED','COMMIT_REQUESTED']);
  assert.ok(f.trace.indexOf('DETAILS_LOCK') < f.trace.lastIndexOf('PERSIST_ATOMIC'));
});
test('PORT-03 QC can release GOOD only, damaged stays in quarantine',async()=>{
  const f=fakeWriter();await ready(f);await commit(f);
  await run(f,manager,'QC_APPROVE','qc-good',{borrowDetailIds:['line-good']});
  assert.deepEqual(f.state.totals,{borrowed:0,quarantined:1,available:2});
  assert.equal(f.state.operation.lines[0].qualityReleased,true);
  assert.equal(f.state.operation.lines[1].qualityReleased,false);
  await fails('STATE_CONFLICT',()=>run(f,manager,'QC_APPROVE','qc-bad',{borrowDetailIds:['line-damage']}));
  assert.equal(Object.keys(f.state.postings).length,3);
});
test('PORT-04 CANCEL after physical RECEIVE persists reconciliation, not terminal, no stock credit',async()=>{
  const f=fakeWriter();await receive(f);
  const r=await run(f,admin,'CANCEL','cancel-1',{reason:'  wrong delivery  '});
  assert.equal(r.state,'RECONCILIATION_REQUIRED');
  assert.equal(f.state.operation.cancelReason,'wrong delivery');
  assert.equal(f.state.operation.custody.receivedById,tech);
  assert.deepEqual(f.state.totals,{borrowed:3,quarantined:0,available:0});
  await fails('STATE_CONFLICT',()=>run(f,admin,'COMMIT','commit-too-late'));
});
test('PORT-05 finalize cancellation requires trusted adapter-loaded proof and never credits stock',async()=>{
  const f=fakeWriter();await receive(f);await run(f,admin,'CANCEL','cancel-1',{reason:'physical handback'});
  const r=await run(f,admin,'FINALIZE_CANCELLATION','finalize-1',{custodyResolutionId:'resolution-1'});
  assert.equal(r.state,'CANCELLED');
  assert.equal(f.state.operation.custody.resolution.kind,'REVERSE_HANDOVER');
  assert.deepEqual(f.state.totals,{borrowed:3,quarantined:0,available:0});
  assert.ok(f.trace.includes('CUSTODY_LOCK'));
  assert.equal(f.state.audit.at(-1).event,'CUSTODY_RESOLUTION_APPROVED');
});
test('PORT-06 rejects absent or mismatched custody evidence and preserves reconciliation',async()=>{
  const f=fakeWriter();await receive(f);await run(f,admin,'CANCEL','cancel-1',{reason:'reason'});
  await fails('INVALID_CUSTODY_PROOF',()=>run(f,admin,'FINALIZE_CANCELLATION','finalize-1',{custodyResolutionId:'nonexistent'}));
  f.proofs.set('wrong',{...cancelledProof,custodyReceiverId:'another-actor'});
  await fails('INVALID_CUSTODY_PROOF',()=>run(f,admin,'FINALIZE_CANCELLATION','finalize-2',{custodyResolutionId:'wrong'}));
  assert.equal(f.state.operation.status,'RECONCILIATION_REQUIRED');
  assert.equal(f.state.audit.length,2);
});
test('PORT-07 same key and same payload replay returns persisted outcome, no second posting',async()=>{
  const f=fakeWriter();await ready(f);
  const first=await commit(f),journal=f.state.audit.length,postings=Object.keys(f.state.postings).length;
  const replay=await commit(f);
  assert.equal(first.replayed,false);
  assert.equal(replay.replayed,true);
  assert.equal(replay.state,'COMPLETED');
  assert.equal(f.state.audit.length,journal);
  assert.equal(Object.keys(f.state.postings).length,postings);
  assert.deepEqual(f.state.totals,{borrowed:0,quarantined:3,available:0});
});
test('PORT-08 same borrow/key different payload denied',async()=>{
  const f=fakeWriter();await receive(f);
  await run(f,admin,'CANCEL','cancel-key',{reason:'one'});
  await fails('REPLAY_CONFLICT',()=>run(f,admin,'CANCEL','cancel-key',{reason:'two'}));
  assert.equal(f.state.audit.length,2);
});
test('PORT-09 same borrow/key different actor denied',async()=>{
  const f=fakeWriter();await receive(f);
  await fails('FORBIDDEN',()=>run(f,manager,'RECEIVE','rcv-1'));
  assert.equal(f.state.audit.length,1);
});
test('PORT-10 self-verification, STUDENT and scoped access blocked inside TX',async()=>{
  const f=fakeWriter();
  await fails('NOT_AUTHORIZED',()=>run(f,student,'RECEIVE','student-1'));
  f.denyScope(true);
  await fails('FORBIDDEN',()=>receive(f));
  f.denyScope(false);
  await receive(f);
  await fails('NOT_AUTHORIZED',()=>run(f,tech,'VERIFY','tech-verify'));
  await fails('SELF_VERIFICATION',()=>run(f,admin,'VERIFY','self-verify-fake',{}).then(()=>{}).catch(e=>{throw e;}));
});
test('PORT-11 denies HTTP attempts to inject actor, trusted proof, lost, or locked details',async()=>{
  const f=fakeWriter();
  const raw=input('COMMIT','injected',{actor:{id:admin,role:'ADMIN'},lockedBorrowDetails:[]});
  await fails('INVALID_INPUT',()=>executeStage4CWriter(f.port,admin,raw));
  await fails('INVALID_INPUT',()=>executeStage4CWriter(f.port,admin,input('RECEIVE','lost',{condition:'LOST'})));
  await fails('INVALID_INPUT',()=>executeStage4CWriter(f.port,admin,input('FINALIZE_CANCELLATION','fake-proof',{custodyResolutionId:'resolution-1',trustedResolution:cancelledProof})));
  assert.equal(f.trace.length,0);
});
test('PORT-12 injected late persistence failure rolls back mock operation/replay/postings/audit together',async()=>{
  const f=fakeWriter();await ready(f);const before=f.state;
  f.setFail(true);
  await assert.rejects(()=>commit(f),/INJECTED_FAULT_AFTER_STAGING/);
  assert.deepEqual(f.state,before);
  f.setFail(false);
  await commit(f);
  assert.equal(f.state.audit.length,3);
  assert.equal(Object.keys(f.state.postings).length,2);
});
test('PORT-13 reject overreturn using locked borrowed details, do not fake physical inventory',async()=>{
  const f=fakeWriter();await ready(f);
  f.replaceBorrowDetails([{id:'line-good',quantity:2,returnedQuantity:1},
                          {id:'line-damage',quantity:1,returnedQuantity:0}]);
  await fails('OVER_RETURN',()=>commit(f));
  assert.deepEqual(f.state.totals,{borrowed:3,quarantined:0,available:0});
});
test('PORT-14 unknown operation, invalid principal and invalid identifiers fail closed',async()=>{
  const f=fakeWriter();
  await fails('FORBIDDEN',()=>executeStage4CWriter(f.port,'',input('RECEIVE','r')));
  await fails('INVALID_INPUT',()=>executeStage4CWriter(f.port,tech,input('RECEIVE','bad key')));
  await fails('NOT_FOUND',()=>executeStage4CWriter(f.port,tech,{...input('RECEIVE','r'),operationId:'unknown'}));
  assert.equal(f.state.audit.length,0);
});
