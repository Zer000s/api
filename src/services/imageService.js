const db = require('../models/models');
const fs = require('fs');
const path = require('path');

class ImageService {
  async createImageRecord(data) {
    try {
      const image = await db.Image.create({
        user_id: data.userId,
        filename: data.filename,
        original_filename: data.originalFilename,
        file_path: data.filePath,
        file_size: data.fileSize,
        mime_type: data.mimeType,
        type: data.type,
        analysis_data: data.analysisData,
        prompt: data.prompt,
        metadata: data.metadata || {},
        is_public: data.isPublic || false
      });

      return image.toJSON();
    } catch (error) {
      console.error('Error creating image record:', error);
      
      // Удаляем файл если запись в БД не удалась
      if (data.filePath && fs.existsSync(data.filePath)) {
        fs.unlinkSync(data.filePath);
      }
      
      throw error;
    }
  }

  async getImageById(id, userId = null) {
    const where = { id, is_deleted: false };
    
    if (userId) {
      where.user_id = userId;
    }

    const image = await db.Image.findOne({
      where,
      include: [{
        model: db.User,
        as: 'user',
        attributes: ['id', 'name', 'picture']
      }]
    });

    if (!image) return null;

    // Увеличиваем счетчик просмотров если изображение публичное
    if (image.is_public && (!userId || userId !== image.user_id)) {
      await image.increment('views_count');
    }

    return image.toJSON();
  }

  async getUserImages(userId, options = {}) {
    const { page = 1, limit = 20, type, publicOnly = false } = options;
    const offset = (page - 1) * limit;

    const where = { 
      user_id: userId,
      is_deleted: false 
    };

    if (type) {
      where.type = type;
    }

    if (publicOnly) {
      where.is_public = true;
    }

    const { count, rows } = await db.Image.findAndCountAll({
      where,
      include: [{
        model: db.User,
        as: 'user',
        attributes: ['id', 'name', 'picture']
      }],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    return {
      images: rows.map(img => img.toJSON()),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  async updateImage(id, userId, updateData) {
    const image = await db.Image.findOne({
      where: { id, user_id: userId, is_deleted: false }
    });

    if (!image) {
      throw new Error('Image not found or access denied');
    }

    // Разрешаем обновлять только определенные поля
    const allowedFields = ['is_public', 'metadata', 'prompt'];
    const updateFields = {};
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        updateFields[field] = updateData[field];
      }
    });

    await image.update(updateFields);
    return image.toJSON();
  }

  async deleteImage(id, userId) {
    const image = await db.Image.findOne({
      where: { id, user_id: userId, is_deleted: false }
    });

    if (!image) {
      throw new Error('Image not found or access denied');
    }

    // Софт-удаление
    await image.update({
      is_deleted: true,
      deleted_at: new Date()
    });

    // Также помечаем как удаленные связанные файлы
    // (можно реализовать физическое удаление по cron job)
    return { success: true, message: 'Image marked as deleted' };
  }

  async likeImage(imageId, userId) {
    const transaction = await db.sequelize.transaction();

    try {
      const image = await db.Image.findOne({
        where: { id: imageId, is_deleted: false },
        transaction
      });

      if (!image) {
        throw new Error('Image not found');
      }

      // Проверяем, не лайкал ли уже пользователь
      // (здесь можно добавить таблицу лайков)
      await image.increment('likes_count', { transaction });

      await transaction.commit();
      
      return await this.getImageById(imageId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getPublicImages(options = {}) {
    const { page = 1, limit = 20, sortBy = 'created_at', sortOrder = 'DESC' } = options;
    const offset = (page - 1) * limit;

    const { count, rows } = await db.Image.findAndCountAll({
      where: { 
        is_public: true,
        is_deleted: false
      },
      include: [{
        model: db.User,
        as: 'user',
        attributes: ['id', 'name', 'picture']
      }],
      order: [[sortBy, sortOrder]],
      limit,
      offset
    });

    return {
      images: rows.map(img => img.toJSON()),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
}

module.exports = new ImageService();