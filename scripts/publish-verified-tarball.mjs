import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {sha,invariant,installNoWriteGuard} from './package-verifier-core.mjs';
import {readRegular,captureApprovedInputs,verifyPriorRecords} from './package-approval.mjs';

const K=1024;
export const PLAN=Object.freeze({
  schema:'verified-tarball-publication-preparation-v1',version:'0.1.46',
  name:'bushido-tradingview-mcp',registry:'https://registry.npmjs.org/',tag:'latest',
  preparation:'package-2026-11-18-publish-0.1.46-prep01',
  publication:'package-2026-11-18-publish-0.1.46-01',
  artifactBytes:846950,artifactSha256:'241353c28201dfaffee179763c8500036aa2f7f821d9cfdf0090c6cb2ab573aa',
  resultSha256:'9007f4826b10467c8ce8cbf3f6900c6dadc119dcd11a4bf9587ee0b9d66c5fdd',
  approvedInputSha256:'7fded8faed96e298357803aae6f76d4fa9b09eb03b321077818391a2d846dcb5',
  priorReserved:49081330,reservation:512*K,cumulative:49605618,
  campaignCap:88080384,margin:6291456,unallocated:678085,remainingBPool:31505225,
  protected765Used:0,preparationLimit:384*K,publicationLimit:128*K,
  getMs:30000,putMs:60000,preparationMs:180000,publicationMs:300000,
  bodyMax:64*K,tarballMax:1024*K,headerMax:16*K,entityMax:2*1024*K,
  requests:12,gets:11,puts:1
});
export const OUTPUTS=Object.freeze({
  'reservation.json':8*K,'approval-preparation.json':8*K,'inputs.json':112*K,
  'tests.json':64*K,'commit-scope.json':32*K,'verification-summary.json':16*K,
  'git-summary':16*K,'preflight-account.json':16*K,'preflight-rights.json':16*K,
  'preflight-version.json':16*K,'preflight-tag.json':16*K,'status.json':64*K
});
export const PUBLICATION_OUTPUTS=Object.freeze({
  'preflight-account.json':8*K,'preflight-rights.json':8*K,'preflight-version.json':8*K,'preflight-tag.json':8*K,
  'send-intent.json':4*K,'send-result.json':4*K,
  'readback-version.json':8*K,'readback-tag.json':8*K,'readback-tarball.json':8*K,'status.json':64*K
});
export const COMMIT_BASE=Object.freeze([
  '.gitignore','package-lock.json','package.json',
  'docs/NATIVE_BAR_COMMITTED_TRANSACTIONS_STAGE1.md',
  'docs/NATIVE_BAR_COMMITTED_PAGED_CONNECTION_STAGE_A.md','docs/NATIVE_BAR_COMMITTED_PAGING_STAGE_A.md',
  'docs/SMA_CROSS_DATA_ADAPTER.md','docs/SMA_CROSS_MEASUREMENT.md',
  'packaging/PACKAGE_VERIFICATION.md','packaging/npm-js-0.1.46.json',
  'scripts/package-approval.mjs','scripts/package-verifier-core.mjs','scripts/prepare-package-reverify.mjs','scripts/verify-package.mjs',
  'src/nativeBarCommittedTransactions.ts','src/internal/nativeBarCommittedKernel.ts',
  'src/internal/nativeBarCommittedPagedConnection.ts','src/internal/nativeBarCommittedPages.ts',
  'src/internal/nativeBarCommittedSemantic.ts','src/internal/nativeBarCommittedStreamCore.ts',
  'src/internal/nativeBarCommittedStreaming.ts','src/internal/nativeBarCommittedSummaryArena.ts',
  'src/smaCrossDataAdapter.ts','src/smaCrossMeasurement.ts',
  'test/unit/nativeBarCommittedTransactions.test.mjs','test/unit/nativeBarReadBoundary.test.mjs',
  'test/fixtures/committed-v3-connection-golden.json',
  'test/fixtures/sma-cross-measurement-v2.json','test/helpers/committedConnectionFixture.mjs',
  'test/helpers/committedPagingFixture.mjs','test/helpers/committedPagingMutationHarness.mjs','test/helpers/committedPagingSizing.mjs',
  'test/unit/nativeBarCommittedConnectionMutations.test.mjs','test/unit/nativeBarCommittedPagedConnection.test.mjs',
  'test/unit/nativeBarCommittedPages.test.mjs','test/unit/nativeBarCommittedPagingMutations.test.mjs',
  'test/unit/nativeBarCommittedStreaming.test.mjs','test/unit/nativeBarCommittedStreamingMutations.test.mjs',
  'test/unit/packageApproval.test.mjs','test/unit/packageDistribution.test.mjs',
  'test/unit/smaCrossDataAdapter.test.mjs','test/unit/smaCrossMeasurement.test.mjs'
].sort());
export function assertPlan(){
  invariant(Object.values(OUTPUTS).reduce((a,b)=>a+b,0)===PLAN.preparationLimit,'preparation_partition');
  invariant(Object.values(PUBLICATION_OUTPUTS).reduce((a,b)=>a+b,0)===PLAN.publicationLimit,'publication_partition');
  invariant(PLAN.preparationLimit+PLAN.publicationLimit===PLAN.reservation,'reservation_partition');
  invariant(PLAN.priorReserved+PLAN.reservation===PLAN.cumulative,'cumulative');
  invariant(PLAN.cumulative+PLAN.margin+PLAN.unallocated+PLAN.remainingBPool===PLAN.campaignCap,'campaign');
  invariant(PLAN.protected765Used===0&&PLAN.gets+PLAN.puts===PLAN.requests,'protected_or_requests');
  invariant(COMMIT_BASE.length===42&&new Set(COMMIT_BASE).size===42,'commit_base');
}
const npmRoot=()=>path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm');
export const jsonBytes=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const parse=b=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));
export function verifyArtifact(b){
  invariant(Buffer.isBuffer(b)&&b.length===PLAN.artifactBytes&&sha(b)===PLAN.artifactSha256,'artifact_identity');
  return {bytes:b.length,sha256:sha(b),integrity:'sha512-'+createHash('sha512').update(b).digest('base64')};
}
export function verifyEntity(body,artifact,manifest){
  verifyArtifact(artifact);
  invariant(Buffer.isBuffer(body)&&body.length<=PLAN.entityMax,'entity_limit');
  const m=parse(body),v=m.versions?.[PLAN.version],names=Object.keys(m._attachments??{}),n=PLAN.name+'-'+PLAN.version+'.tgz';
  invariant(m.name===PLAN.name&&m._id===PLAN.name&&m.access==='public'&&m['dist-tags']?.[PLAN.tag]===PLAN.version,'entity_target');
  invariant(Object.keys(m.versions??{}).length===1&&v?.name===PLAN.name&&v.version===PLAN.version,'entity_version');
  invariant(names.length===1&&names[0]===n,'entity_attachments');
  const a=m._attachments[n];
  invariant(a.content_type==='application/octet-stream'&&a.length===artifact.length&&typeof a.data==='string','attachment_shape');
  const decoded=Buffer.from(a.data,'base64');
  invariant(decoded.toString('base64')===a.data&&decoded.equals(artifact),'attachment_identity');
  invariant(v.dist?.integrity===verifyArtifact(artifact).integrity&&
    v.dist?.shasum===createHash('sha1').update(artifact).digest('hex'),'attachment_integrity');
  for(const key of ['files','main','bin','scripts','dependencies','engines'])
    invariant(JSON.stringify(v[key])===JSON.stringify(manifest[key]),'entity_manifest');
  return {bytes:body.length,sha256:sha(body),attachment:verifyArtifact(decoded)};
}

