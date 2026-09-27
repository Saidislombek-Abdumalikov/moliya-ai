import assert from 'node:assert/strict'
import { TRANSACTION_CLARIFICATION } from '../shared/amountEvidence.js'

process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key'
const { parseAIText } = await import('../src/components/AIButton.js')
const originalFetch = globalThis.fetch
const source = 'taksiga 30 ming'
let checks = 0
try {
  for (const status of [401, 403, 422, 429, 503]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'limit' }), { status, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(parseAIText(source), undefined, `HTTP ${status} must not use browser parser`)
    checks++
  }
  globalThis.fetch = async () => { throw new Error('offline') }
  await assert.rejects(parseAIText(source), /offline/)
  checks++
  globalThis.fetch = async () => new Response(JSON.stringify({ amount: '30 000', category: 'Transport' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  await assert.rejects(parseAIText(source), /qo‘lda kiriting/)
  checks++
  globalThis.fetch = async () => new Response(JSON.stringify({ type: 'expense', amount: '30 000', category: 'Transport' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  const valid = await parseAIText(source)
  assert.equal(valid.type, 'expense')
  assert.equal(valid.amount, '30 000')
  checks++
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('unexpected fetch') }
  await assert.rejects(parseAIText('suv 50 ming'), error => error instanceof Error && error.message === TRANSACTION_CLARIFICATION)
  assert.equal(calls, 0)
  checks++
} finally {
  globalThis.fetch = originalFetch
}
console.log(`Client AI boundary: ${checks} checks passed`)
