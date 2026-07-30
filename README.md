# macOS desktop pet 3.0.2

A transparent, always-on-top macOS desktop pet built with Electron, Vite,
Three.js, and `@pixiv/three-vrm`.

This public repository does not include a default VRM model or VRMA animation
files. Users import files they have permission to use from inside the App.

## Features

- Up to five independently managed desktop pets
- Per-pet VRM and VRMA imports
- Independent size, roaming, dance, and window state
- Solo dance and synchronized group dance modes
- Mouse interaction, dragging, walking, idle motions, and music-responsive dance
- Multi-display window movement
- Individual asset deletion and complete pet reset

## Requirements

- macOS 11 or later
- Apple Silicon Mac for the downloadable v3.0.2 build
- Node.js and npm only when running from source

## Run from source

```bash
npm install
npm run dev
```

## Build the macOS App

```bash
npm run package:mac
```

The public build intentionally excludes all `.vrm` and `.vrma` files.

## First launch

The downloadable App uses an ad-hoc signature rather than an Apple Developer ID.
After copying it to Applications, macOS may require right-clicking the App,
choosing **Open**, and confirming once.

## File naming

The App uses VRMA filenames to identify common roles:

- `idle` — idle
- `sit` — sitting idle
- `sleep` or `nap` — sleeping idle
- `walk` — walking
- `drag` or `stumble` — drag reaction
- `land` — landing reaction
- `VRMA_01` through `VRMA_07` — click interactions
- Other successfully loaded VRMA files — dance motions

Only successfully loaded animations are added to interaction and dance lists.

## Privacy

Imported models and animations stay in the current user's local application
data directory. The App does not upload them.

## Notes

- The downloadable build is currently arm64-only.
- No VRM or VRMA license is granted by this repository.
- Only import assets that you are allowed to use.
