# Watcher tick log lines

The watcher does **not** print to the user during normal operation. It only appends to `followup.log`. All user-facing escalations come from `/muggle-do`.

## Idle tick

```
<ISO-8601> tick pr=<n> threads=0 idle
```

## Dispatching tick

```
<ISO-8601> tick pr=<n> threads=<count> dispatched=<id1>,<id2>,...
```

## Parked tick

Entering the backoff (a durable human-block was detected), then each subsequent tick that recomputed the fingerprint and stayed parked:

```
<ISO-8601> tick pr=<n> parked reason=<conflict_escalated|ci_escalated|reviews_escalated>
<ISO-8601> tick pr=<n> parked idle
```

## Unparked tick

The fingerprint moved (new head sha, review, or CI state) and the watcher restored the `1m` cadence:

```
<ISO-8601> tick pr=<n> unparked
```

## Terminal tick

```
<ISO-8601> tick pr=<n> terminal=<merged|closed> result.md written
```
