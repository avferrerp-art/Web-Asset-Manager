/**
 * Semantic design tokens for LogiFleet Chofer.
 *
 * Synced from artifacts/logistics/src/index.css (dark slate + amber theme).
 * The app is dark-branded, so both schemes use the same dark palette.
 */

const palette = {
  // Legacy aliases (kept for backward compatibility)
  text: "#f8fafc",
  tint: "#f59e0b",

  // Core surfaces
  background: "#0f172a",
  foreground: "#f8fafc",

  // Cards / elevated surfaces
  card: "#0b101e",
  cardForeground: "#f8fafc",

  // Primary action color (buttons, links, active states)
  primary: "#f59e0b",
  primaryForeground: "#0f172a",

  // Secondary / less-emphasis interactive surfaces
  secondary: "#1e293b",
  secondaryForeground: "#f8fafc",

  // Muted / subdued elements (dividers, timestamps, placeholders)
  muted: "#1e293b",
  mutedForeground: "#94a3b8",

  // Accent highlights (badges, selected items, focus rings)
  accent: "#1e293b",
  accentForeground: "#f8fafc",

  // Destructive actions (delete, error states)
  destructive: "#ef4444",
  destructiveForeground: "#f8fafc",

  // Borders and input outlines
  border: "#1e293b",
  input: "#1e293b",
};

const colors = {
  light: palette,
  dark: palette,

  // Border radius (in px), synced from the web artifact's --radius.
  radius: 12,
};

export default colors;
