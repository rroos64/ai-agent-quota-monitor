import { z } from 'zod';
import {
  isoDateTimeSchema,
  providerIdSchema,
  schemaVersionSchema,
  unknownRecordSchema
} from './common.js';

export const configuredAccountSchema = z
  .object({
    id: z.string(),
    provider: providerIdSchema,
    email: z.string(),
    displayOrder: z.number().int().min(0),
    providerConfig: unknownRecordSchema.optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema
  })
  .strict();

export const appConfigSchema = z
  .object({
    schemaVersion: schemaVersionSchema,
    accounts: z.array(configuredAccountSchema),
    settings: z
      .object({
        refreshIntervalMinutes: z.number().int().min(1),
        setupCommand: z.string().optional(),
        providerPollIntervalSeconds: z
          .record(providerIdSchema, z.number().int().min(30))
          .optional(),
        providerPollMaxIntervalSeconds: z
          .record(providerIdSchema, z.number().int().min(30))
          .optional()
      })
      .strict()
  })
  .strict()
  .superRefine((config, ctx) => {
    const seenProviderEmails = new Set<string>();
    const seenAccountIds = new Set<string>();

    for (const [index, account] of config.accounts.entries()) {
      if (seenAccountIds.has(account.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accounts', index, 'id'],
          message: 'account id must be unique'
        });
      }
      seenAccountIds.add(account.id);

      const providerEmailKey = `${account.provider}:${account.email.trim().toLowerCase()}`;
      if (seenProviderEmails.has(providerEmailKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accounts', index, 'email'],
          message: 'provider and email combination must be unique'
        });
      }
      seenProviderEmails.add(providerEmailKey);
    }
  });

export type ConfiguredAccountContract = z.infer<typeof configuredAccountSchema>;
export type AppConfigContract = z.infer<typeof appConfigSchema>;
