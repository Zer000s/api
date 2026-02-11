const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const userService = require('../services/userService');
const sessionService = require('../services/sessionService');

class AuthController {
  constructor() {
    this.client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  }

  generateToken = (user, expiresIn = null) => {
    return jwt.sign(
      {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        picture: user.picture
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: expiresIn || process.env.JWT_EXPIRE || '7d',
        issuer: 'image-generator-api',
        jwtid: uuidv4()
      }
    );
  }

  google = async (req, res, next) => {
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
      const token = this.generateToken(dbUser);
      const refreshToken = uuidv4();

      // Создаем сессию в БД
      const userAgent = req.get('User-Agent');
      const ipAddress = req.ip || req.connection.remoteAddress;
      
      await sessionService.createSession(dbUser.id, {
        token,
        refreshToken
      }, userAgent, ipAddress);

      // Редирект на фронт с токеном
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&refreshToken=${encodeURIComponent(refreshToken)}`);

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
      const token = this.generateToken(dbUser);
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
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  refresh = async (req, res, next) => {
    try {
      const { refreshToken: oldRefreshToken } = req.body;
      
      if (!oldRefreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
      }

      // Получаем пользователя из существующего токена или сессии
      const user = await userService.findById(req.user.id);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Создаем новый токен с полной информацией о пользователе
      const newToken = this.generateToken(user, '15m');
      const newRefreshToken = uuidv4();

      // Обновляем сессию в БД
      const newSession = await sessionService.refreshToken(oldRefreshToken, {
        token: newToken,
        refreshToken: newRefreshToken
      });

      res.json({
        success: true,
        data: {
          token: newToken,
          refreshToken: newSession.refresh_token,
          expiresIn: 15 * 60 * 1000, // 15 минут
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
            role: user.role
          }
        },
        metadata: {
          timestamp: new Date().toISOString()
        }
      });

    } catch (error) {
      console.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        error: 'Failed to refresh token',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
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

      // Верифицируем JWT и получаем полную информацию
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Получаем актуальные данные пользователя из БД
      const user = await userService.findById(decoded.id);
      if (!user) {
        return res.status(401).json({ 
          success: false,
          error: 'User not found' 
        });
      }

      // Проверяем, что пользовательские данные совпадают
      if (user.email !== decoded.email || user.role !== decoded.role) {
        console.warn(`Token payload mismatch for user ${user.id}`);
        // В этом случае можно обновить токен или просто предупредить
      }

      res.json({
        success: true,
        data: {
          valid: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            picture: user.picture,
            role: user.role,
            credits: user.credits
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

  // Метод для дебага
  debug = async (req, res, next) => {
    try {
      const token = req.query.token || req.header('Authorization')?.replace('Bearer ', '');
      
      if (!token) {
        return res.json({
          success: false,
          error: 'No token provided'
        });
      }

      let decoded;
      try {
        decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
      } catch (error) {
        return res.json({
          success: false,
          error: 'Invalid token',
          details: error.message
        });
      }

      const session = await sessionService.validateSession(token);

      res.json({
        success: true,
        data: {
          token: {
            decoded,
            raw: token.substring(0, 50) + '...'
          },
          session: session || null,
          env: {
            JWT_SECRET_SET: !!process.env.JWT_SECRET,
            JWT_EXPIRE: process.env.JWT_EXPIRE || 'default'
          }
        }
      });

    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();