const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');

const MUTED_USERS_FILE = path.join(__dirname, '../data/muted_users.json');

function getMutedUsers() {
    if (!fs.existsSync(MUTED_USERS_FILE)) {
        if (!fs.existsSync(path.dirname(MUTED_USERS_FILE))) fs.mkdirSync(path.dirname(MUTED_USERS_FILE), { recursive: true });
        fs.writeFileSync(MUTED_USERS_FILE, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(MUTED_USERS_FILE));
}

function saveMutedUsers(data) {
    fs.writeFileSync(MUTED_USERS_FILE, JSON.stringify(data, null, 2));
}

async function muteUserCommand(sock, chatId, senderId, mentionedJids, message) {
    if (!chatId.endsWith('@g.us')) {
        return sock.sendMessage(chatId, { text: '❌ Comando solo para grupos.' });
    }

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isBotAdmin) return sock.sendMessage(chatId, { text: '❌ Necesito ser administrador.' });
    if (!isSenderAdmin) return sock.sendMessage(chatId, { text: '❌ Solo para administradores.' });

    let userToMute;
    if (mentionedJids && mentionedJids.length > 0) {
        userToMute = mentionedJids[0];
    } else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToMute = message.message.extendedTextMessage.contextInfo.participant;
    }

    if (!userToMute) {
        return sock.sendMessage(chatId, { text: '❌ Menciona al usuario o responde a su mensaje para silenciarlo.' });
    }

    const data = getMutedUsers();
    if (!data[chatId]) data[chatId] = [];
    
    if (data[chatId].includes(userToMute)) {
        return sock.sendMessage(chatId, { text: '⚠️ Ese usuario ya está silenciado en este grupo.' });
    }

    data[chatId].push(userToMute);
    saveMutedUsers(data);

    await sock.sendMessage(chatId, { text: `✅ El usuario @${userToMute.split('@')[0]} ha sido silenciado. Sus mensajes serán eliminados.`, mentions: [userToMute] });
}

async function unmuteUserCommand(sock, chatId, senderId, mentionedJids, message) {
    if (!chatId.endsWith('@g.us')) return;

    const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isSenderAdmin) return sock.sendMessage(chatId, { text: '❌ Solo para administradores.' });

    let userToUnmute;
    if (mentionedJids && mentionedJids.length > 0) {
        userToUnmute = mentionedJids[0];
    } else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToUnmute = message.message.extendedTextMessage.contextInfo.participant;
    }

    if (!userToUnmute) {
        return sock.sendMessage(chatId, { text: '❌ Menciona al usuario o responde a su mensaje.' });
    }

    const data = getMutedUsers();
    if (!data[chatId] || !data[chatId].includes(userToUnmute)) {
        return sock.sendMessage(chatId, { text: '⚠️ Ese usuario no está silenciado.' });
    }

    data[chatId] = data[chatId].filter(id => id !== userToUnmute);
    saveMutedUsers(data);

    await sock.sendMessage(chatId, { text: `✅ El usuario @${userToUnmute.split('@')[0]} ha sido des-silenciado.`, mentions: [userToUnmute] });
}

function isUserMuted(chatId, userId) {
    try {
        const data = getMutedUsers();
        return data[chatId] && data[chatId].includes(userId);
    } catch (e) {
        return false;
    }
}

module.exports = { muteUserCommand, unmuteUserCommand, isUserMuted };
