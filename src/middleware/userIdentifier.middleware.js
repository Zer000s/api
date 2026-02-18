// middleware/userIdentifier.middleware.js
const { v4: uuidv4 } = require('uuid');
const { AnonymousSession } = require('../models/models');
const { Sequelize } = require('sequelize'); // ВАЖНО: импортируем Sequelize
const sequelize = require('../config/database'); // Импортируем экземпляр sequelize

const userIdentifierMiddleware = async (req, res, next) => {
    try {
        // Пытаемся получить идентификатор из cookie или заголовка
        let anonymousId = req.cookies?.anonymousId || req.headers['x-anonymous-id'];
        
        // Получаем IP и User-Agent
        const ipAddress = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent');
        
        // Если нет anonymousId, создаем новый
        if (!anonymousId) {
            anonymousId = uuidv4();
            
            // Создаем запись в базе для анонимной сессии
            await AnonymousSession.create({
                anonymous_id: anonymousId,
                ip_address: ipAddress,
                user_agent: userAgent,
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 дней
            });
            
            // Устанавливаем cookie
            res.cookie('anonymousId', anonymousId, {
                maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            });
        } else {
            // Обновляем существующую сессию
            await AnonymousSession.update({
                last_activity: new Date(),
                ip_address: ipAddress,
                user_agent: userAgent,
                request_count: sequelize.literal('request_count + 1')
            }, {
                where: { anonymous_id: anonymousId }
            });
        }
        
        // Добавляем информацию в request
        req.user = {
            id: null, // Для авторизованных пользователей
            anonymousId: anonymousId
        };
        
        req.clientInfo = {
            ip: ipAddress,
            userAgent,
            anonymousId
        };
        
        next();
    } catch (error) {
        console.error('Error in userIdentifierMiddleware:', error);
        next(error);
    }
};

module.exports = { userIdentifierMiddleware };