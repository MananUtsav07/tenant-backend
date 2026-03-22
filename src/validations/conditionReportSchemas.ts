import { z } from 'zod'

const reportTypeEnum = z.enum(['move_in', 'move_out'])
const roomLabelEnum = z.enum(['bedroom', 'bathroom', 'kitchen', 'living_area', 'balcony', 'ac_unit', 'water_heater', 'hallway', 'storage', 'other'])
const roomRatingEnum = z.enum(['not_reviewed', 'good', 'fair', 'poor'])
const confirmationStatusEnum = z.enum(['confirmed', 'disputed'])

export const ownerCreateConditionReportSchema = z
  .object({
    report_type: reportTypeEnum,
    vacancy_campaign_id: z.string().uuid().nullable().optional(),
    trigger_reference: z.string().trim().max(240).nullable().optional(),
  })
  .strict()

export const updateConditionReportRoomSchema = z
  .object({
    condition_rating: roomRatingEnum.optional(),
    condition_notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()

export const addConditionReportMediaSchema = z
  .object({
    room_entry_id: z.string().uuid(),
    media_kind: z.enum(['photo', 'video', 'document', 'other']).optional().default('photo'),
    media_url: z.string().trim().url().nullable().optional(),
    storage_path: z.string().trim().max(500).nullable().optional(),
    mime_type: z.string().trim().max(160).nullable().optional(),
    caption: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.media_url && !value.storage_path) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media_url'],
        message: 'Provide a media URL or storage path',
      })
    }
  })

export const confirmConditionReportSchema = z
  .object({
    status: confirmationStatusEnum,
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()

export const adminAutomationConditionReportsQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(10),
  report_type: reportTypeEnum.optional(),
})

export { confirmationStatusEnum, reportTypeEnum, roomLabelEnum, roomRatingEnum }
