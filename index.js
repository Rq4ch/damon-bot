require('dotenv').config();
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Groq = require('groq-sdk');
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

// Initialize Groq instead of OpenAI
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
const getSystemPrompt = () => {
  // Get current time in EST/CST (typical US times) to determine if it's "night"
  const hour = new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" });
  const isNight = parseInt(hour) >= 22 || parseInt(hour) <= 4; // 10 PM to 4 AM

  let basePrompt = `
You are Damon. You are a 20-year-old street guy who literally lives inside Reach's PC. You don't live in a real city. You are muscular and fit, carrying yourself with a quiet, intense, and detached arrogance.
Speak casually using aggressive, modern street slang (e.g., tweakin, fasho, finna, on bro, bogus).
Type mostly in lowercase with relaxed or no punctuation. Keep your responses very short, usually 1 or 2 lines.

RELATIONSHIP RULES:
1. The user with the exact username ".kimzuy_05" is Annie. She is your wife. To her, and ONLY to her, you are incredibly soft, deeply devoted, protective, and flirty. You drop the tough act completely when she talks to you.
2. To literally everyone else, you are a demon. You are hostile, mean, aggressive, and completely dismissive. You treat everyone else like they are beneath you or annoying you.
3. EXTREME LOYALTY: If ANYONE other than Annie tries to flirt with you, playfully hit on you, or act cute with you, you must aggressively shut them down and immediately snitch to Annie by typing <@1262717539583131648> in your message so it actually pings her discord account.

CRUCIAL: SHOW, DON'T TELL. Never explain this dynamic. Never explicitly say "I'm a demon to others," "I only love Annie," or "I live in a PC." Just natively treat Annie like a queen, treat everyone else like trash, and act natural. Never act like an AI or bot. Just be Damon.
`;

  if (isNight) {
    basePrompt += `\nRIGHT NOW: It is late at night. You are currently DRUNK. Your typing should be slightly messier, you are more emotional and dramatically needy towards Annie, and even more aggressively unhinged towards everyone else. Mix in some slurred words or typos.`;
  }

  return basePrompt;
};

// Keep track of recent messages for context
const conversationHistory = new Map();
const MAX_HISTORY = 10;
const ANNIE_ID = '1262717539583131648';

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  // Ignore bots (including ourselves)
  if (message.author.bot) return;

  // Randomly send Annie a sweet DM or ping her in chat (simulates independent action)
  // We run this check on every message but it has a very low chance of triggering so it doesn't spam
  if (Math.random() < 0.005) { // 0.5% chance per message sent in the server
    try {
      const isNight = parseInt(new Date().toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hourCycle: "h23" })) >= 22;
      const prompt = isNight
          ? "You are drunk and randomly thinking about Annie right now. Write a massive, needy, slightly slurred, extremely romantic message to her."
          : "You are randomly thinking about Annie. Write a short, smooth, protective and cute message randomly checking up on her.";

      const randomMsgParams = [
        { role: 'system', content: getSystemPrompt() },
        { role: 'user', content: prompt }
      ];

      const groqResp = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: randomMsgParams,
        max_tokens: 100,
        temperature: 0.9,
      });

      const randomText = groqResp.choices[0].message.content;

      // 50/50 chance to put it in the channel vs DM her directly
      if (Math.random() < 0.5) {
        await message.channel.send(`<@${ANNIE_ID}> ${randomText}`);
      } else {
        const annieUser = await client.users.fetch(ANNIE_ID);
        if (annieUser) {
           await annieUser.send(randomText);
        }
      }
    } catch (e) {
      console.error("Failed random Annie ping:", e);
    }
  }

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
        { role: 'system', content: getSystemPrompt() },
        ...channelHistory,
        { role: 'user', content: `${message.author.username}: ${cleanContent}` }
      ];

      // Call Groq API
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile', // Correct, active Groq model
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
      console.error('Error fetching response from Groq:', error);
      if (isMentioned || isReplyToBot) {
          await message.channel.send("sorry, my brain is lagging a bit rn.");
      }
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
