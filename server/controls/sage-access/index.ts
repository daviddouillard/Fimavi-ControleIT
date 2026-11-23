import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../../db/schema'
import { GraphError, type GraphClient } from '../../utils/graph'
import { sageAccessMessage, type SageClient, type SageLogin } from '../../utils/sageApi'
import { sageAccountType } from '../../../shared/sageAccounts'
import { managerOf } from '../sharepoint-external/authors'
import { CollectionStopped, type CollectionContext, type ControlLine, type ControlModule } from '../types'

export interface SageAccessDeps {
  /** Client de l'API Sage (A3SreportingSage) ; lève une erreur si elle n'est pas configurée. */
  sage: () => SageClient
  /** Graph du tenant principal (annuaire et groupes Entra donnant accès à Sage). */
  graph: () => GraphClient
  homeTenant: string
  /** Groupes Entra (noms) qui donnent accès aux fonctions Sage. */
  groups: string[]
}

/** Écart signalé : compte Sage d'une personne qui n'est dans aucun des groupes Entra Sage. */
export const NO_GROUP_ANOMALY = 'Compte Sage sans groupe Entra'

const directoryUserSchema = z.object({
  id: z.string(),
  displayName: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
  onPremisesSamAccountName: z.string().nullish(),
  accountEnabled: z.boolean().nullish()
}).loose()
export type DirectoryUser = z.infer<typeof directoryUserSchema>

const groupSchema = z.object({ value: z.array(z.object({ id: z.string() }).loose()) }).loose()

/** Liste les groupes configurés : noms séparés par des virgules, sans doublon. */
export function parseSageGroups(raw: string): string[] {
  return [...new Set(raw.split(',').map(g => g.trim()).filter(Boolean))]
}

/** Index de l'annuaire : identifiant Windows (sAMAccountName), puis début de l'UPN, en minuscules. */
export function indexDirectory(directory: DirectoryUser[]) {
  const bySam = new Map<string, DirectoryUser>()
  const byUpnPrefix = new Map<string, DirectoryUser>()
  for (const u of directory) {
    if (u.onPremisesSamAccountName) bySam.set(u.onPremisesSamAccountName.toLowerCase(), u)
    const prefix = u.userPrincipalName?.split('@')[0]?.toLowerCase()
    if (prefix && !byUpnPrefix.has(prefix)) byUpnPrefix.set(prefix, u)
  }
  return (adAccount: string | null | undefined) => {
    const key = adAccount?.trim().toLowerCase()
    if (!key) return undefined
    // « DOMAINE\compte » ou « compte@domaine » : seule la partie compte compte.
    const account = key.includes('\\') ? key.split('\\').pop()! : key.split('@')[0]!
    return bySam.get(account) ?? byUpnPrefix.get(account)
  }
}

export interface SagePerson {
  user?: DirectoryUser
  /** Groupes Entra Sage de la personne ; undefined si les groupes n'ont pas pu être lus. */
  groups?: string[]
  validator?: { id: string, displayName: string }
}

/** Une ligne par compte Sage et par dossier : « telle personne a accès à tel dossier avec tel compte ». */
export function sageLine(login: SageLogin, person: SagePerson): ControlLine {
  const dossier = login.IntituleDossier?.trim() || (login.site != null ? `Dossier ${login.site}` : 'Dossier inconnu')
  const sageLogin = login.PR_Nom?.trim() ?? ''
  const adAccount = login.id_ad?.trim() ?? ''
  const name = person.user?.displayName || adAccount || sageLogin || 'Compte inconnu'
  const data: Record<string, string> = { sageDossier: dossier, personName: name }
  if (login.site != null && String(login.site).trim()) data.sageSite = String(login.site).trim()
  if (sageLogin) data.sageLogin = sageLogin
  data.sageAccountType = sageAccountType(sageLogin).label
  if (adAccount) data.adAccount = adAccount
  if (person.user?.userPrincipalName) data.personUpn = person.user.userPrincipalName
  if (person.groups) {
    data.entraGroups = person.groups.length ? person.groups.join(', ') : 'Aucun'
    if (!person.groups.length) data.anomaly = NO_GROUP_ANOMALY
  }
  if (person.validator) {
    data.suggestedValidatorId = person.validator.id
    data.suggestedValidatorName = person.validator.displayName
  }
  return {
    dedupKey: `sage|${dossier.toLowerCase()}|${sageLogin.toLowerCase()}|${adAccount.toLowerCase()}`,
    label: `${name} — ${dossier}`,
    data
  }
}

/** Rang dans une société : écarts d'abord, puis comptes à privilèges, puis comptes classiques. */
const rank = (line: ControlLine) => line.data.anomaly ? 0 : sageAccountType(line.data.sageLogin).privileged ? 1 : 2

/** Par société (dossier Sage), puis écarts, comptes à privilèges et autres, puis par personne. */
export function bySociety(a: ControlLine, b: ControlLine): number {
  return a.data.sageDossier!.localeCompare(b.data.sageDossier!, 'fr')
    || rank(a) - rank(b)
    || a.data.personName!.localeCompare(b.data.personName!, 'fr')
}

