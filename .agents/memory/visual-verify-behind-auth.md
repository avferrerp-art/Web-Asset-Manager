---
name: Visual verification when the app is behind Clerk sign-in
description: How to produce UI screenshots for verification when the web app requires login
---
The screenshot tool cannot sign in, so any authenticated page renders the Clerk login screen.

**Why:** the standalone screenshot tool has no authenticated session, but the browser tester can use a supported Clerk test session. A mockup alone cannot verify the real page.

**How to apply:** prefer the authenticated browser tester for required real-page evidence; use browser-only response fixtures for unavailable edge cases and label them explicitly. A mockup is only a clearly labelled visual fallback, never evidence of the real flow.

For catalog evidence, prefer an exact reference over a one-letter search.

**Why:** broad searches twice timed out the browser worker during capture; a narrow real reference allowed the same verification to finish. The root cause was not established, so do not assume this proves an API defect.
