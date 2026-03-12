'use strict';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVELS.info;

function log(level, message) {
  if ((LEVELS[level] ?? 1) < MIN_LEVEL) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}`;
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

module.exports = { log };
