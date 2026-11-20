'use strict';

const net = require('node:net');

// Hold all requested ports until the entire preflight succeeds. Never reuse a
// listener belonging to another run merely because its health endpoint works.
async function assertPortsAvailable(ports) {
  const held = [];
  try {
    for (const port of ports) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid browser gate port');
      const server = net.createServer();
      await new Promise((resolve, reject) => {
        server.once('error', () => reject(new Error(`Browser gate port ${port} is unavailable; refusing to use an existing server`)));
        server.listen({ port, exclusive: true }, resolve);
      });
      held.push(server);
    }
  } finally {
    await Promise.all(held.map(server => new Promise(resolve => server.close(resolve))));
  }
}

function viteLaunchSource(uiPort, apiPort) {
  return `import { createServer } from 'vite';
    const server = await createServer({ server: {
      host: '127.0.0.1', port: ${uiPort}, strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:${apiPort}', changeOrigin: true } }
    }});
    await server.listen();
    console.log('PHASE1_OWNED_VITE_READY');
    process.on('SIGTERM', async () => { await server.close(); });`;
}

module.exports = { assertPortsAvailable, viteLaunchSource };
