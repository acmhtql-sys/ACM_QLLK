/** Stage4C domain workflow: 17 offline tests, Node >=22.16, zero DB/HTTP. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planReturnTransition } from '../apps/api/src/modules/borrow/borrow.return-policy.ts';

const tech={id:'tech-1',role:'TECHNICIAN'}, manager={id:'manager-2',role:'LAB_MANAGER'};
const admin={id:'admin-3',role:'ADMIN'}, student={id:'student-1',role:'STUDENT'};
const start=()=>({status:'PREPARED',receiverId:null,verifierId:null,physicallyReceived:false,independentlyVerified:false,
  lines:[{borrowDetailId:'line-good',quantity:4,condition:'GOOD',qualityReleased:false},
    {borrowDetailId:'line-damaged',quantity:1,condition:'DAMAGED',qualityReleased:false}]});
const lockedBorrowDetails=[{id:'line-good',quantity:4,returnedQuantity:0},{id:'line-damaged',quantity:1,returnedQuantity:0}];
const receive=s=>planReturnTransition(s,{action:'RECEIVE',actor:tech}).next;
const verify=s=>planReturnTransition(s,{action:'VERIFY',actor:manager}).next;
const commit=s=>planReturnTransition(s,{action:'COMMIT',actor:admin,lockedBorrowDetails}).next;
const rejects=(f,code)=>assert.throws(f,e=>e?.name==='ReturnPolicyError'&&e.code===code);

test('WF-01 RECEIVE -> independent VERIFY -> COMMIT keeps items quarantined',()=>{
  const init=start(),received=receive(init),verified=verify(received),committed=commit(verified);
  assert.equal(init.receiverId,null); assert.equal(received.receiverId,tech.id);
  assert.equal(verified.verifierId,manager.id); assert.equal(committed.status,'COMPLETED');
  assert.deepEqual(committed.lines.map(l=>l.qualityReleased),[false,false]);
});
test('WF-02 QC releases only GOOD after authorized approval',()=>{
  const before=commit(verify(receive(start())));
  const plan=planReturnTransition(before,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-good']});
  assert.equal(plan.event,'QUALITY_RELEASE_REQUESTED'); assert.equal(plan.requiresAtomicDatabaseWrite,true);
  assert.deepEqual(plan.next.lines.map(l=>l.qualityReleased),[true,false]);
  assert.deepEqual(before.lines.map(l=>l.qualityReleased),[false,false]);
});
test('WF-03 damaged cannot become available',()=>{
  const s=commit(verify(receive(start())));
  rejects(()=>planReturnTransition(s,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-damaged']}),'STATE_CONFLICT');
});
test('WF-04 ADMIN may not verify own receipt',()=>{
  const s=planReturnTransition(start(),{action:'RECEIVE',actor:admin}).next;
  rejects(()=>planReturnTransition(s,{action:'VERIFY',actor:admin}),'SELF_VERIFICATION');
});
test('WF-05 COMMIT requires physical receipt and independent verifier',()=>{
  rejects(()=>planReturnTransition(start(),{action:'COMMIT',actor:admin,lockedBorrowDetails}),'RECEIPT_REQUIRED');
  rejects(()=>planReturnTransition(receive(start()),{action:'COMMIT',actor:admin,lockedBorrowDetails}),'VERIFICATION_REQUIRED');
});
test('WF-06 second RECEIVE cannot replace receiver identity',()=>{
  rejects(()=>planReturnTransition(receive(start()),{action:'RECEIVE',actor:admin}),'STATE_CONFLICT');
});
test('WF-07 second VERIFY cannot replace verifier identity',()=>{
  rejects(()=>planReturnTransition(verify(receive(start())),{action:'VERIFY',actor:admin}),'STATE_CONFLICT');
});
test('WF-08 CANCEL after RECEIVE requires reconciliation and keeps custody',()=>{
  const s=receive(start());
  rejects(()=>planReturnTransition(s,{action:'CANCEL',actor:manager,reason:'  '}),'CANCEL_REASON_REQUIRED');
  const result=planReturnTransition(s,{action:'CANCEL',actor:manager,reason:'  reason  '});
  assert.equal(result.next.status,'RECONCILIATION_REQUIRED'); assert.equal(result.next.cancelReason,'reason');
  assert.equal(result.next.custody.receivedById,tech.id); assert.equal(result.cancellationAvailableStockDelta,0);
  assert.deepEqual(result.next.lines,s.lines); assert.equal(result.event,'CANCEL_REQUESTED');
  rejects(()=>planReturnTransition(result.next,{action:'COMMIT',actor:admin,lockedBorrowDetails}),'STATE_CONFLICT');
});
test('WF-09 COMMIT cannot be planned twice',()=>{
  rejects(()=>planReturnTransition(commit(verify(receive(start()))),{action:'COMMIT',actor:admin,lockedBorrowDetails}),'STATE_CONFLICT');
});
test('WF-10 role enforcement blocks TECHNICIAN COMMIT and STUDENT RECEIVE',()=>{
  rejects(()=>planReturnTransition(verify(receive(start())),{action:'COMMIT',actor:tech,lockedBorrowDetails}),'NOT_AUTHORIZED');
  rejects(()=>planReturnTransition(start(),{action:'RECEIVE',actor:student}),'NOT_AUTHORIZED');
});
test('WF-11 QC before COMMIT or duplicate QC forbidden',()=>{
  const verified=verify(receive(start()));
  rejects(()=>planReturnTransition(verified,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-good']}),'STATE_CONFLICT');
  const qc=planReturnTransition(commit(verified),{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-good']}).next;
  rejects(()=>planReturnTransition(qc,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-good']}),'STATE_CONFLICT');
});
test('WF-12 unknown, duplicate, empty QC IDs rejected',()=>{
  const done=commit(verify(receive(start())));
  rejects(()=>planReturnTransition(done,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['other']}),'INVALID_QUANTITY');
  rejects(()=>planReturnTransition(done,{action:'QC_APPROVE',actor:manager,borrowDetailIds:['line-good','line-good']}),'INVALID_QUANTITY');
  rejects(()=>planReturnTransition(done,{action:'QC_APPROVE',actor:manager,borrowDetailIds:[]}), 'INVALID_QUANTITY');
});
test('WF-13 inconsistent stored state fails closed',()=>{
  rejects(()=>planReturnTransition({...start(),physicallyReceived:true,receiverId:null},{action:'RECEIVE',actor:tech}),'STATE_CONFLICT');
  rejects(()=>planReturnTransition({...start(),lines:[{borrowDetailId:'lost',quantity:1,condition:'LOST',qualityReleased:false}]},{action:'RECEIVE',actor:tech}),'INVALID_QUANTITY');
  rejects(()=>planReturnTransition({...start(),status:'COMPLETED'},{action:'QC_APPROVE',actor:admin,borrowDetailIds:['line-good']}),'STATE_CONFLICT');
});
test('WF-14 reconciliation state cannot be mutated blindly',()=>{
  rejects(()=>planReturnTransition({...start(),status:'RECONCILIATION_REQUIRED'},{action:'RECEIVE',actor:tech}),'STATE_CONFLICT');
});
test('WF-15 LOST is not a physical return',()=>{
  rejects(()=>planReturnTransition({...start(),lines:[{borrowDetailId:'lost',quantity:1,condition:'LOST',qualityReleased:false}]},{action:'RECEIVE',actor:tech}),'INVALID_QUANTITY');
});
test('WF-16 planner returns intent without mutating caller state or doing stock writes',()=>{
  const s=start(), before=JSON.stringify(s),p=planReturnTransition(s,{action:'RECEIVE',actor:tech});
  assert.equal(JSON.stringify(s),before); assert.notEqual(p.next,s); assert.equal(p.requiresAtomicDatabaseWrite,true);
});
test('WF-17 COMMIT checks the borrow details that must be locked by the future adapter',()=>{
  const v=verify(receive(start()));
  rejects(()=>planReturnTransition(v,{action:'COMMIT',actor:admin,lockedBorrowDetails:[
    {id:'line-good',quantity:4,returnedQuantity:1},{id:'line-damaged',quantity:1,returnedQuantity:0}
  ]}),'OVER_RETURN');
  rejects(()=>planReturnTransition(v,{action:'COMMIT',actor:admin,lockedBorrowDetails:[]}), 'UNRECOGNIZED_DETAIL');
  assert.equal(planReturnTransition(v,{action:'COMMIT',actor:admin,lockedBorrowDetails}).next.status,'COMPLETED');
});
