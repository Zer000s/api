// services/nanoBananoService.js
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Единый сервис для Nano Banana (Gemini 2.5 Flash Image / Gemini 3 Pro Image)
 * Поддерживает:
 * - Text-to-Image (генерация с нуля)
 * - Image-to-Image (редактирование / стилизация)
 * - Бесплатные прокси-эндпоинты (felo.ai, Higgsfield, Geminigen)
 * - Официальный Gemini API
 */
class NanoBananoService {
    constructor() {
        // Доступные модели (официальные названия)
        this.MODELS = {
            OFFICIAL_VISION: 'gemini-2.5-flash-image-preview', // Официальная (требует API key)
            PRO_VISION: 'gemini-3-pro-image-preview',          // Nano Banana Pro
            FAL_AI: 'fal-ai/nano-banana',                     // Fal.ai community
        };

        // Бесплатные публичные эндпоинты (community proxies)
        // Источник: Apidog, Higgsfield, Felo.ai [citation:3][citation:6]
        this.FREE_ENDPOINTS = [
            {
                name: 'felo.ai',
                url: 'https://api.felo.ai/v1/gemini-image-gen',
                auth: 'none',               // Без авторизации
                type: 'json',              // JSON payload
            },
            {
                name: 'geminigen',
                url: 'https://api.geminigen.ai/v1/images/generations',
                auth: 'bearer',            // API key (опционально, можно "free")
                type: 'openai-compatible', // OpenAI-compatible
            },
            {
                name: 'higgsfield',
                url: 'https://api.higgsfield.ai/nano-banana',
                auth: 'bearer',
                type: 'json',
            }
        ];

        // Инициализация официального клиента (если есть API ключ)
        if (process.env.GEMINI_API_KEY) {
            this.officialClient = new GoogleGenAI({
                apiKey: process.env.GEMINI_API_KEY
            });
            console.log('✅ NanoBananoService: Official Gemini client initialized');
        } else {
            console.log('ℹ️ NanoBananoService: No GEMINI_API_KEY, using free community endpoints');
        }

        // Выбранный активный эндпоинт (по умолчанию felo.ai — самый быстрый и без регистрации)
        this.activeEndpoint = this.FREE_ENDPOINTS[0];
    }

    /**
     * Переключение между бесплатными эндпоинтами
     */
    setEndpoint(endpointName) {
        const endpoint = this.FREE_ENDPOINTS.find(e => e.name === endpointName);
        if (endpoint) {
            this.activeEndpoint = endpoint;
            console.log(`✅ NanoBananoService: Switched to endpoint ${endpointName}`);
            return true;
        }
        return false;
    }

    /**
     * УНИВЕРСАЛЬНЫЙ МЕТОД: Image-to-Image / редактирование / стилизация
     * Принимает буфер изображения и промпт трансформации
     * Возвращает буфер обработанного изображения
     */
    async img2img(imageBuffer, prompt, options = {}) {
        const {
            mimeType = 'image/png',
            resolution = '1024x1024',
            useOfficial = false,      // true = использовать официальный API (нужен ключ)
            useEndpoint = null,      // принудительно выбрать эндпоинт
        } = options;

        console.log(`🎨 NanoBanano: Processing img2img with prompt: "${prompt.substring(0, 60)}..."`);

        // 1. Приоритет: официальный API (если есть ключ и запрошено)
        if (useOfficial && this.officialClient) {
            return await this._officialImg2Img(imageBuffer, prompt, mimeType);
        }

        // 2. Использовать бесплатный community endpoint
        const endpoint = useEndpoint 
            ? this.FREE_ENDPOINTS.find(e => e.name === useEndpoint) 
            : this.activeEndpoint;

        if (!endpoint) {
            throw new Error('No available endpoint for Nano Banana');
        }

        try {
            // Выбор стратегии в зависимости от типа эндпоинта
            if (endpoint.name === 'felo.ai') {
                return await this._feloImg2Img(imageBuffer, prompt, endpoint);
            } else if (endpoint.name === 'geminigen') {
                return await this._geminigenImg2Img(imageBuffer, prompt, endpoint);
            } else {
                return await this._genericImg2Img(imageBuffer, prompt, endpoint);
            }
        } catch (error) {
            console.error(`❌ NanoBanano: Endpoint ${endpoint.name} failed:`, error.message);
            // Fallback: пробуем следующий эндпоинт
            const fallbackEndpoint = this.FREE_ENDPOINTS.find(e => e.name !== endpoint.name);
            if (fallbackEndpoint) {
                console.log(`🔄 NanoBanano: Falling back to ${fallbackEndpoint.name}`);
                return await this._genericImg2Img(imageBuffer, prompt, fallbackEndpoint);
            }
            throw error;
        }
    }

