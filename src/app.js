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
  origin: [process.env.FRONTEND_URL, 'http://localhost:3000', 'http://localhost:5173'].filter(Boolean),
  credentials: true
}));
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
  })
);
app.use(morgan('dev'));

app.use(cookieParser());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET");
  res.header("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// роуты (multer работает здесь)
app.use('/api', routes);

app.use(errorHandler);

module.exports = app;