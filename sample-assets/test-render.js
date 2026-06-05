const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

async function run() {
  const form = new FormData();
  form.append('images', fs.createReadStream(path.join(__dirname, 'image1.png')), 'image1.png');
  form.append('images', fs.createReadStream(path.join(__dirname, 'image2.png')), 'image2.png');
  form.append('images', fs.createReadStream(path.join(__dirname, 'image3.png')), 'image3.png');
  form.append('audio', fs.createReadStream(path.join(__dirname, 'audio.mp3')), 'audio.mp3');
  form.append('script', 'Line one\nLine two');
  form.append('videoType', 'desktop');

  const res = await axios.post('http://localhost:4000/api/render', form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: null
  });

  console.log('Status:', res.status);
  console.log('Body:', typeof res.data === 'object' ? JSON.stringify(res.data) : res.data);
}

run().catch((err) => {
  console.error('Request failed:', err);
  process.exit(1);
});