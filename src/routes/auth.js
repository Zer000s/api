const express = require('express');
const authController = require('../controllers/authController');

const router = express.Router();

router.get('/google', authController.google)
router.get('/google/callback', authController.googleCallback)
router.post('/google/token', authController.googleToken)
router.get('/verify', authController.verify)
router.post('/logout', authController.logout)

module.exports = router;