    /**
     * Полный пайплайн: анализ -> генерация фирменного промпта -> img2img
     * @param {Buffer} imageBuffer - Буфер исходного изображения
     * @param {string} basePrompt - Базовый промпт от пользователя (опционально)
     * @param {object} geminiService - Экземпляр GeminiService для анализа
     */
    async processWithStyle(imageBuffer, geminiService, basePrompt = null, style = 'venetian') {
        // 1. АНАЛИЗ изображения через существующий GeminiService
        // console.log('🔍 Step 1: Analyzing image...');
        const analysis = await geminiService.analyzeImage(
            imageBuffer, 
            'image/jpeg' // или определить динамически
        );

        // // 2. ГЕНЕРАЦИЯ фирменного промпта приложения
        // console.log('🎯 Step 2: Generating branded prompt...');
        // const brandedPrompt = this._generateBrandedPrompt(analysis, basePrompt, style);

        // 3. IMG2IMG через Nano Banana
        console.log('✨ Step 3: Applying style via Nano Banana...');
        const resultBuffer = await this.img2img(imageBuffer, analysis.prompt, {
            useOfficial: true, // используем бесплатные эндпоинты для теста
        });

        return {
            analysis,
            originalPrompt: analysis.prompt,
            imageBuffer: resultBuffer,
        };
    }

    /**
     * Генерация ФИРМЕННОГО ПРОМПТА с фиксированным стилем (Венеция)
     */
    _generateBrandedPrompt(analysis, userPrompt = null, style = 'venetian') {
        // Извлекаем ключевые объекты из анализа
        const objects = analysis.labels
            ?.slice(0, 5)
            .map(l => l.description)
            .join(', ') || 'the subject';

        const description = analysis.description || 'a beautiful scene';
        const mood = analysis.mood || 'peaceful';

        // БАЗОВЫЙ ФИРМЕННЫЙ СТИЛЬ — ВЕНЕЦИАНСКИЙ (как пример)
        // Вы можете легко добавить другие стили (киберпанк, импрессионизм и т.д.)
        const stylePrompts = {
            venetian: `Transform this image into a masterpiece of Venetian Renaissance painting. 
                Style characteristics: warm golden light reflecting on water, rich earthy tones (burnt sienna, ochre, deep teal), 
                soft atmospheric perspective, painterly brushstrokes reminiscent of Titian and Bellini. 
                Add elements of Venetian architecture (arches, marble, canals) subtly integrated into the scene.
                The mood should be romantic, timeless, with a dreamy golden-hour glow.`,
            
            cyberpunk: `Transform into a cyberpunk neon dreamscape. Vibrant pinks and cyans, rain-slicked streets, holographic advertisements, 
                futuristic cityscape with Japanese influences, dramatic volumetric lighting, 8k, ultra-detailed.`,
            
            impressionist: `Transform into an Impressionist painting. Loose brushstrokes, vibrant dappled light, 
                emphasis on capturing light and movement, Claude Monet style, pastel palette with soft focus.`,
        };

        const selectedStyle = stylePrompts[style] || stylePrompts.venetian;

        // Собираем финальный промпт
        return `
            ${selectedStyle}
            
            Main subject: ${objects}.
            Scene description: ${description}.
            Mood: ${mood}.
            
            ${userPrompt ? `Additional user request: ${userPrompt}` : ''}
            
            --ar 16:9 --quality 2 --style raw
        `.trim().replace(/\s+/g, ' ');
    }

    // ---------- РЕАЛИЗАЦИИ ДЛЯ РАЗНЫХ ЭНДПОИНТОВ ----------

