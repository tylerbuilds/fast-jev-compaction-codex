#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

const KEYCHAIN_SERVICE = 'ai.typesafe.fast-jev';

process.env.FAST_JEV_PROVIDER ||= 'typesafe';

if (
  process.env.FAST_JEV_PROVIDER === 'typesafe' &&
  !process.env.TYPESAFE_API_KEY &&
  process.platform === 'darwin'
) {
  try {
    process.env.TYPESAFE_API_KEY = execFileSync(
      '/usr/bin/security',
      [
        'find-generic-password',
        '-a',
        process.env.USER || userInfo().username,
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    // The server reports the normal missing-key error without exposing Keychain details.
  }
}

await import('./fast-jev-server.mjs');