async function readDirectory(graph: GraphClient): Promise<DirectoryUser[]> {
  const all: DirectoryUser[] = []
  for await (const page of graph.list('users?$select=id,displayName,userPrincipalName,onPremisesSamAccountName,accountEnabled&$top=999')) {
    all.push(...z.array(directoryUserSchema).parse(page))
  }
  return all
}

/** Membres (utilisateurs, sous-groupes compris) d'un groupe désigné par son nom exact. */
export async function readGroupMembers(graph: GraphClient, name: string): Promise<string[]> {
  const filter = encodeURIComponent(`displayName eq '${name.replace(/'/g, '\'\'')}'`)
  const { value } = groupSchema.parse(await graph.get(`groups?$filter=${filter}&$select=id`))
  if (value.length !== 1) throw new GraphError(404, value.length ? `Plusieurs groupes Entra s'appellent « ${name} »` : `Groupe Entra « ${name} » introuvable`)
  const ids: string[] = []
  for await (const page of graph.list(`groups/${value[0]!.id}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`)) {
    ids.push(...z.array(z.object({ id: z.string() }).loose()).parse(page).map(u => u.id))
  }
  return ids
}

export function groupErrorMessage(error: unknown): string {
  if (error instanceof GraphError && (error.status === 401 || error.status === 403)) {
    return 'Membres du groupe illisibles : accorder la permission Graph GroupMember.Read.All (application) avec consentement administrateur.'
  }
  return error instanceof Error ? error.message : 'erreur inconnue'
}

/**
 * Accès Sage : comptes Sage par personne et par dossier (API A3SreportingSage), rapprochés de l'annuaire Entra
 * par l'identifiant Windows, avec les groupes Entra Sage de la personne. Lecture seule.
 */
export function sageAccessModule(deps: SageAccessDeps): ControlModule {
  return {
    async collect(ctx: CollectionContext) {
      const sitesTotal = 2 + deps.groups.length
      let sitesDone = 0
      const step = async (site: string) => ctx.progress({ site, sitesDone: sitesDone++, sitesTotal })

      await step('Sage — comptes par dossier')
      let logins: SageLogin[]
      try {
        logins = await deps.sage().listLogins()
      } catch (error) {
        if (error instanceof CollectionStopped) throw error
        await ctx.siteError('API Sage', sageAccessMessage(error))
        await ctx.progress({ sitesDone: sitesTotal, sitesTotal })
        return
      }

      const graph = deps.graph()
      await step('Entra — annuaire')
      let find: ReturnType<typeof indexDirectory> = () => undefined
      try {
        find = indexDirectory(await readDirectory(graph))
      } catch (error) {
        if (error instanceof CollectionStopped) throw error
        await ctx.siteError('Annuaire Entra', error instanceof Error ? error.message : 'erreur inconnue')
      }

      // Groupes de chaque personne ; si un groupe est illisible, aucun écart n'est signalé (il serait faux).
      const groupsOf = new Map<string, string[]>()
      let groupsRead = true
      for (const name of deps.groups) {
        await step(`Entra — groupe ${name}`)
        try {
          for (const id of await readGroupMembers(graph, name)) groupsOf.set(id, [...(groupsOf.get(id) ?? []), name])
        } catch (error) {
          if (error instanceof CollectionStopped) throw error
          groupsRead = false
          await ctx.siteError(`Groupe Entra ${name}`, groupErrorMessage(error))
        }
      }

      // N+1 de chaque personne retrouvée, proposé comme valideur s'il est dans l'annuaire synchronisé.
      const managerOfUser = new Map<string, string | null>()
      for (const login of logins) {
        const user = find(login.id_ad)
        if (!user || managerOfUser.has(user.id)) continue
        managerOfUser.set(user.id, (await managerOf(graph, user.id).catch(() => null))?.entraId ?? null)
      }
      const managerIds = [...new Set([...managerOfUser.values()].filter((id): id is string => !!id))]
      const validators = managerIds.length
        ? await ctx.db.select({ id: users.id, entraId: users.entraId, displayName: users.displayName }).from(users)
            .where(and(eq(users.tenantId, deps.homeTenant), inArray(users.entraId, managerIds), eq(users.accountEnabled, true)))
        : []
      const validatorByEntraId = new Map(validators.map(v => [v.entraId, { id: v.id, displayName: v.displayName }]))

      const lines = logins.map((login) => {
        const user = find(login.id_ad)
        const managerId = user ? managerOfUser.get(user.id) : null
        const person: SagePerson = {
          user,
          // Personne introuvable dans Entra : elle n'est dans aucun groupe.
          groups: groupsRead ? (user ? groupsOf.get(user.id) ?? [] : []) : undefined,
          validator: managerId ? validatorByEntraId.get(managerId) : undefined
        }
        return sageLine(login, person)
      })
      lines.sort(bySociety)
      await ctx.addLines(lines)
      await ctx.progress({ sitesDone: sitesTotal, sitesTotal, accountsTotal: lines.length })
    }
  }
}
