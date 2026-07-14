import { binaryCalibration } from "./calibration.js";
import { classificationMetrics } from "./evaluationMetrics.js";

export function buildWalkForwardReport(folds: Array<{ id: string; labels: Array<{ predicted: string; actual: string }>; probabilities?: Array<{ probability: number; outcome: boolean }> }>) {
  if (folds.length === 0) throw new Error("at least one fold is required");
  return { folds: folds.map((fold) => ({ id: fold.id, metrics: classificationMetrics(fold.labels), calibration: fold.probabilities ? binaryCalibration(fold.probabilities) : null })), total_folds: folds.length };
}