// Exercise the pinned npm metadata builder, replacing its transport BEFORE load.
// Neither npm-registry-fetch nor pacote executes; no lifecycle/cache/provenance IO.
// Real sends, if separately approved later, must use the bounded single-dispatch
// transport below. npm's retry/authentication layers are never on that path.
export async function buildPublishEntity(artifact,manifest){
  verifyArtifact(artifact);
  invariant(manifest.name===PLAN.name&&manifest.version===PLAN.version&&!manifest.private&&!manifest.tag,'manifest_target');
  const require=createRequire(path.join(npmRoot(),'package.json'));
  const publishPath=require.resolve('libnpmpublish/lib/publish.js'),fetchPath=require.resolve('npm-registry-fetch');
  const savedPublish=require.cache[publishPath],savedFetch=require.cache[fetchPath];
  let captured=null,calls=0;
  const intercept=async(route,opts)=>{
    calls++;
    invariant(calls===1&&route===PLAN.name&&opts.method==='PUT'&&opts.provenance===false&&
      opts.stage===false&&opts.retry.retries===0&&opts.fetchRetries===0&&opts.redirect==='manual','builder_transport');
    captured=Buffer.from(JSON.stringify(opts.body));return {status:200};
  };
  intercept.pickRegistry=()=>PLAN.registry;
  try{
    require.cache[fetchPath]={id:fetchPath,filename:fetchPath,loaded:true,exports:intercept};
    delete require.cache[publishPath];
    const publish=require(publishPath);
    await publish(structuredClone(manifest),Buffer.from(artifact),{
      registry:PLAN.registry,access:'public',defaultTag:PLAN.tag,npmVersion:'11.16.0',
      provenance:false,provenanceFile:undefined,stage:false,retry:{retries:0},fetchRetries:0,
      redirect:'manual',timeout:PLAN.putMs,ignoreScripts:true,cache:false
    });
    invariant(calls===1&&captured,'builder_call_count');
    const approved=parse(readRegular(path.resolve('.release-work',
      'package-2026-11-18-reverify-r02-prep02/input-manifest.json'),448*K));
    const npmGroup=approved.groups.find(g=>g.name==='npm');
    invariant(path.resolve(npmGroup.root)===npmRoot(),'publisher_npm_root');
    const allowed=new Map(npmGroup.files.map(([p,n,h])=>[path.resolve(npmGroup.root,p),{bytes:n,hash:h}]));
    const loaded=Object.keys(require.cache).sort().map(p=>{
      const want=allowed.get(p);invariant(want,'publisher_loaded_input_outside_manifest');
      const b=readRegular(p,32*1024*K);
      invariant(b.length===want.bytes&&createHash('sha256').update(b).digest('base64')===want.hash,'publisher_loaded_input_changed');
      return {path:p,bytes:b.length,sha256:sha(b)};
    });
    return {body:captured,proof:verifyEntity(captured,artifact,manifest),interceptedRequests:calls,
      loaded_modules:{count:loaded.length,sha256:sha(jsonBytes(loaded)),all_bound_to_B_inventory:true}};
  }finally{
    if(savedFetch)require.cache[fetchPath]=savedFetch;else delete require.cache[fetchPath];
    if(savedPublish)require.cache[publishPath]=savedPublish;else delete require.cache[publishPath];
  }
}

