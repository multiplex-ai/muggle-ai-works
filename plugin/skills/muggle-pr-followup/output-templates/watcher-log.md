# Watcher tick log lines

The watcher only appends to `followup.log` during normal operation; the one visible exception is the one-line owner reminder on a blocked tick ([`blocked-reminder.md`](blocked-reminder.md)). All user-facing escalations come from `/muggle-do`.

## Idle tick

```
<ISO-8601> tick pr=<n> threads=0 idle
```

## Dispatching tick

```
<ISO-8601> tick pr=<n> threads=<count> dispatched=<id1>,<id2>,...
```

## Blocked tick

The tick idled on a durable human-block ([`../contract.md`](../contract.md) Step 7) and emitted the one-line owner reminder ([`blocked-reminder.md`](blocked-reminder.md)). One per tick for as long as the block stands — the cadence stays `1m`:

```
<ISO-8601> tick pr=<n> blocked reason=<conflict_escalated|ci_escalated|reviews_escalated>
```

When the fingerprint moves the block clears and the tick logs a normal idle or dispatching line — there is no separate unblock line.

## Terminal tick

```
<ISO-8601> tick pr=<n> terminal=<merged|closed> result.md written
```
