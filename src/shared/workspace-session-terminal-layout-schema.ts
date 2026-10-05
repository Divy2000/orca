import { z } from 'zod'
import type { TerminalPaneLayoutNode } from './terminal-tab-types'
import { salvagedOptional, salvagingRecord } from './zod-salvage'

// ─── Terminal pane layout (recursive) ───────────────────────────────

const terminalPaneSplitDirectionSchema = z.enum(['vertical', 'horizontal'])

// Why: z.lazy + type annotation keeps the recursive inference working without
// forcing zod to resolve the whole tree at definition time. Discriminated on `type` because a
// plain union re-tries the leaf branch for every split node of every restored terminal layout.
const terminalPaneLayoutNodeSchema: z.ZodType<TerminalPaneLayoutNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('leaf'),
      leafId: z.string()
    }),
    z.object({
      type: z.literal('split'),
      direction: terminalPaneSplitDirectionSchema,
      first: terminalPaneLayoutNodeSchema,
      second: terminalPaneLayoutNodeSchema,
      ratio: z.number().optional()
    })
  ])
)

export const leafStringsSchema = salvagingRecord(z.string(), z.string())

// Why: a bad optional field only loses mobile projection detail, so it must not drop the pane's home.
const terminalLeafHomeSchema = z.object({
  worktreeId: z.string(),
  sessionTabId: z.string(),
  sessionLeafId: z.string(),
  slot: z
    .object({ groupId: z.string(), afterTabId: z.string().nullable() })
    .optional()
    .catch(undefined),
  color: z.string().optional().catch(undefined),
  isPinned: z.boolean().optional().catch(undefined)
})

export const terminalLayoutSnapshotSchema = z.object({
  root: terminalPaneLayoutNodeSchema.nullable(),
  activeLeafId: z.string().nullable(),
  expandedLeafId: z.string().nullable(),
  chatLeafId: z.string().optional(),
  ptyIdsByLeafId: salvagedOptional('ptyIdsByLeafId', leafStringsSchema),
  buffersByLeafId: salvagedOptional('buffersByLeafId', leafStringsSchema),
  scrollbackRefsByLeafId: salvagedOptional('scrollbackRefsByLeafId', leafStringsSchema),
  titlesByLeafId: salvagedOptional('titlesByLeafId', leafStringsSchema),
  homeByLeafId: salvagedOptional(
    'homeByLeafId',
    salvagingRecord(z.string(), terminalLeafHomeSchema)
  )
})
