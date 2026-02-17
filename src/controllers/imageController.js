const imageService = require('../services/imageService');
const deApiService = require('../services/deApiService');
const geminiService = require('../services/geminiService');
const fs = require('fs')
const { Image, Generation } = require('../models/models');
const { Sequelize } = require('sequelize'); // ВАЖНО: импортируем Sequelize
const sequelize = require('../config/database'); // Импортируем экземпляр sequelize

class ImageController {
    // Получение всех изображений пользователя
    getUserImages = async (req, res, next) => {
        try {
            const userId = req.user.id;
            const { page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            const query = `
            SELECT 
                i.id, 
                i.user_id, 
                i.file_path, 
                i.type,
                i.filename,
                i."createdAt",
                g.id as gen_id, 
                g.status, 
                g.generated_filename,
                g.parameters,
                g.error_message,
                g."createdAt" as generation_created_at
            FROM generations g
            INNER JOIN images i ON i.id = g.image_id
            WHERE i.user_id = $1
            ORDER BY g."createdAt" DESC
            LIMIT $2 OFFSET $3
            `;

            const countQuery = `
            SELECT COUNT(*) as total
            FROM generations g
            INNER JOIN images i ON i.id = g.image_id
            WHERE i.user_id = $1
            `;

            const [generations, countResult] = await Promise.all([
            sequelize.query(query, {
                bind: [userId, parseInt(limit), parseInt(offset)],
                type: sequelize.QueryTypes.SELECT
            }),
            sequelize.query(countQuery, {
                bind: [userId],
                type: sequelize.QueryTypes.SELECT
            })
            ]);

            const total = parseInt(countResult[0].total);

            res.json({
            success: true,
            data: generations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
            });
        }
        catch (error) {
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

            const prompt = "Transform the animal in the image into a classical aristocratic oil portrait from the 17th–18th century. Preserve maximum likeness to the original animal: exact facial features, eye shape, muzzle proportions, fur pattern, color distribution, and overall identity must remain unchanged. Strictly preserve the original pose, body position, silhouette, proportions, scale, and head orientation from the source image. Do not alter anatomy or posture. The animal is resting on an elegant classical cushion, fully consistent with the old master aesthetic. The cushion is made of rich velvet fabric in deep warm tones (burgundy, dark brown, muted gold), with subtle embroidery and soft folds, naturally supporting the animal without changing its pose. Classical old European masters painting style, very rich oil paint texture with highly visible, layered, and directional brushstrokes, traditional canvas surface. Soft dramatic chiaroscuro lighting, dark atmospheric background. Luxurious velvet cloak with fur trim and refined gold jewelry. Bold, tactile oil strokes across the cushion, garments, and background, pronounced impasto highlights, expressive yet controlled painterly technique. High detail in fur, fabric, cushion texture, and metal, museum-quality fine art, vintage color grading, regal ceremonial portrait atmosphere.";
            const analysis = {};

            const generationResult = await deApiService.img2img(file.path, prompt, {
                model: process.env.DEAPI_MODEL,
                seed: Math.floor(Math.random() * 1000000),
                negative_prompt: "change of pose, altered anatomy, loss of likeness, floating subject, incorrect body support, human features, cartoon, anime, modern objects, photographic realism, smooth digital painting, flat lighting, neon colors, CGI, 3D, plastic texture, oversmoothing, identity drift, text, watermarks"
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