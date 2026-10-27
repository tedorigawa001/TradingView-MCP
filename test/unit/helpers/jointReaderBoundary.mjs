import assert from "node:assert/strict";
import ts from "typescript";

export const jointReaderNamed = {
  "node:crypto": ["KeyObject", "randomUUID"], "node:process": ["hrtime"], "node:timers": ["setTimeout", "clearTimeout"], "zod": ["z"],
  "./nativeBarEvidence.js": ["canonical", "evidenceHash", "nativeBarHash", "nativeBarId", "nativeBarTimestamp"],
  "./nativeBarAdmissionReadContracts.js": ["createSyntheticAdmissionReadBootstrap", "classifySyntheticAdmissionReadEntry"],
  "./nativeBarAdmissionReader.js": ["createSyntheticAdmissionNativeReadRegistry"],
  "./nativeBarAdmissionOracleRegistry.js": ["createSyntheticJointCheckpointOracleBootstrap", "claimSyntheticJointCheckpointReader"],
  "./nativeBarAdmissionJointReadContracts.js": ["validateSyntheticAdmissionJointBinding", "validateSyntheticAdmissionJointWorkEnvelope", "planSyntheticAdmissionJointWork",
    "checkSyntheticAdmissionJointWorkUsage", "selectSyntheticAdmissionJointWitnesses", "matchSyntheticAdmissionJointRecordBytes", "matchSyntheticAdmissionJointContentBytes"],
  "./nativeBarAdmissionCheckpointContracts.js": ["checkpointProbeNoAuthority", "checkpointProbeParse", "checkpointProbeOptionsSchema", "checkpointProbeObservationSchema"],
};
export const jointReaderImports = Object.keys(jointReaderNamed);
export function assertJointReaderImports(file) {
  const modules = []; function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) modules.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) modules.push("dynamic_import"); ts.forEachChild(n, visit);
  } visit(file); assert.deepEqual(modules, jointReaderImports);
  for (const n of file.statements.filter(ts.isImportDeclaration)) {
    assert.ok(n.importClause && !n.importClause.name && n.importClause.namedBindings && ts.isNamedImports(n.importClause.namedBindings));
    assert.deepEqual(n.importClause.namedBindings.elements.map((e) => e.propertyName?.text ?? e.name.text), jointReaderNamed[n.moduleSpecifier.text]);
  }
}
