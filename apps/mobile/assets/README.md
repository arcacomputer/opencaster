# Native icon assets

These icons derive from the existing OpenCaster symbol in
`apps/web-client/public/opencaster-symbol.svg` and preserve its colors and path
geometry, project license and upstream attribution.

- `icon.svg` / `icon.png`: full-bleed square background; 1024×1024 RGB PNG without
  alpha or baked rounded corners. Used for the default iOS/Android icon.
- `adaptive-icon.svg` / `adaptive-icon.png`: transparent 432×432 Android foreground
  with the existing mark scaled by 0.68 about the center, inside the central
  66-dp safe circle of a 108-dp layer. Background color is `#292335` in app config.
- `monochrome-icon.svg` / `monochrome-icon.png`: matching white foreground for
  Android themed icons.

SVG files are editable sources; PNG files are their raster exports. Render each
SVG into an exact square viewport at the PNG's stated dimensions, preserving
transparency for the adaptive/monochrome layers and exporting the default icon
as RGB. No additional runtime or build dependency is required. Expo Prebuild
generates each platform's native icon resources from the configured PNG files.

These are native app assets, not store screenshots, approved store listings or
evidence of signed-distribution readiness. Validate actual launcher rendering
after rebuilding the native application; a JavaScript reload is insufficient.
