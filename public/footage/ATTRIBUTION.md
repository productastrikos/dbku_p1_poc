# Sample CCTV footage: attribution and licence

All video and images in this folder are derived from the
**"Multiview Extended Video with Activities" (MEVA) dataset by Kitware Inc. and the
Intelligence Advanced Research Projects Activity (IARPA)**, licensed under the
[Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).

- Dataset: https://mevadata.org/ (licence text: https://mevadata.org/resources/MEVA-data-license.txt)
- Source bucket: https://mevadata-public-01.s3.amazonaws.com/ (AWS Open Data, no sign-in)
- Recorded with consenting actors at the Muscatatuck Urban Training Center, Indiana, USA, in March 2018.
  The footage shows no DBKU assets and no real incidents.

## Changes made

Clips were trimmed, cropped or scaled to 960×540 (the night still is 1280×720), set to 15 fps,
re-encoded as H.264 MP4 or JPEG, and the audio removed. Posters (`*-poster.jpg`) are 480×270
frames from the same files. Nothing else was altered.

## Files

| File | MEVA source clip (camera, local time) | Cut |
|---|---|---|
| `meva-g301-dusk-service-bay.mp4` | `drop-4-hadcv22/2018-03-08/18/2018-03-08.18-30-02.18-35-02.hospital.G301.r13.avi` (G301, 8 Mar 2018 18:30 EST) | 0–200 s, cropped to the service bay (x 940, y 280, 960×540) |
| `meva-g301-dusk-service-bay.jpg` | same clip | frame at 112 s, same crop |
| `meva-g336-day-passerby.mp4` | `drops-123-r13/2018-03-07/11/2018-03-07.11-00-06.11-05-05.school.G336.r13.avi` (G336, 7 Mar 2018 11:00 EST) | 56–100 s, scaled to 960×540 |
| `meva-g336-night-pole.jpg` | `drops-123-r13/2018-03-11/00/2018-03-11.23-55-01.00-00-01.school.G336.r13.avi` (G336, 11 Mar 2018 23:55 EDT) | frame at 120 s, scaled to 1280×720 |
| `meva-g436-night-vehicle.mp4` | `drops-123-r13/2018-03-11/00/2018-03-11.23-55-09.00-00-09.hospital.G436.r13.avi` (G436, 11 Mar 2018 23:55 EDT) | 236–296 s, scaled to 960×540 |

The CCTV Analyzer lists these clips in `src/data/footage.js` with the asset zone that matches
what is in shot. Alerts and case files raised from them are labelled as sample footage and are
never attributed to a DBKU camera.
