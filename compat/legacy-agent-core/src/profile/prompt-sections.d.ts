/**
 * Shared prompt-section prose — the single source for the three
 * environment-dependent prose blocks that appear in BOTH the builtin default
 * prompt and agent-file prompts:
 *
 * - `profile/default/system.md` renders them through the `KIMI_WINDOWS_NOTES`
 *   / `KIMI_ADDITIONAL_DIRS_SECTION_PROSE` / `KIMI_SKILLS_SECTION_PROSE`
 *   template variables injected by `resolve.ts#buildTemplateVars`;
 * - `profile/agentfile/from-file.ts` composes them into the agent-file
 *   `${windows_notes}` / `${additional_dirs_section}` / `${skills_section}`
 *   variables.
 *
 * Edit the text HERE only — the two render paths must never drift apart.
 */
export declare const WINDOWS_NOTES = "IMPORTANT: You are on Windows. The Bash tool runs through Git Bash, so use Unix shell syntax inside Bash commands \u2014 `/dev/null` not `NUL`, and forward slashes in paths. For file operations, always prefer the built-in tools (Read, Write, Edit, Glob, Grep) over Bash commands \u2014 they work reliably across all platforms.";
export declare const ADDITIONAL_DIRS_SECTION_PROSE = "The following directories have been added to the workspace. You can read, write, search, and glob files in these directories as part of your workspace scope.";
export declare const SKILLS_SECTION_PROSE: string;
