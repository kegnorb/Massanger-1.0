const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');

const jwt = require('jsonwebtoken');
const SECRET_KEY = 'dummy_secret_key'; // Will be updated to a strong secret key later

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
  const { username, password } = req.body;
  // Hardcoded password for testing
  const HARDCODED_PASSWORD = 'pass123';
  // Check credentials later; for now, accept any username and no password
  if (!username || password !== HARDCODED_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  // Create JWT token
  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
  console.log('[DBG]: Token generated:\n', token);
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

    // JWT handshake/auth
    if (payload.type === 'auth' && payload.token) {
      try {
        console.log('[DBG] Token received:\n', payload.token);
        const decoded = jwt.verify(payload.token, SECRET_KEY);
        ws.username = decoded.username
        console.log(`User authenticated: ${ws.username}`);
        clients.set(ws.username, ws);
        ws.send(JSON.stringify({ type: 'auth', status: 'success', username: ws.username }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'auth', status: 'fail' }));
        ws.close();
      }
      return;
    }

    if (payload.type === 'chat' && ws.username) {
      // handle chat message
      // Optionally modify payload object here (e.g., add server timestamp)
      payload.sender = ws.username;
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