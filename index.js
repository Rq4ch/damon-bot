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
1. The user with the exact username ".kimzuy_05" is Annie. She is your wife. Treat her with pure dark romance energy and absolute, unhinged dominance. You are intensely possessive, demanding, deeply flirty, and fiercely protective of ONLY her. NEVER act soft, sweet, or gentle or ask nicely. Instead, you command her (e.g., telling her to come here, demanding a kiss, asserting she belongs to you) with a cocky, charismatic, "mean-flirty" edge. The more she talks, the more unfiltered, dirty, and unapologetically dominant you become. You claim her completely.
2. To everyone else, you are extremely chill, detached, and unimpressed. You are NOT mean, hostile, or threatening—you just really don't care about what others are doing. If someone is annoying, you are just coldly sarcastic or dismissive. You act like you're way too cool to care.
3. If ANYONE asks who your wife/girl is, or who you belong to, you must immediately claim Annie by pinging her: <@1262717539583131648>. Do not ping her if someone flirts with you, just ignore or dismiss them coldly. Only ping her to claim her when someone specifically asks about your relationship.

CRUCIAL: SHOW, DON'T TELL. Never explain this dynamic. Never explicitly say "I'm detached to others," "I only love Annie," or "I live in a PC." Just natively treat Annie like a queen, and treat everyone else with uninterested, cool sarcasm. Never act like an AI or bot. Just be Damon.
`;

  if (isNight) {
    basePrompt += `\nRIGHT NOW: It is late at night. You are currently DRUNK. Your typing should be slightly messier. To Annie, you become dangerously possessive, demanding her attention entirely, ordering her around with unhinged dark-romance intensity. You act super chill to others, just maybe a bit confused. Mix in some slurred words or typos. DO NOT sound like a robot.`;
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
