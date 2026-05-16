import { z } from 'zod';
import {
  accountStatusSchema,
  isoDateTimeSchema,
  nullableIsoDateTimeSchema,
  providerIdSchema,
  schemaVersionSchema,
  usedPercentageSchema
} from './common.js';

export const quotaWindowSchema = z
  .object({
    id: z.string(),
    providerWindowName: z.string(),
    usedPercentage: usedPercentageSchema,
    resetAt: nullableIsoDateTimeSchema,
    resetInText: z.string().nullable(),
    status: accountStatusSchema,
    hint: z.string().nullable().optional()
  })
  .strict();

export const accountQuotaCardSchema = z
  .object({
    provider: providerIdSchema,
    email: z.string(),
    displayOrder: z.number().int().min(0),
    status: accountStatusSchema,
    windows: z.array(quotaWindowSchema),
    lastSuccessfulRefreshAt: nullableIsoDateTimeSchema,
    lastAttemptedRefreshAt: nullableIsoDateTimeSchema,
    stale: z.boolean(),
    errorHint: z.string().nullable().optional(),
    effectivePollIntervalSeconds: z.number().int().min(1).optional(),
    selectionRank: z.number().int().min(1).nullable().optional()
  })
  .strict();

export const latestStateSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    generatedAt: isoDateTimeSchema,
    accounts: z.array(accountQuotaCardSchema)
  })
  .strict();

export type QuotaWindowContract = z.infer<typeof quotaWindowSchema>;
export type AccountQuotaCardContract = z.infer<typeof accountQuotaCardSchema>;
export type LatestStateContract = z.infer<typeof latestStateSchema>;
