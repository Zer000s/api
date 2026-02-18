// middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
// Импортируем helper функцию
const { ipKeyGenerator } = require('express-rate-limit');

// Настройка Redis (опционально)
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

const createRateLimiter = (windowMs, max, message) => {
  const config = {
    windowMs,
    max,
    message: {
      success: false,
      error: message || 'Too many requests, please try again later.'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // ✅ ПРАВИЛЬНЫЙ keyGenerator с использованием ipKeyGenerator
    keyGenerator: (req) => {
      // Для аутентифицированных пользователей можно использовать их ID
      if (req.user?.id) {
        return `user-${req.user.id}`;
      }
      
      // Для всех остальных используем IP с правильной обработкой IPv6
      // Функция ipKeyGenerator автоматически применит маску подсети (по умолчанию /64 для IPv6)
      return ipKeyGenerator(req.ip);
      
      // ⚠️ НЕПРАВИЛЬНО: return req.ip;
    }
  };

  // Используем Redis store если доступен
  if (redisClient) {
    config.store = new RedisStore({
      client: redisClient,
      prefix: 'rl:'
    });
  }

  return rateLimit(config);
};

// Лимиты для разных маршрутов
const rateLimits = {
  upload: createRateLimiter(
    60 * 60 * 1000, // 1 час
    5,
    'Upload limit reached. Please try again later.'
  ),
  
  status: createRateLimiter(
    60 * 1000, // 1 минута
    60,
    'Status check limit reached.'
  ),
  
  api: createRateLimiter(
    60 * 60 * 1000, // 1 час
    100,
    'API limit reached.'
  )
};

module.exports = rateLimits;