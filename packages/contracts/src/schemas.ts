import { z } from "zod"

import { PUBLIC_GUIDE_MAX_WINDOW_MS, SUBSCRIPTION_FORMATS } from "./domain.js"

const nonEmpty = z.string().trim().min(1)
const nullableUrl = z.url().nullable().optional()

export const idParamsSchema = z.object({ id: z.uuid() })

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().trim().max(200).optional(),
})

export const logsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
})

export const publicGuideQuerySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  })
  .superRefine((value, context) => {
    const from = Date.parse(value.from)
    const to = Date.parse(value.to)
    if (to <= from) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "must be later than from",
      })
      return
    }
    if (to - from > PUBLIC_GUIDE_MAX_WINDOW_MS) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "window must not exceed 48 hours",
      })
    }
  })

export const authLoginSchema = z.object({
  password: z.string().min(1).max(512),
})

export const subscriptionSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url"),
    url: z.url(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
  z.object({ kind: z.literal("file"), path: nonEmpty }),
  z.object({ kind: z.literal("inline"), content: z.string().min(1) }),
  z.object({
    kind: z.literal("xtream"),
    baseUrl: z.url(),
    username: nonEmpty,
    password: nonEmpty,
  }),
])

export const createSubscriptionSchema = z.object({
  name: nonEmpty.max(120),
  format: z.enum(SUBSCRIPTION_FORMATS),
  source: subscriptionSourceSchema,
  epgUrl: z.url().nullable().optional(),
  enabled: z.boolean().default(true),
  refreshIntervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(43_200)
    .nullable()
    .default(60),
  importNow: z.boolean().default(true),
})

export const updateSubscriptionSchema = z.object({
  name: nonEmpty.max(120).optional(),
  enabled: z.boolean().optional(),
  refreshIntervalMinutes: z
    .number()
    .int()
    .min(5)
    .max(43_200)
    .nullable()
    .optional(),
  source: subscriptionSourceSchema.optional(),
  epgUrl: z.url().nullable().optional(),
})

export const importSubscriptionSchema = z.object({
  confirmSnapshotShrink: z.boolean().default(false),
})

export const updateChannelSchema = z.object({
  name: nonEmpty.max(240).optional(),
  epgId: z.string().trim().max(240).nullable().optional(),
  groupName: z.string().trim().max(240).nullable().optional(),
  logoUrl: nullableUrl,
  language: z.string().trim().max(40).nullable().optional(),
  country: z.string().trim().max(40).nullable().optional(),
  enabled: z.boolean().optional(),
})

const virtualSourceFields = {
  name: nonEmpty.max(240),
  epgId: z.string().trim().max(240).nullable().optional(),
  groupName: z.string().trim().max(240).nullable().optional(),
  logoUrl: nullableUrl,
  enabled: z.boolean().optional(),
}

export const createVirtualSourceSchema = z.object({
  ...virtualSourceFields,
  sourceIds: z.array(z.uuid()).min(2).max(10_000),
})

export const updateVirtualSourceSchema = z
  .object(virtualSourceFields)
  .partial()
  .extend({
    sourceIds: z.array(z.uuid()).min(1).max(10_000).optional(),
  })

export const createChannelSourceSchema = z.object({
  subscriptionId: z.uuid().optional(),
  displayName: nonEmpty.max(240),
  streamUrl: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  priority: z.number().int().min(0).max(10_000).default(100),
  active: z.boolean().default(true),
})

export const updateChannelSourceSchema = createChannelSourceSchema
  .omit({ subscriptionId: true })
  .partial()

export const createOutputSchema = z.object({
  name: nonEmpty.max(120),
  enabled: z.boolean().default(true),
  sourceStrategy: z.enum(["best", "priority", "random"]).default("best"),
  includeEpg: z.boolean().default(true),
  channelIds: z.array(z.uuid()).max(100_000).default([]),
})

export const outputChannelInputSchema = z.object({
  channelId: z.uuid(),
  position: z.number().int().min(0).max(100_000).optional(),
  customName: z.string().trim().max(240).nullable().optional(),
  customGroup: z.string().trim().max(240).nullable().optional(),
  enabled: z.boolean().default(true),
})

export const updateOutputSchema = createOutputSchema
  .omit({ channelIds: true })
  .partial()
  .extend({
    channelIds: z.array(z.uuid()).max(100_000).optional(),
    channels: z.array(outputChannelInputSchema).max(100_000).optional(),
  })

export const healthRunSchema = z.object({
  sourceIds: z.array(z.uuid()).max(10_000).optional(),
  channelIds: z.array(z.uuid()).max(10_000).optional(),
  concurrency: z.number().int().min(1).max(50).default(4),
})

export const updateSettingSchema = z.object({
  value: z.unknown(),
})

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>
export type ImportSubscriptionInput = z.infer<typeof importSubscriptionSchema>
export type LogsQuery = z.infer<typeof logsQuerySchema>
export type PublicGuideQuery = z.infer<typeof publicGuideQuerySchema>
export type AuthLoginInput = z.infer<typeof authLoginSchema>
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>
export type CreateVirtualSourceInput = z.infer<typeof createVirtualSourceSchema>
export type UpdateVirtualSourceInput = z.infer<typeof updateVirtualSourceSchema>
export type CreateChannelSourceInput = z.infer<typeof createChannelSourceSchema>
export type UpdateChannelSourceInput = z.infer<typeof updateChannelSourceSchema>
export type CreateOutputInput = z.infer<typeof createOutputSchema>
export type OutputChannelInput = z.infer<typeof outputChannelInputSchema>
export type UpdateOutputInput = z.infer<typeof updateOutputSchema>
export type HealthRunInput = z.infer<typeof healthRunSchema>
