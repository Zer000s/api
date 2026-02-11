const imageService = require('../services/imageService');
const nanoBananoService = require('../services/nanoBananoService');
const geminiService = require('../services/geminiService');
const fs = require('fs')

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

    process = async (req, res, next) => {
        try {
            const userId = 1;
            
            // 1. Multer уже положил файл в req.file (middleware в роутере)
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No image file provided'
                });
            }

            console.log(`🔄 Starting PROCESS pipeline for user ${userId}`);
            const startTime = Date.now();

            // 2. Читаем файл
            const imageBuffer = fs.readFileSync(req.file.path);

            // 4. ГЕНЕРАЦИЯ ФИРМЕННОГО ПРОМПТА (Венецианский стиль)
            console.log('🎨 Step 1/2: Generating Venetian-style prompt...');
            // Можно передать дополнительный промпт от пользователя из body

            const result = await nanoBananoService.processWithStyle(
                imageBuffer,
                geminiService,
                null,
                'venetian' // стиль по умолчанию
            );

            // 5. СОХРАНЕНИЕ результата
            console.log('💾 Step 2/2: Saving result...');
            
            // Генерируем имя файла
            const outputFilename = `processed-${Date.now()}-${userId}.png`;
            const outputPath = `./uploads/${outputFilename}`;
            
            // Сохраняем на диск
            fs.writeFileSync(outputPath, result.imageBuffer);

            // Сохраняем в БД
            const imageRecord = await Image.create({
                user_id: userId,
                filename: outputFilename,
                original_filename: req.file.originalname,
                file_path: outputPath,
                file_size: result.imageBuffer.length,
                mime_type: 'image/png',
                type: 'processed',
                analysis_data: result.analysis,
                prompt: result.originalPrompt,
                metadata: {
                    pipeline: 'venetian-style',
                    processingTimeMs: Date.now() - startTime,
                    originalFile: req.file.filename
                }
            });

            // 6. Опционально: удаляем оригинальный загруженный файл
            // fs.unlinkSync(req.file.path);

            // 7. ОТВЕТ
            res.json({
                success: true,
                data: {
                    image: {
                        id: imageRecord.id,
                        url: `/uploads/${outputFilename}`,
                        filename: outputFilename,
                        size: imageRecord.file_size,
                    },
                    analysis: {
                        labels: result.analysis.labels?.slice(0, 10),
                        description: result.analysis.description,
                        mood: result.analysis.mood,
                        objects: result.analysis.objects,
                    },
                    prompt: result.originalPrompt,
                    processingTime: `${Date.now() - startTime}ms`,
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId,
                    model: 'nano-banana-gemini-2.5-flash',
                    style: 'venetian-renaissance'
                }
            });

        } catch (error) {
            console.error('❌ Process pipeline error:', error);
            
            // Cleanup: удаляем загруженный файл при ошибке
            if (req.file && req.file.path && fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
            
            next(error);
        }
    }
}

module.exports = new ImageController();