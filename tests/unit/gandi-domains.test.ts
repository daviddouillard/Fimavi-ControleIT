import { describe, expect, it } from 'vitest'
import { domainLine } from '../../server/controls/gandi-domains'
import { GANDI_ROOT, GandiError, gandiAccessMessage, gandiClient } from '../../server/utils/gandi'
import { decisionWording } from '../../shared/decisions'
import { defaultEmailSubject } from '../../shared/emails'

const page = (items: unknown[], total?: number) =>
  new Response(JSON.stringify(items), { status: 200, headers: total === undefined ? {} : { 'Total-Count': String(total) } })
const domain = (fqdn: string, extra: Record<string, unknown> = {}) => ({ fqdn, tld: fqdn.split('.').at(-1), ...extra })

describe('client Gandi (lecture seule)', () => {
  it('lit toutes les pages de domaines, jeton envoyé à la seule API Gandi', async () => {
    const calls: { url: string, init: RequestInit }[] = []
    const first = Array.from({ length: 100 }, (_, i) => domain(`d${i}.fr`))
    const responses = [page(first, 101), page([domain('dernier.com')], 101)]
    const client = gandiClient('pat_test', {
      fetch: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return responses.shift()! }) as unknown as typeof fetch
    })
    const domains = await client.listDomains()
    expect(domains).toHaveLength(101)
    expect(calls.map(c => c.url)).toEqual([`${GANDI_ROOT}domain/domains?per_page=100&page=1`, `${GANDI_ROOT}domain/domains?per_page=100&page=2`])
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'Bearer pat_test' })
  })

  it('refuse de démarrer sans jeton, et ne garde que le statut en cas de refus', async () => {
    expect(() => gandiClient('')).toThrow('Jeton Gandi non configuré')
    const client = gandiClient('pat_test', {
      fetch: (async () => new Response(JSON.stringify({ message: 'détail interne' }), { status: 403 })) as unknown as typeof fetch
    })
    const error = await client.listDomains().catch(e => e as GandiError)
    expect(error).toBeInstanceOf(GandiError)
    expect(error.message).toBe('Lecture Gandi en échec (403)')
    expect(gandiAccessMessage(error)).toContain('Jeton Gandi refusé')
  })
})

describe('modèle « Noms de domaine (Gandi) »', () => {
  it('une ligne par domaine avec échéance, renouvellement automatique et titulaire', () => {
    expect(domainLine(domain('Fimavi.com', { fqdn_unicode: 'fimavi.com', autorenew: false, domain_owner: 'FIMAVI', dates: { registry_ends_at: '2027-03-01T10:00:00Z' } }))).toEqual({
      dedupKey: 'gandi|fimavi.com',
      label: 'fimavi.com',
      data: { domain: 'fimavi.com', domainExpiresAt: '2027-03-01T10:00:00Z', autorenew: 'Désactivé', domainOwner: 'FIMAVI', tld: 'com' }
    })
  })

  it('vocabulaire propre au modèle : renouveler ou non', () => {
    expect(decisionWording('keep', 'gandi-domains').action).toBe('Renouveler le domaine')
    expect(decisionWording('remove', 'gandi-domains').state).toBe('À ne plus renouveler')
    expect(decisionWording('keep', 'sharepoint-external').action).toBe('Valider le partage')
    expect(decisionWording('remove', 'exchange-shared-mailboxes').action).toBe('Retirer l\'accès')
    expect(defaultEmailSubject('Domaines 2027', 'gandi-domains')).toBe('Contrôles IT : noms de domaine à renouveler ? — Domaines 2027')
  })
})
