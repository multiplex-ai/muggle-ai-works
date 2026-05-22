# Step 8: Final Readiness Report

Only after every service passes [Step 7](./step-7-smoke-test.md) or is skipped.

```
Service              PID      Port     Status         Smoke Test
─────────────────────────────────────────────────────────────────
backend-api          12345    3001     Running        ✓
auth-service         12346    8080     Running        ✓
frontend             12347    3000     Running        ✓
─────────────────────────────────────────────────────────────────
All 3 services verified. Ready for E2E.
```

Surface skipped services so the caller knows the gap:

```
Skipped: payment-gateway — HTTP 500 on /
```

If you launched the services:

```
Logs: /tmp/muggle-prepare-*.log
Cleanup: say "stop services" or re-invoke this skill.
```