export const ROUTES=Object.freeze({
  account:'/-/whoami',rights:'/-/package/'+PLAN.name+'/collaborators',
  version:'/'+PLAN.name+'/'+PLAN.version,tag:'/-/package/'+PLAN.name+'/dist-tags',
  tarball:'/'+PLAN.name+'/-/'+PLAN.name+'-'+PLAN.version+'.tgz',publish:'/'+PLAN.name
});
const stages={prepare:['account','rights','version','tag'],
  publish:['account','rights','version','tag','publish','readback-version','readback-tag','tarball']};
// Exported for synthetic tests; runtime entrypoint only constructs stage prepare.
// No publish authorization loader/CLI is provided by this preparation change.
export class BoundedTransport{
  constructor({stage='prepare',request=https.request,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,
    permitPut=false}={}){
    invariant(Object.hasOwn(stages,stage),'transport_stage');
    this.stage=stage;this.request=request;this.now=now;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.permitPut=permitPut;this.used=[];this.started=null;this.stopped=false;this.dispatches=0;
  }
  async get(slot,token){return this.exchange(slot,{token});}
  async exchange(slot,{token,body,artifact,manifest}={}){
    invariant(!this.stopped,'transport_stopped');
    const allowed=stages[this.stage];
    invariant(allowed[this.used.length]===slot,'request_order_or_reuse');
    const isPut=slot==='publish';
    invariant(!isPut||this.permitPut,'publication_not_authorized');
    const name=slot.replace(/^readback-/,''),route=ROUTES[name];
    invariant(route&&typeof token==='string'&&/^[\x21-\x7e]+$/.test(token),'request_configuration');
    // Own a byte copy, check it immediately before passing it to native end().
    const entity=isPut?Buffer.from(body??[]):undefined;
    const entityProof=isPut?verifyEntity(entity,artifact,manifest):null;
    const t=this.now();if(this.started===null)this.started=t;
    const stageMax=this.stage==='prepare'?PLAN.preparationMs:PLAN.publicationMs;
    const remaining=stageMax-(t-this.started);
    invariant(remaining>0,'stage_timeout');
    this.used.push(slot);
    const limit=name==='tarball'?PLAN.tarballMax:PLAN.bodyMax;
    const deadline=Math.min(isPut?PLAN.putMs:PLAN.getMs,remaining);
    return new Promise((resolve,reject)=>{
      let req,res,timer,settled=false,ended=false,n=0,headersBytes=0,status=null;const chunks=[];
      const finish=(err,value)=>{
        if(settled)return;settled=true;if(timer!==undefined)this.clearTimer(timer);
        if(err){this.stopped=true;res?.destroy();req?.destroy();
          const e=Error(err);e.safe={slot,status,body_bytes:n,header_bytes:headersBytes,dispatches:this.dispatches,
            outcome:isPut?'unknown':'preflight_stopped',elapsed_ms:Math.ceil(this.now()-t)};reject(e);
        }else resolve(value);
      };
      timer=this.setTimer(()=>finish('request_timeout'),deadline);
      try{
        const headers={accept:'application/json','accept-encoding':'identity',authorization:'Bearer '+token};
        if(isPut){headers['content-type']='application/json';headers['content-length']=String(entity.length);}
        this.dispatches++;
        req=this.request(new URL(route,PLAN.registry),{
          method:isPut?'PUT':'GET',agent:false,maxHeaderSize:PLAN.headerMax,headers
        },response=>{
          res=response;status=res.statusCode;
          const rh=res.rawHeaders??[];
          headersBytes=Buffer.byteLength('HTTP/1.1 '+status+' '+(res.statusMessage??'')+'\r\n\r\n');
          for(let i=0;i<rh.length;i+=2)headersBytes+=Buffer.byteLength(rh[i]+': '+rh[i+1]+'\r\n');
          if(headersBytes>PLAN.headerMax)return finish('response_header_limit');
          if(res.headers?.['content-encoding']&&res.headers['content-encoding']!=='identity')return finish('response_encoding');
          if(!(status>=200&&status<300)&&!(slot==='version'&&status===404))return finish('unexpected_http_status');
          const declared=res.headers?.['content-length'];
          if(declared!==undefined&&(!/^(0|[1-9][0-9]*)$/.test(String(declared))||Number(declared)>limit))return finish('response_body_limit');
          res.on('data',chunk=>{
            if(settled)return;
            const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
            if(n+b.length>limit)return finish('response_body_limit');
            n+=b.length;chunks.push(b);
          });
          res.once('aborted',()=>finish('response_aborted'));
          res.once('error',()=>finish('response_error'));
          res.once('close',()=>{if(!ended)finish('response_incomplete');});
          res.once('end',()=>{
            ended=true;if(settled)return;
            if(res.complete===false)return finish('response_incomplete');
            if(this.now()-t>=deadline||this.now()-this.started>=stageMax)return finish('request_timeout');
            if(declared!==undefined&&n!==Number(declared))return finish('response_length');
            const bytes=Buffer.concat(chunks,n);
            if(name==='tarball'){
              try{verifyArtifact(bytes);}catch{return finish('readback_artifact_identity');}
            }
            finish(null,{slot,status,bytes,body_bytes:n,body_sha256:sha(bytes),header_bytes:headersBytes,
              elapsed_ms:Math.ceil(this.now()-t),dispatches:this.dispatches,entity:entityProof});
          });
        });
        req.once('error',()=>finish('request_error'));
        if(entity)invariant(sha(entity)===entityProof.sha256,'entity_changed_before_send');
        req.end(entity);
      }catch{finish('request_dispatch_error');}
    });
  }
}

