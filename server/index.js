/**
 * index.js — Entry point for the QuickBite server.
 *
 * Steps:
 *  1. Load and validate environment variables
 *  2. Create the HTTP server from the Express app
 *  3. Attach Socket.IO to the HTTP server
 *  4. Start listening on the configured port
 */

// This must come first so env vars are available to all modules
const env = require('./src/config/env');

const http           = require('http');
const app            = require('./src/app');
const { initSocket } = require('./socket');

// Create the HTTP server and attach Socket.IO
const httpServer = http.createServer(app);
initSocket(httpServer);

// Start listening
httpServer.listen(env.port, () => {
  console.log(`\n🚀 QuickBite server running at http://localhost:${env.port}`);
  console.log(`   Environment : ${env.nodeEnv}`);
  console.log(`   Database    : ${env.db.database} @ ${env.db.host}:${env.db.port}`);
  console.log(`   CORS origin : ${env.clientOrigin}`);
  console.log(`   Health check: http://localhost:${env.port}/api/health\n`);
});

// Graceful shutdown on SIGTERM (e.g. from Docker or process managers)
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM received. Shutting down gracefully...');
  httpServer.close(() => {
    console.log('[Server] HTTP server closed.');
    process.exit(0);
  });
});
