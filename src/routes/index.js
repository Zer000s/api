const express = require('express');
const imageRouter = require('./image.js');

const router = express.Router();

router.use('/images', imageRouter);

module.exports = router;