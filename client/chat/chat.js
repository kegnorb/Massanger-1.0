let isAuthenticated = false;
let username = null;
var newMessageContent;

const ws = new WebSocket('ws://localhost:8081');



// Factory function to create payloads
function createPayload(type, props) {
  return { type, ...props };
}



function executeSend() {
  if (!isAuthenticated) {
    alert('You must be logged in to send messages.');
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



ws.onopen = () => {
  console.log('WebSocket connection established. Authenticating...');
  // Authentication will be handled via cookies automatically sent by the browser
}; //ws.onopen



ws.onmessage = event => {
  console.log('Payload from server:\n ', event.data);
  const response = JSON.parse(event.data);

  if (response.type === 'auth') {
    if (response.status === 'success') {
      isAuthenticated = true;
      username = response.username;
      console.log(`Authenticated as ${username}`);
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
  // ...handle other response types for status updates, or errors, etc.
}; //ws.onmessage