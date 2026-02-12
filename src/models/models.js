const sequelize = require('../config/database')
const {DataTypes} = require('sequelize')

const Generation = sequelize.define('generation', {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    user_id: {type: DataTypes.UUID,allowNull: false, references: {model: 'users',key: 'id'}},
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
    user_id: {type: DataTypes.UUID, allowNull: false, references: {model: 'users', key: 'id'}},
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
    is_deleted: {type: DataTypes.BOOLEAN, defaultValue: false},
    deleted_at: {type: DataTypes.DATE, allowNull: true}
});

const User = sequelize.define('user', {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    google_id: {type: DataTypes.STRING, unique: true, allowNull: false},
    email: {type: DataTypes.STRING, unique: true, allowNull: false, validate: {isEmail: true}},
    name: {type: DataTypes.STRING, allowNull: false},
    picture: {type: DataTypes.STRING, allowNull: true},
    email_verified: {type: DataTypes.BOOLEAN, defaultValue: false},
    role: {type: DataTypes.ENUM('user', 'admin', 'moderator'), defaultValue: 'user'},
    credits: {type: DataTypes.INTEGER, defaultValue: 100, validate: {min: 0}},
    settings: {type: DataTypes.JSONB, defaultValue: {notifications: true, theme: 'light', language: 'en'}},
    last_login_at: {type: DataTypes.DATE, allowNull: true},
    is_active: {type: DataTypes.BOOLEAN, defaultValue: true},
    banned_until: {type: DataTypes.DATE, allowNull: true}
});

const Session = sequelize.define('session', {
    id: {type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true},
    user_id: {type: DataTypes.UUID, allowNull: false, references: {model: 'users', key: 'id'}},
    token: {type: DataTypes.TEXT, allowNull: false, unique: true},
    refresh_token: {type: DataTypes.TEXT, allowNull: true, unique: true},
    user_agent: {type: DataTypes.TEXT, allowNull: true},
    ip_address: {type: DataTypes.STRING(45), allowNull: true},
    expires_at: {type: DataTypes.DATE, allowNull: false},
    revoked_at: {type: DataTypes.DATE, allowNull: true},
    last_used_at: {type: DataTypes.DATE, allowNull: true}
});

User.hasMany(Image, {
    foreignKey: 'user_id',
    as: 'images',
    onDelete: 'CASCADE'
});

User.hasMany(Generation, {
    foreignKey: 'user_id',
    as: 'generations',
    onDelete: 'CASCADE'
});

User.hasMany(Session, {
    foreignKey: 'user_id',
    as: 'sessions',
    onDelete: 'CASCADE'
});

Image.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

Image.hasMany(Generation, {
    foreignKey: 'image_id',
    as: 'generations'
});

Generation.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

Generation.belongsTo(Image, {
    foreignKey: 'image_id',
    as: 'source_image'
});

Session.belongsTo(User, {
    foreignKey: 'user_id',
    as: 'user'
});

module.exports = {
    Generation,
    Image,
    User,
    Session
}