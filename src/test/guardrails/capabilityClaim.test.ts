import { describe, it, expect } from "vitest";
import { detectFalseCapabilityClaim, lastAssistantText } from "../../guardrails/capabilityClaim";

const assistantLine = (text: string): string =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: text }] } });

const userLine = (text: string): string =>
  JSON.stringify({ type: "user", message: { content: [{ type: "text", text: text }] } });

describe("detectFalseCapabilityClaim", () => {
  it("fires on an email-gated flow declared untestable", () => {
    // The claim that prompted this gate, verbatim from the transcript.
    expect(detectFalseCapabilityClaim("Magic-link signed-in flows can't be E2E'd locally.")).toBe(true);
    expect(detectFalseCapabilityClaim("There's no way to verify the password reset link without a mail catcher.")).toBe(true);
    expect(detectFalseCapabilityClaim("The emailed OTP makes this flow untestable in an automated run.")).toBe(true);
    expect(detectFalseCapabilityClaim("Email verification is unverifiable end-to-end, so I covered it with unit tests.")).toBe(true);
  });

  it("fires on the credential and CAPTCHA blockers muggle also clears", () => {
    expect(detectFalseCapabilityClaim("The signup form is behind a reCAPTCHA, so it cannot be tested automatically.")).toBe(true);
    expect(detectFalseCapabilityClaim("Without a logged-in session we can't test the dashboard.")).toBe(true);
  });

  it("fires on SMS and authenticator codes, which the runner now reads", () => {
    expect(detectFalseCapabilityClaim("The SMS OTP step can't be tested end to end.")).toBe(true);
    expect(detectFalseCapabilityClaim("We cannot automate the authenticator app 2FA challenge.")).toBe(true);
    expect(detectFalseCapabilityClaim("TOTP login is impossible to automate in a replay.")).toBe(true);
    expect(detectFalseCapabilityClaim("The texted code can't be verified in an automated test.")).toBe(true);
  });

  it("stays silent on what is still genuinely out of reach", () => {
    expect(detectFalseCapabilityClaim("The voice call OTP can't be tested end to end.")).toBe(false);
    expect(
      detectFalseCapabilityClaim("Sign in with Google is the only option, so we cannot automate the login."),
    ).toBe(false);
    expect(detectFalseCapabilityClaim("OAuth-only login means this flow can't be automated.")).toBe(false);
  });

  // The one real SMS limit the pattern cannot infer: reading a number is not the
  // same as having one. Without this the gate would argue the model out of a
  // correct claim on any deployment that never provisioned a number.
  it("stays silent when the deployment has no number provisioned", () => {
    expect(
      detectFalseCapabilityClaim("No phone number is provisioned here, so the SMS code can't be tested."),
    ).toBe(false);
    expect(
      detectFalseCapabilityClaim("With no number provisioned we cannot verify the texted code."),
    ).toBe(false);
  });

  it("stays silent on product defects, which are true statements about the app", () => {
    expect(detectFalseCapabilityClaim("Users can't log in after this change.")).toBe(false);
    expect(detectFalseCapabilityClaim("The magic link cannot be opened twice.")).toBe(false);
  });

  it("requires the impossibility and the gated flow in one sentence", () => {
    expect(
      detectFalseCapabilityClaim(
        "I can't reach the staging box. The login page uses a verification code, which we test elsewhere.",
      ),
    ).toBe(false);
  });

  it("is inert on ordinary prose", () => {
    expect(detectFalseCapabilityClaim("Ran the suite; 12 passed.")).toBe(false);
    expect(detectFalseCapabilityClaim("")).toBe(false);
  });
});

describe("lastAssistantText", () => {
  it("reads the closing assistant turn, not the user's", () => {
    const transcript = [
      assistantLine("earlier turn"),
      userLine("can't this be tested?"),
      assistantLine("the login flow can't be tested"),
    ].join("\n");
    expect(lastAssistantText(transcript)).toBe("the login flow can't be tested");
  });

  it("tolerates the partial leading line a tail slice leaves behind", () => {
    const transcript = ['ssage":{"content":[{"type":"text"', assistantLine("intact turn")].join("\n");
    expect(lastAssistantText(transcript)).toBe("intact turn");
  });

  it("falls through a tool-only turn to the last prose the user actually saw", () => {
    const toolOnly = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", text: undefined }] },
    });
    const transcript = [assistantLine("the prose turn"), toolOnly].join("\n");
    expect(lastAssistantText(transcript)).toBe("the prose turn");
  });

  it("returns empty when no assistant turn is present", () => {
    expect(lastAssistantText(userLine("hello"))).toBe("");
    expect(lastAssistantText("")).toBe("");
  });
});
