import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
export function replaceOnce(text,before,after){
  if(!text.includes(before)||text.indexOf(before)!==text.lastIndexOf(before))throw Error(`mutation must identify one site: ${before}`);
  return text.replace(before,after);
}
function relocate(text,url){
  const resolve=path=>path.startsWith("node:")||path.startsWith("file:")?path:path.startsWith(".")?new URL(path,url).href:pathToFileURL(createRequire(url).resolve(path)).href;
  return text.replace(/from (["'])([^"']+)\1/g,(_,q,path)=>`from ${q}${resolve(path)}${q}`)
    .replace(/import\((["'])(\.[^"']+)\1\)/g,(_,q,path)=>`import(${q}${resolve(path)}${q})`)
    .replace(/new URL\((["'])(\.[^"']+)\1,\s*import\.meta\.url\)/g,(_,q,path)=>`new URL(${q}${resolve(path)}${q})`);
}
export function runMutation(moduleURL,testURL,change,pattern,entryURL){
  const original=readFileSync(moduleURL,"utf8"),changed=change(original);
  const dataURL="data:text/javascript;base64,"+Buffer.from(relocate(changed,moduleURL)).toString("base64");
  let target=moduleURL.href,replacement=dataURL;
  if(entryURL){
    const entry=relocate(readFileSync(entryURL,"utf8"),entryURL);
    if(!entry.includes(moduleURL.href))throw Error("entry does not import the mutation target");
    target=entryURL.href;replacement="data:text/javascript;base64,"+Buffer.from(entry.replace(moduleURL.href,dataURL)).toString("base64");
  }
  const testSource=relocate(readFileSync(testURL,"utf8"),testURL).replace(target,replacement);
  const {NODE_TEST_CONTEXT,...environment}=process.env;
  const run=spawnSync(process.execPath,["--input-type=module",`--test-name-pattern=${pattern}`],{
    input:testSource,encoding:"utf8",timeout:30000,maxBuffer:2*1024**2,
    env:{...environment,NODE_OPTIONS:""}});
  return {code:run.status,error:run.error,output:run.stdout+run.stderr,hash:createHash("sha256").update(changed).digest("hex")};
}
/** Relocate one immutable compiled dependency graph entirely in memory, sharing module identities. */
export function runGraphMutation(entryURL,moduleURL,testURL,change,pattern){
  const cache=new Map();let fingerprint;
  const bundle=url=>{
    if(cache.has(url.href))return cache.get(url.href);
    let original=readFileSync(url,"utf8");
    if(url.href===moduleURL.href){original=change(original);fingerprint=createHash("sha256").update(original).digest("hex");}
    let text=relocate(original,url);
    text=text.replace(/from (["'])(file:[^"']+\/build\/internal\/[^"']+)\1/g,(_,q,child)=>`from ${q}${bundle(new URL(child))}${q}`);
    const result="data:text/javascript;base64,"+Buffer.from(text).toString("base64");cache.set(url.href,result);return result;
  };
  bundle(entryURL);if(!fingerprint)throw Error("mutation target absent from graph");
  let tests=relocate(readFileSync(testURL,"utf8"),testURL);
  for(const [url,data] of cache)tests=tests.split(`"${url}"`).join(`"${data}"`);
  const {NODE_TEST_CONTEXT,...environment}=process.env;
  const run=spawnSync(process.execPath,["--input-type=module",`--test-name-pattern=${pattern}`],{
    input:tests,encoding:"utf8",timeout:30000,maxBuffer:2*1024**2,env:{...environment,NODE_OPTIONS:""}});
  return {code:run.status,error:run.error,output:run.stdout+run.stderr,hash:fingerprint};
}
