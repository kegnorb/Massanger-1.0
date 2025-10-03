function logout() {
  console.log('Logging out...');

  if (window.ws && ws.readyState === WebSocket.OPEN) {
    // Request the server to log out and clear the tokens
    fetch('/api/logout', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          console.log('Logged out successfully');
          window.location.href = '../user/login.html';
        } else {
          console.error('Logout failed');
        }
      })
      .catch(() => {
        console.error('Network error during logout');
      });
    } else {
      console.error('WebSocket is not connected');
      alert('You are offline. Logging out locally.');
      window.location.href = '../user/login.html';
    }
}
