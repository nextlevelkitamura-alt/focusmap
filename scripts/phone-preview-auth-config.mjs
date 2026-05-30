#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { request } from 'node:https';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'whsjsscgmkkkzgcwxjko';
const REQUIRED_REDIRECTS = [
  'https://*.trycloudflare.com/**',
  'https://*.ngrok-free.app/**',
  'https://*.ngrok.app/**',
];

function resolveAccessToken() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;

  try {
    const docs = readFileSync('docs/SUPABASE_CLI.md', 'utf8');
    return docs.match(/sbp_[A-Za-z0-9]+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function supabaseRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = request({
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
            }
          : {}),
      },
    }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${method} ${path} failed with ${res.statusCode}: ${text.slice(0, 400)}`));
          return;
        }
        resolve(text ? JSON.parse(text) : null);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const token = resolveAccessToken();
if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is required to update Supabase Auth redirect URLs.');
  process.exit(1);
}

const authPath = `/v1/projects/${PROJECT_REF}/config/auth`;
const current = await supabaseRequest('GET', authPath, token);
const existing = String(current.uri_allow_list || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const merged = Array.from(new Set([...existing, ...REQUIRED_REDIRECTS]));
const missing = REQUIRED_REDIRECTS.filter((value) => !existing.includes(value));

if (missing.length > 0) {
  await supabaseRequest('PATCH', authPath, token, { uri_allow_list: merged.join(',') });
}

console.log(missing.length > 0
  ? `Added Supabase phone preview redirect URLs: ${missing.join(', ')}`
  : 'Supabase phone preview redirect URLs already configured.');
