import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('Documents uses an app-owned English file picker associated with the native input', async () => {
  const source = await readFile(new URL('./DocumentsPanel.tsx', import.meta.url), 'utf8')

  assert.match(source, /id="document-file-input"/)
  assert.match(source, /className="visually-hidden-file-input"/)
  assert.match(source, /className="file-picker-button" htmlFor="document-file-input">Choose file<\/label>/)
  assert.match(source, /No file selected\./)
})

test('Documents imports picker styles that hide the native control and preserve a visible focus indicator', async () => {
  const source = await readFile(new URL('./DocumentsPanel.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('./DocumentsPanel.css', import.meta.url), 'utf8').catch(() => '')

  assert.match(source, /import '\.\/DocumentsPanel\.css'/)
  assert.match(css, /\.visually-hidden-file-input/)
  assert.match(css, /\.visually-hidden-file-input:focus-visible \+ \.file-picker-button/)
})
