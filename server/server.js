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



// HTTP authentication endpoint with dummy logic
app.use(express.json());
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  // Check credentials later; for now, accept any username and no password
  if (!username) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Generate a dummy token (later JWT will be used)
  const token = Buffer.from(username + Date.now()).toString('base64');
  res.json({ token });
});



// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });
const clients = new Map();



wss.on('connection', ws => {
  ws.username = null; // Track authenticated user

  ws.on('message', payloadJSON => {
    //console.log('Payload received:\n', payloadJSON);

    let payload;

    try {
      payload = JSON.parse(payloadJSON); // Parse incoming string to object
    } catch (e) {
      console.error('Invalid JSON:', payloadJSON);
      return;
    }

    // Handle handshake/auth
    if (payload.type === 'auth' && payload.token) {
      // Dummy token check: decode username from token (for now)
      try {
        const decoded = Buffer.from(payload.token, 'base64').toString();
        ws.username = decoded.split(/[0-9]/)[0];
        console.log(`User authenticated: ${ws.username}`);
        clients.set(ws.username, ws);
        ws.send(JSON.stringify({ type: 'auth', status: 'success', username: ws.username }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'auth', status: 'fail' }));
        ws.close();
      }
      return;
    }

    if (payload.type === 'chat') {
      // handle chat message
      // Optionally modify payload object here (e.g., add server timestamp)
      payload.timestamp = new Date().toISOString();
      payload.status = 'received';
      ws.send(JSON.stringify(payload)); // Send back as proper JSON string
    }
    // ...other types
  }); //ws.on('message')



  ws.on('close', () => {
    if (ws.username) {
      clients.delete(ws.username);
      console.log(`User disconnected: ${ws.username}`);
    }
  }); //ws.on('close')
});



server.listen(8081, () => {
  console.log('Server running on http://localhost:8081');
});