# App assets (required before `eas build`)

The store metadata in `../app.json` references the following binary assets.
They are intentionally NOT committed (no binary tooling in this repo flow) —
add them locally before running `npx expo prebuild` / `eas build`:

| File                     | Spec                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `icon.png`               | 1024x1024, no transparency (iOS rejects alpha), square      |
| `adaptive-icon.png`      | 1024x1024 foreground, keep art inside the center 66% circle |
| `splash.png`             | ~1284x2778 (portrait), centered logo on `#f8fafc`           |
| `notification-icon.png`  | 96x96, white-on-transparent (Android status-bar glyph)      |

Brand reference: primary teal `#0f766e` on light slate `#f8fafc`
(see `../src/theme.ts`). Generate a full set from one master with:

```bash
npx @expo/image-utils  # or use https://icon.kitchen
```
