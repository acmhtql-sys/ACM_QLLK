/**
 * Pure Stage4C retry eligibility tests. No PostgreSQL, Prisma, HTTP or cloud.
 * The tested "rollback confirmed" marker is supplied by test code; tests DO
 * NOT confirm that any real database transaction has been rolled back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfirmedRolledBackTransactionError as RolledBack,
  RetryPolicyConfigurationError,
  runStage4CWithConfirmedRollbackRetry as retry,
  executeStage4CPrepareWithRetry,
  executeStage4CWriterWithRetry,
} from '../apps/api/src/modules/borrow/borrow.return-transaction-retry.ts';

const serialization = () => new RolledBack('SERIALIZATION_CONFLICT');
const deadlock = () => new RolledBack('DEADLOCK_ABORT');
const calls = [];
const withResult = (errors, value='OK') => async (attempt) => {
  calls.push(attempt);
  if (attempt <= errors.length) throw errors[attempt-1];
  return value;
};
const reset = () => { calls.length=0; };

test('RETRY-01 succeeds without retry on first successful attempt',async()=>{
  reset();
  assert.equal(await retry(withResult([])),'OK');
  assert.deepEqual(calls,[1]);
});
test('RETRY-02 confirmed serialization abort retries entire operation once',async()=>{
  reset();
  assert.equal(await retry(withResult([serialization()])),'OK');
  assert.deepEqual(calls,[1,2]);
});
test('RETRY-03 confirmed deadlock abort retries entire operation',async()=>{
  reset();
  assert.equal(await retry(withResult([deadlock()])),'OK');
  assert.deepEqual(calls,[1,2]);
});
test('RETRY-04 stops after three attempts even for confirmed rollback markers',async()=>{
  reset();
  await assert.rejects(()=>retry(withResult([serialization(),deadlock(),serialization()])),
    e=>e instanceof RolledBack && e.kind==='SERIALIZATION_CONFLICT');
  assert.deepEqual(calls,[1,2,3]);
});
test('RETRY-05 caller can reduce maxAttempts to two',async()=>{
  reset();
  await assert.rejects(()=>retry(withResult([deadlock(),deadlock()]),2),
    e=>e instanceof RolledBack);
  assert.deepEqual(calls,[1,2]);
});
test('RETRY-06 single attempt never silently retries',async()=>{
  reset();
  await assert.rejects(()=>retry(withResult([serialization()]),1),
    e=>e instanceof RolledBack);
  assert.deepEqual(calls,[1]);
});
test('RETRY-07 generic Prisma P2034-looking error is NOT automatically retried',async()=>{
  reset();
  const e=Object.assign(new Error('write conflict'),{code:'P2034'});
  await assert.rejects(()=>retry(withResult([e])),err=>err===e);
  assert.deepEqual(calls,[1]);
});
test('RETRY-08 unique evidence collision P2002 is NOT retried',async()=>{
  reset();
  const e=Object.assign(new Error('unique constraint'),{code:'P2002'});
  await assert.rejects(()=>retry(withResult([e])),err=>err===e);
  assert.deepEqual(calls,[1]);
});
test('RETRY-09 lost COMMIT response / uncertain transaction outcome is NOT retried',async()=>{
  reset();
  const e=Object.assign(new Error('commit response lost'),{code:'CONNECTION_LOST_AFTER_COMMIT'});
  await assert.rejects(()=>retry(withResult([e])),err=>err===e);
  assert.deepEqual(calls,[1]);
});
test('RETRY-10 forged marker object is rejected even if it sets rollbackConfirmed',async()=>{
  reset();
  const e={name:'ConfirmedRolledBackTransactionError',rollbackConfirmed:true,kind:'SERIALIZATION_CONFLICT'};
  await assert.rejects(()=>retry(withResult([e])),err=>err===e);
  assert.deepEqual(calls,[1]);
});
test('RETRY-11 invalid max attempts rejects before any transaction call',async()=>{
  for(const value of [0,-1,4,Infinity,NaN,1.5,'3',null]){
    reset();
    await assert.rejects(()=>retry(withResult([]),value),RetryPolicyConfigurationError);
    assert.deepEqual(calls,[]);
  }
});
test('RETRY-12 application validation error never retries',async()=>{
  reset();
  const e=Object.assign(new Error('role forbidden'),{code:'NOT_AUTHORIZED'});
  await assert.rejects(()=>retry(withResult([e])),err=>err===e);
  assert.deepEqual(calls,[1]);
});
test('RETRY-13 PREPARE wrapper reruns server auth, lock and state reads after abort',async()=>{
  const counters={tx:0,auth:0,lock:0,ops:0,details:0,persist:0};
  const tx={
    authenticateBorrowScope: async id=>{counters.auth++;return {id,role:'TECHNICIAN'};},
    lockBorrowRequest: async ()=>{counters.lock++;},
    findReplayForUpdate: async ()=>null,
    loadOperationStatesForUpdate: async ()=>{counters.ops++;return [];},
    loadBorrowDetailsForUpdate: async ()=>{counters.details++;return [{id:'line-1',quantity:2,returnedQuantity:0}];},
    persistPrepareAtomically: async write=>{
      counters.persist++;return {
        borrowRequestId:write.borrowRequestId,
        operationId:'op-1',state:'PREPARED',
        evidenceComparisonKey:write.evidenceComparisonKey,
      };
    },
  };
  const port={serializable:async cb=>{
    counters.tx++;
    if(counters.tx===1)throw serialization(); // aborted BEFORE DB work
    return cb(tx);
  }};
  const result=await executeStage4CPrepareWithRetry(port,'tech-1',{
    borrowRequestId:'borrow-1',requestKey:'req-1',physicalEvidenceRef:'ACM-01',
    lines:[{borrowDetailId:'line-1',returnedQuantity:1,condition:'GOOD'}],
  });
  assert.equal(result.replayed,false);
  assert.equal(result.evidenceComparisonKey,'ACM-01');
  assert.deepEqual(counters,{tx:2,auth:1,lock:1,ops:1,details:1,persist:1});
});
test('RETRY-14 RECEIVE wrapper retries a fake pre-transaction abort, keeping state unchanged',async()=>{
  let transactions=0,auth=0,locked=0,persisted=0;
  const tx={
    authenticateBorrowScope:async id=>{auth++;return {id,role:'TECHNICIAN'};},
    lockBorrowRequest:async ()=>{locked++;},
    findReplayForUpdate:async ()=>null,
    loadOperationForUpdate:async ()=>({
      status:'PREPARED',receiverId:null,verifierId:null,
      physicallyReceived:false,independentlyVerified:false,
      lines:[{borrowDetailId:'line-1',quantity:1,condition:'GOOD',qualityReleased:false}],
    }),
    loadBorrowDetailsForUpdate:async ()=>[],
    loadApprovedCustodyResolutionForUpdate:async ()=>null,
    persistAtomically:async write=>{
      persisted++;return {
        borrowRequestId:write.borrowRequestId,operationId:write.operationId,
        state:write.plan.next.status,event:write.auditEvent,
      };
    },
  };
  const port={serializable:async cb=>{
    transactions++;
    if(transactions===1)throw deadlock();
    return cb(tx);
  }};
  const result=await executeStage4CWriterWithRetry(port,'tech-1',{
    action:'RECEIVE',borrowRequestId:'borrow-1',
    operationId:'op-1',requestKey:'req-1',
  });
  assert.equal(result.event,'PHYSICAL_RECEIPT_CONFIRMED');
  assert.equal(result.replayed,false);
  assert.deepEqual([transactions,auth,locked,persisted],[2,1,1,1]);
});