export function interpretPreflight(slot,response,prior={}){
  const x=parse(response.bytes);
  if(slot==='account'){
    invariant(response.status===200&&typeof x.username==='string'&&/^[a-zA-Z0-9_.-]{1,128}$/.test(x.username),'account_response');
    return {username:x.username};
  }
  if(slot==='rights'){
    invariant(response.status===200&&x&&typeof x==='object'&&!Array.isArray(x)&&
      Object.hasOwn(x,prior.account?.username)&&x[prior.account.username]==='read-write','publisher_rights');
    return {username:prior.account.username,permission:'read-write'};
  }
  if(slot==='version'){
    invariant(response.status===404&&x&&typeof x==='object'&&typeof x.error==='string','version_already_exists_or_unproven');
    return {version:PLAN.version,exists:false};
  }
  invariant(slot==='tag'&&response.status===200&&x&&typeof x==='object'&&!Array.isArray(x)&&
    typeof x.latest==='string'&&/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(x.latest),'tag_response');
  invariant(x.latest!==PLAN.version,'tag_already_target');
  return {latest:x.latest};
}
export async function preflight(transport,token,record){
  const values={};
  for(const slot of stages.prepare){
    let response;
    try{
      response=await transport.get(slot,token);
      const value=interpretPreflight(slot,response,values);values[slot]=value;
      record(slot,{status:'confirmed',observed_at_utc:new Date().toISOString(),http_status:response.status,response_bytes:response.body_bytes,
        response_sha256:response.body_sha256,header_bytes:response.header_bytes,elapsed_ms:response.elapsed_ms,
        dispatches:response.dispatches,value});
    }catch(e){
      transport.stopped=true;
      record(slot,{status:'stopped',reason:e.message,network:e.safe??(response?{
        slot,status:response.status,body_bytes:response.body_bytes,body_sha256:response.body_sha256,
        header_bytes:response.header_bytes,dispatches:response.dispatches}:null)});throw e;
    }
  }
  return values;
}

