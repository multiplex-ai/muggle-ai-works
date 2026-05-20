# Watcher tick log lines

The watcher does **not** print to the user during normal operation. It only appends to `followup.log`. All user-facing escalations come from `/muggle-do`.

## Idle tick

```
<ISO-8601> tick pr=<n> reviews_seen=0 idle
```

## Dispatching tick

```
<ISO-8601> tick pr=<n> reviews_seen=<count> dispatched=<id1>,<id2>,...
```

## Terminal tick

```
<ISO-8601> tick pr=<n> terminal=<merged|closed> result.md written
```
