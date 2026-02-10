const db = require('../models/models');
const userService = require('./userService');

class GenerationService {
  async createGeneration(data) {
    const transaction = await db.sequelize.transaction();

    try {
      // Проверяем наличие кредитов
      const user = await db.User.findByPk(data.userId, { transaction });
      if (!user || user.credits < data.creditsSpent) {
        throw new Error('Insufficient credits');
      }

      // Списываем кредиты
      await user.decrement('credits', {
        by: data.creditsSpent,
        transaction
      });

      // Создаем запись генерации
      const generation = await db.Generation.create({
        user_id: data.userId,
        image_id: data.imageId,
        prompt: data.prompt,
        negative_prompt: data.negativePrompt,
        parameters: data.parameters,
        generated_filename: data.generatedFilename,
        status: data.status || 'pending',
        credits_spent: data.creditsSpent || 1,
        api_provider: data.apiProvider,
        api_model: data.apiModel
      }, { transaction });

      await transaction.commit();
      return generation.toJSON();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateGenerationStatus(id, status, options = {}) {
    const updateData = { status };
    
    if (options.processingTime !== undefined) {
      updateData.processing_time = options.processingTime;
    }
    
    if (options.errorMessage !== undefined) {
      updateData.error_message = options.errorMessage;
    }

    if (status === 'failed' && options.refundCredits !== false) {
      // Возвращаем кредиты если генерация провалилась
      const transaction = await db.sequelize.transaction();
      
      try {
        const generation = await db.Generation.findByPk(id, { transaction });
        if (generation) {
          await db.User.increment('credits', {
            by: generation.credits_spent,
            where: { id: generation.user_id },
            transaction
          });
        }

        await generation.update(updateData, { transaction });
        await transaction.commit();
        
        return generation.toJSON();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }

    const generation = await db.Generation.findByPk(id);
    if (!generation) {
      throw new Error('Generation not found');
    }

    await generation.update(updateData);
    return generation.toJSON();
  }

  async getUserGenerations(userId, options = {}) {
    const { page = 1, limit = 20, status } = options;
    const offset = (page - 1) * limit;

    const where = { user_id: userId };
    
    if (status) {
      where.status = status;
    }

    const { count, rows } = await db.Generation.findAndCountAll({
      where,
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'name', 'picture']
        },
        {
          model: db.Image,
          as: 'source_image',
          attributes: ['id', 'filename', 'file_path']
        }
      ],
      order: [['created_at', 'DESC']],
      limit,
      offset
    });

    return {
      generations: rows.map(gen => gen.toJSON()),
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }

  async getGenerationById(id, userId = null) {
    const where = { id };
    
    if (userId) {
      where.user_id = userId;
    }

    const generation = await db.Generation.findOne({
      where,
      include: [
        {
          model: db.User,
          as: 'user',
          attributes: ['id', 'name', 'picture']
        },
        {
          model: db.Image,
          as: 'source_image',
          attributes: ['id', 'filename', 'file_path']
        }
      ]
    });

    return generation ? generation.toJSON() : null;
  }

  async getUserStats(userId) {
    const stats = await db.Generation.findAll({
      where: { user_id: userId },
      attributes: [
        'status',
        [db.sequelize.fn('COUNT', db.sequelize.col('id')), 'count'],
        [db.sequelize.fn('SUM', db.sequelize.col('credits_spent')), 'total_credits_spent']
      ],
      group: ['status']
    });

    const total = await db.Generation.count({ where: { user_id: userId } });
    const completed = stats.find(s => s.status === 'completed') || { count: 0 };
    const failed = stats.find(s => s.status === 'failed') || { count: 0 };

    return {
      total_generations: total,
      completed: parseInt(completed.count) || 0,
      failed: parseInt(failed.count) || 0,
      success_rate: total > 0 ? ((parseInt(completed.count) || 0) / total * 100).toFixed(2) : 0,
      stats_by_status: stats
    };
  }

  async cleanupOldGenerations(days = 30) {
    const date = new Date();
    date.setDate(date.getDate() - days);

    const result = await db.Generation.destroy({
      where: {
        status: 'completed',
        created_at: {
          [db.Sequelize.Op.lt]: date
        }
      }
    });

    return { deleted: result };
  }
}

module.exports = new GenerationService();