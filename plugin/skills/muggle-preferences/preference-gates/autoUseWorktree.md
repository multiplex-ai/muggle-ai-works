# `autoUseWorktree`

Create a worktree for the change, or work in the current checkout.

**Picker 1** — header `Worktree`, question `"Create a git worktree for this change, or work in the current checkout?"`
- `Create a worktree` — `Isolate the change so your current checkout stays untouched.` → `always`
- `Use current checkout` — `Edit in place.` → `never`

**Silent action**
- `always` → `Creating a worktree for this change`
- `never` → `Working in the current checkout`
