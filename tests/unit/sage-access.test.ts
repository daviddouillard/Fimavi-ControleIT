import { describe, expect, it } from 'vitest'
import { indexDirectory, NO_GROUP_ANOMALY, parseSageGroups, sageLine } from '../../server/controls/sage-access'
import { SAGE_ACCESS_PATH, SageApiError, sageAccessMessage, sageBaseUrl, sageClient } from '../../server/utils/sageApi'
import { decisionWording } from '../../shared/decisions'
import { defaultEmailDoc, defaultEmailSubject } from '../../shared/emails'

const BASE = 'https://api.fimavi.test/A3SreportingSage'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('client de l\'API Sage (lecture seule)', () => {
  it('appelle la seule route des droits d\'accès, clé dans l\'en-tête X-API-KEY', async () => {
    const calls: { url: string, init: RequestInit }[] = []
    const client = sageClient({ url: BASE, key: 'cle_test' }, {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init })
        return json([{ ID_LOGIN_SAGE: 1, PR_Nom: 'JDUPONT', id_ad: 'jean.dupont', site: 1016, IntituleDossier: 'DOMOS' }])
      }) as unknown as typeof fetch
    })
    const logins = await client.listLogins()
    expect(logins).toHaveLength(1)
    expect(calls.map(c => c.url)).toEqual([`${BASE}/${SAGE_ACCESS_PATH}`])
    expect(calls[0]!.init.headers).toMatchObject({ 'X-API-KEY': 'cle_test' })
    expect(calls[0]!.init.redirect).toBe('error')
  })

  it('n\'accepte qu\'une adresse HTTPS sans identifiant ni paramètre', () => {
    expect(sageBaseUrl(`${BASE}/`)).toBe(`${BASE}/`)
    expect(sageBaseUrl(BASE)).toBe(`${BASE}/`)
    for (const bad of ['http://api.fimavi.test/x', 'https://user:pw@api.fimavi.test/x', 'https://api.fimavi.test/x?k=1', 'pas une url']) {
      expect(() => sageBaseUrl(bad)).toThrow(SageApiError)
    }
  })

  it('refuse de démarrer sans configuration, ne garde que le statut en cas de refus', async () => {
    expect(() => sageClient({ url: '', key: 'k' })).toThrow('API Sage non configurée')
    expect(() => sageClient({ url: BASE, key: '' })).toThrow('API Sage non configurée')
    const client = sageClient({ url: BASE, key: 'cle_test' }, { fetch: (async () => json({ detail: 'interne' }, 401)) as unknown as typeof fetch })
    const error = await client.listLogins().catch(e => e as SageApiError)
    expect(error).toBeInstanceOf(SageApiError)
    expect(error.message).not.toContain('interne')
    expect(sageAccessMessage(error)).toContain('Clé de l\'API Sage refusée')
  })

  it('serveur injoignable (IP non autorisée) : message clair, sans la clé', async () => {
    const client = sageClient({ url: BASE, key: 'cle_secrete' }, { fetch: (async () => { throw new TypeError('fetch failed cle_secrete') }) as unknown as typeof fetch })
    const error = await client.listLogins().catch(e => e as SageApiError)
    expect(sageAccessMessage(error)).toContain('injoignable')
    expect(sageAccessMessage(error)).not.toContain('cle_secrete')
  })

  it('ne lit jamais de mot de passe Sage, même si l\'API en renvoyait un', async () => {
    const client = sageClient({ url: BASE, key: 'k' }, {
      fetch: (async () => json([{ ID_LOGIN_SAGE: 1, PR_Nom: 'X', PR_Pwd: 'secret', PR_PWDCrypte: 'abc', id_ad: 'x', site: 1, IntituleDossier: 'D' }])) as unknown as typeof fetch
    })
    const [login] = await client.listLogins()
    const line = sageLine(login!, {})
    expect(JSON.stringify(line)).not.toContain('secret')
    expect(JSON.stringify(line)).not.toContain('abc')
  })
})

describe('lignes « Accès Sage »', () => {
  const login = { ID_LOGIN_SAGE: 7, PR_Nom: 'JDUPONT', id_ad: 'jean.dupont', site: 1016, IntituleDossier: 'DOMOS' }

  it('une ligne par personne et par dossier, avec ses groupes Entra et le N+1 suggéré', () => {
    const line = sageLine(login, {
      user: { id: 'u1', displayName: 'Jean Dupont', userPrincipalName: 'jean.dupont@fimavi.test' },
      groups: ['COMPTA_USER', 'GESTCOM_USER'],
      validator: { id: 'v1', displayName: 'Chef' }
    })
    expect(line).toEqual({
      dedupKey: 'sage|domos|jdupont|jean.dupont',
      label: 'Jean Dupont — DOMOS',
      data: {
        sageDossier: 'DOMOS',
        sageSite: '1016',
        sageLogin: 'JDUPONT',
        adAccount: 'jean.dupont',
        personName: 'Jean Dupont',
        personUpn: 'jean.dupont@fimavi.test',
        entraGroups: 'COMPTA_USER, GESTCOM_USER',
        suggestedValidatorId: 'v1',
        suggestedValidatorName: 'Chef'
      }
    })
  })

  it('signale un compte Sage dont la personne n\'est dans aucun groupe', () => {
    expect(sageLine(login, { groups: [] }).data).toMatchObject({ entraGroups: 'Aucun', anomaly: NO_GROUP_ANOMALY, personName: 'jean.dupont' })
  })

  it('ne signale rien si les groupes n\'ont pas pu être lus', () => {
    const { data } = sageLine(login, {})
    expect(data.anomaly).toBeUndefined()
    expect(data.entraGroups).toBeUndefined()
  })

  it('retrouve la personne par identifiant Windows, sinon par le début de son UPN', () => {
    const find = indexDirectory([
      { id: 'a', onPremisesSamAccountName: 'Jean.Dupont', userPrincipalName: 'jdupont@fimavi.test' },
      { id: 'b', userPrincipalName: 'marie.martin@fimavi.test' }
    ])
    expect(find('jean.dupont')?.id).toBe('a')
    expect(find('FIMAVI\\jean.dupont')?.id).toBe('a')
    expect(find('marie.martin')?.id).toBe('b')
    expect(find('inconnu')).toBeUndefined()
    expect(find('')).toBeUndefined()
  })

  it('lit la liste des groupes configurés', () => {
    expect(parseSageGroups(' COMPTA_USER, MDP_USER,,GESTCOM_USER,MDP_USER ')).toEqual(['COMPTA_USER', 'MDP_USER', 'GESTCOM_USER'])
  })

  it('vocabulaire et email propres au modèle', () => {
    expect(decisionWording('keep', 'sage-access').action).toBe('Valider l\'accès')
    expect(decisionWording('remove', 'sage-access').action).toBe('Retirer l\'accès')
    expect(defaultEmailSubject('T4 2026', 'sage-access')).toBe('Contrôles IT : accès Sage à vérifier — T4 2026')
    expect(JSON.stringify(defaultEmailDoc('sage-access'))).toContain('accès Sage à vérifier')
  })
})
