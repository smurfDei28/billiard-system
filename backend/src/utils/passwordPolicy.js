const passwordPolicyMessage =
  'Password must contain at least 8 characters, including uppercase, lowercase, a number, and a special character.';

const hasValidPassword = (password) => {
  const value = String(password || '');
  return value.length >= 8 &&
    /[A-Z]/.test(value) &&
    /[a-z]/.test(value) &&
    /[0-9]/.test(value) &&
    /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;/`~]/.test(value);
};

module.exports = { hasValidPassword, passwordPolicyMessage };
