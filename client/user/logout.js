function logout() {
  console.log('Logging out...');

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
    });
}
