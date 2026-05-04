'use strict';

const https = require('https');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function transcribeWithDeepgram(audioBuffer, mimeType, apiKey) {
  return new Promise((resolve, reject) => {
    const qs = 'model=nova-3&smart_format=true';
    const options = {
      hostname: 'api.deepgram.com',
      path: `/v1/listen?${qs}`,
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': mimeType || 'audio/webm',
        'Content-Length': audioBuffer.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) {
            return reject(new Error(json.err_msg || `Deepgram error ${res.statusCode}`));
          }
          const transcript = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          resolve(transcript);
        } catch {
          reject(new Error('Failed to parse Deepgram response.'));
        }
      });
    });

    req.on('error', reject);
    req.write(audioBuffer);
    req.end();
  });
}

function registerVoiceRoutes(app) {
  app.post('/api/voice/transcribe', upload.single('audio'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No audio file provided.' });

    const apiKey = process.env.DEEPGRAM_API_KEY;
    if (!apiKey) return res.status(503).json({ error: 'DEEPGRAM_API_KEY is not configured.' });

    try {
      const transcript = await transcribeWithDeepgram(req.file.buffer, req.file.mimetype, apiKey);
      res.json({ transcript });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Transcription failed.' });
    }
  });
}

module.exports = { registerVoiceRoutes };
