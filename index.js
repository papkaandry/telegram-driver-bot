import express from 'express';
import { bot, handleUpdate } from './bot.js';

const app = express();
app.use(express.json());

app.post('/webhook', async (req, res) => {
  await handleUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('OK');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  const webhookUrl = `${process.env.WEBHOOK_URL}/webhook`;
  await bot.setWebHook(webhookUrl);
  console.log('🤖 Bot started with webhook:', webhookUrl);
});
