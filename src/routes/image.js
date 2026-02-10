const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const imageController = require('../controllers/imageController');

// Загрузка и анализ изображения
router.post('/analyze', authMiddleware, imageController.analyze);

// Генерация нового изображения по промпту
router.post('/generate', authMiddleware, imageController.generate);

// Полная обработка: анализ + генерация
router.post('/process', authMiddleware, imageController.process);

// Получение истории изображений пользователя
router.get('/history', authMiddleware, imageController.history);

// Удаление изображения
router.delete('/:filename', authMiddleware, imageController.delete);

module.exports = router;