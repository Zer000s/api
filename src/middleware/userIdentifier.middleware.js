// middleware/userIdentifier.middleware.js
const { v4: uuidv4 } = require('uuid');

const userIdentifierMiddleware = (req, res, next) => {
  // Пытаемся получить идентификатор из cookie или заголовка
  let userId = req.cookies?.userId || req.headers['x-user-id'];
  
  // Если нет, создаем новый
  if (!userId) {
    userId = uuidv4();
    
    // Устанавливаем cookie с userId (httpOnly для безопасности)
    res.cookie('userId', userId, {
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict'
    });
  }
  
  // Добавляем userId в request
  req.user = { id: userId };
  
  // Также добавляем информацию об IP
  req.clientInfo = {
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    userId
  };
  
  next();
};

module.exports = { userIdentifierMiddleware };