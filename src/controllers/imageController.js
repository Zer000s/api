const deApiService = require('../services/deApiService');
const fs = require('fs');
const { Image, Generation } = require('../models/models');

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

            const prompt = "Transform the animal in the image into a classical aristocratic oil portrait from the 17th–18th century. Preserve maximum likeness to the original animal: exact facial features, eye shape, muzzle proportions, fur pattern, color distribution, and overall identity must remain unchanged. Strictly preserve the original pose, body position, silhouette, proportions, scale, and head orientation from the source image. Do not alter anatomy or posture. The animal is resting on an elegant classical cushion, fully consistent with the old master aesthetic. The cushion is made of rich velvet fabric in deep warm tones (burgundy, dark brown, muted gold), with subtle embroidery and soft folds, naturally supporting the animal without changing its pose. Classical old European masters painting style, very rich oil paint texture with highly visible, layered, and directional brushstrokes, traditional canvas surface. Soft dramatic chiaroscuro lighting, dark atmospheric background. Luxurious velvet cloak with fur trim and refined gold jewelry. Bold, tactile oil strokes across the cushion, garments, and background, pronounced impasto highlights, expressive yet controlled painterly technique. High detail in fur, fabric, cushion texture, and metal, museum-quality fine art, vintage color grading, regal ceremonial portrait atmosphere.";

            const generationResult = await deApiService.img2img(file.path, anonymousId);

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
                generated_filename: generationResult.image.filename,
                status: 'completed'
            };

            const generateImage = await Generation.create(generationData);

            res.json({
                success: true,
                original: {
                    id: originalImage.id,
                    url: `/uploads/${originalImage.filename}`
                },
                generated: {
                    id: generateImage.id,
                    url: `/uploads/${generateImage.generated_filename}`,
                }
            });
        } catch (error) {
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            next(error);
        }
    }
}

module.exports = new ImageController();