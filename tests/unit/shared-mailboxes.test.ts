import { describe, expect, it } from 'vitest'
import { fullAccessGrants, isSystemTrustee, mailboxLine, parseSharedMailboxes, sendAsGrants, sendOnBehalfGrants } from '../../server/controls/exchange-shared-mailboxes/permissions'
import { exchangeAccessMessage } from '../../server/services/graphDiagnostics'
import { EXCHANGE_ROOT, ExchangeError, exchangeClient } from '../../server/utils/exchange'
import { TokenError } from '../../server/utils/graph'

const TENANT = '11111111-2222-3333-4444-555555555555'
const ENDPOINT = `${EXCHANGE_ROOT}${TENANT}/InvokeCommand`

describe('boîtes partagées : droits retenus', () => {
  it('ne garde que les boîtes partagées, avec leurs délégués « de la part de »', () => {
    const mailboxes = parseSharedMailboxes([
      { RecipientTypeDetails: 'SharedMailbox', PrimarySmtpAddress: 'compta@fimavi.com', DisplayName: 'Comptabilité', GrantSendOnBehalfTo: ['jean.dupont'] },
      { RecipientTypeDetails: 'UserMailbox', PrimarySmtpAddress: 'david@fimavi.com', DisplayName: 'David' },
      { RecipientTypeDetails: 'SharedMailbox', PrimarySmtpAddress: '', DisplayName: 'Sans adresse' }
    ])
    expect(mailboxes).toEqual([{ address: 'compta@fimavi.com', name: 'Comptabilité', sendOnBehalf: ['jean.dupont'] }])
  })

  it('accès total : explicite, autorisé, hors comptes système', () => {
    expect(fullAccessGrants([
      { User: 'NT AUTHORITY\\SELF', AccessRights: ['FullAccess', 'ReadPermission'], IsInherited: false, Deny: false },
      { User: 'marie@fimavi.com', AccessRights: ['FullAccess'], IsInherited: false, Deny: false },
      { User: 'herite@fimavi.com', AccessRights: ['FullAccess'], IsInherited: 'True', Deny: false },
      { User: 'refus@fimavi.com', AccessRights: ['FullAccess'], IsInherited: false, Deny: true },
      { User: 'lecture@fimavi.com', AccessRights: ['ReadPermission'], IsInherited: false, Deny: false }
    ])).toEqual([{ trustee: 'marie@fimavi.com', right: 'full' }])
  })

  it('envoyer en tant que : explicite et autorisé ; envoyer de la part de : liste de la boîte', () => {
    expect(sendAsGrants([
      { Trustee: 'NT AUTHORITY\\SELF', AccessControlType: 'Allow', AccessRights: ['SendAs'], IsInherited: false },
      { Trustee: 'paul@fimavi.com', AccessControlType: 'Allow', AccessRights: ['SendAs'], IsInherited: false },
      { Trustee: 'refus@fimavi.com', AccessControlType: 'Deny', AccessRights: ['SendAs'], IsInherited: false }
    ])).toEqual([{ trustee: 'paul@fimavi.com', right: 'sendAs' }])
    expect(sendOnBehalfGrants({ address: 'a@b.c', name: 'A', sendOnBehalf: ['Jean Dupont'] })).toEqual([{ trustee: 'Jean Dupont', right: 'sendOnBehalf' }])
    expect(isSystemTrustee('NT AUTHORITY\\SYSTEM')).toBe(true)
  })

  it('une ligne par boîte, titulaire et droit, avec le nom de l\'annuaire', () => {
    const line = mailboxLine({ tenantId: TENANT, tenantName: 'Fimavi' }, { address: 'Compta@fimavi.com', name: 'Comptabilité', sendOnBehalf: [] }, { trustee: 'Marie@fimavi.com', right: 'full' }, 'Marie Martin')
    expect(line).toEqual({
      dedupKey: `${TENANT}|compta@fimavi.com|marie@fimavi.com|full`,
      label: 'Comptabilité — Marie Martin',
      data: { tenant: 'Fimavi', mailbox: 'Compta@fimavi.com', mailboxName: 'Comptabilité', trustee: 'Marie@fimavi.com', trusteeName: 'Marie Martin', right: 'Accès total', rightKey: 'full' }
    })
  })
})

describe('client Exchange (lecture seule)', () => {
  const page = (value: unknown[], next?: string) => new Response(JSON.stringify({ value, ...(next ? { '@odata.nextLink': next } : {}) }), { status: 200 })

  it('envoie la commande au service Exchange du tenant et suit la pagination', async () => {
    const calls: { url: string, init: RequestInit }[] = []
    const responses = [page([{ a: 1 }], `${ENDPOINT}?$skiptoken=2`), page([{ a: 2 }])]
    const client = exchangeClient(TENANT, 'it@fimavi.com', {
      token: async () => 'jeton',
      fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return responses.shift()! }) as unknown as typeof fetch
    })
    expect(await client.invoke('Get-Mailbox', { RecipientTypeDetails: 'SharedMailbox' })).toEqual([{ a: 1 }, { a: 2 }])
    expect(calls.map(c => c.url)).toEqual([ENDPOINT, `${ENDPOINT}?$skiptoken=2`])
    expect(calls[0]!.init.headers).toMatchObject({ 'Authorization': 'Bearer jeton', 'X-AnchorMailbox': 'UPN:it@fimavi.com' })
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ CmdletInput: { CmdletName: 'Get-Mailbox', Parameters: { RecipientTypeDetails: 'SharedMailbox' } } })
  })

  it('refuse toute commande d\'écriture, un lien de pagination hors Exchange et un ID de tenant invalide', async () => {
    const client = exchangeClient(TENANT, undefined, {
      token: async () => 'jeton',
      fetch: (async () => page([], 'https://evil.test/steal')) as unknown as typeof fetch
    })
    await expect(client.invoke('Remove-MailboxPermission', {})).rejects.toThrow('non autorisée')
    await expect(client.invoke('Set-Mailbox', {})).rejects.toThrow('non autorisée')
    await expect(client.invoke('Get-Mailbox', {})).rejects.toThrow('URL Exchange inattendue')
    expect(() => exchangeClient('contoso.onmicrosoft.com/../x')).toThrow('ID de tenant invalide')
  })

  it('remonte le statut et le code d\'erreur, sans le détail', async () => {
    const client = exchangeClient(TENANT, undefined, {
      token: async () => 'jeton',
      fetch: (async () => new Response(JSON.stringify({ error: { code: 'Forbidden', details: [{ message: 'secret de boîte' }] } }), { status: 403 })) as unknown as typeof fetch
    })
    const error = await client.invoke('Get-Mailbox', {}).catch(e => e as ExchangeError)
    expect(error).toBeInstanceOf(ExchangeError)
    expect(error.message).toBe('Commande Exchange Get-Mailbox en échec (403, Forbidden)')
    expect(exchangeAccessMessage(error)).toContain('rôle « Lecteur général »')
    expect(exchangeAccessMessage(new TokenError(400, 'x', 'AADSTS700016'))).toContain('Jeton Exchange refusé')
  })
})
