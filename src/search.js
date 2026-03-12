'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/**
 * IIS Log Field Mapping
 * Maps user-friendly field names to IIS log field indices
 */
const IIS_FIELDS = {
  // Standard fields from #Fields header
  date: 0,
  time: 1,
  sitename: 2,
  method: 3,
  path: 4,
  query: 5,
  port: 6,
  username: 7,
  ip: 8,
  useragent: 9,
  cookie: 10,
  referer: 11,
  host: 12,
  status: 13,
  substatus: 14,
  win32status: 15,
  bytes: 16,
  requestbytes: 17,
  latency: 18, // time-taken in ms
};

// Aliases for convenience
const FIELD_ALIASES = {
  ua: 'useragent',
  'user-agent': 'useragent',
  sc: 'status',
  'sc-status': 'status',
  'cs-method': 'method',
  'cs-uri-stem': 'path',
  'c-ip': 'ip',
  'time-taken': 'latency',
  timetaken: 'latency',
  ms: 'latency',
};

/**
 * Parse a search query into an AST
 * Supports:
 *   - field:value (exact/substring match)
 *   - field>value, field<value, field>=value, field<=value (numeric comparison)
 *   - AND, OR operators (AND is default when space-separated)
 *   - Parentheses for grouping
 *
 * Examples:
 *   status:500 AND path:/api
 *   ip:20.76.15.2
 *   latency>2000
 *   method:POST AND (status:500 OR status:502)
 *   useragent:iphone
 */
function parseQuery(query) {
  const tokens = tokenize(query);
  return parseExpression(tokens, 0).node;
}

function tokenize(query) {
  const tokens = [];
  let i = 0;

  while (i < query.length) {
    // Skip whitespace
    if (/\s/.test(query[i])) {
      i++;
      continue;
    }

    // Parentheses
    if (query[i] === '(') {
      tokens.push({ type: 'LPAREN' });
      i++;
      continue;
    }
    if (query[i] === ')') {
      tokens.push({ type: 'RPAREN' });
      i++;
      continue;
    }

    // AND/OR operators
    if (query.slice(i, i + 3).toUpperCase() === 'AND' && /\s/.test(query[i + 3] || ' ')) {
      tokens.push({ type: 'AND' });
      i += 3;
      continue;
    }
    if (query.slice(i, i + 2).toUpperCase() === 'OR' && /\s/.test(query[i + 2] || ' ')) {
      tokens.push({ type: 'OR' });
      i += 2;
      continue;
    }

    // Field condition: field:value, field>value, field<value, etc.
    const condMatch = query.slice(i).match(/^([a-zA-Z_-]+)(>=|<=|>|<|:)("([^"]+)"|(\S+))/);
    if (condMatch) {
      const field = condMatch[1].toLowerCase();
      const operator = condMatch[2];
      const value = condMatch[4] !== undefined ? condMatch[4] : condMatch[5];
      tokens.push({ type: 'CONDITION', field, operator, value });
      i += condMatch[0].length;
      continue;
    }

    // Unknown character - skip
    i++;
  }

  return tokens;
}

function parseExpression(tokens, pos) {
  let result = parseOr(tokens, pos);
  return result;
}

function parseOr(tokens, pos) {
  let left = parseAnd(tokens, pos);
  pos = left.pos;

  while (pos < tokens.length && tokens[pos]?.type === 'OR') {
    pos++; // consume OR
    const right = parseAnd(tokens, pos);
    pos = right.pos;
    left = { node: { type: 'OR', left: left.node, right: right.node }, pos };
  }

  return left;
}

function parseAnd(tokens, pos) {
  let left = parsePrimary(tokens, pos);
  pos = left.pos;

  while (pos < tokens.length) {
    const token = tokens[pos];
    if (token?.type === 'AND') {
      pos++; // consume AND
      const right = parsePrimary(tokens, pos);
      pos = right.pos;
      left = { node: { type: 'AND', left: left.node, right: right.node }, pos };
    } else if (token?.type === 'CONDITION') {
      // Implicit AND between conditions
      const right = parsePrimary(tokens, pos);
      pos = right.pos;
      left = { node: { type: 'AND', left: left.node, right: right.node }, pos };
    } else {
      break;
    }
  }

  return left;
}

function parsePrimary(tokens, pos) {
  const token = tokens[pos];

  if (!token) {
    return { node: { type: 'TRUE' }, pos };
  }

  if (token.type === 'LPAREN') {
    pos++; // consume (
    const result = parseOr(tokens, pos);
    pos = result.pos;
    if (tokens[pos]?.type === 'RPAREN') {
      pos++; // consume )
    }
    return { node: result.node, pos };
  }

  if (token.type === 'CONDITION') {
    return {
      node: {
        type: 'CONDITION',
        field: FIELD_ALIASES[token.field] || token.field,
        operator: token.operator,
        value: token.value,
      },
      pos: pos + 1,
    };
  }

  return { node: { type: 'TRUE' }, pos: pos + 1 };
}

