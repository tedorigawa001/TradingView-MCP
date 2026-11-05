// RUN2 runner. No invocation without separate exact-hash approval.
// vm limits scope only; it is not a security boundary.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import vm from "node:vm";
const HP="5681f90ed3a2e40e2d7d2d7635dd698b58dbd53c142d22481d91a2d2fd53e808";
const stem="NATIVE_BAR_ADMISSION_WORKER_METADATA_G1_ROUTE_COMPARISON_V1";
const read=s=>readFileSync(new URL(stem+s,import.meta.url));
const sha=b=>createHash("sha256").update(b).digest("hex");
const stop=c=>{process.stderr.write(c+"\n");process.exit(2);};
const w=read("_RUN1_WRAPPER.txt");
const a=w.indexOf("@@MODEL_SOURCE@@"),b=w.indexOf("@@RECEIPT_JSON@@");
const p=Buffer.concat([w.subarray(0,a),read(".mjs"),w.subarray(a+16,b),
  read("_RUN1_INPUT.json"),w.subarray(b+16)]);
if(sha(p)!==HP) stop("PAYLOAD_HASH");
const out=[];
vm.runInNewContext(p.toString(),{text:s=>{out.push(s);}},{timeout:60000,
  contextCodeGeneration:{strings:false,wasm:false}});
if(out.length!==1||typeof out[0]!=="string"||Buffer.byteLength(out[0])>3648)
  stop("OUTPUT");
process.stderr.write("wire "+sha(Buffer.from(out[0]))+"\n");
process.stdout.write(out[0]);
