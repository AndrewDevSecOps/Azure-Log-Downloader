#!/usr/bin/env node
'use strict';

const readline = require('readline');
const { searchLogs, formatLogEntry, IIS_FIELDS } = require('./search');
const config = require('./config');

const HELP_TEXT = `
Log Search CLI - Search IIS logs with powerful queries

USAGE:
  node src/search-cli.js [options] [query]

OPTIONS:
  -n, --limit <num>    Maximum number of results (default: 100)
  -c, --compact        Compact single-line output
  -d, --dir <path>     Logs directory (default: ./downloaded-logs)
  -i, --interactive    Interactive mode
  -h, --help           Show this help

QUERY SYNTAX:
  field:value          Substring match (case-insensitive)
  field>value          Greater than (numeric)
  field<value          Less than (numeric)
  field>=value         Greater or equal (numeric)
  field<=value         Less or equal (numeric)
  
  AND                  Both conditions must match (default between terms)
  OR                   Either condition must match
  ( )                  Group conditions

AVAILABLE FIELDS:
  status     HTTP status code (e.g., 200, 404, 500)
  method     HTTP method (GET, POST, PUT, DELETE, etc.)
  path       URL path (e.g., /api/users)
  ip         Client IP address
  latency    Request time in milliseconds
  useragent  User agent string (alias: ua)
  host       Host header
  referer    Referer header
  date       Date (YYYY-MM-DD)
  time       Time (HH:MM:SS)
  query      Query string
  bytes      Response bytes
  port       Server port

EXAMPLES:
  status:500 AND path:/api
      Find 500 errors on API endpoints

  ip:20.76.15.2
      Find all requests from specific IP

  latency>2000
      Find slow requests (>2 seconds)

  method:POST AND status:500
      Find failed POST requests

  useragent:iphone
      Find requests from iPhones

  status:500 OR status:502
      Find 500 or 502 errors

  (status:500 OR status:502) AND path:/api
      Find server errors on API endpoints

  latency>1000 AND method:POST
      Find slow POST requests
`;

async function main() {
  const args = process.argv.slice(2);
  let logsDir = config.outputDir;
  let maxResults = 100;
  let compact = false;
  let interactive = false;
  let query = '';

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '-h':
      case '--help':
        console.log(HELP_TEXT);
        process.exit(0);
        break;
      case '-n':
      case '--limit':
        maxResults = parseInt(args[++i], 10);
        break;
      case '-c':
      case '--compact':
        compact = true;
        break;
      case '-d':
      case '--dir':
        logsDir = args[++i];
        break;
      case '-i':
      case '--interactive':
        interactive = true;
        break;
      default:
        // Everything else is part of the query
        query += (query ? ' ' : '') + arg;
    }
  }

  if (interactive) {
    await runInteractiveMode(logsDir, maxResults, compact);
  } else if (query) {
    await runSearch(query, logsDir, maxResults, compact);
  } else {
    console.log(HELP_TEXT);
  }
}

async function runSearch(query, logsDir, maxResults, compact) {
  console.log(`Searching: ${query}`);
  console.log(`Directory: ${logsDir}`);
  console.log(`Max results: ${maxResults}`);
  console.log('---');

  let count = 0;
  const startTime = Date.now();

  try {
    for await (const entry of searchLogs(logsDir, query, { maxResults })) {
      count++;
      console.log(formatLogEntry(entry, { compact }));
      if (!compact) console.log('---');
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\nFound ${count} result(s) in ${elapsed}s`);
}

async function runInteractiveMode(logsDir, maxResults, compact) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('Log Search Interactive Mode');
  console.log('Type your query and press Enter. Type "help" for syntax, "quit" to exit.\n');

  const prompt = () => {
    rl.question('search> ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      if (trimmed.toLowerCase() === 'help') {
        console.log(HELP_TEXT);
        prompt();
        return;
      }

      // Handle inline options
      let query = trimmed;
      let limit = maxResults;
      let isCompact = compact;

      // Check for -n flag in query
      const limitMatch = query.match(/-n\s*(\d+)/);
      if (limitMatch) {
        limit = parseInt(limitMatch[1], 10);
        query = query.replace(/-n\s*\d+/, '').trim();
      }

      // Check for -c flag in query
      if (query.includes('-c')) {
        isCompact = true;
        query = query.replace(/-c/, '').trim();
      }

      await runSearch(query, logsDir, limit, isCompact);
      console.log('');
      prompt();
    });
  };

  prompt();
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