export function verifyReadbackMetadata(bytes,artifact,manifest){
  verifyArtifact(artifact);invariant(Buffer.isBuffer(bytes)&&bytes.length<=PLAN.bodyMax,'metadata_limit');
  const m=parse(bytes);
  invariant(m.name===PLAN.name&&m.version===PLAN.version,'readback_version');
  for(const key of ['files','main','bin','scripts','dependencies','engines'])
    invariant(JSON.stringify(m[key])===JSON.stringify(manifest[key]),'readback_manifest');
  invariant(m.dist?.integrity===verifyArtifact(artifact).integrity&&
    m.dist?.shasum===createHash('sha1').update(artifact).digest('hex'),'readback_integrity');
  const u=new URL(m.dist.tarball);
  invariant(['https:','http:'].includes(u.protocol)&&u.hostname==='registry.npmjs.org'&&
    !u.port&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname===ROUTES.tarball,'readback_tarball_url');
  return {version:PLAN.version,integrity:m.dist.integrity,tarball_fetch_url:new URL(ROUTES.tarball,PLAN.registry).href};
}
export function publicationOutcome({sent=false,accepted=false,readbackConfirmed=false}={}){
  if(!sent)return 'not_sent';
  if(!accepted)return 'unknown';
  return readbackConfirmed?'accepted_readback_confirmed':'accepted_readback_unconfirmed';
}

