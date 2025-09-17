function executeLogin() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  
  if (!username || !password) {
    alert('Please enter a valid username and password!');
    return;
  }

  // HTTP POST request with credentials to server
  fetch('/api/login', { // sending the credentials here
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  .then(res => res.json())  // wait for JSON response from server
  .then(data => {
    if (data.token) { // on success, store token and username then redirect to chat
      localStorage.setItem('token', data.token);
      localStorage.setItem('username', username);
      window.location.href = '../chat/chat.html';
    } else {
      alert(data.error || 'Login failed');
    }
  })
  .catch(() => alert('Network error'));
}