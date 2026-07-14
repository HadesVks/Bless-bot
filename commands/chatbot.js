const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const settings = require('../settings');
const store = require('../lib/lightweight_store');

const USER_GROUP_DATA = path.join(__dirname, '../data/userGroupData.json');

// Load user group data
function loadUserGroupData() {
    try {
        if (!fs.existsSync(path.dirname(USER_GROUP_DATA))) {
            fs.mkdirSync(path.dirname(USER_GROUP_DATA), { recursive: true });
        }
        if (!fs.existsSync(USER_GROUP_DATA)) {
            fs.writeFileSync(USER_GROUP_DATA, JSON.stringify({ groups: [], chatbot: {} }));
        }
        return JSON.parse(fs.readFileSync(USER_GROUP_DATA));
    } catch (error) {
        console.error('❌ Error loading user group data:', error.message);
        return { groups: [], chatbot: {} };
    }
}

// Save user group data
function saveUserGroupData(data) {
    try {
        fs.writeFileSync(USER_GROUP_DATA, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('❌ Error saving user group data:', error.message);
    }
}

// Typing indicator delay
function getRandomDelay() {
    return Math.floor(Math.random() * 2000) + 1000;
}

async function showTyping(sock, chatId) {
    try {
        await sock.presenceSubscribe(chatId);
        await sock.sendPresenceUpdate('composing', chatId);
        await new Promise(resolve => setTimeout(resolve, getRandomDelay()));
    } catch (error) {
        console.error('Typing indicator error:', error);
    }
}

// Command handler for turning chatbot ON/OFF
async function handleChatbotCommand(sock, chatId, message, match) {
    if (!match) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: `*CONFIGURACIÓN DE CHATBOT*\n\n*.chatbot on*\nActiva el chatbot en este grupo\n\n*.chatbot off*\nDesactiva el chatbot en este grupo`,
            quoted: message
        });
    }

    const data = loadUserGroupData();
    const botNumber = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const senderId = message.key.participant || message.participant || message.pushName || message.key.remoteJid;
    const isOwner = senderId === botNumber || senderId.includes(settings.ownerNumber);

    let isAdmin = false;
    if (chatId.endsWith('@g.us')) {
        try {
            const groupMetadata = await sock.groupMetadata(chatId);
            isAdmin = groupMetadata.participants.some(p => p.id === senderId && (p.admin === 'admin' || p.admin === 'superadmin'));
        } catch (e) {
            console.warn('⚠️ Could not fetch group metadata.');
        }
    }

    if (!isAdmin && !isOwner) {
        await showTyping(sock, chatId);
        return sock.sendMessage(chatId, {
            text: '❌ Solo los administradores del grupo pueden usar este comando.',
            quoted: message
        });
    }

    if (match === 'on') {
        await showTyping(sock, chatId);
        if (data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { text: '*El chatbot ya está activado en este grupo.*', quoted: message });
        }
        data.chatbot[chatId] = true;
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: '*✅ Chatbot activado. Mencióname o escribe .ai para hablar conmigo.*', quoted: message });
    }

    if (match === 'off') {
        await showTyping(sock, chatId);
        if (!data.chatbot[chatId]) {
            return sock.sendMessage(chatId, { text: '*El chatbot ya está desactivado en este grupo.*', quoted: message });
        }
        delete data.chatbot[chatId];
        saveUserGroupData(data);
        return sock.sendMessage(chatId, { text: '*❌ Chatbot desactivado para este grupo.*', quoted: message });
    }

    await showTyping(sock, chatId);
    return sock.sendMessage(chatId, { 
        text: '*Comando inválido. Usa .chatbot on / off*',
        quoted: message
    });
}

