function executeLogin(uname, pwd) {
  const username = uname || document.getElementById('username').value.trim();
  const password = pwd   || document.getElementById('password').value;

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
    if (data.success) { // on success, redirect to chat
      window.location.href = '../chat/chat.html';
    } else {
      alert(data.error || 'Login failed');
    }
  })
  .catch(() => alert('Network error'));
}