const express = require('express');
const router = express.Router();
const imageController = require('../controllers/imageController');
const { userIdentifierMiddleware } = require('../middleware/userIdentifier.middleware');
const rateLimits = require('../middleware/rateLimit.middleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = process.env.UPLOAD_DIR || './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = uuidv4();
        // Используем userId из middleware
        const userId = req.user?.id || 'anonymous';
        const sanitizedUserId = userId.replace(/[^a-zA-Z0-9]/g, '-');
        cb(null, `${sanitizedUserId}-${uniqueSuffix}${path.extname(file.originalname)}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760') // 10MB
    },
    fileFilter: (req, file, cb) => {

        const allowedMimeTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/webp'
        ];

        const ext = path.extname(file.originalname).toLowerCase();

        const allowedExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

        if (allowedMimeTypes.includes(file.mimetype) && allowedExt.includes(ext)) {
            return cb(null, true);
        }

        return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Invalid file type'));
    }
});

// Применяем middleware идентификации пользователя ко всем роутам
router.use(userIdentifierMiddleware);

// Применяем rate limiting к конкретным маршрутам
router.post('/process', 
    rateLimits.upload,
    upload.single('image'), 
    imageController.process
);

module.exports = router;