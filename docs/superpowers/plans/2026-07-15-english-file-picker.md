# English File Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the system-localized native file-button text with an accessible, fixed-English `Choose file` control in the Documents workspace.

**Architecture:** Keep `DocumentsPanel` as the owner of the selected `File` state and keep the native file input in the DOM. Visually hide that input and associate it with a styled label so the operating system still provides the file-selection dialog while the product owns the visible text.

**Tech Stack:** React 19, TypeScript, Vite, existing CSS design tokens, ESLint, TypeScript production build.

---

## File Structure

- Modify: `frontend/src/components/DocumentsPanel.tsx` — replace the visible native file-input presentation while preserving its `onChange`, accepted extensions, and selected-file state update.
- Create: `frontend/src/components/DocumentsPanel.css` — define the visually hidden input, custom English picker button, focus-visible treatment, and selection-status layout without reformatting the existing consolidated application stylesheet.
- Create: `frontend/src/components/DocumentsPanel.file-picker.test.mjs` — Node-native regression test for the required picker structure.
- Verify: `frontend` package scripts — run ESLint and TypeScript/Vite production build; use the running local app to inspect the rendered control.

### Task 1: Replace the visible native picker UI

**Files:**

- Modify: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/components/DocumentsPanel.tsx` — the `Choose file` form field in `DocumentsPanel`.
- Create: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/components/DocumentsPanel.file-picker.test.mjs` — source-level UI regression test because the project has no React component-test runner.

- [ ] **Step 1: Write the failing picker-structure test**

Create `DocumentsPanel.file-picker.test.mjs` with:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails before the UI change**

Run:

```powershell
node --test frontend/src/components/DocumentsPanel.file-picker.test.mjs
```

Expected: `FAIL` because the existing component does not yet contain `document-file-input` or `file-picker-button`.

- [ ] **Step 3: Record the current behavior to preserve**

Confirm the existing input retains these exact properties before editing:

```tsx
<input
  type="file"
  accept=".pdf,.txt,.docx"
  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
/>
```

The handler must continue assigning the first selected file (or `null`) to `selectedFile` so the existing upload validation and `FormData.append('file', selectedFile)` path are unchanged.

- [ ] **Step 4: Replace the visible field with an associated label and hidden input**

Replace the current wrapped file label with this block:

```tsx
<div className="file-picker">
  <input
    id="document-file-input"
    className="visually-hidden-file-input"
    type="file"
    accept=".pdf,.txt,.docx"
    aria-describedby="document-file-selection"
    onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
  />
  <label className="file-picker-button" htmlFor="document-file-input">Choose file</label>
  <p id="document-file-selection" className="file-selection" aria-live="polite">
    {selectedFile ? <>Selected: <strong>{selectedFile.name}</strong></> : 'No file selected.'}
  </p>
</div>
```

This gives the visible action a fixed English label while preserving native file-dialog behavior and an accessible relationship between the input, label, and filename status.

- [ ] **Step 5: Inspect the rendered interaction manually**

Run:

```powershell
cd D:\LLLLLLL\RAG\rag-resume-chatbot-remediation
npm run dev --prefix frontend
```

Open the Documents workspace. Expected behavior:

- The action reads `Choose file` even when the system UI language is Chinese.
- Clicking it opens the operating system file-selection dialog.
- Choosing a supported file shows `Selected: <filename>`.
- The existing `Ingest document` action remains disabled/enabled exactly as it did before based on the selected file and upload state.

### Task 2: Style the custom picker and preserve focus visibility

**Files:**

- Create: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/components/DocumentsPanel.css` — add picker-specific styles without modifying the consolidated `App.css` rule line.

- [ ] **Step 1: Write and run the failing picker-style test**

Add this test to `DocumentsPanel.file-picker.test.mjs` and run it before creating the stylesheet:

```js
test('Documents imports picker styles that hide the native control and preserve a visible focus indicator', async () => {
  const source = await readFile(new URL('./DocumentsPanel.tsx', import.meta.url), 'utf8')
  const css = await readFile(new URL('./DocumentsPanel.css', import.meta.url), 'utf8').catch(() => '')

  assert.match(source, /import '\\.\\/DocumentsPanel\\.css'/)
  assert.match(css, /\\.visually-hidden-file-input/)
  assert.match(css, /\\.visually-hidden-file-input:focus-visible \\+ \\.file-picker-button/)
})
```

Run:

```powershell
node --test frontend/src/components/DocumentsPanel.file-picker.test.mjs
```

Expected: the existing structure test passes and the new style test fails because the component has not imported a picker stylesheet yet.

- [ ] **Step 2: Add the hidden-input and picker styles**

Create `DocumentsPanel.css` with these rules, then import it directly after the React import in `DocumentsPanel.tsx`:

```css
.file-picker { display: flex; flex-wrap: wrap; align-items: center; gap: .65rem; }
.visually-hidden-file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
.upload-form .file-picker-button { display: inline-flex; min-height: 2.7rem; align-items: center; justify-content: center; padding: .58rem .85rem; border: 1px solid var(--primary); border-radius: .55rem; background: var(--primary); color: #fff; cursor: pointer; font-size: .84rem; font-weight: 800; transition: background-color .16s ease, transform .16s ease; }
.upload-form .file-picker-button:hover { background: var(--primary-dark); }
.visually-hidden-file-input:focus-visible + .file-picker-button { outline: 3px solid rgba(20, 122, 93, .35); outline-offset: 3px; }
.file-picker .file-selection { margin: 0; }
```

The selector `.upload-form .file-picker-button` intentionally overrides the more general `.upload-form label` rule without changing other form labels.

- [ ] **Step 3: Validate keyboard focus**

In the Documents workspace, use `Tab` until the file picker is focused. Expected behavior: the visible `Choose file` label has a clear focus outline and pressing the standard activation key opens the native file dialog.

### Task 3: Verify the changed frontend

**Files:**

- Verify: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/components/DocumentsPanel.tsx`
- Verify: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/App.css`
- Verify: `D:/LLLLLLL/RAG/rag-resume-chatbot-remediation/frontend/src/components/DocumentsPanel.file-picker.test.mjs`

- [ ] **Step 1: Run the picker regression test after implementation**

Run:

```powershell
node --test frontend/src/components/DocumentsPanel.file-picker.test.mjs
```

Expected: one passing test with no failures.

- [ ] **Step 2: Run frontend lint**

Run:

```powershell
npm run lint --prefix frontend
```

Expected: exit code `0` with no ESLint errors or warnings.

- [ ] **Step 3: Run the production build**

Run:

```powershell
npm run build --prefix frontend
```

Expected: exit code `0` and Vite reports that the client build completed.

- [ ] **Step 4: Review the focused diff**

Run:

```powershell
git diff --check -- frontend/src/components/DocumentsPanel.tsx frontend/src/App.css
git diff -- frontend/src/components/DocumentsPanel.tsx frontend/src/App.css
```

Expected: no whitespace errors, no changes to API calls, accepted extensions, file state, or upload payload assembly.

- [ ] **Step 5: Leave changes uncommitted for the user-owned branch**

Do not create a commit. This remediation worktree has no configured Git author identity, and the requested UI change is delivered as reviewable working-tree changes.

## Execution Record

- Completed 2026-07-15.
- The initial picker-structure test failed before the JSX change, then passed after the associated English label was implemented.
- The picker-style test failed before the component stylesheet was added, then passed after the stylesheet import and focus-visible rule were added.
- Verification passed: 56 backend tests, 2 picker regression tests, frontend lint, frontend production build, rendered local page check, and `git diff --check`.
