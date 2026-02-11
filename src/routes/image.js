const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth.middleware');
const imageController = require('../controllers/imageController');

// Получить все изображения пользователя
router.get('/', imageController.getUserImages);

// Получить статистику пользователя
router.get('/stats', imageController.getUserStats);

// Получить информацию о конкретном изображении
router.get('/:filename', imageController.getImageInfo);

// Загрузка и анализ изображения
router.post('/analyze', imageController.analyze);

// Удаление изображения
router.delete('/:filename', imageController.delete);

// Тестовый маршрут для Gemini
router.get('/test/gemini', imageController.testGemini);

module.exports = router;