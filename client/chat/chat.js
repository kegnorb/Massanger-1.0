let isAuthenticated = false;
let username = null;
let ws;
let refreshTimer; 
let tokenRefreshInProgress = false;
var newMessageContent;



function handleOpen() {
  console.log('WebSocket connection established. Authenticating...');
  // Authentication will be handled via cookies automatically sent by the browser
}



function handleMessage(event) {
  console.log('Payload from server:\n ', event.data);
  const response = JSON.parse(event.data);

  if (response.type === 'auth') {
    if (response.status === 'success') {
      isAuthenticated = true;
      username = response.username;
      console.log(`Authenticated as ${username}`);

      if (document.getElementById('usernameDisplay').textContent === '') {
        document.getElementById('usernameDisplay').textContent = `${username}`;
      }

      tokenRefreshInProgress = false; // Reset in case it was a refresh-triggered reconnect

      // Proactive refresh timer setup
      if (response.exp) {
        console.log('[DBG] expiry timestamp received from server:', response.exp);
        const expMs = response.exp * 1000; // JWT exp is in seconds
        const nowMs = Date.now();
        const timeUntilExpiry = expMs - nowMs;
        console.log(`[DBG] Token expires in ${timeUntilExpiry / 1000} seconds`);
        // Refresh 30 seconds before expiry
        const refreshDelay = Math.max(timeUntilExpiry - 30000, 0);
        console.log(`[DBG] Setting proactive refresh in ${refreshDelay / 1000} seconds`);

        if (refreshTimer) clearTimeout(refreshTimer);

        refreshTimer = setTimeout(() => {
          if (tokenRefreshInProgress) return; // Avoid multiple refresh attempts
          console.log('[DBG] Proactively triggering refresh of access token...');
          ws.send(JSON.stringify({ type: 'token-expired-close' }));
        }, refreshDelay);
      }

      // Load chat UI and previous messages in later versions
    } else {
      alert('Authentication failed. Please log in again.');
      window.location.href = '../user/login.html';
      return;
    }
  }

  if (response.type === 'chat' && isAuthenticated) {
    const sender = response.sender;
    const messageDisplay = document.getElementsByClassName('message-display')[0];
    const messageBubble = document.createElement('div');

    //logic for distinguishing own and other messages
    if (sender === username) {
      messageBubble.classList.add('message-bubble-own');
    } else {
      messageBubble.classList.add('message-bubble-other');
    }
  
    messageBubble.textContent = `[${response.timestamp}] ${response.sender}: ${response.content} (Status: ${response.status})`;
    messageDisplay.appendChild(messageBubble);
  }

  if (response.type === 'search-results') {
    const resultsBox = document.getElementById('searchResultsBox');
    resultsBox.innerHTML = '';
    response.users.forEach(user => {
      const item = document.createElement('div');
      item.classList.add('search-result-item');
      item.textContent = user.username;
      item.onclick = () => startConversationWith(user);
      resultsBox.appendChild(item);
    });
  }

  // ...handle other response types for status updates, or errors, etc.
}



function handleClose(event) {
  if (event.reason === 'token_expired' && !tokenRefreshInProgress) {
    tokenRefreshInProgress = true;
    fetch('/api/refresh', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          console.log('Access token refreshed. Reconnecting WebSocket...');
          initWebSocket(); // Reconnect WebSocket
          tokenRefreshInProgress = false;
        } else {
          alert('Session expired. Please log in again.');
          window.location.href = '../user/login.html';
        }
      });
  } else if (event.reason === 'logout') {
    console.log('Logout completed successfully.');
    window.location.href = '../user/login.html';
  } else {
    alert('WebSocket connection closed. Please log in again.');
    window.location.href = '../user/login.html';
  }
}



function initWebSocket() {
  ws = new WebSocket('ws://localhost:8081');
  ws.onopen = handleOpen;
  ws.onmessage = handleMessage;
  ws.onclose = handleClose;
}



// Factory function to create payloads
function createPayload(type, props) {
  return { type, ...props };
}



function executeSend() {
  if (!isAuthenticated) {
    alert('You must be logged in to send messages.');
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) {
    alert('Connection lost. Please wait while reconnecting...');
    // Later reconnection might be triggered here
    return;
  }

  newMessageContent = document.getElementById('messageInput').value;

  const chatPayload = createPayload('chat', {
    sender: username,
    id: Date.now(),
    content: newMessageContent,
    timestamp: new Date().toISOString(),
  });

  const messageJSON = JSON.stringify(chatPayload);

  console.log('Sending message to server...');
  ws.send(messageJSON);

  document.getElementById("messageInput").value = "";
}



function searchUsers() {
  const query = this.value.trim();
  //if (query.length < 2) return; // Only search for 2+ chars

  // Send search request via WebSocket
  ws.send(JSON.stringify({ type: 'search-users', query }));  
}



function startConversationWith(user) {
  console.log(`Starting conversation with ${user.username} [id: ${user.userid}] (not implemented yet).`);
}



window.onload = function() {
  initWebSocket();
};



document.getElementById('searchUserInput').addEventListener('input', searchUsers);