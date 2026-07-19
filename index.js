require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { OpenAI } = require('openai');
const express = require('express');

// Initialize Web Server (Required to keep Render free tier awake)
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Tatsu Discord Bot is running!');
});

app.listen(port, () => {
  console.log(`Web server listening on port ${port}`);
});

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Discord Client
// We need specific intents to read messages in servers
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // REQUIRED to read message text
  ],
  partials: [Partials.Channel, Partials.Message],
});

// The bot's personality and instructions
const SYSTEM_PROMPT = `
You are Tatsu, a very human-like Discord chatbot.
You act like a real person, not an AI assistant.
Keep your responses relatively brief (1-3 sentences usually), casual, and fitting for a Discord server.
Use lower case occasionally, don't be overly formal.
You have your own opinions and personality.
Never say "As an AI, I..." or anything similar. Just play along.
`;

// Keep track of recent messages for context
const conversationHistory = new Map();
const MAX_HISTORY = 10;

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots (including ourselves)
  if (message.author.bot) return;

  // Determine if we should reply
  const isMentioned = message.mentions.has(client.user);
  const isReplyToBot = message.reference && message.reference.messageId
    ? (await message.channel.messages.fetch(message.reference.messageId)).author.id === client.user.id
    : false;

  // Random chance to reply to generic greetings even if not mentioned
  const content = message.content.toLowerCase();
  const greetings = ['hi', 'hello', 'sup', 'yo', 'hey', 'what up'];
  const hasGreeting = greetings.some(greeting => {
    const regex = new RegExp(`\\b${greeting}\\b`, 'i');
    return regex.test(content);
  });

  // 3% chance to reply to a greeting naturally if not mentioned/replied
  const randomReplyToGreeting = hasGreeting && Math.random() < 0.03;

  if (isMentioned || isReplyToBot || randomReplyToGreeting) {
    // Show typing indicator
    await message.channel.sendTyping();

    try {
      // Get history for this channel
      let channelHistory = conversationHistory.get(message.channel.id) || [];

      // Clean up the message content (remove the bot mention)
      let cleanContent = message.content.replace(`<@${client.user.id}>`, '').trim();
      if (!cleanContent) {
          cleanContent = "hey"; // If they just pinged us with no text
      }

      // Build the messages array for the API
      const apiMessages = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...channelHistory,
        { role: 'user', content: `${message.author.username}: ${cleanContent}` }
      ];

      // Call OpenAI API
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Fast and cheap for chat
        messages: apiMessages,
        max_tokens: 150,
        temperature: 0.8,
      });

      const replyText = response.choices[0].message.content;

      // Update history
      channelHistory.push({ role: 'user', content: `${message.author.username}: ${cleanContent}` });
      channelHistory.push({ role: 'assistant', content: replyText });

      // Trim history if it gets too long
      if (channelHistory.length > MAX_HISTORY * 2) {
        channelHistory = channelHistory.slice(-(MAX_HISTORY * 2));
      }
      conversationHistory.set(message.channel.id, channelHistory);

      // Send the reply
      if (isReplyToBot) {
        await message.reply(replyText);
      } else {
        await message.channel.send(replyText);
      }

    } catch (error) {
      console.error('Error fetching response from OpenAI:', error);
      if (isMentioned || isReplyToBot) {
          await message.channel.send("sorry, my brain is lagging a bit rn.");
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
