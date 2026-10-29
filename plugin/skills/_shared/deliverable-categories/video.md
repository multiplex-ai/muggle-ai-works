# Video deliverable check

The flow for a `[video]` criterion. Shared rules — obtaining the artifact, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

## Artifact

A rendered video file: committed at head, or produced by the repo's render command.

## Probes

Read with `ffprobe` unless a step names another tool.

- Container and codec.
- Duration, against the stated length or range.
- Resolution and frame rate.
- Audio-track presence, when the criterion implies sound.
- Black stretches (`ffmpeg` `blackdetect`) and frozen stretches (`freezedetect`) longer than one second, unless the criterion calls for them.

## Review

Extract a frame with `ffmpeg` at every timestamp a criterion names, plus the first frame, the last, and one every 5 seconds — at most 24 in all. View each one against the criterion:

- On-screen text present and spelled as specified.
- Scenes in the stated order.
- Captions on screen when they should be.

## Inconclusive when

- `ffprobe` or `ffmpeg` is missing.
- The render fails for an environment reason.
