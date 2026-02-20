const { v4: uuidv4 } = require('uuid');
const { AnonymousSession } = require('../models/models');

const TTL = 30 * 24 * 60 * 60 * 1000;

const userIdentifierMiddleware = async (req, res, next) => {
  try {
    let anonymousId = req.cookies.anonymousId;
    const now = new Date();
    const ipAddress = req.ip;
    const userAgent = req.get('User-Agent');

    if (!anonymousId) {
      anonymousId = uuidv4();

      await AnonymousSession.create({
        anonymous_id: anonymousId,
        ip_address: ipAddress,
        user_agent: userAgent,
        expires_at: new Date(Date.now() + TTL),
        last_activity: now,
        request_count: 1
      });

      res.cookie('anonymousId', anonymousId, {
        maxAge: TTL,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax'
      });
    } else {
      const [session] = await AnonymousSession.findOrCreate({
        where: { anonymous_id: anonymousId },
        defaults: {
          anonymous_id: anonymousId,
          ip_address: ipAddress,
          user_agent: userAgent,
          expires_at: new Date(Date.now() + TTL),
          last_activity: now,
          request_count: 1
        }
      });

      if (session) {
        await session.increment('request_count');
        await session.update({ last_activity: now });
      }
    }

    req.user = { id: null, anonymousId };
    req.clientInfo = { ip: ipAddress, userAgent, anonymousId };

    next();
  } catch (error) {
    next(error);
  }
};

module.exports = { userIdentifierMiddleware };