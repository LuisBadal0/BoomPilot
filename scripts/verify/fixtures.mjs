// Local test pages for the verify run. Two servers on different hostnames
// give two origins (and two sites for "remember per site"):
//   site A: http://localhost:<portA>
//   site B: http://127.0.0.1:<portB>
import http from 'node:http';

// One second of a 440 Hz tone as 16-bit mono WAV. The pages loop it.
function toneWav(seconds = 1, rate = 22050) {
  const samples = seconds * rate;
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  }
  return buf;
}

const TONE = toneWav();

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}</body>`;
}

function audio(src, attrs = '') {
  return `<audio id="media" src="${src}" loop autoplay ${attrs}></audio>`;
}

export async function startFixtures() {
  const servers = [];
  const listen = (handler, host) => new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, host, () => resolve(server));
    servers.push(server);
  });

  let siteA = '';
  let siteB = '';

  const routes = {
    '/tone.wav': () => ({ type: 'audio/wav', body: TONE }),
    // Where the run talks to the extension (see ext/test-bridge.js).
    '/bridge.html': () => page('bridge', 'BoomPilot verify bridge'),
    // Media from the page's own origin: routed through Web Audio.
    '/same-origin.html': () => page('same-origin', audio('/tone.wav')),
    // Media from another origin without CORS: direct volume control only.
    '/cross-origin.html': () => page('cross-origin', audio(`${siteB}/tone.wav`)),
    // Media from another origin with CORS: Web Audio works.
    '/cors.html': () => page('cors', audio(`${siteB}/tone.wav`, 'crossorigin="anonymous"')),
    // An embedded player from site B that plays media from site A.
    '/embed.html': () => page('embed', `<iframe id="player" src="${siteB}/player.html" width="300" height="80"></iframe>`),
    '/player.html': () => page('player', audio(`${siteA}/tone.wav`)),
    // Media added after load, like single-page apps do.
    '/late.html': () => page('late', `<script>setTimeout(() => {
      document.body.insertAdjacentHTML('beforeend', '${audio(`${siteB}/tone.wav`)}');
    }, 1500);</script>`)
  };

  const handler = (req, res) => {
    const route = routes[new URL(req.url, 'http://x').pathname];
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    const result = route();
    const isPage = typeof result === 'string';
    res.writeHead(200, {
      'content-type': isPage ? 'text/html; charset=utf-8' : result.type,
      'access-control-allow-origin': '*',
      'cache-control': 'no-store'
    });
    res.end(isPage ? result : result.body);
  };

  const a = await listen(handler, 'localhost');
  const b = await listen(handler, '127.0.0.1');
  siteA = `http://localhost:${a.address().port}`;
  siteB = `http://127.0.0.1:${b.address().port}`;

  return {
    siteA,
    siteB,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  };
}
