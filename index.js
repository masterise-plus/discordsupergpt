// Imports
import dotenv from 'dotenv'; dotenv.config();
import { ChatGPTAPI } from 'chatgpt';
import Keyv from 'keyv';
import http from 'http';
import axios from 'axios';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import admin from 'firebase-admin';
import KeyvFirestore from 'keyv-firestore';
import {
  Client, REST, Partials,
  GatewayIntentBits, Routes,
  ActivityType, ChannelType
}
  from 'discord.js';

// Import Firebase Admin SDK Service Account Private Key
import firebaseServiceAccount from './firebaseServiceAccountKey.json' assert {type: 'json'}

// Defines
const activity = '/ask anything'

// Discord Slash Commands Defines
const commands = [
  {
    name: 'ask',
    description: 'Ask Anything!',
    dm_permission: false,
    options: [
      {
        name: "question",
        description: "Your question",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: 'ping',
    description: 'Check Status Bot & Latency'
  },
  {
    name: 'reset-chat',
    description: 'Reset dan Mulai Chat Baru'
  },
  {
    name: 'help',
    description: 'Tolong....'
  }
];

// Initialize OpenAI Session
async function initOpenAI(messageStore) {
  if (process.env.API_ENDPOINT.toLocaleLowerCase() === 'default') {
    const api = new ChatGPTAPI({
      apiKey: process.env.OPENAI_API_KEY,
      completionParams: {
        model: process.env.MODEL,
      },
      messageStore,
      debug: process.env.DEBUG
    });
    return api;
  } else {
    const api = new ChatGPTAPI({
      apiKey: process.env.OPENAI_API_KEY,
      apiBaseUrl: process.env.API_ENDPOINT.toLocaleLowerCase(),
      completionParams: {
        model: process.env.MODEL,
      },
      messageStore,
      debug: process.env.DEBUG
    });
    return api;
  }
}

// Initialize Discord Application Commands & New ChatGPT Thread
async function initDiscordCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);
  try {
    console.log('Started refreshing application commands (/)');
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands }).then(() => {
      console.log('Successfully reloaded application commands (/)');
    }).catch(e => console.log(chalk.red(e)));
    console.log('Connecting to Discord Gateway...');
  } catch (error) {
    console.log(chalk.red(error));
  }
}

async function initFirebaseAdmin() {
  admin.initializeApp({
    credential: admin.credential.cert(firebaseServiceAccount),
    databaseURL: `https://${firebaseServiceAccount.project_id}.firebaseio.com`
  });
  const db = admin.firestore();
  return db;
}

async function initKeyvFirestore() {
  const messageStore = new Keyv({
    store: new KeyvFirestore({
      projectId: firebaseServiceAccount.project_id,
      collection: 'messageStore',
      credentials: firebaseServiceAccount
    })
  });
  return messageStore;
}

