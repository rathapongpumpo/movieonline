# Project Agent Instructions

## File References

When referencing files in responses, use clickable markdown links that point to the exact file and single start line whenever possible.

Use the filename as the link label and an absolute Windows path with a line number as the target, for example:

`[environment.php](d:/Work-NOW/Projects/rd-bo-php/bootstrap/environment.php:33)`

Include a line number whenever a specific code location is mentioned.

Keep file references compact, clickable, and focused on opening the editor at the referenced line.

## Required Delivery Workflow

For every new implementation or design request in this project, follow this workflow unless the user explicitly says to skip a step:

1. Update the appropriate project knowledge first.
   - Use `docs/SRS.md` for product requirements, architecture, UX, data model, API, acceptance criteria, or known limitations.
   - Use `AGENTS.md` for recurring working rules, collaboration workflow, repository conventions, or handoff discipline.
2. Create a temporary analysis/design document before coding.
   - Put it under `tmp/`.
   - Use it to capture assumptions, design decisions, affected files, test plan, and risks.
   - Delete it after the implementation and tests pass.
3. Implement the change.
   - Keep changes scoped to the request.
   - Preserve existing user work.
4. Test the system.
   - Run the most relevant checks for the files changed.
   - For frontend changes, verify the UI in browser when practical.
5. Push to git only after tests pass.
   - Stage, commit, and push the completed change.
   - Do not push half-finished or untested work.
