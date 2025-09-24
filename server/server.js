// --- Imports ---
const cookie = require('cookie');
const express = require('express');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

// --- Configurations ---
const SECRET_KEY = 'dummy_secret_key'; // Will be updated to a strong secret key later
const MONGO_URI = 'mongodb://localhost:27017';
const DB_NAME = 'massangerdb';

// --- App setup ---
const app = express();
const server = http.createServer(app);

// --- Middleware ---
app.use(express.static(path.join(__dirname, '../client'))); // Serve static files from the client folder
app.use(express.json()); // for parsing incoming JSON requests

// --- Global variables ---
let db; 
let users, conversations, messages; // Collections

// Map to keep track of user connections
const userConnections = new Map(); // userId -> Set of ws connections



// --- Async initializations ---
const mongoPromise = MongoClient.connect(MONGO_URI)
  .then(client => {
    db = client.db(DB_NAME);
    users = db.collection('users');
    conversations = db.collection('conversations');
    messages = db.collection('messages');
    console.log('MongoDB connected and collections are ready');
  })
  .catch(err => {
    console.error('MongoDB connection failed:', err);
    process.exit(1);
  });

// Add more async initializations here if needed...



// --- Helper functions ---
async function getUsernamesForUserIds(userIds) {
  const userDocs = await users.find(
    { _id: { $in: userIds.map(id => ObjectId.createFromHexString(id)) } },
    { projection: { username: 1 } }
  ).toArray();
  const idToUsername = Object.fromEntries(userDocs.map(u => [u._id.toString(), u.username]));
  return userIds.map(id => idToUsername[id] || '(unknown)');
}



// --- Routes and WebSocket handling ---

// Root route (endpoint) to serve login page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/user/login.html'));
});



// HTTP authentication endpoint with dummy logic
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Find user by username
    const user = await users.findOne({ username });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password (plain text for now; use hashing in production)
    if (user.password !== password) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Access token: 15 minutes
    const accessToken = jwt.sign({ username, userId: user._id.toString() }, SECRET_KEY, { expiresIn: '1m' /*'15m'*/ }); 
    // Refresh token: 90 days
    const refreshToken = jwt.sign({ username, userId: user._id }, SECRET_KEY, { expiresIn: '2m' /*'90d'*/ });
    console.log('[DBG]: access token generated:\n', accessToken);
    console.log('[DBG]: refresh token generated:\n', refreshToken);

    // Set cookie options
    res.setHeader('Set-Cookie', [
      cookie.serialize('accessToken', accessToken, {
        httpOnly: true,
        // secure: true, // Uncomment when using HTTPS
        sameSite: 'strict', // CSRF protection
        maxAge: 60,//60 * 60, // 1 hour expiry for the cookie containing the token
        path: '/' // by default path would be 'api/login'. Setting it to '/' so that it's sent with all requests including ws handshake
      }),
      cookie.serialize('refreshToken', refreshToken, {
        httpOnly: true,
        // secure: true, // Uncomment when using HTTPS
        sameSite: 'strict',
        maxAge: 120,//90 * 24 * 60 * 60, // 90 days
        path: '/'
      })
    ]);
    res.json({ success: true }); // Token is sent in the httpOnly cookie (in the header)
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}); //app.post('/api/login' ...)



// Logout endpoint to clear cookies, session data and close WebSocket
app.post('/api/logout', (req, res) => {
  console.log('Logout request received');

  // Extract username from access token (if present)
  const cookies = cookie.parse(req.headers.cookie || '');
  const accessToken = cookies.accessToken;
  let username = null;

  if (accessToken) {
    try {
      const decoded = jwt.verify(accessToken, SECRET_KEY);
      username = decoded.username;
    } catch (err) {
      // Token invalid/expired, nothing to do
    }
  }

  // Close WebSocket connection for this user if exists
  if (username && clients.has(username)) {
    const ws = clients.get(username);
    ws.close(4000, 'logout');
    clients.delete(username);
  }

  // Clear the cookies by setting them to expire in the past
  res.setHeader('Set-Cookie', [
    cookie.serialize('accessToken', '', {
      httpOnly: true,
      // secure: true,
      sameSite: 'strict',
      expires: new Date(0),
      path: '/',
    }),
    cookie.serialize('refreshToken', '', {
      httpOnly: true,
      // secure: true,
      sameSite: 'strict',
      expires: new Date(0),
      path: '/',
    })
  ]);

  res.json({ success: true });
});



