<!-- muggle-e2e-result:v1 {"total":3,"passed":2,"unpassed":[{"name":"Checkout flow","testCaseId":"tc-2","status":"failed","failedStep":3,"detail":"Element not found: button[data-testid='confirm-order']","viewUrl":"https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-2"}]} -->
## E2E Acceptance Results

### Summary

**❌ FAIL** — 3 tests ran · 2 passed / 1 failed / 0 inconclusive

**Needs attention**

- ❌ **Checkout flow** — failed at step 3: Element not found: button[data-testid='confirm-order'] · [see details](#muggle-test-tc-2)


<details><summary><b>User Authentication</b> — ✅ 1 passed</summary>
<dl><dd>

- ✅ **1.** Login flow · [see details](#muggle-test-tc-1)

</dd></dl>
</details>

<details open><summary><b>Purchase</b> — ❌ 1 failed</summary>
<dl><dd>

- ❌ **2.** Checkout flow · [see details](#muggle-test-tc-2)

</dd></dl>
</details>
- ✅ **3.** Profile page · [see details](#muggle-test-tc-3)

---

### Test details

<a name="muggle-test-tc-1"></a>

#### ✅ 1. Login flow

_Verify that a returning user can sign in with valid credentials and land on the dashboard._

| **Result** | ✅ Passed |
|:--|:--|
| **Run** | 3 browser steps · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-1" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 3 steps and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Navigate to /login</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-1%2F0.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 1">

</dd></dl>
</details>
<details><summary>📷 2 · Enter username</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-1%2F1.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 2">

</dd></dl>
</details>
<details><summary>📷 3 · Click Sign In</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-1%2F2.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 3">

</dd></dl>
</details>

**Ending screen** — Final page after the test completed

<img src="https://cdn.muggle.ai/run-1/2.png" width="720" alt="Login flow">

</dd></dl>
</details>

---

<a name="muggle-test-tc-2"></a>

#### ❌ 2. Checkout flow

_Verify a shopper can complete checkout with a saved payment method._

| **Result** | ❌ Failed at step 3 |
|:--|:--|
| **Why** | Element not found: button[data-testid='confirm-order'] |
| **Run** | 3 browser steps · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-2" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 3 steps and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Add item to cart</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-2%2F0.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 1">

</dd></dl>
</details>
<details><summary>📷 2 · View cart</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-2%2F1.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 2">

</dd></dl>
</details>
<details><summary>📷 3 · Click confirm</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-2%2F2.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 3">

</dd></dl>
</details>

**Ending screen** — Failure at step 3

<img src="https://cdn.muggle.ai/run-2/2.png" width="720" alt="Checkout flow">

</dd></dl>
</details>

---

<a name="muggle-test-tc-3"></a>

#### ✅ 3. Profile page

| **Result** | ✅ Passed |
|:--|:--|
| **Run** | 1 browser step · <a href="https://www.muggle-ai.com/muggleTestV0/dashboard/runs/run-3" target="_blank" rel="noopener noreferrer">Open the full run on Muggle AI →</a> |

<details><summary><kbd>Show 1 step and screenshots</kbd></summary>
<dl><dd>

**Steps** — click a step to see its screenshots

<details><summary>📷 1 · Open profile</summary>
<dl><dd>

<img src="https://images.weserv.nl/?url=https%3A%2F%2Fcdn.muggle.ai%2Frun-3%2F0.png&amp;w=840&amp;q=70&amp;output=jpg" width="640" alt="Step 1">

</dd></dl>
</details>

**Ending screen** — Final page after the test completed

<img src="https://cdn.muggle.ai/run-3/0.png" width="720" alt="Profile page">

</dd></dl>
</details>