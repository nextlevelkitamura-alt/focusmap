#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const MAX_BYTES = 1024 * 1024
const SKIP_PATH_PARTS = new Set([
  'node_modules',
  '.next',
  'dist',
  'dist-desktop',
  'coverage',
])

function trackedFiles() {
  const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  return output.split('\0').filter(Boolean)
}

function shouldSkip(file) {
  return file.split('/').some(part => SKIP_PATH_PARTS.has(part))
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  return sample.includes(0)
}

function decodeBase64UrlJson(value) {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
}

function findServiceRoleJwt(text) {
  const findings = []
  const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g
  for (const match of text.matchAll(jwtPattern)) {
    const token = match[0]
    const [, payload] = token.split('.')
    const parsed = payload ? decodeBase64UrlJson(payload) : null
    if (parsed && typeof parsed === 'object' && parsed.role === 'service_role') {
      findings.push({ index: match.index ?? 0, reason: 'Supabase service_role JWT' })
    }
  }
  return findings
}

function lineNumberAt(text, index) {
  return text.slice(0, index).split('\n').length
}

const checks = [
  {
    reason: 'Supabase personal access token',
    find: text => Array.from(text.matchAll(/\bsbp_[A-Za-z0-9]{20,}\b/g), match => ({
      index: match.index ?? 0,
      reason: 'Supabase personal access token',
    })),
  },
  {
    reason: 'Private key PEM',
    find: text => Array.from(text.matchAll(/-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g), match => ({
      index: match.index ?? 0,
      reason: 'Private key PEM',
    })),
  },
  {
    reason: 'Supabase service_role JWT',
    find: findServiceRoleJwt,
  },
]

const findings = []

for (const file of trackedFiles()) {
  if (shouldSkip(file)) continue

  const buffer = readFileSync(file)
  if (buffer.length > MAX_BYTES || isProbablyBinary(buffer)) continue

  const text = buffer.toString('utf8')
  for (const check of checks) {
    for (const finding of check.find(text)) {
      findings.push({
        file,
        line: lineNumberAt(text, finding.index),
        reason: finding.reason,
      })
    }
  }
}

if (findings.length > 0) {
  console.error('Potential tracked secrets were found:')
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} ${finding.reason}`)
  }
  console.error('Remove the secret value, rotate it if it was real, and keep only environment-variable references in tracked files.')
  process.exit(1)
}

console.log('No blocked secret patterns found in tracked files.')
