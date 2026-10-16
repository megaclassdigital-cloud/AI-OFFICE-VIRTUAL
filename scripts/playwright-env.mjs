// Import this FIRST (before 'playwright') in every script that launches a browser.
//
// Why: when the Claude desktop app (an MSIX package) installs or edits things under %LOCALAPPDATA%/%APPDATA%, Windows redirects those writes to a private
// per-package store. Processes started from the Windows login (the supervisor, Paperclip, the orchestrator) then see the REAL disk, where that copy does
// not exist, so Chromium cannot be launched (observed 16 Oct 2026 after a power loss). A copy kept inside the repo (tools/ms-playwright, on D:, not
// redirected) is visible to every process, so it is preferred whenever it exists. An explicit PLAYWRIGHT_BROWSERS_PATH still wins.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const local = path.join(here, '..', 'tools', 'ms-playwright');
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(local)) process.env.PLAYWRIGHT_BROWSERS_PATH = path.resolve(local);
