# greeting-site

A small site the agent-gate eval copies into a run's sandbox as the repository under work (`seed.repo: "greeting-site"`). It is the `users/eval/drop-newsletter` branch as a build stage left it: the home page's newsletter signup is gone and a farewell line sits under the greeting. Scenarios script the `git diff` against `main` that shows both. Nothing on the contact page's path changed, so its use case is out of scope.

- `src/server.js` serves the routes each page module exports.
- `src/home.js` renders the home page and owns its routes; `src/greeting.js` renders its greeting and farewell.
- `src/contact.js` renders the contact page and its thank-you note, and owns their routes.
- `test/greeting_test.js` covers the greeting; `npm test` runs every `test/` file with Node's built-in test runner. The `_test` name keeps the repo's vitest glob from collecting it.
