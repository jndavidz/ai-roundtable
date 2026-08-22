#!/usr/bin/env node

// Tests for shared/constants.js — the single source of truth for the AI list.
// Verifies helper behavior AND cross-checks the table against manifest.json
// and the on-disk adapter files, so adding/removing an AI inconsistently fails
// here instead of silently breaking one surface at runtime.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function loadShared() {
  const sandbox = { console, URL }; // URL needed by getAITypeFromUrl
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, 'shared/constants.js'), 'utf8'),
    sandbox,
    { filename: 'shared/constants.js' }
  );
  // Top-level const/let live in the context's lexical environment, not on the
  // sandbox object — read them by evaluating inside the context.
  sandbox.__read = expr => vm.runInContext(expr, sandbox);
  return sandbox;
}

(async () => {
  const s = loadShared();

  // ---- Table sanity ----
  const aiTypes = s.__read('AI_TYPES');
  const displayNames = s.__read('AI_DISPLAY_NAMES');
  const urlPatterns = s.__read('AI_URL_PATTERNS');
  if (!Array.isArray(aiTypes) || aiTypes.length !== 12) {
    throw new Error(`expected 12 AI types, got ${aiTypes?.length}`);
  }
  for (const t of aiTypes) {
    if (!displayNames[t]) throw new Error(`missing display name for ${t}`);
    if (!Array.isArray(urlPatterns[t]) || urlPatterns[t].length === 0) {
      throw new Error(`missing URL patterns for ${t}`);
    }
    const adapter = path.join(ROOT, 'content', `${t}.js`);
    if (!fs.existsSync(adapter)) throw new Error(`content/${t}.js not found for ${t}`);
  }

  // ---- getAITypeFromUrl behavior ----
  const cases = [
    ['https://claude.ai/chat/abc', 'claude'],
    ['https://chatgpt.com/c/xyz', 'chatgpt'],
    ['https://chat.openai.com/', 'chatgpt'],
    ['https://www.chatglm.cn/main', 'glm'],          // www stripped
    ['https://aistudio.xiaomimimo.com/#/c', 'mimo'], // subdomain suffix match
    ['https://evil.com/?r=kimi.com', null],          // no URL-string false positive
    ['https://notkimi.com/', null],
    ['https://example.com/', null],
    ['not a url', null],
    ['', null]
  ];
  for (const [url, expected] of cases) {
    const got = s.getAITypeFromUrl(url);
    if (got !== expected) {
      throw new Error(`getAITypeFromUrl(${url}) expected ${expected}, got ${got}`);
    }
  }

  // ---- manifest.json consistency ----
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const manifestHosts = new Set();
  for (const cs of manifest.content_scripts) {
    for (const match of cs.matches) {
      const host = match.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      manifestHosts.add(host);
    }
  }
  for (const host of manifestHosts) {
    if (!s.getAITypeFromUrl(`https://${host}/`)) {
      throw new Error(`manifest matches ${host} but shared/constants.js has no pattern for it`);
    }
  }
  for (const t of aiTypes) {
    const covered = urlPatterns[t].some(p => {
      // exact host entry or any subdomain variant present in manifest
      for (const h of manifestHosts) {
        if (h === p || h.endsWith('.' + p) || p.endsWith('.' + h)) return true;
      }
      return false;
    });
    if (!covered) throw new Error(`${t} patterns (${urlPatterns[t]}) missing from manifest content_scripts`);
  }

  // ---- background derives the same script file list ----
  const bgSource = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  if (!bgSource.includes("importScripts('shared/constants.js')")) {
    throw new Error('background.js must importScripts shared/constants.js first');
  }

  console.log('shared constants tests passed');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
