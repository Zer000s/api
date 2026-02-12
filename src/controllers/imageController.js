const imageService = require('../services/imageService');
const deApiService = require('../services/deApiService');
const geminiService = require('../services/geminiService');
const fs = require('fs')
const { Image, Generation } = require('../models/models');

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

    // Анализ изображения
    analyze = async (req, res, next) => {
        try {
            const userId = req.user.id;
            
            // Файл уже доступен в req.file благодаря middleware в роутере
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
            }

            // Анализируем изображение
            const result = await imageService.analyzeImage(req.file, userId);

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
            // Удаляем файл при ошибке
            if (req.file && req.file.path && require('fs').existsSync(req.file.path)) {
                require('fs').unlinkSync(req.file.path);
            }
            next(error);
        }
    }

    process = async (req, res, next) => {
        try {
            const userId = req.user.id;
            
            // Файл уже доступен в req.file благодаря middleware в роутере
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
            }

            const file = req.file;

            // Анализируем изображение
            // const result = await imageService.analyzeImage(file, userId);

            const prompt = "Кот в шубе";
            const analysis = {};

            const generationResult = await deApiService.img2img(file.path, prompt, {
                model: process.env.DEAPI_MODEL,
                seed: Math.floor(Math.random() * 1000000),
                negative_prompt: 'blurry, low quality, distorted, ugly, bad anatomy'
            });

            // 4. Сохраняем оригинальное изображение
            const originalImage = await Image.create({
                user_id: userId,
                filename: file.filename,
                original_filename: file.originalname,
                file_path: file.path,
                file_size: file.size,
                mime_type: file.mimetype,
                type: 'original',
                analysis_data: analysis,
                prompt: prompt,
                metadata: {
                    style: "ven",
                    processedAt: new Date().toISOString()
                }
            });

            // 4. Сохраняем запись о генерации изображения
            const generateImage = await Generation.create({
                user_id: userId,
                image_id: originalImage.id,
                prompt: prompt,
                parameters: { request_id: generationResult.request_id }
            });

            res.json({
                success: true,
                original: {
                    id: originalImage.id,
                    url: `/uploads/${originalImage.filename}`,
                    analysis: analysis
                },
                generated: {
                    id: generateImage.id,
                    request_id: generationResult.request_id
                }
            });
        }
        catch (error) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            next(error);
        }
    }

    getGenerationStatus = async (req, res, next) => {
        try {
            const { requestId } = req.params;

            const userId = req.user.id;

            if (!requestId) {
                return res.status(400).json({
                    success: false,
                    error: 'requestId is required'
                });
            }

            const statusData = await deApiService.getRequestStatus(requestId, userId);

            res.json({
                success: true,
                data: statusData,
                metadata: {
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            next(error);
        }
    }

    // Тестирование Gemini подключения
    testGemini = async (req, res, next) => {
        try {
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