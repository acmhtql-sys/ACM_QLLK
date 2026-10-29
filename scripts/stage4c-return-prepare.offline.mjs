/** Stage4C PREPARE port mock tests, no real DB or HTTP.
 * Fake globally serializes operations and uses a Map as UNIQUE registry;
 * this is a test double, NOT evidence of PostgreSQL race safety.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { executeStage4CPrepare } from '../apps/api/src/modules/borrow/borrow.return-prepare.contract.ts';
import { ReturnPolicyError } from '../apps/api/src/modules/borrow/borrow.return-policy.ts';

const staff='tech-1',manager='manager-1',student='student-1';
const roles={ [staff]:'TECHNICIAN',[manager]:'LAB_MANAGER',[student]:'STUDENT' };
const line=(id='detail-1',quantity=4,condition='GOOD')=>({borrowDetailId:id,returnedQuantity:quantity,condition});
const req=(borrow='borrow-1',key='request-1',evidence='RT-001',lines=[line()])=>
  ({borrowRequestId:borrow,requestKey:key,physicalEvidenceRef:evidence,lines});
const fails=async (code,fn)=>assert.rejects(fn,e=>e?.code===code);
function mockPort() {
  let db={
    evidence:new Map(),replays:new Map(),ops:new Map(),audits:[],
    seq:0,borrows:new Map([
      ['borrow-1',[{id:'detail-1',quantity:10,returnedQuantity:0},{id:'detail-2',quantity:5,returnedQuantity:0}]],
      ['borrow-2',[{id:'detail-1',quantity:10,returnedQuantity:0},{id:'detail-2',quantity:5,returnedQuantity:0}]],
    ]),
  };
  let failAfterStage=false,forbidden=false,badResult=false;
  const trace=[];
  let tail=Promise.resolve();
  const port={
    serializable:async (work)=>{
      // Fake global queue: stronger than per-borrow locks; never a PG lock proof.
      let unlock;
      const next=new Promise(resolve=>{unlock=resolve;});
      const previous=tail;tail=next;
      await previous;
      const copy=structuredClone(db);
      let locked=false,borrowId=null;
      trace.push('BEGIN');
      const tx={
        authenticateBorrowScope:async (id,b)=>{
          trace.push('AUTH');
          if(forbidden || !roles[id] || !copy.borrows.has(b))return null;
          return {id,role:roles[id]};
        },
        lockBorrowRequest:async b=>{
          trace.push('BORROW_LOCK');
          if(!copy.borrows.has(b))throw new Error('UNKNOWN_BORROW');
          locked=true;borrowId=b;
        },
        findReplayForUpdate:async (b,key)=>{
          assert.ok(locked);assert.equal(b,borrowId);trace.push('REPLAY_LOOKUP');
          return structuredClone(copy.replays.get(b+'|'+key)??null);
        },
        loadOperationStatesForUpdate:async b=>{
          assert.ok(locked);assert.equal(b,borrowId);trace.push('OPS_LOCK');
          return (copy.ops.get(b)??[]).map(x=>x.state);
        },
        loadBorrowDetailsForUpdate:async b=>{
          assert.ok(locked);assert.equal(b,borrowId);trace.push('BORROW_DETAILS_LOCK');
          return structuredClone(copy.borrows.get(b));
        },
        persistPrepareAtomically:async intent=>{
          assert.ok(locked);assert.equal(intent.borrowRequestId,borrowId);
          trace.push('ATOMIC_PREPARE');
          assert.equal(intent.idempotencyRetentionDays,365);
          assert.equal(intent.auditEvent,'RETURN_PREPARED');
          assert.equal(intent.actor.id,staff);
          assert.match(intent.payloadSha256,/^[0-9a-f]{64}$/);
          assert.deepEqual(intent.physicalLines.every(x=>x.condition==='GOOD'||x.condition==='DAMAGED'),true);
          // Contract: global uniqueness across ALL borrows and issuers must be enforced
          // by a DB unique constraint in the real implementation.
          if(copy.evidence.has(intent.evidenceComparisonKey))
            throw new ReturnPolicyError('EVIDENCE_CONFLICT');
          if(copy.replays.has(intent.borrowRequestId+'|'+intent.requestKey))
            throw new Error('UNIQUE_IDEMPOTENCY_VIOLATION');
          const id='return-op-'+(++copy.seq);
          const result={
            borrowRequestId:intent.borrowRequestId,operationId:id,
            evidenceComparisonKey:intent.evidenceComparisonKey,state:'PREPARED',
          };
          copy.evidence.set(intent.evidenceComparisonKey,{
            borrowId:intent.borrowRequestId,original:intent.originalEvidenceRef,
          });
          copy.ops.set(intent.borrowRequestId,[
            ...(copy.ops.get(intent.borrowRequestId)??[]),
            {state:'PREPARED',operationId:id},
          ]);
          copy.replays.set(intent.borrowRequestId+'|'+intent.requestKey,{
            borrowRequestId:intent.borrowRequestId,requestKey:intent.requestKey,
            actorId:intent.actor.id,payloadSha256:intent.payloadSha256,
            originalResult:result,
          });
          copy.audits.push({actorId:intent.actor.id,event:intent.auditEvent,borrowId:intent.borrowRequestId});
          if(failAfterStage)throw Error('FAULT_AFTER_ATOMIC_STAGE');
          return badResult?{...result,borrowRequestId:'wrong-borrow'}:result;
        },
      };
      try{
        const result=await work(tx);
        db=copy;trace.push('COMMIT_FAKE');
        return result;
      }finally{unlock();}
    },
  };
  return {
    port,trace,get state(){return structuredClone(db);},
    setFail(v){failAfterStage=v;},
    setForbidden(v){forbidden=v;},
    setBadResult(v){badResult=v;},
    setBorrowDetails(b,rows){db.borrows.set(b,structuredClone(rows));},
    terminal(b){db.ops.set(b,(db.ops.get(b)??[]).map(x=>({...x,state:'CANCELLED'})));},
    reconciliation(b){db.ops.set(b,(db.ops.get(b)??[]).map(x=>({...x,state:'RECONCILIATION_REQUIRED'})));},
  };
}
const issue=(f,data=req(),actor=staff)=>executeStage4CPrepare(f.port,actor,data);

test('PREP-01 issues global evidence key and records atomic PREPARE intent',async()=>{
  const f=mockPort();const r=await issue(f);
  assert.equal(r.replayed,false);assert.equal(r.state,'PREPARED');
  assert.equal(r.evidenceComparisonKey,'RT-001');
  assert.equal(f.state.evidence.get('RT-001').original,'RT-001');
  assert.equal(f.state.audits.length,1);
  assert.deepEqual(f.trace,['BEGIN','AUTH','BORROW_LOCK','REPLAY_LOOKUP','OPS_LOCK','BORROW_DETAILS_LOCK','ATOMIC_PREPARE','COMMIT_FAKE']);
});
test('PREP-02 rejects global casefold collision from different borrow',async()=>{
  const f=mockPort();await issue(f,req('borrow-1','key-1','ABC-101'));
  await fails('EVIDENCE_CONFLICT',()=>issue(f,req('borrow-2','key-2','abc-101')));
  assert.equal(f.state.evidence.size,1);
  assert.equal(f.state.audits.length,1);
});
test('PREP-03 cancellation does not release a globally issued evidence code',async()=>{
  const f=mockPort();await issue(f,req('borrow-1','key-1','R-01'));
  f.terminal('borrow-1');
  await fails('EVIDENCE_CONFLICT',()=>issue(f,req('borrow-2','key-2','r-01')));
  assert.equal(f.state.evidence.size,1);
});
test('PREP-04 same key/same payload replay does not duplicate evidence or audit',async()=>{
  const f=mockPort();const first=await issue(f);
  const second=await issue(f);
  assert.equal(first.replayed,false);assert.equal(second.replayed,true);
  assert.equal(first.operationId,second.operationId);
  assert.equal(f.state.evidence.size,1);assert.equal(f.state.audits.length,1);
});
test('PREP-05 evidence letter case and reordered lines retain stable hash',async()=>{
  const f=mockPort();const lines=[line('detail-2',2,'DAMAGED'),line('detail-1',3)];
  const first=await issue(f,req('borrow-1','key-1','AbC-101',lines));
  const second=await issue(f,req('borrow-1','key-1','aBc-101',[...lines].reverse()));
  assert.equal(second.replayed,true);assert.equal(first.operationId,second.operationId);
});
test('PREP-06 same idempotency key changed physical quantity is a conflict',async()=>{
  const f=mockPort();await issue(f);
  await fails('REPLAY_CONFLICT',()=>issue(f,req('borrow-1','request-1','RT-001',[line('detail-1',5)])));
  assert.equal(f.state.audits.length,1);
});
test('PREP-07 idempotency key cannot leak results across actors',async()=>{
  const f=mockPort();await issue(f);
  await fails('FORBIDDEN',()=>issue(f,req(),'manager-1'));
  assert.equal(f.state.evidence.size,1);
});
test('PREP-08 disallows unauthorized STUDENT and denied borrow scope',async()=>{
  const f=mockPort();
  await fails('NOT_AUTHORIZED',()=>issue(f,req(),student));
  f.setForbidden(true);
  await fails('FORBIDDEN',()=>issue(f,req(),staff));
  assert.equal(f.state.evidence.size,0);
});
test('PREP-09 unresolved PREPARED or reconciliation blocks second receipt operation',async()=>{
  const f=mockPort();await issue(f);
  await fails('OPERATION_UNRESOLVED',()=>issue(f,req('borrow-1','key-2','RT-002')));
  f.reconciliation('borrow-1');
  await fails('OPERATION_UNRESOLVED',()=>issue(f,req('borrow-1','key-3','RT-003')));
  assert.equal(f.state.audits.length,1);
});
test('PREP-10 rejects LOST, duplicate, invalid or injected request lines',async()=>{
  const f=mockPort();
  const bad=[
    {...req(),lines:[line('detail-1',1,'LOST')]},
    {...req(),lines:[line(),line()]},
    {...req(),lines:[line('detail-1',0)]},
    {...req(),lines:[{...line(),actorId:'fake-admin'}]},
    {...req(),actor:{id:'fake-admin',role:'ADMIN'}},
    {...req(),trustedEvidenceRegistryId:'forged'},
  ];
  for (const payload of bad)await fails('INVALID_INPUT',()=>issue(f,payload));
  assert.equal(f.state.audits.length,0);
});
test('PREP-11 rejects non-ASCII evidence and missing input fields',async()=>{
  const f=mockPort();
  await fails('INVALID_EVIDENCE',()=>issue(f,req('borrow-1','key-1','ĐƠN-1')));
  await fails('INVALID_INPUT',()=>issue(f,{...req(),requestKey:'two words'}));
  await fails('INVALID_INPUT',()=>issue(f,{...req(),borrowRequestId:''}));
  assert.equal(f.trace.length,0);
});
test('PREP-12 rejects over-return based on adapter-locked outstanding quantities',async()=>{
  const f=mockPort();
  f.setBorrowDetails('borrow-1',[{id:'detail-1',quantity:10,returnedQuantity:8}]);
  await fails('OVER_RETURN',()=>issue(f));
  assert.equal(f.state.evidence.size,0);
});
test('PREP-13 simulated late persistence fault rolls back evidence, audit, operation, replay',async()=>{
  const f=mockPort(),original=f.state;f.setFail(true);
  await assert.rejects(()=>issue(f),/FAULT_AFTER_ATOMIC_STAGE/);
  assert.deepEqual(f.state,original);
  f.setFail(false);
  await issue(f);
  assert.equal(f.state.evidence.size,1);assert.equal(f.state.audits.length,1);
});
test('PREP-14 malformed adapter result does not commit in fake transaction',async()=>{
  const f=mockPort();f.setBadResult(true);
  await fails('BAD_ADAPTER_RESULT',()=>issue(f));
  assert.equal(f.state.evidence.size,0);
});
test('PREP-15 same borrowed item supports subsequent partial return after prior terminal operation',async()=>{
  const f=mockPort();
  await issue(f,req('borrow-1','key-1','RT-001',[line('detail-1',4)]));
  f.terminal('borrow-1');f.setBorrowDetails('borrow-1',[{id:'detail-1',quantity:10,returnedQuantity:4}]);
  await issue(f,req('borrow-1','key-2','RT-002',[line('detail-1',6)]));
  assert.equal(f.state.evidence.size,2);
  assert.equal(f.state.audits.length,2);
});
test('PREP-16 concurrent global evidence issue across borrows permits at most one in mock',async()=>{
  const f=mockPort();
  const settled=await Promise.allSettled([
    issue(f,req('borrow-1','req-1','GLOBAL-101')),
    issue(f,req('borrow-2','req-2','global-101')),
  ]);
  assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(settled.filter(x=>x.status==='rejected'&&x.reason?.code==='EVIDENCE_CONFLICT').length,1);
  assert.equal(f.state.evidence.size,1);assert.equal(f.state.audits.length,1);
});
