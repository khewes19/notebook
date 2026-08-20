// worker.js — the only place the Anthropic key lives.
//
// The editor is served from GitHub Pages, so anything it ships to the browser
// is public; it can hold a GitHub token scoped to one repo, but not an API key
// that is good for the whole organisation. This sits in between: the app posts
// a plain /v1/messages body, this adds the key and the version header.
//
// Deploy: Cloudflare dashboard -> Workers -> Create -> paste this -> Settings ->
// Variables -> add ANTHROPIC_API_KEY as a *secret* (not a plaintext variable) ->
// Deploy. No build step and no wrangler needed.
//
// Understand what this is before you deploy it: anyone who learns the URL can
// spend your credit. The origin check below stops a browser on another site,
// not curl. Set a spend cap on the key, and treat the URL as semi-private.

const ALLOW = ['https://khewes19.github.io'];
const UPSTREAM = 'https://api.anthropic.com/v1/messages';

// the app is trusted to pick beta features, nothing else
const FORWARD = ['anthropic-beta'];

// a ceiling the caller cannot raise, so one abusive request stays bounded
const MAX_TOKENS = 8000;
const MAX_BODY = 200 * 1024;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
    'Access-Control-Allow-Headers': 'Content-Type, anthropic-beta',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function fail(message, status, headers) {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { ...headers, 'content-type': 'application/json' }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const head = cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: head });
    if (request.method !== 'POST') return fail('POST only', 405, head);
    if (new URL(request.url).pathname !== '/v1/messages') return fail('no such route', 404, head);
    if (!ALLOW.includes(origin)) return fail('origin not allowed', 403, head);
    if (!env.ANTHROPIC_API_KEY) return fail('worker has no ANTHROPIC_API_KEY secret', 500, head);

    const raw = await request.text();
    if (raw.length > MAX_BODY) return fail('request too large', 413, head);

    let body;
    try { body = JSON.parse(raw); } catch { return fail('body is not json', 400, head); }
    if (typeof body.max_tokens === 'number' && body.max_tokens > MAX_TOKENS) {
      body.max_tokens = MAX_TOKENS;
    }

    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    };
    for (const name of FORWARD) {
      const value = request.headers.get(name);
      if (value) headers[name] = value;
    }

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    // pass the status through so the app can tell 401 from 429 from a refusal
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...head, 'content-type': 'application/json' }
    });
  }
};
