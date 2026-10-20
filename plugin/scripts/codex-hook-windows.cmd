@echo off
rem Runs one Muggle hook script under Git Bash for Codex on Windows.
rem
rem Codex runs a plugin hook's commandWindows through cmd.exe, which cannot run
rem the POSIX command the hooks manifest otherwise carries. This finds Git Bash
rem (beside git.exe, else the default install path) and runs the script there,
rem stamped as a Codex hook. With no Git Bash it prints {} and succeeds: every
rem guardrail degrades to "allow", never to a blocked turn.
rem
rem Usage: codex-hook-windows.cmd "<plugin-root>/scripts/<script>.sh" [args...]
setlocal
set "MUGGLE_HOOK_HOST=codex"
set "MUGGLE_HOOK_BASH="
for /f "delims=" %%G in ('where git 2^>nul') do (
  if not defined MUGGLE_HOOK_BASH if exist "%%~dpG..\bin\bash.exe" set "MUGGLE_HOOK_BASH=%%~dpG..\bin\bash.exe"
)
if not defined MUGGLE_HOOK_BASH if exist "%ProgramFiles%\Git\bin\bash.exe" set "MUGGLE_HOOK_BASH=%ProgramFiles%\Git\bin\bash.exe"
if not defined MUGGLE_HOOK_BASH (
  echo {}
  exit /b 0
)
"%MUGGLE_HOOK_BASH%" %*
