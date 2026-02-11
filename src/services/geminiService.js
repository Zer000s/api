const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');

class GeminiService {
    constructor() {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is required');
        }
        this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        this.model = this.genAI.getGenerativeModel({ 
            model: process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest' 
        });
    }

    // Анализ изображения
    analyzeImage = async (imageBuffer, mimeType) => {
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

            // Подготовка изображения для Gemini
            const imageData = imageBuffer.toString('base64');
            
            // Отправка запроса
            const result = await this.model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: imageData,
                        mimeType: mimeType
                    }
                }
            ]);

            const response = await result.response;
            const text = response.text();
            
            console.log('✅ Gemini analysis completed');
            
            // Парсим JSON из ответа
            try {
                // Извлекаем JSON из текста (если есть дополнительные символы)
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                const analysisData = JSON.parse(jsonMatch ? jsonMatch[0] : text);
                
                return {
                    ...analysisData,
                    rawResponse: text,
                    timestamp: new Date().toISOString()
                };
            } catch (parseError) {
                console.error('❌ Failed to parse Gemini response:', parseError);
                console.log('Raw response:', text);
                
                // Возвращаем сырой текст в случае ошибки парсинга
                return {
                    description: text.substring(0, 500),
                    rawResponse: text,
                    timestamp: new Date().toISOString()
                };
            }
        } catch (error) {
            console.error('❌ Gemini analysis error:', error);
            throw new Error(`Failed to analyze image: ${error.message}`);
        }
    }

    // Генерация промпта на основе анализа
    generatePrompt = async (analysis) => {
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

            const result = await this.model.generateContent(prompt);
            const response = await result.response;
            const generatedPrompt = response.text().trim();
            
            console.log('✅ Prompt generated:', generatedPrompt.substring(0, 100) + '...');
            
            return generatedPrompt;
        } catch (error) {
            console.error('❌ Prompt generation error:', error);
            
            // Fallback промпт
            return `A beautiful artistic interpretation of the image, digital art style, highly detailed, 4k resolution, cinematic lighting, trending on artstation, masterpiece quality, intricate details, professional photography`;
        }
    }

    // Полный анализ + генерация промпта
    analyzeAndGeneratePrompt = async (imageBuffer, mimeType) => {
        const analysis = await this.analyzeImage(imageBuffer, mimeType);
        const prompt = await this.generatePrompt(analysis);
        
        return {
            analysis,
            prompt
        };
    }

    // Проверка API ключа
    testConnection = async () => {
        try {
            const result = await this.model.generateContent('Hello, respond with "OK" if you can read this.');
            console.log(result)
            const response = await result.response;
            return response.text().includes('OK');
        } catch (error) {
            console.error('❌ Gemini connection test failed:', error);
            return false;
        }
    }
}

module.exports = new GeminiService();