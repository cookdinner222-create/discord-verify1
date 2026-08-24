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

// 🛠️ 인증 시 제거할 '미인증 역할 ID'를 여기에 입력해주세요! (필요 없으면 빈 칸으로 두셔도 됩니다)
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1541577356513382560'; 

// 디스코드 개발자 포털 Redirects와 100% 일치해야 하는 강제 고정 주소
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

// 유저가 입장할 때 초대한 사람의 ID를 정확히 추적
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

// 🚪 유저가 서버를 나갈 때 퇴장 로그 전송
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

// 💬 명령어 감지: !역할제거 입력 시 추가 선택 역할 제거
client.on('messageCreate', async (message) => {
    if (message.guild?.id !== GUILD_ID) return;
    if (message.author.bot) return;

    if (message.content.trim() === '!역할제거') {
        try {
            const member = message.member;
            if (!member) return;

            const removableRoleIds = [
                '1541423418753155135' // 📢 공지 알림 받기 역할 ID
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
});

// 1. 인증 시작
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

    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    const stateData = Buffer.from(JSON.stringify({ ip: userIp, roles: selectedRoles })).toString('base64');
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email%20guilds%20guilds.join&state=${stateData}`;
    
    res.redirect(oauthUrl);
});

// 2. 콜백 처리
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    if (!code) return res.status(400).send('인증 코드가 없습니다.');

    const redirectUri = `${FIXED_RENDER_URL}/callback`;

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
            redirect_uri: redirectUri,
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        const userData = userRes.data;

        const isPhoneVerified = userData.mfa_enabled ? '✅ 인증됨 (전화번호/2차 보안)' : '❌ 미인증';
        const inviterId = memberInviterIdMap.get(userData.id);
        const inviterMention = inviterId ? `<@${inviterId}>` : '알 수 없음 (링크 또는 봇)';

        console.log(`[인증 성공] ${userData.username} (${userData.email}) / IP: ${userIp}`);

        await axios.post(WEBHOOK_URL, {
            content: `✅ **[인증 완료]**\n👤 **유저:** <@${userData.id}> (\`${userData.username}\`)\n📧 **이메일:** \`${userData.email}\`\n📱 **전화번호/2차인증:** \`${isPhoneVerified}\`\n👥 **초대한 사람:** ${inviterMention}\n🌐 **공인 IP:** \`${userIp}\`\n📢 **선택한 역할 개수:** \`${selectedRoles.length}개\``
        }).catch(() => {});

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userData.id);

        if (member) {
            // 🛠️ 지급할 역할 목록 (기본 인증 + 선택 역할)
            const rolesToAdd = [VERIFIED_ROLE_ID, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            // 🛠️ 인증 완료 시 미인증 역할이 설정되어 있다면 제거
            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

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

            console.log(`[역할 처리 완료] ${userData.username}님 인증 완료 및 역할 지급/제거 완료!`);
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
