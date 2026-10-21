# tiny-web-app

A minimal web app the agent-gate eval copies into a run's sandbox as the repository under work (`seed.repo: "tiny-web-app"`).

- `src/greeting.js` renders the greeting the home page shows.
- `test/greeting_test.js` covers it; `npm test` runs it with Node's built-in test runner. The `_test` name keeps the repo's vitest glob from collecting it.
