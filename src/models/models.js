const sequelize = require('../config/database')
const {DataTypes} = require('sequelize')

const Generation = sequelize.define('generation', {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    anonymous_id: {type: DataTypes.UUID,allowNull: false, references: {model: 'anonymous_sessions',key: 'anonymous_id'}},
    image_id: {type: DataTypes.UUID, allowNull: true, references: {model: 'images', key: 'id'}},
    prompt: {type: DataTypes.TEXT, allowNull: false},
    negative_prompt: {type: DataTypes.TEXT, allowNull: true},
    parameters: {type: DataTypes.JSONB, allowNull: false, defaultValue: {}},
    generated_filename: {type: DataTypes.STRING, allowNull: true},
    status: {type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed', 'cancelled'), defaultValue: 'pending'},
    credits_spent: {type: DataTypes.INTEGER, defaultValue: 1},
    processing_time: {type: DataTypes.INTEGER, allowNull: true},
    error_message: {type: DataTypes.TEXT,allowNull: true},
    api_provider: {type: DataTypes.STRING, allowNull: true},
    api_model: {type: DataTypes.STRING, allowNull: true}
});

const Image = sequelize.define('image', {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    anonymous_id: {type: DataTypes.UUID, allowNull: false, references: {model: 'anonymous_sessions', key: 'anonymous_id'}},
    filename: {type: DataTypes.STRING, allowNull: false},
    original_filename: {type: DataTypes.STRING, allowNull: true},
    file_path: {type: DataTypes.STRING, allowNull: false},
    file_size: {type: DataTypes.INTEGER, allowNull: false},
    mime_type: {type: DataTypes.STRING, allowNull: false},
    type: {type: DataTypes.ENUM('original', 'generated', 'processed'), allowNull: false},
    analysis_data: {type: DataTypes.JSONB, allowNull: true},
    prompt: {type: DataTypes.TEXT, allowNull: true},
    metadata: {type: DataTypes.JSONB, defaultValue: {}},
    is_public: {type: DataTypes.BOOLEAN, defaultValue: false},
    views_count: {type: DataTypes.INTEGER, defaultValue: 0},
    likes_count: {type: DataTypes.INTEGER, defaultValue: 0},
    is_deleted: {type: DataTypes.BOOLEAN, defaultValue: false}
});

// Добавим модель для анонимных сессий
const AnonymousSession = sequelize.define('anonymous_session', {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    anonymous_id: { type: DataTypes.UUID, allowNull: false, unique: true },
    ip_address: { type: DataTypes.STRING(45), allowNull: true },
    user_agent: { type: DataTypes.TEXT, allowNull: true },
    last_activity: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    request_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    expires_at: { type: DataTypes.DATE, allowNull: true }
});

// Связи для анонимных пользователей (опционально)
AnonymousSession.hasMany(Image, {
    foreignKey: 'anonymous_id',
    constraints: false,
    scope: {
        anonymous_id: sequelize.col('anonymous_session.anonymous_id')
    }
});

AnonymousSession.hasMany(Generation, {
    foreignKey: 'anonymous_id',
    constraints: false,
    scope: {
        anonymous_id: sequelize.col('anonymous_session.anonymous_id')
    }
});

Image.hasMany(Generation, {
    foreignKey: 'image_id',
    as: 'generations'
});

Generation.belongsTo(Image, {
    foreignKey: 'image_id',
    as: 'source_image'
});

module.exports = {
    Generation,
    Image,
    AnonymousSession
}