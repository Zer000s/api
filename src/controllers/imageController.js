const multer = require('multer');
const path = require('path');
const fs = require('fs');
const imageAnalysis = require('../services/imageAnalysis');
const imageGeneration = require('../services/imageGeneration');

class ImageController {
    constructor() {
        // Настройка Multer для загрузки файлов
        this.storage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = process.env.UPLOAD_DIR || './uploads';
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                if (!req.user || !req.user.id) {
                    return cb(new Error('User not authenticated'), null);
                }
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const safeUserId = req.user.id.replace(/[^a-zA-Z0-9]/g, '-');
                cb(null, `${safeUserId}-${uniqueSuffix}${path.extname(file.originalname)}`);
            }
        });

        this.upload = multer({
            storage: this.storage,
            limits: {
                fileSize: parseInt(process.env.MAX_FILE_SIZE || '5242880') // 5MB по умолчанию
            },
            fileFilter: (req, file, cb) => {
                const allowedTypes = /jpeg|jpg|png|gif|webp/;
                const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
                const mimetype = allowedTypes.test(file.mimetype);
                
                if (mimetype && extname) {
                    return cb(null, true);
                } else {
                    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
                }
            }
        });

        // Middleware для загрузки файла
        this.uploadSingle = this.upload.single('image');
    }

    async analyze(req, res, next) {
        try {
            // Обработка загрузки файла
            this.uploadSingle(req, res, async (uploadError) => {
                if (uploadError) {
                    if (uploadError instanceof multer.MulterError) {
                        if (uploadError.code === 'LIMIT_FILE_SIZE') {
                            return res.status(400).json({
                                success: false,
                                error: 'File size exceeds the limit (5MB)'
                            });
                        }
                    }
                    return res.status(400).json({
                        success: false,
                        error: uploadError.message
                    });
                }

                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        error: 'No image file provided'
                    });
                }

                // Проверка размера файла
                const stats = fs.statSync(req.file.path);
                const fileSizeInMB = stats.size / (1024 * 1024);
                if (fileSizeInMB > 5) { // Проверка на 5MB
                    // Удаляем временный файл
                    fs.unlinkSync(req.file.path);
                    return res.status(400).json({
                        success: false,
                        error: 'File size exceeds the limit (5MB)'
                    });
                }

                try {
                    // Чтение файла
                    const imageBuffer = fs.readFileSync(req.file.path);
                    
                    // Анализ изображения
                    const analysis = await imageAnalysis.analyzeImage(imageBuffer);
                    
                    // Генерация промпта
                    const prompt = imageAnalysis.generatePrompt(analysis);
                    
                    // Подготовка ответа анализа
                    const analysisResponse = {
                        labels: analysis.labels || [],
                        text: analysis.text || null,
                        faces: analysis.faces || [],
                        colors: analysis.colors || [],
                        safeSearch: analysis.safeSearch || {}
                    };

                    // Фильтруем только высокоуверенные labels
                    const confidentLabels = analysisResponse.labels
                        .filter(label => label.score > 0.7)
                        .map(label => label.description);

                    res.json({
                        success: true,
                        data: {
                            analysis: analysisResponse,
                            prompt: prompt,
                            originalImage: `/uploads/${req.file.filename}`,
                            filename: req.file.filename,
                            fileSize: stats.size,
                            mimeType: req.file.mimetype,
                            confidentObjects: confidentLabels
                        },
                        metadata: {
                            timestamp: new Date().toISOString(),
                            userId: req.user.id,
                            analysisTime: new Date().toISOString()
                        }
                    });

                } catch (analysisError) {
                    // Удаляем временный файл в случае ошибки
                    if (req.file && fs.existsSync(req.file.path)) {
                        fs.unlinkSync(req.file.path);
                    }
                    
                    console.error('Image analysis error:', analysisError);
                    
                    if (analysisError.message.includes('Google Cloud Vision')) {
                        return res.status(502).json({
                            success: false,
                            error: 'Image analysis service unavailable',
                            details: process.env.NODE_ENV === 'development' ? analysisError.message : undefined
                        });
                    }
                    
                    throw analysisError;
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async generate(req, res, next) {
        try {
            const { prompt, options } = req.body;
            
            // Валидация промпта
            if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Valid prompt is required'
                });
            }

            // Ограничение длины промпта
            if (prompt.length > 1000) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt is too long (max 1000 characters)'
                });
            }

            // Валидация опций
            const validatedOptions = {
                negativePrompt: options?.negativePrompt || "blurry, low quality, distorted, ugly, bad anatomy",
                steps: Math.min(Math.max(options?.steps || 30, 10), 100), // Ограничение 10-100 шагов
                width: Math.min(Math.max(options?.width || 512, 256), 1024), // Ограничение 256-1024
                height: Math.min(Math.max(options?.height || 512, 256), 1024), // Ограничение 256-1024
                cfgScale: Math.min(Math.max(options?.cfgScale || 7.5, 1.0), 20.0), // Ограничение 1-20
                sampler: options?.sampler || "Euler a",
                seed: options?.seed || -1
            };

            // Проверка на недопустимый контент в промпте
            const bannedWords = ['nude', 'naked', 'explicit', 'porn', 'xxx', 'nsfw'];
            const lowerPrompt = prompt.toLowerCase();
            if (bannedWords.some(word => lowerPrompt.includes(word))) {
                return res.status(400).json({
                    success: false,
                    error: 'Prompt contains restricted content'
                });
            }

            console.log(`Generating image for user ${req.user.id} with prompt: ${prompt.substring(0, 100)}...`);

            // Генерация изображения
            const result = await imageGeneration.generateImage(prompt, validatedOptions);
            
            if (!result || !result.image) {
                throw new Error('Image generation returned empty result');
            }

            // Сохранение сгенерированного изображения
            const filename = `generated-${Date.now()}-${req.user.id}.${result.format || 'png'}`;
            const filepath = path.join(process.env.UPLOAD_DIR || './uploads', filename);
            
            fs.writeFileSync(filepath, result.image);

            // Сохраняем метаданные генерации
            const metadataPath = filepath + '.json';
            const metadata = {
                userId: req.user.id,
                prompt: prompt,
                options: validatedOptions,
                generatedAt: new Date().toISOString(),
                originalParameters: result.parameters || {}
            };
            fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

            res.json({
                success: true,
                data: {
                    imageUrl: `/uploads/${filename}`,
                    prompt: prompt,
                    parameters: validatedOptions,
                    filename: filename,
                    fileSize: result.image.length
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId: req.user.id,
                    generationTime: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('Image generation error:', error);
            
            if (error.message.includes('API key') || error.message.includes('authentication')) {
                return res.status(503).json({
                    success: false,
                    error: 'Image generation service unavailable',
                    details: process.env.NODE_ENV === 'development' ? error.message : undefined
                });
            }
            
            if (error.message.includes('rate limit') || error.message.includes('quota')) {
                return res.status(429).json({
                    success: false,
                    error: 'Generation quota exceeded. Please try again later.'
                });
            }
            
            next(error);
        }
    }

    async process(req, res, next) {
        try {
            // Обработка загрузки файла
            this.uploadSingle(req, res, async (uploadError) => {
                if (uploadError) {
                    return res.status(400).json({
                        success: false,
                        error: uploadError.message
                    });
                }

                if (!req.file) {
                    return res.status(400).json({
                        success: false,
                        error: 'No image file provided'
                    });
                }

                try {
                    // Чтение и анализ
                    const imageBuffer = fs.readFileSync(req.file.path);
                    const analysis = await imageAnalysis.analyzeImage(imageBuffer);
                    const prompt = imageAnalysis.generatePrompt(analysis);

                    // Валидация промпта
                    if (!prompt || prompt.length > 1000) {
                        throw new Error('Generated prompt is invalid or too long');
                    }

                    console.log(`Processing image for user ${req.user.id}, generated prompt: ${prompt.substring(0, 100)}...`);

                    // Генерация нового изображения
                    const generationResult = await imageGeneration.generateImage(prompt);
                    
                    if (!generationResult || !generationResult.image) {
                        throw new Error('Image generation failed');
                    }

                    // Сохранение сгенерированного изображения
                    const filename = `processed-${Date.now()}-${req.user.id}.${generationResult.format || 'png'}`;
                    const filepath = path.join(process.env.UPLOAD_DIR || './uploads', filename);
                    
                    fs.writeFileSync(filepath, generationResult.image);

                    // Сохраняем метаданные
                    const metadataPath = filepath + '.json';
                    const metadata = {
                        userId: req.user.id,
                        originalImage: req.file.filename,
                        analysis: analysis,
                        prompt: prompt,
                        generatedAt: new Date().toISOString(),
                        parameters: generationResult.parameters || {}
                    };
                    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

                    // Подготовка анализа для ответа
                    const analysisResponse = {
                        labels: analysis.labels || [],
                        text: analysis.text || null,
                        faces: analysis.faces || []
                    };

                    res.json({
                        success: true,
                        data: {
                            originalAnalysis: analysisResponse,
                            generatedPrompt: prompt,
                            generatedImage: `/uploads/${filename}`,
                            originalImage: `/uploads/${req.file.filename}`,
                            generatedFilename: filename,
                            originalFilename: req.file.filename
                        },
                        metadata: {
                            timestamp: new Date().toISOString(),
                            userId: req.user.id,
                            processingTime: new Date().toISOString()
                        }
                    });

                } catch (processingError) {
                    // Удаляем временные файлы в случае ошибки
                    if (req.file && fs.existsSync(req.file.path)) {
                        fs.unlinkSync(req.file.path);
                    }
                    
                    console.error('Image processing error:', processingError);
                    
                    if (processingError.message.includes('Google Cloud Vision')) {
                        return res.status(502).json({
                            success: false,
                            error: 'Image analysis service unavailable'
                        });
                    }
                    
                    if (processingError.message.includes('API key')) {
                        return res.status(503).json({
                            success: false,
                            error: 'Image generation service unavailable'
                        });
                    }
                    
                    throw processingError;
                }
            });

        } catch (error) {
            next(error);
        }
    }

    async history(req, res, next) {
        try {
            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            
            // Проверяем существование директории
            if (!fs.existsSync(uploadDir)) {
                return res.json({
                    success: true,
                    data: {
                        images: [],
                        total: 0
                    },
                    metadata: {
                        timestamp: new Date().toISOString(),
                        userId: req.user.id
                    }
                });
            }

            // Получаем файлы
            let files;
            try {
                files = fs.readdirSync(uploadDir);
            } catch (dirError) {
                console.error('Error reading upload directory:', dirError);
                return res.status(500).json({
                    success: false,
                    error: 'Unable to access image storage'
                });
            }

            // Фильтруем файлы пользователя
            const userFiles = [];
            const safeUserId = req.user.id.replace(/[^a-zA-Z0-9]/g, '-');
            
            for (const file of files) {
                // Пропускаем файлы метаданных и системные файлы
                if (file.endsWith('.json') || file.startsWith('.') || file === 'README.md') {
                    continue;
                }

                // Проверяем принадлежность файла пользователю
                if (file.includes(req.user.id) || file.includes(safeUserId)) {
                    try {
                        const filePath = path.join(uploadDir, file);
                        const stats = fs.statSync(filePath);
                        
                        // Определяем тип файла по имени
                        let type = 'unknown';
                        if (file.includes('generated-')) type = 'generated';
                        else if (file.includes('processed-')) type = 'processed';
                        else if (file.includes(req.user.id) && !file.includes('generated') && !file.includes('processed')) {
                            type = 'original';
                        }

                        // Пытаемся загрузить метаданные
                        let metadata = null;
                        const metadataPath = filePath + '.json';
                        if (fs.existsSync(metadataPath)) {
                            try {
                                metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
                            } catch (metaError) {
                                console.warn(`Error reading metadata for ${file}:`, metaError);
                            }
                        }

                        userFiles.push({
                            filename: file,
                            url: `/uploads/${file}`,
                            type: type,
                            size: stats.size,
                            createdAt: stats.birthtime,
                            modifiedAt: stats.mtime,
                            metadata: metadata
                        });
                    } catch (fileError) {
                        console.warn(`Error processing file ${file}:`, fileError);
                    }
                }
            }

            // Сортировка по дате создания (новые сначала)
            userFiles.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Пагинация
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const startIndex = (page - 1) * limit;
            const endIndex = page * limit;
            const paginatedFiles = userFiles.slice(startIndex, endIndex);

            res.json({
                success: true,
                data: {
                    images: paginatedFiles,
                    pagination: {
                        total: userFiles.length,
                        page: page,
                        limit: limit,
                        totalPages: Math.ceil(userFiles.length / limit),
                        hasNext: endIndex < userFiles.length,
                        hasPrevious: startIndex > 0
                    }
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId: req.user.id,
                    queryTime: new Date().toISOString()
                }
            });

        } catch (error) {
            console.error('History retrieval error:', error);
            next(error);
        }
    }

    // Дополнительный метод для удаления изображения
    async delete(req, res, next) {
        try {
            const { filename } = req.params;
            
            if (!filename) {
                return res.status(400).json({
                    success: false,
                    error: 'Filename is required'
                });
            }

            // Проверка безопасности имени файла
            if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid filename'
                });
            }

            const uploadDir = process.env.UPLOAD_DIR || './uploads';
            const filePath = path.join(uploadDir, filename);
            
            // Проверяем существование файла
            if (!fs.existsSync(filePath)) {
                return res.status(404).json({
                    success: false,
                    error: 'File not found'
                });
            }

            // Проверяем принадлежность файла пользователю
            if (!filename.includes(req.user.id)) {
                // Также проверяем безопасный вариант ID
                const safeUserId = req.user.id.replace(/[^a-zA-Z0-9]/g, '-');
                if (!filename.includes(safeUserId)) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to delete this file'
                    });
                }
            }

            // Удаляем файл
            fs.unlinkSync(filePath);
            
            // Пытаемся удалить метаданные если они есть
            const metadataPath = filePath + '.json';
            if (fs.existsSync(metadataPath)) {
                fs.unlinkSync(metadataPath);
            }

            res.json({
                success: true,
                data: {
                    deleted: filename
                },
                metadata: {
                    timestamp: new Date().toISOString(),
                    userId: req.user.id
                }
            });

        } catch (error) {
            console.error('Delete image error:', error);
            next(error);
        }
    }
}

module.exports = new ImageController();