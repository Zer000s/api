const { GoogleGenAI } = require("@google/genai");
const fs = require('fs');

class GeminiService {
    constructor() {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required');
        }
        
        // Инициализация клиента
        this.ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY
        });
        
        // Модель по умолчанию
        this.model = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    }

    // Анализ изображения
    async analyzeImage(imageBuffer, mimeType) {
        try {
            console.log('🔍 Analyzing image with Gemini...');
            
            const prompt = `Проанализируй это изображение и предоставь подробную информацию в следующем JSON формате:
            {
                "labels": [{"description": "название объекта", "score": 0.95}],
                "text": "весь текст найденный на изображении",
                "colors": [{"color": {"red": 255, "green": 0, "blue": 0}, "score": 0.8}],
                "description": "подробное описание того, что изображено на фото",
                "style": "стиль изображения (фотография, рисунок, графика и т.д.)",
                "mood": "настроение/атмосфера изображения",
                "objects": ["список", "основных", "объектов"],
                "suggestions": ["предложения", "по", "улучшению"]
            }
            
            Укажи минимум 5 объектов с высокой точностью. Если есть текст, обязательно его распознай.
            Верни ТОЛЬКО JSON без дополнительного текста.`;

            // Конвертируем изображение в base64
            const imageData = imageBuffer.toString('base64');

            // Отправка запроса с изображением
            const response = await this.ai.models.generateContent({
                model: this.model,
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

            const text = response.text;
            console.log('✅ Gemini analysis completed');
            
            // Парсим JSON из ответа
            try {
                // Извлекаем JSON из текста (если есть дополнительные символы)
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                const analysisData = JSON.parse(jsonMatch ? jsonMatch[0] : text);
                
                return {
                    ...analysisData,
                    rawResponse: text,
                    timestamp: new Date().toISOString(),
                    model: this.model
                };
            } catch (parseError) {
                console.error('❌ Failed to parse Gemini response:', parseError);
                console.log('Raw response:', text);
                
                // Возвращаем сырой текст в случае ошибки парсинга
                return {
                    description: text.substring(0, 500),
                    rawResponse: text,
                    timestamp: new Date().toISOString(),
                    model: this.model
                };
            }
        } catch (error) {
            console.error('❌ Gemini analysis error:', error);
            throw new Error(`Failed to analyze image: ${error.message}`);
        }
    }

    // Генерация промпта на основе анализа
    async generatePrompt(analysis) {
        try {
            console.log('🎨 Generating prompt from analysis...');
            
            const prompt = `На основе этого анализа изображения создай промпт для нейросети:
            ${JSON.stringify(analysis, null, 2)}
            
            Создай промпт на английском языке для генерации креативной версии этого изображения.
            Промпт должен быть подробным, включать:
            - Основные объекты и их описание
            - Стиль (digital art, painting, photo, etc.)
            - Атмосферу и освещение
            - Детали и текстуры
            - Технические параметры (4k, highly detailed, etc.)
            
            Верни ТОЛЬКО промпт, без дополнительного текста.`;

            const response = await this.ai.models.generateContent({
                model: this.model,
                contents: prompt
            });

            const generatedPrompt = response.text.trim();
            console.log('✅ Prompt generated:', generatedPrompt.substring(0, 100) + '...');
            
            return generatedPrompt;
        }
        catch (error) {
            console.error('❌ Prompt generation error:', error);
            
            // Fallback промпт
            return `A beautiful artistic interpretation of the image, digital art style, highly detailed, 4k resolution, cinematic lighting, trending on artstation, masterpiece quality, intricate details, professional photography`;
        }
    }

    // Полный анализ + генерация промпта
    async analyzeAndGeneratePrompt(imageBuffer, mimeType) {
        const analysis = await this.analyzeImage(imageBuffer, mimeType);
        const prompt = await this.generatePrompt(analysis);
        
        return {
            analysis,
            prompt
        };
    }

    // Простой запрос для тестирования
    async testConnection() {
        try {
            console.log('🧪 Testing Gemini connection...');
            
            const response = await this.ai.models.generateContent({
                model: this.model,
                contents: "Respond with 'OK' if you can read this message. Just say 'OK' and nothing else."
            });
            
            const text = response.text;
            console.log('✅ Gemini response:', text);
            
            return text.includes('OK');
        }
        catch (error) {
            console.error('❌ Gemini connection test failed:', error);
            return false;
        }
    }

    // Распознавание текста на изображении (OCR)
    async extractText(imageBuffer, mimeType) {
        try {
            console.log('📝 Extracting text from image...');
            
            const prompt = `Extract and transcribe ALL text visible in this image. 
            Return ONLY the extracted text, nothing else. If there is no text, return "NO_TEXT_FOUND".`;

            const imageData = imageBuffer.toString('base64');

            const response = await this.ai.models.generateContent({
                model: this.model,
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

            const text = response.text;
            console.log('✅ Text extraction completed');
            
            return {
                text: text === 'NO_TEXT_FOUND' ? null : text,
                success: text !== 'NO_TEXT_FOUND'
            };
        } catch (error) {
            console.error('❌ Text extraction error:', error);
            return {
                text: null,
                success: false,
                error: error.message
            };
        }
    }

    // Получение информации о модели
    async getModelInfo() {
        return {
            model: this.model,
            capabilities: {
                vision: true,
                text: true,
                multimodal: true
            },
            apiKey: process.env.GEMINI_API_KEY ? '✓ Set' : '✗ Not set'
        };
    }
}

module.exports = new GeminiService();