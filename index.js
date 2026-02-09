import express from 'express';
import bodyParser from 'body-parser';
import { handleUpdate } from './bot.js';
import { migrate } from './db.js';

const app = express();
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

// Telegram webhook
app.post('/', async (req, res) => {
  await handleUpdate(req.body);
  res.send('OK');
});

// Health check
app.get('/', (req, res) => {
  res.send('Bot is running');
});

// Start server + migrate DB
app.listen(PORT, async () => {
  await migrate();
  console.log('🤖 Bot started');
});
