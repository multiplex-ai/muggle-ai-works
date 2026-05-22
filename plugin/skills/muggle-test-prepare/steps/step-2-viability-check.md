# Step 2: Viability Check

Some services can't run on a developer's machine by design — production secrets, HSMs, specific certificates, cloud-only infra. Don't waste time trying to start them.

If the user volunteered this in their initial message, acknowledge and skip the question. Otherwise:

> "Are there any services in your stack that **can't** run locally? (e.g., needs production secrets, specific certificates, or cloud-only infra)"

- Option 1: "All my services can run locally"
- Option 2: "Some can't — I'll tell you which"

If option 2, collect names and exclude from discovery.

If an excluded service is a hard dependency for the app under test, suggest remote testing:

> "Since **payment-gateway** can't run locally, you might get better coverage by merging and running `/muggle-test` against your preview environment. Want to continue with a partial local setup, or switch to remote testing?"

- Option 1: "Continue locally — I'll work around the missing service"
- Option 2: "Switch to remote — I'll merge and test on preview"

If remote, hand off to `/muggle-test` in remote mode and exit.