// Fixed outputs and capacity are reserved in full, before the first evidence
// write. The exclusive root remains a permanent consumed-ID marker on failure.
const io=Object.fromEntries(['mkdirSync','openSync','writeSync','fsyncSync','closeSync','lstatSync'].map(k=>[k,fs[k].bind(fs)]));
export class PreparationWriter{
  constructor(repo,{disk=io,read=readRegular}={}){
    assertPlan();this.repo=path.resolve(repo);this.disk=disk;this.read=read;this.files=[];this.used=new Set();
    this.root=path.join(this.repo,'.release-work',PLAN.preparation);
    for(const p of [this.repo,path.join(this.repo,'.release-work')]){
      const s=disk.lstatSync(p);invariant(s.isDirectory()&&!s.isSymbolicLink(),'preparation_parent_shape');
    }
    invariant(!fs.existsSync(path.join(this.repo,'.release-work',PLAN.publication)),'publication_id_already_exists');
    try{disk.mkdirSync(this.root);}catch(e){if(e.code==='EEXIST')throw Error('preparation_id_consumed');throw e;}
    this.write('reservation.json',{
      schema:'publication-reservation-v1',preparation:PLAN.preparation,publication:PLAN.publication,
      source:'closed B execution ceiling; report preserved; no refund of old charges',
      prior_reserved:PLAN.priorReserved,added_reserved:PLAN.reservation,cumulative_reserved:PLAN.cumulative,
      remaining_b_pool:PLAN.remainingBPool,fixed_margin:PLAN.margin,unallocated:PLAN.unallocated,
      campaign_cap:PLAN.campaignCap,protected_765_bytes_used:0,
      outputs:OUTPUTS,publication_outputs:PUBLICATION_OUTPUTS,
      basis:'full fixed-slot reservation; cumulative file-content writes; no refunds; metadata excluded',
      publication_authorized:false,commit_authorized:false,stop_preserved:true
    });
  }
  write(name,value){
    invariant(Object.hasOwn(OUTPUTS,name)&&!this.used.has(name),'output_name_or_reuse');
    const data=Buffer.isBuffer(value)?value:jsonBytes(value);
    invariant(data.length<=OUTPUTS[name],'output_limit');this.used.add(name);
    const target=name==='git-summary'?path.join(this.repo,'releases','0.1.46','VERIFICATION.json'):path.join(this.root,name);
    if(name==='git-summary'){
      for(const p of [path.join(this.repo,'releases'),path.dirname(target)]){
        if(fs.existsSync(p)){const s=fs.lstatSync(p);invariant(s.isDirectory()&&!s.isSymbolicLink(),'output_parent_shape');}
        else this.disk.mkdirSync(p);
      }
    }
    const fd=this.disk.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    try{
      let at=0;while(at<data.length){const n=this.disk.writeSync(fd,data,at,data.length-at);invariant(n>0,'output_progress');at+=n;}
      this.disk.fsyncSync(fd);
    }finally{this.disk.closeSync(fd);}
    const row={path:path.relative(this.repo,target),slot:name,bytes:data.length,sha256:sha(data)};
    invariant(this.read(target,OUTPUTS[name]).equals(data),'output_readback');
    this.files.push(row);return row;
  }
  readback(){
    for(const f of this.files){const b=this.read(path.join(this.repo,f.path),OUTPUTS[f.slot]);invariant(b.length===f.bytes&&sha(b)===f.sha256,'saved_record_changed');}
    return {files:this.files.map(f=>({...f})),content_bytes:this.files.reduce((n,f)=>n+f.bytes,0),verified:true};
  }
}

