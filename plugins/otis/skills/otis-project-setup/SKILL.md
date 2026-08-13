---
name: otis-project-setup
description: Use when a user needs a local SpiderByte workspace, organization, project, or durable session prepared before data or ML work.
---

# Otis project setup

## Activation conditions

Activate for requests to create, discover, register, or inspect a SpiderByte
workspace, organization, project, permissions, or session.

## Required tools

`get_capabilities`, `list_workspaces`, and `list_projects`.
Workspace registration, organization/project mutation, and session creation
remain local CLI or full-profile operations; never invent an ID when the
curated server has not returned one.

## Workflow

1. Inspect capabilities and existing workspaces first.
2. Reuse an existing workspace when its root and scope match; do not create a
   duplicate merely to satisfy a prompt.
3. Register a directory only after confirming it exists and is the intended
   local data boundary.
4. Create or inspect the local organization/project records and permissions.
5. Create a session with an explicit workspace and report the resulting IDs.

## Confirmation and failure handling

Ask before registering a path outside the current project or creating durable
records. Stop on workspace ambiguity, path validation errors, or permission
failures; do not guess a workspace. Hosted membership and team administration
are unavailable in Open Core.

## Expected output

Return workspace, project, session, root, and local/hosted capability status.
Never claim hosted membership, billing, or enterprise permissions.

## Example

“Create a local project for `/data/forecast`, then prepare a governed session.”

## Privacy and security

Keep absolute paths limited to the user’s selected local scope. Do not expose
tokens, provider secrets, or credentials. MCP authorization and workspace
checks remain server-side.
