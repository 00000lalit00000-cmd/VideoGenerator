const gTTS = require('gtts');
const fs = require('fs');
const text = 'एक घने जंगल में एक शक्तिशाली शेर रहता था।';
try {
  const speech = new gTTS(text, 'hi');
  speech.save('server/output/test-hi.mp3', (err) => {
    if (err) {
      console.error('SAVE ERR', err);
      process.exit(1);
    } else {
      console.log('SAVED', fs.statSync('server/output/test-hi.mp3').size);
      process.exit(0);
    }
  });
} catch (e) {
  console.error('ERR', e.message);
  process.exit(1);
}
