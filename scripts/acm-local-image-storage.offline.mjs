import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalImageStorage, detectImageMime } from '../apps/api/src/modules/storage/local-image.storage.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const stranger = '22222222-2222-4222-8222-222222222222';
const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0]);
const jpeg = Buffer.from([255,216,255,224,0,1,255,217]);
const webp = Buffer.from([82,73,70,70,8,0,0,0,87,69,66,80,86,80,56,32]);
const bad = (fn, code) => assert.rejects(fn, e => e?.name === 'LocalStorageFailure' && e.code === code);
async function isolated(fn) {
  const root = await mkdtemp(join(tmpdir(), 'acm-storage-'));
  try { return await fn(createLocalImageStorage({ directory: join(root, 'private') }), root); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const sample = (bytes=png, overrides={}) => ({ actorId: owner, purpose: 'ITEM_IMAGE', bytes, ...overrides });

test('STO-01 isolated upload returns private metadata and consistent digest', async () => isolated(async storage => {
  const saved = await storage.put(sample());
  assert.match(saved.id, /^[0-9a-f-]{36}$/i);
  assert.equal(saved.contentType, 'image/png'); assert.equal(saved.uploadedById, owner);
  assert.equal(saved.purpose, 'ITEM_IMAGE'); assert.equal(saved.sizeBytes, png.length);
  assert.match(saved.sha256, /^[0-9a-f]{64}$/); assert.ok(Number.isFinite(Date.parse(saved.createdAt)));
}));
test('STO-02 same actor can read exact persisted bytes', async () => isolated(async storage => {
  const saved = await storage.put(sample());
  const read = await storage.get(saved.id, owner);
  assert.deepEqual(read.bytes, png); assert.deepEqual(read.record, saved);
}));
test('STO-03 other actor cannot read or delete private file', async () => isolated(async storage => {
  const saved = await storage.put(sample());
  await bad(() => storage.get(saved.id, stranger), 'FORBIDDEN');
  await bad(() => storage.remove(saved.id, stranger), 'FORBIDDEN');
  assert.deepEqual((await storage.get(saved.id, owner)).bytes, png);
}));
test('STO-04 deletion idempotent, object no longer readable', async () => isolated(async storage => {
  const saved = await storage.put(sample());
  assert.equal(await storage.remove(saved.id, owner), true);
  assert.equal(await storage.remove(saved.id, owner), false);
  await bad(() => storage.get(saved.id, owner), 'NOT_FOUND');
}));
test('STO-05 PNG/JPEG/WebP signature allowlist', async () => isolated(async storage => {
  for (const [b, mime] of [[png,'image/png'], [jpeg,'image/jpeg'], [webp,'image/webp']]) {
    assert.equal(detectImageMime(b), mime);
    const r = await storage.put(sample(b, { claimedMime: mime, purpose: 'ASSET_IMAGE' }));
    assert.equal(r.contentType, mime);
  }
}));
test('STO-06 no arbitrary SVG HTML PDF or tiny truncated signatures', async () => isolated(async storage => {
  for (const b of [Buffer.from('<svg onload=alert(1)>'),Buffer.from('<html/>'),Buffer.from('%PDF-1.4'),Buffer.from([137,80,78,71,13,10,26,10])]) {
    await bad(() => storage.put(sample(b)), 'UNSUPPORTED_MEDIA');
  }
}));
test('STO-07 claimed MIME must match signature', async () => isolated(async storage => {
  await bad(() => storage.put(sample(png, { claimedMime: 'image/jpeg' })), 'UNSUPPORTED_MEDIA');
}));
test('STO-08 default five-megabyte size cap', async () => isolated(async storage => {
  await bad(() => storage.put(sample(Buffer.alloc(5*1024*1024+1))), 'SIZE_LIMIT');
}));
test('STO-09 custom size cap, maximum cap', async () => isolated(async (_storage,root) => {
  const small = createLocalImageStorage({directory:join(root,'tiny'), maxBytes:24});
  await bad(() => small.put(sample(png)), 'SIZE_LIMIT');
  assert.throws(() => createLocalImageStorage({directory:join(root,'over'),maxBytes:21*1024*1024}),e=>e.code==='INVALID_INPUT');
}));
test('STO-10 reject bad actor ID, purpose and payload', async () => isolated(async storage => {
  await bad(() => storage.put(sample(png,{actorId:'../root'})), 'INVALID_INPUT');
  await bad(() => storage.put(sample(png,{purpose:'SECRET_CONFIG'})), 'INVALID_INPUT');
  await bad(() => storage.put(sample('not bytes')), 'INVALID_INPUT');
  await bad(() => storage.get('missing', owner), 'INVALID_INPUT');
}));
test('STO-11 never use client filenames: path traversal IDs denied', async () => isolated(async storage => {
  for (const id of ['../other', '../../etc/passwd', '/root/.env', '0'.repeat(36)]) {
    await bad(() => storage.get(id, owner), 'INVALID_INPUT');
    await bad(() => storage.remove(id, owner), 'INVALID_INPUT');
  }
}));
test('STO-12 tampered image bytes detected by SHA-256 on read', async () => isolated(async (storage, root) => {
  const saved = await storage.put(sample());
  await writeFile(join(root,'private',saved.id+'.bin'), Buffer.alloc(png.length));
  await bad(() => storage.get(saved.id, owner), 'CORRUPT_RECORD');
}));
test('STO-13 tampered metadata rejected', async () => isolated(async (storage, root) => {
  const saved = await storage.put(sample());
  await writeFile(join(root,'private',saved.id+'.json'), JSON.stringify({id:saved.id, uploadedById:'evil'}));
  await bad(() => storage.get(saved.id, owner), 'CORRUPT_RECORD');
}));
test('STO-14 corrupt metadata JSON rejected', async () => isolated(async (storage,root) => {
  const saved = await storage.put(sample());
  await writeFile(join(root,'private',saved.id+'.json'), 'not-json');
  await bad(() => storage.get(saved.id, owner), 'CORRUPT_RECORD');
}));
test('STO-15 missing image binary causes fail-closed read', async () => isolated(async (storage,root) => {
  const saved = await storage.put(sample());
  await rm(join(root,'private',saved.id+'.bin'));
  await bad(() => storage.get(saved.id, owner), 'CORRUPT_RECORD');
}));
test('STO-16 receipt images remain private, no public URL in record', async () => isolated(async storage => {
  const saved = await storage.put(sample(png,{purpose:'RECEIPT_EVIDENCE'}));
  assert.equal(saved.purpose,'RECEIPT_EVIDENCE');
  assert.ok(!('url' in saved)); assert.ok(!('publicUrl' in saved));
  await bad(() => storage.get(saved.id, stranger), 'FORBIDDEN');
}));
test('STO-17 empty directory and filesystem root rejected', () => {
  for (const directory of ['', '/']) assert.throws(() => createLocalImageStorage({directory}),e=>e.code==='UNSAFE_DIRECTORY');
});
test('STO-18 symlinked private directory rejected on POSIX', async () => isolated(async (_storage,root) => {
  if (process.platform === 'win32') return;
  await symlink(root, join(root,'symlink'));
  const storage = createLocalImageStorage({directory:join(root,'symlink')});
  await bad(() => storage.put(sample()), 'UNSAFE_DIRECTORY');
}));
test('STO-19 existing world-readable private directory rejected on POSIX', async () => isolated(async (_storage, root) => {
  if (process.platform === 'win32') return;
  const { mkdir, chmod } = await import('node:fs/promises');
  await mkdir(join(root,'public'), {mode:0o755});
  await chmod(join(root,'public'), 0o755);
  const storage = createLocalImageStorage({directory:join(root,'public')});
  await bad(() => storage.put(sample()), 'UNSAFE_DIRECTORY');
}));
test('STO-20 source input bytes copied before persistence', async () => isolated(async storage => {
  const original = Buffer.from(png);
  const saved = await storage.put(sample(original)); original.fill(0);
  assert.deepEqual((await storage.get(saved.id,owner)).bytes,png);
}));
test('STO-21 only actor-owner can remove, metadata stays private', async () => isolated(async (storage,root) => {
  const saved = await storage.put(sample());
  const manifest = JSON.parse(await readFile(join(root,'private',saved.id+'.json'),'utf8'));
  assert.equal(manifest.uploadedById,owner); assert.ok(!('claimedMime' in manifest));
  await bad(() => storage.remove(saved.id, stranger),'FORBIDDEN');
}));
