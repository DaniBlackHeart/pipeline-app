// Strips full-line `//` comments from dist/theme-init.js after build.
//
// public/theme-init.js is a plain static file -- Vite copies it into
// dist/ verbatim, same as public/sw.js (see stamp-sw.js), with none of
// the comment-stripping that every bundled src/ file gets for free from
// Vite's minifier. That's fine for the code itself, but a ZAP scan
// (layer-architecture-audit's OWASP pass) flagged the file's dev-facing
// explanatory comments as an "Information Disclosure - Suspicious
// Comments" finding -- nothing sensitive was actually in them, but there's
// no reason to ship internal implementation notes (why this script exists,
// what race condition it avoids) to every visitor's browser when the
// source-controlled copy already has them for whoever's reading the code.
//
// Deliberately narrow: only strips whole-line `//...` comments (a line
// whose first non-whitespace characters are `//`), which is exactly
// what theme-init.js's comments look like today. Not a general-purpose
// JS comment stripper -- doesn't touch block comments, trailing
// same-line comments, or anything inside a string/regex literal, so it's
// safe to run against this one known-simple file without accidentally
// mangling code. If theme-init.js ever grows a comment style this
// doesn't handle, this script intentionally leaves it alone rather than
// guessing wrong.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const targetPath = 'dist/theme-init.js'

if (!existsSync(targetPath)) {
  console.warn(`strip-comments: ${targetPath} not found -- skipping (is public/theme-init.js still there?)`)
  process.exit(0)
}

const original = readFileSync(targetPath, 'utf8')
const stripped = original
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n')
  // Collapse the blank lines left behind by removed comment blocks down
  // to at most one, purely for a tidier shipped file.
  .replace(/\n{3,}/g, '\n\n')

writeFileSync(targetPath, stripped)
console.log(`strip-comments: stripped ${original.length - stripped.length} bytes of comments from ${targetPath}`)
