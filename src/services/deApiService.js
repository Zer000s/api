const fs = require('fs/promises');
const path = require('path');
const sharp = require("sharp");

class ApiError extends Error {
    constructor(message, status, data = null) {
        super(message);
        this.name = "ApiError";
        this.status = status;
        this.data = data;
    }
}

class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = "TimeoutError";
    }
}

class InvalidResponseError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidResponseError";
    }
}

class DeApiService {
    constructor() {
        this.apiKey = process.env.DEAPI_API_KEY;
        this.baseUrl = process.env.DEAPI_BASE_URL;
        this.model = process.env.DEAPI_MODEL;
        this.timeoutMs = 30000;
    }

    async img2img(imagePath, anonymousId) {
        let generatedPath = null;
        let clearGeneratedPath = null;

        try {
            const imageBuffer = await fs.readFile(imagePath);
            const base64Image = imageBuffer.toString('base64');

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
            
            console.info("Start creating image")

            let response;
            try {
                response = await fetch(this.baseUrl, {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${this.apiKey}`,
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        model: this.model,
                        messages: [{
                            role: "user",
                            content: [
                                { type: "text", text: "Transform the animal in the image into a classical aristocratic oil portrait from the 17th–18th century. Preserve maximum likeness to the original animal: exact facial features, eye shape, muzzle proportions, fur pattern, color distribution, and overall identity must remain unchanged. Strictly preserve the original pose, body position, silhouette, proportions, scale, and head orientation from the source image. Do not alter anatomy or posture. The animal is resting on an elegant classical cushion, fully consistent with the old master aesthetic. The cushion is made of rich velvet fabric in deep warm tones (burgundy, dark brown, muted gold), with subtle embroidery and soft folds, naturally supporting the animal without changing its pose. Classical old European masters painting style, very rich oil paint texture with highly visible, layered, and directional brushstrokes, traditional canvas surface. Soft dramatic chiaroscuro lighting, dark atmospheric background. Luxurious velvet cloak with fur trim and refined gold jewelry. Bold, tactile oil strokes across the cushion, garments, and background, pronounced impasto highlights, expressive yet controlled painterly technique. High detail in fur, fabric, cushion texture, and metal, museum-quality fine art, vintage color grading, regal ceremonial portrait atmosphere." },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${base64Image}`
                                    }
                                }
                            ]
                        }],
                        modalities: ["image"],
                        image_config: {
                            aspect_ratio: "2:3",
                            image_size: "1K",
                        },
                        extra_body: {
                            negative_prompt: "change of pose, altered anatomy, loss of likeness, floating subject, incorrect body support, human features, cartoon, anime, modern objects, photographic realism, smooth digital painting, flat lighting, neon colors, CGI, 3D, plastic texture, oversmoothing, identity drift, text, watermarks",
                        }
                    }),
                    signal: controller.signal
                });
            }
            catch (err) {
                if (err.name === 'AbortError') {
                    throw new TimeoutError("API request timeout");
                }
                throw new Error("Network error while calling API");
            }
            finally {
                clearTimeout(timeout);
            }

            if (!response.ok) {
                const errorBody = await response.text();
                throw new ApiError(
                    `API responded with ${response.status}`,
                    response.status,
                    errorBody
                );
            }

            let result;
            try {
                result = await response.json();
            } catch {
                throw new InvalidResponseError("Invalid JSON response from API");
            }

            const imageData =
                result?.choices?.[0]?.message?.images?.[0]?.image_url?.url;

            if (!imageData) {
                throw new InvalidResponseError("Missing image data in API response");
            }

            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
            const resBuffer = Buffer.from(base64Data, 'base64');

            const generatedFilename = `processed-${Date.now()}-${anonymousId}.png`;
            generatedPath = path.join(process.env.UPLOAD_DIR, generatedFilename);
            clearGeneratedPath = path.join(process.env.CLEAR_UPLOAD_DIR, generatedFilename);

            await fs.writeFile(clearGeneratedPath, resBuffer);

            const image = sharp(resBuffer);
            const metadata = await image.metadata();

            const svg = this.createWatermarkSVG(metadata.width, metadata.height);
            const outputBuffer = await image
                .composite([{ input: svg, top: 0, left: 0 }])
                .png()
                .toBuffer();

            await fs.writeFile(generatedPath, outputBuffer);

            return {
                status: 'completed',
                image: {
                    url: `/uploads/${generatedFilename}`,
                    filename: generatedFilename,
                    path: generatedPath
                }
            };

        } catch (error) {
            if (generatedPath) {
                try{
                    await fs.unlink(generatedPath);
                }
                catch{}
            }
            if (clearGeneratedPath) {
                try{
                    await fs.unlink(clearGeneratedPath);
                }
                catch{}
            }
            if (error instanceof TimeoutError || error instanceof ApiError || error instanceof InvalidResponseError){
                throw error;
            }
            throw new Error(`Unexpected error: ${error.message}`);
        }
    }

    createWatermarkSVG(width, height, text = "Venezia AI") {
        const fontSize = Math.floor(width / 18);
        const opacity = 0.3;

        return Buffer.from(`
            <svg width="${width}" height="${height}">
                <defs>
                    <pattern id="pattern"
                             patternUnits="userSpaceOnUse"
                             width="700" height="200"
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