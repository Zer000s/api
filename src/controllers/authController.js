const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');
const sessionService = require('../services/sessionService');

class AuthController {
  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL);
  }

  google = async (req, res, next) =>{
    try {
      const redirectUrl = this.client.generateAuthUrl({
        access_type: 'offline',
        scope: ['profile', 'email', 'openid'],
        prompt: 'consent',
        redirect_uri: process.env.GOOGLE_CALLBACK_URL
      });
      
      console.log('Redirecting to Google OAuth:', redirectUrl);
      res.redirect(redirectUrl);
    } catch (error) {
      next(error);
    }
  }

  googleCallback = async (req, res, next) => {
    try {
      const { code, error } = req.query;

      if (error) {
        console.error('Google OAuth error:', error);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/auth/error?error=${encodeURIComponent(error)}`);
      }

      if (!code) {
        throw new Error('No authorization code provided');
      }

      console.log('Received OAuth code');

      // Получаем токены от Google
      const { tokens } = await this.client.getToken({
        code,
        redirect_uri: process.env.GOOGLE_CALLBACK_URL
      });

      if (!tokens.id_token) {
        throw new Error('No ID token received from Google');
      }

      // Верифицируем ID токен
      const ticket = await this.client.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();

      if (!payload.email_verified) {
        throw new Error('Email not verified by Google');
      }

      console.log('User authenticated:', payload.email);

      // Создаем/получаем пользователя в БД
      const { user: dbUser } = await userService.findOrCreateByGoogle(payload);

      // Создаем JWT токен
      const token = jwt.sign(
        {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role
        },
        process.env.JWT_SECRET,
        { 
          expiresIn: process.env.JWT_EXPIRE || '7d',
          issuer: 'image-generator-api',
          jwtid: uuidv4()
        }
      );

      // Создаем сессию в БД
      const userAgent = req.get('User-Agent');
      const ipAddress = req.ip || req.connection.remoteAddress;
      
      await sessionService.createSession(dbUser.id, {
        token,
        refreshToken: uuidv4()
      }, userAgent, ipAddress);

      // Редирект на фронт с токеном
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}`);

    } catch (error) {
      console.error('Auth callback error:', error.message);
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/error?error=${encodeURIComponent(error.message)}`);
    }
  }

  googleToken = async (req, res, next) => {
    try {
      const { token: googleToken } = req.body;

      if (!googleToken) {
        return res.status(400).json({ 
          success: false, 
          error: 'Google token is required' 
        });
      }

      // Верифицируем токен Google
      const ticket = await this.client.verifyIdToken({
        idToken: googleToken,
        audience: process.env.GOOGLE_CLIENT_ID
      });

      const payload = ticket.getPayload();

      if (!payload.email_verified) {
        return res.status(403).json({
          success: false,
          error: 'Email not verified by Google'
        });
      }

      // Создаем/получаем пользователя в БД
      const { user: dbUser } = await userService.findOrCreateByGoogle(payload);

      // Создаем JWT токен
      const token = jwt.sign(
        {
          id: dbUser.id,
          email: dbUser.email,
          name: dbUser.name,
          role: dbUser.role
        },
        process.env.JWT_SECRET,
        { 
          expiresIn: process.env.JWT_EXPIRE || '7d',
          issuer: 'image-generator-api',
          jwtid: uuidv4()
        }
      );

      const refreshToken = uuidv4();

      // Создаем сессию в БД
      const userAgent = req.get('User-Agent');
      const ipAddress = req.ip || req.connection.remoteAddress;
      
      await sessionService.createSession(dbUser.id, {
        token,
        refreshToken
      }, userAgent, ipAddress);

      res.json({
        success: true,
        data: {
          token,
          refreshToken,
          user: {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            picture: dbUser.picture,
            role: dbUser.role,
            credits: dbUser.credits
          }
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Google token verification error:', error.message);
      
      let statusCode = 401;
      let errorMessage = 'Authentication failed';
      
      if (error.message.includes('Token used too late') || 
          error.message.includes('expired')) {
        errorMessage = 'Token expired';
      } else if (error.message.includes('audience')) {
        errorMessage = 'Invalid token audience';
      }
      
      res.status(statusCode).json({
        success: false,
        error: errorMessage
      });
    }
  }

  refresh = async (req, res, next) => {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
      }

      // Обновляем токен через сервис сессий
      const newToken = jwt.sign(
        { id: req.user.id },
        process.env.JWT_SECRET,
        { 
          expiresIn: '15m',
          issuer: 'image-generator-api',
          jwtid: uuidv4()
        }
      );

      const newSession = await sessionService.refreshToken(refreshToken, {
        token: newToken,
        refreshToken: uuidv4()
      });

      res.json({
        success: true,
        data: {
          token: newToken,
          refreshToken: newSession.refresh_token,
          expiresIn: 15 * 60 * 1000 // 15 минут
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        error: 'Failed to refresh token'
      });
    }
  }

  verify = async (req, res, next) => {
    try {
      const authHeader = req.header('Authorization');
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
          success: false,
          error: 'No token provided or invalid format' 
        });
      }
      
      const token = authHeader.replace('Bearer ', '');
      
      // Проверяем сессию в БД
      const session = await sessionService.validateSession(token);
      if (!session) {
        return res.status(401).json({ 
          success: false,
          error: 'Invalid or expired session' 
        });
      }

      // Верифицируем JWT
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      res.json({
        success: true,
        data: {
          valid: true,
          user: {
            id: decoded.id,
            email: decoded.email,
            name: decoded.name,
            role: decoded.role
          },
          session: {
            id: session.id,
            lastUsedAt: session.last_used_at,
            expiresAt: session.expires_at
          }
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Token verification error:', error.message);
      
      let errorMessage = 'Invalid token';
      if (error.name === 'TokenExpiredError') {
        errorMessage = 'Token expired';
      } else if (error.name === 'JsonWebTokenError') {
        errorMessage = 'Malformed token';
      }
      
      res.status(401).json({ 
        success: false,
        error: errorMessage 
      });
    }
  }

  logout = async (req, res, next) => {
    try {
      const authHeader = req.header('Authorization');
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        await sessionService.revokeSession(token);
      }

      res.json({ 
        success: true, 
        data: {
          message: 'Logged out successfully'
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  logoutAll = async (req, res, next) => {
    try {
      const authHeader = req.header('Authorization');
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        await sessionService.revokeAllUserSessions(req.user.id, token);
      }

      res.json({ 
        success: true, 
        data: {
          message: 'Logged out from all devices'
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  profile = async (req, res, next) => {
    try {
      const user = await userService.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const stats = await userService.getUserStats(req.user.id);

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
            role: user.role,
            credits: user.credits,
            settings: user.settings
          },
          stats
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();