// Registration endpoint with basic validation and user creation
app.post('/api/register', async (req, res) => {
  const { email, username, password } = req.body;
  console.log('[DBG] Registration request received: ', { email, username, password });

  // Basic validation
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await users.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Create new user
    await users.insertOne({ email, username, password });
    res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});



// Token refresh endpoint (refresh the access token then rotate (refresh) the refresh token too)
app.post('/api/refresh', (req, res) => {
  console.log('[DBG] Refresh token request received');

  const cookies = cookie.parse(req.headers.cookie || '');
  const refreshToken = cookies.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token found' });
  }

  try {
    const decoded = jwt.verify(refreshToken, SECRET_KEY);
    const newAccessToken = jwt.sign({ username: decoded.username, userId: decoded.userId }, SECRET_KEY, { expiresIn: '1m' });
    const newRefreshToken = jwt.sign({ username: decoded.username, userId: decoded.userId }, SECRET_KEY, { expiresIn: '2m' });

    console.log('[DBG] New access token generated:\n', newAccessToken);
    console.log('[DBG] New refresh token generated:\n', newRefreshToken);

    // Set new access token and new refresh token in httpOnly cookie
    res.setHeader('Set-Cookie', [
      cookie.serialize('accessToken', newAccessToken, {
        httpOnly: true,
        // secure: true,
        sameSite: 'strict',
        maxAge: 1 * 60,
        path: '/',
      }),
      cookie.serialize('refreshToken', newRefreshToken, {
        httpOnly: true,
        // secure: true,
        sameSite: 'strict',
        maxAge: 2 * 60,
        path: '/',
      })
    ]);

    res.json({ success: true });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}); //app.post('/api/refresh' ...)



// Attach WebSocket server to the same HTTP server
const wss = new WebSocket.Server({ server });
const clients = new Map();



