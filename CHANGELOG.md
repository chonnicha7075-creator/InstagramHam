# Changelog

## [0.2.0] - 2026-04-24

### Added
- 🖱️ Draggable FAB with position persistence
- 🛟 `/insta` slash command to reset FAB position
- 🪲 Verbose console logging for debugging
- 🛡️ Defensive error handling throughout init
- 📱 Phone icon instead of camera icon

### Fixed
- FAB was being hidden behind SillyTavern chat input bar
- Duplicate imports removed
- Critical styles now use `!important` to override SillyTavern CSS
- Higher z-index to prevent stacking conflicts

### Changed
- `structuredClone` replaced with `JSON.parse(JSON.stringify())` for broader compatibility
- FAB position now configurable and saved per-user
- Reset button added in settings

## [0.1.0] - 2026-04-24

- Initial release
- Auto-posting based on scene analysis
- Feed, Profile, Discover, DM, Compose tabs
- Pollinations AI image generation
- NPC auto-comments
- User post with character reactions
