import { z } from 'zod'

/**
 * Texte mis en forme (corps des emails, signature) : document JSON de l'éditeur (TipTap), jamais du HTML.
 * Le serveur le valide puis produit lui-même le HTML de l'email à partir d'une liste fermée de nœuds et de
 * styles : tout texte est échappé, les couleurs et liens sont vérifiés, le reste est ignoré.
 */
export interface RichMark { type: string, attrs?: Record<string, unknown> }
export interface RichNode { type: string, text?: string, marks?: RichMark[], attrs?: Record<string, unknown>, content?: RichNode[] }

const MAX_DEPTH = 8
export const RICH_TEXT_MAX_LENGTH = 5000

const markSchema = z.object({ type: z.string().max(40), attrs: z.record(z.string(), z.unknown()).optional() })
const nodeSchema: z.ZodType<RichNode> = z.lazy(() => z.object({
  type: z.string().max(40),
  text: z.string().max(RICH_TEXT_MAX_LENGTH).optional(),
  marks: z.array(markSchema).max(10).optional(),
  attrs: z.record(z.string(), z.unknown()).optional(),
  content: z.array(nodeSchema).max(1000).optional()
}))

const depth = (node: RichNode): number => 1 + Math.max(0, ...(node.content ?? []).map(depth))

/** Texte brut d'un document (longueur, contenu vide). */
export function richPlainText(node: RichNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(richPlainText).join(node.type === 'doc' || node.type.endsWith('List') ? '\n' : '')
}

/** Profondeur mesurée sans récursion, avant la validation Zod (un document très imbriqué ne doit pas épuiser la pile). */
function shallowEnough(value: unknown): boolean {
  const stack: [unknown, number][] = [[value, 1]]
  while (stack.length) {
    const [node, level] = stack.pop()!
    if (level > MAX_DEPTH) return false
    const content = (node as { content?: unknown } | null)?.content
    if (Array.isArray(content)) for (const child of content) stack.push([child, level + 1])
  }
  return true
}

/** Document éditeur : racine « doc », profondeur et longueur bornées. `allowEmpty` pour une signature effacée. */
export const richDocSchema = (opts: { allowEmpty?: boolean } = {}) => z.custom<unknown>(shallowEnough, 'Mise en forme trop imbriquée').pipe(nodeSchema)
  .refine(d => d.type === 'doc', 'Document invalide')
  .refine(d => depth(d) <= MAX_DEPTH, 'Mise en forme trop imbriquée')
  .refine(d => richPlainText(d).length <= RICH_TEXT_MAX_LENGTH, `${RICH_TEXT_MAX_LENGTH} caractères au plus`)
  .refine(d => opts.allowEmpty || richPlainText(d).trim().length > 0, 'Le message est obligatoire')

/** Texte brut → document (une ligne = un paragraphe, ligne vide = paragraphe vide). */
export function textToDoc(text: string): RichNode {
  return {
    type: 'doc',
    content: text.replace(/\r\n?/g, '\n').split('\n').map(line => line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })
  }
}

export const isEmptyDoc = (doc: RichNode | null | undefined) => !doc || !richPlainText(doc).trim()

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i
/** Couleur CSS sûre (hexadécimale ou rgb), sinon undefined. */
export const safeColor = (value: unknown) => typeof value === 'string' && COLOR.test(value.trim()) ? value.trim() : undefined
/** Lien sûr : http(s) ou mailto uniquement. */
export const safeHref = (value: unknown) => typeof value === 'string' && /^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(value.trim()) ? value.trim() : undefined

/** Mise en forme retenue pour un texte : liste fermée, couleurs et liens vérifiés. */
export interface TextFormat { bold?: true, italic?: true, underline?: true, strike?: true, color?: string, background?: string, href?: string }
export function textFormat(marks: RichMark[] = []): TextFormat {
  const format: TextFormat = {}
  for (const mark of marks) {
    if (mark.type === 'bold') format.bold = true
    else if (mark.type === 'italic') format.italic = true
    else if (mark.type === 'underline') format.underline = true
    else if (mark.type === 'strike') format.strike = true
    else if (mark.type === 'textStyle') {
      const color = safeColor(mark.attrs?.color)
      const background = safeColor(mark.attrs?.backgroundColor)
      if (color) format.color = color
      if (background) format.background = background
    } else if (mark.type === 'highlight') format.background = safeColor(mark.attrs?.color) ?? '#fef08a'
    else if (mark.type === 'link') {
      const href = safeHref(mark.attrs?.href)
      if (href) format.href = href
    }
  }
  return format
}