wss.on('connection', (ws, req) => {
  ws.username = null; // Track authenticated user
  ws.userId = null;

  // Extract cookies from the handshake request
  const cookies = cookie.parse(req.headers.cookie || '');
  const accessToken = cookies.accessToken;

  console.log('[DBG] access token received:\n', accessToken);

  if (!accessToken) {
    ws.send(JSON.stringify({ type: 'auth', status: 'fail', error: 'No access token found' }));
    ws.close();
    return;
  } 

  // access token (JWT) handshake/auth
  try {
    ws.accessToken = accessToken; // Store token for (fallback) expiry checks
    const decoded = jwt.verify(accessToken, SECRET_KEY);
    ws.username = decoded.username
    ws.userId = decoded.userId;

    // Make available the connection instance of this userId for other users' connections to send real-time messages
    if (!userConnections.has(ws.userId)) userConnections.set(ws.userId, new Set());
    userConnections.get(ws.userId).add(ws);

    clients.set(ws.username, ws);
    console.log(`User authenticated: ${ws.username}`);
    ws.send(JSON.stringify({ 
      type: 'auth', 
      status: 'success', 
      username: ws.username,
      userId: ws.userId,
      exp: decoded.exp // Send expiry timestamp to client
    }));
  } catch (err) {
    ws.send(JSON.stringify({ type: 'auth', status: 'fail', error: 'Invalid access token' }));
    ws.close();
    return;
  }

  ws.on('message', async payloadJSON => {
    //console.log('[DBG] Payload received:\n', payloadJSON);
    let payload;

    try {
      payload = JSON.parse(payloadJSON); // Parse incoming string to object
    } catch (e) {
      console.error('Invalid JSON:', payloadJSON);
      return;
    }


    // Fallback check for token expiry on every message except 'token-expired-close'
    if (payload.type !== 'token-expired-close') {
      try {
        jwt.verify(ws.accessToken, SECRET_KEY);
      } catch (err) { // Will throw if expired/invalid
        console.log('Access token expired/invalid during message handling. Closing connection, issuing token refresh...');
        ws.close(4001, 'token_expired');
        return;
      }
    }


    if (payload.type === 'token-expired-close') {
      ws.close(4001, 'token_expired');
      return;
    }


    if (payload.type === 'get-conversation-list' && ws.userId) {
      // Find all conversations where the user is a participant
      const userConversations = await conversations.find({ userIds: ws.userId }).toArray();

      const allUserIds = [...new Set(userConversations.flatMap(c => c.userIds))];

      const userDocs = await users.find(
        { _id: { $in: allUserIds.map(id => ObjectId.createFromHexString(id)) } },
        { projection: { username: 1 } }
      ).toArray();

      // Build a lookup map: userId (as string) -> username
      const idToUsername = Object.fromEntries(userDocs.map(u => [u._id.toString(), u.username]));

      // Later, include latest message timestamp for each conversation (for future sorting)
      // For now, just send the conversation objects
      ws.send(JSON.stringify({
        type: 'update-conversation-list',
        conversations: await Promise.all(
          userConversations.map(async conversation => ({
            conversationId: conversation._id.toString(),
            userIds: conversation.userIds,
            usernames: await getUsernamesForUserIds(conversation.userIds),
            createdAt: conversation.createdAt
            // latestMessageTimestamp: conversation.latestMessageTimestamp
          }))
        )
      }));
      return;
    }


    if (payload.type === 'add-new-conversation' && Array.isArray(payload.userIds)) {
      // Ensure only two participants for now
      const participants = payload.userIds.sort(); // sort for consistent matching

      // Check if conversation already exists
      const existing = await conversations.findOne({ userIds: { $all: participants, $size: participants.length } });
      if (existing) {
        ws.send(JSON.stringify({
          type: 'conversation-exists',
          conversationId: existing._id.toString(),
          userIds: existing.userIds
        }));
        return;
      }

      // Create new conversation
      const conversation = {
        userIds: participants,
        createdAt: new Date()
      };
      const result = await conversations.insertOne(conversation);

      const usernames = await getUsernamesForUserIds(participants);

      ws.send(JSON.stringify({
        type: 'new-conversation',
        conversationId: result.insertedId.toString(),
        userIds: participants,
        usernames,
        createdAt: conversation.createdAt
      }));
      return;
    }


    if (payload.type === 'get-conversation-history' && ws.userId && payload.conversationId) {
      const query = { conversationId: payload.conversationId }; // Query all messages for this conversation
      // Add .limit(n) and .sort({ timestamp: -1 }) here later for lazy loading
      const messagesArray = await messages.find(query)./* sort({ timestamp: -1 }).limit(50). */toArray();
      // messagesArray.reverse(); // To get chronological order
        
      // Sort by timestamp ascending (chronological order) only used if not using .sort() in the query above
      messagesArray.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

      ws.send(JSON.stringify({
        type: 'conversation-history',
        conversationId: payload.conversationId,
        messages: messagesArray
      }));
      return;
    }


    if (payload.type === 'add-new-message' && ws.userId && payload.conversationId && payload.content) {
      const conversation = await conversations.findOne({ _id: ObjectId.createFromHexString(payload.conversationId) });
      
      if (!conversation) {
        ws.send(JSON.stringify({ type: 'error', message: 'Conversation not found.' }));
        return;
      }

      const message = {
        conversationId: payload.conversationId,
        senderId: ws.userId,
        sender: ws.username,
        content: payload.content,
        timestamp: new Date(),
        // Add more metadata if needed
      };
    
      // Insert the message into the messages collection
      await messages.insertOne(message);
    
      // Update the latestMessageTimestamp in the conversation
      await conversations.updateOne(
        { _id: ObjectId.createFromHexString(payload.conversationId) },
        { $set: { latestMessageTimestamp: message.timestamp } }
      );
    
      // Broadcast the new message to every participants' every connections including the sender too
      for (const recipientId of conversation.userIds) {
        const connections = userConnections.get(recipientId);
        if (connections) {
          for (const recipientWs of connections) {
            recipientWs.send(JSON.stringify({ type: 'new-message', ...message }));
          }
        }
      }
    
      return;
    }
    

    if (payload.type === 'search-users' && typeof payload.query === 'string') {
      if (!payload.query.trim()) {
      ws.send(JSON.stringify({ type: 'search-results', users: [] }));
      return;
    }

    const regex = new RegExp('^' + payload.query, 'i');
      const foundUsers = await users.find({ username: { $regex: regex } }).toArray();
      // Exclude current user
      const filtered = foundUsers
        .map(u => ({
          username: u.username,
          userId: u._id
        })) 
        .filter(u => u.username !== ws.username); // Exclude current user from results
      ws.send(JSON.stringify({ type: 'search-results', users: filtered }));
      return;
    }
    // ...other types
  }); //ws.on('message')



  ws.on('close', () => {
    if (ws.username) {
      clients.delete(ws.username);

      userConnections.get(ws.userId)?.delete(ws);
      if (userConnections.get(ws.userId)?.size === 0) userConnections.delete(ws.userId);
      
      console.log(`User disconnected: ${ws.username}`);
    }
  }); //ws.on('close')
});



// --- Wait for all initializations before starting server ---
Promise.all([mongoPromise /*, redisPromise */])
  .then(() => {
    // All async inits are done, start the server
    server.listen(8081, () => {
      console.log('Server running on http://localhost:8081');
    });
  })
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });