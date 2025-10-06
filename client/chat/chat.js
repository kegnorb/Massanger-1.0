let isAuthenticated = false;
let username = null;
let currentUserId = null; // Store the logged-in user's ID
let currentConversationId = null; // Store the current conversation ID
let conversationListLoaded = false;
let conversationsCache = []; // Stores all conversation objects
let ws;
let refreshTimer; 
let tokenRefreshInProgress = false;
let messagesLoaded = 0;
let allMessagesLoaded = false;
let messagePayloadQueue = []; // FIFO for messages to cache them in case of connection issues
let pendingMessagePayload = null; // To store the currently sending message payload
let isSendingMessagePayload = false;
let reconnectAttempts = 0;
var newMessageContent;

const messageDisplay = document.getElementsByClassName('message-display')[0];
const renderedMessageIds = new Set(); // To track rendered message IDs and avoid duplicates



function handleOpen() {
  console.log('WebSocket connection established. Authenticating...');
  // Authentication will be handled via cookies automatically sent by the browser
  hideNoConnectionWarning();
  reconnectAttempts = 0; // Reset on successful connection
  trySendMessagePayloadFromQueue(); // Attempt to send any queued messages
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
    // Only use sort if messages are not guaranteed to be in order
    const sortedMessages = response.messages; //.sort((a, b) => a.timestamp - b.timestamp);
    
    if (messageDisplay.innerHTML === '') { // Distinguish initial load vs. loading older messages
      renderNewestMessages(sortedMessages); // Initial load of conversation history
    } else {
      renderOlderMessages(sortedMessages); // Prepend older messages to already loaded history
    }

    messagesLoaded += sortedMessages.length; // Track offset for next fetch
    allMessagesLoaded = !response.hasMoreMessages;

    // If message display is not yet scrollable and more messages exist, request more to fill the view
    if (!isMessageDisplayScrollable() && !allMessagesLoaded) {
      getConversationHistory(currentConversationId, messagesLoaded, 20);
    }
  }


  if (response.type === 'new-message' && isAuthenticated) {
    console.log('[DBG] New message received:', response);

    // Check if the conversation exists in cache
    const exists = conversationsCache.some(c => c.conversationId === response.conversationId);
    if (!exists) {
      return console.warn('[WARN] Received message for unknown conversationId:', response.conversationId);
    }

    // Find the conversation in the cache and update its latestMessageTimestamp
    const i = conversationsCache.findIndex(c => c.conversationId === response.conversationId);
    if (i !== -1) {
      conversationsCache[i].latestMessageTimestamp = response.timestamp;
    }
    // Re-sort and re-render the conversation list
    const sortedConversations = sortConversationsChronologically(conversationsCache);
    renderConversationList(sortedConversations);

    if (response.conversationId !== currentConversationId) {
      console.log('[DBG] Message is for a different conversation. Ignoring display update.');
      return; // Ignore messages for other conversations
    }

    // TODO: remove pending message if rendered while connection was lost

    renderNewMessage(response);

    // TODO: Check if the sent back message is the same as the one in pendingMessagePayload
    // Only if so, clear pendingMessagePayload and isSendingMessagePayload to allow next message to be sent

    if (pendingMessagePayload && response.sender === username &&
        response.clientMessageId === pendingMessagePayload.clientMessageId) {
      // This is the echo of the message we just sent
      pendingMessagePayload = null; // Clear pendingMessagePayload on server echo
      isSendingMessagePayload = false; // Allow sending next message in queue
      trySendMessagePayloadFromQueue(); // Attempt to send next message if any
    }
  } // new-message


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
    conversationsCache.push({ // Add to cache
      conversationId: response.conversationId,
      userIds: response.userIds,
      usernames: response.usernames,
      createdAt: response.createdAt,
      latestMessageTimestamp: response.latestMessageTimestamp
    });
    const sortedConversations = sortConversationsChronologically(conversationsCache);
    renderConversationList(sortedConversations);
    handleConversationClick(response.conversationId); // Automatically select the new conversation
  }


  if (response.type === 'conversation-exists') {
    console.log('Conversation exists:', response);
    handleConversationClick(response.conversationId);
  }


  if (response.type === 'update-conversation-list') {
    conversationsCache = response.conversations; // Cache the full list
    sortedConversations = sortConversationsChronologically(conversationsCache);
    renderConversationList(sortedConversations);
  }


  if (response.type === 'error') {
    if (response.errCode === 'db_msg_insert_fail') {
      console.log('Failed to send message due to server error. Please try again.');
      return;
    }

    if (response.errCode === 'missing_clientMessageId') {
      console.log('Missing clientMessageId. Please try again.');
      return;
    }

    if (response.errCode === 'db_conversation_not_found') {
      console.log('Conversation not found. Please try again.');
      return;
    }

    console.log('Unknown server error:', response);
  } // error

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
    console.log('WebSocket connection closed unexpectedly.');
    showNoConnectionWarning();
    // TODO: handle UI state to indicate disconnection (manual reconnect button?)
    attemptReconnect();
  }     
}



