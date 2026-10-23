# Replay or learn

One decision, made before anything else: does a prepare recipe already exist for this stack?

Resolve the recipe location per [confirm-recipe](./confirm-recipe.md).

- **Recipe exists** → **replay run**. Run [rebase-check](./rebase-check.md) and [resolve-sources](./resolve-sources.md), then go straight to the execute phase. No scan, no interview, no questions. The whole point of having learned is not to ask again.
- **No recipe** → **learning run**. Run the Decide stages in order, then the single gate at the end.

A recipe the user declined to save is the same as no recipe: the next run learns again. Declining is not a permanent no, it just means nothing was written.

## What a replay is allowed to do

Execute the recorded steps, in the recorded order, using the recorded commands — from the checkouts [resolve-sources](./resolve-sources.md) picked this run, never the directories the recipe was learned in. When a step fails, consult the recipe's recorded resolutions **first** — a problem solved before is solved the same way again, without asking.

Only a [hard block](./confirm-recipe.md#hard-block) permits a replay to deviate or prompt.

## Reuse gate

`reusePreparePlan` still governs whether a found recipe is used at all. `never` forces a learning run even when a recipe exists — the escape hatch for a stack that has been re-architected.
