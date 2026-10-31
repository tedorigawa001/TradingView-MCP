import vm from "node:vm";

// Trusted compiler source only. The test parser gets no Node system or host callbacks.
export function createUnsignedIsolatedTypeScript(source) {
  if(typeof source!=="string"||source.length===0||Buffer.byteLength(source)>16*1024*1024)throw Error("cc4b6_parser_source");
  const context=vm.createContext(Object.create(null),{codeGeneration:{strings:false,wasm:false}});
  const setup=`
    Object.defineProperties(globalThis,{
      Intl:{value:undefined,writable:false,configurable:false},
      Temporal:{value:undefined,writable:false,configurable:false}
    });
    globalThis.performance=Object.freeze({now:()=>0});
    globalThis.Date=class {
      constructor(value){if(arguments.length!==1||![0,-864e13].includes(value))throw Error("cc4b6_parser_date");this.value=value;}
      getTime(){return this.value;}
      valueOf(){return this.value;}
      static now(){return 0;}
    };
    var module=Object.create(null);module.exports=Object.create(null);
  `;
  const expose=`
    if(ts.sys!==undefined)throw Error("cc4b6_parser_system");
    Object.freeze({
      createSourceFile:ts.createSourceFile,forEachChild:ts.forEachChild,
      isFunctionDeclaration:ts.isFunctionDeclaration,isCallExpression:ts.isCallExpression,
      isIdentifier:ts.isIdentifier,isVariableStatement:ts.isVariableStatement,
      ScriptTarget:Object.freeze({Latest:ts.ScriptTarget.Latest}),ScriptKind:Object.freeze({JS:ts.ScriptKind.JS}),
      isolation:Object.freeze({system_available:false,clock_source:"synthetic_zero",
        node_globals:[typeof process,typeof require,typeof setTimeout,typeof clearTimeout,typeof fetch,typeof Buffer],
        clock_globals:[typeof Intl,typeof Temporal]})
    });
  `;
  return vm.runInContext(setup+source+"\n"+expose,context,{filename:"unsigned-isolated-typescript.js"});
}
