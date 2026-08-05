---
name: Visual verification when the app is behind Clerk sign-in
description: How to produce UI screenshots for verification when the web app requires login
---
The screenshot tool cannot sign in, so any authenticated page renders the Clerk login screen.

**How to apply:** build a small self-contained mockup in `artifacts/mockup-sandbox/src/components/mockups/<name>.tsx` (plain relative imports of `../ui/*`, mock data mirroring real DB rows) and screenshot `/preview/<name>` on the mockup-sandbox artifact. Verify the real data/behavior separately: run the actual Express router standalone (see run-server-code-standalone) plus SQL checks, and pair those numbers with the mockup capture.
