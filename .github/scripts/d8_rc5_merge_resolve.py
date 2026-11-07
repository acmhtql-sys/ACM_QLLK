#!/usr/bin/env python3
"""Isolated D8 RC5 merge resolution. Never executes SQL or deploys."""
import json, pathlib, subprocess
R=pathlib.Path.cwd()
C={
"apps/api/package.json","apps/api/src/middleware/auth.ts",
"apps/api/src/modules/borrow/borrow.router.ts",
"apps/api/src/modules/borrow/borrow.service.ts",
"apps/api/src/modules/categories/categories.router.ts",
"apps/api/tests/borrow.return.unit.test.ts",
"apps/web/src/pages/BorrowReturnPage.tsx",
"package.json","packages/shared/src/validators.ts",
}
def sh(*args): return subprocess.check_output(["git",*args],text=True).strip()
def rd(p): return (R/p).read_text(encoding="utf-8")
def wr(p,s): (R/p).write_text(s,encoding="utf-8")
def exactly(s,old,new,where):
  n=s.count(old)
  if n!=1: raise ValueError(f"{where}: expected one anchor, got {n}")
  return s.replace(old,new,1)
conflicts=set(sh("diff","--name-only","--diff-filter=U").splitlines())
if conflicts!=C: raise SystemExit("D8_UNEXPECTED_CONFLICTS: "+repr(sorted(conflicts^C)))
for p in sorted(C):
  subprocess.run(["git","checkout","--ours","--",p],check=True)
  subprocess.run(["git","add","--",p],check=True)
print("D8_EXACT_RC5_CONFLICTS=",len(C))
root=json.loads(rd("package.json"))
root["overrides"]={**root.get("overrides",{}),"body-parser":"1.20.9",
  "follow-redirects":"1.16.2","qs":"6.16.2","postcss-selector-parser":"6.1.5"}
wr("package.json",json.dumps(root,indent=2,ensure_ascii=False)+"\n")
api=json.loads(rd("apps/api/package.json"))
api["dependencies"]["zod"]="4.6.7";api["devDependencies"]["vitest"]="4.1.12"
wr("apps/api/package.json",json.dumps(api,indent=2,ensure_ascii=False)+"\n")
shp=json.loads(rd("packages/shared/package.json"))
shp["dependencies"]["zod"]="4.6.7";shp["devDependencies"]["vitest"]="4.1.12"
shp["scripts"]["test"]="vitest run src";shp["scripts"]["test:unit"]="vitest run src"
wr("packages/shared/package.json",json.dumps(shp,indent=2,ensure_ascii=False)+"\n")
web=json.loads(rd("apps/web/package.json"))
web["dependencies"]["zod"]="4.6.7"
web["devDependencies"]["vite"]="7.3.7"
web["devDependencies"]["@vitejs/plugin-react"]="5.2.0"
wr("apps/web/package.json",json.dumps(web,indent=2,ensure_ascii=False)+"\n")

# Keep complete RC5 category, stock, borrow and kit validators. Zod4 only
# changes metadata arguments, issues arrays and UUID-shaped value semantics.
p="packages/shared/src/validators.ts";s=rd(p)
if s.count("required_error")!=10 or s.count("invalid_type_error")!=1 or s.count("export const ")<40:
  raise SystemExit("D8_VALIDATOR_RC5_BASELINE_CHANGED")
s=s.replace("required_error:","error:").replace("invalid_type_error:","error:")
s=s.replace(".uuid(", ".guid(")
wr(p,s)
issues=[]
for folder in ("apps/api/src","apps/api/tests","apps/web/src","packages/shared/src"):
  for ext in ("*.ts","*.tsx"):
    for q in (R/folder).rglob(ext):
      before=q.read_text(encoding="utf-8")
      after=before.replace(".error.errors",".error.issues")
      if after!=before: q.write_text(after,encoding="utf-8"); issues.append(str(q.relative_to(R)))
print("D8_ZOD4_ERROR_ISSUE_FILES",issues)

