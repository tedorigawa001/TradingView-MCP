# RUN2 Observed Output
2026-11-05 JST. One attempt; RECORD_VALID: exit0, stderr exactly the hash line, final encoder line. No retry.
Inputs as RUN2_PREPARE; wire 2430 bytes, SHA-256 32955f95ae56d8a75db22cf1107211b4af32a27691443c6b26413e402d4cff36.
runs, controls, stop and all values on FIX_REVIEW line 32 match the hand trace. Conditional on eight assumed premises; no qualification or route selection.
Observed wire follows verbatim.

V1 qualification=NONE; all runtime gates OPEN; no route selected
head=72098351797e33f04d8a30959653475e968f9f3d
source=ec0527a2466ba71a6bca97d75d6a7374f045c5bef90dbe4e8ad35f7aa5cfee2b
invocation=fb29e4556c846498511561e86152abfca11107e7c203879b1c23efd002200483
pins=ad1db1b5397e40b6f312d3205d6b408c1322784598667ed478f6ec318465a804,c5c4acca325d362072c9b7ed3a3b115a4f60ec419a0a1b8c8201ce344cbc2b8b,c4b29d6c8d1b6ca48cc673df461d7c2a37fbfa1df6506621cf00da53fcf715ff,5932f463539f906def32b57927980ecfbfdcb7eaacb9e6d102b2f26141df7601,c86285c490cb039907f182ea6c0b734b87664bbdfb94b0b9885a86fd0293f90a,7613f70b51e0cbd0ea43cbec7357601c3f35159993b34eae0ae3570b249e70cb,1ab693e4d1cd6fd08286279bbe5e498fb2238b574522a08a03e9a278f5889932,e5de4167c2a8fbef79175cf230d63b5a3a30b85093d3468c1836a35b0daae9c5
premises=ownedKeys,knownAck,serialDriver,closeWitness,Zphase,Zexit,WcarryAcrossWait,HheldClose=1,1,1,1,1,1,1,1
runs=1156 eval=41435 notRun=0
controls=1,1,1,1 observed=1,1,1,1 route=WH untested=V_LOOKUP,V_COLON,V_VALUE,V_POP,V_HANDOFF,V_ORACLE,V_ADMISSION,V_FINISH
columns=PASS_CONDITIONAL,VIOLATION,ASSUMPTION_MISSING,BOUND_REACHED,NOT_COMPARABLE,MODEL_ERROR D=whyDiff,deliveryDiff
maxColumns=calls,zeroWork,retainedInput,liveIDs,refusalOrEndPosition,exhaustedWork(Z),pendingWaits(WH)
C0 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C1 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C2 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C3 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C4 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,18
C5 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,18
C6 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C7 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C8 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C9 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C10 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C11 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C12 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C13 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C14 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C15 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C16 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C17 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=0,0
C18 Z=24,0,0,0,0,0 WH=24,0,0,0,0,0 D=24,0
C19 Z=10,0,0,0,14,0 WH=10,0,0,0,14,0 D=0,0
C20 Z=10,0,0,0,14,0 WH=10,0,0,0,14,0 D=0,0
C21 Z=10,0,0,0,14,0 WH=10,0,0,0,14,0 D=0,0
C22 Z=6,0,0,0,18,0 WH=6,0,0,0,18,0 D=0,0
C23 Z=18,0,0,0,6,0 WH=18,0,0,0,6,0 D=0,0
maxZ=103,25,15,10,13,25,0
maxWH=103,25,15,10,13,0,5
uniqueLayouts=3,4,4,4,4,4,4,4,3,3,4,4,4,4,4,3,4,4,4,3,4,4,1,3
stop=NONE secondary=NONE run=NONE
diagnosticPartial=
encoder=OK
