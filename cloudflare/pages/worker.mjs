const UPSTREAM_ORIGIN = 'https://presto-markets-app.bolajilateef07.workers.dev';

export default {
  fetch(request) {
    const incoming = new URL(request.url);
    const upstream = new URL(`${incoming.pathname}${incoming.search}`, UPSTREAM_ORIGIN);
    return fetch(new Request(upstream, request));
  },
};
