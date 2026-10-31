#!/usr/bin/env node
/**
 * OKF (Open Knowledge Format v0.2) Linter & Validator for Musikbar.
 *
 * Validates:
 * 1. Frontmatter syntax and required 'type' field in concept files.
 * 2. Progressive disclosure index.md structure.
 * 3. Date formats (ISO-8601) in generated, verified, and log.md.
 * 4. Internal link resolution and footnote citation integrity.
 * 5. Actor string conventions (human:*, agent:*, process:*).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// context/ directory in project root
const CONTEXT_DIR = path.resolve(__dirname, '..', 'context');

const ERRORS = [];
const WARNINGS = [];

const DATE_ISO_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2}))?$/;
const LOG_DATE_REGEX = /^## (\d{4}-\d{2}-\d{2})$/;
const FOOTNOTE_REF_REGEX = /\[\^([a-zA-Z0-9_-]+)\]/g;
const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g;

const EXEMPT_FILES = new Set(['log.md', 'AGENTS.md', 'README.md']);

function logError(filePath, message) {
  const rel = path.relative(CONTEXT_DIR, filePath);
  ERRORS.push(`ERROR [${rel}]: ${message}`);
}

function logWarning(filePath, message) {
  const rel = path.relative(CONTEXT_DIR, filePath);
  WARNINGS.push(`WARN  [${rel}]: ${message}`);
}

function extractFrontmatter(content) {
  if (!content.startsWith('---')) {
    return [null, content];
  }
  const parts = content.split('---');
  if (parts.length < 3) {
    return [null, content];
  }
  const rawYaml = parts[1];
  const body = parts.slice(2).join('---');
  try {
    const data = yaml.parse(rawYaml);
    return [data, body];
  } catch (e) {
    return [{ _yaml_error: e.message }, body];
  }
}

function validateActor(filePath, actor, fieldName) {
  if (typeof actor !== 'string') {
    logError(filePath, `Actor in ${fieldName} must be a string, got ${typeof actor}`);
    return;
  }
  const validPrefixes = ['human:', 'agent:', 'process:'];
  if (!validPrefixes.some(p => actor.startsWith(p)) && !actor.includes('/')) {
    logWarning(filePath, `Actor '${actor}' in ${fieldName} should follow '<agent>/<version>', 'human:<id>', or 'process:<id>'`);
  }
}

function validateDate(filePath, dtVal, fieldName) {
  if (dtVal instanceof Date) {
    return;
  }
  const dtStr = String(dtVal).trim();
  if (!DATE_ISO_REGEX.test(dtStr)) {
    logError(filePath, `Invalid date/datetime in '${fieldName}': '${dtStr}'. Expected ISO-8601 (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)`);
  }
}

function validateConcept(filePath, data, body) {
  if (data._yaml_error) {
    logError(filePath, `YAML parse error: ${data._yaml_error}`);
    return;
  }

  // Required field: type
  if (!data || !data.type) {
    logError(filePath, "Missing required frontmatter key: 'type'");
    return;
  }

  // Recommended fields check
  if (!data.title) {
    logWarning(filePath, "Missing recommended frontmatter key: 'title'");
  }
  if (!data.description) {
    logWarning(filePath, "Missing recommended frontmatter key: 'description'");
  }

  // Generated validation
  if (data.generated) {
    const gen = data.generated;
    if (typeof gen === 'object' && gen !== null && !Array.isArray(gen)) {
      if (gen.by) {
        validateActor(filePath, gen.by, 'generated.by');
      } else {
        logError(filePath, "generated block missing 'by'");
      }
      if (gen.at) {
        validateDate(filePath, gen.at, 'generated.at');
      }
    } else {
      logError(filePath, "'generated' must be a mapping { by, at }");
    }
  }

  // Verified validation
  if (data.verified) {
    let ver = data.verified;
    if (!Array.isArray(ver)) {
      ver = [ver];
    }
    for (let idx = 0; idx < ver.length; idx++) {
      const item = ver[idx];
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        if (item.by) validateActor(filePath, item.by, `verified[${idx}].by`);
        if (item.at) validateDate(filePath, item.at, `verified[${idx}].at`);
      } else {
        logError(filePath, `verified[${idx}] must be a mapping`);
      }
    }
  }

  // Sources and Footnote check
  const sourceIds = new Set();
  if (data.sources) {
    const sources = data.sources;
    if (Array.isArray(sources)) {
      for (let idx = 0; idx < sources.length; idx++) {
        const src = sources[idx];
        if (typeof src === 'object' && src !== null && !Array.isArray(src)) {
          if (!src.resource) {
            logError(filePath, `sources[${idx}] missing required 'resource'`);
          }
          if (src.id) {
            sourceIds.add(String(src.id));
          }
          if (src.last_modified) {
            validateDate(filePath, src.last_modified, `sources[${idx}].last_modified`);
          }
        } else {
          logError(filePath, `sources[${idx}] must be a mapping`);
        }
      }
    } else {
      logError(filePath, "'sources' must be a list");
    }
  }

  // Footnote citation checking
  const footnotes = [...body.matchAll(FOOTNOTE_REF_REGEX)].map(m => m[1]);
  for (const fn of footnotes) {
    if (!sourceIds.has(fn)) {
      logWarning(filePath, `Footnote citation '[^${fn}]' has no matching id in 'sources' frontmatter`);
    }
  }
}

function validateIndex(filePath, content) {
  const isRoot = path.resolve(filePath) === path.resolve(CONTEXT_DIR, 'index.md');
  const [data] = extractFrontmatter(content);
  if (isRoot) {
    if (!data || !data.okf_version) {
      logWarning(filePath, "Root index.md frontmatter should declare 'okf_version: \"0.2\"'");
    }
  } else {
    if (data) {
      logWarning(filePath, 'Subdirectory index.md should not contain frontmatter (OKF v0.2 §8)');
    }
  }
}

function validateLog(filePath, content) {
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (!LOG_DATE_REGEX.test(line)) {
        logError(filePath, `Invalid date heading in log.md: '${line}'. Expected '## YYYY-MM-DD'`);
      }
    }
  }
}

function validateLinks(filePath, body) {
  const matches = [...body.matchAll(LINK_REGEX)];
  for (const match of matches) {
    const link = match[2];
    if (
      link.startsWith('http://') ||
      link.startsWith('https://') ||
      link.startsWith('#') ||
      link.startsWith('mailto:')
    ) {
      continue;
    }

    let target;
    if (link.startsWith('/')) {
      target = path.resolve(CONTEXT_DIR, link.slice(1));
    } else {
      target = path.resolve(path.dirname(filePath), link);
    }

    if (!fs.existsSync(target) && fs.existsSync(`${target}.md`)) {
      target = `${target}.md`;
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory() && fs.existsSync(path.join(target, 'index.md'))) {
      continue;
    }

    if (!fs.existsSync(target)) {
      logWarning(filePath, `Broken internal link to '${link}'`);
    }
  }
}

function walkDir(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function main() {
  if (!fs.existsSync(CONTEXT_DIR)) {
    console.error(`Error: Context directory not found at ${CONTEXT_DIR}`);
    process.exit(1);
  }

  console.log(`🔍 Validating OKF v0.2 Knowledge Bundle in: ${CONTEXT_DIR}`);

  const mdFiles = walkDir(CONTEXT_DIR);

  for (const filePath of mdFiles) {
    const fname = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    if (fname === 'index.md') {
      validateIndex(filePath, content);
      validateLinks(filePath, content);
    } else if (fname === 'log.md') {
      validateLog(filePath, content);
      validateLinks(filePath, content);
    } else if (EXEMPT_FILES.has(fname)) {
      validateLinks(filePath, content);
    } else {
      const [data, body] = extractFrontmatter(content);
      if (data === null) {
        logError(filePath, "Concept file missing YAML frontmatter ('---')");
      } else {
        validateConcept(filePath, data, body);
      }
      validateLinks(filePath, body);
    }
  }

  console.log(`Validated ${mdFiles.length} markdown documents.`);

  if (WARNINGS.length > 0) {
    console.log(`\n⚠️  ${WARNINGS.length} Warning(s):`);
    for (const w of WARNINGS) {
      console.log(`  ${w}`);
    }
  }

  if (ERRORS.length > 0) {
    console.log(`\n❌ ${ERRORS.length} Error(s):`);
    for (const e of ERRORS) {
      console.log(`  ${e}`);
    }
    process.exit(1);
  } else {
    console.log('\n✅ All OKF v0.2 specifications satisfied!');
    process.exit(0);
  }
}

main();
