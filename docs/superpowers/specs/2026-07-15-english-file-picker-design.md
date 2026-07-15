# English File Picker Design

## Goal

Make the Documents workspace file-selection control display consistent English product copy regardless of the operating system or browser interface language.

## Scope

- Replace only the visible native file-input button in `DocumentsPanel`.
- Keep the existing accepted file types, upload state, `FormData` behavior, and validation unchanged.
- Use `Choose file` as the visible action label.
- Show the selected filename in the existing selection-status area after a file is chosen.

## Design

The implementation will keep an actual `<input type="file">` in the DOM, associated with a visible `<label>` styled as the button. The input will be visually hidden rather than removed. Activating the label with a mouse, touch input, or keyboard will open the same native file-selection dialog as before.

The visible label will use a fixed English string, so its language does not depend on the browser or operating system locale. The input will retain an accessible name and accepted extensions. No backend API, upload payload, or application-language setting will change.

## Accessibility

- The label and input remain explicitly associated with `htmlFor` and `id`.
- Keyboard users can focus and activate the file control.
- The focus indicator remains visible through the existing application focus styles.
- The selected filename remains readable in text after selection.

## Verification

1. Confirm `Choose file` appears in the Documents form when the application runs on a Chinese-language system.
2. Select a PDF, TXT, or DOCX file and confirm its filename appears in the selection status.
3. Confirm upload still sends the selected file through the existing `FormData` request.
4. Run frontend lint and production build.
