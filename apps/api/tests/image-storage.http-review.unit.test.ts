import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { AppError } from '../src/shared/AppError';
import { createLocalItemImageReviewRouter, isLocalImageHttpReviewEnabled } from '../src/modules/storage/image-storage.http-review';
import { TestOnlyMemoryItemImageStorage } from '../src/modules/storage/image-storage.memory';
import { MAX_ITEM_IMAGE_BYTES } from '../src/modules/storage/image-storage.contract';
import type { ItemImageAuditEvent } from '../src/modules/storage/image-storage.audit.contract';

// This suite isolates HTTP parsing/provider behavior with a synthetic principal.
// Mandatory REAL JWT/live-role authentication is verified separately against
// ephemeral CI PostgreSQL in image-storage.http-auth.integration.test.ts.
vi.mock('../src/middleware/auth', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const A='11111111-1111-4111-8111-111111111111', B='22222222-2222-4222-8222-222222222222';
const ACTOR='33333333-3333-4333-8333-333333333333';
const PNG=Buffer.from([137,80,78,71,13,10,26,10,0,1,2]);
const JPG=Buffer.from([255,216,255,224,1,2]);

describe('L4 UNMOUNTED image review router (synthetic HTTP only)', () => {
  let store: TestOnlyMemoryItemImageStorage;
  let active: ReturnType<typeof vi.fn>;
  let audit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new TestOnlyMemoryItemImageStorage(); // only constructed under NODE_ENV=test
    active = vi.fn(async (id: string) => id===A || id===B);
    audit = vi.fn(async (_event: ItemImageAuditEvent) => undefined);
    vi.stubEnv('NODE_ENV','development');
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE','local_dev');
    vi.stubEnv('ACM_LOCAL_IMAGE_STORAGE_ENABLED','true');
    vi.stubEnv('ACM_LOCAL_IMAGE_HTTP_REVIEW_ENABLED','true');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  function app(role?: UserRole) {
    const server=express();
    // Synthetic request principal; production MUST mount authenticate first.
    server.use((req:Request,_res:Response,next:NextFunction)=>{
      if(role) req.user={id:ACTOR,email:'fixture@example.invalid',role,fullName:'Synthetic User'};
      next();
    });
    server.use('/review-images',createLocalItemImageReviewRouter({storage:store,isActiveItem:active,audit:{record:audit}}));
    server.use((err:unknown,_req:Request,res:Response,_next:NextFunction)=>{
      const status=err instanceof AppError?err.statusCode:500;
      res.status(status).json({success:false,message:err instanceof Error?err.message:'Unknown'});
    });
    return server;
  }
  function upload(server:ReturnType<typeof app>,itemId=A,body=PNG,mime='image/png',filename='fixture.png'){
    return request(server).post('/review-images/'+itemId)
      .set('Content-Type',mime).set('X-File-Name',filename).send(body);
  }

  it('01: ADMIN uploads PNG, reads exact bytes privately, source actor is server principal',async()=>{
    const server=app(UserRole.ADMIN);
    const res=await upload(server);
    expect(res.status).toBe(201);
    expect(res.body.data.itemId).toBe(A);
    expect(res.body.data.uploadedById).toBe(ACTOR);
    expect(res.body.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    const got=await request(server).get('/review-images/'+A+'/'+res.body.data.id);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(PNG);
    expect(got.headers['cache-control']).toBe('private, no-store');
    expect(got.headers['content-disposition']).toBe('attachment');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
  });
  it('02: LAB_MANAGER uploads a valid JPEG',async()=>{
    const server=app(UserRole.LAB_MANAGER);
    const res=await upload(server,A,JPG,'image/jpeg','fixture.jpg');
    expect(res.status).toBe(201);
    expect(res.body.data.mimeType).toBe('image/jpeg');
  });
  it('03: anonymous request returns 401 before item lookup',async()=>{
    expect((await upload(app())).status).toBe(401);
    expect(active).not.toHaveBeenCalled();
  });
  it.each([UserRole.STUDENT,UserRole.TECHNICIAN])('04: role %s cannot upload/read',async role=>{
    const server=app(role);
    expect((await upload(server)).status).toBe(403);
    expect((await request(server).get('/review-images/'+A+'/'+A)).status).toBe(403);
    expect(active).not.toHaveBeenCalled();
  });
  it('05: IDOR image read across item IDs is denied',async()=>{
    const server=app(UserRole.ADMIN);
    const saved=await upload(server,A);
    expect(saved.status).toBe(201);
    expect((await request(server).get('/review-images/'+B+'/'+saved.body.data.id)).status).toBe(404);
  });
  it('06: inactive/unknown item denies writes and malformed UUID denies reads',async()=>{
    const server=app(UserRole.ADMIN);
    expect((await upload(server,'44444444-4444-4444-8444-444444444444')).status).toBe(404);
    expect((await upload(server,'not-an-item')).status).toBe(422);
    expect((await request(server).get('/review-images/'+A+'/not-image')).status).toBe(422);
  });
  it('07: correct declared MIME but mismatched magic bytes fails 422',async()=>{
    expect((await upload(app(UserRole.ADMIN),A,JPG)).status).toBe(422);
  });
  it.each(['image/svg+xml','image/gif'])('08: active/unsupported MIME %s fails 415',async mime=>{
    expect((await upload(app(UserRole.ADMIN),A,Buffer.from('<svg/>'),mime,'fixture.svg')).status).toBe(415);
  });
  it('09: missing or traversed filename is rejected',async()=>{
    const server=app(UserRole.ADMIN);
    const missing=await request(server).post('/review-images/'+A)
      .set('Content-Type','image/png').send(PNG);
    expect(missing.status).toBe(422);
    expect((await upload(server,A,PNG,'image/png','../bad.png')).status).toBe(422);
  });
  it('10: 5 MiB+ body is rejected before provider saves it',async()=>{
    const tooLarge=Buffer.alloc(MAX_ITEM_IMAGE_BYTES+1);
    PNG.copy(tooLarge);
    expect((await upload(app(UserRole.ADMIN),A,tooLarge)).status).toBe(413);
  });
  it('11: missing explicit review flag prevents HTTP access',async()=>{
    vi.stubEnv('ACM_LOCAL_IMAGE_HTTP_REVIEW_ENABLED','false');
    expect(isLocalImageHttpReviewEnabled()).toBe(false);
    expect((await upload(app(UserRole.ADMIN))).status).toBe(404);
    expect(active).not.toHaveBeenCalled();
  });
  it.each(['cloud_staging','production'])('12: %s profile cannot expose the route',async profile=>{
    vi.stubEnv('ACM_DEPLOYMENT_PROFILE',profile);
    expect(isLocalImageHttpReviewEnabled()).toBe(false);
    expect((await upload(app(UserRole.ADMIN))).status).toBe(404);
  });
  it.each(['test','production'])('13: NODE_ENV=%s fails closed',async nodeEnv=>{
    vi.stubEnv('NODE_ENV',nodeEnv);
    expect(isLocalImageHttpReviewEnabled()).toBe(false);
    expect((await upload(app(UserRole.ADMIN))).status).toBe(404);
  });
  it('14: DELETE is deliberately absent until retention and audit are approved',async()=>{
    const server=app(UserRole.ADMIN),post=await upload(server);
    expect(post.status).toBe(201);
    const endpoint='/review-images/'+A+'/'+post.body.data.id;
    expect((await request(server).delete(endpoint)).status).toBe(404);
    expect((await request(server).get(endpoint)).status).toBe(200);
  });
  it('15: upload/read audit only contains trusted IDs, hash and byte size, never raw bytes',async()=>{
    const server=app(UserRole.ADMIN);
    const posted=await upload(server);
    expect(posted.status).toBe(201);
    const imageId=posted.body.data.id as string;
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action:'IMAGE_UPLOAD',actorId:ACTOR,itemId:A,imageId,
      sha256:posted.body.data.sha256,byteLength:PNG.length,
      recordedAt:expect.any(String),
    }));
    const read=await request(server).get('/review-images/'+A+'/'+imageId);
    expect(read.status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenLastCalledWith(expect.objectContaining({
      action:'IMAGE_READ',actorId:ACTOR,itemId:A,imageId,
    }));
    for(const [event] of audit.mock.calls){
      expect(event).not.toHaveProperty('originalName');
      expect(event).not.toHaveProperty('contents');
      expect(event).not.toHaveProperty('token');
      expect(event).not.toHaveProperty('role');
    }
  });
  it('16: audit failure after upload denies 201 and compensates synthetic file',async()=>{
    const server=app(UserRole.ADMIN);
    const saved=vi.spyOn(store,'save');
    audit.mockRejectedValueOnce(new Error('audit offline'));
    const res=await upload(server);
    expect(res.status).toBe(503);
    expect(saved).toHaveBeenCalledTimes(1);
    const image=await saved.mock.results[0].value;
    expect(await store.readForItem(A,image.id)).toBeNull();
  });
  it('17: audit failure before image read prevents private bytes disclosure',async()=>{
    const server=app(UserRole.ADMIN);
    const posted=await upload(server);
    expect(posted.status).toBe(201);
    audit.mockRejectedValueOnce(new Error('audit unavailable'));
    const read=await request(server).get('/review-images/'+A+'/'+posted.body.data.id);
    expect(read.status).toBe(503);
    expect(read.body).not.toEqual(PNG);
    expect(read.headers['content-type']).not.toMatch(/image\/png/);
  });
  it('18: unauthorized and cross-item image access cannot record a successful read event',async()=>{
    const owner=app(UserRole.ADMIN),disabled=app(UserRole.STUDENT);
    const posted=await upload(owner);
    expect(posted.status).toBe(201);
    audit.mockClear();
    const denied=await request(disabled).get('/review-images/'+A+'/'+posted.body.data.id);
    const missing=await request(owner).get('/review-images/'+B+'/'+posted.body.data.id);
    expect(denied.status).toBe(403);
    expect(missing.status).toBe(404);
    expect(audit).not.toHaveBeenCalled();
  });
  it('19: missing audit sink rejects router construction, never silently logs to console',()=>{
    expect(()=>createLocalItemImageReviewRouter({
      storage:store,isActiveItem:active,
    } as Parameters<typeof createLocalItemImageReviewRouter>[0])).toThrow(
      'LOCAL_IMAGE_AUDIT_SINK_REQUIRED'
    );
  });
  it('20: if compensation delete also fails, the request is denied (orphan risk remains)',async()=>{
    const server=app(UserRole.ADMIN);
    audit.mockRejectedValueOnce(new Error('sink error'));
    vi.spyOn(store,'deleteForItem').mockRejectedValueOnce(new Error('delete error'));
    const res=await upload(server);
    expect(res.status).toBe(503);
    // Deliberate limitation: only a DB transaction / durable outbox can
    // guarantee absence of an orphan when both audit and cleanup fail.
  });

});
