const express = require('express');
const path = require('path');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const app = express();

// 렌더 경로 에러(Not Found) 방지
app.use(express.static(path.join(__dirname, 'public')));

// 환경 변수 연동
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const BACKUP_GUILD_ID = process.env.BACKUP_GUILD_ID;
const REDIRECT_URI = process.env.REDIRECT_URI; 

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildInvites
    ]
});

const invitesTracker = new Map();

client.on('ready', async () => {
    console.log(`[봇 로그인 완료] ${client.user.tag}`);

    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) {
        try {
            const firstInvites = await guild.invites.fetch();
            invitesTracker.set(guild.id, firstInvites);

            const channel = await client.channels.fetch(VERIFY_CHANNEL_ID).catch(() => null);
            if (channel) {
                const verifyUrl = process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';

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

        const logChannel = member.guild.channels.cache.get(LOG_CHANNEL_ID);
        let logText = usedInvite 
            ? `📥 **${member.user.tag}** 님 입장! (초대한 사람: **${usedInvite.inviter ? usedInvite.inviter.tag : '알 수 없음'}**)`
            : `📥 **${member.user.tag}** 님 입장!`;

        console.log(logText);
        if (logChannel) await logChannel.send(logText);
    } catch (err) {
        console.error('입장 로그 에러:', err);
    }
});

// 1. 인증 시작 (공유서버 IP 문제 해결: 진짜 유저 IP만 다이렉트 추출)
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

    const stateData = Buffer.from(JSON.stringify({ ip: userIp, roles: selectedRoles })).toString('base64');
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20email%20guilds%20guilds.join&state=${stateData}`;
    
    res.redirect(oauthUrl);
});

// 2. 콜백 처리
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    let userIp = '알 수 없음';
    let selectedRoles = [];
    try {
        if (state) {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            userIp = decodedState.ip;
            selectedRoles = decodedState.roles || [];
        }
    } catch (e) {}

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        const userData = userRes.data;

        console.log(`[인증 성공] ${userData.username} (${userData.email}) / IP: ${userIp}`);

        await axios.post(WEBHOOK_URL, {
            content: `✅ **[인증 완료]**\n👤 **유저명:** \`${userData.username}\` (${userData.id})\n📧 **이메일:** \`${userData.email}\`\n🌐 **공인 IP:** \`${userIp}\`\n📢 **선택한 역할 개수:** \`${selectedRoles.length}개\``
        }).catch(() => {});

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userData.id);

        if (member) {
            const rolesToAdd = [VERIFIED_ROLE_ID, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (BACKUP_GUILD_ID) {
                try {
                    await axios.put(`https://discord.com/api/v10/guilds/${BACKUP_GUILD_ID}/members/${userData.id}`, {
                        access_token: accessToken
                    }, {
                        headers: {
                            Authorization: `Bot ${BOT_TOKEN}`,
                            'Content-Type': 'application/json'
                        }
                    });
                } catch (backupErr) {}
            }

            console.log(`[역할 지급 완료] ${userData.username}님에게 역할 지급 완료!`);
            res.send(`<h1>인증 성공!</h1><p>${userData.username}님, 인증이 완료되었습니다. 디스코드 서버로 돌아가세요!</p>`);
        } else {
            res.send('인증은 성공했으나, 현재 서버에 가입되어 있지 않습니다.');
        }

    } catch (err) {
        console.error('에러 발생:', err.response?.data || err.message);
        res.status(500).send('인증 처리 중 오류가 발생했습니다.');
    }
});

client.login(BOT_TOKEN);
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[웹서버 작동 중] 포트: ${PORT}`);
});