function initWebSocket() {
  ws = new WebSocket('ws://localhost:8081');
  window.ws = ws; // Store reference to ws in the global window object
  ws.onopen = handleOpen;
  ws.onmessage = handleMessage;
  ws.onclose = handleClose;
}



function sortConversationsChronologically(conversations) {
  return [...conversations].sort((a, b) => b.latestMessageTimestamp - a.latestMessageTimestamp);
}



function renderConversationList(conversations) {
  const conversationList = document.getElementsByClassName('conversation-list')[0];
  conversationList.innerHTML = ''; // Clear previous list if any

  conversations.forEach(conversation => {
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




// Factory function to create payloads
function createPayload(type, props) {
  return { type, ...props };
}



function executeSend() {
  if (!isAuthenticated) {
    alert('You must be logged in to send messages.');
    return;
  }

  if (!currentConversationId) {
    alert('No conversation selected.');
    return;
  }

  newMessageContent = document.getElementById('messageInput').value;

  const newMessagePayload = createPayload('add-new-message', {
    conversationId: currentConversationId,
    sender: username,
    senderId: currentUserId,
    content: newMessageContent,
    timestamp: Date.now(),
    clientMessageId: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}` // Unique client-side ID
  });

  pushMessagePayloadToQueue(newMessagePayload);
  trySendMessagePayloadFromQueue();

  document.getElementById("messageInput").value = ""; // Clear input field
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



function getConversationHistory(conversationId, offset = 0, limit = 20) {
  ws.send(JSON.stringify({
    type: 'get-conversation-history',
    conversationId,
    offset,
    limit
  }));
}



// Open a conversation when clicked in the conversation list
function handleConversationClick(conversationId) {
  if (conversationId === currentConversationId) return;

  messageDisplay.innerHTML = ''; // Clear message display area

  renderedMessageIds.clear(); // Clear rendered message IDs

  // Reset conversation history tracking variables
  messagesLoaded = 0;
  allMessagesLoaded = false;

  currentConversationId = conversationId;
  console.log('Selected conversation:', currentConversationId);

  getConversationHistory(currentConversationId);
}



function createMessageItem(message) {
  const messageItem = document.createElement('div');
  messageItem.classList.add('message-item');
  if (message.sender === username) {
    messageItem.classList.add('message-item-self');
  } else {
    messageItem.classList.add('message-item-partner');
  }

  const dateAndTime = new Date(message.timestamp);

  messageItem.textContent = `[${dateAndTime.toLocaleString()}] ${message.sender}: ${message.content}`;
  messageItem.dataset.timestamp = message.timestamp; // For client-side sort tracking
  messageItem.dataset.clientMessageId = message.clientMessageId;

  return messageItem;
}



// For rendering messages when conversation is first loaded
function renderNewestMessages(messages) {
  messageDisplay.innerHTML = ''; // Clear previous messages if any
  messages.forEach(message => {
    messageDisplay.appendChild(createMessageItem(message));
  });

  scrollMessageDisplayToBottom();
}



// For rendering older messages when scrolling up or view is not yet filled
function renderOlderMessages(messages) {
  // Store scroll position and height before rendering
  const prevScrollHeight = messageDisplay.scrollHeight;
  const prevScrollTop = messageDisplay.scrollTop;
  
  messages.reverse().forEach(message => { // messages should be in reverse chronological order for prepending
    messageDisplay.insertBefore(createMessageItem(message), messageDisplay.firstChild);
  });

  // Adjust scroll position to keep message display view stable
  const newScrollHeight = messageDisplay.scrollHeight;
  messageDisplay.scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight);
}



function appendMessage(message) {
  messageDisplay.appendChild(createMessageItem(message));
}



function isMessageDisplayScrollable() {
  return messageDisplay.scrollHeight > messageDisplay.clientHeight;
}



function scrollMessageDisplayToBottom() {
  messageDisplay.scrollTop = messageDisplay.scrollHeight;
}



messageDisplay.onscroll = function() {
  if (messageDisplay.scrollTop === 0 && !allMessagesLoaded) {
    getConversationHistory(currentConversationId, messagesLoaded, 20);
  }
};



function pushMessagePayloadToQueue(message) {
  messagePayloadQueue.push(message);
}



function popMessagePayloadFromQueue() {
  if (messagePayloadQueue.length === 0) return null;
  
  return messagePayloadQueue.shift();
}



function sendNextMessagePayload() {
  if (ws.readyState !== WebSocket.OPEN) {
    isSendingMessagePayload = false;
    return; // Wait for reconnection
  }

  if (!pendingMessagePayload) { // check if there is a pending message already sent but not confirmed by server
    pendingMessagePayload = popMessagePayloadFromQueue(); // Overwrite pendingMessagePayload only if null (cleared on server echo)
    if (!pendingMessagePayload) { // Check again in case queue got empty
      isSendingMessagePayload = false;
      return; // Queue is empty
    }
  }

  ws.send(JSON.stringify(pendingMessagePayload));
  // Wait for server echo before clearing pendingMessagePayload and isSendingMessagePayload -> see handleMessage "new-message"
}



function trySendMessagePayloadFromQueue() {
  console.log('[DBG] messagePayloadQueue length:', messagePayloadQueue.length);
  if (isSendingMessagePayload || ws.readyState !== WebSocket.OPEN || messagePayloadQueue.length === 0) return;
  isSendingMessagePayload = true;
  sendNextMessagePayload();
}



// For rendering a single new message (for real-time updates)
function renderNewMessage(message) {
  if (message.clientMessageId && renderedMessageIds.has(message.clientMessageId)) {
    return; // Already rendered
  }

  const newMessageTimestamp = message.timestamp;
  let inserted = false;

  // Find the correct position to insert in case it's not the newest message (arrived out of order)
  for (let i = 0; i < messageDisplay.childNodes.length; i++) {
    const messageItemNode = messageDisplay.childNodes[i];
    const messageItemNodeTimestamp = Number(messageItemNode.dataset.timestamp);
    if (newMessageTimestamp < messageItemNodeTimestamp) { // Insert before the first newer message hit
      let newMessageItem = createMessageItem(message);
      messageDisplay.insertBefore(newMessageItem, messageItemNode);
      inserted = true;
      break;
    }
  }

  if (!inserted) { // If no insertion happened, its the newest message
    appendMessage(message);
    scrollMessageDisplayToBottom();
  }
  
  if (message.clientMessageId) {
    renderedMessageIds.add(message.clientMessageId);
  }
}



function showNoConnectionWarning() {
  const warning = document.getElementById('noConnectionWarning');
  warning.style.display = 'block';
}



function hideNoConnectionWarning() {
  const warning = document.getElementById('noConnectionWarning');
  warning.style.display = 'none';
}



function attemptReconnect() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000); // Exponential backoff, max 30s
  setTimeout(() => {
    reconnectAttempts++;
    initWebSocket();
  }, delay);
}



window.onload = function() {
  initWebSocket();
};



document.getElementById('searchUserInput').addEventListener('input', searchUsers);