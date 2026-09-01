// Stamps a unique version into the built service worker's CACHE_NAME so
// its bytes always change between deploys.
//
// public/sw.js is a plain static file -- Vite copies it into dist/
// verbatim, nothing in it gets bundled or fingerprinted. That means its
// bytes are identical build after build even though the React app it
// caches has changed underneath it. Browsers decide whether there's "a
// new version" of a service worker by byte-comparing it against the
// previously installed one, so an unchanged sw.js means the browser
// never re-runs install/activate and keeps the OLD worker (and its OLD
// cached app shell) running indefinitely -- even after a genuinely
// successful redeploy. This closes that gap by rewriting CACHE_NAME with
// a fresh value on every build, guaranteeing the browser always sees a
// diff and installs the new worker. See "How the service worker works"
// in README.md.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const swPath = 'dist/sw.js'

if (!existsSync(swPath)) {
  console.warn(`stamp-sw: ${swPath} not found -- skipping (is public/sw.js still there?)`)
  process.exit(0)
}

const version = Date.now().toString(36)
const contents = readFileSync(swPath, 'utf8')
const stamped = contents.replace(
  /const CACHE_NAME = ['"][^'"]*['"]/,
  `const CACHE_NAME = 'pipeline-cache-${version}'`
)

if (stamped === contents) {
  console.error('stamp-sw: CACHE_NAME declaration not found in sw.js -- refusing to ship an unstamped service worker')
  process.exit(1)
}

writeFileSync(swPath, stamped)
console.log(`stamp-sw: sw.js stamped with cache version ${version}`)
