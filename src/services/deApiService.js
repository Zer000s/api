const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require("sharp");
const { Generation } = require('../models/models');

class DeApiService {
    constructor() {
        this.apiKey = process.env.DEAPI_API_KEY;
        this.baseUrl = process.env.DEAPI_BASE_URL || 'https://api.deapi.ai/api/v1/client';
        this.model = process.env.DEAPI_MODEL || 'QwenImageEdit_Plus_NF4';
        
        if (!this.apiKey) {
            console.warn('⚠️ DEAPI_API_KEY not set in .env');
        }
    }

    // Генерация изображения из изображения + промпт
    img2img = async (imagePath, prompt, options = {}) => {
        try {
            console.log('🎨 Generating image with deApi...');
            
            const formData = new FormData();
            
            // Добавляем изображение
            formData.append('image', fs.createReadStream(imagePath));
            
            // Добавляем параметры
            formData.append('prompt', prompt);
            formData.append('model', options.model || this.model);
            formData.append('seed', options.seed || Math.floor(Math.random() * 1000000));
            formData.append('steps', 20);
            
            // Добавляем негативный промпт если есть
            if (options.negative_prompt) {
                formData.append('negative_prompt', options.negative_prompt);
            }
            
            // Добавляем cfg scale если есть
            if (options.cfg_scale) {
                formData.append('cfg_scale', options.cfg_scale);
            }

            const response = await axios.post(`${this.baseUrl}/img2img`, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${this.apiKey}`
                },
                responseType: 'arraybuffer',
                timeout: 60000 // 60 секунд на генерацию
            });
            
            const request_id = JSON.parse(Buffer.from(response.data).toString()).data.request_id

            return {
                request_id: request_id,
                format: 'png',
                seed: options.seed
            };

        } catch (error) {
            console.error('❌ deApi generation error:', error.response?.data?.toString() || error.message);
            throw new Error(`Failed to generate image: ${error.message}`);
        }
    }

    getRequestStatus = async (requestId, anonymousId) => {
        try {
            console.log(`📊 Checking request status: ${requestId}`);
            
            const response = await axios.get(`${this.baseUrl}/request-status/${requestId}`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });

            const data = response.data.data;
            
            // Если статус completed и есть result_url
            if (data.status && data.result_url) {
                console.log('✅ Request completed, downloading image...');
                
                // 👇 СКАЧИВАЕМ ИЗОБРАЖЕНИЕ ПО URL
                const imageResponse = await axios.get(data.result_url, {
                    responseType: 'arraybuffer'
                });
                
                // Генерируем имя файла
                const generatedFilename = `processed-${Date.now()}-${anonymousId}.png`;
                const uploadDir = process.env.UPLOAD_DIR;
                const generatedPath = path.join(uploadDir, generatedFilename);
  
                const image = sharp(imageResponse.data);
                const metadata = await image.metadata();

                const svg = this.createWatermarkSVG(metadata.width, metadata.height);
                const svgBuffer = Buffer.from(svg);

                // накладываем watermark
                const outputBuffer = await image
                    .composite([
                    {
                        input: svgBuffer,
                        top: 0,
                        left: 0,
                    },
                    ])
                    .png()
                    .toBuffer();

                fs.writeFileSync(generatedPath, outputBuffer);
                
                console.log(`✅ Image saved: ${generatedFilename}`);
                
                const generatedImage = await Generation.findOne({
                    where: {anonymous_id: anonymousId, parameters: {request_id: requestId}}
                });

                await generatedImage.update({
                    generated_filename: generatedFilename,
                    status: 'completed'
                });

                return {
                    status: 'completed',
                    image: {
                        id: generatedImage.id,
                        url: `/uploads/${generatedFilename}`,
                        filename: generatedFilename,
                        path: generatedPath
                    },
                    request_id: requestId
                };
            }

            return {
                status: data.status,
                progress: data.progress || 0,
                request_id: requestId
            };
            
        } catch (error) {
            console.error('❌ Failed to get request status:', error.response?.data || error.message);
            throw new Error(`Failed to get request status: ${error.message}`);
        }
    }

    // Проверка подключения к API
    testConnection = async () => {
        try {
            const response = await axios.get(`${this.baseUrl}/models`, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                }
            });
            return { success: true, models: response.data };
        } catch (error) {
            console.error('❌ deApi connection test failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    createWatermarkSVG = (width, height, text = "AI Generator") => {
        const fontSize = Math.floor(width / 18); // масштабируется от размера картинки
        const opacity = 0.3; // прозрачность (очень важно для видимости изображения)

        return Buffer.from(`
            <svg width="${width}" height="${height}">
            <defs>
                <pattern id="pattern" 
                        patternUnits="userSpaceOnUse" 
                        width="400" height="200"
                        patternTransform="rotate(-30)">

                <text x="0" y="150"
                        font-size="${fontSize}"
                        font-family="Arial, sans-serif"
                        fill="white"
                        fill-opacity="${opacity}">
                    ${text}
                </text>

                </pattern>
            </defs>

            <rect width="100%" height="100%" fill="url(#pattern)" />
            </svg>
        `);
    }
}

module.exports = new DeApiService();