export function readExistingToken(repo,env=process.env){
  // Deliberately no login, config rewrite, OTP prompt, credential helper or
  // refresh. Unsupported override/auth forms stop rather than guessing.
  invariant(!Object.keys(env).some(k=>/^npm_config_(?:registry|userconfig|globalconfig|otp)$/i.test(k)),'unsupported_auth_override');
  const sources=[path.resolve(path.dirname(process.execPath),'../etc/npmrc'),path.join(os.homedir(),'.npmrc'),path.join(repo,'.npmrc')];
  let token;
  for(const file of sources){
    if(!fs.existsSync(file))continue;
    const b=readRegular(file,16*K),text=new TextDecoder('utf-8',{fatal:true}).decode(b);
    for(const raw of text.split(/\r?\n/)){
      const line=raw.trim();if(!line||/^[;#]/.test(line))continue;
      const at=line.indexOf('=');invariant(at>0,'auth_config_format');
      const key=line.slice(0,at).trim(),value=line.slice(at+1).trim();
      if(key==='registry')invariant(value===PLAN.registry,'auth_registry');
      if(key==='//registry.npmjs.org/:_authToken'){
        const variable=value.match(/^\$\{([A-Za-z_][A-Za-z_0-9]*)\}$/);
        token=variable?env[variable[1]]:value;
      }else invariant(!/(?:_auth|password|username|certfile|keyfile|otp|proxy|userconfig|globalconfig)/i.test(key),'unsupported_auth_config');
    }
  }
  invariant(typeof token==='string'&&/^[\x21-\x7e]{16,4096}$/.test(token),'existing_token_unavailable');return token;
}

function originalEvidence(repo){
  verifyPriorRecords(repo);
  const root=path.join(repo,'.release-work','package-2026-11-18-reverify-r02');
  const reportBytes=readRegular(path.join(root,'report/result.json'),64*K);
  invariant(sha(reportBytes)===PLAN.resultSha256,'B_report_changed');
  const report=parse(reportBytes),artifact=readRegular(path.join(root,'artifact/verified-0.1.46.tgz'),1024*K);
  verifyArtifact(artifact);
  invariant(report.status==='passed'&&report.version===PLAN.version&&report.quota.campaign_reserved_upper===PLAN.priorReserved,'B_report_binding');
  const manifest=readRegular(path.join(repo,'.release-work','package-2026-11-18-reverify-r02-prep02','input-manifest.json'),448*K);
  invariant(sha(manifest)===PLAN.approvedInputSha256&&captureApprovedInputs(repo).sha256===PLAN.approvedInputSha256,'B_inputs_changed');
  return {report,artifact};
}
export function inputSnapshot(repo){
  const files=[...COMMIT_BASE,'scripts/publish-verified-tarball.mjs','test/release/packagePublish.test.mjs',
    'docs/MCP_CONNECTION_DIAGNOSTIC_RECORD.md','docs/MCP_READ_CAPACITY_LEDGER.md'].sort().map(p=>{
    const b=readRegular(path.join(repo,p),2*1024*K);return {path:p,bytes:b.length,sha256:sha(b)};
  });
  const original=originalEvidence(repo);
  return {files,approved_input_sha256:PLAN.approvedInputSha256,artifact:verifyArtifact(original.artifact),
    B_report_sha256:PLAN.resultSha256,node:process.version,executable:process.execPath,
    B_full_input_inventory_verified:true,plan_sha256:sha(jsonBytes(PLAN))};
}
export function assertSnapshot(a,b){invariant(JSON.stringify(a)===JSON.stringify(b),'publication_inputs_changed');}

function runTests(repo){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--test','--test-reporter=tap','test/release/packagePublish.test.mjs'],{
      cwd:repo,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_DISABLE_COMPILE_CACHE:'1'}
    });
    const parts=[];let size=0,stopped=false;
    const timer=setTimeout(()=>{stopped=true;child.kill('SIGKILL');},60000);
    const collect=b=>{if(size+b.length>48*K){stopped=true;child.kill('SIGKILL');return;}size+=b.length;parts.push(b);};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    child.once('error',()=>{clearTimeout(timer);reject(Error('test_process_error'));});
    child.once('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stopped,output:Buffer.concat(parts).toString('utf8')});});
  });
}

