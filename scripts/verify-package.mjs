#!/usr/bin/env node
// Explicit local package qualification. Never starts the server or publishes.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {WriteBudget,captureVerifierInputs,assertVerifierInputsUnchanged,
  installNoWriteGuard,validateManifest,checkTsDiagnostics,
  inspectArtifact,sha,invariant,MiB,RELEASE_VERSION,DISTRIBUTION_MANIFEST} from './package-verifier-core.mjs';
import {REVERIFY_CAMPAIGN,assertCampaign,verifyPriorRecords,loadExecutionAuthorization,claimExecutionB,
  captureApprovedInputs,assertExecutionInputs,assertApprovedInputBytes,assertLoadedInputs} from './package-approval.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(new URL('../package.json',import.meta.url));
const read=(p,max=8*MiB)=>{const s=fs.lstatSync(p);invariant(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'read_shape_or_size');const b=fs.readFileSync(p);invariant(b.length===s.size&&b.length<=max,'read_changed');return b;};
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);invariant(!e.isSymbolicLink(),'source_symlink');return e.isDirectory()?walk(p):e.isFile()?[p]:[];
});}
const digestTree=dirs=>sha(dirs.flatMap(d=>walk(path.join(repo,d))).sort().map(p=>path.relative(repo,p)+' '+sha(read(p,32*MiB))).join('\n'));
// Hash the ESM verifier/test/allowlist explicitly; require.cache covers CJS only.
const verifierInputs=captureVerifierInputs(p=>read(path.join(repo,p)));
// A permits preparation only. A separate, hash-bound B receipt is mandatory.
assertCampaign();const priorRecords=verifyPriorRecords(repo);
const authorization=loadExecutionAuthorization(repo);
const {run:id,runLimit:newRunCeiling,releaseStagesReserved,fixedMargin:unusedMargin,unallocated:additionalUnallocated,campaignCap:campaignCeiling}=REVERIFY_CAMPAIGN;
const carriedHold=REVERIFY_CAMPAIGN.priorReserved+REVERIFY_CAMPAIGN.prepReserved;
const budget=new WriteBudget();budget.reserve('final',64*1024);
invariant(Object.values(budget.limits).reduce((a,b)=>a+b,0)===newRunCeiling&&
  carriedHold+newRunCeiling+releaseStagesReserved+unusedMargin+additionalUnallocated===campaignCeiling,'campaign_budget');
// Deliberately outside try/finally: a consumed approval must not create a failure
// report or any other new output under a fresh ID. No pack/build occurs here.
const writer=claimExecutionB(path.join(repo,'.release-work'),budget,authorization),root=writer.root;
let guard,phase='reservation';
const report={schema:'npm-package-verification-v1',run:id,status:'running',version:RELEASE_VERSION,
  verifier_inputs:{before:verifierInputs.record,after:null},
  approval_b:authorization,
  reservation:{run:id,approved_campaign_bytes:campaignCeiling,prior_records:priorRecords,prior_reserved:REVERIFY_CAMPAIGN.priorReserved,
    preparation:REVERIFY_CAMPAIGN.preparation,preparation_reserved:REVERIFY_CAMPAIGN.prepReserved,carried_hold:carriedHold,
    new_run_ceiling:newRunCeiling,release_stages_reserved:releaseStagesReserved,basis:'cumulative new file-content writes; no refunds',unused_margin:unusedMargin,
    additional_unallocated:additionalUnallocated,protected_765_bytes_used:0},
  checks:{},tools:{node:process.versions.node,v8:process.versions.v8,node_sha256:sha(read(process.execPath,256*MiB))}};
