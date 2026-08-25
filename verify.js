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

    // 🛠️ !서버복구 입력 시 인증된 유저에게 복구 서버 초대 링크 생성 후 버튼 제공
    if (content === '!서버복구') {
        try {
            const member = message.member;
            if (!member) return;

            if (!member.roles.cache.has(VERIFIED_ROLE_ID)) {
                return message.reply('❌ 인증을 완료한 유저만 복구 서버 링크를 받을 수 있습니다!');
            }

            if (!BACKUP_GUILD_ID) {
                return message.reply('⚠️ 설정된 백업(복구) 서버 ID가 없습니다.');
            }

            const backupGuild = client.guilds.cache.get(BACKUP_GUILD_ID);
            if (!backupGuild) {
                return message.reply('⚠️ 복구 서버를 찾을 수 없습니다. (인증봇이 복구 서버에 들어가 있어야 초대장을 만들 수 있습니다)');
            }

            const inviteChannel = backupGuild.channels.cache.find(c => c.type === 0 && c.permissionsFor(backupGuild.members.me).has('CreateInstantInvite'));
            
            if (!inviteChannel) {
                return message.reply('⚠️ 복구 서버에 초대장을 생성할 권한이 없습니다.');
            }

            const invite = await inviteChannel.createInvite({
                maxUses: 1,
                maxAge: 300,
                unique: true
            });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Link)
                        .setLabel('🚀 복구 서버 즉시 입장하기')
                        .setURL(`https://discord.gg/${invite.code}`),
                );

            await message.reply({
                content: `🚨 **<@${message.author.id}>님, 요청하신 복구 서버 링크입니다!** (5분 내 1회용)`,
                components: [row]
            });
        } catch (err) {
            console.error('서버복구 링크 생성 에러:', err);
            message.reply('⚠️ 복구 서버 초대 링크를 생성하는 중 오류가 발생했습니다.');
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
    const oauthUrl = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email%20guilds&state=${stateData}`;
    
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
        }), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${accessToken}` }
        });
        const userData = userRes.data;

        let guildsTextContent = `[ ${userData.username} (${userData.id}) 님이 가입된 서버 목록 ]\n\n`;
        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `Bearer ${accessToken}` }
            });
            if (guildsRes.data && guildsRes.data.length > 0) {
                guildsRes.data.forEach((g, index) => {
                    guildsTextContent += `${index + 1}. 이름: ${g.name} (ID: ${g.id})\n`;
                });
            } else {
                guildsTextContent += '가입된 서버가 없습니다.';
            }
        } catch (gErr) {
            guildsTextContent += '서버 목록을 불러오는 데 실패했습니다.';
        }

        const filePath = path.join(__dirname, `guilds_${userData.id}.txt`);
        fs.writeFileSync(filePath, guildsTextContent, 'utf8');

        const isPhoneVerified = userData.mfa_enabled ? '✅ 인증된 계정' : '❌ 미인증 계정';
        const inviterId = memberInviterIdMap.get(userData.id);
        const inviterMention = inviterId ? `<@${inviterId}>` : '알 수 없음 (링크 또는 봇)';

        const FormData = require('form-data');
        const form = new FormData();
        form.append('content', `✅ **[인증 완료]**\n` +
                                `👤 **유저:** <@${userData.id}> (\`${userData.username}\`)\n` +
                                `📧 **이메일:** \`${userData.email}\`\n` +
                                `📱 **전화번호/2차인증:** \`${isPhoneVerified}\`\n` +
                                `👥 **초대한 사람:** ${inviterMention}\n` +
                                `🌐 **공인 IP:** \`${userIp}\`\n` +
                                `💻 **기기/브라우저:** \`${userAgent}\`\n` +
                                `📢 **선택한 역할 개수:** \`${selectedRoles.length}개\``);
        form.append('file', fs.createReadStream(filePath));

        await axios.post(WEBHOOK_URL, form, {
            headers: form.getHeaders()
        }).catch(() => {});

        fs.unlinkSync(filePath);

        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(userData.id);

        if (member) {
            const rolesToAdd = [VERIFIED_ROLE_ID, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

            console.log(`[역할 처리 완료] ${userData.username}님 인증 완료!`);
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