/**
 * Evaluate a parsed query against a log line
 */
function evaluateQuery(ast, fields) {
  if (!ast) return true;

  switch (ast.type) {
    case 'TRUE':
      return true;

    case 'AND':
      return evaluateQuery(ast.left, fields) && evaluateQuery(ast.right, fields);

    case 'OR':
      return evaluateQuery(ast.left, fields) || evaluateQuery(ast.right, fields);

    case 'CONDITION': {
      const fieldIndex = IIS_FIELDS[ast.field];
      if (fieldIndex === undefined) {
        // Unknown field - try text search across all fields
        const lineText = fields.join(' ').toLowerCase();
        return lineText.includes(ast.value.toLowerCase());
      }

      const fieldValue = fields[fieldIndex] || '';
      const searchValue = ast.value;

      switch (ast.operator) {
        case ':':
          // Substring match (case-insensitive)
          return fieldValue.toLowerCase().includes(searchValue.toLowerCase());

        case '>':
          return parseFloat(fieldValue) > parseFloat(searchValue);

        case '<':
          return parseFloat(fieldValue) < parseFloat(searchValue);

        case '>=':
          return parseFloat(fieldValue) >= parseFloat(searchValue);

        case '<=':
          return parseFloat(fieldValue) <= parseFloat(searchValue);

        default:
          return false;
      }
    }

    default:
      return true;
  }
}

/**
 * Parse a single IIS log line into fields
 */
function parseLogLine(line) {
  // Skip comment lines
  if (line.startsWith('#')) return null;

  // Split by whitespace, but IIS logs are space-delimited
  // Fields with spaces are not quoted in IIS logs, but we handle common patterns
  const fields = line.split(' ');
  return fields;
}

/**
 * Search through all log files in a directory
 */
async function* searchLogs(logsDir, query, options = {}) {
  const ast = parseQuery(query);
  const maxResults = options.maxResults || Infinity;
  let count = 0;

  const logFiles = await findLogFiles(logsDir);

  for (const logFile of logFiles) {
    if (count >= maxResults) break;

    const rl = readline.createInterface({
      input: fs.createReadStream(logFile),
      crlfDelay: Infinity,
    });

    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      const fields = parseLogLine(line);
      if (!fields) continue;

      if (evaluateQuery(ast, fields)) {
        count++;
        yield {
          file: logFile,
          line: lineNumber,
          fields,
          raw: line,
        };

        if (count >= maxResults) {
          rl.close();
          break;
        }
      }
    }
  }
}

/**
 * Find all .log files recursively
 */
async function findLogFiles(dir) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.name.endsWith('.log')) {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  // Sort by modification time (newest first)
  const stats = await Promise.all(files.map(async (f) => ({ file: f, mtime: (await fs.promises.stat(f)).mtime })));
  stats.sort((a, b) => b.mtime - a.mtime);
  return stats.map((s) => s.file);
}

/**
 * Format a log entry for display
 */
function formatLogEntry(entry, options = {}) {
  const fields = entry.fields;
  const compact = options.compact;

  if (compact) {
    // Single line format
    const date = fields[IIS_FIELDS.date] || '';
    const time = fields[IIS_FIELDS.time] || '';
    const method = fields[IIS_FIELDS.method] || '';
    const path = fields[IIS_FIELDS.path] || '';
    const status = fields[IIS_FIELDS.status] || '';
    const ip = fields[IIS_FIELDS.ip] || '';
    const latency = fields[IIS_FIELDS.latency] || '';

    return `${date} ${time} | ${status} | ${method.padEnd(6)} | ${latency.padStart(6)}ms | ${ip.padEnd(15)} | ${path}`;
  }

  // Detailed format
  const lines = [
    `File: ${entry.file}:${entry.line}`,
    `Date: ${fields[IIS_FIELDS.date]} ${fields[IIS_FIELDS.time]}`,
    `Method: ${fields[IIS_FIELDS.method]}`,
    `Path: ${fields[IIS_FIELDS.path]}`,
    `Status: ${fields[IIS_FIELDS.status]}`,
    `IP: ${fields[IIS_FIELDS.ip]}`,
    `Latency: ${fields[IIS_FIELDS.latency]}ms`,
    `User-Agent: ${decodeURIComponent((fields[IIS_FIELDS.useragent] || '').replace(/\+/g, ' '))}`,
  ];

  return lines.join('\n');
}

module.exports = {
  parseQuery,
  evaluateQuery,
  parseLogLine,
  searchLogs,
  formatLogEntry,
  IIS_FIELDS,
};
