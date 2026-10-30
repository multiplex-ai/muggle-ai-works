# Image deliverable check

The flow for an `[image]` criterion. Shared rules — obtaining the artifact, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

**Verified by:** deliverable check.

## Artifact

A raster or vector image: committed at head, or produced by the repo's build or export command.

## Probes

Read with `ffprobe` for raster images; read an SVG's markup directly.

- Format.
- Pixel dimensions, or the `viewBox` for SVG.
- Aspect ratio.
- File size, against any stated budget.
- Alpha channel, when the criterion requires transparency.

## Review

View the image against the criterion:

- Text legible and spelled as specified.
- Required elements present.
- Nothing cropped or clipped.

A changed image is also viewed beside its base-branch version; every difference the criterion does not ask for is a finding.

## Inconclusive when

- `ffprobe` is missing for a raster image.
- The image cannot be produced for an environment reason.
