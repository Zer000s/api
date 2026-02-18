// middleware/rateLimit.middleware.js
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');

// Настройка Redis (опционально, можно использовать MemoryStore для разработки)
const redisClient = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;

// Определяем лимиты для разных эндпоинтов
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
    keyGenerator: (req) => {
      // Используем комбинацию IP и user identifier для более точного трекинга
      const userId = req.user?.id || req.headers['x-user-identifier'] || 'anonymous';
      return `${req.ip}-${userId}`;
    }
  };

  // Используем Redis store если доступен, иначе MemoryStore
  if (redisClient) {
    config.store = new RedisStore({
      client: redisClient,
      prefix: 'rl:'
    });
  }

  return rateLimit(config);
};

// Специфичные лимиты для разных маршрутов
const rateLimits = {
  // Для загрузки изображений - 10 запросов в час
  upload: createRateLimiter(
    60 * 60 * 1000, // 1 час
    5,
    'Upload limit reached. Please try again later.'
  ),
  
  // Для проверки статуса - 60 запросов в минуту
  status: createRateLimiter(
    60 * 1000, // 1 минута
    60,
    'Status check limit reached.'
  ),
  
  // Общий лимит для API - 100 запросов в час
  api: createRateLimiter(
    60 * 60 * 1000, // 1 час
    100,
    'API limit reached.'
  )
};

module.exports = rateLimits;