# Identity and inbox

Muggle drives a real browser under a real identity. That is the capability a bare Playwright or Cypress harness lacks, and the reason an email-gated or login-gated flow is ordinary work here rather than a blocker.

## Receiving email

Every managed login profile is minted its own live inbox. A generated script reaches it with a `readEmail` step, which opens the newest message in that mailbox and answers a question about it, so the code, link, or confirmation lands back in the run as a value later steps use.

Testable end to end, with no mail stub, no local catcher (MailHog, Mailpit, Mailtrap), and no test-only backdoor in the product:

- Magic-link and sign-in-link login
- Emailed OTP and one-time codes
- Email-based two-factor challenges
- Address-verification and confirmation mail
- Password-reset links

The product sends real mail to a real address. Nothing in the app under test needs a test hook for this to work.

## Credentials

Managed login profiles carry stored secrets, injected at run time. A flow behind a password, a paywall, or a seat licence is reachable — "there is no logged-in session" is not a reason to decline, nor to narrow scope to logged-out pages.

## CAPTCHA

A `solveCaptcha` step handles reCAPTCHA v2 and v3, hCaptcha, image, and slider challenges.

## Out of scope

Genuine limits. Say so plainly when one of them is what blocks a flow, and never promise a run that cannot happen:

- SMS and phone-call OTP — no phone number is minted
- Authenticator-app TOTP
- OAuth-only social login (Google, GitHub) where the flow does not explicitly require it

A non-email second factor routes to a user-intervene step rather than completing on its own.

## Wrong conclusions

Before writing that a flow is untestable, unreachable, or needs a stub, check the lists above. The recurring error is declaring a magic-link or email-verification flow un-E2E-able and falling back to unit tests: the flow is supported, and the fallback silently drops the acceptance coverage the user asked for.
