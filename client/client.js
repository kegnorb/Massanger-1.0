const ws = new WebSocket('ws://localhost:8081');

function executeSend () {
  console.log ('Sending Hello to server!');
  ws.send('Hello from client!');
}

//ws.onopen = () => {
//  ws.send('Hello from client!');
//};

ws.onmessage = event => {
  console.log('Server says: ', event.data);
  alert ('Server says: ' + event.data);
};