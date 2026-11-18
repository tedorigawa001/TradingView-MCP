// Arithmetic specifications only: no expanded input, profile switch, allocation or verifier call.
export function constructionSketch() {
  const MiB=1048576, captures=4096, pairs=1024;
  const evidence=captures*65536; // Each distinct canonical receipt/payload pair is exactly 64 KiB.
  const profile=(selected)=>{
    const events=selected*8, manifests=Math.ceil(selected/64), journalFrames=selected?events+manifests+3:0;
    const dataFrames=captures*2+journalFrames, retained=captures-selected;
    const directoryPages=Math.ceil(dataFrames/512), inventoryPages=Math.ceil(retained*2/512), baselinePages=selected?8:0;
    const pages=directoryPages+inventoryPages+baselinePages;
    const framing=65536+dataFrames*160+directoryPages*512+retained*2*256+inventoryPages*512+(selected?captures*512+baselinePages*512:0);
    const journal=selected?events*2048+selected*2048+manifests*512+65536+MiB+262144:0;
    const nodes=captures*(512+64)+events*128+selected*256+(selected?captures*64:0)+retained*2*16+
      dataFrames*16+(selected?4096*8+selected*8:0)+pages*64+4096;
    // Conditional audit envelope, NOT a bound established for a future implementation.
    const conditionalWork=32*Math.ceil((evidence+framing+journal)/64)+96*nodes+32*MiB;
    return {selected,retained,events,manifests,dataFrames,pages,frames:1+pages+dataFrames,evidence_bytes:evidence,
      framing_bytes_upper:framing,journal_bytes_upper:journal,input_bytes_upper:evidence+framing+journal,nodes_upper:nodes,
      conditional_work_upper:conditionalWork,work_sufficiency_proven:false};
  };
  return {normal:profile(0),complete:profile(pairs),expanded_input_created:false};
}
