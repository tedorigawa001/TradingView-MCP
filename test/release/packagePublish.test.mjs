// Release-only qualification: requires the preserved local verification records.
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {createHash} from 'node:crypto';
import {PLAN,OUTPUTS,PUBLICATION_OUTPUTS,ROUTES,assertPlan,BoundedTransport,
  verifyArtifact,verifyEntity,buildPublishEntity,interpretPreflight,preflight,
  PreparationWriter,assertSnapshot,jsonBytes,verifyReadbackMetadata,publicationOutcome} from '../../scripts/publish-verified-tarball.mjs';
import {installNoWriteGuard,sha} from '../../scripts/package-verifier-core.mjs';

const suiteGuard=installNoWriteGuard();
after(()=>{try{assert.deepEqual(suiteGuard.attempts,[]);}finally{suiteGuard.restore();}});
const artifact=fs.readFileSync(new URL('../../.release-work/package-2026-11-18-reverify-r02/artifact/verified-0.1.46.tgz',import.meta.url));
const manifest=JSON.parse(fs.readFileSync(new URL('../../package.json',import.meta.url)));
const good=await buildPublishEntity(artifact,manifest);
const token='synthetic-token-never-a-credential';
function fake({body=Buffer.from('{}'),status=200,headers={},rawHeaders=[],chunks,hang=false,error=false,
  socketEvents=[],responseError,complete=true,nowChange}={}){
  const calls=[];
  function request(url,options,callback){
    const req=new EventEmitter();req.destroy=()=>{req.destroyed=true;};
    const row={url:String(url),options,req};calls.push(row);
    req.end=entity=>{
      row.entity=entity;
      queueMicrotask(()=>{
        if(socketEvents.length){
          const socket=new EventEmitter();socket.authorized=socketEvents.includes('secureConnect');
          req.emit('socket',socket);
          for(const event of socketEvents){
            if(event==='lookup')socket.emit(event,null,'192.0.2.1');
            else if(event!=='assigned')socket.emit(event);
          }
        }
        if(error){req.emit('error',error===true?Error('secret must never escape'):error);return;}
        if(hang)return;
        const res=new EventEmitter();Object.assign(res,{statusCode:status,headers,rawHeaders,complete,statusMessage:'OK'});
        res.destroy=()=>{res.destroyed=true;};row.res=res;callback(res);
        if(res.destroyed)return;
        for(const chunk of chunks??[body]){res.emit('data',chunk);if(res.destroyed)return;}
        if(responseError){res.emit('error',responseError);return;}
        nowChange?.();res.emit('end');res.emit('close');
      });
    };
    return req;
  }
  return {request,calls};
}
function memoryDisk(){
  const rows=[],files=new Map(),roots=new Set();
  return {rows,files,lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false}),
    mkdirSync(p){if(roots.has(p)){const e=Error();e.code='EEXIST';throw e;}roots.add(p);},
    openSync(p,flags){rows.push(['open',p]);assert.ok(flags&fs.constants.O_EXCL);assert.ok(flags&fs.constants.O_NOFOLLOW);
      if(files.has(p))throw Error('exists');files.set(p,Buffer.alloc(0));return p;},
    writeSync(fd,b,at,n){rows.push(['write',fd,n]);files.set(fd,Buffer.concat([files.get(fd),b.subarray(at,at+n)]));return n;},
    fsyncSync(){},closeSync(){}};
}
const response=(value,status=200)=>({bytes:jsonBytes(value),status});

