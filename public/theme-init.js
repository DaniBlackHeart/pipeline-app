// Sets the theme attribute before first paint, so there's no flash of
// the wrong theme while React boots. Loaded as a plain external script
// (not inline) specifically so it runs before any rendering while still
// letting script-src stay 'self'-only with no 'unsafe-inline' -- CSS
// variables aren't available yet at this point, so the two hex values
// below are deliberately duplicated from index.css's [data-theme="dark"]
// block, just for this one meta tag.
(function () {
  try {
    var stored = localStorage.getItem('pipeline-theme')
    var theme = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    var resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
    if (resolved === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    }
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#14171A' : '#EEF0F0')
  } catch (e) {
    // localStorage can throw in some private-browsing modes -- falls
    // back to light, matching :root's default with no attribute set.
  }
})()

// Supabase invite/recovery emails deliver a login token in the URL hash
// (#access_token=...&type=invite or &type=recovery). The Supabase client
// auto-reads and clears that hash on init (detectSessionInUrl), which can
// race with checking it later in React. Capturing it here, in a plain
// script that runs before any module script, avoids that race -- it's
// how the app tells "just accepted an invite" or "just clicked a
// password reset link" apart from an ordinary return visit.
if (window.location.hash.includes('type=invite')) {
  sessionStorage.setItem('pipeline_auth_type', 'invite')
} else if (window.location.hash.includes('type=recovery')) {
  sessionStorage.setItem('pipeline_auth_type', 'recovery')
}
