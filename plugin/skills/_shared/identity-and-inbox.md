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

## Receiving SMS

A `readSms` step reads the newest messages sent to the profile's phone number and answers a question about them, exactly as `readEmail` does for mail. Texted one-time codes and SMS second factors are ordinary steps.

The number differs from the inbox in one way that matters: email addresses are generated on demand, but phone numbers are **provisioned on the provider account**, so a deployment holds a small fixed pool rather than one number per profile. A run resolves its number from the profile's `managed_profile_phone` secret, falling back to the account-wide number.

Two limits follow from that, and both are worth stating plainly rather than working around:

- An account with no number provisioned genuinely cannot receive SMS. The runner cannot mint one.
- Provider numbers are virtual, and some services refuse to send codes to them. That is the service's filter, not a gap here.

## Authenticator codes

A `solveTotp` step derives the current authenticator code offline from the profile's stored shared secret — HMAC over the secret and the clock, so no device and no provider are involved. It waits for the next window when the current code is about to expire, rather than handing back one that dies mid-submit.

The secret is captured once, at enrolment: 2FA setup screens that offer a manual key behind "can't scan the QR code?" expose it, and a `secretSave` step stores it as `managed_profile_totp_secret`. A QR image alone cannot be read, so capturing the key at enrolment is what makes the account reusable.

## CAPTCHA

A `solveCaptcha` step handles reCAPTCHA v2 and v3, hCaptcha, image, and slider challenges.

## Out of scope

Genuine limits. Say so plainly when one of them is what blocks a flow, and never promise a run that cannot happen:

- Voice-call OTP — there is no audio transport
- OAuth-only social login (Google, GitHub) where the flow does not explicitly require it
- SMS on a deployment with no provisioned number, per the section above

## Wrong conclusions

Before writing that a flow is untestable, unreachable, or needs a stub, check the lists above. The recurring error is declaring a magic-link or email-verification flow un-E2E-able and falling back to unit tests: the flow is supported, and the fallback silently drops the acceptance coverage the user asked for.
