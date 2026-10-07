# Tame Impala – Currents (Seelen UI live wallpaper)

An animated 1920×1080 wallpaper inspired by the *Currents* album art. A chrome
ball sits in a field of purple flow lines that break into a swirling wake
behind it. A red streak runs into the ball and comes out as an orange ribbon.
The loop is 24 seconds long, runs at 30 fps and has no visible seam.

![preview](tame-impala-currents/thumbnail.jpg)

## Install

1. Copy the whole `tame-impala-currents` folder into
   `%APPDATA%\com.seelen.seelen-ui\wallpapers\`.
   (Paste that path into the Explorer address bar.)
2. Restart Seelen UI. It reads the wallpapers folder on startup.
3. Open **Settings → Wallpapers** and pick **Tame Impala - Currents**.

Quick alternative: add `tame-impala-currents/currents.mp4` through Seelen UI's
own add-wallpaper button. That also works, but the wallpaper shows up under
the file name and has no custom thumbnail.

## Files

| File | What it is |
| --- | --- |
| `tame-impala-currents/metadata.yml` | Seelen UI wallpaper resource definition (`type: Video`) |
| `tame-impala-currents/currents.mp4` | The looping video (H.264, no audio) |
| `tame-impala-currents/thumbnail.jpg` | Full-res still: picker thumbnail and the static fallback when Seelen pauses video wallpapers |
| `render/currents.py` | Procedural renderer used to make the video |

## Re-rendering (other resolutions, lengths, tweaks)

The whole scene is generated in code: no source footage, no 3D software.
You need Python 3 with `numpy` and `Pillow`, plus `ffmpeg` on your PATH.

```sh
# 1440p version of the same 24s loop
python3 render/currents.py video currents-1440p.mp4 --w 2560 --h 1440

# single still frame (t is the loop phase, 0..1)
python3 render/currents.py still frame.png --t 0.25
```

Colours, stripe size, ball position and camera angle are constants at the top
of `render/currents.py`. Every animated part moves a whole number of noise
periods per loop, so any `--seconds` value still loops seamlessly. A longer
loop means slower flow.

Fan art, for personal use. *Currents* artwork © Tame Impala / Robert Beatty.
