# Stable Project ID Contract

A new project must call `scripts/project_identity.mjs` with `{ title, filename, existing_ids }` and validate its result.
The title has priority; when it cannot produce a slug, use the filename without extension. The script accepts only ASCII lowercase alphanumeric slugs and increments conflicts from `-2`. Do not copy or extend the algorithm. An existing project retains its validated ID.

The Planning Agent writes `project_id` into the plan. Before writing, the Execution Agent rescans `existing_ids`; if the result differs from the confirmed revision, it must update the plan revision, invalidate the confirmation snapshot, and obtain user confirmation again.
