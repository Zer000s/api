const axios = require('axios');

class ImageGeneration {
  constructor() {
    this.apiKey = process.env.IMAGE_API_KEY;
    this.apiUrl = process.env.IMAGE_API_URL;
  }

  async generateImage(prompt, options = {}) {
    try {
      const requestData = {
        prompt: prompt,
        negative_prompt: options.negativePrompt || "blurry, low quality, distorted",
        steps: options.steps || 30,
        width: options.width || 512,
        height: options.height || 512,
        cfg_scale: options.cfgScale || 7.5,
        sampler: options.sampler || "Euler a",
        seed: options.seed || -1
      };

      const response = await axios.post(this.apiUrl, requestData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      });

      return {
        image: Buffer.from(response.data),
        format: 'png',
        prompt: prompt,
        parameters: requestData
      };
    } catch (error) {
      console.error('Image generation error:', error.response?.data || error.message);
      throw new Error('Failed to generate image');
    }
  }
}

module.exports = new ImageGeneration();