let isAuthenticated = false;
let username = null;
let currentUserId = null; // Store the logged-in user's ID
let currentConversationId = null; // Store the current conversation ID
let conversationListLoaded = false;
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
      currentUserId = response.userId; // Store the userId from server
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

      // Request the conversation list after initial authentication
      if (!conversationListLoaded) {
        ws.send(JSON.stringify({ type: 'get-conversation-list' }));
        conversationListLoaded = true;
      }
    } else {
      alert('Authentication failed. Please log in again.');
      window.location.href = '../user/login.html';
      return;
    }
  }


  if (response.type === 'conversation-history' && response.conversationId === currentConversationId) {
    const messageDisplay = document.getElementsByClassName('message-display')[0];
    messageDisplay.innerHTML = ''; // Clear previous messages

    // Only use sort if messages are not guaranteed to be in order
    const sortedMessages = response.messages; //.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    sortedMessages.forEach(msg => {
      const messageItem = document.createElement('div');
      messageItem.classList.add('message-item');

      //Distinguishing self vs partner(s) messages
      if (msg.sender === username) {
        messageItem.classList.add('message-item-self');
      } else {
        messageItem.classList.add('message-item-partner');
      }

      messageItem.textContent = `[${msg.timestamp}] ${msg.sender}: ${msg.content}`;
      messageDisplay.appendChild(messageItem);
    });
  }


  if (response.type === 'new-message' && isAuthenticated) {
    console.log('[DBG] New message received:', response);
    const sender = response.sender;
    const messageDisplay = document.getElementsByClassName('message-display')[0];
    const messageItem = document.createElement('div');
    messageItem.classList.add('message-item');

    //logic for distinguishing own and other messages
    if (sender === username) {
      messageItem.classList.add('message-item-self');
    } else {
      messageItem.classList.add('message-item-partner');
    }

    messageItem.textContent = `[${response.timestamp}] ${response.sender}: ${response.content} (Status: ${response.status})`;
    messageDisplay.appendChild(messageItem);
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


  if (response.type === 'new-conversation') {
    // Add new conversation to UI
    console.log('New conversation created:', response);
    const conversationList = document.getElementsByClassName('conversation-list')[0];
    const conversationItem = document.createElement('div');
    conversationItem.classList.add('conversation-item');
    const partnerUsernames = response.usernames.filter(uname => uname !== username);
    conversationItem.textContent = `${partnerUsernames.join(', ')}`;
    conversationItem.dataset.conversationId = response.conversationId;
    conversationItem.onclick = () => handleConversationClick(response.conversationId);
    conversationList.appendChild(conversationItem);

    // Automatically select the new conversation
    handleConversationClick(response.conversationId);
  }


  if (response.type === 'conversation-exists') {
    // Conversation already exists
    console.log('Conversation exists:', response);
    // TODO: Select conversation in the list and Request history to open conversation messages
    // Send get-conversation-history type message to server
  }


  if (response.type === 'update-conversation-list') {
    const conversationList = document.getElementsByClassName('conversation-list')[0];
    conversationList.innerHTML = ''; // Clear previous list if any

    response.conversations.forEach(conversation => {
      const conversationItem = document.createElement('div');
      conversationItem.classList.add('conversation-item');
      // Show other participant(s) usernames (filter out self)
      const partnerUsernames = conversation.usernames.filter(uname => uname !== username);
      conversationItem.textContent = `${partnerUsernames.join(', ')}`;
      conversationItem.dataset.conversationId = conversation.conversationId;
      conversationItem.onclick = () => handleConversationClick(conversation.conversationId);
      conversationList.appendChild(conversationItem);
    });
  }

  // ...handle other response types for status updates, or errors, etc.
}// handleMessage



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

  if (!currentConversationId) {
    alert('No conversation selected.');
    return;
  }

  const newMessagePayload = createPayload('add-new-message', {
    conversationId: currentConversationId,
    sender: username,
    senderId: currentUserId,
    content: newMessageContent,
    timestamp: new Date().toISOString(),
  });

  const messageJSON = JSON.stringify(newMessagePayload);

  console.log('Sending new message to server...');
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
  console.log('Starting conversation with user:', user.username, user.userId, 'currentUserId:', currentUserId);
  ws.send(JSON.stringify({
    type: 'add-new-conversation',
    userIds: [currentUserId, user.userId]
  }));
}



function handleConversationClick(conversationId) {
  currentConversationId = conversationId;
  console.log('Selected conversation:', currentConversationId);
  
  // Request conversation history from the server
  ws.send(JSON.stringify({
    type: 'get-conversation-history',
    conversationId: currentConversationId
  }));
}



window.onload = function() {
  initWebSocket();
};



document.getElementById('searchUserInput').addEventListener('input', searchUsers);