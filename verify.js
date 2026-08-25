const express = require('express');
const path = require('path');
const axios = require('axios');
const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BACKUP_GUILD_ID = process.env.BACKUP_GUILD_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1541577356513382560'; 

// 유저 토큰을 담아둘 메모리 맵
const userAccessTokenMap = new Map();

// 네가 알려준 디스코드 유저 ID
const ADMIN_USER_ID = '1400805500374745122';

const FIXED_RENDER_URL = 'https://discord-verify1-524a.onrender.com';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const invitesTracker = new Map();
const memberInviterIdMap = new Map();

client.on('ready', async () => {
    console.log(`[봇 로그인 완료] ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesTracker.set(guild.id, firstInvites);

            const channel = await client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);
            if (channel) {
                const verifyUrl = `${FIXED_RENDER_URL}/verify`;

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setStyle(ButtonStyle.Link)
                            .setLabel('🔒 디스코드 인증하기')
                            .setURL(verifyUrl),
                    );

                await channel.send({
                    content: '서버를 이용하려면 아래 버튼을 눌러 인증을 진행해 주세요!',
                    components: [row]
                });
                console.log('[인증 시스템] 인증 버튼 전송 완료');
            }
        } catch (err) {
            console.error('초기화 중 에러 발생:', err);
        }
    }
});

client.on('inviteCreate', async (invite) => {
    const guildInvites = await invite.guild.invites.fetch();
    invitesTracker.set(invite.guild.id, guildInvites);
});

client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== GUILD_ID) return;

    try {
        const oldInvites = invitesTracker.get(member.guild.id);
        const newInvites = await member.guild.invites.fetch();

        const usedInvite = newInvites.find(inv => {
            const oldInv = oldInvites?.get(inv.code);
            return oldInv && inv.uses > oldInv.uses;
        });

        invitesTracker.set(member.guild.id, newInvites);

        if (usedInvite && usedInvite.inviter) {
            memberInviterIdMap.set(member.id, usedInvite.inviter.id);
        } else {
            memberInviterIdMap.set(member.id, null);
        }
    } catch (err) {
        console.error('초대장 추적 에러:', err);
        memberInviterIdMap.set(member.id, null);
    }
});

client.on('guildMemberRemove', async (member) => {
    if (member.guild.id !== GUILD_ID) return;

    try {
        const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel) {
            const exitText = `📤 **<@${member.id}>** (\`${member.user.username}\`) 님께서 서버를 나가셨습니다.`;
            await logChannel.send(exitText);
        }
        console.log(`[퇴장 감지] ${member.user.tag} 님 퇴장`);
    } catch (err) {
        console.error('퇴장 로그 에러:', err);
    }
});

client.on('messageCreate', async (message) => {
    if (message.guild?.id !== GUILD_ID) return;
    if (message.author.bot) return;

    const content = message.content.trim();

    if (content === '!역할제거') {
        try {
            const member = message.member;
            if (!member) return;

            const removableRoleIds = [
                '1541423418753155135'
            ];

            const rolesToRemove = member.roles.cache.filter(role => removableRoleIds.includes(role.id));

            if (rolesToRemove.size === 0) {
                return message.reply('❌ 제거할 추가 역할이 없습니다.');
            }

            await member.roles.remove(rolesToRemove);
            message.reply('✅ 공지 알림 역할이 성공적으로 제거되었습니다!');
        } catch (err) {
            console.error('역할 제거 명령어 에러:', err);
            message.reply('⚠️ 역할 제거 중 오류가 발생했습니다.');
        }
    }

    if (content === '!서버복구') {
        try {
            const member = message.member;
            if (!member) return;

            if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return message.reply('❌ 인증을 완료한 유저만 복구 서버에 자동 참가할 수 있습니다!');
            }

            if (!BACKUP_GUILD_ID) {
                return message.reply('⚠️ 설정된 백업(복구) 서버가 없습니다.');
            }

            let accessToken = userAccessTokenMap.get(message.author.id);

            if (!accessToken) {
                return message.reply('⚠️ 서버 재시작으로 토큰이 초기화되었습니다. (관리자 DM으로 받은 토큰을 확인해 주세요)');
            }

            await axios.put(`https://discord.com/api/v10/guilds/${BACKUP_GUILD_ID}/members/${message.author.id}`, {
                access_token: accessToken
            }, {
                headers: {
                    Authorization: `Bot ${BOT_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            });

            message.reply('✅ 복구 서버에 성공적으로 자동 참가되었습니다!');
        } catch (err) {
            console.error('서버복구 자동 참가 에러:', err.response?.data || err.message);
            message.reply('⚠️ 복구 서버 자동 참가 중 오류가 발생했습니다.');
        }
    }
});

app.get('/verify', async (req, res) => {
    let userIp = req.headers['x-forwarded-for'] 
        ? req.headers['x-forwarded-for'].split(',')[0].trim() 
        : req.socket.remoteAddress;

    if (!userIp || userIp === '::1' || userIp === '127.0.0.1') {
        userIp = '127.0.0.1';
    }

    try {
        const ipCheckRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,message,proxy,query`);
        
        if (ipCheckRes.data.status === 'success' && ipCheckRes.data.proxy) {
            console.log(`[차단됨] VPN/우회 접속 감지된 IP: ${userIp}`);
            
            await axios.post(WEBHOOK_URL, {
                content: `🛡️ **[인증 차단]** VPN/우회 접속이 감지되어 차단되었습니다!\n🌐 **IP:** \`${userIp}\``
            }).catch(() => {});

            return res.status(403).send(`<h1>인증 실패</h1><p>VPN 또는 우회 접속 환경에서는 인증을 진행할 수 없습니다.</p>`);
        }
    } catch (err) {
        console.error('IP 검사 에러:', err.message);
    }

    let selectedRoles = req.query.roles || [];
    if (!Array.isArray(selectedRoles)) selectedRoles = [selectedRoles];

    const userAgent = req.headers['user-agent'] || '알 수 없음';
    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    const stateData = Buffer.from(JSON.stringify({ ip: userIp, roles: selectedRoles, ua: userAgent })).toString('base64');
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email%20guilds%20guilds.join&state=${stateData}`;
    
    res.redirect(oauthUrl);
});

app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    let userIp = '알 수 없음';
    let selectedRoles = [];
    let userAgent = '알 수 없음';
    try {
        if (state) {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            userIp = decodedState.ip;
            selectedRoles = decodedState.roles || [];
            userAgent = decodedState.ua || '알 수 없음';
        }
    } catch (e) {}

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
(content truncated due to length limitations)