const json=x=>Buffer.from(JSON.stringify(x,null,2)+'\n');
const note=(event,details={})=>{const p='report/events/'+String(writer.files.length).padStart(5,'0')+'.json';writer.write('logs',p,json({event,...details}));};
try {
  writer.write('logs','report/reservation.json',json(report.reservation));
  const protectedBefore=digestTree(['src','test','docs','build']);
  const pkg=JSON.parse(read(path.join(repo,'package.json'))),manifest=JSON.parse(verifierInputs.contents.get(DISTRIBUTION_MANIFEST));
  const allowed=validateManifest(manifest,pkg,JSON.parse(read(path.join(repo,'package-lock.json'))));
  const sourceFiles=walk(path.join(repo,'src')).filter(p=>p.endsWith('.ts')&&!p.endsWith('.d.ts')).sort();
  const sourcePaths=sourceFiles.map(p=>'build/'+path.relative(path.join(repo,'src'),p).replace(/\.ts$/,'.js')).sort();
  invariant(sourcePaths.length===231&&JSON.stringify(sourcePaths.filter(p=>!manifest.excluded.includes(p)))===JSON.stringify(allowed),'source_set_changed');
  guard=installNoWriteGuard();
  // Prove that the tripwire refuses BEFORE invoking an unmanaged filesystem write.
  const probe=path.join(root,'unmanaged-probe');
  try {fs.writeFileSync(probe,'not written');throw Error('guard_did_not_refuse');}
  catch(e){invariant(e.message==='unmanaged_write:writeFileSync','guard_probe_reason');}
  invariant(!fs.existsSync(probe)&&guard.attempts.length===1,'guard_probe_wrote');guard.attempts.length=0;
  report.checks.guard_refuses_before_write=true;
  phase='snapshot';
  const snapshot=p=>{const b=read(path.join(repo,p));assertApprovedInputBytes(authorization,path.join(repo,p),b);return b;};
  for(const p of sourceFiles)writer.write('source','source/'+path.relative(repo,p),snapshot(path.relative(repo,p)));
  const fixturePaths=['test/helpers/committedConnectionFixture.mjs','test/helpers/committedPagingFixture.mjs','test/fixtures/committed-v3-connection-golden.json'];
  for(const p of ['tsconfig.json','package.json','README.md','LICENSE',...fixturePaths])writer.write('source','source/'+p,snapshot(p));
  for(const [p,bytes]of verifierInputs.contents){assertApprovedInputBytes(authorization,path.join(repo,p),bytes);writer.write('source','source/'+p,bytes);}
  report.source_snapshot=sha(writer.files.filter(f=>f.area==='source').map(f=>f.path+' '+f.sha256).join('\n'));

  const npmRoot=path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm');
  const npmRequire=createRequire(path.join(npmRoot,'package.json'));
  for(const [name,version]of [['npm','11.16.0'],['libnpmpack','9.1.9'],['pacote','21.5.0'],['npm-packlist','10.0.4']]){
    const p=name==='npm'?path.join(npmRoot,'package.json'):path.join(npmRoot,'node_modules',name,'package.json');
    const value=JSON.parse(read(p));invariant(value.version===version,'npm_version_changed:'+name);
    report.tools[name]={version:value.version,manifest_sha256:sha(read(p))};
  }
  const pack=npmRequire('libnpmpack');
  const packOptions=Object.freeze({ignoreScripts:true,dryRun:true,cache:false,offline:true,workspaces:undefined});
  report.pack_options={ignoreScripts:true,dryRun:true,cache:false,offline:true,local_directory_only:true};
  phase='npm_no_write_qualification';
  const tiny=writer.write('negative','qualification/package.json',json({name:'local-qualification',version:'0.0.0',files:['a.js'],scripts:{prepare:'MUST_NOT_RUN',prepack:'MUST_NOT_RUN',postpack:'MUST_NOT_RUN'}}));
  writer.write('negative','qualification/a.js','export const qualified=true;\n');
  const qualification=await pack(path.dirname(tiny),packOptions);
  invariant(qualification.length<=8*MiB&&guard.attempts.length===0,'npm_qualification_write');
  const qexpected=new Map(['package.json','a.js'].map(p=>{const b=read(path.join(path.dirname(tiny),p));return ['package/'+p,{bytes:b.length,sha256:sha(b)}];}));
  await inspectArtifact(qualification,qexpected);
  invariant(!walk(path.dirname(tiny)).some(p=>p.endsWith('.tgz')),'npm_auto_save');
  report.checks.npm_no_write_qualification=true;note('npm_qualified');

  phase='isolated_compile';
  const ts=require('typescript');report.tools.typescript={version:ts.version,entry_sha256:sha(read(require.resolve('typescript'),32*MiB))};
  const config=ts.readConfigFile(path.join(root,'source/tsconfig.json'),p=>read(p).toString());
  invariant(!config.error,'typescript_config');
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,path.join(root,'source'));
  const opts={...parsed.options,rootDir:path.join(root,'source/src'),outDir:path.join(root,'emit'),
    noEmitOnError:true,sourceMap:false,declaration:false,declarationMap:false,incremental:false,composite:false};
  const host=ts.createCompilerHost(opts),emitted=new Set();
  host.writeFile=(p,text)=>{
    const rel=path.relative(path.join(root,'emit'),p).replaceAll(path.sep,'/');
    invariant(!rel.startsWith('..')&&sourcePaths.includes('build/'+rel)&&!emitted.has(rel),'unexpected_emit');
    writer.write('emit','emit/'+rel,text);emitted.add(rel);
  };
  const program=ts.createProgram(parsed.fileNames,opts,host);
  checkTsDiagnostics([...parsed.errors,...ts.getPreEmitDiagnostics(program)]);
  const emission=program.emit();checkTsDiagnostics(emission.diagnostics,emission.emitSkipped);
  invariant(emitted.size===231,'emit_count');report.checks.typescript={errors:0,files:emitted.size};note('compiled');

  phase='staging';
  const expected=new Map();
  for(const p of [...allowed,'package.json','README.md','LICENSE']){
    const from=p.startsWith('build/')?path.join(root,'emit',p.slice(6)):path.join(root,'source',p);
    const b=read(from);writer.write('stage','package/'+p,b);expected.set('package/'+p,{bytes:b.length,sha256:sha(b)});
  }
  const canaries=[...manifest.excluded,'build/b3cc-validation/package-canary.js','build/unexpected-package-canary.js'];
  for(const p of canaries)writer.write('stage','package/'+p,'export const MUST_NOT_SHIP=true;\n');
  // Validate the compiled dependency graph before packaging, without importing entry points.
  let relativeEdges=0;
  for(const p of allowed){
    const text=read(path.join(root,'package',p)).toString();
    const ast=ts.createSourceFile(p,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    checkTsDiagnostics(ast.parseDiagnostics);
    const visit=n=>{
      let spec;
      if(ts.isImportDeclaration(n)||ts.isExportDeclaration(n))spec=n.moduleSpecifier;
      else if(ts.isCallExpression(n)&&(n.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(n.expression)&&n.expression.text==='require')){
        spec=n.arguments[0];invariant(spec&&ts.isStringLiteralLike(spec),'computed_module_specifier');
      }
      if(spec&&ts.isStringLiteralLike(spec)){
        if(spec.text.startsWith('.')){relativeEdges++;const target=path.posix.normalize(path.posix.join(path.posix.dirname(p),spec.text));invariant(allowed.includes(target),'dependency_outside_manifest');}
        else if(!spec.text.startsWith('node:')){const name=spec.text.startsWith('@')?spec.text.split('/').slice(0,2).join('/'):spec.text.split('/')[0];invariant(Object.hasOwn(pkg.dependencies,name),'undeclared_dependency');}
      }ts.forEachChild(n,visit);
    };visit(ast);
  }
  report.checks.graph={relativeEdges,missing:0};

  phase='pack';
  const tarball=await pack(path.join(root,'package'),packOptions);
  invariant(guard.attempts.length===0,'unmanaged_pack_write');invariant(tarball.length<=8*MiB,'compressed_limit');
  const tarPath=writer.write('tarball','artifact/verified-'+RELEASE_VERSION+'.tgz',tarball);
  const artifact=read(tarPath);invariant(sha(artifact)===sha(tarball),'saved_artifact_changed');
  const inspected=await inspectArtifact(artifact,expected);
  invariant(inspected.entries.size===228,'package_entry_count');
  for(const p of canaries)invariant(!inspected.entries.has('package/'+p),'canary_shipped');
  report.artifact={path:path.relative(root,tarPath),bytes:artifact.length,sha256:inspected.sha256,regular_files:228,JS:225};
  phase='extract';
  for(const [p,e]of inspected.entries)writer.write('extract','unpacked/'+p,inspected.raw.subarray(e.start,e.start+e.size));
  for(const [p,want]of expected)invariant(sha(read(path.join(root,'unpacked',p)))===want.sha256,'extraction_hash');
  report.checks.same_artifact=true;report.checks.canaries_excluded=canaries.length;

  phase='package_syntax';
  for(const p of allowed)await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--check',path.join(root,'unpacked/package',p)],{
      env:{PATH:path.dirname(process.execPath),TMPDIR:root,NODE_DISABLE_COMPILE_CACHE:'1'},stdio:['ignore','pipe','pipe']});
    let n=0;const chunks=[];for(const s of [child.stdout,child.stderr])s.on('data',c=>{
      n+=c.length;if(n>64*1024){child.kill();reject(Error('syntax_output_limit'));}else chunks.push(c);
    });child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('syntax_failure:'+p+':'+Buffer.concat(chunks).toString().slice(0,200))));
  });
  report.checks.syntax_files=allowed.length;
  phase='unpacked_v3';
  const entry=path.join(root,'unpacked/package/build/nativeBarCommittedTransactions.js');
  const {inspectCommittedMaintenance}=await import(pathToFileURL(entry).href);
  const {connectionFixture,addLegacyBatch,hash}=await import(pathToFileURL(path.join(root,'source/test/helpers/committedConnectionFixture.mjs')).href);
  const golden=JSON.parse(read(path.join(root,'source/test/fixtures/committed-v3-connection-golden.json')));
  const cases=[];for(const kind of ['prune','clock_recovery'])for(const state of ['intent','staged','pending','complete'])cases.push([`${kind}/${state}`,connectionFixture({kind,state})]);
  cases.push(['normal',connectionFixture({transaction:false})]);
  const early=connectionFixture();addLegacyBatch(early,{badCutoff:true});cases.push(['early-copy',early]);
  const late=connectionFixture();addLegacyBatch(late,{declared:true,collision:true});cases.push(['late-sequence',late]);
  for(const [name,f]of cases){const input=f.v3(),r=inspectCommittedMaintenance(input),g=golden.fixtures.find(g=>g.name===name);
    invariant(hash(input.map(b=>hash(Buffer.from(b))))===g.input_sha256,'golden_input:'+name);
    invariant(hash(r)===g.result_sha256&&r.work_charged===g.work_charged,'golden_result:'+name);
    for(const flag of ['execution_available','recovery_execution_available','production_qualified','host_approval_authenticated','native_bytes_verified','history_read_available'])invariant(r[flag]===false,'authority_changed');
  }
  report.checks.unpacked_v3_goldens=cases.length;
  phase='missing_shared_control';
  for(const p of [...allowed,'package.json','README.md','LICENSE'])if(p!=='build/internal/nativeBarCommittedStreamCore.js')writer.write('negative','missing-shared/'+p,read(path.join(root,'unpacked/package',p)));
  let missing=false;try{await import(pathToFileURL(path.join(root,'missing-shared/build/nativeBarCommittedTransactions.js')).href);}
  catch(e){missing=e.code==='ERR_MODULE_NOT_FOUND'&&e.message.includes('nativeBarCommittedStreamCore.js');}
  invariant(missing,'missing_shared_not_detected');report.checks.missing_shared_control=true;
  invariant(sha(read(tarPath))===inspected.sha256,'artifact_changed_before_handoff');
  invariant(digestTree(['src','test','docs','build'])===protectedBefore,'protected_tree_changed');
  invariant(guard.attempts.length===0,'unmanaged_write_detected');
  report.checks.original_tree_unchanged=true;report.checks.unmanaged_write_attempts=0;
  const loaded=Object.keys(require.cache).sort();
  assertLoadedInputs(authorization,loaded);
  report.tools.loaded_modules={count:loaded.length,sha256:sha(loaded.map(p=>p+' '+sha(read(p,32*MiB))).join('\n'))};
  assertExecutionInputs(authorization,captureApprovedInputs(repo).manifest);report.checks.approved_inputs_end_verified=true;
  report.status='passed';report.phase='complete';
} catch(e) {
  report.status='failed';report.phase=phase;report.reason=e.message;
  report.unmanaged_write_attempts=guard?.attempts??[];
} finally {
  try{
    report.verifier_inputs.after=captureVerifierInputs(p=>read(path.join(repo,p))).record;
    assertVerifierInputsUnchanged(report.verifier_inputs.before,report.verifier_inputs.after);
    report.checks.verifier_inputs_unchanged=true;
  }catch(e){report.status='failed';report.reason=e.message;report.phase='verifier_identity';report.checks.verifier_inputs_unchanged=false;}
  try{
    if(report.status==='passed')note('verification_passed');
  }catch(e){report.status='failed';report.reason=e.message;report.phase='pass_event_recording';}
  try {
    if(!budget.stopped){
      const contents=json(writer.files);
      writer.write('logs','report/written-files.json',contents);
      report.written_manifest={path:'report/written-files.json',sha256:sha(contents),bytes:contents.length,
        note:'Lists writes before this manifest and final report; no self-referential hash.'};
    }
  }catch(e){report.status='failed';report.reason=e.message;report.phase='recording';}
  report.quota={limits:budget.limits,charged:{...budget.used},cumulative_reserved:budget.total,carried_hold:carriedHold,
    campaign_reserved_upper:carriedHold+budget.total,new_run_ceiling:newRunCeiling,release_stages_reserved:releaseStagesReserved,unused_margin:unusedMargin,
    additional_unallocated:additionalUnallocated,protected_765_bytes_used:0};
  const summary=json(report);
  writer.write('final','report/result.json',summary,{reserved:true});
  guard?.restore();
  console.log(JSON.stringify({status:report.status,phase:report.phase,reason:report.reason,report:path.join(root,'report/result.json'),artifact:report.artifact,checks:report.checks,quota:report.quota}));
  if(report.status!=='passed')process.exitCode=1;
}
