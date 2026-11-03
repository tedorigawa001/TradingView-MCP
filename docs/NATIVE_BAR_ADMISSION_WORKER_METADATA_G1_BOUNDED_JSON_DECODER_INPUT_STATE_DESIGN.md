# G1 Decoder Input And State Contract
DESIGN_ONLY; incomplete. No policy exception, implementation, synthetic execution, adoption, MCP or activation. Keep M/G2 gates. Dot PAUSED; judgment/notification/mail unchanged.

## Operations
Allowed serial calls:
begin: NEW only; binds fixed source/purpose/attempt/profile/limits. Work/cleanup and ownership proof UNSET block execution; descriptors grant no authority.
acceptDelivery: NEED_INPUT/WAIT_EOF only, no pending input; next numbered UTF-8 delivery -> READY. Empty deliveries count. Alias/copy proof open; no assumed zero-copy.
advance: READY/YIELDED only; exact consumption within step fuel. Resume same input/position, no reread/refund. No reviver/coercion/callback/import/fallback.
finish: NEED_INPUT/WAIT_EOF only, input drained; explicit EOF. Incomplete grammar/token/UTF-8/carry refuses.
cancel: begun nonterminal states only; no partial result.
Other/out-of-order/reentrant calls error; state, bindings, owned input and position all stay unchanged; no reset. Body-free errors.

## States
NEW -> begin -> NEED_INPUT.
READY -> advance -> YIELDED on step exhaustion; resume without new input.
Root completion immediately latches tail-only mode for remaining current input and across deliveries/yields: only JSON whitespace; otherwise REFUSED.
Input exhausted -> WAIT_EOF if root complete, else NEED_INPUT.
finish -> DONE only with complete object root, empty stack and no pending token/carry.
Refusal -> REFUSED; cancel -> CANCELLED. Both terminal. Cleanup-pending blocks next acquisition; it is not cleanup-complete. DONE transfers results once; no terminal restart or second transfer.
No immediate synchronous interruption, GC, erasure or transport-settlement claim.

## Deferred
Counters, work/cleanup, ownership, capacity/copies and tests need separate design/funding/approval; no parsing grant.
Approved funding: G21536/review1/terminal3071 -> plan2048/review2048/links512; stop512 inside terminal. Docs only.
Base74d2c2a; D2047/L474; C356081/U36271; free=0/0/0/1(G1/G2/review/terminal).