# Preserve stronger RC5 security and advanced return UX, never use the
# simplified parallel return-status protocol from PR #46.
auth=rd("apps/api/src/middleware/auth.ts")
router=rd("apps/api/src/modules/borrow/borrow.router.ts")
cat=rd("apps/api/src/modules/categories/categories.router.ts")
ui=rd("apps/web/src/pages/BorrowReturnPage.tsx")
if not all(("verifyPasswordTag" in auth,"computePasswordTag" in auth,
  "requireIdempotencyKey" in router,"return-status/:key" in router,
  len(cat.splitlines())>=130,len(ui.splitlines())>900,"return-status" in ui)):
  raise SystemExit("D8_RC5_SECURITY_OR_FEATURE_LOSS")
print("D8_RC5_AUTH_RETURN_CATEGORIES_KITS_UI_PRESERVED")

# Add row locks to RC5 existing atomic/idempotent RETURN transaction.
p="apps/api/src/modules/borrow/borrow.service.ts";s=rd(p)
i=s.index("  async returnBorrowRequest(")
j=s.index("  async listBorrowRequests(",i)
a=s[i:j]
a=exactly(a,"      const req = await tx.borrowRequest.findUnique({",
  "      // D8-P0: serialize a BorrowRequest BEFORE reading returnedQuantity.\n"
  "      await tx.$queryRaw`SELECT \"id\" FROM \"borrow_requests\"\n"
  "        WHERE \"id\" = ${id}::uuid FOR UPDATE`;\n"
  "      const req = await tx.borrowRequest.findUnique({","borrow request lock")
a=exactly(a,"        const bal = await tx.stockBalance.findUnique({",
  "        // D8-P0: source balance lock protects onHandBefore and borrowed.\n"
  "        await tx.$queryRaw`SELECT \"id\" FROM \"stock_balances\"\n"
  "          WHERE \"itemId\" = ${detail.itemId}::uuid\n"
  "          AND \"locationId\" = ${destinationLocationId}::uuid FOR UPDATE`;\n"
  "        const bal = await tx.stockBalance.findUnique({","source balance lock")
if "Chưa hỗ trợ trả linh kiện sang kho khác" not in a or "idempotencyRecord.update" not in a:
  raise SystemExit("D8_RC5_RETURN_POLICY_LOST")
wr(p,s[:i]+a+s[j:])

for p,anchor in (
  ("apps/api/tests/borrow.return.unit.test.ts","  const mockTx = {\n"),
  ("apps/api/tests/borrow.return.idempotency.phase11d.unit.test.ts","  const tx = {\n")):
  wr(p,exactly(rd(p),anchor,anchor+"    $queryRaw: vi.fn(),\n",p+" mocked row lock"))

# Existing RC5 only permits same-warehouse returns until explicit business
# approval. Do not run candidate's A->B integration fixture as if accepted.
print("D8_RETURN_CROSS_LOCATION_POLICY=DENY_409")
# GitHub Actions GITHUB_TOKEN cannot push changes to workflow paths in this
# repository. Keep all RC5 workflows unmodified in this isolated MERGE commit.
# Specific CI/browsers gates are set up independently through authorized
# GitHub content operations, never by expanding the workflow token's scope.
subprocess.run(["git","restore","--source=HEAD","--staged","--worktree","--",".github/workflows"],check=True)
print("D8_WORKFLOWS_RETAINED_FROM_RC5_AND_ISOLATED_BRANCH")
# Import the candidate's real PostgreSQL test, but preserve the RC5 contract.
# A->B must fail 409 without writes; concurrent A->A returns must serialize.
# Do not silently skip the new database test to get a green CI result.
testp="apps/api/tests/borrow.return.concurrency.db.integration.test.ts"
t=rd(testp)
t=exactly(t,"import { createApp } from '../src/app';",
  "import { createApp } from '../src/app';\nimport { computePasswordTag } from '../src/modules/auth/auth.security';",testp+" jwt binding")
t=exactly(t,"D8-P0 isolated CI PostgreSQL return concurrency and A -> B ledger",
  "D8 integration: real PostgreSQL return concurrency, same-source ledger and cross-location rejection",testp+" suite")
