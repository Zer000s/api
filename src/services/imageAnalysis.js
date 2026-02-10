const vision = require('@google-cloud/vision');

class ImageAnalysis {
  constructor() {
    this.client = new vision.ImageAnnotatorClient();
  }

  async analyzeImage(imageBuffer) {
    try {
      const [result] = await this.client.labelDetection(imageBuffer);
      const labels = result.labelAnnotations;
      
      const [textResult] = await this.client.textDetection(imageBuffer);
      const text = textResult.textAnnotations;
      
      const [faceResult] = await this.client.faceDetection(imageBuffer);
      const faces = faceResult.faceAnnotations;
      
      return {
        labels: labels.map(label => ({
          description: label.description,
          score: label.score
        })),
        text: text.length > 0 ? text[0].description : null,
        faces: faces.map(face => ({
          joy: face.joyLikelihood,
          sorrow: face.sorrowLikelihood,
          anger: face.angerLikelihood,
          surprise: face.surpriseLikelihood
        }))
      };
    } catch (error) {
      console.error('Image analysis error:', error);
      throw new Error('Failed to analyze image');
    }
  }

  generatePrompt(analysis) {
    let prompt = "A beautiful artistic representation of";
    
    // Добавляем основные объекты
    if (analysis.labels.length > 0) {
      const mainObjects = analysis.labels
        .slice(0, 3)
        .map(label => label.description.toLowerCase())
        .join(', ');
      prompt += ` ${mainObjects}`;
    }
    
    // Добавляем контекст из текста
    if (analysis.text) {
      prompt += ` with text "${analysis.text.substring(0, 50)}"`;
    }
    
    // Добавляем эмоциональный контекст
    if (analysis.faces.length > 0) {
      const emotions = [];
      const face = analysis.faces[0];
      
      if (face.joy === 'VERY_LIKELY' || face.joy === 'LIKELY') {
        emotions.push('joyful');
      }
      if (face.sorrow === 'VERY_LIKELY' || face.sorrow === 'LIKELY') {
        emotions.push('melancholic');
      }
      
      if (emotions.length > 0) {
        prompt += `, evoking a ${emotions.join(' and ')} mood`;
      }
    }
    
    // Добавляем стиль
    prompt += ", digital art, highly detailed, 4k, trending on artstation";
    
    return prompt;
  }
}

module.exports = new ImageAnalysis();