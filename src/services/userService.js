const db = require('../models/models');
const { Op } = require('sequelize');

class UserService {
  async findOrCreateByGoogle(googleUser) {
    try {
      const [user, created] = await db.User.findOrCreate({
        where: { google_id: googleUser.sub },
        defaults: {
          email: googleUser.email,
          name: googleUser.name,
          picture: googleUser.picture,
          email_verified: googleUser.email_verified || false,
          last_login_at: new Date()
        }
      });

      if (!created) {
        // Обновляем последний логин
        await user.update({
          last_login_at: new Date(),
          picture: googleUser.picture || user.picture,
          name: googleUser.name || user.name
        });
      }

      return {
        user: user.toJSON(),
        created
      };
    } catch (error) {
      console.error('Error in findOrCreateByGoogle:', error);
      throw error;
    }
  }

  async findById(id) {
    return await db.User.findByPk(id, {
      attributes: { exclude: ['created_at', 'updated_at'] }
    });
  }

  async findByEmail(email) {
    return await db.User.findOne({
      where: { email },
      attributes: { exclude: ['created_at', 'updated_at'] }
    });
  }

  async updateUser(id, updateData) {
    const user = await db.User.findByPk(id);
    if (!user) {
      throw new Error('User not found');
    }

    // Разрешаем обновлять только определенные поля
    const allowedFields = ['name', 'picture', 'settings', 'is_active'];
    const updateFields = {};
    
    allowedFields.forEach(field => {
      if (updateData[field] !== undefined) {
        updateFields[field] = updateData[field];
      }
    });

    await user.update(updateFields);
    return user;
  }

  async updateCredits(userId, amount) {
    const user = await db.User.findByPk(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const newCredits = user.credits + amount;
    if (newCredits < 0) {
      throw new Error('Insufficient credits');
    }

    await user.update({ credits: newCredits });
    return user.credits;
  }

  async getUserStats(userId) {
    const [imagesCount, generationsCount] = await Promise.all([
      db.Image.count({ where: { user_id: userId, is_deleted: false } }),
      db.Generation.count({ where: { user_id: userId } })
    ]);

    const user = await db.User.findByPk(userId, {
      attributes: ['credits', 'created_at', 'last_login_at']
    });

    return {
      images_count: imagesCount,
      generations_count: generationsCount,
      credits: user.credits,
      created_at: user.created_at,
      last_login_at: user.last_login_at
    };
  }

  async searchUsers(query, options = {}) {
    const { page = 1, limit = 20, role } = options;
    const offset = (page - 1) * limit;

    const where = {};
    
    if (query) {
      where[Op.or] = [
        { name: { [Op.iLike]: `%${query}%` } },
        { email: { [Op.iLike]: `%${query}%` } }
      ];
    }

    if (role) {
      where.role = role;
    }

    const { count, rows } = await db.User.findAndCountAll({
      where,
      attributes: { exclude: ['created_at', 'updated_at'] },
      limit,
      offset,
      order: [['created_at', 'DESC']]
    });

    return {
      users: rows,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit)
      }
    };
  }
}

module.exports = new UserService();