/** Personne de l'annuaire synchronisé depuis Entra ID. */
export interface DirectoryUser { id: string, displayName: string, mail: string | null, department: string | null }

/** Recherche dans l'annuaire à partir de 2 lettres (nom, email ou identifiant), avec temporisation. */
export function useDirectorySearch() {
  const toast = useToast()
  const searchTerm = ref('')
  const items = ref<DirectoryUser[]>([])
  const searching = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(searchTerm, (term) => {
    clearTimeout(timer)
    if (term.trim().length < 2) return
    timer = setTimeout(async () => {
      searching.value = true
      try {
        items.value = await $fetch<DirectoryUser[]>('/api/admin/users', { query: { q: term.trim() } })
      } catch {
        items.value = []
        toast.add({ title: 'Recherche impossible', description: 'L\'annuaire n\'a pas répondu, réessayez dans un instant.', color: 'error' })
      } finally {
        searching.value = false
      }
    }, 300)
  })
  onBeforeUnmount(() => clearTimeout(timer))

  return { searchTerm, items, searching }
}
