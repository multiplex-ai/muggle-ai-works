// Matching runs per sentence so the impossibility, the gated flow, and the
// testing context have to co-occur in one clause. Scanning a whole message
// would pair an unrelated "can't" with an unrelated "login" paragraphs apart.
const SENTENCE = /[^.!?\n]+/g;

const IMPOSSIBILITY =
  /\b(?:can(?:'|’)?t|cannot|can not|could ?n(?:'|’)?t|unable to|no way to|not able to|impossible|infeasible|untestable|unverifiable|not testable|blocked from|no (?:local )?(?:mail|email|smtp) path)\b/i;

// Gated on something a managed login profile supplies: its live inbox, its
// provisioned phone number, its stored TOTP secret, its credentials, or the
// CAPTCHA solver.
const MUGGLE_CLEARS =
  /\b(?:magic[- ]?link|sign[- ]?in link|login link|email link|one[- ]time (?:code|password)|otp|verification (?:code|link|email|mail)|email verification|confirmation (?:code|link|email|mail)|2fa|two[- ]factor|password reset|reset link|inbox|mailbox|mailhog|mailpit|mailtrap|mailcatcher|smtp|transactional email|captcha|recaptcha|hcaptcha|log ?in|logged[- ]?in|sign ?in|signed[- ]in|authenticate|credential|sms|text message|texted code|authenticator app|google authenticator|authy|totp)/i;

// Without this the gate fires on product-defect reports ("users can't log in
// after this change"), which are true statements about the app rather than
// false claims about the harness. The claim only matters when it is about
// exercising the flow.
const TESTING_CONTEXT =
  /\b(?:e2e|end[- ]to[- ]end|test(?:s|ed|ing|able)?|verif(?:y|ied|ication)|validat(?:e|ed|ion)|automat(?:e|ed|ion)|coverage|covered|exercis(?:e|ed)|reproduc(?:e|ed)|replay|scripts?|scripted|muggle|playwright|cypress|selenium)\b/i;

// What remains genuinely out of reach. SMS and authenticator TOTP left this set
// once the runner gained readSms and solveTotp; a phone call still has no
// transport, and an OAuth-only provider is someone else's login page. These
// claims are correct, and a gate that "corrected" them would push the model into
// promising runs that cannot happen.
//
// A deployment with no phone number provisioned is the one true SMS limit the
// pattern cannot see — the gate's message names it so the model can say so
// instead of being argued out of a correct claim.
const GENUINELY_UNSUPPORTED =
  /\b(?:phone call|voice call|oauth|social (?:login|sign[- ]?in)|sign in with (?:google|github|apple|facebook)|no (?:phone )?number (?:is )?provisioned|no provisioned (?:phone )?number)\b/i;

/**
 * Whether a turn's closing message declares an email- or login-gated flow
 * impossible to test — the one class of blocker the managed profile clears.
 * False for the channels Muggle genuinely cannot drive, so those stay sayable.
 */
export function detectFalseCapabilityClaim(text: string): boolean {
  const sentences = (text ?? "").match(SENTENCE) ?? [];
  return sentences.some(
    (sentence) =>
      IMPOSSIBILITY.test(sentence) &&
      MUGGLE_CLEARS.test(sentence) &&
      TESTING_CONTEXT.test(sentence) &&
      !GENUINELY_UNSUPPORTED.test(sentence),
  );
}

interface TranscriptTextPart {
  type?: string;
  text?: string;
}

interface TranscriptEntry {
  type?: string;
  message?: { content?: TranscriptTextPart[] | string };
}

/**
 * The prose of the last assistant turn in a JSONL transcript. Tool calls carry
 * no `text` part and collapse to "", which keeps the detector reading what the
 * user was actually told rather than an intermediate tool payload.
 */
export function lastAssistantText(transcriptJsonl: string): string {
  const lines = (transcriptJsonl ?? "").split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    let entry: TranscriptEntry;
    try {
      entry = JSON.parse(line) as TranscriptEntry;
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const prose = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
    if (prose) return prose;
  }
  return "";
}
