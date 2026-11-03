// STEP 1: hash router (#/patients/p1?x=1)
// splits url into hash & query @ the '?'
export function parseHash() {
  const [path, qs = ''] = (location.hash.slice(1) || '/dashboard').split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}
// routes (the last one is the fallback)
// listens for hash changes
export function startRouter(routes, onRoute) {
  const go = () => {
    const { path, query } = parseHash();
    for (const [pattern, handler] of routes) {
      const m = path.match(pattern);
      if (m) return onRoute(handler, { params: m.slice(1), query, path });
    }
  };
  addEventListener('hashchange', go);
  go();
  return go;
}