// Main Function (Execution Starts From Here)
async function main() {
  if (process.env.UWU === 'true') {
    console.log(gradient.pastel.multiline(figlet.textSync('ChatGPT', {
      font: 'Univers',
      horizontalLayout: 'default',
      verticalLayout: 'default',
      width: 100,
      whitespaceBreak: true
    })));
  }

  const db = await initFirebaseAdmin();

  const messageStore = await initKeyvFirestore();

  const api = await initOpenAI(messageStore).catch(error => {
    console.error(error);
    process.exit();
  });

  await initDiscordCommands().catch(e => { console.log(e) });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildIntegrations,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.DirectMessageTyping,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel]
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch(e => console.log(chalk.red(e)));

  client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    console.log(chalk.greenBright('Connected to Discord Gateway'));
    console.log(new Date())
    client.user.setStatus('online');
    client.user.setActivity(activity);
  });

  // Channel Message Handler
  client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    client.user.setActivity(interaction.user.tag, { type: ActivityType.Watching });

    switch (interaction.commandName) {
      case "ask":
        ask_Interaction_Handler(interaction);
        break;
      case "ping":
        ping_Interaction_Handler(interaction);
        break;
      case "help":
        help_Interaction_Handler(interaction);
        break;
      case 'reset-chat':
        reset_chat_Interaction_Handler(interaction);
        break;
      default:
        await interaction.reply({ content: 'Command Not Found' });
    }
  });

  // Direct Message Handler
  client.on("messageCreate", async message => {
    if (process.env.DIRECT_MESSAGES !== "true" || message.channel.type != ChannelType.DM || message.author.bot) {
      return;
    }

    if (!process.env.DM_WHITELIST_ID.includes(message.author.id)) {
      await message.author.send("Ask Bot Owner To WhiteList Your ID 🙄");
      const timeStamp = new Date();
      const date = timeStamp.getUTCDate().toString() + '.' + timeStamp.getUTCMonth().toString() + '.' + timeStamp.getUTCFullYear().toString();
      const time = timeStamp.getUTCHours().toString() + ':' + timeStamp.getUTCMinutes().toString() + ':' + timeStamp.getUTCSeconds().toString();
      await db.collection('unauthorized-dm-log').doc(message.author.id)
        .collection(date).doc(time).set({
          timeStamp: new Date(),
          userId: message.author.id,
          user: message.author.tag,
          question: message.content,
          bot: message.author.bot
        });
      return;
    }

    console.log("----------Direct Message---------");
    console.log("Date & Time : " + new Date());
    console.log("UserId      : " + message.author.id);
    console.log("User        : " + message.author.tag);
    console.log("Question    : " + message.content);

    try {
      let sentMessage = await message.author.send("Bentar, Mikir dulu ya... 🤔");

      let interaction = {
        "user": {
          "id": message.author.id,
          'tag': message.author.tag
        }
      }

      askQuestion(message.content, interaction, async (response) => {
        if (!response.text) {
          if (response.length >= process.env.DISCORD_MAX_RESPONSE_LENGTH) {
            splitAndSendResponse(response, message.author)
          } else {
            await sentMessage.edit(`API Error ❌\n\`\`\`\n${response}\n\`\`\`\n</>`)
          }
          return;
        }

        if (response.text.length >= process.env.DISCORD_MAX_RESPONSE_LENGTH) {
          splitAndSendResponse(response.text, message.author)
        } else {
          await sentMessage.edit(response.text)
        }
        console.log("Response    : " + response.text);
        console.log("---------------End---------------");
        const timeStamp = new Date();
        const date = timeStamp.getUTCDate().toString() + '.' + timeStamp.getUTCMonth().toString() + '.' + timeStamp.getUTCFullYear().toString();
        const time = timeStamp.getUTCHours().toString() + ':' + timeStamp.getUTCMinutes().toString() + ':' + timeStamp.getUTCSeconds().toString();
        await db.collection('dm-history').doc(message.author.id)
          .collection(date).doc(time).set({
            timeStamp: new Date(),
            userId: message.author.id,
            user: message.author.tag,
            question: message.content,
            answer: response.text,
            parentMessageId: response.id
          });
      })
    } catch (e) {
      console.error(e)
    }
  })

  async function ping_Interaction_Handler(interaction) {
    const sent = await interaction.reply({ content: 'Pinging...🌐', fetchReply: true });
    await interaction.editReply(`Websocket Heartbeat: ${interaction.client.ws.ping} ms. \nRoundtrip Latency: ${sent.createdTimestamp - interaction.createdTimestamp} ms\n</>`);
    client.user.setActivity(activity);
  }

  async function help_Interaction_Handler(interaction) {
    await interaction.reply("**Board AI**\nDiscord Bot Meet OpenAI's ChatGPT !\n\n**Usage:**\nDM - Tanya Apa Aja via DM\n`/ask` - Tanya apa aja\n`/reset-chat` - Reset dan mulai chat baru\n`/ping` - Check Status & Latency Bot");
    client.user.setActivity(activity);
  }

  async function reset_chat_Interaction_Handler(interaction) {
    const timeStamp = new Date();
    const date = timeStamp.getUTCDate().toString() + '.' + timeStamp.getUTCMonth().toString() + '.' + timeStamp.getUTCFullYear().toString();
    const time = timeStamp.getUTCHours().toString() + ':' + timeStamp.getUTCMinutes().toString() + ':' + timeStamp.getUTCSeconds().toString();
    await interaction.reply('Checking...📚');
    const doc = await db.collection('users').doc(interaction.user.id).get();
    if (!doc.exists) {
      console.log('Failed: No Conversation Found ❌');
      await interaction.editReply('No Conversation Found ❌\nUse `/ask` To Start One\n</>');
      await db.collection('reset-chat-log').doc(interaction.user.id)
        .collection(date).doc(time).set({
          timeStamp: new Date(),
          userID: interaction.user.id,
          user: interaction.user.tag,
          resetChatSuccess: 0
        });
    } else {
      await db.collection('users').doc(interaction.user.id).delete();
      console.log('Chat Reset: Successful ✅');
      await interaction.editReply('Chat Reset: Successful ✅\n</>');
      await db.collection('reset-chat-log').doc(interaction.user.id)
        .collection(date).doc(time).set({
          timeStamp: new Date(),
          userID: interaction.user.id,
          user: interaction.user.tag,
          resetChatSuccess: 1
        });
    }

    client.user.setActivity(activity);
  }

  async function ask_Interaction_Handler(interaction) {
    const question = interaction.options.getString("question");

    console.log("----------Channel Message--------");
    console.log("Date & Time : " + new Date());
    console.log("UserId      : " + interaction.user.id);
    console.log("User        : " + interaction.user.tag);
    console.log("Question    : " + question);

    try {
      await interaction.reply({ content: `Bentar, mikir dulu ya... 🤔` });
      askQuestion(question, interaction, async (content) => {
        if (!content.text) {
          if (content.length >= process.env.DISCORD_MAX_RESPONSE_LENGTH) {
            await interaction.editReply(`**${interaction.user.tag}:** ${question}\n**${client.user.username}:** API Error ❌\nCheck DM For Error Log ❗\n</>`);
            splitAndSendResponse(content, interaction.user);
          } else {
            await interaction.editReply(`**${interaction.user.tag}:** ${question}\n**${client.user.username}:** API Error ❌\n\`\`\`\n${content}\n\`\`\`\n</>`);
          }
          client.user.setActivity(activity);
          return;
        }

        console.log("Response    : " + content.text);
        console.log("---------------End---------------");

        if (content.text.length >= process.env.DISCORD_MAX_RESPONSE_LENGTH) {
          await interaction.editReply({ content: "Jawabannya banyak nihhh 🤯,\n Aku kirim lewat DM ya... 😅" });
          splitAndSendResponse(content.text, interaction.user);
        } else {
          await interaction.editReply(`${content.text}\n`);
        }
        //**${interaction.user.tag}:** ${question}\n**${client.user.username}:**
        client.user.setActivity(activity);
        const timeStamp = new Date();
        const date = timeStamp.getUTCDate().toString() + '.' + timeStamp.getUTCMonth().toString() + '.' + timeStamp.getUTCFullYear().toString();
        const time = timeStamp.getUTCHours().toString() + ':' + timeStamp.getUTCMinutes().toString() + ':' + timeStamp.getUTCSeconds().toString();
        await db.collection('chat-history').doc(interaction.user.id)
          .collection(date).doc(time).set({
            timeStamp: new Date(),
            userID: interaction.user.id,
            user: interaction.user.tag,
            question: question,
            answer: content.text,
            parentMessageId: content.id
          });
      })
    } catch (e) {
      console.error(chalk.red(e));
    }
  }

  async function askQuestion(question, interaction, cb) {
    const doc = await db.collection('users').doc(interaction.user.id).get();
    const currentDate = new Date().toISOString();
    const finalSystemMessage = process.env.SYSTEM_MESSAGE + ` Your Knowledge cutoff is 2021-09-01 and Current Date is ${currentDate}.`

    if (!doc.exists) {
      api.sendMessage(question, {
        systemMessage: finalSystemMessage
      }).then((response) => {
        db.collection('users').doc(interaction.user.id).set({
          timeStamp: new Date(),
          userId: interaction.user.id,
          user: interaction.user.tag,
          parentMessageId: response.id
        });
        cb(response);
      }).catch((err) => {
        cb(err);
        console.log(chalk.red("AskQuestion Error:" + err));
      })
    } else {
      api.sendMessage(question, {
        parentMessageId: doc.data().parentMessageId,
        systemMessage: finalSystemMessage
      }).then((response) => {
        db.collection('users').doc(interaction.user.id).set({
          timeStamp: new Date(),
          userId: interaction.user.id,
          user: interaction.user.tag,
          parentMessageId: response.id
        });
        cb(response);
      }).catch((err) => {
        cb(err);
        console.log(chalk.red("AskQuestion Error:" + err));
      });
    }
  }

  async function splitAndSendResponse(resp, user) {
    while (resp.length > 0) {
      let end = Math.min(process.env.DISCORD_MAX_RESPONSE_LENGTH, resp.length)
      await user.send(resp.slice(0, end))
      resp = resp.slice(end, resp.length)
    }
  }
}

// HTTP Server
if (process.env.HTTP_SERVER == true) {
  http.createServer((req, res) => res.end('BOT Is Up && Running..!!')).listen(process.env.PORT);
}

// Discord Rate Limit Check
setInterval(() => {
  axios
    .get('https://discord.com/api/v10')
    .catch(error => {
      if (error.response.status == 429) {
        console.log("Discord Rate Limited");
        console.warn("Status: " + error.response.status)
        console.warn(error)
        // TODO: Take Action (e.g. Change IP Address)
      }
    });

}, 30000); // Check Every 30 Second

main() // Call Main function

// ---EoC---