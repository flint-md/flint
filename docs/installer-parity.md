# Installer parity checklist

The Bash and PowerShell installers intentionally follow the same eight stages:
prerequisite checks, source preparation, install-directory preparation,
frontend build, optional agent setup, desktop runtime setup, launcher creation,
and completion output.

When changing one installer, exercise the matching path in the other script.
Both installers must support `FLINT_BRANCH`, `FLINT_HOME`, and local source via
`FLINT_SOURCE_DIR`; neither should remove a user's installation before a new
build has passed its checks. Update this checklist when a stage or environment
variable changes.