// Logic to respond automatically if mentioned or replied
async function handleChatbotResponse(sock, chatId, message, userMessage, senderId) {
    const data = loadUserGroupData();
    if (!data.chatbot[chatId]) return;

    try {
        const botId = sock.user.id;
        const botNumber = botId.split(':')[0];
        const botJids = [
            botId,
            `${botNumber}@s.whatsapp.net`,
            `${botNumber}@whatsapp.net`,
            sock.user.lid
        ];

        let isBotMentioned = false;
        let isReplyToBot = false;

        // Check if message is a reply to the bot or mentions the bot
        if (message.message?.extendedTextMessage) {
            const mentionedJid = message.message.extendedTextMessage.contextInfo?.mentionedJid || [];
            const quotedParticipant = message.message.extendedTextMessage.contextInfo?.participant;
            
            isBotMentioned = mentionedJid.some(jid => {
                const jidNum = jid.split('@')[0].split(':')[0];
                return botJids.some(bJid => bJid && bJid.split('@')[0].split(':')[0] === jidNum);
            });
            
            if (quotedParticipant) {
                const cleanQuoted = quotedParticipant.replace(/[:@].*$/, '');
                isReplyToBot = botJids.some(bJid => bJid && bJid.replace(/[:@].*$/, '') === cleanQuoted);
            }
        } else if (message.message?.conversation) {
            isBotMentioned = userMessage.includes(`@${botNumber}`);
        }

        // If the user used the direct command .ai or .bot, we bypass the mention check
        const isAiCommand = userMessage.trim().startsWith('.ai') || userMessage.trim().startsWith('.bot');

        if (!isBotMentioned && !isReplyToBot && !isAiCommand) return;

        let cleanedMessage = userMessage;
        if (isBotMentioned) {
            cleanedMessage = cleanedMessage.replace(new RegExp(`@${botNumber}`, 'g'), '').trim();
        }
        if (isAiCommand) {
            cleanedMessage = cleanedMessage.replace(/^\.(ai|bot)\b/i, '').trim();
        }

        if (!cleanedMessage) return; // Empty message

        await showTyping(sock, chatId);

        // Retrieve group chat history from lightweight_store
        let chatContext = [];
        if (store.messages[chatId]) {
            // Get the last N messages
            const limit = settings.maxStoreMessages || 100;
            const history = store.messages[chatId].slice(-limit);
            
            for (let msg of history) {
                // Ignore system messages or messages without content
                const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption;
                if (!text) continue;
                
                const participant = msg.key.participant || msg.key.remoteJid;
                const isFromMe = msg.key.fromMe;
                
                let role = isFromMe ? 'assistant' : 'user';
                let content = text;
                
                // If it's a user message, prepend their number to help the AI identify who is talking
                if (role === 'user') {
                    const number = participant.split('@')[0].split(':')[0];
                    content = `[Usuario ${number}]: ${text}`;
                }
                
                chatContext.push({ role, content });
            }
        }

        // Make sure the current message is the last one if it's not already in store
        const currentMsgText = `[Usuario ${senderId.split('@')[0]}]: ${cleanedMessage}`;
        if (chatContext.length === 0 || chatContext[chatContext.length - 1].content !== currentMsgText) {
            chatContext.push({ role: 'user', content: currentMsgText });
        }

        // Format for Local AI
        const systemPrompt = {
            role: 'system',
            content: settings.aiPersonality || 'Eres BlessBot, un integrante más del grupo. Respondes de forma amigable y concisa.'
        };

        const aiMessages = [systemPrompt, ...chatContext];

        const response = await getLocalAIResponse(aiMessages);

        if (!response) {
            await sock.sendMessage(chatId, { text: "Uhm... 🤔 no sé qué decirte ahora mismo. Intenta luego.", quoted: message });
            return;
        }

        await sock.sendMessage(chatId, { text: response }, { quoted: message });

    } catch (error) {
        console.error('❌ Error in local AI chatbot response:', error.message);
        try {
            await sock.sendMessage(chatId, { text: "😅 Ups, mi cerebro hizo cortocircuito. Intenta de nuevo.", quoted: message });
        } catch (e) {}
    }
}

async function getLocalAIResponse(messages) {
    try {
        const payload = {
            model: settings.aiModel || 'llama3',
            messages: messages,
            temperature: 0.8,
            max_tokens: 150
        };

        const response = await fetch(settings.aiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`API error: ${response.statusText}`);
        
        const data = await response.json();
        if (data.choices && data.choices.length > 0) {
            return data.choices[0].message.content.trim();
        }
        return null;
    } catch (error) {
        console.error("Local AI API error:", error);
        return null;
    }
}

module.exports = {
    handleChatbotCommand,
    handleChatbotResponse
};