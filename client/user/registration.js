function executeRegistration() {
  const email = document.getElementById('email').value.trim();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm_password').value;
  
  if (!email || !username || !password) {
    alert('Please fill in all fields!');
    return;
  }

  if (password !== confirmPassword) {
    alert('Passwords do not match!');
    return;
  }

  // HTTP POST request with registration data to server
  fetch('/api/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) { // on success login the user
      // Reuse the login function to log in the newly registered user
      executeLogin(username, password);
    } else {
      alert(data.error || 'Registration failed');
    }
  })
  .catch(() => alert('Network error'));
}