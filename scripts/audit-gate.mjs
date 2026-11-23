// Contrôle bloquant des dépendances de production (CI).
// Échoue sur tout avis de sévérité élevée ou critique, sauf les exceptions ci-dessous :
// chacune est datée, justifiée dans docs/audits/, et redevient bloquante à son expiration.
import { execFileSync } from 'node:child_process'

const EXCEPTIONS = {
  // Aucune exception en cours (picomatch GHSA-fc5q-39xc-vjpf corrigé, retiré le 2026-11-23).
}
const BLOCKING = new Set(['high', 'critical'])

let raw
try {
  raw = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', shell: process.platform === 'win32', maxBuffer: 64 * 1024 * 1024 })
} catch (error) {
  // npm audit renvoie un code non nul dès qu'il trouve une vulnérabilité : on lit quand même le JSON.
  raw = error.stdout
}
const report = JSON.parse(raw)
if (report.error) throw new Error(`npm audit en échec : ${report.error.summary ?? 'erreur inconnue'}`)

const today = new Date().toISOString().slice(0, 10)
const advisories = new Map()
for (const vuln of Object.values(report.vulnerabilities ?? {})) {
  for (const via of vuln.via ?? []) {
    if (typeof via !== 'object' || !BLOCKING.has(via.severity)) continue
    const id = String(via.url ?? '').split('/').pop() || String(via.source)
    advisories.set(id, `${id} (${via.severity}) ${via.name} : ${via.title}`)
  }
}

const blocking = []
for (const [id, text] of advisories) {
  const until = EXCEPTIONS[id]
  if (until && today <= until) console.log(`Exception jusqu'au ${until} : ${text}`)
  else blocking.push(until ? `${text} — exception expirée le ${until}` : text)
}
for (const [id, until] of Object.entries(EXCEPTIONS)) {
  if (!advisories.has(id)) console.log(`Exception ${id} (jusqu'au ${until}) devenue inutile : à retirer.`)
}

if (blocking.length) {
  console.error(`Avis bloquants :\n- ${blocking.join('\n- ')}`)
  process.exit(1)
}
console.log('Aucun avis bloquant.')