test('full 512 KiB reservation, both IDs and cumulative campaign equation are fixed',()=>{
  assertPlan();assert.equal(Object.values(OUTPUTS).reduce((a,b)=>a+b),384*1024);
  assert.equal(Object.values(PUBLICATION_OUTPUTS).reduce((a,b)=>a+b),128*1024);
  assert.equal(PLAN.cumulative,49605618);assert.equal(PLAN.remainingBPool,31505225);
  assert.notEqual(PLAN.preparation,PLAN.publication);assert.equal(PLAN.protected765Used,0);
});
test('verified artifact identity has exact length, SHA-256 and SHA-512',()=>{
  assert.equal(verifyArtifact(artifact).bytes,846950);
  assert.equal(verifyArtifact(artifact).integrity,'sha512-'+createHash('sha512').update(artifact).digest('base64'));
  assert.throws(()=>verifyArtifact(artifact.subarray(1)),/artifact_identity/);
  const bad=Buffer.from(artifact);bad[0]^=1;assert.throws(()=>verifyArtifact(bad),/artifact_identity/);
});
test('actual pinned libnpmpublish builder emits one intercepted PUT with identical bytes',()=>{
  assert.equal(good.interceptedRequests,1);assert.equal(good.proof.attachment.sha256,PLAN.artifactSha256);
  assert.equal(good.proof.sha256,sha(good.body));assert.ok(good.body.length<PLAN.entityMax);
  assert.ok(good.loaded_modules.count>100);assert.equal(good.loaded_modules.all_bound_to_B_inventory,true);
});
test('publication builder requires the fixed package name and version',async()=>{
  await assert.rejects(buildPublishEntity(artifact,{...manifest,version:'0.1.47'}),/manifest_target/);
  await assert.rejects(buildPublishEntity(artifact,{...manifest,tag:'next'}),/manifest_target/);
});
test('decoded attachment mutations, lengths, extra attachments and manifest drift reject',()=>{
  const base=JSON.parse(good.body),name=Object.keys(base._attachments)[0];
  for(const mutate of [m=>m._attachments[name].length--,m=>m._attachments[name].data+=' ',
    m=>m._attachments.other=m._attachments[name],m=>m.versions[PLAN.version].files=[],
    m=>m['dist-tags'].latest='0.1.47',m=>m.versions[PLAN.version].dist.integrity='sha512-invalid']){
    const m=structuredClone(base);mutate(m);assert.throws(()=>verifyEntity(jsonBytes(m),artifact,manifest));
  }
});
test('entity output limit is checked before parse',()=>{
  assert.throws(()=>verifyEntity(Buffer.alloc(PLAN.entityMax+1),artifact,manifest),/entity_limit/);
});
test('raw HTTPS dispatch uses fixed origin, identity encoding, no agent and header limit',async()=>{
  const f=fake();const t=new BoundedTransport({request:f.request});await t.get('account',token);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,PLAN.registry.slice(0,-1)+ROUTES.account);
  assert.equal(f.calls[0].options.agent,false);assert.equal(f.calls[0].options.maxHeaderSize,16*1024);
  assert.equal(f.calls[0].options.headers['accept-encoding'],'identity');assert.equal(t.dispatches,1);
});
test('GET body exactly at 64 KiB succeeds; next byte rejects without a second dispatch',async()=>{
  const exact=fake({body:Buffer.alloc(PLAN.bodyMax)});await new BoundedTransport({request:exact.request}).get('account',token);
  const over=fake({chunks:[Buffer.alloc(PLAN.bodyMax),Buffer.alloc(1)]});const t=new BoundedTransport({request:over.request});
  await assert.rejects(t.get('account',token),/response_body_limit/);assert.equal(over.calls.length,1);
  assert.ok(over.calls[0].req.destroyed);await assert.rejects(t.get('rights',token),/transport_stopped/);
});
test('declared oversized, invalid and mismatched response sizes reject',async()=>{
  for(const declared of [String(PLAN.bodyMax+1),'-1','1x','01']){
    const f=fake({headers:{'content-length':declared}});
    await assert.rejects(new BoundedTransport({request:f.request}).get('account',token),/response_body_limit/);
  }
  const f=fake({headers:{'content-length':'3'},body:Buffer.from('{}')});
  await assert.rejects(new BoundedTransport({request:f.request}).get('account',token),/response_length/);
});
test('header overflow and unsupported content compression reject before data retention',async()=>{
  for(const options of [{rawHeaders:['x', 'a'.repeat(PLAN.headerMax)]},{headers:{'content-encoding':'gzip'}}]){
    const f=fake(options);const t=new BoundedTransport({request:f.request});
    await assert.rejects(t.get('account',token),/response_(?:header_limit|encoding)/);assert.equal(t.dispatches,1);
  }
});
test('response header byte boundary accepts 16 KiB and rejects one additional byte',async()=>{
  const base=Buffer.byteLength('HTTP/1.1 200 OK\r\n\r\nx: \r\n');
  const f=fake({rawHeaders:['x','a'.repeat(PLAN.headerMax-base)]});
  await new BoundedTransport({request:f.request}).get('account',token);
  const over=fake({rawHeaders:['x','a'.repeat(PLAN.headerMax-base+1)]});
  await assert.rejects(new BoundedTransport({request:over.request}).get('account',token),/response_header_limit/);
});
test('redirect, authentication, OTP, rate limit and server errors never trigger retries',async()=>{
  for(const status of [301,302,307,308,401,403,429,500,503]){
    const f=fake({status,headers:{location:'https://evil.invalid/','npm-otp':'required'}}),t=new BoundedTransport({request:f.request});
    await assert.rejects(t.get('account',token),/unexpected_http_status/);assert.equal(f.calls.length,1);
    await assert.rejects(t.get('account',token),/transport_stopped/);
  }
});
test('native request errors are sanitized and cannot refresh credentials or resend',async()=>{
  const f=fake({error:true}),t=new BoundedTransport({request:f.request});
  await assert.rejects(t.get('account',token),e=>{
    assert.equal(e.message,'request_error');assert.ok(!JSON.stringify(e).includes(token));return true;
  });assert.equal(f.calls.length,1);
});

