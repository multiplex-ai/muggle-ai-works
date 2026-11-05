# Test case design: one atomic behavior per test case

Every test case verifies exactly **one** user-observable behavior. Never bundle multiple concerns, sequential flows, or bootstrap/setup into a single test case — even if you think it would be "cleaner" or "more efficient."

**Ordering and dependencies belong to the test-plan graph, not to the test case body.** The backend records which case depends on which; the run path reads that chain and runs the prerequisites first ([`test-case-chain-readiness.md`](test-case-chain-readiness.md)). Your job is to describe the *atomic behavior to verify* — never the flow that gets there.

- ❌ Wrong: one test case that "signs up, logs in, navigates to the detail modal, verifies icon stacking, verifies tab order, verifies history format, and verifies reference layout."
- ✅ Right: four separate test cases — one per verifiable behavior — each with instruction text like "Verify the detail modal shows stacked pair of icons per card" with **no** signup / login / navigation / setup language.

**Never bake bootstrap into a test case description.** Signup, login, seed data, prerequisite navigation, tear-down — none of these belong inside the test case body. Write only the verification itself. Setup arrives as its own prerequisite case: the chain runs ahead of the target, and the session it leaves behind is what the target starts from. Nothing is spliced into the case body.

**Never consolidate the generator's output.** When `muggle-remote-test-case-generate-from-prompt` returns N micro-tests from a single prompt, that decomposition is the authoritative one. Do not "merge them into 1 for simplicity," do not "rewrite them to share bootstrap," do not "collapse them to match a 4 UC / 4 TC plan." Accept what the generator gave you.

## Limits

Anything a test must or must not touch, including which target and which path, goes in the test case's stored `description` before the run. A limit stated only in chat with the coding agent does not reach the run.

- Store it with `muggle-remote-test-case-create`, or with `muggle-remote-test-case-update` on an existing case, keeping the stored text and adding to it. When a generator wrote the draft, check that the limit survived into its `description`.
- Every run reads the stored text: local and cloud, generation, regeneration and replay. Text given for one run adds to it and never replaces it.
- A use case edit that really changes `title`, `description` or `url`, and every `muggle-remote-use-case-update-from-prompt` call, replaces the use case's test cases and drops their limits. Store them again afterwards.
