import { describe, expect, it } from 'vitest'
import { richDocSchema, richToHtml, textToDoc, type RichNode } from '../../shared/richText'

const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content: [{ type: 'paragraph', content }] })

describe('texte mis en forme des emails', () => {
  it('produit gras, italique, souligné, couleur et surlignage', () => {
    const html = richToHtml(doc(
      { type: 'text', text: 'Important', marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: '#dc2626', backgroundColor: '#fef08a' } }] },
      { type: 'text', text: ' et ', marks: [{ type: 'italic' }, { type: 'underline' }] },
      { type: 'text', text: 'rgb', marks: [{ type: 'textStyle', attrs: { color: 'rgb(31, 56, 100)' } }] }
    ))
    expect(html).toBe('<p style="margin:0"><span style="color:#dc2626;background-color:#fef08a"><strong>Important</strong></span>'
      + '<u><em> et </em></u><span style="color:rgb(31, 56, 100)">rgb</span></p>')
  })

  it('échappe le texte et ignore les styles, liens et nœuds non autorisés', () => {
    const html = richToHtml({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [
          { type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(javascript:alert(1))' } }] },
          { type: 'text', text: 'lien', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
          { type: 'text', text: 'mail', marks: [{ type: 'link', attrs: { href: 'mailto:it@fimavi.test' } }] }
        ] },
        { type: 'image', attrs: { src: 'https://evil.test/x.png' } },
        { type: 'iframe', content: [{ type: 'text', text: 'contenu' }] }
      ]
    })
    expect(html).not.toMatch(/<script|<img|<iframe|javascript:|url\(/)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<a href="mailto:it@fimavi.test">mail</a>')
    expect(html).toContain('contenu')
  })

  it('rend les listes et les lignes vides', () => {
    expect(richToHtml(textToDoc('a\n\nb'))).toBe('<p style="margin:0">a</p><p style="margin:0">&nbsp;</p><p style="margin:0">b</p>')
    expect(richToHtml({ type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }] }] }))
      .toBe('<ul style="margin:0"><li><p style="margin:0">x</p></li></ul>')
  })

  it('valide la racine, la longueur et la profondeur', () => {
    expect(richDocSchema().safeParse(textToDoc('ok')).success).toBe(true)
    expect(richDocSchema().safeParse({ type: 'paragraph' }).success).toBe(false)
    expect(richDocSchema().safeParse(textToDoc('x'.repeat(5001))).success).toBe(false)
    let deep: RichNode = { type: 'text', text: 'x' }
    for (let i = 0; i < 10; i++) deep = { type: 'paragraph', content: [deep] }
    expect(richDocSchema().safeParse({ type: 'doc', content: [deep] }).success).toBe(false)
    expect(richDocSchema({ allowEmpty: true }).safeParse(textToDoc('')).success).toBe(true)
    // Imbrication extrême : refusée sans épuiser la pile.
    let huge: RichNode = { type: 'text', text: 'x' }
    for (let i = 0; i < 100_000; i++) huge = { type: 'paragraph', content: [huge] }
    expect(richDocSchema().safeParse({ type: 'doc', content: [huge] }).success).toBe(false)
  })
})