function registerNetworkDiagnosticTests(test, assert, {transport, preflight, fake}) {
  const secret = 'do-not-store-synthetic-auth-value';
  const token = 'synthetic-token-never-a-credential';
  const makeError = (code, syscall, cause) => Object.assign(Error(secret), {code, syscall, cause});

  test('DNS diagnostics keep the allowlisted code and never claim a connection', async () => {
    const failure = makeError('ENOTFOUND', 'getaddrinfo');
    failure.headers = {authorization: 'Bearer '+secret};
    failure.stack = secret;
    const f = fake({error:failure, socketEvents:['assigned']});
    const t = new transport({request:f.request});
    const records = [];
    await assert.rejects(preflight(t, token, (slot, value) => records.push([slot,value])), /request_error/);
    assert.equal(records.length, 1);
    const {network} = records[0][1];
    assert.equal(network.error.root.code, 'ENOTFOUND');
    assert.equal(network.error.root.syscall, 'getaddrinfo');
    assert.equal(network.observed.socket, true);
    for (const stage of ['dns_resolved','tcp_connected','tls_authorized','http_response']) assert.equal(network.observed[stage], false);
    assert.equal(network.status, null);
    assert.equal(network.dispatches, 1);
    assert.ok(!JSON.stringify(network).includes(secret));
    await assert.rejects(t.get('rights', token), /transport_stopped/);
    assert.equal(f.calls.length, 1);
  });

  test('error detail bounds causes, removes unknown values, and ignores accessors', async () => {
    const third = makeError('EAI_AGAIN', 'getaddrinfo');
    const outer = makeError(secret.repeat(600), secret, makeError('ECONNRESET', 'read', makeError('ETIMEDOUT', 'connect', third)));
    let access = 0;
    Object.defineProperty(outer, 'syscall', {get() { access++; return secret; }});
    const f = fake({error:outer});
    await assert.rejects(new transport({request:f.request}).get('account',token), error => {
      const detail = error.safe.error;
      assert.equal(detail.root.code, 'OTHER');
      assert.equal(detail.root.syscall, null);
      assert.equal(detail.causes.length, 2);
      assert.equal(detail.causes[0].code, 'ECONNRESET');
      assert.equal(detail.causes[1].code, 'ETIMEDOUT');
      assert.equal(detail.cause_truncated, true);
      const saved = JSON.stringify(error.safe);
      assert.ok(Buffer.byteLength(saved) <= 512);
      assert.ok(!saved.includes(secret));
      return true;
    });
    assert.equal(access, 0);
  });

  test('cyclic cause chains stop without retaining raw error objects', async () => {
    const outer = makeError('ECONNRESET', 'read');
    outer.cause = makeError('EPIPE', 'write', outer);
    const f = fake({error:outer});
    await assert.rejects(new transport({request:f.request}).get('account',token), error => {
      assert.equal(error.safe.error.causes.length, 1);
      assert.equal(error.safe.error.cause_truncated, true);
      assert.ok(!JSON.stringify(error).includes(secret));
      return true;
    });
  });

  test('transport diagnostics distinguish TCP, TLS validation, and HTTP response receipt', async () => {
    for (const [events, flags] of [
      [['lookup'],[true,false,false,false]],
      [['lookup','connect'],[true,true,false,false]],
      [['lookup','connect','secureConnect'],[true,true,true,true]],
    ]) {
      const err = makeError('ECONNRESET','read');
      const f=fake({socketEvents:events,error:flags[3]?false:err,responseError:flags[3]?err:undefined});
      await assert.rejects(new transport({request:f.request}).get('account',token), error => {
        const observed=error.safe.observed;
        assert.deepEqual([observed.dns_resolved,observed.tcp_connected,observed.tls_authorized,observed.http_response],flags);
        assert.equal(error.safe.status,flags[3]?200:null);
        return true;
      });
    }
  });

  test('preflight parsing failures record a fixed reason without recording response text', async () => {
    const f=fake({body:Buffer.from('invalid-json '+secret)}),t=new transport({request:f.request});
    const records=[];
    await assert.rejects(preflight(t,token,(_slot,value)=>records.push(value)),/preflight_failed/);
    assert.equal(records[0].reason,'preflight_failed');
    assert.ok(!JSON.stringify(records).includes(secret));
    assert.equal(f.calls.length,1);
  });
}

