const express = require('express');
const router = express.Router();
const {
  register, login, refresh, logout,
  registerValidation, loginValidation
} = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', registerValidation, register);
router.post('/login', loginValidation, login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, async (req, res) => {
  const prisma = require('../config/prisma');
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { membership: true, gamifiedProfile: true },
    omit: { password: true },
  });
  res.json(user);
});

module.exports = router;