t=exactly(t,"  let requestNumber = '';",
  "  let requestNumber = '';\n  let adminPasswordHash = '';",testp+" fixture")
t=exactly(t,"      role: UserRole.ADMIN,\n    };",
  "      role: UserRole.ADMIN,\n    };\n    adminPasswordHash = admin!.passwordHash;",testp+" pwdTag fixture")
t=exactly(t,"real row lock serializes concurrent full returns; A borrowed goes to zero, B onHand gains exactly 4",
  "real row lock serializes same-source returns; cross-location writes fail closed",testp+" test")
t=exactly(t,"locationId: created.destinationLocationId,\n        condition: AssetCondition.GOOD,",
  "locationId: created.sourceLocationId,\n        condition: AssetCondition.GOOD,",testp+" success source")
t=exactly(t,"    // Lock BorrowRequest using a third transaction to ensure both service",
  """    // A->B must remain 409 and must not commit any return, key or stock write.
    await expect(borrowService.returnBorrowRequest(
      created.requestId,
      { items: [{ ...input.items[0], locationId: created.destinationLocationId }] },
      operator,
      idempotencyKeyPrefix + 'X'
    )).rejects.toMatchObject({ statusCode: 409 });
    expect(await prisma.returnTransaction.count({
      where: { borrowRequestId: created.requestId },
    })).toBe(0);
    const beforeLock = await prisma.stockBalance.findUnique({
      where: { itemId_locationId: {
        itemId: created.itemId, locationId: created.sourceLocationId,
      } },
    });
    expect(beforeLock).toMatchObject({ onHand: 6, borrowed: 4 });
    expect(await prisma.idempotencyRecord.count({
      where: { key: idempotencyKeyPrefix + 'X' },
    })).toBe(0);

    // Lock BorrowRequest using a third transaction to ensure both service""",testp+" deny regression")
t=exactly(t,"      id: operator.id,\n      email: operator.email,",
  "      id: operator.id,\n      pwdTag: computePasswordTag(operator.id, adminPasswordHash),\n      email: operator.email,",testp+" strong JWT")
if t.count("/return-idempotency/")!=2:
  raise SystemExit("D8_UNEXPECTED_CANDIDATE_STATUS_CONTRACT")
t=t.replace("/return-idempotency/","/return-status/")
t=exactly(t,"""    expect(readStatus.body.data).toMatchObject({
      status: 'COMPLETED',
      confirmed: true,
      returnNumber: winningReturn.result.returnNumber,
    });""",
  """    expect(readStatus.body.data).toMatchObject({
      state: 'COMPLETED',
      requiresReconciliation: false,
      receipt: {
        returnNumber: winningReturn.result.returnNumber,
        borrowRequestId: created.requestId,
      },
    });""",testp+" RC5 read receipt")
t=exactly(t,"expect(missingKey.status).toBe(428);",
  "expect(missingKey.status).toBe(400);",testp+" RC5 missing key")
t=exactly(t,"expect(origin).toMatchObject({ onHand: 6, borrowed: 0 });",
  "expect(origin).toMatchObject({ onHand: 10, borrowed: 0 });",testp+" origin")
t=exactly(t,"expect(destination).toMatchObject({ onHand: 4, borrowed: 0, quarantined: 0 });",
  "expect(destination).toMatchObject({ onHand: 0, borrowed: 0, quarantined: 0 });",testp+" destination")
t=exactly(t,"""      locationId: created.destinationLocationId,
      quantityDelta: 4,
      onHandBefore: 0,
      onHandAfter: 4,""",
  """      locationId: created.sourceLocationId,
      quantityDelta: 4,
      onHandBefore: 6,
      onHandAfter: 10,""",testp+" movement")
wr(testp,t)
print("D8_PG_SYNTHETIC_CROSS_LOCATION_DENY_AND_SAME_SOURCE_LOCK_TEST=PREPARED")

print("D8_VALIDATOR_EXPORTS",rd("packages/shared/src/validators.ts").count("export const "))
print("D8_READY_FOR_ISOLATED_BUILDS=YES")
