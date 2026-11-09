import { describe, expect, it } from 'vitest'
import { collectSiteShares, sitePath } from '../../server/controls/sharepoint-external/collect'
import type { GraphClient } from '../../server/utils/graph'

/** Faux client Graph : réponses indexées par chemin (sans paramètres). */
function fakeGraph(routes: Record<string, unknown[] | unknown>): GraphClient & { calls: string[] } {
  const calls: string[] = []
  const lookup = (path: string) => {
    const key = path.split('?')[0]!
    calls.push(key)
    if (!(key in routes)) throw new Error(`route inattendue : ${key}`)
    return routes[key]
  }
  return {
    calls,
    get: async path => lookup(path),
    async* list(path) {
      const value = lookup(path) as unknown[]
      // Deux pages pour vérifier le parcours paginé.
      yield value.slice(0, 1)
      yield value.slice(1)
    },
    post: async () => {}
  }
}

const domains = new Set(['fimavi.com'])

describe('sitePath', () => {
  it('construit le chemin Graph d\'un site', () => {
    expect(sitePath('https://fimavi.sharepoint.com/sites/direction')).toBe('sites/fimavi.sharepoint.com:/sites/direction')
    expect(sitePath('https://fimavi.sharepoint.com')).toBe('sites/fimavi.sharepoint.com')
  })
})

describe('collectSiteShares', () => {
  const routes = {
    'sites/fimavi.sharepoint.com:/sites/direction': { id: 'site-1', displayName: 'Direction', webUrl: 'https://fimavi.sharepoint.com/sites/direction' },
    'sites/site-1/drives': [{ id: 'drive-1', name: 'Documents' }],
    'drives/drive-1/root/delta': [
      { id: 'root', name: 'root', root: {} },
      { id: 'f1', name: 'Contrats', folder: {}, parentReference: { id: 'root' }, shared: {} },
      { id: 'd1', name: 'contrat.pdf', file: {}, parentReference: { id: 'f1' }, shared: {}, webUrl: 'https://fimavi.sharepoint.com/sites/direction/contrat.pdf' },
      { id: 'd2', name: 'interne.docx', file: {}, parentReference: { id: 'f1' } },
      { id: 'gone', name: 'supprimé', file: {}, parentReference: { id: 'root' }, shared: {} },
      { id: 'gone', deleted: {} }
    ],
    'drives/drive-1/items/root/permissions': [{ id: 'g', roles: ['write'], grantedToV2: { siteGroup: { displayName: 'Membres' } } }],
    'drives/drive-1/items/f1/permissions': [
      { id: 'a', roles: ['read'], grantedToV2: { user: { email: 'consultant@cabinet.com' } } }
    ],
    'drives/drive-1/items/d1/permissions': [
      // Hérité du dossier : ne doit pas être répété.
      { id: 'a', roles: ['read'], grantedToV2: { user: { email: 'consultant@cabinet.com' } } },
      { id: 'b', roles: ['read'], link: { scope: 'anonymous', type: 'view' } },
      { id: 'c', roles: ['read'], link: { scope: 'anonymous', type: 'view' } }
    ]
  }

  it('remonte les partages externes, sans héritage ni doublon, et ne lit que les éléments partagés', async () => {
    const graph = fakeGraph(routes)
    const lines = await collectSiteShares(graph, { url: 'https://fimavi.sharepoint.com/sites/direction', tenantId: 't1', tenantName: 'Fimavi' }, domains)

    expect(lines.map(l => [l.data.resource, l.data.beneficiary, l.data.access])).toEqual([
      ['Documents / Contrats', 'consultant@cabinet.com', 'Accès direct'],
      ['Documents / Contrats / contrat.pdf', 'Tout le monde (lien anonyme)', 'Lien « Tout le monde »']
    ])
    expect(lines[1]!.data).toMatchObject({ resourceType: 'Fichier', site: 'Direction', tenant: 'Fimavi', role: 'Lecture' })
    expect(new Set(lines.map(l => l.dedupKey)).size).toBe(2)
    // Ni le fichier non partagé ni l'élément supprimé ne sont interrogés.
    expect(graph.calls).not.toContain('drives/drive-1/items/d2/permissions')
    expect(graph.calls).not.toContain('drives/drive-1/items/gone/permissions')
  })

  it('produit des clés stables d\'une collecte à l\'autre (relance sans doublon)', async () => {
    const target = { url: 'https://fimavi.sharepoint.com/sites/direction', tenantId: 't1', tenantName: 'Fimavi' }
    const first = await collectSiteShares(fakeGraph(routes), target, domains)
    const second = await collectSiteShares(fakeGraph(routes), target, domains)
    expect(second.map(l => l.dedupKey)).toEqual(first.map(l => l.dedupKey))
  })
})
