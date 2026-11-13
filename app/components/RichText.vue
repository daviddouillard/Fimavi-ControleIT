<script setup lang="ts">
import type { VNode } from 'vue'
import { blockKind, textFormat, type RichNode } from '#shared/richText'

/** Affichage d'un document de l'éditeur (aperçu de l'email) : mêmes règles que le HTML de l'email, sans v-html. */
const props = defineProps<{ doc: RichNode }>()

type Rendered = VNode | string | Rendered[]
function render(node: RichNode, key: number, level = 0): Rendered {
  if (level > 8) return ''
  const children = (): (VNode | string)[] => (node.content ?? []).map((child, i) => render(child, i, level + 1)).flat(8) as (VNode | string)[]
  switch (blockKind(node)) {
    case 'text': {
      const f = textFormat(node.marks)
      const style = { color: f.color, backgroundColor: f.background }
      const classes = [f.bold && 'font-semibold', f.italic && 'italic', f.underline && 'underline', f.strike && 'line-through']
      const span = h('span', { key, class: classes, style }, node.text ?? '')
      return f.href ? h('a', { key, href: f.href, class: 'text-primary underline', target: '_blank', rel: 'noopener noreferrer' }, [span]) : span
    }
    case 'br': return h('br', { key })
    case 'p': {
      const inner = children()
      return h('p', { key, class: 'min-h-5' }, inner.length ? inner : [' '])
    }
    case 'ul': return h('ul', { key, class: 'list-disc ps-5' }, children())
    case 'ol': return h('ol', { key, class: 'list-decimal ps-5' }, children())
    case 'li': return h('li', { key }, children())
    default: return children()
  }
}

const RichContent = () => h('div', render(props.doc, 0))
</script>

<template>
  <RichContent />
</template>
