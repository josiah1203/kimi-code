// Hint shown beneath session-level error messages in the TUI to point users
// at the local diagnostic export workflow.
export function errorReportHintLine(): string {
  return "If this persists, run `/export-debug-zip` and share the file with your maintainers. Please don't share it publicly.";
}
