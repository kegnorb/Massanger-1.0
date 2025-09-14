const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Serve static files from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// Optionally, serve a specific HTML file for '/'
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', message => {
    console.log('received:', message);
    ws.send('Acknowledged: ' + message);
  });
});

server.listen(8081, () => {
  console.log('Server running on http://localhost:8081');
});