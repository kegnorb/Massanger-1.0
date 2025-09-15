const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

// Serve static files from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });

wss.on('connection', ws => {
  ws.on('message', messageJSON => {
    console.log('Message received:\n', messageJSON);
    let message;
    try {
      message = JSON.parse(messageJSON); // Parse incoming string to object
    } catch (e) {
      console.error('Invalid JSON:', messageJSON);
      return;
    }
    // Optionally modify message object here (e.g., add server timestamp)
    ws.send(JSON.stringify(message)); // Send back as proper JSON string
  });
});

server.listen(8081, () => {
  console.log('Server running on http://localhost:8081');
});