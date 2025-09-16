function executeLogin() {
  const username = document.getElementById('username').value.trim();

  if (!username) {
    alert('Please enter a valid username!');
    return;
  }
  
  localStorage.setItem('username', username);
  window.location.href = '../chat/chat.html';
}