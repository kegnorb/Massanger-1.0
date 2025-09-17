const cookie = require('cookie');
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

  const HARDCODED_PASSWORD = 'pass123';

  // Check credentials
  if (!username || password !== HARDCODED_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Create JWT token
  const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
  console.log('[DBG]: Token generated:\n', token);

  // Set cookie options
  res.setHeader('Set-Cookie', cookie.serialize('token', token, {
    httpOnly: true,
    // secure: true, // Uncomment when using HTTPS
    sameSite: 'strict', // CSRF protection
    maxAge: 60 * 60, // 1 hour expiry for the cookie containing the token
    path: '/' // path is by default would be api/login, setting it to / so that it's sent with all requests including ws handshake
  }));

  res.json({ success: true }); // Token is sent in the httpOnly cookie (in the header)
});



// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });
const clients = new Map();



wss.on('connection', (ws, req) => {
  ws.username = null; // Track authenticated user

  // Extract cookies from the handshake request
  const cookies = cookie.parse(req.headers.cookie || '');
  const token = cookies.token;

  console.log('[DBG] Token received:\n', token);

  if (!token) {
    ws.send(JSON.stringify({ type: 'auth', status: 'fail', error: 'No token found' }));
    ws.close();
    return;
  } 

  // JWT handshake/auth
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    ws.username = decoded.username
    clients.set(ws.username, ws);
    console.log(`User authenticated: ${ws.username}`);
    ws.send(JSON.stringify({ type: 'auth', status: 'success', username: ws.username }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'auth', status: 'fail', error: 'Invalid token' }));
    ws.close();
    return;
  }

  ws.on('message', payloadJSON => {
    //console.log('[DBG] Payload received:\n', payloadJSON);
    let payload;

    try {
      payload = JSON.parse(payloadJSON); // Parse incoming string to object
    } catch (e) {
      console.error('Invalid JSON:', payloadJSON);
      return;
    }

    if (payload.type === 'chat' && ws.username) {
      // handle chat message
      // Optionally modify payload object here (e.g., add server timestamp)
      payload.sender = ws.username;
      payload.timestamp = new Date().toISOString();
      payload.status = 'received';
      ws.send(JSON.stringify(payload)); // Send back as JSON string
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