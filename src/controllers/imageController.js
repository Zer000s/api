const imageService = require('../services/imageService');

class ImageController {
    // Получение всех изображений пользователя
    getUserImages = async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { page, limit, type } = req.query;

            const result = await imageService.getUserImages(userId, {
                page: parseInt(page) || 1,
                limit: parseInt(limit) || 20,
                type
            });

            res.json({
                success: true,
                data: result.images,
                pagination: result.pagination,
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId
                }
            });
        } catch (error) {
            next(error);
        }
    }

    // Анализ изображения
    analyze = async (req, res, next) => {
        try {
            const userId = req.user.id;

            // Обрабатываем загрузку файла
            const file = await imageService.handleUpload(req, res);

            // Анализируем изображение
            const result = await imageService.analyzeImage(file, userId);

            res.json({
                success: true,
                data: {
                    image: result.image,
                    analysis: result.analysis,
                    prompt: result.prompt
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId,
                    model: 'gemini-1.5-flash'
                }
            });
        } catch (error) {
            next(error);
        }
    }

    // Удаление изображения
    delete = async (req, res, next) => {
        try {
            const { filename } = req.params;
            const userId = req.user.id;

            // Проверка безопасности
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid filename'
                });
            }

            const result = await imageService.deleteImage(filename, userId);

            res.json({
                success: true,
                data: result,
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId
                }
            });
        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            if (error.message.includes('access denied')) {
                return res.status(403).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Получение информации об изображении
    getImageInfo = async (req, res, next) => {
        try {
            const { filename } = req.params;
            const userId = req.user.id;

            const image = await imageService.getImageInfo(filename, userId);

            res.json({
                success: true,
                data: image,
                metadata: {
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    // Получение статистики пользователя
    getUserStats = async (req, res, next) => {
        try {
            const userId = req.user.id;

            const stats = await imageService.getUserStats(userId);

            res.json({
                success: true,
                data: stats,
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId
                }
            });
        } catch (error) {
            next(error);
        }
    }

    // Тестирование Gemini подключения
    testGemini = async (req, res, next) => {
        try {
            const geminiService = require('../services/geminiService');
            const isConnected = await geminiService.testConnection();

            res.json({
                success: isConnected,
                message: isConnected ? 'Gemini API connected successfully' : 'Failed to connect to Gemini API',
                metadata: {
                    timestamp: new Date().toISOString(),
                    model: process.env.GEMINI_MODEL
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ImageController();