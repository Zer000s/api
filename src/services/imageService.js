const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { Image, Generation } = require('../models/models');

class ImageService {
    constructor() {
        // Настройка Multer
        this.storage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = process.env.UPLOAD_DIR || './uploads';
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = uuidv4();
                const userId = req.user?.id || 'anonymous';
                const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '-');
                cb(null, `${sanitizedUserId}-${uniqueSuffix}${path.extname(file.originalname)}`);
            }
        });

        this.upload = multer({
            storage: this.storage,
            limits: {
                fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB default
            },
            fileFilter: (req, file, cb) => {
                const allowedTypes = /jpeg|jpg|png|gif|webp/;
                const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
                const mimetype = allowedTypes.test(file.mimetype);
                
                if (mimetype && extname) {
                    cb(null, true);
                } else {
                    cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
                }
            }
        });

        this.uploadMiddleware = this.upload.single('image');
    }

    // Получение всех изображений пользователя
    getUserImages = async (userId, options = {}) => {
        try {
            const { page = 1, limit = 20, type } = options;
            const offset = (page - 1) * limit;

            const where = { 
                user_id: userId,
                is_deleted: false 
            };

            if (type) {
                where.type = type;
            }

            const { count, rows } = await Image.findAndCountAll({
                where,
                order: [['createdAt', 'DESC']],
                limit,
                offset
            });

            return {
                images: rows.map(img => ({
                    id: img.id,
                    filename: img.filename,
                    url: `/uploads/${img.filename}`,
                    type: img.type,
                    size: img.file_size,
                    mimeType: img.mime_type,
                    analysis: img.analysis_data,
                    prompt: img.prompt,
                    createdAt: img.createdAt,
                    isPublic: img.is_public
                })),
                pagination: {
                    total: count,
                    page,
                    limit,
                    totalPages: Math.ceil(count / limit),
                    hasMore: offset + rows.length < count
                }
            };
        } catch (error) {
            console.error('Error getting user images:', error);
            throw error;
        }
    }

    // Анализ изображения через Gemini
    analyzeImage = async (file, userId) => {
        try {
            // Чтение файла
            const imageBuffer = fs.readFileSync(file.path);
            
            // Анализ через Gemini
            const result = await geminiService.analyzeAndGeneratePrompt(
                imageBuffer,
                file.mimetype
            );

            // Сохраняем информацию в БД
            const imageRecord = await Image.create({
                user_id: userId,
                filename: file.filename,
                original_filename: file.originalname,
                file_path: file.path,
                file_size: file.size,
                mime_type: file.mimetype,
                type: 'original',
                analysis_data: result.analysis,
                prompt: result.prompt,
                metadata: {
                    uploadedAt: new Date().toISOString()
                }
            });

            return {
                success: true,
                image: {
                    id: imageRecord.id,
                    filename: imageRecord.filename,
                    url: `/uploads/${imageRecord.filename}`,
                    type: imageRecord.type,
                    size: imageRecord.file_size,
                    mimeType: imageRecord.mime_type
                },
                analysis: result.analysis,
                prompt: result.prompt
            };
        } catch (error) {
            // Удаляем файл при ошибке
            if (file && file.path && fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
            throw error;
        }
    }

    // Удаление изображения (soft delete)
    async deleteImage(filename, userId, anonymousId) {
        const where = { filename };
        
        if (userId) {
            where.user_id = userId;
        } else if (anonymousId) {
            where.anonymous_id = anonymousId;
        } else {
            throw new Error('Access denied');
        }

        const image = await Image.findOne({ where });

        if (!image) {
            throw new Error('Image not found');
        }

        // Удаляем файл
        if (fs.existsSync(image.file_path)) {
            fs.unlinkSync(image.file_path);
        }

        // Помечаем как удаленное в базе
        await image.update({ is_deleted: true });

        return { message: 'Image deleted successfully' };
    }

    // Получение информации об изображении
    getImageInfo = async (filename, userId) => {
        try {
            const image = await Image.findOne({
                where: {
                    filename,
                    user_id: userId,
                    is_deleted: false
                }
            });

            if (!image) {
                throw new Error('Image not found');
            }

            return {
                id: image.id,
                filename: image.filename,
                url: `/uploads/${image.filename}`,
                type: image.type,
                size: image.file_size,
                mimeType: image.mime_type,
                analysis: image.analysis_data,
                prompt: image.prompt,
                createdAt: image.created_at,
                isPublic: image.is_public
            };
        } catch (error) {
            console.error('Error getting image info:', error);
            throw error;
        }
    }

    // Вспомогательный метод для обработки загрузки
    handleUpload = (req, res) => {
        return new Promise((resolve, reject) => {
            this.uploadMiddleware(req, res, (err) => {
                if (err) {
                    if (err instanceof multer.MulterError) {
                        if (err.code === 'LIMIT_FILE_SIZE') {
                            reject(new Error('File size exceeds limit'));
                        } else {
                            reject(new Error(`Upload error: ${err.message}`));
                        }
                    } else {
                        reject(err);
                    }
                } else if (!req.file) {
                    reject(new Error('No file uploaded'));
                } else {
                    resolve(req.file);
                }
            });
        });
    }

    getUserStats = async (userId) => {
        try {
            const total = await Generation.count({
                where: {
                    user_id: userId
                }
            });

            const completed = await Generation.count({
                where: {
                    user_id: userId,
                    status: 'completed'
                }
            });

            const success_rate = total > 0 ? (completed / total) * 100 : 0;

            return {
                total_images: total,
                success_rate: success_rate.toFixed(2) // округляем до 2 знаков
            };
        } catch (error) {
            console.error('Error getting user stats:', error);
            throw error;
        }
    };
}

module.exports = new ImageService();