registerNetworkDiagnosticTests(test, assert, {transport:BoundedTransport, preflight, fake});

test('absolute request timer includes connect and hangs, and destroys once without retry',async()=>{
  let fire,delay;const f=fake({hang:true}),t=new BoundedTransport({request:f.request,
    setTimer:(cb,n)=>{fire=cb;delay=n;return 1;},clearTimer:()=>{}});
  const p=t.get('account',token);fire();await assert.rejects(p,/request_timeout/);
  assert.equal(delay,30000);assert.ok(f.calls[0].req.destroyed);assert.equal(f.calls.length,1);
});
test('late completion fails even when timer callback has not run',async()=>{
  let now=0;const f=fake({nowChange:()=>{now=30000;}}),t=new BoundedTransport({request:f.request,now:()=>now});
  await assert.rejects(t.get('account',token),/request_timeout/);
});
test('stage deadline is monotonic and request timer is shortened to remaining time',async()=>{
  let now=0,delay;const f=fake(),t=new BoundedTransport({request:f.request,now:()=>now,
    setTimer:(cb,n)=>{delay=n;return 1;},clearTimer:()=>{}});
  await t.get('account',token);now=179999;await t.get('rights',token);assert.equal(delay,1);
  now=180000;await assert.rejects(t.get('version',token),/stage_timeout/);assert.equal(f.calls.length,2);
});
test('request order, reused slots and extra requests reject before native dispatch',async()=>{
  const f=fake(),t=new BoundedTransport({request:f.request});
  await assert.rejects(t.get('rights',token),/request_order_or_reuse/);assert.equal(f.calls.length,0);
  await t.get('account',token);await assert.rejects(t.get('account',token),/request_order_or_reuse/);
  for(const slot of ['rights','version','tag'])await t.get(slot,token);
  await assert.rejects(t.get('tarball',token),/request_order_or_reuse/);assert.equal(f.calls.length,4);
});
test('preparation cannot PUT even if a caller asks for publication',async()=>{
  const f=fake(),t=new BoundedTransport({stage:'publish',request:f.request});
  for(const slot of ['account','rights','version','tag'])await t.get(slot,token);
  await assert.rejects(t.exchange('publish',{token,body:good.body,artifact,manifest}),/publication_not_authorized/);
  assert.equal(f.calls.length,4);
});
test('synthetic authorized PUT supplies exact verified HTTP entity bytes only once',async()=>{
  const f=fake(),t=new BoundedTransport({stage:'publish',permitPut:true,request:f.request});
  for(const slot of ['account','rights','version','tag'])await t.get(slot,token);
  const r=await t.exchange('publish',{token,body:good.body,artifact,manifest});
  assert.equal(f.calls.length,5);assert.equal(f.calls[4].options.method,'PUT');
  assert.ok(f.calls[4].entity.equals(good.body));assert.equal(r.entity.sha256,sha(good.body));
  await assert.rejects(t.exchange('publish',{token,body:good.body,artifact,manifest}),/request_order_or_reuse/);
});
test('synthetic PUT timeout is unknown, not unsent; all remaining readback is stopped',async()=>{
  const f=fake();let fire;
  const t=new BoundedTransport({stage:'publish',permitPut:true,request:f.request,setTimer:cb=>{fire=cb;return 1;},clearTimer:()=>{}});
  for(const slot of ['account','rights','version','tag'])await t.get(slot,token);
  const hang=fake({hang:true});t.request=hang.request;
  const p=t.exchange('publish',{token,body:good.body,artifact,manifest});fire();
  await assert.rejects(p,e=>{assert.equal(e.safe.outcome,'unknown');return true;});
  await assert.rejects(t.get('readback-version',token),/transport_stopped/);assert.equal(hang.calls.length,1);
});
test('PUT request timeout is 60 seconds and publication stage ends at 300 seconds',async()=>{
  let now=0,delay;const f=fake(),t=new BoundedTransport({stage:'publish',permitPut:true,request:f.request,now:()=>now,
    setTimer:(cb,n)=>{delay=n;return 1;},clearTimer:()=>{}});
  for(const slot of ['account','rights','version','tag'])await t.get(slot,token);
  await t.exchange('publish',{token,body:good.body,artifact,manifest});assert.equal(delay,60000);
  now=299999;await t.get('readback-version',token);assert.equal(delay,1);
  now=300000;await assert.rejects(t.get('readback-tag',token),/stage_timeout/);
  assert.equal(f.calls.length,6);
});
test('tarball readback is bounded and requires exact verified artifact identity',async()=>{
  for(const body of [artifact,Buffer.alloc(PLAN.tarballMax+1),Buffer.from('wrong')]){
    const t=new BoundedTransport({stage:'publish',permitPut:true,request:fake().request});
    for(const slot of ['account','rights','version','tag'])await t.get(slot,token);
    await t.exchange('publish',{token,body:good.body,artifact,manifest});
    await t.get('readback-version',token);await t.get('readback-tag',token);
    const f=fake({body});t.request=f.request;
    if(body===artifact)assert.equal((await t.get('tarball',token)).body_sha256,PLAN.artifactSha256);
    else await assert.rejects(t.get('tarball',token),/response_body_limit|readback_artifact_identity/);
    assert.equal(f.calls.length,1);
  }
});
test('account and rights checks do not infer publication authority from mere authentication',()=>{
  assert.deepEqual(interpretPreflight('account',response({username:'owner'})),{username:'owner'});
  const prior={account:{username:'owner'}};
  assert.deepEqual(interpretPreflight('rights',response({owner:'read-write'}),prior),{username:'owner',permission:'read-write'});
  for(const rights of [{owner:'read-only'},{different:'read-write'},{}])
    assert.throws(()=>interpretPreflight('rights',response(rights),prior),/publisher_rights/);
});
test('only explicit version 404 proves available; existing target stops',()=>{
  assert.deepEqual(interpretPreflight('version',response({error:'version not found'},404)),{version:PLAN.version,exists:false});
  assert.throws(()=>interpretPreflight('version',response({version:PLAN.version})),/version_already_exists_or_unproven/);
  assert.throws(()=>interpretPreflight('version',response({},404)),/version_already_exists_or_unproven/);
});
test('tag result is separately fixed for later approval and target tag does not pass',()=>{
  assert.deepEqual(interpretPreflight('tag',response({latest:'0.1.45'})),{latest:'0.1.45'});
  assert.throws(()=>interpretPreflight('tag',response({latest:'0.1.46'})),/tag_already_target/);
});
test('preflight processes four bounded GETs, saves summaries rather than raw bodies',async()=>{
  const samples=[{username:'owner'},{owner:'read-write'},{error:'not found'},{latest:'0.1.45'}];
  let count=0;const records=[];
  const t={async get(slot){const bytes=jsonBytes(samples[count]);return {bytes,status:count++===2?404:200,
    body_bytes:bytes.length,body_sha256:sha(bytes),header_bytes:12,elapsed_ms:1,dispatches:count};}};
  const r=await preflight(t,token,(slot,value)=>records.push({slot,value}));
  assert.equal(count,4);assert.equal(records.length,4);assert.equal(r.tag.latest,'0.1.45');
  assert.ok(!JSON.stringify(records).includes(token));
});
test('preflight anomalous second response stops globally and preserves prior record',async()=>{
  let calls=0;const records=[];
  const t={async get(){calls++;return {bytes:jsonBytes(calls===1?{username:'owner'}:{}),status:200};}};
  await assert.rejects(preflight(t,token,(slot,r)=>records.push([slot,r])),/publisher_rights/);
  assert.equal(calls,2);assert.equal(records.length,2);assert.equal(records[0][1].status,'confirmed');
  assert.equal(records[1][1].status,'stopped');assert.equal(t.stopped,true);
});
test('snapshot changes between tests or before networking reject',()=>{
  const a={hash:'first'};assertSnapshot(a,structuredClone(a));assert.throws(()=>assertSnapshot(a,{hash:'second'}),/publication_inputs_changed/);
});
test('writer refuses traversal, unknown output, slot reuse and oversized records before opening',()=>{
  const disk=memoryDisk();const w=Object.create(PreparationWriter.prototype);
  Object.assign(w,{repo:'/synthetic/repo',root:'/synthetic/repo/prep',disk,files:[],used:new Set()});
  for(const name of ['../escape','unknown','approval-publication.json'])assert.throws(()=>w.write(name,{}),/output_name_or_reuse/);
  assert.throws(()=>w.write('tests.json',Buffer.alloc(OUTPUTS['tests.json']+1)),/output_limit/);
  w.used.add('tests.json');assert.throws(()=>w.write('tests.json',{}),/output_name_or_reuse/);assert.equal(disk.rows.length,0);
});
test('existing preparation directory consumes the ID even if empty, without writing',()=>{
  const disk=memoryDisk();disk.mkdirSync('/synthetic/repo/.release-work/'+PLAN.preparation);
  assert.throws(()=>new PreparationWriter('/synthetic/repo',{disk}),/preparation_id_consumed/);
  assert.equal(disk.rows.length,0);
});
test('reservation is the first durable output and exact output boundary roundtrips in memory',()=>{
  const disk=memoryDisk(),w=new PreparationWriter('/synthetic/repo',{disk,read:p=>disk.files.get(p)});
  assert.equal(w.files[0].slot,'reservation.json');
  const reservation=JSON.parse(disk.files.get(w.root+'/reservation.json'));
  assert.equal(reservation.added_reserved,512*1024);assert.equal(reservation.publication_authorized,false);
  w.write('tests.json',Buffer.alloc(OUTPUTS['tests.json']));assert.equal(w.readback().verified,true);
  assert.throws(()=>w.write('tests.json',{}),/output_name_or_reuse/);
  disk.files.set(w.root+'/tests.json',Buffer.from('tampered'));
  assert.throws(()=>w.readback(),/saved_record_changed/);
});
test('symlinked preparation parent is rejected before exclusive ID creation',()=>{
  const disk=memoryDisk();disk.lstatSync=()=>({isDirectory:()=>true,isSymbolicLink:()=>true});
  assert.throws(()=>new PreparationWriter('/synthetic/repo',{disk}),/preparation_parent_shape/);
  assert.equal(disk.rows.length,0);
});
test('filesystem tripwire refuses an outside write before IO',()=>{
  const guard=installNoWriteGuard();try{
    assert.throws(()=>fs.writeFileSync('/not-an-authorized-output',Buffer.from('canary')),/unmanaged_write/);
    assert.equal(guard.attempts.length,1);
  }finally{guard.restore();}
});
test('publisher builder performs no filesystem writes under the actual guard',async()=>{
  const guard=installNoWriteGuard();try{await buildPublishEntity(artifact,manifest);assert.deepEqual(guard.attempts,[]);}finally{guard.restore();}
});
test('both package scopes retain shared kernel dependencies and exclude all six experimental modules',()=>{
  assert.equal(manifest.files.length,225);
  for(const n of ['Kernel','Semantic','StreamCore'])assert.ok(manifest.files.includes('build/internal/nativeBarCommitted'+n+'.js'));
  for(const n of ['Pages','PagedConnection','Streaming','SummaryArena'])assert.ok(!manifest.files.includes('build/internal/nativeBarCommitted'+n+'.js'));
  for(const n of ['smaCrossMeasurement','smaCrossDataAdapter'])assert.ok(!manifest.files.includes('build/'+n+'.js'));
});
test('registered metadata is checked independently against attachment integrity and fixed HTTPS readback route',()=>{
  const m=JSON.parse(good.body).versions[PLAN.version];
  assert.equal(verifyReadbackMetadata(jsonBytes(m),artifact,manifest).version,PLAN.version);
  for(const mutate of [m=>m.dist.integrity='invalid',m=>m.version='0.1.47',
    m=>m.dist.tarball='https://evil.invalid/file.tgz',m=>m.dist.tarball+='?redirect=1',m=>m.files=[]]){
    const bad=structuredClone(m);mutate(bad);assert.throws(()=>verifyReadbackMetadata(jsonBytes(bad),artifact,manifest));
  }
});
test('publication outcome retains accepted status on readback failure and never equates timeout with unsent',()=>{
  assert.equal(publicationOutcome(), 'not_sent');
  assert.equal(publicationOutcome({sent:true}), 'unknown');
  assert.equal(publicationOutcome({sent:true,accepted:true}), 'accepted_readback_unconfirmed');
  assert.equal(publicationOutcome({sent:true,accepted:true,readbackConfirmed:true}), 'accepted_readback_confirmed');
});
