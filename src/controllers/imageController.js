// controllers/imageController.js (обновленная версия)
const imageService = require('../services/imageService');
const deApiService = require('../services/deApiService');
const fs = require('fs');
const { Image, Generation, AnonymousSession } = require('../models/models');
const { Sequelize } = require('sequelize');
const sequelize = require('../config/database');

class ImageController {
    // Process с поддержкой анонимных пользователей
    process = async (req, res, next) => {
        try {
            const anonymousId = req.user?.anonymousId;
            
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No file uploaded'
                });
            }

            const file = req.file;

            // Проверяем лимиты для анонимных пользователей
            if (anonymousId) {
                const session = await AnonymousSession.findOne({
                    where: { anonymous_id: anonymousId }
                });
                
                if (session && session.request_count >= 10) {
                    // Удаляем файл
                    if (fs.existsSync(file.path)) {
                        fs.unlinkSync(file.path);
                    }
                    
                    return res.status(429).json({
                        success: false,
                        error: 'Daily limit reached. Please register for more requests.'
                    });
                }
            }

            const prompt = "Transform the animal in the image into a classical aristocratic oil portrait from the 17th–18th century. Preserve maximum likeness to the original animal: exact facial features, eye shape, muzzle proportions, fur pattern, color distribution, and overall identity must remain unchanged. Strictly preserve the original pose, body position, silhouette, proportions, scale, and head orientation from the source image. Do not alter anatomy or posture. The animal is resting on an elegant classical cushion, fully consistent with the old master aesthetic. The cushion is made of rich velvet fabric in deep warm tones (burgundy, dark brown, muted gold), with subtle embroidery and soft folds, naturally supporting the animal without changing its pose. Classical old European masters painting style, very rich oil paint texture with highly visible, layered, and directional brushstrokes, traditional canvas surface. Soft dramatic chiaroscuro lighting, dark atmospheric background. Luxurious velvet cloak with fur trim and refined gold jewelry. Bold, tactile oil strokes across the cushion, garments, and background, pronounced impasto highlights, expressive yet controlled painterly technique. High detail in fur, fabric, cushion texture, and metal, museum-quality fine art, vintage color grading, regal ceremonial portrait atmosphere.";

            const generationResult = await deApiService.img2img(file.path, prompt, {
                model: process.env.DEAPI_MODEL,
                seed: Math.floor(Math.random() * 1000000),
                negative_prompt: "change of pose, altered anatomy, loss of likeness, floating subject, incorrect body support, human features, cartoon, anime, modern objects, photographic realism, smooth digital painting, flat lighting, neon colors, CGI, 3D, plastic texture, oversmoothing, identity drift, text, watermarks"
            });

            // Сохраняем оригинальное изображение
            const imageData = {
                anonymous_id: anonymousId,
                filename: file.filename,
                original_filename: file.originalname,
                file_path: file.path,
                file_size: file.size,
                mime_type: file.mimetype,
                type: 'original',
                analysis_data: {},
                prompt: prompt,
                metadata: {
                    style: "ven",
                    processedAt: new Date().toISOString()
                }
            };

            const originalImage = await Image.create(imageData);

            // Сохраняем запись о генерации
            const generationData = {
                anonymous_id: anonymousId,
                image_id: originalImage.id,
                prompt: prompt,
                parameters: { request_id: generationResult.request_id },
                status: 'processing'
            };

            const generateImage = await Generation.create(generationData);

            res.json({
                success: true,
                original: {
                    id: originalImage.id,
                    url: `/uploads/${originalImage.filename}`,
                    analysis: {}
                },
                generated: {
                    id: generateImage.id,
                    request_id: generationResult.request_id
                }
            });
        } catch (error) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            next(error);
        }
    }

    // Получение статуса генерации
    getGenerationStatus = async (req, res, next) => {
        try {
            const { requestId } = req.params;
            const anonymousId = req.user?.anonymousId;

            if (!requestId) {
                return res.status(400).json({
                    success: false,
                    error: 'requestId is required'
                });
            }

            // Проверяем, принадлежит ли запрос пользователю
            const generation = await Generation.findOne({
                where: {
                    'parameters.request_id': requestId
                },
                include: [{
                    model: Image,
                    as: 'source_image',
                    where: { anonymous_id: anonymousId },
                    required: true
                }]
            });

            if (!generation) {
                return res.status(404).json({
                    success: false,
                    error: 'Generation not found'
                });
            }

            const statusData = await deApiService.getRequestStatus(requestId, anonymousId);

            // Обновляем статус в базе
            if (statusData.status === 'completed' && statusData.image_url) {
                await generation.update({
                    status: 'completed',
                    generated_filename: statusData.image_url.split('/').pop()
                });
            } else if (statusData.status === 'failed') {
                await generation.update({
                    status: 'failed',
                    error_message: statusData.error || 'Generation failed'
                });
            }

            res.json({
                success: true,
                data: {
                    ...statusData,
                    generation_id: generation.id
                },
                metadata: {
                    timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new ImageController();