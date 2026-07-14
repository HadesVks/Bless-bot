const fs = require('fs');
const path = require('path');
const isAdmin = require('../lib/isAdmin');

const BLACKLIST_FILE = path.join(__dirname, '../data/blacklist.json');

function getBlacklist() {
    if (!fs.existsSync(BLACKLIST_FILE)) {
        if (!fs.existsSync(path.dirname(BLACKLIST_FILE))) fs.mkdirSync(path.dirname(BLACKLIST_FILE), { recursive: true });
        fs.writeFileSync(BLACKLIST_FILE, JSON.stringify({}));
    }
    return JSON.parse(fs.readFileSync(BLACKLIST_FILE));
}

function saveBlacklist(data) {
    fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(data, null, 2));
}

async function blacklistCommand(sock, chatId, senderId, mentionedJids, message) {
    if (!chatId.endsWith('@g.us')) return;

    const { isSenderAdmin, isBotAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isBotAdmin) return sock.sendMessage(chatId, { text: '❌ Necesito ser administrador para banear permanentemente.' });
    if (!isSenderAdmin) return sock.sendMessage(chatId, { text: '❌ Solo administradores.' });

    let userToBan;
    if (mentionedJids && mentionedJids.length > 0) {
        userToBan = mentionedJids[0];
    } else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToBan = message.message.extendedTextMessage.contextInfo.participant;
    }

    if (!userToBan) {
        return sock.sendMessage(chatId, { text: '❌ Menciona al usuario o responde a su mensaje para un ban permanente.' });
    }

    const data = getBlacklist();
    if (!data[chatId]) data[chatId] = [];
    
    if (data[chatId].includes(userToBan)) {
        return sock.sendMessage(chatId, { text: '⚠️ Este usuario ya está en la lista negra del grupo.' });
    }

    data[chatId].push(userToBan);
    saveBlacklist(data);

    await sock.groupParticipantsUpdate(chatId, [userToBan], "remove");
    await sock.sendMessage(chatId, { text: `⛔ El usuario @${userToBan.split('@')[0]} ha sido expulsado y añadido a la lista negra. No podrá volver a unirse.`, mentions: [userToBan] });
}

async function unblacklistCommand(sock, chatId, senderId, mentionedJids, message) {
    if (!chatId.endsWith('@g.us')) return;

    const { isSenderAdmin } = await isAdmin(sock, chatId, senderId);
    if (!isSenderAdmin) return sock.sendMessage(chatId, { text: '❌ Solo administradores.' });

    let userToUnban;
    if (mentionedJids && mentionedJids.length > 0) {
        userToUnban = mentionedJids[0];
    } else if (message.message?.extendedTextMessage?.contextInfo?.participant) {
        userToUnban = message.message.extendedTextMessage.contextInfo.participant;
    }

    if (!userToUnban) {
        return sock.sendMessage(chatId, { text: '❌ Menciona al usuario o responde a su mensaje para quitar el ban permanente.' });
    }

    const data = getBlacklist();
    if (!data[chatId] || !data[chatId].includes(userToUnban)) {
        return sock.sendMessage(chatId, { text: '⚠️ Ese usuario no está en la lista negra.' });
    }

    data[chatId] = data[chatId].filter(id => id !== userToUnban);
    saveBlacklist(data);

    await sock.sendMessage(chatId, { text: `✅ El usuario @${userToUnban.split('@')[0]} ha sido removido de la lista negra.`, mentions: [userToUnban] });
}

async function checkBlacklistOnJoin(sock, update) {
    const { id, participants, action } = update;
    if (action !== 'add') return;

    const data = getBlacklist();
    if (!data[id]) return;

    for (let participant of participants) {
        if (data[id].includes(participant)) {
            console.log(`Banning blacklisted user ${participant} from group ${id}`);
            await sock.sendMessage(id, { text: `🚫 El usuario @${participant.split('@')[0]} intentó unirse pero está en la lista negra. Expulsando...`, mentions: [participant] });
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sock.groupParticipantsUpdate(id, [participant], "remove");
        }
    }
}

module.exports = { blacklistCommand, unblacklistCommand, checkBlacklistOnJoin };
