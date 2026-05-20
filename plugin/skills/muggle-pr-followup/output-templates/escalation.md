# Escalation messages

Emitted by `/muggle-do` in address-reviews mode. One per invocation, at most. Anchored here so wording stays consistent.

## Ambiguous escalation

```
**Review-followup escalation — <owner>/<repo>#<n>**

I can't act on <count> review(s) without your input. Listed below; reply on GitHub by submitting a new review with clearer direction, or tell me here which way to go.

Review #<id> from <login>:
> <body or "(no body)">

Comments:
- <file>:<line> — <body>
- ...

[Repeat per ambiguous review in the batch.]
```

## Design-adjustment escalation

```
**Design-adjustment needed — <owner>/<repo>#<n>**

While addressing review #<id>, the cycle surfaced a conflict with the current design:

  <one-paragraph description of the conflict>

This is beyond a routine code change. Confirm the design intent (reply here, or update the requirements doc) before I retry.
```
