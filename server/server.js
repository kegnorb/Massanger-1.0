const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/user/login.html'));
});

// Serve static files from the client folder
app.use(express.static(path.join(__dirname, '../client')));

// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });
const clients = new Map();

wss.on('connection', ws => {
  ws.on('message', payloadJSON => {
    //console.log('Payload received:\n', payloadJSON);

    let payload;

    try {
      payload = JSON.parse(payloadJSON); // Parse incoming string to object
    } catch (e) {
      console.error('Invalid JSON:', payloadJSON);
      return;
    }

    if (payload.type === 'chat') {
      // handle chat message
    }
    // ...other types

    // Optionally modify payload object here (e.g., add server timestamp)
    ws.send(JSON.stringify(payload)); // Send back as proper JSON string
  });
});

server.listen(8081, () => {
  console.log('Server running on http://localhost:8081');
});