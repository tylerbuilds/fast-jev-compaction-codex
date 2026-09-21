---
name: fast-jev-compaction
description: Compact a supplied conversation transcript with Jev while keeping user and assistant text verbatim. Use when a user asks to reduce a saved transcript or preserve useful tool context; do not use it as a claim that Codex's private automatic compaction can be replaced.
---

# Fast Jev compaction

Use the `fast_jev_compaction_compact` MCP tool for a supplied transcript. It
scores each non-pinned tool call and result, keeps useful material verbatim,
truncates results that are still useful only as a trace, and removes calls that
no longer matter. User and assistant text is not rewritten by the compactor.

This plugin sends the transcript's task text and tool inputs to the direct
TypeSafe API by default. Before calling the tool, make sure the user
has authorised sending that transcript to the external service and set
`confirmExternalTransmission: true`. Do not pass credentials, tokens, cookies,
or other sensitive material unless the user has explicitly approved that
specific transmission. Authentication comes from `TYPESAFE_API_KEY` or the
configured macOS Keychain item; never put credentials in a prompt, transcript,
file, or tool argument.

Pass the transcript as the `messages` array using the library's message shape:
`role`, `text`, `toolUses`, and optional `toolResults`. Keep the original
transcript unchanged until the tool returns successfully. Report the returned
`stats` and decisions, and save or apply the returned `messages` only when the
user asks for that destination.

The Codex plugin surface has no supported hook for replacing Codex's internal
automatic compaction. Do not claim that this plugin intercepts `/compact` or
automatic Codex compaction. If the host compacts before this skill is invoked,
continue from the host-provided context and use this tool only for an explicit
transcript artifact.
