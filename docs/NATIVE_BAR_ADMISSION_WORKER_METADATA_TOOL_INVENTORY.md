# B2-M2a-1 Local Tool Inventory And Gap Report

Report version: **M2a-1 inventory v1, independent review complete**, 2026-11-02 JST. Baseline: `c3b56078f7ea326edbd36380cece77cf24c63535`. Scope is the exact 21-file manifest in the [M2a design](NATIVE_BAR_ADMISSION_WORKER_METADATA_TOOL_QUALIFICATION_DESIGN.md#m2a-1-exact-first-scope), not M2a-2 closure review. The initial inventory and subsequent review/commit authorization are distinguished below; neither grants tool execution.

## Result

**The approved inventory and role-specific decision tables are complete; execution qualification remains blocked.** No candidate is adopted, loaded or executed. No static report, source digest or matching package declaration grants M1 a real producer/profile/approval. The nine required roles have explicit gap rows below; no role is marked `STATIC_CONFORMANT_UNEXECUTED`.

The only candidate retained for possible additional static investigation is `ip-address` for syntax/subnet arithmetic. It is not an approved DNS/public-destination predicate. The inspected JSON mechanisms are rejected for this project's strict metadata-decoder role; no qualifying decoder has been identified within the approved inventory. This is a scope-limited conclusion, not a search of every installed package.

## Scope And Inspection Method

The 21 candidate/source files are F01-F21 below. Investigation did not follow any other dependency, main entry, source-map, type-definition, corpus, security document or builtin source. No network/specification retrieval was performed in this slice. The design/parent/BACKLOG and Git metadata are control documentation, not additional candidate sources.

The existing workspace inspection utility used only Node builtin filesystem/path/assertion/hash operations. It read source **as UTF-8 text**, not as executable modules or JSON/IP/AST input. It did not import any of F03-F21, invoke a source parser/VM, resolve a package through Node, run a package script, inspect live environment/runtime/CA/resolver state, or create a child/worker. Tool-output decoding of the inspector's own identity summary is not parsing an inspected manifest or a candidate payload. This utility is not an execution-qualified acquisition runtime.

Before content reads, the inspector checked the canonical repository root and every path component with lstat; symlinks, escaping aliases, nonregular leaves and unexpected hard links were refused. It checked file/aggregate sizes, opened read-only with no-follow, compared descriptor identity with the path, and used a bounded size-plus-one read to catch growth. It compared device/inode/mode/owner/group/link count/size/mtime/ctime before and after and closed descriptors in finally. No drift was observed in the completed snapshots. These checks are inspection evidence, not a race-free future loader or publisher-authentication guarantee.

All 253280 file bytes were read and hashed per snapshot cycle. Semantic inspection used selected line ranges and literal import/require text locators; those locators are not an AST-derived complete closure. Every decision cites positive source evidence; unread portions or unlisted references are not certified harmless. No raw source dump, author/contact list, credential, actual market record or account information is retained in this report.

## File Manifest And Content Identities

Order is the approved manifest order. Paths are repository-relative. Line counts are for this exact local snapshot; installed artifacts may differ on another checkout.

| ID | Approved Path | Bytes | Lines | Local File SHA-256 |
|---|---|---:|---:|---|
| F01 | `package.json` | 5389 | 116 | `585b722ac51f5999a4486b959c7b1276ec7fd4f0438d9300b387c09d2778bb0e` |
| F02 | `package-lock.json` | 55117 | 1569 | `f4c72172689e8b455f200dd78d93b5b29b83b359604fc3eeac58c5bc118c7a05` |
| F03 | `src/boundedResponse.ts` | 2708 | 67 | `cce8f94792a7a98bee5fea21d77ebdc87043cbac7510986e6979cfa427c06770` |
| F04 | `test/helpers/unsignedIsolatedTypeScript.mjs` | 2396 | 40 | `e3f65ebf428ae2e2590a8b1a7ea6103a0f3f0f45a51ed4ac99154762a6a226c7` |
| F05 | `test/helpers/unsignedControllerData.mjs` | 4673 | 62 | `8efedc375335fdd41806aed00ac65447dd32e1838a0ddb53dc421fc98064935a` |
| F06 | `test/helpers/unsignedMetadataAcquisitionContracts.mjs` | 33471 | 432 | `fdd93fe291499822fcf7bf2061050c8621b57c0d51414a27547cd41c3f8fccdf` |
| F07 | `node_modules/ip-address/package.json` | 2361 | 91 | `da8deffa558848bddae7ebcc7875cddb7edfc6a996de046560cf10ff0a4b0094` |
| F08 | `node_modules/ip-address/dist/ip-address.js` | 1772 | 35 | `3e38a4b349282e67a811aece46e273b1b24abbba2897bea707a00170ebdfc200` |
| F09 | `node_modules/ip-address/dist/ipv4.js` | 24641 | 602 | `69b33990eca8bf92704c0b47843c2869daa517ee5cb7cb170c052481bcb67c90` |
| F10 | `node_modules/ip-address/dist/ipv6.js` | 60225 | 1461 | `47f28ef06d0e49a9ea0980492e95258b1bb40952f12be268cc3c1221312b5e95` |
| F11 | `node_modules/ip-address/dist/common.js` | 6161 | 154 | `15b5caebd299350e045dfc4e83cc9f4a082eac6bd8eb3581b00036c55ca2072e` |
| F12 | `node_modules/ip-address/dist/v4/constants.js` | 2776 | 51 | `f8de9ffd2d22c3225856132439a631ff114fa1a0a91a2c16e7b51f924198db91` |
| F13 | `node_modules/ip-address/dist/v6/constants.js` | 5371 | 131 | `659c2a35b79e0e1a67f85bf5704446bc2439ea7fede7e99fa5b349a6094b2ce5` |
| F14 | `node_modules/ip-address/dist/v6/helpers.js` | 1710 | 54 | `80660cbe876ed3e7224268638582db8def929a53bc8822c5a5d8a0c321cca50f` |
| F15 | `node_modules/ip-address/dist/address-error.js` | 372 | 12 | `d0bb8495a78ce2a1e2c1ad231c15b3a8146fec8c8ea32b121fcbe1e032b9cc0e` |
| F16 | `node_modules/ipaddr.js/package.json` | 719 | 35 | `fc1071893728a0e78fa40ce0dbe04c5a1021179fdcb5b229f274e3556d6a87cd` |
| F17 | `node_modules/ipaddr.js/lib/ipaddr.js` | 19333 | 673 | `d82a21a6872925dfe73e9aa10e9eb47baba398987560e36db107f44d92f069b0` |
| F18 | `node_modules/body-parser/package.json` | 1560 | 60 | `9410a56eb52cfe53ec48f013c872d4d336bb1cad66ea166bf3d97d2807bf542a` |
| F19 | `node_modules/body-parser/lib/types/json.js` | 4393 | 186 | `ae364afecbc19e0b13b8a177498d773f325f550b025314d1720fcee4d14e39b0` |
| F20 | `node_modules/ajv/package.json` | 4405 | 126 | `1f9033ee5a6515e7d76938b7072941862d1ed228a6879cc7fe10cdeb75107989` |
| F21 | `node_modules/ajv/dist/compile/jtd/parse.js` | 13727 | 350 | `548b7e6ee5558360945f261e092cd328662868995877140ed2ae7ff981300b7f` |

Distinct files: **21**. Distinct bytes: **253280**; largest file F10: **60225 bytes**. F01-F06 are repository source/manifests; F07-F21 are installed artifacts, not newly acquired dependencies.

Source-set SHA-256: `608f918f9d7f92660ef7f27084d2ae51ef0e3b7ab7b88c91b4dd6df9f7c4bb7b`. This hashes the UTF-8 JSON serialization of the manifest-order array of `{path, sha256}` objects with that key order; it does not hash upstream tarballs or an entire package tree.

Identity-snapshot SHA-256: `1d372410f3c3acf0d6e124edae79023af9dc945623e68a70aa420a3e65198a56`. The local descriptor records also bind file IDs, sizes, line counts and the identity fields checked above. This is an untrusted local observation checksum, not a signature, first-seen timestamp or authorization receipt.

### Local Read Identities

All 21 leaves had decimal `dev=16777229`, `mode=33188` (regular 0644), `uid=501`, `gid=20`, `nlink=1`; size is in the manifest table. The values below are raw filesystem metadata, not wall-clock observations or evidence of elapsed time. ACLs, extended attributes, code signatures and tamper resistance were not audited; this is not permission to trust or load these paths later.

| ID | Inode | mtime Nanoseconds | ctime Nanoseconds |
|---|---:|---:|---:|
| F01 | 139499856 | 1792692530376017493 | 1792692530376017493 |
| F02 | 139499855 | 1792807646385540307 | 1792807646385540307 |
| F03 | 88000807 | 1785407858015842915 | 1788069101152111862 |
| F04 | 163773363 | 1793505293484022512 | 1793505293484022512 |
| F05 | 159986468 | 1793231297524007474 | 1793231297524391972 |
| F06 | 167818051 | 1793593811462729252 | 1793593811462729252 |
| F07 | 149208605 | 1792807646157668895 | 1792807646157668895 |
| F08 | 149208596 | 1792807646156573975 | 1792807646156573975 |
| F09 | 149208598 | 1792807646156799851 | 1792807646156799851 |
| F10 | 149208601 | 1792807646157413686 | 1792807646157413686 |
| F11 | 149208587 | 1792807646155987766 | 1792807646155987766 |
| F12 | 149208590 | 1792807646156183558 | 1792807646156183558 |
| F13 | 149208593 | 1792807646156283225 | 1792807646156283225 |
| F14 | 149208595 | 1792807646156470058 | 1792807646156470058 |
| F15 | 149208586 | 1792807646155798724 | 1792807646155798724 |
| F16 | 87994774 | 1786178848415768027 | 1792155471571829345 |
| F17 | 87994776 | 1786178848521972775 | 1792155471572045935 |
| F18 | 149208171 | 1792807646109138947 | 1792807646109138947 |
| F19 | 149208142 | 1792807646107435110 | 1792807646107435110 |
| F20 | 87995231 | 1786178849218875647 | 1792155471636251777 |
| F21 | 87995180 | 1786178848997310996 | 1792155471629084979 |

## Declaration And Entry Comparison

| Candidate | Lock Declaration | Installed Declaration And Inspected Entry | Interpretation |
|---|---|---|---|
| ip-address | F02:966-974, 10.7.4 | F07:19-29/52-61, 10.7.4, main `dist/ip-address.js`; F08 is CommonJS-style source | Version declarations agree; F07 alone declares `sideEffects: false`. The lock has no such field. F07's prepare/prepack/build scripts are not run |
| ipaddr.js | F02:975-982, 1.9.1 | F16:4/29-35, 1.9.1, main `./lib/ipaddr.js`; F17 is a self-invoking export wrapper | Version declarations agree; actual loader behavior is not exercised |
| body-parser | F02:442-456, 2.4.0 | F18:4/15-27, 2.4.0, CommonJS; the `./json` export names F19 | Version declarations agree; package root `./index.js` and dependency initialization are outside this inventory |
| AJV | F02:400-414, 8.20.0 | F20:3-5/61-65, 8.20.0; inspected F21 is its CommonJS-style internal JTD compiler module | Version declarations agree; F20's package main `dist/ajv.js` and a public JTD entry are not inspected/resolved |

F01:93-114 declares Node `>=22`, Zod `^4.4.3`, TypeScript `^6.0.3` and an `ip-address` override `^10.7.1`, not a new direct import. F02:1463-1474/1551-1558 declares TypeScript 6.0.3 and Zod 4.6.7. Their installed metadata/entry source is outside the approved 21 files; these are lock declarations only. No Node executable, runtime source, build relation or installed runtime version is identified.

The lock's resolved URLs/SRI fields remain declarations. No URL was contacted, SRI decoded or tarball/installed-tree digest compared. Package names, comments, repository fields and script strings are data, not instructions. No manifest, lockfile or installed artifact is changed.

## Role-Specific Candidate Decisions

This screening considers **seven concrete candidate-entry/role combinations**, below the approved limit of 12. Unidentified runtime families and empty role placeholders are not fabricated as additional identified candidates. `SOURCE_BOUND` describes only the local files above; the decision column describes role suitability, not authenticity.

| ID | Candidate / Role | Source Evidence And Initializer Boundary | Decision / Missing Evidence |
|---|---|---|---|
| C01 | ip-address 10.7.4 / address syntax and subnet arithmetic | F08:27-34 requires/re-exports modules and installs getters. F09:31/580-601 constructs range objects at module evaluation; its constructor calls parse at F09:69-87. F10:1443-1460 likewise constructs IPv6 ranges | `STATIC_GAPS`; retain for M2a-2 consideration only. Top-level parsing/allocation is not inert. Unlisted edge E01, policy semantics, work/heap, actual loader and acceptance remain unqualified |
| C02 | ipaddr.js 1.9.1 / drop-in strict DNS-address/policy gate | F17:1-12/673 executes its wrapper; F17:98-107 constructs range objects. F17:154-190 explicitly supports non-decimal/long IPv4 forms; F17:663-669 normalizes mapped IPv6 through process | `REJECTED_FOR_ROLE` as that drop-in gate. General parsing accepts syntax broader than a strict canonical DNS-address boundary. F17:490-496 has a narrower IPv4 predicate, but selecting an adapter/other API is not approved or qualified here; no claim that the library is unsafe for other uses |
| C03 | body-parser 2.4.0 JSON type / strict metadata decoder | F19:15 invokes the debug factory during evaluation; F19:16-17 references unread middleware helpers. F19:76-100 accepts empty text as an object, permits array roots and calls JSON.parse with reviver | `REJECTED_FOR_ROLE`; this is not pre-collapse duplicate-key detection or the required root/lexical/memory boundary. Middleware charset/read behavior behind unlisted edges is not investigated |
| C04 | AJV 8.20.0 internal JTD compiler / strict metadata decoder | F21:3-13 has eleven unread require edges. F21:24-66 creates and invokes generated functions when compileParser is called; F21:68 also calls a code-generator helper during module evaluation | `REJECTED_FOR_ROLE` under the no-code-generation/current decoder boundary. The generated-function call is deferred, not falsely claimed to run merely on import; transitive initializers remain unknown. No assertion about arbitrary precompiled AJV output or general schema-validation suitability |
| C05 | isolated TypeScript test wrapper / strict metadata decoder | F04:1 imports node:vm; calling its function creates a context, evaluates supplied compiler source and exposes a restricted JavaScript AST surface (F04:4-39) | `REJECTED_FOR_ROLE`; no metadata-decoder API or source/lexical qualification is established. Its prior test use does not authorize a different parser call; no compiler source was opened in this slice |
| C06 | unsignedControllerData.decode / public metadata decoder | F05:1-8/53-62 imports crypto/Zod and builds schemas at module evaluation. F05:44-47 calls JSON.parse and then compares canonical line encoding when decode is called | `REJECTED_FOR_ROLE`; internal canonical-record format is not arbitrary public metadata grammar. Post-parse copying/canonical checks are not a bounded pre-allocation duplicate-aware parser. F05's data-only schema function is a different API, not a loophole |
| C07 | boundedResponse / M transport boundary | F03:16-24 permits missing response URL and compares only protocol/host. F03:27-60 retains/reassembles chunks or uses whole-buffer fallbacks; F03:65-66 decodes without a fatal-UTF-8 option | `REJECTED_FOR_ROLE`; not an owned DNS/peer/TLS/header/completion/settlement boundary. These are function-call effects visible in source, not effects claimed to run during inspection |

F06 is supporting evidence, not a real producer candidate: F06:11 names nine nullable profile roles; F06:39-55 accepts synthetic summaries and a supplied approval description; F06:422-427 returns explicit real-authority denials. Hash binding/replay checks (F06:366-408) do not create an approval authenticator. Existing M1 code and seals are unchanged.

### Address Policy Observations, Not Policy Adoption

F09:112-122 visibly checks leading-zero syntax and its IPv4 pattern, while F09:69-77 accepts optional subnet notation. F10:124-161 accepts/handles subnet and zone syntax before parsing. These are source observations, not executed input tests or permission to accept those forms in M.

F12:23-50 has **26 literal IPv4 special-purpose rows**; F13:104-130 has **25 IPv6 rows**. Table/source hashes are bound in F12/F13, but the comment's IANA corpus/generation assertion is unverified: no corpus, upstream registry, generation script or current policy snapshot was inspected. F11:62-73 ignores null reachability rows, chooses a longest matching non-null entry and returns true if none matches. That default and prefix precedence are facts to reconcile with M's policy, not adopted behavior.

F10:1120-1145 detects mapped/NAT64 well-known addresses through embedded IPv4, and F10:1285-1291 delegates its global check to the embedded address when present. This can intentionally classify some mapped/translated forms by the IPv4 semantics. It does not by itself establish M's stricter answer/peer normalization rules. The parent's prohibition on private/special-range and mapped-address bypasses remains unchanged. No DNS answer, actual peer, TLS name or real route was observed.

## Unlisted And Unqualified References

The following are source-text reference locators, not permission to resolve/read them. A text-only locator pass identified 35 import/require occurrences in the approved bodies; these are not an AST-derived edge/completeness count. The list below groups important visible gaps, not a mechanically complete transitive graph. Exact future paths would need their own manifest approval.

| Edge Group | Locator Within Approved Source | Unread Or Unqualified Target / Consequence |
|---|---|---|
| E01 | F10:34, `./v6/regular-expressions` | Prospective relative artifact `node_modules/ip-address/dist/v6/regular-expressions.js`; existence, bytes, further edges and initializer not probed. Importing even an apparently unused named helper could initialize it |
| E02 | F19:15-17, `debug`, `../read`, `../utils` | All outside the 21-file manifest. No root index, charset/read helper, logger setup or dependency tree was followed |
| E03 | F21:3-13 | `./types`, `..`, `../codegen`, `../ref_error`, `../names`, `../../vocabularies/code`, `../../vocabularies/jtd/ref`, `../../vocabularies/jtd/type`, `../../runtime/parseJson`, `../util`, `../../runtime/timestamp` remain unread; no generated parser/runtime closure claim |
| E04 | F04:1 and its supplied-source parameter; F05:1-2; F06:1-2 | node:vm, node:crypto, Zod and externally supplied compiler source are not qualified by these wrapper files. F06's direct data-helper edge is F05, but other initialization is still unqualified |
| E05 | F07:22-29/59-61, F16:15-21/28-34, F18:16-37, F20:5/13-33/61-65 | Metadata entry/type/repository/dependency/script locators do not authorize package resolution, running lifecycle hooks, reading declarations/source maps or fetching a repository |
| E06 | F01:15-29/44-91/93-114 | CLI/build/native/test paths and Node version range do not identify a trusted binary, builtin/native closure, bootstrap, CA source, resolver or clean environment |

The approved ip-address file references already in F08-F15 were read only as those exact files, not through require/require.resolve. A hash for that partial subset is not a package-layout or closure-completeness proof. No installed package is certified free of hidden or lazy effects.

## Nine Required Role Gaps

These are the nine F06:11 roles, with no omissions or substitution of one role for another.

| Role | Result | Evidence / Missing Criterion |
|---|---|---|
| runtime | `UNAVAILABLE_SOURCE` | F01:93-95 is only a range. Exact executable/source/build/native/platform identity unavailable; no live-runtime probe or binary read |
| bootstrap | `STATIC_GAPS` | C01/C03/C04 show module-initialization work; E01-E06 and native/loader/lazy paths remain incomplete. Guard-after-import is not accepted as evidence |
| transport | `STATIC_GAPS` | C07 is rejected for this role; proposed Node HTTP/1.1 family has no exact source/runtime/owner. DNS, raw-header hard refusal, abort/settlement, retries and wire facts unverified |
| address | `STATIC_GAPS` | C01 retained only for later source review; C02 not a drop-in gate. Exact approved policy snapshot, mapped/zone/transition rules, source closure and peer binding absent |
| tls | `UNAVAILABLE_SOURCE` | Runtime-bound trust-store/hostname/chain/SNI/proxy/native evidence absent; no CA/keychain/certificate probe or signature operation |
| decoder | `REQUIRES_SEPARATE_APPROVAL` | C03-C06 rejected for this use. No existing duplicate-aware bounded public JSON decoder identified inside the authorized manifest; do not substitute the target stream packages or write a lexer |
| clock | `UNAVAILABLE_SOURCE` | No actual monotonic producer/domain, timer lifecycle or teardown evidence. F04's synthetic zero clock and M1 supplied times are not such evidence |
| environment | `STATIC_GAPS` | F01 lifecycle scripts are only data. No constructed launch manifest or qualified preloading/proxy/CA/dynamic-loader envelope; no live values or credential/config files read |
| authorization | `UNAVAILABLE_SOURCE` | F05 digest/descriptor and F06 supplied approval checks are not a trusted approval producer or durable replay registry; no key, token or authority was created |

Overall result: **STATIC_GAPS / no executable bundle**. Source identities are observations only; actual execution, parser/network availability, authenticated approval, verified timestamps, runtime/heap/TLS qualification, package bytes and publisher identity remain unproved and ungranted. No values are written into M1 profiles and no real observations are relabeled synthetic.

## Scope And Work Ledger

The per-file manifest includes exactly 21 files, under the 32-file first-slice cap and 16 MiB/file / 32 MiB distinct-source limits. The retained result is this Markdown report plus small design/BACKLOG summaries, not raw source or a new operational journal.

Content inspections use a deliberately conservative source charge of **eight whole-manifest byte passes per successful snapshot/read-display cycle**, reserving read/hash/text/display/copy/review work; unused reservation is not refunded. This is a logical audit charge, not a measurement of tool CPU, RSS, hidden copies or OS activity; complete internal/elapsed/heap costs remain unknown. File metadata checks, the trusted Git/control-document checker and the separate integrity-only protected-file comparison are not additional candidate investigation or evidence that their tools are execution-qualified.

The current audit series starts with this explicitly approved M2a-1 request. Historical design/commit-review statements are planning provenance, not fresh source qualifications or an elapsed-time/capacity token. Later M2a slices must retain this report's counts as known audit work rather than silently reset them. No future read, extra path, parser test, fresh process or connection is authorized by remaining numerical capacity.

Final source revalidation after drafting the report matches the starting source-set and complete identity-snapshot digests. Six successful source snapshot/read-display cycles returned **1519680 source bytes**. The two separate protected-file integrity comparisons also read F01-F06, adding **207508 known candidate-file bytes**; those repeated bytes are charged again, not silently excluded by their verification purpose. Known candidate-file read bytes total **1727188**, and the conservative eight-pass source charge is **13817504 bytes**, below the 67108864-byte first-slice processed limit. Other protected-file checksum reads are integrity-only control verification, not an extension of the candidate-source investigation. Complete tool-internal costs remain unknown. No candidate source read failed and no scope/budget fallback was used. These are the current slice's known counts to carry forward, not authority to reset a later ledger. Final report-size, control-document and Git-scope checks are recorded below after verification.

## Next Decision And Stops

M2a-1 ends here. The strict decoder is a mandatory unresolved role, so no transition to an executable bundle, M2b activation, M2c parsing or M3 acquisition occurs. Additional address closure alone would not resolve that decoder or bootstrap/authorization gap.

A later request may authorize an exact additional local source manifest for M2a-2, including a specifically reviewed E01 path, or ask for a separate decoder/tool investigation design. This report neither chooses a new decoder from the network nor authorizes acquisition/addition. A new import or making a transitive library a direct dependency remains a separate decision.

Dot remains PAUSED. Judgment, notification, mail, retention and all existing M1/runtime bounds and seals are unchanged. The initial inventory phase performed no dependency acquisition/addition, candidate/JSON/IP/AST execution, real port/clock/timer, build, child/worker, addon/native-store read, fixture, signing, actual data operation, MCP registration, activation, commit or push. The user subsequently requested independent review and a local commit after a clean result, as recorded below; this does not broaden any operational permission.

## Final Verification

The report manifest matches all 21 captured file identities/content hashes; cited line numbers are within their snapshot files. Seven candidate-role rows and all nine required profile-role rows are present. The report is below the 262144-byte retained-report limit and passes ASCII, trailing-whitespace and final-newline checks. Across this report, the design and BACKLOG, 175 local file links and 130 heading anchors resolve; one unchanged historical non-file statistical expression is excluded. Tracked diff whitespace checks pass.

The separate before/after integrity-only comparison of 561 protected repository files is unchanged at aggregate SHA-256 `8f048a26b4be1965ed1219a8ebb241faba0e846e3cbcf7cf1abafe5b56a36c96`. Dot is still PAUSED with full-configuration SHA-256 `b72799629f5b8269efc7d5eb4ac85cebc91a7fb13e8ee98996e96add6dd488b1`. Git scope is exactly this new report, its M2a design and BACKLOG. Checks were source/document inspections, not a test suite, candidate initializer or runtime qualification. At this initial inventory checkpoint, no commit, push or independent review had been performed; the following section records the later review rather than rewriting that history.

## Independent Review And Commit Boundary

Two read-only reviewers independently checked the report against the approved scope. Reviewer A compared candidate behavior/entry declarations, initializer versus call-time effects, IP tables/normalization and visible unlisted references with F01-F21. Reviewer B checked document provenance, the scope/permission stops, seven candidate rows, nine role gaps and ledger arithmetic. Both reported **no findings requiring correction**. This is a review of limited source evidence, not a security/runtime/closure qualification or a reason to relax the decoder stop.

Initial-round review commands were read-only Git and text-inspection commands, with the required bdo prefix and the Downloads workspace explicitly selected. A reported 13 commands: Git status/revision/diff checks, control-document/skill reads and six builtin-only Node inspection commands (four candidate text reads and two control-document reads). The first Git status emitted an fsmonitor warning; subsequent Git checks explicitly disabled fsmonitor. B reported 17 commands: seven Git checks and ten control-document wc/nl/sed/awk inspections; its first awk count included the identity table and was corrected to count manifest rows only. Neither reviewer changed files, fetched data, parsed/evaluated candidate bodies, imported candidates, ran tests/builds, created fixtures or invoked operational tools.

B then reviewed the documentation-only review/ledger/commit-boundary additions and again reported no findings. That follow-up used seven bdo-prefixed commands: four Git checks, report nl/wc and an input-file-free awk arithmetic check; candidate-source reads remained zero. The parent's final document checks resolve 177 local links and 132 heading anchors and confirm the 21-file manifest, seven candidate rows, nine role rows, valid cited line ranges, ASCII/whitespace/newline rules and the report-size limit. This is not a parser acceptance test or a runtime qualification.

The parent revalidated the exact 21-file content/identity snapshot at review start and finish, and separately repeated the protected-file/config comparison. Both snapshot digests above and the protected/config digests remain unchanged. Source identities remain local observations, not evidence that no transient change ever occurred or a race-free future loader guarantee.

### Carried Review Ledger

Initial counts above are retained, not reset. Candidate rereads are charged again; B's control-document reads do not pretend to be candidate reads. Each reviewer had an explicit reservation of at most two reads per approved file (506560 source bytes / 4052480 logical charge), with no additional path permission. Actual counts and reserved ceilings are not conflated:

| Phase / Actor | Known Candidate-File Read Bytes | Eight-Pass Logical Charge | Basis |
|---|---:|---:|---|
| Initial inventory, retained | 1727188 | 13817504 | Six complete snapshots plus two integrity-overlap reads, as above |
| Parent review verification | 714068 | 5712544 | Two complete snapshots, 506560 bytes; two integrity comparisons of F01-F06, 207508 bytes |
| Reviewer A | 313505 | 2508040 | F01-F21 once, plus F10 once more; at most two reads/file |
| Reviewer B | 0 | 0 | Control documents/Git only; no candidate-source read |
| Cumulative known total | 2754761 | 22038088 | No reset or deduplication of repeated source reads |

Including both reviewers' full reserved ceilings rather than only actual usage gives a conservative cumulative source-charge allocation of **27635008 bytes**, still below 67108864. Unused review reservations do not grant another operation, a refund-based retry or borrowing for another role. Complete inspection-tool internal/elapsed/heap costs remain unknown. Future slices must carry the known totals and these reservation/provenance limits, not promote this report into an executable capacity token.

Only this report, the M2a design and BACKLOG are in the authorized local commit. Commit hooks, signing and automatic Git maintenance are disabled; Git filters/working-tree encodings are checked for these paths before staging. The local commit is a separately authorized administrative action, not a candidate/tool execution, acquisition or activation. The actual commit ID belongs to Git history and the chat after success; this document does not predict it. No push is authorized or performed. All existing M1/B1/B2-A seals, limits and judgment/notification rules remain unchanged, and M2a-2/new paths/decoder decisions/M2b/M2c/M3+ still require their own approval.