    /**
     * Эндпоинт felo.ai (самый быстрый, без авторизации)
     * Документация: https://felo.ai/image
     */
    async _feloImg2Img(imageBuffer, prompt, endpoint) {
        const base64Image = imageBuffer.toString('base64');
        
        const payload = {
            prompt: prompt,
            image: `data:image/png;base64,${base64Image}`,
            model: 'gemini-2.5-flash-image-preview',
            resolution: '1024x1024',
        };

        const response = await axios.post(endpoint.url, payload, {
            headers: {
                'Content-Type': 'application/json',
            },
            timeout: 60000, // 60 секунд
        });

        if (response.data?.image) {
            // felo возвращает base64
            return Buffer.from(response.data.image, 'base64');
        } else if (response.data?.url) {
            // или URL
            const imgResponse = await axios.get(response.data.url, { responseType: 'arraybuffer' });
            return Buffer.from(imgResponse.data);
        }
        
        throw new Error('Unexpected response from felo.ai');
    }

    /**
     * Эндпоинт Geminigen (OpenAI-compatible)
     */
    async _geminigenImg2Img(imageBuffer, prompt, endpoint) {
        const base64Image = imageBuffer.toString('base64');
        
        const payload = {
            model: 'nano-banana-pro',
            prompt: prompt,
            image: base64Image,
            n: 1,
            size: '1024x1024',
            response_format: 'b64_json',
        };

        const headers = {
            'Content-Type': 'application/json',
        };
        
        // Можно добавить бесплатный токен (опционально)
        if (process.env.GEMINIGEN_API_KEY) {
            headers['Authorization'] = `Bearer ${process.env.GEMINIGEN_API_KEY}`;
        }

        const response = await axios.post(endpoint.url, payload, { headers, timeout: 60000 });

        if (response.data?.data?.[0]?.b64_json) {
            return Buffer.from(response.data.data[0].b64_json, 'base64');
        }
        
        throw new Error('Unexpected response from Geminigen');
    }

    /**
     * Универсальный метод для других эндпоинтов
     */
    async _genericImg2Img(imageBuffer, prompt, endpoint) {
        const form = new FormData();
        form.append('image', imageBuffer, { filename: 'image.png', contentType: 'image/png' });
        form.append('prompt', prompt);
        form.append('model', 'nano-banana');

        const headers = {
            ...form.getHeaders(),
        };

        if (endpoint.auth === 'bearer' && process.env.NANO_BANANA_TOKEN) {
            headers['Authorization'] = `Bearer ${process.env.NANO_BANANA_TOKEN}`;
        }

        const response = await axios.post(endpoint.url, form, {
            headers,
            timeout: 60000,
            responseType: 'arraybuffer', // ожидаем бинарный ответ
        });

        return Buffer.from(response.data);
    }

    /**
     * Официальный Gemini API (если есть ключ)
     */
    async _officialImg2Img(imageBuffer, prompt, mimeType) {
        if (!this.officialClient) {
            throw new Error('Official Gemini client not initialized');
        }

        const imageData = imageBuffer.toString('base64');

        const response = await this.officialClient.models.generateContent({
            model: this.MODELS.OFFICIAL_VISION,
            contents: [
                { text: prompt },
                {
                    inlineData: {
                        data: imageData,
                        mimeType: mimeType
                    }
                }
            ]
        });

        // Извлекаем бинарные данные из ответа
        for (const part of response.candidates[0].content.parts) {
            if (part.inlineData?.data) {
                return Buffer.from(part.inlineData.data, 'base64');
            }
        }

        throw new Error('No image data in official Gemini response');
    }

    /**
     * Простой тест: генерация по тексту (без изображения)
     */
    async text2img(prompt, options = {}) {
        console.log(`🖼️ NanoBanano: Generating image from text: "${prompt.substring(0, 60)}..."`);
        
        // Для felo.ai
        if (this.activeEndpoint.name === 'felo.ai') {
            const payload = {
                prompt: prompt,
                model: 'gemini-2.5-flash-image-preview',
                resolution: options.resolution || '1024x1024',
            };

            const response = await axios.post(this.activeEndpoint.url, payload, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 60000,
            });

            if (response.data?.image) {
                return Buffer.from(response.data.image, 'base64');
            }
        }

        throw new Error('Text-to-image not implemented for this endpoint');
    }
}

module.exports = new NanoBananoService();