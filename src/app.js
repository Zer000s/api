const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser')
require('dotenv').config();

const routes = require('./routes/index.js');
const { errorHandler } = require('./middleware/error.middleware');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(helmet());
app.use(morgan('dev'));

app.use(cookieParser());

// статик можно оставить
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// роуты (multer работает здесь)
app.use('/api', routes);

// body parsers после роутов upload — безопаснее
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(errorHandler);

module.exports = app;