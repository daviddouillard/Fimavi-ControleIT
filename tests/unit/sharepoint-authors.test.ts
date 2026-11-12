import { describe, expect, it } from 'vitest'
import {
  AuditUnavailable, fetchSharingEvents, indexByObject, managerOf, matchAuthor, normalizeObjectUrl,
  SHARING_OPERATIONS, startSharingAuditQuery, waitForAuditQuery, type SharingEvent
} from '../../server/controls/sharepoint-external/authors'
import { GraphError, type GraphClient } from '../../server/utils/graph'

function graphStub(overrides: Partial<GraphClient>): GraphClient {
  return {
    get: async () => { throw new Error('get inattendu') },
    async* list() { yield [] },
    post: async () => { throw new Error('post inattendu') },
    ...overrides
  }
}

const event = (e: Partial<SharingEvent>): SharingEvent => ({
  objectUrl: normalizeObjectUrl('https://fimavi.sharepoint.com/sites/TSI/Shared Documents/Clients/Devis.xlsx'),
  operation: 'SecureLinkCreated',
  author: 'jean@fimavi.com',
  createdAt: '2026-10-01T10:00:00Z',
  text: '',
  ...e
})

describe('auteur des partages (journal d\'audit)', () => {
  it('compare les adresses Graph et audit sans tenir compte de l\'encodage, de la casse ni du « / » final', () => {
    expect(normalizeObjectUrl('https://fimavi.sharepoint.com/sites/TSI/Shared%20Documents/Clients/'))
      .toBe(normalizeObjectUrl('https://fimavi.sharepoint.com/sites/tsi/Shared Documents/Clients'))
    expect(normalizeObjectUrl('https://x.sharepoint.com/a/100%')).toBe('https://x.sharepoint.com/a/100%')
  })

  it('lance une requête sur 180 jours limitée aux créations de partage', async () => {
    let body: Record<string, unknown> = {}
    const id = await startSharingAuditQuery(graphStub({
      post: async (path, b) => {
        expect(path).toBe('security/auditLog/queries')
        body = b as Record<string, unknown>
        return { id: 'q1', status: 'notStarted' }
      }
    }), new Date('2026-11-12T00:00:00Z'))
    expect(id).toBe('q1')
    expect(body.operationFilters).toEqual([...SHARING_OPERATIONS])
    expect(body.filterStartDateTime).toBe('2026-05-16T00:00:00.000Z')
  })

  it('signale clairement une permission d\'audit manquante', async () => {
    await expect(startSharingAuditQuery(graphStub({ post: async () => { throw new GraphError(403, 'refusé') } })))
      .rejects.toBeInstanceOf(AuditUnavailable)
  })

  it('attend la fin de la requête en donnant signe de vie, et échoue si elle échoue', async () => {
    const statuses = ['notStarted', 'running', 'succeeded']
    let waits = 0
    await waitForAuditQuery(graphStub({ get: async () => ({ id: 'q1', status: statuses.shift() }) }), 'q1', {
      onWait: async () => { waits++ }, sleep: async () => {}
    })
    expect(waits).toBe(2)
    await expect(waitForAuditQuery(graphStub({ get: async () => ({ id: 'q1', status: 'failed' }) }), 'q1', { sleep: async () => {} }))
      .rejects.toThrow('en échec')
  })

  it('lit les événements (toutes les pages) et ignore ceux sans élément ni auteur', async () => {
    const events = await fetchSharingEvents(graphStub({
      async* list(path) {
        expect(path).toBe('security/auditLog/queries/q1/records')
        yield [{ objectId: 'https://fimavi.sharepoint.com/sites/TSI/Doc.docx', operation: 'AnonymousLinkCreated', userPrincipalName: 'Jean@Fimavi.com', createdDateTime: '2026-10-01T10:00:00Z' }]
        yield [{ operation: 'SharingSet', userPrincipalName: 'x@fimavi.com' }, { objectId: 'https://a', operation: 'SharingSet' }]
      }
    }), 'q1')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ author: 'jean@fimavi.com', operation: 'AnonymousLinkCreated', objectUrl: 'https://fimavi.sharepoint.com/sites/tsi/doc.docx' })
  })

  it('retient l\'événement qui désigne le bénéficiaire, sinon le plus ancien partage de l\'élément (probable)', () => {
    const url = 'https://fimavi.sharepoint.com/sites/TSI/Shared%20Documents/Clients/Devis.xlsx'
    const index = indexByObject([
      event({ author: 'paul@fimavi.com', createdAt: '2026-09-01T00:00:00Z', operation: 'SharingSet', text: 'autre@client.fr' }),
      event({ author: 'jean@fimavi.com', createdAt: '2026-10-01T00:00:00Z', text: '{"targetuserorgroupname":"invite@client.fr"}' }),
      event({ author: 'luc@fimavi.com', createdAt: '2026-10-05T00:00:00Z', operation: 'AnonymousLinkCreated' })
    ])
    expect(matchAuthor({ objectUrl: url, beneficiaryEmail: 'Invite@Client.fr', anonymous: false }, index))
      .toEqual({ author: 'jean@fimavi.com', createdAt: '2026-10-01T00:00:00Z', certain: true })
    expect(matchAuthor({ objectUrl: url, beneficiaryEmail: '', anonymous: true }, index))
      .toMatchObject({ author: 'luc@fimavi.com', certain: true })
    expect(matchAuthor({ objectUrl: url, beneficiaryEmail: 'inconnu@ailleurs.fr', anonymous: false }, index))
      .toMatchObject({ author: 'paul@fimavi.com', certain: false })
    expect(matchAuthor({ objectUrl: 'https://fimavi.sharepoint.com/sites/TSI/Autre.docx', beneficiaryEmail: 'invite@client.fr', anonymous: false }, index))
      .toBeNull()
  })

  it('renvoie le N+1 d\'un compte, ou rien s\'il n\'en a pas', async () => {
    expect(await managerOf(graphStub({ get: async (p) => {
      expect(p).toBe('users/jean%40fimavi.com/manager?$select=id,displayName')
      return { id: 'm-1', displayName: 'Marie Manager' }
    } }), 'jean@fimavi.com')).toEqual({ entraId: 'm-1', displayName: 'Marie Manager' })
    expect(await managerOf(graphStub({ get: async () => { throw new GraphError(404, 'aucun') } }), 'x@fimavi.com')).toBeNull()
  })
})
