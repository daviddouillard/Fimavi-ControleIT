<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'
import type { Editor } from '@tiptap/vue-3'
import { BackgroundColor, Color, TextStyle } from '@tiptap/extension-text-style'
import type { RichNode } from '#shared/richText'

/**
 * Éditeur de texte mis en forme (gras, italique, souligné, couleur, surlignage, listes).
 * Produit un document JSON : le serveur le revalide et fabrique lui-même le HTML des emails.
 */
const model = defineModel<RichNode>({ required: true })
defineProps<{ placeholder?: string, label?: string }>()

const extensions = [TextStyle, Color, BackgroundColor]
const starterKit = {
  heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false,
  link: { openOnClick: false }, dropcursor: false
} as const

const TEXT_COLORS = [
  { label: 'Noir', value: '#111827' },
  { label: 'Rouge', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Vert', value: '#16a34a' },
  { label: 'Bleu', value: '#2563eb' },
  { label: 'Violet', value: '#7c3aed' },
  { label: 'Gris', value: '#6b7280' }
]
const HIGHLIGHTS = [
  { label: 'Jaune', value: '#fef08a' },
  { label: 'Vert', value: '#bbf7d0' },
  { label: 'Bleu', value: '#bfdbfe' },
  { label: 'Rose', value: '#fbcfe8' },
  { label: 'Orange', value: '#fed7aa' }
]

/** Pastille de couleur (image SVG en data: URI, autorisée par la CSP). */
const swatch = (value: string) => ({
  src: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${value}"/></svg>`)}`,
  alt: '',
  size: '2xs' as const
})

function toolbar(editor: Editor): EditorToolbarItem[][] {
  return [
    [
      { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Gras' }, 'aria-label': 'Gras' },
      { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italique' }, 'aria-label': 'Italique' },
      { kind: 'mark', mark: 'underline', icon: 'i-lucide-underline', tooltip: { text: 'Souligné' }, 'aria-label': 'Souligné' }
    ],
    [
      {
        'icon': 'i-lucide-baseline',
        'tooltip': { text: 'Couleur du texte' },
        'aria-label': 'Couleur du texte',
        'items': [
          ...TEXT_COLORS.map(c => ({ label: c.label, avatar: swatch(c.value), onSelect: () => editor.chain().focus().setColor(c.value).run() })),
          { label: 'Couleur par défaut', icon: 'i-lucide-eraser', onSelect: () => editor.chain().focus().unsetColor().run() }
        ]
      },
      {
        'icon': 'i-lucide-highlighter',
        'tooltip': { text: 'Surligner' },
        'aria-label': 'Surligner',
        'items': [
          ...HIGHLIGHTS.map(c => ({ label: c.label, avatar: swatch(c.value), onSelect: () => editor.chain().focus().setBackgroundColor(c.value).run() })),
          { label: 'Sans surlignage', icon: 'i-lucide-eraser', onSelect: () => editor.chain().focus().unsetBackgroundColor().run() }
        ]
      }
    ],
    [
      { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Liste à puces' }, 'aria-label': 'Liste à puces' },
      { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Liste numérotée' }, 'aria-label': 'Liste numérotée' },
      { kind: 'clearFormatting', icon: 'i-lucide-remove-formatting', tooltip: { text: 'Effacer la mise en forme' }, 'aria-label': 'Effacer la mise en forme' }
    ]
  ] as EditorToolbarItem[][]
}
</script>

<template>
  <UEditor
    v-slot="{ editor }"
    v-model="model"
    content-type="json"
    :extensions="extensions"
    :starter-kit="starterKit"
    :image="false"
    :mention="false"
    :placeholder="placeholder"
    :aria-label="label"
    class="w-full rounded-md border border-default"
    :ui="{ base: 'min-h-32 px-3 py-2 sm:px-3 [&_p]:my-0 [&_p]:leading-6' }"
  >
    <UEditorToolbar :editor="editor" :items="toolbar(editor)" class="border-b border-default px-1 py-1" />
  </UEditor>
</template>
