# Dev Loop — Fresh Session

Pass `freshSession: true` for a test case that needs clean browser state (no prior cookies, localStorage, or login):

- Registration / sign-up.
- Login / authentication when the flow itself is under test (not a test that merely uses login as a prerequisite).
- Cookie-consent / GDPR first-visit banners.
- Onboarding / first-run experiences.

Otherwise omit it (defaults `false`, preserving session state). Evaluate per test case — in a batch some need it and some don't.
