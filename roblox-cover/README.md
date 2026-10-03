# Iron Tide: Roblox cover art

A minimalist cover in the style of Pacific Rim: a giant mech and a kaiju face off at sunset.

| File | Size | Roblox slot |
| --- | --- | --- |
| `thumbnail.png` | 1920×1080 | Game thumbnail |
| `icon.png` | 512×512 | Game icon |

The `.svg` files are the vector sources, with the title font embedded.

## Editing

Change `TITLE` / `TAGLINE` at the top of `build.mjs`, then run:

```sh
node roblox-cover/build.mjs
```

This rewrites both SVGs and renders the PNGs with headless Chromium. Set `CHROME=/path/to/chrome` if Chromium is installed somewhere else.

The title font is [Russo One](https://fonts.google.com/specimen/Russo+One), licensed under the SIL Open Font License.
