export const passwordPolicyMessage =
  'Password must contain at least 8 characters, including uppercase, lowercase, a number, and a special character.';

export const hasValidPassword = (password: string) =>
  password.length >= 8 &&
  /[A-Z]/.test(password) &&
  /[a-z]/.test(password) &&
  /[0-9]/.test(password) &&
  /[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;/`~]/.test(password);
