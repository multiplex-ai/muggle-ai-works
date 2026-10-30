# Audio deliverable check

The flow for an `[audio]` criterion. Shared rules — obtaining the artifact, verdicts, the report entry — live in the `deliverable-categories.md` index beside this folder, which opens this file.

**Verified by:** deliverable check.

## Artifact

An audio file: committed at head, or produced by the repo's render or text-to-speech command.

## Probes

Read with `ffprobe` unless a step names another tool.

- Codec.
- Duration, against the stated length or range.
- Sample rate and channel count.
- Integrated loudness and true peak (`ffmpeg` `ebur128`), against any stated target.
- Silence stretches (`silencedetect`) longer than two seconds, unless the criterion calls for them.

## Review

Transcribe spoken content with a speech-to-text tool available on the machine, and compare the transcript with the script or the criterion.

## Inconclusive when

- `ffprobe` or `ffmpeg` is missing.
- No transcription is available. Only the spoken-content review is `INCONCLUSIVE`, with reason `no transcription available`; the probes still run and report.
- The audio cannot be produced for an environment reason.
