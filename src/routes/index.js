const express = require('express');
const authRouter = require('./auth.js');
const imageRouter = require('./image.js');

const router = express.Router();

router.use('/auth', authRouter);
router.use('/images', imageRouter);

module.exports = router;