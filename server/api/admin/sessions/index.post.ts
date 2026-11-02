import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { createSessionSchema } from '../../../../shared/schemas/session'
import { controlSessions } from '../../../db/schema'
import { recordAudit } from '../../../utils/audit'
import { requireAdmin } from '../../../utils/authz'
import { useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  const admin = await requireAdmin(event)
  const input = await readValidatedBody(event, createSessionSchema)

  return useDb().transaction(async (tx) => {
    const [session] = await tx.insert(controlSessions).values({
      name: input.name,
      description: input.description,
      template: input.template,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      createdById: admin.id
    }).returning()
    await recordAudit(tx, { actorId: admin.id, action: 'session.create', entityType: 'control_session', entityId: session!.id, sessionId: session!.id, after: session }, event)
    return session!
  })
})