export async function prepare(repo){
  repo=path.resolve(repo);assertPlan();
  // Freeze inputs before consuming preparation ID and before tests.
  const before=inputSnapshot(repo);
  const writer=new PreparationWriter(repo);let guard,transport,phase='reserved',testEvidence;
  try{
    writer.write('approval-preparation.json',{
      schema:'publication-preparation-approval-v1',decision:'approved',phase:'preparation',
      preparation:PLAN.preparation,publication:PLAN.publication,plan:PLAN,
      input_sha256:sha(jsonBytes(before)),commit_authorized:false,publication_authorized:false,
      source:'user approved preparation, 512 KiB allocation, at most four GETs; no PUT or commit'
    });
    writer.write('inputs.json',before);
    guard=installNoWriteGuard();
    phase='synthetic_tests';
    const tests=await runTests(repo),afterTests=inputSnapshot(repo);assertSnapshot(before,afterTests);
    const count=Number(tests.output.match(/# tests (\d+)/)?.[1]);
    testEvidence={schema:'publication-tests-v1',...tests,passed:count,
      input_sha256_before:sha(jsonBytes(before)),input_sha256_after:sha(jsonBytes(afterTests))};
    writer.write('tests.json',testEvidence);
    invariant(tests.code===0&&!tests.stopped&&Number.isSafeInteger(count)&&count>=25&&
      /# fail 0\b/.test(tests.output)&&/# skipped 0\b/.test(tests.output),'synthetic_tests_failed');
    phase='metadata_qualification';
    const {artifact,report}=originalEvidence(repo),pkg=parse(readRegular(path.join(repo,'package.json'),64*K));
    const built=await buildPublishEntity(artifact,pkg);
    invariant(guard.attempts.length===0,'unmanaged_write_attempt');
    phase='preflight';
    assertSnapshot(before,inputSnapshot(repo));
    const token=readExistingToken(repo);
    transport=new BoundedTransport();
    const values=await preflight(transport,token,(slot,r)=>writer.write('preflight-'+slot+'.json',r));
    phase='save_summary';
    assertSnapshot(before,inputSnapshot(repo));
    const summary={schema:'release-verification-summary-v1',version:PLAN.version,name:PLAN.name,
      verification_run:report.run,report_sha256:PLAN.resultSha256,artifact:verifyArtifact(artifact),
      npm_js:225,shared_internal:3,excluded_stage_a_and_sma:6,unpacked_v3_goldens:11,
      publisher_entity:built.proof,publisher_modules:built.loaded_modules,preflight:values,preparation:PLAN.preparation,
      publisher_inputs_sha256:sha(jsonBytes(before)),tests:count,
      commit:'not authorized',publication:'not authorized',stop:'maintained',protected_765_bytes_used:0};
    writer.write('verification-summary.json',summary);
    writer.write('git-summary',summary);
    writer.write('commit-scope.json',{
      schema:'release-commit-scope-v1',base_candidate_count:42,base_paths:COMMIT_BASE,additional_paths:[
        'scripts/publish-verified-tarball.mjs','test/release/packagePublish.test.mjs','releases/0.1.46/VERIFICATION.json'],
      proposed_total:45,excluded_uncommitted:['docs/MCP_CONNECTION_DIAGNOSTIC_RECORD.md','docs/MCP_READ_CAPACITY_LEDGER.md'],
      excluded_generated:['.release-work/','build/','node_modules/'],
      git_and_npm_scopes_differ:true,commit_authorized:false,push_tag_release_authorized:false
    });
    invariant(transport.dispatches===4&&transport.used.length===4&&guard.attempts.length===0,'preparation_completion');
    phase='complete';
    writer.write('status.json',{
      schema:'publication-preparation-status-v1',status:'ready_for_review',phase,completed_at_utc:new Date().toISOString(),
      preparation:PLAN.preparation,publication:PLAN.publication,input_sha256:sha(jsonBytes(before)),
      test_results_sha256:sha(jsonBytes(testEvidence)),preflight:values,
      requests:{dispatched:transport.dispatches,GET:4,PUT:0,remaining_campaign:8,auto_retry:false},
      capacity:{reserved:PLAN.reservation,cumulative:PLAN.cumulative,cap:PLAN.campaignCap,protected_765_bytes_used:0,
        preparation_limit:PLAN.preparationLimit,publication_reserved:PLAN.publicationLimit},
      readback_before_final:writer.readback(),unmanaged_write_attempts:guard.attempts.length,
      commit_authorized:false,publication_authorized:false,publication_id_consumed:false,stop_preserved:true
    });
    return {status:'ready_for_review',root:writer.root,readback:writer.readback(),preflight:values};
  }catch(e){
    // Do not retry tests/network, invent a new ID, or claim success. Even if
    // failure-record IO fails, the root and full reservation stay consumed.
    const stop={schema:'publication-preparation-status-v1',status:'stopped',phase,reason:e.message,
      preparation:PLAN.preparation,publication:PLAN.publication,network:e.safe??null,
      requests:{dispatched:transport?.dispatches??0,PUT:0,retry:false},
      reserved:PLAN.reservation,cumulative:PLAN.cumulative,protected_765_bytes_used:0,
      readback_before_final:writer.readback(),commit_authorized:false,publication_authorized:false,
      publication_id_consumed:false,stop_preserved:true};
    if(!writer.used.has('status.json'))writer.write('status.json',stop);
    return {status:'stopped',phase,reason:e.message,root:writer.root,readback:writer.readback()};
  }finally{guard?.restore();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3||process.argv[2]!=='--prepare'){
    console.error('Only --prepare is supported. Commit and publication are not authorized.');process.exitCode=2;
  }else{
    try{const result=await prepare(process.cwd());console.log(JSON.stringify(result));if(result.status!=='ready_for_review')process.exitCode=1;}
    catch(e){console.error(JSON.stringify({status:'stopped_before_claim_or_final_io',reason:e.message}));process.exitCode=1;}
  }
}
