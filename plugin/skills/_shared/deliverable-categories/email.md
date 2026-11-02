# Email deliverable check

The flow for an `[email]` criterion. Shared rules — obtaining the artifact, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

**Verified by:** deliverable check.

## Artifact

A rendered email message — transactional, notification, or campaign: the template rendered to HTML (and its plain-text part) by the repo's own render or preview command, with the repo's fixture or preview data. A committed static HTML email is checked as committed.

An email a running flow sends and a user receives is a `[web]` criterion, read from the managed profile's inbox by a test case; this category covers the message itself.

## Probes

Run as a script written outside the worktree, so the check leaves the change untouched.

- The template renders without error.
- Subject, preheader, and sender, against the stated values.
- No unresolved merge fields: no `{{`, `${`, `undefined`, `null`, or `NaN` in the rendered output.
- A plain-text part, when the mailer sends multipart.
- Every link absolute `https`, none pointing at `localhost`; an unsubscribe link when the message is marketing.
- Every image absolute, with `alt` text.
- HTML size under 102 KB, past which Gmail clips the message.

## Review

Screenshot the rendered HTML at 600 px and 375 px wide and read both against the criterion:

- Copy present and spelled as specified.
- Layout intact: nothing overflowing, overlapping, or missing.
- Buttons and links carry the stated labels.

A changed template is also rendered beside its base-branch version; every difference the criterion does not ask for is a finding.

## Inconclusive when

- The template cannot be rendered for an environment reason.
- No headless browser is available for the screenshots.
