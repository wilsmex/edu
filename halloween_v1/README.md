# Halloween Puppet Pose Tracker

A p5.js application that uses ml5.js BodyPose (MoveNet) to track people with a webcam and draw articulated Halloween puppets over a looping background video. Each person is assigned one of three puppet styles, and the app keeps that style as they move.

## Launch

1. Keep this folder together, including `assets/`, `p5.min.js`, `ml5.min.js`, `sketch.js`, and `style.css`.
2. Double-click `index.html`, or open it from your browser's File → Open menu.
3. Click **Start** and allow the camera. This click also starts the music.

**No local web server, Python, Node.js, installation, or build step is needed.**

An internet connection is still required to download the pose model when tracking starts. The libraries, puppet images, video, and music are local. Camera frames are processed in the browser.

Use a desktop browser that allows camera access from local files, such as Chrome or Firefox. Camera permissions can vary by browser and system settings. If camera access is blocked, allow it in the browser and operating system settings, then click **Try again**. If another app is using the webcam, close that app first.

## Assets

The app uses these seven images from each of `assets/scene0/`, `assets/scene1/`, and `assets/scene2/`:

| Filename | Puppet part |
| --- | --- |
| `skull.png` | Head |
| `chest.png` | Torso |
| `hips.png` | Hips |
| `arm_upper_right.png` | Upper arms |
| `arm_mid_right.png` | Forearms |
| `leg_upper_left.png` | Upper legs |
| `leg_lower_left.png` | Lower legs |

Opposite limbs are generated from the source images. Missing images fall back to labeled colored rectangles. Replace images in place and reload the page; no asset packaging is required.

- `assets/video.mp4`: shared background video, muted and looping.
- `assets/music.mp3`: shared background music, looping after Start.
- `NUM_SCENES` in `sketch.js`: number of puppet styles.
- `LOAD_CUSTOM_ASSETS` in `sketch.js`: set to `false` to use only placeholder parts.

The webcam feed is hidden; only the background and puppets are displayed. Puppet styles are assigned automatically; there is no scene-switching key.

## How direct-file launch works

Puppet images load through native browser image elements and are drawn into p5 images, avoiding the HTTP requests in `p5.loadImage()`. Native audio plays the music instead of `p5.sound`. The background video loads without a cross-origin attribute so it can play from a local file. Camera and model initialization wait for actual readiness rather than a fixed delay.

`p5.sound.min.js` is retained but no longer loaded. `start-server.sh` is optional for anyone who still prefers a localhost URL; it requires Python to be installed.
