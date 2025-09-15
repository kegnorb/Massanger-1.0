const ws = new WebSocket('ws://localhost:8081');
var newMessage;


function executeSend () {
  newMessage = document.getElementById('messageInput').value;
  console.log ('Sending message to server...');
  ws.send(newMessage);
  document.getElementById("messageInput").value = "";
}


ws.onmessage = event => {
  console.log('Response from server:\n ', event.data);
  //alert ('Response from server:\n' + event.data);
};