/**
 * Images autorisées dans un email : liste fermée d'images fournies par l'application (affichées dans l'éditeur
 * depuis /public, envoyées en pièce jointe intégrée référencée par cid:). Toute autre image est ignorée.
 */
export const INLINE_IMAGES: Record<string, { cid: string, alt: string, width: number, height: number }> = {
  '/signature-fimavi.jpg': { cid: 'signature-fimavi', alt: 'Groupe Fimavi — faire grandir, durablement — www.fimavi.com', width: 600, height: 61 }
}
export const inlineImage = (node: RichNode) => node.type === 'image' && typeof node.attrs?.src === 'string' ? INLINE_IMAGES[node.attrs.src] : undefined

/** Images intégrées utilisées par un document (identifiants cid). */
export function usedInlineImages(node: RichNode, found = new Set<string>()): string[] {
  const image = inlineImage(node)
  if (image) found.add(image.cid)
  for (const child of node.content ?? []) usedInlineImages(child, found)
  return [...found]
}

/**
 * Champs remplacés à l'envoi, pour chaque destinataire. Ils restent visibles et déplaçables dans le corps du message.
 */
export const FIELD_NAME = '[Prénom Nom]'
export const FIELD_PENDING = '[Vérifications en attente]'

/** Blocs reconnus ; un nœud inconnu est rendu comme un simple conteneur de son contenu. */
export type BlockKind = 'p' | 'ul' | 'ol' | 'li' | 'br' | 'img' | 'text' | 'container'
export function blockKind(node: RichNode): BlockKind {
  switch (node.type) {
    case 'paragraph': case 'heading': case 'blockquote': return 'p'
    case 'bulletList': return 'ul'
    case 'orderedList': return 'ol'
    case 'listItem': return 'li'
    case 'hardBreak': return 'br'
    case 'image': return 'img'
    case 'text': return 'text'
    default: return 'container'
  }
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]!)

/** Remplacements à l'envoi : champ → HTML produit par le serveur (le nom du destinataire y est déjà échappé). */
export type Fields = Record<string, string>

function textHtml(node: RichNode, fields: Fields): string {
  const f = textFormat(node.marks)
  let html = escapeHtml(node.text ?? '')
  for (const [field, value] of Object.entries(fields)) html = html.split(escapeHtml(field)).join(value)
  if (f.bold) html = `<strong>${html}</strong>`
  if (f.italic) html = `<em>${html}</em>`
  if (f.underline) html = `<u>${html}</u>`
  if (f.strike) html = `<s>${html}</s>`
  const style = [f.color && `color:${f.color}`, f.background && `background-color:${f.background}`].filter(Boolean).join(';')
  if (style) html = `<span style="${escapeHtml(style)}">${html}</span>`
  if (f.href) html = `<a href="${escapeHtml(f.href)}">${html}</a>`
  return html
}

/** HTML d'email d'un document validé (construit ici, jamais repris de l'entrée). */
export function richToHtml(node: RichNode, fields: Fields = {}, level = 0): string {
  if (level > MAX_DEPTH) return ''
  const inner = () => (node.content ?? []).map(child => richToHtml(child, fields, level + 1)).join('')
  switch (blockKind(node)) {
    case 'text': return textHtml(node, fields)
    case 'img': {
      const image = inlineImage(node)
      return image ? `<p style="margin:0"><img src="cid:${image.cid}" alt="${escapeHtml(image.alt)}" width="${image.width}" height="${image.height}" style="display:block;max-width:100%;height:auto;border:0"></p>` : ''
    }
    case 'br': return '<br>'
    case 'p': return `<p style="margin:0">${inner() || '&nbsp;'}</p>`
    case 'ul': return `<ul style="margin:0">${inner()}</ul>`
    case 'ol': return `<ol style="margin:0">${inner()}</ol>`
    case 'li': return `<li>${inner()}</li>`
    default: return inner()
  }
}
