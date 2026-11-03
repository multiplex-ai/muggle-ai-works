<!-- muggle-e2e-result:v1 {"total":3,"passed":1,"unpassed":[{"name":"Shopper sees an error for an expired card","testCaseId":"tc-expired","status":"failed","failedStep":2,"detail":"The order was accepted although the card is expired.","viewUrl":"https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p-summary/runs/run-expired"},{"name":"Shopper applies a discount code","testCaseId":"tc-discount","status":"inconclusive","detail":"The run stopped on a login wall before reaching the cart.","viewUrl":"https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p-summary/runs/run-discount"}]} -->
## E2E Acceptance Results

### Summary

**❌ FAIL** — 3 tests ran · 1 passed / 1 failed / 1 inconclusive

**Needs attention**

- ❌ **Shopper sees an error for an expired card** — failed at step 2: The order was accepted although the card is expired. · [see details](#muggle-test-tc-expired)
- ⚠️ **Shopper applies a discount code** — inconclusive: The run stopped on a login wall before reaching the cart. · [see details](#muggle-test-tc-discount)

- ✅ **1.** Shopper completes checkout with a saved card · [see details](#muggle-test-tc-checkout)
- ❌ **2.** Shopper sees an error for an expired card · [see details](#muggle-test-tc-expired)
- ⚠️ **3.** Shopper applies a discount code · [see details](#muggle-test-tc-discount)

---

### Test details

<a name="muggle-test-tc-checkout"></a>

#### ✅ 1. Shopper completes checkout with a saved card

| **Result** | ✅ Passed |
|:--|:--|
| **Run** | 2 browser steps · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p-summary/runs/run-checkout" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 2 steps and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Click 'Checkout' to open the payment page.</summary>
<dl><dd>

| Before | After |
|:--|:--|
| <img src="https://cdn.example/checkout-0.png" width="420" alt="Step 1 before"> | <img src="https://cdn.example/checkout-1.png" width="420" alt="Step 1 after"> |

</dd></dl>
</details>
<details><summary>📷 2 · Click 'Pay now' to submit the order.</summary>
<dl><dd>

| Before | After |
|:--|:--|
| <img src="https://cdn.example/checkout-1.png" width="420" alt="Step 2 before"> | <img src="https://cdn.example/checkout-summary.png" width="420" alt="Step 2 after"> |

</dd></dl>
</details>
<details><summary>🏁 Summary · ✅ Success — Order placed and the confirmation page shows the order total</summary>
<dl><dd>

**Verdict:** PASS - the order confirmation rendered with the charged total.

**Blocking issues:** None

<img src="https://cdn.example/checkout-summary.png" width="640" alt="Run summary">

</dd></dl>
</details>

</dd></dl>
</details>

**Ending screen** — Final page after the test completed

<img src="https://cdn.example/checkout-summary.png" width="720" alt="Shopper completes checkout with a saved card">

---

<a name="muggle-test-tc-expired"></a>

#### ❌ 2. Shopper sees an error for an expired card

| **Result** | ❌ Failed at step 2 |
|:--|:--|
| **Why** | The order was accepted although the card is expired. |
| **Run** | 2 browser steps · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p-summary/runs/run-expired" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 2 steps and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Input the expired card number in the 'Card number' field.</summary>
<dl><dd>

| Before | After |
|:--|:--|
| <img src="https://cdn.example/expired-0.png" width="420" alt="Step 1 before"> | <img src="https://cdn.example/expired-1.png" width="420" alt="Step 1 after"> |

</dd></dl>
</details>
<details><summary>📷 2 · Click 'Pay now' to submit the order.</summary>
<dl><dd>

| Before | After |
|:--|:--|
| <img src="https://cdn.example/expired-1.png" width="420" alt="Step 2 before"> | <img src="https://cdn.example/expired-summary.png" width="420" alt="Step 2 after"> |

</dd></dl>
</details>
<details><summary>🏁 Summary · ❌ Bug detected — Expired card was charged instead of rejected</summary>
<dl><dd>

**Verdict:** FAIL - the app accepted an expired card.

**Blocking issues:** Payment form submits an expired card; no validation error is shown.

<img src="https://cdn.example/expired-summary.png" width="640" alt="Run summary">

</dd></dl>
</details>

</dd></dl>
</details>

**Ending screen** — Failure at step 2

<img src="https://cdn.example/expired-summary.png" width="720" alt="Shopper sees an error for an expired card">

---

<a name="muggle-test-tc-discount"></a>

#### ⚠️ 3. Shopper applies a discount code

| **Result** | ⚠️ Inconclusive |
|:--|:--|
| **Why** | The run stopped on a login wall before reaching the cart. |
| **Run** | 1 browser step · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p-summary/runs/run-discount" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 1 step and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Workflow started at the app's URL.</summary>
<dl><dd>

<img src="https://cdn.example/discount-0.png" width="640" alt="Step 1">

</dd></dl>
</details>

⚠️ **No summary step** — the run ended before it summarized its result; open the run on Muggle AI for its last state.

</dd></dl>
</details>

**Ending screen** — Last frame before run was cut short

<img src="https://cdn.example/discount-0.png" width="720" alt="Shopper applies a discount code">