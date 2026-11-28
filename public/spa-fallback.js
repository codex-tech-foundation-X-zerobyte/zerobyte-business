// Loaded only by 404.html. If a host answers a refresh of /app/... or /admin/... with "not found" (the rewrite in
// vercel.json or _redirects is missing or was not deployed), remember the address and open the app, which puts the
// address back before it starts (see restoreSpaPath in src/lib/spaRestore.ts). Runs at most once every 15 seconds so a
// host that truly has no app can never loop.
;(function () {
  var match = /^\/(app|admin)(\/|$)/.exec(location.pathname)
  if (!match) return
  try {
    var last = Number(sessionStorage.getItem('zb-spa-restore-at') || 0)
    if (Date.now() - last < 15000) return
    sessionStorage.setItem('zb-spa-restore-at', String(Date.now()))
    sessionStorage.setItem('zb-spa-restore', location.pathname + location.search + location.hash)
  } catch {
    return
  }
  location.replace(match[1] === 'admin' ? '/admin.html' : '/index.html')
})()
