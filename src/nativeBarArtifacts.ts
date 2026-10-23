import { z } from "zod";
import { nativeBarHash, nativeBarId, nativeBarTimestamp } from "./nativeBarEvidence.js";

export const nativeBarReceiptSchema = z.strictObject({
  schema: z.literal("native-bar-receipt-v1"), recording_id: nativeBarId, plan_hash: nativeBarHash,
  policy_hash: nativeBarHash, payload_hash: nativeBarHash, sequence: z.number().int().positive(),
  recorded_at: nativeBarTimestamp, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partition_at: nativeBarTimestamp.optional(),
});
const pairRefSchema = z.strictObject({ recording_id: nativeBarId, sequence: z.number().int().positive(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  payload_hash: nativeBarHash, receipt_hash: nativeBarHash, bytes: z.number().int().positive(),
  recorded_at: nativeBarTimestamp.optional(), last_observed_at: nativeBarTimestamp.optional() });
export const nativeBarMaintenanceSchema = z.strictObject({ schema: z.literal("native-bar-maintenance-v1"), id: nativeBarId,
  kind: z.enum(["prune", "clock_recovery"]), created_at: nativeBarTimestamp,
  pairs: z.array(pairRefSchema).max(4096), generation: nativeBarHash,
});
