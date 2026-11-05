// COMPARISON MODEL ONLY. No top-level call, I/O, imports, timers or parser.
// Do not invoke without separate exact-source/payload execution approval.
// Receipt is trusted plain literal data prepared by an external readback step.
// This function checks its consistency, NOT authenticity or actual host safety.
// Receipt: {head, pins:[8 sha256], sourceHash, invocationHash,
//           readbackVerified:true, premises:[8 true/false/null]}.
// Source/invocation hashes must match the separately reviewed approved wrapper;
// embedding this file's own hash in itself would be circular. No gate is closed
// by a caller repeating constants. Real readback/approval remains external.
// All byte units, resource IDs, fuel and field widths below are abstract.
// No UTF-8/JSON decoding or physical heap/time/GC/host-cost claim.
function compareRoutes(receipt) {
  const head="72098351797e33f04d8a30959653475e968f9f3d";
  // Pins resolve to docs/NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_BOUNDED_JSON_DECODER_<suffix>_DESIGN.md.
  const pins=[
    ["E03_ZA_NORMAL_PENDING",16128,"ad1db1b5397e40b6f312d3205d6b408c1322784598667ed478f6ec318465a804"],
    ["E03_INPUT_EXHAUSTION_ROUTE",12271,"c5c4acca325d362072c9b7ed3a3b115a4f60ec419a0a1b8c8201ce344cbc2b8b"],
    ["E03_WRITE_CURSOR_COMMIT",10181,"c4b29d6c8d1b6ca48cc673df461d7c2a37fbfa1df6506621cf00da53fcf715ff"],
    ["INPUT_STATE",3088,"5932f463539f906def32b57927980ecfbfdcb7eaacb9e6d102b2f26141df7601"],
    ["OWNERSHIP",10862,"c86285c490cb039907f182ea6c0b734b87664bbdfb94b0b9885a86fd0293f90a"],
    ["RECONCILIATION",15156,"7613f70b51e0cbd0ea43cbec7357601c3f35159993b34eae0ae3570b249e70cb"],
    ["E03_EVENT_GUARD_MAPPING",8050,"1ab693e4d1cd6fd08286279bbe5e498fb2238b574522a08a03e9a278f5889932"],
    ["CAPACITY_WORK",11951,"e5de4167c2a8fbef79175cf230d63b5a3a30b85093d3468c1836a35b0daae9c5"]];
  // True means assumed in this model, never demonstrated runtime eligibility.
  const assumptions=["ownedKeys","knownAck","serialDriver","closeWitness",
    "Zphase","Zexit","WcarryAcrossWait","HheldClose"];
  const verdicts=["PASS_CONDITIONAL","VIOLATION","ASSUMPTION_MISSING",
    "BOUND_REACHED","NOT_COMPARABLE","MODEL_ERROR"];
  const codes=["NONE","B_RUNS","B_STEPS","B_TOTAL","B_INPUT","B_DELIVERY",
    "B_RESOURCES","B_TRACE","V_EXTENT","V_CREDIT","V_RELEASE","V_TAIL",
    "V_LOOKUP","V_COLON","V_VALUE","V_POP","V_HANDOFF","V_ORACLE",
    "V_ADMISSION","V_FINISH","MODEL_ERROR","CONTROL_FAILED","SOURCE_BINDING",
    "ASSUMPTION_MISSING","OUTPUT_SCHEMA"];
  const fail=code=>{throw code;};
  const controls=[["extent",0,"V_EXTENT"],["credit",1,"V_CREDIT"],
    ["release",7,"V_RELEASE"],["tail",17,"V_TAIL"]];
  // Six groups x4; decoded K(2,5) aliases K(2), not a codec test.
  const K=(id,span=3)=>Object.freeze({t:"K",id,span});
  const one=["{",K(2),":","v","}"], nested=["{",K(2),":","{","}","}"];
  const cases=[
    [["{","}"],"DONE"],[one,"DONE"],
    [["{",K(2),":","v",",",K(1),":","v","}"],"DONE"],[nested,"DONE"],
    [["{",K(2),":","v",",",K(2),":","v","}"],"REFUSED"],
    [["{",K(2),":","v",",",K(2,5),":","v","}"],"REFUSED"],
    [["{",K(2),"!","v","}"],"REFUSED"],[["{",K(2),":","!"],"REFUSED"],
    [["{",K(2,4)],"REFUSED",2],[["{",K(2)],"REFUSED"],
    [["{",K(2),":"],"REFUSED"],[["{",K(2),":","{"],"REFUSED"],
    [one,"DONE"],[["{",K(2),":"," ","v","}"],"DONE"],
    [nested,"DONE"],[["{","}"],"DONE"],
    [[...one," "],"DONE"],[[...one,"!"],"REFUSED"],
    [["{",K(2),":","v",",",K(2)],"REFUSED"],[one,"DONE",0,"finish"],
    [one,"CANCELLED",0,"cancel"],[one,"BLOCKED",0,"owner"],
    [one,"BLOCKED",0,"write"],[one,"BLOCKED",0,"release"]];
  // BLOCKED is an outcome label only; unknown effects leave REFUSED/liabilities.
  const coverage=Array.from({length:24},()=>[Array(6).fill(0),Array(6).fill(0)]);
  const maxima=[Array(7).fill(0),Array(7).fill(0)];
  // Passing pairs whose refusal reason/delivery differ. why: 1 duplicate, 2 EOF,
  // 3 other. Admission refusal (INPUT_STATE line 27) is not modeled.
  const whyDiff=Array(24).fill(0),atDiff=Array(24).fill(0);
  const layouts=Array.from({length:24},()=>[]);
  const controlResults=Array(4).fill(0); // 0 not run, 1 detected, 2 failed.
  const controlVerdicts=Array(4).fill(6); // 6 not run; otherwise verdict index.
  const premises=Array(8).fill(0); // 0 unknown, 1 assumed true, 2 false.
  let started=0,total=0,primary="NONE",secondary="NONE",stopAt=-1;
  let source="UNKNOWN",invocation="UNKNOWN",active=null,pair=[];
  let diagnostic=[],encodingError=false;
  const setStop=code=>{
    if(primary==="NONE") {primary=code;stopAt=active?active.id:-1;}
    else if(secondary==="NONE"&&primary!==code) secondary=code;
  };
  const classify=code=>code.startsWith("V_")?1:
    code.startsWith("B_")?3:5;
  const safeCode=e=>typeof e==="string"&&codes.includes(e)?e:"MODEL_ERROR";
  function commit(r) {
    if(r.committed) return;
    r.committed=true;
    if(r.control>=0) return;
    coverage[r.c][r.route][r.v]++;
    if(r.v!==0) return;
    r.metrics.forEach((v,k)=>{maxima[r.route][k]=Math.max(maxima[r.route][k],v);});
    if(!layouts[r.c].includes(r.layout)) layouts[r.c].push(r.layout);
  }
  function stopRun(r) {
    setStop(r.code);
    diagnostic=r.tail;
    for(const pending of pair) commit(pending);
  }
  function run(f,z,d,fuel,fields,mutant) {
    let ticks=0,pos=0,end=0,start=0,owned=0,phase=0,state="NEED_INPUT";
    let delivery=0,left=0,q=0,n=0,root=false,eof=false,task=null,stack=[];
    let blocked=false,hit=null,calls=0,zero=0,input=0,live=0,handoffs=0;
    let bytes=[],cuts=[],tail=[],why=3,dry=0,waits=0;
    let observedQ=0,observedN=0,observed=[],closedRoot=false,seenRoot=false;
    let effect=null,closing=null,finishReady=false,finishYield=false,yieldPoint=null;
    const charge=()=>{
      if(ticks===2048) fail("B_STEPS");
      if(total===2367488) fail("B_TOTAL");
      ticks++;total++;
    };
    function advance() {
      if(!["READY","YIELDED"].includes(state)) return false;
      left=fuel;calls++;state="READY";return true;
    }
    const snapshot=()=>[state,pos,end,phase,owned,task?.left,q,n,root,eof,
      delivery,left,calls,blocked,handoffs].join();
    function rejectedFinish() {
      charge();
      const before=snapshot();
      if(finish()||before!==snapshot()) fail("V_FINISH");
    }
    const ctx=()=>stack.at(-1), witness=()=>observed.at(-1);
    const refuse=()=>{state="REFUSED";};
    const terminal=()=>["DONE","REFUSED","CANCELLED"].includes(state);
    const checkpoint=kind=>[kind,pos,q,n,stack.length,phase,owned,delivery,
      task?task.kind:"none",task?task.left:0];
    const mark=kind=>{hit=checkpoint(kind);};
    function finish() {
      if(!["NEED_INPUT","WAIT_EOF"].includes(state)) return false;
      eof=true;
      state=root&&!task&&!owned&&!stack.length?"DONE":"REFUSED";
      if(state==="DONE") handoffs++;else why=2;
      return true;
    }
    function work() {
      const a=task;
      if(!a) fail("V_RELEASE");
      if(f[3]==="write"&&a.kind==="insert"&&a.left===1) {
        mark("write");blocked=true;refuse();return;
      }
      if(a.kind==="close") effect=["retire"];
      if(--a.left) return;
      if(a.kind==="lookup") {
        const duplicate=a.o.index.includes(a.id);
        effect=[duplicate?"duplicate":"unique",a.id];
        if(duplicate) {why=1;refuse();}
        else {a.o.key=a.id;a.o.expect="colon";}
      } else if(a.kind==="insert") {
        a.o.index.splice(a.rank,0,a.o.key);
        effect=["insert",a.o.key];
      } else {
        if(ctx()!==a.o) fail("V_POP");
        if(!z) pos++;
        stack.pop();effect=["close"];
        if(!stack.length) root=true;else ctx().expect="after";
      }
      task=null;
    }
    // 0 copy, 1 source release, 2 parse, 3 private release, 4 state commit.
    function step() {
      if(phase<2) {phase++;return false;}
      if(phase===3) {
        if(f[3]==="release"&&fields===1) {
          mark("release");owned=2;blocked=true;refuse();return false;
        }
        if(mutant==="release") {work();return true;}
        owned=0;phase=4;return false;
      }
      if(phase===4) {
        if(f[3]==="release"&&fields===4) {
          mark("state");blocked=true;refuse();return false;
        }
        state=root?"WAIT_EOF":"NEED_INPUT";return false;
      }
      if(mutant==="extent") {pos=end+1;return true;}
      if(task&&(z||pos<end)) {work();return true;}
      if(pos===end) {phase=3;return false;}
      const b=bytes[pos],t=b.e.t,o=ctx();
      if(root) {
        if(t!==" "&&mutant!=="tail") refuse();else pos++;
      } else if(t===" ") pos++;
      else if(t==="K") {
        if(b.first) {
          if(!o||!["key","empty"].includes(o.expect)||o.keys===8) {
            refuse();return true;
          }
          o.keys++;q+=mutant==="credit"?2:1;o.expect="decode";
        }
        pos++;
        if(b.last) task={kind:"lookup",o,id:b.e.id,left:1};
      } else if(t==="{") {
        if((o&&o.expect!=="value")||stack.length===4) refuse();
        else {n++;pos++;stack.push({expect:"empty",index:[],keys:0});}
      } else if(t===":") {
        if(!o||o.expect!=="colon"||o.index.includes(o.key)) refuse();
        else {
          pos++;o.expect="value";
          const rank=o.index.filter(id=>id<o.key).length;
          task={kind:"insert",o,rank,left:(o.index.length-rank+1)*fields+1};
        }
      } else if(t==="v") {
        if(!o||o.expect!=="value"||!o.index.includes(o.key)) refuse();
        else {n++;pos++;o.expect="after";}
      } else if(t===",") {
        if(!o||o.expect!=="after") refuse();
        else {pos++;o.expect="key";}
      } else if(t==="}") {
        if(!o||!["empty","after"].includes(o.expect)) refuse();
        else {
          effect=["classifyClose"];
          if(z) pos++;
          task={kind:"close",o,left:o.index.length*fields+1};
        }
      } else refuse();
      return true;
    }
    function audit(old,normal) {
      if(pos<old.pos||pos>old.pos+1||pos>end||end>bytes.length)
        fail("V_EXTENT");
      if(normal&&(old.phase>=3||old.terminal)) fail("V_RELEASE");
      if(effect?.[0]==="classifyClose") {
        if(closing||!witness()) fail("V_POP");
        closing={object:witness(),left:witness().keys.length*fields+1,consumed:false};
      }
      if(pos>old.pos) {
        const b=bytes[old.pos],t=b.e.t;
        if(closing&&t!=="}") fail("V_POP");
        if(closedRoot&&t!==" ") fail("V_TAIL");
        if(t==="{") {
          const w=witness();
          if(w&&(!w.inserted||!w.unique)) fail("V_VALUE");
          observedN++;seenRoot=true;
          observed.push({keys:[],current:null,unique:false,inserted:false});
        } else if(t==="K"&&b.first) {
          observedQ++;witness().current=b.e.id;
          witness().unique=false;witness().inserted=false;
        } else if(t===":") {
          const w=witness();
          if(!w||!w.unique||w.keys.includes(w.current)) fail("V_COLON");
          w.keys.push(w.current);
        } else if(t==="v") {
          const w=witness();
          if(!w||!w.unique||!w.inserted) fail("V_VALUE");
          observedN++;
        } else if(t==="}") {
          if(!closing||closing.object!==witness()||closing.consumed) fail("V_POP");
          closing.consumed=true;
        }
      }
      if(effect?.[0]==="retire"||effect?.[0]==="close") {
        if(!closing||closing.object!==witness()) fail("V_POP");
        closing.left--;
        if(effect[0]==="close") {
          if(closing.left!==0||!closing.consumed) fail("V_POP");
          observed.pop();closing=null;
          if(!observed.length) closedRoot=true;
        } else if(closing.left<=0) fail("V_POP");
      }
      if(effect) {
        const w=witness();
        if(effect[0]==="unique"||effect[0]==="duplicate") {
          if(!w||w.current!==effect[1]) fail("V_LOOKUP");
          const duplicate=w.keys.includes(w.current);
          if(duplicate!==(effect[0]==="duplicate")) fail("V_LOOKUP");
          w.unique=!duplicate;
        } else if(effect[0]==="insert") {
          if(!w||w.current!==effect[1]||!w.unique||
            !w.keys.includes(w.current)||w.inserted) fail("V_COLON");
          w.inserted=true;
        }
      }
      if(q!==observedQ||n!==observedN) fail("V_CREDIT");
      if(root&&(!seenRoot||!closedRoot||observed.length||stack.length||task))
        fail("V_POP");
      if(state==="DONE"&&(!eof||!root||owned||pos!==bytes.length||handoffs!==1))
        fail("V_HANDOFF");
      const ids=q+n+stack.length+(owned?1:0)+(task?1:0)+
        stack.reduce((a,o)=>a+o.index.length,0);
      if(stack.length>4||ids>128) fail("B_RESOURCES");
      live=Math.max(live,ids);input=Math.max(input,owned?end-start:0);
      tail.push([pos,phase,q,n]);if(tail.length>16) tail.shift();
    }
    try {
      if(f[0].length>128) fail("B_INPUT");
      for(const raw of f[0]) {
        const e=typeof raw==="string"?{t:raw,span:1}:raw;
        if(!Number.isInteger(e.span)||e.span<1||bytes.length+e.span>256)
          fail("B_INPUT");
        for(let i=0;i<e.span;i++)
          bytes.push(Object.freeze({e,first:i===0,last:i===e.span-1}));
        if(["K",":","}"].includes(e.t)) cuts.push(bytes.length);
      }
      if(f[2]) bytes=bytes.slice(0,-f[2]);
      Object.freeze(bytes);
      const size=bytes.length;
      cuts=cuts.filter(i=>i<=size);
      if(!cuts.includes(size)) cuts.push(size);
      let ends=d===0?[size]:d===1?bytes.map((_,i)=>i+1):cuts;
      if(d===3) ends=[0,ends[0],ends[0],...ends.slice(1)];
      if(ends.length>512) fail("B_DELIVERY");
      Object.freeze(ends);
      for(;;) {
        if(terminal()||blocked) break;
        charge();effect=null;
        if(f[3]==="finish"&&state==="YIELDED"&&pos===end&&!finishYield) {
          yieldPoint=checkpoint("finishY").join(",");
          rejectedFinish();finishYield=true;
        }
        const old={pos,phase,terminal:terminal()};
        let normal=false;
        if(!left&&["cancel","owner"].includes(f[3])&&task?.kind==="insert") {
          mark(f[3]);
          if(f[3]==="cancel") state="CANCELLED";
          else {blocked=true;owned=2;refuse();}
        } else if(["NEED_INPUT","WAIT_EOF"].includes(state)) {
          if(task) waits++;
          if(delivery===ends.length) finish();
          else {
            if(owned) fail("V_ADMISSION");
            start=pos;end=ends[delivery++];owned=1;
            phase=0;state="READY";left=0;
          }
        } else {
          if(!left&&!advance()) fail("V_FINISH");
          if(f[3]==="finish"&&!finishReady&&pos===end) {
            mark("finish");rejectedFinish();finishReady=true;
          }
          normal=step();left--;
          if(normal&&pos===old.pos) zero++;
          if(normal&&old.pos===end) dry++;
          // Do not overwrite exhaustion/resource-boundary states with YIELDED.
          if(state==="READY"&&!blocked&&!left) state="YIELDED";
        }
        audit(old,normal);
      }
      if(terminal()) {
        rejectedFinish();charge();
        const before=snapshot();
        if(advance()||before!==snapshot()) fail("V_FINISH");
      }
      if(f[3]==="finish"&&hit) hit.push(yieldPoint||"none");
      if(f[3]&&(!hit||(f[3]==="finish"&&!finishYield)))
        return {v:4,code:"NONE",tail,hit};
      if((blocked?"BLOCKED":state)!==f[1]) fail("V_ORACLE");
      return {v:0,code:"NONE",tail,hit,metrics:[calls,zero,input,live,pos,dry,waits],
        layout:ends.join(","),why,at:delivery};
    } catch(e) {
      const code=safeCode(e);
      return {v:classify(code),code,tail,hit};
    }
  }
  function attempt(c,route,d,fuel,fields,control=-1) {
    if(started===1156) fail("B_RUNS");
    active={id:started++,c,route,d,fuel,fields,control,committed:false};
    pair.push(active);
    const result=run(cases[c],route===0,d,fuel,fields,
      control<0?"":controls[control][0]);
    Object.assign(active,result);
    return active;
  }
  function equivalent(a,b) {
    if(!a||!b||a.length!==b.length) return false;
    return a.every((v,i)=>v===b[i]);
  }
  try {
    // Pre-reserve a fixed wire envelope before any transition. ASCII only.
    // Header<=1280; 24 case rows<=24*64=1536; aggregate<=384;
    // stop<=192; diagnostic16*(4*3 digits+4 separators)=256; total<=3648.
    if(1280+1536+384+192+256>4096) fail("OUTPUT_SCHEMA");
    for(const f of cases) {Object.freeze(f[0]);Object.freeze(f);}
    Object.freeze(cases);
    const sha=v=>typeof v==="string"&&/^[a-f0-9]{64}$/.test(v);
    if(!receipt||receipt.head!==head||!Array.isArray(receipt.pins)||
      receipt.pins.length!==8||receipt.readbackVerified!==true||
      !sha(receipt.sourceHash)||!sha(receipt.invocationHash)||
      pins.some((p,i)=>receipt.pins[i]!==p[2])) fail("SOURCE_BINDING");
    source=receipt.sourceHash;invocation=receipt.invocationHash;
    if(!Array.isArray(receipt.premises)||receipt.premises.length!==8)
      fail("ASSUMPTION_MISSING");
    for(let i=0;i<8;i++) {
      const v=receipt.premises[i];
      premises[i]=v===true?1:v===false?2:0;
    }
    if(premises.some(v=>v!==1)) fail("ASSUMPTION_MISSING");
    for(let i=0;i<4;i++) {
      pair=[];
      const r=attempt(controls[i][1],1,2,1,1,i);
      controlVerdicts[i]=r.v;
      if(r.v!==1||r.code!==controls[i][2]) {
        controlResults[i]=2;setStop("CONTROL_FAILED");stopRun(r);break;
      }
      controlResults[i]=1;r.committed=true;
    }
    batch:for(let c=0;c<24;c++) for(let d=0;d<4;d++)
      for(const fuel of [1,4,16]) for(const fields of [1,4]) {
        if(primary!=="NONE") break batch;
        pair=[];
        const a=attempt(c,0,d,fuel,fields);
        if(![0,4].includes(a.v)) {stopRun(a);break batch;}
        const b=attempt(c,1,d,fuel,fields);
        if(![0,4].includes(b.v)) {stopRun(b);break batch;}
        if(c>=19&&!equivalent(a.hit,b.hit))
          for(const r of pair) if(r.v===0) r.v=4;
        if(a.v===0&&b.v===0) {
          if(a.why!==b.why) whyDiff[c]++;
          if(a.at!==b.at) atDiff[c]++;
        }
        for(const r of pair) commit(r);
      }
  } catch(e) {
    const code=safeCode(e);setStop(code);
    if(active&&!active.committed) {
      if(active.v===undefined) Object.assign(active,{v:classify(code),code,tail:[]});
      diagnostic=active.tail;
    }
    for(const r of pair) if(r.v!==undefined) commit(r);
  }
  // Fixed-schema ASCII encoding. Numeric domains are checked BEFORE conversion;
  // invalid cells are explicit ?, never silently zeroed or truncated.
  // All valid accounting cells and the original stop survive encoder errors.
  const number=(n,max)=>{
    if(!Number.isInteger(n)||n<0||n>max) {encodingError=true;return "?";}
    return n.toString();
  };
  const vector=(a,max)=>a.map(n=>number(n,max)).join(",");
  const lines=[
    "V1 qualification=NONE; all runtime gates OPEN; no route selected",
    "head="+head,"source="+source,"invocation="+invocation,
    "pins="+pins.map(p=>p[2]).join(","),
    "premises="+assumptions.join(",")+"="+vector(premises,2),
    "runs="+number(started,1156)+" eval="+number(total,2367488)+
      " notRun="+number(1156-started,1156),
    "controls="+vector(controlResults,2)+" observed="+vector(controlVerdicts,6)+
      " route=WH untested=V_LOOKUP,V_COLON,V_VALUE,V_POP,V_HANDOFF,V_ORACLE,V_ADMISSION,V_FINISH",
    "columns="+verdicts.join(",")+" D=whyDiff,deliveryDiff",
    "maxColumns=calls,zeroWork,retainedInput,liveIDs,refusalOrEndPosition,"+
      "exhaustedWork(Z),pendingWaits(WH)"];
  for(let c=0;c<24;c++)
    lines.push("C"+c+" Z="+vector(coverage[c][0],24)+
      " WH="+vector(coverage[c][1],24)+
      " D="+number(whyDiff[c],24)+","+number(atDiff[c],24));
  lines.push("maxZ="+vector(maxima[0],2048),"maxWH="+vector(maxima[1],2048),
    "uniqueLayouts="+vector(layouts.map(a=>a.length),4));
  const rowBounds=diagnostic.every(row=>row.length===4&&
    row.every((v,i)=>Number.isInteger(v)&&v>=0&&v<=(i===0?256:i===1?4:128)));
  const invalidDiagnostic=diagnostic.length>16||!rowBounds;
  if(invalidDiagnostic) encodingError=true;
  const suffix=invalidDiagnostic?"?":diagnostic.map(row=>row.join(",")).join(";");
  const primaryCode=codes.includes(primary)?primary:"MODEL_ERROR";
  const secondaryCode=codes.includes(secondary)?secondary:"MODEL_ERROR";
  lines.push("stop="+primaryCode+" secondary="+secondaryCode+
    " run="+(stopAt===-1?"NONE":number(stopAt,1155)),
    "diagnosticPartial="+suffix,
    "encoder="+(encodingError?"OUTPUT_SCHEMA":"OK"));
  const wire=lines.join("\n")+"\n";
  return wire;
}
