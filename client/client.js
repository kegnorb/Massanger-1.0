const ws = new WebSocket('ws://localhost:8081');
var newMessageContent;


class Message {
  constructor({ id, content, timestamp, sender, status = 'sent' }) {
    this.id = id;
    this.content = content;
    this.timestamp = timestamp;
    this.sender = sender;
    this.status = status;
  }
}


function executeSend() {
  newMessageContent = document.getElementById('messageInput').value;
  const message = new Message({
    id: Date.now(),
    content: newMessageContent,
    timestamp: new Date().toISOString(),
    sender: 'Client1'
  });

  const messageJSON = JSON.stringify(message);


  console.log('Sending message to server...');
  ws.send(messageJSON);

  document.getElementById("messageInput").value = "";
}


ws.onmessage = event => {
  console.log('Response from server:\n ', event.data);
  const response = JSON.parse(event.data);
  const sender = response.sender;
  const messageDisplay = document.getElementsByClassName('message-display')[0];
  const messageBubble = document.createElement('div');

  //logic for distinguishing own and other messages
  if (sender === 'Client1') {
    messageBubble.classList.add('message-bubble-own');
  } else {
    messageBubble.classList.add('message-bubble-other');
  }
  
  messageBubble.textContent = `[${response.timestamp}] ${response.sender}: ${response.content} (Status: ${response.status})`;
  messageDisplay.appendChild(messageBubble);
};