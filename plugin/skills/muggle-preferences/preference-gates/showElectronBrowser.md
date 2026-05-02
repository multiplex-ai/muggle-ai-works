# `showElectronBrowser`

Show the Electron browser during local tests, or run hidden.

**Picker 1** — header `Browser window`, question `"Show the test browser as it runs?"`
- `Show it` — `Watch the test live — useful when something's failing.` → `always` (omit `showUi`)
- `Run hidden` — `Skip watching — let it run in the background while you do other things.` → `never` (pass `showUi: false`)

**Silent action**
- `always` → `Showing the browser`
- `never` → `Running hidden`
