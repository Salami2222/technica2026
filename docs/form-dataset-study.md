# Mendeley v2 side-view pilot

Source: [A Multi-View Raw Video Dataset of Seven Fitness Exercises with Good/Bad Form Labels, v2](https://data.mendeley.com/datasets/kgbb3yn47p/2), DOI 10.17632/kgbb3yn47p.2, CC BY 4.0. The data creators recorded standard floor push-ups and bodyweight squats with smartphones. These results are a small reproducible pilot, **not validated scoring calibration**.

## Files and method

- Processed the **32 named MP4s** in [`scripts/mendeley-side-manifest.csv`](../scripts/mendeley-side-manifest.csv): each of eight participant IDs (001–008), both labels, squat and push-up, side view. No front/diagonal videos were processed.
- SHA-256 showed `subject_006_squat_good_side.mp4` and `subject_006_squat_bad_side.mp4` are byte-identical to the corresponding subject 005 files. Both were excluded from evaluation. Thus **30 unique videos** were evaluated. They are still listed as processed source files in the manifest.
- The offline script used the app's Pose Landmarker Full model and VIDEO-mode 0.5 detector/presence/tracking confidence settings. It sampled letterboxed 640×480 video at 10 FPS and used the same 0.40 landmark visibility threshold. The TypeScript live scorer scored the extracted `FormSample` sequences directly.
- The high–low–high segmenter found **346 complete cycles** and marked **9 uncertain cycles** across the 30 unique videos. These automatic boundaries were not manually reviewed. A bad push-up video (`subject_001_push_up_bad_side.mp4`) produced no complete scoreable cycle; it remains in coverage counts and has no invented score.
- Participant IDs 001–006 were used for training and 007–008 for a held-out check. No participant ID crosses the split. Exact duplicate files were removed before the split. Metrics are calculated per **video**, not per frame or repetition.

## Observed video-level performance

"Good" is the positive class. Confusion entries are TP / TN / FP / FN, where FP means bad labeled footage scored as good. The baseline labels a video good if its mean repetition score is at least the app's current **7/10** marker.

| Exercise | Rule | Train scored | Held-out scored | Held-out accuracy | Precision | Recall | F1 | TP / TN / FP / FN |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Squat | 7/10 baseline | 10/10 | 4/4 | 0.50 | 0.50 | 1.00 | 0.67 | 2 / 0 / 2 / 0 |
| Squat | training-selected 7/10 | 10/10 | 4/4 | 0.50 | 0.50 | 1.00 | 0.67 | 2 / 0 / 2 / 0 |
| Push-up | 7/10 baseline | 11/12 | 4/4 | 0.50 | 0.50 | 1.00 | 0.67 | 2 / 0 / 2 / 0 |
| Push-up | exploratory 7.5/10 | 11/12 | 4/4 | 0.75 | 0.67 | 1.00 | 0.80 | 2 / 1 / 1 / 0 |

The push-up 7.5 cutoff was chosen using training videos only. The held-out change amounts to **one video** of four and is insufficient grounds to change the live marker. Training push-up accuracy was 0.73 at 7/10 and 0.82 at 7.5/10. Squat training accuracy remained 0.50 at 7/10.

## Feature comparison

Training-set medians are per-video averages of complete observed cycles; they are descriptive and not independent clinical measurements.

| Feature | Good | Bad | Observation |
| --- | ---: | ---: | --- |
| Squat minimum knee angle | 75.1° | 72.2° | Bad-labeled examples were **not shallower** in this small sample. A stricter depth band is unsupported. |
| Squat knee excursion | 87.0° | 88.2° | Essentially overlapping. |
| Squat torso-inclination change | 24.9° | 23.4° | Overlapping; the current torso category cannot be validated from the video label alone. |
| Squat hip-path jitter / torso length | 0.025 | 0.017 | Direction is opposite a simple “bad form means more jitter” assumption. |
| Squat depth-consistency gap | 5.7° | 7.6° | Small separation with uncertain cycle boundaries. |
| Push-up elbow excursion | 57.9° | 50.9° | Some separation, but interquartile ranges overlap. |
| Push-up pike offset / body length | 0.008 | 0.103 | A visible difference in this subset, with overlap and at least one good-labeled outlier. |
| Push-up sag offset / body length | 0.039 | 0.063 | Weak separation. |
| Push-up wrist drift / body length | 0.032 | 0.039 | Small difference. |
| Push-up control speed ratio | 1.81× | 1.66× | No support for tightening the current smoothness band. |

The exercise labels are binary **whole-video quality** labels; they do not identify whether a given squat's depth, torso, hip path, or speed is the reason for “bad.” The source videos were captured with smartphones, while live use is a Kinect V1. This pilot cannot validate the meaning of a 0–10 score, individual category bands, or injury risk. The live configuration in `src/form/config.ts` therefore remains marked as manually selected. No runtime threshold was changed. A larger set with fault-specific labels, manually checked repetition boundaries, repeated subject-held-out validation, and real Kinect recordings is needed before applying calibration.

## Reproduce

Follow the commands in the README's **Offline labeled-data study** section. The script produces ignored `work/form-dataset/measurements.jsonl` and `work/form-dataset/report.json`. The JSON report includes all per-file cycle counts, full feature quartiles, both train and held-out metrics, duplicate exclusions, and the exact split. The manifest stores official v2 file IDs; it is lightweight and committed, while raw videos and extracted landmarks are excluded from Git.
