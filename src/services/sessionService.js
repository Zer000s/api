const db = require('../models/models');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

class SessionService {
  async createSession(userId, tokenData, userAgent = null, ipAddress = null) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 дней

    const session = await db.Session.create({
      user_id: userId,
      token: tokenData.token,
      refresh_token: tokenData.refreshToken,
      user_agent: userAgent,
      ip_address: ipAddress,
      expires_at: expiresAt,
      last_used_at: new Date()
    });

    return session.toJSON();
  }

  async validateSession(token) {
    const session = await db.Session.findOne({
      where: {
        token,
        revoked_at: null,
        expires_at: { [db.Sequelize.Op.gt]: new Date() }
      },
      include: [{
        model: db.User,
        as: 'user',
        attributes: { exclude: ['created_at', 'updated_at'] }
      }]
    });

    if (!session) {
      return null;
    }

    // Обновляем время последнего использования
    await session.update({ last_used_at: new Date() });

    return session.toJSON();
  }

  async revokeSession(token) {
    const session = await db.Session.findOne({
      where: { token, revoked_at: null }
    });

    if (!session) {
      throw new Error('Session not found or already revoked');
    }

    await session.update({ revoked_at: new Date() });
    return { success: true };
  }

  async revokeAllUserSessions(userId, excludeToken = null) {
    const where = { 
      user_id: userId,
      revoked_at: null 
    };

    if (excludeToken) {
      where.token = { [db.Sequelize.Op.ne]: excludeToken };
    }

    await db.Session.update(
      { revoked_at: new Date() },
      { where }
    );

    return { success: true };
  }

  async getUserSessions(userId) {
    const sessions = await db.Session.findAll({
      where: { 
        user_id: userId,
        revoked_at: null,
        expires_at: { [db.Sequelize.Op.gt]: new Date() }
      },
      order: [['last_used_at', 'DESC']]
    });

    return sessions.map(session => session.toJSON());
  }

  async refreshToken(oldRefreshToken, newTokenData) {
    const transaction = await db.sequelize.transaction();

    try {
      const session = await db.Session.findOne({
        where: { 
          refresh_token: oldRefreshToken,
          revoked_at: null
        },
        transaction
      });

      if (!session) {
        throw new Error('Invalid refresh token');
      }

      // Отзываем старую сессию
      await session.update({ 
        revoked_at: new Date() 
      }, { transaction });

      // Создаем новую сессию
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const newSession = await db.Session.create({
        user_id: session.user_id,
        token: newTokenData.token,
        refresh_token: newTokenData.refreshToken || uuidv4(),
        user_agent: session.user_agent,
        ip_address: session.ip_address,
        expires_at: expiresAt,
        last_used_at: new Date()
      }, { transaction });

      await transaction.commit();
      return newSession.toJSON();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async cleanupExpiredSessions() {
    const result = await db.Session.destroy({
      where: {
        [db.Sequelize.Op.or]: [
          { expires_at: { [db.Sequelize.Op.lt]: new Date() } },
          { revoked_at: { [db.Sequelize.Op.ne]: null } }
        ]
      }
    });

    return { deleted: result };
  }
}

module.exports = new SessionService();