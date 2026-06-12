const http = require('http');
const data = JSON.stringify({
  text: 'यह एक हिंदी परीक्षण है।',
  language: 'hi',
  gender: 'female'
});

const options = {
  hostname: '127.0.0.1',
  port: 4000,
  path: '/api/generate-audio',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    console.log('BODY', body);
  });
});

req.on('error', (err) => console.error('ERR', err.message));
req.write(data);
req.end();
